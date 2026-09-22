import test from "node:test";
import assert from "node:assert/strict";
import {ticksToCandles, sma, ema, wma, smma, vwma, movingAverage, averagesForWindow, interpolateAverage, seedSeriesForAverages, candleBodyBox, candleBodyWidth, appendLiveClose, resampleCandles, fillDailyGaps, candlesFromMarketData, expandDailyToInterval, clampPanOffset, clampVisibleBars, FUTURE_BARS_MIN, futureBarLimit, futureBarsFromPan, liveSeriesGrew, panAfterZoom, wheelPanSteps, wheelZoomSteps, windowBars, windowLastBars, zoomVisibleBars, clipCandleWicks, wickClipOptions, wickClipPairDefaults} from "../src/chart/candles.js";
import {bucketTime, CHART_PAIRS, DEFAULT_INTERVAL, visibleBarsForInterval} from "../src/chart/intervals.js";
import {backdateRlusdCandle, orientQuotePrice, quotePerXio, stitchRlusdCandles} from "../src/chart/pairQuote.js";
import {ammImpact, ammSupportResistanceRibbon, arbitrageWindow, clampPriceZoom, heatmapDots, liquidityPressure, liquidityWalls, percentile, scalePriceView, shiftAfterPriceZoom, smartView, zoomPriceScale} from "../src/chart/overlays.js";
import {walletChartMarks} from "../src/chart/walletMarks.js";
import {composePairCandles, lockedSnapshot} from "../src/chart/composeChart.js";
import {boxPriceHeight, fullViewPriceHeight} from "../src/chart/fullView.js";
import {axisLabelX, barSlots, clientToSvg, equalGrid, formatAxisPrice, formatAxisTime, formatCursorWhen, formatPriceLabel, priceLabelWidth, priceTicks, timeTagOrigin, timeTagWidth, timeTicks} from "../src/chart/axis.js";
import {extendMaPoints, maCurvePoints, maPath, maRevealState, rsi, rsiForWindow, volumeWaveValues, wavePath} from "../src/chart/indicators.js";
import {applyPlaceOffset, canMoveHandle, clickIsPan, drawingHandles, drawingStyle, elliottTools, fibBands, fibExtent, fibExtensionBands, fibLabelPlacement, fibToolLabelPlacement, fibPrice, flyoutSections, PLACE_OFFSET, drawingToolbarAnchor, hitDrawingBody, hitDrawingHandle, hitPlacedDrawing, moveDrawingHandle, patchDrawingStyle, nextDrawingState, pitchforkRays, plotX, plotY, previewDrawing, raySegment, RANGE_DOWN, RANGE_UP, rangeColor, rangeStats, shouldFollowCrosshair, snapPoint, toggleInspect, toggleTool, toolAfterDrawing, TOOL_GROUPS, toolMeta} from "../src/chart/drawings.js";

test("CHART_PAIRS includes XRP/RLUSD hybrid pair", () => {
  assert.deepEqual(CHART_PAIRS, ["XIO/RLUSD", "XIO/XRP", "XRP/RLUSD", "XIO/XDX"]);
});

test("bucketTime uses UTC midnight and Monday weeks", () => {
  assert.equal(bucketTime(Date.parse("2021-10-24T13:31:20.000Z"), "1D"), Date.parse("2021-10-24T00:00:00.000Z"));
  assert.equal(bucketTime(Date.parse("2021-10-24T13:31:20.000Z"), "1W"), Date.parse("2021-10-18T00:00:00.000Z"));
  assert.equal(bucketTime(Date.parse("2026-08-22T13:00:00.000Z"), "1M"), Date.parse("2026-08-01T00:00:00.000Z"));
  assert.equal(bucketTime(Date.parse("2026-08-22T13:31:00.000Z"), "1h"), Date.parse("2026-08-22T13:00:00.000Z"));
  assert.equal(DEFAULT_INTERVAL, "12h");
});

test("ticksToCandles builds exact OHLC and continuous opens", () => {
  const day = Date.parse("2021-10-24T00:00:00.000Z");
  const candles = ticksToCandles(
    [
      { t: day + 3600_000, p: 0.00004, v: 10 },
      { t: day + 7200_000, p: 0.00006, v: 5 },
      { t: day + 86_400_000 + 1000, p: 0.00005, v: 2 },
    ],
    "1D",
    { continuous: true }
  );
  assert.equal(candles.length, 2);
  assert.equal(candles[0].o, 0.00004);
  assert.equal(candles[0].h, 0.00006);
  assert.equal(candles[0].l, 0.00004);
  assert.equal(candles[0].c, 0.00006);
  assert.equal(candles[0].v, 15);
  assert.equal(candles[1].o, 0.00006);
  assert.equal(candles[1].c, 0.00005);
});

test("fillDailyGaps carries the previous close so every UTC day has a candle", () => {
  const start = Date.parse("2021-11-10T00:00:00.000Z");
  const filled = fillDailyGaps(
    [
      { t: start, o: 1, h: 1, l: 1, c: 1, v: 3 },
      { t: start + 2 * 86_400_000, o: 2, h: 2, l: 2, c: 2, v: 1 },
    ],
    start,
    start + 2 * 86_400_000
  );
  assert.equal(filled.length, 3);
  assert.equal(filled[1].c, 1);
  assert.equal(filled[1].v, 0);
  assert.equal(filled[1].source, "carry");
  assert.equal(filled[2].c, 2);
});

test("candlesFromMarketData reads InFTF open/high/low/close/volume", () => {
  const rows = candlesFromMarketData([
    {
      timestamp: "2021-11-10T00:00:00.000Z",
      open: 0.001,
      high: 0.002,
      low: 0.0009,
      close: 0.0015,
      base_volume: 3000,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].o, 0.001);
  assert.equal(rows[0].h, 0.002);
  assert.equal(rows[0].l, 0.0009);
  assert.equal(rows[0].c, 0.0015);
  assert.equal(rows[0].v, 3000);
});

test("sma is the arithmetic mean of the last N closes", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
});

