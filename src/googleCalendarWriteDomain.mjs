import { reservationStatus } from "./counselingDomain.mjs";
import { parseGoogleCalendarId } from "./googleCalendarDomain.mjs";

const TIME_ZONE = "Asia/Seoul";
const PLACES = new Set(["마음", "어우리", "공감", "집단", "모래놀이", "meet"]);
const text = (value) => typeof value === "string" ? value.trim() : "";

function localId(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 1024
    || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith("gcal:")) {
    throw new Error("업무보드에서 만든 예약의 올바른 ID가 필요합니다.");
  }
  return value;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000")
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function followingDate(date) {
  const nextDate = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  if (!validDate(nextDate)) throw new Error("구글에 등록할 예약 날짜를 확인해 주세요.");
  return nextDate;
}

function writeFields(reservation) {
  if (!reservation || (reservation.source && reservation.source !== "workboard")) {
    throw new Error("외부에서 가져온 일정은 업무보드에서 다시 등록하지 않습니다.");
  }
  const id = localId(reservation.id);
  if (!validDate(reservation.date)) throw new Error("구글에 등록할 예약 날짜를 확인해 주세요.");
  // Null and undefined are the old data format's equivalent of an unset time.
  const start = reservation.start == null ? "" : reservation.start;
  const end = reservation.end == null ? "" : reservation.end;
  if (typeof start !== "string" || typeof end !== "string" || !!start !== !!end
    || (start && (!validTime(start) || !validTime(end) || end <= start))) {
    throw new Error("구글에 등록할 시작·종료 시간을 확인해 주세요. 종료 시간은 시작 시간보다 늦어야 합니다.");
  }
  const place = text(reservation.place);
  if (!PLACES.has(place)) throw new Error("구글에 등록하려면 상담 장소를 지정된 목록에서 선택해 주세요.");
  const type = text(reservation.type) || "개인상담";
  if (type.length > 120 || /[\u0000-\u001f\u007f]/.test(type)) throw new Error("구글에 등록할 상담 유형을 확인해 주세요.");
  return { id, date: reservation.date, start, end, place, type, status: reservationStatus(reservation) };
}

/**
 * A stable ID makes a retry address the same event, including after a timeout.
 * Calendar event IDs permit only [0-9a-v], so use a hexadecimal prefix and hash.
 * See https://developers.google.com/workspace/calendar/api/v3/reference/events#id
 */
