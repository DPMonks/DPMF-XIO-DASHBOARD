#!/usr/bin/env node
/**
 * Pull XIO candle history once and lock it.
 *
 * XIO/XRP daily OHLC: InFTF XRPL DEX market_data (open/high/low/close/volume).
 * XRP/USD daily: Yahoo XRP-USD from issuance.
 * XIO/RLUSD: XIO/XRP × that day's XRP/USD (RLUSD ≈ $1) until native AMM prints exist.
 *
 * Re-run only when you intentionally refresh the locked snapshot.
 * Does not start indexer workers. Does not call XRPL from the browser.
 *
 *   node scripts/lock-hybrid-candles.js
 */
import {writeFileSync} from "node:fs";
import {XIO_ISSUED_AT, XIO_ISSUER} from "../src/constants/ledger.js";
import {backdateRlusdCandle, usdLookup} from "../src/chart/pairQuote.js";
import {candlesFromMarketData, ticksToCandles} from "../src/chart/candles.js";

const ISSUED = Date.parse(XIO_ISSUED_AT) || Date.parse("2021-10-24T00:00:00.000Z");
const OUT = new URL("../src/data/lockedCandles.json", import.meta.url);
const INFTF_BASE = `https://xrpldata.inftf.org/v1/iou/market_data/${XIO_ISSUER}_XIO/XRP`;

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 DPMF-XIO-Dashboard" },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return body;
}

function krakenRows(body) {
  const result = body?.result || {};
  const key = Object.keys(result).find((name) => name !== "last");
  return Array.isArray(result[key]) ? result[key] : [];
}

async function lockXrpUsd() {
  const period1 = Math.floor(ISSUED / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const body = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/XRP-USD?period1=${period1}&period2=${period2}&interval=1d&events=history`
  );
  const result = body?.chart?.result?.[0];
  const stamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const candles = stamps
    .map((stamp, index) => ({
      t: Number(stamp) * 1000,
      o: Number(quote.open?.[index]),
      h: Number(quote.high?.[index]),
      l: Number(quote.low?.[index]),
      c: Number(quote.close?.[index]),
      v: Number(quote.volume?.[index]) || 0,
      source: "yahoo-xrp-usd",
    }))
    .filter((row) => row.t >= ISSUED && row.c > 0);
  if (candles.length) return ticksToCandles(candles, "1D", { continuous: false });

  const kraken = await getJson("https://api.kraken.com/0/public/OHLC?pair=XRPUSD&interval=1440");
  return ticksToCandles(
    krakenRows(kraken).map((row) => ({
      t: Number(row[0]) * 1000,
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[6]) || 0,
      source: "kraken",
    })),
    "1D",
    { continuous: false }
  );
}

async function lockXioXrp() {
  const pages = [];
  let start = "2021-10-24T00:00:00Z";
  for (let page = 0; page < 8; page += 1) {
    const rows = await getJson(
      `${INFTF_BASE}?interval=1d&start=${encodeURIComponent(start)}&limit=1000`
    );
    if (!Array.isArray(rows) || !rows.length) break;
    pages.push(...rows);
    const last = rows[rows.length - 1]?.timestamp;
    if (!last || rows.length < 1000) break;
    start = last;
  }
  const seen = new Map();
  for (const row of candlesFromMarketData(pages, "inftf")) {
    if (Number(row.c) > 0.001) seen.set(row.t, row);
  }
  return [...seen.values()].sort((left, right) => left.t - right.t);
}

const xrpUsd = await lockXrpUsd();
const xioXrp = await lockXioXrp();
const xioRlusd = xioXrp
  .map((candle) => backdateRlusdCandle(candle, usdLookup(xrpUsd, candle.t)))
  .filter(Boolean);

const last = xioXrp.at(-1);
if (!(Number(last?.c) > 1)) {
  throw new Error(`Refusing lock: last XIO/XRP close is ${last?.c} (want tens of XRP, not XDX dust)`);
}

const locked = {
  lockedAt: new Date().toISOString(),
  issuedAt: XIO_ISSUED_AT || "2021-10-24T00:00:00.000Z",
  interval: "1D",
  pairs: {
    "XIO/XRP": {
      quote: "XRP",
      source: xioXrp.length ? "inftf-xrpl-dex" : "pending",
      candles: xioXrp,
    },
    "XIO/RLUSD": {
      quote: "RLUSD",
      source: xioRlusd.length ? "backdated(xio_xrp*xrp_usd)" : "pending",
      candles: xioRlusd,
    },
  },
  xrpUsd,
};

writeFileSync(OUT, `${JSON.stringify(locked)}\n`);
console.log(
  JSON.stringify(
    {
      file: "src/data/lockedCandles.json",
      xrpUsd: xrpUsd.length,
      xioXrp: xioXrp.length,
      xioRlusd: xioRlusd.length,
      firstXio: xioXrp[0]?.t && new Date(xioXrp[0].t).toISOString(),
      lastXio: xioXrp.at(-1)?.t && new Date(xioXrp.at(-1).t).toISOString(),
      lastClose: last?.c,
    },
    null,
    2
  )
);
