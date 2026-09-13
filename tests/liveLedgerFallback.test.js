import test from "node:test";
import assert from "node:assert/strict";
import {XIO_ISSUER, XIO_XRP_AMM, XIO_XRP_LP_HEX, XSQUAD_HEX, XSQUAD_ISSUER} from "../src/constants/ledger.js";
import {iouFromGatewayBalances, lpHoldingsFromLines, loadWalletBalancesFromLedger, loadWalletLpFromLedger, preferPositiveAmount, rlusdBalanceFromLines, xioBalanceFromLines, xrpDropsFromAccountInfo} from "../server/walletLedger.js";
import {lpHeldForPair} from "../src/xaman/tradeTx.js";
import {liveCatalogPayload} from "../server/liveCatalog.js";
import {RLUSD_HEX, RLUSD_ISSUER} from "../src/constants/ledger.js";

test("xrpDropsFromAccountInfo ignores missing or zero Balance", () => {
  assert.equal(xrpDropsFromAccountInfo({ account_data: { Balance: "25000000" } }), 25_000_000);
  assert.equal(xrpDropsFromAccountInfo({ result: { account_data: { Balance: "1000000" } } }), 1_000_000);
  assert.equal(xrpDropsFromAccountInfo({ account_data: {} }), null);
  assert.equal(xrpDropsFromAccountInfo({ account_data: { Balance: "0" } }), null);
  assert.equal(xrpDropsFromAccountInfo({}), null);
  assert.equal(xrpDropsFromAccountInfo(null), null);
});

test("XIO and LP holdings are read from account_lines", () => {
  assert.equal(
    xioBalanceFromLines([
      { account: XIO_ISSUER, currency: "XIO", balance: "12.5" },
      { account: XIO_ISSUER, currency: "5844580000000000000000000000000000000000", balance: "1.5" },
    ]),
    14
  );
  assert.equal(xioBalanceFromLines([{ account: "rOther", currency: "XIO", balance: "9" }]), null);
  assert.equal(
    rlusdBalanceFromLines([{ account: RLUSD_ISSUER, currency: RLUSD_HEX, balance: "7.25" }]),
    7.25
  );
  assert.equal(
    iouFromGatewayBalances(
      { balances: { [XIO_ISSUER]: [{ currency: "XIO", value: "42" }] } },
      XIO_ISSUER,
      /^(XIO|5844580000000000000000000000000000000000)$/i
    ),
    42
  );
  const lps = lpHoldingsFromLines([
    { account: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX, balance: "3.25" },
    { account: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX, balance: "0" },
  ]);
  assert.equal(lps.length, 1);
  assert.equal(lps[0].lp_balance, 3.25);
  assert.equal(lps[0].amm_account, XIO_XRP_AMM);
});

test("preferPositiveAmount keeps a catalog XIO total when the live read is zero", () => {
  assert.equal(preferPositiveAmount(0, 3004952684.62), 3004952684.62);
  assert.equal(preferPositiveAmount(null, 12.5), 12.5);
  assert.equal(preferPositiveAmount(88, 0), 88);
  assert.equal(preferPositiveAmount(null, null), null);
});

test("live wallet balances take XIO from gateway_balances when account_lines miss", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "account_info") {
      return {
        ok: true,
        json: async () => ({
          result: { status: "success", account_data: { Balance: "25000000", OwnerCount: 4 } },
        }),
      };
    }
    if (body.method === "gateway_balances") {
      return {
        ok: true,
        json: async () => ({
          result: { assets: { [XIO_ISSUER]: [{ currency: "XIO", value: "1500.25" }] } },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ result: { status: "success", lines: [] } }),
    };
  };
  const snap = await loadWalletBalancesFromLedger("rWallet111111111111111111111111111", {
    fetchImpl,
    fresh: true,
  });
  assert.equal(snap.xio, 1500.25);
  assert.equal(snap.xrp, 25);
});

test("live wallet balances retry account_info and do not store a failed XRP lookup as zero", async () => {
  let infoHits = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "account_info") {
      infoHits += 1;
      if (infoHits < 2) return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          result: { status: "success", account_data: { Balance: "18500000", OwnerCount: 3 } },
        }),
      };
    }
    return { ok: true, json: async () => ({ result: { status: "success", lines: [] } }) };
  };
  const snap = await loadWalletBalancesFromLedger("rWallet111111111111111111111111111", {
    fetchImpl,
    fresh: true,
  });
  assert.equal(infoHits, 2);
  assert.equal(snap.xrp, 18.5);
  assert.equal(snap.balance_drops, 18_500_000);
});

