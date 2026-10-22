// Implementación real de datos: login con Google Identity Services (token model) y la API REST v3
// de Drive por fetch. Misma API que demo.js (ver "Datos" en CONTRATO.md).
// Todo se busca por appProperties.quecomo, nunca por nombre. Los ids quedan solo en memoria: si
// Pablo manda algo a la papelera, la próxima carga de la página lo vuelve a buscar.
import { CLIENT_ID, SCOPE, CARPETA_RAIZ, CARPETA_FOTOS } from "../config.js";
import { errorDatos } from "./datos.js";
import { isoConZona } from "./util.js";

const GSI = "https://accounts.google.com/gsi/client";
const API = "https://www.googleapis.com/drive/v3";
const SUBIDA = "https://www.googleapis.com/upload/drive/v3/files";
const TIPO_CARPETA = "application/vnd.google-apps.folder";
const TIPO_JSON = "application/json; charset=UTF-8";

const CLAVE_TOKEN = "quecomo-token";
const CLAVE_EMAIL = "quecomo-email";
const MARGEN_MS = 60000;          // el token se da por vencido un minuto antes de que venza
const ESPERAS_MS = [500, 1500];   // reintentos ante 429, 5xx o límite de uso de Drive
const LIMITE_MS = 30000;          // un pedido que tarda más se corta (señal colgada del celu)
const LIMITE_SUBIDA_MS = 120000;  // ídem para subir o bajar archivos

const NOMBRES_JSON = { registro: "registro.json", perfil: "perfil.json", peso: "peso.json" };

const MSJ_SIN_LOGIN = "Tenés que conectar el Drive.";
const MSJ_VENCIDO = "Se venció el permiso del Drive: tocá Conectar.";
const MSJ_SIN_CONEXION = "No hay conexión a internet.";
const MSJ_LENTO = "La conexión tardó demasiado.";

const ERRORES_VENTANA = {
  popup_closed: "Se cerró la ventana de Google sin conectar.",
  popup_failed_to_open: "El navegador no dejó abrir la ventana de Google: tocá Conectar de nuevo.",
};
const MSJ_CANCELADO = "Cancelaste el permiso en Google. Para usar el Drive, tocá Conectar y aceptalo.";
const MSJ_SIN_PERMISO_DRIVE =
  "No diste permiso para guardar en el Drive: tocá Conectar y marcá la casilla del Drive.";

const copia = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- token (localStorage)

let tokenMemoria = null;   // solo si localStorage no anda (navegación privada, etc.)

const almacen = () => globalThis.localStorage || null;

/** {access_token, exp (ms), email} guardado, vigente o no; null si no hay. */
function leerToken() {
  try {
    const t = JSON.parse(almacen()?.getItem(CLAVE_TOKEN) ?? "null");
    if (t && t.access_token) return t;
  } catch { /* token roto: como si no hubiera */ }
  return tokenMemoria;
}

function guardarToken(t) {
  tokenMemoria = null;
  try { almacen().setItem(CLAVE_TOKEN, JSON.stringify(t)); } catch { tokenMemoria = t; }
}

function borrarToken() {
  tokenMemoria = null;
  try { almacen()?.removeItem(CLAVE_TOKEN); } catch { /* nada que borrar */ }
}

function ultimoEmail() {
  try { return almacen()?.getItem(CLAVE_EMAIL) || null; } catch { return null; }
}

function recordarEmail(email) {
  try { almacen()?.setItem(CLAVE_EMAIL, email); } catch { /* sin login_hint la próxima */ }
}

const vigente = (t) => !!t && Number(t.exp) > Date.now() + MARGEN_MS;

// ---------------------------------------------------------------- avisos de sesión

let reloj = null;
let expProgramado = null;
let vigilando = false;

/** Avisa a app.js que la sesión cambió (conectó, venció, desconectó). */
function avisarSesion() {
  programarVencimiento();
  globalThis.window?.dispatchEvent?.(new Event("quecomo:sesion"));
}

