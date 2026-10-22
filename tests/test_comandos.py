"""pendientes, registrar, platos y resumen contra el Drive falso."""
import json
import unittest
from datetime import date

from falso import BaseQC, META

from quecomo import comandos, config
from quecomo.errores import ErrorValidacion

G1 = "g-20261022-134012-a3f9"
G2 = "g-20261022-171500-b2c4"
G3 = "g-20261021-210000-zz99"   # ya procesada, con pedido de revisión


def item(nombre, kcal, p=1, c=2, g=3, porcion="1 porción (~100 g)"):
    return {"nombre": nombre, "porcion": porcion, "kcal": kcal, "proteina_g": p, "carbos_g": c, "grasa_g": g}


class Escenario(BaseQC):
    def armar(self, con_revision=True):
        self.id_raiz = self.raiz()
        self.perfil_y_peso()
        # Captura 1: dos fotos (los nombres definen el orden) y una nota.
        self.f2 = self.foto("2026-10-22_13-41-00_bbbb.jpg", G1, "2026-10-22T13:41:00-03:00", "puré de caja")
        self.f1 = self.foto("2026-10-22_13-40-12_a3f9.jpg", G1, "2026-10-22T13:40:12-03:00", "puré de caja")
        # Captura 2: un texto suelto.
        self.t1 = self.texto("2026-10-22_17-15-00_b2c4.txt", G2, "2026-10-22T17:15:00-03:00",
                             "2 alfajores, no saqué foto")
        # Algo que no debe aparecer: procesada, descartada y en la papelera.
        self.foto("viejo.jpg", "g-20261020-120000-aaaa", "2026-10-20T12:00:00-03:00", estado="procesada")
        self.foto("descartada.jpg", "g-20261022-100000-dddd", "2026-10-22T10:00:00-03:00", estado="descartada")
        self.drive.agregar("borrada.jpg", {"quecomo": "foto", "grupo": "g-x", "estado": "pendiente"}, trashed=True)
        comidas = []
        if con_revision:
            self.f3 = self.foto("2026-10-21_21-00-00_zz99.jpg", G3, "2026-10-21T21:00:00-03:00", "con arroz",
                                estado="procesada")
            comidas.append({
                "id": G3, "fecha": "2026-10-21", "hora": "21:00", "tipo": "cena", "titulo": "Pollo con arroz",
                "fotos": [self.f3], "nota": "con arroz", "items": [item("Arroz blanco", 300), item("Pollo", 250)],
                "kcal": 550, "proteina_g": 2, "carbos_g": 4, "grasa_g": 6, "confianza": "media",
                "comentario": "", "procesada": "2026-10-21T22:00:00-03:00", "editada": True,
                "revisar": {"pedido": "no era arroz, era quinoa", "fecha": "2026-10-22T09:12:00-03:00"},
                "campo_raro": "se conserva",
            })
        comidas.append({
            "id": "g-20261020-120000-aaaa", "fecha": "2026-10-20", "hora": "12:00", "tipo": "almuerzo",
            "titulo": "Milanesa con puré", "fotos": [], "nota": "", "editada": False, "revisar": None,
            "items": [item("Milanesa de carne frita", 420, 30, 20, 24, "1 grande (~180 g)"),
                      item("Puré de papas", 180, 4, 28, 6, "1 taza (~200 g)")],
            "kcal": 600, "proteina_g": 34, "carbos_g": 48, "grasa_g": 30, "confianza": "media",
        })
        self.drive.agregar_json("registro", {"version": 1, "actualizado": "x", "comidas": comidas,
                                             "otro_campo": 7})

    def estimaciones(self, comidas):
        ruta = self.tmp / "estimaciones.json"
        ruta.write_text(json.dumps({"comidas": comidas}, ensure_ascii=False), encoding="utf-8")
        return ruta


