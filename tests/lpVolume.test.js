import test from "node:test";
import assert from "node:assert/strict";
import {RLUSD_HEX, XIO_HEX, XDX_HEX, XDX_ISSUER} from "../src/constants/ledger.js";
import {attachPoolVolumes, catalogXioVolume24h, catalogXioVolume7d, pairFromTradeLegs, pickBestXioVolume, pickXrpPoolXioVolume, preferRailwayXioVolume, tickerFromCurrency, volumeCoverage, xioFromXrpVolume, xioVolumeFromDexscreenerPair, xioVolumeFromGeckoPool, xioVolumeFromTokenCard, dailyPricesFromOhlc, dailyXioFlowsFromOhlc, projectXioMarketDaysToPair, volumeDaysForHeldPairs, overlayPoolFlowVolumes, xrpVolumeFromOhlc} from "../src/utils/lpVolume.js";
import {composeWalletSnapshot, lpFeeEarnings, tradingFeeRate} from "../src/wallet/composeWallet.js";
import {flowsFromXrplToHistory} from "../server/xrplToCatalog.js";
import {applyPoolVolumes, dexscreenerPairForQuote, geckoPoolForQuote, loadPoolXioVolumes} from "../server/freeVolume.js";
import {mergePoolRow, mergeLiveOverview} from "../server/catalogSwitch.js";

test("history legs tag XIO/XRP, XIO/RLUSD, and other XIO pairs", () => {
  assert.equal(tickerFromCurrency({ currency: "XRP" }), "XRP");
  assert.equal(tickerFromCurrency({ currency: XIO_HEX }), "XIO");
  assert.equal(tickerFromCurrency({ currency: RLUSD_HEX }), "RLUSD");
  assert.equal(tickerFromCurrency({ currency: "XIO" }), "XIO");
  assert.equal(tickerFromCurrency({ currency: XDX_HEX }), "XIO");
  assert.equal(tickerFromCurrency({ currency: XDX_HEX, issuer: XDX_ISSUER }), "XIO");
  assert.equal(pairFromTradeLegs({ currency: XIO_HEX }, { currency: XDX_HEX, issuer: XDX_ISSUER }), "XIO/XDX");
  assert.equal(tickerFromCurrency({ currency: "504C580000000000000000000000000000000000" }), "PLX");
  assert.equal(pairFromTradeLegs({ currency: "XRP" }, { currency: "XIO" }), "XIO/XRP");
  assert.equal(pairFromTradeLegs({ currency: XIO_HEX }, { currency: RLUSD_HEX }), "XIO/RLUSD");
  const flows = flowsFromXrplToHistory({
    data: [
      {
        paid: { currency: "XRP", value: "1" },
        got: { currency: "XIO", value: "20000" },
        time: 1_787_526_000,
      },
      {
        paid: { currency: XIO_HEX, value: "8000" },
        got: { currency: RLUSD_HEX, value: "0.4" },
        time: 1_787_526_100,
      },
      {
        paid: { currency: "504C580000000000000000000000000000000000", value: "10" },
        got: { currency: "XIO", value: "500" },
        time: 1_787_526_200,
      },
    ],
  });
  assert.equal(flows[0].pool, "XIO/XRP");
  assert.equal(flows[1].pool, "XIO/RLUSD");
  assert.equal(flows[2].pool, "XIO/PLX");
});

