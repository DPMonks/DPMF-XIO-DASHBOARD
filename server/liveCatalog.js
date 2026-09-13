import {POOLS, XIO_HEX, XIO_ISSUED_AT, XIO_ISSUER, XIO_TOTAL_SUPPLY, XIO_XRP_AMM, issuerLockedFromIssued} from "../src/constants/ledger.js";
import {issuerBlackholeFromAccount, XIO_BLACKHOLED_AT} from "../src/utils/blackhole.js";
import {pickXioUsd, xioUsdFromRlusdPool, xioUsdFromXrpPool} from "../src/utils/fiatFx.js";
import {xrpPerXio} from "../src/utils/recordedPrice.js";
import {parseXrplToToken, tvlUsdFromXrplTo, XRPL_TO_TOKEN_URL, xioUsdFromXrplTo} from "../src/utils/xrplToToken.js";
import {attachQuoteXrpPrices, loadQuoteXrpRates} from "./quoteXrpMarket.js";
import {attachXioFiat, loadFiatQuote} from "./fiatQuotes.js";
import {loadLiveAmmReservesMany} from "./liveAmmReserves.js";
import {fillNativeBookFromXrpl, xrplRpc} from "./xrplBookOffers.js";
import {composeAmmBook, emptyOrderbook, FEATURED_ORDERBOOK_PAIRS, normalizeOrderbookPair, quotePerXrpFromSpots} from "../src/orderbook.js";
import {FREE_API_HEADERS, loadXrplToCandles, loadXrplToFlows, loadXrplToHolderGraph, loadXrplToHolders, loadXrplToLpChart, loadXrplToLpCounts, loadXrplToLpOwners, loadXrplToRank, loadXrpSparkline} from "./xrplToCatalog.js";
import {applyPoolVolumes, loadPoolXioVolumes} from "./freeVolume.js";
import {loadLedgerPoolVolumes, mergeVolumeMaps} from "./ammPoolVolume.js";
import {QUOTE_ASSETS} from "../src/xaman/tradeTx.js";

