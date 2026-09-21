import React, { useEffect, useRef, useState } from "react";
import { prepareCalendarAccess, requestCalendarAccess, getCalendarAuthStatus, subscribeCalendarAuth, forgetCalendarAccess, calendarFetch } from "./googleCalendarAuth.mjs";
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
  const busy = useRef(false);
  const generation = useRef(0);
  const config = data.googleCalendar || {};
  const binding = `${config.writeClientId || ""}|${config.calendarId || ""}`;
  const connected = !!(active && auth.connected && auth.clientId === config.writeClientId && bound === binding);
  useEffect(() => subscribeCalendarAuth(setAuth), []);
  useEffect(() => {
    if (!active) { generation.current++; forgetCalendarAccess(); setBound(""); }
    return () => { generation.current++; forgetCalendarAccess(); };
  }, [active]);
  useEffect(() => {
    generation.current++; setBound("");
    if (auth.connected) forgetCalendarAccess();
  }, [config.calendarId, config.writeClientId]);

  const connect = async (clientId) => {
    const calendarId = latest.current.data.googleCalendar?.calendarId;
    if (!active || !calendarId || !latest.current.data.googleCalendar?.enabled) { setError("먼저 상담 캘린더를 연결해 주세요."); return false; }
    setError("");
    const id = String(clientId || "").trim();
    const tokenRequest = requestCalendarAccess(id);
    const stamp = ++generation.current;
    try {
      await tokenRequest;
      if (stamp !== generation.current || !latest.current.active || latest.current.data.googleCalendar?.calendarId !== calendarId) return false;
      const response = await calendarFetch(`${eventsUrl(calendarId)}?maxResults=1&fields=summary,timeZone,accessRole`);
      const calendar = await response.json();
      if (calendar.accessRole !== "owner") throw new Error("이 캘린더를 소유한 구글 계정으로 연결해 주세요.");
      if (stamp !== generation.current || !latest.current.active) return false;
      setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, writeClientId: id, writeEnabled: true, writeCalendarId: calendarId } }));
      setBound(`${id}|${calendarId}`);
      return true;
    } catch (e) { if (stamp === generation.current) { setError(e.message); setBound(""); } return false; }
  };
  const saveClientId = (clientId) => {
    const id = String(clientId || "").trim();
    if (!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)) { setError("OAuth 클라이언트 ID를 확인해 주세요."); return false; }
    setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, writeClientId: id } }));
    setError(""); return true;
  };
  const pending = (data.resv || []).filter((r) => r.googleWrite && ["pending", "sending", "error"].includes(r.googleWrite.state) && r.googleWrite.calendarId === config.calendarId && r.source !== "google-calendar");
  const eligible = pending.find((r) => r.googleWrite.state === "pending" && ["scheduled", "done"].includes(reservationStatus(r)));
  const readyToWrite = !!(eligible && isReservationStored?.(eligible));
  useEffect(() => {
    if (!active || !connected || !config.enabled || !config.writeEnabled || config.writeCalendarId !== config.calendarId || !readyToWrite || !eligible || busy.current) return;
    busy.current = true; setWorking(true);
    const snapshot = eligible;
    const target = config.calendarId;
    const stamp = generation.current;
    const update = (fn) => setData((previous) => ({ ...previous, resv: (previous.resv || []).map((r) => r.id === snapshot.id ? fn(r) : r) }));
    update((r) => ({ ...r, googleWrite: { ...r.googleWrite, state: "sending", error: "" } }));
    (async () => {
      try {
        const receipt = await publishCalendarReservation(snapshot, target, calendarFetch, () => stamp === generation.current && latest.current.active);
        if (stamp !== generation.current || !latest.current.active) return;
        setData((previous) => ({ ...previous, resv: linkWrittenReservationInList(previous.resv || [], snapshot.id, receipt).resv }));
      } catch (e) {
        if (stamp === generation.current && latest.current.active) {
          update((r) => ({ ...r, googleWrite: { ...r.googleWrite, state: "error", error: e.message } }));
          setError(e.message);
        }
      } finally { busy.current = false; setWorking(false); }
    })();
  }, [active, connected, config.enabled, config.writeEnabled, config.writeCalendarId, config.calendarId, eligible, readyToWrite, working]);

  return { auth, connected, working, error, pending: pending.length, connect, saveClientId, prepare: prepareCalendarAccess,
    retry: () => {
      setError("");
      setData((previous) => ({ ...previous, resv: (previous.resv || []).map((r) => r.googleWrite?.calendarId === config.calendarId && ["error", "sending"].includes(r.googleWrite.state) && r.source !== "google-calendar" ? { ...r, googleWrite: { ...r.googleWrite, state: "pending", error: "" } } : r) }));
    },
    stop: () => {
      generation.current++; forgetCalendarAccess(); setBound(""); setError("");
      setData((previous) => ({ ...previous, googleCalendar: { ...previous.googleCalendar, writeEnabled: false } }));
    },
  };
}

