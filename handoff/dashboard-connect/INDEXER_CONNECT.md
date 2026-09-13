# Indexer handshake contract

Dashboard agent: lock the HTTP client to this file. Do **not** invent `/api/cluster/v1/*`.
`/v1` is the XRPL RPC path on `https://xrplcluster.com/v1` (worker 1 only). It is not an indexer prefix.

Sources:
- Live production code on `railway.json` (`src/server.js`) — what Railway is serving today
- Target contract on PR #3 / `cursor/tie-dashboard-clusterv1-2567` (`src/routes/*`) — not redeployed yet
- Handshake agent `bc-5377d64c-6193-4086-96ac-e041ed1d2567` last message + committed `INDEXER_CONNECT.md`
- This run probed the public host on 2026-08-21 and got Hikari HTTP 429 on every path

Indexer PR (target): https://github.com/DPMonks/dpmf-xio-indexer/pull/3  
Dashboard PR: https://github.com/DPMonks/DPMF-XIO-Dashboard/pull/1

---

## Base URL

```
https://dpmf-xio-indexer-TEST.up.railway.app
```

That is the real public host. There is no custom domain in this repo or in the handshake agents.

```
VITE_API_BASE=https://dpmf-xio-indexer-TEST.up.railway.app
```

Do not append `/api` if the client already prefixes `/api`. Do not use the Vercel indexer preview (SSO 302). Local indexer (undeployed rewrite) listens on `PORT=8080` → `http://localhost:8080`.

---

## Handshake

There is **no** `/handshake` and **no** `/api/cluster/v1/handshake`. Confirmation is:

```
GET https://dpmf-xio-indexer-TEST.up.railway.app/
GET https://dpmf-xio-indexer-TEST.up.railway.app/health
```

PR #3 also ships `GET /health/xrpl` (404 on today’s Railway deploy).

Auth: **none**. No header, no query key, no Bearer. Client sends `accept: application/json` only. Do not put production secrets in git; the API is unlocked.

### Live `GET /` 200 (railway.json `src/server.js`)

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

### Target `GET /` 200 (PR #3 `src/routes/index.js`)

```json
{
  "status": "online",
  "service": "dpmf-xio-indexer",
  "dashboard": "https://dpmf-xio-dashboard-TEST.vercel.app",
  "worker1Node": "https://xrplcluster.com/v1",
  "endpoints": {
    "health": "/health",
    "xrplConfirm": "/health/xrpl",
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
    "balances": "/api/balances/:address",
    "prices": "/api/prices",
    "priceChange": "/api/prices/change24h",
    "networth": "/api/wallet/networth/:address",
    "sparkline": "/api/sparkline/:asset",
    "publicOverview": "/api/public/overview",
    "publicAmm": "/api/public/amm",
    "publicPools": "/api/public/pools"
  }
}
```

### Live `GET /health` 200 (railway.json `src/health.js`)

```json
{
  "status": "ok",
  "uptime": 11.544187962,
  "lastCycle": 1755777587206,
  "timestamp": "2026-08-21T07:59:47.206Z"
}
```

`status` is `"unhealthy"` if the last indexer cycle is older than 60s.

### Target `GET /health` (PR #3) extra fields

```json
{
  "status": "ok",
  "uptime": 0,
  "timestamp": "2026-08-21T12:53:21.000Z",
  "workers": {
    "amm": { "lastCycle": null, "ageMs": null, "status": "starting" }
  },
  "dashboard": {
    "origin": "https://dpmf-xio-dashboard-TEST.vercel.app",
    "repo": "https://github.com/DPMonks/DPMF-XIO-Dashboard",
    "apiBase": "/api",
    "worker1Node": "https://xrplcluster.com/v1"
  },
  "xrpl": {
    "onV1": true,
    "cluster": {
      "envUrl": "https://xrplcluster.com/v1",
      "rewrittenUrl": "https://xrplcluster.com/v1",
      "host": "xrplcluster.com",
      "path": "/v1",
      "onV1": true
    },
    "lastRpc": {
      "url": "https://xrplcluster.com/v1",
      "path": "/v1",
      "onV1": true,
      "method": "amm_info",
      "status": 200,
      "ok": true
    }
  }
}
```

`GET /health/xrpl` returns only the `xrpl` object. Look for `cluster.path === "/v1"` and `onV1 === true`.

Live production probe (2026-08-21T14:17:25Z) — **not a 200**:

```
HTTP/2 429
content-type: text/plain; charset=utf-8
content-length: 12
server: railway-hikari
x-railway-edge: jfk1

rate limited
```

