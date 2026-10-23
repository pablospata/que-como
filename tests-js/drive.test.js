// Pruebas de docs/js/drive.js sin navegador ni Google: fetch, localStorage, window y document
// son imitaciones chicas. Cada prueba importa drive.js de nuevo (?prueba=N) para empezar sin
// cachés en memoria.
import { test } from "node:test";
import assert from "node:assert/strict";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN = "tok-prueba";
const HORA = 3600 * 1000;

// ---------------------------------------------------------------- imitaciones

class AlmacenFalso {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const respuesta = (datos, status = 200) => new Response(
  typeof datos === "string" ? datos : JSON.stringify(datos),
  { status, headers: { "content-type": "application/json" } });

const errorGoogle = (status, mensaje = "Algo", razon = "") =>
  respuesta({ error: { code: status, message: mensaje, errors: [{ reason: razon }] } }, status);

/** "appProperties has {…} and trashed = false or …" → función de filtro. */
function filtro(q) {
  const js = q
    .replace(/appProperties has \{ key='([^']*)' and value='((?:[^'\\]|\\.)*)' \}/g,
      (_, k, v) => `ap(${JSON.stringify(k)}, ${JSON.stringify(v.replace(/\\(.)/g, "$1"))})`)
    .replace(/trashed = false/g, "!f.trashed")
    .replace(/ and /g, " && ")
    .replace(/ or /g, " || ");
  return new Function("f", `const ap = (k, v) => (f.appProperties || {})[k] === v; return ${js};`);
}

async function textoDe(cuerpo) {
  if (cuerpo == null) return "";
  return typeof cuerpo === "string" ? cuerpo : cuerpo.text();
}

/** Separa un multipart/related en sus partes: [{tipo, contenido}]. */
function partes(texto, tipoCabecera) {
  const limite = /boundary=(.+)$/.exec(tipoCabecera)[1];
  assert.ok(texto.startsWith(`--${limite}\r\n`), "empieza con el límite");
  assert.ok(texto.endsWith(`\r\n--${limite}--`), "termina con el límite de cierre");
  return texto.split(`--${limite}`).slice(1, -1).map((p) => {
    const sinBordes = p.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const corte = sinBordes.indexOf("\r\n\r\n");
    return {
      tipo: /Content-Type: (.+)/.exec(sinBordes.slice(0, corte))[1],
      contenido: sinBordes.slice(corte + 4),
    };
  });
}

/** Un Drive en memoria que entiende lo que usa drive.js. */
class DriveFalso {
  constructor() {
    this.archivos = [];
    this.llamadas = [];
    this.forzadas = [];       // respuestas que se devuelven antes de atender (errores)
    this.sinRed = false;
    this.paginaMax = 1000;
    this.n = 0;
    this.segundo = 0;
    this.email = "pablo@ejemplo.com";
    this.fetch = this.fetch.bind(this);
  }

  agregar(datos) {
    const f = {
      id: `f${++this.n}`, name: "", mimeType: "application/octet-stream", parents: [],
      appProperties: {}, description: "", trashed: false, contenido: "",
      createdTime: new Date(Date.UTC(2026, 0, 1, 0, 0, ++this.segundo)).toISOString(),
      ...datos,
    };
    this.archivos.push(f);
    return f;
  }

  porId(id) { return this.archivos.find((f) => f.id === id); }
  deClase(clase) { return this.archivos.filter((f) => f.appProperties.quecomo === clase); }
  de(metodo, trozo) {
    return this.llamadas.filter((l) => l.metodo === metodo && l.url.pathname.includes(trozo));
  }

  async fetch(url, op = {}) {
    const u = new URL(url);
    const metodo = op.method || "GET";
    const cuerpo = await textoDe(op.body);
    const tipo = op.headers?.["Content-Type"] || "";
    this.llamadas.push({ metodo, url: u, cuerpo, tipo });
    if (this.sinRed) throw new TypeError("Failed to fetch");
    if (this.forzadas.length) return this.forzadas.shift()();
    if (op.headers?.Authorization !== `Bearer ${TOKEN}`) return errorGoogle(401, "Invalid Credentials");

    const ruta = u.pathname;
    let m;
    if (ruta === "/drive/v3/about") return respuesta({ user: { emailAddress: this.email } });
    if (ruta === "/drive/v3/files" && metodo === "GET") return this.listar(u.searchParams);
    if (ruta === "/drive/v3/files" && metodo === "POST") {
      const f = this.agregar(JSON.parse(cuerpo));
      return respuesta({ id: f.id });
    }
    if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(ruta))) {
      const f = this.porId(decodeURIComponent(m[1]));
      if (!f) return errorGoogle(404, "File not found", "notFound");
      if (metodo === "GET") return new Response(f.contenido, { status: 200 });
      if (metodo === "PATCH") {
        const cambios = JSON.parse(cuerpo);
        if ("description" in cambios) f.description = cambios.description;
        if (cambios.appProperties) f.appProperties = { ...f.appProperties, ...cambios.appProperties };
        return respuesta({ id: f.id });
      }
    }
    if (ruta === "/upload/drive/v3/files" && metodo === "POST") {
      const [meta, media] = partes(cuerpo, tipo);
      const f = this.agregar({ ...JSON.parse(meta.contenido), contenido: media.contenido,
        tipoSubido: media.tipo });
      return respuesta({ id: f.id });
    }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(ruta)) && metodo === "PATCH") {
      const f = this.porId(decodeURIComponent(m[1]));
      if (!f) return errorGoogle(404, "File not found", "notFound");
      f.contenido = cuerpo;
      return respuesta({ id: f.id });
    }
    return errorGoogle(400, `Ruta desconocida ${metodo} ${ruta}`);
  }

  listar(params) {
    const cumple = filtro(params.get("q"));
    let lista = this.archivos.filter(cumple);
    if (params.get("orderBy") === "createdTime") {
      lista = [...lista].sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    }
    const tam = Math.min(Number(params.get("pageSize")), this.paginaMax);
    const desde = Number(params.get("pageToken") || 0);
    const pagina = lista.slice(desde, desde + tam).map((f) => ({
      id: f.id, name: f.name, mimeType: f.mimeType, description: f.description,
      appProperties: f.appProperties, createdTime: f.createdTime,
    }));
    const r = { files: pagina };
    if (desde + tam < lista.length) r.nextPageToken = String(desde + tam);
    return respuesta(r);
  }
}

