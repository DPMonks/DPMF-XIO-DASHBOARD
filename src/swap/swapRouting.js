import {IMPACT_HIGH_PCT, quoteUsesPool} from "./quoteSwap.js";
import {normalizeSwapMode, swapModeById} from "./swapModes.js";

export const TF_NO_DIRECT_RIPPLE = 65536;
export const TF_PARTIAL_PAYMENT = 131072;
export const TF_LIMIT_QUALITY = 262144;

export function paymentFlagsForMode(routingMode) {
  const id = normalizeSwapMode(routingMode);
  let flags = TF_PARTIAL_PAYMENT;
  if (id === "no-direct-ripple") flags |= TF_NO_DIRECT_RIPPLE;
  if (id === "limit-quality") flags |= TF_LIMIT_QUALITY;
  return flags;
}

export function sameIssuerRipple(fromAsset, toAsset) {
  const from = String(fromAsset?.issuer || "").toUpperCase();
  const to = String(toAsset?.issuer || "").toUpperCase();
  return Boolean(from && to && from === to);
}

export function quotePassesMode(quote, routingMode) {
  const id = normalizeSwapMode(routingMode);
  if (!quote || !(quote.actualOutput > 0) || quote.routeUsed === "none") {
    return id === "partial-payment" && Number(quote?.actualOutput) > 0;
  }
  if (id === "limit-quality" && Math.abs(Number(quote.priceImpactPercent) || 0) >= IMPACT_HIGH_PCT) {
    return false;
  }
  return true;
}

export function buildSwapHops({ quote, fromTicker, toTicker } = {}) {
  const from = String(fromTicker || "").toUpperCase();
  const to = String(toTicker || "").toUpperCase();
  if (!(quote?.actualOutput > 0)) return [];
  if (quote.via === "xrp-bridge") {
    return [
      { from, to: "XRP", venue: quote.hops?.[0]?.route || quote.routeUsed },
      { from: "XRP", to, venue: quote.hops?.[1]?.route || quote.routeUsed },
    ];
  }
  if (quote.via === "bridge") {
    return [
      { from, to: "XIO", venue: quote.routeUsed },
      { from: "XIO", to, venue: quote.routeUsed },
    ];
  }
  return [{ from, to, venue: quote.routeUsed || "direct" }];
}

export function smartAdvisorNote({ quote, fromTicker, toTicker, routingMode } = {}) {
  const mode = swapModeById(routingMode);
  const hops = buildSwapHops({ quote, fromTicker, toTicker });
  const best = hops[0] ? `${hops[0].from}/${hops[hops.length - 1].to} ${quote?.via === "direct" ? "direct" : quote?.routeUsed || "path"}` : mode.advisor;
  if (normalizeSwapMode(routingMode) === "smart" && quote?.actualOutput > 0) {
    return `Smart scanned AMM + order book + multi-hop. Best venue: ${best}.`;
  }
  return mode.advisor;
}

const STABLE_TICKERS = new Set(["RLUSD", "USD", "USDC", "USDT"]);

export function assessSwapSupplyDemand({
  bookQuote,
  ammQuote,
  quote,
  fromTicker,
  toTicker,
  qty,
} = {}) {
  const book = Number(bookQuote?.actualOutput || quote?.bookOutput || 0);
  const amm = Number(ammQuote?.actualOutput || quote?.ammOutput || 0);
  const total = book + amm;
  const from = String(fromTicker || "").toUpperCase();
  const to = String(toTicker || "").toUpperCase();
  return {
    book,
    amm,
    bookShare: total > 0 ? book / total : 0,
    thinBook: !(book > 0),
    thinAmm: !(amm > 0),
    stableLeg: STABLE_TICKERS.has(from) || STABLE_TICKERS.has(to),
    from,
    to,
    qty: Number(qty) || 0,
  };
}

