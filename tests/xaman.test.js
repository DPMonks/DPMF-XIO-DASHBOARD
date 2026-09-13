import test from "node:test";
import assert from "node:assert/strict";
import {buildSignInPayload, buildTrustSetPayload, buildXamanPayload, isFreshXamanCreate, xamanSignIdentifier, cleanCredential, requestOrigin, shouldSubmitTxjson, siteOriginFrom, xamanErrorMessage, xamanReturnUrl, xummConfigured} from "../api/xaman/_xumm.js";
import {TF_SET_NO_RIPPLE, XIO_ISSUER, XIO_TOTAL_SUPPLY, xioTrustSetTxjson} from "../src/constants/ledger.js";
import {claimExecutedTrade, claimSignedWallet} from "../src/xaman/claimSignIn.js";
import {extractSignedAccount, isClassicAddress, isInAppBrowser, isPhoneDevice, isTelegramWebView, isReusableUnsignedPayload, launchXamanSign, shouldCancelConnectNavigation, normalizePayload, payloadLooksSigned, payloadQrUrl, payloadSignedThisSession, xamanAppUrl, xamanSignUrl} from "../src/xaman/xamanClient.js";
import {canClaimExecutedTrade, clearConsumedUuids, clearPendingPayload, discardStalePendingTrade, isConsumedUuid, isPayloadUuid, payloadMatchesPendingTrade, peekPendingPayload, peekXamanUuid, readXamanReturnUuid, rememberConsumedUuid, rememberPendingPayload, shouldAutoClaimPendingTrade, takeXamanReturnUuid, xamanWebsocketUrl} from "../src/xaman/payloadResume.js";
import {nextPayloadSession, payloadSessionOpen} from "../src/xaman/payloadSession.js";
import {normalizeTradeRequest} from "../src/xaman/tradeTx.js";

test("cleanCredential strips quotes and whitespace", () => {
  assert.equal(cleanCredential('  "abc-def" \n'), "abc-def");
  assert.equal(cleanCredential(""), "");
  assert.equal(cleanCredential(null), "");
});

test("xioTrustSetTxjson is a NoRipple TrustSet for the XIO issuer", () => {
  const txjson = xioTrustSetTxjson("rTestAccount111111111111111111111");
  assert.equal(txjson.TransactionType, "TrustSet");
  assert.equal(txjson.Flags, TF_SET_NO_RIPPLE);
  assert.equal(txjson.LimitAmount.currency, "XIO");
  assert.equal(txjson.LimitAmount.issuer, XIO_ISSUER);
  assert.equal(txjson.LimitAmount.value, String(XIO_TOTAL_SUPPLY));
  assert.equal(txjson.Account, "rTestAccount111111111111111111111");
  assert.equal(xioTrustSetTxjson().Account, undefined);
});

