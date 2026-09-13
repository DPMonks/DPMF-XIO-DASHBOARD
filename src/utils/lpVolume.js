import {RLUSD_HEX, XIO_HEX, XDX_HEX, XDX_ISSUER} from "../constants/ledger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Token 24h XIO volume is millions. A raw card number under this is XRP or USD, not XIO.
const XIO_VOLUME_FLOOR = 10_000;

function numPos(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function hexCurrencyLabel(hex) {
  const clean = String(hex || "").replace(/0+$/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = Number.parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isFinite(code) || code < 32 || code > 126) continue;
    out += String.fromCharCode(code);
  }
  return out || "";
}

export function tickerFromCurrency(leg = {}) {
  const currency = String(leg.currency || leg.ticker || "").trim();
  const upper = currency.toUpperCase();
  if (!upper || upper === "XRP") return "XRP";
  if (upper === "XIO" || upper === XIO_HEX) return "XIO";
  if (upper === "RLUSD" || upper === RLUSD_HEX) return "RLUSD";
  if (upper === "XIO" || upper === XDX_HEX || leg.issuer === XDX_ISSUER) return "XIO";
  if (/^[A-Z0-9]{3}$/.test(upper)) return upper;
  if (/^[A-F0-9]{40}$/i.test(currency)) {
    const label = hexCurrencyLabel(currency);
    return label ? label.toUpperCase() : "IOU";
  }
  return upper.slice(0, 12);
}

export function pairFromTradeLegs(paid = {}, got = {}) {
  const sold = tickerFromCurrency(paid);
  const bought = tickerFromCurrency(got);
  if (sold === "XIO" && bought !== "XIO") return `XIO/${bought}`;
  if (bought === "XIO" && sold !== "XIO") return `XIO/${sold}`;
  return "";
}

export function xrpPerXioFrom(row = {}, fallback) {
  const reserveXio = numPos(row.reserve_asset ?? row.reserve_xio);
  const reserveQuote = numPos(row.reserve_currency ?? row.reserve_quote);
  const quote = String(row.quote || "").toUpperCase();
  if (reserveXio > 0 && reserveQuote > 0 && (!quote || quote === "XRP")) {
    return reserveQuote / reserveXio;
  }
  return numPos(fallback ?? row.xioPerXrp ?? row.xio_per_xrp ?? row.exchXrp);
}

export function xioFromXrpVolume(xrpVolume, xrpPerXio) {
  const vol = numPos(xrpVolume);
  const px = numPos(xrpPerXio);
  return vol && px ? vol / px : 0;
}

export function xioFromUsdVolume(usdVolume, xioUsd) {
  const vol = numPos(usdVolume);
  const px = numPos(xioUsd);
  return vol && px ? vol / px : 0;
}

export function looksLikeXioVolume(value) {
  return numPos(value) >= XIO_VOLUME_FLOOR;
}

export function looksLikeUsdOrXrpVolume(value) {
  const n = numPos(value);
  return n > 0 && n < XIO_VOLUME_FLOOR;
}

export function xioVolumeFromTokenCard(token = {}, xrpPerXio) {
  const px = numPos(xrpPerXio) || numPos(token.exchXrp);
  return xioFromXrpVolume(token.vol24hXrp, px);
}

export function xrpVolumeFromOhlc(rows = [], { now = Date.now(), windowMs = DAY_MS } = {}) {
  const cutoff = now - Number(windowMs || DAY_MS);
  let sum = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = Number(Array.isArray(row) ? row[0] : row?.time ?? row?.timestamp);
    const vol = Number(Array.isArray(row) ? row[5] : row?.volume ?? row?.vol);
    const ts = time > 1e12 ? time : time * 1000;
    if (!Number.isFinite(ts) || ts < cutoff || !(vol > 0)) continue;
    sum += vol;
  }
  return sum;
}

export function dailyPricesFromOhlc(rows = [], { xrpUsd, now = Date.now(), maxDays = 365 } = {}) {
  const cutoff = Number(now) - Math.max(1, Number(maxDays) || 365) * DAY_MS;
  const byDay = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = Number(Array.isArray(row) ? row[0] : Date.parse(row?.timestamp || row?.time || row?.day || 0));
    const close = Number(Array.isArray(row) ? row[4] : row?.close ?? row?.price ?? row?.xioUsd);
    const ts = time > 1e12 ? time : time * 1000;
    if (!Number.isFinite(ts) || ts < cutoff || !(close > 0)) continue;
    const day = new Date(ts).toISOString().slice(0, 10);
    byDay[day] = { xioUsd: close, xrpUsd: numPos(xrpUsd) || numPos(byDay[day]?.xrpUsd) || 0 };
  }
  return byDay;
}

