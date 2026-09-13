import test from "node:test";
import assert from "node:assert/strict";
import {activityFromAccountTx, activityFromAmmLpTx, activityFromOfferTx, activityFromPaymentTx, activityFromTrustSetTx, isTrustSetRemove, currencyCode, displayTrustlinePair, lpBalanceEventsFromMeta, lpHistoryFromAccountTx, mergeWalletActivity, mergeWalletOrders, orderFromTxjson, ordersFromAccountOffers, pendingFor, pendingFromExecution, rememberPending, rippleIso} from "../src/wallet/ledgerOrders.js";
import {XIO_ISSUER, XIO_XDX_AMM, XIO_XDX_LP_HEX, XIO_XRP_AMM, XIO_XRP_LP_HEX} from "../src/constants/ledger.js";

const BUY = {
  TransactionType: "OfferCreate",
  Account: "rBuyer",
  TakerPays: { currency: "XIO", issuer: XIO_ISSUER, value: "1000" },
  TakerGets: "30000",
};

test("orderFromTxjson reads a limit buy as an XIO/XRP bid", () => {
  const order = orderFromTxjson(BUY);
  assert.equal(order.side, "bid");
  assert.equal(order.pair, "XIO/XRP");
  assert.equal(order.amount, 1000);
  assert.ok(Math.abs(order.price - 0.00003) < 1e-12);
});

test("orderFromTxjson reads a limit sell as an XIO/XRP ask", () => {
  const order = orderFromTxjson({
    TransactionType: "OfferCreate",
    Account: "rSeller",
    TakerGets: { currency: "XIO", issuer: XIO_ISSUER, value: "400" },
    TakerPays: "16000",
  });
  assert.equal(order.side, "ask");
  assert.equal(order.amount, 400);
  assert.ok(Math.abs(order.price - 0.00004) < 1e-12);
});

test("ordersFromAccountOffers keeps the signed-in wallet only", () => {
  const rows = ordersFromAccountOffers(
    [
      BUY,
      {
        Account: "rOther",
        TakerPays: { currency: "XIO", issuer: XIO_ISSUER, value: "10" },
        TakerGets: "100",
      },
    ],
    "rBuyer"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, "rBuyer");
});

test("activityFromOfferTx keeps a resting limit as open recent activity", () => {
  const row = activityFromOfferTx(
    {
      hash: "A".repeat(64),
      date: 0,
      tx: BUY,
      meta: {
        TransactionResult: "tesSUCCESS",
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: "Offer",
              NewFields: { Account: "rBuyer" },
            },
          },
        ],
      },
    },
    "rBuyer"
  );
  assert.equal(row.side, "buy");
  assert.equal(row.xio, 1000);
  assert.equal(row.status, "open");
  assert.equal(row.txid, "A".repeat(64));
});

test("activityFromAccountTx unwraps tx_json and marks a consumed offer filled", () => {
  const rows = activityFromAccountTx(
    [
      {
        hash: "B".repeat(64),
        close_time_iso: "2026-08-23T01:50:00.000Z",
        tx_json: BUY,
        meta: {
          TransactionResult: "tesSUCCESS",
          AffectedNodes: [
            {
              DeletedNode: {
                LedgerEntryType: "Offer",
                FinalFields: { Account: "rBuyer" },
              },
            },
          ],
        },
      },
    ],
    "rBuyer"
  );
  assert.equal(rows[0].status, "filled");
  assert.equal(rows[0].timestamp, "2026-08-23T01:50:00.000Z");
});

