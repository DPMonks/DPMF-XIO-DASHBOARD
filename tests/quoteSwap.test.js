import test from "node:test";
import assert from "node:assert/strict";
import {ammSwapOut, expectedFromMid, quoteBridgeSwap, poolReducePercent, quoteSwap, quoteUsesPool, resolveVenueMid, saferSwapAlternatives, walkBook, walkHybrid} from "../src/swap/quoteSwap.js";
import {RLUSD_ISSUER} from "../src/constants/ledger.js";
import {isActiveXioPool, pickOtherAsset, swapAssetOptions, swapCounterAsset, swapCounterOptions, swapSellingXio} from "../src/swap/swapAssets.js";
import {bookFromMarketPayload, filterBookTape} from "../src/orderbook.js";

test("ammSwapOut follows the constant-product fee walk", () => {
  const out = ammSwapOut({ reserveIn: 1000, reserveOut: 10, amountIn: 100, tradingFee: 1000 });
  assert.ok(out > 0);
  assert.ok(out < 10 * (100 / 1100));
  assert.ok(Math.abs(out - (10 - 1000 * 10 / (1000 + 100 * 0.99))) < 1e-12);
});

test("walkBook consumes bids when selling XIO", () => {
  const fill = walkBook({
    inIsBase: true,
    amountIn: 150,
    levels: [
      { price: 0.02, base_size: 100 },
      { price: 0.019, base_size: 100 },
    ],
  });
  assert.equal(fill.leftover, 0);
  assert.ok(Math.abs(fill.out - (100 * 0.02 + 50 * 0.019)) < 1e-12);
});

test("walkHybrid does not treat implied AMM tape rows as resting DEX offers", () => {
  const fill = walkHybrid({
    inIsBase: true,
    amountIn: 50,
    reserveBase: 10_000,
    reserveQuote: 200,
    tradingFee: 1000,
    levels: [{ price: 0.05, base_size: 50, source: "amm" }],
  });
  assert.equal(fill.usedDex, false);
  assert.equal(fill.bookOut, 0);
  assert.equal(fill.route, "amm");
});

test("walkHybrid prefers a better book level then finishes on the AMM", () => {
  const fill = walkHybrid({
    inIsBase: true,
    amountIn: 200,
    reserveBase: 10_000,
    reserveQuote: 200,
    tradingFee: 1000,
    levels: [{ price: 0.03, base_size: 50 }],
  });
  assert.equal(fill.route, "hybrid");
  assert.ok(fill.usedAmm);
  assert.ok(fill.usedDex);
  assert.ok(fill.out > 50 * 0.03);
  assert.ok(fill.bookOut > 0);
  assert.ok(fill.ammOut > 0);
  assert.ok(Math.abs(fill.bookOut + fill.ammOut - fill.out) < 1e-9);
});

test("quoteSwap marks negative slippage when actual is below mid", () => {
  const quote = quoteSwap({
    amountIn: 1000,
    sellingXio: true,
    mid: 0.03,
    reserveBase: 10_000,
    reserveQuote: 200,
    tradingFee: 1000,
    routingMode: "amm",
    bids: [],
    asks: [],
  });
  assert.ok(quote.expectedOutput > quote.actualOutput);
  assert.equal(quote.isNegativeSlippage, true);
  assert.ok(quote.lossAmount > 0);
  assert.ok(quote.slippagePercent < 0);
  assert.equal(quote.routeUsed, "amm");
  assert.equal(quote.bookOutput, 0);
  assert.ok(quote.ammOutput > 0);
});

test("unwrapped catalog bids fill a book-only sell quote", () => {
  const catalog = {
    pairs: ["XIO/XRP"],
    books: {
      "XIO/XRP": {
        bids: [{ price: 0.02, base_size: 100, source: "dex" }],
        asks: [],
      },
    },
  };
  assert.equal((catalog.bids || []).length, 0);
  const book = bookFromMarketPayload(catalog, "XIO/XRP");
  const quote = quoteSwap({
    amountIn: 50,
    sellingXio: true,
    routingMode: "book",
    bids: book.bids,
    asks: book.asks,
    reserveBase: 0,
    reserveQuote: 0,
  });
  assert.equal(quote.routeUsed, "book");
  assert.ok(Math.abs(quote.actualOutput - 1) < 1e-12);
  assert.ok(quote.bookOutput > 0);
});

