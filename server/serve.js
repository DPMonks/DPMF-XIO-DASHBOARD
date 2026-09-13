import {createReadStream, existsSync, statSync} from "node:fs";
import {createServer} from "node:http";
import {extname, join, normalize} from "node:path";
import {fileURLToPath} from "node:url";
import {fetchIndexerFirst, handshakePostBody, indexerPathsFor, proxyCorsHeaders, proxyResponseHeaders} from "./proxyIndexer.js";
import {suffixFromPath} from "./attachProxy.js";
import {applySecurityHeaders} from "../src/security/headers.js";

const dist = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendFile(res, file) {
  const type = types[extname(file)] || "application/octet-stream";
  applySecurityHeaders(res);
  res.setHeader("content-type", type);
  createReadStream(file).pipe(res);
}

function safeFile(urlPath) {
  const relative = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(dist, relative);
  if (!file.startsWith(dist)) return null;
  if (existsSync(file) && statSync(file).isFile()) return file;
  return null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const pathOnly = url.split("?")[0];
  const suffix = suffixFromPath(pathOnly);


  if (suffix != null) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, proxyCorsHeaders(req));
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
      res.writeHead(last?.status || 502, proxyResponseHeaders(last, req));
      res.end(last?.body || JSON.stringify({ error: "Indexer proxy failed" }));
    } catch (error) {
      res.writeHead(502, {
        "content-type": "application/json",
        ...proxyCorsHeaders(req),
      });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  const file = safeFile(pathOnly) || join(dist, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found. Run npm run build first.");
    return;
  }
  sendFile(res, file);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`DPMF dashboard + indexer proxy on http://0.0.0.0:${port}`);
});