test("TrustSet payloads submit to XRPL; SignIn payloads do not", () => {
  const signIn = buildSignInPayload("https://xio-exchange.dpmf.technology/");
  assert.equal(signIn.options.submit, false);
  assert.equal(shouldSubmitTxjson(signIn.txjson), false);

  const trust = buildTrustSetPayload(
    "https://xio-exchange.dpmf.technology/",
    xioTrustSetTxjson()
  );
  assert.equal(trust.txjson.TransactionType, "TrustSet");
  assert.equal(trust.options.submit, true);
  assert.equal(trust.options.return_url.app, "https://xio-exchange.dpmf.technology/?xaman={id}");
  assert.equal(trust.options.return_url.web, "https://xio-exchange.dpmf.technology/?xaman={id}");
  assert.equal(shouldSubmitTxjson(trust.txjson), true);

  const fromBody = buildXamanPayload("https://xio-exchange.dpmf.technology", xioTrustSetTxjson());
  assert.equal(fromBody.options.submit, true);

  const marker = "ab".repeat(16);
  const marked = buildXamanPayload(
    "https://xio-exchange.dpmf.technology",
    { TransactionType: "Payment", Amount: "1" },
    { signMarker: marker }
  );
  assert.equal(marked.custom_meta.identifier, xamanSignIdentifier(marker));
  assert.equal(marked.custom_meta.blob.marker, marker);
  assert.equal(isFreshXamanCreate({ uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", meta: {} }), true);
  assert.equal(
    isFreshXamanCreate({
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      meta: { signed: true, resolved: true },
    }),
    false
  );
});

test("xApp payloads stay in the wallet overlay and do not bounce to a return URL", () => {
  const payload = buildXamanPayload(
    "https://xio-exchange.dpmf.technology",
    { TransactionType: "Payment", Amount: "1" },
    { xapp: true }
  );
  assert.equal(payload.options.return_url, undefined);
  assert.equal(payload.options.force_network, "MAINNET");
  assert.equal(payload.options.submit, true);
});

test("buildSignInPayload returns to the site with the payload id after Xaman", () => {
  const payload = buildSignInPayload("https://xio-exchange.dpmf.technology/");
  assert.equal(payload.txjson.TransactionType, "SignIn");
  assert.equal(payload.options.return_url.app, "https://xio-exchange.dpmf.technology/?xaman={id}");
  assert.equal(payload.options.return_url.web, "https://xio-exchange.dpmf.technology/?xaman={id}");
  assert.equal(payload.options.submit, false);
});

test("requestOrigin prefers the forwarded host", () => {
  assert.equal(
    requestOrigin({
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "xio-exchange.dpmf.technology",
      },
    }),
    "https://xio-exchange.dpmf.technology"
  );
});

test("Xaman Next never returns to a Vercel login host", () => {
  assert.equal(
    requestOrigin({
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "dpmf-xio-dashboard-git-cursor-mobile-sig-a5d2b5-dpmf-s-projects.vercel.app",
      },
    }),
    "https://xio-exchange.dpmf.technology"
  );
  assert.equal(
    requestOrigin({
      headers: { host: "dpmf-xio-dashboard-TEST.vercel.app" },
    }),
    "https://xio-exchange.dpmf.technology"
  );
  assert.equal(
    siteOriginFrom("https://vercel.com/dpmf-s-projects/dpmf-xio-dashboard"),
    "https://xio-exchange.dpmf.technology"
  );
  assert.equal(
    xamanReturnUrl("https://dpmf-xio-dashboard-TEST.vercel.app"),
    "https://xio-exchange.dpmf.technology/?xaman={id}"
  );
  assert.equal(
    requestOrigin({
      headers: { host: "localhost:5173", "x-forwarded-proto": "http" },
    }),
    "http://localhost:5173"
  );
});

test("xamanErrorMessage explains an invalid transaction 603", () => {
  const message = xamanErrorMessage({ error: { code: 603, message: "Invalid Hex" } });
  assert.match(message, /Invalid Hex|603|transaction/i);
});

test("xamanErrorMessage does not stringify Xaman error objects", () => {
  const message = xamanErrorMessage({
    error: { reference: "abc", code: 811 },
  });
  assert.equal(message.includes("[object Object]"), false);
  assert.match(message, /XUMM_API_KEY|return URL|811/);
});

test("xummConfigured reports key and secret presence without exposing them", () => {
  const configured = xummConfigured();
  assert.equal(typeof configured.key, "boolean");
  assert.equal(typeof configured.secret, "boolean");
});

test("normalizePayload reads the Xaman QR refs", () => {
  const payload = normalizePayload({
    uuid: "payload-1",
    refs: { qr_png: "https://xumm.app/sign/payload-1_q.png" },
    next: { always: "https://xumm.app/sign/payload-1" },
  });
  assert.equal(payload.uuid, "payload-1");
  assert.ok(payload.qr.includes("payload-1"));
  assert.equal(payload.mobileUrl, "xumm://xumm.app/sign/payload-1");
});

test("normalizePayload synthesizes a QR when Xaman omits refs", () => {
  const payload = normalizePayload({ uuid: "payload-2" });
  assert.equal(payload.qr, "https://xumm.app/sign/payload-2_q.png");
  assert.equal(payload.mobileUrl, "xumm://xumm.app/sign/payload-2");
});

test("xaman sign links stay on the payload uuid and phones are detected", () => {
  assert.equal(xamanSignUrl("abc-1"), "https://xumm.app/sign/abc-1");
  assert.equal(xamanAppUrl("abc-1"), "xumm://xumm.app/sign/abc-1");
  assert.equal(payloadQrUrl("abc-1"), "https://xumm.app/sign/abc-1_q.png");
  assert.equal(payloadQrUrl("abc-1", "https://xumm.app/sign/custom_q.png"), "https://xumm.app/sign/custom_q.png");
  assert.equal(isPhoneDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(isPhoneDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), true);
  assert.equal(isPhoneDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", { platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isPhoneDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  assert.equal(
    isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Twitter for iPhone"),
    true
  );
  assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14) TwitterAndroid"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (Linux; Android 14) Telegram-Android/11.2.3"), true);
  assert.equal(isTelegramWebView("Mozilla/5.0 (iPhone) Mobile/15E148 Telegram"), true);
  assert.equal(isTelegramWebView("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126"), false);
  assert.equal(isInAppBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126"), false);
});

