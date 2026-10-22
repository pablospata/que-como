// Vista Semana (#/semana[/lunes]): kcal por día contra la meta, promedios, peso y tabla.
import { el, icono, hoyISO, sumarDias, lunesDe, parseFecha, formatoFecha, nombreDia, nombreMes, num, mensajeError } from "../util.js";
import { metaKcal, metaProteina, pesoActual, resumenSemana } from "../calculos.js";
import { svgEl, finito } from "./comida.js";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function montar(contenedor, params, ctx) {
  const hoy = hoyISO();
  const lunesHoy = lunesDe(hoy);
  const lunes = FECHA_RE.test(params[0] || "") ? lunesDe(params[0]) : lunesHoy;
  const domingo = sumarDias(lunes, 6);
  const ir = (l) => ctx.navegar(l === lunesHoy ? "semana" : `semana/${l}`);

  function cabecera() {
    let sub;
    if (lunes === lunesHoy) sub = "Esta semana";
    else if (lunes === sumarDias(lunesHoy, -7)) sub = "La semana pasada";
    else if (domingo.slice(0, 4) !== hoy.slice(0, 4)) sub = domingo.slice(0, 4);
    return el("div", { class: "nav-fecha" },
      el("button", { type: "button", class: "btn-icono", "aria-label": "Semana anterior",
        title: "Semana anterior (←)", onclick: () => ir(sumarDias(lunes, -7)) }, icono("izq")),
      el("div", { class: "nav-fecha-titulo" },
        el("h1", {}, tituloSemana(lunes, domingo)),
        sub ? el("span", { class: "terciario" }, sub) : null),
      el("button", { type: "button", class: "btn-icono", "aria-label": "Semana siguiente",
        title: "Semana siguiente (→)", disabled: lunes >= lunesHoy, onclick: () => ir(sumarDias(lunes, 7)) }, icono("der")),
      lunes === lunesHoy ? null : el("button", { type: "button", class: "btn btn-chico nav-hoy",
        onclick: () => ir(lunesHoy) }, "Esta semana"));
  }

  function alTeclado(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (document.querySelector("dialog[open]")) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "ArrowLeft") ir(sumarDias(lunes, -7));
    else if (lunes < lunesHoy) ir(sumarDias(lunes, 7));
  }

  let registro, perfil, peso;
  try {
    [registro, perfil, peso] = await Promise.all([
      ctx.datos.leerRegistro(), ctx.datos.leerPerfil(), ctx.datos.leerPeso(),
    ]);
  } catch (e) {
    if (e && e.codigo === "sin_login") throw e;
    ctx.toast(mensajeError(e), { tipo: "error" });
    contenedor.replaceChildren(cabecera(), el("div", { class: "vacio" },
      el("p", {}, "No pude leer los datos: " + mensajeError(e))));
    document.addEventListener("keydown", alTeclado);
    return () => document.removeEventListener("keydown", alTeclado);
  }

  const registros = peso?.registros || [];
  const sem = resumenSemana(registro, lunes);
  const dias = sem.dias.map((d, i) => {
    const fecha = sumarDias(lunes, i);
    const kg = pesoActual(registros, fecha);
    let meta = null;
    try { meta = finito(metaKcal(perfil, kg, fecha)); } catch { meta = null; }
    return { ...d, fecha, meta, futuro: fecha > hoy, esHoy: fecha === hoy };
  });
  const conComidas = dias.filter((d) => d.comidas > 0);
  // hoy todavía no terminó: no cuenta para "días en la meta"
  const conMeta = conComidas.filter((d) => d.meta != null && !d.esHoy);
  const dentro = conMeta.filter((d) => d.kcal <= d.meta).length;
  const refMeta = dias.filter((d) => !d.futuro).at(-1) || dias[0];
  let metaP = null;
  try { metaP = finito(metaProteina(perfil, pesoActual(registros, refMeta.fecha))); } catch { metaP = null; }

  // peso: primer y último registro dentro de la semana
  const pesosSemana = registros.filter((r) => r.fecha >= lunes && r.fecha <= domingo)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // La meta cambia un poco con el peso: la línea va día por día; el texto muestra la del último día
  // que ya pasó (o el primero con meta).
  const metaRef = refMeta.meta ?? dias.find((d) => d.meta != null)?.meta ?? null;
  const metaTxt = metaRef != null ? `${num(metaRef)} kcal` : null;

  const diasTxt = (n) => (n === 1 ? "1 día con comidas" : `${n} días con comidas`);
  contenedor.replaceChildren(...[
    cabecera(),
    el("div", { class: "semana-datos" },
      dato("promedio", sem.promedioKcal != null ? [num(sem.promedioKcal), el("small", {}, " kcal")] : "–",
        conComidas.length ? `Promedio por día, sobre ${diasTxt(conComidas.length)}` : "Sin comidas registradas"),
      dato("días en la meta", conMeta.length ? `${dentro} de ${conMeta.length}` : "–",
        metaTxt ? `Días con comidas que quedaron en la meta o por debajo (meta ${metaTxt})` : "Sin meta: falta completar el perfil"),
      dato("proteína", sem.promedioProteina_g != null ? [num(sem.promedioProteina_g), el("small", {}, " g")] : "–",
        "Promedio por día con comidas" + (metaP != null ? ` (meta ${num(metaP)} g)` : "")),
      datoPeso(pesosSemana)),
    el("section", { class: "semana-grafico", "aria-label": "Kcal por día" }, grafico(dias, ctx, metaRef)),
    metaTxt ? null : el("p", { class: "terciario semana-sin-meta" },
      el("a", { href: "#/perfil" }, "Completá el perfil para ver tu meta")),
    el("details", { class: "semana-detalle" },
      el("summary", {}, "Detalle por día"),
      tabla(dias, sem)),
  ].filter(Boolean));

  document.addEventListener("keydown", alTeclado);
  return () => document.removeEventListener("keydown", alTeclado);
}

