import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Check, ChevronRight, ChevronLeft, Trash2, Inbox, Send,
  Clock, X, Settings2, FolderClosed, CalendarDays, AlertTriangle,
  Pencil, Wallet, WalletMinimal, ListChecks, Download, Upload,
  CornerDownLeft, GripVertical, ArrowUpDown, RotateCcw, LayoutGrid,
  Stamp, Sunrise, CircleDot, Palette, Cloud, CloudOff, RefreshCw, Copy, ShieldCheck, HardDriveDownload,
  LogIn, HardDrive, Database, StickyNote, Pin, FileX, CornerDownRight, Bell, Globe, Youtube, MapPin, AlignLeft, Lock, Unlock, Users, Paperclip, Phone,
  Star, Bold, Italic, Underline, Baseline, ImagePlus, MoreVertical, CheckSquare
} from "lucide-react";

/* ------------------------------------------------------------------
   색 · 타이포 토큰 — 결재 서류철의 세계
------------------------------------------------------------------- */
const C = {
  bg: "#EDEFEC", surface: "#FFFFFF", ink: "#1A211E", muted: "#6C7570",
  faint: "#9AA29C", rule: "#DCE0DB", navy: "#24486B", navySoft: "#E7EDF3",
  seal: "#C2402F", sealSoft: "#FBEDEA", amber: "#B0731F", amberSoft: "#FAF1E0",
  green: "#3F7A52", greenSoft: "#E9F1EC",
};
/* 사업 구분용 팔레트 — 종이 위에서 서로 확실히 구분되는 8색 */
/* 색조를 45도씩 정확히 벌린 8색 — 사업끼리도, 세부사업끼리도 섞이지 않습니다 */
const PALETTE = ["#25257E", "#226D5A", "#B13E2F", "#93831A", "#286728", "#7A3D8F", "#9C3A6B", "#476E2B"];
/* 예전 팔레트로 저장된 색은 가장 가까운 새 색으로 옮깁니다 */
const OLD_COLORS = {
  "#24486B": "#25257E", "#284D71": "#25257E", "#263073": "#25257E",
  "#2F6F62": "#226D5A", "#296770": "#226D5A",
  "#C2402F": "#B13E2F", "#B24234": "#B13E2F",
  "#B0731F": "#93831A", "#9D6B25": "#93831A", "#9A8A1D": "#93831A",
  "#6B4A7A": "#7A3D8F", "#704983": "#7A3D8F", "#6D4785": "#7A3D8F",
  "#5C7238": "#476E2B", "#5B7236": "#476E2B",
  "#366336": "#286728", "#316845": "#286728", "#4A5B66": "#286728",
  "#A64B62": "#9C3A6B", "#9B4670": "#9C3A6B", "#964077": "#9C3A6B",
};
const fixColor = (c) => OLD_COLORS[String(c || "").toUpperCase()] || c;
/* 세부사업 하이라이트 — 그 사업의 색에서 갈라져 나온 옅은 계열색.
   색조(hue)는 상위 사업을 따르고 밝기만 달리해, 다른 사업과 섞이지 않습니다. */
const hexToHsl = (hex) => {
  const h = String(hex || "#24486B").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
  }
  hh = (hh * 60 + 360) % 360;
  const l = (mx + mn) / 2;
  const ss = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [hh, ss, l];
};
const hslToHex = (h, s2, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s2, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + t.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
};
/* 같은 색조 안에서 밝기·채도를 조금씩 달리한 6단계 */
const TINTS = [
  [-14, 0.60, 0.93], [0, 0.52, 0.84], [14, 0.46, 0.74],
  [-14, 0.34, 0.88], [14, 0.66, 0.68], [0, 0.30, 0.96],
];
const subColor = (sub, i = 0, base) => {
  const [h] = hexToHsl(base || "#284D71");
  const [dh, ss, ll] = TINTS[i % TINTS.length];
  return hslToHex((h + dh + 360) % 360, ss, ll);
};
/* 옅은 칸도 경계가 보이도록 같은 색조의 진한 선 */
const subEdge = (i = 0, base) => {
  const [h] = hexToHsl(base || "#284D71");
  const [dh, ss, ll] = TINTS[i % TINTS.length];
  return hslToHex((h + dh + 360) % 360, Math.min(0.78, ss + 0.14), Math.max(0.30, ll - 0.36));
};
const isInbox = (s) => !!s.inbox;
const liveSubs = (p) => p.subs.filter((s) => !isInbox(s));
/* 남은 할 일도 미비 서류도 없으면 끝난 세부사업으로 봅니다 */
const subDoneAll = (s) => {
  const st = subStats(s);
  return st.todoTotal > 0 || st.docTotal > 0 ? st.done === st.total : false;
};
const colorOf = (p, i = 0) => fixColor(p?.color) || PALETTE[i % PALETTE.length];

const FONT =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif';

const DOCS_EXPENSE = ["사업계획서", "지출품의서", "영수증", "세부지출내역서", "지출결의서", "결과보고서"];
const DOCS_NONE = ["사업계획서", "결과보고서"];
const SYNC_KEY = "workboard:sync";
const BACKUP_KEY = "workboard:lastBackup";

const loadSync = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } };
const saveSync = (s) => localStorage.setItem(SYNC_KEY, JSON.stringify(s));
const cleanUrl = (u) => String(u || "").trim().replace(/\/+$/, "");

/* 동기화 방식: 없음 / 구글 드라이브 / Supabase */
const syncReady = (c) => {
  if (!c) return false;
  if (c.mode === "gdrive") return !!c.clientId;
  if (c.mode === "supabase") return !!(c.url && c.key && c.code);
  return false;
};

/* ============================================================
   구글 드라이브 — 본인 계정의 드라이브에 파일 하나로 저장합니다
   ============================================================ */
const GIS_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_NAME = "workboard-data.json";

let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((res, rej) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return res();
    const el = document.createElement("script");
    el.src = GIS_SRC; el.async = true; el.defer = true;
    el.onload = () => res();
    el.onerror = () => { gisPromise = null; rej(new Error("구글 로그인을 불러오지 못했습니다")); };
    document.head.appendChild(el);
  });
  return gisPromise;
}

/* 토큰은 메모리에만 둡니다 (저장하지 않음) */
/* 토큰은 만료 시각과 함께 이 기기에만 보관합니다.
   덕분에 앱을 껐다 켜도 1시간 안이면 로그인 없이 바로 이어집니다. */
const GTOK_KEY = "workboard:gtok";
const gAuth = { token: "", exp: 0, fileId: "", client: null, clientId: "" };
(() => {
  try {
    const t = JSON.parse(localStorage.getItem(GTOK_KEY) || "null");
    if (t && t.exp > Date.now()) { gAuth.token = t.token; gAuth.exp = t.exp; gAuth.fileId = t.fileId || ""; }
  } catch (e) {}
})();
const gRemember = () => {
  try {
    localStorage.setItem(GTOK_KEY, JSON.stringify({ token: gAuth.token, exp: gAuth.exp, fileId: gAuth.fileId }));
  } catch (e) {}
};
const gForget = () => { gAuth.token = ""; gAuth.exp = 0; try { localStorage.removeItem(GTOK_KEY); } catch (e) {} };
const gSignedIn = () => !!gAuth.token && Date.now() < gAuth.exp - 120000;

function gToken(clientId, interactive) {
  return new Promise((res, rej) => {
    if (gSignedIn()) return res(gAuth.token);
    loadGis().then(() => {
      try {
        if (!gAuth.client || gAuth.clientId !== clientId) {
          gAuth.clientId = clientId;
          gAuth.client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_SCOPE,
            callback: (r) => {
              if (r && r.access_token) {
                gAuth.token = r.access_token;
                gAuth.exp = Date.now() + (Number(r.expires_in || 3600) * 1000);
                gRemember();
                if (gAuth._ok) gAuth._ok(gAuth.token);
              } else if (gAuth._no) {
                gAuth._no(new Error(r && r.error === "access_denied" ? "권한이 거부되었습니다" : "로그인하지 못했습니다"));
              }
            },
            error_callback: (e) => {
              if (!gAuth._no) return;
              const t = e && e.type;
              gAuth._no(new Error(
                t === "popup_closed" ? "로그인 창이 닫혔습니다"
                : t === "popup_failed_to_open" ? "팝업이 차단되었습니다. 주소창의 차단 아이콘을 눌러 허용해 주세요"
                : "로그인이 필요합니다"));
            },
          });
        }
        gAuth._ok = res; gAuth._no = rej;
        gAuth.client.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (e) { rej(e); }
    }).catch(rej);
  });
}

async function gFetch(cfg, url, opts, retried) {
  const t = await gToken(cfg.clientId, false);
  const r = await fetch(url, { ...(opts || {}), headers: { ...((opts || {}).headers || {}), Authorization: "Bearer " + t } });
  if (r.status === 401 && !retried) { gForget(); return gFetch(cfg, url, opts, true); }
  return r;
}

async function gFindFile(cfg) {
  if (gAuth.fileId) return gAuth.fileId;
  const q = encodeURIComponent("name='" + DRIVE_NAME + "' and trashed=false");
  const r = await gFetch(cfg, "https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&pageSize=1&fields=files(id)");
  if (!r.ok) throw new Error("드라이브를 읽지 못했습니다 (" + r.status + ")");
  const j = await r.json();
  gAuth.fileId = (j.files && j.files[0] && j.files[0].id) || "";
  if (gAuth.fileId) gRemember();
  return gAuth.fileId;
}

async function gGet(cfg) {
  const id = await gFindFile(cfg);
  if (!id) return null;
  const r = await gFetch(cfg, "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media");
  if (r.status === 404) { gAuth.fileId = ""; return null; }
  if (!r.ok) throw new Error("파일을 읽지 못했습니다 (" + r.status + ")");
  try { return await r.json(); } catch (e) { return null; }
}

async function gPut(cfg, data) {
  const id = await gFindFile(cfg);
  const body = JSON.stringify(data);
  if (id) {
    const r = await gFetch(cfg, "https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    if (r.status === 404) { gAuth.fileId = ""; return gPut(cfg, data); }
    if (!r.ok) throw new Error("드라이브에 저장하지 못했습니다 (" + r.status + ")");
    return;
  }
  const B = "wb" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: DRIVE_NAME, mimeType: "application/json", description: "업무보드 데이터" });
  const payload =
    "--" + B + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
    "\r\n--" + B + "\r\nContent-Type: application/json\r\n\r\n" + body +
    "\r\n--" + B + "--";
  const r = await gFetch(cfg, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + B }, body: payload });
  if (!r.ok) throw new Error("드라이브에 만들지 못했습니다 (" + r.status + ")");
  const j = await r.json();
  gAuth.fileId = j.id || "";
  gRemember();
}

/* ============================================================
   Supabase REST
   ============================================================ */
async function sGet(cfg) {
  const r = await fetch(cleanUrl(cfg.url) + "/rest/v1/boards?id=eq." + encodeURIComponent(cfg.code) + "&select=data", {
    headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
  });
  if (!r.ok) throw new Error("불러오기 실패 (" + r.status + ")");
  const j = await r.json();
  return j && j[0] ? j[0].data : null;
}
async function sPut(cfg, data) {
  const r = await fetch(cleanUrl(cfg.url) + "/rest/v1/boards", {
    method: "POST",
    headers: {
      apikey: cfg.key, Authorization: "Bearer " + cfg.key,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ id: cfg.code, data, updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error("저장 실패 (" + r.status + ")");
}

const remoteGet = (cfg) => (cfg.mode === "gdrive" ? gGet(cfg) : sGet(cfg));
const remotePut = (cfg, d) => (cfg.mode === "gdrive" ? gPut(cfg, d) : sPut(cfg, d));

/* 일정 알림 — 앱이 열려 있는 동안 예정 시각에 알려 줍니다 */
const NOTI_KEY = "workboard:noti";
const notiOn = () => localStorage.getItem(NOTI_KEY) === "1";
const notiSet = (v) => localStorage.setItem(NOTI_KEY, v ? "1" : "0");
const notiSupported = () => typeof window !== "undefined" && "Notification" in window;
const notiFired = new Set();

const VIEW_KEY = "workboard:view";
const lastView = () => { try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (e) { return {}; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch (e) {} };

const APP_VERSION = "2026.09.10g";
/* ============================================================
   잠금 — 비밀번호로 내용 자체를 잠급니다.
   화면만 가리는 게 아니라 저장되는 내용이 암호문이 됩니다.
   ============================================================ */
const LOCK_KEY = "workboard:lock";
const B64 = {
  to: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  from: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};
const cryptoOK = () => typeof crypto !== "undefined" && crypto.subtle;

async function deriveKey(pw, saltB64) {
  const salt = B64.from(saltB64);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function sealText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({ enc: 1, iv: B64.to(iv), ct: B64.to(ct) });
}
async function openText(key, raw) {
  const o = JSON.parse(raw);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: B64.from(o.iv) }, key, B64.from(o.ct));
  return new TextDecoder().decode(pt);
}
const isSealed = (raw) => {
  try { const o = JSON.parse(raw); return o && o.enc === 1 && o.iv && o.ct; } catch (e) { return false; }
};
const lockCfg = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || null; } catch (e) { return null; } };

const STORAGE_KEY = "workboard:data";

/* 저장소 — 브라우저(localStorage)를 쓰고, Claude 아티팩트 안에서는 그쪽 저장소를 씁니다 */
const store = {
  async get() {
    if (typeof window !== "undefined" && window.storage?.get) {
      const r = await window.storage.get(STORAGE_KEY);
      return r?.value || null;
    }
    return localStorage.getItem(STORAGE_KEY);
  },
  async set(v) {
    if (typeof window !== "undefined" && window.storage?.set) return !!(await window.storage.set(STORAGE_KEY, v));
    localStorage.setItem(STORAGE_KEY, v);
    return true;
  },
};

/* ------------------------------------------------------------------
   유틸
------------------------------------------------------------------- */
/* 번호나 기호가 붙은 목록일 때만 한 건씩 떼어 냅니다.
   그냥 줄만 바꾼 글은 하나의 할 일로 그대로 둡니다. */
const MARK = /^[\s\u00A0]*(?:[-*•·▪◦]|\(?\d{1,3}[.)]|[①-⑳])[\s\u00A0]+/;
const stripMark = (l) => l.replace(MARK, "").trim();

const splitList = (text) => {
  const raw = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (raw.length <= 1) return raw.map(stripMark).filter(Boolean);
  const marked = raw.filter((l) => MARK.test(l)).length;
  /* 절반 이상이 번호·기호로 시작할 때만 나눕니다 */
  if (marked >= 2 && marked >= Math.ceil(raw.length * 0.5)) {
    return raw.map(stripMark).filter(Boolean);
  }
  return [String(text).replace(/\s+$/, "").replace(/^\s+/, "")];
};

/* 마우스는 더블클릭, 손가락은 한 번 탭으로 편집합니다 */
const isTouch = () => typeof window !== "undefined" && window.matchMedia
  && window.matchMedia("(pointer: coarse)").matches;
const editTrigger = (open) => (isTouch() ? { onClick: open } : { onDoubleClick: open });

/* 숫자만 넣어도 하이픈이 붙습니다 */
const fmtPhone = (v) => {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return d.slice(0, 2) + "-" + d.slice(2);
    if (d.length <= 9) return d.slice(0, 2) + "-" + d.slice(2, 5) + "-" + d.slice(5);
    return d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6, 10);
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
  if (d.length <= 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
  return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7, 11);
};

const toHM2 = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const isoOf = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const todayISO = () => isoOf(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
const nextWeekday = (t) => { const d = new Date(); const diff = (t - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff); return isoOf(d); };

const dayDiff = (iso) => (iso ? Math.round((new Date(iso + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000) : null);
const dLabel = (iso) => {
  const d = dayDiff(iso);
  if (d === null) return "";
  if (d === 0) return "오늘";
  if (d === 1) return "내일";
  if (d > 0) return `D-${d}`;
  return `${Math.abs(d)}일 지남`;
};
const fmtDateK = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${y !== todayISO().slice(0, 4) ? y + "년 " : ""}${Number(m)}월 ${Number(d)}일`;
};
const fmtDateShort = (iso) => (iso ? `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}` : "");
const timeText = (t) => (t.dueEnd && t.dueTime ? `${t.dueTime}–${t.dueEnd}` : t.dueTime || "");
const dueText = (t) => {
  if (!t.due) return "마감 없음";
  const tt = timeText(t);
  return `${fmtDateK(t.due)}${tt ? " · " + tt : ""} · ${dLabel(t.due)}`;
};
/* 날짜 → 시각 순. 시간 없는 항목은 그날의 맨 뒤로 */
/* 지남 · 오늘 · 내일 · 다음 */
const BUCKETS = [
  { k: 0, t: "지남", bg: "#FBEDEA", fg: "#C2402F" },
  { k: 1, t: "오늘", bg: "#FAF1E0", fg: "#B0731F" },
  { k: 2, t: "내일", bg: "#EEF3F8", fg: "#24486B" },
  { k: 3, t: "다음", bg: "#F1F3F0", fg: "#6C7570" },
];
const bucketOf = (t) => {
  const d = dayDiff(t.due);
  if (d === null) return 3;
  if (d < 0) return 0;
  if (d === 0) return 1;
  if (d === 1) return 2;
  return 3;
};
const setBucket = (k) => (k === 1 ? { due: todayISO() } : k === 2 ? { due: addDays(1) } : { due: "", dueTime: "", dueEnd: "" });

/* 사업 이름을 짧게 */
const SHORT = { "집중심리클리닉": "집클", "특별교육": "특별", "수강명령": "수강", "수강신청": "수강", "기타": "기타" };
/* 지금 시각을 지났는지 */
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const minOf = (t) => (t.dueTime ? Number(t.dueTime.slice(0, 2)) * 60 + Number(t.dueTime.slice(3, 5)) : null);
const isPast = (t) => {
  const d = dayDiff(t.due);
  if (d === null) return false;
  if (d < 0) return true;
  if (d > 0) return false;
  const m = minOf(t);
  return m !== null && m < nowMin();
};

const shortName = (n) => SHORT[n] || (n || "").slice(0, 3);

const sortKey = (t) => `${t.due}T${t.dueTime || "99:99"}`;
const byTime = (a, b) => sortKey(a).localeCompare(sortKey(b));

const dueTone = (iso) => {
  const d = dayDiff(iso);
  if (d === null) return "none";
  if (d < 0) return "over";
  if (d <= 3) return "soon";
  return "later";
};
const toneStyle = (tone, done) => done ? { bg: "#F1F3F0", fg: C.faint } : ({
  over: { bg: C.sealSoft, fg: C.seal }, soon: { bg: C.amberSoft, fg: C.amber },
  later: { bg: C.navySoft, fg: C.navy }, none: { bg: "#F1F3F0", fg: C.faint },
}[tone]);

/* 서류 유형: none(해당 없음) / plain(지출 없음, 2종) / expense(지출 있음, 6종)
   예전 데이터는 hasExpense 값으로 판단합니다 */
const docModeOf = (s) => s.docMode || (s.hasExpense ? "expense" : "plain");
const docListOf = (s) => {
  const m = docModeOf(s);
  return m === "none" ? [] : m === "expense" ? DOCS_EXPENSE : DOCS_NONE;
};
const subStats = (sub) => {
  const docs = docListOf(sub);
  const docDone = docs.filter((d) => sub.docs?.[d]).length;
  const todoDone = sub.todos.filter((t) => t.done).length;
  const total = docs.length + sub.todos.length;
  const done = docDone + todoDone;
  return { docs, docDone, docTotal: docs.length, todoDone, todoTotal: sub.todos.length, done, total, pct: total ? Math.round((done / total) * 100) : 0 };
};

/* ------------------------------------------------------------------
   UI 조각
------------------------------------------------------------------- */
const Label = ({ children, style }) => (
  <span style={{ fontSize: 10.5, letterSpacing: "0.14em", color: C.faint, fontWeight: 700, ...style }}>{children}</span>
);

const Chip = ({ children, tone = "neutral", icon: Icon, style }) => {
  const map = {
    neutral: { bg: "#F1F3F0", fg: C.muted }, navy: { bg: C.navySoft, fg: C.navy },
    seal: { bg: C.sealSoft, fg: C.seal }, amber: { bg: C.amberSoft, fg: C.amber },
    green: { bg: C.greenSoft, fg: C.green },
  };
  const s = map[tone] || map.neutral;
  return (
    <span className="inline-flex items-center gap-1 rounded-full"
      style={{ background: s.bg, color: s.fg, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", ...style }}>
      {Icon && <Icon size={12} strokeWidth={2.4} />}{children}
    </span>
  );
};

const Bar = ({ pct, color }) => (
  <div className="w-full rounded-full overflow-hidden" style={{ height: 5, background: "#E6E9E4" }}>
    <div className="h-full rounded-full wb-bar" style={{ width: `${pct}%`, background: pct === 100 ? C.green : color || C.navy }} />
  </div>
);

const Dot = ({ color, size = 8, style }) => (
  <span className="shrink-0 rounded-full" style={{ width: size, height: size, background: color, display: "inline-block", ...style }} />
);

const Btn = ({ children, onClick, kind = "ghost", size = "md", icon: Icon, full, disabled }) => {
  const st = {
    solid: { background: C.navy, color: "#fff", border: "1px solid " + C.navy },
    seal: { background: C.seal, color: "#fff", border: "1px solid " + C.seal },
    ghost: { background: C.surface, color: C.ink, border: "1px solid " + C.rule },
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`wb-btn inline-flex items-center justify-center gap-1.5 rounded-xl ${full ? "w-full" : ""}`}
      style={{ ...st, padding: size === "sm" ? "6px 11px" : "10px 15px", fontSize: size === "sm" ? 12.5 : 14, fontWeight: 650, opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} strokeWidth={2.3} />}{children}
    </button>
  );
};

const Card = ({ children, style, innerRef }) => (
  <div ref={innerRef} className="rounded-2xl" style={{ background: C.surface, border: "1px solid " + C.rule, boxShadow: "0 1px 2px rgba(26,33,30,0.04)", ...style }}>{children}</div>
);

/* 바깥을 눌러 닫기 — 단, 누르기 시작한 곳도 바깥이어야 합니다.
   글자를 드래그하다 밖에서 손을 떼는 경우에 닫히지 않게 합니다. */
function useDismiss(onDismiss) {
  const started = useRef(false);
  return {
    onPointerDown: (e) => { started.current = e.target === e.currentTarget; },
    onClick: (e) => { if (started.current && e.target === e.currentTarget) onDismiss(); started.current = false; },
  };
}

const DeleteBtn = ({ onDelete, label = "삭제" }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return (
    <button onClick={(e) => { e.stopPropagation(); armed ? onDelete() : setArmed(true); }}
      className="wb-btn inline-flex items-center gap-1 rounded-lg shrink-0"
      style={{ padding: "5px 8px", fontSize: 11.5, fontWeight: 650, color: armed ? "#fff" : C.faint, background: armed ? C.seal : "transparent", border: "1px solid " + (armed ? C.seal : "transparent"), cursor: "pointer" }}>
      <Trash2 size={13} strokeWidth={2.2} />{armed ? "한 번 더" : label}
    </button>
  );
};

/* 색 고르기 */
function ColorPicker({ color, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className="wb-btn shrink-0 flex items-center justify-center rounded-lg"
        style={{ background: "none", border: "1px solid " + C.rule, padding: "5px 7px", cursor: "pointer", gap: 4 }} title="사업 색 바꾸기">
        <Dot color={color} size={10} />
        <Palette size={12} color={C.faint} strokeWidth={2.2} />
      </button>
      {open && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-xl w-full" style={{ background: "#F7F8F6", border: "1px solid " + C.rule, padding: 9, marginTop: 8 }}>
          {PALETTE.map((c) => (
            <button key={c} onClick={() => { onPick(c); setOpen(false); }} className="wb-btn rounded-full flex items-center justify-center"
              style={{ width: 26, height: 26, background: c, border: color === c ? "2.5px solid " + C.ink : "2.5px solid transparent", cursor: "pointer" }}>
              {color === c && <Check size={13} color="#fff" strokeWidth={3.4} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------
   드래그 정렬
------------------------------------------------------------------- */
function Sortable({ items, idOf, onReorder, renderRow, className, style, rowStyle, deferred }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const listRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const overRef = useRef(null);

  const idx = (id) => itemsRef.current.findIndex((i) => idOf(i) === id);

  const down = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    setDragId(id);
    setOverId(id);
    overRef.current = id;
  };

  const move = (e) => {
    if (!dragId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest ? el.closest("[data-sortid]") : null;
    if (!row || !listRef.current || !listRef.current.contains(row)) return;
    const id = row.getAttribute("data-sortid");
    if (!id) return;

    if (deferred) {                       /* 손을 뗄 때 옮깁니다 */
      if (id !== overRef.current) { overRef.current = id; setOverId(id); }
      return;
    }
    if (id === dragId) return;            /* 끄는 대로 바로 옮깁니다 */
    const from = idx(dragId), to = idx(id);
    if (from < 0 || to < 0) return;
    const next = itemsRef.current.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onReorder(next);
  };

  const up = (e) => {
    if (!dragId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
    if (deferred && overRef.current && overRef.current !== dragId) {
      const from = idx(dragId), to = idx(overRef.current);
      if (from >= 0 && to >= 0) {
        const next = itemsRef.current.slice();
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        onReorder(next);
      }
    }
    setDragId(null); setOverId(null); overRef.current = null;
  };

  const dragging = dragId != null;
  const fromIdx = dragging ? idx(dragId) : -1;

  return (
    <div ref={listRef} className={className} style={style}>
      {items.map((it) => {
        const id = idOf(it);
        const on = dragId === id;
        /* 놓일 자리를 옅은 회색 선으로만 알려 줍니다 */
        const mark = deferred && dragging && overId === id && !on;
        const below = mark && idx(id) > fromIdx;
        const line = "2px solid #C2C8C0";
        return (
          <div key={id} data-sortid={id}
            style={{
              ...(rowStyle || {}),
              opacity: on ? 0.4 : 1,
              borderTop: deferred ? (mark && !below ? line : "2px solid transparent")
                : (on ? line : "2px solid transparent"),
              borderBottom: deferred ? (mark && below ? line : "2px solid transparent")
                : (on ? line : "2px solid transparent"),
              transition: "opacity .12s ease",
              position: "relative", zIndex: on ? 5 : 1,
            }}>
            {renderRow(it, { onPointerDown: (e) => down(e, id), onPointerMove: move, onPointerUp: up, onPointerCancel: up, style: { touchAction: "none", cursor: on ? "grabbing" : "grab" } }, on)}
          </div>
        );
      })}
    </div>
  );
}

const Handle = ({ props }) => (
  <button {...props} className="wb-btn shrink-0 flex items-center justify-center"
    style={{ ...props.style, background: "none", border: "none", color: C.faint, padding: "2px 1px", marginTop: 2 }} aria-label="순서 바꾸기">
    <GripVertical size={16} strokeWidth={2} />
  </button>
);

/* ------------------------------------------------------------------
   마감 편집
------------------------------------------------------------------- */
/* 시·분을 한 번에 고르는 시간 선택기 */
const TIME_STEP = 5;
const TIME_LIST = (() => {
  const out = [];
  for (let m = 0; m < 24 * 60; m += TIME_STEP) out.push(toHM2(m));
  return out;
})();

function TimePick({ value, onChange, style, disabled }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const i = TIME_LIST.indexOf(value);
    const at = i >= 0 ? i : Math.floor(9 * 60 / TIME_STEP);
    listRef.current.scrollTop = Math.max(0, at * 30 - 90);
  }, [open, value]);

  return (
    <span ref={boxRef} style={{ position: "relative", display: "inline-block", ...(style || {}) }}>
      <button onClick={() => !disabled && setOpen(!open)} disabled={disabled}
        className="wb-btn w-full text-left rounded-lg"
        style={{ padding: "9px 11px", fontSize: 13.5, fontWeight: 650,
          border: "1px solid " + (open ? C.navy : C.rule),
          background: disabled ? "#F1F3F0" : C.surface, color: disabled ? C.faint : C.ink,
          cursor: disabled ? "default" : "pointer", fontVariantNumeric: "tabular-nums" }}>
        {value || "--:--"}
      </button>
      {open && (
        <div ref={listRef} className="rounded-lg wb-fade"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 104, maxHeight: 216,
            overflowY: "auto", background: C.surface, border: "1px solid " + C.rule,
            boxShadow: "0 8px 24px rgba(26,33,30,0.16)", zIndex: 40, padding: 4 }}>
          {TIME_LIST.map((t) => {
            const on = t === value;
            return (
              <button key={t} onClick={() => { onChange(t); setOpen(false); }}
                className="wb-btn w-full text-left rounded"
                style={{ display: "block", height: 30, lineHeight: "30px", padding: "0 10px",
                  fontSize: 13, fontWeight: on ? 800 : 600, cursor: "pointer", border: "none",
                  background: on ? C.navySoft : "transparent", color: on ? C.navy : C.ink,
                  fontVariantNumeric: "tabular-nums" }}>
                {t}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function DueEditor({ value, onChange, onClose }) {
  const { due = "", dueTime = "", dueEnd = "" } = value;
  const mode = dueEnd ? "range" : dueTime ? "start" : "none";
  const quick = [{ t: "오늘", v: todayISO() }, { t: "내일", v: addDays(1) }, { t: "다음", v: "" }];
  const setMode = (m) => {
    if (m === "none") onChange({ ...value, dueTime: "", dueEnd: "" });
    if (m === "start") onChange({ ...value, dueTime: dueTime || "09:00", dueEnd: "" });
    if (m === "range") {
      const base = dueTime || "09:00";
      const [hh, mm] = base.split(":").map(Number);
      const end = String((hh + 1) % 24).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
      onChange({ ...value, dueTime: base, dueEnd: dueEnd || end });
    }
  };
  return (
    <div className="rounded-xl mt-2" style={{ background: "#F7F8F6", border: "1px solid " + C.rule, padding: 11 }}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        {quick.map((q) => (
          <button key={q.t} onClick={() => onChange({ ...value, due: q.v })} className="wb-btn rounded-full"
            style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 10px", cursor: "pointer",
              background: due === q.v ? C.navy : C.surface, color: due === q.v ? "#fff" : C.muted,
              border: "1px solid " + (due === q.v ? C.navy : C.rule) }}>{q.t}</button>
        ))}
      </div>
      <input type="date" value={due} onChange={(e) => onChange({ ...value, due: e.target.value })} className="w-full rounded-lg"
        style={{ padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: C.surface, color: C.ink }} />
      <div className="flex rounded-lg mt-2.5" style={{ background: "#EBEEE9", padding: 3, gap: 3, opacity: due ? 1 : 0.5, pointerEvents: due ? "auto" : "none" }}>
        {[{ k: "none", t: "날짜만" }, { k: "start", t: "시작 시간" }, { k: "range", t: "시간 범위" }].map((o) => {
          const on = mode === o.k;
          return (
            <button key={o.k} onClick={() => setMode(o.k)} className="wb-btn flex-1 rounded-md"
              style={{ padding: "6px 4px", fontSize: 12, fontWeight: 700, cursor: "pointer", background: on ? C.surface : "transparent",
                color: on ? C.ink : C.faint, border: "1px solid " + (on ? C.rule : "transparent") }}>{o.t}</button>
          );
        })}
      </div>
      {mode !== "none" && (
        <div className="flex items-center gap-2 mt-2.5">
          <TimePick value={dueTime} onChange={(t) => onChange({ ...value, dueTime: t })} style={{ flex: 1 }} />
          {mode === "range" && (
            <>
              <span style={{ color: C.faint }}>–</span>
              <TimePick value={dueEnd} onChange={(t) => onChange({ ...value, dueEnd: t })} style={{ flex: 1 }} />
            </>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mt-2.5">
        <button onClick={() => onChange({ ...value, due: "", dueTime: "", dueEnd: "" })} className="wb-btn"
          style={{ background: "none", border: "none", color: C.faint, fontSize: 12, fontWeight: 650, cursor: "pointer" }}>마감 지우기</button>
        <Btn size="sm" kind="solid" onClick={onClose} icon={Check}>확인</Btn>
      </div>
    </div>
  );
}

const DueChip = ({ item, onClick }) => {
  const s = toneStyle(dueTone(item.due), item.done);
  return (
    <button onClick={onClick} className="wb-btn inline-flex items-center gap-1 rounded-full text-left"
      style={{ background: s.bg, color: s.fg, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", border: "none", cursor: "pointer", lineHeight: 1.5 }}>
      <Clock size={11.5} strokeWidth={2.5} className="shrink-0" />{dueText(item)}
    </button>
  );
};

/* 사업 › 세부사업 태그 */
const PathTag = ({ r, onClick }) => (
  <button onClick={onClick} className="wb-btn inline-flex items-center gap-1 rounded-full mb-1"
    style={{ background: "#F4F6F3", color: C.muted, border: "1px solid " + C.rule, cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", maxWidth: "100%" }}>
    <Dot color={r.pColor} size={7} />
    <span className="truncate" style={{ color: C.ink }}>{r.pName}</span>
    <ChevronRight size={10} strokeWidth={2.6} />
    <span className="truncate">{r.sName}</span>
  </button>
);

/* ------------------------------------------------------------------
   할 일 한 줄
------------------------------------------------------------------- */
/* ------------------------------------------------------------------
   하위 목록 — 드래그 정렬, Ctrl 조작
------------------------------------------------------------------- */
function SubItem({ item, handle, onToggle, onEdit, onDelete, onAddAfter, onMove, autoEdit }) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(item.text);

  const commit = () => {
    const t = draft.trim();
    if (t && t !== item.text) onEdit(t);
    if (!t) onDelete();
    return t;
  };
  const key = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault(); commit(); onMove(e.key === "ArrowUp" ? -1 : 1); return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const t = commit();
      if (mod && t) onAddAfter();
      else setEditing(false);
      return;
    }
    if (e.key === "Escape") { setDraft(item.text); setEditing(false); }
  };

  return (
    <div className="flex items-start gap-1.5" style={{ padding: "4px 0" }}>
      {handle && (
        <button {...handle} className="wb-btn shrink-0 flex items-center justify-center"
          style={{ ...handle.style, background: "none", border: "none", color: "#C9CFC7", padding: 0, width: 14, marginTop: 3 }}
          aria-label="하위 순서 바꾸기">
          <GripVertical size={13} strokeWidth={2} />
        </button>
      )}
      <button onClick={onToggle} className="wb-btn flex items-center justify-center rounded shrink-0"
        style={{ width: 17, height: 17, marginTop: 2, border: `1.6px solid ${item.done ? C.green : "#C6CCC5"}`,
          background: item.done ? C.green : "transparent", color: "#fff", cursor: "pointer" }}>
        {item.done && <Check size={11} strokeWidth={3.6} />}
      </button>
      {editing ? (
        <input value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
          onKeyDown={key} onBlur={() => { commit(); setEditing(false); }}
          className="flex-1 rounded-md"
          style={{ padding: "3px 7px", fontSize: 13.5, border: "1px solid " + C.rule, background: "#F7F8F6", outline: "none", color: C.ink, minWidth: 0 }} />
      ) : (
        <div {...editTrigger(() => { setDraft(item.text); setEditing(true); })} className="flex-1 min-w-0"
          style={{ fontSize: 13.5, lineHeight: 1.5, cursor: "text", wordBreak: "break-word",
            color: item.done ? C.faint : C.muted, textDecoration: item.done ? "line-through" : "none" }}>
          {item.text}
        </div>
      )}
      <button onClick={onDelete} className="wb-btn shrink-0"
        style={{ background: "none", border: "none", color: "#C6CCC5", cursor: "pointer", padding: "0 2px", marginTop: 1 }}>
        <X size={13} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function SubChecklist({ subs, onChange, hint = true }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");
  const [focusId, setFocusId] = useState(null);
  const list = subs || [];
  const done = list.filter((x) => x.done).length;

  const replace = (id, patch) => onChange(list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const move = (id, dir) => {
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addAfter = (id) => {
    const i = list.findIndex((x) => x.id === id);
    const item = { id: uid(), text: "", done: false };
    const next = list.slice();
    next.splice(i + 1, 0, item);
    onChange(next);
    setFocusId(item.id);
  };
  const addAtEnd = (keepOpen) => {
    const t = v.trim();
    if (!t) { setAdding(false); return; }
    onChange([...list, { id: uid(), text: t, done: false }]);
    setV("");
    setAdding(!!keepOpen);
  };

  return (
    <div style={{ marginTop: 8, paddingLeft: 2 }}>
      {list.length > 0 && (
        <div className="flex items-center gap-1.5 mb-1">
          <Label>하위 할 일</Label>
          <span style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>{done}/{list.length}</span>
        </div>
      )}

      <Sortable items={list} idOf={(x) => x.id} onReorder={onChange}
        renderRow={(it, handle) => (
          <SubItem item={it} handle={handle} autoEdit={focusId === it.id}
            onToggle={() => replace(it.id, { done: !it.done })}
            onEdit={(t) => replace(it.id, { text: t })}
            onDelete={() => onChange(list.filter((x) => x.id !== it.id))}
            onAddAfter={() => addAfter(it.id)}
            onMove={(d) => move(it.id, d)} />
        )} />

      {adding ? (
        <div className="flex items-center gap-1.5" style={{ padding: "4px 0" }}>
          <span style={{ width: 14 }} />
          <span className="rounded shrink-0" style={{ width: 17, height: 17, border: "1.6px dashed #C6CCC5" }} />
          <input value={v} autoFocus onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addAtEnd(e.ctrlKey || e.metaKey); return; }
              if (e.key === "Escape") { setV(""); setAdding(false); }
            }}
            onBlur={() => addAtEnd(false)} placeholder="하위 할 일 입력" className="flex-1 rounded-md"
            style={{ padding: "3px 7px", fontSize: 13.5, border: "1px solid " + C.rule, background: "#F7F8F6", outline: "none", color: C.ink, minWidth: 0 }} />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="wb-btn inline-flex items-center gap-1"
          style={{ background: "none", border: "none", color: C.faint, fontSize: 12, fontWeight: 650, cursor: "pointer", padding: "4px 0 0" }}>
          <Plus size={12} strokeWidth={2.6} /> 하위 할 일
        </button>
      )}

      {hint && (adding || list.length > 1) && (
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: 5, lineHeight: 1.5 }}>
          Ctrl+Enter 다음 항목 · Ctrl+↑↓ 순서 이동 · Enter 입력 마침
        </div>
      )}
    </div>
  );
}

function TodoRow({ todo, handle, onToggle, onPatch, onDelete, pathNode }) {
  const [editing, setEditing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const ref = useRef(null);
  return (
    <div style={{ padding: "10px 2px" }}>
      <div className="flex items-start gap-2">
        {handle && <Handle props={handle} />}
        <button onClick={onToggle} className="wb-btn flex items-center justify-center rounded-md shrink-0"
          style={{ width: 21, height: 21, marginTop: 2, border: `1.8px solid ${todo.done ? C.green : "#C6CCC5"}`,
            background: todo.done ? C.green : "transparent", color: "#fff", cursor: "pointer" }}>
          {todo.done && <Check size={14} strokeWidth={3.4} />}
        </button>
        <div className="flex-1 min-w-0">
          {pathNode}
          {typing ? (
            <textarea ref={ref} value={draft} autoFocus rows={Math.max(1, draft.split("\n").length)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setDraft(todo.text); setTyping(false); return; }
                if (e.key !== "Enter") return;
                if (e.altKey) {                        /* Alt+Enter — 줄 추가 */
                  e.preventDefault();
                  const el = ref.current, a = el.selectionStart, b = el.selectionEnd;
                  const next = draft.slice(0, a) + "\n" + draft.slice(b);
                  setDraft(next);
                  requestAnimationFrame(() => {
                    if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = a + 1;
                  });
                  return;
                }
                e.preventDefault();
                const t = draft.replace(/\s+$/, "");
                if (t && t !== todo.text) onPatch({ text: t });
                setTyping(false);
              }}
              onBlur={() => { const t = draft.replace(/\s+$/, ""); if (t && t !== todo.text) onPatch({ text: t }); setTyping(false); }}
              className="w-full rounded-lg"
              style={{ padding: "6px 8px", fontSize: 14.5, lineHeight: 1.45, color: C.ink, background: "#F7F8F6",
                border: "1px solid " + C.rule, outline: "none", resize: "none", fontFamily: FONT }} />
          ) : (
            <div {...editTrigger(() => { setDraft(todo.text); setTyping(true); })}
              title="더블클릭하면 수정됩니다"
              style={{ fontSize: 14.5, lineHeight: 1.45, color: todo.done ? C.faint : C.ink,
                textDecoration: todo.done ? "line-through" : "none", wordBreak: "break-word",
                whiteSpace: "pre-wrap", cursor: "text" }}>{todo.text}</div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <DueChip item={todo} onClick={() => setEditing(!editing)} />
            <button onClick={() => setOpen(!open)} className="wb-btn inline-flex items-center gap-1 rounded-full"
              style={{ background: "#F1F3F0", border: "none", color: C.muted, fontSize: 11,
                fontWeight: 700, padding: "3px 8px", cursor: "pointer" }}>
              <ChevronRight size={11} strokeWidth={2.6}
                style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
              세부정보
              {(todo.note ? 1 : 0) + (todo.subs || []).length > 0 && (
                <span style={{ color: C.navy }}>{(todo.subs || []).length ? (todo.subs || []).filter((x) => x.done).length + "/" + (todo.subs || []).length : "•"}</span>
              )}
            </button>
          </div>
          {editing && <DueEditor value={todo} onChange={onPatch} onClose={() => setEditing(false)} />}

          {!open && todo.note && (
            <div className="truncate" style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>{todo.note}</div>
          )}

          {open && (
            <div className="rounded-xl" style={{ background: "#F7F8F6", border: "1px solid " + C.rule,
              padding: "9px 11px", marginTop: 7 }}>
              <Label>세부정보</Label>
              <textarea value={todo.note || ""} onChange={(e) => onPatch({ note: e.target.value })}
                rows={Math.max(2, String(todo.note || "").split("\n").length)}
                placeholder="자세한 내용을 적어 두세요" className="w-full rounded-lg mt-1.5"
                style={{ padding: "7px 9px", fontSize: 13, lineHeight: 1.55, color: C.ink, background: C.surface,
                  border: "1px solid " + C.rule, outline: "none", resize: "vertical", fontFamily: FONT }} />
              <SubChecklist subs={todo.subs || []} onChange={(next) => onPatch({ subs: next })} />
            </div>
          )}
        </div>
        {onDelete && <DeleteBtn onDelete={onDelete} label="" />}
      </div>
    </div>
  );
}

const AddLine = ({ placeholder, onAdd }) => {
  const [v, setV] = useState("");
  const submit = () => { const t = v.trim(); if (!t) return; onAdd(t); setV(""); };
  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={placeholder}
        className="flex-1 rounded-xl" style={{ padding: "11px 13px", fontSize: 14.5, color: C.ink, background: "#F7F8F6", border: "1px solid " + C.rule, outline: "none", minWidth: 0 }} />
      <Btn kind="solid" icon={Plus} onClick={submit}>추가</Btn>
    </div>
  );
};

/* ------------------------------------------------------------------
   결재란 도장판
------------------------------------------------------------------- */
const StampCell = ({ name, checked, onToggle }) => (
  <button onClick={onToggle} className="wb-btn relative flex flex-col items-center justify-center rounded-xl"
    style={{ height: 86, background: checked ? C.surface : "#F7F8F6", border: checked ? `1px solid ${C.rule}` : `1px dashed #CFD5CD`, cursor: "pointer" }}>
    <span style={{ position: "absolute", top: 7, left: 0, right: 0, textAlign: "center", fontSize: 10.5, letterSpacing: "0.06em", fontWeight: 700, color: checked ? C.ink : C.faint }}>{name}</span>
    {checked ? (
      <span className="wb-stamp flex items-center justify-center rounded-full" style={{ width: 40, height: 40, marginTop: 12, border: `2.5px solid ${C.seal}`, color: C.seal }}>
        <Check size={20} strokeWidth={3.2} />
      </span>
    ) : <span className="rounded-full" style={{ width: 40, height: 40, marginTop: 12, border: "1.5px dashed #D6DBD5" }} />}
  </button>
);

const DocPanel = ({ sub, onToggleDoc, onSetDocMode }) => {
  const mode = docModeOf(sub);
  const list = docListOf(sub);
  const left = list.filter((d) => !sub.docs?.[d]);

  return (
    <Card style={{ padding: 16 }}>
      <Label>필수 행정서류</Label>
      <div className="flex items-center gap-2 mt-1.5 mb-3 flex-wrap">
        {mode === "none" ? <Chip tone="neutral" icon={FileX}>해당 없음</Chip>
          : left.length === 0 ? <Chip tone="green" icon={Check}>서류 완비</Chip>
          : <Chip tone="seal">{left.length}건 남음</Chip>}
        <span style={{ fontSize: 12.5, color: C.muted }}>
          {mode === "none" ? "이 사업은 서류를 갖추지 않아도 됩니다"
            : left.length === 0 ? "빠진 서류가 없습니다" : left.join(" · ")}
        </span>
      </div>

      <div className="flex rounded-xl" style={{ background: "#F1F3F0", padding: 3, gap: 3 }}>
        {[
          { v: "none", t: "해당 없음", i: FileX, n: 0 },
          { v: "plain", t: "지출 없음", i: WalletMinimal, n: 2 },
          { v: "expense", t: "지출 있음", i: Wallet, n: 6 },
        ].map((o) => {
          const on = mode === o.v;
          return (
            <button key={o.v} onClick={() => onSetDocMode(o.v)} className="wb-btn flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg"
              style={{ padding: "8px 4px", background: on ? C.surface : "transparent", color: on ? C.ink : C.faint,
                border: on ? "1px solid " + C.rule : "1px solid transparent", cursor: "pointer" }}>
              <o.i size={15} strokeWidth={2.3} />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{o.t}</span>
              <span style={{ fontSize: 10.5, color: on ? C.faint : "#B7BEB8", fontWeight: 650 }}>
                {o.n === 0 ? "서류 없음" : o.n + "종"}
              </span>
            </button>
          );
        })}
      </div>

      {list.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 8, marginTop: 14 }}>
          {list.map((d) => <StampCell key={d} name={d} checked={!!sub.docs?.[d]} onToggle={() => onToggleDoc(d)} />)}
        </div>
      )}
    </Card>
  );
};

