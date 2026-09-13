import {pairFromRow, XIO_RLUSD_AMM, XIO_RLUSD_LP_HEX, XIO_TOTAL_SUPPLY, XIO_XDX_AMM, XIO_XDX_LP_HEX, XIO_XRP_AMM, XIO_XRP_LP_HEX} from "../constants/ledger.js";
import {fillMissingXioFiat} from "../utils/fiatFx.js";
import {catalogXioVolume24h, catalogXioVolume7d, dailyPricesFromOhlc, dailyXioFlowsFromOhlc, volumeDaysForHeldPairs} from "../utils/lpVolume.js";
import {looksLikeXrpPerXio, saneXrpUsd} from "../utils/recordedPrice.js";
import {mergeWalletActivity, mergeWalletOrders, pendingFor} from "./ledgerOrders.js";
import {isNativeXrpQuote, lineCounterparty, lineCurrencyCodes, sameIssuedCurrency} from "../utils/currency.js";
import {isXioAmmPair, lpFeeIncomeRows} from "./lpIncome.js";

const LP_CURRENCY_RE = /^03[A-F0-9]{38}$/i;

export const DROPS = 1_000_000;
export const DEFAULT_RESERVE_BASE_DROPS = 1_000_000;
export const DEFAULT_RESERVE_INC_DROPS = 200_000;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function dropsToXrp(drops) {
  const n = Number(drops);
  if (!Number.isFinite(n)) return null;
  return n / DROPS;
}

function dropsOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function xrpReserveBreakdown({
  balance,
  balanceDrops,
  ownerCount = 0,
  reserveBaseDrops = DEFAULT_RESERVE_BASE_DROPS,
  reserveIncDrops = DEFAULT_RESERVE_INC_DROPS,
} = {}) {
  const drops = dropsOrNull(balanceDrops);
  const fromAccount = drops != null && drops > 0 ? drops / DROPS : null;
  const fromBalances = num(balance);
  const total = fromAccount != null ? fromAccount : fromBalances > 0 ? fromBalances : null;
  if (total == null) {
    return {
      balance: null,
      spendable: null,
      reserved: null,
      required: null,
      baseReserve: null,
      ownerReserve: null,
      ownerCount: null,
    };
  }
  const base = (num(reserveBaseDrops) ?? DEFAULT_RESERVE_BASE_DROPS) / DROPS;
  const increment = (num(reserveIncDrops) ?? DEFAULT_RESERVE_INC_DROPS) / DROPS;
  const owners = Math.max(0, Number(ownerCount) || 0);
  const ownerReserve = owners * increment;
  const required = base + ownerReserve;
  const reserved = Math.min(total, required);
  return {
    balance: total,
    spendable: Math.max(0, total - reserved),
    reserved,
    required,
    baseReserve: base,
    ownerReserve,
    ownerCount: owners,
  };
}

export function xrpBarPercents({ reserved, spendable, total } = {}, filled = true) {
  if (!filled) return { reservePct: 0, spendPct: 0, totalPct: 0 };
  const hold = Math.max(0, Number(total) || 0);
  if (!(hold > 0)) return { reservePct: 0, spendPct: 0, totalPct: 0 };
  return {
    reservePct: (Math.max(0, Number(reserved) || 0) / hold) * 100,
    spendPct: (Math.max(0, Number(spendable) || 0) / hold) * 100,
    totalPct: 100,
  };
}

export function compareBarPercents(...values) {
  const nums = values.map((value) => Math.max(0, Number(value) || 0));
  const max = Math.max(...nums, 0);
  if (!(max > 0)) return nums.map(() => 0);
  return nums.map((value) => (value / max) * 100);
}

export function sortWalletPairs(names = []) {
  return [...new Set((names || []).map((name) => normalizeWalletPair(name)).filter(Boolean))].sort(
    (left, right) => {
      if (left === "XIO/XRP") return -1;
      if (right === "XIO/XRP") return 1;
      return left.localeCompare(right);
    }
  );
}

export function preferredWalletPair(names = [], current = "") {
  const list = sortWalletPairs(names);
  const wanted = normalizeWalletPair(current);
  if (wanted && wanted !== "XIO/XRP" && list.includes(wanted)) return wanted;
  if (list.includes("XIO/XRP")) return "XIO/XRP";
  return list[0] || "XIO/XRP";
}

export function normalizeWalletPair(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "/");
  if (!raw) return "";
  if (raw === "XRP" || raw === "XRP/XIO") return "XIO/XRP";
  if (raw.startsWith("XIO/")) return raw;
  return `XIO/${raw}`;
}

function cappedShare(part, total) {
  const bal = num(part);
  const den = num(total);
  if (bal == null || !(den > 0)) return null;
  return Math.min(100, (bal / den) * 100);
}

