import {detectQuoteUsd, normalizePriceBook} from "../utils/poolSplit.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function poolSpot(reserveBase, reserveQuote) {
  const base = num(reserveBase);
  const quote = num(reserveQuote);
  if (!base || !quote) return 0;
  return quote / base;
}

export function xioXrpSpot(prices = {}, pool = {}) {
  const book = normalizePriceBook(prices);
  const listed = num(book.xioXrp || book.xioPerXrp || prices.xioXrp || prices.xioPerXrp);
  if (listed) return listed;
  const xioUsd = num(book.xioUsd || pool.xioUsd);
  const xrpUsd = num(book.xrpUsd);
  if (xioUsd && xrpUsd) return xioUsd / xrpUsd;
  return poolSpot(pool.base ?? pool.reserve_xio ?? pool.reserve_asset, pool.quote ?? pool.reserve_currency);
}

export function xioQuoteSpot({ quoteId, prices = {}, pool = {}, bookMid = 0 } = {}) {
  const id = String(quoteId || pool.quoteName || pool.quote || "XRP").toUpperCase();
  const book = normalizePriceBook(prices);
  const xioUsd = num(book.xioUsd || pool.xioUsd);
  const xrpMark = xioXrpSpot(book, pool);
  const mid = num(bookMid);

  if (id === "XRP") return mid || xrpMark;

  const quoteUsd = detectQuoteUsd({
    quoteId: id,
    pool,
    prices: book,
    allowImplied: false,
  });
  const marked = xioUsd && quoteUsd ? xioUsd / quoteUsd : 0;
  const fromXrp =
    xrpMark && quoteUsd && num(book.xrpUsd) ? xrpMark / (quoteUsd / num(book.xrpUsd)) : 0;
  const reserveSpot = poolSpot(
    pool.base ?? pool.reserve_xio ?? pool.reserve_asset,
    pool.quote ?? pool.reserve_currency
  );
  const mark = marked || fromXrp || mid;
  if (mark && reserveSpot) {
    const ratio = reserveSpot / mark;
    if (ratio > 4 || ratio < 0.25) return mark;
    return reserveSpot;
  }
  return mark || reserveSpot;
}

export function preferMarkWhenPoolInsane(fromPool, fromMark) {
  const pool = num(fromPool);
  const mark = num(fromMark);
  if (mark && pool) {
    const ratio = pool / mark;
    if (ratio > 4 || ratio < 0.25) return mark;
    return pool;
  }
  if (mark) return mark;
  return pool;
}
