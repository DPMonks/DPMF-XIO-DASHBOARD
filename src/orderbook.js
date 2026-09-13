import {ammImpliedLevels, ammSpot, measureAmmAgainstDex} from "./ammCurve.js";

export const ORDERBOOK_PAIRS = ["XIO/XRP", "XIO/RLUSD"];
export const FEATURED_ORDERBOOK_PAIRS = [
  "XIO/XRP",
  "XIO/RLUSD",
  "XIO/XDX",
  "XIO/XSQUAD",
];
export const ORDERBOOK_VISIBLE_LEVELS = 20;

export function combineOrderbookSide(dexRows, ammRows, side = "bid") {
  const dex = Array.isArray(dexRows) ? dexRows : [];
  const amm = Array.isArray(ammRows) ? ammRows : [];
  const rows = [
    ...dex.map((row) => ({ ...row, source: row.source || "dex" })),
    ...amm.map((row) => ({ ...row, source: row.source || "amm" })),
  ].filter((row) => Number.isFinite(Number(row?.price)));
  const ask = String(side).toLowerCase() === "ask";
  rows.sort((a, b) => {
    const delta = Number(a.price) - Number(b.price);
    return ask ? delta : -delta;
  });
  return rows;
}

export function padOrderbookLevels(rows, count = ORDERBOOK_VISIBLE_LEVELS) {
  const list = (Array.isArray(rows) ? rows.filter(Boolean) : []).slice(0, count);
  if (list.length >= count) return list;
  const blanks = Array.from({ length: count - list.length }, () => ({
    price: null,
    base_size: null,
    quote_size: null,
    placeholder: true,
  }));
  return list.concat(blanks);
}

function isSyntheticSource(source) {
  const name = String(source || "").toLowerCase();
  return name === "amm" || name === "bridge";
}

export function topDexLevels(rows, side = "bid", limit = ORDERBOOK_VISIBLE_LEVELS) {
  const ask = String(side).toLowerCase() === "ask";
  return [...(Array.isArray(rows) ? rows : [])]
    .filter(
      (row) =>
        Number(row?.price) > 0 &&
        Number(row?.base_size) > 0 &&
        !isSyntheticSource(row.source)
    )
    .sort((a, b) => {
      const delta = Number(a.price) - Number(b.price);
      return ask ? delta : -delta;
    })
    .slice(0, limit);
}

export function normalizeOrderbookPair(value) {
  const trimmed = String(value || "XIO/XRP").trim();
  const spaced = trimmed.replace(/\s*\/\s*/g, "/").replace(/-/g, "/");
  const upper = spaced.toUpperCase();
  // Liquid non-XIO watch pair from the indexer (book/amm/pairs).
  if (upper === "XRP/RLUSD" || upper === "RLUSD/XRP") return "XRP/RLUSD";
  if (upper === "RLUSD" || upper === "XIO/RLUSD") return "XIO/RLUSD";
  if (upper === "XRP" || upper === "XIO/XRP" || upper === "XRP/XIO") return "XIO/XRP";
  if (upper === "XIO" || upper === "XIO/XDX") return "XIO/XDX";
  if (upper === "XSQUAD" || upper === "XIO/XSQUAD") return "XIO/XSQUAD";
  if (upper.startsWith("XIO/")) {
    const quote = spaced.slice(spaced.indexOf("/") + 1).trim();
    return quote ? `XIO/${quote}` : "XIO/XRP";
  }
  if (spaced && !spaced.includes("/")) return `XIO/${spaced}`;
  return "XIO/XRP";
}

export function sortOrderbookPairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const name of [...FEATURED_ORDERBOOK_PAIRS, ...(pairs || [])]) {
    const pair = normalizeOrderbookPair(name);
    if (seen.has(pair.toUpperCase())) continue;
    seen.add(pair.toUpperCase());
    out.push(pair);
  }
  return out;
}

export function collectPairOptions(pairs = []) {
  return sortOrderbookPairs(pairs);
}

export function sameOrderbookPair(rowPair, selected) {
  if (!selected || selected === "all") return true;
  return normalizeOrderbookPair(rowPair) === normalizeOrderbookPair(selected);
}

