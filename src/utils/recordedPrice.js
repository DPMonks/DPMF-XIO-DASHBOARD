import {recordUsdPrice} from "./format.js";

// Live Railway /api/prices still does: xioUsd = xrpUsd * 0.000001
// when price_latest.xio_usd is missing. That is not USD per 1 XIO.
const XRP_MICRO = 0.000001;

export function isXrpMicroFallback(xioUsd, xrpUsd) {
  const xio = Number(xioUsd);
  const xrp = Number(xrpUsd);
  if (!(xio > 0) || !(xrp > 0)) return false;
  return Math.abs(xio - xrp * XRP_MICRO) < 1e-12;
}

export const XRP_USD_MIN = 0.05;
export const XRP_USD_MAX = 25;

export function looksLikeXrpUsd(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= XRP_USD_MIN && num <= XRP_USD_MAX;
}

export function looksLikeXrpPerXio(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 && num < 0.01;
}

export function saneXrpUsd(xrpUsd, xioUsd, xrpPerXio) {
  if (looksLikeXrpUsd(xrpUsd)) return Number(xrpUsd);
  if (Number(xioUsd) > 0 && looksLikeXrpPerXio(xrpPerXio)) {
    const implied = Number(xioUsd) / Number(xrpPerXio);
    if (looksLikeXrpUsd(implied)) return implied;
  }
  return null;
}

export function recordedXioUsdFromPrices(prices = {}, fallbackXrpUsd) {
  const xrpUsd = Number(prices.xrpUsd ?? prices.xrp_usd ?? fallbackXrpUsd ?? 0);
  for (const value of [prices.recorded_price, prices.xioUsd, prices.xio_usd]) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) continue;
    if (isXrpMicroFallback(num, xrpUsd)) continue;
    return recordUsdPrice(num);
  }
  return 0;
}

export function xrpPerXio(xioUsd, xrpUsd) {
  const usd = Number(xioUsd);
  const xrp = Number(xrpUsd);
  if (!(usd > 0) || !looksLikeXrpUsd(xrp)) return 0;
  return recordUsdPrice(usd / xrp);
}

export function pickTrustlineCount(latestCount, historyCount) {
  const history = Number(historyCount) || 0;
  if (history > 0) return history;
  return Number(latestCount) || 0;
}