// ---------------------------------------------------------------- piezas

function tituloSemana(lunes, domingo) {
  const a = parseFecha(lunes);
  const b = parseFecha(domingo);
  if (a.getMonth() === b.getMonth()) {
    return `Semana del ${a.getDate()} al ${b.getDate()} de ${nombreMes(b.getMonth())}`;
  }
  return `Semana del ${a.getDate()} de ${nombreMes(a.getMonth())} al ${b.getDate()} de ${nombreMes(b.getMonth())}`;
}

function dato(etiqueta, valor, titulo) {
  return el("div", { class: "dato", title: titulo || null },
    el("span", { class: "dato-valor num" }, valor),
    el("span", { class: "dato-etiqueta" }, etiqueta));
}

function datoPeso(pesos) {
  if (!pesos.length) return dato("peso", "–", "Sin registros de peso esta semana");
  const ini = pesos[0];
  const fin = pesos.at(-1);
  if (pesos.length === 1) {
    return dato("peso", [num(ini.kg, 1), el("small", {}, " kg")], `Un solo registro: ${formatoFecha(ini.fecha)}`);
  }
  const dif = Math.round((fin.kg - ini.kg) * 10) / 10;
  const difTxt = dif === 0 ? "sin cambio" : `${dif > 0 ? "+" : "−"}${num(Math.abs(dif), 1)} kg`;
  return dato("peso",
    [num(ini.kg, 1), el("span", { class: "dato-flecha" }, " → "), num(fin.kg, 1), el("small", {}, " kg")],
    `${formatoFecha(ini.fecha)} a ${formatoFecha(fin.fecha)}: ${difTxt}`);
}

/** Paso "lindo" para el eje: 250, 500, 1.000… */
function pasoEje(max) {
  for (const p of [250, 500, 1000, 2000]) if (max / p <= 5) return p;
  return 5000;
}

