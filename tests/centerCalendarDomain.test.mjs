import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CENTER_CALENDAR_ID, prepareCenterEvent, deleteCenterEvent, centerGoogleEventId, buildCenterGoogleEvent, centerRemoteEvent,
  mergeCenterCalendar, resolveCenterConflict, isHiddenCenterEvent, writeNextCenterEvent } from "../src/centerCalendarDomain.mjs";

const event = (patch = {}) => ({ id: "local-1", pid: "", title: "센터 회의", date: "2026-09-22", start: "09:00", end: "10:00", memo: "안건", place: "회의실", done: false, ...patch });
const remote = (patch = {}) => ({ id: "google123", etag: '"v1"', status: "confirmed", summary: "센터 회의", description: "안건", location: "회의실",
  start: { dateTime: "2026-09-22T09:00:00+09:00" }, end: { dateTime: "2026-09-22T10:00:00+09:00" }, ...patch });
const payload = (items, patch = {}) => ({ calendarId: CENTER_CALENDAR_ID, from: "2026-01-01", to: "2026-12-31", name: "센터", timeZone: "Asia/Seoul", items, ...patch });
const linked = (patch = {}) => centerRemoteEvent(remote(), event(patch));
function runner(initial, request, options = {}) {
  let data = { events: [initial] };
  return { get data() { return data; }, replace(value) { data = value; }, run: () => writeNextCenterEvent({ getData: () => data, setData: (fn) => { data = fn(data); }, request, isEventStored: () => true, ...options }) };
}

