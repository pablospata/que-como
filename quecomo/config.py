"""Rutas de la app y de los secretos, y la zona horaria.

    APP        la carpeta del proyecto (donde está qc.py)
    DATA       data/ (local, fuera de git): fotos bajadas, pendientes.json, estimaciones.json
    SECRETOS   ~/.config/que-como/ (o $QUECOMO_DIR): client.json (opcional) y token.json
    TZ         Argentina, -03:00 (sin horario de verano)
"""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
DATA = APP / "data"
SECRETOS = Path(os.environ.get("QUECOMO_DIR") or (Path.home() / ".config" / "que-como"))
CLIENTE_GTASKS = Path.home() / ".config" / "gtasks-mcp" / "client.json"

TZ = timezone(timedelta(hours=-3))


def ahora():
    """La hora actual en Argentina, con zona."""
    return datetime.now(TZ)


def ahora_iso():
    return ahora().isoformat(timespec="seconds")


def hoy():
    return ahora().date()


def pendientes_dir():
    return DATA / "pendientes"


def pendientes_json():
    return DATA / "pendientes.json"
