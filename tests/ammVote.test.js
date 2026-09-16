import test from "node:test";
import assert from "node:assert/strict";
import {activityFromAmmVoteTx, ammVoteTxjson, feePercentFromUnits, feeUnitsFromPercent, governanceFromAmmInfo, medianVotedFee, attachVoteTimestamps, assetVoteRowsFromSlots, assetVoteStatus, displayVotePair, formatVoteWeight, mergeAssetVoteRows, voteHistoryFromActivity, weightedVotedFee, knownGovernancePairs, pairFromVoteAssets, poolForVotePair, quoteIssue} from "../src/wallet/ammVote.js";
import {XIO_CURRENCY, XIO_ISSUER, XDX_HEX, XDX_ISSUER} from "../src/constants/ledger.js";

test("pairFromVoteAssets tags XIO/XDX from the XIO hex or issuer", () => {
  assert.equal(
    pairFromVoteAssets({ currency: XIO_CURRENCY, issuer: XIO_ISSUER }, { currency: XDX_HEX, issuer: XDX_ISSUER }),
    "XIO/XDX"
  );
  assert.equal(
    pairFromVoteAssets({ currency: XIO_CURRENCY, issuer: XIO_ISSUER }, { currency: "XDX", issuer: XDX_ISSUER }),
    "XIO/XDX"
  );
  assert.equal(
    pairFromVoteAssets(
      { currency: XIO_CURRENCY, issuer: XIO_ISSUER },
      { currency: "5553444300000000000000000000000000000000", issuer: "rUsdc" }
    ),
    "XIO/USDC"
  );
  assert.equal(displayVotePair("XIO/5553444300000000000000000000000000000000"), "XIO/USDC");
});


test("pairFromVoteAssets returns empty for non-XIO AMMs (no invented XIO/BTC)", () => {
  assert.equal(pairFromVoteAssets({ currency: "BTC", issuer: "rBtc" }, { currency: "ETH", issuer: "rEth" }), "");
  assert.equal(pairFromVoteAssets({ currency: "XRP" }, { currency: "BTC", issuer: "rBtc" }), "");
  assert.equal(pairFromVoteAssets({ currency: "SGB", issuer: "rSgb" }, { currency: "XRP" }), "");
});

test("fee units map 0.25% to 250 and back", () => {
  assert.equal(feeUnitsFromPercent(0.25), 250);
  assert.equal(feePercentFromUnits(250), 0.25);
  assert.equal(feeUnitsFromPercent(1), 1000);
});

test("ammVoteTxjson uses TradingFee units and XIO plus the quote asset", () => {
  const tx = ammVoteTxjson({
    account: "rVoter",
    quote: { id: "XRP", currency: "XRP" },
    tradingFee: 0.6,
  });
  assert.equal(tx.TransactionType, "AMMVote");
  assert.equal(tx.Account, "rVoter");
  assert.equal(tx.TradingFee, 600);
  assert.equal(tx.Asset.currency, "XIO");
  assert.equal(tx.Asset.issuer, XIO_ISSUER);
  assert.equal(tx.Asset2.currency, "XRP");
});

test("governanceFromAmmInfo reads vote slots and the wallet's vote", () => {
  const gov = governanceFromAmmInfo(
    {
      amm: {
        account: "rAmm",
        trading_fee: 500,
        lp_token: { value: "1000" },
        vote_slots: [
          { account: "rVoter", trading_fee: 600, vote_weight: 40000 },
          { account: "rOther", trading_fee: 200, vote_weight: 10000 },
        ],
      },
    },
    { address: "rVoter", pair: "XIO/XRP", lpBalance: 400 }
  );
  assert.equal(gov.eligible, true);
  assert.equal(gov.tradingFeePct, 0.5);
  assert.equal(gov.yourVote.feePercent, 0.6);
  assert.equal(gov.voteCount, 2);
  assert.equal(weightedVotedFee(gov.voteSlots), 0.52);
  assert.equal(medianVotedFee(gov.voteSlots), 0.4);
});

test("activityFromAmmVoteTx keeps a signed fee vote for recent activity", () => {
  const row = activityFromAmmVoteTx(
    {
      hash: "A".repeat(64),
      close_time_iso: "2026-08-23T02:00:00.000Z",
      tx_json: {
        TransactionType: "AMMVote",
        Account: "rVoter",
        TradingFee: 250,
        Asset: { currency: "XIO", issuer: XIO_ISSUER },
        Asset2: { currency: "XRP" },
      },
      meta: { TransactionResult: "tesSUCCESS" },
    },
    "rVoter"
  );
  assert.equal(row.kind, "vote");
  assert.equal(row.pair, "XIO/XRP");
  assert.equal(row.feePercent, 0.25);
  assert.equal(row.timestamp, "2026-08-23T02:00:00.000Z");
});

test("activityFromAmmVoteTx does not invent a vote date when the ledger omitted one", () => {
  const row = activityFromAmmVoteTx(
    {
      tx_json: {
        TransactionType: "AMMVote",
        Account: "rVoter",
        TradingFee: 250,
        Asset: { currency: "XIO", issuer: XIO_ISSUER },
        Asset2: { currency: "XRP" },
      },
      meta: { TransactionResult: "tesSUCCESS" },
    },
    "rVoter"
  );
  assert.equal(row.timestamp, null);
});

