/**
 * AIM desk / estimate overlays shared by HybridChart (ASCII-safe labels).
 */
export const AIM_DESK_AGENT_COLORS = {
  agent1: "#38bdf8",
  agent2: "#a78bfa",
  agent3: "#34d399",
  agent4: "#fb923c",
  agent5: "#f472b6",
  agent6: "#94a3b8",
  commander: "#fbbf24",
};

const QPB_MIN = 0.05;
const QPB_MAX = 50;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function inQuotePerBaseBand(v) {
  const n = num(v);
  return n > 0 && n >= QPB_MIN && n <= QPB_MAX;
}

export function coerceQuotePerBase(raw, row = {}, refPx = null) {
  const v = num(raw);
  if (!(v > 0)) return null;
  const unit = String(row.price_unit || "").toLowerCase();
  const candidates = [];
  if (unit === "quote_per_base" || unit === "iou_per_xrp" || unit === "rlusd_per_xrp") {
    candidates.push(v);
  } else if (unit === "xrp_per_iou" || row.xrp_per_iou != null) {
    candidates.push(1 / v);
  } else {
    candidates.push(v, 1 / v);
  }
  const ref = num(refPx);
  const ok = (c) => {
    if (!inQuotePerBaseBand(c)) return false;
    if (ref > 0) {
      if (c < ref / 20 || c > ref * 20) return false;
    }
    return true;
  };
  for (const c of candidates) {
    if (ok(c)) return c;
  }
  return null;
}

export function quotePerBaseFromDeskOrder(row = {}, refPx = null) {
  const iou = num(row.iou_per_xrp);
  if (inQuotePerBaseBand(iou)) {
    const ref = num(refPx);
    if (!(ref > 0) || (iou >= ref / 20 && iou <= ref * 20)) return iou;
  }
  const unit = String(row.price_unit || "").toLowerCase();
  const raw = num(row.limit_price ?? row.price ?? row.xrp_per_iou ?? row.mark);
  return coerceQuotePerBase(raw, { ...row, price_unit: unit }, refPx);
}

export function normalizeDeskSide(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return "buy";
  if (s.includes("sell") || s.includes("ask") || s === "to_xrp" || s.includes("sell_")) return "sell";
  if (s.includes("buy") || s.includes("bid") || s === "from_xrp") return "buy";
  return "buy";
}

function samePair(a, b) {
  const left = String(a || "").replace(/\s+/g, "").toUpperCase();
  const right = String(b || "").replace(/\s+/g, "").toUpperCase();
  if (!left || !right) return true;
  if (left === right) return true;
  const [rb, rq] = right.split("/");
  return left === `${rq}/${rb}`;
}

export function asciiClean(v) {
  return String(v || "")
    .replace(/[\u2010-\u2015\u2212\u00B7\u2022\u2026\uFFFD]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const BUY_DOT = "#26a69a";
const SELL_DOT = "#ef5350";

/**
 * Filled = solid; resting/open/proposal = faded hollow.
 */
export function classifyDeskMarkStyle(row = {}) {
  const status = String(row.status || "").toLowerCase();
  const submitted = Boolean(row.submitted) || status === "submitted" || status === "filled" || status === "fill" || status === "executed";
  if (submitted) return "filled";
  return "resting";
}

export function deskMarkColor(side) {
  return normalizeDeskSide(side) === "sell" ? SELL_DOT : BUY_DOT;
}

/** Brand violet for touch/overlap desk-mark clusters (zoom-in cue). Never use commander yellow on desk dots. */
export const DESK_CLUSTER_PURPLE = "#c770ff";
export const DESK_CLUSTER_TOOLTIP = "Tight cluster. Zoom in for detail.";

/** Visual radius of the painted desk dot (matches HybridPlot). */
export function deskMarkDotRadius(mark = {}) {
  const resting = mark.style === "resting" || mark.resting;
  return resting ? 4.2 : 3.6;
}

/**
 * Screen-space touch clusters: centres within r_i + r_j form an edge;
 * any connected component of size >= 2 is a tight cluster.
 * @param {{ x:number, y:number, r?:number }[]} points
 * @returns {boolean[]} true when that index is in a touch cluster
 */
export function deskMarkTouchClusterFlags(points = []) {
  const n = Array.isArray(points) ? points.length : 0;
  const flags = Array(n).fill(false);
  if (n < 2) return flags;
  const rOf = (p) => {
    const r = Number(p?.r);
    return Number.isFinite(r) && r > 0 ? r : 3.6;
  };
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (y !== x) {
      const next = parent[y];
      parent[y] = x;
      y = next;
    }
    return x;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
    const ra = rOf(a);
    for (let j = i + 1; j < n; j += 1) {
      const b = points[j];
      const bx = Number(b?.x);
      const by = Number(b?.y);
      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;
      const rb = rOf(b);
      const dx = ax - bx;
      const dy = ay - by;
      const lim = ra + rb;
      if (dx * dx + dy * dy <= lim * lim) unite(i, j);
    }
  }
  const sizes = Object.create(null);
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    sizes[root] = (sizes[root] || 0) + 1;
  }
  for (let i = 0; i < n; i += 1) {
    if (sizes[find(i)] >= 2) flags[i] = true;
  }
  return flags;
}

