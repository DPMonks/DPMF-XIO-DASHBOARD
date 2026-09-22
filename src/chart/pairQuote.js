import {XIO_ISSUED_AT} from "../constants/ledger.js";

export const RLUSD_USD_PEG = 1;
export const RLUSD_NATIVE_FROM = "2024-12-17T00:00:00.000Z";

export function exactQuote(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e12) / 1e12;
}

export function usdLookup(series = [], t) {
  if (!(Number(t) > 0) || !series.length) return null;
  let match = null;
  for (const row of series) {
    const ts = Number(row.t);
    const price = Number(row.c ?? row.price ?? row.p);
    if (!(ts > 0) || !(price > 0)) continue;
    if (ts <= t) match = price;
    else break;
  }
  return match;
}

export function quotePerXio({
  pair = "XIO/RLUSD",
  xioUsd,
  xrpUsd,
  xioXrp,
  xioRlusd,
  xrpRlusd,
} = {}) {
  const name = String(pair || "").toUpperCase();
  const usd = Number(xioUsd);
  const xrp = Number(xrpUsd);
  const nativeXrp = Number(xioXrp);
  const nativeRlusd = Number(xioRlusd);
  const nativeXrpRlusd = Number(xrpRlusd);

  // RLUSD tracks USD ~1:1; prefer native XRP/RLUSD mid, else XRP/USD.
  if (name === "XRP/RLUSD") {
    if (nativeXrpRlusd > 0) return exactQuote(nativeXrpRlusd);
    if (xrp > 0) return exactQuote(xrp / RLUSD_USD_PEG);
    return null;
  }

  if (name === "XIO/XRP") {
    if (nativeXrp > 0) return exactQuote(nativeXrp);
    if (usd > 0 && xrp > 0) return exactQuote(usd / xrp);
    return null;
  }

  if (nativeRlusd > 0) return exactQuote(nativeRlusd);
  if (usd > 0) return exactQuote(usd / RLUSD_USD_PEG);
  if (nativeXrp > 0 && xrp > 0) return exactQuote(nativeXrp * xrp);
  return null;
}

export function backdateRlusdCandle(xrpCandle, xrpUsd) {
  const fx = Number(xrpUsd);
  if (!(fx > 0) || !xrpCandle || !(Number(xrpCandle.c) > 0)) return null;
  const scale = (value) => exactQuote(Number(value) * fx);
  return {
    t: xrpCandle.t,
    o: scale(xrpCandle.o || xrpCandle.c),
    h: scale(xrpCandle.h || xrpCandle.c),
    l: scale(xrpCandle.l || xrpCandle.c),
    c: scale(xrpCandle.c),
    v: Number(xrpCandle.v) || 0,
    source: "backdated",
  };
}

export function stitchRlusdCandles({
  xrpCandles = [],
  xrpUsd = [],
  native = [],
  nativeFrom = RLUSD_NATIVE_FROM,
} = {}) {
  const cutoff = Date.parse(nativeFrom || RLUSD_NATIVE_FROM);
  const nativeMap = new Map(
    (Array.isArray(native) ? native : [])
      .filter((row) => Number(row?.c) > 0 && Number(row?.t) > 0)
      .map((row) => [row.t, row])
  );
  const out = [];
  for (const candle of xrpCandles) {
    const nativeRow = nativeMap.get(candle.t);
    if (nativeRow && Number(nativeRow.c) > 0) {
      out.push({ ...nativeRow, source: nativeRow.source || "native" });
      nativeMap.delete(candle.t);
      continue;
    }
    if (Number.isFinite(cutoff) && candle.t >= cutoff && nativeRow) {
      out.push({ ...nativeRow, source: "native" });
      continue;
    }
    const fx = usdLookup(xrpUsd, candle.t);
    const backdated = backdateRlusdCandle(candle, fx);
    if (backdated) out.push(backdated);
  }
  for (const leftover of nativeMap.values()) {
    if (leftover.t >= cutoff || leftover.source === "native") out.push(leftover);
  }
  return out.sort((left, right) => left.t - right.t);
}

export function issuedAtMs() {
  return Date.parse(XIO_ISSUED_AT);
}

const STABLE_QUOTES = new Set(["USD", "USDC", "USDT"]);

/**
 * Median close of recent real candles. Carry/session fills are not a price reference.
 */
export function referenceClose(candles = [], { take = 60 } = {}) {
  const closes = [];
  const list = Array.isArray(candles) ? candles : [];
  const limit = Math.max(1, Math.trunc(Number(take) || 60));
  for (let i = list.length - 1; i >= 0 && closes.length < limit; i -= 1) {
    const row = list[i];
    const src = String(row?.source || "");
    if (src === "carry" || src === "session") continue;
    const close = Number(row?.c ?? row?.price ?? row?.p);
    if (close > 0) closes.push(close);
  }
  if (!closes.length) return null;
  closes.sort((a, b) => a - b);
  return closes[Math.floor(closes.length / 2)];
}

/**
 * Quote-per-base price for the chart scale.
 * Keeps prints near `reference`, flips reciprocals (token-per-quote tapes), drops the rest.
 * With no reference, a positive price is returned unchanged.
 */
export function orientQuotePrice(price, reference, { factor = 6 } = {}) {
  const value = Number(price);
  if (!(value > 0)) return null;
  const ref = Number(reference);
  if (!(ref > 0)) return exactQuote(value);
  const band = Number(factor) > 1 ? Number(factor) : 6;
  const lo = ref / band;
  const hi = ref * band;
  if (value >= lo && value <= hi) return exactQuote(value);
  const inverse = 1 / value;
  if (inverse >= lo && inverse <= hi) return exactQuote(inverse);
  return null;
}

/** Geometric-median scale when a pair has no locked candle to anchor to. */
export function inferQuoteReference(prices = [], { factor = 6 } = {}) {
  const nums = (Array.isArray(prices) ? prices : []).map(Number).filter((value) => value > 0);
  if (!nums.length) return null;
  const band = Number(factor) > 1 ? Number(factor) : 6;
  const logs = nums.map((value) => Math.log(value)).sort((a, b) => a - b);
  const geo = Math.exp(logs[Math.floor(logs.length / 2)]);
  const near = nums.filter((value) => value >= geo / band && value <= geo * band).length;
  if (near >= nums.length * 0.5) return geo;
  const flipped = nums
    .filter((value) => value < geo / band || value > geo * band)
    .map((value) => 1 / value)
    .filter((value) => value > 0);
  if (!flipped.length) return geo;
  const altLogs = flipped.map((value) => Math.log(value)).sort((a, b) => a - b);
  const alt = Math.exp(altLogs[Math.floor(altLogs.length / 2)]);
  const score = (ref) => nums.filter((value) => orientQuotePrice(value, ref, { factor: band }) != null).length;
  return score(alt) > score(geo) ? alt : geo;
}

/** USD/USDC/USDT charts follow the same token's RLUSD candle when they have no tape of their own. */
export function stablePegReference(pair, pairs = {}) {
  const [base, quote] = String(pair || "").toUpperCase().split("/");
  if (!base || !STABLE_QUOTES.has(quote)) return null;
  const rows = pairs?.[`${base}/RLUSD`]?.candles;
  return referenceClose(Array.isArray(rows) ? rows : []);
}
