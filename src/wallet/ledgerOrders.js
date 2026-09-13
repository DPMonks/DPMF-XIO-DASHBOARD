import {pairFromRow, RLUSD_HEX, RLUSD_ISSUER, XIO_HEX, XIO_ISSUER, XDX_HEX, XDX_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER} from "../constants/ledger.js";
import {activityFromAmmVoteTx, pairFromVoteAssets, quoteTickerFromCurrency} from "./ammVote.js";

export function amountAsIssue(amount) {
  if (amount == null || typeof amount === "string") return { currency: "XRP" };
  return { currency: amount.currency, issuer: amount.issuer };
}

export const RIPPLE_EPOCH = 946684800;
export const TF_IMMEDIATE_OR_CANCEL = 131072;

const KNOWN = [
  { code: "XIO", hex: XIO_HEX, issuer: XIO_ISSUER },
  { code: "RLUSD", hex: RLUSD_HEX, issuer: RLUSD_ISSUER },
  { code: "XIO", hex: XDX_HEX, issuer: XDX_ISSUER },
  { code: "XSQUAD", hex: XSQUAD_HEX, issuer: XSQUAD_ISSUER },
];

export function sameWallet(value, address) {
  const who = String(address || "").trim().toLowerCase();
  const name = String(value || "").trim().toLowerCase();
  return Boolean(who) && who === name;
}

export function rippleIso(seconds, fallback) {
  const n = Number(seconds);
  if (Number.isFinite(n) && n >= 0) {
    return new Date((n + RIPPLE_EPOCH) * 1000).toISOString();
  }
  if (fallback) return new Date(fallback).toISOString();
  return null;
}

export function printableTicker(value) {
  const text = String(value || "").trim();
  return /^[A-Z0-9.$]{2,20}$/i.test(text) ? text.toUpperCase() : "";
}

export function currencyCode(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toUpperCase() === "XRP") return "XRP";
  const upper = raw.toUpperCase();
  if (/^[A-Z0-9]{3}$/.test(upper)) return upper;
  const known = KNOWN.find((row) => row.hex === upper || row.code === upper);
  if (known) return known.code;
  const fromQuote = printableTicker(quoteTickerFromCurrency(raw));
  if (fromQuote) return fromQuote;
  if (/^[A-F0-9]{40}$/.test(upper)) {
    const chars = [];
    for (let i = 0; i < 40; i += 2) {
      const code = Number.parseInt(upper.slice(i, i + 2), 16);
      if (!code) break;
      chars.push(String.fromCharCode(code));
    }
    return printableTicker(chars.join("")) || upper;
  }
  return printableTicker(upper) || upper;
}

export function displayTrustlinePair(row = {}, pools = []) {
  const hex = String(row.currency || row.lp_currency || "")
    .replace(/^0x/i, "")
    .toUpperCase();
  const issuer = String(row.issuer || "").trim();
  const ticker = printableTicker(quoteTickerFromCurrency(row.currency, row.issuer) || row.currency);
  if (ticker === "XIO") return "XIO";
  if (ticker && ticker !== "XRP" && !/^[A-F0-9]{40}$/.test(ticker)) return `XIO/${ticker}`;

  const named = String(row.pair || "").trim().toUpperCase().replace(/\s+/g, "");
  if (named === "XIO") return "XIO";
  if (/^XIO\/[A-Z0-9.$]{2,20}$/.test(named)) return named;

  const fromKnown = pairFromRow({
    currency: hex,
    lp_currency: hex,
    issuer,
    amm_account: issuer,
    quote_issuer: issuer,
  });
  if (/^XIO\/[A-Z0-9.$]{2,20}$/.test(fromKnown)) return fromKnown;

  for (const pool of Array.isArray(pools) ? pools : []) {
    const poolHex = String(pool.lp_currency || pool.lp_currency_hex || "")
      .replace(/^0x/i, "")
      .toUpperCase();
    const amm = String(pool.amm_account || pool.amm || "").trim();
    if ((hex && poolHex === hex) || (issuer && amm && issuer.toLowerCase() === amm.toLowerCase())) {
      const pair = String(pool.pool || pool.pair || pool.pool_name || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/-/g, "/");
      if (/^XIO\/[A-Z0-9.$]{2,20}$/.test(pair)) return pair;
    }
  }
  return "";
}

