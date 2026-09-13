import test from "node:test";
import assert from "node:assert/strict";
import {composeWalletSnapshot, emptyWalletSnapshot, preferFilledWalletSnapshot, walletAvailableAmounts, lpFeeEarnings, lpPositionFromPool, resolveLpPairName, normalizeWalletPair, preferredWalletPair, sortWalletPairs, supplyShares, tradingFeeRate, ammFeePercent, formatAmmFee, walletActivity, withdrawQuoteLabel, xrpBarPercents, xrpReserveBreakdown, xioFiatValues} from "../src/wallet/composeWallet.js";

test("xrpReserveBreakdown stacks spendable on top of base and owner reserve", () => {
  const row = xrpReserveBreakdown({
    balance: 25,
    ownerCount: 10,
    reserveBaseDrops: 1_000_000,
    reserveIncDrops: 200_000,
  });
  assert.equal(row.baseReserve, 1);
  assert.equal(row.ownerReserve, 2);
  assert.equal(row.reserved, 3);
  assert.equal(row.spendable, 22);
});

test("xrpReserveBreakdown prefers ledger drops and does not reserve more than the total", () => {
  const row = xrpReserveBreakdown({
    balance: 0,
    balanceDrops: 25_000_000,
    ownerCount: 10,
    reserveBaseDrops: 1_000_000,
    reserveIncDrops: 200_000,
  });
  assert.equal(row.balance, 25);
  assert.equal(row.reserved, 3);
  assert.equal(row.spendable, 22);

  const emptyHold = xrpReserveBreakdown({
    balance: 0,
    balanceDrops: 0,
    ownerCount: 25,
  });
  assert.equal(emptyHold.balance, null);
  assert.equal(emptyHold.reserved, null);
  assert.equal(emptyHold.spendable, null);
  assert.equal(emptyHold.required, null);

  const missingLedger = xrpReserveBreakdown({
    balance: 18.5,
    balanceDrops: null,
    ownerCount: 4,
  });
  assert.equal(missingLedger.balance, 18.5);
  assert.equal(missingLedger.spendable, 16.7);
});

test("xrpBarPercents keeps total XRP as a full reference bar", () => {
  const bars = xrpBarPercents({ reserved: 3, spendable: 22, total: 25 });
  assert.equal(bars.reservePct, 12);
  assert.equal(bars.spendPct, 88);
  assert.equal(bars.totalPct, 100);

  const zero = xrpBarPercents({ reserved: 0, spendable: 0, total: 0 });
  assert.equal(zero.reservePct, 0);
  assert.equal(zero.spendPct, 0);
  assert.equal(zero.totalPct, 0);

  const blank = xrpBarPercents({ reserved: 3, spendable: 22, total: 25 }, false);
  assert.equal(blank.totalPct, 0);
});

test("supplyShares compares the wallet to circulating and total XIO, never above 100%", () => {
  const shares = supplyShares(1_200_000, 10_000_000_000, 10_000_000_000);
  assert.ok(Math.abs(shares.circulatingPct - 0.012) < 1e-9);
  assert.ok(Math.abs(shares.supplyPct - 0.012) < 1e-9);

  const capped = supplyShares(20_000_000_000, 5_000_000_000, 10_000_000_000);
  assert.equal(capped.circulatingPct, 100);
  assert.equal(capped.supplyPct, 100);
});

test("preferredWalletPair always defaults to XIO/XRP when that pool is held", () => {
  assert.deepEqual(sortWalletPairs(["XIO/USDC", "XIO/XRP", "XIO/RLUSD"]), [
    "XIO/XRP",
    "XIO/RLUSD",
    "XIO/USDC",
  ]);
  assert.equal(preferredWalletPair(["XIO/USDC", "XIO/XRP"], ""), "XIO/XRP");
  assert.equal(preferredWalletPair(["XIO/USDC", "XIO/XRP"], "XIO/XRP"), "XIO/XRP");
  assert.equal(preferredWalletPair(["XIO/USDC", "XIO/XRP"], "XIO/USDC"), "XIO/USDC");
  assert.equal(preferredWalletPair(["XIO/USDC"], ""), "XIO/USDC");
});

