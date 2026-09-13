import test from "node:test";
import assert from "node:assert/strict";
import {detectTradeExecution, extractTxHash, isTradeTxjson, ledgerExecutionSignals, payloadExecutionSignals, unwrapLedgerTx} from "../src/xaman/detectExecution.js";

const HASH = "A".repeat(64);

test("isTradeTxjson only treats signed ledger trades as trades", () => {
  assert.equal(isTradeTxjson({ TransactionType: "OfferCreate" }), true);
  assert.equal(isTradeTxjson({ TransactionType: "AMMDeposit" }), true);
  assert.equal(isTradeTxjson({ TransactionType: "AMMWithdraw" }), true);
  assert.equal(isTradeTxjson({ TransactionType: "AMMVote" }), true);
  assert.equal(isTradeTxjson({ TransactionType: "AMMCreate" }), true);
  assert.equal(isTradeTxjson({ TransactionType: "Payment", SendMax: "1" }), true);
  assert.equal(isTradeTxjson({ TransactionType: "Payment" }), false);
  assert.equal(isTradeTxjson({ TransactionType: "SignIn" }), false);
  assert.equal(isTradeTxjson({ TransactionType: "TrustSet" }), false);
});

test("extractTxHash accepts a 64-character hash from Xaman or XRPL", () => {
  assert.equal(extractTxHash({ response: { txid: HASH.toLowerCase() } }), HASH);
  assert.equal(extractTxHash({ hash: HASH }), HASH);
  assert.equal(extractTxHash({ txid: "nope" }), null);
});

test("Xaman dispatch tesSUCCESS is an executed trade", () => {
  const detection = detectTradeExecution({
    payload: {
      meta: { signed: true, submitted: true },
      response: { txid: HASH, dispatched_result: "tesSUCCESS", account: "rA" },
    },
  });
  assert.equal(detection.executed, true);
  assert.equal(detection.via, "xaman-dispatch");
  assert.ok(detection.detectors.includes("xaman-dispatch"));
});

test("a Xaman sign plus a txid is not executed until tesSUCCESS", () => {
  const detection = detectTradeExecution({
    socket: { signed: true },
    payload: { meta: { signed: true }, response: { txid: HASH } },
  });
  assert.equal(detection.executed, false);
  assert.equal(detection.signed, true);
  assert.equal(detection.pending, true);
  assert.ok(detection.detectors.includes("xaman-socket"));
});

test("validated XRPL tesSUCCESS is an executed trade", () => {
  const detection = detectTradeExecution({
    ledger: {
      hash: HASH,
      validated: true,
      Account: "rA",
      meta: { TransactionResult: "tesSUCCESS" },
    },
  });
  assert.equal(detection.executed, true);
  assert.equal(detection.via, "xrpl-validated");
  assert.equal(ledgerExecutionSignals({ error: "txnNotFound" }).found, false);
});

test("a cancelled Xaman payload is not an executed trade", () => {
  const detection = detectTradeExecution({
    payload: { meta: { cancelled: true, signed: false } },
  });
  assert.equal(detection.executed, false);
  assert.equal(detection.rejected, true);
  assert.equal(payloadExecutionSignals({ meta: { cancelled: true } }).cancelled, true);
});

test("a signed payload is not executed until the ledger returns tesSUCCESS", () => {
  const signedOnly = detectTradeExecution({
    payload: {
      meta: { signed: true, resolved: true, submitted: false },
      response: { hex: "1200" },
    },
  });
  assert.equal(signedOnly.executed, false);
  assert.equal(signedOnly.signed, true);
  assert.equal(detectTradeExecution({ payload: { meta: { signed: true } } }).executed, false);
});

test("a signed Xaman tec without a ledger result is still pending", () => {
  const detection = detectTradeExecution({
    payload: {
      meta: { signed: true, submitted: true },
      response: { txid: HASH, dispatched_result: "tecUNFUNDED_AMM" },
    },
  });
  assert.equal(detection.executed, false);
  assert.equal(detection.failed, false);
  assert.equal(detection.pending, true);
  assert.equal(detection.engineResult, "tecUNFUNDED_AMM");
});

test("validated ledger tesSUCCESS wins over a leftover Xaman tec", () => {
  const detection = detectTradeExecution({
    payload: {
      meta: { signed: true, submitted: true },
      response: { txid: HASH, dispatched_result: "tecUNFUNDED_AMM" },
    },
    ledger: {
      hash: HASH,
      validated: true,
      Account: "rA",
      meta: { TransactionResult: "tesSUCCESS" },
    },
  });
  assert.equal(detection.executed, true);
  assert.equal(detection.failed, false);
  assert.equal(detection.via, "xrpl-validated");
  assert.equal(detection.engineResult, "tesSUCCESS");
});

test("validated ledger tec is a failed trade", () => {
  const detection = detectTradeExecution({
    payload: {
      meta: { signed: true, submitted: true },
      response: { txid: HASH, dispatched_result: "tecUNFUNDED_AMM" },
    },
    ledger: {
      hash: HASH,
      validated: true,
      Account: "rA",
      meta: { TransactionResult: "tecUNFUNDED_AMM" },
    },
  });
  assert.equal(detection.executed, false);
  assert.equal(detection.failed, true);
  assert.equal(detection.via, "xrpl-failed");
});

test("ledger tx unwraps the rippled result envelope", () => {
  const inner = {
    Account: "rA",
    hash: HASH,
    validated: true,
    meta: { TransactionResult: "tesSUCCESS" },
  };
  assert.equal(unwrapLedgerTx({ result: inner }).Account, "rA");
  const detection = detectTradeExecution({ ledger: { result: inner } });
  assert.equal(detection.executed, true);
  assert.equal(detection.via, "xrpl-validated");
});
