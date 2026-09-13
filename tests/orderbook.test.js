import test from "node:test";
import assert from "node:assert/strict";
import {asOrderbookPayload, bookFromMarketPayload, bookHasNativeDex, bookHasTape, bookHeader, collectPairOptions, combineOrderbookSide, composeAmmBook, filterBookTape, emptyOrderbook, extractDexSides, filterOrderbookPairs, keepLastGoodBook, mergeOrderbookPayloads, normalizeOrderbookPair, offerToDexRow, ORDERBOOK_VISIBLE_LEVELS, orderBookRowStamp, padOrderbookLevels, pickNativeBookRow, projectDexThroughXrp, quotePerXrpFromSpots, sameOrderbookPair, sortOrderbookPairs, topDexLevels} from "../src/orderbook.js";
import {ammSizeToPrice, ammSpot} from "../src/ammCurve.js";

test("bookFromMarketPayload unwraps a catalog onto the named pair book", () => {
  const catalog = {
    pairs: ["XIO/XRP", "XIO/RLUSD"],
    books: {
      "XIO/XRP": {
        pair: "XIO/XRP",
        bids: [{ price: 0.0002, base_size: 1000, source: "dex" }],
        asks: [],
      },
    },
  };
  const book = bookFromMarketPayload(catalog, "XIO/XRP");
  assert.equal(book.bids.length, 1);
  assert.equal(book.bids[0].price, 0.0002);
  assert.equal(bookFromMarketPayload(catalog, "XRP").bids[0].base_size, 1000);
  assert.equal(bookFromMarketPayload(book, "XIO/XRP").bids[0].base_size, 1000);
  assert.equal(bookFromMarketPayload({ book: catalog }, "XIO/XRP").bids.length, 1);
  assert.equal(bookFromMarketPayload({ pairs: [], books: {} }, "XIO/XRP").bids.length, 0);
});

test("normalizeOrderbookPair maps quote aliases onto featured and detected AMM pairs", () => {
  assert.equal(normalizeOrderbookPair("XRP"), "XIO/XRP");
  assert.equal(normalizeOrderbookPair("rlusd"), "XIO/RLUSD");
  assert.equal(normalizeOrderbookPair("XIO-RLUSD"), "XIO/RLUSD");
  assert.equal(normalizeOrderbookPair("XIO"), "XIO/XDX");
  assert.equal(normalizeOrderbookPair("xsquad"), "XIO/XSQUAD");
  assert.equal(normalizeOrderbookPair("SOLO"), "XIO/SOLO");
  assert.equal(normalizeOrderbookPair("XIO/POWDER KEG"), "XIO/POWDER KEG");
  assert.equal(normalizeOrderbookPair("XRP/RLUSD"), "XRP/RLUSD");
  assert.equal(normalizeOrderbookPair("XRP-RLUSD"), "XRP/RLUSD");
  assert.equal(normalizeOrderbookPair("RLUSD/XRP"), "XRP/RLUSD");
});

test("sortOrderbookPairs keeps XRP, RLUSD, XIO, XSQUAD first", () => {
  assert.deepEqual(sortOrderbookPairs(["XIO/SOLO", "XIO/XSQUAD", "XIO/XDX"]), [
    "XIO/XRP",
    "XIO/RLUSD",
    "XIO/XDX",
    "XIO/XSQUAD",
    "XIO/SOLO",
  ]);
});

test("collectPairOptions pins XIO/XRP and featured AMMs at the top", () => {
  assert.deepEqual(collectPairOptions(["XIO/SOLO", "XIO/XRP", "XIO/AiCat"]), [
    "XIO/XRP",
    "XIO/RLUSD",
    "XIO/XDX",
    "XIO/XSQUAD",
    "XIO/SOLO",
    "XIO/AiCat",
  ]);
});

test("sameOrderbookPair matches XIO-XRP spellings and treats all as open", () => {
  assert.equal(sameOrderbookPair("XIO-XRP", "XIO/XRP"), true);
  assert.equal(sameOrderbookPair("XIO/RLUSD", "XIO/XRP"), false);
  assert.equal(sameOrderbookPair("XIO/SOLO", "all"), true);
});

