import {api, INDEXER_ORIGIN} from "../api";
import {pairFromRow, XIO_RLUSD_LP_XRPL_TO_MD5, XIO_XRPL_TO_MD5, XIO_XRP_LP_XRPL_TO_MD5} from "../constants/ledger";
import {keepLastGoodOwners} from "../todayOwners";
import {carryActivityMetrics, issuedActivitySeries, mergeActivityRows, needsFullIssuanceHistory, rowsFromXrplToGraph, xrplToHolderGraphUrl} from "../activityHistory";
import {composeTokenDetails} from "../tokenDetails";
import {composeTokenDetailHistory, rowsFromOhlc, xioPriceHistoryRows} from "../tokenDetailsHistory";
import lockedCandles from "../data/lockedCandles.json" with { type: "json" };
import {fillMissingXioFiat, pricesNeedFiat} from "../utils/fiatFx";
import {applyXrplToChange, applyXrplToOverview, applyXrplToPrices, countsNeedXrplTo, marketNeedsXrplTo, parseXrplToToken, XRPL_TO_TOKEN_URL} from "../utils/xrplToToken";
import {detectQuoteUsd, preferUsdPoolSplit} from "../utils/poolSplit";
import {sanePoolQuoteReserve} from "../ammPools";
import {overlayPoolFlowVolumes} from "../utils/lpVolume";
import {LIST_PAGE_SIZE, shouldFetchMoreRows} from "../utils/pagination";
import {composeAmmBook, emptyOrderbook, mergeOrderbookPayloads, asLiquidPairBook, normalizeOrderbookPair, sortOrderbookPairs, FEATURED_ORDERBOOK_PAIRS} from "../orderbook";
import {composeWalletSnapshot, emptyWalletSnapshot} from "../wallet/composeWallet";
import {normalizeWalletLines} from "../wallet/ammCreate";

export { INDEXER_ORIGIN };
export const INDEXER_URL = INDEXER_ORIGIN;

const FIRST_HOLDERS = LIST_PAGE_SIZE;
const FIRST_LP = LIST_PAGE_SIZE;
const PAGE_SIZE = LIST_PAGE_SIZE;
const MAX_ROWS = 2500;
const SESSION_TTL_MS = 5 * 60_000;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.holders)) return value.holders;
  if (Array.isArray(value?.pools)) return value.pools;
  if (value && typeof value === "object" && !value.error) return [value];
  return [];
}

function chartArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of [
    "rows",
    "data",
    "history",
    "points",
    "series",
    "values",
    "items",
    "result",
    "tvl",
    "holders",
    "lpHolders",
    "lp_holders",
  ]) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (rowTimestamp(value)) return [value];
  return [];
}

