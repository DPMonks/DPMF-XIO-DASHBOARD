import test from "node:test";
import assert from "node:assert/strict";
import {composePairCandles} from "../src/chart/composeChart.js";
import {cexCandleSourceLabel, defaultCexLimit, normalizeCexCandles, usesCexTape} from "../src/chart/cexCandles.js";
import {cexCandleSourceLabel as serverLabel, resolveCexFetchPlan} from "../server/cexOhlc.js";

test("usesCexTape only for XRP/RLUSD visual pair", () => {
  assert.equal(usesCexTape("XRP/RLUSD"), true);
  assert.equal(usesCexTape("XIO/RLUSD"), false);
  assert.equal(usesCexTape("XIO/XRP"), false);
});

test("cex source label uses ASCII separators", () => {
  const label = cexCandleSourceLabel("bitstamp");
  assert.match(label, /Candles: Bitstamp XRP\/USD \(CEX\)/);
  assert.match(label, /Book: XRPL XRP\/RLUSD/);
  assert.equal(label.includes("\u2014"), false);
  assert.equal(label.includes("\u2013"), false);
  assert.equal(serverLabel("bitstamp"), label);
});

test("resolveCexFetchPlan maps short TFs to Bitstamp steps", () => {
  assert.equal(resolveCexFetchPlan("15m").stepSec, 900);
  assert.equal(resolveCexFetchPlan("5m").stepSec, 300);
  assert.equal(resolveCexFetchPlan("1h").stepSec, 3600);
  assert.equal(resolveCexFetchPlan("1D").stepSec, 86400);
  assert.equal(resolveCexFetchPlan("1W").fetchId, "1D");
});

test("composePairCandles prefers CEX tape for XRP/RLUSD and skips daily expand flats", () => {
  const step = 900_000;
  const start = Date.parse("2026-09-11T10:00:00.000Z");
  const cex = Array.from({ length: 32 }, (_, index) => {
    const t = start + index * step;
    const o = 1.2 + index * 0.001;
    const c = o + 0.0004;
    return { t, o, h: c + 0.0008, l: o - 0.0005, c, v: 1000 + index, source: "bitstamp" };
  });
  const candles = composePairCandles({
    pair: "XRP/RLUSD",
    interval: "15m",
    range: "Max",
    locked: { pairs: {}, xrpUsd: [{ t: start, o: 1, h: 1, l: 1, c: 1, v: 1 }] },
    cexCandles: cex,
    livePrice: 9.99,
    now: start + 40 * step,
    windowed: false,
  });
  assert.ok(candles.length >= 30);
  assert.ok(candles.every((row) => Number(row.c) < 2));
  assert.ok(candles.some((row) => row.source === "bitstamp"));
  const bodies = candles.filter((row) => Math.abs(row.c - row.o) > 1e-9);
  assert.ok(bodies.length > 10, "expected real CEX bodies, not flat carries");
});

test("XRP/RLUSD short TF without CEX does not invent dense session flats", () => {
  const day = Date.parse("2026-09-01T00:00:00.000Z");
  const candles = composePairCandles({
    pair: "XRP/RLUSD",
    interval: "15m",
    range: "Max",
    locked: {
      pairs: {},
      xrpUsd: [
        { t: day, o: 1.1, h: 1.2, l: 1.0, c: 1.15, v: 10, source: "yahoo-xrp-usd" },
        { t: day + 86_400_000, o: 1.15, h: 1.25, l: 1.1, c: 1.2, v: 12, source: "yahoo-xrp-usd" },
      ],
    },
    cexCandles: [],
    now: day + 2 * 86_400_000,
    windowed: false,
  });
  assert.ok(candles.length < 40, "expected coarse daily fallback, got " + candles.length);
});

test("normalizeCexCandles and default limits stay sane", () => {
  const rows = normalizeCexCandles(
    [{ t: 1_700_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 3, source: "bitstamp" }],
    "1h"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "bitstamp");
  assert.ok(defaultCexLimit("15m") >= 500);
  assert.ok(defaultCexLimit("1h") >= 2000);
});
