// Arranque de la página: rutas (#/...), sesión, insignia de pendientes y montaje de vistas.
import { obtenerDatos, esDemo } from "./datos.js";
import { el, icono, toast, mensajeError } from "./util.js";

const VISTAS = ["captura", "hoy", "semana", "peso", "perfil"];
const REVISAR_PENDIENTES_MS = 120000;

let datos = null;
let desmontar = null;
let montando = 0;

function rutaPorDefecto() {
  return window.innerWidth < 700 ? "captura" : "hoy";
}

function leerRuta() {
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const vista = VISTAS.includes(partes[0]) ? partes[0] : null;
  return { vista, params: partes.slice(1) };
}

export function navegar(ruta) {
  location.hash = ruta.startsWith("#") ? ruta : "#/" + ruta.replace(/^\//, "");
}

// ---------------------------------------------------------------- sesión e insignia

function pintarSesion() {
  const caja = document.getElementById("sesion");
  caja.replaceChildren();
  const st = datos.estado();
  if (st.demo) return;
  if (st.conectado) {
    caja.append(
      el("span", { class: "sesion-email", title: st.email || "" }, st.email || "Conectado"),
      el("button", { class: "btn-icono", "aria-label": "Desconectar", title: "Desconectar",
        onclick: async () => { await datos.desconectar(); pintarSesion(); recargarVista(); } },
      icono("salir", 20)),
    );
  } else {
    caja.append(el("button", { class: "btn btn-primario btn-chico", onclick: conectar }, "Conectar"));
  }
}

async function conectar() {
  try {
    await datos.conectar();
    pintarSesion();
    recargarVista();
    avisarCambio();
  } catch (e) {
    toast(mensajeError(e), { tipo: "error" });
  }
}

async function avisarCambio() {
  const insignia = document.getElementById("insignia-pendientes");
  if (!datos.estado().conectado) {
    insignia.hidden = true;
    return;
  }
  try {
    const lista = await datos.pendientes();
    insignia.hidden = lista.length === 0;
    insignia.textContent = lista.length === 1 ? "1 por procesar" : `${lista.length} por procesar`;
  } catch {
    insignia.hidden = true;
  }
}

// ---------------------------------------------------------------- vistas

function recargarVista() {
  mostrar();
}

async function mostrar() {
  const { vista, params } = leerRuta();
  if (!vista) {
    navegar(rutaPorDefecto());
    return;
  }
  const turno = ++montando;
  if (desmontar) {
    try { desmontar(); } catch { /* la vista anterior ya no importa */ }
    desmontar = null;
  }
  document.body.classList.toggle("modo-captura", vista === "captura");
  for (const a of document.querySelectorAll(".tabs a")) {
    a.classList.toggle("activa", a.dataset.ruta === vista);
    if (a.dataset.ruta === vista) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const contenedor = document.getElementById("vista");
  contenedor.replaceChildren(el("div", { class: "cargando" }, "Cargando…"));
  contenedor.className = `vista vista-${vista}`;

  const ctx = { datos, navegar, toast: (t, o) => toast(t, o), avisarCambio, conectar };
  try {
    const modulo = await import(`./vistas/${vista}.js`);
    if (turno !== montando) return;
    contenedor.replaceChildren();
    const r = await modulo.montar(contenedor, params, ctx);
    if (turno !== montando) {
      if (typeof r === "function") r();
      return;
    }
    desmontar = typeof r === "function" ? r : null;
  } catch (e) {
    if (turno !== montando) return;
    contenedor.replaceChildren(errorVista(e));
  }
}

function errorVista(e) {
  const caja = el("div", { class: "vacio" },
    el("p", {}, e && e.codigo ? e.message : "No pude cargar esta parte: " + mensajeError(e)));
  if (e && e.codigo === "sin_login") {
    caja.append(el("button", { class: "btn btn-primario", onclick: conectar }, "Conectar"));
  }
  return caja;
}

// ---------------------------------------------------------------- arranque

async function iniciar() {
  datos = await obtenerDatos();
  document.getElementById("franja-demo").hidden = !esDemo();
  pintarSesion();
  window.addEventListener("hashchange", mostrar);
  window.addEventListener("quecomo:sesion", () => { pintarSesion(); avisarCambio(); });
  await mostrar();
  avisarCambio();
  setInterval(avisarCambio, REVISAR_PENDIENTES_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") avisarCambio();
  });
  if ("serviceWorker" in navigator && !esDemo()) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

iniciar();
