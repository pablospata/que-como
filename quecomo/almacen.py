"""Los datos de Qué como en el Drive, según el contrato.

Los archivos se reconocen por appProperties.quecomo (nunca por nombre); si hay varios del mismo
tipo, vale el más viejo (createdTime). Recibe un objeto con la interfaz de drive.Drive.
"""
import json
import re
from datetime import datetime

from . import config
from .drive import CARPETA
from .errores import ErrorDrive

NOMBRE_RAIZ = "Qué como"
NOMBRES = {"registro": "registro.json", "perfil": "perfil.json", "peso": "peso.json"}
TIPOS_PIEZA = ("foto", "texto")
_GRUPO = re.compile(r"^g-(\d{8})-(\d{6})")


class Almacen:
    def __init__(self, drive):
        self.drive = drive

    # -------------------------------------------------------------- archivos únicos

    def uno(self, tipo):
        archivos = self.drive.buscar({"quecomo": tipo})
        if not archivos:
            return None
        return min(archivos, key=lambda f: (f.get("createdTime") or "", f.get("id") or ""))

    def raiz(self, crear=False):
        f = self.uno("raiz")
        if f is None and crear:
            f = self.drive.crear(NOMBRE_RAIZ, {"quecomo": "raiz"}, None, CARPETA)
        return f

    def leer_json(self, tipo):
        """→ (objeto, metadatos) o (None, None) si no existe."""
        f = self.uno(tipo)
        if f is None:
            return None, None
        crudo = self.drive.bajar(f["id"])
        if not crudo.strip():
            return None, f
        try:
            return json.loads(crudo.decode("utf-8-sig")), f
        except (ValueError, UnicodeDecodeError):
            raise ErrorDrive(f"{f.get('name') or NOMBRES.get(tipo)} en el Drive no es un JSON válido: "
                             "no lo toco. Revisalo en el Drive.") from None

    # -------------------------------------------------------------- registro, perfil, peso

    def leer_registro(self):
        reg, _ = self.leer_json("registro")
        return _registro_valido(reg)

    def actualizar_registro(self, fn):
        """Lee lo último, aplica fn(registro) → registro, y escribe (creando el archivo si falta)."""
        reg, meta = self.leer_json("registro")
        nuevo = fn(_registro_valido(reg))
        nuevo["actualizado"] = config.ahora_iso()
        contenido = json.dumps(nuevo, ensure_ascii=False, indent=2).encode("utf-8")
        if meta is not None:
            self.drive.actualizar(meta["id"], contenido=contenido, mime="application/json")
        else:
            raiz = self.raiz(crear=True)
            self.drive.crear(NOMBRES["registro"], {"quecomo": "registro"}, raiz["id"],
                             "application/json", contenido)
        return nuevo

    def leer_perfil(self):
        perfil, _ = self.leer_json("perfil")
        return perfil if isinstance(perfil, dict) else None

    def leer_peso(self):
        peso, _ = self.leer_json("peso")
        if not isinstance(peso, dict) or not isinstance(peso.get("registros"), list):
            return {"version": 1, "registros": []}
        return peso

    # -------------------------------------------------------------- piezas

    def piezas_pendientes(self):
        piezas = []
        for tipo in TIPOS_PIEZA:
            piezas += self.drive.buscar({"quecomo": tipo, "estado": "pendiente"})
        return piezas

    def piezas_de_grupo(self, grupo):
        return [p for p in self.drive.buscar({"grupo": grupo})
                if (p.get("appProperties") or {}).get("quecomo") in TIPOS_PIEZA]

    def marcar(self, pieza_id, estado):
        self.drive.actualizar(pieza_id, props={"estado": estado})


def _registro_valido(reg):
    if reg is None:
        return {"version": 1, "comidas": []}
    if not isinstance(reg, dict) or not isinstance(reg.get("comidas", []), list):
        raise ErrorDrive("registro.json en el Drive no tiene la forma esperada: no lo toco. Revisalo en el Drive.")
    reg.setdefault("version", 1)
    reg.setdefault("comidas", [])
    return reg


# ------------------------------------------------------------------ capturas

def props(pieza):
    return pieza.get("appProperties") or {}


def tipo_pieza(pieza):
    return props(pieza).get("quecomo")


def grupo_de(pieza):
    return props(pieza).get("grupo") or f"sin-grupo-{pieza['id']}"


def parse_tomada(texto):
    """'2026-10-22T13:40:12-03:00' → datetime con zona (UTC o sin zona se pasa a Argentina)."""
    if not texto:
        return None
    try:
        d = datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        return d.replace(tzinfo=config.TZ)
    if d.utcoffset().total_seconds() == 0:
        return d.astimezone(config.TZ)
    return d


def momento(tomada, grupo=None):
    """El datetime local de una captura: de `tomada`, o del nombre del grupo si falta."""
    d = parse_tomada(tomada)
    if d is None and grupo:
        m = _GRUPO.match(grupo)
        if m:
            try:
                d = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=config.TZ)
            except ValueError:
                d = None
    return d


def fecha_hora(tomada, grupo=None):
    d = momento(tomada, grupo)
    if d is None:
        return None, None
    return d.date().isoformat(), d.strftime("%H:%M")


def orden_nombre(nombre):
    """Clave para ordenar piezas por nombre como la página: sin extensión y con los números como
    números (…_a3f9 < …_a3f9_2 < …_a3f9_10)."""
    base = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", str(nombre or ""))
    return tuple((0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.findall(r"\d+|\D+", base))


def agrupar(piezas):
    """Piezas sueltas → capturas: [{grupo, tomada, nota, fotos:[...], textos:[...]}] de la más vieja a la más nueva."""
    grupos = {}
    for p in piezas:
        grupos.setdefault(grupo_de(p), []).append(p)
    capturas = []
    for grupo, ps in grupos.items():
        ps.sort(key=lambda p: (orden_nombre(p.get("name")), p.get("createdTime") or ""))
        tomadas = [(momento(props(p).get("tomada")), props(p).get("tomada")) for p in ps]
        validas = [t for t in tomadas if t[0] is not None]
        tomada = min(validas, key=lambda t: t[0])[1] if validas else None
        if tomada is None:
            d = momento(None, grupo)
            tomada = d.isoformat(timespec="seconds") if d else None
        nota = next((p.get("description") for p in ps if (p.get("description") or "").strip()), "") or ""
        capturas.append({
            "grupo": grupo, "tomada": tomada, "nota": nota.strip(),
            "fotos": [p for p in ps if tipo_pieza(p) == "foto"],
            "textos": [p for p in ps if tipo_pieza(p) == "texto"],
            "piezas": ps,
        })
    capturas.sort(key=lambda c: (momento(c["tomada"], c["grupo"]) or datetime.max.replace(tzinfo=config.TZ),
                                 c["grupo"]))
    return capturas
