import test from "node:test";
import assert from "node:assert/strict";
import {XIO_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER} from "../src/constants/ledger.js";
import {issuedAmountValue, lpShareAmounts, matchingLiveReserves, overlayLiveAmmReserves, poolReservesFromAmmInfo, previewReserves} from "../src/utils/ammInfo.js";

test("issuedAmountValue reads IOU value and XRP drops", () => {
  assert.equal(issuedAmountValue({ value: "12.5" }), 12.5);
  assert.equal(issuedAmountValue("2500000"), 2.5);
});

test("poolReservesFromAmmInfo reads XIO/USDC ledger reserves", () => {
  const row = poolReservesFromAmmInfo({
    amm: {
      account: "rUsdcAmm",
      amount: { currency: "XIO", issuer: XIO_ISSUER, value: "80000" },
      amount2: { currency: "USDC", issuer: "rUsdc", value: "250" },
      lp_token: { currency: "03ABCDEF", issuer: "rUsdcAmm", value: "284023" },
      trading_fee: 500,
    },
  });
  assert.equal(row.amm_account, "rUsdcAmm");
  assert.equal(row.lp_supply, 284023);
  assert.equal(row.reserve_xio, 80000);
  assert.equal(row.reserve_currency, 250);
  assert.equal(row.quote_issuer, "rUsdc");
  assert.equal(row.quote, "USDC");
});

test("overlayLiveAmmReserves copies live quote issuer and LP identity onto the catalog row", () => {
  const row = overlayLiveAmmReserves(
    { pool: "XIO/ETH", quote: "ETH" },
    {
      reserve_xio: 10,
      reserve_currency: 2,
      lp_supply: 4,
      amm_account: "rEthAmm",
      lp_currency: "03EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
      quote_issuer: "rEthIssuer",
      quote_hex: "ETH",
    }
  );
  assert.equal(row.quote_issuer, "rEthIssuer");
  assert.equal(row.quote_hex, "ETH");
  assert.equal(row.amm_account, "rEthAmm");
  assert.equal(row.lp_currency, "03EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");
});

test("overlayLiveAmmReserves replaces leftover quote reserves and LP supply", () => {
  const row = overlayLiveAmmReserves(
    {
      pool: "XIO/XDX",
      reserve_xio: 52286366,
      reserve_asset: 52286366,
      reserve_currency: 1947.36782,
      lp_supply: 220280408.7293996,
    },
    {
      reserve_xio: 52286366.55495586,
      reserve_currency: 59.93807084355173,
      lp_supply: 44936.64667926788,
      trading_fee: 1000,
    }
  );
  assert.equal(row.reserve_currency, 59.93807084355173);
  assert.equal(row.lp_supply, 44936.64667926788);
  assert.equal(row.reserve_source, "amm_info");
  const share = lpShareAmounts(4493.664667926788, row.reserve_xio, row.reserve_currency, row.lp_supply);
  assert.ok(Math.abs(share.quote - 5.993807084355173) < 1e-9);
});

test("overlayLiveAmmReserves does not keep a leftover quote when live has no quote leftover", () => {
  const row = overlayLiveAmmReserves(
    { reserve_xio: 1000, reserve_currency: 1947.36, lp_supply: 500 },
    { reserve_xio: 1000, reserve_currency: 0, lp_supply: 40, trading_fee: 500 }
  );
  assert.equal(row.reserve_currency, null);
  assert.equal(row.lp_supply, 40);
  assert.equal(row.reserve_source, "amm_info");
});

test("previewReserves uses live XIO/XDX shares and ignores another pair", () => {
  const catalog = {
    pair: "XIO/XDX",
    reserve_xio: 52286366,
    reserve_currency: 1947.36782,
    lp_supply: 220280408.7293996,
    trading_fee: 0,
  };
  const live = {
    pair: "XIO/XDX",
    reserve_xio: 52286366.55495586,
    reserve_currency: 59.93807084355173,
    lp_supply: 44936.64667926788,
    trading_fee: 1000,
    reserve_source: "amm_info",
  };
  const preview = previewReserves(catalog, live);
  assert.equal(preview.reserve_source, "amm_info");
  assert.ok(Math.abs(preview.quote - 59.93807084355173) < 1e-9);
  const share = lpShareAmounts(4493.664667926788, preview.base, preview.quote, preview.lpSupply);
  assert.ok(Math.abs(share.quote - 5.993807084355173) < 1e-9);
  assert.equal(matchingLiveReserves({ ...live, pair: "XIO/XRP" }, "XIO/XDX"), null);
  const stale = previewReserves(catalog, { ...live, pair: "XIO/XRP" });
  assert.equal(stale.quote, 1947.36782);
});

test("poolReservesFromAmmInfo labels XIO/XSQUAD from AMM assets, not XIO/XRP", () => {
  const row = poolReservesFromAmmInfo({
    amm: {
      account: "rXsquadAmm",
      amount: { currency: "XIO", issuer: XIO_ISSUER, value: "1000" },
      amount2: { currency: XSQUAD_HEX, issuer: XSQUAD_ISSUER, value: "40" },
      lp_token: { currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", issuer: "rXsquadAmm", value: "80" },
    },
  });
  assert.equal(row.pair, "XIO/XSQUAD");
  assert.equal(row.quote, "XSQUAD");
  assert.equal(row.reserve_currency, 40);
  assert.equal(row.quote_issuer, XSQUAD_ISSUER);
  assert.equal(row.quote_hex, XSQUAD_HEX);
});

test("poolReservesFromAmmInfo treats XRP drops as the quote reserve", () => {
  const row = poolReservesFromAmmInfo({
    amm: {
      account: "rXrpAmm",
      amount: { currency: "XIO", issuer: XIO_ISSUER, value: "50000" },
      amount2: "2000000",
      lp_token: { currency: "0397", issuer: "rXrpAmm", value: "1000" },
    },
  });
  assert.equal(row.reserve_asset, 50000);
  assert.equal(row.reserve_quote, 2);
  assert.equal(row.lp_supply, 1000);
  assert.equal(row.pair, "XIO/XRP");
});