/* ------------------------------------------------------------------
   잠금 화면
------------------------------------------------------------------- */
function LockScreen({ onOpen }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true); setMsg("");
    const ok = await onOpen(pw);
    if (!ok) { setMsg("비밀번호가 맞지 않습니다"); setPw(""); }
    setBusy(false);
  };

  return (
    <div style={{ fontFamily: FONT, background: C.bg, minHeight: "100dvh" }}
      className="flex items-center justify-center">
      <Card style={{ padding: 24, maxWidth: 340, width: "100%", margin: 18 }}>
        <div className="flex items-center justify-center rounded-full"
          style={{ width: 46, height: 46, background: C.navySoft, color: C.navy, margin: "0 auto 14px" }}>
          <Lock size={21} strokeWidth={2.2} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 780, textAlign: "center", letterSpacing: "-0.02em" }}>업무보드</div>
        <div style={{ fontSize: 12.5, color: C.muted, textAlign: "center", marginTop: 4, lineHeight: 1.55 }}>
          비밀번호를 넣어야 내용을 볼 수 있습니다
        </div>
        <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-xl" style={{ marginTop: 16, padding: "11px 13px", fontSize: 15,
            border: "1px solid " + C.rule, background: "#F7F8F6", outline: "none", color: C.ink, textAlign: "center" }} />
        {msg && <div style={{ fontSize: 12, color: C.seal, textAlign: "center", marginTop: 8, fontWeight: 650 }}>{msg}</div>}
        <div style={{ marginTop: 12 }}>
          <Btn kind="solid" full icon={busy ? RefreshCw : Check} onClick={submit} disabled={busy}>
            {busy ? "여는 중" : "열기"}
          </Btn>
        </div>
        <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6, marginTop: 14 }}>
          비밀번호를 잊으면 내용을 되살릴 수 없습니다. 백업 파일을 따로 보관해 두세요.
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------
   메인보드
