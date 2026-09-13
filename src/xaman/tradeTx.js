import {RLUSD_HEX, RLUSD_ISSUER, TF_SET_NO_RIPPLE, XIO_ISSUER, XIO_CURRENCY, XIO_RLUSD_AMM, XIO_RLUSD_LP_HEX, XIO_XRP_AMM, XIO_XRP_LP_HEX, XIO_XDX_AMM, XIO_XDX_LP_HEX, XIO_XSQUAD_AMM, XIO_XSQUAD_LP_HEX, XDX_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER, asciiCurrencyHex} from "../constants/ledger.js";
import {decodeCurrency, isNativeXrpQuote, lineCounterparty, lineCurrencyCodes, sameIssuedCurrency} from "../utils/currency.js";
import {detectQuoteUsd} from "../utils/poolSplit.js";
import {pendingFromExecution, rememberPending} from "../wallet/ledgerOrders.js";
import {rememberTradeNotice} from "../wallet/tradeNotice.js";
import {pendingVoteFromExecution} from "../wallet/ammVote.js";
import {preferMarkWhenPoolInsane} from "../wallet/quoteMarker.js";
import {liveWalletAddress} from "../wallet/walletStorage.js";
import {paymentFlagsForMode} from "../swap/swapRouting.js";
import {extractTradeMarker} from "./signMarker.js";
import {isConsumedUuid, isPayloadUuid, peekPendingPayload, rememberConsumedUuid, rememberPendingPayload} from "./payloadResume.js";

export const ACTION_TX_TYPES = {
  buy: ["Payment", "OfferCreate"],
  sell: ["Payment", "OfferCreate"],
  addLp: ["AMMDeposit"],
  removeLp: ["AMMWithdraw"],
  createPool: ["AMMCreate"],
  vote: ["AMMVote"],
  xioPlatformFee: ["Payment"],
  crossSwap: ["Payment"],
};

export function executionTxType(detail = {}) {
  return String(
    detail.txType ||
      detail.txjson?.TransactionType ||
      detail.payload?.tx_type ||
      detail.payload?.request_json?.TransactionType ||
      detail.result?.payload?.tx_type ||
      ""
  ).trim();
}

export function executionClosesTradeAction(action, detail = {}) {
  const txType = executionTxType(detail);
  if (txType === "TrustSet" || txType === "SignIn") return false;
  const allowed = ACTION_TX_TYPES[action];
  if (!allowed) return Boolean(action);
  if (!txType) return true;
  return allowed.includes(txType);
}

export function executionResolvedAtMs(detail = {}) {
  const raw =
    detail.resolved_at ||
    detail.payload?.meta?.resolved_at ||
    detail.result?.meta?.resolved_at ||
    detail.signed_at ||
    "";
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const numeric = Number(detail.at);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function executionBelongsToOpenTrade(current, detail = {}) {
  if (!current?.action || !executionClosesTradeAction(current.action, detail)) return false;
  const openedAt = Number(current.openId) || 0;
  const resolvedMs = executionResolvedAtMs(detail);
  if (openedAt && resolvedMs && resolvedMs + 2000 < openedAt) return false;

  const eventUuid = String(detail.uuid || "").trim().toLowerCase();
  const currentUuid = String(current.activeUuid || current.resumeUuid || "").trim().toLowerCase();
  if (!currentUuid) return false;
  if (eventUuid && currentUuid !== eventUuid) return false;

  const eventMarker = String(detail.signMarker || extractTradeMarker(detail.txjson) || "").trim();
  const currentMarker = String(current.signMarker || "").trim();
  if (currentMarker && eventMarker && currentMarker !== eventMarker) return false;
  return true;
}

export const DROPS_PER_XRP = 1_000_000;
export const TF_IMMEDIATE_OR_CANCEL = 131072;
export const TF_PARTIAL_PAYMENT = 131072;
export const TF_NO_DIRECT_RIPPLE = 65536;
export const TF_LIMIT_QUALITY = 262144;
export const TF_TWO_ASSET = 1_048_576;
export const TF_SINGLE_ASSET = 524_288;
export const TF_LP_TOKEN = 65_536;
// AMMWithdraw only. 262144 is tfOneAssetWithdrawAll (Amount, no LPTokenIn)
// and is temMALFORMED if LPTokenIn is also present.
export const TF_ONE_ASSET_LP_TOKEN = 2_097_152;
export const TF_ONE_ASSET_WITHDRAW_ALL = 262_144;
export const LEDGER_FEE_XRP = 0.000012;
export const MARKET_SLIPPAGE = 0.15;

export function withMarketSlippage(value, side = "buy") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return side === "sell" ? n * (1 - MARKET_SLIPPAGE) : n * (1 + MARKET_SLIPPAGE);
}

export const QUOTE_ASSETS = [
  { id: "XRP", currency: "XRP", label: "XRP" },
  { id: "RLUSD", currency: "RLUSD", issuer: RLUSD_ISSUER, hex: RLUSD_HEX, label: "RLUSD" },
  { id: "XIO", currency: "XIO", issuer: XDX_ISSUER, label: "XIO" },
  { id: "XSQUAD", currency: "XSQUAD", issuer: XSQUAD_ISSUER, hex: XSQUAD_HEX, label: "XSQUAD" },
];

export function quoteAsset(id) {
  return QUOTE_ASSETS.find((row) => row.id === id) || QUOTE_ASSETS[0];
}

