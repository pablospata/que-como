// Piezas compartidas del panel: tarjeta de comida procesada, tarjeta de captura pendiente,
// visor de fotos, edición a mano, pedido de revisión y diálogo de confirmación.
import { el, icono, horaDe, isoConZona, num, mensajeError, hoyISO, formatoFecha } from "../util.js";

export const TIPOS = {
  desayuno: "Desayuno",
  almuerzo: "Almuerzo",
  merienda: "Merienda",
  cena: "Cena",
  colacion: "Colación",
  bebida: "Bebida",
};

const MACROS = [
  ["kcal", "kcal"],
  ["proteina_g", "P"],
  ["carbos_g", "C"],
  ["grasa_g", "G"],
];

// ---------------------------------------------------------------- utilidades

const NS = "http://www.w3.org/2000/svg";

/** Elemento SVG: svgEl("rect", {x: 0, class: "barra"}, hijos…). */
export function svgEl(tag, attrs = {}, ...hijos) {
  const nodo = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") nodo.addEventListener(k.slice(2), v);
    else nodo.setAttribute(k, v === true ? "" : String(v));
  }
  for (const h of hijos.flat()) {
    if (h == null || h === false) continue;
    nodo.append(h instanceof Node ? h : String(h));
  }
  return nodo;
}

/** pesoActual puede devolver {fecha, kg} o un número: siempre kg o null. */
export function kgDe(x) {
  if (x == null) return null;
  const kg = typeof x === "number" ? x : x.kg;
  return Number.isFinite(kg) ? kg : null;
}

/** Número finito o null. */
export const finito = (x) => (Number.isFinite(x) ? x : null);

/** "13,5" → 13.5; vacío → 0; inválido → NaN. */
function leerNumero(texto) {
  const t = String(texto).trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return 0;
  return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
}

const aTexto = (n) => (n == null ? "" : String(n).replace(".", ","));

/** Totales enteros: la suma de los items, redondeada. */
export function totales(items) {
  const t = {};
  for (const [k] of MACROS) t[k] = Math.round(items.reduce((s, it) => s + (Number(it[k]) || 0), 0));
  return t;
}

/** ¿Los items leídos del formulario difieren de los originales (con el mismo redondeo)? */
function itemsCambiaron(antes, despues) {
  if (antes.length !== despues.length) return true;
  const redondeo = (k, x) => (k === "kcal" ? Math.round(x) : Math.round(x * 10) / 10);
  return despues.some((it, i) => {
    const a = antes[i] || {};
    if (String(a.nombre ?? "").trim() !== it.nombre || String(a.porcion ?? "").trim() !== it.porcion) return true;
    return MACROS.some(([k]) => redondeo(k, Number(a[k]) || 0) !== it[k]);
  });
}

/** Entero tal cual; con decimales, uno solo ("7,5"). */
const numItem = (n) => (Number.isInteger(Number(n)) ? num(n) : num(n, 1));

const macrosTexto = (x) =>
  `P ${num(x.proteina_g)} g · C ${num(x.carbos_g)} g · G ${num(x.grasa_g)} g`;

/** "⋯" (no está en util.js). */
function iconoPuntos() {
  const span = el("span", { class: "icono", "aria-hidden": "true" });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round"><path d="M5.5 12h.01M12 12h.01M18.5 12h.01"/></svg>';
  return span;
}

function enUso(boton, ocupado) {
  boton.disabled = ocupado;
  boton.setAttribute("aria-busy", ocupado ? "true" : "false");
}

// ---------------------------------------------------------------- día y hora

const MSJ_FUTURO = "La fecha y hora no pueden ser posteriores a ahora.";

/** "2026-10-22" + "13:40" → Date local; null si falta algo. */
function momentoDe(fecha, hora, segundos = 0) {
  if (!/^\d{4}-\d\d-\d\d$/.test(fecha || "") || !/^\d\d:\d\d/.test(hora || "")) return null;
  const [a, m, d] = fecha.split("-").map(Number);
  const [h, min] = hora.split(":").map(Number);
  return new Date(a, m - 1, d, h, min, segundos);
}