function rowTimestamp(row) {
  if (row == null || typeof row !== "object") return null;
  const raw =
    row.timestamp ??
    row.day ??
    row.date ??
    row.time ??
    row.ts ??
    row.created_at ??
    row.updated_at ??
    row.updated;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(raw);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    return numberOrNull(value.value ?? value.amount ?? value.balance);
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pick(row, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc?.[part], row);
    if (value != null && value !== "") return value;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionRead(key) {
  try {
    const raw = sessionStorage.getItem(`dpmf:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || Date.now() - parsed.at > SESSION_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function sessionWrite(key, data) {
  try {
    sessionStorage.setItem(`dpmf:${key}`, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // private mode / quota
  }
}

async function paginate(fetchPage, pageSize = PAGE_SIZE, onPage, maxRows = MAX_ROWS) {
  const all = [];
  const seen = new Set();
  let offset = 0;

  while (offset < maxRows) {
    const page = asArray(await fetchPage(pageSize, offset));
    if (!page.length) break;
    let added = 0;
    for (const row of page) {
      const account = String(row?.account || row?.address || row?.wallet || "").toLowerCase();
      const pair = String(row?.pool_name || row?.pool || row?.pair || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      const key = account ? (pair ? `${account}|${pair}` : account) : "";
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      all.push(row);
      added += 1;
    }
    onPage?.(all);
    if (page.length < pageSize) break;
    // Upstream ignored offset (same page again) — stop instead of twinning rows.
    if (added === 0) break;
    offset += page.length;
    await sleep(600);
  }

  return all;
}

function mapHolder(row, index) {
  return {
    rank: numberOrNull(row.rank) ?? index + 1,
    account: pick(row, ["account", "address", "wallet"]),
    balance: numberOrNull(pick(row, ["balance", "xio", "amount"])) ?? 0,
    frozen: Boolean(row.frozen),
    updated: pick(row, ["updated", "timestamp", "as_of"]),
  };
}

function mapLp(row, index) {
  const pair = pick(row, ["pool_name", "pool", "pair"]) || pairFromRow(row);
  const lp = numberOrNull(pick(row, ["lp_balance", "balance", "lp"])) ?? 0;
  return {
    rank: numberOrNull(row.rank) ?? index + 1,
    account: pick(row, ["account", "address", "wallet"]),
    lp_balance: lp,
    balance: lp,
    pair,
    pool_name: pair,
    frozen: Boolean(row.frozen),
    updated: pick(row, ["updated", "timestamp", "as_of"]),
  };
}

function mapPool(row) {
  if (!row || typeof row !== "object") return null;
  const pair = pick(row, ["pool_name", "pool", "pair"]) || pairFromRow(row);
  const [asset, quoteFromName] = String(pair || "XIO/XRP").split("/");
  const ammAccount = pick(row, ["amm_account", "amm", "account"]);
  return {
    pool: pair,
    pool_name: pair,
    asset: asset || "XIO",
    quote: pick(row, ["quote"]) || quoteFromName || "XRP",
    quote_issuer: pick(row, ["quote_issuer"]) || null,
    quote_hex: pick(row, ["quote_hex"]) || null,
    amm_account: ammAccount || null,
    lp_currency: pick(row, ["lp_currency", "lp_currency_hex"]) || null,
    tvl: numberOrNull(pick(row, ["tvl_usd", "tvl", "total_value_locked", "liquidity"])),
    price: numberOrNull(pick(row, ["price", "price_usd"])),
    apr: numberOrNull(pick(row, ["apr", "apy"])),
    volume24h: numberOrNull(pick(row, ["volume24hXio", "volume24h", "volume_24h", "volume"])),
    volume24hXio: numberOrNull(pick(row, ["volume24hXio", "volume_24h_xio"])),
    volume24hXrp: numberOrNull(pick(row, ["volume24hXrp", "volume_24h_xrp"])),
    volume24hUsd: numberOrNull(pick(row, ["volume24hUsd", "volume_24h_usd"])),
    volume7d: numberOrNull(pick(row, ["volume7dXio", "volume7d", "volume_7d"])),
    volume7dXio: numberOrNull(pick(row, ["volume7dXio", "volume7d", "volume_7d"])),
    volumeUnit: pick(row, ["volumeUnit", "volume_unit"]) || null,
    volumeSource: pick(row, ["volumeSource", "volume_source"]) || null,
    xioPerXrp: numberOrNull(pick(row, ["xioPerXrp", "xio_per_xrp", "exchXrp"])),
    reserve_asset: numberOrNull(
      pick(row, [
        "reserve_asset",
        "reserveAsset",
        "reserve_xio",
        "amount",
        "asset_reserve",
        "xio_reserve",
      ])
    ),
    reserve_currency: numberOrNull(
      pick(row, [
        "reserve_currency",
        "reserveCurrency",
        "amount2",
        "quote_reserve",
        ...((pick(row, ["quote"]) || quoteFromName || "XRP") === "XRP" ? ["xrp_reserve"] : []),
      ])
    ),
    lp_supply: numberOrNull(pick(row, ["lp_supply", "lpSupply", "lp_token.value", "lpToken"])),
    trading_fee:
      numberOrNull(pick(row, ["trading_fee", "tradingFee", "TradingFee", "fee", "fee_bps", "trading_fee_bps"])) ?? 0,
    holder_count: numberOrNull(pick(row, ["holder_count", "lp_holder_count"])),
    xioUsd: numberOrNull(pick(row, ["xioUsd", "xio_usd"])),
    quote_usd: numberOrNull(pick(row, ["quote_usd"])),
    xio_pct: numberOrNull(pick(row, ["xio_pct"])),
    quote_pct: numberOrNull(pick(row, ["quote_pct"])),
    lead: pick(row, ["lead"]) || null,
    updated: pick(row, ["updated", "timestamp", "updated_at"]),
  };
}

function withPoolSplit(row, fallbackXioUsd, fallbackXrpUsd, prices = {}) {
  if (!row) return row;
  const xioUsd = row.xioUsd || fallbackXioUsd;
  const priceBook = { ...prices, xrpUsd: fallbackXrpUsd, XRP: fallbackXrpUsd || prices.xrpUsd };
  const reserveQuote = sanePoolQuoteReserve(row);
  const marketQuoteUsd = detectQuoteUsd({
    quoteId: row.quote,
    pool: { ...row, xioUsd, reserve_currency: reserveQuote },
    prices: priceBook,
    allowImplied: false,
  });
  const split = preferUsdPoolSplit({
    reserveXio: row.reserve_asset,
    reserveQuote,
    lpSupply: reserveQuote != null ? row.lp_supply : 0,
    price: row.price,
    xioUsd,
    quoteUsd: marketQuoteUsd,
  });
  return {
    ...row,
    reserve_currency: reserveQuote,
    xioUsd: xioUsd || null,
    quote_usd: marketQuoteUsd || null,
    xio_pct: split?.xioPct ?? null,
    quote_pct: split?.quotePct ?? null,
    lead: split?.lead || null,
    split_basis: split?.basis || null,
  };
}

function uniquePools(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = String(
      row.amm_account ||
        `${row.pool}|${row.reserve_asset}|${row.reserve_currency}|${row.lp_supply}`
    );
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function dedupeOwnerRows(rows, keyOf) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function finishHolders(rows) {
  return dedupeOwnerRows(
    rows.map(mapHolder).filter((row) => row.account),
    (row) => String(row.account).toLowerCase()
  )
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function pickFreshness(payload, rows = []) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      as_of: payload.as_of || payload.updated || null,
      snapshot_day: payload.snapshot_day || null,
      source: payload.source || null,
      present: Boolean(payload.present),
      catching_up: Boolean(payload.catching_up || payload.present === false),
      age_seconds: numberOrNull(payload.age_seconds),
      count: numberOrNull(payload.count),
    };
  }
  const updated = rows.find((row) => row.updated)?.updated || null;
  return {
    as_of: updated,
    snapshot_day: null,
    source: rows.length ? "token_holders_latest" : null,
    present: rows.length > 0,
    catching_up: false,
    age_seconds: null,
    count: rows.length || null,
  };
}

function finishLp(rows) {
  return dedupeOwnerRows(
    rows.map(mapLp).filter((row) => row.account),
    (row) => {
      const account = String(row.account).toLowerCase();
      const pair = String(row.pair || row.pool_name || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      return pair ? `${account}|${pair}` : account;
    }
  )
    .sort((a, b) => Number(b.lp_balance) - Number(a.lp_balance))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function getOverview() {
  return api.overview();
}

export async function getAmm() {
  const [body, prices, flows] = await Promise.all([
    api.lpPools().catch(() => ({ pools: [], catching_up: true })),
    api.prices().catch(() => ({})),
    getXioFlows().catch(() => []),
  ]);
  const xioUsd = numberOrNull(prices?.xioUsd ?? prices?.recorded_price);
  const xrpUsd = numberOrNull(prices?.xrpUsd);
  return overlayPoolFlowVolumes(
    uniquePools(
      asArray(body)
        .map(mapPool)
        .filter(Boolean)
        .map((row) => withPoolSplit(row, row.xioUsd || xioUsd, xrpUsd, prices))
    ),
    flows
  );
}

export async function discoverLiveAmmPool(pair, extra = {}) {
  const name = String(pair || "").replace(/\s+/g, "").toUpperCase();
  const ammAccount = String(extra.ammAccount || extra.amm_account || "").trim();
  const validPair = /^XIO\/[A-Z0-9]{2,12}$/.test(name);
  if (!validPair && !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(ammAccount)) return null;
  const [live, flows] = await Promise.all([
    getLiveLpReserves({
      pair: validPair ? name : extra.pair || extra.pool,
      quote: extra.quote || (validPair ? name.split("/")[1] : undefined),
      issuer: extra.issuer || extra.quote_issuer,
      hex: extra.hex || extra.quote_hex,
      ammAccount,
    }).catch(() => null),
    getXioFlows().catch(() => []),
  ]);
  if (!live || live.empty || live.reserve_source === "empty") return null;
  if (
    !(
      numberOrNull(live.reserve_xio ?? live.reserve_asset) ||
      numberOrNull(live.reserve_currency ?? live.reserve_quote) ||
      numberOrNull(live.lp_supply)
    )
  ) {
    return null;
  }
  const resolved = String(live.pair || name || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const mapped = mapPool({
    ...live,
    pool: resolved || live.pair,
    pool_name: resolved || live.pair,
    quote: extra.quote || (resolved.includes("/") ? resolved.split("/")[1] : live.quote),
    quote_issuer: extra.issuer || live.quote_issuer,
    quote_hex: extra.hex || live.quote_hex,
    amm_account: live.amm_account || ammAccount,
  });
  return overlayPoolFlowVolumes([mapped], flows)[0] || mapped;
}

let lastOrderbooks = null;

function emptyCatalog() {
  const names = [...FEATURED_ORDERBOOK_PAIRS];
  return {
    quotes: names.map((pair) => pair.split("/")[1]),
    featured: names,
    pairs: names,
    default_pair: "XIO/XRP",
    books: {},
  };
}

function composeCatalogBook(raw, pair, xrpBook) {
  const name = normalizeOrderbookPair(pair);
  const reserves = raw?.amm || {};
  if (name === "XIO/XRP") {
    return composeAmmBook(raw, reserves, name);
  }
  return composeAmmBook(raw, reserves, name, {
    xrpBook: xrpBook || lastOrderbooks?.books?.["XIO/XRP"] || null,
  });
}

function ingestOrderbooks(body, pairHint = "XIO/XRP") {
  if (!body || typeof body !== "object") return lastOrderbooks;
  if (body.books && typeof body.books === "object") {
    const names = sortOrderbookPairs([
      ...FEATURED_ORDERBOOK_PAIRS,
      ...(Array.isArray(body.pairs) ? body.pairs : []),
      ...Object.keys(body.books),
    ]);
    const xrpRaw = body.books["XIO/XRP"] || emptyOrderbook("XIO/XRP");
    const xrpBook = composeAmmBook(xrpRaw, xrpRaw.amm || {}, "XIO/XRP");
    const books = {};
    for (const pair of names) {
      if (pair === "XIO/XRP") {
        books[pair] = xrpBook;
        continue;
      }
      const raw = body.books[pair] || body[pair] || emptyOrderbook(pair);
      // Non-XIO liquid pairs (XRP/RLUSD) use indexer book shape, not XIO bridge.
      if (!String(pair).toUpperCase().startsWith("XIO/")) {
        books[pair] = asLiquidPairBook(raw, pair);
        continue;
      }
      books[pair] = composeCatalogBook(raw, pair, xrpBook);
    }
    lastOrderbooks = mergeOrderbookPayloads(lastOrderbooks, {
      quotes: names.map((pair) => pair.split("/")[1]).filter(Boolean),
      featured: FEATURED_ORDERBOOK_PAIRS,
      pairs: names,
      default_pair: body.default_pair || "XIO/XRP",
      books,
    });
    return lastOrderbooks;
  }

  const name = normalizeOrderbookPair(pairHint || body.pair || "XIO/XRP");
  const raw = body.book || body;
  const book = composeCatalogBook(raw, name, lastOrderbooks?.books?.["XIO/XRP"]);
  lastOrderbooks = mergeOrderbookPayloads(lastOrderbooks || emptyCatalog(), {
    books: { [name]: book },
  });
  return lastOrderbooks;
}

export async function getOrderbook(pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair);
  try {
    return ingestOrderbooks(await api.orderbook(name), name);
  } catch {
    if (lastOrderbooks) return lastOrderbooks;
    throw new Error("Waiting for XRPL book_offers on this pair.");
  }
}

export async function getLiquidPairBook(pair = "XRP/RLUSD") {
  const name = normalizeOrderbookPair(pair);
  try {
    const body = await api.book(name);
    return asLiquidPairBook(body, name);
  } catch {
    return null;
  }
}

export async function getLiquidPairAmm(pair = "XRP/RLUSD") {
  const name = normalizeOrderbookPair(pair);
  try {
    const body = await api.ammPair(name);
    if (!body || typeof body !== "object") return null;
    return body;
  } catch {
    return null;
  }
}

export async function getWatchPairs() {
  try {
    return await api.pairs();
  } catch {
    return null;
  }
}

export async function getOrderbooks() {
  try {
    return ingestOrderbooks(await api.orderbooks());
  } catch {
    if (lastOrderbooks) return lastOrderbooks;
    throw new Error("Waiting for XRPL book_offers on this pair.");
  }
}

const lastOwnerLists = new Map();

async function loadPagedOwners({
  cacheKey,
  requestFirst,
  requestRest,
  requestLast,
  requestLastRest,
  finish,
  onPage,
  firstSize,
  restPageSize,
}) {
  const cached = sessionRead(cacheKey) || lastOwnerLists.get(cacheKey);
  const lastGood = cached?.rows?.length
    ? cached
    : Array.isArray(cached) && cached.length
      ? { rows: cached, freshness: null }
      : lastOwnerLists.get(cacheKey) || null;
  if (lastGood?.rows?.length) onPage?.(lastGood.rows, lastGood.freshness || null);

  let payload = await requestFirst();
  let first = asArray(payload);
  let freshness = pickFreshness(payload, finish(first));
  let restFetch = requestRest;

  if (!first.length && freshness.catching_up && requestLast) {
    try {
      const lastPayload = await requestLast();
      const lastRows = asArray(lastPayload);
      if (lastRows.length) {
        payload = lastPayload;
        first = lastRows;
        freshness = {
          ...pickFreshness(lastPayload, finish(lastRows)),
          catching_up: true,
          present: false,
        };
        restFetch = requestLastRest || requestRest;
      }
    } catch {
      // keep the empty today envelope and fall back to the last painted list
    }
  }

  const firstMapped = finish(first);
  const kept = keepLastGoodOwners(lastGood, { rows: firstMapped, freshness });
  lastOwnerLists.set(cacheKey, kept);
  onPage?.(kept.rows, kept.freshness);
  sessionWrite(cacheKey, kept);

  if (!firstMapped.length || !shouldFetchMoreRows(first.length, firstSize, freshness.count)) {
    return kept.rows;
  }

  const rest = await paginate(
    restFetch,
    restPageSize,
    (all) => {
      const mapped = finish([...first, ...all]);
      const next = keepLastGoodOwners(kept, { rows: mapped, freshness });
      lastOwnerLists.set(cacheKey, next);
      onPage?.(next.rows, next.freshness);
      sessionWrite(cacheKey, next);
    },
    MAX_ROWS - firstSize
  );
  const mapped = finish([...first, ...rest]);
  const next = keepLastGoodOwners(kept, { rows: mapped, freshness });
  lastOwnerLists.set(cacheKey, next);
  sessionWrite(cacheKey, next);
  return next.rows;
}

export async function getTopHolders(onPage) {
  return loadPagedOwners({
    cacheKey: "holders",
    requestFirst: () => api.topHolders(FIRST_HOLDERS, 0, { snapshot: "today" }),
    requestRest: (limit, offset) =>
      api.topHolders(limit, FIRST_HOLDERS + offset, { snapshot: "today" }),
    requestLast: () => api.topHolders(FIRST_HOLDERS, 0, { snapshot: "latest" }),
    requestLastRest: (limit, offset) =>
      api.topHolders(limit, FIRST_HOLDERS + offset, { snapshot: "latest" }),
    finish: finishHolders,
    onPage,
    firstSize: FIRST_HOLDERS,
    restPageSize: PAGE_SIZE,
  });
}

async function fetchXrplToLpOwners() {
  const pages = await Promise.all(
    [
      ["XIO/XRP", XIO_XRP_LP_XRPL_TO_MD5],
      ["XIO/RLUSD", XIO_RLUSD_LP_XRPL_TO_MD5],
    ].map(async ([pool, md5]) => {
      const response = await fetch(`https://api.xrpl.to/v1/holders/list/${md5}?limit=200&offset=0`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) return [];
      const body = await response.json();
      return (Array.isArray(body.richList) ? body.richList : []).map((row) => ({
        ...row,
        pool_name: pool,
        lp_balance: Number(row.balance) || 0,
      }));
    })
  );
  return { holders: pages.flat(), rows: pages.flat(), present: true, catching_up: false, source: "xrpl.to" };
}

