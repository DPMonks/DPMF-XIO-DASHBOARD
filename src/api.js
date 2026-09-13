import {CATALOG_PATHS, DEFAULT_ENDPOINTS, DEFAULT_INDEXER_ORIGIN, ENDPOINT_ALIASES, HEALTH_PATHS, PROTOCOL, SERVICE, VERSION} from "./handshake/contract";
import {createRequestScheduler} from "./utils/requestScheduler";
import {catalogFetchBlocked, isPostgresOutageStatus, markCatalogDown, publicApiErrorMessage} from "./api/publicError";

function resolveRemoteOrigin() {
  const candidates = [
    import.meta.env.VITE_API_BASE,
    import.meta.env.NEXT_PUBLIC_INDEXER_URL,
    import.meta.env.VITE_INDEXER_URL,
    import.meta.env.VITE_API_URL,
  ].filter(Boolean);
  const remote = candidates.find(
    (url) => !/localhost|127\.0\.0\.1/i.test(String(url))
  );
  return (remote || DEFAULT_INDEXER_ORIGIN).replace(/\/$/, "");
}

function resolveRequestOrigin() {
  if (import.meta.env.VITE_USE_DIRECT_INDEXER === "true") {
    return resolveRemoteOrigin();
  }
  return "";
}

const INDEXER_ORIGIN = resolveRemoteOrigin();
const REQUEST_ORIGIN = resolveRequestOrigin();
const API = REQUEST_ORIGIN
  ? REQUEST_ORIGIN.endsWith("/api")
    ? REQUEST_ORIGIN
    : `${REQUEST_ORIGIN}/api`
  : "/api";

const inflight = new Map();
const responseCache = new Map();
const CACHE_MS = 15_000;
const scheduleRequest = createRequestScheduler({ concurrency: 2 });

let handshakePromise = null;
let handshakeState = {
  ok: false,
  protocol: PROTOCOL,
  version: VERSION,
  path: "contract",
  error: null,
  endpoints: { ...DEFAULT_ENDPOINTS },
  snapshot: {},
  source: null,
  raw: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeEndpoint(value) {
  if (!value) return null;
  let path = String(value);
  if (path.startsWith("http")) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  if (path.startsWith("/api/")) path = path.slice(4);
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

function mergeEndpoints(raw) {
  const source = asObject(raw);
  const next = { ...DEFAULT_ENDPOINTS };

  for (const [key, names] of Object.entries(ENDPOINT_ALIASES)) {
    for (const name of names) {
      const normalized = normalizeEndpoint(source[name]);
      if (normalized) {
        next[key] = normalized;
        break;
      }
    }
  }
  return next;
}

function extractSnapshot(payload) {
  const root = asObject(payload);
  const snap = asObject(
    root.snapshot || root.data || root.payload || root.tables || root
  );
  return {
    overview: snap.overview || root.overview || null,
    pools: snap.pools || snap.amm || root.pools || root.amm || null,
    holders:
      snap.holders ||
      snap.topHolders ||
      snap.top_holders ||
      root.holders ||
      root.topHolders ||
      null,
    lpHolders:
      snap.lpHolders ||
      snap.lp_holders ||
      snap.topLp ||
      snap.top_lp ||
      root.lpHolders ||
      root.topLp ||
      null,
    charts: snap.charts || root.charts || null,
    prices: snap.prices || root.prices || null,
    change24h: snap.change24h || snap.prices24h || root.change24h || null,
    holdersCount: snap.holdersCount || snap.holder_count || root.holdersCount || null,
    trustlinesCount:
      snap.trustlinesCount || snap.trustline_count || root.trustlinesCount || null,
  };
}

function looksLikeHandshake(payload) {
  const body = asObject(payload);
  return Boolean(
    body.status === "online" ||
      body.status === "ok" ||
      body.endpoints ||
      body.service ||
      body.workers ||
      body.xrpl
  );
}

function requestUrl(path) {
  if (path.startsWith("http")) return path;
  if (path === "/" || path === "/api" || path === "/api/") {
    return `${REQUEST_ORIGIN}/api/`;
  }
  if (path.startsWith("/health")) {
    return `${REQUEST_ORIGIN}${path}`;
  }
  if (path.startsWith("/api/")) {
    return `${REQUEST_ORIGIN}${path}`;
  }
  return `${API}${path}`;
}

function cacheGet(url) {
  const hit = responseCache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > (hit.ttl ?? CACHE_MS)) {
    responseCache.delete(url);
    return null;
  }
  return hit.data;
}

function cacheSet(url, data, ttl = CACHE_MS) {
  responseCache.set(url, { at: Date.now(), data, ttl });
}

async function fetchJson(url, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    const next = new Error(
      timedOut
        ? "Indexer proxy timed out"
        : "Failed to fetch /api (not Postgres). Production dpmf-xio-dashboard-TEST.vercel.app still has no /api function — open the PR #4 preview, or promote this branch. Preview SSO 302s also look like Failed to fetch. Do not put the Railway HTTP host in DATABASE_URL."
    );
    next.status = 0;
    throw next;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback =
      res.status === 429
        ? "Indexer rate-limited (Railway Hikari). The proxy will retry."
        : res.status === 404
          ? "This host has no /api function. Open the PR #4 preview or promote that branch to Production — env vars do nothing on the old production deploy."
        : `${res.status} ${res.statusText}`;
    const error = new Error(publicApiErrorMessage(data, res.status) || fallback);
    error.status = res.status;
    if (isPostgresOutageStatus(res.status, data.error || data.detail || data.hint)) {
      markCatalogDown();
    }
    throw error;
  }
  return data;
}