class TestPendientes(Escenario):
    def test_baja_y_describe(self):
        self.armar()
        datos, salida = self.correr(comandos.pendientes, self.alm)

        self.assertEqual([c["grupo"] for c in datos["capturas"]], [G1, G2])
        c1 = datos["capturas"][0]
        self.assertEqual(c1["tomada"], "2026-10-22T13:40:12-03:00")
        self.assertEqual(c1["nota"], "puré de caja")
        self.assertEqual(c1["ids"], [self.f1, self.f2])
        carpeta = config.pendientes_dir() / G1
        self.assertEqual(c1["archivos"], [str(carpeta / "1.jpg"), str(carpeta / "2.jpg")])
        self.assertEqual((carpeta / "1.jpg").read_bytes(), b"JPEG 2026-10-22_13-40-12_a3f9.jpg")
        self.assertEqual((config.pendientes_dir() / G2 / "texto.txt").read_text(encoding="utf-8"),
                         "2 alfajores, no saqué foto")

        self.assertEqual(len(datos["revisar"]), 1)
        r = datos["revisar"][0]
        self.assertEqual(r["id"], G3)
        self.assertEqual(r["pedido"], "no era arroz, era quinoa")
        self.assertEqual(r["comida"]["titulo"], "Pollo con arroz")
        self.assertEqual(r["archivos"], [str(config.pendientes_dir() / f"revisar-{G3}" / "1.jpg")])

        self.assertEqual(datos["meta_kcal"], META)
        self.assertEqual(datos["perfil"]["altura_cm"], 178)
        en_disco = json.loads(config.pendientes_json().read_text(encoding="utf-8"))
        self.assertEqual(set(en_disco), {"generado", "capturas", "revisar", "perfil", "meta_kcal"})
        self.assertEqual(en_disco["generado"], "2026-10-22T21:00:00-03:00")

        self.assertIn("2 capturas pendientes (jue 22/10: 2)", salida)
        self.assertIn("jue 22/10 13:40", salida)
        self.assertIn("Nota: puré de caja", salida)
        self.assertIn("Texto: 2 alfajores, no saqué foto", salida)
        self.assertIn("Pedido: no era arroz, era quinoa", salida)
        self.assertIn(str(carpeta / "1.jpg"), salida)
        self.assertIn("Meta del día: 1.914 kcal", salida)

    def test_no_vuelve_a_bajar_y_limpia_lo_viejo(self):
        self.armar()
        vieja = config.pendientes_dir() / "g-20261001-000000-viej"
        vieja.mkdir(parents=True)
        (vieja / "1.jpg").write_bytes(b"x")
        self.correr(comandos.pendientes, self.alm)
        self.assertFalse(vieja.exists())
        fotos = {self.f1, self.f2, self.f3, self.t1}
        self.assertEqual(fotos - set(self.drive.bajadas), set())
        self.drive.bajadas.clear()
        self.correr(comandos.pendientes, self.alm)
        self.assertEqual(fotos & set(self.drive.bajadas), set())   # solo se volvieron a leer los JSON

    def test_nada_pendiente(self):
        datos, salida = self.correr(comandos.pendientes, self.alm)
        self.assertEqual(datos["capturas"], [])
        self.assertIsNone(datos["perfil"])
        self.assertIsNone(datos["meta_kcal"])
        self.assertIn("No hay nada pendiente", salida)
        self.assertEqual(self.drive.creados, [])   # leer no crea nada en el Drive


