// Imágenes de la captura: compresión a JPEG (lado mayor 1600 px, calidad 0,82, sin EXIF)
// y lectura de la fecha EXIF (DateTimeOriginal) de un JPEG.
// fechaExif() es una función pura (sirve en Node para las pruebas).

export const LADO_MAXIMO = 1600;
export const CALIDAD = 0.82;

function errorImagen(mensaje) {
  const e = new Error(mensaje);
  e.codigo = "imagen";
  return e;
}

// ---------------------------------------------------------------- compresión

/** Decodifica respetando la orientación EXIF. → {fuente, ancho, alto, cerrar()} */
async function decodificar(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { fuente: bmp, ancho: bmp.width, alto: bmp.height, cerrar: () => bmp.close?.() };
    } catch {
      // algunos navegadores no aceptan la opción o el formato: probamos con <img>
    }
  }
  if (typeof Image !== "function") throw errorImagen("No pude leer esa foto.");
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await (img.decode ? img.decode() : new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    }));
    // <img> ya aplica la orientación EXIF (image-orientation: from-image por defecto)
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw errorImagen("No pude leer esa foto (¿es un formato raro?).");
  }
}

/** Medidas finales para que el lado mayor no pase de `lado` (nunca agranda). */
export function medidas(ancho, alto, lado = LADO_MAXIMO) {
  const escala = Math.min(1, lado / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Blob/File de imagen → Blob JPEG comprimido (sin EXIF: el canvas no lo copia). */
export async function comprimir(blob, { lado = LADO_MAXIMO, calidad = CALIDAD } = {}) {
  const img = await decodificar(blob);
  try {
    if (!img.ancho || !img.alto) throw errorImagen("No pude leer esa foto.");
    const { ancho, alto } = medidas(img.ancho, img.alto, lado);
    let lienzo;
    let salida;
    if (typeof OffscreenCanvas === "function") {
      lienzo = new OffscreenCanvas(ancho, alto);
    } else {
      lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;
    }
    const c = lienzo.getContext("2d");
    if (!c) throw errorImagen("No pude preparar la foto.");
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    // fondo blanco por si la imagen trae transparencia (el JPEG no la tiene)
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, ancho, alto);
    c.drawImage(img.fuente, 0, 0, ancho, alto);
    if (lienzo.convertToBlob) {
      salida = await lienzo.convertToBlob({ type: "image/jpeg", quality: calidad });
    } else {
      salida = await new Promise((res) => lienzo.toBlob(res, "image/jpeg", calidad));
    }
    if (!salida || salida.type !== "image/jpeg") throw errorImagen("No pude comprimir la foto.");
    return salida;
  } finally {
    img.cerrar();
  }
}

// ---------------------------------------------------------------- fecha EXIF

const TAG_EXIF_IFD = 0x8769;
const TAG_FECHA = 0x0132;            // DateTime (IFD0)
const TAG_FECHA_ORIGINAL = 0x9003;   // DateTimeOriginal
const TAG_FECHA_DIGITAL = 0x9004;    // DateTimeDigitized
const TAG_ZONA_ORIGINAL = 0x9011;    // OffsetTimeOriginal ("-03:00")
const TAG_ZONA_DIGITAL = 0x9012;     // OffsetTimeDigitized
const TAG_ZONA = 0x9010;             // OffsetTime

function aBytes(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return null;
}

/** Busca el bloque TIFF del EXIF dentro de un JPEG. → {inicio, fin} o null */
function bloqueExifJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marca = b[p + 1];
    if (marca === 0xff) { p++; continue; }                       // relleno
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { p += 2; continue; }
    if (marca === 0xda || marca === 0xd9) return null;            // empiezan los datos: no hay EXIF
    const largo = (b[p + 2] << 8) | b[p + 3];
    if (largo < 2) return null;
    if (marca === 0xe1 && largo >= 8 && p + 10 <= b.length &&
        b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 &&
        b[p + 8] === 0 && b[p + 9] === 0) {
      return { inicio: p + 10, fin: Math.min(b.length, p + 2 + largo) };
    }
    p += 2 + largo;
  }
  return null;
}

