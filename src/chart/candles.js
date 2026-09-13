import {bucketTime, CHART_VISIBLE_BARS, intervalMs, isDailyOrLonger, tickMs} from "./intervals.js";

export function candlePrice(row) {
  const close = Number(row?.c ?? row?.close ?? row?.price ?? row?.p);
  return close > 0 ? close : null;
}

export function normalizeCandle(row, intervalId = "1D") {
  const t = bucketTime(tickMs(row), intervalId);
  const o = Number(row?.o ?? row?.open);
  const h = Number(row?.h ?? row?.high);
  const l = Number(row?.l ?? row?.low);
  const c = Number(row?.c ?? row?.close ?? row?.price ?? row?.p);
  const v = Number(row?.v ?? row?.volume ?? row?.xio ?? 0) || 0;
  if (t == null || (!(c > 0) && !(o > 0))) return null;
  const close = c > 0 ? c : o;
  const open = o > 0 ? o : close;
  const high = h > 0 ? Math.max(h, open, close) : Math.max(open, close);
  const low = l > 0 ? Math.min(l, open, close) : Math.min(open, close);
  return {
    t,
    o: open,
    h: high,
    l: low,
    c: close,
    v,
    source: row?.source || "tick",
  };
}

export function ticksToCandles(ticks = [], intervalId = "1D", { continuous = true } = {}) {
  const buckets = new Map();

  for (const tick of Array.isArray(ticks) ? ticks : []) {
    const ready = normalizeCandle(tick, intervalId);
    const price = Number(tick?.p ?? tick?.price ?? tick?.c ?? tick?.close);
    const t = ready?.t ?? bucketTime(tickMs(tick), intervalId);
    if (t == null) continue;

    if (ready && (Number(tick?.o) > 0 || Number(tick?.h) > 0 || Number(tick?.l) > 0)) {
      const prev = buckets.get(t);
      if (!prev) {
        buckets.set(t, { ...ready });
      } else {
        buckets.set(t, {
          t,
          o: prev.o,
          h: Math.max(prev.h, ready.h),
          l: Math.min(prev.l, ready.l),
          c: ready.c,
          v: prev.v + ready.v,
          source: ready.source || prev.source,
        });
      }
      continue;
    }

    if (!(price > 0)) continue;
    const vol = Number(tick?.v ?? tick?.volume ?? tick?.xio ?? 0) || 0;
    const prev = buckets.get(t);
    if (!prev) {
      buckets.set(t, { t, o: price, h: price, l: price, c: price, v: vol, source: tick?.source || "tick" });
    } else {
      prev.h = Math.max(prev.h, price);
      prev.l = Math.min(prev.l, price);
      prev.c = price;
      prev.v += vol;
    }
  }

  const candles = [...buckets.values()].sort((left, right) => left.t - right.t);
  if (!continuous || candles.length < 2) return candles;

  for (let i = 1; i < candles.length; i += 1) {
    const open = candles[i - 1].c;
    candles[i] = {
      ...candles[i],
      o: open,
      h: Math.max(candles[i].h, open, candles[i].c),
      l: Math.min(candles[i].l, open, candles[i].c),
    };
  }
  return candles;
}

export function resampleCandles(candles = [], intervalId = "1D") {
  if (!isDailyOrLonger(intervalId) && intervalId !== "1D") {
    return ticksToCandles(candles, intervalId, { continuous: false });
  }
  const buckets = new Map();
  for (const row of candles) {
    const t = bucketTime(row.t, intervalId);
    if (t == null || !(Number(row.c) > 0)) continue;
    const prev = buckets.get(t);
    if (!prev) {
      buckets.set(t, {
        t,
        o: Number(row.o) > 0 ? Number(row.o) : Number(row.c),
        h: Number(row.h) > 0 ? Number(row.h) : Number(row.c),
        l: Number(row.l) > 0 ? Number(row.l) : Number(row.c),
        c: Number(row.c),
        v: Number(row.v) || 0,
        source: row.source || "locked",
      });
    } else {
      prev.h = Math.max(prev.h, Number(row.h) || Number(row.c));
      prev.l = Math.min(prev.l, Number(row.l) || Number(row.c));
      prev.c = Number(row.c);
      prev.v += Number(row.v) || 0;
    }
  }
  return [...buckets.values()].sort((left, right) => left.t - right.t);
}