test("xioFiatValues keeps USD and GBP from recorded prices", () => {
  const fiat = xioFiatValues(1000, { xioUsd: 0.00004, xioGbp: 0.00003, xioXrp: 0.00003 });
  assert.ok(Math.abs(fiat.usd - 0.04) < 1e-12);
  assert.ok(Math.abs(fiat.gbp - 0.03) < 1e-12);
  assert.ok(Math.abs(fiat.xrp - 0.03) < 1e-12);
  assert.ok(Math.abs(fiat.rlusd - 0.04) < 1e-12);
});

test("xioFiatValues prices the XIO stack in XRP and RLUSD, not other wallet holdings", () => {
  const stack = 3_004_952_684.62;
  const fiat = xioFiatValues(stack, {
    xioUsd: 0.0000498,
    xrpUsd: 2.62,
    rlusdUsd: 1,
    xioXrp: 0.000019,
  });
  assert.equal(fiat.xio, stack);
  assert.ok(Math.abs(fiat.xrp - stack * 0.000019) < 1e-6);
  assert.ok(Math.abs(fiat.rlusd - stack * 0.0000498) < 1e-4);
  assert.ok(fiat.xrp > 50_000);
  assert.ok(Math.abs(fiat.rlusd - 149_646.64) < 1);
});

test("xioFiatValues fills XRP worth from USD when the XIO/XRP mark is missing", () => {
  const fiat = xioFiatValues(1_000_000, { xioUsd: 0.00005, xrpUsd: 2 });
  assert.ok(Math.abs(fiat.usd - 50) < 1e-12);
  assert.ok(Math.abs(fiat.xrp - 25) < 1e-12);
  assert.ok(Math.abs(fiat.rlusd - 50) < 1e-12);
});

test("xioFiatValues fills EUR and JPY from XRP FX when those marks are missing", () => {
  const fiat = xioFiatValues(1000, {
    xioUsd: 0.00005,
    xrpUsd: 2,
    xrpEur: 1.8,
    xrpJpy: 300,
    xioXrp: 0.000025,
  });
  assert.ok(Math.abs(fiat.usd - 0.05) < 1e-12);
  assert.ok(Math.abs(fiat.eur - 0.045) < 1e-12);
  assert.ok(Math.abs(fiat.jpy - 7.5) < 1e-12);
  assert.equal(fiat.gbp, null);
});

test("resolveLpPairName does not stamp an unknown LP line as XIO/XRP", () => {
  assert.equal(
    resolveLpPairName({
      pool_name: "XIO/XRP",
      amm_account: "rXsquadAmm11111111111111111111111",
      lp_currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      quote: "XSQUAD",
    }),
    "XIO/XSQUAD"
  );
  assert.equal(
    resolveLpPairName(
      {
        amm_account: "rXsquadAmm11111111111111111111111",
        lp_currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      "XIO/XRP"
    ) === "XIO/XRP",
    false
  );
  const row = lpPositionFromPool(80, {
    quote: "XSQUAD",
    amm_account: "rXsquadAmm11111111111111111111111",
    lp_currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    lp_supply: 800,
    reserve_asset: 1000,
    reserve_currency: 40,
  });
  assert.equal(row.pool, "XIO/XSQUAD");
  assert.equal(row.quote, "XSQUAD");
});

test("withdrawQuoteLabel names the other asset in the pair", () => {
  assert.equal(withdrawQuoteLabel("XSQUAD"), "Withdraw XSQUAD quote");
  assert.equal(withdrawQuoteLabel("BTC", "Withdraw {asset} quote"), "Withdraw BTC quote");
  assert.equal(withdrawQuoteLabel("", "Withdraw {asset} quote"), "Withdraw quote");
});

test("lpPositionFromPool estimates withdraw from pool share", () => {
  const row = lpPositionFromPool(100, {
    pool_name: "XIO/XRP",
    lp_supply: 1000,
    reserve_asset: 50_000,
    reserve_currency: 2,
    xio_pct: 55,
    quote_pct: 45,
  });
  assert.equal(row.lp_share_percent, 10);
  assert.equal(row.withdraw_estimate_xio, 5000);
  assert.equal(row.withdraw_estimate_quote, 0.2);
});

test("lpPositionFromPool keeps a known share when catalog supply is missing", () => {
  const row = lpPositionFromPool(2840.23, {
    pool_name: "XIO/USDC",
    quote: "USDC",
    lp_share_percent: 1.25,
    withdraw_estimate_xio: 4000,
    withdraw_estimate_quote: 12.5,
  });
  assert.equal(row.pool, "XIO/USDC");
  assert.equal(row.lp_share_percent, 1.25);
  assert.equal(row.withdraw_estimate_xio, 4000);
  assert.equal(row.withdraw_estimate_quote, 12.5);
});

test("composeWalletSnapshot fills non-XRP LP share and does not drop it when AMM supply is blank", () => {
  const computed = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 10, xio: 1 },
    token: { circulating: 10_000_000_000 },
    pools: [
      { pool_name: "XIO/USDC", quote: "USDC", lp_supply: 284_023, reserve_asset: 80_000, reserve_currency: 250 },
    ],
    lpRows: [{ pool_name: "XIO/USDC", lp_balance: 2840.23 }],
  });
  const usdc = computed.lp.find((row) => row.pool === "XIO/USDC");
  assert.ok(usdc);
  assert.ok(Math.abs(usdc.lp_share_percent - 1) < 1e-9);
  assert.ok(Math.abs(usdc.withdraw_estimate_xio - 800) < 1e-6);
  assert.ok(Math.abs(usdc.withdraw_estimate_quote - 2.5) < 1e-6);

  const kept = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 10, xio: 1 },
    token: { circulating: 10_000_000_000 },
    pools: [{ pool_name: "XIO/USDC", quote: "USDC" }],
    lpRows: [
      {
        pool_name: "XIO/USDC",
        lp_balance: 2840.23,
        lp_share_percent: 1.25,
        withdraw_estimate_xio: 4000,
        withdraw_estimate_quote: 12.5,
      },
    ],
  });
  const keptUsdc = kept.lp.find((row) => row.pool === "XIO/USDC");
  assert.equal(keptUsdc.lp_share_percent, 1.25);
  assert.equal(keptUsdc.withdraw_estimate_xio, 4000);
});