// ---------------------------------------------------------------- preparación

let cuenta = 0;

function tokenGuardado(exp = Date.now() + HORA, email = "pablo@ejemplo.com") {
  localStorage.setItem("quecomo-token", JSON.stringify({ access_token: TOKEN, exp, email }));
}

async function preparar({ conToken = true } = {}) {
  const drive = new DriveFalso();
  globalThis.fetch = drive.fetch;
  globalThis.localStorage = new AlmacenFalso();
  globalThis.window = new EventTarget();
  delete globalThis.google;
  const eventos = [];
  window.addEventListener("quecomo:sesion", () => eventos.push(Date.now()));
  if (conToken) tokenGuardado();
  const api = await import(`../docs/js/drive.js?prueba=${++cuenta}`);
  return { drive, api, eventos };
}

/** setTimeout sin esperar de verdad (anota las esperas cortas). */
function sinEsperas() {
  const real = globalThis.setTimeout;
  const esperas = [];
  globalThis.setTimeout = (fn, ms, ...a) => {
    if (ms < 10000) {
      esperas.push(ms);
      return real(fn, 0, ...a);
    }
    return real(fn, ms, ...a);
  };
  return { esperas, restaurar: () => { globalThis.setTimeout = real; } };
}

async function rechazo(promesa, codigo) {
  try {
    await promesa;
  } catch (e) {
    assert.equal(e.codigo, codigo, `código esperado ${codigo}, vino ${e.codigo}: ${e.message}`);
    return e;
  }
  assert.fail(`se esperaba un error ${codigo}`);
}

function raiz(drive, datos = {}) {
  return drive.agregar({ name: "Qué como", mimeType: "application/vnd.google-apps.folder",
    parents: ["root"], appProperties: { quecomo: "raiz" }, ...datos });
}

function pieza(drive, { grupo, tomada, nombre, tipo = "foto", estado = "pendiente", nota = "" }) {
  return drive.agregar({ name: nombre, mimeType: tipo === "foto" ? "image/jpeg" : "text/plain",
    description: nota, appProperties: { quecomo: tipo, grupo, tomada, estado } });
}

// ---------------------------------------------------------------- sesión y token

test("estado: sin token, token por vencer (menos de 60 s) y token vigente", async () => {
  const { api } = await preparar({ conToken: false });
  assert.deepEqual(api.estado(), { conectado: false, email: null, demo: false });
  tokenGuardado(Date.now() + 30000);
  assert.equal(api.estado().conectado, false);
  tokenGuardado(Date.now() + 120000, "pablo@ejemplo.com");
  assert.deepEqual(api.estado(), { conectado: true, email: "pablo@ejemplo.com", demo: false });
  localStorage.setItem("quecomo-token", "{roto");
  assert.equal(api.estado().conectado, false);
});

test("sin token: toda llamada tira sin_login sin tocar la red", async () => {
  const { api, drive } = await preparar({ conToken: false });
  for (const llamada of [() => api.pendientes(), () => api.leerRegistro(), () => api.urlFoto("x"),
    () => api.subirFoto(new Blob(["x"]), { grupo: "g-20261022-134012-a3f9", tomada: "2026-10-22T13:40:12-03:00" })]) {
    const e = await rechazo(llamada(), "sin_login");
    assert.equal(e.message, "Tenés que conectar el Drive.");
  }
  assert.equal(drive.llamadas.length, 0);
});

test("token guardado pero vencido: lo borra, avisa y tira sin_login", async () => {
  const { api, eventos } = await preparar({ conToken: false });
  tokenGuardado(Date.now() - 1000);
  const e = await rechazo(api.leerPerfil(), "sin_login");
  assert.match(e.message, /venció/);
  assert.equal(localStorage.getItem("quecomo-token"), null);
  assert.equal(eventos.length, 1);
});

