import {catalogXioVolume24h, catalogXioVolume7d, projectXioMarketDaysToPair} from "../utils/lpVolume.js";
import {detectQuoteUsd, normalizePriceBook} from "../utils/poolSplit.js";

export const DEFAULT_INCOME_PAIR = "XIO/XRP";
export const INCOME_ALL_PAIRS = "ALL";
export const INCOME_FEATURED_PAIRS = ["XIO/XRP", "XIO/RLUSD", "XIO/XDX", "XIO/XSQUAD"];
export const LP_INCOME_STORE_PREFIX = "dpmf-lp-fees-v1:";
const CREDIT_KINDS = new Set(["deposit", "create", "credit"]);
export const HISTORICAL_INCOME_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const CATALOG_FILL_DAYS = 7;

export function looksLikeXrplAddress(value) {
  const text = String(value || "").trim();
  if (/^r[1-9A-HJ-NP-Za-km-z]{3,}(?:…|\.\.\.)[1-9A-HJ-NP-Za-km-z]{2,}$/.test(text)) return true;
  const compact = text.replace(/[.…]/g, "");
  return /^r[1-9A-HJ-NP-Za-km-z]{20,34}$/.test(compact);
}

function normalizeWalletPair(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "/");
  if (!raw) return "";
  if (looksLikeXrplAddress(value) || looksLikeXrplAddress(raw) || looksLikeXrplAddress(raw.split("/")[1])) {
    return "";
  }
  if (raw === "XRP" || raw === "XRP/XIO") return "XIO/XRP";
  if (raw.startsWith("XIO/")) return raw;
  return `XIO/${raw}`;
}

export function incomePairName(value) {
  return normalizeWalletPair(value) || DEFAULT_INCOME_PAIR;
}

export function isAllIncomePairs(value) {
  return String(value || "").trim().toUpperCase() === INCOME_ALL_PAIRS;
}

export function heldIncomePairs(positions = []) {
  const names = (Array.isArray(positions) ? positions : [])
    .filter((row) => num(row?.lp_balance) > 0)
    .map((row) => normalizeWalletPair(row?.pool || row?.pool_name || row?.pair || row))
    .filter((name) => isXioAmmPair(name));
  return [...new Set(names)].sort((left, right) => {
    if (left === DEFAULT_INCOME_PAIR) return -1;
    if (right === DEFAULT_INCOME_PAIR) return 1;
    return left.localeCompare(right);
  });
}

export function incomePairChoices({ positions = [] } = {}) {
  return [INCOME_ALL_PAIRS, ...heldIncomePairs(positions)];
}

function isCreditKind(kind) {
  return !kind || CREDIT_KINDS.has(kind);
}

export function filterIncomeByPair(rows = [], pair = DEFAULT_INCOME_PAIR) {
  const want = incomePairName(pair);
  return (Array.isArray(rows) ? rows : []).filter((row) => incomePairName(row?.pair) === want);
}

function tradingFeeRate(tradingFee) {
  const raw = Number(tradingFee);
  if (!(raw > 0)) return 1000 / 100_000;
  return raw > 20 ? raw / 100_000 : raw / 100;
}

export const INCOME_PAGE_DAYS = 14;

export function isXioAmmPair(value) {
  const pair = normalizeWalletPair(
    typeof value === "object" && value
      ? value.pool || value.pool_name || value.pair
      : value
  );
  return /^XIO\/[A-Z0-9.$]{2,20}$/.test(pair);
}

export function remapIncomeActivity(activity = [], positions = [], pools = []) {
  const catalog = [...(Array.isArray(positions) ? positions : []), ...(Array.isArray(pools) ? pools : [])];
  return (Array.isArray(activity) ? activity : [])
    .map((row) => {
      if (!row) return null;
      const named = normalizeWalletPair(row.pair || row.pool);
      if (isXioAmmPair(named) && !looksLikeXrplAddress(named.split("/")[1])) {
        return { ...row, pair: named, pool: named };
      }
      const amm = String(row.amm || row.amm_account || "").toLowerCase();
      const hex = String(row.lpCurrency || row.lp_currency || "").toUpperCase();
      const match = catalog.find((item) => {
        const itemAmm = String(item?.amm_account || item?.amm || "").toLowerCase();
        const itemHex = String(item?.lp_currency || item?.lp_currency_hex || "").toUpperCase();
        return (amm && itemAmm === amm) || (hex && itemHex === hex);
      });
      const remapped = normalizeWalletPair(
        match?.pool || match?.pool_name || match?.pair || named
      );
      if (!isXioAmmPair(remapped) || looksLikeXrplAddress(remapped.split("/")[1])) return null;
      return { ...row, pair: remapped, pool: remapped };
    })
    .filter(Boolean);
}

