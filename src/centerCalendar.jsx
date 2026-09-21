import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { centerCalendarRequest, getCalendarAuthStatus, subscribeCalendarAuth, prepareCalendarAccess, requestCalendarAccess } from "./googleCalendarSession.mjs";
import { CENTER_CALENDAR_ID, centerEventPending, centerRemoteEvent, isHiddenCenterEvent, mergeCenterCalendar, nextCenterWrite, resolveCenterConflict, writeNextCenterEvent } from "./centerCalendarDomain.mjs";

const POLL_MS = 45000;
function range() {
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
  return { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` };
}

export function useCenterCalendar({ data, setData, active, isEventStored }) {
  const current = useRef(); current.current = { data, setData, active, isEventStored };
  const generation = useRef(0), busy = useRef(false), controller = useRef(null), lastPull = useRef(0), forcePull = useRef(true);
  const [clock, setClock] = useState(Date.now), [state, setState] = useState("idle"), [error, setError] = useState("");
  const [connected, setConnected] = useState(false), [auth, setAuth] = useState(getCalendarAuthStatus), [prepared, setPrepared] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const enabled = data.centerCalendar?.enabled !== false;
  const config = { ...data.centerCalendar, enabled, calendarId: CENTER_CALENDAR_ID };
  const wake = (force = false) => { if (force) forcePull.current = true; setClock(Date.now()); };
  const update = (fn) => current.current.setData(fn);
  useEffect(() => subscribeCalendarAuth(setAuth), []);
  useEffect(() => {
    if (!active) { setPrepared(false); return; }
    let live = true;
    prepareCalendarAccess().then(() => { if (live) setPrepared(true); }).catch(() => { if (live) setPrepared(false); });
    return () => { live = false; };
  }, [active]);
  useEffect(() => {
    if (auth.connected) { setNeedsPermission(false); wake(true); }
  }, [auth.connected]);
  useEffect(() => {
    generation.current++;
    if (!active || !enabled) { controller.current?.abort(); controller.current = null; setState("idle"); setConnected(false); }
    const check = () => { if (!document.hidden) wake(); };
    if (active && enabled) {
      forcePull.current = true; check();
      window.addEventListener("focus", check); window.addEventListener("online", check); document.addEventListener("visibilitychange", check);
    }
    const timer = active && enabled ? setInterval(check, POLL_MS) : null;
    return () => {
      generation.current++; controller.current?.abort(); controller.current = null;
      clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check);
    };
  }, [active, enabled]);

  useEffect(() => {
    if (!active || !enabled || busy.current || document.hidden || auth.connecting) return;
    const eligible = nextCenterWrite(data);
    const conflict = (data.events || []).find((event) => event.centerSync?.calendarId === CENTER_CALENDAR_ID && event.centerSync.state === "conflict" && !event.centerSync.conflictChecked && (event.centerSync.conflictRetryAt || 0) <= Date.now());
    const due = forcePull.current || Date.now() - lastPull.current >= POLL_MS;
    if (!(eligible && isEventStored?.(eligible)) && !conflict && !due) return;
    busy.current = true; setState("syncing");
    const stamp = generation.current;
    const requestController = new AbortController(); controller.current = requestController;
    const valid = () => stamp === generation.current && current.current.active && current.current.data.centerCalendar?.enabled !== false && !requestController.signal.aborted;
    const request = async (operation, payload) => {
      try {
        const value = await centerCalendarRequest(operation, payload, { signal: requestController.signal });
        if (valid()) { setConnected(true); setNeedsPermission(false); setError(""); }
        return value;
      } catch (failure) {
        if (valid() && failure.status === 401) { setConnected(false); setNeedsPermission(true); }
        throw failure;
      }
    };
    (async () => {
      try {
        if (conflict) {
          const result = await request("get", { eventId: conflict.centerSync.eventId });
          if (!valid()) return;
          if (result?.calendarId !== CENTER_CALENDAR_ID || (result.item && result.item.id !== conflict.centerSync.eventId)) throw new Error("구글 센터 일정의 최신 버전을 확인하지 못했습니다.");
          if (result.item) centerRemoteEvent(result.item, conflict);
          update((previous) => ({ ...previous, events: (previous.events || []).map((event) => event.id === conflict.id && event.centerSync?.state === "conflict"
            ? { ...event, centerSync: { ...event.centerSync, conflictRemote: result.item || undefined, conflictMissing: !result.item || result.item.status === "cancelled", conflictChecked: true } } : event) }));
        } else if (eligible && current.current.isEventStored?.(eligible)) {
          const outcome = await writeNextCenterEvent({ getData: () => current.current.data, setData: update, request,
            isEventStored: (event) => current.current.isEventStored?.(event), isCurrent: valid });
          if (!valid()) return;
          if (outcome === "error" || outcome === "conflict") setState("error");
          else setState("ok");
          // Let the state and durable local save settle before the next queue item.
          return;
        }
        if (due) {
          forcePull.current = false; lastPull.current = Date.now();
          const payload = await request("list", range());
          if (!valid()) return;
          mergeCenterCalendar(current.current.data, payload);
          update((previous) => mergeCenterCalendar(previous, payload));
        }
        if (valid()) { setError(""); setState("ok"); }
      } catch (failure) {
        if (valid() && failure.code !== "cancelled") {
          setError(failure.message); setState("error");
          if (failure.status === 401) { setConnected(false); setNeedsPermission(true); }
          // A failed conflict lookup waits for the next poll; no repeated requests.
          if (conflict) update((previous) => ({ ...previous, events: (previous.events || []).map((event) => event.id === conflict.id
            ? { ...event, centerSync: { ...event.centerSync, conflictRetryAt: Date.now() + POLL_MS } } : event) }));
        }
      } finally {
        busy.current = false;
        if (controller.current === requestController) controller.current = null;
        if (valid()) setClock(Date.now());
      }
    })();
  }, [active, enabled, data.events, clock, isEventStored, auth.connecting]);

  const retry = () => {
    setError(""); setNeedsPermission(false);
    update((previous) => ({ ...previous, events: (previous.events || []).map((event) => event.centerSync?.calendarId === CENTER_CALENDAR_ID && event.centerSync.state === "error"
      ? { ...event, centerSync: { ...event.centerSync, state: "pending", error: "", retryAt: 0, attempts: 0 } } : event) }));
    wake(true);
  };
  const connect = async () => {
    if (!active) return false;
    if (needsPermission) {
      try {
        // The call stays directly in the click handler, preserving user activation.
        await requestCalendarAccess(auth.serverClientId, auth.serverCalendarId);
      } catch (failure) { setError(failure.message); return false; }
    }
    update((previous) => ({ ...previous, centerCalendar: { ...previous.centerCalendar, calendarId: CENTER_CALENDAR_ID, enabled: true } }));
    retry(); return true;
  };
  const pendingRows = (data.events || []).filter(centerEventPending);
  return { config, connected, state, error, auth, needsPermission, ready: prepared, pending: pendingRows.length,
    pendingRows, conflicts: pendingRows.filter((event) => event.centerSync.state === "conflict"),
    count: (data.events || []).filter((event) => event.centerSync?.calendarId === CENTER_CALENDAR_ID && !isHiddenCenterEvent(event)).length,
    connect, refresh: () => wake(true), retry,
    prepare: async () => { try { await prepareCalendarAccess(); setPrepared(true); setError(""); } catch (failure) { setError(failure.message); } },
    resolveConflict: (id, choice) => { update((previous) => resolveCenterConflict(previous, id, choice)); wake(true); },
    stop: () => { update((previous) => ({ ...previous, centerCalendar: { ...previous.centerCalendar, calendarId: CENTER_CALENDAR_ID, enabled: false } })); },
  };
}

export function CenterCalendarPanel({ ui, connection }) {
  const { C, Card, Btn } = ui;
  const { config, connected, state, error, needsPermission, ready, count, pending, pendingRows, conflicts, auth } = connection;
  const working = state === "syncing" || auth.connecting;
  const rowError = pendingRows.find((event) => event.centerSync.state === "error")?.centerSync.error;
  const status = !config.enabled ? "동기화 중지됨" : working ? "동기화 중" : connected ? "양방향 동기화 켜짐" : needsPermission ? "구글 권한 연결 필요" : "연결 확인 중";
  return <Card style={{ padding: "11px 14px", marginTop: 10 }}>
    <div className="flex items-center gap-2 flex-wrap">
      <CalendarDays size={14} color={C.navy} />
      <div className="flex-1 min-w-0"><div style={{ fontSize: 12, fontWeight: 750 }}>센터 일정 <span style={{ color: connected && config.enabled ? C.green : C.muted, fontSize: 10, marginLeft: 4 }}>{status}</span></div>
        <div style={{ color: C.muted, fontSize: 10.5, marginTop: 3 }}>{count}건{pending ? ` · 전송 대기 ${pending}건` : ""}{config.fetchedAt ? ` · ${new Date(config.fetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 확인` : ""}</div>
      </div>
      {config.enabled && !needsPermission ? <Btn size="sm" icon={RefreshCw} disabled={working} onClick={connection.refresh}>새로고침</Btn>
        : <Btn size="sm" disabled={working} onClick={needsPermission && !ready ? connection.prepare : connection.connect}>{needsPermission ? ready ? "구글 권한 연결" : "권한 연결 준비" : "연결하기"}</Btn>}
    </div>
    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.65, marginTop: 9 }}>일정의 ‘센터 일정’에서 새로 등록하거나 수정하면 구글에도 반영됩니다. 구글의 수정·삭제는 앱이 열려 있는 동안 약 45초마다 확인합니다. 기존 업무보드 일정은 수정할 때 연결됩니다.</div>
    {(error || rowError) && <div role="alert" style={{ fontSize: 11, color: C.seal, marginTop: 8 }}>{error || rowError}</div>}
    {pendingRows.some((event) => event.centerSync.state === "error") && <Btn size="sm" disabled={working} onClick={connection.retry}>대기 일정 다시 전송</Btn>}
    {conflicts.map((event) => <div key={event.id} style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.rule}`, fontSize: 11 }}>
      <div style={{ fontWeight: 700 }}>{event.title || "센터 일정"} · 변경 확인</div>
      <div style={{ color: C.muted, margin: "5px 0", lineHeight: 1.6 }}>{event.centerSync.conflictChecked ? event.centerSync.conflictMissing ? "구글에서 삭제된 일정입니다. 내 변경을 유지하면 새 일정으로 등록합니다." : "구글에서도 수정된 일정입니다. 유지할 내용을 선택해 주세요." : "구글의 최신 내용을 확인하고 있습니다."}</div>
      {event.centerSync.conflictRemote && !event.centerSync.conflictMissing && <div style={{ color: C.muted, fontSize: 10.5, lineHeight: 1.65, marginBottom: 7 }}>앱: {event.title} · {event.date} {event.start || "종일"}<br />구글: {event.centerSync.conflictRemote.summary || "제목 없음"} · {centerRemoteEvent(event.centerSync.conflictRemote).date} {centerRemoteEvent(event.centerSync.conflictRemote).start || "종일"}</div>}
      <div className="flex gap-2 flex-wrap"><Btn size="sm" disabled={working || !event.centerSync.conflictChecked} onClick={() => connection.resolveConflict(event.id, "local")}>내 변경 유지</Btn><Btn size="sm" disabled={working || !event.centerSync.conflictChecked} onClick={() => connection.resolveConflict(event.id, "remote")}>구글 변경 가져오기</Btn></div>
    </div>)}
    <div className="flex items-center justify-between" style={{ marginTop: 8 }}><a href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(CENTER_CALENDAR_ID)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: C.navy }}>구글 센터 캘린더 열기</a>{config.enabled && <button type="button" onClick={connection.stop} style={{ background: "none", border: 0, color: C.faint, cursor: "pointer", fontSize: 10.5, minHeight: 30 }}>동기화 중지</button>}</div>
  </Card>;
}
