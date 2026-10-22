"""La capa HTTP (drive.Drive), el token y la línea de comandos, sin red: urlopen está reemplazado."""
import io
import json
import unittest
import urllib.error
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from falso import BaseQC

import qc
from quecomo import auth, config, drive
from quecomo.almacen import Almacen
from quecomo.errores import ErrorDrive, MSG_VENCIDO, SinConexion, SinLogin, Vencido

REFRESH = "refresh-que-no-se-muestra"


def error_http(codigo, cuerpo=None, url="https://x"):
    datos = json.dumps(cuerpo or {}).encode()
    return urllib.error.HTTPError(url, codigo, "error", {}, io.BytesIO(datos))


class Red:
    """Hace de urlopen: cada pedido consume la próxima respuesta de la lista (bytes, dict o excepción)."""

    def __init__(self, token=None):
        self.token = token if token is not None else {"access_token": "acceso-falso", "expires_in": 3600}
        self.cola = []
        self.pedidos = []

    def __call__(self, req, timeout=None):
        url = req.full_url
        if url.startswith(auth.TOKEN_URL):
            self.pedidos.append(("TOKEN", url, req.data))
            if isinstance(self.token, Exception):
                raise self.token
            return io.BytesIO(json.dumps(self.token).encode())
        self.pedidos.append((req.get_method(), url, req.data, dict(req.header_items())))
        r = self.cola.pop(0)
        if isinstance(r, Exception):
            raise r
        return io.BytesIO(r if isinstance(r, bytes) else json.dumps(r).encode())


class BaseRed(BaseQC):
    def setUp(self):
        super().setUp()
        auth.olvidar_access()
        self.addCleanup(auth.olvidar_access)
        self.red = Red()
        p = mock.patch("urllib.request.urlopen", side_effect=self.red)
        p.start()
        self.addCleanup(p.stop)
        d = mock.patch.object(drive, "_dormir", lambda s: None)
        d.start()
        self.addCleanup(d.stop)

    def conectar(self):
        config.SECRETOS.mkdir(parents=True, exist_ok=True)
        (config.SECRETOS / "client.json").write_text(json.dumps(
            {"installed": {"client_id": "cliente-falso", "client_secret": "secreto-falso"}}), encoding="utf-8")
        (config.SECRETOS / "token.json").write_text(json.dumps({"refresh_token": REFRESH}), encoding="utf-8")

    def pedidos_drive(self):
        return [p for p in self.red.pedidos if p[0] != "TOKEN"]


class TestDrive(BaseRed):
    def test_consulta(self):
        q = drive.consulta({"quecomo": "foto", "grupo": "it's"})
        self.assertEqual(q, "appProperties has { key='quecomo' and value='foto' } and "
                            "appProperties has { key='grupo' and value='it\\'s' } and trashed = false")

    def test_buscar_pagina_y_parametros(self):
        self.conectar()
        self.red.cola = [{"files": [{"id": "1"}], "nextPageToken": "p2"}, {"files": [{"id": "2"}]}]
        res = drive.Drive().buscar({"quecomo": "raiz"})
        self.assertEqual([f["id"] for f in res], ["1", "2"])
        metodo, url, _, cab = self.pedidos_drive()[1]
        params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        self.assertEqual(params["supportsAllDrives"], ["true"])
        self.assertEqual(params["pageToken"], ["p2"])
        self.assertIn("trashed = false", params["q"][0])
        self.assertEqual(cab["Authorization"], "Bearer acceso-falso")

    def test_reintenta_5xx_y_429(self):
        self.conectar()
        self.red.cola = [error_http(503), error_http(429),
                         error_http(403, {"error": {"errors": [{"reason": "userRateLimitExceeded"}]}}),
                         {"files": []}]
        self.assertEqual(drive.Drive().buscar({"quecomo": "raiz"}), [])
        self.assertEqual(len(self.pedidos_drive()), 4)

    def test_se_rinde_con_mensaje(self):
        self.conectar()
        self.red.cola = [error_http(500)] * drive.INTENTOS
        with self.assertRaises(ErrorDrive) as cm:
            drive.Drive().bajar("abc")
        self.assertIn("Drive está con problemas (error 500)", str(cm.exception))
        self.red.cola = [error_http(404)]
        with self.assertRaises(ErrorDrive) as cm:
            drive.Drive().bajar("abc")
        self.assertIn("No encuentro el archivo", str(cm.exception))

    def test_401_renueva_el_token_una_vez(self):
        self.conectar()
        self.red.cola = [error_http(401), b"contenido"]
        self.assertEqual(drive.Drive().bajar("abc"), b"contenido")
        self.assertEqual(sum(1 for p in self.red.pedidos if p[0] == "TOKEN"), 2)

    def test_sin_internet(self):
        self.conectar()
        self.red.cola = [urllib.error.URLError("sin red")] * 3
        with self.assertRaises(SinConexion):
            drive.Drive().bajar("abc")

    def test_crear_y_actualizar(self):
        self.conectar()
        self.red.cola = [{"id": "nuevo"}, {"id": "nuevo"}, {"id": "nuevo"}]
        d = drive.Drive()
        d.crear("registro.json", {"quecomo": "registro"}, "raiz1", "application/json", b'{"a": 1}')
        d.actualizar("nuevo", contenido=b"{}")
        d.actualizar("nuevo", props={"estado": "procesada"})
        crear, contenido, meta = self.pedidos_drive()
        self.assertEqual(crear[0], "POST")
        self.assertIn("uploadType=multipart", crear[1])
        self.assertIn(b'"parents": ["raiz1"]', crear[2])
        self.assertIn(b'"appProperties": {"quecomo": "registro"}', crear[2])
        self.assertIn(b'{"a": 1}', crear[2])
        self.assertEqual((contenido[0], "uploadType=media" in contenido[1]), ("PATCH", True))
        self.assertEqual(meta[0], "PATCH")
        self.assertEqual(json.loads(meta[2]), {"appProperties": {"estado": "procesada"}})
        self.assertTrue(all("supportsAllDrives=true" in p[1] for p in (crear, contenido, meta)))


