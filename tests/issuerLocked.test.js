import test from "node:test";
import assert from "node:assert/strict";
import {XIO_ISSUER, XIO_TOTAL_SUPPLY, issuerLockedFromIssued} from "../src/constants/ledger.js";

test("issuer locked is 10B minus issued obligation", () => {
  const locked = issuerLockedFromIssued(9982052730.02);
  assert.ok(locked > 17_947_269 && locked < 17_947_271);
  assert.equal(issuerLockedFromIssued(0), 0);
  assert.equal(issuerLockedFromIssued(XIO_TOTAL_SUPPLY), 0);
  assert.equal(XIO_ISSUER, "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo");
});
