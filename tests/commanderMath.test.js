import test from "node:test";
import assert from "node:assert/strict";
import {safeEvaluate, looksLikeMathQuestion, parseMathIntent, runCommanderMath, compoundDaily, lpSharePct, feeSplitEstimate, toBps, fromBps, pctChange, drawdownPct, riskReward, notionalSize} from "../server/commanderMath.js";

test("safeEvaluate does arithmetic without eval", () => {
  const r = safeEvaluate("12 * 1.2 + 3");
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.value - 17.4) < 1e-9);
});

test("safeEvaluate rejects unsafe characters", () => {
  const r = safeEvaluate("process.exit(1)");
  assert.equal(r.ok, false);
});

test("percent of literal", () => {
  const r = parseMathIntent("what's 20% of 500");
  assert.equal(r.ok, true);
  assert.equal(r.kind, "percent_of");
  assert.equal(r.value, 100);
});

test("percent of bound wallet balance", () => {
  const r = parseMathIntent("what's 20% of my xrp balance", { xrp: 250 });
  assert.equal(r.ok, true);
  assert.equal(r.value, 50);
});

test("compound daily milestones", () => {
  const r = parseMathIntent("compound 20% for 7 days from $34");
  assert.equal(r.ok, true);
  assert.equal(r.kind, "compound_daily");
  const expected = compoundDaily(34, 0.2, 7);
  assert.ok(Math.abs(r.value - expected) < 1e-9);
  assert.ok(r.milestones?.length >= 7);
});

test("bps of notional", () => {
  const r = parseMathIntent("25 bps of 10000");
  assert.equal(r.ok, true);
  assert.equal(r.value, 25);
});

test("lp share", () => {
  const r = parseMathIntent("lp share 1200 of 50000");
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.value - 2.4) < 1e-9);
});

test("fee split estimate helper", () => {
  assert.equal(feeSplitEstimate(100_000, 0.003, 0.02), 6);
});

test("desk helpers", () => {
  assert.equal(toBps(0.0025), 25);
  assert.equal(fromBps(25), 0.0025);
  assert.ok(Math.abs(pctChange(100, 120) - 20) < 1e-9);
  assert.ok(Math.abs(drawdownPct(100, 82) - 18) < 1e-9);
  assert.ok(Math.abs(riskReward(10, 9, 13) - 3) < 1e-9);
  assert.equal(notionalSize(500, 0.02), 10);
  assert.ok(Math.abs(lpSharePct(1200, 50000) - 2.4) < 1e-9);
});

test("looksLikeMathQuestion detection", () => {
  assert.equal(looksLikeMathQuestion("compound 20% for 7 days from 34"), true);
  assert.equal(looksLikeMathQuestion("what is agent prime doing"), false);
});

test("runCommanderMath formats British calm reply", () => {
  const out = runCommanderMath("what is 20% of 150");
  assert.equal(out.ok, true);
  assert.match(out.text, /Computed:/);
  assert.match(out.text, /Method:/);
  assert.doesNotMatch(out.text, /\u2014/);
});
