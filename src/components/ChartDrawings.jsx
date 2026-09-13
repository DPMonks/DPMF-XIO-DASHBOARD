import {channelOffset, dashForStyle, drawingHandles, extendSegment, fibBands, fibExtent, fibExtensionBands, fibLabelPlacement, fibToolLabelPlacement, pitchforkRays, plotX, plotY, rangeColor, raySegment, rangeStats} from "../chart/drawings";
import {formatAxisPrice, formatPriceLabel} from "../chart/axis";

function stroke(row) {
  return row?.color || "#d1d4dc";
}

function paint(color, row = {}) {
  return {
    stroke: color,
    color,
    strokeWidth: row.strokeWidth || 1,
    strokeDasharray: row.dasharray || dashForStyle(row.lineStyle) || undefined,
  };
}

function Line({ a, b, scale, color, dashed, marker, row }) {
  if (!a || !b) return null;
  return (
    <line
      className={dashed ? "hybrid-draw is-preview" : "hybrid-draw"}
      x1={plotX(a, scale)}
      y1={plotY(a, scale)}
      x2={plotX(b, scale)}
      y2={plotY(b, scale)}
      style={paint(color, row)}
      markerEnd={marker}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function FibRetracement({ row, scale, pad, plotBottom, clipId, dashed }) {
  const span = fibExtent(row.a, row.b);
  if (!span) return null;
  const x0 = scale.x(span.t0);
  const x1 = scale.x(span.t1);
  const width = Math.max(1, x1 - x0);
  const bands = fibBands(row.a, row.b);
  const topBound = (pad?.t ?? 16) + 8;
  const bottomBound = (plotBottom ?? 364) - 4;
  const clip = clipId ? `url(#${clipId})` : undefined;
  const zero = bands.find((band) => band.level === 0);
  const one = bands.find((band) => band.level === 1);
  return (
    <g className={dashed ? "hybrid-fib is-preview" : "hybrid-fib"}>
      <g clipPath={clip}>
        {zero && one ? (
          <rect
            className="hybrid-fib-frame"
            x={x0}
            y={Math.min(scale.y(zero.price), scale.y(one.price))}
            width={width}
            height={Math.max(1, Math.abs(scale.y(one.price) - scale.y(zero.price)))}
          />
        ) : null}
        {bands.map((band) => {
          const y = scale.y(band.price);
          const nextY = band.nextPrice != null ? scale.y(band.nextPrice) : y;
          const top = Math.min(y, nextY);
          const height = Math.abs(nextY - y);
          return (
            <g key={`band-${band.level}`}>
              {band.nextPrice != null && height > 0.25 ? (
                <rect
                  className="hybrid-fib-fill"
                  x={x0}
                  y={top}
                  width={width}
                  height={height}
                  style={{ fill: band.color, fillOpacity: 0.28 }}
                />
              ) : null}
              <line
                className="hybrid-fib-line"
                x1={x0}
                x2={x1}
                y1={y}
                y2={y}
                style={paint(band.color, row)}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
        <Line a={row.a} b={row.b} scale={scale} color="#787B86" dashed={false} />
      </g>
      {bands.map((band) => {
        const y = scale.y(band.price);
        if (y < topBound - 20 || y > bottomBound + 20) return null;
        const yLabel = Math.min(bottomBound, Math.max(topBound, y));
        const label = fibToolLabelPlacement(x0, x1, {
          padLeft: (pad?.l ?? 16) + 4,
          padRight: x1 + 120,
          gap: 12,
        });
        return (
          <text
            key={`label-${band.level}`}
            className={`hybrid-draw-label hybrid-fib-label ${label.textAnchor === "end" ? "is-left" : "is-right"}`}
            x={label.x}
            y={yLabel + 3}
            textAnchor={label.textAnchor}
            style={{ fill: band.color, textAnchor: label.textAnchor }}
          >
            {band.label} ({formatAxisPrice(band.price)})
          </text>
        );
      })}
    </g>
  );
}

function Handles({ row, scale, fallbackPrice, activeKey }) {
  return drawingHandles(row, fallbackPrice).map((handle) => (
    <circle
      key={`handle-${handle.key}`}
      className={activeKey === handle.key ? "hybrid-handle is-active" : "hybrid-handle"}
      cx={plotX(handle, scale)}
      cy={plotY(handle, scale)}
      r="4"
    />
  ));
}

export default function ChartDrawings({
  drawings = [],
  scale,
  pad,
  width,
  plotBottom,
  clipId,
  activeHandle,
  selectedIndex = null,
}) {
  const tMin = scale.start;
  const tMax = scale.end;
  const items = drawings;

  return (
    <g className="hybrid-drawings">
      {items.map((row, index) => {
        const color = stroke(row);
        const dashed = row.preview;
        const key = `${row.kind}-${index}-${row.preview ? "p" : "d"}`;
        if ((row.kind === "hline" || row.kind === "hray" || row.kind === "crossline") && Number.isFinite(Number(row.price))) {
          const x1 = row.kind === "hray" && Number(row.t) > 0 ? scale.x(row.t) : pad.l;
          const y = scale.y(row.price);
          return (
            <g key={key}>
              <line
                className={dashed ? "hybrid-draw is-preview" : "hybrid-draw"}
                x1={x1}
                x2={width - pad.r}
                y1={y}
                y2={y}
                style={paint(color, row)}
                vectorEffect="non-scaling-stroke"
              />
              {row.kind === "crossline" && Number.isFinite(Number(row.t)) ? (
                <line
                  className={dashed ? "hybrid-draw is-preview" : "hybrid-draw"}
                  x1={scale.x(row.t)}
                  x2={scale.x(row.t)}
                  y1={pad.t}
                  y2={plotBottom}
                  style={paint(color, row)}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        }
        if (row.kind === "vline" && Number.isFinite(Number(row.t))) {
          return (
            <line
              key={key}
              className={dashed ? "hybrid-draw is-preview" : "hybrid-draw"}
              x1={scale.x(row.t)}
              x2={scale.x(row.t)}
              y1={pad.t}
              y2={plotBottom}
              style={paint(color, row)}
              vectorEffect="non-scaling-stroke"
            />
          );
        }
        if ((row.kind === "trend" || row.kind === "infoline") && row.a && row.b) {
          const stats = rangeStats(row.a, row.b);
          const midX = (scale.x(row.a.t) + scale.x(row.b.t)) / 2;
          const midY = (scale.y(row.a.price) + scale.y(row.b.price)) / 2;
          return (
            <g key={key}>
              <Line a={row.a} b={row.b} scale={scale} color={color} dashed={dashed} row={row} />
              {row.kind === "infoline" ? (
                <text className="hybrid-draw-label" x={midX + 6} y={midY - 6} style={{ fill: color }}>
                  {formatAxisPrice(stats.delta)} ({stats.pct.toFixed(2)}%)
                </text>
              ) : null}
            </g>
          );
        }
        if (row.kind === "arrow" && row.a && row.b) {
          const mark = `arrow-${key.replace(/[^a-z0-9-]/gi, "")}`;
          return (
            <g key={key}>
              <defs>
                <marker id={mark} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L7,3 L0,6 Z" fill={color} />
                </marker>
              </defs>
              <Line a={row.a} b={row.b} scale={scale} color={color} dashed={dashed} marker={`url(#${mark})`} row={row} />
            </g>
          );
        }
        if (row.kind === "ray" && row.a && row.b) {
          const [a, b] = raySegment(row.a, row.b, tMin, tMax);
          return <Line key={key} a={a} b={b} scale={scale} color={color} dashed={dashed} row={row} />;
        }
        if (row.kind === "extended" && row.a && row.b) {
          const [a, b] = extendSegment(row.a, row.b, tMin, tMax);
          return <Line key={key} a={a} b={b} scale={scale} color={color} dashed={dashed} row={row} />;
        }
        if ((row.kind === "rect" || row.kind === "range") && row.a && row.b) {
          const x = Math.min(plotX(row.a, scale), plotX(row.b, scale));
          const y = Math.min(plotY(row.a, scale), plotY(row.b, scale));
          const w = Math.max(1, Math.abs(plotX(row.b, scale) - plotX(row.a, scale)));
          const h = Math.max(1, Math.abs(plotY(row.b, scale) - plotY(row.a, scale)));
          const stats = rangeStats(row.a, row.b);
          const tone = row.kind === "range" ? rangeColor(row.a, row.b) : color;
          const clip = clipId ? `url(#${clipId})` : undefined;
          return (
            <g key={key} clipPath={row.kind === "range" ? clip : undefined}>
              <rect
                className={dashed ? "hybrid-shape is-preview" : "hybrid-shape"}
                x={x}
                y={y}
                width={w}
                height={h}
                style={{ ...paint(tone, row), fill: tone, fillOpacity: row.kind === "range" ? 0.14 : 0.06 }}
              />
              {row.kind === "range" ? (
                <text className="hybrid-draw-label" x={x + 6} y={y + 12} style={{ fill: tone }}>
                  {formatAxisPrice(stats.delta)} ({stats.pct.toFixed(2)}%)
                </text>
              ) : null}
            </g>
          );
        }
        if (row.kind === "channel" && row.a && row.b) {
          const offset = row.c ? channelOffset(row.a, row.b, row.c) : 0;
          const parallel = [
            { t: row.a.t, price: row.a.price + offset },
            { t: row.b.t, price: row.b.price + offset },
          ];
          return (
            <g key={key}>
              <Line a={row.a} b={row.b} scale={scale} color={color} dashed={dashed} row={row} />
              {row.c ? <Line a={parallel[0]} b={parallel[1]} scale={scale} color={color} dashed={dashed} row={row} /> : null}
            </g>
          );
        }
        if (row.kind === "fib" && row.a && row.b) {
          return (
            <FibRetracement
              key={key}
              row={row}
              scale={scale}
              pad={pad}
              plotBottom={plotBottom}
              clipId={clipId}
              dashed={dashed}
            />
          );
        }
        if (row.kind === "fibext" && row.a && row.b && row.c) {
          const bands = fibExtensionBands(row.a, row.b, row.c);
          const x0 = scale.x(row.c.t);
          const x1 = width - pad.r;
          const toolLeft = Math.min(scale.x(row.a.t), scale.x(row.b.t), x0);
          const label = fibLabelPlacement(toolLeft, { side: "left", gap: 10, minX: (pad?.l ?? 16) + 4 });
          return (
            <g key={key} className={dashed ? "hybrid-fib is-preview" : "hybrid-fib"}>
              {bands.map((band) => (
                <g key={`ext-${band.level}`}>
                  <line
                    className="hybrid-fib-line"
                    x1={x0}
                    x2={x1}
                    y1={scale.y(band.price)}
                    y2={scale.y(band.price)}
                    style={paint(band.color, row)}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    className="hybrid-draw-label hybrid-fib-label is-left"
                    x={label.x}
                    y={scale.y(band.price) + 3}
                    textAnchor="end"
                    style={{ fill: band.color, textAnchor: "end" }}
                  >
                    {band.label} ({formatAxisPrice(band.price)})
                  </text>
                </g>
              ))}
              <Line a={row.a} b={row.b} scale={scale} color="#787B86" dashed={dashed} row={row} />
            </g>
          );
        }
        if (row.kind === "pitchfork" && row.a && row.b && row.c) {
          return (
            <g key={key}>
              {pitchforkRays(row.a, row.b, row.c, tMin, tMax).map((seg, i) => (
                <Line key={`fork-${i}`} a={seg[0]} b={seg[1]} scale={scale} color={color} dashed={dashed} row={row} />
              ))}
            </g>
          );
        }
        if ((row.kind === "ellipse" || row.kind === "circle") && row.a && row.b) {
          const x1 = plotX(row.a, scale);
          const y1 = plotY(row.a, scale);
          const x2 = plotX(row.b, scale);
          const y2 = plotY(row.b, scale);
          const cx = row.kind === "circle" ? x1 : (x1 + x2) / 2;
          const cy = row.kind === "circle" ? y1 : (y1 + y2) / 2;
          const rx = row.kind === "circle" ? Math.hypot(x2 - x1, y2 - y1) : Math.max(1, Math.abs(x2 - x1) / 2);
          const ry = row.kind === "circle" ? rx : Math.max(1, Math.abs(y2 - y1) / 2);
          return (
            <ellipse
              key={key}
              className={dashed ? "hybrid-shape is-preview" : "hybrid-shape"}
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              style={{ ...paint(color, row), fill: color, fillOpacity: 0.06 }}
            />
          );
        }
        if (String(row.kind).startsWith("elliott") && Array.isArray(row.points) && row.points.length) {
          const coords = row.points.map((point) => `${plotX(point, scale)},${plotY(point, scale)}`).join(" ");
          return (
            <g key={key} className={dashed ? "hybrid-wave is-preview" : "hybrid-wave"}>
              <polyline
                className={dashed ? "hybrid-draw is-preview" : "hybrid-draw"}
                points={coords}
                style={{ ...paint(color, row), fill: "none" }}
                vectorEffect="non-scaling-stroke"
              />
              {row.points.map((point, index) => (
                <text
                  key={`wave-${index}`}
                  className="hybrid-draw-label"
                  x={plotX(point, scale) + 6}
                  y={plotY(point, scale) - 6}
                  style={{ fill: color }}
                >
                  {(row.labels || [])[index] || String(index + 1)}
                </text>
              ))}
            </g>
          );
        }
        if (row.kind === "triangle" && row.a && row.b && row.c) {
          const points = [row.a, row.b, row.c].map((point) => `${plotX(point, scale)},${plotY(point, scale)}`).join(" ");
          return (
            <polygon
              key={key}
              className={dashed ? "hybrid-shape is-preview" : "hybrid-shape"}
              points={points}
              style={{ ...paint(color, row), fill: color, fillOpacity: 0.06 }}
            />
          );
        }
        if (row.kind === "text" && row.t && Number.isFinite(Number(row.price))) {
          return (
            <text key={key} className="hybrid-draw-label is-note" x={scale.x(row.t)} y={scale.y(row.price)} style={{ fill: color }}>
              {row.text || "Note"}
            </text>
          );
        }
        if (row.kind === "pricelabel" && Number.isFinite(Number(row.price))) {
          const cx = Number(row.t) > 0 ? scale.x(row.t) : pad.l + 80;
          const cy = scale.y(row.price);
          const label = formatPriceLabel(row.price);
          const boxW = Math.max(72, 8 + label.length * 6.2);
          const boxH = 18;
          const gap = 8;
          let boxX = cx - gap - boxW;
          if (boxX < pad.l + 2) boxX = cx + gap;
          const boxY = cy - boxH / 2;
          const tickX1 = cx;
          const tickX2 = boxX < cx ? boxX + boxW : boxX;
          return (
            <g key={key} className={dashed ? "hybrid-price-tag is-preview" : "hybrid-price-tag"}>
              <line
                className={dashed ? "hybrid-draw is-preview" : "hybrid-draw"}
                x1={tickX1}
                x2={tickX2}
                y1={cy}
                y2={cy}
                style={paint(color, row)}
                vectorEffect="non-scaling-stroke"
              />
              <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="3" style={{ stroke: color }} />
              <text x={boxX + boxW / 2} y={boxY + 13} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        }
        return null;
      })}
      {drawings.map((row, index) =>
        selectedIndex === index ? (
          <g key={`handles-${index}`}>
            <Handles
              row={row}
              scale={scale}
              fallbackPrice={(scale.min + scale.max) / 2}
              activeKey={activeHandle?.index === index ? activeHandle.key : null}
            />
          </g>
        ) : null
      )}
    </g>
  );
}
