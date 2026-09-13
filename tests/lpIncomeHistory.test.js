import test from "node:test";
import assert from "node:assert/strict";
import {XIO_ISSUER} from "../src/constants/ledger.js";
import {loadWalletLpIncome} from "../server/walletLedger.js";

function depositRow({ pair = "XIO/XRP", lp = "10", account = "rWallet", hash = "A" }) {
  const quote = pair.split("/")[1];
  return {
    hash: hash.padEnd(64, "0"),
    close_time_iso: "2026-08-23T10:00:00.000Z",
    tx: {
      TransactionType: "AMMDeposit",
      Account: account,
      Asset: { currency: "XIO", issuer: XIO_ISSUER },
      Asset2: quote === "XRP" ? { currency: "XRP" } : { currency: quote, issuer: "rQuote" },
    },
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: String(lp) },
              HighLimit: { issuer: account },
              LowLimit: { issuer: "rAmm" },
            },
            PreviousFields: {
              Balance: { currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9", value: "0" },
            },
          },
        },
      ],
    },
  };
}

test("loadWalletLpIncome pages account_tx and keeps only the selected pair", async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.method, "account_tx");
    calls += 1;
    if (calls === 1) {
      assert.equal(body.params[0].marker, undefined);
      return {
        ok: true,
        json: async () => ({
          result: {
            transactions: [
              depositRow({ pair: "XIO/XRP", lp: "6100.5985", hash: "A" }),
              depositRow({ pair: "XIO/RLUSD", lp: "40", hash: "B" }),
              {
                hash: "C".padEnd(64, "0"),
                tx: {
                  TransactionType: "OfferCreate",
                  Account: "rWallet",
                  TakerPays: { currency: "XIO", issuer: XIO_ISSUER, value: "1" },
                  TakerGets: "1",
                },
                meta: { TransactionResult: "tesSUCCESS" },
              },
            ],
            marker: { ledger: 9, seq: 2 },
          },
        }),
      };
    }
    assert.deepEqual(body.params[0].marker, { ledger: 9, seq: 2 });
    return {
      ok: true,
      json: async () => ({
        result: {
          transactions: [depositRow({ pair: "XIO/XRP", lp: "12", hash: "D" })],
        },
      }),
    };
  };

  const first = await loadWalletLpIncome("rWallet", {
    pair: "XIO/XRP",
    fetchImpl,
    maxPages: 1,
    fresh: true,
  });
  assert.equal(first.complete, false);
  assert.equal(first.activity.length, 1);
  assert.equal(first.activity[0].lp, 6100.5985);
  assert.deepEqual(first.marker, { ledger: 9, seq: 2 });

  const second = await loadWalletLpIncome("rWallet", {
    pair: "XIO/XRP",
    fetchImpl,
    marker: first.marker,
    maxPages: 1,
    fresh: true,
  });
  assert.equal(second.complete, true);
  assert.equal(second.activity.length, 1);
  assert.equal(second.activity[0].lp, 12);
  assert.equal(calls, 2);
});

test("loadWalletLpIncome walks all pairs and Payment LP credits unless a pair is selected", async () => {
  const payment = {
    hash: "P".padEnd(64, "0"),
    close_time_iso: "2026-08-11T16:46:11.000Z",
    tx: { TransactionType: "Payment", Account: "rSender", Destination: "rWallet" },
    meta: {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: "03970105D80AE3C54085F6E97EE16CEDE6CE8200", value: "-100" },
              HighLimit: { issuer: "rWallet" },
              LowLimit: { issuer: "rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB" },
            },
            PreviousFields: {
              Balance: { currency: "03970105D80AE3C54085F6E97EE16CEDE6CE8200", value: "0" },
            },
          },
        },
      ],
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      result: {
        transactions: [
          payment,
          depositRow({ pair: "XIO/RLUSD", lp: "40", hash: "B" }),
        ],
      },
    }),
  });
  const all = await loadWalletLpIncome("rWallet", { pair: "ALL", fetchImpl, fresh: true });
  assert.equal(all.complete, true);
  assert.equal(all.activity.length, 2);
  assert.deepEqual(
    all.activity.map((row) => row.pair).sort(),
    ["XIO/RLUSD", "XIO/XRP"]
  );
  const xrp = await loadWalletLpIncome("rWallet", { pair: "XIO/XRP", fetchImpl, fresh: true });
  assert.equal(xrp.activity.length, 1);
  assert.equal(xrp.activity[0].pair, "XIO/XRP");
  assert.equal(xrp.activity[0].kind, "Payment");
});

test("loadWalletLpIncome walks several account_tx pages in one request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: true,
        json: async () => ({
          result: {
            transactions: [depositRow({ pair: "XIO/XDX", lp: String(calls), hash: String(calls) })],
            marker: { ledger: calls, seq: 1 },
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        result: {
          transactions: [depositRow({ pair: "XIO/XDX", lp: "3", hash: "3" })],
        },
      }),
    };
  };
  const body = await loadWalletLpIncome("rWallet", {
    pair: "XIO/XDX",
    fetchImpl,
    fresh: true,
  });
  assert.equal(calls, 3);
  assert.equal(body.complete, true);
  assert.equal(body.activity.length, 3);
  assert.ok(body.activity.every((row) => row.pair === "XIO/XDX"));
});
