export const ACCOUNT_ZERO = "rrrrrrrrrrrrrrrrrrrrrhoLvTp";
export const ACCOUNT_ONE = "rrrrrrrrrrrrrrrrrrrrBZbvji";
export const ASF_DISABLE_MASTER = 4;
export const LSF_DISABLE_MASTER = 0x00100000;
export const RIPPLE_EPOCH = 946684800;
export const XIO_BLACKHOLED_AT = "2021-10-24T13:52:31.000Z";

export function rippleDateToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date((seconds + RIPPLE_EPOCH) * 1000).toISOString();
}

export function isBlackholeRegularKey(value) {
  const key = String(value || "").trim();
  return key === ACCOUNT_ONE || key === ACCOUNT_ZERO;
}

export function issuerBlackholeFromAccount(info = {}) {
  const data = info.account_data || info;
  const flags = info.account_flags || {};
  const disableMaster =
    Boolean(flags.disableMasterKey) ||
    Boolean(Number(data.Flags || 0) & LSF_DISABLE_MASTER);
  const regularKey = data.RegularKey || null;
  const blackholed = Boolean(disableMaster && isBlackholeRegularKey(regularKey));
  return {
    blackholed,
    fixed: blackholed,
    disableMaster,
    regularKey,
  };
}

export function blackholeAtFromTransactions(rows = []) {
  let regularAt = null;
  let masterAt = null;
  for (const wrap of Array.isArray(rows) ? rows : []) {
    const tx = wrap.tx || wrap.tx_json || wrap;
    const iso = tx?.date != null ? rippleDateToIso(tx.date) : null;
    if (tx?.TransactionType === "SetRegularKey" && isBlackholeRegularKey(tx.RegularKey)) {
      regularAt = iso;
    }
    if (tx?.TransactionType === "AccountSet" && Number(tx.SetFlag) === ASF_DISABLE_MASTER) {
      masterAt = iso;
    }
  }
  return masterAt || regularAt;
}
