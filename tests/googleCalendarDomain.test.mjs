import test from "node:test";
import assert from "node:assert/strict";
import { externalReservation, externalReservationTitle, mergeGoogleCalendar, parseGoogleCalendarId, reservationLastDate } from "../src/googleCalendarDomain.mjs";

const ID = "sample@group.calendar.google.com";
const OTHER = "other@group.calendar.google.com";
const event = (patch = {}) => ({ id: "event-1/20260921T010000Z", title: "상담 A", date: "2026-09-21", start: "10:00", end: "11:00", place: "마음", ...patch });
const snapshot = (events, patch = {}) => ({ calendarId: ID, name: "상담 캘린더", timeZone: "Asia/Seoul", from: "2026-09-01", to: "2026-10-01", fetchedAt: 100, events, ...patch });
const local = { id: "local-1", clientId: "client-1", type: "개인상담", date: "2026-09-21", start: "10:00", end: "11:00", status: "scheduled" };

test("calendar IDs, shared cid, embed src and iCalendar links resolve to one ID", () => {
  assert.equal(parseGoogleCalendarId(` ${ID} `), ID);
  assert.equal(parseGoogleCalendarId(`https://calendar.google.com/calendar/u/0?cid=${Buffer.from(ID).toString("base64url")}`), ID);
  assert.equal(parseGoogleCalendarId(`https://www.google.com/calendar/embed?src=${encodeURIComponent(ID)}&ctz=Asia%2FSeoul`), ID);
  assert.equal(parseGoogleCalendarId(`https://calendar.google.com/calendar/ical/${encodeURIComponent(ID)}/public/basic.ics`), ID);
  assert.equal(parseGoogleCalendarId(`https://calendar.google.com/calendar/ical/${encodeURIComponent(ID)}/private-secret/basic.ics`), ID);
  assert.equal(parseGoogleCalendarId(`https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(ID)}`), ID);
  assert.equal(parseGoogleCalendarId("ko.south_korea#holiday@group.v.calendar.google.com"), "ko.south_korea#holiday@group.v.calendar.google.com");
});

test("calendar parser rejects unrelated URLs, credentials, protocols and malformed IDs", () => {
  for (const input of ["", "상담 캘린더", "x@y", "x@y.com/path", "http://calendar.google.com/calendar?src=" + ID,
    "https://example.com/calendar?src=" + ID, "https://calendar.google.com.evil.test/calendar?src=" + ID,
    "https://user:pass@calendar.google.com/calendar?src=" + ID, "https://calendar.google.com/calendar?cid=%%%",
    "https://calendar.google.com/calendar?cid=" + Buffer.from("not-an-id").toString("base64"), "javascript:alert(1)"])
    assert.throws(() => parseGoogleCalendarId(input), Error, input);
});

test("new source reservations appear without guessing or merging people from names", () => {
  const clients = [{ id: "client-1", name: "상담 A" }];
  const data = { clients, resv: [local], projects: [{ id: "p" }], extension: "keep" };
  const next = mergeGoogleCalendar(data, snapshot([event(), event({ id: "other-instance" })]), 100);
  assert.equal(next.resv.length, 3);
  assert.equal(next.resv[0], local);
  assert.equal(next.clients, clients);
  assert.equal(next.resv[1].clientId, "");
  assert.equal(next.resv[1].type, "개인상담");
  assert.equal(next.resv[1].status, "scheduled");
  assert.equal(next.resv[1].externalTitle, "상담 A");
  assert.notEqual(next.resv[1].id, next.resv[2].id);
  assert.equal(next.extension, "keep");
  assert.equal(data.resv.length, 1);
  assert.equal(externalReservation(next.resv[1]), true);
  assert.equal(externalReservationTitle(next.resv[1]), "상담 A");
  assert.equal(externalReservationTitle(local), "");
});

test("duplicate pulls are idempotent and do not change reservation timestamps", () => {
  const first = mergeGoogleCalendar({ resv: [] }, snapshot([event(), event()]), 100);
  const second = mergeGoogleCalendar(first, snapshot([event()], { fetchedAt: 200 }), 200);
  assert.equal(first.resv.length, 1);
  assert.deepEqual(second.resv, first.resv);
  assert.equal(second.resv[0], first.resv[0]);
  assert.equal(second.googleCalendar.fetchedAt, 200);
  assert.deepEqual(mergeGoogleCalendar(second, snapshot([event()], { fetchedAt: 200 }), 300), second);
});

