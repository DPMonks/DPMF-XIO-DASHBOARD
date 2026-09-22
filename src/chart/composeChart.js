import lockedCandles from "../data/lockedCandles.json" with { type: "json" };
import {appendLiveClose, candlesFromMarketData, clipCandleWicks, expandDailyToInterval, fillDailyGaps, normalizeCandle, resampleCandles, ticksToCandles, wickClipOptions, windowCandles} from "./candles.js";
import {CHART_MA_PAD, intervalMs, isDailyOrLonger, visibleBarsForInterval} from "./intervals.js";
import {inferQuoteReference, orientQuotePrice, quotePerXio, referenceClose, stablePegReference, stitchRlusdCandles} from "./pairQuote.js";

export function lockedSnapshot() {
  return lockedCandles && typeof lockedCandles === "object" ? lockedCandles : { pairs: {}, xrpUsd: [] };
}

export function lockedPairCandles(pair = "XIO/RLUSD") {
  const snap = lockedSnapshot();
  const key = String(pair || "").toUpperCase();
  const rows = snap.pairs?.[key]?.candles || snap.pairs?.[pair]?.candles || [];
  return Array.isArray(rows) ? rows : [];
}

export function ticksFromSparkline(rows = [], pair, prices = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const t = Date.parse(row.timestamp || row.t);
      const usd = Number(row.price_usd ?? row.price ?? row.c);
      const price = quotePerXio({
        pair,
        xioUsd: usd,
        xrpUsd: prices.xrpUsd,
        xioXrp: pair === "XIO/XRP" ? usd / Number(prices.xrpUsd || 0) : null,
        xioRlusd: pair === "XIO/RLUSD" ? usd : null,
      });
      if (!Number.isFinite(t) || !(price > 0)) return null;
      return { t, p: price, source: "sparkline" };
    })
    .filter(Boolean);
}

export function ticksFromTrades(rows = [], pair, reference = null) {
  const want = String(pair || "").toUpperCase();
  const priced = (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const pool = String(row.pool || row.pool_name || row.pair || "").toUpperCase();
      return !pool || pool === want;
    })
    .map((row) => ({
      t: Date.parse(row.timestamp || row.t),
      raw: Number(row.price),
      v: Number(row.xio ?? row.xdx ?? row.v ?? 0) || 0,
    }))
    .filter((row) => Number.isFinite(row.t));
  const ref = Number(reference) > 0 ? Number(reference) : inferQuoteReference(priced.map((row) => row.raw));
  return priced
    .map((row) => {
      const price = orientQuotePrice(row.raw, ref);
      if (!(price > 0)) return null;
      return { t: row.t, p: price, v: row.v, source: "trade" };
    })
    .filter(Boolean);
}

function normalizeCexTape(rows = [], intervalId = "15m") {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeCandle({ ...row, source: row?.source || "cex" }, intervalId))
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
}

/**
 * Compose chart candles for a pair.
 * XRP/RLUSD short TFs use real CEX OHLC (Bitstamp XRP/USD preferred) when
 * cexCandles are provided. DEX book / desk / estimate stay as overlays.
 * Do not invent dense DEX intraday history from daily Yahoo expands.
 */