test("401: borra el token, avisa a la página y tira sin_login", async () => {
  const { api, drive, eventos } = await preparar();
  localStorage.setItem("quecomo-email", "pablo@ejemplo.com");
  drive.forzadas.push(() => errorGoogle(401, "Invalid Credentials"));
  const e = await rechazo(api.pendientes(), "sin_login");
  assert.equal(e.message, "Se venció el permiso del Drive: tocá Conectar.");
  assert.equal(localStorage.getItem("quecomo-token"), null);
  assert.equal(localStorage.getItem("quecomo-email"), "pablo@ejemplo.com");
  assert.equal(eventos.length, 1);
  assert.equal(api.estado().conectado, false);
});

test("sin red: fetch que falla o navigator.onLine = false → sin_conexion", async () => {
  const { api, drive } = await preparar();
  drive.sinRed = true;
  const e = await rechazo(api.pendientes(), "sin_conexion");
  assert.equal(e.message, "No hay conexión a internet.");

  drive.sinRed = false;
  const antes = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
  try {
    const llamadas = drive.llamadas.length;
    await rechazo(api.leerPeso(), "sin_conexion");
    assert.equal(drive.llamadas.length, llamadas, "no intenta pedir nada");
  } finally {
    if (antes) Object.defineProperty(globalThis, "navigator", antes);
    else delete globalThis.navigator;
  }
});

test("429 y 5xx: reintenta dos veces con 500 y 1500 ms; después tira drive", async () => {
  const { api, drive } = await preparar();
  const t = sinEsperas();
  try {
    drive.forzadas.push(() => errorGoogle(429, "Rate Limit"), () => errorGoogle(503, "Backend Error"));
    assert.deepEqual(await api.pendientes(), []);
    assert.deepEqual(t.esperas, [500, 1500]);

    t.esperas.length = 0;
    drive.forzadas.push(() => errorGoogle(403, "User rate limit", "userRateLimitExceeded"));
    assert.deepEqual(await api.pendientes(), []);
    assert.deepEqual(t.esperas, [500]);

    t.esperas.length = 0;
    drive.forzadas.push(() => errorGoogle(500, "Uno"), () => errorGoogle(500, "Dos"),
      () => errorGoogle(500, "Internal Error"));
    const e = await rechazo(api.pendientes(), "drive");
    assert.equal(e.message, "Drive respondió con un error: Internal Error (código 500).");
    assert.deepEqual(t.esperas, [500, 1500]);

    t.esperas.length = 0;
    drive.forzadas.push(() => errorGoogle(403, "Insufficient permissions", "insufficientFilePermissions"));
    await rechazo(api.pendientes(), "drive");
    assert.deepEqual(t.esperas, [], "un 403 que no es de límite no se reintenta");
  } finally {
    t.restaurar();
  }
});

test("conectar: pide el token con login_hint, guarda token y email y avisa", async () => {
  const { api, drive, eventos } = await preparar({ conToken: false });
  localStorage.setItem("quecomo-email", "viejo@ejemplo.com");
  const pedidos = [];
  let config = null;
  globalThis.google = { accounts: { oauth2: {
    initTokenClient(c) {
      config = c;
      return { requestAccessToken(o) {
        pedidos.push(o);
        queueMicrotask(() => c.callback({ access_token: TOKEN, expires_in: 3599, scope: `${SCOPE} openid` }));
      } };
    },
  } } };
  const antes = Date.now();
  await api.conectar();
  assert.equal(config.scope, SCOPE);
  assert.deepEqual(pedidos, [{ prompt: "", login_hint: "viejo@ejemplo.com" }]);
  const t = JSON.parse(localStorage.getItem("quecomo-token"));
  assert.equal(t.access_token, TOKEN);
  assert.equal(t.email, "pablo@ejemplo.com");
  assert.ok(t.exp >= antes + 3599000 && t.exp <= Date.now() + 3599000);
  assert.equal(localStorage.getItem("quecomo-email"), "pablo@ejemplo.com");
  assert.equal(drive.de("GET", "/about")[0].url.searchParams.get("fields"), "user(emailAddress)");
  assert.deepEqual(api.estado(), { conectado: true, email: "pablo@ejemplo.com", demo: false });
  assert.equal(eventos.length, 1);
});

test("conectar: ventana cerrada o permiso negado → sin_login y no guarda nada", async () => {
  const { api } = await preparar({ conToken: false });
  let responder;
  globalThis.google = { accounts: { oauth2: {
    initTokenClient(c) { return { requestAccessToken() { responder(c); } }; },
  } } };
  responder = (c) => c.error_callback({ type: "popup_closed" });
  let e = await rechazo(api.conectar(), "sin_login");
  assert.match(e.message, /ventana de Google/);
  responder = (c) => c.callback({ error: "access_denied" });
  e = await rechazo(api.conectar(), "sin_login");
  assert.match(e.message, /Cancelaste/);
  responder = (c) => c.callback({ access_token: TOKEN, expires_in: 3599, scope: "openid email" });
  e = await rechazo(api.conectar(), "sin_login");
  assert.match(e.message, /casilla del Drive/);
  assert.equal(localStorage.getItem("quecomo-token"), null);
});

