import {poolAssetTrustlineId, poolQuoteTicker} from "./ammPools.js";
import {xioTrustSetTxjson} from "./constants/ledger.js";
import {isLpCurrency, lpTrustSetTxjson, poolForQuote, quoteTrustSetTxjson, resolveQuote} from "./xaman/tradeTx.js";

export function poolQuote(pool) {
  const ticker =
    String(pool?.quote || "")
      .replace(/^XIO\//i, "")
      .toUpperCase() || poolAssetTrustlineId(pool);
  return resolveQuote(ticker === "XIO" ? "XRP" : ticker, {
    quote_issuer: pool?.quote_issuer || pool?.issuer || pool?.quoteIssuer || null,
    quote_hex: pool?.quote_hex || pool?.hex || pool?.quoteHex || null,
  });
}

export function assetTrustTxjson(pool, account) {
  if (poolAssetTrustlineId(pool) === "XIO") return xioTrustSetTxjson(account);
  return quoteTrustSetTxjson(account, poolQuote(pool));
}

export function lpTrustSpec(pool) {
  const lpHex = pool?.lp_currency || pool?.lp_currency_hex;
  if (pool?.amm_account && isLpCurrency(lpHex)) {
    return { amm: pool.amm_account, lpCurrency: lpHex };
  }
  const quoteId = poolQuoteTicker(pool);
  const spec = poolForQuote(poolQuote(pool), [pool], pool);
  if (quoteId !== "XRP" && spec.pair === "XIO/XRP") return null;
  return spec;
}

export function lpTrustTxjson(pool, account) {
  return lpTrustSetTxjson(account, lpTrustSpec(pool) || {});
}

export function poolCardTrustActions(pool) {
  const assetId = poolAssetTrustlineId(pool);
  return {
    assetId,
    assetLabel: `${assetId} Trustline`,
    lpLabel: "LP Trustline",
    showAssetTrustline: true,
    showLpTrustline: true,
  };
}
