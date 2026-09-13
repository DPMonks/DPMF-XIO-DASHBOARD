const DUST = 1e-6;

export function inferTradesFromHistory(rows) {
  const prev = new Map();
  const trades = [];
  for (const row of rows || []) {
    const key = String(row.pool_name || row.pool || "pool");
    const asset = Number(row.reserve_asset || 0);
    const quote = Number(row.reserve_currency || 0);
    const last = prev.get(key);
    if (last) {
      const dAsset = asset - last.asset;
      const dQuote = quote - last.quote;
      if (Math.abs(dAsset) > DUST || Math.abs(dQuote) > DUST) {
        const side = dAsset < 0 ? "buy" : dAsset > 0 ? "sell" : dQuote > 0 ? "buy" : "sell";
        trades.push({
          timestamp: row.timestamp,
          pool: key,
          side,
          xio: Math.abs(dAsset),
          quote: Math.abs(dQuote),
          price: Number(row.price || 0),
        });
      }
    }
    prev.set(key, { asset, quote });
  }
  return trades.reverse();
}

export function mergeTradePrints(primary = [], extra = []) {
  const seen = new Set();
  const out = [];
  for (const row of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(extra) ? extra : [])]) {
    if (!row) continue;
    const key = row.hash || `${row.timestamp}|${row.pool || row.pair}|${row.xio}|${row.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
}

export function traderSeriesFromTrades(trades) {
  const byHour = new Map();
  for (const row of trades || []) {
    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    const hour = new Date(Math.floor(ts / 3_600_000) * 3_600_000).toISOString();
    const current = byHour.get(hour) || {
      timestamp: hour,
      trades: 0,
      volume: 0,
      accounts: new Set(),
    };
    current.trades += 1;
    current.volume += Math.abs(Number(row.xio) || 0);
    if (row.account) current.accounts.add(row.account);
    byHour.set(hour, current);
  }
  return [...byHour.values()]
    .map((row) => ({
      timestamp: row.timestamp,
      trades: row.trades,
      traders: row.accounts.size || row.trades,
      volume: row.volume,
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
