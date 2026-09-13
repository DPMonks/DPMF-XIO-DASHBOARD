import {useEffect, useMemo, useRef, useState} from "react";
import {Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {getChartHistory, getXioFlows} from "../api/indexer";
import {collapseUnchangedPlot, dailyLastPoints, downsampleSeries, metricNumber} from "../activityHistory";
import {XIO_ISSUED_AT} from "../constants/ledger";
import {formatDay, formatNumber, formatWhen, shortAddress} from "../utils/format";
import {DRIFT_MS, driftPlot, easeInOutCubic, lerpPair} from "../utils/lineDrift";
import {LIST_PAGE_SIZE, pageSlice} from "../utils/pagination";
import {useI18n} from "../i18n/useI18n";
import PaginationBar from "./PaginationBar";
import Skeleton from "./Skeleton";

const METRICS = ["holders", "trustlines", "traders"];
const RANGES = ["1H", "4H", "12H", "24H", "1W", "1M", "3M", "1Y", "Max"];
const RANGE_MS = {
  "1H": 3600000,
  "4H": 4 * 3600000,
  "12H": 12 * 3600000,
  "24H": 86400000,
  "1W": 7 * 86400000,
  "1M": 30 * 86400000,
  "3M": 90 * 86400000,
  "1Y": 365 * 86400000,
};
function toTs(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function withTs(row) {
  const ts = toTs(row.timestamp);
  return ts == null ? null : { ...row, ts };
}

function windowedSeries(rows, range, now, metric) {
  const all = rows
    .map(withTs)
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
  if (!all.length) return [];

  let lastKnown = null;
  const filled = all.map((row) => {
    const value = metricNumber(row, metric);
    if (value != null) lastKnown = value;
    return { ...row, plot: lastKnown };
  });

  const usable = filled.filter((row) => Number.isFinite(row.plot));
  if (!usable.length) return [];
  if (range === "Max") return usable;

  const windowMs = RANGE_MS[range];
  if (!windowMs) return usable;
  const start = now - windowMs;
  const inside = usable.filter((row) => row.ts >= start && row.ts <= now);
  const lastBefore = [...usable].reverse().find((row) => row.ts < start);
  const seed = lastBefore || (inside[0] ? null : usable[usable.length - 1]);
  const out = [...inside];

  if (seed) {
    out.unshift({ ...seed, timestamp: new Date(start).toISOString(), ts: start });
  } else if (out[0] && out[0].ts > start) {
    out.unshift({ ...out[0], timestamp: new Date(start).toISOString(), ts: start });
  }

  const last = out[out.length - 1];
  if (last && last.ts < now) {
    out.push({ ...last, timestamp: new Date(now).toISOString(), ts: now });
  }
  return collapseUnchangedPlot(out.filter((row) => Number.isFinite(row.plot)));
}

function yDomain(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return [0, 1];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) {
    const pad = Math.abs(min) * 0.08 || 1;
    return [Math.max(0, min - pad), max + pad];
  }
  const pad = (max - min) * 0.08;
  return [Math.max(0, min - pad), max + pad];
}

function isIntraday(range) {
  return range === "1H" || range === "4H" || range === "12H" || range === "24H";
}

function metricValue(row, metric) {
  return metricNumber(row, metric);
}

function HistoryPager({ rows, renderHead, renderRow }) {
  const [page, setPage] = useState(1);
  const { currentPage, totalPages, rows: pageRows } = pageSlice(rows, page);

  return (
    <>
      <div className="rich-table-wrap history-scroll">
        <table className="rich-table compact">
          <thead>{renderHead()}</thead>
          <tbody>
            {pageRows.map((row, index) =>
              renderRow(row, (currentPage - 1) * LIST_PAGE_SIZE + index)
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar page={currentPage} totalPages={totalPages} onPage={setPage} />
    </>
  );
}

export default function ActivityChart() {
  const { t, locale } = useI18n();
  const [data, setData] = useState([]);
  const [trades, setTrades] = useState([]);
  const [metric, setMetric] = useState("holders");
  const [ranges, setRanges] = useState({
    holders: "24H",
    trustlines: "24H",
    traders: "24H",
  });
  const range = ranges[metric] || "24H";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [rows, tradeRows] = await Promise.all([
          getChartHistory(),
          getXioFlows().catch(() => []),
        ]);
        if (!cancelled) {
          setData(rows);
          setTrades(tradeRows);
          setNow(Date.now());
          setError(rows.length || tradeRows.length ? null : t.noHistory);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timeout = setTimeout(load, 800);
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearInterval(id);
    };
  }, [t.noHistory]);

  const chartRows = useMemo(
    () => downsampleSeries(windowedSeries(data, range, now, metric)),
    [data, range, metric, now]
  );
  const xRange = useMemo(() => {
    if (range === "Max") {
      const issued = new Date(XIO_ISSUED_AT).getTime();
      const first = chartRows[0]?.ts;
      const last = chartRows[chartRows.length - 1]?.ts || now;
      if (!first) return [issued, now];
      return [Math.min(issued, first), last];
    }
    return [now - RANGE_MS[range], now];
  }, [chartRows, range, now]);

  const targetY = useMemo(
    () => yDomain(chartRows.map((row) => Number(row.plot))),
    [chartRows]
  );
  const [displayRows, setDisplayRows] = useState(chartRows);
  const [displayX, setDisplayX] = useState(xRange);
  const [displayY, setDisplayY] = useState(targetY);
  const displayRef = useRef({
    rows: chartRows,
    x: xRange,
    y: targetY,
    metric,
    range,
  });

  useEffect(() => {
    const nextX = xRange;
    const nextY = targetY;
    const prev = displayRef.current;
    const shouldDrift =
      prev.rows.length > 0 &&
      chartRows.length > 0 &&
      (prev.metric !== metric || prev.range !== range);

    if (!shouldDrift) {
      setDisplayRows(chartRows);
      setDisplayX(nextX);
      setDisplayY(nextY);
      displayRef.current = { rows: chartRows, x: nextX, y: nextY, metric, range };
      return undefined;
    }

    const fromRows = prev.rows;
    const fromX = prev.x || nextX;
    const fromY = prev.y || nextY;
    const started = performance.now();
    let frame = 0;

    const step = (stamp) => {
      const t = Math.min(1, (stamp - started) / DRIFT_MS);
      const eased = easeInOutCubic(t);
      const rows = t >= 1 ? chartRows : driftPlot(fromRows, chartRows, t);
      const x = t >= 1 ? nextX : lerpPair(fromX, nextX, eased);
      const y = t >= 1 ? nextY : lerpPair(fromY, nextY, eased);
      setDisplayRows(rows);
      setDisplayX(x);
      setDisplayY(y);
      displayRef.current = { rows, x, y, metric, range };
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [chartRows, xRange, targetY, metric, range]);

  const historyRows = useMemo(() => {
    const scoped = data
      .map(withTs)
      .filter((row) => row && metricValue(row, metric) != null);
    const visible = dailyLastPoints(scoped)
      .sort((a, b) => b.ts - a.ts)
      .map((row, index, list) => {
        const previous = list[index + 1];
        const value = metricValue(row, metric);
        const prior = previous ? metricValue(previous, metric) : null;
        const change = prior != null && Number.isFinite(prior) ? value - prior : null;
        return { ...row, value, previous: prior, change };
      });
    return visible;
  }, [data, metric]);

  const visibleTrades = useMemo(() => {
    const windowMs = RANGE_MS[range];
    const start = range === "Max" ? 0 : now - windowMs;
    return trades.filter((row) => {
      const ts = toTs(row.timestamp);
      return ts != null && ts >= start;
    });
  }, [trades, range, now]);

  const metrics = METRICS;

  return (
    <div className="activity-chart-container">
      <div className="activity-controls">
        <div className="tabs">
          {metrics.map((item) => (
            <button
              key={item}
              type="button"
              className={item === metric ? "tab active" : "tab"}
              onClick={() => setMetric(item)}
            >
              {(t[item] || item).toUpperCase()}
            </button>
          ))}
        </div>
        <div className="ranges">
          {RANGES.map((item) => (
            <button
              key={item}
              type="button"
              className={item === range ? "range active" : "range"}
              onClick={() => {
                setRanges((current) => ({ ...current, [metric]: item }));
                setNow(Date.now());
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {loading && data.length === 0 ? (
        <Skeleton height={280} />
      ) : error && data.length === 0 && !trades.length ? (
        <p className="error-message">{error}</p>
      ) : (
        <>
          <div className="activity-plot is-live">
            {!chartRows.length && !displayRows.length ? (
              <p className="empty-message">{t.noRangeData}</p>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={displayRows.length ? displayRows : chartRows}>
                <XAxis
                  type="number"
                  dataKey="ts"
                  domain={displayX}
                  tick={{ fill: "#7f8ba8", fontSize: 11 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    if (isIntraday(range)) {
                      return date.toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    }
                    if (range === "1Y" || range === "Max") {
                      return date.toLocaleDateString(locale, {
                        month: "short",
                        year: "2-digit",
                      });
                    }
                    return date.toLocaleDateString(locale, {
                      day: "2-digit",
                      month: "short",
                    });
                  }}
                />
                <YAxis
                  tick={{ fill: "#7f8ba8", fontSize: 11 }}
                  width={64}
                  domain={displayY}
                  allowDecimals={false}
                  tickFormatter={(value) =>
                    formatNumber(value, locale, { maximumFractionDigits: 0 })
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: "#0b0f1a",
                    border: "1px solid #1f2535",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  labelFormatter={(value) => formatWhen(value, locale)}
                  formatter={(value) => [
                    formatNumber(value, locale, { maximumFractionDigits: 0 }),
                    t[metric] || metric,
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="plot"
                  stroke="#00ff6a"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 5, fill: "#00ff6a", stroke: "#c770ff", strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                  className="activity-line"
                />
              </LineChart>
            </ResponsiveContainer>
            )}
          </div>
          {chartRows.length ? (
            <p className="orderbook-asof activity-source">
              {metric === "traders" ? t.tradersFromIssuance : t.historyFromIssuance}
            </p>
          ) : null}

          <div className="history-block">
            <h3 className="history-title">{t.history}</h3>
            <HistoryPager
              key={`hist-${metric}`}
              rows={historyRows}
              renderHead={() => (
                <tr>
                  <th>{t.updated}</th>
                  <th>{t[metric] || metric}</th>
                  <th>{t.previous}</th>
                  <th>{t.change}</th>
                  <th>{t.holders}</th>
                  <th>{t.trustlines}</th>
                  <th>{t.traders}</th>
                </tr>
              )}
              renderRow={(row) => (
                <tr key={`hist-${row.timestamp}-${row.ts}`}>
                  <td>{formatDay(row.timestamp, locale)}</td>
                  <td className="col-num">
                    {formatNumber(row.value, locale, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="col-num">
                    {row.previous == null
                      ? "—"
                      : formatNumber(row.previous, locale, { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    className={`col-num ${
                      row.change > 0 ? "trade-buy" : row.change < 0 ? "trade-sell" : ""
                    }`}
                  >
                    {row.change == null
                      ? "—"
                      : formatNumber(row.change, locale, { maximumFractionDigits: 6 })}
                  </td>
                  <td className="col-num">{formatNumber(row.holders, locale)}</td>
                  <td className="col-num">{formatNumber(row.trustlines, locale)}</td>
                  <td className="col-num">{formatNumber(row.traders, locale)}</td>
                </tr>
              )}
            />
          </div>

          <div className="history-block">
            <h3 className="history-title">{t.xioFlows}</h3>
            {visibleTrades.length ? (
              <>
              <p className="orderbook-asof">{t.xioTradesFromAmm}</p>
              <HistoryPager
                key={`flows-${range}`}
                rows={visibleTrades}
                renderHead={() => (
                  <tr>
                    <th>{t.updated}</th>
                    <th>{t.side}</th>
                    <th>{t.xioAmount}</th>
                    <th>{t.address}</th>
                  </tr>
                )}
                renderRow={(row, index) => (
                  <tr key={`flow-${row.timestamp}-${row.account || row.pool}-${index}`}>
                    <td>
                      {isIntraday(range)
                        ? formatWhen(row.timestamp, locale)
                        : formatDay(row.timestamp, locale)}
                    </td>
                    <td className={row.side === "sell" ? "trade-sell" : "trade-buy"}>
                      {(row.side === "sell" ? t.sell : t.buy).toUpperCase()}
                    </td>
                    <td className={`col-num ${row.side === "sell" ? "trade-sell" : "trade-buy"}`}>
                      {formatNumber(row.xio, locale, { maximumFractionDigits: 6 })}
                    </td>
                    <td title={row.account || row.pool || ""}>
                      {row.account ? shortAddress(row.account) : row.pool || "—"}
                    </td>
                  </tr>
                )}
              />
              </>
            ) : (
              <p className="empty-message">{t.noXioFlows}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
