import test from "node:test";
import assert from "node:assert/strict";
import { googleEventId, buildCalendarEvent, calendarWriteFingerprint, linkWrittenReservation, linkWrittenReservationInList } from "../src/googleCalendarWriteDomain.mjs";
import { mergeGoogleCalendar } from "../src/googleCalendarDomain.mjs";

const appointment = (patch = {}) => ({ id: "local-reservation-1", clientId: "client-1", type: "개인상담",
  date: "2026-09-21", start: "10:00", end: "10:50", place: "마음", status: "scheduled", ...patch });

test("event IDs are stable across retries, distinct per reservation, and accepted by Google's alphabet and length", async () => {
  const first = await googleEventId("local-reservation-1");
  assert.equal(await googleEventId("local-reservation-1"), first);
  assert.notEqual(await googleEventId("local-reservation-2"), first);
  assert.match(first, /^[0-9a-v]{5,1024}$/);
  assert.equal(first.length, 66);
  assert.match(await googleEventId("한글-예약-id"), /^[0-9a-v]{66}$/);
  assert.doesNotMatch(first, /local-reservation-1/);
});

test("IDs must belong to saved local reservations", async () => {
  for (const id of [undefined, null, "", 100, " pending ", "gcal:external:event", "a\nb", "a".repeat(1025)]) {
    await assert.rejects(googleEventId(id), Error);
  }
});

test("timed payloads contain explicit Korean time-zone values and private local identity only", () => {
  assert.deepEqual(buildCalendarEvent(appointment()), {
    summary: "상담 예약",
    location: "마음",
    start: { dateTime: "2026-09-21T10:00:00+09:00", timeZone: "Asia/Seoul" },
    end: { dateTime: "2026-09-21T10:50:00+09:00", timeZone: "Asia/Seoul" },
    extendedProperties: { private: { workboardReservationId: "local-reservation-1" } },
  });
  assert.deepEqual(buildCalendarEvent(appointment()), buildCalendarEvent(appointment()));
});

test("name, client IDs, logs, notes, issues, contacts, birthdays and files cannot leak through payload construction", () => {
  const sensitive = appointment({ type: "비공개맞춤상담유형", name: "비공개실명", clientName: "비공개내담자", phone: "010-1234-9876", birth: "2010-01-02",
    issue: "비공개주호소", memo: "비공개예약메모", note: "비공개특이사항", counselor: "비공개상담자",
    log: { text: "비공개상담일지", files: [{ name: "비공개첨부", url: "https://private.example/file" }] },
    description: "비공개설명", attendees: [{ email: "private@example.test" }], google: { token: "private-token" } });
  const payload = buildCalendarEvent(sensitive);
  assert.deepEqual(payload, buildCalendarEvent(appointment()));
  assert.deepEqual(Object.keys(payload).sort(), ["end", "extendedProperties", "location", "start", "summary"]);
  assert.doesNotMatch(JSON.stringify(payload), /비공개|010-1234|2010-01-02|client-1|private@example|private-token|private\.example/);
});

test("unset time produces an all-day event with an exclusive next-day end, including leap and year boundaries", () => {
  for (const [date, nextDate] of [["2026-09-21", "2026-09-22"], ["2028-02-29", "2028-03-01"], ["2026-12-31", "2027-01-01"]]) {
    const event = buildCalendarEvent(appointment({ date, start: "", end: "" }));
    assert.deepEqual(event.start, { date });
    assert.deepEqual(event.end, { date: nextDate });
    assert.equal(event.start.timeZone, undefined);
    assert.equal(event.end.dateTime, undefined);
  }
  assert.deepEqual(buildCalendarEvent(appointment({ start: undefined, end: null })).start, { date: "2026-09-21" });
});

