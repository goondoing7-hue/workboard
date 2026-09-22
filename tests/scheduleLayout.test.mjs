import test from "node:test";
import assert from "node:assert/strict";
import { isAllDaySpan, layoutAllDayEvents, calendarEventsOnDay } from "../src/scheduleLayout.mjs";

const week = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"];
const positions = (layout) => layout.segments.map(({ event, ...segment }) => ({ id: event.id, ...segment }));

test("a three-day all-day schedule is one segment with an exclusive end", () => {
  const event = { id: "trip", date: "2026-09-21", endDate: "2026-09-24", allDay: true };
  assert.equal(isAllDaySpan(event), true);
  assert.deepEqual(positions(layoutAllDayEvents([event], week)), [
    { id: "trip", startCol: 1, endCol: 4, lane: 0, continuesBefore: false, continuesAfter: false },
  ]);
  assert.equal(layoutAllDayEvents([event], ["2026-09-24"]).segments.length, 0);
});

test("a span clips at week boundaries and keeps its continuation markers", () => {
  const event = { id: "training", date: "2026-09-18", endDate: "2026-09-29", start: "" };
  const first = layoutAllDayEvents([event], week);
  assert.deepEqual(positions(first), [
    { id: "training", startCol: 0, endCol: 7, lane: 0, continuesBefore: true, continuesAfter: true },
  ]);
  const nextWeek = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"];
  assert.deepEqual(positions(layoutAllDayEvents([event], nextWeek)), [
    { id: "training", startCol: 0, endCol: 2, lane: 0, continuesBefore: true, continuesAfter: false },
  ]);
});

test("overlapping schedules get separate lanes while adjacent ranges reuse a lane", () => {
  const events = [
    { id: "later", date: "2026-09-24", endDate: "2026-09-26" },
    { id: "short", date: "2026-09-21", endDate: "2026-09-23" },
    { id: "long", date: "2026-09-21", endDate: "2026-09-24" },
    { id: "overlap", date: "2026-09-22", endDate: "2026-09-25" },
  ];
  const layout = layoutAllDayEvents(events, week);
  assert.equal(layout.laneCount, 3);
  assert.deepEqual(layout.segments.map(({ event, lane }) => [event.id, lane]), [
    ["long", 0], ["short", 1], ["overlap", 2], ["later", 0],
  ]);
  assert.deepEqual(positions(layoutAllDayEvents([...events].reverse(), week)), positions(layout));
  for (const a of layout.segments) for (const b of layout.segments) {
    if (a !== b && a.lane === b.lane) assert.ok(a.endCol <= b.startCol || b.endCol <= a.startCol);
  }
});

test("date-only tasks and single-day schedules remain visible in the all-day row", () => {
  const events = [
    { id: "task", date: "2026-09-21" },
    { id: "single", date: "2026-09-22", start: "", endDate: "2026-09-23" },
    { id: "timed", date: "2026-09-21", start: "09:00", endDate: "2026-09-24" },
    { id: "explicit", date: "2026-09-23", start: "09:00", allDay: true, endDate: "2026-09-25" },
  ];
  assert.deepEqual(events.map(isAllDaySpan), [false, false, false, true]);
  assert.deepEqual(layoutAllDayEvents(events, week).segments.map(({ event, startCol, endCol }) => [event.id, startCol, endCol]), [
    ["task", 1, 2], ["single", 2, 3], ["explicit", 3, 5],
  ]);
});

test("month, year and leap-day crossings use calendar days", () => {
  const cases = [
    { dates: ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], date: "2026-09-30", endDate: "2026-10-02" },
    { dates: ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], date: "2026-12-31", endDate: "2027-01-02" },
    { dates: ["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01"], date: "2024-02-28", endDate: "2024-03-01" },
  ];
  for (const { dates, ...event } of cases) {
    assert.equal(isAllDaySpan(event), true);
    const { segments, laneCount } = layoutAllDayEvents([event], dates);
    assert.equal(laneCount, 1);
    assert.equal(segments[0].startCol, 1);
    assert.equal(segments[0].endCol, 3);
  }
});

test("legacy untimed same-day end dates remain one day without mutating stored data", () => {
  const legacy = Object.freeze({ id: "legacy", date: "2026-09-21", endDate: "2026-09-21", start: "" });
  assert.equal(isAllDaySpan(legacy), false);
  assert.deepEqual(positions(layoutAllDayEvents([legacy], week)), [
    { id: "legacy", startCol: 1, endCol: 2, lane: 0, continuesBefore: false, continuesAfter: false },
  ]);
  assert.equal(legacy.endDate, "2026-09-21");
});