export function supplyShares(xio, circulating, totalSupply) {
  return {
    circulatingPct: cappedShare(xio, circulating),
    supplyPct: cappedShare(xio, totalSupply),
  };
}

function fiatViaXrp(unitUsd, xrpUsd, xrpFx) {
  if (unitUsd == null || !(num(xrpUsd) > 0) || !(num(xrpFx) > 0)) return null;
  return unitUsd * (Number(xrpFx) / Number(xrpUsd));
}

function fiatAmount(bal, unitPrice, unitUsd, xrpUsd, xrpFx) {
  if (Number(unitPrice) > 0) return bal * Number(unitPrice);
  const via = fiatViaXrp(unitUsd, xrpUsd, xrpFx);
  return via != null ? bal * via : null;
}

export function xioFiatValues(xio, prices = {}) {
  const bal = num(xio);
  const filled = fillMissingXioFiat(prices);
  const usd = num(filled.xioUsd ?? filled.recorded_price);
  const xrp = num(filled.xioXrp ?? filled.xioPerXrp);
  if (bal == null) {
    return { xio: null, usd: null, gbp: null, eur: null, jpy: null, xrp: null, rlusd: null };
  }
  const usdValue = usd != null && usd > 0 ? bal * usd : null;
  const rlusdUsd = num(filled.rlusdUsd ?? filled.RLUSD) || 1;
  const xrpUsd = num(filled.xrpUsd);
  const viaUsd = (rate) => (usdValue != null && Number(rate) > 0 ? usdValue * Number(rate) : null);
  const xrpWorth =
    xrp != null && xrp > 0
      ? bal * xrp
      : usdValue != null && xrpUsd != null && xrpUsd > 0
        ? usdValue / xrpUsd
        : null;
  return {
    xio: bal,
    usd: usdValue,
    gbp: fiatAmount(bal, filled.xioGbp, usd, filled.xrpUsd, filled.xrpGbp) ?? viaUsd(filled.usdGbp),
    eur: fiatAmount(bal, filled.xioEur, usd, filled.xrpUsd, filled.xrpEur) ?? viaUsd(filled.usdEur),
    jpy: fiatAmount(bal, filled.xioJpy, usd, filled.xrpUsd, filled.xrpJpy) ?? viaUsd(filled.usdJpy),
    xrp: xrpWorth,
    rlusd: usdValue != null ? usdValue / rlusdUsd : null,
  };
}

export function indexPoolsByPair(pools = []) {
  const map = new Map();
  const set = (key, pool) => {
    const name = String(key || "").trim();
    if (!name || map.has(name)) return;
    map.set(name, pool);
  };
  for (const pool of Array.isArray(pools) ? pools : []) {
    set(normalizeWalletPair(pool.pool_name || pool.pool || pool.pair), pool);
    set(normalizeWalletPair(pool.quote), pool);
    set(String(pool.lp_currency || pool.lp_currency_hex || "").toUpperCase(), pool);
    set(String(pool.amm_account || "").toLowerCase(), pool);
  }
  return map;
}

export function mergeLpPoolSource(row = {}, catalogPool = null) {
  if (!catalogPool) return row;
  const catalogSupply = num(catalogPool.lp_supply);
  return {
    ...row,
    ...catalogPool,
    quote: catalogPool.quote || row.quote,
    lp_supply: catalogSupply > 0 ? catalogSupply : num(row.lp_supply),
    reserve_asset:
      num(catalogPool.reserve_asset ?? catalogPool.reserve_xio) ||
      num(row.reserve_asset ?? row.reserve_xio),
    reserve_currency:
      num(catalogPool.reserve_currency ?? catalogPool.reserve_quote) ||
      num(row.reserve_currency ?? row.reserve_quote),
    lp_share_percent: catalogSupply > 0 ? undefined : row.lp_share_percent,
    withdraw_estimate_xio: catalogSupply > 0 ? undefined : row.withdraw_estimate_xio,
    withdraw_estimate_quote: catalogSupply > 0 ? undefined : row.withdraw_estimate_quote,
    xio_pct: num(catalogPool.xio_pct ?? catalogPool.composition_xio_percent) ?? num(row.xio_pct),
    quote_pct: num(catalogPool.quote_pct ?? catalogPool.composition_quote_percent) ?? num(row.quote_pct),
  };
}

export function lookupLpPool(row, poolsByPair) {
  const hex = String(row?.lp_currency || row?.lp_currency_hex || "").toUpperCase();
  if (hex && poolsByPair.get(hex)) return poolsByPair.get(hex);
  const name = normalizeWalletPair(row?.pool_name || row?.pool || row?.pair);
  if (name && poolsByPair.get(name)) return poolsByPair.get(name);
  const amm = String(row?.amm_account || "").toLowerCase();
  if (amm && poolsByPair.get(amm)) return poolsByPair.get(amm);
  return null;
}

