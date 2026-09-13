import {ammSpot} from "../ammCurve.js";

export function median(values = []) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** Linear-interpolation percentile for positive finite samples (p in 0..100). */
export function percentile(values = [], p = 50) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  if (nums.length === 1) return nums[0];
  const pct = Math.min(100, Math.max(0, Number(p) || 0));
  const idx = (pct / 100) * (nums.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return nums[lo];
  const t = idx - lo;
  return nums[lo] * (1 - t) + nums[hi] * t;
}

/** IQR fences from positive samples; falls back to min/max when too few points. */
export function iqrFences(values = [], k = 1.5) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!nums.length) return { lo: 0, hi: 1, q1: 0, q3: 0, iqr: 0 };
  if (nums.length < 4) {
    return { lo: nums[0], hi: nums[nums.length - 1], q1: nums[0], q3: nums[nums.length - 1], iqr: 0 };
  }
  const q1 = percentile(nums, 25);
  const q3 = percentile(nums, 75);
  const iqr = Math.max(0, q3 - q1);
  const mult = Number(k) > 0 ? Number(k) : 1.5;
  return {
    q1,
    q3,
    iqr,
    lo: Math.max(0, q1 - mult * iqr),
    hi: q3 + mult * iqr,
  };
}

export function liquidityWalls(book = {}, { multiple = 2 } = {}) {
  const rows = [...(book.bids || []), ...(book.asks || [])].filter(
    (row) => Number(row?.price) > 0 && Number(row?.base_size) > 0 && !row.placeholder
  );
  const midSize = median(rows.map((row) => Number(row.base_size)));
  if (!(midSize > 0)) return [];
  return rows
    .filter((row) => Number(row.base_size) >= midSize * multiple)
    .map((row) => ({
      price: Number(row.price),
      size: Number(row.base_size),
      side: row.side || (book.asks?.includes(row) ? "ask" : "bid"),
      source: row.source || "dex",
      dominance: Number(row.base_size) / midSize,
    }))
    .sort((left, right) => right.size - left.size);
}

export function bookBands(book = {}) {
  const bid = Number(book.best_bid ?? book.bids?.find((row) => Number(row.price) > 0)?.price);
  const ask = Number(book.best_ask ?? book.asks?.find((row) => Number(row.price) > 0)?.price);
  const mid =
    Number(book.mid) > 0
      ? Number(book.mid)
      : bid > 0 && ask > 0
        ? (bid + ask) / 2
        : bid || ask || null;
  const spread = bid > 0 && ask > 0 ? ask - bid : null;
  return {
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
    mid: mid > 0 ? mid : null,
    spread: spread > 0 ? spread : null,
  };
}

export function liquidityPressure({
  xioPct,
  quotePct,
  lpSupply,
  lpSupplyAvg,
} = {}) {
  const xio = Number(xioPct);
  const quote = Number(quotePct);
  const lp = Number(lpSupply);
  const avg = Number(lpSupplyAvg);
  const bias =
    xio > quote ? "down" : quote > xio ? "up" : "neutral";
  return {
    bias,
    strength: Number.isFinite(xio) ? Math.min(1, Math.abs(xio - 50) / 50) : 0,
    volatility: avg > 0 && lp > 0 ? Math.max(0, (lp - avg) / avg) : 0,
  };
}

export function arbitrageWindow(ammPrice, mid) {
  const amm = Number(ammPrice);
  const book = Number(mid);
  if (!(amm > 0) || !(book > 0)) return null;
  const pct = ((book - amm) / amm) * 100;
  return {
    ammPrice: amm,
    mid: book,
    pct,
    highlight: Math.abs(pct) >= 2,
  };
}

/**
 * AMM support/resistance ribbon from AMM spot vs book/spot mid.
 * lo/hi are the arb window bounds; optional padBps widens the band for short-TF cues.
 * Always compute for Commander chart_context; UI overlay is optional.
 */
export function ammSupportResistanceRibbon(ammPrice, mid, { padBps = 0 } = {}) {
  const amm = Number(ammPrice);
  const book = Number(mid);
  if (!(amm > 0) || !(book > 0)) return null;
  let lo = Math.min(amm, book);
  let hi = Math.max(amm, book);
  const centre = (lo + hi) / 2;
  const pad = centre * (Math.max(0, Number(padBps) || 0) / 10_000);
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  if (!(hi > lo)) return null;
  const pct = ((book - amm) / amm) * 100;
  return {
    support: lo,
    resistance: hi,
    amm_price: amm,
    mid: book,
    pct,
    pad_bps: Math.max(0, Number(padBps) || 0),
    width: hi - lo,
  };
}

