import {fetchIndexerFirst, handshakePostBody, indexerPathsFor, proxyCorsHeaders, proxyResponseHeaders} from "./proxyIndexer.js";

export function suffixFromVercelReq(req) {
  const q = req.query?.path;
  if (Array.isArray(q)) {
    const joined = q.filter((part) => part && part !== "index").join("/");
    if (joined) return joined;
  }
  if (typeof q === "string" && q && q !== "index") {
    return q.replace(/^\//, "");
  }

  const pathOnly = String(req.url || "").split("?")[0];
  if (pathOnly === "/health" || pathOnly === "/api/health") return "health";
  if (pathOnly === "/health/xrpl" || pathOnly === "/api/health/xrpl") {
    return "health/xrpl";
  }
  if (pathOnly === "/handshake" || pathOnly === "/api/handshake") return "handshake";
  if (pathOnly.startsWith("/cluster/")) return pathOnly.slice(1);
  if (pathOnly === "/api" || pathOnly === "/api/") return "";
  if (pathOnly.startsWith("/api/")) {
    const rest = pathOnly.slice(5);
    if (rest && rest !== "index") return rest;
  }
  return "";
}

export async function writeIndexerResponse(req, res, forcedSuffix) {
  for (const [key, value] of Object.entries(proxyCorsHeaders(req))) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const suffix = forcedSuffix ?? suffixFromVercelReq(req);
  if (suffix.startsWith("xaman")) {
    res.status(404).json({ error: "Xaman stays on dashboard /api/xaman/*" });
    return;
  }

  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const isHandshake = /handshake$/i.test(suffix);
  const method = isHandshake && req.method === "HEAD" ? "GET" : req.method;
  const body =
    method === "POST" || method === "PUT"
      ? handshakePostBody(req.body)
      : undefined;

  try {
    const last = await fetchIndexerFirst(indexerPathsFor(suffix), {
      method,
      body,
      search,
      suffix,
    });
    res.status(last?.status || 502);
    for (const [key, value] of Object.entries(proxyResponseHeaders(last, req))) {
      res.setHeader(key, value);
    }
    res.setHeader("cache-control", "s-maxage=30, stale-while-revalidate=120");
    res.send(last?.body || JSON.stringify({ error: "Indexer proxy failed" }));
  } catch (error) {
    res.status(502).json({ error: error.message || "Indexer proxy failed" });
  }
}
