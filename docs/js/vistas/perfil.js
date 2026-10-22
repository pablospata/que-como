// Vista Perfil (#/perfil): el formulario de perfil.json y las metas calculadas en vivo.
import { el, num, mensajeError, hoyISO, formatoFecha } from "../util.js";
import {
  edad, tmb, gastoDiario, metaKcal, metaProteina, pesoActual, FACTORES_ACTIVIDAD, KCAL_POR_KG,
} from "../calculos.js";

const ACTIVIDADES = [
  { id: "sedentaria", titulo: "Sedentaria", texto: "Trabajo sentado, casi sin ejercicio" },
  { id: "ligera", titulo: "Ligera", texto: "Caminatas o ejercicio suave 1 a 3 días por semana" },
  { id: "moderada", titulo: "Moderada", texto: "Ejercicio 3 a 5 días por semana" },
  { id: "alta", titulo: "Alta", texto: "Ejercicio fuerte casi todos los días, o trabajo físico" },
];

const RITMOS = [
  { valor: 250, titulo: "250 kcal/día", texto: "≈ 0,25 kg por semana" },
  { valor: 500, titulo: "500 kcal/día", texto: "≈ 0,5 kg por semana" },
  { valor: 750, titulo: "750 kcal/día", texto: "≈ 0,75 kg por semana" },
];

const PREDETERMINADO = {
  version: 1, sexo: null, nacimiento: null, altura_cm: null, actividad: null,
  peso_objetivo_kg: null, deficit_kcal: 500, proteina_g_kg: 1.6, meta_kcal_manual: null,
};