export function dailyXioFlowsFromOhlc(
  rows = [],
  { xrpPerXio, pair = "XIO/XRP", now = Date.now(), maxDays = 365 } = {}
) {
  const px = numPos(xrpPerXio);
  const cutoff = Number(now) - Math.max(1, Number(maxDays) || 365) * DAY_MS;
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = Number(Array.isArray(row) ? row[0] : Date.parse(row?.timestamp || row?.time || row?.day || 0));
    const vol = Number(Array.isArray(row) ? row[5] : row?.volume ?? row?.vol);
    const ts = time > 1e12 ? time : time * 1000;
    if (!Number.isFinite(ts) || ts < cutoff || !(vol > 0)) continue;
    const xio = xioFromXrpVolume(vol, px);
    if (!(xio > 0)) continue;
    const timestamp = new Date(ts).toISOString();
    const day = timestamp.slice(0, 10);
    const current = byDay.get(day);
    if (!current || xio > current.xio) {
      byDay.set(day, { timestamp, pool: pair, pair, xio, source: "ohlc" });
    }
  }
  return [...byDay.values()].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function utcDayFromVolume(row = {}) {
  const raw = row.timestamp || row.date || row.day;
  if (!raw) return "";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return String(raw).slice(0, 10);
  return new Date(ts).toISOString().slice(0, 10);
}

