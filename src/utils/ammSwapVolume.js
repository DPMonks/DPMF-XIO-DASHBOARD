import {XIO_HEX} from "../constants/ledger.js";

const RIPPLE_EPOCH = 946684800;
const SKIP_TYPES = new Set([
  "AMMDeposit",
  "AMMWithdraw",
  "AMMCreate",
  "AMMVote",
  "TrustSet",
  "AccountSet",
]);

function sameAccount(left, right) {
  return String(left || "").trim() === String(right || "").trim();
}

export function isXioCurrency(value) {
  const currency = String(value || "").toUpperCase();
  return currency === "XIO" || currency === XIO_HEX;
}

export function rippleCloseIso(row = {}) {
  if (row.close_time_iso) return String(row.close_time_iso);
  const tx = row.tx || row.tx_json || {};
  const raw = row.date ?? tx.date ?? row.timestamp;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string" && raw.includes("T")) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const ms = n > 1e12 ? n : n > 1e10 ? n : (n + RIPPLE_EPOCH) * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function xioDeltaFromAmmMeta(meta, ammAccount) {
  const nodes = Array.isArray(meta?.AffectedNodes) ? meta.AffectedNodes : [];
  let delta = 0;
  for (const wrap of nodes) {
    const node = wrap.ModifiedNode || wrap.CreatedNode || wrap.DeletedNode;
    if (!node || node.LedgerEntryType !== "RippleState") continue;
    const final = node.FinalFields || node.NewFields || {};
    const prev = node.PreviousFields || {};
    const balance = final.Balance || {};
    if (!isXioCurrency(balance.currency)) continue;
    const high = final.HighLimit || {};
    const low = final.LowLimit || {};
    if (!sameAccount(high.issuer, ammAccount) && !sameAccount(low.issuer, ammAccount)) continue;
    const after = Number(balance.value);
    const before = Number(prev.Balance?.value);
    if (!Number.isFinite(after) || !Number.isFinite(before)) continue;
    delta += after - before;
  }
  return delta;
}

export function swapVolumeFromAccountTx(transactions = [], { ammAccount, now = Date.now(), windowMs = 24 * 60 * 60 * 1000 } = {}) {
  const cutoff = Number(now) - Number(windowMs || 24 * 60 * 60 * 1000);
  let volume24hXio = 0;
  let trades24h = 0;
  let oldestMs = null;
  const prints = [];
  for (const row of Array.isArray(transactions) ? transactions : []) {
    const tx = row.tx || row.tx_json || row;
    const type = String(tx.TransactionType || "");
    if (SKIP_TYPES.has(type)) continue;
    const iso = rippleCloseIso(row);
    const ts = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(ts)) {
      oldestMs = oldestMs == null ? ts : Math.min(oldestMs, ts);
    }
    const meta = row.meta || row.metaData || {};
    if (meta.TransactionResult && meta.TransactionResult !== "tesSUCCESS") continue;
    const signed = xioDeltaFromAmmMeta(meta, ammAccount);
    const xio = Math.abs(signed);
    if (!(xio > 0)) continue;
    const print = {
      timestamp: iso,
      pool: null,
      side: signed < 0 ? "buy" : "sell",
      xio,
      hash: row.hash || tx.hash || null,
      source: "xrpl-amm",
    };
    prints.push(print);
    if (Number.isFinite(ts) && ts >= cutoff) {
      volume24hXio += xio;
      trades24h += 1;
    }
  }
  return {
    volume24hXio,
    trades24h,
    complete: oldestMs != null && oldestMs < cutoff,
    source: "xrpl-amm",
    prints,
  };
}