/** Campos de día y hora (en el celu, uno abajo del otro). conEtiquetas: con "Día" y "Hora" visibles. */
function camposCuando(fecha, hora, { conEtiquetas = false } = {}) {
  const dia = el("input", { type: "date", class: "entrada-texto", value: fecha || "", max: hoyISO(),
    required: true, "aria-label": "Día" });
  const hh = el("input", { type: "time", class: "entrada-texto", value: hora || "", required: true,
    "aria-label": "Hora" });
  const caja = el("div", { class: "campos-cuando" },
    conEtiquetas ? el("label", { class: "campo" }, el("span", {}, "Día"), dia) : dia,
    conEtiquetas ? el("label", { class: "campo" }, el("span", {}, "Hora"), hh) : hh);
  return { caja, dia, hora: hh };
}

/**
 * Lee día y hora de los campos. → Date, o null y el aviso escrito (falta algo o es a futuro).
 * segundos: los de la hora original (si el resultado queda a futuro por eso, se usa ahora).
 */
function leerCuando(campos, aviso, segundos = 0) {
  const ahora = new Date();
  const fecha = campos.dia.value;
  const hora = campos.hora.value.slice(0, 5);
  campos.dia.classList.toggle("invalido", !fecha);
  campos.hora.classList.toggle("invalido", !!fecha && !hora);
  if (!fecha) { aviso.textContent = "Elegí el día."; campos.dia.focus(); return null; }
  if (!hora) { aviso.textContent = "Elegí la hora."; campos.hora.focus(); return null; }
  if (momentoDe(fecha, hora) > ahora) {
    aviso.textContent = MSJ_FUTURO;
    campos.dia.classList.add("invalido");
    campos.hora.classList.add("invalido");
    return null;
  }
  aviso.textContent = "";
  const cuando = momentoDe(fecha, hora, segundos);
  return cuando > ahora ? ahora : cuando;
}

// ---------------------------------------------------------------- fotos perezosas

let observador = null;
const esperando = new WeakMap();

function cargarFoto(img, id, datos) {
  img.classList.add("cargando-foto");
  datos.urlFoto(id).then((url) => {
    img.addEventListener("load", () => img.classList.remove("cargando-foto"), { once: true });
    img.src = url;
  }).catch(() => {
    img.classList.remove("cargando-foto");
    img.classList.add("foto-error");
    img.title = "No pude cargar la foto";
  });
}

function fotoPerezosa(img, id, datos) {
  if (!("IntersectionObserver" in window)) {
    cargarFoto(img, id, datos);
    return;
  }
  if (!observador) {
    observador = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        observador.unobserve(e.target);
        const pend = esperando.get(e.target);
        if (pend) cargarFoto(e.target, pend.id, pend.datos);
      }
    }, { rootMargin: "300px" });
  }
  esperando.set(img, { id, datos });
  observador.observe(img);
}

/** Una miniatura que abre el visor con todas las fotos; si hay más de una, lo dice chiquito. */
function miniatura(ids, ctx, titulo, { pendiente = false } = {}) {
  if (!ids.length) {
    return el("div", { class: "miniatura miniatura-vacia", "aria-hidden": "true" }, icono(pendiente ? "texto" : "nota", 20));
  }
  const img = el("img", { alt: "", decoding: "async", width: 72, height: 72 });
  fotoPerezosa(img, ids[0], ctx.datos);
  return el("button", {
    type: "button",
    class: `miniatura${pendiente ? " gris" : ""}`,
    "aria-label": ids.length > 1 ? `Ver las ${ids.length} fotos` : "Ver la foto",
    title: ids.length > 1 ? `${ids.length} fotos` : "Ver la foto",
    onclick: () => abrirFotos(ids, 0, ctx, titulo),
  }, img, ids.length > 1 ? el("span", { class: "miniatura-cuenta num" }, ids.length) : null);
}

// ---------------------------------------------------------------- visor de fotos

let visorAbierto = null;

