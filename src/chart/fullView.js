export function fullViewPriceHeight(viewportH = 0, extras = {}) {
  const chrome = 156;
  const volume = extras.volume === false ? 0 : 80;
  const rsi = extras.rsi === false ? 0 : 80;
  return Math.max(240, Math.round(Number(viewportH) || 0) - chrome - volume - rsi);
}

/** Price pane height so HybridPlot fills a measured plot-wrap box. */
export function boxPriceHeight(boxH = 0, extras = {}) {
  const pad = 52; // PAD.t + PAD.b
  const volume = extras.volume === false ? 0 : 76;
  const rsi = extras.rsi === false ? 0 : extras.volume === false ? 76 : 80;
  return Math.max(220, Math.round(Number(boxH) || 0) - pad - volume - rsi);
}
