/** Chart actions from AIM Commander chat (ask side / show estimate). Shared by HybridChart views. */
import {useSyncExternalStore} from "react";

let action = null;
let seq = 0;
const listeners = new Set();

let narrate = null;
let narrateSeq = 0;
const narrateListeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function emitNarrate() {
  narrateListeners.forEach((fn) => {
    try {
      fn(narrate);
    } catch {
      /* ignore */
    }
  });
}

export function publishChartAction(next) {
  if (!next || typeof next !== "object") {
    action = null;
    seq += 1;
    emit();
    return null;
  }
  const type = String(next.type || "").trim();
  if (!type) return null;
  const sideRaw = String(next.side || "").toLowerCase();
  const side =
    sideRaw === "bull" || sideRaw === "bullish" || sideRaw === "long"
      ? "bull"
      : sideRaw === "bear" || sideRaw === "bearish" || sideRaw === "short"
        ? "bear"
        : null;
  const drawings = Array.isArray(next.drawings)
    ? next.drawings
        .filter((row) => row && typeof row === "object" && row.kind)
        .slice(0, 24)
        .map((row) => ({ ...row, source: row.source || "commander", commander: true }))
    : [];
  const narrate_steps = Array.isArray(next.narrate_steps)
    ? next.narrate_steps
        .filter((row) => row && typeof row === "object" && row.text)
        .slice(0, 32)
        .map((row) => ({
          id: String(row.id || "").slice(0, 64),
          text: String(row.text || "").slice(0, 500),
          kind: row.kind ? String(row.kind).slice(0, 32) : null,
        }))
    : [];
  action = {
    type,
    side,
    timeframe: next.timeframe ? String(next.timeframe) : null,
    pair: next.pair ? String(next.pair) : null,
    label: next.label ? String(next.label) : "Estimate by REMOVED-AI-Matrix",
    drawings,
    narrate_steps,
    pending_question: next.pending_question ? String(next.pending_question).slice(0, 400) : null,
    show_estimate: Boolean(next.show_estimate),
    seq: ++seq,
    at: new Date().toISOString(),
  };
  emit();
  return action;
}

export function getChartAction() {
  return action;
}

export function subscribeChartAction(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChartAction() {
  return useSyncExternalStore(subscribeChartAction, getChartAction, () => null);
}

export function clearChartAction() {
  action = null;
  seq += 1;
  emit();
}

/** Live narrate line while AI cursor lays tools (HybridChart -> RemovedAiMatrixPanel). */
export function publishChartNarrate(step) {
  if (!step || typeof step !== "object" || !step.text) return null;
  narrate = {
    id: String(step.id || "").slice(0, 64),
    text: String(step.text || "").slice(0, 500),
    kind: step.kind ? String(step.kind).slice(0, 32) : null,
    seq: ++narrateSeq,
    at: new Date().toISOString(),
  };
  emitNarrate();
  return narrate;
}

export function getChartNarrate() {
  return narrate;
}

export function subscribeChartNarrate(listener) {
  narrateListeners.add(listener);
  return () => narrateListeners.delete(listener);
}
