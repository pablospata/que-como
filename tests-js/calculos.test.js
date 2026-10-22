// Pruebas de docs/js/calculos.js — correr con: node --test tests-js/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  edad, tmb, gastoDiario, metaKcal, metaProteina, pesoActual, mediaMovil, resumenDia,
  resumenSemana, ritmoSemanal, proyeccion, balance, cambioMedia, FACTORES_ACTIVIDAD,
} from "../docs/js/calculos.js";
import { sumarDias } from "../docs/js/util.js";

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

const PERFIL = {
  version: 1, sexo: "m", nacimiento: "1985-04-12", altura_cm: 178, actividad: "ligera",
  peso_objetivo_kg: 78, deficit_kcal: 500, proteina_g_kg: 1.6, meta_kcal_manual: null,
};

/** n registros diarios desde `inicio`, kg = f(i). */
function serie(inicio, n, f) {
  return Array.from({ length: n }, (_, i) => ({ fecha: sumarDias(inicio, i), kg: f(i) }));
}

// ------------------------------------------------------------ edad

test("edad: años cumplidos alrededor del cumpleaños", () => {
  assert.equal(edad("1985-04-12", "2026-04-11"), 40);
  assert.equal(edad("1985-04-12", "2026-04-12"), 41);
  assert.equal(edad("1985-04-12", "2026-04-13"), 41);
  assert.equal(edad("1985-04-12", "2026-10-22"), 41);
  assert.equal(edad("1985-12-31", "2026-01-01"), 40);
  assert.equal(edad("2000-02-29", "2025-02-28"), 24);
  assert.equal(edad("2000-02-29", "2025-03-01"), 25);
  assert.equal(edad(null, "2026-01-01"), null);
  assert.equal(edad("", "2026-01-01"), null);
});

// ------------------------------------------------------------ tmb, gasto, metas

test("tmb: Mifflin-St Jeor hombre y mujer", () => {
  cerca(tmb({ sexo: "m", kg: 80, altura_cm: 178, edad: 40 }), 800 + 1112.5 - 200 + 5); // 1717,5
  cerca(tmb({ sexo: "f", kg: 65, altura_cm: 165, edad: 30 }), 650 + 1031.25 - 150 - 161); // 1370,25
  cerca(tmb({ sexo: "m", kg: { fecha: "2026-01-01", kg: 80 }, altura_cm: 178, edad: 40 }), 1717.5);
});

test("tmb: falta algo → null", () => {
  assert.equal(tmb({ sexo: "m", kg: null, altura_cm: 178, edad: 40 }), null);
  assert.equal(tmb({ sexo: "x", kg: 80, altura_cm: 178, edad: 40 }), null);
  assert.equal(tmb({ sexo: "f", kg: 80, edad: 40 }), null);
  assert.equal(tmb({ sexo: "f", kg: 80, altura_cm: 170, edad: null }), null);
  assert.equal(tmb(), null);
});

test("gastoDiario: factores de actividad", () => {
  assert.deepEqual(FACTORES_ACTIVIDAD, { sedentaria: 1.2, ligera: 1.375, moderada: 1.55, alta: 1.725 });
  // 41 años, 84 kg: 840 + 1112,5 − 205 + 5 = 1752,5
  const basal = 1752.5;
  for (const [act, f] of Object.entries(FACTORES_ACTIVIDAD)) {
    assert.equal(gastoDiario({ ...PERFIL, actividad: act }, 84, "2026-10-22"), Math.round(basal * f));
  }
  assert.equal(gastoDiario(PERFIL, 84, "2026-10-22"), 2410); // 2409,69
  // con un registro {fecha, kg} en vez del número
  assert.equal(gastoDiario(PERFIL, { fecha: "2026-10-22", kg: 84 }, "2026-10-22"), 2410);
  // mujer
  const f = { ...PERFIL, sexo: "f", nacimiento: "1996-01-01", altura_cm: 165, actividad: "sedentaria" };
  assert.equal(gastoDiario(f, 65, "2026-06-01"), Math.round((650 + 1031.25 - 150 - 161) * 1.2)); // 1644
});

