function pathKey(suffix) {
  return String(suffix || "").split("?")[0];
}

const PAGED_CATALOG_PATHS = new Set(["top-holders", "top-holders-v2", "top-lp"]);

/** Paginated list endpoints must not share one last-good blob across offsets. */
export function catalogMemoryKey(suffix, search = "") {
  const path = pathKey(suffix);
  if (!PAGED_CATALOG_PATHS.has(path)) return path;
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const limit = params.get("limit") || "";
  const offset = params.get("offset") || "0";
  const pool = params.get("pool") || params.get("pair") || "";
  const snapshot = params.get("snapshot") || "";
  return `${path}?limit=${limit}&offset=${offset}&pool=${pool}&snapshot=${snapshot}`;
}

const lastGood = new Map();

export function payloadUsable(suffix, body) {
  if (body == null) return false;
  if (Array.isArray(body)) return body.length > 0;
  if (typeof body !== "object") return false;
  const path = pathKey(suffix);
  if (path === "prices/change24h" || path === "change24h") {
    const xio = Number(body.xio);
    const xrp = Number(body.xrp);
    if (Number.isFinite(xio) && xio !== 0) return true;
    if (Number.isFinite(xrp) && xrp !== 0) return true;
    return body.source === "xrpl.to" || body.source === "xrpl" || body.source === "hybrid";
  }
  if (Array.isArray(body.holders) && body.holders.length) return true;
  if (Array.isArray(body.rows) && body.rows.length) return true;
  if (Array.isArray(body.pools) && body.pools.length) return true;
  if (Array.isArray(body.price_history) && body.price_history.length) return true;
  if (Array.isArray(body.amm_pool_history) && body.amm_pool_history.length) return true;
  if (body.books && typeof body.books === "object" && Object.keys(body.books).some((key) => body.books[key])) {
    return true;
  }
  if (Number(body.xioUsd) > 0 || Number(body.recorded_price) > 0 || Number(body.price) > 0) return true;
  if (Number(body.count) > 0 || Number(body.holder_count) > 0) return true;
  if (Number(body.xrp) > 0 || Number(body.xio) > 0) return true;
  if (Number(body.rank) > 0) return true;
  if (Number(body.totalUsd) > 0) return true;
  if (Number(body.issued) > 0 || Number(body.issuer_locked) > 0) return true;
  if (Number(body.tvl) > 0 || Number(body.tvl_usd) > 0) return true;
  if (Number(body.lp_balance) > 0) return true;
  return false;
}

export function rememberCatalog(suffix, body, search = "") {
  if (!payloadUsable(suffix, body)) return false;
  lastGood.set(catalogMemoryKey(suffix, search), { at: Date.now(), body });
  return true;
}

export function recallCatalog(suffix, search = "") {
  return lastGood.get(catalogMemoryKey(suffix, search))?.body ?? null;
}

export function preferUsable(suffix, primary, fallback) {
  if (payloadUsable(suffix, primary)) return primary;
  if (payloadUsable(suffix, fallback)) return fallback;
  return primary ?? fallback ?? null;
}

export function resetCatalogMemory() {
  lastGood.clear();
}

export function catalogMode({ postgresDown = false, dbUsed = false, liveUsed = false } = {}) {
  if (postgresDown && liveUsed) return "free";
  if (dbUsed && liveUsed) return "hybrid";
  if (dbUsed) return "railway";
  if (liveUsed) return "free";
  return "empty";
}

export function catalogHealth({ postgresDown = false, dbOk = false } = {}) {
  const mode = catalogMode({
    postgresDown,
    dbUsed: dbOk && !postgresDown,
    liveUsed: postgresDown || !dbOk,
  });
  return {
    status: dbOk && !postgresDown ? "ok" : "degraded",
    source: mode === "railway" ? "db" : mode,
    mode,
    database: postgresDown ? "error" : dbOk ? "ok" : "empty",
    failover: postgresDown || !dbOk ? "active" : "armed",
    timestamp: new Date().toISOString(),
    note:
      postgresDown || !dbOk
        ? "Railway catalog is offline. Free public APIs (xrpl.to, XRPL, CoinGecko) are serving the dashboard."
        : "Read-only SELECT on XIO tables. Live APIs take over if Railway goes dark.",
  };
}
