# Qué como

Un registro de lo que comés para bajar de peso, sin anotar nada a mano: le sacás una foto a la
comida y listo. Después, en la compu, le decís a Claude **"procesá"** y él mira las fotos, estima
las calorías y las anota.

La página está en **https://pablospata.github.io/que-como/** y es la misma en el celu y en la
compu. Tus fotos y tu registro quedan en tu Drive, en la carpeta **Qué como**.

## En el celu

1. Abrí la página en Chrome y tocá **Conectar** (la primera vez Google te pide permiso: la página
   solo ve los archivos que crea ella, no el resto de tu Drive).
2. Para tenerla como app: menú de Chrome (⋮) → **Agregar a la pantalla principal** (o **Instalar
   app**).
3. Antes de comer, tocá la cámara grande. La foto se sube sola.
   - **+** suma otra foto de la misma comida.
   - **Nota** sirve para aclarar lo que la foto no muestra ("sin aceite", "media porción", "2
     cervezas").
   - El ícono de galería sube fotos que ya sacaste; el de líneas registra algo sin foto.
4. Sin señal no pasa nada: la foto queda guardada en el celu y se sube cuando vuelve la conexión.

El permiso de Google dura una hora. Cuando vence, la cámara sigue andando (las fotos quedan en
cola) y arriba aparece **Conectar**: lo tocás y se sube todo.

## Procesar (en la compu, con Claude)

Abrí Claude Code en la carpeta `que-como` y decile **"procesá"**. Claude baja las fotos
pendientes, estima cada comida y te contesta con el resumen del día.

La primera vez, y después cada 7 días (porque la app de Google está en modo Prueba, igual que la
de Tasks y la de Loop), Claude te va a pedir que aceptes el permiso del Drive en el navegador.

## En la compu (el panel)

- **Hoy:** lo que llevás contra tu meta, las comidas con sus fotos y lo que falta procesar. Tocando
  una comida podés **pedir revisión** (por ejemplo "no era arroz, era quinoa"; Claude la vuelve a
  estimar la próxima vez que proceses), **editar** los números a mano o **borrarla**.
- **Semana:** las calorías de cada día contra la meta.
- **Peso:** cargás el peso cuando te pesás. Lo que importa es la línea verde, la media de 7 días.
  Con 14 días de comidas aparece el **balance**: lo que deberías haber bajado según lo que comiste
  contra lo que bajaste de verdad.
- **Perfil:** tus datos y metas. Con eso se calcula cuánto gastás por día y tu meta de calorías.

## Probar sin Google

`https://pablospata.github.io/que-como/?demo` abre la página con datos de ejemplo que quedan solo
en ese navegador. `?demo=reset` vuelve a los datos de ejemplo.

## Si algo no anda

- **"Se venció el permiso del Drive"** en la página: tocá **Conectar**.
- **Claude dice que se venció el permiso** al procesar: aceptá de nuevo en el navegador (Claude
  corre `python qc.py auth`).
- **El navegador no dejó abrir la ventana de Google:** tocá **Conectar** otra vez.

---

Para quien la mantenga: el diseño está en `CONTRATO.md`. Pruebas: `node --test` (página) y
`python -m unittest discover -s tests` (procesamiento). Para verla local: `.claude/launch.json`
sirve `docs/` en http://127.0.0.1:8795/?demo.
