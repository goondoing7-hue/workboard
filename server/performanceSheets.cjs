"use strict";

// Only this app's private, owned spreadsheets are reachable. Tokens remain in
// an authenticated HttpOnly cookie or this process's short-lived memory cache.
const { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const MARKER = "workboardPerformance";
const TAB = "실적기록";
const PAGE_SIZE = 200;
const SESSION_AGE = 180 * 86400;
const BODY_LIMIT = 900 * 1024;
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const AAD = Buffer.from("workboard:performance:cookie:v1");
const FILE_FIELDS = "id,name,mimeType,appProperties,ownedByMe,shared,trashed,webViewLink,capabilities(canEdit)";
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const COLUMNS = ["변경 ID", "복구 무결성 SHA256", "항목 ID", "항목 종류", "이전 변경 ID", "저장 시각", "활동일", "활동 종류", "사례번호", "횟수", "인원", "분", "센터 인정", "수퍼바이저 인정", "수행 상태", "완전복구 JSON"];
const ACTIVITIES = { intake: "접수면접", individual: "개인상담", test: "검사실시", interpretation: "해석상담", group: "집단상담", supervision: "슈퍼비전" };
const STATES = { done: "진행 완료", planned: "예정", cancelled: "취소", pending: "미확인", requested: "확인 요청", approved: "인정 완료" };
class BackupError extends Error {
  constructor(status, code, message, retryable = false) { super(message); Object.assign(this, { status, code, retryable }); }
}
const fail = (...args) => { throw new BackupError(...args); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const keys = (v, required, optional = []) => object(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const credential = (v, max = 4096) => typeof v === "string" && v.length > 0 && v.length <= max && /^[\x21-\x7e]+$/.test(v);
const id = (v) => typeof v === "string" && /^[a-zA-Z0-9_-][a-zA-Z0-9_.:-]{0,159}$/.test(v);
const fileId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{8,180}$/.test(v);
const digest = (v) => createHash("sha256").update(v).digest("hex");
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : object(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);

function settings(env) {
  const clientId = String(env.GOOGLE_CALENDAR_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  const encoded = String(env.GOOGLE_CALENDAR_SESSION_KEY || "").trim();
  const key = /^[A-Za-z0-9_-]{43}$/.test(encoded) ? Buffer.from(encoded, "base64url") : null;
  const origins = new Set(); let invalid = false;
  for (const raw of String(env.GOOGLE_CALENDAR_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean)) {
    try {
      const u = new URL(raw);
      if (raw !== u.origin || (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))) invalid = true;
      else origins.add(raw);
    } catch { invalid = true; }
  }
  const password = String(env.PERFORMANCE_CONNECTION_PASSWORD || env.WORKBOARD_CONNECTION_PASSWORD || "");
  return { clientId, clientSecret, key, origins, password,
    configured: /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) && credential(clientSecret) && key?.length === 32 && key.toString("base64url") === encoded && origins.size > 0 && !invalid };
}

function requestOrigin(req, config) {
  let origin = req.headers?.origin;
  // Fetch GET commonly omits Origin. Referer supplies the same-origin evidence;
  // Sec-Fetch-Site is additionally checked when browsers send it.
  if (!origin && req.method === "GET") {
    try { origin = new URL(req.headers?.referer).origin; } catch { /* fail closed */ }
  }
  if (typeof origin !== "string" || !config.origins.has(origin) || new URL(origin).host !== String(req.headers?.host || "").toLowerCase()
    || req.headers?.["x-workboard-performance"] !== "1" || (req.headers?.["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
    fail(403, "invalid_origin", "현재 실적 관리 화면에서 다시 시도해 주세요.");
  }
  return origin;
}
const cookieName = (origin, kind) => `${origin.startsWith("https:") ? "__Host-" : ""}wb_performance_${kind}`;
function cookie(origin, kind, value, now, age) {
  return `${cookieName(origin, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}; Expires=${new Date(age ? now + age * 1000 : 0).toUTCString()}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function seal(value, key) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv); c.setAAD(AAD);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  const result = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  if (result.length > 3800) fail(502, "invalid_token_response", "Google 연결 정보를 안전하게 저장하지 못했습니다.");
  return result;
}
function unseal(req, origin, config, now, kind) {
  try {
    const prefix = cookieName(origin, kind) + "=";
    const values = String(req.headers?.cookie || "").split(";").map((v) => v.trim()).filter((v) => v.startsWith(prefix));
    if (values.length !== 1) throw new Error();
    const raw = values[0].slice(prefix.length);
    if (raw.length > 3800 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const [, iv, tag, body] = raw.split(".");
    if (Buffer.from(iv, "base64url").length !== 12 || Buffer.from(tag, "base64url").length !== 16) throw new Error();
    const d = createDecipheriv("aes-256-gcm", config.key, Buffer.from(iv, "base64url")); d.setAAD(AAD); d.setAuthTag(Buffer.from(tag, "base64url"));
    const result = JSON.parse(Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8"));
    if (!object(result) || result.kind !== kind || result.origin !== origin || result.client !== config.clientId || !Number.isFinite(result.expires)
      || result.expires <= now || result.expires > now + SESSION_AGE * 1000 || !credential(result.nonce, 32)) throw new Error();
    if (kind === "session" && (!credential(result.refresh, 2048) || !fileId(result.sheet))) throw new Error();
    return result;
  } catch { fail(401, kind === "grant" ? "connect_required" : "reauth_required", "Google 연결 버튼에서 계정을 다시 승인해 주세요."); }
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers?.["content-type"] || "")) fail(415, "invalid_request", "JSON 형식으로 다시 시도해 주세요.");
  if (req.headers?.["content-length"] && (!/^\d+$/.test(String(req.headers["content-length"])) || Number(req.headers["content-length"]) > BODY_LIMIT)) fail(413, "request_too_large", "한 번에 저장할 내용이 너무 큽니다.");
  let raw = req.body;
  if (raw === undefined) {
    const chunks = []; let size = 0;
    for await (const part of req) { const b = Buffer.from(part); size += b.length; if (size > BODY_LIMIT) fail(413, "request_too_large", "한 번에 저장할 내용이 너무 큽니다."); chunks.push(b); }
    raw = Buffer.concat(chunks);
  }
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : JSON.stringify(raw);
    if (!text || Buffer.byteLength(text) > BODY_LIMIT) fail(413, "request_too_large", "한 번에 저장할 내용이 너무 큽니다.");
    const body = JSON.parse(text); if (!object(body)) throw new Error(); return body;
  } catch (error) { if (error instanceof BackupError) throw error; fail(400, "invalid_request", "저장 요청 내용을 확인해 주세요."); }
}
function cleanEvent(value, remote = false) {
  const bad = () => fail(remote ? 409 : 400, remote ? "backup_damaged" : "invalid_event", remote ? "시트 복구 기록의 형식이 달라 자동 처리를 중단했습니다. 기존 기록을 보존합니다." : "실적 변경 기록의 형식과 크기를 확인해 주세요.");
  if (!keys(value, ["id", "entityId", "entityType", "createdAt", "payload"], ["baseRevision"]) || !id(value.id) || !id(value.entityId)
    || !["record", "profile"].includes(value.entityType) || !object(value.payload)
    || (value.baseRevision != null && !id(value.baseRevision))
    || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) bad();
  const check = (v, depth = 0) => {
    if (depth > 16) bad();
    if (v == null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return;
    if (typeof v === "string") { if (v.length > 16000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) bad(); return; }
    if (Array.isArray(v)) { if (v.length > 1000) bad(); for (const item of v) check(item, depth + 1); return; }
    if (!object(v) || Object.keys(v).length > 1000) bad();
    for (const [key, item] of Object.entries(v)) { if (key.length > 300 || ["__proto__", "prototype", "constructor"].includes(key)) bad(); check(item, depth + 1); }
  };
  check(value.payload);
  if (Buffer.byteLength(JSON.stringify(value)) > 16000) bad();
  return { id: value.id, entityId: value.entityId, entityType: value.entityType, baseRevision: value.baseRevision || null, createdAt: value.createdAt, payload: value.payload };
}
function eventRow(event) {
  const p = event.payload;
  const cell = (v) => ["string", "number", "boolean"].includes(typeof v) ? v : "";
  return [event.id, digest(canonical(event)), event.entityId, event.entityType, event.baseRevision || "", event.createdAt,
    cell(p.date), p.deleted ? "삭제 이력" : ACTIVITIES[p.activity] || (event.entityType === "profile" ? "자격·경력 설정" : ""), cell(p.caseId), cell(p.sessions), cell(p.participants), cell(p.minutes),
    STATES[p.recognition?.center?.status] || "", STATES[p.recognition?.supervisor?.status] || "", STATES[p.status] || "", JSON.stringify(event)];
}
function parseRow(row) {
  if (!Array.isArray(row) || row.length !== COLUMNS.length || typeof row[15] !== "string") fail(409, "backup_damaged", "시트 복구 기록이 변경되어 자동 처리를 중단했습니다.");
  let event; try { event = cleanEvent(JSON.parse(row[15]), true); } catch (e) { if (e instanceof BackupError) throw e; fail(409, "backup_damaged", "시트의 복구 JSON을 읽지 못했습니다."); }
  if (event.id !== row[0] || digest(canonical(event)) !== row[1]) fail(409, "backup_damaged", "시트 복구 기록의 무결성 확인에 실패했습니다.");
  return event;
}

function createPerformanceSheetsHandler({ env = process.env, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000 } = {}) {
  const cache = new Map(), refreshing = new Map();
  const cacheKey = (session) => digest(canonical([session.client, session.origin, session.refresh, session.nonce]));
  const cacheToken = (key, token) => { cache.set(key, token); for (const [k, v] of cache) if (v.expires <= now()) cache.delete(k); while (cache.size > 256) cache.delete(cache.keys().next().value); return token; };
  async function remote(url, options = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal });
      if (Number(response.headers?.get("content-length")) > RESPONSE_LIMIT) fail(413, "backup_too_large", "백업 조회 범위가 너무 큽니다. 기존 자료는 그대로 보존됩니다.");
      const chunks = []; let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > RESPONSE_LIMIT) { await reader.cancel(); fail(413, "backup_too_large", "백업 조회 범위가 너무 큽니다."); } chunks.push(Buffer.from(value)); } }
        finally { reader.releaseLock(); }
      } else { const raw = await response.text(); size = Buffer.byteLength(raw); if (size > RESPONSE_LIMIT) fail(413, "backup_too_large", "백업 조회 범위가 너무 큽니다."); chunks.push(Buffer.from(raw)); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!object(data)) throw new Error();
      return { ok: response.ok, status: response.status, data };
    } catch (error) { if (error instanceof BackupError) throw error; fail(503, "google_unavailable", "Google 응답을 확인하지 못했습니다. 저장 대기 기록을 유지하고 다시 시도합니다.", true); }
    finally { clearTimeout(timer); }
  }
  function googleFailure(response) {
    if (response.status === 401) fail(401, "reauth_required", "Google 자동 백업을 다시 연결해 주세요.");
    if ([404, 410].includes(response.status)) fail(409, "backup_missing", "연결한 백업 시트를 찾을 수 없습니다. 새 시트로 덮어쓰지 않고 대기합니다.");
    if (response.status === 429 || response.status >= 500) fail(503, "google_unavailable", "Google 저장을 완료하지 못했습니다. 대기 기록을 보존하고 다시 시도합니다.", true);
    if (response.status === 403) fail(403, "permission_required", "Google Drive·Sheets API 사용 설정과 시트 접근 권한을 확인해 주세요.");
    fail(502, "google_request_failed", "Google 백업 요청을 완료하지 못했습니다. 기존 데이터를 보존합니다.", true);
  }
  async function tokenRequest(config, fields, isRefresh = false) {
    const response = await remote(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }).toString() });
    if (!response.ok) {
      if (response.data.error === "invalid_grant") fail(401, "reauth_required", "Google 자동 백업을 다시 승인해 주세요.");
      if (["invalid_client", "unauthorized_client"].includes(response.data.error)) fail(503, "setup_required", "서버의 Google OAuth 설정을 확인해 주세요.");
      googleFailure(response);
    }
    const d = response.data, scopes = typeof d.scope === "string" ? [...new Set(d.scope.split(/\s+/).filter(Boolean))] : [];
    if ((!isRefresh || d.scope !== undefined) && (scopes.length !== 1 || scopes[0] !== SCOPE)) fail(403, "scope_not_granted", "이 앱이 만든 Drive 파일 권한만 승인하여 다시 연결해 주세요.");
    const seconds = Number(d.expires_in);
    if (!credential(d.access_token) || String(d.token_type).toLowerCase() !== "bearer" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) fail(502, "invalid_token_response", "Google 권한 응답을 확인하지 못했습니다.");
    return { access: d.access_token, refresh: d.refresh_token, expires: now() + Math.max(1, seconds - Math.min(60, seconds / 10)) * 1000 };
  }
  async function accessFor(session, config, rejected) {
    const key = cacheKey(session), existing = cache.get(key);
    if (existing?.expires > now() && existing.access !== rejected) return existing;
    if (refreshing.has(key)) return refreshing.get(key);
    const promise = tokenRequest(config, { grant_type: "refresh_token", refresh_token: session.refresh }, true).then((token) => cacheToken(key, token))
      .catch((e) => { cache.delete(key); throw e; }).finally(() => refreshing.delete(key));
    refreshing.set(key, promise); return promise;
  }
  async function google(session, config, url, method = "GET", body) {
    let token = await accessFor(session, config);
    const send = (t) => remote(url, { method, headers: { Authorization: `Bearer ${t.access}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let response = await send(token);
    if (response.status === 401) { token = await accessFor(session, config, token.access); response = await send(token); }
    if (!response.ok) googleFailure(response);
    return response.data;
  }
  function metadata(data) {
    if (!fileId(data.id) || data.mimeType !== "application/vnd.google-apps.spreadsheet" || data.appProperties?.[MARKER] !== "v1"
      || data.ownedByMe !== true || data.shared !== false || data.trashed !== false || data.capabilities?.canEdit !== true) {
      fail(403, "invalid_backup_file", "이 앱이 만든 본인 소유의 비공개 백업 시트만 연결할 수 있습니다.");
    }
    return { id: data.id, name: typeof data.name === "string" ? data.name.slice(0, 200) : "상담 실적 자동백업", url: `https://docs.google.com/spreadsheets/d/${data.id}/edit` };
  }
  const fileMetadata = async (session, config) => metadata(await google(session, config, `${DRIVE}/${encodeURIComponent(session.sheet)}?fields=${encodeURIComponent(FILE_FIELDS)}`));
  const rangeUrl = (sheet, range) => `${SHEETS}/${encodeURIComponent(sheet)}/values/${encodeURIComponent(`'${TAB}'!${range}`)}`;
  async function rows(session, config, range) {
    const result = await google(session, config, rangeUrl(session.sheet, range) + "?valueRenderOption=UNFORMATTED_VALUE");
    // A valid empty ValueRange still has range/dimension metadata. A truncated
    // {} response must never become an authoritative empty backup/index.
    if (typeof result.range !== "string" || !new RegExp(`^'?${TAB}'?!A\\d+:${range.includes(":B") ? "B" : "P"}\\d+$`).test(result.range)
      || result.majorDimension !== "ROWS" || (result.values !== undefined && !Array.isArray(result.values))) {
      fail(502, "invalid_sheet_response", "Google 시트 조회 결과를 확인하지 못했습니다.", true);
    }
    return result.values || [];
  }
  async function header(session, config) {
    const result = await rows(session, config, "A1:P1");
    if (result.length !== 1 || JSON.stringify(result[0]) !== JSON.stringify(COLUMNS)) fail(409, "backup_format_mismatch", "백업 시트의 열 구성이 변경되었습니다. 기록을 덮어쓰지 않고 연결을 중단합니다.");
  }
  async function eventIndex(session, config) {
    const index = await rows(session, config, "A2:B"), known = new Map();
    for (let n = 0; n < index.length; n++) {
      const entry = index[n];
      if (!Array.isArray(entry) || entry.length !== 2 || !id(entry[0]) || !/^[0-9a-f]{64}$/.test(entry[1])) fail(409, "backup_damaged", "기존 백업 목록의 형식을 확인하지 못했습니다. 자동 처리를 중단합니다.");
      if (known.has(entry[0]) && known.get(entry[0]).hash !== entry[1]) fail(409, "event_id_conflict", "같은 변경 ID의 내용이 다릅니다. 기존 기록을 보존하고 확인이 필요합니다.");
      known.set(entry[0], { hash: entry[1], row: n + 2 });
    }
    return { count: index.length, known };
  }
  async function discover(session, config, preferred) {
    const query = new URLSearchParams({ q: `trashed = false and appProperties has { key='${MARKER}' and value='v1' }`, spaces: "drive", pageSize: "100", fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})` });
    const result = await google(session, config, `${DRIVE}?${query}`);
    if (!Array.isArray(result.files) || result.incompleteSearch === true || result.nextPageToken) fail(502, "incomplete_file_list", "기존 백업 목록을 완전히 확인하지 못했습니다. 새 파일을 만들지 않고 중단합니다.", true);
    if (result.files.length) {
      const found = preferred ? result.files.find((item) => item.id === preferred) : result.files.length === 1 ? result.files[0] : null;
      if (!found) fail(409, "backup_selection_required", "자동백업 시트가 여러 개입니다. 기존에 사용하던 시트를 선택해 주세요.");
      const sheet = metadata(found); session.sheet = sheet.id; await header(session, config); return sheet;
    }
    if (preferred) fail(409, "backup_missing", "선택한 기존 백업 시트를 찾지 못했습니다. 새 파일을 만들지 않습니다.");
    // Header and sheet creation are atomic. If marking the new empty file fails,
    // no user data has been transmitted and no existing file is changed.
    const made = await google(session, config, SHEETS, "POST", { properties: { title: "상담 실적 자동백업", locale: "ko_KR", timeZone: "Asia/Seoul" }, sheets: [{ properties: { title: TAB, gridProperties: { rowCount: 1000, columnCount: COLUMNS.length, frozenRowCount: 1 } }, data: [{ startRow: 0, startColumn: 0, rowData: [{ values: COLUMNS.map((title) => ({ userEnteredValue: { stringValue: title }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.93, blue: 0.91 } } })) }] }] }] });
    if (!fileId(made.spreadsheetId)) fail(502, "invalid_sheet_response", "생성한 백업 시트 정보를 확인하지 못했습니다.");
    session.sheet = made.spreadsheetId;
    await google(session, config, `${DRIVE}/${encodeURIComponent(session.sheet)}?fields=id`, "PATCH", { appProperties: { [MARKER]: "v1" } });
    const sheet = await fileMetadata(session, config); await header(session, config); return sheet;
  }
  return async function handler(req, res) {
    const send = (status, data) => { res.writeHead(status, HEADERS); res.end(JSON.stringify(data)); };
    try {
      const config = settings(env), query = new URL(req.url || "/", "http://localhost").searchParams;
      if (!["GET", "POST"].includes(req.method)) { res.setHeader("Allow", "GET, POST"); fail(405, "method_not_allowed", "지원하지 않는 요청 방식입니다."); }
      const action = req.method === "GET" ? query.get("action") : null;
      if (req.method === "GET" && !["status", "events"].includes(action)) fail(400, "invalid_request", "지원하지 않는 조회입니다.");
      if (!config.configured) {
        if (action === "status") return send(200, { configured: false, connected: false, passwordRequired: !!config.password, clientId: "", scope: SCOPE });
        fail(503, "setup_required", "서버의 Google 자동 백업 설정이 필요합니다.");
      }
      const origin = requestOrigin(req, config);
      if (action === "status") {
        let session; try { session = unseal(req, origin, config, now(), "session"); } catch { /* Not yet connected. */ }
        const sheet = session ? await fileMetadata(session, config) : null;
        return send(200, { configured: true, connected: !!session, passwordRequired: !!config.password, clientId: config.clientId, scope: SCOPE, sheet });
      }
      if (action === "events") {
        if ([...query.keys()].some((key) => !["action", "cursor"].includes(key)) || query.getAll("cursor").length > 1) fail(400, "invalid_request", "조회 페이지를 확인해 주세요.");
        const rawCursor = query.get("cursor") || "0";
        if (!/^\d{1,7}$/.test(rawCursor)) fail(400, "invalid_request", "조회 페이지를 확인해 주세요.");
        const cursor = Number(rawCursor), session = unseal(req, origin, config, now(), "session");
        const sheet = await fileMetadata(session, config); await header(session, config);
        const index = await eventIndex(session, config);
        if (cursor > index.count) fail(409, "backup_changed", "백업 조회 중 기록 개수가 달라졌습니다. 처음부터 다시 조회해 주세요.", true);
        const end = Math.min(cursor + PAGE_SIZE, index.count);
        const page = end > cursor ? await rows(session, config, `A${cursor + 2}:P${end + 1}`) : [];
        if (page.length !== end - cursor) fail(502, "incomplete_sheet_response", "Google 시트 일부만 조회되었습니다. 기존 데이터를 유지하고 다시 확인합니다.", true);
        return send(200, { events: page.map(parseRow), nextCursor: end < index.count ? end : null, sheet });
      }
      const body = await readBody(req);
      if (body.action === "disconnect" && keys(body, ["action"])) {
        try { cache.delete(cacheKey(unseal(req, origin, config, now(), "session"))); } catch { /* Also clear expired sessions. */ }
        res.setHeader("Set-Cookie", [cookie(origin, "session", "", now(), 0), cookie(origin, "grant", "", now(), 0)]);
        return send(200, { connected: false });
      }
      if (body.action === "connect" && keys(body, ["action"], ["password"])) {
        if (config.password && (typeof body.password !== "string" || body.password.length > 1024 || !timingSafeEqual(Buffer.from(digest(body.password)), Buffer.from(digest(config.password))))) fail(403, "invalid_password", "연결 비밀번호를 확인해 주세요.");
        const grant = { kind: "grant", origin, client: config.clientId, expires: now() + 600000, nonce: randomBytes(16).toString("base64url") };
        res.setHeader("Set-Cookie", cookie(origin, "grant", seal(grant, config.key), now(), 600));
        return send(200, { clientId: config.clientId, scope: SCOPE, mode: "popup" });
      }
      if (body.action === "exchange" && keys(body, ["action", "code"], ["sheetId"])) {
        const grant = unseal(req, origin, config, now(), "grant");
        if (!credential(body.code, 8192) || (body.sheetId !== undefined && !fileId(body.sheetId))) fail(400, "invalid_request", "Google 연결 정보를 확인해 주세요.");
        const token = await tokenRequest(config, { grant_type: "authorization_code", code: body.code, redirect_uri: origin });
        if (!credential(token.refresh, 2048)) fail(409, "offline_access_required", "자동 백업 갱신 권한을 받지 못했습니다. Google 권한을 다시 승인해 주세요.");
        const session = { kind: "session", origin, client: config.clientId, refresh: token.refresh, expires: now() + SESSION_AGE * 1000, nonce: grant.nonce };
        cacheToken(cacheKey(session), token);
        const sheet = await discover(session, config, body.sheetId);
        res.setHeader("Set-Cookie", [cookie(origin, "session", seal(session, config.key), now(), SESSION_AGE), cookie(origin, "grant", "", now(), 0)]);
        return send(200, { connected: true, sheet });
      }
      if (body.action === "append" && keys(body, ["action", "events"], ["sheetId"])) {
        if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 50) fail(400, "invalid_event", "한 번에 1~50개의 변경을 저장할 수 있습니다.");
        const events = body.events.map((e) => cleanEvent(e));
        const session = unseal(req, origin, config, now(), "session");
        if (body.sheetId !== undefined && body.sheetId !== session.sheet) fail(409, "backup_changed", "연결한 Google 시트가 달라 자동 업로드를 멈췄습니다.");
        const sheet = await fileMetadata(session, config); await header(session, config);
        const { known } = await eventIndex(session, config);
        const pending = [], seen = new Map();
        for (const event of events) {
          const hash = digest(canonical(event)), previous = known.get(event.id);
          if ((previous && previous.hash !== hash) || (seen.has(event.id) && seen.get(event.id) !== hash)) fail(409, "event_id_conflict", "같은 변경 ID의 내용이 다릅니다. 기존 기록을 덮어쓰지 않습니다.");
          if (previous) {
            const duplicate = await rows(session, config, `A${previous.row}:P${previous.row}`);
            if (duplicate.length !== 1 || canonical(parseRow(duplicate[0])) !== canonical(event)) fail(409, "backup_damaged", "기존 변경 기록의 복구 내용을 확인하지 못했습니다.");
          } else if (!seen.has(event.id)) pending.push(event);
          seen.set(event.id, hash);
        }
        if (pending.length) {
          const result = await google(session, config, rangeUrl(session.sheet, "A:P") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=true", "POST", { majorDimension: "ROWS", values: pending.map(eventRow) });
          const stored = result.updates?.updatedData?.values;
          if (result.updates?.updatedRows !== pending.length || !Array.isArray(stored) || stored.length !== pending.length
            || stored.some((row, n) => canonical(parseRow(row)) !== canonical(pending[n]))) fail(503, "append_unconfirmed", "Google 저장 결과를 확인하지 못했습니다. 같은 변경 ID로 다시 확인합니다.", true);
        }
        return send(200, { acceptedIds: [...seen.keys()], sheet });
      }
      fail(400, "invalid_request", "지원하지 않는 실적 백업 요청입니다.");
    } catch (error) {
      const failure = error instanceof BackupError ? error : new BackupError(500, "backup_error", "자동 백업을 완료하지 못했습니다. 저장 대기 기록을 유지합니다.", true);
      // Failed reads/authentication never clear the cookie, local data, or sheet.
      send(failure.status, { error: { code: failure.code, message: failure.message, retryable: failure.retryable } });
    }
  };
}

const handler = createPerformanceSheetsHandler();
module.exports = { handler, createPerformanceSheetsHandler };
