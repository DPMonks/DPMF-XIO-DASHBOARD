import {XIO_XRPL_TO_MD5} from "../src/constants/ledger.js";
import {attachPoolVolumes, pickBestXioVolume, pickXrpPoolXioVolume, sumFlowXio, volumeCoverage, xioFromXrpVolume, xioPairKey, xioVolumeFromDexscreenerPair, xioVolumeFromGeckoPool, xioVolumeFromTokenCard, xrpVolumeFromOhlc} from "../src/utils/lpVolume.js";
import {FREE_API_HEADERS, loadXrplToFlows} from "./xrplToCatalog.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VOLUME_MS = 45_000;

let volumeCache = { at: 0, byPair: null };

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function jsonFetch(url, options = {}) {
  const res = await (options.fetchImpl || fetch)(url, {
    headers: { ...FREE_API_HEADERS, ...(options.headers || {}) },
    signal: AbortSignal.timeout(Number(options.timeoutMs) || 5000),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export async function loadDexscreenerSearch(query = "XIO", options = {}) {
  return jsonFetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
    options
  );
}

export async function loadGeckoXrplPools(query = "XIO", options = {}) {
  return jsonFetch(
    `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(query)}&network=xrpl`,
    options
  );
}

export async function loadOhlcRaw(md5 = XIO_XRPL_TO_MD5, options = {}) {
  const range = options.range || "7D";
  const interval = options.interval || "1h";
  return jsonFetch(
    `https://api.xrpl.to/v1/ohlc/${md5}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&vs_currency=USD`,
    { ...options, timeoutMs: 6000 }
  );
}

function isXrplPair(pair) {
  const chain = String(pair?.chainId || pair?.chain || "").toLowerCase();
  return !chain || chain === "xrpl";
}

function pairHasXio(pair) {
  const base = String(pair?.baseToken?.symbol || "").toUpperCase();
  const quote = String(pair?.quoteToken?.symbol || "").toUpperCase();
  return base === "XIO" || quote === "XIO";
}

export function dexscreenerPairForQuote(payload = {}, quote) {
  const want = String(quote || "").toUpperCase();
  const rows = Array.isArray(payload?.pairs) ? payload.pairs : [];
  return (
    rows.find((row) => {
      if (!isXrplPair(row) || !pairHasXio(row)) return false;
      if (!want) return true;
      const base = String(row.baseToken?.symbol || "").toUpperCase();
      const q = String(row.quoteToken?.symbol || "").toUpperCase();
      return q === want || base === want;
    }) || null
  );
}

export function geckoPoolForQuote(payload = {}, quote) {
  const want = String(quote || "").toUpperCase();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return (
    rows.find((row) => {
      const name = String(row?.attributes?.name || row?.name || "").toUpperCase();
      if (!name.includes("XIO")) return false;
      return want ? name.includes(want) : true;
    }) || null
  );
}

function xrpPerXioFromSources({ token, reserveXio, reserveXrp, xioUsd, xrpUsd } = {}) {
  return (
    num(token?.exchXrp) ||
    (num(reserveXio) && num(reserveXrp) ? reserveXrp / reserveXio : 0) ||
    (num(xioUsd) && num(xrpUsd) ? xioUsd / xrpUsd : 0)
  );
}

export async function loadPoolXioVolumes(args = {}) {
  const now = Number(args.now) || Date.now();
  if (!args.fresh && volumeCache.byPair && now - volumeCache.at < VOLUME_MS) {
    return volumeCache.byPair;
  }
  const xrpPerXio = xrpPerXioFromSources(args);
  const xioUsd = num(args.xioUsd);
  const options = { fetchImpl: args.fetchImpl, now };

  const [ohlc, dex, dexRlusdSearch, gecko, geckoRlusdSearch, flows] = await Promise.all([
    loadOhlcRaw(XIO_XRPL_TO_MD5, { ...options, range: "7D", interval: "1h" }).catch(() => ({ ohlc: [] })),
    loadDexscreenerSearch("XIO", options).catch(() => ({ pairs: [] })),
    loadDexscreenerSearch("XIO RLUSD", options).catch(() => ({ pairs: [] })),
    loadGeckoXrplPools("XIO", options).catch(() => ({ data: [] })),
    loadGeckoXrplPools("XIO RLUSD", options).catch(() => ({ data: [] })),
    Array.isArray(args.flows) ? Promise.resolve(args.flows) : loadXrplToFlows(options).catch(() => []),
  ]);

  const ohlcRows = Array.isArray(ohlc?.ohlc) ? ohlc.ohlc : [];
  const ohlc24Xrp = xrpVolumeFromOhlc(ohlcRows, { now, windowMs: DAY_MS });
  const ohlc7Xrp = xrpVolumeFromOhlc(ohlcRows, { now, windowMs: DAY_MS * 7 });
  const tokenXio = xioVolumeFromTokenCard(args.token, xrpPerXio);
  const ohlc24Xio = xioFromXrpVolume(ohlc24Xrp, xrpPerXio);
  const ohlc7Xio = xioFromXrpVolume(ohlc7Xrp, xrpPerXio);

  const dexXrp = dexscreenerPairForQuote(dex, "XRP");
  const dexRlusd = dexscreenerPairForQuote(dex, "RLUSD") || dexscreenerPairForQuote(dexRlusdSearch, "RLUSD");
  const geckoXrp = geckoPoolForQuote(gecko, "XRP");
  const geckoRlusd = geckoPoolForQuote(gecko, "RLUSD") || geckoPoolForQuote(geckoRlusdSearch, "RLUSD");

  const xrpHist = sumFlowXio(flows, { now, windowMs: DAY_MS, pair: "XIO/XRP" });
  const xrpHist7 = sumFlowXio(flows, { now, windowMs: DAY_MS * 7, pair: "XIO/XRP" });
  const rlusdHist = sumFlowXio(flows, { now, windowMs: DAY_MS, pair: "XIO/RLUSD" });
  const rlusdHist7 = sumFlowXio(flows, { now, windowMs: DAY_MS * 7, pair: "XIO/RLUSD" });
  const tape24 = volumeCoverage({ rows: flows, now, windowMs: DAY_MS });
  const tape7 = volumeCoverage({ rows: flows, now, windowMs: DAY_MS * 7 });
  const xrpCover = tape24;
  const xrpCover7 = tape7;
  const rlusdCover = tape24;
  const rlusdCover7 = tape7;

  const xrp24 = pickXrpPoolXioVolume({
    tokenXio,
    ohlcXio: ohlc24Xio,
    dexXio: xioVolumeFromDexscreenerPair(dexXrp, xioUsd || num(dexXrp?.priceUsd)),
    geckoXio: xioVolumeFromGeckoPool(geckoXrp, xioUsd),
    histXio: xrpHist,
    histComplete: xrpCover.complete,
  });

  const ohlc24Reliable = ohlc24Xio > 0 && xrp24.value > 0 && ohlc24Xio / xrp24.value >= 0.5;
  const xrp7 = pickBestXioVolume([
    { value: ohlc7Xio, complete: true, source: "xrpl.to-ohlc" },
    {
      value: ohlc24Reliable ? xrp24.value * (ohlc7Xio / ohlc24Xio) : 0,
      complete: true,
      source: "ohlc-scale",
    },
    { value: xrpHist7, complete: xrpCover7.complete, source: "xrpl.to-history" },
    { value: xrp24.value ? xrp24.value * 7 : 0, complete: false, source: "24h-times-7" },
  ]);

  const rlusd24 = pickBestXioVolume([
    {
      value: xioVolumeFromDexscreenerPair(dexRlusd, xioUsd || num(dexRlusd?.priceUsd)),
      complete: true,
      source: "dexscreener",
    },
    { value: xioVolumeFromGeckoPool(geckoRlusd, xioUsd), complete: true, source: "geckoterminal" },
    { value: rlusdHist, complete: rlusdCover.complete, source: "xrpl.to-history" },
  ]);
  const rlusd7 = pickBestXioVolume([
    { value: rlusdHist7, complete: rlusdCover7.complete, source: "xrpl.to-history" },
    { value: rlusd24.value ? rlusd24.value * 7 : 0, complete: false, source: "24h-times-7" },
  ]);

  const byPair = {
    "XIO/XRP": {
      volume24hXio: xrp24.value,
      volume7dXio: xrp7.value,
      volume24hXrp: xrpPerXio ? xrp24.value * xrpPerXio : num(args.token?.vol24hXrp) || ohlc24Xrp,
      volume24hUsd: xioUsd ? xrp24.value * xioUsd : 0,
      source: xrp24.source,
    },
    "XIO/RLUSD": {
      volume24hXio: rlusd24.value,
      volume7dXio: rlusd7.value,
      volume24hXrp: 0,
      volume24hUsd: xioUsd ? rlusd24.value * xioUsd : 0,
      source: rlusd24.source,
    },
  };

  const extraPairs = collectVolumePairs(args.pairs, dex, gecko, flows);
  for (const pair of extraPairs) {
    if (byPair[pair]) continue;
    const quote = pair.split("/")[1];
    const hist = sumFlowXio(flows, { now, windowMs: DAY_MS, pair });
    const hist7 = sumFlowXio(flows, { now, windowMs: DAY_MS * 7, pair });
    const picked = pickBestXioVolume([
      {
        value: xioVolumeFromDexscreenerPair(dexscreenerPairForQuote(dex, quote), xioUsd || num(dexscreenerPairForQuote(dex, quote)?.priceUsd)),
        complete: true,
        source: "dexscreener",
      },
      { value: xioVolumeFromGeckoPool(geckoPoolForQuote(gecko, quote), xioUsd), complete: true, source: "geckoterminal" },
      { value: hist, complete: tape24.complete, source: "xrpl.to-history" },
    ]);
    byPair[pair] = {
      volume24hXio: picked.value || 0,
      volume7dXio: hist7 || (picked.value ? picked.value * 7 : 0),
      volume24hXrp: 0,
      volume24hUsd: xioUsd && picked.value ? picked.value * xioUsd : 0,
      source: picked.source || "recorded",
    };
  }
  volumeCache = { at: now, byPair };
  return byPair;
}

function pairFromDexRow(row) {
  const base = String(row?.baseToken?.symbol || "").toUpperCase();
  const quote = String(row?.quoteToken?.symbol || "").toUpperCase();
  if (base === "XIO" && quote) return xioPairKey(`XIO/${quote}`);
  if (quote === "XIO" && base) return xioPairKey(`XIO/${base}`);
  return "";
}

function pairFromGeckoRow(row) {
  const name = String(row?.attributes?.name || row?.name || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  const match = name.match(/XIO\/([A-Z0-9]{2,12})/);
  return match ? `XIO/${match[1]}` : "";
}

function collectVolumePairs(requested = [], dex = {}, gecko = {}, flows = []) {
  const pairs = new Set();
  for (const value of Array.isArray(requested) ? requested : []) {
    const pair = xioPairKey(value);
    if (/^XIO\/[A-Z0-9$]{2,24}$/.test(pair)) pairs.add(pair);
  }
  for (const row of Array.isArray(dex?.pairs) ? dex.pairs : []) {
    const pair = pairFromDexRow(row);
    if (pair) pairs.add(pair);
  }
  for (const row of Array.isArray(gecko?.data) ? gecko.data : []) {
    const pair = pairFromGeckoRow(row);
    if (pair) pairs.add(pair);
  }
  for (const row of Array.isArray(flows) ? flows : []) {
    const pair = xioPairKey(row.pool || row.pool_name || row.pair);
    if (/^XIO\/[A-Z0-9$]{2,24}$/.test(pair)) pairs.add(pair);
  }
  return [...pairs];
}

export function applyPoolVolumes(pools = [], byPair = {}) {
  return (Array.isArray(pools) ? pools : []).map((pool) => {
    const key = xioPairKey(pool.pool || pool.pool_name || pool.pair);
    const vol = byPair[key];
    if (!vol) {
      return attachPoolVolumes(pool, {
        volume24hXio: Number(pool.volume24hXio ?? pool.volume24h) || 0,
        source: pool.volumeSource || "recorded",
      });
    }
    return attachPoolVolumes(pool, vol);
  });
}

export function resetVolumeCache() {
  volumeCache = { at: 0, byPair: null };
}
