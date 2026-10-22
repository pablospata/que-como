// Vista Hoy (#/hoy[/AAAA-MM-DD]): resumen del día contra la meta y la lista de comidas,
// mezclando las procesadas con las capturas pendientes de ese día.
import { el, icono, hoyISO, sumarDias, formatoFecha, fechaRelativa, horaDe, num, mensajeError } from "../util.js";
import { metaKcal, metaProteina, pesoActual, resumenDia } from "../calculos.js";
import { tarjetaComida, tarjetaPendiente, cerrarFotos, svgEl, kgDe, finito } from "./comida.js";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function montar(contenedor, params, ctx) {
  const hoy = hoyISO();
  const fecha = FECHA_RE.test(params[0] || "") ? params[0] : hoy;
  const ir = (f) => ctx.navegar(f === hoyISO() ? "hoy" : `hoy/${f}`);

  let datos;
  async function cargar() {
    const [registro, perfil, peso, pendientes] = await Promise.all([
      ctx.datos.leerRegistro(), ctx.datos.leerPerfil(), ctx.datos.leerPeso(), ctx.datos.pendientes(),
    ]);
    return { registro, perfil, peso, pendientes };
  }

  function pintar() {
    const { registro, perfil, peso, pendientes } = datos;
    const resumen = resumenDia(registro, fecha);
    const registrados = new Set((registro.comidas || []).map((c) => c.id));
    const pendDia = (pendientes || []).filter((p) =>
      (p.tomada || "").slice(0, 10) === fecha && !registrados.has(p.grupo));

    const pesoDia = pesoActual(peso?.registros || [], fecha);
    let meta = null;
    let metaP = null;
    try { meta = finito(metaKcal(perfil, pesoDia, fecha)); } catch { meta = null; }
    try { metaP = finito(metaProteina(perfil, pesoDia)); } catch { metaP = null; }

    const lista = [
      ...resumen.lista.map((c) => ({ hora: c.hora || "", orden: 0, nodo: () => tarjetaComida(c, ctx, { alCambiar: refrescar }) })),
      ...pendDia.map((p) => ({ hora: p.tomada ? horaDe(p.tomada) : "", orden: 1, nodo: () => tarjetaPendiente(p, ctx, { alCambiar: refrescar }) })),
    ].sort((a, b) => a.hora.localeCompare(b.hora) || a.orden - b.orden);

    const scroll = window.scrollY;
    contenedor.replaceChildren(
      cabecera(),
      el("div", { class: "hoy-grilla" },
        el("aside", { class: "hoy-resumen" },
          resumenDelDia(resumen, meta, metaP, perfil, pesoDia)),
        el("section", { class: "hoy-comidas", "aria-label": "Comidas del día" },
          lista.length ? lista.map((x) => x.nodo()) : el("div", { class: "vacio hoy-vacio" },
            el("p", {}, fecha === hoy
              ? "Todavía no hay comidas registradas hoy. Las fotos que saques con el celu aparecen acá."
              : "No hay comidas registradas este día.")))));
    window.scrollTo(0, scroll);
  }

  function cabecera() {
    const esHoy = fecha === hoy;
    const relativa = fechaRelativa(fecha);
    return el("div", { class: "nav-fecha" },
      el("button", { type: "button", class: "btn-icono", "aria-label": "Día anterior",
        title: "Día anterior (←)", onclick: () => ir(sumarDias(fecha, -1)) }, icono("izq")),
      el("div", { class: "nav-fecha-titulo" },
        el("h1", {}, primeraMayuscula(formatoFecha(fecha, { largo: true }))),
        relativa === "Hoy" || relativa === "Ayer" ? el("span", { class: "terciario" }, relativa)
          : fecha.slice(0, 4) !== hoy.slice(0, 4) ? el("span", { class: "terciario" }, fecha.slice(0, 4)) : null),
      el("button", { type: "button", class: "btn-icono", "aria-label": "Día siguiente",
        title: "Día siguiente (→)", disabled: fecha >= hoy, onclick: () => ir(sumarDias(fecha, 1)) }, icono("der")),
      esHoy ? null : el("button", { type: "button", class: "btn btn-chico nav-hoy", onclick: () => ir(hoy) }, "Hoy"));
  }

  async function refrescar() {
    try {
      datos = await cargar();
      pintar();
    } catch (e) {
      ctx.toast(mensajeError(e), { tipo: "error" });
    }
    ctx.avisarCambio();
  }

  function alTeclado(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (document.querySelector("dialog[open]")) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "ArrowLeft") ir(sumarDias(fecha, -1));
    else if (fecha < hoy) ir(sumarDias(fecha, 1));
  }

  function pintarError(e) {
    contenedor.replaceChildren(cabecera(), el("div", { class: "vacio" },
      el("p", {}, "No pude leer los datos: " + mensajeError(e)),
      el("button", { type: "button", class: "btn", onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          datos = await cargar();
          pintar();
        } catch (err) {
          ctx.toast(mensajeError(err), { tipo: "error" });
          pintarError(err);
        }
      } }, "Reintentar")));
  }

  try {
    datos = await cargar();
  } catch (e) {
    if (e && e.codigo === "sin_login") throw e;
    ctx.toast(mensajeError(e), { tipo: "error" });
    pintarError(e);
  }
  if (datos) pintar();
  document.addEventListener("keydown", alTeclado);

  return () => {
    document.removeEventListener("keydown", alTeclado);
    cerrarFotos();
  };
}

const primeraMayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- resumen del día

function resumenDelDia(r, meta, metaP, perfil, pesoDia) {
  const kcal = r.kcal || 0;
  let linea;
  if (meta != null) {
    const dif = meta - kcal;
    linea = dif >= 0
      ? el("p", { class: "resumen-linea num" }, `Te quedan ${num(dif)} kcal`)
      : el("p", { class: "resumen-linea num exceso" }, `${num(-dif)} kcal arriba de la meta`);
  } else if (perfil && kgDe(pesoDia) == null && perfil.meta_kcal_manual == null) {
    linea = el("p", { class: "resumen-linea" }, el("a", { href: "#/peso" }, "Cargá tu peso para ver la meta"));
  } else {
    linea = el("p", { class: "resumen-linea" }, el("a", { href: "#/perfil" }, "Completá el perfil para ver tu meta"));
  }
  return el("div", { class: "resumen-dia" },
    anillo(kcal, meta), linea,
    el("div", { class: "resumen-macros" }, barrasMacros(r, metaP)));
}

function anillo(kcal, meta) {
  const R = 70;
  const C = 2 * Math.PI * R;
  const frac = meta ? Math.min(kcal / meta, 1) : 0;
  const exceso = meta != null && kcal > meta;
  return svgEl("svg", { viewBox: "0 0 160 160", class: "anillo", role: "img",
    "aria-label": meta != null ? `${num(kcal)} de ${num(meta)} kcal` : `${num(kcal)} kcal` },
    svgEl("circle", { cx: 80, cy: 80, r: R, class: "anillo-fondo" }),
    meta != null && kcal > 0 ? svgEl("circle", { cx: 80, cy: 80, r: R,
      class: `anillo-valor${exceso ? " exceso" : ""}`,
      "stroke-dasharray": `${(C * frac).toFixed(2)} ${C.toFixed(2)}`,
      transform: "rotate(-90 80 80)" }) : null,
    svgEl("text", { x: 80, y: 84, class: "anillo-numero", "text-anchor": "middle" }, num(kcal)),
    svgEl("text", { x: 80, y: 106, class: "anillo-sub", "text-anchor": "middle" },
      meta != null ? `de ${num(meta)}` : "kcal"));
}

/** Tres barras finas. Proteína contra su meta; carbos y grasa: su parte de las kcal (en el title). */
function barrasMacros(r, metaP) {
  const kcal = r.kcal || 0;
  const parte = (g, f) => (kcal > 0 ? (g * f) / kcal : 0);
  const fila = (clase, nombre, valor, frac, titulo) =>
    el("div", { class: `macro macro-${clase}`, title: titulo },
      el("div", { class: "macro-texto" },
        el("span", {}, nombre),
        el("span", { class: "num" }, valor)),
      el("div", { class: "macro-barra" },
        el("span", { style: `width:${(Math.max(0, Math.min(frac, 1)) * 100).toFixed(1)}%` })));
  const p = r.proteina_g || 0;
  const c = r.carbos_g || 0;
  const g = r.grasa_g || 0;
  const pct = (x) => `${Math.round(x * 100)} % de las kcal`;
  return [
    fila("proteina", "Proteína", metaP != null ? `${num(p)} / ${num(metaP)} g` : `${num(p)} g`,
      metaP ? p / metaP : parte(p, 4), metaP != null ? "Contra la meta de proteína" : pct(parte(p, 4))),
    fila("carbos", "Carbohidratos", `${num(c)} g`, parte(c, 4), pct(parte(c, 4))),
    fila("grasa", "Grasa", `${num(g)} g`, parte(g, 9), pct(parte(g, 9))),
  ];
}
