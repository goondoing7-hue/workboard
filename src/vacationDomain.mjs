/* 휴가 장부 — 월차와 대체휴가를 각각 적립(+)과 사용(−)으로 기록하고 잔여를 셉니다.
   기록 하나는 { id, type, mode, date, note, days, used } 입니다.
   - type : "월차" | "대체휴가"
   - mode : "적립"(+, 부여·발생) | "사용"(−, 쓰기로 한 날)
   - used : 사용 기록이 실제로 소진되었는지. 적립 기록에는 뜻이 없습니다. */

export const VACATION_TYPES = ["월차", "대체휴가"];
export const VACATION_MODES = ["적립", "사용"];

const round2 = (n) => Math.round(n * 100) / 100;

export const normalizeVacation = (r = {}) => {
  const mode = r.mode === "적립" ? "적립" : "사용";
  const days = Number(r.days);
  return {
    id: r.id || "",
    type: VACATION_TYPES.includes(r.type) ? r.type : VACATION_TYPES[0],
    mode,
    date: typeof r.date === "string" ? r.date.slice(0, 10) : "",
    note: typeof r.note === "string" ? r.note : "",
    days: Number.isFinite(days) ? Math.max(0, round2(days)) : 0,
    used: mode === "적립" ? false : !!r.used,
    createdAt: Number(r.createdAt) || 0,
  };
};

export const vacationError = (r) => {
  const v = normalizeVacation(r);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return "날짜를 선택해 주세요.";
  const parsed = new Date(v.date + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return "날짜를 확인해 주세요.";
  if (!(v.days > 0)) return "일수를 0보다 크게 적어 주세요.";
  if (v.days > 365) return "일수를 확인해 주세요.";
  return "";
};

export const vacationYear = (r) => String(r?.date || "").slice(0, 4);

/* 한 종류의 합계. 잔여 = 적립 − (사용완료 + 사용예정).
   쓰기로 정해 둔 날은 아직 다녀오지 않았어도 이미 묶인 몫이라 잔여에서 뺍니다. */
export const vacationSummary = (list = [], type, year = "") => {
  const rows = list
    .map(normalizeVacation)
    .filter((r) => r.type === type)
    .filter((r) => !year || vacationYear(r) === year);
  const sum = (test) => round2(rows.filter(test).reduce((a, r) => a + r.days, 0));
  const granted = sum((r) => r.mode === "적립");
  const used = sum((r) => r.mode === "사용" && r.used);
  const planned = sum((r) => r.mode === "사용" && !r.used);
  return { granted, used, planned, spent: round2(used + planned), left: round2(granted - used - planned), count: rows.length };
};

/* 최근 날짜가 위로. 같은 날이면 나중에 적은 것이 위로 */
export const sortVacations = (list = []) =>
  [...list].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

export const vacationYears = (list = []) =>
  [...new Set(list.map(vacationYear).filter(Boolean))].sort().reverse();

/* 1 → "1", 0.5 → "0.5" */
export const formatDays = (n) => {
  const v = round2(Number(n) || 0);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(2)));
};

export const toggleVacationUsed = (list = [], id) =>
  list.map((r) => (r.id === id && normalizeVacation(r).mode === "사용" ? { ...r, used: !r.used } : r));