export function filterOrderbookPairs(pairs, query) {
  const q = String(query || "")
    .trim()
    .replace(/^XIO\s*\/\s*/i, "")
    .toUpperCase();
  if (!q) return pairs || [];
  return (pairs || []).filter((pair) => {
    const name = normalizeOrderbookPair(pair);
    const quote = name.split("/")[1] || "";
    return name.toUpperCase().includes(q) || quote.toUpperCase().includes(q);
  });
}

export function bookFromMarketPayload(payload, pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair);
  if (!payload || typeof payload !== "object") return emptyOrderbook(name);
  if (payload.books && typeof payload.books === "object") {
    const nested =
      payload.books[name] || payload.books[pair] || payload.books[normalizeOrderbookPair(payload.pair || name)];
    if (nested && typeof nested === "object") return nested;
  }
  if (payload.book && typeof payload.book === "object") {
    const inner = payload.book;
    if (inner.books && typeof inner.books === "object") return bookFromMarketPayload(inner, name);
    if (Array.isArray(inner.bids) || Array.isArray(inner.asks)) return inner;
  }
  if (Array.isArray(payload.bids) || Array.isArray(payload.asks)) return payload;
  return emptyOrderbook(name);
}

export function emptyOrderbook(pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair);
  const parts = name.split("/");
  const base = parts[0] || "XIO";
  const quote = parts[1] || "XRP";
  return {
    pair: name,
    base,
    quote,
    price_unit: "quote_per_base",
    as_of: null,
    present: false,
    catching_up: true,
    best_bid: null,
    best_ask: null,
    mid: null,
    spread: null,
    spread_bps: null,
    mid_usd: null,
    bids: [],
    asks: [],
    amm: null,
    depth: { bid_base: 0, ask_base: 0, bid_quote: 0, ask_quote: 0 },
    source: "db",
  };
}

function tapeBest(rows, side) {
  const prices = (Array.isArray(rows) ? rows : [])
    .filter((row) => Number(row?.price) > 0 && !row.placeholder)
    .map((row) => Number(row.price));
  if (!prices.length) return null;
  return side === "ask" ? Math.min(...prices) : Math.max(...prices);
}

export function asLiquidPairBook(raw, pair = "XRP/RLUSD") {
  const name = normalizeOrderbookPair(pair || raw?.pair || "XRP/RLUSD");
  const parts = name.split("/");
  const base = parts[0] || "XRP";
  const quote = parts[1] || "RLUSD";
  if (!raw || typeof raw !== "object") return emptyOrderbook(name);

  const mapSide = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const price = Number(row?.price);
        const base_size = Number(row?.base_size ?? row?.base ?? row?.size);
        const quote_size = Number(row?.quote_size ?? row?.quote);
        if (!(price > 0)) return null;
        return {
          price,
          base_size: base_size > 0 ? base_size : null,
          quote_size: quote_size > 0 ? quote_size : null,
          source: row.source || "dex",
          account: row.account || row.Account || null,
          side: String(row.side || "").toLowerCase() === "ask" ? "ask" : "bid",
        };
      })
      .filter(Boolean);

  const bids = mapSide(raw.bids);
  const asks = mapSide(raw.asks);
  const header = bookHeader({
    bids,
    asks,
    best_bid: raw.bid ?? raw.best_bid,
    best_ask: raw.ask ?? raw.best_ask,
    mid: raw.mid,
    spread: raw.spread,
    spread_bps: raw.spread_bps,
    amm: raw.amm,
  });
  const ammPrice = Number(raw.amm?.price ?? raw.amm_price ?? raw.price);
  const reserveBase = Number(raw.amm?.reserve_asset ?? raw.amountA ?? raw.amm_amount_a);
  const reserveQuote = Number(raw.amm?.reserve_currency ?? raw.amountB ?? raw.amm_amount_b);
  const amm =
    raw.amm && typeof raw.amm === "object"
      ? raw.amm
      : ammPrice > 0
        ? {
            price: ammPrice,
            reserve_asset: reserveBase > 0 ? reserveBase : null,
            reserve_currency: reserveQuote > 0 ? reserveQuote : null,
            account: raw.amm_account || raw.account || null,
          }
        : null;

  return {
    ...emptyOrderbook(name),
    pair: name,
    base,
    quote,
    present: Boolean(bids.length || asks.length || header.mid > 0 || ammPrice > 0),
    catching_up: false,
    best_bid: header.best_bid,
    best_ask: header.best_ask,
    mid: header.mid,
    spread: header.spread,
    spread_bps: header.spread_bps,
    mid_usd: Number(raw.mid_usd) > 0 ? Number(raw.mid_usd) : header.mid,
    bids,
    asks,
    amm,
    depth: {
      bid_base: Number(raw.bid_depth_base) || 0,
      ask_base: Number(raw.ask_depth_base) || 0,
      bid_quote: Number(raw.bid_depth_quote) || 0,
      ask_quote: Number(raw.ask_depth_quote) || 0,
    },
    source: raw.source || "indexer",
    as_of: raw.timestamp || raw.updated_at || raw.as_of || null,
  };
}