async function queued(task, priority = 0) {
  return scheduleRequest(task, { priority });
}

async function getJsonOnce(path, options) {
  return fetchJson(requestUrl(path), options);
}

async function getJson(path, options = {}) {
  const {
    method = "GET",
    body,
    cache = method === "GET",
    queue: useQueue = true,
    immediate = false,
    priority = 0,
    retries = 2,
  } = options;
  const url = requestUrl(path);
  const cacheKey = `${method} ${url}`;

  if (cache) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const pending = inflight.get(cacheKey);
    if (pending) return pending;
  }

  const run = async () => {
    if (catalogFetchBlocked(url)) {
      const error = new Error("Market data is temporarily unavailable.");
      error.status = 503;
      throw error;
    }
    let lastError;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const data = await getJsonOnce(path, { method, body });
        if (cache) cacheSet(cacheKey, data);
        return data;
      } catch (error) {
        lastError = error;
        if (error.status !== 429 || attempt === retries - 1) break;
        await sleep(800 * (attempt + 1));
      }
    }
    throw lastError;
  };

  const task = immediate || !useQueue ? run() : queued(run, priority);

  if (cache) {
    inflight.set(cacheKey, task);
    task.finally(() => inflight.delete(cacheKey)).catch(() => {});
  }
  task.catch(() => {});
  return task;
}

function withParams(template, params = {}) {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  return path;
}

function acceptHandshake(raw, path, extra = {}) {
  if (!looksLikeHandshake(raw) && !extra.health) return false;
  handshakeState = {
    ok: true,
    protocol: raw.service || extra.health?.status || PROTOCOL,
    version: raw.version || VERSION,
    path,
    error: null,
    endpoints: mergeEndpoints(raw.endpoints || raw.routes),
    snapshot: extractSnapshot(raw),
    health: extra.health || null,
    xrpl: extra.xrpl || extra.health?.xrpl || raw.xrpl || null,
    source: raw.source || extra.health?.source || extra.source || null,
    database: raw.database || extra.health?.database || extra.database || null,
    hint: raw.hint || extra.health?.hint || extra.hint || null,
    raw,
  };
  return true;
}

const handshakeGet = (path) =>
  getJson(path, { cache: false, queue: false, retries: 1 });