test("filterOrderbookPairs matches quote search without requiring the XIO/ prefix", () => {
  const rows = filterOrderbookPairs(
    ["XIO/XRP", "XIO/XDX", "XIO/XSQUAD", "XIO/SOLO"],
    "xio"
  );
  assert.deepEqual(rows, ["XIO/XDX"]);
});

test("ammSizeToPrice grows as price walks further from spot", () => {
  const reserveBase = 63_000_000;
  const reserveQuote = 1875;
  const spot = ammSpot(reserveBase, reserveQuote);
  const near = ammSizeToPrice({
    reserveBase,
    reserveQuote,
    targetPrice: spot * 0.995,
  });
  const far = ammSizeToPrice({
    reserveBase,
    reserveQuote,
    targetPrice: spot * 0.95,
  });
  const up = ammSizeToPrice({
    reserveBase,
    reserveQuote,
    targetPrice: spot * 1.01,
  });
  assert.equal(near.side, "bid");
  assert.equal(far.side, "bid");
  assert.equal(up.side, "ask");
  assert.ok(far.base_size > near.base_size);
  assert.notEqual(near.base_size, far.base_size);
});

test("composeAmmBook fills empty native DEX from the pair AMM curve", () => {
  const book = composeAmmBook(emptyOrderbook("XIO/XDX"), {
    reserve_asset: 51_000_000,
    reserve_currency: 120_000,
    trading_fee: 1000,
  }, "XIO/XDX");
  assert.equal(book.pair, "XIO/XDX");
  assert.equal(book.present, true);
  assert.equal(book.dex_present, false);
  assert.equal(book.amm_implied, true);
  assert.equal(book.bids.length, 20);
  assert.equal(book.asks.length, 20);
  assert.ok(book.bids.every((row) => row.source === "amm"));
  assert.ok(book.asks.every((row) => row.source === "amm"));
  assert.ok(book.bids[0].price > book.bids[19].price);
  assert.ok(book.asks[0].price < book.asks[19].price);
  assert.deepEqual(book.amm.levels, []);
});

test("quotePerXrpFromSpots and projectDexThroughXrp convert XIO/XRP DEX into the quote asset", () => {
  assert.equal(quotePerXrpFromSpots(0.00005, 0.000025), 2);
  const bridged = projectDexThroughXrp(
    {
      bids: [{ price: 0.00003, base_size: 1000, source: "dex" }],
      asks: [{ price: 0.00004, base_size: 2000, source: "dex" }],
    },
    2
  );
  assert.equal(bridged.bids[0].source, "bridge");
  assert.equal(bridged.asks[0].source, "bridge");
  assert.ok(Math.abs(bridged.bids[0].price - 0.00006) < 1e-12);
  assert.equal(bridged.bids[0].base_size, 1000);
});

test("composeAmmBook bridges the XIO/XRP tape into a thin quote pair", () => {
  const xrp = composeAmmBook(
    {
      pair: "XIO/XRP",
      bids: [{ price: 0.00003, base_size: 4000 }],
      asks: [{ price: 0.00004, base_size: 2500 }],
    },
    {
      reserve_asset: 63_000_000,
      reserve_currency: 1875,
      trading_fee: 1000,
    },
    "XIO/XRP"
  );
  const book = composeAmmBook(
    {
      pair: "XIO/RLUSD",
      bids: [],
      asks: [{ price: 0.03, base_size: 1_000_000 }],
    },
    {
      reserve_asset: 50_000_000,
      reserve_currency: 2500,
      trading_fee: 1000,
    },
    "XIO/RLUSD",
    { xrpBook: xrp }
  );
  assert.equal(book.dex_present, true);
  assert.equal(book.amm_implied, true);
  assert.ok(book.asks.some((row) => row.source === "dex" && row.base_size === 1_000_000));
  assert.ok(book.bids.some((row) => row.source === "bridge"));
  assert.ok(book.asks.some((row) => row.source === "bridge" || row.source === "amm"));
  assert.ok(book.bids.length >= 20);
  assert.ok(book.asks.length >= 20);
});

