"""Cuentas y formatos, y el armado de capturas a partir de piezas sueltas."""
import unittest
from datetime import date

from falso import META, PERFIL

from quecomo import almacen, calculos


class TestCalculos(unittest.TestCase):
    def test_meta(self):
        self.assertEqual(calculos.edad("1985-04-12", date(2026, 4, 11)), 40)
        self.assertEqual(calculos.edad("1985-04-12", date(2026, 4, 12)), 41)
        self.assertAlmostEqual(calculos.tmb("m", 84.3, 178, 41), 1755.5)
        self.assertAlmostEqual(calculos.tmb("f", 60, 165, 30), 600 + 1031.25 - 150 - 161)
        self.assertEqual(calculos.meta_kcal(PERFIL, 84.3, date(2026, 10, 22)), META)
        self.assertEqual(calculos.meta_kcal({**PERFIL, "meta_kcal_manual": 1800}, None, date(2026, 10, 22)), 1800)
        self.assertIsNone(calculos.meta_kcal(PERFIL, None, date(2026, 10, 22)))
        self.assertIsNone(calculos.meta_kcal(None, 80, date(2026, 10, 22)))
        self.assertIsNone(calculos.meta_kcal({**PERFIL, "actividad": "rara"}, 80, date(2026, 10, 22)))
        self.assertEqual(calculos.meta_proteina(PERFIL, 84.3), 125)
        self.assertEqual(calculos.meta_proteina({**PERFIL, "peso_objetivo_kg": None}, 80), 128)

    def test_redondeo_como_la_pagina(self):
        # calculos.js: gasto = Math.round(tmb × factor) y meta = Math.round(gasto − déficit) (los .5
        # para arriba). Valores sacados corriendo docs/js/calculos.js con node.
        hoy = date(2026, 10, 22)
        self.assertAlmostEqual(calculos.tmb("m", 84.35, 178, 41) * 1.375, 2414.5)
        self.assertEqual(calculos.gasto_diario(PERFIL, 84.35, hoy), 2415)
        self.assertEqual(calculos.meta_kcal(PERFIL, 84.35, hoy), 1915)
        self.assertEqual(calculos.meta_kcal(PERFIL, 84.25, hoy), 1913)
        self.assertEqual(calculos.meta_kcal(PERFIL, 80, hoy), 1855)
        self.assertEqual(calculos.meta_kcal({**PERFIL, "meta_kcal_manual": 1800.5}, None, hoy), 1801)
        sin_obj = {**PERFIL, "peso_objetivo_kg": None, "proteina_g_kg": 1.5}
        self.assertEqual(calculos.meta_proteina(sin_obj, 83), 125)   # 124,5
        self.assertEqual(calculos.meta_proteina(sin_obj, 81), 122)   # 121,5

    def test_promedio_semana_redondea_como_la_pagina(self):
        reg = {"comidas": [{"fecha": "2026-10-19", "kcal": 1500}, {"fecha": "2026-10-20", "kcal": 1601}]}
        self.assertEqual(calculos.resumen_semana(reg, date(2026, 10, 19))["promedioKcal"], 1551)

    def test_peso_actual(self):
        regs = [{"fecha": "2026-10-20", "kg": 85}, {"fecha": "2026-10-22", "kg": 84.3},
                {"fecha": "2026-10-25", "kg": 80}, {"fecha": "mal", "kg": 1}]
        self.assertEqual(calculos.peso_actual(regs, date(2026, 10, 23)), 84.3)
        self.assertIsNone(calculos.peso_actual(regs, date(2026, 10, 1)))

    def test_formatos(self):
        self.assertEqual(calculos.num(1850), "1.850")
        self.assertEqual(calculos.num(82.4, 1), "82,4")
        self.assertEqual(calculos.num(1234567.891, 2), "1.234.567,89")
        self.assertEqual(calculos.formato_fecha("2026-10-22"), "jue 22/10")
        self.assertEqual(calculos.formato_fecha("2026-10-25"), "dom 25/10")
        self.assertEqual(calculos.normalizar("Puré de PAPÁS"), "pure de papas")
        self.assertEqual(calculos.frase_meta(1500, 1914), "te quedan 414 kcal")
        self.assertEqual(calculos.frase_meta(2000, 1914), "86 kcal arriba de la meta")


class TestCapturas(unittest.TestCase):
    def test_fecha_hora(self):
        self.assertEqual(almacen.fecha_hora("2026-10-22T13:40:12-03:00"), ("2026-10-22", "13:40"))
        self.assertEqual(almacen.fecha_hora("2026-10-23T01:30:00Z"), ("2026-10-22", "22:30"))
        self.assertEqual(almacen.fecha_hora(None, "g-20261022-134012-a3f9"), ("2026-10-22", "13:40"))
        self.assertEqual(almacen.fecha_hora("basura", "otro"), (None, None))

    def test_orden_de_piezas_como_la_pagina(self):
        nombres = ["2026-10-22_13-40-12_a3f9_10.jpg", "2026-10-22_13-40-12_a3f9_2.jpg",
                   "2026-10-22_13-40-12_a3f9.jpg", "2026-10-22_13-40-12_a3f9_3.txt"]
        self.assertEqual(sorted(nombres, key=almacen.orden_nombre),
                         ["2026-10-22_13-40-12_a3f9.jpg", "2026-10-22_13-40-12_a3f9_2.jpg",
                          "2026-10-22_13-40-12_a3f9_3.txt", "2026-10-22_13-40-12_a3f9_10.jpg"])

    def test_agrupar(self):
        def pieza(i, nombre, grupo, tomada, tipo="foto", nota=None):
            p = {"id": i, "name": nombre, "appProperties": {"quecomo": tipo, "grupo": grupo, "tomada": tomada}}
            if nota is not None:
                p["description"] = nota
            return p
        caps = almacen.agrupar([
            pieza("b", "2.jpg", "g-2", "2026-10-22T20:00:00-03:00"),
            pieza("a", "1.jpg", "g-2", "2026-10-22T19:59:00-03:00", nota="con queso"),
            pieza("t", "t.txt", "g-1", "2026-10-22T08:00:00-03:00", tipo="texto", nota="mate cocido"),
            {"id": "huerfana", "name": "x.jpg", "appProperties": {"quecomo": "foto"}},
        ])
        self.assertEqual([c["grupo"] for c in caps], ["g-1", "g-2", "sin-grupo-huerfana"])
        self.assertEqual([p["id"] for p in caps[1]["fotos"]], ["a", "b"])
        self.assertEqual(caps[1]["tomada"], "2026-10-22T19:59:00-03:00")
        self.assertEqual(caps[1]["nota"], "con queso")
        self.assertEqual([p["id"] for p in caps[0]["textos"]], ["t"])


if __name__ == "__main__":
    unittest.main()
