import test from "node:test";
import assert from "node:assert/strict";
import {XIO_HEX} from "../src/constants/ledger.js";
import {rippleCloseIso, swapVolumeFromAccountTx, xioDeltaFromAmmMeta} from "../src/utils/ammSwapVolume.js";
import {mergeTradePrints} from "../src/xioTrades.js";
import {mergeTradeFlows} from "../server/catalogSwitch.js";
import {mergeVolumeMaps} from "../server/ammPoolVolume.js";
import {preferRailwayXioVolume} from "../src/utils/lpVolume.js";

const AMM = "rPoolAmm111111111111111111111111111";

function rippleState(prev, next) {
  return {
    ModifiedNode: {
      LedgerEntryType: "RippleState",
      FinalFields: {
        Balance: { currency: XIO_HEX, value: String(next) },
        HighLimit: { issuer: AMM },
        LowLimit: { issuer: "rOther" },
      },
      PreviousFields: {
        Balance: { currency: XIO_HEX, value: String(prev) },
      },
    },
  };
}

test("xioDeltaFromAmmMeta reads the AMM XIO trust line only", () => {
  const delta = xioDeltaFromAmmMeta(
    {
      AffectedNodes: [
        rippleState(1000, 800),
        {
          ModifiedNode: {
            LedgerEntryType: "RippleState",
            FinalFields: {
              Balance: { currency: "USD", value: "5" },
              HighLimit: { issuer: AMM },
            },
            PreviousFields: { Balance: { currency: "USD", value: "4" } },
          },
        },
      ],
    },
    AMM
  );
  assert.equal(delta, -200);
});

test("swapVolumeFromAccountTx sums 24h Payments and skips LP deposits", () => {
  const now = Date.parse("2026-08-26T16:00:00.000Z");
  const counted = swapVolumeFromAccountTx(
    [
      {
        close_time_iso: "2026-08-26T15:00:00.000Z",
        tx: { TransactionType: "Payment" },
        meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [rippleState(1000, 700)] },
      },
      {
        close_time_iso: "2026-08-26T14:00:00.000Z",
        tx: { TransactionType: "AMMDeposit" },
        meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [rippleState(700, 900)] },
      },
      {
        close_time_iso: "2026-08-24T15:00:00.000Z",
        tx: { TransactionType: "Payment" },
        meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [rippleState(900, 400)] },
      },
    ],
    { ammAccount: AMM, now }
  );
  assert.equal(counted.volume24hXio, 300);
  assert.equal(counted.trades24h, 1);
  assert.equal(counted.complete, true);
  assert.equal(counted.source, "xrpl-amm");
});

test("rippleCloseIso understands ledger close times and ripple epoch", () => {
  assert.equal(rippleCloseIso({ close_time_iso: "2026-08-26T16:48:01.000Z" }), "2026-08-26T16:48:01.000Z");
  const iso = rippleCloseIso({ date: 804556800 });
  assert.ok(iso.startsWith("2025-") || iso.startsWith("2026-") || iso.startsWith("20"));
});

test("mergeTradePrints keeps other-pair history next to a stale XRP tape", () => {
  const merged = mergeTradePrints(
    [{ timestamp: "2026-08-23T23:00:00.000Z", pool: "XIO/XRP", xio: 10, side: "buy" }],
    [{ timestamp: "2026-08-26T12:00:00.000Z", pool: "XIO/CSC", xio: 40, side: "sell" }]
  );
  assert.equal(merged[0].pool, "XIO/CSC");
  assert.equal(merged.length, 2);
});

test("mergeTradeFlows does not let a stale XRP-only DB tape hide live prints", () => {
  const merged = mergeTradeFlows(
    [{ timestamp: "2026-08-23T23:00:00.000Z", pool: "XIO/XRP", xio: 10 }],
    [{ timestamp: "2026-08-26T16:00:00.000Z", pool: "XIO/XDX", xio: 13325 }]
  );
  assert.ok(merged.some((row) => row.pool === "XIO/XDX"));
  assert.ok(merged.some((row) => row.pool === "XIO/XRP"));
});

test("mergeVolumeMaps keeps the larger 24h XIO print", () => {
  const merged = mergeVolumeMaps(
    { "XIO/XRP": { volume24hXio: 1_400_000, source: "xrpl.to-history" } },
    { "XIO/XDX": { volume24hXio: 13325, source: "xrpl-amm" }, "XIO/XRP": { volume24hXio: 1_200_000, source: "xrpl-amm" } }
  );
  assert.equal(merged["XIO/XRP"].volume24hXio, 1_400_000);
  assert.equal(merged["XIO/XDX"].volume24hXio, 13325);
});

test("preferRailwayXioVolume keeps a tagged thin-pool print", () => {
  const kept = preferRailwayXioVolume(
    { volume24hXio: 6037, volumeSource: "xrpl-amm" },
    { volume24h: 0 }
  );
  assert.equal(kept.volume24hXio, 6037);
  const usd = preferRailwayXioVolume(
    { volume24h: 197, xrpUsd: 1.48 },
    { volume24hXio: 4_200_000, volumeSource: "xrpl.to-token" }
  );
  assert.equal(usd.volume24hXio, 4_200_000);
});
