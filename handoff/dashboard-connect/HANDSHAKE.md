# Dashboard ↔ indexer handshake

Copied from the now-public indexer repo
(`handoff/dashboard-connect` on `cursor/tie-dashboard-clusterv1-2567`
and the lock file on `cursor/handshake-contract-34cb`).

There is **no** `/api/cluster/v1/handshake`. Confirmation is:

```
GET /
GET /health
GET /health/xrpl   (PR #3 only; 404 on today’s Railway deploy)
```

The browser never calls Railway directly (Hikari 429 has no CORS).
Vite / `npm start` / Vercel proxy same-origin `/api/*` and `/health`.

## Base

```
VITE_API_BASE=https://dpmf-xio-indexer-production.up.railway.app
```

Auth: none. `accept: application/json` only. Xaman stays on this repo.

## Catalog `GET /`

Live Railway (`src/server.js`):

```json
{
  "status": "online",
  "service": "XRPL Indexer",
  "endpoints": {
    "health": "/health",
    "overview": "/api/overview",
    "amm": "/api/amm",
    "pools": "/api/pools",
    "topHolders": "/api/top-holders",
    "topHoldersV2": "/api/top-holders-v2",
    "topLp": "/api/top-lp",
    "holdersCount": "/api/holders/count",
    "lpHoldersCount": "/api/lp-holders/count",
    "tvlHistory": "/api/charts/tvl",
    "holdersHistory": "/api/charts/holders",
    "lpHoldersHistory": "/api/charts/lp-holders",
    "walletBalances": "/api/wallet/balances/:address",
    "prices": "/api/prices",
    "priceChange": "/api/prices/change24h",
    "networth": "/api/wallet/networth/:address",
    "sparkline": "/api/sparkline/:asset"
  }
}
```

Full field table: `INDEXER_CONNECT.md` in this folder.

## Rules

- Live `/api/pools` is **one object**. Use `res.pools` only if it is an array.
- Holders: `balance`. LP holders: `lp_balance`.
- Wallet live: `{ xrp, xio, lp }` (PR #3 also sends `balances[]`).
- Charts: `/api/charts/tvl|holders|lp-holders`. Sparkline: `{ timestamp, price_usd }`.
- 24h change keys are lowercase `{ xrp, xio, lp }`.
- AMM: read `pool_name`/`poolName` and `reserve_asset`/`reserveAsset`.
- Empty SQL is OK if `source` is `xrpl` and AMM reserves are present.
- Do not call `/api/xaman/*` or `/api/cluster/v1/*` on the indexer.
- Dashboard `/api` is SELECT-only on the XIO tables. Set server-only `DATABASE_URL` (same DB as the indexer, no `?sslmode=require`) so Hikari 429 cannot hide history. This repo never starts or resets workers.
