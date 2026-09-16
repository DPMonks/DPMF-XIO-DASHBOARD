import {normalizeSwapMode, swapModeById} from "./swapModes.js";

const AMM_HOP = { label: "AMM hop", fee: "0-1%" };
const BOOK_HOP = { label: "Order book hop", fee: "0%" };
const RIPPLE_HOP = { label: "Rippling hop", fee: "0%" };
const BRIDGE_HOP = { label: "Auto-bridge hop", fee: "0%" };

export function feeRowsForMode(routingMode) {
  const id = normalizeSwapMode(routingMode);
  if (id === "orderbook-only") return [BOOK_HOP];
  if (id === "amm-only" || id === "passive-amm") return [AMM_HOP];
  if (id === "rippling") return [RIPPLE_HOP];
  if (id === "auto-bridging") return [BRIDGE_HOP, AMM_HOP, BOOK_HOP];
  if (id === "multi-hop" || id === "smart" || id === "cross-currency" || id === "clawback-safe") {
    return [AMM_HOP, BOOK_HOP, RIPPLE_HOP, BRIDGE_HOP];
  }
  return [AMM_HOP, BOOK_HOP];
}

export function feeBadgeForMode(routingMode) {
  return `Fee: ${swapModeById(routingMode).fee}`;
}

export function estimateModeFeePercent(routingMode, quote = {}) {
  const id = normalizeSwapMode(routingMode);
  if (id === "orderbook-only" || id === "rippling") return 0;
  if (quote.routeUsed === "book") return 0;
  if (quote.routeUsed === "amm" || quote.routeUsed === "hybrid") {
    const fee = Number(quote.tradingFee ?? quote.feeUnits);
    return fee > 0 ? fee / 1000 : 0.5;
  }
  return id === "amm-only" || id === "passive-amm" ? 0.5 : 0;
}
