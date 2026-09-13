import {DRAW_COLORS, LINE_STYLES, LINE_WIDTHS} from "../chart/drawings";

export default function ChartEditBar({
  drawing,
  t,
  style,
  onPatch,
  onDelete,
}) {
  if (!drawing) return null;
  const color = drawing.color || "#3d8bff";
  const strokeWidth = LINE_WIDTHS.includes(Number(drawing.strokeWidth)) ? Number(drawing.strokeWidth) : 1;
  const lineStyle = LINE_STYLES.some((row) => row.id === drawing.lineStyle) ? drawing.lineStyle : "solid";
  return (
    <div
      className="hybrid-edit-bar"
      style={style}
      role="toolbar"
      aria-label={t.chartEditDrawing}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="hybrid-colors is-docked" role="group" aria-label="draw color">
        {DRAW_COLORS.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className={color === swatch.hex ? "hybrid-swatch active" : "hybrid-swatch"}
            style={{ background: swatch.hex }}
            title={swatch.id}
            aria-label={swatch.id}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPatch?.({ color: swatch.hex });
            }}
          />
        ))}
      </div>
      <div className="hybrid-style-row" role="group" aria-label={t.chartLineWidth}>
        {LINE_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            className={strokeWidth === width ? "hybrid-style-btn active" : "hybrid-style-btn"}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPatch?.({ strokeWidth: width });
            }}
            title={`${t.chartLineWidth} ${width}`}
          >
            <span className="hybrid-width-mark" style={{ height: Math.max(1, width) }} />
          </button>
        ))}
      </div>
      <div className="hybrid-style-row" role="group" aria-label={t.chartLineStyle}>
        {LINE_STYLES.map((row) => (
          <button
            key={row.id}
            type="button"
            className={lineStyle === row.id ? "hybrid-style-btn active" : "hybrid-style-btn"}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPatch?.({ lineStyle: row.id });
            }}
            title={t[`chartStyle_${row.id}`] || row.id}
          >
            <svg viewBox="0 0 22 8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="21"
                y2="4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeDasharray={row.dash || undefined}
              />
            </svg>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="hybrid-edit-delete"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete?.();
        }}
        title={t.chartDeleteDrawing}
        aria-label={t.chartDeleteDrawing}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 4h10M6 4V3h4v1M5 4l.6 9h4.8L11 4" />
        </svg>
      </button>
    </div>
  );
}