test("invalid dates and partial, malformed, reversed or midnight-wrapping local times cannot be written", () => {
  for (const patch of [{ date: "2026-02-29" }, { date: "2026-09-31" }, { date: "0000-01-01" }, { date: "bad" },
    { date: "9999-12-31", start: "", end: "" }, { start: "", end: "11:00" }, { start: "10:00", end: "" },
    { start: "9:00" }, { start: "24:00" }, { start: "10:60" }, { start: 1000 }, { end: "10:00" },
    { end: "09:59" }, { start: "23:50", end: "00:10" }]) {
    assert.throws(() => buildCalendarEvent(appointment(patch)), Error, JSON.stringify(patch));
  }
});

test("locations use the exact six options; arbitrary location text is never sent", () => {
  for (const place of ["마음", "어우리", "공감", "집단", "모래놀이", "meet"]) {
    assert.equal(buildCalendarEvent(appointment({ place })).location, place);
  }
  for (const place of ["", null, "개인주소", "상담실 1", "Meet"]) {
    assert.throws(() => buildCalendarEvent(appointment({ place })), Error);
  }
});

test("source reservations and cancellation cannot create or cancel Google events", () => {
  assert.throws(() => buildCalendarEvent(appointment({ source: "google-calendar" })), /외부/);
  assert.throws(() => buildCalendarEvent(appointment({ source: "another-calendar" })), /외부/);
  assert.throws(() => buildCalendarEvent(appointment({ id: "gcal:external:event" })), Error);
  assert.throws(() => buildCalendarEvent(appointment({ status: "cancelled" })), /취소/);
  assert.equal(buildCalendarEvent(appointment({ status: "done" })).status, undefined);
  assert.equal(buildCalendarEvent(appointment({ status: "noshow" })).status, undefined);
});

test("fingerprints react only to date, time, place, type and normalized status", () => {
  const first = calendarWriteFingerprint(appointment());
  assert.equal(calendarWriteFingerprint(appointment({ clientId: "other-client", name: "다른 이름", phone: "010", birth: "2010-01-01",
    memo: "메모", issue: "주호소", log: { text: "일지" }, updatedAt: 500, createdAt: 100, googleEventId: "remote-id" })), first);
  for (const patch of [{ date: "2026-09-22" }, { start: "10:05" }, { end: "11:00" }, { place: "meet" },
    { type: "가족상담" }, { status: "done" }, { status: "cancelled" }, { status: "noshow" }]) {
    assert.notEqual(calendarWriteFingerprint(appointment(patch)), first, JSON.stringify(patch));
  }
  assert.equal(calendarWriteFingerprint(appointment({ status: undefined, done: true })), calendarWriteFingerprint(appointment({ status: "done" })));
  assert.equal(calendarWriteFingerprint(appointment({ id: "another-local-id" })), first);
});

const receipt = { calendarId: "counsel@group.calendar.google.com", eventId: "b0abcdef12345", iCalUID: "event+uid@google.com" };

test("confirmed writes retain local records and link through the actual returned iCalUID", () => {
  const log = { text: "남길 일지", files: [{ id: "file" }] };
  const local = appointment({ log, memo: "로컬 메모", status: "done", done: true, type: "비공개맞춤유형", custom: "keep" });
  const linked = linkWrittenReservation(local, { ...receipt, access_token: "do-not-store", attendees: [{ email: "do-not-store" }] }, 100);
  assert.deepEqual(linked, { ...local, source: "google-calendar", calendarId: receipt.calendarId,
    externalId: "event%2Buid%40google.com::single", externalTitle: "상담 예약", endDate: local.date, allDay: false,
    externalAwaitingFeed: true, externalCancelled: false,
    googleWrite: { state: "sent", ...receipt, at: 100 }, updatedAt: 100 });
  assert.equal(linked.id, local.id);
  assert.equal(linked.log, log);
  assert.equal(local.source, undefined);
  assert.doesNotMatch(JSON.stringify(linked), /do-not-store/);
  const allDay = linkWrittenReservation(appointment({ date: "2026-12-31", start: "", end: "" }), receipt, 100);
  assert.equal(allDay.endDate, "2027-01-01");
  assert.equal(allDay.allDay, true);
});

