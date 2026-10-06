/* ============================================================
   SERVICE WORKER — mejora "instalable como PWA".
   ------------------------------------------------------------
   Estrategia: RED PRIMERO, caché solo como respaldo si no hay
   conexión. Antes era "caché primero" (stale-while-revalidate),
   que servía el HTML/JS viejo guardado de una visita anterior
   mientras actualizaba en segundo plano — con Quantis cambiando
   seguido, eso significaba que un cambio recién subido podía no
   verse ni con hard refresh, porque el service worker ya había
   contestado con lo viejo antes de que la red respondiera. Con red
   primero, siempre se pide la versión actual; el caché solo entra
   si el fetch falla (sin conexión), que es el único caso real que
   nos interesa cubrir. Solo intercepta pedidos GET del MISMO
   origen: Supabase y el widget de TradingView viven en otros
   orígenes y nunca pasan por acá.
   Subir CACHE_NAME en futuras versiones si el app shell cambia de
   forma importante, para forzar a los navegadores a limpiar la
   caché vieja.
   ============================================================ */

const CACHE_NAME = "quantis-shell-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}), // si falla el precache, el fetch handler igual cachea sobre la marcha
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return; // deja pasar Supabase, TradingView, fuentes externas, etc. directo a la red
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
