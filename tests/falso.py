"""Un Drive falso en memoria (misma interfaz que quecomo.drive.Drive) y un entorno de prueba.

Cada prueba que hereda de BaseQC tiene data/ y ~/.config/que-como en un temporal, la hora fija
en mié 22/10/2026 21:00 (-03:00) y la red bloqueada.
"""
import copy
import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest import mock

RAIZ_APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ_APP))

from quecomo import config  # noqa: E402
from quecomo.almacen import Almacen  # noqa: E402
from quecomo.drive import CARPETA  # noqa: E402

AHORA = datetime(2026, 10, 22, 21, 0, 0, tzinfo=config.TZ)


class DriveFalso:
    def __init__(self):
        self.archivos = {}      # id -> metadatos
        self.contenidos = {}    # id -> bytes
        self.n = 0
        self.bajadas = []
        self.actualizaciones = []
        self.creados = []
        self.falla_actualizar = None

    def _id(self):
        self.n += 1
        return f"id{self.n:03d}"

    def agregar(self, nombre, props, contenido=b"", mime="image/jpeg", descripcion=None, creado=None,
                padre=None, trashed=False):
        fid = self._id()
        meta = {"id": fid, "name": nombre, "mimeType": mime, "appProperties": dict(props),
                "createdTime": creado or f"2026-10-22T00:00:{self.n:02d}.000Z", "trashed": trashed}
        if mime != CARPETA:
            meta["size"] = str(len(contenido))
            self.contenidos[fid] = contenido
        if descripcion is not None:
            meta["description"] = descripcion
        if padre:
            meta["parents"] = [padre]
        self.archivos[fid] = meta
        return fid

    def agregar_json(self, tipo, datos, nombre=None, creado=None):
        return self.agregar(nombre or f"{tipo}.json", {"quecomo": tipo},
                            json.dumps(datos, ensure_ascii=False).encode("utf-8"), "application/json",
                            creado=creado)

    def json_de(self, tipo):
        ids = [f["id"] for f in self.buscar({"quecomo": tipo})]
        return json.loads(self.contenidos[ids[0]].decode("utf-8")) if ids else None

    # ------------------------------------------------ la interfaz de Drive

    def buscar(self, props):
        res = [copy.deepcopy({k: v for k, v in f.items() if k != "trashed"})
               for f in self.archivos.values()
               if not f["trashed"] and all(f["appProperties"].get(k) == v for k, v in props.items())]
        return sorted(res, key=lambda f: f["createdTime"])

    def bajar(self, fid):
        self.bajadas.append(fid)
        return self.contenidos[fid]

    def crear(self, nombre, props, padre=None, mime="application/json", contenido=None):
        fid = self.agregar(nombre, props, contenido if contenido is not None else b"", mime,
                           creado=f"2026-10-23T00:00:{self.n:02d}.000Z", padre=padre)
        self.creados.append(fid)
        return copy.deepcopy(self.archivos[fid])

    def actualizar(self, fid, props=None, contenido=None, mime="application/json"):
        if self.falla_actualizar and props:
            raise self.falla_actualizar
        self.actualizaciones.append((fid, props, contenido is not None))
        f = self.archivos[fid]
        if contenido is not None:
            self.contenidos[fid] = contenido
            f["size"] = str(len(contenido))
        if props:
            f["appProperties"].update(props)
        return copy.deepcopy(f)


PERFIL = {"version": 1, "sexo": "m", "nacimiento": "1985-04-12", "altura_cm": 178, "actividad": "ligera",
          "peso_objetivo_kg": 78, "deficit_kcal": 500, "proteina_g_kg": 1.6, "meta_kcal_manual": None}
# 84,3 kg, 41 años: TMB = 843 + 1112,5 − 205 + 5 = 1755,5; × 1,375 = 2413,8; − 500 = 1914
META = 1914


class BaseQC(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="quecomo-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.data = self.tmp / "data"
        parches = [
            mock.patch.object(config, "DATA", self.data),
            mock.patch.object(config, "SECRETOS", self.tmp / "secretos"),
            mock.patch.object(config, "CLIENTE_GTASKS", self.tmp / "no-hay" / "client.json"),
            mock.patch.object(config, "ahora", lambda: AHORA),
            mock.patch("urllib.request.urlopen", side_effect=AssertionError("sin red en las pruebas")),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.drive = DriveFalso()
        self.alm = Almacen(self.drive)

    def correr(self, fn, *args):
        """Corre fn(*args) capturando la salida → (resultado, stdout)."""
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(io.StringIO()):
            res = fn(*args)
        return res, out.getvalue()

    # ------------------------------------------------ armado de escenarios

    def raiz(self):
        return self.drive.agregar("Qué como", {"quecomo": "raiz"}, mime=CARPETA)

    def foto(self, nombre, grupo, tomada, nota=None, estado="pendiente", contenido=None):
        return self.drive.agregar(nombre, {"quecomo": "foto", "grupo": grupo, "tomada": tomada, "estado": estado},
                                  contenido or f"JPEG {nombre}".encode(), "image/jpeg", descripcion=nota)

    def texto(self, nombre, grupo, tomada, texto, estado="pendiente"):
        return self.drive.agregar(nombre, {"quecomo": "texto", "grupo": grupo, "tomada": tomada, "estado": estado},
                                  texto.encode("utf-8"), "text/plain", descripcion=texto)

    def perfil_y_peso(self):
        self.drive.agregar_json("perfil", PERFIL)
        self.drive.agregar_json("peso", {"version": 1, "registros": [
            {"fecha": "2026-10-20", "kg": 85.0}, {"fecha": "2026-10-22", "kg": 84.3},
            {"fecha": "2026-10-25", "kg": 80.0}]})
