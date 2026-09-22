#!/usr/bin/env node
/* 업무보드 빌드 — src/app.jsx 와 Tailwind 결과를 dist/index.html 하나로 묶습니다 */
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const R = (...p) => path.join(__dirname, "..", ...p);
const development = process.argv.includes("--dev");
const dist = R(development ? ".dev" : "dist");

fs.mkdirSync(dist, { recursive: true });

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
    define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
  });
  css = fs.readFileSync(cssFile, "utf8");
  js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
} finally {
  fs.rmSync(cssFile, { force: true });
}

const html = `<!DOCTYPE html>
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

const performance = esbuild.buildSync({
  absWorkingDir: R(), entryPoints: [R("src/performance.jsx")], bundle: true,
  minify: !development, format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
});
const performanceJs = performance.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
fs.writeFileSync(path.join(dist, "performance.html"), `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#122a4a" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
<title>상담 실적 관리</title>
<link rel="icon" href="icon-192.png" />
<style>${fs.readFileSync(R("src/performance.css"), "utf8")}\n${fs.readFileSync(R("src/performanceMilitary.css"), "utf8")}</style></head>
<body><div id="root"></div><noscript>실적을 관리하려면 JavaScript를 허용해 주세요.</noscript><script>${performanceJs}</script><script>
if ('serviceWorker' in navigator && !['localhost','127.0.0.1'].includes(location.hostname)) window.addEventListener('load', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
</script></body></html>`);

console.log(`✓ ${path.basename(dist)}/index.html (${Math.round(Buffer.byteLength(html) / 1024)}KB) 생성 완료`);
console.log(`✓ ${path.basename(dist)}/adhd.html 생성 완료`);
console.log(`✓ ${path.basename(dist)}/performance.html 생성 완료`);
