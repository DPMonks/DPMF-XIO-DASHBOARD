import test from "node:test";
import assert from "node:assert/strict";
import {buildTodayLpOwnersPayload, normalizeLpPool, pickAllPoolCount, pickLastLpScan, pickTodayLpSource, remapLpSourceKind} from "../src/todayLpOwners.js";

test("normalizeLpPool keeps every XIO/{QUOTE} name and treats all as no filter", () => {
  assert.equal(normalizeLpPool("XIO/XRP"), "XIO/XRP");
  assert.equal(normalizeLpPool("xio-rlusd"), "XIO/RLUSD");
  assert.equal(normalizeLpPool("SOLO"), "XIO/SOLO");
  assert.equal(normalizeLpPool("XIO/USD"), "XIO/USD");
  assert.equal(normalizeLpPool("all"), null);
  assert.equal(normalizeLpPool("*"), null);
});

test("pickTodayLpSource remaps token source kinds onto LP tables", () => {
  const now = new Date("2026-08-21T22:15:00.000Z");
  const today = pickTodayLpSource({
    latestTs: "2026-08-21T22:15:00.000Z",
    latestCount: 80,
    now,
  });
  assert.equal(today.kind, "lp_holders_latest");
  assert.equal(today.present, true);
  assert.equal(today.count, 80);
  assert.equal(remapLpSourceKind("token_holders_history"), "lp_holders_history");

  const missing = pickTodayLpSource({
    latestTs: "2026-08-20T23:59:00.000Z",
    latestCount: 12,
    historyTs: "2026-08-20T23:59:00.000Z",
    historyCount: 12,
    now,
  });
  assert.equal(missing.present, false);
  assert.equal(missing.kind, "none");
});

test("buildTodayLpOwnersPayload matches the today-LP envelope", () => {
  const empty = buildTodayLpOwnersPayload({
    source: { kind: "none", ts: "2026-08-20T12:00:00.000Z", count: 0, present: false },
    pool: "XIO/XRP",
  });
  assert.deepEqual(empty, {
    holders: [],
    as_of: "2026-08-20T12:00:00.000Z",
    snapshot_day: "2026-08-20",
    present: false,
    catching_up: true,
    count: 0,
    source: "none",
    pool: "XIO/XRP",
  });

  const present = buildTodayLpOwnersPayload({
    source: {
      kind: "lp_holders_latest",
      ts: "2026-08-21T22:15:00.000Z",
      count: 2,
      present: true,
    },
    holders: [
      { account: "rOne", lp_balance: 12.5, frozen: false, pool_name: "XIO/XRP" },
      { account: "rTwo", balance: 1, frozen: true, pool_name: "XIO/SOLO" },
    ],
    pool: "all",
  });
  assert.equal(present.present, true);
  assert.equal(present.catching_up, false);
  assert.equal(present.holders[0].lp_balance, 12.5);
  assert.equal(present.holders[0].balance, 12.5);
  assert.equal(present.holders[0].pool_name, "XIO/XRP");
  assert.equal(present.holders[1].lp_balance, 1);
  assert.equal(present.holders[1].pool_name, "XIO/SOLO");
  assert.equal(present.pool, "all");
});

test("pickLastLpScan remaps the newest token scan onto LP tables", () => {
  const last = pickLastLpScan({
    latestTs: "2026-08-21T22:15:00.000Z",
    latestCount: 80,
    historyTs: "2026-08-20T22:15:00.000Z",
    historyCount: 12,
  });
  assert.equal(last.kind, "lp_holders_latest");
  assert.equal(last.count, 80);
});

test("catching_up LP owners keep the last scan rows on the payload", () => {
  const payload = buildTodayLpOwnersPayload({
    source: {
      kind: "lp_holders_latest",
      ts: "2026-08-21T22:15:00.000Z",
      count: 1,
      present: false,
    },
    holders: [{ account: "rOne", lp_balance: 12.5, pool_name: "XIO/XRP" }],
    pool: "XIO/XRP",
  });
  assert.equal(payload.catching_up, true);
  assert.equal(payload.present, false);
  assert.equal(payload.holders[0].lp_balance, 12.5);
  assert.equal(payload.count, 1);
});

test("pickAllPoolCount uses every pool, not one leftover scan", () => {
  assert.equal(pickAllPoolCount(1, 84), 84);
  assert.equal(pickAllPoolCount(120, 80), 120);
  assert.equal(pickAllPoolCount(0, 0), 0);
});