test("pool fills report reserve share and do not recommend cutting in half", () => {
  const extras = {
    sellingXio: true,
    mid: 0.03,
    reserveBase: 8_000,
    reserveQuote: 80,
    tradingFee: 1000,
    bids: [],
    asks: [],
  };
  const quote = quoteSwap({ ...extras, amountIn: 2_000, routingMode: "smart" });
  assert.ok(quoteUsesPool(quote));
  assert.ok(quote.poolReducePercent > 1);
  assert.ok(
    Math.abs(quote.poolReducePercent - poolReducePercent({ ammOutput: quote.ammOutput, sellingXio: true, reserveBase: 8_000, reserveQuote: 80 })) < 1e-9
  );
  const rows = saferSwapAlternatives(2_000, quote, extras);
  assert.equal(rows.some((row) => row.id === "half"), false);
});

test("saferSwapAlternatives can still shrink a book-only walk", () => {
  const extras = {
    sellingXio: true,
    mid: 0.02,
    reserveBase: 0,
    reserveQuote: 0,
    tradingFee: 1000,
    bids: [
      { price: 0.02, base_size: 80, source: "dex" },
      { price: 0.01, base_size: 400, source: "dex" },
    ],
    asks: [],
  };
  const quote = quoteSwap({ ...extras, amountIn: 400, routingMode: "book" });
  assert.equal(quoteUsesPool(quote), false);
  const rows = saferSwapAlternatives(400, quote, extras);
  assert.ok(rows.some((row) => row.id === "half"));
});

test("expectedFromMid and swap helpers keep one side on XIO", () => {
  assert.equal(expectedFromMid(100, 0.02, true), 2);
  assert.equal(expectedFromMid(2, 0.02, false), 100);
  assert.equal(swapSellingXio("XIO"), true);
  assert.equal(swapCounterAsset("XIO", "RLUSD"), "RLUSD");
  assert.equal(swapCounterAsset("XRP", "XIO"), "XRP");
  assert.equal(swapCounterAsset("XIO", "XIO"), "XRP");
  assert.equal(pickOtherAsset("XIO", "XIO", "XRP"), "XRP");
  assert.equal(pickOtherAsset("RLUSD", "XRP"), "XRP");
  assert.ok(swapAssetOptions({ balances: { xio: 1 } }).some((row) => row.id === "XIO"));
});

