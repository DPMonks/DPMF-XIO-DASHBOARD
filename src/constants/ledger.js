// XIO-primary ledger constants (TEST fork of XDX Exchange).
// Live AMMs verified 2026-09-13 via xrplcluster amm_info.

export const XIO_ISSUER = "rfuzioNFTKArnU1PQD5BEF272vpbHMRoxU";
export const XIO_CURRENCY = "XIO";
export const XIO_HEX = "58494F0000000000000000000000000000000000";
/** Nominal ceiling; gateway obligations ~9983 XIO as of fork. */
export const XIO_TOTAL_SUPPLY = 10_000;
export const XIO_ISSUED_AT = "2021-10-24T00:00:00.000Z";
export const XIO_XRPL_TO_MD5 = "850edef1e93476d34aac3e8aaa03943b";

export function issuerLockedFromIssued(issued, total = XIO_TOTAL_SUPPLY) {
  const out = Number(issued);
  if (!Number.isFinite(out) || out <= 0) return 0;
  return Math.max(0, Math.round((total - out) * 1e8) / 1e8);
}

// XIO/XRP AMM (live)
export const XIO_XRP_AMM = "rPYfrbCvJGGEs9ddUtRiq58kCJBw9hoGij";
export const XIO_XRP_LP_HEX = "030AE7B410D0ECF1DEC886D216866C31C898C875";
/** xrpl.to md5(issuer + "_" + lpCurrencyHex); LP XRP/XIO. */
export const XIO_XRP_LP_XRPL_TO_MD5 = "4816f119c6fb9e2edf665adc0136deee";

// tfSetNoRipple - standard IOU trustline so the line cannot ripple.
export const TF_SET_NO_RIPPLE = 131072;
export const XIO_TRUST_LIMIT = "100000000000000000"; // big limit; never 0

export function xioTrustSetTxjson(account) {
  const txjson = {
    TransactionType: "TrustSet",
    Flags: TF_SET_NO_RIPPLE,
    LimitAmount: {
      currency: XIO_CURRENCY,
      issuer: XIO_ISSUER,
      value: XIO_TRUST_LIMIT,
    },
  };
  const signer = String(account || "").trim();
  if (signer) txjson.Account = signer;
  return txjson;
}

export const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
export const RLUSD_HEX = "524C555344000000000000000000000000000000";
// No live XIO/RLUSD AMM yet - keep slots empty so UI can hide/disable.
export const XIO_RLUSD_AMM = "";
export const XIO_RLUSD_LP_HEX = "";
export const XIO_RLUSD_LP_XRPL_TO_MD5 = "";
export const XRP_XRPL_TO_MD5 = "84e5efeb89c4eae8f68188982dc290d8";


// Quote asset XDX (sibling DPMF token - not primary)
export const XDX_ISSUER = "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo";
export const XDX_CURRENCY = "XDX";
export const XDX_HEX = "5844580000000000000000000000000000000000";

// XIO/XDX AMM (same pool formerly labeled XDX/XIO on the XDX exchange)
export const XIO_XDX_AMM = "rDJXzsZGACeHGJQYfaudsYshaC5zJxqsHr";
export const XIO_XDX_LP_HEX = "03E7A465A6E95CDA21E1110056AA51A71FA55CB9";
/** xrpl.to md5(issuer + "_" + lpCurrencyHex); LP XDX/XIO. */
export const XIO_XDX_LP_XRPL_TO_MD5 = "06cfb2c7f7b73a31affc7f93dfd747c2";

export function xrplToMd5ForLpPool(pool) {
  const name = String(pool || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "/");
  if (name.includes("RLUSD") || (XIO_RLUSD_AMM && name === XIO_RLUSD_AMM.toUpperCase())) {
    return XIO_RLUSD_LP_XRPL_TO_MD5;
  }
  if (
    name.includes("XDX") ||
    (XIO_XDX_AMM && name === XIO_XDX_AMM.toUpperCase()) ||
    name.includes(XIO_XDX_LP_HEX)
  ) {
    return XIO_XDX_LP_XRPL_TO_MD5;
  }
  return XIO_XRP_LP_XRPL_TO_MD5;
}

