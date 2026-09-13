import {useEffect, useMemo, useRef, useState} from "react";
import {DECK_FOCUS_EVENT, readJumpHash} from "../siteJump";
import Skeleton from "./Skeleton";

/**
 * Mount deck body only when near the viewport, jump-targeted, or eager.
 * Section shells keep their ids; pass `ids` when several jump targets share one body
 * (e.g. trading + swap + orderbook). Once active, stays mounted.
 */
export default function DeckGate({
  id,
  ids,
  minHeight = 280,
  rootMargin = "320px 0px",
  eager = false,
  className = "",
  fallback = null,
  placeholderIds = null,
  children,
}) {
  const ref = useRef(null);
  const watch = useMemo(() => {
    if (Array.isArray(ids) && ids.length) return ids.filter(Boolean);
    return id ? [id] : [];
  }, [id, ids]);

  const [active, setActive] = useState(() => {
    if (eager) return true;
    if (typeof window === "undefined") return false;
    const hash = readJumpHash(window.location.hash);
    return Boolean(hash && watch.includes(hash));
  });

  useEffect(() => {
    if (active) return undefined;
    function maybeActivate(target) {
      if (target && watch.includes(target)) setActive(true);
    }
    function onFocus(event) {
      maybeActivate(event?.detail?.id || readJumpHash(window.location.hash));
    }
    function onHash() {
      maybeActivate(readJumpHash(window.location.hash));
    }
    window.addEventListener(DECK_FOCUS_EVENT, onFocus);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(DECK_FOCUS_EVENT, onFocus);
      window.removeEventListener("hashchange", onHash);
    };
  }, [active, watch]);

  useEffect(() => {
    if (active) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver !== "function") {
      setActive(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          obs.disconnect();
        }
      },
      { rootMargin }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [active, rootMargin]);

  const anchors = !active && Array.isArray(placeholderIds) ? placeholderIds.filter(Boolean) : [];

  return (
    <div
      ref={ref}
      className={className}
      data-deck-gate={watch.join(",") || id || ""}
      data-deck-ready={active ? "1" : "0"}
      style={active ? undefined : { minHeight }}
    >
      {anchors.map((anchor) => (
        <div key={anchor} id={anchor} style={{ height: 0, overflow: "hidden" }} aria-hidden="true" />
      ))}
      {active ? children : fallback || <Skeleton height={Math.min(minHeight, 320)} />}
    </div>
  );
}
