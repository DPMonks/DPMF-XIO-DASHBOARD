/**
 * Client helper for /api/chart/cex-candles (Bitstamp-first XRP/USD tape).
 */
import {normalizeCandle, resampleCandles} from "./candles.js";
import {isDailyOrLonger} from "./intervals.js";

export const CEX_TAPE_PAIRS = new Set(["XRP/RLUSD", "XRP/USD"]);

export function usesCexTape(pair) {
  return CEX_TAPE_PAIRS.has(String(pair || "").toUpperCase());
}

export function cexCandleSourceLabel(source) {
  const key = String(source || "").toLowerCase();
  const name =
    key === "bitstamp"
      ? "Bitstamp XRP/USD (CEX)"
      : key === "kraken"
        ? "Kraken XRP/USD (CEX)"
        : key === "coinbase"
          ? "Coinbase XRP/USD (CEX)"
          : "CEX XRP/USD";
  return `Candles: ${name} | Book: XRPL XRP/RLUSD`;
}

export function normalizeCexCandles(rows = [], intervalId = "15m") {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeCandle({ ...row, source: row?.source || "cex" }, intervalId))
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
}

/**
 * Fetch CEX OHLC via same-origin proxy. Longer timeout than default api.getJson.
 */
export async function fetchCexCandles({
  interval = "15m",
  limit = 500,
  signal,
} = {}) {
  const params = new URLSearchParams({
    interval: String(interval || "15m"),
    limit: String(Math.min(5000, Math.max(24, Math.trunc(Number(limit) || 500)))),
  });
  const response = await fetch(`/api/chart/cex-candles?${params}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal || AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    const err = new Error(body?.error || `CEX candles ${response.status}`);
    err.status = response.status;
    err.code = body?.code;
    throw err;
  }
  const fetchId = body.fetchId || body.interval || interval;
  let candles = normalizeCexCandles(body.candles || [], fetchId);
  const want = body.resampleTo || interval;
  if (want && want !== fetchId) {
    if (isDailyOrLonger(want) || want === "8h" || want === "2h") {
      candles = resampleCandles(candles, want);
    } else {
      candles = normalizeCexCandles(candles, want);
    }
  }
  const source = body.source || candles[0]?.source || "cex";
  return {
    candles,
    source,
    label: body.label || cexCandleSourceLabel(source),
    interval: want || fetchId,
    fetchId,
    count: candles.length,
  };
}

export function defaultCexLimit(intervalId, lookbackBars = 0) {
  const id = String(intervalId || "15m");
  const base =
    id === "5m" ? 400 : id === "15m" ? 500 : id === "1h" ? 2200 : id === "1D" ? 900 : 600;
  return Math.min(5000, Math.max(base, Math.trunc(Number(lookbackBars) || 0) + 80));
}
