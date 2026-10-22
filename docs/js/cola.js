// Cola de subidas de la captura. Cada foto o texto se guarda primero en IndexedDB (base
// `quecomo`, almacén `subidas`) y después se sube con datos.subirFoto / datos.crearTexto.
// Si falla por falta de señal (sin_conexion) o de login (sin_login), queda en la cola y se
// reintenta más tarde. La lógica está separada del almacén (crearCola) para poder probarla.
//
// Elementos de la cola:
//   {clave, tipo:'foto', grupo, tomada, nota, bytes:ArrayBuffer, mime, pieza, creada, intentos}
//   {clave, tipo:'texto', grupo, tomada, texto, pieza, creada, intentos}
//   {clave, tipo:'nota', grupo, nota, creada, intentos}   // cambiarNota pendiente
// `pieza` es un id fijo de la foto o el texto (va en appProperties.pieza): si una subida llegó al
// Drive pero la respuesta se perdió, al reintentar drive.js la encuentra y no la crea de nuevo.
// `intentada` = ya se mandó al menos una vez (entonces drive.js busca antes de crear).
//
// Avisos: window recibe CustomEvent("quecomo:cola", {detail: {evento, clave, grupo, tipo, ...}})
// con evento: encolada · subiendo · subida · en_cola (se cortó por señal o login) · error · nota.

const BASE = "quecomo";
const ALMACEN = "subidas";
const VERSION = 1;
const DETIENEN = new Set(["sin_login", "sin_conexion"]);

// ---------------------------------------------------------------- almacenes

/** Almacén en memoria (pruebas, o si el navegador no deja usar IndexedDB). */
export function almacenEnMemoria() {
  const filas = new Map();
  let siguiente = 1;
  const copia = (x) => (x ? { ...x } : x);
  return {
    async agregar(item) {
      const clave = siguiente++;
      filas.set(clave, { ...item, clave });
      return clave;
    },
    async todos() {
      return [...filas.values()].sort((a, b) => a.clave - b.clave).map(copia);
    },
    async actualizar(clave, fn) {
      const fila = filas.get(clave);
      if (!fila) return null;
      const nueva = fn(copia(fila));
      if (!nueva) return null;
      filas.set(clave, { ...nueva, clave });
      return copia(nueva);
    },
    async sacar(clave) {
      const fila = filas.get(clave);
      filas.delete(clave);
      return copia(fila) || null;
    },
    async borrar(clave) {
      filas.delete(clave);
    },
  };
}

function pedido(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/** Almacén en IndexedDB. */
export async function almacenIndexedDB() {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(BASE, VERSION);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(ALMACEN)) {
        r.result.createObjectStore(ALMACEN, { keyPath: "clave", autoIncrement: true });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("IndexedDB bloqueada"));
  });
  const operar = async (modo, fn) => {
    const tx = db.transaction(ALMACEN, modo);
    const fin = new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error("transacción cancelada"));
    });
    const r = await pedido(fn(tx.objectStore(ALMACEN)));
    await fin;
    return r;
  };
  // Leer y escribir en UNA transacción: nadie puede borrar la fila entre medio.
  // fn(almacén, dar) arma los pedidos; dar(r) fija lo que devuelve al terminar.
  const leerYEscribir = (fn) => new Promise((res, rej) => {
    const tx = db.transaction(ALMACEN, "readwrite");
    let resultado = null;
    tx.oncomplete = () => res(resultado);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("transacción cancelada"));
    fn(tx.objectStore(ALMACEN), (r) => { resultado = r; });
  });
  return {
    agregar: (item) => {
      const sinClave = { ...item };
      delete sinClave.clave;
      return operar("readwrite", (s) => s.add(sinClave));
    },
    todos: async () => (await operar("readonly", (s) => s.getAll())).sort((a, b) => a.clave - b.clave),
    actualizar: (clave, fn) => leerYEscribir((s, dar) => {
      const g = s.get(clave);
      g.onsuccess = () => {
        if (!g.result) return;                  // ya no está (subió): no se vuelve a meter
        const nueva = fn({ ...g.result });
        if (!nueva) return;
        s.put({ ...nueva, clave });
        dar(nueva);
      };
    }),
    sacar: (clave) => leerYEscribir((s, dar) => {
      const g = s.get(clave);
      g.onsuccess = () => {
        if (!g.result) return;
        dar(g.result);
        s.delete(clave);
      };
    }),
    borrar: (clave) => operar("readwrite", (s) => s.delete(clave)),
  };
}