export function heatmapDots(trades = [], { now = Date.now(), maxAgeMs = 24 * 3_600_000 } = {}) {
  return (Array.isArray(trades) ? trades : [])
    .map((row) => {
      const t = Date.parse(row.timestamp || row.t || row.time);
      const size = Number(row.xio ?? row.base_size ?? row.v ?? 0);
      const price = Number(row.price);
      if (!Number.isFinite(t) || !(size > 0)) return null;
      const age = now - t;
      if (age > maxAgeMs) return null;
      return {
        t,
        price: price > 0 ? price : null,
        size,
        side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
        opacity: Math.max(0.18, 1 - age / maxAgeMs),
        account: row.account || null,
        pool: row.pool || row.pool_name || null,
      };
    })
    .filter(Boolean);
}

export function ammRebalanceTrail(snapshots = []) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .map((row) => {
      const t = Date.parse(row.timestamp || row.t);
      const base = Number(row.reserve_asset ?? row.reserve_xio ?? row.reserveBase);
      const quote = Number(row.reserve_currency ?? row.reserve_quote ?? row.reserveQuote);
      const price = Number(row.price) > 0 ? Number(row.price) : ammSpot(base, quote);
      if (!Number.isFinite(t) || !(price > 0)) return null;
      return { t, price, reserveBase: base, reserveQuote: quote };
    })
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
}

export function ammImpact({ reserveBase, reserveQuote, amount, side } = {}) {
  const x = Number(reserveBase);
  const y = Number(reserveQuote);
  const dx = Number(amount);
  const spot = ammSpot(x, y);
  if (!(spot > 0) || !(dx > 0)) return null;

  if (side === "addLp" || side === "removeLp") {
    const nextBase = side === "addLp" ? x + dx : Math.max(0, x - dx);
    const nextQuote = side === "addLp" ? y + dx * spot : Math.max(0, y - dx * spot);
    return {
      spot,
      next: spot,
      impactPct: 0,
      nextBase,
      nextQuote,
      kind: side,
    };
  }

  const k = x * y;
  let nextX;
  if (side === "buy") {
    if (dx >= x * 0.95) return null;
    nextX = x - dx;
  } else {
    nextX = x + dx;
  }
  if (!(nextX > 0)) return null;
  const nextY = k / nextX;
  const next = nextY / nextX;
  return {
    spot,
    next,
    impactPct: ((next - spot) / spot) * 100,
    nextBase: nextX,
    nextQuote: nextY,
    kind: side === "buy" ? "buy" : "sell",
  };
}

export function depthIntensity(volume, typical) {
  const vol = Number(volume) || 0;
  const base = Number(typical) || 0;
  if (!(base > 0) || !(vol > 0)) return 0.55;
  return Math.max(0.35, Math.min(1, 0.4 + (vol / base) * 0.6));
}

export function microEvents({
  trades = [],
  spreadBps,
  prevSpreadBps,
  pressure,
  walls = [],
  lastFill,
} = {}) {
  const events = [];
  const large = trades.find((row) => Number(row.xio) >= 250_000 && String(row.side).toLowerCase() === "buy");
  if (large) events.push({ id: "large-buy", icon: "⚡", label: "Large buy detected" });
  if (Number(spreadBps) > 0 && Number(prevSpreadBps) > 0 && spreadBps > prevSpreadBps * 1.25) {
    events.push({ id: "spread", icon: "⚠️", label: "Spread widening" });
  }
  if (pressure?.volatility > 0.08) events.push({ id: "lp", icon: "💧", label: "LP deposit spike" });
  if (pressure?.strength > 0.15) events.push({ id: "rebalance", icon: "🔄", label: "AMM rebalancing" });
  if (walls.some((wall) => wall.side === "ask" && lastFill && Number(lastFill.price) >= wall.price * 0.995)) {
    events.push({ id: "wall", icon: "🧱", label: "Sell wall hit" });
  }
  return events.slice(0, 4);
}

