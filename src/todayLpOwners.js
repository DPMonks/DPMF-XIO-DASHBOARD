import {asIso, currentOwners, pickLastOwnerScan, pickTodayOwnerSource, utcDay} from "./todayOwners.js";

export function normalizeLpPool(value) {
  const raw = String(value || "XIO/XRP")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "/");
  if (raw === "ALL" || raw === "*") return null;
  if (raw === "XRP") return "XIO/XRP";
  if (raw === "RLUSD") return "XIO/RLUSD";
  if (raw.startsWith("XIO/")) return raw;
  return `XIO/${raw}`;
}

export function remapLpSourceKind(kind) {
  if (kind === "token_holders_latest") return "lp_holders_latest";
  if (kind === "token_holders_history") return "lp_holders_history";
  return kind || "none";
}

export function buildTodayLpOwnersPayload({
  source,
  holders = [],
  offset = 0,
  pool = "XIO/XRP",
} = {}) {
  const asOf = asIso(source?.ts);
  const mapRow = (row, index) => {
    const lp = Number(row.lp_balance ?? row.balance);
    return {
      rank: Number(row.rank) || offset + index + 1,
      account: row.account,
      lp_balance: lp,
      balance: lp,
      frozen: Boolean(row.frozen),
      pool_name: row.pool_name || pool,
    };
  };

  const rows = currentOwners(holders.map((row) => ({
    ...row,
    balance: row.lp_balance ?? row.balance,
  }))).map((row, index) => mapRow(row, index));

  if (!source?.present) {
    return {
      holders: rows,
      as_of: asOf,
      snapshot_day: utcDay(asOf),
      present: false,
      catching_up: true,
      count: rows.length ? Number(source?.count || rows.length) : 0,
      source: source?.kind || "none",
      pool,
    };
  }

  return {
    holders: rows,
    as_of: asOf,
    snapshot_day: utcDay(asOf),
    present: true,
    catching_up: false,
    count: Number(source.count || rows.length),
    source: source.kind,
    pool,
  };
}

export function pickLastLpScan(input) {
  const picked = pickLastOwnerScan(input);
  return {
    ...picked,
    kind: remapLpSourceKind(picked.kind),
  };
}

export function pickTodayLpSource(input) {
  const picked = pickTodayOwnerSource(input);
  return {
    ...picked,
    kind: remapLpSourceKind(picked.kind),
  };
}

export function pickAllPoolCount(latestCount, historyCount) {
  const latest = Number(latestCount) || 0;
  const history = Number(historyCount) || 0;
  return history > latest ? history : latest;
}
