import {feeRowsForMode} from "../../swap/swapFeeCalculator.js";
import {smartAdvisorNote} from "../../swap/swapRouting.js";
import {swapModeById} from "../../swap/swapModes.js";

export function SwapHopPath({ hops = [] }) {
  if (!hops.length) return null;
  return (
    <ol className="xio-swap-hops">
      {hops.map((hop, index) => (
        <li key={`${hop.from}-${hop.to}-${index}`}>
          <span>
            {hop.from} → {hop.to}
          </span>
          <small>{hop.venue || "path"}</small>
        </li>
      ))}
    </ol>
  );
}

export default function SwapModeExplanation({
  modeId,
  quote,
  fromTicker,
  toTicker,
  hops = [],
  developer = false,
  onToggleView,
}) {
  const mode = swapModeById(modeId);
  const fees = feeRowsForMode(modeId);
  const advisor = smartAdvisorNote({ quote, fromTicker, toTicker, routingMode: modeId });
  return (
    <div className="xio-swap-explain">
      <div className="xio-swap-explain-head">
        <p className="xio-swap-tip-kicker">{mode.title}</p>
        <button type="button" className="xio-swap-view" onClick={onToggleView}>
          {developer ? "Simple" : "Technical"}
        </button>
      </div>
      <p>{developer ? mode.technical : mode.user}</p>
      <ul className="xio-swap-fees">
        {fees.map((row) => (
          <li key={row.label}>
            <span>{row.label}</span>
            <b>{row.fee}</b>
          </li>
        ))}
      </ul>
      <p className="xio-swap-advisor-note">{advisor}</p>
      <SwapHopPath hops={hops} />
      {mode.docs ? (
        <a className="xio-swap-learn" href={mode.docs} target="_blank" rel="noreferrer">
          Learn more
        </a>
      ) : null}
    </div>
  );
}
