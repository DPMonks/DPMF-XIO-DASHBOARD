import test from "node:test";
import assert from "node:assert/strict";
import {XIO_ISSUER, XDX_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER} from "../src/constants/ledger.js";
import {isTransientXrplError, loadLiveAmmReserves, loadLiveAmmReservesMany, mapLimit, withXrplRetry} from "../server/liveAmmReserves.js";

function rpcFetch(handler) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ result: handler(body.method, body.params?.[0] || {}) }),
    };
  };
}

test("loadLiveAmmReserves labels an AMM account by its assets, not XIO/XRP", async () => {
  const fetchImpl = rpcFetch((method, params) => {
    assert.equal(method, "amm_info");
    assert.equal(params.amm_account, "rXsquadAmm");
    return {
      amm: {
        account: "rXsquadAmm",
        amount: { currency: "XIO", issuer: XIO_ISSUER, value: "1000" },
        amount2: { currency: XSQUAD_HEX, issuer: XSQUAD_ISSUER, value: "40" },
        lp_token: {
          currency: "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          issuer: "rXsquadAmm",
          value: "80",
        },
      },
    };
  });
  const live = await loadLiveAmmReserves(
    { ammAccount: "rXsquadAmm", fresh: true },
    { fetchImpl, now: Date.now() }
  );
  assert.equal(live.reserve_source, "amm_info");
  assert.equal(live.pair, "XIO/XSQUAD");
  assert.equal(live.quote, "XSQUAD");
  assert.equal(live.reserve_currency, 40);
});

test("loadLiveAmmReserves reads a new XIO/XDX pool from amm_info by asset pair", async () => {
  const fetchImpl = rpcFetch((method, params) => {
    assert.equal(method, "amm_info");
    assert.equal(params.asset.currency, "XIO");
    assert.equal(params.asset2.currency, "XIO");
    assert.equal(params.asset2.issuer, XDX_ISSUER);
    return {
      amm: {
        account: "rDJXzsZGACeHGJQYfaudsYshaC5zJxqsHr",
        amount: { currency: "XIO", issuer: XIO_ISSUER, value: "52286366.55495586" },
        amount2: { currency: "XIO", issuer: XDX_ISSUER, value: "59.93807084355173" },
        lp_token: {
          currency: "03E7A465A6E95CDA21E1110056AA51A71FA55CB9",
          issuer: "rDJXzsZGACeHGJQYfaudsYshaC5zJxqsHr",
          value: "44936.64667926788",
        },
        trading_fee: 1000,
      },
    };
  });
  const live = await loadLiveAmmReserves(
    { pair: "XIO/XDX", quote: "XIO", issuer: XDX_ISSUER, fresh: true },
    { fetchImpl, now: Date.now() }
  );
  assert.equal(live.reserve_source, "amm_info");
  assert.equal(live.amm_account, "rDJXzsZGACeHGJQYfaudsYshaC5zJxqsHr");
  assert.ok(Math.abs(live.reserve_currency - 59.93807084355173) < 1e-9);
  assert.ok(Math.abs(live.lp_supply - 44936.64667926788) < 1e-9);
});

test("loadLiveAmmReserves does not look up XIO/XRP when an unknown IOU has no issuer", async () => {
  let called = 0;
  const fetchImpl = rpcFetch(() => {
    called += 1;
    return {};
  });
  const live = await loadLiveAmmReserves(
    { pair: "XIO/NEWCOIN", quote: "NEWCOIN", fresh: true },
    { fetchImpl, now: Date.now() }
  );
  assert.equal(called, 0);
  assert.equal(live.reserve_source, "empty");
});

