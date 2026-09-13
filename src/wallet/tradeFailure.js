import {poolFromTradeContext} from "../xaman/exchangeMemo.js";
import {executionReceipt} from "./executionReceipt.js";

const FALLBACK = {
  failWhyTitle: "Why this failed",
  failFixTitle: "What to do",
  failActAddLp: "add liquidity",
  failActRemoveLp: "remove liquidity",
  failActCreatePool: "create this pool",
  failActVote: "cast this vote",
  failActBuy: "buy",
  failActSell: "sell",
  failActSwap: "swap",
  failActOrder: "place this order",
  failActTrust: "open this trust line",
  failActTx: "complete this transaction",
  failPairFallback: "this pair",
  failWhyUnfundedAmm:
    "This wallet does not have enough of both {pair} tokens to {action}, or not enough spare XRP after the reserve.",
  failFixUnfundedAmm:
    "Check both balances for {pair}. Leave unused XRP for reserve, then try a smaller amount.",
  failWhyUnfunded: "This wallet does not have enough {assets} to {action} on {pair}.",
  failFixUnfunded: "Lower the amount to what this account actually holds, and keep unused XRP for reserve.",
  failWhyReserve: "This account is short of unused XRP. The ledger needs more reserve before it can {action}.",
  failFixReserve: "Keep more unused XRP in this wallet, then try again.",
  failWhyReserveLine:
    "The ledger needed a new trust line for {pair}. Unused XRP must cover the owner reserve. A total XRP balance is not enough if it is already reserved.",
  failFixReserveLine:
    "Free at least 0.2 spendable XRP per new line, then sign again. Do not spend the reserved XRP.",
  failWhyNoLine: "This account is missing a trust line for a token in {pair}, so the ledger cannot {action}.",
  failFixNoLine: "Open the missing trust line for that token first, then retry.",
  failWhyNoLineLp: "This account does not have the LP trust line for {pair}, so the ledger cannot {action}.",
  failFixNoLineLp: "Sign the LP Trustline for this pool, then retry.",
  failWhyFrozen: "The issuer has not authorised this account, or a token in {pair} is frozen.",
  failFixFrozen: "Use a token this wallet is allowed to hold, or wait until the issuer unlocks it.",
  failWhyPathDry: "There is no path on the ledger that can fill this {pair} {action} for this account right now.",
  failFixPathDry: "Try a smaller size, switch pair, or wait for deeper books and pool liquidity.",
  failWhyPathPartial:
    "Only part of this {pair} {action} could fill. The ledger rejected the rest instead of giving a worse price.",
  failFixPathPartial: "Lower the amount, widen slippage, or split the trade.",
  failWhyKilled: "This {pair} order was fill-or-kill and this account did not get a full fill at the limit.",
  failFixKilled: "Raise the buy price, lower the sell price, or turn off fill-or-kill.",
  failWhyAmm: "The {pair} pool could not complete this {action} from this account.",
  failFixAmm: "Check both pool tokens, your LP trust line, and try a smaller size.",
  failWhyAmmRemove: "The {pair} pool could not pay this withdraw from this account.",
  failFixAmmRemove: "Confirm this wallet still holds LP tokens for {pair}, then try a smaller withdraw.",
  failWhyMalformed: "The signed payload was not a valid ledger transaction (bad amounts or fields).",
  failFixMalformed: "Refresh, pick {pair} again, and sign a new transaction.",
  failWhyStale: "This transaction arrived too late or reused a sequence for this account.",
  failFixStale: "Wait a few seconds and sign a fresh transaction. Do not resubmit the same QR.",
  failWhyFee: "The network fee was higher than this transaction paid.",
  failFixFee: "Sign again so the wallet can attach a current fee.",
  failWhyDirFull: "This account has too many open ledger objects (offers or trust lines).",
  failFixDirFull: "Cancel unused offers or unused trust lines, then retry.",
  failWhyTooSoon: "The ledger is not ready for this {action} yet.",
  failFixTooSoon: "Wait a moment and try again.",
  failWhyNoEntry: "The {pair} pool or object this {action} needs is not on the ledger.",
  failFixNoEntry: "Confirm the pool exists, then try again.",
  failWhyUnknown: "The wallet or relay reported a failure before the ledger posted a result for this {action}.",
  failFixUnknown: "Check this account is signed in, then sign a fresh transaction.",
  failWhyGeneric: "The XRP Ledger rejected this {action} on {pair} for this account ({code}).",
  failFixGeneric: "Check balances, trust lines, and unused XRP for this wallet, then try a smaller amount.",
};

function fill(template, vars = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null && vars[key] !== "" ? String(vars[key]) : ""
  );
}

function copy(t, key) {
  const fromT = t && t[key];
  return fromT || FALLBACK[key] || "";
}

export function engineCodeOf(detail = {}) {
  return String(detail.engineResult || detail.dispatched || "").trim();
}

export function failureActionKind(detail = {}) {
  const action = String(detail.trade?.action || "").toLowerCase();
  const type = String(detail.txjson?.TransactionType || detail.txType || "");
  if (action === "addlp" || type === "AMMDeposit") return "addLp";
  if (action === "removelp" || type === "AMMWithdraw") return "removeLp";
  if (action === "createpool" || type === "AMMCreate") return "createPool";
  if (action === "vote" || type === "AMMVote") return "vote";
  if (action === "buy") return "buy";
  if (action === "sell") return "sell";
  if (action === "crossswap") return "swap";
  if (type === "Payment") return "swap";
  if (type === "OfferCreate") return "order";
  if (type === "TrustSet") return "trust";
  return "tx";
}

