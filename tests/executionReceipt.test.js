import test from "node:test";
import assert from "node:assert/strict";
import {XIO_ISSUER} from "../src/constants/ledger.js";
import {executionReceipt, formatReceiptHash, lpDeltaFromLedger} from "../src/wallet/executionReceipt.js";
import {ackTradeNotice, peekTradeNotice, rememberTradeNotice} from "../src/wallet/tradeNotice.js";

function memoryStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("executionReceipt reads AMMDeposit amounts and LP from ledger", () => {
  const receipt = executionReceipt({
    txid: "A".repeat(64),
    engineResult: "tesSUCCESS",
    account: "rHolder",
    txjson: {
      TransactionType: "AMMDeposit",
      Asset: { currency: "XIO", issuer: XIO_ISSUER },
      Asset2: { currency: "XRP" },
      Amount: { currency: "XIO", issuer: XIO_ISSUER, value: "1000" },
      Amount2: "5000000",
    },
    ledger: {
      ledger_index: 99123,
      hash: "A".repeat(64),
      meta: {
        TransactionResult: "tesSUCCESS",
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: "RippleState",
              FinalFields: {
                Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: "12.5" },
                HighLimit: { issuer: "rHolder" },
                LowLimit: { issuer: "rAmm" },
              },
              PreviousFields: {
                Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: "10" },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(receipt.pair, "XIO/XRP");
  assert.equal(receipt.paid[0].asset, "XIO");
  assert.equal(receipt.paid[0].value, 1000);
  assert.equal(receipt.paid[1].asset, "XRP");
  assert.equal(receipt.paid[1].value, 5);
  assert.equal(receipt.received[0].asset, "LP");
  assert.equal(receipt.received[0].value, 2.5);
  assert.equal(receipt.ledgerIndex, 99123);
  assert.equal(formatReceiptHash("A".repeat(64)), `${"A".repeat(10)}…${"A".repeat(8)}`);
  assert.equal(
    lpDeltaFromLedger(
      {
        meta: {
          AffectedNodes: [
            {
              ModifiedNode: {
                LedgerEntryType: "RippleState",
                FinalFields: {
                  Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: "12.5" },
                  HighLimit: { issuer: "rHolder" },
                },
                PreviousFields: { Balance: { value: "10" } },
              },
            },
          ],
        },
      },
      "rHolder"
    ),
    2.5
  );
});

test("trade notice survives a new tab until Close", () => {
  const previous = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  globalThis.localStorage = memoryStore();
  globalThis.sessionStorage = memoryStore();
  try {
    rememberTradeNotice({
      kind: "executed",
      txid: "B".repeat(64),
      txjson: { TransactionType: "AMMWithdraw" },
    });
    const stored = peekTradeNotice();
    assert.equal(stored.txid, "B".repeat(64));
    ackTradeNotice();
    assert.equal(peekTradeNotice(), null);
  } finally {
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
  }
});
