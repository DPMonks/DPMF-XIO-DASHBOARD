import test from "node:test";
import assert from "node:assert/strict";
import {catalogSource, mergeCatalogPayload, mergeChange24h, mergeCountPayload, mergeIssuerLocked, mergeLiveOverview, mergeLivePrices, mergeOrderbookCatalogs, overlayDbResultWithLive, serveCatalogFallback} from "../server/catalogSwitch.js";
import {rememberCatalog, resetCatalogMemory} from "../server/sourceControl.js";

test("empty DB prices take the live AMM quote", () => {
  const merged = mergeLivePrices(
    { xioUsd: 0, xrpUsd: 1.48, XSQUAD: 0.4, source: "db" },
    { xioUsd: 0.000046, recorded_price: 0.000046, xioGbp: 0.000034, xrpUsd: 1.5, source: "xrpl" }
  );
  assert.equal(merged.xioUsd, 0.000046);
  assert.equal(merged.recorded_price, 0.000046);
  assert.equal(merged.xrpUsd, 1.5);
  assert.equal(merged.XSQUAD, 0.4);
  assert.equal(merged.source, "hybrid");
});

test("DB holders stay when present and live fills a zero price", () => {
  const merged = mergeLiveOverview(
    { xioUsd: 0, holder_count: 1800, trustlines: 2200, reserve_asset: 0, source: "db" },
    { xioUsd: 0.00005, holder_count: 15941, reserve_asset: 64_000_000, reserve_currency: 2000, source: "xrpl" }
  );
  assert.equal(merged.xioUsd, 0.00005);
  assert.equal(merged.holder_count, 1800);
  assert.equal(merged.reserve_asset, 64_000_000);
  assert.equal(merged.source, "hybrid");
});

test("zero DB holder counts take the live token stats", () => {
  const merged = mergeCountPayload({ count: 0, source: "db" }, { count: 15941, source: "xrpl.to" });
  assert.equal(merged.count, 15941);
  assert.equal(merged.source, "xrpl");
});

test("issuer lock stays on DB when issued is present", () => {
  const db = mergeIssuerLocked({ issued: 9_000_000_000, issuer_locked: 1_000_000_000, source: "db" }, {
    issued: 8,
    issuer_locked: 2,
    source: "xrpl",
  });
  assert.equal(db.issued, 9_000_000_000);
  const live = mergeIssuerLocked({ issued: 0, issuer_locked: 0, source: "db" }, {
    issued: 9_100_000_000,
    issuer_locked: 900_000_000,
    source: "xrpl",
  });
  assert.equal(live.issued, 9_100_000_000);
  assert.equal(live.source, "xrpl");
});

test("change24h uses live only when the DB row is blank", () => {
  assert.equal(mergeChange24h({ xio: -2, xrp: 1 }, { xio: -4, xrp: 0 }).xio, -2);
  assert.equal(mergeChange24h({ xio: 0, xrp: 0 }, { xio: -3.6, xrp: 0.2 }).xio, -3.6);
});

test("mergeCatalogPayload routes prices, overview, and lists", () => {
  const prices = mergeCatalogPayload("prices", { xioUsd: 0 }, { xioUsd: 0.1 });
  assert.equal(prices.xioUsd, 0.1);
  const holders = mergeCatalogPayload("top-holders", { holders: [{ account: "r1" }] }, { rows: [] });
  assert.equal(holders.holders[0].account, "r1");
  const emptyHolders = mergeCatalogPayload("top-holders", { holders: [] }, { rows: [], catching_up: true });
  assert.equal(emptyHolders.catching_up, true);
  assert.equal(catalogSource(true, true), "hybrid");
});

test("mergeCatalogPayload keeps a single pair book instead of swapping in XIO/XRP", () => {
  const db = {
    pair: "XIO/XDX",
    bids: [{ price: 0.0000012, base_size: 4000, source: "bridge" }],
    asks: [{ price: 0.00000128, base_size: 100, source: "amm" }],
    source: "db",
  };
  const live = {
    pair: "XIO/XRP",
    bids: [{ price: 0.00003, base_size: 1000, source: "dex" }],
    asks: [],
    source: "xrpl",
  };
  const merged = mergeCatalogPayload("orderbook", db, live);
  assert.equal(merged.pair, "XIO/XDX");
  assert.equal(merged.bids[0].source, "bridge");
});

