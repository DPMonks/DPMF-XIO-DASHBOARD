import test from "node:test";
import assert from "node:assert/strict";
import {RLUSD_HEX, RLUSD_ISSUER} from "../src/constants/ledger.js";
import {loadDirectPairMarket} from "../server/directPairMarket.js";

test("loadDirectPairMarket reads book_offers and amm_info for the selected pair", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ method: body.method, params: body.params[0] });
    if (body.method === "amm_info") {
      return {
        ok: true,
        json: async () => ({
          result: {
            amm: {
              amount: "80000000000000",
              amount2: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "224000000" },
              trading_fee: 500,
            },
          },
        }),
      };
    }
    const gets = body.params[0].taker_gets;
    const sellingXrp = gets.currency === "XRP" || gets.currency == null;
    return {
      ok: true,
      json: async () => ({
        result: {
          offers: sellingXrp
            ? [
                {
                  TakerGets: "1000000",
                  TakerPays: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "3" },
                },
              ]
            : [
                {
                  TakerGets: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "2.8" },
                  TakerPays: "1000000",
                },
              ],
        },
      }),
    };
  };

  const market = await loadDirectPairMarket(
    { from: "XRP", to: "RLUSD", toIssuer: RLUSD_ISSUER, toHex: RLUSD_HEX, fresh: true },
    { fetchImpl }
  );
  assert.equal(calls.some((row) => row.method === "amm_info"), true);
  assert.equal(calls.filter((row) => row.method === "book_offers").length, 2);
  assert.equal(market.present, true);
  assert.equal(market.pair, "XRP/RLUSD");
  assert.ok(market.reserveBase > 0);
  assert.ok(market.reserveQuote > 0);
  assert.equal(market.bids[0].price, 2.8);
  assert.equal(market.asks[0].price, 3);
});
