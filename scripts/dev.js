#!/usr/bin/env node
/* 별도 서버 패키지 없이 로컬 실행. 소스를 저장하면 재빌드하고 브라우저는 직접 새로고침합니다. */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
// Local secrets are server-only and are never passed to the browser bundle.
const localEnv = path.join(root, ".env.local");
if (fs.existsSync(localEnv)) process.loadEnvFile(localEnv);
const { handler: googleCalendarHandler } = require("../server/googleCalendar.cjs");
const { handler: googleCalendarAuthHandler } = require("../server/googleCalendarSession.cjs");
const { handler: performanceSheetsHandler } = require("../server/performanceSheets.cjs");
const preview = process.argv.includes("--preview");
const output = path.join(root, preview ? "dist" : ".dev");
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT는 1~65535 범위의 숫자여야 합니다.");
  process.exit(1);
}
const build = () => execFileSync(process.execPath, [path.join(__dirname, "build.js"), "--dev"], {
  cwd: root, stdio: "inherit",
});
if (preview) {
  if (!fs.existsSync(path.join(output, "index.html"))) {
    console.error("먼저 npm run build를 실행해 주세요.");
    process.exit(1);
  }
} else {
  build();
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (new URL(req.url, "http://localhost").pathname === "/api/performance-sheets") {
    performanceSheetsHandler(req, res);
    return;
  }
  if (new URL(req.url, "http://localhost").pathname === "/api/google-calendar-auth") {
    googleCalendarAuthHandler(req, res);
    return;
  }
  if (new URL(req.url, "http://localhost").pathname === "/api/google-calendar") {
    googleCalendarHandler(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let file;
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    file = path.resolve(output, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(output + path.sep) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  if (req.method === "HEAD") { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE"
    ? `포트 ${port}가 사용 중입니다. 실행 중인 업무보드를 종료하거나 PORT를 지정해 주세요.`
    : error.message);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`업무보드: http://localhost:${port}`);
  console.log(preview ? "배포 결과 미리보기 · 종료: Ctrl+C" : "소스 저장 후 재빌드됩니다. 브라우저를 새로고침해 주세요. 종료: Ctrl+C");
});

const watchers = [];
let timer;
if (!preview) {
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { build(); console.log("변경 반영 완료. 브라우저를 새로고침해 주세요."); }
      catch { console.error("빌드 실패. 오류를 수정하고 저장하면 다시 시도합니다."); }
    }, 200);
  };
  for (const directory of ["src", "public"]) {
    watchers.push(fs.watch(path.join(root, directory), { recursive: true }, schedule));
  }
  watchers.push(fs.watch(path.join(root, "tailwind.config.js"), schedule));
}
function stop() {
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  server.close(() => process.exit(0));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