/** Deja un timer para avisar cuando el token guardado deje de estar vigente. */
function programarVencimiento() {
  const t = leerToken();
  const exp = vigente(t) ? Number(t.exp) : null;
  if (exp === expProgramado) return;
  clearTimeout(reloj);
  reloj = null;
  expProgramado = exp;
  if (exp == null) return;
  const ms = Math.min(exp - MARGEN_MS - Date.now(), 2 ** 31 - 1);
  reloj = setTimeout(() => { expProgramado = null; avisarSesion(); }, ms);
  reloj?.unref?.();   // en Node (pruebas) el timer no retiene el proceso
}

/** Otra pestaña conectó o desconectó: comparten la clave de localStorage. */
function vigilar() {
  if (vigilando) return;
  vigilando = true;
  globalThis.window?.addEventListener?.("storage", (e) => {
    if (e.key === CLAVE_TOKEN) avisarSesion();
  });
}

// ---------------------------------------------------------------- login (Google Identity Services)

let cargaGIS = null;
let conectando = null;

const oauth2 = () => globalThis.google?.accounts?.oauth2;

/** Carga el script de Google una sola vez (al importar este módulo; si falló, al conectar). */
function cargarGIS() {
  if (oauth2()) return Promise.resolve();
  if (!cargaGIS) {
    const script = document.createElement("script");
    cargaGIS = new Promise((resolver, rechazar) => {
      script.src = GSI;
      script.async = true;
      script.onload = () => (oauth2() ? resolver()
        : rechazar(errorDatos("sin_login", "No pude cargar el login de Google. Probá de nuevo.")));
      script.onerror = () => rechazar(errorDatos("sin_conexion",
        "No pude cargar el login de Google: revisá la conexión."));
      document.head.append(script);
    }).catch((e) => {
      cargaGIS = null;
      script.remove?.();
      throw e;
    });
  }
  return cargaGIS;
}

/**
 * Empieza a cargar el script de Google apenas se importa drive.js, sin esperarlo: así, al tocar
 * Conectar, la ventana se abre dentro del toque. Si se carga recién ahí, la ventana sale después
 * de un await y Safari (iOS) la bloquea. Si falla, conectar() lo vuelve a intentar.
 */
function precargarGIS() {
  if (!CLIENT_ID || typeof document === "undefined" || !document.head) return;
  cargarGIS().catch(() => { /* se reintenta al conectar */ });
}

precargarGIS();

/** Abre la ventana de Google y espera el token. Se llama de forma síncrona desde el toque. */
function pedirToken() {
  return new Promise((resolver, rechazar) => {
    const cliente = oauth2().initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r && r.access_token) return resolver(r);
        rechazar(errorDatos("sin_login", r?.error === "access_denied" ? MSJ_CANCELADO
          : `Google no dio el permiso (${r?.error || "sin respuesta"}). Tocá Conectar de nuevo.`));
      },
      error_callback: (e) => rechazar(errorDatos("sin_login",
        ERRORES_VENTANA[e?.type] || "No se pudo conectar con Google. Tocá Conectar de nuevo.")),
    });
    const pedido = { prompt: "" };
    const email = ultimoEmail();
    if (email) pedido.login_hint = email;
    cliente.requestAccessToken(pedido);
  });
}

async function conectarAhora() {
  // Si el script ya está (lo normal: se precarga al importar), la ventana se abre sin pasar por
  // un await (los navegadores la bloquean si se pierde el "toque del usuario"). Si todavía no
  // cargó, se espera y se intenta igual; si el navegador la bloquea, el mensaje pide tocar de nuevo.
  const r = await (oauth2() ? pedirToken() : cargarGIS().then(pedirToken));
  if (typeof r.scope === "string" && !r.scope.split(" ").includes(SCOPE)) {
    throw errorDatos("sin_login", MSJ_SIN_PERMISO_DRIVE);
  }
  const exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
  olvidarIds();   // puede ser otra cuenta
  guardarToken({ access_token: r.access_token, exp, email: null });
  const email = await pedirEmail();
  guardarToken({ access_token: r.access_token, exp, email });
  if (email) recordarEmail(email);
  avisarSesion();
}

