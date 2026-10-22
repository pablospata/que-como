# Qué como — contrato de diseño

Contrato compartido por todos los que construyen esta app. Si algo no está acá, se decide en el
archivo propio y se anota al final, en "Decisiones de los constructores".

## Qué es

Un registro de comidas para bajar de peso, sin anotar a mano. Pablo saca una foto de lo que va a
comer y listo. Después, en la compu, le dice a Claude (Claude Code, en esta carpeta) **"procesá"**:
Claude mira las fotos pendientes, estima calorías y macros, y las anota en el registro. La página
muestra el día, la semana, el peso y el perfil.

- **Dos usos, una sola página.** En el celu es casi solo una cámara: un ícono de foto y listo.
  En la compu es el panel para mirar y corregir. Es la misma web app (PWA instalable), publicada
  en GitHub Pages: `https://pablospata.github.io/que-como/`.
- **Los datos viven en el Drive de Pablo**, en la carpeta `Qué como`. La página no tiene servidor:
  habla directo con la API de Drive desde el navegador.
- **El que estima es Claude, acá.** La página nunca llama a ninguna IA. Lo que está pendiente se
  procesa con `qc.py` y la skill `procesar` (ver más abajo).
- **Todo en español.** Pablo no lee inglés: ningún texto visible en inglés (botones, títulos,
  meses, días, tooltips, errores, `aria-label`). Fechas en formato argentino (mié 22/10,
  octubre de 2026). Números con coma decimal (`82,4 kg`) y punto de miles (`1.850 kcal`).
- **Sin dependencias.** HTML/CSS/JS sin frameworks, sin build y sin CDN. La única excepción es
  el script de Google para el login (`https://accounts.google.com/gsi/client`). Módulos ES
  (`<script type="module">`). Python 3 solo con biblioteca estándar (sin pip); tiene que andar en
  Windows (Python 3.14) y en Linux.
- **Rutas relativas.** La página se sirve en un subcamino (`/que-como/`): nunca rutas que
  empiecen con `/`.
- **Describe, no opina.** Muestra números y estimaciones. Sin frases motivacionales ni juicios
  ("¡vas genial!", "cuidado"). Un dato como "te quedan 420 kcal" está bien.
- **No se borra nada del Drive.** Descartar o borrar en la página marca, no elimina archivos.

## Estructura de archivos

```
que-como/
├── CONTRATO.md                este archivo
├── README.md                  para Pablo: cómo se usa, cómo conectar, cómo procesar (español llano)
├── .gitignore                 data/, __pycache__/
├── docs/                      LA PÁGINA (GitHub Pages sirve esta carpeta)
│   ├── index.html             [base]   shell: cabecera, pestañas, <main id="vista">
│   ├── manifest.webmanifest   [captura]
│   ├── sw.js                  [captura] service worker (caché del shell, nunca de la API)
│   ├── config.js              [base]   CLIENT_ID de Google y constantes
│   ├── icons/                 [captura] icon.svg, icon-192.png, icon-512.png, maskable-512.png
│   ├── css/base.css           [base]   tokens, tipografía, componentes comunes
│   ├── css/captura.css        [captura]
│   ├── css/panel.css          [panel]  hoy, semana, tarjetas de comida, pendientes
│   ├── css/cuerpo.css         [cuerpo] peso y perfil
│   └── js/
│       ├── app.js             [base]   arranque, rutas (#/...), login, insignia de pendientes
│       ├── util.js            [base]   fechas, formato, el(), toast()
│       ├── datos.js           [base]   elige la implementación: drive.js o demo.js
│       ├── demo.js            [base]   implementación en localStorage con datos de ejemplo
│       ├── drive.js           [drive]  implementación real: login de Google + API de Drive
│       ├── imagen.js          [captura] compresión y fecha EXIF
│       ├── cola.js            [captura] cola de subidas en IndexedDB (sin señal / sin login)
│       ├── calculos.js        [cuerpo] funciones puras: gasto, meta, medias, resúmenes
│       └── vistas/
│           ├── captura.js     [captura]
│           ├── hoy.js         [panel]
│           ├── semana.js      [panel]
│           ├── comida.js      [panel]  tarjeta de comida y de pendiente, edición
│           ├── peso.js        [cuerpo]
│           └── perfil.js      [cuerpo]
├── tests-js/                  pruebas: `node --test` desde la raíz (sin dependencias)
├── qc.py                      [proceso] línea de comandos para procesar
├── quecomo/                   [proceso] paquete Python (drive.py, registro.py, ...)
├── tests/                     [proceso] `python -m unittest discover -s tests`
├── .claude/skills/procesar/SKILL.md   [proceso] la receta que sigue Claude al procesar
└── data/                      local, fuera de git: fotos bajadas, estimaciones
```

Entre corchetes, quién es el dueño de cada archivo. Nadie edita archivos de otro: si hace falta un
cambio en uno ajeno, se anota en "Decisiones de los constructores" con el pedido.

