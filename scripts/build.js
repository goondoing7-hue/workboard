#!/usr/bin/env node
/* 업무보드 전체 빌드 또는 --performance-only 상담 실적 전용 빌드 */
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const R = (...p) => path.join(__dirname, "..", ...p);
const development = process.argv.includes("--dev");
const performanceOnly = process.argv.includes("--performance-only");
const dist = R(development ? ".dev" : "dist");
function publicOrigin(name, fallback) {
  const value = String(process.env[name] || fallback).trim();
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}에는 올바른 origin을 설정해 주세요.`); }
  if (value !== url.origin || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error(`${name}에는 경로 없는 HTTPS origin을 설정해 주세요. 로컬 개발 주소만 HTTP를 사용할 수 있습니다.`);
  }
  return url.origin;
}
const performanceOrigin = publicOrigin("PERFORMANCE_APP_ORIGIN", performanceOnly ? "https://counseling-performance.vercel.app" : "https://workboard-beta.vercel.app");
const workboardOrigin = publicOrigin("WORKBOARD_ORIGIN", "https://workboard-beta.vercel.app");
const browserDefines = {
  "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production"),
  __PERFORMANCE_APP_ORIGIN__: JSON.stringify(performanceOrigin),
  __WORKBOARD_ORIGIN__: JSON.stringify(workboardOrigin),
  __PERFORMANCE_STANDALONE__: JSON.stringify(performanceOnly),
};
const performanceUrl = new URL(performanceOnly ? "/" : "/performance.html", performanceOrigin).href;
const shareImageUrl = new URL("/performance-share-v1.png", performanceOrigin).href;

// A standalone deployment must not retain workboard HTML from an earlier full
// build. This is only the generated output directory immediately below root.
if (performanceOnly && fs.existsSync(dist)) {
  const resolved = path.resolve(dist), root = path.resolve(R());
  if (path.dirname(resolved) !== root || !["dist", ".dev"].includes(path.basename(resolved)) || fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error("전용 빌드 출력 경로를 확인해 주세요.");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

fs.mkdirSync(dist, { recursive: true });

let html;
if (!performanceOnly) {
console.log("· Tailwind 클래스 추출");
// 셸을 거치지 않아 한글·공백 경로와 Windows 인용부호에 영향을 받지 않습니다.
const cssFile = path.join(dist, ".build.css");
execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli.js"),
  "-c", R("tailwind.config.js"), "-i", R("src/in.css"), "-o", cssFile, "--minify"],
  { cwd: R(), stdio: "inherit" });

console.log("· 자바스크립트 번들");
let css, js;
try {
  const result = esbuild.buildSync({
    absWorkingDir: R(), entryPoints: [R("src/app.jsx")], bundle: true,
    minify: !development, format: "iife", jsx: "automatic", write: false,
    define: browserDefines,
  });
  css = fs.readFileSync(cssFile, "utf8");
  js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
} finally {
  fs.rmSync(cssFile, { force: true });
}

html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#EDEFEC" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="업무보드" />
<meta name="robots" content="noindex, nofollow" />
<link rel="manifest" href="manifest.webmanifest" />
<link rel="apple-touch-icon" href="icon-192.png" />
<link rel="icon" href="icon-192.png" />
<title>업무보드</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:#EDEFEC;-webkit-text-size-adjust:100%}
button{font:inherit;color:inherit}
input,textarea{font:inherit}
#root{min-height:100dvh}
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
<script>
if ("serviceWorker" in navigator) {
  // 로컬 개발에서는 이전 버전 캐시가 수정 사항을 가리지 않도록 합니다.
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (registration) {
        if (registration.scope === new URL("./", location.href).href) registration.unregister();
      });
    }).catch(function(){});
  } else {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function(){}); });
  }
}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dist, "index.html"), html);
// The assessment has its own entry point: opening it never mounts the workboard,
// reads client records, starts calendar sync, or persists assessment answers.
const assessment = esbuild.buildSync({
  absWorkingDir: R(), entryPoints: [R("src/adhd.jsx")], bundle: true,
  minify: !development, format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
});
const assessmentJs = assessment.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
fs.writeFileSync(path.join(dist, "adhd.html"), `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#24486b" />
<meta name="robots" content="noindex, nofollow" />
<meta name="description" content="만 18세 이상을 위한 한국어 ASRS v1.1 6문항 ADHD 자가 선별검사. 응답은 저장하거나 전송하지 않습니다." />
<title>성인 ADHD 자가 평가 · 마음 살피기</title>
<style>${fs.readFileSync(R("src/adhd.css"), "utf8")}</style></head>
<body><div id="root"></div><noscript>자가 평가를 진행하려면 브라우저에서 JavaScript를 허용해 주세요.</noscript><script>${assessmentJs}</script></body></html>`);
for (const f of fs.readdirSync(R("public"))) fs.copyFileSync(R("public", f), path.join(dist, f));
}

const performance = esbuild.buildSync({
  absWorkingDir: R(), entryPoints: [R("src/performance.jsx")], bundle: true,
  minify: !development, format: "iife", jsx: "automatic", write: false,
  define: browserDefines,
});
const performanceJs = performance.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const performanceCss = ["performance.css", "performanceMilitary.css", "performanceApprovals.css", "performanceSchedule.css"].map(file => fs.readFileSync(R("src", file), "utf8")).join("\n");
const performanceHtml = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#122a4a" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
<meta name="description" content="상담 기록부터 학회별 승인 현황, 수련 일정까지 한곳에서 관리하세요." />
<title>상담 실적 관리</title>
<link rel="canonical" href="${performanceUrl}" />
<link rel="icon" type="image/png" sizes="32x32" href="/performance-icon-32.png" />
<link rel="icon" type="image/svg+xml" sizes="any" href="/performance-icon.svg" />
<link rel="apple-touch-icon" sizes="192x192" href="/performance-icon-192.png" />
${performanceOnly ? '<link rel="manifest" href="/manifest.webmanifest" />' : ''}
<meta property="og:type" content="website" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:site_name" content="상담실적관리" />
<meta property="og:title" content="상담 실적 관리" />
<meta property="og:description" content="상담 기록부터 학회별 승인 현황, 수련 일정까지 한곳에서 관리하세요." />
<meta property="og:url" content="${performanceUrl}" />
<meta property="og:image" content="${shareImageUrl}" />
<meta property="og:image:secure_url" content="${shareImageUrl}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="상담 실적 관리 — 상담 기록, 학회별 승인 현황, 수련 일정" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="상담 실적 관리" />
<meta name="twitter:description" content="상담 기록부터 학회별 승인 현황, 수련 일정까지 한곳에서 관리하세요." />
<meta name="twitter:image" content="${shareImageUrl}" />
<meta name="twitter:image:alt" content="상담 실적 관리 — 상담 기록, 학회별 승인 현황, 수련 일정" />
<style>${performanceCss}</style></head>
<body><div id="root"></div><noscript>실적을 관리하려면 JavaScript를 허용해 주세요.</noscript><script>${performanceJs}</script><script>
if ('serviceWorker' in navigator && !['localhost','127.0.0.1'].includes(location.hostname)) window.addEventListener('load', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
</script></body></html>`;
fs.writeFileSync(path.join(dist, "performance.html"), performanceHtml);

