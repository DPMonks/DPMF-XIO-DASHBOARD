export const AMM_LEVEL_BUMP = 0.0025;
export const AMM_CURVE_LEVELS = 20;

function feeRate(tradingFee) {
  const raw = Number(tradingFee);
  return raw > 0 ? raw / 100_000 : 0;
}

export function ammSpot(reserveBase, reserveQuote) {
  const x0 = Number(reserveBase);
  const y0 = Number(reserveQuote);
  if (!(x0 > 0) || !(y0 > 0)) return 0;
  return y0 / x0;
}

// How much XIO the AMM trades to move spot to targetPrice.
// Bid walk (price below spot): AMM buys XIO — opposing a native ask.
// Ask walk (price above spot): AMM sells XIO — opposing a native bid.
export function ammSizeToPrice({
  reserveBase,
  reserveQuote,
  targetPrice,
  tradingFee = 1000,
} = {}) {
  const x0 = Number(reserveBase);
  const y0 = Number(reserveQuote);
  const price = Number(targetPrice);
  const spot = ammSpot(x0, y0);
  if (!(x0 > 0) || !(y0 > 0) || !(price > 0) || !(spot > 0)) {
    return { side: null, base_size: 0, quote_size: 0, spot: spot || 0 };
  }
  if (Math.abs(price - spot) / spot < 1e-12) {
    return { side: null, base_size: 0, quote_size: 0, spot };
  }

  const k = x0 * y0;
  const nextX = Math.sqrt(k / price);
  const nextY = k / nextX;
  const fee = feeRate(tradingFee);

  if (price > spot) {
    const dx = x0 - nextX;
    const dy = nextY - y0;
    if (!(dx > 0) || !(dy > 0)) {
      return { side: null, base_size: 0, quote_size: 0, spot };
    }
    return {
      side: "ask",
      base_size: dx,
      quote_size: dy * (1 + fee),
      spot,
    };
  }

  const dx = nextX - x0;
  const dy = y0 - nextY;
  if (!(dx > 0) || !(dy > 0)) {
    return { side: null, base_size: 0, quote_size: 0, spot };
  }
  return {
    side: "bid",
    base_size: dx,
    quote_size: dy * (1 - fee),
    spot,
  };
}

export function ammImpliedLevels({
  reserveBase,
  reserveQuote,
  tradingFee = 1000,
  steps = AMM_CURVE_LEVELS,
  stepBps = 12.5,
} = {}) {
  const spot = ammSpot(reserveBase, reserveQuote);
  if (!(spot > 0) || !(steps > 0)) {
    return { bids: [], asks: [], price: null };
  }

  const bids = [];
  const asks = [];
  let prevBid = 0;
  let prevAsk = 0;

  for (let i = 1; i <= steps; i += 1) {
    const bidPrice = spot * (1 - (stepBps * i) / 10_000);
    const askPrice = spot * (1 + (stepBps * i) / 10_000);
    const bidFill = ammSizeToPrice({
      reserveBase,
      reserveQuote,
      targetPrice: bidPrice,
      tradingFee,
    });
    const askFill = ammSizeToPrice({
      reserveBase,
      reserveQuote,
      targetPrice: askPrice,
      tradingFee,
    });
    const bidInc = bidFill.base_size - prevBid;
    const askInc = askFill.base_size - prevAsk;
    prevBid = bidFill.base_size;
    prevAsk = askFill.base_size;
    if (bidInc > 0 && bidPrice > 0) {
      bids.push({
        level: i,
        side: "bid",
        price: bidPrice,
        source: "amm",
        base_size: bidInc,
        quote_size: bidInc * bidPrice,
        amm_through: bidFill.base_size,
        amm_opposing: 0,
      });
    }
    if (askInc > 0 && askPrice > 0) {
      asks.push({
        level: i,
        side: "ask",
        price: askPrice,
        source: "amm",
        base_size: askInc,
        quote_size: askInc * askPrice,
        amm_through: askFill.base_size,
        amm_opposing: 0,
      });
    }
  }

  return { bids, asks, price: spot };
}

export function measureAmmAgainstDex(rows, reserves = {}, tapeSide = "bid") {
  const reserveBase = Number(
    reserves.reserveBase ?? reserves.reserve_asset ?? reserves.reserve_xio ?? 0
  );
  const reserveQuote = Number(
    reserves.reserveQuote ?? reserves.reserve_currency ?? reserves.reserve_quote ?? 0
  );
  const tradingFee = reserves.tradingFee ?? reserves.trading_fee ?? 1000;
  const side = String(tapeSide).toLowerCase() === "ask" ? "ask" : "bid";

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const fill = ammSizeToPrice({
      reserveBase,
      reserveQuote,
      targetPrice: row?.price,
      tradingFee,
    });
    const opposing = side === "bid" ? fill.side === "ask" : fill.side === "bid";
    const through = side === "bid" ? fill.side === "bid" : fill.side === "ask";
    return {
      ...row,
      source:
        row?.source === "amm" || row?.source === "bridge"
          ? row.source
          : row?.source || "dex",
      amm_opposing: opposing ? fill.base_size : 0,
      amm_through: through ? fill.base_size : 0,
    };
  });
}

// Kept for tests of the constant-product walk. The tape no longer uses this
// as fake buy/sell orders — equal dx rungs look like a perfect book.
export function ammCurveLevels({
  reserveBase,
  reserveQuote,
  tradingFee = 1000,
  steps = AMM_CURVE_LEVELS,
  bump = AMM_LEVEL_BUMP,
} = {}) {
  const x0 = Number(reserveBase);
  const y0 = Number(reserveQuote);
  if (!(x0 > 0) || !(y0 > 0)) {
    return { bids: [], asks: [], price: null };
  }

  const k = x0 * y0;
  const fee = feeRate(tradingFee);
  const spot = y0 / x0;

  function walk(side) {
    const rows = [];
    let x = x0;
    let y = y0;
    let cumulativeBase = 0;
    let cumulativeQuote = 0;

    for (let i = 0; i < steps; i += 1) {
      const dx = x0 * bump;
      let dy;
      if (side === "ask") {
        if (dx >= x * 0.4) break;
        const nextX = x - dx;
        const nextY = k / nextX;
        dy = (nextY - y) * (1 + fee);
        x = nextX;
        y = nextY;
      } else {
        const nextX = x + dx;
        const nextY = k / nextX;
        dy = (y - nextY) * (1 - fee);
        x = nextX;
        y = nextY;
      }
      if (!(dy > 0) || !(dx > 0)) break;
      cumulativeBase += dx;
      cumulativeQuote += dy;
      rows.push({
        level: i + 1,
        bump,
        side,
        price: dy / dx,
        source: "amm",
        base_size: dx,
        quote_size: dy,
        cumulative_base: cumulativeBase,
        cumulative_quote: cumulativeQuote,
      });
    }
    return rows;
  }

  return {
    bids: walk("bid"),
    asks: walk("ask"),
    price: spot,
  };
}
