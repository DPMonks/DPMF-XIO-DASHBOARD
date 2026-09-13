import test from "node:test";
import assert from "node:assert/strict";
import {applyLivePoolReserves, applySignedLpOwner, applyTradePoolReserves, applyTradePoolVolume, looksLikeLpAsQuote, rememberPoolVolume, rememberSignedLpOverlay, resetHeldPoolVolumes, rollingPoolVolume, compactPoolAmount, filterAmmPools, isLpPoolTrade, mergeAmmPoolLists, poolAssetTrustlineId, poolQuoteTicker, poolSplitMeta, searchAmmAccount, searchPairHint, signedLpAccount, tradePoolHint} from "../src/ammPools.js";
import {XIO_ISSUER, XIO_XRP_AMM, XIO_XRP_LP_HEX, XDX_ISSUER, xioTrustSetTxjson} from "../src/constants/ledger.js";
import {lpTrustSetTxjson, poolForQuote, quoteTrustSetTxjson, resolveQuote} from "../src/xaman/tradeTx.js";
import {knownLivePoolSpecs} from "../server/liveCatalog.js";

test("AMM pool search matches XIO / quote, pair, or AMM account", () => {
  const pools = [
    { pool: "XIO/XRP", quote: "XRP", amm_account: "rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB" },
    { pool: "XIO/RLUSD", quote: "RLUSD", amm_account: "rLbBzF9oxntVf4XxcyakNKJTci4yqSmQUu" },
    { pool: "XIO/PLX", quote: "PLX", amm_account: "rPlxPool" },
  ];
  assert.deepEqual(
    filterAmmPools(pools, "rlusd").map((row) => row.pool),
    ["XIO/RLUSD"]
  );
  assert.deepEqual(
    filterAmmPools(pools, "XIO / plx").map((row) => row.pool),
    ["XIO/PLX"]
  );
  assert.deepEqual(
    filterAmmPools(pools, "rhEwhut").map((row) => row.pool),
    ["XIO/XRP"]
  );
  assert.equal(filterAmmPools(pools, "").length, 3);
});

test("searchPairHint turns a quote ticker into an XIO pair", () => {
  assert.equal(searchPairHint("usdc"), "XIO/USDC");
  assert.equal(searchPairHint("xio / xio"), "XIO/XDX");
  assert.equal(searchPairHint("rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB"), "");
  assert.equal(searchAmmAccount("rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB"), "rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB");
});

test("mergeAmmPoolLists keeps a newly found live pool beside the catalog", () => {
  const merged = mergeAmmPoolLists(
    [{ pool: "XIO/XRP", amm_account: "rXrp" }],
    [{ pool: "XIO/USDC", amm_account: "rUsdc" }],
    [{ pool: "XIO/XRP", amm_account: "rXrp" }]
  );
  assert.deepEqual(
    merged.map((row) => row.pool),
    ["XIO/XRP", "XIO/USDC"]
  );
});

test("XRP pools use an XIO trustline; other pools use the quote asset", () => {
  assert.equal(poolAssetTrustlineId({ pool: "XIO/XRP", quote: "XRP" }), "XIO");
  assert.equal(poolAssetTrustlineId({ pool: "XIO/XDX", quote: "XIO" }), "XIO");
  assert.equal(poolAssetTrustlineId({ pool: "XIO/RLUSD" }), "RLUSD");
  assert.equal(poolQuoteTicker({ pool: "XIO/USDC" }), "USDC");
  const xioLine = xioTrustSetTxjson("rA");
  assert.equal(xioLine.LimitAmount.issuer, XIO_ISSUER);
  const xio = resolveQuote("XIO", { quote_issuer: XDX_ISSUER });
  assert.equal(quoteTrustSetTxjson("rA", xio).LimitAmount.issuer, XDX_ISSUER);
  const xrpPool = { pool: "XIO/XRP", quote: "XRP", amm_account: XIO_XRP_AMM, lp_currency: XIO_XRP_LP_HEX };
  const lp = lpTrustSetTxjson("rA", poolForQuote(resolveQuote("XRP"), [xrpPool], xrpPool));
  assert.equal(lp.LimitAmount.issuer, XIO_XRP_AMM);
  assert.equal(lp.LimitAmount.currency, XIO_XRP_LP_HEX);
});