## Google: proyecto, permisos y login

- Proyecto de Google Cloud: **`cerebro-tasks`**, el mismo de Tasks y de Loop web, en modo Prueba
  con Pablo como usuario de prueba.
- Permiso: **solo `https://www.googleapis.com/auth/drive.file`**. La app ve únicamente los
  archivos que crea ella, no el resto del Drive. Ese permiso es por proyecto: lo que sube la
  página (cliente "Aplicación web") lo puede leer y modificar `qc.py` (cliente "App de escritorio"
  del mismo proyecto), y al revés.
- **Página:** Google Identity Services, *token model*
  (`google.accounts.oauth2.initTokenClient`). El token dura una hora y no hay refresh token.
  Se guarda en `localStorage` con su vencimiento para no pedir login en cada recarga; con
  `login_hint` = el último email usado. Pedir el token abre una ventana, así que **solo se pide
  desde un toque del usuario** (botón Conectar, o al tocar la cámara si no hay token vigente).
- **`qc.py`:** el cliente de escritorio de `~/.config/gtasks-mcp/client.json` (o
  `~/.config/que-como/client.json` si existe), PKCE y servidor loopback, como Loop web. El token
  se guarda en `~/.config/que-como/token.json` y nunca se imprime. En modo Prueba vence cada
  7 días: cuando vence, `qc.py` lo dice y `python qc.py auth` lo renueva.
- `docs/config.js` exporta `CLIENT_ID` (el del cliente web; mientras no exista, la cadena vacía,
  y la página ofrece el modo demo).

## Los datos en el Drive

Todo dentro de la carpeta **`Qué como`**, en la raíz del Drive. Los archivos se reconocen por
`appProperties.quecomo`, no por el nombre (Pablo los puede renombrar o mover sin romper nada).
Se busca siempre con `trashed = false`.

| Qué | Nombre | `appProperties` | Lo escribe |
|---|---|---|---|
| Carpeta raíz | `Qué como` | `quecomo=raiz` | página o qc.py (el primero que la necesite) |
| Carpeta de fotos | `fotos` (dentro de la raíz) | `quecomo=fotos` | ídem |
| Una foto | `2026-10-22_13-40-12_a3f9.jpg` | `quecomo=foto`, `grupo`, `tomada`, `estado` | página; qc.py cambia `estado` |
| Una comida sin foto | `2026-10-22_13-40-12_a3f9.txt` | `quecomo=texto`, `grupo`, `tomada`, `estado` | página; qc.py cambia `estado` |
| El registro | `registro.json` (raíz) | `quecomo=registro` | qc.py y la página (correcciones) |
| El perfil | `perfil.json` (raíz) | `quecomo=perfil` | página |
| El peso | `peso.json` (raíz) | `quecomo=peso` | página |

### Capturas (fotos y textos)

Una **captura** es lo que Pablo registra de una vez: una o varias fotos de la misma comida, o un
texto suelto ("2 alfajores, no saqué foto"). Todas las piezas de una captura comparten `grupo`.

- `grupo`: `g-AAAAMMDD-HHMMSS-xxxx` (hora local de la primera pieza, 4 caracteres al azar
  `[a-z0-9]`). Ejemplo: `g-20261022-134012-a3f9`.
- `tomada`: ISO 8601 con zona, hora local de Argentina: `2026-10-22T13:40:12-03:00`. Para una
  foto de la galería, la fecha EXIF (`DateTimeOriginal`) si la tiene; si no, `lastModified` del
  archivo. Para una foto sacada en el momento, la hora del momento.
- `estado`: `pendiente` (recién subida) · `procesada` (ya está en el registro) · `descartada`
  (Pablo la descartó en la página).
- **La nota** de la captura va en el campo `description` de **todas** las piezas del grupo
  (misma cadena). Cambiar la nota = actualizar `description` de todas. Vacía = sin nota.
- Un texto suelto es un archivo `text/plain` cuyo contenido es lo que escribió Pablo; su
  `description` también lo lleva.
- Las fotos se suben ya comprimidas: JPEG, lado mayor 1600 px, calidad 0,82, sin EXIF (la
  compresión con canvas lo quita; la hora ya quedó en `tomada`).
- Los valores de `appProperties` miden como mucho 124 bytes (clave + valor): nunca va la nota ahí.

### `registro.json`

```json
{
  "version": 1,
  "actualizado": "2026-10-22T21:05:00-03:00",
  "comidas": [
    {
      "id": "g-20261022-134012-a3f9",
      "fecha": "2026-10-22",
      "hora": "13:40",
      "tipo": "almuerzo",
      "titulo": "Milanesa con puré",
      "fotos": ["1AbC...", "1DeF..."],
      "nota": "puré de caja",
      "items": [
        {"nombre": "Milanesa de carne frita", "porcion": "1 grande (~180 g)",
         "kcal": 420, "proteina_g": 30, "carbos_g": 20, "grasa_g": 24},
        {"nombre": "Puré de papas instantáneo", "porcion": "1 taza (~200 g)",
         "kcal": 180, "proteina_g": 4, "carbos_g": 28, "grasa_g": 6}
      ],
      "kcal": 600, "proteina_g": 34, "carbos_g": 48, "grasa_g": 30,
      "confianza": "media",
      "comentario": "La milanesa parece frita; al horno serían ~120 kcal menos.",
      "procesada": "2026-10-22T21:05:00-03:00",
      "editada": false,
      "revisar": null
    }
  ]
}
```

