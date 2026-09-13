export const DRIFT_MS = 1100;
export const DRIFT_POINTS = 200;

export function easeInOutCubic(t) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function lerpPair(from, to, t) {
  const a = Array.isArray(from) ? from : to;
  const b = Array.isArray(to) ? to : from;
  if (!a || !b) return b || a || [0, 1];
  return [lerp(Number(a[0]), Number(b[0]), t), lerp(Number(a[1]), Number(b[1]), t)];
}

function plotOf(row) {
  const value = Number(row?.plot);
  return Number.isFinite(value) ? value : null;
}

function tsOf(row) {
  const value = Number(row?.ts);
  return Number.isFinite(value) ? value : null;
}

function cleanPlot(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const ts = tsOf(row);
      const plot = plotOf(row);
      return ts == null || plot == null ? null : { ts, plot };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

// Fritsch–Carlson slopes so the morph stays monotone and does not overshoot.
function monotoneSlopes(list) {
  const n = list.length;
  const delta = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = list[i + 1].ts - list[i].ts || 1;
    delta[i] = (list[i + 1].plot - list[i].plot) / dx;
  }
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(delta[i]) < 1e-12) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const ss = a * a + b * b;
    if (ss > 9) {
      const tau = 3 / Math.sqrt(ss);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }
  return m;
}

function hermiteY(y0, y1, m0, m1, dx, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * y0 +
    (u3 - 2 * u2 + u) * dx * m0 +
    (-2 * u3 + 3 * u2) * y1 +
    (u3 - u2) * dx * m1
  );
}

export function resamplePlot(rows, count = DRIFT_POINTS) {
  const list = cleanPlot(rows);
  const size = Math.max(2, Number(count) || DRIFT_POINTS);
  if (!list.length) return [];
  if (list.length === 1) {
    return Array.from({ length: size }, () => ({ ...list[0] }));
  }

  const slopes = monotoneSlopes(list);
  const start = list[0].ts;
  const end = list[list.length - 1].ts;
  const span = Math.max(end - start, 1);
  const out = [];
  let j = 0;
  for (let i = 0; i < size; i += 1) {
    const ts = start + (span * i) / (size - 1);
    while (j < list.length - 2 && list[j + 1].ts < ts) j += 1;
    const a = list[j];
    const b = list[Math.min(j + 1, list.length - 1)];
    const dt = b.ts - a.ts || 1;
    const u = Math.min(1, Math.max(0, (ts - a.ts) / dt));
    const raw = hermiteY(a.plot, b.plot, slopes[j], slopes[j + 1] ?? slopes[j], dt, u);
    const lo = Math.min(a.plot, b.plot);
    const hi = Math.max(a.plot, b.plot);
    out.push({ ts, plot: Math.min(hi, Math.max(lo, raw)) });
  }
  return out;
}

export function driftPlot(fromRows, toRows, t, count = DRIFT_POINTS) {
  const progress = easeInOutCubic(t);
  const from = resamplePlot(fromRows, count);
  const to = resamplePlot(toRows, count);
  if (!from.length) return to;
  if (!to.length) return from;
  return from.map((a, i) => ({
    ts: lerp(a.ts, to[i].ts, progress),
    plot: lerp(a.plot, to[i].plot, progress),
  }));
}
