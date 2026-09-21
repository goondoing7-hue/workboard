import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_STATUSES, RESERVATION_STATUSES, clientStatus, reservationStatus,
  mergeReservation, reservationScheduleChanged, findReservationConflicts, validateReservation, addMinutes, sessionNumber,
} from "../src/counselingDomain.mjs";

const clients = [{ id: "c1", name: "테스트 내담자" }, { id: "c2", name: "동명이인" }];
const appointment = (patch = {}) => ({
  id: "r1", clientId: "c1", type: "개인상담", date: "2026-09-21",
  start: "10:00", end: "11:00", ...patch,
});

test("legacy records get compatible statuses without mutating source data", () => {
  const legacyClient = { name: "테스트" };
  const legacy = appointment({ done: true });
  assert.equal(clientStatus(legacyClient), "active");
  assert.equal(clientStatus({ status: "waiting" }), "waiting");
  assert.equal(clientStatus({ status: "unknown" }), "active");
  assert.equal(reservationStatus(legacy), "done");
  assert.equal(reservationStatus({ done: false }), "scheduled");
  assert.equal(reservationStatus({ status: "cancelled", done: true }), "cancelled");
  assert.equal(reservationStatus({ status: "unknown", done: true }), "done");
  assert.equal(legacy.status, undefined);
  assert.equal(legacyClient.status, undefined);
  assert.equal(CLIENT_STATUSES.closed, "상담종결");
  assert.equal(RESERVATION_STATUSES.noshow, "노쇼");
});

test("reservation edits preserve journals, attachments, identity and unknown extension fields", () => {
  const log = { text: "테스트 일지", files: [{ id: "f1", url: "https://example.test" }] };
  const previous = appointment({ log, createdAt: 100, integration: { revision: 3 }, done: true });
  const result = mergeReservation(previous, { date: "2026-09-22", memo: "변경" }, 500);
  assert.deepEqual(result, { ...previous, date: "2026-09-22", memo: "변경", status: "done", updatedAt: 500 });
  assert.equal(result.log, log);
  assert.equal(previous.date, "2026-09-21");
  assert.equal(previous.updatedAt, undefined);
});

test("calendar done toggles and explicit reservation statuses stay consistent", () => {
  const cancelled = appointment({ status: "cancelled", done: false });
  const done = mergeReservation(cancelled, { done: true }, 1);
  assert.equal(done.status, "done");
  assert.equal(done.done, true);
  const reopened = mergeReservation(done, { done: false }, 2);
  assert.equal(reopened.status, "scheduled");
  assert.equal(reopened.done, false);
  const explicit = mergeReservation(done, { status: "noshow", done: true }, 3);
  assert.equal(explicit.status, "noshow");
  assert.equal(explicit.done, false);
  assert.equal(mergeReservation(reopened, { status: "done" }, 4).done, true);
  assert.equal(mergeReservation(cancelled, { memo: "보관" }, 5).status, "cancelled");
});

test("unchanged legacy time slots can complete or reopen without triggering schedule validation", () => {
  const legacy = appointment({ end: undefined });
  const done = mergeReservation(legacy, { done: true });
  const reopened = mergeReservation(done, { done: false });
  assert.equal(reservationScheduleChanged(legacy, done), false);
  assert.equal(reservationScheduleChanged(done, reopened), false);
  assert.equal(reservationScheduleChanged(legacy, { ...legacy, start: legacy.start, end: "" }), false);
  const untimed = appointment({ start: undefined, end: null });
  assert.equal(reservationScheduleChanged(untimed, { ...untimed, start: "", end: "" }), false);
  assert.equal(reservationScheduleChanged(legacy, { ...legacy, place: "새 상담실", memo: "메모 수정", method: "전화" }), false);
});

