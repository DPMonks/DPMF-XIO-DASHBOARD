/** Live HybridChart snapshot for AIM Commander chat context. Module store so main-page and REMOVED-AI-Matrix charts share one active view. */

import {useSyncExternalStore} from "react";

let snapshot = null;
/** @type {Map<string, { priority: number, value: object|null }>} */
const publishers = new Map();
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function pickWinningSnapshot() {
  let best = null;
  let bestPri = -Infinity;
  for (const row of publishers.values()) {
    if (!row?.value) continue;
    const pri = Number(row.priority) || 0;
    if (pri > bestPri) {
      bestPri = pri;
      best = row.value;
    }
  }
  return best;
}

function recomputeSnapshot() {
  const next = pickWinningSnapshot();
  try {
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
  } catch {
    /* replace */
  }
  snapshot = next;
  emit();
}

/**
 * Publish a HybridChart snapshot.
 * Higher priority wins when multiple charts are mounted (AIM embed > main TradingChart).
 * @param {object|null} next
 * @param {{ source?: string, priority?: number }} [opts]
 */
export function publishChartSnapshot(next, opts = {}) {
  const source = String(opts.source || "main").slice(0, 32);
  const priority = Number.isFinite(Number(opts.priority)) ? Number(opts.priority) : source === "aim" ? 10 : 1;
  const value = next && typeof next === "object" ? { ...next, _source: source, _priority: priority } : null;
  if (!value) {
    publishers.delete(source);
  } else {
    publishers.set(source, { priority, value });
  }
  recomputeSnapshot();
}

/** Drop a publisher (call on HybridChart unmount so the other chart can win). */
export function releaseChartSnapshot(source = "main") {
  const key = String(source || "main").slice(0, 32);
  if (!publishers.has(key)) return;
  publishers.delete(key);
  recomputeSnapshot();
}

export function getChartSnapshot() {
  return snapshot;
}

