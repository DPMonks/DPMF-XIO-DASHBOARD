import {asciiToHex, hexToAscii} from "./signMarker.js";

export const EXCHANGE_PLATFORM = "XIO-Exchange.DPMF.Technology";
export const EXCHANGE_MEMO_TYPE = "dpmf.memo";
export const EXCHANGE_MEMO_FORMAT = "text/plain";
export const EXCHANGE_MEMO_VERSION = "1.0.3";
const MAX_MEMO_CHARS = 220;

function currencyLabel(value) {
  const raw = String(value?.currency || value || "").trim();
  if (!raw || raw.toUpperCase() === "XRP") return "XRP";
  const upper = raw.toUpperCase();
  if (/^[A-Z0-9]{3}$/.test(upper)) return upper;
  if (/^03[A-F0-9]{38}$/.test(upper)) return "LP";
  if (/^[A-F0-9]{40}$/.test(upper)) {
    const chars = [];
    for (let i = 0; i < 40; i += 2) {
      const code = Number.parseInt(upper.slice(i, i + 2), 16);
      if (!code) break;
      chars.push(String.fromCharCode(code));
    }
    return chars.join("") || "IOU";
  }
  return upper.slice(0, 12);
}

function pairName(left, right) {
  const a = currencyLabel(left);
  const b = currencyLabel(right);
  if (a === "XIO") return `XIO/${b || "XRP"}`;
  if (b === "XIO") return `XIO/${a || "XRP"}`;
  return [a, b].filter(Boolean).join("/") || "XIO/XRP";
}

export function poolFromTradeContext(txjson = {}, trade = {}) {
  if (trade.fromId && trade.toId) {
    return `${String(trade.fromId).toUpperCase()}/${String(trade.toId).toUpperCase()}`;
  }
  const fromTrade = String(trade.pair || trade.pool || "").replace(/\s+/g, "").toUpperCase();
  if (fromTrade.includes("/")) return fromTrade;
  if (trade.quote) return `XIO/${String(trade.quote).replace(/\s+/g, "").toUpperCase()}`;
  if (txjson.Asset || txjson.Asset2) return pairName(txjson.Asset, txjson.Asset2);
  if (txjson.Amount && txjson.Amount2) return pairName(txjson.Amount, txjson.Amount2);
  if (txjson.TakerPays && txjson.TakerGets) return pairName(txjson.TakerPays, txjson.TakerGets);
  if (txjson.Amount && txjson.SendMax) return pairName(txjson.Amount, txjson.SendMax);
  return "XIO/XRP";
}

function memoLine(detail) {
  const text = `${EXCHANGE_PLATFORM} | ${detail}`;
  return text.length <= MAX_MEMO_CHARS ? text : text.slice(0, MAX_MEMO_CHARS);
}

function votePhrase(voteType) {
  const raw = String(voteType || "trading_fee").trim();
  if (raw === "trading_fee") return "fee adjustment";
  return raw.replace(/_/g, " ");
}

export function exchangeMemoText({ txjson = {}, trade = {} } = {}) {
  const type = String(txjson.TransactionType || "");
  const action = String(trade.action || "").trim();
  const pool = poolFromTradeContext(txjson, trade);

  if (type === "AMMCreate" || action === "createPool") {
    return memoLine(`New pool created: ${pool}`);
  }
  if (type === "AMMVote" || action === "vote") {
    return memoLine(`Governance vote submitted: ${votePhrase(trade.voteType)}`);
  }
  if (type === "AMMDeposit" || action === "addLp") {
    if (trade.lpMode === "single" || Number(txjson.Flags) === 524288) {
      return memoLine(`Single-sided liquidity added to ${pool} pool`);
    }
    return memoLine(`Liquidity added to ${pool} pool`);
  }
  if (type === "AMMWithdraw" || action === "removeLp") {
    if (trade.lpMode === "single" || Number(txjson.Flags) === 2_097_152) {
      return memoLine(`Single-sided liquidity removed from ${pool} pool`);
    }
    return memoLine(`Liquidity removed from ${pool} pool`);
  }
  if (type === "TrustSet") {
    const token = currencyLabel(txjson.LimitAmount);
    const limit = txjson.LimitAmount || {};
    const raw = limit.value ?? limit.Value;
    const removed = raw != null && raw !== "" && Number(raw) === 0;
    return memoLine(`${token} trustline ${removed ? "removed" : "opened"}`);
  }
  if (action === "xioPlatformFee") {
    return memoLine(`1% XIO platform fee`);
  }
  if (type === "Payment" || type === "OfferCreate" || action === "buy" || action === "sell" || action === "crossSwap") {
    return memoLine(`Swap executed in ${pool} | v${EXCHANGE_MEMO_VERSION}`);
  }
  return memoLine(`Transaction submitted in ${pool}`);
}

function looksLikePlatformMemo(text) {
  const raw = String(text || "").trim();
  return raw.startsWith(EXCHANGE_PLATFORM) || raw.includes("xio-exchange.dpmf.technology");
}

export function describeExchangeMemo(text) {
  const raw = String(text || "").trim();
  if (!looksLikePlatformMemo(raw)) return null;
  let module = "swap";
  if (/Liquidity added/i.test(raw)) module = "add_liquidity";
  else if (/Liquidity removed/i.test(raw)) module = "remove_liquidity";
  else if (/Governance vote/i.test(raw)) module = "amm_vote";
  else if (/New pool created/i.test(raw)) module = "pool_create";
  else if (/trustline/i.test(raw)) module = "lp_action";
  else if (/Swap executed/i.test(raw)) module = "swap";
  return { platform: EXCHANGE_PLATFORM, text: raw, module };
}

function memoRows(txjson) {
  return Array.isArray(txjson?.Memos) ? txjson.Memos : [];
}

export function extractExchangeMemo(txjson) {
  for (const row of memoRows(txjson)) {
    const memo = row?.Memo || row || {};
    const type = hexToAscii(memo.MemoType);
    const data = hexToAscii(memo.MemoData);
    const ours = type === EXCHANGE_MEMO_TYPE || type === "text/plain" || type === "application/json" || looksLikePlatformMemo(data);
    if (!ours) continue;
    const described = describeExchangeMemo(data);
    if (described) return described;
    try {
      const parsed = JSON.parse(data);
      if (looksLikePlatformMemo(parsed?.platform)) {
        return { ...parsed, text: data };
      }
    } catch {
      // ignore leftover or malformed memo data
    }
  }
  return null;
}

export function stampExchangeMemo(txjson, context = {}) {
  if (!txjson || typeof txjson !== "object") return txjson;
  if (extractExchangeMemo(txjson)) return txjson;
  const text = exchangeMemoText({ txjson, trade: context.trade || {} });
  return {
    ...txjson,
    Memos: [
      ...memoRows(txjson),
      {
        Memo: {
          MemoType: asciiToHex(EXCHANGE_MEMO_TYPE),
          MemoFormat: asciiToHex(EXCHANGE_MEMO_FORMAT),
          MemoData: asciiToHex(text),
        },
      },
    ],
  };
}