Same 429 for `/`, `/health`, `/health/xrpl`, `/api/overview`, `/handshake`, `/api/cluster/v1/handshake`. Check `res.ok` before `res.json()`. Retry once. Load cards sequentially.

---

## Endpoint table

All **GET**. Prefix is `/api/*` on both live and PR #3.

| Need | Method | Path | Live today | PR #3 extras |
| --- | --- | --- | --- | --- |
| Handshake / catalog | GET | `/` | yes | `dashboard`, `worker1Node` |
| Health | GET | `/health` | `{ status, uptime, lastCycle, timestamp }` | workers + xrpl confirm |
| Worker 1 path | GET | `/health/xrpl` | **missing (404)** | `{ onV1, cluster.path, lastRpc }` |
| Overview | GET | `/api/overview` | `{ tvl, lp_supply, holder_count, lp_holder_count }` | + `price`, `source` (`db`\|`xrpl`) |
| AMM | GET | `/api/amm` | one SQL row (`SELECT *`) | + `source`; live fallback is camelCase |
| Pools / AMM list | GET | `/api/pools` | **one object**, no `pools` array | `{ ...primary, pools: [...] }` |
| Token holders | GET | `/api/top-holders?limit=&offset=` | array | same; also `/api/holders`, `/api/holders/top` |
| Holders alias | GET | `/api/top-holders-v2` | same as top-holders | same |
| Holder count | GET | `/api/holders/count` | `{ count }` | may add `source` |
| LP holders | GET | `/api/top-lp?limit=&offset=` | `{ rank, account, lp_balance }` | + `pool_name`; also `/api/lp-holders` |
| LP count | GET | `/api/lp-holders/count` | `{ count }` | may add `source` |
| TVL chart | GET | `/api/charts/tvl` | `[{ timestamp, tvl }]` | same |
| Holders chart | GET | `/api/charts/holders` | `[{ day, holder_count }]` | same |
| LP chart | GET | `/api/charts/lp-holders` | `[{ day, lp_holder_count }]` | same |
| Prices | GET | `/api/prices` | `{ xrpUsd, xrpGbp, xioUsd, xioGbp }` | + `source` |
| 24h change | GET | `/api/prices/change24h` | `{ xrp, xio, lp }` | same |
| Sparkline | GET | `/api/sparkline/:asset` | `[{ timestamp, price_usd }]` | also `/api/prices/sparkline/:asset` |
| Wallet balances | GET | `/api/wallet/balances/:address` | `{ xrp, xio, lp }` | + `balances: [{ currency, value }]` |
| Wallet alias | GET | `/api/balances/:address` | **missing** | same as wallet balances |
| Net worth | GET | `/api/wallet/networth/:address` | `{ totalUsd, totalGbp }` | same |

Public aliases on PR #3 only: `/api/public/overview`, `/api/public/amm`, `/api/public/pools`.

**Do not call on the indexer**

- `/api/cluster/v1/*` — never shipped
- `/api/lp/:wallet` — does not exist; use `lp` on wallet balances or `/api/top-lp`
- `/api/xaman/*` — Xaman stays on the dashboard (`VITE_XUMM_API_KEY`, `/api/xaman/create-payload`, `/api/xaman/payload-result`)

---

## JSON examples (field names)

Live HTTP 200 bodies from Railway were **not** captured (Hikari 429). Examples below are from `src/server.js` (live) and PR #3 routes / `INDEXER_CONNECT.md`. Numbers from the 2026-08-21 XRPL smoke where noted.

### `GET /api/overview`

Live (railway.json) — no `price`, no `source`:

```json
{
  "tvl": 5094.43,
  "lp_supply": 219316738.1685708,
  "holder_count": 184,
  "lp_holder_count": 42
}
```

`tvl` live = `reserve_asset + reserve_currency` (not USD).

PR #3 DB hit:

```json
{
  "tvl": 5094.43,
  "lp_supply": 219316738.1685708,
  "holder_count": 184,
  "lp_holder_count": 42,
  "price": 0.00002946,
  "source": "db"
}
```

PR #3 live fallback extra: `"source": "xrpl"`, `"worker1Node": "https://xrplcluster.com/v1"`. `tvl` then = `amm.reserveCurrency * 2`.

### `GET /api/amm`

Live / PR #3 DB path is `SELECT *` from `amm_pool_latest` (snake_case columns). Documented shape:

