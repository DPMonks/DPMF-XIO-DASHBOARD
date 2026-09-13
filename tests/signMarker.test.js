import test from "node:test";
import assert from "node:assert/strict";
import {SIGN_MEMO_TYPE, asciiToHex, extractTradeMarker, extractTradeMarkerFromPayload, hexToAscii, invoiceIdFromMarker, nextSignMarker, normalizeSignMarker, stampTradeTxjson} from "../src/xaman/signMarker.js";
import {canClaimExecutedTrade, clearConsumedUuids, clearPendingPayload, isConsumedMarker, payloadMatchesPendingTrade, rememberConsumedUuid, rememberPendingPayload} from "../src/xaman/payloadResume.js";
import {offerCreateBuyXio, quoteAsset} from "../src/xaman/tradeTx.js";

function memoryStore() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("stampTradeTxjson writes a dpmf.sign memo and Payment InvoiceID", () => {
  const buy = offerCreateBuyXio({
    account: "rBuyer",
    quote: quoteAsset("XRP"),
    xio: "1000",
    cost: 2.5,
    market: true,
  });
  const { txjson, marker } = stampTradeTxjson(buy);
  assert.match(marker, /^[0-9a-f]{32}$/);
  assert.equal(extractTradeMarker(txjson), marker);
  assert.equal(txjson.InvoiceID, invoiceIdFromMarker(marker));
  assert.equal(hexToAscii(txjson.Memos[0].Memo.MemoType), SIGN_MEMO_TYPE);
  assert.equal(txjson.Memos[0].Memo.MemoData, marker);
  const again = stampTradeTxjson(txjson, nextSignMarker());
  assert.equal(again.marker, marker);
});

test("AMM deposit keeps the same sign marker and no InvoiceID", () => {
  const { txjson, marker } = stampTradeTxjson({
    TransactionType: "AMMDeposit",
    Asset: { currency: "XIO", issuer: "rIssuer" },
    Asset2: { currency: "XRP" },
  });
  assert.equal(extractTradeMarker(txjson), marker);
  assert.equal(txjson.InvoiceID, undefined);
  assert.equal(asciiToHex(SIGN_MEMO_TYPE).length > 0, true);
  assert.equal(normalizeSignMarker(marker), marker);
});

test("a leftover tesSUCCESS without this session's marker cannot claim", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    const { txjson, marker } = stampTradeTxjson({
      TransactionType: "Payment",
      Amount: "1",
    });
    rememberPendingPayload(uuid, {
      watchTrade: true,
      txjson,
      signMarker: marker,
      signState: "unsigned",
      trade: { action: "buy", quote: "XRP" },
    });
    const leftover = {
      payload: {
        tx_type: "Payment",
        request_json: { TransactionType: "Payment", Amount: "1" },
      },
      meta: { signed: true, submitted: true },
      response: { dispatched_result: "tesSUCCESS", account: "rA" },
    };
    assert.equal(payloadMatchesPendingTrade(rememberPendingPayload(uuid), leftover), false);
    assert.equal(canClaimExecutedTrade(uuid, undefined, leftover), false);

    const matched = {
      ...leftover,
      payload: { tx_type: "Payment", request_json: txjson },
    };
    assert.equal(payloadMatchesPendingTrade(rememberPendingPayload(uuid), matched), true);

    rememberConsumedUuid(uuid, marker);
    assert.equal(isConsumedMarker(marker), true);
    assert.equal(canClaimExecutedTrade(uuid), false);
  } finally {
    clearPendingPayload();
    clearConsumedUuids();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("extractTradeMarkerFromPayload reads Xaman request_json", () => {
  const { txjson, marker } = stampTradeTxjson({ TransactionType: "AMMDeposit" });
  assert.equal(extractTradeMarkerFromPayload({ payload: { request_json: txjson } }), marker);
});
