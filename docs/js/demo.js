// Implementación de datos de demostración: todo en localStorage, con datos de ejemplo.
// Misma API que drive.js. ?demo=reset vuelve a los datos de ejemplo.
import { errorDatos } from "./datos.js";
import { hoyISO, sumarDias, isoConZona } from "./util.js";

const CLAVE = "quecomo-demo";

// ---------------------------------------------------------------- fotos de ejemplo (SVG)

function fotoEjemplo(etiqueta, colores) {
  const [fondo, a, b, c] = colores;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<rect width="400" height="300" fill="${fondo}"/>
<ellipse cx="200" cy="150" rx="150" ry="115" fill="#f4f1ea"/>
<ellipse cx="200" cy="150" rx="118" ry="88" fill="#fbfaf6"/>
<ellipse cx="165" cy="135" rx="55" ry="38" fill="${a}"/>
<ellipse cx="245" cy="160" rx="45" ry="32" fill="${b}"/>
<circle cx="200" cy="195" r="20" fill="${c}"/>
<text x="200" y="285" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#fff">${etiqueta}</text>
</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const MENUS = {
  desayuno: [
    { titulo: "Café con leche y tostadas", col: ["#8a6a4a", "#c9a27a", "#e8d9b5", "#7b4a2a"], items: [
      ["Café con leche", "1 taza (250 ml), leche entera", 120, 6, 10, 6],
      ["Tostadas de pan francés", "2 (~60 g)", 160, 5, 32, 1],
      ["Queso crema", "1 cda colmada (~20 g)", 50, 1, 1, 5]] },
    { titulo: "Yogur con granola y banana", col: ["#7a8c5a", "#f2efe6", "#e8c96a", "#b98a4a"], items: [
      ["Yogur natural", "1 pote (190 g)", 120, 7, 10, 6],
      ["Granola", "3 cdas (~35 g)", 160, 4, 22, 6],
      ["Banana", "1 mediana", 105, 1, 27, 0]] },
  ],
  almuerzo: [
    { titulo: "Milanesa con puré", col: ["#6a7a8a", "#c98a3a", "#f0e2b0", "#5a8a4a"], items: [
      ["Milanesa de carne frita", "1 grande (~180 g)", 420, 30, 20, 24],
      ["Puré de papas", "1 taza (~200 g)", 210, 4, 30, 8]] },
    { titulo: "Ensalada completa con pollo", col: ["#5a7a5a", "#7ab05a", "#e8b05a", "#d04a3a"], items: [
      ["Pechuga de pollo a la plancha", "1 (~150 g)", 250, 46, 0, 6],
      ["Ensalada de lechuga, tomate y zanahoria", "1 plato", 60, 2, 12, 0],
      ["Aceite de oliva", "1 cda (~13 g)", 115, 0, 0, 13],
      ["Huevo duro", "1", 75, 6, 1, 5]] },
    { titulo: "Fideos con tuco", col: ["#8a5a4a", "#e8c070", "#c04030", "#e0d0a0"], items: [
      ["Fideos secos cocidos", "1 plato (~250 g cocidos)", 390, 14, 78, 2],
      ["Salsa de tomate con carne", "1/2 taza", 150, 9, 8, 9],
      ["Queso rallado", "1 cda (~10 g)", 40, 3, 0, 3]] },
  ],
  merienda: [
    { titulo: "Mate con facturas", col: ["#7a6a3a", "#5a7a3a", "#e0a850", "#c08840"], items: [
      ["Mate amargo", "1 termo", 0, 0, 0, 0],
      ["Medialunas de manteca", "2", 280, 5, 30, 15]] },
    { titulo: "Fruta y frutos secos", col: ["#4a6a7a", "#d04040", "#a07040", "#e8d080"], items: [
      ["Manzana", "1 mediana", 95, 0, 25, 0],
      ["Almendras", "1 puñado (~25 g)", 145, 5, 5, 12]] },
  ],
  cena: [
    { titulo: "Empanadas de carne", col: ["#7a4a3a", "#d8a050", "#d8a050", "#5a8a4a"], items: [
      ["Empanadas de carne al horno", "3", 840, 33, 87, 39]] },
    { titulo: "Bife con ensalada", col: ["#5a4a4a", "#8a3a2a", "#7ab05a", "#e0c060"], items: [
      ["Bife de chorizo", "1 (~250 g crudo)", 520, 52, 0, 34],
      ["Ensalada mixta", "1 plato", 50, 2, 10, 0],
      ["Aceite", "1 cda", 120, 0, 0, 14],
      ["Pan francés", "1/2 (~40 g)", 110, 4, 22, 1]] },
    { titulo: "Pizza", col: ["#6a3a2a", "#e0b050", "#c04030", "#f0e0a0"], items: [
      ["Pizza de muzzarella", "3 porciones", 810, 33, 90, 33],
      ["Cerveza", "1 lata (473 ml)", 200, 2, 17, 0]] },
  ],
};

function comidaDe(fecha, hora, tipo, menu, i) {
  const id = `g-${fecha.replaceAll("-", "")}-${hora.replace(":", "")}00-dm${i.toString(36).padStart(2, "0")}`;
  const fotoId = `demo-foto-${id}`;
  const items = menu.items.map(([nombre, porcion, kcal, p, c, g]) =>
    ({ nombre, porcion, kcal, proteina_g: p, carbos_g: c, grasa_g: g }));
  const suma = (k) => items.reduce((s, it) => s + it[k], 0);
  return {
    comida: {
      id, fecha, hora, tipo, titulo: menu.titulo, fotos: [fotoId], nota: "",
      items, kcal: suma("kcal"), proteina_g: suma("proteina_g"), carbos_g: suma("carbos_g"),
      grasa_g: suma("grasa_g"), confianza: ["alta", "media", "media", "baja"][i % 4],
      comentario: i % 3 === 0 ? "Porciones estimadas por el tamaño del plato." : "",
      procesada: `${fecha}T22:00:00-03:00`, editada: false, revisar: null,
    },
    pieza: { id: fotoId, tipo: "foto", nombre: `${id}.svg`, grupo: id,
      tomada: `${fecha}T${hora}:00-03:00`, estado: "procesada", nota: "",
      url: fotoEjemplo(menu.titulo, menu.col) },
  };
}

function datosEjemplo() {
  const hoy = hoyISO();
  const comidas = [];
  const piezas = [];
  let i = 0;
  const agregar = (fecha, hora, tipo) => {
    const lista = MENUS[tipo];
    const r = comidaDe(fecha, hora, tipo, lista[(i * 7 + fecha.charCodeAt(9)) % lista.length], i++);
    comidas.push(r.comida);
    piezas.push(r.pieza);
  };
  for (let d = -7; d <= -1; d++) {
    const f = sumarDias(hoy, d);
    agregar(f, "08:30", "desayuno");
    agregar(f, "13:15", "almuerzo");
    if (d % 2 === 0) agregar(f, "17:40", "merienda");
    agregar(f, "21:30", "cena");
  }
  agregar(hoy, "08:45", "desayuno");
  comidas[comidas.length - 1].nota = "con edulcorante";

  // dos capturas pendientes de hoy
  const pend = (hora, etiqueta, colores, nota, n) => {
    const grupo = `g-${hoy.replaceAll("-", "")}-${hora.replace(":", "")}00-pn${n}`;
    for (let k = 0; k < (n === 1 ? 2 : 1); k++) {
      piezas.push({ id: `demo-pend-${grupo}-${k}`, tipo: "foto", nombre: `${grupo}-${k}.svg`, grupo,
        tomada: `${hoy}T${hora}:00-03:00`, estado: "pendiente", nota,
        url: fotoEjemplo(etiqueta + (k ? " (2)" : ""), colores) });
    }
  };
  pend("13:20", "Almuerzo", ["#5a6a7a", "#c88a40", "#7ab05a", "#e0d0a0"], "media porción de arroz", 1);
  pend("16:05", "Merienda", ["#6a5a4a", "#e0c080", "#b07040", "#f0e0c0"], "", 2);

  // 30 días de peso: bajando de a poco, con ruido y algunos días sin pesarse
  const registros = [];
  for (let d = -30; d <= 0; d++) {
    if (d % 4 === 2) continue;
    const ruido = Math.sin(d * 1.7) * 0.35;
    registros.push({ fecha: sumarDias(hoy, d), kg: Math.round((84.6 - d * 0.07 + ruido) * 10) / 10 });
  }

  return {
    piezas,
    registro: { version: 1, actualizado: isoConZona(), comidas },
    perfil: { version: 1, sexo: "m", nacimiento: "1985-04-12", altura_cm: 178, actividad: "ligera",
      peso_objetivo_kg: 78, deficit_kcal: 500, proteina_g_kg: 1.6, meta_kcal_manual: null },
    peso: { version: 1, registros },
  };
}

// ---------------------------------------------------------------- almacenamiento

let mem = null;

function cargar() {
  if (mem) return mem;
  const reset = new URLSearchParams(location.search).get("demo") === "reset";
  if (!reset) {
    try { mem = JSON.parse(localStorage.getItem(CLAVE)); } catch { mem = null; }
  }
  if (!mem) {
    mem = datosEjemplo();
    guardar();
  }
  return mem;
}

function guardar() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(mem));
  } catch {
    throw errorDatos("drive", "No entra más en el almacenamiento de la demo: usá ?demo=reset.");
  }
}