export function projectXioMarketDaysToPair(marketDays = [], pair, pairXio24h, now = Date.now()) {
  const want = String(pair || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const pairVol = numPos(pairXio24h);
  if (!want || want === "XIO/XRP" || !(pairVol > 0)) return [];
  const today = new Date(Number(now)).toISOString().slice(0, 10);
  const days = (Array.isArray(marketDays) ? marketDays : [])
    .map((row) => ({
      date: utcDayFromVolume(row),
      xio: numPos(row.xio),
      timestamp: row.timestamp || `${utcDayFromVolume(row)}T12:00:00.000Z`,
    }))
    .filter((row) => row.date && row.xio > 0);
  if (!days.length) return [];
  const todayMarket =
    days.find((row) => row.date === today)?.xio ||
    days.slice().sort((left, right) => (left.date < right.date ? 1 : -1))[0]?.xio ||
    0;
  if (!(todayMarket > 0)) return [];
  return days.map((row) => ({
    timestamp: row.timestamp,
    date: row.date,
    pool: want,
    pair: want,
    xio: pairVol * (row.xio / todayMarket),
    source: "xio-projected",
  }));
}

export function volumeDaysForHeldPairs(marketDays = [], positions = [], now = Date.now()) {
  const market = (Array.isArray(marketDays) ? marketDays : []).map((row) => ({
    ...row,
    pair: row.pair || row.pool || "XIO/XRP",
    pool: row.pool || row.pair || "XIO/XRP",
  }));
  const extra = [];
  for (const position of Array.isArray(positions) ? positions : []) {
    const pair = String(position?.pool || position?.pool_name || position?.pair || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!pair || pair === "XIO/XRP") continue;
    extra.push(...projectXioMarketDaysToPair(market, pair, catalogXioVolume24h(position), now));
  }
  return [...market, ...extra];
}

export function xioVolumeFromDexscreenerPair(pair = {}, xioUsd) {
  const usd = numPos(pair?.volume?.h24 ?? pair?.volume24h);
  const price = numPos(pair?.priceUsd) || numPos(xioUsd);
  return xioFromUsdVolume(usd, price);
}

export function xioVolumeFromGeckoPool(pool = {}, xioUsd) {
  const attrs = pool?.attributes && typeof pool.attributes === "object" ? pool.attributes : pool;
  const usd = numPos(attrs?.volume_usd?.h24 ?? attrs?.volume24h);
  const price = numPos(attrs?.base_token_price_usd) || numPos(xioUsd);
  return xioFromUsdVolume(usd, price);
}

/**
 * 24h XIO volume on a pool/catalog row.
 * volume24h must stay XIO for lpFeeEarnings. USD (volXrp * XRPUSD) and raw XRP
 * card numbers are converted, never used as XIO.
 */
export function catalogXioVolume24h(row = {}) {
  const tagged = numPos(row.volume24hXio ?? row.volume_24h_xio);
  if (tagged) return tagged;

  const xrpVol = numPos(row.volume24hXrp ?? row.volume_24h_xrp);
  const xrpPer = numPos(row.xioPerXrp ?? row.xio_per_xrp ?? row.exchXrp) || xrpPerXioFrom(row);
  if (xrpVol && xrpPer) return xioFromXrpVolume(xrpVol, xrpPer);

  const usdVol = numPos(row.volume24hUsd ?? row.volume_24h_usd);
  const xioUsd = numPos(row.xioUsd);
  if (usdVol && xioUsd) return xioFromUsdVolume(usdVol, xioUsd);

  const raw = numPos(row.volume24h ?? row.volume_24h);
  if (!raw) return 0;
  const unit = String(row.volumeUnit || "").toLowerCase();
  if (unit === "usd" && xioUsd) return xioFromUsdVolume(raw, xioUsd);
  if (unit === "xrp" && xrpPer) return xioFromXrpVolume(raw, xrpPer);
  const xrpUsd = numPos(row.xrpUsd);
  if (xrpVol && xrpUsd) {
    const asUsd = xrpVol * xrpUsd;
    if (asUsd > 0 && Math.abs(raw - asUsd) / asUsd < 0.08) {
      return xrpPer ? xioFromXrpVolume(xrpVol, xrpPer) : 0;
    }
  }
  if (looksLikeXioVolume(raw) || (!xrpVol && !usdVol && unit !== "usd" && unit !== "xrp")) {
    return raw;
  }
  return 0;
}

export function catalogXioVolume7d(row = {}) {
  return numPos(row.volume7dXio ?? row.volume_7d_xio ?? row.volume7d ?? row.volume_7d);
}

/**
 * Complete pair-level sources beat a 200-trade tape even when the tape is smaller.
 * Among complete sources, take the largest so we do not understate AMM flow.
 */
export function pickBestXioVolume(candidates = []) {
  const usable = (Array.isArray(candidates) ? candidates : [])
    .map((row) => ({
      value: numPos(row?.value),
      complete: row?.complete !== false,
      source: row?.source || "unknown",
    }))
    .filter((row) => row.value > 0);
  if (!usable.length) return { value: 0, source: "empty", complete: false };
  const complete = usable.filter((row) => row.complete);
  const pool = complete.length ? complete : usable;
  let best = pool[0];
  for (const row of pool) {
    if (row.value > best.value) best = row;
  }
  return best;
}

export function volumeCoverage({ rows = [], now = Date.now(), windowMs = DAY_MS, cap = 200 } = {}) {
  const cutoff = now - Number(windowMs || DAY_MS);
  const times = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const ts = new Date(row.timestamp || row.time).getTime();
    if (Number.isFinite(ts)) times.push(ts);
  }
  times.sort((a, b) => a - b);
  if (!times.length) return { complete: false, count: 0, capped: false, oldest: null };
  const inWindow = times.filter((ts) => ts >= cutoff);
  const oldest = times[0];
  const capped = times.length >= cap;
  // A capped tape still covers the window when the oldest row is older than the cutoff.
  return {
    complete: inWindow.length > 0 && oldest < cutoff,
    count: inWindow.length,
    capped,
    oldest,
  };
}

/**
 * XIO/XRP pool volume. The xrpl.to token card is token-wide (every XIO pair),
 * so pair APIs and a window-covering tape beat it for this AMM.
 */
export function pickXrpPoolXioVolume({
  tokenXio = 0,
  ohlcXio = 0,
  dexXio = 0,
  geckoXio = 0,
  histXio = 0,
  histComplete = false,
} = {}) {
  const pair = pickBestXioVolume([
    { value: dexXio, complete: true, source: "dexscreener" },
    { value: geckoXio, complete: true, source: "geckoterminal" },
    { value: histXio, complete: histComplete, source: "xrpl.to-history" },
  ]);
  if (pair.value > 0 && (pair.source !== "xrpl.to-history" || histComplete)) {
    return pair;
  }
  return pickBestXioVolume([
    { value: tokenXio, complete: true, source: "xrpl.to-token" },
    { value: ohlcXio, complete: true, source: "xrpl.to-ohlc" },
    pair,
  ]);
}

export function sumFlowXio(rows = [], { now = Date.now(), windowMs = DAY_MS, pair } = {}) {
  const cutoff = now - Number(windowMs || DAY_MS);
  const want = String(pair || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "/");
  let sum = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const ts = new Date(row.timestamp || row.time).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    if (want) {
      const name = String(row.pool || row.pool_name || row.pair || "")
        .trim()
        .toUpperCase()
        .replace(/-/g, "/");
      if (name !== want) continue;
    }
    sum += Math.abs(Number(row.xio) || 0);
  }
  return sum;
}