export function bookHeader(book = {}) {
  const best_bid = Number(book.best_bid) > 0 ? Number(book.best_bid) : tapeBest(book.bids, "bid");
  const best_ask = Number(book.best_ask) > 0 ? Number(book.best_ask) : tapeBest(book.asks, "ask");
  const mid =
    Number(book.mid) > 0
      ? Number(book.mid)
      : best_bid > 0 && best_ask > 0
        ? (best_bid + best_ask) / 2
        : best_bid || best_ask || (Number(book.amm?.price) > 0 ? Number(book.amm.price) : null);
  const mid_usd = Number(book.mid_usd) > 0 ? Number(book.mid_usd) : null;
  const spread =
    best_bid > 0 && best_ask > 0 ? best_ask - best_bid : Number(book.spread) > 0 ? Number(book.spread) : null;
  const spread_bps =
    mid > 0 && spread > 0
      ? Math.round((spread / mid) * 1_000_000) / 100
      : Number(book.spread_bps) > 0
        ? Number(book.spread_bps)
        : null;
  return { best_bid, best_ask, mid, mid_usd, spread, spread_bps };
}

export function filterBookTape(book = {}, mode = "hybrid") {
  const tape = String(mode || "hybrid").toLowerCase();
  const keep = (row) => {
    const source = String(row?.source || "dex").toLowerCase();
    if (tape === "amm") return source === "amm";
    if (tape === "dex" || tape === "book") return source === "dex" || source === "bridge";
    return true;
  };
  const bids = (Array.isArray(book.bids) ? book.bids : []).filter(keep);
  const asks = (Array.isArray(book.asks) ? book.asks : []).filter(keep);
  const next = { ...book, bids, asks };
  const header = bookHeader({ ...next, best_bid: null, best_ask: null, mid: null, spread: null, spread_bps: null });
  return { ...next, ...header };
}

export function orderBookRowStamp(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return row.as_of || payload.as_of || row.timestamp || row.updated_at || null;
}

function issuedAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || typeof value === "string") {
    const raw = String(value);
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    const drops = /^\d+$/.test(raw);
    return {
      currency: "XRP",
      value: drops ? num / 1_000_000 : num,
    };
  }
  if (typeof value === "object") {
    const num = Number(value.value ?? value.amount);
    if (!Number.isFinite(num) || num <= 0) return null;
    return {
      currency: String(value.currency || value.currencyCode || "").toUpperCase(),
      issuer: value.issuer || null,
      value: num,
    };
  }
  return null;
}

function isXioAmount(amount) {
  const currency = String(amount?.currency || "").toUpperCase();
  return currency === "XIO" || currency.startsWith("584458");
}

