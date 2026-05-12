// ── Version (automatisch durch CI injiziert) ─────────────────────────────────
// Beim manuellen Testen lokal diese Zeile auf eine neue Zahl setzen,
// z. B. '2025-local'. Im Live-Build ersetzt GitHub Actions den Platzhalter.
const VERSION    = '__CACHE_VERSION__';
const CACHE_NAME = `wetterapp-${VERSION}`;

// Nur lokale Dateien – externe CDN-URLs werden beim ersten Abruf automatisch
// durch den Fetch-Handler gecacht und verursachen kein atomares addAll-Fehlschlag.
const URLS_TO_CACHE = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json'
];

// Install – neue Assets in neuen Cache legen, sofort aktivieren
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(URLS_TO_CACHE).catch(err => {
                console.warn('[SW] Cache.addAll partial failure:', err);
                return cache.add('/index.html').catch(() => {});
            }))
            .then(() => self.skipWaiting())   // nicht auf Tab-Schließen warten
    );
});

// Activate – alte Caches löschen, sofort Kontrolle übernehmen
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.map((n) => n !== CACHE_NAME && caches.delete(n))
            ))
            .then(() => self.clients.claim())   // alle offenen Tabs übernehmen
            .then(() => {
                // Allen offenen Fenstern Bescheid geben → Seite neu laden
                self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                    .then((clients) => clients.forEach((c) =>
                        c.postMessage({ type: 'SW_UPDATED', version: VERSION })
                    ));
            })
    );
});

// Fetch – Netzwerk zuerst für API-Calls, Cache-First für statische Dateien
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // Wetter-API + Radar: Netzwerk zuerst, Cache als Fallback
    if (event.request.url.includes('api.open-meteo.com') ||
        event.request.url.includes('rainviewer.com')) {
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    if (res.ok) {
                        // clone() MUSS vor return res aufgerufen werden –
                        // danach ist der Body bereits konsumiert.
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
                    }
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Statische Assets: Cache zuerst, Netzwerk als Fallback
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((res) => {
                if (!res || res.status !== 200 || res.type === 'error') return res;
                const clone = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(() => {});
                return res;
            }).catch(() => new Response('Offline', { status: 503 }));
        })
    );
});
