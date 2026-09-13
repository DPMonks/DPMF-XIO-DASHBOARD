import {feeBadgeForMode} from "../../swap/swapFeeCalculator.js";
import {SWAP_MODES, normalizeSwapMode} from "../../swap/swapModes.js";

export default function SwapModeSelector({ value, onChange }) {
  const current = normalizeSwapMode(value);
  return (
    <div className="xio-swap-mode-list" role="radiogroup" aria-label="Swap options">
      {SWAP_MODES.map((mode) => {
        const on = current === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            className={on ? "is-on" : ""}
            aria-checked={on}
            title={mode.user}
            onClick={() => onChange(mode.id)}
          >
            <span className="xio-swap-radio-mark" aria-hidden="true" />
            <span className="xio-swap-radio-copy">
              <b>
                {mode.title}
                {mode.recommended ? <em>Rec</em> : null}
              </b>
              <span className="xio-swap-fee-badge">{feeBadgeForMode(mode.id)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