test("token card, OHLC, and Dexscreener convert into XIO, never USD", () => {
  const exch = 3.13e-5;
  assert.ok(Math.abs(xioFromXrpVolume(133.325657, exch) - 133.325657 / exch) < 1e-6);
  assert.equal(xioVolumeFromTokenCard({ vol24hXrp: 133.325657, exchXrp: exch }), 133.325657 / exch);
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  const xrpVol = xrpVolumeFromOhlc(
    [
      [now - 3_600_000, 0.000047, 0.000048, 0.000046, 0.000047, 40],
      [now - 90_000_000, 0.000047, 0.000048, 0.000046, 0.000047, 999],
      [now - 2_000_000, 0.000047, 0.000048, 0.000046, 0.000047, 86.7],
    ],
    { now, windowMs: 24 * 60 * 60 * 1000 }
  );
  assert.ok(Math.abs(xrpVol - 126.7) < 1e-9);
  const daily = dailyXioFlowsFromOhlc(
    [
      [Date.parse("2026-07-01T00:00:00.000Z"), 0.00004, 0.00004, 0.00004, 0.00004, 2],
      [Date.parse("2026-08-20T00:00:00.000Z"), 0.00004, 0.00004, 0.00004, 0.00004, 3],
      [Date.parse("2026-08-21T00:00:00.000Z"), 0.00004, 0.00004, 0.00004, 0.00004, 4],
    ],
    { xrpPerXio: 0.00004, now: Date.parse("2026-08-25T00:00:00.000Z"), maxDays: 365 }
  );
  assert.equal(daily.length, 3);
  assert.equal(daily[0].pair, "XIO/XRP");
  const marks = dailyPricesFromOhlc(
    [
      [Date.parse("2026-08-20T00:00:00.000Z"), 0.00003, 0.00004, 0.00003, 0.00004, 3],
      [Date.parse("2026-08-21T00:00:00.000Z"), 0.00004, 0.00005, 0.00004, 0.00008, 4],
    ],
    { xrpUsd: 2, now: Date.parse("2026-08-25T00:00:00.000Z") }
  );
  assert.equal(marks["2026-08-20"].xioUsd, 0.00004);
  assert.equal(marks["2026-08-21"].xioUsd, 0.00008);
  assert.equal(marks["2026-08-20"].xrpUsd, 2);
  assert.ok(Math.abs(daily.find((row) => row.timestamp.startsWith("2026-08-21")).xio - 100_000) < 1e-6);
  const projected = projectXioMarketDaysToPair(
    [
      { pair: "XIO/XRP", xio: 2_000_000, timestamp: "2026-08-16T00:00:00.000Z" },
      { pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-27T00:00:00.000Z" },
    ],
    "XIO/XAH",
    50_000,
    Date.parse("2026-08-27T18:00:00.000Z")
  );
  assert.equal(projected.length, 2);
  assert.equal(projected.every((row) => row.pair === "XIO/XAH"), true);
  assert.ok(Math.abs(projected.find((row) => row.date === "2026-08-27").xio - 50_000) < 1e-6);
  assert.ok(Math.abs(projected.find((row) => row.date === "2026-08-16").xio - 100_000) < 1e-6);
  const held = volumeDaysForHeldPairs(
    [{ pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-27T00:00:00.000Z" }],
    [{ pool: "XIO/XAH", volume24hXio: 20_000 }, { pool: "XIO/XRP", volume24hXio: 1_000_000 }],
    Date.parse("2026-08-27T18:00:00.000Z")
  );
  assert.ok(held.some((row) => row.pair === "XIO/XRP"));
  assert.ok(held.some((row) => row.pair === "XIO/XAH" && Math.abs(row.xio - 20_000) < 1e-6));
  const dex = xioVolumeFromDexscreenerPair(
    { volume: { h24: 183.33 }, priceUsd: 0.00004734 },
    0.00004734
  );
  assert.ok(Math.abs(dex - 183.33 / 0.00004734) < 1e-6);
  const gecko = xioVolumeFromGeckoPool(
    { attributes: { volume_usd: { h24: 180 }, base_token_price_usd: 0.000047 } },
    0.000047
  );
  assert.ok(Math.abs(gecko - 180 / 0.000047) < 1e-6);
});

test("USD-mistaken catalog volume24h is not treated as XIO", () => {
  const usdMistaken = catalogXioVolume24h({
    volume24h: 197.3,
    volume24hXrp: 133.325,
    xrpUsd: 1.48,
    xioPerXrp: 3.13e-5,
  });
  assert.ok(usdMistaken > 4_000_000);
  assert.ok(Math.abs(usdMistaken - 133.325 / 3.13e-5) < 1);
  assert.equal(catalogXioVolume24h({ volume24h: 20_000 }), 20_000);
  assert.equal(catalogXioVolume7d({ volume7dXio: 9_000_000 }), 9_000_000);
});

test("truncated tape cannot beat a complete token or OHLC card", () => {
  const best = pickBestXioVolume([
    { value: 2_956_536, complete: false, source: "xrpl.to-history" },
    { value: 4_261_038, complete: true, source: "xrpl.to-token" },
    { value: 4_047_923, complete: true, source: "xrpl.to-ohlc" },
  ]);
  assert.equal(best.source, "xrpl.to-token");
  assert.equal(best.value, 4_261_038);
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  const truncated = volumeCoverage({
    rows: Array.from({ length: 200 }, (_, index) => ({
      timestamp: new Date(now - index * 300_000).toISOString(),
    })),
    now,
    cap: 200,
  });
  assert.equal(truncated.complete, false);
  assert.equal(truncated.capped, true);
  const covered = volumeCoverage({
    rows: Array.from({ length: 200 }, (_, index) => ({
      timestamp: new Date(now - index * 620_000).toISOString(),
    })),
    now,
    cap: 200,
  });
  assert.equal(covered.complete, true);
  const xrpPool = pickXrpPoolXioVolume({
    tokenXio: 4_261_038,
    ohlcXio: 929_380,
    dexXio: 3_872_623,
    geckoXio: 3_865_000,
    histXio: 2_750_181,
    histComplete: true,
  });
  assert.equal(xrpPool.source, "dexscreener");
  assert.equal(xrpPool.value, 3_872_623);
});

test("Railway-down LP earnings use catalog XIO volume, not a short tape", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  const share = 10;
  const volume24hXio = 4_261_038;
  const volume7dXio = 30_000_000;
  const fees = lpFeeEarnings(
    [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: share,
        withdraw_estimate_xio: 1_000_000,
        trading_fee: 1000,
        reserve_asset: 64_769_923,
        reserve_currency: 2_043.896,
        volume24h: 197.3,
        volume24hXio,
        volume7dXio,
        xioUsd: 0.0000467,
        xrpUsd: 1.48,
        xioPerXrp: 3.13e-5,
      },
    ],
    {
      xioUsd: 0.0000467,
      xrpUsd: 1.48,
      now,
      flows: [
        { pool: "XIO/XRP", xio: 2_956_536, timestamp: "2026-08-24T10:00:00.000Z" },
        { pool: "XIO/PLX", xio: 800_000, timestamp: "2026-08-24T10:00:00.000Z" },
      ],
    }
  );
  const dayFee = volume24hXio * 0.01 * 0.1;
  const weekFee = volume7dXio * 0.01 * 0.1;
  assert.ok(Math.abs(fees.xio - dayFee) < 1e-6);
  assert.ok(Math.abs(fees.earnings.xio24h - dayFee / 2) < 1e-6);
  assert.ok(Math.abs(fees.earnings.xio7d - weekFee / 2) < 1e-6);
  assert.ok(fees.earnings.xrp24h > 0);
  assert.ok(fees.earnings.usd24h > 0);
});

test("connected wallet snapshot earns from live catalog when Railway flows are empty", () => {
  const snap = composeWalletSnapshot({
    address: "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8",
    balances: { xrp: 57.13, xio: 3_004_952_684 },
    prices: { xioUsd: 0.0000467, xrpUsd: 1.48 },
    token: { circulating: 10_000_000_000, xioPerXrp: 3.13e-5 },
    pools: [
      {
        pool_name: "XIO/XRP",
        lp_supply: 230_909_304,
        reserve_asset: 64_769_923,
        reserve_currency: 2_043.896,
        trading_fee: 1000,
        volume24hXio: 4_261_038,
        volume7dXio: 30_000_000,
        xioUsd: 0.0000467,
        xrpUsd: 1.48,
      },
      {
        pool_name: "XIO/RLUSD",
        lp_supply: 100_000,
        reserve_asset: 8_000,
        reserve_currency: 10,
        trading_fee: 1000,
        volume24hXio: 50_000,
        volume7dXio: 200_000,
      },
    ],
    lpRows: [
      { pool_name: "XIO/XRP", lp_balance: 2_309_093.04 },
      { pool_name: "XIO/RLUSD", lp_balance: 17_907 },
    ],
    flows: [],
  });
  assert.ok(snap.lp[0].lp_share_percent > 0);
  assert.ok(snap.fees.earnings.xio24h > 0);
  assert.ok(snap.fees.earnings.xrp24h > 0);
  assert.ok(snap.fees.earnings.rlusd24h > 0);
  assert.ok(snap.fees.earnings.usd24h > 0);
  const xrpShare = 2_309_093.04 / 230_909_304;
  const rlusdShare = 17_907 / 100_000;
  const expectedXio =
    (4_261_038 * 0.01 * xrpShare) / 2 + (50_000 * 0.01 * rlusdShare) / 2;
  assert.ok(Math.abs(snap.fees.earnings.xio24h - expectedXio) < 1e-6);
});

test("Railway XIO volume wins over live; USD leftovers do not", () => {
  const railway = preferRailwayXioVolume(
    { volume24h: 5_500_000, source: "db" },
    { volume24hXio: 4_200_000, volumeSource: "xrpl.to-token" }
  );
  assert.equal(railway.volume24hXio, 5_500_000);
  assert.equal(railway.volumeSource, "db");
  const usdLeft = preferRailwayXioVolume(
    { volume24h: 197, xrpUsd: 1.48, source: "db" },
    { volume24hXio: 4_200_000, volumeSource: "xrpl.to-token" }
  );
  assert.equal(usdLeft.volume24hXio, 4_200_000);
  const merged = mergePoolRow({ volume24h: 197, reserve_asset: 1 }, { volume24hXio: 4_200_000, reserve_asset: 64 });
  assert.equal(merged.volume24h, 4_200_000);
  const overview = mergeLiveOverview(
    { volume24h: 0, xioUsd: 0, source: "db" },
    { volume24h: 4_200_000, volume24hXio: 4_200_000, xioUsd: 0.000046, source: "xrpl" }
  );
  assert.equal(overview.volume24h, 4_200_000);
});

test("free volume cascade prefers complete pair APIs and scales 7d from OHLC", async () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  const hour = 3_600_000;
  const ohlc = Array.from({ length: 48 }, (_, index) => [
    now - index * hour,
    0.000047,
    0.000048,
    0.000046,
    0.000047,
    index < 24 ? 5 : 8,
  ]);
  const byPair = await loadPoolXioVolumes({
    now,
    fresh: true,
    token: { vol24hXrp: 120, exchXrp: 0.00003 },
    xioUsd: 0.000045,
    xrpUsd: 1.5,
    fetchImpl: async (url) => {
      const target = String(url || "");
      if (target.includes("/ohlc/")) return { ok: true, json: async () => ({ ohlc }) };
      if (target.includes("dexscreener")) {
        return {
          ok: true,
          json: async () => ({
            pairs: [
              {
                chainId: "xrpl",
                baseToken: { symbol: "XIO" },
                quoteToken: { symbol: "XRP" },
                priceUsd: "0.000045",
                volume: { h24: 200 },
              },
              {
                chainId: "xrpl",
                baseToken: { symbol: "XIO" },
                quoteToken: { symbol: "RLUSD" },
                priceUsd: "0.000045",
                volume: { h24: 9 },
              },
            ],
          }),
        };
      }
      if (target.includes("geckoterminal")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { attributes: { name: "XIO / XRP", volume_usd: { h24: 190 }, base_token_price_usd: 0.000045 } },
              { attributes: { name: "XIO / RLUSD", volume_usd: { h24: 8 }, base_token_price_usd: 0.000045 } },
            ],
          }),
        };
      }
      if (target.includes("/history")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                paid: { currency: "XRP", value: "1" },
                got: { currency: "XIO", value: "1000" },
                time: now / 1000,
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  const xrp = byPair["XIO/XRP"];
  const rlusd = byPair["XIO/RLUSD"];
  assert.ok(xrp.volume24hXio > 1_000_000);
  assert.ok(xrp.volume7dXio > xrp.volume24hXio);
  assert.ok(rlusd.volume24hXio > 100);
  const pools = applyPoolVolumes(
    [{ pool: "XIO/XRP", reserve_asset: 1, reserve_currency: 1 }],
    byPair
  );
  assert.equal(pools[0].volumeUnit, "xio");
  assert.equal(pools[0].volume24h, xrp.volume24hXio);
  assert.equal(tradingFeeRate(1000), 0.01);
  assert.ok(dexscreenerPairForQuote({ pairs: [{ chainId: "xrpl", baseToken: { symbol: "XIO" }, quoteToken: { symbol: "RLUSD" } }] }, "RLUSD"));
  assert.ok(geckoPoolForQuote({ data: [{ attributes: { name: "XIO / RLUSD" } }] }, "RLUSD"));
  assert.ok(attachPoolVolumes({}, xrp).volume24hXio > 0);
});