test("composeWalletSnapshot keeps every LP pair and the rich-list rank", () => {
  assert.equal(normalizeWalletPair("rlusd"), "XIO/RLUSD");
  const filled = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 0, xio: 5000 },
    account: { balance_drops: 12_000_000, owner_count: 5 },
    prices: { xioUsd: 0.00004, xioGbp: 0.00003 },
    token: { circulating: 10_000_000_000, xioPerXrp: 0.00003 },
    rank: 4,
    pools: [
      { pool_name: "XIO/XRP", lp_supply: 1000, reserve_asset: 50_000, reserve_currency: 2, xio_pct: 50, quote_pct: 50 },
      { pool_name: "XIO/RLUSD", lp_supply: 200, reserve_asset: 8000, reserve_currency: 10, xio_pct: 40, quote_pct: 60 },
    ],
    lpRows: [
      { pool_name: "XIO/XRP", lp_balance: 100 },
      { pool: "XIO/RLUSD", lp_balance: 20 },
    ],
  });
  assert.equal(filled.rank, 4);
  assert.equal(filled.xrp.balance, 12);
  assert.deepEqual(
    filled.lp.map((row) => row.pool).sort(),
    ["XIO/RLUSD", "XIO/XRP"]
  );
  const rlusd = filled.lp.find((row) => row.pool === "XIO/RLUSD");
  assert.equal(rlusd.withdraw_estimate_xio, 800);
});

test("composeWalletSnapshot keeps DB XRP when ledger drops are missing", () => {
  const filled = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 18.5, xio: 5000 },
    account: { balance_drops: null, owner_count: 4 },
    prices: { xioUsd: 0.00004, xrpUsd: 2 },
    token: { circulating: 10_000_000_000 },
  });
  assert.equal(filled.xrp.balance, 18.5);
  assert.ok(filled.xrp.spendable > 0);
});

test("composeWalletSnapshot does not treat a failed XRP lookup as a zero hold", () => {
  const missed = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 0, xio: 5000 },
    account: { balance_drops: 0, owner_count: 4, source: "empty" },
    prices: { xioUsd: 0.00004, xrpUsd: 2 },
    token: { circulating: 10_000_000_000 },
    lpRows: [{ pool_name: "XIO/XRP", lp_balance: 10 }],
    pools: [{ pool_name: "XIO/XRP", lp_supply: 1000, reserve_asset: 50_000, reserve_currency: 2 }],
  });
  assert.equal(missed.xrp.balance, null);
  assert.equal(missed.xrp.reserved, null);
  assert.equal(missed.xrp.spendable, null);
  assert.equal(missed.filled, true);
  assert.equal(xrpBarPercents({ reserved: 0, spendable: 0, total: missed.xrp.balance || 0 }).totalPct, 0);
});

