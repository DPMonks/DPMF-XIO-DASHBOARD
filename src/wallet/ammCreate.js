import {XIO_ISSUER} from "../constants/ledger.js";
import {feeUnitsFromPercent} from "./ammVote.js";
import {DROPS_PER_XRP, QUOTE_ASSETS, isLpCurrency, ledgerCurrencyCode, quoteAmount, quoteIdFromPair, resolveQuote, sameLedgerCurrency, xioAmount} from "../xaman/tradeTx.js";

export const AMM_CREATE_DEFAULT_FEE = 0.25;
export const AMM_CREATE_MAX_FEE = 1;
export const AMM_CREATE_RESERVE_XRP = 2;
export const RATIO_WARN_ABS_PCT = 15;

export function ammCreateTxjson({ account, quote, xio, quoteQty, tradingFee } = {}) {
  const txjson = {
    TransactionType: "AMMCreate",
    Amount: xioAmount(xio),
    Amount2: quoteAmount(quote, quoteQty),
    TradingFee: feeUnitsFromPercent(tradingFee ?? AMM_CREATE_DEFAULT_FEE),
  };
  if (account) txjson.Account = account;
  return txjson;
}

export function existingPoolForQuote(pools, quoteId) {
  const quote = String(quoteId || "").toUpperCase();
  const want = `XIO/${quote}`;
  return (
    (Array.isArray(pools) ? pools : []).find((row) => {
      const name = String(row.pool || row.pool_name || row.pair || "")
        .replace(/\s+/g, "")
        .toUpperCase();
      return name === want || (quote && name.endsWith(`/${quote}`));
    }) || null
  );
}

function isWalletLine(row) {
  if (!row || typeof row !== "object") return false;
  const currency = row.currency || row.ticker || row.hex || row.code;
  const issuer = row.issuer || row.account || row.counterparty;
  return Boolean(currency) && Boolean(issuer);
}

export function normalizeWalletLines(body) {
  if (Array.isArray(body?.lines)) return body.lines.filter(isWalletLine);
  if (Array.isArray(body?.trustlines)) return body.trustlines.filter(isWalletLine);
  if (Array.isArray(body?.balances)) return body.balances.filter(isWalletLine);
  if (Array.isArray(body?.assets)) return body.assets.filter(isWalletLine);
  if (Array.isArray(body?.tokens)) return body.tokens.filter(isWalletLine);
  if (Array.isArray(body)) return body.filter(isWalletLine);
  return [];
}

export function preferWalletLines(primary, fallback) {
  const first = normalizeWalletLines(primary);
  const second = normalizeWalletLines(fallback);
  return first.length >= second.length ? first : second;
}

export function walletLineRows(raw) {
  if (!raw || typeof raw !== "object") return [];
  const rows = [...normalizeWalletLines(raw)];
  if (!rows.length && raw.raw && raw.raw !== raw) {
    rows.push(...walletLineRows(raw.raw));
  }
  if (!rows.length && raw.balances && typeof raw.balances === "object" && !Array.isArray(raw.balances)) {
    for (const [key, value] of Object.entries(raw.balances)) {
      if (value && typeof value === "object") rows.push({ currency: key, ...value });
    }
  }
  return rows;
}

export function hexCurrencyLabel(hex) {
  const clean = String(hex || "").replace(/0+$/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = Number.parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isFinite(code) || code < 32 || code > 126) continue;
    out += String.fromCharCode(code);
  }
  return out || String(hex || "").slice(0, 6);
}