test("asset vote rows list every wallet that holds a live AMM vote slot", () => {
  const gov = governanceFromAmmInfo(
    {
      amm: {
        account: "rAmm",
        trading_fee: 1000,
        lp_token: { value: "1000" },
        vote_slots: [
          { account: "rWhale", trading_fee: 1000, vote_weight: 60000 },
          { account: "rSmall", trading_fee: 250, vote_weight: 4000 },
        ],
      },
    },
    { pair: "XIO/XAH" }
  );
  const rows = assetVoteRowsFromSlots(gov.voteSlots, "XIO/XAH");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].account, "rWhale");
  assert.equal(rows[0].pair, "XIO/XAH");
  assert.equal(rows[0].feePercent, 1);
  assert.equal(formatVoteWeight(rows[0].weightPct), "60%");
  const merged = mergeAssetVoteRows(rows, assetVoteRowsFromSlots(gov.voteSlots, "xio / xah"));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].account, "rWhale");
  assert.equal(rows[0].status, "active");
});

test("zero-weight asset votes are not active", () => {
  const rows = assetVoteRowsFromSlots(
    [
      { account: "rLive", pair: "XIO/XRP", feePercent: 1, voteWeight: 50000, weightPct: 50 },
      { account: "rGone", pair: "XIO/XRP", feePercent: 0.25, voteWeight: 0, weightPct: 0 },
    ],
    "XIO/XRP"
  );
  assert.equal(assetVoteStatus(rows[0]), "active");
  assert.equal(assetVoteStatus(rows[1]), "inactive");
  assert.equal(rows[1].status, "inactive");
});

test("attachVoteTimestamps uses the latest AMMVote date for each wallet and pair", () => {
  const rows = attachVoteTimestamps(
    [
      { account: "rDPMFBANK", pair: "XIO/RLUSD", feePercent: 1 },
      { account: "rOther", pair: "XIO/USD", feePercent: 0.25 },
    ],
    [
      { kind: "vote", account: "rDPMFBANK", pair: "XIO/RLUSD", timestamp: "2026-08-20T12:00:00.000Z", txid: "OLD" },
      { kind: "vote", account: "rDPMFBANK", pair: "XIO/RLUSD", timestamp: "2026-08-25T09:15:00.000Z", txid: "NEW" },
      { kind: "vote", account: "rDPMFBANK", pair: "XIO/XRP", timestamp: "2026-08-26T01:00:00.000Z", txid: "XRP" },
    ]
  );
  assert.equal(rows[0].timestamp, "2026-08-25T09:15:00.000Z");
  assert.equal(rows[0].txid, "NEW");
  assert.equal(rows[1].timestamp, undefined);
  const listed = assetVoteRowsFromSlots(
    [{ account: "rWhale", pair: "XIO/XAH", feePercent: 1, voteWeight: 60000, weightPct: 60, timestamp: "2026-08-24T00:00:00.000Z" }],
    "XIO/XAH"
  );
  assert.equal(listed[0].timestamp, "2026-08-24T00:00:00.000Z");
});

test("voteHistoryFromActivity marks an older vote on the same pair replaced", () => {
  const rows = voteHistoryFromActivity(
    [
      { kind: "vote", account: "rVoter", pair: "XIO/XRP", feePercent: 0.25, timestamp: "2026-08-23T02:00:00Z" },
      { kind: "vote", account: "rVoter", pair: "XIO/XRP", feePercent: 0.3, timestamp: "2026-08-20T02:00:00Z" },
    ],
    [{ account: "rVoter" }]
  );
  assert.equal(rows[0].status, "active");
  assert.equal(rows[1].status, "replaced");
});

test("knownGovernancePairs keeps LP and history pairs beside the catalog", () => {
  const names = knownGovernancePairs(
    [{ pool: "XIO/ETH", quote: "ETH" }],
    [{ pool: "XIO/BTC" }, { pair: "XIO/PLX" }]
  );
  assert.ok(names.includes("XIO/ETH"));
  assert.ok(names.includes("XIO/BTC"));
  assert.ok(names.includes("XIO/PLX"));
});

test("poolForVotePair finds a catalog or LP row for the selected pair", () => {
  const row = poolForVotePair(
    [{ pool: "XIO/ETH", quote_issuer: "rEthIssuer11111111111111111111111", amm_account: "rEthAmm" }],
    [{ pool: "XIO/BTC", lp_balance: 4 }],
    "xio / eth"
  );
  assert.equal(row.amm_account, "rEthAmm");
  assert.equal(row.quote_issuer, "rEthIssuer11111111111111111111111");
});

test("quoteIssue keeps an issued quote instead of falling back to XRP", () => {
  const eth = quoteIssue({
    id: "ETH",
    issuer: "rEthIssuer11111111111111111111111",
  });
  assert.equal(eth.currency, "ETH");
  assert.equal(eth.issuer, "rEthIssuer11111111111111111111111");
  assert.equal(quoteIssue({ id: "ETH" }).currency, "XRP");
});
