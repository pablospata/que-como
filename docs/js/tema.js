// Tema claro / oscuro. Sin elección sigue al sistema; el botón guarda la elección en este
// dispositivo (index.html la aplica antes de pintar). Lo usan la cabecera y la cámara.
import { el, icono } from "./util.js";

const CLAVE = "quecomo-tema";
const sistema = matchMedia("(prefers-color-scheme: dark)");
const botones = new Set();

function temaActual() {
  return document.documentElement.dataset.theme || (sistema.matches ? "dark" : "light");
}

function pintar(boton) {
  const oscuro = temaActual() === "dark";
  const etiqueta = oscuro ? "Pasar a modo claro" : "Pasar a modo oscuro";
  boton.replaceChildren(icono(oscuro ? "sol" : "luna", 20));
  boton.setAttribute("aria-label", etiqueta);
  boton.title = etiqueta;
}

function alternar() {
  const nuevo = temaActual() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem(CLAVE, nuevo); } catch { /* sin almacenamiento: dura hasta recargar */ }
  for (const b of botones) pintar(b);
}

sistema.addEventListener("change", () => { for (const b of botones) pintar(b); });

/** Botón de tema. Si se pasa uno existente (el de la cabecera) lo arma; si no, crea uno. */
export function botonTema(boton = el("button", { class: "btn-icono", type: "button" })) {
  boton.addEventListener("click", alternar);
  botones.add(boton);
  pintar(boton);
  return boton;
}

/** Para botones que se crean y destruyen con una vista. */
export function soltarBotonTema(boton) {
  botones.delete(boton);
}