test("walletAvailableAmounts reports spendable XRP and issued quote", () => {
  const hold = walletAvailableAmounts({
    balances: { xrp: 10, xio: 2000 },
    account: { balance_drops: 12_000_000, owner_count: 5 },
    quote: { currency: "XRP" },
  });
  assert.equal(hold.xrp, 10);
  assert.equal(hold.xio, 2000);
  assert.equal(hold.quote, 10);

  const rlusd = walletAvailableAmounts({
    balances: { xrp: 4, xio: 100 },
    lines: [{ currency: "RLUSD", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", balance: "12.5" }],
    quote: { currency: "RLUSD", issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", id: "RLUSD" },
  });
  assert.equal(rlusd.quote, 12.5);

  const usdc = walletAvailableAmounts({
    balances: { xrp: 8, xio: 50 },
    lines: [{ currency: "5553444300000000000000000000000000000000", issuer: "rUsdcIssuer", ticker: "USDC", balance: "77.25" }],
    quote: { id: "USDC", currency: "USDC", pair: "XIO/USDC" },
  });
  assert.equal(usdc.quote, 77.25);
  assert.notEqual(usdc.quote, usdc.xrp);
});

test("preferFilledWalletSnapshot keeps last XIO when a refresh returns zero", () => {
  const filled = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 57.1375, xio: 3_004_952_684.62, rlusd: 127.3 },
    prices: { xioUsd: 0.0000469, xrpUsd: 1.48 },
    token: { circulating: 10_000_000_000 },
    rank: 1,
  });
  const hollow = emptyWalletSnapshot("rExample");
  const kept = preferFilledWalletSnapshot(filled, hollow);
  assert.equal(kept.filled, true);
  assert.equal(kept.holdings.xio, filled.holdings.xio);
  assert.equal(kept.xio.usd, filled.xio.usd);
  assert.equal(kept.supply.supplyPct, filled.supply.supplyPct);

  const zeroed = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 0, xio: 0, rlusd: 0 },
    account: { balance_drops: 0 },
    prices: { xioUsd: 0.0000469, xrpUsd: 1.48 },
    token: { circulating: 10_000_000_000 },
  });
  const held = preferFilledWalletSnapshot(filled, zeroed);
  assert.equal(held.holdings.xio, filled.holdings.xio);
  assert.equal(held.xio.usd, filled.xio.usd);
  assert.equal(held.holdings.xrp, filled.holdings.xrp);
  assert.equal(held.supply.circulatingPct, filled.supply.circulatingPct);
  assert.equal(held.rank, 1);

  const next = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 60, xio: 3_100_000_000, rlusd: 130 },
    prices: { xioUsd: 0.00005, xrpUsd: 1.5 },
    token: { circulating: 10_000_000_000 },
    rank: 1,
  });
  const updated = preferFilledWalletSnapshot(filled, next);
  assert.equal(updated.holdings.xio, 3_100_000_000);
  assert.equal(updated.holdings.xrp, 60);

  const other = emptyWalletSnapshot("rOther");
  assert.equal(preferFilledWalletSnapshot(filled, other).address, "rOther");
  assert.equal(preferFilledWalletSnapshot(filled, other).filled, false);
});

test("composeWalletSnapshot stays blank until an address is signed in", () => {
  const empty = emptyWalletSnapshot(null);
  assert.equal(empty.signedIn, false);
  assert.equal(empty.filled, false);
  assert.equal(empty.xio.usd, null);
  assert.equal(empty.xio.rlusd, null);

  const filled = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 12, xio: 5000, rlusd: 127.3 },
    prices: {
      xioUsd: 0.00004,
      xioGbp: 0.00003,
      xrpUsd: 2,
      xrpEur: 1.8,
      xrpJpy: 300,
    },
    token: { circulating: 10_000_000_000, xioPerXrp: 0.00003 },
    pools: [{ pool_name: "XIO/XRP", reserve_asset: 60_000_000 }],
  });
  assert.equal(filled.signedIn, true);
  assert.equal(filled.filled, true);
  assert.equal(filled.holdings.xio, 5000);
  assert.equal(filled.holdings.xrp, 12);
  assert.equal(filled.holdings.rlusd, 127.3);
  assert.equal(filled.xio.xio, 5000);
  assert.equal(filled.xio.usd, 0.2);
  assert.equal(filled.xio.rlusd, 0.2);
  assert.equal(filled.xio.xrp, 0.15);
  assert.equal(filled.xio.gbp, 0.15);
  assert.ok(Math.abs(filled.xio.eur - 0.18) < 1e-12);
  assert.ok(Math.abs(filled.xio.jpy - 30) < 1e-12);
});

