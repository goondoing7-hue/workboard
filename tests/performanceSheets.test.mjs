import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createPerformanceSheetsHandler } from "../server/performanceSheets.cjs";

const ORIGIN = "https://workboard.example";
const CLIENT = "1234567890-workboard.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const SHEET = "private_sheet_12345";
const ENV = { GOOGLE_CALENDAR_CLIENT_ID: CLIENT, GOOGLE_CALENDAR_CLIENT_SECRET: "test-only-client-secret",
  GOOGLE_CALENDAR_SESSION_KEY: Buffer.alloc(32, 9).toString("base64url"), GOOGLE_CALENDAR_ORIGINS: `${ORIGIN},http://localhost:3000` };
const columns = ["변경 ID", "복구 무결성 SHA256", "항목 ID", "항목 종류", "이전 변경 ID", "저장 시각", "활동일", "활동 종류", "사례번호", "횟수", "인원", "분", "센터 인정", "수퍼바이저 인정", "수행 상태", "완전복구 JSON"];
const event = (n = 1, patch = {}) => ({ id: `change-${n}`, entityId: `record-${n}`, entityType: "record", baseRevision: null, createdAt: "2026-09-23T01:00:00.000Z",
  payload: { date: "2026-09-23", caseId: "CASE-001", activity: "individual", sessions: 1, participants: 1, minutes: 50, status: "done", recognition: { center: { status: "approved" }, supervisor: { status: "pending" } } }, ...patch });