export function CalendarWriteControls({ ui, config, writer }) {
  const { C, Btn, FONT } = ui;
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(config.writeClientId || "");
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState("");
  useEffect(() => { setClientId(config.writeClientId || ""); }, [config.writeClientId]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    writer.prepare().then(() => { if (live) { setReady(true); setSetupError(""); } }).catch((e) => { if (live) setSetupError(e.message); });
    return () => { live = false; };
  }, [open]);
  return <div style={{ borderTop: `1px solid ${C.rule}`, marginTop: 9, paddingTop: 9 }}>
    <div className="flex items-center justify-between gap-2"><span style={{ fontSize: 11, color: writer.connected && config.writeEnabled ? C.green : C.muted }}>{writer.connected && config.writeEnabled ? "새 상담 자동 등록 켜짐" : config.writeEnabled ? "구글 쓰기 권한 재연결 필요" : "구글에 상담 자동 등록"}{writer.pending ? ` · 대기 ${writer.pending}건` : ""}</span><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ fontSize: 11.5, color: C.navy, background: "none", border: "none", minHeight: 32, cursor: "pointer" }}>{open ? "접기" : writer.connected ? "권한 설정" : "권한 연결"}</button></div>
    {(writer.error || setupError) && <div role="alert" style={{ color: C.seal, fontSize: 11.5, marginTop: 6 }}>{writer.error || setupError}</div>}
    {open && <div className="flex flex-col gap-2 mt-2">
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.7 }}>권한 연결 후 새 상담 예약을 <b>{config.name || "연결한 캘린더"}</b>에 자동 등록합니다. 공개 제목은 ‘상담 예약’이며 날짜·시간·장소만 보냅니다. 내담자 실명과 상담일지는 보내지 않습니다. 등록 후 날짜·시간 변경과 취소는 구글 캘린더에서 합니다.</div>
      <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>OAuth 클라이언트 ID<input aria-label="캘린더 OAuth 클라이언트 ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="000000-xxxxx.apps.googleusercontent.com" style={{ width: "100%", fontFamily: FONT, fontSize: 12, padding: "9px 10px", border: `1px solid ${C.rule}`, background: C.surface, borderRadius: 8, color: C.ink, marginTop: 5 }} /></label>
      <div className="flex gap-2 flex-wrap"><Btn size="sm" onClick={() => writer.saveClientId(clientId)} disabled={!clientId.trim()}>ID 저장</Btn><Btn size="sm" kind="solid" onClick={() => writer.connect(config.writeClientId)} disabled={!ready || !config.writeClientId || clientId.trim() !== config.writeClientId || writer.auth.connecting}>{writer.auth.connecting ? "구글 승인 기다리는 중" : "구글 계정으로 권한 연결"}</Btn>
        {!!writer.pending && writer.connected && <Btn size="sm" onClick={writer.retry} disabled={writer.working}>{writer.working ? "등록 중" : "대기 예약 다시 전송"}</Btn>}
        {config.writeEnabled && <Btn size="sm" onClick={writer.stop}>자동 등록 끄기</Btn>}</div>
      <details style={{ fontSize: 11, color: C.muted, lineHeight: 1.75 }}><summary style={{ cursor: "pointer" }}>처음 연결할 때</summary><ol style={{ paddingLeft: 18, margin: "6px 0" }}><li>Google Cloud에서 Calendar API를 사용 설정합니다.</li><li>웹 애플리케이션 OAuth 클라이언트의 승인된 JavaScript 원본에 <code>{window.location.origin}</code>을 추가합니다. 로컬 실행은 <code>http://localhost</code>도 추가합니다.</li><li>앱이 테스트 상태면 본인 계정을 테스트 사용자로 추가합니다.</li><li>위에 클라이언트 ID를 저장한 뒤 구글 계정으로 권한을 연결합니다.</li></ol></details>
      <span style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.6 }}>구글 승인 화면은 본인이 소유한 캘린더의 일정 권한을 요청합니다. 이 업무보드는 위에 연결한 캘린더만 사용합니다. 로그인 토큰은 저장하지 않으므로 앱을 새로 열거나 권한이 만료되면 다시 연결합니다. 기존 예약 전체를 자동 전송하지 않습니다.</span>
    </div>}
  </div>;
}
