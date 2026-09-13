import test from "node:test";
import assert from "node:assert/strict";
import {XDX_ISSUER} from "../src/constants/ledger.js";
import {amountToNumber, attachQuoteXrpPrices, loadQuoteXrpRates, matchesQuoteAmount, pickQuoteXrpRate, xrpPerQuoteFromAmm, xrpPerQuoteFromOffer} from "../server/quoteXrpMarket.js";

const XIO = { id: "XIO", currency: "XIO", issuer: XDX_ISSUER };

test("xrpPerQuoteFromOffer reads both XIO book sides", () => {
  assert.ok(
    Math.abs(
      xrpPerQuoteFromOffer(
        {
          TakerGets: { currency: "XIO", issuer: XDX_ISSUER, value: "1" },
          TakerPays: "27000000",
        },
        XIO
      ) - 27
    ) < 1e-9
  );
  assert.ok(
    Math.abs(
      xrpPerQuoteFromOffer(
        {
          TakerGets: "52000000",
          TakerPays: { currency: "XIO", issuer: XDX_ISSUER, value: "2" },
        },
        XIO
      ) - 26
    ) < 1e-9
  );
  assert.equal(amountToNumber("1000000"), 1);
  assert.equal(matchesQuoteAmount({ currency: "XIO", issuer: XDX_ISSUER }, XIO), true);
});

test("xrpPerQuoteFromAmm uses the XIO/XRP pool ratio", () => {
  const rate = xrpPerQuoteFromAmm(
    {
      amount: { currency: "XIO", issuer: XDX_ISSUER, value: "0.5" },
      amount2: "13500000",
    },
    XIO
  );
  assert.ok(Math.abs(rate - 27) < 1e-9);
  assert.equal(pickQuoteXrpRate({ amm: 27, bid: 26, ask: 32 }), 27);
  assert.equal(pickQuoteXrpRate({ bid: 26, ask: 32 }), 29);
});

test("attachQuoteXrpPrices writes XIO USD and xioXrp", () => {
  const prices = attachQuoteXrpPrices({ xioUsd: 0.00004, quotes: { XRP: 2 } }, { XIO: 26.4 }, 2);
  assert.equal(prices.xioXrp, 26.4);
  assert.equal(prices.XIO, 52.8);
  assert.equal(prices.quotes.XIO, 52.8);
});

test("loadQuoteXrpRates prefers the XIO/XRP AMM", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "amm_info") {
      return {
        ok: true,
        json: async () => ({
          result: {
            amm: {
              amount: { currency: "XIO", issuer: XDX_ISSUER, value: "1" },
              amount2: "26400000",
            },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ result: { offers: [] } }) };
  };
  const rates = await loadQuoteXrpRates({ fetchImpl, skipCache: true });
  assert.ok(Math.abs(rates.XIO - 26.4) < 1e-9);
});