/** "1,6" / "1.6" → 1.6; vacío → null; otra cosa → NaN. */
function leerDecimal(texto) {
  const t = String(texto ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

/** 1.6 → "1,6" para mostrar en un campo de texto. */
const aTexto = (n) => (n == null || Number.isNaN(n) ? "" : String(n).replace(".", ","));

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
  let perfilGuardado, peso;
  try {
    [perfilGuardado, peso] = await Promise.all([ctx.datos.leerPerfil(), ctx.datos.leerPeso()]);
  } catch (e) {
    if (e && e.codigo === "sin_login") throw e;
    return errorConReintento(contenedor, e, ctx, () => montar(contenedor, params, ctx));
  }

  const ultimoPeso = pesoActual((peso && peso.registros) || [], hoy);
  let base = { ...PREDETERMINADO, ...(perfilGuardado || {}) };
  let guardando = false;

  // --- campos
  const radios = (nombre, opciones, actual, armar) => opciones.map((o) => {
    const valor = String(o.id ?? o.valor);
    const input = el("input", { type: "radio", name: nombre, value: valor, checked: String(actual) === valor });
    return el("label", { class: "perfil-opcion", title: o.ayuda }, input, armar(o));
  });
  const opcion = (o) => el("span", { class: "perfil-opcion-texto" },
    el("span", {}, o.titulo), o.texto ? el("span", { class: "perfil-opcion-desc" }, o.texto) : null);

  const sexo = el("fieldset", { class: "perfil-grupo" },
    el("legend", {}, "Sexo"),
    el("div", { class: "perfil-en-linea" },
      radios("sexo", [{ id: "m", titulo: "Hombre" }, { id: "f", titulo: "Mujer" }], base.sexo, opcion)));

  const nacimiento = el("input", { id: "perfil-nac", type: "date", max: hoy, min: "1900-01-01",
    value: base.nacimiento || "" });
  const edadTexto = el("span", { class: "perfil-nota num" });
  const altura = el("input", { id: "perfil-altura", type: "text", inputmode: "numeric", class: "num",
    placeholder: "178", value: aTexto(base.altura_cm), autocomplete: "off" });

  const actividad = el("fieldset", { class: "perfil-grupo" },
    el("legend", {}, "Actividad"),
    radios("actividad", ACTIVIDADES.map((a) => ({ ...a, ayuda: `Factor ${num(FACTORES_ACTIVIDAD[a.id], 3)}` })),
      base.actividad, opcion));

  const objetivo = el("input", { id: "perfil-objetivo", type: "text", inputmode: "decimal", class: "num",
    placeholder: "78", value: aTexto(base.peso_objetivo_kg), autocomplete: "off" });

  const esRitmoFijo = RITMOS.some((r) => r.valor === base.deficit_kcal);
  const ritmoOtro = el("input", { id: "perfil-deficit-otro", type: "text", inputmode: "numeric", class: "num",
    placeholder: "400", "aria-label": "Otro déficit, en kcal por día",
    value: !esRitmoFijo && base.deficit_kcal != null ? String(base.deficit_kcal) : "" });
  const ritmo = el("fieldset", { class: "perfil-grupo" },
    el("legend", {}, "Ritmo"),
    radios("ritmo", RITMOS, esRitmoFijo ? base.deficit_kcal : "", opcion),
    el("label", { class: "perfil-opcion" },
      el("input", { type: "radio", name: "ritmo", value: "otro", checked: !esRitmoFijo && base.deficit_kcal != null }),
      el("span", { class: "perfil-opcion-texto perfil-otro" },
        el("span", {}, "Otro"), ritmoOtro, el("span", { class: "perfil-opcion-desc" }, "kcal/día"))));

  const proteina = el("input", { id: "perfil-proteina", type: "text", inputmode: "decimal", class: "num",
    placeholder: "1,6", value: aTexto(base.proteina_g_kg), autocomplete: "off",
    title: "Gramos de proteína por kilo de peso objetivo. 1,6 es un valor habitual al bajar de peso." });

  const usarManual = el("input", { type: "checkbox", id: "perfil-usar-manual", checked: base.meta_kcal_manual != null });
  const manual = el("input", { id: "perfil-manual", type: "text", inputmode: "numeric", class: "num",
    placeholder: "1900", "aria-label": "Meta fija, en kcal por día",
    value: base.meta_kcal_manual != null ? String(base.meta_kcal_manual) : "" });
  const cajaManual = el("span", { class: "perfil-manual" }, manual, el("span", { class: "perfil-opcion-desc" }, "kcal/día"));

  const errores = el("div", { class: "perfil-errores", role: "alert" });
  const estadoGuardado = el("span", { class: "perfil-estado", "aria-live": "polite" });
  const botonGuardar = el("button", { class: "btn btn-primario", type: "submit" }, "Guardar");
  const botonDeshacer = el("button", { class: "perfil-deshacer", type: "button", onclick: deshacer }, "Descartar cambios");

  const campo = (id, texto, entrada, extra) => el("div", { class: "campo perfil-campo" },
    el("label", { for: id }, texto), entrada, extra || null);

  const form = el("form", { class: "perfil-form", novalidate: true, onsubmit: guardar },
    !perfilGuardado ? el("p", { class: "perfil-intro" },
      "Con estos datos se calcula el gasto diario y la meta de kcal.") : null,
    el("div", { class: "perfil-columnas" },
      el("div", { class: "perfil-bloque" },
        el("h2", { class: "perfil-h" }, "Vos"),
        sexo,
        el("div", { class: "perfil-pares" },
          campo("perfil-nac", "Nacimiento", nacimiento, edadTexto),
          campo("perfil-altura", "Altura (cm)", altura)),
        actividad),
      el("div", { class: "perfil-bloque" },
        el("h2", { class: "perfil-h" }, "Metas"),
        el("div", { class: "perfil-pares" },
          campo("perfil-objetivo", "Peso objetivo (kg)", objetivo),
          campo("perfil-proteina", "Proteína (g/kg)", proteina)),
        ritmo,
        el("div", { class: "perfil-grupo" },
          el("label", { class: "perfil-opcion", for: "perfil-usar-manual" }, usarManual,
            el("span", { class: "perfil-opcion-texto" }, el("span", {}, "Meta fija de kcal"),
              el("span", { class: "perfil-opcion-desc" }, "reemplaza la calculada"))),
          cajaManual))),
    errores,
    el("div", { class: "perfil-acciones" }, botonGuardar, botonDeshacer, estadoGuardado));

  const panel = el("aside", { class: "perfil-panel", "aria-label": "Cálculos con estos datos" });

  contenedor.append(
    el("h1", { class: "visualmente-oculto" }, "Perfil"),
    el("div", { class: "perfil-grilla" }, form, panel));

  // --- lectura del formulario
  function leer() {
    const f = new FormData(form);
    const errs = [];
    const p = { ...base };
    p.version = 1;
    p.sexo = f.get("sexo") || null;
    p.nacimiento = nacimiento.value || null;
    if (p.nacimiento && (p.nacimiento > hoy || p.nacimiento < "1900-01-01")) errs.push("La fecha de nacimiento no es válida.");

    const alt = leerDecimal(altura.value);
    if (Number.isNaN(alt) || (alt != null && (alt < 100 || alt > 250))) errs.push("La altura va en centímetros, entre 100 y 250.");
    p.altura_cm = alt != null && !Number.isNaN(alt) ? Math.round(alt) : null;

    p.actividad = f.get("actividad") || null;

    const obj = leerDecimal(objetivo.value);
    if (Number.isNaN(obj) || (obj != null && (obj < 30 || obj > 300))) errs.push("El peso objetivo tiene que estar entre 30 y 300 kg.");
    p.peso_objetivo_kg = obj != null && !Number.isNaN(obj) ? Math.round(obj * 10) / 10 : null;

    const r = f.get("ritmo");
    if (r === "otro") {
      const d = leerDecimal(ritmoOtro.value);
      if (d == null || Number.isNaN(d) || d > 1500) errs.push("El déficit va en kcal por día, entre 0 y 1.500.");
      p.deficit_kcal = d != null && !Number.isNaN(d) ? Math.round(d) : null;
    } else {
      p.deficit_kcal = r ? Number(r) : null;
    }

    const prot = leerDecimal(proteina.value);
    if (Number.isNaN(prot) || (prot != null && (prot < 0.5 || prot > 3))) errs.push("La proteína va en gramos por kilo, entre 0,5 y 3.");
    p.proteina_g_kg = prot != null && !Number.isNaN(prot) ? Math.round(prot * 100) / 100 : null;

    if (usarManual.checked) {
      const mk = leerDecimal(manual.value.replace(/\./g, ""));
      if (mk == null || Number.isNaN(mk) || mk < 800 || mk > 6000) errs.push("La meta fija va en kcal por día, entre 800 y 6.000.");
      p.meta_kcal_manual = mk != null && !Number.isNaN(mk) ? Math.round(mk) : null;
    } else {
      p.meta_kcal_manual = null;
    }
    return { perfil: p, errores: errs };
  }

  const CAMPOS = ["sexo", "nacimiento", "altura_cm", "actividad", "peso_objetivo_kg", "deficit_kcal",
    "proteina_g_kg", "meta_kcal_manual"];
  const hayCambios = (p) => CAMPOS.some((k) => (p[k] ?? null) !== (base[k] ?? null));

  // --- panel en vivo
  function pintarPanel(p) {
    const kg = ultimoPeso ? ultimoPeso.kg : null;
    const anios = edad(p.nacimiento, hoy);
    const basal = tmb({ sexo: p.sexo, kg, altura_cm: p.altura_cm, edad: anios });
    const gasto = gastoDiario(p, kg, hoy);
    const meta = metaKcal(p, kg, hoy);
    const prot = metaProteina(p, kg);

    const filas = el("dl", { class: "perfil-calc" });
    const fila = (titulo, valor, ayuda, clase) => filas.append(el("div", { class: clase || null, title: ayuda || null },
      el("dt", {}, titulo), el("dd", { class: "num" }, valor)));

    fila("Peso", ultimoPeso ? `${num(ultimoPeso.kg, 1)} kg` : "–",
      ultimoPeso ? `El último cargado, ${formatoFecha(ultimoPeso.fecha)}` : null);
    fila("Metabolismo basal", basal == null ? "–" : `${num(basal)} kcal`, "Lo que gasta el cuerpo en reposo, por día (Mifflin-St Jeor)");
    fila("Gasto diario", gasto == null ? "–" : `${num(gasto)} kcal`,
      p.actividad ? `Metabolismo basal × ${num(FACTORES_ACTIVIDAD[p.actividad], 3)} por la actividad` : null);
    fila("Meta", meta == null ? "–" : `${num(meta)} kcal`,
      p.meta_kcal_manual != null ? "Meta fija" : (p.deficit_kcal != null ? `Gasto diario − ${num(p.deficit_kcal)} kcal` : null),
      "perfil-calc-meta");
    fila("Proteína", prot == null ? "–" : `${num(prot)} g`,
      prot == null ? null : `${num(p.proteina_g_kg, 1)} g × ${num(p.peso_objetivo_kg != null ? p.peso_objetivo_kg : kg, 1)} kg`);
    if (gasto != null && meta != null) {
      const kgSemana = ((meta - gasto) * 7) / KCAL_POR_KG;
      fila("Ritmo esperado", Math.abs(kgSemana) < 0.005 ? "0 kg/sem" : `${kgSemana < 0 ? "−" : "+"}${num(Math.abs(kgSemana), 2)} kg/sem`,
        "Comiendo la meta todos los días (7.700 kcal ≈ 1 kg)");
    }

    panel.replaceChildren(filas);

    const faltan = [];
    if (!p.sexo) faltan.push("sexo");
    if (!p.nacimiento) faltan.push("nacimiento");
    if (!p.altura_cm) faltan.push("altura");
    if (!p.actividad) faltan.push("actividad");
    if (!ultimoPeso && p.meta_kcal_manual == null) {
      panel.append(el("p", { class: "perfil-aviso" }, "Falta un peso cargado. ", el("a", { href: "#/peso" }, "Cargar en Peso")));
    }
    if (faltan.length && p.meta_kcal_manual == null) {
      panel.append(el("p", { class: "perfil-aviso" }, `Falta: ${faltan.join(", ")}.`));
    }
  }

  function actualizar() {
    const { perfil: p, errores: errs } = leer();
    const anios = edad(p.nacimiento, hoy);
    edadTexto.textContent = anios != null && anios >= 0 ? `${anios} años` : "";
    ritmoOtro.disabled = form.querySelector('input[name="ritmo"]:checked')?.value !== "otro";
    manual.disabled = !usarManual.checked;
    cajaManual.hidden = !usarManual.checked;
    pintarPanel(p);
    const cambios = hayCambios(p);
    botonGuardar.disabled = guardando || !cambios;
    botonDeshacer.hidden = !cambios || !perfilGuardado;
    estadoGuardado.textContent = cambios ? "Cambios sin guardar" : "";
    if (!errs.length) errores.replaceChildren();
    return { perfil: p, errores: errs, cambios };
  }

  function deshacer() {
    form.reset(); // vuelve a los valores con que se armó el formulario (los guardados)
    actualizar();
  }

  async function guardar(ev) {
    ev.preventDefault();
    if (guardando) return;
    const { perfil: p, errores: errs, cambios } = actualizar();
    if (errs.length) {
      errores.replaceChildren(el("ul", {}, errs.map((t) => el("li", {}, t))));
      return;
    }
    if (!cambios) return;
    guardando = true;
    botonGuardar.disabled = true;
    try {
      await ctx.datos.guardarPerfil(p);
      base = { ...p };
      // lo guardado pasa a ser el estado "original" del formulario (para Descartar cambios)
      for (const n of form.querySelectorAll("input")) {
        if (n.type === "radio" || n.type === "checkbox") n.defaultChecked = n.checked;
        else n.defaultValue = n.value;
      }
      ctx.toast("Perfil guardado", { tipo: "ok" });
    } catch (e) {
      ctx.toast(mensajeError(e), { tipo: "error" });
    } finally {
      guardando = false;
      if (!perfilGuardado) perfilGuardado = base;
      actualizar();
    }
  }

  form.addEventListener("input", actualizar);
  form.addEventListener("change", actualizar);

  const antesDeSalir = (e) => {
    if (hayCambios(leer().perfil)) { e.preventDefault(); e.returnValue = ""; }
  };
  window.addEventListener("beforeunload", antesDeSalir);

  actualizar();

  return () => {
    window.removeEventListener("beforeunload", antesDeSalir);
    if (hayCambios(leer().perfil)) ctx.toast("Los cambios del perfil no se guardaron", { tipo: "info" });
  };
}
