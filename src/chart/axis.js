import {bucketTime, isDailyOrLonger} from "./intervals.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_STEPS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, HOUR_MS, 4 * HOUR_MS];

export function niceStep(span, count = 6) {
  const raw = Number(span) / Math.max(2, Number(count) - 1);
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * mag).find((n) => n >= raw);
  return step || raw;
}

export function priceTicks(min, max, count = 6) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi <= lo) return [lo];
  const step = niceStep(hi - lo, count);
  if (!(step > 0)) return [lo, hi];
  const start = Math.ceil((lo - step * 1e-9) / step) * step;
  const ticks = [];
  for (let value = start; value <= hi + step * 1e-9; value += step) {
    ticks.push(Number(value.toPrecision(12)));
    if (ticks.length > 12) break;
  }
  return ticks.length ? ticks : [lo, hi];
}

function monthStartUtc(year, month) {
  return Date.UTC(year, month, 1);
}

function monthTicks(start, end, stepMonths) {
  const first = new Date(start);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  if (first.getUTCDate() !== 1 || first.getUTCHours() || first.getUTCMinutes()) {
    month += 1;
  }
  month = Math.ceil(month / stepMonths) * stepMonths;
  if (month > 11) {
    year += Math.floor(month / 12);
    month %= 12;
  }
  const ticks = [];
  for (;;) {
    const t = monthStartUtc(year, month);
    if (t > end) break;
    if (t >= start) ticks.push(t);
    month += stepMonths;
    if (month > 11) {
      year += Math.floor(month / 12);
      month %= 12;
    }
    if (ticks.length > 14) break;
  }
  return ticks;
}

function steppedTicks(start, end, step, align = (t) => Math.ceil(t / step) * step) {
  if (!(step > 0)) return [];
  const ticks = [];
  for (let t = align(start); t <= end; t += step) {
    if (t >= start) ticks.push(t);
    if (ticks.length > 14) break;
  }
  return ticks;
}

export function equalGrid(count, start, length) {
  const n = Math.max(1, Math.trunc(Number(count) || 1));
  const origin = Number(start) || 0;
  const span = Number(length) || 0;
  return Array.from({ length: n + 1 }, (_, index) => origin + (span * index) / n);
}

export function plotViewKey(candles = [], { left = 0, width = 0, extra = 0 } = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  return [
    rows[0]?.t ?? 0,
    rows[rows.length - 1]?.t ?? 0,
    rows.length,
    Math.max(0, Math.trunc(Number(extra) || 0)),
    Math.round(Number(left) || 0),
    Math.round(Number(width) || 0),
  ].join(":");
}

export function barSlots(candles = [], { left = 0, width = 0, extra = 0, step = 0 } = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const pad = Math.max(0, Math.trunc(Number(extra) || 0));
  const real = rows.length;
  const n = Math.max(1, real + pad);
  const slot = (Number(width) || 0) / n;
  const times = rows.map((row) => Number(row.t));
  if (real > 0 && pad > 0) {
    const last = times[real - 1];
    const span = real >= 2 ? times[real - 1] - times[real - 2] || Number(step) || 1 : Number(step) > 0 ? Number(step) : 1;
    for (let i = 1; i <= pad; i += 1) times.push(last + i * span);
  }

  function timeAtIndex(index) {
    if (!times.length) return 0;
    if (n === 1) return times[0];
    if (index <= 0) {
      const span = times[1] - times[0] || 1;
      return times[0] + index * span;
    }
    if (index >= n - 1) {
      const span = times[n - 1] - times[n - 2] || 1;
      return times[n - 1] + (index - (n - 1)) * span;
    }
    const i = Math.floor(index);
    const f = index - i;
    return times[i] + f * (times[i + 1] - times[i]);
  }

  function indexAtTime(time) {
    if (!times.length) return 0;
    if (n === 1) return 0;
    if (time <= times[0]) {
      const span = times[1] - times[0] || 1;
      return (time - times[0]) / span;
    }
    if (time >= times[n - 1]) {
      const span = times[n - 1] - times[n - 2] || 1;
      return n - 1 + (time - times[n - 1]) / span;
    }
    let i = 0;
    while (i < n - 1 && times[i + 1] < time) i += 1;
    const span = times[i + 1] - times[i] || 1;
    return i + (time - times[i]) / span;
  }

  return {
    n,
    slot,
    last: times[times.length - 1] || 0,
    x(t) {
      if (!times.length) return left;
      return left + (indexAtTime(Number(t)) + 0.5) * slot;
    },
    tAt(x) {
      const index = (Number(x) - left) / Math.max(slot, 1e-9) - 0.5;
      return timeAtIndex(index);
    },
    ticks(count = 6) {
      if (!times.length) return [];
      const want = Math.min(Math.max(2, Number(count) || 6), times.length);
      if (times.length <= want) return times.slice();
      const step = (times.length - 1) / (want - 1);
      return Array.from({ length: want }, (_, index) => times[Math.round(index * step)]);
    },
  };
}

