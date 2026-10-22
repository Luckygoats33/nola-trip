/* Offline: keep both app versions and their libraries; map tiles and live data are not cached. */
const CACHE = "nola-hub-v12";
const SHELL = ["./", "index.html", "v1/", "v1/index.html", "v2/", "v2/index.html", "v3/", "v3/index.html", "v3/auth.js", "v3/places.js", "v3/config.js", "manifest.webmanifest", "icon.svg",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || /tile\.openstreetmap\.org|nominatim|open-meteo|photon\.komoot|supabase\.co/.test(u.host)) return;
  if (e.request.mode === "navigate") {
    const key = u.origin + u.pathname;
    e.respondWith(fetch(e.request, {cache: "no-cache"}).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); return r; }).catch(() => caches.match(key).then(hit => hit || caches.match(u.pathname.includes("/v3") ? "v3/index.html" : u.pathname.includes("/v1") ? "v1/index.html" : "v2/index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok && (u.origin === location.origin || /cdnjs|cdn\.jsdelivr|fonts\.(googleapis|gstatic)/.test(u.host))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })));
});