export function mergeCandleSets(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      const candle = normalizeCandle(row, "1D") || normalizeCandle({ ...row, t: row.t }, "1m");
      if (!candle) continue;
      const key = candle.t;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, candle);
        continue;
      }
      map.set(key, {
        t: key,
        o: prev.o,
        h: Math.max(prev.h, candle.h),
        l: Math.min(prev.l, candle.l),
        c: candle.c,
        v: (prev.v || 0) + (candle.v || 0),
        source: candle.source || prev.source,
      });
    }
  }
  return [...map.values()].sort((left, right) => left.t - right.t);
}

export function sma(values, period) {
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  if (!(n > 1) || values.length < n) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += Number(values[i]) || 0;
    if (i >= n) sum -= Number(values[i - n]) || 0;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, period) {
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  if (!(n > 1) || values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = null;
  let seed = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]) || 0;
    if (i < n - 1) {
      seed += value;
      continue;
    }
    if (prev == null) {
      prev = (seed + value) / n;
    } else {
      prev = value * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function wma(values, period) {
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  const denom = (n * (n + 1)) / 2;
  if (!(n > 1) || values.length < n || !(denom > 0)) return out;
  for (let i = n - 1; i < values.length; i += 1) {
    let sum = 0;
    for (let weight = 1; weight <= n; weight += 1) {
      sum += (Number(values[i - n + weight]) || 0) * weight;
    }
    out[i] = sum / denom;
  }
  return out;
}

export function smma(values, period) {
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  if (!(n > 1) || values.length < n) return out;
  let prev = null;
  let seed = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]) || 0;
    if (i < n - 1) {
      seed += value;
      continue;
    }
    prev = prev == null ? (seed + value) / n : (prev * (n - 1) + value) / n;
    out[i] = prev;
  }
  return out;
}

export function vwma(values, volumes = [], period) {
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  if (!(n > 1) || values.length < n) return out;
  for (let i = n - 1; i < values.length; i += 1) {
    let priceVol = 0;
    let vol = 0;
    for (let j = 0; j < n; j += 1) {
      const close = Number(values[i - n + 1 + j]) || 0;
      const size = Number(volumes[i - n + 1 + j]) || 0;
      priceVol += close * size;
      vol += size;
    }
    out[i] = vol > 0 ? priceVol / vol : null;
  }
  return out;
}

export function hma(values, period) {
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  if (!(n > 1) || values.length < n) return out;
  const half = Math.max(2, Math.round(n / 2));
  const root = Math.max(2, Math.round(Math.sqrt(n)));
  const wmaHalf = wma(values, half);
  const wmaFull = wma(values, n);
  const raw = values.map((_, index) =>
    wmaHalf[index] == null || wmaFull[index] == null ? null : 2 * wmaHalf[index] - wmaFull[index]
  );
  const denom = (root * (root + 1)) / 2;
  for (let i = root - 1; i < raw.length; i += 1) {
    let sum = 0;
    let ok = true;
    for (let weight = 1; weight <= root; weight += 1) {
      const value = raw[i - root + weight];
      if (value == null) {
        ok = false;
        break;
      }
      sum += value * weight;
    }
    if (ok) out[i] = sum / denom;
  }
  return out;
}

export const MA_TYPES = [
  { id: "sma", short: "SMA", labelKey: "chartSma" },
  { id: "ema", short: "EMA", labelKey: "chartEma" },
  { id: "wma", short: "WMA", labelKey: "chartWma" },
  { id: "smma", short: "SMMA", labelKey: "chartSmma" },
  { id: "vwma", short: "VWMA", labelKey: "chartVwma" },
  { id: "hma", short: "HMA", labelKey: "chartHma" },
];

export const MA_PERIODS = [
  { period: 9, color: "#ffe14a" },
  { period: 20, color: "#00eaff" },
  { period: 50, color: "#c770ff" },
  { period: 200, color: "#ff9a3c" },
];

export function movingAverage(type, values, period, volumes = []) {
  if (type === "ema") return ema(values, period);
  if (type === "wma") return wma(values, period);
  if (type === "smma") return smma(values, period);
  if (type === "vwma") return vwma(values, volumes, period);
  if (type === "hma") return hma(values, period);
  return sma(values, period);
}

