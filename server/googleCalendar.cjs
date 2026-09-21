"use strict";

const ICAL = require("ical.js");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const DISPLAY_ZONE = "Asia/Seoul";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 5000;
const MAX_COMPONENTS = 15000;
const MAX_RESULT_BYTES = 3 * 1024 * 1024;
const MAX_ITERATIONS = 100000;
const FETCH_TIMEOUT_MS = 12000;
const RESPONSE_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
});

class CalendarError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new CalendarError(status, message); };
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !value.startsWith("0000") && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function queryValue(query, key) {
  if (query instanceof URLSearchParams) {
    if (query.getAll(key).length !== 1) return undefined;
    return query.get(key);
  }
  return typeof query?.[key] === "string" ? query[key] : undefined;
}
function validateQuery(query) {
  const rawId = queryValue(query, "calendarId");
  const calendarId = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9._+-]{0,180}@(gmail\.com|group\.calendar\.google\.com)$/.test(calendarId)) {
    fail(400, "Gmail 또는 Google 그룹 캘린더의 올바른 캘린더 ID를 입력해 주세요.");
  }
  const from = queryValue(query, "from"), to = queryValue(query, "to");
  if (!validDate(from) || !validDate(to) || to <= from) fail(400, "조회 시작일과 종료일을 확인해 주세요.");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 1096) fail(400, "조회 기간은 최대 3년으로 설정해 주세요.");
  return { calendarId, from, to };
}

