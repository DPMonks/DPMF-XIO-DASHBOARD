import {useEffect, useId, useMemo, useRef, useState} from "react";
import {formatQuotePerBase, formatToken} from "../utils/format";
import {axisLabelX, barSlots, clientToSvg, equalGrid, formatAxisPrice, formatAxisTime, formatCursorWhen, plotViewKey, priceLabelWidth, priceTicks, timeTagOrigin, timeTagWidth} from "../chart/axis";
import {candleBodyBox, candleBodyWidth, wheelPanSteps, wheelZoomSteps} from "../chart/candles";
import {extendMaPoints, maCurvePoints, maPath, maRevealState, volumeWaveValues, waveArea, wavePath} from "../chart/indicators";
import {intervalMs} from "../chart/intervals";
import {applyPlaceOffset, canMoveHandle, clickIsPan, drawingToolbarAnchor, hitPlacedDrawing, isIdleTool, shouldFollowCrosshair, snapPoint, toggleInspect} from "../chart/drawings";
import {hideToolPreview, paintPlaceMark, paintToolPreview} from "../chart/paintPreview";
import ChartDrawings from "./ChartDrawings";
import ChartEditBar from "./ChartEditBar";
import {DESK_CLUSTER_TOOLTIP, deskMarkDotRadius, deskMarkPaintColor, deskMarkTouchClusterFlags} from "../chart/aimMarks";

const VOL_H = 72;
const RSI_H = 72;
const PANE_GAP = 8;
const PAD = { l: 8, r: 18, t: 16, b: 36 };
const PRICE_HIT = 44;
const TICK_COUNT = 6;
const UP = "#26a69a";
const DOWN = "#ef5350";

