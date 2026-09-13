import {quoteEngineMode} from "./swapModes.js";

/**
 * Preview quote against the composed XIO book + AMM curve.
 * Execution still goes through rippled (self Payment). This is not path_find.
 */

export const IMPACT_WARN_PCT = 1.5;
export const IMPACT_HIGH_PCT = 5;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function feeRate(tradingFee) {
  const raw = Number(tradingFee);
  return raw > 0 ? raw / 100_000 : 0;
}

export function ammSwapOut({ reserveIn, reserveOut, amountIn, tradingFee = 1000 } = {}) {
  const x = num(reserveIn);
  const y = num(reserveOut);
  const dx = num(amountIn);
  const fee = feeRate(tradingFee);
  if (!(x > 0) || !(y > 0) || !(dx > 0)) return 0;
  const nextX = x + dx * (1 - fee);
  if (!(nextX > 0)) return 0;
  const out = y - (x * y) / nextX;
  return out > 0 ? out : 0;
}

function isAmmSource(source) {
  return String(source || "").toLowerCase() === "amm";
}

export function copyLevels(rows = [], { dexOnly = false } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !dexOnly || !isAmmSource(row?.source))
    .map((row) => ({
      price: num(row?.price),
      base_size: num(row?.base_size),
      quote_size: num(row?.quote_size) || num(row?.price) * num(row?.base_size),
      source: row?.source || "dex",
    }))
    .filter((row) => row.price > 0 && row.base_size > 0);
}

export function bookVenueMid(bids = [], asks = []) {
  const bidRows = copyLevels(bids, { dexOnly: true });
  const askRows = copyLevels(asks, { dexOnly: true });
  let bestBid = 0;
  for (const row of bidRows) bestBid = Math.max(bestBid, row.price);
  let bestAsk = 0;
  for (const row of askRows) bestAsk = bestAsk > 0 ? Math.min(bestAsk, row.price) : row.price;
  if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
  return bestBid || bestAsk || 0;
}

export function ammVenueMid(reserveBase, reserveQuote) {
  const x = num(reserveBase);
  const y = num(reserveQuote);
  return x > 0 && y > 0 ? y / x : 0;
}

export function resolveVenueMid({
  routingMode = "smart",
  mid,
  reserveBase,
  reserveQuote,
  bids = [],
  asks = [],
} = {}) {
  const mode = String(routingMode || "smart").toLowerCase();
  if (mode === "book") return bookVenueMid(bids, asks);
  if (mode === "amm") return ammVenueMid(reserveBase, reserveQuote) || num(mid);
  return num(mid) || bookVenueMid(bids, asks) || ammVenueMid(reserveBase, reserveQuote);
}

export function walkBook({ levels, amountIn, inIsBase } = {}) {
  let left = num(amountIn);
  let out = 0;
  const used = [];
  for (const row of copyLevels(levels, { dexOnly: true })) {
    if (!(left > 0)) break;
    if (inIsBase) {
      const take = Math.min(left, row.base_size);
      out += take * row.price;
      left -= take;
      used.push({ ...row, take, out: take * row.price });
    } else {
      const quote = row.quote_size > 0 ? row.quote_size : row.base_size * row.price;
      const take = Math.min(left, quote);
      const got = row.price > 0 ? take / row.price : 0;
      out += got;
      left -= take;
      used.push({ ...row, take, out: got });
    }
  }
  return { out, leftover: left > 0 ? left : 0, used, bookOut: out, ammOut: 0 };
}

function applyAmmIn(state, amountIn, tradingFee, inIsBase) {
  if (inIsBase) {
    const got = ammSwapOut({
      reserveIn: state.base,
      reserveOut: state.quote,
      amountIn,
      tradingFee,
    });
    const fee = feeRate(tradingFee);
    state.base += amountIn * (1 - fee);
    state.quote -= got;
    return got;
  }
  const got = ammSwapOut({
    reserveIn: state.quote,
    reserveOut: state.base,
    amountIn,
    tradingFee,
  });
  const fee = feeRate(tradingFee);
  state.quote += amountIn * (1 - fee);
  state.base -= got;
  return got;
}