```json
{
  "pool_name": "XIO/XRP",
  "asset": "XIO",
  "currency": "XRP",
  "reserve_asset": 63581538.27,
  "reserve_currency": 1872.95,
  "lp_supply": 219316738.16,
  "trading_fee": 1000,
  "price": 0.00002946,
  "tvl_usd": 5094.43,
  "amm_account": "rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB"
}
```

`reserve_asset` = XIO units. `reserve_currency` = XRP (not drops). `price` = XRP per XIO.

PR #3 empty-SQL fallback is **camelCase** (`mapAmm`):

```json
{
  "poolName": "XIO/XRP",
  "asset": "XIO",
  "currency": "XRP",
  "reserveAsset": 63284561.13643979,
  "reserveCurrency": 1881.832429,
  "lpSupply": 219316738.1685708,
  "tradingFee": 1000,
  "price": 0.00002974,
  "ammAccount": "rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB",
  "tokenA": "XIO",
  "tokenB": "XRP"
}
```

Read both spellings.

### `GET /api/pools`

**Live today is a single object, not `{ pools: [] }`:**

```json
{
  "pool": "XIO/XRP",
  "tvl": 5094.43,
  "price": 0.00002946,
  "apr": 0,
  "volume24h": 0,
  "reserve_asset": 63581538.27,
  "reserve_currency": 1872.95,
  "lp_supply": 219316738.16,
  "holder_count": 184,
  "lp_holder_count": 42,
  "updated": "2026-08-21T08:00:00.000Z"
}
```

PR #3 wraps the primary plus an array (use `res.pools` when present):

```json
{
  "pool": "XIO/XRP",
  "tokenA": "XIO",
  "tokenB": "XRP",
  "tvl": 5094.43,
  "liquidity": 1872.95,
  "price": 0.00002946,
  "apr": 0,
  "volume24h": 0,
  "reserve_asset": 63581538.27,
  "reserve_currency": 1872.95,
  "lp_supply": 219316738.16,
  "holder_count": 184,
  "lp_holder_count": 42,
  "updated": "2026-08-21T08:00:00.000Z",
  "source": "db",
  "pools": [
    { "pool": "XIO/XRP", "tokenA": "XIO", "tokenB": "XRP", "liquidity": 1872.95 },
    { "pool": "XIO/RLUSD", "tokenA": "XIO", "tokenB": "RLUSD", "liquidity": 27.62 }
  ]
}
```

`apr` and `volume24h` are hardcoded `0` on PR #3.

### `GET /api/top-holders?limit=200&offset=0`

```json
[
  { "rank": 1, "account": "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo", "balance": 169793.55, "frozen": false }
]
```

Field is **`balance`**, not `lp_balance`.

### `GET /api/holders/count`

```json
{ "count": 184 }
```

PR #3 empty-SQL fallback: `{ "count": 184, "source": "xrpl" }`.

### `GET /api/top-lp?limit=50&offset=0`

Live:

```json
[
  { "rank": 1, "account": "r...", "lp_balance": 907105.04 }
]
```

PR #3:

```json
[
  { "rank": 1, "account": "r...", "lp_balance": 907105.04, "pool_name": "XIO/XRP" }
]
```

Field is **`lp_balance`**, not `balance`.

### `GET /api/lp-holders/count`

```json
{ "count": 42 }
```

### `GET /api/charts/tvl`

```json
[{ "timestamp": "2026-08-21T08:00:00.000Z", "tvl": 5094.43 }]
```

### `GET /api/charts/holders`

```json
[{ "day": "2026-08-21", "holder_count": 184 }]
```

### `GET /api/charts/lp-holders`

```json
[{ "day": "2026-08-21", "lp_holder_count": 42 }]
```

### `GET /api/prices`

```json
{ "xrpUsd": 1.36, "xrpGbp": 1.06, "xioUsd": 0.000040, "xioGbp": 0.000031 }
```

PR #3 may add `"source": "db"` or `"source": "live"`. Live railway.json computes `xioUsd = price_usd * 0.000001`.

### `GET /api/prices/change24h`

```json
{ "xrp": 0, "xio": 0, "lp": 0 }
```

Keys are lowercase. Values come from `price_change_24h.asset` (`XRP` / `XIO` / `LP`).

### `GET /api/sparkline/:asset`

`asset` = `XRP` | `XIO` | `LP` | `RLUSD`. SQL `LIMIT 50`, oldest-first after reverse.

```json
[{ "timestamp": "2026-08-21T08:00:00.000Z", "price_usd": 1.36 }]
```

