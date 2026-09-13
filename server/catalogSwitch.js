import {preferRailwayXioVolume} from "../src/utils/lpVolume.js";
import {mergeTradePrints} from "../src/xioTrades.js";
import {bookHasTape, mergeOrderbookPayloads} from "../src/orderbook.js";
import {payloadUsable, preferUsable, recallCatalog, rememberCatalog} from "./sourceControl.js";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function isBlankAmount(value) {
  if (value == null || value === "") return true;
  const n = Number(value);
  return !Number.isFinite(n) || n === 0;
}

export function catalogSource(dbUsed, liveUsed) {
  if (dbUsed && liveUsed) return "hybrid";
  if (liveUsed) return "xrpl";
  if (dbUsed) return "db";
  return "empty";
}

const LIVE_PRICE_KEYS = [
  "xioUsd",
  "recorded_price",
  "price",
  "xioGbp",
  "xioEur",
  "xioJpy",
  "xrpUsd",
  "xrpGbp",
  "xrpEur",
  "xrpJpy",
  "usdGbp",
  "usdEur",
  "usdJpy",
  "xio_per_xrp",
  "xioPerXrp",
  "RLUSD",
];

const LIVE_MARKET_KEYS = [
  ...LIVE_PRICE_KEYS,
  "tvl",
  "tvl_usd",
  "reserve_asset",
  "reserve_currency",
  "lp_supply",
  "trading_fee",
  "volume24h",
  "volume24hXio",
  "volume24hXrp",
  "volume24hUsd",
  "volume7d",
  "volume7dXio",
  "amm_xio",
  "ammMarketCap",
  "xrplMarketCap",
  "circulatingMarketCap",
  "circulating",
  "circulating_supply",
  "total_supply",
  "burned_supply",
  "issuer_locked",
  "amm_account",
];

const LIVE_META_KEYS = [
  "issuer",
  "tokenType",
  "created",
  "blackholed",
  "blackholed_fixed",
  "blackholed_at",
];

const LIVE_COUNT_KEYS = [
  "holder_count",
  "holders",
  "trustlines",
  "trustline_count",
  "lp_holder_count",
  "lp_trustline_count",
  "count",
];

function takeLive(next, live, keys) {
  let used = false;
  for (const key of keys) {
    if (!isBlankAmount(live?.[key])) {
      next[key] = live[key];
      used = true;
    }
  }
  return used;
}

function takeLiveWhenDbBlank(next, db, live, keys) {
  let used = false;
  for (const key of keys) {
    if (isBlankAmount(db?.[key]) && !isBlankAmount(live?.[key])) {
      next[key] = live[key];
      used = true;
    }
  }
  return used;
}

function isBlankValue(value) {
  if (value == null || value === "") return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "string") return !String(value).trim();
  return isBlankAmount(value);
}

function takeLiveWhenDbBlankValue(next, db, live, keys) {
  let used = false;
  for (const key of keys) {
    if (isBlankValue(db?.[key]) && !isBlankValue(live?.[key])) {
      next[key] = live[key];
      used = true;
    }
  }
  return used;
}

export function dbHasMarket(row = {}) {
  return (
    !isBlankAmount(row.xioUsd ?? row.recorded_price ?? row.price) ||
    !isBlankAmount(row.reserve_asset ?? row.reserve_xio) ||
    !isBlankAmount(row.reserve_currency ?? row.reserve_quote)
  );
}

export function dbHasCounts(row = {}) {
  return LIVE_COUNT_KEYS.some((key) => !isBlankAmount(row?.[key]));
}

export function mergeLivePrices(db = {}, live = {}) {
  const next = {
    ...db,
    quotes: { ...(asObject(db.quotes) || {}), ...(asObject(live.quotes) || {}) },
  };
  const liveUsed = takeLive(next, live, LIVE_PRICE_KEYS);
  if (!isBlankAmount(live.xioUsd)) {
    next.xioUsd = live.xioUsd;
    next.recorded_price = live.recorded_price ?? live.xioUsd;
    next.price = live.price ?? live.xioUsd;
  }
  next.source = catalogSource(dbHasMarket(db) || Object.keys(db).length > 0, liveUsed);
  return next;
}

