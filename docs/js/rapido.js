// Botones flotantes del panel (abajo a la derecha): sacar foto y cargar el peso sin cambiar de
// pantalla. Son las dos cosas que más se hacen; no se muestran en la cámara.
import { el, icono, hoyISO, num, mensajeError } from "./util.js";

let caja = null;
let botonPeso = null;

/** Crea los botones una vez. ctx: {datos, navegar, toast, alGuardarPeso}. */
export function montarRapido(ctx) {
  botonPeso = el("button", { class: "rapido-btn rapido-peso", type: "button",
    "aria-label": "Cargar peso", title: "Cargar peso", onclick: () => abrirPeso(ctx) }, icono("pesa", 30));
  const botonFoto = el("button", { class: "rapido-btn rapido-foto", type: "button",
    "aria-label": "Sacar foto", title: "Sacar foto", onclick: () => ctx.navegar("captura/abrir") }, icono("camara", 26));
  caja = el("div", { class: "rapido" }, botonPeso, botonFoto);
  document.body.append(caja);
}

/** Muestra u oculta según la vista: nada en la cámara, sin balanza en Peso (ya tiene su campo). */
export function actualizarRapido(vista) {
  if (!caja) return;
  caja.hidden = vista === "captura";
  botonPeso.hidden = vista === "peso";
}

// ---------------------------------------------------------------- hoja del peso

function leerKg(texto) {
  const t = String(texto).trim().replace(",", ".");
  if (!/^\d{2,3}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 10) / 10;
}

async function abrirPeso(ctx) {
  const hoy = hoyISO();
  const entrada = el("input", { class: "entrada num", type: "text", inputmode: "decimal",
    autocomplete: "off", placeholder: "kg", "aria-label": "Peso en kilos" });
  const aviso = el("p", { class: "rapido-aviso", "aria-live": "polite" });
  const guardar = el("button", { class: "btn btn-primario", type: "submit" }, "Guardar");
  const form = el("form", { class: "rapido-form", method: "dialog" },
    el("h2", {}, "Peso de hoy"),
    el("div", { class: "rapido-fila" }, entrada, guardar),
    aviso);
  const dialogo = el("dialog", { class: "rapido-dialogo", "aria-label": "Cargar peso" }, form);
  dialogo.addEventListener("close", () => dialogo.remove());
  dialogo.addEventListener("click", (e) => { if (e.target === dialogo) dialogo.close(); });
  document.body.append(dialogo);
  dialogo.showModal();
  entrada.focus();

  // si ya hay un peso de hoy, se muestra seleccionado para corregirlo (salvo que ya se esté escribiendo)
  let escribio = false;
  entrada.addEventListener("input", () => { escribio = true; }, { once: true });
  try {
    const actual = (await ctx.datos.leerPeso()).registros.find((r) => r.fecha === hoy);
    if (actual && !escribio) {
      entrada.value = num(actual.kg, 1);
      entrada.select();
    }
  } catch { /* se ve al guardar */ }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const kg = leerKg(entrada.value);
    if (kg == null || kg < 30 || kg > 300) {
      aviso.textContent = "Escribí el peso en kilos, por ejemplo 84,3.";
      entrada.focus();
      return;
    }
    guardar.disabled = true;
    try {
      const datos = await ctx.datos.leerPeso();
      const registros = datos.registros.filter((r) => r.fecha !== hoy);
      registros.push({ fecha: hoy, kg });
      await ctx.datos.guardarPeso({ ...datos, registros });
      dialogo.close();
      ctx.toast(`Peso guardado: ${num(kg, 1)} kg`, { tipo: "ok" });
      ctx.alGuardarPeso();
    } catch (err) {
      aviso.textContent = mensajeError(err);
      guardar.disabled = false;
    }
  });
}
