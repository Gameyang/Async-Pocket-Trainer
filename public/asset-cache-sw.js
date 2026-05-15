// Keep this aligned with the client game version so old asset caches can be dropped.
const CACHE_PREFIX = "apt-game-assets-";
const CACHE_VERSION = "2";
const CACHE_NAME = `${CACHE_PREFIX}v${CACHE_VERSION}`;
const CACHEABLE_PATH_PARTS = ["/assets/", "/src/resources/"];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();

      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || !shouldHandleRequest(request.url)) {
    return;
  }

  event.respondWith(readThroughAssetCache(request));
});

function shouldHandleRequest(requestUrl) {
  const url = new URL(requestUrl);

  return (
    url.origin === self.location.origin &&
    CACHEABLE_PATH_PARTS.some((pathPart) => url.pathname.includes(pathPart))
  );
}

async function readThroughAssetCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (response.ok) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Cache quota limits should not break normal resource loading.
    }
  }

  return response;
}