test("topDexLevels keeps the 20 native offers closest to price", () => {
  const bids = topDexLevels(
    Array.from({ length: 30 }, (_, i) => ({
      price: 0.00002 + i * 0.0000001,
      base_size: 100 + i,
      source: i === 3 ? "amm" : i === 5 ? "bridge" : "dex",
    })),
    "bid",
    20
  );
  assert.equal(bids.length, 20);
  assert.ok(bids.every((row) => row.source !== "amm" && row.source !== "bridge"));
  assert.equal(bids[0].price, 0.00002 + 29 * 0.0000001);
  assert.ok(bids[0].price > bids[19].price);
});

test("pickNativeBookRow skips empty latest and uses a history snapshot with DEX offers", () => {
  const picked = pickNativeBookRow(
    { payload: { pair: "XIO/XRP", bids: [], asks: [] }, timestamp: "2026-08-22T10:00:00.000Z" },
    [
      { payload: { pair: "XIO/XRP", bids: [] }, timestamp: "2026-08-22T09:00:00.000Z" },
      {
        payload: {
          pair: "XIO/XRP",
          bids: [{ price: 0.000029, base_size: 4000 }],
          asks: [{ price: 0.00003, base_size: 2500 }],
        },
        timestamp: "2026-08-22T08:55:00.000Z",
      },
    ],
    "XIO/XRP"
  );
  assert.equal(picked.as_of, "2026-08-22T08:55:00.000Z");
  assert.equal(asOrderbookPayload(picked.payload).bids[0].base_size, 4000);
});

test("pickNativeBookRow does not keep an empty latest snapshot", () => {
  assert.equal(
    pickNativeBookRow(
      { payload: { pair: "XIO/XRP", bids: [], asks: [] }, timestamp: "2026-08-22T11:00:00.000Z" },
      [{ payload: { pair: "XIO/XRP", bids: [] }, timestamp: "2026-08-22T10:59:00.000Z" }],
      "XIO/XRP"
    ),
    null
  );
});

test("bookHasTape counts AMM rows so an empty catalog cannot wipe XSQUAD", () => {
  const amm = {
    pair: "XIO/XSQUAD",
    bids: [{ price: 0.00019, base_size: 1200, source: "amm" }],
    asks: [],
  };
  assert.equal(bookHasTape(amm), true);
  assert.equal(bookHasTape(emptyOrderbook("XIO/XSQUAD")), false);
  const held = keepLastGoodBook(amm, emptyOrderbook("XIO/XSQUAD"), "XIO/XSQUAD");
  assert.equal(held.bids[0].base_size, 1200);
  assert.equal(held.stale, true);
});

test("keepLastGoodBook holds the previous tape until a new native book arrives", () => {
  const previous = composeAmmBook(
    {
      pair: "XIO/XRP",
      bids: [{ price: 0.0000285, base_size: 4000 }],
      asks: [{ price: 0.0000378, base_size: 29032 }],
    },
    {},
    "XIO/XRP"
  );
  const empty = emptyOrderbook("XIO/XRP");
  const held = keepLastGoodBook(previous, empty, "XIO/XRP");
  assert.equal(bookHasNativeDex(empty), false);
  assert.equal(held.bids[0].base_size, 4000);
  assert.equal(held.stale, true);
  const merged = mergeOrderbookPayloads(
    { books: { "XIO/XRP": previous } },
    { books: { "XIO/XRP": empty }, pairs: ["XIO/XRP"] }
  );
  assert.equal(merged.books["XIO/XRP"].asks[0].base_size, 29032);
});

test("composeAmmBook keeps native sizes and measures AMM opposing at those prices", () => {
  const book = composeAmmBook(
    {
      pair: "XIO/XRP",
      bids: [
        { price: 0.0000295, base_size: 5_000 },
        { price: 0.000028, base_size: 12_400 },
      ],
      asks: [{ price: 0.000031, base_size: 8_000 }],
    },
    {
      reserve_asset: 63_000_000,
      reserve_currency: 1875,
      trading_fee: 1000,
    },
    "XIO/XRP"
  );
  const nativeBids = book.bids.filter((row) => row.source === "dex");
  const nativeAsks = book.asks.filter((row) => row.source === "dex");
  assert.equal(book.present, true);
  assert.equal(book.dex_present, true);
  assert.equal(book.amm_implied, true);
  assert.equal(nativeBids.length, 2);
  assert.equal(nativeBids[0].base_size, 5_000);
  assert.equal(nativeBids[1].base_size, 12_400);
  assert.ok(nativeBids[1].amm_through > nativeBids[0].amm_through);
  assert.equal(nativeAsks[0].amm_opposing, 0);
  assert.ok(nativeAsks[0].amm_through > 0);
  assert.deepEqual(book.amm.levels, []);
});