async function pedirEmail() {
  try {
    const r = await pedir(`${API}/about?fields=${encodeURIComponent("user(emailAddress)")}`);
    return r?.user?.emailAddress || null;
  } catch (e) {
    if (e.codigo === "sin_login") throw e;
    return null;   // sin email la cabecera dice "Conectado"; no vale la pena fallar por esto
  }
}

// ---------------------------------------------------------------- pedidos a Drive

/** El access token vigente, o tira sin_login (y avisa si estaba guardado pero venció). */
function tokenParaPedir() {
  const t = leerToken();
  if (vigente(t)) return t.access_token;
  if (t) {
    borrarToken();
    avisarSesion();
    throw errorDatos("sin_login", MSJ_VENCIDO);
  }
  throw errorDatos("sin_login", MSJ_SIN_LOGIN);
}

/**
 * fetch con el token. como: "json" | "texto" | "blob". Reintenta 429, 5xx y límites de uso;
 * un 401 borra el token y tira sin_login. limite: ms hasta cortar el pedido (→ sin_conexion).
 * antesDeReintentar: () => Promise<resultado|undefined>; si da algo, se devuelve eso en vez de
 * repetir el pedido (una subida que Drive guardó aunque respondió con error).
 */
async function pedir(url, { metodo = "GET", cuerpo, tipo, como = "json", limite = LIMITE_MS,
  antesDeReintentar } = {}) {
  for (let intento = 0; ; intento++) {
    const token = tokenParaPedir();
    if (globalThis.navigator?.onLine === false) throw errorDatos("sin_conexion", MSJ_SIN_CONEXION);
    const headers = { Authorization: `Bearer ${token}` };
    if (tipo) headers["Content-Type"] = tipo;
    const corte = cortarEn(limite);
    let res, mensaje, razon;
    try {
      try {
        res = await fetch(url, { method: metodo, headers, body: cuerpo, signal: corte.senal });
      } catch {
        throw errorDatos("sin_conexion", corte.vencido() ? MSJ_LENTO : MSJ_SIN_CONEXION);
      }
      if (res.ok) return await leerRespuesta(res, como, corte);
      if (res.status === 401) {
        borrarToken();
        avisarSesion();
        throw errorDatos("sin_login", MSJ_VENCIDO);
      }
      ({ mensaje, razon } = await detalleError(res));
    } finally {
      corte.listo();
    }
    if (reintentable(res.status, razon) && intento < ESPERAS_MS.length) {
      await esperar(ESPERAS_MS[intento]);
      const ya = antesDeReintentar ? await antesDeReintentar() : undefined;
      if (ya !== undefined) return ya;
      continue;
    }
    if (res.status === 404) olvidarIds();
    throw errorDatos("drive", mensajeDrive(res.status, mensaje, razon));
  }
}

/** Corta el pedido (AbortController) si tarda más de ms. listo() apaga el reloj. */
function cortarEn(ms) {
  if (typeof AbortController !== "function") return { senal: undefined, vencido: () => false, listo() {} };
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  reloj?.unref?.();   // en Node (pruebas) el timer no retiene el proceso
  return {
    senal: control.signal,
    vencido: () => control.signal.aborted,
    listo: () => clearTimeout(reloj),
  };
}

async function leerRespuesta(res, como, corte) {
  try {
    if (como === "blob") return await res.blob();
    if (como === "texto") return await res.text();
    if (res.status === 204) return null;
    return await res.json();
  } catch {
    throw errorDatos("sin_conexion", corte.vencido() ? MSJ_LENTO
      : "Se cortó la conexión mientras bajaba datos del Drive.");
  }
}

async function detalleError(res) {
  try {
    const { error } = await res.json();
    return { mensaje: error?.message || "", razon: error?.errors?.[0]?.reason || "" };
  } catch {
    return { mensaje: "", razon: "" };
  }
}

function reintentable(status, razon) {
  return status === 429 || status >= 500 ||
    (status === 403 && (razon === "rateLimitExceeded" || razon === "userRateLimitExceeded"));
}

