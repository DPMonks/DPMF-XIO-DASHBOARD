import {useEffect, useRef} from "react";

/** Distinct Commander AI cursor overlay (not the user pointer). ASCII-safe. */
export default function AiChartCursor({ visible, x = 0, y = 0, label = "AIM", phase = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }, [x, y]);
  if (!visible) return null;
  return (
    <div
      ref={ref}
      className={`hybrid-ai-cursor${phase ? ` is-${phase}` : ""}`}
      aria-hidden="true"
      style={{ transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)` }}
    >
      <svg className="hybrid-ai-cursor-pointer" viewBox="0 0 24 24" width="22" height="22">
        <path
          d="M4 3 L4 18 L9 14 L12 21 L15 20 L12 13 L19 13 Z"
          fill="#7dd3fc"
          stroke="#0ea5e9"
          strokeWidth="1.2"
        />
      </svg>
      <span className="hybrid-ai-cursor-tag">{label}</span>
    </div>
  );
}
