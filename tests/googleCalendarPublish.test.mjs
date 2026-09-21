import test from "node:test";
import assert from "node:assert/strict";
import { publishCalendarReservation } from "../src/googleCalendarPublish.mjs";
import { googleEventId } from "../src/googleCalendarWriteDomain.mjs";

const calendarId = "counsel+team@group.calendar.google.com";
const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
const appointment = (patch = {}) => ({ id: "local-reservation-1", clientId: "client-1", type: "개인상담",
  date: "2026-09-21", start: "10:00", end: "10:50", place: "마음", status: "scheduled", ...patch });
const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const remoteEvent = (id, patch = {}) => ({ id, iCalUID: `${id}@google.com`, status: "confirmed",
  extendedProperties: { private: { workboardReservationId: "local-reservation-1" } }, ...patch });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
const cancelled = (error) => error.code === "cancelled";

test("publication sends only the public scheduling payload and private local identity", async () => {
  const reservation = Object.freeze(appointment({ type: "비공개상담유형", name: "비공개실명", clientName: "비공개내담자",
    phone: "010-1234-9876", memo: "비공개메모", log: { text: "비공개일지" }, access_token: "private-token" }));
  const expectedId = await googleEventId(reservation.id);
  const calls = [];
  const receipt = await publishCalendarReservation(reservation, calendarId, async (url, options) => {
    calls.push({ url, options });
    return response(remoteEvent(expectedId, { access_token: "discard-response-token", description: "discard-response-details" }));
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${eventsUrl}?sendUpdates=none`);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    summary: "상담 예약", location: "마음",
    start: { dateTime: "2026-09-21T10:00:00+09:00", timeZone: "Asia/Seoul" },
    end: { dateTime: "2026-09-21T10:50:00+09:00", timeZone: "Asia/Seoul" },
    extendedProperties: { private: { workboardReservationId: reservation.id } }, id: expectedId,
  });
  assert.doesNotMatch(calls[0].options.body, /비공개|010-1234|client-1|private-token/);
  assert.deepEqual(receipt, { calendarId, eventId: expectedId, iCalUID: `${expectedId}@google.com` });
  assert.equal(reservation.source, undefined);
});

test("a duplicate POST reads the same ID and does not update or create a replacement event", async () => {
  const expectedId = await googleEventId(appointment().id);
  const calls = [];
  const receipt = await publishCalendarReservation(appointment(), calendarId, async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === "POST") throw httpError(409);
    return response(remoteEvent(expectedId));
  });
  assert.deepEqual(calls, [{ url: `${eventsUrl}?sendUpdates=none`, method: "POST" }, { url: `${eventsUrl}/${expectedId}`, method: "GET" }]);
  assert.equal(receipt.eventId, expectedId);
});

test("retry after an ambiguous network failure preserves the ID and recovers the only created event", async () => {
  const stored = new Map(), ids = [], methods = [];
  const networkFailure = new Error("response lost after remote creation");
  const fetchCalendar = async (url, options) => {
    methods.push(options.method);
    if (options.method === "POST") {
      const payload = JSON.parse(options.body);
      ids.push(payload.id);
      if (stored.has(payload.id)) throw httpError(409);
      stored.set(payload.id, remoteEvent(payload.id));
      throw networkFailure;
    }
    return response(stored.get(url.split("/").at(-1)));
  };
  await assert.rejects(publishCalendarReservation(appointment(), calendarId, fetchCalendar), (error) => error === networkFailure);
  const receipt = await publishCalendarReservation(appointment(), calendarId, fetchCalendar);
  assert.equal(ids[0], ids[1]);
  assert.equal(receipt.eventId, ids[0]);
  assert.equal(stored.size, 1);
  assert.deepEqual(methods, ["POST", "POST", "GET"]);
});

test("both new and recovered responses must have the expected ID, local owner metadata and usable iCalUID", async () => {
  const expectedId = await googleEventId(appointment().id);
  const invalid = [
    { id: "b0different" }, { id: undefined }, { status: "cancelled" },
    { extendedProperties: {} }, { extendedProperties: { private: { workboardReservationId: "another-local-id" } } },
    { extendedProperties: { shared: { workboardReservationId: appointment().id } } },
    { iCalUID: undefined }, { iCalUID: {} }, { iCalUID: "" }, { iCalUID: " uid " },
    { iCalUID: "line\nbreak" }, { iCalUID: "\ud800" }, { iCalUID: "a".repeat(1025) },
  ];
  for (const recovered of [false, true]) {
    for (const patch of invalid) {
      let calls = 0;
      await assert.rejects(publishCalendarReservation(appointment(), calendarId, async (_url, options) => {
        calls++;
        if (recovered && options.method === "POST") throw httpError(409);
        return response(remoteEvent(expectedId, patch));
      }), (error) => error.code === "invalid_remote_event");
      assert.equal(calls, recovered ? 2 : 1);
    }
  }
});

test("non-conflict POST errors and failed conflict lookups are propagated without another write", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const failure = httpError(status);
    await assert.rejects(publishCalendarReservation(appointment(), calendarId, async () => { calls++; throw failure; }), (error) => error === failure);
    assert.equal(calls, 1);
  }
  const methods = [], missing = httpError(404);
  await assert.rejects(publishCalendarReservation(appointment(), calendarId, async (_url, options) => {
    methods.push(options.method);
    throw options.method === "POST" ? httpError(409) : missing;
  }), (error) => error === missing);
  assert.deepEqual(methods, ["POST", "GET"]);
});

test("invalid local data or calendar targets cannot start a remote request", async () => {
  let calls = 0;
  const noFetch = async () => { calls++; throw new Error("unexpected fetch"); };
  await assert.rejects(publishCalendarReservation(appointment({ status: "cancelled" }), calendarId, noFetch), /취소/);
  await assert.rejects(publishCalendarReservation(appointment({ source: "google-calendar" }), calendarId, noFetch), /외부/);
  await assert.rejects(publishCalendarReservation(appointment(), "https://evil.example/calendar", noFetch));
  assert.equal(calls, 0);
});

test("a guard cancelled before or during ID calculation prevents the POST", async () => {
  let calls = 0;
  const noFetch = async () => { calls++; throw new Error("unexpected fetch"); };
  await assert.rejects(publishCalendarReservation(appointment(), calendarId, noFetch, () => false), cancelled);
  let current = true;
  const publishing = publishCalendarReservation(appointment(), calendarId, noFetch, () => current);
  current = false;
  await assert.rejects(publishing, cancelled);
  assert.equal(calls, 0);
});

test("cancellation after POST prevents reading its body or fetching a conflict", async () => {
  for (const conflict of [false, true]) {
    let current = true, calls = 0, bodyReads = 0;
    await assert.rejects(publishCalendarReservation(appointment(), calendarId, async () => {
      calls++; current = false;
      if (conflict) throw httpError(409);
      const result = response({});
      result.json = async () => { bodyReads++; return {}; };
      return result;
    }, () => current), cancelled);
    assert.equal(calls, 1);
    assert.equal(bodyReads, 0);
  }
});

test("a response body completed after cancellation cannot produce a receipt for local mutation", async () => {
  const expectedId = await googleEventId(appointment().id);
  let current = true, finishBody, markBodyStarted;
  const bodyStarted = new Promise((resolve) => { markBodyStarted = resolve; });
  const publishing = publishCalendarReservation(appointment(), calendarId, async () => {
    const result = response({});
    result.json = () => { markBodyStarted(); return new Promise((resolve) => { finishBody = resolve; }); };
    return result;
  }, () => current);
  await bodyStarted;
  current = false;
  finishBody(remoteEvent(expectedId));
  await assert.rejects(publishing, cancelled);
});
