import {XIO_FEE_TREASURY, XIO_PLATFORM_FEE_PCT} from "../constants/ledger.js";
import {normalizePriceBook} from "../utils/poolSplit.js";
import {quoteUnitUsd, xioAmount, xioUnitUsd} from "../xaman/tradeTx.js";

function tickerOf(id) {
  return String(id || "")
    .split(":")[0]
    .toUpperCase();
}

export function isXioAsset(id) {
  return tickerOf(id) === "XIO";
}

export function sameXrplAccount(left, right) {
  return String(left || "").trim() === String(right || "").trim();
}

export function needsXioPlatformFee(fromId, toId) {
  const from = tickerOf(fromId);
  const to = tickerOf(toId);
  if (!from || !to || from === to) return false;
  return !isXioAsset(from) && !isXioAsset(to);
}

export function poolForSwapTicker(pools = [], ticker) {
  const quote = tickerOf(ticker);
  if (!quote) return null;
  const want = `XIO/${quote}`;
  return (
    (Array.isArray(pools) ? pools : []).find((row) => {
      const name = String(row?.pool || row?.pool_name || row?.pair || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      return name === want || name.endsWith(`/${quote}`);
    }) || null
  );
}

export function swapAssetUsd({ id, ticker, pools = [], prices = {}, pool } = {}) {
  const code = tickerOf(ticker || id);
  const book = normalizePriceBook(prices);
  if (!code) return 0;
  if (code === "XIO") return xioUnitUsd({ prices: book }) || Number(book.xioUsd) || 0;
  if (code === "XRP") return Number(book.xrpUsd) || 0;
  return quoteUnitUsd({
    quoteId: code,
    pool: pool || poolForSwapTicker(pools, code),
    prices: book,
    allowImplied: true,
  });
}

export function tradeNotionalUsd({ payAmount, payUsd, receiveAmount, receiveUsd, xioNotional, xioUsd } = {}) {
  const pay = Number(payAmount) * Number(payUsd);
  if (Number.isFinite(pay) && pay > 0) return pay;
  const got = Number(receiveAmount) * Number(receiveUsd);
  if (Number.isFinite(got) && got > 0) return got;
  const viaXio = Number(xioNotional) * Number(xioUsd);
  return Number.isFinite(viaXio) && viaXio > 0 ? viaXio : 0;
}

export function xioPlatformFeeFromUsd({
  tradeUsd,
  xioUsd,
  pct = XIO_PLATFORM_FEE_PCT,
} = {}) {
  const usd = Number(tradeUsd);
  const px = Number(xioUsd);
  const rate = Number(pct);
  if (!(usd > 0) || !(px > 0) || !(rate > 0)) return 0;
  return (usd * rate) / 100 / px;
}

export function shouldSkipXioPlatformFee({
  account,
  treasury = XIO_FEE_TREASURY,
  xio,
} = {}) {
  if (!(Number(xio) > 0)) return true;
  return sameXrplAccount(account, treasury);
}

export function xioPlatformFeeTxjson({
  account,
  xio,
  treasury = XIO_FEE_TREASURY,
} = {}) {
  if (shouldSkipXioPlatformFee({ account, treasury, xio })) return null;
  const txjson = {
    TransactionType: "Payment",
    Destination: treasury,
    Amount: xioAmount(xio),
  };
  if (account) txjson.Account = account;
  return txjson;
}
