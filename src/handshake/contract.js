export const PROTOCOL = "indexer-catalog";
export const VERSION = 1;
export const CLIENT = "dpmf-xio-dashboard";
export const SERVICE = "dpmf-xio-indexer";

export const DEFAULT_INDEXER_ORIGIN =
  "https://dpmf-xio-indexer-production.up.railway.app";

export const CLUSTER_HEADERS = {
  accept: "application/json",
};

export const DEFAULT_ENDPOINTS = {
  overview: "/overview",
  amm: "/amm",
  pools: "/pools",
  topHolders: "/top-holders",
  topHoldersToday: "/top-holders?snapshot=today",
  topLp: "/top-lp",
  topLpToday: "/top-lp?snapshot=today",
  holdersCount: "/holders/count",
  holdersCountToday: "/holders/count?snapshot=today",
  trustlinesCount: "/trustlines/count",
  lpHoldersCount: "/lp-holders/count",
  lpHoldersCountToday: "/lp-holders/count?snapshot=today",
  lpTrustlinesCount: "/lp-trustlines/count",
  lpPools: "/lp-pools",
  lpPoolsLive: "/lp-pools/live",
  swapMarket: "/swap-market",
  tvlHistory: "/charts/tvl",
  holdersHistory: "/charts/holders",
  lpHoldersHistory: "/charts/lp-holders",
  lpTrustlinesHistory: "/charts/lp-trustlines",
  trustlinesHistory: "/charts/trustlines",
  activityHistory: "/charts/activity",
  tradersHistory: "/charts/traders",
  trades: "/trades",
  xioFlows: "/xio-flows",
  balances: "/wallet/balances/:address",
  networth: "/wallet/networth/:address",
  walletAccount: "/wallet/account/:address",
  walletLp: "/wallet/lp/:address",
  walletLpIncome: "/wallet/lp-income/:address",
  walletRank: "/wallet/rank/:address",
  prices: "/prices",
  change24h: "/prices/change24h",
  sparkline: "/sparkline/:asset",
  candles: "/charts/candles",
  issuerLocked: "/issuer-locked",
  orderbook: "/orderbook",
  orderbooks: "/orderbooks",
};

export const ENDPOINT_ALIASES = {
  overview: ["overview", "publicOverview", "public_overview"],
  amm: ["amm", "publicAmm", "public_amm"],
  pools: ["pools", "publicPools"],
  topHolders: ["topHolders", "top_holders", "holders", "topHoldersV2"],
  topHoldersToday: ["topHoldersToday", "top_holders_today"],
  topLp: ["topLp", "top_lp", "lpHolders", "lp_holders"],
  topLpToday: ["topLpToday", "top_lp_today"],
  holdersCount: ["holdersCount", "holders_count"],
  holdersCountToday: ["holdersCountToday", "holders_count_today"],
  trustlinesCount: ["trustlinesCount", "trustlines_count"],
  lpHoldersCount: ["lpHoldersCount", "lp_holders_count"],
  lpHoldersCountToday: ["lpHoldersCountToday", "lp_holders_count_today"],
  lpTrustlinesCount: ["lpTrustlinesCount", "lp_trustlines_count"],
  lpPools: ["lpPools", "lp_pools", "xioAmmPools"],
  lpPoolsLive: ["lpPoolsLive", "lp_pools_live"],
  swapMarket: ["swapMarket", "swap_market"],
  tvlHistory: ["tvlHistory", "chartsTvl"],
  holdersHistory: ["holdersHistory", "chartsHolders"],
  lpHoldersHistory: ["lpHoldersHistory", "chartsLpHolders"],
  lpTrustlinesHistory: ["lpTrustlinesHistory", "chartsLpTrustlines"],
  trustlinesHistory: ["trustlinesHistory", "chartsTrustlines"],
  activityHistory: ["activityHistory", "chartsActivity"],
  tradersHistory: ["tradersHistory", "chartsTraders"],
  trades: ["trades", "ammTrades"],
  xioFlows: ["xioFlows", "flows"],
  balances: ["balances", "walletBalances"],
  networth: ["networth", "walletNetworth"],
  walletAccount: ["walletAccount", "wallet_account"],
  walletLp: ["walletLp", "wallet_lp"],
  walletLpIncome: ["walletLpIncome", "wallet_lp_income"],
  walletRank: ["walletRank", "wallet_rank"],
  prices: ["prices"],
  change24h: ["change24h", "priceChange"],
  sparkline: ["sparkline"],
  candles: ["candles", "chartsCandles", "chartCandles"],
  issuerLocked: ["issuerLocked", "issuer_locked"],
  orderbook: ["orderbook", "order_book"],
  orderbooks: ["orderbooks", "order_books"],
};

export const CATALOG_PATHS = ["/api/", "/"];
export const HEALTH_PATHS = ["/health", "/health/xrpl"];

export const INDEXER_HANDSHAKE_PATHS = ["/", "/api", "/api/"];