function mensajeDrive(status, mensaje, razon) {
  if (status === 404) return "No encuentro el archivo en el Drive (¿se borró?).";
  if (razon === "storageQuotaExceeded") return "El Drive está lleno: liberá espacio para poder subir más.";
  return mensaje ? `Drive respondió con un error: ${mensaje} (código ${status}).`
    : `Drive respondió con un error (código ${status}).`;
}

/** PATCH/POST de metadatos en JSON. */
function pedirJSON(url, metodo, datos) {
  return pedir(url, { metodo, cuerpo: JSON.stringify(datos), tipo: TIPO_JSON });
}

/** Lista todos los archivos que cumplen q (sigue nextPageToken). maximo: una sola página. */
async function listar(q, { campos = "id", orden, maximo } = {}) {
  const archivos = [];
  let pagina = null;
  do {
    const params = new URLSearchParams({
      q, fields: `nextPageToken, files(${campos})`, pageSize: String(maximo || 1000), spaces: "drive",
    });
    if (orden) params.set("orderBy", orden);
    if (pagina) params.set("pageToken", pagina);
    const r = await pedir(`${API}/files?${params}`);
    archivos.push(...(r.files || []));
    pagina = maximo ? null : r.nextPageToken;
  } while (pagina);
  return archivos;
}