export default function HybridPlot({
  candles = [],
  futureBars = 0,
  quote = "RLUSD",
  interval = "1D",
  view,
  bands,
  walls = [],
  trail = [],
  heatmap = [],
  wallet,
  ghost,
  drawings = [],
  pending,
  tool = "cursor",
  color = "#3d8bff",
  strokeWidth = 1,
  lineStyle = "solid",
  magnet = false,
  hollow = false,
  averages = [],
  rsiValues = [],
  rsiPeriod = 14,
  rsiOverbought = 70,
  rsiOversold = 30,
  showVolume = true,
  showRsi = true,
  showArb = false,
  showLedgerOrders = false,
  ammRibbon = null,
  aimDeskMarks = [],
  aimEstimateMarks = [],
  aimEstimateScenario = null,
  showAimOverlays = false,
  plotMode = "candles",
  onAimDeskMarkClick = null,
  locale,
  t,
  selectedIndex = null,
  onDraw,
  onMoveHandle,
  onSelect,
  onEditDrawing,
  onDeleteDrawing,
  onPan,
  onZoom,
  onPriceZoom,
  onPricePan,
  onPriceReset,
  priceHeight,
}) {
  const PRICE_H = Math.max(220, Math.round(Number(priceHeight) || 348));
  const box = useRef(null);
  const svgRef = useRef(null);
  const hairVRef = useRef(null);
  const hairHRef = useRef(null);
  const timeTagRef = useRef(null);
  const timeTextRef = useRef(null);
  const priceTagRef = useRef(null);
  const priceTextRef = useRef(null);
  const inspectRef = useRef(null);
  const clickRef = useRef(null);
  const pointerKindRef = useRef("pan");
  const moveQ = useRef(null);
  const moveRaf = useRef(0);
  const onMoveHandleRef = useRef(onMoveHandle);
  const placeMarkRef = useRef(null);
  const previewRef = useRef(null);
  const [inspect, setInspect] = useState(null);
  const [drag, setDrag] = useState(null);
  const [panDrag, setPanDrag] = useState(null);
  const [priceDrag, setPriceDrag] = useState(null);
  const [pointerKind, setPointerKind] = useState("pan");
  const [enterTs, setEnterTs] = useState([]);
  const [seenTs, setSeenTs] = useState([]);
  const [maDraw, setMaDraw] = useState({ ready: [], armed: [] });
  const wheelLeft = useRef(0);
  const wheelZoomLeft = useRef(0);
  const wheelPriceLeft = useRef(0);
  const wheelRaf = useRef(0);
  const wheelPend = useRef(null);
  const onPanRef = useRef(onPan);
  const onZoomRef = useRef(onZoom);
  const onPriceZoomRef = useRef(onPriceZoom);
  const onPricePanRef = useRef(onPricePan);
  const scaleRef = useRef(null);
  const uid = useId().replace(/:/g, "");
  const [width, setWidth] = useState(960);

  useEffect(() => {
    const node = box.current;
    if (!node) return undefined;
    const apply = (raw) => {
      const next = Math.round(Number(raw) || 0);
      if (!Number.isFinite(next) || next < 80) return;
      setWidth((cur) => (Math.abs(cur - next) < 1 ? cur : next));
    };
    apply(node.clientWidth || node.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect?.width;
      if (Number.isFinite(measured) && measured > 0) apply(measured);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const volH = showVolume ? VOL_H : 0;
  const rsiH = showRsi ? RSI_H : 0;
  const volTop = PAD.t + PRICE_H + (volH ? 4 : 0);
  const rsiTop = volTop + volH + (volH && rsiH ? PANE_GAP : rsiH ? 4 : 0);
  const height = rsiTop + rsiH + PAD.b;
  const innerW = width - PAD.l - PAD.r;
  const plotBottom = PAD.t + PRICE_H;
  const volBottom = volTop + volH;
  const rsiBottom = rsiTop + rsiH;

  const scale = useMemo(() => {
    const pad = Math.max(0, Math.trunc(Number(futureBars) || 0));
    const slots = barSlots(candles, {
      left: PAD.l,
      width: innerW,
      extra: pad,
      step: intervalMs(interval),
    });
    const start = candles[0]?.t || view?.start || 0;
    const end = slots.last || candles[candles.length - 1]?.t || view?.end || 1;
    const min = view?.min || 0;
    const max = view?.max || 1;
    const spanT = Math.max(end - start, 1);
    const spanP = Math.max(max - min, 1e-12);
    return {
      x: slots.x,
      tAt: slots.tAt,
      y: (p) => PAD.t + (1 - (p - min) / spanP) * PRICE_H,
      start,
      end,
      min,
      max,
      spanT,
      slot: slots.slot,
      ticks: slots.ticks,
      viewKey: plotViewKey(candles, { left: PAD.l, width: innerW, extra: pad }),
    };
  }, [view, candles, innerW, futureBars, interval, PRICE_H]);

  const yTicks = useMemo(() => priceTicks(scale.min, scale.max, TICK_COUNT), [scale.min, scale.max]);
  const xTicks = useMemo(() => scale.ticks(TICK_COUNT), [scale]);
  const volumes = useMemo(() => volumeWaveValues(candles), [candles]);
  const laidAimDeskMarks = useMemo(() => {
    const rows = Array.isArray(aimDeskMarks) ? aimDeskMarks : [];
    if (!rows.length) return [];
    const lastT = candles.length ? candles[candles.length - 1].t : null;
    const laid = rows.map((m, i) => {
      const y = scale.y(m.price);
      if (!Number.isFinite(y)) return null;
      const xFromT = m.t != null ? scale.x(m.t) : null;
      const x =
        Number.isFinite(xFromT)
          ? xFromT
          : Number.isFinite(scale.x(lastT))
            ? scale.x(lastT) - 10 - (i % 5) * 7
            : PAD.l + 14 + (i % 5) * 8;
      if (!Number.isFinite(x)) return null;
      const resting = m.style === "resting" || m.resting;
      const r = deskMarkDotRadius(m);
      return { m, i, x, y, r, resting };
    }).filter(Boolean);
    const flags = deskMarkTouchClusterFlags(laid.map((row) => ({ x: row.x, y: row.y, r: row.r })));
    return laid.map((row, idx) => ({
      ...row,
      inCluster: Boolean(flags[idx]),
      color: deskMarkPaintColor(row.m, flags[idx]),
    }));
  }, [aimDeskMarks, candles, scale]);
  const seenSet = new Set(seenTs);
  const freshBars = candles
    .map((row) => row.t)
    .filter((stamp) => Number.isFinite(stamp) && !seenSet.has(stamp) && !enterTs.includes(stamp));
  if (freshBars.length) {
    setSeenTs((current) => [...current, ...freshBars].slice(-2000));
    setEnterTs((current) => [...current, ...freshBars].slice(-240));
  }

  const maIds = averages.map((row) => row.id);
  const maLive = new Set(maIds);
  const maReady = maDraw.ready.filter((id) => maLive.has(id));
  const maArmed = maDraw.armed.filter((id) => maLive.has(id));
  const maAdded = maIds.filter((id) => !maReady.includes(id) && !maArmed.includes(id));
  if (
    maAdded.length ||
    maReady.length !== maDraw.ready.length ||
    maArmed.length !== maDraw.armed.length
  ) {
    setMaDraw({ ready: maReady, armed: [...maArmed, ...maAdded] });
  }
  useEffect(() => {
    onPanRef.current = onPan;
  }, [onPan]);
  useEffect(() => {
    onZoomRef.current = onZoom;
  }, [onZoom]);
  useEffect(() => {
    onPriceZoomRef.current = onPriceZoom;
  }, [onPriceZoom]);
  useEffect(() => {
    onPricePanRef.current = onPricePan;
  }, [onPricePan]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    onMoveHandleRef.current = onMoveHandle;
  }, [onMoveHandle]);
  useEffect(() => {
    return () => {
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
      if (wheelRaf.current) cancelAnimationFrame(wheelRaf.current);
    };
  }, []);
  useEffect(() => {
    if (isIdleTool(tool)) hideToolPreview(previewRef.current, placeMarkRef.current);
  }, [tool]);
  useEffect(() => {
    inspectRef.current = inspect;
  }, [inspect]);
  if (tool !== "cursor" && inspect) {
    setInspect(null);
  }
  useEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;
    const inner = width - PAD.l - PAD.r;
    function flushWheel() {
      wheelRaf.current = 0;
      const job = wheelPend.current;
      wheelPend.current = null;
      if (!job) return;
      if (job.pan && onPanRef.current) onPanRef.current(job.pan);
      if (job.price && onPriceZoomRef.current) {
        onPriceZoomRef.current({
          direction: job.price > 0 ? 1 : -1,
          anchorPrice: job.priceAnchor,
        });
      }
      if (job.zoom && onZoomRef.current) {
        onZoomRef.current({
          direction: job.zoom > 0 ? 1 : -1,
          anchorRatio: job.zoomRatio,
        });
      }
    }
    function queueWheel(patch) {
      const prev = wheelPend.current || { pan: 0, zoom: 0, zoomRatio: 0.5, price: 0, priceAnchor: null };
      if (patch.pan) prev.pan += patch.pan;
      if (patch.zoom) {
        prev.zoom += patch.zoom;
        prev.zoomRatio = patch.zoomRatio;
      }
      if (patch.price) {
        prev.price += patch.price;
        prev.priceAnchor = patch.priceAnchor;
      }
      wheelPend.current = prev;
      if (wheelRaf.current) return;
      wheelRaf.current = requestAnimationFrame(flushWheel);
    }
    function onWheel(event) {
      event.preventDefault();
      try {
        const horizontal = event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY);
        if (horizontal) {
          const next = wheelPanSteps(event.deltaX, event.shiftKey ? event.deltaY : 0, wheelLeft.current);
          wheelLeft.current = next.leftover;
          if (next.steps) queueWheel({ pan: next.steps });
          return;
        }
        const mapped = clientToSvg(node, event.clientX, event.clientY, width, height);
        if (mapped && mapped.x < PAD.l + PRICE_HIT && mapped.y >= PAD.t && mapped.y <= PAD.t + PRICE_H) {
          const live = scaleRef.current;
          const span = Math.max(1e-12, Number(live?.max) - Number(live?.min));
          const anchorPrice = Number(live?.max) - ((mapped.y - PAD.t) / PRICE_H) * span;
          const next = wheelZoomSteps(event.deltaY, wheelPriceLeft.current);
          wheelPriceLeft.current = next.leftover;
          if (next.steps) {
            queueWheel({
              price: next.steps > 0 ? 1 : -1,
              priceAnchor: Number.isFinite(anchorPrice) ? anchorPrice : null,
            });
          }
          return;
        }
        const ratio = mapped ? (mapped.x - PAD.l) / Math.max(1, inner) : 0.5;
        const next = wheelZoomSteps(event.deltaY, wheelZoomLeft.current);
        wheelZoomLeft.current = next.leftover;
        if (next.steps) {
          queueWheel({
            zoom: next.steps > 0 ? -1 : 1,
            zoomRatio: Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0.5)),
          });
        }
      } catch {
        wheelLeft.current = 0;
        wheelZoomLeft.current = 0;
        wheelPriceLeft.current = 0;
        wheelPend.current = null;
        if (wheelRaf.current) cancelAnimationFrame(wheelRaf.current);
        wheelRaf.current = 0;
      }
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (wheelRaf.current) cancelAnimationFrame(wheelRaf.current);
      wheelRaf.current = 0;
      wheelPend.current = null;
    };
  }, [height, PRICE_H]);

  const candleW = candleBodyWidth({
    innerW,
    candles,
    start: scale.start,
    end: scale.end,
    stepMs: intervalMs(interval),
    extra: futureBars,
  });

  function locate(event, { place = false } = {}) {
    const mapped = clientToSvg(svgRef.current || event.currentTarget, event.clientX, event.clientY, width, height);
    if (!mapped) return null;
    const shifted =
      place && !isIdleTool(tool)
        ? applyPlaceOffset(mapped, { tool, pad: PAD, width, plotBottom })
        : mapped;
    const x = shifted.x;
    const y = shifted.y;
    const t = scale.tAt ? scale.tAt(x) : scale.start + ((x - PAD.l) / innerW) * (scale.end - scale.start);
    const price = scale.max - ((y - PAD.t) / PRICE_H) * (scale.max - scale.min);
    const inPriceGutter = y >= PAD.t - 2 && y <= plotBottom + 2 && x < PAD.l + PRICE_HIT;
    const inPrice = y >= PAD.t - 2 && y <= plotBottom + 2 && x >= PAD.l && x <= width - PAD.r;
    const inVolume = volH > 0 && y >= volTop && y <= volBottom && x >= PAD.l && x <= width - PAD.r;
    const inRsi = rsiH > 0 && y >= rsiTop && y <= rsiBottom && x >= PAD.l && x <= width - PAD.r;
    let nearest = candles[0];
    let best = Infinity;
    for (const row of candles) {
      const dist = Math.abs(row.t - t);
      if (dist < best) {
        best = dist;
        nearest = row;
      }
    }
    const raw = { t, price };
    const snapped = magnet ? snapPoint(raw, candles) : raw;
    return {
      x: magnet ? scale.x(snapped.t) : x,
      y: magnet ? scale.y(snapped.price) : y,
      t: snapped.t,
      price: snapped.price,
      viewKey: scale.viewKey,
      candle: nearest,
      inPrice,
      inPriceGutter,
      inVolume,
      inRsi,
    };
  }

  function paintCursor(next) {
    const hairV = hairVRef.current;
    const hairH = hairHRef.current;
    const timeTag = timeTagRef.current;
    const timeText = timeTextRef.current;
    const priceTag = priceTagRef.current;
    const priceText = priceTextRef.current;
    if (!next) {
      if (hairV) hairV.setAttribute("visibility", "hidden");
      if (hairH) hairH.setAttribute("visibility", "hidden");
      if (timeTag) timeTag.setAttribute("visibility", "hidden");
      if (priceTag) priceTag.setAttribute("visibility", "hidden");
      return;
    }
    const x = Math.min(width - PAD.r, Math.max(PAD.l, next.x));
    if (hairV) {
      hairV.setAttribute("visibility", "visible");
      hairV.setAttribute("x1", String(x));
      hairV.setAttribute("x2", String(x));
    }
    if (next.inPrice) {
      const y = Math.min(plotBottom - 1, Math.max(PAD.t + 1, next.y));
      if (hairH) {
        hairH.setAttribute("visibility", "visible");
        hairH.setAttribute("y1", String(y));
        hairH.setAttribute("y2", String(y));
      }
      if (priceTag && priceText) {
        const label = formatAxisPrice(next.price);
        const tagW = priceLabelWidth(label);
        priceTag.setAttribute("visibility", "visible");
        priceTag.setAttribute("transform", `translate(${PAD.l + 4} ${y - 9})`);
        const rect = priceTag.querySelector("rect");
        if (rect) {
          rect.setAttribute("width", String(tagW));
          rect.setAttribute("x", "0");
        }
        priceText.setAttribute("x", String(tagW / 2));
        priceText.setAttribute("textAnchor", "middle");
        priceText.textContent = label;
      }
    } else {
      if (hairH) hairH.setAttribute("visibility", "hidden");
      if (priceTag) priceTag.setAttribute("visibility", "hidden");
    }
    if (timeTag && timeText && Number.isFinite(next.t)) {
      const label = formatCursorWhen(next.t, locale);
      const box = timeTagOrigin(x, timeTagWidth(label), { left: PAD.l, right: width - PAD.r });
      timeTag.setAttribute("visibility", "visible");
      timeTag.setAttribute("transform", `translate(${box.x} ${height - PAD.b + 4})`);
      const rect = timeTag.querySelector("rect");
      if (rect) rect.setAttribute("width", String(box.width));
      timeText.setAttribute("x", String(box.textX));
      timeText.textContent = label;
    }
  }

  function paintPlacement(next) {
    const placing = !isIdleTool(tool);
    paintPlaceMark(placeMarkRef.current, {
      x: next?.x,
      y: next?.y,
      color,
      visible: Boolean(placing && next?.inPrice),
    });
    if (!placing) {
      hideToolPreview(previewRef.current, null);
      return;
    }
    paintToolPreview(previewRef.current, {
      tool,
      color,
      pending,
      hover: next,
      scale,
      pad: PAD,
      width,
      plotBottom,
      strokeWidth,
      lineStyle,
    });
  }

  function hitAt(pointer) {
    if (!pointer || !canMoveHandle(tool)) return null;
    return hitPlacedDrawing(drawings, scale, pointer.x, pointer.y, {
      pad: PAD,
      width,
      plotBottom,
    });
  }

  function setPointerFromHit(hit, pointer) {
    const next = pointer?.inPriceGutter ? "price" : hit?.handle ? "grab" : hit ? "edit" : "pan";
    if (pointerKindRef.current === next) return;
    pointerKindRef.current = next;
    setPointerKind(next);
  }

  function queueHandleMove(index, key, pointer) {
    moveQ.current = { index, key, pointer };
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      const next = moveQ.current;
      moveQ.current = null;
      if (next && onMoveHandleRef.current) onMoveHandleRef.current(next.index, next.key, next.pointer);
    });
  }

  function onMove(event) {
    if (priceDrag) {
      const pointer = locate(event);
      if (!pointer) return;
      const dy = pointer.y - priceDrag.y;
      if (dy && onPricePanRef.current) {
        const span = Math.max(1e-12, scale.max - scale.min);
        onPricePanRef.current((dy / PRICE_H) * span);
        setPriceDrag({ y: pointer.y });
      }
      return;
    }
    let livePan = panDrag;
    if (
      clickRef.current &&
      !clickRef.current.drawing &&
      !panDrag &&
      !drag &&
      tool === "cursor" &&
      clickIsPan(clickRef.current.clientX, event.clientX)
    ) {
      livePan = { x: clickRef.current.clientX };
      setPanDrag(livePan);
      if (onSelect) onSelect(null);
      clickRef.current = null;
    }
    if (livePan) {
      const slot = Math.max(
        4,
        ((svgRef.current?.getBoundingClientRect?.().width || width) / width) *
          (innerW / Math.max(1, candles.length + Math.max(0, Number(futureBars) || 0)))
      );
      const moved = event.clientX - livePan.x;
      const steps = Math.trunc(moved / slot);
      if (steps && onPanRef.current) {
        onPanRef.current(steps);
        setPanDrag((current) => (current ? { ...current, x: current.x + steps * slot } : { ...livePan, x: livePan.x + steps * slot }));
      }
      return;
    }
    const pointer = locate(event);
    const placing = !isIdleTool(tool);
    const next = placing && !drag ? locate(event, { place: true }) : pointer;
    const hit = drag ? { ...drag, handle: true } : hitAt(pointer);
    const overHandle = Boolean(hit?.handle);
    if (shouldFollowCrosshair({ tool, dragging: Boolean(drag), overHandle })) {
      paintCursor(pointer);
    } else {
      paintCursor(null);
    }
    paintPlacement(placing && !drag ? next : null);
    if (!drag && !livePan) setPointerFromHit(hit, pointer);
    if (drag && pointer && Number.isFinite(pointer.t) && Number.isFinite(pointer.price)) {
      queueHandleMove(drag.index, drag.key, pointer);
    }
  }

  function onPointerDown(event) {
    const pointer = locate(event);
    if (!pointer) return;
    if (event.button === 0 && pointer.inPriceGutter && tool === "cursor") {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      clickRef.current = null;
      setPriceDrag({ y: pointer.y });
      return;
    }
    const hit = event.button === 0 ? hitAt(pointer) : null;
    if (hit) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      inspectRef.current = null;
      setInspect(null);
      if (onSelect) onSelect(hit.index);
      if (hit.handle) {
        clickRef.current = null;
        setDrag(hit);
        paintCursor(pointer);
        queueHandleMove(hit.index, hit.key, pointer);
      } else {
        clickRef.current = { clientX: event.clientX, pointer, drawing: true };
      }
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      clickRef.current = null;
      setPanDrag({ x: event.clientX });
      return;
    }
    if (event.button !== 0) return;
    if (tool === "cursor") {
      if (!pointer.inPrice) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      clickRef.current = { clientX: event.clientX, pointer, drawing: false };
      return;
    }
    const next = locate(event, { place: true });
    if (!next?.inPrice || !onDraw) return;
    event.preventDefault();
    onDraw(next);
  }

  function flushHandleMove() {
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
    }
    const next = moveQ.current;
    moveQ.current = null;
    if (next && onMoveHandleRef.current) onMoveHandleRef.current(next.index, next.key, next.pointer);
  }

  function onPointerUp() {
    flushHandleMove();
    if (clickRef.current && tool === "cursor") {
      if (clickRef.current.drawing) {
        inspectRef.current = null;
        setInspect(null);
      } else {
        if (onSelect) onSelect(null);
        const next = toggleInspect(inspectRef.current, clickRef.current.pointer);
        inspectRef.current = next;
        setInspect(next);
      }
    }
    clickRef.current = null;
    setDrag(null);
    setPanDrag(null);
    setPriceDrag(null);
    if (!shouldFollowCrosshair({ tool, dragging: false, overHandle: false }) && !inspectRef.current) {
      paintCursor(null);
    }
  }

  const overHandle = pointerKind === "grab" || Boolean(drag);
  const liveHair = shouldFollowCrosshair({ tool, dragging: Boolean(drag), overHandle });
  const selected = Number.isInteger(selectedIndex) ? drawings[selectedIndex] : null;
  const editAnchor = selected && tool === "cursor" ? drawingToolbarAnchor(selected, scale, { pad: PAD }) : null;
  const inspectX = inspect ? Math.min(width - PAD.r, Math.max(PAD.l, scale.x(inspect.t))) : null;
  const inspectY = inspect ? Math.min(plotBottom - 1, Math.max(PAD.t + 1, scale.y(inspect.price))) : null;
  const inspectWhen = inspect ? formatCursorWhen(inspect.t, locale) : "";
  const inspectTimeBox = inspect
    ? timeTagOrigin(inspectX, timeTagWidth(inspectWhen), { left: PAD.l, right: width - PAD.r })
    : null;
  const hoverCandle = inspect?.candle;
  const clipId = `hybrid-plot-${uid}`;
  const volClipId = `hybrid-vol-${uid}`;
  const rsiClipId = `hybrid-rsi-${uid}`;
  const volGradId = `hybrid-vol-grad-${uid}`;
  const volMax = Math.max(...volumes, 0) || 1;
  const volPoints = candles.map((row, index) => ({
    x: scale.x(row.t),
    y: volBottom - (volumes[index] / volMax) * Math.max(volH - 10, 1),
    up: row.c >= row.o,
  }));
  const volLine = wavePath(volPoints);
  const volFill = waveArea(volPoints, volBottom);
  const rsiY = (value) => rsiTop + (1 - Math.min(100, Math.max(0, Number(value) || 0)) / 100) * rsiH;
  const rsiPoints = candles
    .map((row, index) => {
      const value = rsiValues[index];
      return Number.isFinite(value) ? { x: scale.x(row.t), y: rsiY(value) } : null;
    })
    .filter(Boolean);
  const hoverRsi = hoverCandle
    ? rsiValues[candles.findIndex((row) => row.t === hoverCandle.t)]
    : null;
  const inspectPriceLabel = inspect ? formatAxisPrice(inspect.price) : "";
  const inspectPriceTagW = inspect ? priceLabelWidth(inspectPriceLabel) : 0;
  const inspectRsiLabel = Number.isFinite(hoverRsi) ? Number(hoverRsi).toFixed(1) : "";
  const inspectRsiTagW = inspectRsiLabel ? priceLabelWidth(inspectRsiLabel) : 0;
  const rsiTagY =
    inspect && Number.isFinite(hoverRsi)
      ? Math.min(rsiBottom - 1, Math.max(rsiTop + 1, rsiY(hoverRsi)))
      : null;

  return (
    <div className={`hybrid-plot${hollow ? " is-hollow" : ""}${plotMode === "ribbon" ? " is-ribbon" : ""}`} ref={box}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={`hybrid-svg${!isIdleTool(tool) ? " is-placing" : " is-pan"}${panDrag ? " is-panning" : ""}${priceDrag || pointerKind === "price" ? " is-price" : ""}${drag ? " is-grabbing" : pointerKind === "grab" ? " is-grab" : pointerKind === "edit" ? " is-edit" : ""}`}
        onPointerMove={onMove}
        onPointerLeave={() => {
          if (drag) return;
          paintCursor(null);
          hideToolPreview(previewRef.current, placeMarkRef.current);
          setPointerFromHit(null);
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          const pointer = locate(event);
          if (pointer?.inPriceGutter && onPriceReset) onPriceReset();
        }}
        role="img"
        aria-label={`${quote} hybrid chart`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.l} y={PAD.t} width={innerW} height={PRICE_H} />
          </clipPath>
          <clipPath id={volClipId}>
            <rect x={PAD.l} y={volTop} width={innerW} height={Math.max(volH, 0)} />
          </clipPath>
          <clipPath id={rsiClipId}>
            <rect x={PAD.l} y={rsiTop} width={innerW} height={Math.max(rsiH, 0)} />
          </clipPath>
          <linearGradient id={`pressure-down-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff5d73" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#9818f0" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`pressure-up-${uid}`} x1="0" x2="0" y1="1" y2="0">
            <stop offset="0%" stopColor="#00eaff" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#98f050" stopOpacity="0.02" />
          </linearGradient>
          {volH > 0 && volPoints.length ? (
            <linearGradient
              id={volGradId}
              x1={PAD.l}
              x2={width - PAD.r}
              y1="0"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              {volPoints.map((row, index) => (
                <stop
                  key={`vol-stop-${index}`}
                  offset={volPoints.length === 1 ? "0%" : `${(index / (volPoints.length - 1)) * 100}%`}
                  stopColor={row.up ? UP : DOWN}
                />
              ))}
            </linearGradient>
          ) : null}
        </defs>

        <rect className="hybrid-plot-bg" x="0" y="0" width={width} height={height} />
        <rect className="hybrid-plot-frame" x={PAD.l} y={PAD.t} width={innerW} height={PRICE_H} />
        {volH > 0 ? (
          <rect className="hybrid-plot-frame" x={PAD.l} y={volTop} width={innerW} height={volH} />
        ) : null}
        {rsiH > 0 ? (
          <rect className="hybrid-plot-frame" x={PAD.l} y={rsiTop} width={innerW} height={rsiH} />
        ) : null}

        {yTicks.map((price) => {
          const y = scale.y(price);
          const label = formatAxisPrice(price);
          const tagW = priceLabelWidth(label);
          return (
            <g key={`gy-${price}`} className="hybrid-price-tick">
              <line className="hybrid-grid" x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} />
              <rect className="hybrid-price-tick-bg" x={PAD.l + 4} y={y - 8} width={tagW} height={16} rx={3} />
              <text className="hybrid-axis is-price is-inline" x={PAD.l + 4 + tagW / 2} y={y + 3.5} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
        {volH > 0
          ? equalGrid(2, volTop, volH).map((y) => (
              <line key={`gvy-${y}`} className="hybrid-grid" x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} />
            ))
          : null}
        {rsiH > 0
          ? equalGrid(2, rsiTop, rsiH).map((y) => (
              <line key={`gry-${y}`} className="hybrid-grid" x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} />
            ))
          : null}
        {xTicks.map((stamp) => {
          const x = scale.x(stamp);
          return (
            <g key={`gx-${stamp}`}>
              <line className="hybrid-grid is-time" x1={x} x2={x} y1={PAD.t} y2={plotBottom} />
              {volH > 0 ? <line className="hybrid-grid is-time" x1={x} x2={x} y1={volTop} y2={volBottom} /> : null}
              {rsiH > 0 ? <line className="hybrid-grid is-time" x1={x} x2={x} y1={rsiTop} y2={rsiBottom} /> : null}
            </g>
          );
        })}
        {xTicks.map((stamp) => {
          const x = scale.x(stamp);
          const labelX = axisLabelX(x, { min: PAD.l + 20, max: width - 20 });
          return (
            <text key={`xt-${stamp}`} className="hybrid-axis is-time" x={labelX} y={height - 10} textAnchor="middle">
              {formatAxisTime(stamp, { spanMs: scale.spanT, intervalId: interval, locale })}
            </text>
          );
        })}

        <g clipPath={`url(#${clipId})`}>
          {showArb && bands?.bias === "down" ? (
            <rect x={PAD.l} y={PAD.t} width={innerW} height={PRICE_H} fill={`url(#pressure-down-${uid})`} />
          ) : null}
          {showArb && bands?.bias === "up" ? (
            <rect x={PAD.l} y={PAD.t} width={innerW} height={PRICE_H} fill={`url(#pressure-up-${uid})`} />
          ) : null}

          {showArb && bands?.bid && bands?.mid ? (
            <rect
              className="hybrid-band is-bid"
              x={PAD.l}
              y={scale.y(bands.mid)}
              width={innerW}
              height={Math.max(1, scale.y(bands.bid) - scale.y(bands.mid))}
            />
          ) : null}
          {showArb && bands?.ask && bands?.mid ? (
            <rect
              className="hybrid-band is-ask"
              x={PAD.l}
              y={scale.y(bands.ask)}
              width={innerW}
              height={Math.max(1, scale.y(bands.mid) - scale.y(bands.ask))}
            />
          ) : null}
          {showArb && bands?.bid && bands?.ask ? (
            <rect
              className="hybrid-spread"
              x={PAD.l}
              y={scale.y(bands.ask)}
              width={innerW}
              height={Math.max(1.5, scale.y(bands.bid) - scale.y(bands.ask))}
            />
          ) : null}

          {ammRibbon && Number(ammRibbon.support) > 0 && Number(ammRibbon.resistance) > Number(ammRibbon.support) ? (
            <g className="hybrid-amm-ribbon" pointerEvents="none">
              <rect
                className="hybrid-amm-ribbon-band"
                x={PAD.l}
                y={scale.y(ammRibbon.resistance)}
                width={innerW}
                height={Math.max(1.5, scale.y(ammRibbon.support) - scale.y(ammRibbon.resistance))}
              />
              <text className="hybrid-amm-ribbon-label" x={PAD.l + 6} y={scale.y(ammRibbon.resistance) - 4}>
                AMM S/R
              </text>
            </g>
          ) : null}

          {(showArb ? walls : []).map((wall) => (
            <rect
              key={`wall-${wall.side}-${wall.price}`}
              className={`hybrid-wall is-${wall.side}`}
              x={PAD.l}
              y={scale.y(wall.price) - 1}
              width={innerW}
              height="2"
              opacity={Math.min(0.28, 0.1 + wall.dominance / 20)}
            />
          ))}

          {trail.length > 1 ? (
            <polyline
              className="hybrid-trail"
              fill="none"
              points={trail.map((row) => `${scale.x(row.t)},${scale.y(row.price)}`).join(" ")}
            />
          ) : null}

          {plotMode === "ribbon" ? (
            (() => {
              const hiPts = [];
              const loPts = [];
              const closePts = [];
              for (const row of candles) {
                const x = scale.x(row.t);
                if (!Number.isFinite(x)) continue;
                const yh = scale.y(row.h);
                const yl = scale.y(row.l);
                const yc = scale.y(row.c);
                if (Number.isFinite(yh)) hiPts.push(`${x},${yh}`);
                if (Number.isFinite(yl)) loPts.push(`${x},${yl}`);
                if (Number.isFinite(yc)) closePts.push(`${x},${yc}`);
              }
              if (!closePts.length) return null;
              return (
                <g className="hybrid-ribbon" pointerEvents="none">
                  {hiPts.length && loPts.length ? (
                    <polygon
                      className="hybrid-ribbon-band"
                      points={[...hiPts, ...loPts.slice().reverse()].join(" ")}
                    />
                  ) : null}
                  <polyline className="hybrid-ribbon-close" points={closePts.join(" ")} fill="none" />
                </g>
              );
            })()
          ) : (
            candles.map((row) => {
            const x = scale.x(row.t);
            const up = row.c >= row.o;
            const color = up ? UP : DOWN;
            const bodyTop = scale.y(Math.max(row.o, row.c));
            const bodyH = Math.max(1.2, Math.abs(scale.y(row.c) - scale.y(row.o)));
            const box = candleBodyBox({ width: candleW, height: bodyH, hollow });
            const entering = enterTs.includes(row.t);
            return (
              <g
                key={row.t}
                className={`${up ? "hybrid-candle is-up" : "hybrid-candle is-down"}${entering ? " is-enter" : ""}`}
                onAnimationEnd={
                  entering
                    ? () => setEnterTs((current) => current.filter((stamp) => stamp !== row.t))
                    : undefined
                }
              >
                <line className="hybrid-wick" x1={x} x2={x} y1={scale.y(row.h)} y2={scale.y(row.l)} />
                <rect
                  className="hybrid-candle-body"
                  x={x - box.width / 2}
                  y={bodyTop - box.offsetY}
                  width={box.width}
                  height={box.height}
                  style={{
                    fill: hollow ? "none" : color,
                    stroke: color,
                    strokeWidth: box.strokeWidth,
                  }}
                />
              </g>
            );
          })
          )}

          {showArb && bands?.mid ? (
            <line className="hybrid-mid" x1={PAD.l} x2={width - PAD.r} y1={scale.y(bands.mid)} y2={scale.y(bands.mid)} />
          ) : null}

          {averages.map((row) => {
            const reveal = maRevealState(row.id, { seen: maDraw.ready, armed: maDraw.armed });
            if (reveal === "wait") return null;
            const drawing = reveal === "drawing";
            const d = maPath(
              extendMaPoints(
                maCurvePoints(candles, row.values).map((point) => ({
                  x: scale.x(point.t),
                  y: scale.y(point.v),
                })),
                { right: width - PAD.r, top: PAD.t, bottom: plotBottom }
              )
            );
            if (!d) return null;
            const finishDraw = () => {
              setMaDraw((current) => ({
                ready: current.ready.includes(row.id) ? current.ready : [...current.ready, row.id],
                armed: current.armed.filter((id) => id !== row.id),
              }));
            };
            return (
              <g key={row.id}>
                <path
                  className={drawing ? "hybrid-sma is-drawing" : "hybrid-sma"}
                  d={d}
                  pathLength="1"
                  style={{
                    stroke: row.color,
                    ...(drawing ? { strokeDasharray: 1, strokeDashoffset: 1 } : {}),
                  }}
                  onAnimationEnd={drawing ? finishDraw : undefined}
                />
                {drawing ? (
                  <circle className="hybrid-sma-glow" r="5" style={{ fill: row.color, color: row.color }}>
                    <animateMotion dur="2.6s" fill="freeze" path={d} rotate="0" />
                  </circle>
                ) : null}
              </g>
            );
          })}

          {showLedgerOrders || (wallet?.orders || []).length
            ? (wallet?.orders || []).map((row, index) => {
                const y = scale.y(row.price);
                const when = row.when ? formatCursorWhen(row.when, locale) : "";
                const label = [when, formatQuotePerBase(row.price, locale, quote), formatToken(row.amount, locale, 2)]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <g key={`order-${index}`} className={`hybrid-wallet-order is-${row.side}`}>
                    <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} />
                    <text x={PAD.l + 8} y={y - 4}>
                      {label}
                    </text>
                  </g>
                );
              })
            : null}
          {(wallet?.fills || []).map((row, index) =>
            Number(row.price) > 0 ? (
              <circle
                key={`fill-${index}`}
                className={`hybrid-wallet-fill is-${row.side}`}
                cx={scale.x(row.t)}
                cy={scale.y(row.price)}
                r="4"
              />
            ) : null
          )}

          {showAimOverlays && bands?.bid > 0 ? (
            <line
              className="hybrid-aim-book is-bid"
              x1={PAD.l}
              x2={width - PAD.r}
              y1={scale.y(bands.bid)}
              y2={scale.y(bands.bid)}
            />
          ) : null}
          {showAimOverlays && bands?.ask > 0 ? (
            <line
              className="hybrid-aim-book is-ask"
              x1={PAD.l}
              x2={width - PAD.r}
              y1={scale.y(bands.ask)}
              y2={scale.y(bands.ask)}
            />
          ) : null}

          {(aimEstimateScenario?.zones || []).map((z, zi) => {
            const y1 = scale.y(z.hi);
            const y2 = scale.y(z.lo);
            if (!Number.isFinite(y1) || !Number.isFinite(y2)) return null;
            const top = Math.min(y1, y2);
            const h = Math.max(2, Math.abs(y2 - y1));
            return (
              <rect
                key={`aim-zone-${z.kind}-${zi}`}
                className={`hybrid-aim-zone is-${z.kind}`}
                x={PAD.l}
                y={top}
                width={Math.max(1, width - PAD.l - PAD.r)}
                height={h}
                opacity={0.5}
              />
            );
          })}

          {(() => {
            const scen = aimEstimateScenario;
            const path = scen?.path || [];
            if (!path.length || !candles.length) return null;
            const last = candles[candles.length - 1];
            const step = intervalMs(interval) || 60_000;
            const midPts = [];
            const hiPts = [];
            const loPts = [];
            for (const pt of path) {
              const tStamp = Number(last.t) + Number(pt.i || 0) * step;
              const x = scale.x(tStamp);
              if (!Number.isFinite(x)) continue;
              const ym = scale.y(pt.mid);
              if (Number.isFinite(ym)) midPts.push(`${x},${ym}`);
              if (pt.hi > 0) {
                const yh = scale.y(pt.hi);
                if (Number.isFinite(yh)) hiPts.push(`${x},${yh}`);
              }
              if (pt.lo > 0) {
                const yl = scale.y(pt.lo);
                if (Number.isFinite(yl)) loPts.push(`${x},${yl}`);
              }
            }
            if (!midPts.length) return null;
            const lastMid = path[path.length - 1];
            return (
              <g className={`hybrid-aim-proj is-${scen.side || "bull"}`}>
                {hiPts.length && loPts.length ? (
                  <polygon
                    className="hybrid-aim-proj-band"
                    points={[...hiPts, ...loPts.slice().reverse()].join(" ")}
                  />
                ) : null}
                <polyline className="hybrid-aim-proj-mid" points={midPts.join(" ")} fill="none" />
                <text x={width - PAD.r - 2} y={scale.y(lastMid.mid) - 6} textAnchor="end">
                  {scen.label || "Estimate by REMOVED-AI-Matrix"} ({scen.side === "bear" ? "bearish" : "bullish"})
                </text>
              </g>
            );
          })()}

          {(aimEstimateMarks || []).map((m) => {
            const y = scale.y(m.price);
            if (!Number.isFinite(y)) return null;
            return (
              <g key={`aim-est-${m.role}-${m.price}`} className={`hybrid-aim-est is-${m.role}`}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} />
                <text x={width - PAD.r - 2} y={y - 3} textAnchor="end">
                  {m.label} {formatQuotePerBase(m.price, locale, quote)}
                </text>
              </g>
            );
          })}

          {laidAimDeskMarks.map(({ m, i, x, y, r, resting, inCluster, color }) => (
              <g
                key={m.key || `aim-desk-${i}`}
                className={`hybrid-aim-desk is-${m.side} is-${resting ? "resting" : "filled"}${inCluster ? " is-cluster" : ""}`}
                style={{ cursor: onAimDeskMarkClick ? "pointer" : "default" }}
                onPointerDown={(event) => {
                  if (!onAimDeskMarkClick) return;
                  event.stopPropagation();
                  event.preventDefault();
                  onAimDeskMarkClick(m);
                }}
                onClick={(event) => {
                  if (!onAimDeskMarkClick) return;
                  event.stopPropagation();
                  event.preventDefault();
                  onAimDeskMarkClick(m);
                }}
              >
                {inCluster ? <title>{DESK_CLUSTER_TOOLTIP}</title> : null}
                <circle className="hybrid-aim-desk-hit" cx={x} cy={y} r={10} fill="transparent" />
                <circle
                  className="hybrid-aim-desk-dot"
                  cx={x}
                  cy={y}
                  r={r}
                  fill={resting ? "none" : color}
                  stroke={color}
                  strokeWidth={resting ? 1.6 : 1.1}
                  opacity={resting ? 0.55 : 0.95}
                />
              </g>
            ))}

          {ghost?.next > 0 ? (
            <g className="hybrid-ghost">
              <rect
                x={width - PAD.r - candleW - 6}
                y={scale.y(Math.max(ghost.spot, ghost.next))}
                width={candleW}
                height={Math.max(2, Math.abs(scale.y(ghost.next) - scale.y(ghost.spot)))}
              />
            </g>
          ) : null}

        </g>
        <ChartDrawings
          drawings={drawings}
          scale={scale}
          pad={PAD}
          width={width}
          plotBottom={plotBottom}
          clipId={clipId}
          activeHandle={drag}
          selectedIndex={tool === "cursor" ? selectedIndex : null}
        />
        <g className="hybrid-place-layer" pointerEvents="none">
          <g ref={previewRef} clipPath={`url(#${clipId})`} />
          <g ref={placeMarkRef} className="hybrid-place-mark" visibility="hidden">
            <circle r="5" />
            <line x1="-7" x2="7" y1="0" y2="0" />
            <line x1="0" x2="0" y1="-7" y2="7" />
          </g>
        </g>

        {volH > 0 ? (
          <g className="hybrid-volume" clipPath={`url(#${volClipId})`}>
            {volFill ? <path className="hybrid-volume-fill" d={volFill} fill={`url(#${volGradId})`} /> : null}
            {volLine ? (
              <path className="hybrid-volume-wave" d={volLine} stroke={`url(#${volGradId})`} />
            ) : null}
            {heatmap.map((row, index) => (
              <circle
                key={`heat-${index}`}
                className={`hybrid-heat is-${row.side}`}
                cx={scale.x(row.t)}
                cy={volTop + 10 + (row.side === "sell" ? 16 : 8)}
                r={Math.max(2, Math.min(7, Math.log10(row.size + 10) * 1.6))}
                opacity={row.opacity}
              />
            ))}
          </g>
        ) : null}
        {volH > 0 ? (
          <text className="hybrid-pane-label" x={PAD.l + 6} y={volTop + 11}>
            VOL
          </text>
        ) : null}

        {rsiH > 0 ? (
          <g className="hybrid-rsi">
            <rect
              className="hybrid-rsi-band"
              x={PAD.l}
              y={rsiY(rsiOverbought)}
              width={innerW}
              height={Math.max(1, rsiY(rsiOversold) - rsiY(rsiOverbought))}
            />
            <line className="hybrid-rsi-level is-ob" x1={PAD.l} x2={width - PAD.r} y1={rsiY(rsiOverbought)} y2={rsiY(rsiOverbought)} />
            <line className="hybrid-rsi-level is-mid" x1={PAD.l} x2={width - PAD.r} y1={rsiY(50)} y2={rsiY(50)} />
            <line className="hybrid-rsi-level is-os" x1={PAD.l} x2={width - PAD.r} y1={rsiY(rsiOversold)} y2={rsiY(rsiOversold)} />
            <g clipPath={`url(#${rsiClipId})`}>
              {wavePath(rsiPoints) ? <path className="hybrid-rsi-line" d={wavePath(rsiPoints)} /> : null}
            </g>
            <text className="hybrid-pane-label" x={PAD.l + 6} y={rsiTop + 11}>
              RSI {rsiPeriod}
            </text>
            <text className="hybrid-axis is-price is-inline" x={PAD.l + 6} y={rsiY(rsiOverbought) + 3}>
              {rsiOverbought}
            </text>
            <text className="hybrid-axis is-price is-inline" x={PAD.l + 6} y={rsiY(rsiOversold) + 3}>
              {rsiOversold}
            </text>
          </g>
        ) : null}

        <g className={`hybrid-crosshair is-live${!isIdleTool(tool) ? " is-place" : ""}`} pointerEvents="none">
          <line ref={hairVRef} visibility="hidden" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={height - PAD.b} />
          <line ref={hairHRef} visibility="hidden" x1={PAD.l} x2={width - PAD.r} y1={PAD.t} y2={PAD.t} />
          <g ref={timeTagRef} className="hybrid-cursor-tag is-time" visibility="hidden">
            <rect x="0" y="0" width="108" height="18" rx="3" />
            <text ref={timeTextRef} x="54" y="13" textAnchor="middle" />
          </g>
          <g ref={priceTagRef} className="hybrid-cursor-tag is-price" visibility="hidden">
            <rect x="0" y="0" width="40" height="18" rx="3" />
            <text ref={priceTextRef} x="20" y="13" textAnchor="middle" />
          </g>
        </g>
        {inspect && !liveHair && Number.isFinite(inspectX) && Number.isFinite(inspectY) ? (
          <g className="hybrid-crosshair is-pinned" pointerEvents="none">
            <line x1={inspectX} x2={inspectX} y1={PAD.t} y2={height - PAD.b} />
            <line x1={PAD.l} x2={width - PAD.r} y1={inspectY} y2={inspectY} />
            <g className="hybrid-cursor-tag is-time" transform={`translate(${inspectTimeBox.x} ${height - PAD.b + 4})`}>
              <rect x="0" y="0" width={inspectTimeBox.width} height="18" rx="3" />
              <text x={inspectTimeBox.textX} y="13" textAnchor="middle">
                {inspectWhen}
              </text>
            </g>
            <g className="hybrid-cursor-tag is-price" transform={`translate(${PAD.l + 4} ${inspectY - 9})`}>
              <rect x="0" y="0" width={inspectPriceTagW} height="18" rx="3" />
              <text x={inspectPriceTagW / 2} y="13" textAnchor="middle">
                {inspectPriceLabel}
              </text>
            </g>
            {rsiTagY != null ? (
              <g className="hybrid-cursor-tag is-price" transform={`translate(${PAD.l + 4} ${rsiTagY - 9})`}>
                <rect x="0" y="0" width={inspectRsiTagW} height="18" rx="3" />
                <text x={inspectRsiTagW / 2} y="13" textAnchor="middle">
                  {inspectRsiLabel}
                </text>
              </g>
            ) : null}
          </g>
        ) : null}
      </svg>

      {editAnchor && selected && t ? (
        <ChartEditBar
          drawing={selected}
          t={t}
          style={{
            left: `${Math.min(92, Math.max(8, (editAnchor.x / width) * 100))}%`,
            top: `${Math.min(88, Math.max(4, (editAnchor.y / height) * 100))}%`,
            transform: editAnchor.below ? "translate(-50%, 12px)" : "translate(-50%, calc(-100% - 10px))",
          }}
          onPatch={(patch) => onEditDrawing?.(selectedIndex, patch)}
          onDelete={() => onDeleteDrawing?.(selectedIndex)}
        />
      ) : null}

      {hoverCandle ? (
        <div className="hybrid-ohlc">
          <span>{formatCursorWhen(hoverCandle.t, locale)}</span>
          <span>O {formatQuotePerBase(hoverCandle.o, locale, quote)}</span>
          <span>H {formatQuotePerBase(hoverCandle.h, locale, quote)}</span>
          <span>L {formatQuotePerBase(hoverCandle.l, locale, quote)}</span>
          <span>C {formatQuotePerBase(hoverCandle.c, locale, quote)}</span>
          <span>V {formatToken(hoverCandle.v, locale, 2)}</span>
          {Number.isFinite(hoverRsi) ? <span>RSI {Number(hoverRsi).toFixed(1)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
