import pg from "pg";
import {issuerLockedFromIssued, XIO_ISSUER, XIO_TOTAL_SUPPLY, XIO_XRP_AMM} from "../src/constants/ledger.js";
import {looksLikeXrpUsd, pickTrustlineCount, recordedXioUsdFromPrices, xrpPerXio} from "../src/utils/recordedPrice.js";
import {inferQuoteReserve, quoteUsdFromMap, resolvePoolSplit} from "../src/utils/poolSplit.js";
import {asIso, buildTodayOwnersPayload, isSameUtcDay, pickLastOwnerScan, pickTodayOwnerSource, utcDay, wantsTodaySnapshot} from "../src/todayOwners.js";
import {buildTodayLpOwnersPayload, normalizeLpPool, pickAllPoolCount, pickLastLpScan, pickTodayLpSource} from "../src/todayLpOwners.js";
import {asOrderbookPayload, bookHasNativeDex, composeAmmBook, emptyOrderbook, keepLastGoodBook, asLiquidPairBook, normalizeOrderbookPair, pickNativeBookRow, quotePerXrpFromSpots, sortOrderbookPairs, FEATURED_ORDERBOOK_PAIRS} from "../src/orderbook.js";
import {carryActivityMetrics, issuedActivitySeries} from "../src/activityHistory.js";
import {inferTradesFromHistory, mergeTradePrints} from "../src/xioTrades.js";
import {applyPoolVolumes, loadPoolXioVolumes} from "./freeVolume.js";
import {loadLedgerPoolVolumes, mergeVolumeMaps} from "./ammPoolVolume.js";
import {loadIssuedHolderHistory} from "./issuedHolderHistory.js";
import {fillNativeBookFromXrpl, xrplRpc} from "./xrplBookOffers.js";
import {attachQuoteXrpPrices, loadQuoteXrpRates} from "./quoteXrpMarket.js";
import {XIO_BLACKHOLED_AT, blackholeAtFromTransactions, issuerBlackholeFromAccount} from "../src/utils/blackhole.js";
import {overlayLiveAmmReserves} from "../src/utils/ammInfo.js";
import {indexPoolsByPair, lookupLpPool, lpPositionFromPool, mergeLpPoolSource, normalizeWalletPair} from "../src/wallet/composeWallet.js";
import {loadWalletActivity, loadWalletLpIncome, loadWalletBalancesFromLedger, preferPositiveAmount, loadWalletLines, loadWalletLpFromLedger, loadWalletNetworthFromLedger, loadWalletOffers, xrpDropsFromAccountInfo} from "./walletLedger.js";
import {knownLivePoolSpecs, liveCatalogPayload, loadLiveMarket} from "./liveCatalog.js";
import {overlayDbResultWithLive, serveCatalogFallback} from "./catalogSwitch.js";
import {catalogHealth} from "./sourceControl.js";
import {FREE_API_HEADERS} from "./xrplToCatalog.js";
import {loadPoolGovernance, loadWalletVotes} from "./ammGovernance.js";
import {loadLiveAmmReserves, loadLiveAmmReservesMany, withXrplRetry} from "./liveAmmReserves.js";
import {RLUSD_HEX, RLUSD_ISSUER} from "../src/constants/ledger.js";
import {loadDirectPairMarket} from "./directPairMarket.js";
import {canSelect, loadIndexerSchema, peekIndexerSchema, pickColumns} from "./indexerSchema.js";

let pool = null;

// Same XIO-only tables the live indexer SELECTs. This process never imports
// startIndexer and never starts or resets workers (those have staggered delays).
const CATALOG = {
  status: "online",
  service: "XRPL Indexer",
  source: "db",
  note: "Read-only SELECT on XIO tables. Workers were not started or reset.",
  endpoints: {
    health: "/health",
    overview: "/api/overview",
    amm: "/api/amm",
    pools: "/api/pools",
    topHolders: "/api/top-holders",
    topHoldersToday: "/api/top-holders?snapshot=today",
    topHoldersV2: "/api/top-holders-v2",
    topLp: "/api/top-lp",
    holdersCount: "/api/holders/count",
    holdersCountToday: "/api/holders/count?snapshot=today",
    trustlinesCount: "/api/trustlines/count",
    lpHoldersCount: "/api/lp-holders/count",
    lpHoldersCountToday: "/api/lp-holders/count?snapshot=today",
    lpTrustlinesCount: "/api/lp-trustlines/count",
    lpPools: "/api/lp-pools",
    lpPoolsLive: "/api/lp-pools/live",
    topLpToday: "/api/top-lp?snapshot=today",
    lpTrustlinesHistory: "/api/charts/lp-trustlines",
    tvlHistory: "/api/charts/tvl",
    holdersHistory: "/api/charts/holders",
    lpHoldersHistory: "/api/charts/lp-holders",
    trustlinesHistory: "/api/charts/trustlines",
    activityHistory: "/api/charts/activity",
    tradersHistory: "/api/charts/traders",
    trades: "/api/trades",
    xioFlows: "/api/xio-flows",
    walletBalances: "/api/wallet/balances/:address",
    walletAccount: "/api/wallet/account/:address",
    walletOffers: "/api/wallet/offers/:address",
    walletLines: "/api/wallet/lines/:address",
    walletActivity: "/api/wallet/activity/:address",
    walletLpIncome: "/api/wallet/lp-income/:address",
    walletVotes: "/api/wallet/votes/:address",
    ammGovernance: "/api/amm/governance",
    walletLp: "/api/wallet/lp/:address",
    walletRank: "/api/wallet/rank/:address",
    prices: "/api/prices",
    priceChange: "/api/prices/change24h",
    networth: "/api/wallet/networth/:address",
    sparkline: "/api/sparkline/:asset",
    chartCandles: "/api/chart/candles",
    issuerLocked: "/api/issuer-locked",
    orderbook: "/api/orderbook",
    orderbooks: "/api/orderbooks",
  },
};

function rawDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

function separatePassword() {
  return process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || "";
}

export function applyConnectionOverrides(raw) {
  const password = separatePassword();
  const user = process.env.PGUSER || "";
  const host = process.env.PGHOST || "";
  const port = process.env.PGPORT || "";
  const dbname = process.env.PGDATABASE || "";
  if (!raw && host) {
    const authUser = encodeURIComponent(user || "postgres");
    const auth = password
      ? `${authUser}:${encodeURIComponent(password)}`
      : authUser;
    return `postgres://${auth}@${host}:${port || "5432"}/${dbname || "railway"}`;
  }
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const decode = (value, fallback) => {
      try {
        return decodeURIComponent(value || "") || fallback;
      } catch {
        return value || fallback;
      }
    };
    const finalUser = user || decode(url.username, "postgres");
    const finalPass = password || decode(url.password, "");
    const finalHost = host || url.hostname;
    const finalPort = port || url.port || "5432";
    const finalDb = dbname || url.pathname.replace(/^\//, "") || "railway";
    const auth = finalPass
      ? `${encodeURIComponent(finalUser)}:${encodeURIComponent(finalPass)}`
      : encodeURIComponent(finalUser);
    return sanitizeDatabaseUrl(
      `postgres://${auth}@${finalHost}:${finalPort}/${finalDb}${url.search}`
    );
  } catch {
    return raw;
  }
}

