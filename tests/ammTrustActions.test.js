import test from "node:test";
import assert from "node:assert/strict";
import {assetTrustTxjson, lpTrustSpec, lpTrustTxjson, poolCardTrustActions, poolQuote} from "../src/ammTrustActions.js";
import {XIO_ISSUER, XIO_XRP_AMM, XIO_XRP_LP_HEX} from "../src/constants/ledger.js";
import {hasQuoteTrustline} from "../src/xaman/tradeTx.js";

const ETH_ISSUER = "rEthIssuer1111111111111111111111111";
const XAH_ISSUER = "rXahIssuer1111111111111111111111111";
const BTC_ISSUER = "rBtcIssuer1111111111111111111111111";
const ETH_AMM = "rEthAmm11111111111111111111111111111";
const XAH_AMM = "rXahAmm11111111111111111111111111111";
const BTC_AMM = "rBtcAmm11111111111111111111111111111";
const ETH_LP = "03EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
const XAH_LP = "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BTC_LP = "03BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function pool(pair, extra = {}) {
  const quote = pair.split("/")[1];
  return { pool: pair, quote, ...extra };
}

test("every pool card always exposes quote and LP trustline actions", () => {
  for (const row of [
    pool("XIO/ETH"),
    pool("XIO/XAH"),
    pool("XIO/BTC", { quote_issuer: BTC_ISSUER }),
    pool("XIO/XRP"),
    pool("XIO/NADS", { quote_issuer: "rNads" }),
  ]) {
    const actions = poolCardTrustActions(row);
    assert.equal(actions.showAssetTrustline, true);
    assert.equal(actions.showLpTrustline, true);
    assert.match(actions.assetLabel, /Trustline$/);
    assert.equal(actions.lpLabel, "LP Trustline");
  }
  assert.equal(poolCardTrustActions(pool("XIO/ETH")).assetId, "ETH");
  assert.equal(poolCardTrustActions(pool("XIO/XAH")).assetId, "XAH");
  assert.equal(poolCardTrustActions(pool("XIO/XRP")).assetId, "XIO");
});

test("ETH and XAH build TrustSet from pool issuer fields, not the known-quote list", () => {
  const eth = pool("XIO/ETH", {
    quote_issuer: ETH_ISSUER,
    quote_hex: "ETH",
    amm_account: ETH_AMM,
    lp_currency: ETH_LP,
  });
  const xah = pool("XIO/XAH", {
    issuer: XAH_ISSUER,
    hex: "XAH",
    amm_account: XAH_AMM,
    lp_currency_hex: XAH_LP,
  });
  const ethLine = assetTrustTxjson(eth, "rWallet");
  const xahLine = assetTrustTxjson(xah, "rWallet");
  assert.equal(ethLine.TransactionType, "TrustSet");
  assert.equal(ethLine.LimitAmount.issuer, ETH_ISSUER);
  assert.equal(ethLine.LimitAmount.currency, "ETH");
  assert.equal(xahLine.LimitAmount.issuer, XAH_ISSUER);
  assert.equal(xahLine.LimitAmount.currency, "XAH");
  assert.equal(lpTrustTxjson(eth, "rWallet").LimitAmount.issuer, ETH_AMM);
  assert.equal(lpTrustTxjson(eth, "rWallet").LimitAmount.currency, ETH_LP);
  assert.equal(lpTrustTxjson(xah, "rWallet").LimitAmount.issuer, XAH_AMM);
  assert.equal(lpTrustTxjson(xah, "rWallet").LimitAmount.currency, XAH_LP);
});

test("BTC and other catalog IOUs still build an LP TrustSet from the pool AMM", () => {
  const btc = pool("XIO/BTC", {
    quote_issuer: BTC_ISSUER,
    amm_account: BTC_AMM,
    lp_currency: BTC_LP,
  });
  const lp = lpTrustTxjson(btc, "rWallet");
  assert.equal(lp.LimitAmount.issuer, BTC_AMM);
  assert.equal(lp.LimitAmount.currency, BTC_LP);
  assert.equal(assetTrustTxjson(btc, "rWallet").LimitAmount.issuer, BTC_ISSUER);
});

test("a non-XRP pool never falls back to the XIO/XRP LP identity", () => {
  const eth = pool("XIO/ETH", { amm_account: ETH_AMM });
  const spec = lpTrustSpec(eth);
  assert.notEqual(spec?.amm, XIO_XRP_AMM);
  assert.notEqual(spec?.lpCurrency, XIO_XRP_LP_HEX);
  assert.equal(lpTrustTxjson(eth, "rWallet"), null);
});

test("XRP pools still use the XIO trustline and the XIO/XRP LP line", () => {
  const xrp = pool("XIO/XRP", { amm_account: XIO_XRP_AMM, lp_currency: XIO_XRP_LP_HEX });
  assert.equal(assetTrustTxjson(xrp, "rWallet").LimitAmount.issuer, XIO_ISSUER);
  assert.equal(lpTrustTxjson(xrp, "rWallet").LimitAmount.issuer, XIO_XRP_AMM);
});

test("a missing quote issuer is not treated as an existing trustline", () => {
  assert.equal(hasQuoteTrustline([], poolQuote(pool("XIO/ETH"))), false);
  assert.equal(hasQuoteTrustline([], { currency: "XAH" }), false);
});