export function smartChatMessages({
  quote,
  routingMode,
  fromTicker,
  toTicker,
  bookQuote,
  ammQuote,
  qty,
} = {}) {
  const rows = [];
  const id = normalizeSwapMode(routingMode);
  const demand = assessSwapSupplyDemand({ bookQuote, ammQuote, quote, fromTicker, toTicker, qty });
  if (!(quote?.actualOutput > 0)) {
    if (demand.qty > 0 && demand.thinBook && demand.thinAmm) {
      rows.push(`No live supply or posted demand for ${demand.from} → ${demand.to} at this size.`);
    }
    return rows;
  }
  if (quote.routeUsed === "book" && Number(bookQuote?.actualOutput ?? quote.bookOutput ?? 0) > 0) {
    rows.push("Smart routing avoided a 1% AMM fee by using the order book.");
  }
  if (quote.via === "xrp-bridge" || quote.via === "bridge") {
    rows.push(`Smart routing used multi-hop to reach ${toTicker || "the target"} with 0% extra hop fee.`);
  }
  if (quote.isNegativeSlippage && !quoteUsesPool(quote)) {
    rows.push("Smart routing detected negative slippage and switched venue.");
  }
  const share = Number(quote.poolReducePercent);
  if (quoteUsesPool(quote) && share > 0) {
    const shown = share < 0.01 ? "<0.01%" : `${share >= 10 ? share.toFixed(1) : share.toFixed(2)}%`;
    rows.push(`This fill takes ${shown} of the pool reserve.`);
  }
  if (quote.bookOutput > 0 && quote.ammOutput > 0) {
    rows.push("Smart routing split the trade across AMM + order book.");
  }
  if (demand.thinBook && demand.amm > 0) {
    rows.push(`Order-book demand is thin for ${demand.from} → ${demand.to}. Pool supply can still fill this size.`);
  } else if (demand.bookShare >= 0.55 && demand.book > 0 && id === "smart") {
    rows.push(`Posted demand on the ${demand.from}/${demand.to} tape covers most of this size.`);
  }
  if (demand.stableLeg && demand.book > 0 && rows.length < 3) {
    rows.push("A stablecoin leg is in this pair. Keep size near posted demand so the fill stays close to peg.");
  }
  if (id !== "smart" && !rows.length) {
    rows.push(swapModeById(id).advisor);
  }
  return rows.slice(0, 4);
}

export function recommendSwapMode({
  qty,
  routingMode,
  alternatives = [],
  noRoute,
  quote,
  bookQuote,
  ammQuote,
  fromAsset,
  toAsset,
  fromTicker,
  toTicker,
} = {}) {
  const id = normalizeSwapMode(routingMode);
  if (!(qty > 0)) return null;
  if (id === "rippling" && !sameIssuerRipple(fromAsset, toAsset)) {
    return { id: "smart", reason: "noripple", amountIn: qty };
  }
  if (noRoute) {
    if (id === "orderbook-only") return { id: "amm-only", reason: "nobook", amountIn: qty };
    if (id === "amm-only" || id === "passive-amm") return { id: "smart", reason: "noamm", amountIn: qty };
    return null;
  }
  const demand = assessSwapSupplyDemand({ bookQuote, ammQuote, quote, fromTicker, toTicker, qty });
  const currentOut = Number(quote?.actualOutput || 0);
  const amm = alternatives.find((row) => row.id === "amm");
  const book = alternatives.find((row) => row.id === "book");
  const half = alternatives.find((row) => row.id === "half");
  if (id !== "amm-only" && id !== "passive-amm" && (amm || demand.amm > currentOut + 1e-9)) {
    return { id: "amm-only", reason: demand.thinBook ? "supply" : "better", amountIn: qty };
  }
  if (id !== "orderbook-only" && (book || demand.book > currentOut + 1e-9)) {
    return { id: "orderbook-only", reason: demand.bookShare >= 0.55 ? "demand" : "better", amountIn: qty };
  }
  if (quote?.via === "xrp-bridge" && id === "smart") {
    return { id: "auto-bridging", reason: "bridge", amountIn: qty };
  }
  if (half && !quoteUsesPool(quote)) return { id: "half", reason: "half", amountIn: half.amountIn };
  return null;
}