test("moved events update source fields while preserving identity, client, type, completion and journals", () => {
  const first = mergeGoogleCalendar({ resv: [] }, snapshot([event()]), 100);
  const log = { text: "기존 일지", files: [{ id: "attachment" }] };
  const linked = { ...first, resv: [{ ...first.resv[0], clientId: "client-1", type: "가족상담", status: "done", done: true, log, memo: "로컬 메모", custom: "preserve" }] };
  const next = mergeGoogleCalendar(linked, snapshot([event({ title: "변경된 제목", date: "2026-09-23", start: "14:15", end: "15:05", place: "meet" })], { fetchedAt: 200 }), 200);
  assert.deepEqual(next.resv[0], { ...linked.resv[0], externalTitle: "변경된 제목", date: "2026-09-23", endDate: "2026-09-23", start: "14:15", end: "15:05", place: "meet", updatedAt: 200 });
  assert.equal(next.resv[0].log, log);
  assert.equal(next.resv[0].id, first.resv[0].id);
});

test("older snapshots cannot undo moves or cancel newer reservations", () => {
  const first = mergeGoogleCalendar({ resv: [] }, snapshot([event()], { fetchedAt: 200 }), 200);
  assert.equal(mergeGoogleCalendar(first, snapshot([], { fetchedAt: 100 }), 300), first);
  assert.equal(mergeGoogleCalendar(first, snapshot([event({ date: "2026-09-20" })], { fetchedAt: 199 }), 300), first);
});

test("missing events are cancelled only inside the current synchronized window", () => {
  const first = mergeGoogleCalendar({ resv: [] }, snapshot([event(), event({ id: "outside", date: "2026-10-05" })]), 100);
  const log = { text: "남겨 둘 일지" };
  const linked = { ...first, resv: [{ ...first.resv[0], status: "done", done: true, log }, first.resv[1]] };
  const next = mergeGoogleCalendar(linked, snapshot([], { fetchedAt: 200 }), 200);
  assert.equal(next.resv.length, 2);
  assert.equal(next.resv[0].status, "cancelled");
  assert.equal(next.resv[0].externalCancelled, true);
  assert.equal(next.resv[0].externalPreviousStatus, "done");
  assert.equal(next.resv[0].log, log);
  assert.equal(next.resv[1], linked.resv[1]);
  const repeated = mergeGoogleCalendar(next, snapshot([], { fetchedAt: 300 }), 300);
  assert.equal(repeated.resv[0], next.resv[0]);
});

test("explicit source cancellation works without a date and restores previous local status on return", () => {
  for (const status of ["scheduled", "done", "noshow", "cancelled"]) {
    const first = mergeGoogleCalendar({ resv: [] }, snapshot([event()]), 100);
    first.resv[0] = { ...first.resv[0], status, done: status === "done" };
    const cancelled = mergeGoogleCalendar(first, snapshot([{ id: event().id, cancelled: true }], { fetchedAt: 200 }), 200);
    assert.equal(cancelled.resv[0].status, "cancelled");
    assert.equal(cancelled.resv[0].externalPreviousStatus, status);
    const restored = mergeGoogleCalendar(cancelled, snapshot([event()], { fetchedAt: 300 }), 300);
    assert.equal(restored.resv[0].status, status);
    assert.equal(restored.resv[0].done, status === "done");
    assert.equal(restored.resv[0].externalCancelled, false);
    assert.equal(owns(restored.resv[0], "externalPreviousStatus"), false);
  }
});

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

test("local status changes after an external cancellation survive repeated pulls and restoration", () => {
  const first = mergeGoogleCalendar({ resv: [] }, snapshot([event()]), 100);
  const cancelled = mergeGoogleCalendar(first, snapshot([], { fetchedAt: 200 }), 200);
  cancelled.resv[0] = { ...cancelled.resv[0], status: "done", done: true, updatedAt: 250 };
  const repeated = mergeGoogleCalendar(cancelled, snapshot([], { fetchedAt: 300 }), 300);
  assert.equal(repeated.resv[0].status, "done");
  const restored = mergeGoogleCalendar(repeated, snapshot([event()], { fetchedAt: 400 }), 400);
  assert.equal(restored.resv[0].status, "done");
  assert.equal(restored.resv[0].done, true);
});

