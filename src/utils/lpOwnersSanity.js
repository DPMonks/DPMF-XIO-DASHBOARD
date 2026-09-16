/** Reject LP holder lists that are clearly the XIO token rich list (or absurd vs supply). */

function bal(row) {
  const n = Number(row?.lp_balance ?? row?.balance ?? row?.lp);
  return Number.isFinite(n) ? n : 0;
}

function acct(row) {
  return String(row?.account || row?.address || row?.wallet || "")
    .trim()
    .toLowerCase();
}

function pairOf(row) {
  return String(row?.pool_name || row?.pool || row?.pair || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * @param {object[]} lpRows purported LP owners
 * @param {object[]} tokenRows XIO rich list (optional)
 * @param {{ lpSupplyByPool?: Record<string, number>, matchRatio?: number, sample?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assessLpOwnersPayload(lpRows = [], tokenRows = [], opts = {}) {
  const rows = Array.isArray(lpRows) ? lpRows.filter((row) => acct(row)) : [];
  if (!rows.length) return { ok: false, reason: "empty" };

  const supplyByPool = opts.lpSupplyByPool || {};
  const sample = Math.min(Number(opts.sample) || 8, rows.length);
  const matchRatio = Number(opts.matchRatio) || 0.5;

  for (const row of rows.slice(0, Math.max(sample, 20))) {
    const pair = pairOf(row);
    const supply = Number(supplyByPool[pair]);
    if (supply > 0 && bal(row) > supply * 1.05) {
      return { ok: false, reason: "exceeds_lp_supply" };
    }
  }

  const tokens = Array.isArray(tokenRows) ? tokenRows.filter((row) => acct(row) && bal(row) > 0) : [];
  if (tokens.length >= 3) {
    const tokenMap = new Map(tokens.map((row) => [acct(row), bal(row)]));
    let compared = 0;
    let matched = 0;
    for (const row of rows.slice(0, sample)) {
      const key = acct(row);
      const tokenBal = tokenMap.get(key);
      if (!(tokenBal > 0)) continue;
      compared += 1;
      const lpBal = bal(row);
      const scale = Math.max(Math.abs(tokenBal), Math.abs(lpBal), 1e-9);
      if (Math.abs(lpBal - tokenBal) / scale < 1e-6) matched += 1;
    }
    if (compared >= 3 && matched / compared >= matchRatio) {
      return { ok: false, reason: "matches_token_rich_list" };
    }
  }

  // Hard reject classic XIO rich-list top balance when labeled as LP for XIO/XRP
  // (token top is thousands; live XIO/XRP LP supply is ~3k total, top holder ~2k LP).
  const xrpRows = rows.filter((row) => {
    const pair = pairOf(row);
    return !pair || pair === "XIO/XRP";
  });
  if (xrpRows.length) {
    const top = Math.max(...xrpRows.map(bal));
    // Known live XIO/XRP lp_supply ~3141; anything claiming >10k as a single LP balance is token-scale.
    if (top > 10_000) return { ok: false, reason: "absurd_xio_xrp_lp_balance" };
  }

  return { ok: true };
}

export function lpRowsLookTrusted(lpRows, tokenRows, opts) {
  return assessLpOwnersPayload(lpRows, tokenRows, opts).ok;
}