test("conectar: con el script de Google ya cargado, la ventana se pide sin esperar nada (dentro del toque)", async () => {
  const { api } = await preparar({ conToken: false });
  const pedidos = [];
  globalThis.google = { accounts: { oauth2: { initTokenClient: (c) => ({
    requestAccessToken(o) {
      pedidos.push(o);
      queueMicrotask(() => c.callback({ access_token: TOKEN, expires_in: 3599, scope: SCOPE }));
    },
  }) } } };
  const p = api.conectar();
  assert.equal(pedidos.length, 1, "requestAccessToken se llamó de forma síncrona");
  await p;
  assert.equal(api.estado().conectado, true);
});

test("conectar: si el script de Google todavía no cargó, lo carga y conecta", async () => {
  const { api } = await preparar({ conToken: false });
  const scripts = [];
  globalThis.document = {
    createElement: () => ({}),
    head: { append(s) {
      scripts.push(s.src);
      globalThis.google = { accounts: { oauth2: { initTokenClient: (c) => ({
        requestAccessToken: () => c.callback({ access_token: TOKEN, expires_in: 3599, scope: SCOPE }),
      }) } } };
      setTimeout(() => s.onload(), 0);
    } },
  };
  try {
    assert.deepEqual(scripts, [], "sin CLIENT_ID (y sin document al importar) no se precarga");
    await api.conectar();
    assert.deepEqual(scripts, ["https://accounts.google.com/gsi/client"]);
    assert.equal(api.estado().conectado, true);
  } finally {
    delete globalThis.document;
  }
});

test("desconectar: revoca, borra el token (no el email) y avisa", async () => {
  const { api, eventos } = await preparar();
  localStorage.setItem("quecomo-email", "pablo@ejemplo.com");
  const revocados = [];
  globalThis.google = { accounts: { oauth2: { revoke: (t, cb) => { revocados.push(t); cb(); } } } };
  await api.desconectar();
  assert.deepEqual(revocados, [TOKEN]);
  assert.equal(localStorage.getItem("quecomo-token"), null);
  assert.equal(localStorage.getItem("quecomo-email"), "pablo@ejemplo.com");
  assert.equal(api.estado().conectado, false);
  assert.equal(eventos.length, 1);
});

// ---------------------------------------------------------------- carpetas

test("carpeta raíz: si hay varias usa la más vieja", async () => {
  const { api, drive } = await preparar();
  const vieja = raiz(drive);
  raiz(drive);
  // la más nueva primero en la lista, para que el orden lo decida createdTime
  drive.archivos.reverse();
  await api.guardarPerfil({ version: 1, sexo: "m" });
  const [perfil] = drive.deClase("perfil");
  assert.deepEqual(perfil.parents, [vieja.id]);
  assert.equal(drive.deClase("raiz").length, 2, "no crea otra");
  const lista = drive.de("GET", "/drive/v3/files").find((l) =>
    l.url.searchParams.get("q").includes("value='raiz'"));
  assert.equal(lista.url.searchParams.get("orderBy"), "createdTime");
  assert.match(lista.url.searchParams.get("q"), /trashed = false/);
});

test("carpeta raíz: la crea en la raíz del Drive si falta (y no mira las de la papelera)", async () => {
  const { api, drive } = await preparar();
  raiz(drive, { trashed: true });
  await api.subirFoto(new Blob(["JPEG"]), { grupo: "g-20261022-134012-a3f9", tomada: "2026-10-22T13:40:12-03:00" });
  const [nueva] = drive.deClase("raiz").filter((f) => !f.trashed);
  assert.equal(nueva.name, "Qué como");
  assert.equal(nueva.mimeType, "application/vnd.google-apps.folder");
  assert.deepEqual(nueva.parents, ["root"]);
  const [fotos] = drive.deClase("fotos");
  assert.equal(fotos.name, "fotos");
  assert.deepEqual(fotos.parents, [nueva.id]);
  const [foto] = drive.deClase("foto");
  assert.deepEqual(foto.parents, [fotos.id]);
});

test("llamadas a la vez no crean carpetas ni archivos duplicados", async () => {
  const { api, drive } = await preparar();
  const grupo = "g-20261022-134012-a3f9";
  const tomada = "2026-10-22T13:40:12-03:00";
  await Promise.all([
    api.subirFoto(new Blob(["A"]), { grupo, tomada }),
    api.subirFoto(new Blob(["B"]), { grupo, tomada }),
    api.crearTexto("y un alfajor", { grupo, tomada }),
    api.guardarPerfil({ version: 1 }),
    api.guardarPeso({ version: 1, registros: [] }),
    api.leerPeso(),
    api.actualizarRegistro((r) => r),
  ]);
  assert.equal(drive.deClase("raiz").length, 1);
  assert.equal(drive.deClase("fotos").length, 1);
  assert.equal(drive.deClase("perfil").length, 1);
  assert.equal(drive.deClase("peso").length, 1);
  assert.equal(drive.deClase("registro").length, 1);
  const nombres = [...drive.deClase("foto"), ...drive.deClase("texto")].map((f) => f.name).sort();
  assert.deepEqual(nombres, [
    "2026-10-22_13-40-12_a3f9.jpg", "2026-10-22_13-40-12_a3f9_2.jpg", "2026-10-22_13-40-12_a3f9_3.txt",
  ]);
  // Después, todo con los ids en memoria: no vuelve a buscar la carpeta.
  const busquedas = drive.de("GET", "/drive/v3/files").length;
  await api.subirFoto(new Blob(["C"]), { grupo, tomada });
  const nuevas = drive.de("GET", "/drive/v3/files").slice(busquedas);
  assert.equal(nuevas.length, 0);
  assert.ok(drive.deClase("foto").some((f) => f.name === "2026-10-22_13-40-12_a3f9_4.jpg"));
});

