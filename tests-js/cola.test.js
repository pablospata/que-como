// Pruebas de la lógica de cola.js con un almacén en memoria y unos datos falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCola, almacenEnMemoria } from "../docs/js/cola.js";

function errorCodigo(codigo) {
  const e = new Error("falló: " + codigo);
  e.codigo = codigo;
  return e;
}

/** Datos falsos: registra llamadas; `fallas` es una lista de códigos a tirar en orden. */
function datosFalsos({ fallas = [], conectado = true, demora = 0 } = {}) {
  const llamadas = [];
  let n = 0;
  const paso = async (que, args) => {
    llamadas.push([que, ...args]);
    if (demora) await new Promise((r) => setTimeout(r, demora));
    const f = fallas.shift();
    if (f) throw errorCodigo(f);
    return { id: `id-${++n}` };
  };
  return {
    llamadas,
    estado: () => ({ conectado, email: null, demo: false }),
    subirFoto: (blob, meta) => paso("foto", [meta]),
    crearTexto: (texto, meta) => paso("texto", [texto, meta]),
    cambiarNota: (grupo, nota) => paso("nota", [grupo, nota]),
  };
}

function nuevaCola(opciones = {}) {
  const avisos = [];
  const cola = crearCola({ abrirAlmacen: async () => almacenEnMemoria(), avisar: (d) => avisos.push(d), ...opciones });
  return { cola, avisos };
}

const foto = (grupo, nota = "") => ({ tipo: "foto", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
  grupo, tomada: "2026-10-22T13:40:12-03:00", nota });

test("encola fotos y textos, guarda bytes y cuenta solo capturas", async () => {
  const { cola, avisos } = nuevaCola();
  await cola.encolar(foto("g1"));
  await cola.encolar({ tipo: "texto", texto: "2 alfajores", grupo: "g2", tomada: "2026-10-22T16:00:00-03:00" });
  await cola.encolar({ tipo: "nota", grupo: "g0", nota: "x" });
  const lista = await cola.listar();
  assert.equal(lista.length, 3);
  assert.ok(lista[0].bytes instanceof ArrayBuffer);
  assert.equal(lista[0].mime, "image/jpeg");
  assert.equal(lista[0].blob, undefined);
  assert.equal(await cola.contar(), 2);
  assert.equal(avisos.filter((a) => a.evento === "encolada").length, 3);
});

test("vaciar sube en orden, borra lo subido y devuelve cuántas", async () => {
  const { cola, avisos } = nuevaCola();
  await cola.encolar(foto("g1", "con mayonesa"));
  await cola.encolar(foto("g1", "con mayonesa"));
  await cola.encolar({ tipo: "texto", texto: "un mate", grupo: "g2", tomada: "t" });
  const datos = datosFalsos();
  const r = await cola.vaciar(datos);
  assert.deepEqual(r, { subidas: 3, quedan: 0, detenida: null, error: null });
  assert.deepEqual(datos.llamadas.map((l) => l[0]), ["foto", "foto", "texto"]);
  assert.equal(datos.llamadas[0][1].nota, "con mayonesa");
  assert.equal(datos.llamadas[2][1], "un mate");
  assert.equal(await cola.contar(), 0);
  assert.equal(avisos.filter((a) => a.evento === "subida").length, 3);
});

for (const codigo of ["sin_login", "sin_conexion"]) {
  test(`se corta ante ${codigo} y deja todo en la cola`, async () => {
    const { cola, avisos } = nuevaCola();
    await cola.encolar(foto("g1"));
    await cola.encolar(foto("g1"));
    const datos = datosFalsos({ fallas: [codigo] });
    const r = await cola.vaciar(datos);
    assert.equal(r.subidas, 0);
    assert.equal(r.quedan, 2);
    assert.equal(r.detenida, codigo);
    assert.equal(r.error.codigo, codigo);
    assert.equal(datos.llamadas.length, 1, "no intenta la segunda");
    assert.ok(avisos.some((a) => a.evento === "en_cola" && a.motivo === codigo));
    // al volver, sube todo
    const r2 = await cola.vaciar(datosFalsos());
    assert.equal(r2.subidas, 2);
    assert.equal(r2.quedan, 0);
  });
}

