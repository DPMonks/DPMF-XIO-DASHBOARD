import {useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {getAmm, getLiquidPairAmm, getLiquidPairBook, getOrderbooks, getPrices, getWalletActivity, getWalletOffers, getXioFlows} from "../api/indexer";
import {api} from "../api";
import {CHART_PAIRS, DEFAULT_INTERVAL, INTERVALS, maHistoryPad, visibleBarsForInterval} from "../chart/intervals";
import {averagesForWindow, clampPanOffset, clampVisibleBars, futureBarsFromPan, liveSeriesGrew, MA_PERIODS, MA_TYPES, panAfterZoom, windowBars, ZOOM_BAR_MAX, ZOOM_BAR_MIN, zoomVisibleBars} from "../chart/candles";
import {RSI_OVERBOUGHT, RSI_OVERSOLD, RSI_PERIODS, rsiForWindow} from "../chart/indicators";
import {composePairCandles, lockedSnapshot} from "../chart/composeChart";
import {defaultCexLimit, fetchCexCandles, usesCexTape} from "../chart/cexCandles";
import {boxPriceHeight, fullViewPriceHeight} from "../chart/fullView";
import {quotePerXio} from "../chart/pairQuote";
import {ammRebalanceTrail, ammSupportResistanceRibbon, arbitrageWindow, bookBands, heatmapDots, liquidityPressure, liquidityWalls, microEvents, scalePriceView, shiftAfterPriceZoom, smartView, zoomPriceScale} from "../chart/overlays";
import {walletChartMarks} from "../chart/walletMarks";
import {buildDeskMarks, buildEstimateMarks, buildEstimateScenarioOverlay, deskMarkAskPrompt} from "../chart/aimMarks";
import {publishAimChatAsk} from "../context/aimChatAsk";
import {useChartAction, publishChartNarrate} from "../context/chartAction";
import {bookHeader, mergeOrderbookPayloads} from "../orderbook";
import {walletOrdersFromBooks} from "../wallet/composeWallet";
import {mergeWalletActivity, mergeWalletOrders, pendingFor, pendingFromExecution} from "../wallet/ledgerOrders";
import {useWallet} from "../context/useWallet";
import {buildChartSnapshot, publishChartSnapshot, releaseChartSnapshot, sameChartPair} from "../context/chartSnapshot";
import {formatQuotePerBase, formatPercent} from "../utils/format";
import {isPhoneDevice} from "../xaman/xamanClient";
import {useI18n} from "../i18n/useI18n";
import {moveDrawingHandle, nextDrawingState, patchDrawingStyle, toggleTool, toolAfterDrawing} from "../chart/drawings";
import {approxPlotClientPoint, clientToOverlay, drawingPlacementPoints, runAiCursorScript, toolIdForDrawing} from "../chart/aiCursorDemo";
import ChartErrorBoundary from "./ChartErrorBoundary";
import ChartTools from "./ChartTools";
import AiChartCursor from "./AiChartCursor";
import HybridPlot from "./HybridPlot";
import TradeBar from "./TradeBar";
import "./HybridChart.css";

function MaTypeMenu({ value, t, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = MA_TYPES.find((row) => row.id === value) || MA_TYPES[0];

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!box.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  return (
    <div className="hybrid-ma-select" ref={box}>
      <button
        type="button"
        className={open ? "hybrid-ma-select-btn is-open" : "hybrid-ma-select-btn"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
      >
        <span>{current.short}</span>
        <svg className="hybrid-ma-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 L6 8 L9 4.5" />
        </svg>
      </button>
      {open ? (
        <ul className="hybrid-ma-menu" role="listbox">
          {MA_TYPES.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={row.id === value ? "active" : undefined}
                role="option"
                aria-selected={row.id === value}
                onClick={() => {
                  onChange(row.id);
                  setOpen(false);
                }}
              >
                {t[row.labelKey] || row.short}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function poolForPair(pools, pair) {
  const want = String(pair || "").toUpperCase();
  return (Array.isArray(pools) ? pools : []).find((row) => {
    const name = String(row.pool || row.pool_name || row.pair || "").toUpperCase();
    return name === want;
  });
}

export default function HybridChart({
  deskOrders = null,
  estimate = null,
  aimEmbed = false,
  initialPair = "XIO/RLUSD",
} = {}) {
  const { t, locale } = useI18n();
  const { walletAddress } = useWallet();
  const [pair, setPair] = useState(initialPair || "XIO/RLUSD");
  const [timeframe, setTimeframe] = useState(DEFAULT_INTERVAL);
  const [tool, setTool] = useState("cursor");
  const [drawColor, setDrawColor] = useState("#3d8bff");
  const [strokeWidth, setStrokeWidth] = useState(1);
  const [lineStyle, setLineStyle] = useState("solid");
  const [stayDraw, setStayDraw] = useState(false);
  const [magnet, setMagnet] = useState(false);
  const [hollow, setHollow] = useState(false);
  const [showArb, setShowArb] = useState(false);
  const [showAmmRibbon, setShowAmmRibbon] = useState(false);
  const [ammRibbonBps, setAmmRibbonBps] = useState(0);
  const [maType, setMaType] = useState("sma");
  const [maPeriods, setMaPeriods] = useState([50]);
  const [showVolume, setShowVolume] = useState(true);
  const [showLedgerOrders, setShowLedgerOrders] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [rsiOverbought, setRsiOverbought] = useState(70);
  const [rsiOversold, setRsiOversold] = useState(30);
  const [books, setBooks] = useState(null);
  const [ledgerOrders, setLedgerOrders] = useState([]);
  const [ledgerFills, setLedgerFills] = useState([]);
  const [pools, setPools] = useState([]);
  const [prices, setPrices] = useState({});
  const [trades, setTrades] = useState([]);
  const [sparkline, setSparkline] = useState([]);
  const [cexCandles, setCexCandles] = useState([]);
  const [cexMeta, setCexMeta] = useState({ source: "", label: "" });
  const [drawings, setDrawings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [now, setNow] = useState(0);
  const [panOffset, setPanOffset] = useState(0);
  const [barZoom, setBarZoom] = useState(null);
  const [priceZoom, setPriceZoom] = useState(1);
  const [priceShift, setPriceShift] = useState(0);
  const [loadedBars, setLoadedBars] = useState(() => visibleBarsForInterval(DEFAULT_INTERVAL) + maHistoryPad([50]));
  const [seriesMeta, setSeriesMeta] = useState({ len: 0, head: 0 });
  const windowKey = `${pair}:${timeframe}`;
  const [activeWindow, setActiveWindow] = useState(windowKey);
  const phone = isPhoneDevice();
  const [fullView, setFullView] = useState(false);
  const [estimateSide, setEstimateSide] = useState(null); // bull | bear | null
  const [plotMode, setPlotMode] = useState("candles"); // candles | ribbon
  const [aiCursor, setAiCursor] = useState({ visible: false, x: 0, y: 0, phase: "", tool: null });
  const bodyRef = useRef(null);
  const plotWrapRef = useRef(null);
  const aiRunRef = useRef(null);
  const aiSkipRef = useRef(false);
  const chartAction = useChartAction();
  const [viewH, setViewH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 700));

  useEffect(() => {
    if (!chartAction || !chartAction.seq) return;
    const actionPair = chartAction.pair ? String(chartAction.pair).replace(/\s+/g, "").toUpperCase() : null;
    // Only apply Commander actions to the currently selected pair tab.
    if (actionPair && !sameChartPair(actionPair, pair)) {
      return undefined;
    }
    if (chartAction.type === "show_estimate" && chartAction.side) {
      if (sameChartPair(pair, "XRP/RLUSD")) setEstimateSide(chartAction.side);
    } else if (chartAction.type === "clear_estimate" || chartAction.type === "clear_ai") {
      setEstimateSide(null);
      if (chartAction.type === "clear_ai") {
        setDrawings((rows) => rows.filter((row) => !(row && (row.commander || row.source === "commander"))));
      }
    }
    // ask_side is chat-only; no overlay change until side chosen
    if (chartAction.type !== "lay_tools") return undefined;

    const drawingsIn = Array.isArray(chartAction.drawings) ? chartAction.drawings : [];
    if (chartAction.show_estimate && chartAction.side) {
      setEstimateSide(chartAction.side);
    }

    let cancelled = false;
    aiSkipRef.current = false;
    if (aiRunRef.current?.cancel) {
      try {
        aiRunRef.current.cancel();
      } catch {
        /* ignore */
      }
    }

    // Drop previous Commander prediction set, keep user drawings.
    setDrawings((rows) => rows.filter((row) => !(row && (row.commander || row.source === "commander"))));

    const bodyEl = bodyRef.current;
    const plotEl = plotWrapRef.current?.querySelector("svg") || plotWrapRef.current;
    if (!bodyEl || !drawingsIn.length) {
      if (drawingsIn.length) {
        setDrawings((rows) => [
          ...rows.filter((row) => !(row && (row.commander || row.source === "commander"))),
          ...drawingsIn.map((row) => ({ ...row, commander: true, source: "commander" })),
        ]);
      }
      return undefined;
    }

    const startRect = bodyEl.getBoundingClientRect();
    const start = { x: 24, y: 48 };
    setAiCursor({ visible: true, x: start.x, y: start.y, phase: "wake", tool: null });

    function onUserSkip() {
      aiSkipRef.current = true;
      if (aiRunRef.current?.cancel) aiRunRef.current.cancel();
    }
    bodyEl.addEventListener("pointerdown", onUserSkip, { once: true });

    (async () => {
      const placed = [];
      const narrateSteps = Array.isArray(chartAction.narrate_steps) ? chartAction.narrate_steps : [];
      const narrateById = Object.fromEntries(narrateSteps.filter((n) => n?.id).map((n) => [n.id, n]));
      const speakStep = (id, fallback) => {
        const step = narrateById[id] || (fallback ? { id, text: fallback } : null);
        if (step?.text) {
          try {
            publishChartNarrate(step);
          } catch {
            /* ignore */
          }
        }
      };
      if (narrateById.open) speakStep("open");
      for (const row of drawingsIn) {
        if (cancelled || aiSkipRef.current) break;
        const toolId = toolIdForDrawing(row);
        speakStep(`tool:${toolId}`, `Selecting the ${toolId} tool.`);
        setAiCursor((cur) => ({ ...cur, phase: "tool", tool: toolId }));
        setTool(toolId === "hline" || toolId === "fib" || toolId === "fibext" || toolId === "trend" ? toolId : toolId);

        const toolBtn =
          bodyEl.querySelector(`[data-tool-id="${toolId}"]`) ||
          bodyEl.querySelector(`[data-tool-group="${toolId === "fib" || toolId === "fibext" ? "fib" : toolId === "hline" ? "lines" : "lines"}"]`);
        const steps = [];
        const fromOverlay = { x: start.x, y: start.y };
        if (toolBtn) {
          const br = toolBtn.getBoundingClientRect();
          const toClient = { x: br.left + br.width / 2, y: br.top + br.height / 2 };
          const to = clientToOverlay(bodyEl, toClient) || fromOverlay;
          steps.push({ type: "move", from: fromOverlay, to, ms: 420 });
          steps.push({ type: "wait", ms: 160 });
        }

        const points = drawingPlacementPoints(row);
        let lastOverlay = fromOverlay;
        let pointIdx = 0;
        for (const point of points) {
          const anchorId =
            pointIdx === 0 ? `anchor:${toolId}:a` : pointIdx === 1 ? `anchor:${toolId}:b` : `anchor:${toolId}:c`;
          speakStep(
            anchorId,
            pointIdx === 0 ? "Anchoring the first swing." : pointIdx === 1 ? "Anchoring the second swing." : "Anchoring the extension point."
          );
          pointIdx += 1;
          const client = approxPlotClientPoint(plotEl, candles, view, point, plotHeight);
          const to = clientToOverlay(bodyEl, client) || lastOverlay;
          steps.push({ type: "move", from: lastOverlay, to, ms: 520 });
          steps.push({ type: "wait", ms: 140 });
          lastOverlay = to;
        }
        steps.push({ type: "wait", ms: 80 });

        const run = runAiCursorScript(steps, {
          onFrame: ({ x, y }) => {
            if (cancelled) return;
            setAiCursor((cur) => ({ ...cur, visible: true, x, y, phase: "draw", tool: toolId }));
          },
        });
        aiRunRef.current = run;
        await run.done;
        if (cancelled || aiSkipRef.current) break;
        placed.push({ ...row, commander: true, source: "commander" });
        setDrawings((rows) => {
          const kept = rows.filter((r) => !(r && (r.commander || r.source === "commander")));
          return [...kept, ...placed];
        });
      }

      if (aiSkipRef.current || cancelled) {
        setDrawings((rows) => {
          const kept = rows.filter((r) => !(r && (r.commander || r.source === "commander")));
          return [...kept, ...drawingsIn.map((row) => ({ ...row, commander: true, source: "commander" }))];
        });
      }
      speakStep("close");
      try {
        publishChartNarrate({ id: "done", text: "Tools laid. Estimate by REMOVED-AI-Matrix, not guaranteed." });
      } catch {
        /* ignore */
      }
      setTool("cursor");
      setPending(null);
      setAiCursor({ visible: false, x: 0, y: 0, phase: "", tool: null });
      bodyEl.removeEventListener("pointerdown", onUserSkip);
    })();

    return () => {
      cancelled = true;
      if (aiRunRef.current?.cancel) aiRunRef.current.cancel();
    };
    // candles/view/plotHeight intentionally read fresh at effect start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartAction, pair]);

  useEffect(() => {
    if (!usesCexTape(pair)) {
      setCexCandles([]);
      setCexMeta({ source: "", label: "" });
      return undefined;
    }
    let cancelled = false;
    async function loadCex() {
      try {
        const want = defaultCexLimit(timeframe, loadedBars);
        const payload = await fetchCexCandles({ interval: timeframe, limit: want });
        if (cancelled) return;
        setCexCandles(payload.candles || []);
        setCexMeta({ source: payload.source || "", label: payload.label || "" });
      } catch {
        if (!cancelled) {
          setCexCandles([]);
          setCexMeta({ source: "", label: "" });
        }
      }
    }
    const start = setTimeout(loadCex, 0);
    const id = setInterval(loadCex, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(start);
      clearInterval(id);
    };
  }, [pair, timeframe, loadedBars]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextBooks, nextPools, nextPrices, nextFlows, nextSpark, liquidBook, liquidAmm] =
          await Promise.all([
            getOrderbooks().catch(() => null),
            getAmm().catch(() => []),
            getPrices().catch(() => ({})),
            getXioFlows().catch(() => []),
            api.sparkline("XIO").catch(() => []),
            getLiquidPairBook("XRP/RLUSD").catch(() => null),
            getLiquidPairAmm("XRP/RLUSD").catch(() => null),
          ]);
        if (cancelled) return;
        let booksPayload = nextBooks;
        if (liquidBook) {
          booksPayload = mergeOrderbookPayloads(booksPayload || { pairs: [], books: {} }, {
            pairs: ["XRP/RLUSD"],
            books: { "XRP/RLUSD": liquidBook },
          });
        }
        if (liquidAmm && booksPayload?.books?.["XRP/RLUSD"]) {
          const ammPrice = Number(liquidAmm.price);
          booksPayload = {
            ...booksPayload,
            books: {
              ...booksPayload.books,
              "XRP/RLUSD": {
                ...booksPayload.books["XRP/RLUSD"],
                amm: {
                  price: ammPrice > 0 ? ammPrice : null,
                  reserve_asset: Number(liquidAmm.amountA) || null,
                  reserve_currency: Number(liquidAmm.amountB) || null,
                  account: liquidAmm.amm_account || liquidAmm.account || null,
                },
                mid:
                  Number(booksPayload.books["XRP/RLUSD"].mid) > 0
                    ? booksPayload.books["XRP/RLUSD"].mid
                    : ammPrice > 0
                      ? ammPrice
                      : booksPayload.books["XRP/RLUSD"].mid,
              },
            },
          };
        }
        const poolRows = Array.isArray(nextPools) ? [...nextPools] : [];
        if (liquidAmm) {
          const amountA = Number(liquidAmm.amountA);
          const amountB = Number(liquidAmm.amountB);
          poolRows.push({
            pool: "XRP/RLUSD",
            pool_name: "XRP/RLUSD",
            pair: "XRP/RLUSD",
            reserve_asset: amountA > 0 ? amountA : 0,
            reserve_currency: amountB > 0 ? amountB : 0,
            amm_account: liquidAmm.amm_account || liquidAmm.account || null,
          });
        }
        setBooks(booksPayload);
        setPools(poolRows);
        setPrices(nextPrices || {});
        setTrades(Array.isArray(nextFlows) ? nextFlows : []);
        setSparkline(
          Array.isArray(nextSpark)
            ? nextSpark
            : Array.isArray(nextSpark?.rows)
              ? nextSpark.rows
              : Array.isArray(nextSpark?.price_history)
                ? nextSpark.price_history
                : []
        );
        setNow(Date.now());
      } catch {
        /* keep last good chart if a refresh fails */
      }
    }
    const start = setTimeout(load, 0);
    const id = setInterval(load, 30000);
    window.addEventListener("dpmf-wallet-refresh", load);
    return () => {
      cancelled = true;
      window.removeEventListener("dpmf-wallet-refresh", load);
      clearTimeout(start);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      const clear = setTimeout(() => {
        setLedgerOrders([]);
        setLedgerFills([]);
      }, 0);
      return () => clearTimeout(clear);
    }
    let cancelled = false;
    async function loadLedger() {
      const [offers, activity] = await Promise.all([
        getWalletOffers(walletAddress).catch(() => []),
        getWalletActivity(walletAddress).catch(() => []),
      ]);
      if (cancelled) return;
      setLedgerOrders(offers);
      setLedgerFills(activity);
    }
    const start = setTimeout(loadLedger, 0);
    const id = setInterval(loadLedger, 15000);
    function onTrade(event) {
      const pending = pendingFromExecution(event.detail, walletAddress);
      if (pending?.order) {
        setLedgerOrders((rows) => mergeWalletOrders([pending.order], rows));
        if (pending.order.pair) setPair(pending.order.pair);
      }
      if (pending?.activity) {
        setLedgerFills((rows) => mergeWalletActivity([pending.activity], rows));
        if (pending.activity.pair) setPair(pending.activity.pair);
      }
      loadLedger();
    }
    window.addEventListener("dpmf-trade-executed", onTrade);
    window.addEventListener("dpmf-wallet-refresh", loadLedger);
    return () => {
      cancelled = true;
      clearTimeout(start);
      clearInterval(id);
      window.removeEventListener("dpmf-trade-executed", onTrade);
      window.removeEventListener("dpmf-wallet-refresh", loadLedger);
    };
  }, [walletAddress]);

  const quote = pair.split("/")[1] || "RLUSD";
  const book = books?.books?.[pair] || {};
  const pool = poolForPair(pools, pair);
  const reserveBase = Number(pool?.reserve_xio ?? pool?.reserve_asset ?? 0);
  const reserveQuote = Number(pool?.reserve_currency ?? 0);
  const ammPrice = reserveBase > 0 && reserveQuote > 0 ? reserveQuote / reserveBase : Number(book.amm?.price);
  const livePrice = quotePerXio({
    pair,
    xioUsd: prices.xioUsd,
    xrpUsd: prices.xrpUsd,
    xioXrp: pair === "XIO/XRP" ? book.mid || ammPrice : null,
    xioRlusd: pair === "XIO/RLUSD" ? book.mid || ammPrice : null,
    xrpRlusd: pair === "XRP/RLUSD" ? book.mid || ammPrice : null,
  });

  const series = useMemo(
    () =>
      composePairCandles({
        pair,
        interval: timeframe,
        range: "Max",
        locked: lockedSnapshot(),
        sparkline,
        trades,
        prices,
        livePrice,
        now,
        windowed: false,
        lookbackBars: loadedBars,
        cexCandles: usesCexTape(pair) ? cexCandles : [],
      }),
    [pair, timeframe, sparkline, trades, prices, livePrice, now, loadedBars, cexCandles]
  );
  const baseVisible = visibleBarsForInterval(timeframe);
  const visibleCount = clampVisibleBars(barZoom ?? baseVisible, baseVisible);
  if (activeWindow !== windowKey) {
    setActiveWindow(windowKey);
    setSeriesMeta({ len: 0, head: 0 });
    setPanOffset(0);
    setBarZoom(null);
    setPriceZoom(1);
    setPriceShift(0);
    setLoadedBars(baseVisible + maHistoryPad(maPeriods));
  }
  const maPad = maHistoryPad(maPeriods);
  const wantLoaded = Math.min(4000, visibleCount + Math.max(0, Number(panOffset) || 0) + maPad + 32);
  if (Number.isFinite(wantLoaded) && wantLoaded > loadedBars) setLoadedBars(wantLoaded);
  const seriesHead = Number(series[0]?.t) || 0;
  if (series.length !== seriesMeta.len || seriesHead !== seriesMeta.head) {
    const appended = liveSeriesGrew({
      prevLen: seriesMeta.len,
      prevHead: seriesMeta.head,
      nextLen: series.length,
      nextHead: seriesHead,
    });
    setSeriesMeta({ len: series.length, head: seriesHead });
    if (appended && panOffset > 0) {
      setPanOffset((current) => current + (series.length - seriesMeta.len));
    }
  }
  const clampedPan = clampPanOffset(panOffset, series.length, visibleCount);
  if (Number.isFinite(clampedPan) && clampedPan !== panOffset) setPanOffset(clampedPan);
  const futureBarsBase = futureBarsFromPan(clampedPan);
  const candles = useMemo(
    () => windowBars(series, { bars: visibleCount, offset: clampedPan }),
    [series, visibleCount, clampedPan]
  );
  const averages = useMemo(
    () =>
      averagesForWindow({
        series,
        visible: candles,
        type: maType,
        periods: maPeriods,
      }),
    [series, candles, maType, maPeriods]
  );
  const rsiValues = useMemo(
    () => rsiForWindow({ series, visible: candles, period: rsiPeriod }),
    [series, candles, rsiPeriod]
  );
  const bands = { ...bookBands(book), bias: liquidityPressure({
    xioPct: pool?.xio_pct,
    quotePct: pool?.quote_pct,
    lpSupply: pool?.lp_supply,
  }).bias };
  const pressure = liquidityPressure({
    xioPct: pool?.xio_pct,
    quotePct: pool?.quote_pct,
    lpSupply: pool?.lp_supply,
  });
  const walls = liquidityWalls(book);
  const header = bookHeader(book);
  const arb = arbitrageWindow(ammPrice, header.mid || livePrice);
  const ammRibbon = ammSupportResistanceRibbon(ammPrice, header.mid || livePrice, { padBps: ammRibbonBps });
  const autoView = smartView(candles, { rangeId: "Max", spread: bands.spread, now });
  const view = scalePriceView(autoView, { zoom: priceZoom, shift: priceShift });
  const heat = heatmapDots(trades.filter((row) => !row.pool || String(row.pool).toUpperCase() === pair));
  const trail = ammRebalanceTrail(
    candles.slice(-24).map((row) => ({ t: row.t, price: row.c, timestamp: row.t }))
  );
  const walletPending = pendingFor(walletAddress, { offersKnown: ledgerOrders.length > 0 });
  const wallet = walletChartMarks({
    address: walletAddress,
    orders: mergeWalletOrders(
      ledgerOrders,
      walletOrdersFromBooks(books, walletAddress),
      walletPending.orders
    ),
    fills: mergeWalletActivity(ledgerFills, trades, walletPending.activity),
    pair,
  });
  const tapeRef = Number(candles[candles.length - 1]?.c) || Number(bands.mid) || livePrice || null;
  const aimDeskMarks = deskOrders ? buildDeskMarks(deskOrders, pair, tapeRef) : [];
  const estimatePair = String(estimate?.pair || "XRP/RLUSD").replace(/\s+/g, "").toUpperCase();
  const estimateMatchesPair = Boolean(estimate) && sameChartPair(estimatePair, pair);
  const aimEstimateMarks = estimateMatchesPair ? buildEstimateMarks(estimate, timeframe, tapeRef) : [];
  const aimEstimateScenario =
    estimateMatchesPair && estimateSide
      ? buildEstimateScenarioOverlay(estimate, timeframe, estimateSide, tapeRef)
      : null;
  const estimateFutureBars = Math.max(0, Number(aimEstimateScenario?.bars || aimEstimateScenario?.path?.length || 0));
  const futureBars = Math.max(futureBarsBase, estimateFutureBars);

  useEffect(() => {
    const last = candles.length ? candles[candles.length - 1] : null;
    const source = aimEmbed ? "aim" : "main";
    const priority = aimEmbed ? 10 : 1;
    const xrpLead =
      estimate && sameChartPair(estimate?.pair || "XRP/RLUSD", "XRP/RLUSD")
        ? {
            pair: "XRP/RLUSD",
            bias: estimate.score_bias || estimate.signal || estimate.bias_hour || null,
            fair_mid: estimate.fair_mid || estimate.mid || null,
            note: "CEX XRP/RLUSD lead soft context for XIO pairs",
          }
        : null;
    const relatedPairs =
      pair === "XIO/XRP" || pair === "XRP/XIO"
        ? ["XRP/RLUSD", "XIO/RLUSD"]
        : String(pair || "").startsWith("XIO/")
          ? ["XRP/RLUSD", "XIO/XRP"]
          : sameChartPair(pair, "XRP/RLUSD")
            ? ["XIO/XRP", "XIO/RLUSD"]
            : null;
    publishChartSnapshot(
      buildChartSnapshot({
        pair,
        timeframe,
        tool,
        maType,
        maPeriods,
        magnet,
        showVolume,
        showRsi,
        showArb,
        hollow,
        deskMarksCount: Array.isArray(aimDeskMarks) ? aimDeskMarks.length : 0,
        estimateOn: estimateMatchesPair && ((Array.isArray(aimEstimateMarks) && aimEstimateMarks.length > 0) || Boolean(aimEstimateScenario)),
        estimateSide: estimateMatchesPair ? estimateSide || null : null,
        drawings,
        viewMin: view?.min,
        viewMax: view?.max,
        lastClose: last?.c,
        livePrice,
        candles,
        xrpLead,
        relatedPairs,
        ammRibbon,
        showAmmRibbon,
      }),
      { source, priority }
    );
  }, [
    aimEmbed,
    pair,
    timeframe,
    tool,
    maType,
    maPeriods,
    magnet,
    showVolume,
    showRsi,
    showArb,
    showAmmRibbon,
    ammRibbonBps,
    ammRibbon,
    hollow,
    aimDeskMarks,
    aimEstimateMarks,
    aimEstimateScenario,
    estimateSide,
    estimate,
    estimateMatchesPair,
    drawings,
    view,
    candles,
    livePrice,
  ]);

  useEffect(() => {
    const source = aimEmbed ? "aim" : "main";
    return () => {
      releaseChartSnapshot(source);
    };
  }, [aimEmbed]);

  const showAimOverlays = Boolean(deskOrders || estimate || aimEstimateScenario);
  const events = microEvents({
    trades,
    spreadBps: header.spread_bps,
    pressure,
    walls,
    lastFill: trades[0],
  });
  function addDrawing(point) {
    const next = nextDrawingState({ tool, color: drawColor, pending, point, strokeWidth, lineStyle });
    setPending(next.pending);
    if (next.drawing) {
      const index = drawings.length;
      setDrawings((rows) => [...rows, next.drawing]);
      setSelected(index);
      const nextTool = toolAfterDrawing(stayDraw, tool);
      setTool(nextTool);
      if (nextTool === "cursor") setPending(null);
    }
  }

  function moveHandle(index, key, point) {
    setDrawings((rows) =>
      rows.map((row, current) => (current === index ? moveDrawingHandle(row, key, point) : row))
    );
  }

  function editDrawing(index, patch) {
    setDrawings((rows) =>
      rows.map((row, current) => (current === index ? patchDrawingStyle(row, patch) : row))
    );
  }

  function deleteDrawing(index) {
    setDrawings((rows) => rows.filter((_, current) => current !== index));
    setSelected(null);
  }

  function selectTool(id) {
    const next = toggleTool(tool, id || "none");
    setTool(next);
    setPending(null);
    if (next !== "cursor") setSelected(null);
  }

  function undoDrawing() {
    setPending(null);
    setDrawings((rows) => rows.slice(0, -1));
    setSelected(null);
  }

  function clearDrawings() {
    setDrawings([]);
    setSelected(null);
    setPending(null);
    setGhost(null);
  }

  /** Clear Commander/AI analytical tools only; keep user-placed drawings. */
  function clearAiTools() {
    if (aiRunRef.current?.cancel) {
      try {
        aiRunRef.current.cancel();
      } catch {
        /* ignore */
      }
    }
    setAiCursor({ visible: false, x: 0, y: 0, phase: "", tool: null });
    setEstimateSide(null);
    setDrawings((rows) => rows.filter((row) => !(row && (row.commander || row.source === "commander"))));
    setSelected(null);
    setPending(null);
    setGhost(null);
  }

  if (selected != null && selected >= drawings.length) {
    setSelected(null);
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") {
        if (fullView) {
          setFullView(false);
          return;
        }
        setPending(null);
        setSelected(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selected != null) {
        const tag = String(event.target?.tagName || "");
        if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
        event.preventDefault();
        deleteDrawing(selected);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, fullView]);

  const [embedBoxH, setEmbedBoxH] = useState(0);

  useEffect(() => {
    if (!fullView) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onResize() {
      window.setTimeout(() => setViewH(window.innerHeight), 0);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [fullView]);

  useEffect(() => {
    if (!aimEmbed || fullView) {
      setEmbedBoxH(0);
      return undefined;
    }
    const node = plotWrapRef.current;
    if (!node) return undefined;
    const apply = (raw) => {
      const next = Math.round(Number(raw) || 0);
      if (!Number.isFinite(next) || next < 80) return;
      setEmbedBoxH((cur) => (Math.abs(cur - next) < 2 ? cur : next));
    };
    apply(node.clientHeight);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect?.height;
      if (Number.isFinite(measured) && measured > 0) apply(measured);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [aimEmbed, fullView, showVolume, showRsi]);

  function applyZoom(directionOrEvent, maybeRatio) {
    const fromEvent = directionOrEvent && typeof directionOrEvent === "object";
    const direction = Math.sign(fromEvent ? directionOrEvent.direction : directionOrEvent);
    const anchorRatio = fromEvent
      ? directionOrEvent.anchorRatio
      : Number.isFinite(maybeRatio)
        ? maybeRatio
        : panOffset === 0
          ? 1
          : 0.5;
    if (!direction) return;
    const from = visibleCount;
    const next = zoomVisibleBars(from, direction, baseVisible);
    if (next === from) return;
    setBarZoom(next);
    setPanOffset((pan) =>
      panAfterZoom({
        total: series.length,
        oldVisible: from,
        newVisible: next,
        oldPan: pan,
        anchorRatio,
      })
    );
  }

  function applyPriceZoom({ direction, anchorPrice } = {}) {
    const nextZoom = zoomPriceScale(priceZoom, direction);
    if (nextZoom === priceZoom) return;
    setPriceShift(
      shiftAfterPriceZoom({
        view: autoView,
        oldZoom: priceZoom,
        newZoom: nextZoom,
        anchorPrice,
        oldShift: priceShift,
      })
    );
    setPriceZoom(nextZoom);
  }

  function applyPricePan(deltaPrice) {
    if (!deltaPrice) return;
    setPriceShift((current) => current + deltaPrice);
  }

  function resetPriceScale() {
    setPriceZoom(1);
    setPriceShift(0);
  }

  function onAimDeskMarkClick(mark) {
    const prompt = deskMarkAskPrompt(mark, { pair });
    if (!prompt) return;
    publishAimChatAsk({ text: prompt, mark, open: true, focus: true });
  }

  const plotHeight = fullView
    ? fullViewPriceHeight(viewH, { volume: showVolume, rsi: showRsi })
    : aimEmbed && embedBoxH
      ? boxPriceHeight(embedBoxH, { volume: showVolume, rsi: showRsi })
      : undefined;
  const chart = (
    <div className={`hybrid-chart${showArb && arb?.highlight ? " is-arb" : ""}${fullView ? " is-fullview" : ""}${aimEmbed ? " is-aim-embed" : ""}`}>
      {fullView ? (
        <button
          type="button"
          className="hybrid-fullview-exit"
          onClick={() => setFullView(false)}
        >
          {t.chartExitFullView}
        </button>
      ) : null}
      <div className="hybrid-topbar">
        <div className="hybrid-pairs" role="tablist">
          {CHART_PAIRS.map((name) => (
            <button
              key={name}
              type="button"
              className={pair === name ? "pair-chip active" : "pair-chip"}
              onClick={() => setPair(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="hybrid-ma">
          <span className="hybrid-ma-label">{t.chartMa}</span>
          <MaTypeMenu value={maType} t={t} onChange={setMaType} />
          {MA_PERIODS.map((row) => (
            <label key={row.period} className="hybrid-toggle">
              <input
                type="checkbox"
                checked={maPeriods.includes(row.period)}
                onChange={() =>
                  setMaPeriods((current) => {
                    const next = current.includes(row.period)
                      ? current.filter((period) => period !== row.period)
                      : [...current, row.period].sort((left, right) => left - right);
                    setLoadedBars((bars) =>
                      Math.max(
                        bars,
                        clampVisibleBars(barZoom ?? visibleBarsForInterval(timeframe), visibleBarsForInterval(timeframe)) +
                          Math.max(0, Number(panOffset) || 0) +
                          maHistoryPad(next) +
                          32
                      )
                    );
                    return next;
                  })
                }
              />
              <span style={{ color: row.color }}>{row.period}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="hybrid-options">
        <div className="hybrid-options-toggles">
        <label className="hybrid-toggle">
          <input type="checkbox" checked={hollow} onChange={(event) => setHollow(event.target.checked)} />
          {t.chartHollow}
        </label>
        <label className="hybrid-toggle">
          <input type="checkbox" checked={showArb} onChange={(event) => setShowArb(event.target.checked)} />
          {t.chartArbitrage}
        </label>
        <label className="hybrid-toggle">
          <input type="checkbox" checked={showAmmRibbon} onChange={(event) => setShowAmmRibbon(event.target.checked)} />
          {t.chartAmmRibbon || "AMM S/R ribbon"}
        </label>
        <label className="hybrid-toggle">
          <input type="checkbox" checked={showVolume} onChange={(event) => setShowVolume(event.target.checked)} />
          {t.chartVolumeWave}
        </label>
        <label className="hybrid-toggle">
          <input type="checkbox" checked={showRsi} onChange={(event) => setShowRsi(event.target.checked)} />
          {t.chartRsi}
        </label>
        </div>
        <div className="hybrid-options-fields">
        <div className="hybrid-plot-mode" role="group" aria-label={t.chartPlotMode || "Chart render"}>
          <button
            type="button"
            className={plotMode === "candles" ? "is-on" : undefined}
            aria-pressed={plotMode === "candles"}
            title={t.chartCandles || "Candles"}
            onClick={() => setPlotMode("candles")}
          >
            {t.chartCandles || "Candles"}
          </button>
          <button
            type="button"
            className={plotMode === "ribbon" ? "is-on" : undefined}
            aria-pressed={plotMode === "ribbon"}
            title={t.chartRibbonLine || "AMM channel"}
            onClick={() => setPlotMode("ribbon")}
          >
            {t.chartRibbonLine || "AMM channel"}
          </button>
        </div>
        {showAmmRibbon ? (
          <label className="hybrid-toggle">
            {t.chartAmmRibbonPad || "Ribbon pad"}
            <select value={ammRibbonBps} onChange={(event) => setAmmRibbonBps(Number(event.target.value))}>
              {[0, 5, 10, 25, 50].map((bps) => (
                <option key={bps} value={bps}>
                  {bps} bps
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showRsi ? (
          <>
            <label className="hybrid-toggle">
              {t.chartRsiPeriod}
              <select value={rsiPeriod} onChange={(event) => setRsiPeriod(Number(event.target.value))}>
                {RSI_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </label>
            <label className="hybrid-toggle">
              {t.chartRsiOverbought}
              <select value={rsiOverbought} onChange={(event) => setRsiOverbought(Number(event.target.value))}>
                {RSI_OVERBOUGHT.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="hybrid-toggle">
              {t.chartRsiOversold}
              <select value={rsiOversold} onChange={(event) => setRsiOversold(Number(event.target.value))}>
                {RSI_OVERSOLD.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        </div>
      </div>

      <div className="hybrid-body" ref={bodyRef}>
        <AiChartCursor
          visible={aiCursor.visible}
          x={aiCursor.x}
          y={aiCursor.y}
          phase={aiCursor.phase}
          label="AIM"
        />
        <ChartTools
          tool={tool}
          color={drawColor}
          strokeWidth={strokeWidth}
          lineStyle={lineStyle}
          magnet={magnet}
          stay={stayDraw}
          t={t}
          onSelectTool={selectTool}
          onSelectColor={setDrawColor}
          onSelectWidth={setStrokeWidth}
          onSelectStyle={setLineStyle}
          onUndo={undoDrawing}
          onClear={clearDrawings}
          onToggleMagnet={() => setMagnet((on) => !on)}
          onToggleStay={() => setStayDraw((on) => !on)}
          aiFocusTool={aiCursor.tool}
          aiOpenPanel={Boolean(aiCursor.visible && aiCursor.tool && aiCursor.tool !== "cursor")}
        />

        <div className="hybrid-main">
          <div className="hybrid-meta">
            {usesCexTape(pair) && cexMeta.label ? (
              <p className="hybrid-tape-source" title={cexMeta.label}>
                {cexMeta.label}
              </p>
            ) : null}
            <p className="hybrid-events">
              {events.map((row) => (
                <span key={row.id} title={row.label}>
                  {row.icon} {row.label}
                </span>
              ))}
            </p>
            {showArb && arb ? (
              <dl className="hybrid-arb">
                <div>
                  <dt>{t.ammPrice}</dt>
                  <dd>{formatQuotePerBase(arb.ammPrice, locale, quote)}</dd>
                </div>
                <div>
                  <dt>{t.orderBookMid}</dt>
                  <dd>{formatQuotePerBase(arb.mid, locale, quote)}</dd>
                </div>
                <div>
                  <dt>{t.arbitrageWindow}</dt>
                  <dd className={arb.highlight ? "is-hot" : ""}>{formatPercent(arb.pct, locale)}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="hybrid-plot-wrap" ref={plotWrapRef}>
            <div className="hybrid-zoom" role="group" aria-label={t.chartZoom}>
              <label className="hybrid-toggle hybrid-ledger-toggle">
                <input
                  type="checkbox"
                  checked={showLedgerOrders}
                  onChange={(event) => setShowLedgerOrders(event.target.checked)}
                />
                {t.showLedgerOrders}
              </label>
              <button
                type="button"
                className="hybrid-clear-ai"
                title={t.chartClearAiTitle || "Clear AI tools (keeps your drawings)"}
                aria-label={t.chartClearAiTitle || "Clear AI tools (keeps your drawings)"}
                onClick={clearAiTools}
              >
                {t.chartClearAi || "Clear AI"}
              </button>
              <button
                type="button"
                aria-label={t.chartZoomOut}
                disabled={visibleCount >= ZOOM_BAR_MAX}
                onClick={() => applyZoom(-1)}
              >
                −
              </button>
              <button
                type="button"
                aria-label={t.chartZoomIn}
                disabled={visibleCount <= ZOOM_BAR_MIN}
                onClick={() => applyZoom(1)}
              >
                +
              </button>
              {phone && !fullView ? (
                <button type="button" className="hybrid-fullview-enter" onClick={() => setFullView(true)}>
                  {t.chartFullView}
                </button>
              ) : null}
            </div>
          <ChartErrorBoundary message={t.chartCrashed} retryLabel={t.chartReload}>
          <HybridPlot
            key={windowKey}
            candles={candles}
            futureBars={futureBars}
            quote={quote}
            interval={timeframe}
            view={view}
            bands={bands}
            walls={walls}
            trail={trail}
            heatmap={heat}
            wallet={wallet}
            ghost={ghost}
            drawings={drawings}
            pending={pending}
            tool={tool}
            color={drawColor}
            strokeWidth={strokeWidth}
            lineStyle={lineStyle}
            magnet={magnet}
            hollow={hollow}
            averages={averages}
            rsiValues={rsiValues}
            rsiPeriod={rsiPeriod}
            rsiOverbought={rsiOverbought}
            rsiOversold={rsiOversold}
            showVolume={showVolume}
            showRsi={showRsi}
            showArb={showArb}
            showLedgerOrders={showLedgerOrders}
            ammRibbon={showAmmRibbon ? ammRibbon : null}
            aimDeskMarks={aimDeskMarks}
            aimEstimateMarks={aimEstimateMarks}
            aimEstimateScenario={aimEstimateScenario}
            showAimOverlays={showAimOverlays}
            plotMode={plotMode}
            onAimDeskMarkClick={deskOrders ? onAimDeskMarkClick : null}
            locale={locale}
            t={t}
            selectedIndex={selected}
            onDraw={addDrawing}
            onMoveHandle={moveHandle}
            onSelect={setSelected}
            onEditDrawing={editDrawing}
            onDeleteDrawing={deleteDrawing}
            onPan={(steps) => {
              if (!steps) return;
              setPanOffset((current) => current + steps);
            }}
            onZoom={applyZoom}
            onPriceZoom={applyPriceZoom}
            onPricePan={applyPricePan}
            onPriceReset={resetPriceScale}
            priceHeight={plotHeight}
          />
          </ChartErrorBoundary>
          </div>
        </div>
      </div>

      <div className="hybrid-ranges" role="tablist" aria-label={t.chartTimeframes || "Candle size"}>
        {INTERVALS.map((row) => (
          <button
            key={row.id}
            type="button"
            className={timeframe === row.id ? "range active" : "range"}
            onClick={() => setTimeframe(row.id)}
          >
            <span className="range-label">{row.label}</span>
          </button>
        ))}
      </div>

      <div className="hybrid-footer">
        <TradeBar />
        {ghost ? (
          <span className="hybrid-ghost-readout">
            {formatQuotePerBase(ghost.spot, locale, quote)} → {formatQuotePerBase(ghost.next, locale, quote)} ({formatPercent(ghost.impactPct, locale)})
          </span>
        ) : null}
      </div>
    </div>
  );

  if (fullView && typeof document !== "undefined") {
    return createPortal(chart, document.body);
  }
  return chart;
}
