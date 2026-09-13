import {useEffect, useState} from "react";
import {createPortal} from "react-dom";
import {useI18n} from "../i18n/useI18n";
import {formatToken} from "../utils/format";
import {executionReceipt, formatReceiptHash} from "../wallet/executionReceipt";
import {explainTradeFailure} from "../wallet/tradeFailure";
import {ackTradeNotice, peekTradeNotice, rememberTradeNotice} from "../wallet/tradeNotice";
import {getLedgerTx} from "../xaman/xamanClient";

function noticeFromEvent(kind, detail) {
  const body = detail && typeof detail === "object" ? detail : {};
  return { kind, ...body };
}

function titleFor(t, notice) {
  if (notice.kind === "failed") return t.tradeFailed;
  if (notice.kind === "unconfirmed") return t.tradeUnconfirmed;
  const type = notice.txjson?.TransactionType;
  if (type === "AMMWithdraw") return t.lpRemoved;
  if (type === "AMMDeposit") return t.lpAdded;
  if (type === "AMMCreate") return t.createPoolExecuted;
  if (type === "AMMVote") return t.voteExecuted;
  return t.tradeExecuted;
}

function hintFor(t, notice) {
  if (notice.kind === "failed") return t.tradeFailedHint;
  if (notice.kind === "unconfirmed") return t.tradeUnconfirmedHint;
  const type = notice.txjson?.TransactionType;
  if (type === "AMMWithdraw") return t.lpRemovedHint;
  if (type === "AMMDeposit") return t.lpAddedHint;
  if (type === "AMMCreate") return t.createPoolExecutedHint;
  if (type === "AMMVote") return t.voteExecutedHint;
  return t.tradeExecutedHint;
}

function formatSide(rows, locale) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => Number(row.value) > 0)
    .map((row) => `${formatToken(row.value, locale, 6)} ${row.asset}`)
    .join(" + ");
}

export default function TradeExecuted() {
  const { t, locale } = useI18n();
  const [detail, setDetail] = useState(() => peekTradeNotice());

  useEffect(() => {
    function onDone(event) {
      setDetail(noticeFromEvent("executed", event.detail));
    }
    function onFailed(event) {
      setDetail(noticeFromEvent("failed", event.detail));
    }
    function onUnconfirmed(event) {
      setDetail(noticeFromEvent("unconfirmed", event.detail));
    }
    function onWake() {
      const stored = peekTradeNotice();
      if (stored) setDetail(stored);
    }
    window.addEventListener("dpmf-trade-executed", onDone);
    window.addEventListener("dpmf-trade-failed", onFailed);
    window.addEventListener("dpmf-trade-unconfirmed", onUnconfirmed);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("dpmf-trade-executed", onDone);
      window.removeEventListener("dpmf-trade-failed", onFailed);
      window.removeEventListener("dpmf-trade-unconfirmed", onUnconfirmed);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  useEffect(() => {
    const hash = String(detail?.txid || "").trim();
    if (!detail || detail.kind !== "executed" || !/^[A-Fa-f0-9]{64}$/.test(hash)) return undefined;
    if (detail.ledgerIndex || detail.lpReceived) return undefined;
    let cancelled = false;
    getLedgerTx(hash)
      .then((ledger) => {
        if (cancelled || !ledger) return;
        setDetail((current) => {
          if (!current || current.txid !== hash) return current;
          const next = { ...current, ledger, ledgerIndex: ledger.ledger_index ?? current.ledgerIndex };
          rememberTradeNotice(next);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail?.txid, detail?.kind, detail?.ledgerIndex, detail?.lpReceived]);

  function close() {
    ackTradeNotice();
    setDetail(null);
  }

  if (!detail) return null;

  const receipt = executionReceipt(detail);
  const paid = formatSide(receipt.paid, locale);
  const received = formatSide(receipt.received, locale);
  const hash = receipt.txid ? formatReceiptHash(receipt.txid) : "";
  const tone = detail.kind === "failed" ? "is-failed" : detail.kind === "unconfirmed" ? "is-unconfirmed" : "is-ok";
  const failure = detail.kind === "failed" ? explainTradeFailure(detail, t) : null;

  return createPortal(
    <div
      className="wallet-modal-overlay trade-executed-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`wallet-modal trade-executed-modal ${tone}`}
        role="alertdialog"
        aria-labelledby="trade-executed-title"
      >
        <h2 id="trade-executed-title" className="modal-title">
          {titleFor(t, detail)}
        </h2>
        <p className="trade-executed-copy">{hintFor(t, detail)}</p>
        <dl className="trade-executed-rows">
          {receipt.pair ? (
            <div>
              <dt>{t.receiptPair || t.tradePair || "Pair"}</dt>
              <dd>{receipt.pair}</dd>
            </div>
          ) : null}
          {paid ? (
            <div>
              <dt>{t.receiptPaid || "Paid"}</dt>
              <dd>{paid}</dd>
            </div>
          ) : null}
          {received ? (
            <div>
              <dt>{t.receiptReceived || "Received"}</dt>
              <dd>{received}</dd>
            </div>
          ) : null}
          {receipt.engineResult ? (
            <div>
              <dt>{t.receiptResult || "Result"}</dt>
              <dd>{receipt.engineResult}</dd>
            </div>
          ) : null}
          {receipt.ledgerIndex ? (
            <div>
              <dt>{t.receiptLedger || "Ledger"}</dt>
              <dd>#{receipt.ledgerIndex}</dd>
            </div>
          ) : null}
          {hash ? (
            <div>
              <dt>{t.receiptTx || "Transaction"}</dt>
              <dd className="trade-executed-hash" title={receipt.txid}>
                {hash}
              </dd>
            </div>
          ) : null}
        </dl>
        <button type="button" className="connect-wallet-btn" onClick={close}>
          {t.close || t.ok || "Close"}
        </button>
        {failure ? (
          <div className="xio-swap-rec trade-fail-rec">
            <div className="xio-swap-tip-scan" aria-hidden="true" />
            <p className="xio-swap-tip-kicker">{failure.title}</p>
            <p>{failure.why}</p>
            <p className="xio-swap-tip-kicker trade-fail-fix-kicker">{failure.fixTitle}</p>
            <p>{failure.fix}</p>
            {failure.code ? <p className="trade-fail-code">{failure.code}</p> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