class TestRegistrar(Escenario):
    def bien(self):
        return [
            {"grupo": G1, "tipo": "almuerzo", "titulo": "Milanesa con puré", "confianza": "media",
             "comentario": "Parece frita.",
             "items": [item("Milanesa", 420.4, 30, 20, 24), item("Puré", 179.6, 4.2, 28, 6)]},
            {"grupo": G2, "tipo": "merienda", "titulo": "Dos alfajores", "confianza": "alta",
             "items": [item("Alfajor de chocolate", 500, 6, 70, 22, "2 unidades (~100 g)")]},
            {"grupo": G3, "tipo": "cena", "titulo": "Pollo con quinoa", "confianza": "media", "comentario": "",
             "items": [item("Quinoa", 220), item("Pollo", 250)]},
        ]

    def test_anota_marca_y_limpia(self):
        self.armar()
        self.correr(comandos.pendientes, self.alm)
        _, salida = self.correr(comandos.registrar, self.alm, self.estimaciones(self.bien()))

        reg = self.drive.json_de("registro")
        self.assertEqual(reg["otro_campo"], 7)
        self.assertEqual(reg["actualizado"], "2026-10-22T21:00:00-03:00")
        ids = [c["id"] for c in reg["comidas"]]
        self.assertEqual(ids, ["g-20261020-120000-aaaa", G3, G1, G2])   # por fecha y hora
        c1 = reg["comidas"][2]
        self.assertEqual((c1["fecha"], c1["hora"]), ("2026-10-22", "13:40"))
        self.assertEqual(c1["fotos"], [self.f1, self.f2])
        self.assertEqual(c1["nota"], "puré de caja")
        self.assertEqual([i["kcal"] for i in c1["items"]], [420, 180])
        self.assertEqual((c1["kcal"], c1["proteina_g"], c1["carbos_g"], c1["grasa_g"]), (600, 34, 48, 30))
        self.assertEqual(c1["procesada"], "2026-10-22T21:00:00-03:00")
        self.assertEqual((c1["editada"], c1["revisar"], c1["confianza"]), (False, None, "media"))
        c2 = reg["comidas"][3]
        self.assertEqual(c2["fotos"], [])
        self.assertEqual(c2["nota"], "2 alfajores, no saqué foto")
        self.assertEqual(c2["comentario"], "")

        rev = reg["comidas"][1]
        self.assertEqual(rev["titulo"], "Pollo con quinoa")
        self.assertEqual((rev["revisar"], rev["editada"]), (None, False))
        self.assertEqual(rev["campo_raro"], "se conserva")
        self.assertEqual((rev["fecha"], rev["hora"], rev["fotos"]), ("2026-10-21", "21:00", [self.f3]))
        self.assertEqual(rev["kcal"], 470)

        for pid in (self.f1, self.f2, self.t1, self.f3):
            self.assertEqual(self.drive.archivos[pid]["appProperties"]["estado"], "procesada")
        self.assertNotIn(self.f3, [a[0] for a in self.drive.actualizaciones])   # ya estaba procesada

        self.assertFalse((config.pendientes_dir() / G1).exists())
        self.assertFalse((config.pendientes_dir() / f"revisar-{G3}").exists())
        resto = json.loads(config.pendientes_json().read_text(encoding="utf-8"))
        self.assertEqual((resto["capturas"], resto["revisar"]), ([], []))

        self.assertIn("Anoté 3 comidas", salida)
        self.assertIn("jue 22/10 13:40 · Milanesa con puré · 600 kcal (confianza media)", salida)
        self.assertIn("jue 22/10: 1.100 de 1.914 kcal · te quedan 814 kcal.", salida)

    def test_crea_carpeta_y_registro_si_faltan(self):
        self.foto("a.jpg", G1, "2026-10-22T13:40:12-03:00")
        self.correr(comandos.registrar, self.alm, self.estimaciones(self.bien()[:1]))
        raiz = self.drive.buscar({"quecomo": "raiz"})
        self.assertEqual(len(raiz), 1)
        self.assertEqual(raiz[0]["name"], "Qué como")
        reg = self.drive.buscar({"quecomo": "registro"})
        self.assertEqual(reg[0]["parents"], [raiz[0]["id"]])
        self.assertEqual(reg[0]["name"], "registro.json")
        self.assertEqual(len(self.drive.json_de("registro")["comidas"]), 1)

    def test_errores_no_escriben_nada(self):
        self.armar()
        malas = self.bien()
        malas[0]["tipo"] = "brunch"
        malas[0]["items"][0]["kcal"] = -5
        malas[0]["items"][1]["proteina_g"] = "4"
        malas[1]["items"] = []
        malas[1]["confianza"] = "altísima"
        malas[2]["titulo"] = " "
        malas.append({"grupo": "g-20990101-000000-nada", "tipo": "cena", "titulo": "x", "confianza": "baja",
                      "items": [item("x", 1)]})
        malas.append({"grupo": "g-20261020-120000-aaaa", "tipo": "cena", "titulo": "x", "confianza": "baja",
                      "items": [item("x", 1)]})
        antes = self.drive.json_de("registro")
        with self.assertRaises(ErrorValidacion) as cm:
            self.correr(comandos.registrar, self.alm, self.estimaciones(malas))
        texto = str(cm.exception)
        for esperado in ("«tipo» tiene que ser uno de", "«kcal» no puede ser negativo",
                         "«proteina_g» tiene que ser un número", "«items» tiene que ser una lista",
                         "«confianza» tiene que ser alta, media o baja", "falta «titulo»",
                         "g-20990101-000000-nada: no hay ninguna captura pendiente",
                         "ya está en el registro y no tiene pedido de revisión"):
            self.assertIn(esperado, texto)
        self.assertEqual(len(cm.exception.problemas), 8)
        self.assertEqual(self.drive.json_de("registro"), antes)
        self.assertEqual(self.drive.actualizaciones, [])

    def test_archivo_roto(self):
        ruta = self.tmp / "roto.json"
        ruta.write_text("{no es json", encoding="utf-8")
        from quecomo.errores import ErrorLocal
        with self.assertRaises(ErrorLocal):
            comandos.registrar(self.alm, ruta)
        with self.assertRaises(ErrorLocal):
            comandos.registrar(self.alm, self.tmp / "no-existe.json")

    def test_pieza_nueva_despues_de_pendientes(self):
        self.armar()
        self.correr(comandos.pendientes, self.alm)
        self.foto("2026-10-22_13-45-00_cccc.jpg", G1, "2026-10-22T13:45:00-03:00", "puré de caja")
        with self.assertRaises(ErrorValidacion) as cm:
            self.correr(comandos.registrar, self.alm, self.estimaciones(self.bien()[:1]))
        self.assertIn("llegaron piezas nuevas", str(cm.exception))

    def test_falla_al_marcar_avisa(self):
        self.armar()
        from quecomo.errores import ErrorDrive
        self.drive.falla_actualizar = ErrorDrive("Drive está con problemas (error 503).")
        _, salida = self.correr(comandos.registrar, self.alm, self.estimaciones(self.bien()[:1]))
        self.assertIn("no pude marcar 2 pieza(s)", salida)
        self.assertEqual(len(self.drive.json_de("registro")["comidas"]), 3)
        # Registrar de nuevo reemplaza, no duplica.
        self.drive.falla_actualizar = None
        self.correr(comandos.registrar, self.alm, self.estimaciones(self.bien()[:1]))
        self.assertEqual([c["id"] for c in self.drive.json_de("registro")["comidas"]].count(G1), 1)