test("swap counters are individual assets from active XIO pools, then wallet lines", () => {
  const activeXrp = { pool: "XIO/XRP", reserve_asset: 1_000_000, reserve_currency: 2_000 };
  const activeRlusd = {
    pool: "XIO/RLUSD",
    reserve_asset: 500_000,
    reserve_currency: 1_200,
    quote_issuer: RLUSD_ISSUER,
  };
  const deadXio = { pool: "XIO/XDX", reserve_asset: 0, reserve_currency: 0 };
  const listedUnknown = { pool: "XIO/XDX", amm_account: "rExampleAmm" };
  const rlusdLine = { currency: "RLUSD", issuer: RLUSD_ISSUER, ticker: "RLUSD", balance: "12" };
  const soloLine = { currency: "SOLO", issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", ticker: "SOLO", balance: "9" };

  assert.equal(isActiveXioPool(activeRlusd), true);
  assert.equal(isActiveXioPool(deadXio), false);
  assert.equal(isActiveXioPool({ pool: "XIO/XIO", reserve_asset: 10, reserve_currency: 10 }), false);

  const browse = swapCounterOptions({ pools: [activeXrp, activeRlusd, deadXio, listedUnknown] });
  assert.deepEqual(
    browse.map((row) => row.id),
    ["XRP", "RLUSD", "XIO", "XSQUAD"]
  );
  assert.equal(
    browse.some((row) => String(row.id).includes("/") || row.id === "XIO" || row.id === "SOLO"),
    false
  );

  const held = swapCounterOptions({
    pools: [activeXrp, activeRlusd, deadXio],
    lines: [rlusdLine, soloLine],
    balances: { xio: 100, xrp: 5 },
    signedIn: true,
  });
  assert.deepEqual(
    held.map((row) => row.id).sort(),
    ["RLUSD", "SOLO", "XRP"]
  );

  const noRlusdLine = swapCounterOptions({
    pools: [activeXrp, activeRlusd],
    lines: [soloLine],
    signedIn: true,
  });
  assert.deepEqual(
    noRlusdLine.map((row) => row.id).sort(),
    ["SOLO", "XRP"]
  );

  const lineWithoutPool = swapCounterOptions({
    pools: [activeXrp],
    lines: [rlusdLine, soloLine],
    signedIn: true,
  });
  assert.deepEqual(
    lineWithoutPool.map((row) => row.id).sort(),
    ["RLUSD", "SOLO", "XRP"]
  );

  assert.deepEqual(
    swapCounterOptions({ lines: [rlusdLine], signedIn: true }).map((row) => row.id).sort(),
    ["RLUSD", "XRP"]
  );
  assert.ok(swapAssetOptions({ lines: [rlusdLine, soloLine], signedIn: true }).some((row) => row.id === "XIO"));
});

test("quoteBridgeSwap walks from-quote into XIO then out to the other quote", () => {
  const quote = quoteBridgeSwap({
    amountIn: 10,
    routingMode: "amm",
    fromVenue: { reserveBase: 10_000, reserveQuote: 200, tradingFee: 1000, mid: 0.02, bids: [], asks: [] },
    toVenue: { reserveBase: 8_000, reserveQuote: 80, tradingFee: 1000, mid: 0.01, bids: [], asks: [] },
  });
  assert.equal(quote.routeUsed, "bridge");
  assert.ok(quote.actualOutput > 0);
  assert.ok(quote.xioNotional > 0);
});

test("empty book-only does not report -100% slippage from an AMM mid", () => {
  const quote = quoteSwap({
    amountIn: 1_000_000,
    sellingXio: true,
    mid: 0.0001157745,
    reserveBase: 10_000_000,
    reserveQuote: 1_157.745,
    tradingFee: 1000,
    routingMode: "book",
    bids: [{ price: 0.0001157745, base_size: 50, source: "amm" }],
    asks: [],
  });
  assert.equal(quote.routeUsed, "none");
  assert.equal(quote.actualOutput, 0);
  assert.equal(quote.expectedOutput, 0);
  assert.equal(quote.slippagePercent, null);
  assert.equal(quote.priceImpactPercent, null);
  assert.equal(quote.isNegativeSlippage, false);
  assert.equal(resolveVenueMid({ routingMode: "book", mid: 0.0001157745, bids: [], asks: [] }), 0);
});

test("book slippage uses only the filled slice against the DEX mid", () => {
  const quote = quoteSwap({
    amountIn: 1_000,
    sellingXio: true,
    mid: 0.03,
    routingMode: "book",
    bids: [
      { price: 0.02, base_size: 100, source: "dex" },
      { price: 0.03, base_size: 50, source: "amm" },
    ],
    asks: [{ price: 0.021, base_size: 100, source: "dex" }],
  });
  assert.equal(quote.routeUsed, "book");
  assert.ok(quote.partialFill);
  assert.ok(Math.abs(quote.actualOutput - 2) < 1e-12);
  assert.ok(quote.slippagePercent != null);
  assert.ok(Math.abs(quote.slippagePercent) < 10);
  assert.ok(quote.slippagePercent > -90);
});

test("filterBookTape splits hybrid, DEX, and AMM rows", () => {
  const book = {
    bids: [
      { price: 1, base_size: 10, source: "dex" },
      { price: 0.9, base_size: 8, source: "amm" },
      { price: 0.95, base_size: 4, source: "bridge" },
    ],
    asks: [
      { price: 1.1, base_size: 6, source: "dex" },
      { price: 1.2, base_size: 5, source: "amm" },
    ],
  };
  const dex = filterBookTape(book, "dex");
  const amm = filterBookTape(book, "amm");
  assert.equal(dex.bids.length, 2);
  assert.equal(amm.asks.length, 1);
  assert.equal(filterBookTape(book, "hybrid").bids.length, 3);
});
