import test from "node:test";
import assert from "node:assert/strict";
import { documentScheduleOf, documentScheduleError, patchDocumentSchedule, toggleDocument, localDocumentTime } from "../src/documentSchedule.mjs";

test("legacy document flags remain readable without invented completion dates", () => {
  const sub = { docs: { 사업계획서: true }, todos: [] };
  assert.equal(documentScheduleOf(sub, "사업계획서").completedAt, "");
  const next = patchDocumentSchedule(sub, "사업계획서", { plannedDate: "2026-09-21", plannedTime: "" });
  assert.equal(next.docs.사업계획서, true);
  assert.equal(next.docSchedule.사업계획서.completedAt, "");
  assert.equal(sub.docSchedule, undefined);
});

test("completion stamps local wall time and preserves other documents and plans", () => {
  const sub = { docs: { 영수증: true }, docSchedule: {
    사업계획서: { plannedDate: "2026-09-21", plannedTime: "14:30" },
    영수증: { completedAt: "2026-09-20T11:20" },
  } };
  const next = toggleDocument(sub, "사업계획서", new Date(2026, 8, 21, 14, 37, 42));
  assert.deepEqual(next.docs, { 영수증: true, 사업계획서: true });
  assert.equal(next.docSchedule.사업계획서.completedAt, "2026-09-21T14:37");
  assert.equal(next.docSchedule.사업계획서.plannedTime, "14:30");
  assert.equal(next.docSchedule.영수증.completedAt, "2026-09-20T11:20");
  assert.equal(sub.docs.사업계획서, undefined);
  assert.equal(localDocumentTime(new Date(2026, 0, 2, 0, 5)), "2026-01-02T00:05");
});

test("completion correction survives undo and a new completion gets a fresh time", () => {
  const checked = toggleDocument({ docs: {} }, "사업계획서", new Date(2026, 8, 21, 10, 0));
  const corrected = patchDocumentSchedule(checked, "사업계획서", { completedAt: "2026-09-20T09:15" });
  const undone = toggleDocument(corrected, "사업계획서");
  assert.equal(undone.docs.사업계획서, false);
  assert.equal(undone.docSchedule.사업계획서.completedAt, "2026-09-20T09:15");
  assert.equal(toggleDocument(undone, "사업계획서", new Date(2026, 8, 22, 11, 30)).docSchedule.사업계획서.completedAt, "2026-09-22T11:30");
});

test("date-only planning is valid but orphan times and invalid timestamps are rejected", () => {
  assert.equal(documentScheduleError({ plannedDate: "2026-09-21" }), "");
  assert.notEqual(documentScheduleError({ plannedTime: "10:00" }), "");
  assert.notEqual(documentScheduleError({ plannedDate: "2026-02-30" }), "");
  assert.notEqual(documentScheduleError({ plannedDate: "2026-09-21", plannedTime: "24:00" }), "");
  assert.notEqual(documentScheduleError({ completedAt: "2026-09-21" }), "");
  assert.equal(documentScheduleError({ completedAt: "2024-02-29T00:00" }), "");
  assert.throws(() => patchDocumentSchedule({ docs: {} }, "사업계획서", { plannedTime: "10:00" }));
});

test("metadata survives backup JSON and document mode changes", () => {
  const sub = patchDocumentSchedule({ docMode: "expense", docs: { 영수증: true } }, "영수증", { plannedDate: "2026-09-21", completedAt: "2026-09-21T15:20" });
  const restored = JSON.parse(JSON.stringify({ ...sub, docMode: "plain", hasExpense: false }));
  assert.equal(restored.docs.영수증, true);
  assert.deepEqual(documentScheduleOf(restored, "영수증"), documentScheduleOf(sub, "영수증"));
});