test("센터 ID는 사용자가 제공한 공유 링크의 값이다", () => {
  assert.equal(Buffer.from("ODU5ZjQ1ZmRhMWY0ZWJkNjg4MmQxNzViNDk2MjE1NWE4OTE3Y2MxYzExZTcxY2JlY2IxMTY0MGJmYmUyMTRiM0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29t", "base64").toString(), CENTER_CALENDAR_ID);
});
test("기존 로컬 일정은 완료 체크만으로 전송되지 않는다", () => {
  const old = event();
  assert.equal(prepareCenterEvent(old, { done: true }).centerSync, undefined);
  assert.equal(prepareCenterEvent(old, { title: "새 회의" }).centerSync.state, "pending");
  assert.equal(prepareCenterEvent(undefined, event({ pid: "project-1" })).centerSync, undefined);
});
test("연결된 센터 일정의 ID와 카테고리는 편집 중 보존한다", () => {
  const old = linked();
  const next = prepareCenterEvent(old, { title: "수정", pid: "project-1" });
  assert.equal(next.id, old.id); assert.equal(next.pid, "");
  assert.equal(next.centerSync.eventId, "google123"); assert.equal(next.centerSync.etag, '"v1"');
});
test("결정적 Google ID로 재시도 시 중복을 방지한다", async () => {
  const expected = "c0" + createHash("sha256").update("workboard:center:local-1").digest("hex");
  assert.equal(await centerGoogleEventId("local-1"), expected);
  assert.match(expected, /^[a-v0-9]{5,1024}$/);
});
test("공개 전송은 일정 필드만 포함하며 완료 및 내부 데이터는 제외한다", () => {
  const value = buildCenterGoogleEvent(event({ done: true, internal: "비공개", client: "내담자" }));
  assert.deepEqual(Object.keys(value).sort(), ["description", "end", "extendedProperties", "location", "start", "summary"]);
  assert.equal(value.extendedProperties.private.workboardEventId, "local-1");
  assert.equal(JSON.stringify(value).includes("비공개"), false);
});
test("종일 종료일은 exclusive이고 자정 넘는 시간 일정도 지원한다", () => {
  const allDay = buildCenterGoogleEvent(event({ start: "", end: "" }));
  assert.deepEqual(allDay.start, { date: "2026-09-22" }); assert.deepEqual(allDay.end, { date: "2026-09-23" });
  const overnight = buildCenterGoogleEvent(event({ start: "23:30", end: "01:00", endDate: "2026-09-23" }));
  assert.equal(overnight.end.dateTime, "2026-09-23T01:00:00+09:00");
  assert.throws(() => buildCenterGoogleEvent(event({ end: "08:00" })), /종료/);
  assert.throws(() => buildCenterGoogleEvent(event({ title: "a".repeat(501) })), /500/);
});
test("Google의 다른 시간대와 반복 인스턴스를 한국시간으로 가져온다", () => {
  const value = centerRemoteEvent(remote({ id: "series_20260922T000000Z", recurringEventId: "series", originalStartTime: { dateTime: "2026-09-22T00:00:00Z" },
    start: { dateTime: "2026-09-22T00:00:00Z" }, end: { dateTime: "2026-09-22T01:00:00Z" } }));
  assert.equal(value.start, "09:00"); assert.equal(value.centerSync.recurringEventId, "series");
  assert.equal(value.centerSync.eventId, "series_20260922T000000Z");
});
test("제목이 같은 로컬 일정과 원격 일정을 합치지 않는다", () => {
  const merged = mergeCenterCalendar({ events: [event()] }, payload([remote()]));
  assert.equal(merged.events.length, 2); assert.equal(merged.events[0].id, "local-1");
  assert.equal(merged.events[0].centerSync, undefined);
});
test("Google 수정은 로컬 ID와 완료 체크를 유지한다", () => {
  const merged = mergeCenterCalendar({ events: [linked({ done: true })] }, payload([remote({ etag: '"v2"', summary: "변경됨" })]));
  assert.equal(merged.events[0].id, "local-1"); assert.equal(merged.events[0].done, true);
  assert.equal(merged.events[0].title, "변경됨"); assert.equal(merged.events[0].centerSync.etag, '"v2"');
});
test("성공한 목록에서만 삭제/범위 밖 이동을 반영하고 로컬 전송 대기는 보존한다", () => {
  const first = linked(), pending = prepareCenterEvent(linked({ id: "pending" }), { title: "로컬 수정" });
  const result = mergeCenterCalendar({ events: [first, pending, event()] }, payload([]));
  assert.equal(isHiddenCenterEvent(result.events[0]), true);
  assert.equal(result.events[1].title, "로컬 수정"); assert.equal(isHiddenCenterEvent(result.events[1]), false);
  assert.equal(result.events[2].centerSync, undefined);
  assert.throws(() => mergeCenterCalendar({ events: [first] }, payload([{ ...remote(), start: {} }])), /날짜/);
  assert.equal(first.centerSync.cancelled, false);
});
test("수집 범위 밖의 기존 일정은 missing으로 취소하지 않는다", () => {
  const old = centerRemoteEvent(remote({ start: { date: "2028-01-01" }, end: { date: "2028-01-02" } }));
  assert.equal(mergeCenterCalendar({ events: [old] }, payload([])).events[0].centerSync.cancelled, false);
});
test("로컬 삭제 tombstone은 목록 갱신으로 부활하지 않는다", () => {
  const data = deleteCenterEvent({ events: [linked()] }, "local-1");
  assert.equal(data.events[0].centerSync.action, "delete");
  assert.equal(isHiddenCenterEvent(mergeCenterCalendar(data, payload([remote()])).events[0]), true);
});
test("원격 취소와 종일 여러 날짜의 종료 경계를 보존한다", () => {
  const days = centerRemoteEvent(remote({ start: { date: "2026-09-22" }, end: { date: "2026-09-25" } }));
  assert.equal(days.allDay, true); assert.equal(days.endDate, "2026-09-25");
  const result = mergeCenterCalendar({ events: [linked()] }, payload([{ id: "google123", status: "cancelled" }]));
  assert.equal(isHiddenCenterEvent(result.events[0]), true);
});
test("영구 저장되지 않은 변경은 Google로 보내지 않는다", async () => {
  let calls = 0;
  const run = runner(prepareCenterEvent(undefined, event()), async () => { calls++; }, { isEventStored: () => false });
  assert.equal(await run.run(), "idle"); assert.equal(calls, 0);
});
test("새 ID를 먼저 저장한 뒤 생성하고 같은 ID의 timeout 재시도를 유지한다", async () => {
  const calls = [];
  const run = runner(prepareCenterEvent(undefined, event()), async (operation, value) => {
    calls.push({ operation, value });
    return { calendarId: CENTER_CALENDAR_ID, item: remote({ id: value.eventId }) };
  });
  assert.equal(await run.run(), "prepared"); assert.equal(calls.length, 0);
  const id = run.data.events[0].centerSync.eventId;
  assert.equal(await run.run(), "written"); assert.equal(calls[0].value.eventId, id);
  assert.equal(run.data.events[0].centerSync.state, "synced");
});
test("전송 중 편집한 최신 내용은 성공 응답으로 덮지 않고 다음 etag로 다시 보낸다", async () => {
  const old = prepareCenterEvent(linked(), { title: "첫 수정" });
  let run;
  run = runner(old, async () => {
    run.replace({ events: [prepareCenterEvent(run.data.events[0], { title: "나중 수정", done: true })] });
    return { calendarId: CENTER_CALENDAR_ID, item: remote({ etag: '"v2"', summary: "첫 수정" }) };
  });
  assert.equal(await run.run(), "written");
  assert.equal(run.data.events[0].title, "나중 수정"); assert.equal(run.data.events[0].done, true);
  assert.equal(run.data.events[0].centerSync.state, "pending"); assert.equal(run.data.events[0].centerSync.etag, '"v2"');
});
test("잠금 후 늦게 도착한 성공 응답은 데이터에 적용하지 않는다", async () => {
  let current = true;
  const run = runner(prepareCenterEvent(linked(), { title: "수정" }), async () => {
    current = false; return { calendarId: CENTER_CALENDAR_ID, item: remote({ etag: '"v2"' }) };
  }, { isCurrent: () => current });
  assert.equal(await run.run(), "cancelled"); assert.equal(run.data.events[0].centerSync.state, "pending");
});
test("412는 로컬 변경을 남기고 최신 원격 버전 확인 후 명시적으로 해결한다", async () => {
  const run = runner(prepareCenterEvent(linked(), { title: "내 수정" }), async () => { throw Object.assign(new Error("충돌"), { status: 412 }); });
  assert.equal(await run.run(), "conflict"); assert.equal(run.data.events[0].title, "내 수정");
  const untouched = resolveCenterConflict(run.data, "local-1", "local");
  assert.equal(untouched.events[0].centerSync.state, "conflict");
  const withRemote = mergeCenterCalendar(run.data, payload([remote({ etag: '"v3"', summary: "구글 수정" })]));
  const local = resolveCenterConflict(withRemote, "local-1", "local");
  assert.equal(local.events[0].title, "내 수정"); assert.equal(local.events[0].centerSync.etag, '"v3"');
  const google = resolveCenterConflict(withRemote, "local-1", "remote");
  assert.equal(google.events[0].title, "구글 수정"); assert.equal(google.events[0].id, "local-1");
});
test("목록에서 없는 충돌 일정은 개별 get 전까지 삭제로 단정하지 않는다", () => {
  const item = { ...linked(), centerSync: { ...linked().centerSync, state: "conflict", conflictChecked: false } };
  const merged = mergeCenterCalendar({ events: [item] }, payload([]));
  assert.equal(merged.events[0].centerSync.conflictChecked, false);
  assert.notEqual(merged.events[0].centerSync.conflictMissing, true);
});
test("Google에서 삭제한 일정의 로컬 편집은 재등록 또는 삭제를 선택할 수 있다", async () => {
  for (const status of [404, 410]) {
    const run = runner(prepareCenterEvent(linked(), { title: "내 수정" }), async () => { throw Object.assign(new Error("삭제됨"), { status }); });
    assert.equal(await run.run(), "conflict"); assert.equal(run.data.events[0].title, "내 수정");
  }
});
test("잘못된 일정 편집은 큐에 저장하기 전에 거부한다", () => {
  assert.throws(() => prepareCenterEvent(event(), { end: "08:00" }), /종료/);
  assert.throws(() => prepareCenterEvent(undefined, event({ title: "a".repeat(501) })), /500/);
});
test("삭제된 원격을 복원할 때 로컬 ID를 유지하며 새 Google ID를 만든다", async () => {
  const item = { ...linked(), centerSync: { ...linked().centerSync, state: "conflict", conflictChecked: true, conflictMissing: true } };
  const result = resolveCenterConflict({ events: [item] }, item.id, "local", 1234);
  assert.equal(result.events[0].id, item.id); assert.equal(result.events[0].centerSync.eventId, "");
  assert.equal(buildCenterGoogleEvent(result.events[0]).extendedProperties.private.workboardEventId, "local-1:restore:1234");
  assert.notEqual(await centerGoogleEventId("local-1"), await centerGoogleEventId(result.events[0].centerSync.creationId));
});
test("생성 응답 전에 삭제한 일정은 get으로 실제 등록 여부를 확인한다", async () => {
  const queued = prepareCenterEvent(undefined, event());
  queued.centerSync.eventId = await centerGoogleEventId(queued.id);
  const deleted = deleteCenterEvent({ events: [queued] }, queued.id).events[0];
  const calls = [];
  const run = runner(deleted, async (operation, value) => {
    calls.push(operation);
    return operation === "get" ? { calendarId: CENTER_CALENDAR_ID, item: remote({ id: value.eventId }) } : { calendarId: CENTER_CALENDAR_ID, eventId: value.eventId, deleted: true };
  });
  assert.equal(await run.run(), "prepared"); assert.equal(run.data.events[0].centerSync.etag, '"v1"');
  assert.equal(await run.run(), "written"); assert.equal(run.data.events.length, 0);
  assert.deepEqual(calls, ["get", "delete"]);
});
test("미등록이 확인된 삭제와 실제 삭제의 실패를 구분한다", async () => {
  const queued = prepareCenterEvent(undefined, event()); queued.centerSync.eventId = await centerGoogleEventId(queued.id);
  const run = runner(deleteCenterEvent({ events: [queued] }, queued.id).events[0], async () => ({ calendarId: CENTER_CALENDAR_ID, item: null }));
  await run.run(); assert.equal(run.data.events.length, 0);
  const failed = runner(deleteCenterEvent({ events: [linked()] }, "local-1").events[0], async () => { throw Object.assign(new Error("오프라인"), { retryable: true }); });
  assert.equal(await failed.run(), "error"); assert.equal(failed.data.events.length, 1); assert.equal(isHiddenCenterEvent(failed.data.events[0]), true);
});
test("일시적 생성 실패는 동일 ID로 재시도하고 권한 오류는 큐를 보존한다", async () => {
  const queued = prepareCenterEvent(undefined, event()); queued.centerSync.eventId = await centerGoogleEventId(queued.id);
  let clock = 100, calls = 0;
  const ids = [];
  const run = runner(queued, async (_operation, value) => {
    calls++; ids.push(value.eventId);
    if (calls === 1) throw Object.assign(new Error("일시적 오류"), { retryable: true });
    return { calendarId: CENTER_CALENDAR_ID, item: remote({ id: value.eventId }) };
  }, { now: () => clock });
  assert.equal(await run.run(), "error"); assert.equal(await run.run(), "idle");
  clock = run.data.events[0].centerSync.retryAt;
  assert.equal(await run.run(), "written"); assert.equal(ids[0], ids[1]);
  const denied = runner(prepareCenterEvent(linked(), { title: "변경" }), async () => { throw Object.assign(new Error("재연결"), { status: 401 }); });
  assert.equal(await denied.run(), "error"); assert.equal(denied.data.events[0].centerSync.reauthorize, true);
  assert.equal(await denied.run(), "idle");
});
test("삭제 전송 중 새 수정이 생기면 삭제 성공으로 로컬 새 변경을 지우지 않는다", async () => {
  const deleted = deleteCenterEvent({ events: [linked()] }, "local-1").events[0];
  let run;
  run = runner(deleted, async (_operation, value) => {
    run.replace({ events: [prepareCenterEvent(run.data.events[0], { title: "되살린 일정" })] });
    return { calendarId: CENTER_CALENDAR_ID, eventId: value.eventId, deleted: true };
  });
  assert.equal(await run.run(), "written"); assert.equal(run.data.events[0].title, "되살린 일정");
  assert.equal(run.data.events[0].centerSync.state, "pending");
});
