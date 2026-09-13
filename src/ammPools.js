import {issuedAmountValue, isXioAmount, overlayLiveAmmReserves} from "./utils/ammInfo.js";
import {preferUsdPoolSplit} from "./utils/poolSplit.js";
import {normalizeOrderbookPair} from "./orderbook.js";

export function ammPoolName(row) {
  return String(row?.pool || row?.pool_name || row?.pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function filterAmmPools(pools = [], query = "") {
  const q = String(query || "")
    .trim()
    .replace(/^XIO\s*\/\s*/i, "")
    .toUpperCase();
  const rows = Array.isArray(pools) ? pools : [];
  if (!q) return rows;
  return rows.filter((row) => {
    const hay = [
      row?.pool,
      row?.pool_name,
      row?.pair,
      row?.quote,
      row?.amm_account,
      row?.quote_issuer,
    ]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();
    return hay.includes(q);
  });
}

export function mergeAmmPoolLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const row of Array.isArray(list) ? list : []) {
      const key = String(row?.amm_account || ammPoolName(row));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

export function searchAmmAccount(query) {
  const raw = String(query || "").trim();
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(raw) ? raw : "";
}

export function searchPairHint(query) {
  const raw = String(query || "").trim();
  if (!raw || searchAmmAccount(raw)) return "";
  return normalizeOrderbookPair(raw).toUpperCase();
}

export function poolQuoteTicker(pool) {
  const name = ammPoolName(pool);
  const fromName = name.includes("/") ? name.split("/")[1] : "";
  return (
    String(pool?.quote || fromName || "XRP")
      .replace(/^XIO\//i, "")
      .toUpperCase() || "XRP"
  );
}

export function poolAssetTrustlineId(pool) {
  const quote = poolQuoteTicker(pool);
  return quote === "XRP" ? "XIO" : quote;
}

export function poolKey(pool) {
  return String(pool?.amm_account || ammPoolName(pool));
}

export function compactPoolAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const signed = n < 0 ? "-" : "";
  const format = (qty, suffix) => {
    const digits = qty >= 100 ? 1 : 2;
    return `${signed}${qty.toFixed(digits).replace(/\.0$/, "").replace(/(\.\d)0$/, "$1")}${suffix}`;
  };
  if (abs >= 1e9) return format(abs / 1e9, "B");
  if (abs >= 1e6) return format(abs / 1e6, "M");
  if (abs >= 10_000) return format(abs / 1e3, "K");
  if (abs >= 1) return `${signed}${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (abs > 0) return `${signed}${abs.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return "0";
}

export function looksLikeLpAsQuote({ reserveXio, reserveQuote, lpSupply, quote } = {}) {
  const xio = Number(reserveXio);
  const amount = Number(reserveQuote);
  const lp = Number(lpSupply);
  if (!(amount > 0) || !(lp > 0)) return false;
  if (Math.abs(amount - lp) / Math.max(amount, lp) > 0.03) return false;
  const quoteId = String(quote || "").replace(/^XIO\//i, "").toUpperCase();
  if (quoteId === "XRP" && amount > 50_000) return true;
  return xio > 0 && xio / amount > 8;
}

export function sanePoolQuoteReserve(pool = {}) {
  const quote = Number(pool?.reserve_currency ?? pool?.reserve_quote);
  if (!(quote > 0)) return null;
  if (
    looksLikeLpAsQuote({
      reserveXio: pool?.reserve_asset ?? pool?.reserve_xio,
      reserveQuote: quote,
      lpSupply: pool?.lp_supply,
      quote: pool?.quote || pool?.pool || pool?.pool_name,
    })
  ) {
    return null;
  }
  return quote;
}

export function poolSplitMeta(pool) {
  const xio = Number(pool?.reserve_asset ?? pool?.reserve_xio);
  const quote = sanePoolQuoteReserve(pool);
  const lp = Number(pool?.lp_supply);
  const hasXio = Number.isFinite(xio) && xio > 0;
  const hasQuote = quote != null;
  const hasLp = Number.isFinite(lp) && lp > 0;
  return {
    reserveXio: Number.isFinite(xio) ? xio : null,
    reserveQuote: hasQuote ? quote : null,
    lpSupply: Number.isFinite(lp) ? lp : null,
    xioPerLp: hasLp && hasXio ? xio / lp : null,
    quotePerLp: hasLp && hasQuote ? quote / lp : null,
  };
}

function withPoolSplitPercents(pool) {
  const reserveQuote = sanePoolQuoteReserve(pool);
  const split = preferUsdPoolSplit({
    reserveXio: pool.reserve_asset ?? pool.reserve_xio,
    reserveQuote,
    lpSupply: reserveQuote != null ? pool.lp_supply : 0,
    price: pool.price,
    xioUsd: pool.xioUsd,
    quoteUsd: pool.quote_usd,
  });
  return {
    ...pool,
    reserve_currency: reserveQuote,
    reserve_quote: reserveQuote,
    xio_pct: split?.xioPct ?? (reserveQuote != null ? pool.xio_pct : null),
    quote_pct: split?.quotePct ?? (reserveQuote != null ? pool.quote_pct : null),
    lead: split?.lead || (reserveQuote != null ? pool.lead : null),
  };
}

export function applyLivePoolReserves(pool, live) {
  if (!pool) return pool;
  const leakedLive = looksLikeLpAsQuote({
    reserveXio: live?.reserve_xio ?? live?.reserve_asset,
    reserveQuote: live?.reserve_currency ?? live?.reserve_quote,
    lpSupply: live?.lp_supply,
    quote: live?.quote || live?.pair || pool?.quote || pool?.pool,
  });
  const overlaid = live && !leakedLive ? overlayLiveAmmReserves(pool, live) : pool;
  const next = withPoolSplitPercents(overlaid);
  return {
    ...next,
    updated:
      overlaid.reserve_source === "amm_info" || overlaid.reserve_source === "trade"
        ? new Date().toISOString()
        : overlaid.updated,
  };
}

function tradeDeltaFromDetail(detail = {}) {
  const trade = detail.trade || {};
  const tx = detail.txjson || {};
  const action = String(trade.action || detail.action || "").toLowerCase();
  const txType = String(tx.TransactionType || "").toLowerCase();
  const remove = action === "removelp" || txType === "ammwithdraw";
  const first = issuedAmountValue(tx.Amount);
  const second = issuedAmountValue(tx.Amount2);
  const xioFromTx = isXioAmount(tx.Amount) ? first : isXioAmount(tx.Amount2) ? second : first;
  const quoteFromTx = isXioAmount(tx.Amount) ? second : isXioAmount(tx.Amount2) ? first : second;
  const xio =
    Number(trade.withdraw?.base ?? trade.xio) ||
    Number(remove ? 0 : trade.amount) ||
    Number(xioFromTx) ||
    0;
  const quote =
    Number(trade.withdraw?.quote ?? (remove ? 0 : trade.quoteQty ?? trade.quote)) ||
    Number(quoteFromTx) ||
    0;
  const lp =
    Number(
      remove
        ? trade.lpAmount ?? issuedAmountValue(tx.LPTokenIn)
        : detail.lpReceived ?? trade.lpOut ?? issuedAmountValue(tx.LPTokenOut)
    ) || 0;
  return { remove, xio, quote, lp };
}

export function signedLpAccount(detail = {}, fallback = "") {
  return String(
    detail.account || detail.txjson?.Account || detail.trade?.account || fallback || ""
  ).trim();
}

function ownerPair(row) {
  return normalizeOrderbookPair(row?.pair || row?.pool_name || row?.pool || "XIO/XRP");
}

export function applySignedLpOwner(rows, detail = {}, account = "") {
  const who = signedLpAccount(detail, account);
  const list = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  if (!who || !isLpPoolTrade(detail)) return list;
  const pair = normalizeOrderbookPair(tradePoolHint(detail) || detail.trade?.pair || "XIO/XRP");
  const held = Number(detail.lpHeld);
  const { remove, lp } = tradeDeltaFromDetail(detail);
  const idx = list.findIndex(
    (row) =>
      String(row?.account || "").toLowerCase() === who.toLowerCase() && ownerPair(row) === pair
  );
  const prev = idx >= 0 ? Number(list[idx].lp_balance ?? list[idx].balance) || 0 : 0;
  let nextBal;
  if (Number.isFinite(held) && held >= 0) {
    nextBal = held;
  } else if (lp > 0) {
    nextBal = remove ? Math.max(0, prev - lp) : prev + lp;
  } else {
    return list;
  }
  if (idx >= 0) list.splice(idx, 1);
  if (nextBal > 0) {
    const prior = idx >= 0 ? rows[idx] : {};
    list.push({
      ...prior,
      account: who,
      lp_balance: nextBal,
      balance: nextBal,
      pair,
      pool_name: pair,
      live: true,
      updated: new Date().toISOString(),
    });
  }
  return list
    .sort((a, b) => Number(b.lp_balance ?? b.balance ?? 0) - Number(a.lp_balance ?? a.balance ?? 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function rememberSignedLpOverlay(rows, detail = {}, account = "") {
  const next = applySignedLpOwner(rows, detail, account);
  const who = signedLpAccount(detail, account);
  const pair = normalizeOrderbookPair(tradePoolHint(detail) || detail.trade?.pair || "XIO/XRP");
  const row = next.find(
    (item) =>
      String(item?.account || "").toLowerCase() === who.toLowerCase() && ownerPair(item) === pair
  );
  const held = Number(row?.lp_balance ?? row?.balance);
  const { remove } = tradeDeltaFromDetail(detail);
  const overlayDetail =
    Number.isFinite(held) && held > 0
      ? { ...detail, lpHeld: held }
      : remove
        ? { ...detail, lpHeld: 0 }
        : detail;
  return { rows: next, overlay: { detail: overlayDetail, account: who } };
}

export function applyTradePoolReserves(pool, detail = {}) {
  if (!pool || !isLpPoolTrade(detail)) return pool;
  const { remove, xio, quote, lp } = tradeDeltaFromDetail(detail);
  if (!(xio > 0) && !(quote > 0) && !(lp > 0)) return pool;
  const sign = remove ? -1 : 1;
  const reserveXio = Math.max(0, (Number(pool.reserve_asset ?? pool.reserve_xio) || 0) + sign * xio);
  const currentQuote = sanePoolQuoteReserve(pool) || 0;
  const reserveQuote = quote > 0 ? Math.max(0, currentQuote + sign * quote) : currentQuote || null;
  const lpSupply = Math.max(0, (Number(pool.lp_supply) || 0) + sign * lp);
  return withPoolSplitPercents({
    ...pool,
    reserve_asset: reserveXio,
    reserve_xio: reserveXio,
    reserve_currency: reserveQuote,
    reserve_quote: reserveQuote,
    lp_supply: lpSupply,
    reserve_source: "trade",
    updated: new Date().toISOString(),
  });
}

export function isLpPoolTrade(detail = {}) {
  const action = String(detail?.trade?.action || detail?.action || "").toLowerCase();
  const tx = String(
    detail?.txjson?.TransactionType || detail?.txType || detail?.type || ""
  ).toLowerCase();
  return (
    action === "addlp" ||
    action === "removelp" ||
    action === "createpool" ||
    tx === "ammdeposit" ||
    tx === "ammwithdraw" ||
    tx === "ammcreate"
  );
}

export function tradePoolHint(detail = {}) {
  const trade = detail.trade || {};
  const raw = String(trade.pair || trade.pool || detail.pair || trade.quote || "").replace(/\s+/g, "").toUpperCase();
  if (raw.startsWith("XIO/")) return raw;
  if (raw && !raw.includes("/")) return `XIO/${raw}`;
  return "";
}

export function tradeXioVolume(detail = {}) {
  const trade = detail.trade || {};
  const action = String(trade.action || detail.action || "").toLowerCase();
  if (action !== "buy" && action !== "sell") return 0;
  const tx = detail.txjson || {};
  return (
    Number(trade.amount) ||
    Number(trade.xio) ||
    (isXioAmount(tx.TakerGets) ? issuedAmountValue(tx.TakerGets) : 0) ||
    (isXioAmount(tx.TakerPays) ? issuedAmountValue(tx.TakerPays) : 0) ||
    0
  );
}

export function rollingPoolVolume(catalog, held) {
  const catalogVol = Number(catalog);
  const heldVol = Number(held);
  const live = Number.isFinite(catalogVol) && catalogVol > 0 ? catalogVol : 0;
  const kept = Number.isFinite(heldVol) && heldVol > 0 ? heldVol : 0;
  return Math.max(live, kept);
}

const heldVolumeByKey = new Map();

export function rememberPoolVolume(key, catalog, held) {
  const id = String(key || "");
  const next = rollingPoolVolume(catalog, rollingPoolVolume(held, heldVolumeByKey.get(id)));
  if (id && next > 0) heldVolumeByKey.set(id, next);
  return next;
}

export function resetHeldPoolVolumes() {
  heldVolumeByKey.clear();
}

export function applyTradePoolVolume(pool, detail = {}) {
  if (!pool) return pool;
  const add = tradeXioVolume(detail);
  if (!(add > 0)) return pool;
  const pair = tradePoolHint(detail);
  if (pair && ammPoolName(pool) !== pair) return pool;
  const next = rollingPoolVolume(pool.volume24h, 0) + add;
  return {
    ...pool,
    volume24h: next,
    volume24hXio: next,
    volumeUnit: "xio",
    volumeSource: "trade",
  };
}
