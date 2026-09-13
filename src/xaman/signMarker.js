export const SIGN_MEMO_TYPE = "dpmf.sign";

export function asciiToHex(value) {
  return Array.from(new TextEncoder().encode(String(value || "")))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function hexToAscii(value) {
  const hex = String(value || "").replace(/^0x/i, "").trim();
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function normalizeSignMarker(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{16,64}$/.test(raw)) return "";
  return raw.length >= 32 ? raw.slice(0, 32) : raw;
}

export function nextSignMarker() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return normalizeSignMarker(uuid);
  const stamp = Date.now().toString(16).padStart(12, "0");
  const rand = Math.random().toString(16).slice(2).padEnd(20, "0");
  return normalizeSignMarker(`${stamp}${rand}`.slice(0, 32));
}

export function invoiceIdFromMarker(marker) {
  const id = normalizeSignMarker(marker);
  return id ? id.padEnd(64, "0") : "";
}

function memoRows(txjson) {
  return Array.isArray(txjson?.Memos) ? txjson.Memos : [];
}

export function extractTradeMarker(txjson) {
  if (!txjson || typeof txjson !== "object") return "";
  for (const row of memoRows(txjson)) {
    const memo = row?.Memo || row || {};
    const type = hexToAscii(memo.MemoType);
    if (type === SIGN_MEMO_TYPE || type === "dpmf/sign") {
      return normalizeSignMarker(memo.MemoData);
    }
  }
  if (txjson.TransactionType === "Payment") {
    return normalizeSignMarker(txjson.InvoiceID);
  }
  return "";
}

export function extractTradeMarkerFromPayload(payload) {
  return extractTradeMarker(
    payload?.payload?.request_json ||
      payload?.payload?.txjson ||
      payload?.txjson ||
      payload?.request_json ||
      null
  );
}

export function stampTradeTxjson(txjson, marker = nextSignMarker()) {
  if (!txjson || typeof txjson !== "object") return { txjson, marker: "" };
  const existing = extractTradeMarker(txjson);
  if (existing) return { txjson, marker: existing };
  const id = normalizeSignMarker(marker) || nextSignMarker();
  const next = { ...txjson };
  if (next.TransactionType === "Payment" && !next.InvoiceID) {
    next.InvoiceID = invoiceIdFromMarker(id);
  }
  next.Memos = [
    ...memoRows(next),
    {
      Memo: {
        MemoType: asciiToHex(SIGN_MEMO_TYPE),
        MemoData: id,
      },
    },
  ];
  return { txjson: next, marker: id };
}
