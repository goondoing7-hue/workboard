import test from "node:test";
import assert from "node:assert/strict";
import { counselingPresentation } from "../src/counselingPresentation.mjs";

test("calendar title separates the client and room while dropping recurring metadata", () => {
  assert.deepEqual(counselingPresentation({ externalTitle: "어우리(정기성)_가상가", place: "춘천시청소년상담복지센터" }), {
    title: "가상가", name: "가상가", place: "어우리", remote: false,
  });
  assert.deepEqual(counselingPresentation({ externalTitle: "마음(정기성)_가상나(비대면) · 개인상담" }), {
    title: "가상나", name: "가상나", place: "마음", remote: true,
  });
});

test("recognized room tokens include every reservation place without matching inside names", () => {
  for (const place of ["어우리", "마음", "공감", "집단", "모래놀이", "meet"]) {
    const result = counselingPresentation({ externalTitle: `${place}_김마음` });
    assert.equal(result.name, "김마음");
    assert.equal(result.place, place);
  }
  assert.equal(counselingPresentation({ externalTitle: "MEET_가상가" }).place, "meet");
  assert.deepEqual(counselingPresentation({ externalTitle: "김마음 상담" }), {
    title: "김마음 상담", name: "", place: "", remote: false,
  });
  assert.equal(counselingPresentation({ externalTitle: "예약_공감" }).name, "공감");
  assert.equal(counselingPresentation({ externalTitle: "예약_공감" }).place, "");
});

test("client association remains authoritative and display parsing does not mutate source data", () => {
  const reservation = Object.freeze({ id: "external-1", clientId: "existing-id", source: "google-calendar", externalTitle: "어우리(정기성)_원본이름(비대면)", place: "공감", type: "개인상담" });
  const client = Object.freeze({ id: "existing-id", name: "등록 이름" });
  const before = JSON.stringify(reservation);
  assert.deepEqual(counselingPresentation(reservation, client), { title: "등록 이름", name: "등록 이름", place: "공감", remote: true });
  assert.equal(JSON.stringify(reservation), before);
  assert.equal(counselingPresentation(reservation).name, "원본이름");
  assert.equal(reservation.clientId, "existing-id");
});

test("only generic location values yield to the room encoded in the title", () => {
  for (const place of ["", "센터", "상담센터", "청소년상담복지센터", "춘천시 청소년상담복지센터"]) {
    assert.equal(counselingPresentation({ externalTitle: "집단_가상가", place }).place, "집단");
  }
  assert.equal(counselingPresentation({ externalTitle: "집단_가상가", place: "방문 상담실 2" }).place, "방문 상담실 2");
  assert.equal(counselingPresentation({ externalTitle: "가상가", place: "센터" }).place, "센터");
});

test("provider prefixes and standalone consultation metadata are omitted without inventing a client", () => {
  for (const externalTitle of ["구글 · 예약 이름 · 개인상담", "[구글] 예약 이름 (개인상담)", "Google Calendar: 예약 이름 (정기성)"]) {
    assert.deepEqual(counselingPresentation({ externalTitle }), { title: "예약 이름", name: "", place: "", remote: false });
  }
  assert.deepEqual(counselingPresentation({ externalTitle: "예약 이름 (비대면)" }), { title: "예약 이름", name: "", place: "", remote: true });
  assert.equal(counselingPresentation({ externalTitle: "구글캠퍼스 행사" }).title, "구글캠퍼스 행사");
});

test("names use the first underscore and retain unrelated name content", () => {
  assert.equal(counselingPresentation({ externalTitle: "어우리_가상_별칭(비대면)" }).name, "가상_별칭");
  assert.equal(counselingPresentation({ externalTitle: "공감_김정기성" }).name, "김정기성");
  assert.equal(counselingPresentation({ externalTitle: "공감_가상가(보호자)" }).name, "가상가(보호자)");
  assert.equal(counselingPresentation({ externalTitle: "공감_홍비대면" }).remote, false);
});

test("local remote methods expose a separate flag and linked names need no calendar title", () => {
  for (const method of ["온라인", "전화", "비대면"]) {
    assert.deepEqual(counselingPresentation({ place: "meet", method }, { name: "가상가" }), { title: "가상가", name: "가상가", place: "meet", remote: true });
  }
  assert.equal(counselingPresentation({ method: "대면", title: "예약" }).remote, false);
  assert.equal(counselingPresentation({ method: "방문", title: "예약" }).remote, false);
});

test("empty and metadata-only titles have a neutral schedule fallback", () => {
  for (const reservation of [undefined, {}, { title: " " }, { externalTitle: "구글 · 개인상담" }]) {
    assert.deepEqual(counselingPresentation(reservation), { title: "상담 일정", name: "", place: "", remote: false });
  }
  assert.equal(counselingPresentation({ title: "로컬 제목" }).title, "로컬 제목");
});