export function knownLpIdentity(pair, quoteId) {
  const want = String(pair || (quoteId ? `XIO/${quoteId}` : ""))
    .replace(/\s+/g, "")
    .toUpperCase();
  if (want === "XIO/RLUSD" || String(quoteId || "").toUpperCase() === "RLUSD") {
    return { pair: "XIO/RLUSD", amm: XIO_RLUSD_AMM, lpCurrency: XIO_RLUSD_LP_HEX };
  }
  if (want === "XIO/XRP" || String(quoteId || "").toUpperCase() === "XRP") {
    return { pair: "XIO/XRP", amm: XIO_XRP_AMM, lpCurrency: XIO_XRP_LP_HEX };
  }
  if (want === "XIO/XDX" || String(quoteId || "").toUpperCase() === "XIO") {
    return { pair: "XIO/XDX", amm: XIO_XDX_AMM, lpCurrency: XIO_XDX_LP_HEX };
  }
  if (want === "XIO/XSQUAD" || String(quoteId || "").toUpperCase() === "XSQUAD") {
    return { pair: "XIO/XSQUAD", amm: XIO_XSQUAD_AMM, lpCurrency: XIO_XSQUAD_LP_HEX };
  }
  return { pair: want, amm: "", lpCurrency: "" };
}

const KNOWN_LP_BY_AMM = new Map(
  [
    [XIO_XRP_AMM, "XIO/XRP"],
    [XIO_RLUSD_AMM, "XIO/RLUSD"],
    [XIO_XDX_AMM, "XIO/XDX"],
    [XIO_XSQUAD_AMM, "XIO/XSQUAD"],
  ].map(([amm, pair]) => [String(amm).toLowerCase(), pair])
);
const KNOWN_LP_BY_HEX = new Map(
  [
    [XIO_XRP_LP_HEX, "XIO/XRP"],
    [XIO_RLUSD_LP_HEX, "XIO/RLUSD"],
    [XIO_XDX_LP_HEX, "XIO/XDX"],
    [XIO_XSQUAD_LP_HEX, "XIO/XSQUAD"],
  ].map(([hex, pair]) => [String(hex).toUpperCase(), pair])
);