const numberParts = (formatter, milliseconds) => Object.fromEntries(formatter.formatToParts(new Date(milliseconds))
  .filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
const fieldsUTC = (time) => {
  const date = new Date(0);
  date.setUTCFullYear(time.year, time.month - 1, time.day);
  date.setUTCHours(time.hour || 0, time.minute || 0, time.second || 0, 0);
  return date.getTime();
};
function intlZone(tzid) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat("en-GB", { timeZone: tzid, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  catch { fail(502, "캘린더에 알 수 없는 시간대가 있어 가져오지 않았습니다."); }
  const offsetAt = (unixMs) => (fieldsUTC(numberParts(formatter, unixMs)) - unixMs) / 1000;
  const zone = new ICAL.Timezone({ tzid });
  const candidatesFor = (time) => {
    const localMs = fieldsUTC(time);
    const offsets = [...new Set([-172800000, -86400000, 0, 86400000, 172800000].map((shift) => offsetAt(localMs + shift)))];
    const candidates = offsets.map((offset) => ({ offset, unixMs: localMs - offset * 1000 }));
    const exact = candidates.filter(({ unixMs }) => fieldsUTC(numberParts(formatter, unixMs)) === localMs).sort((a, b) => a.unixMs - b.unixMs);
    return { exact, candidates };
  };
  zone.hasWallTime = (time) => candidatesFor(time).exact.length > 0;
  zone.utcOffset = (time) => {
    const { exact, candidates } = candidatesFor(time);
    // RFC 5545: use the first occurrence in a fold, and the pre-gap offset for
    // a wall-clock time that does not exist during a spring-forward transition.
    return (exact[0] || candidates.sort((a, b) => b.unixMs - a.unixMs)[0]).offset;
  };
  return zone;
}
function missingWallTime(time) {
  if (time.isDate || time.zone === ICAL.Timezone.utcTimezone) return false;
  if (time.zone.hasWallTime) return !time.zone.hasWallTime(time);
  // VTIMEZONE transitions are calendar-local UTC instants with old/new
  // offsets. A forward jump leaves this wall-clock interval nonexistent.
  time.zone.utcOffset(time);
  const wall = fieldsUTC(time);
  return (time.zone.changes || []).some((change) => change.utcOffset > change.prevUtcOffset
    && wall >= fieldsUTC(change) + change.prevUtcOffset * 1000
    && wall < fieldsUTC(change) + change.utcOffset * 1000);
}

function checkEnvelope(text) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
  if (Buffer.byteLength(cleaned) > MAX_BYTES) fail(502, "캘린더 파일이 너무 커서 가져오지 않았습니다.");
  const lines = cleaned.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  if (lines[0]?.toUpperCase() !== "BEGIN:VCALENDAR" || lines.at(-1)?.toUpperCase() !== "END:VCALENDAR") fail(502, "올바른 공개 캘린더 파일이 아닙니다.");
  const stack = [];
  let roots = 0;
  for (const line of lines) {
    const match = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
    if (!match) continue;
    const component = match[2].toUpperCase();
    if (match[1].toUpperCase() === "BEGIN") {
      if (!stack.length) roots++;
      stack.push(component);
      if (stack.length > 12) fail(502, "캘린더 구조가 올바르지 않습니다.");
    } else if (stack.pop() !== component) fail(502, "캘린더 파일이 잘려 있어 가져오지 않았습니다.");
  }
  if (stack.length || roots !== 1) fail(502, "캘린더 파일이 완전하지 않습니다.");
  return cleaned;
}
function validRawTime(raw, isDate) {
  if (typeof raw !== "string") return false;
  if (isDate) return validDate(raw);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(raw) && validDate(raw.slice(0, 10))
    && Number(raw.slice(11, 13)) < 24 && Number(raw.slice(14, 16)) < 60 && Number(raw.slice(17, 19)) < 60;
}

function parseCalendarFeed(text, query, options = {}) {
  const range = validateQuery(query);
  const startedAt = Date.now();
  const maxEvents = options.maxEvents || MAX_EVENTS;
  const maxIterations = options.maxIterations || MAX_ITERATIONS;
  try {
    const calendar = new ICAL.Component(ICAL.parse(checkEnvelope(text)));
    if (calendar.name !== "vcalendar" || calendar.getFirstPropertyValue("version") !== "2.0") fail(502, "지원하지 않는 캘린더 형식입니다.");
    const components = calendar.getAllSubcomponents("vevent");
    if (components.length > MAX_COMPONENTS) fail(502, "캘린더 일정이 너무 많아 가져오지 않았습니다.");
    const timezoneIds = new Set();
    for (const timezone of calendar.getAllSubcomponents("vtimezone")) {
      const tzid = timezone.getFirstPropertyValue("tzid");
      const rules = timezone.getAllSubcomponents().filter((part) => ["standard", "daylight"].includes(part.name));
      if (!tzid || timezoneIds.has(tzid) || !rules.length) fail(502, "캘린더 시간대 정의가 올바르지 않습니다.");
      timezoneIds.add(tzid);
      for (const rule of rules) {
        if (!validRawTime(rule.getFirstProperty("dtstart")?.toJSON()[3], false)) fail(502, "캘린더 시간대 시작일이 올바르지 않습니다.");
        for (const key of ["tzoffsetfrom", "tzoffsetto"]) {
          const raw = rule.getFirstProperty(key)?.toJSON()[3];
          if (typeof raw !== "string" || !/^[+-]\d{2}:\d{2}(?::\d{2})?$/.test(raw)
            || Number(raw.slice(1, 3)) > 23 || Number(raw.slice(4, 6)) > 59 || Number(raw.slice(7, 9) || 0) > 59) fail(502, "캘린더 시간대 시차가 올바르지 않습니다.");
        }
      }
    }
    const defaultZoneId = calendar.getFirstPropertyValue("x-wr-timezone") || DISPLAY_ZONE;
    const zones = new Map();
    const zoneFor = (tzid) => {
      if (["UTC", "Etc/UTC", "GMT", "Z"].includes(tzid)) return ICAL.Timezone.utcTimezone;
      if (!zones.has(tzid)) zones.set(tzid, calendar.getTimeZoneByID(tzid) || intlZone(tzid));
      return zones.get(tzid);
    };
    // Resolve time zones on this calendar tree only. No global TimezoneService
    // registration: concurrent calendars can define the same TZID differently.
    for (const component of components) {
      if (component.hasProperty("exrule")) fail(502, "지원하지 않는 제외 반복 규칙이 있어 가져오지 않았습니다.");
      for (const key of ["uid", "dtstart", "dtend", "recurrence-id", "duration"]) {
        if (component.getAllProperties(key).length > 1) fail(502, "중복된 일정 필드가 있어 가져오지 않았습니다.");
      }
      for (const name of ["dtstart", "dtend", "recurrence-id", "rdate", "exdate"]) {
        for (const property of component.getAllProperties(name)) {
          if (!["date", "date-time"].includes(property.type)) fail(502, "지원하지 않는 반복 날짜 형식이 있어 가져오지 않았습니다.");
          const rawValues = property.toJSON().slice(3);
          if (!rawValues.length || rawValues.some((raw) => !validRawTime(raw, property.type === "date"))) fail(502, "캘린더에 잘못된 날짜나 시간이 있어 가져오지 않았습니다.");
          const tzid = property.getParameter("tzid");
          for (const value of property.getValues()) {
            if (!value.isDate && value.zone !== ICAL.Timezone.utcTimezone) value.zone = zoneFor(tzid || defaultZoneId);
          }
        }
      }
      for (const property of component.getAllProperties("rrule")) {
        const rule = property.getFirstValue();
        if (!rule.freq || rule.interval < 1 || (rule.count != null && rule.count < 1)) fail(502, "잘못된 반복 규칙이 있어 가져오지 않았습니다.");
      }
    }
    const groups = new Map();
    for (const component of components) {
      const uid = component.getFirstPropertyValue("uid");
      if (typeof uid !== "string" || !uid.trim() || uid.length > 1024) fail(502, "일정 식별자가 올바르지 않아 가져오지 않았습니다.");
      if (!groups.has(uid)) groups.set(uid, []);
      groups.get(uid).push(component);
    }
    const fromMs = Date.parse(`${range.from}T00:00:00+09:00`), toMs = Date.parse(`${range.to}T00:00:00+09:00`);
    const displayFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const stamp = (time) => time.isDate ? Date.parse(`${time.toString()}T00:00:00+09:00`) : time.toUnixTime() * 1000;
    const dateAndTime = (time) => {
      if (time.isDate) return { date: time.toString(), time: "" };
      const p = numberParts(displayFormatter, stamp(time));
      return { date: `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` };
    };
    const recurrenceKey = (time) => time.isDate ? `D:${time.toString()}` : `T:${new Date(stamp(time)).toISOString()}`;
    const idOf = (uid, recurrence) => `${encodeURIComponent(uid)}::${recurrence ? recurrenceKey(recurrence) : "single"}`;
    const rows = new Map();
    const rowBytes = new Map();
    let resultBytes = 0;
    const validateEvent = (event) => {
      const start = event.startDate, end = event.endDate;
      if (!start || !end || start.isDate !== end.isDate || !Number.isFinite(stamp(start)) || !Number.isFinite(stamp(end)) || stamp(end) < stamp(start)) fail(502, "일정 시작·종료 시간이 올바르지 않아 가져오지 않았습니다.");
    };
    const add = (uid, detail, recurrence = null) => {
      const { startDate: start, endDate: end, item } = detail;
      if (!start || !end) fail(502, "일정의 날짜가 누락되어 가져오지 않았습니다.");
      const begin = stamp(start), finish = stamp(end);
      if (!Number.isFinite(begin) || !Number.isFinite(finish) || finish < begin) fail(502, "반복 일정의 시간이 올바르지 않습니다.");
      if (begin >= toMs || (finish === begin ? begin < fromMs : finish <= fromMs)) return;
      const a = dateAndTime(start), b = dateAndTime(end);
      const row = { id: idOf(uid, recurrence), title: String(item.summary || "제목 없는 일정"), date: a.date, endDate: b.date,
        start: a.time, end: b.time, place: String(item.location || ""), allDay: !!start.isDate,
        cancelled: String(item.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED" };
      const bytes = Buffer.byteLength(JSON.stringify(row));
      resultBytes += bytes - (rowBytes.get(row.id) || 0);
      if (resultBytes > MAX_RESULT_BYTES) fail(502, "일정 내용이 너무 많습니다. 조회 기간을 줄여 주세요.");
      rowBytes.set(row.id, bytes);
      rows.set(row.id, row);
      if (rows.size > maxEvents) fail(502, "조회한 일정이 너무 많습니다. 조회 기간을 줄여 주세요.");
    };
    let iterations = 0;
    for (const [uid, group] of groups) {
      const masters = group.filter((component) => !component.hasProperty("recurrence-id"));
      if (masters.length > 1) fail(502, "같은 식별자의 일정이 중복되어 가져오지 않았습니다.");
      const master = masters[0] ? new ICAL.Event(masters[0], { exceptions: [], strictExceptions: true }) : null;
      if (master) validateEvent(master);
      const exceptions = group.filter((component) => component.hasProperty("recurrence-id")).map((component) => {
        const exception = new ICAL.Event(component, { exceptions: [], strictExceptions: true });
        if (!exception.startDate && String(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") {
          exception.startDate = exception.recurrenceId.clone();
          if (master) exception.duration = master.duration.clone();
        }
        validateEvent(exception);
        return exception;
      });
      const exceptionByKey = new Map();
      let maxBackShift = 0;
      for (const exception of exceptions) {
        const key = recurrenceKey(exception.recurrenceId);
        if (exceptionByKey.has(key)) fail(502, "반복 일정의 예외가 중복되어 가져오지 않았습니다.");
        exceptionByKey.set(key, exception);
        if (master) master.relateException(exception);
        if (exception.modifiesFuture()) maxBackShift = Math.max(maxBackShift, stamp(exception.recurrenceId) - stamp(exception.startDate));
      }
      if (master && (master.isRecurring() || master.component.hasProperty("exdate"))) {
        // RecurExpansion does not add DTSTART for an RDATE-only recurrence.
        // Make it an explicit member of the recurrence set; EXDATE still wins.
        master.component.addPropertyWithValue("rdate", master.startDate.clone());
        const iterator = master.iterator();
        let occurrence;
        while ((occurrence = iterator.next())) {
          if (++iterations > maxIterations || Date.now() - startedAt > 5000) fail(502, "반복 일정이 너무 많아 전체 내용을 가져오지 못했습니다.");
          if (stamp(occurrence) >= toMs + maxBackShift + 86400000) break;
          // ical.js counts nonexistent DST wall times as occurrences. Dropping
          // one silently would also corrupt COUNT, so reject this feed intact.
          if (missingWallTime(occurrence)) fail(502, "해외 시간대의 서머타임 경계에 유효하지 않은 반복 시각이 있어 가져오지 않았습니다.");
          // ICAL matches local strings and UTC strings, but equivalent IDs in
          // two different TZIDs need the same canonical instant comparison.
          const exception = exceptionByKey.get(recurrenceKey(occurrence));
          add(uid, exception ? { item: exception, startDate: exception.startDate, endDate: exception.endDate }
            : master.getOccurrenceDetails(occurrence), occurrence);
        }
      } else if (master) add(uid, { item: master, startDate: master.startDate, endDate: master.endDate });
      // Moved exceptions can start inside this window even when their original
      // occurrence is outside it (or was also listed in EXDATE).
      for (const exception of exceptions) add(uid, { item: exception, startDate: exception.startDate, endDate: exception.endDate }, exception.recurrenceId);
    }
    return { ...range, name: String(calendar.getFirstPropertyValue("x-wr-calname") || "Google 캘린더"), timeZone: DISPLAY_ZONE,
      events: [...rows.values()].sort((a, b) => `${a.date}${a.start}${a.id}`.localeCompare(`${b.date}${b.start}${b.id}`)),
      fetchedAt: new Date(options.now ?? Date.now()).toISOString() };
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError(502, "캘린더를 완전히 해석하지 못해 가져오지 않았습니다. 기존 일정은 유지됩니다.");
  }
}

async function fetchCalendarText(calendarId, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`, {
      method: "GET", redirect: "error", signal: controller.signal, headers: { Accept: "text/calendar" }, cache: "no-store",
    });
    if (!response.ok) fail(response.status === 404 || response.status === 403 ? 404 : 502,
      response.status === 404 || response.status === 403 ? "공개 캘린더를 찾을 수 없습니다. 캘린더 ID와 공개 설정을 확인해 주세요." : "Google 캘린더에서 응답을 받지 못했습니다.");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) fail(502, "캘린더 파일이 너무 커서 가져오지 않았습니다.");
    if (!response.body?.getReader) fail(502, "캘린더 응답을 읽을 수 없습니다.");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { await reader.cancel(); fail(502, "캘린더 파일이 너무 커서 가져오지 않았습니다."); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { clearTimeout(timeout); }
}

async function publicCalendarResponse(query, options = {}) {
  try {
    const range = validateQuery(query);
    const text = await fetchCalendarText(range.calendarId, options.fetchImpl || fetch, options.timeoutMs || FETCH_TIMEOUT_MS);
    const body = await parseInWorker(text, range, options);
    return { status: 200, headers: { ...RESPONSE_HEADERS }, body };
  } catch (error) {
    const status = error instanceof CalendarError ? error.status : error?.name === "AbortError" ? 504 : 502;
    return { status, headers: { ...RESPONSE_HEADERS }, body: { error: error instanceof CalendarError ? error.message
      : status === 504 ? "캘린더 응답이 늦습니다. 잠시 후 다시 시도해 주세요." : "공개 캘린더를 가져오지 못했습니다. 기존 일정은 유지됩니다." } };
  }
}
function parseInWorker(text, range, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { kind: "parse-google-calendar", text, range,
      options: { now: options.now, maxEvents: options.maxEvents, maxIterations: options.maxIterations } } });
    const timer = setTimeout(() => { worker.terminate(); reject(new CalendarError(502, "복잡한 반복 일정을 제한 시간 안에 해석하지 못했습니다. 기존 일정은 유지됩니다.")); }, options.parseTimeoutMs || 6000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      worker.terminate();
      if (message.error) reject(new CalendarError(message.status || 502, message.error));
      else resolve(message.result);
    });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
    worker.once("exit", (code) => { if (code !== 0) { clearTimeout(timer); reject(new CalendarError(502, "캘린더 해석을 완료하지 못했습니다. 기존 일정은 유지됩니다.")); } });
  });
}
async function handler(req, res) {
  let result;
  if (req.method !== "GET") result = { status: 405, headers: { ...RESPONSE_HEADERS, Allow: "GET" }, body: { error: "GET 요청만 지원합니다." } };
  else result = await publicCalendarResponse(new URL(req.url, "http://localhost").searchParams);
  res.writeHead(result.status, result.headers);
  res.end(JSON.stringify(result.body));
}

module.exports = { handler, publicCalendarResponse, parseCalendarFeed, validateQuery, CalendarError, MAX_BYTES };

if (!isMainThread && workerData?.kind === "parse-google-calendar") {
  try { parentPort.postMessage({ result: parseCalendarFeed(workerData.text, workerData.range, workerData.options) }); }
  catch (error) { parentPort.postMessage({ error: error.message, status: error.status || 502 }); }
}
