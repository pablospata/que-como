// Vista Peso (#/peso): cargar el peso, gráfico con la media móvil, ritmo, proyección y balance.
import { el, icono, num, mensajeError, hoyISO, sumarDias, diasEntre, formatoFecha } from "../util.js";
import {
  mediaMovil, cambioMedia, ritmoSemanal, proyeccion, balance, gastoDiario,
  pesoActual, KCAL_POR_KG,
} from "../calculos.js";

const RANGOS = [
  { id: "30", texto: "30 días", dias: 30 },
  { id: "90", texto: "90 días", dias: 90 },
  { id: "todo", texto: "Todo", dias: null },
];
const CLAVE_RANGO = "quecomo-peso-rango";
const RECIENTES = 10;
const NS = "http://www.w3.org/2000/svg";
const AYUDA = ""; // la ayuda solo aparece cuando hay un error

// ---------------------------------------------------------------- formato

const MENOS = "−";

/** 1,234 → "+1,2"; −0,04 con 1 decimal → "0,0". */
function conSigno(n, dec = 1) {
  const r = Number(n.toFixed(dec));
  if (r === 0) return num(0, dec);
  return (r > 0 ? "+" : MENOS) + num(Math.abs(r), dec);
}

/** "2027-02-14" → "14/02/2027". */
const fechaLarga = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "84,3" / "84.3" / " 84 " → 84.3; lo que no es número → null. */
function leerDecimal(texto) {
  const t = String(texto ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function leerRango() {
  try {
    const v = localStorage.getItem(CLAVE_RANGO);
    if (RANGOS.some((r) => r.id === v)) return v;
  } catch { /* sin almacenamiento */ }
  return "30";
}

function guardarRango(v) {
  try { localStorage.setItem(CLAVE_RANGO, v); } catch { /* sin almacenamiento */ }
}

/**
 * Muestra el error con "Reintentar". Reintentar vacía el contenedor y vuelve a montar ahí; la
 * limpieza de ese montaje queda encadenada en la que se devuelve (app.js la llama al salir).
 */
function errorConReintento(contenedor, e, ctx, remontar) {
  let vivo = true;
  let limpiar = null;
  const reintentar = async () => {
    const cargando = el("div", { class: "cargando" }, "Cargando…");
    contenedor.replaceChildren(cargando);
    try {
      const r = await remontar();
      cargando.remove();
      if (!vivo) { if (typeof r === "function") r(); return; }
      limpiar = typeof r === "function" ? r : null;
    } catch (err) {
      if (!vivo) return;
      const conectar = err && err.codigo === "sin_login";
      contenedor.replaceChildren(el("div", { class: "vacio" },
        el("p", {}, mensajeError(err)),
        el("button", { class: conectar ? "btn btn-primario" : "btn",
          onclick: conectar ? () => ctx.conectar() : reintentar }, conectar ? "Conectar" : "Reintentar")));
    }
  };
  contenedor.replaceChildren(el("div", { class: "vacio" },
    el("p", {}, mensajeError(e)),
    el("button", { class: "btn", onclick: reintentar }, "Reintentar")));
  return () => {
    vivo = false;
    if (limpiar) limpiar();
  };
}

// ---------------------------------------------------------------- montar

export async function montar(contenedor, params, ctx) {
  const hoy = hoyISO();
  let peso, registro, perfil;
  try {
    [peso, registro, perfil] = await Promise.all([
      ctx.datos.leerPeso(), ctx.datos.leerRegistro(), ctx.datos.leerPerfil(),
    ]);
  } catch (e) {
    if (e && e.codigo === "sin_login") throw e;
    return errorConReintento(contenedor, e, ctx, () => montar(contenedor, params, ctx));
  }

  const estado = {
    regs: [...((peso && peso.registros) || [])].sort((a, b) => a.fecha.localeCompare(b.fecha)),
    registro: registro || { version: 1, comidas: [] },
    perfil,
    rango: leerRango(),
    verTodos: false,
    ocupado: false,
  };

  // --- formulario
  const entradaKg = el("input", { id: "peso-kg", type: "text", inputmode: "decimal", autocomplete: "off",
    placeholder: "84,3", "aria-describedby": "peso-ayuda", class: "num" });
  const entradaFecha = el("input", { id: "peso-fecha", type: "date", value: hoy, max: hoy, required: true });
  const ayuda = el("p", { id: "peso-ayuda", class: "terciario peso-ayuda" }, AYUDA);
  const botonGuardar = el("button", { class: "btn btn-primario", type: "submit" }, "Guardar");
  const form = el("form", { class: "tarjeta peso-form", novalidate: true, onsubmit: guardar },
    el("h2", {}, "Cargar peso"),
    el("div", { class: "peso-form-campos" },
      el("div", { class: "campo" }, el("label", { for: "peso-kg" }, "Peso (kg)"), entradaKg),
      el("div", { class: "campo" }, el("label", { for: "peso-fecha" }, "Fecha"), entradaFecha)),
    ayuda,
    el("div", { class: "fila" }, botonGuardar));

  // --- zonas que se repintan
  const cajaStats = el("section", { class: "tarjeta peso-stats", "aria-label": "Resumen del peso" });
  const cajaGrafico = el("div", { class: "peso-grafico" });
  const botonesRango = RANGOS.map((r) => el("button", {
    type: "button", class: "peso-rango-btn", "aria-pressed": String(r.id === estado.rango),
    onclick: () => {
      estado.rango = r.id;
      guardarRango(r.id);
      for (const b of botonesRango) b.setAttribute("aria-pressed", String(b.dataset.id === r.id));
      dibujar();
    },
    dataset: { id: r.id },
  }, r.texto));
  const tarjetaGrafico = el("section", { class: "tarjeta peso-tarjeta-grafico", "aria-label": "Gráfico del peso" },
    el("div", { class: "peso-grafico-cab" },
      el("h2", {}, "Evolución"),
      el("div", { class: "peso-rangos", role: "group", "aria-label": "Período del gráfico" }, botonesRango)),
    cajaGrafico,
    el("div", { class: "peso-leyenda terciario", "aria-hidden": "true" },
      el("span", { class: "ley ley-punto" }, "pesaje"),
      el("span", { class: "ley ley-media" }, "media de 7 días"),
      el("span", { class: "ley ley-objetivo" }, "objetivo")));
  const cajaBalance = el("section", { class: "tarjeta peso-balance", "aria-label": "Balance" });
  const cajaLista = el("section", { class: "tarjeta peso-lista", "aria-label": "Pesajes" });

  contenedor.append(
    el("h1", { class: "visualmente-oculto" }, "Peso"),
    el("div", { class: "peso-grilla" },
      el("div", { class: "peso-col" }, form, cajaStats),
      el("div", { class: "peso-col peso-col-ancha" }, tarjetaGrafico, cajaBalance, cajaLista)),
  );

  // --- gráfico: se redibuja al cambiar el ancho
  let anchoPrevio = 0;
  const observador = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      const w = Math.round(cajaGrafico.clientWidth);
      if (w && w !== anchoPrevio) dibujar();
    })
    : null;
  if (observador) observador.observe(cajaGrafico);

  function dibujar() {
    anchoPrevio = Math.round(cajaGrafico.clientWidth);
    dibujarGrafico(cajaGrafico, estado, hoy);
  }

  function pintar() {
    pintarStats(cajaStats, estado, hoy);
    dibujar();
    pintarBalance(cajaBalance, estado, hoy);
    pintarLista(cajaLista, estado, { borrar, alternar });
  }

  function alternar() {
    estado.verTodos = !estado.verTodos;
    pintarLista(cajaLista, estado, { borrar, alternar });
  }

  async function guardar(ev) {
    ev.preventDefault();
    if (estado.ocupado) return;
    const kg = leerDecimal(entradaKg.value);
    const fecha = entradaFecha.value;
    if (kg == null) return marcarError(entradaKg, "Escribí el peso en kilos, por ejemplo 84,3.");
    if (kg < 30 || kg > 300) return marcarError(entradaKg, "El peso tiene que estar entre 30 y 300 kg.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return marcarError(entradaFecha, "Elegí una fecha.");
    if (fecha > hoy) return marcarError(entradaFecha, "La fecha no puede ser posterior a hoy.");
    limpiarError();
    const valor = Math.round(kg * 100) / 100;
    estado.ocupado = true;
    botonGuardar.disabled = true;
    try {
      let reemplazo = false;
      const actual = await ctx.datos.leerPeso();
      const regs = ((actual && actual.registros) || []).filter((r) => {
        if (r.fecha === fecha) { reemplazo = true; return false; }
        return true;
      });
      regs.push({ fecha, kg: valor });
      regs.sort((a, b) => a.fecha.localeCompare(b.fecha));
      await ctx.datos.guardarPeso({ ...(actual || {}), version: 1, registros: regs });
      estado.regs = regs;
      entradaKg.value = "";
      ctx.toast(reemplazo
        ? `Peso del ${formatoFecha(fecha)} reemplazado: ${num(valor, 1)} kg`
        : `Peso guardado: ${num(valor, 1)} kg`, { tipo: "ok" });
      pintar();
    } catch (e) {
      ctx.toast(mensajeError(e), { tipo: "error" });
    } finally {
      estado.ocupado = false;
      botonGuardar.disabled = false;
    }
  }

  async function borrar(fecha) {
    if (estado.ocupado) return;
    estado.ocupado = true;
    try {
      const actual = await ctx.datos.leerPeso();
      const regs = ((actual && actual.registros) || []).filter((r) => r.fecha !== fecha);
      await ctx.datos.guardarPeso({ ...(actual || {}), version: 1, registros: regs });
      estado.regs = regs;
      ctx.toast(`Peso del ${formatoFecha(fecha)} borrado`, { tipo: "ok" });
      pintar();
    } catch (e) {
      ctx.toast(mensajeError(e), { tipo: "error" });
    } finally {
      estado.ocupado = false;
    }
  }

  function marcarError(entrada, texto) {
    entrada.setAttribute("aria-invalid", "true");
    ayuda.textContent = texto;
    ayuda.classList.add("peso-ayuda-error");
    entrada.focus();
  }

  function limpiarError() {
    entradaKg.removeAttribute("aria-invalid");
    entradaFecha.removeAttribute("aria-invalid");
    ayuda.textContent = AYUDA;
    ayuda.classList.remove("peso-ayuda-error");
  }

  entradaKg.addEventListener("input", () => { if (entradaKg.hasAttribute("aria-invalid")) limpiarError(); });
  entradaFecha.addEventListener("change", () => { if (entradaFecha.hasAttribute("aria-invalid")) limpiarError(); });

  pintar();

  return () => {
    if (observador) observador.disconnect();
  };
}

// ---------------------------------------------------------------- resumen

function pintarStats(caja, estado, hoy) {
  const { regs, perfil } = estado;
  caja.replaceChildren(el("h2", {}, "Resumen"));
  if (!regs.length) {
    caja.append(el("p", { class: "secundario" }, "Todavía no hay pesos cargados."));
    return;
  }
  const medias = mediaMovil(regs, 7);
  const ultima = medias[medias.length - 1];
  const ultimo = pesoActual(regs);
  const c7 = cambioMedia(regs, hoy, 7);
  const c30 = cambioMedia(regs, hoy, 30);
  const ritmo = ritmoSemanal(regs, hoy);

  // el detalle va en el title: a la vista, solo la etiqueta y el número
  const dato = (titulo, valor, detalle) => el("div", { class: "peso-dato", title: detalle || null },
    el("div", { class: "peso-dato-titulo" }, titulo),
    el("div", { class: "peso-dato-valor num" }, valor));

  caja.append(el("div", { class: "peso-datos" },
    dato("Media de 7 días", `${num(ultima.media, 1)} kg`,
      `Último pesaje: ${num(ultimo.kg, 1)} kg, ${formatoFecha(ultimo.fecha)}`),
    dato("Cambio en 7 días", c7 ? `${conSigno(c7.cambio)} kg` : "–",
      c7 ? "de la media" : "faltan pesajes"),
    dato("Cambio en 30 días", c30 ? `${conSigno(c30.cambio)} kg` : "–",
      c30 ? "de la media" : "faltan pesajes"),
    dato("Ritmo", ritmo == null ? "–" : `${conSigno(ritmo, 2)} kg/sem`,
      ritmo == null ? "hace falta más de una semana de pesajes" : "por semana, últimas 4 semanas"),
  ));

  const proy = textoProyeccion(regs, perfil, hoy, ultima, ritmo);
  if (proy) caja.append(el("p", { class: "peso-proyeccion" }, proy));
}

function textoProyeccion(regs, perfil, hoy, ultima, ritmo) {
  const objetivo = perfil && typeof perfil.peso_objetivo_kg === "number" ? perfil.peso_objetivo_kg : null;
  if (objetivo == null) return null;
  if (ultima.media <= objetivo) return `Objetivo ${num(objetivo, 1)} kg: alcanzado.`;
  const p = ritmo == null ? null : proyeccion(regs, perfil, hoy);
  if (!p) return `Objetivo ${num(objetivo, 1)} kg.`;
  const semanas = Math.round(p.semanas);
  return [
    `Objetivo ${num(objetivo, 1)} kg: a este ritmo, el `,
    el("strong", { class: "num", title: semanas <= 1 ? "En una semana o menos" : `En unas ${semanas} semanas` },
      fechaLarga(p.fecha)),
    ".",
  ];
}

// ---------------------------------------------------------------- balance

function pintarBalance(caja, estado, hoy) {
  const { regs, registro, perfil } = estado;
  const hasta = sumarDias(hoy, -1); // el día en curso todavía está incompleto
  const desde = sumarDias(hasta, -27);
  caja.replaceChildren(el("h2", {}, "Balance de las últimas 4 semanas"));
  const periodo = `del ${formatoFecha(desde)} al ${formatoFecha(hasta)}`;

  // sin perfil completo, sin pesos o con menos de 14 días con comidas, la tarjeta no se muestra
  const perfilCompleto = perfil && gastoDiario(perfil, 80, hasta) != null;
  const b = perfilCompleto && regs.length ? balance(registro, regs, perfil, hasta, 28) : null;
  caja.hidden = !b;
  if (!b) return;

  const describirKg = (kg) => (kg >= 0.05 ? `bajar ${num(kg, 1)} kg` : kg <= -0.05 ? `subir ${num(-kg, 1)} kg` : "mantener el peso");
  const describirReal = (kg) => (kg >= 0.05 ? `bajó ${num(kg, 1)} kg` : kg <= -0.05 ? `subió ${num(-kg, 1)} kg` : "quedó igual");

  const cifras = el("div", { class: "peso-balance-cifras" },
    el("div", { class: "peso-dato" },
      el("div", { class: "peso-dato-titulo" }, "Según lo registrado"),
      el("div", { class: "peso-dato-valor num" }, describirKg(b.esperadoKg)),
      el("div", { class: "terciario num" }, `${num(b.kcalPromedio)} de ${num(b.gastoPromedio)} kcal/día`)),
    el("div", { class: "peso-dato" },
      el("div", { class: "peso-dato-titulo" }, "La media de 7 días"),
      el("div", { class: "peso-dato-valor num" }, b.realKg == null ? "–" : describirReal(b.realKg)),
      b.realKg == null ? el("div", { class: "terciario" }, "faltan pesajes") : null),
  );
  caja.append(cifras);

  if (b.realKg != null) {
    const dif = b.esperadoKg - b.realKg;
    const kcalDia = Math.round((Math.abs(dif) * KCAL_POR_KG) / b.diasConComidas / 10) * 10;
    let texto;
    if (Math.abs(dif) < 0.3) {
      texto = "Lo registrado y el peso van parejos.";
    } else if (dif > 0) {
      texto = `Bajaste ${num(dif, 1)} kg menos de lo esperado: unas ${num(kcalDia)} kcal/día sin contar.`;
    } else {
      texto = `Bajaste ${num(-dif, 1)} kg más de lo esperado: unas ${num(kcalDia)} kcal/día de diferencia.`;
    }
    caja.append(el("p", { class: "peso-balance-dif" }, texto));
  }

  const nota = b.diasConComidas < b.dias
    ? ` Cuenta ${b.diasConComidas} de ${b.dias} días: los días sin comidas registradas no suman. Si esos ` +
      `días hubieran sido como el resto, lo esperado sería ${describirKg(b.esperadoKgPeriodo)}.`
    : "";
  caja.append(el("details", { class: "terciario peso-balance-expl" },
    el("summary", {}, "Cómo se calcula"),
    el("p", {}, `Lo que deberías haber bajado ${periodo} según las kcal registradas y el gasto de Perfil ` +
      "(7.700 kcal ≈ 1 kg), contra lo que bajó la media de 7 días. Si bajaste menos, lo registrado " +
      "probablemente se queda corto." + nota)));
}

// ---------------------------------------------------------------- lista

function pintarLista(caja, estado, { borrar, alternar }) {
  const regs = [...estado.regs].reverse();
  caja.replaceChildren(el("h2", {}, "Pesajes"));
  if (!regs.length) {
    caja.append(el("p", { class: "secundario" }, "Cuando cargues un peso, aparece acá."));
    return;
  }
  const visibles = estado.verTodos ? regs : regs.slice(0, RECIENTES);
  const anioActual = hoyISO().slice(0, 4);
  const lista = el("ul", { class: "peso-filas" });
  visibles.forEach((r, i) => {
    const anterior = regs[i + 1];
    const dif = anterior ? r.kg - anterior.kg : null;
    const etiqueta = `Borrar el peso del ${formatoFecha(r.fecha)}`;
    let confirmar = false;
    let temporizador = null;
    const boton = el("button", {
      type: "button", class: "btn-icono peso-borrar", "aria-label": etiqueta, title: "Borrar",
      onclick: () => {
        if (confirmar) {
          clearTimeout(temporizador);
          borrar(r.fecha);
          return;
        }
        confirmar = true;
        boton.classList.add("confirmar");
        boton.replaceChildren("¿Borrar?");
        boton.setAttribute("aria-label", `Confirmar: borrar el peso del ${formatoFecha(r.fecha)}`);
        temporizador = setTimeout(() => {
          confirmar = false;
          boton.classList.remove("confirmar");
          boton.replaceChildren(icono("borrar", 18));
          boton.setAttribute("aria-label", etiqueta);
        }, 4000);
      },
    }, icono("borrar", 18));
    lista.append(el("li", { class: "peso-fila" },
      el("span", { class: "peso-fila-fecha" }, formatoFecha(r.fecha, { anio: r.fecha.slice(0, 4) !== anioActual })),
      el("span", { class: "peso-fila-kg num" }, `${num(r.kg, 1)} kg`),
      el("span", { class: "peso-fila-dif num terciario" }, dif == null ? "" : conSigno(dif)),
      boton));
  });
  caja.append(lista);
  if (regs.length > RECIENTES) {
    caja.append(el("button", { type: "button", class: "btn btn-chico peso-ver-todos", onclick: alternar },
      estado.verTodos ? "Ver menos" : `Ver todos (${regs.length})`));
  }
}

// ---------------------------------------------------------------- gráfico

function pasoLindo(bruto, opciones) {
  for (const o of opciones) if (o >= bruto) return o;
  return opciones[opciones.length - 1];
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  return n;
}

function dibujarGrafico(caja, estado, hoy) {
  const { regs, perfil, rango } = estado;
  caja.replaceChildren();
  const r = RANGOS.find((x) => x.id === rango) || RANGOS[0];
  const ultimoReg = regs.length ? regs[regs.length - 1].fecha : hoy;
  const fin = ultimoReg > hoy ? ultimoReg : hoy;
  let inicio = r.dias ? sumarDias(fin, -(r.dias - 1)) : (regs[0] ? regs[0].fecha : sumarDias(fin, -29));
  if (diasEntre(inicio, fin) < 6) inicio = sumarDias(fin, -6);

  const medias = mediaMovil(regs, 7);
  const pts = medias.filter((m) => m.fecha >= inicio && m.fecha <= fin);
  if (!pts.length) {
    caja.append(el("div", { class: "vacio peso-grafico-vacio" },
      el("p", {}, regs.length ? "No hay pesajes en este período." : "Cuando cargues pesos, acá se ve la evolución.")));
    return;
  }

  const ancho = Math.max(280, Math.round(caja.clientWidth || 640));
  const alto = ancho < 520 ? 220 : 280;
  const m = { izq: 40, der: 16, arr: 14, aba: 28 };
  const w = ancho - m.izq - m.der;
  const h = alto - m.arr - m.aba;
  const totalDias = Math.max(1, diasEntre(inicio, fin));

  // dominio vertical
  const valores = pts.flatMap((p) => [p.kg, p.media]);
  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  const objetivo = perfil && typeof perfil.peso_objetivo_kg === "number" ? perfil.peso_objetivo_kg : null;
  const margenObj = Math.max(1.5, (hi - lo) * 0.6);
  const objetivoAdentro = objetivo != null && objetivo >= lo - margenObj && objetivo <= hi + margenObj;
  if (objetivoAdentro) { lo = Math.min(lo, objetivo); hi = Math.max(hi, objetivo); }
  if (hi - lo < 1) { const c = (hi + lo) / 2; lo = c - 0.5; hi = c + 0.5; }
  const pasoY = pasoLindo((hi - lo) / 4, [0.2, 0.5, 1, 2, 5, 10, 20, 50]);
  lo = Math.floor(lo / pasoY) * pasoY;
  hi = Math.ceil(hi / pasoY) * pasoY;
  if (hi === lo) hi = lo + pasoY;

  const x = (fecha) => m.izq + (diasEntre(inicio, fecha) / totalDias) * w;
  const y = (kg) => m.arr + (1 - (kg - lo) / (hi - lo)) * h;
  const decY = pasoY < 1 ? 1 : 0;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, class: "graf", role: "img", tabindex: 0,
    "aria-label": `Gráfico del peso del ${formatoFecha(inicio)} al ${formatoFecha(fin)}: ${pts.length} ` +
      `pesajes; la media de 7 días va de ${num(pts[0].media, 1)} a ${num(pts[pts.length - 1].media, 1)} kg. ` +
      "Con las flechas se recorren los pesajes.",
  });

  // grilla y eje Y
  const gEjes = svgEl("g", { class: "graf-ejes" });
  for (let v = lo; v <= hi + 1e-9; v += pasoY) {
    const yy = Math.round(y(v)) + 0.5;
    gEjes.append(svgEl("line", { x1: m.izq, x2: ancho - m.der, y1: yy, y2: yy, class: "graf-grilla" }));
    const t = svgEl("text", { x: m.izq - 6, y: yy, "text-anchor": "end", "dominant-baseline": "middle" });
    t.textContent = num(v, decY);
    gEjes.append(t);
  }
  // eje X: marcas contadas desde el final, para que siempre se vea la última fecha
  const maxMarcas = ancho < 520 ? 4 : 7;
  const pasoX = pasoLindo(totalDias / maxMarcas, [1, 2, 7, 14, 28, 56, 91, 182, 365, 730]);
  const conAnio = totalDias > 300;
  for (let k = 0; diasEntre(inicio, sumarDias(fin, -k * pasoX)) >= 0; k++) {
    const f = sumarDias(fin, -k * pasoX);
    const xx = x(f);
    const t = svgEl("text", { x: xx, y: alto - 8, "text-anchor": k === 0 ? "end" : "middle" });
    t.textContent = `${f.slice(8, 10)}/${f.slice(5, 7)}` + (conAnio ? `/${f.slice(2, 4)}` : "");
    if (xx - m.izq < 18) t.setAttribute("text-anchor", "start");
    gEjes.append(t);
    gEjes.append(svgEl("line", { x1: xx, x2: xx, y1: m.arr + h, y2: m.arr + h + 4, class: "graf-marca" }));
  }
  svg.append(gEjes);

  // objetivo
  if (objetivoAdentro) {
    const yy = y(objetivo);
    svg.append(svgEl("line", { x1: m.izq, x2: ancho - m.der, y1: yy, y2: yy, class: "graf-objetivo" }));
    const t = svgEl("text", { x: ancho - m.der - 2, y: yy - 5, "text-anchor": "end", class: "graf-objetivo-texto" });
    t.textContent = `objetivo ${num(objetivo, 1)} kg`;
    svg.append(t);
  }

  // puntos diarios
  const gPuntos = svgEl("g", { class: "graf-puntos" });
  for (const p of pts) gPuntos.append(svgEl("circle", { cx: x(p.fecha), cy: y(p.kg), r: 2.6 }));
  svg.append(gPuntos);

  // media móvil (se corta si hay más de 7 días sin pesarse)
  let d = "";
  pts.forEach((p, i) => {
    const corte = i === 0 || diasEntre(pts[i - 1].fecha, p.fecha) > 7;
    d += `${corte ? "M" : "L"}${x(p.fecha).toFixed(1)},${y(p.media).toFixed(1)}`;
  });
  svg.append(svgEl("path", { d, class: "graf-media", fill: "none" }));
  const ult = pts[pts.length - 1];
  svg.append(svgEl("circle", { cx: x(ult.fecha), cy: y(ult.media), r: 3.5, class: "graf-media-fin" }));

  // resaltado y tooltip
  const guia = svgEl("line", { y1: m.arr, y2: m.arr + h, class: "graf-guia", visibility: "hidden" });
  const marcaPunto = svgEl("circle", { r: 4.5, class: "graf-sel-punto", visibility: "hidden" });
  const marcaMedia = svgEl("circle", { r: 4.5, class: "graf-sel-media", visibility: "hidden" });
  svg.append(guia, marcaPunto, marcaMedia);
  const zona = svgEl("rect", { x: m.izq, y: m.arr, width: w, height: h, class: "graf-zona", fill: "transparent" });
  svg.append(zona);

  const tip = el("div", { class: "graf-tip", hidden: true, role: "status", "aria-live": "polite" });
  caja.append(svg, tip);

  let sel = -1;
  function mostrar(i) {
    sel = i;
    const p = pts[i];
    const xx = x(p.fecha);
    for (const [n, attrs] of [[guia, { x1: xx, x2: xx }], [marcaPunto, { cx: xx, cy: y(p.kg) }],
      [marcaMedia, { cx: xx, cy: y(p.media) }]]) {
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      n.setAttribute("visibility", "visible");
    }
    tip.replaceChildren(
      el("div", { class: "graf-tip-fecha" }, formatoFecha(p.fecha, { anio: conAnio })),
      el("div", { class: "num" }, el("strong", {}, `${num(p.kg, 1)} kg`)),
      el("div", { class: "num terciario" }, `media ${num(p.media, 1)} kg`));
    tip.hidden = false;
    const tw = tip.offsetWidth || 120;
    const izquierda = Math.min(Math.max(xx - tw / 2, 0), ancho - tw);
    const arriba = Math.min(y(p.kg), y(p.media)) - (tip.offsetHeight || 60) - 10;
    tip.style.left = `${izquierda}px`;
    tip.style.top = `${Math.max(arriba, 0)}px`;
  }
  function ocultar() {
    sel = -1;
    tip.hidden = true;
    for (const n of [guia, marcaPunto, marcaMedia]) n.setAttribute("visibility", "hidden");
  }
  function cercano(clientX) {
    const caja2 = svg.getBoundingClientRect();
    const px = ((clientX - caja2.left) / caja2.width) * ancho;
    let mejor = 0;
    let dist = Infinity;
    pts.forEach((p, i) => {
      const dd = Math.abs(x(p.fecha) - px);
      if (dd < dist) { dist = dd; mejor = i; }
    });
    return mejor;
  }
  zona.addEventListener("pointermove", (e) => mostrar(cercano(e.clientX)));
  zona.addEventListener("pointerdown", (e) => mostrar(cercano(e.clientX)));
  zona.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") ocultar(); });
  svg.addEventListener("focus", () => mostrar(sel >= 0 ? sel : pts.length - 1));
  svg.addEventListener("blur", ocultar);
  svg.addEventListener("keydown", (e) => {
    let i = sel < 0 ? pts.length - 1 : sel;
    if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") i = Math.min(pts.length - 1, i + 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = pts.length - 1;
    else if (e.key === "Escape") { ocultar(); return; }
    else return;
    e.preventDefault();
    mostrar(i);
  });

  // la línea del objetivo solo figura en la leyenda si entra en la escala
  const leyObjetivo = caja.closest(".peso-tarjeta-grafico")?.querySelector(".ley-objetivo");
  if (leyObjetivo) leyObjetivo.hidden = !objetivoAdentro;
}