test("gastoDiario: datos faltantes → null", () => {
  assert.equal(gastoDiario(null, 84, "2026-10-22"), null);
  assert.equal(gastoDiario(PERFIL, null, "2026-10-22"), null);
  assert.equal(gastoDiario({ ...PERFIL, actividad: "otra" }, 84, "2026-10-22"), null);
  assert.equal(gastoDiario({ ...PERFIL, nacimiento: null }, 84, "2026-10-22"), null);
  assert.equal(gastoDiario({ ...PERFIL, altura_cm: null }, 84, "2026-10-22"), null);
  assert.equal(gastoDiario({ ...PERFIL, sexo: null }, 84, "2026-10-22"), null);
});

test("metaKcal: gasto − déficit, manual reemplaza, faltantes → null", () => {
  assert.equal(metaKcal(PERFIL, 84, "2026-10-22"), 2410 - 500);
  assert.equal(metaKcal({ ...PERFIL, deficit_kcal: 750 }, 84, "2026-10-22"), 2410 - 750);
  assert.equal(metaKcal({ ...PERFIL, deficit_kcal: null }, 84, "2026-10-22"), 2410);
  assert.equal(metaKcal({ ...PERFIL, meta_kcal_manual: 1800 }, 84, "2026-10-22"), 1800);
  assert.equal(metaKcal({ ...PERFIL, meta_kcal_manual: 1800 }, null, "2026-10-22"), 1800); // no necesita peso
  assert.equal(metaKcal(PERFIL, null, "2026-10-22"), null);
  assert.equal(metaKcal(null, 84, "2026-10-22"), null);
  assert.equal(metaKcal({ ...PERFIL, nacimiento: undefined }, 84, "2026-10-22"), null);
});

test("metaProteina: por peso objetivo, o por kg si falta", () => {
  assert.equal(metaProteina(PERFIL, 84), 125); // 1,6 × 78 = 124,8
  assert.equal(metaProteina({ ...PERFIL, peso_objetivo_kg: null }, 84), 134); // 134,4
  assert.equal(metaProteina({ ...PERFIL, peso_objetivo_kg: null }, { fecha: "x", kg: 90 }), 144);
  assert.equal(metaProteina({ ...PERFIL, peso_objetivo_kg: null }, null), null);
  assert.equal(metaProteina({ ...PERFIL, proteina_g_kg: null }, 84), null);
  assert.equal(metaProteina(null, 84), null);
});

// ------------------------------------------------------------ peso

test("pesoActual: último registro hasta la fecha", () => {
  const regs = [
    { fecha: "2026-10-20", kg: 84.1 },
    { fecha: "2026-10-10", kg: 85 },
    { fecha: "2026-10-15", kg: 84.6 },
  ];
  assert.deepEqual(pesoActual(regs, "2026-10-16"), { fecha: "2026-10-15", kg: 84.6 });
  assert.deepEqual(pesoActual(regs, "2026-10-15"), { fecha: "2026-10-15", kg: 84.6 });
  assert.deepEqual(pesoActual(regs, "2026-10-30"), { fecha: "2026-10-20", kg: 84.1 });
  assert.deepEqual(pesoActual(regs), { fecha: "2026-10-20", kg: 84.1 });
  assert.equal(pesoActual(regs, "2026-10-09"), null);
  assert.equal(pesoActual([], "2026-10-09"), null);
  assert.equal(pesoActual(null), null);
  // acepta el objeto entero de peso.json
  assert.deepEqual(pesoActual({ version: 1, registros: regs }, "2026-10-12"), { fecha: "2026-10-10", kg: 85 });
});

