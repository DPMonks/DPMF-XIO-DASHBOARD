import {mergeActivityRows, rowsFromXrplToGraph, xrplToHolderGraphUrl} from "../src/activityHistory.js";

const CACHE_MS = 60 * 60_000;
let cache = { at: 0, rows: [] };

async function fetchGraph(range, fetchImpl = fetch) {
  const response = await fetchImpl(xrplToHolderGraphUrl(range), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  return rowsFromXrplToGraph(await response.json());
}

export async function loadIssuedHolderHistory(fetchImpl = fetch) {
  if (Date.now() - cache.at < CACHE_MS && cache.rows.length >= 50) {
    return cache.rows;
  }

  try {
    const all = await fetchGraph("ALL", fetchImpl);
    const long = all.length ? all : await fetchGraph("5Y", fetchImpl);
    const recent = await fetchGraph("24H", fetchImpl).catch(() => []);
    const rows = mergeActivityRows(long, recent);
    if (rows.length) cache = { at: Date.now(), rows };
    return rows;
  } catch {
    return cache.rows;
  }
}
