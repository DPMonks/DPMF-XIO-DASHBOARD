import test from "node:test";
import assert from "node:assert/strict";
import {asciiCurrencyHex, RLUSD_HEX, RLUSD_ISSUER} from "../src/constants/ledger.js";
import {fillNativeBookFromXrpl, quoteSpecForPair} from "../server/xrplBookOffers.js";

test("quoteSpecForPair uses 3-letter XIO quotes and RLUSD hex", () => {
  assert.deepEqual(quoteSpecForPair("XIO/XRP"), { currency: "XRP" });
  assert.deepEqual(quoteSpecForPair("XIO/RLUSD"), {
    currency: RLUSD_HEX,
    issuer: RLUSD_ISSUER,
  });
  assert.equal(asciiCurrencyHex("XSQUAD"), "5853515541440000000000000000000000000000");
});

test("fillNativeBookFromXrpl reads both book_offers sides", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.params[0]);
    const gets = body.params[0].taker_gets;
    const sellingXio = gets.currency === "XIO";
    return {
      ok: true,
      json: async () => ({
        result: {
          status: "success",
          offers: sellingXio
            ? [
                {
                  TakerGets: { currency: "XIO", issuer: "rIssuer", value: "29032.3" },
                  TakerPays: "1100000",
                },
              ]
            : [
                {
                  TakerGets: "25000000",
                  TakerPays: { currency: "XIO", issuer: "rIssuer", value: "874778.061501" },
                },
              ],
        },
      }),
    };
  };

  const book = await fillNativeBookFromXrpl("XIO/XRP", {}, { fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(book.pair, "XIO/XRP");
  assert.equal(book.dex_present, true);
  assert.equal(book.bids.length, 1);
  assert.equal(book.asks.length, 1);
  assert.equal(book.asks[0].base_size, 29032.3);
  assert.equal(book.source, "xrpl");
});
