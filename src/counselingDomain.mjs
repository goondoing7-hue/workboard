export const CLIENT_STATUSES = Object.freeze({
  waiting: "상담대기",
  active: "상담진행",
  hold: "상담보류",
  closed: "상담종결",
});

export const RESERVATION_STATUSES = Object.freeze({
  scheduled: "예정",
  done: "완료",
  cancelled: "취소",
  noshow: "노쇼",
});

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isActive = (reservation) => ["scheduled", "done"].includes(reservationStatus(reservation));

export function clientStatus(client) {
  return owns(CLIENT_STATUSES, client?.status) ? client.status : "active";
}

export function reservationStatus(reservation) {
  if (owns(RESERVATION_STATUSES, reservation?.status)) return reservation.status;
  return reservation?.done ? "done" : "scheduled";
}

// Calendar edits still use the legacy `done` field. Keep both representations in
// sync without losing a journal, attachments, or fields added by newer versions.
export function mergeReservation(previous = {}, patch = {}, now = Date.now()) {
  const merged = { ...previous, ...patch };
  let status;
  if (owns(patch, "status")) status = reservationStatus(merged);
  else if (owns(patch, "done")) status = patch.done ? "done" : "scheduled";
  else status = reservationStatus(merged);
  return { ...merged, status, done: status === "done", updatedAt: now };
}

// Previously saved time slots may predate validation. A completion or memo edit
// should not force users to repair them; scheduling changes still need checks.
export function reservationScheduleChanged(previous, next) {
  if (!previous) return true;
  const scheduleFields = ["clientId", "type", "date", "start", "end"];
  if (scheduleFields.some((field) => (previous[field] ?? "") !== (next?.[field] ?? ""))) return true;
  return !isActive(previous) && isActive(next);
}

function timeMinutes(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function addMinutes(time, minutes) {
  const start = timeMinutes(time);
  if (start === null || !Number.isInteger(minutes)) return "";
  const total = start + minutes;
  if (total < 0 || total >= 24 * 60) return "";
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function findReservationConflicts(candidate, list = []) {
  if (!candidate || !isActive(candidate) || !validDate(candidate.date)) return [];
  const start = timeMinutes(candidate.start);
  const end = timeMinutes(candidate.end);
  if (start === null || end === null || end <= start) return [];
  return list.filter((other) => {
    if (!other || other === candidate || (candidate.id && candidate.id === other.id)) return false;
    if (other.date !== candidate.date || !isActive(other)) return false;
    const otherStart = timeMinutes(other.start);
    const otherEnd = timeMinutes(other.end);
    return otherStart !== null && otherEnd !== null && otherEnd > otherStart
      && start < otherEnd && end > otherStart;
  });
}

export function validateReservation(candidate, clients = [], list = []) {
  if (!candidate?.clientId || !clients.some((client) => client.id === candidate.clientId)) {
    return "내담자를 선택해 주세요.";
  }
  if (typeof candidate.type !== "string" || !candidate.type.trim()) return "상담 유형을 선택해 주세요.";
  if (!validDate(candidate.date)) return "올바른 예약 날짜를 선택해 주세요.";
  const startEmpty = candidate.start == null || candidate.start === "";
  const endEmpty = candidate.end == null || candidate.end === "";
  if (startEmpty && endEmpty) return "";
  if (startEmpty || endEmpty) return "시작 시간과 종료 시간을 모두 입력해 주세요.";
  const start = timeMinutes(candidate.start);
  const end = timeMinutes(candidate.end);
  if (start === null || end === null) return "올바른 시간을 입력해 주세요 (00:00~23:59).";
  if (end <= start) return "종료 시간은 시작 시간보다 늦어야 합니다.";
  const conflict = findReservationConflicts(candidate, list)[0];
  if (conflict) return `같은 시간대에 예약이 있습니다 (${conflict.date} ${conflict.start}–${conflict.end}). 다른 시간을 선택해 주세요.`;
  return "";
}

export function sessionNumber(reservation, list = []) {
  if (!reservation?.clientId || !isActive(reservation)) return null;
  const track = list.filter((other) => other && other.clientId === reservation.clientId
    && other.type === reservation.type && isActive(other));
  const same = (other) => other === reservation || (reservation.id && other.id === reservation.id);
  const existing = track.findIndex(same);
  if (existing === -1) track.push(reservation);
  else track[existing] = reservation;
  track.sort((a, b) => {
    const date = String(a.date || "").localeCompare(String(b.date || ""));
    const start = String(a.start || "").localeCompare(String(b.start || ""));
    return date || start || String(a.id || "").localeCompare(String(b.id || ""));
  });
  return track.findIndex(same) + 1;
}
