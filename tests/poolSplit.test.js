import test from "node:test";
import assert from "node:assert/strict";
import {displayPoolSplit, formatPoolPct, inferQuoteReserve, poolAssetSplit, detectQuoteUsd, impliedQuoteUsd, normalizePriceBook, preferUsdPoolSplit, priceBookFromPools, quoteUsdFromMap, quoteUsdFromXrpRate, quoteUsdLooksImplied, resolvePoolSplit, usableMarketQuoteUsd} from "../src/utils/poolSplit.js";

test("poolAssetSplit is a USD value share, not a raw unit share", () => {
  const split = poolAssetSplit({
    reserveXio: 63_105_563.3193,
    reserveQuote: 1872.95,
    xioUsd: 0.0000419,
    quoteUsd: 1.41,
  });
  assert.ok(split);
  assert.equal(Number((split.xioPct + split.quotePct).toFixed(1)), 100);
  assert.ok(split.xioPct > 40 && split.xioPct < 70);
  assert.ok(split.quotePct > 30 && split.quotePct < 60);
  assert.equal(formatPoolPct(split.xioPct).includes("."), true);
});

test("displayPoolSplit labels a 50/50 bar when the pool split is not measured", () => {
  assert.deepEqual(displayPoolSplit(50, 50), { xioPct: 50, quotePct: 50, measured: true });
  assert.deepEqual(displayPoolSplit(null, null), { xioPct: 50, quotePct: 50, measured: false });
  assert.equal(formatPoolPct(50), "50.0");
});

test("poolAssetSplit reports one decimal like 40.0 / 60.0", () => {
  const split = poolAssetSplit({
    reserveXio: 40,
    reserveQuote: 60,
    xioUsd: 1,
    quoteUsd: 1,
  });
  assert.deepEqual(split, { xioPct: 40.0, quotePct: 60.0, lead: "quote" });
  assert.equal(formatPoolPct(40), "40.0");
  assert.equal(formatPoolPct(50), "50.0");
});

test("poolAssetSplit stays hidden when a side or price is missing", () => {
  assert.equal(
    poolAssetSplit({ reserveXio: 1000, reserveQuote: 0, xioUsd: 0.00004, quoteUsd: 1.4 }),
    null
  );
  assert.equal(
    poolAssetSplit({ reserveXio: 1000, reserveQuote: 10, xioUsd: 0.00004, quoteUsd: 0 }),
    null
  );
});

test("inferQuoteReserve fills the missing AMM quote side from equal USD value", () => {
  const quote = inferQuoteReserve(674_386, 0.000045, 1);
  assert.ok(quote > 30 && quote < 31);
});

test("resolvePoolSplit is XIO versus LP tokens, not an inferred 50/50", () => {
  const xrp = resolvePoolSplit({
    reserveXio: 63_105_563.3193,
    reserveQuote: 1846.778,
    lpSupply: 218_594_863.12,
  });
  assert.ok(xrp);
  assert.equal(xrp.xioPct, 22.4);
  assert.equal(xrp.quotePct, 77.6);
  assert.equal(xrp.lead, "quote");

  const moreXio = resolvePoolSplit({
    reserveXio: 800,
    lpSupply: 200,
  });
  assert.deepEqual(
    { xioPct: moreXio.xioPct, quotePct: moreXio.quotePct, lead: moreXio.lead },
    { xioPct: 80, quotePct: 20, lead: "xio" }
  );

  const noLp = resolvePoolSplit({
    reserveXio: 40,
    reserveQuote: 60,
  });
  assert.deepEqual(
    { xioPct: noLp.xioPct, quotePct: noLp.quotePct, lead: noLp.lead },
    { xioPct: 40, quotePct: 60, lead: "quote" }
  );

  assert.equal(resolvePoolSplit({ reserveXio: 63_105_563.3193 }), null);

  const fromPrice = resolvePoolSplit({
    reserveXio: 51_000_000,
    price: 0.002,
  });
  assert.ok(fromPrice);
  assert.equal(fromPrice.xioPct, 99.8);
  assert.equal(fromPrice.quotePct, 0.2);
  assert.equal(fromPrice.inferred, true);
});

