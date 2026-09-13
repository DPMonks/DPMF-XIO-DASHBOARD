// Mirrors dpmf-xio-indexer src/todayOwners.js (PR #5, 219e859).
// Dashboard stays SELECT-only. No Postgres import here so node --test can run.

export function utcDay(value = new Date()) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function asIso(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const asUtc = new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(asUtc.getTime()) ? null : asUtc.toISOString();
}

export function isSameUtcDay(value, today = utcDay()) {
  const day = utcDay(value);
  return Boolean(day && today && day === today);
}

export function wantsTodaySnapshot(query = {}) {
  const raw = String(
    typeof query.get === "function"
      ? query.get("snapshot") || query.get("as_of") || ""
      : query.snapshot ?? query.as_of ?? ""
  ).toLowerCase();
  return raw === "today" || raw === "1" || raw === "true";
}

export function currentOwners(holders) {
  return (holders || []).filter((row) => row?.account && Number(row.balance) > 0);
}

export function pickLastOwnerScan({
  latestTs = null,
  latestCount = 0,
  historyTs = null,
  historyCount = 0,
} = {}) {
  const candidates = [];
  if (Number(latestCount) > 0 && latestTs) {
    candidates.push({
      kind: "token_holders_latest",
      ts: latestTs,
      count: Number(latestCount),
    });
  }
  if (Number(historyCount) > 0 && historyTs) {
    candidates.push({
      kind: "token_holders_history",
      ts: historyTs,
      count: Number(historyCount),
    });
  }
  if (!candidates.length) {
    return {
      kind: "none",
      ts: latestTs || historyTs || null,
      count: 0,
    };
  }
  return candidates.sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
}

export function pickTodayOwnerSource({
  latestTs = null,
  latestCount = 0,
  historyTs = null,
  historyCount = 0,
  now = new Date(),
} = {}) {
  const today = utcDay(now);
  if (Number(latestCount) > 0 && latestTs && isSameUtcDay(latestTs, today)) {
    return { kind: "token_holders_latest", ts: latestTs, count: Number(latestCount), present: true };
  }
  if (Number(historyCount) > 0 && historyTs && isSameUtcDay(historyTs, today)) {
    return { kind: "token_holders_history", ts: historyTs, count: Number(historyCount), present: true };
  }
  const lastTs =
    [latestTs, historyTs]
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
  return { kind: "none", ts: lastTs, count: 0, present: false };
}

export function mapOwnerRows(holders = [], offset = 0) {
  return currentOwners(holders).map((row, index) => ({
    rank: Number(row.rank) || offset + index + 1,
    account: row.account,
    balance: Number(row.balance),
    frozen: Boolean(row.frozen),
  }));
}

function ownerRowKey(row) {
  const account = String(row?.account || "").toLowerCase();
  const pair = String(row?.pair || row?.pool_name || "").replace(/\s+/g, "").toUpperCase();
  return pair ? `${account}|${pair}` : account;
}

export function preferLiveOwnerRows(previous = [], next = []) {
  const out = (Array.isArray(next) ? next : []).map((row) => ({ ...row }));
  const indexByKey = new Map(out.map((row, index) => [ownerRowKey(row), index]));
  for (const row of Array.isArray(previous) ? previous : []) {
    if (!row?.live || !row.account) continue;
    const liveBal = Number(row.lp_balance ?? row.balance) || 0;
    if (!(liveBal > 0)) continue;
    const key = ownerRowKey(row);
    const idx = indexByKey.get(key);
    if (idx == null) {
      indexByKey.set(key, out.length);
      out.push({ ...row });
      continue;
    }
    const snapBal = Number(out[idx].lp_balance ?? out[idx].balance) || 0;
    if (liveBal > snapBal + 1e-9) {
      out[idx] = { ...out[idx], ...row, live: true };
    }
  }
  return out.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function keepLastGoodOwners(previous, next) {
  const prevRows = Array.isArray(previous?.rows)
    ? previous.rows
    : Array.isArray(previous)
      ? previous
      : [];
  const nextRows = Array.isArray(next?.rows)
    ? next.rows
    : Array.isArray(next)
      ? next
      : [];
  const prevFresh =
    previous?.freshness && typeof previous.freshness === "object" ? previous.freshness : null;
  const nextFresh = next?.freshness && typeof next.freshness === "object" ? next.freshness : null;

  if (nextRows.length) {
    return { rows: preferLiveOwnerRows(prevRows, nextRows), freshness: nextFresh || prevFresh };
  }
  if (prevRows.length) {
    return {
      rows: prevRows,
      freshness: {
        ...(prevFresh || {}),
        ...(nextFresh || {}),
        catching_up: true,
        present: false,
        count: Number(prevFresh?.count) || prevRows.length,
      },
    };
  }
  return { rows: nextRows, freshness: nextFresh || prevFresh || null };
}

export function buildTodayOwnersPayload({ source, holders = [], offset = 0 } = {}) {
  const asOf = asIso(source?.ts);
  const rows = mapOwnerRows(holders, offset);
  if (!source?.present) {
    return {
      holders: rows,
      as_of: asOf,
      snapshot_day: utcDay(asOf),
      present: false,
      catching_up: true,
      count: Number(source?.count || rows.length) || 0,
      source: source?.kind || "none",
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
  };
}
