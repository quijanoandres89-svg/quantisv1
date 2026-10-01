/* ============================================================
   SERVICE WORKER — mejora "instalable como PWA".
   ------------------------------------------------------------
   Estrategia: stale-while-revalidate sobre el "app shell" (HTML,
   CSS, JS, íconos) — sirve de caché al instante y actualiza en
   segundo plano. Solo intercepta pedidos GET del MISMO origen:
   Supabase (auth, datos, Storage) y el widget de TradingView viven
   en otros orígenes y nunca pasan por acá, así que los datos
   siempre van a la red real. Esto permite que la interfaz cargue
   rápido y se pueda VER lo último ya sincronizado sin conexión —
   escribir trades/journals/EOD sin conexión queda fuera de alcance
   (Supabase es la fuente de verdad, no hay cola de sincronización
   offline todavía).
   Subir CACHE_NAME en futuras versiones si el app shell cambia de
   forma importante, para forzar a los navegadores a limpiar la
   caché vieja.
   ============================================================ */

const CACHE_NAME = "quantis-shell-v1";
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
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
