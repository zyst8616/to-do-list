const CACHE_NAME = "two-person-todo-v5";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const APP_ORIGIN = new URL(self.registration.scope).origin;
const APP_SHELL = [
  SCOPE_PATH,
  `${SCOPE_PATH}manifest.webmanifest`,
  `${SCOPE_PATH}icons/icon.svg`,
  `${SCOPE_PATH}icons/icon-192.png`,
  `${SCOPE_PATH}icons/icon-512.png`,
  `${SCOPE_PATH}icons/maskable-512.png`,
  `${SCOPE_PATH}icons/apple-touch-icon.png`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== APP_ORIGIN) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(SCOPE_PATH)))
  );
});
