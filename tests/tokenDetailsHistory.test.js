import test from "node:test";
import assert from "node:assert/strict";
import {TOKEN_DETAIL_METRICS, TOKEN_DETAIL_RANGES, composeTokenDetailHistory, liveTokenDetailTip, mergeTokenDetailRows, namedHistoryRows, rowsFromOhlc, tokenDetailDecimals, tokenDetailLabel, tokenDetailMetricNumber, aggregateLpChartRows, windowedTokenSeries, xioPriceHistoryRows} from "../src/tokenDetailsHistory.js";

test("token detail tabs cover the live numeric token-detail boxes", () => {
  assert.deepEqual(TOKEN_DETAIL_METRICS, [
    "price",
    "xioPerXrp",
    "xrplMarketCap",
    "circulatingMarketCap",
    "ammMarketCap",
    "circulating",
    "burnedSupply",
    "holders",
    "trustlines",
    "lpHolders",
    "lpTrustlines",
    "lpSupply",
  ]);
  assert.deepEqual(TOKEN_DETAIL_RANGES, [
    "1H",
    "4H",
    "12H",
    "24H",
    "1W",
    "1M",
    "3M",
    "1Y",
    "Max",
  ]);
});

test("tokenDetailLabel uses Token Details copy for LP counts", () => {
  const t = {
    lpHolders: "XIO Lp Owners",
    lpHoldersCount: "LP holders",
    lpTrustlinesCount: "LP trustlines",
    price: "Price",
  };
  assert.equal(tokenDetailLabel(t, "lpHolders"), "LP holders");
  assert.equal(tokenDetailLabel(t, "lpTrustlines"), "LP trustlines");
  assert.equal(tokenDetailLabel(t, "price"), "Price");
});

test("namedHistoryRows maps a dedicated count series onto one metric", () => {
  const rows = namedHistoryRows(
    [{ timestamp: "2026-08-25T12:00:00.000Z", count: 15939 }],
    "holders"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].holders, 15939);
});

test("mergeTokenDetailRows keeps later values at the same timestamp", () => {
  const merged = mergeTokenDetailRows(
    [{ timestamp: "2026-08-25T12:00:00.000Z", holders: 15940, price: 0.00004 }],
    [{ timestamp: "2026-08-25T12:00:00.000Z", holders: 15939, trustlines: 19980 }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].holders, 15939);
  assert.equal(merged[0].price, 0.00004);
  assert.equal(merged[0].trustlines, 19980);
});

test("liveTokenDetailTip keeps Token Details numbers on the latest point", () => {
  const tip = liveTokenDetailTip({
    timestamp: "2026-08-25T12:09:00.000Z",
    price: 0.00004658,
    holders: 15939,
    lpHolders: 88,
    lpSupply: 12.5,
  });
  assert.equal(tokenDetailMetricNumber(tip, "price"), 0.00004658);
  assert.equal(tokenDetailMetricNumber(tip, "holders"), 15939);
  assert.equal(tokenDetailMetricNumber(tip, "lpHolders"), 88);
  assert.equal(tokenDetailMetricNumber(tip, "lpSupply"), 12.5);
});

test("composeTokenDetailHistory derives market caps from sparkline and live supply", () => {
  const rows = composeTokenDetailHistory({
    holders: [{ timestamp: "2026-08-25T11:00:00.000Z", count: 15940 }],
    sparkline: [{ timestamp: "2026-08-25T11:30:00.000Z", price_usd: 0.00004 }],
    live: {
      timestamp: "2026-08-25T12:00:00.000Z",
      price: 0.00005,
      circulating: 10_000_000_000,
      totalSupply: 10_000_000_000,
      xrpUsd: 2,
      holders: 15939,
    },
  });
  assert.ok(rows.length >= 2);
  const spark = rows.find((row) => row.price === 0.00004);
  assert.ok(spark);
  assert.equal(Math.round(spark.xrplMarketCap), 400_000);
  assert.equal(Math.round(spark.circulatingMarketCap), 400_000);
  assert.equal(spark.xioPerXrp, 0.00002);
  const tip = rows[rows.length - 1];
  assert.equal(tip.holders, 15939);
  assert.equal(tip.price, 0.00005);
});