test("empty order book matches the catching_up envelope", () => {
  const empty = emptyOrderbook("RLUSD");
  assert.equal(empty.pair, "XIO/RLUSD");
  assert.equal(empty.present, false);
  assert.equal(empty.catching_up, true);
  assert.deepEqual(empty.bids, []);
  assert.deepEqual(empty.asks, []);
  assert.equal(empty.price_unit, "quote_per_base");
});

test("padOrderbookLevels keeps 20 slots and does not invent prices", () => {
  const padded = padOrderbookLevels([], 20);
  assert.equal(ORDERBOOK_VISIBLE_LEVELS, 20);
  assert.equal(padded.length, 20);
  assert.equal(padded[0].placeholder, true);
  assert.equal(padded[0].price, null);
  assert.equal(padded[0].base_size, null);

  const long = padOrderbookLevels(
    Array.from({ length: 25 }, (_, i) => ({ price: 0.00003 + i, base_size: 10 })),
    20
  );
  assert.equal(long.length, 20);
  assert.ok(long.every((row) => row.placeholder !== true));
});

test("combineOrderbookSide mirrors GateHub: best bid high, best ask low", () => {
  const bids = combineOrderbookSide(
    [{ price: 0.000029, base_size: 100 }],
    [{ price: 0.00003, base_size: 50, side: "bid" }],
    "bid"
  );
  assert.equal(bids[0].price, 0.00003);
  assert.equal(bids[0].source, "amm");

  const asks = combineOrderbookSide(
    [{ price: 0.00004, base_size: 10 }, { price: 0.000031, base_size: 8 }],
    [],
    "ask"
  );
  assert.equal(asks[0].price, 0.000031);
});

test("bookHeader uses native DEX bid/ask and only falls mid back to AMM spot", () => {
  const header = bookHeader({
    best_bid: 0,
    best_ask: 0,
    mid: 0,
    mid_usd: 0.00004336,
    bids: [],
    asks: [],
    amm: {
      price: 0.000029697395,
      levels: [
        { side: "bid", price: 0.000029623152 },
        { side: "ask", price: 0.000029771638 },
      ],
    },
  });
  assert.equal(header.best_bid, null);
  assert.equal(header.best_ask, null);
  assert.equal(header.mid, 0.000029697395);
  assert.equal(header.mid_usd, 0.00004336);
  assert.equal(header.spread_bps, null);
});

test("bookHeader reads AMM and bridged levels when the native DEX is empty", () => {
  const header = bookHeader({
    best_bid: null,
    best_ask: null,
    mid: null,
    bids: [
      { price: 0.00000127, base_size: 100, source: "amm" },
      { price: 0.0000012, base_size: 4000, source: "bridge" },
    ],
    asks: [{ price: 0.00000128, base_size: 100, source: "amm" }],
  });
  assert.equal(header.best_bid, 0.00000127);
  assert.equal(header.best_ask, 0.00000128);
  assert.ok(header.spread_bps > 0);
  const hybrid = filterBookTape(
    {
      best_bid: 0.00000127,
      best_ask: 0.00000128,
      bids: [
        { price: 0.00000127, base_size: 100, source: "amm" },
        { price: 0.0000012, base_size: 4000, source: "bridge" },
      ],
      asks: [{ price: 0.00000128, base_size: 100, source: "amm" }],
    },
    "hybrid"
  );
  assert.equal(hybrid.best_bid, 0.00000127);
  assert.equal(hybrid.best_ask, 0.00000128);
});

