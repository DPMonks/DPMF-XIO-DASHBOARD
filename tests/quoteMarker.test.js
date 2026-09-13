import test from "node:test";
import assert from "node:assert/strict";
import {preferMarkWhenPoolInsane, xioQuoteSpot, xioXrpSpot} from "../src/wallet/quoteMarker.js";
import {predictedQuoteOut, tradeTotal} from "../src/xaman/tradeTx.js";

test("XIO/XRP mark is the recorded XRP spot", () => {
  assert.equal(xioXrpSpot({ xioXrp: 0.000000869, xrpUsd: 2, xioUsd: 0.0000018 }), 0.000000869);
  assert.ok(Math.abs(xioQuoteSpot({ quoteId: "XRP", prices: { xioXrp: 0.000869 } }) - 0.000869) < 1e-12);
});

test("opposing-asset mark is XIO USD over the quote USD, not leftover XRP", () => {
  const prices = {
    xioUsd: 0.001738,
    xrpUsd: 2,
    xioXrp: 0.000869,
    quotes: { XIO: 869 },
  };
  const spot = xioQuoteSpot({ quoteId: "XIO", prices });
  assert.ok(Math.abs(spot - 0.000002) < 1e-12);
  assert.ok(Math.abs(tradeTotal(100000, spot) - 0.2) < 1e-9);
});

test("a stale XRP-sized AMM reserve is ignored when the mark is sane", () => {
  const prices = {
    xioUsd: 0.001738,
    xrpUsd: 2,
    xioXrp: 0.000869,
    quotes: { XIO: 869, XSQUAD: 0.05 },
  };
  const xio = xioQuoteSpot({
    quoteId: "XIO",
    prices,
    pool: { base: 100000, reserve_xio: 100000, quote: 86.9, reserve_currency: 86.9 },
  });
  assert.ok(Math.abs(xio - 0.000002) < 1e-12);
  const squad = xioQuoteSpot({ quoteId: "XSQUAD", prices });
  assert.ok(squad > 0);
  assert.ok(Math.abs(tradeTotal(100000, squad) - 86.9) > 1);
});

test("market estimates prefer the mark when the pool quote is wildly off", () => {
  assert.equal(preferMarkWhenPoolInsane(86.9, 0.2), 0.2);
  assert.ok(Math.abs(predictedQuoteOut(100000, 0.000002, 100000, 86.9, { preferMark: true }) - 0.2) < 1e-9);
  assert.equal(predictedQuoteOut(100, 0, 1000, 50), 5);
});