test("multiple calendars and recurrence instances keep independent identities and stale-snapshot protection", () => {
  const first = mergeGoogleCalendar({ resv: [] }, snapshot([event()], { fetchedAt: 200 }), 200);
  const second = mergeGoogleCalendar(first, snapshot([event()], { calendarId: OTHER, fetchedAt: 300 }), 300);
  assert.equal(second.resv.length, 2);
  assert.notEqual(second.resv[0].id, second.resv[1].id);
  assert.equal(mergeGoogleCalendar(second, snapshot([], { fetchedAt: 100 }), 400), second);
  const emptyOther = mergeGoogleCalendar(second, snapshot([], { calendarId: OTHER, fetchedAt: 400 }), 400);
  assert.equal(emptyOther.resv[0].status, "scheduled");
  assert.equal(emptyOther.resv[1].status, "cancelled");
});

test("all-day events preserve their exclusive endDate and have no artificial appointment time", () => {
  const next = mergeGoogleCalendar({}, snapshot([event({ allDay: true, endDate: "2026-09-23" })]), 100);
  assert.equal(next.resv[0].allDay, true);
  assert.equal(next.resv[0].endDate, "2026-09-23");
  assert.equal(next.resv[0].start, "");
  assert.equal(next.resv[0].end, "");
  const fallback = mergeGoogleCalendar({}, snapshot([event({ allDay: true })]), 100);
  assert.equal(fallback.resv[0].endDate, "2026-09-22");
});

test("last occupied date respects exclusive ends without moving before the reservation start", () => {
  const external = { ...local, source: "google-calendar", endDate: "2026-09-23" };
  assert.equal(reservationLastDate({ ...local, endDate: "2026-09-23" }), local.date);
  assert.equal(reservationLastDate(external), "2026-09-23");
  assert.equal(reservationLastDate({ ...external, allDay: true }), "2026-09-22");
  assert.equal(reservationLastDate({ ...external, end: "00:00" }), "2026-09-22");
  assert.equal(reservationLastDate({ ...external, allDay: true, endDate: external.date }), external.date);
  assert.equal(reservationLastDate({ ...external, end: "00:00", endDate: external.date }), external.date);
  assert.equal(reservationLastDate({ ...external, endDate: "invalid" }), external.date);
  assert.equal(reservationLastDate({ ...external, endDate: "2026-09-19" }), external.date);
});

test("missing long events that start before the snapshot are cancelled only when their occupied dates overlap", () => {
  const first = mergeGoogleCalendar({}, snapshot([
    event({ id: "spanning-all-day", date: "2026-08-31", endDate: "2026-09-02", allDay: true }),
    event({ id: "spanning-timed", date: "2026-08-31", endDate: "2026-09-01", start: "23:00", end: "01:00" }),
    event({ id: "ends-before-all-day", date: "2026-08-31", endDate: "2026-09-01", allDay: true }),
    event({ id: "ends-before-midnight", date: "2026-08-31", endDate: "2026-09-01", start: "23:00", end: "00:00" }),
    event({ id: "starts-at-exclusive-end", date: "2026-10-01" }),
  ]), 100);
  const next = mergeGoogleCalendar(first, snapshot([], { fetchedAt: 200 }), 200);
  assert.deepEqual(next.resv.map((r) => r.status), ["cancelled", "cancelled", "scheduled", "scheduled", "scheduled"]);
  for (let index = 2; index < next.resv.length; index++) assert.equal(next.resv[index], first.resv[index]);
});

test("invalid snapshots fail atomically instead of cancelling stored reservations", () => {
  const first = mergeGoogleCalendar({}, snapshot([event()]), 100);
  for (const invalid of [snapshot(null), snapshot([], { from: "2026-02-30" }), snapshot([], { to: "2026-08-01" }),
    snapshot([event({ id: "" })]), snapshot([event({ date: "2026-09-31" })]), snapshot([event({ start: "25:00" })]),
    snapshot([event({ allDay: true, endDate: "2026-09-21" })]), snapshot([event({ endDate: "2026-09-20" })]),
    snapshot([], { fetchedAt: "invalid" })]) {
    assert.throws(() => mergeGoogleCalendar(first, invalid, 200), Error);
    assert.equal(first.resv[0].status, "scheduled");
  }
});
