import React, { useEffect, useRef, useState } from "react";
import { prepareCalendarAccess, requestCalendarAccess, restoreCalendarAccess, disconnectCalendarAccess, getCalendarAuthStatus, subscribeCalendarAuth, forgetCalendarAccess, calendarFetch } from "./googleCalendarSession.mjs";
import { linkWrittenReservationInList } from "./googleCalendarWriteDomain.mjs";
import { publishCalendarReservation } from "./googleCalendarPublish.mjs";
import { reservationStatus } from "./counselingDomain.mjs";

const eventsUrl = (id) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`;

export function useGoogleCalendarWriter({ data, setData, active, isReservationStored }) {
  const latest = useRef({ data, active }); latest.current = { data, active };
  const [auth, setAuth] = useState(getCalendarAuthStatus);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [bound, setBound] = useState("");
  const [clock, setClock] = useState(Date.now);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const config = data.googleCalendar || {};
  const binding = `${config.writeClientId || ""}|${config.calendarId || ""}`;
  const connected = !!(active && auth.connected && auth.clientId === config.writeClientId && bound === binding);
  useEffect(() => subscribeCalendarAuth(setAuth), []);
  useEffect(() => {
    if (!active) { generation.current++; forgetCalendarAccess(); setBound(""); }
    return () => { generation.current++; forgetCalendarAccess(); };
  }, [active, config.calendarId]);

  useEffect(() => {
    if (!active || !config.enabled || !config.writeEnabled || !config.calendarId) return;
    const calendarId = config.calendarId;
    let live = true, timer, inFlight = false, failures = 0, lastAttempt = 0;
    const schedule = (delay) => { clearTimeout(timer); if (live) timer = setTimeout(restore, delay); };
    const restore = async () => {
      if (!live || inFlight) return;
      if (document.visibilityState === "hidden" || busy.current || getCalendarAuthStatus().connecting) { schedule(10000); return; }
      inFlight = true; lastAttempt = Date.now();
      const stamp = generation.current;
      try {
        const restored = await restoreCalendarAccess(calendarId);
        if (!live || stamp !== generation.current || !latest.current.active || latest.current.data.googleCalendar?.calendarId !== calendarId) return;
        failures = 0;
        if (restored.connected) {
          setBound(`${restored.clientId}|${calendarId}`); setError("");
          setData((previous) => ({ ...previous,
            googleCalendar: { ...previous.googleCalendar, writeClientId: restored.clientId, writeCalendarId: calendarId },
            // A closed window may have missed a successful response. The same
            // deterministic event ID makes recovery safe without duplicates.
            resv: (previous.resv || []).map((r) => r.googleWrite?.calendarId === calendarId && (r.googleWrite.state === "sending" || (r.googleWrite.state === "error" && r.googleWrite.reauthorize)) && r.source !== "google-calendar"
              ? { ...r, googleWrite: { ...r.googleWrite, state: "pending", error: "", reauthorize: false } } : r),
          }));
          schedule(5 * 60 * 1000);
        }
      } catch (failure) {
        if (live && failure.code !== "cancelled" && failure.retryable) schedule(Math.min(120000, 2000 * (2 ** failures++)));
      } finally { inFlight = false; }
    };
    const wake = () => { if (Date.now() - lastAttempt >= 1000 && document.visibilityState !== "hidden") void restore(); };
    const unsubscribe = subscribeCalendarAuth((state) => {
      if (!inFlight && state.retryable) schedule(2000);
      else if (!inFlight && state.connected && state.persistent) schedule(5 * 60 * 1000);
    });
    if (getCalendarAuthStatus().connected) schedule(5 * 60 * 1000);
    else void restore();
    window.addEventListener("focus", wake); window.addEventListener("online", wake); document.addEventListener("visibilitychange", wake);
    return () => { live = false; clearTimeout(timer); unsubscribe(); window.removeEventListener("focus", wake); window.removeEventListener("online", wake); document.removeEventListener("visibilitychange", wake); };
  }, [active, config.enabled, config.writeEnabled, config.calendarId]);

  const connect = async (clientId) => {
    const calendarId = latest.current.data.googleCalendar?.calendarId;
    if (!active || !calendarId || !latest.current.data.googleCalendar?.enabled) { setError("먼저 상담 캘린더를 연결해 주세요."); return false; }
    setError("");
    const id = auth.configured ? auth.serverClientId : String(clientId || "").trim();
    const tokenRequest = requestCalendarAccess(id, calendarId);
    const stamp = ++generation.current;
    try {
      const connectedAuth = await tokenRequest;
      if (stamp !== generation.current || !latest.current.active || latest.current.data.googleCalendar?.calendarId !== calendarId) return false;
      if (!connectedAuth.persistent) {
        const response = await calendarFetch(`${eventsUrl(calendarId)}?maxResults=1&fields=summary,timeZone,accessRole`);
        const calendar = await response.json();
        if (calendar.accessRole !== "owner") throw new Error("이 캘린더를 소유한 구글 계정으로 연결해 주세요.");
      }
      if (stamp !== generation.current || !latest.current.active) return false;
      setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, writeClientId: id, writeEnabled: true, writeCalendarId: calendarId },
        resv: (previous.resv || []).map((r) => r.googleWrite?.calendarId === calendarId && (r.googleWrite.state === "sending" || (r.googleWrite.state === "error" && r.googleWrite.reauthorize)) && r.source !== "google-calendar"
          ? { ...r, googleWrite: { ...r.googleWrite, state: "pending", error: "", reauthorize: false } } : r),
      }));
      setBound(`${id}|${calendarId}`); setDisconnectFailed(false);
      return true;
    } catch (e) { if (stamp === generation.current) { setError(e.message); setBound(""); } return false; }
  };
  const saveClientId = (clientId) => {
    const id = String(clientId || "").trim();
    if (!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)) { setError("OAuth 클라이언트 ID를 확인해 주세요."); return false; }
    if (id !== config.writeClientId) { generation.current++; forgetCalendarAccess(); setBound(""); }
    setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, writeClientId: id } }));
    setError(""); return true;
  };
  const pending = (data.resv || []).filter((r) => r.googleWrite && ["pending", "sending", "error"].includes(r.googleWrite.state) && r.googleWrite.calendarId === config.calendarId && r.source !== "google-calendar");
  const retryTimes = pending.filter((r) => r.googleWrite.state === "error" && r.googleWrite.retryable && (r.googleWrite.attempts || 0) < 5).map((r) => r.googleWrite.retryAt || 0);
  const nextRetry = retryTimes.length ? Math.min(...retryTimes) : 0;
  useEffect(() => {
    if (!active || !connected || !nextRetry || nextRetry <= clock) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, nextRetry - Date.now()));
    return () => clearTimeout(timer);
  }, [active, connected, nextRetry, clock]);
  const eligible = pending.find((r) => (r.googleWrite.state === "pending" || (r.googleWrite.state === "error" && r.googleWrite.retryable && (r.googleWrite.attempts || 0) < 5 && (r.googleWrite.retryAt || 0) <= Math.max(clock, Date.now()))) && ["scheduled", "done"].includes(reservationStatus(r)));
  const readyToWrite = !!(eligible && isReservationStored?.(eligible));
  useEffect(() => {
    if (!active || !connected || !config.enabled || !config.writeEnabled || config.writeCalendarId !== config.calendarId || !readyToWrite || !eligible || busy.current) return;
    busy.current = true; setWorking(true);
    const snapshot = eligible;
    const target = config.calendarId;
    const stamp = generation.current;
    const update = (fn) => setData((previous) => ({ ...previous, resv: (previous.resv || []).map((r) => r.id === snapshot.id ? fn(r) : r) }));
    const attempts = (snapshot.googleWrite.attempts || 0) + 1;
    update((r) => ({ ...r, googleWrite: { ...r.googleWrite, state: "sending", error: "", attempts, retryable: false, reauthorize: false, retryAt: 0 } }));
    (async () => {
      try {
        const receipt = await publishCalendarReservation(snapshot, target, calendarFetch, () => stamp === generation.current && latest.current.active
          && latest.current.data.googleCalendar?.enabled && latest.current.data.googleCalendar?.writeEnabled
          && latest.current.data.googleCalendar?.calendarId === target && latest.current.data.googleCalendar?.writeCalendarId === target);
        if (stamp !== generation.current || !latest.current.active) return;
        setData((previous) => ({ ...previous, resv: linkWrittenReservationInList(previous.resv || [], snapshot.id, receipt).resv }));
      } catch (e) {
        if (stamp === generation.current && latest.current.active) {
          update((r) => ({ ...r, googleWrite: { ...r.googleWrite, state: "error", error: e.message, retryable: !!e.retryable, reauthorize: e.status === 401, retryAt: e.retryable ? Date.now() + Math.min(120000, 2000 * (2 ** attempts)) : 0 } }));
          setError(e.message);
        }
      } finally { busy.current = false; setWorking(false); }
    })();
  }, [active, connected, config.enabled, config.writeEnabled, config.writeCalendarId, config.calendarId, eligible, readyToWrite, working]);

  return { auth, connected, working, error, disconnectFailed, pending: pending.length, connect, saveClientId, prepare: prepareCalendarAccess,
    retry: () => {
      setError("");
      setData((previous) => ({ ...previous, resv: (previous.resv || []).map((r) => r.googleWrite?.calendarId === config.calendarId && ["error", "sending"].includes(r.googleWrite.state) && r.source !== "google-calendar" ? { ...r, googleWrite: { ...r.googleWrite, state: "pending", error: "", attempts: 0, retryable: false, retryAt: 0 } } : r) }));
    },
    stop: async () => {
      generation.current++; forgetCalendarAccess(); setBound(""); setError("");
      setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, writeEnabled: false } }));
      try { await disconnectCalendarAccess(); setDisconnectFailed(false); }
      catch (failure) { setDisconnectFailed(true); setError(failure.message); }
    },
  };
}

export function CalendarWriteControls({ ui, config, writer }) {
  const { C, Btn, FONT } = ui;
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(config.writeClientId || "");
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState("");
  const persistentSetup = writer.auth.configured === true;
  const statusText = writer.connected && config.writeEnabled ? (writer.auth.persistent ? "상담 자동 동기화 켜짐" : "새 상담 자동 등록 켜짐 · 임시 연결")
    : writer.auth.connecting ? "구글 승인 기다리는 중" : writer.auth.checking ? "구글 연결 확인 중"
    : writer.auth.retryable ? "연결 복구 중 · 자동 재시도" : config.writeEnabled ? (writer.auth.configured === false ? "자동 연결 유지 설정 필요" : "구글 권한 연결 필요") : "구글에 상담 자동 등록";
  useEffect(() => { setClientId(config.writeClientId || ""); }, [config.writeClientId]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setReady(false);
    writer.prepare().then(() => { if (live) { setReady(true); setSetupError(""); } }).catch((e) => { if (live) { setReady(false); setSetupError(e.message); } });
    return () => { live = false; };
  }, [open]);
  return <div style={{ borderTop: `1px solid ${C.rule}`, marginTop: 9, paddingTop: 9 }}>
    <div className="flex items-center justify-between gap-2"><span aria-live="polite" style={{ fontSize: 11, color: writer.connected && config.writeEnabled ? C.green : C.muted }}>{statusText}{writer.pending ? ` · 대기 ${writer.pending}건` : ""}</span><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ fontSize: 11.5, color: C.navy, background: "none", border: "none", minHeight: 32, cursor: "pointer" }}>{open ? "접기" : writer.connected ? "권한 설정" : "권한 연결"}</button></div>
    {(writer.error || setupError || (writer.auth.error && !writer.auth.retryable)) && <div role="alert" style={{ color: C.seal, fontSize: 11.5, marginTop: 6 }}>{writer.error || setupError || writer.auth.error}</div>}
    {open && <div className="flex flex-col gap-2 mt-2">
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7 }}>권한 연결 후 새 상담 예약을 <b>{config.name || "연결한 캘린더"}</b>에 자동 등록합니다. 공개 제목은 ‘상담 예약’이며 날짜·시간·장소만 보냅니다. 내담자 실명과 상담일지는 보내지 않습니다. 등록 후 날짜·시간 변경과 취소는 구글 캘린더에서 합니다.</div>
      {persistentSetup ? <div style={{ fontSize: 11.5, color: C.green, lineHeight: 1.7 }}>한 번 승인하면 이 브라우저에서 앱을 다시 열 때 자동으로 연결합니다. 연결을 해제하거나 Google 권한이 취소·만료된 경우에는 다시 승인이 필요합니다.</div>
        : <><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7 }}>{writer.auth.configured === false ? "이 주소는 자동 연결 유지 설정이 아직 완료되지 않았습니다. 아래 임시 연결은 앱을 다시 열면 재승인이 필요합니다." : "자동 연결 유지 설정을 확인하고 있습니다."}</div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>OAuth 클라이언트 ID<input aria-label="캘린더 OAuth 클라이언트 ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="000000-xxxxx.apps.googleusercontent.com" style={{ width: "100%", fontFamily: FONT, fontSize: 12, padding: "9px 10px", border: `1px solid ${C.rule}`, background: C.surface, borderRadius: 8, color: C.ink, marginTop: 5 }} /></label></>}
      <div className="flex gap-2 flex-wrap">{!persistentSetup && <Btn size="sm" onClick={() => writer.saveClientId(clientId)} disabled={!clientId.trim()}>ID 저장</Btn>}<Btn size="sm" kind="solid" onClick={() => writer.connect(config.writeClientId)} disabled={!ready || (!persistentSetup && (!config.writeClientId || clientId.trim() !== config.writeClientId)) || writer.auth.connecting || writer.auth.checking}>{writer.auth.connecting ? "구글 승인 기다리는 중" : writer.connected ? "구글 계정 다시 연결" : persistentSetup ? "구글 계정 연결 · 자동 유지" : "구글 계정으로 임시 연결"}</Btn>
        {!!writer.pending && writer.connected && <Btn size="sm" onClick={writer.retry} disabled={writer.working}>{writer.working ? "등록 중" : "대기 예약 다시 전송"}</Btn>}
        {(config.writeEnabled || writer.disconnectFailed) && <Btn size="sm" onClick={writer.stop}>{writer.disconnectFailed ? "연결 해제 다시 시도" : "자동 등록 끄기 · 연결 해제"}</Btn>}</div>
      {!persistentSetup && <details style={{ fontSize: 11, color: C.muted, lineHeight: 1.75 }}><summary style={{ cursor: "pointer" }}>처음 연결할 때</summary><ol style={{ paddingLeft: 18, margin: "6px 0" }}><li>Google Cloud에서 Calendar API를 사용 설정합니다.</li><li>웹 애플리케이션 OAuth 클라이언트의 승인된 JavaScript 원본에 <code>{window.location.origin}</code>을 추가합니다. 로컬 실행은 <code>http://localhost</code>도 추가합니다.</li><li>앱이 테스트 상태면 본인 계정을 테스트 사용자로 추가합니다.</li><li>위에 클라이언트 ID를 저장한 뒤 구글 계정으로 권한을 연결합니다.</li></ol></details>}
      <span style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.6 }}>구글 승인 화면은 본인이 소유한 캘린더의 일정 권한을 요청합니다. 이 업무보드는 설정한 상담·센터 캘린더만 사용합니다. 계정 권한은 함께 사용하므로 연결 해제 시 센터 일정도 다시 연결해야 합니다. {persistentSetup ? "앱이 열려 있으면 연결과 대기 예약을 자동으로 확인하며, 닫힌 동안 바뀐 구글 일정은 다시 열 때 가져옵니다. 브라우저의 사이트 데이터를 지우면 다시 연결해야 합니다." : "자동 연결 유지에는 서버 설정이 필요합니다."} 기존 예약 전체를 자동 전송하지 않습니다.</span>
    </div>}
  </div>;
}