/** Muestra las fotos grandes; Esc cierra, ← → cambian. */
export function abrirFotos(ids, inicio, ctx, titulo = "") {
  cerrarFotos();
  let i = inicio;
  const img = el("img", { alt: titulo || "Foto de la comida" });
  const contador = el("span", { class: "visor-contador num" });
  const anterior = el("button", { type: "button", class: "btn-icono visor-flecha",
    "aria-label": "Foto anterior", title: "Foto anterior", onclick: () => mover(-1) }, icono("izq", 26));
  const siguiente = el("button", { type: "button", class: "btn-icono visor-flecha",
    "aria-label": "Foto siguiente", title: "Foto siguiente", onclick: () => mover(1) }, icono("der", 26));
  const cerrar = el("button", { type: "button", class: "btn-icono visor-cerrar",
    "aria-label": "Cerrar", title: "Cerrar", onclick: () => dialogo.close() }, icono("cerrar", 24));

  const dialogo = el("dialog", { class: "visor", "aria-label": titulo || "Fotos" },
    el("div", { class: "visor-barra" }, el("span", { class: "visor-titulo" }, titulo), contador, cerrar),
    el("div", { class: "visor-cuerpo" }, ids.length > 1 ? anterior : null,
      el("div", { class: "visor-foto" }, img), ids.length > 1 ? siguiente : null));

  function mostrar() {
    contador.textContent = ids.length > 1 ? `${i + 1} de ${ids.length}` : "";
    img.removeAttribute("src");
    img.classList.add("cargando-foto");
    const pedida = i;
    ctx.datos.urlFoto(ids[i]).then((url) => {
      if (pedida !== i) return;
      img.src = url;
      img.classList.remove("cargando-foto");
    }).catch((e) => {
      img.classList.remove("cargando-foto");
      ctx.toast(mensajeError(e), { tipo: "error" });
    });
  }
  function mover(d) {
    if (ids.length < 2) return;
    i = (i + d + ids.length) % ids.length;
    mostrar();
  }

  dialogo.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); mover(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); mover(1); }
  });
  // Tocar fuera de la foto cierra.
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo || e.target.classList.contains("visor-cuerpo")) dialogo.close();
  });
  dialogo.addEventListener("close", () => {
    dialogo.remove();
    if (visorAbierto === dialogo) visorAbierto = null;
  });

  document.body.append(dialogo);
  visorAbierto = dialogo;
  dialogo.showModal();
  mostrar();
}

export function cerrarFotos() {
  if (visorAbierto) visorAbierto.close();
  visorAbierto = null;
  for (const d of document.querySelectorAll("dialog.confirmar")) d.close();
  // Por las dudas (el evento "close" puede llegar tarde): no dejar visores colgados.
  for (const d of document.querySelectorAll("dialog.visor")) d.remove();
}

// ---------------------------------------------------------------- confirmación