test("quoteUsdFromMap uses recorded prices and treats RLUSD as one dollar", () => {
  assert.equal(quoteUsdFromMap("XRP", { XRP: 1.41 }), 1.41);
  assert.equal(quoteUsdFromMap("XRP", { xrpUsd: 2.8 }), 2.8);
  assert.equal(quoteUsdFromMap("RLUSD", {}), 1);
  assert.equal(quoteUsdFromMap("USDC", {}), 1);
  assert.equal(quoteUsdFromMap("SOLO", {}), 0);
  assert.equal(quoteUsdFromMap("SOLO", { SOLO: 0.22 }), 0.22);
});

test("detectQuoteUsd prefers live USD then XIO pool implied for any quote", () => {
  assert.equal(
    detectQuoteUsd({
      quoteId: "XRP",
      pool: { quote_usd: 1.5, reserve_xio: 100000, reserve_currency: 3.12, xioUsd: 0.000047 },
      prices: { xrpUsd: 2.8 },
    }),
    2.8
  );
  assert.equal(
    impliedQuoteUsd({ reserveXio: 1000, reserveQuote: 50, xioUsd: 0.0001 }),
    0.002
  );
  assert.equal(
    detectQuoteUsd({
      quoteId: "MAG",
      pool: { reserve_xio: 1000, reserve_currency: 50, xioUsd: 0.0001, quote_usd: 0.0001 },
      prices: {},
    }),
    0.002
  );
  assert.equal(detectQuoteUsd({ quoteId: "USDT", pool: {}, prices: {} }), 1);
  assert.equal(usableMarketQuoteUsd(0.000045, { xioUsd: 0.000045, xrpUsd: 2.8 }), 0);
  assert.equal(usableMarketQuoteUsd(2.8 * 0.000001, { xrpUsd: 2.8 }), 0);
  assert.equal(quoteUsdFromXrpRate("XIO", { xioXrp: 26.4, xrpUsd: 1 }, 1), 26.4);
  assert.equal(
    detectQuoteUsd({
      quoteId: "XIO",
      pool: { reserve_xio: 1150, reserve_currency: 1, xioUsd: 0.000087 },
      prices: { XIO: 0.0001, xrpUsd: 2.8 },
    }),
    impliedQuoteUsd({ reserveXio: 1150, reserveQuote: 1, xioUsd: 0.000087 })
  );
  assert.equal(
    detectQuoteUsd({
      quoteId: "XIO",
      pool: { reserve_xio: 1150, reserve_currency: 1, xioUsd: 0.000087 },
      prices: { xioXrp: 26.4, xrpUsd: 1 },
    }),
    26.4
  );
  assert.equal(
    detectQuoteUsd({
      quoteId: "XIO",
      pool: { reserve_xio: 52286366, reserve_currency: 59.94, xioUsd: 0.000063 },
      prices: { XIO: 869, xioXrp: 27.81, xrpUsd: 1 },
      allowImplied: false,
    }),
    27.81
  );
  const book = normalizePriceBook({ quotes: { PLX: 0.012 }, xioUsd: 0.00004, xrpUsd: 2.8 });
  assert.equal(book.quotes.PLX, 0.012);
  assert.equal(
    detectQuoteUsd({
      quoteId: "PLX",
      pool: { reserve_xio: 1000, reserve_currency: 4_000_000, xioUsd: 0.00004 },
      prices: book,
      allowImplied: false,
    }),
    0.012
  );
  assert.equal(
    detectQuoteUsd({
      quoteId: "PLX",
      pool: { reserve_xio: 1000, reserve_currency: 4, xioUsd: 0.00004 },
      prices: {},
      allowImplied: false,
    }),
    0
  );
  assert.equal(quoteUsdLooksImplied(0.01, { reserve_xio: 1000, reserve_currency: 4, xioUsd: 0.00004 }, 0.00004), true);
  const usdBar = preferUsdPoolSplit({
    reserveXio: 1_000_000,
    reserveQuote: 50,
    xioUsd: 0.00004,
    quoteUsd: 1,
  });
  assert.equal(usdBar.basis, "usd");
  assert.ok(usdBar.xioPct < 50);
  assert.ok(usdBar.quotePct > 50);
  const seeded = priceBookFromPools(
    [{ quote: "PLX", quote_usd: 0.012, xioUsd: 0.00004, reserve_xio: 1000, reserve_currency: 4_000_000 }],
    {}
  );
  assert.equal(seeded.quotes.PLX, 0.012);
  const fromUsd = poolAssetSplit({
    reserveXio: 115.07,
    reserveQuote: 0.1,
    xioUsd: 0.00004,
    quoteUsd: 24,
  });
  assert.ok(fromUsd.quotePct > 90);
});
