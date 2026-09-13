import {useEffect, useRef, useState} from "react";
import "./DexChart.css";

const DEX_SRC =
  "https://dexscreener.com/xrpl/xio.rmjaxysbnzhwp7ffynasyp5ty3r9xnurpo_xrp?embed=1&theme=dark&info=0&trades=0";

export default function DexChart() {
  const frameRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [showRetry, setShowRetry] = useState(false);

  const reload = () => {
    const frame = frameRef.current;
    if (!frame) return;
    setLoading(true);
    setShowRetry(false);
    frame.src = DEX_SRC;
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(false);
      setShowRetry(true);
    }, 10000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="dex-wrapper">
      <div className="dex-shimmer" />
      <div className="dex-responsive">
        <iframe
          ref={frameRef}
          title="XIO / XRP Dexscreener chart"
          src={DEX_SRC}
          className="dex-iframe"
          onLoad={() => {
            setLoading(false);
            setShowRetry(false);
          }}
        />
        {loading && <div className="dex-loading">Loading chart…</div>}
        {showRetry && (
          <button type="button" className="dex-retry" onClick={reload}>
            Retry Loading Chart
          </button>
        )}
      </div>
    </div>
  );
}
