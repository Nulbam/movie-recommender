/**
 * AI 영화 큐레이터 - PWA 서비스 워커 (Service Worker)
 */

const CACHE_NAME = "movie-curator-cache-v1";
const STATIC_ASSETS = [
    "/",
    "/static/css/style.css",
    "/static/js/app.js",
    "/static/manifest.json",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png"
];

// 1. 서비스 워커 설치: 정적 에셋 사전 캐싱
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// 2. 활성화: 이전 버전의 캐시 정리
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. 네트워크 요청 가로채기 (Fetch)
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // API 추천 호출(/recommend)은 캐시하지 않고 항상 네트워크로 통신
    if (url.pathname.startsWith("/recommend")) {
        event.respondWith(fetch(event.request));
        return;
    }

    // 정적 에셋: 네트워크 우선(최신 상태 유지), 실패 시 캐시 반환
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && event.request.method === "GET") {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (event.request.mode === "navigate") {
                        return caches.match("/");
                    }
                });
            })
    );
});