------------------------------------------------------------------- */
function HomeView({ data, rows, events, onDone, onEditTodo, onOpenSub, onOpenProject, onGo, onAddMemo }) {
  const [now, setNow] = useState(new Date());
  const [showMissed, setShowMissed] = useState(false);
  const [editNow, setEditNow] = useState(false);
  const [draftNow, setDraftNow] = useState("");
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);

  const hh = now.getHours();
  const greet = hh < 6 ? "늦은 밤입니다" : hh < 11 ? "좋은 아침입니다" : hh < 14 ? "점심 무렵입니다" : hh < 18 ? "오후 업무 중입니다" : "하루를 마무리할 시간입니다";
  const dateStr = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const timeStr = now.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

  const sorted = [...rows].sort((a, b) => bucketOf(a) - bucketOf(b) || sortKey(a).localeCompare(sortKey(b)));
  const missed = sorted.filter(isPast);
  const upcoming = sorted.filter((r) => !isPast(r));
  const nowTodo = upcoming[0] || null;
  const nextUp = upcoming.slice(1, 4);

  const overdue = rows.filter((r) => dayDiff(r.due) < 0);
  const today = rows.filter((r) => dayDiff(r.due) === 0);
  const week = rows.filter((r) => dayDiff(r.due) > 0 && dayDiff(r.due) <= 7);
  const totalDocLeft = data.projects.reduce((a, p) => a + p.subs.reduce((b, s) => { const st = subStats(s); return b + (st.docTotal - st.docDone); }, 0), 0);

  /* 사업별로 묶은 진행 중 세부사업 */
  const byProject = data.projects.map((p, i) => ({
    p, color: colorOf(p, i),
    subs: p.subs.filter((s) => !isInbox(s) && !subDoneAll(s)).map((s) => {
      const st = subStats(s);
      return { s, st, left: st.total - st.done };
    }),
  })).filter((x) => x.subs.length > 0);

  /* 오늘부터 앞으로 5일치 — 업무와 일정을 함께 */
  const planRows = (events || []).map((e) => {
    const i = data.projects.findIndex((p) => p.id === e.pid);
    return { id: e.id, kind: "event", text: e.title, due: e.date, dueTime: e.start || "", dueEnd: e.end || "",
      place: e.place, pid: e.pid || "", sName: "",
      pName: i >= 0 ? data.projects[i].name : "센터 일정",
      pColor: i >= 0 ? colorOf(data.projects[i], i) : "#5A6673" };
  });
  const counselRows = (data.resv || []).map((r) => {
    const c = (data.clients || []).find((x) => x.id === r.clientId);
    return { id: r.id, kind: "counsel", text: (c ? c.name : "상담") + " · " + r.type,
      due: r.date, dueTime: r.start || "", dueEnd: r.end || "", place: "", pid: "", sName: "",
      pName: "상담", pColor: C.green };
  });
  const merged = [...rows.map((r) => ({ ...r, kind: "todo" })), ...planRows, ...counselRows];

  const agenda = (() => {
    const out = [];
    for (let k = 0; k < 6; k++) {
      const d = new Date(now);
      d.setDate(d.getDate() + k);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      const iso = d.toISOString().slice(0, 10);
      const items = merged.filter((r) => r.due === iso && !(k === 0 && isPast(r)))
        .sort((a, b) => (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99"));
      if (!items.length) continue;
      const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(iso + "T00:00:00").getDay()];
      out.push({ iso, items,
        label: Number(iso.slice(5, 7)) + "월 " + Number(iso.slice(8, 10)) + "일 (" + wd + ")" + (k === 0 ? ", 오늘" : k === 1 ? ", 내일" : "") });
    }
    return out.slice(0, 5);
  })();

  const monday = (() => {
    const d = new Date(now);
    const wd = (d.getDay() + 6) % 7;         /* 월=0 */
    d.setDate(d.getDate() - wd);
    return d;
  })();
  const days = [0, 1, 2, 3, 4].map((k) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + k);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    const iso = d.toISOString().slice(0, 10);
    const items = rows.filter((r) => r.due === iso)
      .sort((a, b) => (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99"));
    return { iso, label: ["월", "화", "수", "목", "금"][k], num: Number(iso.slice(8, 10)), items, isToday: iso === todayISO() };
  });

  const Stat = ({ n, t, tone, onClick }) => {
    const s = toneStyle(tone === "seal" ? "over" : tone === "amber" ? "soon" : "later", false);
    return (
      <button onClick={onClick} className="wb-btn flex-1 rounded-xl"
        style={{ background: n > 0 ? s.bg : "#F4F6F3", border: "none", padding: "9px 5px", cursor: "pointer" }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: n > 0 ? s.fg : C.faint, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{n}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: n > 0 ? s.fg : C.faint, marginTop: 2, opacity: 0.85 }}>{t}</div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 시계 */}
      <div className="rounded-2xl" style={{ background: C.navy, color: "#fff", padding: "16px 18px 14px" }}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", fontWeight: 700, opacity: 0.6 }}>{greet}</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{timeStr}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, opacity: 0.78, lineHeight: 1.5 }}>{dateStr}</div>
        </div>
      </div>

      {/* 지금 할 일 하나 */}
      <Card style={{ padding: "16px 17px" }}>
        <Label>지금 할 일</Label>
        {!nowTodo ? (
          <div style={{ fontSize: 14, color: C.faint, padding: "14px 0 4px" }}>남은 할 일이 없습니다</div>
        ) : (
          <>
            <div className="flex items-start gap-3" style={{ marginTop: 8 }}>
              <button onClick={() => onDone(nowTodo)} className="wb-btn flex items-center justify-center rounded-lg shrink-0"
                style={{ width: 26, height: 26, marginTop: 2, border: "2px solid #C6CCC5", background: "transparent", cursor: "pointer" }} />
              <div className="flex-1 min-w-0">
                {editNow ? (
                  <textarea value={draftNow} autoFocus rows={Math.max(1, draftNow.split("\n").length)}
                    onChange={(e) => setDraftNow(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setEditNow(false); return; }
                      if (e.key !== "Enter" || e.altKey) return;
                      e.preventDefault();
                      const t = draftNow.trim();
                      if (t) onEditTodo(nowTodo.pid, nowTodo.sid, nowTodo.id, t);
                      setEditNow(false);
                    }}
                    onBlur={() => { const t = draftNow.trim(); if (t) onEditTodo(nowTodo.pid, nowTodo.sid, nowTodo.id, t); setEditNow(false); }}
                    className="w-full rounded-lg"
                    style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.35, color: C.ink, background: "#F7F8F6",
                      border: "1px solid " + C.rule, outline: "none", resize: "none", padding: "5px 7px", fontFamily: FONT }} />
                ) : (
                  <div onClick={() => { setDraftNow(nowTodo.text); setEditNow(true); }}
                    style={{ fontSize: 19, fontWeight: 750, lineHeight: 1.35, letterSpacing: "-0.02em",
                      wordBreak: "break-word", whiteSpace: "pre-wrap", cursor: "text" }}>{nowTodo.text}</div>
                )}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <BucketTag item={nowTodo} />
                  {timeText(nowTodo) && (
                    <span style={{ fontSize: 11.5, fontWeight: 750, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                      {timeText(nowTodo)}
                    </span>
                  )}
                  <button onClick={() => onOpenSub(nowTodo.pid, nowTodo.sid)} className="wb-btn inline-flex items-center gap-1 rounded-full"
                    style={{ background: "#F4F6F3", border: "1px solid " + C.rule, cursor: "pointer",
                      fontSize: 10.5, fontWeight: 700, padding: "2px 8px", maxWidth: "100%", color: C.ink }}>
                    <Dot color={nowTodo.pColor} size={6} />
                    <span className="truncate">{nowTodo.pName}</span>
                  </button>
                </div>
              </div>
            </div>

            {missed.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button onClick={() => setShowMissed(!showMissed)} className="wb-btn w-full flex items-center gap-1.5"
                  style={{ background: "none", border: "none", padding: "6px 0 0", cursor: "pointer" }}>
                  <AlertTriangle size={12} color={C.seal} strokeWidth={2.5} />
                  <Label style={{ color: C.seal }}>놓친 할 일 {missed.length}</Label>
                  <ChevronRight size={13} color={C.faint}
                    style={{ marginLeft: "auto", transform: showMissed ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
                </button>
                {showMissed && missed.map((r) => (
                  <div key={r.id} className="flex items-center gap-2" style={{ padding: "4px 0" }}>
                    <button onClick={() => onDone(r)} className="wb-btn flex items-center justify-center rounded shrink-0"
                      style={{ width: 14, height: 14, border: "1.5px solid #C6CCC5", background: "transparent", cursor: "pointer" }} />
                    <span className="flex-1 min-w-0 truncate" style={{ fontSize: 12.5, color: C.muted }}>{r.text}</span>
                    <span className="shrink-0" style={{ fontSize: 10, color: C.seal, fontWeight: 750 }}>
                      {fmtDateShort(r.due)}{r.dueTime ? " " + r.dueTime : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {nextUp.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid " + C.rule, paddingTop: 9 }}>
                <Label style={{ fontSize: 9.5 }}>다음 예정</Label>
                {nextUp.map((r) => (
                  <div key={r.id} className="flex items-center gap-2" style={{ padding: "4px 0" }}>
                    <Dot color={r.pColor} size={5} />
                    <span className="flex-1 min-w-0 truncate" style={{ fontSize: 12.5, color: C.muted }}>{r.text}</span>
                    {timeText(r) && (
                      <span className="shrink-0" style={{ fontSize: 10.5, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{timeText(r)}</span>
                    )}
                    <span className="shrink-0" style={{ fontSize: 10, fontWeight: 750, color: BUCKETS[bucketOf(r)].fg }}>
                      {BUCKETS[bucketOf(r)].t}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* 오늘의 비서 */}
      <Card style={{ padding: "13px 14px" }}>
        <div className="flex items-center gap-2 mb-2">
          <Sunrise size={14} color={C.navy} strokeWidth={2.3} />
          <Label>오늘의 비서</Label>
          <button onClick={() => onGo("plan")} className="wb-btn inline-flex items-center"
            style={{ background: "none", border: "none", color: C.faint, fontSize: 11, fontWeight: 650, cursor: "pointer", marginLeft: "auto" }}>
            일정 전체 <ChevronRight size={12} />
          </button>
        </div>
        {agenda.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.faint, padding: "8px 0" }}>앞으로 예정된 일정이 없습니다</div>
        ) : agenda.map((g) => (
          <div key={g.iso} style={{ marginTop: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, padding: "7px 0 3px" }}>
              {g.label}
            </div>
            {g.items.map((r) => {
              const ev = r.kind === "event";
              const cs = r.kind === "counsel";
              return (
                <button key={r.id} onClick={() => (cs ? onGo("counsel") : ev ? onGo("plan") : onOpenSub(r.pid, r.sid))}
                  className="wb-btn w-full flex items-start gap-2 text-left"
                  style={{ background: ev ? "rgba(36,72,107,0.045)" : "none", border: "none",
                    borderTop: "1px solid " + C.rule, borderRadius: ev ? 8 : 0,
                    padding: ev ? "7px 8px" : "7px 0", cursor: "pointer" }}>
                  <span className="shrink-0 rounded" style={{ width: ev ? 5 : 3, height: 15,
                    background: r.pColor, marginTop: 2 }} />
                  {r.dueTime && (
                    <span className="shrink-0" style={{ fontSize: 12, fontWeight: 750, color: C.ink,
                      fontVariantNumeric: "tabular-nums", minWidth: 38 }}>{r.dueTime}</span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded" style={{ fontSize: 8.5, fontWeight: 800, padding: "1px 4px",
                        background: cs ? C.greenSoft : ev ? "rgba(36,72,107,0.12)" : "rgba(26,33,30,0.07)",
                        color: cs ? C.green : C.muted }}>
                        {cs ? "상담" : ev ? "일정" : "업무"}
                      </span>
                      <span className="truncate" style={{ fontSize: 12.5, color: C.ink,
                        fontWeight: ev ? 700 : 400 }}>{r.text}</span>
                    </span>
                    <span className="block truncate" style={{ fontSize: 10, color: C.faint }}>
                      {cs ? ORG
                        : ev ? (r.pName === "센터 일정" ? "센터 일정" : shortName(r.pName) + " 일정") + (r.place ? " · " + r.place : "")
                        : shortName(r.pName) + " · " + r.sName}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </Card>

      {/* 진행 중인 세부사업 — 사업별 */}
      <Card style={{ padding: "13px 14px" }}>
        <div className="flex items-center gap-2 mb-2">
          <FolderClosed size={14} color={C.navy} strokeWidth={2.3} />
          <Label>진행 중인 세부사업</Label>
          <button onClick={() => onGo("projects")} className="wb-btn inline-flex items-center"
            style={{ background: "none", border: "none", color: C.faint, fontSize: 11, fontWeight: 650, cursor: "pointer", marginLeft: "auto" }}>
            전체 사업 <ChevronRight size={12} />
          </button>
        </div>
        {byProject.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.faint, padding: "8px 0" }}>진행 중인 세부사업이 없습니다</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {byProject.map(({ p, color, subs }) => (
              <div key={p.id}>
                <button onClick={() => onOpenProject(p.id)} className="wb-btn flex items-center gap-1.5 mb-1"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  <Dot color={color} size={7} />
                  <span style={{ fontSize: 12.5, fontWeight: 780 }}>{p.name}</span>
                  <span style={{ fontSize: 10.5, color: C.faint, fontWeight: 700 }}>{subs.length}</span>
                </button>
                {subs.map(({ s, st, left }) => (
                  <button key={s.id} onClick={() => onOpenSub(p.id, s.id)} className="wb-btn w-full flex items-center gap-2"
                    style={{ background: "none", border: "none", padding: "3px 0 3px 15px", cursor: "pointer", textAlign: "left" }}>
                    <span className="truncate" style={{ fontSize: 12.5, color: C.ink, flex: 1 }}>{s.name}</span>
                    {s.end && (
                      <span className="shrink-0" style={{ fontSize: 10, fontWeight: 750,
                        color: dayDiff(s.end) <= 3 ? C.amber : C.faint }}>{dLabel(s.end)}</span>
                    )}
                    <span className="shrink-0 rounded" style={{ fontSize: 10, fontWeight: 750, padding: "1px 5px",
                      background: left === 0 ? C.greenSoft : "#F1F3F0", color: left === 0 ? C.green : C.muted,
                      fontVariantNumeric: "tabular-nums" }}>
                      {st.done}/{st.total}
                    </span>
                    <span className="shrink-0" style={{ width: 44 }}><Bar pct={st.pct} color={color} /></span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 빠른 입력 */}
      <Card style={{ padding: 13 }}>
        <div className="flex items-center gap-2 mb-2"><Inbox size={14} color={C.navy} strokeWidth={2.3} /><Label>생각나는 대로 담기</Label></div>
        <AddLine placeholder="잊기 전에 적어 두세요" onAdd={onAddMemo} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------
   메인
------------------------------------------------------------------- */
export default function WorkBoard() {
  const [data, setDataRaw] = useState({ projects: [], memos: [], notes: [], dueOrder: [], topOrder: [], planHidden: [], events: [], clients: [], resv: [], resvTypes: [], contacts: [], dueManual: false, updatedAt: 0 });
  const [loaded, setLoaded] = useState(false);
  const [needPw, setNeedPw] = useState(false);
  const keyRef = useRef(null);
  const [storageOK, setStorageOK] = useState(true);
  const [sync, setSync] = useState(() => loadSync());
  const [syncState, setSyncState] = useState("off");   // off | syncing | ok | error
  const [syncMsg, setSyncMsg] = useState("");
  const [lastBackup, setLastBackup] = useState(() => Number(localStorage.getItem(BACKUP_KEY) || 0));
  const [tab, setTab] = useState(() => (["home", "projects", "plan", "counsel", "notes", "contacts"].includes(lastView().tab) ? lastView().tab : "home"));
  const [openProject, setOpenProject] = useState(() => lastView().pid || null);
  const [openSub, setOpenSub] = useState(() => lastView().sid || null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);
  const dataRef = useRef(data); dataRef.current = data;
  const syncRef = useRef(sync); syncRef.current = sync;
  const lastPushed = useRef("");

  /* 모든 변경은 시각 도장을 찍습니다 — 어느 쪽이 최신인지 가리는 기준 */
  const setData = (arg) => setDataRaw((prev) => {
    const next = typeof arg === "function" ? arg(prev) : arg;
    return { ...next, updatedAt: Date.now() };
  });

  const normalize = (p) => ({
    projects: p.projects || [], memos: p.memos || [], notes: p.notes || [], dueOrder: p.dueOrder || [], topOrder: p.topOrder || [], planHidden: p.planHidden || [], events: p.events || [], clients: p.clients || [], resv: p.resv || [], resvTypes: p.resvTypes || [], contacts: p.contacts || [],
    dueManual: !!p.dueManual, updatedAt: p.updatedAt || 0,
  });

  const pull = async (cfg, base) => {
    if (!syncReady(cfg)) return;
    setSyncState("syncing"); setSyncMsg("");
    try {
      if (cfg.mode === "gdrive" && !gSignedIn()) {
        try { await gToken(cfg.clientId, false); }
        catch (e) { setSyncState("signin"); setSyncMsg("구글 로그인이 필요합니다"); return; }
      }
      let remote = await remoteGet(cfg);
      if (typeof remote === "string" && isSealed(remote)) {
        if (!keyRef.current) { setSyncState("error"); setSyncMsg("잠금이 걸려 있습니다"); return; }
        remote = JSON.parse(await openText(keyRef.current, remote));
      }
      const mine = base || dataRef.current;
      if (remote && (remote.updatedAt || 0) > (mine.updatedAt || 0)) {
        const n = normalize(remote);
        lastPushed.current = JSON.stringify(n);
        setDataRaw(n);
        await store.set(JSON.stringify(n));
        setSyncState("ok"); setSyncMsg("다른 기기에서 바뀐 내용을 받았습니다");
        setTimeout(() => setSyncMsg(""), 4000);
      } else if (!remote || (mine.updatedAt || 0) > (remote.updatedAt || 0)) {
        await remotePut(cfg, mine);
        lastPushed.current = JSON.stringify(mine);
        setSyncState("ok");
      } else {
        setSyncState("ok");
      }
      const n = { ...syncRef.current, lastAt: Date.now() };
      saveSync(n); setSync(n);
    } catch (e) {
      setSyncState("error"); setSyncMsg(e.message || "연결하지 못했습니다");
    }
  };

  /* 최초 불러오기 */
  useEffect(() => {
    (async () => {
      let local = null;
      try {
        const raw = await store.get();
        if (raw && isSealed(raw)) { setNeedPw(true); setLoaded(true); return; }
        if (raw) local = normalize(JSON.parse(raw));
      } catch (e) {}
      if (local) setDataRaw(local);
      setLoaded(true);
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
      if (syncReady(syncRef.current)) pull(syncRef.current, local || undefined);
    })();
  }, []);

  /* 저장 — 이 기기에 먼저, 이어서 클라우드로 */
  useEffect(() => {
    if (!loaded || needPw) return;          /* 잠긴 동안에는 덮어쓰지 않습니다 */
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const plain = JSON.stringify(data);
      const json = keyRef.current ? await sealText(keyRef.current, plain) : plain;
      try { setStorageOK(await store.set(json)); } catch (e) { setStorageOK(false); }
      const cfg = syncRef.current;
      if (syncReady(cfg) && json !== lastPushed.current) {
        if (cfg.mode === "gdrive" && !gSignedIn()) {
          try { await gToken(cfg.clientId, false); }
          catch (e) { setSyncState("signin"); setSyncMsg("구글 로그인이 필요합니다"); return; }
        }
        setSyncState("syncing");
        try {
          await remotePut(cfg, keyRef.current ? await sealText(keyRef.current, plain) : data);
          lastPushed.current = json;
          setSyncState("ok"); setSyncMsg("");
        } catch (e) { setSyncState("error"); setSyncMsg(e.message || "연결하지 못했습니다"); }
      }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [data, loaded, needPw]);

  /* 앱으로 돌아올 때, 주기적으로, 그리고 인터넷이 돌아왔을 때 최신 내용 확인 */
  useEffect(() => {
    if (!loaded) return;
    if (!syncReady(sync)) { setSyncState("off"); return; }
    const check = () => { if (!document.hidden && syncReady(syncRef.current)) pull(syncRef.current); };
    const onOnline = () => { lastPushed.current = ""; check(); };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("online", onOnline);
    const iv = setInterval(check, 90000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", onOnline);
      clearInterval(iv);
    };
  }, [loaded, sync.mode, sync.url, sync.key, sync.code, sync.clientId]);

  /* 구글 토큰이 만료되기 전에 미리 조용히 새로 받아 둡니다 */
  useEffect(() => {
    if (!loaded || sync.mode !== "gdrive" || !sync.clientId) return;
    const tick = async () => {
      if (document.hidden) return;
      if (gSignedIn()) return;
      try { await gToken(sync.clientId, false); setSyncState((s) => (s === "signin" ? "ok" : s)); }
      catch (e) { setSyncState("signin"); setSyncMsg("구글 로그인이 필요합니다"); }
    };
    const iv = setInterval(tick, 240000);
    return () => clearInterval(iv);
  }, [loaded, sync.mode, sync.clientId]);

  /* 예정 시각이 되면 알려 줍니다 (앱이 열려 있는 동안) */
  useEffect(() => {
    if (!loaded || !notiSupported() || !notiOn()) return;
    const tick = () => {
      if (Notification.permission !== "granted") return;
      const t = todayISO();
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      data.projects.forEach((p) => p.subs.forEach((s2) => s2.todos.forEach((td) => {
        if (td.done || td.due !== t || !td.dueTime) return;
        const [h, m] = td.dueTime.split(":").map(Number);
        const at = h * 60 + m;
        if (at < mins || at > mins + 1) return;
        const key = td.id + "@" + t + " " + td.dueTime;
        if (notiFired.has(key)) return;
        notiFired.add(key);
        try {
          new Notification(td.dueTime + "  " + p.name, { body: td.text, icon: "icon-192.png", tag: key });
        } catch (e) {}
      })));
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
  }, [loaded, data]);

  /* 지금 보고 있는 화면을 기억합니다 — 새로고침해도 그 자리로 돌아옵니다 */
  useEffect(() => {
    if (!loaded || needPw) return;
    saveView({ tab, pid: openProject, sid: openSub });
  }, [loaded, tab, openProject, openSub]);

  /* 기억해 둔 사업이 그새 지워졌다면 목록으로 되돌립니다 */
  useEffect(() => {
    if (!loaded || tab !== "projects") return;
    const p = data.projects.find((x) => x.id === openProject);
    if (openProject && !p) { setOpenProject(null); setOpenSub(null); return; }
    if (openSub && p && !p.subs.some((x) => x.id === openSub)) setOpenSub(null);
  }, [loaded, tab, data.projects, openProject, openSub]);

  const signInGoogle = async () => {
    const cfg = syncRef.current;
    if (!cfg.clientId) return;
    setSyncState("syncing"); setSyncMsg("");
    try {
      await gToken(cfg.clientId, true);
      await pull(cfg);
      flash("구글 계정에 연결했습니다");
    } catch (e) {
      setSyncState("signin"); setSyncMsg(e.message || "로그인하지 못했습니다");
      flash(e.message || "로그인하지 못했습니다");
    }
  };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(dataRef.current)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `업무보드_백업_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    setLastBackup(Date.now());
    flash("백업 파일을 내려받았습니다");
  };

  const flash = (msg, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 5000 : 2200);
  };

  const setProjects = (fn) => setData((d) => ({ ...d, projects: fn(d.projects) }));
  const mapProject = (pid, fn) => setProjects((ps) => ps.map((p) => (p.id === pid ? fn(p) : p)));
  const mapSub = (pid, sid, fn) => mapProject(pid, (p) => ({ ...p, subs: p.subs.map((s) => (s.id === sid ? fn(s) : s)) }));
  const patchTodo = (pid, sid, tid, patch) => mapSub(pid, sid, (s) => ({ ...s, todos: s.todos.map((t) => (t.id === tid ? { ...t, ...patch } : t)) }));

  const addProject = (name) => setProjects((ps) => [...ps, { id: uid(), name, color: PALETTE[ps.length % PALETTE.length], subs: [], createdAt: Date.now() }]);
  const addSub = (pid, name) => mapProject(pid, (p) => ({
    ...p,
    subs: [...p.subs, { id: uid(), name, start: "", end: "",
      docMode: "plain", hasExpense: false, docs: {}, todos: [], createdAt: Date.now() }],
  }));
  const addTodo = (pid, sid, text, due = "", dueTime = "", dueEnd = "") =>
    mapSub(pid, sid, (s) => ({ ...s, todos: [...s.todos, { id: uid(), text, due, dueTime, dueEnd, done: false, createdAt: Date.now() }] }));
  /* 세부사업을 아직 안 정한 할 일은 '미분류' 보관함에 담깁니다 */
  const quickTodo = (pid, text) => mapProject(pid, (p) => {
    const item = { id: uid(), text, due: "", dueTime: "", dueEnd: "", done: false, createdAt: Date.now() };
    const box = p.subs.find(isInbox);
    if (box) return { ...p, subs: p.subs.map((s2) => (s2.id === box.id ? { ...s2, todos: [...s2.todos, item] } : s2)) };
    return { ...p, subs: [{ id: uid(), name: "미분류", inbox: true, start: "", end: "", docMode: "none",
      hasExpense: false, docs: {}, todos: [item], createdAt: Date.now() }, ...p.subs] };
  });

  /* 할 일을 세부사업으로 옮깁니다 */
  const assignTodo = (pid, fromSid, tid, toSid) => mapProject(pid, (p) => {
    const from = p.subs.find((x) => x.id === fromSid);
    const item = from && from.todos.find((t) => t.id === tid);
    if (!item) return p;
    return { ...p, subs: p.subs.map((s2) =>
      s2.id === fromSid ? { ...s2, todos: s2.todos.filter((t) => t.id !== tid) }
      : s2.id === toSid ? { ...s2, todos: [...s2.todos, item] } : s2) };
  });

  /* 새 세부사업을 만들고 그 id를 돌려줍니다 */
  const createSub = (pid, name) => {
    const id = uid();
    mapProject(pid, (p) => ({ ...p, subs: [...p.subs, { id, name,
      start: "", end: "", docMode: "plain", hasExpense: false, docs: {}, todos: [], createdAt: Date.now() }] }));
    return id;
  };

  const seedProjects = (names) =>
    setProjects((ps) => [...ps, ...names.map((n, i) => ({
      id: uid(), name: n, color: PALETTE[(ps.length + i) % PALETTE.length], subs: [], createdAt: Date.now() + i,
    }))]);

  const addMemo = (text, due = "", dueTime = "", dueEnd = "") =>
    setData((d) => ({ ...d, memos: [...d.memos, { id: uid(), text, due, dueTime, dueEnd, createdAt: Date.now() }] }));

  const addNote = (n) => setData((d) => ({
    ...d,
    notes: [{
      id: uid(),
      title: n.title || "",
      text: n.text || "",
      html: n.html !== undefined ? n.html : escapeHtml(n.text || ""),
      mode: n.mode || "text",
      items: n.items || [],
      color: n.color || "",
      important: !!n.important,
      pid: n.pid || "",
      createdAt: Date.now(), updatedAt: Date.now(),
    }, ...(d.notes || [])],
  }));

  const patchNote = (id, patch) =>
    setData((d) => ({ ...d, notes: (d.notes || []).map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) }));
  const removeNote = (n) => {
    const idx = (data.notes || []).findIndex((x) => x.id === n.id);
    setData((d) => ({ ...d, notes: (d.notes || []).filter((x) => x.id !== n.id) }));
    flash("메모를 지웠습니다", () => setData((d) => {
      const arr = (d.notes || []).slice();
      arr.splice(Math.min(idx, arr.length), 0, n);
      return { ...d, notes: arr };
    }));
  };

  const removeMemo = (m, msg) => {
    const idx = data.memos.findIndex((x) => x.id === m.id);
    setData((d) => ({ ...d, memos: d.memos.filter((x) => x.id !== m.id) }));
    flash(msg, () => setData((d) => { const arr = d.memos.slice(); arr.splice(Math.min(idx, arr.length), 0, m); return { ...d, memos: arr }; }));
  };


  const projectIdx = data.projects.findIndex((p) => p.id === openProject);
  const project = projectIdx >= 0 ? data.projects[projectIdx] : null;
  const sub = project?.subs.find((s) => s.id === openSub) || null;

  const dueRows = useMemo(() => {
    const rows = [];
    data.projects.forEach((p, i) => p.subs.forEach((s) => s.todos.forEach((t) => {
      if (!t.done && t.due) rows.push({ ...t, pid: p.id, sid: s.id, pName: p.name, sName: s.name, pColor: colorOf(p, i),
        hl: isInbox(s) ? "" : subColor(s, liveSubs(p).findIndex((x) => x.id === s.id), colorOf(p, i)) });
    })));
    if (data.dueManual) {
      const rank = new Map(data.dueOrder.map((id, i) => [id, i]));
      return rows.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9) || byTime(a, b));
    }
    return rows.sort(byTime);
  }, [data]);

  /* 메인보드는 날짜가 없는 할 일도 포함합니다 */
  const homeRows = useMemo(() => {
    const rows = [];
    data.projects.forEach((p, i) => p.subs.forEach((s) => s.todos.forEach((t) => {
      if (!t.done) rows.push({ ...t, pid: p.id, sid: s.id, pName: p.name, sName: s.name, pColor: colorOf(p, i),
        hl: isInbox(s) ? "" : subColor(s, liveSubs(p).findIndex((x) => x.id === s.id), colorOf(p, i)) });
    })));
    const rank = new Map((data.topOrder || []).map((id, i) => [id, i]));
    const pos = (x) => (rank.has(x.id) ? rank.get(x.id) : 1e9);
    return rows.sort((a, b) => bucketOf(a) - bucketOf(b) || pos(a) - pos(b) || sortKey(a).localeCompare(sortKey(b)));
  }, [data]);
  const overdue = dueRows.filter((t) => dayDiff(t.due) < 0).length;
  const projectPct = (p) => {
    const agg = p.subs.reduce((a, s) => { const st = subStats(s); return { d: a.d + st.done, t: a.t + st.total }; }, { d: 0, t: 0 });
    return agg.t ? Math.round((agg.d / agg.t) * 100) : 0;
  };

  const hasContent = data.projects.length > 0 || data.memos.length > 0;
  const backupStale = hasContent && !syncReady(sync) && (Date.now() - lastBackup > 30 * 86400000);

  const openSubPage = (pid, sid) => { setTab("projects"); setOpenProject(pid); setOpenSub(sid); };
  const doneRow = (r) => { patchTodo(r.pid, r.sid, r.id, { done: true }); flash("완료 처리했습니다", () => patchTodo(r.pid, r.sid, r.id, { done: false })); };

  if (!loaded) {
    return <div style={{ fontFamily: FONT, background: C.bg, minHeight: "100vh" }} className="flex items-center justify-center">
      <span style={{ color: C.faint, fontSize: 14 }}>불러오는 중…</span></div>;
  }

  if (needPw) {
    return <LockScreen onOpen={async (pw) => {
      const cfg = lockCfg();
      if (!cfg) return false;
      try {
        const k = await deriveKey(pw, cfg.salt);
        const raw = await store.get();
        const plain = await openText(k, raw);
        keyRef.current = k;
        setDataRaw(normalize(JSON.parse(plain)));
        setNeedPw(false);
        if (syncReady(syncRef.current)) setTimeout(() => pull(syncRef.current), 300);
        return true;
      } catch (e) { return false; }
    }} />;
  }

  const header = tab !== "projects" ? null
    : sub ? { title: sub.name, sup: project.name, back: () => setOpenSub(null), color: colorOf(project, projectIdx) }
    : project ? { title: project.name, sup: "사업", back: () => setOpenProject(null), color: colorOf(project, projectIdx) } : null;

  const titleOf = { home: "메인보드", projects: "업무 관리", plan: "일정", counsel: "상담", notes: "메모함", contacts: "연락처" }[tab] || "메인보드";

  return (
    <div style={{ fontFamily: FONT, background: C.bg, minHeight: "100vh", color: C.ink }}>
      <style>{`
        .wb-btn { -webkit-tap-highlight-color: transparent; transition: transform .12s ease, background .15s ease; }
        .wb-btn:active { transform: scale(.98); }
        .wb-btn:focus-visible { outline: 2px solid ${C.navy}; outline-offset: 2px; }
        .wb-bar { transition: width .35s cubic-bezier(.2,.7,.3,1); }
        @keyframes wbStamp { 0% { transform: scale(1.5) rotate(-14deg); opacity: 0 } 60% { transform: scale(.9) rotate(-8deg); opacity: 1 } 100% { transform: scale(1) rotate(-9deg); opacity: 1 } }
        .wb-stamp { animation: wbStamp .28s cubic-bezier(.2,.8,.3,1) both; transform: rotate(-9deg); }
        @keyframes wbFade { from { opacity: 0 } to { opacity: 1 } }
        .wb-fade { animation: wbFade .18s ease both; }
        @keyframes wbUp { from { transform: translateY(24px); opacity: .6 } to { transform: translateY(0); opacity: 1 } }
        .wb-sheet { animation: wbUp .22s cubic-bezier(.2,.8,.3,1) both; }
        input, textarea { font-family: ${FONT}; }
        @keyframes wbSpin { to { transform: rotate(360deg) } }
        .wb-masonry { column-count: 2; column-gap: 10px; }
        @media (min-width: 620px) { .wb-masonry { column-count: 3; } }
        .wb-masonry > div { margin-bottom: 10px; }
        .wb-note img, .wb-note-preview img { max-width: 100%; border-radius: 10px; display: block; margin: 6px 0 }
        .wb-note:empty:before { content: "여기에 적으세요"; color: ${C.faint} }
        .wb-note-preview b, .wb-note b { font-weight: 750 }
        .wb-spin { animation: wbSpin 1s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .wb-stamp,.wb-fade,.wb-sheet,.wb-btn,.wb-bar { animation:none !important; transition:none !important } }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto", paddingBottom: 100 }}>
        <div className="sticky top-0 z-30" style={{ background: C.bg, borderBottom: "1px solid " + C.rule }}>
          <div className="flex items-center justify-between" style={{ padding: "14px 18px 12px" }}>
            {header ? (
              <button onClick={header.back} className="wb-btn flex items-center gap-1.5 min-w-0" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                <ChevronLeft size={20} color={C.muted} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5" style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>
                    <Dot color={header.color} size={7} /><span className="truncate">{header.sup}</span>
                  </span>
                  <span className="block truncate" style={{ fontSize: 18, fontWeight: 780, letterSpacing: "-0.02em" }}>{header.title}</span>
                </span>
              </button>
            ) : (
              <div>
                <Label>춘천시청소년상담복지센터</Label>
                <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 2 }}>{titleOf}</div>
              </div>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <SyncBadge state={syncState} on={syncReady(sync)} onClick={() => setShowSettings(true)} />
              <button onClick={() => setShowSettings(true)} className="wb-btn rounded-xl shrink-0"
                style={{ background: C.surface, border: "1px solid " + C.rule, padding: 9, cursor: "pointer", color: C.muted }}>
                <Settings2 size={17} strokeWidth={2.1} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 18px" }}>
          {!storageOK && (
            <Card style={{ padding: 12, marginBottom: 14, borderColor: C.seal, background: C.sealSoft }}>
              <span style={{ fontSize: 13, color: C.seal, fontWeight: 650 }}>저장에 실패했습니다. 새로고침한 뒤 다시 시도해 주세요.</span>
            </Card>
          )}

          {syncState === "signin" && (
            <Card style={{ padding: 12, marginBottom: 14, borderColor: "#EADFC4", background: C.amberSoft }}>
              <div className="flex items-center gap-2 flex-wrap">
                <CloudOff size={15} color={C.amber} strokeWidth={2.3} className="shrink-0" />
                <span style={{ fontSize: 12.5, color: C.amber, fontWeight: 650 }}>구글 로그인이 필요합니다</span>
                <button onClick={signInGoogle} className="wb-btn shrink-0 rounded-lg"
                  style={{ background: C.amber, color: "#fff", border: "none", padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginLeft: "auto" }}>
                  로그인
                </button>
              </div>
            </Card>
          )}

          {syncState === "error" && (
            <Card style={{ padding: 12, marginBottom: 14, borderColor: "#F0D5CF", background: C.sealSoft }}>
              <div className="flex items-center gap-2">
                <CloudOff size={15} color={C.seal} strokeWidth={2.3} className="shrink-0" />
                <span style={{ fontSize: 12.5, color: C.seal, fontWeight: 650, lineHeight: 1.45 }}>
                  클라우드에 저장하지 못했습니다. 이 기기에는 남아 있습니다. {syncMsg}
                </span>
                <button onClick={() => pull(sync)} className="wb-btn shrink-0 rounded-lg"
                  style={{ background: C.seal, color: "#fff", border: "none", padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginLeft: "auto" }}>
                  다시 시도
                </button>
              </div>
            </Card>
          )}

          {tab === "home" && backupStale && (
            <Card style={{ padding: 12, marginBottom: 14, borderColor: "#EADFC4", background: C.amberSoft }}>
              <div className="flex items-center gap-2 flex-wrap">
                <HardDriveDownload size={15} color={C.amber} strokeWidth={2.3} className="shrink-0" />
                <span style={{ fontSize: 12.5, color: C.amber, fontWeight: 650 }}>
                  {lastBackup ? "백업한 지 30일이 지났습니다" : "아직 백업 파일을 받지 않으셨습니다"}
                </span>
                <button onClick={downloadBackup} className="wb-btn shrink-0 rounded-lg"
                  style={{ background: C.amber, color: "#fff", border: "none", padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", marginLeft: "auto" }}>
                  지금 받기
                </button>
              </div>
            </Card>
          )}

          {tab === "home" && (
            <HomeView data={data} rows={homeRows} events={data.events || []} onDone={doneRow}
              onEditTodo={(pid, sid, tid, text) => patchTodo(pid, sid, tid, { text })}
              onOpenSub={openSubPage}
              onOpenProject={(pid) => { setTab("projects"); setOpenProject(pid); setOpenSub(null); }}
              onGo={(t) => { setTab(t); if (t === "projects") { setOpenProject(null); setOpenSub(null); } }}
              onAddMemo={(t) => { addMemo(t); flash("사업 화면에 담았습니다"); }} />
          )}

          {tab === "projects" && !project && (
            <ProjectList data={data} onOpen={(id) => { setOpenProject(id); setOpenSub(null); }}
              onOpenSub={openSubPage} onAdd={addProject}
              onReorder={(next) => setData((d) => ({ ...d, projects: next }))}
              overdue={overdue} onGoDue={() => setTab("due")}
              onSeed={(names) => { seedProjects(names); flash(names.length + "개 폴더를 만들었습니다"); }}
              onQuickTodo={quickTodo}
              onToggleTodo={(pid, sid, tid) => {
                patchTodo(pid, sid, tid, { done: true });
                flash("완료 처리했습니다", () => patchTodo(pid, sid, tid, { done: false }));
              }}
              onEditTodo={(pid, sid, tid, text) => patchTodo(pid, sid, tid, { text })}
              onMoveTodo={(pid, sid, tid, dir) => mapSub(pid, sid, (s2) => {
                const i = s2.todos.findIndex((t) => t.id === tid), j = i + dir;
                if (i < 0 || j < 0 || j >= s2.todos.length) return s2;
                const next = s2.todos.slice();
                [next[i], next[j]] = [next[j], next[i]];
                return { ...s2, todos: next };
              })}
              onAssign={assignTodo}
              onUndoTodo={(pid, sid, tid) => patchTodo(pid, sid, tid, { done: false })}
              onPurgeTodo={(pid, sid, tid) => {
                const sub2 = data.projects.find((x) => x.id === pid)?.subs.find((x) => x.id === sid);
                const item = sub2 && sub2.todos.find((t) => t.id === tid);
                mapSub(pid, sid, (s2) => ({ ...s2, todos: s2.todos.filter((t) => t.id !== tid) }));
                flash("삭제했습니다", () => item && mapSub(pid, sid, (s2) => ({ ...s2, todos: [...s2.todos, item] })));
              }}
              onMoveTodoTo={(fromPid, fromSid, tid, toPid, toSid) => {
                let item = null;
                setProjects((ps) => ps.map((pr) => {
                  if (pr.id !== fromPid) return pr;
                  return { ...pr, subs: pr.subs.map((s2) => {
                    if (s2.id !== fromSid) return s2;
                    const f = s2.todos.find((t) => t.id === tid);
                    if (f) item = f;
                    return { ...s2, todos: s2.todos.filter((t) => t.id !== tid) };
                  }) };
                }));
                setProjects((ps) => ps.map((pr) => {
                  if (pr.id !== toPid || !item) return pr;
                  return { ...pr, subs: pr.subs.map((s2) => (s2.id === toSid ? { ...s2, todos: [...s2.todos, item] } : s2)) };
                }));
                flash("다른 사업으로 옮겼습니다");
              }}
              onCreateSub={createSub}
              topOrder={data.topOrder || []}
              onTopOrder={(ids) => setData((d) => ({ ...d, topOrder: ids }))}
              memos={data.memos}
              onAddMemo={(t) => addMemo(t)}
              onToggleMemo={(m) => removeMemo(m, "처리했습니다")}
              onEditMemo={(id, text) => setData((d) => ({ ...d, memos: d.memos.map((x) => (x.id === id ? { ...x, text } : x)) }))}
              onReorderMemos={(next) => setData((d) => ({ ...d, memos: next }))}
              onSetMemoDue={(id, patch) => setData((d) => ({ ...d, memos: d.memos.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))}
              onAddMemoAfter={(id) => {
                const nid = uid();
                setData((d) => {
                  const arr = d.memos.slice();
                  const i = arr.findIndex((x) => x.id === id);
                  arr.splice(i + 1, 0, { id: nid, text: "", due: "", dueTime: "", dueEnd: "", createdAt: Date.now() });
                  return { ...d, memos: arr };
                });
                return nid;
              }}
              onAddTodoAfter={(pid, sid, tid) => {
                const nid = uid();
                mapSub(pid, sid, (s2) => {
                  const arr = s2.todos.slice();
                  const i = arr.findIndex((t) => t.id === tid);
                  arr.splice(i + 1, 0, { id: nid, text: "", due: "", dueTime: "", dueEnd: "", done: false, createdAt: Date.now() });
                  return { ...s2, todos: arr };
                });
                return nid;
              }}
              onMoveMemo={(id, dir) => setData((d) => {
                const arr = d.memos.slice();
                const i = arr.findIndex((x) => x.id === id), j = i + dir;
                if (i < 0 || j < 0 || j >= arr.length) return d;
                [arr[i], arr[j]] = [arr[j], arr[i]];
                return { ...d, memos: arr };
              })}
              onDropMemo={(mid, pid, sid) => {
                const m = data.memos.find((x) => x.id === mid);
                if (!m) return;
                addTodo(pid, sid, m.text, m.due, m.dueTime, m.dueEnd);
                setData((d) => ({ ...d, memos: d.memos.filter((x) => x.id !== mid) }));
                flash("사업으로 옮겼습니다");
              }} />
          )}

          {tab === "projects" && project && !sub && (
            <SubList project={project} color={colorOf(project, projectIdx)}
              notes={(data.notes || []).filter((n) => n.pid === project.id)}
              onGoNotes={() => setTab("notes")}
              onOpen={setOpenSub} onAdd={(n) => addSub(project.id, n)}
              onDelete={(sid) => mapProject(project.id, (p) => ({ ...p, subs: p.subs.filter((s) => s.id !== sid) }))}
              onDeleteProject={() => { setProjects((ps) => ps.filter((x) => x.id !== project.id)); setOpenProject(null); flash("사업을 삭제했습니다"); }}
              onReorder={(next) => mapProject(project.id, (p) => ({ ...p, subs: next }))}
              onColor={(c) => mapProject(project.id, (p) => ({ ...p, color: c }))}
              onRename={(name) => mapProject(project.id, (p) => ({ ...p, name }))} />
          )}

          {tab === "projects" && project && sub && (
            <SubDetail sub={sub} color={colorOf(project, projectIdx)}
              onPatch={(patch) => mapSub(project.id, sub.id, (s) => ({ ...s, ...patch }))}
              onToggleDoc={(d) => mapSub(project.id, sub.id, (s) => ({ ...s, docs: { ...s.docs, [d]: !s.docs?.[d] } }))}
              onAddTodo={(t) => addTodo(project.id, sub.id, t)}
              onPatchTodo={(tid, patch) => patchTodo(project.id, sub.id, tid, patch)}
              onDeleteTodo={(tid) => mapSub(project.id, sub.id, (s) => ({ ...s, todos: s.todos.filter((t) => t.id !== tid) }))}
              onReorderTodos={(openNext) => mapSub(project.id, sub.id, (s) => ({ ...s, todos: [...openNext, ...s.todos.filter((t) => t.done)] }))} />
          )}

          {tab === "plan" && (
            <PlanView data={data} rows={homeRows} events={data.events || []} onOpenSub={openSubPage}
              onGoCounsel={() => setTab("counsel")}
              onOpenProject={(pid) => { setTab("projects"); setOpenProject(pid); setOpenSub(null); }}
              onSaveResv={(v) => setData((d) => ({ ...d,
                resv: (d.resv || []).map((r) => (r.id === v.id ? { ...r, ...v, kind: undefined } : r)) }))}
              onDeleteResv={(id) => setData((d) => ({ ...d, resv: (d.resv || []).filter((r) => r.id !== id) }))}
              hidden={data.planHidden || []}
              onToggleHidden={(pid) => setData((d) => {
                const h = d.planHidden || [];
                return { ...d, planHidden: h.includes(pid) ? h.filter((x) => x !== pid) : [...h, pid] };
              })}
              onSetTodoTime={(pid, sid, tid, patch) => patchTodo(pid, sid, tid, patch)}
              onDeleteTodo={(pid, sid, tid) => {
                const sb = data.projects.find((x) => x.id === pid)?.subs.find((x) => x.id === sid);
                const item = sb && sb.todos.find((t) => t.id === tid);
                mapSub(pid, sid, (s2) => ({ ...s2, todos: s2.todos.filter((t) => t.id !== tid) }));
                flash("삭제했습니다", () => item && mapSub(pid, sid, (s2) => ({ ...s2, todos: [...s2.todos, item] })));
              }}
              onDeleteEvent={(id) => setData((d) => ({ ...d, events: (d.events || []).filter((e) => e.id !== id) }))}
              onSaveEvent={(v) => {
                if (v.kind === "todo") {
                  const proj = data.projects.find((x) => x.id === v.pid);
                  if (!proj) { flash("사업을 골라 주세요"); return; }
                  let target = v.sid;
                  if (!target) {
                    const box = proj.subs.find(isInbox);
                    if (box) target = box.id;
                  }
                  if (v.id) {
                    patchTodo(v.pid, v.sid, v.id, { text: v.title, due: v.date, dueTime: v.start, dueEnd: v.end });
                  } else if (target) {
                    addTodo(v.pid, target, v.title, v.date, v.start, v.end);
                  } else {
                    quickTodo(v.pid, v.title);
                    flash("미분류에 담았습니다");
                  }
                  return;
                }
                setData((d) => {
                  const list = d.events || [];
                  if (v.id && list.some((e) => e.id === v.id)) {
                    return { ...d, events: list.map((e) => (e.id === v.id ? { ...e, ...v } : e)) };
                  }
                  return { ...d, events: [...list, { ...v, id: v.id || uid(), createdAt: Date.now() }] };
                });
              }} />
          )}

          {tab === "counsel" && (
            <CounselView data={data}
              onSaveClient={(v) => setData((d) => {
                const list = d.clients || [];
                if (v.id) return { ...d, clients: list.map((c) => (c.id === v.id ? { ...c, ...v } : c)) };
                return { ...d, clients: [...list, { ...v, id: uid(), createdAt: Date.now() }] };
              })}
              onDeleteClient={(id) => setData((d) => ({ ...d,
                clients: (d.clients || []).filter((c) => c.id !== id),
                resv: (d.resv || []).filter((r) => r.clientId !== id) }))}
              onSaveResv={(v) => setData((d) => {
                const list = d.resv || [];
                if (v.id && list.some((r) => r.id === v.id)) {
                  return { ...d, resv: list.map((r) => (r.id === v.id ? { ...r, ...v, lockClient: undefined } : r)) };
                }
                return { ...d, resv: [...list, { ...v, lockClient: undefined, id: uid(), createdAt: Date.now() }] };
              })}
              onDeleteResv={(id) => setData((d) => ({ ...d, resv: (d.resv || []).filter((r) => r.id !== id) }))}
              onAddType={(t) => setData((d) => {
                const list = d.resvTypes && d.resvTypes.length ? d.resvTypes : DEFAULT_TYPES;
                return list.includes(t) ? d : { ...d, resvTypes: [...list, t] };
              })}
              onSaveLog={(rid, log) => setData((d) => ({ ...d,
                resv: (d.resv || []).map((r) => (r.id === rid ? { ...r, log } : r)) }))} />
          )}

          {tab === "contacts" && (
            <ContactsView data={data}
              onSave={(v) => setData((d) => {
                const list = d.contacts || [];
                if (v.id) return { ...d, contacts: list.map((c) => (c.id === v.id ? { ...c, ...v } : c)) };
                return { ...d, contacts: [...list, { ...v, id: uid(), createdAt: Date.now() }] };
              })}
              onDelete={(id) => setData((d) => ({ ...d, contacts: (d.contacts || []).filter((c) => c.id !== id) }))} />
          )}

          {tab === "notes" && (
            <NotesView notes={data.notes || []} projects={data.projects}
              onAdd={addNote} onPatch={patchNote} onDelete={removeNote}
              onReorder={(next) => setData((d) => ({ ...d, notes: next }))}
              onOpenProject={(pid) => { setTab("projects"); setOpenProject(pid); setOpenSub(null); }} />
          )}

        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40" style={{ background: "rgba(237,239,236,0.94)", backdropFilter: "blur(8px)", borderTop: "1px solid " + C.rule }}>
        <div className="flex" style={{ maxWidth: 760, margin: "0 auto", padding: "7px 4px 13px" }}>
          {[{ k: "home", t: "메인", i: LayoutGrid, badge: 0 },
            { k: "projects", t: "업무", i: FolderClosed, badge: 0 },
            { k: "plan", t: "일정", i: CalendarDays, badge: 0 },
            { k: "counsel", t: "상담", i: Users, badge: 0 },
            { k: "notes", t: "메모함", i: StickyNote, badge: 0 },
            { k: "contacts", t: "연락처", i: Phone, badge: 0 }].map((x) => {
            const on = tab === x.k;
            return (
              <button key={x.k} onClick={() => { setTab(x.k); if (x.k === "projects") { setOpenProject(null); setOpenSub(null); } }}
                className="wb-btn flex-1 flex flex-col items-center gap-1 rounded-xl"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 0", color: on ? C.navy : C.faint }}>
                <span className="relative">
                  <x.i size={19} strokeWidth={on ? 2.5 : 2} />
                  {x.badge > 0 && (
                    <span className="absolute flex items-center justify-center rounded-full"
                      style={{ top: -5, right: -9, minWidth: 16, height: 16, padding: "0 4px", background: x.k === "due" ? C.seal : C.navy, color: "#fff", fontSize: 10, fontWeight: 800 }}>{x.badge}</span>
                  )}
                </span>
                <span style={{ fontSize: 10, fontWeight: on ? 750 : 600 }}>{x.t}</span>
              </button>
            );
          })}
        </div>
      </div>

      {showSettings && (
        <Settings
          data={data} onClose={() => setShowSettings(false)} flash={flash}
          sync={sync} syncState={syncState} syncMsg={syncMsg} lastBackup={lastBackup}
          onDownload={downloadBackup}
          onSaveSync={async (cfg) => {
            if (!cfg.mode || cfg.mode !== syncRef.current.mode) { gForget(); gAuth.fileId = ""; }
            saveSync(cfg); setSync(cfg); syncRef.current = cfg;
            lastPushed.current = "";
            if (syncReady(cfg)) { await pull(cfg); } else { setSyncState("off"); }
          }}
          onSyncNow={() => pull(syncRef.current)}
          locked={!!keyRef.current}
          onSetLock={async (pw) => {
            if (!cryptoOK()) { flash("이 브라우저에서는 잠금을 쓸 수 없습니다"); return; }
            const salt = B64.to(crypto.getRandomValues(new Uint8Array(16)));
            const k = await deriveKey(pw, salt);
            keyRef.current = k;
            localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, at: Date.now() }));
            await store.set(await sealText(k, JSON.stringify(dataRef.current)));
            lastPushed.current = "";
            flash("잠금을 켰습니다");
          }}
          onClearLock={async () => {
            keyRef.current = null;
            localStorage.removeItem(LOCK_KEY);
            await store.set(JSON.stringify(dataRef.current));
            lastPushed.current = "";
            flash("잠금을 껐습니다");
          }}
          onSignIn={signInGoogle}
          onImport={(p) => {
            const n = normalize(p);
            setData({ ...n, updatedAt: Date.now() });
            flash("불러왔습니다");
          }}
        />
      )}

      {toast && (
        <div className="fixed left-0 right-0 flex justify-center wb-fade" style={{ bottom: 92, zIndex: 70, padding: "0 18px" }}>
          <span className="inline-flex items-center gap-3 rounded-full" style={{ background: C.ink, color: "#fff", fontSize: 13, fontWeight: 650, padding: "9px 10px 9px 16px" }}>
            {toast.msg}
            {toast.undo && (
              <button onClick={() => { toast.undo(); setToast(null); }} className="wb-btn inline-flex items-center gap-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "none", padding: "4px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                <RotateCcw size={12} /> 되돌리기
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   연락처 — 사업별로 정리해 두는 주소록
------------------------------------------------------------------- */
function ContactSheet({ init, projects, onSave, onDelete, onClose }) {
  const dismiss = useDismiss(onClose);
  const [v, setV] = useState({ name: "", org: "", role: "", phone: "", email: "", memo: "", pid: "", ...(init || {}) });
  const inp = { padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: C.surface,
    outline: "none", color: C.ink, borderRadius: 8, width: "100%", fontFamily: FONT };

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 440, background: C.bg, border: "1px solid " + C.rule, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between" style={{ padding: "14px 16px 8px" }}>
          <Label>{init && init.id ? "연락처 고치기" : "연락처 추가"}</Label>
          <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <Label>소속</Label>
          <input value={v.org} autoFocus onChange={(e) => setV({ ...v, org: e.target.value })}
            placeholder="○○중학교" style={{ ...inp, marginTop: 5, marginBottom: 10 }} />

          <div className="flex gap-2" style={{ marginBottom: 10 }}>
            <div className="flex-1 min-w-0">
              <Label>이름</Label>
              <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })}
                placeholder="이름" style={{ ...inp, marginTop: 5 }} />
            </div>
            <div style={{ width: 118 }}>
              <Label>직함</Label>
              <input value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}
                placeholder="담당자" style={{ ...inp, marginTop: 5 }} />
            </div>
          </div>

          <Label>연락처</Label>
          <input value={v.phone} onChange={(e) => setV({ ...v, phone: fmtPhone(e.target.value) })}
            placeholder="숫자만 넣으면 됩니다" inputMode="tel" style={{ ...inp, marginTop: 5, marginBottom: 10 }} />

          <Label>이메일</Label>
          <input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })}
            placeholder="name@example.com" inputMode="email" style={{ ...inp, marginTop: 5, marginBottom: 10 }} />

          <Label>사업 묶기</Label>
          <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 5, marginBottom: 10 }}>
            <button onClick={() => setV({ ...v, pid: "" })} className="wb-btn rounded-full"
              style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                background: !v.pid ? "#F1F3F0" : C.surface, color: !v.pid ? C.ink : C.faint,
                border: "1px solid " + (!v.pid ? "#C9CFC7" : C.rule) }}>
              공통
            </button>
            {projects.map((p, i) => {
              const c = colorOf(p, i), on = v.pid === p.id;
              return (
                <button key={p.id} onClick={() => setV({ ...v, pid: p.id })} className="wb-btn inline-flex items-center gap-1.5 rounded-full"
                  style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                    background: on ? c : C.surface, color: on ? "#fff" : C.muted,
                    border: "1px solid " + (on ? c : C.rule), maxWidth: "100%" }}>
                  {!on && <Dot color={c} size={7} />}
                  <span className="truncate">{shortName(p.name)}</span>
                </button>
              );
            })}
          </div>

          <Label>메모</Label>
          <textarea value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} rows={2}
            placeholder="기억해 둘 내용" style={{ ...inp, marginTop: 5, resize: "vertical", lineHeight: 1.55 }} />

          <div className="flex items-center gap-2 mt-4">
            {init && init.id && onDelete && <DeleteBtn onDelete={onDelete} label="삭제" />}
            <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
              <Btn size="sm" onClick={onClose}>취소</Btn>
              <Btn size="sm" kind="solid" icon={Check} disabled={!v.name.trim()}
                onClick={() => onSave({ ...v, name: v.name.trim() })}>저장</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactsView({ data, onSave, onDelete }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sheet, setSheet] = useState(null);
  const [openId, setOpenId] = useState(null);

  const list = data.contacts || [];
  const info = (pid) => {
    const i = data.projects.findIndex((p) => p.id === pid);
    return i < 0 ? null : { p: data.projects[i], color: colorOf(data.projects[i], i) };
  };

  const key = q.trim().toLowerCase();
  const shown = list
    .filter((c) => (filter === "all" ? true : filter === "none" ? !c.pid : c.pid === filter))
    .filter((c) => !key || [c.name, c.org, c.role, c.phone, c.email, c.memo]
      .some((x) => String(x || "").toLowerCase().includes(key)))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const chip = (id, label, color, n) => {
    const on = filter === id;
    return (
      <button key={id} onClick={() => setFilter(id)} className="wb-btn inline-flex items-center gap-1.5 rounded-full"
        style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
          background: on ? (color || C.navy) : C.surface, color: on ? "#fff" : C.muted,
          border: "1px solid " + (on ? (color || C.navy) : C.rule), maxWidth: "100%" }}>
        {!on && color && <Dot color={color} size={7} />}
        <span className="truncate">{label}</span> {n}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 소속 · 번호 찾기"
          className="flex-1 rounded-xl" style={{ padding: "10px 13px", fontSize: 13.5, color: C.ink,
            background: C.surface, border: "1px solid " + C.rule, outline: "none", minWidth: 0 }} />
        <Btn kind="solid" size="sm" icon={Plus} onClick={() => setSheet({})}>추가</Btn>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {chip("all", "전체", null, list.length)}
        {data.projects.map((p, i) => {
          const n = list.filter((c) => c.pid === p.id).length;
          if (!n) return null;
          return chip(p.id, shortName(p.name), colorOf(p, i), n);
        })}
        {list.some((c) => !c.pid) && chip("none", "공통", null, list.filter((c) => !c.pid).length)}
      </div>

      {shown.length === 0 ? (
        <Card style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>
          {list.length === 0
            ? <>연락처가 비어 있습니다.<br />일하며 알게 된 분들을 사업별로 정리해 두세요.</>
            : "찾는 연락처가 없습니다."}
        </Card>
      ) : (
        <Card style={{ padding: "4px 14px" }}>
          {shown.map((c, idx) => {
            const nfo = info(c.pid);
            const open = openId === c.id;
            return (
              <div key={c.id} style={{ borderTop: idx === 0 ? "none" : "1px solid " + C.rule }}>
                <button onClick={() => setOpenId(open ? null : c.id)}
                  className="wb-btn w-full flex items-center gap-2 text-left"
                  style={{ background: "none", border: "none", padding: "10px 0", cursor: "pointer" }}>
                  <span className="flex items-center justify-center rounded-full shrink-0"
                    style={{ width: 30, height: 30, background: nfo ? nfo.color : "#F1F3F0",
                      color: nfo ? "#fff" : C.muted, fontSize: 12.5, fontWeight: 800 }}>
                    {(c.org || c.name).slice(0, 1)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate" style={{ fontSize: 14, fontWeight: 700 }}>
                      {c.org || c.name}
                    </span>
                    <span className="block truncate" style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
                      {[c.org ? c.name : "", c.role, c.phone].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {nfo && (
                    <span className="shrink-0 rounded" style={{ fontSize: 9.5, fontWeight: 750, padding: "2px 6px",
                      background: "#F4F6F3", color: C.ink }}>{shortName(nfo.p.name)}</span>
                  )}
                  <ChevronRight size={14} color={C.faint} className="shrink-0"
                    style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
                </button>

                {open && (
                  <div style={{ paddingBottom: 11 }}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.phone && (
                        <>
                          <a href={"tel:" + c.phone.replace(/[^\d+]/g, "")} className="wb-btn inline-flex items-center gap-1 rounded-lg"
                            style={{ background: C.navy, color: "#fff", fontSize: 11.5, fontWeight: 700,
                              padding: "6px 11px", textDecoration: "none" }}>
                            <Phone size={12} strokeWidth={2.4} /> 전화
                          </a>
                          <a href={"sms:" + c.phone.replace(/[^\d+]/g, "")} className="wb-btn inline-flex items-center gap-1 rounded-lg"
                            style={{ background: C.surface, color: C.ink, border: "1px solid " + C.rule,
                              fontSize: 11.5, fontWeight: 700, padding: "6px 11px", textDecoration: "none" }}>
                            문자
                          </a>
                          <button onClick={() => { navigator.clipboard?.writeText(c.phone); }}
                            className="wb-btn rounded-lg" style={{ background: C.surface, color: C.muted,
                              border: "1px solid " + C.rule, fontSize: 11.5, fontWeight: 700, padding: "6px 11px", cursor: "pointer" }}>
                            번호 복사
                          </button>
                        </>
                      )}
                      {c.email && (
                        <a href={"mailto:" + c.email} className="wb-btn inline-flex items-center gap-1 rounded-lg"
                          style={{ background: C.surface, color: C.ink, border: "1px solid " + C.rule,
                            fontSize: 11.5, fontWeight: 700, padding: "6px 11px", textDecoration: "none" }}>
                          메일
                        </a>
                      )}
                      <button onClick={() => setSheet(c)} className="wb-btn rounded-lg"
                        style={{ marginLeft: "auto", background: "none", border: "none", color: C.faint,
                          fontSize: 11.5, fontWeight: 650, padding: "6px 4px", cursor: "pointer" }}>
                        <Pencil size={12} style={{ display: "inline", verticalAlign: "-1px" }} /> 고치기
                      </button>
                    </div>
                    {c.email && (
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 7 }}>{c.email}</div>
                    )}
                    {c.memo && (
                      <div className="rounded-lg" style={{ background: "#F7F8F6", border: "1px solid " + C.rule,
                        padding: "8px 10px", marginTop: 7, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {c.memo}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {sheet && (
        <ContactSheet init={sheet} projects={data.projects}
          onClose={() => setSheet(null)}
          onDelete={sheet.id ? () => { onDelete(sheet.id); setSheet(null); setOpenId(null); } : null}
          onSave={(v) => { onSave(v); setSheet(null); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   상담 — 내담자 · 예약 · 회기 · 상담일지
------------------------------------------------------------------- */
const ORG = "춘천시청소년상담복지센터";
const DEFAULT_TYPES = ["개인상담", "마음결", "수강명령"];

/* 구글 드라이브 주소에서 파일 id 를 꺼냅니다 */
const driveId = (url) => {
  const m = String(url || "").match(/\/file\/d\/([\w-]+)/) || String(url || "").match(/[?&]id=([\w-]+)/);
  return m ? m[1] : "";
};
const drivePreview = (url) => { const id = driveId(url); return id ? "https://drive.google.com/file/d/" + id + "/preview" : ""; };
const driveDownload = (url) => { const id = driveId(url); return id ? "https://drive.google.com/uc?export=download&id=" + id : url; };

const ageOf = (birth) => {
  if (!birth) return "";
  const b = new Date(birth + "T00:00:00");
  if (isNaN(b)) return "";
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a + "세";
};

/* ── 내담자 등록 ── */
function ClientSheet({ init, onSave, onDelete, onClose }) {
  const dismiss = useDismiss(onClose);
  const [v, setV] = useState({ name: "", phone: "", birth: "", sex: "", issue: "", ...(init || {}) });
  const inp = { padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: C.surface,
    outline: "none", color: C.ink, borderRadius: 8, width: "100%", fontFamily: FONT };

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 440, background: C.bg, border: "1px solid " + C.rule, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between" style={{ padding: "14px 16px 8px" }}>
          <Label>{init && init.id ? "내담자 정보" : "내담자 등록"}</Label>
          <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <div className="rounded-lg" style={{ background: "#F1F3F0", padding: "8px 10px", marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>상담기관 </span>
            <span style={{ fontSize: 12.5, color: C.ink, fontWeight: 650 }}>{ORG}</span>
          </div>

          <Label>이름</Label>
          <input value={v.name} autoFocus onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="내담자 이름" style={{ ...inp, marginTop: 5, marginBottom: 10 }} />

          <div className="flex gap-2" style={{ marginBottom: 10 }}>
            <div className="flex-1 min-w-0">
              <Label>생년월일</Label>
              <input type="date" value={v.birth} onChange={(e) => setV({ ...v, birth: e.target.value })}
                style={{ ...inp, marginTop: 5 }} />
            </div>
            <div style={{ width: 118 }}>
              <Label>성별</Label>
              <div className="flex rounded-lg" style={{ background: "#F1F3F0", padding: 3, gap: 3, marginTop: 5 }}>
                {["남", "여"].map((g) => {
                  const on = v.sex === g;
                  return (
                    <button key={g} onClick={() => setV({ ...v, sex: on ? "" : g })} className="wb-btn flex-1 rounded-md"
                      style={{ padding: "6px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
                        background: on ? C.surface : "transparent", color: on ? C.ink : C.faint,
                        border: "1px solid " + (on ? C.rule : "transparent") }}>{g}</button>
                  );
                })}
              </div>
            </div>
          </div>

          <Label>연락처</Label>
          <input value={v.phone} onChange={(e) => setV({ ...v, phone: fmtPhone(e.target.value) })}
            placeholder="숫자만 넣으면 됩니다" inputMode="tel" style={{ ...inp, marginTop: 5, marginBottom: 10 }} />

          <Label>주호소 문제</Label>
          <textarea value={v.issue} onChange={(e) => setV({ ...v, issue: e.target.value.slice(0, 200) })}
            rows={3} placeholder="주호소 문제를 적어 두세요"
            style={{ ...inp, marginTop: 5, resize: "vertical", lineHeight: 1.55 }} />
          <div style={{ fontSize: 10.5, color: C.faint, textAlign: "right", marginTop: 3 }}>{(v.issue || "").length} / 200</div>

          <div className="flex items-center gap-2 mt-4">
            {init && init.id && onDelete && <DeleteBtn onDelete={onDelete} label="삭제" />}
            <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
              <Btn size="sm" onClick={onClose}>취소</Btn>
              <Btn size="sm" kind="solid" icon={Check} disabled={!v.name.trim()}
                onClick={() => onSave({ ...v, name: v.name.trim() })}>저장</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 상담 예약 ── */
function ResvSheet({ init, clients, types, onAddType, onSave, onDelete, onClose }) {
  const dismiss = useDismiss(onClose);
  const [v, setV] = useState({ clientId: "", type: types[0] || "", date: todayISO(),
    start: "15:00", end: "16:00", memo: "", ...(init || {}) });
  const [newType, setNewType] = useState("");
  const [adding, setAdding] = useState(false);
  const inp = { padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: C.surface,
    outline: "none", color: C.ink, borderRadius: 8, fontFamily: FONT };

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 440, background: C.bg, border: "1px solid " + C.rule, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between" style={{ padding: "14px 16px 8px" }}>
          <Label>{init && init.id ? "예약 고치기" : "상담 예약"}</Label>
          <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <div className="rounded-lg" style={{ background: "#F1F3F0", padding: "8px 10px", marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>상담기관 </span>
            <span style={{ fontSize: 12.5, color: C.ink, fontWeight: 650 }}>{ORG}</span>
          </div>

          <Label>내담자</Label>
          {init && init.clientId && init.lockClient ? (
            <div className="rounded-lg" style={{ background: C.surface, border: "1px solid " + C.rule,
              padding: "9px 11px", marginTop: 5, fontSize: 13.5, fontWeight: 650 }}>
              {(clients.find((c) => c.id === init.clientId) || {}).name}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 5 }}>
              {clients.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>먼저 내담자를 등록해 주세요</span>}
              {clients.map((c) => {
                const on = v.clientId === c.id;
                return (
                  <button key={c.id} onClick={() => setV({ ...v, clientId: c.id })} className="wb-btn rounded-full"
                    style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", cursor: "pointer",
                      background: on ? C.navy : C.surface, color: on ? "#fff" : C.muted,
                      border: "1px solid " + (on ? C.navy : C.rule) }}>{c.name}</button>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <Label>유형</Label>
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 5 }}>
              {types.map((t) => {
                const on = v.type === t;
                return (
                  <button key={t} onClick={() => setV({ ...v, type: t })} className="wb-btn rounded-full"
                    style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", cursor: "pointer",
                      background: on ? C.green : C.surface, color: on ? "#fff" : C.muted,
                      border: "1px solid " + (on ? C.green : C.rule) }}>{t}</button>
                );
              })}
              {adding ? (
                <span className="inline-flex items-center gap-1">
                  <input value={newType} autoFocus onChange={(e) => setNewType(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newType.trim()) { onAddType(newType.trim()); setV({ ...v, type: newType.trim() }); setNewType(""); setAdding(false); }
                      if (e.key === "Escape") { setNewType(""); setAdding(false); }
                    }}
                    placeholder="새 유형" style={{ ...inp, padding: "4px 9px", fontSize: 12, width: 96 }} />
                </span>
              ) : (
                <button onClick={() => setAdding(true)} className="wb-btn inline-flex items-center gap-1 rounded-full"
                  style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", cursor: "pointer",
                    background: "transparent", color: C.faint, border: "1px dashed #C9CFC7" }}>
                  <Plus size={12} strokeWidth={2.6} /> 유형 추가
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <Label>시작</Label>
            <div className="flex items-center gap-2" style={{ marginTop: 5 }}>
              <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} style={{ ...inp, flex: 1 }} />
              <TimePick value={v.start} onChange={(t) => setV({ ...v, start: t })} style={{ width: 118 }} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <Label>종료</Label>
            <div className="flex items-center gap-2" style={{ marginTop: 5 }}>
              <input type="date" value={v.date} disabled style={{ ...inp, flex: 1, background: "#F1F3F0", color: C.faint }} />
              <TimePick value={v.end} onChange={(t) => setV({ ...v, end: t })} style={{ width: 118 }} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <Label>예약 메모</Label>
            <textarea value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} rows={2}
              placeholder="예약에 대한 메모를 적어 두세요"
              style={{ ...inp, width: "100%", marginTop: 5, resize: "vertical", lineHeight: 1.55 }} />
          </div>

          <div className="flex items-center gap-2 mt-4">
            {init && init.id && onDelete && <DeleteBtn onDelete={onDelete} label="삭제" />}
            <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
              <Btn size="sm" onClick={onClose}>취소</Btn>
              <Btn size="sm" kind="solid" icon={Check} disabled={!v.clientId}
                onClick={() => onSave(v)}>등록하기</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 상담일지 ── */
function LogSheet({ resv, client, session, onSave, onClose }) {
  const dismiss = useDismiss(onClose);
  const [text, setText] = useState((resv.log && resv.log.text) || "");
  const [files, setFiles] = useState((resv.log && resv.log.files) || []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [openId, setOpenId] = useState(null);
  const inp = { padding: "8px 10px", fontSize: 13, border: "1px solid " + C.rule, background: C.surface,
    outline: "none", color: C.ink, borderRadius: 8, fontFamily: FONT, minWidth: 0 };

  const add = () => {
    const u = url.trim();
    if (!u) return;
    setFiles([...files, { id: uid(), name: name.trim() || (driveId(u) ? "첨부파일" : u), url: u }]);
    setName(""); setUrl("");
  };

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 560, background: C.bg, border: "1px solid " + C.rule, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between" style={{ padding: "14px 16px 8px" }}>
          <div>
            <Label>상담일지</Label>
            <div style={{ fontSize: 15, fontWeight: 750, marginTop: 3 }}>
              {session}회기 · {client ? client.name : ""}
            </div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>
              {fmtDateK(resv.date)} {resv.start}{resv.end ? "–" + resv.end : ""} · {resv.type}
            </div>
          </div>
          <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9}
            placeholder="상담 내용을 적어 주세요"
            style={{ ...inp, width: "100%", fontSize: 13.5, lineHeight: 1.7, resize: "vertical" }} />

          <div style={{ marginTop: 14 }}>
            <Label>첨부파일</Label>
            <div style={{ fontSize: 11, color: C.faint, margin: "4px 0 8px", lineHeight: 1.6 }}>
              구글 드라이브에 올린 뒤 <b style={{ color: C.muted }}>공유 링크</b>를 붙여 넣으세요.
              드라이브에서 <b style={{ color: C.muted }}>링크가 있는 모든 사용자</b>로 열어 두어야 미리보기가 됩니다.
            </div>

            {files.map((f) => (
              <div key={f.id} className="rounded-lg" style={{ background: C.surface, border: "1px solid " + C.rule, marginBottom: 6 }}>
                <div className="flex items-center gap-2" style={{ padding: "8px 10px" }}>
                  <Paperclip size={14} color={C.muted} strokeWidth={2.2} className="shrink-0" />
                  <span className="flex-1 min-w-0 truncate" style={{ fontSize: 12.5, fontWeight: 650 }}>{f.name}</span>
                  {driveId(f.url) && (
                    <button onClick={() => setOpenId(openId === f.id ? null : f.id)} className="wb-btn rounded"
                      style={{ background: "#F1F3F0", border: "none", color: C.muted, fontSize: 11,
                        fontWeight: 700, padding: "3px 8px", cursor: "pointer" }}>
                      {openId === f.id ? "닫기" : "미리보기"}
                    </button>
                  )}
                  <a href={driveDownload(f.url)} target="_blank" rel="noreferrer noopener"
                    className="wb-btn rounded shrink-0" style={{ background: "#F1F3F0", color: C.muted,
                      fontSize: 11, fontWeight: 700, padding: "3px 8px", textDecoration: "none" }}>
                    내려받기
                  </a>
                  <button onClick={() => setFiles(files.filter((x) => x.id !== f.id))} className="wb-btn shrink-0"
                    style={{ background: "none", border: "none", color: "#C6CCC5", cursor: "pointer", padding: "0 2px" }}>
                    <X size={13} strokeWidth={2.4} />
                  </button>
                </div>
                {openId === f.id && drivePreview(f.url) && (
                  <iframe src={drivePreview(f.url)} title={f.name}
                    style={{ width: "100%", height: 380, border: "none", borderTop: "1px solid " + C.rule }} />
                )}
              </div>
            ))}

            <div className="flex items-center gap-2 mt-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="파일 이름"
                style={{ ...inp, width: 108 }} />
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="드라이브 링크 붙여넣기" style={{ ...inp, flex: 1 }} />
              <Btn size="sm" kind="solid" icon={Plus} onClick={add}>추가</Btn>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-5">
            <Btn size="sm" onClick={onClose} full={false}>취소</Btn>
            <div style={{ marginLeft: "auto" }}>
              <Btn size="sm" kind="solid" icon={Check}
                onClick={() => onSave({ text: text.trim(), files })}>저장</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 상담 화면 ── */
function CounselView({ data, onSaveClient, onDeleteClient, onSaveResv, onDeleteResv, onAddType, onSaveLog }) {
  const [openClient, setOpenClient] = useState(null);
  const [clientSheet, setClientSheet] = useState(null);
  const [resvSheet, setResvSheet] = useState(null);
  const [logFor, setLogFor] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const clients = data.clients || [];
  const resv = data.resv || [];
  const types = data.resvTypes && data.resvTypes.length ? data.resvTypes : DEFAULT_TYPES;

  const sessionsOf = (cid) => resv.filter((r) => r.clientId === cid)
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  const seqOf = (r) => sessionsOf(r.clientId).findIndex((x) => x.id === r.id) + 1;

  const upcoming = resv.filter((r) => r.date >= todayISO())
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  const past = resv.filter((r) => r.date < todayISO())
    .sort((a, b) => (b.date + (b.start || "")).localeCompare(a.date + (a.start || "")));

  const nameOf = (cid) => (clients.find((c) => c.id === cid) || {}).name || "(삭제된 내담자)";

  const ResvRow = ({ r, showName }) => (
    <div className="flex items-start gap-2" style={{ padding: "8px 0", borderTop: "1px solid " + C.rule }}>
      <span className="shrink-0 flex items-center justify-center rounded"
        style={{ minWidth: 28, height: 20, background: C.greenSoft, color: C.green,
          fontSize: 10.5, fontWeight: 800, marginTop: 1 }}>
        {seqOf(r)}회
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {showName && <span style={{ fontSize: 13, fontWeight: 700 }}>{nameOf(r.clientId)}</span>}
          <span className="rounded" style={{ fontSize: 9.5, fontWeight: 750, padding: "1px 5px",
            background: "#F1F3F0", color: C.muted }}>{r.type}</span>
          {r.log && (r.log.text || (r.log.files || []).length) && (
            <span className="rounded" style={{ fontSize: 9.5, fontWeight: 750, padding: "1px 5px",
              background: C.navySoft, color: C.navy }}>일지</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
          {fmtDateK(r.date)} {r.start}{r.end ? "–" + r.end : ""}
        </div>
        {r.memo && <div className="truncate" style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{r.memo}</div>}
      </div>
      <button onClick={() => setLogFor(r)} className="wb-btn shrink-0 rounded-lg"
        style={{ background: "#F1F3F0", border: "none", color: C.muted, fontSize: 11,
          fontWeight: 700, padding: "4px 9px", cursor: "pointer" }}>
        상담일지
      </button>
      <button onClick={() => setResvSheet({ ...r, lockClient: true })} className="wb-btn shrink-0"
        style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: "2px 3px" }}>
        <Pencil size={13} />
      </button>
    </div>
  );

  /* 내담자 상세 */
  if (openClient) {
    const c = clients.find((x) => x.id === openClient);
    if (!c) { setOpenClient(null); return null; }
    const list = sessionsOf(c.id);
    return (
      <div className="flex flex-col gap-3">
        <button onClick={() => setOpenClient(null)} className="wb-btn inline-flex items-center gap-1"
          style={{ background: "none", border: "none", color: C.muted, fontSize: 12.5, fontWeight: 650, cursor: "pointer", padding: 0 }}>
          <ChevronLeft size={15} /> 내담자 목록
        </button>

        <Card style={{ padding: 15 }}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontSize: 18, fontWeight: 780, letterSpacing: "-0.02em" }}>{c.name}</span>
                {c.sex && <Chip tone="neutral">{c.sex}</Chip>}
                {c.birth && <Chip tone="neutral">{ageOf(c.birth)}</Chip>}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 5, lineHeight: 1.6 }}>
                {c.birth && <div>생년월일 {c.birth}</div>}
                {c.phone && <div>연락처 {c.phone}</div>}
                <div>상담기관 {ORG}</div>
              </div>
            </div>
            <button onClick={() => setClientSheet(c)} className="wb-btn shrink-0"
              style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 3 }}>
              <Pencil size={15} />
            </button>
          </div>
          {c.issue && (
            <div className="rounded-lg" style={{ background: "#F7F8F6", border: "1px solid " + C.rule,
              padding: "9px 11px", marginTop: 11 }}>
              <Label>주호소 문제</Label>
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.ink, marginTop: 4, whiteSpace: "pre-wrap" }}>{c.issue}</div>
            </div>
          )}
        </Card>

        <Card style={{ padding: "13px 14px" }}>
          <div className="flex items-center gap-2 mb-1">
            <Label>상담 회기 {list.length}</Label>
            <button onClick={() => setResvSheet({ clientId: c.id, lockClient: true })}
              className="wb-btn inline-flex items-center gap-1 rounded-lg"
              style={{ marginLeft: "auto", background: C.navy, border: "none", color: "#fff",
                fontSize: 11.5, fontWeight: 700, padding: "5px 10px", cursor: "pointer" }}>
              <Plus size={12} strokeWidth={2.6} /> 상담 예약
            </button>
          </div>
          {list.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.faint, padding: "10px 0" }}>아직 예약된 회기가 없습니다</div>
          ) : list.map((r) => <ResvRow key={r.id} r={r} />)}
        </Card>

        {clientSheet && (
          <ClientSheet init={clientSheet} onClose={() => setClientSheet(null)}
            onDelete={() => { onDeleteClient(clientSheet.id); setClientSheet(null); setOpenClient(null); }}
            onSave={(v) => { onSaveClient(v); setClientSheet(null); }} />
        )}
        {resvSheet && (
          <ResvSheet init={resvSheet} clients={clients} types={types} onAddType={onAddType}
            onClose={() => setResvSheet(null)}
            onDelete={resvSheet.id ? () => { onDeleteResv(resvSheet.id); setResvSheet(null); } : null}
            onSave={(v) => { onSaveResv(v); setResvSheet(null); }} />
        )}
        {logFor && (
          <LogSheet resv={logFor} client={c} session={seqOf(logFor)}
            onClose={() => setLogFor(null)}
            onSave={(log) => { onSaveLog(logFor.id, log); setLogFor(null); }} />
        )}
      </div>
    );
  }

  /* 목록 */
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Btn kind="solid" size="sm" icon={Plus} onClick={() => setClientSheet({})}>내담자 등록</Btn>
        <Btn size="sm" icon={CalendarDays} onClick={() => setResvSheet({})}>상담 예약</Btn>
      </div>

      <Card style={{ padding: "13px 14px" }}>
        <div className="flex items-center gap-2 mb-1">
          <Users size={14} color={C.navy} strokeWidth={2.3} />
          <Label>내담자 {clients.length}</Label>
        </div>
        {clients.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.faint, padding: "10px 0" }}>등록된 내담자가 없습니다</div>
        ) : clients.map((c) => {
          const n = sessionsOf(c.id).length;
          return (
            <button key={c.id} onClick={() => setOpenClient(c.id)}
              className="wb-btn w-full flex items-center gap-2 text-left"
              style={{ background: "none", border: "none", borderTop: "1px solid " + C.rule,
                padding: "9px 0", cursor: "pointer" }}>
              <span className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: 28, height: 28, background: C.navySoft, color: C.navy, fontSize: 12, fontWeight: 800 }}>
                {c.name.slice(0, 1)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.name}</span>
                  {c.sex && <span style={{ fontSize: 10.5, color: C.faint }}>({c.sex})</span>}
                  {c.birth && <span style={{ fontSize: 10.5, color: C.faint }}>{ageOf(c.birth)}</span>}
                </span>
                {c.issue && <span className="block truncate" style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>{c.issue}</span>}
              </span>
              <span className="shrink-0 rounded" style={{ fontSize: 10.5, fontWeight: 750, padding: "2px 7px",
                background: n ? C.greenSoft : "#F1F3F0", color: n ? C.green : C.faint }}>
                {n}회기
              </span>
              <ChevronRight size={14} color={C.faint} className="shrink-0" />
            </button>
          );
        })}
      </Card>

      <Card style={{ padding: "13px 14px" }}>
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays size={14} color={C.navy} strokeWidth={2.3} />
          <Label>다가오는 상담 {upcoming.length}</Label>
        </div>
        {upcoming.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.faint, padding: "10px 0" }}>예정된 상담이 없습니다</div>
        ) : upcoming.map((r) => <ResvRow key={r.id} r={r} showName />)}
      </Card>

      {past.length > 0 && (
        <Card style={{ padding: "11px 14px" }}>
          <button onClick={() => setShowPast(!showPast)} className="wb-btn w-full flex items-center gap-2"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <Label>지난 상담 {past.length}</Label>
            <ChevronRight size={14} color={C.faint} style={{ marginLeft: "auto",
              transform: showPast ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
          </button>
          {showPast && <div style={{ marginTop: 4 }}>{past.map((r) => <ResvRow key={r.id} r={r} showName />)}</div>}
        </Card>
      )}

      {clientSheet && (
        <ClientSheet init={clientSheet} onClose={() => setClientSheet(null)}
          onDelete={clientSheet.id ? () => { onDeleteClient(clientSheet.id); setClientSheet(null); } : null}
          onSave={(v) => { onSaveClient(v); setClientSheet(null); }} />
      )}
      {resvSheet && (
        <ResvSheet init={resvSheet} clients={clients} types={types} onAddType={onAddType}
          onClose={() => setResvSheet(null)}
          onDelete={resvSheet.id ? () => { onDeleteResv(resvSheet.id); setResvSheet(null); } : null}
          onSave={(v) => { onSaveResv(v); setResvSheet(null); }} />
      )}
      {logFor && (
        <LogSheet resv={logFor} client={clients.find((c) => c.id === logFor.clientId)} session={seqOf(logFor)}
          onClose={() => setLogFor(null)}
          onSave={(log) => { onSaveLog(logFor.id, log); setLogFor(null); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   일정 — 월 · 주 · 일 보기, 끌어서 시간 맞추기
------------------------------------------------------------------- */
const HOUR_H = 46;          /* 한 시간의 높이(px) */
const DAY_FROM = 7, DAY_TO = 21;
const CENTER = "__center__";
const CENTER_COLOR = "#5A6673";   /* 사업 색과 겹치지 않는 회청색 */

const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
const toHM = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const snap = (m) => Math.max(0, Math.min(24 * 60 - 10, Math.round(m / 10) * 10));

/* 일정 만들기 · 고치기 */
function PlanSheet({ init, projects, onSave, onDelete, onClose, onGoLink }) {
  const dismiss = useDismiss(onClose);
  const [kind, setKind] = useState(init.kind || "event");
  const [title, setTitle] = useState(init.title || "");
  const [date, setDate] = useState(init.date || todayISO());
  const [start, setStart] = useState(init.start || "09:00");
  const [end, setEnd] = useState(init.end || "10:00");
  const [noTime, setNoTime] = useState(!init.start);
  const [pid, setPid] = useState(init.pid || "");
  const [sid, setSid] = useState(init.sid || "");
  const [place, setPlace] = useState(init.place || "");
  const [memo, setMemo] = useState(init.memo || "");

  const proj = projects.find((p) => p.id === pid);
  const subs = proj ? liveSubs(proj) : [];

  const Field = ({ icon: Icon, children }) => (
    <div className="flex items-start gap-2.5" style={{ padding: "9px 0", borderTop: "1px solid " + C.rule }}>
      <Icon size={15} color={C.faint} strokeWidth={2.2} style={{ marginTop: 3, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
  const inp = { padding: "7px 9px", fontSize: 13.5, border: "1px solid " + C.rule, background: C.surface,
    outline: "none", color: C.ink, borderRadius: 8, minWidth: 0, fontFamily: FONT };

  const save = () => {
    const t = title.trim();
    if (!t && kind !== "counsel") { onClose(); return; }
    if (kind === "counsel") {
      onSave({ id: init.id, kind: "counsel", date, start: noTime ? "" : start, end: noTime ? "" : end });
      return;
    }
    onSave({
      id: init.id, kind, title: t, date,
      start: noTime ? "" : start, end: noTime ? "" : end,
      pid: kind === "todo" ? pid : (pid || ""), sid: kind === "todo" ? sid : "",
      place: kind === "event" ? place.trim() : "",
      memo: kind === "event" ? memo.trim() : "",
    });
  };

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 460, background: C.bg, border: "1px solid " + C.rule, maxHeight: "88vh", overflowY: "auto" }}>

        <div className="flex items-center justify-between" style={{ padding: "14px 16px 8px" }}>
          <Label>{init.id ? "일정 고치기" : "새 일정"}</Label>
          <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          {kind === "counsel" ? (
            <div style={{ marginBottom: 10 }}>
              <span className="rounded" style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 6px",
                background: C.greenSoft, color: C.green }}>상담</span>
              <div style={{ fontSize: 17, fontWeight: 750, marginTop: 6 }}>{title}</div>
            </div>
          ) : (
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 추가" autoFocus
            className="w-full" style={{ fontSize: 17, fontWeight: 700, color: C.ink, background: "transparent",
              border: "none", borderBottom: "2px solid " + C.navy, outline: "none", padding: "6px 2px", marginBottom: 10 }} />
          )}


          <Field icon={Clock}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" style={inp} />
            <label className="flex items-center gap-1.5 mt-2" style={{ fontSize: 12.5, color: C.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={noTime} onChange={(e) => setNoTime(e.target.checked)} />
              시간 미정
            </label>
            {!noTime && (
              <div className="flex items-center gap-2 mt-2">
                <TimePick value={start} onChange={setStart} style={{ flex: 1 }} />
                <span style={{ color: C.faint }}>–</span>
                <TimePick value={end} onChange={setEnd} style={{ flex: 1 }} />
              </div>
            )}
          </Field>

          {kind !== "counsel" && (
          <Field icon={FolderClosed}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => { setPid(""); setSid(""); }} className="wb-btn rounded-full"
                style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                  background: !pid ? C.navy : C.surface, color: !pid ? "#fff" : C.muted,
                  border: "1px solid " + (!pid ? C.navy : C.rule) }}>
                센터 일정
              </button>
              {projects.map((p, i) => {
                const c = colorOf(p, i), on = pid === p.id;
                return (
                  <button key={p.id} onClick={() => { setPid(p.id); setSid(""); }} className="wb-btn inline-flex items-center gap-1.5 rounded-full"
                    style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                      background: on ? c : C.surface, color: on ? "#fff" : C.muted,
                      border: "1px solid " + (on ? c : C.rule), maxWidth: "100%" }}>
                    {!on && <Dot color={c} size={7} />}
                    <span className="truncate">{p.name}</span>
                  </button>
                );
              })}
            </div>

            {kind === "todo" && proj && (
              <div className="mt-2">
                <Label>세부사업</Label>
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  {subs.length === 0 && <span style={{ fontSize: 11.5, color: C.faint }}>세부사업이 없습니다. 미분류로 담깁니다</span>}
                  {subs.map((s2, i) => {
                    const on = sid === s2.id;
                    const bg = subColor(s2, i, colorOf(proj, projects.findIndex((x) => x.id === pid)));
                    return (
                      <button key={s2.id} onClick={() => setSid(s2.id)} className="wb-btn rounded-full"
                        style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                          background: bg, color: C.ink, border: "1px solid " + (on ? C.ink : "transparent"), maxWidth: "100%" }}>
                        <span className="truncate">{s2.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Field>
          )}

          {kind === "counsel" && init.memo && (
            <Field icon={AlignLeft}>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: C.ink, whiteSpace: "pre-wrap" }}>{init.memo}</div>
            </Field>
          )}

          {kind === "event" && (
            <>
              <Field icon={MapPin}>
                <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="위치 추가"
                  className="w-full" style={{ ...inp, border: "none", background: "transparent", padding: "3px 0" }} />
              </Field>
              <Field icon={AlignLeft}>
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="설명 추가" rows={2}
                  className="w-full" style={{ ...inp, border: "none", background: "transparent", padding: "3px 0", resize: "none" }} />
              </Field>
            </>
          )}

          {init.id && onGoLink && (init.kind !== "event" || init.pid) && (
            <button onClick={() => onGoLink(init)} className="wb-btn w-full flex items-center gap-2 rounded-lg mt-3"
              style={{ background: init.hl || (init.kind === "counsel" ? C.greenSoft : C.navySoft),
                border: "1px solid " + C.rule, borderLeft: "4px solid " + (init.color || C.navy),
                padding: "9px 11px", cursor: "pointer" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                {init.kind === "counsel" ? "상담에서 열기"
                  : init.kind === "event" ? "사업에서 열기"
                  : (init.sName || "세부사업")}
              </span>
              <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>열기</span>
              <ChevronRight size={14} color={C.muted} />
            </button>
          )}

          <div className="flex items-center gap-2 mt-4">
            {init.id && onDelete && (
              <DeleteBtn onDelete={onDelete} label="삭제" />
            )}
            <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
              <Btn size="sm" onClick={onClose}>취소</Btn>
              <Btn size="sm" kind="solid" icon={Check} onClick={save}>저장</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanView({ data, rows, events, onOpenSub, onOpenProject, onGoCounsel, hidden, onToggleHidden, onSaveEvent, onDeleteEvent, onSetTodoTime, onDeleteTodo, onSaveResv, onDeleteResv }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(iv); }, []);
  const nowM = nowMin();
  const nowTop = ((nowM - DAY_FROM * 60) / 60) * HOUR_H;
  const nowIn = nowM >= DAY_FROM * 60 && nowM <= (DAY_TO + 1) * 60;

  const [mode, setMode] = useState("day");
  const [pick, setPick] = useState(todayISO());
  const [sheet, setSheet] = useState(null);

  const shiftDay = (n) => {
    const d = new Date(pick + "T00:00:00");
    d.setDate(d.getDate() + n);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setPick(d.toISOString().slice(0, 10));
  };
  const shiftBy = (n) => shiftDay(mode === "day" ? n : mode === "week" ? n * 7 : n * 30);

  /* 할 일과 일정을 한 줄기로 */
  const projIdx = (pid) => data.projects.findIndex((p) => p.id === pid);
  const colorFor = (pid) => (pid ? colorOf(data.projects[projIdx(pid)] || {}, Math.max(0, projIdx(pid))) : CENTER_COLOR);
  const nameFor = (pid) => (pid ? shortName((data.projects[projIdx(pid)] || {}).name) : "센터");

  const all = [
    ...rows.map((r) => ({
      id: r.id, kind: "todo", title: r.text, date: r.due, start: r.dueTime || "", end: r.dueEnd || "",
      pid: r.pid, sid: r.sid, sName: r.sName, color: r.pColor, hl: r.hl,
    })),
    ...(events || []).map((e) => ({
      id: e.id, kind: "event", title: e.title, date: e.date, start: e.start || "", end: e.end || "",
      pid: e.pid || "", sid: "", place: e.place, memo: e.memo,
      color: colorFor(e.pid || ""), hl: "",
    })),
    ...(data.resv || []).map((r) => {
      const c = (data.clients || []).find((x) => x.id === r.clientId);
      return { id: r.id, kind: "counsel", title: (c ? c.name : "상담") + " · " + r.type,
        date: r.date, start: r.start || "", end: r.end || "", pid: "", sid: "",
        place: "", memo: r.memo, clientId: r.clientId, rtype: r.type, color: C.green, hl: C.greenSoft };
    }),
  ].filter((x) => x.date && !hidden.includes(x.pid || CENTER));

  const onDay = (iso) => all.filter((x) => x.date === iso);
  const timed = (iso) => onDay(iso).filter((x) => x.start).sort((a, b) => a.start.localeCompare(b.start));
  const untimed = (iso) => onDay(iso).filter((x) => !x.start);

  /* 시간표에서 위치 계산 */
  const topOf = (t) => ((toMin(t) - DAY_FROM * 60) / 60) * HOUR_H;
  const heightOf = (a, b) => Math.max(22, (((toMin(b) || toMin(a) + 60) - toMin(a)) / 60) * HOUR_H);

  /* 날짜와 시각을 함께 옮깁니다 */
  const moveTo = (x, date, start, end) => {
    if (x.kind === "todo") onSetTodoTime(x.pid, x.sid, x.id, { due: date, dueTime: start, dueEnd: end });
    else if (x.kind === "counsel") onSaveResv({ id: x.id, date, start, end });
    else onSaveEvent({ ...x, date, start, end });
  };

  const applyTime = (x, start, end) => {
    if (x.kind === "todo") onSetTodoTime(x.pid, x.sid, x.id, { dueTime: start, dueEnd: end });
    else if (x.kind === "counsel") onSaveResv({ id: x.id, start, end });
    else onSaveEvent({ ...x, start, end });
  };

  /* 끌어서 시간 조절 · 자리 이동 — 잡은 지점과 어긋나지 않게 간격을 기억합니다 */
  const [drag, setDrag] = useState(null);
  const movedRef = useRef(false);
  const fromRef = useRef({ x: 0, y: 0 });

  const colAt = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    return el && el.closest ? el.closest("[data-daycol]") : null;
  };
  const minInCol = (col, cy) => {
    const r = col.getBoundingClientRect();
    return DAY_FROM * 60 + ((cy - r.top) / HOUR_H) * 60;
  };

  useEffect(() => {
    if (!drag) return;
    const move = (ev) => {
      if (Math.abs(ev.clientX - fromRef.current.x) > 4 || Math.abs(ev.clientY - fromRef.current.y) > 4) {
        movedRef.current = true;
      }
      const col = colAt(ev.clientX, ev.clientY) || drag.col;
      if (!col) return;
      const raw = minInCol(col, ev.clientY);
      const date = col.getAttribute("data-date") || drag.date;

      setDrag((cur) => {
        if (!cur) return cur;
        if (cur.mode === "resize") {
          const end = snap(raw - cur.grab);
          if (end <= toMin(cur.x.start) + 10) return cur;
          return { ...cur, end: toHM(end) };
        }
        if (cur.mode === "resizeTop") {
          const st2 = snap(raw - cur.grab);
          const endM = toMin(cur.x.end || cur.x.start) + (cur.x.end ? 0 : 60);
          if (st2 >= endM - 10 || st2 < 0) return cur;
          return { ...cur, start: toHM(st2) };
        }
        if (!movedRef.current) return cur;               /* 살짝 눌린 정도는 이동이 아닙니다 */
        const start = snap(Math.max(0, raw - cur.grab));
        return { ...cur, moved: true, date, start: toHM(start), end: toHM(start + cur.dur) };
      });
    };
    const up = () => {
      setDrag((cur) => {
        if (cur) {
          if (cur.mode === "move" && !movedRef.current) {
            setSheet({ ...cur.x, kind: cur.x.kind });      /* 그냥 누르면 정보 보기 */
          } else if (movedRef.current) {
            if (cur.mode === "resize" && cur.end) applyTime(cur.x, cur.x.start, cur.end);
            else if (cur.mode === "resizeTop" && cur.start) applyTime(cur.x, cur.start, cur.x.end || toHM(toMin(cur.x.start) + 60));
            else if (cur.mode === "move" && cur.moved) moveTo(cur.x, cur.date, cur.start, cur.end);
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag && drag.id, drag && drag.mode]);

  /* 가장자리를 끌어 시각 조절 (위 = 시작, 아래 = 끝) */
  const beginResize = (e, x, col, edge) => {
    e.preventDefault(); e.stopPropagation();
    if (!col) return;
    movedRef.current = false;
    fromRef.current = { x: e.clientX, y: e.clientY };
    const cur = edge === "top" ? toMin(x.start) : toMin(x.end || x.start) + (x.end ? 0 : 60);
    setDrag({ mode: edge === "top" ? "resizeTop" : "resize", id: x.id, x, col, date: x.date,
      grab: minInCol(col, e.clientY) - cur, start: x.start, end: x.end || "" });
  };

  /* 블록 몸통 — 통째로 옮기기 */
  const beginMove = (e, x, col) => {
    if (e.button != null && e.button !== 0) return;
    if (!col) return;
    movedRef.current = false;
    fromRef.current = { x: e.clientX, y: e.clientY };
    const st = toMin(x.start);
    const dur = x.end ? Math.max(20, toMin(x.end) - st) : 60;
    setDrag({ mode: "move", id: x.id, x, col, date: x.date, dur,
      grab: minInCol(col, e.clientY) - st, start: x.start, end: x.end || toHM(st + dur), moved: false });
  };

  const goLink = (x) => {
    if (x.kind === "counsel") onGoCounsel && onGoCounsel();
    else if (x.kind === "event") { if (x.pid) onOpenProject && onOpenProject(x.pid); }
    else onOpenSub(x.pid, x.sid);
  };

  const hours = [];
  for (let h = DAY_FROM; h <= DAY_TO; h++) hours.push(h);

  const Block = ({ x, iso, compact }) => {
    const on = drag && drag.id === x.id;
    const moving = on && drag.mode === "move" && drag.moved;
    const showStart = on && ((drag.mode === "move" && drag.moved) || drag.mode === "resizeTop") ? drag.start : x.start;
    const showEnd = on ? (drag.mode === "move" ? (drag.moved ? drag.end : x.end) : drag.mode === "resizeTop" ? x.end : (drag.end || x.end)) : x.end;
    const hideHere = moving && drag.date !== iso;
    if (hideHere) return null;
    return (
      <div className="rounded-lg"
        onPointerDown={(e) => beginMove(e, x, e.currentTarget.closest("[data-daycol]"))}
        onClick={(ev) => {
          ev.stopPropagation();
          if (movedRef.current) { movedRef.current = false; return; }
          setSheet({ ...x, kind: x.kind });
        }}
        style={{
          position: "absolute", left: 2, right: 3, top: topOf(showStart), height: heightOf(showStart, showEnd),
          background: x.hl || (x.kind === "event" ? "#EEF1F5" : C.navySoft),
          borderLeft: "3px solid " + x.color, overflow: "hidden",
          cursor: moving ? "grabbing" : "pointer", touchAction: "none",
          opacity: moving ? 0.85 : 1,
          boxShadow: moving ? "0 6px 16px rgba(26,33,30,0.18)" : "0 1px 2px rgba(26,33,30,0.06)",
          zIndex: moving ? 8 : 2 }}>
        <div style={{ padding: compact ? "2px 4px" : "3px 7px" }}>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span style={{ fontSize: compact ? 8.5 : 10, fontWeight: 800, color: C.muted,
              fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {showStart}{showEnd ? "–" + showEnd : ""}
            </span>
            {!compact && (x.sName || x.place) && (
              <span className="truncate" style={{ fontSize: 9.5, fontWeight: 400, color: C.faint }}>
                {x.sName || x.place}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!compact && (
              <button onClick={(ev) => { ev.stopPropagation(); goLink(x); }}
                title="해당 화면으로 이동"
                className="wb-btn shrink-0 rounded" style={{ fontSize: 8.5, fontWeight: 800, padding: "2px 5px",
                  border: "none", cursor: "pointer",
                  background: x.kind === "counsel" ? C.greenSoft : x.kind === "event" ? "rgba(36,72,107,0.12)" : "rgba(26,33,30,0.07)",
                  color: x.kind === "counsel" ? C.green : C.muted }}>
                {x.kind === "event" ? "일정" : x.kind === "counsel" ? "상담" : "업무"}
              </button>
            )}
            <span className="truncate" style={{ fontSize: compact ? 9.5 : 12, fontWeight: 650, color: C.ink }}>{x.title}</span>
          </div>

        </div>
        <div onPointerDown={(e) => beginResize(e, x, e.currentTarget.closest("[data-daycol]"), "top")}
          style={{ position: "absolute", left: 0, right: 0, top: 0, height: 9, cursor: "ns-resize", touchAction: "none" }} />
        <div onPointerDown={(e) => beginResize(e, x, e.currentTarget.closest("[data-daycol]"), "bottom")}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 9, cursor: "ns-resize", touchAction: "none" }} />
      </div>
    );
  };

  const DayGrid = ({ iso, compact }) => (
    <div data-daycol data-date={iso} style={{ position: "relative", height: (DAY_TO - DAY_FROM + 1) * HOUR_H }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("text/plan");
        if (!raw) return;
        const x = all.find((y) => y.id === raw);
        if (!x) return;
        const box = e.currentTarget.getBoundingClientRect();
        const m = snap(DAY_FROM * 60 + ((e.clientY - box.top) / HOUR_H) * 60);
        const len = x.start && x.end ? Math.max(30, toMin(x.end) - toMin(x.start)) : 60;
        moveTo(x, iso, toHM(m), toHM(m + len));
      }}>
      {hours.map((h, i) => (
        <div key={h} onClick={() => setSheet({ kind: "event", date: iso, start: toHM(h * 60), end: toHM(h * 60 + 60) })}
          style={{ position: "absolute", top: i * HOUR_H, left: 0, right: 0, height: HOUR_H,
            borderTop: "1px solid " + C.rule, cursor: "pointer" }} />
      ))}
      {timed(iso).map((x) => <Block key={x.id} x={x} iso={iso} compact={compact} />)}
      {drag && drag.mode === "move" && drag.moved && drag.date === iso && drag.x.date !== iso && (
        <Block key={"ghost"} x={drag.x} iso={iso} compact={compact} />
      )}
      {iso === todayISO() && nowIn && (
        <div style={{ position: "absolute", left: 0, right: 0, top: nowTop, height: 0, zIndex: 6, pointerEvents: "none" }}>
          <span style={{ position: "absolute", left: -4, top: -4, width: 8, height: 8, borderRadius: 99, background: C.seal }} />
          <span style={{ display: "block", borderTop: "2px solid " + C.seal }} />
        </div>
      )}
    </div>
  );

  /* 월 보기 */
  const monthCells = (() => {
    const d = new Date(pick + "T00:00:00");
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const startDay = first.getDay();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const c = new Date(first);
      c.setDate(1 - startDay + i);
      c.setMinutes(c.getMinutes() - c.getTimezoneOffset());
      const iso = c.toISOString().slice(0, 10);
      cells.push({ iso, num: Number(iso.slice(8, 10)), inMonth: iso.slice(0, 7) === pick.slice(0, 7) });
    }
    return cells;
  })();

  /* 월요일에서 시작해 일요일로 끝납니다 */
  const weekDays = (() => {
    const d = new Date(pick + "T00:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return [0, 1, 2, 3, 4, 5, 6].map((k) => {
      const c = new Date(d);
      c.setDate(c.getDate() + k);
      c.setMinutes(c.getMinutes() - c.getTimezoneOffset());
      const iso = c.toISOString().slice(0, 10);
      return { iso, wd: ["월", "화", "수", "목", "금", "토", "일"][k], num: Number(iso.slice(8, 10)) };
    });
  })();

  const headLabel = mode === "month"
    ? Number(pick.slice(5, 7)) + "월"
    : mode === "week"
      ? Number(weekDays[0].iso.slice(5, 7)) + "." + weekDays[0].num + " – " + Number(weekDays[6].iso.slice(5, 7)) + "." + weekDays[6].num
      : Number(pick.slice(5, 7)) + "월 " + Number(pick.slice(8, 10)) + "일 (" + ["일", "월", "화", "수", "목", "금", "토"][new Date(pick + "T00:00:00").getDay()] + ")";

  return (
    <div className="flex flex-col gap-3">
      {/* 보기 전환 */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg" style={{ background: "#F1F3F0", padding: 3, gap: 3 }}>
          {[{ k: "month", t: "월간" }, { k: "week", t: "주간" }, { k: "day", t: "일간" }].map((o) => {
            const on = mode === o.k;
            return (
              <button key={o.k} onClick={() => setMode(o.k)} className="wb-btn rounded-md"
                style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  background: on ? C.surface : "transparent", color: on ? C.ink : C.faint,
                  border: "1px solid " + (on ? C.rule : "transparent") }}>{o.t}</button>
            );
          })}
        </div>
        <button onClick={() => { setPick(todayISO()); setMode("day"); }} className="wb-btn rounded-lg"
          style={{ background: C.surface, border: "1px solid " + C.rule, padding: "6px 12px",
            fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: C.ink }}>오늘</button>
        <button onClick={() => setSheet({ kind: "event", date: pick, start: "09:00", end: "10:00" })}
          className="wb-btn rounded-lg" style={{ marginLeft: "auto", background: C.navy, border: "none",
            color: "#fff", padding: "6px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          <Plus size={13} strokeWidth={2.6} style={{ display: "inline", verticalAlign: "-2px" }} /> 추가
        </button>
      </div>

      {/* 날짜 이동 */}
      <div className="flex items-center justify-between">
        <button onClick={() => shiftBy(-1)} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 4 }}>
          <ChevronLeft size={17} />
        </button>
        <span className="flex items-center gap-1.5" style={{ fontSize: 14, fontWeight: 780 }}>
          {headLabel}
          {mode === "day" && pick === todayISO() && (
            <span className="rounded-full" style={{ background: C.navy, color: "#fff", fontSize: 10,
              fontWeight: 800, padding: "2px 7px" }}>오늘</span>
          )}
        </span>
        <button onClick={() => shiftBy(1)} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 4 }}>
          <ChevronRight size={17} />
        </button>
      </div>

      {/* 표시할 일정 */}
      <Card style={{ padding: "10px 12px" }}>
        <Label>표시할 일정</Label>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {[{ id: CENTER, name: "센터 일정", color: CENTER_COLOR }, ...data.projects.map((p, i) => ({ id: p.id, name: p.name, color: colorOf(p, i) }))]
            .map((o) => {
              const off = hidden.includes(o.id);
              return (
                <button key={o.id} onClick={() => onToggleHidden(o.id)} className="wb-btn inline-flex items-center gap-1.5 rounded-full"
                  style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                    background: off ? C.surface : o.color, color: off ? C.faint : "#fff",
                    border: "1px solid " + (off ? C.rule : o.color), maxWidth: "100%" }}>
                  {off ? <span className="rounded" style={{ width: 8, height: 8, border: "1.5px solid " + o.color }} />
                       : <Check size={11} strokeWidth={3} />}
                  <span className="truncate">{o.name}</span>
                </button>
              );
            })}
        </div>
      </Card>

      {/* 월간 */}
      {mode === "month" && (
        <Card style={{ padding: "8px 9px 10px" }}>
          <div className="grid grid-cols-7" style={{ gap: 2, marginBottom: 3 }}>
            {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
              <div key={d} style={{ fontSize: 10, fontWeight: 700, color: C.faint, textAlign: "center" }}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7" style={{ gap: 2 }}>
            {monthCells.map((c) => {
              const list = onDay(c.iso);
              const isToday = c.iso === todayISO();
              return (
                <button key={c.iso} onClick={() => { setPick(c.iso); setMode("day"); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plan");
                    const x = all.find((y) => y.id === id);
                    if (x) moveTo(x, c.iso, x.start, x.end);
                  }}
                  className="wb-btn rounded-lg text-left"
                  style={{ minHeight: 58, padding: "3px 4px", cursor: "pointer",
                    background: "transparent", border: "1px solid transparent",
                    opacity: c.inMonth ? 1 : 0.35 }}>
                  <div className="flex items-center" style={{ height: 18 }}>
                    <span className="flex items-center justify-center rounded-full" style={{
                      minWidth: 18, height: 18, fontSize: 10.5, fontWeight: 750, fontVariantNumeric: "tabular-nums",
                      background: isToday ? C.navy : "transparent", color: isToday ? "#fff" : C.ink }}>{c.num}</span>
                  </div>
                  {list.slice(0, 3).map((x) => (
                    <div key={x.id} draggable
                      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("text/plan", x.id); e.dataTransfer.effectAllowed = "move"; }}
                      className="truncate" style={{ fontSize: 8.5, color: C.ink, lineHeight: 1.35,
                        borderLeft: "2px solid " + x.color, paddingLeft: 3, marginTop: 1, cursor: "grab" }}>{x.title}</div>
                  ))}
                  {list.length > 3 && <div style={{ fontSize: 8, color: C.faint }}>+{list.length - 3}</div>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* 주간 */}
      {mode === "week" && (
        <Card style={{ padding: "8px 9px 10px", overflowX: "auto" }}>
          <div className="grid" style={{ gridTemplateColumns: "34px repeat(7, minmax(62px, 1fr))", gap: 0 }}>
            <div />
            {weekDays.map((d) => (
              <button key={d.iso} onClick={() => { setPick(d.iso); setMode("day"); }} className="wb-btn"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 0 5px" }}>
                <div style={{ fontSize: 9.5, fontWeight: 700,
                  color: d.iso === todayISO() ? C.navy : d.wd === "일" ? C.seal : d.wd === "토" ? C.navy : C.faint }}>{d.wd}</div>
                <div className="flex items-center justify-center" style={{ margin: "1px auto 0" }}>
                  <span className="flex items-center justify-center rounded-full" style={{
                    width: 22, height: 22, fontSize: 12.5, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    background: d.iso === todayISO() ? C.navy : "transparent",
                    color: d.iso === todayISO() ? "#fff" : d.wd === "일" ? C.seal : C.ink }}>{d.num}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: "34px repeat(7, minmax(62px, 1fr))" }}>
            <div style={{ position: "relative", height: (DAY_TO - DAY_FROM + 1) * HOUR_H }}>
              {hours.map((h, i) => (
                <div key={h} style={{ position: "absolute", top: i * HOUR_H - 6, fontSize: 9, color: C.faint,
                  fontVariantNumeric: "tabular-nums" }}>{String(h).padStart(2, "0")}</div>
              ))}
            </div>
            {weekDays.map((d) => (
              <div key={d.iso} style={{ borderLeft: "1px solid " + C.rule }}>
                <DayGrid iso={d.iso} compact />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 일간 */}
      {mode === "day" && (
        <>
          {untimed(pick).length > 0 && (
            <Card style={{ padding: "10px 12px" }}>
              <Label>시간 미정 {untimed(pick).length}</Label>
              <div style={{ fontSize: 10, color: C.faint, margin: "3px 0 6px" }}>아래 시간표로 끌어다 놓으면 시각이 정해집니다</div>
              {untimed(pick).map((x) => (
                <div key={x.id} draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plan", x.id); e.dataTransfer.effectAllowed = "move"; }}
                  onClick={() => setSheet({ ...x })}
                  className="flex items-center gap-2 rounded-lg"
                  style={{ background: x.hl || "#F4F6F3", borderLeft: "3px solid " + x.color,
                    padding: "5px 8px", marginBottom: 4, cursor: "grab" }}>
                  <span className="flex-1 min-w-0 truncate" style={{ fontSize: 12.5 }}>{x.title}</span>
                  <span className="shrink-0" style={{ fontSize: 9.5, color: C.faint }}>{nameFor(x.pid)}</span>
                </div>
              ))}
            </Card>
          )}

          <Card style={{ padding: "8px 10px 12px" }}>
            <div className="flex">
              <div style={{ position: "relative", width: 38, height: (DAY_TO - DAY_FROM + 1) * HOUR_H, flexShrink: 0 }}>
                {hours.map((h, i) => (
                  <div key={h} style={{ position: "absolute", top: i * HOUR_H - 6, fontSize: 10, color: C.faint,
                    fontVariantNumeric: "tabular-nums" }}>{String(h).padStart(2, "0")}:00</div>
                ))}
                {pick === todayISO() && nowIn && (
                  <div style={{ position: "absolute", top: nowTop - 7, right: 2, fontSize: 9.5, fontWeight: 800,
                    color: C.seal, fontVariantNumeric: "tabular-nums", background: C.surface, padding: "0 2px" }}>
                    {toHM(nowM)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <DayGrid iso={pick} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 6 }}>
              빈 곳을 누르면 새 일정 · 가운데를 끌면 자리 이동 · 위아래 가장자리를 끌면 시간 조절
            </div>
          </Card>
        </>
      )}

      {sheet && (
        <PlanSheet init={sheet} projects={data.projects}
          onClose={() => setSheet(null)}
          onGoLink={(x) => { setSheet(null); goLink(x); }}
          onDelete={sheet.id
            ? () => {
                if (sheet.kind === "event") onDeleteEvent(sheet.id);
                else if (sheet.kind === "counsel") onDeleteResv(sheet.id);
                else onDeleteTodo(sheet.pid, sheet.sid, sheet.id);
                setSheet(null);
              } : null}
          onSave={(v) => { if (v.kind === "counsel") onSaveResv(v); else onSaveEvent(v); setSheet(null); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   사업 — 위: 취합 목록 · 가운데: 폴더 · 아래: 적어 두는 칸
------------------------------------------------------------------- */
const STARTER = ["집중심리클리닉", "특별교육", "수강명령", "기타"];

/* 한 줄짜리 할 일 — 눌러서 수정, Ctrl+↑↓ 로 이동 */
function MiniTodo({ todo, no, noRed, tag, right, onToggle, onEdit, onMove, onAddAfter, onRemoveEmpty, dense, autoEdit }) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(todo.text);
  const ref = useRef(null);

  const commit = () => {
    const t = draft.replace(/\s+$/, "");
    if (!t.trim()) { if (!todo.text && onRemoveEmpty) onRemoveEmpty(); return ""; }
    if (t !== todo.text) onEdit(t);
    return t;
  };

  const key = (e) => {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault(); commit(); onMove && onMove(e.key === "ArrowUp" ? -1 : 1); return;
    }
    if (e.key !== "Enter") {
      if (e.key === "Escape") { setDraft(todo.text); setEditing(false); }
      return;
    }
    e.preventDefault();

    if (e.altKey) {                              /* Alt+Enter — 같은 할 일에 줄 추가 */
      const el = ref.current;
      if (!el) return;
      const a = el.selectionStart, b = el.selectionEnd;
      const next = draft.slice(0, a) + "\n" + draft.slice(b);
      setDraft(next);
      requestAnimationFrame(() => {
        if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = a + 1;
      });
      return;
    }

    commit();
    setEditing(false);
    if (mod && onAddAfter) onAddAfter();         /* Ctrl+Enter — 바로 아래 새 칸 */
  };

  return (
    <div className="flex items-start gap-1.5" style={{ padding: dense ? "2.5px 0" : "4px 0" }}>
      <button onClick={onToggle} className="wb-btn flex items-center justify-center rounded shrink-0"
        style={{ width: dense ? 14 : 16, height: dense ? 14 : 16, marginTop: 2,
          border: "1.5px solid #C6CCC5", background: "transparent", cursor: "pointer" }} />
      {no != null && (
        <span className="shrink-0" style={{ fontSize: dense ? 10 : 11, fontWeight: 800,
          color: noRed ? C.seal : C.faint,
          minWidth: 13, marginTop: 1, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{no}</span>
      )}
      {editing ? (
        <textarea ref={ref} value={draft} autoFocus rows={Math.max(1, draft.split("\n").length)}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={key}
          onBlur={() => { commit(); setEditing(false); }} className="flex-1 rounded"
          style={{ padding: "2px 5px", fontSize: dense ? 12.5 : 13.5, border: "1px solid " + C.rule,
            background: "#F7F8F6", outline: "none", color: C.ink, minWidth: 0, resize: "none",
            lineHeight: 1.4, fontFamily: FONT }} />
      ) : (
        <span onClick={() => { setDraft(todo.text); setEditing(true); }} className="flex-1 min-w-0"
          title="눌러서 수정"
          style={{ fontSize: dense ? 12.5 : 13.5, lineHeight: 1.4, cursor: "text",
            wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
          {todo.text}
        </span>
      )}
      {tag}
      {right}
    </div>
  );
}

/* 글 안의 주소를 찾아 미리보기로 보여 줍니다 */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const findLinks = (text) => {
  const out = [];
  const seen = new Set();
  (String(text || "").match(URL_RE) || []).forEach((u) => {
    const clean = u.replace(/[.,)]+$/, "");
    if (seen.has(clean)) return;
    seen.add(clean);
    try { out.push({ url: clean, host: new URL(clean).hostname.replace(/^www\./, "") }); } catch (e) {}
  });
  return out;
};

/* 접었다 펴는 묶음 */
function Fold({ title, count, children, tone }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <Card style={{ padding: "10px 13px", background: tone || "#FBFCFA" }}>
      <button onClick={() => setOpen(!open)} className="wb-btn w-full flex items-center gap-1.5"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        <Check size={13} color={C.green} strokeWidth={2.6} />
        <Label>{title} {count}</Label>
        <ChevronRight size={14} color={C.faint}
          style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </Card>
  );
}

/* 시간 · 오늘/내일/다음 을 작게 붙입니다 */
const TimeTag = ({ item }) => {
  const t = timeText(item);
  if (!t) return null;
  return (
    <span className="shrink-0" style={{ fontSize: 9.5, fontWeight: 700, color: C.muted,
      marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {t}
    </span>
  );
};

const DateTag = ({ item }) => {
  if (!item.due) return null;
  return (
    <span className="shrink-0" style={{ fontSize: 9.5, fontWeight: 700, color: C.faint,
      marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {fmtDateShort(item.due)}
    </span>
  );
};

const BucketTag = ({ item }) => {
  const b = BUCKETS[bucketOf(item)];
  return (
    <span className="shrink-0 rounded" style={{ background: b.bg, color: b.fg, fontSize: 9.5,
      fontWeight: 750, padding: "1.5px 5px", marginTop: 1, whiteSpace: "nowrap" }}>
      {b.t}
    </span>
  );
};

/* 오늘 / 내일 / 다음 을 바로 고르는 단추 */
const BucketPick = ({ item, onPick }) => (
  <span className="inline-flex items-center shrink-0 rounded" style={{ background: "#F4F6F3", padding: 1, gap: 1, marginTop: 1 }}>
    {BUCKETS.slice(1).map((b) => {
      const on = bucketOf(item) === b.k;
      return (
        <button key={b.k} onClick={() => onPick(setBucket(b.k))} title={b.t}
          className="wb-btn rounded"
          style={{ fontSize: 9.5, fontWeight: 750, padding: "1px 5px", cursor: "pointer", border: "none",
            background: on ? b.bg : "transparent", color: on ? b.fg : "#AEB5AC" }}>
          {b.t}
        </button>
      );
    })}
  </span>
);

/* 폴더에 떨어뜨렸을 때 뜨는 작은 선택창 */
function AssignSheet({ project, base, title, onPick, onClose }) {
  const dismiss = useDismiss(onClose);
  const [name, setName] = useState("");
  const subs = liveSubs(project);
  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 420, background: C.bg, border: "1px solid " + C.rule, maxHeight: "80vh", overflowY: "auto" }}>
        <div className="flex items-start justify-between" style={{ padding: "15px 16px 10px" }}>
          <div className="min-w-0">
            <Label>{project.name}</Label>
            <div className="truncate" style={{ fontSize: 14.5, fontWeight: 750, marginTop: 3 }}>{title}</div>
          </div>
          <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={19} />
          </button>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          {subs.length > 0 && (
            <>
              <Label>세부사업 고르기</Label>
              <div className="flex flex-col gap-1.5" style={{ margin: "7px 0 14px" }}>
                {subs.map((s, i) => (
                  <button key={s.id} onClick={() => onPick(s.id)} className="wb-btn flex items-center gap-2 rounded-lg"
                    style={{ padding: "9px 11px", background: subColor(s, i, base), border: "1px solid " + C.rule, borderLeft: "4px solid " + subEdge(i, base),
                      cursor: "pointer", textAlign: "left" }}>
                    <span className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{s.name}</span>
                    <ChevronRight size={14} color={C.muted} style={{ marginLeft: "auto" }} />
                  </button>
                ))}
              </div>
            </>
          )}
          <Label>{subs.length ? "새로 만들기" : "세부사업이 없습니다. 새로 만드세요"}</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <input value={name} autoFocus={subs.length === 0} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onPick(null, name.trim()); }}
              placeholder="새 세부사업 이름" className="flex-1 rounded-lg"
              style={{ padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: C.surface, outline: "none", color: C.ink, minWidth: 0 }} />
            <Btn kind="solid" size="sm" icon={Plus} disabled={!name.trim()} onClick={() => name.trim() && onPick(null, name.trim())}>만들기</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAdd({ onAdd, placeholder }) {
  const [v, setV] = useState("");
  const ref = useRef(null);
  const vRef = useRef("");        /* 화면 갱신을 기다리지 않고 바로 비우기 위한 값 */

  const write = (next) => { vRef.current = next; setV(next); };

  /* 담고 나면 즉시 비워, 뒤이어 오는 blur 가 같은 내용을 또 담지 않게 합니다 */
  const flush = () => {
    const items = splitList(vRef.current);
    if (!items.length) { write(""); return 0; }
    write("");
    items.forEach((t) => onAdd(t));
    return items.length;
  };

  const key = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (e.altKey) {                              /* Alt+Enter — 같은 할 일에 줄 추가 */
      const el = ref.current;
      if (!el) return;
      const a = el.selectionStart, b = el.selectionEnd;
      const next = vRef.current.slice(0, a) + "\n" + vRef.current.slice(b);
      write(next);
      requestAnimationFrame(() => {
        if (!ref.current) return;
        ref.current.selectionStart = ref.current.selectionEnd = a + 1;
      });
      return;
    }

    flush();
    if (e.ctrlKey || e.metaKey) {                /* Ctrl+Enter — 이어서 다음 할 일 */
      requestAnimationFrame(() => ref.current && ref.current.focus());
    } else if (ref.current) {                    /* Enter — 확정하고 마침 */
      ref.current.blur();
    }
  };

  const style = {
    padding: "2px 4px", fontSize: 12, color: C.ink, background: "transparent",
    border: "none", outline: "none", minWidth: 0, resize: "none",
    lineHeight: 1.45, fontFamily: FONT, overflow: "hidden",
  };

  return (
    <div className="flex items-start gap-1" style={{ marginTop: 5 }}>
      <Plus size={12} color={C.faint} strokeWidth={2.6} className="shrink-0" style={{ marginTop: 3 }} />
      <textarea ref={ref} value={v} rows={Math.max(1, v.split("\n").length)}
        onChange={(e) => write(e.target.value)} onKeyDown={key} onBlur={flush}
        placeholder={placeholder} className="flex-1 rounded" style={style} />
    </div>
  );
}

function ProjectList({ data, onOpen, onOpenSub, onAdd, onReorder, overdue, onGoDue, onSeed,
                       onQuickTodo, onToggleTodo, onEditTodo, onMoveTodo,
                       onAssign, onCreateSub, topOrder, onTopOrder,
                       memos, onAddMemo, onAddMemoAfter, onDropMemo, onToggleMemo, onEditMemo, onMoveMemo, onReorderMemos, onAddTodoAfter, onSetMemoDue, onMoveTodoTo, onUndoTodo, onPurgeTodo }) {
  const [adding, setAdding] = useState(false);
  const [assign, setAssign] = useState(null);   /* {pid, kind, ...} */
  const [over, setOver] = useState(null);
  const dragRef = useRef("");
  const [focusId, setFocusId] = useState(null);
  const [showLate, setShowLate] = useState(false);
  const missing = STARTER.filter((n) => !data.projects.some((p) => p.name === n));

  /* 사업 안의 할 일을 보관함 → 세부사업 순으로 */
  const rank = new Map((topOrder || []).map((id, i) => [id, i]));
  const pos = (x) => (rank.has(x.id) ? rank.get(x.id) : 1e9);

  const rowsOf = (p, pi) => {
    const out = [];
    p.subs.forEach((s) => s.todos.forEach((t) => {
      if (!t.done) out.push({ ...t, sid: s.id, sName: s.name, inbox: isInbox(s), hl: isInbox(s) ? "" : subColor(s, liveSubs(p).findIndex((x) => x.id === s.id), colorOf(p, pi)),
        edge: isInbox(s) ? "" : subEdge(liveSubs(p).findIndex((x) => x.id === s.id), colorOf(p, pi)) });
    }));
    out.sort((a, b) => bucketOf(a) - bucketOf(b) || pos(a) - pos(b) || sortKey(a).localeCompare(sortKey(b)));
    return out;
  };

  const doneRows = [];
  data.projects.forEach((p) => p.subs.forEach((s2) => s2.todos.forEach((t) => {
    if (t.done) doneRows.push({ ...t, pid: p.id, sid: s2.id, pName: p.name });
  })));

  /* 전체 취합 — 내가 정한 순서를 따릅니다 */
  const all = [];
  data.projects.forEach((p, i) => rowsOf(p, i).forEach((r) => all.push({ ...r, pid: p.id, pName: p.name, pColor: colorOf(p, i) })));
  all.sort((a, b) => bucketOf(a) - bucketOf(b) || pos(a) - pos(b) || sortKey(a).localeCompare(sortKey(b)));

  /* 폴더 안에서 바꾼 순서를 전체 순서에 반영합니다 */
  const onReorderRows = (before, after) => {
    const ids = all.map((x) => x.id);
    const slots = before.map((r) => ids.indexOf(r.id)).filter((i) => i >= 0).sort((a, b) => a - b);
    const next = ids.slice();
    slots.forEach((slot, i) => { if (after[i]) next[slot] = after[i].id; });
    onTopOrder(next);
  };

  const moveTop = (id, dir) => {
    const ids = all.map((x) => x.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onTopOrder(ids);
  };

  return (
    <div className="flex flex-col gap-3">
      {overdue > 0 && (
        <Card style={{ padding: 0, background: C.sealSoft, borderColor: "#F0D5CF" }}>
          <button onClick={() => setShowLate(!showLate)} className="wb-btn w-full flex items-center gap-2"
            style={{ background: "none", border: "none", padding: "11px 13px", cursor: "pointer" }}>
            <AlertTriangle size={14} color={C.seal} strokeWidth={2.4} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.seal }}>마감 지난 할 일 {overdue}건</span>
            <ChevronRight size={13} color={C.seal} style={{ marginLeft: "auto",
              transform: showLate ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
          </button>
          {showLate && (
            <div style={{ padding: "0 13px 10px" }}>
              {all.filter((r) => bucketOf(r) === 0).map((r) => (
                <div key={r.id} className="flex items-start gap-2" style={{ padding: "5px 0", borderTop: "1px solid #F0D5CF" }}>
                  <button onClick={() => onToggleTodo(r.pid, r.sid, r.id)}
                    className="wb-btn flex items-center justify-center rounded shrink-0"
                    style={{ width: 14, height: 14, marginTop: 2, border: "1.5px solid " + C.seal, background: "transparent", cursor: "pointer" }} />
                  <span className="flex-1 min-w-0" style={{ fontSize: 12.5, lineHeight: 1.4, wordBreak: "break-word" }}>{r.text}</span>
                  <span className="shrink-0" style={{ fontSize: 10, fontWeight: 750, color: C.seal, marginTop: 2,
                    fontVariantNumeric: "tabular-nums" }}>{fmtDateShort(r.due)}</span>
                  <button onClick={() => onOpen(r.pid)} className="wb-btn shrink-0 rounded"
                    style={{ background: "rgba(255,255,255,0.7)", border: "none", color: C.ink, fontSize: 9.5,
                      fontWeight: 750, padding: "2px 6px", marginTop: 1, cursor: "pointer" }}>
                    {shortName(r.pName)}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── 전체 취합 목록 ── */}
      <Card style={{ padding: "11px 13px" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <ListChecks size={14} color={C.navy} strokeWidth={2.3} />
          <Label>할 일 전체 {all.length}</Label>
          {all.length > 1 && <span style={{ fontSize: 10, color: C.faint, marginLeft: "auto" }}>Ctrl+↑↓ 순서</span>}
        </div>
        {all.length === 0 ? (
          <div style={{ fontSize: 12, color: C.faint, padding: "6px 0 2px", lineHeight: 1.5 }}>
            아직 할 일이 없습니다. 아래 폴더에 적으면 여기에 모입니다.
          </div>
        ) : (
          <>
          <Sortable items={all} idOf={(r) => r.id} onReorder={(next) => onTopOrder(next.map((x) => x.id))}
            renderRow={(r, handle) => (
              <div className="flex items-start gap-1" style={{ borderTop: "1px solid #F1F3F0" }}>
                <button {...handle} className="wb-btn shrink-0 flex items-center justify-center"
                  style={{ ...handle.style, background: "none", border: "none", color: "#D5DAD3", padding: 0, width: 11, marginTop: 5 }}
                  aria-label="순서 바꾸기">
                  <GripVertical size={11} strokeWidth={2} />
                </button>
                <div className="flex-1 min-w-0">
                  <MiniTodo todo={r} no={all.findIndex((x) => x.id === r.id) + 1} noRed={bucketOf(r) === 0}
                    dense autoEdit={focusId === r.id}
                    onToggle={() => onToggleTodo(r.pid, r.sid, r.id)}
                    onEdit={(t) => onEditTodo(r.pid, r.sid, r.id, t)}
                    onMove={(d) => moveTop(r.id, d)}
                    onAddAfter={() => setFocusId(onAddTodoAfter(r.pid, r.sid, r.id))}
                    onRemoveEmpty={() => onToggleTodo(r.pid, r.sid, r.id)}
                    tag={
                      <span className="shrink-0 inline-flex items-center gap-1">
                        <TimeTag item={r} />
                        <DateTag item={r} />
                        <BucketTag item={r} />
                        <button onClick={(e) => { e.stopPropagation(); r.inbox ? onOpen(r.pid) : onOpenSub(r.pid, r.sid); }}
                          title={r.pName + (r.sName ? " · " + r.sName : "")}
                          className="wb-btn inline-flex items-center gap-1 rounded" style={{
                            background: r.hl || "#F1F3F0", padding: "2px 6px", fontSize: 9.5,
                            fontWeight: 750, color: C.ink, border: "none", cursor: "pointer" }}>
                          <Dot color={r.pColor} size={5} />
                          {shortName(r.pName)}
                        </button>
                      </span>
                    } />
                </div>
              </div>
            )} />
          </>
        )}
      </Card>

      {missing.length > 0 && (
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>{missing.join(" · ")}</div>
          <Btn kind="solid" size="sm" icon={Plus} onClick={() => onSeed(missing)}>{missing.length}개 폴더 만들기</Btn>
        </Card>
      )}

      {/* ── 폴더 격자 ── */}
      <Sortable items={data.projects} idOf={(p) => p.id} onReorder={onReorder}
        className="grid grid-cols-2" style={{ gap: 8, alignItems: "start" }}
        renderRow={(p, handle) => {
          const i = data.projects.findIndex((x) => x.id === p.id);
          const color = colorOf(p, i);
          const rows = rowsOf(p, i);
          const chips = liveSubs(p).filter((s) => !subDoneAll(s));
          const isOver = over === p.id;
          return (
            <div className="rounded-xl"
              onDragOver={(e) => { e.preventDefault(); setOver(p.id); }}
              onDragLeave={() => setOver((x) => (x === p.id ? null : x))}
              onDrop={(e) => {
                e.preventDefault(); setOver(null);
                const raw = dragRef.current || "";
                const todoKey = e.dataTransfer.getData("text/todo") || (raw.startsWith("todo:") ? raw.slice(5) : "");
                if (todoKey) {
                  const [fp, fs, ft] = todoKey.split(":");
                  if (fp !== p.id) setAssign({ pid: p.id, kind: "move", fromPid: fp, fromSid: fs, tid: ft });
                } else {
                  const mid = e.dataTransfer.getData("text/memo") || raw;
                  if (mid && memos.some((m) => m.id === mid)) setAssign({ pid: p.id, kind: "memo", mid });
                }
                dragRef.current = "";
              }}
              style={{ background: isOver ? "#EEF3EE" : C.surface,
                border: "1px solid " + (isOver ? C.green : C.rule), borderTop: "3px solid " + color,
                padding: "8px 9px 9px", boxShadow: "0 1px 2px rgba(26,33,30,0.04)", transition: "background .12s ease" }}>

              <div className="flex items-center gap-1" style={{ marginBottom: 5 }}>
                <button {...handle} className="wb-btn shrink-0 flex items-center justify-center"
                  style={{ ...handle.style, background: "none", border: "none", color: "#CBD1C9", padding: 0, width: 11 }}
                  aria-label="사업 순서 바꾸기">
                  <GripVertical size={11} strokeWidth={2} />
                </button>
                <button onClick={() => onOpen(p.id)} className="wb-btn flex-1 min-w-0 flex items-center gap-1"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                  <span className="truncate" style={{ fontSize: 13, fontWeight: 780 }}>{p.name}</span>
                  <ChevronRight size={12} color={C.faint} className="shrink-0" />
                </button>
              </div>

              {/* 진행 중인 세부사업 이름표 */}
              {chips.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap" style={{ marginBottom: 5 }}>
                  {chips.map((s) => {
                    const idx = p.subs.findIndex((x) => x.id === s.id);
                    return (
                      <button key={s.id} onClick={() => onOpenSub(p.id, s.id)} className="wb-btn rounded"
                        title={s.name + " 열기"}
                        style={{
                          background: subColor(s, liveSubs(p).findIndex((x) => x.id === s.id), color), color: C.ink,
                          borderLeft: "3px solid " + subEdge(liveSubs(p).findIndex((x) => x.id === s.id), color),
                          border: "none", cursor: "pointer",
                          borderLeftWidth: 3, borderLeftStyle: "solid",
                          borderLeftColor: subEdge(liveSubs(p).findIndex((x) => x.id === s.id), color),
                          fontSize: 9.5, fontWeight: 750, padding: "2px 5px", maxWidth: "100%" }}>
                        <span className="truncate" style={{ display: "block" }}>{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {rows.length === 0 ? (
                <div style={{ fontSize: 11, color: C.faint, padding: "2px 0" }}>할 일 없음</div>
              ) : (
                <Sortable items={rows.slice(0, 10)} idOf={(r) => r.id} deferred
                  onReorder={(next) => onReorderRows(rows, next)}
                  renderRow={(r, handle) => (
                <div draggable
                  onDragStart={(e) => {
                    dragRef.current = "todo:" + p.id + ":" + r.sid + ":" + r.id;
                    try {
                      e.dataTransfer.setData("text/todo", p.id + ":" + r.sid + ":" + r.id);
                      e.dataTransfer.setData("text/plain", r.text);
                    } catch (err) {}
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => { dragRef.current = ""; setOver(null); }}>
                <span className="flex items-start gap-1">
                <button {...handle} className="wb-btn shrink-0 flex items-center justify-center"
                  style={{ ...handle.style, background: "none", border: "none", color: "#D5DAD3", padding: 0, width: 10, marginTop: 5 }}
                  aria-label="할 일 순서 바꾸기">
                  <GripVertical size={10} strokeWidth={2} />
                </button>
                <span className="flex-1 min-w-0">
                <MiniTodo todo={r} dense autoEdit={focusId === r.id}
                  onToggle={() => onToggleTodo(p.id, r.sid, r.id)}
                  onEdit={(t) => onEditTodo(p.id, r.sid, r.id, t)}
                  onMove={(d) => onMoveTodo(p.id, r.sid, r.id, d)}
                  onAddAfter={() => setFocusId(onAddTodoAfter(p.id, r.sid, r.id))}
                  onRemoveEmpty={() => onToggleTodo(p.id, r.sid, r.id)}
                  right={r.inbox ? (
                    <button onClick={() => setAssign({ pid: p.id, kind: "todo", sid: r.sid, tid: r.id, text: r.text })}
                      className="wb-btn shrink-0 flex items-center justify-center rounded"
                      style={{ width: 16, height: 16, marginTop: 1, background: "#F1F3F0", border: "none",
                        color: C.muted, cursor: "pointer" }} title="세부사업 연결">
                      <CornerDownRight size={10} strokeWidth={2.6} />
                    </button>
                  ) : (
                    <button onClick={() => onOpenSub(p.id, r.sid)} title={r.sName + " 열기"}
                      className="wb-btn shrink-0 rounded"
                      style={{ width: 11, height: 11, marginTop: 4, background: r.hl,
                        border: "1.5px solid " + r.edge, cursor: "pointer", padding: 0 }} />
                  )} />
                </span></span>
                </div>
                  )} />
              )}
              {rows.length > 10 && (
                <button onClick={() => onOpen(p.id)} className="wb-btn"
                  style={{ background: "none", border: "none", color: C.faint, fontSize: 10, fontWeight: 650, cursor: "pointer", padding: "3px 0 0" }}>
                  외 {rows.length - 10}건
                </button>
              )}

              <QuickAdd placeholder="할 일 추가" onAdd={(t) => onQuickTodo(p.id, t)} />
            </div>
          );
        }} />

      {adding ? (
        <Card style={{ padding: 12 }}>
          <AddLine placeholder="새 사업 이름" onAdd={(t) => { onAdd(t); setAdding(false); }} />
        </Card>
      ) : (
        <button onClick={() => setAdding(true)} className="wb-btn inline-flex items-center justify-center gap-1.5 rounded-xl"
          style={{ background: C.surface, border: "1px dashed #C9CFC7", color: C.muted,
            fontSize: 12.5, fontWeight: 650, padding: "9px 0", cursor: "pointer" }}>
          <Plus size={14} strokeWidth={2.4} /> 사업 추가
        </button>
      )}

      {/* ── 아래: 생각나는 대로 ── */}
      <Card style={{ padding: "11px 13px" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Inbox size={14} color={C.navy} strokeWidth={2.3} />
          <Label>생각나는 대로</Label>
          {memos.length > 0 && (
            <span style={{ fontSize: 10, color: C.faint, marginLeft: "auto" }}>점 6개로 순서 · 폴더로 끌어다 놓기</span>
          )}
        </div>
        <Sortable items={memos} idOf={(m) => m.id} onReorder={onReorderMemos} deferred
          renderRow={(m, handle) => (
            <div draggable
              onDragStart={(e) => {
                dragRef.current = m.id;
                try {
                  e.dataTransfer.setData("text/memo", m.id);
                  e.dataTransfer.setData("text/plain", m.text);
                } catch (err) {}
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => { dragRef.current = ""; setOver(null); }}
              className="flex items-start gap-1" style={{ borderTop: "1px solid #F1F3F0" }}>
              <button {...handle} className="wb-btn shrink-0 flex items-center justify-center"
                style={{ ...handle.style, background: "none", border: "none", color: "#D5DAD3", padding: 0, width: 12, marginTop: 5 }}
                aria-label="메모 순서 바꾸기">
                <GripVertical size={12} strokeWidth={2} />
              </button>
              <div className="flex-1 min-w-0">
                <MiniTodo todo={m} dense autoEdit={focusId === m.id}
                  onToggle={() => onToggleMemo(m)}
                  onEdit={(t) => onEditMemo(m.id, t)}
                  onMove={(d) => onMoveMemo(m.id, d)}
                  onAddAfter={() => setFocusId(onAddMemoAfter(m.id))}
                  onRemoveEmpty={() => onToggleMemo(m)}
                  right={
                    <span className="shrink-0 inline-flex items-center gap-1">
                      <TimeTag item={m} />
                      <BucketPick item={m} onPick={(patch) => onSetMemoDue(m.id, patch)} />
                      <select value="" title="사업으로 보내기"
                        onChange={(e) => e.target.value && setAssign({ pid: e.target.value, kind: "memo", mid: m.id })}
                        className="rounded"
                        style={{ fontSize: 10, color: C.muted, background: "#F1F3F0", border: "none",
                          padding: "1px 3px", marginTop: 1, cursor: "pointer" }}>
                        <option value="">→</option>
                        {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </span>
                  } />
              </div>
            </div>
          )} />
        <QuickAdd placeholder="여기에 적어 두세요" onAdd={onAddMemo} />
      </Card>

      <Fold title="완료된 할 일" count={doneRows.length} tone={C.greenSoft}>
        {doneRows.map((r) => (
          <div key={r.id} className="flex items-center gap-1.5" style={{ padding: "4px 0" }}>
            <button onClick={() => onUndoTodo(r.pid, r.sid, r.id)} title="되돌리기"
              className="wb-btn flex items-center justify-center rounded shrink-0"
              style={{ width: 14, height: 14, border: "1.5px solid " + C.green,
                background: C.green, color: "#fff", cursor: "pointer" }}>
              <Check size={10} strokeWidth={3.4} />
            </button>
            <span className="flex-1 min-w-0" style={{ fontSize: 12, lineHeight: 1.4, color: C.faint,
              textDecoration: "line-through", wordBreak: "break-word" }}>{r.text}</span>
            <span className="shrink-0 truncate" style={{ fontSize: 9.5, color: C.faint, maxWidth: 70 }}>{shortName(r.pName)}</span>
            <button onClick={() => onPurgeTodo(r.pid, r.sid, r.id)} title="완전 삭제"
              className="wb-btn shrink-0 flex items-center" style={{ background: "none", border: "none", color: "#C6CCC5", cursor: "pointer", padding: "0 2px" }}>
              <Trash2 size={12} strokeWidth={2.2} />
            </button>
          </div>
        ))}
      </Fold>

      {assign && (() => {
        const p = data.projects.find((x) => x.id === assign.pid);
        if (!p) return null;
        const finish = (sid, newName) => {
          const target = sid || onCreateSub(p.id, newName);
          if (assign.kind === "memo") onDropMemo(assign.mid, p.id, target);
          else if (assign.kind === "move") onMoveTodoTo(assign.fromPid, assign.fromSid, assign.tid, p.id, target);
          else onAssign(p.id, assign.sid, assign.tid, target);
          setAssign(null);
        };
        return (
          <AssignSheet project={p} base={colorOf(p, data.projects.findIndex((x) => x.id === p.id))}
            title={assign.text || "어느 세부사업으로 보낼까요"}
            onPick={finish} onClose={() => setAssign(null)} />
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------
   세부사업 목록
------------------------------------------------------------------- */
function SubList({ project, color, notes, onOpen, onAdd, onDelete, onDeleteProject, onRename, onReorder, onColor, onGoNotes }) {
  const doneSubs = project.subs.filter((x) => !isInbox(x) && subDoneAll(x));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [openNotes, setOpenNotes] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>세부사업 {project.subs.filter((x) => !isInbox(x) && !subDoneAll(x)).length}건</Label>
        <div className="flex items-center gap-2">
          <ColorPicker color={color} onPick={onColor} />
          <button onClick={() => { if (editing) onRename(name.trim() || project.name); setEditing(!editing); }}
            className="wb-btn inline-flex items-center gap-1" style={{ background: "none", border: "none", color: C.muted, fontSize: 12.5, fontWeight: 650, cursor: "pointer" }}>
            <Pencil size={13} /> {editing ? "이름 저장" : "사업명 수정"}
          </button>
          <DeleteBtn onDelete={onDeleteProject} label="사업 삭제" />
        </div>
      </div>
      {editing && (
        <Card style={{ padding: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg"
            style={{ padding: "10px 12px", fontSize: 15, border: "1px solid " + C.rule, background: "#F7F8F6", outline: "none", color: C.ink }} />
        </Card>
      )}
      {notes.length > 0 && (
        <Card style={{ padding: "12px 14px", background: "#FBFCFA", borderLeft: "3px solid " + color }}>
          <button onClick={() => setOpenNotes(!openNotes)} className="wb-btn w-full flex items-center gap-2"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <Pin size={13} color={color} strokeWidth={2.4} />
            <Label>관련 메모 {notes.length}</Label>
            <ChevronRight size={15} color={C.faint}
              style={{ marginLeft: "auto", transform: openNotes ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
          </button>
          <div style={{ marginTop: 8 }}>
            {(openNotes ? notes : notes.slice(0, 2)).map((n, i) => (
              <div key={n.id} style={{ borderTop: i === 0 ? "none" : "1px solid " + C.rule, padding: "7px 0" }}>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: C.ink, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  display: openNotes ? "block" : "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {n.text}
                </div>
              </div>
            ))}
          </div>
          {(notes.length > 2 || openNotes) && (
            <button onClick={openNotes ? onGoNotes : () => setOpenNotes(true)} className="wb-btn"
              style={{ background: "none", border: "none", color: C.navy, fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: "4px 0 0" }}>
              {openNotes ? "메모함에서 편집" : "외 " + (notes.length - 2) + "건 더 보기"}
            </button>
          )}
        </Card>
      )}

      {project.subs.length === 0 && (
        <Card style={{ padding: 22, textAlign: "center", color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>
          이 사업에서 실제로 굴러가는 단위를 세부사업으로 만듭니다.<br />예: 상반기 부모교육, 또래상담자 양성 3차시
        </Card>
      )}

      <Sortable items={project.subs.filter((x) => !isInbox(x) && !subDoneAll(x))} idOf={(s) => s.id}
        onReorder={(next) => onReorder([...project.subs.filter(isInbox), ...next, ...project.subs.filter((x) => !isInbox(x) && subDoneAll(x))])}
        renderRow={(s, handle) => {
          const st = subStats(s);
          const t = dueTone(s.end);
          return (
            <div style={{ marginBottom: 12 }}>
              <Card style={{ padding: 15 }}>
                <div className="flex items-start gap-2">
                  <Handle props={handle} />
                  <button onClick={() => onOpen(s.id)} className="wb-btn flex-1 text-left min-w-0" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span style={{ fontSize: 15.5, fontWeight: 740 }}>{s.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0"><Dot color={color} size={8} /><ChevronRight size={17} color={C.faint} /></span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                      {s.start || s.end ? (
                        <Chip tone={t === "over" ? "neutral" : t === "soon" ? "amber" : "navy"}>
                          {fmtDateShort(s.start) || "?"} – {fmtDateShort(s.end) || "?"}{s.end ? ` · ${dLabel(s.end)}` : ""}
                        </Chip>
                      ) : <Chip>기간 미정</Chip>}
                      {(() => {
                        const m = docModeOf(s);
                        return m === "none" ? <Chip tone="neutral" icon={FileX}>서류 해당 없음</Chip>
                          : m === "expense" ? <Chip tone="amber" icon={Wallet}>지출 있음</Chip>
                          : <Chip tone="neutral" icon={WalletMinimal}>지출 없음</Chip>;
                      })()}
                      {st.docTotal === 0 ? null : st.docDone < st.docTotal ? <Chip tone="seal">서류 {st.docTotal - st.docDone}건</Chip> : <Chip tone="green" icon={Check}>서류 완비</Chip>}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Bar pct={st.pct} color={color} />
                      <span style={{ fontSize: 12, fontWeight: 750, color: st.pct === 100 ? C.green : C.muted, minWidth: 46, textAlign: "right" }}>{st.done}/{st.total}</span>
                    </div>
                  </button>
                </div>
                <div className="flex justify-end mt-1"><DeleteBtn onDelete={() => onDelete(s.id)} label="세부사업 삭제" /></div>
              </Card>
            </div>
          );
        }} />

      <Card style={{ padding: 13 }}><AddLine placeholder="새 세부사업 이름" onAdd={onAdd} /></Card>

      <Fold title="완료된 세부사업" count={doneSubs.length} tone={C.greenSoft}>
        {doneSubs.map((s2) => {
          const st2 = subStats(s2);
          return (
            <button key={s2.id} onClick={() => onOpen(s2.id)} className="wb-btn w-full text-left rounded-lg"
              style={{ background: C.surface, border: "1px solid " + C.rule, padding: "9px 11px",
                marginBottom: 6, cursor: "pointer" }}>
              <div className="flex items-center gap-2">
                <span className="truncate" style={{ fontSize: 13.5, fontWeight: 700 }}>{s2.name}</span>
                <span className="shrink-0" style={{ fontSize: 11, color: C.faint, marginLeft: "auto" }}>
                  {st2.done}/{st2.total} 완료
                </span>
                <ChevronRight size={13} color={C.faint} />
              </div>
              {(s2.start || s2.end) && (
                <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>
                  {fmtDateShort(s2.start) || "?"} – {fmtDateShort(s2.end) || "?"}
                </div>
              )}
            </button>
          );
        })}
      </Fold>
    </div>
  );
}

/* ------------------------------------------------------------------
   세부사업 상세
------------------------------------------------------------------- */
function SubDetail({ sub, color, onPatch, onToggleDoc, onAddTodo, onPatchTodo, onDeleteTodo, onReorderTodos }) {
  const st = subStats(sub);
  const open = sub.todos.filter((t) => !t.done);
  const done = sub.todos.filter((t) => t.done);
  const [showDone, setShowDone] = useState(false);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(sub.name);

  return (
    <div className="flex flex-col gap-3">
      <Card style={{ padding: 15, borderLeft: `4px solid ${color}` }}>
        <div className="flex items-center justify-between mb-2.5">
          <Label>사업 기간</Label>
          <button onClick={() => { if (editName) onPatch({ name: name.trim() || sub.name }); setEditName(!editName); }}
            className="wb-btn inline-flex items-center gap-1" style={{ background: "none", border: "none", color: C.muted, fontSize: 12.5, fontWeight: 650, cursor: "pointer" }}>
            <Pencil size={13} /> {editName ? "이름 저장" : "이름 수정"}
          </button>
        </div>
        {editName && (
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg mb-2.5"
            style={{ padding: "10px 12px", fontSize: 15, border: "1px solid " + C.rule, background: "#F7F8F6", outline: "none", color: C.ink }} />
        )}
        <div className="flex items-center gap-2">
          <input type="date" value={sub.start} onChange={(e) => onPatch({ start: e.target.value })} className="flex-1 rounded-lg"
            style={{ padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: "#F7F8F6", color: C.ink, minWidth: 0 }} />
          <span style={{ color: C.faint }}>–</span>
          <input type="date" value={sub.end} onChange={(e) => onPatch({ end: e.target.value })} className="flex-1 rounded-lg"
            style={{ padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule, background: "#F7F8F6", color: C.ink, minWidth: 0 }} />
        </div>
        {sub.end && (
          <div className="mt-2.5 flex items-center gap-2">
            <Chip tone={dueTone(sub.end) === "over" ? "seal" : dueTone(sub.end) === "soon" ? "amber" : "navy"} icon={CalendarDays}>종료 {dLabel(sub.end)}</Chip>
            <span style={{ fontSize: 12.5, color: C.muted }}>진행률 {st.pct}%</span>
          </div>
        )}
      </Card>

      <DocPanel sub={sub} onToggleDoc={onToggleDoc}
        onSetDocMode={(m) => onPatch({ docMode: m, hasExpense: m === "expense" })} />

      <Card style={{ padding: 15 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ListChecks size={15} color={color} strokeWidth={2.3} /><Label>할 일</Label>
            <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 650 }}>{st.todoDone}/{st.todoTotal}</span>
          </div>

        </div>

        <AddLine placeholder="할 일을 적고 Enter" onAdd={onAddTodo} />

        {open.length > 1 && (
          <div className="flex items-center gap-1 mt-3" style={{ fontSize: 11.5, color: C.faint }}>
            <GripVertical size={12} /> 손잡이를 끌어 우선순위를 바꿉니다
          </div>
        )}

        <div style={{ marginTop: 4 }}>
          {open.length === 0 && done.length === 0 && (
            <div style={{ fontSize: 13, color: C.faint, padding: "16px 0", textAlign: "center" }}>아직 등록된 할 일이 없습니다</div>
          )}
          <Sortable items={open} idOf={(t) => t.id} onReorder={onReorderTodos}
            renderRow={(t, handle) => (
              <div style={{ borderTop: "1px solid " + C.rule }}>
                <TodoRow todo={t} handle={handle} onToggle={() => onPatchTodo(t.id, { done: true })}
                  onPatch={(patch) => onPatchTodo(t.id, patch)} onDelete={() => onDeleteTodo(t.id)} />
              </div>
            )} />
        </div>
      </Card>

      <Fold title="완료된 할 일" count={done.length} tone={C.greenSoft}>
        {done.map((t) => (
          <div key={t.id} className="flex items-start gap-2" style={{ padding: "4px 0" }}>
            <button onClick={() => onPatchTodo(t.id, { done: false })} title="되돌리기"
              className="wb-btn flex items-center justify-center rounded shrink-0"
              style={{ width: 15, height: 15, marginTop: 2, border: "1.5px solid " + C.green,
                background: C.green, color: "#fff", cursor: "pointer" }}>
              <Check size={10} strokeWidth={3.4} />
            </button>
            <span className="flex-1 min-w-0" style={{ fontSize: 12.5, lineHeight: 1.4, color: C.faint,
              textDecoration: "line-through", wordBreak: "break-word" }}>{t.text}</span>
            <button onClick={() => onDeleteTodo(t.id)} title="완전 삭제"
              className="wb-btn shrink-0" style={{ background: "none", border: "none", color: "#C6CCC5", cursor: "pointer", padding: "0 2px", marginTop: 1 }}>
              <Trash2 size={12} strokeWidth={2.2} />
            </button>
          </div>
        ))}
      </Fold>
    </div>
  );
}

/* ------------------------------------------------------------------
   메모함 — 서식, 사진, 체크리스트
------------------------------------------------------------------- */
const NOTE_COLORS = [
  { k: "", bg: "#FFFFFF" }, { k: "y", bg: "#FDF6D8" }, { k: "g", bg: "#E7F2E9" },
  { k: "b", bg: "#E6EEF6" }, { k: "p", bg: "#F1E9F3" }, { k: "r", bg: "#FAE9E5" },
];
const noteBg = (k) => (NOTE_COLORS.find((c) => c.k === (k || "")) || NOTE_COLORS[0]).bg;
const TEXT_COLORS = [C.ink, C.seal, C.navy, C.green, C.amber, "#6B4A7A"];

/* 붙여넣기 등으로 들어온 위험한 태그를 걸러 냅니다 */
function cleanHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  d.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((el) => el.remove());
  d.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value) && el.tagName !== "IMG") el.removeAttribute(a.name);
    });
  });
  return d.innerHTML;
}
const escapeHtml = (t) =>
  String(t || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])).replace(/\n/g, "<br>");
const htmlToText = (html) => {
  const d = document.createElement("div");
  d.innerHTML = (html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|h1|h2)>/gi, "\n");
  return (d.textContent || "").trim();
};
/* 글 안의 첫 사진들을 꺼냅니다 */
const imagesIn = (html) => {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return [...d.querySelectorAll("img")].map((i) => i.getAttribute("src")).filter(Boolean);
};

/* 유튜브는 주소만으로 썸네일을 만들 수 있습니다 */
const youtubeId = (url) => {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : "";
};

/* 사진은 화면에 맞게 줄여서 담습니다 (동기화 용량 절약) */
function shrinkImage(file, maxPx = 1280, quality = 0.72) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onerror = () => rej(new Error("사진을 읽지 못했습니다"));
    rd.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("사진 형식을 알 수 없습니다"));
      img.onload = () => {
        const r = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * r), h = Math.round(img.height * r);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        res(cv.toDataURL("image/jpeg", quality));
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}

function ProjectPicker({ projects, pid, onPick }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button onClick={() => onPick("")} className="wb-btn rounded-full"
        style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
          background: !pid ? "#F1F3F0" : C.surface, color: !pid ? C.ink : C.faint,
          border: "1px solid " + (!pid ? "#C9CFC7" : C.rule) }}>
        사업 없음
      </button>
      {projects.map((p, i) => {
        const c = colorOf(p, i);
        const on = pid === p.id;
        return (
          <button key={p.id} onClick={() => onPick(p.id)} className="wb-btn inline-flex items-center gap-1.5 rounded-full"
            style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
              background: on ? c : C.surface, color: on ? "#fff" : C.muted,
              border: "1px solid " + (on ? c : C.rule), maxWidth: "100%" }}>
            {!on && <Dot color={c} size={7} />}
            <span className="truncate">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* 유튜브는 큰 그림으로, 나머지는 한 줄로 */
function LinkCard({ link, big }) {
  const [bad, setBad] = useState(false);
  const yt = youtubeId(link.url);
  if (yt && big) {
    return (
      <a href={link.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}
        className="block rounded-lg overflow-hidden"
        style={{ border: "1px solid " + C.rule, marginTop: 6, textDecoration: "none", color: C.ink,
          background: "rgba(255,255,255,0.75)" }}>
        <img src={"https://img.youtube.com/vi/" + yt + "/hqdefault.jpg"} alt=""
          style={{ width: "100%", display: "block", aspectRatio: "16/9", objectFit: "cover" }} />
        <span className="flex items-center gap-2" style={{ padding: "6px 8px" }}>
          <Youtube size={14} color="#C2402F" strokeWidth={2.2} className="shrink-0" />
          <span className="flex-1 min-w-0 truncate" style={{ fontSize: 11, fontWeight: 700 }}>youtube.com</span>
          <ChevronRight size={13} color={C.faint} />
        </span>
      </a>
    );
  }
  return (
    <a href={link.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 rounded-lg"
      style={{ background: "rgba(255,255,255,0.75)", border: "1px solid " + C.rule,
        padding: "6px 8px", marginTop: 6, textDecoration: "none", color: C.ink }}>
      {bad ? (
        <Globe size={14} color={C.faint} strokeWidth={2.2} className="shrink-0" />
      ) : (
        <img src={"https://www.google.com/s2/favicons?sz=64&domain=" + link.host} alt=""
          onError={() => setBad(true)} style={{ width: 15, height: 15, borderRadius: 3, flexShrink: 0 }} />
      )}
      <span className="flex-1 min-w-0">
        <span className="block truncate" style={{ fontSize: 11, fontWeight: 700 }}>{link.host}</span>
        <span className="block truncate" style={{ fontSize: 9.5, color: C.faint }}>{link.url}</span>
      </span>
      <ChevronRight size={12} color={C.faint} className="shrink-0" />
    </a>
  );
}

/* ── 새 메모 입력칸: 접혀 있다가 누르면 펼쳐집니다 ── */
function NoteComposer({ projects, onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [pid, setPid] = useState("");
  const [mode, setMode] = useState("text");
  const [items, setItems] = useState([]);
  const fileRef = useRef(null);
  const [imgHtml, setImgHtml] = useState("");

  const boxRef = useRef(null);
  const stateRef = useRef(null);

  const reset = () => { setTitle(""); setText(""); setPid(""); setMode("text"); setItems([]); setImgHtml(""); setOpen(false); };
  const save = () => {
    const hasBody = text.trim() || imgHtml || items.some((x) => x.text.trim());
    if (!title.trim() && !hasBody) { reset(); return; }
    onCreate({
      title: title.trim(),
      text: text.trim() || title.trim(),
      html: imgHtml + escapeHtml(text.trim()),
      mode, items: items.filter((x) => x.text.trim()),
      pid, color: "",
    });
    reset();
  };
  const addImage = async (file) => {
    if (!file) return;
    try {
      const url = await shrinkImage(file);
      setImgHtml((h) => h + `<div><img src="${url}" style="max-width:100%;border-radius:10px;display:block"></div>`);
      setOpen(true);
    } catch (e) {}
  };

  stateRef.current = save;          /* 항상 최신 저장 동작을 가리킵니다 */

  /* 바깥을 누르면 그대로 저장하고 닫힙니다 */
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) stateRef.current();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (!open) {
    return (
      <Card style={{ padding: "10px 12px" }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(true)} className="wb-btn flex-1 text-left"
            style={{ background: "none", border: "none", padding: "3px 0", cursor: "text",
              fontSize: 14, color: C.faint, fontWeight: 600 }}>
            메모 작성…
          </button>
          <button onClick={() => { setMode("check"); setItems([{ id: uid(), text: "", done: false }]); setOpen(true); }}
            title="목록으로" className="wb-btn shrink-0" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 3 }}>
            <CheckSquare size={17} strokeWidth={2.1} />
          </button>
          <button onClick={() => setOpen(true)} title="글쓰기"
            className="wb-btn shrink-0" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 3 }}>
            <Pencil size={17} strokeWidth={2.1} />
          </button>
          <button onClick={() => fileRef.current && fileRef.current.click()} title="사진 넣기"
            className="wb-btn shrink-0" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 3 }}>
            <ImagePlus size={17} strokeWidth={2.1} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { addImage(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: "12px 13px" }} innerRef={boxRef}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" autoFocus
        className="w-full" style={{ fontSize: 15, fontWeight: 700, color: C.ink, background: "transparent",
          border: "none", outline: "none", padding: "2px 0" }} />

      {imgHtml && (
        <div className="wb-note-preview" style={{ margin: "6px 0" }} dangerouslySetInnerHTML={{ __html: imgHtml }} />
      )}

      {mode === "check" ? (
        <div style={{ marginTop: 4 }}>
          <SubChecklist subs={items} onChange={setItems} hint={false} />
        </div>
      ) : (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.max(2, text.split("\n").length)}
          placeholder="메모 작성…" className="w-full"
          style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, background: "transparent", border: "none",
            outline: "none", resize: "none", padding: "4px 0", fontFamily: FONT }} />
      )}

      {projects.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <ProjectPicker projects={projects} pid={pid} onPick={setPid} />
        </div>
      )}

      <div className="flex items-center gap-1 mt-3">
        <button onClick={() => { setMode(mode === "check" ? "text" : "check"); if (mode !== "check" && !items.length) setItems([{ id: uid(), text: "", done: false }]); }}
          title="목록으로" className="wb-btn" style={{ background: mode === "check" ? "#E7EDF3" : "none", border: "none",
            color: mode === "check" ? C.navy : C.muted, cursor: "pointer", padding: 5, borderRadius: 8 }}>
          <CheckSquare size={16} strokeWidth={2.2} />
        </button>
        <button onClick={() => fileRef.current && fileRef.current.click()} title="사진 넣기"
          className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 5 }}>
          <ImagePlus size={16} strokeWidth={2.2} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { addImage(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        <button onClick={save} className="wb-btn"
          style={{ marginLeft: "auto", background: "none", border: "none", color: C.ink,
            fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: "5px 8px" }}>
          닫기
        </button>
      </div>
    </Card>
  );
}

/* ── 메모 편집기 ── */
function NoteEditor({ note, onPatch, onClose, onDelete, onDuplicate, projects }) {
  const ref = useRef(null);
  const dismiss = useDismiss(() => { save(); onClose(); });
  const fileRef = useRef(null);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState("");
  const [busy, setBusy] = useState("");
  const [pickedImg, setPickedImg] = useState(null);
  const mode = note.mode || "text";

  useEffect(() => {
    if (mode === "text" && ref.current && ref.current.innerHTML !== (note.html || "")) {
      ref.current.innerHTML = note.html || escapeHtml(note.text);
    }
  }, [note.id, mode]);

  const save = () => { if (ref.current) onPatch({ html: cleanHtml(ref.current.innerHTML) }); };
  const cmd = (c, v) => { document.execCommand(c, false, v); ref.current && ref.current.focus(); save(); };

  const addImage = async (file) => {
    if (!file) return;
    setBusy("사진을 넣는 중…");
    try {
      const url = await shrinkImage(file);
      const html = (ref.current ? cleanHtml(ref.current.innerHTML) : note.html || "") +
        `<div><img src="${url}" style="max-width:100%;border-radius:10px;display:block"></div><div><br></div>`;
      onPatch({ html });
      if (ref.current) ref.current.innerHTML = html;
    } catch (e) { setBusy(e.message); setTimeout(() => setBusy(""), 2500); return; }
    setBusy("");
  };

  /* 사진을 누르면 크기를 고를 수 있습니다 */
  const clickBody = (e) => {
    if (e.target && e.target.tagName === "IMG") setPickedImg(e.target);
    else setPickedImg(null);
  };
  const sizeImg = (pct) => {
    if (!pickedImg) return;
    pickedImg.style.width = pct === 100 ? "" : pct + "%";
    pickedImg.style.maxWidth = "100%";
    save();
  };

  const items = note.items || [];
  const setItems = (next) => onPatch({ items: next });

  const toolBtn = (icon, title, onClick, active) => {
    const Icon = icon;
    return (
      <button onClick={onClick} title={title} aria-label={title}
        className="wb-btn flex items-center justify-center rounded-lg shrink-0"
        style={{ width: 30, height: 30, cursor: "pointer", background: active ? "#E7EDF3" : "transparent",
          color: active ? C.navy : C.muted, border: "none" }}>
        <Icon size={15} strokeWidth={2.3} />
      </button>
    );
  };

  const links = findLinks(mode === "check" ? items.map((x) => x.text).join(" ") : (htmlToText(note.html) || note.text));

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade"
      style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet flex flex-col"
        style={{ maxWidth: 620, background: noteBg(note.color), border: "1px solid " + C.rule, maxHeight: "90vh" }}>

        <div className="flex items-center justify-between shrink-0" style={{ padding: "13px 15px 6px" }}>
          <input value={note.title || ""} onChange={(e) => onPatch({ title: e.target.value })} placeholder="제목"
            className="flex-1 min-w-0" style={{ fontSize: 16, fontWeight: 750, color: C.ink,
              background: "transparent", border: "none", outline: "none" }} />
          <button onClick={() => onPatch({ important: !note.important })} title="중요"
            className="wb-btn shrink-0" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <Star size={17} color={note.important ? C.amber : C.faint} fill={note.important ? C.amber : "none"} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: "0 15px" }}>
          {mode === "text" ? (
            <div ref={ref} contentEditable suppressContentEditableWarning onBlur={save} onClick={clickBody}
              onPaste={(e) => {
                const f = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
                if (f) { e.preventDefault(); addImage(f.getAsFile()); }
              }}
              className="wb-note"
              style={{ minHeight: 180, padding: "4px 2px", fontSize: 15, lineHeight: 1.75, color: C.ink,
                background: "transparent", border: "none", outline: "none", wordBreak: "break-word" }} />
          ) : (
            <div style={{ padding: "2px 0" }}>
              <SubChecklist subs={items} onChange={setItems} />
            </div>
          )}

          {pickedImg && mode === "text" && (
            <div className="flex items-center gap-1.5 rounded-xl mt-2" style={{ background: "rgba(255,255,255,0.8)", border: "1px solid " + C.rule, padding: 8 }}>
              <Label>사진 크기</Label>
              {[40, 70, 100].map((v) => (
                <button key={v} onClick={() => sizeImg(v)} className="wb-btn rounded-lg"
                  style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                    background: C.surface, border: "1px solid " + C.rule, color: C.ink }}>
                  {v === 40 ? "작게" : v === 70 ? "보통" : "크게"}
                </button>
              ))}
              <button onClick={() => { pickedImg.remove(); setPickedImg(null); save(); }} className="wb-btn rounded-lg"
                style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, padding: "4px 9px", cursor: "pointer",
                  background: C.sealSoft, border: "none", color: C.seal }}>
                사진 빼기
              </button>
            </div>
          )}

          {links.slice(0, 5).map((l) => <LinkCard key={l.url} link={l} big />)}

          {projects.length > 0 && (
            <div style={{ margin: "12px 0 4px" }}>
              <Label>사업 묶기</Label>
              <div className="mt-1.5">
                <ProjectPicker projects={projects} pid={note.pid || ""} onPick={(x) => onPatch({ pid: x })} />
              </div>
            </div>
          )}

          {palette === "note" && (
            <div className="flex items-center gap-2 flex-wrap rounded-xl" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid " + C.rule, padding: 10, marginTop: 10 }}>
              <Label>메모 색</Label>
              {NOTE_COLORS.map((c) => (
                <button key={c.k || "w"} onClick={() => { onPatch({ color: c.k }); setPalette(""); }}
                  className="wb-btn rounded-full" style={{ width: 25, height: 25, background: c.bg, cursor: "pointer",
                    border: (note.color || "") === c.k ? "2.5px solid " + C.ink : "1px solid " + C.rule }} />
              ))}
            </div>
          )}
          {palette === "text" && (
            <div className="flex items-center gap-2 flex-wrap rounded-xl" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid " + C.rule, padding: 10, marginTop: 10 }}>
              <Label>글자 색</Label>
              {TEXT_COLORS.map((c) => (
                <button key={c} onClick={() => { cmd("foreColor", c); setPalette(""); }}
                  className="wb-btn rounded-full" style={{ width: 25, height: 25, background: c, cursor: "pointer", border: "1px solid " + C.rule }} />
              ))}
            </div>
          )}
          {busy && <div style={{ fontSize: 12, color: C.muted, padding: "8px 2px" }}>{busy}</div>}
        </div>

        <div className="shrink-0" style={{ borderTop: "1px solid " + C.rule, padding: "8px 10px", position: "relative" }}>
          <div className="flex items-center gap-0.5 flex-wrap">
            {mode === "text" && (
              <>
                {toolBtn(Bold, "굵게", () => cmd("bold"))}
                {toolBtn(Italic, "기울임", () => cmd("italic"))}
                {toolBtn(Underline, "밑줄", () => cmd("underline"))}
                {toolBtn(Baseline, "글자 색", () => setPalette(palette === "text" ? "" : "text"), palette === "text")}
                <span style={{ width: 1, height: 20, background: C.rule, margin: "0 5px" }} />
              </>
            )}
            {toolBtn(ImagePlus, "사진 추가", () => fileRef.current && fileRef.current.click())}
            {toolBtn(Palette, "메모 색", () => setPalette(palette === "note" ? "" : "note"), palette === "note")}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2, position: "relative" }}>
              {toolBtn(MoreVertical, "더보기", () => setMenu(!menu), menu)}
              <button onClick={() => { save(); onClose(); }} className="wb-btn"
                style={{ background: "none", border: "none", color: C.ink, fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: "5px 8px" }}>
                닫기
              </button>
              {menu && (
                <div className="rounded-xl wb-fade" style={{ position: "absolute", right: 0, bottom: 36, background: C.surface,
                  border: "1px solid " + C.rule, boxShadow: "0 8px 24px rgba(26,33,30,0.16)", padding: 5, minWidth: 176, zIndex: 20 }}>
                  {[
                    { t: mode === "check" ? "일반 메모로 전환" : "체크박스 표시", i: CheckSquare, run: () => {
                        if (mode === "check") {
                          const html = items.map((x) => escapeHtml((x.done ? "✓ " : "· ") + x.text)).join("<br>");
                          onPatch({ mode: "text", html: (note.html || "") + (note.html && html ? "<br>" : "") + html });
                        } else {
                          const t = htmlToText(ref.current ? ref.current.innerHTML : note.html);
                          const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
                          onPatch({ mode: "check", items: lines.length ? lines.map((x) => ({ id: uid(), text: x, done: false })) : [{ id: uid(), text: "새 항목", done: false }] });
                        }
                      } },
                    { t: "사진 추가", i: ImagePlus, run: () => fileRef.current && fileRef.current.click() },
                    { t: note.important ? "중요 해제" : "중요 표시", i: Star, run: () => onPatch({ important: !note.important }) },
                    { t: "사본 만들기", i: Copy, run: () => { save(); onDuplicate(); } },
                    { t: "메모 삭제", i: Trash2, run: () => { onDelete(); }, danger: true },
                  ].map((o) => (
                    <button key={o.t} onClick={() => { setMenu(false); o.run(); }}
                      className="wb-btn w-full flex items-center gap-2 rounded-lg"
                      style={{ padding: "9px 10px", background: "none", border: "none", cursor: "pointer",
                        color: o.danger ? C.seal : C.ink, fontSize: 13, fontWeight: 650, textAlign: "left" }}>
                      <o.i size={14} strokeWidth={2.3} /> {o.t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { addImage(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

function NotesView({ notes, projects, onAdd, onPatch, onDelete, onReorder, onOpenProject }) {
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);

  const infoOf = (id) => {
    const i = projects.findIndex((p) => p.id === id);
    return i < 0 ? null : { p: projects[i], color: colorOf(projects[i], i) };
  };
  const base = filter === "all" ? notes : notes.filter((n) => (n.pid || "") === filter);
  const shown = [...base].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
  const open = notes.find((n) => n.id === openId) || null;

  return (
    <div className="flex flex-col gap-3">
      <NoteComposer projects={projects} onCreate={onAdd} />

      {notes.length > 1 && projects.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setFilter("all")} className="wb-btn rounded-full"
            style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
              background: filter === "all" ? C.navy : C.surface, color: filter === "all" ? "#fff" : C.muted,
              border: "1px solid " + (filter === "all" ? C.navy : C.rule) }}>
            전체 {notes.length}
          </button>
          {projects.map((p, i) => {
            const cnt = notes.filter((x) => x.pid === p.id).length;
            if (!cnt) return null;
            const c = colorOf(p, i), on = filter === p.id;
            return (
              <button key={p.id} onClick={() => setFilter(p.id)} className="wb-btn inline-flex items-center gap-1.5 rounded-full"
                style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
                  background: on ? c : C.surface, color: on ? "#fff" : C.muted,
                  border: "1px solid " + (on ? c : C.rule), maxWidth: "100%" }}>
                {!on && <Dot color={c} size={7} />}
                <span className="truncate">{p.name}</span> {cnt}
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <Card style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>
          {notes.length === 0
            ? <>메모함이 비어 있습니다.<br />처리할 일이 아니라 <b>기억해 둘 것</b>을 적는 곳입니다.</>
            : "이 사업으로 묶인 메모가 없습니다."}
        </Card>
      ) : (
        <Sortable items={shown} idOf={(n) => n.id} className="wb-masonry" deferred
          rowStyle={{ breakInside: "avoid", WebkitColumnBreakInside: "avoid", pageBreakInside: "avoid", display: "block" }}
          onReorder={(next) => onReorder(filter === "all" ? next : next.concat(notes.filter((n) => (n.pid || "") !== filter)))}
          renderRow={(n, handle) => {
            const info = infoOf(n.pid);
            const items = n.items || [];
            const done = items.filter((x) => x.done).length;
            const pics = imagesIn(n.html);
            const bodyText = (n.mode || "text") === "check" ? items.map((x) => x.text).join(" ") : (htmlToText(n.html) || n.text);
            const links = findLinks(bodyText);
            return (
              <div {...handle} onClick={() => setOpenId(n.id)}
                style={{ ...handle.style, cursor: "pointer" }}>
                <Card style={{ padding: 0, background: noteBg(n.color), overflow: "hidden" }}>

                  {pics.length > 0 && (
                    <div className="grid" style={{ gridTemplateColumns: pics.length > 1 ? "1fr 1fr" : "1fr", gap: 1 }}>
                      {pics.slice(0, 4).map((src, i) => (
                        <img key={i} src={src} alt=""
                          style={{ width: "100%", height: pics.length > 1 ? 62 : 92, objectFit: "cover", display: "block" }} />
                      ))}
                    </div>
                  )}

                  <div style={{ padding: 11 }}>
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {n.important && <Star size={13} color={C.amber} fill={C.amber} strokeWidth={2} />}
                      {info && (
                        <span className="inline-flex items-center gap-1 rounded-full"
                          style={{ background: "rgba(255,255,255,0.7)", border: "1px solid " + C.rule,
                            fontSize: 10, fontWeight: 750, padding: "1.5px 7px", maxWidth: "100%", color: C.ink }}>
                          <Dot color={info.color} size={6} /><span className="truncate">{info.p.name}</span>
                        </span>
                      )}
                      {items.length > 0 && <Chip tone={done === items.length ? "green" : "neutral"}>{done}/{items.length}</Chip>}
                    </div>

                    {n.title && (
                      <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 4, wordBreak: "break-word" }}>
                        {n.title}
                      </div>
                    )}

                    {(n.mode || "text") === "check" ? (
                      <div>
                        {items.slice(0, 8).map((it) => (
                          <div key={it.id} className="flex items-center gap-1.5" style={{ padding: "2px 0" }}>
                            <span className="rounded shrink-0" style={{ width: 12, height: 12,
                              border: "1.5px solid " + (it.done ? C.green : "#C6CCC5"), background: it.done ? C.green : "transparent" }} />
                            <span className="truncate" style={{ fontSize: 12.5, color: it.done ? C.faint : C.ink,
                              textDecoration: it.done ? "line-through" : "none" }}>{it.text}</span>
                          </div>
                        ))}
                        {items.length > 8 && <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>외 {items.length - 8}개</div>}
                      </div>
                    ) : (
                      <div className="wb-note-preview"
                        style={{ fontSize: 13, lineHeight: 1.6, wordBreak: "break-word", maxHeight: 300, overflow: "hidden" }}
                        dangerouslySetInnerHTML={{ __html: (n.html || escapeHtml(n.text)).replace(/<img[^>]*>/g, "") }} />
                    )}

                    {links.slice(0, 3).map((l) => <LinkCard key={l.url} link={l} big />)}

                    <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8 }}>
                      {new Date(n.updatedAt || n.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                    </div>
                  </div>
                </Card>
              </div>
            );
          }} />
      )}

      {open && (
        <NoteEditor note={open} projects={projects}
          onPatch={(patch) => onPatch(open.id, patch)}
          onClose={() => setOpenId(null)}
          onDelete={() => { setOpenId(null); onDelete(open); }}
          onDuplicate={() => { onAdd({ ...open, id: undefined }); setOpenId(null); }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   동기화 상태 배지
------------------------------------------------------------------- */
function SyncBadge({ state, on, onClick }) {
  const map = {
    off:     { i: CloudOff, fg: C.faint, bg: "#F1F3F0", t: "이 기기만" },
    syncing: { i: RefreshCw, fg: C.navy, bg: C.navySoft, t: "동기화 중" },
    ok:      { i: Cloud, fg: C.green, bg: C.greenSoft, t: "동기화됨" },
    error:   { i: CloudOff, fg: C.seal, bg: C.sealSoft, t: "연결 안 됨" },
  };
  const s = map[on ? state : "off"] || map.off;
  return (
    <button onClick={onClick} className="wb-btn inline-flex items-center gap-1 rounded-full"
      style={{ background: s.bg, color: s.fg, border: "none", padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
      <s.i size={13} strokeWidth={2.4} className={state === "syncing" && on ? "wb-spin" : ""} />
      <span className="hidden sm:inline">{s.t}</span>
    </button>
  );
}

/* ------------------------------------------------------------------
   설정 — 동기화 · 백업 · 복원
------------------------------------------------------------------- */
const SQL_SETUP = `create table if not exists boards (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table boards enable row level security;
create policy "anon all" on boards for all
  to anon using (true) with check (true);`;

const Field = ({ label, hint, value, onChange, placeholder, mono }) => (
  <div className="mb-3">
    <Label>{label}</Label>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-xl mt-1.5" spellCheck={false} autoCapitalize="none" autoCorrect="off"
      style={{ padding: "10px 12px", fontSize: mono ? 12 : 14, color: C.ink, background: C.surface,
        border: "1px solid " + C.rule, outline: "none", fontFamily: mono ? "ui-monospace, monospace" : FONT }} />
    {hint && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
  </div>
);

function Settings({ data, onClose, flash, sync, syncState, syncMsg, lastBackup, onDownload, onSaveSync, onSyncNow, onSignIn, onImport, locked, onSetLock, onClearLock }) {
  const dismiss = useDismiss(onClose);
  const [tab, setTab] = useState("sync");
  const [mode, setMode] = useState(sync.mode || "");
  const [form, setForm] = useState({ url: sync.url || "", key: sync.key || "", code: sync.code || "", clientId: sync.clientId || "" });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [showSql, setShowSql] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [noti, setNoti] = useState(() => notiSupported() && notiOn() && Notification.permission === "granted");
  const [text, setText] = useState("");
  const on = syncReady(sync);
  const json = JSON.stringify(data);

  const stat = (() => {
    const n = data.projects.reduce((a, p) => a + p.subs.length, 0);
    const t = data.projects.reduce((a, p) => a + p.subs.reduce((b, s) => b + s.todos.length, 0), 0);
    return `사업 ${data.projects.length} · 세부사업 ${n} · 할 일 ${t + data.memos.length} · 메모 ${(data.notes || []).length}`;
  })();

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center wb-fade" style={{ background: "rgba(26,33,30,0.4)", zIndex: 60 }} {...dismiss}>
      <div className="w-full rounded-t-3xl sm:rounded-3xl wb-sheet"
        style={{ maxWidth: 560, background: C.bg, border: "1px solid " + C.rule, maxHeight: "88vh", overflowY: "auto" }}>

        <div className="sticky top-0" style={{ background: C.bg, zIndex: 3, borderBottom: "1px solid " + C.rule }}>
          <div className="flex items-center justify-between" style={{ padding: "16px 18px 12px" }}>
            <div>
              <Label>데이터 관리</Label>
              <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
                <span style={{ fontSize: 17, fontWeight: 780 }}>동기화와 백업</span>
                <span className="rounded-full" style={{ fontSize: 10.5, fontWeight: 700, color: C.faint, background: "#F1F3F0", padding: "2px 8px" }}>
                  {APP_VERSION}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="wb-btn" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={20} /></button>
          </div>
          <div className="flex" style={{ padding: "0 18px 12px", gap: 3 }}>
            {[{ k: "sync", t: "기기 간 동기화" }, { k: "backup", t: "백업 파일" }].map((o) => {
              const sel = tab === o.k;
              return (
                <button key={o.k} onClick={() => setTab(o.k)} className="wb-btn flex-1 rounded-lg"
                  style={{ padding: "8px 6px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    background: sel ? C.surface : "transparent", color: sel ? C.ink : C.faint,
                    border: "1px solid " + (sel ? C.rule : "transparent") }}>{o.t}</button>
              );
            })}
          </div>
        </div>

        {/* ── 동기화 ── */}
        {tab === "sync" && (
          <div style={{ padding: 18 }}>
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div className="flex items-center gap-2 mb-1.5">
                {on ? <Cloud size={16} color={syncState === "error" ? C.seal : syncState === "signin" ? C.amber : C.green} strokeWidth={2.3} />
                    : <CloudOff size={16} color={C.faint} strokeWidth={2.3} />}
                <span style={{ fontSize: 14, fontWeight: 750 }}>
                  {!on ? "이 기기에만 저장 중"
                    : syncState === "error" ? "연결하지 못했습니다"
                    : syncState === "signin" ? "구글 로그인이 필요합니다"
                    : sync.mode === "gdrive" ? "구글 드라이브에 저장 중" : "Supabase에 저장 중"}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55 }}>
                {!on
                  ? "지금은 이 브라우저 안에만 남습니다. 아래에서 방식을 고르면 사무실 PC와 휴대폰이 자동으로 이어지고, 브라우저 기록을 지워도 내용이 남습니다."
                  : syncState === "error" ? (syncMsg || "잠시 뒤 다시 시도해 주세요.")
                  : syncState === "signin" ? "아래 버튼으로 구글 계정에 다시 연결해 주세요. 그 사이에도 이 기기에서는 그대로 쓰실 수 있습니다."
                  : "바꾸면 자동으로 올라가고, 앱을 열 때마다 최신 내용을 받아옵니다." + (sync.lastAt ? " 마지막 확인 " + new Date(sync.lastAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "")}
              </div>
              {on && (
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {sync.mode === "gdrive" && syncState === "signin" && <Btn size="sm" kind="solid" icon={LogIn} onClick={onSignIn}>구글 로그인</Btn>}
                  <Btn size="sm" icon={RefreshCw} onClick={onSyncNow}>지금 확인</Btn>
                  <Btn size="sm" onClick={() => { onSaveSync({}); setMode(""); flash("동기화를 껐습니다"); }}>동기화 끄기</Btn>
                </div>
              )}
            </Card>

            {/* 잠금 */}
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div className="flex items-center gap-2 mb-1.5">
                {locked ? <Lock size={15} color={C.green} strokeWidth={2.3} /> : <Unlock size={15} color={C.faint} strokeWidth={2.3} />}
                <span style={{ fontSize: 14, fontWeight: 750 }}>비밀번호 잠금</span>
                <span className="rounded-full" style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 750,
                  padding: "2px 8px", background: locked ? C.greenSoft : "#F1F3F0", color: locked ? C.green : C.faint }}>
                  {locked ? "켜짐" : "꺼짐"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                화면만 가리는 것이 아니라 <b style={{ color: C.ink }}>저장되는 내용 자체를 잠급니다.</b>
                기기와 클라우드 양쪽에 암호문으로 저장돼, 파일을 열어도 내용이 보이지 않습니다.
              </div>
              {!locked ? (
                <div className="mt-3">
                  <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="비밀번호"
                    className="w-full rounded-lg" style={{ padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule,
                      background: C.surface, outline: "none", color: C.ink, marginBottom: 6 }} />
                  <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="한 번 더"
                    className="w-full rounded-lg" style={{ padding: "9px 11px", fontSize: 13.5, border: "1px solid " + C.rule,
                      background: C.surface, outline: "none", color: C.ink, marginBottom: 8 }} />
                  <div style={{ fontSize: 11.5, color: C.seal, lineHeight: 1.55, marginBottom: 8 }}>
                    잊으면 되살릴 수 없습니다. 켜기 전에 <b>백업 파일을 꼭 받아 두세요.</b>
                  </div>
                  <Btn kind="solid" full icon={Lock}
                    disabled={pw1.length < 4 || pw1 !== pw2}
                    onClick={() => onSetLock(pw1)}>
                    {pw1 && pw1 !== pw2 ? "두 번 입력이 다릅니다" : pw1.length < 4 ? "4자 이상" : "잠금 켜기"}
                  </Btn>
                </div>
              ) : (
                <div className="mt-3">
                  <Btn full icon={Unlock} onClick={onClearLock}>잠금 끄기</Btn>
                </div>
              )}
            </Card>

            {/* 일정 알림 */}
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div className="flex items-center gap-2 mb-1.5">
                <Bell size={15} color={noti ? C.green : C.faint} strokeWidth={2.3} />
                <span style={{ fontSize: 14, fontWeight: 750 }}>일정 알림</span>
                <button onClick={async () => {
                    if (!notiSupported()) { flash("이 브라우저는 알림을 지원하지 않습니다"); return; }
                    if (noti) { notiSet(false); setNoti(false); flash("알림을 껐습니다"); return; }
                    const r = await Notification.requestPermission();
                    if (r === "granted") { notiSet(true); setNoti(true); flash("알림을 켰습니다"); }
                    else flash("브라우저에서 알림이 차단돼 있습니다");
                  }}
                  className="wb-btn rounded-lg" style={{ marginLeft: "auto", padding: "5px 11px", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", background: noti ? C.greenSoft : C.navy, color: noti ? C.green : "#fff",
                    border: "1px solid " + (noti ? C.greenSoft : C.navy) }}>
                  {noti ? "켜짐" : "알림 켜기"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                시간을 지정한 할 일이 그 시각이 되면 알려 줍니다.
                <b style={{ color: C.ink }}> 앱이 열려 있을 때만</b> 동작하며, 완전히 닫으면 알림이 오지 않습니다.
              </div>
            </Card>

            {/* 방식 고르기 */}
            <Label>동기화 방식</Label>
            <div className="flex flex-col gap-2 mt-2 mb-4">
              {[
                { k: "gdrive", t: "구글 드라이브", d: "내 구글 계정으로 로그인해서 연동합니다. 데이터는 내 드라이브 안 파일 하나로 저장됩니다.", i: HardDrive },
                { k: "supabase", t: "Supabase", d: "무료 데이터베이스를 직접 만들어 연결합니다. 구글 계정이 필요 없습니다.", i: Database },
              ].map((o) => {
                const sel = mode === o.k;
                return (
                  <button key={o.k} onClick={() => setMode(o.k)} className="wb-btn rounded-xl text-left"
                    style={{ background: sel ? C.navySoft : C.surface, border: "1px solid " + (sel ? C.navy : C.rule), padding: "12px 13px", cursor: "pointer" }}>
                    <div className="flex items-center gap-2">
                      <o.i size={15} color={sel ? C.navy : C.faint} strokeWidth={2.3} />
                      <span style={{ fontSize: 14, fontWeight: 750, color: sel ? C.navy : C.ink }}>{o.t}</span>
                      {sync.mode === o.k && on && <Chip tone="green" style={{ marginLeft: "auto" }}>사용 중</Chip>}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 4 }}>{o.d}</div>
                  </button>
                );
              })}
            </div>

            {/* 구글 드라이브 */}
            {mode === "gdrive" && (
              <>
                <Card style={{ padding: 14, marginBottom: 14 }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <ShieldCheck size={14} color={C.navy} /><Label>준비 (처음 한 번만)</Label>
                  </div>
                  <ol style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.75, paddingLeft: 17, margin: 0 }}>
                    <li><b style={{ color: C.ink }}>console.cloud.google.com</b>에서 프로젝트를 하나 만듭니다</li>
                    <li><b style={{ color: C.ink }}>API 및 서비스 → 라이브러리</b>에서 <b style={{ color: C.ink }}>Google Drive API</b>를 사용 설정합니다</li>
                    <li><b style={{ color: C.ink }}>OAuth 동의 화면</b>을 외부(External)로 만들고, 테스트 사용자에 <b style={{ color: C.ink }}>본인 이메일</b>을 추가합니다</li>
                    <li><b style={{ color: C.ink }}>사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션</b>을 만들고, 승인된 자바스크립트 원본에 아래 주소를 넣습니다</li>
                  </ol>
                  <div className="flex items-center gap-2 mt-2.5 rounded-lg" style={{ background: "#F7F8F6", border: "1px solid " + C.rule, padding: "8px 10px" }}>
                    <code style={{ fontSize: 12, color: C.ink, flex: 1, wordBreak: "break-all" }}>{origin}</code>
                    <button onClick={() => { navigator.clipboard?.writeText(origin); flash("주소를 복사했습니다"); }}
                      className="wb-btn shrink-0" style={{ background: "none", border: "none", color: C.navy, cursor: "pointer" }}>
                      <Copy size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, lineHeight: 1.55 }}>
                    지금 보고 계신 이 주소입니다. PC와 휴대폰이 같은 주소를 쓰므로 한 번만 넣으면 됩니다.
                  </div>
                </Card>

                <Field label="OAUTH 클라이언트 ID" value={form.clientId} mono
                  onChange={(v) => setForm({ ...form, clientId: v.trim() })}
                  placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
                  hint="위 4단계에서 발급받은 값입니다. 비밀번호가 아니며, 이 기기에만 저장됩니다." />

                <Btn kind="solid" full icon={LogIn} disabled={!form.clientId}
                  onClick={async () => { await onSaveSync({ mode: "gdrive", clientId: form.clientId }); onSignIn(); }}>
                  구글 계정으로 연결하기
                </Btn>

                <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.65, marginTop: 12 }}>
                  이 앱은 <b style={{ color: C.muted }}>자기가 만든 파일 하나</b>에만 접근합니다. 드라이브의 다른 문서는 읽지 못합니다.
                  파일은 내 드라이브에 <code style={{ fontSize: 11 }}>workboard-data.json</code>으로 보입니다.
                </div>
              </>
            )}

            {/* Supabase */}
            {mode === "supabase" && (
              <>
                <Card style={{ padding: 14, marginBottom: 14 }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <ShieldCheck size={14} color={C.navy} /><Label>준비 (처음 한 번만, 약 5분)</Label>
                  </div>
                  <ol style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.75, paddingLeft: 17, margin: 0 }}>
                    <li><b style={{ color: C.ink }}>supabase.com</b>에서 무료 가입 후 프로젝트를 만듭니다</li>
                    <li>왼쪽 <b style={{ color: C.ink }}>SQL Editor</b>에서 아래 문장을 붙여 넣고 실행합니다</li>
                    <li><b style={{ color: C.ink }}>Settings → API</b>에서 Project URL과 anon public 키를 복사합니다</li>
                    <li>같은 세 칸을 휴대폰에서도 똑같이 넣습니다</li>
                  </ol>
                  <button onClick={() => setShowSql(!showSql)} className="wb-btn mt-2.5"
                    style={{ background: "none", border: "none", color: C.navy, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                    {showSql ? "SQL 접기" : "실행할 SQL 보기"}
                  </button>
                  {showSql && (
                    <>
                      <textarea readOnly value={SQL_SETUP} rows={9} onFocus={(e) => e.target.select()} className="w-full rounded-xl mt-2"
                        style={{ padding: 11, fontSize: 11, fontFamily: "ui-monospace, monospace", background: C.surface, border: "1px solid " + C.rule, color: C.muted, outline: "none" }} />
                      <Btn size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(SQL_SETUP); flash("SQL을 복사했습니다"); }}>복사</Btn>
                    </>
                  )}
                </Card>

                <Field label="PROJECT URL" value={form.url} mono
                  onChange={(v) => setForm({ ...form, url: v })} placeholder="https://xxxxxxxx.supabase.co" />
                <Field label="ANON PUBLIC KEY" value={form.key} mono
                  onChange={(v) => setForm({ ...form, key: v })} placeholder="eyJhbGciOi..."
                  hint="Settings → API의 anon public 키입니다. service_role 키는 절대 쓰지 마세요." />
                <Field label="보드 이름" value={form.code}
                  onChange={(v) => setForm({ ...form, code: v })} placeholder="예: gs-2026"
                  hint="기기끼리 같은 내용을 보려면 이 값이 서로 같아야 합니다. 남이 추측하기 어렵게 지어 주세요." />

                <Btn kind="solid" full icon={Cloud}
                  disabled={!(form.url && form.key && form.code)}
                  onClick={async () => { await onSaveSync({ mode: "supabase", url: cleanUrl(form.url), key: form.key, code: form.code }); flash("동기화를 켰습니다"); }}>
                  동기화 켜기
                </Btn>

                <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.6, marginTop: 12 }}>
                  anon 키는 이 기기 안에만 저장됩니다. 다만 보드 이름을 아는 사람은 내용을 볼 수 있으니, 내담자 개인정보는 넣지 마세요.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── 백업 ── */}
        {tab === "backup" && (
          <div style={{ padding: 18 }} className="flex flex-col gap-4">
            <Card style={{ padding: 14 }}>
              <div className="flex items-center gap-1.5 mb-2"><Download size={14} color={C.navy} /><Label>내보내기</Label></div>
              <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 3 }}>{stat}</div>
              <div style={{ fontSize: 11.5, color: lastBackup ? C.faint : C.amber, fontWeight: lastBackup ? 400 : 700, marginBottom: 10 }}>
                {lastBackup ? `마지막 백업 ${new Date(lastBackup).toLocaleDateString("ko-KR")}` : "아직 백업한 적이 없습니다"}
              </div>
              <Btn kind="solid" full icon={Download} onClick={onDownload}>백업 파일 내려받기</Btn>
              <textarea readOnly value={json} rows={3} onFocus={(e) => e.target.select()} className="w-full rounded-xl mt-2.5"
                style={{ padding: 11, fontSize: 11, fontFamily: "ui-monospace, monospace", background: C.surface, border: "1px solid " + C.rule, color: C.muted, outline: "none" }} />
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5 }}>파일로 받아 두거나 위 내용을 복사해 보관하세요.</div>
            </Card>

            <Card style={{ padding: 14 }}>
              <div className="flex items-center gap-1.5 mb-2"><Upload size={14} color={C.seal} /><Label>가져오기</Label></div>
              <input type="file" accept="application/json,.json" className="w-full rounded-xl mb-2"
                style={{ padding: 9, fontSize: 12, background: C.surface, border: "1px solid " + C.rule, color: C.muted }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  const rd = new FileReader();
                  rd.onload = () => setText(String(rd.result || ""));
                  rd.readAsText(f);
                }} />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="백업 파일을 고르거나 내용을 붙여 넣으세요"
                className="w-full rounded-xl"
                style={{ padding: 11, fontSize: 11, fontFamily: "ui-monospace, monospace", background: C.surface, border: "1px solid " + C.rule, color: C.ink, outline: "none" }} />
              <div style={{ fontSize: 12, color: C.seal, margin: "6px 0 9px", lineHeight: 1.5 }}>
                가져오면 지금 내용이 모두 바뀝니다. 동기화 중이라면 다른 기기에도 그대로 반영됩니다.
              </div>
              <Btn kind="seal" full icon={Upload} disabled={!text.trim()}
                onClick={() => {
                  try {
                    const p = JSON.parse(text);
                    if (!p || !Array.isArray(p.projects)) throw new Error("형식 오류");
                    onImport(p); onClose();
                  } catch (e) { flash("형식이 맞지 않습니다"); }
                }}>이 내용으로 덮어쓰기</Btn>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   부트스트랩
------------------------------------------------------------------- */
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")).render(<WorkBoard />);