test("new reservations and actual schedule field changes require validation", () => {
  const previous = appointment();
  assert.equal(reservationScheduleChanged(undefined, previous), true);
  assert.equal(reservationScheduleChanged(null, previous), true);
  for (const patch of [{ clientId: "c2" }, { type: "마음결" }, { date: "2026-09-22" },
    { start: "10:15" }, { end: "11:15" }, { start: "", end: "" }]) {
    assert.equal(reservationScheduleChanged(previous, { ...previous, ...patch }), true, JSON.stringify(patch));
  }
  assert.equal(reservationScheduleChanged(previous, { ...previous }), false);
});

test("reactivating cancelled or no-show reservations rechecks the occupied slot", () => {
  for (const status of ["cancelled", "noshow"]) {
    const previous = appointment({ status });
    assert.equal(reservationScheduleChanged(previous, mergeReservation(previous, { status: "scheduled" })), true);
    assert.equal(reservationScheduleChanged(previous, mergeReservation(previous, { status: "done" })), true);
    assert.equal(reservationScheduleChanged(previous, mergeReservation(previous, { done: true })), true);
    assert.equal(reservationScheduleChanged(previous, mergeReservation(previous, { memo: "정리" })), false);
    assert.equal(reservationScheduleChanged(previous, mergeReservation(previous, { status: status === "cancelled" ? "noshow" : "cancelled" })), false);
  }
  const active = appointment();
  assert.equal(reservationScheduleChanged(active, mergeReservation(active, { status: "cancelled" })), false);
});

test("conflicts cover partial overlap and containment but allow adjacent appointments", () => {
  const candidate = appointment();
  const rows = [
    appointment({ id: "before", start: "09:00", end: "10:00" }),
    appointment({ id: "after", start: "11:00", end: "12:00" }),
    appointment({ id: "partial-left", start: "09:30", end: "10:30" }),
    appointment({ id: "partial-right", start: "10:30", end: "11:30" }),
    appointment({ id: "inside", start: "10:15", end: "10:45" }),
    appointment({ id: "surrounds", start: "09:30", end: "11:30" }),
  ];
  assert.deepEqual(findReservationConflicts(candidate, rows).map((row) => row.id),
    ["partial-left", "partial-right", "inside", "surrounds"]);
});

test("conflicts exclude own edits, different dates, cancelled/no-show and missing or invalid times", () => {
  const candidate = appointment();
  const rows = [
    appointment(),
    appointment({ id: "tomorrow", date: "2026-09-22" }),
    appointment({ id: "cancelled", status: "cancelled" }),
    appointment({ id: "noshow", status: "noshow" }),
    appointment({ id: "untimed", start: "", end: "" }),
    appointment({ id: "half-time", end: "" }),
    appointment({ id: "bad-time", start: "25:00" }),
    appointment({ id: "backward", start: "11:00", end: "10:00" }),
  ];
  assert.deepEqual(findReservationConflicts(candidate, rows), []);
  const done = appointment({ id: "completed", done: true });
  assert.deepEqual(findReservationConflicts(candidate, [done]), [done]);
  assert.deepEqual(findReservationConflicts({ ...candidate, status: "cancelled" }, [done]), []);
  assert.deepEqual(findReservationConflicts({ ...candidate, start: "" }, [done]), []);
});

test("validation requires an existing client, a type and a real calendar date", () => {
  const valid = appointment();
  assert.equal(validateReservation(valid, clients), "");
  for (const patch of [{ clientId: "" }, { clientId: "deleted" }, { type: " " },
    { date: "2026-02-29" }, { date: "2026-04-31" }, { date: "2026-9-21" },
    { date: "0000-01-01" }, { date: "2026-13-01" }, { date: "2026-01-00" }]) {
    assert.notEqual(validateReservation({ ...valid, ...patch }, clients), "", JSON.stringify(patch));
  }
  assert.equal(validateReservation({ ...valid, date: "2028-02-29" }, clients), "");
  assert.notEqual(validateReservation({ ...valid, date: "2100-02-29" }, clients), "");
  assert.equal(validateReservation({ ...valid, date: "2000-02-29" }, clients), "");
});

