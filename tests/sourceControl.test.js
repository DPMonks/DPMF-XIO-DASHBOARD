import test from "node:test";
import assert from "node:assert/strict";
import {catalogHealth, catalogMemoryKey, catalogMode, payloadUsable, preferUsable, recallCatalog, rememberCatalog, resetCatalogMemory} from "../server/sourceControl.js";
import {FREE_API_HEADERS, holdersFromXrplTo, flowsFromXrplToHistory, candlesFromOhlc, loadXrplToHolders, lpOwnersFromXrplTo, lpChartFromGraph, xrpSparkFromCoinGecko} from "../server/xrplToCatalog.js";

test("last-good catalog memory keeps a usable free-API payload", () => {
  resetCatalogMemory();
  assert.equal(payloadUsable("prices", { xioUsd: 0 }), false);
  assert.equal(rememberCatalog("prices", { xioUsd: 0.00004 }), true);
  assert.equal(recallCatalog("prices").xioUsd, 0.00004);
  const kept = preferUsable("prices", { xioUsd: 0, source: "db" }, recallCatalog("prices"));
  assert.equal(kept.xioUsd, 0.00004);
  assert.equal(catalogMode({ postgresDown: true, liveUsed: true }), "free");
  assert.equal(catalogMode({ dbUsed: true, liveUsed: true }), "hybrid");
  assert.equal(catalogMode({ dbUsed: true }), "railway");
  assert.equal(payloadUsable("prices/change24h", { xio: -3.6, source: "xrpl.to" }), true);
  assert.equal(payloadUsable("prices/change24h", { xio: 0, xrp: 0, source: "db" }), false);
  resetCatalogMemory();
});

test("catalog health reports armed Railway and active free failover", () => {
  const armed = catalogHealth({ postgresDown: false, dbOk: true });
  assert.equal(armed.status, "ok");
  assert.equal(armed.mode, "railway");
  assert.equal(armed.failover, "armed");
  const active = catalogHealth({ postgresDown: true, dbOk: false });
  assert.equal(active.status, "degraded");
  assert.equal(active.mode, "free");
  assert.equal(active.failover, "active");
});

test("xrpl.to rich list and OHLC map onto dashboard shapes", () => {
  const page = holdersFromXrplTo({
    length: 19973,
    richList: [{ account: "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8", balance: 3004952684.62, rank: 1 }],
  });
  assert.equal(page.holders[0].rank, 1);
  assert.equal(page.count, 19973);
  assert.equal(page.catching_up, false);
  const candles = candlesFromOhlc({
    ohlc: [[1787526000000, 0.000047, 0.000048, 0.000046, 0.0000475, 10]],
  });
  assert.equal(candles.length, 1);
  assert.equal(candles[0].price_usd, 0.0000475);
  const flows = flowsFromXrplToHistory({
    data: [
      {
        paid: { currency: "XRP", value: 1 },
        got: { currency: "XIO", issuer: "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo", value: 20000 },
        taker: "r1",
        time: 1787526000,
      },
    ],
  });
  assert.equal(flows[0].side, "buy");
  assert.equal(flows[0].xio, 20000);
  assert.equal(flows[0].pool, "XIO/XRP");
});

test("free API fetches send a dashboard User-Agent so Cloudflare does not 403", async () => {
  assert.match(FREE_API_HEADERS["user-agent"], /DPMF-XIO-Dashboard/);
  let headers = {};
  const page = await loadXrplToHolders({
    limit: 1,
    fetchImpl: async (_url, options) => {
      headers = options.headers || {};
      return {
        ok: true,
        json: async () => ({ length: 1, richList: [{ account: "r1", balance: 2, rank: 1 }] }),
      };
    },
  });
  assert.equal(headers["user-agent"], "DPMF-XIO-Dashboard/1.1");
  assert.equal(page.holders[0].account, "r1");
});

test("LP rich lists and CoinGecko XRP sparks map onto indexer shapes", () => {
  const page = lpOwnersFromXrplTo(
    { length: 67, richList: [{ account: "rLp1", balance: 12.5, rank: 1 }] },
    { pool: "XIO/XRP" }
  );
  assert.equal(page.holders[0].lp_balance, 12.5);
  assert.equal(page.holders[0].pool_name, "XIO/XRP");
  assert.equal(page.catching_up, false);
  const chart = lpChartFromGraph([
    { timestamp: "2026-08-24T00:00:00.000Z", holders: 58, trustlines: 67 },
  ]);
  assert.equal(chart[0].lp_holder_count, 58);
  assert.equal(chart[0].lp_trustline_count, 67);
  const spark = xrpSparkFromCoinGecko({ prices: [[1_787_526_000_000, 1.48]] });
  assert.equal(spark[0].asset, "XRP");
  assert.equal(spark[0].price_usd, 1.48);
});

test("paginated rich-list memory is keyed by offset so pages do not twin", () => {
  resetCatalogMemory();
  const page0 = {
    holders: [{ rank: 1, account: "rBank", balance: 100 }],
    count: 200,
    source: "xrpl.to",
  };
  const page100 = {
    holders: [{ rank: 101, account: "rOther", balance: 1 }],
    count: 200,
    source: "xrpl.to",
  };
  assert.notEqual(
    catalogMemoryKey("top-holders", "?limit=100&offset=0"),
    catalogMemoryKey("top-holders", "?limit=100&offset=100")
  );
  assert.equal(rememberCatalog("top-holders", page0, "?limit=100&offset=0"), true);
  assert.equal(rememberCatalog("top-holders", page100, "?limit=100&offset=100"), true);
  assert.equal(recallCatalog("top-holders", "?limit=100&offset=0").holders[0].account, "rBank");
  assert.equal(recallCatalog("top-holders", "?limit=100&offset=100").holders[0].account, "rOther");
  resetCatalogMemory();
});
