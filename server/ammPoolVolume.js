import {swapVolumeFromAccountTx} from "../src/utils/ammSwapVolume.js";
import {xioPairKey} from "../src/utils/lpVolume.js";
import {mapLimit, withXrplRetry} from "./liveAmmReserves.js";
import {xrplRpc} from "./xrplBookOffers.js";

const CACHE_MS = 60_000;
const cache = new Map();

export function resetAmmPoolVolumeCache() {
  cache.clear();
}

async function accountTx(account, options = {}) {
  return withXrplRetry(
    () =>
      xrplRpc(
        "account_tx",
        {
          account,
          ledger_index_min: -1,
          ledger_index_max: -1,
          limit: Number(options.limit) || 50,
          binary: false,
          forward: false,
        },
        { fetchImpl: options.fetchImpl, rpcUrl: options.rpcUrl }
      ),
    { retries: 1, waitMs: 200 }
  );
}

export async function loadLedgerPoolVolumes(pools = [], options = {}) {
  const now = Number(options.now) || Date.now();
  const list = (Array.isArray(pools) ? pools : []).filter((row) => row?.amm_account);
  const byPair = {};
  await mapLimit(list, Number(options.concurrency) || 3, async (row) => {
    const amm = String(row.amm_account).trim();
    const pair = xioPairKey(row.pool || row.pool_name || row.pair);
    if (!amm || !pair) return;
    const hit = cache.get(amm);
    if (hit && now - hit.at < CACHE_MS && !options.fresh) {
      byPair[pair] = hit.vol;
      return;
    }
    try {
      const result = await accountTx(amm, options);
      const counted = swapVolumeFromAccountTx(result.transactions || [], {
        ammAccount: amm,
        now,
      });
      const vol = {
        volume24hXio: counted.volume24hXio,
        volume24h: counted.volume24hXio,
        trades24h: counted.trades24h,
        source: "xrpl-amm",
        complete: counted.complete,
      };
      cache.set(amm, { at: now, vol });
      byPair[pair] = vol;
    } catch {
      if (hit?.vol) byPair[pair] = hit.vol;
    }
  });
  return byPair;
}

export function mergeVolumeMaps(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [pair, vol] of Object.entries(map || {})) {
      const key = xioPairKey(pair);
      const incoming = Number(vol?.volume24hXio ?? vol?.volume24h) || 0;
      const existing = Number(out[key]?.volume24hXio) || 0;
      if (incoming > existing) {
        out[key] = {
          volume24hXio: incoming,
          volume24h: incoming,
          volume24hXrp: vol.volume24hXrp ?? out[key]?.volume24hXrp ?? 0,
          volume24hUsd: vol.volume24hUsd ?? out[key]?.volume24hUsd ?? 0,
          volume7dXio: vol.volume7dXio ?? out[key]?.volume7dXio ?? 0,
          source: vol.source || out[key]?.source || "recorded",
        };
      } else if (!out[key] && vol) {
        out[key] = vol;
      }
    }
  }
  return out;
}
