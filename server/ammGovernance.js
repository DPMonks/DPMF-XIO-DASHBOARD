import {xrplRpc} from "./xrplBookOffers.js";
import {mapLimit} from "./liveAmmReserves.js";
import {activityFromAmmVoteTx, attachVoteTimestamps, governanceFromAmmInfo, quoteIdFromName, quoteIssue, voteHistoryFromActivity, xioIssue} from "../src/wallet/ammVote.js";

const CACHE_MS = 10_000;
const cache = new Map();

function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  return loader().then((body) => {
    cache.set(key, { at: Date.now(), body });
    return body;
  });
}

export async function loadPoolGovernance(pair, address = "", extra = {}) {
  const name = String(pair || "XIO/XRP").replace(/\s+/g, "").toUpperCase() || "XIO/XRP";
  const lpBalance = typeof extra === "number" ? extra : Number(extra?.lpBalance ?? extra?.lp ?? 0) || 0;
  const quoteId = quoteIdFromName(name);
  const quote = {
    id: quoteId,
    currency: extra?.currency || extra?.hex || extra?.quote_hex || quoteId,
    issuer: extra?.issuer || extra?.quote_issuer,
    hex: extra?.hex || extra?.quote_hex,
  };
  const ammAccount = String(extra?.ammAccount || extra?.amm || extra?.amm_account || "").trim();
  return cached(`gov:${name}:${address || "-"}:${quote.issuer || ""}:${ammAccount}`, async () => {
    try {
      const asset2 = quoteIssue(quote);
      const unresolvedIssued = quoteId !== "XRP" && asset2.currency === "XRP";
      const result = await xrplRpc(
        "amm_info",
        unresolvedIssued && ammAccount
          ? { amm_account: ammAccount, ledger_index: "validated" }
          : { asset: xioIssue(), asset2, ledger_index: "validated" }
      );
      const gov = governanceFromAmmInfo(result, { address, pair: name, lpBalance });
      return {
        ...gov,
        voteSlots: await datedVoteSlots(gov.voteSlots, name),
        source: "xrpl",
      };
    } catch {
      return {
        ...governanceFromAmmInfo({}, { address, pair: name, lpBalance }),
        source: "empty",
      };
    }
  });
}

async function datedVoteSlots(slots = [], pair = "XIO/XRP") {
  const rows = (Array.isArray(slots) ? slots : []).map((row) => ({ ...row, pair: row.pair || pair }));
  const accounts = [...new Set(rows.map((row) => String(row.account || "").trim()).filter(Boolean))];
  if (!accounts.length) return rows;
  const lists = await mapLimit(accounts, 3, async (account) => {
    const body = await loadWalletVotes(account).catch(() => ({ activity: [] }));
    return Array.isArray(body?.activity) ? body.activity : [];
  });
  return attachVoteTimestamps(rows, lists.flat());
}

export async function loadWalletVotes(address) {
  const name = String(address || "").trim();
  if (!name) return { account: null, activity: [], source: "empty" };
  return cached(`votes:${name}`, async () => {
    try {
      const result = await xrplRpc("account_tx", {
        account: name,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 80,
        binary: false,
        forward: false,
      });
      const activity = (result.transactions || [])
        .map((row) => activityFromAmmVoteTx(row, name))
        .filter(Boolean);
      return {
        account: name,
        activity: voteHistoryFromActivity(activity),
        source: "xrpl",
      };
    } catch {
      return { account: name, activity: [], source: "empty" };
    }
  });
}
