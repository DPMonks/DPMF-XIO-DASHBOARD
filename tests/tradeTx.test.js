import test from "node:test";
import assert from "node:assert/strict";
import {pairFromRow, RLUSD_HEX, RLUSD_ISSUER, TF_SET_NO_RIPPLE, XIO_ISSUER, XIO_RLUSD_AMM, XIO_RLUSD_LP_HEX, XIO_XRP_AMM, XIO_XRP_LP_HEX, XIO_XDX_AMM, XIO_XDX_LP_HEX, XIO_XSQUAD_AMM, XIO_XSQUAD_LP_HEX, XSQUAD_HEX, XSQUAD_ISSUER} from "../src/constants/ledger.js";
import {MARKET_SLIPPAGE, TF_LP_TOKEN, TF_ONE_ASSET_LP_TOKEN, TF_ONE_ASSET_WITHDRAW_ALL, TF_PARTIAL_PAYMENT, TF_SINGLE_ASSET, TF_TWO_ASSET, ammDepositTx, ammQuoteAsset, ammWithdrawTx, expectedLpTokens, expectedSingleLpTokens, expectedSingleWithdraw, expectedWithdraw, extraTrustLinesNeeded, executionBelongsToOpenTrade, executionClosesTradeAction, gateUnsignedTrade, hasLpRow, hasLpTrustline, hasQuoteTrustline, lpTrustSetTxjson, normalizeTradeRequest, offerCreateBuyXio, offerCreateSellXio, poolForQuote, quoteHintsFromLines, quoteAsset, quoteIdFromPair, quoteTrustSetTxjson, shouldAskLpTrustline, shouldAskQuoteTrustline, recommendedQuote, resolveQuote, predictedQuoteOut, predictedXioFromQuote, quoteUnitUsd, depositValueSplit, formatLinkedQty, linkedDepositAmounts, usdEqualOpposingAmounts, expectedDoubleLpTokens, saneOpposingReserve, lpHeldForPair, sanitizeQtyInput, tradeSides, visibleQuoteQty, xioUnitUsd, tradeTotal, unusedXrpCoversLines, xrpDrops, xrplIssuedFloor, xrplIssuedValue} from "../src/xaman/tradeTx.js";

test("market buy is a self Payment that spends SendMax XRP for XIO", () => {
  const tx = offerCreateBuyXio({
    account: "rBuyer",
    quote: quoteAsset("XRP"),
    xio: "1000",
    cost: 2.5,
    market: true,
  });
  assert.equal(tx.TransactionType, "Payment");
  assert.equal(tx.Account, "rBuyer");
  assert.equal(tx.Destination, "rBuyer");
  assert.equal(tx.Amount.currency, "XIO");
  assert.equal(tx.Amount.issuer, XIO_ISSUER);
  assert.equal(tx.Amount.value, "1000");
  assert.equal(tx.SendMax, xrpDrops(2.5 * (1 + MARKET_SLIPPAGE)));
  assert.equal(tx.Flags, TF_PARTIAL_PAYMENT);
  assert.equal(tx.TakerPays, undefined);
});

test("limit buy XIO still rests an OfferCreate on the DEX book", () => {
  const tx = offerCreateBuyXio({
    account: "rBuyer",
    quote: quoteAsset("XRP"),
    xio: "1000",
    cost: 2.5,
  });
  assert.equal(tx.TransactionType, "OfferCreate");
  assert.equal(tx.TakerPays.value, "1000");
  assert.equal(tx.TakerGets, xrpDrops(2.5));
  assert.equal(tx.Flags, undefined);
});

test("market sell is a self Payment that sends XIO for the quote", () => {
  const tx = offerCreateSellXio({
    account: "rSeller",
    quote: quoteAsset("XRP"),
    xio: "500",
    proceeds: 1,
    market: true,
  });
  assert.equal(tx.TransactionType, "Payment");
  assert.equal(tx.SendMax.currency, "XIO");
  assert.equal(tx.SendMax.value, "500");
  assert.equal(tx.Amount, xrpDrops(1 * (1 - MARKET_SLIPPAGE)));
  assert.equal(tx.Flags, TF_PARTIAL_PAYMENT);
});