export function lpRowMatchesPair(item, pair, quoteId, spec = {}) {
  const want = String(pair || (quoteId ? `XIO/${quoteId}` : ""))
    .replace(/\s+/g, "")
    .toUpperCase();
  const quote = String(quoteId || want.split("/")[1] || "").toUpperCase();
  const known = knownLpIdentity(want, quote);
  const wantAmm = String(spec.amm || spec.amm_account || known.amm || "").toLowerCase();
  const wantLp = String(spec.lpCurrency || spec.lp_currency || known.lpCurrency || "").toUpperCase();
  const name = String(item?.pool_name || item?.pool || item?.pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const rowQuote = String(item?.quote || "").replace(/^XIO\//, "").toUpperCase();
  const amm = String(item?.amm_account || item?.amm || "").toLowerCase();
  const hex = String(item?.lp_currency || item?.lp_currency_hex || "")
    .replace(/^0x/i, "")
    .toUpperCase();
  const rowKnownPair = KNOWN_LP_BY_AMM.get(amm) || (isLpCurrency(hex) ? KNOWN_LP_BY_HEX.get(hex) : "");

  if (rowKnownPair && rowKnownPair !== want) return false;
  if (wantAmm && amm && amm === wantAmm) return true;
  if (wantLp && isLpCurrency(hex) && hex === wantLp) return true;
  if (quote && rowQuote && rowQuote === quote) return true;
  return name === want || (quote && name === `XIO/${quote}`);
}

export function lpHeldForPair(rows, pair, quoteId, spec = {}) {
  const row = (Array.isArray(rows) ? rows : []).find((item) =>
    lpRowMatchesPair(item, pair, quoteId, spec)
  );
  const n = Number(row?.lp_balance ?? row?.lp ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function quoteIdFromPair(pair) {
  const text = String(pair || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!text) return "XRP";
  if (text.includes("/")) return text.split("/").pop() || "XRP";
  return text;
}

export const WALLET_EVENTS = {
  needSignIn: "dpmf-need-sign-in",
  signedIn: "dpmf-wallet-signed-in",
  signInCancelled: "dpmf-sign-in-cancelled",
  tradePending: "dpmf-trade-pending",
};

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function optionalAmount(value) {
  return value != null && Number(value) > 0 ? Number(value) : null;
}

export function normalizeTradeRequest(detail) {
  if (!detail) return null;
  if (typeof detail === "string") return { action: detail, quote: "XRP" };
  const action = detail.action || detail.id || null;
  if (!action) return null;
  return {
    action,
    quote: quoteIdFromPair(detail.quote || detail.pair || detail.pool || detail.toId || "XRP"),
    quoteIssuer: detail.quoteIssuer || detail.quote_issuer || null,
    quoteHex: detail.quoteHex || detail.quote_hex || null,
    amm: detail.amm || detail.amm_account || null,
    lpCurrency: detail.lpCurrency || detail.lp_currency || null,
    amount: optionalAmount(detail.amount),
    fromId: optionalText(detail.fromId),
    toId: optionalText(detail.toId),
    fromIssuer: optionalText(detail.fromIssuer),
    fromHex: optionalText(detail.fromHex),
    toIssuer: optionalText(detail.toIssuer),
    toHex: optionalText(detail.toHex),
    receive: optionalAmount(detail.receive),
    feeUsd: optionalAmount(detail.feeUsd),
    nextTrade: detail.nextTrade && typeof detail.nextTrade === "object" ? detail.nextTrade : null,
  };
}

export function gateUnsignedTrade(detail, walletAddress) {
  const trade = normalizeTradeRequest(detail);
  if (!trade) return { action: "ignore" };
  if (liveWalletAddress(walletAddress)) return { action: "open", trade };
  return { action: "sign-in", trade };
}

export function resolveQuote(id, extra = {}) {
  const key = quoteIdFromPair(id || extra.quote);
  const known = QUOTE_ASSETS.find((row) => row.id === key);
  const rawQuote = extra.currency || (extra.quote && !String(extra.quote).includes("/") ? extra.quote : null);
  if (known) {
    return {
      ...known,
      pair: `XIO/${known.id}`,
      issuer: known.id === "XRP" ? null : extra.quoteIssuer || extra.quote_issuer || extra.issuer || known.issuer || null,
      hex: extra.quoteHex || extra.quote_hex || extra.hex || known.hex || null,
      amm: extra.amm || extra.amm_account || null,
      lpCurrency: extra.lpCurrency || extra.lp_currency || null,
    };
  }
  return {
    id: key,
    currency: key === "XRP" ? "XRP" : rawQuote || key,
    issuer: key === "XRP" ? null : extra.quoteIssuer || extra.quote_issuer || extra.issuer || null,
    hex: extra.quoteHex || extra.quote_hex || extra.hex || null,
    label: key,
    pair: `XIO/${key}`,
    amm: extra.amm || extra.amm_account || null,
    lpCurrency: extra.lpCurrency || extra.lp_currency || null,
  };
}

export function quoteHintsFromLines(lines, quote = {}) {
  const want = decodeCurrency(quote?.id || quote?.currency || quote?.label || "");
  if (!want || want === "XRP" || want === "XIO") return {};
  for (const row of Array.isArray(lines) ? lines : []) {
    const codes = lineCurrencyCodes(row);
    if (codes.some((code) => isLpCurrency(code))) continue;
    const ticker = codes.some((code) => decodeCurrency(code) === want || sameIssuedCurrency(code, want));
    if (!ticker) continue;
    const issuer = row.issuer || row.account || row.counterparty;
    if (!issuer) continue;
    const hex = codes
      .map((code) => String(code || "").replace(/^0x/i, "").toUpperCase())
      .find((code) => /^[A-F0-9]{40}$/.test(code) && !isLpCurrency(code));
    return { issuer, hex: hex || null };
  }
  return {};
}

export function quoteChoices(pools = []) {
  const ids = QUOTE_ASSETS.map((row) => row.id);
  for (const row of Array.isArray(pools) ? pools : []) {
    const id = quoteIdFromPair(row.pool || row.pool_name || row.pair || row.quote);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function quoteLedgerCurrency(quote) {
  if (isNativeXrpQuote(quote)) return "XRP";
  const code = String(quote.currency || quote.hex || quote.id || "");
  if (/^[A-Z0-9]{3}$/i.test(code)) return code.toUpperCase();
  if (/^[A-Fa-f0-9]{40}$/.test(code)) return code.toUpperCase();
  const hex = String(quote.hex || "");
  if (/^[A-Fa-f0-9]{40}$/.test(hex)) return hex.toUpperCase();
  return asciiCurrencyHex(quote.currency || quote.id || code);
}

export function xrplIssuedValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const abs = Math.abs(n);
  const decimals = abs >= 1 ? Math.min(8, Math.max(0, 15 - String(Math.trunc(abs)).length)) : 10;
  return n.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") || "0";
}

export function xrplIssuedFloor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const canon = xrplIssuedValue(n);
  if (Number(canon) <= n) return canon;
  const abs = Math.abs(n);
  const decimals = abs >= 1 ? Math.min(8, Math.max(0, 15 - String(Math.trunc(abs)).length)) : 10;
  const stepped = n - 10 ** -decimals;
  return stepped > 0 ? xrplIssuedValue(stepped) : "0";
}

export function xrpDrops(xrp) {
  const n = Number(xrp);
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.round(n * DROPS_PER_XRP));
}

export function issuedAmount(currency, issuer, value) {
  return {
    currency,
    issuer,
    value: xrplIssuedValue(value),
  };
}

export function quoteAmount(quote, value) {
  if (isNativeXrpQuote(quote)) return xrpDrops(value);
  const currency = quoteLedgerCurrency(quote);
  if (!currency || currency === "XRP") return xrpDrops(value);
  return issuedAmount(currency, quote.issuer, value);
}

export function ammQuoteAsset(quote) {
  if (isNativeXrpQuote(quote)) return { currency: "XRP" };
  const currency = quoteLedgerCurrency(quote);
  if (!currency || currency === "XRP") return { currency: "XRP" };
  return { currency, issuer: quote.issuer };
}

export function xioAmount(value) {
  return issuedAmount(XIO_CURRENCY, XIO_ISSUER, value);
}

/**
 * Market buy/sell is a self Payment so rippled takes the pair's DEX book and
 * AMM. OfferCreate + Immediate-or-Cancel only hits resting CLOB offers and
 * returns tecKILLED when those are empty (ImmediateOfferKilled).
 */
export function applySwapRouteFlags(txjson, routingMode) {
  if (!txjson || txjson.TransactionType !== "Payment") return txjson;
  return { ...txjson, Flags: (Number(txjson.Flags) || 0) | paymentFlagsForMode(routingMode) };
}

export function marketBuyXio({ account, quote, xio, cost, routingMode } = {}) {
  const sendMax = withMarketSlippage(cost, "buy");
  const txjson = applySwapRouteFlags({
    TransactionType: "Payment",
    Amount: xioAmount(xio),
    SendMax: quoteAmount(quote, sendMax),
    Flags: TF_PARTIAL_PAYMENT,
  }, routingMode);
  if (account) {
    txjson.Account = account;
    txjson.Destination = account;
  }
  return txjson;
}

export function crossAssetSwapTxjson({ account, fromQuote, toQuote, sendMax, deliver, routingMode } = {}) {
  const minOut = withMarketSlippage(deliver, "sell");
  const txjson = applySwapRouteFlags({
    TransactionType: "Payment",
    Amount: quoteAmount(toQuote, minOut),
    SendMax: quoteAmount(fromQuote, sendMax),
    Flags: TF_PARTIAL_PAYMENT,
  }, routingMode);
  if (account) {
    txjson.Account = account;
    txjson.Destination = account;
  }
  return txjson;
}

export function marketSellXio({ account, quote, xio, proceeds, routingMode } = {}) {
  const deliver = withMarketSlippage(proceeds, "sell");
  const txjson = applySwapRouteFlags({
    TransactionType: "Payment",
    Amount: quoteAmount(quote, deliver),
    SendMax: xioAmount(xio),
    Flags: TF_PARTIAL_PAYMENT,
  }, routingMode);
  if (account) {
    txjson.Account = account;
    txjson.Destination = account;
  }
  return txjson;
}

export function offerCreateBuyXio({ account, quote, xio, cost, market = false, routingMode } = {}) {
  if (market) return marketBuyXio({ account, quote, xio, cost, routingMode });
  const txjson = {
    TransactionType: "OfferCreate",
    TakerPays: xioAmount(xio),
    TakerGets: quoteAmount(quote, cost),
  };
  if (account) txjson.Account = account;
  return txjson;
}

export function offerCreateSellXio({ account, quote, xio, proceeds, market = false, routingMode } = {}) {
  if (market) return marketSellXio({ account, quote, xio, proceeds, routingMode });
  const txjson = {
    TransactionType: "OfferCreate",
    TakerGets: xioAmount(xio),
    TakerPays: quoteAmount(quote, proceeds),
  };
  if (account) txjson.Account = account;
  return txjson;
}

export function ammDepositTx({ account, quote, xio, quoteQty, mode = "double", singleAsset = "xio" } = {}) {
  const txjson = {
    TransactionType: "AMMDeposit",
    Asset: { currency: XIO_CURRENCY, issuer: XIO_ISSUER },
    Asset2: ammQuoteAsset(quote),
  };
  if (mode === "single") {
    txjson.Flags = TF_SINGLE_ASSET;
    txjson.Amount = singleAsset === "quote" ? quoteAmount(quote, quoteQty) : xioAmount(xio);
  } else {
    txjson.Flags = TF_TWO_ASSET;
    txjson.Amount = xioAmount(xio);
    txjson.Amount2 = quoteAmount(quote, quoteQty);
  }
  if (account) txjson.Account = account;
  return txjson;
}

export function ledgerCurrencyCode(value) {
  return String(value || "")
    .trim()
    .replace(/^0x/i, "")
    .toUpperCase();
}

export function isLpCurrency(value) {
  return /^03[A-F0-9]{38}$/.test(ledgerCurrencyCode(value));
}

export function sameLedgerCurrency(left, right) {
  const a = ledgerCurrencyCode(left);
  const b = ledgerCurrencyCode(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^[A-F0-9]{40}$/.test(a) && b.length <= 20 && asciiCurrencyHex(b) === a) return true;
  if (/^[A-F0-9]{40}$/.test(b) && a.length <= 20 && asciiCurrencyHex(a) === b) return true;
  return false;
}

function asLpHex(value) {
  const hex = ledgerCurrencyCode(value);
  return isLpCurrency(hex) ? hex : null;
}

export function poolForQuote(quote, pools = [], live = null) {
  const pair = String(quote?.pair || `XIO/${quote?.id || quote?.currency || "XRP"}`)
    .replace(/\s+/g, "")
    .toUpperCase();
  const liveAmm = live?.amm_account || live?.amm || quote?.amm || quote?.amm_account || null;
  const liveLp =
    asLpHex(live?.lp_currency || live?.lp_currency_hex) || asLpHex(quote?.lpCurrency || quote?.lp_currency);
  if (liveAmm && liveLp) return { amm: liveAmm, lpCurrency: liveLp, pair };
  const quoteTicker = pair.split("/")[1] || "";
  const row = (Array.isArray(pools) ? pools : []).find((item) => {
    const name = String(item?.pool || item?.pool_name || item?.pair || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    const itemQuote = String(item?.quote || "")
      .replace(/^XIO\//i, "")
      .toUpperCase();
    return name === pair || (quoteTicker && (name.endsWith(`/${quoteTicker}`) || itemQuote === quoteTicker));
  });
  const amm = row?.amm_account || row?.amm || liveAmm || null;
  const lpCurrency = asLpHex(row?.lp_currency || row?.lp_currency_hex || liveLp);
  if (amm && lpCurrency) return { amm, lpCurrency, pair };
  const known = knownLpIdentity(pair, quoteTicker || quote?.id);
  if (known.amm && known.lpCurrency) {
    return {
      amm: amm || known.amm,
      lpCurrency: lpCurrency || known.lpCurrency,
      pair: known.pair || pair,
    };
  }
  if (amm) return { amm, lpCurrency, pair };
  return { amm: null, lpCurrency: null, pair };
}

export function ownerReserveIncrementXrp(account = {}) {
  const drops = Number(account.reserve_inc_drops ?? account.reserveIncDrops);
  return Number.isFinite(drops) && drops > 0 ? drops / DROPS_PER_XRP : 0.2;
}

export function extraTrustLinesNeeded({
  needLpLine = false,
  needQuoteTrust = false,
  action = "",
  haveLpLine = false,
} = {}) {
  let lines = 0;
  if (needLpLine) lines += 1;
  else if (String(action) === "addLp" && !haveLpLine) lines += 1;
  if (needQuoteTrust) lines += 1;
  return lines;
}

export function unusedXrpCoversLines({ spendable, total, account, extraLines = 0 } = {}) {
  const lines = Math.max(0, Number(extraLines) || 0);
  const increment = ownerReserveIncrementXrp(account);
  const spend = spendable == null || spendable === "" ? null : Number(spendable);
  const hold = total == null || total === "" ? null : Number(total);
  const need = lines > 0 ? lines * increment + LEDGER_FEE_XRP : 0;
  if (!(lines > 0)) {
    return { ok: true, need: 0, increment, spendable: Number.isFinite(spend) ? spend : null };
  }
  if (!Number.isFinite(spend)) {
    return { ok: true, need, increment, spendable: null };
  }
  // A missed account_info used to store XRP as 0. Do not block a live
  // deposit on that false zero — only refuse when a real hold is reserved.
  if (!(hold > 0) && !(spend > 0)) {
    return { ok: true, need, increment, spendable: spend, unknown: true };
  }
  return { ok: spend + 1e-9 >= need, need, increment, spendable: spend };
}


/** Trust lines with limit 0 cannot receive IOUs — treat as missing. */
export function lineLimitOk(row, min = 1) {
  const lim = Number(row?.limit ?? row?.Limit ?? row?.limit_peer ?? 0);
  return Number.isFinite(lim) && lim >= min;
}

export const BIG_TRUST_LIMIT = "100000000000000000";

export function lpTrustSetTxjson(account, spec = {}) {
  const currency = isLpCurrency(spec.lpCurrency || spec.currency)
    ? String(spec.lpCurrency || spec.currency).trim().toUpperCase()
    : "";
  const issuer = String(spec.amm || spec.issuer || "").trim();
  if (!currency || !issuer) return null;
  const txjson = {
    TransactionType: "TrustSet",
    Flags: TF_SET_NO_RIPPLE,
    LimitAmount: {
      currency,
      issuer,
      value: BIG_TRUST_LIMIT,
    },
  };
  if (account) txjson.Account = account;
  return txjson;
}

export function hasLpTrustline(lines, spec = {}) {
  const currency = asLpHex(spec.lpCurrency || spec.currency || spec.lp_currency) || "";
  const issuer = String(spec.amm || spec.issuer || spec.amm_account || "").toUpperCase();
  if (!currency && !issuer) return false;
  return (Array.isArray(lines) ? lines : []).some((row) => {
    if (!lineLimitOk(row)) return false;
    const who = lineCounterparty(row);
    const codes = lineCurrencyCodes(row);
    const lpLine = Boolean(row?.lp) || codes.some((code) => isLpCurrency(code));
    if (issuer && who && who === issuer && lpLine) return true;
    if (currency && codes.some((code) => sameIssuedCurrency(code, currency))) {
      if (issuer && who && who !== issuer) return false;
      return true;
    }
    return false;
  });
}

export function hasLpRow(rows, pair, quoteId, spec = {}) {
  return (Array.isArray(rows) ? rows : []).some((item) => lpRowMatchesPair(item, pair, quoteId, spec));
}

export function ammWithdrawTx({
  account,
  quote,
  lpAmount,
  pools,
  live,
  mode = "double",
  singleAsset = "xio",
} = {}) {
  const pool = poolForQuote(quote, pools, live);
  const txjson = {
    TransactionType: "AMMWithdraw",
    Asset: { currency: XIO_CURRENCY, issuer: XIO_ISSUER },
    Asset2: ammQuoteAsset(quote),
    LPTokenIn: {
      currency: pool.lpCurrency,
      issuer: pool.amm,
      value: xrplIssuedFloor(lpAmount),
    },
    Flags: TF_LP_TOKEN,
  };
  if (mode === "single") {
    // tfOneAssetLPToken: Amount is a *minimum*. 0 means accept any
    // positive output so the AMM trading fee cannot trigger tecAMM_FAILED.
    txjson.Flags = TF_ONE_ASSET_LP_TOKEN;
    txjson.Amount = singleAsset === "quote" ? quoteAmount(quote, 0) : xioAmount(0);
  }
  if (account) txjson.Account = account;
  return txjson;
}

export function quoteTrustSetTxjson(account, quote) {
  if (!quote?.issuer) return null;
  const currency = quoteLedgerCurrency(quote);
  if (!currency || currency === "XRP") return null;
  const txjson = {
    TransactionType: "TrustSet",
    Flags: TF_SET_NO_RIPPLE,
    LimitAmount: {
      currency,
      issuer: quote.issuer,
      value: BIG_TRUST_LIMIT,
    },
  };
  if (account) txjson.Account = account;
  return txjson;
}

export function hasQuoteTrustline(lines, quote = {}) {
  if (isNativeXrpQuote(quote)) return true;
  if (!quote?.issuer) return false;
  const issuer = String(quote.issuer || "").toUpperCase();
  const wants = [quote.currency, quote.hex, quote.id, quote.label, quoteLedgerCurrency(quote)].filter(Boolean);
  return (Array.isArray(lines) ? lines : []).some((row) => {
    if (!lineLimitOk(row)) return false;
    const who = lineCounterparty(row);
    if (issuer && who && who !== issuer) return false;
    if (lineCurrencyCodes(row).some((code) => isLpCurrency(code))) return false;
    return wants.some((want) => lineCurrencyCodes(row).some((code) => sameIssuedCurrency(code, want)));
  });
}

export function shouldAskLpTrustline({ loaded = false, haveLine = false, spec = {} } = {}) {
  if (!loaded || haveLine) return false;
  return Boolean(spec?.amm && isLpCurrency(spec.lpCurrency));
}

export function shouldAskQuoteTrustline({
  loaded = false,
  haveLine = false,
  haveLp = false,
  quote = {},
} = {}) {
  if (!quote?.issuer || haveLine || haveLp || !loaded) return false;
  return true;
}

export function tradeTotal(amount, price) {
  const qty = Number(amount);
  const px = Number(price);
  if (!Number.isFinite(qty) || !Number.isFinite(px) || qty <= 0 || px <= 0) return 0;
  return qty * px;
}

export function poolPrice(reserveBase, reserveQuote) {
  const base = Number(reserveBase);
  const quote = Number(reserveQuote);
  if (!(base > 0) || !(quote > 0)) return 0;
  return quote / base;
}

export function visibleQuoteQty(quoteQty, hint) {
  if (quoteQty !== "" && quoteQty != null) return String(quoteQty);
  return Number(hint) > 0 ? String(hint) : "";
}

export const MAX_TRADE_QTY = 1_000_000_000_000;

export function formatLinkedQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const capped = Math.min(n, MAX_TRADE_QTY);
  if (capped >= 1_000_000) return String(Math.round(capped));
  const text = capped.toPrecision(8);
  if (/[eE]/.test(text)) return capped.toFixed(8).replace(/\.?0+$/, "");
  return String(Number(text));
}

export function sanitizeQtyInput(raw) {
  const text = String(raw ?? "").replace(/,/g, "").trim();
  if (text === "" || text === "." || text === "0.") return text;
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const clipped = text.length > 18 ? text.slice(0, 18) : text;
  const n = Number(clipped);
  if (Number.isFinite(n) && n > MAX_TRADE_QTY) return String(MAX_TRADE_QTY);
  return clipped;
}

export function usdEqualOpposingAmounts({
  editedSide = "xio",
  amount,
  quoteQty,
  xioUsd,
  quoteUsd,
} = {}) {
  const xUsd = Number(xioUsd);
  const qUsd = Number(quoteUsd);
  if (!(xUsd > 0) || !(qUsd > 0)) return null;
  const side = editedSide === "quote" ? "quote" : "xio";
  if (side === "quote") {
    const quote = Number(quoteQty);
    if (!(quote > 0)) return null;
    const usd = quote * qUsd;
    return { xio: usd / xUsd, quote, usd };
  }
  const xio = Number(amount);
  if (!(xio > 0)) return null;
  const usd = xio * xUsd;
  return { xio, quote: usd / qUsd, usd };
}

export function linkedDepositAmounts({
  editedSide = "xio",
  amount,
  quoteQty,
  price,
  reserveBase,
  reserveQuote,
  preferMark = false,
  preferUsdEqual = false,
  xioUsd,
  quoteUsd,
} = {}) {
  const side = editedSide === "quote" ? "quote" : "xio";
  if (preferUsdEqual) {
    const equal = usdEqualOpposingAmounts({
      editedSide: side,
      amount,
      quoteQty,
      xioUsd,
      quoteUsd,
    });
    if (equal) {
      if (side === "quote") {
        return {
          xio: equal.xio > 0 ? equal.xio : 0,
          quote: equal.quote > 0 ? equal.quote : 0,
          xioInput: equal.xio > 0 ? formatLinkedQty(equal.xio) : "",
          quoteInput: quoteQty == null ? "" : String(quoteQty),
          basis: "usd",
          usd: equal.usd,
        };
      }
      return {
        xio: equal.xio > 0 ? equal.xio : 0,
        quote: equal.quote > 0 ? equal.quote : 0,
        xioInput: amount == null ? "" : String(amount),
        quoteInput: equal.quote > 0 ? formatLinkedQty(equal.quote) : "",
        basis: "usd",
        usd: equal.usd,
      };
    }
  }
  if (side === "quote") {
    const quote = Number(quoteQty);
    const xio = predictedXioFromQuote(quoteQty, price, reserveBase, reserveQuote, { preferMark });
    return {
      xio: xio > 0 ? xio : 0,
      quote: quote > 0 ? quote : 0,
      xioInput: xio > 0 ? formatLinkedQty(xio) : "",
      quoteInput: quoteQty == null ? "" : String(quoteQty),
      basis: preferMark ? "mark" : "pool",
    };
  }
  const xio = Number(amount);
  const quote = predictedQuoteOut(amount, price, reserveBase, reserveQuote, { preferMark });
  return {
    xio: xio > 0 ? xio : 0,
    quote: quote > 0 ? quote : 0,
    xioInput: amount == null ? "" : String(amount),
    quoteInput: quote > 0 ? formatLinkedQty(quote) : "",
    basis: preferMark ? "mark" : "pool",
  };
}

export function predictedQuoteOut(xioAmount, price, reserveBase, reserveQuote, options = {}) {
  const fromPool = recommendedQuote(xioAmount, reserveBase, reserveQuote);
  const marked = tradeTotal(xioAmount, price);
  if (options.preferMark) return preferMarkWhenPoolInsane(fromPool, marked);
  if (fromPool > 0) return fromPool;
  return marked;
}

export function predictedXioFromQuote(quoteAmount, price, reserveBase, reserveQuote, options = {}) {
  const base = Number(reserveBase);
  const quote = Number(reserveQuote);
  const qty = Number(quoteAmount);
  const fromPool = base > 0 && quote > 0 && qty > 0 ? (qty / quote) * base : 0;
  const px = Number(price);
  const marked = px > 0 && qty > 0 ? qty / px : 0;
  if (options.preferMark) return preferMarkWhenPoolInsane(fromPool, marked);
  if (fromPool > 0) return fromPool;
  return marked;
}

export function xioUnitUsd({ pool, prices } = {}) {
  const fromPool = Number(pool?.xioUsd);
  if (fromPool > 0) return fromPool;
  const fromPrices = Number(prices?.xioUsd ?? prices?.recorded_price);
  return fromPrices > 0 ? fromPrices : 0;
}

export function quoteUnitUsd({ quoteId, pool, prices, allowImplied = true } = {}) {
  return detectQuoteUsd({
    quoteId,
    pool: {
      ...pool,
      xioUsd: xioUnitUsd({ pool, prices }) || pool?.xioUsd,
    },
    prices,
    allowImplied,
  });
}

export function depositValueSplit({ xioAmount, quoteAmount, xioUsd, quoteUsd } = {}) {
  const xioValue = Math.max(0, Number(xioAmount) * Number(xioUsd) || 0);
  const quoteValue = Math.max(0, Number(quoteAmount) * Number(quoteUsd) || 0);
  const total = xioValue + quoteValue;
  if (!(total > 0)) {
    return { xioValue: 0, quoteValue: 0, total: 0, xioPct: 50, quotePct: 50, measured: false };
  }
  const xioPct = (xioValue / total) * 100;
  return {
    xioValue,
    quoteValue,
    total,
    xioPct,
    quotePct: 100 - xioPct,
    measured: Number(xioUsd) > 0 && Number(quoteUsd) > 0,
  };
}

export function recommendedQuote(xioAmount, reserveBase, reserveQuote) {
  const base = Number(reserveBase);
  const quote = Number(reserveQuote);
  const qty = Number(xioAmount);
  if (!(base > 0) || !(quote > 0) || !(qty > 0)) return 0;
  return (qty / base) * quote;
}

export function saneOpposingReserve(reserveBase, reserveQuote, price) {
  const base = Number(reserveBase);
  const quote = Number(reserveQuote);
  const px = Number(price);
  const marked = base > 0 && px > 0 ? base * px : 0;
  return preferMarkWhenPoolInsane(quote, marked) || (quote > 0 ? quote : marked);
}

export function expectedLpTokens(xioAmount, reserveBase, lpSupply) {
  const base = Number(reserveBase);
  const supply = Number(lpSupply);
  const qty = Number(xioAmount);
  if (!(base > 0) || !(supply > 0) || !(qty > 0)) return 0;
  return (qty / base) * supply;
}

export function expectedDoubleLpTokens(xioAmount, quoteAmount, reserveBase, reserveQuote, lpSupply) {
  const fromXio = expectedLpTokens(xioAmount, reserveBase, lpSupply);
  const fromQuote = expectedLpTokens(quoteAmount, reserveQuote, lpSupply);
  if (fromXio > 0 && fromQuote > 0) return Math.min(fromXio, fromQuote);
  return fromXio || fromQuote || 0;
}

export function expectedSingleLpTokens(deposit, reserve, lpSupply) {
  const qty = Number(deposit);
  const pool = Number(reserve);
  const supply = Number(lpSupply);
  if (!(qty > 0) || !(pool > 0) || !(supply > 0)) return 0;
  return supply * (Math.sqrt(1 + qty / pool) - 1);
}

export function expectedWithdraw(lpAmount, reserveBase, reserveQuote, lpSupply, options = {}) {
  const lp = Number(lpAmount);
  const supply = Number(lpSupply);
  if (!(lp > 0) || !(supply > 0)) return { base: 0, quote: 0 };
  // LP share is always the pool ratio. preferMark is only a last-resort
  // stand-in when the opposing reserve is missing, not a cross-market rewrite.
  const measured = Number(reserveQuote || 0);
  const quoteReserve =
    measured > 0
      ? measured
      : options.preferMark
        ? saneOpposingReserve(reserveBase, reserveQuote, options.price)
        : 0;
  return {
    base: (lp / supply) * Number(reserveBase || 0),
    quote: (lp / supply) * Number(quoteReserve || 0),
  };
}

export function expectedSingleWithdraw(lpAmount, reserve, lpSupply, tradingFee = 0) {
  const lp = Number(lpAmount);
  const pool = Number(reserve);
  const supply = Number(lpSupply);
  if (!(lp > 0) || !(pool > 0) || !(supply > 0) || lp > supply) return 0;
  const t1 = lp / supply;
  const fee = Math.min(Math.max(Number(tradingFee) || 0, 0), 1000) / 100_000;
  const denom = t1 * fee - 1;
  if (denom === 0) return 0;
  // rippled ammAssetOut (equation 8), including the trading fee.
  const frac = (t1 * t1 - t1 * (2 - fee)) / denom;
  if (!(frac > 0)) return 0;
  return pool * frac;
}

export function tradeSides({
  action,
  amount,
  quoteQty,
  quoteLabel,
  fromLabel,
  toLabel,
  total,
  lpAmount,
  lpOut,
  withdraw,
  singleAsset,
} = {}) {
  const label = quoteLabel || "XRP";
  if (action === "xioPlatformFee") {
    return {
      pay: [{ value: Number(amount) || 0, asset: "XIO" }],
      receive: [],
    };
  }
  if (action === "crossSwap") {
    return {
      pay: [{ value: Number(amount) || 0, asset: fromLabel || label }],
      receive: [{ value: Number(quoteQty) || 0, asset: toLabel || label }],
    };
  }
  if (action === "buy") {
    return {
      pay: [{ value: Number(quoteQty || total) || 0, asset: label }],
      receive: [{ value: Number(amount) || 0, asset: "XIO" }],
    };
  }
  if (action === "sell") {
    return {
      pay: [{ value: Number(amount) || 0, asset: "XIO" }],
      receive: [{ value: Number(quoteQty || total) || 0, asset: label }],
    };
  }
  if (action === "addLp") {
    const pay = [
      { value: Number(amount) || 0, asset: "XIO" },
      { value: Number(quoteQty) || 0, asset: label },
    ].filter((row) => row.value > 0);
    return {
      pay: pay.length ? pay : [{ value: 0, asset: "XIO" }],
      receive: [{ value: Number(lpOut) || 0, asset: "LP" }],
    };
  }
  const receive = [
    { value: Number(withdraw?.base) || 0, asset: "XIO" },
    { value: Number(withdraw?.quote) || 0, asset: label },
  ];
  if (singleAsset === "xio") receive.splice(1, 1);
  if (singleAsset === "quote") receive.splice(0, 1);
  return {
    pay: [{ value: Number(lpAmount) || 0, asset: "LP" }],
    receive,
  };
}

export function notifyWalletRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("dpmf-wallet-refresh"));
}

const announcedTrades = new Set();

function rememberConfirmed(detail = {}) {
  const account = detail.account || detail.txjson?.Account || null;
  const pending = pendingFromExecution(detail, account) || pendingVoteFromExecution(detail, account);
  if (pending) rememberPending(pending.activity.account, pending);
  return pending;
}

export function notifyTradePending(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_EVENTS.tradePending, { detail }));
}

