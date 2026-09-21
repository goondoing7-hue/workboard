// Calendar authorization is intentionally separate from Drive authorization.
// Access tokens live only in this module's memory; never persist them in board data.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const GIS_SRC = "https://accounts.google.com/gsi/client";

export class CalendarAuthError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message); this.name = "CalendarAuthError"; this.code = code; this.status = status; this.retryable = retryable;
  }
}
const authError = (code, message, details) => new CalendarAuthError(code, message, details);
export function validCalendarClientId(value) {
  return typeof value === "string" && /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.trim());
}
function oauthError(response) {
  const code = response?.error || response?.type || "oauth_error";
  const messages = {
    access_denied: "Google 캘린더 권한 연결을 승인하지 않았습니다. 연결하려면 버튼을 다시 눌러 주세요.",
    popup_closed: "Google 연결 창을 닫았습니다. 연결하려면 버튼을 다시 눌러 주세요.",
    popup_failed_to_open: "Google 연결 창을 열지 못했습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.",
    invalid_client: "Google OAuth 클라이언트 설정을 확인해 주세요. 웹 애플리케이션용 클라이언트 ID가 필요합니다.",
    unauthorized_client: "이 Google OAuth 클라이언트로 연결할 수 없습니다. Google Cloud의 OAuth 설정을 확인해 주세요.",
    origin_mismatch: "현재 사이트 주소가 OAuth 설정과 맞지 않습니다. Google Cloud의 승인된 JavaScript 원본을 확인해 주세요.",
    invalid_origin: "현재 사이트 주소가 OAuth 설정과 맞지 않습니다. Google Cloud의 승인된 JavaScript 원본을 확인해 주세요.",
    invalid_scope: "Google 캘린더 권한 요청 설정을 확인해 주세요.",
  };
  return authError(code, messages[code] || "Google 권한 연결을 완료하지 못했습니다. 다시 연결하고, 계속 실패하면 OAuth 설정을 확인해 주세요.");
}