if (performanceOnly) {
  const assets = ["performance-icon.svg", "performance-icon-32.png", "performance-icon-192.png", "performance-share-v1.png"];
  for (const file of assets) fs.copyFileSync(R("public", file), path.join(dist, file));
  fs.writeFileSync(path.join(dist, "index.html"), performanceHtml);
  fs.writeFileSync(path.join(dist, "manifest.webmanifest"), JSON.stringify({
    id: "/", name: "상담 실적 관리", short_name: "상담실적", lang: "ko", start_url: "/", scope: "/", display: "standalone", background_color: "#f3f6fa", theme_color: "#122a4a",
    icons: [{ src: "/performance-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/performance-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  }, null, 2));
  const fingerprint = createHash("sha256").update(performanceHtml);
  for (const file of assets) fingerprint.update(fs.readFileSync(R("public", file)));
  const cacheName = "counseling-performance-" + fingerprint.digest("hex").slice(0, 16);
  // This worker only knows the dedicated app, so offline navigation cannot
  // accidentally show the workboard or cache Google/API responses.
  fs.writeFileSync(path.join(dist, "sw.js"), `/* 상담 실적 관리 전용 오프라인 캐시 */
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ["/", "/index.html", "/performance.html", "/manifest.webmanifest", "/performance-icon.svg", "/performance-icon-32.png", "/performance-icon-192.png"];
const ASSET_URLS = new Set(ASSETS.map(asset => new URL(asset, self.location.href).href));
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(asset => new Request(asset, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("counseling-performance-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    if (!["/", "/index.html", "/performance.html"].includes(url.pathname)) return;
    event.respondWith((async () => {
      const cached = async () => await caches.match(event.request) || await caches.match("/index.html");
      let response;
      try { response = await fetch(event.request, { cache: "no-cache" }); }
      catch { return await cached() || Response.error(); }
      if (response.status >= 500) { const saved = await cached(); if (saved) return saved; }
      if (response.ok && response.type === "basic") { const copy = response.clone(); await caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}); }
      return response;
    })());
    return;
  }
  if (!ASSET_URLS.has(url.href)) return;
  const network = fetch(event.request).then(async response => {
    if (response.ok && response.type === "basic") { const copy = response.clone(); await caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}); }
    return response;
  }).catch(() => null);
  event.waitUntil(network.then(() => {}));
  event.respondWith(caches.match(event.request).then(async cached => cached || await network || Response.error()));
});
`);
  console.log(`✓ ${path.basename(dist)}/index.html · performance.html · 실적 전용 아이콘/공유 이미지/manifest/service worker 생성 완료`);
} else {

console.log(`✓ ${path.basename(dist)}/index.html (${Math.round(Buffer.byteLength(html) / 1024)}KB) 생성 완료`);
console.log(`✓ ${path.basename(dist)}/adhd.html 생성 완료`);
console.log(`✓ ${path.basename(dist)}/performance.html 생성 완료`);
}
