import test from "node:test";
import assert from "node:assert/strict";
import {isXrpMicroFallback, looksLikeXrpUsd, saneXrpUsd, pickTrustlineCount, recordedXioUsdFromPrices, xrpPerXio} from "../src/utils/recordedPrice.js";

test("rejects live Railway xrpUsd * 0.000001 fallback", () => {
  const xrpUsd = 1.36;
  const hack = xrpUsd * 0.000001;
  assert.equal(isXrpMicroFallback(hack, xrpUsd), true);
  assert.equal(
    recordedXioUsdFromPrices({ xioUsd: hack, xrpUsd, recorded_price: hack }),
    0
  );
});

test("trustline count prefers the history scan when latest was truncated", () => {
  assert.equal(pickTrustlineCount(0, 19983), 19983);
  assert.equal(pickTrustlineCount(15947, 19983), 19983);
  assert.equal(pickTrustlineCount(19983, 0), 19983);
  assert.equal(pickTrustlineCount(0, 0), 0);
  assert.notEqual(pickTrustlineCount(15947, 19983), 15947);
});

test("XIO/XRP tile is XRP per XIO, not USD", () => {
  assert.equal(xrpPerXio(0.0000419, 1.4), 0.00002993);
  assert.equal(xrpPerXio(0.0000419, 0.0000419), 0);
  assert.equal(xrpPerXio(0, 1.4), 0);
});

test("keeps Worker 2 XIO USD and does not treat it as XRP", () => {
  const price = recordedXioUsdFromPrices({
    recorded_price: 0.0000416,
    xioUsd: 0.0000416,
    xrpUsd: 1.4,
  });
  assert.equal(price, 0.0000416);
  assert.equal(looksLikeXrpUsd(0.0000416), false);
  assert.equal(looksLikeXrpUsd(1.4), true);
  assert.equal(looksLikeXrpUsd(1 / 0.00003147), false);
  assert.equal(isXrpMicroFallback(0.0000416, 1.4), false);
});

test("saneXrpUsd rejects XIO-per-XRP used as dollars", () => {
  const inverted = 1 / 0.00003147;
  assert.equal(saneXrpUsd(inverted, 0.00004658, 0.00003147), 0.00004658 / 0.00003147);
  assert.equal(saneXrpUsd(1.48, 0.00004658, 0.00003147), 1.48);
  assert.equal(saneXrpUsd(0, 0, 0), null);
});
