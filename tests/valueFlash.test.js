import test from "node:test";
import assert from "node:assert/strict";
import {changeDirection} from "../src/utils/valueFlash.js";

test("changeDirection flashes green up and red down", () => {
  assert.equal(changeDirection(1, 2), "up");
  assert.equal(changeDirection(10, 9.5), "down");
  assert.equal(changeDirection(4, 4), null);
  assert.equal(changeDirection(null, 8), null);
  assert.equal(changeDirection("0.00004448", "0.00004450"), "up");
});
