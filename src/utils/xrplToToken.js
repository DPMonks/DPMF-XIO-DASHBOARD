import {XIO_ISSUED_AT, XIO_ISSUER, XIO_TOTAL_SUPPLY, XIO_XRPL_TO_MD5} from "../constants/ledger.js";
import {XIO_BLACKHOLED_AT} from "./blackhole.js";
import {fillMissingXioFiat, pricesNeedFiat} from "./fiatFx.js";
import {looksLikeXioVolume, xioFromXrpVolume} from "./lpVolume.js";
import {looksLikeXrpUsd, recordedXioUsdFromPrices, xrpPerXio} from "./recordedPrice.js";

export const XRPL_TO_TOKEN_URL = `https://api.xrpl.to/v1/token/${XIO_XRPL_TO_MD5}`;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseXrplToToken(payload = {}) {
  const token = payload?.token && typeof payload.token === "object" ? payload.token : payload;
  const exchXrp = Number(token?.exch);
  const usd = Number(token?.usd);
  return {
    holders: Number(token?.holders) || 0,
    trustlines: Number(token?.trustlines || token?.lines) || 0,
    lpHolders: Number(token?.lpHolderCount) || 0,
    exchXrp: Number.isFinite(exchXrp) && exchXrp > 0 && exchXrp < 1 ? exchXrp : 0,
    vol24hXrp: Number(token?.vol24hxrp || token?.vol24h) || 0,
    change24h: Number(token?.pro24h),
    usd: Number.isFinite(usd) && usd > 0 && !looksLikeXrpUsd(usd) ? usd : 0,
    marketcap: num(token?.marketcap),
    tvl: num(token?.tvl),
    source: "xrpl.to",
  };
}

export function xioUsdFromXrplTo(token = {}, xrpUsd) {
  if (num(token.usd)) return Number(token.usd);
  const xrp = num(xrpUsd);
  if (num(token.exchXrp) && xrp) return Number(token.exchXrp) * xrp;
  return 0;
}

export function tvlUsdFromXrplTo(token = {}, xrpUsd) {
  const raw = num(token.tvl);
  const fx = num(xrpUsd);
  if (!raw) return 0;
  // The XIO card stores pool TVL as 2 × XRP reserve, not USD.
  if (fx && raw < 50_000) return raw * fx;
  return raw;
}

function fxFromXrp(xioUsd, xrpUsd, xrpFx) {
  return xioUsd > 0 && xrpUsd > 0 && num(xrpFx) ? xioUsd * (Number(xrpFx) / Number(xrpUsd)) : 0;
}

export function marketNeedsXrplTo(row = {}) {
  const price = recordedXioUsdFromPrices(row, row.xrpUsd);
  return !(
    price ||
    num(row.holder_count ?? row.holders ?? row.count) ||
    num(row.trustlines ?? row.trustline_count)
  );
}

export function countsNeedXrplTo(row = {}) {
  return !(
    num(row.holder_count ?? row.holders ?? row.count) &&
    num(row.trustlines ?? row.trustline_count)
  );
}

export function applyXrplToPrices(prices = {}, token = {}) {
  const xrpUsd = num(prices.xrpUsd ?? prices.XRP);
  const fromToken = xioUsdFromXrplTo(token, xrpUsd);
  const existing = recordedXioUsdFromPrices(prices, xrpUsd);
  const xioUsd = existing || fromToken;
  if (!xioUsd && !pricesNeedFiat(prices)) return prices;
  const usedToken = !existing && fromToken > 0;
  const next = {
    ...prices,
    xioUsd: xioUsd || 0,
    recorded_price: xioUsd || prices.recorded_price || 0,
    price: xioUsd || prices.price || 0,
    xioGbp: num(prices.xioGbp) || fxFromXrp(xioUsd, xrpUsd, prices.xrpGbp),
    xioEur: num(prices.xioEur) || fxFromXrp(xioUsd, xrpUsd, prices.xrpEur),
    xioJpy: num(prices.xioJpy) || fxFromXrp(xioUsd, xrpUsd, prices.xrpJpy),
    xio_per_xrp: num(prices.xio_per_xrp) || xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
    xioPerXrp: num(prices.xioPerXrp) || xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
    source: usedToken
      ? prices.source && prices.source !== "xrpl.to"
        ? "hybrid"
        : "xrpl.to"
      : prices.source || "hybrid",
  };
  return fillMissingXioFiat(next);
}