function grafico(dias, ctx, metaRef) {
  // En el teléfono, un lienzo más angosto para que los textos no queden diminutos.
  const angosto = window.matchMedia("(max-width: 599px)").matches;
  const W = angosto ? 360 : 720, H = angosto ? 210 : 230;
  const M = { izq: 4, der: angosto ? 40 : 52, arr: 24, aba: 44 };
  const ancho = W - M.izq - M.der;
  const alto = H - M.arr - M.aba;
  const col = ancho / 7;
  const barra = Math.min(40, col * (angosto ? 0.5 : 0.42));

  const maxDato = Math.max(1000, ...dias.map((d) => d.kcal), ...dias.map((d) => d.meta || 0));
  const tope = maxDato * 1.1;
  const y = (v) => M.arr + alto - (v / tope) * alto;
  const base = y(0);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico-semana", role: "group",
    "aria-label": "Kcal por día de la semana" });
  svg.append(svgEl("line", { x1: M.izq, x2: M.izq + ancho, y1: base, y2: base, class: "linea-base", "aria-hidden": "true" }));

  const valores = svgEl("g", { class: "valores", "aria-hidden": "true" });
  dias.forEach((d, i) => {
    const x0 = M.izq + i * col;
    const cx = x0 + col / 2;
    const vacio = d.comidas === 0;
    const sobre = d.meta != null && d.kcal > d.meta;
    const etiqueta = `${formatoFecha(d.fecha)}: ` + (vacio ? (d.futuro ? "todavía no llegó" : "sin comidas registradas")
      : `${num(d.kcal)} kcal` + (d.meta != null ? (sobre ? `, ${num(d.kcal - d.meta)} arriba de la meta` : `, ${num(d.meta - d.kcal)} debajo de la meta`) : ""));

    const g = svgEl("g", {
      class: `col${d.esHoy ? " es-hoy" : ""}${d.futuro ? " futuro" : ""}`,
      ...(d.futuro ? { "aria-label": etiqueta, role: "img" } : {
        tabindex: 0, role: "link", "aria-label": `${etiqueta}. Ver el día`,
        onclick: () => ctx.navegar(`hoy/${d.fecha}`),
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.navegar(`hoy/${d.fecha}`); }
        },
        onmouseenter: () => valores.children[i]?.classList.add("visible"),
        onmouseleave: () => valores.children[i]?.classList.remove("visible"),
        onfocus: () => valores.children[i]?.classList.add("visible"),
        onblur: () => valores.children[i]?.classList.remove("visible"),
      }),
    });
    g.append(svgEl("rect", { x: x0 + 4, y: M.arr - 20, width: col - 8, height: H - M.arr + 16, rx: 8, class: "col-fondo" }));

    let yValor = base - 8;
    if (!vacio) {
      const h = Math.max(2, base - y(d.kcal));
      const r = Math.min(4, h / 2, barra / 2);
      const xb = cx - barra / 2;
      const yb = base - h;
      yValor = yb - 7;
      g.append(svgEl("path", {
        class: `barra${sobre ? " exceso" : ""}`,
        d: `M${xb},${base} V${yb + r} Q${xb},${yb} ${xb + r},${yb} H${xb + barra - r} Q${xb + barra},${yb} ${xb + barra},${yb + r} V${base} Z`,
      }));
    } else if (!d.futuro) {
      g.append(svgEl("rect", { x: cx - barra / 2, y: base - 2, width: barra, height: 2, class: "barra-vacia" }));
    }
    valores.append(svgEl("text", { x: cx, y: yValor, "text-anchor": "middle", class: "barra-valor" },
      vacio ? "" : num(d.kcal)));

    g.append(
      svgEl("text", { x: cx, y: base + 20, "text-anchor": "middle", class: "dia-nombre" }, nombreDia(d.fecha)),
      svgEl("text", { x: cx, y: base + 36, "text-anchor": "middle", class: "dia-fecha" },
        d.fecha.slice(8, 10) + "/" + d.fecha.slice(5, 7)));
    svg.append(g);
  });

  // Línea de la meta, día por día (cambia un poco con el peso), con el valor a la derecha.
  let camino = "";
  let previo = null;
  dias.forEach((d, i) => {
    if (d.meta == null) { previo = null; return; }
    const x0 = M.izq + i * col;
    const yy = y(d.meta).toFixed(1);
    camino += previo === yy ? ` H${(x0 + col).toFixed(1)}` : ` M${x0.toFixed(1)},${yy} H${(x0 + col).toFixed(1)}`;
    previo = yy;
  });
  if (camino) {
    const ultima = [...dias].reverse().find((d) => d.meta != null);
    svg.append(
      svgEl("path", { d: camino.trim(), class: "linea-meta", "aria-hidden": "true" }),
      svgEl("text", { x: M.izq + ancho + 6, y: y(ultima.meta) - 3, class: "meta-texto", "aria-hidden": "true" }, "meta"),
      svgEl("text", { x: M.izq + ancho + 6, y: y(ultima.meta) + 11, class: "meta-texto num", "aria-hidden": "true" },
        num(metaRef ?? ultima.meta)));
  }
  svg.append(valores);
  return svg;
}

