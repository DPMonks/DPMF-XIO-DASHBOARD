import test from "node:test";
import assert from "node:assert/strict";
import {XIO_FEE_TREASURY, XIO_ISSUER, XIO_PLATFORM_FEE_PCT} from "../src/constants/ledger.js";
import {needsXioPlatformFee, shouldSkipXioPlatformFee, swapAssetUsd, tradeNotionalUsd, xioPlatformFeeFromUsd, xioPlatformFeeTxjson} from "../src/swap/platformFee.js";

test("platform fee only applies when neither side is XIO", () => {
  assert.equal(needsXioPlatformFee("BITX", "USD"), true);
  assert.equal(needsXioPlatformFee("XRP", "RLUSD"), true);
  assert.equal(needsXioPlatformFee("XIO", "XRP"), false);
  assert.equal(needsXioPlatformFee("XRP", "XIO"), false);
  assert.equal(needsXioPlatformFee("BITX", "BITX"), false);
  assert.equal(XIO_PLATFORM_FEE_PCT, 1);
});

test("1% fee is the USD size converted into XIO", () => {
  assert.equal(tradeNotionalUsd({ payAmount: 50, payUsd: 2 }), 100);
  assert.equal(tradeNotionalUsd({ receiveAmount: 10, receiveUsd: 1 }), 10);
  assert.equal(xioPlatformFeeFromUsd({ tradeUsd: 100, xioUsd: 0.0001 }), 10_000);
  assert.equal(xioPlatformFeeFromUsd({ tradeUsd: 0, xioUsd: 0.0001 }), 0);
  assert.equal(xioPlatformFeeFromUsd({ tradeUsd: 100, xioUsd: 0 }), 0);
});

test("fee payment goes to the DPMF bank and skips the treasury wallet", () => {
  const tx = xioPlatformFeeTxjson({ account: "rTrader", xio: 12.5 });
  assert.equal(tx.TransactionType, "Payment");
  assert.equal(tx.Destination, XIO_FEE_TREASURY);
  assert.equal(tx.Account, "rTrader");
  assert.equal(tx.Amount.currency, "XIO");
  assert.equal(tx.Amount.issuer, XIO_ISSUER);
  assert.equal(tx.Amount.value, "12.5");
  assert.equal(xioPlatformFeeTxjson({ account: XIO_FEE_TREASURY, xio: 12.5 }), null);
  assert.equal(shouldSkipXioPlatformFee({ account: XIO_FEE_TREASURY, xio: 12.5 }), true);
});

test("swap asset USD uses the price book and XRP/XIO marks", () => {
  const prices = { xioUsd: 0.00008, xrpUsd: 2.5, quotes: { RLUSD: 1 } };
  assert.equal(swapAssetUsd({ id: "XRP", prices }), 2.5);
  assert.equal(swapAssetUsd({ id: "XIO", prices }), 0.00008);
  assert.equal(swapAssetUsd({ id: "RLUSD", prices }), 1);
});