test("xaman return URLs carry the payload id placeholder", () => {
  assert.equal(
    xamanReturnUrl("https://xio-exchange.dpmf.technology/"),
    "https://xio-exchange.dpmf.technology/?xaman={id}"
  );
  assert.equal(
    xamanWebsocketUrl("11111111-2222-4333-a444-555555555555"),
    "wss://xumm.app/sign/11111111-2222-4333-a444-555555555555"
  );
});

test("extractSignedAccount reads Xaman SignIn response shapes", () => {
  const account = "rMJAXYsbNzhwp7FfYnAsYP5ty3R9XnurPo";
  assert.equal(isClassicAddress(account), true);
  assert.equal(extractSignedAccount({ response: { account } }), account);
  assert.equal(extractSignedAccount({ payload: { response: { signer: account } } }), account);
  assert.equal(extractSignedAccount({ meta: { signed: true } }), null);
  assert.equal(payloadLooksSigned({ meta: { signed: true } }), true);
  assert.equal(payloadLooksSigned({ response: { account } }), false);
  assert.equal(payloadLooksSigned({ meta: { signed: true }, response: { account } }), true);
  assert.equal(extractSignedAccount({ account: "not-an-address" }), null);
  assert.equal(
    extractSignedAccount({
      meta: { signed: false, destination: account },
      payload: { tx_destination: account, request_json: { Account: account } },
    }),
    null
  );
  assert.equal(
    payloadLooksSigned({
      meta: { signed: false },
      payload: { request_json: { Account: account, TransactionType: "Payment" } },
    }),
    false
  );
  assert.equal(isReusableUnsignedPayload({ meta: { signed: false, resolved: false } }), true);
  assert.equal(isReusableUnsignedPayload({ meta: { signed: true, resolved: true } }), false);
  const started = Date.now();
  assert.equal(
    payloadSignedThisSession(
      {
        meta: { signed: true, resolved_at: new Date(started - 60_000).toISOString() },
        response: { account, resolved_at: new Date(started - 60_000).toISOString() },
      },
      started
    ),
    false
  );
  assert.equal(
    payloadSignedThisSession(
      {
        meta: { signed: true, resolved_at: new Date(started + 1000).toISOString() },
        response: { account, hex: "AA", resolved_at: new Date(started + 1000).toISOString() },
      },
      started
    ),
    true
  );
});

test("claimSignedWallet keeps polling until Xaman returns the signed account", async () => {
  const account = "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1";
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let calls = 0;
  const found = await claimSignedWallet(uuid, {
    waitMs: 0,
    fetchResult: async () => {
      calls += 1;
      if (calls < 3) return { meta: { signed: false } };
      return { meta: { signed: true }, response: { account } };
    },
  });
  assert.equal(found, account);
  assert.equal(calls, 3);
  const cancelled = await claimSignedWallet(uuid, {
    waitMs: 0,
    fetchResult: async () => ({ meta: { cancelled: true } }),
  });
  assert.equal(cancelled, null);
});

test("claimExecutedTrade only treats tesSUCCESS as executed", async () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const signedOnly = await claimExecutedTrade(uuid, {
    waitMs: 0,
    tries: 2,
    fetchResult: async () => ({ meta: { signed: true, resolved: true } }),
  });
  assert.equal(signedOnly, null);

  const claimed = await claimExecutedTrade(uuid, {
    waitMs: 0,
    fetchResult: async () => ({
      meta: { signed: true, submitted: true },
      response: { dispatched_result: "tesSUCCESS", txid: "A".repeat(64), account: "rA" },
    }),
  });
  assert.equal(claimed.executed, true);
  assert.equal(claimed.engineResult, "tesSUCCESS");

  const recovered = await claimExecutedTrade(uuid, {
    waitMs: 0,
    fetchResult: async () => ({
      meta: { signed: true, submitted: true },
      response: { dispatched_result: "tecUNFUNDED_AMM", txid: "B".repeat(64), account: "rA" },
    }),
    fetchLedger: async () => ({
      hash: "B".repeat(64),
      validated: true,
      Account: "rA",
      meta: { TransactionResult: "tesSUCCESS" },
    }),
  });
  assert.equal(recovered.executed, true);
  assert.equal(recovered.engineResult, "tesSUCCESS");
});

