"""Qué como: procesar las fotos de comida desde la compu.

    python qc.py auth                    conecta el Drive (abre el navegador)
    python qc.py pendientes              baja lo pendiente y lo que hay que revisar, y lo lista
    python qc.py platos [texto]          comidas anteriores parecidas (para estimar parejo)
    python qc.py registrar <archivo>     anota las estimaciones en el registro y marca procesadas
    python qc.py resumen [AAAA-MM-DD]    el día (por defecto hoy) y su semana
"""
import sys
from datetime import date

from quecomo import auth, comandos
from quecomo.almacen import Almacen
from quecomo.drive import Drive
from quecomo.errores import ErrorQC

USO = """Uso: python qc.py <comando>

  auth                   conecta el Drive (abre el navegador; hay que aceptar el permiso)
  pendientes             baja las capturas pendientes y las comidas a revisar, y las lista
  platos [texto]         comidas anteriores parecidas (sin texto: los 30 alimentos más recientes)
  registrar <archivo>    anota las estimaciones (por ejemplo data/estimaciones.json)
  resumen [AAAA-MM-DD]   el día (por defecto hoy) comida por comida y su semana
  ayuda                  muestra esto"""


def _utf8():
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _almacen():
    return Almacen(Drive())


def _auth():
    auth.cmd_auth()
    try:
        raiz = _almacen().raiz()
    except ErrorQC as e:
        print(f"(No pude revisar la carpeta: {e})")
        return
    if raiz:
        print(f"La carpeta «{raiz.get('name') or 'Qué como'}» está en el Drive.")
    else:
        print("Todavía no hay carpeta «Qué como» en el Drive: la crea la página al subir la primera foto.")


def main(argv):
    _utf8()
    if not argv or argv[0] in ("ayuda", "-h", "--help", "help"):
        print(USO)
        return 0
    orden, args = argv[0], argv[1:]
    try:
        if orden == "auth" and not args:
            _auth()
        elif orden == "pendientes" and not args:
            comandos.pendientes(_almacen())
        elif orden == "platos":
            comandos.platos(_almacen(), " ".join(args))
        elif orden == "registrar" and len(args) == 1:
            comandos.registrar(_almacen(), args[0])
        elif orden == "registrar":
            print("Falta el archivo: python qc.py registrar data/estimaciones.json", file=sys.stderr)
            return 2
        elif orden == "resumen" and len(args) <= 1:
            fecha = None
            if args:
                try:
                    fecha = date.fromisoformat(args[0])
                except ValueError:
                    print(f"La fecha «{args[0]}» no se entiende: usá AAAA-MM-DD (por ejemplo 2026-10-22).",
                          file=sys.stderr)
                    return 2
            comandos.resumen(_almacen(), fecha)
        else:
            print(f"No entiendo «{' '.join(argv)}».\n\n{USO}", file=sys.stderr)
            return 2
    except ErrorQC as e:
        sys.stdout.flush()
        print(str(e), file=sys.stderr)
        return 1
    except OSError as e:   # archivos locales (data/, ~/.config/que-como)
        sys.stdout.flush()
        print(f"No pude leer o escribir un archivo en la compu: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Cancelado.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