/**
 * Resolve paint color for a desk mark after cluster detection.
 * Isolated marks keep green/red; touch-cluster members go purple.
 */
export function deskMarkPaintColor(mark = {}, inCluster = false) {
  if (inCluster) return DESK_CLUSTER_PURPLE;
  return mark.color || deskMarkColor(mark.side);
}

function pickTactic(row = {}) {
  return asciiClean(
    row.tactic ||
      row.playbook ||
      row.urgency ||
      row.xrp_thesis ||
      row.skill_summary ||
      row.action ||
      row.rationale ||
      ""
  );
}

/**
 * Desk OfferCreate / fill marks for the active chart pair only.
 * Minimal dots: solid green/red fills, faded hollow resting offers. No agent colours on plot.
 */
export function buildDeskMarks(deskOrders = [], pair = "XRP/RLUSD", refPx = null) {
  return (Array.isArray(deskOrders) ? deskOrders : [])
    .map((row, idx) => {
      const price = quotePerBaseFromDeskOrder(row, refPx);
      if (!(price > 0)) return null;
      const rowPair = String(row.pair || pair).replace(/\s+/g, "").toUpperCase();
      if (rowPair && !samePair(rowPair, pair)) return null;
      const agentId = row.agent_id || row.agent || row.id || "agent";
      const side = normalizeDeskSide(row.side || row.limit_side || row.trade_direction);
      const status = row.status || (row.submitted ? "submitted" : row.open ? "open" : "proposal");
      const style = classifyDeskMarkStyle({ ...row, status, submitted: row.submitted });
      const tactic = pickTactic(row);
      const tRaw = row.t ?? row.timestamp ?? row.filled_at ?? row.created_at ?? row.when ?? null;
      const t = tRaw == null ? null : Number.isFinite(Number(tRaw)) ? Number(tRaw) : Date.parse(tRaw);
      return {
        kind: "desk",
        key: row.key || `${agentId}-${side}-${price}-${style}-${idx}`,
        agent_id: agentId,
        label: asciiClean(row.label || agentId || "Desk"),
        side,
        price,
        status,
        style,
        filled: style === "filled",
        resting: style === "resting",
        color: deskMarkColor(side),
        pair: String(pair || rowPair || "").replace(/\s+/g, "").toUpperCase() || "XRP/RLUSD",
        tactic: tactic || null,
        playbook: asciiClean(row.playbook || row.xrp_thesis || row.skill_summary || "") || null,
        urgency: asciiClean(row.urgency || "") || null,
        action: asciiClean(row.action || "") || null,
        t: Number.isFinite(t) ? t : null,
      };
    })
    .filter(Boolean);
}

/** ASCII prompt for Commander when a desk mark is clicked (no em/en dashes). */
export function deskMarkAskPrompt(mark = {}, { pair } = {}) {
  if (!mark || !(Number(mark.price) > 0)) return "";
  const side = normalizeDeskSide(mark.side);
  const px = Number(mark.price);
  const pairLabel = asciiClean(mark.pair || pair || "XRP/RLUSD");
  const agent = asciiClean(mark.agent_id || mark.label || "agent");
  const style = mark.style || classifyDeskMarkStyle(mark);
  const bits = [
    `Explain the AIM chart mark for agent ${agent}.`,
    `Pair ${pairLabel}, ${side} at ${px}.`,
    style === "filled" ? "This is a filled trade (solid mark)." : "This is a resting offer (faded hollow mark).",
  ];
  if (mark.tactic) bits.push(`Tactic or playbook hint: ${mark.tactic}.`);
  if (mark.playbook && mark.playbook !== mark.tactic) bits.push(`Playbook: ${mark.playbook}.`);
  if (mark.urgency) bits.push(`Urgency: ${mark.urgency}.`);
  if (mark.action) bits.push(`Action: ${mark.action}.`);
  bits.push("Which agent placed it and what tactic or playbook put the order or fill there?");
  return asciiClean(bits.join(" "));
}

/**
 * Commander estimate level markers (no bull/bear scenario UI).
 */