function memoryStore() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("Xaman return query and pending payload survive a fresh page", () => {
  const uuid = "11111111-2222-4333-a444-555555555555";
  assert.equal(isPayloadUuid(uuid), true);
  assert.equal(readXamanReturnUuid(`?xaman=${uuid}&utm=1`), uuid);
  assert.equal(readXamanReturnUuid("?foo=1"), null);

  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    rememberPendingPayload(uuid);
    assert.equal(peekPendingPayload()?.uuid, uuid);
    assert.equal(peekXamanUuid(""), uuid);
    assert.equal(takeXamanReturnUuid(""), uuid);
    assert.equal(takeXamanReturnUuid(`?xaman=${uuid}&utm=1`), uuid);
  } finally {
    clearPendingPayload();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("a new Xaman sign-in still resumes after iOS drops sessionStorage", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    rememberPendingPayload(uuid);
    globalThis.sessionStorage.removeItem("dpmf-xaman-pending");
    assert.equal(peekPendingPayload()?.uuid, uuid);
    assert.equal(takeXamanReturnUuid(""), uuid);
    clearPendingPayload();
    assert.equal(peekPendingPayload(), null);
  } finally {
    clearPendingPayload();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("a stale Xaman return uuid does not claim a newer pending trade", async () => {
  const oldUuid = "11111111-2222-4333-a444-555555555555";
  const newUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    rememberPendingPayload(newUuid, {
      watchTrade: true,
      txjson: { TransactionType: "AMMDeposit" },
      trade: { action: "addLp", quote: "XRP" },
    });
    assert.equal(peekXamanUuid(`?xaman=${oldUuid}`), newUuid);
    assert.equal(canClaimExecutedTrade(oldUuid), false);
    assert.equal(canClaimExecutedTrade(newUuid), true);
    assert.equal(takeXamanReturnUuid(`?xaman=${oldUuid}`), newUuid);
    assert.equal(peekPendingPayload()?.txjson?.TransactionType, "AMMDeposit");

    let fetched = 0;
    const claimed = await claimExecutedTrade(oldUuid, {
      waitMs: 0,
      tries: 1,
      fetchResult: async () => {
        fetched += 1;
        return {
          meta: { signed: true, submitted: true },
          response: { dispatched_result: "tesSUCCESS", txid: "B".repeat(64), account: "rA" },
        };
      },
    });
    assert.equal(claimed, null);
    assert.equal(fetched, 0);
  } finally {
    clearPendingPayload();
    clearConsumedUuids();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("a leftover tesSUCCESS trade is not auto-claimed without a Xaman return", async () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    rememberPendingPayload(uuid, {
      watchTrade: true,
      txjson: { TransactionType: "Payment" },
      trade: { action: "buy", quote: "XRP" },
    });
    assert.equal(shouldAutoClaimPendingTrade(""), false);
    assert.equal(shouldAutoClaimPendingTrade(`?xaman=${uuid}`), true);

    rememberConsumedUuid(uuid);
    assert.equal(isConsumedUuid(uuid), true);
    assert.equal(canClaimExecutedTrade(uuid), false);
    assert.equal(shouldAutoClaimPendingTrade(`?xaman=${uuid}`), false);
    const consumed = await claimExecutedTrade(uuid, {
      waitMs: 0,
      tries: 1,
      fetchResult: async () => ({
        payload: { tx_type: "Payment" },
        meta: { signed: true, submitted: true, resolved_at: new Date().toISOString() },
        response: { dispatched_result: "tesSUCCESS", txid: "C".repeat(64), account: "rA" },
      }),
    });
    assert.equal(consumed, null);
  } finally {
    clearPendingPayload();
    clearConsumedUuids();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("claimExecutedTrade rejects leftover SignIn and older resolved payloads", async () => {
  const uuid = "11111111-2222-4333-a444-555555555555";
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    const started = Date.now();
    rememberPendingPayload(uuid, {
      watchTrade: true,
      txjson: { TransactionType: "AMMDeposit" },
      trade: { action: "addLp", quote: "XRP" },
    });
    const record = peekPendingPayload();
    assert.equal(
      payloadMatchesPendingTrade(record, {
        payload: { tx_type: "SignIn" },
        meta: { signed: true, submitted: true, resolved_at: new Date(started + 1000).toISOString() },
        response: { dispatched_result: "tesSUCCESS", account: "rA" },
      }),
      false
    );
    assert.equal(
      payloadMatchesPendingTrade(record, {
        payload: { tx_type: "Payment" },
        meta: { signed: true, submitted: true, resolved_at: new Date(started + 1000).toISOString() },
        response: { dispatched_result: "tesSUCCESS", account: "rA" },
      }),
      false
    );
    assert.equal(
      payloadMatchesPendingTrade(record, {
        payload: { tx_type: "AMMDeposit" },
        meta: { signed: true, submitted: true, resolved_at: new Date(started - 60_000).toISOString() },
        response: { dispatched_result: "tesSUCCESS", account: "rA" },
      }),
      false
    );

    const signIn = await claimExecutedTrade(uuid, {
      waitMs: 0,
      tries: 1,
      fetchResult: async () => ({
        payload: { tx_type: "SignIn" },
        meta: { signed: true, submitted: true, resolved_at: new Date(started + 1000).toISOString() },
        response: { dispatched_result: "tesSUCCESS", txid: "D".repeat(64), account: "rA" },
      }),
    });
    assert.equal(signIn, null);

    const stale = await claimExecutedTrade(uuid, {
      waitMs: 0,
      tries: 1,
      fetchResult: async () => ({
        payload: { tx_type: "AMMDeposit" },
        meta: { signed: true, submitted: true, resolved_at: new Date(started - 60_000).toISOString() },
        response: { dispatched_result: "tesSUCCESS", txid: "E".repeat(64), account: "rA" },
      }),
    });
    assert.equal(stale, null);
  } finally {
    clearPendingPayload();
    clearConsumedUuids();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("opening a new trade discards a leftover watchTrade payload", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    rememberPendingPayload(uuid, {
      watchTrade: true,
      txjson: { TransactionType: "Payment" },
      trade: { action: "buy", quote: "XRP" },
    });
    assert.equal(discardStalePendingTrade({ force: true }), true);
    assert.equal(peekPendingPayload(), null);
    assert.equal(shouldAutoClaimPendingTrade(`?xaman=${uuid}`), false);
  } finally {
    clearPendingPayload();
    clearConsumedUuids();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
  }
});

test("opening Xaman for a sign stays on the in-house modal", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const opened = [];
  const assigned = [];
  const nodes = [];
  const result = launchXamanSign(uuid, {
    createFrame: () => {
      const node = { src: "", style: { cssText: "" }, setAttribute() {} };
      return node;
    },
    appendNode: (node) => nodes.push(node),
    removeNode: () => {},
    assignLocation: (href) => assigned.push(href),
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126",
  });
  assert.equal(result.opened, false);
  assert.equal(result.web, `https://xumm.app/sign/${uuid}`);
  assert.equal(opened.length, 0);
  assert.equal(assigned.length, 0);
  assert.equal(nodes.length, 1);
  assert.match(String(nodes[0].src || ""), /xumm:\/\//);
});

test("Telegram opens Xaman through a universal link, not a swallowed xumm:// tap", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const opened = [];
  const assigned = [];
  const result = launchXamanSign(uuid, {
    createFrame: null,
    appendNode: null,
    assignLocation: (href) => assigned.push(href),
    openExternal: (href) => opened.push(href),
    userAgent: "Mozilla/5.0 (Linux; Android 14) Telegram-Android/11.2.3",
  });
  assert.equal(result.opened, true);
  assert.equal(result.telegram, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0], `https://xumm.app/sign/${uuid}`);
  assert.equal(assigned.length, 0);
});

test("in-app browsers open the Xaman app, not the hosted console", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const assigned = [];
  const result = launchXamanSign(uuid, {
    createFrame: null,
    appendNode: null,
    assignLocation: (href) => assigned.push(href),
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Twitter for iPhone",
  });
  assert.equal(result.opened, true);
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0], `xumm://xumm.app/sign/${uuid}`);
  assert.doesNotMatch(String(assigned[0] || ""), /^https:\/\/xumm\.app\/sign\//);
});

test("iPhone Safari keeps the Connect href so the tap can open Xaman", () => {
  const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const assigned = [];
  const result = launchXamanSign(uuid, {
    createFrame: () => {
      const node = { src: "", style: { cssText: "" }, setAttribute() {} };
      return node;
    },
    appendNode: () => {},
    removeNode: () => {},
    assignLocation: (href) => assigned.push(href),
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  assert.equal(result.opened, false);
  assert.equal(result.web, `https://xumm.app/sign/${uuid}`);
  assert.equal(assigned.length, 0);
  assert.equal(shouldCancelConnectNavigation(result), false);
  assert.equal(shouldCancelConnectNavigation({ telegram: true, opened: true }), true);
  assert.equal(shouldCancelConnectNavigation({ telegram: true, opened: false }), false);
});

test("cancelled Xaman sessions do not stay open after reset", () => {
  const first = nextPayloadSession(0);
  const afterCancel = nextPayloadSession(first);
  assert.equal(payloadSessionOpen(first, first), true);
  assert.equal(payloadSessionOpen(first, afterCancel), false);
  assert.equal(payloadSessionOpen(0, 0), false);
  const buy = normalizeTradeRequest("buy");
  const sell = normalizeTradeRequest("sell");
  assert.equal(buy.action, "buy");
  assert.equal(sell.action, "sell");
});
