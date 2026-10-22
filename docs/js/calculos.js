// Cálculos puros: gasto, metas, peso (medias, ritmo, proyección), resúmenes de comidas y balance.
// Sin DOM y sin datos: reciben objetos y devuelven números. Fechas siempre "AAAA-MM-DD" (día local).
//
// Para todos: donde dice `registrosPeso` se acepta el array de registros o el objeto entero de
// peso.json ({version, registros}); donde dice `kg` se acepta un número o un registro {fecha, kg}
// (lo que devuelve pesoActual). Lo que no se puede calcular devuelve null, nunca NaN.
import { hoyISO, sumarDias, diasEntre } from "./util.js";

export const KCAL_POR_KG = 7700;

export const FACTORES_ACTIVIDAD = {
  sedentaria: 1.2,
  ligera: 1.375,
  moderada: 1.55,
  alta: 1.725,
};

// ---------------------------------------------------------------- auxiliares

const esNum = (x) => typeof x === "number" && Number.isFinite(x);

function kgDe(x) {
  if (esNum(x)) return x;
  if (x && esNum(x.kg)) return x.kg;
  return null;
}

/** Registros de peso válidos, ordenados por fecha (copia). */
function registrosDe(x) {
  const lista = Array.isArray(x) ? x : (x && Array.isArray(x.registros) ? x.registros : []);
  return lista
    .filter((r) => r && typeof r.fecha === "string" && esNum(r.kg))
    .map((r) => ({ fecha: r.fecha.slice(0, 10), kg: r.kg }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function comidasDe(registro) {
  return registro && Array.isArray(registro.comidas) ? registro.comidas : [];
}

const n0 = (x) => (esNum(x) ? x : 0);

// ---------------------------------------------------------------- cuerpo y metas

/** Años cumplidos a esa fecha (sin fecha: hoy). null si falta el nacimiento. */
export function edad(nacimiento, fecha = hoyISO()) {
  if (typeof nacimiento !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(nacimiento)) return null;
  const [an, mn, dn] = nacimiento.slice(0, 10).split("-").map(Number);
  const [af, mf, df] = fecha.slice(0, 10).split("-").map(Number);
  let anios = af - an;
  if (mf < mn || (mf === mn && df < dn)) anios -= 1;
  return anios;
}

/**
 * Metabolismo basal, Mifflin-St Jeor: 10·kg + 6,25·cm − 5·edad + 5 (hombre) | − 161 (mujer).
 * Sin redondear (kcal/día). null si falta algo.
 */
export function tmb({ sexo, kg, altura_cm, edad: anios } = {}) {
  const peso = kgDe(kg);
  if (!esNum(peso) || !esNum(altura_cm) || !esNum(anios)) return null;
  if (sexo !== "m" && sexo !== "f") return null;
  return 10 * peso + 6.25 * altura_cm - 5 * anios + (sexo === "m" ? 5 : -161);
}

/** Gasto diario = TMB × factor de actividad, redondeado a entero. null si falta algo. */
export function gastoDiario(perfil, kg, fecha = hoyISO()) {
  if (!perfil) return null;
  const factor = FACTORES_ACTIVIDAD[perfil.actividad];
  if (!factor) return null;
  const basal = tmb({ sexo: perfil.sexo, kg, altura_cm: perfil.altura_cm, edad: edad(perfil.nacimiento, fecha) });
  if (basal == null) return null;
  return Math.round(basal * factor);
}

/**
 * Meta de kcal del día: meta_kcal_manual si está cargada; si no, gasto diario − deficit_kcal
 * (sin déficit cargado, 0). Entero. null sin perfil o si falta algo para el gasto.
 */
export function metaKcal(perfil, kg, fecha = hoyISO()) {
  if (!perfil) return null;
  if (esNum(perfil.meta_kcal_manual)) return Math.round(perfil.meta_kcal_manual);
  const gasto = gastoDiario(perfil, kg, fecha);
  if (gasto == null) return null;
  return Math.round(gasto - n0(perfil.deficit_kcal));
}

/** Meta de proteína (g/día) = proteina_g_kg × peso_objetivo_kg (o kg si no hay objetivo). Entero. */
export function metaProteina(perfil, kg) {
  if (!perfil || !esNum(perfil.proteina_g_kg)) return null;
  const base = esNum(perfil.peso_objetivo_kg) ? perfil.peso_objetivo_kg : kgDe(kg);
  if (!esNum(base)) return null;
  return Math.round(perfil.proteina_g_kg * base);
}

// ---------------------------------------------------------------- peso

/** El último registro {fecha, kg} con fecha ≤ `fecha` (sin fecha: el último de todos), o null. */
export function pesoActual(registrosPeso, fecha) {
  const regs = registrosDe(registrosPeso);
  let ultimo = null;
  for (const r of regs) {
    if (fecha && r.fecha > fecha) break;
    ultimo = r;
  }
  return ultimo;
}

/**
 * Media móvil por días calendario: para cada registro, el promedio de los kg de los registros
 * con fecha en los últimos `dias` días calendario terminando ese día (ese día incluido: con 7,
 * de fecha−6 a fecha). Los días sin pesarse no cuentan (ni como cero ni interpolados).
 * → [{fecha, kg, media}] ordenado por fecha. `media` sin redondear.
 */
export function mediaMovil(registrosPeso, dias = 7) {
  const regs = registrosDe(registrosPeso);
  const salida = [];
  let ini = 0;
  let suma = 0;
  for (let i = 0; i < regs.length; i++) {
    suma += regs[i].kg;
    const desde = sumarDias(regs[i].fecha, -(dias - 1));
    while (regs[ini].fecha < desde) suma -= regs[ini++].kg;
    salida.push({ fecha: regs[i].fecha, kg: regs[i].kg, media: suma / (i - ini + 1) });
  }
  return salida;
}

/** Último punto de la media móvil con fecha ≤ `fecha`, o null. */
function puntoHasta(medias, fecha) {
  let p = null;
  for (const m of medias) {
    if (m.fecha > fecha) break;
    p = m;
  }
  return p;
}

/**
 * Cambio de la media móvil de 7 días en los últimos `dias` días hasta `fecha`:
 * media del último punto ≤ fecha − media del último punto ≤ fecha − dias. Negativo = bajó.
 * null si no hay un punto en (o antes de) cada punta.
 * → {cambio, desde: {fecha, media}, hasta: {fecha, media}} o null.
 */
export function cambioMedia(registrosPeso, fecha = hoyISO(), dias = 7) {
  const medias = mediaMovil(registrosPeso, 7);
  const hasta = puntoHasta(medias, fecha);
  const desde = puntoHasta(medias, sumarDias(fecha, -dias));
  if (!hasta || !desde || desde.fecha === hasta.fecha) return null;
  return { cambio: hasta.media - desde.media, desde, hasta };
}

/**
 * Ritmo en kg por semana: pendiente por mínimos cuadrados de la media móvil de 7 días (calculada
 * con todos los registros) contra los días calendario, usando los puntos con fecha en los últimos
 * `dias` días hasta `fecha` (fecha − dias + 1 … fecha), × 7. Negativo = baja.
 * null con menos de 4 puntos o si entre el primero y el último hay menos de 7 días.
 */
export function ritmoSemanal(registrosPeso, fecha = hoyISO(), dias = 28) {
  const desde = sumarDias(fecha, -(dias - 1));
  const pts = mediaMovil(registrosPeso, 7).filter((m) => m.fecha >= desde && m.fecha <= fecha);
  if (pts.length < 4) return null;
  if (diasEntre(pts[0].fecha, pts[pts.length - 1].fecha) < 7) return null;
  const xs = pts.map((p) => diasEntre(pts[0].fecha, p.fecha));
  const ys = pts.map((p) => p.media);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return (num / den) * 7;
}

/** Más de 10 años no es una proyección útil. */
const MAX_SEMANAS_PROYECCION = 520;

/**
 * Cuándo se llega a peso_objetivo_kg al ritmo actual (ritmoSemanal con 28 días hasta `fecha`),
 * partiendo de la media móvil del último registro ≤ fecha.
 * → {fecha (llegada), semanas, ritmo, desdeKg, objetivoKg} o null si no hay objetivo, si el
 * ritmo no se puede calcular, si no baja (ritmo ≥ 0), si ya está en el objetivo o por debajo,
 * o si serían más de 520 semanas.
 */
export function proyeccion(registrosPeso, perfil, fecha = hoyISO()) {
  if (!perfil || !esNum(perfil.peso_objetivo_kg)) return null;
  const ritmo = ritmoSemanal(registrosPeso, fecha);
  if (ritmo == null || ritmo >= 0) return null;
  const actual = puntoHasta(mediaMovil(registrosPeso, 7), fecha);
  if (!actual) return null;
  const falta = actual.media - perfil.peso_objetivo_kg;
  if (falta <= 0) return null;
  const semanas = falta / -ritmo;
  if (semanas > MAX_SEMANAS_PROYECCION) return null;
  return {
    fecha: sumarDias(actual.fecha, Math.round(semanas * 7)),
    semanas,
    ritmo,
    desdeKg: actual.media,
    objetivoKg: perfil.peso_objetivo_kg,
  };
}

// ---------------------------------------------------------------- comidas

/**
 * Totales de un día. `comidas` es la CANTIDAD de comidas (número); `lista` son las comidas de ese
 * día ordenadas por hora. → {fecha, kcal, proteina_g, carbos_g, grasa_g, comidas, lista}
 */
export function resumenDia(registro, fecha) {
  const lista = comidasDe(registro)
    .filter((c) => c && c.fecha === fecha)
    .sort((a, b) => String(a.hora || "").localeCompare(String(b.hora || "")));
  const suma = (k) => lista.reduce((s, c) => s + n0(c[k]), 0);
  return {
    fecha,
    kcal: suma("kcal"),
    proteina_g: suma("proteina_g"),
    carbos_g: suma("carbos_g"),
    grasa_g: suma("grasa_g"),
    comidas: lista.length,
    lista,
  };
}

/**
 * La semana de lunes a domingo. Los promedios cuentan solo los días con al menos una comida
 * (null si no hay ninguno), redondeados a entero.
 * → {lunes, dias: [resumenDia × 7], promedioKcal, promedioProteina_g, diasConComidas}
 */
export function resumenSemana(registro, lunes) {
  const dias = [];
  for (let i = 0; i < 7; i++) dias.push(resumenDia(registro, sumarDias(lunes, i)));
  const con = dias.filter((d) => d.comidas > 0);
  const prom = (k) => (con.length ? Math.round(con.reduce((s, d) => s + d[k], 0) / con.length) : null);
  return {
    lunes,
    dias,
    promedioKcal: prom("kcal"),
    promedioProteina_g: prom("proteina_g"),
    diasConComidas: con.length,
  };
}

// ---------------------------------------------------------------- balance

export const MIN_DIAS_BALANCE = 14;

/**
 * Balance del período: lo que se debería haber bajado según lo registrado contra lo que bajó la
 * media móvil.
 *
 * Período: los `dias` días calendario que terminan en `fecha`, inclusive
 * (desde = fecha − dias + 1 … hasta = fecha). La vista pasa AYER como `fecha`, para no contar el
 * día en curso, que todavía está incompleto.
 *
 * - Días con comidas = días del período con al menos una comida en el registro. Con menos de
 *   MIN_DIAS_BALANCE (14) → null.
 * - esperadoKg = Σ, SOLO sobre los días con comidas, de (gasto del día − kcal del día) / 7700.
 *   Positivo = se esperaba bajar. Los días SIN comidas no suman nada (ni el gasto ni 0 kcal):
 *   no se sabe qué se comió, así que se dejan afuera. Por eso, si faltan días, esperadoKg cubre
 *   menos días que realKg; como referencia va también esperadoKgPeriodo = esperadoKg × dias /
 *   diasConComidas (suponiendo que los días sin registro fueron como el promedio).
 *   El gasto de cada día usa el último peso registrado hasta ese día (si no hay ninguno antes,
 *   el primero del período en adelante) y la edad de ese día.
 * - realKg = media móvil de 7 días al empezar − media móvil al terminar. Positivo = bajó.
 *   "Al empezar" = el último punto de la media con fecha ≤ desde − 1 (el día anterior al
 *   período); si no hay, el primero dentro del período. "Al terminar" = el último ≤ hasta.
 *   null si no hay dos puntos distintos (realDias dice cuántos días separan esos dos puntos).
 *
 * → {esperadoKg, esperadoKgPeriodo, realKg, realDias, diasConComidas, dias, desde, hasta,
 *    kcalPromedio, gastoPromedio} o null (sin perfil completo, o con menos de 14 días con comidas).
 */
export function balance(registro, registrosPeso, perfil, fecha = hoyISO(), dias = 28) {
  const desde = sumarDias(fecha, -(dias - 1));
  const regs = registrosDe(registrosPeso);
  if (!regs.length) return null;

  let esperado = 0;
  let diasConComidas = 0;
  let sumaKcal = 0;
  let sumaGasto = 0;
  for (let i = 0; i < dias; i++) {
    const dia = sumarDias(desde, i);
    const r = resumenDia(registro, dia);
    if (r.comidas === 0) continue;
    const peso = pesoActual(regs, dia) || regs.find((x) => x.fecha >= desde) || regs[0];
    const gasto = gastoDiario(perfil, peso.kg, dia);
    if (gasto == null) return null;
    esperado += (gasto - r.kcal) / KCAL_POR_KG;
    sumaKcal += r.kcal;
    sumaGasto += gasto;
    diasConComidas++;
  }
  if (diasConComidas < MIN_DIAS_BALANCE) return null;

  const medias = mediaMovil(regs, 7);
  const ini = puntoHasta(medias, sumarDias(desde, -1)) || medias.find((m) => m.fecha >= desde && m.fecha <= fecha);
  const fin = puntoHasta(medias, fecha);
  const hayReal = ini && fin && ini.fecha < fin.fecha;

  return {
    esperadoKg: esperado,
    esperadoKgPeriodo: (esperado * dias) / diasConComidas,
    realKg: hayReal ? ini.media - fin.media : null,
    realDias: hayReal ? diasEntre(ini.fecha, fin.fecha) : null,
    diasConComidas,
    dias,
    desde,
    hasta: fecha,
    kcalPromedio: Math.round(sumaKcal / diasConComidas),
    gastoPromedio: Math.round(sumaGasto / diasConComidas),
  };
}
