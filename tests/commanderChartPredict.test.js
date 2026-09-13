import test from "node:test";
import assert from "node:assert/strict";
import {analysePatternSetups, answerChartPredict, detectTrendFrame, estimateMatchesChartPair, scoreMeasuredMovePct, timeframeGainExpectation, trendLineColor} from "../server/commanderChartPredict.js";

test("scoreMeasuredMovePct is percent gain support to resistance", () => {
  assert.ok(Math.abs(scoreMeasuredMovePct("bull", 1, 1.05) - 5) < 1e-9);
  assert.ok(Math.abs(scoreMeasuredMovePct("bear", 0.95, 1) - 5) < 1e-9);
});

test("timeframeGainExpectation scales with horizon", () => {
  assert.ok(timeframeGainExpectation("5m").sweet < timeframeGainExpectation("1H").sweet);
  assert.ok(timeframeGainExpectation("1H").sweet < timeframeGainExpectation("1D").sweet);
});

test("estimateMatchesChartPair keeps XRP estimate off XIO tabs", () => {
  assert.equal(estimateMatchesChartPair({ pair: "XRP/RLUSD" }, { pair: "XIO/RLUSD" }), false);
  assert.equal(estimateMatchesChartPair({ pair: "XRP/RLUSD" }, { pair: "XRP/RLUSD" }), true);
});

test("analysePatternSetups returns trend + next resistance path", () => {
  const candles = [];
  let px = 1;
  for (let i = 0; i < 24; i += 1) {
    const wave = Math.sin(i / 3) * 0.03;
    const c = px + wave;
    candles.push({ t: i * 3600000, o: c, h: c + 0.02, l: c - 0.02, c });
    px += 0.004;
  }
  const setup = analysePatternSetups(
    { pair: "XRP/RLUSD", timeframe: "1H", price: { live: candles.at(-1).c }, candles },
    "bull"
  );
  assert.ok(setup);
  assert.ok(setup.pct > 0);
  assert.equal(setup.horizon, "medium_large");
  assert.ok(setup.support > 0 && setup.resistance > setup.support);
});

test("trendLineColor is green support and red resistance", () => {
  assert.equal(trendLineColor("support"), "#98f050");
  assert.equal(trendLineColor("resistance"), "#ff5d73");
});

test("detectTrendFrame returns wick-anchored support+resistance pair", () => {
  const candles = [];
  for (let i = 0; i < 30; i += 1) {
    // Descending wedge-ish: lower highs and slowly lower lows
    const mid = 2 - i * 0.02;
    const hi = mid + 0.12 - i * 0.002;
    const lo = mid - 0.08 - i * 0.0008;
    candles.push({ t: 1_700_000_000_000 + i * 3_600_000, o: mid, h: hi, l: lo, c: mid + (i % 2 ? 0.01 : -0.01) });
  }
  const frame = detectTrendFrame({
    pair: "XRP/RLUSD",
    timeframe: "1H",
    price: { live: candles.at(-1).c, visible_min: 1.2, visible_max: 2.2 },
    candles,
  });
  assert.ok(frame);
  assert.ok(frame.support?.a && frame.resistance?.a);
  assert.equal(frame.support.role, "support");
  assert.equal(frame.resistance.role, "resistance");
});

test("answerChartPredict trend lines lays green+red pair", () => {
  const candles = [];
  for (let i = 0; i < 28; i += 1) {
    const mid = 1.5 - i * 0.015;
    candles.push({
      t: 1_700_000_000_000 + i * 3_600_000,
      o: mid,
      h: mid + 0.1 - i * 0.0015,
      l: mid - 0.06 - i * 0.0005,
      c: mid,
    });
  }
  const out = answerChartPredict(
    "draw trend lines on the chart",
    null,
    { pair: "XRP/RLUSD", timeframe: "1H", candles, price: { live: candles.at(-1).c } },
    { intent: "chart_predict" }
  );
  assert.ok(out.chart_action?.drawings?.length >= 1);
  const trends = out.chart_action.drawings.filter((d) => d.kind === "trend");
  assert.ok(trends.length >= 2);
  const colors = new Set(trends.map((d) => d.color));
  assert.ok(colors.has("#98f050"));
  assert.ok(colors.has("#ff5d73"));
  assert.match(out.text, /support|resistance|breakout|trend/i);
  assert.ok(!/[\u2014\u2013]/.test(out.text));
});
