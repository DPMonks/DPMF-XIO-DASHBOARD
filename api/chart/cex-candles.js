import {loadCexXrpUsdCandles} from "../../server/cexOhlc.js";

export const maxDuration = 20;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const interval = url.searchParams.get("interval") || url.searchParams.get("tf") || "15m";
    const limit = Number(url.searchParams.get("limit") || 500);
    const endMs = Number(url.searchParams.get("end") || Date.now());
    const payload = await loadCexXrpUsdCandles({
      interval,
      limit: Number.isFinite(limit) ? limit : 500,
      endMs: Number.isFinite(endMs) && endMs > 0 ? endMs : Date.now(),
    });
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    res.status(200).json({
      ok: true,
      pair: payload.pair,
      quote: "USD",
      note: "RLUSD ~ USD; CEX tape for visual OHLC. Book overlays stay XRPL DEX.",
      source: payload.source,
      label: payload.label,
      interval: payload.interval,
      fetchId: payload.fetchId,
      resampleTo: payload.resampleTo,
      count: payload.count,
      candles: payload.candles,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error?.message || "CEX OHLC unavailable",
      code: error?.code || "CEX_OHLC_UNAVAILABLE",
    });
  }
}
