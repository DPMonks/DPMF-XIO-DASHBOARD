import {RLUSD_HEX, RLUSD_ISSUER, XIO_CURRENCY, XIO_HEX, XIO_ISSUER, XDX_HEX, XDX_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER, asciiCurrencyHex} from "../constants/ledger.js";
import {hexToAscii} from "../xaman/signMarker.js";

export const AMM_FEE_UNITS = 100_000;
export const AMM_FEE_MAX_UNITS = 1000;
export const AMM_VOTE_SLOTS = 8;

export function feePercentFromUnits(units) {
  const n = Number(units);
  if (!Number.isFinite(n) || n < 0) return 0;
  return (n / AMM_FEE_UNITS) * 100;
}

export function feeUnitsFromPercent(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.max(0, Math.min(AMM_FEE_MAX_UNITS, Math.round((n / 100) * AMM_FEE_UNITS)));
}

export function formatFeePercent(percent, locale = "en") {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: n < 0.01 ? 4 : n < 1 ? 3 : 2,
  })}%`;
}

function sameWallet(value, address) {
  return String(value || "").trim().toLowerCase() === String(address || "").trim().toLowerCase();
}

export function voteSlotsFromAmm(amm = {}) {
  const rows = Array.isArray(amm.vote_slots) ? amm.vote_slots : [];
  return rows
    .map((row) => {
      const entry = row.vote_entry || row;
      const units = Number(entry.trading_fee ?? entry.TradingFee);
      const weight = Number(entry.vote_weight ?? entry.VoteWeight);
      if (!Number.isFinite(units)) return null;
      return {
        account: entry.account || entry.Account || null,
        tradingFee: units,
        feePercent: feePercentFromUnits(units),
        voteWeight: Number.isFinite(weight) ? weight : 0,
        weightPct: Number.isFinite(weight) ? weight / 1000 : 0,
        timestamp: entry.timestamp || entry.close_time_iso || null,
        txid: entry.txid || entry.hash || null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.voteWeight - left.voteWeight);
}

export function weightedVotedFee(slots = []) {
  let weight = 0;
  let acc = 0;
  for (const row of slots) {
    const w = Number(row.voteWeight) || 0;
    if (!(w > 0)) continue;
    acc += w * Number(row.tradingFee);
    weight += w;
  }
  if (!(weight > 0)) return null;
  return feePercentFromUnits(acc / weight);
}

export function medianVotedFee(slots = []) {
  const fees = slots.map((row) => Number(row.feePercent)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!fees.length) return null;
  const mid = Math.floor(fees.length / 2);
  return fees.length % 2 ? fees[mid] : (fees[mid - 1] + fees[mid]) / 2;
}

export function quoteIdFromName(pair) {
  const text = String(pair || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!text) return "XRP";
  return text.includes("/") ? text.split("/").pop() || "XRP" : text;
}

export function quoteIssue(quote = {}) {
  const id = String(quote.id || quote.currency || quote.quote || quote).toUpperCase();
  const code = id.includes("/") ? id.split("/").pop() : id;
  if (!code || code === "XRP") return { currency: "XRP" };
  if (code === "RLUSD") return { currency: quote.hex || RLUSD_HEX, issuer: quote.issuer || RLUSD_ISSUER };
  if (code === "XIO") return { currency: "XIO", issuer: quote.issuer || XDX_ISSUER };
  if (code === "XSQUAD") return { currency: quote.hex || XSQUAD_HEX, issuer: quote.issuer || XSQUAD_ISSUER };
  if (quote.issuer && /^[A-Z0-9]{3}$/.test(code)) return { currency: code, issuer: quote.issuer };
  if (quote.issuer) {
    const hex = String(quote.hex || "");
    return {
      currency: /^[A-F0-9]{40}$/i.test(hex) ? hex.toUpperCase() : asciiCurrencyHex(code),
      issuer: quote.issuer,
    };
  }
  return { currency: "XRP" };
}

export function xioIssue() {
  return { currency: XIO_CURRENCY, issuer: XIO_ISSUER };
}

export function quoteTickerFromCurrency(code, issuer = "") {
  const raw = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/^0X/, "");
  const who = String(issuer || "");
  if (!raw || raw === "XRP") return "XRP";
  // XIO hex is 58494F... ; XDX hex is 584458... - do not conflate them.
  if (raw === "XIO" || raw === XIO_HEX || raw.startsWith("58494F") || who === XIO_ISSUER) return "XIO";
  if (raw === "XDX" || raw === XDX_HEX || raw.startsWith("584458") || who === XDX_ISSUER) return "XDX";
  if (raw === RLUSD_HEX || raw === "RLUSD") return "RLUSD";
  if (raw === XSQUAD_HEX || raw === "XSQUAD" || who === XSQUAD_ISSUER) return "XSQUAD";
  if (/^[A-Z0-9.$]{2,12}$/.test(raw)) return raw;
  if (/^[A-F0-9]{40}$/.test(raw)) {
    const ascii = hexToAscii(raw).replace(/\0+$/g, "").trim();
    if (/^[A-Za-z0-9.$]{2,20}$/.test(ascii)) return ascii.toUpperCase();
  }
  return "";
}

export function displayVotePair(pair) {
  const name = normalizeVotePair(pair);
  const quote = quoteTickerFromCurrency(name.includes("/") ? name.split("/")[1] : name) || "XRP";
  return `XIO/${quote}`;
}

export function pairFromVoteAssets(asset, asset2) {
  const codes = [asset, asset2].map((row) => {
    if (!row || row.currency === "XRP") return "XRP";
    return quoteTickerFromCurrency(row.currency, row.issuer) || "XRP";
  });
  // Only real XIO AMMs - never invent XIO/BTC from an unrelated LP.
  if (!codes.includes("XIO")) return "";
  const quote = codes.find((code) => code !== "XIO") || "XRP";
  return `XIO/${quote}`;
}

export function ammVoteTxjson({ account, quote, tradingFee } = {}) {
  const units = Number.isFinite(Number(tradingFee)) && Number(tradingFee) > 20
    ? Math.round(Number(tradingFee))
    : feeUnitsFromPercent(tradingFee);
  const txjson = {
    TransactionType: "AMMVote",
    Asset: xioIssue(),
    Asset2: quoteIssue(quote),
    TradingFee: Math.max(0, Math.min(AMM_FEE_MAX_UNITS, units)),
  };
  if (account) txjson.Account = account;
  return txjson;
}

export function isVoteTxjson(txjson) {
  return txjson?.TransactionType === "AMMVote";
}

export function governanceFromAmmInfo(result = {}, { address = "", pair = "XIO/XRP", lpBalance = 0 } = {}) {
  const amm = result.amm || result;
  const slots = voteSlotsFromAmm(amm);
  const yours = slots.find((row) => address && sameWallet(row.account, address)) || null;
  const lpSupply = Number(amm.lp_token?.value ?? amm.lp_token);
  const held = Number(lpBalance) || 0;
  const eligible = held > 0;
  return {
    pair,
    ammAccount: amm.account || null,
    tradingFee: Number(amm.trading_fee),
    tradingFeePct: feePercentFromUnits(amm.trading_fee),
    weightedFeePct: weightedVotedFee(slots) ?? feePercentFromUnits(amm.trading_fee),
    medianFeePct: medianVotedFee(slots),
    voteCount: slots.length,
    voteSlots: slots.map((row) => ({ ...row, pair })),
    yourVote: yours,
    lpSupply: Number.isFinite(lpSupply) ? lpSupply : null,
    lpBalance: held,
    voteWeight: Number.isFinite(lpSupply) && lpSupply > 0 ? (held / lpSupply) * AMM_FEE_UNITS : 0,
    eligible,
    applies: "immediate",
    slotsFull: slots.length >= AMM_VOTE_SLOTS,
  };
}

export function activityFromAmmVoteTx(row, address) {
  const tx = row.tx || row.tx_json || row;
  if (tx?.TransactionType !== "AMMVote") return null;
  if (address && tx.Account && !sameWallet(tx.Account, address)) return null;
  const meta = row.meta || row.metaData || tx.meta || {};
  const result = meta.TransactionResult || row.TransactionResult || "";
  if (result && result !== "tesSUCCESS") return null;
  const units = Number(tx.TradingFee);
  const pair = pairFromVoteAssets(tx.Asset, tx.Asset2);
  const timestamp =
    row.close_time_iso ||
    (Number.isFinite(Number(row.date ?? tx.date))
      ? new Date((Number(row.date ?? tx.date) + 946684800) * 1000).toISOString()
      : row.timestamp) ||
    null;
  return {
    kind: "vote",
    account: tx.Account || address || null,
    side: "vote",
    pair,
    pool: pair,
    feeUnits: units,
    feePercent: feePercentFromUnits(units),
    timestamp,
    txid: String(row.hash || tx.hash || "").toUpperCase() || null,
    status: "active",
  };
}

export function formatVoteWeight(weightPct, locale = "en") {
  const n = Number(weightPct);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: n < 1 ? 3 : 2,
  })}%`;
}

