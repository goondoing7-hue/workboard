/* 휴가 장부 — 월차와 대체휴가를 각각 적립(+)과 사용(−)으로 기록하고 잔여를 셉니다.
   기록 하나는 { id, type, mode, date, note, minutes, used } 입니다.
   - type    : "월차" | "대체휴가"
   - mode    : "적립"(+, 부여·발생) | "사용"(−, 쓰기로 한 날)
   - minutes : 30분 단위의 분. 1일은 8시간(480분)으로 셉니다.
   - used    : 사용 기록이 실제로 소진되었는지. 적립 기록에는 뜻이 없습니다.

   예전 기록은 일 단위 실수(days)로 저장되어 있습니다. 읽을 때 분으로 바꿔
   주므로 예전 기기에서 넘어온 자료도 그대로 셉니다. */

export const VACATION_TYPES = ["월차", "대체휴가"];
export const VACATION_MODES = ["적립", "사용"];

export const MINUTES_PER_DAY = 480;   /* 하루 8시간 근무 */
export const STEP_MINUTES = 30;

/* 30분 단위로 맞춥니다 */
export const snapMinutes = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v / STEP_MINUTES) * STEP_MINUTES;
};

/* 예전 days 기록과 새 minutes 기록을 함께 읽습니다 */
export const minutesOf = (r = {}) => {
  if (r.minutes !== undefined && r.minutes !== null && Number.isFinite(Number(r.minutes))) {
    return Math.max(0, Math.round(Number(r.minutes)));
  }
  const days = Number(r.days);
  return Number.isFinite(days) ? Math.max(0, Math.round(days * MINUTES_PER_DAY)) : 0;
};

export const normalizeVacation = (r = {}) => {
  const mode = r.mode === "적립" ? "적립" : "사용";
  return {
    id: r.id || "",
    type: VACATION_TYPES.includes(r.type) ? r.type : VACATION_TYPES[0],
    mode,
    date: typeof r.date === "string" ? r.date.slice(0, 10) : "",
    note: typeof r.note === "string" ? r.note : "",
    minutes: minutesOf(r),
    used: mode === "적립" ? false : !!r.used,
    createdAt: Number(r.createdAt) || 0,
  };
};

export const vacationError = (r) => {
  const v = normalizeVacation(r);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return "날짜를 선택해 주세요.";
  if (Number.isNaN(new Date(v.date + "T00:00:00").getTime())) return "날짜를 확인해 주세요.";
  if (v.minutes <= 0) return "시간을 30분 이상으로 골라 주세요.";
  if (v.minutes % STEP_MINUTES !== 0) return "시간은 30분 단위로 고를 수 있습니다.";
  if (v.minutes > MINUTES_PER_DAY * 365) return "시간을 확인해 주세요.";
  return "";
};

export const vacationYear = (r) => String(r?.date || "").slice(0, 4);

/* 한 종류의 합계(분). 잔여 = 적립 − (사용완료 + 사용예정).
   쓰기로 정해 둔 날은 아직 다녀오지 않았어도 이미 묶인 몫이라 잔여에서 뺍니다. */
export const vacationSummary = (list = [], type, year = "") => {
  const rows = list
    .map(normalizeVacation)
    .filter((r) => r.type === type)
    .filter((r) => !year || vacationYear(r) === year);
  const sum = (test) => rows.filter(test).reduce((a, r) => a + r.minutes, 0);
  const granted = sum((r) => r.mode === "적립");
  const used = sum((r) => r.mode === "사용" && r.used);
  const planned = sum((r) => r.mode === "사용" && !r.used);
  return { granted, used, planned, spent: used + planned, left: granted - used - planned, count: rows.length };
};

/* 월차와 대체휴가를 합친 잔여 */
export const vacationTotal = (list = [], year = "") => {
  const parts = VACATION_TYPES.map((t) => vacationSummary(list, t, year));
  const add = (key) => parts.reduce((a, s) => a + s[key], 0);
  return { granted: add("granted"), used: add("used"), planned: add("planned"), spent: add("spent"), left: add("left") };
};

export const sortVacations = (list = []) =>
  [...list].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

export const vacationYears = (list = []) =>
  [...new Set(list.map(vacationYear).filter(Boolean))].sort().reverse();

/* 480 → "1일", 510 → "1일 30분", 210 → "3시간 30분", 30 → "30분" */
export const formatDuration = (min) => {
  const total = Math.round(Number(min) || 0);
  if (total === 0) return "0분";
  const sign = total < 0 ? "−" : "";
  const abs = Math.abs(total);
  const d = Math.floor(abs / MINUTES_PER_DAY);
  const h = Math.floor((abs % MINUTES_PER_DAY) / 60);
  const m = abs % 60;
  const parts = [];
  if (d) parts.push(d + "일");
  if (h) parts.push(h + "시간");
  if (m) parts.push(m + "분");
  return sign + parts.join(" ");
};

/* 총 잔여를 시간으로만 보고 싶을 때 — 90 → "1.5시간" */
export const formatHours = (min) => {
  const total = Math.round(Number(min) || 0);
  const hours = total / 60;
  return (Number.isInteger(hours) ? String(hours) : hours.toFixed(1)) + "시간";
};

/* 고르개용 — 일과 시·분을 나눠 다룹니다 */
export const splitDuration = (min) => {
  const abs = Math.max(0, Math.round(Number(min) || 0));
  return { days: Math.floor(abs / MINUTES_PER_DAY), rest: abs % MINUTES_PER_DAY };
};
export const joinDuration = (days, rest) =>
  Math.max(0, Math.round(Number(days) || 0)) * MINUTES_PER_DAY + Math.max(0, Math.round(Number(rest) || 0));

/* 0, 30, 60 … 450 (7시간 30분) */
export const REST_STEPS = Array.from({ length: MINUTES_PER_DAY / STEP_MINUTES }, (_, i) => i * STEP_MINUTES);
export const DAY_STEPS = Array.from({ length: 31 }, (_, i) => i);

export const toggleVacationUsed = (list = [], id) =>
  list.map((r) => (r.id === id && normalizeVacation(r).mode === "사용" ? { ...r, used: !r.used } : r));