export function databaseUrlKind() {
  const raw = rawDatabaseUrl().trim();
  if (/^postgres(ql)?:\/\//i.test(raw)) return "postgres";
  if (process.env.PGHOST && separatePassword()) return "postgres";
  if (!raw) return "missing";
  if (/^https?:\/\//i.test(raw)) return "http";
  return "invalid";
}

function databaseUrl() {
  return databaseUrlKind() === "postgres"
    ? applyConnectionOverrides(rawDatabaseUrl().trim())
    : "";
}

export function hasIndexerDatabase() {
  return databaseUrlKind() === "postgres";
}

export function databaseUrlHint() {
  const kind = databaseUrlKind();
  if (kind === "http") {
    return "DATABASE_URL is the indexer HTTP host (*.up.railway.app). That belongs in VITE_API_BASE only. DATABASE_URL must be postgres://USER:PASS@HOST:PORT/DB for the public TCP proxy, with no ?sslmode=require.";
  }
  if (kind === "invalid") {
    return "DATABASE_URL is set but is not a postgres:// connection string.";
  }
  if (kind === "missing") {
    return "DATABASE_URL is unset on this Vercel deploy. In DPMF-XIO-Dashboard → Settings → Environment Variables, add postgres://USER:PASS@acela.proxy.rlwy.net:48994/railway for Preview AND Production (no VITE_, no ?sslmode=require), then Redeploy this preview.";
  }
  return "";
}

const VERIFY_SSLMODES = new Set(["require", "verify-full", "verify-ca"]);

function decodePart(value, fallback = "") {
  try {
    return decodeURIComponent(value || "") || fallback;
  } catch {
    return value || fallback;
  }
}

// Railway's public TCP proxy presents a cert chain node-pg rejects when the
// URL (or PGSSLMODE) is sslmode=require. That flag is parsed AFTER Pool.ssl
// and overwrites rejectUnauthorized:false. Strip it. Keep no-verify only when
// another query param is still required.
export function sanitizeDatabaseUrl(raw) {
  if (!raw) return "";
  const text = String(raw);
  try {
    const url = new URL(text);
    const mode = String(url.searchParams.get("sslmode") || "").toLowerCase();
    if (VERIFY_SSLMODES.has(mode)) url.searchParams.delete("sslmode");
    const ssl = String(url.searchParams.get("ssl") || "").toLowerCase();
    if (ssl === "true" || ssl === "1" || ssl === "require") {
      url.searchParams.delete("ssl");
    }
    if (!url.searchParams.size) {
      url.search = "";
      return url.toString();
    }
    if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "no-verify");
    return url.toString();
  } catch {
    let next = text.replace(/[?&]sslmode=(require|verify-full|verify-ca)\b/gi, "");
    next = next.replace(/[?&]ssl=(true|1|require)\b/gi, "");
    next = next.replace(/\?&/, "?").replace(/[?&]$/, "");
    if (next.includes("?") && !/[?&]sslmode=/i.test(next)) {
      next += `${next.includes("?") ? "&" : "?"}sslmode=no-verify`;
    }
    return next;
  }
}

export function postgresPoolOptions(raw) {
  const connectionString = sanitizeDatabaseUrl(raw);
  const ssl = { rejectUnauthorized: false };
  try {
    const url = new URL(connectionString);
    const password = decodePart(url.password);
    return {
      host: decodePart(url.hostname),
      port: Number(url.port || 5432),
      user: decodePart(url.username, "postgres"),
      ...(password ? { password } : {}),
      database: decodePart(url.pathname.replace(/^\//, ""), "railway"),
      ssl,
      max: 2,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 8000,
      allowExitOnIdle: true,
    };
  } catch {
    return { connectionString, ssl, max: 2, connectionTimeoutMillis: 2500, idleTimeoutMillis: 8000, allowExitOnIdle: true };
  }
}

function safePgMessage(error) {
  return String(error?.message || "Postgres error")
    .replace(/:[^:@/]+@/g, ":***@")
    .replace(/password=[^&\s]+/gi, "password=***");
}

function isConnectError(error) {
  const message = String(error?.message || "");
  return (
    error?.code === "ECONNREFUSED" ||
    error?.code === "ENOTFOUND" ||
    error?.code === "ETIMEDOUT" ||
    /ssl|certificate|self-signed|pg_hba|password authentication|timeout/i.test(
      message
    )
  );
}

function connectHint(error) {
  const message = safePgMessage(error);
  if (/password authentication failed/i.test(message)) {
    return "Postgres rejected the password. On Vercel set POSTGRES_PASSWORD to the Railway Postgres password (plain text, no URL encoding) and keep DATABASE_URL as postgres://postgres@acela.proxy.rlwy.net:48994/railway with no password and no ?sslmode=require. Preview + Production, then Redeploy. Password is not logged.";
  }
  if (/ssl|certificate|self-signed/i.test(message)) {
    return "Postgres TLS failed. DATABASE_URL must not use sslmode=require (Railway proxy cert). Use no query param or sslmode=no-verify. Password is not logged.";
  }
  return "Postgres connect failed. Check host acela.proxy.rlwy.net:48994, user postgres, database railway, and the current password. Password is not logged.";
}

export function postgresOutageBody() {
  return {
    error: "Postgres temporarily unreachable",
    source: "db",
  };
}

function logDbError(error) {
  console.error("Indexer Postgres failed (password redacted)", {
    code: error?.code || null,
    message: safePgMessage(error),
    hint: connectHint(error),
  });
}

let dbDownUntil = 0;

export function postgresTemporarilyDown() {
  return Date.now() < dbDownUntil;
}

function markPostgresDown() {
  dbDownUntil = Date.now() + 8_000;
}

function getPool() {
  const raw = databaseUrl();
  if (!raw) return null;
  if (postgresTemporarilyDown()) return null;
  if (!pool) {
    if (VERIFY_SSLMODES.has(String(process.env.PGSSLMODE || "").toLowerCase())) {
      process.env.PGSSLMODE = "no-verify";
    }
    pool = new pg.Pool(postgresPoolOptions(raw));
    pool.on("error", (error) => logDbError(error));
  }
  return pool;
}

function ok(body) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
    source: "postgres",
  };
}

function searchParams(search) {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

async function tryQuery(db, sql, params) {
  try {
    return await db.query(sql, params);
  } catch (error) {
    if (isConnectError(error)) {
      logDbError(error);
      throw error;
    }
    return { rows: [] };
  }
}

async function tryQueryIf(db, table, columns, sql, params) {
  if (!canSelect(peekIndexerSchema(), table, columns)) return { rows: [] };
  return tryQuery(db, sql, params);
}

async function lastSameTimeScan(db, table) {
  const stamp = await tryQuery(
    db,
    `SELECT MAX(timestamp) AS ts
     FROM ${table}
     WHERE ABS(balance::numeric) > 0`
  );
  const ts = stamp.rows[0]?.ts || null;
  if (!ts) return { ts: null, count: 0 };
  const count = await tryQuery(
    db,
    `SELECT COUNT(*)::int AS n
     FROM ${table}
     WHERE timestamp = $1 AND ABS(balance::numeric) > 0`,
    [ts]
  );
  return { ts, count: Number(count.rows[0]?.n || 0) };
}

async function pageSameTimeScan(db, table, ts, limit, offset) {
  const withFrozen = await tryQuery(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY ABS(balance::numeric) DESC) AS rank,
            account,
            ABS(balance::numeric) AS balance,
            COALESCE(frozen, false) AS frozen,
            timestamp
     FROM ${table}
     WHERE timestamp = $1 AND ABS(balance::numeric) > 0
     ORDER BY ABS(balance::numeric) DESC
     LIMIT $2 OFFSET $3`,
    [ts, limit, offset]
  );
  if (withFrozen.rows.length) return withFrozen.rows;
  const plain = await tryQuery(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY ABS(balance::numeric) DESC) AS rank,
            account,
            ABS(balance::numeric) AS balance,
            timestamp
     FROM ${table}
     WHERE timestamp = $1 AND ABS(balance::numeric) > 0
     ORDER BY ABS(balance::numeric) DESC
     LIMIT $2 OFFSET $3`,
    [ts, limit, offset]
  );
  return plain.rows;
}

async function loadTodayOwners(db, { limit = 200, offset = 0, includeHolders = true } = {}) {
  // SELECT-only: if origin/main TRUNCATEd latest, serve the same-time history
  // scan (235 XIO accounts when last probed). Do not INSERT/hydrate writes.
  const latest = await lastSameTimeScan(db, "token_holders_latest");
  const history = await lastSameTimeScan(db, "token_holders_history");

  const today = pickTodayOwnerSource({
    latestTs: latest.ts,
    latestCount: latest.count,
    historyTs: history.ts,
    historyCount: history.count,
  });
  const last = pickLastOwnerScan({
    latestTs: latest.ts,
    latestCount: latest.count,
    historyTs: history.ts,
    historyCount: history.count,
  });
  const source = today.present ? today : { ...last, present: false };

  let holders = [];
  if (includeHolders && source.kind !== "none" && source.ts) {
    holders = await pageSameTimeScan(db, source.kind, source.ts, limit, offset);
  }

  return buildTodayOwnersPayload({ source, holders, offset });
}

function mapHolderRows(rows, offset, asOf) {
  return rows.map((row, index) => ({
    rank: Number(row.rank) || offset + index + 1,
    account: row.account,
    balance: Number(row.balance),
    frozen: Boolean(row.frozen),
    updated: row.timestamp || row.updated || asOf || null,
  }));
}

function freshnessOf(asOf, { liveTable = false, todayOnly = false } = {}) {
  const iso = asIso(asOf);
  const snapshotDay = utcDay(iso);
  const today = utcDay();
  if (!iso) {
    return {
      as_of: null,
      snapshot_day: liveTable ? today : null,
      present: liveTable,
      catching_up: !liveTable,
      age_seconds: null,
    };
  }
  const ageMs = Date.now() - new Date(iso).getTime();
  const present = todayOnly
    ? isSameUtcDay(iso, today)
    : ageMs >= 0 && ageMs <= 36 * 3600 * 1000;
  return {
    as_of: iso,
    snapshot_day: snapshotDay,
    present,
    catching_up: !present,
    age_seconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
  };
}

async function probeCountAsOf(db, sqls) {
  for (const sql of sqls) {
    const result = await tryQuery(db, sql);
    const row = result.rows[0];
    if (!row) continue;
    return {
      count: Number(row.count || 0),
      as_of: row.as_of || null,
    };
  }
  return { count: 0, as_of: null };
}

async function pickHolderSource(db, { todayOnly = false } = {}) {
  const latest = await probeCountAsOf(db, [
    `SELECT COUNT(*) FILTER (WHERE ABS(balance::numeric) > 0) AS count,
            MAX(timestamp) AS as_of
     FROM token_holders_latest`,
    `SELECT COUNT(*) FILTER (WHERE ABS(balance::numeric) > 0) AS count,
            MAX(updated_at) AS as_of
     FROM token_holders_latest`,
    `SELECT COUNT(*) AS count, NULL::timestamptz AS as_of
     FROM token_holders_latest
     WHERE ABS(balance::numeric) > 0`,
  ]);
  const history = await probeCountAsOf(db, [
    `SELECT COUNT(*) FILTER (WHERE ABS(balance::numeric) > 0) AS count,
            MAX(timestamp) AS as_of
     FROM token_holders_history
     WHERE timestamp = (SELECT MAX(timestamp) FROM token_holders_history)`,
  ]);
  const latestTs = latest.as_of ? new Date(latest.as_of).getTime() : 0;
  const historyTs = history.as_of ? new Date(history.as_of).getTime() : 0;
  const historyFresh = freshnessOf(history.as_of);

  if (todayOnly) {
    const today = await loadTodayOwners(db, { includeHolders: false });
    return {
      kind: today.source,
      count: today.count,
      as_of: today.as_of,
      snapshot_day: today.snapshot_day,
      present: today.present,
      catching_up: today.catching_up,
    };
  }

  if (latest.count > 0 && latestTs && (!historyTs || latestTs >= historyTs)) {
    return {
      kind: "token_holders_latest",
      count: latest.count,
      ...freshnessOf(latest.as_of, { liveTable: true }),
    };
  }
  if (history.count > 0 && historyTs && (!latestTs || historyTs > latestTs)) {
    if (!latestTs && latest.count > 0 && historyFresh.catching_up) {
      return {
        kind: "token_holders_latest",
        count: latest.count,
        ...freshnessOf(null, { liveTable: true }),
      };
    }
    return {
      kind: "token_holders_history",
      count: history.count,
      ...historyFresh,
    };
  }
  if (latest.count > 0) {
    return {
      kind: "token_holders_latest",
      count: latest.count,
      ...freshnessOf(latest.as_of, { liveTable: true }),
    };
  }
  return { kind: "none", count: 0, ...freshnessOf(null) };
}

async function freshTokenHolders(db, limit, offset, options = {}) {
  const source = await pickHolderSource(db, options);
  let rows = [];

  if (source.kind === "token_holders_latest") {
    const withTs = await tryQuery(
      db,
      `SELECT account, ABS(balance::numeric) AS balance, timestamp
       FROM token_holders_latest
       WHERE ABS(balance::numeric) > 0
       ORDER BY ABS(balance::numeric) DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    rows = withTs.rows;
    if (!rows.length) {
      const plain = await tryQuery(
        db,
        `SELECT account, ABS(balance::numeric) AS balance
         FROM token_holders_latest
         WHERE ABS(balance::numeric) > 0
         ORDER BY ABS(balance::numeric) DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      rows = plain.rows;
    }
  } else if (source.kind === "token_holders_history") {
    const snapshot = await tryQuery(
      db,
      `SELECT account, ABS(balance::numeric) AS balance, timestamp
       FROM token_holders_history
       WHERE timestamp = (SELECT MAX(timestamp) FROM token_holders_history)
         AND ABS(balance::numeric) > 0
       ORDER BY ABS(balance::numeric) DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    rows = snapshot.rows;
  }

  return {
    holders: mapHolderRows(rows, offset, source.as_of),
    as_of: source.as_of,
    snapshot_day: source.snapshot_day || utcDay(source.as_of),
    source: source.kind,
    present: source.present,
    catching_up: source.catching_up,
    age_seconds: source.age_seconds,
    count: source.count,
  };
}

async function tokenHolderCount(db) {
  const source = await pickHolderSource(db);
  return source.count;
}

async function tokenTrustlineSnapshot(db) {
  const latest = await tryQuery(
    db,
    `SELECT COUNT(*)::int AS count, MAX(timestamp) AS as_of
     FROM token_holders_latest`
  );
  const history = await tryQuery(
    db,
    `SELECT COUNT(*)::int AS count, MAX(timestamp) AS as_of
     FROM token_holders_history
     WHERE timestamp = (SELECT MAX(timestamp) FROM token_holders_history)`
  );
  const historyCount = Number(history.rows[0]?.count || 0);
  const latestCount = Number(latest.rows[0]?.count || 0);
  const count = pickTrustlineCount(latestCount, historyCount);
  const asOf = historyCount > 0 ? history.rows[0]?.as_of : latest.rows[0]?.as_of;
  return { count, as_of: asIso(asOf) };
}

async function tokenTrustlineCount(db) {
  return (await tokenTrustlineSnapshot(db)).count;
}

function lpPoolClause(pool, column = "pool_name") {
  if (!pool) return { sql: "TRUE", params: [] };
  return { sql: `COALESCE(${column}, 'XIO/XRP') = $1`, params: [pool] };
}

function lpOwnerSql(ownersOnly) {
  return ownersOnly ? "AND ABS(lp_balance::numeric) > 0" : "";
}

async function lastSameTimeLpScan(db, table, pool, ownersOnly) {
  const where = lpPoolClause(pool);
  const ownerSql = lpOwnerSql(ownersOnly);
  const stamp = await tryQuery(
    db,
    `SELECT MAX(timestamp) AS ts
     FROM ${table}
     WHERE ${where.sql} ${ownerSql}`,
    where.params
  );
  const ts = stamp.rows[0]?.ts || null;
  if (!ts) return { ts: null, count: 0, supply: 0 };
  const count = await tryQuery(
    db,
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(ABS(lp_balance::numeric)), 0) AS supply
     FROM ${table}
     WHERE timestamp = $${where.params.length + 1}
       AND ${where.sql} ${ownerSql}`,
    [...where.params, ts]
  );
  return {
    ts,
    count: Number(count.rows[0]?.n || 0),
    supply: Number(count.rows[0]?.supply || 0),
  };
}

async function countAllLatestLp(db, ownersOnly) {
  const result = await tryQuery(
    db,
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(ABS(lp_balance::numeric)), 0) AS supply,
            MAX(timestamp) AS ts
     FROM lp_holders_latest
     WHERE TRUE ${lpOwnerSql(ownersOnly)}`
  );
  return {
    ts: result.rows[0]?.ts || null,
    count: Number(result.rows[0]?.n || 0),
    supply: Number(result.rows[0]?.supply || 0),
  };
}

async function countPerPoolHistoryLp(db, ownersOnly) {
  const result = await tryQuery(
    db,
    `WITH latest_ts AS (
       SELECT COALESCE(pool_name, 'XIO/XRP') AS pool_name, MAX(timestamp) AS ts
       FROM lp_holders_history
       GROUP BY 1
     )
     SELECT COUNT(*)::int AS n,
            COALESCE(SUM(ABS(h.lp_balance::numeric)), 0) AS supply,
            MAX(h.timestamp) AS ts
     FROM lp_holders_history h
     JOIN latest_ts t
       ON COALESCE(h.pool_name, 'XIO/XRP') = t.pool_name
      AND h.timestamp = t.ts
     WHERE TRUE ${lpOwnerSql(ownersOnly)}`
  );
  return {
    ts: result.rows[0]?.ts || null,
    count: Number(result.rows[0]?.n || 0),
    supply: Number(result.rows[0]?.supply || 0),
  };
}

async function loadAllLpLineStats(db, ownersOnly) {
  const latest = await countAllLatestLp(db, ownersOnly);
  const history = await countPerPoolHistoryLp(db, ownersOnly);
  const useHistory = pickAllPoolCount(latest.count, history.count) === history.count && history.count > latest.count;
  const row = useHistory ? history : latest;
  return {
    ...row,
    source: useHistory
      ? "lp_holders_history"
      : latest.count
        ? "lp_holders_latest"
        : "none",
  };
}

async function pagePerPoolHistoryLpOwners(db, limit, offset) {
  const withFrozen = await tryQuery(
    db,
    `WITH latest_ts AS (
       SELECT COALESCE(pool_name, 'XIO/XRP') AS pool_name, MAX(timestamp) AS ts
       FROM lp_holders_history
       GROUP BY 1
     )
     SELECT ROW_NUMBER() OVER (ORDER BY ABS(h.lp_balance::numeric) DESC) AS rank,
            h.account,
            ABS(h.lp_balance::numeric) AS lp_balance,
            COALESCE(h.frozen, false) AS frozen,
            COALESCE(h.pool_name, 'XIO/XRP') AS pool_name
     FROM lp_holders_history h
     JOIN latest_ts t
       ON COALESCE(h.pool_name, 'XIO/XRP') = t.pool_name
      AND h.timestamp = t.ts
     WHERE ABS(h.lp_balance::numeric) > 0
     ORDER BY ABS(h.lp_balance::numeric) DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return withFrozen.rows;
}

async function pageAllLatestLpOwners(db, limit, offset, { since = null, until = null } = {}) {
  const bounds = since && until ? "AND timestamp >= $3 AND timestamp < $4" : "";
  const params = since && until ? [limit, offset, since, until] : [limit, offset];
  const withFrozen = await tryQuery(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY ABS(lp_balance::numeric) DESC) AS rank,
            account,
            ABS(lp_balance::numeric) AS lp_balance,
            COALESCE(frozen, false) AS frozen,
            COALESCE(pool_name, 'XIO/XRP') AS pool_name
     FROM lp_holders_latest
     WHERE ABS(lp_balance::numeric) > 0
       ${bounds}
     ORDER BY ABS(lp_balance::numeric) DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  if (withFrozen.rows.length) return withFrozen.rows;
  const plain = await tryQuery(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY ABS(lp_balance::numeric) DESC) AS rank,
            account,
            ABS(lp_balance::numeric) AS lp_balance,
            COALESCE(pool_name, 'XIO/XRP') AS pool_name
     FROM lp_holders_latest
     WHERE ABS(lp_balance::numeric) > 0
       ${bounds}
     ORDER BY ABS(lp_balance::numeric) DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return plain.rows;
}

async function pageSameTimeLpScan(db, table, ts, pool, limit, offset) {
  if (!pool && table === "lp_holders_latest") {
    return pageAllLatestLpOwners(db, limit, offset);
  }
  const where = lpPoolClause(pool);
  const withFrozen = await tryQuery(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY ABS(lp_balance::numeric) DESC) AS rank,
            account,
            ABS(lp_balance::numeric) AS lp_balance,
            COALESCE(frozen, false) AS frozen,
            COALESCE(pool_name, 'XIO/XRP') AS pool_name
     FROM ${table}
     WHERE timestamp = $${where.params.length + 1}
       AND ${where.sql}
       AND ABS(lp_balance::numeric) > 0
     ORDER BY ABS(lp_balance::numeric) DESC
     LIMIT $${where.params.length + 2} OFFSET $${where.params.length + 3}`,
    [...where.params, ts, limit, offset]
  );
  if (withFrozen.rows.length) return withFrozen.rows;
  const plain = await tryQuery(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY ABS(lp_balance::numeric) DESC) AS rank,
            account,
            ABS(lp_balance::numeric) AS lp_balance,
            COALESCE(pool_name, 'XIO/XRP') AS pool_name
     FROM ${table}
     WHERE timestamp = $${where.params.length + 1}
       AND ${where.sql}
       AND ABS(lp_balance::numeric) > 0
     ORDER BY ABS(lp_balance::numeric) DESC
     LIMIT $${where.params.length + 2} OFFSET $${where.params.length + 3}`,
    [...where.params, ts, limit, offset]
  );
  return plain.rows;
}

async function loadLiveLpOwners(db, { limit = 50, offset = 0, includeHolders = true, pool = "XIO/XRP" } = {}) {
  const pair = normalizeLpPool(pool);
  if (!pair) {
    const stats = await loadAllLpLineStats(db, true);
    const holders = includeHolders && stats.count
      ? stats.source === "lp_holders_history"
        ? await pagePerPoolHistoryLpOwners(db, limit, offset)
        : await pageAllLatestLpOwners(db, limit, offset)
      : [];
    return {
      holders,
      rows: holders,
      count: stats.count,
      as_of: asIso(stats.ts),
      pool: "all",
      source: stats.source,
    };
  }
  const latest = await lastSameTimeLpScan(db, "lp_holders_latest", pair, true);
  const history = await lastSameTimeLpScan(db, "lp_holders_history", pair, true);
  const useLatest = latest.count > 0 && latest.ts;
  const kind = useLatest
    ? "lp_holders_latest"
    : history.count > 0 && history.ts
      ? "lp_holders_history"
      : "none";
  const ts = useLatest ? latest.ts : history.ts;
  const count = useLatest ? latest.count : history.count;
  const holders =
    includeHolders && ts
      ? await pageSameTimeLpScan(db, kind, ts, pair, limit, offset)
      : [];
  return {
    holders,
    rows: holders,
    count,
    as_of: asIso(ts),
    pool: pair,
    source: kind,
  };
}

async function loadTodayLpOwners(db, { limit = 50, offset = 0, includeHolders = true, pool = "XIO/XRP" } = {}) {
  const pair = normalizeLpPool(pool);
  if (!pair) {
    const live = await loadAllLpLineStats(db, true);
    const source = {
      kind: live.source,
      ts: live.ts,
      count: live.count,
      present: live.count > 0,
    };
    const holders = includeHolders && source.present
      ? source.kind === "lp_holders_history"
        ? await pagePerPoolHistoryLpOwners(db, limit, offset)
        : await pageAllLatestLpOwners(db, limit, offset)
      : [];
    return buildTodayLpOwnersPayload({ source, holders, offset, pool: "all" });
  }
  const latest = await lastSameTimeLpScan(db, "lp_holders_latest", pair, true);
  const history = await lastSameTimeLpScan(db, "lp_holders_history", pair, true);
  const today = pickTodayLpSource({
    latestTs: latest.ts,
    latestCount: latest.count,
    historyTs: history.ts,
    historyCount: history.count,
  });
  const last = pickLastLpScan({
    latestTs: latest.ts,
    latestCount: latest.count,
    historyTs: history.ts,
    historyCount: history.count,
  });
  const source = today.present ? today : { ...last, present: false };
  let holders = [];
  if (includeHolders && source.kind !== "none" && source.ts) {
    holders = await pageSameTimeLpScan(db, source.kind, source.ts, pair, limit, offset);
  }
  return buildTodayLpOwnersPayload({ source, holders, offset, pool: pair });
}

async function loadLpTrustlineCount(db, pool = "all") {
  const pair = normalizeLpPool(pool);
  if (!pair) {
    const stats = await loadAllLpLineStats(db, false);
    return { count: stats.count, as_of: asIso(stats.ts), pool: "all", source: stats.source };
  }
  const history = await lastSameTimeLpScan(db, "lp_holders_history", pair, false);
  const latest = await tryQuery(
    db,
    `SELECT COUNT(*)::int AS n, MAX(timestamp) AS ts
     FROM lp_holders_latest
     WHERE ${lpPoolClause(pair).sql}`,
    lpPoolClause(pair).params
  );
  const latestCount = Number(latest.rows[0]?.n || 0);
  const historyCount = history.count;
  const count = pickTrustlineCount(latestCount, historyCount);
  const asOf = historyCount > 0 ? history.ts : latest.rows[0]?.ts;
  return { count, as_of: asIso(asOf), pool: pair };
}

async function loadAllLpSupply(db) {
  const lines = await loadAllLpLineStats(db, false);
  if (lines.supply > 0) return lines.supply;
  const catalog = await tryQueryIf(
    db,
    "xio_amm_pools",
    ["lp_supply"],
    "SELECT COALESCE(SUM(lp_supply::numeric), 0) AS n FROM xio_amm_pools"
  );
  const catalogSum = Number(catalog.rows[0]?.n || 0);
  if (catalogSum > 0) return catalogSum;
  const latest = await tryQueryIf(
    db,
    "amm_pool_latest",
    ["lp_supply"],
    `SELECT COALESCE(SUM(lp_supply::numeric), 0) AS n
     FROM amm_pool_latest
     WHERE pool_name ILIKE 'XIO/%' OR pool_name ILIKE 'XIO-%'`
  );
  return Number(latest.rows[0]?.n || 0);
}

function rowsForPair(rows, pair) {
  const name = normalizeOrderbookPair(pair);
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => normalizeOrderbookPair(row.pair) === name
  );
}

