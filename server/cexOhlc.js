/**
 * Free public CEX OHLC for XRP/USD (RLUSD ~ USD visual tape).
 * Prefer Bitstamp XRP/USD; fall back to Kraken, then Coinbase.
 * Server-only (Vite middleware + Vercel). Browser must not call CEX hosts
 * directly (CSP connect-src is same-origin only).
 */
const UA = "Mozilla/5.0 DPMF-XIO-Dashboard";

/** Bitstamp OHLC step seconds by chart interval id. */
export const BITSTAMP_STEPS = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "12h": 43200,
  "1D": 86400,
  "3D": 259200,
};

/** Kraken OHLC interval minutes. */
export const KRAKEN_INTERVALS = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1D": 1440,
  "1W": 10080,
};

/** Coinbase candle granularity seconds. */
export const COINBASE_GRANULARITY = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "1D": 86400,
};

const SOURCE_LABELS = {
  bitstamp: "Bitstamp XRP/USD (CEX)",
  kraken: "Kraken XRP/USD (CEX)",
  coinbase: "Coinbase XRP/USD (CEX)",
};

export function cexCandleSourceLabel(source) {
  const name = SOURCE_LABELS[String(source || "").toLowerCase()] || "CEX XRP/USD";
  return `Candles: ${name} | Book: XRPL XRP/RLUSD`;
}

export function resolveCexFetchPlan(intervalId = "15m") {
  const id = String(intervalId || "15m");
  if (BITSTAMP_STEPS[id]) {
    return { fetchId: id, stepSec: BITSTAMP_STEPS[id], resampleTo: null };
  }
  if (id === "8h") return { fetchId: "4h", stepSec: 14400, resampleTo: "8h" };
  if (id === "1W" || id === "1M") return { fetchId: "1D", stepSec: 86400, resampleTo: id };
  return { fetchId: "1h", stepSec: 3600, resampleTo: id === "1h" ? null : id };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row, source) {
  const tRaw = num(row?.t ?? row?.timestamp ?? row?.time);
  if (!(tRaw > 0)) return null;
  const t = tRaw < 1e12 ? tRaw * 1000 : tRaw;
  const o = num(row?.o ?? row?.open);
  const h = num(row?.h ?? row?.high);
  const l = num(row?.l ?? row?.low);
  const c = num(row?.c ?? row?.close);
  const v = num(row?.v ?? row?.volume) || 0;
  if (!(c > 0) && !(o > 0)) return null;
  const close = c > 0 ? c : o;
  const open = o > 0 ? o : close;
  const high = h > 0 ? Math.max(h, open, close) : Math.max(open, close);
  const low = l > 0 ? Math.min(l, open, close) : Math.min(open, close);
  return { t, o: open, h: high, l: low, c: close, v, source };
}