test("a missing account_info leaves XRP unknown instead of zero", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "account_info") {
      return { ok: true, json: async () => ({ result: { status: "error", error: "actNotFound" } }) };
    }
    return {
      ok: true,
      json: async () => ({
        result: {
          status: "success",
          lines: [{ account: XIO_ISSUER, currency: "XIO", balance: "88" }],
        },
      }),
    };
  };
  const snap = await loadWalletBalancesFromLedger("rWalletMissingXrp11111111111111111", {
    fetchImpl,
    fresh: true,
  });
  assert.equal(snap.xio, 88);
  assert.equal(snap.xrp, null);
  assert.equal(snap.balance_drops, null);
});

test("live wallet balances prefer the XRPL account and XIO line", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "account_info") {
      return {
        ok: true,
        json: async () => ({
          result: { status: "success", account_data: { Balance: "25000000", OwnerCount: 4 } },
        }),
      };
    }
    if (body.method === "gateway_balances") {
      return { ok: true, json: async () => ({ result: { balances: {} } }) };
    }
    return {
      ok: true,
      json: async () => ({
        result: {
          status: "success",
          lines: [
            { account: XIO_ISSUER, currency: "XIO", balance: "88" },
            { account: RLUSD_ISSUER, currency: RLUSD_HEX, balance: "3" },
          ],
        },
      }),
    };
  };
  const snap = await loadWalletBalancesFromLedger("rWallet111111111111111111111111111", {
    fetchImpl,
    fresh: true,
  });
  assert.equal(snap.source, "xrpl");
  assert.equal(snap.xrp, 25);
  assert.equal(snap.xio, 88);
  assert.equal(snap.rlusd, 3);
  assert.equal(snap.balance_drops, 25_000_000);
  assert.equal(snap.lines.length, 1);
  assert.equal(snap.lines[0].ticker, "RLUSD");
  assert.equal(snap.lines[0].issuer, RLUSD_ISSUER);
});

test("a down database still has a live token and price payload", async () => {
  const now = Date.now();
  const fetchImpl = async (url, options = {}) => {
    const target = String(url || "");
    if (target.includes("coingecko")) {
      return { ok: true, json: async () => ({ ripple: { usd: 2, gbp: 1.5, eur: 1.8, jpy: 300 } }) };
    }
    if (target.includes("xrpl.to/v1/ohlc")) {
      return {
        ok: true,
        json: async () => ({ ohlc: [[Date.now(), 0.00004, 0.00005, 0.00003, 0.000046, 12]] }),
      };
    }
    if (target.includes("xrpl.to/v1/holders/list")) {
      return {
        ok: true,
        json: async () => ({
          length: 67,
          richList: [{ account: "rLpOwner11111111111111111111111111", balance: 12.5, rank: 1 }],
        }),
      };
    }
    if (target.includes("xrpl.to/v1/holders/graph")) {
      return {
        ok: true,
        json: async () => ({
          history: [{ time: Date.now(), holders: 58, length: 67, active24H: 4 }],
        }),
      };
    }
    if (target.includes("xrpl.to")) {
      return {
        ok: true,
        json: async () => ({
          token: {
            holders: 15941,
            trustlines: 19973,
            lpHolderCount: 80,
            exch: 0.00003,
            pro24h: -3.6,
            vol24hxrp: 400,
            usd: 0.00006,
          },
        }),
      };
    }
    const body = JSON.parse(options.body || "{}");
    if (body.method === "amm_info") {
      return {
        ok: true,
        json: async () => ({
          result: {
            amm: {
              account: XIO_XRP_AMM,
              amount: { currency: "XIO", issuer: XIO_ISSUER, value: "1000000" },
              amount2: "2000000",
              lp_token: { currency: XIO_XRP_LP_HEX, issuer: XIO_XRP_AMM, value: "1000" },
              trading_fee: 1000,
            },
          },
        }),
      };
    }
    if (body.method === "gateway_balances") {
      return { ok: true, json: async () => ({ result: { obligations: { XIO: "9000000000" } } }) };
    }
    return { ok: true, json: async () => ({ result: { offers: [] } }) };
  };
  const empty = await liveCatalogPayload("prices/change24h", { fetchImpl, fresh: true, now });
  assert.equal(empty.source, "xrpl.to");
  assert.equal(empty.xio, -3.6);
  const prices = await liveCatalogPayload("prices", { fetchImpl, fresh: true, now });
  assert.ok(Number(prices.xioUsd) > 0);
  const counts = await liveCatalogPayload("holders/count", { fetchImpl, fresh: true, now });
  assert.equal(counts.count, 15941);
  const charts = await liveCatalogPayload("charts/activity", { fetchImpl, fresh: true, now });
  assert.ok(Array.isArray(charts));
  assert.equal(charts[0].holders, 58);
  const flows = await liveCatalogPayload("xio-flows", { fetchImpl, fresh: true, now });
  assert.deepEqual(flows, []);
  const spark = await liveCatalogPayload("sparkline/XIO", { fetchImpl, fresh: true, now });
  assert.equal(Array.isArray(spark), true);
  assert.equal(spark[0].price_usd, 0.000046);
  const lp = await liveCatalogPayload("top-lp", { fetchImpl, fresh: true, now, search: "?pool=all" });
  assert.equal(lp.catching_up, false);
  assert.ok(lp.holders.length > 0);
  assert.equal(lp.holders[0].lp_balance, 12.5);
  const tvl = await liveCatalogPayload("charts/tvl", { fetchImpl, fresh: true, now });
  assert.ok(Array.isArray(tvl));
  assert.ok(Number(tvl[0].tvl) > 0);
  const amm = await liveCatalogPayload("amm", { fetchImpl, fresh: true, now });
  assert.ok(Number(amm.volume24h) > 1_000_000);
  assert.equal(amm.volumeUnit, "xio");
  assert.ok(Number(amm.pools?.[0]?.volume24hXio) > 1_000_000);
  const lpChart = await liveCatalogPayload("charts/lp-holders", { fetchImpl, fresh: true, now });
  assert.ok(Array.isArray(lpChart));
  assert.equal(lpChart[0].lp_holder_count, 58);
});