export function offerToDexRow(row) {
  if (!row || typeof row !== "object" || row.placeholder) return null;
  if (isSyntheticSource(row.source)) return null;

  const directPrice = Number(row.price ?? row.quality_price);
  const directSize = Number(row.base_size ?? row.amount ?? row.size);
  const account = row.Account || row.account || null;
  if (directPrice > 0 && directSize > 0 && row.TakerGets == null && row.taker_gets == null) {
    return {
      price: directPrice,
      base_size: directSize,
      source: "dex",
      side: String(row.side || "").toLowerCase() === "ask" ? "ask" : "bid",
      account,
    };
  }

  const gets = issuedAmount(row.TakerGets ?? row.taker_gets);
  const pays = issuedAmount(row.TakerPays ?? row.taker_pays);
  const fundedGets = issuedAmount(row.taker_gets_funded ?? row.TakerGetsFunded);
  const fundedPays = issuedAmount(row.taker_pays_funded ?? row.TakerPaysFunded);
  if (gets && pays) {
    if (isXioAmount(gets)) {
      return {
        price: pays.value / gets.value,
        base_size: fundedGets && isXioAmount(fundedGets) ? fundedGets.value : gets.value,
        source: "dex",
        side: "ask",
        account,
      };
    }
    if (isXioAmount(pays)) {
      return {
        price: gets.value / pays.value,
        base_size: fundedPays && isXioAmount(fundedPays) ? fundedPays.value : pays.value,
        source: "dex",
        side: "bid",
        account,
      };
    }
  }
  return null;
}

function unwrapJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function asOfferList(value) {
  const node = unwrapJson(value);
  if (!node) return [];
  if (Array.isArray(node)) return node.filter((row) => row && typeof row === "object");
  if (typeof node !== "object") return [];
  if (Array.isArray(node.offers)) return node.offers;
  if (node.result) {
    const inner = asOfferList(node.result);
    if (inner.length) return inner;
  }
  if (Array.isArray(node.book)) return node.book;
  if (Array.isArray(node.rows)) return node.rows;
  const keys = Object.keys(node);
  if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
    return keys
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => node[key])
      .filter((row) => row && typeof row === "object");
  }
  return [];
}

function sideHintFromKey(key, fallback) {
  const name = String(key || "").toLowerCase();
  if (/(ask|sell)/.test(name)) return "ask";
  if (/(bid|buy)/.test(name)) return "bid";
  return fallback;
}