test("lpFeeEarnings sums 24h pool fees across every LP position", () => {
  assert.equal(tradingFeeRate(1000), 0.01);
  assert.equal(ammFeePercent(0), 0);
  assert.equal(ammFeePercent(null), 0);
  assert.equal(ammFeePercent(1), 1);
  assert.equal(ammFeePercent(1000), 1);
  assert.equal(ammFeePercent(500), 0.5);
  assert.equal(formatAmmFee(null), "0%");
  assert.equal(formatAmmFee(0), "0%");
  assert.equal(formatAmmFee(1), "1%");
  assert.equal(formatAmmFee(1000), "1%");
  assert.match(formatAmmFee(0.000001), /0\.000001%/);
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const fees = lpFeeEarnings(
    [
      {
        pool: "XIO/XRP",
        lp_share_percent: 10,
        withdraw_estimate_xio: 1000,
        trading_fee: 1000,
      },
      {
        pool: "XIO/USDC",
        lp_share_percent: 1,
        withdraw_estimate_xio: 800,
        trading_fee: 500,
        volume24h: 20_000,
      },
    ],
    {
      xioUsd: 0.00004,
      now,
      flows: [
        { pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" },
        { pool: "XIO/XRP", xio: 5_000, timestamp: "2026-08-21T10:00:00.000Z" },
      ],
    }
  );
  assert.equal(fees.xio, 10_000 * 0.01 * 0.1 + 20_000 * 0.005 * 0.01);
  assert.ok(Math.abs(fees.usd - fees.xio * 0.00004) < 1e-12);
  assert.ok(fees.pct24h > 0);
  assert.ok(fees.pct24h <= 100);
  const priced = lpFeeEarnings(
    [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: 10,
        withdraw_estimate_xio: 1000,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
      },
    ],
    {
      xioUsd: 0.00004,
      xrpUsd: 1,
      now,
      flows: [
        { pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" },
        { pool: "XIO/XRP", xio: 5_000, timestamp: "2026-08-21T10:00:00.000Z" },
      ],
    }
  );
  assert.equal(priced.earnings.xio24h, 5);
  assert.equal(priced.earnings.xrp24h, 5 * (2 / 50_000));
  assert.equal(priced.earnings.rlusd24h, 0);
  assert.equal(priced.earnings.xio24hUsd, 5 * 0.00004);
  assert.equal(priced.earnings.xrp24hUsd, priced.earnings.xrp24h * 1);
  assert.equal(priced.earnings.rlusd24hUsd, 0);
  assert.equal(priced.earnings.xio7d, 7.5);
  assert.equal(priced.earnings.xrp7d, 7.5 * (2 / 50_000));
  assert.equal(priced.earnings.rlusd7d, 0);
  assert.equal(priced.earnings.xio7dUsd, 7.5 * 0.00004);
  assert.equal(priced.earnings.xrp7dUsd, priced.earnings.xrp7d * 1);
  assert.ok(priced.earnings.usd24h > 0);
  assert.ok(priced.earnings.usd7d > priced.earnings.usd24h);
  const rlusd = lpFeeEarnings(
    [
      {
        pool: "XIO/RLUSD",
        quote: "RLUSD",
        lp_share_percent: 10,
        withdraw_estimate_xio: 800,
        trading_fee: 1000,
        reserve_asset: 8000,
        reserve_currency: 10,
      },
    ],
    {
      xioUsd: 0.00004,
      xrpUsd: 1,
      rlusdUsd: 1,
      now,
      flows: [
        { pool: "XIO/RLUSD", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" },
        { pool: "XIO/RLUSD", xio: 5_000, timestamp: "2026-08-21T10:00:00.000Z" },
      ],
    }
  );
  assert.equal(rlusd.earnings.xio24h, 5);
  assert.equal(rlusd.earnings.xrp24h, 0);
  assert.equal(rlusd.earnings.rlusd24h, 5 * (10 / 8000));
  assert.equal(rlusd.earnings.xio24hUsd, 5 * 0.00004);
  assert.equal(rlusd.earnings.rlusd24hUsd, rlusd.earnings.rlusd24h * 1);
  assert.equal(rlusd.earnings.xio7d, 7.5);
  assert.equal(rlusd.earnings.rlusd7d, 7.5 * (10 / 8000));
  assert.equal(rlusd.earnings.rlusd7dUsd, rlusd.earnings.rlusd7d * 1);
  assert.ok(Math.abs(rlusd.earnings.usd24h - (5 * 0.00004 + 5 * (10 / 8000))) < 1e-12);
  const both = lpFeeEarnings(
    [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: 10,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
      },
      {
        pool: "XIO/RLUSD",
        quote: "RLUSD",
        lp_share_percent: 100,
        trading_fee: 1000,
        reserve_asset: 8000,
        reserve_currency: 10,
      },
    ],
    {
      xioUsd: 0.00004,
      xrpUsd: 1,
      rlusdUsd: 1,
      now,
      flows: [
        { pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" },
        { pool: "XIO/RLUSD", xio: 2_000, timestamp: "2026-08-22T10:00:00.000Z" },
      ],
    }
  );
  assert.equal(both.earnings.pools["XIO/XRP"].xio24h, 5);
  assert.equal(both.earnings.pools["XIO/XRP"].quote24h, 5 * (2 / 50_000));
  assert.equal(both.earnings.pools["XIO/RLUSD"].xio24h, 10);
  assert.equal(both.earnings.pools["XIO/RLUSD"].quote24h, 10 * (10 / 8000));
  assert.ok(both.earnings.pools["XIO/XRP"].usd24h > 0);
  assert.ok(both.earnings.pools["XIO/RLUSD"].usd24h > both.earnings.pools["XIO/XRP"].usd24h);

  const spiked = lpFeeEarnings(
    [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: 10,
        trading_fee: 1000,
        reserve_asset: 2,
        reserve_currency: 50_000,
      },
    ],
    {
      xioUsd: 0.00004,
      xrpUsd: 1 / 0.00004,
      xioXrp: 0.00004,
      now,
      flows: [{ pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" }],
    }
  );
  assert.equal(spiked.earnings.xrp24h, 5 * (2 / 50_000));
  assert.ok(spiked.earnings.xrp24hUsd < 1);
  assert.ok(spiked.earnings.xrp24hUsd > 0);
});

test("composeWalletSnapshot totals LP fee earnings after sign-in", () => {
  const filled = composeWalletSnapshot({
    address: "rExample",
    balances: { xrp: 10, xio: 1 },
    prices: { xioUsd: 0.00004 },
    token: { circulating: 10_000_000_000 },
    pools: [
      {
        pool_name: "XIO/XRP",
        lp_supply: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
        trading_fee: 1000,
      },
    ],
    lpRows: [{ pool_name: "XIO/XRP", lp_balance: 100 }],
    flows: [{ pool: "XIO/XRP", xio: 5_000, timestamp: new Date().toISOString() }],
  });
  assert.ok(filled.fees.xio > 0);
  assert.ok(filled.fees.usd > 0);
  assert.equal(emptyWalletSnapshot(null).fees.xio, null);
});

test("composeWalletSnapshot keeps ledger offers and activity for the signed-in wallet", () => {
  const snap = composeWalletSnapshot({
    address: "rBuyer",
    balances: { xrp: 20, xio: 1000 },
    offers: [{ account: "rBuyer", pair: "XIO/XRP", side: "bid", price: 0.03, amount: 1000 }],
    ledgerActivity: [
      {
        account: "rBuyer",
        side: "buy",
        xio: 1000,
        price: 0.03,
        timestamp: "2026-08-23T01:50:00.000Z",
      },
    ],
  });
  assert.equal(snap.orders[0].price, 0.03);
  assert.equal(snap.activity[0].side, "buy");
  assert.equal(snap.activity[0].xio, 1000);
});

test("walletActivity only keeps the signed-in account", () => {
  const rows = walletActivity(
    [
      { account: "rMine", side: "buy", xio: 10, timestamp: "2026-08-22T00:00:00Z" },
      { account: "rOther", side: "sell", xio: 4, timestamp: "2026-08-22T00:01:00Z" },
    ],
    "rMine"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].xio, 10);
});
