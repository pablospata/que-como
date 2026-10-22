// Elige la implementación de datos: demo.js (con ?demo o sin CLIENT_ID) o drive.js.
// Las dos exportan la misma API (ver "Datos" en CONTRATO.md).
import { CLIENT_ID } from "../config.js";

let elegida = null;

export function esDemo() {
  const p = new URLSearchParams(location.search);
  return p.has("demo") || !CLIENT_ID;
}

export async function obtenerDatos() {
  if (!elegida) elegida = esDemo() ? await import("./demo.js") : await import("./drive.js");
  return elegida;
}

/** Error con código para la API de datos (lo usan drive.js y demo.js). */
export function errorDatos(codigo, mensaje) {
  const e = new Error(mensaje);
  e.codigo = codigo;
  return e;
}