### `GET /api/wallet/balances/:address`

Live:

```json
{ "xrp": 12.5, "xio": 1000, "lp": 50 }
```

PR #3:

```json
{
  "xrp": 12.5,
  "xio": 1000,
  "lp": 50,
  "balances": [
    { "currency": "XRP", "value": 12.5 },
    { "currency": "XIO", "value": 1000 },
    { "currency": "LP", "value": 50 }
  ]
}
```

Read `xrp` / `xio` / `lp` first so live Railway still works. `balances[].currency` / `value` only after PR #3 deploys.

### `GET /api/wallet/networth/:address`

```json
{ "totalUsd": 0, "totalGbp": 0 }
```

---

## Pagination

`limit` + `offset` only. No cursor.

| Endpoint | Default limit | Max | Offset |
| --- | --- | --- | --- |
| `/api/top-holders`, `/api/top-holders-v2` | `200` | live: uncapped; PR #3: `Math.min(..., 2000)` | `>= 0` |
| `/api/top-lp` | `50` | live: uncapped; PR #3: `2000` | `>= 0` |
| sparkline | 50 (SQL) | 50 | n/a |
| everything else | none | n/a | n/a |

Do not request the entire holder set in one shot.

---

## CORS / 429

**Yes. The public host still Hikari-limits browsers and agents.**

- 429 body: `rate limited` (12 bytes, `text/plain`, `server: railway-hikari`)
- Check `res.ok` before `res.json()`
- Retry once on 429
- Sequential card loads, one shared client

CORS:

- Live railway.json: `app.use(cors())` — allow all origins
- PR #3: `CORS_ORIGINS=https://dpmf-xio-dashboard-TEST.vercel.app,http://localhost:5173` plus any `*.vercel.app`. Empty list = allow all.

Private Railway URL: mentioned by the handshake agent, hostname not published.

---

## Xaman

**Stays on the dashboard.** Not moved back to the indexer.

- Do not call `/api/xaman/*` on this host
- Dashboard keeps `/api/xaman/create-payload` and `/api/xaman/payload-result`
- `VITE_XUMM_API_KEY` / `XUMM_API_KEY` / `XUMM_API_SECRET` belong on the dashboard project only
- Indexer `package.json` still lists `xumm` but there is no xaman route in `src/server.js` or PR #3

---

## On-ledger constants

| Item | Value |
| --- | --- |
| XIO issuer | `rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo` |
| XIO currency | `XIO` |
| XIO hex | `5844580000000000000000000000000000000000` |
| XIO/XRP AMM | `rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB` |
| XIO/XRP LP hex | `03970105D80AE3C54085F6E97EE16CEDE6CE8200` |
| XIO/XRP LP issuer | `rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB` |
| RLUSD issuer | `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` |
| RLUSD hex | `524C555344000000000000000000000000000000` |
| XIO/RLUSD AMM | `rLbBzF9oxntVf4XxcyakNKJTci4yqSmQUu` |
| XIO/RLUSD LP hex | `03BCD44104644B711C58CD14CD13CBA65757CFBE` |

`rDgGyBaoZ66q5gGzK3hYb2qviT6RXGiWSC` is a voter, **not** the XIO/XRP AMM.

---

## How to lock the dashboard client

1. `VITE_API_BASE=https://dpmf-xio-indexer-TEST.up.railway.app`
2. Call the `/api/*` paths in the table. Never `/api/cluster/v1/*`.
3. Tolerate **both** live and PR #3 shapes:
   - `overview.price` / `overview.source` optional
   - `pools` may be one object; use `res.pools` only if `Array.isArray(res.pools)`
   - AMM: `pool_name` **or** `poolName`, `reserve_asset` **or** `reserveAsset`
   - holders: `balance`; LP holders: `lp_balance` (+ optional `pool_name`)
   - wallet: `xrp` / `xio` / `lp` required; `balances[]` optional
4. `/health/xrpl` is optional until Railway redeploys PR #3
5. Xaman stays on the dashboard repo

Redeploy the four Railway indexer services onto `cursor/tie-dashboard-clusterv1-2567` before expecting PR #3 fields (`source`, `pools[]`, `balances[]`, `/health/xrpl`).

Dashboard `/api` can SELECT the same XIO tables when `DATABASE_URL` is set (server-only). Omit `?sslmode=require` (Railway TCP proxy cert). That path does **not** start or reset workers. Do not boot workers together; they stagger (AMM 0s, prices 8s, LP 20s, holders 35s) and share the XRPL RPC budget.
