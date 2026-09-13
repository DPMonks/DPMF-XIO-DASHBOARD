import test from "node:test";
import assert from "node:assert/strict";
import {createRequestScheduler} from "../src/utils/requestScheduler.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("immediate tasks do not wait for the background pool", async () => {
  const schedule = createRequestScheduler({ concurrency: 1 });
  const order = [];

  const background = schedule(async () => {
    order.push("bg-start");
    await wait(40);
    order.push("bg-end");
  });
  const fast = schedule(async () => {
    order.push("token");
  }, { immediate: true });

  await Promise.all([background, fast]);
  assert.equal(order[0], "bg-start");
  assert.ok(order.includes("token"));
  assert.ok(order.indexOf("token") < order.indexOf("bg-end"));
});

test("background pool prefers higher priority when a slot opens", async () => {
  const schedule = createRequestScheduler({ concurrency: 1 });
  const started = [];

  const first = schedule(async () => {
    started.push("first");
    await wait(20);
  });
  const low = schedule(async () => {
    started.push("low");
  }, { priority: 0 });
  const high = schedule(async () => {
    started.push("high");
  }, { priority: 2 });

  await Promise.all([first, low, high]);
  assert.deepEqual(started, ["first", "high", "low"]);
});
