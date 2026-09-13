export const CHART_PAIRS = ["XIO/RLUSD", "XIO/XRP", "XRP/RLUSD", "XIO/XDX"];

export const INTERVALS = [
  { id: "1m", label: "1m", ms: 60_000 },
  { id: "3m", label: "3m", ms: 180_000 },
  { id: "5m", label: "5m", ms: 300_000 },
  { id: "15m", label: "15m", ms: 900_000 },
  { id: "30m", label: "30m", ms: 1_800_000 },
  { id: "1h", label: "1H", ms: 3_600_000 },
  { id: "2h", label: "2H", ms: 7_200_000 },
  { id: "4h", label: "4H", ms: 14_400_000 },
  { id: "6h", label: "6H", ms: 21_600_000 },
  { id: "8h", label: "8H", ms: 28_800_000 },
  { id: "12h", label: "12H", ms: 43_200_000 },
  { id: "1D", label: "1D", ms: 86_400_000 },
  { id: "3D", label: "3D", ms: 3 * 86_400_000 },
  { id: "1W", label: "1W", ms: 7 * 86_400_000 },
  { id: "1M", label: "1M", ms: 30 * 86_400_000 },
];

export const RANGE_WINDOWS = {
  "1D": 1,
  "5D": 5,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "5Y": 365 * 5,
  Max: null,
};

export const DEFAULT_INTERVAL = "12h";
export const CHART_VISIBLE_BARS = 280;
export const CHART_MA_PAD = 200;

/** Bars of history before the visible window so MA/SMA lines cover the full view. */
export function maHistoryPad(periods = [], fallback = CHART_MA_PAD) {
  const list = (Array.isArray(periods) ? periods : [])
    .map((row) => Math.trunc(Number(row)))
    .filter((n) => n > 1);
  const need = list.length ? Math.max(...list) : 0;
  // Extra headroom so carry/weekend stripping still leaves a full period of seed closes.
  return Math.max(fallback, need > 0 ? need * 2 : fallback);
}

export function visibleBarsForInterval(id) {
  const ms = intervalMs(id);
  if (ms <= 60_000) return 90;
  if (ms <= 180_000) return 100;
  if (ms <= 300_000) return 108;
  if (ms <= 900_000) return 96;
  if (ms <= 1_800_000) return 96;
  if (ms <= 3_600_000) return 120;
  if (ms <= 7_200_000) return 120;
  if (ms <= 14_400_000) return 168;
  if (ms <= 21_600_000) return 180;
  return CHART_VISIBLE_BARS;
}

export function intervalMs(id) {
  return INTERVALS.find((row) => row.id === id)?.ms || 86_400_000;
}

export function isDailyOrLonger(id) {
  return id === "1D" || id === "3D" || id === "1W" || id === "1M" || id === "D" || id === "W";
}

// UTC buckets. Daily = 00:00 UTC. Weekly = Monday 00:00 UTC. Monthly = 1st 00:00 UTC.
export function bucketTime(ts, intervalId = "1D") {
  const time = Number(ts);
  if (!Number.isFinite(time)) return null;
  const id = String(intervalId || "1D");

  if (id === "1D" || id === "D") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  if (id === "1W" || id === "W") {
    const date = new Date(time);
    const day = date.getUTCDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - mondayOffset
    );
  }

  if (id === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  const ms = intervalMs(id);
  if (!(ms > 0)) return null;
  return Math.floor(time / ms) * ms;
}

export function tickMs(row) {
  if (row == null) return null;
  if (Number.isFinite(Number(row.t))) {
    const raw = Number(row.t);
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (Number.isFinite(Number(row.time))) {
    const raw = Number(row.time);
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const parsed = Date.parse(row.timestamp || row.date || row.as_of || "");
  return Number.isFinite(parsed) ? parsed : null;
}
