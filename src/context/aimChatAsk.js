/**
 * No-op AIM chat ask stub — AI Matrix removed from XIO Exchange.
 * Keeps HybridChart mark clicks from crashing.
 */
import {useSyncExternalStore} from "react";

let ask = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function publishAimChatAsk(next) {
  const text = String(next?.text || next || "").trim();
  if (!text) return null;
  ask = {
    text: text.slice(0, 2000),
    mark: next && typeof next === "object" ? next.mark || null : null,
    focus: false,
    open: false,
    seq: Date.now(),
    at: new Date().toISOString(),
  };
  emit();
  return ask;
}

export function getAimChatAsk() {
  return ask;
}

export function subscribeAimChatAsk(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAimChatAsk() {
  return useSyncExternalStore(subscribeAimChatAsk, getAimChatAsk, () => null);
}

export function clearAimChatAsk() {
  ask = null;
  emit();
}