test("pendingFromExecution paints the buy immediately and skips IOC as an open order", () => {
  const limit = pendingFromExecution({ txjson: BUY, txid: "C".repeat(64) }, "rBuyer");
  assert.equal(limit.order.side, "bid");
  assert.equal(limit.activity.side, "buy");
  const ioc = pendingFromExecution(
    { txjson: { ...BUY, Flags: 131072 }, txid: "D".repeat(64) },
    "rBuyer"
  );
  assert.equal(ioc.order, null);
  assert.equal(ioc.activity.status, "filled");
  const swap = pendingFromExecution(
    {
      txjson: {
        TransactionType: "Payment",
        Account: "rBuyer",
        Destination: "rBuyer",
        Amount: { currency: "XIO", issuer: XIO_ISSUER, value: "10" },
        SendMax: "313",
        Flags: 131072,
      },
      txid: "E".repeat(64),
    },
    "rBuyer"
  );
  assert.equal(swap.order, null);
  assert.equal(swap.activity.side, "buy");
  assert.equal(swap.activity.status, "filled");
});

test("lp history counts Payment and CheckCash LP credits, not TrustSet limit changes", () => {
  const payment = {
    hash: "P".repeat(64),
    close_time_iso: "2026-08-11T16:46:11.000Z",
    tx: {
      TransactionType: "Payment",
      Account: "rSender",
      Destination: "rLp",
    },
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: XIO_XRP_LP_HEX, value: "-3829530.36240651" },
              HighLimit: { issuer: "rLp", currency: XIO_XRP_LP_HEX },
              LowLimit: { issuer: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX },
            },
            PreviousFields: {
              Balance: { currency: XIO_XRP_LP_HEX, value: "0" },
            },
          },
        },
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: XIO_XRP_LP_HEX, value: "0" },
              HighLimit: { issuer: "rSender", currency: XIO_XRP_LP_HEX },
              LowLimit: { issuer: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX },
            },
            PreviousFields: {
              Balance: { currency: XIO_XRP_LP_HEX, value: "-3829530.36240651" },
            },
          },
        },
      ],
    },
  };
  const checkCash = {
    hash: "C".repeat(64),
    close_time_iso: "2026-08-22T14:11:52.000Z",
    tx: { TransactionType: "CheckCash", Account: "rLp" },
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          DeletedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: XIO_XDX_LP_HEX, value: "0" },
              HighLimit: { issuer: XIO_XDX_AMM, currency: XIO_XDX_LP_HEX },
              LowLimit: { issuer: "rSender", currency: XIO_XDX_LP_HEX },
            },
            PreviousFields: {
              Balance: { currency: XIO_XDX_LP_HEX, value: "25311.06041561472" },
            },
          },
        },
        {
          CreatedNode: {
            LedgerEntryType: "RippleState",
            NewFields: {
              Balance: { currency: XIO_XDX_LP_HEX, value: "-25311.06041561472" },
              HighLimit: { issuer: "rLp", currency: XIO_XDX_LP_HEX },
              LowLimit: { issuer: XIO_XDX_AMM, currency: XIO_XDX_LP_HEX },
            },
          },
        },
      ],
    },
  };
  const trustSet = {
    hash: "T".repeat(64),
    close_time_iso: "2026-08-25T15:19:50.000Z",
    tx: { TransactionType: "TrustSet", Account: "rLp" },
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: XIO_XDX_LP_HEX, value: "-32085.97786351955" },
              HighLimit: { issuer: "rLp", currency: XIO_XDX_LP_HEX, value: "1000000000000000e-4" },
              LowLimit: { issuer: XIO_XDX_AMM, currency: XIO_XDX_LP_HEX },
            },
            PreviousFields: {},
          },
        },
      ],
    },
  };

  assert.equal(lpBalanceEventsFromMeta(trustSet.meta, "rLp").length, 0);
  const history = lpHistoryFromAccountTx([payment, checkCash, trustSet], "rLp");
  assert.equal(history.length, 2);
  assert.equal(history[0].pair, "XIO/XDX");
  assert.equal(history[0].side, "addLp");
  assert.ok(Math.abs(history[0].lp - 25311.06041561472) < 1e-6);
  assert.equal(history[1].pair, "XIO/XRP");
  assert.equal(history[1].side, "addLp");
  assert.ok(Math.abs(history[1].lp - 3829530.36240651) < 1e-6);
  assert.equal(history[1].timestamp.slice(0, 10), "2026-08-11");
});

