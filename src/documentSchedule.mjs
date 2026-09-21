// Additive metadata: the original docs[name] boolean remains the completion flag.
export const localDocumentTime = (now = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDocumentTime(parsed).slice(0, 10) === value;
};
const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export const documentScheduleOf = (sub, name) => ({
  plannedDate: "", plannedTime: "", completedAt: "",
  ...(sub.docSchedule?.[name] || {}),
});

export const documentScheduleError = ({ plannedDate = "", plannedTime = "", completedAt = "" }) => {
  if (plannedDate && !validDate(plannedDate)) return "계획 날짜를 확인해 주세요.";
  if (plannedTime && !plannedDate) return "계획 시간을 정하려면 날짜를 먼저 선택해 주세요.";
  if (plannedTime && !validTime(plannedTime)) return "계획 시간을 확인해 주세요.";
  if (completedAt && (completedAt.length !== 16 || !validDate(completedAt.slice(0, 10)) || completedAt[10] !== "T" || !validTime(completedAt.slice(11)))) {
    return "완료 날짜와 시간을 모두 입력해 주세요.";
  }
  return "";
};

export const patchDocumentSchedule = (sub, name, patch) => {
  const schedule = { ...documentScheduleOf(sub, name), ...patch };
  const error = documentScheduleError(schedule);
  if (error) throw new Error(error);
  return { ...sub, docSchedule: { ...sub.docSchedule, [name]: schedule } };
};

export const toggleDocument = (sub, name, now = new Date()) => {
  const checked = !sub.docs?.[name];
  const next = { ...sub, docs: { ...sub.docs, [name]: checked } };
  // Keep a previous timestamp on undo; completing again records the new action.
  if (!checked) return next;
  return { ...next, docSchedule: { ...sub.docSchedule,
    [name]: { ...documentScheduleOf(sub, name), completedAt: localDocumentTime(now) } } };
};

export const formatDocumentTime = (date, time = "") => {
  if (!date) return "";
  const [year, month, day] = date.slice(0, 10).split("-");
  return `${year.slice(2)}.${month}.${day}${time ? ` ${time}` : ""}`;
};
