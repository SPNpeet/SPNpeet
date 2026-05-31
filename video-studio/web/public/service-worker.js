// Minimal service worker — caches the app shell so the UI loads instantly
// on repeat visits even if the network is slow. Render jobs still hit the
// server live — we never cache /api/*.

const CACHE = "video-studio-shell-v1";
const SHELL = [
  "/",
  "/style.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API or render outputs
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/renders/")) {
    return;
  }

  // Cache-first for shell, network fallback
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).catch(() => hit))
  );
});
