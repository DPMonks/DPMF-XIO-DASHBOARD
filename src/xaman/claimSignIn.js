import {detectTradeExecution} from "./detectExecution.js";
import {extractSignedAccount, getLedgerTx, getPayloadResult} from "./xamanClient.js";
import {canClaimExecutedTrade, isConsumedUuid, isPayloadUuid, payloadMatchesPendingTrade, payloadTxType, peekPendingPayload} from "./payloadResume.js";
import {notifyTradeExecuted, notifyTradeFailed} from "./tradeTx.js";

export async function claimSignedWallet(
  uuid,
  { fetchResult = getPayloadResult, tries = 8, waitMs = 400 } = {}
) {
  const id = String(uuid || "").trim();
  if (!isPayloadUuid(id)) return null;

  for (let attempt = 0; attempt < tries; attempt += 1) {
    const result = await fetchResult(id).catch(() => null);
    const account = extractSignedAccount(result);
    if (account) return account;
    if (result?.meta?.cancelled === true || result?.meta?.expired === true) return null;
    if (attempt < tries - 1) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return null;
}

export async function claimExecutedTrade(
  uuid,
  { fetchResult = getPayloadResult, fetchLedger = getLedgerTx, tries = 10, waitMs = 500 } = {}
) {
  const id = String(uuid || "").trim();
  if (!isPayloadUuid(id) || isConsumedUuid(id)) return null;
  const pending = peekPendingPayload();
  if (pending?.uuid && pending.uuid !== id) return null;
  if (pending && !canClaimExecutedTrade(id, pending)) return null;
  const txjson = pending?.uuid === id ? pending.txjson || null : null;

  for (let attempt = 0; attempt < tries; attempt += 1) {
    const result = await fetchResult(id).catch(() => null);
    if (result?.meta?.cancelled === true || result?.meta?.expired === true) return null;
    const txType = payloadTxType(result) || txjson?.TransactionType || "";
    if (txType === "SignIn" || txType === "TrustSet") return null;
    if (pending && result && !payloadMatchesPendingTrade(pending, result)) return null;
    let detection = detectTradeExecution({ payload: result });
    if (detection.txid && !detection.executed && !detection.rejected) {
      const ledger = await fetchLedger(detection.txid).catch(() => null);
      if (ledger) detection = detectTradeExecution({ payload: result, ledger });
    }
    if (detection.failed) {
      const account = extractSignedAccount(result) || detection.account || null;
      notifyTradeFailed({ ...detection, uuid: id, account, txjson, txType, trade: pending?.trade || null });
      return { ...detection, executed: false, account, result, txType };
    }
    if (detection.rejected) return null;
    if (detection.executed) {
      const account = extractSignedAccount(result) || detection.account || null;
      notifyTradeExecuted({
        ...detection,
        executed: true,
        uuid: id,
        account,
        txjson,
        trade: pending?.trade || null,
        txType,
        signMarker: pending?.signMarker || null,
      });
      return { ...detection, executed: true, account, result, txType };
    }
    if (attempt < tries - 1) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return null;
}
