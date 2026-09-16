import test from "node:test";
import assert from "node:assert/strict";
import {assessLpOwnersPayload} from "../src/utils/lpOwnersSanity.js";
import {XIO_XDX_LP_XRPL_TO_MD5, XIO_XRP_LP_XRPL_TO_MD5, XIO_XRPL_TO_MD5, xrplToMd5ForLpPool} from "../src/constants/ledger.js";

test("xrpl.to LP MD5s are set and distinct from the XIO token MD5", () => {
  assert.equal(XIO_XRP_LP_XRPL_TO_MD5, "4816f119c6fb9e2edf665adc0136deee");
  assert.equal(XIO_XDX_LP_XRPL_TO_MD5, "06cfb2c7f7b73a31affc7f93dfd747c2");
  assert.notEqual(XIO_XRP_LP_XRPL_TO_MD5, XIO_XRPL_TO_MD5);
  assert.notEqual(XIO_XDX_LP_XRPL_TO_MD5, XIO_XRPL_TO_MD5);
  assert.equal(xrplToMd5ForLpPool("XIO/XRP"), XIO_XRP_LP_XRPL_TO_MD5);
  assert.equal(xrplToMd5ForLpPool("XIO/XDX"), XIO_XDX_LP_XRPL_TO_MD5);
});

test("rejects LP lists that clone the token rich list balances", () => {
  const token = [
    { account: "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8", balance: 4066.54737467 },
    { account: "rUUpjjsbTiAJaquUhNFfd4i7TeFHLJdC5", balance: 500 },
    { account: "r4TcNpqKfVKF5P8EknYJGN4TztvfCcVVW7", balance: 500 },
    { account: "rGSa3s5j98HkyQMa1iKJyu6VdWrARwnvr", balance: 450 },
  ];
  const clone = token.map((row) => ({
    account: row.account,
    lp_balance: row.balance,
    pool_name: "XIO/XRP",
  }));
  const bad = assessLpOwnersPayload(clone, token, { lpSupplyByPool: { "XIO/XRP": 3200 } });
  assert.equal(bad.ok, false);
  assert.ok(["matches_token_rich_list", "exceeds_lp_supply", "absurd_xio_xrp_lp_balance"].includes(bad.reason));
});

test("accepts real XIO/XRP LP balances that differ from the token rich list", () => {
  const token = [
    { account: "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8", balance: 4066.54737467 },
    { account: "rUUpjjsbTiAJaquUhNFfd4i7TeFHLJdC5", balance: 500 },
    { account: "r4TcNpqKfVKF5P8EknYJGN4TztvfCcVVW7", balance: 500 },
  ];
  const lp = [
    { account: "r4TcNpqKfVKF5P8EknYJGN4TztvfCcVVW7", lp_balance: 2220.086742629852, pool_name: "XIO/XRP" },
    { account: "rUhLTsoqZDzLYCxXKi4pK9mhqAWnhEMX3U", lp_balance: 556.708863939312, pool_name: "XIO/XRP" },
    { account: "rrhdzEBtUShYRuGZfts6Su82DEBzb5KE5", lp_balance: 354.591961519944, pool_name: "XIO/XRP" },
    { account: "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8", lp_balance: 3.73767060434, pool_name: "XIO/XRP" },
  ];
  const good = assessLpOwnersPayload(lp, token, { lpSupplyByPool: { "XIO/XRP": 3200 } });
  assert.equal(good.ok, true);
});