export function failurePairLabel(detail = {}) {
  const trade = detail.trade || {};
  if (trade.fromId && trade.toId) {
    return `${String(trade.fromId).toUpperCase()}/${String(trade.toId).toUpperCase()}`;
  }
  const fromTrade = String(trade.pair || trade.pool || "").replace(/\s+/g, "").toUpperCase();
  if (fromTrade.includes("/")) return fromTrade;
  if (trade.quote) return `XIO/${String(trade.quote).replace(/\s+/g, "").toUpperCase()}`;
  const txjson = detail.txjson || detail.tx || {};
  if (
    txjson.Asset ||
    txjson.Asset2 ||
    (txjson.Amount && txjson.SendMax) ||
    (txjson.TakerPays && txjson.TakerGets) ||
    (txjson.Amount && txjson.Amount2)
  ) {
    return poolFromTradeContext(txjson, trade) || "";
  }
  return "";
}

function paidAssets(detail) {
  const receipt = executionReceipt(detail);
  const paid = (receipt.paid || []).map((row) => row.asset).filter(Boolean);
  if (paid.length) return paid;
  return [];
}

export function failureFamilyOf(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return "unknown";
  if (c === "TECUNFUNDED_AMM") return "unfundedAmm";
  if (c.startsWith("TECUNFUNDED")) return "unfunded";
  if (c.includes("INSUF_RESERVE") || c === "TECINSUFFICIENT_RESERVE") return "reserve";
  if (c === "TECNO_LINE" || c === "TECNO_DST" || c === "TECNO_ISSUER") return "noLine";
  if (c === "TECNO_AUTH" || c === "TECNO_PERMISSION" || c === "TECFROZEN" || c === "TECLOCKED") return "frozen";
  if (c === "TECPATH_DRY") return "pathDry";
  if (c === "TECPATH_PARTIAL") return "pathPartial";
  if (c === "TECKILLED") return "killed";
  if (c.startsWith("TECAMM") || c === "TECAMM_FAILED") return "amm";
  if (c.startsWith("TEM")) return "malformed";
  if (c === "TEFPAST_SEQ" || c === "TEFMAX_LEDGER" || c === "TEFALREADY" || c === "TEFWRONG_PRIOR") return "stale";
  if (c.includes("INSUF_FEE") || c === "TELINSUF_FEE_P") return "fee";
  if (c === "TECDIR_FULL") return "dirFull";
  if (c === "TECTOO_SOON") return "tooSoon";
  if (c === "TECNO_ENTRY") return "noEntry";
  return "generic";
}

function actionLabel(kind, t) {
  const keys = {
    addLp: "failActAddLp",
    removeLp: "failActRemoveLp",
    createPool: "failActCreatePool",
    vote: "failActVote",
    buy: "failActBuy",
    sell: "failActSell",
    swap: "failActSwap",
    order: "failActOrder",
    trust: "failActTrust",
    tx: "failActTx",
  };
  return copy(t, keys[kind] || "failActTx");
}

function keysFor(family, kind) {
  if (family === "noLine" && (kind === "addLp" || kind === "removeLp" || kind === "createPool")) {
    return { why: "failWhyNoLineLp", fix: "failFixNoLineLp" };
  }
  if (family === "reserve" && (kind === "addLp" || kind === "trust" || kind === "createPool")) {
    return { why: "failWhyReserveLine", fix: "failFixReserveLine" };
  }
  if (family === "amm" && kind === "removeLp") {
    return { why: "failWhyAmmRemove", fix: "failFixAmmRemove" };
  }
  const map = {
    unfundedAmm: ["failWhyUnfundedAmm", "failFixUnfundedAmm"],
    unfunded: ["failWhyUnfunded", "failFixUnfunded"],
    reserve: ["failWhyReserve", "failFixReserve"],
    noLine: ["failWhyNoLine", "failFixNoLine"],
    frozen: ["failWhyFrozen", "failFixFrozen"],
    pathDry: ["failWhyPathDry", "failFixPathDry"],
    pathPartial: ["failWhyPathPartial", "failFixPathPartial"],
    killed: ["failWhyKilled", "failFixKilled"],
    amm: ["failWhyAmm", "failFixAmm"],
    malformed: ["failWhyMalformed", "failFixMalformed"],
    stale: ["failWhyStale", "failFixStale"],
    fee: ["failWhyFee", "failFixFee"],
    dirFull: ["failWhyDirFull", "failFixDirFull"],
    tooSoon: ["failWhyTooSoon", "failFixTooSoon"],
    noEntry: ["failWhyNoEntry", "failFixNoEntry"],
    unknown: ["failWhyUnknown", "failFixUnknown"],
    generic: ["failWhyGeneric", "failFixGeneric"],
  };
  const pair = map[family] || map.generic;
  return { why: pair[0], fix: pair[1] };
}

export function explainTradeFailure(detail = {}, t = {}) {
  const code = engineCodeOf(detail);
  const kind = failureActionKind(detail);
  const family = failureFamilyOf(code);
  const pair = failurePairLabel(detail);
  const assets = paidAssets(detail);
  const keys = keysFor(family, kind);
  const vars = {
    code: code || "unknown",
    action: actionLabel(kind, t),
    pair: pair || copy(t, "failPairFallback"),
    assets: assets.length ? assets.join(" + ") : pair || copy(t, "failPairFallback"),
  };
  return {
    code,
    family,
    action: kind,
    pair,
    why: fill(copy(t, keys.why), vars),
    fix: fill(copy(t, keys.fix), vars),
    title: copy(t, "failWhyTitle"),
    fixTitle: copy(t, "failFixTitle"),
  };
}