export const XSQUAD_ISSUER = "roBYiFtZsTRpWEUw6TtpUCwZCfjcQeRBg";
export const XSQUAD_HEX = "5853515541440000000000000000000000000000";
// No live XIO/XSQUAD AMM discovered - leave empty.
export const XIO_XSQUAD_AMM = "";
export const XIO_XSQUAD_LP_HEX = "";

// 1% platform fee for swaps where neither side is XIO.
export const XIO_FEE_TREASURY = "rDPMFBANKMexTKkC7e4n3ekD9HfhmWHva8";
export const XIO_PLATFORM_FEE_PCT = 1;

// Non-XIO swaps require this much LP value in any one of these pools.
export const SWAP_LP_GOVERNANCE_USD = 10;
export const SWAP_LP_GOVERNANCE_PAIRS = ["XIO/XRP", "XIO/XDX"];

export function asciiCurrencyHex(code) {
  const text = String(code || "");
  let hex = "";
  for (let i = 0; i < text.length; i += 1) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(2, "0");
  }
  return hex.padEnd(40, "0");
}

export const POOLS = [
  {
    pair: "XIO/XRP",
    amm: XIO_XRP_AMM,
    lpHex: XIO_XRP_LP_HEX,
    asset: "XIO",
    quote: "XRP",
  },
  {
    pair: "XIO/XDX",
    amm: XIO_XDX_AMM,
    lpHex: XIO_XDX_LP_HEX,
    asset: "XIO",
    quote: "XDX",
    quoteIssuer: XDX_ISSUER,
    quoteHex: XDX_HEX,
  },
].filter((row) => row.amm && row.lpHex);

export function pairFromRow(row = {}) {
  const named = row.pair || row.pool || row.pool_name || row.poolName || row.name;
  if (named && String(named).includes("/")) {
    return String(named).replace(/\s+/g, "").toUpperCase();
  }
  if (named) return String(named);

  const haystack = [
    row.amm,
    row.amm_account,
    row.amm_issuer,
    row.lp_issuer,
    row.issuer,
    row.currency,
    row.lp_currency,
    row.lp_currency_hex,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  const quoteHint = [row.quote, row.quote_hex, row.quote_issuer, row.asset2]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  const look = `${haystack} ${quoteHint}`;

  if (XIO_XDX_AMM && (look.includes(XIO_XDX_AMM.toUpperCase()) || look.includes(XIO_XDX_LP_HEX))) {
    return "XIO/XDX";
  }
  if (XIO_XRP_AMM && (look.includes(XIO_XRP_AMM.toUpperCase()) || look.includes(XIO_XRP_LP_HEX))) {
    return "XIO/XRP";
  }
  if (look.includes(XDX_ISSUER.toUpperCase()) || look.includes(XDX_HEX) || /(^|\s)XDX(\s|$)/.test(look)) {
    return "XIO/XDX";
  }
  if (look.includes("RLUSD") || look.includes(RLUSD_HEX)) {
    return "XIO/RLUSD";
  }

  const amm = row.amm_account || row.amm;
  if (amm && String(amm).length >= 8) {
    const text = String(amm);
    return `XIO/${text.slice(0, 4)}...${text.slice(-4)}`;
  }
  const lpHex = String(row.lp_currency || row.lp_currency_hex || "").replace(/^0x/i, "").toUpperCase();
  if (
    /^03[A-F0-9]{38}$/.test(lpHex) &&
    lpHex !== XIO_XRP_LP_HEX &&
    lpHex !== XIO_XDX_LP_HEX
  ) {
    return "";
  }
  return "XIO/XRP";
}
