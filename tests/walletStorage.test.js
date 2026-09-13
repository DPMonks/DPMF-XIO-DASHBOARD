import test from "node:test";
import assert from "node:assert/strict";
import {WALLET_STORAGE_KEY, clearLiveWallet, liveWalletAddress, persistLiveWallet, readLiveWallet, resolveNeedSignIn} from "../src/wallet/walletStorage.js";
import {gateUnsignedTrade} from "../src/xaman/tradeTx.js";

const SIGNED = "rN7n7suQDqawFkUvqhD56VwThRCFSStdz1";

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

function withWalletStores(fn) {
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
  };
  globalThis.sessionStorage = memoryStore();
  globalThis.localStorage = memoryStore();
  globalThis.window = { userAccount: null };
  try {
    return fn();
  } finally {
    clearLiveWallet();
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
  }
}

test("header sign-in is remembered in session and local storage", () => {
  withWalletStores(() => {
    assert.equal(readLiveWallet(), null);
    assert.equal(persistLiveWallet(SIGNED), SIGNED);
    assert.equal(globalThis.sessionStorage.getItem(WALLET_STORAGE_KEY), SIGNED);
    assert.equal(globalThis.localStorage.getItem(WALLET_STORAGE_KEY), SIGNED);
    assert.equal(globalThis.window.userAccount, SIGNED);
    assert.equal(readLiveWallet(), SIGNED);
  });
});

test("live wallet survives iOS dropping sessionStorage after Xaman", () => {
  withWalletStores(() => {
    persistLiveWallet(SIGNED);
    globalThis.sessionStorage.removeItem(WALLET_STORAGE_KEY);
    globalThis.window.userAccount = null;
    assert.equal(readLiveWallet(), SIGNED);
    assert.equal(liveWalletAddress(null), SIGNED);
  });
});

test("already signed-in sessions open trades instead of asking again", () => {
  withWalletStores(() => {
    persistLiveWallet(SIGNED);
    assert.equal(liveWalletAddress(null), SIGNED);
    assert.equal(resolveNeedSignIn(null).action, "already-signed-in");
    assert.equal(resolveNeedSignIn(null).account, SIGNED);
    assert.equal(gateUnsignedTrade("addLp", null).action, "open");
    assert.equal(gateUnsignedTrade({ action: "buy", pair: "XIO/XDX" }, null).action, "open");
  });
});

test("trade boxes only offer sign-in when no live wallet exists", () => {
  withWalletStores(() => {
    assert.equal(resolveNeedSignIn(null).action, "start-sign-in");
    assert.equal(gateUnsignedTrade("addLp", null).action, "sign-in");
    persistLiveWallet(SIGNED);
    assert.equal(resolveNeedSignIn("").action, "already-signed-in");
    clearLiveWallet();
    assert.equal(readLiveWallet(), null);
    assert.equal(gateUnsignedTrade("sell", null).action, "sign-in");
    assert.equal(liveWalletAddress("rSignedIn"), "rSignedIn");
  });
});
