const HEX_CURRENCY = /^[0-9A-Fa-f]{40}$/;

export function decodeCurrency(code) {
  if (code == null || code === "") return "";
  if (typeof code === "object") {
    return decodeCurrency(code.currency || code.code || code.symbol);
  }

  const value = String(code).trim();
  if (!value) return "";
  if (value === "XRP" || value.length <= 3) return value.toUpperCase();

  if (HEX_CURRENCY.test(value)) {
    const hex = value.replace(/00+$/, "");
    if (hex.length >= 6 && hex.length % 2 === 0) {
      const text = hex
        .match(/.{2}/g)
        .map((byte) => String.fromCharCode(Number.parseInt(byte, 16)))
        .join("")
        .replace(/[^\u0020-\u007E]/g, "")
        .trim();
      if (/^[A-Z0-9]{3,}$/i.test(text)) return text.toUpperCase();
    }
  }

  return value.toUpperCase();
}

export function formatPair(row = {}) {
  const named =
    row.pair ||
    row.pool ||
    row.pool_name ||
    row.poolName ||
    row.name ||
    row.asset_pair;

  if (named && String(named).includes("/")) {
    return String(named)
      .replace(/\s+/g, "")
      .replace(/[-_]/g, "/")
      .toUpperCase();
  }

  const asset = decodeCurrency(
    row.asset || row.tokenA || row.currency_a || row.base || row.reserve_asset_code
  );
  const quote = decodeCurrency(
    row.currency ||
      row.tokenB ||
      row.currency_b ||
      row.quote ||
      row.reserve_currency_code
  );

  const left = asset || "XIO";
  const right = quote || "XRP";
  return `${left}/${right}`;
}

export function pairParts(pair) {
  const [asset = "XIO", quote = "XRP"] = String(pair || "XIO/XRP").split("/");
  return { asset, quote };
}

export function ledgerCurrencyKey(value) {
  return String(value || "")
    .replace(/^0x/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function sameIssuedCurrency(a, b) {
  const left = String(a || "")
    .replace(/^0x/i, "")
    .trim();
  const right = String(b || "")
    .replace(/^0x/i, "")
    .trim();
  if (!left || !right) return false;
  if (ledgerCurrencyKey(left) === ledgerCurrencyKey(right)) return true;
  const decL = decodeCurrency(left);
  const decR = decodeCurrency(right);
  return Boolean(decL && decR && decL === decR);
}

export function isNativeXrpQuote(quote) {
  if (!quote) return true;
  const id = String(quote.id || quote.currency || "")
    .replace(/^XIO\//i, "")
    .toUpperCase();
  const pair = String(quote.pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const quoteName = String(quote.quote || quote.label || "")
    .replace(/^XIO\//i, "")
    .toUpperCase();
  // Native XRP cannot carry an issuer. Catalog leftovers used to make
  // XIO/XRP single- and double-sided deposits look like IOU errors.
  if (id === "XRP" || quoteName === "XRP" || pair === "XIO/XRP" || pair === "XRP") return true;
  if (quote.issuer) return false;
  if (pair && !pair.endsWith("/XRP")) return false;
  return id === "" && (!pair || pair.endsWith("/XRP"));
}

export function lineCounterparty(row) {
  return String(row?.issuer || row?.account || row?.counterparty || row?.amm || "").toUpperCase();
}

export function lineCurrencyCodes(row) {
  return [row?.currency, row?.hex, row?.ticker, row?.code, row?.lp_currency, row?.lp_currency_hex].filter(Boolean);
}
