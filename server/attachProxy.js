import {fetchIndexerFirst, handshakePostBody, indexerPathsFor, proxyCorsHeaders, proxyResponseHeaders} from "./proxyIndexer.js";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function suffixFromPath(pathOnly) {
  if (pathOnly.startsWith("/api/xaman")) return null;
  if (pathOnly.startsWith("/api/chart")) return null;
  if (pathOnly.startsWith("/api/aim")) return null;
  if (pathOnly === "/handshake") return "handshake";
  if (pathOnly.startsWith("/cluster/")) return pathOnly.slice(1);
  if (pathOnly === "/health") return "health";
  if (pathOnly === "/api" || pathOnly === "/api/") return "";
  if (pathOnly.startsWith("/api/")) return pathOnly.slice(5);
  return null;
}

export function attachIndexerProxy(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = req.url || "";
    const pathOnly = url.split("?")[0];
    const suffix = suffixFromPath(pathOnly);
    if (suffix == null) {
      next();
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      for (const [key, value] of Object.entries(proxyCorsHeaders(req))) {
        res.setHeader(key, value);
      }
      res.end();
      return;
    }

    try {
      const search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
      const method = req.method || "GET";
      const body =
        method === "POST" || method === "PUT"
          ? handshakePostBody(await readJsonBody(req))
          : undefined;
      const last = await fetchIndexerFirst(indexerPathsFor(suffix), {
        method,
        body,
        search,
        suffix,
      });
      res.statusCode = last?.status || 502;
      for (const [key, value] of Object.entries(proxyResponseHeaders(last, req))) {
        res.setHeader(key, value);
      }
      res.end(last?.body || JSON.stringify({ error: "Indexer proxy failed" }));
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      for (const [key, value] of Object.entries(proxyCorsHeaders(req))) {
        res.setHeader(key, value);
      }
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}