test("link receipts must contain valid primitive IDs, not arbitrary API objects", () => {
  for (const patch of [{ calendarId: null }, { calendarId: "not-a-calendar" }, { eventId: {} }, { eventId: "invalid-w-id" },
    { iCalUID: null }, { iCalUID: {} }, { iCalUID: "" }, { iCalUID: "line\nbreak" }, { iCalUID: "\ud800" }]) {
    assert.throws(() => linkWrittenReservation(appointment(), { ...receipt, ...patch }, 100), Error);
  }
  assert.throws(() => linkWrittenReservation(appointment(), receipt, NaN), Error);
  assert.throws(() => linkWrittenReservation(appointment({ source: "google-calendar" }), receipt, 100), /외부/);
});

test("delayed public-feed echoes do not cancel or duplicate a newly written reservation", () => {
  const linked = linkWrittenReservation(appointment({ log: { text: "기존 일지" } }), receipt, 100);
  const payload = (events, fetchedAt) => ({ calendarId: receipt.calendarId, from: "2026-09-01", to: "2026-10-01", fetchedAt, events });
  const initial = { resv: [linked] };
  const missing = mergeGoogleCalendar(initial, payload([], 200), 200);
  assert.equal(missing.resv.length, 1);
  assert.equal(missing.resv[0], linked);
  assert.equal(missing.resv[0].status, "scheduled");
  const echo = { id: linked.externalId, title: "상담 예약", date: linked.date, endDate: linked.date,
    start: linked.start, end: linked.end, place: linked.place, allDay: false };
  const appeared = mergeGoogleCalendar(missing, payload([echo], 300), 300);
  assert.equal(appeared.resv.length, 1);
  assert.equal(appeared.resv[0].id, linked.id);
  assert.equal(appeared.resv[0].clientId, linked.clientId);
  assert.equal(appeared.resv[0].log, linked.log);
  assert.equal(appeared.resv[0].externalAwaitingFeed, false);
  const repeated = mergeGoogleCalendar(appeared, payload([echo], 400), 400);
  assert.equal(repeated.resv[0], appeared.resv[0]);
  const deleted = mergeGoogleCalendar(repeated, payload([], 500), 500);
  assert.equal(deleted.resv[0].status, "cancelled");
  assert.equal(deleted.resv[0].externalCancelled, true);
  assert.equal(deleted.resv[0].log, linked.log);
});

test("an explicit cancelled feed entry ends the awaiting period and retains local history", () => {
  const linked = linkWrittenReservation(appointment({ status: "done", done: true }), receipt, 100);
  const next = mergeGoogleCalendar({ resv: [linked] }, { calendarId: receipt.calendarId, from: "2026-09-01", to: "2026-10-01",
    fetchedAt: 200, events: [{ id: linked.externalId, cancelled: true }] }, 200);
  assert.equal(next.resv.length, 1);
  assert.equal(next.resv[0].externalAwaitingFeed, false);
  assert.equal(next.resv[0].status, "cancelled");
  assert.equal(next.resv[0].externalPreviousStatus, "done");
});