export function quotesFromWalletLines(raw) {
  const extra = [];
  for (const row of walletLineRows(raw)) {
    const currency = ledgerCurrencyCode(row.currency || row.code || row.hex);
    const issuer = row.issuer || row.account || row.counterparty || null;
    if (!issuer || currency === "XRP" || currency === "XIO" || currency.startsWith("584458")) continue;
    if (isLpCurrency(currency)) continue;
    const known = QUOTE_ASSETS.find(
      (item) =>
        item.issuer &&
        String(item.issuer).toUpperCase() === String(issuer).toUpperCase() &&
        (sameLedgerCurrency(item.hex, currency) ||
          sameLedgerCurrency(item.id, currency) ||
          sameLedgerCurrency(item.id, row.ticker))
    );
    const ticker =
      known?.id ||
      String(row.ticker || "").toUpperCase() ||
      (/^[A-Z0-9]{3,20}$/.test(currency) ? currency : hexCurrencyLabel(currency));
    if (!ticker || ticker === "XIO" || ticker === "LP") continue;
    extra.push({
      id: ticker,
      ticker,
      currency: known?.currency || (/^[A-Z0-9]{3,20}$/.test(currency) ? currency : ticker),
      issuer: known?.issuer || issuer,
      hex: known?.hex || (/^[A-F0-9]{40}$/.test(currency) ? currency : row.hex || null),
      label: known?.label || ticker,
      balance: row.balance ?? row.value ?? row.amount ?? null,
    });
  }
  return extra;
}