test("wallet LP from ledger keeps XIO/XSQUAD tokens off the XIO/XRP pair", async () => {
  const xsquadAmm = "rXsquadAmm11111111111111111111111";
  const xsquadLp = "03AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const fetchImpl = async (url, options) => {
    if (options?.body) {
      const body = JSON.parse(options.body);
      if (body.method === "account_lines") {
        return {
          ok: true,
          json: async () => ({
            result: {
              status: "success",
              lines: [
                { account: xsquadAmm, currency: xsquadLp, balance: "88.5" },
                { account: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX, balance: "4" },
              ],
            },
          }),
        };
      }
      if (body.method === "amm_info") {
        const account = body.params?.[0]?.amm_account;
        if (account === xsquadAmm) {
          return {
            ok: true,
            json: async () => ({
              result: {
                amm: {
                  account: xsquadAmm,
                  amount: { currency: "XIO", issuer: XIO_ISSUER, value: "1000" },
                  amount2: { currency: XSQUAD_HEX, issuer: XSQUAD_ISSUER, value: "40" },
                  lp_token: { currency: xsquadLp, issuer: xsquadAmm, value: "200" },
                },
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            result: {
              amm: {
                account: XIO_XRP_AMM,
                amount: { currency: "XIO", issuer: XIO_ISSUER, value: "50000" },
                amount2: "2000000",
                lp_token: { currency: XIO_XRP_LP_HEX, issuer: XIO_XRP_AMM, value: "1000" },
              },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ result: { status: "success" } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const body = await loadWalletLpFromLedger("rWallet111111111111111111111111111", {
    fetchImpl,
    fresh: true,
  });
  const xsquad = body.positions.find((row) => row.pool === "XIO/XSQUAD");
  const xrp = body.positions.find((row) => row.pool === "XIO/XRP");
  assert.equal(xsquad?.lp_balance, 88.5);
  assert.equal(xrp?.lp_balance, 4);
  assert.equal(lpHeldForPair(body.positions, "XIO/XRP", "XRP"), 4);
  assert.equal(lpHeldForPair(body.positions, "XIO/XSQUAD", "XSQUAD"), 88.5);
});

test("wallet LP from ledger keeps the XIO/XRP line when live AMM lookup fails", async () => {
  const fetchImpl = async (_url, options) => {
    if (options?.body) {
      const body = JSON.parse(options.body);
      if (body.method === "account_lines") {
        return {
          ok: true,
          json: async () => ({
            result: {
              status: "success",
              lines: [{ account: XIO_XRP_AMM, currency: XIO_XRP_LP_HEX, balance: "9.5" }],
            },
          }),
        };
      }
      if (body.method === "amm_info") {
        return { ok: false, status: 500, json: async () => ({ error: "timeout" }) };
      }
      return { ok: true, json: async () => ({ result: { status: "success" } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const body = await loadWalletLpFromLedger("rWallet111111111111111111111111111", {
    fetchImpl,
    fresh: true,
  });
  assert.equal(body.positions[0]?.pool, "XIO/XRP");
  assert.equal(body.positions[0]?.lp_balance, 9.5);
});