async function probeHandshake() {
  let lastError = null;
  let catalog = null;
  let catalogPath = CATALOG_PATHS[0];
  let health = null;
  let xrpl = null;

  const [catalogAttempt, healthAttempt, xrplAttempt] = await Promise.allSettled([
    handshakeGet(CATALOG_PATHS[0]),
    handshakeGet(HEALTH_PATHS[0]),
    handshakeGet(HEALTH_PATHS[1]),
  ]);

  if (catalogAttempt.status === "fulfilled") {
    const raw = catalogAttempt.value;
    if (raw?.endpoints || raw?.status === "online" || looksLikeHandshake(raw)) {
      catalog = raw;
      acceptHandshake(raw, catalogPath);
    }
  } else {
    lastError = catalogAttempt.reason;
  }

  if (!catalog) {
    for (const path of CATALOG_PATHS.slice(1)) {
      try {
        const raw = await handshakeGet(path);
        if (raw?.endpoints || raw?.status === "online" || looksLikeHandshake(raw)) {
          catalog = raw;
          catalogPath = path;
          acceptHandshake(raw, path);
          break;
        }
      } catch (error) {
        lastError = lastError || error;
      }
    }
  }

  if (healthAttempt.status === "fulfilled") {
    health = healthAttempt.value;
  } else {
    lastError = lastError || healthAttempt.reason;
  }

  if (xrplAttempt.status === "fulfilled") {
    xrpl = xrplAttempt.value;
  }

  if (catalog || health) {
    acceptHandshake(catalog || { status: health?.status, service: SERVICE }, catalog ? catalogPath : "/health", {
      health,
      xrpl,
    });
    return handshakeState;
  }

  handshakeState = {
    ...handshakeState,
    ok: false,
    protocol: PROTOCOL,
    version: VERSION,
    path: "contract",
    error: lastError?.message || null,
    endpoints: { ...DEFAULT_ENDPOINTS },
  };
  return handshakeState;
}

export function handshake() {
  if (!handshakePromise) {
    handshakePromise = probeHandshake().finally(() => {
      setTimeout(() => {
        handshakePromise = null;
      }, 30_000);
    });
  }
  return handshakePromise;
}

export function getHandshakeState() {
  return handshakeState;
}

function endpoint(name, params) {
  return withParams(handshakeState.endpoints[name] || DEFAULT_ENDPOINTS[name], params);
}

export { API, INDEXER_ORIGIN, REQUEST_ORIGIN };