test("empty featured pair books take the live tape instead of staying blank", () => {
  const db = {
    pairs: ["XIO/XRP", "XIO/XSQUAD"],
    books: {
      "XIO/XRP": {
        pair: "XIO/XRP",
        bids: [{ price: 0.00003, base_size: 1000, source: "amm" }],
        asks: [{ price: 0.000031, base_size: 900, source: "amm" }],
      },
      "XIO/XSQUAD": {
        pair: "XIO/XSQUAD",
        present: false,
        catching_up: true,
        bids: [],
        asks: [],
      },
    },
    source: "db",
  };
  const live = {
    pairs: ["XIO/XRP", "XIO/XSQUAD"],
    books: {
      "XIO/XSQUAD": {
        pair: "XIO/XSQUAD",
        present: true,
        amm_implied: true,
        bids: [{ price: 0.00019, base_size: 5000, source: "amm" }],
        asks: [{ price: 0.0002, base_size: 4800, source: "amm" }],
      },
    },
    source: "xrpl",
  };
  const merged = mergeOrderbookCatalogs(db, live);
  assert.equal(merged.books["XIO/XRP"].bids[0].base_size, 1000);
  assert.equal(merged.books["XIO/XSQUAD"].bids[0].base_size, 5000);
  assert.equal(mergeCatalogPayload("orderbooks", db, live).books["XIO/XSQUAD"].asks[0].source, "amm");
});

test("overlayDbResultWithLive rewrites an empty 200 from Postgres", async () => {
  resetCatalogMemory();
  const overlaid = await overlayDbResultWithLive(
    "prices",
    { status: 200, body: JSON.stringify({ xioUsd: 0, xrpUsd: 1.4, source: "db" }), source: "postgres" },
    async () => ({ xioUsd: 0.00004, recorded_price: 0.00004, xrpUsd: 1.45, source: "xrpl" })
  );
  const body = JSON.parse(overlaid.body);
  assert.equal(body.xioUsd, 0.00004);
  assert.equal(body.source, "hybrid");
  assert.equal(overlaid.catalogOverlaid, true);
});

test("empty Railway rows take last-good when free APIs fail", async () => {
  resetCatalogMemory();
  rememberCatalog("prices", { xioUsd: 0.00004, recorded_price: 0.00004, source: "xrpl.to" });
  const overlaid = await overlayDbResultWithLive(
    "prices",
    { status: 200, body: JSON.stringify({ xioUsd: 0, source: "db" }), source: "postgres" },
    async () => {
      throw new Error("xrpl.to down");
    }
  );
  assert.equal(JSON.parse(overlaid.body).xioUsd, 0.00004);
});

test("already overlaid catalog results are not fetched twice", async () => {
  let calls = 0;
  const first = await overlayDbResultWithLive(
    "prices",
    { status: 200, body: JSON.stringify({ xioUsd: 0 }), source: "postgres", catalogOverlaid: true },
    async () => {
      calls += 1;
      return { xioUsd: 1 };
    }
  );
  assert.equal(calls, 0);
  assert.equal(JSON.parse(first.body).xioUsd, 0);
});

test("wallet rank keeps a Railway rank and fills a blank one", () => {
  const kept = mergeCatalogPayload(
    "wallet/rank/rABC",
    { account: "rABC", rank: 4, source: "db" },
    { account: "rABC", rank: 1, source: "xrpl.to" }
  );
  assert.equal(kept.rank, 4);
  const filled = mergeCatalogPayload(
    "wallet/rank/rABC",
    { account: "rABC", rank: null, source: "empty" },
    { account: "rABC", rank: 1, source: "xrpl.to" }
  );
  assert.equal(filled.rank, 1);
  assert.equal(filled.source, "xrpl");
});

test("Railway trade history merges with the live tape instead of hiding it", () => {
  const db = [{ timestamp: "2026-01-01T00:00:00.000Z", xio: 10, side: "buy" }];
  const live = [{ timestamp: "2026-08-24T00:00:00.000Z", xio: 99, side: "sell", source: "xrpl.to" }];
  const kept = mergeCatalogPayload("xio-flows", db, live);
  assert.equal(kept[0].xio, 99);
  assert.equal(kept[1].xio, 10);
  const empty = mergeCatalogPayload("xio-flows", [], live);
  assert.equal(empty[0].xio, 99);
});

test("serveCatalogFallback returns last-good when the free API throws", async () => {
  resetCatalogMemory();
  rememberCatalog("overview", { xioUsd: 0.00005, holder_count: 15000, source: "xrpl.to" });
  const result = await serveCatalogFallback("overview", async () => {
    throw new Error("down");
  });
  assert.equal(JSON.parse(result.body).holder_count, 15000);
  assert.equal(result.status, 200);
});