/** Cuerpo multipart/related: la parte de metadatos (JSON) y la del contenido. */
function multipart(metadatos, contenido, tipoContenido) {
  const limite = `quecomo-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const cuerpo = new Blob([
    `--${limite}\r\nContent-Type: ${TIPO_JSON}\r\n\r\n`,
    JSON.stringify(metadatos),
    `\r\n--${limite}\r\nContent-Type: ${tipoContenido}\r\n\r\n`,
    contenido,
    `\r\n--${limite}--`,
  ]);
  return { cuerpo, tipo: `multipart/related; boundary=${limite}` };
}

/**
 * Crea un archivo con su contenido. Si los metadatos traen appProperties.pieza y Drive responde
 * con un error que se reintenta, antes de mandarlo de nuevo se fija si igual quedó guardado.
 */
async function subirArchivo(metadatos, contenido, tipoContenido) {
  const { cuerpo, tipo } = multipart(metadatos, contenido, tipoContenido);
  const pieza = metadatos.appProperties?.pieza;
  const antesDeReintentar = pieza
    ? async () => { const p = await buscarPieza(pieza); return p ? { id: p.id } : undefined; }
    : undefined;
  const r = await pedir(`${SUBIDA}?uploadType=multipart&fields=id`,
    { metodo: "POST", cuerpo, tipo, limite: LIMITE_SUBIDA_MS, antesDeReintentar });
  return r.id;
}

function parchear(id, cambios) {
  return pedirJSON(`${API}/files/${encodeURIComponent(id)}?fields=id`, "PATCH", cambios);
}

// ---------------------------------------------------------------- carpetas y archivos (ids)

const escapar = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const tiene = (clave, valor) => `appProperties has { key='${clave}' and value='${escapar(valor)}' }`;

// clase ("raiz", "fotos", "registro"…) → promesa del id. Guarda también el pedido en curso, así
// dos llamadas a la vez no crean dos carpetas. Un "no existe" (null) no se recuerda.
const ids = new Map();

function recordar(clase, buscar) {
  if (!ids.has(clase)) {
    const p = buscar().then(
      (id) => { if (!id && ids.get(clase) === p) ids.delete(clase); return id; },
      (e) => { if (ids.get(clase) === p) ids.delete(clase); throw e; });
    ids.set(clase, p);
  }
  return ids.get(clase);
}

function olvidarIds() {
  ids.clear();
  numeros.clear();
}

/** El id del más viejo con appProperties.quecomo = clase (si hay varios, gana el primero creado). */
async function buscarPorClase(clase) {
  const [primero] = await listar(`${tiene("quecomo", clase)} and trashed = false`,
    { orden: "createdTime", maximo: 1 });
  return primero ? primero.id : null;
}

async function crearCarpeta(nombre, clase, padre) {
  const r = await pedirJSON(`${API}/files?fields=id`, "POST",
    { name: nombre, mimeType: TIPO_CARPETA, parents: [padre], appProperties: { quecomo: clase } });
  // Si qc.py creó otra justo al mismo tiempo, usar la más vieja (la misma que va a usar él).
  return (await buscarPorClase(clase)) || r.id;
}

function idCarpetaRaiz() {
  return recordar("raiz", async () =>
    (await buscarPorClase("raiz")) || crearCarpeta(CARPETA_RAIZ, "raiz", "root"));
}

function idCarpetaFotos() {
  return recordar("fotos", async () =>
    (await buscarPorClase("fotos")) || crearCarpeta(CARPETA_FOTOS, "fotos", await idCarpetaRaiz()));
}

/** Id de registro/perfil/peso, o null si no existe. Con crear(), lo crea si falta. */
async function idJSON(clase, crear) {
  for (;;) {
    const id = await recordar(clase, async () =>
      (await buscarPorClase(clase)) || (crear ? crear() : null));
    // null con crear: había una lectura en curso que no lo encontró; ahora sí lo creamos.
    if (id || !crear) return id;
  }
}

// ---------------------------------------------------------------- capturas

// grupo → promesa del último número de pieza usado (encadenada: dos subidas a la vez del mismo
// grupo reciben números distintos).
const numeros = new Map();

function siguienteNumero(grupo) {
  const previo = numeros.get(grupo) || piezasDe(grupo).then((l) => l.length);
  const p = previo.then((n) => n + 1);
  numeros.set(grupo, p);
  p.catch(() => { if (numeros.get(grupo) === p) numeros.delete(grupo); });
  return p;
}

/** "2026-10-22_13-40-12_a3f9.jpg"; la segunda pieza del grupo "…_a3f9_2.jpg", y así. */
async function nombrePieza(grupo, tomada, ext) {
  const n = await siguienteNumero(grupo);
  const marca = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(tomada || "")
    ? `${tomada.slice(0, 10)}_${tomada.slice(11, 19).replaceAll(":", "-")}`
    : String(grupo).replace(/^g-/, "");
  return `${marca}_${String(grupo).slice(-4)}${n > 1 ? `_${n}` : ""}.${ext}`;
}

/** Piezas (fotos y textos) de un grupo, en cualquier estado. */
function piezasDe(grupo) {
  return listar(`${tiene("grupo", grupo)} and trashed = false`, { campos: "id,name,description" });
}

/** Orden de piezas por nombre: "…_a3f9" < "…_a3f9_2" < "…_a3f9_10". */
const sinExtension = (nombre) => String(nombre || "").replace(/\.[^.]*$/, "");
const compararNombres = (a, b) =>
  sinExtension(a).localeCompare(sinExtension(b), undefined, { numeric: true });

/** La pieza (foto o texto) con appProperties.pieza = pieza, o null. → {id, description} */
async function buscarPieza(pieza) {
  const [p] = await listar(`${tiene("pieza", pieza)} and trashed = false`,
    { campos: "id,description", orden: "createdTime", maximo: 1 });
  return p || null;
}

/** appProperties de una pieza nueva; `pieza` (id fijo de la cola) solo si vino. */
function propiedadesPieza(quecomo, { grupo, tomada, pieza }) {
  const ap = { quecomo, grupo, tomada, estado: "pendiente" };
  if (pieza) ap.pieza = String(pieza);
  return ap;
}

/**
 * Sube una foto. Opciones además del contrato: `pieza` (id fijo que pone la cola, va en
 * appProperties.pieza) y `reintento` (true si ya se mandó antes): entonces primero busca la
 * pieza en el Drive y, si ya está (la subida anterior llegó pero se perdió la respuesta), no
 * la crea de nuevo.
 */
export async function subirFoto(blob, { grupo, tomada, nota = "", pieza, reintento = false }) {
  const previa = pieza && reintento ? await buscarPieza(pieza) : null;
  if (previa) {
    if ((previa.description || "") !== (nota || "")) await parchear(previa.id, { description: nota || "" });
    if (nota) await igualarNota(grupo, nota, previa.id);
    return { id: previa.id };
  }
  const [carpeta, nombre] = await Promise.all([idCarpetaFotos(), nombrePieza(grupo, tomada, "jpg")]);
  const id = await subirArchivo({
    name: nombre, mimeType: "image/jpeg", parents: [carpeta], description: nota || "",
    appProperties: propiedadesPieza("foto", { grupo, tomada, pieza }),
  }, blob, "image/jpeg");
  if (nota) await igualarNota(grupo, nota, id);
  return { id };
}

/** Como en demo.js: una foto nueva con nota pone esa nota en las otras piezas del grupo. */
async function igualarNota(grupo, nota, excepto) {
  try {
    const otras = (await piezasDe(grupo))
      .filter((p) => p.id !== excepto && (p.description || "") !== nota);
    await Promise.all(otras.map((p) => parchear(p.id, { description: nota })));
  } catch {
    // La foto ya subió: no fallar (la cola la volvería a subir). La nota se puede cambiar después.
  }
}

/** Crea un texto suelto. `pieza` y `reintento` como en subirFoto. */
export async function crearTexto(texto, { grupo, tomada, pieza, reintento = false }) {
  const previa = pieza && reintento ? await buscarPieza(pieza) : null;
  if (previa) return { id: previa.id };
  const [carpeta, nombre] = await Promise.all([idCarpetaFotos(), nombrePieza(grupo, tomada, "txt")]);
  const id = await subirArchivo({
    name: nombre, mimeType: "text/plain", parents: [carpeta], description: texto,
    appProperties: propiedadesPieza("texto", { grupo, tomada, pieza }),
  }, texto, "text/plain; charset=UTF-8");
  return { id };
}

export async function pendientes() {
  const q = `(${tiene("quecomo", "foto")} or ${tiene("quecomo", "texto")}) and ` +
    `${tiene("estado", "pendiente")} and trashed = false`;
  const archivos = await listar(q, { campos: "id,name,mimeType,description,appProperties" });
  const grupos = new Map();
  for (const a of archivos) {
    const ap = a.appProperties || {};
    if (!ap.grupo) continue;
    let g = grupos.get(ap.grupo);
    if (!g) grupos.set(ap.grupo, (g = { grupo: ap.grupo, tomada: ap.tomada || "", nota: "", piezas: [] }));
    if (ap.tomada && (!g.tomada || ap.tomada < g.tomada)) g.tomada = ap.tomada;
    g.piezas.push({ id: a.id, tipo: ap.quecomo === "texto" ? "texto" : "foto", nombre: a.name,
      nota: a.description || "" });
  }
  for (const g of grupos.values()) {
    g.piezas.sort((a, b) => compararNombres(a.nombre, b.nombre));
    g.nota = (g.piezas.find((p) => p.nota) || { nota: "" }).nota;
    g.piezas = g.piezas.map(({ id, tipo, nombre }) => ({ id, tipo, nombre }));
  }
  return [...grupos.values()].sort((a, b) => a.tomada.localeCompare(b.tomada));
}

export async function cambiarNota(grupo, nota) {
  const piezas = await piezasDe(grupo);
  await Promise.all(piezas.map((p) => parchear(p.id, { description: nota || "" })));
}

export async function descartar(grupo) {
  const piezas = await piezasDe(grupo);
  // PATCH mezcla las claves de appProperties: solo cambia estado.
  await Promise.all(piezas.map((p) => parchear(p.id, { appProperties: { estado: "descartada" } })));
}

// id → promesa de la object URL (también la del pedido en curso).
const fotos = new Map();

export async function urlFoto(id) {
  if (!fotos.has(id)) {
    const p = pedir(`${API}/files/${encodeURIComponent(id)}?alt=media`,
      { como: "blob", limite: LIMITE_SUBIDA_MS })
      .then((blob) => URL.createObjectURL(blob));
    p.catch(() => { if (fotos.get(id) === p) fotos.delete(id); });
    fotos.set(id, p);
  }
  return fotos.get(id);
}

function olvidarFotos() {
  for (const p of fotos.values()) p.then((u) => URL.revokeObjectURL(u), () => {});
  fotos.clear();
}

// ---------------------------------------------------------------- archivos JSON

/** El contenido de registro/perfil/peso, o null si no existe (o está vacío). */
async function leerJSON(clase) {
  const id = await idJSON(clase);
  if (!id) return null;
  const texto = await pedir(`${API}/files/${encodeURIComponent(id)}?alt=media`,
    { como: "texto", limite: LIMITE_SUBIDA_MS });
  if (!texto.trim()) return null;
  try {
    return JSON.parse(texto);
  } catch {
    throw errorDatos("drive", `El archivo ${NOMBRES_JSON[clase]} del Drive está dañado (no es JSON ` +
      "válido). No lo toco: arreglalo en el Drive o pedile ayuda a Claude.");
  }
}

function formaRara(clase) {
  return errorDatos("drive", `El archivo ${NOMBRES_JSON[clase]} del Drive no tiene la forma esperada. ` +
    "No lo toco: arreglalo en el Drive o pedile ayuda a Claude.");
}

/** Escribe el JSON (con sangría de 2, por si Pablo lo abre). Lo crea en la raíz si falta. */
async function escribirJSON(clase, datos) {
  const texto = JSON.stringify(datos, null, 2) + "\n";
  let creadoAhora = false;
  const id = await idJSON(clase, async () => {
    creadoAhora = true;
    return subirArchivo({
      name: NOMBRES_JSON[clase], mimeType: "application/json", parents: [await idCarpetaRaiz()],
      appProperties: { quecomo: clase },
    }, texto, TIPO_JSON);
  });
  if (!creadoAhora) {
    await pedir(`${SUBIDA}/${encodeURIComponent(id)}?uploadType=media&fields=id`,
      { metodo: "PATCH", cuerpo: texto, tipo: TIPO_JSON, limite: LIMITE_SUBIDA_MS });
  }
}

export async function leerRegistro() {
  const r = await leerJSON("registro");
  if (r == null) return { version: 1, comidas: [] };
  if (typeof r !== "object" || !Array.isArray(r.comidas)) throw formaRara("registro");
  return r;
}

export async function actualizarRegistro(fn) {
  const borrador = await leerRegistro();
  const nuevo = (await fn(borrador)) ?? borrador;
  nuevo.actualizado = isoConZona();
  await escribirJSON("registro", nuevo);
  return copia(nuevo);
}

export async function leerPerfil() {
  const p = await leerJSON("perfil");
  if (p != null && typeof p !== "object") throw formaRara("perfil");
  return p;
}

export async function guardarPerfil(perfil) {
  await escribirJSON("perfil", copia(perfil));
}

export async function leerPeso() {
  const p = await leerJSON("peso");
  if (p == null) return { version: 1, registros: [] };
  if (typeof p !== "object" || !Array.isArray(p.registros)) throw formaRara("peso");
  return p;
}

export async function guardarPeso(datos) {
  const d = copia(datos);
  d.registros = [...(d.registros || [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  await escribirJSON("peso", d);
}

// ---------------------------------------------------------------- sesión (API)

export function estado() {
  vigilar();
  programarVencimiento();
  const t = leerToken();
  if (!vigente(t)) return { conectado: false, email: null, demo: false };
  return { conectado: true, email: t.email || null, demo: false };
}

/** Pide el token (abre la ventana de Google). Llamar solo desde un toque. */
export function conectar() {
  if (!conectando) conectando = conectarAhora().finally(() => { conectando = null; });
  return conectando;
}

export async function desconectar() {
  const t = leerToken();
  borrarToken();
  olvidarIds();
  olvidarFotos();
  if (t && oauth2()) {
    try { oauth2().revoke(t.access_token, () => {}); } catch { /* ya no sirve igual */ }
  }
  avisarSesion();
}
