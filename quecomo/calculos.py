"""Cuentas y formatos (funciones puras): metas, resúmenes, números y fechas en castellano.

Mismas fórmulas que docs/js/calculos.js (ver CONTRATO.md, "Cálculos").
"""
import math
import unicodedata
from datetime import date, timedelta

FACTORES = {"sedentaria": 1.2, "ligera": 1.375, "moderada": 1.55, "alta": 1.725}
DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MACROS = ("kcal", "proteina_g", "carbos_g", "grasa_g")


# ------------------------------------------------------------------ fechas

def a_fecha(valor):
    if isinstance(valor, date):
        return valor
    try:
        return date.fromisoformat(str(valor)[:10])
    except (TypeError, ValueError):
        return None


def formato_fecha(valor):
    """'2026-10-22' → 'mié 22/10'."""
    d = a_fecha(valor)
    if d is None:
        return str(valor)
    return f"{DIAS[d.weekday()]} {d.day:02d}/{d.month:02d}"


def lunes_de(d):
    return d - timedelta(days=d.weekday())


def num(n, decimales=0):
    """1850 → '1.850'; 82.4 → '82,4' (con decimales=1)."""
    if n is None:
        return "—"
    texto = f"{n:,.{decimales}f}"
    return texto.replace(",", "_").replace(".", ",").replace("_", ".")


def normalizar(texto):
    """Minúsculas y sin tildes, para buscar."""
    t = unicodedata.normalize("NFKD", str(texto or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


# ------------------------------------------------------------------ metas

def edad(nacimiento, fecha):
    n = a_fecha(nacimiento)
    if n is None:
        return None
    return fecha.year - n.year - ((fecha.month, fecha.day) < (n.month, n.day))


def tmb(sexo, kg, altura_cm, anios):
    base = 10 * kg + 6.25 * altura_cm - 5 * anios
    return base + (5 if sexo == "m" else -161)


def _numero(v):
    """Como esNum de calculos.js: número finito (no bool), o None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return v


def redondear(x):
    """Entero más cercano con los .5 hacia arriba, como Math.round de JS (round() de Python
    redondea al par: round(2414.5) = 2414, Math.round(2414.5) = 2415)."""
    return math.floor(x + 0.5)


def peso_actual(registros, fecha):
    """El último registro de peso hasta esa fecha (kg) o None."""
    mejor = None
    for r in registros or []:
        if not isinstance(r, dict):
            continue
        d, kg = a_fecha(r.get("fecha")), _numero(r.get("kg"))
        if d is None or kg is None or d > fecha:
            continue
        if mejor is None or d >= mejor[0]:
            mejor = (d, kg)
    return mejor[1] if mejor else None


def gasto_diario(perfil, kg, fecha):
    if not isinstance(perfil, dict) or kg is None:
        return None
    anios = edad(perfil.get("nacimiento"), fecha)
    altura = _numero(perfil.get("altura_cm"))
    factor = FACTORES.get(perfil.get("actividad"))
    if anios is None or altura is None or factor is None or perfil.get("sexo") not in ("m", "f"):
        return None
    # Como gastoDiario de calculos.js: entero (se redondea antes de restar el déficit).
    return redondear(tmb(perfil["sexo"], kg, altura, anios) * factor)


def meta_kcal(perfil, kg, fecha):
    """meta_kcal_manual, o gasto diario (ya entero) − déficit; entero, o None si falta algo.
    Igual que metaKcal de calculos.js, número por número."""
    if not isinstance(perfil, dict):
        return None
    manual = _numero(perfil.get("meta_kcal_manual"))
    if manual is not None:
        return redondear(manual)
    gasto = gasto_diario(perfil, kg, fecha)
    if gasto is None:
        return None
    return redondear(gasto - (_numero(perfil.get("deficit_kcal")) or 0))


def meta_proteina(perfil, kg):
    if not isinstance(perfil, dict):
        return None
    por_kg = _numero(perfil.get("proteina_g_kg"))
    base = _numero(perfil.get("peso_objetivo_kg")) or kg
    if por_kg is None or base is None:
        return None
    return redondear(por_kg * base)


# ------------------------------------------------------------------ resúmenes

def comidas_del_dia(registro, fecha):
    iso = fecha.isoformat()
    comidas = [c for c in registro.get("comidas", []) if isinstance(c, dict) and c.get("fecha") == iso]
    return sorted(comidas, key=lambda c: str(c.get("hora") or ""))


def resumen_dia(registro, fecha):
    comidas = comidas_del_dia(registro, fecha)
    tot = {m: sum(_numero(c.get(m)) or 0 for c in comidas) for m in MACROS}
    return {**{m: redondear(v) for m, v in tot.items()}, "comidas": comidas}


def resumen_semana(registro, lunes):
    dias = [resumen_dia(registro, lunes + timedelta(days=i)) for i in range(7)]
    con = [d for d in dias if d["comidas"]]
    promedio = redondear(sum(d["kcal"] for d in con) / len(con)) if con else None
    return {"dias": dias, "promedioKcal": promedio, "diasConComidas": len(con)}


def frase_meta(kcal, meta):
    """'te quedan 420 kcal' / '120 kcal arriba de la meta' / '' sin meta."""
    if meta is None:
        return ""
    dif = meta - kcal
    if dif >= 0:
        return f"te quedan {num(dif)} kcal"
    return f"{num(-dif)} kcal arriba de la meta"