test("a public feed arriving before the creation response is coalesced into the original local ID", () => {
  const local = appointment({ type: "가족상담", status: "done", done: true, log: { text: "로컬 일지" } });
  const echo = { ...linkWrittenReservation(appointment({ id: "echo" }), receipt, 50), id: "gcal:public-echo", googleWrite: undefined, externalAwaitingFeed: undefined };
  const unrelated = appointment({ id: "unrelated" });
  const anotherCalendar = { ...echo, id: "gcal:other-calendar", calendarId: "other@group.calendar.google.com" };
  const result = linkWrittenReservationInList([echo, unrelated, local, anotherCalendar], local.id, receipt, 100);
  assert.deepEqual(result.mergedEchoIds, [echo.id]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.resv.length, 3);
  assert.equal(result.resv[0], unrelated);
  assert.equal(result.resv[2], anotherCalendar);
  const linked = result.resv[1];
  assert.equal(linked.id, local.id);
  assert.equal(linked.clientId, local.clientId);
  assert.equal(linked.type, local.type);
  assert.equal(linked.status, "done");
  assert.equal(linked.log, local.log);
  assert.equal(linked.externalAwaitingFeed, false);
  assert.deepEqual(linked.googleMergedEchoes, [echo]);
  const deleted = mergeGoogleCalendar({ resv: result.resv }, { calendarId: receipt.calendarId,
    from: "2026-09-01", to: "2026-10-01", fetchedAt: 200, events: [] }, 200);
  assert.equal(deleted.resv.find((r) => r.id === local.id).externalCancelled, true);
});

test("coalescing preserves conflicting client/status edits and merges both journals and distinct attachments", () => {
  const localFile = { id: "shared-file-id", url: "https://local.example/one", name: "기존 첨부" };
  const echoFile = { id: "shared-file-id", url: "https://echo.example/two", name: "피드 화면 첨부" };
  const local = appointment({ type: "가족상담", status: "scheduled", memo: "로컬 메모", log: { text: "로컬 일지", files: [localFile], localExtension: true } });
  const echo = { ...linkWrittenReservation(appointment({ id: "echo" }), receipt, 50), id: "gcal:echo", clientId: "other-client",
    type: "심리검사", status: "done", done: true, date: "2026-09-25", memo: "피드 메모", custom: { preserve: true },
    log: { text: "피드 화면에서 작성한 일지", files: [localFile, echoFile], echoExtension: true } };
  const result = linkWrittenReservationInList([local, echo], local.id, receipt, 100);
  const linked = result.resv[0];
  assert.equal(result.resv.length, 1);
  assert.equal(linked.clientId, local.clientId);
  assert.equal(linked.type, local.type);
  assert.equal(linked.status, local.status);
  assert.equal(linked.date, local.date);
  assert.equal(linked.memo, local.memo);
  assert.match(linked.log.text, /로컬 일지/);
  assert.match(linked.log.text, /피드 화면에서 작성한 일지/);
  assert.equal(linked.log.localExtension, true);
  assert.equal(linked.log.echoExtension, true);
  assert.deepEqual(linked.log.files.map((file) => file.url), [localFile.url, echoFile.url]);
  assert.notEqual(linked.log.files[0].id, linked.log.files[1].id);
  assert.deepEqual(linked.googleMergedEchoes, [echo]);
  assert.deepEqual(result.conflicts.map((entry) => entry.field), ["clientId", "type", "status"]);
  assert.equal(local.log.text, "로컬 일지");
  assert.equal(echoFile.id, "shared-file-id");
});

test("an echo's journal is retained when the original has no journal; repeated confirmations are idempotent", () => {
  const local = appointment();
  const echo = { ...linkWrittenReservation(appointment({ id: "echo" }), receipt, 50), id: "gcal:echo", log: { text: "유일한 일지", files: [] } };
  const first = linkWrittenReservationInList([local, echo], local.id, receipt, 100);
  assert.equal(first.resv[0].log, echo.log);
  const repeated = linkWrittenReservationInList(first.resv, local.id, receipt, 200);
  assert.equal(repeated.resv, first.resv);
  assert.equal(repeated.resv[0].updatedAt, 100);
  assert.deepEqual(repeated.mergedEchoIds, []);
});

test("a deleted local reservation is not recreated by a late creation response", () => {
  const rows = [appointment({ id: "another" })];
  const result = linkWrittenReservationInList(rows, "removed-local", receipt, 100);
  assert.equal(result.resv, rows);
  assert.equal(result.missingLocal, true);
  assert.deepEqual(result.mergedEchoIds, []);
});