export function utcDayKey(value) {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pairQuote(pair, fallback) {
  const name = normalizeWalletPair(pair || fallback);
  return String(name.split("/")[1] || fallback || "")
    .trim()
    .toUpperCase();
}

function pickUsd(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function priceBookFromArgs(args = {}) {
  const fromPrices = args.prices && typeof args.prices === "object" ? args.prices : {};
  return normalizePriceBook({
    ...fromPrices,
    xioUsd: pickUsd(fromPrices.xioUsd, fromPrices.recorded_price, args.xioUsd),
    xrpUsd: pickUsd(fromPrices.xrpUsd, args.xrpUsd),
    RLUSD: pickUsd(fromPrices.RLUSD, fromPrices.quotes?.RLUSD, args.rlusdUsd) || 1,
  });
}

function preferPositive(...values) {
  for (const value of values) {
    if (value > 0) return value;
  }
  return 0;
}

function preferLargest(...values) {
  return values.reduce((best, value) => (value > best ? value : best), 0);
}

export function dailyHeldLpBalances({
  pair,
  activity = [],
  currentBalance = 0,
  fromDay = "",
  toDay = Date.now(),
} = {}) {
  const want = incomePairName(pair);
  const end = utcDayKey(toDay);
  const events = new Map();
  let first = "";
  for (const item of Array.isArray(activity) ? activity : []) {
    if (!item || incomePairName(item.pair || item.pool) !== want) continue;
    const day = utcDayKey(item.timestamp);
    if (!day) continue;
    const current = events.get(day) || { added: 0, removed: 0 };
    const tokens = num(item.lp);
    if (item.side === "addLp" || item.side === "createPool") {
      current.added += tokens;
      if (!first || day < first) first = day;
    }
    if (item.side === "removeLp") current.removed += tokens;
    events.set(day, current);
  }
  const start = utcDayKey(fromDay) || first || end;
  if (!want || !start || !end || start > end) return [];

  const dates = [];
  for (let ts = Date.parse(`${end}T00:00:00.000Z`); ts >= Date.parse(`${start}T00:00:00.000Z`); ts -= DAY_MS) {
    const date = utcDayKey(ts);
    if (date) dates.push(date);
  }

  let held = num(currentBalance);
  if (!(held > 0)) {
    let added = 0;
    let removed = 0;
    for (const event of events.values()) {
      added += event.added;
      removed += event.removed;
    }
    held = Math.max(0, added - removed);
  }

  return dates.map((date) => {
    const event = events.get(date) || { added: 0, removed: 0 };
    const lpBalance = held;
    const before = Math.max(0, held - event.added + event.removed);
    const lpAdded = event.added > 0 ? event.added : Math.max(0, lpBalance - before);
    held = before;
    return { date, pair: want, lpBalance, lpAdded, lpTokens: lpBalance };
  });
}

export function netHeldLp(pair, activity = [], currentBalance = 0) {
  const want = incomePairName(pair);
  let added = 0;
  let removed = 0;
  let first = "";
  for (const item of Array.isArray(activity) ? activity : []) {
    if (!item || incomePairName(item.pair || item.pool) !== want) continue;
    const tokens = num(item.lp);
    const day = utcDayKey(item.timestamp);
    if (item.side === "addLp" || item.side === "createPool") {
      added += tokens;
      if (day && (!first || day < first)) first = day;
    }
    if (item.side === "removeLp") removed += tokens;
  }
  const current = num(currentBalance);
  return {
    first,
    added,
    removed,
    held: current > 0 ? current : Math.max(0, added - removed),
  };
}

export function incomePositionForPair(pair, positions = [], pools = [], activity = []) {
  const want = incomePairName(pair);
  const catalog = poolForIncomePair(want, positions, pools);
  const existing =
    (Array.isArray(positions) ? positions : []).find(
      (row) => incomePairName(row?.pool || row?.pool_name || row?.pair) === want
    ) || {};
  const held = netHeldLp(want, activity, existing.lp_balance);
  const balance = preferPositive(num(existing.lp_balance), held.held, held.added);
  const supply = preferLargest(num(catalog.lp_supply), num(existing.lp_supply));
  const sharePct =
    supply > 0 && balance > 0
      ? (balance / supply) * 100
      : preferPositive(num(existing.lp_share_percent), num(catalog.lp_share_percent));
  if (!(sharePct > 0)) return null;
  return {
    ...catalog,
    ...existing,
    pool: want,
    pool_name: want,
    pair: want,
    quote: existing.quote || catalog.quote || want.split("/")[1],
    lp_balance: balance,
    lp_supply: supply,
    lp_share_percent: sharePct,
    trading_fee: preferPositive(num(existing.trading_fee), num(catalog.trading_fee)) || 1000,
    volume24h: preferPositive(num(existing.volume24h), num(catalog.volume24h), num(existing.volume24hXio), num(catalog.volume24hXio)),
    volume24hXio: preferPositive(num(existing.volume24hXio), num(catalog.volume24hXio), num(existing.volume24h), num(catalog.volume24h)),
    volume7d: preferPositive(num(existing.volume7d), num(catalog.volume7d), num(existing.volume7dXio), num(catalog.volume7dXio)),
    volume7dXio: preferPositive(num(existing.volume7dXio), num(catalog.volume7dXio), num(existing.volume7d), num(catalog.volume7d)),
  };
}

function volumeDaysFromPools(pools = [], now = Date.now()) {
  const today = utcDayKey(now);
  return (Array.isArray(pools) ? pools : [])
    .map((pool) => {
      const pair = incomePairName(pool?.pool || pool?.pool_name || pool?.pair);
      const xio = num(pool?.volume24hXio ?? pool?.volume24h);
      if (!pair || !(xio > 0) || !today) return null;
      return { pair, pool: pair, xio, timestamp: `${today}T12:00:00.000Z` };
    })
    .filter(Boolean);
}

export function incomePairBalance({
  pair = INCOME_ALL_PAIRS,
  positions = [],
  activity = [],
} = {}) {
  const names = isAllIncomePairs(pair) ? heldIncomePairs(positions) : [incomePairName(pair)];
  return names.reduce((sum, name) => {
    const existing =
      (Array.isArray(positions) ? positions : []).find(
        (row) => incomePairName(row?.pool || row?.pool_name || row?.pair) === name
      ) || {};
    const held = netHeldLp(name, activity, existing.lp_balance);
    return sum + preferPositive(num(existing.lp_balance), held.held, held.added);
  }, 0);
}


/** Underlying assets for an LP share or fee (XIO + quote). Users earn assets, not LP. */
export function poolShareAssets({
  lpBalance = 0,
  lpSupply = 0,
  lpSharePercent = 0,
  reserveXio = 0,
  reserveQuote = 0,
  withdrawXio = 0,
  withdrawQuote = 0,
  feeXio = 0,
  quoteAsset = "",
  pair = "",
} = {}) {
  const quoteLabel = String(quoteAsset || (String(pair || "").split("/")[1] || "")).trim();
  const supply = num(lpSupply);
  const lp = num(lpBalance);
  let share =
    supply > 0 && lp > 0
      ? lp / supply
      : Math.min(1, Math.max(0, num(lpSharePercent) / 100));
  const rx = num(reserveXio);
  const rq = num(reserveQuote);
  const fee = num(feeXio);
  let assetXio = num(withdrawXio);
  let assetQuote = num(withdrawQuote);
  if (fee > 0) {
    // Match feeIncomeUsd half/half attribution for XRP-style pairs.
    const half = fee / 2;
    assetXio = half;
    assetQuote = rx > 0 ? half * (rq / rx) : 0;
  } else {
    if (!(assetXio > 0) && share > 0 && rx > 0) assetXio = share * rx;
    if (!(assetQuote > 0) && share > 0 && rq > 0) assetQuote = share * rq;
  }
  return {
    assetXio: assetXio > 0 ? assetXio : 0,
    assetQuote: assetQuote > 0 ? assetQuote : 0,
    quoteAsset: quoteLabel,
  };
}

export function incomeHeldPoolRows({
  positions = [],
  pools = [],
  prices,
  xioUsd = 0,
  xrpUsd = 0,
  rlusdUsd = 1,
} = {}) {
  const book = priceBookFromArgs({ xioUsd, xrpUsd, rlusdUsd, prices });
  return heldIncomePairs(positions)
    .map((pair) => {
      const pool = poolForIncomePair(pair, positions, pools);
      const lp = num(pool.lp_balance);
      const assets = poolShareAssets({
        lpBalance: lp,
        lpSupply: pool.lp_supply,
        lpSharePercent: pool.lp_share_percent,
        reserveXio: pool.reserve_asset ?? pool.reserve_xio,
        reserveQuote: pool.reserve_currency ?? pool.reserve_quote,
        withdrawXio: pool.withdraw_estimate_xio,
        withdrawQuote: pool.withdraw_estimate_quote,
        quoteAsset: pool.quote || pool.quoteName,
        pair,
      });
      return {
        pair,
        date: "",
        lpBalance: lp,
        lpTokens: lp,
        ...assets,
        usd: lpTokenUsd(lp, pool, book),
        kind: "hold",
      };
    })
    .filter((row) => row.lpTokens > 0);
}

export function incomePairTotals({
  pair = INCOME_ALL_PAIRS,
  positions = [],
  pools = [],
  activity = [],
  prices,
  xioUsd = 0,
  xrpUsd = 0,
  rlusdUsd = 1,
} = {}) {
  const book = priceBookFromArgs({ xioUsd, xrpUsd, rlusdUsd, prices });
  if (isAllIncomePairs(pair)) {
    const rows = incomeHeldPoolRows({ positions, pools, prices, xioUsd, xrpUsd, rlusdUsd });
    return {
      lp: 0,
      usd: rows.reduce((sum, row) => sum + (Number(row.usd) || 0), 0),
      pools: rows.length,
    };
  }
  const lp = incomePairBalance({ pair, positions, activity });
  return {
    lp,
    usd: lpTokenUsd(lp, poolForIncomePair(pair, positions, pools), book),
    pools: lp > 0 ? 1 : 0,
  };
}

export function poolForIncomePair(pair, positions = [], pools = []) {
  const want = incomePairName(pair);
  const position =
    (Array.isArray(positions) ? positions : []).find(
      (row) => incomePairName(row?.pool || row?.pool_name || row?.pair) === want
    ) || {};
  const catalog =
    (Array.isArray(pools) ? pools : []).find(
      (row) => incomePairName(row?.pool || row?.pool_name || row?.pair) === want
    ) || {};
  const reserveXio = preferPositive(
    num(catalog.reserve_asset ?? catalog.reserve_xio),
    num(position.reserve_asset ?? position.reserve_xio)
  );
  const reserveQuote = preferPositive(
    num(catalog.reserve_currency ?? catalog.reserve_quote),
    num(position.reserve_currency ?? position.reserve_quote)
  );
  const supply = preferLargest(num(catalog.lp_supply), num(position.lp_supply));
  return {
    ...catalog,
    ...position,
    pair: want,
    pool: want,
    pool_name: want,
    quote: position.quote || catalog.quote || want.split("/")[1],
    lp_supply: supply,
    reserve_asset: reserveXio,
    reserve_xio: reserveXio,
    reserve_currency: reserveQuote,
    reserve_quote: reserveQuote,
  };
}

function quoteReserveForUsd(reserveQuote, supply) {
  const quote = num(reserveQuote);
  const lp = num(supply);
  if (!(quote > 0)) return 0;
  if (lp > 0 && Math.abs(quote - lp) / Math.max(quote, lp) < 0.05) return 0;
  return quote;
}

export function lpTokenUsd(lpTokens, pool = {}, prices = {}) {
  const tokens = num(lpTokens);
  const supply = num(pool.lp_supply);
  const reserveXio = num(pool.reserve_asset ?? pool.reserve_xio);
  const reserveQuote = quoteReserveForUsd(pool.reserve_currency ?? pool.reserve_quote, supply);
  if (!(tokens > 0) || !(supply > 0)) return 0;
  const book = normalizePriceBook(prices);
  const quoteId = pairQuote(pool.pool || pool.pool_name || pool.pair, pool.quote);
  const xioUsd = num(book.xioUsd ?? prices.xioUsd ?? prices.recorded_price);
  const quoteUsd =
    quoteId === "RLUSD"
      ? 1
      : detectQuoteUsd({
          quoteId,
          pool: { ...pool, xioUsd },
          prices: book,
          allowImplied: true,
        });
  let xioValue = reserveXio > 0 && xioUsd > 0 ? reserveXio * xioUsd : 0;
  let quoteValue = reserveQuote > 0 && quoteUsd > 0 ? reserveQuote * quoteUsd : 0;
  if (xioValue > 0 && !(quoteValue > 0)) quoteValue = xioValue;
  if (quoteValue > 0 && !(xioValue > 0)) xioValue = quoteValue;
  if (!(xioValue > 0) && !(quoteValue > 0)) return 0;
  return (tokens / supply) * (xioValue + quoteValue);
}

function feeIncomeUsd(feeXio, position, book) {
  const reserveXio = num(position?.reserve_asset ?? position?.reserve_xio);
  const reserveQuote = quoteReserveForUsd(
    position?.reserve_currency ?? position?.reserve_quote,
    position?.lp_supply
  );
  const quoteId = pairQuote(position?.pool || position?.pool_name || position?.pair, position?.quote);
  const xioUsd = num(book?.xioUsd ?? book?.recorded_price);
  const quoteUsd = detectQuoteUsd({
    quoteId,
    pool: { ...position, xioUsd },
    prices: book,
    allowImplied: true,
  });
  if (quoteId === "XRP" || quoteId === "RLUSD") {
    const halfXio = feeXio / 2;
    const px = reserveXio > 0 ? reserveQuote / reserveXio : 0;
    const quoteMark = quoteUsd || (quoteId === "RLUSD" ? 1 : 0);
    return halfXio * xioUsd + (px > 0 ? halfXio * px * quoteMark : 0);
  }
  return feeXio * xioUsd;
}

function lpEquivalent(feeXio, row) {
  const reserveXio = num(row?.reserve_asset ?? row?.reserve_xio);
  const supply = num(row?.lp_supply);
  if (!(reserveXio > 0) || !(supply > 0) || !(feeXio > 0)) return 0;
  return (feeXio / reserveXio) * supply;
}

export function earliestHeldDay(pair, activity = [], currentBalance = 0) {
  const want = normalizeWalletPair(pair);
  if (!want) return "";
  const events = (Array.isArray(activity) ? activity : []).filter((item) => {
    const named = normalizeWalletPair(item?.pair || item?.pool);
    if (!item || !named || named !== want) return false;
    return item.side === "addLp" || item.side === "createPool" || item.side === "removeLp";
  });
  if (!events.length) return "";
  let net = 0;
  let first = "";
  for (const item of events) {
    const day = utcDayKey(item.timestamp);
    const tokens = num(item.lp);
    if (item.side === "removeLp") net -= tokens;
    else {
      net += tokens;
      if (day && (!first || day < first)) first = day;
    }
  }
  if (!first) return "";
  const held = num(currentBalance);
  if (held > 0 && net > 0 && held <= net * 1.08) return first;
  return "";
}

function fillCatalogVolumeDays(buckets, positions = [], now = Date.now()) {
  const today = utcDayKey(now);
  if (!today) return buckets;
  for (const position of Array.isArray(positions) ? positions : []) {
    const pair = normalizeWalletPair(position.pool || position.pool_name || position.pair);
    if (!isXioAmmPair(pair)) continue;
    const vol24 = catalogXioVolume24h(position);
    const vol7 = catalogXioVolume7d(position);
    const todayKey = `${today}|${pair}`;
    const todayBucket = buckets.get(todayKey);
    if (vol24 > 0 && !(todayBucket?.xio > 0)) {
      buckets.set(todayKey, { date: today, pair, xio: vol24 });
    }
    if (!(vol7 > vol24)) continue;
    let accounted = todayBucket?.xio || (vol24 > 0 ? vol24 : 0);
    for (const bucket of buckets.values()) {
      if (bucket.pair !== pair || bucket.date === today) continue;
      const age = Date.parse(`${bucket.date}T00:00:00.000Z`);
      if (Number.isFinite(age) && now - age <= CATALOG_FILL_DAYS * DAY_MS) {
        accounted += bucket.xio;
      }
    }
    const leftover = Math.max(0, vol7 - accounted);
    const missing = [];
    for (let offset = 1; offset < CATALOG_FILL_DAYS; offset += 1) {
      const date = utcDayKey(now - offset * DAY_MS);
      if (!date) continue;
      const key = `${date}|${pair}`;
      if (!buckets.has(key)) missing.push({ date, key });
    }
    if (!missing.length || !(leftover > 0)) continue;
    const perDay = leftover / missing.length;
    for (const row of missing) {
      buckets.set(row.key, { date: row.date, pair, xio: perDay });
    }
  }
  return buckets;
}

function overlayVolumeDays(buckets, volumeDays = []) {
  for (const row of Array.isArray(volumeDays) ? volumeDays : []) {
    const day = utcDayKey(row.timestamp || row.date || row.day);
    const pair = normalizeWalletPair(row.pool || row.pool_name || row.pair);
    const xio = Math.abs(Number(row.xio) || 0);
    if (!day || !isXioAmmPair(pair) || !(xio > 0)) continue;
    const key = `${day}|${pair}`;
    const current = buckets.get(key);
    if (!current || xio > current.xio) buckets.set(key, { date: day, pair, xio });
  }
  return buckets;
}

function volumeOnDay(known, date) {
  if (!known.length) return 0;
  let prev = null;
  let next = null;
  for (const row of known) {
    if (row.date === date) return row.xio;
    if (row.date < date) prev = row;
    if (row.date > date && !next) next = row;
  }
  if (prev && next) {
    const start = Date.parse(`${prev.date}T00:00:00.000Z`);
    const end = Date.parse(`${next.date}T00:00:00.000Z`);
    const at = Date.parse(`${date}T00:00:00.000Z`);
    if (!(end > start) || !Number.isFinite(at)) return prev.xio;
    const weight = (at - start) / (end - start);
    return prev.xio * (1 - weight) + next.xio * weight;
  }
  return (next || prev)?.xio || 0;
}

export function priceBookOnDay(date, dailyPrices = {}, fallback = {}) {
  const book = priceBookFromArgs({
    prices: fallback,
    xioUsd: fallback.xioUsd,
    xrpUsd: fallback.xrpUsd,
    rlusdUsd: fallback.RLUSD ?? fallback.rlusdUsd,
  });
  const map = dailyPrices && typeof dailyPrices === "object" ? dailyPrices : {};
  const day = utcDayKey(date) || String(date || "");
  if (!day) return book;
  let picked = map[day];
  if (!picked) {
    const earlier = Object.keys(map)
      .filter((key) => key && key <= day)
      .sort();
    picked = map[earlier[earlier.length - 1]];
  }
  if (!picked) return book;
  return priceBookFromArgs({
    prices: { ...book, ...picked },
    xioUsd: picked.xioUsd,
    xrpUsd: picked.xrpUsd,
    rlusdUsd: picked.rlusdUsd ?? picked.RLUSD ?? book.RLUSD,
  });
}

export function fillContinuousVolumeDays(buckets, pair, fromDay, toDay) {
  const want = normalizeWalletPair(pair);
  const start = utcDayKey(fromDay);
  const end = utcDayKey(toDay);
  if (!want || !start || !end || start > end) return buckets;
  const known = [...buckets.values()]
    .filter((row) => row.pair === want && row.xio > 0)
    .sort((left, right) => (left.date < right.date ? -1 : 1));
  if (!known.length) return buckets;
  for (let ts = Date.parse(`${start}T00:00:00.000Z`); ts <= Date.parse(`${end}T00:00:00.000Z`); ts += DAY_MS) {
    const date = utcDayKey(ts);
    if (!date) continue;
    const key = `${date}|${want}`;
    if (buckets.get(key)?.xio > 0) continue;
    const xio = volumeOnDay(known, date);
    if (xio > 0) buckets.set(key, { date, pair: want, xio });
  }
  return buckets;
}

export function lpFeeIncomeRows({
  positions = [],
  flows = [],
  volumeDays = [],
  activity = [],
  xioUsd = 0,
  xrpUsd = 0,
  rlusdUsd = 1,
  prices,
  dailyPrices,
  now = Date.now(),
} = {}) {
  const held = (Array.isArray(positions) ? positions : [])
    .map((row) => {
      if (!isXioAmmPair(row)) return null;
      const supply = num(row.lp_supply);
      const balance = num(row.lp_balance);
      const share = num(row.lp_share_percent) || (supply > 0 && balance > 0 ? (balance / supply) * 100 : 0);
      if (!(share > 0)) return null;
      return {
        ...row,
        lp_share_percent: share,
        trading_fee: num(row.trading_fee) || 1000,
      };
    })
    .filter(Boolean);
  if (!held.length) return [];

  const oldest = utcDayKey(now - HISTORICAL_INCOME_DAYS * DAY_MS);
  const buckets = new Map();
  for (const flow of Array.isArray(flows) ? flows : []) {
    const day = utcDayKey(flow.timestamp);
    const pair = normalizeWalletPair(flow.pool || flow.pool_name || flow.pair);
    if (!day || !isXioAmmPair(pair) || (oldest && day < oldest)) continue;
    const key = `${day}|${pair}`;
    const current = buckets.get(key) || { date: day, pair, xio: 0 };
    current.xio += Math.abs(Number(flow.xio) || 0);
    buckets.set(key, current);
  }
  overlayVolumeDays(buckets, volumeDays);
  fillCatalogVolumeDays(buckets, held, now);
  const today = utcDayKey(now);
  const marketDays = [...buckets.values()].filter((row) => row.pair === DEFAULT_INCOME_PAIR && row.xio > 0);
  for (const position of held) {
    const pair = normalizeWalletPair(position.pool || position.pool_name);
    if (!pair || pair === DEFAULT_INCOME_PAIR) continue;
    const pairVol = catalogXioVolume24h(position);
    const projected = projectXioMarketDaysToPair(marketDays, pair, pairVol, now);
    if (projected.length) overlayVolumeDays(buckets, projected);
  }
  for (const position of held) {
    const pair = normalizeWalletPair(position.pool || position.pool_name);
    const heldFrom = earliestHeldDay(pair, activity, position.lp_balance);
    const known = [...buckets.values()]
      .filter((row) => row.pair === pair)
      .map((row) => row.date)
      .sort();
    const fromDay = heldFrom
      ? [oldest, heldFrom].filter(Boolean).sort().pop()
      : known[0];
    if (fromDay && today) fillContinuousVolumeDays(buckets, pair, fromDay, today);
  }

  const book = priceBookFromArgs({ xioUsd, xrpUsd, rlusdUsd, prices });
  const dayBooks =
    (dailyPrices && typeof dailyPrices === "object" && dailyPrices) ||
    (prices?.dailyPrices && typeof prices.dailyPrices === "object" ? prices.dailyPrices : {});
  const rows = [];
  for (const position of held) {
    const pair = normalizeWalletPair(position.pool || position.pool_name);
    const share = num(position.lp_share_percent) / 100;
    const rate = tradingFeeRate(position.trading_fee);
    const heldFrom = earliestHeldDay(pair, activity, position.lp_balance);
    for (const bucket of buckets.values()) {
      if (bucket.pair !== pair) continue;
      if (heldFrom && bucket.date < heldFrom) continue;
      if (oldest && bucket.date < oldest) continue;
      const feeXio = bucket.xio * rate * share;
      if (!(feeXio > 0)) continue;
      const lpTokens = lpEquivalent(feeXio, position);
      const assets = poolShareAssets({
        feeXio,
        reserveXio: position.reserve_asset ?? position.reserve_xio,
        reserveQuote: position.reserve_currency ?? position.reserve_quote,
        quoteAsset: position.quote || position.quoteName,
        pair,
      });
      rows.push({
        date: bucket.date,
        lpTokens,
        pair,
        ...assets,
        usd: feeIncomeUsd(feeXio, position, priceBookOnDay(bucket.date, dayBooks, book)),
        kind: "fee",
      });
    }
  }
  return dailyLpIncomeTotals(rows);
}

export function lpDepositIncomeRows({
  activity = [],
  positions = [],
  pools = [],
  xioUsd = 0,
  xrpUsd = 0,
  rlusdUsd = 1,
  prices,
} = {}) {
  const book = priceBookFromArgs({ xioUsd, xrpUsd, rlusdUsd, prices });
  const dayBooks =
    (prices?.dailyPrices && typeof prices.dailyPrices === "object" && prices.dailyPrices) || {};
  const rows = [];
  for (const item of Array.isArray(activity) ? activity : []) {
    if (item?.side !== "addLp" && item?.side !== "createPool") continue;
    const date = utcDayKey(item.timestamp);
    const pair = normalizeWalletPair(item.pair || item.pool);
    const lpTokens = num(item.lp);
    if (!date || !isXioAmmPair(pair) || !(lpTokens > 0)) continue;
    const pool = poolForIncomePair(pair, positions, pools);
    rows.push({
      date,
      lpTokens,
      pair,
      usd: lpTokenUsd(lpTokens, pool, priceBookOnDay(date, dayBooks, book)),
      kind: item.side === "createPool" ? "create" : "deposit",
      txid: item.txid || null,
    });
  }
  return rows;
}

function creditEventKey(row) {
  if (row?.txid) return `tx:${row.txid}`;
  return `${utcDayKey(row?.date) || row?.date}|${incomePairName(row?.pair)}|${Number(row?.lpTokens || 0).toFixed(8)}`;
}

export function dailyCreditTotals(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = utcDayKey(row?.date) || String(row?.date || "");
    const pair = incomePairName(row?.pair);
    if (!date || !isXioAmmPair(pair)) continue;
    if (row.kind === "fee" || row.kind === "hold") continue;
    if (row.kind && !isCreditKind(row.kind)) continue;
    const tokens = num(row.lpTokens ?? row.lpEarned);
    if (!(tokens > 0)) continue;
    const key = `${date}|${pair}`;
    const current = map.get(key) || { date, pair, lpTokens: 0, usd: 0, kind: "credit" };
    current.lpTokens += tokens;
    current.usd += Number(row.usd) || 0;
    map.set(key, current);
  }
  return mergeLpIncomeRows([...map.values()]).map((row) => ({
    ...row,
    lpEarned: row.lpTokens,
    kind: "credit",
  }));
}

function findFrozenCreditKey(map, row) {
  if (row.txid && map.has(`tx:${row.txid}`)) return `tx:${row.txid}`;
  const amountKey = `${row.date}|${row.pair}|${Number(row.lpTokens).toFixed(6)}`;
  if (map.has(amountKey)) return amountKey;
  for (const [key, value] of map) {
    if (value.date === row.date && value.pair === row.pair && Math.abs(value.lpTokens - row.lpTokens) < 1e-6) {
      return key;
    }
  }
  return "";
}

export function mergeFrozenCredits(...lists) {
  const map = new Map();
  for (const row of lists.flat()) {
    if (!row || row.kind === "fee" || row.kind === "hold") continue;
    const date = utcDayKey(row.date) || String(row.date || "");
    const pair = incomePairName(row.pair);
    const tokens = num(row.lpTokens ?? row.lpEarned);
    if (!date || !isXioAmmPair(pair) || !(tokens > 0)) continue;
    const next = {
      date,
      pair,
      lpTokens: tokens,
      usd: Number(row.usd) || 0,
      kind: CREDIT_KINDS.has(row.kind) ? row.kind : "deposit",
      txid: row.txid || null,
    };
    const found = findFrozenCreditKey(map, next);
    const key = next.txid ? `tx:${next.txid}` : creditEventKey(next);
    if (found) {
      const current = map.get(found);
      map.delete(found);
      map.set(key, {
        ...current,
        ...next,
        lpTokens: Math.max(current.lpTokens, next.lpTokens),
        usd: current.usd > 0 ? current.usd : next.usd,
        txid: current.txid || next.txid,
      });
      continue;
    }
    map.set(key, next);
  }
  return [...map.values()];
}

export function mergeLpIncomeRows(...lists) {
  const rows = lists.flat().filter((row) => row?.date && row?.pair);
  return rows.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    if (left.pair !== right.pair) return left.pair.localeCompare(right.pair);
    if ((left.txid || "") !== (right.txid || "")) return String(right.txid || "").localeCompare(String(left.txid || ""));
    return String(left.kind || "").localeCompare(String(right.kind || ""));
  });
}

