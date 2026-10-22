// La cámara (el celu): un ícono grande para sacar foto, galería y texto abajo, y la tira de
// lo que ya llegó hoy. Cada foto se comprime, entra a la cola (IndexedDB) y sube sola.
import { el, icono, mensajeError, nuevoGrupo, isoConZona, hoyISO, horaDe } from "../util.js";
import { comprimir, fechaDeArchivo } from "../imagen.js";
import * as cola from "../cola.js";

const INACTIVIDAD_MS = 60000;

const TEXTO_ESTADO = {
  preparando: "preparando…",
  subiendo: "subiendo…",
  subida: "subida",
  en_cola: "en cola",
  error: "no subió",
};

export async function montar(contenedor, params, ctx) {
  const { datos } = ctx;
  let vivo = true;
  const limpiezas = [];
  const urlsPropias = new Set();          // object URLs creados acá (se liberan al salir)

  const urlDe = (blob) => {
    const u = URL.createObjectURL(blob);
    urlsPropias.add(u);
    return u;
  };
  const soltarUrl = (u) => {
    if (urlsPropias.delete(u)) URL.revokeObjectURL(u);
  };
  const escuchar = (blanco, evento, fn, opciones) => {
    blanco.addEventListener(evento, fn, opciones);
    limpiezas.push(() => blanco.removeEventListener(evento, fn, opciones));
  };
  const error = (e) => { if (vivo) ctx.toast(mensajeError(e), { tipo: "error" }); };

  // ------------------------------------------------------------ estado de la captura actual
  // actual = {grupo, tomada, piezas: [{clave, url, estado, nodo}], notaGuardada}
  let actual = null;
  let porClave = new Map();               // clave de la cola → pieza de la captura actual
  let temporizador = null;
  let modoEntrada = "nueva";              // "nueva" | "agregar" (el + de la misma comida)

  // ------------------------------------------------------------ armado

  const inputCamara = el("input", { type: "file", accept: "image/*", capture: "environment",
    class: "visualmente-oculto", tabindex: "-1", "aria-hidden": "true" });
  const inputGaleria = el("input", { type: "file", accept: "image/*", multiple: true,
    class: "visualmente-oculto", tabindex: "-1", "aria-hidden": "true" });

  const zonaConectar = el("div", { class: "cap-conectar" });
  const arriba = el("div", { class: "cap-arriba" },
    zonaConectar,
    el("button", { class: "btn-icono cap-ir-panel", type: "button", "aria-label": "Ir al panel",
      title: "Ir al panel", onclick: () => ctx.navegar("hoy") }, icono("panel", 22)),
  );

  const btnCamara = el("button", { class: "cap-disparador", type: "button", "aria-label": "Sacar foto",
    onclick: () => abrirCamara("nueva") }, icono("camara", 64));
  const btnGaleria = el("button", { class: "cap-secundario", type: "button",
    "aria-label": "Elegir fotos de la galería", title: "Elegir fotos de la galería",
    onclick: () => { modoEntrada = "nueva"; inputGaleria.click(); } }, icono("galeria", 28));
  const btnTexto = el("button", { class: "cap-secundario", type: "button",
    "aria-label": "Anotar sin foto", title: "Anotar sin foto", onclick: abrirHojaTexto }, icono("texto", 28));

  const pantallaCamara = el("section", { class: "cap-camara", "aria-label": "Cámara" },
    btnCamara,
    el("div", { class: "cap-otros" }, btnGaleria, btnTexto),
  );

  // revisión: después de sacar la foto
  const miniaturas = el("div", { class: "cap-miniaturas" });
  const estadoTexto = el("p", { class: "cap-estado", role: "status", "aria-live": "polite" });
  const notaArea = el("textarea", { class: "entrada cap-nota-texto", rows: "3", maxlength: "500",
    placeholder: "Nota", "aria-label": "Nota" });
  const notaCaja = el("div", { class: "cap-nota", hidden: true }, notaArea);
  const btnNota = el("button", { class: "cap-accion cap-btn-nota", type: "button", "aria-expanded": "false",
    "aria-label": "Nota", title: "Nota", onclick: alternarNota }, icono("nota", 24));
  const pantallaRevision = el("section", { class: "cap-revision", "aria-label": "Foto sacada", hidden: true },
    miniaturas,
    estadoTexto,
    notaCaja,
    el("div", { class: "cap-acciones" },
      el("button", { class: "cap-accion", type: "button", "aria-label": "Otra foto de la misma comida",
        title: "Otra foto de la misma comida", onclick: () => abrirCamara("agregar") }, icono("mas", 26)),
      btnNota,
      el("button", { class: "cap-accion cap-listo", type: "button", "aria-label": "Listo",
        title: "Listo", onclick: () => terminar() }, icono("ok", 30)),
    ),
  );

  // tira de abajo
  const tiraCuenta = el("span", { class: "cap-cuenta", hidden: true });
  const tiraLista = el("div", { class: "cap-tira-lista" });
  const tira = el("section", { class: "cap-tira", "aria-label": "Lo de hoy" },
    tiraLista,
    tiraCuenta,
  );

  // hoja para anotar sin foto
  const hojaArea = el("textarea", { class: "entrada", rows: "4", maxlength: "1000",
    placeholder: "Qué comiste", "aria-label": "Qué comiste" });
  const hojaGuardar = el("button", { class: "btn btn-primario", type: "button", onclick: guardarTexto }, "Guardar");
  const hoja = el("div", { class: "cap-hoja-fondo", hidden: true, onclick: (e) => { if (e.target === hoja) cerrarHojaTexto(); } },
    el("div", { class: "cap-hoja", role: "dialog", "aria-modal": "true", "aria-label": "Anotar sin foto" },
      el("div", { class: "cap-hoja-cab" },
        el("button", { class: "btn-icono", type: "button", "aria-label": "Cerrar", onclick: cerrarHojaTexto }, icono("cerrar", 22)),
      ),
      hojaArea,
      el("div", { class: "cap-hoja-pie" },
        hojaGuardar,
      ),
    ),
  );

  // foto grande
  const visorImg = el("img", { alt: "" });
  const visor = el("div", { class: "cap-visor", hidden: true, role: "dialog", "aria-modal": "true",
    "aria-label": "Foto", onclick: cerrarVisor },
    visorImg,
    el("button", { class: "btn-icono cap-visor-cerrar", type: "button", "aria-label": "Cerrar" }, icono("cerrar", 24)),
  );

  contenedor.append(el("div", { class: "cap" },
    arriba,
    el("div", { class: "cap-centro" }, pantallaCamara, pantallaRevision),
    tira,
    inputCamara, inputGaleria, hoja, visor,
  ));

  // ------------------------------------------------------------ sesión

  function pintarSesion() {
    zonaConectar.replaceChildren();
    const st = datos.estado();
    if (!st.conectado && !st.demo) {
      zonaConectar.append(el("button", { class: "btn btn-primario btn-chico", type: "button",
        onclick: () => ctx.conectar() }, "Conectar"));
    }
  }

  // ------------------------------------------------------------ cámara y galería

  function abrirCamara(modo) {
    modoEntrada = modo;
    clearTimeout(temporizador);           // mientras está en la cámara no cuenta la inactividad
    inputCamara.click();
  }

  async function alElegir(input, desdeGaleria) {
    const archivos = [...(input.files || [])].filter((f) => !f.type || f.type.startsWith("image/"));
    input.value = "";
    if (!archivos.length) return;
    const agregar = modoEntrada === "agregar" && actual;
    modoEntrada = "nueva";
    // cámara: la hora del momento; galería: la fecha EXIF (o lastModified) de la primera foto
    let tomada = new Date();
    if (desdeGaleria) {
      const fechas = await Promise.all(archivos.map((f) => fechaDeArchivo(f)));
      tomada = new Date(Math.min(...fechas.map((d) => d.getTime())));
    }
    // aunque la vista ya no esté (se fue al panel), la foto se encola igual
    if (!agregar) {
      if (actual) guardarNota(actual, notaArea.value.trim());
      empezarCaptura(tomada);
    }
    tocar();
    const captura = actual;
    for (const archivo of archivos) {
      await procesarFoto(captura, archivo, isoConZona(tomada));
    }
    vaciarCola();
  }

  function empezarCaptura(fecha) {
    limpiarCaptura();
    actual = { grupo: nuevoGrupo(fecha), tomada: isoConZona(fecha), piezas: [], notaGuardada: "" };
    notaArea.value = "";
    notaCaja.hidden = true;
    btnNota.setAttribute("aria-expanded", "false");
    pantallaCamara.hidden = true;
    pantallaRevision.hidden = false;
  }

  function limpiarCaptura() {
    if (actual) for (const p of actual.piezas) soltarUrl(p.url);
    actual = null;
    porClave = new Map();
    miniaturas.replaceChildren();
  }

  async function procesarFoto(captura, archivo, tomada) {
    const pieza = { clave: null, url: null, estado: "preparando", nodo: null };
    pieza.nodo = el("div", { class: "cap-mini cargando-mini" });
    captura.piezas.push(pieza);
    miniaturas.append(pieza.nodo);
    pintarEstado();
    try {
      const blob = await comprimir(archivo);
      if (vivo) {
        pieza.url = urlDe(blob);
        pieza.nodo.replaceChildren(el("img", { src: pieza.url, alt: "Foto sacada" }), el("span", { class: "cap-mini-marca" }));
        pieza.nodo.classList.remove("cargando-mini");
      }
      pieza.estado = "en_cola";
      // va con la última nota guardada; si después cambia, guardarNota la actualiza en la cola
      pieza.clave = await cola.encolar({ tipo: "foto", blob, grupo: captura.grupo, tomada, nota: captura.notaGuardada });
      porClave.set(pieza.clave, pieza);
      pintarEstado();
      pintarCuenta();
    } catch (e) {
      pieza.estado = "fallo";
      pieza.nodo.remove();
      captura.piezas.splice(captura.piezas.indexOf(pieza), 1);
      if (captura === actual && !captura.piezas.length) terminar(false);
      else pintarEstado();
      error(e);
    }
  }

  function pintarEstado() {
    if (!actual) return;
    const estados = actual.piezas.map((p) => p.estado);
    for (const p of actual.piezas) {
      if (p.nodo) p.nodo.dataset.estado = p.estado;
    }
    let clave;
    if (estados.includes("preparando")) clave = "preparando";
    else if (estados.includes("subiendo")) clave = "subiendo";
    else if (estados.includes("error")) clave = "error";
    else if (estados.includes("en_cola")) clave = "en_cola";
    else clave = "subida";
    let texto = TEXTO_ESTADO[clave];
    if (clave === "en_cola") {
      if (!navigator.onLine) texto += " · sin señal";
      else if (!datos.estado().conectado) texto += " · falta conectar";
    }
    estadoTexto.textContent = texto;
    estadoTexto.dataset.estado = clave;
  }

  // ------------------------------------------------------------ nota

  function alternarNota() {
    tocar();
    const abrir = notaCaja.hidden;
    notaCaja.hidden = !abrir;
    btnNota.setAttribute("aria-expanded", String(abrir));
    if (abrir) notaArea.focus();
    else guardarNota();
  }

  /** Guarda la nota de una captura: en la cola y, si ya subió algo, en el Drive. */
  async function guardarNota(captura = actual, nota = notaArea.value.trim()) {
    if (!captura || nota === captura.notaGuardada) return;
    captura.notaGuardada = nota;
    try {
      await cola.actualizarNota(captura.grupo, nota);
      // las piezas que ya subieron necesitan cambiarNota en el Drive
      // (si alguna está subiendo justo ahora, la cola nota el cambio y lo manda después)
      const yaSubio = captura.piezas.some((p) => p.estado === "subida");
      if (!yaSubio) return;
      try {
        await datos.cambiarNota(captura.grupo, nota);
      } catch (e) {
        if (e && (e.codigo === "sin_conexion" || e.codigo === "sin_login")) {
          await cola.encolar({ tipo: "nota", grupo: captura.grupo, nota });
          pintarCuenta();
        } else {
          throw e;
        }
      }
    } catch (e) {
      error(e);
    }
  }

  // ------------------------------------------------------------ terminar e inactividad

  function tocar() {
    clearTimeout(temporizador);
    if (actual) temporizador = setTimeout(() => terminar(), INACTIVIDAD_MS);
  }

  function terminar(guardar = true) {
    clearTimeout(temporizador);
    temporizador = null;
    const captura = actual;
    const pendiente = guardar && captura ? guardarNota(captura, notaArea.value.trim()) : null;
    actual = null;
    porClave = new Map();
    miniaturas.replaceChildren();
    notaArea.value = "";
    notaCaja.hidden = true;
    btnNota.setAttribute("aria-expanded", "false");
    pantallaRevision.hidden = true;
    pantallaCamara.hidden = false;
    Promise.resolve(pendiente).finally(() => {
      if (captura) for (const p of captura.piezas) soltarUrl(p.url);
    });
    if (vivo) {
      btnCamara.focus({ preventScroll: true });
      refrescarTira();
    }
  }

  // ------------------------------------------------------------ texto sin foto

  function abrirHojaTexto() {
    hoja.hidden = false;
    hojaArea.value = "";
    hojaArea.focus();
  }

  function cerrarHojaTexto() {
    hoja.hidden = true;
    btnTexto.focus({ preventScroll: true });
  }

  async function guardarTexto() {
    const texto = hojaArea.value.trim();
    if (!texto) {
      hojaArea.focus();
      return;
    }
    hojaGuardar.disabled = true;
    try {
      const ahora = new Date();
      await cola.encolar({ tipo: "texto", texto, grupo: nuevoGrupo(ahora), tomada: isoConZona(ahora) });
      cerrarHojaTexto();
      const r = await vaciarCola();
      if (r && r.detenida) ctx.toast("Anotado, queda en cola", { tipo: "info" });
      else ctx.toast("Anotado", { tipo: "ok" });
    } catch (e) {
      error(e);
    } finally {
      hojaGuardar.disabled = false;
    }
  }

  // ------------------------------------------------------------ cola

  function alAvisoCola(ev) {
    const d = ev.detail || {};
    const pieza = porClave.get(d.clave);
    if (pieza) {
      if (d.evento === "subiendo") pieza.estado = "subiendo";
      else if (d.evento === "subida") pieza.estado = "subida";
      else if (d.evento === "en_cola") pieza.estado = "en_cola";
      else if (d.evento === "error") pieza.estado = "error";
      pintarEstado();
    }
    if (d.evento === "subida" || d.evento === "encolada") pintarCuenta();
  }

  async function vaciarCola() {
    try {
      const r = await cola.vaciar(datos);
      if (!vivo) return r;
      if (r.subidas > 0) {
        ctx.avisarCambio();
        refrescarTira();
      }
      pintarCuenta();
      if (r.error && !r.detenida) error(r.error);
      return r;
    } catch (e) {
      error(e);
      return null;
    }
  }

  // ------------------------------------------------------------ tira de hoy

  let turnoTira = 0;
  let urlsTira = [];

  async function pintarCuenta() {
    try {
      const n = await cola.contar();
      if (!vivo) return;
      tiraCuenta.hidden = n === 0;
      tiraCuenta.textContent = `${n} en cola`;
    } catch { /* sin cola legible: no mostramos el número */ }
  }

  function miniTira(contenido, { onclick, etiqueta, clase = "" } = {}) {
    return onclick
      ? el("button", { class: `cap-tira-item ${clase}`, type: "button", "aria-label": etiqueta, onclick }, contenido)
      : el("div", { class: `cap-tira-item ${clase}`, title: etiqueta }, contenido);
  }

  async function refrescarTira() {
    if (!vivo) return;
    const turno = ++turnoTira;
    const hoy = hoyISO();
    const items = [];
    const nuevasUrls = [];

    // lo que todavía está en la cola (de hoy)
    try {
      for (const i of await cola.listar()) {
        if (!i.tomada || i.tomada.slice(0, 10) !== hoy) continue;
        if (i.tipo === "foto") {
          const u = urlDe(new Blob([i.bytes], { type: i.mime || "image/jpeg" }));
          nuevasUrls.push(u);
          items.push(miniTira([el("img", { src: u, alt: "" }), el("span", { class: "cap-tira-reloj" }, icono("reloj", 14))],
            { etiqueta: `Foto en cola, ${horaDe(i.tomada)}`, clase: "en-cola", onclick: () => abrirVisor(u) }));
        } else if (i.tipo === "texto") {
          items.push(miniTira(el("span", { class: "cap-tira-texto" }, i.texto),
            { etiqueta: `En cola: ${i.texto}`, clase: "en-cola" }));
        }
      }
    } catch { /* la cola no se pudo leer: seguimos con lo subido */ }

    // lo que ya está en el Drive, pendiente de procesar
    if (datos.estado().conectado) {
      try {
        const grupos = (await datos.pendientes()).filter((g) => g.tomada && g.tomada.slice(0, 10) === hoy);
        if (turno !== turnoTira || !vivo) { nuevasUrls.forEach(soltarUrl); return; }
        for (const g of grupos.reverse()) {
          for (const p of g.piezas) {
            if (p.tipo === "foto") {
              const img = el("img", { alt: "", loading: "lazy" });
              datos.urlFoto(p.id).then((u) => { img.src = u; }).catch(() => img.classList.add("sin-foto"));
              items.push(miniTira(img, { etiqueta: `Foto de las ${horaDe(g.tomada)}`,
                onclick: () => img.src && abrirVisor(img.src) }));
            } else {
              items.push(miniTira(el("span", { class: "cap-tira-texto" }, g.nota || "texto"),
                { etiqueta: g.nota || "Anotación sin foto" }));
            }
          }
        }
      } catch (e) {
        if (!(e && (e.codigo === "sin_conexion" || e.codigo === "sin_login"))) error(e);
      }
    }

    if (turno !== turnoTira || !vivo) { nuevasUrls.forEach(soltarUrl); return; }
    urlsTira.forEach(soltarUrl);
    urlsTira = nuevasUrls;
    tiraLista.replaceChildren(...items);
    tira.classList.toggle("vacia", items.length === 0);
    pintarCuenta();
  }

  // ------------------------------------------------------------ visor

  function abrirVisor(src) {
    tocar();
    visorImg.src = src;
    visor.hidden = false;
  }

  function cerrarVisor() {
    visor.hidden = true;
    visorImg.removeAttribute("src");
  }

  // ------------------------------------------------------------ eventos

  inputCamara.addEventListener("change", () => alElegir(inputCamara, false).catch(error));
  inputGaleria.addEventListener("change", () => alElegir(inputGaleria, true).catch(error));
  notaArea.addEventListener("blur", () => guardarNota());
  for (const ev of ["pointerdown", "keydown", "input"]) escuchar(contenedor, ev, tocar, { passive: true });

  escuchar(window, "quecomo:cola", alAvisoCola);
  escuchar(window, "online", () => { if (actual) pintarEstado(); vaciarCola().then(refrescarTira); });
  escuchar(window, "offline", () => { if (actual) pintarEstado(); });
  escuchar(window, "quecomo:sesion", () => {
    pintarSesion();
    if (actual) pintarEstado();
    vaciarCola().then(refrescarTira);
  });
  escuchar(document, "visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    tocar();
    vaciarCola().then(refrescarTira);
  });
  escuchar(window, "focus", tocar);
  escuchar(document, "keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!visor.hidden) cerrarVisor();
    else if (!hoja.hidden) cerrarHojaTexto();
  });
  escuchar(hojaArea, "keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) guardarTexto();
  });

  // ------------------------------------------------------------ arranque

  pintarSesion();
  pintarCuenta();
  refrescarTira();
  vaciarCola();

  return () => {
    vivo = false;
    clearTimeout(temporizador);
    if (actual) guardarNota(actual, notaArea.value.trim());
    for (const fn of limpiezas) fn();
    for (const u of urlsPropias) URL.revokeObjectURL(u);
    urlsPropias.clear();
  };
}
