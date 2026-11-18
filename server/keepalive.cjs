"use strict";

/* Supabase 깨우기
   무료 요금제는 이레 동안 데이터베이스 활동이 적으면 프로젝트를 멈춰 세웁니다.
   멈추면 기기 사이 동기화가 끊기고, 대시보드에서 손으로 되살려야 합니다.
   하루 한 번 가벼운 조회를 보내 활동을 남겨 두면 멈추지 않습니다.

   키는 소스에 넣지 않습니다. Vercel 환경변수로 받습니다.
   여기 쓰는 키는 앱이 브라우저에서 쓰는 것과 같은 공개용(anon) 키입니다. */

const TIMEOUT_MS = 10000;

function createKeepaliveHandler({ env = process.env, fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return async function keepalive(request, response) {
    const send = (status, body) => {
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify(body));
    };

    const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
    const key = String(env.SUPABASE_ANON_KEY || "");
    if (!/^https:\/\/[\w-]+\.supabase\.co$/.test(url) || key.length < 20) {
      send(503, { ok: false, reason: "not_configured" });
      return;
    }

    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      /* 한 줄만, 내용 없이 세어 봅니다. 자료는 읽지도 바꾸지도 않습니다. */
      const hit = await fetchImpl(url + "/rest/v1/boards?select=id&limit=1", {
        method: "HEAD",
        headers: { apikey: key, Authorization: "Bearer " + key },
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      send(hit.ok ? 200 : 502, { ok: !!hit.ok, status: hit.status, ms: now() - started });
    } catch (error) {
      send(504, { ok: false, reason: "unreachable" });
    } finally {
      clearTimeout(timer);
    }
  };
}

const handler = createKeepaliveHandler();
module.exports = { handler, createKeepaliveHandler };
