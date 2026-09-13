# DPMF-XIO Dashboard

Frontend for the DPMF XIO indexer. The browser never talks to the XRPL. Indexed holder, LP, AMM, chart, and wallet data come from the indexer through a same-origin `/api` proxy. Xaman sign-in stays on this repo (`/api/xaman/*`).

The indexer contract is in `handoff/dashboard-connect/INDEXER_CONNECT.md`. Confirmation is `GET /` and `GET /health` (not `/api/cluster/v1/*`). Cards are **SELECT-only** from the XIO Postgres tables (`token_holders_latest`, `lp_holders_latest`, `amm_pool_latest`, `amm_pool_history`, `holders_history`, `price_*`). The browser never talks to XRPL and this repo never starts or resets indexer workers (those have staggered delays: AMM 0s, prices 8s, LP 20s, holders 35s).

If Railway Hikari 429s the HTTP API, set server-only `DATABASE_URL` on Vercel / `.env` so `/api/*` can read the same tables directly.

`https://dpmf-xio-dashboard-TEST.vercel.app` is still the old Production deploy: it calls `/api/overview` and Vercel returns **404**, which the browser reports as Failed to fetch. Env vars cannot fix that host until this branch is Production. Use the PR #4 preview (log in past Vercel SSO) or Promote the preview. `DATABASE_URL` must be `postgres://…`, not the indexer HTTP host.

## Pairing

| Layer | Source |
| --- | --- |
| Dashboard | this repo |
| Handshake | `GET /` catalog + `GET /health` (same-origin proxy) |
| Indexer data | same-origin `/api/*` → XIO Postgres tables (Railway HTTP, or `DATABASE_URL` SELECT) |
| Xaman | dashboard `/api/xaman/create-payload` using `XUMM_API_KEY` / `XUMM_API_SECRET` |

The browser does **not** call Railway directly. Vite and Vercel proxy `/api/*` (except `/api/xaman/*`) to `https://dpmf-xio-indexer-TEST.up.railway.app`, send cluster identity headers, retry HTTP 429, and serialize fetches so the first holders/LP page can paint. Set `VITE_USE_DIRECT_INDEXER=true` only if you want the old direct client.

On-ledger constants (do not treat `rDgGyBao…` as the pool):

| Item | Value |
| --- | --- |
| XIO issuer | `rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo` |
| XIO/XRP AMM + LP issuer | `rhEwhutV5EyYzTbBYDdK7dHxwdi5omqffB` |
| XIO/RLUSD AMM | `rLbBzF9oxntVf4XxcyakNKJTci4yqSmQUu` |

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

`.env` and `.env.local` are gitignored. Put real Xaman values only in the local file.

## Encrypted secrets (GitHub + Vercel)

Do not commit `.env` files. Production and preview read encrypted store values, not the repo.

| Name | Where | Purpose |
| --- | --- | --- |
| `XUMM_API_KEY` | GitHub Actions secrets **and** Vercel env (Production + Preview) | Xaman API key for `/api/xaman/*` |
| `XUMM_API_SECRET` | GitHub Actions secrets **and** Vercel env (Production + Preview) | Xaman API secret (server-only, no `VITE_` prefix) |
| `VITE_API_BASE` | Vercel env (Production + Preview) | indexer **HTTP** host, e.g. `https://dpmf-xio-indexer-TEST.up.railway.app` |
| `INDEXER_ORIGIN` | Vercel env (optional) | override the server-side proxy target |
| `DATABASE_URL` | Vercel env (Production + Preview), server-only | `postgres://postgres@acela.proxy.rlwy.net:48994/railway` (password optional in the URL) |
| `POSTGRES_PASSWORD` | Vercel env (Production + Preview), server-only | Railway Postgres password, plain text. Overrides the URL password so `@` `#` `%` cannot break auth. |

GitHub: repository **Settings → Secrets and variables → Actions**.

Vercel: project **Settings → Environment Variables**, then redeploy.

## Scripts

- `npm run dev` — Vite dev server (proxies `/api` to the indexer)
- `npm run build` — production build
- `npm run preview` — Vite preview **with the same `/api` proxy** (needed in containers)
- `npm start` — serve `dist/` plus the indexer proxy (`PORT`, default 4173)
- `npm run lint` — ESLint

Static file servers (nginx, `vite preview` without the plugin, opening `dist/index.html`) will show **Failed to fetch** in every card because `/api` is missing. Use `npm run dev`, `npm run preview`, `npm start`, or Vercel.
