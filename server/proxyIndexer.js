import {CLUSTER_HEADERS, DEFAULT_INDEXER_ORIGIN, INDEXER_HANDSHAKE_PATHS} from "../src/handshake/contract.js";
import {databaseUrlHint, databaseUrlKind, hasIndexerDatabase, readIndexerDb} from "./readIndexerDb.js";
import {overlayDbResultWithLive, serveCatalogFallback} from "./catalogSwitch.js";
import {liveCatalogPayload} from "./liveCatalog.js";
import {catalogHealth} from "./sourceControl.js";
import {isAllowedDashboardOrigin} from "../src/security/headers.js";

export { DEFAULT_INDEXER_ORIGIN };

export function indexerOrigin(env = process.env) {
  const candidates = [
    env.INDEXER_ORIGIN,
    env.VITE_API_BASE,
    env.NEXT_PUBLIC_INDEXER_URL,
    env.VITE_INDEXER_URL,
  ].filter(Boolean);
  const remote = candidates.find(
    (url) => !/localhost|127\.0\.0\.1/i.test(String(url))
  );
  return (remote || DEFAULT_INDEXER_ORIGIN).replace(/\/$/, "");
}

export function joinIndexerUrl(origin, path, search = "") {
  const prefix = origin.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${suffix}${search || ""}`;
}

function isHandshakeSuffix(suffix) {
  return (
    suffix === "handshake" ||
    suffix === "cluster/v1/handshake" ||
    suffix === "cluster/handshake" ||
    suffix === "v1/handshake" ||
    suffix === "public/handshake"
  );
}

export function indexerPathsFor(suffix) {
  if (suffix === "health") return ["/health"];
  if (suffix === "health/xrpl") return ["/health/xrpl"];
  if (isHandshakeSuffix(suffix) || !suffix) return INDEXER_HANDSHAKE_PATHS;
  return [`/api/${suffix}`];
}


/** Indexer liquid-pair routes: /api/pairs, /api/book/:base/:quote, /api/amm/:base/:quote */
export function isRemoteLiquidPairSuffix(suffix) {
  const s = String(suffix || "");
  return (
    s === "pairs" ||
    /^book\/[^/]+\/[^/]+$/i.test(s) ||
    /^amm\/[^/]+\/[^/]+$/i.test(s)
  );
}

export async function fetchIndexer(url, { method = "GET", body } = {}) {
  const payload =
    body == null || typeof body === "string" ? body : JSON.stringify(body);

  const response = await fetch(url, {
    method,
    headers: {
      ...CLUSTER_HEADERS,
      "user-agent": "DPMF-XIO-Dashboard/1.1",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(3500),
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "application/json",
    body: text,
  };
}

function withSource(result, source) {
  if (!result) return result;
  return { ...result, source: result.source || source };
}

function localDashboardStatus(suffix, extra = {}) {
  const database = extra.database || databaseUrlKind();
  const hint = extra.hint || databaseUrlHint();
  const endpoints = {
    health: "/health",
    overview: "/api/overview",
    amm: "/api/amm",
    pools: "/api/pools",
    topHolders: "/api/top-holders",
    topHoldersToday: "/api/top-holders?snapshot=today",
    topHoldersV2: "/api/top-holders-v2",
    topLp: "/api/top-lp",
    topLpToday: "/api/top-lp?snapshot=today",
    holdersCount: "/api/holders/count",
    holdersCountToday: "/api/holders/count?snapshot=today",
    trustlinesCount: "/api/trustlines/count",
    lpHoldersCount: "/api/lp-holders/count",
    lpHoldersCountToday: "/api/lp-holders/count?snapshot=today",
    lpTrustlinesCount: "/api/lp-trustlines/count",
    lpPools: "/api/lp-pools",
    lpPoolsLive: "/api/lp-pools/live",
    swapMarket: "/api/swap-market",
    tvlHistory: "/api/charts/tvl",
    holdersHistory: "/api/charts/holders",
    lpHoldersHistory: "/api/charts/lp-holders",
    lpTrustlinesHistory: "/api/charts/lp-trustlines",
    trustlinesHistory: "/api/charts/trustlines",
    activityHistory: "/api/charts/activity",
    tradersHistory: "/api/charts/traders",
    trades: "/api/trades",
    xioFlows: "/api/xio-flows",
    walletBalances: "/api/wallet/balances/:address",
    prices: "/api/prices",
    priceChange: "/api/prices/change24h",
    networth: "/api/wallet/networth/:address",
    sparkline: "/api/sparkline/:asset",
    issuerLocked: "/api/issuer-locked",
    orderbook: "/api/orderbook",
    orderbooks: "/api/orderbooks",
  };

  if (suffix === "health" || suffix === "health/xrpl") {
    const health = catalogHealth({
      postgresDown: database === "error" || database === "auth-failed",
      dbOk: database === "postgres",
    });
    return {
      status: 200,
      contentType: "application/json",
      source: "dashboard",
      body: JSON.stringify({
        ...health,
        source: health.source === "db" ? "dashboard" : health.source,
        database,
        hint,
        note:
          health.failover === "active"
            ? health.note
            : "Read-only SELECT on XIO tables. Live APIs take over if Railway goes dark.",
      }),
    };
  }

  return {
    status: 200,
    contentType: "application/json",
    source: "dashboard",
    body: JSON.stringify({
      status: "online",
      service: "XRPL Indexer",
      source: "dashboard",
      database,
      hint,
      endpoints,
    }),
  };
}

function indexerErrorHint(last) {
  let detail = last?.body || "Indexer unavailable";
  try {
    const parsed = JSON.parse(last.body);
    detail = parsed.error || parsed.detail || parsed.message || detail;
  } catch {
    if (typeof last?.body === "string" && last.body.length && last.body.length < 200) {
      detail = last.body;
    }
  }
  const database = databaseUrlKind();
  const hint =
    databaseUrlHint() ||
    "Cards are SELECT-only from the XIO Postgres tables. Set server-only DATABASE_URL on Vercel Preview + Production to postgres://USER:PASS@HOST:PORT/DB (not the indexer HTTP host), then Redeploy this preview.";
  return {
    status: last?.status || 503,
    contentType: "application/json",
    source: "none",
    body: JSON.stringify({
      error: database === "postgres" ? detail : "DATABASE_URL missing on this Vercel deploy",
      hint,
      database,
      source: "none",
    }),
  };
}

export async function fetchIndexerFirst(paths, { method = "GET", body, search = "", suffix = "" } = {}) {
  const catalogOrHealth =
    method === "GET" &&
    (!suffix ||
      suffix === "api" ||
      suffix === "health" ||
      suffix === "health/xrpl" ||
      isHandshakeSuffix(suffix));

    // Prefer the hosted indexer for liquid-pair book/amm/pairs; fall back locally on miss.
  if (method === "GET" && isRemoteLiquidPairSuffix(suffix)) {
    const origin = indexerOrigin();
    let last;
    for (const path of paths) {
      try {
        last = await fetchIndexer(joinIndexerUrl(origin, path, search), { method, body });
        if (last.status < 400) return withSource(last, "indexer");
      } catch (error) {
        last = {
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: error.message || "Indexer proxy failed" }),
        };
      }
    }
    const local = await readIndexerDb(suffix, search);
    if (local && local.status < 400) return withSource(local, local.source || "xrpl");
    if (last) return indexerErrorHint(last);
  }

  let dbResult = null;
  const dbHint = databaseUrlHint();
  if (dbHint && !hasIndexerDatabase()) {
    console.error(dbHint);
  }

  if (
    method === "GET" &&
    (/^wallet\/(offers|activity|votes|account|balances|lines|lp|lp-income|networth)\//.test(suffix) ||
      /^balances\//.test(suffix) ||
      suffix === "amm/governance" ||
      suffix === "lp-pools/live" ||
      suffix === "swap-market")
  ) {
    const ledger = await readIndexerDb(suffix, search);
    if (ledger && ledger.status < 400) return withSource(ledger, "xrpl");
  }

  // Prefer the XIO tables when a connection string is present so Hikari 429
  // cannot hide history. Never starts or resets indexer workers.
  if (method === "GET" && hasIndexerDatabase()) {
    dbResult = await readIndexerDb(suffix, search);
    if (dbResult && dbResult.status < 400) {
      const overlaid = await overlayDbResultWithLive(
        suffix,
        dbResult,
        (path) => liveCatalogPayload(path, { search }),
        search
      );
      return withSource(overlaid, overlaid.source || "postgres");
    }
    if (dbResult && catalogOrHealth) {
      let parsed;
      try {
        parsed = JSON.parse(dbResult.body);
      } catch {
        parsed = {};
      }
      const authFailed = /password authentication failed/i.test(
        `${parsed.error || ""} ${dbResult.body || ""}`
      );
      return localDashboardStatus(suffix, {
        database: authFailed ? "auth-failed" : "error",
        hint: parsed.hint || databaseUrlHint(),
      });
    }
    // Postgres is configured but down. Serve free APIs / last-good instead of 503.
    if (dbResult && dbResult.status >= 400) {
      const fallback = await serveCatalogFallback(
        suffix,
        (path) => liveCatalogPayload(path, { search }),
        search
      );
      if (fallback) return withSource(fallback, fallback.source || "xrpl.to");
      return withSource(dbResult, "postgres");
    }
  }

  // No postgres:// on this deploy: still serve the free catalog.
  if (!hasIndexerDatabase()) {
    if (catalogOrHealth) return localDashboardStatus(suffix);
    const fallback = await serveCatalogFallback(
      suffix,
      (path) => liveCatalogPayload(path, { search }),
      search
    );
    if (fallback) return withSource(fallback, fallback.source || "xrpl.to");
    return indexerErrorHint({
      status: 503,
      body: JSON.stringify({ error: "DATABASE_URL missing on this Vercel deploy" }),
    });
  }

  const origin = indexerOrigin();
  let last;
  for (const path of paths) {
    try {
      last = await fetchIndexer(joinIndexerUrl(origin, path, search), { method, body });
      if (last.status < 400) {
        return withSource(last, "indexer");
      }
    } catch (error) {
      last = {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: error.message || "Indexer proxy failed" }),
      };
    }
  }

  if (dbResult) return dbResult;
  if (catalogOrHealth) return localDashboardStatus(suffix);
  return indexerErrorHint(last);
}

export function proxyResponseHeaders(last, req) {
  return {
    "content-type": last?.contentType || "application/json",
    ...proxyCorsHeaders(req),
    ...(last?.source ? { "x-dpmf-source": last.source } : {}),
  };
}

export function handshakePostBody(incoming) {
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    return incoming;
  }
  return undefined;
}

export function proxyCorsHeaders(req) {
  const origin = String(req?.headers?.origin || "").trim();
  const allow = isAllowedDashboardOrigin(origin)
    ? origin
    : "https://xio-exchange.dpmf.technology";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "accept,content-type",
    vary: "Origin",
  };
}
