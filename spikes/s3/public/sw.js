const cacheName = 'psg-spike-s3-v1';
const precacheUrls = ['/', '/index.html'];

globalThis.addEventListener('install', (event) => {
	event.waitUntil(
		globalThis.caches
			.open(cacheName)
			.then((cache) => cache.addAll(precacheUrls))
			.then(() => globalThis.skipWaiting()),
	);
});

globalThis.addEventListener('activate', (event) => {
	event.waitUntil(globalThis.clients.claim());
});

globalThis.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') {
		return;
	}

	event.respondWith(
		globalThis.caches.match(event.request).then(
			(cached) =>
				cached ||
				fetch(event.request).then((response) => {
					const clone = response.clone();
					void globalThis.caches
						.open(cacheName)
						.then((cache) => cache.put(event.request, clone));
					return response;
				}),
		),
	);
});
