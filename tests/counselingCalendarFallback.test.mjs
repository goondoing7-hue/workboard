import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createCalendarSessionHandler } from "../server/googleCalendarSession.cjs";
import { parseCalendarFeed } from "../server/googleCalendar.cjs";
import { mergeGoogleCalendar } from "../src/googleCalendarDomain.mjs";
import { createCalendarSession } from "../src/googleCalendarSession.mjs";
import { readGoogleCalendar } from "../src/googleCalendarRead.mjs";

const CLIENT = "1234567890-counseling-fallback.apps.googleusercontent.com";
const CALENDAR = "counseling@group.calendar.google.com";
const ORIGIN = "https://workboard.example";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`;
const RANGE = { calendarId: CALENDAR, from: "2026-09-01", to: "2026-10-01" };
const NOW = Date.parse("2026-09-21T00:00:00Z");
const fakeToken = { access_token: "fake-access", refresh_token: "fake-refresh", token_type: "Bearer", expires_in: 3600,
  scope: "https://www.googleapis.com/auth/calendar.events.owned" };
const ordinary = (patch = {}) => ({ id: "provider-single-id", iCalUID: "single@example.com", status: "confirmed", summary: "일반 상담", location: "마음",
  start: { dateTime: "2026-09-21T01:35:00Z" }, end: { dateTime: "2026-09-21T02:35:00Z" }, ...patch });
const allDay = { id: "provider-all-day", iCalUID: "all-day@example.com", status: "confirmed", summary: "종일 상담",
  start: { date: "2026-09-23" }, end: { date: "2026-09-25" } };
const timedInstances = [
  { id: "series_20260907T010000Z", iCalUID: "series@example.com", recurringEventId: "series", originalStartTime: { dateTime: "2026-09-07T10:00:00+09:00" },
    status: "confirmed", summary: "기본 회기", start: { dateTime: "2026-09-07T10:00:00+09:00" }, end: { dateTime: "2026-09-07T11:00:00+09:00" } },
  { id: "series_20260914T010000Z", iCalUID: "series@example.com", recurringEventId: "series", originalStartTime: { dateTime: "2026-09-14T01:00:00Z" },
    status: "confirmed", summary: "변경 회기", location: "meet", start: { dateTime: "2026-09-15T13:00:00+09:00" }, end: { dateTime: "2026-09-15T14:00:00+09:00" } },
];
const datedInstances = [
  { id: "dated_20260926", iCalUID: "dated@example.com", recurringEventId: "dated", originalStartTime: { date: "2026-09-26" },
    status: "confirmed", summary: "반복 종일", start: { date: "2026-09-26" }, end: { date: "2026-09-27" } },
  { id: "dated_20260927", iCalUID: "dated@example.com", recurringEventId: "dated", originalStartTime: { date: "2026-09-27" },
    status: "confirmed", summary: "이동 종일", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } },
];
const vevent = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const ics = (...rows) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workboard Test//EN", "X-WR-CALNAME:상담", "X-WR-TIMEZONE:Asia/Seoul", ...rows.flat(), "END:VCALENDAR"].join("\r\n");
const seriesMaster = vevent(["UID:series@example.com", "DTSTART;TZID=Asia/Seoul:20260907T100000", "DTEND;TZID=Asia/Seoul:20260907T110000", "RRULE:FREQ=WEEKLY;COUNT=2", "SUMMARY:기본 회기"]);
const seriesMoved = vevent(["UID:series@example.com", "RECURRENCE-ID:20260914T010000Z", "DTSTART;TZID=Asia/Seoul:20260915T130000", "DTEND;TZID=Asia/Seoul:20260915T140000", "SUMMARY:변경 회기", "LOCATION:meet"]);
function fixture(route = async () => Response.json({ summary: "상담", timeZone: "Asia/Seoul", items: [] })) {
  const calls = [];
  const handler = createCalendarSessionHandler({ env: {
    GOOGLE_CALENDAR_CLIENT_ID: CLIENT, GOOGLE_CALENDAR_CLIENT_SECRET: "fake-secret",
    GOOGLE_CALENDAR_SESSION_KEY: Buffer.alloc(32, 31).toString("base64url"), GOOGLE_CALENDAR_ID: CALENDAR, GOOGLE_CALENDAR_ORIGINS: ORIGIN,
  }, now: () => NOW, timeoutMs: 1000, fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === TOKEN_URL) return Response.json(fakeToken);
    if (new URL(url).searchParams.get("fields") === "summary,timeZone,accessRole") return Response.json({ accessRole: "owner", summary: "상담", timeZone: "Asia/Seoul" });
    return route(url, init);
  } });
  return { handler, calls };
}
async function request(handler, body, { cookie, headers = {} } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST"; req.url = "/api/google-calendar-auth";
  req.headers = { host: new URL(ORIGIN).host, origin: ORIGIN, "x-workboard-calendar": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers };
  const response = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, values) { this.status = status; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); },
    end(raw) { this.raw = raw; this.data = JSON.parse(raw); } };
  await handler(req, response);
  response.cookie = response.headers["set-cookie"]?.split(";")[0];
  return response;
}
async function connect(f) {
  const response = await request(f.handler, { action: "exchange", code: "fake-code", calendarId: CALENDAR });
  assert.equal(response.status, 200, response.raw);
  return response.cookie;
}
const list = (f, cookie, patch = {}, options = {}) => request(f.handler, { action: "counsel-list", from: RANGE.from, to: RANGE.to, ...patch }, { cookie, ...options });
const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

test("authenticated counseling snapshots match ICS identities and Seoul dates, including moved recurring instances", async () => {
  const items = [ordinary({ description: "PRIVATE-NOTES", attendees: [{ email: "PRIVATE-EMAIL" }], extendedProperties: { private: { note: "PRIVATE-EXTENSION" } } }), allDay, ...timedInstances, ...datedInstances];
  const f = fixture(async () => Response.json({ summary: "상담", timeZone: "Asia/Seoul", items }));
  const result = await list(f, await connect(f));
  assert.equal(result.status, 200, result.raw);
  const expected = parseCalendarFeed(ics(
    vevent(["UID:single@example.com", "DTSTART:20260921T013500Z", "DTEND:20260921T023500Z", "SUMMARY:일반 상담", "LOCATION:마음"]),
    vevent(["UID:all-day@example.com", "DTSTART;VALUE=DATE:20260923", "DTEND;VALUE=DATE:20260925", "SUMMARY:종일 상담"]),
    seriesMaster, seriesMoved,
    vevent(["UID:dated@example.com", "DTSTART;VALUE=DATE:20260926", "DTEND;VALUE=DATE:20260927", "RRULE:FREQ=DAILY;COUNT=2", "SUMMARY:반복 종일"]),
    vevent(["UID:dated@example.com", "RECURRENCE-ID;VALUE=DATE:20260927", "DTSTART;VALUE=DATE:20260928", "DTEND;VALUE=DATE:20260929", "SUMMARY:이동 종일"])), RANGE, { now: NOW });
  assert.deepEqual(byId(result.data.events), byId(expected.events));
  for (const field of ["calendarId", "name", "timeZone", "from", "to", "fetchedAt"]) assert.deepEqual(result.data[field], expected[field], field);
  assert.doesNotMatch(result.raw, /PRIVATE-|description|attendees|extendedProperties|fake-access|fake-refresh|fake-secret/);
  assert.equal(result.headers["cache-control"], "no-store, max-age=0");
  const sent = f.calls.at(-1), url = new URL(sent.url);
  assert.equal(url.origin + url.pathname, EVENTS);
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.equal(url.searchParams.get("showDeleted"), "false");
  assert.equal(url.searchParams.get("timeMin"), `${RANGE.from}T00:00:00+09:00`);
  assert.equal(url.searchParams.get("timeMax"), `${RANGE.to}T00:00:00+09:00`, "exclusive end must match the existing ICS merge window");
  assert.doesNotMatch(url.searchParams.get("fields"), /description|attendees|extendedProperties/);
  assert.equal(sent.init.method, "GET");
  assert.equal(sent.init.headers.Authorization, "Bearer fake-access");
});

test("switching an existing ICS reservation to authenticated reads preserves its ID, client and completed journal", async () => {
  const original = mergeGoogleCalendar({ resv: [] }, parseCalendarFeed(ics(seriesMaster), RANGE, { now: NOW - 1000 }), NOW - 1000);
  const linked = original.resv.find((row) => row.date === "2026-09-14");
  const log = { text: "로컬 상담일지", files: [{ id: "local-file" }] };
  Object.assign(linked, { clientId: "local-client", type: "가족상담", method: "대면", status: "done", done: true, log, memo: "로컬 메모" });
  const f = fixture(async () => Response.json({ summary: "상담", timeZone: "Asia/Seoul", items: timedInstances }));
  const result = await list(f, await connect(f));
  assert.equal(result.status, 200, result.raw);
  const merged = mergeGoogleCalendar(original, result.data, NOW);
  assert.equal(merged.resv.length, 2);
  const moved = merged.resv.find((row) => row.id === linked.id);
  assert.ok(moved);
  for (const key of ["id", "externalId", "clientId", "type", "method", "status", "done", "memo"]) assert.equal(moved[key], linked[key], key);
  assert.equal(moved.log, log);
  assert.deepEqual([moved.date, moved.start, moved.end, moved.place], ["2026-09-15", "13:00", "14:00", "meet"]);
  assert.equal(moved.externalCancelled, false);
});

test("authenticated list only returns a complete paginated snapshot", async () => {
  let pages = 0;
  const f = fixture(async (url) => {
    pages++;
    const token = new URL(url).searchParams.get("pageToken");
    if (!token) return Response.json({ summary: "상담", timeZone: "Asia/Seoul", items: [ordinary()], nextPageToken: "page-two" });
    assert.equal(token, "page-two");
    return Response.json({ items: [allDay] });
  });
  const response = await list(f, await connect(f));
  assert.equal(response.status, 200, response.raw);
  assert.equal(pages, 2);
  assert.deepEqual(response.data.events.map((row) => row.id).sort(), ["all-day%40example.com::single", "single%40example.com::single"]);
  assert.equal(response.data.name, "상담");
});

test("a later-page failure, repeated token or malformed event cannot expose a partial authoritative snapshot", async () => {
  for (const scenario of ["http-failure", "repeated-token", "malformed-item"]) {
    const f = fixture(async (url) => {
      if (!new URL(url).searchParams.has("pageToken")) return Response.json({ items: [ordinary()], nextPageToken: "page-two" });
      if (scenario === "http-failure") return Response.json({ error: { message: "ignored provider detail" } }, { status: 503 });
      if (scenario === "repeated-token") return Response.json({ items: [], nextPageToken: "page-two" });
      return Response.json({ items: [{ id: "broken", iCalUID: "broken@example.com", start: { date: "2026-02-30" }, end: { date: "2026-03-01" } }] });
    });
    const response = await list(f, await connect(f));
    assert.ok(response.status >= 400, `${scenario}: ${response.raw}`);
    assert.equal(response.data.events, undefined, scenario);
    assert.doesNotMatch(response.raw, /single%40example|ignored provider detail/);
  }
});

test("cancelled provider items are skipped even when returned against showDeleted=false", async () => {
  const f = fixture(async () => Response.json({ items: [ordinary(), { id: "cancelled-without-dates", status: "cancelled" }] }));
  const response = await list(f, await connect(f));
  assert.equal(response.status, 200, response.raw);
  assert.equal(response.data.events.length, 1);
  assert.equal(response.data.events[0].id, "single%40example.com::single");
});

test("counsel-list requires its same-origin cookie and rejects calendar substitution or invalid/excessive windows", async () => {
  const f = fixture();
  const missing = await list(f, "");
  assert.equal(missing.status, 401);
  assert.equal(f.calls.length, 0);
  const cookie = await connect(f), before = f.calls.length;
  const foreign = await list(f, cookie, {}, { headers: { origin: "https://foreign.example" } });
  assert.equal(foreign.status, 403);
  for (const patch of [{ calendarId: CALENDAR }, { calendarId: "other@group.calendar.google.com" },
    { from: "2026-02-30" }, { to: RANGE.from }, { to: "2026-08-01" }, { from: "2026-9-01" }, { to: "2030-01-01" },
    { url: "https://foreign.example" }, { fields: "description" }, { pageToken: "injected" }]) {
    const response = await list(f, cookie, patch);
    assert.equal(response.status, 400, JSON.stringify(patch));
  }
  assert.equal(f.calls.length, before, "invalid requests must fail before provider access");
});

test("the counseling fallback client reads through the server cookie without restoring memory or prompting OAuth", async () => {
  const requests = [];
  let popup = 0, legacy = 0;
  const expected = { ...RANGE, name: "상담", timeZone: "Asia/Seoul", fetchedAt: new Date(NOW).toISOString(), events: [] };
  const client = createCalendarSession({
    getGoogle: () => ({ accounts: { oauth2: { initCodeClient: () => { popup++; throw new Error("must not authorize"); } } } }),
    legacyAuth: { subscribeCalendarAuth: () => () => {}, getCalendarAuthStatus: () => ({ connected: false }), forgetCalendarAccess: () => {},
      prepareCalendarAccess: async () => { legacy++; }, calendarFetch: async () => { legacy++; } },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json(url.includes("?action=config") ? { configured: true, clientId: CLIENT, calendarId: CALENDAR } : expected);
    },
  });
  assert.deepEqual(await client.counselingCalendarRequest(RANGE.from, RANGE.to), expected);
  assert.equal(requests.length, 2);
  const sent = requests.at(-1);
  assert.equal(sent.url, "/api/google-calendar-auth");
  assert.equal(sent.options.credentials, "include");
  assert.equal(sent.options.headers["X-Workboard-Calendar"], "1");
  assert.equal(sent.options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(sent.options.body), { action: "counsel-list", from: RANGE.from, to: RANGE.to });
  assert.equal(popup, 0); assert.equal(legacy, 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.counselingCalendarRequest(RANGE.from, RANGE.to, { signal: abort.signal }), { code: "cancelled" });
  assert.equal(requests.length, 2);
  client.forgetCalendarAccess();
});

test("public calendar success stays public and passes its range and abort signal unchanged", async () => {
  let fallbackCalls = 0;
  const expected = { ...RANGE, events: [] }, controller = new AbortController();
  const actual = await readGoogleCalendar({ ...RANGE, signal: controller.signal,
    fetchImpl: async (url, options) => {
      const request = new URL(url, ORIGIN);
      assert.equal(request.pathname, "/api/google-calendar");
      assert.deepEqual(Object.fromEntries(request.searchParams), RANGE);
      assert.equal(options.signal, controller.signal); assert.equal(options.cache, "no-store");
      return Response.json(expected);
    }, authenticatedRead: async () => { fallbackCalls++; } });
  assert.deepEqual(actual, expected);
  assert.equal(fallbackCalls, 0);
});

test("only unavailable public-feed statuses try a matching authenticated calendar snapshot", async () => {
  for (const status of [403, 404]) {
    let fallbackCalls = 0;
    const expected = { ...RANGE, events: [] }, controller = new AbortController();
    const result = await readGoogleCalendar({ ...RANGE, signal: controller.signal,
      fetchImpl: async () => Response.json({ error: "공개 피드가 없습니다." }, { status }),
      authenticatedRead: async (from, to, options) => {
        fallbackCalls++;
        assert.deepEqual([from, to], [RANGE.from, RANGE.to]);
        assert.equal(options.signal, controller.signal);
        assert.equal(options.calendarId, CALENDAR);
        return expected;
      } });
    assert.equal(result, expected); assert.equal(fallbackCalls, 1);
  }
  for (const status of [400, 401, 429, 500, 503]) {
    let fallbackCalls = 0;
    await assert.rejects(readGoogleCalendar({ ...RANGE,
      fetchImpl: async () => Response.json({ error: "원본 조회 오류" }, { status }),
      authenticatedRead: async () => { fallbackCalls++; return { ...RANGE, events: [] }; } }), /원본 조회 오류/);
    assert.equal(fallbackCalls, 0, `status ${status}`);
  }
});

test("absent authorization, partial-read errors and mismatched fallback calendars never become snapshots", async () => {
  const publicFailure = () => Response.json({ error: "공개 캘린더 연결을 확인해 주세요." }, { status: 404 });
  const candidates = [
    async () => { throw Object.assign(new Error("private authorization detail"), { code: "reauth_required", status: 401 }); },
    async () => { throw Object.assign(new Error("page two failed"), { code: "provider_unavailable", status: 503 }); },
    async () => ({ ...RANGE, calendarId: "other@group.calendar.google.com", events: [] }),
    async () => ({ ...RANGE, from: "2026-08-01", events: [] }),
    async () => ({ ...RANGE, to: "2026-11-01", events: [] }),
    async () => undefined,
  ];
  for (const authenticatedRead of candidates) {
    await assert.rejects(readGoogleCalendar({ ...RANGE, fetchImpl: publicFailure, authenticatedRead }),
      { message: "공개 캘린더 연결을 확인해 주세요." });
  }
  await assert.rejects(readGoogleCalendar({ ...RANGE, fetchImpl: publicFailure }), /공개 캘린더 연결을 확인해 주세요/);
});

test("cancellation during authenticated fallback remains cancellation rather than a public-feed error", async () => {
  const failure = Object.assign(new Error("cancelled"), { code: "cancelled" });
  await assert.rejects(readGoogleCalendar({ ...RANGE,
    fetchImpl: async () => Response.json({ error: "공개 조회 오류" }, { status: 404 }),
    authenticatedRead: async () => { throw failure; } }), (error) => error === failure);
});
