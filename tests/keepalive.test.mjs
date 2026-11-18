import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createKeepaliveHandler } = require("../server/keepalive.cjs");

const ENV = { SUPABASE_URL: "https://oxaeecawijnetwmvggjs.supabase.co", SUPABASE_ANON_KEY: "a".repeat(40) };

function fakeResponse() {
  const out = { status: 0, headers: {}, body: null };
  return {
    out,
    set statusCode(v) { out.status = v; },
    get statusCode() { return out.status; },
    setHeader(k, v) { out.headers[k] = v; },
    end(body) { out.body = JSON.parse(body); },
  };
}

const run = async (opts) => {
  const res = fakeResponse();
  await createKeepaliveHandler(opts)({}, res);
  return res.out;
};

test("깨우기가 성공하면 ok를 돌려준다", async () => {
  const calls = [];
  const out = await run({
    env: ENV, now: () => 1000,
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/boards\?select=id&limit=1$/);
  assert.equal(calls[0].init.method, "HEAD", "자료를 읽어 오지 않습니다");
  assert.equal(calls[0].init.headers.apikey, ENV.SUPABASE_ANON_KEY);
  assert.equal(calls[0].init.credentials, "omit");
});

test("환경변수가 없으면 아무 데도 요청하지 않는다", async () => {
  let called = false;
  for (const env of [{}, { SUPABASE_URL: "https://x.supabase.co" }, { ...ENV, SUPABASE_ANON_KEY: "짧음" },
                     { ...ENV, SUPABASE_URL: "http://evil.example.com" }]) {
    const out = await run({ env, fetch: async () => { called = true; return { ok: true, status: 200 }; } });
    assert.equal(out.status, 503);
    assert.equal(out.body.reason, "not_configured");
  }
  assert.equal(called, false, "설정이 없으면 바깥으로 나가지 않습니다");
});

test("supabase.co 가 아닌 주소는 거부한다", async () => {
  const out = await run({ env: { ...ENV, SUPABASE_URL: "https://supabase.co.evil.net" },
    fetch: async () => { throw new Error("불려서는 안 됩니다"); } });
  assert.equal(out.status, 503);
});

test("응답이 실패여도 조용히 넘기지 않는다", async () => {
  const out = await run({ env: ENV, now: () => 0, fetch: async () => ({ ok: false, status: 401 }) });
  assert.equal(out.status, 502);
  assert.equal(out.body.ok, false);
  assert.equal(out.body.status, 401);
});

test("연결이 안 되면 504로 알린다", async () => {
  const out = await run({ env: ENV, fetch: async () => { throw new Error("timeout"); } });
  assert.equal(out.status, 504);
  assert.equal(out.body.reason, "unreachable");
});

test("응답을 캐시하지 않는다", async () => {
  const res = fakeResponse();
  await createKeepaliveHandler({ env: ENV, now: () => 0, fetch: async () => ({ ok: true, status: 200 }) })({}, res);
  assert.equal(res.out.headers["Cache-Control"], "no-store");
});

test("끝에 슬래시가 붙은 주소도 받아 준다", async () => {
  let seen = "";
  await run({ env: { ...ENV, SUPABASE_URL: ENV.SUPABASE_URL + "/" }, now: () => 0,
    fetch: async (url) => { seen = url; return { ok: true, status: 200 }; } });
  assert.ok(!seen.includes(".co//"), seen);
});