test("activityFromAmmLpTx reads LP tokens received from ledger metadata", () => {
  const history = activityFromAmmLpTx(
    {
      hash: "A".repeat(64),
      close_time_iso: "2026-08-23T10:00:00.000Z",
      tx: {
        TransactionType: "AMMDeposit",
        Account: "rLp",
        Asset: { currency: "XIO", issuer: XIO_ISSUER },
        Asset2: { currency: "XRP" },
      },
      meta: {
        TransactionResult: "tesSUCCESS",
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: "RippleState",
              FinalFields: {
                Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: "6100.5985" },
                HighLimit: { issuer: "rLp" },
                LowLimit: { issuer: "rAmm" },
              },
              PreviousFields: {
                Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: "0" },
              },
            },
          },
        ],
      },
    },
    "rLp"
  );
  assert.equal(history.side, "addLp");
  assert.equal(history.pair, "XIO/XRP");
  assert.equal(history.lp, 6100.5985);
});

test("pendingFromExecution records an AMM deposit as filled LP activity", () => {
  const pending = pendingFromExecution(
    {
      txjson: {
        TransactionType: "AMMDeposit",
        Account: "rLp",
        Asset: { currency: "XIO", issuer: XIO_ISSUER },
        Asset2: { currency: "XRP" },
      },
      txid: "F".repeat(64),
    },
    "rLp"
  );
  assert.equal(pending.order, null);
  assert.equal(pending.activity.side, "addLp");
  assert.equal(pending.activity.pair, "XIO/XRP");
  assert.equal(pending.activity.status, "filled");
});

test("mergeWalletOrders and mergeWalletActivity keep the first copy", () => {
  const orders = mergeWalletOrders(
    [{ account: "rBuyer", pair: "XIO/XRP", side: "bid", price: 0.03, amount: 1000 }],
    [{ account: "rBuyer", pair: "XIO/XRP", side: "bid", price: 0.03, amount: 1000 }]
  );
  assert.equal(orders.length, 1);
  const activity = mergeWalletActivity(
    [{ account: "rBuyer", side: "buy", xio: 1000, price: 0.03, txid: "E".repeat(64) }],
    [{ account: "rBuyer", side: "buy", xio: 1000, price: 0.03, txid: "e".repeat(64) }]
  );
  assert.equal(activity.length, 1);
});

test("rippleIso uses the XRPL epoch", () => {
  assert.equal(rippleIso(0), "2000-01-01T00:00:00.000Z");
});

test("activityFromPaymentTx keeps a confirmed market buy and drops engine failures", () => {
  const buy = {
    TransactionType: "Payment",
    Account: "rBuyer",
    Destination: "rBuyer",
    Amount: { currency: "XIO", issuer: XIO_ISSUER, value: "10" },
    SendMax: "313",
  };
  const filled = activityFromPaymentTx(
    {
      hash: "1".repeat(64),
      close_time_iso: "2026-08-23T13:50:00.000Z",
      tx: buy,
      meta: { TransactionResult: "tesSUCCESS" },
    },
    "rBuyer"
  );
  assert.equal(filled.side, "buy");
  assert.equal(filled.status, "filled");
  assert.equal(filled.xio, 10);
  assert.equal(
    activityFromPaymentTx(
      { tx: buy, meta: { TransactionResult: "tecPATH_DRY" } },
      "rBuyer"
    ),
    null
  );
});