test("windowedTokenSeries seeds the selected timeframe and keeps the live tip", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const rows = [
    { timestamp: "2026-08-24T12:00:00.000Z", ts: now - 86400000, holders: 15944 },
    { timestamp: "2026-08-25T12:00:00.000Z", ts: now, holders: 15939 },
  ];
  const windowed = windowedTokenSeries(rows, "24H", now, "holders");
  assert.ok(windowed.length >= 2);
  assert.equal(windowed[0].ts, now - 86400000);
  assert.equal(windowed[windowed.length - 1].plot, 15939);
});

test("windowedTokenSeries does not invent a year of flat history from one live tip", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const windowed = windowedTokenSeries(
    [{ timestamp: "2026-08-25T12:00:00.000Z", ts: now, lpSupply: 233525459 }],
    "1Y",
    now,
    "lpSupply"
  );
  assert.ok(windowed.length >= 1);
  assert.ok(windowed[0].ts > now - 30 * 86400000);
  assert.equal(windowed[windowed.length - 1].plot, 233525459);
});

test("xioPriceHistoryRows keeps XIO candles and drops XRP", () => {
  const rows = xioPriceHistoryRows({
    price_history: [
      { timestamp: "2026-08-21T20:54:47.746Z", asset: "XRP", price_usd: 1.37 },
      { timestamp: "2026-08-21T20:54:47.746Z", asset: "XIO", price_usd: 0.00004071 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_usd, 0.00004071);
});

test("rowsFromOhlc reads xrpl.to daily closes", () => {
  const rows = rowsFromOhlc({
    ohlc: [[1722470400, 0.00003, 0.00004, 0.00002, 0.000035]],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_usd, 0.000035);
});

test("composeTokenDetailHistory uses candle prices and LP supply scans", () => {
  const rows = composeTokenDetailHistory({
    candles: [
      { timestamp: "2026-08-21T20:54:47.746Z", asset: "XIO", price_usd: 0.00004071 },
      { timestamp: "2026-08-25T12:00:00.000Z", asset: "XIO", price_usd: 0.00004659 },
    ],
    lpTrustlines: [
      { timestamp: "2026-08-21T23:06:33.453Z", lp_supply: 220000000, trustline_count: 67 },
      { timestamp: "2026-08-25T12:00:00.000Z", lp_supply: 233525459, trustline_count: 70 },
    ],
    live: {
      timestamp: "2026-08-25T12:09:00.000Z",
      price: 0.00004658,
      circulating: 10_000_000_000,
      totalSupply: 10_000_000_000,
      lpSupply: 233525459,
    },
  });
  const first = rows.find((row) => row.price === 0.00004071);
  const supply = rows.find((row) => row.lpSupply === 220000000);
  assert.ok(first);
  assert.ok(supply);
  assert.ok(first.xrplMarketCap > 400_000);
});

test("composeTokenDetailHistory prefers candle prices over a conflicting sparkline", () => {
  const rows = composeTokenDetailHistory({
    candles: [{ timestamp: "2026-08-25T11:30:00.000Z", asset: "XIO", price_usd: 0.000046 }],
    sparkline: [{ timestamp: "2026-08-25T11:30:00.000Z", price_usd: 0.00009 }],
    live: { timestamp: "2026-08-25T12:00:00.000Z", price: 0.0000465 },
  });
  const mid = rows.find((row) => row.timestamp === "2026-08-25T11:30:00.000Z");
  assert.equal(mid.price, 0.000046);
});

test("windowedTokenSeries does not clone a synthetic now point onto the tail", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const windowed = windowedTokenSeries(
    [
      { timestamp: "2026-08-25T11:00:00.000Z", ts: now - 3600000, price: 0.000047 },
      { timestamp: "2026-08-25T11:58:00.000Z", ts: now - 120000, price: 0.0000465 },
    ],
    "24H",
    now,
    "price"
  );
  assert.equal(windowed[windowed.length - 1].ts, now - 120000);
  assert.equal(windowed[windowed.length - 1].plot, 0.0000465);
});

test("tokenDetailDecimals match Token Details precision", () => {
  assert.equal(tokenDetailDecimals("price"), 8);
  assert.equal(tokenDetailDecimals("xioPerXrp"), 8);
  assert.equal(tokenDetailDecimals("xrplMarketCap"), 2);
  assert.equal(tokenDetailDecimals("holders"), 0);
});

test("windowedTokenSeries left-fills level metrics across intraday windows", () => {
  const now = Date.parse("2026-09-11T22:00:00.000Z");
  const windowed = windowedTokenSeries(
    [{ timestamp: "2026-09-11T22:00:00.000Z", ts: now, holders: 16010 }],
    "24H",
    now,
    "holders"
  );
  assert.ok(windowed.length >= 2);
  assert.equal(windowed[0].ts, now - 86400000);
  assert.equal(windowed[0].plot, 16010);
  assert.equal(windowed[windowed.length - 1].plot, 16010);
});

test("windowedTokenSeries left-fills mid-window price when history already has shape", () => {
  const now = Date.parse("2026-09-11T22:00:00.000Z");
  const start = now - 86400000;
  const windowed = windowedTokenSeries(
    [
      { timestamp: new Date(start + 6 * 3600000).toISOString(), ts: start + 6 * 3600000, price: 0.00004 },
      { timestamp: new Date(start + 12 * 3600000).toISOString(), ts: start + 12 * 3600000, price: 0.000041 },
      { timestamp: new Date(now - 60000).toISOString(), ts: now - 60000, price: 0.000042 },
    ],
    "24H",
    now,
    "price"
  );
  assert.equal(windowed[0].ts, start);
  assert.equal(windowed[0].plot, 0.00004);
});

test("composeTokenDetailHistory steps circulating and burned onto price history", () => {
  const rows = composeTokenDetailHistory({
    candles: [
      { timestamp: "2026-09-11T10:00:00.000Z", asset: "XIO", price_usd: 0.00004 },
      { timestamp: "2026-09-11T18:00:00.000Z", asset: "XIO", price_usd: 0.000041 },
    ],
    live: {
      timestamp: "2026-09-11T22:00:00.000Z",
      price: 0.000042,
      circulating: 9_500_000_000,
      burnedSupply: 500_000_000,
      totalSupply: 10_000_000_000,
      xrpUsd: 2,
    },
  });
  const mid = rows.find((row) => row.price === 0.00004);
  assert.ok(mid);
  assert.equal(mid.circulating, 9_500_000_000);
  assert.equal(mid.burnedSupply, 500_000_000);
  assert.equal(Math.round(mid.circulatingMarketCap), 380_000);
});

test("aggregateLpChartRows carries per-pool samples instead of plotting false zeros", () => {
  const rows = aggregateLpChartRows([
    {
      timestamp: "2026-09-11T10:00:00.000Z",
      pool_name: "XIO/XRP",
      trustline_count: 70,
      lp_holder_count: 55,
      lp_supply: 200_000_000,
    },
    {
      timestamp: "2026-09-11T11:00:00.000Z",
      pool_name: "XIO/RLUSD",
      trustline_count: 20,
      lp_holder_count: 18,
      lp_supply: 0,
    },
    {
      timestamp: "2026-09-11T12:00:00.000Z",
      pool_name: "XIO/XRP",
      trustline_count: 0,
      lp_holder_count: 0,
      lp_supply: 0,
    },
  ]);
  assert.ok(rows.length >= 2);
  const last = rows[rows.length - 1];
  assert.ok(last.lpTrustlines >= 70);
  assert.ok(last.lpHolders >= 55);
  assert.equal(last.lpSupply, 200_000_000);
  assert.ok(rows.every((row) => row.lpSupply !== 0));
});

