// XIO share of the LP vs the rest. Do not infer an equal-value quote —
// that forces every bar to 50/50. Prefer XIO compared to LP token supply
// (the LP total); if that is missing, compare XIO to the opposing reserve.

import {isXrpMicroFallback} from "./recordedPrice.js";

export function poolAssetSplit({
  reserveXio,
  reserveQuote,
  xioUsd,
  quoteUsd,
} = {}) {
  const xio = Number(reserveXio);
  const quote = Number(reserveQuote);
  const xioPrice = Number(xioUsd);
  const quotePrice = Number(quoteUsd);
  if (!(xio > 0) || !(quote > 0) || !(xioPrice > 0) || !(quotePrice > 0)) {
    return null;
  }

  const xioValue = xio * xioPrice;
  const quoteValue = quote * quotePrice;
  const total = xioValue + quoteValue;
  if (!(total > 0)) return null;

  const xioPct = roundPoolPct((xioValue / total) * 100);
  const quotePct = roundPoolPct(100 - xioPct);
  return {
    xioPct,
    quotePct,
    lead: xioPct >= quotePct ? "xio" : "quote",
  };
}

export function roundPoolPct(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function formatPoolPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(1);
}

export function displayPoolSplit(xioPct, quotePct) {
  if (xioPct != null && quotePct != null && Number.isFinite(Number(xioPct)) && Number.isFinite(Number(quotePct))) {
    return { xioPct: Number(xioPct), quotePct: Number(quotePct), measured: true };
  }
  return { xioPct: 50, quotePct: 50, measured: false };
}

export function inferQuoteReserve(reserveXio, xioUsd, quoteUsd) {
  const xio = Number(reserveXio);
  const xioPrice = Number(xioUsd);
  const quotePrice = Number(quoteUsd);
  if (!(xio > 0) || !(xioPrice > 0) || !(quotePrice > 0)) return 0;
  return (xio * xioPrice) / quotePrice;
}

export function opposingPoolAsset({
  reserveXio,
  reserveQuote,
  lpSupply,
  price,
  xioUsd,
  quoteUsd,
} = {}) {
  const lp = Number(lpSupply);
  if (lp > 0) return lp;
  const quote = Number(reserveQuote);
  if (quote > 0) return quote;
  const xio = Number(reserveXio);
  const px = Number(price);
  if (xio > 0 && px > 0 && px < 10) return xio * px;
  return inferQuoteReserve(xio, xioUsd, quoteUsd);
}

export function resolvePoolSplit({
  reserveXio,
  reserveQuote,
  lpSupply,
  price,
  xioUsd,
  quoteUsd,
} = {}) {
  const xio = Number(reserveXio);
  if (!(xio > 0)) return null;

  const quote = Number(reserveQuote);
  const other = opposingPoolAsset({
    reserveXio: xio,
    reserveQuote: quote,
    lpSupply,
    price,
    xioUsd,
    quoteUsd,
  });
  if (!(other > 0)) return null;

  const xioPct = roundPoolPct((xio / (xio + other)) * 100);
  const quotePct = roundPoolPct(100 - xioPct);
  return {
    xioPct,
    quotePct,
    lead: xioPct >= quotePct ? "xio" : "quote",
    reserveQuote: quote > 0 ? quote : other,
    inferred: !(Number(lpSupply) > 0) && !(quote > 0),
  };
}

export const STABLE_QUOTES = new Set(["RLUSD", "USD", "USDC", "USDT", "USDB", "USDX"]);
const DUST_QUOTE_USD = 0.001;

export function usableMarketQuoteUsd(value, { xioUsd, xrpUsd } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const xio = Number(xioUsd);
  if (xio > 0 && Math.abs(n - xio) <= Math.max(1e-12, Math.abs(xio) * 0.02)) return 0;
  if (isXrpMicroFallback(n, xrpUsd)) return 0;
  return n;
}

export function impliedQuoteUsd({ reserveXio, reserveQuote, xioUsd } = {}) {
  const base = Number(reserveXio);
  const quote = Number(reserveQuote);
  const usd = Number(xioUsd);
  if (!(base > 0) || !(quote > 0) || !(usd > 0)) return 0;
  return (base * usd) / quote;
}

export function quoteUsdFromXrpRate(quoteId, prices = {}, xrpUsd) {
  const id = String(quoteId || "").toUpperCase();
  const xrp = Number(xrpUsd || prices?.xrpUsd || prices?.XRP || 0);
  if (!id || id === "XRP" || !(xrp > 0) || !prices || typeof prices !== "object") return 0;
  const nested = prices.quotes && typeof prices.quotes === "object" ? prices.quotes : null;
  const lower = id.toLowerCase();
  const keys = [
    `${id}Xrp`,
    `${lower}Xrp`,
    `${id}_xrp`,
    `${lower}_xrp`,
    `${id}XRP`,
    `${id}PerXrp`,
    `${lower}PerXrp`,
    `${id}_per_xrp`,
    `${lower}_per_xrp`,
  ];
  for (const key of keys) {
    const n = Number(prices[key] ?? nested?.[key]);
    if (n > 0 && Number.isFinite(n)) return n * xrp;
  }
  return 0;
}

export function quoteUsdFromPrices(quoteId, prices = {}) {
  const id = String(quoteId || "").toUpperCase();
  if (!id || !prices || typeof prices !== "object") return 0;
  if (STABLE_QUOTES.has(id)) return 1;
  const nested = prices.quotes && typeof prices.quotes === "object" ? prices.quotes : null;
  const aliases =
    id === "XRP"
      ? ["xrpUsd", "xrp_usd", "XRP", "XRPUSD"]
      : [id, `${id}Usd`, `${id}_usd`, `${id}USD`];
  for (const key of aliases) {
    const n = Number(prices[key] ?? nested?.[key] ?? nested?.[id]);
    if (n > 0 && Number.isFinite(n)) return n;
  }
  return 0;
}

