#!/usr/bin/env node
/**
 * XIO Trustline handoff for the indexer agent.
 *
 * The dashboard already creates this TrustSet through DPMF's Xaman API:
 *   POST /api/xaman/create-payload  { txjson: <below>, options: { submit: true } }
 *
 * After the user signs in Xaman, XRPL has a RippleState for issuer + XIO.
 * The next XRPL Node 3 token holder / trustline scan should pick it up.
 *
 * Do not start indexer workers from this script. Do not invent /api/cluster/v1/*.
 * Trustlines tile = every RippleState including 0, not holders with balance > 0.
 *
 * Run: node scripts/xio-trustline-handoff.js
 */
import {XIO_CURRENCY, XIO_HEX, XIO_ISSUER, XIO_TOTAL_SUPPLY, XIO_TRUST_LIMIT, xioTrustSetTxjson} from "../src/constants/ledger.js";

const handoff = {
  purpose: "Index a newly signed XIO TrustSet from the dashboard Xaman button",
  issuer: XIO_ISSUER,
  currency: XIO_CURRENCY,
  currencyHex: XIO_HEX,
  trustLimit: XIO_TRUST_LIMIT,
  totalSupply: XIO_TOTAL_SUPPLY,
  dashboard: {
    button: "XIO Trustline",
    endpoint: "POST /api/xaman/create-payload",
    xamanSubmit: true,
    txjson: xioTrustSetTxjson(),
  },
  indexer: {
    liveApi: "https://dpmf-xio-indexer-TEST.up.railway.app",
    doNotStartWorkers: true,
    doNotInventClusterV1: true,
    existingReads: [
      "GET /api/trustlines/count",
      "GET /api/charts/trustlines",
      "GET /api/holders/count",
    ],
    detectNewLine: {
      ledgerObjects: ["TrustSet", "RippleState"],
      match: {
        issuer: XIO_ISSUER,
        currency: [XIO_CURRENCY, XIO_HEX],
      },
      sqlHint:
        "COUNT(*) FROM token_holders_history WHERE timestamp = (SELECT MAX(timestamp) FROM token_holders_history) — include zero balances",
    },
    optionalFasterPath:
      "If the next Node 3 scan is too slow, watch account_tx / ledger stream for TrustSet + RippleState to the issuer and increment trustline_count. Do not COUNT only balance > 0.",
  },
};

console.log(JSON.stringify(handoff, null, 2));