export function mergeLiveOverview(db = {}, live = {}) {
  const next = { ...db, ...mergeLivePrices(db, live) };
  const marketUsed = takeLive(next, live, LIVE_MARKET_KEYS);
  const countUsed = takeLiveWhenDbBlank(next, db, live, LIVE_COUNT_KEYS);
  const metaUsed = takeLiveWhenDbBlankValue(next, db, live, LIVE_META_KEYS);
  if (!isBlankAmount(live.xioUsd)) {
    next.xioUsd = live.xioUsd;
    next.recorded_price = live.recorded_price ?? live.xioUsd;
    next.price = live.price ?? live.xioUsd;
    if (!isBlankAmount(live.xrplMarketCap)) next.xrplMarketCap = live.xrplMarketCap;
    if (!isBlankAmount(live.circulatingMarketCap)) next.circulatingMarketCap = live.circulatingMarketCap;
    if (!isBlankAmount(live.ammMarketCap)) next.ammMarketCap = live.ammMarketCap;
  }
  if (Array.isArray(live.pools) && live.pools.length) {
    next.pools = mergePoolRows(db.pools, live.pools);
  }
  const liveUsed = marketUsed || countUsed || metaUsed || Boolean(live.pools?.length);
  next.source = catalogSource(dbHasMarket(db) || dbHasCounts(db), liveUsed);
  next.catching_up = Boolean(live.catching_up && !dbHasCounts(db));
  return next;
}

function poolKey(row = {}) {
  return String(row.pool_name || row.pool || row.pair || row.amm_account || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function mergePoolRow(dbRow = {}, liveRow = {}) {
  const next = { ...dbRow, ...liveRow };
  for (const key of [
    "reserve_xio",
    "reserve_asset",
    "reserve_currency",
    "reserve_quote",
    "lp_supply",
    "trading_fee",
    "xioUsd",
    "xrpUsd",
    "amm_account",
    "lp_currency",
  ]) {
    if (isBlankAmount(liveRow[key]) && !isBlankAmount(dbRow[key])) next[key] = dbRow[key];
  }
  Object.assign(next, preferRailwayXioVolume(dbRow, liveRow));
  return next;
}

export function mergePoolRows(dbPools, livePools) {
  const byKey = new Map();
  for (const row of Array.isArray(dbPools) ? dbPools : []) {
    const key = poolKey(row);
    if (key) byKey.set(key, row);
  }
  for (const row of Array.isArray(livePools) ? livePools : []) {
    const key = poolKey(row);
    if (!key) continue;
    byKey.set(key, mergePoolRow(byKey.get(key) || {}, row));
  }
  return [...byKey.values()];
}

export function mergeTradeFlows(db, live) {
  const dbRows = Array.isArray(db) ? db : Array.isArray(db?.rows) ? db.rows : [];
  const liveRows = Array.isArray(live) ? live : Array.isArray(live?.rows) ? live.rows : [];
  if (!liveRows.length) return db;
  if (!dbRows.length) return live;
  return mergeTradePrints(dbRows, liveRows);
}

export function mergeLivePools(db = {}, live = {}) {
  const livePools = Array.isArray(live.pools) ? live.pools : [];
  const dbPools = Array.isArray(db.pools) ? db.pools : Array.isArray(db) ? db : [];
  if (!livePools.length) return db;
  const pools = mergePoolRows(dbPools, livePools);
  return {
    ...(asObject(db) || {}),
    ...(asObject(live) || {}),
    pools,
    count: pools.length,
    catching_up: !dbPools.length,
    source: catalogSource(dbPools.length > 0, true),
  };
}

export function mergeChange24h(db = {}, live = {}) {
  const next = { ...db };
  let liveUsed = false;
  for (const key of ["xio", "xrp", "lp"]) {
    if (isBlankAmount(db[key]) && !isBlankAmount(live[key])) {
      next[key] = live[key];
      liveUsed = true;
    }
  }
  next.source = catalogSource(!isBlankAmount(db.xio) || !isBlankAmount(db.xrp), liveUsed);
  return next;
}

export function mergeIssuerLocked(db = {}, live = {}) {
  if (!isBlankAmount(db.issued) || !isBlankAmount(db.issuer_locked)) return { ...db, source: db.source || "db" };
  if (!live) return db;
  return { ...db, ...live, source: catalogSource(false, true) };
}

export function mergeCountPayload(db = {}, live = {}) {
  if (!isBlankAmount(db.count) || !isBlankAmount(db.holder_count)) {
    return { ...db, source: db.source || "db" };
  }
  if (isBlankAmount(live?.count) && isBlankAmount(live?.holder_count)) return db;
  return {
    ...db,
    ...live,
    count: live.count ?? live.holder_count ?? live.trustline_count ?? db.count,
    source: catalogSource(false, true),
    catching_up: false,
  };
}

function hasRows(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!asObject(value)) return false;
  return (
    (Array.isArray(value.rows) && value.rows.length > 0) ||
    (Array.isArray(value.holders) && value.holders.length > 0) ||
    (Array.isArray(value.pools) && value.pools.length > 0) ||
    (Array.isArray(value.price_history) && value.price_history.length > 0) ||
    (Array.isArray(value.amm_pool_history) && value.amm_pool_history.length > 0) ||
    (value.books && typeof value.books === "object" && Object.keys(value.books).some((key) => value.books[key])) ||
    (Array.isArray(value.bids) && value.bids.length > 0) ||
    (Array.isArray(value.asks) && value.asks.length > 0)
  );
}

export function mergeOrderbookCatalogs(db, live) {
  const stored = asObject(db);
  const fresh = asObject(live);
  if (!stored) return live;
  if (!fresh) return db;

  if (stored.books || fresh.books) {
    const merged = mergeOrderbookPayloads(
      stored.books ? stored : { ...stored, books: {} },
      fresh.books ? fresh : { ...fresh, books: {} }
    );
    const source =
      stored.source && fresh.source && stored.source !== fresh.source
        ? "hybrid"
        : fresh.source || stored.source;
    return {
      ...stored,
      ...fresh,
      ...merged,
      featured: stored.featured || fresh.featured,
      source,
    };
  }

  if (bookHasTape(stored)) return stored;
  if (bookHasTape(fresh)) return { ...stored, ...fresh, source: fresh.source || stored.source };
  return stored;
}

export function mergeCatalogPayload(suffix, db, live) {
  const path = String(suffix || "").split("?")[0];
  if (live == null) return db;
  if (db == null) return live;

  if (path === "prices") return mergeLivePrices(db, live);
  if (path === "overview" || path === "token-details" || path === "amm") {
    return mergeLiveOverview(db, live);
  }
  if (path === "lp-pools" || path === "pools") return mergeLivePools(db, live);
  if (path === "prices/change24h" || path === "change24h") return mergeChange24h(db, live);
  if (path === "issuer-locked") return mergeIssuerLocked(db, live);
  if (/\/count$/.test(path) || path.endsWith("/count")) return mergeCountPayload(db, live);
  if (path === "xio-flows" || path === "trades" || path === "charts/trades") {
    return mergeTradeFlows(db, live);
  }
  if (/^charts\//.test(path) || path === "chart/candles" || path === "charts/candles" || path.startsWith("sparkline/")) {
    return hasRows(db) ? db : live;
  }
  if (path === "top-holders" || path === "top-holders-v2" || path === "top-lp") {
    return hasRows(db) ? db : live;
  }
  if (path === "orderbook" || path === "orderbooks") {
    return mergeOrderbookCatalogs(db, live);
  }
  if (path === "wallet/rank" || /^wallet\/rank\//.test(path)) {
    if (!isBlankAmount(db?.rank)) return { ...db, source: db.source || "db" };
    if (!isBlankAmount(live?.rank)) return { ...db, ...live, source: catalogSource(false, true) };
    return db;
  }
  if (asObject(db) && asObject(live)) return mergeLiveOverview(db, live);
  return db;
}

function jsonResult(body, source) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
    source: source || body?.source || "xrpl.to",
    catalogOverlaid: true,
  };
}