test("compact pool amounts and 1 LP shares fit the ratio box", () => {
  assert.equal(compactPoolAmount(51709564.3635), "51.71M");
  assert.equal(compactPoolAmount(52421.3323), "52.42K");
  assert.equal(compactPoolAmount(0.5403), "0.5403");
  const meta = poolSplitMeta({
    reserve_asset: 51709564.3635,
    reserve_currency: 59.8319,
    lp_supply: 44896.6467,
  });
  assert.ok(Math.abs(meta.xioPerLp - 51709564.3635 / 44896.6467) < 1e-9);
  assert.ok(Math.abs(meta.quotePerLp - 59.8319 / 44896.6467) < 1e-9);
  assert.equal(meta.lpSupply, 44896.6467);
  const leaked = poolSplitMeta({
    pool: "XIO/XDX",
    quote: "XIO",
    reserve_asset: 51709564.3635,
    reserve_currency: 56027.4283,
    lp_supply: 56027.4283,
  });
  assert.equal(leaked.reserveQuote, null);
  assert.equal(looksLikeLpAsQuote({
    reserveXio: 63_105_563,
    reserveQuote: 220_406_408,
    lpSupply: 220_406_408,
    quote: "XRP",
  }), true);
});

test("live amm_info updates the ratio box after an LP deposit or withdraw", () => {
  const catalog = {
    pool: "XIO/XDX",
    reserve_asset: 40000000,
    reserve_currency: 80000,
    lp_supply: 40000,
    xioUsd: 0.00004,
    quote_usd: 1,
    xio_pct: 50,
    quote_pct: 50,
    split_basis: "usd",
  };
  const live = {
    reserve_xio: 51709564.3635,
    reserve_currency: 59.8319,
    lp_supply: 44896.6467,
    reserve_source: "amm_info",
  };
  const next = applyLivePoolReserves(catalog, live);
  assert.equal(next.reserve_asset, 51709564.3635);
  assert.equal(next.reserve_currency, 59.8319);
  assert.equal(next.lp_supply, 44896.6467);
  // Value-weighted at catalog USD marks: XIO side dominates in USD.
  assert.ok(next.xio_pct > 95);
  assert.ok(next.quote_pct < 5);
  assert.equal(next.split_basis, "usd");

  // Screenshot-like XIO/XDX: skewed raw counts but balanced USD at pool mark.
  const xdxCard = applyLivePoolReserves(
    {
      pool: "XIO/XDX",
      quote: "XDX",
      reserve_asset: 100,
      reserve_currency: 50_000_000,
      lp_supply: 80_000,
      xioUsd: 27.0875,
    },
    {
      reserve_xio: 149,
      reserve_currency: 75_280_000,
      lp_supply: 84_720,
      reserve_source: "amm_info",
    }
  );
  assert.ok(Math.abs(xdxCard.xio_pct - 50) < 0.2);
  assert.ok(Math.abs(xdxCard.quote_pct - 50) < 0.2);
  assert.equal(xdxCard.split_basis, "usd_pool");

  // Without USD marks, do not paint a raw unit/LP bar.
  const noUsd = applyLivePoolReserves(
    { pool: "XIO/XDX", reserve_asset: 149, reserve_currency: 75_280_000, lp_supply: 84_720 },
    { reserve_xio: 149, reserve_currency: 75_280_000, lp_supply: 84_720, reserve_source: "amm_info" }
  );
  assert.equal(noUsd.xio_pct, null);
  assert.equal(noUsd.quote_pct, null);
  const leakedLive = applyLivePoolReserves(catalog, {
    reserve_xio: 51709564.3635,
    reserve_currency: 56027.4283,
    lp_supply: 56027.4283,
    reserve_source: "amm_info",
  });
  assert.equal(leakedLive.reserve_currency, 80000);
  const leakedCatalog = applyLivePoolReserves(
    {
      pool: "XIO/XDX",
      quote: "XIO",
      reserve_asset: 51709564.3635,
      reserve_currency: 56027.4283,
      lp_supply: 56027.4283,
    },
    {
      reserve_xio: 51709564.3635,
      reserve_currency: 56027.4283,
      lp_supply: 56027.4283,
      reserve_source: "amm_info",
    }
  );
  assert.equal(leakedCatalog.reserve_currency, null);
  assert.equal(isLpPoolTrade({ trade: { action: "addLp", pair: "XIO/XDX" } }), true);
  assert.equal(isLpPoolTrade({ txjson: { TransactionType: "AMMWithdraw" } }), true);
  assert.equal(isLpPoolTrade({ trade: { action: "buy" } }), false);
  assert.equal(tradePoolHint({ trade: { pair: "XIO/XDX" } }), "XIO/XDX");
});