export async function googleEventId(reservationId) {
  const id = localId(reservationId);
  if (!globalThis.crypto?.subtle) throw new Error("안전한 연결에서 다시 시도해 주세요.");
  const bytes = new TextEncoder().encode(`workboard:reservation:${id}`);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return "b0" + [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build only the permitted scheduling fields. Do not spread reservation data:
 * client identities, notes, contact details, issues, logs and files stay local.
 * The caller adds googleEventId(r.id) for events.insert and retains its iCalUID
 * response to match the later public-feed echo to the original local record.
 * This function never creates a deletion/cancellation request.
 */
export function buildCalendarEvent(reservation) {
  const fields = writeFields(reservation);
  if (fields.status === "cancelled") {
    throw new Error("취소된 예약은 구글 캘린더에 자동 등록하지 않습니다.");
  }
  let start, end;
  if (fields.start) {
    start = { dateTime: `${fields.date}T${fields.start}:00+09:00`, timeZone: TIME_ZONE };
    end = { dateTime: `${fields.date}T${fields.end}:00+09:00`, timeZone: TIME_ZONE };
  } else {
    start = { date: fields.date };
    end = { date: followingDate(fields.date) };
  }
  return {
    summary: "상담 예약",
    location: fields.place,
    start,
    end,
    extendedProperties: { private: { workboardReservationId: fields.id } },
  };
}

/** Queue identity changes only for scheduling fields and the local status. */
export function calendarWriteFingerprint(reservation) {
  const { date, start, end, place, type, status } = writeFields(reservation);
  return JSON.stringify({ date, start, end, place, type, status });
}

/**
 * Link a confirmed API creation to its public-feed identity without replacing
 * local client links, journals, status, or the original reservation ID.
 * Only validated primitive response identifiers are copied into stored data.
 */
function writeReceipt(response, now) {
  if (!response || typeof response.calendarId !== "string" || typeof response.eventId !== "string"
    || typeof response.iCalUID !== "string" || !/^[0-9a-v]{5,1024}$/.test(response.eventId)
    || !response.iCalUID || response.iCalUID !== response.iCalUID.trim() || response.iCalUID.length > 1024
    || /[\u0000-\u001f\u007f]/.test(response.iCalUID) || !Number.isFinite(now) || now < 0) {
    throw new Error("구글에 등록된 일정의 연결 정보를 확인해 주세요.");
  }
  const calendarId = parseGoogleCalendarId(response.calendarId);
  let externalId;
  try { externalId = `${encodeURIComponent(response.iCalUID)}::single`; }
  catch { throw new Error("구글 일정의 식별자를 확인해 주세요."); }
  return { calendarId, externalId, eventId: response.eventId, iCalUID: response.iCalUID };
}

export function linkWrittenReservation(reservation, response, now = Date.now()) {
  const fields = writeFields(reservation);
  const { calendarId, externalId, eventId, iCalUID } = writeReceipt(response, now);
  return { ...reservation, source: "google-calendar", calendarId, externalId, externalTitle: "상담 예약",
    endDate: fields.start ? fields.date : followingDate(fields.date), allDay: !fields.start,
    externalAwaitingFeed: true, externalCancelled: false,
    googleWrite: { state: "sent", eventId, calendarId, iCalUID, at: now }, updatedAt: now };
}

function mergeEchoLog(local, echo, echoId) {
  if (!echo || typeof echo !== "object" || Array.isArray(echo)) return local;
  if (!local || typeof local !== "object" || Array.isArray(local)) return echo;
  const result = { ...echo, ...local };
  const localText = typeof local.text === "string" ? local.text : "";
  const echoText = typeof echo.text === "string" ? echo.text : "";
  if (echoText && echoText !== localText) {
    result.text = localText ? `${localText}\n\n[구글 일정에서 작성한 일지]\n${echoText}` : echoText;
  }
  if (Array.isArray(echo.files)) {
    const files = Array.isArray(local.files) ? [...local.files] : [];
    for (const file of echo.files) {
      if (files.some((previous) => JSON.stringify(previous) === JSON.stringify(file))) continue;
      // A reused attachment ID must not hide a different attachment in React.
      if (file?.id && files.some((previous) => previous?.id === file.id)) {
        let id = `${file.id}-echo-${encodeURIComponent(echoId)}`;
        while (files.some((previous) => previous?.id === id)) id += "-copy";
        files.push({ ...file, id });
      } else files.push(file);
    }
    result.files = files;
  }
  return result;
}

/**
 * Atomically link the original reservation and coalesce any public-feed echo
 * that arrived before the insert response. A complete echo snapshot remains
 * locally available in googleMergedEchoes so conflicting edits are recoverable.
 * Unrelated events are never matched by their title, date or client name.
 */
export function linkWrittenReservationInList(reservations, reservationId, response, now = Date.now()) {
  if (!Array.isArray(reservations)) throw new Error("상담 예약 목록을 확인해 주세요.");
  const { calendarId, externalId, eventId } = writeReceipt(response, now);
  const index = reservations.findIndex((r) => r?.id === reservationId);
  if (index < 0) return { resv: reservations, mergedEchoIds: [], conflicts: [], missingLocal: true };
  const original = reservations[index];
  const alreadyLinked = original.source === "google-calendar" && original.calendarId === calendarId
    && original.externalId === externalId && original.googleWrite?.eventId === eventId;
  let linked = alreadyLinked ? original : linkWrittenReservation(original, response, now);
  const echoes = reservations.filter((r, at) => at !== index && r?.source === "google-calendar"
    && r.calendarId === calendarId && r.externalId === externalId);
  const conflicts = [];
  if (echoes.length) {
    const archived = [...(Array.isArray(linked.googleMergedEchoes) ? linked.googleMergedEchoes : [])];
    let log = linked.log;
    for (const echo of echoes) {
      // The local record remains authoritative for client/type/status. Preserve
      // both values in the archived original and return a UI-visible notice.
      if (echo.clientId && echo.clientId !== linked.clientId) conflicts.push({ echoId: echo.id, field: "clientId" });
      if (echo.type && echo.type !== "개인상담" && echo.type !== linked.type) conflicts.push({ echoId: echo.id, field: "type" });
      if (reservationStatus(echo) !== "scheduled" && reservationStatus(echo) !== reservationStatus(linked)) conflicts.push({ echoId: echo.id, field: "status" });
      if (!archived.some((entry) => JSON.stringify(entry) === JSON.stringify(echo))) archived.push({ ...echo });
      log = mergeEchoLog(log, echo.log, echo.id || externalId);
    }
    linked = { ...linked, ...(log === undefined ? {} : { log }), externalAwaitingFeed: false,
      googleMergedEchoes: archived, updatedAt: now };
  }
  if (alreadyLinked && !echoes.length) return { resv: reservations, mergedEchoIds: [], conflicts, missingLocal: false };
  const echoSet = new Set(echoes);
  const resv = reservations.flatMap((r, at) => at === index ? [linked] : echoSet.has(r) ? [] : [r]);
  return { resv, mergedEchoIds: echoes.map((r) => r.id), conflicts, missingLocal: false };
}
