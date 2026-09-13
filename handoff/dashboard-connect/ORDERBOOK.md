# XIO DEX + AMM order book

Dashboard PR: https://github.com/DPMonks/DPMF-XIO-Dashboard/pull/9
Indexer PR: https://github.com/DPMonks/dpmf-xio-indexer/pull/5

The **browser** never calls XRPL. Do not invent `/api/cluster/v1/*`. Do not start workers.

```
GET /api/orderbook?pair=XIO/XRP
GET /api/orderbook?quote=RLUSD
GET /api/orderbooks
```

Tape source, in order:

1. `order_book_latest` / `order_book_history` native `book_offers` (any pair spelling; unwrap RPC `result.offers`)
2. If that snapshot has no DEX rows, dashboard `/api` reads XRPL `book_offers` server-side for featured pairs (XIO/XRP, XIO/RLUSD, XIO/XDX, XIO/XSQUAD)

`price` / bid / ask / mid are **quote per 1 XIO**. Chart stays on `/api/prices` `recorded_price`.