export function walkHybrid({
  levels,
  amountIn,
  inIsBase,
  reserveBase,
  reserveQuote,
  tradingFee = 1000,
} = {}) {
  const queue = copyLevels(levels, { dexOnly: true }).sort((a, b) =>
    inIsBase ? b.price - a.price : a.price - b.price
  );
  const state = { base: num(reserveBase), quote: num(reserveQuote) };
  let left = num(amountIn);
  let out = 0;
  let bookOut = 0;
  let ammOutTotal = 0;
  let usedAmm = false;
  let usedDex = false;

  while (left > 1e-12) {
    const level = queue[0];
    const slice = level
      ? Math.min(left, inIsBase ? level.base_size : level.quote_size || level.base_size * level.price)
      : left;
    if (!(slice > 0)) break;

    const sliceAmm = applyAmmIn(
      { base: state.base, quote: state.quote },
      slice,
      tradingFee,
      inIsBase
    );
    const sliceBook = level ? (inIsBase ? slice * level.price : slice / level.price) : 0;
    const takeBook = level && sliceBook >= sliceAmm && sliceBook > 0;

    if (takeBook) {
      out += sliceBook;
      bookOut += sliceBook;
      left -= slice;
      usedDex = true;
      if (inIsBase) {
        level.base_size -= slice;
        level.quote_size -= sliceBook;
      } else {
        level.quote_size -= slice;
        level.base_size -= sliceBook;
      }
      if (level.base_size <= 1e-12 || level.quote_size <= 1e-12) queue.shift();
    } else if (sliceAmm > 0) {
      const got = applyAmmIn(state, slice, tradingFee, inIsBase);
      out += got;
      ammOutTotal += got;
      left -= slice;
      usedAmm = true;
    } else {
      break;
    }
  }

  const route = usedAmm && usedDex ? "hybrid" : usedAmm ? "amm" : usedDex ? "book" : "none";
  return { out, leftover: left > 0 ? left : 0, route, usedAmm, usedDex, bookOut, ammOut: ammOutTotal };
}

export function poolReducePercent({
  ammOutput = 0,
  sellingXio,
  reserveBase,
  reserveQuote,
} = {}) {
  const out = num(ammOutput);
  const reserveOut = sellingXio ? num(reserveQuote) : num(reserveBase);
  if (!(out > 0) || !(reserveOut > 0)) return null;
  return (out / reserveOut) * 100;
}

export function quoteUsesPool(quote) {
  return num(quote?.ammOutput) > 0 || quote?.routeUsed === "amm" || quote?.routeUsed === "hybrid";
}

export function expectedFromMid(amountIn, mid, sellingXio) {
  const qty = num(amountIn);
  const px = num(mid);
  if (!(qty > 0) || !(px > 0)) return 0;
  return sellingXio ? qty * px : qty / px;
}

export function quoteSwap({
  amountIn,
  sellingXio,
  mid,
  bids = [],
  asks = [],
  reserveBase,
  reserveQuote,
  tradingFee = 1000,
  routingMode = "smart",
} = {}) {
  const input = num(amountIn);
  const levels = sellingXio ? bids : asks;
  const inIsBase = Boolean(sellingXio);
  const mode = quoteEngineMode(routingMode);
  const venueMid = resolveVenueMid({ routingMode: mode, mid, reserveBase, reserveQuote, bids, asks });

  let walk;
  if (mode === "amm") {
    const out = sellingXio
      ? ammSwapOut({ reserveIn: reserveBase, reserveOut: reserveQuote, amountIn: input, tradingFee })
      : ammSwapOut({ reserveIn: reserveQuote, reserveOut: reserveBase, amountIn: input, tradingFee });
    walk = {
      out,
      leftover: out > 0 ? 0 : input,
      route: out > 0 ? "amm" : "none",
      usedAmm: out > 0,
      usedDex: false,
      bookOut: 0,
      ammOut: out,
    };
  } else if (mode === "book") {
    const book = walkBook({ levels: copyLevels(levels, { dexOnly: true }), amountIn: input, inIsBase });
    walk = { ...book, route: book.out > 0 ? "book" : "none", usedAmm: false, usedDex: book.out > 0, bookOut: book.out, ammOut: 0 };
  } else {
    walk = walkHybrid({
      levels,
      amountIn: input,
      inIsBase,
      reserveBase,
      reserveQuote,
      tradingFee,
    });
  }

  const actual = walk.out;
  const leftover = num(walk.leftover);
  const filledIn = Math.max(0, input - leftover);
  const expectedFilled = expectedFromMid(filledIn, venueMid, sellingXio);
  const expectedFull = expectedFromMid(input, venueMid, sellingXio);
  const hasFill = actual > 0 && walk.route !== "none";
  const expected = hasFill && leftover > 0 ? expectedFilled : expectedFull;
  const slippagePercent = hasFill && expectedFilled > 0 ? ((actual - expectedFilled) / expectedFilled) * 100 : null;
  const isNegativeSlippage = hasFill && expectedFilled > 0 && actual < expectedFilled;
  const lossAmount = isNegativeSlippage ? expectedFilled - actual : 0;
  const execPrice = sellingXio
    ? filledIn > 0 && actual > 0
      ? actual / filledIn
      : 0
    : actual > 0
      ? filledIn / actual
      : 0;
  const priceImpactPercent =
    hasFill && venueMid > 0 && execPrice > 0 ? ((execPrice - venueMid) / venueMid) * 100 : null;

  return {
    expectedOutput: hasFill ? expected : 0,
    actualOutput: actual,
    leftover,
    filledIn,
    routeUsed: walk.route,
    bookOutput: num(walk.bookOut),
    ammOutput: num(walk.ammOut),
    slippagePercent,
    priceImpactPercent,
    isNegativeSlippage,
    lossAmount,
    execPrice,
    mid: venueMid,
    partialFill: hasFill && leftover > 0,
    xioNotional: sellingXio ? filledIn : actual,
    poolReducePercent: poolReducePercent({
      ammOutput: walk.ammOut,
      sellingXio,
      reserveBase,
      reserveQuote,
    }),
  };
}

