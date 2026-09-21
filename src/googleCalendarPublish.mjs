import { parseGoogleCalendarId } from "./googleCalendarDomain.mjs";
import { buildCalendarEvent, googleEventId } from "./googleCalendarWriteDomain.mjs";

function publishError(code, message) {
  const error = new Error(message);
  error.name = "CalendarPublishError";
  error.code = code;
  return error;
}

function validICalUID(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 1024
    || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}

/**
 * Publish one saved local reservation, or recover its previous successful POST.
 * Only a 409 triggers a read of the same deterministic ID; this never updates
 * an existing event or chooses a second ID after an ambiguous network failure.
 * The caller commits the returned receipt only while its own guard is current.
 */
export async function publishCalendarReservation(reservation, calendarId, fetchCalendar, guard = () => true) {
  const ensureCurrent = () => {
    if (!guard()) throw publishError("cancelled", "Google 캘린더 등록을 취소했습니다.");
  };
  ensureCurrent();
  const target = parseGoogleCalendarId(calendarId);
  // Capture permitted fields before the first await, so the response is checked
  // against exactly the local identity used to build this request.
  const payload = buildCalendarEvent(reservation);
  const localId = payload.extendedProperties.private.workboardReservationId;
  const eventId = await googleEventId(localId);
  payload.id = eventId;
  ensureCurrent();
  const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target)}/events`;
  let response;
  try {
    response = await fetchCalendar(`${eventsUrl}?sendUpdates=none`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch (error) {
    ensureCurrent();
    if (error?.status !== 409) throw error;
    response = await fetchCalendar(`${eventsUrl}/${eventId}`, { method: "GET" });
  }
  ensureCurrent();
  const remote = await response.json();
  ensureCurrent();
  if (!remote || remote.id !== eventId || remote.status === "cancelled"
    || remote.extendedProperties?.private?.workboardReservationId !== localId
    || !validICalUID(remote.iCalUID)) {
    throw publishError("invalid_remote_event", "같은 식별자의 구글 일정을 확인하지 못했습니다. 원본을 확인해 주세요.");
  }
  return { calendarId: target, eventId, iCalUID: remote.iCalUID };
}
