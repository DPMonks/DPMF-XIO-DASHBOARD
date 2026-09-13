import test from "node:test";
import assert from "node:assert/strict";
import {applyXrplToChange, applyXrplToOverview, applyXrplToPrices, countsNeedXrplTo, marketNeedsXrplTo, parseXrplToToken, tvlUsdFromXrplTo, xioUsdFromXrplTo} from "../src/utils/xrplToToken.js";

const sample = parseXrplToToken({
  token: {
    usd: "0.000046124014641489683889",
    exch: 3.120905264789023e-5,
    holders: 15942,
    trustlines: 19973,
    lpHolderCount: 80,
    pro24h: -4.89,
    vol24hxrp: 115.77,
    marketcap: 311525.65,
    tvl: 6030,
  },
});

test("parseXrplToToken reads the live XIO token card", () => {
  assert.ok(sample.usd > 0.00004);
  assert.equal(sample.holders, 15942);
  assert.equal(sample.trustlines, 19973);
  assert.ok(sample.exchXrp > 0);
});

test("xrpl.to fills empty Postgres prices and holder counts", () => {
  assert.equal(marketNeedsXrplTo({ xioUsd: 0, holder_count: 0, xrpUsd: 1.5 }), true);
  assert.equal(countsNeedXrplTo({ xioUsd: 0.00005, holder_count: 0, trustlines: 0 }), true);
  assert.equal(countsNeedXrplTo({ holder_count: 15940, trustlines: 19973 }), false);
  const prices = applyXrplToPrices({ xioUsd: 0, xrpUsd: 1.5, xrpGbp: 1.1, source: "db" }, sample);
  assert.ok(prices.xioUsd > 0.00004);
  assert.equal(prices.source, "hybrid");
  const overview = applyXrplToOverview(
    { xioUsd: 0, holder_count: 0, trustlines: 0, xrpUsd: 1.5, circulating: 10_000_000_000, source: "db" },
    sample,
    { xrpUsd: 1.5 }
  );
  assert.equal(overview.holder_count, 15942);
  assert.equal(overview.trustline_count, 19973);
  assert.ok(overview.xrplMarketCap > 0);
  assert.ok(overview.volume24hXio > 1_000_000);
  assert.ok(overview.volume24hUsd > 100);
  assert.ok(overview.volume24h > 1_000_000);
  assert.equal(applyXrplToChange({ xio: 0 }, sample).xio, -4.89);
});

test("xrpl.to still fills holder boxes when the live AMM already has a price", () => {
  const overview = applyXrplToOverview(
    { xioUsd: 0.00005, holder_count: 0, trustlines: 0, xrpUsd: 1.5, source: "xrpl" },
    sample,
    { xioUsd: 0.00005, xrpUsd: 1.5 }
  );
  assert.equal(overview.holder_count, 15942);
  assert.equal(overview.trustline_count, 19973);
  assert.equal(overview.lp_holder_count, 80);
});

test("xioUsdFromXrplTo can price from exch * XRP when usd is missing", () => {
  assert.ok(Math.abs(xioUsdFromXrplTo({ exchXrp: 0.00003 }, 2) - 0.00006) < 1e-12);
  assert.equal(xioUsdFromXrplTo({ usd: 0.00005 }, 2), 0.00005);
});

test("xrpl.to pool TVL is 2 x XRP reserve and converts to USD", () => {
  const xrpReserve = 2043.896261;
  const tvlXrp = xrpReserve * 2;
  const xrpUsd = 1.48;
  assert.ok(Math.abs(tvlUsdFromXrplTo({ tvl: tvlXrp }, xrpUsd) - tvlXrp * xrpUsd) < 1e-6);
});