export function knownLivePoolSpecs(extra = []) {
  const specs = [];
  const seen = new Set();
  function add(spec) {
    const pair = String(spec.pair || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (!/^XIO\/[A-Z0-9]{2,12}$/.test(pair) || seen.has(pair)) return;
    seen.add(pair);
    specs.push({
      ...spec,
      pair,
      quote: spec.quote || pair.split("/")[1],
    });
  }
  for (const pool of POOLS) {
    add({
      pair: pool.pair,
      quote: pool.quote,
      amm: pool.amm,
      ammAccount: pool.amm,
      issuer: pool.quoteIssuer,
      hex: pool.quoteHex,
      lpHex: pool.lpHex,
    });
  }
  for (const asset of QUOTE_ASSETS) {
    add({
      pair: `XIO/${asset.id}`,
      quote: asset.id,
      issuer: asset.issuer,
      hex: asset.hex,
    });
  }
  for (const pair of FEATURED_ORDERBOOK_PAIRS) {
    add({ pair, quote: String(pair).split("/")[1] });
  }
  for (const row of Array.isArray(extra) ? extra : []) {
    add({
      pair: row.pool_name || row.pool || row.pair,
      quote: row.quote,
      amm: row.amm_account || row.amm,
      ammAccount: row.amm_account || row.amm,
      issuer: row.quote_issuer,
      hex: row.quote_hex,
    });
  }
  return specs;
}

let marketCache = { at: 0, prices: null, pools: null, overview: null };
let tokenCache = { at: 0, body: null };
let issuerLockedCache = { at: 0, body: null };
let issuerBlackholeCache = { at: 0, body: null };
const MARKET_MS = 15_000;
const TOKEN_MS = 60_000;
const ISSUER_MS = 60_000;
const BLACKHOLE_MS = 6 * 60 * 60 * 1000;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function loadLiveXrpQuote(options = {}) {
  return loadFiatQuote(options);
}

function poolRowFromLive(spec, live, prices) {
  const reserveXio = num(live?.reserve_xio ?? live?.reserve_asset);
  const reserveQuote = num(live?.reserve_currency ?? live?.reserve_quote);
  return {
    pool: spec.pair,
    pool_name: spec.pair,
    quote: spec.quote,
    amm_account: live?.amm_account || spec.amm,
    lp_currency: live?.lp_currency || spec.lpHex,
    reserve_xio: reserveXio || null,
    reserve_asset: reserveXio || null,
    reserve_currency: reserveQuote || null,
    reserve_quote: reserveQuote || null,
    lp_supply: num(live?.lp_supply) || null,
    trading_fee: live?.trading_fee ?? null,
    xioUsd: prices?.xioUsd || null,
    xrpUsd: prices?.xrpUsd || null,
    xioPerXrp: prices?.xioPerXrp || prices?.xio_per_xrp || null,
    volume24h: null,
    source: "xrpl",
  };
}

export async function loadXrplToToken(options = {}) {
  const now = Number(options.now) || Date.now();
  if (!options.fresh && tokenCache.body && now - tokenCache.at < TOKEN_MS) {
    return tokenCache.body;
  }
  try {
    const res = await (options.fetchImpl || fetch)(XRPL_TO_TOKEN_URL, {
      headers: FREE_API_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`xrpl.to ${res.status}`);
    const body = parseXrplToToken(await res.json());
    tokenCache = { at: now, body };
    return body;
  } catch {
    return tokenCache.body || {
      holders: 0,
      trustlines: 0,
      lpHolders: 0,
      exchXrp: 0,
      vol24hXrp: 0,
      change24h: 0,
      usd: 0,
      source: "empty",
    };
  }
}

export async function loadIssuerLockedLive(options = {}) {
  const now = Number(options.now) || Date.now();
  if (!options.fresh && issuerLockedCache.body && now - issuerLockedCache.at < ISSUER_MS) {
    return issuerLockedCache.body;
  }
  try {
    const result = await xrplRpc(
      "gateway_balances",
      { account: XIO_ISSUER, ledger_index: "validated", hotwallet: [] },
      options
    );
    const obligations = result?.obligations || {};
    const issued = Number(obligations.XIO || obligations[XIO_HEX] || 0);
    const locked = issuerLockedFromIssued(issued);
    const body = {
      issuer: XIO_ISSUER,
      issuer_locked: locked,
      burned_supply: locked,
      issued,
      circulating: Math.max(XIO_TOTAL_SUPPLY - locked, 0),
      as_of: new Date().toISOString(),
      source: "xrpl",
    };
    issuerLockedCache = { at: now, body };
    return body;
  } catch {
    return (
      issuerLockedCache.body || {
        issuer: XIO_ISSUER,
        issuer_locked: 0,
        burned_supply: 0,
        issued: 0,
        circulating: XIO_TOTAL_SUPPLY,
        source: "empty",
      }
    );
  }
}

export async function loadIssuerBlackholeLive(options = {}) {
  const now = Number(options.now) || Date.now();
  if (!options.fresh && issuerBlackholeCache.body && now - issuerBlackholeCache.at < BLACKHOLE_MS) {
    return issuerBlackholeCache.body;
  }
  try {
    const info = await xrplRpc(
      "account_info",
      { account: XIO_ISSUER, ledger_index: "validated" },
      options
    );
    const detected = issuerBlackholeFromAccount(info);
    const body = {
      blackholed: detected.blackholed,
      blackholed_fixed: detected.fixed,
      blackholed_at: detected.blackholed ? issuerBlackholeCache.body?.blackholed_at || XIO_BLACKHOLED_AT : null,
      source: "xrpl",
    };
    issuerBlackholeCache = { at: now, body };
    return body;
  } catch {
    return (
      issuerBlackholeCache.body || {
        blackholed: true,
        blackholed_fixed: true,
        blackholed_at: XIO_BLACKHOLED_AT,
        source: "ledger",
      }
    );
  }
}

export async function loadLiveMarket(options = {}) {
  const now = Number(options.now) || Date.now();
  if (!options.fresh && marketCache.overview && now - marketCache.at < MARKET_MS) {
    return marketCache;
  }
  const [quote, token, issuerLocked, blackhole, lpCounts] = await Promise.all([
    loadLiveXrpQuote(options),
    loadXrplToToken(options),
    loadIssuerLockedLive(options),
    loadIssuerBlackholeLive(options),
    loadXrplToLpCounts({ ...options, pool: "all" }).catch(() => null),
  ]);
  const liveSpecs = knownLivePoolSpecs();
  const lives = await loadLiveAmmReservesMany(
    liveSpecs.map((spec) => ({
      ammAccount: spec.ammAccount || spec.amm,
      pair: spec.pair,
      quote: spec.quote,
      issuer: spec.issuer,
      hex: spec.hex,
    })),
    options
  );
  const xrpPool = lives[liveSpecs.findIndex((spec) => spec.pair === "XIO/XRP")] || lives[0] || {};
  const rlusdPool = lives.find((row) => String(row?.pair || "").includes("RLUSD")) || lives[1] || {};
  const xrpUsd = num(quote.usd);
  const xioUsd = pickXioUsd({
    ammXrp: xioUsdFromXrpPool(xrpPool, xrpUsd),
    ammRlusd: xioUsdFromRlusdPool(rlusdPool, 1),
    xrplTo: xioUsdFromXrplTo(token, xrpUsd),
  });
  const liveRates = await loadQuoteXrpRates(options).catch(() => ({}));
  const prices = attachXioFiat(
    attachQuoteXrpPrices(
      {
        xrpUsd,
        xrpGbp: num(quote.gbp),
        xrpEur: num(quote.eur),
        xrpJpy: num(quote.jpy),
        usdGbp: num(quote.usdGbp),
        usdEur: num(quote.usdEur),
        usdJpy: num(quote.usdJpy),
        xioUsd,
        recorded_price: xioUsd,
        xio_per_xrp: xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
        xioPerXrp: xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
        RLUSD: 1,
        quotes: { XRP: xrpUsd, RLUSD: 1 },
        source: "xrpl",
      },
      liveRates,
      xrpUsd
    ),
    quote
  );
  const reserveXio = num(xrpPool.reserve_xio ?? xrpPool.reserve_asset);
  const reserveXrp = num(xrpPool.reserve_currency ?? xrpPool.reserve_quote);
  const tvlUsd = reserveXrp > 0 && xrpUsd > 0 ? reserveXrp * 2 * xrpUsd : 0;
  const burned = Number(issuerLocked.issuer_locked || 0);
  const circulating = Number(issuerLocked.circulating || XIO_TOTAL_SUPPLY);
  const volumes = await loadPoolXioVolumes({
    token,
    reserveXio,
    reserveXrp,
    xioUsd,
    xrpUsd,
    now,
    fresh: options.fresh,
    fetchImpl: options.fetchImpl,
    pairs: liveSpecs.map((spec) => spec.pair),
  }).catch(() => ({}));
  const liveRows = liveSpecs
    .map((spec, index) => poolRowFromLive(spec, lives[index], prices))
    .filter((row) => row.amm_account || row.reserve_asset || row.lp_supply);
  const ledgerVolumes = await loadLedgerPoolVolumes(liveRows, options).catch(() => ({}));
  const pools = applyPoolVolumes(liveRows, mergeVolumeMaps(volumes, ledgerVolumes));
  const volume24h = num(volumes["XIO/XRP"]?.volume24hXio) || num(pools[0]?.volume24h);
  const volume24hUsd = num(volumes["XIO/XRP"]?.volume24hUsd);
  const volume24hXrp = num(volumes["XIO/XRP"]?.volume24hXrp) || num(token.vol24hXrp);
  const overview = {
    pool: "XIO/XRP",
    tvl: tvlUsd || reserveXrp || 0,
    tvl_usd: tvlUsd,
    price: xioUsd,
    xioUsd,
    recorded_price: xioUsd,
    xioGbp: prices.xioGbp,
    xioEur: prices.xioEur,
    xioJpy: prices.xioJpy,
    xrpUsd,
    xrpGbp: prices.xrpGbp,
    xrpEur: prices.xrpEur,
    xrpJpy: prices.xrpJpy,
    xio_per_xrp: xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
    xioPerXrp: xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
    reserve_asset: reserveXio,
    reserve_currency: reserveXrp,
    lp_supply: num(xrpPool.lp_supply) || null,
    trading_fee: xrpPool.trading_fee ?? null,
    volume24h,
    volume24hXio: volume24h,
    volume24hUsd,
    volume24hXrp,
    volume7d: num(volumes["XIO/XRP"]?.volume7dXio) || null,
    volume7dXio: num(volumes["XIO/XRP"]?.volume7dXio) || null,
    volumeUnit: "xio",
    volumeSource: volumes["XIO/XRP"]?.source || null,
    holder_count: num(token.holders) || null,
    holders: num(token.holders) || null,
    lp_holder_count: num(token.lpHolders) || num(lpCounts?.holders) || null,
    circulating,
    circulating_supply: circulating,
    total_supply: XIO_TOTAL_SUPPLY,
    burned_supply: burned,
    issuer_locked: burned,
    issued_xio: Number(issuerLocked.issued || 0),
    issuer_source: issuerLocked.source,
    amm_xio: reserveXio,
    trustlines: num(token.trustlines) || null,
    trustline_count: num(token.trustlines) || null,
    lp_trustline_count: num(lpCounts?.trustlines) || null,
    ammMarketCap: tvlUsd,
    xrplMarketCap: XIO_TOTAL_SUPPLY * xioUsd,
    circulatingMarketCap: circulating * xioUsd,
    issuer: XIO_ISSUER,
    tokenType: "XIO",
    created: XIO_ISSUED_AT,
    blackholed: blackhole.blackholed,
    blackholed_fixed: blackhole.blackholed_fixed,
    blackholed_at: blackhole.blackholed_at,
    usdGbp: prices.usdGbp,
    usdEur: prices.usdEur,
    usdJpy: prices.usdJpy,
    amm_account: xrpPool.amm_account || XIO_XRP_AMM,
    source: "xrpl",
    catching_up: !num(token.holders),
  };
  marketCache = {
    at: num(token.holders) ? now : 0,
    prices,
    pools,
    overview,
    token,
    change: { xio: Number(token.change24h) || 0, xrp: Number(quote.change24h) || 0 },
  };
  return marketCache;
}

export async function loadXrplToMarket(options = {}) {
  const [quote, token] = await Promise.all([
    loadLiveXrpQuote(options),
    loadXrplToToken(options),
  ]);
  const xrpUsd = num(quote.usd);
  const xioUsd = xioUsdFromXrplTo(token, xrpUsd);
  const prices = attachXioFiat(
    {
      xrpUsd,
      xrpGbp: num(quote.gbp),
      xrpEur: num(quote.eur),
      xrpJpy: num(quote.jpy),
      usdGbp: num(quote.usdGbp),
      usdEur: num(quote.usdEur),
      usdJpy: num(quote.usdJpy),
      xioUsd,
      recorded_price: xioUsd,
      price: xioUsd,
      xio_per_xrp: xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
      xioPerXrp: xrpPerXio(xioUsd, xrpUsd) || num(token.exchXrp),
      RLUSD: 1,
      quotes: { XRP: xrpUsd, RLUSD: 1 },
      source: "xrpl.to",
    },
    quote
  );
  const markXrp = num(token.exchXrp) || xrpPerXio(xioUsd, xrpUsd);
  const volumes = await loadPoolXioVolumes({
    token,
    xioUsd,
    xrpUsd,
    now: options.now,
    fresh: options.fresh,
    fetchImpl: options.fetchImpl,
  }).catch(() => ({}));
  const volume24h = num(volumes["XIO/XRP"]?.volume24hXio) || (markXrp ? token.vol24hXrp / markXrp : 0);
  const tvlUsd = tvlUsdFromXrplTo(token, xrpUsd);
  const overview = {
    pool: "XIO/XRP",
    tvl: tvlUsd,
    tvl_usd: tvlUsd,
    price: xioUsd,
    xioUsd,
    recorded_price: xioUsd,
    xioGbp: prices.xioGbp,
    xioEur: prices.xioEur,
    xioJpy: prices.xioJpy,
    xrpUsd,
    xrpGbp: prices.xrpGbp,
    xrpEur: prices.xrpEur,
    xrpJpy: prices.xrpJpy,
    xio_per_xrp: prices.xio_per_xrp,
    xioPerXrp: prices.xioPerXrp,
    volume24h,
    volume24hXio: volume24h,
    volume24hUsd: num(volumes["XIO/XRP"]?.volume24hUsd),
    volume24hXrp: num(volumes["XIO/XRP"]?.volume24hXrp) || num(token.vol24hXrp),
    volume7d: num(volumes["XIO/XRP"]?.volume7dXio) || null,
    volume7dXio: num(volumes["XIO/XRP"]?.volume7dXio) || null,
    volumeUnit: "xio",
    volumeSource: volumes["XIO/XRP"]?.source || "xrpl.to",
    holder_count: num(token.holders) || null,
    holders: num(token.holders) || null,
    lp_holder_count: num(token.lpHolders) || null,
    circulating: XIO_TOTAL_SUPPLY,
    circulating_supply: XIO_TOTAL_SUPPLY,
    total_supply: XIO_TOTAL_SUPPLY,
    issuer: XIO_ISSUER,
    tokenType: "XIO",
    created: XIO_ISSUED_AT,
    blackholed: true,
    blackholed_fixed: true,
    blackholed_at: XIO_BLACKHOLED_AT,
    usdGbp: prices.usdGbp,
    usdEur: prices.usdEur,
    usdJpy: prices.usdJpy,
    trustlines: num(token.trustlines) || null,
    trustline_count: num(token.trustlines) || null,
    ammMarketCap: tvlUsd || null,
    xrplMarketCap: num(token.marketcap) || XIO_TOTAL_SUPPLY * xioUsd,
    circulatingMarketCap: num(token.marketcap) || XIO_TOTAL_SUPPLY * xioUsd,
    amm_account: XIO_XRP_AMM,
    source: "xrpl.to",
    catching_up: !num(token.holders),
  };
  return { prices, overview, token, change: { xio: Number(token.change24h) || 0, xrp: 0, source: "xrpl.to" } };
}

async function liveMarketOrXrplTo(options = {}) {
  try {
    const market = await loadLiveMarket(options);
    if (market?.overview && (num(market.overview.xioUsd) || num(market.overview.holder_count))) {
      return market;
    }
  } catch {
    // xrpl.to still has the token card if amm_info or CoinGecko miss
  }
  return loadXrplToMarket(options);
}

export function orderbookPairFromSearch(search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return normalizeOrderbookPair(
    params.get("pair") || params.get("quote") || params.get("market") || "XIO/XRP"
  );
}

function liveBookReserves(pair, pool = {}, market = {}) {
  const name = normalizeOrderbookPair(pair);
  const reserveAsset =
    Number(pool.reserve_asset || pool.reserve_xio) ||
    (name === "XIO/XRP" ? Number(market.overview?.reserve_asset) || 0 : 0);
  const reserveQuote =
    Number(pool.reserve_currency || pool.reserve_quote) ||
    (name === "XIO/XRP" ? Number(market.overview?.reserve_currency) || 0 : 0);
  const price =
    name === "XIO/XRP"
      ? Number(market.overview?.xioPerXrp) || null
      : reserveAsset > 0 && reserveQuote > 0
        ? reserveQuote / reserveAsset
        : null;
  return {
    reserve_asset: reserveAsset || null,
    reserve_currency: reserveQuote || null,
    trading_fee: pool.trading_fee ?? market.overview?.trading_fee,
    price,
  };
}

function poolForPair(market, pair) {
  const name = normalizeOrderbookPair(pair);
  return (
    (market.pools || []).find((row) => normalizeOrderbookPair(row.pool_name || row.pool) === name) ||
    (name === "XIO/XRP" ? market.pools?.[0] || {} : {})
  );
}

async function composeLivePairBook(pair, market, options = {}, extras = {}) {
  const name = normalizeOrderbookPair(pair);
  const pool = poolForPair(market, name);
  const live = await fillNativeBookFromXrpl(name, pool, options);
  return composeAmmBook(live || emptyOrderbook(name), liveBookReserves(name, pool, market), name, extras);
}

async function composeLiveFeaturedBooks(market, options = {}) {
  const xrpBook = await composeLivePairBook("XIO/XRP", market, options);
  const books = { "XIO/XRP": xrpBook };
  for (const pair of FEATURED_ORDERBOOK_PAIRS) {
    if (pair === "XIO/XRP") continue;
    const pool = poolForPair(market, pair);
    const reserves = liveBookReserves(pair, pool, market);
    books[pair] = await composeLivePairBook(pair, market, options, {
      xrpBook,
      quotePerXrp: quotePerXrpFromSpots(reserves.price, xrpBook?.amm?.price),
    });
  }
  return books;
}

export async function liveCatalogPayload(suffix, options = {}) {
  const path = String(suffix || "").split("?")[0];
  if (path === "overview" || path === "token-details") {
    return (await liveMarketOrXrplTo(options)).overview;
  }
  if (path === "prices") {
    return (await liveMarketOrXrplTo(options)).prices;
  }
  if (path === "lp-pools" || path === "amm" || path === "pools") {
    const market = await loadLiveMarket(options);
    return {
      ...market.overview,
      pools: market.pools,
      source: "xrpl",
      catching_up: !market.pools?.length,
    };
  }
  if (path === "prices/change24h" || path === "change24h") {
    const [market, quote] = await Promise.all([loadXrplToMarket(options), loadLiveXrpQuote(options)]);
    return {
      xio: Number(market.change?.xio) || 0,
      xrp: Number(quote.change24h) || 0,
      source: "xrpl.to",
    };
  }
  if (path === "issuer-locked") {
    return loadIssuerLockedLive(options);
  }
  if (path === "holders/count") {
    const token = await loadXrplToToken(options);
    return { count: token.holders || null, source: token.source, catching_up: !token.holders };
  }
  if (path === "trustlines/count") {
    const token = await loadXrplToToken(options);
    return { count: token.trustlines || null, source: token.source, catching_up: !token.trustlines };
  }
  if (path === "lp-holders/count") {
    const params = new URLSearchParams(String(options.search || "").replace(/^\?/, ""));
    const counts = await loadXrplToLpCounts({
      ...options,
      pool: params.get("pool") || params.get("pair") || "all",
    }).catch(() => null);
    if (counts && !counts.catching_up) {
      return { count: counts.holders, pool: counts.pool, source: "xrpl.to", catching_up: false };
    }
    const token = await loadXrplToToken(options);
    return { count: token.lpHolders || null, pool: "all", source: token.source, catching_up: !token.lpHolders };
  }
  if (path === "lp-trustlines/count") {
    const params = new URLSearchParams(String(options.search || "").replace(/^\?/, ""));
    const counts = await loadXrplToLpCounts({
      ...options,
      pool: params.get("pool") || params.get("pair") || "all",
    }).catch(() => null);
    if (counts && !counts.catching_up) {
      return { count: counts.trustlines, pool: counts.pool, source: "xrpl.to", catching_up: false };
    }
    const token = await loadXrplToToken(options);
    return { count: token.lpHolders || null, pool: "all", source: token.source, catching_up: !token.trustlines };
  }
  if (path === "orderbook") {
    const market = await loadLiveMarket(options);
    const name = orderbookPairFromSearch(options.search);
    if (name === "XIO/XRP") {
      return composeLivePairBook(name, market, options);
    }
    const xrpBook = await composeLivePairBook("XIO/XRP", market, options);
    const reserves = liveBookReserves(name, poolForPair(market, name), market);
    return composeLivePairBook(name, market, options, {
      xrpBook,
      quotePerXrp: quotePerXrpFromSpots(reserves.price, xrpBook?.amm?.price),
    });
  }
  if (path === "orderbooks") {
    const market = await loadLiveMarket(options);
    const books = await composeLiveFeaturedBooks(market, options);
    return {
      quotes: FEATURED_ORDERBOOK_PAIRS.map((pair) => pair.split("/")[1]).filter(Boolean),
      featured: FEATURED_ORDERBOOK_PAIRS,
      pairs: FEATURED_ORDERBOOK_PAIRS,
      default_pair: "XIO/XRP",
      books,
      source: "xrpl",
    };
  }
  if (path === "xio-flows" || path === "trades" || path === "charts/trades") {
    return loadXrplToFlows(options).catch(() => []);
  }
  if (path === "top-holders" || path === "top-holders-v2") {
    const params = new URLSearchParams(String(options.search || "").replace(/^\?/, ""));
    return loadXrplToHolders({
      ...options,
      limit: params.get("limit"),
      offset: params.get("offset"),
    }).catch(() => ({ holders: [], rows: [], count: null, source: "xrpl.to", catching_up: true }));
  }
  if (path === "wallet/rank" || /^wallet\/rank\//.test(path)) {
    const account = decodeURIComponent(path.split("/")[2] || options.account || "");
    if (!account) return { account: null, rank: null, source: "xrpl.to" };
    return loadXrplToRank(account, options).catch(() => ({ account, rank: null, source: "xrpl.to" }));
  }
  if (
    path === "charts/holders" ||
    path === "charts/trustlines" ||
    path === "charts/activity" ||
    path === "charts/traders"
  ) {
    const rows = await loadXrplToHolderGraph(options).catch(() => []);
    return rows.length ? rows : { rows: [], source: "xrpl.to", catching_up: true };
  }
  if (path.startsWith("sparkline/")) {
    const asset = decodeURIComponent(path.split("/")[1] || "XIO").toUpperCase();
    if (asset === "XRP") return loadXrpSparkline(options).catch(() => []);
    return loadXrplToCandles(options).catch(() => []);
  }
  if (path === "chart/candles" || path === "charts/candles") {
    const candles = await loadXrplToCandles(options).catch(() => []);
    return {
      source: "xrpl.to",
      locked: false,
      price_history: candles,
      amm_pool_history: [],
      rows: candles,
    };
  }
  if (path === "top-lp") {
    const params = new URLSearchParams(String(options.search || "").replace(/^\?/, ""));
    return loadXrplToLpOwners({
      ...options,
      pool: params.get("pool") || params.get("pair") || "all",
      limit: params.get("limit"),
      offset: params.get("offset"),
    }).catch(() => ({ holders: [], rows: [], count: null, source: "xrpl.to", catching_up: true }));
  }
  if (path === "charts/lp-holders" || path === "charts/lp-trustlines") {
    const params = new URLSearchParams(String(options.search || "").replace(/^\?/, ""));
    const rows = await loadXrplToLpChart({
      ...options,
      pool: params.get("pool") || params.get("pair") || "XIO/XRP",
    }).catch(() => []);
    return rows.length ? rows : { rows: [], source: "xrpl.to", catching_up: true };
  }
  if (path === "charts/tvl") {
    try {
      const market = await loadLiveMarket(options);
      const tvl = num(market.overview?.tvl_usd) || num(market.overview?.tvl) || num(market.token?.tvl);
      if (tvl > 0) {
        return [
          {
            timestamp: new Date().toISOString(),
            tvl,
            tvl_usd: tvl,
            source: "xrpl",
          },
        ];
      }
    } catch {
      // last-good catalog memory covers a blip
    }
    return { rows: [], source: "xrpl.to", catching_up: true };
  }
  return null;
}
