import {useI18n} from "../i18n/useI18n";
import WalletButton from "./WalletButton";

const ACTIONS = [
  { id: "buy", labelKey: "buyXio" },
  { id: "sell", labelKey: "sellXio" },
  { id: "addLp", labelKey: "addLiquidity" },
  { id: "removeLp", labelKey: "removeLiquidity" },
];

export default function TradeBar({ onAction, compact = false }) {
  const { t } = useI18n();
  return (
    <div className={compact ? "trade-bar is-compact" : "trade-bar"} role="group" aria-label={t.tradeActions}>
      {ACTIONS.map((row) => (
        <WalletButton
          key={row.id}
          label={t[row.labelKey]}
          title={t[row.labelKey]}
          onClick={() => {
            if (onAction) onAction(row.id);
            else window.dispatchEvent(new CustomEvent("dpmf-open-trade", { detail: row.id }));
          }}
        />
      ))}
    </div>
  );
}
