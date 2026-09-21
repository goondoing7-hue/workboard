// ASRS-v1.1 Part A (6-question screener), not ASRS-5.
// Korean wording follows Harvard's Korean symptom checklist (Part A only).
// Preserve all five response options and the per-item shaded thresholds in the UI.
export const ADHD_ITEMS = Object.freeze([
  Object.freeze({
    id: "q1",
    text: "어떤 일의 어려운 부분은 끝내 놓고, 그 일을 마무리를 짓지 못해 곤란을 겪은 적이 있습니까?",
    threshold: 2,
  }),
  Object.freeze({
    id: "q2",
    text: "체계가 필요한 일을 해야 할 때 순서대로 진행하기 어려운 경우가 있습니까??",
    threshold: 2,
  }),
  Object.freeze({
    id: "q3",
    text: "약속이나 해야 할 일을 잊어버려 곤란을 겪은 적이 있습니까?",
    threshold: 2,
  }),
  Object.freeze({
    id: "q4",
    text: "골치 아픈 일은 피하거나 미루는 경우가 있습니까?",
    threshold: 3,
  }),
  Object.freeze({
    id: "q5",
    text: "오래 앉아 있을 때, 손을 만지작거리거나 발을 꼼지락거리는 경우가 있습니까?",
    threshold: 3,
  }),
  Object.freeze({
    id: "q6",
    text: "마치 모터가 달린 것처럼, 과도하게 혹은 멈출 수 없이 활동을 하는 경우가 있습니까?",
    threshold: 3,
  }),
]);

export const RESPONSE_LABELS = Object.freeze([
  "전혀 그렇지 않다",
  "거의 그렇지 않다 (드물게 그렇다)",
  "약간 혹은 가끔 그렇다",
  "자주 그렇다",
  "매우 자주 그렇다",
]);

export const ADHD_INSTRUCTIONS =
  "아래의 질문을 읽고 오른 쪽의 평가 기준에 맞춰 답하십시오.. 질문에 답하실 때에는, 지난 6개월 동안 귀하가 어떻게 느끼고 행동하였는지를 가장 잘 설명하는 칸에 X표 하십시오.";

export const ASRS_ATTRIBUTION =
  "The 6-question Adult Self-Report Scale-Version1.1 (ASRS-V1.1) Screener is a subset of the 18-question Adult ADHD Self-Report Scale-Version1.1 (Adult ASRSV1.1) Symptom Checklist. © New York University and the President and Fellows of Harvard College. All rights reserved. The ASRS v1.1 Screener was created by Dr. Lenard Adler of NYU and Dr. Ronald Kessler of Harvard.";

export const ASRS_SOURCES = Object.freeze({
  korean: "https://www.hcp.med.harvard.edu/ncs//ftpdir/adhd/adhd/Old%20Versions/18Q-Korean.pdf",
  license: "https://license.tov.med.nyu.edu/product/asrs6Qscreener",
  scoring: "https://www.hcp.med.harvard.edu/ncs//ftpdir/adhd/adhd/Old%20Versions/6Question-ADHD-ASRS-v1-1.pdf",
  publication: "https://pubmed.ncbi.nlm.nih.gov/15841682/",
});

export const ASRS_PUBLICATION =
  "Kessler, R. C., et al. (2005). The World Health Organization Adult ADHD Self-Report Scale (ASRS): a short screening scale for use in the general population. Psychological Medicine, 35(2), 245–256.";

/** Count threshold responses; an incomplete or invalid form is never scored. */
export function scoreAdhd(answers) {
  if (
    !Array.isArray(answers) ||
    answers.length !== ADHD_ITEMS.length ||
    !ADHD_ITEMS.every((_, index) =>
      Number.isInteger(answers[index]) && answers[index] >= 0 && answers[index] <= 4,
    )
  ) {
    return null;
  }

  const positiveItems = ADHD_ITEMS.map((item, index) => answers[index] >= item.threshold);
  const positiveCount = positiveItems.filter(Boolean).length;
  return { positiveCount, needsFollowUp: positiveCount >= 4, positiveItems };
}