- `id` = el `grupo` de la captura. Una comida por grupo.
- `fecha` y `hora` locales (de `tomada`). Las comidas se muestran en el día de `fecha`.
- `tipo`: `desayuno` · `almuerzo` · `merienda` · `cena` · `colacion` · `bebida`.
- Los totales (`kcal`, `proteina_g`, `carbos_g`, `grasa_g`) son siempre la suma de `items`,
  redondeada a entero. Quien edita `items` recalcula los totales.
- `confianza`: `alta` · `media` · `baja`.
- `editada`: `true` si Pablo tocó números a mano en la página (el próximo procesamiento no la
  pisa, salvo que pida revisarla).
- `revisar`: `null`, o la corrección que pidió Pablo en la página para que Claude vuelva a
  estimar: `{"pedido": "no era arroz, era quinoa", "fecha": "2026-10-23T09:12:00-03:00"}`.
  Al re-procesar, qc.py lo vuelve a `null`.
- Orden: por `fecha` y `hora`. Quien escribe conserva los campos que no conoce.

### `perfil.json`

```json
{
  "version": 1,
  "sexo": "m",
  "nacimiento": "1985-04-12",
  "altura_cm": 178,
  "actividad": "ligera",
  "peso_objetivo_kg": 78,
  "deficit_kcal": 500,
  "proteina_g_kg": 1.6,
  "meta_kcal_manual": null
}
```

- `sexo`: `m` · `f`. `actividad`: `sedentaria` (1,2) · `ligera` (1,375) · `moderada` (1,55) ·
  `alta` (1,725).
- `deficit_kcal`: 250, 500 o 750 (≈ 0,25 / 0,5 / 0,75 kg por semana), o cualquier entero.
- `meta_kcal_manual`: si no es `null`, reemplaza la meta calculada.
- Sin perfil cargado (`null`), la página muestra los consumos sin meta e invita a completarlo.

### `peso.json`

```json
{ "version": 1, "registros": [ {"fecha": "2026-10-22", "kg": 84.3}, ... ] }
```

Uno por día como mucho (cargar de nuevo el mismo día reemplaza). Ordenado por fecha.

### Escrituras y choques

Las escrituras de JSON son *leer → aplicar el cambio → escribir* en un solo paso
(`actualizarRegistro(fn)`), justo antes de escribir. No hay bloqueo: Pablo no edita en la página
mientras Claude procesa. Las capturas no tocan `registro.json`: el celu solo crea archivos nuevos,
así que nunca choca con nada.

## La página

### Rutas

| Ruta | Vista | Dueño |
|---|---|---|
| `#/captura` | la cámara | captura |
| `#/hoy` · `#/hoy/2026-10-22` | el día (sin fecha = hoy) | panel |
| `#/semana` · `#/semana/2026-10-19` | la semana que empieza ese lunes | panel |
| `#/peso` | peso | cuerpo |
| `#/perfil` | perfil y metas | cuerpo |

Sin ruta: `#/captura` si la pantalla mide menos de 700 px de ancho, `#/hoy` si no.
En `#/captura` no se muestran las pestañas (pantalla completa); un ícono chico lleva al panel.

### Interfaz de las vistas

Cada vista es un módulo ES con:

```js
export async function montar(contenedor, params, ctx) { ... return desmontar?; }
```

- `contenedor`: el `<main id="vista">`, vacío. La vista lo llena.
- `params`: lo que sigue en la ruta (`["2026-10-22"]`, o `[]`).
- `ctx`:
  - `ctx.datos`: la implementación de datos (ver abajo).
  - `ctx.navegar(ruta)`: cambia a `#/...`.
  - `ctx.toast(texto, {tipo})`: aviso breve; `tipo`: `ok` · `error` · `info`.
  - `ctx.avisarCambio()`: la vista avisa que cambió algo (por ejemplo, subió una foto); app.js
    actualiza la insignia de pendientes.
  - `ctx.conectar()`: pide el token (desde un toque) y, si sale bien, repinta la sesión y
    vuelve a montar la vista actual.
- Si la sesión cambia por su cuenta (el token venció, o se conectó desde otra parte), `drive.js`
  dispara `window.dispatchEvent(new Event("quecomo:sesion"))` y app.js repinta la cabecera.