test("sin conexión o sin login ni lo intenta", async () => {
  const { cola } = nuevaCola({ enLinea: () => false });
  await cola.encolar(foto("g1"));
  const datos = datosFalsos();
  const r = await cola.vaciar(datos);
  assert.equal(r.detenida, "sin_conexion");
  assert.equal(datos.llamadas.length, 0);

  const otra = nuevaCola().cola;
  await otra.encolar(foto("g1"));
  const desconectado = datosFalsos({ conectado: false });
  const r2 = await otra.vaciar(desconectado);
  assert.equal(r2.detenida, "sin_login");
  assert.equal(r2.quedan, 1);
  assert.equal(desconectado.llamadas.length, 0);
});

test("un error de Drive deja esa pieza y sigue con las demás", async () => {
  const { cola } = nuevaCola();
  await cola.encolar(foto("g1"));
  await cola.encolar(foto("g2"));
  const datos = datosFalsos({ fallas: ["drive"] });
  const r = await cola.vaciar(datos);
  assert.equal(r.subidas, 1);
  assert.equal(r.quedan, 1);
  assert.equal(r.detenida, null);
  assert.equal(r.error.codigo, "drive");
  const [queda] = await cola.listar();
  assert.equal(queda.grupo, "g1");
  assert.equal(queda.intentos, 1);
  assert.equal(datos.llamadas.length, 2, "un solo intento por corrida");
});

test("una sola corrida a la vez: llamadas simultáneas comparten la promesa", async () => {
  const { cola } = nuevaCola();
  await cola.encolar(foto("g1"));
  await cola.encolar(foto("g1"));
  const datos = datosFalsos({ demora: 20 });
  const p1 = cola.vaciar(datos);
  const p2 = cola.vaciar(datos);
  assert.equal(p1, p2);
  assert.equal(cola.ocupada(), true);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, r2);
  assert.equal(r1.subidas, 2);
  assert.equal(datos.llamadas.length, 2, "cada foto se sube una sola vez");
  assert.equal(cola.ocupada(), false);
});

test("lo que se encola durante una corrida también sube", async () => {
  const { cola } = nuevaCola();
  await cola.encolar(foto("g1"));
  const datos = datosFalsos({ demora: 20 });
  const p = cola.vaciar(datos);
  await new Promise((r) => setTimeout(r, 5));
  await cola.encolar(foto("g1"));
  const p2 = cola.vaciar(datos);
  assert.equal(p, p2);
  const r = await p;
  assert.equal(r.subidas, 2);
  assert.equal(r.quedan, 0);
});

test("actualizarNota cambia las fotos en cola del grupo", async () => {
  const { cola } = nuevaCola();
  await cola.encolar(foto("g1", "vieja"));
  await cola.encolar(foto("g2", "otra"));
  assert.equal(await cola.actualizarNota("g1", "nueva"), 1);
  const datos = datosFalsos();
  await cola.vaciar(datos);
  assert.equal(datos.llamadas[0][1].nota, "nueva");
  assert.equal(datos.llamadas[1][1].nota, "otra");
});

test("si la nota cambia mientras sube, después se manda cambiarNota", async () => {
  const { cola } = nuevaCola();
  await cola.encolar(foto("g1", ""));
  const datos = datosFalsos({ demora: 20 });
  const p = cola.vaciar(datos);
  await new Promise((r) => setTimeout(r, 5));
  await cola.actualizarNota("g1", "sin queso");
  const r = await p;
  assert.equal(r.quedan, 0);
  assert.deepEqual(datos.llamadas.map((l) => l[0]), ["foto", "nota"]);
  assert.deepEqual(datos.llamadas[1].slice(1), ["g1", "sin queso"]);
});

