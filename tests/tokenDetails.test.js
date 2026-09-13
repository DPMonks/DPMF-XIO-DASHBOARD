import test from "node:test";
import assert from "node:assert/strict";
import {composeTokenDetails} from "../src/tokenDetails.js";

test("composeTokenDetails paints price and supply without Node 3 LP counts", () => {
  const row = composeTokenDetails({
    overview: {
      holder_count: 235,
      trustline_count: 412,
      circulating: 9_800_000_000,
      issuer_locked: 200_000_000,
      xioUsd: 0.000045,
      xrpUsd: 2.4,
      issuer: "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo",
      source: "db",
    },
    prices: { xioUsd: 0.000045, xrpUsd: 2.4 },
    change: { xio: 1.2 },
  });

  assert.equal(row.tokenType, "XIO");
  assert.equal(row.price, 0.000045);
  assert.equal(row.holders, 235);
  assert.equal(row.trustlines, 412);
  assert.equal(row.lp_holder_count, null);
  assert.equal(row.lp_trustline_count, null);
  assert.equal(row.change24h, 1.2);
});

test("composeTokenDetails fills LP counts after Node 3 returns", () => {
  const row = composeTokenDetails({
    overview: { holder_count: 235, lp_holder_count: null },
    lpHolders: { count: 88 },
    lpTrustlines: { count: 120 },
  });
  assert.equal(row.lp_holder_count, 88);
  assert.equal(row.lp_trustline_count, 120);
});