class TestFotoQueLlegaTarde(Escenario):
    """El "+" de una comida quedó en la cola del celu: Claude ya procesó la primera foto y después
    sube la segunda (mismo grupo, pendiente). No se tiene que perder la comida registrada."""

    def armar(self, revisar=None):
        self.raiz()
        self.perfil_y_peso()
        self.vieja = self.foto("2026-10-22_13-40-12_a3f9.jpg", G1, "2026-10-22T13:40:12-03:00", "puré de caja",
                               estado="procesada")
        self.drive.agregar_json("registro", {"version": 1, "comidas": [{
            "id": G1, "fecha": "2026-10-22", "hora": "13:40", "tipo": "almuerzo", "titulo": "Milanesa con puré",
            "fotos": [self.vieja], "nota": "puré de caja",
            "items": [item("Milanesa", 450, 32, 20, 26), item("Puré", 180, 4, 28, 6)],
            "kcal": 630, "proteina_g": 36, "carbos_g": 48, "grasa_g": 32, "confianza": "media",
            "comentario": "", "procesada": "2026-10-22T14:00:00-03:00", "editada": True, "revisar": revisar,
            "campo_raro": "se conserva"}]})
        # La segunda foto llega tarde, con hora posterior.
        self.nueva = self.foto("2026-10-22_13-40-12_a3f9_2.jpg", G1, "2026-10-22T13:55:00-03:00", "puré de caja")

    def estimacion(self):
        return [{"grupo": G1, "tipo": "almuerzo", "titulo": "Milanesa con puré y flan", "confianza": "media",
                 "items": [item("Milanesa", 450, 32, 20, 26), item("Puré", 180, 4, 28, 6),
                           item("Flan con dulce de leche", 300, 6, 45, 10)]}]

    def test_pendientes_muestra_la_comida_entera(self):
        self.armar()
        datos, salida = self.correr(comandos.pendientes, self.alm)
        self.assertEqual(datos["revisar"], [])
        self.assertEqual(len(datos["capturas"]), 1)
        c = datos["capturas"][0]
        self.assertTrue(c.get("agregada"))
        self.assertEqual(c["comida"]["titulo"], "Milanesa con puré")
        self.assertEqual(c["comida"]["kcal"], 630)
        self.assertEqual(c["nuevas"], [self.nueva])
        self.assertEqual(c["ids"], [self.vieja, self.nueva])
        self.assertEqual(c["tomada"], "2026-10-22T13:40:12-03:00")
        carpeta = config.pendientes_dir() / G1
        self.assertEqual(c["archivos"], [str(carpeta / "1.jpg"), str(carpeta / "2.jpg")])
        self.assertEqual((carpeta / "1.jpg").read_bytes(), b"JPEG 2026-10-22_13-40-12_a3f9.jpg")
        self.assertEqual((carpeta / "2.jpg").read_bytes(), b"JPEG 2026-10-22_13-40-12_a3f9_2.jpg")
        self.assertNotIn("pedido", c)
        self.assertIn("foto nueva para una comida ya registrada (13:40 Milanesa con puré)", salida)
        self.assertIn("Estimación anterior: Milanesa con puré · 630 kcal", salida)
        self.assertIn("(corregida a mano)", salida)
        en_disco = json.loads(config.pendientes_json().read_text(encoding="utf-8"))
        self.assertEqual(en_disco["capturas"][0]["comida"]["id"], G1)

    def test_registrar_reemplaza_la_comida_entera(self):
        self.armar()
        self.correr(comandos.pendientes, self.alm)
        self.correr(comandos.registrar, self.alm, self.estimaciones(self.estimacion()))

        comidas = self.drive.json_de("registro")["comidas"]
        self.assertEqual([x["id"] for x in comidas], [G1])
        c = comidas[0]
        self.assertEqual(c["fotos"], [self.vieja, self.nueva])               # no solo la nueva
        self.assertEqual((c["fecha"], c["hora"]), ("2026-10-22", "13:40"))   # no la hora de la foto nueva
        self.assertEqual(c["nota"], "puré de caja")
        self.assertEqual(c["titulo"], "Milanesa con puré y flan")
        self.assertEqual([i["nombre"] for i in c["items"]], ["Milanesa", "Puré", "Flan con dulce de leche"])
        self.assertEqual((c["kcal"], c["proteina_g"], c["carbos_g"], c["grasa_g"]), (930, 42, 93, 42))
        self.assertEqual((c["editada"], c["revisar"]), (False, None))
        self.assertEqual(c["procesada"], "2026-10-22T21:00:00-03:00")
        self.assertEqual(c["campo_raro"], "se conserva")
        self.assertEqual(self.drive.archivos[self.nueva]["appProperties"]["estado"], "procesada")
        self.assertNotIn(self.vieja, [a[0] for a in self.drive.actualizaciones])   # ya estaba procesada
        self.assertFalse((config.pendientes_dir() / G1).exists())

    def test_sin_correr_pendientes_tampoco_pisa(self):
        self.armar()
        self.correr(comandos.registrar, self.alm, self.estimaciones(self.estimacion()))
        c = self.drive.json_de("registro")["comidas"][0]
        self.assertEqual((c["fotos"], c["hora"]), ([self.vieja, self.nueva], "13:40"))

    def test_con_pedido_de_revision(self):
        self.armar(revisar={"pedido": "era flan, no budín", "fecha": "2026-10-22T15:00:00-03:00"})
        datos, salida = self.correr(comandos.pendientes, self.alm)
        self.assertEqual(datos["revisar"], [])
        c = datos["capturas"][0]
        self.assertEqual((c.get("agregada"), c.get("pedido")), (True, "era flan, no budín"))
        self.assertEqual(c["ids"], [self.vieja, self.nueva])
        self.assertIn("Pedido de revisión: era flan, no budín", salida)
        self.correr(comandos.registrar, self.alm, self.estimaciones(self.estimacion()))
        c = self.drive.json_de("registro")["comidas"][0]
        self.assertEqual((c["fotos"], c["hora"], c["revisar"]), ([self.vieja, self.nueva], "13:40", None))

    def test_descartada_no_entra(self):
        self.armar()
        self.foto("2026-10-22_13-40-12_a3f9_3.jpg", G1, "2026-10-22T13:56:00-03:00", estado="descartada")
        datos, _ = self.correr(comandos.pendientes, self.alm)
        self.assertEqual(datos["capturas"][0]["ids"], [self.vieja, self.nueva])
        self.correr(comandos.registrar, self.alm, self.estimaciones(self.estimacion()))
        self.assertEqual(self.drive.json_de("registro")["comidas"][0]["fotos"], [self.vieja, self.nueva])


