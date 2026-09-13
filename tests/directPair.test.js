import test from "node:test";
import assert from "node:assert/strict";
import {RLUSD_HEX, RLUSD_ISSUER} from "../src/constants/ledger.js";
import {amountToNumber, offerToDirectRow, quoteSelectedPair, reservesFromAmm, splitDirectOffers, venueFromDirectMarket} from "../src/swap/directPair.js";

const xrp = { currency: "XRP" };
const rlusd = { currency: RLUSD_HEX, issuer: RLUSD_ISSUER };

test("offerToDirectRow reads XRP/RLUSD bids as RLUSD per XRP", () => {
  const bid = offerToDirectRow(
    {
      TakerGets: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "2.8" },
      TakerPays: "1000000",
    },
    xrp,
    rlusd
  );
  assert.equal(bid.side, "bid");
  assert.equal(bid.base_size, 1);
  assert.ok(Math.abs(bid.price - 2.8) < 1e-12);
});

test("splitDirectOffers keeps best bid first", () => {
  const { bids, asks } = splitDirectOffers(
    [
      {
        TakerGets: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "2.7" },
        TakerPays: "1000000",
      },
      {
        TakerGets: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "2.9" },
        TakerPays: "1000000",
      },
      {
        TakerGets: "1000000",
        TakerPays: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "3.1" },
      },
    ],
    xrp,
    rlusd
  );
  assert.equal(bids[0].price, 2.9);
  assert.equal(asks[0].price, 3.1);
});

test("a fat XRP/RLUSD AMM quotes a 19 XRP sell instead of the XIO bridge", () => {
  const direct = venueFromDirectMarket({
    bids: [],
    asks: [],
    reserveBase: 80_000_000,
    reserveQuote: 224_000_000,
    tradingFee: 500,
  });
  const emptyXio = { bids: [], asks: [], reserveBase: 0, reserveQuote: 0, tradingFee: 1000 };
  const quote = quoteSelectedPair({
    amountIn: 19.073486328125,
    routingMode: "smart",
    directVenue: direct,
    fromVenue: emptyXio,
    toVenue: emptyXio,
  });
  assert.equal(quote.via, "direct");
  assert.equal(quote.routeUsed, "amm");
  assert.ok(quote.actualOutput > 50);
  assert.ok(quote.ammOutput > 50);
  assert.equal(amountToNumber("19000000"), 19);
});

test("reservesFromAmm maps either AMM asset order onto from/to", () => {
  const flipped = reservesFromAmm(
    {
      amount: { currency: RLUSD_HEX, issuer: RLUSD_ISSUER, value: "10" },
      amount2: "5000000",
      trading_fee: 500,
    },
    xrp,
    rlusd
  );
  assert.equal(flipped.reserveBase, 5);
  assert.equal(flipped.reserveQuote, 10);
});
