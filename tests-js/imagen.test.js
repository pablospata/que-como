// Pruebas de imagen.js: fecha EXIF con JPEG/TIFF armados a mano (los dos órdenes de bytes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fechaExif, parsearFechaExif, medidas } from "../docs/js/imagen.js";

/**
 * Arma un bloque TIFF: IFD0 con (opcional) DateTime y el puntero al IFD EXIF; el IFD EXIF con
 * las etiquetas pedidas (ASCII). `le` = little endian ("II").
 */
function tiff({ le, original, digital, ifd0Fecha, zonaOriginal }) {
  const ascii = (s) => Buffer.from(s + "\0", "latin1");
  const ifd0 = [];
  const exif = [];
  if (ifd0Fecha) ifd0.push([0x0132, ascii(ifd0Fecha)]);
  if (original) exif.push([0x9003, ascii(original)]);
  if (digital) exif.push([0x9004, ascii(digital)]);
  if (zonaOriginal) exif.push([0x9011, ascii(zonaOriginal)]);
  const conExif = exif.length > 0;

  const tamIfd = (k) => 2 + k * 12 + 4;
  const n0 = ifd0.length + (conExif ? 1 : 0);
  const inicioIfd0 = 8;
  const inicioExif = inicioIfd0 + tamIfd(n0);
  let datos = inicioExif + (conExif ? tamIfd(exif.length) : 0);

  const partes = [];
  const total = () => datos;
  const buf = Buffer.alloc(4096);
  const w16 = (o, v) => (le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o));
  const w32 = (o, v) => (le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o));

  buf.write(le ? "II" : "MM", 0, "latin1");
  w16(2, 42);
  w32(4, inicioIfd0);

  const escribirIfd = (inicio, entradas, punteroExif) => {
    const todas = [...entradas];
    if (punteroExif != null) todas.push([0x8769, punteroExif]);
    todas.sort((a, b) => a[0] - b[0]);
    w16(inicio, todas.length);
    todas.forEach(([tag, valor], i) => {
      const e = inicio + 2 + i * 12;
      w16(e, tag);
      if (typeof valor === "number") {
        w16(e + 2, 4);
        w32(e + 4, 1);
        w32(e + 8, valor);
      } else {
        w16(e + 2, 2);
        w32(e + 4, valor.length);
        if (valor.length <= 4) valor.copy(buf, e + 8);
        else {
          w32(e + 8, datos);
          valor.copy(buf, datos);
          partes.push(valor);
          datos += valor.length + (valor.length % 2);
        }
      }
    });
    w32(inicio + 2 + todas.length * 12, 0);
  };

  escribirIfd(inicioIfd0, ifd0, conExif ? inicioExif : null);
  if (conExif) escribirIfd(inicioExif, exif, null);
  return buf.subarray(0, total());
}

function segmento(marca, contenido) {
  const cab = Buffer.alloc(4);
  cab[0] = 0xff;
  cab[1] = marca;
  cab.writeUInt16BE(contenido.length + 2, 2);
  return Buffer.concat([cab, contenido]);
}

/** JPEG mínimo: SOI, APP0 JFIF, APP1 Exif, un DQT de relleno, SOS, EOI. */
function jpeg(bloqueTiff, { conApp0 = true } = {}) {
  const partes = [Buffer.from([0xff, 0xd8])];
  if (conApp0) partes.push(segmento(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")));
  if (bloqueTiff) partes.push(segmento(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), bloqueTiff])));
  partes.push(segmento(0xdb, Buffer.alloc(65)));
  partes.push(segmento(0xda, Buffer.alloc(10)), Buffer.from([0x12, 0x34, 0xff, 0xd9]));
  return Buffer.concat(partes);
}

const local = (a, m, d, h, mi, s) => new Date(a, m - 1, d, h, mi, s).getTime();

for (const le of [true, false]) {
  const orden = le ? "II (little endian)" : "MM (big endian)";

  test(`DateTimeOriginal en JPEG, ${orden}`, () => {
    const b = jpeg(tiff({ le, original: "2026:10:22 13:40:12" }));
    const f = fechaExif(b);
    assert.ok(f instanceof Date);
    assert.equal(f.getTime(), local(2026, 10, 22, 13, 40, 12));
  });

  test(`TIFF suelto y ArrayBuffer, ${orden}`, () => {
    const t = tiff({ le, original: "2025:01:02 03:04:05" });
    const ab = t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength);
    assert.equal(fechaExif(ab).getTime(), local(2025, 1, 2, 3, 4, 5));
    assert.equal(fechaExif(new Uint8Array(ab)).getTime(), local(2025, 1, 2, 3, 4, 5));
  });

  test(`prefiere DateTimeOriginal sobre DateTime, ${orden}`, () => {
    const b = jpeg(tiff({ le, original: "2026:10:22 08:00:00", ifd0Fecha: "2026:10:23 09:00:00" }));
    assert.equal(fechaExif(b).getTime(), local(2026, 10, 22, 8, 0, 0));
  });

  test(`sin original usa DateTimeDigitized y después DateTime, ${orden}`, () => {
    assert.equal(fechaExif(jpeg(tiff({ le, digital: "2026:10:21 21:30:00" }))).getTime(),
      local(2026, 10, 21, 21, 30, 0));
    assert.equal(fechaExif(jpeg(tiff({ le, ifd0Fecha: "2026:10:20 12:00:00" }))).getTime(),
      local(2026, 10, 20, 12, 0, 0));
  });

  test(`con OffsetTimeOriginal da el instante exacto, ${orden}`, () => {
    const b = jpeg(tiff({ le, original: "2026:10:22 13:40:12", zonaOriginal: "-03:00" }));
    assert.equal(fechaExif(b).toISOString(), "2026-10-22T16:40:12.000Z");
  });

  test(`fecha vacía o en ceros → null, ${orden}`, () => {
    assert.equal(fechaExif(jpeg(tiff({ le, original: "0000:00:00 00:00:00" }))), null);
    assert.equal(fechaExif(jpeg(tiff({ le, original: "                   " }))), null);
  });
}

test("JPEG sin EXIF → null", () => {
  assert.equal(fechaExif(jpeg(null)), null);
});

test("datos que no son imagen o están cortados → null, sin tirar", () => {
  assert.equal(fechaExif(Buffer.from("hola, no soy un jpeg")), null);
  assert.equal(fechaExif(new ArrayBuffer(0)), null);
  assert.equal(fechaExif(null), null);
  const b = jpeg(tiff({ le: true, original: "2026:10:22 13:40:12" }));
  for (const corte of [3, 10, 20, 40, 60, 80]) {
    assert.doesNotThrow(() => fechaExif(b.subarray(0, corte)));
  }
});

test("parsearFechaExif valida", () => {
  assert.equal(parsearFechaExif("2026:13:01 10:00:00"), null);
  assert.equal(parsearFechaExif(""), null);
  assert.equal(parsearFechaExif(undefined), null);
  assert.equal(parsearFechaExif("2026:10:22 13:40:12", "+00:00").toISOString(), "2026-10-22T13:40:12.000Z");
});

test("medidas: lado mayor 1600, nunca agranda", () => {
  assert.deepEqual(medidas(4000, 3000), { ancho: 1600, alto: 1200 });
  assert.deepEqual(medidas(3000, 4000), { ancho: 1200, alto: 1600 });
  assert.deepEqual(medidas(800, 600), { ancho: 800, alto: 600 });
});