test("every pool records 24h XIO volume, including new pairs with no tape", () => {
  const now = Date.parse("2026-08-25T18:00:00.000Z");
  const overlaid = overlayPoolFlowVolumes(
    [
      { pool: "XIO/XDX", volume24h: null },
      { pool: "XIO/NEWS" },
      { pool: "XIO/XRP", volume24h: 8_000_000 },
    ],
    [
      { pool: "XIO/XDX", xio: 1200, timestamp: "2026-08-25T10:00:00.000Z" },
      { pool: "XIO/XDX", xio: 800, timestamp: "2026-08-25T12:00:00.000Z" },
    ],
    now
  );
  assert.equal(overlaid[0].volume24h, 2000);
  assert.equal(overlaid[1].volume24h, 0);
  assert.equal(overlaid[1].volumeUnit, "xio");
  assert.equal(overlaid[2].volume24h, 8_000_000);
  const applied = applyPoolVolumes(
    [{ pool: "XIO/XSQUAD" }, { pool: "XIO/XDX" }],
    { "XIO/XDX": { volume24hXio: 2000, source: "xrpl.to-history" } }
  );
  assert.equal(applied[0].volume24h, 0);
  assert.equal(applied[0].volumeUnit, "xio");
  assert.equal(applied[1].volume24h, 2000);
  const kept = applyPoolVolumes([{ pool: "XIO/XRP", volume24h: 8_000_000 }], {});
  assert.equal(kept[0].volume24h, 8_000_000);
  const flicker = attachPoolVolumes({ pool: "XIO/XRP", volume24h: 8_000_000 }, { volume24hXio: 0, source: "empty" });
  assert.equal(flicker.volume24h, 8_000_000);
});
