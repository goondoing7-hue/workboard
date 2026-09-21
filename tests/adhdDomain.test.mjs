import test from "node:test";
import assert from "node:assert/strict";
import { ADHD_ITEMS, RESPONSE_LABELS, scoreAdhd } from "../src/adhdDomain.mjs";

const thresholds = [2, 2, 2, 3, 3, 3];

test("adult ASRS screener exposes six distinct questions and five response options", () => {
  assert.equal(ADHD_ITEMS.length, 6);
  assert.equal(new Set(ADHD_ITEMS.map(item => item.id)).size, 6);
  assert.ok(ADHD_ITEMS.every(item => typeof item.text === "string" && item.text.trim()));
  assert.deepEqual(ADHD_ITEMS.map(item => item.threshold), thresholds);
  assert.equal(RESPONSE_LABELS.length, 5);
  assert.ok(RESPONSE_LABELS.every(label => typeof label === "string" && label.trim()));
});

test("unanswered and incomplete assessments cannot produce a result", () => {
  const partiallySparse = [0, 0, 0, 0, 0, 0];
  delete partiallySparse[2];
  for (const answers of [
    undefined,
    null,
    [],
    Array(6),
    Array(6).fill(null),
    Array(6).fill(undefined),
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    partiallySparse,
  ]) {
    assert.equal(scoreAdhd(answers), null);
  }
});

test("each response must be a numeric integer from zero through four", () => {
  const invalidValues = [null, undefined, "", "0", "4", false, true, NaN, Infinity, -Infinity, -1, 5, 1.5, {}, [], new Number(2)];
  for (let index = 0; index < 6; index += 1) {
    for (const value of invalidValues) {
      const answers = Array(6).fill(0);
      answers[index] = value;
      assert.equal(scoreAdhd(answers), null, `question ${index + 1} accepted an invalid response`);
    }
  }
  for (const answers of ["000000", {}, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, length: 6 }, new Uint8Array(6)]) {
    assert.equal(scoreAdhd(answers), null);
  }
});

test("each question uses its own threshold, including equality and maximum frequency", () => {
  for (let index = 0; index < 6; index += 1) {
    for (const value of [thresholds[index] - 1, thresholds[index], 4]) {
      const answers = Array(6).fill(0);
      answers[index] = value;
      const expectedPositive = value >= thresholds[index];
      assert.deepEqual(scoreAdhd(answers), {
        positiveCount: expectedPositive ? 1 : 0,
        needsFollowUp: false,
        positiveItems: thresholds.map((_, position) => position === index && expectedPositive),
      }, `question ${index + 1}, response ${value}`);
    }
  }
});

test("follow-up threshold is four positive answers, independent of summed frequency", () => {
  assert.deepEqual(scoreAdhd([4, 4, 4, 2, 2, 2]), {
    positiveCount: 3,
    needsFollowUp: false,
    positiveItems: [true, true, true, false, false, false],
  });
  assert.deepEqual(scoreAdhd([2, 2, 2, 3, 0, 0]), {
    positiveCount: 4,
    needsFollowUp: true,
    positiveItems: [true, true, true, true, false, false],
  });
  assert.deepEqual(scoreAdhd([0, 0, 2, 3, 3, 3]), {
    positiveCount: 4,
    needsFollowUp: true,
    positiveItems: [false, false, true, true, true, true],
  });
});

test("completed minimum and maximum responses remain valid without mutating answers", () => {
  const minimum = Object.freeze(Array(6).fill(0));
  const maximum = Object.freeze(Array(6).fill(4));
  assert.deepEqual(scoreAdhd(minimum), {
    positiveCount: 0,
    needsFollowUp: false,
    positiveItems: Array(6).fill(false),
  });
  assert.deepEqual(scoreAdhd(maximum), {
    positiveCount: 6,
    needsFollowUp: true,
    positiveItems: Array(6).fill(true),
  });
});
