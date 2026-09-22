const DAY = 86400000;

function dateDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY : null;
}

function allDayRange(event) {
  if (!event || (event.allDay !== true && event.start)) return null;
  const start = dateDay(event.date);
  if (start === null) return null;
  // Google and local center schedules store the day AFTER the last day.
  // Older date-only tasks have no endDate and occupy just their own day.
  let end = event.endDate == null || event.endDate === "" ? start + 1 : dateDay(event.endDate);
  // Before explicit allDay metadata existed, local untimed events could store
  // their own date as endDate. Keep these legacy rows visible for one day.
  if (event.allDay !== true && end === start) end = start + 1;
  return end !== null && end > start ? { start, end } : null;
}

/** Whether an untimed schedule covers at least two calendar days. */
export function isAllDaySpan(event) {
  const range = allDayRange(event);
  return !!range && range.end - range.start > 1;
}

/**
 * Get the schedules visible on a day using the same all-day convention as
 * the spanning bars. Timed ranges are clipped for the time grid while their
 * original record is retained for opening the editor.
 */
export function calendarEventsOnDay(events, iso) {
  const day = dateDay(iso);
  if (!Array.isArray(events) || day === null) return [];
  return events.flatMap((event) => {
    if (!event) return [];
    if (event.allDay === true || !event.start) {
      const range = allDayRange(event);
      if (!range || day < range.start || day >= range.end) return [];
      const span = range.end - range.start > 1;
      if (event.allDay === true) return [{ ...event, start: "", end: "", noDrag: !!event.noDrag || span }];
      return [span ? { ...event, noDrag: true } : event];
    }
    const first = dateDay(event.date);
    const last = event.endDate == null || event.endDate === "" ? first : dateDay(event.endDate);
    if (first === null || last === null || last < first || day < first || day > last) return [];
    // Midnight ends exactly at the boundary and does not occupy the final day.
    if (day > first && day === last && (!event.end || event.end === "00:00")) return [];
    if (last === first) return [event];
    return [{ ...event, original: event.original || event, noDrag: true, date: iso,
      start: day > first ? "00:00" : event.start, end: day < last ? "23:59" : event.end }];
  });
}

/**
 * Lay out untimed schedules in one contiguous date window, normally a week.
 * Columns are zero-based; endCol, like event.endDate, is exclusive.
 * Missing endDate or a legacy untimed same-day endDate means one day.
 * Invalid dates/ranges are never normalized into a different day.
 * Event objects are returned by reference, unchanged.
 */
export function layoutAllDayEvents(events, dayDates) {
  const empty = { segments: [], laneCount: 0 };
  if (!Array.isArray(events) || !Array.isArray(dayDates) || !dayDates.length) return empty;
  const days = dayDates.map(dateDay);
  if (days.some((day, index) => day === null || (index > 0 && day !== days[index - 1] + 1))) return empty;
  const first = days[0], afterLast = days.at(-1) + 1;
  const visible = events.flatMap((event, index) => {
    const range = allDayRange(event);
    if (!range || range.end <= first || range.start >= afterLast) return [];
    return [{ event, index, range, startCol: Math.max(range.start, first) - first, endCol: Math.min(range.end, afterLast) - first }];
  }).sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol ||
    String(a.event.id || "").localeCompare(String(b.event.id || "")) || a.index - b.index);
  const laneEnds = [];
  const segments = visible.map(({ event, range, startCol, endCol }) => {
    let lane = laneEnds.findIndex((end) => end <= startCol);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = endCol;
    return { event, startCol, endCol, lane, continuesBefore: range.start < first, continuesAfter: range.end > afterLast };
  });
  return { segments, laneCount: laneEnds.length };
}