async function loadNativeBookRow(db, pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair);
  // Worker 2 writes `timestamp`. Do not SELECT updated_at — that column is
  // missing and tryQuery would swallow the error as an empty book.
  // Pair spellings differ (XIO-XRP, xio/xrp); match after normalize.
  const latest = await tryQueryIf(
    db,
    "order_book_latest",
    ["payload", "pair", "timestamp"],
    "SELECT payload, pair, timestamp FROM order_book_latest"
  );
  const history = await tryQueryIf(
    db,
    "order_book_history",
    ["payload", "pair", "timestamp"],
    `SELECT payload, pair, timestamp
     FROM order_book_history
     ORDER BY timestamp DESC
     LIMIT 200`
  );
  return pickNativeBookRow(rowsForPair(latest.rows, name)[0], rowsForPair(history.rows, name), name);
}

async function composeStoredBook(stored, pair, reserveIndex, xrpPool, pool, extras = {}) {
  const name = normalizeOrderbookPair(pair);
  const reserves = loadPairReserves(name, reserveIndex, xrpPool, pool);
  return composeAmmBook(stored || emptyOrderbook(name), reserves, name, extras);
}

const lastGoodBooks = new Map();

function rememberGoodBook(pair, book) {
  if (!bookHasNativeDex(book)) return;
  lastGoodBooks.set(normalizeOrderbookPair(pair), book);
}

async function withLiveTape(composed, pair, pool, extras = {}) {
  const name = normalizeOrderbookPair(pair);
  const live = await fillNativeBookFromXrpl(name, pool);
  if (live) {
    const filled = {
      ...composeAmmBook(
        { ...composed, ...live, bids: live.bids, asks: live.asks },
        {
          reserve_asset: composed.amm?.reserve_asset,
          reserve_currency: composed.amm?.reserve_currency,
          trading_fee: composed.amm?.trading_fee,
          price: composed.amm?.price,
        },
        name,
        extras
      ),
      as_of: live.as_of || composed.as_of,
      source: "xrpl",
    };
    rememberGoodBook(name, filled);
    return filled;
  }
  if (composed?.dex_present) rememberGoodBook(name, composed);
  return keepLastGoodBook(lastGoodBooks.get(name), composed, name);
}

async function loadOrderbook(db, pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair);
  const [picked, reserveIndex, xrpPool, lp] = await Promise.all([
    loadNativeBookRow(db, name),
    loadAmmReserveIndex(db),
    hydrateAmm(db),
    loadXioLpPools(db),
  ]);
  const pool = (lp.pools || []).find(
    (row) => normalizeOrderbookPair(row.pool_name || row.pool) === name
  );
  const stored = picked
    ? {
        ...asOrderbookPayload(picked.payload, name),
        as_of: asIso(picked.as_of),
        source: "db",
      }
    : emptyOrderbook(name);
  let extras = {};
  if (name !== "XIO/XRP") {
    const xrpBook = await loadOrderbook(db, "XIO/XRP");
    const reserves = loadPairReserves(name, reserveIndex, xrpPool, pool);
    extras = {
      xrpBook,
      quotePerXrp: quotePerXrpFromSpots(reserves.price, xrpBook?.amm?.price),
    };
  }
  const composed = await composeStoredBook(stored, name, reserveIndex, xrpPool, pool, extras);
  const filled = await withLiveTape(composed, name, pool, extras);
  return {
    ...filled,
    as_of: filled.as_of || stored.as_of || null,
  };
}

function loadPairReserves(pair, reserveIndex, xrpPool, pool) {
  const name = normalizeOrderbookPair(pair);
  const extra =
    reserveIndex?.byName?.get(name.toUpperCase()) ||
    reserveIndex?.byAmm?.get(pool?.amm_account) ||
    {};
  let reserveBase = Number(
    extra.reserve_asset || pool?.reserve_xio || pool?.reserve_asset || 0
  );
  let reserveQuote = Number(
    extra.reserve_currency || pool?.reserve_currency || pool?.reserve_quote || 0
  );
  const price = Number(extra.price || 0);
  const tradingFee = Number(extra.trading_fee || pool?.trading_fee || 1000);

  if (name === "XIO/XRP") {
    if (!(reserveBase > 0)) reserveBase = Number(xrpPool?.reserve_asset || 0);
    if (!(reserveQuote > 0)) reserveQuote = Number(xrpPool?.reserve_currency || 0);
  }

  if (reserveBase > 0 && !(reserveQuote > 0) && price > 0 && price < 10) {
    reserveQuote = reserveBase * price;
  }
  if (reserveBase > 0 && !(reserveQuote > 0)) {
    reserveQuote = inferQuoteReserve(reserveBase, pool?.xioUsd, pool?.quote_usd);
  }

  return {
    reserve_asset: reserveBase,
    reserve_currency: reserveQuote,
    trading_fee: tradingFee || Number(xrpPool?.trading_fee || 1000),
    price: price || (reserveBase > 0 && reserveQuote > 0 ? reserveQuote / reserveBase : null),
  };
}

