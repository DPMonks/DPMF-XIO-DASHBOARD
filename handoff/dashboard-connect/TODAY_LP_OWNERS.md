# Today's XIO LP owner snapshot

Dashboard PR: https://github.com/DPMonks/DPMF-XIO-Dashboard/pull/4  
Indexer PR: https://github.com/DPMonks/dpmf-xio-indexer/pull/5

Dashboard is **SELECT-only**. Do not start or reset workers. Do not call `s1.ripple.com`, xrplcluster, `amm_info`, `account_lines`, or `account_info`. No `/api/cluster/v1/*`.

## Pools

```
GET /api/lp-pools
```

```json
{
  "count": 24,
  "pools": [
    { "pool_name": "XIO/XRP", "amm_account": "rhEwh…", "quote": "XRP", "quote_issuer": null, "lp_currency": "0397…" }
  ],
  "source": "db"
}
```

SQL: `SELECT * FROM xio_amm_pools ORDER BY reserve_xio DESC`. Names are `XIO/{QUOTE}`. Do not hardcode only XIO/XRP and XIO/RLUSD. Empty table → `catching_up`. `/api/pools` stays the primary XIO/XRP object. Default `pool` on LP owner routes is `XIO/XRP`; `pool=all` lists every pair. Without `snapshot=today`, `/api/top-lp` still returns the live owner array and `/api/lp-holders/count` returns `{ count, pool }`.

## Today's LP owners

```
GET /api/top-lp?limit=50&offset=0&snapshot=today&pool=XIO/XRP
GET /api/top-lp?snapshot=today&pool=all
GET /api/lp-holders/count?snapshot=today&pool=XIO/XRP
```

Same envelope as token owners. `holders` are `lp_balance > 0` only. Empty today → `present: false`, `holders: []`, `catching_up: true`. Do not `DISTINCT ON (account)` across old days.

## LP trustlines ≠ LP owners

```
GET /api/lp-trustlines/count?pool=XIO/XRP
GET /api/lp-trustlines/count?pool=all
GET /api/charts/lp-trustlines?pool=all
```

Trustlines = every LP line including 0. Overview `lp_holder_count` is owners; `lp_trustline_count` is all lines.

If `lp_holders_latest` is empty, `COUNT(*)` the latest `lp_holders_history` timestamp.

Token owners and recorded USD price are unchanged.