export function resolveLpPairName(pool = {}, pairHint = "") {
  const hex = String(pool.lp_currency || pool.lp_currency_hex || "")
    .replace(/^0x/i, "")
    .toUpperCase();
  const amm = String(pool.amm_account || pool.amm || "").trim();
  if (hex === XIO_RLUSD_LP_HEX || amm === XIO_RLUSD_AMM) return "XIO/RLUSD";
  if (hex === XIO_XRP_LP_HEX || amm === XIO_XRP_AMM) return "XIO/XRP";
  if (hex === XIO_XDX_LP_HEX || amm === XIO_XDX_AMM) return "XIO/XDX";

  const quote = String(pool.quote || "").trim().toUpperCase().replace(/^XIO\//, "");
  if (quote && quote !== "XRP") return normalizeWalletPair(`XIO/${quote}`);

  const named = normalizeWalletPair(pairHint || pool.pool_name || pool.pool || pool.pair);
  if (named && named !== "XIO/XRP") return named;

  const unknownLp = /^03[A-F0-9]{38}$/.test(hex) || (amm && amm !== XIO_XRP_AMM);
  if (unknownLp) {
    const decoded = pairFromRow({
      amm_account: amm,
      lp_currency: hex,
      quote: pool.quote,
      quote_issuer: pool.quote_issuer,
      quote_hex: pool.quote_hex,
    });
    if (decoded && decoded !== "XIO/XRP") return decoded;
    return "";
  }
  return named || "XIO/XRP";
}

export function lpHoldingsFromLines(rows = []) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const currency = String(row?.currency || row?.lp_currency || "").toUpperCase();
    if (!LP_CURRENCY_RE.test(currency)) continue;
    const tokens = num(row?.balance ?? row?.lp_balance);
    if (!(tokens > 0)) continue;
    out.push({
      lp_currency: currency,
      amm_account: String(row?.account || row?.issuer || row?.amm_account || "").trim(),
      lp_balance: tokens,
    });
  }
  return out;
}

export function positionsFromLines(lines = [], pools = []) {
  const holdings = lpHoldingsFromLines(lines);
  if (!holdings.length) return [];
  const byAccount = new Map();
  const byHex = new Map();
  for (const pool of Array.isArray(pools) ? pools : []) {
    const amm = String(pool?.amm_account || pool?.amm || "").toLowerCase();
    const hex = String(pool?.lp_currency || pool?.lp_currency_hex || "").toUpperCase();
    if (amm) byAccount.set(amm, pool);
    if (hex) byHex.set(hex, pool);
  }
  const out = [];
  for (const holding of holdings) {
    const catalog =
      byAccount.get(String(holding.amm_account || "").toLowerCase()) ||
      byHex.get(holding.lp_currency) ||
      null;
    const pair =
      resolveLpPairName(
        {
          ...(catalog || {}),
          amm_account: holding.amm_account,
          lp_currency: holding.lp_currency,
        },
        catalog?.pool || catalog?.pool_name || catalog?.pair
      ) || "";
    if (!pair) continue;
    const position = lpPositionFromPool(
      holding.lp_balance,
      mergeLpPoolSource(
        { ...holding, pool: pair, pool_name: pair, pair },
        catalog
      ),
      pair
    );
    if (position) out.push(position);
  }
  return out;
}

export function withdrawQuoteLabel(asset, template = "Withdraw {asset} quote") {
  const name = String(asset || "").trim();
  const text = String(template || "Withdraw {asset} quote");
  if (!name) return text.replace(/\s*\{asset\}\s*/g, " ").replace(/\s+/g, " ").trim();
  return text.replace("{asset}", name);
}

