import test from "node:test";
import assert from "node:assert/strict";
import {buildTodayOwnersPayload, isSameUtcDay, keepLastGoodOwners, pickLastOwnerScan, pickTodayOwnerSource, preferLiveOwnerRows, utcDay, wantsTodaySnapshot} from "../src/todayOwners.js";

test("wantsTodaySnapshot matches indexer PR #5 query strings", () => {
  assert.equal(wantsTodaySnapshot({ snapshot: "today" }), true);
  assert.equal(wantsTodaySnapshot({ snapshot: "1" }), true);
  assert.equal(wantsTodaySnapshot({ as_of: "true" }), true);
  assert.equal(wantsTodaySnapshot({ snapshot: "yesterday" }), false);
  assert.equal(wantsTodaySnapshot(new URLSearchParams("snapshot=today")), true);
});

test("pickTodayOwnerSource requires a same-UTC-day timestamp", () => {
  const now = new Date("2026-08-21T20:15:00.000Z");
  const today = pickTodayOwnerSource({
    latestTs: "2026-08-21T20:15:00.000Z",
    latestCount: 235,
    now,
  });
  assert.equal(today.kind, "token_holders_latest");
  assert.equal(today.present, true);
  assert.equal(today.count, 235);

  const missingTs = pickTodayOwnerSource({
    latestCount: 235,
    latestTs: null,
    now,
  });
  assert.equal(missingTs.kind, "none");
  assert.equal(missingTs.present, false);

  const yesterday = pickTodayOwnerSource({
    latestTs: "2026-08-20T23:59:00.000Z",
    latestCount: 200,
    historyTs: "2026-08-20T23:59:00.000Z",
    historyCount: 200,
    now,
  });
  assert.equal(yesterday.kind, "none");
  assert.equal(yesterday.present, false);
  assert.equal(isSameUtcDay("2026-08-20T23:59:00.000Z", utcDay(now)), false);
});

test("buildTodayOwnersPayload matches indexer catching_up shape", () => {
  const empty = buildTodayOwnersPayload({
    source: { kind: "none", ts: "2026-08-20T12:00:00.000Z", count: 0, present: false },
  });
  assert.deepEqual(empty, {
    holders: [],
    as_of: "2026-08-20T12:00:00.000Z",
    snapshot_day: "2026-08-20",
    present: false,
    catching_up: true,
    count: 0,
    source: "none",
  });

  const present = buildTodayOwnersPayload({
    source: {
      kind: "token_holders_latest",
      ts: "2026-08-21T20:15:00.000Z",
      count: 2,
      present: true,
    },
    holders: [
      { account: "rOne", balance: 10, frozen: true },
      { account: "rTwo", balance: 1, frozen: false },
    ],
  });
  assert.equal(present.present, true);
  assert.equal(present.catching_up, false);
  assert.equal(present.holders[0].frozen, true);
  assert.equal(present.holders[0].rank, 1);
  assert.equal(present.count, 2);
});

test("pickLastOwnerScan keeps the newest scan even when it is not today", () => {
  const last = pickLastOwnerScan({
    latestTs: "2026-08-21T23:59:00.000Z",
    latestCount: 200,
    historyTs: "2026-08-22T00:10:00.000Z",
    historyCount: 235,
  });
  assert.equal(last.kind, "token_holders_history");
  assert.equal(last.count, 235);
  assert.equal(last.ts, "2026-08-22T00:10:00.000Z");
});

test("catching_up owners keep the last scan rows on the payload", () => {
  const payload = buildTodayOwnersPayload({
    source: {
      kind: "token_holders_latest",
      ts: "2026-08-21T20:15:00.000Z",
      count: 2,
      present: false,
    },
    holders: [
      { account: "rOne", balance: 10, frozen: true },
      { account: "rTwo", balance: 1, frozen: false },
    ],
  });
  assert.equal(payload.present, false);
  assert.equal(payload.catching_up, true);
  assert.equal(payload.holders.length, 2);
  assert.equal(payload.holders[0].account, "rOne");
  assert.equal(payload.count, 2);
});

test("keepLastGoodOwners does not blank a painted list while catching up", () => {
  const previous = {
    rows: [{ account: "rOld", balance: 5, rank: 1 }],
    freshness: { catching_up: false, present: true, count: 1 },
  };
  const kept = keepLastGoodOwners(previous, {
    rows: [],
    freshness: { catching_up: true, present: false, as_of: "2026-08-21T20:15:00.000Z" },
  });
  assert.equal(kept.rows[0].account, "rOld");
  assert.equal(kept.freshness.catching_up, true);
  assert.equal(kept.freshness.present, false);

  const replaced = keepLastGoodOwners(previous, {
    rows: [{ account: "rNew", balance: 9, rank: 1 }],
    freshness: { catching_up: false, present: true },
  });
  assert.equal(replaced.rows[0].account, "rNew");
  assert.equal(replaced.freshness.catching_up, false);
});

test("keepLastGoodOwners keeps a just-signed LP row above a stale snapshot", () => {
  const previous = {
    rows: [
      { account: "rWhale", pair: "XIO/XAH", lp_balance: 100, rank: 1 },
      {
        account: "rDPMFBANKMexTKkC7e4Add",
        pair: "XIO/XAH",
        lp_balance: 37.41657387,
        live: true,
        rank: 2,
      },
    ],
    freshness: { catching_up: false, present: true, count: 2 },
  };
  const kept = keepLastGoodOwners(previous, {
    rows: [
      { account: "rWhale", pair: "XIO/XAH", lp_balance: 100, rank: 1 },
      { account: "rDPMFBANKMexTKkC7e4Add", pair: "XIO/XAH", lp_balance: 20, rank: 2 },
    ],
    freshness: { catching_up: false, present: true, count: 2 },
  });
  const live = kept.rows.find((row) => row.account === "rDPMFBANKMexTKkC7e4Add");
  assert.equal(live.lp_balance, 37.41657387);
  assert.equal(live.live, true);

  const missing = preferLiveOwnerRows(
    [
      {
        account: "rDPMFBANKMexTKkC7e4Add",
        pair: "XIO/XAH",
        lp_balance: 12.5,
        live: true,
      },
    ],
    [{ account: "rWhale", pair: "XIO/XAH", lp_balance: 100 }]
  );
  assert.equal(missing.some((row) => row.account === "rDPMFBANKMexTKkC7e4Add"), true);
  assert.equal(missing.find((row) => row.account === "rDPMFBANKMexTKkC7e4Add").lp_balance, 12.5);
});