test("sell XIO for RLUSD is a limit OfferCreate", () => {
  const tx = offerCreateSellXio({
    account: "rSeller",
    quote: quoteAsset("RLUSD"),
    xio: "500",
    proceeds: 4,
  });
  assert.equal(tx.TakerGets.currency, "XIO");
  assert.equal(tx.TakerPays.currency, RLUSD_HEX);
  assert.equal(tx.TakerPays.issuer, RLUSD_ISSUER);
  assert.equal(tx.TakerPays.value, "4");
  assert.equal(tx.Flags, undefined);
});

test("AMM deposit and withdraw follow XRPL two-asset / LP token flags", () => {
  const add = ammDepositTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    xio: "10000",
    quoteQty: 3,
  });
  assert.equal(add.TransactionType, "AMMDeposit");
  assert.equal(add.Flags, TF_TWO_ASSET);
  assert.deepEqual(add.Asset2, { currency: "XRP" });
  assert.equal(add.Amount.value, "10000");
  assert.equal(add.Amount2, "3000000");
  const messy = ammDepositTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    xio: "319.53677886150104",
    quoteQty: 0.01,
  });
  assert.equal(messy.Amount.value, "319.53677886");
  assert.equal(messy.Amount2, "10000");
  assert.equal(/[eE]/.test(messy.Amount.value), false);
  assert.equal(xrplIssuedValue(1.23e-7), "0.000000123");

  const singleXio = ammDepositTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    xio: "250",
    mode: "single",
    singleAsset: "xio",
  });
  assert.equal(singleXio.Flags, TF_SINGLE_ASSET);
  assert.equal(singleXio.Amount.value, "250");
  assert.equal(singleXio.Amount2, undefined);

  const singleXrp = ammDepositTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    quoteQty: "0.5",
    mode: "single",
    singleAsset: "quote",
  });
  assert.equal(singleXrp.Flags, TF_SINGLE_ASSET);
  assert.equal(singleXrp.Amount, "500000");
  assert.equal(singleXrp.Amount2, undefined);

  const leftoverIssuer = { ...quoteAsset("XRP"), issuer: "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo" };
  assert.deepEqual(ammQuoteAsset(leftoverIssuer), { currency: "XRP" });
  const doubleWithLeftover = ammDepositTx({
    account: "rLp",
    quote: leftoverIssuer,
    xio: "100",
    quoteQty: 1,
    mode: "double",
  });
  assert.deepEqual(doubleWithLeftover.Asset2, { currency: "XRP" });
  assert.equal(doubleWithLeftover.Amount2, "1000000");
  const singleWithLeftover = ammDepositTx({
    account: "rLp",
    quote: leftoverIssuer,
    quoteQty: "0.5",
    mode: "single",
    singleAsset: "quote",
  });
  assert.equal(singleWithLeftover.Amount, "500000");
  assert.equal(typeof singleWithLeftover.Amount, "string");
  const xrpQuote = resolveQuote("XRP", { quote_issuer: XIO_ISSUER });
  assert.equal(xrpQuote.issuer, null);
  assert.equal(expectedSingleLpTokens(100, 1000, 500), 500 * (Math.sqrt(1.1) - 1));
  assert.equal(expectedSingleLpTokens(0, 1000, 500), 0);

  const take = ammWithdrawTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    lpAmount: "12.5",
  });
  assert.equal(take.TransactionType, "AMMWithdraw");
  assert.equal(take.Flags, TF_LP_TOKEN);
  assert.equal(take.LPTokenIn.issuer, XIO_XRP_AMM);
  assert.equal(take.LPTokenIn.currency, XIO_XRP_LP_HEX);
  assert.equal(take.LPTokenIn.value, "12.5");
  assert.equal(take.Amount, undefined);

  assert.ok(Math.abs(expectedSingleWithdraw(20, 1000, 200) - 190) < 1e-9);
  assert.equal(expectedSingleWithdraw(0, 1000, 200), 0);
  assert.equal(expectedSingleWithdraw(200, 1000, 200), 1000);
  assert.ok(expectedSingleWithdraw(20, 1000, 200, 1000) < 190);
  assert.ok(expectedSingleWithdraw(20, 1000, 200, 1000) > 0);

  const takeXio = ammWithdrawTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    lpAmount: "20",
    mode: "single",
    singleAsset: "xio",
    amountOut: 190,
  });
  assert.equal(TF_ONE_ASSET_LP_TOKEN, 2_097_152);
  assert.equal(TF_ONE_ASSET_WITHDRAW_ALL, 262_144);
  assert.notEqual(TF_ONE_ASSET_LP_TOKEN, TF_ONE_ASSET_WITHDRAW_ALL);
  assert.equal(takeXio.Flags, TF_ONE_ASSET_LP_TOKEN);
  assert.equal(takeXio.Amount.value, "0");
  assert.equal(takeXio.Amount.currency, "XIO");
  assert.equal(takeXio.Amount2, undefined);
  assert.equal(takeXio.LPTokenIn.value, "20");

  const takeXrp = ammWithdrawTx({
    account: "rLp",
    quote: quoteAsset("XRP"),
    lpAmount: "20.00000000000012",
    mode: "single",
    singleAsset: "quote",
    amountOut: 10,
  });
  assert.equal(takeXrp.Flags, TF_ONE_ASSET_LP_TOKEN);
  assert.equal(takeXrp.Amount, "0");
  assert.equal(takeXrp.Amount2, undefined);
  assert.equal(takeXrp.LPTokenIn.value, "20");
  assert.ok(Number(xrplIssuedFloor("4383.261913114705")) <= 4383.261913114705);

  assert.deepEqual(
    tradeSides({
      action: "removeLp",
      lpAmount: 20,
      quoteLabel: "XRP",
      withdraw: { base: 190, quote: 0 },
      singleAsset: "xio",
    }),
    {
      pay: [{ value: 20, asset: "LP" }],
      receive: [{ value: 190, asset: "XIO" }],
    }
  );
});

