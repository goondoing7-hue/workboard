import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, RefreshCw, X } from "lucide-react";
import { parseGoogleCalendarId, mergeGoogleCalendar } from "./googleCalendarDomain.mjs";
import { useGoogleCalendarWriter, CalendarWriteControls } from "./googleCalendarWriter.jsx";
import { counselingCalendarRequest } from "./googleCalendarSession.mjs";
import { readGoogleCalendar } from "./googleCalendarRead.mjs";
import { CenterCalendarPanel } from "./centerCalendar.jsx";

export function useGoogleCalendar({ data, setData, active, isReservationStored }) {
  const writer = useGoogleCalendarWriter({ data, setData, active, isReservationStored });
  const current = useRef({ data, active }); current.current = { data, active };
  const request = useRef(null);
  const lastAttempt = useRef(0);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const config = data.googleCalendar || {};
  const pull = async (input, force = false) => {
    if (!current.current.active) return false;
    let calendarId;
    try { calendarId = parseGoogleCalendarId(input || current.current.data.googleCalendar?.calendarId); }
    catch (e) { setError(e.message); return false; }
    if (!force && (request.current || Date.now() - lastAttempt.current < 60000)) return false;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    lastAttempt.current = Date.now(); setState("loading"); setError("");
    const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const payload = await readGoogleCalendar({ calendarId, from: `${year - 1}-01-01`, to: `${year + 2}-01-01`,
        signal: controller.signal, authenticatedRead: counselingCalendarRequest });
      if (request.current !== controller || !current.current.active) return false;
      // Validate before entering React's state updater so failures remain visible
      // as connection errors and never replace the board with a render error.
      mergeGoogleCalendar(current.current.data, payload);
      setData((previous) => mergeGoogleCalendar(previous, payload));
      setState("ok"); return true;
    } catch (e) {
      if (request.current === controller && current.current.active) {
        setState("error");
        setError(e.name === "AbortError" ? "응답이 늦어 연결을 중단했습니다. 다시 새로고침해 주세요." : e.message);
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  };
  useEffect(() => {
    if (!active || !config.enabled || !config.calendarId) return;
    const check = () => { if (!document.hidden) pull(); };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check);
      if (request.current) { request.current.abort(); request.current = null; setState("idle"); }
      lastAttempt.current = 0;
    };
  }, [active, config.enabled, config.calendarId]);
  useEffect(() => {
    if (!active) { request.current?.abort(); request.current = null; }
    return () => { request.current?.abort(); request.current = null; };
  }, [active]);
  const count = (data.resv || []).filter((r) => r.source === "google-calendar" && r.calendarId === config.calendarId && !r.externalCancelled && r.date >= config.from && r.date < config.to).length;
  return { config, count, state, error, writer, connect: (input) => pull(input, true), refresh: () => pull(undefined, true), disconnect: () => {
    writer.stop();
    request.current?.abort(); request.current = null;
    setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, enabled: false } }));
    setError(""); setState("idle");
  } };
}