export function dailyLpIncomeTotals(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = utcDayKey(row?.date) || String(row?.date || "");
    const pair = incomePairName(row?.pair);
    if (!date || !isXioAmmPair(pair)) continue;
    if (row.kind && row.kind !== "fee") continue;
    const key = `${date}|${pair}`;
    const current = map.get(key) || {
      date,
      pair,
      lpTokens: 0,
      usd: 0,
      assetXio: 0,
      assetQuote: 0,
      quoteAsset: row.quoteAsset || pair.split("/")[1] || "",
      kind: "fee",
    };
    current.lpTokens += num(row.lpTokens);
    current.usd += Number(row.usd) || 0;
    current.assetXio += num(row.assetXio);
    current.assetQuote += num(row.assetQuote);
    if (row.quoteAsset) current.quoteAsset = row.quoteAsset;
    map.set(key, current);
  }
  return mergeLpIncomeRows([...map.values()]);
}

export function recordedIncomeKey(address) {
  return `${LP_INCOME_STORE_PREFIX}${String(address || "").trim()}`;
}

export function readRecordedLpIncome(address, storage = globalThis.localStorage) {
  const name = String(address || "").trim();
  if (!name || !storage?.getItem) return [];
  try {
    const parsed = JSON.parse(storage.getItem(recordedIncomeKey(name)) || "[]");
    return mergeFrozenFees(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function writeRecordedLpIncome(address, rows, storage = globalThis.localStorage) {
  const name = String(address || "").trim();
  if (!name || !storage?.setItem) return [];
  const next = mergeFrozenFees(rows).slice(0, 400);
  try {
    storage.setItem(recordedIncomeKey(name), JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  return next;
}

export function mergeFrozenFees(...lists) {
  const map = new Map();
  for (const row of lists.flat()) {
    if (!row || (row.kind && row.kind !== "fee")) continue;
    const date = utcDayKey(row.date) || String(row.date || "");
    const pair = incomePairName(row.pair);
    const tokens = num(row.lpTokens ?? row.lpEarned);
    if (!date || !isXioAmmPair(pair) || !(tokens > 0)) continue;
    const key = `${date}|${pair}`;
    const current = map.get(key);
    if (current) continue;
    map.set(key, {
      date,
      pair,
      lpTokens: tokens,
      lpEarned: tokens,
      usd: Number(row.usd) || 0,
      assetXio: num(row.assetXio),
      assetQuote: num(row.assetQuote),
      quoteAsset: row.quoteAsset || pair.split("/")[1] || "",
      kind: "fee",
    });
  }
  return mergeLpIncomeRows([...map.values()]).map((row) => ({
    ...row,
    lpEarned: row.lpTokens,
    kind: "fee",
  }));
}

export function mergeRecordedLpIncome(...lists) {
  return mergeFrozenFees(...lists);
}

export function incomeRowsForPair({
  pair = INCOME_ALL_PAIRS,
  snapshotRows = [],
  historyActivity = null,
  historyDays = [],
  recordedRows = [],
  positions = [],
  pools = [],
  prices,
  xioUsd = 0,
  xrpUsd = 0,
  rlusdUsd = 1,
  now = Date.now(),
} = {}) {
  if (isAllIncomePairs(pair)) {
    return incomeHeldPoolRows({
      positions,
      pools,
      prices,
      xioUsd,
      xrpUsd,
      rlusdUsd,
    });
  }
  const want = incomePairName(pair);
  const held = new Set(heldIncomePairs(positions));
  if (!held.has(want)) return [];
  const activity = remapIncomeActivity(historyActivity, positions, pools);
  const position = incomePositionForPair(want, positions, pools, activity);
  const marketDays = Array.isArray(prices?.xioVolumeDays) ? prices.xioVolumeDays : [];
  const projected =
    want === DEFAULT_INCOME_PAIR
      ? filterIncomeByPair(marketDays, DEFAULT_INCOME_PAIR)
      : projectXioMarketDaysToPair(marketDays, want, catalogXioVolume24h(position || {}), now);
  const rebuilt = lpFeeIncomeRows({
    positions: position ? [position] : [],
    flows: [],
    volumeDays: [
      ...filterIncomeByPair(historyDays, want),
      ...volumeDaysFromPools(position ? [position] : [], now),
      ...projected,
    ],
    activity,
    xioUsd,
    xrpUsd,
    rlusdUsd,
    prices,
    dailyPrices: prices?.dailyPrices,
    now,
  });
  return mergeFrozenFees(
    filterIncomeByPair(
      (Array.isArray(recordedRows) ? recordedRows : []).filter((row) => !row.kind || row.kind === "fee"),
      want
    ),
    rebuilt,
    filterIncomeByPair(
      (Array.isArray(snapshotRows) ? snapshotRows : []).filter((row) => !row.kind || row.kind === "fee"),
      want
    )
  ).filter((row) => row.pair === want && num(row.lpTokens) > 0);
}

export function incomeDayKeys(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((row) => row.date).filter(Boolean))];
}

export function pageLpIncome(rows = [], daysShown = INCOME_PAGE_DAYS) {
  const days = incomeDayKeys(rows).slice(0, Math.max(0, Number(daysShown) || 0));
  const keep = new Set(days);
  return (Array.isArray(rows) ? rows : []).filter((row) => keep.has(row.date));
}

export function lpIncomeCsv(rows = []) {
  const holds = (Array.isArray(rows) ? rows : []).every((row) => row?.kind === "hold");
  const lines = holds
    ? ["Pair,XIO,Quote,Quote amount,USD"]
    : ["Date,XIO,Quote,Quote amount,USD,Trading pair"];
  for (const row of Array.isArray(rows) ? rows : []) {
    const quote = row.quoteAsset || "";
    lines.push(
      (holds
        ? [row.pair, row.assetXio ?? "", quote, row.assetQuote ?? "", row.usd]
        : [row.date, row.assetXio ?? "", quote, row.assetQuote ?? "", row.usd, row.pair])
        .map((value) => {
          const text = value == null ? "" : String(value);
          return text.includes(",") ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

export function downloadTextFile(filename, text, type = "text/csv") {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