export function assetVoteStatus(row = {}) {
  if (row.status === "replaced" || row.status === "inactive") return "inactive";
  const weight = Number(row.voteWeight);
  const pct = Number(row.weightPct);
  if (Number.isFinite(weight)) return weight > 0 ? "active" : "inactive";
  if (Number.isFinite(pct)) return pct > 0 ? "active" : "inactive";
  return row.status === "active" ? "active" : "inactive";
}

export function assetVoteRowsFromSlots(slots = [], pair = "") {
  const name = displayVotePair(pair || "XIO/XRP");
  return (Array.isArray(slots) ? slots : [])
    .filter((row) => row?.account)
    .map((row) => {
      const voteWeight = Number(row.voteWeight) || 0;
      const weightPct = Number(row.weightPct) || 0;
      return {
        account: row.account,
        pair: displayVotePair(row.pair || name),
        feePercent: row.feePercent,
        voteWeight,
        weightPct,
        timestamp: row.timestamp || null,
        txid: row.txid || null,
        status: assetVoteStatus({ voteWeight, weightPct }),
      };
    });
}

export function mergeAssetVoteRows(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      const account = String(row?.account || "").trim();
      const pair = normalizeVotePair(row?.pair);
      const key = `${account.toLowerCase()}|${pair}`;
      if (!account || !pair || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...row, account, pair });
    }
  }
  return out.sort((left, right) => {
    const weight = (Number(right.voteWeight) || 0) - (Number(left.voteWeight) || 0);
    if (weight) return weight;
    return String(left.pair).localeCompare(String(right.pair)) || String(left.account).localeCompare(String(right.account));
  });
}