function tabla(dias, sem) {
  const celda = (d, k, u = "") => (d.comidas ? `${num(d[k])}${u}` : "–");
  const conComidas = dias.filter((d) => d.comidas > 0);
  const prom = (k) => (conComidas.length
    ? num(Math.round(conComidas.reduce((s, d) => s + d[k], 0) / conComidas.length)) : "–");

  return el("table", { class: "tabla-semana" },
    el("caption", { class: "visualmente-oculto" }, "Detalle por día"),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col" }, "Día"),
      el("th", { scope: "col", class: "n" }, "kcal"),
      el("th", { scope: "col", class: "n" }, el("span", { class: "largo" }, "Proteína"), el("span", { class: "corto", title: "Proteína" }, "P"), " g"),
      el("th", { scope: "col", class: "n" }, el("span", { class: "largo" }, "Carbos"), el("span", { class: "corto", title: "Carbohidratos" }, "C"), " g"),
      el("th", { scope: "col", class: "n" }, el("span", { class: "largo" }, "Grasa"), el("span", { class: "corto", title: "Grasa" }, "G"), " g"),
      el("th", { scope: "col", class: "n" }, "Comidas"))),
    el("tbody", {}, dias.map((d) => {
      const sobre = d.comidas && d.meta != null && d.kcal > d.meta;
      return el("tr", { class: `${d.esHoy ? "es-hoy" : ""}${d.futuro ? " futuro" : ""}${d.comidas ? "" : " sin-comidas"}` },
        el("th", { scope: "row" }, d.futuro ? formatoFecha(d.fecha)
          : el("a", { href: `#/hoy/${d.fecha}` }, formatoFecha(d.fecha))),
        el("td", { class: `n num${sobre ? " exceso" : ""}` }, celda(d, "kcal")),
        el("td", { class: "n num" }, celda(d, "proteina_g")),
        el("td", { class: "n num" }, celda(d, "carbos_g")),
        el("td", { class: "n num" }, celda(d, "grasa_g")),
        el("td", { class: "n num" }, d.comidas ? num(d.comidas) : "–"));
    })),
    el("tfoot", {}, el("tr", {},
      el("th", { scope: "row" }, "Promedio", el("span", { class: "terciario" }, " (días con comidas)")),
      el("td", { class: "n num" }, sem.promedioKcal != null ? num(sem.promedioKcal) : "–"),
      el("td", { class: "n num" }, prom("proteina_g")),
      el("td", { class: "n num" }, prom("carbos_g")),
      el("td", { class: "n num" }, prom("grasa_g")),
      el("td", { class: "n num" }, prom("comidas")))));
}
