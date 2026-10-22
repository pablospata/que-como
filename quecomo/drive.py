"""La API de Drive v3 por HTTP (urllib), con reintentos y errores en español.

`Drive` es la única clase que sale a la red. Las pruebas la reemplazan por una falsa en memoria
con los mismos métodos:

    buscar(props)                       archivos no borrados cuyas appProperties incluyen props
    bajar(id)                           el contenido (bytes)
    crear(nombre, props, padre, mime, contenido=None)   archivo o carpeta nueva → metadatos
    actualizar(id, props=None, contenido=None, mime=None)   cambia appProperties y/o contenido
"""
import http.client
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from . import auth
from .errores import ErrorDrive, SinConexion

API = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
CAMPOS = "id,name,mimeType,size,createdTime,modifiedTime,description,appProperties,parents"
CARPETA = "application/vnd.google-apps.folder"
INTENTOS = 5
RAZONES_LIMITE = {"rateLimitExceeded", "userRateLimitExceeded"}

_dormir = time.sleep  # las pruebas lo reemplazan para no esperar


def _comillas(texto):
    return "'" + str(texto).replace("\\", "\\\\").replace("'", "\\'") + "'"


def consulta(props):
    """{'quecomo': 'foto', 'estado': 'pendiente'} → la cadena q de Drive (siempre trashed = false)."""
    partes = [f"appProperties has {{ key={_comillas(k)} and value={_comillas(v)} }}"
              for k, v in props.items()]
    partes.append("trashed = false")
    return " and ".join(partes)


def _razon(cuerpo):
    try:
        err = json.loads(cuerpo.decode("utf-8", errors="replace")).get("error", {})
        return {e.get("reason") for e in err.get("errors", []) if isinstance(e, dict)}
    except (ValueError, AttributeError):
        return set()


class Drive:
    def __init__(self, token=auth.access_token):
        self._token = token

    # -------------------------------------------------------------- HTTP

    def _pedir(self, metodo, url, cuerpo=None, tipo=None, timeout=60):
        """Un pedido a Google. Reintenta 429/5xx/límite de uso y la falta de red; renueva el token ante un 401."""
        renovado = False
        intento = 0
        while True:
            intento += 1
            cabeceras = {"Authorization": "Bearer " + self._token()}
            if tipo:
                cabeceras["Content-Type"] = tipo
            req = urllib.request.Request(url, data=cuerpo, headers=cabeceras, method=metodo)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                try:
                    detalle = e.read()
                except (OSError, ValueError):
                    detalle = b""
                finally:
                    e.close()
                if e.code == 401 and not renovado:
                    renovado = True
                    auth.olvidar_access()
                    continue
                reintentable = e.code == 429 or e.code >= 500 or (
                    e.code == 403 and _razon(detalle) & RAZONES_LIMITE)
                if reintentable and intento < INTENTOS:
                    _dormir(min(2 ** (intento - 1), 16))
                    continue
                raise _error_http(e.code) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
                if intento < 3:
                    _dormir(intento)
                    continue
                raise SinConexion() from None

    def _json(self, metodo, url, datos=None):
        cuerpo = None if datos is None else json.dumps(datos).encode("utf-8")
        resp = self._pedir(metodo, url, cuerpo, "application/json; charset=UTF-8" if cuerpo else None)
        try:
            return json.loads(resp.decode("utf-8")) if resp else {}
        except ValueError:
            raise ErrorDrive("Drive devolvió una respuesta que no entiendo.") from None

    # -------------------------------------------------------------- API

    def buscar(self, props):
        archivos, pagina = [], None
        while True:
            params = {
                "q": consulta(props), "fields": f"nextPageToken,files({CAMPOS})", "pageSize": "1000",
                "orderBy": "createdTime", "spaces": "drive",
                "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
            }
            if pagina:
                params["pageToken"] = pagina
            datos = self._json("GET", API + "?" + urllib.parse.urlencode(params))
            archivos.extend(datos.get("files", []))
            pagina = datos.get("nextPageToken")
            if not pagina:
                return archivos

    def bajar(self, file_id):
        url = f"{API}/{urllib.parse.quote(file_id)}?alt=media&supportsAllDrives=true"
        return self._pedir("GET", url, timeout=120)

    def crear(self, nombre, props, padre=None, mime="application/json", contenido=None):
        meta = {"name": nombre, "mimeType": mime, "appProperties": dict(props)}
        if padre:
            meta["parents"] = [padre]
        params = urllib.parse.urlencode({"fields": CAMPOS, "supportsAllDrives": "true"})
        if contenido is None:
            return self._json("POST", f"{API}?{params}", meta)
        limite = "quecomo-" + secrets.token_hex(12)
        cuerpo = (f"--{limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                  f"{json.dumps(meta)}\r\n--{limite}\r\nContent-Type: {mime}\r\n\r\n").encode("utf-8")
        cuerpo += contenido + f"\r\n--{limite}--\r\n".encode("utf-8")
        resp = self._pedir("POST", f"{UPLOAD}?uploadType=multipart&{params}", cuerpo,
                           f"multipart/related; boundary={limite}")
        return json.loads(resp.decode("utf-8"))

    def actualizar(self, file_id, props=None, contenido=None, mime="application/json"):
        params = urllib.parse.urlencode({"fields": CAMPOS, "supportsAllDrives": "true"})
        fid = urllib.parse.quote(file_id)
        meta = None
        if contenido is not None:
            resp = self._pedir("PATCH", f"{UPLOAD}/{fid}?uploadType=media&{params}", contenido, mime)
            meta = json.loads(resp.decode("utf-8"))
        if props:
            meta = self._json("PATCH", f"{API}/{fid}?{params}", {"appProperties": dict(props)})
        return meta


def _error_http(codigo):
    if codigo == 401:
        return ErrorDrive("Google rechazó el acceso al Drive. Corré: python qc.py auth")
    if codigo == 403:
        return ErrorDrive("Drive no me deja usar ese archivo (error 403). Si sigue, corré: python qc.py auth")
    if codigo == 404:
        return ErrorDrive("No encuentro el archivo en el Drive (¿se borró?).")
    if codigo == 429:
        return ErrorDrive("Drive está pidiendo que bajemos el ritmo (error 429). Probá de nuevo en un rato.")
    if codigo >= 500:
        return ErrorDrive(f"Drive está con problemas (error {codigo}). Probá de nuevo en un rato.")
    return ErrorDrive(f"Drive respondió con un error ({codigo}).")
