import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Plus, X, Check, Pencil, ChevronLeft, ChevronRight, CalendarDays, Users, Search, MapPin } from "lucide-react";
import { CLIENT_STATUSES, RESERVATION_STATUSES, clientStatus, reservationStatus,
  validateReservation, reservationScheduleChanged, addMinutes, sessionNumber } from "./counselingDomain.mjs";
import { externalReservation, externalReservationTitle, reservationLastDate } from "./googleCalendarDomain.mjs";
import { GoogleReservationEditor } from "./googleCalendar.jsx";

// 기존 업무보드의 색과 공용 UI를 함께 사용합니다. 데이터는 WorkBoard에 그대로 둡니다.
const UI = createContext(null);
const useUI = () => useContext(UI);
const RESERVATION_PLACES = ["마음", "어우리", "공감", "집단", "모래놀이", "meet"];
const sortSessions = (a, b) => `${a.date || ""}${a.start || ""}${a.id || ""}`.localeCompare(`${b.date || ""}${b.start || ""}${b.id || ""}`);
const normalizeText = (value) => String(value || "").toLowerCase().replace(/[\s-]/g, "");
const matchesClient = (client, query) => !query || [client.name, client.phone, client.counselor].some((value) => normalizeText(value).includes(normalizeText(query)));

function Field({ label, children, hint }) {
  const { C } = useUI();
  return <label className="block min-w-0" style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>
    <span className="block mb-1.5">{label}</span>{children}
    {hint && <span className="block mt-1" style={{ fontSize: 10.5, fontWeight: 400, color: C.faint }}>{hint}</span>}
  </label>;
}
function useInputStyle() {
  const { C, FONT } = useUI();
  return { width: "100%", minWidth: 0, minHeight: 42, padding: "9px 10px", fontSize: 13,
    border: `1px solid ${C.rule}`, background: C.surface, color: C.ink, borderRadius: 9, fontFamily: FONT };
}
function Badge({ children, tone = "neutral" }) {
  const { C } = useUI();
  const shades = { neutral: [C.bg, C.muted], green: [C.greenSoft, C.green], navy: [C.navySoft, C.navy], amber: [C.amberSoft, C.amber] };
  const [background, color] = shades[tone] || shades.neutral;
  return <span className="inline-flex rounded shrink-0" style={{ padding: "3px 6px", background, color, fontSize: 10.5, lineHeight: 1.4, fontWeight: 700 }}>{children}</span>;
}
function Modal({ title, onClose, children, footer }) {
  const { C, useDismiss } = useUI();
  const dismiss = useDismiss(onClose);
  const ref = useRef(null);
  const titleId = React.useId();
  useEffect(() => {
    const previous = document.activeElement;
    (ref.current?.querySelector("input, select, textarea") || ref.current?.querySelector("button"))?.focus();
    return () => previous?.focus?.();
  }, []);
  const keys = (event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const focusable = [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')]
      .filter((el) => el.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade" style={{ zIndex: 65, background: "rgba(26,33,30,0.4)" }} {...dismiss}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keys}
      className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet flex flex-col" style={{ maxWidth: 470, maxHeight: "90dvh", background: C.bg, border: `1px solid ${C.rule}` }}>
      <div className="flex items-center justify-between shrink-0" style={{ padding: "12px 18px", borderBottom: `1px solid ${C.rule}` }}>
        <span id={titleId} style={{ fontSize: 15, fontWeight: 750 }}>{title}</span>
        <button type="button" aria-label="닫기" onClick={onClose} className="wb-btn flex items-center justify-center" style={{ width: 40, height: 40, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
      </div>
      <div style={{ padding: "16px 18px", overflowY: "auto", minHeight: 0 }}>{children}</div>
      <div className="flex items-center justify-end gap-2 shrink-0" style={{ padding: "12px 18px", background: C.surface, borderTop: `1px solid ${C.rule}`, borderRadius: "0 0 24px 24px" }}>{footer}</div>
    </div>
  </div>;
}

function ClientEditor({ initial, clients, types, onSave, onDelete, onClose, fromReservation }) {
  const { C, Btn, DeleteBtn, fmtPhone, todayISO, uid } = useUI();
  const inp = useInputStyle();
  const [value, setValue] = useState(() => ({ name: "", phone: "", birth: "", sex: "", issue: "", counselor: "", targetSessions: "", note: "", defaultType: types[0] || "개인상담", ...initial, status: clientStatus(initial || {}) }));
  const patch = (key, next) => setValue((v) => ({ ...v, [key]: next }));
  const [error, setError] = useState("");
  const duplicate = clients.find((c) => c.id !== value.id && normalizeText(c.name) === normalizeText(value.name) && value.name.trim());
  const save = (reserve) => {
    if (!value.name.trim()) { setError("내담자 이름을 입력해 주세요."); return; }
    if (value.birth && value.birth > todayISO()) { setError("생년월일을 다시 확인해 주세요."); return; }
    if (value.targetSessions !== "" && (!Number.isInteger(Number(value.targetSessions)) || Number(value.targetSessions) < 1 || Number(value.targetSessions) > 999)) {
      setError("목표 회기는 1~999 사이의 숫자로 입력해 주세요."); return;
    }
    onSave({ ...value, id: value.id || uid(), name: value.name.trim(), counselor: value.counselor.trim(),
      targetSessions: value.targetSessions === "" ? "" : Number(value.targetSessions) }, reserve);
  };
  return <Modal title={initial?.id ? "내담자 정보 수정" : "내담자 등록"} onClose={onClose} footer={<>
    {initial?.id && onDelete && <div style={{ marginRight: "auto" }}><DeleteBtn onDelete={onDelete} /></div>}
    <Btn size="sm" onClick={onClose}>취소</Btn>
    {!initial?.id && !fromReservation && <Btn size="sm" onClick={() => save(true)} disabled={!value.name.trim()}>저장 후 예약</Btn>}
    <Btn size="sm" kind="solid" icon={Check} disabled={!value.name.trim()} onClick={() => save(!!fromReservation)}>{fromReservation ? "등록하고 선택" : "저장"}</Btn>
  </>}>
    <div className="flex flex-col gap-3">
      <Field label="이름 · 필수"><input autoComplete="off" value={value.name} placeholder="내담자 이름" onChange={(e) => patch("name", e.target.value)} style={inp} /></Field>
      {duplicate && <div style={{ color: C.amber, fontSize: 11.5 }}>같은 이름의 내담자가 있습니다. 생년월일과 연락처를 확인해 주세요.</div>}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="생년월일"><input type="date" value={value.birth} max={todayISO()} onChange={(e) => patch("birth", e.target.value)} style={inp} /></Field>
        <Field label="성별"><select value={value.sex} onChange={(e) => patch("sex", e.target.value)} style={inp}><option value="">미입력</option><option>남</option><option>여</option></select></Field>
      </div>
      <Field label="연락처"><input type="tel" value={value.phone} placeholder="010-0000-0000" onChange={(e) => patch("phone", fmtPhone(e.target.value))} style={inp} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="진행 상태"><select value={value.status} onChange={(e) => patch("status", e.target.value)} style={inp}>{Object.entries(CLIENT_STATUSES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></Field>
        <Field label="기본 상담 유형"><select value={value.defaultType} onChange={(e) => patch("defaultType", e.target.value)} style={inp}>{[...new Set([...types, value.defaultType])].filter(Boolean).map((type) => <option key={type}>{type}</option>)}</select></Field>
      </div>
      <Field label="주호소 문제"><textarea value={value.issue} rows={2} maxLength={1000} onChange={(e) => patch("issue", e.target.value)} placeholder="상담에서 다룰 주요 내용을 적어 두세요" style={{ ...inp, resize: "vertical", lineHeight: 1.6 }} /></Field>
      <details className="rounded-xl" style={{ border: `1px solid ${C.rule}`, padding: "10px 12px" }}>
        <summary style={{ cursor: "pointer", color: C.muted, fontSize: 12, fontWeight: 700 }}>추가 정보 · 상담자, 목표 회기, 특이사항</summary>
        <div className="grid grid-cols-2 gap-2.5 mt-3">
          <Field label="상담자"><input value={value.counselor} onChange={(e) => patch("counselor", e.target.value)} placeholder="담당 상담자" style={inp} /></Field>
          <Field label="목표 회기"><input type="number" min="1" max="999" value={value.targetSessions} onChange={(e) => patch("targetSessions", e.target.value)} placeholder="예: 10" style={inp} /></Field>
        </div>
        <div className="mt-3"><Field label="특이사항"><textarea value={value.note} rows={2} onChange={(e) => patch("note", e.target.value)} placeholder="예약·진행 시 참고할 내용" style={{ ...inp, resize: "vertical" }} /></Field></div>
      </details>
      {initial?.id && <div style={{ color: C.faint, fontSize: 10.5 }}>내담자를 삭제하면 직접 등록한 예약과 상담일지도 함께 삭제됩니다. 구글 예약은 내담자 연결만 해제됩니다.</div>}
      {error && <div role="alert" style={{ color: C.seal, fontSize: 12 }}>{error}</div>}
    </div>
  </Modal>;
}

function ReservationEditor({ initial, clients, reservations, types, onAddType, onSave, onDelete, onClose, onNewClient, autoCalendar }) {
  const { C, Btn, DeleteBtn, TimePick, todayISO, fmtDateK } = useUI();
  const inp = useInputStyle();
  const selectedInitial = clients.find((c) => c.id === initial?.clientId);
  const [value, setValue] = useState(() => ({ clientId: "", type: selectedInitial?.defaultType || types[0] || "개인상담", date: todayISO(), start: "15:00", end: "16:00", place: "", method: "대면", memo: "", ...initial, status: reservationStatus(initial || {}) }));
  const [query, setQuery] = useState("");
  const [newType, setNewType] = useState("");
  const [addingType, setAddingType] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const patch = (key, next) => setValue((v) => ({ ...v, [key]: next }));
  const selected = clients.find((c) => c.id === value.clientId);
  const scheduleError = reservationScheduleChanged(initial?.id ? initial : null, value)
    ? validateReservation(value, clients, reservations) : "";
  const hasValidPlace = RESERVATION_PLACES.includes(value.place);
  const error = scheduleError || (!hasValidPlace ? "상담 장소를 선택해 주세요." : "");
  const seq = sessionNumber(value, reservations);
  const typeOptions = [...new Set([...types, value.type])].filter(Boolean);
  const save = () => { setAttempted(true); if (!error) onSave(value); };
  return <Modal title={initial?.id ? "상담 예약 수정" : "상담 예약"} onClose={onClose} footer={<>
    {initial?.id && onDelete && <div style={{ marginRight: "auto" }}><DeleteBtn onDelete={onDelete} /></div>}
    <Btn size="sm" onClick={onClose}>취소</Btn><Btn size="sm" kind="solid" icon={Check} onClick={save}>{initial?.id ? "변경 저장" : "예약 등록"}</Btn>
  </>}>
    <div className="flex flex-col gap-3">
      {selected ? <div className="flex items-center gap-2 rounded-xl" style={{ background: C.navySoft, padding: "11px 12px" }}>
        <div className="flex-1 min-w-0"><div style={{ fontWeight: 750, fontSize: 14 }}>{selected.name} <span style={{ fontSize: 10.5, fontWeight: 500, color: C.muted }}>{selected.birth || selected.phone}</span></div>
          <div style={{ fontSize: 11, color: C.navy, marginTop: 3 }}>{value.type}{seq ? ` · ${seq}회기` : ""}{selected.counselor ? ` · ${selected.counselor}` : ""}</div></div>
        {!initial?.lockClient && <button type="button" onClick={() => patch("clientId", "")} className="wb-btn" style={{ border: "none", background: "none", padding: "10px 2px", fontSize: 11, color: C.navy, cursor: "pointer" }}>변경</button>}
      </div> : <div>
        <div className="flex items-end justify-between gap-2 mb-1.5"><span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>내담자 선택</span>
          <button type="button" onClick={() => onNewClient(value)} className="wb-btn inline-flex items-center gap-1" style={{ color: C.navy, background: "none", border: "none", padding: "6px 0", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}><Plus size={12} /> 새 내담자 등록</button></div>
        <input aria-label="예약할 내담자 검색" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 연락처 검색" style={inp} />
        <div className="rounded-lg" style={{ maxHeight: 136, overflowY: "auto", marginTop: 5, border: `1px solid ${C.rule}`, background: C.surface }}>
          {clients.filter((c) => matchesClient(c, query)).map((c) => <button type="button" key={c.id} onClick={() => setValue((v) => ({ ...v, clientId: c.id, type: c.defaultType || v.type }))}
            className="wb-btn w-full flex items-center justify-between gap-2 text-left" style={{ minHeight: 44, padding: "8px 10px", background: "none", border: "none", borderBottom: `1px solid ${C.rule}`, cursor: "pointer" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{c.name} <span style={{ fontSize: 10.5, fontWeight: 400, color: C.faint }}>{c.birth || c.phone}</span></span><Badge>{CLIENT_STATUSES[clientStatus(c)]}</Badge></button>)}
          {!clients.some((c) => matchesClient(c, query)) && <div style={{ padding: 12, color: C.faint, fontSize: 12 }}>선택할 내담자가 없습니다. 새로 등록해 주세요.</div>}
        </div>
      </div>}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="상담 유형"><select value={value.type} onChange={(e) => { if (e.target.value === "__add__") setAddingType(true); else patch("type", e.target.value); }} style={inp}>{typeOptions.map((type) => <option key={type}>{type}</option>)}<option value="__add__">+ 유형 추가</option></select></Field>
        <Field label="예약 상태"><select value={value.status} onChange={(e) => patch("status", e.target.value)} style={inp}>{Object.entries(RESERVATION_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      </div>
      {addingType && <div className="flex items-center gap-2"><input aria-label="새 상담 유형" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="추가할 상담 유형" style={inp} /><Btn size="sm" disabled={!newType.trim()} onClick={() => { const type = newType.trim(); onAddType(type); patch("type", type); setAddingType(false); setNewType(""); }}>추가</Btn><button aria-label="유형 추가 취소" onClick={() => setAddingType(false)} style={{ border: "none", background: "none", color: C.faint }}><X size={16} /></button></div>}
      <Field label="예약 날짜"><input type="date" value={value.date} onChange={(e) => patch("date", e.target.value)} style={inp} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="시작 시간"><TimePick label="시작 시간" value={value.start} onChange={(time) => patch("start", time)} style={{ width: "100%" }} /></Field>
        <Field label="종료 시간"><TimePick label="종료 시간" value={value.end} onChange={(time) => patch("end", time)} style={{ width: "100%" }} /></Field>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: -5 }}>
        {[30, 50, 60, 90].map((minutes) => <button type="button" key={minutes} disabled={!value.start || !addMinutes(value.start, minutes)} onClick={() => patch("end", addMinutes(value.start, minutes))} className="wb-btn rounded-lg" style={{ border: `1px solid ${C.rule}`, background: C.surface, color: C.muted, fontSize: 11, padding: "7px 10px", cursor: "pointer" }}>{minutes}분</button>)}
        <button type="button" onClick={() => setValue((v) => ({ ...v, start: "", end: "" }))} style={{ marginLeft: "auto", color: C.faint, border: "none", background: "none", padding: "7px 0", fontSize: 11, cursor: "pointer" }}>시간 미정</button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="장소 · 필수"><select value={value.place || ""} onChange={(e) => patch("place", e.target.value)} aria-required="true" aria-invalid={attempted && !hasValidPlace} style={inp}>
          <option value="" disabled>장소 선택</option>
          {value.place && !hasValidPlace && <option value={value.place} disabled>기존: {value.place} · 다시 선택</option>}
          {RESERVATION_PLACES.map((place) => <option key={place} value={place}>{place}</option>)}
        </select></Field>
        <Field label="진행 방식"><select value={value.method} onChange={(e) => patch("method", e.target.value)} style={inp}>{[...new Set(["대면", "전화", "온라인", "방문", value.method])].filter(Boolean).map((method) => <option key={method}>{method}</option>)}</select></Field>
      </div>
      <Field label="예약 메모"><textarea value={value.memo} onChange={(e) => patch("memo", e.target.value)} rows={2} placeholder="준비물이나 예약 시 참고할 내용" style={{ ...inp, resize: "vertical" }} /></Field>
      {!initial?.id && autoCalendar && <div style={{ color: C.navy, background: C.navySoft, borderRadius: 9, padding: "9px 11px", fontSize: 11.5, lineHeight: 1.6 }}>구글 캘린더에도 ‘상담 예약’으로 등록됩니다. 이름·메모·상담일지는 보내지 않으며, 구글 연결을 확인한 뒤 자동으로 전송합니다.</div>}
      {error && (attempted || (scheduleError && value.clientId)) && <div role="alert" style={{ borderRadius: 9, padding: "9px 11px", background: C.sealSoft, color: C.seal, fontSize: 12, lineHeight: 1.5 }}>{error}</div>}
      {!error && value.clientId && <div style={{ color: C.muted, fontSize: 11.5 }}>{fmtDateK(value.date)} {value.start ? `${value.start}–${value.end}` : "시간 미정"} · {RESERVATION_STATUSES[value.status]}</div>}
    </div>
  </Modal>;
}

function ReservationRow({ reservation: r, clients, reservations, onEdit, onLog, onDone, onNext }) {
  const { C, fmtDateK } = useUI();
  const client = clients.find((c) => c.id === r.clientId);
  const status = reservationStatus(r);
  const external = externalReservation(r);
  const seq = sessionNumber(r, reservations);
  const tone = status === "done" ? "green" : status === "scheduled" ? "navy" : "neutral";
  return <div style={{ padding: "11px 0", borderTop: `1px solid ${C.rule}` }}>
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap"><span style={{ fontSize: 13.5, fontWeight: 750 }}>{client?.name || (external ? externalReservationTitle(r) : "삭제된 내담자")}</span><Badge tone={tone}>{RESERVATION_STATUSES[status]}</Badge>{external && <Badge tone="green">구글</Badge>}<span style={{ fontSize: 10.5, color: C.faint }}>{r.type}{seq ? ` · ${seq}회기` : ""}</span></div>
        {external && !client && <div style={{ fontSize: 10.5, color: C.amber, marginTop: 4 }}>내담자 연결 필요</div>}
        {external && client && <div className="truncate" style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>{externalReservationTitle(r)}</div>}
        <div style={{ marginTop: 5, color: C.ink, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{fmtDateK(r.date)}{reservationLastDate(r) > r.date ? ` ~ ${fmtDateK(reservationLastDate(r))}` : ""} <span style={{ fontWeight: 650 }}>{r.allDay ? "종일" : r.start ? `${r.start}${r.end ? "–" + r.end : ""}` : "시간 미정"}</span></div>
        {(r.place || r.method) && <div className="flex items-center gap-1 mt-1" style={{ fontSize: 10.5, color: C.faint }}><MapPin size={10} />{[r.place, r.method].filter(Boolean).join(" · ")}</div>}
        {r.memo && <div className="truncate mt-1" style={{ fontSize: 11, color: C.faint }}>{r.memo}</div>}
        {!external && r.googleWrite && <div style={{ fontSize: 10.5, color: r.googleWrite.state === "error" ? C.seal : C.muted, marginTop: 4 }}>{r.googleWrite.state === "sending" ? "구글 등록 확인 중" : r.googleWrite.state === "error" ? "구글 등록 확인 필요 · 상단 권한 설정에서 다시 전송" : "구글 등록 대기 · 권한 연결 후 전송"}</div>}
      </div>
      <button type="button" aria-label={`${client?.name || (external ? externalReservationTitle(r) : "상담")} 예약 수정`} title={external ? "예약 확인 · 내담자 연결" : "예약 수정"} onClick={() => onEdit(r)} className="wb-btn flex items-center justify-center" style={{ width: 40, height: 40, border: "none", background: "none", color: C.faint, cursor: "pointer" }}><Pencil size={14} /></button>
    </div>
    <div className="flex justify-end items-center gap-2 mt-2">
      {status === "scheduled" && <button type="button" onClick={() => onDone(r)} className="wb-btn inline-flex items-center gap-1 rounded-lg" style={{ border: `1px solid ${C.rule}`, background: C.surface, color: C.green, fontSize: 11, fontWeight: 700, minHeight: 34, padding: "6px 9px", cursor: "pointer" }}><Check size={12} />상담 완료</button>}
      {status === "done" && client && <button type="button" onClick={() => onNext(r)} className="wb-btn" style={{ border: "none", background: "none", color: C.navy, minHeight: 34, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>다음 회기 예약</button>}
      <button type="button" onClick={() => onLog(r)} className="wb-btn rounded-lg" style={{ border: "none", background: C.bg, color: C.muted, minHeight: 34, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{r.log?.text || r.log?.files?.length ? "상담일지 보기" : "상담일지"}</button>
    </div>
  </div>;
}

function CounselContent({ data, onSaveClient, onDeleteClient, onSaveResv, onDeleteResv, onAddType, onSaveLog }) {
  const ui = useUI();
  const { C, Card, Btn, Label, LogSheet, todayISO, fmtDateK, DEFAULT_TYPES } = useUI();
  const inp = useInputStyle();
  const clients = data.clients || [], reservations = data.resv || [];
  const types = data.resvTypes?.length ? data.resvTypes : DEFAULT_TYPES;
  const [openId, setOpenId] = useState(null);
  const [clientEditor, setClientEditor] = useState(null);
  const [reservationEditor, setReservationEditor] = useState(null);
  const [pendingReservation, setPendingReservation] = useState(null);
  const [logId, setLogId] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [undo, setUndo] = useState(null);
  const activeClient = clients.find((c) => c.id === openId);
  const sessions = reservations.filter((r) => r.clientId === openId).sort(sortSessions);
  const completed = sessions.filter((r) => reservationStatus(r) === "done").length;
  const upcoming = reservations.filter((r) => reservationStatus(r) === "scheduled" && reservationLastDate(r) >= todayISO()).sort(sortSessions);
  const history = reservations.filter((r) => reservationStatus(r) !== "scheduled" || reservationLastDate(r) < todayISO()).sort((a, b) => sortSessions(b, a));
  const filtered = clients.filter((c) => matchesClient(c, query) && (statusFilter === "all" || clientStatus(c) === statusFilter));
  const log = reservations.find((r) => r.id === logId);
  const editReservation = (r) => setReservationEditor({ ...r, lockClient: true });
  const nextReservation = (r) => {
    const date = new Date(`${r.date || todayISO()}T12:00:00`); date.setDate(date.getDate() + 7);
    const nextDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    setReservationEditor({ clientId: r.clientId, lockClient: true, type: r.type, date: nextDate < todayISO() ? todayISO() : nextDate, start: r.start, end: r.end, place: r.place || "", method: r.method || "대면" });
  };
  const complete = (r) => { if (onSaveResv({ id: r.id, status: "done" }) !== false) setUndo({ id: r.id, status: reservationStatus(r) }); };
  const row = (r) => <ReservationRow key={r.id} reservation={r} clients={clients} reservations={reservations} onEdit={editReservation} onLog={(r2) => setLogId(r2.id)} onDone={complete} onNext={nextReservation} />;
  const saveClient = (client, reserve) => {
    onSaveClient(client); setClientEditor(null);
    if (pendingReservation) { setReservationEditor({ ...pendingReservation, clientId: client.id, type: pendingReservation.type || client.defaultType }); setPendingReservation(null); }
    else if (reserve) { setOpenId(client.id); setReservationEditor({ clientId: client.id, lockClient: true }); }
  };
  const closeClientEditor = () => { setClientEditor(null); if (pendingReservation) { setReservationEditor(pendingReservation); setPendingReservation(null); } };
  return <div className="flex flex-col gap-3">
    {activeClient ? <>
      <button type="button" onClick={() => setOpenId(null)} className="wb-btn inline-flex items-center gap-1" style={{ alignSelf: "flex-start", padding: "7px 0", background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer" }}><ChevronLeft size={15} />내담자 목록</button>
      <Card style={{ padding: 16 }}>
        <div className="flex items-start gap-2"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span style={{ fontSize: 20, fontWeight: 780 }}>{activeClient.name}</span><Badge tone={clientStatus(activeClient) === "active" ? "green" : "neutral"}>{CLIENT_STATUSES[clientStatus(activeClient)]}</Badge></div>
          <div style={{ color: C.muted, fontSize: 11.5, marginTop: 6, lineHeight: 1.7 }}>{[activeClient.birth, activeClient.sex, activeClient.phone].filter(Boolean).join(" · ") || "기본 정보 미입력"}</div>
          <div style={{ color: C.muted, fontSize: 11.5 }}>{[activeClient.defaultType, activeClient.counselor && `담당 ${activeClient.counselor}`].filter(Boolean).join(" · ")}</div></div>
          <button type="button" aria-label="내담자 정보 수정" onClick={() => setClientEditor(activeClient)} style={{ width: 40, height: 40, color: C.muted, background: "none", border: "none", cursor: "pointer" }}><Pencil size={16} /></button></div>
        <div className="flex items-center justify-between gap-2 rounded-lg mt-3" style={{ background: C.bg, padding: "9px 11px" }}><span style={{ fontSize: 12, color: C.muted }}>상담 진행</span><span style={{ fontSize: 13, fontWeight: 750, color: C.navy }}>{completed}회 완료{activeClient.targetSessions ? ` / 목표 ${activeClient.targetSessions}회` : ""}</span></div>
        {activeClient.issue && <div className="mt-3"><Label>주호소 문제</Label><div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 5, whiteSpace: "pre-wrap" }}>{activeClient.issue}</div></div>}
        {activeClient.note && <details className="mt-3" style={{ fontSize: 12, color: C.muted }}><summary style={{ cursor: "pointer", fontWeight: 650 }}>특이사항</summary><div style={{ marginTop: 7, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{activeClient.note}</div></details>}
      </Card>
      <Card style={{ padding: "13px 15px" }}><div className="flex items-center justify-between gap-2 mb-2"><Label>상담 회기 · {sessions.filter((r) => ["scheduled", "done"].includes(reservationStatus(r))).length}회</Label><Btn size="sm" kind="solid" icon={Plus} onClick={() => setReservationEditor({ clientId: activeClient.id, lockClient: true })}>상담 예약</Btn></div>{sessions.length ? sessions.map(row) : <Empty>예약된 회기가 없습니다.</Empty>}</Card>
    </> : <>
      <div className="flex items-center gap-2"><Btn size="sm" kind="solid" icon={Plus} onClick={() => setClientEditor({})}>내담자 등록</Btn><Btn size="sm" icon={CalendarDays} onClick={() => setReservationEditor({})}>상담 예약</Btn></div>
      <div className="grid grid-cols-3 gap-2">{[["오늘 예약", upcoming.filter((r) => r.date <= todayISO() && reservationLastDate(r) >= todayISO()).length], ["상담대기", clients.filter((c) => clientStatus(c) === "waiting").length], ["상담진행", clients.filter((c) => clientStatus(c) === "active").length]].map(([label, count]) => <Card key={label} style={{ padding: "10px 13px" }}><span style={{ fontSize: 10.5, color: C.muted }}>{label}</span><div style={{ fontSize: 20, fontWeight: 750, marginTop: 2, color: C.navy }}>{count}<span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}>{label === "오늘 예약" ? "건" : "명"}</span></div></Card>)}</div>
      <Card style={{ padding: "14px 15px" }}>
        <div className="flex items-center gap-2 mb-3"><Users size={14} color={C.navy} /><Label>내담자 {clients.length}</Label></div>
        <div className="flex gap-2 mb-2"><div className="relative flex-1 min-w-0"><Search size={14} color={C.faint} style={{ position: "absolute", top: 14, left: 10 }} /><input aria-label="내담자 검색" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 연락처 · 상담자 검색" style={{ ...inp, paddingLeft: 31, fontSize: 12 }} /></div>
          <select aria-label="내담자 상태 필터" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inp, width: 107, fontSize: 11.5, padding: "9px 6px" }}><option value="all">모든 상태</option>{Object.entries(CLIENT_STATUSES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
        {!filtered.length ? <Empty>{clients.length ? "검색 조건에 맞는 내담자가 없습니다." : "내담자를 등록하면 예약과 회기를 함께 관리할 수 있습니다."}</Empty> : filtered.map((client) => {
          const done = reservations.filter((r) => r.clientId === client.id && reservationStatus(r) === "done").length;
          const next = upcoming.find((r) => r.clientId === client.id);
          return <button type="button" key={client.id} onClick={() => setOpenId(client.id)} className="wb-btn w-full flex items-center gap-2.5 text-left" style={{ background: "none", border: "none", borderTop: `1px solid ${C.rule}`, padding: "12px 0", cursor: "pointer" }}>
            <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: 31, height: 31, background: C.navySoft, color: C.navy, fontSize: 12, fontWeight: 800 }}>{String(client.name || "?").slice(0, 1)}</span>
            <span className="flex-1 min-w-0"><span className="flex items-center gap-1.5 flex-wrap"><span style={{ fontSize: 13.5, fontWeight: 750 }}>{client.name}</span><Badge tone={clientStatus(client) === "active" ? "green" : "neutral"}>{CLIENT_STATUSES[clientStatus(client)]}</Badge></span>
              <span className="block truncate mt-1" style={{ fontSize: 11, color: C.muted }}>{next ? `다음 ${fmtDateK(next.date)} ${next.start || "시간 미정"}` : "예정된 상담 없음"}{client.defaultType ? ` · ${client.defaultType}` : ""}</span></span>
            <span className="shrink-0" style={{ color: C.faint, fontSize: 10.5 }}>완료 {done}{client.targetSessions ? `/${client.targetSessions}` : ""}회</span><ChevronRight size={13} color={C.faint} /></button>;
        })}
      </Card>
      <Card style={{ padding: "13px 15px" }}><div className="flex items-center gap-2 mb-2"><CalendarDays size={14} color={C.navy} /><Label>다가오는 상담 {upcoming.length}</Label></div>{upcoming.length ? upcoming.map(row) : <Empty>예정된 상담이 없습니다.</Empty>}</Card>
      {!!history.length && <Card style={{ padding: "12px 15px" }}><button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)} className="wb-btn flex items-center justify-between w-full" style={{ color: C.muted, background: "none", border: "none", padding: "4px 0", cursor: "pointer" }}><Label>지난 상담 · 완료 및 취소 {history.length}</Label><ChevronRight size={14} style={{ transform: historyOpen ? "rotate(90deg)" : "none" }} /></button>{historyOpen && history.map(row)}</Card>}
    </>}
    {undo && <div role="status" className="flex items-center justify-between rounded-xl" style={{ background: C.greenSoft, color: C.green, padding: "10px 13px", fontSize: 12 }}>상담을 완료했습니다.<button type="button" onClick={() => { if (reservations.some((r) => r.id === undo.id && reservationStatus(r) === "done")) onSaveResv(undo); setUndo(null); }} style={{ border: "none", background: "none", color: C.green, fontWeight: 700, cursor: "pointer" }}>되돌리기</button></div>}
    {clientEditor && <ClientEditor key={clientEditor.id || "new"} initial={clientEditor} clients={clients} types={types} fromReservation={!!pendingReservation} onClose={closeClientEditor} onSave={saveClient} onDelete={clientEditor.id ? () => { if (onDeleteClient(clientEditor.id) !== false) { setClientEditor(null); setOpenId(null); } } : null} />}
    {reservationEditor && (externalReservation(reservationEditor)
      ? <GoogleReservationEditor ui={ui} reservation={reservations.find((r) => r.id === reservationEditor.id) || reservationEditor} clients={clients} types={types} onSave={onSaveResv} onClose={() => setReservationEditor(null)} />
      : <ReservationEditor autoCalendar={data.googleCalendar?.enabled && data.googleCalendar?.writeEnabled} key={reservationEditor.id || reservationEditor.clientId || "new"} initial={reservationEditor} clients={clients} reservations={reservations} types={types} onAddType={onAddType} onClose={() => setReservationEditor(null)} onSave={(value) => { if (onSaveResv(value) !== false) { setReservationEditor(null); setUndo(null); } }} onDelete={reservationEditor.id ? () => { if (onDeleteResv(reservationEditor.id) !== false) { setReservationEditor(null); setUndo(null); } } : null} onNewClient={(draft) => { setPendingReservation(draft); setReservationEditor(null); setClientEditor({}); }} />)}
    {log && <LogSheet resv={log} client={clients.find((c) => c.id === log.clientId)} session={sessionNumber(log, reservations) || "—"} onClose={() => setLogId(null)} onSave={(value) => { onSaveLog(log.id, value); setLogId(null); }} />}
  </div>;
}
function Empty({ children }) { const { C } = useUI(); return <div style={{ fontSize: 12, color: C.faint, padding: "13px 0", lineHeight: 1.6 }}>{children}</div>; }
export default function CounselBoard({ ui, ...props }) { return <UI.Provider value={ui}><CounselContent {...props} /></UI.Provider>; }
