import {useEffect, useRef, useState} from "react";
import {detectTradeExecution, isEngineFailure, isTradeTxjson} from "./detectExecution";
import {clearXamanReturn, isConsumedUuid, markXamanReturn, rememberPendingPayload, xamanWebsocketUrl} from "./payloadResume";
import {stampExchangeMemo} from "./exchangeMemo";
import {extractTradeMarkerFromPayload, stampTradeTxjson} from "./signMarker";
import {notifyFunctionConfirmed, notifyTradeExecuted, notifyTradeFailed, notifyTradePending, notifyTradeUnconfirmed} from "./tradeTx";
import {createPayload, extractSignedAccount, getLedgerTx, getPayloadResult, isReusableUnsignedPayload, normalizePayload, payloadLooksSigned, payloadQrUrl, payloadSignedThisSession, xamanAppUrl} from "./xamanClient";
import {isXappHost, isXappPayloadEvent, listenXappEvents, openXappSignRequest} from "./xappHost";
import {nextPayloadSession, payloadSessionOpen} from "./payloadSession";

export { nextPayloadSession, payloadSessionOpen };

export function useXamanPayload() {
  const [qr, setQr] = useState(null);
  const [mobileUrl, setMobileUrl] = useState(null);
  const [uuid, setUuid] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const socketRef = useRef(null);
  const timeoutRef = useRef(null);
  const pollRef = useRef(null);
  const sessionRef = useRef(0);
  const busyRef = useRef(false);
  const settleRef = useRef(null);

  const clearTimers = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const reset = (options = {}) => {
    sessionRef.current = nextPayloadSession(sessionRef.current);
    busyRef.current = false;
    settleRef.current = null;
    clearTimers();
    setQr(null);
    setMobileUrl(null);
    setUuid(null);
    setStatus("idle");
    if (!options.keepPending) clearXamanReturn();
  };

  useEffect(() => {
    return () => {
      sessionRef.current = nextPayloadSession(sessionRef.current);
      busyRef.current = false;
      settleRef.current = null;
      clearTimers();
    };
  }, []);

  useEffect(() => {
    function wake() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      settleRef.current?.();
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
    const stopXapp = isXappHost()
      ? listenXappEvents((event) => {
          if (isXappPayloadEvent(event)) settleRef.current?.();
        })
      : () => {};
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("focus", wake);
      stopXapp();
    };
  }, []);

  async function start({ body = {}, onSigned, onExecuted, onFailed, errorMessage, resumeUuid, trade } = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    const session = nextPayloadSession(sessionRef.current);
    sessionRef.current = session;
    const stamped = stampTradeTxjson(stampExchangeMemo(body?.txjson, { trade }));
    const request = body?.txjson ? { ...body, txjson: stamped.txjson } : body;
    const signMarker = stamped.marker || "";
    const txType = String(request?.txjson?.TransactionType || "");
    const watchTrade = isTradeTxjson(request?.txjson) || txType === "AMMVote";
    const watchConfirm = watchTrade || txType === "TrustSet";
    let announced = false;
    let finishing = false;
    let latestPayload = null;
    let latestSocket = null;
    let latestLedger = null;
    const startedAt = Date.now();
    let payloadUuid = resumeUuid || null;
    if (resumeUuid && isConsumedUuid(resumeUuid)) {
      resumeUuid = "";
      payloadUuid = null;
    }
    if (!resumeUuid) clearXamanReturn();

    const markerAllows = (payload) => {
      if (!signMarker || !payload) return true;
      const sent =
        payload?.payload?.request_json ||
        payload?.payload?.txjson ||
        payload?.txjson ||
        payload?.request_json;
      if (!sent) return true;
      return extractTradeMarkerFromPayload(payload) === signMarker;
    };

    const announce = (detection) => {
      if (announced) return false;
      if (detection?.failed) {
        announced = true;
        onFailed?.(detection);
        if (watchTrade) {
          notifyTradeFailed({
            ...detection,
            uuid: payloadUuid,
            txjson: request?.txjson,
            trade: trade || request?.trade || null,
            signMarker,
          });
        }
        return true;
      }
      if (!detection?.executed) return false;
      if (!markerAllows(latestPayload)) return false;
      announced = true;
      if (payloadUuid) rememberPendingPayload(payloadUuid, { signState: "executed", signMarker });
      onExecuted?.(detection);
      if (watchTrade) {
        notifyTradeExecuted({
          ...detection,
          uuid: payloadUuid,
          txjson: request?.txjson,
          trade: trade || request?.trade || null,
          ledger: latestLedger,
          signMarker,
        });
      } else if (txType === "TrustSet") {
        notifyFunctionConfirmed({ ...detection, uuid: payloadUuid, txjson: request?.txjson, signMarker });
      }
      return true;
    };

    const inspect = async () => {
      if (latestPayload?.response?.txid || latestPayload?.meta?.signed) {
        const hash = detectTradeExecution({ payload: latestPayload, socket: latestSocket }).txid;
        if (hash) latestLedger = (await getLedgerTx(hash).catch(() => null)) || latestLedger;
      }
      return detectTradeExecution({
        payload: latestPayload,
        socket: latestSocket,
        ledger: latestLedger,
      });
    };

    try {
      setError(null);
      setStatus("loading");

      let payload = null;
      if (resumeUuid) {
        const existing = await getPayloadResult(resumeUuid).catch(() => null);
        if (isReusableUnsignedPayload(existing)) {
          payload = normalizePayload(existing) || {
            uuid: resumeUuid,
            qr: payloadQrUrl(resumeUuid),
            mobileUrl: xamanAppUrl(resumeUuid),
            websocket: xamanWebsocketUrl(resumeUuid),
          };
        }
      }
      if (!payload) {
        if (resumeUuid) clearXamanReturn();
        payload = await createPayload({
          ...request,
          options: { ...request.options, signMarker },
        });
      }
      if (!payloadSessionOpen(session, sessionRef.current)) {
        busyRef.current = false;
        return;
      }
      payloadUuid = payload.uuid;
      markXamanReturn(payload.uuid, {
        watchTrade,
        txjson: request?.txjson || null,
        trade: trade || null,
        signMarker: signMarker || null,
        signState: "unsigned",
      });
      if (watchTrade) {
        notifyTradePending({
          uuid: payload.uuid,
          signMarker,
          txjson: request?.txjson || null,
          trade: trade || null,
        });
      }
      setQr(payload.qr);
      setMobileUrl(payload.mobileUrl);
      setUuid(payload.uuid);
      setStatus("waiting");
      if (isXappHost() && payload.uuid) openXappSignRequest(payload.uuid);

      timeoutRef.current = setTimeout(() => {
        if (payloadSessionOpen(session, sessionRef.current)) reset();
      }, 300000);

      const finish = async (account, result) => {
        if (finishing || !payloadSessionOpen(session, sessionRef.current)) return;
        finishing = true;
        if (result) latestPayload = result;
        let signedAccount = account || extractSignedAccount(result);
        if (!signedAccount && payloadLooksSigned(result)) {
          for (let attempt = 0; attempt < 5 && !signedAccount; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            if (!payloadSessionOpen(session, sessionRef.current)) return;
            const next = await getPayloadResult(payload.uuid).catch(() => null);
            if (next) {
              latestPayload = next;
              signedAccount = extractSignedAccount(next);
            }
          }
        }
        const detection = await inspect();
        const looksSigned =
          payloadSignedThisSession(result, startedAt) ||
          payloadSignedThisSession(latestPayload, startedAt);
        if (looksSigned) {
          if (payloadUuid && !detection.executed) {
            rememberPendingPayload(payloadUuid, { signState: "signed", signMarker });
          }
          onSigned?.(signedAccount, latestPayload || result);
          setQr(null);
          setMobileUrl(null);
          setStatus(detection.executed ? "signed" : "confirming");
        }
        if (watchConfirm && looksSigned) {
          if (announce(detection)) {
            reset();
            setStatus(detection.executed ? "signed" : "failed");
            return;
          }
          const started = Date.now();
          while (payloadSessionOpen(session, sessionRef.current) && Date.now() - started < 30000) {
            const next = await getPayloadResult(payload.uuid).catch(() => null);
            if (next) latestPayload = next;
            const again = await inspect();
            if (announce(again)) {
              reset();
              setStatus(again.executed ? "signed" : "failed");
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (looksSigned && !announced && watchTrade) {
            const last = await inspect();
            if (last.executed && announce(last)) {
              reset();
              setStatus("signed");
              return;
            }
            if (last.failed || isEngineFailure(last.engineResult)) {
              announce({ ...last, failed: true });
              reset();
              setStatus("failed");
              return;
            }
            notifyTradeUnconfirmed({
              ...detection,
              uuid: payloadUuid,
              txjson: request?.txjson,
              signMarker,
              account: signedAccount,
            });
          }
        }
        reset({
          keepPending: watchConfirm && looksSigned && !announced,
        });
        setStatus(looksSigned ? "signed" : "idle");
      };

      const settle = async () => {
        if (!payloadSessionOpen(session, sessionRef.current)) return;
        const result = await getPayloadResult(payload.uuid);
        if (result) latestPayload = result;
        const detection = await inspect();
        if (detection.rejected) {
          reset();
          return;
        }
        const leftover =
          detection.executed &&
          !payloadSignedThisSession(result, startedAt) &&
          !payloadSignedThisSession(latestPayload, startedAt);
        if (leftover) return;
        if (
          payloadSignedThisSession(result, startedAt) ||
          payloadSignedThisSession(latestPayload, startedAt)
        ) {
          await finish(extractSignedAccount(result) || extractSignedAccount(latestPayload), result);
        }
      };
      settleRef.current = settle;

      // xApp listing rules: no payload polling. Websocket + native
      // payload events + visibility wake cover the overlay.
      if (!isXappHost()) {
        pollRef.current = setInterval(() => {
          if (!payloadSessionOpen(session, sessionRef.current)) return;
          settle().catch(() => {});
        }, 2000);
      }

      if (payload.websocket && typeof WebSocket !== "undefined") {
        const socket = new WebSocket(payload.websocket);
        socketRef.current = socket;

        socket.onmessage = async (event) => {
          if (!payloadSessionOpen(session, sessionRef.current)) return;
          const data = JSON.parse(event.data);
          latestSocket = data;
          if (data.expired && !data.signed) {
            reset();
            return;
          }
          if (!data.signed) return;
          const result = await getPayloadResult(payload.uuid);
          if (result) latestPayload = result;
          if (!payloadSignedThisSession(result, startedAt) && !payloadSignedThisSession(latestPayload, startedAt)) {
            return;
          }
          await finish(extractSignedAccount(result) || data.account, result);
        };
      }

      await settle();
    } catch (err) {
      if (!payloadSessionOpen(session, sessionRef.current)) {
        busyRef.current = false;
        return;
      }
      console.error("Xaman payload error:", err);
      setError(err.message || errorMessage);
      reset();
    }
  }

  return { qr, mobileUrl, uuid, status, error, start, reset };
}