const pausa = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const copia = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

function aDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------- API

export function estado() {
  return { conectado: true, email: "demo@ejemplo.com", demo: true };
}

export async function conectar() {}
export async function desconectar() {}

/** Como en drive.js: con `pieza` (id fijo de la cola), si ya existe no se crea de nuevo. */
const piezaExistente = (d, pieza) => (pieza ? d.piezas.find((p) => p.pieza === pieza) : null);

export async function subirFoto(blob, { grupo, tomada, nota = "", pieza }) {
  const d = cargar();
  await pausa(400);
  const previa = piezaExistente(d, pieza);
  const id = previa ? previa.id : `demo-sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (!previa) {
    d.piezas.push({ id, tipo: "foto", nombre: `${grupo}.jpg`, grupo, tomada, estado: "pendiente",
      nota, url: await aDataURL(blob), pieza });
  }
  for (const p of d.piezas) if (p.grupo === grupo) p.nota = nota || p.nota;
  guardar();
  return { id };
}

export async function crearTexto(texto, { grupo, tomada, pieza }) {
  const d = cargar();
  await pausa();
  const previa = piezaExistente(d, pieza);
  if (previa) return { id: previa.id };
  const id = `demo-txt-${Date.now()}`;
  d.piezas.push({ id, tipo: "texto", nombre: `${grupo}.txt`, grupo, tomada, estado: "pendiente", nota: texto, pieza });
  guardar();
  return { id };
}

export async function pendientes() {
  const d = cargar();
  await pausa();
  const grupos = new Map();
  for (const p of d.piezas) {
    if (p.estado !== "pendiente") continue;
    if (!grupos.has(p.grupo)) grupos.set(p.grupo, { grupo: p.grupo, tomada: p.tomada, nota: p.nota || "", piezas: [] });
    const g = grupos.get(p.grupo);
    if (p.tomada < g.tomada) g.tomada = p.tomada;
    g.piezas.push({ id: p.id, tipo: p.tipo, nombre: p.nombre });
  }
  return [...grupos.values()].sort((a, b) => a.tomada.localeCompare(b.tomada));
}

export async function cambiarNota(grupo, nota) {
  const d = cargar();
  await pausa();
  for (const p of d.piezas) if (p.grupo === grupo) p.nota = nota;
  guardar();
}

export async function descartar(grupo) {
  const d = cargar();
  await pausa();
  for (const p of d.piezas) if (p.grupo === grupo) p.estado = "descartada";
  guardar();
}

export async function urlFoto(id) {
  const p = cargar().piezas.find((x) => x.id === id);
  if (!p || !p.url) throw errorDatos("drive", "No encontré esa foto.");
  return p.url;
}

export async function leerRegistro() {
  await pausa();
  return copia(cargar().registro);
}

export async function actualizarRegistro(fn) {
  const d = cargar();
  await pausa();
  const nuevo = await fn(copia(d.registro));
  nuevo.actualizado = isoConZona();
  d.registro = nuevo;
  guardar();
  return copia(nuevo);
}

export async function leerPerfil() {
  await pausa();
  return copia(cargar().perfil);
}

export async function guardarPerfil(perfil) {
  const d = cargar();
  await pausa();
  d.perfil = copia(perfil);
  guardar();
}

export async function leerPeso() {
  await pausa();
  return copia(cargar().peso);
}

export async function guardarPeso(datos) {
  const d = cargar();
  await pausa();
  d.peso = copia(datos);
  d.peso.registros.sort((a, b) => a.fecha.localeCompare(b.fecha));
  guardar();
}