function fixture(options = {}) {
  let clock = Date.parse("2026-09-23T01:00:00.000Z");
  const state = { exists: options.exists !== false, rows: [columns], shared: false, marked: true, files: null, calls: [], fail: null, appendLost: false, appendMalformed: false, tokenCalls: 0 };
  const meta = () => ({ id: SHEET, name: "상담 실적 자동백업", mimeType: "application/vnd.google-apps.spreadsheet", appProperties: state.marked ? { workboardPerformance: "v1" } : {}, ownedByMe: true, shared: state.shared, trashed: false, capabilities: { canEdit: true }, webViewLink: `https://docs.google.com/spreadsheets/d/${SHEET}/edit` });
  const fetch = async (url, init) => {
    state.calls.push({ url, init });
    if (options.fetch) { const intercepted = await options.fetch(url, init, state); if (intercepted !== undefined) return intercepted; }
    if (state.fail?.(url, init)) return Response.json({ error: { message: "must not surface Google raw errors" } }, { status: 503 });
    if (url === "https://oauth2.googleapis.com/token") {
      state.tokenCalls++;
      return Response.json({ access_token: "test-only-access", refresh_token: "test-only-refresh", token_type: "Bearer", expires_in: 3600, scope: SCOPE });
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/drive/v3/files") return Response.json({ files: state.files || (state.exists ? [meta()] : []), incompleteSearch: false });
    if (parsed.pathname.startsWith("/drive/v3/files/")) {
      if (init.method === "PATCH") { state.marked = true; return Response.json({ id: SHEET }); }
      return state.exists ? Response.json(meta()) : Response.json({ error: {} }, { status: 404 });
    }
    if (parsed.pathname === "/v4/spreadsheets") {
      const body = JSON.parse(init.body); assert.equal(body.sheets[0].properties.title, "실적기록");
      state.rows = [body.sheets[0].data[0].rowData[0].values.map((cell) => cell.userEnteredValue.stringValue)]; state.exists = true; state.marked = false;
      return Response.json({ spreadsheetId: SHEET });
    }
    const range = decodeURIComponent(parsed.pathname.split("/values/")[1] || "").split("!")[1];
    if (range?.endsWith(":append")) {
      assert.equal(parsed.searchParams.get("valueInputOption"), "RAW"); assert.equal(parsed.searchParams.get("insertDataOption"), "INSERT_ROWS");
      const values = JSON.parse(init.body).values; state.rows.push(...structuredClone(values));
      if (state.appendLost) { state.appendLost = false; throw new Error("response lost after successful Google append"); }
      return Response.json({ updates: { updatedRows: values.length, updatedData: { values: state.appendMalformed ? [] : values } } });
    }
    if (range === "A2:B") return Response.json({ range: "'실적기록'!A2:B1000", majorDimension: "ROWS", values: state.rows.slice(1).map((row) => row.slice(0, 2)) });
    const match = range?.match(/^A(\d+):P(\d+)$/);
    if (match) return Response.json({ range: `'실적기록'!${range}`, majorDimension: "ROWS", values: state.rows.slice(Number(match[1]) - 1, Number(match[2])) });
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  const config = { ...ENV, ...options.env };
  const makeHandler = () => createPerformanceSheetsHandler({ env: config, fetch, now: () => clock, timeoutMs: 200 });
  return { state, config, handler: makeHandler(), makeHandler, advance: (ms) => { clock += ms; } };
}
async function request(handler, body, options = {}) {
  const method = options.method || "POST", req = Readable.from(body === undefined ? [] : [options.raw || JSON.stringify(body)]);
  req.method = method; req.url = options.url || (method === "GET" ? "/api/performance-sheets?action=status" : "/api/performance-sheets");
  req.headers = { host: new URL(options.origin || ORIGIN).host, origin: options.origin || ORIGIN, "sec-fetch-site": "same-origin", "x-workboard-performance": "1", "content-type": "application/json", ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers };
  if (Object.hasOwn(options, "body")) req.body = options.body;
  const res = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, writeHead(status, headers) { this.status = status; Object.entries(headers).forEach(([k, v]) => this.setHeader(k, v)); }, end(raw) { this.raw = raw; this.data = JSON.parse(raw); } };
  await handler(req, res);
  const set = res.headers["set-cookie"]; res.cookies = (Array.isArray(set) ? set : set ? [set] : []).map((value) => value.split(";")[0]);
  return res;
}
async function connect(f, options = {}) {
  const begin = await request(f.handler, { action: "connect", ...(options.password ? { password: options.password } : {}) });
  assert.equal(begin.status, 200, begin.raw);
  const response = await request(f.handler, { action: "exchange", code: "test-only-code", ...(options.sheetId ? { sheetId: options.sheetId } : {}) }, { cookie: begin.cookies.join("; ") });
  assert.equal(response.status, 200, response.raw);
  return response.cookies.find((value) => value.includes("_session="));
}
const append = (f, cookie, events, extra = {}) => request(f.handler, { action: "append", events, sheetId: SHEET, ...extra }, { cookie });
const read = (f, cookie, cursor = 0) => request(f.handler, undefined, { method: "GET", url: `/api/performance-sheets?action=events&cursor=${cursor}`, cookie });
const writes = (f) => f.state.calls.filter((call) => ["POST", "PATCH", "PUT", "DELETE"].includes(call.init.method) && !call.url.includes("oauth2.googleapis.com"));

test("status is explicit when unconfigured, revealing neither secrets nor tokens", async () => {
  const f = fixture({ env: { GOOGLE_CALENDAR_SESSION_KEY: "" } });
  const status = await request(f.handler, undefined, { method: "GET" });
  assert.equal(status.data.configured, false); assert.equal(status.data.connected, false);
  assert.doesNotMatch(status.raw, /test-only|refresh_token|client_secret/); assert.equal(f.state.calls.length, 0);
  assert.equal((await request(f.handler, { action: "connect" })).status, 503);
});

test("GIS popup code exchange reuses origin and stores only encrypted separate HttpOnly credentials", async () => {
  const f = fixture(), cookie = await connect(f);
  assert.match(cookie, /^__Host-wb_performance_session=v1\./); assert.doesNotMatch(cookie, /test-only/);
  const exchange = f.state.calls.find((call) => call.url.includes("oauth2.googleapis.com"));
  assert.equal(new URLSearchParams(exchange.init.body).get("redirect_uri"), ORIGIN);
  const status = await request(f.handler, undefined, { method: "GET", cookie });
  assert.equal(status.data.connected, true); assert.equal(status.data.sheet.id, SHEET); assert.doesNotMatch(status.raw, /test-only|refresh_token|client_secret/);
  const grant = await request(f.handler, { action: "connect" });
  assert.match(grant.headers["set-cookie"], /HttpOnly; SameSite=Lax;/); assert.match(grant.headers["set-cookie"], /; Secure$/);
  assert.equal((await request(f.handler, { action: "exchange", code: "x" })).data.error.code, "connect_required");
});

test("optional configured connection password is required, while unset installs use Google authentication", async () => {
  const f = fixture({ env: { WORKBOARD_CONNECTION_PASSWORD: "test-connection-password" } });
  assert.equal((await request(f.handler, undefined, { method: "GET" })).data.passwordRequired, true);
  for (const password of [undefined, "wrong", 1, "x".repeat(1025)]) assert.equal((await request(f.handler, { action: "connect", ...(password !== undefined ? { password } : {}) })).status, 403);
  await connect(f, { password: "test-connection-password" });
});

test("cross-origin, header bypasses, forged/tampered cookies and old grants fail closed", async () => {
  const f = fixture(), cookie = await connect(f);
  for (const headers of [{ origin: "https://evil.example" }, { host: "evil.example" }, { "x-workboard-performance": "0" }, { "sec-fetch-site": "cross-site" }]) {
    const before = f.state.calls.length;
    assert.equal((await request(f.handler, { action: "append", events: [event()] }, { cookie, headers })).status, 403); assert.equal(f.state.calls.length, before);
  }
  const noOrigin = await request(f.handler, undefined, { method: "GET", cookie, headers: { origin: undefined, referer: ORIGIN + "/performance.html" } });
  assert.equal(noOrigin.status, 200);
  assert.equal((await request(f.handler, undefined, { method: "GET", cookie, headers: { origin: undefined, referer: "https://evil.example/" } })).status, 403);
  for (const malformed of [cookie + "broken", `${cookie}; ${cookie}`, cookie.replace("performance_session", "calendar_session")]) assert.equal((await read(f, malformed)).status, 401);
  const grant = await request(f.handler, { action: "connect" }); f.advance(601000);
  assert.equal((await request(f.handler, { action: "exchange", code: "x" }, { cookie: grant.cookies.join("; ") })).status, 401);
});

test("new private backup is created with header before app marking; reconnect discovers and never recreates", async () => {
  const f = fixture({ exists: false }); await connect(f);
  assert.deepEqual(writes(f).map((call) => call.init.method), ["POST", "PATCH"]);
  assert.equal(f.state.rows.length, 1); await connect(f); assert.equal(writes(f).length, 2);
  assert.equal(writes(f).some((call) => call.url.includes("permissions")), false);
});

test("unreadable list, ambiguous backups, shared/unmarked sheets, or changed headers never trigger replacement", async () => {
  for (const alter of [
    (f) => { f.state.fail = (url) => new URL(url).pathname === "/drive/v3/files"; },
    (f) => { f.state.files = [{ id: SHEET }, { id: "another_sheet_123" }]; },
    (f) => { f.state.shared = true; },
    (f) => { f.state.marked = false; },
    (f) => { f.state.rows[0] = ["different", "header"]; },
  ]) {
    const f = fixture(); alter(f);
    const grant = await request(f.handler, { action: "connect" });
    const result = await request(f.handler, { action: "exchange", code: "x" }, { cookie: grant.cookies.join("; ") });
    assert.notEqual(result.status, 200); assert.equal(writes(f).length, 0); assert.equal(result.headers["set-cookie"], undefined);
  }
});

test("append stores readable columns and exact recovery payload as RAW without writing formulas", async () => {
  const f = fixture(), cookie = await connect(f), item = event();
  item.payload.caseId = "=IMPORTXML(\"https://example.invalid\",\"x\")";
  const result = await append(f, cookie, [item]);
  assert.equal(result.status, 200, result.raw); assert.deepEqual(result.data.acceptedIds, [item.id]);
  const row = f.state.rows[1]; assert.equal(row[7], "개인상담"); assert.equal(row[8], item.payload.caseId); assert.equal(row[11], 50); assert.equal(row[12], "인정 완료");
  assert.deepEqual(JSON.parse(row[15]), item);
  const restored = await read(f, cookie); assert.deepEqual(restored.data.events, [item]); assert.equal(restored.data.nextCursor, null);
});

test("lost append response retries the same ID without extra rows and rejects ID content collisions", async () => {
  const f = fixture(), cookie = await connect(f), item = event(); f.state.appendLost = true;
  assert.equal((await append(f, cookie, [item])).status, 503); assert.equal(f.state.rows.length, 2);
  assert.equal((await append(f, cookie, [item, item])).status, 200); assert.equal(f.state.rows.length, 2);
  const changed = { ...item, payload: { ...item.payload, minutes: 100 } };
  assert.equal((await append(f, cookie, [changed])).data.error.code, "event_id_conflict");
  assert.equal(f.state.rows.length, 2);
  assert.equal((await append(f, cookie, [event(2), { ...event(2), payload: { deleted: true } }])).status, 409);
  assert.equal(f.state.rows.length, 2);
});

test("concurrent identical rows restore as immutable events for client ID dedup; incompatible duplicate index blocks writes", async () => {
  const f = fixture(), cookie = await connect(f); await append(f, cookie, [event()]);
  f.state.rows.push(structuredClone(f.state.rows[1]));
  const list = await read(f, cookie); assert.equal(list.status, 200); assert.equal(list.data.events.length, 2);
  assert.equal((await append(f, cookie, [event()])).status, 200);
  f.state.rows[2][1] = "a".repeat(64);
  assert.equal((await append(f, cookie, [event(2)])).data.error.code, "event_id_conflict"); assert.equal(f.state.rows.length, 3);
});

test("read failures, missing sheets, wrong backup bindings and damaged payloads preserve remote records", async () => {
  const f = fixture(), cookie = await connect(f); await append(f, cookie, [event()]);
  const original = structuredClone(f.state.rows), count = writes(f).length;
  f.state.fail = (url) => url.includes("/values/");
  assert.equal((await append(f, cookie, [event(2)])).status, 503); assert.deepEqual(f.state.rows, original); assert.equal(writes(f).length, count);
  f.state.fail = null;
  assert.equal((await append(f, cookie, [event(2)], { sheetId: "another_sheet_id" })).data.error.code, "backup_changed");
  f.state.exists = false; assert.equal((await read(f, cookie)).data.error.code, "backup_missing"); assert.equal(writes(f).length, count);
  f.state.exists = true; f.state.rows[1][15] = "{}";
  assert.equal((await read(f, cookie)).data.error.code, "backup_damaged");
  assert.equal((await append(f, cookie, [event()])).data.error.code, "backup_damaged"); assert.equal(writes(f).length, count);
});

test("paged reads return 200 rows and an explicit final cursor without truncating the event log", async () => {
  const f = fixture(), cookie = await connect(f);
  for (let offset = 0; offset < 201; offset += 50) assert.equal((await append(f, cookie, Array.from({ length: Math.min(50, 201 - offset) }, (_, n) => event(offset + n)))).status, 200);
  const first = await read(f, cookie), last = await read(f, cookie, first.data.nextCursor);
  assert.equal(first.data.events.length, 200); assert.equal(first.data.nextCursor, 200); assert.equal(last.data.events.length, 1); assert.equal(last.data.nextCursor, null);
});

test("malformed or partial successful Google reads are never accepted as an empty/full backup", async () => {
  let mode = "normal";
  const f = fixture({ fetch: (url) => {
    if (mode === "empty-object" && url.includes("/values/")) return Response.json({});
    if (mode === "partial" && decodeURIComponent(url).includes("A2:P2")) return Response.json({ range: "'실적기록'!A2:P2", majorDimension: "ROWS", values: [] });
  } });
  const cookie = await connect(f); await append(f, cookie, [event()]); const count = writes(f).length;
  mode = "empty-object";
  assert.equal((await read(f, cookie)).data.error.code, "invalid_sheet_response");
  assert.equal((await append(f, cookie, [event(2)])).data.error.code, "invalid_sheet_response");
  mode = "partial";
  assert.equal((await read(f, cookie)).data.error.code, "incomplete_sheet_response");
  assert.equal(writes(f).length, count); assert.equal(f.state.rows.length, 2);
});

test("restart refreshes only server-side credentials; invalid grant requires reconnection without clearing the cookie", async () => {
  const f = fixture(), cookie = await connect(f); f.handler = f.makeHandler();
  assert.equal((await read(f, cookie)).status, 200); assert.equal(f.state.tokenCalls, 2);
  const refresh = f.state.calls.findLast((call) => call.url.includes("oauth2.googleapis.com"));
  assert.equal(new URLSearchParams(refresh.init.body).get("grant_type"), "refresh_token");
  const expired = fixture({ fetch: (url, init) => url.includes("oauth2.googleapis.com") && new URLSearchParams(init.body).get("grant_type") === "refresh_token" ? Response.json({ error: "invalid_grant" }, { status: 400 }) : undefined });
  const expiredCookie = await connect(expired); expired.handler = expired.makeHandler();
  const result = await read(expired, expiredCookie); assert.equal(result.status, 401); assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(writes(expired).length, 0);
});

test("broader OAuth scopes, malformed events, oversized bodies and arbitrary file URLs are rejected", async () => {
  const broad = fixture({ fetch: (url) => url.includes("oauth2.googleapis.com") ? Response.json({ access_token: "fake", refresh_token: "fake", expires_in: 3600, token_type: "Bearer", scope: SCOPE + " https://www.googleapis.com/auth/drive" }) : undefined });
  const grant = await request(broad.handler, { action: "connect" });
  assert.equal((await request(broad.handler, { action: "exchange", code: "x" }, { cookie: grant.cookies.join("; ") })).data.error.code, "scope_not_granted");
  assert.equal(writes(broad).length, 0);
  const f = fixture(), cookie = await connect(f);
  for (const bad of [event(1, { entityType: "other" }), event(1, { id: "../bad" }), event(1, { createdAt: "yesterday" }), event(1, { payload: [] }), event(1, { payload: { text: "x".repeat(16001) } }), event(1, { unexpected: true })]) assert.equal((await append(f, cookie, [bad])).status, 400);
  assert.equal((await append(f, cookie, [event()], { url: "https://evil.example" })).status, 400);
  assert.equal((await request(f.handler, { action: "append", events: [event()] }, { cookie, headers: { "content-length": "1000000" } })).status, 413);
  assert.equal((await request(f.handler, { action: "append" }, { cookie, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal(writes(f).length, 0);
});

test("disconnect clears only this feature's cookies and never deletes or unshares Google data", async () => {
  const f = fixture(), cookie = await connect(f); await append(f, cookie, [event()]); const count = writes(f).length;
  const response = await request(f.handler, { action: "disconnect" }, { cookie });
  assert.equal(response.status, 200); assert.equal(response.headers["set-cookie"].length, 2);
  assert(response.headers["set-cookie"].every((value) => value.includes("wb_performance_") && value.includes("Max-Age=0")));
  assert.equal(f.state.rows.length, 2); assert.equal(writes(f).length, count);
});