export function smartView(candles = [], { rangeId = "1M", spread, now = Date.now(), robust = true } = {}) {
  const days =
    { "1D": 1, "5D": 5, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "5Y": 365 * 5 }[rangeId] ?? 30;
  const start = rangeId === "Max" ? candles[0]?.t : now - days * 86_400_000;
  const visible = candles.filter((row) => row.t >= (start || 0));
  const use = visible.length ? visible : candles.slice(-30);
  if (!use.length) return { start: now - 30 * 86_400_000, end: now, min: 0, max: 1 };
  const lows = use.map((row) => Number(row.l || row.c)).filter((value) => value > 0);
  const highs = use.map((row) => Number(row.h || row.c)).filter((value) => value > 0);
  const closes = use.map((row) => Number(row.c || row.o)).filter((value) => value > 0);
  let min;
  let max;
  if (robust && use.length >= 5 && lows.length && highs.length) {
    // Ignore extreme tails for y-domain (percentile + IQR). Clipped candles already
    // tame thin AMM prints; this is a second line of defense for scale.
    const loPct = percentile(lows, 5);
    const hiPct = percentile(highs, 95);
    const closeFence = iqrFences(closes, 2.5);
    const hiFence = iqrFences(highs, 2.5);
    const loFence = iqrFences(lows, 2.5);
    min = Math.min(loPct, loFence.lo || loPct, closeFence.lo || loPct);
    max = Math.max(hiPct, hiFence.hi || hiPct, closeFence.hi || hiPct);
    const last = closes[closes.length - 1];
    if (last > 0 && last >= min && last <= max * 1.05) {
      min = Math.min(min, last);
      max = Math.max(max, last);
    } else if (last > 0 && last < min) {
      min = last;
    } else if (last > 0 && last > max && last <= max * 1.25) {
      max = last;
    }
  } else {
    min = Math.min(...lows);
    max = Math.max(...highs);
  }
  const pad = (max - min) * (Number(spread) > 0 && spread / ((min + max) / 2) > 0.02 ? 0.18 : 0.08);
  if (!(max > min)) {
    min *= 0.98;
    max *= 1.02;
  }
  return {
    start: use[0].t,
    end: Math.max(use[use.length - 1].t, now),
    min: Math.max(0, min - pad),
    max: max + pad,
  };
}

export const PRICE_ZOOM_MIN = 0.25;
export const PRICE_ZOOM_MAX = 8;
export const PRICE_ZOOM_STEP = 1.18;

export function clampPriceZoom(zoom) {
  const n = Number(zoom);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(PRICE_ZOOM_MAX, Math.max(PRICE_ZOOM_MIN, n));
}

export function zoomPriceScale(current, direction) {
  const from = clampPriceZoom(current);
  const next = Number(direction) > 0 ? from / PRICE_ZOOM_STEP : from * PRICE_ZOOM_STEP;
  return clampPriceZoom(next);
}

export function scalePriceView(view, { zoom = 1, shift = 0 } = {}) {
  if (!view) return view;
  const z = clampPriceZoom(zoom);
  const mid = (Number(view.min) + Number(view.max)) / 2;
  const span = Math.max(1e-12, (Number(view.max) - Number(view.min)) * z);
  let min = mid - span / 2 + Number(shift || 0);
  let max = mid + span / 2 + Number(shift || 0);
  if (min < 0) {
    max += -min;
    min = 0;
  }
  if (!(max > min)) return view;
  return { ...view, min, max };
}

export function shiftAfterPriceZoom({ view, oldZoom, newZoom, anchorPrice, oldShift = 0 } = {}) {
  const oldZ = clampPriceZoom(oldZoom);
  const newZ = clampPriceZoom(newZoom);
  const mid = (Number(view?.min) + Number(view?.max)) / 2;
  const oldSpan = Math.max(1e-12, (Number(view?.max) - Number(view?.min)) * oldZ);
  const newSpan = Math.max(1e-12, (Number(view?.max) - Number(view?.min)) * newZ);
  const oldMin = mid - oldSpan / 2 + Number(oldShift || 0);
  const oldMax = mid + oldSpan / 2 + Number(oldShift || 0);
  const anchor = Number(anchorPrice);
  if (!Number.isFinite(anchor)) return Number(oldShift || 0);
  const ratio = (oldMax - anchor) / Math.max(1e-12, oldMax - oldMin);
  return ratio * newSpan - mid - newSpan / 2 + anchor;
}
