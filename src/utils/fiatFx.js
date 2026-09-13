export function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function xioUsdFromXrpPool(live = {}, xrpUsd) {
  const xio = positive(live.reserve_xio ?? live.reserve_asset);
  const xrp = positive(live.reserve_currency ?? live.reserve_quote);
  const fx = positive(xrpUsd);
  if (!(xio > 0) || !(xrp > 0) || !(fx > 0)) return 0;
  return (xrp / xio) * fx;
}

export function xioUsdFromRlusdPool(live = {}, rlusdUsd = 1) {
  const xio = positive(live.reserve_xio ?? live.reserve_asset);
  const rlusd = positive(live.reserve_currency ?? live.reserve_quote);
  const fx = positive(rlusdUsd) || 1;
  if (!(xio > 0) || !(rlusd > 0)) return 0;
  return (rlusd / xio) * fx;
}

export function pickXioUsd(marks = {}) {
  return (
    positive(marks.ammXrp) ||
    positive(marks.ammRlusd) ||
    positive(marks.xrplTo) ||
    positive(marks.dex) ||
    0
  );
}

export function usdFxFromSources(sources = {}) {
  const usd = positive(sources.usd ?? sources.xrpUsd);
  return {
    usdGbp:
      positive(sources.usdGbp) ||
      (usd && positive(sources.gbp ?? sources.xrpGbp) ? Number(sources.gbp ?? sources.xrpGbp) / usd : 0),
    usdEur:
      positive(sources.usdEur) ||
      (usd && positive(sources.eur ?? sources.xrpEur) ? Number(sources.eur ?? sources.xrpEur) / usd : 0),
    usdJpy:
      positive(sources.usdJpy) ||
      (usd && positive(sources.jpy ?? sources.xrpJpy) ? Number(sources.jpy ?? sources.xrpJpy) / usd : 0),
  };
}

export function applyUsdFx(xioUsd, fx = {}) {
  const usd = positive(xioUsd);
  if (!usd) return { xioGbp: 0, xioEur: 0, xioJpy: 0 };
  return {
    xioGbp: positive(fx.usdGbp) ? usd * fx.usdGbp : 0,
    xioEur: positive(fx.usdEur) ? usd * fx.usdEur : 0,
    xioJpy: positive(fx.usdJpy) ? usd * fx.usdJpy : 0,
  };
}

export function fillMissingXioFiat(prices = {}) {
  const next = { ...prices };
  const xioUsd = positive(next.xioUsd ?? next.recorded_price ?? next.price);
  const fx = usdFxFromSources(next);
  if (!positive(next.usdGbp) && fx.usdGbp) next.usdGbp = fx.usdGbp;
  if (!positive(next.usdEur) && fx.usdEur) next.usdEur = fx.usdEur;
  if (!positive(next.usdJpy) && fx.usdJpy) next.usdJpy = fx.usdJpy;
  if (xioUsd && !positive(next.xioUsd)) {
    next.xioUsd = xioUsd;
    next.recorded_price = next.recorded_price || xioUsd;
    next.price = next.price || xioUsd;
  }
  const attached = applyUsdFx(xioUsd, next);
  if (!positive(next.xioGbp)) next.xioGbp = attached.xioGbp;
  if (!positive(next.xioEur)) next.xioEur = attached.xioEur;
  if (!positive(next.xioJpy)) next.xioJpy = attached.xioJpy;
  if (xioUsd && positive(next.usdGbp) && !positive(next.xrpGbp) && positive(next.xrpUsd)) {
    next.xrpGbp = next.xrpUsd * next.usdGbp;
  }
  if (xioUsd && positive(next.usdEur) && !positive(next.xrpEur) && positive(next.xrpUsd)) {
    next.xrpEur = next.xrpUsd * next.usdEur;
  }
  if (xioUsd && positive(next.usdJpy) && !positive(next.xrpJpy) && positive(next.xrpUsd)) {
    next.xrpJpy = next.xrpUsd * next.usdJpy;
  }
  return next;
}

export function pricesNeedFiat(prices = {}) {
  if (!positive(prices.xioUsd ?? prices.recorded_price ?? prices.price)) return true;
  return !(positive(prices.xioGbp) && positive(prices.xioEur));
}