test("actualizarNota justo cuando termina la subida no vuelve a meter la foto en la cola", async () => {
  // Carrera: actualizarNota lee la cola, la subida termina y saca la foto, y recién ahí
  // actualizarNota escribe. Antes, eso volvía a meter la foto entera y se subía dos veces (_2.jpg).
  const base = almacenEnMemoria();
  let gancho = null;
  const almacen = { ...base, async todos() {
    const r = await base.todos();
    if (gancho) { const g = gancho; gancho = null; await g(); }
    return r;
  } };
  const cola = crearCola({ abrirAlmacen: async () => almacen, avisar: () => {} });
  await cola.encolar(foto("g1", "vieja"));
  let soltar;
  const subiendo = new Promise((r) => { soltar = r; });
  const llamadas = [];
  const datos = {
    estado: () => ({ conectado: true }),
    subirFoto: async (blob, meta) => { llamadas.push(meta); await subiendo; return { id: "id-1" }; },
    crearTexto: async () => ({ id: "x" }),
    cambiarNota: async (grupo, nota) => { llamadas.push({ nota: [grupo, nota] }); },
  };
  const p = cola.vaciar(datos);
  while (!llamadas.length) await new Promise((r) => setTimeout(r, 1));
  // entre la lectura de actualizarNota y su escritura, la subida termina
  gancho = async () => { soltar(); await p; };
  const n = await cola.actualizarNota("g1", "nueva");
  assert.equal(n, 0, "la foto ya no estaba: no cambió nada");
  assert.deepEqual(await cola.listar(), [], "no volvió a la cola");
  const r = await cola.vaciar(datos);
  assert.equal(r.subidas, 0);
  assert.equal(llamadas.length, 1, "la foto se subió una sola vez");
});

test("cada foto y texto lleva un id de pieza fijo; al reintentar avisa que es un reintento", async () => {
  const { cola } = nuevaCola();
  await cola.encolar(foto("g1"));
  await cola.encolar({ tipo: "texto", texto: "un mate", grupo: "g2", tomada: "t" });
  await cola.encolar({ tipo: "nota", grupo: "g0", nota: "x" });
  const [f, t, n] = await cola.listar();
  assert.match(f.pieza, /^[0-9a-z-]{20,}$/i);
  assert.match(t.pieza, /^[0-9a-z-]{20,}$/i);
  assert.notEqual(f.pieza, t.pieza);
  assert.equal(n.pieza, undefined, "las notas no llevan pieza");
  assert.ok(new TextEncoder().encode("pieza" + f.pieza).length <= 124);

  // primera vez: se corta por la señal (la subida pudo haber llegado igual al Drive)
  const d1 = datosFalsos({ fallas: ["sin_conexion"] });
  await cola.vaciar(d1);
  assert.equal(d1.llamadas[0][1].pieza, f.pieza);
  assert.equal(d1.llamadas[0][1].reintento, false);
  // la segunda vez es un reintento con la misma pieza: drive.js busca antes de crear
  const d2 = datosFalsos();
  await cola.vaciar(d2);
  assert.deepEqual(d2.llamadas.map((l) => l[0]), ["foto", "texto", "nota"]);
  assert.equal(d2.llamadas[0][1].pieza, f.pieza);
  assert.equal(d2.llamadas[0][1].reintento, true);
  assert.equal(d2.llamadas[1][2].pieza, t.pieza);
  assert.equal(d2.llamadas[1][2].reintento, false, "el texto no se había intentado");
});

test("una pieza vieja de la cola sin id de pieza recibe uno antes de subir", async () => {
  const base = almacenEnMemoria();
  await base.agregar({ tipo: "texto", texto: "viejo", grupo: "g1", tomada: "t", creada: "x", intentos: 0 });
  const cola = crearCola({ abrirAlmacen: async () => base, avisar: () => {} });
  const datos = datosFalsos();
  await cola.vaciar(datos);
  assert.match(datos.llamadas[0][2].pieza, /^[0-9a-z-]{20,}$/i);
});

test("una nota pendiente por grupo: la última reemplaza", async () => {
  const { cola } = nuevaCola();
  await cola.encolar({ tipo: "nota", grupo: "g1", nota: "a" });
  await cola.encolar({ tipo: "nota", grupo: "g1", nota: "b" });
  await cola.encolar({ tipo: "nota", grupo: "g2", nota: "c" });
  const lista = await cola.listar();
  assert.deepEqual(lista.map((i) => [i.grupo, i.nota]), [["g1", "b"], ["g2", "c"]]);
  const datos = datosFalsos();
  const r = await cola.vaciar(datos);
  assert.equal(r.subidas, 0, "las notas no cuentan como subidas");
  assert.equal(r.quedan, 0);
  assert.deepEqual(datos.llamadas, [["nota", "g1", "b"], ["nota", "g2", "c"]]);
});

test("si el almacén no abre, usa memoria", async () => {
  const cola = crearCola({ abrirAlmacen: async () => { throw new Error("sin IndexedDB"); }, avisar: () => {} });
  await cola.encolar(foto("g1"));
  assert.equal(await cola.contar(), 1);
});
