const NOTICE_KEY = "dpmf-trade-notice";
const NOTICE_MS = 5 * 60_000;

function store() {
  try {
    const local = globalThis.localStorage;
    if (local && typeof local.getItem === "function") return local;
  } catch {
    // private mode
  }
  try {
    const session = globalThis.sessionStorage;
    if (session && typeof session.getItem === "function") return session;
  } catch {
    // blocked
  }
  return null;
}

function slimNotice(notice = {}) {
  return {
    kind: notice.kind || "executed",
    txid: notice.txid || null,
    txjson: notice.txjson || notice.tx || null,
    trade: notice.trade || null,
    account: notice.account || notice.txjson?.Account || null,
    engineResult: notice.engineResult || null,
    ledgerIndex: notice.ledgerIndex ?? notice.ledger?.ledger_index ?? null,
    lpReceived: notice.lpReceived ?? null,
    uuid: notice.uuid || null,
    at: Date.now(),
    acked: false,
  };
}

export function rememberTradeNotice(notice = {}) {
  const bucket = store();
  if (!bucket) return null;
  const body = slimNotice(notice);
  try {
    bucket.setItem(NOTICE_KEY, JSON.stringify(body));
  } catch {
    return null;
  }
  return body;
}

export function peekTradeNotice() {
  const bucket = store();
  if (!bucket) return null;
  try {
    const raw = bucket.getItem(NOTICE_KEY);
    if (!raw) return null;
    const notice = JSON.parse(raw);
    if (!notice || notice.acked) return null;
    if (Date.now() - Number(notice.at || 0) > NOTICE_MS) {
      bucket.removeItem(NOTICE_KEY);
      return null;
    }
    return notice;
  } catch {
    return null;
  }
}

export function ackTradeNotice() {
  const bucket = store();
  if (!bucket) return;
  try {
    bucket.removeItem(NOTICE_KEY);
  } catch {
    // ignore
  }
}
