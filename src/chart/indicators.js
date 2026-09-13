export const RSI_PERIODS = [7, 9, 14, 21, 25];
export const RSI_OVERBOUGHT = [60, 70, 80];
export const RSI_OVERSOLD = [20, 30, 40];

export function rsi(closes = [], period = 14) {
  const values = Array.isArray(closes) ? closes.map((value) => Number(value)) : [];
  const n = Math.trunc(Number(period));
  const out = new Array(values.length).fill(null);
  if (!(n > 1) || values.length <= n) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = n + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (n - 1) + up) / n;
    avgLoss = (avgLoss * (n - 1) + down) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function rsiForWindow({ series = [], visible = [], period = 14 } = {}) {
  const values = rsi(
    (Array.isArray(series) ? series : []).map((row) => row.c),
    period
  );
  const byTime = new Map((Array.isArray(series) ? series : []).map((row, index) => [row.t, values[index]]));
  return (Array.isArray(visible) ? visible : []).map((row) => (byTime.has(row.t) ? byTime.get(row.t) : null));
}

export function smoothWave(values = [], period = 6) {
  const list = Array.isArray(values) ? values : [];
  const n = Math.max(1, Math.trunc(Number(period)) || 1);
  return list.map((_, index) => {
    const from = Math.max(0, index - n + 1);
    let sum = 0;
    let count = 0;
    for (let i = from; i <= index; i += 1) {
      sum += Number(list[i]) || 0;
      count += 1;
    }
    return count ? sum / count : 0;
  });
}

export function volumeWaveValues(candles = [], { smooth = 6 } = {}) {
  const list = Array.isArray(candles) ? candles : [];
  const raw = list.map((row) => Math.max(0, Number(row.v) || 0));
  const byDay = new Map();
  list.forEach((row, index) => {
    const day = Math.floor(Number(row.t) / 86_400_000);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(index);
  });
  const spread = raw.slice();
  for (const indexes of byDay.values()) {
    const total = indexes.reduce((sum, index) => sum + raw[index], 0);
    const hits = indexes.filter((index) => raw[index] > 0).length;
    if (total > 0 && hits === 1 && indexes.length > 1) {
      const each = total / indexes.length;
      for (const index of indexes) spread[index] = each;
    }
  }
  return smoothWave(spread, smooth);
}

export function maCurvePoints(candles = [], values = []) {
  const rows = [];
  for (let i = 0; i < candles.length; i += 1) {
    const v = Number(values[i]);
    if (!Number.isFinite(v) || !(v > 0) || !candles[i]) continue;
    rows.push({ t: candles[i].t, v });
  }
  if (rows.length < 3) return rows;
  const span = Math.max(...rows.map((row) => row.v)) - Math.min(...rows.map((row) => row.v));
  const eps = Math.max(span * 0.0008, 1e-12);
  const out = [rows[0]];
  for (let i = 1; i < rows.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const cur = rows[i];
    const next = rows[i + 1];
    const flat = Math.abs(cur.v - prev.v) <= eps && Math.abs(next.v - cur.v) <= eps;
    if (flat) continue;
    out.push(cur);
  }
  const last = rows[rows.length - 1];
  if (out[out.length - 1].t !== last.t) out.push(last);
  return out;
}

export function maRevealState(id, { seen, armed } = {}) {
  const key = String(id || "");
  const isArmed = Array.isArray(armed) && armed.includes(key);
  const seenIds = seen instanceof Set ? seen : new Set(Array.isArray(seen) ? seen : []);
  const isSeen = seenIds.has(key);
  if (!isSeen && !isArmed) return "wait";
  if (isArmed) return "drawing";
  return "ready";
}

export function extendMaPoints(points = [], { right, top, bottom } = {}) {
  const rows = (Array.isArray(points) ? points : []).filter(
    (row) => Number.isFinite(row?.x) && Number.isFinite(row?.y)
  );
  if (!rows.length) return [];
  const lo = Number.isFinite(top) ? top : -Infinity;
  const hi = Number.isFinite(bottom) ? bottom : Infinity;
  const out = rows.map((row) => ({
    x: row.x,
    y: Math.min(hi, Math.max(lo, row.y)),
  }));
  const last = out[out.length - 1];
  if (Number.isFinite(right) && last.x < right - 0.5) {
    out.push({ x: right, y: last.y });
  }
  return out;
}

export function maPath(points = []) {
  const rows = [];
  for (const row of Array.isArray(points) ? points : []) {
    if (!Number.isFinite(row?.x) || !Number.isFinite(row?.y)) continue;
    const last = rows[rows.length - 1];
    if (last && row.x <= last.x) continue;
    rows.push(row);
  }
  if (!rows.length) return "";
  if (rows.length === 1) return `M${rows[0].x} ${rows[0].y}`;
  if (rows.length === 2) return `M${rows[0].x} ${rows[0].y} L${rows[1].x} ${rows[1].y}`;

  const n = rows.length;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    const span = rows[i + 1].x - rows[i].x;
    dx[i] = span;
    slope[i] = span ? (rows[i + 1].y - rows[i].y) / span : 0;
  }
  const tan = new Array(n);
  tan[0] = slope[0];
  tan[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    tan[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(slope[i]) < 1e-12) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i];
    const b = tan[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tan[i] = k * a * slope[i];
      tan[i + 1] = k * b * slope[i];
    }
  }

  let d = `M${rows[0].x} ${rows[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = rows[i];
    const p1 = rows[i + 1];
    const h = dx[i];
    d += ` C${p0.x + h / 3} ${p0.y + (tan[i] * h) / 3} ${p1.x - h / 3} ${p1.y - (tan[i + 1] * h) / 3} ${p1.x} ${p1.y}`;
  }
  return d;
}

export function wavePath(points = [], { tension = 1 } = {}) {
  const rows = Array.isArray(points) ? points.filter((row) => Number.isFinite(row?.x) && Number.isFinite(row?.y)) : [];
  if (!rows.length) return "";
  const k = 6 / Math.max(0.4, Number(tension) || 1);
  let d = `M${rows[0].x} ${rows[0].y}`;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const p0 = rows[i - 1] || rows[i];
    const p1 = rows[i];
    const p2 = rows[i + 1];
    const p3 = rows[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / k;
    const c1y = p1.y + (p2.y - p0.y) / k;
    const c2x = p2.x - (p3.x - p1.x) / k;
    const c2y = p2.y - (p3.y - p1.y) / k;
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

export function waveArea(points = [], baseline) {
  const line = wavePath(points);
  if (!line || !points.length || !Number.isFinite(baseline)) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L${last.x} ${baseline} L${first.x} ${baseline} Z`;
}