export async function serveCatalogFallback(suffix, loadLive) {
  let live;
  try {
    live = typeof loadLive === "function" ? await loadLive(suffix) : null;
  } catch {
    // last-good catalog memory is the control measure when a free API blips
  }
  const kept = preferUsable(suffix, live, recallCatalog(suffix));
  if (kept == null) return null;
  if (payloadUsable(suffix, kept)) rememberCatalog(suffix, kept);
  return jsonResult(kept, kept?.source || "xrpl.to");
}

export async function overlayDbResultWithLive(suffix, dbResult, loadLive) {
  if (!dbResult || dbResult.catalogOverlaid || dbResult.status >= 400 || typeof loadLive !== "function") {
    return dbResult;
  }
  const path = String(suffix || "").split("?")[0];
  if (!path || path === "health" || path === "health/xrpl" || /handshake$/i.test(path)) {
    return dbResult;
  }
  if ((/^wallet\//.test(path) || /^balances\//.test(path)) && !/^wallet\/rank\//.test(path)) {
    return dbResult;
  }
  let dbBody;
  try {
    dbBody = JSON.parse(dbResult.body);
  } catch {
    return dbResult;
  }
  let live;
  try {
    live = await loadLive(suffix);
  } catch {
    // last-good catalog memory fills empty Railway rows below
  }
  const merged = live != null ? mergeCatalogPayload(suffix, dbBody, live) : dbBody;
  const kept = preferUsable(path, merged, recallCatalog(path));
  if (payloadUsable(path, kept)) rememberCatalog(path, kept);
  if (kept == null) return { ...dbResult, catalogOverlaid: true };
  if (kept === dbBody) return { ...dbResult, catalogOverlaid: true };
  return {
    ...dbResult,
    body: JSON.stringify(kept),
    source: kept?.source || dbResult.source,
    catalogOverlaid: true,
  };
}