export function xioPairKey(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "/");
  if (!raw) return "";
  if (raw.startsWith("XIO/")) return raw;
  if (/^[A-Z0-9]{2,12}$/.test(raw)) return `XIO/${raw}`;
  return raw;
}

export function volumesFromFlows(flows = [], { now = Date.now(), windowMs = DAY_MS } = {}) {
  const cutoff = now - Number(windowMs || DAY_MS);
  const byPair = {};
  for (const row of Array.isArray(flows) ? flows : []) {
    const ts = new Date(row.timestamp || row.time).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const pair = xioPairKey(row.pool || row.pool_name || row.pair);
    if (!/^XIO\/[A-Z0-9$]{2,24}$/.test(pair)) continue;
    byPair[pair] = (byPair[pair] || 0) + Math.abs(Number(row.xio) || 0);
  }
  return byPair;
}

export function overlayPoolFlowVolumes(pools = [], flows = [], now = Date.now()) {
  const byPair = volumesFromFlows(flows, { now });
  return (Array.isArray(pools) ? pools : []).map((pool) => {
    const pair = xioPairKey(pool.pool || pool.pool_name || pool.pair);
    const fromFlow = byPair[pair] || 0;
    const current = Number(pool.volume24h ?? pool.volume24hXio);
    const next = Number.isFinite(current) && current > 0 ? Math.max(current, fromFlow) : fromFlow;
    return {
      ...pool,
      volume24h: next,
      volume24hXio: next,
      volumeUnit: "xio",
      volumeSource: fromFlow > 0 && !(current > fromFlow) ? "xio-flows" : pool.volumeSource || "recorded",
    };
  });
}

export function attachPoolVolumes(pool = {}, volumes = {}) {
  const incoming = Number(volumes.volume24hXio);
  const existing = numPos(pool.volume24hXio) || numPos(pool.volume24h);
  const volume24hXio = incoming > 0 ? incoming : existing || (Number.isFinite(incoming) && incoming >= 0 ? incoming : 0);
  const volume7dXio = numPos(volumes.volume7dXio);
  const volume24hXrp = numPos(volumes.volume24hXrp);
  const volume24hUsd = numPos(volumes.volume24hUsd);
  const recorded = Number.isFinite(volume24hXio) ? volume24hXio : 0;
  return {
    ...pool,
    volume24h: recorded,
    volume24hXio: recorded,
    volume24hXrp: volume24hXrp || null,
    volume24hUsd: volume24hUsd || null,
    volume7d: volume7dXio || null,
    volume7dXio: volume7dXio || null,
    volumeUnit: "xio",
    volumeSource: volumes.source || pool.volumeSource || "recorded",
  };
}

export function preferRailwayXioVolume(dbRow = {}, liveRow = {}) {
  const dbXio = catalogXioVolume24h(dbRow);
  const liveXio = catalogXioVolume24h(liveRow);
  const db7d = catalogXioVolume7d(dbRow);
  const live7d = catalogXioVolume7d(liveRow);
  const dbTagged = numPos(dbRow.volume24hXio ?? dbRow.volume_24h_xio);
  const dbUsable = dbTagged || (looksLikeXioVolume(dbXio) ? dbXio : 0);
  if (dbUsable && dbUsable >= liveXio) {
    return {
      volume24h: dbUsable,
      volume24hXio: dbUsable,
      volume24hXrp: numPos(dbRow.volume24hXrp) || numPos(liveRow.volume24hXrp) || null,
      volume24hUsd: numPos(dbRow.volume24hUsd) || numPos(liveRow.volume24hUsd) || null,
      volume7d: db7d || live7d || null,
      volume7dXio: db7d || live7d || null,
      volumeUnit: "xio",
      volumeSource: dbRow.volumeSource || "db",
    };
  }
  if (liveXio) {
    return {
      volume24h: liveXio,
      volume24hXio: numPos(liveRow.volume24hXio) || liveXio,
      volume24hXrp: numPos(liveRow.volume24hXrp) || null,
      volume24hUsd: numPos(liveRow.volume24hUsd) || null,
      volume7d: live7d || null,
      volume7dXio: live7d || null,
      volumeUnit: "xio",
      volumeSource: liveRow.volumeSource || "xrpl.to",
    };
  }
  return {};
}
