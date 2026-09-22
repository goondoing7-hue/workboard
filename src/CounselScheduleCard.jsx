import React from "react";
import { sessionNumber } from "./counselingDomain.mjs";
import { reservationLastDate, scheduleReservationTitle } from "./googleCalendarDomain.mjs";

const COUNSEL_COLOR = "#7C4D9E";
const COUNSEL_SOFT = "#F1EAF7";

export default function CounselScheduleCard({ reservation, clients = [], reservations = [], ui, titleId }) {
  const { C, FONT } = ui;
  const client = clients.find((item) => item.id === reservation.clientId);
  const session = client ? sessionNumber(reservation, reservations) : null;
  const title = scheduleReservationTitle(reservation, client);
  const lastDate = reservationLastDate(reservation);
  const date = reservation.date || "날짜 미정";
  const fields = [
    ["상담회기", session ? `${session}회기` : client ? "회기 미포함" : "연결 후 표시"],
    ["이름", client?.name || "내담자 미연결"],
    ["장소", reservation.place || "장소 미정"],
    ["시간", reservation.allDay ? "종일" : reservation.start ? `${reservation.start}${reservation.end ? `–${reservation.end}` : ""}` : "시간 미정"],
  ];
  return <section aria-label="상담 일정 정보" style={{ background: C.surface, border: `1px solid ${C.rule}`, borderTop: `3px solid ${COUNSEL_COLOR}`, borderRadius: 12, overflow: "hidden", fontFamily: FONT }}>
    <div style={{ padding: "14px 15px 12px", background: COUNSEL_SOFT }}>
      <h3 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 750, color: C.ink, lineHeight: 1.5, overflowWrap: "anywhere" }}>{title}</h3>
      <div style={{ marginTop: 5, color: C.muted, fontSize: 13, lineHeight: 1.5, fontVariantNumeric: "tabular-nums" }}>{date}{lastDate && lastDate !== reservation.date ? ` ~ ${lastDate}` : ""}</div>
    </div>
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "16px 18px", margin: 0, padding: 15 }}>
      {fields.map(([label, value]) => <div key={label} style={{ minWidth: 0 }}>
        <dt style={{ marginBottom: 5, color: C.muted, fontSize: 12, fontWeight: 650 }}>{label}</dt>
        <dd style={{ margin: 0, color: label === "상담회기" && session ? COUNSEL_COLOR : C.ink, fontSize: 15, fontWeight: 700, lineHeight: 1.5, overflowWrap: "anywhere", fontVariantNumeric: label === "시간" ? "tabular-nums" : undefined }}>{value}</dd>
      </div>)}
    </dl>
    {reservation.externalCancelled && <div style={{ margin: "0 15px 15px", padding: "8px 10px", borderRadius: 8, background: C.sealSoft, color: C.seal, fontSize: 12, lineHeight: 1.6 }}>연결된 캘린더에서 취소되었거나 삭제된 일정입니다.</div>}
  </section>;
}