export function applyXrplToOverview(overview = {}, token = {}, prices = {}) {
  const priced = applyXrplToPrices({ ...overview, ...prices }, token);
  const xioUsd = num(priced.xioUsd);
  const xrpUsd = num(priced.xrpUsd ?? overview.xrpUsd);
  const next = {
    ...overview,
    ...priced,
    holder_count: num(overview.holder_count ?? overview.holders) || num(token.holders) || null,
    holders: num(overview.holders ?? overview.holder_count) || num(token.holders) || null,
    trustlines: num(overview.trustlines ?? overview.trustline_count) || num(token.trustlines) || null,
    trustline_count: num(overview.trustline_count ?? overview.trustlines) || num(token.trustlines) || null,
    lp_holder_count: num(overview.lp_holder_count) || num(token.lpHolders) || null,
    volume24hXrp: num(overview.volume24hXrp) || num(token.vol24hXrp) || null,
    volume24hXio:
      num(overview.volume24hXio) ||
      xioFromXrpVolume(token.vol24hXrp, token.exchXrp || overview.xioPerXrp || overview.xio_per_xrp) ||
      (looksLikeXioVolume(overview.volume24h) ? num(overview.volume24h) : 0) ||
      null,
    volume24hUsd:
      num(overview.volume24hUsd) ||
      (num(token.vol24hXrp) && xrpUsd ? token.vol24hXrp * xrpUsd : null),
    volume24h:
      num(overview.volume24hXio) ||
      xioFromXrpVolume(token.vol24hXrp, token.exchXrp || overview.xioPerXrp || overview.xio_per_xrp) ||
      (looksLikeXioVolume(overview.volume24h) ? num(overview.volume24h) : 0) ||
      null,
    tvl: num(overview.tvl_usd ?? overview.tvl) || tvlUsdFromXrplTo(token, xrpUsd) || null,
    tvl_usd: num(overview.tvl_usd ?? overview.tvl) || tvlUsdFromXrplTo(token, xrpUsd) || null,
    ammMarketCap: num(overview.ammMarketCap ?? overview.tvl_usd) || tvlUsdFromXrplTo(token, xrpUsd) || null,
    xrplMarketCap: num(overview.xrplMarketCap) || num(token.marketcap) || XIO_TOTAL_SUPPLY * xioUsd,
    circulatingMarketCap:
      num(overview.circulatingMarketCap) ||
      num(token.marketcap) ||
      Number(overview.circulating || overview.circulating_supply || XIO_TOTAL_SUPPLY) * xioUsd,
    issuer: overview.issuer || XIO_ISSUER,
    tokenType: overview.tokenType || "XIO",
    created: overview.created || XIO_ISSUED_AT,
    blackholed: overview.blackholed ?? true,
    blackholed_fixed: overview.blackholed_fixed ?? true,
    blackholed_at: overview.blackholed_at || XIO_BLACKHOLED_AT,
    source: overview.source && overview.source !== "xrpl.to" && xioUsd ? "hybrid" : priced.source,
  };
  return next;
}

export function applyXrplToChange(change = {}, token = {}) {
  const next = { ...change };
  if (!(Number(next.xio) || Number(next.XIO)) && Number.isFinite(Number(token.change24h))) {
    next.xio = Number(token.change24h);
    next.source = next.source && next.source !== "xrpl.to" ? "hybrid" : "xrpl.to";
  }
  return next;
}