export function seedSeriesForAverages(series = []) {
  const list = Array.isArray(series) ? series : [];
  const out = [];
  for (const row of list) {
    const prev = out[out.length - 1];
    if (prev && row?.source === "carry" && Number(prev.c) === Number(row.c)) continue;
    out.push(row);
  }
  return out.length ? out : list;
}

export function interpolateAverage(knots = [], time) {
  const points = (Array.isArray(knots) ? knots : []).filter(
    (row) => Number.isFinite(row?.t) && Number.isFinite(row?.v)
  );
  if (!points.length || !Number.isFinite(time)) return null;
  if (time < points[0].t) return null;
  if (time === points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (time >= last.t) return last.v;
  let hi = 1;
  while (hi < points.length && points[hi].t < time) hi += 1;
  const left = points[hi - 1];
  const right = points[hi];
  const span = right.t - left.t;
  const mu = span > 0 ? (time - left.t) / span : 0;
  const ease = (1 - Math.cos(mu * Math.PI)) / 2;
  return left.v * (1 - ease) + right.v * ease;
}

export function averagesForWindow({
  series = [],
  visible = [],
  type = "sma",
  periods = [],
  periodMeta = MA_PERIODS,
} = {}) {
  const rows = Array.isArray(series) ? series : [];
  const view = Array.isArray(visible) ? visible : [];
  const firstVisibleT = Number(view[0]?.t);
  const maxPeriod = Math.max(0, ...periods.map((n) => Math.trunc(Number(n)) || 0));
  // Prefer full series; when truncated, keep enough bars before the visible window for every period.
  let windowed = rows;
  if (Number.isFinite(firstVisibleT) && maxPeriod > 0 && rows.length) {
    let startIdx = 0;
    while (startIdx < rows.length && Number(rows[startIdx]?.t) < firstVisibleT) startIdx += 1;
    const from = Math.max(0, startIdx - Math.max(maxPeriod * 2, maxPeriod + 32));
    if (from > 0) windowed = rows.slice(from);
  }
  const source = seedSeriesForAverages(windowed.length ? windowed : rows);
  const closes = source.map((row) => row.c);
  const volumes = source.map((row) => row.v);
  return periods.map((period) => {
    const values = movingAverage(type, closes, period, volumes);
    const knots = source
      .map((row, index) => ({ t: row.t, v: values[index] }))
      .filter((row) => Number.isFinite(row.v));
    const color = periodMeta.find((row) => row.period === period)?.color || "#00eaff";
    return {
      id: `${type}-${period}`,
      color,
      values: view.map((row) => interpolateAverage(knots, row.t)),
    };
  });
}

export function candleBodyWidth({ innerW, candles = [], start, end, stepMs = 86_400_000, extra = 0 } = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const width = Number(innerW) || 0;
  const pad = Math.max(0, Math.trunc(Number(extra) || 0));
  const real = rows.length;
  const count = Math.max(1, real + pad);
  const slot = width / count;
  const firstT = Number(rows[0]?.t);
  const lastT = Number(rows[real - 1]?.t);
  if (
    real >= 2 &&
    Number.isFinite(firstT) &&
    Number.isFinite(lastT) &&
    Number(end) > Number(start) &&
    Number(stepMs) > 0
  ) {
    const dt = (lastT - firstT) / (real - 1);
    const timeSlot = (dt / Math.max(Number(end) - Number(start), 1)) * width;
    if (timeSlot > 0 && timeSlot < slot * 1.35) {
      return Math.max(1.3, Math.min(Math.min(slot, timeSlot) * 0.42, width * 0.08));
    }
  }
  return Math.max(1.3, Math.min(slot * 0.42, width * 0.08));
}

export function candleBodyBox({ width, height, hollow = false } = {}) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (!hollow) {
    return { width: w, height: h, strokeWidth: 1, offsetY: 0 };
  }
  const nextW = w;
  const nextH = Math.max(h, 2.2);
  return {
    width: nextW,
    height: nextH,
    strokeWidth: 1.2,
    offsetY: (nextH - h) / 2,
  };
}