export const api = {
  health: () => getJson("/health"),
  healthXrpl: () => getJson("/health/xrpl"),
  overview: () => getJson(endpoint("overview"), { queue: false }),
  amm: () => getJson(endpoint("amm")),
  pools: async () => {
    const body = await getJson(endpoint("pools"));
    if (Array.isArray(body?.pools)) return body.pools;
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object" && !body.error) return [body];
    return [];
  },
  topHolders: (limit = 100, offset = 0, extra = {}) => {
    const path = endpoint("topHolders");
    const join = path.includes("?") ? "&" : "?";
    const snapshot = extra.snapshot || "today";
    return getJson(
      `${path}${join}limit=${limit}&offset=${offset}&snapshot=${encodeURIComponent(snapshot)}`
    );
  },
  topLp: (limit = 100, offset = 0, extra = {}) => {
    const path = endpoint("topLp");
    const join = path.includes("?") ? "&" : "?";
    const snapshot = extra.snapshot || "today";
    const pool = extra.pool || extra.pair || "all";
    return getJson(
      `${path}${join}limit=${limit}&offset=${offset}&snapshot=${encodeURIComponent(snapshot)}&pool=${encodeURIComponent(pool)}`
    );
  },
  holdersCount: (extra = {}) => {
    const path = endpoint("holdersCount");
    const snapshot = extra.snapshot || "today";
    const join = path.includes("?") ? "&" : "?";
    return getJson(`${path}${join}snapshot=${encodeURIComponent(snapshot)}`, {
      queue: false,
    });
  },
  trustlinesCount: () => getJson(endpoint("trustlinesCount"), { queue: false }),
  lpHoldersCount: (extra = {}) => {
    const path = endpoint("lpHoldersCount");
    const pool = extra.pool || extra.pair || "all";
    const join = path.includes("?") ? "&" : "?";
    const snapshot = extra.snapshot
      ? `snapshot=${encodeURIComponent(extra.snapshot)}&`
      : "";
    return getJson(`${path}${join}${snapshot}pool=${encodeURIComponent(pool)}`);
  },
  lpTrustlinesCount: (extra = {}) => {
    const path = endpoint("lpTrustlinesCount") || "/lp-trustlines/count";
    const pool = extra.pool || extra.pair || "all";
    const join = path.includes("?") ? "&" : "?";
    return getJson(`${path}${join}pool=${encodeURIComponent(pool)}`);
  },
  lpPools: () => getJson(endpoint("lpPools") || "/lp-pools"),
  tvlHistory: () => getJson(endpoint("tvlHistory")),
  holdersHistory: (extra = {}) => getJson(endpoint("holdersHistory"), extra),
  lpHoldersHistory: () => getJson(endpoint("lpHoldersHistory")),
  lpTrustlinesHistory: (extra = {}) => {
    const path = endpoint("lpTrustlinesHistory") || "/charts/lp-trustlines";
    const pool = extra.pool || extra.pair || "all";
    const join = path.includes("?") ? "&" : "?";
    return getJson(`${path}${join}pool=${encodeURIComponent(pool)}`);
  },
  trustlinesHistory: () => getJson(endpoint("trustlinesHistory")),
  activityHistory: () => getJson(endpoint("activityHistory")),
  tradersHistory: () => getJson(endpoint("tradersHistory")),
  trades: () => getJson(endpoint("trades")),
  xioFlows: () => getJson(endpoint("xioFlows")),
  balances: (address) => getJson(endpoint("balances", { address })),
  networth: (address) => getJson(endpoint("networth", { address })),
  walletAccount: (address) =>
    getJson(endpoint("walletAccount", { address }) || `/wallet/account/${encodeURIComponent(address)}`, {
      retries: 1,
    }),
  walletLp: (address, extra = {}) =>
    getJson(
      `${endpoint("walletLp", { address }) || `/wallet/lp/${encodeURIComponent(address)}`}${extra.fresh ? "?fresh=1" : ""}`,
      {
        retries: 1,
        queue: false,
        cache: extra.fresh === false ? true : extra.fresh ? false : true,
      }
    ),
  walletRank: (address) =>
    getJson(endpoint("walletRank", { address }) || `/wallet/rank/${encodeURIComponent(address)}`, {
      retries: 1,
    }),
  walletOffers: (address, extra = {}) =>
    getJson(`/wallet/offers/${encodeURIComponent(address)}${extra.fresh ? "?fresh=1" : ""}`, {
      retries: 1,
      queue: false,
      cache: false,
    }),
  walletLines: (address, extra = {}) =>
    getJson(`/wallet/lines/${encodeURIComponent(address)}${extra.fresh ? "?fresh=1" : ""}`, {
      retries: 1,
      queue: false,
      cache: false,
    }),
  walletActivity: (address, extra = {}) =>
    getJson(`/wallet/activity/${encodeURIComponent(address)}${extra.fresh ? "?fresh=1" : ""}`, {
      retries: 1,
      queue: false,
      cache: false,
    }),
  walletLpIncome: (address, extra = {}) => {
    const search = new URLSearchParams();
    if (extra.pair && String(extra.pair).toUpperCase() !== "ALL") search.set("pair", extra.pair);
    if (extra.marker) search.set("marker", JSON.stringify(extra.marker));
    if (extra.fresh) search.set("fresh", "1");
    const query = search.toString();
    return getJson(`/wallet/lp-income/${encodeURIComponent(address)}${query ? `?${query}` : ""}`, {
      retries: 1,
      queue: false,
      cache: false,
    });
  },
  walletVotes: (address) =>
    getJson(`/wallet/votes/${encodeURIComponent(address)}`, {
      retries: 1,
      queue: false,
      cache: false,
    }),
  ammGovernance: (pair, account, extra = {}) => {
    const search = new URLSearchParams({ pair: pair || "XIO/XRP" });
    if (account) search.set("account", account);
    if (extra.issuer || extra.quote_issuer) search.set("issuer", extra.issuer || extra.quote_issuer);
    if (extra.hex || extra.quote_hex) search.set("hex", extra.hex || extra.quote_hex);
    if (extra.ammAccount || extra.amm || extra.amm_account) {
      search.set("amm", extra.ammAccount || extra.amm || extra.amm_account);
    }
    if (extra.lpBalance != null || extra.lp != null) search.set("lp", String(extra.lpBalance ?? extra.lp));
    return getJson(`/amm/governance?${search}`, { retries: 1, queue: false, cache: false });
  },
  swapMarket: (query = {}) => {
    const search = new URLSearchParams();
    if (query.from || query.fromId) search.set("from", query.from || query.fromId);
    if (query.to || query.toId) search.set("to", query.to || query.toId);
    if (query.fromIssuer || query.from_issuer) search.set("fromIssuer", query.fromIssuer || query.from_issuer);
    if (query.toIssuer || query.to_issuer) search.set("toIssuer", query.toIssuer || query.to_issuer);
    if (query.fromHex || query.from_hex) search.set("fromHex", query.fromHex || query.from_hex);
    if (query.toHex || query.to_hex) search.set("toHex", query.toHex || query.to_hex);
    if (query.fresh) search.set("fresh", "1");
    return getJson(`/swap-market?${search}`, { retries: 1, queue: false, cache: false });
  },
  lpPoolsLive: (query = {}) => {
    const search = new URLSearchParams();
    if (query.pair || query.pool) search.set("pair", query.pair || query.pool);
    if (query.ammAccount || query.amm_account) search.set("amm", query.ammAccount || query.amm_account);
    if (query.quote) search.set("quote", query.quote);
    if (query.issuer || query.quote_issuer) search.set("issuer", query.issuer || query.quote_issuer);
    if (query.hex || query.quote_hex) search.set("hex", query.hex || query.quote_hex);
    if (query.fresh) search.set("fresh", "1");
    return getJson(`/lp-pools/live?${search}`, { retries: 1, queue: false, cache: false });
  },
  prices: () => getJson(endpoint("prices"), { queue: false }),
  change24h: () => getJson(endpoint("change24h"), { queue: false }),
  sparkline: (asset) => getJson(endpoint("sparkline", { asset })),
  candles: () => getJson(endpoint("candles") || "/charts/candles"),
  issuerLocked: () => getJson(endpoint("issuerLocked")),
  orderbook: (pair = "XIO/XRP") => {
    const path = endpoint("orderbook") || "/orderbook";
    const join = path.includes("?") ? "&" : "?";
    return getJson(`${path}${join}pair=${encodeURIComponent(pair)}`, {
      queue: false,
      retries: 1,
    });
  },
  orderbooks: () =>
    getJson(endpoint("orderbooks") || "/orderbooks", { queue: false, retries: 1 }),
  // Liquid watch pairs from the indexer (XRP/RLUSD + XIO pairs).
  pairs: () => getJson("/pairs", { queue: false, retries: 1 }),
  book: (pair = "XRP/RLUSD") => {
    const [base, quote] = String(pair || "XRP/RLUSD").split("/");
    return getJson(`/book/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`, {
      queue: false,
      retries: 1,
    });
  },
  ammPair: (pair = "XRP/RLUSD") => {
    const [base, quote] = String(pair || "XRP/RLUSD").split("/");
    return getJson(`/amm/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`, {
      queue: false,
      retries: 1,
    });
  },
};