- Utilidades compartidas en `js/util.js`: `el()`, `icono(nombre)`, `toast()`, `mensajeError()`,
  fechas (`hoyISO`, `fechaISO`, `parseFecha`, `sumarDias`, `diasEntre`, `lunesDe`, `isoConZona`,
  `nuevoGrupo`, `formatoFecha`, `fechaRelativa`, `horaDe`) y números (`num(n, decimales)`).
  Usarlas en vez de duplicarlas. Íconos disponibles: camara, galeria, texto, panel, ok, mas,
  cerrar, izq, der, editar, borrar, nota, nube, reloj, revisar, balanza, salir. Si falta uno, se
  pide en "Decisiones".
- Devuelve opcionalmente una función de limpieza (timers, listeners de `window`).
- Si `montar` tira un error, app.js muestra "No pude cargar esta parte: …" en el contenedor.

### Datos (la API de `datos.js`)

`datos.js` exporta `obtenerDatos()`, que devuelve la implementación según la URL: con `?demo` en
la URL (o sin `CLIENT_ID`), `demo.js`; si no, `drive.js`. **Las dos exportan exactamente esta API**
(todas las funciones son `async` salvo que se indique):

```js
// sesión
estado()                     // sync → {conectado, email|null, demo}
conectar()                   // pide el token (abre ventana); llamar solo desde un toque
desconectar()
// capturas
subirFoto(blob, {grupo, tomada, nota})   // → {id}
crearTexto(texto, {grupo, tomada})       // → {id}; la nota = el texto
pendientes()                 // → [{grupo, tomada, nota, piezas:[{id, tipo:'foto'|'texto', nombre}]}]
                             //   estado = pendiente, de más vieja a más nueva
cambiarNota(grupo, nota)     // actualiza description de todas las piezas del grupo
descartar(grupo)             // estado = descartada en todas las piezas
urlFoto(id)                  // → URL usable en <img> (object URL en caché de memoria)
// registro
leerRegistro()               // → el objeto de registro.json (vacío: {version:1, comidas:[]})
actualizarRegistro(fn)       // fn(registro) → registro; lee lo último, aplica fn, escribe
// perfil y peso
leerPerfil()                 // → objeto o null
guardarPerfil(perfil)
leerPeso()                   // → {version:1, registros:[...]}
guardarPeso(datos)
```

Errores: las funciones tiran `Error` con `.codigo` y un mensaje en español para mostrar tal cual:
`sin_conexion` (sin internet), `sin_login` (falta token o venció; hay que tocar Conectar),
`drive` (Drive respondió con error). Ante un 401, `drive.js` borra el token guardado y tira
`sin_login`.

### Modo demo

`?demo` en la URL. `demo.js` guarda todo en `localStorage` (clave `quecomo-demo`) y arranca con
datos de ejemplo: perfil, 30 días de peso, 7 días de comidas procesadas con fotos de ejemplo
(dibujos SVG en data URL) y 2 capturas pendientes. `?demo=reset` vuelve a los datos de ejemplo.
Sirve para desarrollar y probar sin Google. Arriba se ve una franja "Modo demo".

### Captura (el celu)

- Pantalla completa. En el centro, **un solo ícono grande de cámara** (sin texto). Abajo y más
  chicos: ícono de galería (elegir fotos ya sacadas, varias a la vez) e ícono de texto (registrar
  algo sin foto). Arriba a la derecha, un ícono chico para ir al panel.
- Cámara: `<input type="file" accept="image/*" capture="environment">`. Galería: el mismo
  `<input>` sin `capture` y con `multiple`.
- Al volver de la cámara, la foto **se encola y sube sola**. La pantalla muestra la miniatura, una
  marca de "subida" (o "en cola" si no hay señal) y dos opciones chicas: **+** (otra foto de la
  misma comida, mismo `grupo`) y **nota** (campo de texto opcional). Después de 60 segundos sin
  tocar nada, o al tocar ✓, vuelve a la cámara. La nota escrita después de subir se guarda con
  `cambiarNota`.
- Galería con varias fotos: una sola captura (mismo `grupo`), con la `tomada` de la primera.
- Abajo, una tira con las capturas pendientes de hoy (miniaturas), para ver que llegaron.
- **Cola:** cada foto se guarda primero en IndexedDB (`cola.js`) y después se sube. Si falla por
  falta de señal o de login, queda en la cola y se reintenta al volver la conexión, al abrir la
  página y al conectar. La cola se ve como un número sobre la tira ("2 en cola").
- Sin token vigente: tocar la cámara funciona igual (la foto queda en cola) y aparece arriba un
  botón **Conectar** que pide el token y vacía la cola.

### Panel (la compu)