test("activityFromTrustSetTx records a confirmed XIO line", () => {
  const row = activityFromTrustSetTx(
    {
      hash: "2".repeat(64),
      tx: {
        TransactionType: "TrustSet",
        Account: "rBuyer",
        LimitAmount: { currency: "XIO", issuer: XIO_ISSUER, value: "10000000000" },
      },
      meta: { TransactionResult: "tesSUCCESS" },
    },
    "rBuyer"
  );
  assert.equal(row.side, "trustline");
  assert.equal(row.currency, "XIO");
  assert.equal(row.pair, "XIO");
  const pending = pendingFromExecution(
    {
      txjson: {
        TransactionType: "TrustSet",
        Account: "rBuyer",
        LimitAmount: { currency: "XIO", issuer: XIO_ISSUER, value: "10000000000" },
      },
      txid: "3".repeat(64),
    },
    "rBuyer"
  );
  assert.equal(pending.activity.side, "trustline");
  const history = activityFromAccountTx(
    [
      {
        hash: "4".repeat(64),
        tx: {
          TransactionType: "Payment",
          Account: "rBuyer",
          Destination: "rBuyer",
          Amount: { currency: "XIO", issuer: XIO_ISSUER, value: "5" },
          SendMax: "160",
        },
        meta: { TransactionResult: "tesSUCCESS" },
      },
    ],
    "rBuyer"
  );
  assert.equal(history[0].side, "buy");
});

test("activityFromTrustSetTx labels LimitAmount 0 as removeTrustline", () => {
  assert.equal(isTrustSetRemove({ value: "0" }), true);
  assert.equal(isTrustSetRemove({ value: "10000000000" }), false);
  const row = activityFromTrustSetTx(
    {
      hash: "a".repeat(64),
      tx: {
        TransactionType: "TrustSet",
        Account: "rBuyer",
        LimitAmount: { currency: "BPUG", issuer: "rBpugIssuerxxxxxxxxxxxxxxxxxxxx", value: "0" },
      },
      meta: { TransactionResult: "tesSUCCESS" },
    },
    "rBuyer"
  );
  assert.equal(row.side, "removeTrustline");
  assert.equal(row.removed, true);
  assert.equal(row.pair, "XIO/BPUG");
  const pending = pendingFromExecution(
    {
      txjson: {
        TransactionType: "TrustSet",
        Account: "rBuyer",
        LimitAmount: { currency: "ODC", issuer: "rOdcIssuerxxxxxxxxxxxxxxxxxxxxx", value: "0" },
      },
      txid: "b".repeat(64),
    },
    "rBuyer"
  );
  assert.equal(pending.activity.side, "removeTrustline");
  assert.equal(pending.activity.removed, true);
});

test("trustline activity shows a pair, never a hex dump", () => {
  assert.equal(currencyCode(XIO_XDX_LP_HEX), XIO_XDX_LP_HEX);
  assert.equal(displayTrustlinePair({ currency: XIO_XDX_LP_HEX, issuer: XIO_XDX_AMM }), "XIO/XDX");
  const lpLine = activityFromTrustSetTx(
    {
      hash: "5".repeat(64),
      tx: {
        TransactionType: "TrustSet",
        Account: "rBuyer",
        LimitAmount: { currency: XIO_XDX_LP_HEX, issuer: XIO_XDX_AMM, value: "10000000000" },
      },
      meta: { TransactionResult: "tesSUCCESS" },
    },
    "rBuyer"
  );
  assert.equal(lpLine.pair, "XIO/XDX");
  assert.equal(lpLine.currency, "XIO");
  const hex = "03ABCDEF0123456789ABCDEF0123456789ABCDEF";
  const fromCatalog = displayTrustlinePair(
    { currency: hex, issuer: "rUnknownAmmAccountxxxx" },
    [{ pair: "XIO/XSQUAD", lp_currency: hex, amm_account: "rUnknownAmmAccountxxxx" }]
  );
  assert.equal(fromCatalog, "XIO/XSQUAD");
  assert.equal(currencyCode(hex), hex);
});

test("rememberPending keeps a just-signed limit until the ledger fetch catches up", () => {
  const pending = pendingFromExecution({ txjson: BUY, txid: "F".repeat(64) }, "rBuyer");
  rememberPending("rBuyer", pending);
  assert.equal(pendingFor("rBuyer").orders[0].amount, 1000);
  assert.equal(pendingFor("rBuyer", { offersKnown: true }).activity[0].side, "buy");
});
