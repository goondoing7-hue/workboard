/* 업무보드 — 오프라인 캐시 */
const CACHE = "workboard-v7";
const ASSETS = ["./", "./index.html", "./adhd.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const ASSET_URLS = new Set(ASSETS.map((asset) => new URL(asset, self.location.href).href));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((asset) => new Request(asset, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("workboard-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 다음 접속에는 최신 화면을 받고, 연결할 수 없을 때 저장된 화면을 엽니다.
   이미 열어 작성 중인 화면은 강제로 새로고침하지 않습니다. */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // OAuth·외부 요청과 상담 API 응답은 서비스 워커가 관리하지 않습니다.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/.netlify/functions/")) return;

  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      // An assessment navigation must never fall back to the workboard, even
      // with query parameters or an unavailable assessment cache entry.
      const isAssessment = url.pathname === new URL("./adhd.html", self.location.href).pathname;
      const fallback = isAssessment ? "./adhd.html" : "./index.html";
      const cachedPage = async () => await caches.match(e.request) || await caches.match(fallback);
      let response;
      try { response = await fetch(e.request, { cache: "no-cache" }); }
      catch {
        return await cachedPage() || Response.error();
      }
      if (response.status >= 500) {
        const saved = await cachedPage();
        if (saved) return saved;
      }
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        await caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return response;
    })());
    return;
  }

  // 정적 앱 파일만 캐시합니다. 그 밖의 요청은 브라우저에 맡깁니다.
  if (!ASSET_URLS.has(url.href)) return;
  const net = fetch(e.request).then(async (res) => {
    if (res && res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      await caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
    }
    return res;
  }).catch(() => null);
  e.waitUntil(net.then(() => {}));
  e.respondWith(caches.match(e.request).then(async (hit) => hit || await net || Response.error()));
});
