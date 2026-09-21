/** Public feed first; an unavailable public feed can use an existing server
 * session for this same calendar. This helper never starts authorization. */
export async function readGoogleCalendar({ calendarId, from, to, signal,
  fetchImpl = (...args) => globalThis.fetch(...args), authenticatedRead }) {
  const params = new URLSearchParams({ calendarId, from, to });
  const response = await fetchImpl(`/api/google-calendar?${params}`, { signal, cache: "no-store" });
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("이 실행 환경에서는 캘린더 연결을 지원하지 않습니다. 업무보드 서버로 열어 주세요.");
  }
  const payload = await response.json();
  if (response.ok) return payload;
  const failure = new Error(typeof payload.error === "string" ? payload.error : "구글 캘린더를 불러오지 못했습니다.");
  if ([403, 404].includes(response.status) && authenticatedRead) {
    try {
      const fallback = await authenticatedRead(from, to, { signal, calendarId });
      if (fallback?.calendarId !== calendarId || fallback.from !== from || fallback.to !== to) throw failure;
      return fallback;
    } catch (error) {
      if (signal?.aborted || error?.code === "cancelled" || error?.name === "AbortError") throw error;
      // An absent/revoked cookie must keep the original public-feed failure;
      // neither a failed fallback nor a partial list may replace reservations.
    }
  }
  throw failure;
}
