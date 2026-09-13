import {quoteIssue} from "../wallet/ammVote.js";
import {sameLedgerCurrency} from "../xaman/tradeTx.js";
import {quoteBridgeSwap, quoteSwap} from "./quoteSwap.js";
import {normalizeSwapMode} from "./swapModes.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function amountToNumber(amount) {
  if (amount == null || amount === "") return 0;
  if (typeof amount === "object") return num(amount.value ?? amount.amount);
  const raw = String(amount);
  const n = Number(amount);
  if (!(n > 0)) return 0;
  return /^\d+$/.test(raw) ? n / 1_000_000 : n;
}

export function assetSpec(asset = {}) {
  return quoteIssue({
    id: asset.id || asset.ticker || asset.currency || asset.from || asset.to,
    currency: asset.currency,
    issuer: asset.issuer || asset.fromIssuer || asset.toIssuer,
    hex: asset.hex || asset.fromHex || asset.toHex,
  });
}

export function sameAsset(amount, spec) {
  if (amount == null || !spec) return false;
  const wantXrp = String(spec.currency || "").toUpperCase() === "XRP" && !spec.issuer;
  if (wantXrp) return amount != null && typeof amount !== "object";
  if (typeof amount !== "object") return false;
  const currency = String(amount.currency || "");
  const issuer = String(amount.issuer || "");
  if (spec.issuer && issuer && issuer !== spec.issuer) return false;
  return sameLedgerCurrency(currency, spec.currency);
}

export function offerToDirectRow(offer, fromSpec, toSpec) {
  if (!offer || offer.placeholder) return null;
  const gets = offer.TakerGets ?? offer.taker_gets;
  const pays = offer.TakerPays ?? offer.taker_pays;
  const fundedGets = offer.taker_gets_funded ?? offer.TakerGetsFunded;
  const fundedPays = offer.taker_pays_funded ?? offer.TakerPaysFunded;
  if (sameAsset(gets, toSpec) && sameAsset(pays, fromSpec)) {
    const baseSize = amountToNumber(fundedPays && sameAsset(fundedPays, fromSpec) ? fundedPays : pays);
    const quoteSize = amountToNumber(fundedGets && sameAsset(fundedGets, toSpec) ? fundedGets : gets);
    const price = baseSize > 0 ? quoteSize / baseSize : 0;
    if (!(price > 0) || !(baseSize > 0)) return null;
    return { price, base_size: baseSize, quote_size: quoteSize, source: "dex", side: "bid" };
  }
  if (sameAsset(gets, fromSpec) && sameAsset(pays, toSpec)) {
    const baseSize = amountToNumber(fundedGets && sameAsset(fundedGets, fromSpec) ? fundedGets : gets);
    const quoteSize = amountToNumber(fundedPays && sameAsset(fundedPays, toSpec) ? fundedPays : pays);
    const price = baseSize > 0 ? quoteSize / baseSize : 0;
    if (!(price > 0) || !(baseSize > 0)) return null;
    return { price, base_size: baseSize, quote_size: quoteSize, source: "dex", side: "ask" };
  }
  return null;
}

export function splitDirectOffers(offers, fromSpec, toSpec) {
  const bids = [];
  const asks = [];
  for (const offer of Array.isArray(offers) ? offers : []) {
    const row = offerToDirectRow(offer, fromSpec, toSpec);
    if (!row) continue;
    if (row.side === "bid") bids.push(row);
    else asks.push(row);
  }
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  return { bids, asks };
}

export function reservesFromAmm(amm, fromSpec, toSpec) {
  const first = amm?.amount ?? amm?.amm?.amount;
  const second = amm?.amount2 ?? amm?.amm?.amount2;
  const fee = Number(amm?.trading_fee ?? amm?.amm?.trading_fee);
  if (sameAsset(first, fromSpec) && sameAsset(second, toSpec)) {
    return { reserveBase: amountToNumber(first), reserveQuote: amountToNumber(second), tradingFee: fee };
  }
  if (sameAsset(first, toSpec) && sameAsset(second, fromSpec)) {
    return { reserveBase: amountToNumber(second), reserveQuote: amountToNumber(first), tradingFee: fee };
  }
  return { reserveBase: 0, reserveQuote: 0, tradingFee: fee };
}

export function venueFromDirectMarket(market) {
  if (!market || typeof market !== "object") return null;
  const reserveBase = num(market.reserveBase ?? market.reserve_base);
  const reserveQuote = num(market.reserveQuote ?? market.reserve_quote);
  const bids = Array.isArray(market.bids) ? market.bids : [];
  const asks = Array.isArray(market.asks) ? market.asks : [];
  if (!(reserveBase > 0 && reserveQuote > 0) && !bids.length && !asks.length) return null;
  const mid =
    num(market.mid) ||
    (reserveBase > 0 && reserveQuote > 0 ? reserveQuote / reserveBase : 0) ||
    num(bids[0]?.price) ||
    num(asks[0]?.price);
  return {
    mid,
    bids,
    asks,
    reserveBase,
    reserveQuote,
    tradingFee: Number(market.tradingFee ?? market.trading_fee) > 0 ? Number(market.tradingFee ?? market.trading_fee) : 1000,
  };
}

export function quoteSelectedPair({
  amountIn,
  routingMode = "smart",
  directVenue = null,
  fromVenue = {},
  toVenue = {},
  fromXrpVenue = null,
  xrpToVenue = null,
} = {}) {
  const candidates = [];
  if (directVenue) {
    const direct = quoteSwap({ ...directVenue, amountIn, sellingXio: true, routingMode });
    if (direct?.actualOutput > 0) candidates.push({ ...direct, via: "direct" });
  }
  if (fromXrpVenue && xrpToVenue) {
    const hop1 = quoteSwap({ ...fromXrpVenue, amountIn, sellingXio: true, routingMode });
    if (hop1.actualOutput > 0) {
      const hop2 = quoteSwap({ ...xrpToVenue, amountIn: hop1.actualOutput, sellingXio: true, routingMode });
      if (hop2.actualOutput > 0) {
        candidates.push({
          ...hop2,
          via: "xrp-bridge",
          hops: [hop1, hop2],
          bookOutput: hop2.bookOutput,
          ammOutput: hop2.ammOutput,
        });
      }
    }
  }
  const bridge = quoteBridgeSwap({ amountIn, fromVenue, toVenue, routingMode });
  if (bridge?.actualOutput > 0) candidates.push({ ...bridge, via: "bridge" });
  if (!candidates.length) return bridge;
  const preferXrp = normalizeSwapMode(routingMode) === "auto-bridging";
  if (preferXrp) {
    const xrp = candidates.find((row) => row.via === "xrp-bridge");
    if (xrp) return xrp;
  }
  candidates.sort((a, b) => b.actualOutput - a.actualOutput);
  return candidates[0];
}