/** Diálogo propio (los textos de confirm() del navegador pueden salir en inglés). */
export function confirmar({ titulo, texto = "", si = "Sí", no = "Cancelar", peligro = false }) {
  for (const d of document.querySelectorAll("dialog.confirmar")) d.close();
  return new Promise((resolver) => {
    let respuesta = false;
    const dialogo = el("dialog", { class: "confirmar tarjeta", "aria-label": titulo },
      el("h2", {}, titulo),
      texto ? el("p", { class: "secundario" }, texto) : null,
      el("div", { class: "fila confirmar-botones" },
        el("button", { type: "button", class: "btn", onclick: () => dialogo.close() }, no),
        el("button", { type: "button", class: `btn ${peligro ? "btn-peligro-lleno" : "btn-primario"}`,
          onclick: () => { respuesta = true; dialogo.close(); } }, si)));
    dialogo.addEventListener("close", () => { dialogo.remove(); resolver(respuesta); });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

// ---------------------------------------------------------------- escrituras al registro

/** Cambia una comida del registro. ordenar: después vuelve a ordenar por fecha y hora. */
async function cambiarComida(ctx, id, fn, { ordenar = false } = {}) {
  let encontrada = false;
  await ctx.datos.actualizarRegistro((reg) => {
    const c = (reg.comidas || []).find((x) => x.id === id);
    if (c) {
      encontrada = true;
      fn(c);
      if (ordenar) {
        const clave = (x) => `${x.fecha || ""} ${x.hora || ""}`;
        reg.comidas.sort((a, b) => clave(a).localeCompare(clave(b)));
      }
    }
    return reg;
  });
  if (!encontrada) {
    const e = new Error("Esa comida ya no está en el registro: recargá la página.");
    e.codigo = "drive";
    throw e;
  }
}

// ---------------------------------------------------------------- comida procesada

// Comidas desplegadas (se mantienen al repintar la vista).
const abiertas = new Set();

/** ¿El clic fue sobre algo que tiene su propia acción? */
const esControl = (t) => !!t.closest("button, a, input, textarea, select, label, form, table");

/**
 * Una comida del registro: foto, hora · título, kcal; los items en una lista liviana.
 * Al desplegarla (clic o ⋯) aparecen la tabla con P/C/G y las acciones.
 * opciones.alCambiar(): se llama después de guardar algo (la vista recarga y repinta).
 * opciones.dia: el día que muestra la vista (si la comida pasa a otro día, se avisa).
 */
export function tarjetaComida(comida, ctx, { alCambiar, dia } = {}) {
  const entrada = el("article", { class: "entrada comida", dataset: { id: comida.id } });
  const fotos = Array.isArray(comida.fotos) ? comida.fotos : [];
  const items = Array.isArray(comida.items) ? comida.items : [];

  function vista() {
    const abierta = abiertas.has(comida.id);
    entrada.classList.remove("editando");
    entrada.classList.toggle("abierta", abierta);

    const marcas = [];
    if (comida.editada) marcas.push(el("span", { title: "Corregida a mano en la página" }, "editada"));
    if (comida.revisar) {
      marcas.push(el("span", { class: "marca-revisar", title: `Pediste revisar: ${comida.revisar.pedido || ""}` }, "a revisar"));
    }
    if (comida.confianza === "baja") {
      marcas.push(el("span", { title: "La estimación es poco segura" }, "confianza baja"));
    }

    const mas = el("button", { type: "button", class: "btn-icono entrada-mas",
      "aria-label": abierta ? "Ocultar detalle" : "Ver detalle y opciones",
      title: abierta ? "Ocultar detalle" : "Detalle y opciones",
      "aria-expanded": abierta ? "true" : "false", onclick: alternar }, iconoPuntos());

    const detalle = abierta ? el("div", { class: "entrada-detalle" },
      items.length ? tablaItems() : null,
      comida.revisar ? el("p", { class: "entrada-pedido" },
        `Pediste revisar: «${comida.revisar.pedido || ""}»`) : null,
      el("div", { class: "entrada-acciones" },
        el("button", { type: "button", class: "btn-texto", onclick: formRevision },
          comida.revisar ? "Cambiar pedido de revisión" : "Pedir revisión"),
        el("button", { type: "button", class: "btn-texto", onclick: formEdicion }, "Editar"),
        el("button", { type: "button", class: "btn-texto peligro", onclick: borrar }, "Borrar"))) : null;

    entrada.replaceChildren(
      miniatura(fotos, ctx, comida.titulo || ""),
      el("div", { class: "entrada-cuerpo" },
        el("div", { class: "entrada-linea" },
          el("div", { class: "entrada-titulos" },
            el("div", { class: "entrada-meta" },
              el("span", { class: "num" }, comida.hora || ""),
              el("span", {}, (TIPOS[comida.tipo] || comida.tipo || "").toLowerCase()),
              marcas),
            el("h3", { class: "entrada-titulo" }, comida.titulo || "Sin título")),
          el("div", { class: "entrada-kcal num", title: macrosTexto(comida) },
            num(comida.kcal), el("span", {}, " kcal")),
          mas),
        !abierta && items.length ? el("ul", { class: "entrada-items" },
          items.map((it) => el("li", {}, it.nombre || "", el("span", { class: "num" }, ` · ${numItem(it.kcal)}`)))) : null,
        comida.nota ? el("p", { class: "entrada-nota" }, comida.nota) : null,
        comida.comentario ? el("p", { class: "entrada-comentario", title: abierta ? null : comida.comentario }, comida.comentario) : null,
        detalle));
  }

  function alternar(e) {
    if (abiertas.has(comida.id)) abiertas.delete(comida.id);
    else abiertas.add(comida.id);
    vista();
    // Con el botón ⋯ (o teclado) el foco sigue en el botón; con un clic en la fila, no.
    if (e && e.currentTarget && e.currentTarget.classList?.contains("entrada-mas")) {
      entrada.querySelector(".entrada-mas")?.focus();
    }
  }

  entrada.addEventListener("click", (e) => {
    if (entrada.classList.contains("editando") || esControl(e.target)) return;
    if (window.getSelection && String(window.getSelection())) return;
    alternar(null);
  });

  function tablaItems() {
    return el("table", { class: "items" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Alimento"),
        el("th", { scope: "col", class: "col-porcion" }, "Porción"),
        el("th", { scope: "col", class: "n" }, "kcal"),
        el("th", { scope: "col", class: "n", title: "Proteína (g)" }, "P"),
        el("th", { scope: "col", class: "n", title: "Carbohidratos (g)" }, "C"),
        el("th", { scope: "col", class: "n", title: "Grasa (g)" }, "G"))),
      el("tbody", {}, items.map((it) => el("tr", {},
        el("td", {}, it.nombre || "", el("span", { class: "porcion-movil" }, it.porcion || "")),
        el("td", { class: "col-porcion" }, it.porcion || ""),
        el("td", { class: "n num" }, numItem(it.kcal)),
        el("td", { class: "n num" }, numItem(it.proteina_g)),
        el("td", { class: "n num" }, numItem(it.carbos_g)),
        el("td", { class: "n num" }, numItem(it.grasa_g))))),
      el("tfoot", {}, el("tr", {},
        el("td", { colspan: 2 }, "Total"),
        el("td", { class: "n num" }, num(comida.kcal)),
        el("td", { class: "n num" }, num(comida.proteina_g)),
        el("td", { class: "n num" }, num(comida.carbos_g)),
        el("td", { class: "n num" }, num(comida.grasa_g)))));
  }

  // ---- pedir revisión
  function formRevision() {
    const zona = entrada.querySelector(".entrada-acciones");
    const area = el("textarea", { class: "entrada-texto", rows: 2, maxlength: 500,
      placeholder: "Qué hay que corregir: «no era arroz, era quinoa»",
      "aria-label": "Qué hay que corregir" });
    area.value = comida.revisar?.pedido || "";
    const form = el("form", { class: "form-revision", onsubmit: (e) => {
      e.preventDefault();
      const pedido = area.value.trim();
      if (!pedido) { area.focus(); return; }
      enviar(pedido);
    } },
      area,
      el("p", { class: "ayuda" }, "Claude la vuelve a estimar la próxima vez que procese."),
      el("div", { class: "entrada-acciones" },
        el("button", { type: "submit", class: "btn btn-primario btn-chico" }, "Pedir revisión"),
        comida.revisar ? el("button", { type: "button", class: "btn-texto", onclick: () => enviar(null) }, "Quitar pedido") : null,
        el("button", { type: "button", class: "btn-texto", onclick: vista }, "Cancelar")));
    area.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); vista(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });

    async function enviar(pedido) {
      for (const b of form.querySelectorAll("button")) enUso(b, true);
      try {
        await cambiarComida(ctx, comida.id, (c) => {
          c.revisar = pedido ? { pedido, fecha: isoConZona() } : null;
        });
        ctx.toast(pedido ? "Pedido guardado: se revisa la próxima vez que proceses." : "Pedido quitado.", { tipo: "ok" });
        await alCambiar?.();
      } catch (e) {
        ctx.toast(mensajeError(e), { tipo: "error" });
        for (const b of form.querySelectorAll("button")) enUso(b, false);
      }
    }

    zona.replaceWith(form);
    area.focus();
  }

  // ---- editar a mano
  function formEdicion() {
    entrada.classList.add("editando");
    const filas = el("div", { class: "edicion-items" });
    const total = el("p", { class: "edicion-total num" });
    const titulo = el("input", { class: "entrada-texto", value: comida.titulo || "", maxlength: 120 });
    const tipo = el("select", { class: "entrada-texto" },
      Object.entries(TIPOS).map(([v, t]) => el("option", { value: v, selected: v === comida.tipo }, t)));
    const cuando = camposCuando(comida.fecha, comida.hora, { conEtiquetas: true });
    const avisoCuando = el("p", { class: "edicion-aviso", "aria-live": "polite" });
    const nota = el("textarea", { class: "entrada-texto", rows: 2, maxlength: 500 });
    nota.value = comida.nota || "";
    for (const c of [cuando.dia, cuando.hora]) {
      c.addEventListener("input", () => {
        avisoCuando.textContent = "";
        cuando.dia.classList.remove("invalido");
        cuando.hora.classList.remove("invalido");
      });
    }

    const cabezaFilas = el("div", { class: "edicion-fila edicion-encabezado", "aria-hidden": "true" },
      el("span", {}, "Alimento"), el("span", {}, "Porción"), el("span", { class: "n" }, "kcal"),
      el("span", { class: "n" }, "Prot. g"), el("span", { class: "n" }, "Carb. g"),
      el("span", { class: "n" }, "Grasa g"), el("span", {}));

    function filaItem(it = {}) {
      const campo = (k, etiqueta, attrs = {}) => {
        const valor = MACROS.some(([m]) => m === k) ? aTexto(it[k] ?? "") : (it[k] ?? "");
        const inp = el("input", { class: "entrada-texto", value: valor, "aria-label": etiqueta, ...attrs });
        inp.dataset.k = k;
        return el("label", { class: `celda celda-${k}` }, el("span", { class: "celda-etiqueta" }, etiqueta), inp);
      };
      const num4 = { inputmode: "decimal", autocomplete: "off", class: "entrada-texto n num" };
      const fila = el("div", { class: "edicion-fila" },
        campo("nombre", "Alimento", { maxlength: 120 }),
        campo("porcion", "Porción", { maxlength: 120 }),
        campo("kcal", "kcal", { ...num4, inputmode: "numeric" }),
        campo("proteina_g", "Proteína (g)", num4),
        campo("carbos_g", "Carbos (g)", num4),
        campo("grasa_g", "Grasa (g)", num4),
        el("button", { type: "button", class: "btn-icono quitar-item", "aria-label": "Quitar este item",
          title: "Quitar este item", onclick: () => { fila.remove(); recalcular(); } }, icono("cerrar", 16)));
      fila._original = it;
      return fila;
    }

    function leerFilas() {
      return [...filas.querySelectorAll(".edicion-fila")].map((f) => {
        const it = { ...f._original };
        for (const inp of f.querySelectorAll("input")) {
          const k = inp.dataset.k;
          if (k === "nombre" || k === "porcion") it[k] = inp.value.trim();
          else {
            const n = leerNumero(inp.value);
            inp.classList.toggle("invalido", Number.isNaN(n));
            it[k] = Number.isNaN(n) ? NaN : (k === "kcal" ? Math.round(n) : Math.round(n * 10) / 10);
          }
        }
        return it;
      });
    }

    function recalcular() {
      const t = totales(leerFilas().map((it) => Object.fromEntries(MACROS.map(([k]) =>
        [k, Number.isFinite(it[k]) ? it[k] : 0]))));
      total.textContent = `${num(t.kcal)} kcal · ${macrosTexto(t)}`;
    }

    items.forEach((it) => filas.append(filaItem(it)));
    filas.addEventListener("input", recalcular);

    const form = el("form", { class: "form-edicion", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!leerCuando(cuando, avisoCuando)) return;
      const nuevaFecha = cuando.dia.value;
      const nuevaHora = cuando.hora.value.slice(0, 5);
      const nuevos = leerFilas();
      if (!nuevos.length) {
        ctx.toast("Tiene que quedar al menos un item. Para sacar la comida entera, usá Borrar.", { tipo: "error" });
        return;
      }
      if (nuevos.some((it) => !it.nombre)) {
        ctx.toast("Cada item necesita un nombre.", { tipo: "error" });
        return;
      }
      if (nuevos.some((it) => MACROS.some(([k]) => !Number.isFinite(it[k]) || it[k] < 0))) {
        ctx.toast("Hay un número que no entiendo: usá solo cifras (con coma para decimales).", { tipo: "error" });
        return;
      }
      const nuevoTitulo = titulo.value.trim() || comida.titulo || "";
      const nuevaNota = nota.value.trim();
      // editada = números (o título/tipo) tocados a mano; día, hora y nota no cuentan
      const cambioItems = itemsCambiaron(items, nuevos) || nuevoTitulo !== (comida.titulo || "") ||
        tipo.value !== comida.tipo;
      const cambioMomento = nuevaFecha !== comida.fecha || nuevaHora !== comida.hora;
      const cambioNota = nuevaNota !== (comida.nota || "").trim();
      if (!cambioItems && !cambioMomento && !cambioNota) { vista(); return; }
      for (const b of form.querySelectorAll("button")) enUso(b, true);
      try {
        await cambiarComida(ctx, comida.id, (c) => {
          if (cambioItems) {
            c.items = nuevos;
            Object.assign(c, totales(nuevos));
            c.titulo = nuevoTitulo || c.titulo;
            c.tipo = tipo.value;
            c.editada = true;
          }
          if (cambioMomento) { c.fecha = nuevaFecha; c.hora = nuevaHora; }
          if (cambioNota) c.nota = nuevaNota;
        }, { ordenar: cambioMomento });
        const movida = cambioMomento && dia && nuevaFecha !== dia;
        ctx.toast(movida ? `Movida al ${formatoFecha(nuevaFecha)}`
          : cambioItems ? "Comida corregida." : "Cambios guardados.", { tipo: "ok" });
        if (cambioNota) {
          // qc.py vuelve a sacar la nota de las piezas al re-procesar: tienen que decir lo mismo
          try {
            await ctx.datos.cambiarNota(comida.id, nuevaNota);
          } catch (err) {
            ctx.toast(`La nota quedó en el registro, pero no en las fotos del Drive: ${mensajeError(err)}`,
              { tipo: "error", ms: 6000 });
          }
        }
        await alCambiar?.();
      } catch (err) {
        ctx.toast(mensajeError(err), { tipo: "error" });
        for (const b of form.querySelectorAll("button")) enUso(b, false);
      }
    } },
      el("div", { class: "edicion-cabeza" },
        el("label", { class: "campo" }, el("span", {}, "Título"), titulo),
        el("label", { class: "campo" }, el("span", {}, "Tipo"), tipo)),
      cuando.caja,
      avisoCuando,
      el("label", { class: "campo" }, el("span", {}, "Nota"), nota),
      cabezaFilas,
      filas,
      el("div", { class: "edicion-pie" },
        el("button", { type: "button", class: "btn-texto", onclick: () => {
          const f = filaItem({ kcal: 0, proteina_g: 0, carbos_g: 0, grasa_g: 0 });
          filas.append(f);
          recalcular();
          f.querySelector("input").focus();
        } }, "+ Agregar item"),
        total),
      el("div", { class: "entrada-acciones" },
        el("button", { type: "submit", class: "btn btn-primario btn-chico" }, "Guardar"),
        el("button", { type: "button", class: "btn-texto", onclick: vista }, "Cancelar"),
        el("span", { class: "ayuda" }, "Los totales son la suma de los items.")));
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); vista(); }
    });
    recalcular();

    entrada.replaceChildren(
      el("div", { class: "entrada-cuerpo" },
        el("div", { class: "entrada-meta" }, el("span", { class: "num" }, comida.hora || ""), el("span", {}, "editando")),
        form));
    titulo.focus();
  }

  // ---- borrar
  async function borrar(e) {
    const boton = e.currentTarget;
    const ok = await confirmar({
      titulo: "¿Borrar esta comida?",
      texto: `«${comida.titulo || "Sin título"}» sale del registro y sus fotos quedan descartadas (no se borran del Drive).`,
      si: "Borrar", peligro: true,
    });
    if (!ok) return;
    enUso(boton, true);
    try {
      await ctx.datos.actualizarRegistro((reg) => {
        reg.comidas = (reg.comidas || []).filter((c) => c.id !== comida.id);
        return reg;
      });
      await ctx.datos.descartar(comida.id);
      abiertas.delete(comida.id);
      ctx.toast("Comida borrada del registro.", { tipo: "ok" });
      await alCambiar?.();
    } catch (err) {
      ctx.toast(mensajeError(err), { tipo: "error" });
      enUso(boton, false);
    }
  }

  vista();
  return entrada;
}