export function GoogleCalendarButton({ ui, connection, centerConnection }) {
  const { C, FONT, useDismiss } = ui;
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const dialog = useRef(null);
  const titleId = React.useId();
  const statusId = React.useId();
  const dialogId = React.useId();
  const dismiss = useDismiss(() => setOpen(false));
  const { config, state, error, writer } = connection;
  const enabled = !!(config.enabled && config.calendarId);
  const busy = state === "loading" || writer?.working || writer?.auth.connecting || writer?.auth.checking || centerConnection?.state === "syncing";
  const recovering = !!writer?.auth.retryable;
  const failed = !!(error || writer?.error || centerConnection?.error || centerConnection?.needsPermission || centerConnection?.pendingRows?.some((event) => ["error", "conflict"].includes(event.centerSync?.state)));
  const reconnect = enabled && config.writeEnabled && !writer?.connected && !recovering;
  const status = busy ? "캘린더 동기화 중" : recovering ? "구글 연결 자동 복구 중" : failed ? "캘린더 연결 확인 필요" : reconnect ? (writer?.auth.configured === false ? "구글 자동 연결 유지 설정 필요" : "구글 권한 연결 필요") : enabled ? "캘린더 연결됨" : "캘린더 연결 안 됨";
  const color = busy || recovering ? C.navy : failed ? C.seal : reconnect ? C.amber : enabled ? C.green : C.faint;
  const background = busy || recovering ? C.navySoft : failed ? C.sealSoft : reconnect ? C.amberSoft : enabled ? C.greenSoft : "#F1F3F0";
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector("button")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (before?.isConnected) before.focus?.();
      else trigger.current?.focus();
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" aria-label="구글 캘린더 설정" aria-describedby={statusId} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}
      title={`구글 캘린더 · ${status}`} onClick={() => setOpen(true)} className="wb-btn inline-flex items-center justify-center rounded-full shrink-0"
      style={{ position: "relative", width: 36, height: 36, background, color, border: "none", cursor: "pointer" }}>
      {busy ? <RefreshCw size={16} strokeWidth={2.2} className="wb-spin" aria-hidden="true" /> : <CalendarDays size={16} strokeWidth={2.2} aria-hidden="true" />}
      {!busy && (enabled || failed) && <span aria-hidden="true" style={{ position: "absolute", right: 6, bottom: 6, width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 0 2px ${background}` }} />}
    </button>
    <span id={statusId} className="sr-only">{status}</span>
    {open && createPortal(<div className="fixed inset-0 flex items-center justify-center wb-fade" style={{ zIndex: 80, background: "rgba(26,33,30,0.4)", padding: 12 }} {...dismiss}>
      <div ref={dialog} id={dialogId} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="w-full rounded-2xl wb-sheet" style={{ maxWidth: 480, maxHeight: "85dvh", overflowY: "auto", overscrollBehavior: "contain", background: C.bg, color: C.ink, fontFamily: FONT, padding: 14, boxShadow: "0 14px 50px rgba(26,33,30,0.18)" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
          if (e.key !== "Tab") return;
          const nodes = [...dialog.current.querySelectorAll("button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex='-1'])")].filter((node) => !node.disabled && node.getClientRects().length && node.tabIndex >= 0);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (!first) { e.preventDefault(); dialog.current.focus(); }
          else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}><span id={titleId} style={{ fontSize: 15, fontWeight: 750 }}>구글 캘린더 설정</span><button type="button" aria-label="구글 캘린더 설정 닫기" onClick={() => setOpen(false)} className="wb-btn inline-flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: "transparent", color: C.muted, border: "none", cursor: "pointer" }}><X size={18} aria-hidden="true" /></button></div>
        <GoogleCalendarPanel ui={ui} connection={connection} />
        {centerConnection && <div style={{ marginTop: 10 }}><CenterCalendarPanel ui={ui} connection={centerConnection} /></div>}
      </div>
    </div>, document.body)}
  </>;
}

export function GoogleCalendarPanel({ ui, connection }) {
  const { C, Card, Btn, FONT } = ui;
  const { config, count, state, error, writer, connect, refresh, disconnect } = connection;
  const [expanded, setExpanded] = useState(false);
  const [link, setLink] = useState("");
  const enabled = config.enabled && config.calendarId;
  const loading = state === "loading";
  return <Card style={{ padding: "11px 14px" }}>
    <div className="flex items-center gap-2 flex-wrap">
      <CalendarDays size={14} color={C.green} />
      <div className="flex-1 min-w-0"><div style={{ fontSize: 12, fontWeight: 750 }}>상담 캘린더{enabled && <span style={{ color: C.green, fontSize: 10, marginLeft: 7 }}>연결됨</span>}</div>
        {enabled && <div className="truncate" style={{ color: C.muted, fontSize: 10.5, marginTop: 2 }}>{config.name || "상담 캘린더"} · {count}건{config.fetchedAt ? ` · ${new Date(config.fetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} 확인` : ""}</div>}
      </div>
      {enabled && <Btn size="sm" icon={RefreshCw} disabled={loading} onClick={refresh}>{loading ? "불러오는 중" : "새로고침"}</Btn>}
      <button type="button" aria-expanded={expanded} onClick={() => { setLink(config.calendarId || ""); setExpanded(!expanded); }} style={{ background: "none", border: "none", color: C.navy, cursor: "pointer", fontSize: 11.5, minHeight: 34 }}>{expanded ? "접기" : enabled ? "연결 설정" : "연결하기"}</button>
    </div>
    {error && <div role="alert" style={{ color: C.seal, fontSize: 11.5, marginTop: 8 }}>{error} 기존 예약은 유지됩니다.</div>}
    {enabled && writer && <CalendarWriteControls ui={ui} config={config} writer={writer} />}
    {expanded && <div style={{ borderTop: `1px solid ${C.rule}`, marginTop: 9, paddingTop: 11 }}>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7, marginBottom: 9 }}>상담 전용 캘린더를 상담·일정에 함께 표시합니다. 구글 권한을 연결한 상담 캘린더는 비공개 상태로도 가져옵니다. 앱이 열려 있을 때 5분마다 확인합니다.</div>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>구글 캘린더 공유 링크<input value={link} onChange={(e) => setLink(e.target.value)} placeholder="공유 링크 또는 캘린더 ID" style={{ width: "100%", marginTop: 5, padding: "9px 10px", border: `1px solid ${C.rule}`, borderRadius: 8, background: C.surface, color: C.ink, fontFamily: FONT, fontSize: 12 }} /></label>
      <div className="flex items-center gap-2 mt-2"><Btn size="sm" kind="solid" disabled={loading || !link.trim()} onClick={async () => { if (await connect(link)) setExpanded(false); }}>{loading ? "연결 확인 중" : "연결하고 가져오기"}</Btn>
        {enabled && <button type="button" onClick={disconnect} style={{ color: C.muted, background: "none", border: "none", fontSize: 11, cursor: "pointer", minHeight: 34 }}>연결 중지</button>}</div>
      <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.7, marginTop: 8 }}>전년도부터 다음 연도까지 가져옵니다. 원본 일정은 구글 캘린더에서 수정합니다. 구글에 새 상담을 등록하려면 위의 쓰기 권한을 연결하세요. 연결을 중지해도 가져온 기록은 남습니다.<br />공개 캘린더에는 실명·상담 내용을 적지 않는 것이 좋습니다.</div>
    </div>}
  </Card>;
}

export function GoogleReservationEditor({ ui, reservation, clients, types, onSave, onClose }) {
  const { C, Btn, FONT, useDismiss } = ui;
  const dismiss = useDismiss(onClose);
  const [clientId, setClientId] = useState(reservation.clientId || "");
  const [type, setType] = useState(reservation.type || types[0] || "개인상담");
  const ref = useRef(null);
  const titleId = React.useId();
  useEffect(() => { const before = document.activeElement; ref.current?.querySelector("select")?.focus(); return () => before?.focus?.(); }, []);
  const inp = { width: "100%", minHeight: 42, border: `1px solid ${C.rule}`, borderRadius: 8, padding: "8px", background: C.surface, color: C.ink, fontFamily: FONT, fontSize: 13 };
  const endDate = reservation.allDay && reservation.endDate ? new Date(new Date(`${reservation.endDate}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10) : reservation.endDate;
  return <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade" style={{ zIndex: 65, background: "rgba(26,33,30,0.4)" }} {...dismiss}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") { const nodes = [...ref.current.querySelectorAll("button,select,a[href]")].filter((n) => !n.disabled); const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    }} className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet" style={{ maxWidth: 470, maxHeight: "90dvh", overflowY: "auto", background: C.bg, padding: 18 }}>
      <div className="flex items-center justify-between"><span id={titleId} style={{ fontSize: 15, fontWeight: 750 }}>구글 상담 예약</span><button type="button" aria-label="닫기" onClick={onClose} style={{ border: "none", background: "none", color: C.muted, width: 36, height: 36, cursor: "pointer" }}><X size={18} /></button></div>
      <div style={{ background: C.greenSoft, borderRadius: 10, padding: 12, margin: "10px 0 15px" }}>
        <div style={{ fontWeight: 750, fontSize: 14 }}>{reservation.externalTitle || "구글 상담"}</div>
        <div style={{ fontSize: 12, marginTop: 7 }}>{reservation.date}{endDate && endDate !== reservation.date ? ` ~ ${endDate}` : ""} · {reservation.allDay ? "종일" : `${reservation.start || "시간 미정"}${reservation.end ? `–${reservation.end}` : ""}`}</div>
        {reservation.place && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{reservation.place}</div>}
        {reservation.externalCancelled && <div style={{ color: C.seal, fontSize: 11.5, marginTop: 6 }}>구글 캘린더에서 취소되었거나 삭제된 일정입니다.</div>}
      </div>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>내담자 연결<select aria-label="내담자 연결" value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ ...inp, marginTop: 5 }}><option value="">연결하지 않음</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.birth ? ` · ${c.birth}` : ""}</option>)}</select></label>
      <label className="block mt-3" style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>상담 유형<select aria-label="상담 유형" value={type} onChange={(e) => setType(e.target.value)} style={{ ...inp, marginTop: 5 }}>{[...new Set([...types, type])].filter(Boolean).map((t) => <option key={t}>{t}</option>)}</select></label>
      <div style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.7, margin: "13px 0" }}>내담자를 연결하면 해당 내담자의 회기에 포함됩니다. 제목·날짜·시간·장소는 구글에서 수정한 내용으로 갱신됩니다. 상담일지와 완료 기록은 업무보드에 보관합니다.</div>
      <div className="flex items-center justify-between gap-2 flex-wrap"><a href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(reservation.calendarId)}`} target="_blank" rel="noopener noreferrer" style={{ color: C.navy, fontSize: 11.5 }}>구글 캘린더 열기</a><div className="flex gap-2"><Btn size="sm" onClick={onClose}>닫기</Btn><Btn size="sm" kind="solid" onClick={() => { if (onSave({ id: reservation.id, clientId, type }) !== false) onClose(); }}>연결 저장</Btn></div></div>
    </div>
  </div>;
}
