# Today's XIO owner snapshot

Dashboard PR: https://github.com/DPMonks/DPMF-XIO-Dashboard/pull/4  
Indexer PR: https://github.com/DPMonks/dpmf-xio-indexer/pull/5 (`219e859`)

Dashboard is **SELECT-only**. Do **not** start or reset workers from the dashboard. Holder worker stagger stays **35s**.

The rich list is **today's current XIO owners**, not mixed historical rows.

Indexer PR #5 implements this contract. Dashboard reads the same object.

## What the dashboard calls

```
GET /api/top-holders?limit=100&offset=0&snapshot=today
GET /api/top-holders-v2?limit=100&offset=0&snapshot=today
GET /api/holders/count?snapshot=today
```

`snapshot=today` means the **UTC calendar day** of the latest same-time holder scan.

Catalog keys `topHoldersToday` / `holdersCountToday` are aliases. The client still appends `snapshot=today` on the base paths.

## Response

```json
{
  "holders": [
    { "rank": 1, "account": "r...", "balance": 421351742.9329, "frozen": false }
  ],
  "as_of": "2026-08-21T20:15:00.000Z",
  "snapshot_day": "2026-08-21",
  "present": true,
  "catching_up": false,
  "count": 235,
  "source": "token_holders_latest"
}
```

`balance > 0` only. Field is **`balance`**. `frozen` is passed through.

If there is **no scan dated today UTC**:

```json
{
  "holders": [],
  "as_of": "<last scan if any>",
  "snapshot_day": "<last scan day>",
  "present": false,
  "catching_up": true,
  "count": 0,
  "source": "none"
}
```

Do **not** use `DISTINCT ON (account)` across old days.

Without `snapshot=today`, `/api/top-holders` still returns the live array and `/api/holders/count` still returns `{ count }`.

`GET /api/holders/count?snapshot=today` uses the same object (`holders` is `[]`; `count` is the full same-time scan).

## Write path (worker 4)

1. Each holder cycle overwrites `token_holders_latest` with the full current owner set (one row per account, `balance > 0`).
2. Stamp the **same UTC `timestamp`** on every latest row and on the history append.
3. Append that same-time set to `token_holders_history`.
4. Reads use that one scan when `timestamp` UTC date is today.

Auth: none. `accept: application/json`. Do not call `/api/cluster/v1/*`.

Redeploy **API first**, then **Worker 4 only**. Pause any `main` holder writer — it TRUNCATEs latest on empty scans.
