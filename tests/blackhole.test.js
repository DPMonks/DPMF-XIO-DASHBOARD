import test from "node:test";
import assert from "node:assert/strict";
import {ACCOUNT_ONE, ASF_DISABLE_MASTER, XIO_BLACKHOLED_AT, blackholeAtFromTransactions, issuerBlackholeFromAccount, rippleDateToIso} from "../src/utils/blackhole.js";
import {composeTokenDetails} from "../src/tokenDetails.js";

test("issuerBlackholeFromAccount requires a disabled master key and a blackhole regular key", () => {
  const live = issuerBlackholeFromAccount({
    account_data: {
      Flags: 9961472,
      RegularKey: ACCOUNT_ONE,
    },
    account_flags: { disableMasterKey: true },
  });
  assert.equal(live.blackholed, true);
  assert.equal(live.fixed, true);

  const open = issuerBlackholeFromAccount({
    account_data: { Flags: 0, RegularKey: null },
    account_flags: { disableMasterKey: false },
  });
  assert.equal(open.blackholed, false);
});

test("blackholeAtFromTransactions uses the DisableMaster AccountSet date", () => {
  const at = blackholeAtFromTransactions([
    {
      tx: {
        TransactionType: "SetRegularKey",
        RegularKey: ACCOUNT_ONE,
        date: 688398701,
      },
    },
    {
      tx: {
        TransactionType: "AccountSet",
        SetFlag: ASF_DISABLE_MASTER,
        date: 688398751,
      },
    },
  ]);
  assert.equal(at, XIO_BLACKHOLED_AT);
  assert.equal(rippleDateToIso(688398751), XIO_BLACKHOLED_AT);
});

test("composeTokenDetails keeps the ledger blackhole stamp", () => {
  const row = composeTokenDetails({
    overview: {
      blackholed: true,
      blackholed_fixed: true,
      blackholed_at: XIO_BLACKHOLED_AT,
    },
  });
  assert.equal(row.blackholed, true);
  assert.equal(row.blackholed_fixed, true);
  assert.equal(row.blackholed_at, XIO_BLACKHOLED_AT);
});