test("loadLiveAmmReserves falls back to asset pair when amm_account fails", async () => {
  const fetchImpl = rpcFetch((method, params) => {
    if (params.amm_account === "rMissing") {
      return {};
    }
    return {
      amm: {
        account: "rUsdcAmm",
        amount: { currency: "XIO", issuer: XIO_ISSUER, value: "80000" },
        amount2: { currency: "USDC", issuer: "rUsdc", value: "250" },
        lp_token: { currency: "03ABCDEF0123456789ABCDEF0123456789ABCDEF", issuer: "rUsdcAmm", value: "4000" },
      },
    };
  });
  const live = await loadLiveAmmReserves(
    {
      pair: "XIO/USDC",
      quote: "USDC",
      issuer: "rUsdc",
      ammAccount: "rMissing",
      fresh: true,
    },
    { fetchImpl, now: Date.now() }
  );
  assert.equal(live.reserve_source, "amm_info");
  assert.equal(live.reserve_currency, 250);
  assert.equal(live.amm_account, "rUsdcAmm");
});

test("mapLimit keeps order while capping concurrency", async () => {
  const active = [];
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    active.push(value);
    peak = Math.max(peak, active.length);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active.splice(active.indexOf(value), 1);
    return value * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.ok(peak <= 2);
});

test("withXrplRetry retries 429 then returns the live result", async () => {
  assert.equal(isTransientXrplError(new Error("XRPL RPC 429")), true);
  let calls = 0;
  const result = await withXrplRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("XRPL RPC 429");
      return { ok: true };
    },
    { retries: 3, waitMs: 1 }
  );
  assert.equal(calls, 3);
  assert.deepEqual(result, { ok: true });
});

test("loadLiveAmmReserves retries a 429 and does not cache the failure", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({
        result: {
          amm: {
            account: "rRetryAmm",
            amount: { currency: "XIO", issuer: XIO_ISSUER, value: "1000" },
            amount2: { currency: "XRP", value: "2000000" },
            lp_token: { currency: "03RETRY", issuer: "rRetryAmm", value: "50" },
          },
        },
      }),
    };
  };
  const first = await loadLiveAmmReserves(
    { pair: "XIO/XRP", quote: "XRP", ammAccount: "rRetryAmm", fresh: true },
    { fetchImpl, now: 1, waitMs: 1, retries: 2 }
  );
  assert.equal(first.reserve_source, "amm_info");
  assert.equal(first.reserve_xio, 1000);
  assert.ok(calls >= 2);
});

test("loadLiveAmmReservesMany overlays every catalog account without a 429 stampede", async () => {
  const seen = [];
  const fetchImpl = rpcFetch((_method, params) => {
    seen.push(params.amm_account);
    return {
      amm: {
        account: params.amm_account,
        amount: { currency: "XIO", issuer: XIO_ISSUER, value: String(seen.length * 1000) },
        amount2: { currency: "XRP", value: "1000000" },
        lp_token: { currency: "03BATCH", issuer: params.amm_account, value: "10" },
      },
    };
  });
  const queries = Array.from({ length: 6 }, (_, i) => ({
    pair: "XIO/XRP",
    quote: "XRP",
    ammAccount: `rPool${i}`,
    fresh: true,
  }));
  const rows = await loadLiveAmmReservesMany(queries, { fetchImpl, now: Date.now(), concurrency: 2 });
  assert.equal(rows.length, 6);
  assert.equal(rows.every((row) => row.reserve_source === "amm_info"), true);
  assert.equal(seen.length, 6);
});

test("loadLiveAmmReservesMany stops overlaying after the catalog deadline", async () => {
  const fetchImpl = async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      ok: true,
      json: async () => ({
        result: {
          amm: {
            account: "rSlow",
            amount: { currency: "XIO", issuer: XIO_ISSUER, value: "10" },
            amount2: { currency: "XRP", value: "1000000" },
            lp_token: { currency: "03SLOW", issuer: "rSlow", value: "1" },
          },
        },
      }),
    };
  };
  const queries = Array.from({ length: 8 }, (_, i) => ({
    pair: "XIO/XRP",
    quote: "XRP",
    ammAccount: `rSlow${i}`,
    fresh: true,
  }));
  const rows = await loadLiveAmmReservesMany(queries, {
    fetchImpl,
    now: Date.now(),
    concurrency: 1,
    deadlineMs: 50,
    retries: 0,
  });
  assert.equal(rows.length, 8);
  assert.ok(rows.some((row) => row.reserve_source === "empty"));
});
