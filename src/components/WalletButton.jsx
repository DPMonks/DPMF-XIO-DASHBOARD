import {useRef} from "react";
import xamanLogo from "../assets/XAMAN.jpg";
import {useI18n} from "../i18n/useI18n";

export default function WalletButton({
  onClick,
  disabled,
  connected = false,
  address,
  label,
  title,
  className,
}) {
  const { t } = useI18n();
  const caption = label || (connected ? `${t.connected} ${address}` : t.connectWallet);
  const armed = useRef(0);

  function fire(event) {
    if (disabled || !onClick) return;
    const now = Date.now();
    if (now - armed.current < 400) return;
    armed.current = now;
    onClick(event);
  }

  return (
    <button
      type="button"
      className={[connected && !label ? "connect-wallet-btn is-connected" : "connect-wallet-btn", className]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={(event) => {
        if (event.button) return;
        fire(event);
      }}
      onTouchEnd={(event) => {
        if (disabled) return;
        if (event.cancelable) event.preventDefault();
        fire(event);
      }}
      onClick={fire}
      disabled={disabled}
      title={title || (connected ? t.disconnect : t.connectWallet)}
    >
      <img src={xamanLogo} alt="" className="wallet-btn-logo" />
      {connected && !label ? (
        <>
          <span className="wallet-status-online" aria-hidden="true">
            ●
          </span>
          <span>
            {t.connected} {address}
          </span>
        </>
      ) : (
        <span>{caption}</span>
      )}
    </button>
  );
}