// ---------------------------------------------------------------- capturas

test("subirFoto: multipart con metadatos JSON y la foto", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const { id } = await api.subirFoto(new Blob(["JPEG-BYTES"], { type: "image/jpeg" }),
    { grupo: "g-20261022-134012-a3f9", tomada: "2026-10-22T13:40:12-03:00", nota: "puré de caja" });
  const subida = drive.de("POST", "/upload/drive/v3/files")[0];
  assert.equal(subida.url.searchParams.get("uploadType"), "multipart");
  assert.equal(subida.url.searchParams.get("fields"), "id");
  assert.match(subida.tipo, /^multipart\/related; boundary=/);
  const [meta, media] = partes(subida.cuerpo, subida.tipo);
  assert.equal(meta.tipo, "application/json; charset=UTF-8");
  assert.equal(media.tipo, "image/jpeg");
  assert.equal(media.contenido, "JPEG-BYTES");
  const m = JSON.parse(meta.contenido);
  assert.equal(m.name, "2026-10-22_13-40-12_a3f9.jpg");
  assert.equal(m.mimeType, "image/jpeg");
  assert.equal(m.description, "puré de caja");
  assert.deepEqual(m.appProperties, { quecomo: "foto", grupo: "g-20261022-134012-a3f9",
    tomada: "2026-10-22T13:40:12-03:00", estado: "pendiente" });
  assert.equal(drive.porId(id).name, m.name);
});

test("subirFoto con nota: iguala la nota de las otras piezas del grupo", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const grupo = "g-20261022-134012-a3f9";
  const vieja = pieza(drive, { grupo, tomada: "2026-10-22T13:40:12-03:00", nombre: "x.jpg" });
  await api.subirFoto(new Blob(["J"]), { grupo, tomada: "2026-10-22T13:40:12-03:00", nota: "sin sal" });
  assert.equal(vieja.description, "sin sal");
});

test("crearTexto: archivo text/plain con el texto como contenido y como description", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  await api.crearTexto("2 alfajores, no saqué foto", { grupo: "g-20261022-180000-zz01", tomada: "2026-10-22T18:00:00-03:00" });
  const [t] = drive.deClase("texto");
  assert.equal(t.name, "2026-10-22_18-00-00_zz01.txt");
  assert.equal(t.mimeType, "text/plain");
  assert.equal(t.contenido, "2 alfajores, no saqué foto");
  assert.equal(t.description, "2 alfajores, no saqué foto");
  assert.equal(t.tipoSubido, "text/plain; charset=UTF-8");
  assert.equal(t.appProperties.estado, "pendiente");
});

test("subirFoto y crearTexto con pieza: va en appProperties; la primera vez no busca nada", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const grupo = "g-20261022-134012-a3f9";
  const tomada = "2026-10-22T13:40:12-03:00";
  const pieza = "0b7c6c1e-5f1a-4d55-9d0e-6a4f1c2b3d4e";
  await api.subirFoto(new Blob(["J"]), { grupo, tomada, pieza });
  await api.crearTexto("un mate", { grupo, tomada, pieza: "otra-pieza", reintento: false });
  const [f] = drive.deClase("foto");
  assert.deepEqual(f.appProperties, { quecomo: "foto", grupo, tomada, estado: "pendiente", pieza });
  assert.equal(drive.deClase("texto")[0].appProperties.pieza, "otra-pieza");
  const busquedas = drive.de("GET", "/drive/v3/files").filter((l) => l.url.searchParams.get("q").includes("'pieza'"));
  assert.equal(busquedas.length, 0);
});

test("reintento de una pieza que ya llegó al Drive: devuelve la existente sin crear otra", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const grupo = "g-20261022-134012-a3f9";
  const tomada = "2026-10-22T13:40:12-03:00";
  const { id } = await api.subirFoto(new Blob(["J"]), { grupo, tomada, nota: "", pieza: "p-1" });
  const { id: idTexto } = await api.crearTexto("un mate", { grupo, tomada, pieza: "p-2" });
  const posts = drive.de("POST", "/upload/drive/v3/files").length;

  // la respuesta se había perdido: la cola reintenta con la misma pieza (y la nota nueva)
  const r = await api.subirFoto(new Blob(["J"]), { grupo, tomada, nota: "sin sal", pieza: "p-1", reintento: true });
  assert.equal(r.id, id);
  assert.equal(drive.porId(id).description, "sin sal", "la nota nueva se aplica a la existente");
  assert.equal(drive.porId(idTexto).description, "sin sal", "y al resto del grupo");
  assert.deepEqual(await api.crearTexto("un mate", { grupo, tomada, pieza: "p-2", reintento: true }), { id: idTexto });
  assert.equal(drive.de("POST", "/upload/drive/v3/files").length, posts, "no creó nada");
  assert.equal(drive.deClase("foto").length, 1);
  assert.equal(drive.deClase("texto").length, 1);

  // reintento de una pieza que no llegó: la crea
  await api.subirFoto(new Blob(["K"]), { grupo, tomada, pieza: "p-3", reintento: true });
  assert.equal(drive.deClase("foto").length, 2);
});

