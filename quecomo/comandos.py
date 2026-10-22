"""Los comandos de qc.py: pendientes, platos, registrar y resumen.

Cada uno recibe un Almacen (que envuelve el Drive real o uno falso en las pruebas), imprime en
castellano y devuelve lo que hizo (para las pruebas). Los errores esperables son ErrorQC.
"""
import json
import os
import re
import shutil
import tempfile
from datetime import timedelta
from pathlib import Path

from . import config
from .almacen import agrupar, fecha_hora, props
from .calculos import (MACROS, a_fecha, formato_fecha, frase_meta, lunes_de, meta_kcal,
                       meta_proteina, normalizar, num, peso_actual, resumen_dia, resumen_semana)
from .errores import ErrorLocal, ErrorValidacion

TIPOS = ("desayuno", "almuerzo", "merienda", "cena", "colacion", "bebida")
CONFIANZAS = ("alta", "media", "baja")
EXTENSIONES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic",
               "image/gif": ".gif"}
MAX_PLATOS_RECIENTES = 30
MAX_PLATOS_BUSQUEDA = 40


# ------------------------------------------------------------------ utilidades locales

def carpeta_segura(nombre):
    """Un grupo del Drive como nombre de carpeta local (sin barras ni puntos raros)."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(nombre)) or "_"


def carpeta_captura(grupo):
    return config.pendientes_dir() / carpeta_segura(grupo)


def carpeta_revision(comida_id):
    return config.pendientes_dir() / ("revisar-" + carpeta_segura(comida_id))


def escribir_atomico(ruta, contenido):
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=ruta.parent, prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(contenido)
        os.replace(tmp, ruta)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def escribir_json(ruta, datos):
    escribir_atomico(ruta, json.dumps(datos, ensure_ascii=False, indent=2).encode("utf-8"))


def leer_json_local(ruta, que):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise ErrorLocal(f"No encuentro {ruta}.") from None
    except OSError as e:
        raise ErrorLocal(f"No pude leer {ruta}: {e.strerror or e}.") from None
    except ValueError as e:
        raise ErrorLocal(f"{que} ({ruta}) no es un JSON válido: {e}.") from None


def _extension(pieza):
    ext = EXTENSIONES.get(pieza.get("mimeType"))
    if ext:
        return ext
    nombre = pieza.get("name") or ""
    suf = Path(nombre).suffix.lower()
    return suf if re.fullmatch(r"\.[a-z0-9]{1,5}", suf) else ".jpg"


def _bajar(alm, file_id, destino, tam=None):
    """Baja un archivo del Drive salvo que ya esté con el mismo tamaño. Devuelve True si lo bajó."""
    if destino.exists() and destino.stat().st_size > 0:
        if tam is None or str(destino.stat().st_size) == str(tam):
            return False
    escribir_atomico(destino, alm.drive.bajar(file_id))
    return True


def _bajar_captura(alm, cap, carpeta):
    """fotos → 1.jpg, 2.jpg…; textos → texto.txt (texto-2.txt…). Borra lo que sobre en la carpeta."""
    carpeta.mkdir(parents=True, exist_ok=True)
    archivos = []
    for i, p in enumerate(cap["fotos"], 1):
        destino = carpeta / f"{i}{_extension(p)}"
        _bajar(alm, p["id"], destino, p.get("size"))
        archivos.append(destino)
    for j, p in enumerate(cap["textos"]):
        destino = carpeta / ("texto.txt" if j == 0 else f"texto-{j + 1}.txt")
        _bajar(alm, p["id"], destino, p.get("size"))
        archivos.append(destino)
    _limpiar_carpeta(carpeta, archivos)
    return archivos


def _limpiar_carpeta(carpeta, quedan):
    nombres = {a.name for a in quedan}
    for f in carpeta.iterdir():
        if f.is_file() and f.name not in nombres:
            try:
                f.unlink()
            except OSError:
                pass


def _leer_texto(ruta):
    try:
        return Path(ruta).read_bytes().decode("utf-8-sig", errors="replace").strip()
    except OSError:
        return ""


def _contexto_meta(alm, fecha, perfil=None, peso=None):
    perfil = alm.leer_perfil() if perfil is None else perfil
    peso = alm.leer_peso() if peso is None else peso
    kg = peso_actual(peso["registros"], fecha)
    return perfil, peso, kg


def _cuando(tomada, grupo):
    fecha, hora = fecha_hora(tomada, grupo)
    if fecha is None:
        return "sin hora"
    return f"{formato_fecha(fecha)} {hora}"


def _pedido(comida):
    rev = comida.get("revisar")
    if isinstance(rev, dict):
        return str(rev.get("pedido") or "").strip()
    return str(rev or "").strip()


def _macros(x):
    return f"P {num(x.get('proteina_g'))} · C {num(x.get('carbos_g'))} · G {num(x.get('grasa_g'))}"


def _captura_completa(alm, grupo, extra=()):
    """Todas las piezas no descartadas de un grupo (las ya procesadas y las pendientes) como una
    captura, o None si no hay ninguna. `extra`: piezas pendientes ya conocidas, por si la búsqueda
    por grupo todavía no las devuelve."""
    piezas = [p for p in alm.piezas_de_grupo(grupo) if props(p).get("estado") != "descartada"]
    ids = {p["id"] for p in piezas}
    piezas += [p for p in extra if p["id"] not in ids and props(p).get("estado") != "descartada"]
    caps = [c for c in agrupar(piezas) if c["grupo"] == grupo] or agrupar(piezas)
    return caps[0] if caps else None


def _aviso_agregada(comida, nuevas):
    """'foto nueva para una comida ya registrada (13:40 Milanesa con puré)'."""
    fotos = sum(1 for p in nuevas if props(p).get("quecomo") == "foto")
    if fotos:
        que = "foto nueva" if fotos == 1 else f"{fotos} fotos nuevas"
    else:
        que = "texto nuevo" if len(nuevas) == 1 else f"{len(nuevas)} textos nuevos"
    cual = " ".join(x for x in (str(comida.get("hora") or ""), str(comida.get("titulo") or "")) if x)
    return f"{que} para una comida ya registrada ({cual or 'sin título'})"


# ------------------------------------------------------------------ pendientes

def pendientes(alm):
    hoy = config.hoy()
    capturas = agrupar(alm.piezas_pendientes())
    registro = alm.leer_registro()
    perfil, peso, kg = _contexto_meta(alm, hoy)
    meta = meta_kcal(perfil, kg, hoy)
    por_grupo = {c["grupo"]: c for c in capturas}
    existentes = {str(c["id"]): c for c in registro["comidas"] if isinstance(c, dict) and c.get("id")}

    salida_capturas, salida_revisar, usadas = [], [], set()
    for cap in capturas:
        carpeta = carpeta_captura(cap["grupo"])
        usadas.add(carpeta.name)
        comida = existentes.get(cap["grupo"])
        nuevas = cap["piezas"]
        if comida is not None:
            # Llegó una pieza tarde (el "+" quedó en la cola del celu) a una comida ya registrada:
            # se baja la comida entera (fotos viejas y nuevas) para volver a estimarla toda.
            cap = _captura_completa(alm, cap["grupo"], nuevas)
        archivos = _bajar_captura(alm, cap, carpeta)
        entrada = {"grupo": cap["grupo"], "tomada": cap["tomada"], "nota": cap["nota"],
                   "archivos": [str(a) for a in archivos], "ids": [p["id"] for p in cap["piezas"]]}
        if comida is not None:
            entrada["agregada"] = True
            entrada["nuevas"] = [p["id"] for p in nuevas]
            entrada["aviso"] = _aviso_agregada(comida, nuevas)
            entrada["comida"] = comida
            if comida.get("revisar"):
                entrada["pedido"] = _pedido(comida)
        salida_capturas.append(entrada)

    for comida in registro["comidas"]:
        if not isinstance(comida, dict) or not comida.get("revisar") or not comida.get("id"):
            continue
        cid = str(comida["id"])
        if cid in por_grupo:   # llegó otra pieza a una comida a revisar: va en capturas (agregada)
            continue
        carpeta = carpeta_revision(cid)
        usadas.add(carpeta.name)
        cap = _captura_completa(alm, cid)
        if cap:
            archivos = _bajar_captura(alm, cap, carpeta)
            ids = [p["id"] for p in cap["piezas"]]
        else:   # sin piezas encontrables: las fotos que dice el registro
            carpeta.mkdir(parents=True, exist_ok=True)
            archivos, ids = [], []
            for i, fid in enumerate(comida.get("fotos") or [], 1):
                destino = carpeta / f"{i}.jpg"
                _bajar(alm, fid, destino)
                archivos.append(destino)
                ids.append(fid)
            _limpiar_carpeta(carpeta, archivos)
        salida_revisar.append({"id": cid, "pedido": _pedido(comida), "comida": comida,
                               "archivos": [str(a) for a in archivos], "ids": ids})

    _limpiar_viejas(usadas)
    datos = {"generado": config.ahora_iso(), "capturas": salida_capturas, "revisar": salida_revisar,
             "perfil": perfil, "meta_kcal": meta}
    escribir_json(config.pendientes_json(), datos)
    _imprimir_pendientes(datos, kg)
    return datos


def _limpiar_viejas(usadas):
    base = config.pendientes_dir()
    if not base.is_dir():
        return
    for d in base.iterdir():
        if d.is_dir() and d.name not in usadas and (d.name.startswith("g-") or d.name.startswith("revisar-")
                                                      or d.name.startswith("sin-grupo-")):
            shutil.rmtree(d, ignore_errors=True)


def _imprimir_pendientes(datos, kg):
    caps, revs = datos["capturas"], datos["revisar"]
    if not caps and not revs:
        print("No hay nada pendiente: todas las capturas están procesadas y no hay revisiones pedidas.")
        return
    if caps:
        dias = {}
        for c in caps:
            fecha, _ = fecha_hora(c["tomada"], c["grupo"])
            dias[fecha] = dias.get(fecha, 0) + 1
        detalle = " · ".join(f"{formato_fecha(f) if f else 'sin fecha'}: {n}" for f, n in dias.items())
        print(f"{len(caps)} {'captura pendiente' if len(caps) == 1 else 'capturas pendientes'} ({detalle}).")
        print()
        for i, c in enumerate(caps, 1):
            fotos = [a for a in c["archivos"] if not Path(a).name.startswith("texto")]
            textos = [a for a in c["archivos"] if Path(a).name.startswith("texto")]
            partes = []
            if fotos:
                partes.append(f"{len(fotos)} foto{'s' if len(fotos) != 1 else ''}")
            if textos:
                partes.append("texto")
            print(f"{i}) {_cuando(c['tomada'], c['grupo'])} · {c['grupo']} · {' + '.join(partes) or 'vacía'}")
            if c.get("aviso"):
                v = c.get("comida") or {}
                print(f"   Ojo: {c['aviso']}. Estimá la comida entera con todas las fotos.")
                print(f"   Estimación anterior: {v.get('titulo') or 'sin título'} · {num(v.get('kcal'))} kcal · "
                      f"{_macros(v)}" + (" (corregida a mano)" if v.get("editada") else ""))
            if c["nota"]:
                print(f"   Nota: {c['nota']}")
            if c.get("pedido"):
                print(f"   Pedido de revisión: {c['pedido']}")
            for t in textos:
                print(f"   Texto: {_leer_texto(t)}")
            for a in fotos:
                print(f"   {a}")
        print()
    if revs:
        print(f"A revisar ({len(revs)}):")
        for i, r in enumerate(revs, 1):
            c = r["comida"]
            cuando = f"{formato_fecha(c.get('fecha'))} {c.get('hora') or ''}".strip()
            print(f"{i}) {cuando} · {c.get('titulo') or 'sin título'} ({num(c.get('kcal'))} kcal) · {r['id']}")
            print(f"   Pedido: {r['pedido'] or '(sin texto)'}")
            if c.get("nota"):
                print(f"   Nota: {c['nota']}")
            for a in r["archivos"]:
                if Path(a).name.startswith("texto"):
                    print(f"   Texto: {_leer_texto(a)}")
                else:
                    print(f"   {a}")
        print()
    if datos["meta_kcal"] is not None:
        print(f"Meta del día: {num(datos['meta_kcal'])} kcal.")
    elif datos["perfil"] is None:
        print("Sin perfil cargado: no hay meta de kcal.")
    else:
        print("Falta el peso o algún dato del perfil para calcular la meta de kcal." if kg is None
              else "Al perfil le falta algún dato para calcular la meta de kcal.")
    print(f"Detalle en {config.pendientes_json()}")


# ------------------------------------------------------------------ platos

def platos(alm, texto=""):
    registro = alm.leer_registro()
    comidas = [c for c in registro["comidas"] if isinstance(c, dict)]
    comidas.sort(key=lambda c: (str(c.get("fecha") or ""), str(c.get("hora") or "")), reverse=True)
    palabras = normalizar(texto).split()
    limite = MAX_PLATOS_BUSQUEDA if palabras else MAX_PLATOS_RECIENTES
    filas, vistos = [], set()
    pares = ((c, it) for c in comidas for it in (c.get("items") or []) if isinstance(it, dict))
    for c, it in pares:
        nombre = str(it.get("nombre") or "")
        if palabras:
            # Busca en el alimento y en el título de la comida (sin tildes ni mayúsculas).
            if not all(p in normalizar(nombre + " " + str(c.get("titulo") or "")) for p in palabras):
                continue
        else:
            clave = normalizar(nombre).strip()
            if clave in vistos:
                continue
            vistos.add(clave)
        filas.append((c, it))
        if len(filas) >= limite:
            break

    if not filas:
        if palabras:
            print(f"No encontré nada parecido a «{texto}» en el registro.")
        else:
            print("Todavía no hay comidas en el registro.")
        return filas
    if palabras:
        print(f"Comidas anteriores con «{texto}» ({len(filas)}):")
    else:
        print(f"Los {len(filas)} alimentos más recientes del registro:")
    for c, it in filas:
        extra = " · corregida a mano" if c.get("editada") else ""
        print(f"- {formato_fecha(c.get('fecha'))} · {it.get('nombre')} · {it.get('porcion') or 's/porción'} · "
              f"{num(it.get('kcal'))} kcal · {_macros(it)}  [en «{c.get('titulo') or ''}»{extra}]")
    return filas


# ------------------------------------------------------------------ registrar

def _entero(valor, donde, campo, problemas):
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        problemas.append(f"{donde}: «{campo}» tiene que ser un número (entero, ≥ 0).")
        return None
    if valor != valor or valor in (float("inf"), float("-inf")):
        problemas.append(f"{donde}: «{campo}» no es un número válido.")
        return None
    if valor < 0:
        problemas.append(f"{donde}: «{campo}» no puede ser negativo.")
        return None
    return int(round(valor))


def _texto(valor, donde, campo, problemas, obligatorio=True):
    if valor is None and not obligatorio:
        return ""
    if not isinstance(valor, str) or (obligatorio and not valor.strip()):
        problemas.append(f"{donde}: falta «{campo}» (un texto no vacío)." if obligatorio
                         else f"{donde}: «{campo}» tiene que ser un texto.")
        return None
    return valor.strip()


def validar_estimaciones(datos):
    """Revisa la forma de estimaciones.json. → (comidas normalizadas, problemas)."""
    problemas = []
    if not isinstance(datos, dict) or not isinstance(datos.get("comidas"), list):
        return [], ["El archivo tiene que ser un objeto con la lista «comidas»: {\"comidas\": [...]}."]
    if not datos["comidas"]:
        return [], ["La lista «comidas» está vacía: no hay nada para anotar."]
    salida, grupos = [], set()
    for i, e in enumerate(datos["comidas"]):
        if not isinstance(e, dict):
            problemas.append(f"comidas[{i}]: tiene que ser un objeto.")
            continue
        grupo = e.get("grupo")
        donde = f"comidas[{i}] ({grupo})" if isinstance(grupo, str) and grupo else f"comidas[{i}]"
        if not isinstance(grupo, str) or not grupo.strip():
            problemas.append(f"{donde}: falta «grupo».")
        elif grupo in grupos:
            problemas.append(f"{donde}: el grupo está repetido; va una sola comida por grupo.")
        else:
            grupos.add(grupo)
        tipo = e.get("tipo")
        if tipo not in TIPOS:
            problemas.append(f"{donde}: «tipo» tiene que ser uno de: {', '.join(TIPOS)} (vino {tipo!r}).")
        titulo = _texto(e.get("titulo"), donde, "titulo", problemas)
        confianza = e.get("confianza")
        if confianza not in CONFIANZAS:
            problemas.append(f"{donde}: «confianza» tiene que ser alta, media o baja (vino {confianza!r}).")
        comentario = _texto(e.get("comentario"), donde, "comentario", problemas, obligatorio=False)
        items_in = e.get("items")
        items = []
        if not isinstance(items_in, list) or not items_in:
            problemas.append(f"{donde}: «items» tiene que ser una lista con al menos un alimento.")
        else:
            for j, it in enumerate(items_in):
                dit = f"{donde} items[{j}]"
                if not isinstance(it, dict):
                    problemas.append(f"{dit}: tiene que ser un objeto.")
                    continue
                nuevo = dict(it)
                nuevo["nombre"] = _texto(it.get("nombre"), dit, "nombre", problemas)
                nuevo["porcion"] = _texto(it.get("porcion"), dit, "porcion", problemas)
                for m in MACROS:
                    nuevo[m] = _entero(it.get(m), dit, m, problemas)
                items.append(nuevo)
        salida.append({"grupo": grupo, "tipo": tipo, "titulo": titulo, "items": items,
                       "confianza": confianza, "comentario": comentario})
    return salida, problemas


def registrar(alm, ruta):
    ruta = Path(ruta)
    if not ruta.is_absolute() and not ruta.exists() and (config.APP / ruta).exists():
        ruta = config.APP / ruta   # corrido desde otra carpeta
    datos = leer_json_local(ruta, "Las estimaciones")
    estimaciones, problemas = validar_estimaciones(datos)

    # Lo que hay hoy en el Drive: capturas pendientes y comidas a revisar.
    capturas = {c["grupo"]: c for c in agrupar(alm.piezas_pendientes())}
    registro = alm.leer_registro()
    existentes = {str(c.get("id")): c for c in registro["comidas"] if isinstance(c, dict) and c.get("id")}
    vistos = _ids_vistos()

    planes = []
    for e in estimaciones:
        g = e["grupo"]
        if not isinstance(g, str) or not g:
            continue
        if g in capturas:
            cap = capturas[g]
            nuevas = [p["id"] for p in cap["piezas"] if p["id"] not in vistos.get(g, set())]
            if g in vistos and nuevas:
                problemas.append(f"{g}: llegaron piezas nuevas a esta captura después de correr pendientes. "
                                 "Corré python qc.py pendientes de nuevo y mirála otra vez.")
            if g in existentes:
                # Pieza que llegó tarde a una comida ya registrada: se reemplaza la comida entera
                # (todas sus piezas, misma fecha y hora), como una revisión. Nunca solo la pieza nueva.
                planes.append(("revision", e, cap))
            else:
                planes.append(("captura", e, cap))
        elif g in existentes and existentes[g].get("revisar"):
            planes.append(("revision", e, None))
        elif g in existentes:
            problemas.append(f"{g}: esa comida ya está en el registro y no tiene pedido de revisión.")
        else:
            problemas.append(f"{g}: no hay ninguna captura pendiente ni comida a revisar con ese grupo "
                             "(¿ya se procesó o se descartó?). Mirá python qc.py pendientes.")
    if problemas:
        raise ErrorValidacion(problemas)

    ahora = config.ahora_iso()
    nuevas_comidas, piezas_a_marcar = [], []
    for clase, e, cap in planes:
        g = e["grupo"]
        if clase == "captura":
            fecha, hora = fecha_hora(cap["tomada"], g)
            base = {"fotos": [p["id"] for p in cap["fotos"]], "nota": cap["nota"],
                    "fecha": fecha, "hora": hora}
            piezas_a_marcar += [p["id"] for p in cap["piezas"]]
        else:
            vieja = existentes[g]
            cap = _captura_completa(alm, g, cap["piezas"] if cap else ())
            fecha, hora = vieja.get("fecha"), vieja.get("hora")
            if not fecha or not hora:
                fecha, hora = fecha_hora(cap["tomada"] if cap else None, g)
            base = {"fotos": [p["id"] for p in cap["fotos"]] if cap else list(vieja.get("fotos") or []),
                    "nota": cap["nota"] if cap and cap["nota"] else (vieja.get("nota") or ""),
                    "fecha": fecha, "hora": hora}
            if cap:
                piezas_a_marcar += [p["id"] for p in cap["piezas"] if props(p).get("estado") != "procesada"]
        totales = {m: sum(it[m] for it in e["items"]) for m in MACROS}
        nuevas_comidas.append({
            "id": g, "fecha": base["fecha"], "hora": base["hora"], "tipo": e["tipo"], "titulo": e["titulo"],
            "fotos": base["fotos"], "nota": base["nota"], "items": e["items"], **totales,
            "confianza": e["confianza"], "comentario": e["comentario"], "procesada": ahora,
            "editada": False, "revisar": None,
        })

    def aplicar(reg):
        por_id = {c["id"]: c for c in nuevas_comidas}
        quedan = []
        for c in reg["comidas"]:
            if isinstance(c, dict) and str(c.get("id")) in por_id:
                nueva = por_id.pop(str(c.get("id")))
                quedan.append({**c, **nueva})   # conserva los campos que no conocemos
            else:
                quedan.append(c)
        quedan += por_id.values()
        quedan.sort(key=lambda c: (str(c.get("fecha") or ""), str(c.get("hora") or ""))
                    if isinstance(c, dict) else ("", ""))
        reg["comidas"] = quedan
        return reg

    nuevo_registro = alm.actualizar_registro(aplicar)

    fallidas = []
    for pid in piezas_a_marcar:
        try:
            alm.marcar(pid, "procesada")
        except Exception as ex:   # el registro ya está escrito: se avisa y se sigue
            fallidas.append((pid, ex))

    _despues_de_registrar([c["id"] for c in nuevas_comidas])

    print(f"Anoté {len(nuevas_comidas)} comida{'s' if len(nuevas_comidas) != 1 else ''}:")
    for c in sorted(nuevas_comidas, key=lambda c: (c["fecha"] or "", c["hora"] or "")):
        print(f"  {formato_fecha(c['fecha'])} {c['hora']} · {c['titulo']} · {num(c['kcal'])} kcal "
              f"(confianza {c['confianza']})")
    if fallidas:
        print(f"Ojo: no pude marcar {len(fallidas)} pieza(s) como procesadas ({fallidas[0][1]}). "
              "Van a volver a aparecer en pendientes; registrarlas de nuevo reemplaza la comida, no la duplica.")
    print()
    perfil, peso, _ = _contexto_meta(alm, config.hoy())
    for fecha in sorted({c["fecha"] for c in nuevas_comidas if c["fecha"]}):
        d = a_fecha(fecha)
        _linea_dia(nuevo_registro, d, perfil, peso)
    return nuevas_comidas


def _ids_vistos():
    """grupo → ids de piezas que vio `pendientes` (de data/pendientes.json), si existe."""
    try:
        datos = json.loads(config.pendientes_json().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    vistos = {}
    for c in datos.get("capturas", []) if isinstance(datos, dict) else []:
        if isinstance(c, dict) and c.get("grupo"):
            vistos[c["grupo"]] = set(c.get("ids") or [])
    return vistos


def _despues_de_registrar(grupos):
    """Borra las carpetas locales de lo registrado y lo saca de data/pendientes.json."""
    hechos = set(grupos)
    for g in hechos:
        shutil.rmtree(carpeta_captura(g), ignore_errors=True)
        shutil.rmtree(carpeta_revision(g), ignore_errors=True)
    ruta = config.pendientes_json()
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if isinstance(datos, dict):
        datos["capturas"] = [c for c in datos.get("capturas", []) if c.get("grupo") not in hechos]
        datos["revisar"] = [r for r in datos.get("revisar", []) if r.get("id") not in hechos]
        escribir_json(ruta, datos)


def _linea_dia(registro, fecha, perfil, peso):
    r = resumen_dia(registro, fecha)
    meta = meta_kcal(perfil, peso_actual(peso["registros"], fecha), fecha)
    if meta is None:
        print(f"{formato_fecha(fecha)}: {num(r['kcal'])} kcal en {len(r['comidas'])} comidas (sin meta).")
    else:
        print(f"{formato_fecha(fecha)}: {num(r['kcal'])} de {num(meta)} kcal · {frase_meta(r['kcal'], meta)}.")


# ------------------------------------------------------------------ resumen

def resumen(alm, fecha=None):
    fecha = fecha or config.hoy()
    registro = alm.leer_registro()
    perfil, peso, kg = _contexto_meta(alm, fecha)
    dia = resumen_dia(registro, fecha)
    meta = meta_kcal(perfil, kg, fecha)
    meta_p = meta_proteina(perfil, kg)

    print(f"{formato_fecha(fecha)}/{fecha.year}")
    if not dia["comidas"]:
        print("  Sin comidas registradas.")
    for c in dia["comidas"]:
        extra = []
        if c.get("confianza"):
            extra.append(f"confianza {c['confianza']}")
        if c.get("editada"):
            extra.append("corregida a mano")
        if c.get("revisar"):
            extra.append("a revisar")
        print(f"  {c.get('hora') or '--:--'}  {c.get('tipo') or '':<9} {c.get('titulo') or 'sin título'} · "
              f"{num(c.get('kcal'))} kcal · {_macros(c)}" + (f"  ({', '.join(extra)})" if extra else ""))
    print(f"  Total: {num(dia['kcal'])} kcal · proteína {num(dia['proteina_g'])} g · "
          f"carbos {num(dia['carbos_g'])} g · grasa {num(dia['grasa_g'])} g")
    if meta is not None:
        linea = f"  Meta: {num(meta)} kcal · {frase_meta(dia['kcal'], meta)}"
        if meta_p is not None:
            linea += f" · proteína {num(dia['proteina_g'])} de {num(meta_p)} g"
        print(linea)
    elif perfil is None:
        print("  Sin perfil cargado: no hay meta.")
    else:
        print("  Falta el peso o algún dato del perfil para calcular la meta.")

    pend = [c for c in agrupar(alm.piezas_pendientes())
            if fecha_hora(c["tomada"], c["grupo"])[0] == fecha.isoformat()]
    if pend:
        print(f"  Pendientes de procesar ese día: {len(pend)} captura{'s' if len(pend) != 1 else ''}.")

    lunes = lunes_de(fecha)
    semana = resumen_semana(registro, lunes)
    print()
    print(f"Semana del {formato_fecha(lunes)} al {formato_fecha(lunes + timedelta(days=6))}")
    dentro = 0
    for i, d in enumerate(semana["dias"]):
        f = lunes + timedelta(days=i)
        meta_d = meta_kcal(perfil, peso_actual(peso["registros"], f), f)
        if not d["comidas"]:
            print(f"  {formato_fecha(f)}  {'—':>7}")
            continue
        texto = f"  {formato_fecha(f)}  {num(d['kcal']):>7} kcal"
        if meta_d is not None:
            dif = d["kcal"] - meta_d
            texto += f"  ({'+' if dif > 0 else '−' if dif < 0 else '±'}{num(abs(dif))} contra la meta)"
            dentro += dif <= 0
        print(texto)
    if semana["promedioKcal"] is None:
        print("  Sin comidas registradas esta semana.")
    else:
        linea = (f"  Promedio: {num(semana['promedioKcal'])} kcal por día "
                 f"({semana['diasConComidas']} día{'s' if semana['diasConComidas'] != 1 else ''} con comidas)")
        if meta is not None:
            linea += f" · dentro de la meta: {dentro} de {semana['diasConComidas']}"
        print(linea)
    return {"dia": dia, "meta_kcal": meta, "semana": semana}