export function readAmount(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const drops = Number(value);
    if (!Number.isFinite(drops) || drops < 0) return null;
    return { currency: "XRP", issuer: null, value: drops / 1_000_000 };
  }
  if (typeof value !== "object") return null;
  const n = Number(value.value ?? value.amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return {
    currency: currencyCode(value.currency || value.currencyCode),
    issuer: value.issuer || null,
    value: n,
  };
}

export function isXioAmount(amount) {
  return amount?.currency === "XIO";
}

export function orderFromOffer(offer = {}, address = "") {
  const gets = readAmount(offer.TakerGets ?? offer.taker_gets);
  const pays = readAmount(offer.TakerPays ?? offer.taker_pays);
  if (!gets || !pays) return null;
  const fundedGets = readAmount(offer.taker_gets_funded ?? offer.TakerGetsFunded);
  const fundedPays = readAmount(offer.taker_pays_funded ?? offer.TakerPaysFunded);
  let side;
  let amount;
  let quote;
  let cost;
  if (isXioAmount(gets)) {
    side = "ask";
    amount = fundedGets && isXioAmount(fundedGets) ? fundedGets.value : gets.value;
    quote = pays.currency;
    cost = pays.value;
  } else if (isXioAmount(pays)) {
    side = "bid";
    amount = fundedPays && isXioAmount(fundedPays) ? fundedPays.value : pays.value;
    quote = gets.currency;
    cost = gets.value;
  } else {
    return null;
  }
  if (!(amount > 0) || !(cost > 0)) return null;
  const account = offer.Account || offer.account || address || null;
  return {
    account,
    pair: `XIO/${quote === "XRP" ? "XRP" : quote}`,
    side,
    price: cost / amount,
    amount,
    quote,
    seq: offer.seq ?? offer.Sequence ?? null,
    txid: offer.hash || offer.txid || null,
    timestamp: offer.timestamp || null,
  };
}

export function orderFromPayment(txjson, extra = {}) {
  if (!txjson || txjson.TransactionType !== "Payment") return null;
  const sendMax = readAmount(txjson.SendMax);
  const delivered = readAmount(txjson.Amount);
  if (!sendMax || !delivered) return null;
  let side;
  let amount;
  let quote;
  let cost;
  if (isXioAmount(delivered) && !isXioAmount(sendMax)) {
    side = "bid";
    amount = delivered.value;
    quote = sendMax.currency;
    cost = sendMax.value;
  } else if (isXioAmount(sendMax) && !isXioAmount(delivered)) {
    side = "ask";
    amount = sendMax.value;
    quote = delivered.currency;
    cost = delivered.value;
  } else {
    return null;
  }
  if (!(amount > 0) || !(cost > 0)) return null;
  return {
    account: extra.account || txjson.Account || null,
    pair: `XIO/${quote === "XRP" ? "XRP" : quote}`,
    side,
    price: cost / amount,
    amount,
    quote,
    seq: txjson.Sequence ?? extra.seq ?? null,
    txid: extra.txid || txjson.hash || null,
    timestamp: extra.timestamp || null,
  };
}

export function isMarketSwap(txjson) {
  return Boolean(txjson?.TransactionType === "Payment" && txjson.SendMax != null) || isImmediateOrCancel(txjson);
}

export function orderFromTxjson(txjson, extra = {}) {
  if (txjson?.TransactionType === "Payment") return orderFromPayment(txjson, extra);
  if (!txjson || txjson.TransactionType !== "OfferCreate") return null;
  return orderFromOffer(
    {
      ...txjson,
      Account: extra.account || txjson.Account,
      hash: extra.txid || txjson.hash,
      timestamp: extra.timestamp,
    },
    extra.account
  );
}