export function quoteUsdFromMap(quote, prices = {}) {
  return quoteUsdFromPrices(quote, prices);
}

export function quoteUsdLooksImplied(quoteUsd, pool = {}, xioUsd) {
  const implied = impliedQuoteUsd({
    reserveXio: pool?.reserve_xio ?? pool?.reserve_asset ?? pool?.base,
    reserveQuote: pool?.reserve_currency ?? pool?.quoteReserve,
    xioUsd: xioUsd || pool?.xioUsd,
  });
  const n = Number(quoteUsd);
  if (!(n > 0) || !(implied > 0)) return false;
  return Math.abs(n - implied) / implied < 0.05;
}

export function normalizePriceBook(prices = {}) {
  const src = prices && typeof prices === "object" && !Array.isArray(prices) ? prices : {};
  const xrpUsd = Number(src.xrpUsd || src.XRP || 0);
  const xioUsd = Number(src.xioUsd || src.recorded_price || 0);
  const quotes = { ...(src.quotes && typeof src.quotes === "object" ? src.quotes : {}) };
  if (xrpUsd > 0) quotes.XRP = xrpUsd;
  for (const id of STABLE_QUOTES) {
    if (!(Number(quotes[id]) > 0)) quotes[id] = 1;
  }
  for (const [key, value] of Object.entries(src)) {
    if (["quotes", "xioUsd", "recorded_price", "xioGbp", "xrpGbp", "source"].includes(key)) continue;
    let id = "";
    let usd = 0;
    if (/^[A-Z0-9]{2,8}$/.test(key) && key !== "XIO") {
      id = key;
      usd = usableMarketQuoteUsd(value, { xioUsd, xrpUsd });
    } else if (/^([A-Za-z]{2,8})(_usd|Usd|USD)$/.test(key)) {
      id = key.replace(/(_usd|Usd|USD)$/g, "").toUpperCase();
      usd = usableMarketQuoteUsd(value, { xioUsd, xrpUsd });
    } else if (/^([A-Za-z]{2,8})(_xrp|Xrp|XRP)$/.test(key) && xrpUsd > 0) {
      id = key.replace(/(_xrp|Xrp|XRP)$/g, "").toUpperCase();
      usd = usableMarketQuoteUsd(Number(value) * xrpUsd, { xioUsd, xrpUsd });
    }
    if (id && id !== "XIO" && usd > 0 && !(Number(quotes[id]) > 0)) quotes[id] = usd;
  }
  return { ...src, xrpUsd, xioUsd, quotes };
}

export function priceBookFromPools(pools = [], prices = {}) {
  const quotes = {};
  let xioUsd = Number(prices.xioUsd || prices.recorded_price || 0);
  let xrpUsd = Number(prices.xrpUsd || prices.XRP || 0);
  for (const row of Array.isArray(pools) ? pools : []) {
    if (Number(row?.xioUsd) > 0) xioUsd = Number(row.xioUsd);
    const id = String(row?.quote || String(row?.pool || "").split("/")[1] || "").toUpperCase();
    const listed = Number(row?.quote_usd);
    if (id && listed > 0 && !quoteUsdLooksImplied(listed, row, xioUsd || row?.xioUsd)) {
      quotes[id] = listed;
    }
  }
  return normalizePriceBook({ ...prices, xioUsd, xrpUsd, quotes: { ...quotes, ...(prices.quotes || {}) } });
}

export function preferUsdPoolSplit({
  reserveXio,
  reserveQuote,
  lpSupply,
  price,
  xioUsd,
  quoteUsd,
} = {}) {
  const usd = poolAssetSplit({ reserveXio, reserveQuote, xioUsd, quoteUsd });
  if (usd) return { ...usd, basis: "usd", reserveQuote: Number(reserveQuote) || null };
  const units = resolvePoolSplit({
    reserveXio,
    reserveQuote,
    lpSupply,
    price,
    xioUsd,
    quoteUsd,
  });
  return units ? { ...units, basis: units.inferred ? "inferred" : "units" } : null;
}

export function detectQuoteUsd({ quoteId, pool, prices, allowImplied = true } = {}) {
  const book = normalizePriceBook(prices);
  const id = String(quoteId || pool?.quoteName || pool?.quote || "").toUpperCase();
  const xioUsd = Number(pool?.xioUsd || book.xioUsd || 0);
  const xrpUsd = Number(book.xrpUsd || 0);
  const implied = impliedQuoteUsd({
    reserveXio: pool?.reserve_xio ?? pool?.reserve_asset ?? pool?.base,
    reserveQuote: pool?.reserve_currency ?? pool?.quoteReserve,
    xioUsd,
  });
  const market = usableMarketQuoteUsd(quoteUsdFromPrices(id, { ...book, ...book.quotes }), { xioUsd, xrpUsd });
  const fromXrp = usableMarketQuoteUsd(quoteUsdFromXrpRate(id, book, xrpUsd), { xioUsd, xrpUsd });
  const listed = usableMarketQuoteUsd(pool?.quote_usd ?? pool?.quoteUsd, { xioUsd, xrpUsd });
  if (market > 0 && fromXrp > 0) {
    const ratio = market / fromXrp;
    if (ratio > 4 || ratio < 0.25) return fromXrp;
  }
  if (market > 0 && (market >= DUST_QUOTE_USD || !(implied > market * 5))) return market;
  if (fromXrp > 0) return fromXrp;
  if (listed > 0 && !quoteUsdLooksImplied(listed, pool, xioUsd)) return listed;
  if (allowImplied && implied > 0) return implied;
  return 0;
}
