import test from "node:test";
import assert from "node:assert/strict";
import {inferTradesFromHistory, traderSeriesFromTrades} from "../src/xioTrades.js";

test("inferTradesFromHistory turns AMM reserve changes into buy and sell prints", () => {
  const trades = inferTradesFromHistory([
    {
      timestamp: "2026-08-22T08:00:00.000Z",
      pool_name: "XIO/XRP",
      reserve_asset: 1000,
      reserve_currency: 10,
      price: 0.01,
    },
    {
      timestamp: "2026-08-22T08:05:00.000Z",
      pool_name: "XIO/XRP",
      reserve_asset: 900,
      reserve_currency: 11,
      price: 0.012,
    },
    {
      timestamp: "2026-08-22T08:10:00.000Z",
      pool_name: "XIO/XRP",
      reserve_asset: 950,
      reserve_currency: 10.4,
      price: 0.011,
    },
  ]);

  assert.equal(trades.length, 2);
  assert.equal(trades[0].side, "sell");
  assert.equal(trades[0].xio, 50);
  assert.equal(trades[1].side, "buy");
  assert.equal(trades[1].xio, 100);
  assert.equal(trades[1].pool, "XIO/XRP");
});

test("inferTradesFromHistory ignores dust and keeps pools separate", () => {
  const trades = inferTradesFromHistory([
    { timestamp: "2026-08-22T08:00:00.000Z", pool: "XIO/XRP", reserve_asset: 100, reserve_currency: 2 },
    { timestamp: "2026-08-22T08:01:00.000Z", pool: "XIO/RLUSD", reserve_asset: 200, reserve_currency: 5 },
    { timestamp: "2026-08-22T08:02:00.000Z", pool: "XIO/XRP", reserve_asset: 100.0000001, reserve_currency: 2 },
    { timestamp: "2026-08-22T08:03:00.000Z", pool: "XIO/RLUSD", reserve_asset: 180, reserve_currency: 5.5 },
  ]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].pool, "XIO/RLUSD");
  assert.equal(trades[0].side, "buy");
  assert.equal(trades[0].xio, 20);
});

test("traderSeriesFromTrades buckets unique accounts by hour", () => {
  const series = traderSeriesFromTrades([
    { timestamp: "2026-08-22T08:10:00.000Z", xio: 10, account: "rA" },
    { timestamp: "2026-08-22T08:40:00.000Z", xio: 5, account: "rB" },
    { timestamp: "2026-08-22T08:50:00.000Z", xio: 2, account: "rA" },
    { timestamp: "2026-08-22T09:05:00.000Z", xio: 8 },
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[0].trades, 3);
  assert.equal(series[0].traders, 2);
  assert.equal(series[0].volume, 17);
  assert.equal(series[1].traders, 1);
});