/** Lee las etiquetas que nos importan de un bloque TIFF. → {tag: texto} */
function etiquetasTiff(b, inicio, fin) {
  const dv = new DataView(b.buffer, b.byteOffset + inicio, fin - inicio);
  const n = dv.byteLength;
  if (n < 8) return null;
  const orden = dv.getUint16(0, false);
  let le;
  if (orden === 0x4949) le = true;
  else if (orden === 0x4d4d) le = false;
  else return null;
  if (dv.getUint16(2, le) !== 42) return null;

  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const encontradas = {};

  const leerIfd = (desde, buscadas) => {
    if (desde < 8 || desde + 2 > n) return {};
    const cantidad = u16(desde);
    const res = {};
    for (let i = 0; i < cantidad; i++) {
      const e = desde + 2 + i * 12;
      if (e + 12 > n) break;
      const tag = u16(e);
      if (!buscadas.includes(tag)) continue;
      const tipo = u16(e + 2);
      const cuenta = u32(e + 4);
      if (tipo === 4 || tipo === 13) {                            // LONG / IFD: un puntero
        res[tag] = u32(e + 8);
      } else if (tipo === 2) {                                    // ASCII
        const lugar = cuenta <= 4 ? e + 8 : u32(e + 8);
        if (lugar + cuenta > n) continue;
        let s = "";
        for (let k = 0; k < cuenta; k++) {
          const c = dv.getUint8(lugar + k);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        res[tag] = s;
      }
    }
    return res;
  };

  const ifd0 = leerIfd(u32(4), [TAG_EXIF_IFD, TAG_FECHA, TAG_ZONA]);
  if (ifd0[TAG_FECHA]) encontradas[TAG_FECHA] = ifd0[TAG_FECHA];
  if (ifd0[TAG_ZONA]) encontradas[TAG_ZONA] = ifd0[TAG_ZONA];
  if (typeof ifd0[TAG_EXIF_IFD] === "number") {
    const exif = leerIfd(ifd0[TAG_EXIF_IFD], [TAG_FECHA_ORIGINAL, TAG_FECHA_DIGITAL,
      TAG_ZONA_ORIGINAL, TAG_ZONA_DIGITAL, TAG_ZONA]);
    Object.assign(encontradas, exif);
  }
  return encontradas;
}

/** "2026:10:22 13:40:12" (+ zona opcional "-03:00") → Date o null. */
export function parsearFechaExif(texto, zona = null) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((texto || "").trim());
  if (!m) return null;
  const [a, me, d, h, mi, s] = m.slice(1).map(Number);
  if (a < 1990 || me < 1 || me > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const z = /^([+-])(\d{2}):?(\d{2})$/.exec((zona || "").trim());
  let fecha;
  if (z) {
    const minutos = (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3]));
    fecha = new Date(Date.UTC(a, me - 1, d, h, mi, s) - minutos * 60000);
  } else {
    fecha = new Date(a, me - 1, d, h, mi, s);  // sin zona: hora local del aparato
  }
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Fecha en que se sacó la foto según el EXIF: DateTimeOriginal (o, si falta, DateTimeDigitized
 * o DateTime). Acepta un JPEG o un bloque TIFF suelto (ArrayBuffer, Uint8Array o Buffer).
 * → Date o null.
 */
export function fechaExif(buffer) {
  try {
    const b = aBytes(buffer);
    if (!b) return null;
    let inicio = 0;
    let fin = b.length;
    if (b[0] === 0xff && b[1] === 0xd8) {
      const bloque = bloqueExifJpeg(b);
      if (!bloque) return null;
      ({ inicio, fin } = bloque);
    }
    const t = etiquetasTiff(b, inicio, fin);
    if (!t) return null;
    return parsearFechaExif(t[TAG_FECHA_ORIGINAL], t[TAG_ZONA_ORIGINAL] || t[TAG_ZONA]) ||
      parsearFechaExif(t[TAG_FECHA_DIGITAL], t[TAG_ZONA_DIGITAL] || t[TAG_ZONA]) ||
      parsearFechaExif(t[TAG_FECHA], t[TAG_ZONA]);
  } catch {
    return null;
  }
}

/** Fecha de una foto elegida de la galería: EXIF si tiene, si no lastModified (o ahora). */
export async function fechaDeArchivo(archivo) {
  try {
    const cabeza = await archivo.slice(0, 256 * 1024).arrayBuffer();
    const f = fechaExif(cabeza);
    if (f) return f;
  } catch {
    // sin EXIF legible: seguimos con lastModified
  }
  return archivo.lastModified ? new Date(archivo.lastModified) : new Date();
}