test("subida con 5xx que Drive igual guardó: antes de repetir el POST la busca y no la duplica", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const t = sinEsperas();
  const original = drive.fetch;
  let cortadas = 0;
  globalThis.fetch = async (url, op) => {
    const r = await original(url, op);
    if (op?.method === "POST" && String(url).includes("/upload/") && cortadas++ === 0) {
      return errorGoogle(503, "Backend Error");   // la guardó pero respondió con error
    }
    return r;
  };
  try {
    const { id } = await api.subirFoto(new Blob(["J"]),
      { grupo: "g-20261022-134012-a3f9", tomada: "2026-10-22T13:40:12-03:00", pieza: "p-9" });
    assert.equal(drive.deClase("foto").length, 1, "una sola foto");
    assert.equal(id, drive.deClase("foto")[0].id);
    assert.equal(drive.de("POST", "/upload/drive/v3/files").length, 1, "no repitió el POST");
    assert.deepEqual(t.esperas, [500]);
  } finally {
    t.restaurar();
  }
});

test("subida con 5xx que no quedó guardada: la busca, no está, y repite el POST", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const t = sinEsperas();
  try {
    let n = 0;
    const original = drive.fetch;
    globalThis.fetch = async (url, op) => {
      if (op?.method === "POST" && String(url).includes("/upload/") && n++ === 0) return errorGoogle(503, "Backend Error");
      return original(url, op);
    };
    await api.subirFoto(new Blob(["J"]),
      { grupo: "g-20261022-134012-a3f9", tomada: "2026-10-22T13:40:12-03:00", pieza: "p-10" });
    assert.equal(drive.deClase("foto").length, 1);
  } finally {
    t.restaurar();
  }
});

test("pedido colgado: se corta a los 30 s (120 s para subir o bajar archivos) → sin_conexion", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  const real = globalThis.setTimeout;
  const limites = [];
  globalThis.setTimeout = (fn, ms, ...a) => {
    if (ms === 30000 || ms === 120000) {
      limites.push(ms);
      return real(fn, 0, ...a);
    }
    return real(fn, ms, ...a);
  };
  const colgado = (url, op) => new Promise((_, rechazar) => {
    op.signal.addEventListener("abort", () => rechazar(new DOMException("Abortado", "AbortError")));
  });
  try {
    globalThis.fetch = colgado;
    let e = await rechazo(api.pendientes(), "sin_conexion");
    assert.equal(e.message, "La conexión tardó demasiado.");
    assert.deepEqual(limites, [30000]);

    // la búsqueda de carpetas responde; la subida se cuelga
    limites.length = 0;
    globalThis.fetch = (url, op) =>
      (String(url).includes("/upload/") ? colgado(url, op) : drive.fetch(url, op));
    e = await rechazo(api.subirFoto(new Blob(["J"]),
      { grupo: "g-20261022-134012-a3f9", tomada: "2026-10-22T13:40:12-03:00" }), "sin_conexion");
    assert.equal(e.message, "La conexión tardó demasiado.");
    assert.equal(limites.at(-1), 120000);
  } finally {
    globalThis.setTimeout = real;
  }
});

test("pendientes: agrupa, ordena (grupos por tomada, piezas por nombre) y sigue las páginas", async () => {
  const { api, drive } = await preparar();
  drive.paginaMax = 2;
  const g1 = "g-20261022-134012-a3f9";
  const g2 = "g-20261021-090000-b001";
  pieza(drive, { grupo: g1, tomada: "2026-10-22T13:40:12-03:00", nombre: "2026-10-22_13-40-12_a3f9_10.jpg" });
  pieza(drive, { grupo: g1, tomada: "2026-10-22T13:40:12-03:00", nombre: "2026-10-22_13-40-12_a3f9_2.jpg", nota: "media porción" });
  pieza(drive, { grupo: g1, tomada: "2026-10-22T13:40:10-03:00", nombre: "2026-10-22_13-40-12_a3f9.jpg" });
  pieza(drive, { grupo: g2, tomada: "2026-10-21T09:00:00-03:00", nombre: "2026-10-21_09-00-00_b001.txt", tipo: "texto", nota: "mate" });
  pieza(drive, { grupo: "g-x", tomada: "2026-10-20T09:00:00-03:00", nombre: "p.jpg", estado: "procesada" });
  pieza(drive, { grupo: "g-y", tomada: "2026-10-20T09:00:00-03:00", nombre: "d.jpg", estado: "descartada" });
  pieza(drive, { grupo: "g-z", tomada: "2026-10-20T09:00:00-03:00", nombre: "t.jpg" }).trashed = true;

  const lista = await api.pendientes();
  assert.deepEqual(lista.map((g) => g.grupo), [g2, g1]);
  assert.deepEqual(lista[1], {
    grupo: g1, tomada: "2026-10-22T13:40:10-03:00", nota: "media porción",
    piezas: [
      { id: "f3", tipo: "foto", nombre: "2026-10-22_13-40-12_a3f9.jpg" },
      { id: "f2", tipo: "foto", nombre: "2026-10-22_13-40-12_a3f9_2.jpg" },
      { id: "f1", tipo: "foto", nombre: "2026-10-22_13-40-12_a3f9_10.jpg" },
    ],
  });
  assert.deepEqual(lista[0].piezas, [{ id: "f4", tipo: "texto", nombre: "2026-10-21_09-00-00_b001.txt" }]);
  assert.equal(lista[0].nota, "mate");
  const pedidos = drive.de("GET", "/drive/v3/files");
  assert.equal(pedidos.length, 2, "dos páginas");
  assert.equal(pedidos[1].url.searchParams.get("pageToken"), "2");
  assert.equal(pedidos[0].url.searchParams.get("fields"),
    "nextPageToken, files(id,name,mimeType,description,appProperties)");
});