export const ZOOM_BAR_MIN = 24;
export const ZOOM_BAR_MAX = 720;
export const ZOOM_BAR_STEP = 1.22;
export const FUTURE_BARS_MIN = 48;
export const FUTURE_BARS_MAX = 240;

export function futureBarLimit(visible = CHART_VISIBLE_BARS) {
  const count = Math.max(1, Math.trunc(Number(visible) || CHART_VISIBLE_BARS));
  return Math.min(FUTURE_BARS_MAX, Math.max(FUTURE_BARS_MIN, Math.round(count * 0.4)));
}

export function futureBarsFromPan(offset = 0) {
  return Math.max(0, -Math.trunc(Number(offset) || 0));
}

export function clampVisibleBars(count, fallback = CHART_VISIBLE_BARS) {
  const seed = Number.isFinite(Number(count)) && Number(count) > 0 ? Number(count) : Number(fallback) || CHART_VISIBLE_BARS;
  return Math.min(ZOOM_BAR_MAX, Math.max(ZOOM_BAR_MIN, Math.round(seed)));
}

export function zoomVisibleBars(current, direction, fallback = CHART_VISIBLE_BARS) {
  const from = clampVisibleBars(current, fallback);
  const next = Number(direction) > 0 ? from / ZOOM_BAR_STEP : from * ZOOM_BAR_STEP;
  return clampVisibleBars(next, fallback);
}

export function panAfterZoom({
  total,
  oldVisible,
  newVisible,
  oldPan = 0,
  anchorRatio = 1,
} = {}) {
  const size = Array.isArray(total) ? total.length : Math.max(0, Math.trunc(Number(total) || 0));
  const oldV = Math.max(1, Math.trunc(Number(oldVisible) || 1));
  const newV = Math.max(1, Math.trunc(Number(newVisible) || 1));
  const oldP = clampPanOffset(oldPan, size, oldV);
  const ratio = Number.isFinite(Number(anchorRatio))
    ? Math.min(1, Math.max(0, Number(anchorRatio)))
    : 1;
  const right = size - oldP;
  const left = right - oldV;
  const anchorIndex = left + ratio * oldV;
  const nextPan = size - newV - (anchorIndex - ratio * newV);
  return clampPanOffset(Number.isFinite(nextPan) ? nextPan : 0, size, newV);
}

export function clampPanOffset(offset, total, visible, futureMax) {
  const count = Math.max(1, Math.trunc(Number(visible) || 1));
  const size = Array.isArray(total) ? total.length : Math.max(0, Math.trunc(Number(total) || 0));
  const max = Math.max(0, size - count);
  const min = -Math.max(0, Math.trunc(Number.isFinite(Number(futureMax)) ? Number(futureMax) : futureBarLimit(count)));
  const n = Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0;
  const clamped = Math.min(max, Math.max(min, n));
  return Number.isFinite(clamped) ? clamped : 0;
}

export function windowBars(candles = [], { bars = CHART_VISIBLE_BARS, offset = 0 } = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const n = Math.max(1, Math.trunc(Number(bars) || CHART_VISIBLE_BARS));
  if (rows.length <= n) return rows;
  const history = Math.max(0, clampPanOffset(offset, rows.length, n));
  const end = rows.length - history;
  return rows.slice(end - n, end);
}

export function windowLastBars(candles = [], bars = CHART_VISIBLE_BARS) {
  return windowBars(candles, { bars, offset: 0 });
}

export function wheelPanSteps(deltaX, deltaY, leftover = 0, threshold = 36) {
  const raw = Math.abs(Number(deltaX)) >= Math.abs(Number(deltaY)) ? Number(deltaX) : Number(deltaY);
  const total = Number(leftover) + (Number.isFinite(raw) ? raw : 0);
  const step = Math.max(8, Number(threshold) || 36);
  const steps = Math.trunc(total / step);
  return { steps, leftover: total - steps * step };
}

export function wheelZoomSteps(deltaY, leftover = 0, threshold = 56) {
  const total = Number(leftover) + (Number.isFinite(Number(deltaY)) ? Number(deltaY) : 0);
  const step = Math.max(16, Number(threshold) || 56);
  if (!Number.isFinite(total)) return { steps: 0, leftover: 0 };
  if (Math.abs(total) < step) return { steps: 0, leftover: total };
  return { steps: total > 0 ? 1 : -1, leftover: 0 };
}

