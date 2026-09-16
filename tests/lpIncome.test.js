import test from "node:test";
import assert from "node:assert/strict";
import {lpFeeEarnings} from "../src/wallet/composeWallet.js";
import {INCOME_ALL_PAIRS, HISTORICAL_INCOME_DAYS, dailyHeldLpBalances, dailyLpIncomeTotals, earliestHeldDay, fillContinuousVolumeDays, incomePairBalance, incomePairChoices, incomePairTotals, incomeHeldPoolRows, poolShareAssets, incomeRowsForPair, isXioAmmPair, lpDepositIncomeRows, lpFeeIncomeRows, lpIncomeCsv, lpTokenUsd, priceBookOnDay, mergeLpIncomeRows, mergeRecordedLpIncome, pageLpIncome, poolForIncomePair, readRecordedLpIncome, writeRecordedLpIncome} from "../src/wallet/lpIncome.js";
import {composeWalletSnapshot} from "../src/wallet/composeWallet.js";
import {XIO_XRP_AMM, XIO_XRP_LP_HEX} from "../src/constants/ledger.js";

test("only XIO AMM pairs count as earn pools", () => {
  assert.equal(isXioAmmPair("XIO/XRP"), true);
  assert.equal(isXioAmmPair("XIO/RLUSD"), true);
  assert.equal(isXioAmmPair("XIO/$CAMEL"), true);
  assert.equal(isXioAmmPair({ pool: "XIO/XDX" }), true);
  assert.equal(isXioAmmPair("SOLO/USD"), false);
  assert.equal(isXioAmmPair({ pool_name: "RLUSD/XRP" }), false);
  assert.equal(isXioAmmPair("rNFPUZZLEGmFHaccountxxxxxxxxxxxxxxxx"), false);
  assert.equal(isXioAmmPair("rNFPUZZLE…GmFH"), false);
  assert.equal(isXioAmmPair({ pool: "rNFPUZZLE…GmFH" }), false);
});

test("lp fee earnings ignore non-XIO AMM positions", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const fees = lpFeeEarnings(
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
      {
        pool: "RLUSD/XRP",
        quote: "XRP",
        lp_share_percent: 50,
        withdraw_estimate_xio: 1000,
        trading_fee: 1000,
        reserve_asset: 10,
        reserve_currency: 20,
      },
    ],
    {
      xioUsd: 0.00004,
      xrpUsd: 1,
      now,
      flows: [
        { pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" },
        { pool: "RLUSD/XRP", xio: 1_000_000, timestamp: "2026-08-22T10:00:00.000Z" },
      ],
    }
  );
  assert.equal(fees.earnings.xio24h, 5);
  assert.equal(fees.earnings.xrp24h, 5 * (2 / 50_000));
});