Cabecera con el nombre, las pestañas **Hoy · Semana · Peso · Perfil**, la insignia de pendientes
("3 por procesar", que al pasar el mouse explica: "Pedile a Claude «procesá» en la carpeta
que-como") y el estado de la conexión (Conectar / el email).

- **Hoy:** flechas para cambiar de día. Un anillo con lo consumido contra la meta y "te quedan
  N kcal" (o "N kcal arriba de la meta"). Barras de proteína (contra su meta), carbos y grasa. La
  lista de comidas del día en orden de hora: miniaturas de las fotos (tocar = foto grande), tipo y
  hora, título, kcal, tabla de items, confianza, nota, comentario de Claude. Las capturas
  pendientes de ese día aparecen en su lugar, en gris, con su nota editable y "Descartar".
- **Corregir una comida:** dos caminos. (1) **Pedir revisión**: un texto ("no era arroz, era
  quinoa") que se guarda en `revisar`; la tarjeta queda marcada "a revisar" y la próxima vez que
  se procese, Claude la vuelve a estimar. (2) **Editar a mano**: kcal y macros de cada item
  editables, más agregar o quitar items; recalcula totales y pone `editada: true`. También
  **Borrar** la comida: la saca del registro y pone `estado=descartada` en sus piezas.
- **Semana:** lunes a domingo. Barras de kcal por día contra la línea de la meta, promedio diario,
  días dentro de la meta, proteína promedio, peso al principio y al final de la semana si hay.
  Tocar un día lleva a Hoy de ese día. Flechas para cambiar de semana.
- **Peso:** campo para cargar el peso (fecha = hoy, cambiable). Gráfico SVG: puntos diarios, media
  móvil de 7 días (la línea que importa) y línea del peso objetivo. Cambio de la media en 7 y en
  30 días, ritmo en kg por semana, y proyección de cuándo se llega al objetivo a ese ritmo (si
  baja). **Balance:** en las últimas 4 semanas, lo que se debería haber bajado según las kcal
  registradas y el gasto calculado, contra lo que bajó la media (ayuda a ver si las estimaciones
  se quedan cortas). Solo con al menos 14 días con comidas registradas.
- **Perfil:** el formulario de `perfil.json`, mostrando en vivo: metabolismo basal, gasto diario,
  meta de kcal y meta de proteína.

### Cálculos (`calculos.js`, funciones puras)

```js
edad(nacimiento, fecha)                       // años cumplidos
tmb({sexo, kg, altura_cm, edad})              // Mifflin-St Jeor: 10kg + 6,25cm − 5edad + (5 | −161)
gastoDiario(perfil, kg, fecha)                // tmb × factor de actividad; null si falta algo
metaKcal(perfil, kg, fecha)                   // meta_kcal_manual ?? gastoDiario − deficit_kcal
metaProteina(perfil, kg)                      // proteina_g_kg × peso_objetivo_kg (o kg si falta)
pesoActual(registrosPeso, fecha)              // el último registro hasta esa fecha, o null
mediaMovil(registrosPeso, dias = 7)           // → [{fecha, kg, media}] media de los registros
                                              //   de los últimos `dias` días calendario
resumenDia(registro, fecha)                   // → {kcal, proteina_g, carbos_g, grasa_g, comidas}
resumenSemana(registro, lunes)                // → {dias:[resumenDia×7], promedioKcal (solo días
                                              //   con comidas), diasConComidas}
ritmoSemanal(registrosPeso, fecha, dias = 28) // pendiente de la media móvil, kg/semana
proyeccion(registrosPeso, perfil, fecha)      // → {fecha, semanas} o null si no baja
balance(registro, registrosPeso, perfil, fecha, dias = 28)
                                              // → {esperadoKg, realKg, diasConComidas} o null
```

7.700 kcal ≈ 1 kg de grasa (para el balance y la proyección por déficit).

### Aspecto

- Base en `css/base.css`: variables de color en `:root`, tema oscuro con
  `@media (prefers-color-scheme: dark)`, tipografía del sistema, componentes comunes (`.btn`,
  `.btn-icono`, `.tarjeta`, `.chip`, `.campo`, `.tabs`, `.toast`, `.vacio`). Cada vista usa estas
  piezas y agrega lo suyo en su CSS.
- Íconos: SVG en línea (trazo, sin rellenos de colores), sin fuentes de íconos ni emojis como
  íconos.
- Mobile first. En la compu, el contenido mide como mucho 1100 px de ancho.
- Accesible: los botones de solo ícono llevan `aria-label` en español; se puede usar con teclado.

## El procesamiento (Claude, en esta carpeta)

```
python qc.py auth          # conecta el Drive (abre el navegador)
python qc.py pendientes    # baja lo pendiente y lo que hay que revisar, y lo lista
python qc.py platos [txt]  # comidas anteriores parecidas (para estimar parejo)
python qc.py registrar data/estimaciones.json   # anota en registro.json y marca procesadas
python qc.py resumen [AAAA-MM-DD]               # el día (y la semana) en la terminal
```

- `pendientes` baja cada captura pendiente a `data/pendientes/<grupo>/` (`1.jpg`, `2.jpg`,
  `texto.txt`) y escribe `data/pendientes.json`:
  `{"generado", "capturas":[{grupo, tomada, nota, archivos:[ruta local], ids:[id Drive]}],
  "revisar":[{id, pedido, comida (la del registro), archivos:[...]}], "perfil": {...},
  "meta_kcal": n}`. Imprime un resumen legible (cuántas, de qué días, notas).
- La skill `procesar` le dice a Claude: correr `pendientes`, mirar cada foto (herramienta Read),
  usar las notas y `platos` para ser consistente, escribir `data/estimaciones.json` y correr
  `registrar`. Después mostrar el resumen del día.
- `data/estimaciones.json`:
  ```json
  {"comidas": [{"grupo": "g-20261022-134012-a3f9", "tipo": "almuerzo",
                "titulo": "Milanesa con puré", "items": [...], "confianza": "media",
                "comentario": "..."}]}
  ```
  `registrar` completa `fecha`, `hora`, `fotos`, `nota`, los totales y `procesada`; valida (tipo
  conocido, kcal enteras ≥ 0, items no vacíos, grupo existente) y si algo no cierra no escribe
  nada y explica qué. Para un grupo que ya estaba en el registro (revisión), reemplaza la comida
  y pone `revisar: null` y `editada: false`. Marca `estado=procesada` en todas las piezas.
  Al terminar borra `data/pendientes/` de los grupos registrados.
- Cómo estimar (va en la skill): items separados por alimento, porciones en medidas caseras con
  gramos aproximados, valores típicos argentinos (pan francés, milanesa, empanada, mate cocido,
  facturas), aceite y salsas visibles contados aparte, bebidas incluidas. Si algo no se ve, se
  dice en `comentario` y se baja la confianza. Ante la duda, redondear hacia arriba (subestimar es
  el error típico).

## Decisiones de los constructores

(Cada constructor agrega acá lo que decidió que afecte a otros, o lo que necesita de un archivo
ajeno.)

- **[cuerpo]** `calculos.js` (ya está, firmas del contrato):
  - `pesoActual` devuelve el **registro** `{fecha, kg}` (o null), no el número. Las funciones que
    piden `kg` (`tmb`, `gastoDiario`, `metaKcal`, `metaProteina`) aceptan un número **o** ese
    registro, así que `metaKcal(perfil, pesoActual(peso.registros, fecha), fecha)` anda. Donde dice
    `registrosPeso` se acepta el array o el objeto entero de `peso.json`.
  - `gastoDiario` y `metaKcal` devuelven enteros; `tmb` sin redondear; `metaProteina` entero.
    Todo lo que no se puede calcular (sin perfil, falta sexo/nacimiento/altura/actividad, sin peso)
    devuelve `null`. `metaKcal` con `meta_kcal_manual` no necesita peso.
  - `resumenDia(registro, fecha)` → `{fecha, kcal, proteina_g, carbos_g, grasa_g, comidas, lista}`:
    **`comidas` es la cantidad** (número); `lista` son las comidas de ese día ordenadas por hora.
  - `resumenSemana(registro, lunes)` → `{lunes, dias, promedioKcal, promedioProteina_g,
    diasConComidas}`; los promedios solo sobre días con comidas, enteros, `null` si no hay.
  - Extras: `cambioMedia(registrosPeso, fecha, dias)`, `FACTORES_ACTIVIDAD`, `KCAL_POR_KG`.
  - `ritmoSemanal`: kg/semana, **negativo = baja**. `balance`: `esperadoKg` y `realKg` positivos =
    bajó (definición precisa en el comentario de la función); la vista Peso lo calcula hasta ayer.
- **[drive]** `drive.js` (ya está, API exacta del contrato, mismas formas que `demo.js`):
  - **Nombres de piezas:** `<AAAA-MM-DD_HH-MM-SS de tomada>_<últimos 4 de grupo>.jpg|.txt`; la
    segunda pieza del grupo lleva `_2`, la tercera `_3`… (cuenta las piezas del grupo en Drive la
    primera vez y después numera en memoria, así dos subidas a la vez no repiten nombre). Para
    ordenar piezas por nombre conviene sacar la extensión y comparar con orden numérico
    (`…_a3f9` < `…_a3f9_2` < `…_a3f9_10`); así lo hace `pendientes()`.
  - **[proceso]** Si hay varias carpetas raíz, de fotos, o varios `registro/perfil/peso.json` (la
    página y qc.py crearon a la vez), la página usa **el de `createdTime` más viejo**
    (`orderBy=createdTime`). qc.py debería usar la misma regla para que los dos escriban en el
    mismo archivo. La raíz se crea en `root` del Drive; `fotos` dentro de la raíz; los JSON en la
    raíz, con `mimeType: application/json` y JSON con sangría de 2.
  - `subirFoto` con nota no vacía pone esa nota en las otras piezas del grupo (como `demo.js`); si
    eso falla, no tira error (la foto ya subió y la cola no tiene que volver a subirla).
  - Errores: `sin_login` ("Tenés que conectar el Drive." / "Se venció el permiso del Drive: tocá
    Conectar." si había token y venció o hubo 401), `sin_conexion` ("No hay conexión a internet."),
    `drive` ("Drive respondió con un error: … (código N)."; 404 → "No encuentro el archivo en el
    Drive (¿se borró?)."; Drive lleno → mensaje propio). Un JSON dañado tira `drive` y no se pisa.
  - `estado().email` es null si no está conectado. El evento `quecomo:sesion` sale al conectar, al
    desconectar, ante un 401, cuando vence el token (timer) y cuando otra pestaña conecta o
    desconecta (evento `storage`).
  - **[base]** `node --test tests-js/` **no anda en Node 24** (toma la carpeta como un módulo y
    falla). Lo que anda: `node --test "tests-js/*.test.js"` (o `node --test` a secas desde la raíz).
    Conviene usar ese comando en README/CONTRATO.
- **[proceso]** `qc.py` y `quecomo/` (ya están; `python -m unittest discover -s tests`):
  - Usa la misma regla que la página: si hay varios archivos del mismo tipo, **el de `createdTime`
    más viejo**. qc.py nunca crea la carpeta `fotos`; crea la raíz (en `root`) y `registro.json`
    (en la raíz, JSON con sangría de 2) solo si faltan al primer `registrar`. Busca las piezas por
    `appProperties` en todo el Drive (no solo dentro de `fotos`).
  - Orden de las piezas de un grupo: por nombre sin extensión con los números como números (igual
    que `drive.js`). `fotos` de la comida = ids de las fotos en ese orden. `nota` = la primera
    `description` no vacía del grupo (en un texto suelto, su texto). Fecha y hora = la `tomada`
    más temprana del grupo (si falta, se saca del nombre del grupo).
  - `data/pendientes.json`: lo del contrato, más `revisar[].ids` (ids de las piezas) y, si una
    comida a revisar recibió piezas nuevas pendientes, `capturas[].pedido` (se procesa como
    captura). `archivos` son rutas **absolutas** (la herramienta Read las necesita así).
  - `registrar`: en una revisión conserva `fecha` y `hora` de la comida y recalcula `fotos` y
    `nota` desde sus piezas (sin las descartadas). Solo cambia `estado` de las piezas que no
    estaban `procesada`. Si llegó una pieza nueva a un grupo después de `pendientes`, no anota y
    pide correr `pendientes` de nuevo. `comentario` ausente se guarda como `""`. Los items guardan
    los campos extra que traigan.
  - Ojo con el ejemplo del contrato: el 22/10/2026 es **jueves** ("jue 22/10"), no miércoles.
- **[captura]** Cámara, cola, imagen, manifest, sw e íconos (ya están):
  - **IndexedDB:** la base `quecomo` (versión 1, almacén `subidas`, `keyPath: "clave"`
    autoincremental) es de `cola.js`. Si alguien más necesita IndexedDB, que use otra base (subir
    la versión de `quecomo` desde otro archivo rompería la cola).
  - **Cola:** guarda la foto como `ArrayBuffer` (no `Blob`, por Safari). Además de fotos y textos
    acepta `{tipo:'nota', grupo, nota}` = un `cambiarNota` pendiente (una por grupo, la última
    manda; no cuenta en "N en cola"). Si la nota cambia mientras una foto está subiendo, al terminar
    encola el `cambiarNota`. Un error `drive` deja la pieza en la cola (con `intentos`) y sigue con
    las demás; `sin_login`/`sin_conexion` cortan la corrida. Sin token vigente ni lo intenta.
  - **Evento** `window` → `CustomEvent("quecomo:cola", {detail:{evento, clave, grupo, tipo}})`,
    `evento`: `encolada · subiendo · subida · en_cola · error`. **[base]** si app.js quiere mostrar
    algo de la cola en el panel, puede escucharlo (`import { contar } from "./cola.js"`).
  - **Tocar la cámara no pide el token** (el contrato lo permitía): el toque se usa para abrir la
    cámara y una ventana de login al mismo tiempo la bloquearía. Sin token, la foto queda en cola y
    arriba aparece **Conectar** (`ctx.conectar()`, que vuelve a montar la vista y vacía la cola).
  - Galería con varias fotos: `tomada` = la **más vieja** de las elegidas (EXIF; si no,
    `lastModified`) para todas las piezas; el `grupo` sale de esa hora. Foto de cámara y el **+**:
    la hora del momento, mismo `grupo`.
  - `fechaExif`: si la foto trae `OffsetTimeOriginal`, usa el instante exacto; si no, toma la hora
    EXIF como hora local del aparato.
  - **sw.js:** primero la red (con 4 s de espera; si tarda más y hay caché, usa la caché y la
    actualiza de fondo), caché si no hay red; navegaciones sin red → `index.html` en caché (ignora
    `?demo`). Solo GET del mismo origen y dentro del alcance. Precarga el shell archivo por archivo
    (si falta uno, el resto se guarda igual). Caché `quecomo-shell-v1`; al activar borra las otras
    `quecomo-*`. **Quien agregue un archivo JS/CSS nuevo a la página lo tiene que sumar a `SHELL`
    en sw.js** (pedírmelo/anotarlo acá); sin eso igual se guarda en caché la primera vez que se usa.
  - Estilo según Pablo ("que prime el minimalismo"): sin textos explicativos ni chips en la
    cámara; "N en cola" solo si N > 0.
- **[cuerpo]** Ojo: en Node 24, `node --test tests-js/` falla (toma la carpeta como un módulo).
  Usar `node --test` (sin argumentos, en la raíz) o `node --test "tests-js/*.test.js"`.
- **[panel]** Hoy, Semana y `vistas/comida.js` (ya están):
  - `comida.js` exporta `tarjetaComida(comida, ctx, {alCambiar})`, `tarjetaPendiente(captura, ctx,
    {alCambiar})`, `abrirFotos(ids, i, ctx, titulo)` / `cerrarFotos()`, `confirmar({titulo, texto,
    si, no, peligro}) → Promise<boolean>` (diálogo propio: `confirm()` del navegador puede mostrar
    "OK/Cancel" en inglés), `svgEl()`, `totales(items)`, `kgDe()`, `finito()`, `TIPOS`. Quien
    quiera un diálogo de confirmación en español puede importar `confirmar`.
  - Borrar una comida: primero la saca del registro (`actualizarRegistro`), después
    `descartar(comida.id)`. Editar a mano: items con decimales de a 0,1 (kcal enteras), totales =
    suma redondeada a entero, `editada: true`; también deja cambiar `titulo` y `tipo`.
  - Una captura pendiente cuyo `grupo` ya está en el registro no se muestra como pendiente.
  - Semana: la meta se calcula día por día (`metaKcal` con `pesoActual` de ese día), igual que en
    Hoy; la línea del gráfico va por día y el número que se muestra es la del último día ya
    pasado. "Días en la meta" = días con comidas con kcal ≤ meta de ese día. Peso de la semana =
    primer y último registro dentro de lunes–domingo.
  - Estilo según Pablo ("que prime el minimalismo"): sin cajas por comida (divisores finos), items
    como lista liviana, tabla P/C/G y acciones (Pedir revisión / Editar / Borrar) al desplegar la
    comida (clic o ⋯); confianza solo si es baja; números de la semana sin subtítulos (detalle en
    `title`), valores del gráfico al pasar el mouse, tabla por día en un `<details>` cerrado.
  - **[base]** Falta un ícono "⋯" en `util.js` (`icono("mas3")` o similar): por ahora `comida.js`
    lo dibuja en línea. Si se agrega, lo cambio.
- **[revisión]** Arreglos de la página (cola, drive, cuerpo):
  - **Piezas sin duplicados:** cada foto o texto de la cola lleva un id fijo `pieza` (UUID, 36
    caracteres) que va en `appProperties.pieza` (entra en los 124 bytes). `subirFoto` y
    `crearTexto` aceptan además `{pieza, reintento}`: con `reintento: true` (la cola ya la había
    mandado: se cortó la señal o Drive dio error) primero buscan
    `appProperties has { key='pieza' and value='…' } and trashed = false` y, si ya está, devuelven
    ese id sin crear otra (y le ponen la nota actual). Si el POST de la subida da 429/5xx, antes de
    repetirlo también la busca. La primera subida no hace ningún pedido de más. `demo.js` acepta
    las mismas opciones. qc.py ignora `pieza` (claves desconocidas de `appProperties`).
  - **Cola:** el almacén ahora es `agregar, todos, actualizar(clave, fn), sacar(clave), borrar`;
    `actualizar` lee y escribe en una sola transacción y no hace nada si la fila ya no está (así
    cambiar la nota mientras termina una subida no vuelve a meter la foto en la cola).
  - **Tiempo máximo:** todo pedido a Google se corta a los 30 s (120 s para subir o bajar
    archivos) y tira `sin_conexion` ("La conexión tardó demasiado."), así la cola reintenta.
  - **Login:** `drive.js` empieza a cargar el script de Google apenas se importa (si hay
    `CLIENT_ID`), para que el toque en Conectar abra la ventana sin pasar por un `await` (Safari
    la bloquea si no).
  - Perfil y Peso: "Reintentar" vacía el contenedor antes de volver a montar y encadena la
    limpieza del montaje nuevo en la que recibe app.js.
- **[revisión]** Pieza que llega tarde: si una captura pendiente tiene un `grupo` que ya está en
  `registro.json`, `qc.py pendientes` baja **todas** las piezas no descartadas del grupo y marca la
  captura con `agregada: true`, `comida` (la registrada), `nuevas` (ids pendientes) y `aviso`.
  Claude estima la comida entera; `registrar` la reemplaza conservando `fecha` y `hora`. El
  redondeo de gasto, meta y promedios en Python es igual al de `Math.round` de la página.