export function liveSeriesGrew({ prevLen = 0, prevHead = 0, nextLen = 0, nextHead = 0 } = {}) {
  const grew = (Number(nextLen) || 0) - (Number(prevLen) || 0);
  return grew > 0 && Number(prevLen) > 0 && Number(nextHead) === Number(prevHead);
}

export function expandDailyToInterval(daily = [], intervalId, fromMs, toMs) {
  const step = intervalMs(intervalId);
  const start = bucketTime(fromMs ?? daily[0]?.t, intervalId);
  const end = bucketTime(toMs ?? daily[daily.length - 1]?.t, intervalId);
  if (start == null || end == null || end < start || !(step > 0)) return daily;
  const byDay = new Map(
    (Array.isArray(daily) ? daily : [])
      .map((row) => [bucketTime(row.t, "1D"), row])
      .filter(([key]) => key != null)
  );
  const out = [];
  let prev = null;
  const want = Math.ceil((end - start) / step) + 2;
  const limit = start + step * Math.min(4000, Math.max(1200, want));
  for (let t = start; t <= end && t <= limit; t += step) {
    const dayKey = bucketTime(t, "1D");
    const dayRow = byDay.get(dayKey);
    if (dayRow && t === dayKey) {
      prev = { ...dayRow, t, source: dayRow.source || "locked" };
      out.push(prev);
    } else if (prev) {
      out.push({
        t,
        o: prev.c,
        h: prev.c,
        l: prev.c,
        c: prev.c,
        v: 0,
        source: "carry",
      });
    }
  }
  return spreadCarryFromDaily(out);
}

export function spreadCarryFromDaily(candles = []) {
  const list = (Array.isArray(candles) ? candles : []).map((row) => ({ ...row }));
  const groups = new Map();
  list.forEach((row, index) => {
    const day = bucketTime(row.t, "1D");
    if (day == null) return;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(index);
  });
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const seed = list[indexes.find((index) => list[index].source !== "carry") ?? indexes[0]];
    if (!seed) continue;
    const open = Number(seed.o) || Number(seed.c);
    const close = Number(seed.c) || open;
    const high = Number(seed.h) || Math.max(open, close);
    const low = Number(seed.l) || Math.min(open, close);
    if (!(open > 0) || !(close > 0)) continue;
    const n = indexes.length;
    const highI = Math.min(n - 1, Math.max(0, Math.round((n - 1) * 0.3)));
    const lowI = Math.min(n - 1, Math.max(0, Math.round((n - 1) * 0.7)));
    for (let i = 0; i < n; i += 1) {
      const row = list[indexes[i]];
      if (row.source === "live" || row.source === "sparkline" || row.source === "trade") continue;
      const o = open + (close - open) * (i / n);
      const c = open + (close - open) * ((i + 1) / n);
      row.o = o;
      row.c = c;
      row.h = i === highI ? Math.max(high, o, c) : Math.max(o, c);
      row.l = i === lowI ? Math.min(low, o, c) : Math.min(o, c);
      if (row.source === "carry") row.source = "session";
    }
  }
  return list;
}

export function trueRange(candles = []) {
  return candles.map((row, index) => {
    const high = Number(row.h);
    const low = Number(row.l);
    const prev = Number(candles[index - 1]?.c);
    if (!(high > 0) || !(low > 0)) return 0;
    if (!(prev > 0)) return high - low;
    return Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev));
  });
}

export function atr(candles = [], period = 14) {
  const ranges = trueRange(candles);
  return sma(ranges, period);
}

/** Defaults for display wick/close clipping (thin AMM / passive swap prints). */
export const WICK_CLIP_DEFAULTS = {
  enabled: true,
  atrPeriod: 14,
  atrMult: 6,
  bodyMult: 8,
  maxFrac: 0.75,
  floorFrac: 0.005,
  closeClip: true,
  closeMult: 8,
  closeRatioCap: 4,
  closeMinSamples: 3,
};