export function quoteBridgeSwap({ amountIn, fromVenue = {}, toVenue = {}, routingMode = "smart" } = {}) {
  const hop1 = quoteSwap({
    amountIn,
    sellingXio: false,
    routingMode,
    ...fromVenue,
  });
  if (!(hop1.actualOutput > 0)) {
    return {
      ...hop1,
      routeUsed: "none",
      bookOutput: 0,
      ammOutput: 0,
      actualOutput: 0,
      expectedOutput: 0,
      slippagePercent: null,
      priceImpactPercent: null,
      xioNotional: 0,
      hops: [hop1, null],
    };
  }
  const hop2 = quoteSwap({
    amountIn: hop1.actualOutput,
    sellingXio: true,
    routingMode,
    ...toVenue,
  });
  const hasFill = hop2.actualOutput > 0;
  const impact =
    hasFill && hop1.priceImpactPercent != null && hop2.priceImpactPercent != null
      ? hop1.priceImpactPercent + hop2.priceImpactPercent
      : hasFill
        ? hop2.priceImpactPercent
        : null;
  return {
    expectedOutput: hasFill ? hop2.expectedOutput : 0,
    actualOutput: hop2.actualOutput,
    leftover: hop1.leftover || hop2.leftover,
    filledIn: hop1.filledIn,
    routeUsed: hasFill ? "bridge" : "none",
    bookOutput: hasFill ? num(hop2.bookOutput) : 0,
    ammOutput: hasFill ? num(hop2.ammOutput) : 0,
    slippagePercent: hasFill ? hop2.slippagePercent : null,
    priceImpactPercent: impact,
    isNegativeSlippage: hasFill && (hop1.isNegativeSlippage || hop2.isNegativeSlippage),
    lossAmount: (hop1.lossAmount || 0) + (hop2.lossAmount || 0),
    execPrice: 0,
    mid: 0,
    partialFill: Boolean(hop1.partialFill || hop2.partialFill),
    xioNotional: hop1.actualOutput,
    hops: [hop1, hop2],
    poolReducePercent: Math.max(num(hop1.poolReducePercent), num(hop2.poolReducePercent)) || null,
  };
}

export function saferSwapAlternatives(input, quote, extras = {}) {
  const rows = [];
  if (!(num(input) > 0) || !quote) return rows;
  const halfIn = num(input) / 2;
  const half = quoteSwap({ ...extras, amountIn: halfIn, routingMode: extras.routingMode || "smart" });
  const amm = quoteSwap({ ...extras, amountIn: input, routingMode: "amm" });
  const book = quoteSwap({ ...extras, amountIn: input, routingMode: "book" });

  const impactHigh = Math.abs(num(quote.priceImpactPercent)) >= IMPACT_WARN_PCT || quote.isNegativeSlippage;
  const poolFill = quoteUsesPool(quote);
  if (
    impactHigh &&
    !poolFill &&
    half.actualOutput > 0 &&
    Math.abs(half.priceImpactPercent) < Math.abs(quote.priceImpactPercent)
  ) {
    rows.push({ id: "half", amountIn: halfIn, quote: half });
  }
  if (amm.actualOutput > quote.actualOutput + 1e-9) rows.push({ id: "amm", amountIn: input, quote: amm });
  if (book.actualOutput > quote.actualOutput + 1e-9) rows.push({ id: "book", amountIn: input, quote: book });
  return rows;
}