test("income list is newest XIO pair days first and pages by 10 days", () => {
  const rows = lpFeeIncomeRows({
    now: Date.parse("2026-08-22T18:00:00.000Z"),
    positions: [
      {
        pool: "XIO/RLUSD",
        quote: "RLUSD",
        lp_share_percent: 10,
        trading_fee: 1000,
        reserve_asset: 8000,
        reserve_currency: 10,
        lp_supply: 400,
      },
    ],
    flows: [
      { pool: "XIO/RLUSD", xio: 10_000, timestamp: "2026-08-22T10:00:00.000Z" },
      { pool: "XIO/RLUSD", xio: 4_000, timestamp: "2026-08-21T10:00:00.000Z" },
      { pool: "RLUSD/XRP", xio: 9_000, timestamp: "2026-08-22T11:00:00.000Z" },
    ],
    xioUsd: 0.00004,
    rlusdUsd: 1,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-08-22");
  assert.equal(rows[0].pair, "XIO/RLUSD");
  assert.ok(Math.abs(rows[0].lpTokens - 0.5) < 1e-12);
  // Same 50/50 split as the earn board: 5 XIO + 0.00625 RLUSD.
  assert.ok(Math.abs(rows[0].usd - (5 * 0.00004 + 5 * (10 / 8000))) < 1e-12);
  const paged = pageLpIncome(
    mergeLpIncomeRows(
      rows,
      Array.from({ length: 12 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        pair: "XIO/XRP",
        lpTokens: 1,
        usd: 1,
      }))
    ),
    10
  );
  assert.equal(new Set(paged.map((row) => row.date)).size, 10);
  assert.match(lpIncomeCsv(rows), /^Date,XIO,Quote,Quote amount,USD,Trading pair\n/);
  assert.ok(rows.every((row) => Number(row.assetXio) > 0 && Number(row.assetQuote) > 0));
});

test("lpTokenUsd does not mark LP tokens at the XRP price when quote reserve is LP supply", () => {
  const pool = {
    pool: "XIO/XRP",
    quote: "XRP",
    reserve_asset: 64_520_961.62244989,
    reserve_currency: 233_179_846.2759734,
    lp_supply: 233_179_846.2759734,
  };
  const prices = { xioUsd: 0.0000473979, xrpUsd: 1.47 };
  const tokens = 5_654_599.2309;
  const usd = lpTokenUsd(tokens, pool, prices);
  const xioSide = pool.reserve_asset * prices.xioUsd;
  assert.ok(usd > 100);
  assert.ok(usd < 1_000);
  assert.ok(Math.abs(usd - (tokens / pool.lp_supply) * xioSide * 2) < 1);
  assert.ok(Math.abs(usd - tokens * prices.xrpUsd) > 1_000_000);
});

test("lpTokenUsd prices both pool reserves at the quote mark, not 2x XIO", () => {
  const pool = {
    pool: "XIO/XDX",
    quote: "XIO",
    reserve_asset: 52_286_366.55495586,
    reserve_currency: 59.83194412724561,
    lp_supply: 44_896.64667926788,
  };
  const prices = { xioUsd: 0.00004, xrpUsd: 2, xioXrp: 10, XIO: 20 };
  const tenth = pool.lp_supply / 10;
  const usd = lpTokenUsd(tenth, pool, prices);
  const xioSide = pool.reserve_asset * 0.00004;
  const quoteSide = pool.reserve_currency * 20;
  assert.ok(Math.abs(usd - 0.1 * (xioSide + quoteSide)) < 1e-6);
  assert.ok(usd < 0.1 * xioSide * 2);
  const deposited = lpDepositIncomeRows({
    activity: [{ side: "addLp", pair: "XIO/XDX", lp: tenth, timestamp: "2026-08-22T10:00:00.000Z" }],
    positions: [pool],
    prices,
  });
  assert.equal(deposited.length, 1);
  assert.ok(Math.abs(deposited[0].usd - usd) < 1e-9);
});

test("income pair list is All pairs plus only pools the wallet holds", () => {
  const pairs = incomePairChoices({
    positions: [
      { pool: "XIO/XDX", lp_balance: 4 },
      { pool: "XIO/RLUSD", lp_balance: 2 },
      { pool: "XIO/XSQUAD", lp_balance: 0 },
    ],
    activity: [{ pair: "XIO/XSQUAD" }],
  });
  assert.deepEqual(pairs, ["ALL", "XIO/RLUSD", "XIO/XDX"]);
});

test("All pairs lists each held pool balance and current USD worth", () => {
  const xrpPool = {
    pool: "XIO/XRP",
    lp_balance: 100,
    reserve_asset: 1000,
    reserve_currency: 1,
    lp_supply: 1000,
  };
  const rows = incomeRowsForPair({
    pair: INCOME_ALL_PAIRS,
    positions: [
      xrpPool,
      { pool: "XIO/XDX", lp_balance: 50, reserve_asset: 50_000, reserve_currency: 60, lp_supply: 1_000 },
    ],
    xioUsd: 0.00004,
    xrpUsd: 2,
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.kind === "hold" && row.lpTokens > 0 && row.usd > 0));
  assert.equal(rows.find((row) => row.pair === "XIO/XRP").lpBalance, 100);
  assert.equal(lpIncomeCsv(rows).startsWith("Pair,XIO,Quote,Quote amount,USD"), true);
  assert.ok(rows.every((row) => row.assetXio > 0 && row.assetQuote > 0));
  const totals = incomePairTotals({
    pair: INCOME_ALL_PAIRS,
    positions: rows.map((row) => ({ pool: row.pair, lp_balance: row.lpBalance })),
    pools: [xrpPool],
    xioUsd: 0.00004,
    xrpUsd: 2,
  });
  assert.equal(totals.lp, 0);
  assert.ok(totals.usd >= 0);
});

test("wallet LP history is the holder's balance and the day's increase, not pool owners", () => {
  const series = dailyHeldLpBalances({
    pair: "XIO/XRP",
    currentBalance: 1100,
    fromDay: "2026-08-25",
    toDay: "2026-08-27",
    activity: [
      { side: "addLp", pair: "XIO/XRP", lp: 1000, timestamp: "2026-08-25T10:00:00.000Z" },
      { side: "addLp", pair: "XIO/XRP", lp: 100, timestamp: "2026-08-27T12:00:00.000Z" },
    ],
  });
  assert.equal(series[0].date, "2026-08-27");
  assert.equal(series[0].lpBalance, 1100);
  assert.equal(series[0].lpAdded, 100);
  assert.equal(series[1].date, "2026-08-26");
  assert.equal(series[1].lpBalance, 1000);
  assert.equal(series[1].lpAdded, 0);
  assert.equal(series[2].date, "2026-08-25");
  assert.equal(series[2].lpBalance, 1000);
  assert.equal(series[2].lpAdded, 1000);
});

test("selected pair header is the wallet LP total, not pool supply", () => {
  assert.equal(
    incomePairBalance({
      pair: "XIO/XRP",
      positions: [{ pool: "XIO/XRP", lp_balance: 9_484_129.5933, lp_supply: 230_000_000 }],
    }),
    9_484_129.5933
  );
  assert.equal(
    incomePairBalance({
      pair: INCOME_ALL_PAIRS,
      positions: [
        { pool: "XIO/XRP", lp_balance: 100 },
        { pool: "XIO/XDX", lp_balance: 50 },
      ],
    }),
    150
  );
});

test("selected pair lists daily fee LP priced on that date, not deposits", () => {
  const pool = {
    pool: "XIO/XRP",
    quote: "XRP",
    reserve_asset: 50_000,
    reserve_currency: 2,
    lp_supply: 1000,
    lp_balance: 100,
    trading_fee: 1000,
  };
  const history = incomeRowsForPair({
    pair: "XIO/XRP",
    now: Date.parse("2026-08-22T18:00:00.000Z"),
    historyActivity: [
      { side: "addLp", pair: "XIO/XRP", lp: 100, timestamp: "2026-08-21T10:00:00.000Z", txid: "A" },
      { side: "addLp", pair: "XIO/RLUSD", lp: 40, timestamp: "2026-08-21T10:00:00.000Z", txid: "C" },
    ],
    historyDays: [
      { pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-21T00:00:00.000Z" },
      { pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-22T00:00:00.000Z" },
    ],
    positions: [pool],
    prices: {
      xioUsd: 0.00008,
      xrpUsd: 2,
      dailyPrices: {
        "2026-08-21": { xioUsd: 0.00004, xrpUsd: 2 },
        "2026-08-22": { xioUsd: 0.00008, xrpUsd: 2 },
      },
    },
  });
  assert.ok(history.every((row) => row.pair === "XIO/XRP" && row.kind === "fee" && row.lpEarned > 0));
  assert.equal(history.some((row) => row.lpEarned === 100), false);
  const older = history.find((row) => row.date === "2026-08-21");
  const today = history.find((row) => row.date === "2026-08-22");
  assert.ok(older);
  assert.ok(today);
  const feeXio = 1_000_000 * 0.01 * 0.1;
  const expectedLp = (feeXio / 50_000) * 1000;
  const half = feeXio / 2;
  const quotePx = 2 / 50_000;
  assert.ok(Math.abs(older.lpEarned - expectedLp) < 1e-9);
  assert.ok(Math.abs(today.lpEarned - expectedLp) < 1e-9);
  assert.ok(Math.abs(older.usd - (half * 0.00004 + half * quotePx * 2)) < 1e-12);
  assert.ok(Math.abs(today.usd - (half * 0.00008 + half * quotePx * 2)) < 1e-12);
});

test("continuous volume days fill every 24h UTC date newest-ready", () => {
  const buckets = new Map([
    ["2026-08-01|XIO/XRP", { date: "2026-08-01", pair: "XIO/XRP", xio: 100 }],
    ["2026-08-04|XIO/XRP", { date: "2026-08-04", pair: "XIO/XRP", xio: 400 }],
  ]);
  fillContinuousVolumeDays(buckets, "XIO/XRP", "2026-08-01", "2026-08-04");
  assert.deepEqual(
    [...buckets.keys()].sort(),
    ["2026-08-01|XIO/XRP", "2026-08-02|XIO/XRP", "2026-08-03|XIO/XRP", "2026-08-04|XIO/XRP"]
  );
  assert.ok(Math.abs(buckets.get("2026-08-02|XIO/XRP").xio - 200) < 1e-9);
  assert.ok(Math.abs(buckets.get("2026-08-03|XIO/XRP").xio - 300) < 1e-9);
});

test("daily totals record each UTC day and keep stored history", () => {
  const rows = dailyLpIncomeTotals([
    { date: "2026-08-23", pair: "XIO/XRP", lpTokens: 0.2, usd: 0.001, kind: "fee" },
    { date: "2026-08-23", pair: "XIO/XRP", lpTokens: 0.1, usd: 0.0005, kind: "fee" },
    { date: "2026-08-23", pair: "XIO/XRP", lpTokens: 9, usd: 1, kind: "deposit" },
    { date: "2026-08-22", pair: "XIO/RLUSD", lpTokens: 0.4, usd: 0.002, kind: "fee" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-08-23");
  assert.ok(Math.abs(rows[0].lpTokens - 0.3) < 1e-12);
  const storage = new Map();
  const memory = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  writeRecordedLpIncome("rWallet", [
    { date: "2026-08-23", pair: "XIO/XRP", lpTokens: 1, usd: 12.5, kind: "fee" },
    { date: "2026-08-22", pair: "XIO/RLUSD", lpTokens: 0.4, usd: 3, kind: "fee" },
  ], memory);
  const stored = readRecordedLpIncome("rWallet", memory);
  const merged = mergeRecordedLpIncome(stored, [
    { date: "2026-08-23", pair: "XIO/XRP", lpTokens: 9, usd: 99, kind: "fee" },
    { date: "2026-08-24", pair: "XIO/XRP", lpTokens: 0.5, usd: 8, kind: "fee" },
  ]);
  const frozen = merged.find((row) => row.date === "2026-08-23" && row.pair === "XIO/XRP");
  assert.equal(frozen.usd, 12.5);
  assert.equal(frozen.lpTokens, 1);
  assert.deepEqual(
    merged.map((row) => row.date),
    ["2026-08-24", "2026-08-23", "2026-08-22"]
  );
});

test("fee history fills missing recent days from catalog volume after sign-in", () => {
  const now = Date.parse("2026-08-25T18:00:00.000Z");
  const rows = lpFeeIncomeRows({
    now,
    positions: [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: 4,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
        lp_supply: 1000,
        volume24hXio: 8_000_000,
        volume7dXio: 20_000_000,
      },
    ],
    flows: [{ pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-23T10:00:00.000Z" }],
    xioUsd: 0.00004,
    xrpUsd: 2,
  });
  const days = rows.map((row) => row.date);
  assert.ok(days.includes("2026-08-25"));
  assert.ok(days.includes("2026-08-23"));
  assert.ok(days.includes("2026-08-24"));
  assert.ok(days.length >= 7);
  assert.ok(rows.every((row) => row.kind === "fee" && row.lpTokens > 0));
});

test("fee history records each historical day from the volume series, not only today", () => {
  const now = Date.parse("2026-08-25T18:00:00.000Z");
  const volumeDays = [
    { pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-01T00:00:00.000Z" },
    { pair: "XIO/XRP", xio: 2_000_000, timestamp: "2026-08-10T00:00:00.000Z" },
    { pair: "XIO/XRP", xio: 3_000_000, timestamp: "2026-08-24T00:00:00.000Z" },
    { pair: "XIO/XRP", xio: 4_000_000, timestamp: "2026-08-25T00:00:00.000Z" },
  ];
  const rows = lpFeeIncomeRows({
    now,
    positions: [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: 10,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
        lp_supply: 1000,
      },
    ],
    flows: [{ pool: "XIO/XRP", xio: 500, timestamp: "2026-08-25T10:00:00.000Z" }],
    volumeDays,
    xioUsd: 0.00004,
    xrpUsd: 2,
  });
  const days = rows.map((row) => row.date);
  assert.equal(days[0], "2026-08-25");
  assert.equal(days[days.length - 1], "2026-08-01");
  assert.equal(days.length, 25);
  for (let i = 1; i < days.length; i += 1) {
    assert.ok(days[i - 1] > days[i]);
  }
  const today = rows.find((row) => row.date === "2026-08-25");
  const fromTape = 500 * 0.01 * 0.1;
  const fromOhlc = 4_000_000 * 0.01 * 0.1;
  assert.ok(today.lpTokens > 0);
  assert.ok(Math.abs(today.lpTokens - (fromOhlc / 50_000) * 1000) < 1e-9);
  assert.ok(fromOhlc > fromTape);
  assert.equal(HISTORICAL_INCOME_DAYS, 365);
});

test("XIO/XDX fee history starts from the held day, not the first catalog volume day", () => {
  const now = Date.parse("2026-08-25T18:00:00.000Z");
  const rows = lpFeeIncomeRows({
    now,
    positions: [
      {
        pool: "XIO/XDX",
        quote: "XIO",
        lp_share_percent: 5,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 60,
        lp_supply: 1_000,
        lp_balance: 50,
        volume24hXio: 20_000,
      },
    ],
    activity: [{ side: "addLp", pair: "XIO/XDX", lp: 50, timestamp: "2026-08-11T10:00:00.000Z" }],
    xioUsd: 0.00005,
  });
  const days = rows.map((row) => row.date);
  assert.ok(days.includes("2026-08-25"));
  assert.ok(days.includes("2026-08-11"));
  assert.ok(rows.every((row) => row.pair === "XIO/XDX" && row.kind === "fee"));
});

test("fee USD uses the XIO mark on that UTC day, not today's live price", () => {
  const now = Date.parse("2026-08-25T18:00:00.000Z");
  const rows = lpFeeIncomeRows({
    now,
    positions: [
      {
        pool: "XIO/XDX",
        quote: "XIO",
        lp_share_percent: 10,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 60,
        lp_supply: 1_000,
      },
    ],
    volumeDays: [
      { pair: "XIO/XDX", xio: 1_000_000, timestamp: "2026-08-20T00:00:00.000Z" },
      { pair: "XIO/XDX", xio: 1_000_000, timestamp: "2026-08-25T00:00:00.000Z" },
    ],
    xioUsd: 0.00008,
    dailyPrices: {
      "2026-08-20": { xioUsd: 0.00004 },
      "2026-08-25": { xioUsd: 0.00008 },
    },
  });
  const older = rows.find((row) => row.date === "2026-08-20");
  const today = rows.find((row) => row.date === "2026-08-25");
  assert.ok(older.usd > 0);
  assert.ok(today.usd > 0);
  assert.ok(Math.abs(today.usd / older.usd - 2) < 1e-9);
  const book = priceBookOnDay(
    "2026-08-20",
    { "2026-08-20": { xioUsd: 0.00004, xrpUsd: 2 } },
    { xioUsd: 0.00008, xrpUsd: 2 }
  );
  assert.equal(book.xioUsd, 0.00004);
});

test("recorded fee USD stays frozen when the live mark moves", () => {
  const rows = incomeRowsForPair({
    pair: "XIO/XDX",
    recordedRows: [{ date: "2026-08-20", pair: "XIO/XDX", lpTokens: 2, usd: 7.25, kind: "fee" }],
    historyActivity: [{ side: "addLp", pair: "XIO/XDX", lp: 50, timestamp: "2026-08-11T10:00:00.000Z" }],
    historyDays: [{ pair: "XIO/XDX", xio: 1_000_000, timestamp: "2026-08-20T00:00:00.000Z" }],
    positions: [
      {
        pool: "XIO/XDX",
        quote: "XIO",
        reserve_asset: 50_000,
        reserve_currency: 60,
        lp_supply: 1_000,
        lp_balance: 50,
        trading_fee: 1000,
      },
    ],
    xioUsd: 0.00008,
    prices: { xioUsd: 0.00008, dailyPrices: { "2026-08-20": { xioUsd: 0.00004 } } },
  });
  const older = rows.find((row) => row.date === "2026-08-20");
  assert.ok(older);
  assert.equal(older.kind, "fee");
  assert.equal(older.lpEarned, 2);
  assert.equal(older.usd, 7.25);
});

test("pair fee days start on the first LP hold and skip deposit-sized rows", () => {
  const rows = incomeRowsForPair({
    pair: "XIO/XRP",
    now: Date.parse("2026-08-26T18:00:00.000Z"),
    historyActivity: [
      { side: "addLp", pair: "XIO/XRP", lp: 3_829_530.36240651, timestamp: "2026-08-11T16:46:11.000Z", kind: "Payment" },
      { side: "addLp", pair: "XIO/XRP", lp: 5_654_599.2309205, timestamp: "2026-08-24T01:57:30.000Z", kind: "AMMDeposit" },
    ],
    historyDays: [
      { pair: "XIO/XRP", xio: 100_000, timestamp: "2026-08-11T00:00:00.000Z" },
      { pair: "XIO/XRP", xio: 100_000, timestamp: "2026-08-26T00:00:00.000Z" },
    ],
    positions: [
      {
        pool: "XIO/XRP",
        lp_balance: 9_484_129.59332701,
        lp_supply: 230_346_571,
        reserve_asset: 64_000_000,
        reserve_currency: 230,
        trading_fee: 1000,
      },
    ],
    xioUsd: 0.00004,
    xrpUsd: 2,
  });
  const days = rows.map((row) => row.date);
  assert.ok(days.includes("2026-08-26"));
  assert.ok(days.includes("2026-08-11"));
  assert.equal(days.includes("2026-08-10"), false);
  assert.ok(rows.every((row) => row.kind === "fee" && row.lpEarned > 0 && row.lpEarned < 1_000_000));
  const totals = incomePairTotals({
    pair: "XIO/XRP",
    positions: [{ pool: "XIO/XRP", lp_balance: 9_484_129.59332701, lp_supply: 230_346_571, reserve_asset: 64_000_000, reserve_currency: 230 }],
    xioUsd: 0.00004,
    xrpUsd: 2,
  });
  assert.equal(totals.lp, 9_484_129.59332701);
  assert.ok(totals.usd > 0);
});

test("unlabeled LP events do not count as an XIO/XAH hold day", () => {
  assert.equal(
    earliestHeldDay("XIO/XAH", [{ side: "addLp", pair: "", lp: 10, timestamp: "2026-08-01T10:00:00.000Z" }], 10),
    ""
  );
  assert.equal(
    earliestHeldDay("XIO/XAH", [{ side: "addLp", pair: "XIO/XAH", lp: 10, timestamp: "2026-08-01T10:00:00.000Z" }], 10),
    "2026-08-01"
  );
});

test("XIO/XAH fee days follow XIO market history, not only today", () => {
  const now = Date.parse("2026-08-27T18:00:00.000Z");
  const marketDays = [
    { pair: "XIO/XRP", xio: 2_000_000, timestamp: "2026-08-16T00:00:00.000Z" },
    { pair: "XIO/XRP", xio: 2_000_000, timestamp: "2026-08-26T00:00:00.000Z" },
    { pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-27T00:00:00.000Z" },
  ];
  const rows = incomeRowsForPair({
    pair: "XIO/XAH",
    now,
    historyActivity: [{ side: "addLp", pair: "XIO/XAH", lp: 37.4, timestamp: "2026-08-16T10:00:00.000Z" }],
    positions: [
      {
        pool: "XIO/XAH",
        quote: "XAH",
        lp_balance: 37.4,
        lp_supply: 14_776,
        reserve_asset: 100_000,
        reserve_currency: 50,
        trading_fee: 1000,
        volume24hXio: 500_000,
      },
    ],
    prices: { xioUsd: 0.00004, xioVolumeDays: marketDays },
  });
  const days = rows.map((row) => row.date);
  assert.ok(days.includes("2026-08-27"));
  assert.ok(days.includes("2026-08-16"));
  assert.ok(days.length >= 12);
  assert.ok(rows.every((row) => row.pair === "XIO/XAH" && row.kind === "fee"));
  const today = rows.find((row) => row.date === "2026-08-27");
  const older = rows.find((row) => row.date === "2026-08-16");
  assert.ok(today.lpTokens > 0);
  assert.ok(older.lpTokens > 0);
  assert.ok(Math.abs(older.lpTokens / today.lpTokens - 2) < 0.05);
});

test("lpFeeIncomeRows paints every held pair from the XIO market series", () => {
  const now = Date.parse("2026-08-27T18:00:00.000Z");
  const rows = lpFeeIncomeRows({
    now,
    positions: [
      {
        pool: "XIO/XRP",
        quote: "XRP",
        lp_share_percent: 4,
        trading_fee: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
        lp_supply: 1000,
        volume24hXio: 1_000_000,
      },
      {
        pool: "XIO/XAH",
        quote: "XAH",
        lp_share_percent: 0.25,
        trading_fee: 1000,
        reserve_asset: 100_000,
        reserve_currency: 50,
        lp_supply: 14_776,
        volume24hXio: 80_000,
      },
    ],
    volumeDays: [
      { pair: "XIO/XRP", xio: 1_200_000, timestamp: "2026-08-16T00:00:00.000Z" },
      { pair: "XIO/XRP", xio: 1_000_000, timestamp: "2026-08-27T00:00:00.000Z" },
    ],
    xioUsd: 0.00004,
  });
  const xrp = rows.filter((row) => row.pair === "XIO/XRP");
  const xah = rows.filter((row) => row.pair === "XIO/XAH");
  assert.ok(xrp.length >= 12);
  assert.ok(xah.length >= 12);
  assert.equal(xah[0].date, "2026-08-27");
  assert.ok(xah.some((row) => row.date === "2026-08-16"));
});

test("signed-in LP lines still produce daily income when wallet/lp is empty", () => {
  const snap = composeWalletSnapshot({
    address: "rWallet",
    balances: { xrp: 10, xio: 1 },
    prices: { xioUsd: 0.00004, xrpUsd: 2 },
    token: { circulating: 10_000_000_000 },
    pools: [
      {
        pool_name: "XIO/XRP",
        amm_account: XIO_XRP_AMM,
        lp_currency: XIO_XRP_LP_HEX,
        lp_supply: 1000,
        reserve_asset: 50_000,
        reserve_currency: 2,
        trading_fee: 1000,
        volume24hXio: 5_000_000,
      },
    ],
    lpRows: [],
    lines: [{ account: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX, balance: "100" }],
    flows: [{ pool: "XIO/XRP", xio: 10_000, timestamp: "2026-08-23T10:00:00.000Z" }],
  });
  assert.equal(snap.lp[0]?.pool, "XIO/XRP");
  assert.ok(snap.lp[0]?.lp_share_percent > 0);
  assert.ok(snap.income.some((row) => row.date === "2026-08-23" && row.kind === "fee"));
  assert.ok(snap.income.every((row) => row.pair === "XIO/XRP" && row.kind === "fee"));
});

test("each pair marks LP tokens from that pool's reserves, including a missing quote side", () => {
  const xrpPool = {
    pool: "XIO/XRP",
    quote: "XRP",
    reserve_asset: 64_520_961.62244989,
    reserve_currency: 2094.628968,
    lp_supply: 233_179_846.2759734,
  };
  const rlusdPool = {
    pool: "XIO/RLUSD",
    quote: "RLUSD",
    reserve_asset: 2_607_820.43763469,
    reserve_currency: 123.1704222066608,
    lp_supply: 17_907.41480903618,
  };
  const prices = { xioUsd: 0.0000473979, xrpUsd: 1.46, RLUSD: 1 };
  const xrpUsd = lpTokenUsd(6100.5985, xrpPool, prices);
  const xrpHalf = (6100.5985 / xrpPool.lp_supply) * (xrpPool.reserve_asset * prices.xioUsd);
  assert.ok(Math.abs(xrpUsd - xrpHalf * 2) < 0.01);
  assert.ok(xrpUsd > 0.15);

  const rlusdUsd = lpTokenUsd(13_524.1529, rlusdPool, prices);
  const rlusdTvl = rlusdPool.reserve_asset * prices.xioUsd + rlusdPool.reserve_currency;
  assert.ok(Math.abs(rlusdUsd - (13_524.1529 / rlusdPool.lp_supply) * rlusdTvl) < 0.05);

  const xrpMissingQuote = lpTokenUsd(6100.5985, { ...xrpPool, reserve_currency: 0 }, prices);
  assert.ok(Math.abs(xrpMissingQuote - xrpUsd) < 0.02);

  const fromCatalog = lpDepositIncomeRows({
    activity: [{ side: "addLp", pair: "XIO/RLUSD", lp: 13_524.1529, timestamp: "2026-08-24T10:00:00.000Z" }],
    positions: [{ pool: "XIO/RLUSD", lp_supply: 13_524.1529, reserve_asset: 100, reserve_currency: 1 }],
    pools: [rlusdPool],
    prices,
  });
  assert.equal(fromCatalog.length, 1);
  assert.ok(Math.abs(fromCatalog[0].usd - rlusdUsd) < 0.05);
  assert.equal(poolForIncomePair("XIO/RLUSD", [], [rlusdPool]).lp_supply, rlusdPool.lp_supply);
});

test("same-named AMM pools do not cross-wire LP share or invent 24h>7d fees", async () => {
  const {composeWalletSnapshot, lookupLpPool, indexPoolsByPair, mergeLpPoolSource, lpPositionFromPool} = await import("../src/wallet/composeWallet.js");
  const pools = [
    {
      pool: "XIO/RLUSD",
      quote: "RLUSD",
      amm_account: "rMassTiny",
      lp_currency: "03548FABB100CBD33E38B211427A04EC66D7D52A",
      lp_supply: 10,
      reserve_asset: 2,
      reserve_currency: 50,
      trading_fee: 1000,
      volume24hXio: 1.592,
      volume7dXio: 0,
    },
    {
      pool: "XIO/XRP",
      quote: "XRP",
      amm_account: "rPYfrbCvJGGEs9ddUtRiq58kCJBw9hoGij",
      lp_currency: "030AE7B410D0ECF1DEC886D216866C31C898C875",
      lp_supply: 3141.95,
      reserve_asset: 3.74,
      reserve_currency: 77.6,
      trading_fee: 1000,
      volume24hXio: 12.22,
      volume7dXio: 85.55,
    },
  ];
  const byPair = indexPoolsByPair(pools);
  const bigRow = {
    pool: "XIO/RLUSD",
    quote: "RLUSD",
    amm_account: "rLbBzBig",
    lp_currency: "03BCD44104644B711C58CD14CD13CBA65757CFBE",
    lp_balance: 17907.41,
    lp_supply: 46865.73,
    lp_share_percent: 38.21,
    trading_fee: 1000,
    reserve_asset: 0,
    reserve_currency: 340,
  };
  assert.equal(lookupLpPool(bigRow, byPair), null);
  assert.equal(mergeLpPoolSource(bigRow, pools[0]).amm_account, "rLbBzBig");
  const pos = lpPositionFromPool(bigRow.lp_balance, mergeLpPoolSource(bigRow, lookupLpPool(bigRow, byPair)), "XIO/RLUSD");
  assert.ok(pos.lp_share_percent <= 100);
  assert.ok(Math.abs(pos.lp_share_percent - 38.21) < 0.1);

  const snap = composeWalletSnapshot({
    address: "rWallet",
    balances: { xio: 4088, xrp: 9, rlusd: 77 },
    prices: { xioUsd: 28.2, xrpUsd: 1.36, RLUSD: 1, xioPerXrp: 20.74 },
    token: { circulating: 9983, xioPerXrp: 20.74, xioUsd: 28.2 },
    pools,
    lpRows: [
      bigRow,
      {
        pool: "XIO/RLUSD",
        quote: "RLUSD",
        amm_account: "rMassTiny",
        lp_currency: "03548FABB100CBD33E38B211427A04EC66D7D52A",
        lp_balance: 10,
        lp_supply: 10,
        lp_share_percent: 100,
        trading_fee: 1000,
        reserve_asset: 2,
        reserve_currency: 50,
        volume24hXio: 1.592,
        volume7dXio: 0,
      },
      {
        pool: "XIO/XRP",
        quote: "XRP",
        amm_account: "rPYfrbCvJGGEs9ddUtRiq58kCJBw9hoGij",
        lp_currency: "030AE7B410D0ECF1DEC886D216866C31C898C875",
        lp_balance: 3.74,
        lp_supply: 3141.95,
        lp_share_percent: 0.119,
        trading_fee: 1000,
        reserve_asset: 3.74,
        reserve_currency: 77.6,
        volume24hXio: 12.22,
        volume7dXio: 85.55,
      },
    ],
    flows: [],
  });
  const earn = snap.fees.earnings;
  // Pre-fix this reproduced ~$620 / 21.96 XIO from a 179074% share.
  assert.ok(earn.usd24h < 5, `usd24h inflated: ${earn.usd24h}`);
  assert.ok(earn.xio24h < 1, `xio24h inflated: ${earn.xio24h}`);
  assert.ok(earn.usd7d >= earn.usd24h - 1e-9, `24h>7d: ${earn.usd24h} vs ${earn.usd7d}`);
  const xrpPool = earn.pools["XIO/XRP"];
  assert.ok(xrpPool.usd24h < 0.01);
  assert.ok(xrpPool.usd7d >= xrpPool.usd24h - 1e-9);
  assert.equal(snap.lp.filter((row) => row.pool === "XIO/RLUSD").length, 2);
});


test("underlying pool share assets use lpBalance/lpTotalSupply * reserves", () => {
  const rows = incomeHeldPoolRows({
    positions: [
      {
        pool: "XIO/XRP",
        lp_balance: 1000,
        lp_supply: 10_000,
        reserve_asset: 50_000,
        reserve_currency: 200,
        quote: "XRP",
      },
    ],
    pools: [],
    xioUsd: 0.00005,
    xrpUsd: 1.2,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lpBalance, 1000);
  assert.equal(rows[0].assetXio, 5000);
  assert.equal(rows[0].assetQuote, 20);
  assert.equal(rows[0].quoteAsset, "XRP");
});


test("fee XIO splits into both pool assets for display", () => {
  const assets = poolShareAssets({
    feeXio: 100,
    reserveXio: 50_000,
    reserveQuote: 200,
    quoteAsset: "XRP",
    pair: "XIO/XRP",
  });
  assert.equal(assets.assetXio, 50);
  assert.equal(assets.assetQuote, 0.2);
  assert.equal(assets.quoteAsset, "XRP");
});