export function offerStillOnLedger(meta, account) {
  const nodes = Array.isArray(meta?.AffectedNodes) ? meta.AffectedNodes : [];
  for (const node of nodes) {
    const created = node.CreatedNode;
    if (created?.LedgerEntryType !== "Offer") continue;
    const who = created.NewFields?.Account;
    if (!who || sameWallet(who, account)) return true;
  }
  for (const node of nodes) {
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType !== "Offer") continue;
    const who = modified.FinalFields?.Account || modified.PreviousFields?.Account;
    if (!who || sameWallet(who, account)) return true;
  }
  return false;
}

export function isLpCurrencyHex(value) {
  return /^03[A-Fa-f0-9]{38}$/.test(String(value || "").trim());
}

function rippleStateFields(wrap) {
  const created = wrap?.CreatedNode;
  const deleted = wrap?.DeletedNode;
  const modified = wrap?.ModifiedNode;
  const node = modified || created || deleted;
  if (!node || node.LedgerEntryType !== "RippleState") return null;
  return {
    created: Boolean(created),
    deleted: Boolean(deleted),
    node,
    final: node.FinalFields || node.NewFields || {},
    prev: node.PreviousFields || {},
  };
}

function lpNodeDelta(wrap, account) {
  const fields = rippleStateFields(wrap);
  if (!fields) return null;
  const { created, deleted, final, prev } = fields;
  const currency = String(final.Balance?.currency || prev.Balance?.currency || "");
  if (!isLpCurrencyHex(currency)) return null;
  const high = final.HighLimit || prev.HighLimit || {};
  const low = final.LowLimit || prev.LowLimit || {};
  if (
    account &&
    !sameWallet(high.issuer, account) &&
    !sameWallet(low.issuer, account) &&
    !sameWallet(final.Account, account)
  ) {
    return null;
  }
  const after = deleted ? 0 : Math.abs(Number(final.Balance?.value));
  if (!Number.isFinite(after)) return null;
  const prevHasBalance = prev.Balance != null;
  const before = created ? 0 : prevHasBalance ? Math.abs(Number(prev.Balance?.value || 0)) : after;
  const delta = after - (Number.isFinite(before) ? before : after);
  const amm = sameWallet(high.issuer, account) ? low.issuer : high.issuer;
  return { currency, amm, delta, after, before };
}

export function lpDeltaFromMeta(meta, account) {
  const nodes = Array.isArray(meta?.AffectedNodes) ? meta.AffectedNodes : meta?.meta?.AffectedNodes;
  let best = 0;
  for (const wrap of Array.isArray(nodes) ? nodes : []) {
    const row = lpNodeDelta(wrap, account);
    if (row && row.delta > best) best = row.delta;
  }
  return best > 0 ? best : 0;
}

export function lpBalanceEventsFromMeta(meta, account) {
  const nodes = Array.isArray(meta?.AffectedNodes) ? meta.AffectedNodes : meta?.meta?.AffectedNodes;
  const byHex = new Map();
  for (const wrap of Array.isArray(nodes) ? nodes : []) {
    const row = lpNodeDelta(wrap, account);
    if (!row) continue;
    const current = byHex.get(row.currency) || { currency: row.currency, amm: row.amm, delta: 0 };
    current.delta += row.delta;
    current.amm = current.amm || row.amm;
    byHex.set(row.currency, current);
  }
  return [...byHex.values()].filter((row) => Number.isFinite(row.delta) && Math.abs(row.delta) > 1e-8);
}

function pairFromLpEvent(tx, event) {
  if (tx?.TransactionType === "AMMCreate") {
    return pairFromVoteAssets(amountAsIssue(tx.Amount), amountAsIssue(tx.Amount2));
  }
  if (tx?.Asset || tx?.Asset2) return pairFromVoteAssets(tx.Asset, tx.Asset2);
  return pairFromRow({
    amm_account: event.amm,
    lp_currency: event.currency,
  });
}

