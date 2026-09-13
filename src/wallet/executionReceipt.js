import {poolFromTradeContext} from "../xaman/exchangeMemo.js";
import {currencyCode, lpDeltaFromMeta, readAmount} from "./ledgerOrders.js";

function unwrapLedger(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.result && typeof raw.result === "object" && (raw.result.meta || raw.result.hash)) {
    return raw.result;
  }
  return raw;
}

function isLpCurrency(value) {
  return /^03[A-Fa-f0-9]{38}$/.test(String(value || "").trim());
}

function labeledAmount(amount) {
  if (!amount || !(Number(amount.value) > 0)) return null;
  const code = isLpCurrency(amount.currency) ? "LP" : currencyCode(amount.currency);
  return { value: Number(amount.value), asset: code || "IOU" };
}

function pushAmount(list, amount) {
  const row = labeledAmount(amount);
  if (row) list.push(row);
}

export function lpDeltaFromLedger(raw, account) {
  const ledger = unwrapLedger(raw);
  return lpDeltaFromMeta(ledger?.meta || ledger, account);
}

export function executionReceipt(detail = {}) {
  const txjson = detail.txjson || detail.tx || {};
  const type = String(txjson.TransactionType || detail.txType || "");
  const trade = detail.trade || {};
  const pair = poolFromTradeContext(txjson, trade);
  const account = detail.account || txjson.Account || null;
  const ledger = unwrapLedger(detail.ledger);
  const paid = [];
  const received = [];

  if (type === "AMMDeposit" || type === "AMMCreate") {
    pushAmount(paid, readAmount(txjson.Amount));
    pushAmount(paid, readAmount(txjson.Amount2));
    const lp = Number(detail.lpReceived) || lpDeltaFromLedger(ledger || detail.ledger, account);
    if (lp > 0) received.push({ value: lp, asset: "LP" });
  } else if (type === "AMMWithdraw") {
    pushAmount(paid, readAmount(txjson.LPTokenIn));
    pushAmount(received, readAmount(txjson.Amount));
    pushAmount(received, readAmount(txjson.Amount2));
    if (!received.length) {
      const lp = lpDeltaFromLedger(ledger || detail.ledger, account);
      if (lp > 0) paid.push({ value: lp, asset: "LP" });
    }
  } else if (type === "Payment") {
    pushAmount(paid, readAmount(txjson.SendMax));
    pushAmount(received, readAmount(txjson.Amount));
  } else if (type === "OfferCreate") {
    pushAmount(paid, readAmount(txjson.TakerGets));
    pushAmount(received, readAmount(txjson.TakerPays));
  } else if (type === "AMMVote") {
    const units = Number(txjson.TradingFee);
    if (Number.isFinite(units)) received.push({ value: units / 1000, asset: "fee %" });
  }

  const txid = String(detail.txid || ledger?.hash || "").trim().toUpperCase();
  return {
    pair: pair || null,
    type: type || null,
    paid,
    received,
    txid: /^[A-F0-9]{64}$/.test(txid) ? txid : null,
    ledgerIndex: Number(detail.ledgerIndex ?? ledger?.ledger_index) || null,
    engineResult: detail.engineResult || ledger?.meta?.TransactionResult || null,
    account,
  };
}

export function formatReceiptHash(txid) {
  const hash = String(txid || "").trim();
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
