"""OAuth de Google (permiso drive.file) para la línea de comandos.

Mismo patrón que Loop web: cliente OAuth "App de escritorio" del proyecto cerebro-tasks, PKCE,
servidor loopback en un puerto al azar y refresh token guardado fuera del repo.

    cmd_auth()        login desde la terminal (python qc.py auth)
    access_token()    token de acceso vigente (lo renueva con el refresh token)
    olvidar_access()  descarta el token de acceso en memoria (después de un 401)

Secretos en config.SECRETOS (~/.config/que-como/):
    client.json   el cliente OAuth; si falta, se usa el de gtasks-mcp (mismo proyecto)
    token.json    el refresh token: es una contraseña, nunca se imprime ni se loguea
"""
import base64
import hashlib
import http.client
import http.server
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

from . import config
from .errores import ErrorDrive, SinCliente, SinConexion, SinLogin, Vencido

SCOPE = "https://www.googleapis.com/auth/drive.file"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
ESPERA_LOGIN = 300  # segundos que se espera la vuelta del navegador

_access = {"token": None, "exp": 0.0}

ERRORES_RED = (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException)


# ---------------------------------------------------------------- rutas

def ruta_cliente():
    propio = config.SECRETOS / "client.json"
    if propio.exists():
        return propio
    if config.CLIENTE_GTASKS.exists():
        return config.CLIENTE_GTASKS
    return None


def ruta_token():
    return config.SECRETOS / "token.json"


def cliente():
    ruta = ruta_cliente()
    if ruta is None:
        raise SinCliente(f"Falta el cliente de Google: no encuentro {config.SECRETOS / 'client.json'} "
                         f"ni {config.CLIENTE_GTASKS}.")
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        c = datos.get("installed") or datos.get("web") or datos
        c["client_id"]
    except (OSError, ValueError, KeyError, AttributeError, TypeError):
        raise SinCliente(f"No pude leer el cliente de Google en {ruta}.") from None
    return c


# ---------------------------------------------------------------- token

def post_form(url, campos):
    cuerpo = urllib.parse.urlencode(campos).encode()
    req = urllib.request.Request(url, data=cuerpo,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # Solo el código de error de Google: el cuerpo no se reenvía ni se loguea.
        try:
            codigo = json.loads(e.read().decode("utf-8", errors="replace")).get("error", "")
        except (ValueError, AttributeError, OSError):
            codigo = ""
        finally:
            e.close()
        if codigo == "invalid_grant":
            raise Vencido() from None
        if codigo in ("invalid_client", "unauthorized_client"):
            raise SinCliente("Google no reconoce el cliente (client.json): puede que lo hayan borrado "
                             "del proyecto de Google Cloud.") from None
        raise ErrorDrive(f"Google rechazó el pedido de acceso (error {e.code}).") from None
    except ERRORES_RED:
        raise SinConexion() from None
    except ValueError:
        raise ErrorDrive("Google devolvió una respuesta que no entiendo al pedir el acceso.") from None


def guardar_token(tok):
    if "refresh_token" not in tok:
        raise ErrorDrive("Google no devolvió el permiso duradero (refresh token). "
                         "Quitá el acceso de la app en tu cuenta de Google y volvé a correr: python qc.py auth")
    concedidos = tok.get("scope", SCOPE).split()
    if SCOPE not in concedidos:
        raise ErrorDrive("No diste permiso para los archivos de Qué como en el Drive: "
                         "volvé a correr python qc.py auth y aceptalo.")
    config.SECRETOS.mkdir(parents=True, exist_ok=True)
    ruta = ruta_token()
    tmp = ruta.with_name(ruta.name + ".tmp")
    tmp.write_text(json.dumps({"refresh_token": tok["refresh_token"], "scope": SCOPE}), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, ruta)
    olvidar_access()


def olvidar_access():
    _access.update(token=None, exp=0.0)


def access_token():
    if _access["token"] and time.time() < _access["exp"] - 60:
        return _access["token"]
    c = cliente()
    ruta = ruta_token()
    if not ruta.exists():
        raise SinLogin()
    try:
        refresh = json.loads(ruta.read_text(encoding="utf-8"))["refresh_token"]
    except (OSError, ValueError, KeyError, TypeError):
        raise SinLogin() from None
    tok = post_form(TOKEN_URL, {
        "client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
        "refresh_token": refresh, "grant_type": "refresh_token",
    })
    if not tok.get("access_token"):
        raise ErrorDrive("Google no devolvió el token de acceso.")
    _access.update(token=tok["access_token"], exp=time.time() + float(tok.get("expires_in", 3600)))
    return _access["token"]


# ---------------------------------------------------------------- login

def pkce():
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def url_login(c, redirect_uri, state, challenge):
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect_uri, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })


def canjear(c, code, redirect_uri, verifier):
    return post_form(TOKEN_URL, {
        "code": code, "client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
        "redirect_uri": redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
    })


_ERRORES_GOOGLE = {
    "access_denied": "Cancelaste el permiso en Google. Para conectar, volvé a correr: python qc.py auth",
}


def cmd_auth(abrir=webbrowser.open):
    """Login desde la terminal: abre el navegador y espera la vuelta en un puerto local al azar."""
    c = cliente()
    verifier, challenge = pkce()
    state = secrets.token_urlsafe(16)
    resultado = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" not in q and "error" not in q:
                self.send_response(404)
                self.end_headers()
                return
            resultado.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<!doctype html><meta charset='utf-8'><title>Qué como</title>"
                             "<h2 style='font-family:sans-serif'>Listo. Ya podés cerrar esta pestaña.</h2>"
                             .encode("utf-8"))

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    server.timeout = 5
    redirect = f"http://127.0.0.1:{server.server_port}"
    url = url_login(c, redirect, state, challenge)
    print("Abriendo el navegador para conectar el Drive (solo los archivos de Qué como).\n"
          "Aceptá el permiso en Google. Si no se abre, copiá esta dirección en el navegador:\n" + url,
          flush=True)
    try:
        abrir(url)
    except Exception:  # sin navegador: queda la dirección impresa
        pass
    limite = time.monotonic() + ESPERA_LOGIN
    try:
        while not resultado and time.monotonic() < limite:
            server.handle_request()
    finally:
        server.server_close()
    if not resultado:
        raise ErrorDrive(f"No llegó la respuesta de Google en {ESPERA_LOGIN // 60} minutos. "
                         "Volvé a correr: python qc.py auth")
    if resultado.get("error"):
        raise ErrorDrive(_ERRORES_GOOGLE.get(resultado["error"],
                                             f"Google devolvió un error ({resultado['error']})."))
    if resultado.get("state") != state:
        raise ErrorDrive("La respuesta de Google no corresponde a este pedido; no se guardó nada.")
    try:
        tok = canjear(c, resultado["code"], redirect, verifier)
    except Vencido:
        raise ErrorDrive("Google no aceptó el código de acceso. Volvé a correr: python qc.py auth") from None
    guardar_token(tok)
    print("Listo: el Drive quedó conectado.", flush=True)
