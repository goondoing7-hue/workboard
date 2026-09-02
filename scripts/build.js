#!/usr/bin/env node
/* 업무보드 빌드 — src/app.jsx 와 Tailwind 결과를 dist/index.html 하나로 묶습니다 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const R = (...p) => path.join(__dirname, "..", ...p);
const dist = R("dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

console.log("· Tailwind 클래스 추출");
execSync(`npx tailwindcss -c ${R("tailwind.config.js")} -i ${R("src/in.css")} -o ${R(".tmp.css")} --minify`, { stdio: "inherit" });

/* 정의되지 않은 이름을 쓰고 있는지 먼저 확인합니다 */
console.log("· 코드 점검");
try {
  execSync(`npx esbuild ${R("src/app.jsx")} --bundle --format=iife --jsx=automatic --outfile=${R(".check.js")}`, { stdio: "pipe" });
  const code = fs.readFileSync(R(".check.js"), "utf8");
  fs.rmSync(R(".check.js"), { force: true });
  new Function(`return function(){ ${code} }`);   // 문법 확인
} catch (e) {
  console.error("✗ 코드에 문제가 있습니다:\n" + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}

console.log("· 자바스크립트 번들");
execSync(
  `npx esbuild ${R("src/app.jsx")} --bundle --minify --format=iife --jsx=automatic ` +
  `--define:process.env.NODE_ENV='"production"' --outfile=${R(".tmp.js")}`,
  { stdio: "inherit" }
);

const css = fs.readFileSync(R(".tmp.css"), "utf8");
const js = fs.readFileSync(R(".tmp.js"), "utf8");

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
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function(){}); });
}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dist, "index.html"), html);
for (const f of fs.readdirSync(R("public"))) fs.copyFileSync(R("public", f), path.join(dist, f));

fs.rmSync(R(".tmp.css"), { force: true });
fs.rmSync(R(".tmp.js"), { force: true });

console.log(`✓ dist/index.html (${Math.round(html.length / 1024)}KB) 생성 완료`);
