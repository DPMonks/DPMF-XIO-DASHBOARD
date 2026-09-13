const CATALOG_DOWN_MS = 8_000;
let catalogDownUntil = 0;

export function isLiveLedgerPath(path) {
  const text = String(path || "");
  if (/\/xaman\b/i.test(text)) return true;
  return /\/(wallet\/|balances\/|networth\/|prices|change24h|lp-pools|swap-market|orderbooks?|overview|token-details|issuer-locked|holders|trustlines|top-|amm|pools|trades|xio-flows|sparkline|charts?|xaman)\b/i.test(
    text
  );
}

export function isPostgresOutageStatus(status, text = "") {
  if (Number(status) === 503) return true;
  return /postgres|temporarily unreachable|timeout exceeded when trying to connect/i.test(
    String(text || "")
  );
}

export function publicApiErrorMessage(data = {}, status = 0) {
  const raw = String(data.error || data.detail || "").trim();
  if (isPostgresOutageStatus(status, raw) || /postgres/i.test(String(data.hint || ""))) {
    return "Market data is temporarily unavailable.";
  }
  if (Number(status) === 429) return "Indexer rate-limited. The page will retry.";
  if (raw) return raw;
  if (Number(status) === 404) return "This host has no /api function.";
  return Number(status) ? `${status} request failed` : "Failed to fetch /api";
}

export function markCatalogDown(now = Date.now()) {
  catalogDownUntil = now + CATALOG_DOWN_MS;
  return catalogDownUntil;
}

export function catalogFetchBlocked(path, now = Date.now()) {
  if (now >= catalogDownUntil) return false;
  return !isLiveLedgerPath(path);
}

export function resetCatalogDown() {
  catalogDownUntil = 0;
}