export async function getTopLp(onPage) {
  const rows = await loadPagedOwners({
    cacheKey: "lpHolders",
    requestFirst: () => api.topLp(FIRST_LP, 0, { snapshot: "today", pool: "all" }),
    requestRest: (limit, offset) =>
      api.topLp(limit, FIRST_LP + offset, { snapshot: "today", pool: "all" }),
    requestLast: () => api.topLp(FIRST_LP, 0, { snapshot: "latest", pool: "all" }),
    requestLastRest: (limit, offset) =>
      api.topLp(limit, FIRST_LP + offset, { snapshot: "latest", pool: "all" }),
    finish: finishLp,
    onPage,
    firstSize: FIRST_LP,
    restPageSize: 50,
  });
  if (rows.length) return rows;
  try {
    const payload = await fetchXrplToLpOwners();
    const mapped = finishLp(asArray(payload));
    if (mapped.length) onPage?.(mapped, pickFreshness(payload, mapped));
    return mapped;
  } catch {
    return rows;
  }
}

const XRPL_TO_TOKEN_TTL_MS = 60_000;
let xrplToTokenCache = { at: 0, token: null };

export async function fetchXrplToToken() {
  const now = Date.now();
  if (xrplToTokenCache.token && now - xrplToTokenCache.at < XRPL_TO_TOKEN_TTL_MS) {
    return xrplToTokenCache.token;
  }
  const response = await fetch(XRPL_TO_TOKEN_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return xrplToTokenCache.token;
  const token = parseXrplToToken(await response.json());
  xrplToTokenCache = { at: now, token };
  return token;
}

async function withXrplToBackup(overview, prices, change) {
  if (
    !marketNeedsXrplTo(overview) &&
    !marketNeedsXrplTo(prices) &&
    !countsNeedXrplTo(overview) &&
    Number(change?.xio)
  ) {
    return { overview, prices, change };
  }
  try {
    const token = await fetchXrplToToken();
    if (!token) return { overview, prices, change };
    return {
      overview: applyXrplToOverview(overview, token, prices),
      prices: applyXrplToPrices(prices, token),
      change: applyXrplToChange(change, token),
    };
  } catch {
    return { overview, prices, change };
  }
}


function preferLedgerCount(endpointBody, overviewCount) {
  const fromEndpoint = numberOrNull(endpointBody?.count);
  const fromOverview = numberOrNull(overviewCount);
  const catching = Boolean(endpointBody?.catching_up) || endpointBody?.present === false;
  if (catching && fromOverview != null && fromOverview > 0) {
    return { count: Math.max(fromEndpoint || 0, fromOverview) };
  }
  if (fromEndpoint != null && fromEndpoint > 0 && fromOverview != null && fromOverview > 0) {
    // Partial today/live scans can under-count; keep the healthier on-ledger figure.
    if (fromEndpoint < fromOverview * 0.5 || fromOverview - fromEndpoint > 500) {
      return { count: fromOverview };
    }
    return { count: Math.max(fromEndpoint, fromOverview) };
  }
  if (fromEndpoint != null && fromEndpoint > 0) return { count: fromEndpoint };
  if (fromOverview != null && fromOverview > 0) return { count: fromOverview };
  return { count: fromEndpoint ?? fromOverview ?? null };
}

export async function getTokenDetails(onPartial) {
  const [overview, prices, change] = await Promise.all([
    api.overview().catch(() => ({})),
    api.prices().catch(() => ({})),
    api.change24h().catch(() => ({})),
  ]);
  const backed = await withXrplToBackup(overview, fillMissingXioFiat(prices), change);
  const core = composeTokenDetails(backed);
  onPartial?.(core);

  const [holders, trustlines, lpHolders, lpTrustlines, issuerLocked] = await Promise.all([
    api.holdersCount({ snapshot: "today" }).catch(() => ({})),
    api.trustlinesCount().catch(() => ({})),
    api.lpHoldersCount({ pool: "all" }).catch(() => ({})),
    api.lpTrustlinesCount({ pool: "all" }).catch(() => ({})),
    api.issuerLocked().catch(() => ({})),
  ]);
  return composeTokenDetails({
    ...backed,
    overview: {
      ...backed.overview,
      issuer_locked:
        numberOrNull(backed.overview.issuer_locked ?? backed.overview.burned_supply) ??
        numberOrNull(issuerLocked?.issuer_locked ?? issuerLocked?.burned_supply),
      circulating:
        numberOrNull(backed.overview.circulating ?? backed.overview.circulating_supply) ??
        numberOrNull(issuerLocked?.circulating),
      issued: numberOrNull(backed.overview.issued ?? backed.overview.issued_xio) ?? numberOrNull(issuerLocked?.issued),
    },
    holders: preferLedgerCount(holders, backed.overview.holder_count ?? backed.overview.holders),
    trustlines: preferLedgerCount(
      trustlines,
      backed.overview.trustline_count ?? backed.overview.trustlines
    ),
    lpHolders: preferLedgerCount(lpHolders, backed.overview.lp_holder_count),
    lpTrustlines: preferLedgerCount(lpTrustlines, backed.overview.lp_trustline_count),
  });
}

export async function getTokenDetailsHistory() {
  const take = (promise) => promise.then(chartArray).catch(() => []);
  const [holders, trustlinesOrEmpty, tvl, lpHolders, lpTrustlines, sparkline, candlesBody, overview, prices] =
    await Promise.all([
      take(api.holdersHistory({ queue: false, retries: 1 })),
      take(api.trustlinesHistory()),
      take(api.tvlHistory()),
      take(api.lpHoldersHistory()),
      take(api.lpTrustlinesHistory({ pool: "all" })),
      take(api.sparkline("XIO")),
      api.candles().catch(() => ({})),
      api.overview().catch(() => ({})),
      api.prices().catch(() => ({})),
    ]);
  const activity =
    !holders.length || !trustlinesOrEmpty.length ? await take(api.activityHistory()) : [];
  const localIssued = mergeActivityRows(holders, trustlinesOrEmpty, activity);
  const issued = mergeActivityRows(
    localIssued,
    needsFullIssuanceHistory(localIssued) ? await fetchXrplToIssued() : []
  );
  const candlePrices = xioPriceHistoryRows(candlesBody);
  const priceRows = historyLooksShort(candlePrices, sparkline)
    ? [...(await fetchXrplToOhlc()), ...candlePrices]
    : candlePrices;
  const live = composeTokenDetails({
    overview,
    prices: fillMissingXioFiat(prices),
    holders: { count: overview.holder_count },
    trustlines: { count: overview.trustline_count },
    lpHolders: { count: overview.lp_holder_count },
    lpTrustlines: { count: overview.lp_trustline_count },
  });
  return composeTokenDetailHistory({
    holders: issued,
    trustlines: issued,
    tvl,
    lpHolders,
    lpTrustlines,
    sparkline,
    candles: priceRows,
    lockedCandles,
    amm: Array.isArray(candlesBody?.amm_pool_history) ? candlesBody.amm_pool_history : [],
    live: {
      ...live,
      timestamp: new Date().toISOString(),
      xrpUsd: live.xrpUsd ?? prices?.xrpUsd ?? overview?.xrpUsd,
      price: live.recorded_price ?? live.xioUsd,
      holders: live.holders,
      trustlines: live.trustlines,
      circulating: live.circulating,
      burnedSupply: live.burnedSupply ?? live.issuerLocked,
      totalSupply: live.totalSupply,
      lpHolders: live.lp_holder_count,
      lpTrustlines: live.lp_trustline_count,
      lpSupply: live.lp_supply,
    },
  });
}

const XRPL_TO_TTL_MS = 5 * 60_000;
let xrplToIssuedCache = { at: 0, rows: [], blockedUntil: 0 };

async function fetchXrplToIssued() {
  const now = Date.now();
  if (now < xrplToIssuedCache.blockedUntil) return xrplToIssuedCache.rows;
  if (xrplToIssuedCache.rows.length && now - xrplToIssuedCache.at < XRPL_TO_TTL_MS) {
    return xrplToIssuedCache.rows;
  }
  try {
    const response = await fetch(xrplToHolderGraphUrl("ALL"), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 429) {
      xrplToIssuedCache = { ...xrplToIssuedCache, blockedUntil: now + XRPL_TO_TTL_MS };
      return xrplToIssuedCache.rows;
    }
    if (!response.ok) return xrplToIssuedCache.rows;
    const rows = rowsFromXrplToGraph(await response.json());
    xrplToIssuedCache = { at: now, rows, blockedUntil: 0 };
    return rows;
  } catch {
    return xrplToIssuedCache.rows;
  }
}

const XRPL_TO_OHLC_URL = `https://api.xrpl.to/v1/ohlc/${XIO_XRPL_TO_MD5}?range=ALL&interval=1d&vs_currency=USD`;
let xrplToOhlcCache = { at: 0, rows: [], blockedUntil: 0 };

function historyLooksShort(...lists) {
  const rows = lists.flatMap((list) => (Array.isArray(list) ? list : []));
  if (rows.length < 50) return true;
  let first = Infinity;
  for (const row of rows) {
    const ms = Date.parse(row?.timestamp || row?.day || row?.ts || "");
    if (Number.isFinite(ms) && ms < first) first = ms;
  }
  return !Number.isFinite(first) || Date.now() - first < 60 * 86400000;
}

async function fetchXrplToOhlc() {
  const now = Date.now();
  if (now < xrplToOhlcCache.blockedUntil) return xrplToOhlcCache.rows;
  if (xrplToOhlcCache.rows.length && now - xrplToOhlcCache.at < XRPL_TO_TTL_MS) {
    return xrplToOhlcCache.rows;
  }
  try {
    const response = await fetch(XRPL_TO_OHLC_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 429) {
      xrplToOhlcCache = { ...xrplToOhlcCache, blockedUntil: now + XRPL_TO_TTL_MS };
      return xrplToOhlcCache.rows;
    }
    if (!response.ok) return xrplToOhlcCache.rows;
    const rows = rowsFromOhlc(await response.json());
    xrplToOhlcCache = { at: now, rows, blockedUntil: 0 };
    return rows;
  } catch {
    return xrplToOhlcCache.rows;
  }
}

export async function getChartHistory() {
  const take = (promise) => promise.then(chartArray).catch(() => []);
  const [apiIssued, apiActivity, apiTraders] = await Promise.all([
    take(api.holdersHistory({ queue: false, retries: 1 })),
    take(api.activityHistory()),
    take(api.tradersHistory()),
  ]);
  const localIssued = mergeActivityRows(apiIssued, apiActivity, apiTraders);
  const remote = needsFullIssuanceHistory(localIssued) ? await fetchXrplToIssued() : [];
  const issued = mergeActivityRows(localIssued, remote);

  const live = await api.overview().catch(() => null);
  const lastTraders = [...issued]
    .reverse()
    .find((row) => numberOrNull(row.traders ?? row.trader_count) != null);
  const rows = carryActivityMetrics(
    issuedActivitySeries(
      issued,
      live && (live.holder_count != null || live.trustline_count != null)
        ? {
            timestamp: new Date().toISOString(),
            holders: live.holder_count ?? live.holders,
            trustlines: live.trustline_count ?? live.trustlines,
            traders: lastTraders?.traders ?? lastTraders?.trader_count,
          }
        : null
    )
  );
  return rows;
}

export async function getDailyXioVolumeRows() {
  return fetchXrplToOhlc();
}

export async function getXioFlows() {
  let payload;
  try {
    payload = await api.xioFlows();
  } catch {
    payload = await api.trades().catch(() => []);
  }
  const rows = asArray(payload);
  return rows
    .map((row) => ({
      timestamp: rowTimestamp(row),
      account: row.account || row.address || row.wallet || null,
      pool: row.pool || row.pool_name || null,
      side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
      xio: numberOrNull(row.xio ?? row.amount) ?? 0,
      quote: numberOrNull(row.quote) ?? 0,
      price: numberOrNull(row.price),
    }))
    .filter((row) => row.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export async function getTradeHistory() {
  return getXioFlows();
}

function amountFromBalances(payload, names) {
  if (payload == null) return null;
  if (typeof payload === "number" || typeof payload === "string") {
    return numberOrNull(payload);
  }

  const list = asArray(payload.balances || payload.lines || payload);
  for (const row of list) {
    const currency = String(row.currency || row.code || row.symbol || "").toUpperCase();
    if (names.some((name) => currency === name.toUpperCase() || currency.includes(name.toUpperCase()))) {
      return numberOrNull(row.value ?? row.balance ?? row.amount);
    }
  }

  for (const name of names) {
    const direct = numberOrNull(payload[name] ?? payload[name.toLowerCase()]);
    if (direct != null) return direct;
  }
  return null;
}

export async function getWalletBalances(address) {
  let payload;
  try {
    payload = await api.balances(address);
  } catch {
    payload = await getJsonAlias(address);
  }

  const drops = numberOrNull(payload?.balance_drops ?? payload?.Balance ?? payload?.account?.balance_drops);
  function held(value, fallback) {
    const n = numberOrNull(value);
    if (n > 0) return n;
    if (fallback > 0) return fallback;
    if (n != null) return n;
    return fallback ?? null;
  }
  const xioFromLines = amountFromBalances(payload, ["XIO", "5844580000000000000000000000000000000000"]);
  const xrpHeld = held(
    payload?.xrp,
    drops != null && drops > 0 ? drops / 1_000_000 : amountFromBalances(payload, ["XRP"])
  );
  return {
    raw: payload,
    xrp: xrpHeld > 0 ? xrpHeld : null,
    xio: held(payload?.xio, xioFromLines),
    lp:
      numberOrNull(payload?.lp) ??
      amountFromBalances(payload, [
        "LP",
        "03970105D80AE3C54085F6E97EE16CEDE6CE8200",
        "03BCD44104644B711C58CD14CD13CBA65757CFBE",
      ]),
    rlusd:
      numberOrNull(payload?.rlusd) ??
      amountFromBalances(payload, ["RLUSD", "524C555344000000000000000000000000000000"]),
  };
}

async function getJsonAlias(address) {
  const res = await fetch(`/api/balances/${encodeURIComponent(address)}`, {
    headers: { accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `${res.status} ${res.statusText}`);
  }
  return data;
}

export async function getWalletNetworth(address) {
  return api.networth(address);
}

export async function getWalletAccount(address) {
  return api.walletAccount(address);
}

export async function getWalletLp(address, extra = {}) {
  const name = String(address || "").trim();
  if (!name) return [];
  const body = await api.walletLp(name, extra);
  return asArray(body?.positions || body);
}

export async function getWalletRank(address) {
  const body = await api.walletRank(address);
  return numberOrNull(body?.rank);
}

export async function getPrices() {
  const prices = fillMissingXioFiat(await api.prices().catch(() => ({})));
  if (!pricesNeedFiat(prices)) return prices;
  try {
    return fillMissingXioFiat(applyXrplToPrices(prices, await fetchXrplToToken()));
  } catch {
    return prices;
  }
}

export async function getWalletOffers(address, extra = {}) {
  const name = String(address || "").trim();
  if (!name) return [];
  const body = await api.walletOffers(name, extra);
  return asArray(body?.orders || body);
}

export async function getWalletLines(address, extra = {}) {
  const name = String(address || "").trim();
  if (!name) return [];
  const body = await api.walletLines(name, extra);
  return normalizeWalletLines(body);
}

export async function getWalletVotes(address) {
  const name = String(address || "").trim();
  if (!name) return [];
  const body = await api.walletVotes(name);
  return asArray(body?.activity || body);
}

export async function getPoolGovernance(pair, account, extra = {}) {
  return api.ammGovernance(pair, account, extra);
}

export async function getLiveLpReserves(query = {}) {
  const body = await api.lpPoolsLive(query);
  return body && typeof body === "object" ? body : null;
}

export async function getSwapMarket(query = {}) {
  const body = await api.swapMarket(query);
  return body && typeof body === "object" ? body : null;
}

export async function getWalletActivity(address, extra = {}) {
  const name = String(address || "").trim();
  if (!name) return [];
  const body = await api.walletActivity(name, extra);
  return asArray(body?.activity || body);
}

export async function getWalletLpIncome(address, extra = {}) {
  const name = String(address || "").trim();
  if (!name) return { account: null, pair: extra.pair || "ALL", activity: [], complete: true, marker: null };
  const body = await api.walletLpIncome(name, extra);
  return {
    account: body?.account || name,
    pair: body?.pair || extra.pair || "ALL",
    activity: asArray(body?.activity),
    days: asArray(body?.days),
    complete: body?.complete === true,
    marker: body?.marker || null,
    source: body?.source || null,
  };
}

const LP_INCOME_CLIENT_PAGES = 80;

export async function loadWalletLpIncomeHistory(address, extra = {}) {
  const name = String(address || "").trim();
  const pair = extra.pair && extra.pair !== "ALL" ? extra.pair : "";
  if (!name) return { account: null, pair: pair || "ALL", activity: [], days: [], complete: true };
  const merged = [];
  const days = [];
  let marker = extra.marker || null;
  let complete = false;
  for (let page = 0; page < LP_INCOME_CLIENT_PAGES; page += 1) {
    const next = await getWalletLpIncome(name, {
      ...(pair ? { pair } : {}),
      marker,
      fresh: extra.fresh && page === 0,
    });
    merged.push(...next.activity);
    days.push(...(next.days || []));
    marker = next.marker;
    complete = next.complete === true || !marker;
    extra.onPage?.({ activity: merged, days, complete: next.complete === true, pages: page + 1 });
    if (complete) break;
  }
  return { account: name, pair: pair || "ALL", activity: merged, days, complete, marker: complete ? null : marker };
}

export async function getConnectedWallet(address, extra = {}) {
  const name = String(address || "").trim();
  if (!name) return emptyWalletSnapshot(null);

  const [balances, networth, account, lpRows, rank, prices, token, pools, books, flows, offers, ledgerActivity, lines, ohlcRows] =
    await Promise.all([
      getWalletBalances(name).catch(() => ({})),
      getWalletNetworth(name).catch(() => ({})),
      getWalletAccount(name).catch(() => ({})),
      getWalletLp(name).catch(() => []),
      getWalletRank(name).catch(() => null),
      getPrices().catch(() => ({})),
      getTokenDetails().catch(() => ({})),
      getAmm().catch(() => []),
      getOrderbooks().catch(() => null),
      getXioFlows().catch(() => []),
      getWalletOffers(name, extra).catch(() => []),
      getWalletActivity(name, extra).catch(() => []),
      getWalletLines(name, extra).catch(() => []),
      getDailyXioVolumeRows().catch(() => []),
    ]);

  return composeWalletSnapshot({
    address: name,
    balances,
    account,
    networth,
    prices,
    token,
    pools,
    lpRows,
    rank,
    books,
    flows,
    offers,
    ledgerActivity,
    lines: lines.length ? lines : balances.lines || balances.raw?.lines || [],
    ohlcRows,
  });
}