test("cambiarNota y descartar: parchean todas las piezas del grupo y nada más", async () => {
  const { api, drive } = await preparar();
  const grupo = "g-20261022-134012-a3f9";
  const a = pieza(drive, { grupo, tomada: "2026-10-22T13:40:12-03:00", nombre: "a.jpg", nota: "vieja" });
  const b = pieza(drive, { grupo, tomada: "2026-10-22T13:40:12-03:00", nombre: "b.jpg", estado: "procesada" });
  const otra = pieza(drive, { grupo: "g-otro", tomada: "2026-10-22T13:40:12-03:00", nombre: "c.jpg", nota: "no tocar" });

  await api.cambiarNota(grupo, "puré de caja");
  assert.equal(a.description, "puré de caja");
  assert.equal(b.description, "puré de caja");
  assert.equal(otra.description, "no tocar");
  assert.equal(drive.de("PATCH", "/drive/v3/files/").length, 2);

  await api.descartar(grupo);
  assert.deepEqual(a.appProperties, { quecomo: "foto", grupo, tomada: "2026-10-22T13:40:12-03:00", estado: "descartada" });
  assert.equal(b.appProperties.estado, "descartada");
  assert.equal(otra.appProperties.estado, "pendiente");
  const parche = JSON.parse(drive.de("PATCH", "/drive/v3/files/").at(-1).cuerpo);
  assert.deepEqual(parche, { appProperties: { estado: "descartada" } });
});

test("cambiarMomento: cambia la tomada de todas las piezas del grupo (no las de la papelera ni otros grupos)", async () => {
  const { api, drive } = await preparar();
  const grupo = "g-20261022-134012-a3f9";
  const vieja = "2026-10-22T13:40:12-03:00";
  const a = pieza(drive, { grupo, tomada: vieja, nombre: "a.jpg", nota: "puré" });
  const b = pieza(drive, { grupo, tomada: "2026-10-22T13:41:00-03:00", nombre: "b.txt", tipo: "texto" });
  const tirada = pieza(drive, { grupo, tomada: vieja, nombre: "c.jpg" });
  tirada.trashed = true;
  const otra = pieza(drive, { grupo: "g-otro", tomada: vieja, nombre: "d.jpg" });

  await api.cambiarMomento(grupo, "2026-10-21T21:15:12-03:00");
  for (const p of [a, b]) {
    assert.deepEqual(p.appProperties, { quecomo: p === a ? "foto" : "texto", grupo,
      tomada: "2026-10-21T21:15:12-03:00", estado: "pendiente" });
  }
  assert.equal(a.description, "puré", "la nota no se toca");
  assert.equal(tirada.appProperties.tomada, vieja);
  assert.equal(otra.appProperties.tomada, vieja);
  const parches = drive.de("PATCH", "/drive/v3/files/");
  assert.equal(parches.length, 2);
  assert.deepEqual(JSON.parse(parches[0].cuerpo), { appProperties: { tomada: "2026-10-21T21:15:12-03:00" } });

  // pendientes() la muestra con la tomada nueva (y el mismo grupo)
  const [cap] = (await api.pendientes()).filter((c) => c.grupo === grupo);
  assert.equal(cap.tomada, "2026-10-21T21:15:12-03:00");

  // un Date local se guarda como ISO con zona
  await api.cambiarMomento(grupo, new Date(2026, 9, 20, 8, 5, 9));
  assert.match(a.appProperties.tomada, /^2026-10-20T08:05:09[+-]\d\d:\d\d$/);

  // algo que no es una fecha: error drive, sin tocar la red
  const antes = drive.llamadas.length;
  await rechazo(api.cambiarMomento(grupo, "ayer"), "drive");
  assert.equal(drive.llamadas.length, antes);
});

test("cambiarMomento sin token: sin_login sin tocar la red", async () => {
  const { api, drive } = await preparar({ conToken: false });
  const e = await rechazo(api.cambiarMomento("g-20261022-134012-a3f9", "2026-10-21T21:15:12-03:00"), "sin_login");
  assert.equal(e.message, "Tenés que conectar el Drive.");
  assert.equal(drive.llamadas.length, 0);
});

