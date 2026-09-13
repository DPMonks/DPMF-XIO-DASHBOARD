import test from "node:test";
import assert from "node:assert/strict";
import {RLUSD_HEX, RLUSD_ISSUER, XIO_ISSUER, XDX_ISSUER} from "../src/constants/ledger.js";
import {linesFromAccountLines, loadWalletLines, mapAccountLine} from "../server/walletLedger.js";

test("mapAccountLine keeps every IOU and LP line and drops XIO", () => {
  assert.deepEqual(
    mapAccountLine({
      account: XDX_ISSUER,
      currency: "XIO",
      balance: "0",
      limit: "1000000000",
      no_ripple: true,
    }),
    {
      currency: "XIO",
      ticker: "XIO",
      issuer: XDX_ISSUER,
      balance: "0",
      limit: "1000000000",
      noRipple: true,
      lp: false,
    }
  );
  assert.equal(
    mapAccountLine({
      account: RLUSD_ISSUER,
      currency: RLUSD_HEX,
      balance: "12.5",
    }).ticker,
    "RLUSD"
  );
  assert.equal(mapAccountLine({ account: XIO_ISSUER, currency: "XIO", balance: "9" }), null);
  assert.deepEqual(
    mapAccountLine({
      account: "rAmmLp",
      currency: "03BCD44104644B711C58CD14CD13CBA65757CFBE",
      balance: "1",
    }),
    {
      currency: "03BCD44104644B711C58CD14CD13CBA65757CFBE",
      ticker: "LP",
      issuer: "rAmmLp",
      balance: "1",
      limit: "",
      noRipple: false,
      lp: true,
    }
  );
});

test("linesFromAccountLines keeps both USD issuers", () => {
  const lines = linesFromAccountLines([
    { account: "rGateUsdIssuer11111111111111111111", currency: "USD", balance: "2" },
    { issuer: "rBitstampUsdIssuer111111111111111", currency: "USD", balance: "0" },
  ]);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((row) => row.issuer),
    ["rGateUsdIssuer11111111111111111111", "rBitstampUsdIssuer111111111111111"]
  );
});

test("loadWalletLines pages account_lines until the marker is gone", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.params[0]);
    const page = calls.length;
    return {
      ok: true,
      json: async () => ({
        result: {
          status: "success",
          lines:
            page === 1
              ? [{ account: XDX_ISSUER, currency: "XIO", balance: "1" }]
              : [{ account: RLUSD_ISSUER, currency: RLUSD_HEX, balance: "0" }],
          marker: page === 1 ? { ledger: 1, index: 2 } : undefined,
        },
      }),
    };
  };

  const first = await loadWalletLines("rWallet111111111111111111111111111", { fetchImpl });
  assert.equal(first.source, "xrpl");
  assert.equal(first.lines.length, 2);
  assert.equal(first.lines[0].ticker, "XIO");
  assert.equal(first.lines[1].ticker, "RLUSD");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].limit, 400);
  assert.ok(calls[1].marker);

  const cached = await loadWalletLines("rWallet111111111111111111111111111", { fetchImpl });
  assert.equal(cached.lines.length, 2);
  assert.equal(calls.length, 2);
});