export function lpHistoryFromAccountTx(transactions, address, extra = {}) {
  const resolvePair = typeof extra.resolvePair === "function" ? extra.resolvePair : pairFromLpEvent;
  const out = [];
  for (const row of Array.isArray(transactions) ? transactions : []) {
    const { tx, meta, hash, timestamp } = unwrapAccountTx(row);
    const result = meta.TransactionResult || row.TransactionResult || "";
    if (result && result !== "tesSUCCESS") continue;
    const events = lpBalanceEventsFromMeta(meta, address || tx?.Account);
    for (const event of events) {
      const pair = resolvePair(tx, event) || pairFromLpEvent(tx, event);
      const side =
        event.delta < 0 ? "removeLp" : tx?.TransactionType === "AMMCreate" ? "createPool" : "addLp";
      out.push({
        account: address || tx?.Account || null,
        side,
        pair,
        pool: pair,
        lp: Math.abs(event.delta),
        amm: event.amm || null,
        lpCurrency: event.currency,
        timestamp: timestamp || new Date().toISOString(),
        txid: hash,
        status: "filled",
        kind: tx?.TransactionType || "lp",
      });
    }
  }
  return out.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

export function lpTokensFromAmmTx(tx, meta, address) {
  const credited = lpDeltaFromMeta(meta, address || tx?.Account);
  if (credited > 0) return credited;
  const requested = Number(tx?.LPTokenOut?.value ?? tx?.LPTokenIn?.value ?? tx?.lp);
  return Number.isFinite(requested) && requested > 0 ? requested : 0;
}

export function unwrapAccountTx(row = {}) {
  const tx = row.tx || row.tx_json || row;
  const meta = row.meta || row.metaData || tx.meta || {};
  const hash = String(row.hash || tx.hash || "").toUpperCase() || null;
  const timestamp =
    row.close_time_iso ||
    rippleIso(row.date ?? tx.date, row.timestamp) ||
    null;
  return { tx, meta, hash, timestamp, validated: row.validated !== false };
}

export function activityFromPaymentTx(row, address) {
  const { tx, meta, hash, timestamp } = unwrapAccountTx(row);
  if (tx?.TransactionType !== "Payment") return null;
  if (address && tx.Account && !sameWallet(tx.Account, address)) return null;
  const result = meta.TransactionResult || row.TransactionResult || "";
  if (result && result !== "tesSUCCESS") return null;
  const order = orderFromPayment(tx, {
    account: tx.Account || address,
    txid: hash,
    timestamp,
  });
  if (!order) return null;
  return {
    account: order.account,
    side: order.side === "ask" ? "sell" : "buy",
    pair: order.pair,
    pool: order.pair,
    xio: order.amount,
    price: order.price,
    timestamp: timestamp || new Date().toISOString(),
    txid: hash,
    status: "filled",
  };
}

export function isTrustSetRemove(limitAmount) {
  const limit = limitAmount && typeof limitAmount === "object" ? limitAmount : {};
  const raw = limit.value ?? limit.Value;
  if (raw == null || raw === "") return false;
  const n = Number(raw);
  return Number.isFinite(n) && n === 0;
}

export function activityFromTrustSetTx(row, address) {
  const { tx, meta, hash, timestamp } = unwrapAccountTx(row);
  if (tx?.TransactionType !== "TrustSet") return null;
  if (address && tx.Account && !sameWallet(tx.Account, address)) return null;
  const result = meta.TransactionResult || row.TransactionResult || "";
  if (result && result !== "tesSUCCESS") return null;
  const limit = tx.LimitAmount || {};
  const removed = isTrustSetRemove(limit);
  const pair = displayTrustlinePair({
    currency: limit.currency,
    issuer: limit.issuer,
  });
  const currency = pair === "XIO" ? "XIO" : pair.includes("/") ? pair.split("/")[1] : printableTicker(currencyCode(limit.currency));
  if (!pair && !currency) return null;
  if (currency === "XRP") return null;
  return {
    account: tx.Account || address,
    side: removed ? "removeTrustline" : "trustline",
    kind: "trustline",
    removed,
    pair: pair || (currency === "XIO" ? "XIO" : `XIO/${currency}`),
    currency: currency || pair,
    issuer: limit.issuer || null,
    timestamp: timestamp || new Date().toISOString(),
    txid: hash,
    status: "filled",
  };
}

export function activityFromOfferTx(row, address) {
  const { tx, meta, hash, timestamp } = unwrapAccountTx(row);
  if (tx?.TransactionType !== "OfferCreate") return null;
  if (address && tx.Account && !sameWallet(tx.Account, address)) return null;
  const result = meta.TransactionResult || row.TransactionResult || "";
  if (result && result !== "tesSUCCESS") return null;
  const order = orderFromTxjson(tx, {
    account: tx.Account || address,
    txid: hash,
    timestamp,
  });
  if (!order) return null;
  const resting = offerStillOnLedger(meta, tx.Account || address);
  return {
    account: order.account,
    side: order.side === "ask" ? "sell" : "buy",
    pair: order.pair,
    pool: order.pair,
    xio: order.amount,
    price: order.price,
    timestamp: timestamp || new Date().toISOString(),
    txid: hash,
    status: resting ? "open" : "filled",
  };
}

export function ordersFromAccountOffers(offers, address) {
  return (Array.isArray(offers) ? offers : [])
    .map((row) => orderFromOffer(row, address))
    .filter(Boolean)
    .filter((row) => !address || sameWallet(row.account, address));
}

export function activityFromAmmCreateTx(row, address) {
  const { tx, meta, hash, timestamp } = unwrapAccountTx(row);
  if (tx?.TransactionType !== "AMMCreate") return null;
  if (address && tx.Account && !sameWallet(tx.Account, address)) return null;
  const result = meta.TransactionResult || row.TransactionResult || "";
  if (result && result !== "tesSUCCESS") return null;
  const pair = pairFromVoteAssets(amountAsIssue(tx.Amount), amountAsIssue(tx.Amount2));
  const lp = lpTokensFromAmmTx(tx, meta, address);
  return {
    account: tx.Account || address,
    side: "createPool",
    pair,
    pool: pair,
    lp: lp > 0 ? lp : null,
    timestamp: timestamp || new Date().toISOString(),
    txid: hash,
    status: "filled",
  };
}

export function activityFromAmmLpTx(row, address) {
  const { tx, meta, hash, timestamp } = unwrapAccountTx(row);
  if (tx?.TransactionType !== "AMMDeposit" && tx?.TransactionType !== "AMMWithdraw") return null;
  if (address && tx.Account && !sameWallet(tx.Account, address)) return null;
  const result = meta.TransactionResult || row.TransactionResult || "";
  if (result && result !== "tesSUCCESS") return null;
  const pair = pairFromVoteAssets(tx.Asset, tx.Asset2);
  const lp = lpTokensFromAmmTx(tx, meta, address);
  return {
    account: tx.Account || address,
    side: tx.TransactionType === "AMMDeposit" ? "addLp" : "removeLp",
    pair,
    pool: pair,
    lp: lp > 0 ? lp : null,
    timestamp: timestamp || new Date().toISOString(),
    txid: hash,
    status: "filled",
  };
}

export function activityFromAccountTx(transactions, address) {
  return (Array.isArray(transactions) ? transactions : [])
    .map(
      (row) =>
        activityFromOfferTx(row, address) ||
        activityFromPaymentTx(row, address) ||
        activityFromAmmVoteTx(row, address) ||
        activityFromAmmCreateTx(row, address) ||
        activityFromAmmLpTx(row, address) ||
        activityFromTrustSetTx(row, address)
    )
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

function orderKey(row) {
  return [
    String(row.account || "").toLowerCase(),
    row.pair || "",
    row.side || "",
    Number(row.price || 0).toPrecision(8),
    row.seq || row.txid || "",
  ].join(":");
}

function activityKey(row) {
  if (row.txid) return String(row.txid).toUpperCase();
  return [
    String(row.account || "").toLowerCase(),
    row.side || "",
    Number(row.xio || 0).toPrecision(8),
    Number(row.price || 0).toPrecision(8),
    row.timestamp || "",
  ].join(":");
}

export function mergeWalletOrders(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      if (!(Number(row?.price) > 0) || !(Number(row?.amount) > 0)) continue;
      const key = orderKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

export function mergeWalletActivity(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      if (!row) continue;
      const key = activityKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out.sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
}

export function isImmediateOrCancel(txjson) {
  return Boolean(Number(txjson?.Flags || 0) & TF_IMMEDIATE_OR_CANCEL);
}

const pendingByWallet = new Map();

export function rememberPending(address, pending) {
  const key = String(address || "").trim().toLowerCase();
  if (!key || !pending) return;
  const current = pendingByWallet.get(key) || { orders: [], activity: [], at: 0 };
  pendingByWallet.set(key, {
    orders: mergeWalletOrders(pending.order ? [pending.order] : [], current.orders),
    activity: mergeWalletActivity(pending.activity ? [pending.activity] : [], current.activity),
    at: Date.now(),
  });
}

export function pendingFor(address, { offersKnown = false } = {}) {
  const key = String(address || "").trim().toLowerCase();
  const hit = pendingByWallet.get(key);
  if (!hit) return { orders: [], activity: [] };
  const age = Date.now() - hit.at;
  if (age > 45_000) {
    pendingByWallet.delete(key);
    return { orders: [], activity: [] };
  }
  if (offersKnown && age > 10_000) {
    return { orders: [], activity: hit.activity };
  }
  return hit;
}

export function pendingFromExecution(detail = {}, address = "") {
  const txjson = detail.txjson || detail.tx || null;
  const account = address || txjson?.Account || detail.account || null;
  const signMarker = detail.signMarker || null;
  const type = String(txjson?.TransactionType || "");
  if (type === "TrustSet" && account) {
    const limit = txjson.LimitAmount || {};
    const currency = currencyCode(limit.currency);
    if (!currency || currency === "XRP") return null;
    const removed = isTrustSetRemove(limit);
    return {
      order: null,
      activity: {
        account,
        side: removed ? "removeTrustline" : "trustline",
        kind: "trustline",
        removed,
        pair: currency === "XIO" ? "XIO" : `XIO/${currency}`,
        currency,
        issuer: limit.issuer || null,
        timestamp: detail.timestamp || new Date().toISOString(),
        txid: detail.txid || null,
        status: "filled",
        signMarker,
      },
    };
  }
  if ((type === "AMMDeposit" || type === "AMMWithdraw" || type === "AMMCreate") && account) {
    const pair =
      type === "AMMCreate"
        ? pairFromVoteAssets(amountAsIssue(txjson.Amount), amountAsIssue(txjson.Amount2))
        : pairFromVoteAssets(txjson.Asset, txjson.Asset2);
    const side = type === "AMMCreate" ? "createPool" : type === "AMMDeposit" ? "addLp" : "removeLp";
    const lp = Number(
      txjson.LPTokenOut?.value ?? txjson.LPTokenIn?.value ?? txjson.lp ?? detail.lpReceived ?? detail.lp
    );
    return {
      order: null,
      activity: {
        account,
        side,
        pair,
        pool: pair,
        lp: Number.isFinite(lp) && lp > 0 ? lp : null,
        xio: Number(txjson.Amount?.value) || null,
        timestamp: detail.timestamp || new Date().toISOString(),
        txid: detail.txid || null,
        status: "filled",
        signMarker,
      },
    };
  }
  const order = orderFromTxjson(txjson, {
    account,
    txid: detail.txid,
    timestamp: detail.timestamp || new Date().toISOString(),
  });
  if (!order || !account) return null;
  const activity = {
    account,
    side: order.side === "ask" ? "sell" : "buy",
    pair: order.pair,
    pool: order.pair,
    xio: order.amount,
    price: order.price,
    timestamp: order.timestamp || new Date().toISOString(),
    txid: detail.txid || null,
    status: isMarketSwap(txjson) ? "filled" : "open",
    signMarker,
  };
  return {
    order: isMarketSwap(txjson) ? null : order,
    activity,
  };
}
