export const TRADE_TX_TYPES = new Set(["OfferCreate", "AMMDeposit", "AMMWithdraw", "AMMVote", "AMMCreate"]);

export function isTradeTxjson(txjson) {
  if (TRADE_TX_TYPES.has(txjson?.TransactionType)) return true;
  return txjson?.TransactionType === "Payment" && txjson.SendMax != null;
}

function isTxHash(value) {
  return /^[A-Fa-f0-9]{64}$/.test(String(value || "").trim());
}

export function extractTxHash(...sources) {
  const keys = ["txid", "tx_hash", "hash", "dispatched_txid"];
  function walk(node, depth) {
    if (!node || depth > 4) return null;
    if (typeof node === "string" && isTxHash(node)) return node.trim().toUpperCase();
    if (typeof node !== "object") return null;
    for (const key of keys) {
      if (isTxHash(node[key])) return String(node[key]).trim().toUpperCase();
    }
    for (const child of [node.response, node.meta, node.tx, node.result, node.data, node.payload]) {
      const hit = walk(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const source of sources) {
    const hit = walk(source, 0);
    if (hit) return hit;
  }
  return null;
}

export function unwrapLedgerTx(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.error && !raw.Account && !raw.hash) return raw;
  if (raw.result && typeof raw.result === "object" && (raw.result.Account || raw.result.hash || raw.result.meta)) {
    return raw.result;
  }
  return raw;
}

export function isEngineSuccess(code) {
  return String(code || "") === "tesSUCCESS";
}

export function isEngineFailure(code) {
  return /^(tec|tef|tem|tel|ter)/i.test(String(code || "").trim());
}

export function engineResultOf(...sources) {
  for (const source of sources) {
    const code = String(
      source?.dispatched_result ||
        source?.engine_result ||
        source?.TransactionResult ||
        source?.meta?.TransactionResult ||
        ""
    ).trim();
    if (isEngineSuccess(code) || isEngineFailure(code)) return code;
  }
  return "";
}

export function payloadExecutionSignals(result) {
  const meta = result?.meta && typeof result.meta === "object" ? result.meta : {};
  const response = result?.response && typeof result.response === "object" ? result.response : {};
  const dispatched = engineResultOf(response, result, meta);
  return {
    signed: meta.signed === true || result?.signed === true,
    resolved: meta.resolved === true,
    cancelled: meta.cancelled === true,
    expired: meta.expired === true,
    submitted: meta.submitted === true || Boolean(extractTxHash(result, response)),
    tesSuccess: isEngineSuccess(dispatched),
    failed: isEngineFailure(dispatched),
    dispatched,
    txid: extractTxHash(result, response),
    account: response.account || result?.account || null,
  };
}

export function socketExecutionSignals(data) {
  const dispatched = engineResultOf(data);
  return {
    signed: data?.signed === true,
    cancelled: data?.signed === false && data?.expired !== true,
    expired: data?.expired === true,
    submitted: Boolean(extractTxHash(data)),
    tesSuccess: isEngineSuccess(dispatched),
    failed: isEngineFailure(dispatched),
    dispatched,
    txid: extractTxHash(data),
    account: data?.account || null,
  };
}

export function ledgerExecutionSignals(raw) {
  const tx = unwrapLedgerTx(raw);
  const hash = extractTxHash(tx, raw);
  const result = engineResultOf(tx?.meta, tx, raw?.meta, raw);
  return {
    found: Boolean(tx && (tx.Account || tx.hash || tx.meta) && !tx.error),
    validated: tx?.validated === true || raw?.validated === true,
    tesSuccess: isEngineSuccess(result),
    failed: isEngineFailure(result),
    dispatched: result,
    txid: hash,
  };
}

export function detectTradeExecution({ payload, socket, ledger } = {}) {
  const p = payload ? payloadExecutionSignals(payload) : {};
  const s = socket ? socketExecutionSignals(socket) : {};
  const l = ledger ? ledgerExecutionSignals(ledger) : {};
  const txid = l.txid || p.txid || s.txid || null;
  const signed = Boolean(p.signed || s.signed);
  const tesSuccess = Boolean(l.tesSuccess || p.tesSuccess || s.tesSuccess);
  const submitted = Boolean(p.submitted || s.submitted || l.found);
  const engineResult = l.dispatched || p.dispatched || s.dispatched || "";
  const failed = Boolean(l.failed || p.failed || s.failed);
  const detectors = [];
  if (s.signed) detectors.push("xaman-socket");
  if (p.signed) detectors.push("xaman-signed");
  if (p.submitted) detectors.push("xaman-submitted");
  if (p.tesSuccess) detectors.push("xaman-dispatch");
  if (p.txid || s.txid) detectors.push("xaman-txid");
  if (l.found) detectors.push("xrpl-tx");
  if (l.validated && l.tesSuccess) detectors.push("xrpl-validated");
  if (failed) detectors.push("xrpl-failed");

  if ((p.cancelled || s.cancelled) && !signed && !submitted) {
    return { executed: false, rejected: true, failed: false, via: "cancelled", txid, detectors, signed, tesSuccess, engineResult };
  }
  if ((p.expired || s.expired) && !signed && !submitted) {
    return { executed: false, rejected: true, failed: false, via: "expired", txid, detectors, signed, tesSuccess, engineResult };
  }
  // Validated ledger wins. Xaman can keep a leftover tec* on the payload
  // after a successful AMMDeposit / AMMWithdraw, which used to flash a fail.
  if (l.validated && l.tesSuccess && txid) {
    return { executed: true, failed: false, via: "xrpl-validated", txid, detectors, signed, tesSuccess: true, engineResult: "tesSUCCESS" };
  }
  if (l.validated && l.failed && engineResult) {
    return { executed: false, rejected: true, failed: true, via: "xrpl-failed", txid, detectors, signed, tesSuccess, engineResult };
  }
  if (l.found && tesSuccess) {
    return { executed: true, failed: false, via: "xrpl-tx", txid, detectors, signed, tesSuccess: true, engineResult: engineResult || "tesSUCCESS" };
  }
  if (p.tesSuccess || s.tesSuccess) {
    return { executed: true, failed: false, via: "xaman-dispatch", txid, detectors, signed, tesSuccess: true, engineResult: engineResult || "tesSUCCESS" };
  }
  if (p.failed || s.failed) {
    // A hash without a ledger result is still in flight — do not treat the
    // Xaman dispatched_result as final (single- and double-sided LP included).
    if (signed || txid) {
      return {
        executed: false,
        rejected: false,
        failed: false,
        pending: true,
        signed,
        tesSuccess,
        txid,
        via: signed ? "xaman-signed" : "xaman-dispatch-pending",
        detectors,
        engineResult,
      };
    }
    return { executed: false, rejected: true, failed: true, via: "xaman-dispatch-failed", txid, detectors, signed, tesSuccess, engineResult };
  }
  return {
    executed: false,
    rejected: false,
    failed: false,
    pending: Boolean(signed || submitted),
    signed,
    tesSuccess,
    txid,
    via: signed ? "xaman-signed" : null,
    detectors,
    engineResult,
  };
}
