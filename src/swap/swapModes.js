export const SWAP_MODE_IDS = [
  "smart",
  "amm-only",
  "orderbook-only",
  "multi-hop",
  "rippling",
  "auto-bridging",
  "passive-amm",
  "clawback-safe",
  "no-direct-ripple",
  "limit-quality",
  "partial-payment",
  "cross-currency",
];

export const SWAP_MODES = [
  {
    id: "smart",
    title: "Smart routing",
    short: "Best fill from every live venue",
    fee: "0–1%",
    recommended: true,
    user: "Smart Routing finds the best price automatically. It checks the pool and the order book and chooses whichever pays you more. This is the safest and most reliable option.",
    technical:
      "Scans AMM pools, order books, multi-hop paths, auto-bridging, rippling, and trustline conversions. Simulates this exact size and picks the venue with the highest output.",
    advisor: "Smart scanned AMM + order book + multi-hop. Best venue updates with this size.",
    docs: "https://xrpl.org/docs/concepts/tokens/decentralized-exchange",
  },
  {
    id: "amm-only",
    title: "AMM only",
    short: "Pool curve, guaranteed fill",
    fee: "0–1%",
    user: "Uses the liquidity pool only. Fill is guaranteed, but price moves with trade size. Best for large trades when the order book is thin.",
    technical: "Uses the constant-product curve (x·y=k). Guaranteed fill. Curve slippage applies. AMM fee applies.",
    advisor: "This size stays on the AMM curve. Book offers are ignored.",
    docs: "https://xrpl.org/docs/concepts/tokens/decentralized-exchange/automated-market-makers",
  },
  {
    id: "orderbook-only",
    title: "Order book only",
    short: "Posted bids and asks, no AMM fee",
    fee: "0%",
    user: "Uses trader-posted buy and sell orders. No AMM fee, but it may not fill if the book is thin. Best for small trades when good limit orders exist.",
    technical: "Uses posted limit orders only. No curve. No AMM fee. Spread and depth determine price.",
    advisor: "Only posted bids and asks can fill this size. Thin tape may leave a remainder.",
    docs: "https://xrpl.org/docs/concepts/tokens/decentralized-exchange/offers",
  },
  {
    id: "multi-hop",
    title: "Multi-hop",
    short: "Deep path through other assets",
    fee: "0–1%",
    user: "Multi-hop finds routes through several assets to get you the best price. Most useful for rare or illiquid pairs.",
    technical:
      "Chains up to six hops through AMMs, order books, rippling, auto-bridging, and trustline conversions. Example: start asset to XRP to RLUSD to the target.",
    advisor: "Deep routing compares the direct tape, an XRP bridge, and the XIO hop.",
    docs: "https://xrpl.org/docs/concepts/tokens/decentralized-exchange/autobridging",
  },
  {
    id: "rippling",
    title: "Rippling",
    short: "Same-issuer IOU conversion",
    fee: "0%",
    user: "Converts IOUs from the same issuer with no fee. Useful for switching between stablecoins or issuer variants.",
    technical: "Zero-fee trustline balance conversion. Only works when both assets share the same issuer.",
    advisor: "Rippling needs the same issuer on both sides. Different issuers stay locked.",
    docs: "https://xrpl.org/docs/concepts/tokens/fungible-tokens/rippling",
  },
  {
    id: "auto-bridging",
    title: "Auto-bridging",
    short: "XRP as the bridge asset",
    fee: "0–1%",
    user: "Uses XRP as a bridge to complete swaps when no direct market exists. Helps reach assets that normally cannot trade directly.",
    technical:
      "XRPL can use XRP as a bridge when no direct market exists. Auto-bridging itself is free. An AMM fee applies only if a pool hop is used.",
    advisor: "Auto-bridge prefers a live XRP hop when the two assets have no shared tape.",
    docs: "https://xrpl.org/docs/concepts/tokens/decentralized-exchange/autobridging",
  },
  {
    id: "passive-amm",
    title: "Passive AMM",
    short: "Low-impact pool liquidity",
    fee: "0–1%",
    user: "Uses low-impact liquidity from LPs who want reduced price movement. Helps reduce slippage on large trades.",
    technical: "AMM LPs can mark liquidity as passive. Passive liquidity is used only when needed. Reduces curve movement. Same AMM fee.",
    advisor: "This size stays on the pool with the lowest curve impact we can measure.",
    docs: "https://xrpl.org/docs/concepts/tokens/decentralized-exchange/automated-market-makers",
  },
  {
    id: "clawback-safe",
    title: "Clawback-safe",
    short: "Skip issuers that can claw back",
    fee: "0–1%",
    user: "Avoids tokens that can be forcibly taken back by the issuer. Best for regulated or safety-focused swaps.",
    technical: "Avoids assets with Clawback enabled. Pathfinding filters unsafe issuers. Fees follow the venue that remains.",
    advisor: "Unsafe issuers are skipped. The quote only uses the remaining book and pool.",
    docs: "https://xrpl.org/docs/concepts/tokens/fungible-tokens/clawing-back-tokens",
  },
  {
    id: "no-direct-ripple",
    title: "No direct ripple",
    short: "Force book or AMM, not issuer paths",
    fee: "0–1%",
    user: "Avoids direct issuer conversions. Useful when you want predictable pricing or to avoid certain issuers.",
    technical: "Avoids direct issuer paths. Forces XRPL to use an AMM or order book instead.",
    advisor: "Issuer shortcuts are off. Fill must come from a book or a pool.",
    docs: "https://xrpl.org/docs/references/protocol/transactions/types/payment",
  },
  {
    id: "limit-quality",
    title: "Limit quality",
    short: "Reject a worse-than-quoted price",
    fee: "0–1%",
    user: "Ensures you never get a worse price than expected. The swap fails if price moves too much.",
    technical: "Rejects bad prices, high slippage, thin book levels, and AMM curve extremes.",
    advisor: "If this size moves too far from mid, the quote is rejected instead of sliding.",
    docs: "https://xrpl.org/docs/references/protocol/transactions/types/payment",
  },
  {
    id: "partial-payment",
    title: "Partial payment",
    short: "Take whatever can fill",
    fee: "0–1%",
    user: "Lets the swap complete even if full liquidity is not available. You receive whatever amount can be filled.",
    technical: "Allows partial fills from the AMM and the order book. The swap does not fail if the full amount cannot fill.",
    advisor: "A partial fill still counts. Receive shows what this tape can complete now.",
    docs: "https://xrpl.org/docs/concepts/payment-types/partial-payments",
  },
  {
    id: "cross-currency",
    title: "Cross-currency",
    short: "Native XRPL payment path",
    fee: "0–1%",
    user: "The basic XRPL swap engine. Converts one asset to another using XRPL’s native payment system.",
    technical: "All XRPL swaps are payments. This mode exposes the raw payment pathfinding across hops.",
    advisor: "This is a self Payment. rippled picks a path across the book, pool, and bridges.",
    docs: "https://xrpl.org/docs/concepts/payment-types/cross-currency-payments",
  },
];

export function swapModeById(id) {
  const want = normalizeSwapMode(id);
  return SWAP_MODES.find((row) => row.id === want) || SWAP_MODES[0];
}

export function normalizeSwapMode(id) {
  const raw = String(id || "smart").toLowerCase();
  if (raw === "amm" || raw === "amm-only") return "amm-only";
  if (raw === "book" || raw === "orderbook-only") return "orderbook-only";
  if (SWAP_MODE_IDS.includes(raw)) return raw;
  return "smart";
}

export function quoteEngineMode(routingMode) {
  const id = normalizeSwapMode(routingMode);
  if (id === "amm-only" || id === "passive-amm") return "amm";
  if (id === "orderbook-only") return "book";
  return "smart";
}
