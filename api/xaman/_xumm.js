const AUTH_CODES = new Set([810, 811, 812, 813]);

export function cleanCredential(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

export function xummCredential(...names) {
  for (const name of names) {
    const value = cleanCredential(process.env[name]);
    if (value) return value;
  }
  return "";
}

export function xummKey() {
  return xummCredential("XUMM_API_KEY", "XUMM_APIKEY", "VITE_XUMM_API_KEY", "VITE_XUMM_APIKEY");
}

export function xummSecret() {
  return xummCredential(
    "XUMM_API_SECRET",
    "XUMM_APISECRET",
    "VITE_XUMM_API_SECRET",
    "VITE_XUMM_APISECRET"
  );
}

export function xummConfigured() {
  return {
    key: Boolean(xummKey()),
    secret: Boolean(xummSecret()),
  };
}

export const PUBLIC_SITE_ORIGIN = "https://dpmf-xio-dashboard-test.vercel.app";

export function publicSiteOrigin() {
  const fromEnv = xummCredential("PUBLIC_SITE_URL", "SITE_ORIGIN");
  return (fromEnv || PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
}

export function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(host || "").trim());
}

export function isVercelHost(host) {
  const name = String(host || "").trim().toLowerCase();
  // App hosts only — not vercel.com project/login URLs.
  return name.endsWith(".vercel.app");
}

export function isPublicSiteHost(host) {
  const name = String(host || "").trim().toLowerCase();
  return name === "xio-exchange.dpmf.technology" || name.endsWith(".dpmf.technology");
}

export function siteOriginFrom(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return publicSiteOrigin();
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    if (isLocalHost(url.host)) {
      return `${url.protocol}//${url.host}`.replace(/\/$/, "");
    }
    if (isVercelHost(url.host)) {
      // Keep the live dashboard host (test Vercel) so Xaman returns here.
      return `${url.protocol}//${url.host}`.replace(/\/$/, "");
    }
    if (!isPublicSiteHost(url.host)) {
      return publicSiteOrigin();
    }
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch {
    return publicSiteOrigin();
  }
}

export function requestOrigin(req) {
  const headers = req?.headers || {};
  const proto = String(headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = String(headers["x-forwarded-host"] || headers.host || "")
    .split(",")[0]
    .trim();
  if (isLocalHost(host)) {
    return `${proto === "https" ? "https" : "http"}://${host}`.replace(/\/$/, "");
  }
  if (!host) return publicSiteOrigin();
  return siteOriginFrom(`${proto}://${host}`);
}

export function shouldSubmitTxjson(txjson) {
  const type = txjson?.TransactionType;
  return Boolean(type && type !== "SignIn");
}

export function xamanReturnUrl(origin) {
  return `${siteOriginFrom(origin)}/?xaman={id}`;
}

export function xamanSignIdentifier(marker) {
  const id = String(marker || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "");
  if (!/^[0-9a-f]{16,32}$/.test(id)) return "";
  return `dpmf:${id}`.slice(0, 40);
}

export function isFreshXamanCreate(raw) {
  if (!raw || typeof raw !== "object") return false;
  const uuid = raw.uuid || raw.payload?.uuid;
  if (!uuid) return false;
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
  if (meta.resolved === true || meta.signed === true || meta.cancelled === true || meta.expired === true) {
    return false;
  }
  return true;
}

export function buildXamanPayload(origin, txjson, options = {}) {
  const returnTo = xamanReturnUrl(origin);
  const tx = txjson && typeof txjson === "object" ? txjson : { TransactionType: "SignIn" };
  const identifier = xamanSignIdentifier(options.signMarker);
  const payload = {
    txjson: tx,
    options: {
      submit: options.submit ?? shouldSubmitTxjson(tx),
      expire: options.expire ?? 5,
    },
  };
  if (options.xapp) {
    // Stay inside the Xaman overlay. A return URL would reload the xApp
    // webview and skip the native openSignRequest flow.
    payload.options.force_network = options.force_network || "MAINNET";
  } else {
    payload.options.return_url = {
      // {id} is replaced with the payload uuid so a fresh iPhone/iPad
      // tab can finish sign-in after Xaman reopens the dashboard.
      app: returnTo,
      web: returnTo,
    };
  }
  if (identifier) {
    payload.custom_meta = {
      identifier,
      blob: {
        dpmf: "sign",
        marker: String(options.signMarker).trim(),
        tx: tx.TransactionType || "",
      },
    };
  }
  return payload;
}

export function buildSignInPayload(origin, txjson) {
  return buildXamanPayload(origin, txjson || { TransactionType: "SignIn" }, { submit: false });
}

export function buildTrustSetPayload(origin, txjson) {
  return buildXamanPayload(origin, txjson, { submit: true });
}

export function xamanErrorMessage(raw, fallback = "Failed to start Xaman sign-in") {
  if (typeof raw === "string" && raw && raw !== "[object Object]") return raw;
  if (typeof raw?.error === "string" && raw.error) return raw.error;
  if (typeof raw?.detail === "string" && raw.detail) return raw.detail;
  if (typeof raw?.message === "string" && raw.message) return raw.message;
  if (typeof raw?.error?.message === "string" && raw.error.message) {
    const nested = raw.error.message;
    if (nested && nested !== "[object Object]") return nested;
  }
  const code = Number(raw?.error?.code ?? raw?.code);
  if (code === 603) {
    return "Xaman could not build this transaction (603). The amounts must be valid XRPL values — try again with a smaller, rounded size.";
  }
  if (AUTH_CODES.has(code)) {
    const configured = xummConfigured();
    if (!configured.key || !configured.secret) {
      return "Xaman API keys are missing on this host. Set XUMM_API_KEY and XUMM_API_SECRET on Vercel Production (no VITE_ prefix on the secret).";
    }
    return "Xaman rejected the app keys. Check XUMM_API_KEY and XUMM_API_SECRET on Vercel Production, and add https://xio-exchange.dpmf.technology plus the Vercel host as Xaman return URLs.";
  }
  if (Number.isFinite(code)) return `Xaman sign-in failed (${code})`;
  return fallback;
}

export function xummHeaders(origin) {
  const key = xummKey();
  const secret = xummSecret();
  if (!key || !secret) {
    throw new Error("XUMM_API_KEY and XUMM_API_SECRET are not configured on the dashboard");
  }
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "DPMF-XIO-Dashboard/1.0",
    "x-api-key": key,
    "x-api-secret": secret,
  };
  if (origin) {
    headers.Origin = origin;
    headers.Referer = `${origin}/`;
  }
  return headers;
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}
