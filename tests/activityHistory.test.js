import test from "node:test";
import assert from "node:assert/strict";
import {collapseUnchangedPlot, dailyLastPoints, downsampleSeries, carryActivityMetrics, issuedActivitySeries, mergeActivityRows, metricNumber, needsFullIssuanceHistory, rowsFromXrplToGraph} from "../src/activityHistory.js";
import {XIO_ISSUED_AT} from "../src/constants/ledger.js";

test("rowsFromXrplToGraph keeps issuance-to-now holder, trustline, and trader counts", () => {
  const rows = rowsFromXrplToGraph({
    history: [
      { time: Date.parse(XIO_ISSUED_AT), holders: 0, length: 1121, active24H: 0 },
      { time: Date.parse("2021-10-29T15:01:30Z"), holders: 1, length: 4181, active24H: 12 },
      { time: Date.parse("2026-08-22T08:07:07Z"), holders: 15945, length: 19977, active24H: 383 },
    ],
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].trustlines, 1121);
  assert.equal(rows[0].holders, null);
  assert.equal(rows[0].traders, 0);
  assert.equal(rows[1].holders, 1);
  assert.equal(rows[1].traders, 12);
  assert.equal(rows[2].holders, 15945);
  assert.equal(rows[2].traders, 383);
  assert.ok(new Date(rows[0].timestamp) >= new Date("2021-10-24"));
});

test("mergeActivityRows lets a later list overwrite the same timestamp", () => {
  const merged = mergeActivityRows(
    [{ timestamp: "2026-08-22T00:00:00.000Z", holders: 15940, trustlines: 19970 }],
    [{ timestamp: "2026-08-22T00:00:00.000Z", holders: 15944, trustlines: 19980 }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].holders, 15944);
  assert.equal(merged[0].trustlines, 19980);
});

test("mergeActivityRows does not turn a missing trader count into zero", () => {
  const merged = mergeActivityRows(
    [{ timestamp: "2026-08-22T00:00:00.000Z", holders: 15940, traders: 410 }],
    [{ timestamp: "2026-08-22T00:00:00.000Z", holders: 15944, traders: null, trader_count: null }]
  );
  assert.equal(merged[0].holders, 15944);
  assert.equal(merged[0].traders, 410);
});

test("issuedActivitySeries keeps XIO history and only appends a live tip", () => {
  const issued = [
    { timestamp: "2021-10-24T13:31:20.000Z", holders: 1, trustlines: 1121 },
    { timestamp: "2026-08-21T00:00:00.000Z", holders: 15940, trustlines: 19970 },
  ];
  const rows = issuedActivitySeries(issued, {
    timestamp: "2026-08-22T09:00:00.000Z",
    holders: 15945,
    trustlines: 19977,
    traders: 410,
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].trustlines, 1121);
  assert.equal(rows[1].trustlines, 19970);
  assert.equal(rows[2].trustlines, 19977);
  assert.equal(rows[2].traders, 410);
});

test("downsampleSeries keeps first and last points", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ i }));
  const slim = downsampleSeries(rows, 40);
  assert.ok(slim.length <= 41);
  assert.equal(slim[0], rows[0]);
  assert.equal(slim[slim.length - 1], rows[999]);
});

test("needsFullIssuanceHistory is true until the series starts at XIO issuance", () => {
  assert.equal(needsFullIssuanceHistory([]), true);
  assert.equal(
    needsFullIssuanceHistory(
      Array.from({ length: 60 }, (_, i) => ({
        timestamp: new Date(Date.parse("2026-05-01T00:00:00Z") + i * 86400000).toISOString(),
        holders: 15000 + i,
      }))
    ),
    true
  );
  assert.equal(
    needsFullIssuanceHistory(
      Array.from({ length: 60 }, (_, i) => ({
        timestamp: new Date(Date.parse(XIO_ISSUED_AT) + i * 86400000).toISOString(),
        holders: 1 + i,
      }))
    ),
    false
  );
});

test("metricNumber keeps a missing side empty instead of plotting zero", () => {
  assert.equal(metricNumber({ holders: 15945 }, "holders"), 15945);
  assert.equal(metricNumber({ holders: 15945 }, "trustlines"), null);
  assert.equal(metricNumber({ active24H: 0, traders: 0 }, "traders"), 0);
});

test("carryActivityMetrics fills holders, trustlines, and traders forward", () => {
  const rows = carryActivityMetrics([
    { timestamp: "2021-10-24T13:31:20.000Z", holders: 1, trustlines: 1121 },
    { timestamp: "2026-08-21T00:00:00.000Z", holders: 15940, traders: 410 },
    { timestamp: "2026-08-22T09:00:00.000Z", holders: 15945, trustlines: 19977 },
  ]);
  assert.equal(rows[0].traders, null);
  assert.equal(rows[1].trustlines, 1121);
  assert.equal(rows[1].traders, 410);
  assert.equal(rows[2].traders, 410);
  assert.equal(rows[2].trustlines, 19977);
});

test("collapseUnchangedPlot keeps the ends of a flat run", () => {
  const rows = collapseUnchangedPlot([
    { ts: 1, plot: 10 },
    { ts: 2, plot: 10 },
    { ts: 3, plot: 10 },
    { ts: 4, plot: 12 },
    { ts: 5, plot: 12 },
    { ts: 6, plot: 12 },
  ]);
  assert.deepEqual(
    rows.map((row) => row.ts),
    [1, 3, 4, 6]
  );
});

test("dailyLastPoints keeps one row per UTC day", () => {
  const daily = dailyLastPoints([
    { timestamp: "2026-08-21T01:00:00.000Z", holders: 1 },
    { timestamp: "2026-08-21T23:00:00.000Z", holders: 2 },
    { timestamp: "2026-08-22T08:00:00.000Z", holders: 3 },
  ]);
  assert.equal(daily.length, 2);
  assert.equal(daily[0].holders, 2);
  assert.equal(daily[1].holders, 3);
});