export function buildEstimateMarks(estimate = null, timeframe = "1D", tapeRef = null) {
  if (!estimate || typeof estimate !== "object") return [];
  const byTf = estimate.by_tf || estimate.overlays?.by_tf || {};
  const tfPack = byTf[timeframe] || byTf["1h"] || byTf["1D"] || null;
  const overlays = estimate.overlays && typeof estimate.overlays === "object" ? estimate.overlays : null;
  const levels = tfPack?.levels || overlays?.levels || {};
  const unitRow = {
    price_unit: estimate.price_unit || "quote_per_base",
    iou_per_xrp: estimate.iou_per_xrp,
    xrp_per_iou: estimate.xrp_per_iou,
  };
  const out = [];
  const push = (role, raw, label) => {
    const price = coerceQuotePerBase(raw, unitRow, tapeRef);
    if (!(price > 0)) return;
    out.push({ kind: "estimate", role, price, label: asciiClean(label) });
  };
  push("fair", estimate.fair_mid ?? estimate.mid ?? estimate.fair ?? estimate.iou_per_xrp, "Fair");
  push("entry", estimate.entry ?? levels.entry, "Entry");
  push("sl", estimate.sl ?? estimate.stop ?? estimate.stop_loss ?? levels.sl, "SL");
  push("tp", estimate.tp ?? estimate.take_profit ?? levels.tp, "TP");
  push("support", estimate.support ?? levels.support, "Support");
  push("resistance", estimate.resistance ?? levels.resistance, "Resist");
  const lo = coerceQuotePerBase(estimate.band_lo ?? estimate.fair_lo ?? levels.band_lo, unitRow, tapeRef);
  const hi = coerceQuotePerBase(estimate.band_hi ?? estimate.fair_hi ?? levels.band_hi, unitRow, tapeRef);
  if (lo > 0) out.push({ kind: "estimate", role: "band_lo", price: lo, label: "Band" });
  if (hi > 0) out.push({ kind: "estimate", role: "band_hi", price: hi, label: "Band" });
  return out;
}

/**
 * Bull/bear projection path + demand/supply boxes from commander_estimate by_tf pack.
 * side: "bull" | "bear"
 */
export function buildEstimateScenarioOverlay(estimate = null, timeframe = "1D", side = "bull", tapeRef = null) {
  if (!estimate || typeof estimate !== "object") return null;
  const want = String(side || "bull").toLowerCase().startsWith("bear") ? "bear" : "bull";
  const byTf = estimate.by_tf || estimate.overlays?.by_tf || {};
  const tfPack = byTf[timeframe] || byTf["1h"] || byTf["1D"] || byTf["15m"] || byTf["5m"] || null;
  const scenario = want === "bull"
    ? (tfPack?.bullish || estimate.bullish || null)
    : (tfPack?.bearish || estimate.bearish || null);
  const proj =
    (want === "bull"
      ? tfPack?.projection_bull || scenario?.projection || estimate.projection_bull
      : tfPack?.projection_bear || scenario?.projection || estimate.projection_bear) || null;
  const demand = (want === "bull"
    ? (scenario?.demand || tfPack?.demand || estimate.demand || [])
    : (scenario?.demand || [])) || [];
  const supply = (want === "bear"
    ? (scenario?.supply || tfPack?.supply || estimate.supply || [])
    : (scenario?.supply || [])) || [];
  const unitRow = {
    price_unit: estimate.price_unit || "quote_per_base",
    iou_per_xrp: estimate.iou_per_xrp,
    xrp_per_iou: estimate.xrp_per_iou,
  };
  const zones = [];
  for (const z of (Array.isArray(demand) ? demand : []).slice(0, 3)) {
    const lo = coerceQuotePerBase(z?.lo, unitRow, tapeRef);
    const hi = coerceQuotePerBase(z?.hi, unitRow, tapeRef);
    if (!(lo > 0) || !(hi > 0)) continue;
    zones.push({ kind: "demand", lo: Math.min(lo, hi), hi: Math.max(lo, hi), strength: Number(z?.strength) || 1 });
  }
  for (const z of (Array.isArray(supply) ? supply : []).slice(0, 3)) {
    const lo = coerceQuotePerBase(z?.lo, unitRow, tapeRef);
    const hi = coerceQuotePerBase(z?.hi, unitRow, tapeRef);
    if (!(lo > 0) || !(hi > 0)) continue;
    zones.push({ kind: "supply", lo: Math.min(lo, hi), hi: Math.max(lo, hi), strength: Number(z?.strength) || 1 });
  }
  const path = [];
  for (const pt of (proj?.path || [])) {
    const mid = coerceQuotePerBase(pt?.mid, unitRow, tapeRef);
    const lo = coerceQuotePerBase(pt?.lo, unitRow, tapeRef);
    const hi = coerceQuotePerBase(pt?.hi, unitRow, tapeRef);
    if (!(mid > 0)) continue;
    path.push({
      i: Number(pt?.i) || path.length + 1,
      mid,
      lo: lo > 0 ? lo : null,
      hi: hi > 0 ? hi : null,
    });
  }
  if (!path.length && !zones.length) return null;
  return {
    side: want,
    label: asciiClean(proj?.label || "Estimate by REMOVED-AI-Matrix"),
    disclaimer: "not guaranteed",
    path,
    zones,
    bars: Number(proj?.bars) || path.length || 0,
  };
}