// ---------------------------------------------------------------- lógica

function avisarVentana(detalle) {
  if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent === "function") {
    globalThis.dispatchEvent(new CustomEvent("quecomo:cola", { detail: detalle }));
  }
}

const esCaptura = (i) => i.tipo === "foto" || i.tipo === "texto";

/** Id al azar para appProperties.pieza (36 caracteres: entra de sobra en los 124 bytes). */
function nuevaPieza() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* sin crypto.randomUUID (http sin TLS): al azar común */ }
  const azar = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `p-${Date.now().toString(36)}-${azar()}${azar()}`;
}
const resumen = (i) => ({ clave: i.clave, grupo: i.grupo, tipo: i.tipo });

/**
 * Arma una cola sobre un almacén.
 * - abrirAlmacen: () => Promise<almacén> (agregar, todos, actualizar, sacar, borrar)
 *   actualizar(clave, fn): lee la fila y escribe fn(fila) en una sola transacción; si la fila ya
 *   no está, o fn devuelve null, no escribe nada (→ null). sacar(clave): la lee y la borra juntas.
 * - avisar: (detalle) => void
 * - enLinea: () => boolean (false = ni lo intenta)
 */
export function crearCola({
  abrirAlmacen = async () => almacenEnMemoria(),
  avisar = avisarVentana,
  enLinea = () => !(globalThis.navigator && globalThis.navigator.onLine === false),
} = {}) {
  let almacen = null;
  let corriendo = null;
  let repetir = false;

  function alm() {
    if (!almacen) {
      almacen = Promise.resolve()
        .then(abrirAlmacen)
        .catch(() => almacenEnMemoria()); // sin IndexedDB: al menos dura mientras la página esté abierta
    }
    return almacen;
  }

  /**
   * Guarda una pieza en la cola. item: {tipo:'foto', blob, grupo, tomada, nota}
   * · {tipo:'texto', texto, grupo, tomada} · {tipo:'nota', grupo, nota}. → clave
   */
  async function encolar(item) {
    const a = await alm();
    const fila = { ...item, creada: new Date().toISOString(), intentos: 0 };
    if (esCaptura(fila)) fila.pieza = fila.pieza || nuevaPieza();
    if (fila.tipo === "foto") {
      if (fila.blob) {
        fila.bytes = await fila.blob.arrayBuffer();
        fila.mime = fila.blob.type || "image/jpeg";
        delete fila.blob;
      }
      if (!fila.bytes) throw new Error("La foto vino vacía.");
      fila.nota = fila.nota || "";
    } else if (fila.tipo === "texto") {
      fila.texto = String(fila.texto || "");
    } else if (fila.tipo === "nota") {
      fila.nota = fila.nota || "";
      // una sola nota pendiente por grupo: la última manda
      for (const otra of await a.todos()) {
        if (otra.tipo === "nota" && otra.grupo === fila.grupo) await a.borrar(otra.clave);
      }
    } else {
      throw new Error("Tipo de pieza desconocido: " + fila.tipo);
    }
    delete fila.clave;
    const clave = await a.agregar(fila);
    avisar({ evento: "encolada", ...resumen({ ...fila, clave }) });
    return clave;
  }

  /** Todo lo que está en la cola, de lo más viejo a lo más nuevo. */
  async function listar() {
    return (await alm()).todos();
  }

  /** Cuántas fotos y textos esperan para subir (las notas pendientes no cuentan). */
  async function contar() {
    return (await listar()).filter(esCaptura).length;
  }

  /** Cambia la nota de las fotos del grupo que todavía no subieron. → cuántas cambió */
  async function actualizarNota(grupo, nota) {
    const a = await alm();
    let n = 0;
    for (const i of await a.todos()) {
      if (i.grupo !== grupo || (i.tipo !== "foto" && i.tipo !== "nota")) continue;
      // Leer y escribir juntos: si la foto terminó de subir después de `todos()`, ya no está y
      // no se vuelve a meter en la cola (se subiría otra vez, como _2.jpg).
      const cambiada = await a.actualizar(i.clave, (x) => (x.nota === nota ? null : { ...x, nota }));
      if (cambiada) n++;
    }
    return n;
  }

  /** Antes de mandar una pieza: le asegura un id fijo y la marca como intentada. → fila o null */
  function prepararIntento(a, i) {
    if (!esCaptura(i)) return i;
    return a.actualizar(i.clave, (x) => ({ ...x, pieza: x.pieza || nuevaPieza(), intentada: true }));
  }

  async function subirUna(datos, i, reintento) {
    const meta = { grupo: i.grupo, tomada: i.tomada, pieza: i.pieza, reintento };
    if (i.tipo === "foto") {
      const blob = new Blob([i.bytes], { type: i.mime || "image/jpeg" });
      return datos.subirFoto(blob, { ...meta, nota: i.nota || "" });
    }
    if (i.tipo === "texto") return datos.crearTexto(i.texto, meta);
    await datos.cambiarNota(i.grupo, i.nota || "");
    return null;
  }

  function motivoParaNoIntentar(datos) {
    if (!enLinea()) return "sin_conexion";
    try {
      if (datos.estado && !datos.estado().conectado) return "sin_login";
    } catch { /* si estado() falla, probamos igual */ }
    return null;
  }

  async function pasada(datos) {
    const a = await alm();
    const vistas = new Set();
    let subidas = 0;
    let ultimoError = null;
    for (;;) {
      const pendientes = await a.todos();
      const vista = pendientes.find((x) => !vistas.has(x.clave));
      if (!vista) break;
      const motivo = motivoParaNoIntentar(datos);
      if (motivo) {
        for (const x of pendientes) avisar({ evento: "en_cola", motivo, ...resumen(x) });
        return { subidas, detenida: motivo, error: null };
      }
      vistas.add(vista.clave);
      const i = await prepararIntento(a, vista);
      if (!i) continue;                         // ya no está en la cola
      const reintento = !!(vista.intentada || vista.intentos);
      avisar({ evento: "subiendo", ...resumen(i) });
      let r;
      try {
        r = await subirUna(datos, i, reintento);
      } catch (e) {
        if (e && DETIENEN.has(e.codigo)) {
          for (const x of await a.todos()) avisar({ evento: "en_cola", motivo: e.codigo, ...resumen(x) });
          return { subidas, detenida: e.codigo, error: e };
        }
        // otro error (Drive respondió mal): queda en la cola y seguimos con las demás
        ultimoError = e;
        await a.actualizar(i.clave, (x) => ({ ...x, intentos: (x.intentos || 0) + 1,
          ultimoError: String((e && e.message) || e) }));
        avisar({ evento: "error", error: e, ...resumen(i) });
        continue;
      }
      // subió: la sacamos (leer y borrar juntos) y, si mientras tanto cambiaron la nota, la
      // mandamos aparte
      const actual = await a.sacar(i.clave);
      if (esCaptura(i)) subidas++;
      avisar({ evento: "subida", id: r && r.id, ...resumen(i) });
      if (i.tipo !== "texto" && actual && (actual.nota || "") !== (i.nota || "")) {
        await encolar({ tipo: "nota", grupo: i.grupo, nota: actual.nota || "" });
      }
    }
    return { subidas, detenida: null, error: ultimoError };
  }

  /**
   * Sube lo que haya, de a una. Se corta ante sin_login o sin_conexion.
   * Una sola corrida a la vez: si ya está corriendo, devuelve la misma promesa (y la corrida
   * vuelve a mirar la cola al terminar, por si llegó algo nuevo).
   * → {subidas, quedan, detenida: null|'sin_login'|'sin_conexion', error}
   */
  function vaciar(datos) {
    if (corriendo) {
      repetir = true;
      return corriendo;
    }
    corriendo = (async () => {
      let subidas = 0;
      let r;
      do {
        repetir = false;
        r = await pasada(datos);
        subidas += r.subidas;
      } while (repetir && !r.detenida);
      const quedan = (await listar()).length;
      return { subidas, quedan, detenida: r.detenida, error: r.error };
    })().finally(() => {
      corriendo = null;
    });
    return corriendo;
  }

  return { encolar, listar, contar, actualizarNota, vaciar, ocupada: () => corriendo !== null };
}

// ---------------------------------------------------------------- la cola de la página

const cola = crearCola({
  abrirAlmacen: () => (typeof indexedDB !== "undefined" ? almacenIndexedDB() : almacenEnMemoria()),
});

export const encolar = cola.encolar;
export const listar = cola.listar;
export const contar = cola.contar;
export const actualizarNota = cola.actualizarNota;
export const vaciar = cola.vaciar;
export const ocupada = cola.ocupada;