test("invalid dates, reversed ranges and noncontiguous windows cannot create misleading bars", () => {
  const invalid = [
    null, {}, { date: "2026-02-29", endDate: "2026-03-03" },
    { date: "2026-09-21", endDate: "2026-09-21", allDay: true },
    { date: "2026-09-21", endDate: "2026-09-20" },
    { date: "2026-09-21", endDate: "2026-09-32" },
    { date: "2026-9-21", endDate: "2026-09-25" },
    { date: "0000-09-21", endDate: "0000-09-25" },
  ];
  assert.ok(invalid.every((event) => !isAllDaySpan(event)));
  assert.deepEqual(layoutAllDayEvents(invalid, week), { segments: [], laneCount: 0 });
  for (const dates of [[], null, ["2026-09-21", "2026-09-23"], ["2026-09-21", "2026-09-21"], ["bad"]]) {
    assert.deepEqual(layoutAllDayEvents([{ date: "2026-09-21" }], dates), { segments: [], laneCount: 0 });
  }
});

test("layout leaves frozen input data unchanged and preserves event identity", () => {
  const event = Object.freeze({ id: "kept", date: "2026-09-21", endDate: "2026-09-24", memo: "keep" });
  const events = Object.freeze([event]);
  const dates = Object.freeze([...week]);
  assert.equal(layoutAllDayEvents(events, dates).segments[0].event, event);
  assert.equal(event.memo, "keep");
  assert.deepEqual(dates, week);
});

test("legacy untimed spans stay one untimed item on middle days and exclude the end date", () => {
  const event = Object.freeze({ id: "legacy-span", date: "2026-09-21", endDate: "2026-09-24", start: "", end: "" });
  for (const date of ["2026-09-21", "2026-09-22", "2026-09-23"]) {
    const rows = calendarEventsOnDay([event], date);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].start, "");
    assert.equal(rows[0].date, event.date);
    assert.equal(rows[0].noDrag, true);
    assert.equal(isAllDaySpan(rows[0]), true);
    assert.equal(layoutAllDayEvents([event], week).segments.length, 1);
  }
  assert.deepEqual(calendarEventsOnDay([event], "2026-09-20"), []);
  assert.deepEqual(calendarEventsOnDay([event], "2026-09-24"), []);
});

test("explicit all-day records discard stale times for rendering without modifying the record", () => {
  const event = Object.freeze({ id: "all-day", date: "2026-09-21", endDate: "2026-09-24", allDay: true, start: "10:00", end: "11:00" });
  const row = calendarEventsOnDay([event], "2026-09-22")[0];
  assert.equal(row.start, "");
  assert.equal(row.end, "");
  assert.equal(row.date, event.date);
  assert.equal(row.noDrag, true);
  assert.equal(event.start, "10:00");
  assert.deepEqual(calendarEventsOnDay([event], "2026-09-24"), []);
});

test("timed multi-day records are clipped and include a non-midnight final day", () => {
  const event = Object.freeze({ id: "timed-span", date: "2026-09-21", endDate: "2026-09-23", start: "15:00", end: "10:00" });
  const first = calendarEventsOnDay([event], "2026-09-21")[0];
  const middle = calendarEventsOnDay([event], "2026-09-22")[0];
  const last = calendarEventsOnDay([event], "2026-09-23")[0];
  assert.deepEqual([first.start, first.end], ["15:00", "23:59"]);
  assert.deepEqual([middle.start, middle.end], ["00:00", "23:59"]);
  assert.deepEqual([last.start, last.end], ["00:00", "10:00"]);
  assert.equal(last.date, "2026-09-23");
  for (const row of [first, middle, last]) {
    assert.equal(row.original, event);
    assert.equal(row.noDrag, true);
    assert.equal(isAllDaySpan(row), false);
  }
  assert.deepEqual(calendarEventsOnDay([event], "2026-09-24"), []);
  assert.deepEqual(calendarEventsOnDay([{ ...event, end: "00:00" }], "2026-09-23"), []);
  assert.equal(calendarEventsOnDay([{ ...event, end: "00:00" }], "2026-09-22").length, 1);
});

test("single-day tasks and timed events keep their original objects and dates", () => {
  const tasks = [
    Object.freeze({ id: "task", date: "2026-09-21", start: "" }),
    Object.freeze({ id: "legacy", date: "2026-09-21", endDate: "2026-09-21", start: "" }),
    Object.freeze({ id: "timed", date: "2026-09-21", endDate: "2026-09-21", start: "10:00", end: "11:00" }),
  ];
  const rows = calendarEventsOnDay(Object.freeze(tasks), "2026-09-21");
  assert.equal(rows.length, 3);
  rows.forEach((row, index) => assert.equal(row, tasks[index]));
  assert.deepEqual(calendarEventsOnDay(tasks, "2026-09-22"), []);
  assert.deepEqual(calendarEventsOnDay(tasks, "2026-09-31"), []);
});
