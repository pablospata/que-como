"""Errores esperables: qc.py los muestra tal cual (en español) y sale con código 1, sin traceback."""

MSG_VENCIDO = "Se venció el permiso del Drive (pasa cada 7 días). Corré: python qc.py auth"
MSG_SIN_LOGIN = "El Drive no está conectado. Corré: python qc.py auth"
MSG_SIN_CONEXION = "No pude conectar con Google: ¿hay internet? Probá de nuevo en un rato."


class ErrorQC(Exception):
    codigo = "error"

    def __init__(self, mensaje=None):
        super().__init__(mensaje or self.mensaje_por_defecto())

    def mensaje_por_defecto(self):
        return "Algo salió mal."


class SinCliente(ErrorQC):
    codigo = "sin_cliente"


class SinLogin(ErrorQC):
    codigo = "sin_login"

    def mensaje_por_defecto(self):
        return MSG_SIN_LOGIN


class Vencido(ErrorQC):
    codigo = "vencido"

    def mensaje_por_defecto(self):
        return MSG_VENCIDO


class SinConexion(ErrorQC):
    codigo = "sin_conexion"

    def mensaje_por_defecto(self):
        return MSG_SIN_CONEXION


class ErrorDrive(ErrorQC):
    """Google o Drive respondieron, pero con un error."""
    codigo = "drive"


class ErrorValidacion(ErrorQC):
    """Las estimaciones no cierran: `problemas` es la lista de lo que hay que arreglar."""
    codigo = "validacion"

    def __init__(self, problemas):
        self.problemas = list(problemas)
        super().__init__("Las estimaciones tienen problemas; no anoté nada:\n"
                         + "\n".join(f"  - {p}" for p in self.problemas))


class ErrorLocal(ErrorQC):
    """Un problema con un archivo local (falta, no se puede leer, JSON roto)."""
    codigo = "local"