export function lpPositionFromPool(lpBalance, pool = {}, pairHint = "") {
  const tokens = num(lpBalance);
  if (tokens == null || tokens <= 0) return null;
  const pair = resolveLpPairName(pool, pairHint) || "XIO/UNKNOWN";
  const supply = num(pool.lp_supply);
  const knownShare = num(pool.lp_share_percent);
  const share = supply > 0 ? tokens / supply : knownShare != null ? knownShare / 100 : 0;
  const reserveXio = num(pool.reserve_asset ?? pool.reserve_xio) || 0;
  const reserveQuote = num(pool.reserve_currency ?? pool.reserve_quote) || 0;
  const withdrawXio =
    share > 0 && reserveXio > 0 ? share * reserveXio : num(pool.withdraw_estimate_xio);
  const withdrawQuote =
    share > 0 && reserveQuote > 0 ? share * reserveQuote : num(pool.withdraw_estimate_quote);
  return {
    pool: pair,
    pool_name: pair,
    quote: pool.quote || pair.split("/")[1] || "XRP",
    lp_balance: tokens,
    lp_supply: supply,
    amm_account: pool.amm_account || null,
    lp_currency: pool.lp_currency || pool.lp_currency_hex || null,
    lp_share_percent: share * 100,
    withdraw_estimate_xio: withdrawXio ?? share * reserveXio,
    withdraw_estimate_quote: withdrawQuote ?? share * reserveQuote,
    fees_earned: num(pool.fees_earned),
    trading_fee: num(pool.trading_fee),
    volume24h: num(pool.volume24h ?? pool.volume_24h ?? pool.volume24hXio),
    volume24hXio: num(pool.volume24hXio ?? pool.volume_24h_xio),
    volume24hXrp: num(pool.volume24hXrp ?? pool.volume_24h_xrp),
    volume24hUsd: num(pool.volume24hUsd ?? pool.volume_24h_usd),
    volume7d: num(pool.volume7d ?? pool.volume7dXio),
    volume7dXio: num(pool.volume7dXio ?? pool.volume7d),
    volumeUnit: pool.volumeUnit || null,
    xioUsd: num(pool.xioUsd),
    xrpUsd: num(pool.xrpUsd),
    xioPerXrp: num(pool.xioPerXrp ?? pool.xio_per_xrp ?? pool.exchXrp),
    composition_xio_percent: num(pool.xio_pct ?? pool.composition_xio_percent),
    composition_quote_percent: num(pool.quote_pct ?? pool.composition_quote_percent),
    xio_pct: num(pool.xio_pct ?? pool.composition_xio_percent),
    quote_pct: num(pool.quote_pct ?? pool.composition_quote_percent),
    reserve_asset: reserveXio,
    reserve_currency: reserveQuote,
  };
}

export function walletOrdersFromBooks(books, address) {
  const name = String(address || "").trim();
  if (!name) return [];
  const out = [];
  for (const book of Object.values(books?.books || {})) {
    for (const side of ["bids", "asks"]) {
      for (const row of book[side] || []) {
        if (String(row.account || "").toLowerCase() !== name.toLowerCase()) continue;
        out.push({
          pair: book.pair,
          side: side === "asks" ? "ask" : "bid",
          price: Number(row.price),
          amount: Number(row.base_size),
        });
      }
    }
  }
  return out;
}

export function walletActivity(rows, address) {
  const name = String(address || "").trim().toLowerCase();
  if (!name) return [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row.account || "").toLowerCase() === name)
    .slice(0, 3);
}

export function tradingFeeRate(tradingFee) {
  const raw = Number(tradingFee);
  if (!(raw > 0)) return 1000 / 100_000;
  return raw > 20 ? raw / 100_000 : raw / 100;
}

export function ammFeePercent(tradingFee) {
  const raw = Number(tradingFee);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return tradingFeeRate(raw) * 100;
}

