export const WALLET_STORAGE_KEY = "dpmf-xio-wallet";

function storeOf(name) {
  try {
    const store = globalThis[name];
    if (store && typeof store.getItem === "function") return store;
  } catch {
    // private mode / blocked storage
  }
  return null;
}

export function normalizeWalletAccount(value, { strict = false } = {}) {
  const text = String(value || "").trim();
  if (!text.startsWith("r")) return null;
  if (strict && (text.length < 25 || text.length > 48)) return null;
  if (!strict && text.length < 4) return null;
  return text;
}

function readStore(store) {
  if (!store) return null;
  try {
    return normalizeWalletAccount(store.getItem(WALLET_STORAGE_KEY), { strict: true });
  } catch {
    return null;
  }
}

function writeStore(store, account) {
  if (!store) return;
  try {
    if (account) store.setItem(WALLET_STORAGE_KEY, account);
    else store.removeItem(WALLET_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function readLiveWallet() {
  if (typeof window !== "undefined") {
    const fromWindow = normalizeWalletAccount(window.userAccount);
    if (fromWindow) return fromWindow;
  }
  return readStore(storeOf("sessionStorage")) || readStore(storeOf("localStorage"));
}

export function liveWalletAddress(preferred) {
  return normalizeWalletAccount(preferred) || readLiveWallet();
}

export function persistLiveWallet(account) {
  const next = normalizeWalletAccount(account);
  if (typeof window !== "undefined") window.userAccount = next;
  writeStore(storeOf("sessionStorage"), next);
  writeStore(storeOf("localStorage"), next);
  return next;
}

export function clearLiveWallet() {
  return persistLiveWallet(null);
}

export function resolveNeedSignIn(walletAddress) {
  const account = liveWalletAddress(walletAddress);
  if (account) return { action: "already-signed-in", account };
  return { action: "start-sign-in" };
}