test("urlFoto: baja la foto una sola vez y devuelve una object URL", async () => {
  const { api, drive } = await preparar();
  const f = drive.agregar({ name: "a.jpg", contenido: "JPEG" });
  const [u1, u2] = await Promise.all([api.urlFoto(f.id), api.urlFoto(f.id)]);
  assert.equal(u1, u2);
  assert.match(u1, /^blob:/);
  assert.equal(await api.urlFoto(f.id), u1);
  assert.equal(drive.de("GET", `/files/${f.id}`).length, 1);
  assert.equal(drive.de("GET", `/files/${f.id}`)[0].url.searchParams.get("alt"), "media");
  await rechazo(api.urlFoto("no-existe"), "drive");
});

// ---------------------------------------------------------------- JSON

test("sin archivos: registro, perfil y peso vacíos, sin crear nada", async () => {
  const { api, drive } = await preparar();
  assert.deepEqual(await api.leerRegistro(), { version: 1, comidas: [] });
  assert.equal(await api.leerPerfil(), null);
  assert.deepEqual(await api.leerPeso(), { version: 1, registros: [] });
  assert.equal(drive.llamadas.filter((l) => l.metodo !== "GET").length, 0);
});

test("actualizarRegistro: lee lo último, aplica fn, pone actualizado y escribe con sangría", async () => {
  const { api, drive } = await preparar();
  const r = raiz(drive);
  const reg = drive.agregar({ name: "registro.json", parents: [r.id], appProperties: { quecomo: "registro" },
    contenido: JSON.stringify({ version: 1, comidas: [{ id: "g-1", kcal: 100 }], extra: "se conserva" }) });

  const vuelta = await api.actualizarRegistro(async (registro) => {
    registro.comidas.push({ id: "g-2", kcal: 200 });
    return registro;
  });
  assert.deepEqual(vuelta.comidas.map((c) => c.id), ["g-1", "g-2"]);
  assert.match(vuelta.actualizado, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  const escrito = JSON.parse(reg.contenido);
  assert.deepEqual(escrito, vuelta);
  assert.equal(escrito.extra, "se conserva");
  assert.ok(reg.contenido.includes('\n  "comidas": ['), "JSON con sangría de 2");
  const patch = drive.de("PATCH", "/upload/drive/v3/files/")[0];
  assert.equal(patch.url.searchParams.get("uploadType"), "media");
  assert.match(patch.tipo, /^application\/json/);
  assert.equal(drive.deClase("registro").length, 1);

  // Lo que cambió otro (qc.py) entre medio se lee antes de escribir.
  reg.contenido = JSON.stringify({ version: 1, comidas: [{ id: "g-9" }] });
  const otra = await api.actualizarRegistro((x) => { x.comidas.push({ id: "g-10" }); return x; });
  assert.deepEqual(otra.comidas.map((c) => c.id), ["g-9", "g-10"]);
});

test("actualizarRegistro sin registro.json: lo crea en la raíz con appProperties", async () => {
  const { api, drive } = await preparar();
  const r = raiz(drive);
  await api.actualizarRegistro((x) => { x.comidas.push({ id: "g-1" }); return x; });
  const [reg] = drive.deClase("registro");
  assert.equal(reg.name, "registro.json");
  assert.equal(reg.mimeType, "application/json");
  assert.deepEqual(reg.parents, [r.id]);
  assert.deepEqual(JSON.parse(reg.contenido).comidas, [{ id: "g-1" }]);
});

test("registro.json dañado: tira drive y no lo pisa", async () => {
  const { api, drive } = await preparar();
  const reg = drive.agregar({ name: "registro.json", appProperties: { quecomo: "registro" }, contenido: "{ roto" });
  const e = await rechazo(api.actualizarRegistro((x) => x), "drive");
  assert.match(e.message, /registro\.json/);
  assert.equal(reg.contenido, "{ roto");
  assert.equal(drive.llamadas.filter((l) => l.metodo !== "GET").length, 0);
});

test("guardarPeso ordena por fecha; guardarPerfil y leerPerfil ida y vuelta", async () => {
  const { api, drive } = await preparar();
  raiz(drive);
  await api.guardarPeso({ version: 1, registros: [{ fecha: "2026-10-22", kg: 84.3 }, { fecha: "2026-10-20", kg: 84.9 }] });
  assert.deepEqual((await api.leerPeso()).registros.map((r) => r.fecha), ["2026-10-20", "2026-10-22"]);
  const perfil = { version: 1, sexo: "m", altura_cm: 178, meta_kcal_manual: null };
  await api.guardarPerfil(perfil);
  assert.deepEqual(await api.leerPerfil(), perfil);
  await api.guardarPerfil({ ...perfil, altura_cm: 179 });
  assert.equal((await api.leerPerfil()).altura_cm, 179);
  assert.equal(drive.deClase("perfil").length, 1);
});

test("la API exportada es exactamente la del contrato", async () => {
  const { api } = await preparar();
  const esperadas = [
    "actualizarRegistro", "cambiarMomento", "cambiarNota", "conectar", "crearTexto", "desconectar", "descartar",
    "estado", "guardarPerfil", "guardarPeso", "leerPerfil", "leerPeso", "leerRegistro",
    "pendientes", "subirFoto", "urlFoto",
  ].sort();
  assert.deepEqual(Object.keys(api).sort(), esperadas);
  const demo = await import("../docs/js/demo.js");
  assert.deepEqual(Object.keys(demo).sort(), esperadas, "misma API que demo.js");
});
