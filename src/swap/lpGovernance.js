import {SWAP_LP_GOVERNANCE_PAIRS, SWAP_LP_GOVERNANCE_USD, XIO_RLUSD_AMM, XIO_RLUSD_LP_HEX, XIO_XRP_AMM, XIO_XRP_LP_HEX} from "../constants/ledger.js";
import {overlayLiveAmmReserves} from "../utils/ammInfo.js";
import {lpTokenUsd} from "../wallet/lpIncome.js";
import {isLpCurrency, knownLpIdentity, lpHeldForPair} from "../xaman/tradeTx.js";
import {isXioAsset, poolForSwapTicker} from "./platformFee.js";

export { SWAP_LP_GOVERNANCE_PAIRS, SWAP_LP_GOVERNANCE_USD };

function tickerOf(id) {
  return String(id || "")
    .split(":")[0]
    .toUpperCase();
}

function pairName(pair) {
  return String(pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function needsSwapLpGovernance(fromId, toId) {
  const from = tickerOf(fromId);
  const to = tickerOf(toId);
  if (!from || !to || from === to) return false;
  return !isXioAsset(from) && !isXioAsset(to);
}

export function governanceThreshold(pair, thresholds = SWAP_LP_GOVERNANCE_USD) {
  if (thresholds && typeof thresholds === "object" && !Array.isArray(thresholds)) {
    const named = Number(thresholds[pairName(pair)]);
    if (named > 0) return named;
  }
  const flat = Number(thresholds);
  return flat > 0 ? flat : SWAP_LP_GOVERNANCE_USD;
}

export function governanceSpecForPair(pair, pools = [], live = null) {
  const name = pairName(pair);
  const quote = name.split("/")[1] || "";
  const known = knownLpIdentity(name, quote);
  const catalog = poolForSwapTicker(pools, quote) || {};
  const hardcoded =
    name === "XIO/RLUSD"
      ? { amm: XIO_RLUSD_AMM, lpCurrency: XIO_RLUSD_LP_HEX }
      : name === "XIO/XRP"
        ? { amm: XIO_XRP_AMM, lpCurrency: XIO_XRP_LP_HEX }
        : { amm: known.amm, lpCurrency: known.lpCurrency };
  const amm = live?.amm_account || live?.amm || catalog.amm_account || catalog.amm || hardcoded.amm || "";
  const lpCurrency = String(
    live?.lp_currency || live?.lp_currency_hex || catalog.lp_currency || catalog.lp_currency_hex || hardcoded.lpCurrency || ""
  )
    .replace(/^0x/i, "")
    .toUpperCase();
  return { pair: name, amm, lpCurrency };
}

export function lpHeldFromLines(lines = [], spec = {}) {
  const wantHex = String(spec.lpCurrency || spec.lp_currency || "")
    .replace(/^0x/i, "")
    .toUpperCase();
  const wantAmm = String(spec.amm || spec.amm_account || spec.issuer || "").toUpperCase();
  if (!wantHex || !isLpCurrency(wantHex)) return 0;
  for (const row of Array.isArray(lines) ? lines : []) {
    const hex = String(row?.currency || row?.hex || "")
      .replace(/^0x/i, "")
      .toUpperCase();
    const issuer = String(row?.issuer || row?.account || "").toUpperCase();
    if (hex !== wantHex) continue;
    if (wantAmm && issuer && issuer !== wantAmm) continue;
    const n = Number(row?.balance ?? row?.value ?? row?.amount ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function lpHeldForGovernancePair({ pair, positions = [], lines = [], pools = [], live = null } = {}) {
  const spec = governanceSpecForPair(pair, pools, live);
  const quote = spec.pair.split("/")[1];
  const fromPositions = lpHeldForPair(positions, spec.pair, quote, spec);
  const fromLines = lpHeldFromLines(lines, spec);
  return Math.max(fromPositions, fromLines);
}

export function lpUsdForGovernancePair({
  pair,
  positions = [],
  lines = [],
  pools = [],
  live = null,
  prices = {},
} = {}) {
  const spec = governanceSpecForPair(pair, pools, live);
  const held = lpHeldForGovernancePair({ pair: spec.pair, positions, lines, pools, live });
  if (!(held > 0)) return { pair: spec.pair, lp: 0, usd: 0, threshold: governanceThreshold(spec.pair) };
  const catalog = poolForSwapTicker(pools, spec.pair.split("/")[1]) || {};
  const pool = overlayLiveAmmReserves(
    {
      ...catalog,
      pair: spec.pair,
      pool: catalog.pool || catalog.pool_name || spec.pair,
      quote: spec.pair.split("/")[1],
    },
    live
  );
  return {
    pair: spec.pair,
    lp: held,
    usd: lpTokenUsd(held, pool, prices),
    threshold: governanceThreshold(spec.pair),
  };
}

export function swapLpGovernance({
  positions = [],
  lines = [],
  pools = [],
  liveByPair = {},
  prices = {},
  threshold = SWAP_LP_GOVERNANCE_USD,
  pairs = SWAP_LP_GOVERNANCE_PAIRS,
} = {}) {
  const list = Array.isArray(pairs) ? pairs : SWAP_LP_GOVERNANCE_PAIRS;
  const rows = list.map((pair) => {
    const row = lpUsdForGovernancePair({
      pair,
      positions,
      lines,
      pools,
      live: liveByPair?.[pair],
      prices,
    });
    const floor = governanceThreshold(pair, threshold);
    return { ...row, threshold: floor, ok: Number(row.usd) + 1e-9 >= floor };
  });
  const heldUsd = rows.reduce((sum, row) => sum + (Number(row.usd) || 0), 0);
  const best = rows.reduce((max, row) => Math.max(max, Number(row.usd) || 0), 0);
  const unlocked = rows.filter((row) => row.ok).map((row) => row.pair);
  return {
    heldUsd,
    bestUsd: best,
    threshold: governanceThreshold(list[0], threshold),
    ok: unlocked.length > 0,
    unlocked,
    rows,
    pairs: list,
  };
}
