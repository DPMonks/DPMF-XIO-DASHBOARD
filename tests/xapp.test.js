import test from "node:test";
import assert from "node:assert/strict";
import {publicOttView} from "../api/xaman/xapp-ott.js";
import {ottAccount} from "../src/xaman/ottAccount.js";
import {applyXappBootClass, isXappHost, isXappOtt, isXappPayloadEvent, openExternalUrl, parseXappNativeEvent, readXappLaunch, rememberXappHost, sendXappCommand, xappCommand} from "../src/xaman/xappHost.js";

function memoryStore() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function withStores(fn) {
  const previousSession = globalThis.sessionStorage;
  const previousLocal = globalThis.localStorage;
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  try {
    return fn();
  } finally {
    if (previousSession === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSession;
    if (previousLocal === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocal;
  }
}

test("xApp launch reads the one-time token and style from the URL", () => {
  const launch = readXappLaunch("?xAppToken=5d744667-1e04-4713-86fb-1c1258eda0fd&xAppStyle=DARK");
  assert.equal(launch.token, "5d744667-1e04-4713-86fb-1c1258eda0fd");
  assert.equal(launch.style, "DARK");
  assert.equal(isXappOtt("not-a-token"), false);
  assert.equal(isXappOtt(""), false);
});

test("xApp host is remembered in sessionStorage after the token is stripped", () => {
  withStores(() => {
    rememberXappHost(true, "DARK");
    assert.equal(isXappHost(""), false);
    assert.equal(globalThis.sessionStorage.getItem("dpmf-xapp-host"), "1");
    assert.equal(globalThis.localStorage.getItem("dpmf-xapp-host"), null);
    const webview = { ReactNativeWebView: { postMessage() {} } };
    assert.equal(isXappHost("", webview), true);
    rememberXappHost(false);
    assert.equal(isXappHost(""), false);
  });
});

test("xApp commands use the native WebView payload shape", () => {
  assert.equal(xappCommand("ready"), JSON.stringify({ command: "ready" }));
  assert.equal(
    xappCommand("openSignRequest", { uuid: "abc" }),
    JSON.stringify({ command: "openSignRequest", uuid: "abc" })
  );
  assert.equal(
    xappCommand("openBrowser", { url: "https://dpmf.technology" }),
    JSON.stringify({ command: "openBrowser", url: "https://dpmf.technology" })
  );

  const posted = [];
  const win = {
    ReactNativeWebView: {
      postMessage(value) {
        posted.push(value);
      },
    },
  };
  assert.equal(sendXappCommand("ready", {}, win), true);
  assert.equal(sendXappCommand("openSignRequest", { uuid: "abc" }, win), true);
  assert.deepEqual(posted, [
    JSON.stringify({ command: "ready" }),
    JSON.stringify({ command: "openSignRequest", uuid: "abc" }),
  ]);
});

test("xApp native payload events parse signed and declined reasons", () => {
  const signed = parseXappNativeEvent({
    data: JSON.stringify({ method: "payloadResolved", reason: "SIGNED", uuid: "abc" }),
  });
  assert.equal(signed.signed, true);
  assert.equal(signed.uuid, "abc");
  assert.equal(isXappPayloadEvent(signed), true);

  const declined = parseXappNativeEvent({
    data: { event: "payload", reason: "DECLINED", uuid: "def" },
  });
  assert.equal(declined.declined, true);
  assert.equal(declined.uuid, "def");
});

test("xApp external links stay in the wallet browser overlay", () => {
  const posted = [];
  const win = {
    location: { search: "?xAppToken=5d744667-1e04-4713-86fb-1c1258eda0fd" },
    ReactNativeWebView: {
      postMessage(value) {
        posted.push(value);
      },
    },
    open() {
      throw new Error("window.open must not run inside the xApp");
    },
  };
  assert.equal(openExternalUrl("https://dpmf.technology", win), true);
  assert.equal(
    posted[0],
    JSON.stringify({ command: "openBrowser", url: "https://dpmf.technology" })
  );
  assert.equal(openExternalUrl("https://t.me/DPMF_XIO", win), true);
  assert.equal(
    posted[1],
    JSON.stringify({ command: "openBrowser", url: "https://t.me/DPMF_XIO" })
  );
  assert.equal(openExternalUrl("javascript:alert(1)", win), false);
});

test("xApp boot class is applied only inside the wallet webview", () => {
  const classes = new Set();
  const win = {
    location: { search: "?xAppToken=5d744667-1e04-4713-86fb-1c1258eda0fd" },
    document: {
      documentElement: {
        classList: {
          add(name) {
            classes.add(name);
          },
        },
      },
      body: {
        classList: {
          add(name) {
            classes.add(`body:${name}`);
          },
        },
      },
    },
  };
  assert.equal(applyXappBootClass(win), true);
  assert.equal(classes.has("xapp"), true);
});

test("xApp OTT public view only returns the signed-in account", () => {
  assert.equal(ottAccount({ account: "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1" }), "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1");
  assert.equal(ottAccount({ account: "not-an-address" }), "");
  const view = publicOttView({
    account: "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1",
    style: "DARK",
    nodetype: "MAINNET",
    jwt: "secret-should-stay-off-the-page",
    user: "device-uuid",
  });
  assert.equal(view.account, "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1");
  assert.equal(view.style, "DARK");
  assert.equal(view.jwt, undefined);
  assert.equal(view.user, undefined);
});
