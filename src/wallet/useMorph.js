import {useEffect, useRef, useState} from "react";
import {easeInOutCubic, lerp} from "../utils/lineDrift";

export const WALLET_MORPH_MS = 400;

export function useMorph(target, duration = WALLET_MORPH_MS) {
  const [value, setValue] = useState(() => (Number.isFinite(Number(target)) ? Number(target) : 0));
  const frame = useRef(0);
  const fromRef = useRef(value);

  useEffect(() => {
    const to = Number.isFinite(Number(target)) ? Number(target) : 0;
    const start = Number.isFinite(Number(fromRef.current)) ? Number(fromRef.current) : 0;
    const begun = performance.now();
    cancelAnimationFrame(frame.current);

    const tick = (now) => {
      const t = Math.min(1, (now - begun) / duration);
      const next = lerp(start, to, easeInOutCubic(t));
      setValue(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration]);

  return value;
}