test("signed LP trade overlays still paint when quote looked like LP supply", () => {
  const pool = {
    pool: "XIO/XDX",
    quote: "XDX",
    reserve_asset: 51_709_564.3635,
    reserve_currency: 56027.4283,
    lp_supply: 56027.4283,
    xio_pct: 50,
    quote_pct: 50,
  };
  const traded = applyTradePoolReserves(pool, {
    trade: { action: "removeLp", pair: "XIO/XDX", withdraw: { base: 1_000_000, quote: 1000 }, lpAmount: 1000 },
  });
  const live = {
    reserve_xio: traded.reserve_asset,
    reserve_asset: traded.reserve_asset,
    reserve_currency: traded.reserve_currency,
    lp_supply: traded.lp_supply,
    reserve_source: "trade",
  };
  const painted = applyLivePoolReserves(pool, live);
  assert.equal(painted.reserve_asset, traded.reserve_asset);
  assert.equal(painted.lp_supply, traded.lp_supply);
  assert.notEqual(painted.reserve_asset, pool.reserve_asset);
});

test("single-sided remove with zero opposing leg still shrinks that reserve", () => {
  const pool = {
    pool: "XIO/XDX",
    quote: "XDX",
    reserve_asset: 1000,
    reserve_currency: 40,
    lp_supply: 200,
  };
  const removed = applyTradePoolReserves(pool, {
    trade: {
      action: "removeLp",
      pair: "XIO/XDX",
      withdraw: { base: 0, quote: 8 },
      lpAmount: 20,
      singleAsset: "quote",
    },
  });
  assert.equal(removed.reserve_asset, 1000);
  assert.equal(removed.reserve_currency, 32);
  assert.equal(removed.lp_supply, 180);
});

test("add or remove LP updates the card from the signed amounts immediately", () => {
  const pool = {
    pool: "XIO/XDX",
    quote: "XIO",
    reserve_asset: 1000,
    reserve_currency: 40,
    lp_supply: 200,
  };
  const added = applyTradePoolReserves(pool, {
    trade: { action: "addLp", pair: "XIO/XDX", amount: 100, quoteQty: 4, lpOut: 20 },
  });
  assert.equal(added.reserve_asset, 1100);
  assert.equal(added.reserve_currency, 44);
  assert.equal(added.lp_supply, 220);
  const removed = applyTradePoolReserves(added, {
    trade: { action: "removeLp", pair: "XIO/XDX", withdraw: { base: 50, quote: 2 }, lpAmount: 10 },
  });
  assert.equal(removed.reserve_asset, 1050);
  assert.equal(removed.reserve_currency, 42);
  assert.equal(removed.lp_supply, 210);
  const leaked = applyTradePoolReserves(
    {
      pool: "XIO/XDX",
      quote: "XIO",
      reserve_asset: 51_709_564.3635,
      reserve_currency: 56027.4283,
      lp_supply: 56027.4283,
    },
    { trade: { action: "addLp", pair: "XIO/XDX", amount: 100, quoteQty: 4, lpOut: 20 } }
  );
  assert.equal(leaked.reserve_currency, 4);
  assert.equal(leaked.lp_supply, 56047.4283);
});

test("rolling 24h volume keeps the last positive total when a refresh drops to 0", () => {
  resetHeldPoolVolumes();
  assert.equal(rollingPoolVolume(10_645_018, 0), 10_645_018);
  assert.equal(rollingPoolVolume(0, 10_645_018), 10_645_018);
  assert.equal(rollingPoolVolume(null, 2_000), 2_000);
  assert.equal(rollingPoolVolume(12_000, 10_000), 12_000);
  assert.equal(rollingPoolVolume(0, 0), 0);
  assert.equal(rememberPoolVolume("XIO/XRP", 10_645_018, 0), 10_645_018);
  assert.equal(rememberPoolVolume("XIO/XRP", 0, 0), 10_645_018);
  assert.equal(rememberPoolVolume("XIO/XRP", 11_000_000, 0), 11_000_000);
  resetHeldPoolVolumes();
});