/** Stronger defaults for thin DEX/XIO AMM tapes vs CEX XRP/RLUSD. */
export function wickClipPairDefaults(pair = "") {
  const name = String(pair || "").toUpperCase();
  if (name.includes("XIO")) {
    return {
      atrMult: 4,
      bodyMult: 5,
      maxFrac: 0.35,
      closeClip: true,
      closeMult: 5,
      closeRatioCap: 3,
    };
  }
  if (name === "XRP/RLUSD" || name === "XRP/USD") {
    return {
      atrMult: 8,
      bodyMult: 10,
      maxFrac: 0.9,
      closeClip: true,
      closeMult: 12,
      closeRatioCap: 8,
    };
  }
  return {};
}

function envFlag(name) {
  try {
    const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
    const raw = env?.[name];
    if (raw == null || raw === "") return null;
    const s = String(raw).trim().toLowerCase();
    if (s === "0" || s === "false" || s === "off" || s === "no") return false;
    if (s === "1" || s === "true" || s === "on" || s === "yes") return true;
    return null;
  } catch {
    return null;
  }
}

function envNumber(name, fallback) {
  try {
    const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
    const n = Number(env?.[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Read VITE_CHART_WICK_* flags for Hybrid / AIM compose display clipping. */
export function wickClipOptions(overrides = {}) {
  const enabledFlag = envFlag("VITE_CHART_WICK_CLIP");
  const closeFlag = envFlag("VITE_CHART_WICK_CLOSE_CLIP");
  const pairDefaults = wickClipPairDefaults(overrides.pair);
  const base = { ...WICK_CLIP_DEFAULTS, ...pairDefaults };
  const { pair: _pair, ...rest } = overrides;
  return {
    enabled: enabledFlag == null ? base.enabled : enabledFlag,
    atrPeriod: envNumber("VITE_CHART_WICK_ATR_PERIOD", base.atrPeriod),
    atrMult: envNumber("VITE_CHART_WICK_ATR_MULT", base.atrMult),
    bodyMult: envNumber("VITE_CHART_WICK_BODY_MULT", base.bodyMult),
    maxFrac: envNumber("VITE_CHART_WICK_MAX_FRAC", base.maxFrac),
    floorFrac: envNumber("VITE_CHART_WICK_FLOOR_FRAC", base.floorFrac),
    closeClip: closeFlag == null ? base.closeClip !== false : closeFlag,
    closeMult: envNumber("VITE_CHART_WICK_CLOSE_MULT", base.closeMult),
    closeRatioCap: envNumber("VITE_CHART_WICK_CLOSE_RATIO", base.closeRatioCap),
    closeMinSamples: envNumber("VITE_CHART_WICK_CLOSE_SAMPLES", base.closeMinSamples),
    ...rest,
  };
}

function medianPositive(values = []) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function clampPrice(value, lo, hi) {
  const n = Number(value);
  if (!(n > 0)) return n;
  let out = n;
  if (Number.isFinite(lo) && lo > 0) out = Math.max(out, lo);
  if (Number.isFinite(hi) && hi > 0) out = Math.min(out, hi);
  return out;
}

/**
 * Display-only: clip absurd wick highs/lows AND extreme open/close outliers
 * from thin AMM/swap prints so they cannot blow the HybridChart price scale.
 * Keeps real history timestamps; does not invent candles. Marks clipped rows
 * with outlier + rawO/H/L/C for optional muted markers.
 */
export function clipCandleWicks(candles = [], opts = {}) {
  const cfg = { ...WICK_CLIP_DEFAULTS, ...opts };
  const list = Array.isArray(candles) ? candles : [];
  if (!cfg.enabled || list.length < 1) return list;

  const atrPeriod = Math.max(2, Math.trunc(Number(cfg.atrPeriod) || WICK_CLIP_DEFAULTS.atrPeriod));
  const atrMult = Number(cfg.atrMult) > 0 ? Number(cfg.atrMult) : WICK_CLIP_DEFAULTS.atrMult;
  const bodyMult = Number(cfg.bodyMult) > 0 ? Number(cfg.bodyMult) : WICK_CLIP_DEFAULTS.bodyMult;
  const maxFrac = Number(cfg.maxFrac) > 0 ? Number(cfg.maxFrac) : WICK_CLIP_DEFAULTS.maxFrac;
  const floorFrac = Number(cfg.floorFrac) > 0 ? Number(cfg.floorFrac) : WICK_CLIP_DEFAULTS.floorFrac;
  const closeClip = cfg.closeClip !== false;
  const closeMult = Number(cfg.closeMult) > 0 ? Number(cfg.closeMult) : WICK_CLIP_DEFAULTS.closeMult;
  const closeRatioCap = Number(cfg.closeRatioCap) > 1 ? Number(cfg.closeRatioCap) : WICK_CLIP_DEFAULTS.closeRatioCap;
  const closeMinSamples = Math.max(2, Math.trunc(Number(cfg.closeMinSamples) || WICK_CLIP_DEFAULTS.closeMinSamples));

  const closes = list.map((row) => {
    const c = Number(row.c);
    const o = Number(row.o);
    return c > 0 ? c : o > 0 ? o : 0;
  });
  const isCarry = (row) => {
    const srcName = String(row?.source || "");
    return srcName === "carry" || srcName === "session";
  };
  const globalMed = medianPositive(
    closes.filter((value, index) => value > 0 && !isCarry(list[index]))
  ) || medianPositive(closes.filter((value) => value > 0));

  const robustRanges = list.map((row, index) => {
    if (isCarry(row)) return 0;
    const open = Number(row.o) > 0 ? Number(row.o) : Number(row.c);
    const close = Number(row.c) > 0 ? Number(row.c) : open;
    if (!(open > 0) || !(close > 0)) return 0;
    const body = Math.abs(close - open);
    let prev = close;
    for (let j = index - 1; j >= 0; j -= 1) {
      if (!isCarry(list[j]) && Number(list[j].c) > 0) {
        prev = Number(list[j].c);
        break;
      }
    }
    const gap = prev > 0 ? Math.abs(close - prev) : 0;
    return Math.max(body, gap);
  });

  return list.map((row, index) => {
    let open = Number(row.o);
    let close = Number(row.c);
    let high = Number(row.h);
    let low = Number(row.l);
    if (!(open > 0) || !(close > 0)) return { ...row };

    const rawO = open;
    const rawH = high;
    const rawL = low;
    const rawC = close;
    let outlier = false;

    const priorCloses = [];
    for (let j = Math.max(0, index - atrPeriod); j < index; j += 1) {
      if (closes[j] > 0 && !isCarry(list[j])) priorCloses.push(closes[j]);
    }
    const neighborCloses = [];
    const neighborStart = Math.max(0, index - atrPeriod);
    const neighborEnd = Math.min(list.length, index + atrPeriod + 1);
    for (let j = neighborStart; j < neighborEnd; j += 1) {
      if (j === index) continue;
      if (closes[j] > 0 && !isCarry(list[j])) neighborCloses.push(closes[j]);
    }
    const allReal = list
      .map((item, i) => (closes[i] > 0 && !isCarry(item) ? closes[i] : 0))
      .filter((value) => value > 0);
    const refPool =
      priorCloses.length >= closeMinSamples
        ? priorCloses
        : neighborCloses.length >= closeMinSamples
          ? neighborCloses
          : allReal.length
            ? allReal
            : closes.filter((value) => value > 0);
    const ref = medianPositive(refPool) || globalMed;
    const absDevs = refPool.map((value) => Math.abs(value - ref));
    const closeScale = Math.max(medianPositive(absDevs), ref * 0.002);
    // Flat carry tapes make MAD tiny — only tighten below ratioCap when scale is meaningful.
    const scaleUseful = ref > 0 && closeScale >= ref * 0.01;

    if (closeClip && ref > 0) {
      let hiBound = ref * closeRatioCap;
      let loBound = ref / closeRatioCap;
      if (scaleUseful) {
        const absAllow = Math.max(closeMult * closeScale, ref * floorFrac);
        hiBound = Math.min(hiBound, ref + absAllow);
        loBound = Math.max(loBound, ref - absAllow);
      }
      loBound = Math.max(ref * 1e-9, loBound);
      const nextC = clampPrice(close, loBound, hiBound);
      const nextO = clampPrice(open, loBound, hiBound);
      if (nextC !== close || nextO !== open) outlier = true;
      close = nextC;
      open = nextO;
    }

    const bodyHi = Math.max(open, close);
    const bodyLo = Math.min(open, close);
    const mid = (open + close) / 2;
    const body = bodyHi - bodyLo;
    const from = Math.max(0, index - atrPeriod + 1);
    const window = robustRanges.slice(from, index + 1).filter((value) => value > 0);
    const robust = medianPositive(window);
    const mean = window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : 0;
    const scale = Math.max(
      robust,
      scaleUseful ? Math.min(mean, closeScale * closeMult) : 0,
      mid * 0.002,
      scaleUseful ? Math.min(body, closeScale * closeMult) : Math.min(body, mid * 0.05)
    );
    let maxWick = Math.max(
      atrMult * scale,
      bodyMult * Math.max(Math.min(body, scaleUseful ? closeScale * closeMult : mid * 0.05), mid * 0.001)
    );
    maxWick = Math.min(maxWick, mid * maxFrac);
    maxWick = Math.max(maxWick, mid * floorFrac);

    const hiCap = bodyHi + maxWick;
    const loCap = Math.max(mid * 1e-9, bodyLo - maxWick);
    let nextH = high > 0 ? Math.min(high, hiCap) : bodyHi;
    let nextL = low > 0 ? Math.max(low, loCap) : bodyLo;
    nextH = Math.max(nextH, bodyHi);
    nextL = Math.min(nextL, bodyLo);
    if (nextH !== high || nextL !== low) outlier = true;

    const out = {
      ...row,
      o: open,
      h: nextH,
      l: nextL,
      c: close,
    };
    if (outlier) {
      out.outlier = true;
      out.rawO = rawO;
      out.rawH = rawH > 0 ? rawH : rawC;
      out.rawL = rawL > 0 ? rawL : rawC;
      out.rawC = rawC;
    }
    return out;
  });
}

export function appendLiveClose(candles, price, at = Date.now(), intervalId = "1D") {
  if (!(Number(price) > 0)) return candles;
  const t = bucketTime(at, intervalId);
  if (t == null) return candles;
  const list = candles.map((row) => ({ ...row }));
  const last = list[list.length - 1];
  if (last && last.t === t) {
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    last.c = price;
    return list;
  }
  const open = last?.c > 0 ? last.c : price;
  list.push({
    t,
    o: open,
    h: Math.max(open, price),
    l: Math.min(open, price),
    c: price,
    v: 0,
    source: "live",
  });
  return list;
}

export function windowCandles(candles, rangeId, now = Date.now()) {
  if (!candles.length) return candles;
  if (rangeId === "Max") return candles;
  const days = {
    "1D": 1,
    "5D": 5,
    "1M": 30,
    "3M": 90,
    "6M": 180,
    "1Y": 365,
    "5Y": 365 * 5,
  }[rangeId];
  if (!days) return candles;
  const start = now - days * 86_400_000;
  const inside = candles.filter((row) => row.t >= start);
  if (inside.length) return inside;
  return candles.slice(-Math.max(2, days));
}

export function intervalMsOf(id) {
  return intervalMs(id);
}

const DAY_MS = 86_400_000;

export function candlesFromMarketData(rows = [], source = "inftf") {
  return (Array.isArray(rows) ? rows : [])
    .map((row) =>
      normalizeCandle(
        {
          t: Date.parse(row.timestamp || row.t || row.time),
          o: row.open ?? row.o,
          h: row.high ?? row.h,
          l: row.low ?? row.l,
          c: row.close ?? row.c,
          v: row.base_volume ?? row.vb ?? row.v ?? 0,
          source,
        },
        "1D"
      )
    )
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
}

export function fillDailyGaps(candles = [], fromMs, toMs) {
  const list = (Array.isArray(candles) ? candles : [])
    .map((row) => normalizeCandle(row, "1D"))
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
  if (!list.length) return [];
  const start = bucketTime(fromMs ?? list[0].t, "1D");
  const end = bucketTime(toMs ?? list[list.length - 1].t, "1D");
  if (start == null || end == null || end < start) return list;
  const map = new Map(list.map((row) => [row.t, row]));
  const out = [];
  let prev = null;
  for (let t = start; t <= end; t += DAY_MS) {
    const row = map.get(t);
    if (row) {
      prev = row;
      out.push(row);
    } else if (prev) {
      out.push({
        t,
        o: prev.c,
        h: prev.c,
        l: prev.c,
        c: prev.c,
        v: 0,
        source: "carry",
      });
    }
  }
  return out;
}
