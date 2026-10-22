// Service worker de Qué como: guarda el shell para que la página abra sin señal.
// Estrategia: primero la red (el código nuevo siempre gana si hay conexión) y, si no hay red,
// lo que quedó en caché. Solo pedidos GET del mismo origen: nunca toca la API de Google
// (googleapis.com, accounts.google.com, gstatic.com) ni otros orígenes.

const VERSION = "v2";
const CACHE = `quecomo-shell-${VERSION}`;
const ESPERA_RED_MS = 4000;   // con señal mala, a los 4 s se usa la caché (si la hay)

// rutas relativas al alcance del SW (la página vive en /que-como/)
const SHELL = [
  "./",
  "index.html",
  "config.js",
  "manifest.webmanifest",
  "css/base.css",
  "css/captura.css",
  "css/panel.css",
  "css/cuerpo.css",
  "js/app.js",
  "js/util.js",
  "js/rapido.js",
  "js/datos.js",
  "js/demo.js",
  "js/drive.js",
  "js/imagen.js",
  "js/cola.js",
  "js/calculos.js",
  "js/vistas/captura.js",
  "js/vistas/hoy.js",
  "js/vistas/semana.js",
  "js/vistas/comida.js",
  "js/vistas/peso.js",
  "js/vistas/perfil.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

const absoluta = (ruta) => new URL(ruta, self.registration.scope).href;

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // de a uno: si falta un archivo, el resto se guarda igual
    await Promise.all(SHELL.map(async (ruta) => {
      try {
        const res = await fetch(new Request(absoluta(ruta), { cache: "reload" }));
        if (res.ok) await cache.put(absoluta(ruta), res);
      } catch { /* sin red al instalar: se completa en el uso */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter((n) => n.startsWith("quecomo-") && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Google y cualquier otro: directo
  if (!url.href.startsWith(self.registration.scope)) return;
  ev.respondWith(primeroRed(req, ev));
});

async function deCache(req) {
  const cache = await caches.open(CACHE);
  const navegacion = req.mode === "navigate";
  return (await cache.match(req, { ignoreSearch: navegacion })) ||
    (navegacion ? (await cache.match(absoluta("index.html"))) || cache.match(absoluta("./")) : undefined);
}

async function primeroRed(req, ev) {
  const red = fetch(req).then(async (res) => {
    if (res.ok && res.type === "basic") {
      const copia = res.clone();
      ev.waitUntil(caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {}));
    }
    return res;
  });

  // carrera: la red, salvo que tarde demasiado y haya algo guardado
  let reloj;
  const lento = new Promise((res) => { reloj = setTimeout(res, ESPERA_RED_MS, "lento"); });
  try {
    const gana = await Promise.race([red, lento]);
    if (gana !== "lento") return gana;
    const guardada = await deCache(req);
    if (guardada) {
      ev.waitUntil(red.catch(() => {}));                  // que termine y actualice la caché
      return guardada;
    }
    return await red;
  } catch {
    const guardada = await deCache(req);
    if (guardada) return guardada;
    return new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } finally {
    clearTimeout(reloj);
  }
}
