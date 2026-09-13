import test from "node:test";
import assert from "node:assert/strict";
import {buildChartSnapshot} from "../src/context/chartSnapshot.js";

test("buildChartSnapshot always includes amm_ribbon when provided even if UI off", () => {
  const snap = buildChartSnapshot({
    pair: "XRP/RLUSD",
    timeframe: "15m",
    showAmmRibbon: false,
    ammRibbon: {
      support: 2.0,
      resistance: 2.05,
      amm_price: 2.0,
      mid: 2.05,
      pct: 2.5,
      pad_bps: 0,
    },
  });
  assert.equal(snap.overlays.amm_ribbon, false);
  assert.ok(snap.amm_ribbon);
  assert.equal(snap.amm_ribbon.support, 2);
  assert.equal(snap.amm_ribbon.resistance, 2.05);
  assert.equal(snap.amm_ribbon.ui_visible, false);
});