test("ema wma smma and vwma cover the moving-average set", () => {
  const ema3 = ema([1, 2, 3, 4], 3);
  assert.equal(ema3[0], null);
  assert.equal(ema3[2], 2);
  assert.ok(Math.abs(ema3[3] - 3) < 1e-12);
  assert.deepEqual(wma([1, 2, 3], 3), [null, null, (1 * 1 + 2 * 2 + 3 * 3) / 6]);
  const smooth = smma([1, 2, 3, 4], 3);
  assert.equal(smooth[2], 2);
  assert.equal(smooth[3], (2 * 2 + 4) / 3);
  assert.deepEqual(vwma([1, 2, 3], [1, 1, 4], 3), [null, null, (1 + 2 + 12) / 6]);
  assert.deepEqual(movingAverage("sma", [1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
});

test("averagesForWindow uses full history so a 200 SMA covers the visible month", () => {
  const series = Array.from({ length: 250 }, (_, index) => ({
    t: index * 86_400_000,
    c: 1 + index / 100,
    v: 10,
  }));
  const visible = series.slice(-30);
  const [sma200] = averagesForWindow({
    series,
    visible,
    type: "sma",
    periods: [200],
  });
  assert.equal(sma200.values.length, 30);
  assert.ok(sma200.values.every((value) => Number.isFinite(value)));
});

test("rsi uses Wilder averages and maps onto the visible window", () => {
  const values = rsi([10, 12, 11, 13], 2);
  assert.equal(values[0], null);
  assert.equal(values[1], null);
  assert.ok(Math.abs(values[2] - 200 / 3) < 1e-12);
  const series = Array.from({ length: 40 }, (_, index) => ({
    t: index * 86_400_000,
    c: 1 + index / 10,
  }));
  const visible = series.slice(-8);
  const windowed = rsiForWindow({ series, visible, period: 14 });
  assert.equal(windowed.length, 8);
  assert.ok(windowed.every((value) => Number.isFinite(value)));
  assert.ok(windowed.every((value) => value > 70));
});

test("maPath stays between sample prices so a slow 200 MA cannot spike vertically", () => {
  const points = [
    { x: 0, y: 100 },
    { x: 40, y: 98 },
    { x: 80, y: 97 },
    { x: 200, y: 96 },
    { x: 400, y: 95 },
    { x: 400, y: 10 },
  ];
  const d = maPath(points);
  const ys = [...d.matchAll(/[\d.-]+/g)].map((row) => Number(row[0])).filter((_, index) => index % 2 === 1);
  assert.ok(ys.length > 4);
  assert.ok(ys.every((value) => value >= 94.9 && value <= 100.1));
  assert.equal(d.includes("L400 10"), false);
});

test("extendMaPoints pins a high 200 MA to the plot top and continues to the right edge", () => {
  const out = extendMaPoints(
    [
      { x: 100, y: -40 },
      { x: 400, y: 80 },
    ],
    { right: 858, top: 16, bottom: 364 }
  );
  assert.equal(out[0].y, 16);
  assert.equal(out[out.length - 1].x, 858);
  assert.equal(out[out.length - 1].y, 80);
});

test("maRevealState keeps a new MA unmounted until the glow is armed", () => {
  const seen = new Set();
  assert.equal(maRevealState("sma-9", { seen, armed: [] }), "wait");
  assert.equal(maRevealState("sma-9", { seen, armed: ["sma-9"] }), "drawing");
  seen.add("sma-9");
  assert.equal(maRevealState("sma-9", { seen, armed: ["sma-9"] }), "drawing");
  assert.equal(maRevealState("sma-9", { seen, armed: [] }), "ready");
  assert.equal(maRevealState("sma-50", { seen: ["sma-50"], armed: [] }), "ready");
});

test("maCurvePoints keeps value changes so the line can curve instead of stair-step", () => {
  const candles = [
    { t: 1 },
    { t: 2 },
    { t: 3 },
    { t: 4 },
    { t: 5 },
  ];
  const points = maCurvePoints(candles, [1, 1, 1, 2, 3]);
  assert.deepEqual(points.map((row) => row.v), [1, 1, 2, 3]);
  assert.equal(points[0].t, 1);
  assert.equal(points[1].t, 3);
  assert.equal(points[points.length - 1].t, 5);
});

test("averages skip carry flats and ease between real closes", () => {
  const series = [
    { t: 0, c: 10, v: 1, source: "locked" },
    { t: 1, c: 10, v: 0, source: "carry" },
    { t: 2, c: 10, v: 0, source: "carry" },
    { t: 3, c: 12, v: 1, source: "locked" },
    { t: 4, c: 12, v: 0, source: "carry" },
    { t: 5, c: 14, v: 1, source: "locked" },
  ];
  assert.deepEqual(
    seedSeriesForAverages(series).map((row) => row.t),
    [0, 3, 5]
  );
  assert.equal(interpolateAverage([{ t: 0, v: 10 }, { t: 4, v: 14 }], 2), 12);
  const [sma] = averagesForWindow({
    series,
    visible: series,
    type: "sma",
    periods: [2],
  });
  assert.equal(sma.values[0], null);
  assert.equal(sma.values[1], null);
  assert.equal(sma.values[2], null);
  assert.equal(sma.values[3], 11);
  assert.ok(sma.values[4] > 11 && sma.values[4] < 13);
  assert.equal(sma.values[5], 13);
});

test("volume wave spreads a daily print and stays a curve, not a spike", () => {
  const day = Date.parse("2026-08-21T00:00:00.000Z");
  const hour = 3_600_000;
  const candles = [
    { t: day, o: 1, h: 1.1, l: 0.9, c: 1.05, v: 24 },
    { t: day + hour, o: 1.05, h: 1.05, l: 1.05, c: 1.05, v: 0 },
    { t: day + 2 * hour, o: 1.05, h: 1.05, l: 1.05, c: 1.04, v: 0 },
  ];
  const wave = volumeWaveValues(candles, { smooth: 3 });
  assert.equal(wave.length, 3);
  assert.ok(wave.every((value) => value > 0));
  assert.ok(Math.max(...wave) / Math.min(...wave) < 3);
  const path = wavePath([
    { x: 0, y: 10 },
    { x: 10, y: 4 },
    { x: 20, y: 8 },
  ]);
  assert.match(path, /^M0 10/);
  assert.match(path, /C/);
});

test("candle bodies sit in equal slots so short timeframes stay side by side", () => {
  const hour = 3_600_000;
  const bars = Array.from({ length: 40 }, (_, index) => ({ t: index * hour }));
  const innerW = 858;
  const width = candleBodyWidth({
    innerW,
    candles: bars,
    start: bars[0].t,
    end: bars[39].t,
    stepMs: hour,
  });
  const slot = innerW / 40;
  assert.ok(width > 1.3);
  assert.ok(width < slot * 0.6);
  assert.equal(visibleBarsForInterval("15m"), 96);
  const padded = candleBodyWidth({
    innerW,
    candles: bars,
    start: bars[0].t,
    end: bars[39].t + 20 * hour,
    stepMs: hour,
    extra: 20,
  });
  assert.ok(Number.isFinite(padded));
  assert.ok(padded > 0);
  assert.ok(padded <= width);
  assert.doesNotThrow(() => candleBodyWidth({ innerW, candles: [], extra: 48 }));
  assert.ok(Number.isFinite(candleBodyWidth({ innerW, candles: [], extra: 48 })));
});

test("hollow candle boxes keep the slot width so packed 15m bars do not merge", () => {
  const solid = candleBodyBox({ width: 3.2, height: 1.2, hollow: false });
  const hollow = candleBodyBox({ width: 3.2, height: 1.2, hollow: true });
  assert.equal(solid.width, 3.2);
  assert.equal(hollow.width, 3.2);
  assert.ok(hollow.height >= 2.2);
});

test("expandDailyToInterval carries the daily candle into an afternoon 1m window", () => {
  const day = Date.parse("2026-09-22T00:00:00.000Z");
  const from = day + 15 * 3_600_000;
  const expanded = expandDailyToInterval(
    [{ t: day, o: 20, h: 22, l: 19, c: 21, v: 4 }],
    "1m",
    from,
    from + 30 * 60_000
  );
  assert.ok(expanded.length >= 30, `afternoon 1m window collapsed to ${expanded.length}`);
  assert.ok(expanded.every((row) => row.c > 0));
});

test("expandDailyToInterval builds 1H buckets and windowLastBars keeps the tail", () => {
  const day = Date.parse("2026-08-21T00:00:00.000Z");
  const expanded = expandDailyToInterval(
    [{ t: day, o: 1, h: 2, l: 0.5, c: 1.5, v: 4 }],
    "1h",
    day,
    day + 5 * 3_600_000
  );
  assert.equal(expanded.length, 6);
  assert.ok(expanded[1].c !== expanded[1].o);
  assert.equal(expanded[1].source, "session");
  assert.equal(windowLastBars(expanded, 2).length, 2);
  assert.equal(windowLastBars(expanded, 2)[0].t, expanded[4].t);
  const panned = windowBars(expanded, { bars: 2, offset: 2 });
  assert.equal(panned.length, 2);
  assert.equal(panned[0].t, expanded[2].t);
  assert.equal(panned[1].t, expanded[3].t);
  assert.equal(clampPanOffset(80, expanded.length, 2), 4);
  assert.equal(clampPanOffset(-10, 100, 20), -10);
  assert.equal(clampPanOffset(-400, 100, 20), -futureBarLimit(20));
  assert.equal(clampPanOffset(-5, 100, 20, 3), -3);
  assert.equal(futureBarsFromPan(-24), 24);
  assert.equal(futureBarsFromPan(8), 0);
  assert.ok(futureBarLimit(280) >= FUTURE_BARS_MIN);
  const latest = windowBars(expanded, { bars: 2, offset: -8 });
  assert.equal(latest.length, 2);
  assert.equal(latest[0].t, expanded[4].t);
  assert.equal(latest[1].t, expanded[5].t);
  const heldFuture = panAfterZoom({
    total: 400,
    oldVisible: 100,
    newVisible: 50,
    oldPan: -20,
    anchorRatio: 1,
  });
  assert.equal(heldFuture, -20);
  assert.ok(Number.isFinite(clampPanOffset(Number.NaN, 100, 20)));
  assert.ok(Number.isFinite(clampPanOffset(Number.POSITIVE_INFINITY, 100, 20)));
  assert.ok(
    Number.isFinite(
      panAfterZoom({
        total: 400,
        oldVisible: 100,
        newVisible: 50,
        oldPan: -20,
        anchorRatio: Number.NaN,
      })
    )
  );
  assert.equal(wheelPanSteps(40, 0, 0, 36).steps, 1);
  assert.equal(wheelPanSteps(0, -40, 0, 36).steps, -1);
  assert.equal(wheelZoomSteps(80, 0, 56).steps, 1);
  assert.equal(wheelZoomSteps(-80, 0, 56).steps, -1);
  assert.equal(wheelZoomSteps(400, 0, 56).steps, 1);
  assert.equal(liveSeriesGrew({ prevLen: 100, prevHead: 10, nextLen: 101, nextHead: 10 }), true);
  assert.equal(liveSeriesGrew({ prevLen: 100, prevHead: 10, nextLen: 400, nextHead: 1 }), false);
  assert.ok(zoomVisibleBars(280, 1) < 280);
  assert.ok(zoomVisibleBars(280, -1) > 280);
  assert.equal(clampPriceZoom(0), 1);
  assert.ok(zoomPriceScale(1, 1) < 1);
  assert.ok(zoomPriceScale(1, -1) > 1);
  const priced = scalePriceView({ start: 1, end: 2, min: 1, max: 3 }, { zoom: 0.5, shift: 0 });
  assert.ok(priced.max - priced.min < 2);
  const held = shiftAfterPriceZoom({
    view: { min: 0, max: 10 },
    oldZoom: 1,
    newZoom: 0.5,
    anchorPrice: 8,
    oldShift: 0,
  });
  const after = scalePriceView({ min: 0, max: 10 }, { zoom: 0.5, shift: held });
  assert.ok(Math.abs(after.max - (after.max - after.min) * ((10 - 8) / 10) - 8) < 1e-9);
  assert.equal(clampVisibleBars(8), 24);
  const kept = panAfterZoom({
    total: 400,
    oldVisible: 100,
    newVisible: 200,
    oldPan: 0,
    anchorRatio: 1,
  });
  assert.equal(kept, 0);
  const centered = panAfterZoom({
    total: 400,
    oldVisible: 100,
    newVisible: 50,
    oldPan: 50,
    anchorRatio: 0.5,
  });
  assert.equal(centered, 75);
  const slots = barSlots(expanded, { left: 0, width: 600 });
  assert.ok(Math.abs(slots.x(expanded[1].t) - slots.x(expanded[0].t) - slots.slot) < 1e-6);
  for (const x of [30, 150, 300, 570]) {
    assert.ok(Math.abs(slots.x(slots.tAt(x)) - x) < 1e-6);
  }
  const padded = barSlots(expanded, { left: 0, width: 600, extra: 4 });
  const lastX = padded.x(expanded[expanded.length - 1].t);
  assert.ok(lastX < 600 - padded.slot);
  assert.ok(padded.tAt(580) > expanded[expanded.length - 1].t);
  assert.ok(Math.abs(padded.x(padded.tAt(540)) - 540) < 1e-6);
  assert.ok(padded.last > expanded[expanded.length - 1].t);
  const scale = { x: () => 40, y: () => 80, viewKey: "v1" };
  assert.equal(plotX({ t: 1, x: 220, viewKey: "v1" }, scale), 220);
  assert.equal(plotY({ price: 2, y: 90, viewKey: "v1" }, scale), 90);
  assert.equal(plotX({ t: 1, x: 220, viewKey: "v2" }, scale), 40);
  const start = nextDrawingState({
    tool: "rect",
    color: "#3d8bff",
    pending: null,
    point: { t: 1, price: 2, x: 120, y: 40, viewKey: "v1" },
  });
  const done = nextDrawingState({
    tool: "rect",
    color: "#3d8bff",
    pending: start.pending,
    point: { t: 5, price: 8, x: 260, y: 90, viewKey: "v1" },
  });
  assert.equal(done.drawing.a.x, 120);
  assert.equal(done.drawing.b.x, 260);
  assert.equal(plotX(done.drawing.a, scale), 120);
});

test("XIO/RLUSD backdate is XIO/XRP times that day's XRP/USD", () => {
  const candle = { t: Date.parse("2021-10-24T00:00:00.000Z"), o: 0.00002, h: 0.00003, l: 0.00001, c: 0.00002, v: 1 };
  const rlusd = backdateRlusdCandle(candle, 1.1);
  assert.ok(Math.abs(rlusd.c - 0.000022) < 1e-12);
  assert.equal(rlusd.source, "backdated");
  assert.ok(Math.abs(quotePerXio({ pair: "XIO/RLUSD", xioXrp: 0.00002, xrpUsd: 1.1 }) - 0.000022) < 1e-12);
  assert.ok(Math.abs(quotePerXio({ pair: "XIO/XRP", xioUsd: 0.000044, xrpUsd: 1.1 }) - 0.00004) < 1e-12);
  assert.ok(Math.abs(quotePerXio({ pair: "XRP/RLUSD", xrpRlusd: 2.5 }) - 2.5) < 1e-12);
  assert.ok(Math.abs(quotePerXio({ pair: "XRP/RLUSD", xrpUsd: 1.1 }) - 1.1) < 1e-12);
});

test("composePairCandles builds XRP/RLUSD from locked XRP/USD when native candles are absent", () => {
  const t = Date.parse("2021-10-24T00:00:00.000Z");
  const candles = composePairCandles({
    pair: "XRP/RLUSD",
    interval: "1D",
    range: "Max",
    locked: {
      pairs: {},
      xrpUsd: [{ t, o: 1.0, h: 1.2, l: 0.9, c: 1.1, v: 10, source: "yahoo-xrp-usd" }],
    },
    sparkline: [{ timestamp: "2021-10-24T12:00:00.000Z", price_usd: 999 }],
    trades: [{ timestamp: "2021-10-24T12:00:00.000Z", price: 999, pool: "XIO/XRP" }],
    livePrice: 1.15,
    now: t + 3_600_000,
    windowed: false,
  });
  assert.ok(candles.length >= 1);
  assert.equal(candles[0].c, 1.15);
  assert.ok(candles.every((row) => Number(row.c) < 10));
});

test("stitchRlusdCandles prefers native AMM prints after RLUSD exists", () => {
  const t = Date.parse("2025-01-01T00:00:00.000Z");
  const rows = stitchRlusdCandles({
    xrpCandles: [{ t, o: 0.00002, h: 0.00002, l: 0.00002, c: 0.00002, v: 1 }],
    xrpUsd: [{ t, c: 2 }],
    native: [{ t, o: 0.00005, h: 0.00005, l: 0.00005, c: 0.00005, v: 3, source: "native" }],
  });
  assert.equal(rows[0].c, 0.00005);
  assert.equal(rows[0].source, "native");
});

test("arbitrage window is (mid - AMM) / AMM", () => {
  const row = arbitrageWindow(0.00003129, 0.00003459);
  assert.ok(Math.abs(row.pct - 10.5465) < 0.01);
  assert.equal(row.highlight, true);
});

test("AMM buy impact follows constant product", () => {
  const impact = ammImpact({ reserveBase: 1000, reserveQuote: 10, amount: 100, side: "buy" });
  assert.equal(impact.spot, 0.01);
  assert.ok(impact.next > impact.spot);
  assert.equal(ammImpact({ reserveBase: 1000, reserveQuote: 10, amount: 100, side: "addLp" }).impactPct, 0);
});

test("liquidity walls keep levels at least 2x the median size", () => {
  const walls = liquidityWalls({
    bids: [{ price: 1, base_size: 10, side: "bid" }],
    asks: [
      { price: 2, base_size: 10, side: "ask" },
      { price: 3, base_size: 50, side: "ask" },
    ],
  });
  assert.equal(walls.length, 1);
  assert.equal(walls[0].price, 3);
});

test("wallet marks stay empty until an address is signed in", () => {
  const hidden = walletChartMarks({
    address: "",
    orders: [{ price: 1, amount: 2, pair: "XIO/XRP" }],
    fills: [{ account: "rA", timestamp: "2021-10-24T13:31:20.000Z", price: 1, pool: "XIO/XRP" }],
    pair: "XIO/XRP",
  });
  assert.deepEqual(hidden, { orders: [], fills: [] });
  const shown = walletChartMarks({
    address: "rA",
    orders: [{ price: 0.00003, amount: 5, pair: "XIO/XRP", side: "bid" }],
    fills: [{ account: "rA", timestamp: "2021-10-24T13:31:20.000Z", price: 0.00003, pool: "XIO/XRP" }],
    pair: "XIO/XRP",
  });
  assert.equal(shown.orders.length, 1);
  assert.equal(shown.fills.length, 1);
});

test("pressure is down when the AMM holds more XIO than quote", () => {
  assert.equal(liquidityPressure({ xioPct: 77.6, quotePct: 22.4 }).bias, "down");
  assert.equal(liquidityPressure({ xioPct: 22.4, quotePct: 77.6 }).bias, "up");
});

test("composePairCandles appends a live close onto locked history", () => {
  const t = Date.parse("2021-10-24T00:00:00.000Z");
  const candles = composePairCandles({
    pair: "XIO/XRP",
    interval: "1D",
    range: "Max",
    locked: {
      pairs: { "XIO/XRP": { candles: [{ t, o: 0.00002, h: 0.00002, l: 0.00002, c: 0.00002, v: 1 }] } },
      xrpUsd: [],
    },
    livePrice: 0.0000313,
    now: Date.parse("2026-08-22T00:00:00.000Z"),
  });
  assert.ok(candles.length >= 2);
  assert.equal(candles[candles.length - 1].c, 0.0000313);
});

test("resampleCandles weekly uses Monday buckets", () => {
  const rows = [
    { t: Date.parse("2021-10-18T00:00:00.000Z"), o: 1, h: 2, l: 1, c: 1.5, v: 1 },
    { t: Date.parse("2021-10-20T00:00:00.000Z"), o: 1.5, h: 3, l: 1.2, c: 2, v: 2 },
  ];
  const week = resampleCandles(rows, "1W");
  assert.equal(week.length, 1);
  assert.equal(week[0].o, 1);
  assert.equal(week[0].h, 3);
  assert.equal(week[0].c, 2);
  assert.equal(week[0].v, 3);
});

test("locked XIO/RLUSD daily history paints one candle per UTC day on 1M", () => {
  const lock = lockedSnapshot();
  const xrp = lock.pairs?.["XIO/XRP"]?.candles || [];
  const rlusd = lock.pairs?.["XIO/RLUSD"]?.candles || [];
  assert.ok(xrp.length > 365, `expected locked XIO/XRP history, got ${xrp.length}`);
  assert.ok(rlusd.length > 365, `expected locked XIO/RLUSD history, got ${rlusd.length}`);
  assert.equal(new Date(xrp[0].t).toISOString().slice(0, 10), "2021-11-10");
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const month = composePairCandles({
    pair: "XIO/RLUSD",
    interval: "1D",
    range: "1M",
    locked: lock,
    now,
  });
  assert.equal(month.length, 30);
  assert.equal(new Date(month[0].t).toISOString().slice(0, 10), "2026-07-24");
  assert.equal(new Date(month[month.length - 1].t).toISOString().slice(0, 10), "2026-08-22");
  const uniqueDays = new Set(month.map((row) => row.t));
  assert.equal(uniqueDays.size, 30);
});

test("priceTicks and timeTicks fill left and bottom chart scales", () => {
  const prices = priceTicks(0.00001214, 0.00025542, 6);
  assert.ok(prices.length >= 4 && prices.length <= 8);
  assert.ok(prices[0] >= 0.00001214);
  assert.ok(prices[prices.length - 1] <= 0.00025542);
  assert.match(formatAxisPrice(0.00004538), /^0\.000045/);
  const mapped = clientToSvg(
    { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }) },
    60,
    45,
    960,
    480
  );
  assert.equal(mapped.x, 480);
  assert.equal(mapped.y, 240);
  assert.equal(formatPriceLabel(0.000034), "0.000034");
  assert.equal(formatPriceLabel(0.00003462), "0.000035");

  const start = Date.parse("2026-07-24T00:00:00.000Z");
  const end = Date.parse("2026-08-22T00:00:00.000Z");
  const stamps = timeTicks(start, end, { count: 6, intervalId: "1D" });
  assert.ok(stamps.length >= 4 && stamps.length <= 10);
  assert.ok(stamps.every((stamp) => stamp >= start && stamp <= end));
  assert.equal(formatAxisTime(start, { spanMs: end - start, intervalId: "1D", locale: "en-GB" }), "24 Jul");
  assert.match(formatCursorWhen(start, "en-GB"), /24 Jul 2026/);
  assert.match(formatCursorWhen(start, "en-GB"), /00:00/);
});

test("chart time labels stay middle-anchored and the tag border is centered", () => {
  assert.equal(axisLabelX(10, { min: 20, max: 80 }), 20);
  assert.equal(axisLabelX(90, { min: 20, max: 80 }), 80);
  assert.equal(axisLabelX(50, { min: 20, max: 80 }), 50);
  const wide = timeTagWidth("24 Aug 2026, 13:31");
  const box = timeTagOrigin(200, wide, { left: 84, right: 942 });
  assert.equal(box.textX, wide / 2);
  assert.equal(box.x + box.width / 2, 200);
  const edge = timeTagOrigin(90, 108, { left: 84, right: 942 });
  assert.equal(edge.x, 84);
  assert.equal(edge.textX, 54);
});


test("formatAxisPrice uses nice round labels by magnitude", () => {
  assert.equal(formatAxisPrice(1), "1");
  assert.equal(formatAxisPrice(1.2), "1.2");
  assert.equal(formatAxisPrice(1.25), "1.25");
  assert.equal(formatAxisPrice(100), "100");
  assert.equal(formatAxisPrice(125.5), "125.5");
  assert.equal(formatAxisPrice(1000), "1000");
  assert.equal(formatAxisPrice(125000), "125000");
  assert.ok(priceLabelWidth("1.2") >= 28);
  assert.ok(priceLabelWidth("125000") > priceLabelWidth("1"));
});

test("equalGrid spaces time and price lines the same on every timeframe", () => {
  assert.deepEqual(equalGrid(4, 0, 100), [0, 25, 50, 75, 100]);
  const cols = equalGrid(8, 84, 800);
  assert.equal(cols.length, 9);
  assert.equal(cols[0], 84);
  assert.equal(cols[8], 884);
  const gap = cols[1] - cols[0];
  for (let i = 1; i < cols.length; i += 1) {
    assert.equal(cols[i] - cols[i - 1], gap);
  }
});

test("tool place mark sits up and right of the mouse so the pointer is not on the drop", () => {
  const at = applyPlaceOffset(
    { x: 200, y: 120 },
    { tool: "trend", pad: { l: 84, r: 18, t: 16 }, width: 960, plotBottom: 364 }
  );
  assert.equal(at.x, 200 + PLACE_OFFSET.x);
  assert.equal(at.y, 120 + PLACE_OFFSET.y);
  assert.ok(at.x > 200);
  assert.ok(at.y < 120);
  assert.equal(applyPlaceOffset({ x: 200, y: 120 }, { tool: "cursor" }).x, 200);
});

test("drawing tools trail from the first drop to the hover point", () => {
  const start = { t: 100, price: 2 };
  const hover = { t: 400, price: 5 };
  const first = nextDrawingState({ tool: "trend", color: "#ff5d73", pending: null, point: start });
  assert.equal(first.pending.points.length, 1);
  assert.equal(first.drawing, null);
  const ghost = previewDrawing({ tool: "trend", color: "#ff5d73", pending: first.pending, hover });
  assert.equal(ghost.kind, "trend");
  assert.equal(ghost.preview, true);
  assert.equal(ghost.a.t, 100);
  assert.equal(ghost.b.t, 400);
  assert.equal(ghost.color, "#ff5d73");
  const done = nextDrawingState({ tool: "trend", color: "#ff5d73", pending: first.pending, point: hover });
  assert.equal(done.pending, null);
  assert.equal(done.drawing.kind, "trend");
  assert.equal(done.drawing.b.price, 5);
});

test("selected draw color stays on the H-line and ray", () => {
  const hline = nextDrawingState({
    tool: "hline",
    color: "#ff9a3c",
    pending: null,
    point: { t: 10, price: 0.4 },
  });
  assert.equal(hline.drawing.color, "#ff9a3c");
  const start = nextDrawingState({
    tool: "ray",
    color: "#ff9a3c",
    pending: null,
    point: { t: 10, price: 1 },
  });
  const ray = nextDrawingState({
    tool: "ray",
    color: "#ff9a3c",
    pending: start.pending,
    point: { t: 40, price: 2 },
  });
  assert.equal(ray.drawing.kind, "ray");
  assert.equal(ray.drawing.color, "#ff9a3c");
});

test("horizontal line trails under the cursor and drops on one click", () => {
  const ghost = previewDrawing({ tool: "hline", color: "#98f050", pending: null, hover: { t: 10, price: 0.4 } });
  assert.equal(ghost.kind, "hline");
  assert.equal(ghost.price, 0.4);
  const placed = nextDrawingState({ tool: "hline", color: "#98f050", pending: null, point: { t: 10, price: 0.4 } });
  assert.equal(placed.pending, null);
  assert.equal(placed.drawing.kind, "hline");
  assert.equal(placed.drawing.price, 0.4);
  assert.equal(toolMeta("hline").clicks, 1);
});

test("selecting a placed drawing exposes style edits and hit tests", () => {
  const scale = { x: (t) => t * 10, y: (p) => 200 - p, start: 0, end: 20, min: 0, max: 200 };
  const fib = nextDrawingState({
    tool: "fib",
    color: "#3d8bff",
    pending: { tool: "fib", color: "#3d8bff", points: [{ t: 2, price: 180 }] },
    point: { t: 12, price: 40 },
  }).drawing;
  assert.equal(hitDrawingBody(fib, scale, 70, 110), true);
  assert.equal(hitDrawingBody(fib, scale, 400, 10), false);
  const body = hitPlacedDrawing([fib], scale, 70, 110);
  assert.equal(body.index, 0);
  assert.equal(body.handle, false);
  const handle = hitPlacedDrawing([fib], scale, scale.x(12), scale.y(40));
  assert.equal(handle.handle, true);
  assert.equal(handle.key, "b");
  const styled = patchDrawingStyle(fib, { color: "#ff5d73", strokeWidth: 3, lineStyle: "dash" });
  assert.equal(styled.color, "#ff5d73");
  assert.equal(styled.strokeWidth, 3);
  assert.equal(styled.lineStyle, "dash");
  assert.equal(styled.dasharray, "7 4");
  const anchor = drawingToolbarAnchor(fib, scale, { pad: { t: 16 } });
  assert.ok(Number.isFinite(anchor.x));
  assert.ok(Number.isFinite(anchor.y));
  const line = nextDrawingState({
    tool: "trend",
    color: "#98f050",
    pending: { tool: "trend", color: "#98f050", points: [{ t: 1, price: 10 }] },
    point: { t: 8, price: 80 },
  }).drawing;
  assert.equal(hitDrawingBody(line, scale, 45, scale.y(45), { radius: 12 }), true);
  assert.equal(hitPlacedDrawing([line], scale, 400, 10), null);
});

test("placed drawings keep white handles that can be moved", () => {
  const line = nextDrawingState({
    tool: "trend",
    color: "#3d8bff",
    pending: { tool: "trend", color: "#3d8bff", points: [{ t: 10, price: 1 }] },
    point: { t: 40, price: 2 },
  }).drawing;
  const handles = drawingHandles(line);
  assert.equal(handles.length, 2);
  assert.equal(handles[0].key, "a");
  assert.equal(handles[1].key, "b");
  const moved = moveDrawingHandle(line, "b", { t: 80, price: 3 });
  assert.equal(moved.b.t, 80);
  assert.equal(moved.b.price, 3);
  assert.equal(moved.a.price, 1);
  const vline = nextDrawingState({ tool: "vline", color: "#fff", pending: null, point: { t: 12, price: 0.5 } }).drawing;
  assert.equal(drawingHandles(vline).length, 1);
  const scale = { x: (t) => t, y: (p) => p * 10, min: 0, max: 4 };
  const hit = hitDrawingHandle([line], scale, 40, 20);
  assert.equal(hit.key, "b");
  assert.equal(hitDrawingHandle([line], scale, 400, 200), null);
});

test("fib retracement uses TradingView level colors and click order", () => {
  const a = { t: 1, price: 100 };
  const b = { t: 5, price: 0 };
  assert.equal(fibPrice(a, b, 0), 0);
  assert.equal(fibPrice(a, b, 1), 100);
  assert.equal(fibPrice(a, b, 0.618), 61.8);
  const bands = fibBands(a, b);
  assert.equal(bands[0].color, "#808080");
  assert.equal(bands.find((row) => row.level === 0.5).color, "#4CAF50");
  assert.equal(bands.find((row) => row.level === 0.618).color, "#089981");
  assert.equal(bands.find((row) => row.level === 0.236).color, "#F23645");
  assert.equal(bands.find((row) => row.level === 0.786).color, "#00BCD4");
  assert.equal(bands.find((row) => row.level === 4.236)?.color, "#E91E63");
  assert.ok(bands.some((row) => row.level === 1.618 && row.label === "1.618"));
  assert.equal(bands.find((row) => row.level === 1.618).color, "#2962FF");
  assert.equal(bands.find((row) => row.level === 2.618).color, "#F23645");
  assert.ok(Math.abs(fibPrice(a, b, 4.236) - 423.6) < 1e-9);
  const first = nextDrawingState({ tool: "fib", color: "#3d8bff", pending: null, point: a });
  assert.equal(first.drawing, null);
  const ghost = previewDrawing({ tool: "fib", color: "#3d8bff", pending: first.pending, hover: b });
  assert.equal(ghost.kind, "fib");
  assert.equal(ghost.a.price, 100);
  assert.equal(ghost.b.price, 0);
  const span = fibExtent(a, b);
  assert.equal(span.t0, 1);
  assert.equal(span.t1, 5);
  assert.ok(span.t1 - span.t0 < 10);
  const rangeGhost = previewDrawing({
    tool: "range",
    color: "#3d8bff",
    pending: { tool: "range", color: "#3d8bff", points: [a] },
    hover: b,
  });
  assert.equal(rangeGhost.kind, "range");
  assert.equal(rangeGhost.a.t, a.t);
  assert.equal(rangeGhost.b.t, b.t);
  assert.equal(fibExtent(rangeGhost.a, rangeGhost.b).t0, span.t0);
  assert.equal(fibExtent(rangeGhost.a, rangeGhost.b).t1, span.t1);
});

test("draw style and extra City Index tools stay available from one toolbox", () => {
  assert.deepEqual(drawingStyle({ strokeWidth: 3, lineStyle: "dash" }), {
    strokeWidth: 3,
    lineStyle: "dash",
    dasharray: "7 4",
  });
  assert.equal(TOOL_GROUPS.find((group) => group.id === "lines").tools[0].id, "trend");
  assert.equal(toolMeta("crossline").clicks, 1);
  assert.equal(toolMeta("infoline").clicks, 2);
  assert.equal(toolMeta("fibext").clicks, 3);
  assert.equal(toolMeta("elliottimpulse").clicks, 5);
  assert.deepEqual(toolMeta("elliottimpulse").labels, ["1", "2", "3", "4", "5"]);
  assert.equal(toolMeta("elliottcorrection").clicks, 3);
  assert.deepEqual(
    elliottTools().map((row) => row.id),
    ["elliottimpulse", "elliottcorrection", "elliotttriangle", "elliottdouble", "elliotttriple"]
  );
  assert.deepEqual(
    flyoutSections("shapes").flatMap((section) => section.tools.map((row) => row.id)),
    ["rect", "ellipse", "circle", "triangle", "channel", "elliottimpulse", "elliottcorrection", "elliotttriangle", "elliottdouble", "elliotttriple"]
  );
  assert.equal(TOOL_GROUPS.find((group) => group.id === "shapes").labelKey, "chartPatterns");
  assert.equal(canMoveHandle("trend"), false);
  assert.equal(canMoveHandle("cursor"), true);
  assert.equal(shouldFollowCrosshair({ tool: "cursor", dragging: false, overHandle: false }), false);
  assert.equal(shouldFollowCrosshair({ tool: "cursor", dragging: false, overHandle: true }), true);
  assert.equal(shouldFollowCrosshair({ tool: "cursor", dragging: true, overHandle: false }), true);
  assert.equal(clickIsPan(100, 102), false);
  assert.equal(clickIsPan(100, 108), true);
  const pinned = toggleInspect(null, { t: 10, candle: { t: 10 } });
  assert.equal(pinned.t, 10);
  assert.equal(toggleInspect(pinned, { t: 10, candle: { t: 10 } }), null);
  assert.equal(toolAfterDrawing(true, "elliottimpulse"), "elliottimpulse");
  assert.equal(toolAfterDrawing(false, "elliottimpulse"), "cursor");
  assert.equal(toolAfterDrawing(false, "cursor"), "cursor");
  assert.equal(toolMeta("pitchfork").clicks, 3);
  const cross = nextDrawingState({
    tool: "crossline",
    color: "#ffe14a",
    pending: null,
    point: { t: 10, price: 0.4 },
    strokeWidth: 2,
    lineStyle: "dot",
  });
  assert.equal(cross.drawing.kind, "crossline");
  assert.equal(cross.drawing.strokeWidth, 2);
  assert.equal(cross.drawing.lineStyle, "dot");
  const a = { t: 1, price: 10 };
  const b = { t: 5, price: 20 };
  const c = { t: 8, price: 12 };
  const ext = fibExtensionBands(a, b, c);
  assert.equal(ext.find((row) => row.level === 1).price, 22);
  assert.ok(ext.some((row) => row.level === 1.618));
  const outside = fibToolLabelPlacement(200, 360, { padLeft: 88, gap: 12, textWidth: 78 });
  assert.equal(outside.textAnchor, "end");
  assert.ok(outside.x <= 200);
  const flipped = fibToolLabelPlacement(90, 140, { padLeft: 88, gap: 12, textWidth: 78 });
  assert.equal(flipped.textAnchor, "start");
  assert.ok(flipped.x >= 140);
  const extLabel = fibLabelPlacement(220, { side: "left", minX: 88 });
  assert.equal(extLabel.textAnchor, "end");
  assert.ok(extLabel.x <= 210);
  const fork = pitchforkRays(a, b, c, 0, 20);
  assert.equal(fork.length, 3);
  const triangle = nextDrawingState({
    tool: "triangle",
    color: "#3d8bff",
    pending: { tool: "triangle", color: "#3d8bff", points: [a, b] },
    point: c,
  });
  assert.equal(triangle.drawing.kind, "triangle");
  assert.equal(triangle.drawing.c.price, 12);
});

test("selecting the live tool again turns it off", () => {
  assert.equal(toggleTool("cursor", "trend"), "trend");
  assert.equal(toggleTool("trend", "trend"), "cursor");
  assert.equal(toggleTool("trend", "ray"), "ray");
  assert.equal(toggleTool("ray", "cursor"), "cursor");
  assert.equal(toggleTool("cursor", "cursor"), "none");
  assert.equal(toggleTool("none", "cursor"), "cursor");
  assert.equal(toggleTool("none", "none"), "none");
});

test("snapPoint locks to the nearest candle open high low or close", () => {
  const snapped = snapPoint(
    { t: 150, price: 1.8 },
    [
      { t: 100, o: 1, h: 2, l: 0.5, c: 1.2 },
      { t: 200, o: 3, h: 4, l: 2.5, c: 3.5 },
    ]
  );
  assert.equal(snapped.t, 100);
  assert.equal(snapped.price, 2);
  const future = snapPoint(
    { t: 360, price: 2.2 },
    [
      { t: 100, o: 1, h: 2, l: 0.5, c: 1.2 },
      { t: 200, o: 3, h: 4, l: 2.5, c: 3.5 },
    ]
  );
  assert.equal(future.t, 360);
  assert.equal(future.price, 2.2);
});

test("ray extends past the second point and range stats keep the percent move", () => {
  const [a, b] = raySegment({ t: 10, price: 1 }, { t: 20, price: 2 }, 0, 100);
  assert.equal(a.t, 10);
  assert.equal(b.t, 100);
  assert.equal(b.price, 10);
  const stats = rangeStats({ t: 0, price: 2 }, { t: 5, price: 3 });
  assert.equal(stats.delta, 1);
  assert.equal(stats.pct, 50);
  assert.equal(rangeColor({ t: 0, price: 2 }, { t: 5, price: 3 }), RANGE_UP);
  assert.equal(rangeColor({ t: 0, price: 3 }, { t: 5, price: 2 }), RANGE_DOWN);
  assert.equal(toolMeta("channel").clicks, 3);
});

test("full view plot height fills the leftover phone viewport after chrome and panes", () => {
  assert.equal(fullViewPriceHeight(800, { volume: true, rsi: true }), 484);
  assert.equal(fullViewPriceHeight(500, { volume: false, rsi: false }), 344);
  assert.equal(fullViewPriceHeight(200, { volume: true, rsi: true }), 240);
});

test("boxPriceHeight uses the measured plot wrap so the shared AIM chart fills leftover width", () => {
  assert.equal(boxPriceHeight(520, { volume: true, rsi: true }), 312);
  assert.equal(boxPriceHeight(400, { volume: false, rsi: false }), 348);
  assert.equal(boxPriceHeight(100, { volume: true, rsi: true }), 220);
});

test("appendLiveClose updates the current UTC day instead of inventing a second candle", () => {
  const t = Date.parse("2026-08-22T00:00:00.000Z");
  const next = appendLiveClose([{ t, o: 1, h: 1, l: 1, c: 1, v: 0 }], 1.5, t + 3600_000, "1D");
  assert.equal(next.length, 1);
  assert.equal(next[0].c, 1.5);
  assert.equal(next[0].h, 1.5);
});

test("clipCandleWicks keeps body and caps absurd high from thin print", () => {
  const rows = [
    { t: 1, o: 1, h: 1.02, l: 0.98, c: 1.01, v: 1 },
    { t: 2, o: 1.01, h: 1.03, l: 0.99, c: 1.02, v: 1 },
    { t: 3, o: 1.02, h: 1.04, l: 1.0, c: 1.03, v: 1 },
    { t: 4, o: 1.03, h: 1.05, l: 1.01, c: 1.04, v: 1 },
    { t: 5, o: 1.04, h: 500, l: 1.02, c: 1.05, v: 1 },
  ];
  const clipped = clipCandleWicks(rows);
  assert.equal(clipped[4].o, 1.04);
  assert.equal(clipped[4].c, 1.05);
  assert.ok(clipped[4].h < 10);
  assert.ok(clipped[4].h >= Math.max(1.04, 1.05));
  assert.ok(clipped[4].l <= Math.min(1.04, 1.05));
});

test("composePairCandles clips locked wick spikes for display", () => {
  const t = Date.parse("2021-11-18T00:00:00.000Z");
  const candles = composePairCandles({
    pair: "XIO/XRP",
    interval: "1D",
    range: "Max",
    locked: {
      pairs: {
        "XIO/XRP": {
          candles: [
            { t: t - 86_400_000, o: 0.02, h: 0.021, l: 0.019, c: 0.02, v: 1 },
            { t, o: 0.02, h: 1000, l: 0.019, c: 0.021, v: 1 },
            { t: t + 86_400_000, o: 0.021, h: 0.022, l: 0.02, c: 0.0215, v: 1 },
          ],
        },
      },
      xrpUsd: [],
    },
    sparkline: [],
    trades: [],
    livePrice: 0.0215,
    now: t + 86_400_000,
    windowed: false,
  });
  const spike = candles.find((row) => row.t === t);
  assert.ok(spike);
  assert.equal(spike.o, 0.02);
  assert.ok(spike.h < 1);
  assert.ok(spike.h >= Math.max(spike.o, spike.c));
});

test("clipCandleWicks caps absurd close from thin AMM print so scale stays sane", () => {
  const rows = [
    { t: 1, o: 0.02, h: 0.021, l: 0.019, c: 0.02, v: 1 },
    { t: 2, o: 0.02, h: 0.0215, l: 0.0195, c: 0.0205, v: 1 },
    { t: 3, o: 0.0205, h: 0.021, l: 0.02, c: 0.0208, v: 1 },
    { t: 4, o: 0.0208, h: 0.0212, l: 0.0202, c: 0.021, v: 1 },
    { t: 5, o: 20000, h: 20000, l: 20000, c: 20000, v: 0.01, source: "trade" },
  ];
  const clipped = clipCandleWicks(rows, wickClipOptions({ pair: "XIO/RLUSD" }));
  assert.ok(clipped[4].c < 1, `close should be clipped, got ${clipped[4].c}`);
  assert.ok(clipped[4].h < 1);
  assert.ok(clipped[4].o < 1);
  assert.equal(clipped[4].outlier, true);
  assert.equal(clipped[4].rawC, 20000);
  assert.equal(clipped.length, 5);
});

test("smartView robust domain ignores a single extreme high for y-scale", () => {
  const rows = [];
  const t0 = Date.parse("2026-09-01T00:00:00.000Z");
  for (let i = 0; i < 20; i += 1) {
    const c = 0.02 + i * 0.0001;
    rows.push({ t: t0 + i * 3600_000, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 });
  }
  rows.push({ t: t0 + 20 * 3600_000, o: 0.022, h: 20000, l: 0.021, c: 0.022, v: 1 });
  const view = smartView(rows, { rangeId: "Max", now: t0 + 20 * 3600_000, robust: true });
  assert.ok(view.max < 100, `robust max should stay near price, got ${view.max}`);
  assert.ok(view.max > view.min);
  assert.ok(percentile([1, 2, 3, 4, 5], 50) === 3);
});

test("wickClipPairDefaults tightens XIO vs CEX XRP/RLUSD", () => {
  const xio = wickClipPairDefaults("XIO/XRP");
  const cex = wickClipPairDefaults("XRP/RLUSD");
  assert.ok(xio.closeRatioCap < cex.closeRatioCap);
  assert.ok(xio.atrMult < cex.atrMult);
});

test("composePairCandles clips absurd close spike on XIO DEX tape", () => {
  const t = Date.parse("2021-11-18T00:00:00.000Z");
  const candles = composePairCandles({
    pair: "XIO/XRP",
    interval: "1D",
    range: "Max",
    locked: {
      pairs: {
        "XIO/XRP": {
          candles: [
            { t: t - 2 * 86_400_000, o: 0.02, h: 0.021, l: 0.019, c: 0.02, v: 1 },
            { t: t - 86_400_000, o: 0.02, h: 0.021, l: 0.019, c: 0.0205, v: 1 },
            { t, o: 20000, h: 20000, l: 20000, c: 20000, v: 0.01 },
            { t: t + 86_400_000, o: 0.021, h: 0.022, l: 0.02, c: 0.0215, v: 1 },
          ],
        },
      },
      xrpUsd: [],
    },
    sparkline: [],
    trades: [],
    livePrice: 0.0215,
    now: t + 86_400_000,
    windowed: false,
  });
  const spike = candles.find((row) => row.t === t);
  assert.ok(spike);
  assert.ok(spike.c < 1, `composed close should be clipped, got ${spike.c}`);
  assert.ok(spike.h < 1);
});

test("ammSupportResistanceRibbon builds support/resistance from AMM vs mid", () => {
  const rib = ammSupportResistanceRibbon(2.0, 2.02, { padBps: 0 });
  assert.ok(rib);
  assert.equal(rib.support, 2.0);
  assert.equal(rib.resistance, 2.02);
  assert.equal(rib.amm_price, 2.0);
  assert.equal(rib.mid, 2.02);
  const padded = ammSupportResistanceRibbon(2.0, 2.02, { padBps: 50 });
  assert.ok(padded.support < 2.0);
  assert.ok(padded.resistance > 2.02);
  assert.equal(ammSupportResistanceRibbon(0, 2), null);
});

test("orientQuotePrice flips reciprocal AMM prints and drops junk", () => {
  assert.ok(Math.abs(orientQuotePrice(0.025, 33) - 40) < 1e-9);
  assert.ok(Math.abs(orientQuotePrice(38, 33) - 38) < 1e-9);
  assert.equal(orientQuotePrice(1.66e-6, 24), null);
  assert.equal(orientQuotePrice(600000, 24), null);
});

test("composePairCandles keeps XIO pairs on the locked scale when AMM prints are inverted", () => {
  const t = Date.parse("2026-09-20T00:00:00.000Z");
  const day = 86_400_000;
  const locked = {
    pairs: {
      "XIO/RLUSD": {
        candles: [
          { t, o: 32, h: 34, l: 31, c: 33, v: 1 },
          { t: t + day, o: 33, h: 35, l: 32, c: 34, v: 1 },
        ],
      },
      "XIO/XRP": {
        candles: [
          { t, o: 24, h: 25, l: 23, c: 24.2, v: 1 },
          { t: t + day, o: 24.2, h: 26, l: 24, c: 25, v: 1 },
        ],
      },
    },
    xrpUsd: [],
  };
  const now = t + 2 * day;
  const rlusd = composePairCandles({
    pair: "XIO/RLUSD",
    interval: "15m",
    range: "5D",
    locked,
    trades: [
      { timestamp: new Date(t + day + 3_600_000).toISOString(), pool: "XIO/RLUSD", price: 0.025, xio: 4, side: "buy" },
      { timestamp: new Date(t + day + 7_200_000).toISOString(), pool: "XIO/RLUSD", price: 38, xio: 3, side: "sell" },
    ],
    livePrice: 0.026,
    now,
    windowed: false,
  });
  const xrp = composePairCandles({
    pair: "XIO/XRP",
    interval: "15m",
    range: "5D",
    locked,
    trades: [
      { timestamp: new Date(t + day + 3_600_000).toISOString(), pool: "XIO/XRP", price: 26.7, xio: 2, side: "sell" },
      { timestamp: new Date(t + day + 7_200_000).toISOString(), pool: "XIO/XRP", price: 1.66e-6, xio: 2, side: "buy" },
      { timestamp: new Date(t + day + 7_200_000).toISOString(), pool: "XIO/XRP", price: 585000, xio: 2, side: "buy" },
    ],
    now,
    windowed: false,
  });
  for (const [name, candles, lo, hi] of [
    ["XIO/RLUSD", rlusd, 8, 120],
    ["XIO/XRP", xrp, 6, 80],
  ]) {
    const closes = candles.map((row) => row.c);
    const max = Math.max(...closes);
    const min = Math.min(...closes);
    assert.ok(min > lo && max < hi, `${name} left its scale ${min}..${max}`);
  }
  const dots = heatmapDots(
    [
      { timestamp: new Date(t + day).toISOString(), price: 0.025, xio: 4, side: "buy" },
      { timestamp: new Date(t + day).toISOString(), price: 38, xio: 3, side: "sell" },
      { timestamp: new Date(t + day).toISOString(), price: 1.66e-6, xio: 1, side: "buy" },
    ],
    { now, reference: 33 }
  );
  assert.equal(dots.length, 2);
  assert.ok(dots.every((dot) => dot.price > 20 && dot.price < 80));
});