function shortIssuer(address) {
  const text = String(address || "");
  if (text.length <= 11) return text;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function optionKey(ticker, issuer) {
  return issuer ? `${ticker}:${String(issuer).toUpperCase()}` : ticker;
}

export function createQuoteOptions(pools = [], raw = null, extraLines = null) {
  const collected = [];
  function add(row) {
    const ticker = String(row.ticker || row.id || row.currency || "").toUpperCase();
    if (!ticker || ticker === "XIO") return;
    const issuer = row.issuer || null;
    const key = optionKey(ticker, issuer);
    if (collected.some((item) => item.key === key)) return;
    collected.push({
      key,
      ticker,
      issuer,
      currency: row.currency || ticker,
      hex: row.hex || null,
    });
  }
  add({ id: "XRP", ticker: "XRP", currency: "XRP" });
  for (const row of quotesFromWalletLines(raw)) add(row);
  if (extraLines) {
    for (const row of quotesFromWalletLines(Array.isArray(extraLines) ? { lines: extraLines } : extraLines)) {
      add(row);
    }
  }
  const counts = new Map();
  for (const row of collected) counts.set(row.ticker, (counts.get(row.ticker) || 0) + 1);
  return collected.map((row) => {
    const collided = (counts.get(row.ticker) || 0) > 1 && row.issuer;
    return {
      id: collided ? `${row.ticker}:${row.issuer}` : row.ticker,
      ticker: row.ticker,
      label: collided ? `${row.ticker} · ${shortIssuer(row.issuer)}` : row.ticker,
      exists: Boolean(existingPoolForQuote(pools, row.ticker)),
      currency: row.currency,
      issuer: row.issuer,
      hex: row.hex,
    };
  });
}

export function defaultCreateQuoteId(pools, raw, extraLines) {
  const options = createQuoteOptions(pools, raw, extraLines);
  return options.find((row) => !row.exists)?.id || options[0]?.id || "XRP";
}

export function depositRatio(xio, quoteQty) {
  const base = Number(xio);
  const quote = Number(quoteQty);
  if (!(base > 0) || !(quote > 0)) return 0;
  return quote / base;
}

export function ratioDeltaPct(ratio, marketQuotePerXio) {
  const deposit = Number(ratio);
  const market = Number(marketQuotePerXio);
  if (!(deposit > 0) || !(market > 0)) return null;
  return ((deposit - market) / market) * 100;
}

export function estimatedCreateLp(xio, quoteQty, quoteIsXrp = false) {
  const base = Number(xio);
  const quote = Number(quoteQty);
  if (!(base > 0) || !(quote > 0)) return 0;
  const product = quoteIsXrp ? base * quote * DROPS_PER_XRP : base * quote;
  return Math.sqrt(product);
}

export function estimatedPoolValueXrp({ xioAmount, quoteAmount, xioXrp, quoteXrp } = {}) {
  const xioPart = Number(xioAmount) * Number(xioXrp) || 0;
  const quotePart = Number(quoteAmount) * Number(quoteXrp || 0) || 0;
  const total = xioPart + quotePart;
  return total > 0 ? total : 0;
}

export function issuedBalance(raw, quote) {
  if (!quote || quote.currency === "XRP" || !quote.issuer) return null;
  const names = [quote.currency, quote.hex, quote.id, quote.label]
    .filter(Boolean)
    .map((name) => ledgerCurrencyCode(name));
  const issuer = String(quote.issuer).toUpperCase();
  const list = walletLineRows(raw);
  for (const row of list) {
    const currency = ledgerCurrencyCode(row.currency || row.code || row.ticker || row.hex);
    const who = String(row.issuer || row.account || row.counterparty || "").toUpperCase();
    if (who && who !== issuer) continue;
    if (names.some((name) => sameLedgerCurrency(currency, name))) {
      const n = Number(row.value ?? row.balance ?? row.amount);
      if (Number.isFinite(n)) return n;
    }
  }
  const hay = JSON.stringify(raw || {}).toUpperCase();
  if (names.some((name) => hay.includes(name)) || hay.includes(issuer)) {
    const n = Number(raw?.[quote.id] ?? raw?.[quote.currency]);
    return Number.isFinite(n) ? n : 0;
  }
  return null;
}

function knownAmount(value) {
  if (value == null || value === "") return false;
  return Number.isFinite(Number(value));
}

export function hasAssetLine(raw, quote, knownBalance) {
  if (!quote || quote.currency === "XRP" || !quote.issuer) return true;
  if (knownAmount(knownBalance)) return true;
  const hay = JSON.stringify(raw || {}).toUpperCase();
  const tokens = [quote.currency, quote.hex, quote.id, quote.issuer]
    .filter(Boolean)
    .map((name) => String(name).toUpperCase());
  return tokens.some((token) => hay.includes(token));
}

export function hasXioLine(raw, xioBalance) {
  if (knownAmount(xioBalance)) return true;
  const hay = JSON.stringify(raw || "").toUpperCase();
  return hay.includes("XIO") || hay.includes("584458") || hay.includes(XIO_ISSUER.toUpperCase());
}

export function createPoolBlocker({
  signedIn,
  xio,
  quoteQty,
  quote,
  xioBalance,
  quoteBalance,
  xrpBalance,
  raw,
  existing,
  fee,
} = {}) {
  if (existing) return "exists";
  if (!signedIn) return "wallet";
  const quoteId = String(quote?.id || quote?.currency || "").toUpperCase();
  if (quoteId === "XIO") return "primary";
  if (!hasXioLine(raw, xioBalance)) return "xio-line";
  if (quote?.issuer && !hasAssetLine(raw, quote, quoteBalance)) return "quote-line";
  const base = Number(xio);
  const quoteAmt = Number(quoteQty);
  if (!(base > 0) || !(quoteAmt > 0)) return "amount";
  const feePct = Number(fee);
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > AMM_CREATE_MAX_FEE) return "fee";
  if (knownAmount(xioBalance) && base > Number(xioBalance)) return "xio-balance";
  const quoteIsXrp = !quote?.issuer || quote.currency === "XRP";
  if (!quoteIsXrp && knownAmount(quoteBalance) && quoteAmt > Number(quoteBalance)) {
    return "quote-balance";
  }
  const spendable = Number(xrpBalance);
  const xrpNeeded = (quoteIsXrp ? quoteAmt : 0) + AMM_CREATE_RESERVE_XRP;
  if (knownAmount(xrpBalance) && spendable < xrpNeeded) return "reserve";
  return null;
}

export function resolveCreateQuote(id, extra = {}) {
  const ticker = extra.ticker || extra.currency || String(id || extra.quote || extra.id || "").split(":")[0];
  const resolved = resolveQuote(quoteIdFromPair(ticker || id || extra.quote || extra.id), extra);
  return {
    ...resolved,
    id: extra.ticker || resolved.id || ticker,
    label: extra.label || resolved.label || ticker,
    currency: resolved.currency || extra.currency || ticker,
    issuer: extra.issuer || extra.quote_issuer || extra.quoteIssuer || resolved.issuer || null,
    hex: extra.hex || extra.quote_hex || extra.quoteHex || resolved.hex || null,
  };
}