test("mediaMovil: ventana de días calendario, con huecos", () => {
  const regs = [
    { fecha: "2026-01-08", kg: 84 },
    { fecha: "2026-01-01", kg: 80 },
    { fecha: "2026-01-03", kg: 82 },
    { fecha: "2026-01-20", kg: 90 },
  ];
  const m = mediaMovil(regs);
  assert.deepEqual(m.map((x) => x.fecha), ["2026-01-01", "2026-01-03", "2026-01-08", "2026-01-20"]);
  cerca(m[0].media, 80);
  cerca(m[1].media, 81); // 01-01 y 01-03
  cerca(m[2].media, 83); // 01-02..01-08: solo 01-03 y 01-08 (01-01 queda afuera)
  cerca(m[3].media, 90); // nada más en 01-14..01-20
  assert.equal(m[2].kg, 84);
  // ventana de 1 día = el mismo peso
  assert.deepEqual(mediaMovil(regs, 1).map((x) => x.media), [80, 82, 84, 90]);
  // ventana 8: 01-01..01-08 entra el 01-01
  cerca(mediaMovil(regs, 8)[2].media, 82);
  assert.deepEqual(mediaMovil([]), []);
});

test("cambioMedia: diferencia de la media entre dos puntas", () => {
  const regs = serie("2026-01-01", 40, (i) => 90 - 0.1 * i);
  const c = cambioMedia(regs, "2026-02-09", 7);
  cerca(c.cambio, -0.7, 1e-9);
  assert.equal(cambioMedia(regs, "2026-01-01", 7), null);
});

test("ritmoSemanal: pendiente de la media móvil, kg/semana", () => {
  // 0,1 kg menos por día durante 60 días → −0,7 kg/semana
  const regs = serie("2026-01-01", 60, (i) => 90 - 0.1 * i);
  const fin = sumarDias("2026-01-01", 59);
  cerca(ritmoSemanal(regs, fin), -0.7, 1e-9);
  cerca(ritmoSemanal(regs, fin, 14), -0.7, 1e-9);
  // subiendo
  const sube = serie("2026-01-01", 40, (i) => 80 + 0.05 * i);
  cerca(ritmoSemanal(sube, sumarDias("2026-01-01", 39)), 0.35, 1e-9);
  // estable
  cerca(ritmoSemanal(serie("2026-01-01", 30, () => 80), "2026-01-30"), 0, 1e-12);
  // con huecos (cada 3 días) sigue dando la pendiente
  const huecos = serie("2026-01-01", 90, (i) => 90 - 0.1 * i).filter((_, i) => i % 3 === 0);
  cerca(ritmoSemanal(huecos, sumarDias("2026-01-01", 89)), -0.7, 1e-9);
});

test("ritmoSemanal: pocos puntos → null", () => {
  const regs = serie("2026-01-01", 60, (i) => 90 - 0.1 * i);
  assert.equal(ritmoSemanal(regs.slice(0, 3), "2026-01-03"), null); // 3 puntos
  assert.equal(ritmoSemanal(regs.slice(0, 5), "2026-01-05"), null); // 5 puntos en 4 días
  assert.notEqual(ritmoSemanal(regs.slice(0, 8), "2026-01-08"), null); // 8 puntos en 7 días
  assert.equal(ritmoSemanal([], "2026-01-08"), null);
  // los registros fuera de la ventana no cuentan
  assert.equal(ritmoSemanal(regs.slice(0, 10), "2026-03-30"), null);
});

test("proyeccion: fecha de llegada al objetivo", () => {
  const regs = serie("2026-01-01", 60, (i) => 90 - 0.1 * i); // último: 03-01, 84,1 kg
  const fin = sumarDias("2026-01-01", 59);
  const p = proyeccion(regs, PERFIL, fin);
  // media del último punto: promedio de 84,7..84,1 = 84,4; faltan 6,4 kg a 0,7/semana
  cerca(p.desdeKg, 84.4, 1e-9);
  cerca(p.semanas, 6.4 / 0.7, 1e-9);
  assert.equal(p.fecha, sumarDias(fin, Math.round((6.4 / 0.7) * 7))); // 64 días
  cerca(p.ritmo, -0.7, 1e-9);
  assert.equal(p.objetivoKg, 78);
});

