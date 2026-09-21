import { CALENDAR_SCOPE, CalendarAuthError, createCalendarAuth, validCalendarClientId } from "./googleCalendarAuth.mjs";

const ENDPOINT = "/api/google-calendar-auth";
const authError = (code, message, details) => new CalendarAuthError(code, message, details);
const cancelled = () => authError("cancelled", "Google 캘린더 요청을 취소했습니다.");

/** The persistent path handles only a one-use code and session metadata. Google
 * tokens stay behind the same-origin server's encrypted HttpOnly cookie. */
export function createCalendarSession({
  getGoogle = () => globalThis.google,
  getUserActivation = () => globalThis.navigator?.userActivation,
  fetchImpl = (...args) => globalThis.fetch(...args),
  setTimer = (...args) => setTimeout(...args),
  clearTimer = (...args) => clearTimeout(...args),
  apiTimeoutMs = 25000,
  requestTimeoutMs = 120000,
  legacyAuth,
  ...legacyOptions
} = {}) {
  const legacy = legacyAuth || createCalendarAuth({ getGoogle, getUserActivation, fetchImpl, setTimer, clearTimer, ...legacyOptions });
  let config = null, configPromise = null, restorePromise = null, pending = null, epoch = 0;
  let session = { status: "disconnected", connected: false, clientId: "", calendarId: "", persistent: false, error: "", retryable: false };
  const listeners = new Set(), requests = new Set();
  const snapshot = () => ({ ...(config?.configured === false ? legacy.getCalendarAuthStatus() : session),
    configured: config?.configured ?? null, serverClientId: config?.clientId || "", serverCalendarId: config?.calendarId || "",
    persistent: config?.configured === false ? false : session.persistent,
    checking: session.status === "checking", connecting: session.status === "connecting" || (config?.configured === false && legacy.getCalendarAuthStatus().connecting),
    retryable: config?.configured === false ? false : session.retryable,
    needsReconnect: config?.configured !== false && session.status === "expired", scope: CALENDAR_SCOPE });
  const emit = () => { const value = snapshot(); for (const listener of listeners) { try { listener(value); } catch { /* UI listeners cannot break authorization. */ } } };
  legacy.subscribeCalendarAuth(() => { if (config?.configured === false) emit(); });
  const update = (value) => { session = { ...session, ...value }; emit(); };
  const assertCurrent = (stamp, signal) => { if (stamp !== epoch || signal?.aborted) throw cancelled(); };
  const fail = (failure) => update({ connected: false, status: failure.status === 401 ? "expired" : failure.retryable ? "recovering" : "error", error: failure.message, retryable: !!failure.retryable });
  const invalidate = () => {
    epoch++;
    for (const controller of requests) controller.abort();
    configPromise = null; restorePromise = null;
    if (pending) { const previous = pending; pending = null; clearTimer(previous.timer); previous.reject(cancelled()); }
  };
  function forgetCalendarAccess() {
    invalidate(); legacy.forgetCalendarAccess();
    session = { status: "disconnected", connected: false, clientId: "", calendarId: "", persistent: false, error: "", retryable: false };
    emit();
  }
  const getCalendarAuthStatus = () => snapshot();
  const subscribeCalendarAuth = (listener) => { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); };

  async function request(action, payload = {}, { signal, timeoutMs = apiTimeoutMs, stamp = epoch } = {}) {
    assertCurrent(stamp, signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timedOut = false;
    signal?.addEventListener("abort", abort, { once: true }); requests.add(controller);
    const timer = setTimer(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const isConfig = action === "config";
      const response = await fetchImpl(isConfig ? `${ENDPOINT}?action=config` : ENDPOINT, {
        method: isConfig ? "GET" : "POST", credentials: "include", mode: "same-origin", cache: "no-store", redirect: "error",
        headers: isConfig ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json", "X-Workboard-Calendar": "1" },
        ...(isConfig ? {} : { body: JSON.stringify({ action, ...payload }) }), signal: controller.signal,
      });
      const body = await response.arrayBuffer();
      assertCurrent(stamp, controller.signal);
      if (!response.ok) {
        let detail;
        try { detail = JSON.parse(new TextDecoder().decode(body)); } catch { /* Never show arbitrary HTML as an auth error. */ }
        throw authError(detail?.error?.code || `http_${response.status}`,
          typeof detail?.error?.message === "string" ? detail.error.message : "Google 캘린더 연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도합니다.",
          { status: response.status, retryable: typeof detail?.error?.retryable === "boolean" ? detail.error.retryable : response.status === 429 || response.status >= 500 });
      }
      const guardResponse = (target) => new Proxy(target, { get(object, property) {
        if (property === "clone") return () => { assertCurrent(stamp); return guardResponse(object.clone()); };
        if (["json", "text", "arrayBuffer", "blob", "formData", "bytes"].includes(property) && typeof object[property] === "function") return async (...args) => {
          assertCurrent(stamp); const value = await object[property](...args); assertCurrent(stamp); return value;
        };
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      } });
      return guardResponse(new Response([204, 205].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers }));
    } catch (failure) {
      if (stamp !== epoch || (controller.signal.aborted && !timedOut)) throw cancelled();
      if (timedOut) throw authError("request_timeout", "Google 캘린더 응답을 기다리고 있습니다. 연결되면 자동으로 다시 확인합니다.", { retryable: true });
      if (failure instanceof CalendarAuthError) throw failure;
      throw authError("network_error", "네트워크에 연결되면 Google 캘린더를 자동으로 다시 연결합니다.", { retryable: true });
    } finally { clearTimer(timer); signal?.removeEventListener("abort", abort); requests.delete(controller); }
  }

  function loadConfig() {
    if (config) return Promise.resolve(config);
    if (configPromise) return configPromise;
    const stamp = epoch;
    const promise = request("config", {}, { stamp }).then(async (response) => {
      try { return await response.json(); }
      catch (failure) { if (failure.code === "cancelled") throw failure; throw authError("invalid_configuration", "Google 캘린더 자동 연결 설정을 확인해 주세요."); }
    }).then((value) => {
      assertCurrent(stamp);
      if (typeof value?.configured !== "boolean" || (value.configured && (!validCalendarClientId(value.clientId) || typeof value.calendarId !== "string" || !value.calendarId))) {
        throw authError("invalid_configuration", "Google 캘린더 자동 연결 설정을 확인해 주세요.");
      }
      config = { configured: value.configured, clientId: value.clientId || "", calendarId: value.calendarId || "" }; emit(); return config;
    }).finally(() => { if (configPromise === promise) configPromise = null; });
    configPromise = promise;
    return promise;
  }
  // Preparing can load the Google library, but never opens an authorization UI.
  async function prepareCalendarAccess() {
    const stamp = epoch;
    await Promise.all([loadConfig(), legacy.prepareCalendarAccess()]);
    assertCurrent(stamp);
    return snapshot();
  }
  function accept(value, calendarId) {
    if (value?.connected !== true || value.persistent !== true || value.clientId !== config?.clientId || value.calendarId !== calendarId) {
      throw authError("invalid_session", "연결한 Google 계정과 상담 캘린더를 확인하지 못했습니다.");
    }
    update({ status: "connected", connected: true, clientId: value.clientId, calendarId: value.calendarId, persistent: true, error: "", retryable: false });
    return snapshot();
  }
  function restoreCalendarAccess(calendarId) {
    if (pending) return pending.promise;
    if (restorePromise?.calendarId === calendarId) return restorePromise.promise;
    const stamp = epoch;
    update({ status: "checking", connected: false, error: "", retryable: false });
    const promise = (async () => {
      try {
        await loadConfig(); assertCurrent(stamp);
        if (!config.configured) { update({ status: "disconnected" }); return snapshot(); }
        if (calendarId !== config.calendarId) throw authError("calendar_mismatch", "자동 연결에 설정된 상담 캘린더와 현재 캘린더가 다릅니다.");
        const response = await request("restore", { calendarId }, { stamp });
        return accept(await response.json(), calendarId);
      } catch (failure) { if (stamp === epoch && failure.code !== "cancelled") fail(failure); throw failure; }
      finally { if (restorePromise?.promise === promise) restorePromise = null; }
    })();
    restorePromise = { promise, calendarId };
    return promise;
  }

  function requestCalendarAccess(inputClientId, calendarId) {
    const clientId = String(inputClientId || "").trim();
    if (!config) { prepareCalendarAccess().catch(() => {}); return Promise.reject(authError("configuration_loading", "Google 연결을 준비하고 있습니다. 잠시 후 연결 버튼을 다시 눌러 주세요.")); }
    if (!config.configured) return legacy.requestCalendarAccess(clientId);
    if (clientId !== config.clientId || calendarId !== config.calendarId) return Promise.reject(authError("configuration_mismatch", "서버에 설정된 상담 캘린더와 클라이언트 ID를 확인해 주세요."));
    if (pending) return pending.promise;
    const oauth = getGoogle()?.accounts?.oauth2;
    if (!oauth?.initCodeClient) { prepareCalendarAccess().catch(() => {}); return Promise.reject(authError("library_loading", "Google 연결을 준비하고 있습니다. 잠시 후 연결 버튼을 다시 눌러 주세요.")); }
    if (getUserActivation()?.isActive === false) return Promise.reject(authError("user_gesture_required", "Google 연결 버튼을 직접 눌러 권한을 연결해 주세요."));
    invalidate(); legacy.forgetCalendarAccess();
    const stamp = epoch;
    update({ status: "connecting", connected: false, clientId, calendarId, persistent: true, error: "", retryable: false });
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const connection = { promise, resolve, reject, timer: null }; pending = connection;
    const settle = (failure, value) => {
      if (pending !== connection || stamp !== epoch) return;
      clearTimer(connection.timer); pending = null;
      if (failure) { fail(failure); reject(failure); } else resolve(value);
    };
    connection.timer = setTimer(() => settle(authError("authorization_timeout", "Google 연결 응답을 기다리는 시간이 지났습니다. 연결 버튼을 다시 눌러 주세요.")), requestTimeoutMs);
    const oauthFailure = (value) => {
      const code = value?.error || value?.type || "authorization_failed";
      settle(authError(code, code === "popup_closed" ? "Google 연결 창을 닫았습니다. 연결하려면 버튼을 다시 눌러 주세요." : code === "popup_failed_to_open" ? "Google 연결 창을 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요." : "Google 캘린더 권한 연결을 완료하지 못했습니다. 계정과 승인한 권한을 확인해 주세요."));
    };
    try {
      const client = oauth.initCodeClient({ client_id: clientId, scope: CALENDAR_SCOPE, ux_mode: "popup", include_granted_scopes: false,
        select_account: true,
        callback: async (value) => {
          if (pending !== connection || stamp !== epoch) return;
          if (value?.error) { oauthFailure(value); return; }
          if (typeof value?.code !== "string" || !value.code || value.code.length > 8192) { settle(authError("invalid_code", "Google 연결 확인 정보를 받지 못했습니다. 다시 연결해 주세요.")); return; }
          try {
            const response = await request("exchange", { code: value.code, calendarId }, { stamp });
            const result = await response.json();
            if (pending !== connection || stamp !== epoch) return;
            settle(null, accept(result, calendarId));
          } catch (failure) { settle(failure); }
        }, error_callback: oauthFailure,
      });
      client.requestCode();
    } catch { settle(authError("authorization_start_failed", "Google 연결 창을 시작하지 못했습니다. OAuth 설정과 현재 사이트 주소를 확인해 주세요.")); }
    return promise;
  }

  async function calendarFetch(input, options = {}) {
    if (config?.configured === false) return legacy.calendarFetch(input, options);
    if (!session.connected) throw authError("authorization_required", "Google 캘린더 연결을 확인한 뒤 다시 시도해 주세요.", { status: 401 });
    let url;
    try { url = new URL(input); } catch { throw authError("invalid_api_url", "올바른 Google Calendar API 주소가 아닙니다."); }
    if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/calendar/v3/") || url.username || url.password || url.hash) throw authError("invalid_api_url", "허용되지 않은 캘린더 API 주소입니다.");
    const method = (options.method || "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) throw authError("invalid_api_method", "지원하지 않는 캘린더 요청입니다.");
    let body;
    try { body = options.body == null ? undefined : JSON.parse(options.body); } catch { throw authError("invalid_api_body", "캘린더에 전송할 예약을 확인해 주세요."); }
    const stamp = epoch;
    try { return await request("proxy", { url: url.href, method, ...(body === undefined ? {} : { body }) }, { signal: options.signal, timeoutMs: options.timeoutMs, stamp }); }
    catch (failure) { if (stamp === epoch && (failure.status === 401 || failure.retryable)) fail(failure); throw failure; }
  }
  async function disconnectCalendarAccess() {
    const wasConfigured = config?.configured;
    forgetCalendarAccess();
    if (wasConfigured === false) return snapshot();
    try { await request("disconnect"); return snapshot(); }
    catch (failure) { if (failure.code !== "cancelled") update({ error: "자동 등록은 꺼졌습니다. 네트워크 연결 후 권한 설정에서 연결 해제를 다시 눌러 주세요." }); throw failure; }
  }
  return { prepareCalendarAccess, requestCalendarAccess, restoreCalendarAccess, disconnectCalendarAccess,
    getCalendarAuthStatus, subscribeCalendarAuth, forgetCalendarAccess, calendarFetch };
}

const calendarSession = createCalendarSession();
export const { prepareCalendarAccess, requestCalendarAccess, restoreCalendarAccess, disconnectCalendarAccess,
  getCalendarAuthStatus, subscribeCalendarAuth, forgetCalendarAccess, calendarFetch } = calendarSession;
