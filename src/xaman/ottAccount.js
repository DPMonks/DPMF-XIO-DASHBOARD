export function ottAccount(data) {
  const account = String(
    data?.account || data?.accountid || data?.address || data?.ott?.account || ""
  ).trim();
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account) ? account : "";
}

export function ottStyle(data, fallback = "") {
  return String(data?.style || data?.xAppStyle || fallback || "").trim();
}