test("RLUSD needs a trustline; XRP does not", () => {
  assert.equal(quoteTrustSetTxjson("rA", quoteAsset("XRP")), null);
  const line = quoteTrustSetTxjson("rA", quoteAsset("RLUSD"));
  assert.equal(line.TransactionType, "TrustSet");
  assert.equal(line.LimitAmount.issuer, RLUSD_ISSUER);
  assert.equal(line.LimitAmount.currency, RLUSD_HEX);
  assert.notEqual(line.LimitAmount.currency, "RLUSD");
});

test("XSQUAD trustline and LP spec use the on-ledger hex", () => {
  const line = quoteTrustSetTxjson("rA", quoteAsset("XSQUAD"));
  assert.equal(line.LimitAmount.issuer, XSQUAD_ISSUER);
  assert.equal(line.LimitAmount.currency, XSQUAD_HEX);
  assert.notEqual(line.LimitAmount.currency, "XSQUAD");
  const spec = poolForQuote(quoteAsset("XSQUAD"));
  const lp = lpTrustSetTxjson("rA", spec);
  assert.equal(lp.LimitAmount.issuer, XIO_XSQUAD_AMM);
  assert.equal(lp.LimitAmount.currency, XIO_XSQUAD_LP_HEX);
});

test("unused XRP must cover each new trust line, including XIO/XSQUAD LP", () => {
  assert.equal(extraTrustLinesNeeded({ needLpLine: true, needQuoteTrust: true }), 2);
  assert.equal(extraTrustLinesNeeded({ action: "addLp", haveLpLine: false }), 1);
  assert.equal(extraTrustLinesNeeded({ action: "addLp", haveLpLine: true }), 0);
  const short = unusedXrpCoversLines({
    spendable: 0.05,
    total: 5,
    account: { reserve_inc_drops: 200_000 },
    extraLines: 1,
  });
  assert.equal(short.ok, false);
  assert.ok(short.need > 0.2);
  const enough = unusedXrpCoversLines({
    spendable: 2,
    total: 5,
    account: { reserve_inc_drops: 200_000 },
    extraLines: 2,
  });
  assert.equal(enough.ok, true);
  const unknown = unusedXrpCoversLines({ spendable: null, extraLines: 1 });
  assert.equal(unknown.ok, true);
  const falseZero = unusedXrpCoversLines({
    spendable: 0,
    total: 0,
    account: { reserve_inc_drops: 200_000 },
    extraLines: 1,
  });
  assert.equal(falseZero.ok, true);
  assert.equal(falseZero.unknown, true);
});