test("composeAmmBook keeps a full AMM tape when native DEX already has 20 levels", () => {
  const bids = Array.from({ length: 20 }, (_, i) => ({
    price: 0.000031 - i * 0.0000001,
    base_size: 1000 + i,
  }));
  const asks = Array.from({ length: 20 }, (_, i) => ({
    price: 0.000038 + i * 0.0000001,
    base_size: 900 + i,
  }));
  const book = composeAmmBook(
    { pair: "XIO/XRP", bids, asks },
    {
      reserve_asset: 63_000_000,
      reserve_currency: 1875,
      trading_fee: 1000,
    },
    "XIO/XRP"
  );
  assert.equal(book.bids.filter((row) => row.source === "dex").length, 20);
  assert.equal(book.asks.filter((row) => row.source === "dex").length, 20);
  assert.equal(book.bids.filter((row) => row.source === "amm").length, 20);
  assert.equal(book.asks.filter((row) => row.source === "amm").length, 20);
  assert.equal(book.amm_implied, true);
  const dex = filterBookTape(book, "dex");
  const amm = filterBookTape(book, "amm");
  assert.equal(dex.bids.length, 20);
  assert.equal(amm.asks.length, 20);
});

test("composeAmmBook keeps a worse native offer when bridged XRP already fills 20 levels", () => {
  const xrpAsks = Array.from({ length: 20 }, (_, i) => ({
    price: 0.00004 + i * 0.0000001,
    base_size: 1000 + i,
    source: "dex",
  }));
  const book = composeAmmBook(
    {
      pair: "XIO/RLUSD",
      bids: [],
      asks: [{ price: 0.03, base_size: 1_000_000, source: "dex" }],
    },
    {
      reserve_asset: 50_000_000,
      reserve_currency: 2500,
      trading_fee: 1000,
    },
    "XIO/RLUSD",
    {
      xrpBook: { pair: "XIO/XRP", bids: [], asks: xrpAsks },
      quotePerXrp: 2,
    }
  );
  const nativeAsk = book.asks.find((row) => row.source === "dex" && row.base_size === 1_000_000);
  assert.ok(nativeAsk);
  assert.equal(nativeAsk.price, 0.03);
  assert.equal(book.asks.filter((row) => row.source === "bridge").length, 19);
});

test("composeAmmBook keeps bridged XRP DEX on a pair whose AMM already fills 20 rungs", () => {
  const xrp = {
    pair: "XIO/XRP",
    bids: [{ price: 0.00003, base_size: 4000, source: "dex" }],
    asks: [{ price: 0.00004, base_size: 2500, source: "dex" }],
  };
  const book = composeAmmBook(
    emptyOrderbook("XIO/XDX"),
    {
      reserve_asset: 51_000_000,
      reserve_currency: 120_000,
      trading_fee: 1000,
    },
    "XIO/XDX",
    { xrpBook: xrp, quotePerXrp: 2 }
  );
  assert.ok(book.bids.some((row) => row.source === "bridge" && row.base_size === 4000));
  assert.ok(book.asks.some((row) => row.source === "bridge" && row.base_size === 2500));
  assert.equal(book.bids.filter((row) => row.source === "amm").length, 20);
  assert.equal(book.asks.filter((row) => row.source === "amm").length, 20);
  assert.equal(book.dex_present, false);
  const header = bookHeader({ ...book, best_bid: null, best_ask: null, mid: null });
  assert.ok(header.best_bid > 0);
  assert.ok(header.best_ask > 0);
});

test("order book stamp prefers Worker 2 timestamp, not updated_at", () => {
  assert.equal(
    orderBookRowStamp({ timestamp: "2026-08-21T23:40:00.000Z", updated_at: "stale" }),
    "2026-08-21T23:40:00.000Z"
  );
  assert.equal(
    orderBookRowStamp({ payload: { as_of: "2026-08-21T23:41:00.000Z" } }),
    "2026-08-21T23:41:00.000Z"
  );
});

test("offerToDexRow reads XRPL TakerGets / TakerPays as native bids and asks", () => {
  const bid = offerToDexRow({
    TakerGets: "1500000",
    TakerPays: { currency: "XIO", issuer: "rIssuer", value: "50000" },
  });
  const ask = offerToDexRow({
    TakerGets: { currency: "XIO", issuer: "rIssuer", value: "8000" },
    TakerPays: "400",
  });
  assert.equal(bid.side, "bid");
  assert.equal(bid.source, "dex");
  assert.equal(bid.base_size, 50000);
  assert.ok(Math.abs(bid.price - 1.5 / 50000) < 1e-12);
  assert.equal(ask.side, "ask");
  assert.equal(ask.base_size, 8000);
  assert.ok(Math.abs(ask.price - 0.0004 / 8000) < 1e-12);
});