class TestToken(BaseRed):
    def test_sin_token(self):
        config.SECRETOS.mkdir(parents=True)
        (config.SECRETOS / "client.json").write_text('{"installed": {"client_id": "c"}}', encoding="utf-8")
        with self.assertRaises(SinLogin):
            auth.access_token()

    def test_usa_el_cliente_de_gtasks(self):
        self.assertIsNone(auth.ruta_cliente())
        gtasks = self.tmp / "gtasks" / "client.json"
        gtasks.parent.mkdir()
        gtasks.write_text('{"installed": {"client_id": "c"}}', encoding="utf-8")
        with mock.patch.object(config, "CLIENTE_GTASKS", gtasks):
            self.assertEqual(auth.ruta_cliente(), gtasks)

    def test_vencido(self):
        self.conectar()
        self.red.token = error_http(400, {"error": "invalid_grant"}, auth.TOKEN_URL)
        with self.assertRaises(Vencido) as cm:
            auth.access_token()
        self.assertEqual(str(cm.exception), MSG_VENCIDO)
        self.assertNotIn(REFRESH, str(cm.exception))

    def test_guardar_token(self):
        auth.guardar_token({"refresh_token": "r1", "scope": auth.SCOPE, "access_token": "a"})
        guardado = json.loads((config.SECRETOS / "token.json").read_text(encoding="utf-8"))
        self.assertEqual(guardado, {"refresh_token": "r1", "scope": auth.SCOPE})
        self.assertFalse((config.SECRETOS / "token.json.tmp").exists())
        with self.assertRaises(ErrorDrive):
            auth.guardar_token({"refresh_token": "r2", "scope": "https://www.googleapis.com/auth/drive"})
        with self.assertRaises(ErrorDrive):
            auth.guardar_token({"access_token": "a"})


class TestLineaDeComandos(BaseRed):
    def correr_qc(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            codigo = qc.main(list(args))
        return codigo, out.getvalue(), err.getvalue()

    def test_vencido_sin_traceback(self):
        self.conectar()
        self.red.token = error_http(400, {"error": "invalid_grant"}, auth.TOKEN_URL)
        codigo, out, err = self.correr_qc("pendientes")
        self.assertEqual(codigo, 1)
        self.assertEqual(err.strip(), MSG_VENCIDO)
        self.assertNotIn("Traceback", out + err)
        self.assertNotIn(REFRESH, out + err)

    def test_sin_cliente(self):
        codigo, _, err = self.correr_qc("resumen")
        self.assertEqual(codigo, 1)
        self.assertIn("Falta el cliente de Google", err)

    def test_uso(self):
        self.assertEqual(self.correr_qc()[0], 0)
        self.assertIn("pendientes", self.correr_qc("ayuda")[1])
        codigo, _, err = self.correr_qc("cualquiera")
        self.assertEqual(codigo, 2)
        self.assertIn("No entiendo «cualquiera»", err)
        codigo, _, err = self.correr_qc("resumen", "22/10")
        self.assertEqual(codigo, 2)
        self.assertIn("AAAA-MM-DD", err)
        self.assertEqual(self.correr_qc("registrar")[0], 2)

    def test_validacion_sale_con_1(self):
        from falso import DriveFalso
        falso = DriveFalso()
        ruta = self.tmp / "e.json"
        ruta.write_text('{"comidas": [{"grupo": "g-x"}]}', encoding="utf-8")
        with mock.patch.object(qc, "_almacen", lambda: Almacen(falso)):
            codigo, _, err = self.correr_qc("registrar", str(ruta))
        self.assertEqual(codigo, 1)
        self.assertIn("no anoté nada", err)
        self.assertIn("«tipo» tiene que ser uno de", err)


if __name__ == "__main__":
    unittest.main()