export function notifyTradeExecuted(detail = {}) {
  if (typeof window === "undefined") return;
  if (detail.executed === false || detail.failed || detail.rejected) return;
  const pending = peekPendingPayload();
  const notice = {
    ...detail,
    kind: "executed",
    txjson: detail.txjson || pending?.txjson || null,
    trade: detail.trade || pending?.trade || null,
  };
  rememberTradeNotice(notice);
  const key = String(detail.uuid || detail.txid || "").trim().toLowerCase();
  const marker = detail.signMarker || extractTradeMarker(detail.txjson);
  if (key && (announcedTrades.has(key) || isConsumedUuid(key))) return;
  if (key) {
    announcedTrades.add(key);
    if (isPayloadUuid(key)) rememberConsumedUuid(key, marker);
  } else if (marker) {
    rememberConsumedUuid("", marker);
  }
  if (isPayloadUuid(key)) rememberPendingPayload(key, { signState: "executed", signMarker: marker });
  rememberConfirmed(notice);
  window.dispatchEvent(new CustomEvent("dpmf-trade-executed", { detail: { ...notice, executed: true } }));
  notifyWalletRefresh();
}

export function notifyFunctionConfirmed(detail = {}) {
  if (typeof window === "undefined") return;
  if (detail.executed === false || detail.failed || detail.rejected) return;
  const key = `fn:${String(detail.uuid || detail.txid || "").trim().toLowerCase()}`;
  if (key !== "fn:" && announcedTrades.has(key)) return;
  if (key !== "fn:") announcedTrades.add(key);
  rememberConfirmed(detail);
  window.dispatchEvent(new CustomEvent("dpmf-function-confirmed", { detail: { ...detail, executed: true } }));
  notifyWalletRefresh();
}

export function notifyTradeFailed(detail = {}) {
  if (typeof window === "undefined") return;
  const pending = peekPendingPayload();
  const notice = {
    ...detail,
    kind: "failed",
    txjson: detail.txjson || pending?.txjson || null,
    trade: detail.trade || pending?.trade || null,
  };
  rememberTradeNotice(notice);
  window.dispatchEvent(new CustomEvent("dpmf-trade-failed", { detail: notice }));
}

export function notifyTradeUnconfirmed(detail = {}) {
  if (typeof window === "undefined") return;
  rememberTradeNotice({ ...detail, kind: "unconfirmed" });
  window.dispatchEvent(new CustomEvent("dpmf-trade-unconfirmed", { detail }));
}