async function loadOrderbooks(db) {
  const [lp, reserveIndex, xrpPool, storedRows, historyRows] = await Promise.all([
    loadXioLpPools(db),
    loadAmmReserveIndex(db),
    hydrateAmm(db),
    tryQueryIf(
      db,
      "order_book_latest",
      ["payload", "pair", "timestamp"],
      "SELECT payload, pair, timestamp FROM order_book_latest"
    ),
    tryQueryIf(
      db,
      "order_book_history",
      ["payload", "pair", "timestamp"],
      `SELECT payload, pair, timestamp
       FROM order_book_history
       ORDER BY timestamp DESC
       LIMIT 200`
    ),
  ]);

  const historyByPair = new Map();
  for (const row of historyRows.rows) {
    const name = normalizeOrderbookPair(row.pair);
    const key = name.toUpperCase();
    const list = historyByPair.get(key) || [];
    list.push(row);
    historyByPair.set(key, list);
  }

  const storedByPair = new Map();
  const latestByPair = new Map();
  for (const row of storedRows.rows) {
    const name = normalizeOrderbookPair(row.pair);
    latestByPair.set(name.toUpperCase(), row);
  }
  for (const [key, latest] of latestByPair) {
    const name = normalizeOrderbookPair(latest.pair || key);
    const picked = pickNativeBookRow(latest, historyByPair.get(key) || [], name);
    if (!picked) continue;
    storedByPair.set(name.toUpperCase(), {
      ...asOrderbookPayload(picked.payload, name),
      as_of: asIso(picked.as_of),
      source: "db",
    });
  }
  for (const [key, rows] of historyByPair) {
    if (storedByPair.has(key)) continue;
    const picked = pickNativeBookRow(null, rows, key);
    if (!picked) continue;
    storedByPair.set(key, {
      ...asOrderbookPayload(picked.payload, key),
      as_of: asIso(picked.as_of),
      source: "db",
    });
  }

  const poolNames = (lp.pools || []).map((row) => row.pool_name || row.pool);
  const pairs = sortOrderbookPairs([...FEATURED_ORDERBOOK_PAIRS, ...poolNames]);
  const liveSpecs = knownLivePoolSpecs(lp.pools || []);
  const lives = await loadLiveAmmReservesMany(
    liveSpecs.map((spec) => ({
      ammAccount: spec.ammAccount || spec.amm,
      pair: spec.pair,
      quote: spec.quote,
      issuer: spec.issuer,
      hex: spec.hex,
    })),
    { concurrency: 3, retries: 1, waitMs: 200, deadlineMs: 4500 }
  );
  const liveByPair = new Map();
  liveSpecs.forEach((spec, index) => {
    liveByPair.set(String(spec.pair || "").toUpperCase(), lives[index]);
  });
  const poolFor = (pair) => {
    const row = (lp.pools || []).find(
      (item) => normalizeOrderbookPair(item.pool_name || item.pool) === pair
    );
    return overlayLiveAmmReserves(row || { pool_name: pair, pool: pair }, liveByPair.get(pair.toUpperCase()));
  };
  const books = {};
  for (const pair of pairs) {
    const stored = storedByPair.get(pair.toUpperCase()) || emptyOrderbook(pair);
    const pool = poolFor(pair);
    const composed = await composeStoredBook(stored, pair, reserveIndex, xrpPool, pool);
    books[pair] = {
      ...composed,
      as_of: storedByPair.has(pair.toUpperCase()) ? stored.as_of : null,
      source: pool.reserve_source === "amm_info" ? "hybrid" : "db",
    };
  }

  const xrpPoolRow = poolFor("XIO/XRP");
  const xrpFilled = await withLiveTape(books["XIO/XRP"], "XIO/XRP", xrpPoolRow);
  books["XIO/XRP"] = {
    ...xrpFilled,
    as_of: xrpFilled.as_of || books["XIO/XRP"]?.as_of || null,
  };

  await Promise.all(
    FEATURED_ORDERBOOK_PAIRS.filter((pair) => pair !== "XIO/XRP").map(async (pair) => {
      const pool = poolFor(pair);
      const extras = {
        xrpBook: books["XIO/XRP"],
        quotePerXrp: quotePerXrpFromSpots(
          loadPairReserves(pair, reserveIndex, xrpPool, pool).price || books[pair]?.amm?.price,
          books["XIO/XRP"]?.amm?.price
        ),
      };
      const filled = await withLiveTape(books[pair], pair, pool, extras);
      books[pair] = {
        ...filled,
        as_of: filled.as_of || books[pair]?.as_of || null,
      };
    })
  );

  const xrpBook = books["XIO/XRP"];
  const xrpSpot = xrpBook?.amm?.price;
  for (const pair of pairs) {
    if (pair === "XIO/XRP") continue;
    const pool = poolFor(pair);
    const reserves = loadPairReserves(pair, reserveIndex, xrpPool, pool);
    const extras = {
      xrpBook,
      quotePerXrp: quotePerXrpFromSpots(reserves.price || books[pair]?.amm?.price, xrpSpot),
    };
    books[pair] = {
      ...composeAmmBook(books[pair], reserves, pair, extras),
      as_of: books[pair]?.as_of || null,
      source: books[pair]?.source || "db",
    };
  }

  return {
    quotes: pairs.map((pair) => pair.split("/")[1]).filter(Boolean),
    featured: FEATURED_ORDERBOOK_PAIRS,
    pairs,
    default_pair: "XIO/XRP",
    books,
    source: Object.values(books).some((book) => book.source === "xrpl") ? "xrpl" : "db",
  };
}

async function loadLpTrustlineChart(db, pool = "all") {
  const pair = normalizeLpPool(pool);
  const where = lpPoolClause(pair);
  // Always group by pool+timestamp. Mixing pools into one timestamp produced
  // false LP zeros when only one pool was scanned at that instant.
  const byScan = pair
    ? await tryQuery(
        db,
        `SELECT timestamp,
            COUNT(*)::int AS trustline_count,
            COUNT(*) FILTER (WHERE ABS(lp_balance::numeric) > 0)::int AS lp_holder_count,
            COALESCE(SUM(ABS(lp_balance::numeric)), 0) AS lp_supply,
            COALESCE(pool_name, 'XIO/XRP') AS pool_name
     FROM lp_holders_history
     WHERE ${where.sql}
     GROUP BY timestamp, COALESCE(pool_name, 'XIO/XRP')
     ORDER BY timestamp ASC`,
        where.params
      )
    : await tryQuery(
        db,
        `SELECT timestamp,
            COUNT(*)::int AS trustline_count,
            COUNT(*) FILTER (WHERE ABS(lp_balance::numeric) > 0)::int AS lp_holder_count,
            COALESCE(SUM(ABS(lp_balance::numeric)), 0) AS lp_supply,
            COALESCE(pool_name, 'XIO/XRP') AS pool_name
     FROM lp_holders_history
     GROUP BY timestamp, COALESCE(pool_name, 'XIO/XRP')
     ORDER BY timestamp ASC`
      );
  return (byScan.rows || []).map((row) => {
    const trustlines = Number(row.trustline_count);
    const holders = Number(row.lp_holder_count);
    const supply = Number(row.lp_supply);
    return {
      timestamp: asIso(row.timestamp) || row.timestamp,
      // Missing/empty partial scans stay null — client carries last known.
      trustline_count: Number.isFinite(trustlines) && trustlines > 0 ? trustlines : null,
      lp_holder_count: Number.isFinite(holders) && holders > 0 ? holders : null,
      lp_supply: Number.isFinite(supply) && supply > 0 ? supply : null,
      pool_name: row.pool_name || pair || "XIO/XRP",
    };
  });
}

async function loadAmmReserveIndex(db) {
  const byName = new Map();
  const byAmm = new Map();
  const take = (row, overwrite) => {
    if (!row) return;
    const name = String(row.pool_name || "").toUpperCase();
    const extra = {
      reserve_asset: Number(row.reserve_asset || 0),
      reserve_currency: Number(row.reserve_currency || 0),
      lp_supply: Number(row.lp_supply || 0) || null,
      trading_fee: Number.isFinite(Number(row.trading_fee)) ? Number(row.trading_fee) : 0,
      price: Number(row.price || 0) || null,
      timestamp: row.timestamp || null,
    };
    if (name && (overwrite || !byName.has(name))) byName.set(name, extra);
    const slash = name.replace(/-/g, "/");
    if (slash && (overwrite || !byName.has(slash))) byName.set(slash, extra);
    if (row.amm_account && (overwrite || !byAmm.has(row.amm_account))) {
      byAmm.set(row.amm_account, extra);
    }
  };

  const history = await tryQuery(
    db,
    `SELECT pool_name, reserve_asset, reserve_currency, lp_supply, price, timestamp
     FROM amm_pool_history
     WHERE reserve_asset::numeric > 0
     ORDER BY timestamp DESC
     LIMIT 8000`
  );
  for (const row of history.rows) take(row, false);

  const latest = await tryQuery(
    db,
    `SELECT pool_name, amm_account, reserve_asset, reserve_currency, lp_supply,
            trading_fee, timestamp
     FROM amm_pool_latest`
  );
  for (const row of latest.rows) take(row, true);
  return { byName, byAmm };
}

async function loadQuoteUsdMap(db, xrpUsd) {
  const prices = { XRP: Number(xrpUsd) || 0 };
  const latestKey = pickColumns(peekIndexerSchema(), "price_latest", ["asset", "token", "currency"])[0];
  const latest = latestKey
    ? await tryQueryIf(
        db,
        "price_latest",
        [latestKey, "price_usd"],
        `SELECT ${latestKey} AS asset, price_usd FROM price_latest`
      )
    : { rows: [] };
  for (const row of latest.rows) {
    const key = String(row.asset || "").toUpperCase();
    const usd = Number(row.price_usd);
    if (key && usd > 0 && !looksLikeXrpUsd(usd)) prices[key] = usd;
    else if (key && usd > 0 && key !== "XIO") prices[key] = usd;
  }
  const priceName = pickColumns(peekIndexerSchema(), "price_latest_all", ["currency", "asset"])[0];
  const all = priceName
    ? await tryQueryIf(
        db,
        "price_latest_all",
        [priceName, "price_usd"],
        `SELECT ${priceName} AS currency, price_usd FROM price_latest_all`
      )
    : { rows: [] };
  for (const row of all.rows) {
    const key = String(row.currency || "").toUpperCase();
    const usd = Number(row.price_usd);
    if (key && usd > 0 && prices[key] == null) prices[key] = usd;
  }
  return prices;
}

const accountCache = new Map();

function emptyWalletAccount(address) {
  return {
    account: address,
    balance_drops: null,
    owner_count: null,
    reserve_base_drops: 1_000_000,
    reserve_inc_drops: 200_000,
    source: "empty",
  };
}

async function loadWalletAccount(address) {
  const key = String(address || "");
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.body;
  try {
    const [info, state] = await Promise.all([
      withXrplRetry(() => xrplRpc("account_info", { account: key, ledger_index: "validated" })),
      withXrplRetry(() => xrplRpc("server_state", {})).catch(() => ({})),
    ]);
    const data = info.account_data || info.result?.account_data || {};
    const drops = xrpDropsFromAccountInfo(info);
    if (!(drops > 0)) return emptyWalletAccount(key);
    const ledger = state.validated_ledger || state.result?.validated_ledger || {};
    const body = {
      account: key,
      balance_drops: drops,
      owner_count: Number(data.OwnerCount || 0),
      reserve_base_drops: Number(ledger.reserve_base || 1_000_000),
      reserve_inc_drops: Number(ledger.reserve_inc || 200_000),
      source: "xrpl",
    };
    accountCache.set(key, { at: Date.now(), body });
    return body;
  } catch {
    return emptyWalletAccount(key);
  }
}

function normalizeWalletPairName(value) {
  return normalizeWalletPair(value);
}

function mergeWalletLpRows(rows, catalog) {
  const byPair = indexPoolsByPair(catalog.pools || []);
  const positions = new Map();
  for (const row of rows) {
    const tokens = Number(row.lp_balance || row.lp || 0);
    if (!(tokens > 0)) continue;
    const catalogPool = lookupLpPool(row, byPair);
    const position = lpPositionFromPool(
      tokens,
      mergeLpPoolSource(row, catalogPool),
      row.pool_name || row.pool || row.pair || catalogPool?.pool_name
    );
    if (!position) continue;
    const previous = positions.get(position.pool);
    if (!previous || position.lp_balance > previous.lp_balance) {
      positions.set(position.pool, position);
    }
  }
  return [...positions.values()];
}

async function loadLpSupplyByPool(db) {
  const latest = await tryQuery(
    db,
    `SELECT COALESCE(NULLIF(TRIM(pool_name), ''), 'XIO/XRP') AS pool_name,
            SUM(ABS(lp_balance::numeric)) AS lp_supply
     FROM lp_holders_latest
     WHERE ABS(lp_balance::numeric) > 0
     GROUP BY 1`
  );
  const history = await tryQuery(
    db,
    `WITH latest_ts AS (
       SELECT COALESCE(NULLIF(TRIM(pool_name), ''), 'XIO/XRP') AS pool_name,
              MAX(timestamp) AS ts
       FROM lp_holders_history
       GROUP BY 1
     )
     SELECT t.pool_name, SUM(ABS(h.lp_balance::numeric)) AS lp_supply
     FROM lp_holders_history h
     JOIN latest_ts t
       ON COALESCE(NULLIF(TRIM(h.pool_name), ''), 'XIO/XRP') = t.pool_name
      AND h.timestamp = t.ts
     WHERE ABS(h.lp_balance::numeric) > 0
     GROUP BY t.pool_name`
  );
  const map = new Map();
  for (const row of [...(history.rows || []), ...(latest.rows || [])]) {
    const name = normalizeWalletPairName(row.pool_name);
    const supply = Number(row.lp_supply || 0);
    if (name && supply > 0) map.set(name, supply);
  }
  return map;
}

async function loadAmmReserves(ammAccount) {
  const key = String(ammAccount || "").trim();
  if (!key) return null;
  const live = await loadLiveAmmReserves({ ammAccount: key });
  if (!live || live.reserve_source === "empty") return null;
  return live;
}

async function fillWalletLpFromLedger(positions) {
  return Promise.all(
    (positions || []).map(async (row) => {
      if (!row.amm_account) return row;
      const live = await loadAmmReserves(row.amm_account);
      if (!live) return row;
      return lpPositionFromPool(row.lp_balance, overlayLiveAmmReserves(row, live), row.pool) || row;
    })
  );
}

