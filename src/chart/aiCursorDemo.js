/** Pure helpers for Commander AI cursor demo on HybridChart (ASCII-safe). */

export function easeInOutCubic(t) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function lerp(a, b, t) {
  return Number(a) + (Number(b) - Number(a)) * easeInOutCubic(t);
}

export function drawingPlacementPoints(row) {
  if (!row || typeof row !== "object") return [];
  const kind = String(row.kind || "");
  if (kind === "hline" || kind === "hray" || kind === "pricelabel") {
    if (!Number.isFinite(Number(row.price))) return [];
    return [{ t: Number(row.t) || 0, price: Number(row.price) }];
  }
  if (kind === "vline") {
    if (!Number.isFinite(Number(row.t))) return [];
    return [{ t: Number(row.t), price: Number(row.price) || 0 }];
  }
  const pts = [];
  if (row.a && Number.isFinite(Number(row.a.t)) && Number.isFinite(Number(row.a.price))) pts.push({ t: Number(row.a.t), price: Number(row.a.price) });
  if (row.b && Number.isFinite(Number(row.b.t)) && Number.isFinite(Number(row.b.price))) pts.push({ t: Number(row.b.t), price: Number(row.b.price) });
  if (row.c && Number.isFinite(Number(row.c.t)) && Number.isFinite(Number(row.c.price))) pts.push({ t: Number(row.c.t), price: Number(row.c.price) });
  if (Array.isArray(row.points)) {
    for (const p of row.points) {
      if (p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.price))) pts.push({ t: Number(p.t), price: Number(p.price) });
    }
  }
  return pts;
}

export function toolIdForDrawing(row) {
  const kind = String(row?.kind || "");
  if (kind === "fib" || kind === "fibext" || kind === "trend" || kind === "hline" || kind === "hray" || kind === "ray" || kind === "extended") return kind;
  return kind || "trend";
}

/** Build a cancelable step runner. Returns { cancel, done }. */
export function runAiCursorScript(steps, { onFrame, onStep, signal } = {}) {
  let cancelled = false;
  let timer = null;
  const done = (async () => {
    for (let i = 0; i < steps.length; i += 1) {
      if (cancelled || signal?.aborted) break;
      const step = steps[i];
      if (typeof onStep === "function") {
        try {
          onStep(step, i);
        } catch {
          /* ignore */
        }
      }
      const ms = Math.max(0, Number(step.ms) || 0);
      if (step.type === "move" && ms > 0) {
        const from = step.from || { x: 0, y: 0 };
        const to = step.to || from;
        const t0 = performance.now();
        await new Promise((resolve) => {
          function frame(now) {
            if (cancelled || signal?.aborted) {
              resolve();
              return;
            }
            const u = Math.min(1, (now - t0) / ms);
            const x = lerp(from.x, to.x, u);
            const y = lerp(from.y, to.y, u);
            if (typeof onFrame === "function") onFrame({ x, y, step, u });
            if (u >= 1) resolve();
            else timer = requestAnimationFrame(frame);
          }
          timer = requestAnimationFrame(frame);
        });
      } else if (ms > 0) {
        await new Promise((resolve) => {
          timer = setTimeout(resolve, ms);
        });
      }
    }
  })();
  return {
    cancel() {
      cancelled = true;
      if (timer != null) {
        try {
          cancelAnimationFrame(timer);
        } catch {
          /* ignore */
        }
        try {
          clearTimeout(timer);
        } catch {
          /* ignore */
        }
      }
    },
    done,
  };
}

export function approxPlotClientPoint(plotEl, candles, view, point, priceHeight) {
  if (!plotEl || !point) return null;
  const rect = plotEl.getBoundingClientRect();
  const PAD = { l: 8, r: 18, t: 16, b: 36 };
  const innerW = Math.max(1, rect.width - PAD.l - PAD.r);
  const priceH = Number(priceHeight) > 40 ? Number(priceHeight) : Math.max(80, rect.height - PAD.t - PAD.b - 40);
  const rows = Array.isArray(candles) ? candles.filter((c) => Number.isFinite(Number(c?.t))) : [];
  const t0 = rows.length ? Number(rows[0].t) : Number(point.t);
  const t1 = rows.length ? Number(rows[rows.length - 1].t) : Number(point.t) + 1;
  const spanT = Math.max(1, t1 - t0);
  const min = Number(view?.min);
  const max = Number(view?.max);
  const spanP = Number.isFinite(min) && Number.isFinite(max) && max > min ? max - min : Math.max(1e-9, Math.abs(Number(point.price) || 1) * 0.02);
  const lo = Number.isFinite(min) ? min : Number(point.price) - spanP / 2;
  const hi = Number.isFinite(max) ? max : Number(point.price) + spanP / 2;
  const nx = (Number(point.t) - t0) / spanT;
  const ny = (hi - Number(point.price)) / Math.max(1e-12, hi - lo);
  return {
    x: rect.left + PAD.l + Math.min(1.05, Math.max(-0.05, nx)) * innerW,
    y: rect.top + PAD.t + Math.min(1.05, Math.max(-0.05, ny)) * priceH,
  };
}

export function clientToOverlay(overlayEl, client) {
  if (!overlayEl || !client) return null;
  const rect = overlayEl.getBoundingClientRect();
  return { x: client.x - rect.left, y: client.y - rect.top };
}