export function timeTicks(start, end, { count = 6, intervalId = "1D" } = {}) {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  if (to <= from) return [from];
  const span = to - from;
  const target = span / Math.max(2, Number(count) - 1);

  if (target >= 80 * DAY_MS) return monthTicks(from, to, target >= 200 * DAY_MS ? 12 : 3);
  if (target >= 20 * DAY_MS) return monthTicks(from, to, 1);
  if (target >= 4 * DAY_MS) {
    return steppedTicks(from, to, 7 * DAY_MS, (t) => bucketTime(t, "1W") ?? t);
  }
  if (target >= 10 * HOUR_MS || isDailyOrLonger(intervalId)) {
    return steppedTicks(from, to, DAY_MS, (t) => bucketTime(t, "1D") ?? t);
  }
  const step = MINUTE_STEPS.find((ms) => ms >= target) || MINUTE_STEPS[MINUTE_STEPS.length - 1];
  return steppedTicks(from, to, step);
}

export function clientToSvg(svg, clientX, clientY, viewW, viewH) {
  if (svg && typeof svg.getScreenCTM === "function") {
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        return { x: point.x, y: point.y };
      }
    }
  }
  const rect = svg?.getBoundingClientRect?.();
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * Number(viewW),
    y: ((clientY - rect.top) / rect.height) * Number(viewH),
  };
}

export function formatPriceLabel(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(6);
}

/** Nice axis labels: 10s / 100s / 1000s steps, dollar-style 1 / 1.1 / 1.2. */
export function formatAxisPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "0";
  const abs = Math.abs(num);
  if (abs >= 1000) return String(Math.round(num));
  if (abs >= 100) {
    const one = Math.round(num * 10) / 10;
    if (Math.abs(one - Math.round(one)) < 1e-9) return String(Math.round(one));
    return one.toFixed(1);
  }
  if (abs >= 1) {
    return num.toFixed(2).replace(/\.?0+$/, "");
  }
  const digits = Math.max(2, Math.min(8, Math.ceil(-Math.log10(abs)) + 1));
  return num.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export function priceLabelWidth(label) {
  const text = String(label || "");
  return Math.max(28, Math.ceil(text.length * 6.2 + 10));
}

export function formatAxisTime(t, { spanMs = 30 * DAY_MS, intervalId = "1D", locale = "en" } = {}) {
  const date = new Date(t);
  if (Number.isNaN(date.getTime())) return "—";
  const span = Number(spanMs) || 0;
  if (span >= 80 * DAY_MS) {
    return date.toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (span >= 2 * DAY_MS || isDailyOrLonger(intervalId)) {
    return date.toLocaleDateString(locale, { day: "2-digit", month: "short", timeZone: "UTC" });
  }
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

export function axisLabelX(x, { min, max } = {}) {
  const value = Number(x);
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return value;
  return Math.min(hi, Math.max(lo, value));
}

export function timeTagWidth(label) {
  const text = String(label || "");
  return Math.max(108, Math.ceil(text.length * 6.1 + 16));
}

export function timeTagOrigin(x, width, { left = 0, right = 0 } = {}) {
  const tagW = Number(width) || 0;
  const at = Number(x);
  const min = Number(left) + tagW / 2;
  const max = Number(right) - tagW / 2;
  const center = Number.isFinite(at) ? at : min;
  const mid = max > min ? Math.min(max, Math.max(min, center)) : center;
  return { x: mid - tagW / 2, width: tagW, textX: tagW / 2 };
}

export function formatCursorWhen(t, locale = "en") {
  const date = new Date(t);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}
