import test from "node:test";
import assert from "node:assert/strict";
import {
  MINUTES_PER_DAY, normalizeVacation, minutesOf, snapMinutes, vacationError,
  vacationSummary, vacationTotal, vacationYears, sortVacations,
  formatDuration, formatHours, splitDuration, joinDuration, REST_STEPS, toggleVacationUsed,
} from "../src/vacationDomain.mjs";

const D = MINUTES_PER_DAY;
const rows = [
  { id: "g1", type: "월차", mode: "적립", date: "2026-01-01", note: "2026년 월차 부여", minutes: 15 * D },
  { id: "u1", type: "월차", mode: "사용", date: "2026-03-04", note: "가족 행사", minutes: D, used: true },
  { id: "u2", type: "월차", mode: "사용", date: "2026-05-02", note: "오전 반차", minutes: 240, used: true },
  { id: "u3", type: "월차", mode: "사용", date: "2026-10-09", note: "병원", minutes: 30, used: false },
  { id: "g2", type: "대체휴가", mode: "적립", date: "2026-04-20", note: "토요일 캠프", minutes: D },
  { id: "g3", type: "대체휴가", mode: "적립", date: "2026-06-15", note: "야간 상담", minutes: 90 },
  { id: "u4", type: "대체휴가", mode: "사용", date: "2026-07-01", note: "휴식", minutes: 60, used: true },
];

test("30분 단위 사용이 잔여에서 정확히 빠진다", () => {
  const s = vacationSummary(rows, "월차");
  assert.equal(s.granted, 15 * D);
  assert.equal(s.used, D + 240);
  assert.equal(s.planned, 30);
  assert.equal(s.left, 15 * D - D - 240 - 30);
  assert.equal(formatDuration(s.left), "13일 3시간 30분");
});

test("대체휴가도 30분 단위로 센다", () => {
  const s = vacationSummary(rows, "대체휴가");
  assert.equal(s.granted, D + 90);
  assert.equal(s.left, D + 90 - 60);
  assert.equal(formatDuration(s.left), "1일 30분");
});

test("총 잔여는 두 종류를 더한 값이다", () => {
  const t = vacationTotal(rows);
  const m = vacationSummary(rows, "월차"), d = vacationSummary(rows, "대체휴가");
  assert.equal(t.left, m.left + d.left);
  assert.equal(t.granted, m.granted + d.granted);
  assert.equal(t.planned, 30);
  assert.equal(vacationTotal([]).left, 0);
});

test("예전 일 단위(days) 기록을 분으로 읽어 온다", () => {
  assert.equal(minutesOf({ days: 1 }), D);
  assert.equal(minutesOf({ days: 0.5 }), 240);
  assert.equal(minutesOf({ days: 15 }), 15 * D);
  const legacy = [
    { id: "a", type: "월차", mode: "적립", date: "2026-01-01", days: 15 },
    { id: "b", type: "월차", mode: "사용", date: "2026-02-01", days: 0.5, used: true },
  ];
  const s = vacationSummary(legacy, "월차");
  assert.equal(s.granted, 15 * D);
  assert.equal(s.used, 240);
  assert.equal(formatDuration(s.left), "14일 4시간");
});

test("minutes가 있으면 days보다 우선한다", () => {
  assert.equal(minutesOf({ minutes: 30, days: 5 }), 30);
  assert.equal(normalizeVacation({ minutes: 0, days: 5 }).minutes, 0);
});

test("30분 단위로 맞춰 준다", () => {
  assert.equal(snapMinutes(29), 30);
  assert.equal(snapMinutes(45), 60);
  assert.equal(snapMinutes(44), 30);
  assert.equal(snapMinutes(0), 0);
  assert.equal(snapMinutes(-10), 0);
  assert.equal(snapMinutes("바보"), 0);
});

test("30분 단위가 아니거나 빈 시간은 저장 전에 막는다", () => {
  assert.equal(vacationError({ date: "2026-03-04", minutes: 30 }), "");
  assert.equal(vacationError({ date: "2026-03-04", minutes: D }), "");
  assert.match(vacationError({ date: "2026-03-04", minutes: 0 }), /30분 이상/);
  assert.match(vacationError({ date: "2026-03-04", minutes: 20 }), /30분 단위/);
  assert.match(vacationError({ date: "", minutes: 30 }), /날짜/);
});

test("일·시간을 나누고 다시 합쳐도 값이 같다", () => {
  for (const m of [0, 30, 90, 480, 510, 7 * D + 450]) {
    const { days, rest } = splitDuration(m);
    assert.equal(joinDuration(days, rest), m);
    assert.ok(rest < D && rest % 30 === 0);
  }
  assert.deepEqual(splitDuration(510), { days: 1, rest: 30 });
  assert.equal(REST_STEPS.length, 16);
  assert.equal(REST_STEPS.at(-1), 450);
});

test("시간 표기가 사람이 읽는 대로 나온다", () => {
  assert.equal(formatDuration(0), "0분");
  assert.equal(formatDuration(30), "30분");
  assert.equal(formatDuration(60), "1시간");
  assert.equal(formatDuration(90), "1시간 30분");
  assert.equal(formatDuration(D), "1일");
  assert.equal(formatDuration(D + 30), "1일 30분");
  assert.equal(formatDuration(D + 90), "1일 1시간 30분");
  assert.equal(formatDuration(-30), "−30분");
  assert.equal(formatHours(90), "1.5시간");
  assert.equal(formatHours(120), "2시간");
});

test("적립 기록은 사용 표시를 가질 수 없고, 표시를 바꿔도 잔여는 그대로다", () => {
  assert.equal(normalizeVacation({ mode: "적립", used: true }).used, false);
  const before = vacationSummary(rows, "월차").left;
  const next = toggleVacationUsed(rows, "u3");
  assert.equal(next.find((r) => r.id === "u3").used, true);
  const after = vacationSummary(next, "월차");
  assert.equal(after.left, before);
  assert.equal(after.planned, 0);
});

test("연도별로 나눠 세고 최근 날짜가 위로 온다", () => {
  const mixed = [...rows, { id: "z", type: "월차", mode: "적립", date: "2025-01-01", minutes: 12 * D }];
  assert.equal(vacationSummary(mixed, "월차", "2025").granted, 12 * D);
  assert.equal(vacationTotal(mixed, "2026").granted, 16 * D + 90);
  assert.deepEqual(vacationYears(mixed), ["2026", "2025"]);
  assert.equal(sortVacations(rows)[0].date, "2026-10-09");
  assert.equal(rows[0].id, "g1");
});