// ---------------------------------------------------------------- captura pendiente

/** Captura sin procesar ({grupo, tomada, nota, piezas}): en gris, con la nota editable y Descartar. */
export function tarjetaPendiente(captura, ctx, { alCambiar } = {}) {
  const fotos = (captura.piezas || []).filter((p) => p.tipo === "foto").map((p) => p.id);
  const nota = captura.nota || "";
  const entrada = el("article", { class: "entrada pendiente", dataset: { grupo: captura.grupo } });

  const tomada = captura.tomada || "";
  const hora = tomada ? horaDe(tomada) : "";

  function vista() {
    entrada.replaceChildren(
      miniatura(fotos, ctx, "Sin procesar", { pendiente: true }),
      el("div", { class: "entrada-cuerpo" },
        el("div", { class: "entrada-linea" },
          el("div", { class: "entrada-titulos" },
            el("div", { class: "entrada-meta" },
              el("button", { type: "button", class: "momento-editable num", title: "Cambiar día y hora",
                "aria-label": `Cambiar día y hora${hora ? ` (${hora})` : ""}`, "aria-expanded": "false",
                onclick: editarMomento }, hora || "hora"),
              el("span", { class: "marca-pendiente", title: "Todavía no suma. Se estima cuando le pedís a Claude «procesá»." }, "pendiente")),
            el("button", { type: "button", class: `nota-editable${nota ? "" : " vacia"}`,
              title: "Cambiar la nota", onclick: editarNota }, nota || "Agregar una nota")),
          el("button", { type: "button", class: "btn-texto peligro entrada-descartar", onclick: descartarla }, "Descartar"))));
  }

  function editarNota() {
    const campo = el("textarea", { class: "entrada-texto", rows: 2, maxlength: 500,
      placeholder: "Porción, cómo estaba hecho…", "aria-label": "Nota de la captura" });
    campo.value = nota;
    let listo = false;
    const guardar = async () => {
      if (listo) return;
      listo = true;
      const nueva = campo.value.trim();
      if (nueva === nota.trim()) { vista(); return; }
      campo.disabled = true;
      try {
        await ctx.datos.cambiarNota(captura.grupo, nueva);
        ctx.toast("Nota guardada.", { tipo: "ok" });
        await alCambiar?.();
      } catch (e) {
        ctx.toast(mensajeError(e), { tipo: "error" });
        listo = false;
        campo.disabled = false;
      }
    };
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); guardar(); }
      if (e.key === "Escape") { e.stopPropagation(); listo = true; vista(); }
    });
    campo.addEventListener("blur", guardar);
    entrada.querySelector(".nota-editable").replaceWith(campo);
    campo.focus();
    campo.setSelectionRange(campo.value.length, campo.value.length);
  }

  function editarMomento() {
    const abierto = entrada.querySelector(".form-momento");
    if (abierto) { abierto.querySelector("input")?.focus(); return; }
    const fecha0 = tomada.slice(0, 10);
    const segundos0 = Number(tomada.slice(17, 19)) || 0;
    const campos = camposCuando(fecha0 || hoyISO(), hora);
    const aviso = el("p", { class: "edicion-aviso", "aria-live": "polite" });
    const boton = entrada.querySelector(".momento-editable");
    const cerrar = () => vista();
    const form = el("form", { class: "form-momento", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const cuando = leerCuando(campos, aviso, segundos0);
      if (!cuando) return;
      if (campos.dia.value === fecha0 && campos.hora.value.slice(0, 5) === hora) { cerrar(); return; }
      for (const b of form.querySelectorAll("button")) enUso(b, true);
      try {
        await ctx.datos.cambiarMomento(captura.grupo, isoConZona(cuando));
        const nuevaFecha = isoConZona(cuando).slice(0, 10);
        ctx.toast(nuevaFecha !== fecha0 ? `Movida al ${formatoFecha(nuevaFecha)}` : "Hora cambiada.", { tipo: "ok" });
        await alCambiar?.();
      } catch (err) {
        ctx.toast(mensajeError(err), { tipo: "error" });
        for (const b of form.querySelectorAll("button")) enUso(b, false);
      }
    } },
      campos.caja,
      aviso,
      el("div", { class: "entrada-acciones" },
        el("button", { type: "submit", class: "btn btn-primario btn-chico" }, "Guardar"),
        el("button", { type: "button", class: "btn-texto", onclick: cerrar }, "Cancelar")));
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); cerrar(); }
    });
    form.addEventListener("input", () => {
      aviso.textContent = "";
      campos.dia.classList.remove("invalido");
      campos.hora.classList.remove("invalido");
    });
    boton?.setAttribute("aria-expanded", "true");
    entrada.querySelector(".entrada-linea").after(form);
    campos.dia.focus();
  }

  async function descartarla(e) {
    const boton = e.currentTarget;
    const ok = await confirmar({
      titulo: "¿Descartar esta captura?",
      texto: "No se va a procesar ni sumar al día. Los archivos quedan en el Drive, marcados como descartados.",
      si: "Descartar", peligro: true,
    });
    if (!ok) return;
    enUso(boton, true);
    try {
      await ctx.datos.descartar(captura.grupo);
      ctx.toast("Captura descartada.", { tipo: "ok" });
      await alCambiar?.();
    } catch (err) {
      ctx.toast(mensajeError(err), { tipo: "error" });
      enUso(boton, false);
    }
  }

  vista();
  return entrada;
}