test("LP TrustSet uses the pool LP hex and AMM account", () => {
  const xrp = lpTrustSetTxjson("rLp", poolForQuote(quoteAsset("XRP")));
  assert.equal(xrp.TransactionType, "TrustSet");
  assert.equal(xrp.Flags, TF_SET_NO_RIPPLE);
  assert.equal(xrp.LimitAmount.currency, XIO_XRP_LP_HEX);
  assert.equal(xrp.LimitAmount.issuer, XIO_XRP_AMM);
  assert.equal(xrp.LimitAmount.value, "100000000000");
  const catalog = poolForQuote(quoteAsset("XIO"), [
    {
      pool: "XIO/XDX",
      amm_account: "rXioAmm",
      lp_currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
  ]);
  assert.equal(catalog.amm, "rXioAmm");
  assert.equal(catalog.lpCurrency, "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const rlusd = poolForQuote(quoteAsset("RLUSD"));
  assert.equal(rlusd.amm, XIO_RLUSD_AMM);
  assert.equal(rlusd.lpCurrency, XIO_RLUSD_LP_HEX);
  assert.equal(poolForQuote(quoteAsset("XIO")).amm, XIO_XDX_AMM);
  assert.equal(poolForQuote(quoteAsset("XIO")).lpCurrency, XIO_XDX_LP_HEX);
  assert.equal(poolForQuote(quoteAsset("XSQUAD")).amm, XIO_XSQUAD_AMM);
  assert.equal(poolForQuote(quoteAsset("XSQUAD")).lpCurrency, XIO_XSQUAD_LP_HEX);
  const liveXio = poolForQuote(quoteAsset("XIO"), [], {
    pair: "XIO/XDX",
    amm_account: "rDJXzsZGACeHGJQYfaudsYshaC5zJxqsHr",
    lp_currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9",
  });
  assert.equal(liveXio.amm, "rDJXzsZGACeHGJQYfaudsYshaC5zJxqsHr");
  assert.equal(liveXio.lpCurrency, "03E7A465A6E95CDA21E1110056AA51A71FA55CB9");
  const badCatalog = poolForQuote(quoteAsset("RLUSD"), [
    {
      pool: "XIO/RLUSD",
      amm_account: XIO_RLUSD_AMM,
      lp_currency: "RLUSD",
    },
  ]);
  assert.equal(badCatalog.lpCurrency, XIO_RLUSD_LP_HEX);
  assert.equal(lpTrustSetTxjson("rLp", { amm: XIO_RLUSD_AMM, lpCurrency: "RLUSD" }), null);
});

test("hasLpTrustline matches the pool LP line, not a quote IOU", () => {
  const spec = poolForQuote(quoteAsset("XRP"));
  assert.equal(hasLpTrustline([], spec), false);
  assert.equal(
    hasLpTrustline(
      [{ currency: "XIO", issuer: "rXio", ticker: "XIO" }],
      spec
    ),
    false
  );
  assert.equal(
    hasLpTrustline(
      [{ currency: XIO_XRP_LP_HEX, issuer: XIO_XRP_AMM, ticker: "LP", lp: true }],
      spec
    ),
    true
  );
  assert.equal(
    hasLpTrustline([{ lp: true, issuer: XIO_XRP_AMM, ticker: "LP" }], spec),
    true
  );
  const futureAmm = "rFutureAmmAccount111111111111111111";
  const futureLp = "03EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
  assert.equal(
    hasLpTrustline(
      [{ currency: futureLp.toLowerCase(), issuer: futureAmm, ticker: "LP" }],
      { amm: futureAmm, lpCurrency: `0x${futureLp}` }
    ),
    true
  );
  assert.equal(
    hasLpTrustline(
      [{ currency: futureLp, issuer: futureAmm, lp: true }],
      { amm: futureAmm }
    ),
    true
  );
  assert.equal(
    hasLpTrustline(
      [{ currency: "USDC", issuer: futureAmm, ticker: "USDC" }],
      { amm: futureAmm, lpCurrency: futureLp }
    ),
    false
  );
  const rlusd = quoteAsset("RLUSD");
  assert.equal(
    hasQuoteTrustline(
      [{ currency: RLUSD_HEX, issuer: RLUSD_ISSUER, ticker: "RLUSD" }],
      rlusd
    ),
    true
  );
  const usdcIssuer = "rUSDCIssuer11111111111111111111111";
  const usdcHex = "5553444300000000000000000000000000000000";
  assert.equal(
    hasQuoteTrustline(
      [{ currency: usdcHex, issuer: usdcIssuer, ticker: "USDC" }],
      { issuer: usdcIssuer, currency: "USDC", hex: usdcHex, id: "USDC" }
    ),
    true
  );
  assert.equal(
    hasQuoteTrustline(
      [{ currency: "USDC", issuer: usdcIssuer, ticker: "USDC" }],
      { issuer: usdcIssuer, currency: "USDC", hex: usdcHex, id: "USDC" }
    ),
    true
  );
  assert.equal(hasQuoteTrustline([], rlusd), false);
  assert.equal(hasQuoteTrustline([], { currency: "ETH" }), false);
  assert.equal(hasQuoteTrustline([{ currency: "ETH", issuer: "rEth" }], { currency: "ETH" }), false);
  const held = [{ pool: "XIO/RLUSD", pool_name: "XIO/RLUSD", lp_balance: 4383 }];
  assert.equal(lpHeldForPair(held, "XIO/RLUSD", "RLUSD") > 0, true);
  assert.equal(
    shouldAskLpTrustline({
      loaded: false,
      haveLine: false,
      spec: poolForQuote(rlusd),
    }),
    false
  );
  assert.equal(
    shouldAskLpTrustline({
      loaded: true,
      haveLine: true,
      spec: poolForQuote(rlusd),
    }),
    false
  );
  assert.equal(
    shouldAskLpTrustline({
      loaded: true,
      haveLine: false,
      spec: poolForQuote(rlusd),
    }),
    true
  );
  assert.equal(
    shouldAskQuoteTrustline({ loaded: true, haveLine: false, haveLp: true, quote: rlusd }),
    false
  );
  assert.equal(
    shouldAskQuoteTrustline({ loaded: true, haveLine: false, haveLp: false, quote: rlusd }),
    true
  );
});

test("non-XRP pools keep their own LP identity and read hex trustlines", () => {
  const usdc = resolveQuote("USDC");
  assert.equal(usdc.issuer, null);
  assert.notEqual(poolForQuote(usdc).amm, XIO_XRP_AMM);
  const usdcPool = {
    pool: "XIO/USDC",
    quote: "USDC",
    amm_account: "rUsdcAmm11111111111111111111111111",
    lp_currency: "03CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  };
  const usdcSpec = poolForQuote(usdc, [usdcPool]);
  assert.equal(usdcSpec.amm, usdcPool.amm_account);
  assert.equal(usdcSpec.lpCurrency, usdcPool.lp_currency);
  const usdcHex = "5553444300000000000000000000000000000000";
  assert.equal(
    hasLpTrustline(
      [{ currency: `0x${usdcPool.lp_currency.toLowerCase()}`, issuer: usdcPool.amm_account }],
      usdcSpec
    ),
    true
  );
  assert.equal(
    hasQuoteTrustline([{ currency: usdcHex, issuer: "rUsdcIssuer", ticker: "USDC" }], {
      ...usdc,
      issuer: "rUsdcIssuer",
    }),
    true
  );
  const hinted = quoteHintsFromLines(
    [{ currency: usdcHex, issuer: "rUsdcIssuer", ticker: "USDC", balance: "40" }],
    usdc
  );
  assert.equal(hinted.issuer, "rUsdcIssuer");
  assert.equal(hinted.hex, usdcHex);

  const rlusdSpec = poolForQuote(quoteAsset("RLUSD"));
  assert.equal(
    hasLpTrustline(
      [{ currency: `0x${XIO_RLUSD_LP_HEX.toLowerCase()}`, account: XIO_RLUSD_AMM }],
      rlusdSpec
    ),
    true
  );
  assert.equal(
    hasLpTrustline([{ currency: "03DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", issuer: XIO_RLUSD_AMM }], rlusdSpec),
    true
  );
  assert.equal(hasLpRow([{ pool: "XIO/RLUSD", lp_balance: 0 }], "XIO/RLUSD", "RLUSD", rlusdSpec), true);

  const bitx = resolveQuote("BITX", { quote: "Bitx", amm: "rBitxAmm", lp_currency: "03BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" });
  assert.equal(poolForQuote(bitx).amm, "rBitxAmm");
  assert.equal(normalizeTradeRequest({ action: "addLp", pair: "XIO/USDC", amm: "rAmm", lp_currency: "03AA" }).amm, "rAmm");
});

test("totals and LP hints stay simple numbers", () => {
  assert.equal(tradeTotal("1000", "0.002"), 2);
  assert.equal(recommendedQuote(100, 1000, 50), 5);
  assert.equal(expectedLpTokens(100, 1000, 200), 20);
  assert.deepEqual(expectedWithdraw(20, 1000, 50, 200), { base: 100, quote: 5 });
});

test("remove LP quote preview follows the live pool share, not a cross-market mark", () => {
  // Live XIO/XDX: 52.3M XIO / 59.94 XIO / 44936.65 LP.
  const live = expectedWithdraw(
    4493.664667926788,
    52286366.55495586,
    59.93807084355173,
    44936.64667926788
  );
  assert.ok(Math.abs(live.base - 5228636.655495586) < 1e-6);
  assert.ok(Math.abs(live.quote - 5.993807084355173) < 1e-9);
  assert.ok(Math.abs(saneOpposingReserve(100000, 86.9, 0.000002) - 0.2) < 1e-9);
  const leftover = expectedWithdraw(20, 100000, 86.9, 200, {
    price: 0.000002,
    preferMark: true,
  });
  assert.equal(leftover.base, 10000);
  assert.ok(Math.abs(leftover.quote - 8.69) < 1e-9);
  const missing = expectedWithdraw(20, 100000, 0, 200, {
    price: 0.000002,
    preferMark: true,
  });
  assert.ok(Math.abs(missing.quote - 0.02) < 1e-9);
});

test("opening add LP from a pool card keeps that pair", () => {
  assert.equal(quoteIdFromPair("XIO/XDX"), "XIO");
  assert.equal(lpHeldForPair([{ pool: "XIO/XRP", lp_balance: 12.5 }], "XIO/XRP", "XRP"), 12.5);
  assert.equal(lpHeldForPair([{ pool_name: "XIO/PLX", lp: 3 }], "XIO/PLX", "PLX"), 3);
  assert.equal(lpHeldForPair([], "XIO/XRP", "XRP"), 0);
});

test("remove LP held tokens stay on the selected pair, not another LP line", () => {
  const xsquadHex = XIO_XSQUAD_LP_HEX;
  const xsquadAmm = XIO_XSQUAD_AMM;
  const mixed = [
    {
      pool: "XIO/XRP",
      pool_name: "XIO/XRP",
      quote: "XSQUAD",
      lp_balance: 8888,
      amm_account: xsquadAmm,
      lp_currency: xsquadHex,
    },
    {
      pool: "XIO/XRP",
      pool_name: "XIO/XRP",
      lp_balance: 12.5,
      amm_account: XIO_XRP_AMM,
      lp_currency: XIO_XRP_LP_HEX,
    },
  ];
  assert.equal(lpHeldForPair(mixed, "XIO/XRP", "XRP"), 12.5);
  assert.equal(lpHeldForPair([mixed[0]], "XIO/XRP", "XRP"), 0);
  assert.equal(lpHeldForPair([mixed[0]], "XIO/XSQUAD", "XSQUAD"), 8888);
  assert.equal(pairFromRow({ quote: "XSQUAD", quote_issuer: "roBYiFtZsTRpWEUw6TtpUCwZCfjcQeRBg" }), "XIO/XSQUAD");
  assert.equal(pairFromRow({ lp_currency: xsquadHex, amm_account: xsquadAmm }), "XIO/XSQUAD");
  const otherAmm = "rOtherAmm1111111111111111111111111";
  assert.equal(
    pairFromRow({ lp_currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amm_account: otherAmm }),
    `XIO/${otherAmm.slice(0, 4)}…${otherAmm.slice(-4)}`
  );
});

test("opening add LP from a pool card keeps extra quote metadata", () => {
  const opened = normalizeTradeRequest({
    action: "addLp",
    pair: "XIO/PLX",
    quote_issuer: "rPlxIssuer",
  });
  assert.equal(opened.action, "addLp");
  assert.equal(opened.quote, "PLX");
  const quote = resolveQuote(opened.quote, opened);
  assert.equal(quote.pair, "XIO/PLX");
  assert.equal(quote.issuer, "rPlxIssuer");
});

test("fee then swap keeps the follow-on trade", () => {
  const opened = normalizeTradeRequest({
    action: "xioPlatformFee",
    amount: 12,
    nextTrade: { action: "crossSwap", fromId: "BITX", toId: "USD", amount: 5 },
  });
  assert.equal(opened.action, "xioPlatformFee");
  assert.equal(opened.amount, 12);
  assert.equal(opened.nextTrade.action, "crossSwap");
  assert.equal(opened.nextTrade.fromId, "BITX");
});

test("unsigned trade clicks ask for sign-in before the trade window", () => {
  assert.equal(gateUnsignedTrade("addLp", null).action, "sign-in");
  assert.equal(gateUnsignedTrade({ action: "buy", pair: "XIO/XDX" }, null).trade.quote, "XIO");
  assert.equal(gateUnsignedTrade("sell", "rSignedIn").action, "open");
  assert.equal(gateUnsignedTrade(null, null).action, "ignore");
});

test("a live Connect Wallet session opens add liquidity without a second sign-in", () => {
  assert.equal(gateUnsignedTrade("addLp", "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1").action, "open");
  assert.equal(gateUnsignedTrade({ action: "removeLp", pair: "XIO/XRP" }, "rSignedIn").action, "open");
});

test("trade windows show pay and receive from the selected pair", () => {
  const buy = tradeSides({ action: "buy", amount: 1000, quoteQty: 4.632, quoteLabel: "XIO", total: 4.632 });
  assert.deepEqual(buy.pay, [{ value: 4.632, asset: "XIO" }]);
  assert.deepEqual(buy.receive, [{ value: 1000, asset: "XIO" }]);
  const sell = tradeSides({ action: "sell", amount: 1000, quoteQty: 4.632, quoteLabel: "XIO", total: 4.632 });
  assert.deepEqual(sell.pay, [{ value: 1000, asset: "XIO" }]);
  assert.deepEqual(sell.receive, [{ value: 4.632, asset: "XIO" }]);
  assert.equal(predictedQuoteOut(100, 0, 1000, 50), 5);
  assert.equal(visibleQuoteQty("", 3.12), "3.12");
  assert.equal(visibleQuoteQty("2", 3.12), "2");
  assert.equal(predictedXioFromQuote(5, 0, 1000, 50), 100);
  assert.equal(formatLinkedQty(115.072148123), "115.07215");
  assert.equal(sanitizeQtyInput("4.52e+21"), null);
  assert.equal(sanitizeQtyInput("12.5"), "12.5");
  assert.equal(formatLinkedQty(4.52e21).includes("e"), false);
  const fromQuote = linkedDepositAmounts({
    editedSide: "quote",
    amount: "100000",
    quoteQty: "0.1",
    reserveBase: 1150.72148,
    reserveQuote: 1,
  });
  assert.equal(fromQuote.quoteInput, "0.1");
  assert.ok(fromQuote.xio > 100);
  const fromXio = linkedDepositAmounts({
    editedSide: "xio",
    amount: "115.072148",
    quoteQty: "9",
    reserveBase: 1150.72148,
    reserveQuote: 1,
  });
  assert.equal(fromXio.xioInput, "115.072148");
  assert.ok(Number(fromXio.quoteInput) > 0);
  assert.equal(
    quoteUnitUsd({
      quoteId: "XIO",
      pool: { reserve_xio: 1150, reserve_currency: 1, xioUsd: 0.000087 },
      prices: { XIO: 0.0001, xrpUsd: 2.8 },
    }),
    1150 * 0.000087
  );
  assert.equal(
    quoteUnitUsd({
      quoteId: "XIO",
      pool: { reserve_xio: 1150, reserve_currency: 1, xioUsd: 0.000087 },
      prices: { xioXrp: 26.4, xrpUsd: 1 },
      allowImplied: false,
    }),
    26.4
  );
  const add = tradeSides({ action: "addLp", amount: 100, quoteQty: 5, quoteLabel: "XRP", lpOut: 20 });
  assert.equal(add.pay[0].asset, "XIO");
  assert.equal(add.pay[1].asset, "XRP");
  assert.equal(add.receive[0].asset, "LP");
  const singlePay = tradeSides({ action: "addLp", amount: 0, quoteQty: 2, quoteLabel: "XRP", lpOut: 4 });
  assert.equal(singlePay.pay.length, 1);
  assert.equal(singlePay.pay[0].asset, "XRP");
  assert.equal(xioUnitUsd({ prices: { xioUsd: 0.00003 } }), 0.00003);
  assert.equal(quoteUnitUsd({ quoteId: "XRP", prices: { xrpUsd: 2 } }), 2);
  assert.equal(
    quoteUnitUsd({
      quoteId: "XRP",
      pool: { quote_usd: 1.5, reserve_xio: 100000, reserve_currency: 3, xioUsd: 0.000045 },
      prices: { xrpUsd: 2.8 },
    }),
    2.8
  );
  assert.equal(quoteUnitUsd({ quoteId: "XIO", pool: { reserve_xio: 1000, reserve_currency: 50, xioUsd: 0.0001 } }), 0.002);
  assert.equal(quoteUnitUsd({ quoteId: "USDC", pool: { quote_usd: 0.00004 }, prices: {} }), 1);
  const split = depositValueSplit({ xioAmount: 1000, quoteAmount: 2, xioUsd: 0.01, quoteUsd: 2.5 });
  assert.equal(split.xioValue, 10);
  assert.equal(split.quoteValue, 5);
  assert.ok(Math.abs(split.xioPct - 66.666) < 0.02);
});

test("only a matching ledger tx closes the open trade panel", () => {
  assert.equal(executionClosesTradeAction("buy", { txjson: { TransactionType: "Payment" } }), true);
  assert.equal(executionClosesTradeAction("buy", { txjson: { TransactionType: "OfferCreate" } }), true);
  assert.equal(executionClosesTradeAction("addLp", { txType: "AMMDeposit" }), true);
  assert.equal(executionClosesTradeAction("removeLp", { txType: "AMMWithdraw" }), true);
  assert.equal(executionClosesTradeAction("addLp", { txjson: { TransactionType: "Payment" } }), false);
  assert.equal(executionClosesTradeAction("buy", { txType: "AMMDeposit" }), false);
  assert.equal(executionClosesTradeAction("buy", { txjson: { TransactionType: "TrustSet" } }), false);
  assert.equal(executionClosesTradeAction("addLp", { txType: "SignIn" }), false);
  assert.equal(executionClosesTradeAction("xioPlatformFee", { txjson: { TransactionType: "Payment" } }), true);
  assert.equal(executionClosesTradeAction("crossSwap", { txjson: { TransactionType: "Payment" } }), true);
});

test("a leftover executed payload cannot close a newly opened trade panel", () => {
  const opened = {
    action: "buy",
    quote: "XRP",
    openId: Date.now(),
  };
  assert.equal(
    executionBelongsToOpenTrade(opened, {
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      txType: "Payment",
    }),
    false
  );
  assert.equal(
    executionBelongsToOpenTrade(opened, {
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      txType: "Payment",
      resolved_at: new Date(Date.now() - 60_000).toISOString(),
    }),
    false
  );
  assert.equal(
    executionBelongsToOpenTrade(
      { ...opened, activeUuid: "11111111-2222-4333-a444-555555555555" },
      { uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", txType: "Payment" }
    ),
    false
  );
  assert.equal(
    executionBelongsToOpenTrade(
      { ...opened, activeUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", signMarker: "ab".repeat(16) },
      {
        uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        txType: "Payment",
        signMarker: "ab".repeat(16),
        resolved_at: new Date(Date.now() + 1000).toISOString(),
      }
    ),
    true
  );
});

test("add LP opposing estimate is USD-equal at live marks", () => {
  const equal = usdEqualOpposingAmounts({
    editedSide: "xio",
    amount: "100",
    xioUsd: 0.1,
    quoteUsd: 2,
  });
  assert.ok(equal);
  assert.ok(Math.abs(equal.usd - 10) < 1e-9);
  assert.ok(Math.abs(equal.quote - 5) < 1e-9);

  const linked = linkedDepositAmounts({
    editedSide: "xio",
    amount: "100",
    quoteQty: "",
    reserveBase: 1000,
    reserveQuote: 513.37834,
    preferUsdEqual: true,
    xioUsd: 0.1,
    quoteUsd: 2,
  });
  assert.equal(linked.basis, "usd");
  assert.ok(Math.abs(Number(linked.quoteInput) - 5) < 1e-6);

  // Pool ratio would be wildly different; USD path must win when marks exist.
  const poolOnly = linkedDepositAmounts({
    editedSide: "xio",
    amount: "100",
    reserveBase: 1000,
    reserveQuote: 513.37834,
    preferUsdEqual: false,
  });
  assert.ok(Math.abs(poolOnly.quote - 51.337834) < 1e-6);
  assert.ok(Math.abs(linked.quote - poolOnly.quote) > 1);

  const fromQuote = linkedDepositAmounts({
    editedSide: "quote",
    amount: "",
    quoteQty: "10",
    preferUsdEqual: true,
    xioUsd: 0.5,
    quoteUsd: 2,
  });
  assert.equal(fromQuote.basis, "usd");
  assert.ok(Math.abs(fromQuote.xio - 40) < 1e-9);
  assert.ok(Math.abs(expectedDoubleLpTokens(100, 50, 1000, 500, 200) - 20) < 1e-9);
  assert.ok(Math.abs(expectedDoubleLpTokens(100, 10, 1000, 500, 200) - 4) < 1e-9);
});


