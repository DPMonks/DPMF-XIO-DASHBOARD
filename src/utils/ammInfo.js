import {XIO_HEX, XIO_ISSUER} from "../constants/ledger.js";
import {pairFromVoteAssets} from "../wallet/ammVote.js";

const XIO_PREFIX = "58494F";

export function isXioAmount(amount) {
  if (amount == null || typeof amount !== "object") return false;
  const currency = String(amount.currency || "").toUpperCase();
  const issuer = String(amount.issuer || "");
  return (
    currency === "XIO" ||
    currency === XIO_HEX ||
    currency.startsWith(XIO_PREFIX) ||
    issuer === XIO_ISSUER
  );
}

export function issuedAmountValue(amount) {
  if (amount == null) return null;
  if (typeof amount === "object") {
    const n = Number(amount.value);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n / 1_000_000;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function overlayLiveAmmReserves(row = {}, live = null) {
  if (!live || live.empty || live.reserve_source === "empty") return row;
  const liveXio = positive(live.reserve_xio ?? live.reserve_asset);
  const liveQuote = positive(live.reserve_currency ?? live.reserve_quote);
  const liveLp = positive(live.lp_supply);
  const liveHit = Boolean(liveXio || liveQuote || liveLp);
  if (!liveHit) return row;
  return {
    ...row,
    reserve_xio: liveXio || row.reserve_xio || null,
    reserve_asset: liveXio || row.reserve_asset || null,
    // Live amm_info is the pool ratio. Never keep a leftover catalog quote.
    reserve_currency: liveQuote || null,
    reserve_quote: liveQuote || null,
    lp_supply: liveLp || row.lp_supply || null,
    trading_fee: live.trading_fee ?? row.trading_fee,
    amm_account: live.amm_account || row.amm_account || row.amm || null,
    lp_currency: live.lp_currency || row.lp_currency || row.lp_currency_hex || null,
    quote_issuer: live.quote_issuer || live.issuer || row.quote_issuer || null,
    quote_hex: live.quote_hex || live.hex || row.quote_hex || null,
    reserve_source: live.reserve_source || "amm_info",
  };
}

export function matchingLiveReserves(live, pair) {
  if (!live || live.empty || live.reserve_source === "empty") return null;
  const livePair = String(live.pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const want = String(pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (livePair && want && livePair !== want) return null;
  if (
    !(
      positive(live.reserve_xio ?? live.reserve_asset) ||
      positive(live.reserve_currency ?? live.reserve_quote) ||
      positive(live.lp_supply)
    )
  ) {
    return null;
  }
  return live;
}

export function previewReserves(catalog = {}, live = null) {
  const pair = String(catalog.pair || live?.pair || "").replace(/\s+/g, "").toUpperCase();
  const row = overlayLiveAmmReserves(catalog, matchingLiveReserves(live, pair));
  const reserveXio = Number(row.reserve_xio ?? row.reserve_asset ?? 0) || 0;
  const reserveQuote = Number(row.reserve_currency ?? row.reserve_quote ?? 0) || 0;
  return {
    pair,
    base: reserveXio,
    quote: reserveQuote,
    lpSupply: Number(row.lp_supply ?? 0) || 0,
    tradingFee: Number(row.trading_fee ?? catalog.tradingFee ?? 0) || 0,
    issuer: row.quote_issuer || catalog.issuer || null,
    hex: row.quote_hex || catalog.hex || null,
    xioUsd: Number(row.xioUsd || catalog.xioUsd || 0) || 0,
    quoteUsd: Number(row.quote_usd || catalog.quoteUsd || 0) || 0,
    quoteName: row.quote || catalog.quoteName || pair.split("/")[1] || "XRP",
    reserve_xio: reserveXio,
    reserve_asset: reserveXio,
    reserve_currency: reserveQuote,
    amm_account: row.amm_account || null,
    lp_currency: row.lp_currency || null,
    reserve_source: row.reserve_source || catalog.reserve_source || null,
  };
}

export function lpShareAmounts(lpAmount, reserveBase, reserveQuote, lpSupply) {
  const lp = Number(lpAmount);
  const supply = Number(lpSupply);
  if (!(lp > 0) || !(supply > 0)) return { base: 0, quote: 0 };
  return {
    base: (lp / supply) * Number(reserveBase || 0),
    quote: (lp / supply) * Number(reserveQuote || 0),
  };
}

function ammAssetFromAmount(amount) {
  if (amount == null) return null;
  if (typeof amount !== "object") return { currency: "XRP" };
  return { currency: amount.currency, issuer: amount.issuer };
}

export function pairFromAmmInfo(result) {
  const amm = result?.amm || result;
  if (!amm) return "";
  return pairFromVoteAssets(ammAssetFromAmount(amm.amount), ammAssetFromAmount(amm.amount2));
}

export function poolReservesFromAmmInfo(result) {
  const amm = result?.amm || result;
  if (!amm || (amm.amount == null && amm.amount2 == null && !amm.lp_token)) return null;
  const first = amm.amount;
  const second = amm.amount2;
  const firstIsXio = isXioAmount(first);
  const secondIsXio = isXioAmount(second);
  const reserveXio = firstIsXio
    ? issuedAmountValue(first)
    : secondIsXio
      ? issuedAmountValue(second)
      : null;
  const reserveQuote = firstIsXio
    ? issuedAmountValue(second)
    : secondIsXio
      ? issuedAmountValue(first)
      : issuedAmountValue(second);
  const lpSupply = issuedAmountValue(amm.lp_token);
  const pair = pairFromAmmInfo(amm);
  const quoteAmt = firstIsXio ? second : secondIsXio ? first : second;
  const quoteCurrency = quoteAmt && typeof quoteAmt === "object" ? String(quoteAmt.currency || "") : "";
  return {
    amm_account: amm.account || null,
    lp_supply: lpSupply,
    reserve_xio: reserveXio,
    reserve_asset: reserveXio,
    reserve_currency: reserveQuote,
    reserve_quote: reserveQuote,
    lp_currency: amm.lp_token?.currency || null,
    trading_fee: amm.trading_fee ?? null,
    pair,
    quote: pair.includes("/") ? pair.split("/")[1] : "",
    quote_issuer: quoteAmt && typeof quoteAmt === "object" ? quoteAmt.issuer || null : null,
    quote_hex: /^[A-Fa-f0-9]{40}$/.test(quoteCurrency) ? quoteCurrency.toUpperCase() : null,
  };
}
