/* ============================================================
   Service worker de index.html
   - Precache del shell → la app abre sin señal.
   - CDN (Firebase SDK, html5-qrcode, fuentes) → cache-first con revalidación.
   - Google Sheets (catálogo) → stale-while-revalidate.
   - Firebase Realtime Database / Auth → NO se interceptan: el SDK maneja su
     propia cola offline y cachear sus respuestas rompe la sincronización.

   Al cambiar el HTML, subí CACHE_VERSION para invalidar la caché vieja.
   ============================================================ */

const CACHE_VERSION = 'inv-v2';
const CACHE_SHELL   = CACHE_VERSION + '-shell';
const CACHE_CDN     = CACHE_VERSION + '-cdn';
const CACHE_DATA    = CACHE_VERSION + '-data';

// Recursos propios que se precachean en la instalación.
const APP_SHELL = [
  './',
  './index.html',
  './config.js'
];

// Hosts que nunca se interceptan (tiempo real / autenticación).
const PASSTHROUGH_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebase.googleapis.com'
];

// CDN de librerías y fuentes.
const CDN_HOSTS = [
  'www.gstatic.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// ---------- install ----------
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_SHELL);
    // addAll falla entero si un recurso falla; los agregamos de a uno para que
    // un 404 en config.js no deje la app sin caché.
    await Promise.all(APP_SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(err =>
        console.warn('[sw] no se pudo precachear', url, err))
    ));
    self.skipWaiting();
  })());
});

// ---------- activate ----------
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ---------- estrategias ----------
async function staleWhileRevalidate(request, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached){
    network; // revalidación en segundo plano
    return cached;
  }
  const res = await network;
  if (res) return res;
  throw new Error('sin red y sin caché para ' + request.url);
}

async function networkFirst(request, cacheName, fallbackUrl){
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err){
    const cached = await cache.match(request) || (fallbackUrl ? await cache.match(fallbackUrl) : null);
    if (cached) return cached;
    throw err;
  }
}

// ---------- fetch ----------
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch(_){ return; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (PASSTHROUGH_HOSTS.some(h => url.hostname.endsWith(h))) return;

  // Navegación (abrir la app): red primero, shell cacheado como respaldo.
  if (req.mode === 'navigate'){
    event.respondWith(networkFirst(req, CACHE_SHELL, './index.html'));
    return;
  }

  // Catálogo de Google Sheets: mostrar lo último conocido y refrescar detrás.
  if (url.hostname === 'sheets.googleapis.com'){
    event.respondWith(staleWhileRevalidate(req, CACHE_DATA));
    return;
  }

  // Librerías y fuentes: cambian poco, sirven desde caché.
  if (CDN_HOSTS.includes(url.hostname)){
    event.respondWith(staleWhileRevalidate(req, CACHE_CDN));
    return;
  }

  // Recursos propios.
  if (url.origin === self.location.origin){
    event.respondWith(staleWhileRevalidate(req, CACHE_SHELL));
  }
});

// Permite forzar la actualización desde la página: postMessage({type:'SKIP_WAITING'})
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