class TestPlatos(Escenario):
    def test_busca_sin_tildes(self):
        self.armar()
        filas, salida = self.correr(comandos.platos, self.alm, "PURE")
        self.assertEqual([it["nombre"] for _, it in filas], ["Milanesa de carne frita", "Puré de papas"])
        self.assertIn("Puré de papas · 1 taza (~200 g) · 180 kcal · P 4 · C 28 · G 6", salida)
        filas, _ = self.correr(comandos.platos, self.alm, "papas pure")
        self.assertEqual([it["nombre"] for _, it in filas], ["Puré de papas"])   # todas las palabras
        filas, salida = self.correr(comandos.platos, self.alm, "sushi")
        self.assertEqual(filas, [])
        self.assertIn("No encontré nada parecido a «sushi»", salida)

    def test_recientes_distintos(self):
        self.armar()
        filas, salida = self.correr(comandos.platos, self.alm, "")
        nombres = [it["nombre"] for _, it in filas]
        self.assertEqual(nombres[:2], ["Arroz blanco", "Pollo"])   # lo más nuevo primero
        self.assertEqual(len(nombres), len(set(nombres)))
        self.assertIn("corregida a mano", salida)


class TestResumen(Escenario):
    def test_dia_y_semana(self):
        self.armar()
        self.correr(comandos.registrar, self.alm, self.estimaciones(TestRegistrar.bien(self)[:2]))
        res, salida = self.correr(comandos.resumen, self.alm, date(2026, 10, 22))
        self.assertEqual(res["dia"]["kcal"], 1100)
        self.assertEqual(res["meta_kcal"], META)
        self.assertIn("jue 22/10/2026", salida)
        self.assertIn("13:40  almuerzo  Milanesa con puré · 600 kcal", salida)
        self.assertIn("Meta: 1.914 kcal · te quedan 814 kcal · proteína 40 de 125 g", salida)
        self.assertIn("Semana del lun 19/10 al dom 25/10", salida)
        self.assertIn("mar 20/10      600 kcal", salida)
        self.assertIn("Promedio: 750 kcal por día (3 días con comidas)", salida)

    def test_sin_perfil_ni_comidas(self):
        res, salida = self.correr(comandos.resumen, self.alm, None)
        self.assertIsNone(res["meta_kcal"])
        self.assertIn("jue 22/10/2026", salida)
        self.assertIn("Sin comidas registradas.", salida)
        self.assertIn("Sin perfil cargado", salida)

    def test_pendientes_del_dia(self):
        self.armar()
        _, salida = self.correr(comandos.resumen, self.alm, date(2026, 10, 22))
        self.assertIn("Pendientes de procesar ese día: 2 capturas.", salida)


if __name__ == "__main__":
    unittest.main()
