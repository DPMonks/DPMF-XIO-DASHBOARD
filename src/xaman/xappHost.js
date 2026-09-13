export const XAPP_HOST_KEY = "dpmf-xapp-host";
export const XAPP_STYLE_KEY = "dpmf-xapp-style";

export function isXappOtt(value) {
  const raw = String(value || "").trim();
  return /^[0-9a-f-]{16,80}$/i.test(raw);
}

export function readXappLaunch(search = typeof window !== "undefined" ? window.location.search : "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const token = String(params.get("xAppToken") || params.get("xapptoken") || "").trim();
  const style = String(params.get("xAppStyle") || params.get("xappstyle") || "").trim();
  return {
    token: isXappOtt(token) ? token : "",
    style,
  };
}

function storeOf(name) {
  try {
    const store = globalThis[name];
    if (store && typeof store.getItem === "function") return store;
  } catch {
    // private mode
  }
  return null;
}

export function rememberXappHost(active, style = "") {
  const session = storeOf("sessionStorage");
  const local = storeOf("localStorage");
  try {
    if (active) {
      session?.setItem(XAPP_HOST_KEY, "1");
      if (style) session?.setItem(XAPP_STYLE_KEY, style);
    } else {
      session?.removeItem(XAPP_HOST_KEY);
      session?.removeItem(XAPP_STYLE_KEY);
    }
    // Never persist the host flag in localStorage — a later browser visit
    // must still show the QR / deeplink flow.
    local?.removeItem(XAPP_HOST_KEY);
    local?.removeItem(XAPP_STYLE_KEY);
  } catch {
    // ignore
  }
}

export function isXappWebView(win = typeof window !== "undefined" ? window : null) {
  return typeof win?.ReactNativeWebView?.postMessage === "function";
}

export function isXappHost(search, win = typeof window !== "undefined" ? window : null) {
  if (readXappLaunch(search ?? win?.location?.search).token) return true;
  return isXappWebView(win);
}

export function applyXappBootClass(win = typeof window !== "undefined" ? window : null) {
  if (!win?.document?.documentElement) return false;
  if (!isXappHost(win.location?.search, win)) return false;
  win.document.documentElement.classList.add("xapp");
  win.document.body?.classList?.add?.("xapp");
  return true;
}

export function xappCommand(command, extra = {}) {
  const body = { command, ...extra };
  return JSON.stringify(body);
}

export function sendXappCommand(command, extra = {}, win = typeof window !== "undefined" ? window : null) {
  if (!command) return false;
  const payload = xappCommand(command, extra);
  try {
    if (typeof win?.ReactNativeWebView?.postMessage === "function") {
      win.ReactNativeWebView.postMessage(payload);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function notifyXappReady(win) {
  return sendXappCommand("ready", {}, win);
}

export function openXappSignRequest(uuid, win) {
  const id = String(uuid || "").trim();
  if (!id) return false;
  return sendXappCommand("openSignRequest", { uuid: id }, win);
}

export function openXappBrowser(url, win) {
  const href = String(url || "").trim();
  if (!href) return false;
  return sendXappCommand("openBrowser", { url: href }, win);
}

export function closeXapp(win) {
  return sendXappCommand("close", {}, win);
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function openExternalUrl(url, win = typeof window !== "undefined" ? window : null) {
  const href = String(url || "").trim();
  if (!isHttpUrl(href)) return false;
  if (isXappHost(undefined, win)) {
    return openXappBrowser(href, win);
  }
  try {
    win?.open?.(href, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

export function parseXappNativeEvent(raw) {
  let data = raw;
  if (raw && typeof raw === "object" && typeof raw.data !== "undefined") {
    data = raw.data;
  }
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const method = String(data.method || data.event || data.type || "").toLowerCase();
  const reason = String(data.reason || "").toUpperCase();
  const uuid = String(data.uuid || data.payload?.uuid || "").trim();
  if (!method && !reason && !uuid) return null;
  return {
    method,
    reason,
    uuid,
    signed: reason === "SIGNED" || data.signed === true,
    declined: reason === "DECLINED" || reason === "REJECTED" || data.signed === false,
  };
}

export function isXappPayloadEvent(event) {
  if (!event) return false;
  const method = String(event.method || "");
  if (method.includes("payload")) return true;
  return Boolean(event.signed || event.declined || event.uuid);
}

export function listenXappEvents(onEvent, win = typeof window !== "undefined" ? window : null) {
  if (!win || typeof onEvent !== "function") return () => {};
  const handle = (event) => {
    const parsed = parseXappNativeEvent(event);
    if (parsed) onEvent(parsed);
  };
  win.addEventListener?.("message", handle);
  win.document?.addEventListener?.("message", handle);
  return () => {
    win.removeEventListener?.("message", handle);
    win.document?.removeEventListener?.("message", handle);
  };
}

export function stripXappSearchParams(win = typeof window !== "undefined" ? window : null) {
  if (!win?.location || !win.history?.replaceState) return;
  const url = new URL(win.location.href);
  let dirty = false;
  for (const key of ["xAppToken", "xapptoken", "xAppStyle", "xappstyle"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      dirty = true;
    }
  }
  if (dirty) win.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export async function resolveXappOtt(token, fetchImpl = fetch) {
  const id = String(token || "").trim();
  if (!isXappOtt(id)) return null;
  const response = await fetchImpl(`/api/xaman/xapp-ott?token=${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  return data && typeof data === "object" ? data : null;
}
