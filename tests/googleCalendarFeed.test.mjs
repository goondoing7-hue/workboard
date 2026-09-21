import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseCalendarFeed, publicCalendarResponse, validateQuery, handler, MAX_BYTES } = require("../server/googleCalendar.cjs");
const range = { calendarId: "example@gmail.com", from: "2026-09-01", to: "2026-10-01" };
const event = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const feed = (...parts) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workboard Test//EN", "X-WR-CALNAME:테스트 캘린더", ...parts.flat(), "END:VCALENDAR"].join("\r\n");
const single = (extra = []) => event(["UID:test-single", "DTSTART:20260921T010000Z", "DTEND:20260921T020000Z", "SUMMARY:테스트 일정", ...extra]);
const responseFor = (text, init = {}) => new Response(text, { status: 200, headers: { "Content-Type": "text/calendar" }, ...init });

test("calendar IDs and date windows reject URLs, path injection, duplicate parameters and invalid dates", () => {
  assert.equal(validateQuery({ ...range, calendarId: " SAMPLE@GMAIL.COM " }).calendarId, "sample@gmail.com");
  assert.equal(validateQuery({ ...range, calendarId: "a_b123@group.calendar.google.com" }).calendarId, "a_b123@group.calendar.google.com");
  for (const calendarId of ["https://localhost/x", "a@gmail.com/secret", "a@gmail.com@evil.test", "a%2f@gmail.com", "a\r\n@gmail.com", "a@evil.test", "a@calendar.google.com", "../a@gmail.com", ["a@gmail.com"]]) {
    assert.throws(() => validateQuery({ ...range, calendarId }), (error) => error.status === 400);
  }
  assert.throws(() => validateQuery(new URLSearchParams("calendarId=a@gmail.com&calendarId=b@gmail.com&from=2026-09-01&to=2026-10-01")));
  for (const patch of [{ from: "2026-02-30" }, { to: "2026-09-01" }, { to: "2026-08-01" }, { from: "2026-9-01" }, { to: "2030-01-01" }]) assert.throws(() => validateQuery({ ...range, ...patch }));
});

