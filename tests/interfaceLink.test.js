import test from "node:test";
import assert from "node:assert/strict";
import {interfaceLinkState} from "../src/utils/interfaceLink.js";

const t = {
  interfaceOffline: "Not connected",
  interfaceConnecting: "Connecting to XIO Interface",
  interfaceOnline: "XIO interface online",
};

test("offline is red-state Not connected when nothing works", () => {
  const down = interfaceLinkState({ status: "error" }, t);
  assert.equal(down.tone, "offline");
  assert.equal(down.label, "Not connected");
});

test("connecting while the handshake is still opening", () => {
  const mid = interfaceLinkState({ status: "connecting" }, t);
  assert.equal(mid.tone, "connecting");
  assert.equal(mid.label, "Connecting to XIO Interface");
});

test("health ok / db source is treated as XIO interface online", () => {
  const up = interfaceLinkState(
    { status: "fallback", health: "ok", source: "db" },
    t
  );
  assert.equal(up.tone, "online");
  assert.equal(up.label, "XIO interface online");
});