async function loadWalletLp(db, address) {
  const latest = await tryQuery(
    db,
    `SELECT pool_name, lp_balance::numeric AS lp_balance
     FROM lp_holders_latest
     WHERE account = $1 AND ABS(lp_balance::numeric) > 0`,
    [address]
  );
  const history = await tryQuery(
    db,
    `SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(pool_name), ''), '?'))
            COALESCE(NULLIF(TRIM(pool_name), ''), 'XIO/XRP') AS pool_name,
            lp_balance::numeric AS lp_balance
     FROM lp_holders_history
     WHERE account = $1 AND ABS(lp_balance::numeric) > 0
     ORDER BY COALESCE(NULLIF(TRIM(pool_name), ''), '?'), timestamp DESC`,
    [address]
  );
  const catalog = await loadXioLpPools(db);
  const positions = await fillWalletLpFromLedger(
    mergeWalletLpRows([...(history.rows || []), ...(latest.rows || [])], catalog)
  );
  return { account: address, positions, source: "db" };
}

async function loadWalletRank(db, address) {
  const latest = await lastSameTimeScan(db, "token_holders_latest");
  const history = await lastSameTimeScan(db, "token_holders_history");
  const today = pickTodayOwnerSource({
    latestTs: latest.ts,
    latestCount: latest.count,
    historyTs: history.ts,
    historyCount: history.count,
  });
  const last = pickLastOwnerScan({
    latestTs: latest.ts,
    latestCount: latest.count,
    historyTs: history.ts,
    historyCount: history.count,
  });
  const source = today.present ? today : last;
  if (!source.ts || source.kind === "none") return { account: address, rank: null, source: "empty" };
  const ranked = await tryQuery(
    db,
    `SELECT rank FROM (
        SELECT account,
               ROW_NUMBER() OVER (ORDER BY ABS(balance::numeric) DESC) AS rank
        FROM ${source.kind}
        WHERE timestamp = $1 AND ABS(balance::numeric) > 0
      ) ranked
      WHERE LOWER(account) = LOWER($2)
      LIMIT 1`,
    [source.ts, address]
  );
  const rank = Number(ranked.rows[0]?.rank);
  return {
    account: address,
    rank: Number.isFinite(rank) ? rank : null,
    source: source.kind,
    as_of: source.ts,
  };
}

async function loadXioLpPools(db) {
  const stored = await tryQuery(
    db,
    `SELECT amm_account, pool_name, quote, quote_issuer, quote_hex,
            lp_currency_hex, reserve_xio, updated_at
     FROM xio_amm_pools
     ORDER BY reserve_xio DESC NULLS LAST`
  );
  if (!stored.rows.length) {
    return { count: 0, pools: [], catching_up: true, source: "db" };
  }

  const extraCols = pickColumns(peekIndexerSchema(), "xio_amm_pools", [
    "reserve_quote",
    "reserve_currency",
    "lp_supply",
  ]);
  const optional = extraCols.length
    ? await tryQueryIf(
        db,
        "xio_amm_pools",
        extraCols,
        `SELECT amm_account, ${extraCols.join(", ")} FROM xio_amm_pools`
      )
    : { rows: [] };
  const optionalByAmm = new Map();
  for (const row of optional.rows) {
    optionalByAmm.set(row.amm_account, {
      quote: Number(row.reserve_quote || row.reserve_currency || 0),
      lp_supply: Number(row.lp_supply || 0) || null,
    });
  }

  const reserves = await loadAmmReserveIndex(db);
  const holderSupply = await loadLpSupplyByPool(db);
  const quote = await loadXrpQuote(db);
  const xrpUsd = Number(quote.usd || 0);
  const xioUsd = await loadRecordedXioUsd(db, xrpUsd);
  const quotePrices = attachQuoteXrpPrices(
    { ...(await loadQuoteUsdMap(db, xrpUsd)), xrpUsd },
    await loadQuoteXrpRates().catch(() => ({})),
    xrpUsd
  );

  const lives = await loadLiveAmmReservesMany(
    stored.rows.map((row) => ({
      ammAccount: row.amm_account,
      pair: row.pool_name,
      quote: row.quote,
      issuer: row.quote_issuer,
      hex: row.quote_hex,
    })),
    { concurrency: 3, retries: 1, waitMs: 200, deadlineMs: 4500 }
  );

  const pools = stored.rows.map((row, index) => {
    const extra =
      reserves.byAmm.get(row.amm_account) ||
      reserves.byName.get(String(row.pool_name || "").toUpperCase()) ||
      reserves.byName.get(`XIO/${String(row.quote || "").toUpperCase()}`) ||
      {};
    const optional = optionalByAmm.get(row.amm_account) || {};
    const reserveXio = Number(row.reserve_xio || extra.reserve_asset || 0);
    const measuredQuote =
      Number(optional.quote || 0) || Number(extra.reserve_currency || 0) || 0;
    const quoteUsd = quoteUsdFromMap(row.quote, quotePrices);
    const lpSupply =
      extra.lp_supply ||
      optional.lp_supply ||
      holderSupply.get(normalizeWalletPairName(row.pool_name || row.quote)) ||
      null;
    const reserveQuote = measuredQuote || null;
    const built = {
      pool_name: row.pool_name,
      pool: row.pool_name,
      amm_account: row.amm_account,
      quote: row.quote,
      quote_issuer: row.quote_issuer,
      quote_hex: row.quote_hex,
      lp_currency: row.lp_currency_hex,
      reserve_xio: reserveXio,
      reserve_asset: reserveXio,
      reserve_currency: reserveQuote,
      xioUsd,
      quote_usd: quoteUsd || null,
      lp_supply: lpSupply,
      trading_fee: Number.isFinite(Number(extra.trading_fee)) ? Number(extra.trading_fee) : 0,
      updated: extra.timestamp || row.updated_at,
    };
    const overlaid = overlayLiveAmmReserves(built, lives[index]);
    const split = resolvePoolSplit({
      reserveXio: overlaid.reserve_xio,
      reserveQuote: overlaid.reserve_currency,
      lpSupply: overlaid.lp_supply,
      price: extra.price,
      xioUsd,
      quoteUsd,
    });
    return {
      ...overlaid,
      xio_pct: split?.xioPct ?? null,
      quote_pct: split?.quotePct ?? null,
      lead: split?.lead || null,
      updated:
        overlaid.reserve_source === "amm_info" ? new Date().toISOString() : overlaid.updated,
    };
  });

  const pairs = pools.map((row) => row.pool_name || row.pool).filter(Boolean);
  const [freeVolumes, ledgerVolumes] = await Promise.all([
    loadPoolXioVolumes({
      token: { exchXrp: xrpUsd > 0 && xioUsd > 0 ? xioUsd / xrpUsd : 0 },
      reserveXio: Number(pools[0]?.reserve_asset || 0),
      reserveXrp: Number(pools[0]?.reserve_currency || 0),
      xioUsd,
      xrpUsd,
      pairs,
    }).catch(() => ({})),
    loadLedgerPoolVolumes(pools).catch(() => ({})),
  ]);
  const withVolume = applyPoolVolumes(pools, mergeVolumeMaps(freeVolumes, ledgerVolumes));

  return {
    count: withVolume.length,
    pools: withVolume,
    catching_up: false,
    source: "db",
  };
}

async function tokenHoldersPage(db, limit, offset, options = {}) {
  const page = options.todayOnly
    ? await loadTodayOwners(db, { limit, offset, includeHolders: true })
    : await freshTokenHolders(db, limit, offset, options);
  return {
    ...page,
    rows: page.holders,
  };
}

async function loadLongHolderSeries(db) {
  const [issued, holders, trustlines] = await Promise.all([
    loadIssuedHolderHistory().catch(() => []),
    tokenHolderCount(db),
    tokenTrustlineCount(db),
  ]);
  const last = issued[issued.length - 1];
  const liveTradersRaw = last?.traders ?? last?.trader_count;
  const liveTraders =
    liveTradersRaw == null || liveTradersRaw === ""
      ? null
      : Number(liveTradersRaw);
  return carryActivityMetrics(
    issuedActivitySeries(
      issued,
      holders || trustlines || liveTraders != null
        ? {
            timestamp: new Date().toISOString(),
            holders,
            holder_count: holders,
            trustlines,
            trustline_count: trustlines,
            traders: Number.isFinite(liveTraders) ? liveTraders : null,
            trader_count: Number.isFinite(liveTraders) ? liveTraders : null,
            source: "live",
          }
        : null
    )
  );
}

async function nativeTraderSeries(db) {
  return loadLongHolderSeries(db);
}

async function nativeActivitySeries(db) {
  return loadLongHolderSeries(db);
}

async function nativeXioFlows(db) {
  return readAmmTrades(db);
}

const ISSUER_POLL_MS = 30_000;
let issuerLockedCache = { at: 0, issued: 0, locked: 0, source: null, as_of: null };

async function issuedXioFromHolders(db) {
  const history = await tryQuery(
    db,
    `SELECT COALESCE(SUM(ABS(balance::numeric)), 0) AS issued
     FROM token_holders_history
     WHERE timestamp = (SELECT MAX(timestamp) FROM token_holders_history)
       AND ABS(balance::numeric) > 0
       AND account <> $1`,
    [XIO_ISSUER]
  );
  const latest = await tryQuery(
    db,
    `SELECT COALESCE(SUM(ABS(balance::numeric)), 0) AS issued
     FROM token_holders_latest
     WHERE ABS(balance::numeric) > 0
       AND account <> $1`,
    [XIO_ISSUER]
  );
  const historyIssued = Number(history.rows[0]?.issued || 0);
  const latestIssued = Number(latest.rows[0]?.issued || 0);
  return historyIssued > 0 ? historyIssued : latestIssued;
}

async function loadIssuerLocked(db) {
  if (Date.now() - issuerLockedCache.at < ISSUER_POLL_MS && issuerLockedCache.locked > 0) {
    return issuerLockedCache;
  }
  const issued = db ? await issuedXioFromHolders(db) : 0;
  const locked = issuerLockedFromIssued(issued);
  issuerLockedCache = {
    at: Date.now(),
    issued,
    locked,
    source: "db",
    as_of: new Date().toISOString(),
  };
  return issuerLockedCache;
}

const BLACKHOLE_POLL_MS = 6 * 60 * 60 * 1000;
let issuerBlackholeCache = { at: 0, body: null };

async function loadIssuerBlackhole() {
  if (issuerBlackholeCache.body && Date.now() - issuerBlackholeCache.at < BLACKHOLE_POLL_MS) {
    return issuerBlackholeCache.body;
  }
  try {
    const info = await xrplRpc("account_info", {
      account: XIO_ISSUER,
      ledger_index: "validated",
    });
    const detected = issuerBlackholeFromAccount(info);
    let at = issuerBlackholeCache.body?.blackholed_at || null;
    if (detected.blackholed && !at) {
      try {
        const history = await xrplRpc("account_tx", {
          account: XIO_ISSUER,
          ledger_index_min: -1,
          ledger_index_max: -1,
          limit: 20,
          forward: true,
        });
        at = blackholeAtFromTransactions(history.transactions);
      } catch {
        at = null;
      }
    }
    const body = {
      blackholed: detected.blackholed,
      blackholed_fixed: detected.fixed,
      blackholed_at: detected.blackholed ? at || XIO_BLACKHOLED_AT : null,
      source: "xrpl",
    };
    issuerBlackholeCache = { at: Date.now(), body };
    return body;
  } catch {
    return (
      issuerBlackholeCache.body || {
        blackholed: null,
        blackholed_fixed: null,
        blackholed_at: null,
        source: "empty",
      }
    );
  }
}