export function formatAmmFee(tradingFee, locale) {
  const pct = ammFeePercent(tradingFee);
  if (!(pct > 0)) return "0%";
  const digits = pct < 0.01 ? 6 : pct < 1 ? 4 : 2;
  return `${pct.toLocaleString(locale || "en", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })}%`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function volumeByPool(flows = [], windowMs = DAY_MS, now = Date.now()) {
  const cutoff = now - Number(windowMs || DAY_MS);
  const map = new Map();
  for (const row of Array.isArray(flows) ? flows : []) {
    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const pair = normalizeWalletPair(row.pool || row.pool_name || row.pair);
    if (!isXioAmmPair(pair)) continue;
    map.set(pair, (map.get(pair) || 0) + Math.abs(Number(row.xio) || 0));
  }
  return map;
}

export function volume24hByPool(flows = [], now = Date.now()) {
  return volumeByPool(flows, DAY_MS, now);
}

function poolQuoteId(row) {
  return String(row?.quote || normalizeWalletPair(row?.pool || row?.pool_name || "").split("/")[1] || "")
    .trim()
    .toUpperCase();
}

function quoteIsXrp(row) {
  return poolQuoteId(row) === "XRP";
}

function quoteIsRlusd(row) {
  return poolQuoteId(row) === "RLUSD";
}

function quotePerXio(row, fallback) {
  const reserveXio = num(row?.reserve_asset ?? row?.reserve_xio);
  const reserveQuote = num(row?.reserve_currency ?? row?.reserve_quote);
  if (reserveXio > 0 && reserveQuote > 0) {
    const ratio = reserveQuote / reserveXio;
    if ((quoteIsXrp(row) || quoteIsRlusd(row)) && ratio > 1) return reserveXio / reserveQuote;
    return ratio;
  }
  const fb = num(fallback);
  if (fb != null && (quoteIsXrp(row) || quoteIsRlusd(row)) && !looksLikeXrpPerXio(fb) && fb > 1) {
    return 1 / fb;
  }
  return fb;
}

function volumeForWindow(row, flowVol, windowMs) {
  const pair = normalizeWalletPair(row.pool || row.pool_name);
  const fromFlows = flowVol.get(pair) || 0;
  const catalog24h = catalogXioVolume24h(row);
  const catalog7d = catalogXioVolume7d(row);
  if (windowMs <= DAY_MS) {
    if (catalog24h > 0) return Math.max(catalog24h, fromFlows);
    return fromFlows;
  }
  if (catalog7d > 0) return Math.max(catalog7d, fromFlows);
  if (fromFlows > 0) return fromFlows;
  if (catalog24h > 0) return catalog24h * (windowMs / DAY_MS);
  return fromFlows;
}

export const FEATURED_EARN_PAIRS = ["XIO/XRP", "XIO/RLUSD"];

function emptyEarnings() {
  return { xio: 0, xrp: 0, rlusd: 0, usd: null };
}

function emptyPoolEarn(pair) {
  const quote = String(pair || "").split("/")[1] || "";
  return {
    pair,
    quote,
    xio24h: 0,
    quote24h: 0,
    usd24h: 0,
    xio7d: 0,
    quote7d: 0,
    usd7d: 0,
  };
}

function splitPoolFee(row, feeXio, xioXrp) {
  if (!(feeXio > 0)) return { xio: 0, quote: 0, quoteId: poolQuoteId(row) };
  if (quoteIsXrp(row)) {
    const px = quotePerXio(row, xioXrp);
    return { xio: feeXio / 2, quote: px > 0 ? (feeXio / 2) * px : 0, quoteId: "XRP" };
  }
  if (quoteIsRlusd(row)) {
    const px = quotePerXio(row, null);
    return { xio: feeXio / 2, quote: px > 0 ? (feeXio / 2) * px : 0, quoteId: "RLUSD" };
  }
  return { xio: feeXio, quote: 0, quoteId: poolQuoteId(row) };
}

function usdForSplit(split, { xioUsd, xrpUsd, rlusdUsd }) {
  const xioPart = num(xioUsd) != null ? split.xio * Number(xioUsd) : 0;
  let quotePart = 0;
  if (split.quoteId === "XRP" && num(xrpUsd) != null) quotePart = split.quote * Number(xrpUsd);
  else if (split.quoteId === "RLUSD") quotePart = split.quote * (num(rlusdUsd) || 1);
  return xioPart + quotePart;
}

export function lpPoolEarnings(
  positions = [],
  { flows = [], xioUsd = null, xrpUsd = null, rlusdUsd = 1, xioXrp = null, now = Date.now() } = {}
) {
  const vol24h = volumeByPool(flows, DAY_MS, now);
  const vol7d = volumeByPool(flows, DAY_MS * 7, now);
  const prices = { xioUsd, xrpUsd, rlusdUsd, xioXrp };
  const byPair = new Map(
    (Array.isArray(positions) ? positions : [])
      .filter((row) => isXioAmmPair(row))
      .map((row) => [normalizeWalletPair(row.pool || row.pool_name), row])
  );
  const pools = {};
  for (const pair of FEATURED_EARN_PAIRS) {
    const row = byPair.get(pair);
    if (!row || !((num(row.lp_share_percent) || 0) > 0)) {
      pools[pair] = emptyPoolEarn(pair);
      continue;
    }
    const share = Number(row.lp_share_percent) / 100;
    const rate = tradingFeeRate(row.trading_fee);
    const day = splitPoolFee(row, volumeForWindow(row, vol24h, DAY_MS) * rate * share, xioXrp);
    const week = splitPoolFee(row, volumeForWindow(row, vol7d, DAY_MS * 7) * rate * share, xioXrp);
    pools[pair] = {
      pair,
      quote: day.quoteId || pair.split("/")[1],
      xio24h: day.xio,
      quote24h: day.quote,
      usd24h: usdForSplit(day, prices),
      xio7d: week.xio,
      quote7d: week.quote,
      usd7d: usdForSplit(week, prices),
    };
  }
  return pools;
}

function earningsForWindow(positions, flowVol, windowMs, { xioUsd, xrpUsd, rlusdUsd, xioXrp }) {
  const next = emptyEarnings();
  for (const row of Array.isArray(positions) ? positions : []) {
    if (!isXioAmmPair(row)) continue;
    const share = (num(row.lp_share_percent) || 0) / 100;
    if (!(share > 0)) continue;
    const feeXio = volumeForWindow(row, flowVol, windowMs) * tradingFeeRate(row.trading_fee) * share;
    if (!(feeXio > 0)) continue;
    if (quoteIsXrp(row)) {
      const px = quotePerXio(row, xioXrp);
      next.xio += feeXio / 2;
      if (px > 0) next.xrp += (feeXio / 2) * px;
    } else if (quoteIsRlusd(row)) {
      const px = quotePerXio(row, null);
      next.xio += feeXio / 2;
      if (px > 0) next.rlusd += (feeXio / 2) * px;
    } else {
      next.xio += feeXio;
    }
  }
  const xioPart = num(xioUsd) != null ? next.xio * Number(xioUsd) : null;
  const xrpPart = num(xrpUsd) != null ? next.xrp * Number(xrpUsd) : null;
  const rlusdPart = num(rlusdUsd) != null ? next.rlusd * Number(rlusdUsd) : next.rlusd > 0 ? next.rlusd : null;
  if (xioPart != null || xrpPart != null || rlusdPart != null) {
    next.usd = (xioPart || 0) + (xrpPart || 0) + (rlusdPart || 0);
  }
  return next;
}

export function lpFeeEarnings(
  positions = [],
  { flows = [], xioUsd = null, xrpUsd = null, rlusdUsd = 1, xioXrp = null, now = Date.now() } = {}
) {
  const vol24h = volumeByPool(flows, DAY_MS, now);
  const vol7d = volumeByPool(flows, DAY_MS * 7, now);
  let xio = 0;
  let stake = 0;
  for (const row of Array.isArray(positions) ? positions : []) {
    if (!isXioAmmPair(row)) continue;
    const share = (num(row.lp_share_percent) || 0) / 100;
    if (!(share > 0)) continue;
    xio += volumeForWindow(row, vol24h, DAY_MS) * tradingFeeRate(row.trading_fee) * share;
    stake += num(row.withdraw_estimate_xio) || 0;
  }
  const prices = {
    xioUsd,
    xrpUsd: saneXrpUsd(xrpUsd, xioUsd, xioXrp),
    rlusdUsd: num(rlusdUsd) ?? 1,
    xioXrp,
  };
  const day = earningsForWindow(positions, vol24h, DAY_MS, prices);
  const week = earningsForWindow(positions, vol7d, DAY_MS * 7, prices);
  const usd = num(xioUsd) != null ? xio * Number(xioUsd) : null;
  return {
    xio,
    usd,
    pct24h: stake > 0 ? Math.min(100, (xio / stake) * 100) : xio > 0 ? null : 0,
    earnings: {
      xio24h: day.xio,
      xio24hUsd: day.xio * (Number(prices.xioUsd) || 0),
      xrp24h: day.xrp,
      xrp24hUsd: day.xrp * (Number(prices.xrpUsd) || 0),
      rlusd24h: day.rlusd,
      rlusd24hUsd: day.rlusd * (Number(prices.rlusdUsd) || 1),
      usd24h: day.usd,
      xio7d: week.xio,
      xio7dUsd: week.xio * (Number(prices.xioUsd) || 0),
      xrp7d: week.xrp,
      xrp7dUsd: week.xrp * (Number(prices.xrpUsd) || 0),
      rlusd7d: week.rlusd,
      rlusd7dUsd: week.rlusd * (Number(prices.rlusdUsd) || 1),
      usd7d: week.usd,
      pools: lpPoolEarnings(positions, { flows, xioUsd, xrpUsd, rlusdUsd, xioXrp, now }),
    },
  };
}

export function walletAvailableAmounts({ balances = {}, account = {}, lines = [], quote } = {}) {
  const xrp = xrpReserveBreakdown({
    balance: balances.xrp ?? balances.raw?.xrp,
    balanceDrops: account.balance_drops ?? account.Balance ?? balances.raw?.balance_drops,
    ownerCount: account.owner_count ?? account.OwnerCount,
    reserveBaseDrops: account.reserve_base_drops,
    reserveIncDrops: account.reserve_inc_drops,
  });
  const xio = num(balances.xio);
  const quoteIsXrp = isNativeXrpQuote(quote);
  const lineRows = Array.isArray(lines) && lines.length ? lines : balances.raw?.lines || [];
  const names = [quote?.currency, quote?.hex, quote?.id, quote?.label].filter(Boolean);
  const quoteAmt = quoteIsXrp
    ? xrp.spendable ?? xrp.balance
    : num(
        lineRows.find((row) => {
          const issuer = lineCounterparty(row);
          const wantIss = String(quote?.issuer || "").toUpperCase();
          if (wantIss && issuer && issuer !== wantIss) return false;
          return names.some((name) => lineCurrencyCodes(row).some((code) => sameIssuedCurrency(code, name)));
        })?.balance
      );
  return {
    xrp: xrp.spendable ?? xrp.balance,
    xio,
    quote: quoteAmt,
  };
}

function keepAmount(next, current) {
  if (next != null && Number(next) > 0) return Number(next);
  if (current != null && Number(current) > 0) return Number(current);
  return next != null && Number.isFinite(Number(next)) ? Number(next) : current ?? next;
}

function feeEarningsFilled(fees) {
  const earn = fees?.earnings || {};
  return [earn.usd24h, earn.usd7d, earn.xio24h, earn.xrp24h, earn.rlusd24h].some((value) => Number(value) > 0);
}

function mergeKeptLp(current = [], next = []) {
  if (!Array.isArray(next) || !next.length) return current || [];
  const map = new Map();
  for (const row of Array.isArray(current) ? current : []) {
    const name = normalizeWalletPair(row.pool || row.pool_name);
    if (isXioAmmPair(name)) map.set(name, row);
  }
  for (const row of next) {
    const name = normalizeWalletPair(row.pool || row.pool_name);
    if (isXioAmmPair(name)) map.set(name, row);
  }
  return [...map.values()];
}

export function preferFilledWalletSnapshot(current, next) {
  if (!next) return current || emptyWalletSnapshot(null);
  if (!current?.filled || !current.address || current.address !== next.address) return next;
  if (!next.filled) return current;

  const holdings = {
    xio: keepAmount(next.holdings?.xio, current.holdings?.xio),
    xrp: keepAmount(next.holdings?.xrp, current.holdings?.xrp),
    rlusd: keepAmount(next.holdings?.rlusd, current.holdings?.rlusd),
  };
  const keptXio = !(Number(next.holdings?.xio) > 0) && Number(current.holdings?.xio) > 0;
  const nextXio = next.xio && typeof next.xio === "object" ? next.xio : {};
  const xio = keptXio ? { ...(current.xio || {}) } : { ...(current.xio || {}) };
  if (!keptXio) {
    for (const [key, value] of Object.entries(nextXio)) {
      if (value != null) xio[key] = value;
    }
  }
  const nextHasEarn = feeEarningsFilled(next.fees);
  const currentHasEarn = feeEarningsFilled(current.fees);
  const nextShare = Number(next.supply?.supplyPct) || Number(next.supply?.circulatingPct);
  const keepSupply = nextShare > 0 || !(Number(current.supply?.supplyPct) > 0 || Number(current.supply?.circulatingPct) > 0);

  return {
    ...next,
    filled: true,
    holdings,
    xio,
    xrp: next.xrp?.balance > 0 ? next.xrp : current.xrp?.balance > 0 ? current.xrp : next.xrp,
    supply: keepSupply ? next.supply : current.supply,
    fees: nextHasEarn || !currentHasEarn ? next.fees : current.fees,
    lp: mergeKeptLp(current.lp, next.lp),
    income: Array.isArray(next.income) && next.income.length ? next.income : current.income,
    rank: next.rank != null ? next.rank : current.rank,
  };
}

export function emptyWalletSnapshot(address = null) {
  return {
    address,
    signedIn: Boolean(address),
    filled: false,
    xrp: xrpReserveBreakdown({}),
    xio: xioFiatValues(null),
    holdings: { xio: null, xrp: null, rlusd: null },
    supply: { circulatingPct: null, supplyPct: null, circulating: null, totalSupply: null },
    fees: {
      xio: null,
      usd: null,
      pct24h: null,
      earnings: {
        xio24h: null,
        xio24hUsd: null,
        xrp24h: null,
        xrp24hUsd: null,
        rlusd24h: null,
        rlusd24hUsd: null,
        usd24h: null,
        xio7d: null,
        xio7dUsd: null,
        xrp7d: null,
        xrp7dUsd: null,
        rlusd7d: null,
        rlusd7dUsd: null,
        usd7d: null,
        pools: {
          "XIO/XRP": emptyPoolEarn("XIO/XRP"),
          "XIO/RLUSD": emptyPoolEarn("XIO/RLUSD"),
        },
      },
    },
    lp: [],
    income: [],
    pools: [],
    priceBook: {},
    rank: null,
    book: null,
    orders: [],
    activity: [],
  };
}

export function composeWalletSnapshot({
  address,
  balances = {},
  account = {},
  networth = {},
  prices = {},
  token = {},
  pools = [],
  lpRows = [],
  rank = null,
  books = null,
  flows = [],
  offers = [],
  ledgerActivity = [],
  lines = [],
  ohlcRows = [],
} = {}) {
  if (!address) return emptyWalletSnapshot(null);

  const xrp = xrpReserveBreakdown({
    balance: balances.xrp ?? balances.raw?.xrp,
    balanceDrops: account.balance_drops ?? account.Balance ?? balances.raw?.balance_drops,
    ownerCount: account.owner_count ?? account.OwnerCount,
    reserveBaseDrops: account.reserve_base_drops,
    reserveIncDrops: account.reserve_inc_drops,
  });
  const xioBal = num(balances.xio);
  const xioPerXrp = num(token.xioPerXrp ?? prices.xioPerXrp);
  const fiat = xioFiatValues(xioBal, {
    xioUsd: prices.xioUsd ?? prices.recorded_price ?? token.xioUsd,
    xioGbp: prices.xioGbp,
    xioEur: prices.xioEur,
    xioJpy: prices.xioJpy,
    xrpUsd: prices.xrpUsd,
    xrpGbp: prices.xrpGbp,
    xrpEur: prices.xrpEur,
    xrpJpy: prices.xrpJpy,
    usdGbp: prices.usdGbp,
    usdEur: prices.usdEur,
    usdJpy: prices.usdJpy,
    xioXrp: xioPerXrp,
    rlusdUsd: prices.RLUSD ?? prices.quotes?.RLUSD ?? 1,
  });
  if (fiat.usd == null && num(networth.totalUsd)) fiat.usd = Number(networth.totalUsd);
  if (fiat.gbp == null && num(networth.totalGbp)) fiat.gbp = Number(networth.totalGbp);
  if (fiat.eur == null && num(networth.totalEur)) fiat.eur = Number(networth.totalEur);
  if (fiat.jpy == null && num(networth.totalJpy)) fiat.jpy = Number(networth.totalJpy);

  const circulating = num(token.circulating);
  const totalSupply = num(token.totalSupply ?? token.total_supply) || XIO_TOTAL_SUPPLY;
  const shares = supplyShares(xioBal, circulating, totalSupply);

  const poolByName = indexPoolsByPair(pools);
  const lpByPair = new Map();
  for (const row of Array.isArray(lpRows) ? lpRows : []) {
    const name = normalizeWalletPair(row.pool_name || row.pool || row.pair);
    const position = lpPositionFromPool(
      row.lp_balance ?? row.lp,
      mergeLpPoolSource(row, lookupLpPool(row, poolByName)),
      name
    );
    if (!position) continue;
    const previous = lpByPair.get(position.pool);
    if (!previous || position.lp_balance > previous.lp_balance) {
      lpByPair.set(position.pool, position);
    }
  }
  const lineRows = Array.isArray(lines) && lines.length
    ? lines
    : Array.isArray(balances.lines) && balances.lines.length
      ? balances.lines
      : Array.isArray(balances.raw?.lines)
        ? balances.raw.lines
        : [];
  for (const position of positionsFromLines(lineRows, pools)) {
    const previous = lpByPair.get(position.pool);
    if (!previous || position.lp_balance > previous.lp_balance) {
      lpByPair.set(position.pool, position);
    }
  }
  const lp = [...lpByPair.values()];

  const xrpBook = books?.books?.["XIO/XRP"] || null;
  const pending = pendingFor(address, { offersKnown: true });
  const orders = mergeWalletOrders(offers, walletOrdersFromBooks(books, address), pending.orders);
  const activity = mergeWalletActivity(
    ledgerActivity,
    walletActivity(flows, address),
    pending.activity
  ).slice(0, 3);
  const xioUsd = num(prices.xioUsd ?? prices.recorded_price ?? token.xioUsd);
  const xrpUsd = saneXrpUsd(prices.xrpUsd, xioUsd, xioPerXrp);
  const rlusdUsd = num(prices.RLUSD ?? prices.quotes?.RLUSD) ?? 1;
  const dailyPrices = dailyPricesFromOhlc(ohlcRows, { xrpUsd });
  const xioVolumeDays = dailyXioFlowsFromOhlc(ohlcRows, { xrpPerXio: xioPerXrp });
  const priceBook = {
    ...prices,
    xioUsd,
    xrpUsd,
    RLUSD: rlusdUsd,
    dailyPrices,
    xioVolumeDays,
  };
  const ledgerRows = mergeWalletActivity(ledgerActivity, pending.activity);
  const income = lpFeeIncomeRows({
    positions: lp,
    flows,
    volumeDays: volumeDaysForHeldPairs(xioVolumeDays, lp),
    activity: ledgerRows,
    xioUsd,
    xrpUsd,
    rlusdUsd,
    prices: priceBook,
    dailyPrices,
  });
  return {
    address,
    signedIn: true,
    filled: xioBal != null || xrp.balance != null || lp.length > 0 || orders.length > 0 || activity.length > 0,
    xrp,
    xio: fiat,
    holdings: {
      xio: xioBal,
      xrp: xrp.balance,
      rlusd: num(balances.rlusd),
    },
    supply: {
      ...shares,
      circulating,
      totalSupply,
    },
    fees: lpFeeEarnings(lp, {
      flows,
      xioUsd,
      xrpUsd,
      rlusdUsd,
      xioXrp: xioPerXrp,
    }),
    lp,
    income,
    pools,
    priceBook,
    rank: num(rank ?? token.rank ?? balances.rank),
    book: xrpBook
      ? {
          bestBid: xrpBook.best_bid,
          bestAsk: xrpBook.best_ask,
          mid: xrpBook.mid,
          spreadBps: xrpBook.spread_bps,
          ammDepth: Number(xrpBook.asks?.[0]?.amm_opposing || xrpBook.bids?.[0]?.amm_opposing || 0),
        }
      : null,
    orders,
    activity,
  };
}