test("proyeccion: null si no baja, si ya llegó o si falta algo", () => {
  const sube = serie("2026-01-01", 40, (i) => 85 + 0.05 * i);
  assert.equal(proyeccion(sube, PERFIL, sumarDias("2026-01-01", 39)), null);
  const estable = serie("2026-01-01", 40, () => 85);
  assert.equal(proyeccion(estable, PERFIL, sumarDias("2026-01-01", 39)), null);
  const debajo = serie("2026-01-01", 40, (i) => 77 - 0.1 * i);
  assert.equal(proyeccion(debajo, PERFIL, sumarDias("2026-01-01", 39)), null);
  const baja = serie("2026-01-01", 40, (i) => 90 - 0.1 * i);
  assert.equal(proyeccion(baja, { ...PERFIL, peso_objetivo_kg: null }, sumarDias("2026-01-01", 39)), null);
  assert.equal(proyeccion(baja, null, sumarDias("2026-01-01", 39)), null);
  assert.equal(proyeccion(baja.slice(0, 3), PERFIL, "2026-01-03"), null);
  // bajando tan despacio que serían más de 10 años
  const lento = serie("2026-01-01", 40, (i) => 100 - 0.0001 * i);
  assert.equal(proyeccion(lento, PERFIL, sumarDias("2026-01-01", 39)), null);
});

// ------------------------------------------------------------ comidas

const comida = (fecha, hora, kcal, p = 0, c = 0, g = 0) =>
  ({ id: `g-${fecha}-${hora}`, fecha, hora, kcal, proteina_g: p, carbos_g: c, grasa_g: g });

test("resumenDia: suma y cantidad de comidas del día", () => {
  const registro = { version: 1, comidas: [
    comida("2026-10-22", "21:30", 800, 40, 80, 30),
    comida("2026-10-22", "08:30", 300, 10, 40, 8),
    comida("2026-10-21", "13:00", 600, 30, 50, 20),
  ] };
  const r = resumenDia(registro, "2026-10-22");
  assert.equal(r.fecha, "2026-10-22");
  assert.equal(r.kcal, 1100);
  assert.equal(r.proteina_g, 50);
  assert.equal(r.carbos_g, 120);
  assert.equal(r.grasa_g, 38);
  assert.equal(r.comidas, 2);
  assert.deepEqual(r.lista.map((c) => c.hora), ["08:30", "21:30"]);
  const vacio = resumenDia(registro, "2026-10-23");
  assert.deepEqual([vacio.kcal, vacio.proteina_g, vacio.comidas, vacio.lista.length], [0, 0, 0, 0]);
  assert.equal(resumenDia(null, "2026-10-23").comidas, 0);
  assert.equal(resumenDia({ version: 1, comidas: [] }, "2026-10-23").kcal, 0);
});

