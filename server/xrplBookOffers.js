import {RLUSD_HEX, RLUSD_ISSUER, XIO_ISSUER, XDX_ISSUER, XSQUAD_HEX, XSQUAD_ISSUER, asciiCurrencyHex} from "../src/constants/ledger.js";
import {extractDexSides, normalizeOrderbookPair, topDexLevels} from "../src/orderbook.js";

const DEFAULT_RPC = process.env.XRPL_RPC_URL || "https://xrplcluster.com";
const CACHE_MS = 20_000;
const cache = new Map();

export const XIO_SPEC = { currency: "XIO", issuer: XIO_ISSUER };

export function quoteSpecForPair(pair, pool = {}) {
  const name = normalizeOrderbookPair(pair);
  const quote = String(pool.quote || name.split("/")[1] || "XRP").trim();
  const issuer = pool.quote_issuer || pool.quoteIssuer || null;
  const hex = pool.quote_hex || pool.quoteHex || null;
  if (!quote || quote.toUpperCase() === "XRP") return { currency: "XRP" };
  if (quote.toUpperCase() === "RLUSD") {
    return { currency: hex || RLUSD_HEX, issuer: issuer || RLUSD_ISSUER };
  }
  if (quote.toUpperCase() === "XIO") {
    return { currency: quote, issuer: issuer || XDX_ISSUER };
  }
  if (quote.toUpperCase() === "XSQUAD") {
    return { currency: hex || XSQUAD_HEX, issuer: issuer || XSQUAD_ISSUER };
  }
  if (hex && issuer) return { currency: hex, issuer };
  if (issuer && quote.length <= 3) return { currency: quote, issuer };
  if (issuer && quote.length > 3) return { currency: hex || asciiCurrencyHex(quote), issuer };
  return null;
}

export async function xrplRpc(method, params, { fetchImpl = fetch, rpcUrl = DEFAULT_RPC } = {}) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ method, params: [params] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`XRPL RPC ${response.status}`);
  }
  const body = await response.json();
  return body?.result || {};
}

export async function fillNativeBookFromXrpl(pair, pool = {}, options = {}) {
  const name = normalizeOrderbookPair(pair);
  const quote = quoteSpecForPair(name, pool);
  if (!quote) return null;

  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.book;

  try {
    const [asksRes, bidsRes] = await Promise.all([
      xrplRpc("book_offers", { taker_gets: XIO_SPEC, taker_pays: quote, limit: 20 }, options),
      xrplRpc("book_offers", { taker_gets: quote, taker_pays: XIO_SPEC, limit: 20 }, options),
    ]);
    const asks = topDexLevels(extractDexSides({ offers: asksRes.offers || [] }).asks, "ask");
    const bids = topDexLevels(extractDexSides({ offers: bidsRes.offers || [] }).bids, "bid");
    if (!bids.length && !asks.length) {
      return hit?.book || null;
    }
    const book = {
      pair: name,
      bids,
      asks,
      present: true,
      dex_present: true,
      catching_up: false,
      as_of: new Date().toISOString(),
      source: "xrpl",
    };
    cache.set(name, { at: Date.now(), book });
    return book;
  } catch {
    return hit?.book || null;
  }
}