export function subscribeChartSnapshot(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: latest published HybridChart snapshot (or null). */
export function useChartSnapshot() {
  return useSyncExternalStore(subscribeChartSnapshot, getChartSnapshot, () => null);
}

function pickSwingHighLow(candles = []) {
  const rows = Array.isArray(candles) ? candles : [];
  let high = null;
  let low = null;
  for (const row of rows) {
    const t = Number(row?.t);
    const h = Number(row?.h);
    const l = Number(row?.l);
    if (!Number.isFinite(t)) continue;
    if (Number.isFinite(h) && (!high || h > high.price)) high = { t, price: h };
    if (Number.isFinite(l) && (!low || l < low.price)) low = { t, price: l };
  }
  const lastRow = rows.length ? rows[rows.length - 1] : null;
  const last = lastRow
    ? {
        t: Number(lastRow.t),
        price: Number(lastRow.c) || Number(lastRow.h) || Number(lastRow.l) || null,
      }
    : null;
  return { high, low, last };
}

function slimCandles(candles = []) {
  const rows = Array.isArray(candles) ? candles : [];
  return rows
    .slice(-64)
    .map((c) => ({
      t: Number(c?.t),
      o: Number(c?.o),
      h: Number(c?.h),
      l: Number(c?.l),
      c: Number(c?.c),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.t) &&
        Number.isFinite(c.h) &&
        Number.isFinite(c.l) &&
        Number.isFinite(c.c)
    );
}

export function sameChartPair(a, b) {
  const left = String(a || "").replace(/\s+/g, "").toUpperCase();
  const right = String(b || "").replace(/\s+/g, "").toUpperCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const [rb, rq] = right.split("/");
  return Boolean(rb && rq && left === `${rq}/${rb}`);
}

export function buildChartSnapshot({
  pair,
  timeframe,
  tool,
  maType,
  maPeriods,
  magnet,
  showVolume,
  showRsi,
  showArb,
  hollow,
  deskMarksCount = 0,
  estimateOn = false,
  estimateSide = null,
  drawings = [],
  viewMin = null,
  viewMax = null,
  lastClose = null,
  livePrice = null,
  candles = [],
  xrpLead = null,
  relatedPairs = null,
  ammRibbon = null,
  showAmmRibbon = false,
} = {}) {
  const kinds = {};
  for (const row of Array.isArray(drawings) ? drawings : []) {
    const kind = String(row?.kind || row?.tool || "mark");
    kinds[kind] = (kinds[kind] || 0) + 1;
  }
  const round = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) >= 1000) return Math.round(n * 100) / 100;
    if (Math.abs(n) >= 1) return Math.round(n * 1e6) / 1e6;
    return Math.round(n * 1e8) / 1e8;
  };
  const candleRows = slimCandles(candles);
  const swings = pickSwingHighLow(candleRows);
  const ribbonIn = ammRibbon && typeof ammRibbon === "object" ? ammRibbon : null;
  const ammRibbonOut = ribbonIn
    ? {
        support: round(ribbonIn.support),
        resistance: round(ribbonIn.resistance),
        amm_price: round(ribbonIn.amm_price ?? ribbonIn.ammPrice),
        mid: round(ribbonIn.mid),
        pct: round(ribbonIn.pct),
        pad_bps: Number.isFinite(Number(ribbonIn.pad_bps ?? ribbonIn.padBps))
          ? Math.max(0, Math.round(Number(ribbonIn.pad_bps ?? ribbonIn.padBps)))
          : 0,
        ui_visible: Boolean(showAmmRibbon),
      }
    : null;
  const pairNorm = String(pair || "").replace(/\s+/g, "").toUpperCase() || null;
  const lead =
    xrpLead && typeof xrpLead === "object"
      ? {
          pair: String(xrpLead.pair || "XRP/RLUSD").replace(/\s+/g, "").toUpperCase(),
          bias: xrpLead.bias ? String(xrpLead.bias).slice(0, 24) : null,
          fair_mid: round(xrpLead.fair_mid),
          note: xrpLead.note ? String(xrpLead.note).slice(0, 160) : null,
        }
      : null;
  const related = Array.isArray(relatedPairs)
    ? relatedPairs.map((p) => String(p || "").replace(/\s+/g, "").toUpperCase()).filter(Boolean).slice(0, 6)
    : null;
  return {
    pair: pairNorm,
    timeframe: String(timeframe || "") || null,
    active_tool: tool === "none" || !tool ? "none" : String(tool),
    ma_type: String(maType || "sma"),
    ma_periods: Array.isArray(maPeriods) ? maPeriods.map(Number).filter((n) => Number.isFinite(n)) : [],
    magnet: Boolean(magnet),
    overlays: {
      volume: Boolean(showVolume),
      rsi: Boolean(showRsi),
      arb: Boolean(showArb),
      hollow: Boolean(hollow),
      desk_marks: Number(deskMarksCount) > 0,
      desk_marks_count: Number(deskMarksCount) || 0,
      estimate: Boolean(estimateOn),
      estimate_side: estimateSide === "bear" || estimateSide === "bull" ? estimateSide : null,
      amm_ribbon: Boolean(showAmmRibbon),
    },
    price: {
      last_close: round(lastClose),
      live: round(livePrice),
      visible_min: round(viewMin),
      visible_max: round(viewMax),
    },
    drawings: {
      count: Array.isArray(drawings) ? drawings.length : 0,
      kinds,
    },
    swings: {
      high: swings.high,
      low: swings.low,
      last: swings.last,
    },
    candles: candleRows,
    multi_pair: {
      active: pairNorm,
      xrp_lead: lead,
      related: related,
    },
    // Always include AMM S/R ribbon bounds for Commander when computable (UI toggle only affects ui_visible / overlays.amm_ribbon).
    amm_ribbon: ammRibbonOut,
    at: new Date().toISOString(),
  };
}