test("UTC and floating times display in Seoul while text and all-day exclusive end survive", () => {
  const result = parseCalendarFeed(feed("X-WR-TIMEZONE:Asia/Seoul", single(["LOCATION:상담실\\, 1", "DESCRIPTION:응답에 포함하지 않을 내용"]),
    event(["UID:floating", "DTSTART:20260922T150000", "DTEND:20260922T160000", "SUMMARY:이어지는", "  제목"]),
    event(["UID:all-day", "DTSTART;VALUE=DATE:20260923", "DTEND;VALUE=DATE:20260925", "SUMMARY:종일"])), range, { now: 0 });
  assert.equal(result.name, "테스트 캘린더");
  assert.equal(result.timeZone, "Asia/Seoul");
  assert.equal(result.fetchedAt, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(result.events.map((row) => [row.date, row.start, row.end]), [["2026-09-21", "10:00", "11:00"], ["2026-09-22", "15:00", "16:00"], ["2026-09-23", "", ""]]);
  assert.equal(result.events[0].place, "상담실, 1");
  assert.equal(result.events[0].description, undefined);
  assert.equal(result.events[1].title, "이어지는 제목");
  assert.equal(result.events[2].allDay, true);
  assert.equal(result.events[2].endDate, "2026-09-25");
});

test("RRULE, EXDATE, moved exceptions and cancellation keep the original instance identity", () => {
  const master = event(["UID:series", "DTSTART;TZID=Asia/Seoul:20260907T100000", "DTEND;TZID=Asia/Seoul:20260907T110000", "RRULE:FREQ=WEEKLY;COUNT=4", "SUMMARY:기본 회기"]);
  const original = parseCalendarFeed(feed(master), range).events;
  const changed = parseCalendarFeed(feed(event(["UID:series", "DTSTART;TZID=Asia/Seoul:20260907T100000", "DTEND;TZID=Asia/Seoul:20260907T110000", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE;TZID=Asia/Seoul:20260914T100000", "SUMMARY:기본 회기"]),
    event(["UID:series", "RECURRENCE-ID:20260921T010000Z", "DTSTART;TZID=Asia/Seoul:20260922T130000", "DTEND;TZID=Asia/Seoul:20260922T140000", "SUMMARY:변경 회기"]),
    event(["UID:series", "RECURRENCE-ID;TZID=Asia/Seoul:20260928T100000", "STATUS:CANCELLED"])), range).events;
  assert.equal(changed.length, 3);
  assert.equal(changed.some((row) => row.date === "2026-09-14"), false);
  const moved = changed.find((row) => row.title === "변경 회기");
  assert.equal(moved.date, "2026-09-22");
  assert.equal(moved.start, "13:00");
  assert.equal(moved.id, original[2].id);
  const cancelled = changed.find((row) => row.cancelled);
  assert.equal(cancelled.id, original[3].id);
  assert.equal(cancelled.start, "10:00");
  assert.equal(cancelled.end, "11:00");
});

test("exceptions moved into a window are retained and never attach to a different UID", () => {
  const result = parseCalendarFeed(feed(
    event(["UID:a", "DTSTART:20260801T010000Z", "DTEND:20260801T020000Z", "RRULE:FREQ=WEEKLY;COUNT=1", "SUMMARY:기본 A"]),
    event(["UID:b", "DTSTART:20260901T010000Z", "DTEND:20260901T020000Z", "RRULE:FREQ=WEEKLY;COUNT=1", "SUMMARY:기본 B"]),
    event(["UID:a", "RECURRENCE-ID:20260801T010000Z", "DTSTART:20260910T010000Z", "DTEND:20260910T020000Z", "SUMMARY:이동 A"])), range);
  assert.deepEqual(result.events.map((row) => row.title), ["기본 B", "이동 A"]);
  assert.match(result.events[1].id, /2026-08-01T01:00:00/);
});

test("IANA zone recurrence follows DST without relying on global timezone state", () => {
  const source = feed("X-WR-TIMEZONE:America/New_York", event(["UID:dst", "DTSTART;TZID=America/New_York:20261025T100000", "DTEND;TZID=America/New_York:20261025T110000", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:DST"]));
  const result = parseCalendarFeed(source, { ...range, from: "2026-10-01", to: "2026-12-01" });
  assert.deepEqual(result.events.map((row) => [row.date, row.start, row.end]), [["2026-10-25", "23:00", "00:00"], ["2026-11-02", "00:00", "01:00"], ["2026-11-09", "00:00", "01:00"]]);
  assert.equal(result.events[0].endDate, "2026-10-26");
});

test("nonexistent DST recurrence times fail intact rather than returning incorrect duration or COUNT", () => {
  const gap = feed(event(["UID:gap", "DTSTART;TZID=America/New_York:20260307T023000", "DTEND;TZID=America/New_York:20260307T033000", "RRULE:FREQ=DAILY;COUNT=3"]));
  assert.throws(() => parseCalendarFeed(gap, { ...range, from: "2026-03-01", to: "2026-04-01" }), /서머타임/);
});

test("calendar-local VTIMEZONE definitions remain isolated between feeds", () => {
  const custom = (offset) => ["BEGIN:VTIMEZONE", "TZID:Test/Custom", "BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, "END:STANDARD", "END:VTIMEZONE"];
  const row = event(["UID:custom", "DTSTART;TZID=Test/Custom:20260921T100000", "DTEND;TZID=Test/Custom:20260921T110000"]);
  assert.equal(parseCalendarFeed(feed(custom("+0545"), row), range).events[0].start, "13:15");
  assert.equal(parseCalendarFeed(feed(custom("+0200"), row), range).events[0].start, "17:00");
  assert.equal(parseCalendarFeed(feed(custom("+0545"), row), range).events[0].start, "13:15");
});

test("VTIMEZONE daylight transitions drive recurring times", () => {
  const timezone = ["BEGIN:VTIMEZONE", "TZID:Custom/New_York", "BEGIN:STANDARD", "DTSTART:19701101T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD", "BEGIN:DAYLIGHT", "DTSTART:19700308T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT", "END:VTIMEZONE"];
  const rows = event(["UID:vt-dst", "DTSTART;TZID=Custom/New_York:20261025T100000", "DTEND;TZID=Custom/New_York:20261025T110000", "RRULE:FREQ=WEEKLY;COUNT=2"]);
  const result = parseCalendarFeed(feed(timezone, rows), { ...range, from: "2026-10-01", to: "2026-12-01" });
  assert.deepEqual(result.events.map((row) => [row.date, row.start]), [["2026-10-25", "23:00"], ["2026-11-02", "00:00"]]);
});

test("long spans intersect the requested window and the end boundary is exclusive", () => {
  const result = parseCalendarFeed(feed(
    event(["UID:long", "DTSTART;VALUE=DATE:20260701", "DTEND;VALUE=DATE:20261001"]),
    event(["UID:ends-at-from", "DTSTART;VALUE=DATE:20260831", "DTEND;VALUE=DATE:20260901"]),
    event(["UID:starts-at-to", "DTSTART;TZID=Asia/Seoul:20261001T000000", "DTEND;TZID=Asia/Seoul:20261001T010000"]),
    event(["UID:overnight", "DTSTART;TZID=Asia/Seoul:20260831T230000", "DTEND;TZID=Asia/Seoul:20260901T020000"])), range);
  assert.deepEqual(result.events.map((row) => row.id), ["long::single", "overnight::single"]);
  assert.equal(result.events[0].date, "2026-07-01");
  assert.equal(result.events[0].endDate, "2026-10-01");
});

test("RDATE and all-day default end are respected", () => {
  const result = parseCalendarFeed(feed(event(["UID:rdate", "DTSTART;VALUE=DATE:20260910", "RDATE;VALUE=DATE:20260917", "SUMMARY:추가 회기"])), range);
  assert.deepEqual(result.events.map((row) => [row.date, row.endDate]), [["2026-09-10", "2026-09-11"], ["2026-09-17", "2026-09-18"]]);
  const excluded = parseCalendarFeed(feed(event(["UID:rdate", "DTSTART;VALUE=DATE:20260910", "RDATE;VALUE=DATE:20260917", "EXDATE;VALUE=DATE:20260910"])), range);
  assert.deepEqual(excluded.events.map((row) => row.date), ["2026-09-17"]);
});

test("equivalent recurrence IDs in different TZIDs replace the original occurrence", () => {
  const master = event(["UID:cross-zone", "DTSTART;TZID=America/New_York:20260907T100000", "DTEND;TZID=America/New_York:20260907T110000", "RRULE:FREQ=WEEKLY;COUNT=1"]);
  const movedOutside = event(["UID:cross-zone", "RECURRENCE-ID;TZID=Asia/Seoul:20260907T230000", "DTSTART;TZID=America/New_York:20261007T100000", "DTEND;TZID=America/New_York:20261007T110000"]);
  assert.deepEqual(parseCalendarFeed(feed(master, movedOutside), range).events, []);
});

test("a malformed component fails the entire feed instead of returning a partial snapshot", () => {
  for (const bad of [
    "<html>Login</html>", feed(single()).replace("END:VEVENT\r\n", ""),
    feed(single(), event(["UID:bad", "DTSTART:20260230T100000Z"])),
    feed(single(), event(["UID:bad", "DTSTART;TZID=Unknown/Zone:20260921T100000"])),
    feed(single(), event(["UID:bad", "DTSTART:20260921T250000Z"])),
    feed(single(), event(["UID:bad", "DTSTART:20260921T100000Z", "DTEND:20260921T090000Z"])),
    feed(single(), event(["DTSTART:20260921T100000Z"])),
    feed(single(), single()),
    feed(["BEGIN:VTIMEZONE", "TZID:Empty/Zone", "END:VTIMEZONE"], single()),
    feed(event(["UID:exrule", "DTSTART:20260921T010000Z", "EXRULE:FREQ=DAILY"])),
  ]) assert.throws(() => parseCalendarFeed(bad, range), (error) => error.status === 502);
});

test("event and recurrence limits fail without returning a truncated list", () => {
  const text = feed(event(["UID:many", "DTSTART:20260901T010000Z", "DTEND:20260901T020000Z", "RRULE:FREQ=DAILY;COUNT=10"]));
  assert.throws(() => parseCalendarFeed(text, range, { maxEvents: 2 }), /너무 많/);
  assert.throws(() => parseCalendarFeed(text, range, { maxIterations: 2 }), /너무 많/);
  const large = feed(event(["UID:large", "DTSTART:20260101T010000Z", "RRULE:FREQ=DAILY;COUNT=800", `SUMMARY:${"x".repeat(5000)}`]));
  assert.throws(() => parseCalendarFeed(large, { ...range, from: "2026-01-01", to: "2028-04-01" }), /너무 많/);
});

test("network requests use the fixed encoded Google public feed URL and never follow redirects", async () => {
  let requested;
  const result = await publicCalendarResponse(range, { now: 0, fetchImpl: async (url, options) => { requested = { url, options }; return responseFor(feed(single())); } });
  assert.equal(result.status, 200);
  assert.equal(requested.url, "https://calendar.google.com/calendar/ical/example%40gmail.com/public/basic.ics");
  assert.equal(requested.options.method, "GET");
  assert.equal(requested.options.redirect, "error");
  assert.equal(requested.options.cache, "no-store");
  assert.match(result.headers["Cache-Control"], /no-store/);
  assert.equal(result.body.events.length, 1);
  let calls = 0;
  const invalid = await publicCalendarResponse({ ...range, calendarId: "http://127.0.0.1" }, { fetchImpl: async () => { calls++; } });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
});

test("upstream failures, timeouts and oversized streamed responses return errors only", async () => {
  const missing = await publicCalendarResponse(range, { fetchImpl: async () => responseFor("no", { status: 404 }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.events, undefined);
  const huge = await publicCalendarResponse(range, { fetchImpl: async () => responseFor("small", { headers: { "content-length": String(MAX_BYTES + 1) } }) });
  assert.equal(huge.status, 502);
  const streamed = await publicCalendarResponse(range, { fetchImpl: async () => responseFor(new Uint8Array(MAX_BYTES + 1)) });
  assert.equal(streamed.status, 502);
  const timed = await publicCalendarResponse(range, { timeoutMs: 15, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
  assert.equal(timed.status, 504);
});

test("worker hard timeout can stop a recurrence rule that never yields an occurrence", async () => {
  const impossible = feed(event(["UID:impossible", "DTSTART:20260901T010000Z", "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30"]));
  const started = Date.now();
  const result = await publicCalendarResponse(range, { parseTimeoutMs: 200, fetchImpl: async () => responseFor(impossible) });
  assert.equal(result.status, 502);
  assert.equal(result.body.events, undefined);
  assert.ok(Date.now() - started < 4000);
});

test("local/Vercel and Netlify adapters reject mutations", async () => {
  const reply = {};
  await handler({ method: "POST", url: "/api/google-calendar" }, { writeHead: (status, headers) => Object.assign(reply, { status, headers }), end: (body) => { reply.body = JSON.parse(body); } });
  assert.equal(reply.status, 405);
  assert.equal(reply.headers.Allow, "GET");
  const netlify = require("../netlify/functions/google-calendar.js");
  const result = await netlify.handler({ httpMethod: "DELETE" });
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers.Allow, "GET");
});