test("a signed buy or sell adds XIO to that pool's 24h volume immediately", () => {
  const pool = { pool: "XIO/XDX", volume24h: 100 };
  const bought = applyTradePoolVolume(pool, { trade: { action: "buy", pair: "XIO/XDX", amount: 50 } });
  assert.equal(bought.volume24h, 150);
  assert.equal(bought.volumeUnit, "xio");
  const other = applyTradePoolVolume(pool, { trade: { action: "buy", pair: "XIO/XRP", amount: 50 } });
  assert.equal(other.volume24h, 100);
  const fresh = applyTradePoolVolume({ pool: "XIO/NEWS" }, { trade: { action: "sell", pair: "XIO/NEWS", amount: 25 } });
  assert.equal(fresh.volume24h, 25);
});

test("a signed add LP paints the owner on that pair immediately", () => {
  const detail = {
    account: "rDPMFBANKMexTKkC7e4Add",
    trade: { action: "addLp", pair: "XIO/XAH", lpOut: 12.5 },
  };
  assert.equal(signedLpAccount(detail), "rDPMFBANKMexTKkC7e4Add");
  const added = applySignedLpOwner(
    [
      { account: "rWhale", pair: "XIO/XAH", lp_balance: 100, rank: 1 },
      { account: "rOther", pair: "XIO/XRP", lp_balance: 50, rank: 2 },
    ],
    detail
  );
  const row = added.find((item) => item.account === "rDPMFBANKMexTKkC7e4Add");
  assert.equal(row.pair, "XIO/XAH");
  assert.equal(row.lp_balance, 12.5);
  assert.equal(row.live, true);
  assert.equal(row.rank, 3);

  const bumped = applySignedLpOwner(added, {
    account: "rDPMFBANKMexTKkC7e4Add",
    trade: { action: "addLp", pair: "XIO/XAH", lpOut: 5 },
  });
  assert.equal(
    bumped.find((item) => item.account === "rDPMFBANKMexTKkC7e4Add").lp_balance,
    17.5
  );

  const held = applySignedLpOwner(bumped, {
    account: "rDPMFBANKMexTKkC7e4Add",
    trade: { action: "addLp", pair: "XIO/XAH", lpOut: 1 },
    lpHeld: 37.41657387,
  });
  assert.equal(
    held.find((item) => item.account === "rDPMFBANKMexTKkC7e4Add").lp_balance,
    37.41657387
  );

  const removed = applySignedLpOwner(held, {
    account: "rDPMFBANKMexTKkC7e4Add",
    trade: { action: "removeLp", pair: "XIO/XAH", lpAmount: 37.41657387 },
  });
  assert.equal(
    removed.some((item) => item.account === "rDPMFBANKMexTKkC7e4Add"),
    false
  );
  assert.equal(
    applySignedLpOwner(held, { trade: { action: "buy", pair: "XIO/XAH", amount: 10 } }, "rSkip")
      .find((item) => item.account === "rDPMFBANKMexTKkC7e4Add").lp_balance,
    37.41657387
  );

  const remembered = rememberSignedLpOverlay(
    [{ account: "rWhale", pair: "XIO/XAH", lp_balance: 100 }],
    detail
  );
  assert.equal(remembered.overlay.detail.lpHeld, 12.5);
  assert.equal(remembered.overlay.account, "rDPMFBANKMexTKkC7e4Add");
});

test("known live pool specs include featured XIO quotes, not only XRP and RLUSD", () => {
  const pairs = knownLivePoolSpecs().map((row) => row.pair);
  assert.ok(pairs.includes("XIO/XRP"));
  assert.ok(pairs.includes("XIO/RLUSD"));
  assert.ok(pairs.includes("XIO/XDX"));
  assert.ok(pairs.includes("XIO/XSQUAD"));
  const squad = knownLivePoolSpecs().find((row) => row.pair === "XIO/XSQUAD");
  assert.equal(squad.ammAccount || squad.amm, "rwpht3XDGMhzYmT5V6ZyMyg6Uc37XFLSwv");
});
