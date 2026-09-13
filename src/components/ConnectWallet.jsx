import {useCallback, useEffect, useRef, useState} from "react";
import {useWallet} from "../context/useWallet";
import {shortAddress} from "../utils/format";
import {claimExecutedTrade, claimSignedWallet} from "../xaman/claimSignIn";
import {clearXamanReturn, peekPendingPayload, peekXamanUuid, shouldAutoClaimPendingTrade} from "../xaman/payloadResume";
import {liveWalletAddress, resolveNeedSignIn} from "../wallet/walletStorage";
import {WALLET_EVENTS} from "../xaman/tradeTx";
import {useXamanPayload} from "../xaman/useXamanPayload";
import {isXappHost} from "../xaman/xappHost";
import {useI18n} from "../i18n/useI18n";
import WalletButton from "./WalletButton";
import WalletModal from "./WalletModal";

export default function ConnectWallet() {
  const { t } = useI18n();
  const { walletAddress, connectWallet, disconnectWallet, xappBooting } = useWallet();
  const { qr, mobileUrl, uuid, status, error, start, reset } = useXamanPayload();
  const startRef = useRef(start);
  const resetRef = useRef(reset);
  const claimingRef = useRef(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    startRef.current = start;
    resetRef.current = reset;
  }, [start, reset]);

  const finishSignIn = useCallback((account) => {
    if (!account) return;
    connectWallet(account);
    clearXamanReturn();
    window.dispatchEvent(new CustomEvent(WALLET_EVENTS.signedIn, { detail: { account } }));
  }, [connectWallet]);

  const completePendingSignIn = useCallback(async () => {
    const pendingRecord = peekPendingPayload();
    const pending = peekXamanUuid();
    if (pendingRecord?.watchTrade) {
      if (!shouldAutoClaimPendingTrade()) return;
      if (claimingRef.current) return;
      claimingRef.current = true;
      try {
        const claimed = await claimExecutedTrade(pending);
        if (claimed?.executed) clearXamanReturn();
      } finally {
        claimingRef.current = false;
      }
      return;
    }
    if (liveWalletAddress(walletAddress)) {
      if (!pendingRecord?.watchTrade) clearXamanReturn();
      return;
    }
    if (!pending || claimingRef.current) return;
    claimingRef.current = true;
    window.setTimeout(() => setClaiming(true), 0);
    try {
      const account = await claimSignedWallet(pending);
      if (account) {
        finishSignIn(account);
        resetRef.current();
        return;
      }
      startRef.current({
        resumeUuid: pending,
        onSigned: (signed) => {
          if (signed) finishSignIn(signed);
        },
        errorMessage: t.walletError,
      });
    } finally {
      claimingRef.current = false;
      window.setTimeout(() => setClaiming(false), 0);
    }
  }, [walletAddress, finishSignIn, t.walletError]);

  function startConnection() {
    if (liveWalletAddress(walletAddress)) {
      reset();
      disconnectWallet();
      return;
    }

    start({
      onSigned: finishSignIn,
      errorMessage: t.walletError,
    });
  }

  function cancelSignIn() {
    reset();
    window.dispatchEvent(new Event(WALLET_EVENTS.signInCancelled));
  }

  useEffect(() => {
    function onNeedSignIn() {
      const next = resolveNeedSignIn(walletAddress);
      if (next.action === "already-signed-in") {
        if (!walletAddress) connectWallet(next.account);
        window.dispatchEvent(
          new CustomEvent(WALLET_EVENTS.signedIn, { detail: { account: next.account } })
        );
        return;
      }
      startRef.current({
        onSigned: finishSignIn,
        errorMessage: t.walletError,
      });
    }
    window.addEventListener(WALLET_EVENTS.needSignIn, onNeedSignIn);
    return () => window.removeEventListener(WALLET_EVENTS.needSignIn, onNeedSignIn);
  }, [walletAddress, connectWallet, finishSignIn, t.walletError]);

  useEffect(() => {
    const boot = window.setTimeout(() => {
      completePendingSignIn();
    }, 0);
    function wake() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      window.setTimeout(() => completePendingSignIn(), 0);
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(boot);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("focus", wake);
    };
  }, [completePendingSignIn]);

  const waiting = status === "loading" || status === "waiting" || claiming;

  return (
    <div className="wallet-control">
      <WalletButton
        onClick={startConnection}
        disabled={waiting || (Boolean(xappBooting) && isXappHost())}
        connected={Boolean(walletAddress)}
        address={shortAddress(walletAddress)}
      />
      {error && <p className="wallet-error">{error}</p>}
      <WalletModal
        visible={waiting}
        qrUrl={qr}
        mobileUrl={mobileUrl}
        uuid={uuid}
        status={claiming && status === "idle" ? "loading" : status}
        preparingLabel={t.preparing}
        onClose={cancelSignIn}
      />
    </div>
  );
}
