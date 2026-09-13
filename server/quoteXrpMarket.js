import {XDX_HEX, XDX_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER} from "../src/constants/ledger.js";
import {xrplRpc} from "./xrplBookOffers.js";

const CACHE_MS = 30_000;
const DROPS = 1_000_000;
let rateCache = { at: 0, rates: null };

export const QUOTE_XRP_SPECS = [
  { id: "XIO", currency: "XIO", hex: XDX_HEX, issuer: XDX_ISSUER },
  { id: "XSQUAD", currency: "XSQUAD", hex: XSQUAD_HEX, issuer: XSQUAD_ISSUER },
];

export function amountToNumber(amount) {
  if (amount == null) return 0;
  if (typeof amount === "object") {
    const n = Number(amount.value);
    return n > 0 ? n : 0;
  }
  const drops = Number(amount);
  return drops > 0 ? drops / DROPS : 0;
}

export function isXrpAmount(amount) {
  return amount != null && typeof amount !== "object";
}

export function matchesQuoteAmount(amount, spec) {
  if (!amount || typeof amount !== "object" || !spec) return false;
  const currency = String(amount.currency || "").toUpperCase();
  const issuer = String(amount.issuer || "");
  const codes = [spec.currency, spec.hex, spec.id]
    .filter(Boolean)
    .map((code) => String(code).toUpperCase());
  if (!codes.includes(currency)) return false;
  return !spec.issuer || issuer === spec.issuer;
}

export function xrpPerQuoteFromOffer(offer, spec) {
  const gets = offer?.TakerGets;
  const pays = offer?.TakerPays;
  if (matchesQuoteAmount(gets, spec) && isXrpAmount(pays)) {
    const quote = amountToNumber(gets);
    const xrp = amountToNumber(pays);
    return quote > 0 && xrp > 0 ? xrp / quote : 0;
  }
  if (isXrpAmount(gets) && matchesQuoteAmount(pays, spec)) {
    const quote = amountToNumber(pays);
    const xrp = amountToNumber(gets);
    return quote > 0 && xrp > 0 ? xrp / quote : 0;
  }
  return 0;
}

export function xrpPerQuoteFromAmm(amm, spec) {
  const first = amm?.amount ?? amm?.amm?.amount;
  const second = amm?.amount2 ?? amm?.amm?.amount2;
  if (matchesQuoteAmount(first, spec) && isXrpAmount(second)) {
    const quote = amountToNumber(first);
    const xrp = amountToNumber(second);
    return quote > 0 && xrp > 0 ? xrp / quote : 0;
  }
  if (matchesQuoteAmount(second, spec) && isXrpAmount(first)) {
    const quote = amountToNumber(second);
    const xrp = amountToNumber(first);
    return quote > 0 && xrp > 0 ? xrp / quote : 0;
  }
  return 0;
}

export function pickQuoteXrpRate({ amm = 0, bid = 0, ask = 0 } = {}) {
  if (amm > 0) return amm;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return bid || ask || 0;
}

function sideRate(offers, spec, preferLow) {
  let best = 0;
  for (const offer of Array.isArray(offers) ? offers : []) {
    const rate = xrpPerQuoteFromOffer(offer, spec);
    if (!(rate > 0)) continue;
    if (!best) best = rate;
    else if (preferLow ? rate < best : rate > best) best = rate;
  }
  return best;
}

async function loadOneQuoteXrpRate(spec, options) {
  const asset = spec.hex && spec.id !== "XIO" ? { currency: spec.hex, issuer: spec.issuer } : { currency: spec.currency, issuer: spec.issuer };
  const xrp = { currency: "XRP" };
  try {
    const [ammRes, asksRes, bidsRes] = await Promise.all([
      xrplRpc("amm_info", { asset, asset2: xrp, ledger_index: "validated" }, options),
      xrplRpc("book_offers", { taker_gets: asset, taker_pays: xrp, limit: 8 }, options),
      xrplRpc("book_offers", { taker_gets: xrp, taker_pays: asset, limit: 8 }, options),
    ]);
    return pickQuoteXrpRate({
      amm: xrpPerQuoteFromAmm(ammRes?.amm || ammRes, spec),
      ask: sideRate(asksRes?.offers, spec, true),
      bid: sideRate(bidsRes?.offers, spec, false),
    });
  } catch {
    return 0;
  }
}

export async function loadQuoteXrpRates(options = {}) {
  if (!options.skipCache && rateCache.rates && Date.now() - rateCache.at < CACHE_MS) {
    return rateCache.rates;
  }
  const rates = {};
  const rows = await Promise.all(
    QUOTE_XRP_SPECS.map(async (spec) => [spec.id, await loadOneQuoteXrpRate(spec, options)])
  );
  for (const [id, rate] of rows) {
    if (Number(rate) > 0) rates[id] = Number(rate);
  }
  rateCache = { at: Date.now(), rates };
  return rates;
}

export function attachQuoteXrpPrices(prices = {}, rates = {}, xrpUsd) {
  const xrp = Number(xrpUsd || prices.xrpUsd || prices.XRP || 0);
  const next = {
    ...prices,
    quotes: { ...(prices.quotes && typeof prices.quotes === "object" ? prices.quotes : {}) },
  };
  if (xrp > 0) {
    next.xrpUsd = xrp;
    next.quotes.XRP = xrp;
  }
  for (const [id, xrpEach] of Object.entries(rates || {})) {
    const n = Number(xrpEach);
    if (!(n > 0) || !(xrp > 0)) continue;
    const usd = n * xrp;
    if (!(usd > 0)) continue;
    next.quotes[id] = usd;
    next[id] = usd;
    next[`${id}Xrp`] = n;
    next[`${id.toLowerCase()}Xrp`] = n;
  }
  return next;
}
