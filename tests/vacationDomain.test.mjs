import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVacation, vacationError, vacationSummary, vacationYears,
  sortVacations, formatDays, toggleVacationUsed,
} from "../src/vacationDomain.mjs";

const rows = [
  { id: "g1", type: "월차", mode: "적립", date: "2026-01-01", note: "2026년 월차 부여", days: 15 },
  { id: "u1", type: "월차", mode: "사용", date: "2026-03-04", note: "가족 행사", days: 1, used: true },
  { id: "u2", type: "월차", mode: "사용", date: "2026-05-02", note: "오전 반차", days: 0.5, used: true },
  { id: "u3", type: "월차", mode: "사용", date: "2026-10-09", note: "연휴 붙여 쉬기", days: 2, used: false },
  { id: "g2", type: "대체휴가", mode: "적립", date: "2026-04-20", note: "토요일 캠프 인솔", days: 1 },
  { id: "g3", type: "대체휴가", mode: "적립", date: "2026-06-15", note: "야간 상담", days: 0.5 },
  { id: "u4", type: "대체휴가", mode: "사용", date: "2026-07-01", note: "휴식", days: 1, used: true },
];

test("월차 잔여는 적립에서 사용완료와 사용예정을 모두 뺀다", () => {
  const s = vacationSummary(rows, "월차");
  assert.equal(s.granted, 15);
  assert.equal(s.used, 1.5);
  assert.equal(s.planned, 2);
  assert.equal(s.spent, 3.5);
  assert.equal(s.left, 11.5);
});

test("대체휴가는 적립 기록을 모아 잔여를 만든다", () => {
  const s = vacationSummary(rows, "대체휴가");
  assert.equal(s.granted, 1.5);
  assert.equal(s.used, 1);
  assert.equal(s.planned, 0);
  assert.equal(s.left, 0.5);
});

test("종류가 섞여도 서로의 잔여를 건드리지 않는다", () => {
  assert.equal(vacationSummary(rows, "월차").granted, 15);
  assert.equal(vacationSummary(rows, "대체휴가").granted, 1.5);
  assert.equal(vacationSummary([], "월차").left, 0);
});

test("연도를 지정하면 그 해 기록만 센다", () => {
  const mixed = [...rows, { id: "g9", type: "월차", mode: "적립", date: "2025-01-01", days: 12 }];
  assert.equal(vacationSummary(mixed, "월차", "2026").granted, 15);
  assert.equal(vacationSummary(mixed, "월차", "2025").granted, 12);
  assert.deepEqual(vacationYears(mixed), ["2026", "2025"]);
});

test("반일 단위 합계에 소수점 오차가 남지 않는다", () => {
  const half = Array.from({ length: 3 }, (_, i) => ({ id: "h" + i, type: "월차", mode: "사용", date: "2026-02-0" + (i + 1), days: 0.1, used: true }));
  assert.equal(vacationSummary(half, "월차").used, 0.3);
});

test("적립 기록은 사용 표시를 가질 수 없다", () => {
  assert.equal(normalizeVacation({ mode: "적립", used: true }).used, false);
  const next = toggleVacationUsed(rows, "g1");
  assert.equal(next.find((r) => r.id === "g1").used, undefined);
});

test("사용 표시는 켜고 끌 수 있고 잔여는 그대로다", () => {
  const before = vacationSummary(rows, "월차");
  const next = toggleVacationUsed(rows, "u3");
  assert.equal(next.find((r) => r.id === "u3").used, true);
  const after = vacationSummary(next, "월차");
  assert.equal(after.left, before.left);
  assert.equal(after.used, 3.5);
  assert.equal(after.planned, 0);
});

test("잘못된 입력은 저장 전에 막는다", () => {
  assert.match(vacationError({ date: "", days: 1 }), /날짜/);
  assert.match(vacationError({ date: "2026-13-40", days: 1 }), /날짜/);
  assert.match(vacationError({ date: "2026-03-04", days: 0 }), /일수/);
  assert.match(vacationError({ date: "2026-03-04", days: 400 }), /일수/);
  assert.equal(vacationError({ date: "2026-03-04", days: 0.5 }), "");
});

test("알 수 없는 값이 들어와도 안전한 기본값으로 읽는다", () => {
  const v = normalizeVacation({ type: "연차", mode: "환불", days: "안녕", date: 20260101 });
  assert.equal(v.type, "월차");
  assert.equal(v.mode, "사용");
  assert.equal(v.days, 0);
  assert.equal(v.date, "");
});

test("최근 날짜가 위로 정렬되고 원본은 그대로다", () => {
  const sorted = sortVacations(rows);
  assert.equal(sorted[0].date, "2026-10-09");
  assert.equal(rows[0].id, "g1");
});

test("일수 표기는 정수와 반일을 구분한다", () => {
  assert.equal(formatDays(2), "2");
  assert.equal(formatDays(0.5), "0.5");
  assert.equal(formatDays(1.0), "1");
});