export function voteDateKey(account, pair) {
  return `${String(account || "").trim().toLowerCase()}|${normalizeVotePair(pair)}`;
}

export function attachVoteTimestamps(slots = [], activity = []) {
  const latest = new Map();
  for (const row of Array.isArray(activity) ? activity : []) {
    if (!row?.account || String(row.kind || "vote") !== "vote") continue;
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) continue;
    const key = voteDateKey(row.account, row.pair || row.pool);
    const prev = latest.get(key);
    if (!prev || ts > prev.ts) {
      latest.set(key, { timestamp: row.timestamp, txid: row.txid || null, ts });
    }
  }
  return (Array.isArray(slots) ? slots : []).map((row) => {
    const hit = latest.get(voteDateKey(row.account, row.pair));
    if (!hit) return row;
    return {
      ...row,
      timestamp: row.timestamp || hit.timestamp,
      txid: row.txid || hit.txid,
    };
  });
}

export function voteHistoryFromActivity(rows = [], slots = []) {
  const live = new Set(
    (Array.isArray(slots) ? slots : [])
      .map((row) => String(row.account || "").toLowerCase())
      .filter(Boolean)
  );
  const seenPair = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.kind === "vote")
    .map((row) => {
      const key = String(row.pair || "");
      const first = !seenPair.has(key);
      if (first) seenPair.add(key);
      const onLedger = live.has(String(row.account || "").toLowerCase());
      return {
        ...row,
        status: first && onLedger ? "active" : first ? "active" : "replaced",
      };
    });
}

export function pendingVoteFromExecution(detail = {}, address = "") {
  const txjson = detail.txjson || detail.tx || null;
  if (!isVoteTxjson(txjson)) return null;
  const account = address || txjson.Account || detail.account || null;
  if (!account) return null;
  return {
    order: null,
    activity: {
      kind: "vote",
      account,
      side: "vote",
      pair: pairFromVoteAssets(txjson.Asset, txjson.Asset2),
      pool: pairFromVoteAssets(txjson.Asset, txjson.Asset2),
      feeUnits: Number(txjson.TradingFee),
      feePercent: feePercentFromUnits(txjson.TradingFee),
      timestamp: detail.timestamp || new Date().toISOString(),
      txid: detail.txid || null,
      status: "active",
    },
  };
}

export function normalizeVotePair(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function knownGovernancePairs(pools = [], extra = []) {
  const ids = ["XIO/XRP", "XIO/RLUSD", "XIO/XDX", "XIO/XSQUAD"];
  for (const row of [...(Array.isArray(pools) ? pools : []), ...(Array.isArray(extra) ? extra : [])]) {
    const name = normalizeVotePair(row?.pool || row?.pool_name || row?.pair || row);
    if (name.startsWith("XIO/") && !ids.includes(name)) ids.push(name);
  }
  return ids;
}

export function poolForVotePair(pools = [], extra = [], pair = "XIO/XRP") {
  const name = normalizeVotePair(pair);
  return (
    [...(Array.isArray(pools) ? pools : []), ...(Array.isArray(extra) ? extra : [])].find(
      (row) => normalizeVotePair(row?.pool || row?.pool_name || row?.pair) === name
    ) || null
  );
}
