import {PUBLIC_SITE_ORIGIN} from "./headers.js";

const TRACKER_HOST_RE =
  /(?:^|\.)(?:google-analytics|googletagmanager|doubleclick|googleadservices|hotjar|facebook|scorecardresearch|ipwho\.is|ipapi\.co|adsystem|tiktok|snapchat)\b/i;

export function isTrackerHost(host) {
  return TRACKER_HOST_RE.test(String(host || ""));
}

export function trustedScriptUrl(href, pageOrigin = PUBLIC_SITE_ORIGIN) {
  const src = String(href || "").trim();
  if (!src) return true;
  try {
    const url = new URL(src, pageOrigin);
    const page = new URL(pageOrigin);
    if (url.origin === page.origin) return true;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return page.hostname === "localhost" || page.hostname === "127.0.0.1";
    }
    return false;
  } catch {
    return false;
  }
}

export function shouldStripInjectedNode(node, pageOrigin = PUBLIC_SITE_ORIGIN) {
  const tag = String(node?.tagName || "").toUpperCase();
  if (tag === "SCRIPT") {
    const src = node.getAttribute?.("src") || node.src || "";
    if (!src) return false;
    if (!trustedScriptUrl(src, pageOrigin)) return true;
    try {
      return isTrackerHost(new URL(src, pageOrigin).hostname);
    } catch {
      return true;
    }
  }
  if (tag === "IFRAME" || tag === "IMG") {
    const src = node.getAttribute?.("src") || node.src || "";
    if (!src) return false;
    try {
      return isTrackerHost(new URL(src, pageOrigin).hostname);
    } catch {
      return false;
    }
  }
  return false;
}

export function installPlatformGuard(target = typeof document !== "undefined" ? document : null) {
  if (!target?.documentElement || typeof MutationObserver === "undefined") return null;
  const pageOrigin =
    typeof location !== "undefined" && location.origin ? location.origin : PUBLIC_SITE_ORIGIN;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (shouldStripInjectedNode(node, pageOrigin)) {
          node.parentNode?.removeChild(node);
        }
      }
    }
  });
  observer.observe(target.documentElement, { childList: true, subtree: true });
  return observer;
}
