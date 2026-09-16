// Ledgerly service worker: static app shell only. Invoice records live in
// local storage / the native file and are never requested over HTTP, so they
// can never end up in this cache. LEDGERLY_FRONTEND is stamped at bundle time.
const LEDGERLY_FRONTEND = 'dev'
const CACHE = `ledgerly-frontend-${LEDGERLY_FRONTEND}`
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('ledgerly-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname === '/sw.js') return
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => undefined)
        return response
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('/index.html'))),
  )
})