async function getJson(url, { timeoutMs = 12_000 } = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(`${response.status} ${url}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function mergeByTime(lists = []) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (!(row?.t > 0) || !(row?.c > 0)) continue;
      map.set(row.t, row);
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

async function fetchBitstampPage({ stepSec, limit, startSec, endSec }) {
  const params = new URLSearchParams({
    step: String(stepSec),
    limit: String(Math.min(1000, Math.max(1, Math.trunc(limit) || 1000))),
  });
  if (Number.isFinite(startSec) && startSec > 0) params.set("start", String(Math.trunc(startSec)));
  if (Number.isFinite(endSec) && endSec > 0) params.set("end", String(Math.trunc(endSec)));
  const body = await getJson(`https://www.bitstamp.net/api/v2/ohlc/xrpusd/?${params}`);
  const rows = body?.data?.ohlc || [];
  return (Array.isArray(rows) ? rows : [])
    .map((row) =>
      normalizeRow(
        {
          t: row.timestamp,
          o: row.open,
          h: row.high,
          l: row.low,
          c: row.close,
          v: row.volume,
        },
        "bitstamp"
      )
    )
    .filter(Boolean);
}

async function fetchBitstampCandles({ stepSec, limit = 500, endMs = Date.now() } = {}) {
  const want = Math.min(5000, Math.max(24, Math.trunc(Number(limit) || 500)));
  const out = [];
  let endSec = Math.floor(Number(endMs) / 1000);
  for (let page = 0; page < 12 && out.length < want; page += 1) {
    const batch = Math.min(1000, want - out.length);
    const startSec = endSec - batch * stepSec;
    const rows = await fetchBitstampPage({ stepSec, limit: batch, startSec, endSec });
    if (!rows.length) break;
    const merged = mergeByTime([rows, out]);
    out.length = 0;
    out.push(...merged);
    const oldest = rows[0]?.t;
    if (!(oldest > 0)) break;
    const nextEnd = Math.floor(oldest / 1000) - stepSec;
    if (!(nextEnd < endSec)) break;
    endSec = nextEnd;
    if (rows.length < Math.min(batch, 50)) break;
  }
  return out.slice(-want);
}

async function fetchKrakenCandles({ intervalId, limit = 500 } = {}) {
  const minutes = KRAKEN_INTERVALS[intervalId];
  if (!minutes) return [];
  const body = await getJson(
    `https://api.kraken.com/0/public/OHLC?pair=XRPUSD&interval=${minutes}`
  );
  const result = body?.result || {};
  const key = Object.keys(result).find((name) => name !== "last");
  const rows = Array.isArray(result[key]) ? result[key] : [];
  const candles = rows
    .map((row) =>
      normalizeRow(
        {
          t: row[0],
          o: row[1],
          h: row[2],
          l: row[3],
          c: row[4],
          v: row[6],
        },
        "kraken"
      )
    )
    .filter(Boolean);
  return candles.slice(-Math.min(720, Math.max(24, Math.trunc(Number(limit) || 500))));
}

async function fetchCoinbaseCandles({ intervalId, limit = 300, endMs = Date.now() } = {}) {
  const gran = COINBASE_GRANULARITY[intervalId];
  if (!gran) return [];
  const want = Math.min(300, Math.max(24, Math.trunc(Number(limit) || 300)));
  const endSec = Math.floor(Number(endMs) / 1000);
  const startSec = endSec - want * gran;
  const params = new URLSearchParams({
    granularity: String(gran),
    start: new Date(startSec * 1000).toISOString(),
    end: new Date(endSec * 1000).toISOString(),
  });
  const body = await getJson(
    `https://api.exchange.coinbase.com/products/XRP-USD/candles?${params}`
  );
  const rows = Array.isArray(body) ? body : [];
  // Coinbase: [ time, low, high, open, close, volume ], newest first.
  const candles = rows
    .map((row) =>
      normalizeRow(
        {
          t: row[0],
          l: row[1],
          h: row[2],
          o: row[3],
          c: row[4],
          v: row[5],
        },
        "coinbase"
      )
    )
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  return candles.slice(-want);
}

/**
 * Load XRP/USD OHLC from free CEX history.
 * @returns {{ candles: Array, source: string, label: string, pair: string, interval: string, fetchId: string }}
 */
export async function loadCexXrpUsdCandles({
  interval = "15m",
  limit = 500,
  endMs = Date.now(),
} = {}) {
  const plan = resolveCexFetchPlan(interval);
  const want = Math.min(5000, Math.max(24, Math.trunc(Number(limit) || 500)));
  const errors = [];

  try {
    const candles = await fetchBitstampCandles({
      stepSec: plan.stepSec,
      limit: want,
      endMs,
    });
    if (candles.length >= Math.min(24, want)) {
      return {
        candles,
        source: "bitstamp",
        label: cexCandleSourceLabel("bitstamp"),
        pair: "XRP/USD",
        interval: plan.fetchId,
        fetchId: plan.fetchId,
        resampleTo: plan.resampleTo,
        count: candles.length,
      };
    }
    errors.push(`bitstamp short (${candles.length})`);
  } catch (error) {
    errors.push(`bitstamp: ${error.message}`);
  }

  try {
    const candles = await fetchKrakenCandles({ intervalId: plan.fetchId, limit: want });
    if (candles.length >= 12) {
      return {
        candles,
        source: "kraken",
        label: cexCandleSourceLabel("kraken"),
        pair: "XRP/USD",
        interval: plan.fetchId,
        fetchId: plan.fetchId,
        resampleTo: plan.resampleTo,
        count: candles.length,
      };
    }
    errors.push(`kraken short (${candles.length})`);
  } catch (error) {
    errors.push(`kraken: ${error.message}`);
  }

  try {
    const candles = await fetchCoinbaseCandles({
      intervalId: plan.fetchId,
      limit: Math.min(300, want),
      endMs,
    });
    if (candles.length >= 12) {
      return {
        candles,
        source: "coinbase",
        label: cexCandleSourceLabel("coinbase"),
        pair: "XRP/USD",
        interval: plan.fetchId,
        fetchId: plan.fetchId,
        resampleTo: plan.resampleTo,
        count: candles.length,
      };
    }
    errors.push(`coinbase short (${candles.length})`);
  } catch (error) {
    errors.push(`coinbase: ${error.message}`);
  }

  const err = new Error(`CEX OHLC unavailable (${errors.join("; ") || "no source"})`);
  err.code = "CEX_OHLC_UNAVAILABLE";
  throw err;
}