test("validation supports unscheduled times while rejecting partial, malformed or reversed ranges", () => {
  assert.equal(validateReservation(appointment({ start: "", end: "" }), clients), "");
  assert.equal(validateReservation(appointment({ start: undefined, end: undefined }), clients), "");
  for (const patch of [{ start: "" }, { end: "" }, { start: "9:00" }, { start: "24:00" },
    { start: "10:60" }, { end: "10:00" }, { end: "09:59" }, { end: "11:00:00" }]) {
    assert.notEqual(validateReservation(appointment(patch), clients), "", JSON.stringify(patch));
  }
});

test("conflict feedback contains the occupied slot but no client information", () => {
  const existing = appointment({ id: "other", clientId: "c2", name: "비공개이름", phone: "010-1111-2222" });
  const error = validateReservation(appointment({ start: "10:30", end: "11:30" }), clients, [existing]);
  assert.match(error, /2026-09-21 10:00–11:00/);
  assert.doesNotMatch(error, /비공개이름|010-1111-2222|c2/);
  assert.equal(validateReservation(appointment({ start: "11:00", end: "12:00" }), clients, [existing]), "");
});

test("duration shortcuts cannot silently roll into the next or previous day", () => {
  assert.equal(addMinutes("09:40", 50), "10:30");
  assert.equal(addMinutes("23:00", 59), "23:59");
  assert.equal(addMinutes("23:00", 60), "");
  assert.equal(addMinutes("00:10", -15), "");
  assert.equal(addMinutes("10:00", -30), "09:30");
  for (const value of ["", "9:00", "24:00", "09:60", null]) assert.equal(addMinutes(value, 60), "");
  assert.equal(addMinutes("10:00", 1.5), "");
});

test("session numbering is per client and type, chronological, and excludes cancelled/no-show", () => {
  const earlier = appointment({ id: "early", date: "2026-09-20", done: true });
  const target = appointment({ id: "target" });
  const later = appointment({ id: "later", date: "2026-09-22" });
  const cancelled = appointment({ id: "cancelled", date: "2026-09-19", status: "cancelled" });
  const rows = [later, appointment({ id: "other-client", clientId: "c2" }), cancelled,
    target, appointment({ id: "other-type", type: "마음결" }),
    appointment({ id: "noshow", status: "noshow" }), earlier];
  assert.equal(sessionNumber(target, rows), 2);
  assert.equal(sessionNumber(later, rows), 3);
  assert.equal(sessionNumber(cancelled, rows), null);
  assert.equal(sessionNumber(appointment({ status: "noshow" }), rows), null);
  assert.equal(rows[0], later);
});

test("same-time sessions use stable IDs and unsaved reservations get a projected number", () => {
  const a = appointment({ id: "a" });
  const b = appointment({ id: "b" });
  assert.equal(sessionNumber(b, [b, a]), 2);
  assert.equal(sessionNumber(b, [a, b]), 2);
  assert.equal(sessionNumber(appointment({ id: "new", start: "11:00", end: "12:00" }), [b, a]), 3);
  assert.equal(sessionNumber(appointment({ id: "a", date: "2026-09-23" }), [b, a]), 2);
});

test("unlinked imported reservations have no session number until explicitly linked to a client", () => {
  const unlinked = appointment({ id: "external-1", source: "google-calendar", clientId: "", date: "2026-09-20" });
  const otherUnlinked = appointment({ id: "external-2", source: "google-calendar", clientId: null, date: "2026-09-19" });
  const existing = appointment({ id: "existing", date: "2026-09-18" });
  const rows = [otherUnlinked, existing, unlinked];
  assert.equal(sessionNumber(unlinked, rows), null);
  assert.equal(sessionNumber(otherUnlinked, rows), null);
  assert.equal(sessionNumber(existing, rows), 1);
  assert.equal(sessionNumber({ ...unlinked, clientId: "c1" }, rows), 2);
  assert.equal(unlinked.clientId, "");
});
