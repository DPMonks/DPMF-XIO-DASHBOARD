import {XIO_ISSUED_AT, XIO_XRPL_TO_MD5} from "./constants/ledger.js";

export const ACTIVITY_PLOT_POINTS = 400;
export const RECENT_SCAN_DAYS = 14;

export function xrplToHolderGraphUrl(range = "ALL") {
  const suffix = range ? `?range=${encodeURIComponent(range)}` : "";
  return `https://api.xrpl.to/v1/holders/graph/${XIO_XRPL_TO_MD5}${suffix}`;
}

export function needsFullIssuanceHistory(rows) {
  if (!Array.isArray(rows) || rows.length < 50) return true;
  const first = new Date(rows[0]?.timestamp || rows[0]?.ts || 0).getTime();
  const issued = new Date(XIO_ISSUED_AT).getTime();
  return !Number.isFinite(first) || first > issued + 14 * 86400000;
}

export function metricNumber(row, metric) {
  const raw =
    metric === "traders"
      ? row?.traders ?? row?.trader_count ?? row?.trades
      : metric === "trustlines"
        ? row?.trustlines ?? row?.trustline_count
        : row?.holders ?? row?.holder_count;
  if (raw == null || raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export function utcDayKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function rowsFromXrplToGraph(payload) {
  const history = Array.isArray(payload?.history)
    ? payload.history
    : Array.isArray(payload)
      ? payload
      : [];
  const rows = [];
  for (const point of history) {
    const ms = Number(point?.time ?? point?.timestamp);
    if (!Number.isFinite(ms)) continue;
    const timestamp = new Date(ms > 1e12 ? ms : ms * 1000).toISOString();
    const holders = Number(point?.holders);
    const trustlines = Number(point?.length ?? point?.trustlines);
    const traders = Number(point?.active24H ?? point?.traders);
    if (!(holders > 0) && !(trustlines > 0) && !(traders > 0)) continue;
    rows.push({
      timestamp,
      holders: holders > 0 ? holders : null,
      holder_count: holders > 0 ? holders : null,
      trustlines: trustlines > 0 ? trustlines : null,
      trustline_count: trustlines > 0 ? trustlines : null,
      traders: Number.isFinite(traders) ? traders : null,
      trader_count: Number.isFinite(traders) ? traders : null,
      source: "issued",
    });
  }
  return rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function mergeActivityRows(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (!row || typeof row !== "object") continue;
      const timestamp = row.timestamp || row.day || row.date;
      if (!timestamp) continue;
      const iso = new Date(timestamp).toISOString();
      if (!Number.isFinite(new Date(iso).getTime())) continue;
      const current = merged.get(iso) || { timestamp: iso };
      const holders = metricNumber(row, "holders");
      const trustlines = metricNumber(row, "trustlines");
      const traders = metricNumber(row, "traders");
      if (holders != null && holders > 0) {
        current.holders = holders;
        current.holder_count = holders;
      }
      if (trustlines != null && trustlines > 0) {
        current.trustlines = trustlines;
        current.trustline_count = trustlines;
      }
      if (traders != null) {
        current.traders = traders;
        current.trader_count = traders;
      }
      if (row.source && !current.source) current.source = row.source;
      merged.set(iso, current);
    }
  }
  return [...merged.values()].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
}

// XIO history only: xrpl.to issuance series plus a live tip. Do not merge
// token_holders_history scan timestamps — those are when rows entered our DB.
export function issuedActivitySeries(issuedRows, live = null) {
  const issued = Array.isArray(issuedRows) ? issuedRows : [];
  if (!live || typeof live !== "object") return mergeActivityRows(issued);
  const liveTs = new Date(live.timestamp || Date.now()).getTime();
  const last = issued[issued.length - 1];
  const lastTs = last ? new Date(last.timestamp).getTime() : 0;
  if (!Number.isFinite(liveTs)) return mergeActivityRows(issued);
  if (issued.length && Number.isFinite(lastTs) && liveTs < lastTs) {
    return mergeActivityRows(issued);
  }
  return mergeActivityRows(issued, [live]);
}

export function carryActivityMetrics(rows = []) {
  let holders = null;
  let trustlines = null;
  let traders = null;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const nextHolders = metricNumber(row, "holders");
    const nextTrustlines = metricNumber(row, "trustlines");
    const nextTraders = metricNumber(row, "traders");
    if (nextHolders != null) holders = nextHolders;
    if (nextTrustlines != null) trustlines = nextTrustlines;
    if (nextTraders != null) traders = nextTraders;
    return {
      ...row,
      holders,
      holder_count: holders,
      trustlines,
      trustline_count: trustlines,
      traders,
      trader_count: traders,
    };
  });
}

export function collapseUnchangedPlot(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < 3) return list;
  const out = [list[0]];
  for (let i = 1; i < list.length - 1; i += 1) {
    const prev = list[i - 1];
    const cur = list[i];
    const next = list[i + 1];
    if (cur?.plot === prev?.plot && cur?.plot === next?.plot) continue;
    out.push(cur);
  }
  out.push(list[list.length - 1]);
  return out;
}

export function downsampleSeries(rows, maxPoints = ACTIVITY_PLOT_POINTS) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= maxPoints) return list;
  const out = [];
  const last = list.length - 1;
  const seen = new Set();
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i * last) / (maxPoints - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(list[index]);
  }
  if (out[out.length - 1] !== list[last]) out.push(list[last]);
  return out;
}

export function dailyLastPoints(rows) {
  const byDay = new Map();
  for (const row of rows || []) {
    const key = utcDayKey(row.timestamp || row.ts || row.day);
    if (!key) continue;
    byDay.set(key, row);
  }
  return [...byDay.values()].sort((a, b) => {
    const left = new Date(a.timestamp || a.ts || a.day).getTime();
    const right = new Date(b.timestamp || b.ts || b.day).getTime();
    return left - right;
  });
}