test("resumenSemana: promedio solo sobre días con comidas", () => {
  const registro = { version: 1, comidas: [
    comida("2026-10-19", "13:00", 2000, 100), // lunes
    comida("2026-10-21", "13:00", 1000, 60), // miércoles
    comida("2026-10-21", "20:00", 500, 20),
    comida("2026-10-26", "13:00", 9999, 1), // lunes siguiente: afuera
    comida("2026-10-18", "13:00", 9999, 1), // domingo anterior: afuera
  ] };
  const s = resumenSemana(registro, "2026-10-19");
  assert.equal(s.dias.length, 7);
  assert.deepEqual(s.dias.map((d) => d.fecha),
    ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.deepEqual(s.dias.map((d) => d.kcal), [2000, 0, 1500, 0, 0, 0, 0]);
  assert.equal(s.diasConComidas, 2);
  assert.equal(s.promedioKcal, 1750);
  assert.equal(s.promedioProteina_g, 90);
  const vacia = resumenSemana(registro, "2026-11-02");
  assert.equal(vacia.diasConComidas, 0);
  assert.equal(vacia.promedioKcal, null);
});

// ------------------------------------------------------------ balance

test("balance: esperado por kcal registradas contra la media", () => {
  const fin = "2026-03-31";
  const desde = sumarDias(fin, -27);
  const regs = serie("2026-02-01", 59, () => 80); // peso estable hasta 03-31
  const gasto = gastoDiario(PERFIL, 80, desde); // misma edad en todo el período
  // 28 días comiendo 770 kcal menos que el gasto → 0,1 kg por día → 2,8 kg
  const comidas = [];
  for (let i = 0; i < 28; i++) comidas.push(comida(sumarDias(desde, i), "13:00", gasto - 770));
  const b = balance({ comidas }, regs, PERFIL, fin);
  cerca(b.esperadoKg, 2.8, 1e-9);
  cerca(b.esperadoKgPeriodo, 2.8, 1e-9);
  cerca(b.realKg, 0, 1e-9);
  assert.equal(b.diasConComidas, 28);
  assert.equal(b.dias, 28);
  assert.equal(b.desde, desde);
  assert.equal(b.hasta, fin);
  assert.equal(b.kcalPromedio, gasto - 770);
  assert.equal(b.gastoPromedio, gasto);
});

test("balance: los días sin comidas no cuentan; menos de 14 → null", () => {
  const fin = "2026-03-31";
  const desde = sumarDias(fin, -27);
  const regs = serie("2026-02-01", 59, () => 80);
  const gasto = gastoDiario(PERFIL, 80, desde);
  const conDias = (n) => ({ comidas: Array.from({ length: n }, (_, i) =>
    comida(sumarDias(desde, i * 2 % 28 + (i >= 14 ? 1 : 0)), "13:00", gasto - 770)) });
  const b20 = balance(conDias(20), regs, PERFIL, fin);
  assert.equal(b20.diasConComidas, 20);
  cerca(b20.esperadoKg, 2.0, 1e-9); // 20 × 0,1 (los otros 8 días no suman)
  cerca(b20.esperadoKgPeriodo, 2.8, 1e-9);
  assert.notEqual(balance(conDias(14), regs, PERFIL, fin), null);
  assert.equal(balance(conDias(13), regs, PERFIL, fin), null);
  // comidas fuera del período no cuentan
  const afuera = { comidas: Array.from({ length: 20 }, (_, i) => comida(sumarDias(desde, -1 - i), "13:00", 1000)) };
  assert.equal(balance(afuera, regs, PERFIL, fin), null);
});

test("balance: realKg = caída de la media móvil en el período", () => {
  const fin = "2026-03-31";
  const desde = sumarDias(fin, -27);
  // bajando 0,1 kg/día desde 02-01: la media baja 0,1 por día también
  const regs = serie("2026-02-01", 59, (i) => 90 - 0.1 * i);
  const comidas = [];
  for (let i = 0; i < 28; i++) comidas.push(comida(sumarDias(desde, i), "13:00", 1500));
  const b = balance({ comidas }, regs, PERFIL, fin);
  // del día anterior al período (desde − 1) al último: 28 días × 0,1
  cerca(b.realKg, 2.8, 1e-9);
  assert.equal(b.realDias, 28);
  // el gasto usa el peso de cada día: los días con más peso gastan más
  const g0 = gastoDiario(PERFIL, regs.find((r) => r.fecha === desde).kg, desde);
  assert.ok(b.gastoPromedio < g0);
});

test("balance: sin perfil o sin pesos → null; sin media al principio usa el primer punto", () => {
  const fin = "2026-03-31";
  const desde = sumarDias(fin, -27);
  const comidas = [];
  for (let i = 0; i < 28; i++) comidas.push(comida(sumarDias(desde, i), "13:00", 1500));
  const regs = serie("2026-02-01", 59, () => 80);
  assert.equal(balance({ comidas }, regs, null, fin), null);
  assert.equal(balance({ comidas }, [], PERFIL, fin), null);
  // pesos solo desde la mitad del período
  const tarde = serie(sumarDias(desde, 10), 18, (i) => 85 - 0.1 * i);
  const b = balance({ comidas }, tarde, PERFIL, fin);
  assert.equal(b.realDias, 17);
  // la media va de 85 (primer punto) a la media de los últimos 7 (85 − 1,1 … 85 − 1,7) = 83,6
  cerca(b.realKg, 1.4, 1e-9);
  // un solo pesaje → realKg null
  const uno = balance({ comidas }, [{ fecha: desde, kg: 80 }], PERFIL, fin);
  assert.equal(uno.realKg, null);
  assert.equal(uno.diasConComidas, 28);
});
