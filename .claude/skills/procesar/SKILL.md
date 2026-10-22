---
name: procesar
description: Procesa las fotos y textos de comida pendientes de Qué como (las baja del Drive, estima calorías y macros, y las anota en el registro). Usar cuando Pablo, en esta carpeta, dice "procesá", "procesar", "procesá las comidas", "fijate las fotos", "qué comí hoy", "cuánto llevo hoy" o algo parecido.
---

# Procesar las comidas de Qué como

Todo se hace con `python qc.py` desde la carpeta del proyecto. Hablale a Pablo en español
rioplatense, corto. Describí, no opines: nada de "¡vas genial!" ni "cuidado".

Si Pablo solo pregunta qué comió o cuánto lleva, alcanza con `python qc.py resumen` (o
`python qc.py resumen AAAA-MM-DD`); igual mirá si hay pendientes y ofrecé procesarlos.

## 1. Ver qué hay

Corré `python qc.py pendientes`.

- Si dice que **se venció el permiso** o que **el Drive no está conectado**: corré
  `python qc.py auth` con un timeout largo (5 minutos), avisale a Pablo que acepte el permiso en
  la ventana del navegador que se abre, y cuando termine volvé a correr `pendientes`.
- Otro error (sin internet, Drive con problemas): decíselo tal cual y pará.
- **Nada pendiente:** decilo en una línea y mostrá `python qc.py resumen`.

La salida lista cada captura (día, hora, grupo, nota, texto, rutas de las fotos) y las comidas
**a revisar** con el pedido de Pablo. El detalle completo queda en `data/pendientes.json`.

## 2. Mirar cada captura

- **Abrí cada foto con Read** (las rutas que imprimió `pendientes`). Todas las fotos de un grupo
  son la misma comida (otro ángulo, el postre, la bebida): una sola comida por grupo.
- **La nota manda** sobre lo que parece la foto ("era light", "comí la mitad", "puré de caja").
  Un texto sin foto es la descripción completa.
- **Revisiones:** el `pedido` corrige la estimación anterior ("no era arroz, era quinoa"). Volvé a
  estimar la comida entera aplicando el pedido; la estimación anterior está en `comida`.
- **Foto nueva para una comida ya registrada** (la captura trae `comida`): estimá la comida entera
  con todas sus fotos (las viejas y la nueva); la estimación anterior está en `comida` como
  referencia (si dice "corregida a mano", respetá esos números para lo que ya estaba).
- Para ser parejo con lo que ya estimaste antes, corré `python qc.py platos <alimento>` (por
  ejemplo `platos milanesa`) y usá porciones y valores parecidos para el mismo plato. Si una comida
  dice "corregida a mano", esos números son de Pablo: tomalos como referencia.
- Una foto que **no es comida**, o que es claramente un duplicado de otra captura: no inventes.
  No la incluyas en las estimaciones (queda pendiente) y contáselo a Pablo para que la descarte
  en la página.

## 3. Estimar

- Un **item por alimento** (milanesa, puré, pan, gaseosa…), cada uno con `nombre`, `porcion` en
  medida casera con gramos aproximados ("1 grande (~180 g)", "1 taza (~200 g)", "2 cdas (~20 g)")
  y `kcal`, `proteina_g`, `carbos_g`, `grasa_g` como enteros ≥ 0.
- Valores típicos argentinos: pan francés (~60 g, ~160 kcal), milanesa, empanada, facturas, mate
  cocido, alfajor, porciones de restaurante o casa de comidas.
- **Aceite, manteca, mayonesa, aderezos y salsas visibles van como items aparte.** Frituras
  cuentan el aceite absorbido.
- **Las bebidas también** (gaseosa, jugo, cerveza, vino, café con leche). Agua y mate amargo: 0.
- Lo que no se ve (cuánto aceite, si el café tiene azúcar, el tamaño real) va en `comentario`
  y baja la `confianza`. `alta` = todo claro; `media` = alguna duda razonable; `baja` = poco visible
  o muy incierto.
- **Ante la duda, redondeá hacia arriba**: subestimar es el error típico.
- `tipo` según la hora y el contenido: `desayuno` · `almuerzo` · `merienda` · `cena` · `colacion`
  (algo entre comidas) · `bebida` (solo una bebida).
- `titulo`: corto y concreto ("Milanesa con puré", "Café con leche y 2 medialunas").

## 4. Anotar

Escribí `data/estimaciones.json` con todas las capturas y revisiones que estimaste:

```json
{"comidas": [
  {"grupo": "g-20261022-134012-a3f9", "tipo": "almuerzo", "titulo": "Milanesa con puré",
   "items": [
     {"nombre": "Milanesa de carne frita", "porcion": "1 grande (~180 g)",
      "kcal": 420, "proteina_g": 30, "carbos_g": 20, "grasa_g": 24},
     {"nombre": "Puré de papas instantáneo", "porcion": "1 taza (~200 g)",
      "kcal": 180, "proteina_g": 4, "carbos_g": 28, "grasa_g": 6}
   ],
   "confianza": "media", "comentario": "La milanesa parece frita; al horno serían ~120 kcal menos."}
]}
```

`grupo` es el de la captura, o el `id` de la comida a revisar. No pongas totales, fecha, hora,
fotos ni nota: `registrar` los completa.

Corré `python qc.py registrar data/estimaciones.json`. Si lista problemas, no anotó nada:
corregí el archivo y volvé a correrlo. Si dice que llegaron piezas nuevas, corré `pendientes` de
nuevo y mirá esa captura otra vez.

## 5. Contarle a Pablo

Corré `python qc.py resumen` (y el día de las comidas procesadas, si no es hoy). Respondé corto:

- Una línea por comida: hora, título, kcal, confianza (y el comentario solo si es una duda que
  Pablo puede aclarar).
- El total del día contra la meta ("1.640 de 1.914 kcal, te quedan 274").
- Lo que salteaste (fotos que no eran comida, duplicados) y por qué.

Números con punto de miles y coma decimal (1.850 kcal, 82,4 kg).
