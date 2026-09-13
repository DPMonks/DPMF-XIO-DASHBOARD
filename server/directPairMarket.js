import {quoteIssue} from "../src/wallet/ammVote.js";
import {reservesFromAmm, splitDirectOffers} from "../src/swap/directPair.js";
import {xrplRpc} from "./xrplBookOffers.js";
import {withXrplRetry} from "./liveAmmReserves.js";

const CACHE_MS = 20_000;
const cache = new Map();

function tickerOf(value) {
  return String(value || "")
    .split(":")[0]
    .toUpperCase();
}

function specFromQuery(side, query = {}) {
  const id = tickerOf(query[side] || query[`${side}Id`] || query[`${side}Ticker`]);
  return quoteIssue({
    id,
    issuer: query[`${side}Issuer`] || query[`${side}_issuer`],
    hex: query[`${side}Hex`] || query[`${side}_hex`],
  });
}

function emptyMarket(fromId, toId) {
  return {
    pair: `${fromId}/${toId}`,
    from: fromId,
    to: toId,
    bids: [],
    asks: [],
    reserveBase: 0,
    reserveQuote: 0,
    tradingFee: 1000,
    present: false,
    source: "xrpl",
  };
}

export async function loadDirectPairMarket(query = {}, options = {}) {
  const fromId = tickerOf(query.from || query.fromId);
  const toId = tickerOf(query.to || query.toId);
  if (!fromId || !toId || fromId === toId) return emptyMarket(fromId || "XRP", toId || "RLUSD");

  const fromSpec = specFromQuery("from", { ...query, from: fromId });
  const toSpec = specFromQuery("to", { ...query, to: toId });
  const key = [
    fromId,
    fromSpec.currency,
    fromSpec.issuer || "",
    toId,
    toSpec.currency,
    toSpec.issuer || "",
  ].join("|");
  const now = Number(options.now) || Date.now();
  if (!query.fresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.body;
  }

  const rpc = { fetchImpl: options.fetchImpl, rpcUrl: options.rpcUrl };
  const retry = { retries: 2, waitMs: 220 };
  let ammRes;
  let bidOffers = [];
  let askOffers = [];
  try {
    const [nextAmm, bidRes, askRes] = await Promise.all([
      withXrplRetry(() => xrplRpc("amm_info", { asset: fromSpec, asset2: toSpec, ledger_index: "validated" }, rpc), retry).catch(
        () => null
      ),
      withXrplRetry(() => xrplRpc("book_offers", { taker_gets: toSpec, taker_pays: fromSpec, limit: 20 }, rpc), retry).catch(
        () => null
      ),
      withXrplRetry(() => xrplRpc("book_offers", { taker_gets: fromSpec, taker_pays: toSpec, limit: 20 }, rpc), retry).catch(
        () => null
      ),
    ]);
    ammRes = nextAmm?.amm || nextAmm || null;
    bidOffers = bidRes?.offers || [];
    askOffers = askRes?.offers || [];
  } catch {
    ammRes = null;
  }

  const book = splitDirectOffers([...bidOffers, ...askOffers], fromSpec, toSpec);
  const reserves = reservesFromAmm(ammRes, fromSpec, toSpec);
  const body = {
    pair: `${fromId}/${toId}`,
    from: fromId,
    to: toId,
    bids: book.bids,
    asks: book.asks,
    reserveBase: reserves.reserveBase,
    reserveQuote: reserves.reserveQuote,
    tradingFee: Number(reserves.tradingFee) > 0 ? Number(reserves.tradingFee) : 1000,
    present: Boolean(book.bids.length || book.asks.length || (reserves.reserveBase > 0 && reserves.reserveQuote > 0)),
    source: "xrpl",
  };
  cache.set(key, { at: now, body });
  return body;
}