async function tokenBalanceFor(db, address) {
  const latest = await tryQuery(
    db,
    "SELECT balance FROM token_holders_latest WHERE account = $1 LIMIT 1",
    [address]
  );
  if (latest.rows[0]) {
    const n = Number(latest.rows[0].balance);
    return Number.isFinite(n) ? n : null;
  }
  const history = await tryQuery(
    db,
    `SELECT balance
     FROM token_holders_history
     WHERE account = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [address]
  );
  if (!history.rows[0]) return null;
  const n = Number(history.rows[0].balance);
  return Number.isFinite(n) ? n : null;
}

let xrpQuote = { at: 0, usd: 0, gbp: 0, eur: 0, jpy: 0 };

function xioFxFromXrp(xioUsd, xrpUsd, xrpFx) {
  return xioUsd > 0 && xrpFx && xrpUsd > 0 ? xioUsd * (Number(xrpFx) / Number(xrpUsd)) : 0;
}

async function loadXrpQuote(db) {
  if (Date.now() - xrpQuote.at < 300_000 && xrpQuote.usd) return xrpQuote;
  const latestKey = pickColumns(peekIndexerSchema(), "price_latest", ["asset", "token", "currency"])[0];
  const latestVals = pickColumns(peekIndexerSchema(), "price_latest", ["price_usd", "price_gbp"]);
  const latest =
    latestKey && latestVals.includes("price_usd")
      ? await tryQueryIf(
          db,
          "price_latest",
          [latestKey, ...latestVals],
          `SELECT ${latestVals.join(", ")} FROM price_latest
     WHERE ${latestKey} IN ('XRP', 'xrp')
     ORDER BY timestamp DESC NULLS LAST
     LIMIT 1`
        )
      : { rows: [] };
  const xrpName = pickColumns(peekIndexerSchema(), "price_latest_all", ["currency", "asset"])[0];
  const xrpVals = pickColumns(peekIndexerSchema(), "price_latest_all", ["price_usd", "price_gbp"]);
  const all =
    xrpName && xrpVals.includes("price_usd")
      ? await tryQueryIf(
          db,
          "price_latest_all",
          [xrpName, ...xrpVals],
          `SELECT ${xrpVals.join(", ")} FROM price_latest_all
     WHERE ${xrpName} IN ('XRP', 'xrp')
     ORDER BY timestamp DESC NULLS LAST
     LIMIT 1`
        )
      : { rows: [] };
  const histKey = pickColumns(peekIndexerSchema(), "price_history", ["asset", "token"])[0];
  const hist = histKey
    ? await tryQueryIf(
        db,
        "price_history",
        [histKey, "price_usd"],
        `SELECT price_usd FROM price_history
     WHERE ${histKey} IN ('XRP', 'xrp')
     ORDER BY timestamp DESC LIMIT 1`
      )
    : { rows: [] };
  const row = latest.rows[0] || all.rows[0] || {};
  let usd = Number(row.price_usd || hist.rows[0]?.price_usd || 0);
  let gbp = Number(row.price_gbp || 0);
  let eur = Number(xrpQuote.eur || 0);
  let jpy = Number(xrpQuote.jpy || 0);
  if (!looksLikeXrpUsd(usd)) usd = 0;
  if (!usd || !gbp || !eur || !jpy) {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd,gbp,eur,jpy",
        { headers: FREE_API_HEADERS, signal: AbortSignal.timeout(4000) }
      );
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const body = await res.json();
      usd = Number(body?.ripple?.usd || usd || 0);
      gbp = Number(body?.ripple?.gbp || gbp || 0);
      eur = Number(body?.ripple?.eur || eur || 0);
      jpy = Number(body?.ripple?.jpy || jpy || 0);
    } catch {
      usd = usd || 0;
    }
  }
  xrpQuote = { at: Date.now(), usd, gbp, eur, jpy };
  return xrpQuote;
}

async function loadRecordedXioUsd(db, xrpUsd) {
  const latestCol = await tryQueryIf(
    db,
    "price_latest",
    ["xio_usd"],
    `SELECT xio_usd FROM price_latest
     ORDER BY timestamp DESC NULLS LAST
     LIMIT 1`
  );
  const fromLatest = recordedXioUsdFromPrices(
    { recorded_price: latestCol.rows[0]?.xio_usd, xioUsd: latestCol.rows[0]?.xio_usd, xrpUsd },
    xrpUsd
  );
  if (fromLatest > 0) return fromLatest;

  const latestKey = pickColumns(peekIndexerSchema(), "price_latest", ["asset", "token", "currency"])[0];
  const latestAsset = latestKey
    ? await tryQueryIf(
        db,
        "price_latest",
        [latestKey, "price_usd"],
        `SELECT price_usd FROM price_latest
     WHERE ${latestKey} IN ('XIO', 'xio')
     ORDER BY timestamp DESC NULLS LAST
     LIMIT 1`
      )
    : { rows: [] };
  const allKey = pickColumns(peekIndexerSchema(), "price_latest_all", ["currency", "asset"])[0];
  const all = allKey
    ? await tryQueryIf(
        db,
        "price_latest_all",
        [allKey, "price_usd"],
        `SELECT price_usd FROM price_latest_all
     WHERE ${allKey} IN ('XIO', 'xio')
     ORDER BY timestamp DESC NULLS LAST
     LIMIT 1`
      )
    : { rows: [] };
  const histKey = pickColumns(peekIndexerSchema(), "price_history", ["asset", "token"])[0];
  const hist = histKey
    ? await tryQueryIf(
        db,
        "price_history",
        [histKey, "price_usd"],
        `SELECT price_usd FROM price_history
     WHERE ${histKey} IN ('XIO', 'xio')
     ORDER BY timestamp DESC
     LIMIT 1`
      )
    : { rows: [] };
  return recordedXioUsdFromPrices(
    {
      xioUsd:
        latestAsset.rows[0]?.price_usd ||
        all.rows[0]?.price_usd ||
        hist.rows[0]?.price_usd ||
        0,
      xrpUsd,
    },
    xrpUsd
  );
}

async function hydrateAmm(db) {
  const latest = await tryQuery(
    db,
    `SELECT * FROM amm_pool_latest WHERE pool_name = 'XIO/XRP' LIMIT 1`
  );
  const row = { ...(latest.rows[0] || {}) };
  if (!(Number(row.reserve_currency) > 0)) {
    const hist = await tryQuery(
      db,
      `SELECT reserve_asset, reserve_currency, lp_supply, price, timestamp
       FROM amm_pool_history
       WHERE pool_name = 'XIO/XRP' AND reserve_currency::numeric > 0
       ORDER BY timestamp DESC
       LIMIT 1`
    );
    if (hist.rows[0]) {
      row.reserve_currency = hist.rows[0].reserve_currency;
      if (!Number(row.reserve_asset)) row.reserve_asset = hist.rows[0].reserve_asset;
      if (!Number(row.price)) row.price = hist.rows[0].price;
      row.reserve_source = "amm_pool_history";
    }
  }
  return row;
}

function poolKey(row, fallback) {
  return String(row?.amm_account || row?.pool_name || row?.pool || fallback || "").toLowerCase();
}

function poolTvlUsd(name, asset, quote, xioUsd, xrpUsd) {
  if (/\/XRP$/i.test(String(name || "")) && quote > 0 && xrpUsd > 0) {
    return quote * 2 * xrpUsd;
  }
  if (asset > 0 && xioUsd > 0) return asset * 2 * xioUsd;
  return 0;
}

function presentPool(row, xioUsd, xrpUsd) {
  const reserveAsset = Number(row.reserve_asset || 0);
  const reserveCurrency = Number(row.reserve_currency || 0);
  const name = row.pool_name || row.pool || "XIO/XRP";
  const tvl = poolTvlUsd(name, reserveAsset, reserveCurrency, xioUsd, xrpUsd);
  return {
    pool: name,
    pool_name: name,
    amm_account: row.amm_account || row.amm || null,
    tvl,
    tvl_usd: tvl,
    price: xioUsd,
    reserve_asset: reserveAsset,
    reserve_currency: reserveCurrency,
    lp_supply: Number(row.lp_supply || 0),
    trading_fee: Number.isFinite(Number(row.trading_fee)) ? Number(row.trading_fee) : 0,
    apr: Number(row.apr || 0) || null,
    volume24h: Number(row.volume24h || row.volume_24h || 0) || null,
    updated: row.timestamp || row.updated || null,
  };
}

async function listXioPools(db) {
  const latest = await tryQuery(db, "SELECT * FROM amm_pool_latest");
  const history = await tryQuery(
    db,
    `SELECT pool_name, reserve_asset, reserve_currency, lp_supply, price, timestamp
     FROM amm_pool_history
     ORDER BY timestamp DESC
     LIMIT 4000`
  );
  const byKey = new Map();

  const take = (row, overwrite) => {
    let key = poolKey(row);
    if (!key) {
      key = `anon-${byKey.size}-${Number(row.reserve_asset || 0)}-${Number(row.lp_supply || 0)}`;
    }
    const prev = byKey.get(key);
    if (!prev || overwrite) {
      byKey.set(key, { ...prev, ...row });
      return;
    }
    const next = { ...prev };
    if (!(Number(next.reserve_asset) > 0) && Number(row.reserve_asset) > 0) {
      next.reserve_asset = row.reserve_asset;
    }
    if (!(Number(next.reserve_currency) > 0) && Number(row.reserve_currency) > 0) {
      next.reserve_currency = row.reserve_currency;
    }
    if (!(Number(next.lp_supply) > 0) && Number(row.lp_supply) > 0) {
      next.lp_supply = row.lp_supply;
    }
    if (!(Number(next.price) > 0) && Number(row.price) > 0) {
      next.price = row.price;
    }
    byKey.set(key, next);
  };

  for (const row of latest.rows) take(row, true);
  for (const row of history.rows) {
    const key = poolKey(row);
    if (!key) continue;
    if (!byKey.has(key)) take(row, true);
    else take(row, false);
  }

  return [...byKey.values()];
}

async function readAmmTrades(db) {
  const tradeCols = pickColumns(peekIndexerSchema(), "trades", [
    "timestamp",
    "pool_name",
    "side",
    "amount",
    "xio",
    "price",
    "account",
  ]);
  const named = tradeCols.includes("timestamp")
    ? await tryQueryIf(
        db,
        "trades",
        tradeCols,
        `SELECT ${tradeCols.join(", ")}
     FROM trades
     ORDER BY timestamp DESC
     LIMIT 500`
      )
    : { rows: [] };
  const namedPrints = named.rows.map((row) => ({
    timestamp: row.timestamp,
    pool: row.pool_name || "XIO/XRP",
    side: String(row.side || "").toLowerCase() === "sell" ? "sell" : "buy",
    xio: Number(row.xio || row.amount || 0),
    quote: Number(row.quote || 0),
    price: Number(row.price || 0),
    account: row.account || null,
  }));

  const history = await tryQuery(
    db,
    `SELECT timestamp, pool_name, reserve_asset::numeric AS reserve_asset,
            reserve_currency::numeric AS reserve_currency, price
     FROM (
       SELECT timestamp, pool_name, reserve_asset, reserve_currency, price
       FROM amm_pool_history
       WHERE reserve_asset IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT 4000
     ) recent
     ORDER BY pool_name ASC, timestamp ASC`
  );
  const latest = await tryQuery(
    db,
    `SELECT timestamp, pool_name, reserve_asset::numeric AS reserve_asset,
            reserve_currency::numeric AS reserve_currency, price
     FROM amm_pool_latest`
  );
  const rows = [...history.rows, ...latest.rows].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  return mergeTradePrints(namedPrints, inferTradesFromHistory(rows));
}

async function loadCatalogAmmMarketCap(db, xioUsd) {
  if (!(xioUsd > 0)) return 0;
  const catalog = await tryQuery(
    db,
    `SELECT COALESCE(SUM(reserve_xio::numeric), 0) AS n FROM xio_amm_pools`
  );
  const xio = Number(catalog.rows[0]?.n || 0);
  return xio > 0 ? xio * 2 * xioUsd : 0;
}

async function buildPrices(db) {
  const quote = await loadXrpQuote(db);
  const xrpUsd = Number(quote.usd || 0);
  const xioUsd = await loadRecordedXioUsd(db, xrpUsd);
  const quoteMap = await loadQuoteUsdMap(db, xrpUsd);
  const quotes = { ...quoteMap, XRP: xrpUsd || Number(quoteMap.XRP) || 0 };
  delete quotes.XIO;
  delete quotes.xio;
  const liveRates = await loadQuoteXrpRates().catch(() => ({}));
  return attachQuoteXrpPrices(
    {
      xrpUsd,
      xrpGbp: Number(quote.gbp || 0),
      xrpEur: Number(quote.eur || 0),
      xrpJpy: Number(quote.jpy || 0),
      xioUsd,
      recorded_price: xioUsd,
      xioGbp: xioFxFromXrp(xioUsd, xrpUsd, quote.gbp),
      xioEur: xioFxFromXrp(xioUsd, xrpUsd, quote.eur),
      xioJpy: xioFxFromXrp(xioUsd, xrpUsd, quote.jpy),
      quotes,
      ...quotes,
      source: "db",
    },
    liveRates,
    xrpUsd
  );
}

async function buildTokenOverview(db) {
  const [amm, quote, holders, trustlines, issuerLocked, blackhole, ammXio] = await Promise.all([
    hydrateAmm(db),
    loadXrpQuote(db),
    tokenHolderCount(db),
    tokenTrustlineCount(db),
    loadIssuerLocked(db),
    loadIssuerBlackhole(),
    tokenBalanceFor(db, XIO_XRP_AMM),
  ]);

  const reserveAsset = Number(amm.reserve_asset || 0);
  const reserveCurrency = Number(amm.reserve_currency || 0);
  const xrpUsd = Number(quote.usd || 0);
  const xioUsd = await loadRecordedXioUsd(db, xrpUsd);
  const tvlUsd = reserveCurrency > 0 && xrpUsd > 0 ? reserveCurrency * 2 * xrpUsd : 0;
  const totalSupply = XIO_TOTAL_SUPPLY;
  const burned = Number(issuerLocked.locked || 0);
  const circulating = Math.max(totalSupply - burned, 0);
  const ammMarketCap = (await loadCatalogAmmMarketCap(db, xioUsd)) || tvlUsd;

  return {
    pool: amm.pool_name || "XIO/XRP",
    tvl: tvlUsd || reserveCurrency || 0,
    tvl_usd: tvlUsd,
    price: xioUsd,
    xioUsd,
    recorded_price: xioUsd,
    xioGbp: xioFxFromXrp(xioUsd, xrpUsd, quote.gbp),
    xioEur: xioFxFromXrp(xioUsd, xrpUsd, quote.eur),
    xioJpy: xioFxFromXrp(xioUsd, xrpUsd, quote.jpy),
    xrpUsd,
    xrpGbp: Number(quote.gbp || 0),
    xrpEur: Number(quote.eur || 0),
    xrpJpy: Number(quote.jpy || 0),
    xio_per_xrp: xrpPerXio(xioUsd, xrpUsd),
    xioPerXrp: xrpPerXio(xioUsd, xrpUsd),
    apr: Number(amm.apr || 0),
    volume24h: Number(amm.volume24h || 0),
    reserve_asset: reserveAsset,
    reserve_currency: reserveCurrency,
    lp_supply: Number(amm.lp_supply || 0) || null,
    trading_fee: Number(amm.trading_fee || 0) || null,
    holder_count: holders,
    lp_holder_count: null,
    lp_trustline_count: null,
    circulating,
    circulating_supply: circulating,
    total_supply: totalSupply,
    burned_supply: burned,
    issuer_locked: burned,
    issued_xio: Number(issuerLocked.issued || 0),
    issuer_source: issuerLocked.source,
    amm_xio: Number(ammXio || reserveAsset || 0),
    trustlines,
    trustline_count: trustlines,
    ammMarketCap,
    xrplMarketCap: totalSupply * xioUsd,
    circulatingMarketCap: circulating * xioUsd,
    issuer: XIO_ISSUER,
    blackholed: blackhole.blackholed,
    blackholed_fixed: blackhole.blackholed_fixed,
    blackholed_at: blackhole.blackholed_at,
    amm_account: XIO_XRP_AMM,
    updated: amm.timestamp,
    reserve_source: amm.reserve_source || "amm_pool_latest",
    source: "db",
  };
}

async function buildSnapshot(db) {
  const [amm, quote, holders, trustlines, lpOwners, lpTrustlines, lpSupply, issuerLocked, blackhole, ammXio] =
    await Promise.all([
      hydrateAmm(db),
      loadXrpQuote(db),
      tokenHolderCount(db),
      tokenTrustlineCount(db),
      loadAllLpLineStats(db, true),
      loadLpTrustlineCount(db, "all"),
      loadAllLpSupply(db),
      loadIssuerLocked(db),
      loadIssuerBlackhole(),
      tokenBalanceFor(db, XIO_XRP_AMM),
    ]);

  const reserveAsset = Number(amm.reserve_asset || 0);
  const reserveCurrency = Number(amm.reserve_currency || 0);
  const xrpUsd = Number(quote.usd || 0);
  const xioUsd = await loadRecordedXioUsd(db, xrpUsd);
  const tvlUsd = reserveCurrency > 0 && xrpUsd > 0 ? reserveCurrency * 2 * xrpUsd : 0;
  const totalSupply = XIO_TOTAL_SUPPLY;
  const burned = Number(issuerLocked.locked || 0);
  const circulating = Math.max(totalSupply - burned, 0);
  const pools = (await listXioPools(db)).map((row) => presentPool(row, xioUsd, xrpUsd));
  const ammMarketCap = pools.reduce((sum, pool) => sum + Number(pool.tvl || 0), 0) || tvlUsd;

  return {
    pool: amm.pool_name || "XIO/XRP",
    tvl: tvlUsd || reserveCurrency || 0,
    tvl_usd: tvlUsd,
    price: xioUsd,
    xioUsd,
    recorded_price: xioUsd,
    xioGbp: xioFxFromXrp(xioUsd, xrpUsd, quote.gbp),
    xioEur: xioFxFromXrp(xioUsd, xrpUsd, quote.eur),
    xioJpy: xioFxFromXrp(xioUsd, xrpUsd, quote.jpy),
    xrpUsd,
    xrpGbp: Number(quote.gbp || 0),
    xrpEur: Number(quote.eur || 0),
    xrpJpy: Number(quote.jpy || 0),
    xio_per_xrp: xrpPerXio(xioUsd, xrpUsd),
    xioPerXrp: xrpPerXio(xioUsd, xrpUsd),
    apr: Number(amm.apr || 0),
    volume24h: Number(amm.volume24h || 0),
    reserve_asset: reserveAsset,
    reserve_currency: reserveCurrency,
    lp_supply: Number(lpSupply || amm.lp_supply || 0),
    trading_fee: Number(amm.trading_fee || 0) || null,
    holder_count: holders,
    lp_holder_count: Number(lpOwners.count || 0),
    lp_trustline_count: Number(lpTrustlines.count || 0),
    circulating,
    circulating_supply: circulating,
    total_supply: totalSupply,
    burned_supply: burned,
    issuer_locked: burned,
    issued_xio: Number(issuerLocked.issued || 0),
    issuer_source: issuerLocked.source,
    amm_xio: Number(ammXio || reserveAsset || 0),
    trustlines,
    trustline_count: trustlines,
    ammMarketCap,
    xrplMarketCap: totalSupply * xioUsd,
    circulatingMarketCap: circulating * xioUsd,
    pools,
    issuer: XIO_ISSUER,
    blackholed: blackhole.blackholed,
    blackholed_fixed: blackhole.blackholed_fixed,
    blackholed_at: blackhole.blackholed_at,
    amm_account: XIO_XRP_AMM,
    updated: amm.timestamp,
    reserve_source: amm.reserve_source || "amm_pool_latest",
    source: "db",
  };
}

function walletFresh(search) {
  return new URLSearchParams(String(search || "").replace(/^\?/, "")).get("fresh") === "1";
}

function walletLedgerResult(suffix, search = "") {
  const fresh = { fresh: walletFresh(search) };
  const offers = String(suffix || "").match(/^wallet\/offers\/([^/]+)$/);
  if (offers) {
    return loadWalletOffers(decodeURIComponent(offers[1]), fresh).then((body) => ok(body));
  }
  const lines = String(suffix || "").match(/^wallet\/lines\/([^/]+)$/);
  if (lines) {
    return loadWalletLines(decodeURIComponent(lines[1]), fresh).then((body) => ok(body));
  }
  const activity = String(suffix || "").match(/^wallet\/activity\/([^/]+)$/);
  if (activity) {
    return loadWalletActivity(decodeURIComponent(activity[1]), fresh).then((body) => ok(body));
  }
  const lpIncome = String(suffix || "").match(/^wallet\/lp-income\/([^/]+)$/);
  if (lpIncome) {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    let marker = null;
    const rawMarker = params.get("marker");
    if (rawMarker) {
      try {
        const parsed = JSON.parse(rawMarker);
        if (parsed && typeof parsed === "object") marker = parsed;
      } catch {
        marker = null;
      }
    }
    return loadLiveMarket({ fresh: walletFresh(search) })
      .catch(() => null)
      .then((market) =>
        loadWalletLpIncome(decodeURIComponent(lpIncome[1]), {
          fresh: walletFresh(search),
          pair: params.get("pair") || "ALL",
          marker,
          pools: market?.pools || [],
        })
      )
      .then((body) => ok(body));
  }
  const votes = String(suffix || "").match(/^wallet\/votes\/([^/]+)$/);
  if (votes) {
    return loadWalletVotes(decodeURIComponent(votes[1])).then((body) => ok(body));
  }
  if (suffix === "amm/governance") {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return loadPoolGovernance(params.get("pair") || "XIO/XRP", params.get("account") || "", {
      issuer: params.get("issuer") || params.get("quote_issuer"),
      hex: params.get("hex") || params.get("quote_hex"),
      ammAccount: params.get("amm") || params.get("amm_account"),
      lpBalance: params.get("lp") || params.get("lp_balance"),
    }).then((body) => ok(body));
  }
  if (suffix === "swap-market") {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return loadDirectPairMarket({
      from: params.get("from") || params.get("fromId"),
      to: params.get("to") || params.get("toId"),
      fromIssuer: params.get("fromIssuer") || params.get("from_issuer"),
      toIssuer: params.get("toIssuer") || params.get("to_issuer"),
      fromHex: params.get("fromHex") || params.get("from_hex"),
      toHex: params.get("toHex") || params.get("to_hex"),
      fresh: params.get("fresh") === "1",
    }).then((body) => ok(body));
  }
  if (suffix === "lp-pools/live") {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return loadLiveAmmReserves({
      pair: params.get("pair") || params.get("pool") || "XIO/XRP",
      ammAccount: params.get("amm") || params.get("amm_account"),
      quote: params.get("quote"),
      issuer: params.get("issuer") || params.get("quote_issuer"),
      hex: params.get("hex") || params.get("quote_hex"),
      fresh: params.get("fresh") === "1",
    }).then((body) => ok(body));
  }
  const account = String(suffix || "").match(/^wallet\/account\/([^/]+)$/);
  if (account) {
    return loadWalletAccount(decodeURIComponent(account[1])).then((body) => ok(body));
  }
  const balances = String(suffix || "").match(/^(?:wallet\/)?balances\/([^/]+)$/);
  if (balances) {
    const address = decodeURIComponent(balances[1]);
    return (async () => {
      const body = await loadWalletBalancesFromLedger(address, {
        fresh: walletFresh(search),
      });
      if (!(Number(body.xio) > 0) && hasIndexerDatabase()) {
        try {
          const fromDb = await tokenBalanceFor(getPool(), address);
          const merged = preferPositiveAmount(body.xio, fromDb);
          if (merged != null) body.xio = merged;
        } catch {
          // live total stands
        }
      }
      return ok(body);
    })();
  }
  const walletLp = String(suffix || "").match(/^wallet\/lp\/([^/]+)$/);
  if (walletLp) {
    return loadWalletLpFromLedger(decodeURIComponent(walletLp[1]), {
      fresh: walletFresh(search),
    }).then((body) => ok(body));
  }
  const networth = String(suffix || "").match(/^wallet\/networth\/([^/]+)$/);
  if (networth) {
    return loadWalletNetworthFromLedger(decodeURIComponent(networth[1]), {
      fresh: walletFresh(search),
    }).then((body) => ok(body));
  }
  return null;
}

async function serveLiveOrLastGood(suffix, search = "") {
  return serveCatalogFallback(suffix, (path) => liveCatalogPayload(path, { search }));
}

async function withLiveCatalog(suffix, dbBody, search = "") {
  return overlayDbResultWithLive(suffix, ok(dbBody), (path) => liveCatalogPayload(path, { search }));
}

export async function readIndexerDb(suffix, search = "") {
  const ledger = walletLedgerResult(suffix, search);
  if (ledger) return ledger;


  // Liquid pair book/amm/pairs: no Postgres required (XRPL direct fallback).
  if (suffix === "pairs") {
    return ok({
      watch_pairs: ["XRP/RLUSD", "XIO/XRP", "XIO/RLUSD"],
      pairs: [
        { pair: "XRP/RLUSD", liquid: true, endpoints: { book: "/api/book/XRP/RLUSD", amm: "/api/amm/XRP/RLUSD" } },
        { pair: "XIO/XRP", liquid: true, endpoints: { book: "/api/book/XIO/XRP", amm: "/api/amm/XIO/XRP" } },
        { pair: "XIO/RLUSD", liquid: true, endpoints: { book: "/api/book/XIO/RLUSD", amm: "/api/amm/XIO/RLUSD" } },
      ],
      rlusd: {
        issuer: process.env.RLUSD_ISSUER || RLUSD_ISSUER,
        currency: "RLUSD",
        currency_hex: process.env.RLUSD_CURRENCY_HEX || RLUSD_HEX,
      },
      source: "dashboard",
    });
  }

  {
    const bookMatch = String(suffix || "").match(/^book\/([^/]+)\/([^/]+)$/i);
    if (bookMatch) {
      const base = bookMatch[1];
      const quote = bookMatch[2];
      const pair = `${String(base).toUpperCase()}/${String(quote).toUpperCase()}`;
      const market = await loadDirectPairMarket({
        from: base,
        to: quote,
        toIssuer: String(quote).toUpperCase() === "RLUSD" ? process.env.RLUSD_ISSUER || RLUSD_ISSUER : undefined,
        toHex: String(quote).toUpperCase() === "RLUSD" ? process.env.RLUSD_CURRENCY_HEX || RLUSD_HEX : undefined,
      });
      const book = asLiquidPairBook(
        {
          pair,
          bid: market.bids?.[0]?.price,
          ask: market.asks?.[0]?.price,
          mid:
            market.bids?.[0]?.price && market.asks?.[0]?.price
              ? (Number(market.bids[0].price) + Number(market.asks[0].price)) / 2
              : null,
          bids: market.bids,
          asks: market.asks,
          amountA: market.reserveBase,
          amountB: market.reserveQuote,
          price:
            market.reserveBase > 0 && market.reserveQuote > 0
              ? market.reserveQuote / market.reserveBase
              : null,
          source: "xrpl",
        },
        pair
      );
      return ok(book);
    }
  }

  {
    const ammMatch = String(suffix || "").match(/^amm\/([^/]+)\/([^/]+)$/i);
    if (ammMatch) {
      const base = ammMatch[1];
      const quote = ammMatch[2];
      const pair = `${String(base).toUpperCase()}/${String(quote).toUpperCase()}`;
      const market = await loadDirectPairMarket({
        from: base,
        to: quote,
        toIssuer: String(quote).toUpperCase() === "RLUSD" ? process.env.RLUSD_ISSUER || RLUSD_ISSUER : undefined,
        toHex: String(quote).toUpperCase() === "RLUSD" ? process.env.RLUSD_CURRENCY_HEX || RLUSD_HEX : undefined,
      });
      const price =
        market.reserveBase > 0 && market.reserveQuote > 0
          ? market.reserveQuote / market.reserveBase
          : null;
      return ok({
        source: "xrpl",
        pair,
        amountA: market.reserveBase || null,
        amountB: market.reserveQuote || null,
        price,
        missing: !(market.reserveBase > 0 && market.reserveQuote > 0),
        trading_fee: market.tradingFee || null,
      });
    }
  }

  if (postgresTemporarilyDown()) {
    if (suffix === "health" || suffix === "health/xrpl") {
      return ok(catalogHealth({ postgresDown: true, dbOk: false }));
    }
    const live = await serveLiveOrLastGood(suffix, search);
    if (live) return live;
    return {
      status: 503,
      contentType: "application/json",
      body: JSON.stringify(postgresOutageBody()),
      source: "postgres",
    };
  }

  const db = getPool();
  if (!db) return null;
  await loadIndexerSchema(db);

  const params = searchParams(search);
  const limit = Math.min(Number(params.get("limit") || 200) || 200, 2000);
  const offset = Math.max(Number(params.get("offset") || 0) || 0, 0);

  try {
    if (
      !suffix ||
      suffix === "api" ||
      /handshake$/i.test(suffix) ||
      suffix.startsWith("cluster/")
    ) {
      return ok(CATALOG);
    }

    if (suffix === "health") {
      await db.query("SELECT 1");
      return ok(catalogHealth({ postgresDown: false, dbOk: true }));
    }

    if (suffix === "health/xrpl") {
      return ok({
        source: "db",
        onV1: null,
        note: "Dashboard is SELECT-only. XRPL RPC stays on indexer worker 1. Workers were not started from here.",
      });
    }

    if (suffix === "overview" || suffix === "token-details") {
      return withLiveCatalog(suffix, await buildTokenOverview(db));
    }

    if (suffix === "issuer-locked") {
      const snap = await loadIssuerLocked(db);
      return withLiveCatalog(suffix, {
        issuer: XIO_ISSUER,
        issuer_locked: snap.locked,
        burned_supply: snap.locked,
        issued: snap.issued,
        circulating: Math.max(XIO_TOTAL_SUPPLY - snap.locked, 0),
        as_of: snap.as_of,
        source: snap.source,
      });
    }

    if (suffix === "amm") {
      return withLiveCatalog(suffix, await buildSnapshot(db));
    }

    if (suffix === "holders/count") {
      if (wantsTodaySnapshot(params)) {
        return withLiveCatalog(suffix, await loadTodayOwners(db, { includeHolders: false }));
      }
      const source = await pickHolderSource(db);
      return withLiveCatalog(suffix, {
        count: source.count,
        as_of: source.as_of,
        snapshot_day: source.snapshot_day || utcDay(source.as_of),
        present: source.present,
        catching_up: source.catching_up,
        source: source.kind,
      });
    }

    if (suffix === "trustlines/count") {
      const snap = await tokenTrustlineSnapshot(db);
      return withLiveCatalog(suffix, {
        count: snap.count,
        as_of: snap.as_of,
        source: "db",
      });
    }

    if (suffix === "lp-holders/count") {
      const poolName = params.get("pool") || params.get("pair") || "XIO/XRP";
      if (wantsTodaySnapshot(params)) {
        return withLiveCatalog(suffix, await loadTodayLpOwners(db, { includeHolders: false, pool: poolName }));
      }
      const owners = await loadLiveLpOwners(db, { includeHolders: false, pool: poolName });
      return withLiveCatalog(suffix, { count: owners.count, pool: owners.pool });
    }

    if (suffix === "lp-trustlines/count") {
      return withLiveCatalog(
        suffix,
        await loadLpTrustlineCount(db, params.get("pool") || params.get("pair") || "XIO/XRP")
      );
    }

    if (suffix === "lp-pools") {
      return withLiveCatalog(suffix, await loadXioLpPools(db));
    }

    if (suffix === "orderbooks") {
      return withLiveCatalog(suffix, await loadOrderbooks(db), search);
    }

    if (suffix === "orderbook") {
      const pair =
        params.get("pair") || params.get("quote") || params.get("market") || "XIO/XRP";
      return withLiveCatalog(suffix, await loadOrderbook(db, pair), search);
    }

    if (suffix === "top-holders" || suffix === "top-holders-v2") {
      return withLiveCatalog(
        suffix,
        await tokenHoldersPage(db, limit, offset, {
          todayOnly: wantsTodaySnapshot(params),
        }),
        search
      );
    }

    if (suffix === "top-lp") {
      const poolName = params.get("pool") || params.get("pair") || "XIO/XRP";
      const pageLimit = Math.min(limit, 200) || 50;
      if (wantsTodaySnapshot(params)) {
        const page = await loadTodayLpOwners(db, {
          limit: pageLimit,
          offset,
          includeHolders: true,
          pool: poolName,
        });
        return withLiveCatalog(suffix, { ...page, rows: page.holders }, search);
      }
      const live = await loadLiveLpOwners(db, {
        limit: pageLimit,
        offset,
        includeHolders: true,
        pool: poolName,
      });
      return withLiveCatalog(suffix, live.holders, search);
    }

    if (suffix === "charts/tvl") {
      const history = await tryQuery(
        db,
        `SELECT timestamp, reserve_asset::numeric + reserve_currency::numeric AS tvl
         FROM amm_pool_history
         WHERE pool_name = 'XIO/XRP'
         ORDER BY timestamp ASC`
      );
      if (history.rows.length) return withLiveCatalog(suffix, history.rows, search);
      const fallback = await tryQuery(
        db,
        `SELECT timestamp, tvl FROM tvl_history ORDER BY timestamp ASC`
      );
      return withLiveCatalog(suffix, fallback.rows, search);
    }

    if (suffix === "charts/holders") {
      return withLiveCatalog(suffix, await loadLongHolderSeries(db), search);
    }

    if (suffix === "charts/trustlines") {
      return withLiveCatalog(suffix, await loadLongHolderSeries(db), search);
    }

    if (suffix === "charts/activity") {
      return withLiveCatalog(suffix, await nativeActivitySeries(db), search);
    }

    if (suffix === "charts/traders") {
      return withLiveCatalog(suffix, await nativeTraderSeries(db), search);
    }

    if (suffix === "xio-flows") {
      return withLiveCatalog(suffix, await nativeXioFlows(db), search);
    }

    if (suffix === "charts/trades" || suffix === "trades") {
      const flows = await nativeXioFlows(db);
      if (flows.length) return withLiveCatalog(suffix, flows, search);
      const trades = await readAmmTrades(db);
      if (suffix === "trades") return withLiveCatalog(suffix, trades, search);
      return withLiveCatalog(
        suffix,
        trades.map((row) => ({
          timestamp: row.timestamp,
          trades: 1,
          volume: row.xio,
          side: row.side,
        })),
        search
      );
    }

    if (suffix === "charts/lp-holders") {
      const result = await tryQuery(
        db,
        `SELECT day, lp_holder_count
         FROM lp_holders_history_daily
         ORDER BY day ASC`
      );
      if (result.rows.length) return withLiveCatalog(suffix, result.rows, search);
      const owners = await loadTodayLpOwners(db, { includeHolders: false, pool: "all" });
      return withLiveCatalog(
        suffix,
        owners.count
          ? [{ day: owners.as_of || new Date().toISOString(), lp_holder_count: owners.count }]
          : [],
        search
      );
    }

    if (suffix === "charts/lp-trustlines") {
      return withLiveCatalog(
        suffix,
        await loadLpTrustlineChart(db, params.get("pool") || params.get("pair") || "all"),
        search
      );
    }

    if (suffix === "pools") {
      const snap = await buildSnapshot(db);
      return withLiveCatalog(suffix, {
        ...snap,
        pools: snap.pools || [],
      });
    }

    if (suffix === "prices") {
      return withLiveCatalog(suffix, await buildPrices(db));
    }

    if (suffix === "prices/change24h") {
      const pinned = await tryQuery(
        db,
        `SELECT asset, percent_change
         FROM price_change_24h
         WHERE timestamp = date_trunc('day', now()) + interval '20 hours'`
      );
      const latest = pinned.rows.length
        ? pinned
        : await tryQuery(
            db,
            `SELECT asset, percent_change
             FROM price_change_24h
             ORDER BY timestamp DESC`
          );
      const map = {};
      for (const row of latest.rows) {
        const key = String(row.asset || "").toUpperCase();
        if (map[key] == null) map[key] = Number(row.percent_change);
      }
      return withLiveCatalog(suffix, {
        xrp: map.XRP || 0,
        xio: map.XIO || 0,
        lp: map.LP || 0,
      });
    }

    const wallet = suffix.match(/^(?:wallet\/)?balances\/([^/]+)$/);
    if (wallet) {
      const address = decodeURIComponent(wallet[1]);
      const xrp = await tryQueryIf(
        db,
        "xrp_balances_latest",
        ["balance"],
        "SELECT balance FROM xrp_balances_latest WHERE account = $1 LIMIT 1",
        [address]
      );
      const xioBalance = await tokenBalanceFor(db, address);
      const lp = await tryQuery(
        db,
        "SELECT lp_balance FROM lp_holders_latest WHERE account = $1 LIMIT 1",
        [address]
      );
      let xrpAmt = xrp.rows[0] != null ? Number(xrp.rows[0].balance) : null;
      if (!(xrpAmt > 0)) {
        const live = await loadWalletAccount(address);
        const liveDrops = Number(live?.balance_drops);
        if (live?.source === "xrpl" && liveDrops > 0) {
          xrpAmt = liveDrops / 1_000_000;
        } else if (!(xrpAmt > 0)) {
          xrpAmt = null;
        }
      }
      return ok({
        xrp: Number.isFinite(xrpAmt) ? xrpAmt : null,
        xio: Number(xioBalance) > 0 ? Number(xioBalance) : xioBalance,
        lp: Number(lp.rows[0]?.lp_balance || 0),
        source: "db",
        ...(Number.isFinite(xrpAmt) ? { balance_drops: Math.round(xrpAmt * 1_000_000) } : {}),
      });
    }

    const walletAccount = suffix.match(/^wallet\/account\/([^/]+)$/);
    if (walletAccount) {
      const address = decodeURIComponent(walletAccount[1]);
      return ok(await loadWalletAccount(address));
    }

    const walletOffers = suffix.match(/^wallet\/offers\/([^/]+)$/);
    if (walletOffers) {
      return ok(await loadWalletOffers(decodeURIComponent(walletOffers[1]), { fresh: walletFresh(search) }));
    }

    const walletLines = suffix.match(/^wallet\/lines\/([^/]+)$/);
    if (walletLines) {
      return ok(await loadWalletLines(decodeURIComponent(walletLines[1]), { fresh: walletFresh(search) }));
    }

    const walletActivity = suffix.match(/^wallet\/activity\/([^/]+)$/);
    if (walletActivity) {
      return ok(await loadWalletActivity(decodeURIComponent(walletActivity[1]), { fresh: walletFresh(search) }));
    }

    const walletLp = suffix.match(/^wallet\/lp\/([^/]+)$/);
    if (walletLp) {
      const address = decodeURIComponent(walletLp[1]);
      return ok(await loadWalletLp(db, address));
    }

    const walletRank = suffix.match(/^wallet\/rank\/([^/]+)$/);
    if (walletRank) {
      const address = decodeURIComponent(walletRank[1]);
      return withLiveCatalog(suffix, await loadWalletRank(db, address), search);
    }

    const networth = suffix.match(/^wallet\/networth\/([^/]+)$/);
    if (networth) {
      return ok(
        await loadWalletNetworthFromLedger(decodeURIComponent(networth[1]), {
          fresh: walletFresh(search),
        })
      );
    }

    const spark = suffix.match(/^sparkline\/([^/]+)$/);
    if (spark) {
      const asset = decodeURIComponent(spark[1]);
      const sparkKey = pickColumns(peekIndexerSchema(), "price_history", ["asset", "token"])[0];
      const result = sparkKey
        ? await tryQueryIf(
            db,
            "price_history",
            [sparkKey, "timestamp", "price_usd"],
            `SELECT timestamp, price_usd
         FROM price_history
         WHERE ${sparkKey} = $1
         ORDER BY timestamp DESC
         LIMIT 50`,
            [asset]
          )
        : { rows: [] };
      return withLiveCatalog(suffix, result.rows.reverse(), search);
    }

    if (suffix === "chart/candles" || suffix === "charts/candles") {
      const candleKey = pickColumns(peekIndexerSchema(), "price_history", ["asset", "token"])[0];
      const history = candleKey
        ? await tryQueryIf(
            db,
            "price_history",
            [candleKey, "timestamp", "price_usd"],
            `SELECT timestamp, ${candleKey} AS asset, price_usd
         FROM price_history
         WHERE ${candleKey} IN ('XIO', 'xio', 'XRP', 'xrp')
         ORDER BY timestamp ASC
         LIMIT 20000`
          )
        : { rows: [] };
      const ammWithSupply = await tryQueryIf(
        db,
        "amm_pool_history",
        ["timestamp", "pool_name", "reserve_asset", "reserve_currency", "price", "lp_supply"],
        `SELECT timestamp, pool_name, reserve_asset, reserve_currency, price, lp_supply
         FROM amm_pool_history
         WHERE pool_name IN ('XIO/XRP', 'XIO/RLUSD')
         ORDER BY timestamp ASC
         LIMIT 20000`
      );
      const amm =
        ammWithSupply.rows?.length || ammWithSupply.ok
          ? ammWithSupply
          : await tryQuery(
              db,
              `SELECT timestamp, pool_name, reserve_asset, reserve_currency, price
         FROM amm_pool_history
         WHERE pool_name IN ('XIO/XRP', 'XIO/RLUSD')
         ORDER BY timestamp ASC
         LIMIT 20000`
            );
      return withLiveCatalog(
        suffix,
        {
          source: "db",
          locked: true,
          price_history: history.rows,
          amm_pool_history: amm.rows,
        },
        search
      );
    }


    return null;
  } catch (error) {
    logDbError(error);
    if (isConnectError(error)) markPostgresDown();
    if (suffix === "health" || suffix === "health/xrpl") {
      return ok(catalogHealth({ postgresDown: true, dbOk: false }));
    }
    const live = await serveLiveOrLastGood(suffix, search);
    if (live) return live;
    return {
      status: isConnectError(error) ? 503 : 500,
      contentType: "application/json",
      body: JSON.stringify(
        isConnectError(error) ? postgresOutageBody() : { error: "Indexer query failed", source: "db" }
      ),
      source: "postgres",
    };
  }
}
