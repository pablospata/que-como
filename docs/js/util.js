// Utilidades compartidas: fechas locales, formato argentino, armado de DOM, íconos y avisos.

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

const dos = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- fechas (siempre hora local)

/** Date → "2026-10-22" (día local). */
export function fechaISO(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export const hoyISO = () => fechaISO(new Date());

/** "2026-10-22" → Date a las 00:00 locales. */
export function parseFecha(iso) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
}

export function sumarDias(iso, n) {
  const d = parseFecha(iso);
  d.setDate(d.getDate() + n);
  return fechaISO(d);
}

/** Días calendario de a hasta b (b − a). */
export function diasEntre(a, b) {
  return Math.round((parseFecha(b) - parseFecha(a)) / 86400000);
}

/** El lunes de la semana de esa fecha. */
export function lunesDe(iso) {
  const d = parseFecha(iso);
  return sumarDias(iso, -((d.getDay() + 6) % 7));
}

/** Date → "2026-10-22T13:40:12-03:00" (hora local con zona). */
export function isoConZona(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const signo = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${fechaISO(d)}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}` +
    `${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

/** Nuevo id de captura: "g-20261022-134012-a3f9". */
export function nuevoGrupo(d = new Date()) {
  const azar = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `g-${fechaISO(d).replaceAll("-", "")}-${dos(d.getHours())}${dos(d.getMinutes())}` +
    `${dos(d.getSeconds())}-${azar}`;
}

/** "2026-10-22" → "mié 22/10" (corto) o "miércoles 22 de octubre" (largo). */
export function formatoFecha(iso, { largo = false, anio = false } = {}) {
  const d = parseFecha(iso);
  if (largo) {
    return `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}` +
      (anio ? ` de ${d.getFullYear()}` : "");
  }
  return `${DIAS[d.getDay()]} ${dos(d.getDate())}/${dos(d.getMonth() + 1)}` +
    (anio ? `/${d.getFullYear()}` : "");
}

export const nombreDia = (iso) => DIAS[parseFecha(iso).getDay()];
export const nombreMes = (i) => MESES[i];

/** "Hoy", "Ayer" o la fecha corta. */
export function fechaRelativa(iso) {
  const hoy = hoyISO();
  if (iso === hoy) return "Hoy";
  if (iso === sumarDias(hoy, -1)) return "Ayer";
  return formatoFecha(iso);
}

/** ISO con zona → "13:40". */
export const horaDe = (isoZona) => isoZona.slice(11, 16);

// ---------------------------------------------------------------- números

/** 1850 → "1.850"; 82.43 con 1 decimal → "82,4". */
export function num(n, decimales = 0) {
  if (n == null || Number.isNaN(n)) return "–";
  return Number(n).toLocaleString("es-AR", {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  });
}

// ---------------------------------------------------------------- DOM

/**
 * el("div", {class: "tarjeta", onclick: fn, "aria-label": "…"}, hijo1, "texto", [hijos]…)
 * Atributos: class, style (texto), on<evento> (función), dataset (objeto), hidden/disabled
 * (booleanos), html (innerHTML: solo para SVG propio, nunca para texto de datos).
 */
export function el(tag, attrs = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") nodo.className = v;
    else if (k === "html") nodo.innerHTML = v;
    else if (k === "dataset") Object.assign(nodo.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") nodo.addEventListener(k.slice(2), v);
    else if (v === true) nodo.setAttribute(k, "");
    else nodo.setAttribute(k, v);
  }
  agregar(nodo, hijos);
  return nodo;
}

function agregar(nodo, hijos) {
  for (const h of hijos) {
    if (h == null || h === false) continue;
    if (Array.isArray(h)) agregar(nodo, h);
    else nodo.append(h instanceof Node ? h : String(h));
  }
}

// ---------------------------------------------------------------- íconos (SVG de trazo)

const TRAZOS = {
  camara: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.8"/>',
  galeria: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
  texto: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  panel: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
  izq: '<path d="M15 5l-7 7 7 7"/>',
  der: '<path d="M9 5l7 7-7 7"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  borrar: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  nota: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/>',
  nube: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18z"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  revisar: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  balanza: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9a5 5 0 0 1 8 0"/><path d="M12 9l1.5-2"/>',
  salir: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
};

/** Ícono SVG (elemento). Decorativo: el botón que lo contiene lleva el aria-label. */
export function icono(nombre, tam = 24) {
  const span = document.createElement("span");
  span.className = `icono icono-${nombre}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    `${TRAZOS[nombre] || ""}</svg>`;
  return span;
}

// ---------------------------------------------------------------- avisos

/** Aviso breve abajo. tipo: ok | error | info. */
export function toast(texto, { tipo = "info", ms = 3500 } = {}) {
  const caja = document.getElementById("toasts");
  if (!caja) return;
  const t = el("div", { class: `toast toast-${tipo}`, role: tipo === "error" ? "alert" : "status" }, texto);
  caja.append(t);
  requestAnimationFrame(() => t.classList.add("visible"));
  setTimeout(() => {
    t.classList.remove("visible");
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/** Mensaje de un error de datos (los de datos.js ya vienen en español). */
export function mensajeError(e) {
  if (e && e.codigo) return e.message;
  return "Algo falló: " + ((e && e.message) || String(e));
}
