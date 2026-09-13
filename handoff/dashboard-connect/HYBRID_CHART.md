# Hybrid XIO chart (preview only)

Dashboard branch: `cursor/hybrid-chart-99bb`  
Do **not** merge to Production until this has been tested. Dexscreener stays one click away.

```
node scripts/lock-hybrid-candles.js
```

That script pulls history **once** into `src/data/lockedCandles.json`.

## Locked series

| Series | Source | Status |
|---|---|---|
| XRP/USD daily | Yahoo `XRP-USD` from 24 Oct 2021 | Locked |
| XIO/XRP daily | InFTF `GET /v1/iou/market_data/{issuer}_XIO/XRP?interval=1d` | Locked from first DEX print (10 Nov 2021) |
| XIO/RLUSD daily | `XIO/XRP × XRP/USD` (RLUSD ≈ $1) until native AMM prints exist | Built from the XIO/XRP lock |

Live candles still merge `/api/sparkline/XIO`, `/api/xio-flows`, AMM spot, and order-book mid. Browser stays SELECT-only.

## Wallet marks

Order lines and fill dots render **only** when a wallet is signed in. They use that wallet’s book rows and `xio-flows` prints. Ready for later order-placement lines at the entry date.

## Indexer

No new cluster routes. Optional SELECT (already used tables):

- `price_history` (full, not the 50-point sparkline)
- `amm_pool_history` for XIO/XRP and XIO/RLUSD

Do not start workers.