export function composePairCandles({
  pair = "XIO/RLUSD",
  interval = "1D",
  range = "1M",
  locked = lockedSnapshot(),
  sparkline = [],
  trades = [],
  prices = {},
  livePrice,
  now = Date.now(),
  windowed = true,
  lookbackBars,
  cexCandles = [],
} = {}) {
  const name = String(pair || "XIO/RLUSD").toUpperCase();
  const cexTape = normalizeCexTape(
    cexCandles,
    isDailyOrLonger(interval) ? (interval === "1W" || interval === "3D" || interval === "1M" ? "1D" : interval) : interval
  );

  // XRP/RLUSD: CEX visual tape (RLUSD ~ USD). Skip synthetic daily->intraday expand.
  if (name === "XRP/RLUSD" && cexTape.length) {
    let candles = cexTape;
    if (interval === "1W" || interval === "3D" || interval === "1M") {
      candles = resampleCandles(candles, interval);
    } else if (interval === "1D") {
      candles = fillDailyGaps(candles, candles[0]?.t, now);
    } else if (!isDailyOrLonger(interval)) {
      candles = ticksToCandles(cexTape, interval, { continuous: false });
    }
    // Mild CEX clip; DEX mid/book/desk remain overlays. Stronger clip applied for XIO pairs.
    candles = clipCandleWicks(candles, wickClipOptions({ pair: name }));
    return windowed ? windowCandles(candles, range, now) : candles;
  }

  let base = locked.pairs?.[name]?.candles || [];

  if (name === "XIO/RLUSD" && !base.length) {
    base = stitchRlusdCandles({
      xrpCandles: locked.pairs?.["XIO/XRP"]?.candles || [],
      xrpUsd: locked.xrpUsd || [],
      native: [],
    });
  }

  // XRP/RLUSD daily history fallback: RLUSD ~ USD, reuse locked XRP/USD until CEX loads.
  if (name === "XRP/RLUSD" && !base.length) {
    base = (locked.xrpUsd || [])
      .filter((row) => Number(row?.c) > 0 && Number(row?.t) > 0)
      .map((row) => ({
        t: row.t,
        o: row.o ?? row.c,
        h: row.h ?? row.c,
        l: row.l ?? row.c,
        c: row.c,
        v: Number(row.v) || 0,
        source: row.source || "xrp-usd",
      }));
  }

  const dbHistory = candlesFromMarketData(locked.dbMarket?.[name] || [], "db");
  if (dbHistory.length) {
    const map = new Map(base.map((row) => [row.t, row]));
    for (const row of dbHistory) map.set(row.t, row);
    base = [...map.values()].sort((left, right) => left.t - right.t);
  }

  // XIO sparkline / XIO flow trades do not apply to XRP/RLUSD.
  // Trade prints arrive in both quote-per-base and base-per-quote. Anchor them
  // to the locked candle so inverted AMM fills cannot erase the real candles.
  const sparkTicks =
    name === "XRP/RLUSD"
      ? []
      : ticksFromSparkline(sparkline, name, { xrpUsd: prices.xrpUsd || latestLockedUsd() });
  const ref =
    referenceClose(base) ||
    referenceClose(sparkTicks.map((row) => ({ c: row.p, source: "sparkline" }))) ||
    stablePegReference(name, locked.pairs) ||
    (Number(livePrice) > 0 ? Number(livePrice) : null);
  const liveTicks = name === "XRP/RLUSD" ? [] : [...sparkTicks, ...ticksFromTrades(trades, name, ref)];
  const orientedLive = orientQuotePrice(livePrice, ref);

  const liveInterval = isDailyOrLonger(interval) ? (interval === "1W" || interval === "3D" || interval === "1M" ? "1D" : interval) : interval;
  const live = ticksToCandles(liveTicks, liveInterval, { continuous: false });
  let daily = fillDailyGaps(base, base[0]?.t, now);
  const merged = new Map(daily.map((row) => [row.t, row]));
  for (const row of live) {
    const prev = merged.get(row.t);
    merged.set(row.t, prev ? { ...prev, ...row, o: prev.o, source: row.source || "live" } : row);
  }
  let candles = [...merged.values()].sort((left, right) => left.t - right.t);
  candles = appendLiveClose(candles, orientedLive, now, liveInterval);
  if (interval === "1D") candles = fillDailyGaps(candles, candles[0]?.t, now);
  if (interval === "1W" || interval === "3D" || interval === "1M") {
    candles = resampleCandles(candles, interval);
  }
  if (!isDailyOrLonger(interval)) {
    // XRP/RLUSD without CEX: do not invent dense flat/wick session bars from daily.
    // Keep coarse daily tape until /api/chart/cex-candles arrives.
    if (name === "XRP/RLUSD") {
      candles = clipCandleWicks(candles, wickClipOptions({ pair: name }));
      return windowed ? windowCandles(candles, range, now) : candles;
    }
    const step = intervalMs(interval);
    const need = Math.min(
      4000,
      Math.max(visibleBarsForInterval(interval) + CHART_MA_PAD, Math.trunc(Number(lookbackBars) || 0))
    );
    const from = now - need * step;
    candles = expandDailyToInterval(candles, interval, from, now);
    const intra = ticksToCandles(liveTicks, interval, { continuous: false });
    const intraMap = new Map(candles.map((row) => [row.t, row]));
    for (const row of intra) {
      const prev = intraMap.get(row.t);
      intraMap.set(row.t, prev ? { ...prev, ...row, o: prev.o, source: row.source || "live" } : row);
    }
    candles = [...intraMap.values()].sort((left, right) => left.t - right.t);
    candles = appendLiveClose(candles, orientedLive, now, interval);
  }
  // Display path: clip absurd wick/close extremes from thin AMM/swap prints.
  candles = clipCandleWicks(candles, wickClipOptions({ pair: name }));
  return windowed ? windowCandles(candles, range, now) : candles;
}

export function latestLockedUsd() {
  const rows = lockedSnapshot().xrpUsd || [];
  return Number(rows[rows.length - 1]?.c) || null;
}
