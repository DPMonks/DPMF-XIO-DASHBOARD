export const PUBLIC_SITE_ORIGIN = "https://xio-exchange.dpmf.technology";
export const INDEXER_ORIGIN = "https://dpmf-xio-indexer-TEST.up.railway.app";
export const DEXSCREENER_ORIGINS =
  "https://dexscreener.com https://www.dexscreener.com https://cdn.dexscreener.com https://*.dexscreener.com";

export function isAllowedDashboardOrigin(origin) {
  const text = String(origin || "").trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = String(url.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return true;
    return host === "dpmf.technology" || host.endsWith(".dpmf.technology");
  } catch {
    return false;
  }
}

export function contentSecurityPolicy({ development = false } = {}) {
  const script = development ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  const connect = [
    "'self'",
    "https://xumm.app",
    "wss://xumm.app",
    "https://api.xrpl.to",
    INDEXER_ORIGIN,
    DEXSCREENER_ORIGINS,
    development ? "ws://localhost:5173 http://localhost:5173 ws://127.0.0.1:5173" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://xumm.app ${PUBLIC_SITE_ORIGIN} ${DEXSCREENER_ORIGINS}`,
    "font-src 'self' data:",
    `connect-src ${connect}`,
    `frame-src ${DEXSCREENER_ORIGINS}`,
    "frame-ancestors 'self' https://dpmf.technology https://*.dpmf.technology https://xumm.app https://*.xumm.app https://xaman.app https://*.xaman.app",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    development ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

export function securityHeaders({ development = false } = {}) {
  return {
    "content-security-policy": contentSecurityPolicy({ development }),
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-dns-prefetch-control": "off",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
    "cross-origin-opener-policy": "same-origin",
    "x-permitted-cross-domain-policies": "none",
  };
}

export function applySecurityHeaders(res, options = {}) {
  if (!res?.setHeader) return;
  for (const [key, value] of Object.entries(securityHeaders(options))) {
    if (!res.getHeader?.(key)) res.setHeader(key, value);
  }
}
