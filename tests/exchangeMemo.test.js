import test from "node:test";
import assert from "node:assert/strict";
import {EXCHANGE_MEMO_FORMAT, EXCHANGE_MEMO_VERSION, EXCHANGE_PLATFORM, exchangeMemoText, extractExchangeMemo, stampExchangeMemo} from "../src/xaman/exchangeMemo.js";
import {hexToAscii, stampTradeTxjson} from "../src/xaman/signMarker.js";
import {ammDepositTx, ammWithdrawTx, offerCreateBuyXio, offerCreateSellXio, quoteAsset} from "../src/xaman/tradeTx.js";
import {xioTrustSetTxjson} from "../src/constants/ledger.js";

test("swap memos read as a natural executed-swap line", () => {
  const marketBuy = exchangeMemoText({
    txjson: offerCreateBuyXio({
      account: "rBuyer",
      quote: quoteAsset("XRP"),
      xio: "1000",
      cost: 2.5,
      market: true,
    }),
    trade: { action: "buy", pair: "XIO/XRP" },
  });
  assert.equal(marketBuy, `${EXCHANGE_PLATFORM} | Swap executed in XIO/XRP | v${EXCHANGE_MEMO_VERSION}`);

  const limitSell = exchangeMemoText({
    txjson: offerCreateSellXio({
      account: "rSeller",
      quote: quoteAsset("RLUSD"),
      xio: "1000",
      proceeds: 1,
    }),
    trade: { action: "sell", pair: "XIO/RLUSD" },
  });
  assert.equal(limitSell, `${EXCHANGE_PLATFORM} | Swap executed in XIO/RLUSD | v${EXCHANGE_MEMO_VERSION}`);
});

test("LP, vote, and pool-create memos follow the natural templates", () => {
  assert.equal(
    exchangeMemoText({
      txjson: ammDepositTx({ account: "rLp", quote: quoteAsset("XRP"), xio: "100", quoteQty: "1" }),
      trade: { action: "addLp", pair: "XIO/XRP" },
    }),
    `${EXCHANGE_PLATFORM} | Liquidity added to XIO/XRP pool`
  );
  assert.equal(
    exchangeMemoText({
      txjson: ammDepositTx({ account: "rLp", quote: quoteAsset("XIO"), xio: "100", quoteQty: "1" }),
      trade: { action: "addLp", pair: "XIO/XDX" },
    }),
    `${EXCHANGE_PLATFORM} | Liquidity added to XIO/XDX pool`
  );
  assert.equal(
    exchangeMemoText({
      txjson: ammDepositTx({
        account: "rLp",
        quote: quoteAsset("XRP"),
        xio: "100",
        mode: "single",
        singleAsset: "xio",
      }),
      trade: { action: "addLp", pair: "XIO/XRP", lpMode: "single" },
    }),
    `${EXCHANGE_PLATFORM} | Single-sided liquidity added to XIO/XRP pool`
  );
  assert.equal(
    exchangeMemoText({
      txjson: ammWithdrawTx({ account: "rLp", quote: quoteAsset("XRP"), lpAmount: "5" }),
      trade: { action: "removeLp", pair: "XIO/XRP" },
    }),
    `${EXCHANGE_PLATFORM} | Liquidity removed from XIO/XRP pool`
  );
  assert.equal(
    exchangeMemoText({
      txjson: ammWithdrawTx({
        account: "rLp",
        quote: quoteAsset("XRP"),
        lpAmount: "5",
        mode: "single",
        singleAsset: "xio",
        amountOut: 10,
      }),
      trade: { action: "removeLp", pair: "XIO/XRP", lpMode: "single" },
    }),
    `${EXCHANGE_PLATFORM} | Single-sided liquidity removed from XIO/XRP pool`
  );
  assert.equal(
    exchangeMemoText({
      txjson: { TransactionType: "AMMVote", Asset: { currency: "XIO" }, Asset2: { currency: "XRP" } },
      trade: { action: "vote", voteType: "trading_fee" },
    }),
    `${EXCHANGE_PLATFORM} | Governance vote submitted: fee adjustment`
  );
  assert.equal(
    exchangeMemoText({
      txjson: { TransactionType: "AMMCreate", Amount: { currency: "XIO" }, Amount2: "1000000" },
      trade: { action: "createPool", pair: "XIO/XDX" },
    }),
    `${EXCHANGE_PLATFORM} | New pool created: XIO/XDX`
  );
  assert.equal(
    exchangeMemoText({ txjson: xioTrustSetTxjson("rA") }),
    `${EXCHANGE_PLATFORM} | XIO trustline opened`
  );
  assert.equal(
    exchangeMemoText({
      txjson: { TransactionType: "Payment", Destination: "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8" },
      trade: { action: "xioPlatformFee" },
    }),
    `${EXCHANGE_PLATFORM} | 1% XIO platform fee`
  );
});

test("stamping keeps the platform memo and the sign marker together", () => {
  const buy = offerCreateBuyXio({
    account: "rBuyer",
    quote: quoteAsset("XRP"),
    xio: "10",
    cost: 1,
    market: true,
  });
  const { txjson } = stampTradeTxjson(stampExchangeMemo(buy, { trade: { action: "buy", pair: "XIO/XRP" } }));
  const memo = extractExchangeMemo(txjson);
  assert.equal(memo.platform, EXCHANGE_PLATFORM);
  assert.equal(memo.module, "swap");
  assert.equal(memo.text, `${EXCHANGE_PLATFORM} | Swap executed in XIO/XRP | v${EXCHANGE_MEMO_VERSION}`);
  assert.equal(hexToAscii(txjson.Memos.find((row) => hexToAscii(row.Memo.MemoFormat) === EXCHANGE_MEMO_FORMAT)?.Memo.MemoFormat), "text/plain");
  assert.equal(txjson.Memos.length, 2);
  assert.equal(memo.text.includes("rBuyer"), false);
});


test("TrustSet memo says removed when LimitAmount is 0", () => {
  assert.equal(
    exchangeMemoText({
      txjson: {
        TransactionType: "TrustSet",
        LimitAmount: { currency: "FPT", issuer: "rFptIssuerxxxxxxxxxxxxxxxxxxxxx", value: "0" },
      },
    }),
    `${EXCHANGE_PLATFORM} | FPT trustline removed`
  );
});
