import test from "node:test";
import assert from "node:assert/strict";
import {XIO_TOTAL_SUPPLY} from "../src/constants/ledger.js";
import {formatNumber, formatSupplySharePercent, shareOf} from "../src/utils/format.js";

test("XIO owner share is wallet balance / 10B total supply", () => {
  const top = 3_016_093_753.766;
  const share = shareOf(top, XIO_TOTAL_SUPPLY);

  assert.equal(XIO_TOTAL_SUPPLY, 10_000_000_000);
  assert.ok(Math.abs(share - 30.16093753766) < 1e-9);

  const detectedWallets = 9_334_000_000;
  const againstDetected = shareOf(top, detectedWallets);
  assert.ok(againstDetected > 32);
  assert.ok(share < againstDetected);
});

test("formatSupplySharePercent keeps six decimal places and stays at or under 100%", () => {
  assert.equal(formatSupplySharePercent(0.000001, "en-US"), "0.000001%");
  assert.equal(formatSupplySharePercent(30.16093753766, "en-US"), "30.160938%");
  assert.equal(formatSupplySharePercent(2104.87, "en-US"), "100.000000%");
});

test("formatNumber keeps a missing metric blank instead of zero", () => {
  assert.equal(formatNumber(null), "—");
  assert.equal(formatNumber(undefined), "—");
  assert.equal(formatNumber(""), "—");
  assert.equal(formatNumber(0, "en-US", { maximumFractionDigits: 0 }), "0");
});