test("offerToDexRow keeps the offer account so a wallet can find its own bid", () => {
  const bid = offerToDexRow({
    Account: "rBuyer",
    TakerGets: "1500000",
    TakerPays: { currency: "XIO", issuer: "rIssuer", value: "50000" },
  });
  assert.equal(bid.account, "rBuyer");
});

test("extractDexSides finds nested Worker 2 book.bids without treating AMM rungs as DEX", () => {
  const sides = extractDexSides({
    book: {
      bids: [{ price: 0.00003, base_size: 1200 }],
      asks: [{ price: 0.000032, amount: 900 }],
    },
    amm: {
      levels: [{ side: "bid", price: 0.000029, base_size: 158976, source: "amm" }],
    },
  });
  assert.equal(sides.bids.length, 1);
  assert.equal(sides.bids[0].base_size, 1200);
  assert.equal(sides.asks[0].base_size, 900);
});

test("extractDexSides unwraps book_offers RPC objects and ignores empty bid arrays", () => {
  const sides = extractDexSides({
    pair: "XIO/XRP",
    bids: [],
    asks: [],
    bid: {
      result: {
        offers: [
          {
            TakerGets: "25000000",
            TakerPays: { currency: "XIO", issuer: "rIssuer", value: "874778.061501" },
          },
        ],
      },
    },
    ask: {
      result: {
        offers: [
          {
            TakerGets: { currency: "XIO", issuer: "rIssuer", value: "29032.3" },
            TakerPays: "1100000",
          },
        ],
      },
    },
  });
  assert.equal(sides.bids.length, 1);
  assert.equal(sides.asks.length, 1);
  assert.equal(sides.bids[0].base_size, 874778.061501);
  assert.equal(sides.asks[0].base_size, 29032.3);
  assert.ok(Math.abs(sides.asks[0].price - 1.1 / 29032.3) < 1e-12);
});

test("extractDexSides keeps native_bids when AMM rows already fill bids", () => {
  const sides = extractDexSides({
    bids: [{ price: 0.000029, base_size: 158976, source: "amm" }],
    asks: [{ price: 0.00003, base_size: 158976, source: "amm" }],
    native_bids: [{ price: 0.0000285, base_size: 4000 }],
    native_asks: [{ price: 0.0000378, amount: 29032.3 }],
  });
  assert.equal(sides.bids.length, 1);
  assert.equal(sides.asks.length, 1);
  assert.equal(sides.bids[0].base_size, 4000);
  assert.equal(sides.asks[0].base_size, 29032.3);
});

test("offerToDexRow uses funded XIO size and the full-offer price", () => {
  const bid = offerToDexRow({
    TakerGets: "8415900",
    TakerPays: { currency: "XIO", issuer: "rIssuer", value: "300000" },
    taker_gets_funded: "7045616",
    taker_pays_funded: { currency: "XIO", issuer: "rIssuer", value: "251153.7446975369" },
  });
  assert.equal(bid.side, "bid");
  assert.equal(bid.base_size, 251153.7446975369);
  assert.ok(Math.abs(bid.price - 8.4159 / 300000) < 1e-12);
});

test("asOrderbookPayload does not treat quote-per-XIO as xioUsd", () => {
  const book = asOrderbookPayload({
    pair: "XIO/XRP",
    present: true,
    best_bid: 0.0000298,
    best_ask: 0.0000301,
    mid: 0.00002995,
    mid_usd: 0.0000416,
    bids: [{ level: 1, price: 0.0000298, source: "dex" }],
    asks: [],
  });
  assert.equal(book.present, true);
  assert.equal(book.price_unit, "quote_per_base");
  assert.equal(book.mid, 0.00002995);
  assert.equal(book.mid_usd, 0.0000416);
  assert.notEqual(book.mid, book.mid_usd);
});
