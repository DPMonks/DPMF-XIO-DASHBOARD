import {ammPoolName, poolQuoteTicker} from "../ammPools.js";
import {quotesFromWalletLines} from "../wallet/ammCreate.js";
import {isLpCurrency, QUOTE_ASSETS} from "../xaman/tradeTx.js";

const XIO_ASSET = { id: "XIO", ticker: "XIO", label: "XIO", currency: "XIO" };
const XRP_ASSET = { id: "XRP", ticker: "XRP", label: "XRP", currency: "XRP", issuer: null, hex: null };

function optionKey(ticker, issuer) {
  return issuer ? `${String(ticker).toUpperCase()}:${String(issuer).toUpperCase()}` : String(ticker || "").toUpperCase();
}

function shortIssuer(address) {
  const text = String(address || "");
  if (text.length <= 11) return text;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function reserveAmount(pool, keys) {
  for (const key of keys) {
    if (pool?.[key] == null || pool[key] === "") continue;
    const n = Number(pool[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isActiveXioPool(pool = {}) {
  const name = ammPoolName(pool);
  if (!name.startsWith("XIO/") || name === "XIO/XIO") return false;
  const xio = reserveAmount(pool, ["reserve_asset", "reserve_xio"]);
  const quote = reserveAmount(pool, ["reserve_currency", "reserve_quote"]);
  if (xio != null && quote != null) return xio > 0 && quote > 0;
  if (xio === 0 || quote === 0) return false;
  return true;
}

export function quotesFromActiveXioPools(pools = []) {
  const seen = new Set();
  const rows = [];
  for (const pool of Array.isArray(pools) ? pools : []) {
    if (!isActiveXioPool(pool)) continue;
    const ticker = poolQuoteTicker(pool);
    if (!ticker || ticker === "XIO" || isLpCurrency(pool.quote_hex || pool.lp_currency)) continue;
    const known = QUOTE_ASSETS.find((item) => item.id === ticker);
    const issuer = pool.quote_issuer || pool.issuer || known?.issuer || null;
    const key = optionKey(ticker, issuer);
    if (seen.has(key) || seen.has(ticker)) continue;
    seen.add(key);
    seen.add(ticker);
    rows.push({
      id: ticker,
      ticker,
      label: ticker,
      currency: known?.currency || ticker,
      issuer,
      hex: pool.quote_hex || pool.hex || known?.hex || null,
    });
  }
  return rows.sort((a, b) => {
    if (a.id === "XRP") return -1;
    if (b.id === "XRP") return 1;
    return a.id.localeCompare(b.id);
  });
}

function finishOptions(collected, balances = {}) {
  const counts = new Map();
  for (const row of collected) counts.set(row.ticker, (counts.get(row.ticker) || 0) + 1);
  return collected.map((row) => {
    const collided = (counts.get(row.ticker) || 0) > 1 && row.issuer;
    const ticker = row.ticker;
    return {
      id: collided ? `${ticker}:${row.issuer}` : ticker,
      ticker,
      label: collided ? `${ticker} · ${shortIssuer(row.issuer)}` : ticker,
      currency: row.currency || ticker,
      issuer: row.issuer || null,
      hex: row.hex || null,
      balance: ticker === "XRP" ? Number(balances.xrp) || 0 : row.balance,
    };
  });
}

export function swapAssetOptions({ pools = [], lines = [], balances = {}, signedIn = false } = {}) {
  return [
    { ...XIO_ASSET, balance: Number(balances.xio) || 0 },
    ...swapCounterOptions({ pools, lines, balances, signedIn }),
  ];
}

export function swapCounterOptions({ pools = [], lines = [], balances = {}, signedIn = false } = {}) {
  const collected = [];
  function add(row) {
    const ticker = String(row.ticker || row.id || row.currency || "").toUpperCase();
    if (!ticker || ticker === "XIO" || isLpCurrency(row.currency) || isLpCurrency(row.hex)) return;
    const issuer = row.issuer || null;
    const key = optionKey(ticker, issuer);
    if (collected.some((item) => item.key === key)) return;
    collected.push({
      key,
      ticker,
      issuer,
      currency: row.currency || ticker,
      hex: row.hex || null,
      balance: row.balance,
    });
  }

  add({ ...XRP_ASSET, balance: Number(balances.xrp) || 0 });
  if (signedIn) {
    for (const row of quotesFromWalletLines(lines)) add(row);
  } else {
    for (const row of QUOTE_ASSETS) add(row);
    for (const row of quotesFromActiveXioPools(pools)) add(row);
  }
  const rows = finishOptions(collected, balances);
  if (rows.length) return rows;
  return [{ ...XRP_ASSET, balance: Number(balances.xrp) || 0 }];
}

export function swapCounterAsset(fromId, toId) {
  const from = String(fromId || "").toUpperCase();
  const to = String(toId || "").toUpperCase();
  if (from === "XIO") return to && to !== "XIO" ? to : "XRP";
  if (to === "XIO") return from && from !== "XIO" ? from : "XRP";
  return to && to !== "XIO" ? to : from || "XRP";
}

export function swapSellingXio(fromId) {
  return String(fromId || "").split(":")[0].toUpperCase() === "XIO";
}

export function pickOtherAsset(current, next, fallback = "XRP") {
  const a = String(current || "").toUpperCase();
  const b = String(next || "").toUpperCase();
  if (b && b !== a) return b;
  if (a && a !== "XIO") return a;
  return fallback;
}