function pushDexRow(row, hint, bids, asks, seen) {
  if (!row || typeof row !== "object" || row.placeholder) return;
  if (isSyntheticSource(row.source)) return;
  const next = offerToDexRow({ ...row, side: row.side || hint || undefined });
  if (!next) return;
  const key = `${next.side}:${next.price}:${next.base_size}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (next.side === "ask") asks.push({ ...next, side: "ask" });
  else bids.push({ ...next, side: "bid" });
}

function walkDexOffers(node, bids, asks, seen, hint, depth = 0) {
  const value = unwrapJson(node);
  if (!value || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) walkDexOffers(item, bids, asks, seen, hint, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  if (isSyntheticSource(value.source)) return;
  if (value.TakerGets != null || value.taker_gets != null) {
    pushDexRow(value, hint, bids, asks, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "amm") continue;
    walkDexOffers(child, bids, asks, seen, sideHintFromKey(key, hint), depth + 1);
  }
}

export function extractDexSides(body = {}) {
  const parsed = unwrapJson(body);
  const root = parsed && typeof parsed === "object" ? parsed : {};
  const bids = [];
  const asks = [];
  const seen = new Set();
  const books = [
    root,
    root.book,
    root.dex,
    root.native,
    root.clob,
    root.orderbook,
    root.order_book,
    root.book_offers,
    root.bookOffers,
    root.payload,
    root.data,
    root.result,
    root.offers && typeof root.offers === "object" && !Array.isArray(root.offers) ? root.offers : null,
  ].filter((node) => node && typeof node === "object" && !Array.isArray(node));

  for (const book of books) {
    for (const key of ["bids", "buy", "buys", "bid", "native_bids", "dex_bids", "bid_book", "bids_book"]) {
      for (const row of asOfferList(book[key])) pushDexRow(row, "bid", bids, asks, seen);
    }
    for (const key of ["asks", "sell", "sells", "ask", "native_asks", "dex_asks", "ask_book", "asks_book"]) {
      for (const row of asOfferList(book[key])) pushDexRow(row, "ask", bids, asks, seen);
    }
    for (const row of asOfferList(book.offers)) pushDexRow(row, null, bids, asks, seen);
  }

  walkDexOffers(root, bids, asks, seen, null);
  return { bids, asks };
}

export function payloadHasNativeDex(raw, pair = "XIO/XRP") {
  const body = asOrderbookPayload(raw, pair);
  const extracted = extractDexSides(body);
  const bids = nativeDexRows(extracted.bids.length ? extracted.bids : body.bids);
  const asks = nativeDexRows(extracted.asks.length ? extracted.asks : body.asks);
  return bids.length > 0 || asks.length > 0;
}

export function pickNativeBookRow(latest, historyRows = [], pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair);
  const candidates = [latest, ...(Array.isArray(historyRows) ? historyRows : [])].filter(Boolean);
  for (const row of candidates) {
    const payload = row.payload != null ? row.payload : row;
    if (payloadHasNativeDex(payload, name)) {
      return {
        payload,
        pair: name,
        as_of: orderBookRowStamp(row),
      };
    }
  }
  return null;
}

function isNativeDexRow(row) {
  if (!row || row.placeholder) return false;
  if (!(Number(row.price) > 0) || !(Number(row.base_size) > 0)) return false;
  return !isSyntheticSource(row.source || "dex");
}

export function bookHasNativeDex(book) {
  if (!book || typeof book !== "object") return false;
  if (book.dex_present) return true;
  const bids = Array.isArray(book.bids) ? book.bids : [];
  const asks = Array.isArray(book.asks) ? book.asks : [];
  return bids.some(isNativeDexRow) || asks.some(isNativeDexRow);
}

function tapeRowFilled(row) {
  return Boolean(row) && !row.placeholder && Number(row.price) > 0 && Number(row.base_size) > 0;
}

export function bookHasTape(book) {
  if (!book || typeof book !== "object") return false;
  const bids = Array.isArray(book.bids) ? book.bids : [];
  const asks = Array.isArray(book.asks) ? book.asks : [];
  return bids.some(tapeRowFilled) || asks.some(tapeRowFilled);
}

export function keepLastGoodBook(previous, next, pair = "XIO/XRP") {
  const name = normalizeOrderbookPair(pair || next?.pair || previous?.pair);
  if (bookHasNativeDex(next)) return next;
  if (bookHasNativeDex(previous)) {
    return {
      ...previous,
      pair: name,
      catching_up: true,
      stale: true,
    };
  }
  if (bookHasTape(next)) return next;
  if (bookHasTape(previous)) {
    return {
      ...previous,
      pair: name,
      catching_up: true,
      stale: true,
    };
  }
  return next || previous || emptyOrderbook(name);
}

export function mergeOrderbookPayloads(previous, next) {
  if (!previous?.books) return next;
  if (!next?.books) return previous;
  const books = { ...previous.books };
  for (const [pair, book] of Object.entries(next.books)) {
    books[pair] = keepLastGoodBook(previous.books[pair], book, pair);
  }
  return { ...next, books };
}

export function nativeDexRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => offerToDexRow(row) || (
      row &&
      Number(row.price) > 0 &&
      Number(row.base_size) > 0 &&
      isNativeDexRow({ ...row, source: row.source || "dex" })
        ? { ...row, source: "dex" }
        : null
    ))
    .filter(Boolean)
    .map((row, index) => ({
      ...row,
      level: row.level ?? index + 1,
      price: Number(row.price),
      base_size: Number(row.base_size),
      source: "dex",
    }));
}

function withCumulative(rows, side) {
  const ask = String(side).toLowerCase() === "ask";
  const sorted = [...rows].sort((a, b) => {
    const delta = Number(a.price) - Number(b.price);
    return ask ? delta : -delta;
  });
  let cumulative = 0;
  return sorted.map((row, index) => {
    cumulative += Number(row.base_size) || 0;
    return { ...row, level: row.level ?? index + 1, cumulative_base: cumulative };
  });
}

function takeSideLevels(rows, side, limit = ORDERBOOK_VISIBLE_LEVELS) {
  const ask = String(side).toLowerCase() === "ask";
  return [...(Array.isArray(rows) ? rows : [])]
    .filter((row) => Number(row?.price) > 0 && Number(row?.base_size) > 0)
    .sort((a, b) => {
      const delta = Number(a.price) - Number(b.price);
      return ask ? delta : -delta;
    })
    .slice(0, limit);
}

function priceKey(row) {
  return Number(row?.price).toPrecision(12);
}

function extractBridgeSides(body = {}) {
  const root = body && typeof body === "object" ? body : {};
  const book = root.book && typeof root.book === "object" ? root.book : root;
  const keep = (row) => String(row?.source || "").toLowerCase() === "bridge";
  return {
    bids: (Array.isArray(book.bids) ? book.bids : []).filter(keep),
    asks: (Array.isArray(book.asks) ? book.asks : []).filter(keep),
  };
}

function mergeDexTape(nativeRows, bridgeRows, reserveMeta, side) {
  const native = takeSideLevels(nativeRows, side, ORDERBOOK_VISIBLE_LEVELS);
  const seen = new Set(native.map(priceKey));
  const bridged = takeSideLevels(bridgeRows, side, ORDERBOOK_VISIBLE_LEVELS).filter(
    (row) => !seen.has(priceKey(row))
  );
  const merged = [
    ...native,
    ...bridged.slice(0, Math.max(0, ORDERBOOK_VISIBLE_LEVELS - native.length)),
  ];
  return withCumulative(measureAmmAgainstDex(takeSideLevels(merged, side, merged.length), reserveMeta, side), side);
}

function ammTape(impliedRows, side) {
  const rows = takeSideLevels(impliedRows, side, ORDERBOOK_VISIBLE_LEVELS).map((row) => ({
    ...row,
    source: row.source || "amm",
  }));
  return withCumulative(rows, side);
}

export function quotePerXrpFromSpots(quoteSpot, xrpSpot) {
  const quote = Number(quoteSpot);
  const xrp = Number(xrpSpot);
  if (!Number.isFinite(quote) || !Number.isFinite(xrp) || quote <= 0 || xrp <= 0) return 0;
  return quote / xrp;
}

export function projectDexThroughXrp(xrpBook, quotePerXrp) {
  const scale = Number(quotePerXrp);
  if (!Number.isFinite(scale) || scale <= 0 || !xrpBook) {
    return { bids: [], asks: [] };
  }
  const mapSide = (rows, side) =>
    nativeDexRows(rows)
      .map((row) => {
        const price = Number(row.price) * scale;
        const baseSize = Number(row.base_size ?? row.amount);
        if (!(price > 0) || !(baseSize > 0)) return null;
        return {
          price,
          base_size: baseSize,
          quote_size: baseSize * price,
          source: "bridge",
          side: row.side || side,
        };
      })
      .filter(Boolean);
  return {
    bids: mapSide(xrpBook.bids, "bid"),
    asks: mapSide(xrpBook.asks, "ask"),
  };
}

export function composeAmmBook(stored, reserves = {}, pair = "XIO/XRP", extras = {}) {
  const name = normalizeOrderbookPair(stored?.pair || pair);
  const base = asOrderbookPayload(stored, name);
  const reserveBase = Number(
    reserves.reserve_asset ?? reserves.reserve_xio ?? base.amm?.reserve_asset ?? 0
  );
  const reserveQuote = Number(
    reserves.reserve_currency ?? reserves.reserve_quote ?? base.amm?.reserve_currency ?? 0
  );
  const tradingFee = Number(reserves.trading_fee ?? base.amm?.trading_fee ?? 1000);
  const spot =
    Number(reserves.price) > 0
      ? Number(reserves.price)
      : ammSpot(reserveBase, reserveQuote) || Number(base.amm?.price) || null;

  const reserveMeta = { reserveBase, reserveQuote, tradingFee };
  const extracted = extractDexSides(base);
  const dexBids = topDexLevels(
    nativeDexRows(extracted.bids.length ? extracted.bids : base.bids),
    "bid"
  );
  const dexAsks = topDexLevels(
    nativeDexRows(extracted.asks.length ? extracted.asks : base.asks),
    "ask"
  );
  const dexPresent = dexBids.length > 0 || dexAsks.length > 0;

  const implied =
    reserveBase > 0 && reserveQuote > 0
      ? ammImpliedLevels({
          reserveBase,
          reserveQuote,
          tradingFee,
          steps: ORDERBOOK_VISIBLE_LEVELS,
        })
      : { bids: [], asks: [] };

  const xrpSpot =
    Number(extras.xrpSpot) ||
    Number(extras.xrpBook?.amm?.price) ||
    Number(extras.xrpBook?.mid) ||
    0;
  const quotePerXrp =
    Number(extras.quotePerXrp) || quotePerXrpFromSpots(spot, xrpSpot);
  const fromStored = extractBridgeSides(stored);
  const fromBase = extractBridgeSides(base);
  const storedBridge =
    fromStored.bids.length || fromStored.asks.length ? fromStored : fromBase;
  const bridged =
    extras.bridgeBook ||
    (name !== "XIO/XRP"
      ? extras.xrpBook
        ? projectDexThroughXrp(extras.xrpBook, quotePerXrp)
        : storedBridge
      : { bids: [], asks: [] });

  const dexBidTape = mergeDexTape(dexBids, bridged.bids || [], reserveMeta, "bid");
  const dexAskTape = mergeDexTape(dexAsks, bridged.asks || [], reserveMeta, "ask");
  const ammBidTape = ammTape(implied.bids, "bid");
  const ammAskTape = ammTape(implied.asks, "ask");
  const bids = [...dexBidTape, ...ammBidTape];
  const asks = [...dexAskTape, ...ammAskTape];
  const filled =
    ammBidTape.length > 0 ||
    ammAskTape.length > 0 ||
    dexBidTape.some((row) => row.source === "bridge") ||
    dexAskTape.some((row) => row.source === "bridge");
  const present = bids.length > 0 || asks.length > 0;
  const best_bid = tapeBest(bids, "bid");
  const best_ask = tapeBest(asks, "ask");
  const mid =
    best_bid > 0 && best_ask > 0
      ? (best_bid + best_ask) / 2
      : spot || best_bid || best_ask || null;

  return {
    ...base,
    pair: name,
    quote: base.quote || name.split("/")[1] || "XRP",
    bids,
    asks,
    present,
    catching_up: !present,
    dex_present: dexPresent,
    amm_implied: filled,
    best_bid,
    best_ask,
    mid,
    amm: {
      ...(base.amm || {}),
      reserve_asset: reserveBase || null,
      reserve_currency: reserveQuote || null,
      trading_fee: tradingFee,
      price: spot,
      levels: [],
      source: filled ? "implied" : "opposing",
    },
    mid_usd:
      Number(base.mid_usd) > 0
        ? Number(base.mid_usd)
        : Number(reserves.mid_usd) > 0
          ? Number(reserves.mid_usd)
          : null,
  };
}

export function asOrderbookPayload(raw, pair = "XIO/XRP") {
  let body = raw;
  if (typeof raw === "string") {
    try {
      body = JSON.parse(raw);
    } catch {
      return emptyOrderbook(pair);
    }
  }
  if (!body || typeof body !== "object") return emptyOrderbook(pair);
  const name = normalizeOrderbookPair(body.pair || pair);
  const extracted = extractDexSides(body);
  const bids = extracted.bids.length ? extracted.bids : Array.isArray(body.bids) ? body.bids : [];
  const asks = extracted.asks.length ? extracted.asks : Array.isArray(body.asks) ? body.asks : [];
  const present = body.present !== false && (bids.length > 0 || asks.length > 0);
  return {
    ...emptyOrderbook(name),
    ...body,
    pair: name,
    base: body.base || "XIO",
    quote: body.quote || name.split("/")[1] || "XRP",
    price_unit: body.price_unit || "quote_per_base",
    present,
    catching_up: Boolean(body.catching_up || !present),
    bids,
    asks,
    amm: body.amm && typeof body.amm === "object" ? body.amm : null,
    depth: body.depth || emptyOrderbook(name).depth,
    source: body.source || "db",
  };
}