// Dependencies keep the auth/session races testable without credentials or a popup.
export function createCalendarAuth({
  getGoogle = () => globalThis.google,
  getDocument = () => globalThis.document,
  getUserActivation = () => globalThis.navigator?.userActivation,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  setTimer = (...args) => setTimeout(...args),
  clearTimer = (...args) => clearTimeout(...args),
  scriptTimeoutMs = 12000,
  requestTimeoutMs = 120000,
  apiTimeoutMs = 20000,
} = {}) {
  let accessToken = "", usableUntil = 0, expiresAt = 0, clientId = "";
  let status = "disconnected", error = "", epoch = 0, expiryTimer = null, pending = null, scriptPromise = null;
  const listeners = new Set(), requests = new Set();
  const googleOAuth = () => getGoogle()?.accounts?.oauth2;
  const snapshot = () => ({ status, connected: !!accessToken, connecting: status === "connecting", clientId, expiresAt, error, scope: CALENDAR_SCOPE });
  const emit = () => { const value = snapshot(); for (const listener of listeners) { try { listener(value); } catch { /* UI listeners cannot break authorization. */ } } };
  const clearCredentials = () => {
    accessToken = ""; usableUntil = 0; expiresAt = 0;
    clearTimer(expiryTimer); expiryTimer = null;
    for (const controller of requests) controller.abort();
  };
  const reset = (nextStatus, message = "") => {
    epoch++; clearCredentials();
    if (pending) { const previous = pending; pending = null; clearTimer(previous.timer); previous.reject(authError("cancelled", "Google 캘린더 연결을 취소했습니다.")); }
    status = nextStatus; error = message; emit();
  };
  const expireIfNeeded = () => {
    if (accessToken && now() >= usableUntil) reset("expired", "Google 캘린더 권한이 만료되었습니다. 연결 버튼을 다시 눌러 주세요.");
  };
  const calendarToken = () => { expireIfNeeded(); return accessToken; };
  const getCalendarAuthStatus = () => { expireIfNeeded(); return snapshot(); };
  const subscribeCalendarAuth = (listener) => { listeners.add(listener); listener(getCalendarAuthStatus()); return () => listeners.delete(listener); };
  const forgetCalendarAccess = () => { clientId = ""; reset("disconnected"); };

  // Safe to call when the settings panel opens. This loads GIS but never asks
  // for a token and never opens an account/consent window.
  function prepareCalendarAccess() {
    if (googleOAuth()?.initTokenClient) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    const doc = getDocument();
    if (!doc?.createElement || !doc?.head) return Promise.reject(authError("browser_required", "Google 연결은 브라우저에서 사용할 수 있습니다."));
    const loading = new Promise((resolve, reject) => {
      let script = doc.querySelector?.(`script[src="${GIS_SRC}"]`);
      const created = !script;
      if (!script) { script = doc.createElement("script"); script.src = GIS_SRC; script.async = true; script.defer = true; }
      let timer;
      const cleanup = () => { clearTimer(timer); script.removeEventListener("load", loaded); script.removeEventListener("error", failed); };
      const loaded = () => { cleanup(); if (googleOAuth()?.initTokenClient) resolve(); else { script.remove?.(); reject(authError("library_load_failed", "Google 연결 도구를 불러오지 못했습니다. 다시 시도해 주세요.")); } };
      const failed = () => { cleanup(); script.remove?.(); reject(authError("library_load_failed", "Google 연결 도구를 불러오지 못했습니다. 네트워크 연결을 확인하고 다시 시도해 주세요.")); };
      script.addEventListener("load", loaded, { once: true });
      script.addEventListener("error", failed, { once: true });
      timer = setTimer(failed, scriptTimeoutMs);
      if (created) doc.head.appendChild(script);
    });
    scriptPromise = loading.catch((failure) => { scriptPromise = null; throw failure; });
    return scriptPromise;
  }

  // Call directly from a user click. There is deliberately no silent refresh,
  // no delayed popup after script loading, and no automatic retry.
  function requestCalendarAccess(inputClientId) {
    const requestedId = typeof inputClientId === "string" ? inputClientId.trim() : "";
    if (!validCalendarClientId(requestedId)) return Promise.reject(authError("invalid_client_id", "Google Cloud에서 발급한 웹 애플리케이션용 OAuth 클라이언트 ID를 입력해 주세요."));
    if (pending && clientId === requestedId) return pending.promise;
    const oauth = googleOAuth();
    if (!oauth?.initTokenClient) {
      const currentEpoch = epoch;
      prepareCalendarAccess().catch((failure) => { if (epoch === currentEpoch) { error = failure.message; status = "error"; emit(); } });
      return Promise.reject(authError("library_loading", "Google 연결을 준비하고 있습니다. 잠시 후 연결 버튼을 다시 눌러 주세요."));
    }
    if (getUserActivation()?.isActive === false) return Promise.reject(authError("user_gesture_required", "Google 연결 버튼을 직접 눌러 권한을 연결해 주세요."));
    reset("disconnected");
    clientId = requestedId; status = "connecting"; error = "";
    const requestEpoch = epoch;
    let resolvePromise, rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const request = { promise, resolve: resolvePromise, reject: rejectPromise, timer: null };
    pending = request;
    const settle = (failure, response) => {
      if (pending !== request || epoch !== requestEpoch) return;
      clearTimer(request.timer); pending = null;
      if (failure) { clearCredentials(); status = "error"; error = failure.message; emit(); request.reject(failure); return; }
      const lifetime = Number(response.expires_in) * 1000;
      accessToken = response.access_token;
      expiresAt = now() + lifetime;
      usableUntil = expiresAt - Math.min(30000, lifetime / 10);
      status = "connected"; error = "";
      expiryTimer = setTimer(expireIfNeeded, Math.max(1, usableUntil - now()));
      emit(); request.resolve(snapshot());
    };
    request.timer = setTimer(() => settle(authError("authorization_timeout", "Google 연결 응답을 기다리는 시간이 지났습니다. 연결 버튼을 다시 눌러 주세요.")), requestTimeoutMs);
    emit();
    try {
      const tokenClient = oauth.initTokenClient({
        client_id: requestedId, scope: CALENDAR_SCOPE, include_granted_scopes: false, prompt: "select_account",
        callback: (response) => {
          if (response?.error) { settle(oauthError(response)); return; }
          const granted = new Set(String(response?.scope || "").split(/\s+/).filter(Boolean));
          let hasScope = granted.has(CALENDAR_SCOPE);
          try { if (oauth.hasGrantedAllScopes) hasScope = hasScope && oauth.hasGrantedAllScopes(response, CALENDAR_SCOPE); }
          catch { hasScope = false; }
          if (!hasScope) { settle(authError("scope_not_granted", "소유한 캘린더의 일정 권한이 승인되지 않았습니다. 다시 연결해 해당 권한을 허용해 주세요.")); return; }
          if (typeof response?.access_token !== "string" || !response.access_token || /\s/.test(response.access_token)
            || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 0
            || Number(response.expires_in) > 2147483
            || (response.token_type != null && (typeof response.token_type !== "string" || response.token_type.toLowerCase() !== "bearer"))) {
            settle(authError("invalid_token_response", "Google에서 올바른 권한 정보를 받지 못했습니다. 다시 연결해 주세요.")); return;
          }
          settle(null, response);
        },
        error_callback: (failure) => settle(oauthError(failure)),
      });
      tokenClient.requestAccessToken({ prompt: "select_account", include_granted_scopes: false, scope: CALENDAR_SCOPE });
    } catch { settle(authError("authorization_start_failed", "Google 연결 창을 시작하지 못했습니다. OAuth 클라이언트 설정과 현재 사이트 주소를 확인해 주세요.")); }
    return promise;
  }

  async function calendarFetch(input, options = {}) {
    let url;
    try { url = new URL(input); } catch { throw authError("invalid_api_url", "올바른 Google Calendar API 주소가 아닙니다."); }
    if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/") || url.username || url.password || url.hash) {
      throw authError("invalid_api_url", "Google Calendar API 외부로 권한 정보를 보낼 수 없습니다.");
    }
    const token = calendarToken();
    if (!token) throw authError("authorization_required", "Google 캘린더 권한 연결이 필요합니다. 연결 버튼을 눌러 주세요.", { status: 401 });
    const requestEpoch = epoch;
    const controller = new AbortController();
    const { signal, timeoutMs = apiTimeoutMs, ...fetchOptions } = options;
    let timedOut = false;
    const cancelled = () => controller.abort();
    if (signal?.aborted) throw authError("cancelled", "Google 캘린더 요청을 취소했습니다.");
    signal?.addEventListener("abort", cancelled, { once: true });
    requests.add(controller);
    const timer = setTimer(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const headers = new Headers(fetchOptions.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      const response = await fetchImpl(url.href, { ...fetchOptions, headers, signal: controller.signal,
        redirect: "error", credentials: "omit", cache: "no-store", mode: "cors", referrerPolicy: "no-referrer" });
      if (epoch !== requestEpoch || controller.signal.aborted) throw authError("cancelled", "Google 캘린더 요청을 취소했습니다.");
      if (response.ok) {
        // Keep the abort/timeout active until the full body has arrived, not
        // merely its headers. Also guard delayed JSON reads after an app lock.
        const body = await response.arrayBuffer();
        const ensureCurrent = () => { if (epoch !== requestEpoch || accessToken !== token || controller.signal.aborted) throw authError("cancelled", "Google 캘린더 요청을 취소했습니다."); };
        ensureCurrent();
        const guardResponse = (target) => new Proxy(target, { get(object, property) {
          if (property === "clone") return () => { ensureCurrent(); return guardResponse(object.clone()); };
          if (["json", "text", "arrayBuffer", "blob", "formData", "bytes"].includes(property) && typeof object[property] === "function") return async (...args) => {
            ensureCurrent(); const value = await object[property](...args); ensureCurrent(); return value;
          };
          const value = Reflect.get(object, property, object);
          return typeof value === "function" ? value.bind(object) : value;
        } });
        return guardResponse(new Response([204, 205].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers }));
      }
      let detail;
      try { detail = await response.clone().json(); } catch { detail = null; }
      if (epoch !== requestEpoch || controller.signal.aborted) throw authError("cancelled", "Google 캘린더 요청을 취소했습니다.");
      const reasons = [detail?.error?.status, ...(Array.isArray(detail?.error?.errors) ? detail.error.errors : []).map((item) => item.reason)];
      const quota = response.status === 429 || reasons.some((reason) => ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RESOURCE_EXHAUSTED"].includes(reason));
      let message = "Google 캘린더 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      if (response.status === 401) {
        message = "Google 캘린더 권한이 만료되었거나 해제되었습니다. 연결 버튼을 다시 눌러 주세요.";
        reset("expired", message);
      } else if (quota) message = "Google 캘린더 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
      else if (reasons.some((reason) => ["accessNotConfigured", "SERVICE_DISABLED"].includes(reason))) message = "Google Cloud 프로젝트에서 Google Calendar API 사용 설정을 확인해 주세요.";
      else if (response.status === 403) message = "이 캘린더의 일정에 접근할 권한이 없습니다. 캘린더를 소유한 Google 계정과 승인한 권한을 확인해 주세요.";
      else if (response.status === 404) message = "Google에서 해당 캘린더 또는 일정을 찾을 수 없습니다. 선택한 캘린더를 확인해 주세요.";
      else if (response.status === 409) message = "Google에 같은 식별자의 일정이 이미 있습니다. 동기화 상태를 다시 확인해 주세요.";
      else if (response.status === 412) message = "Google에서 일정이 먼저 변경되었습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.";
      throw authError(`http_${response.status}`, message, { status: response.status, retryable: quota || response.status >= 500 });
    } catch (failure) {
      if (timedOut) throw authError("request_timeout", "Google 캘린더 응답이 늦습니다. 반영 여부를 확인한 뒤 다시 시도해 주세요.", { retryable: true });
      if (failure instanceof CalendarAuthError) throw failure;
      if (controller.signal.aborted || epoch !== requestEpoch) throw authError("cancelled", "Google 캘린더 요청을 취소했습니다.");
      throw authError("network_error", "Google 캘린더에 연결하지 못했습니다. 네트워크와 반영 여부를 확인한 뒤 다시 시도해 주세요.", { retryable: true });
    } finally {
      clearTimer(timer); signal?.removeEventListener("abort", cancelled); requests.delete(controller);
    }
  }

  return { prepareCalendarAccess, requestCalendarAccess, calendarToken, getCalendarAuthStatus, subscribeCalendarAuth, forgetCalendarAccess, calendarFetch };
}

const calendarAuth = createCalendarAuth();
export const { prepareCalendarAccess, requestCalendarAccess, calendarToken, getCalendarAuthStatus,
  subscribeCalendarAuth, forgetCalendarAccess, calendarFetch } = calendarAuth;
