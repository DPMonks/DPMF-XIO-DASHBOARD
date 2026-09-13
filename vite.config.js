import {defineConfig, loadEnv} from "vite";
import react from "@vitejs/plugin-react";
import {attachIndexerProxy} from "./server/attachProxy.js";
import {indexerOrigin} from "./server/proxyIndexer.js";
import lockedCandles from "./src/data/lockedCandles.json" with { type: "json" };
import {loadCexXrpUsdCandles} from "./server/cexOhlc.js";
import {hasIndexerDatabase, readIndexerDb} from "./server/readIndexerDb.js";
import {buildXamanPayload, isFreshXamanCreate, readJson, requestOrigin, xamanErrorMessage, xummHeaders} from "./api/xaman/_xumm.js";
import {applySecurityHeaders} from "./src/security/headers.js";

function xamanDevPlugin() {
  const middleware = async (req, res, next) => {
    try {
      const origin = requestOrigin(req);
      if (req.url?.startsWith("/api/xaman/create-payload") && req.method === "POST") {
        const body = await readJson(req);
        const response = await fetch("https://xumm.app/api/v1/platform/payload", {
          method: "POST",
          headers: xummHeaders(origin),
          body: JSON.stringify(buildXamanPayload(origin, body.txjson, body.options)),
        });
        const data = await response.json().catch(() => ({}));
        const stale = response.ok && !isFreshXamanCreate(data);
        res.statusCode = stale ? 409 : response.status;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            stale
              ? { error: "Xaman returned a payload that was already signed. Start a new sign.", code: 409 }
              : response.ok
                ? data
                : { error: xamanErrorMessage(data), code: data?.error?.code }
          )
        );
        return;
      }

      if (req.url?.startsWith("/api/chart/cex-candles") && req.method === "GET") {
        try {
          const url = new URL(req.url, "http://localhost");
          const interval = url.searchParams.get("interval") || url.searchParams.get("tf") || "15m";
          const limit = Number(url.searchParams.get("limit") || 500);
          const payload = await loadCexXrpUsdCandles({
            interval,
            limit: Number.isFinite(limit) ? limit : 500,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "public, max-age=15");
          res.end(
            JSON.stringify({
              ok: true,
              pair: payload.pair,
              quote: "USD",
              note: "RLUSD ~ USD; CEX tape for visual OHLC. Book overlays stay XRPL DEX.",
              source: payload.source,
              label: payload.label,
              interval: payload.interval,
              fetchId: payload.fetchId,
              resampleTo: payload.resampleTo,
              count: payload.count,
              candles: payload.candles,
            })
          );
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "CEX OHLC unavailable",
              code: error?.code || "CEX_OHLC_UNAVAILABLE",
            })
          );
        }
        return;
      }

      if (req.url?.startsWith("/api/chart/candles") && req.method === "GET") {
        let db = null;
        if (hasIndexerDatabase()) {
          const result = await readIndexerDb("chart/candles");
          if (result?.status < 400) {
            try {
              db = JSON.parse(result.body);
            } catch {
              db = null;
            }
          }
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ locked: true, snapshot: lockedCandles, db }));
        return;
      }

      if (req.url?.startsWith("/api/xaman/tx-status") && req.method === "GET") {
        const hash = new URL(req.url, "http://localhost").searchParams.get("hash") || "";
        if (!/^[A-Fa-f0-9]{64}$/.test(hash)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid transaction hash" }));
          return;
        }
        const { xrplRpc } = await import("./server/xrplBookOffers.js");
        try {
          const data = await xrplRpc("tx", { transaction: hash, binary: false });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data || { found: false }));
        } catch (error) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ found: false, error: error.message }));
        }
        return;
      }

      if (req.url?.startsWith("/api/xaman/xapp-ott") && req.method === "GET") {
        const token = new URL(req.url, "http://localhost").searchParams.get("token") || "";
        const { isXappOtt } = await import("./src/xaman/xappHost.js");
        const { publicOttView } = await import("./api/xaman/xapp-ott.js");
        if (!isXappOtt(token)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing xApp token" }));
          return;
        }
        const response = await fetch(
          `https://xumm.app/api/v1/platform/xapp/ott/${encodeURIComponent(token)}`,
          { headers: xummHeaders(origin) }
        );
        const data = await response.json().catch(() => ({}));
        res.statusCode = response.ok ? 200 : response.status;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            response.ok
              ? publicOttView(data)
              : { error: xamanErrorMessage(data, "Failed to read the Xaman xApp session") }
          )
        );
        return;
      }

      if (req.url?.startsWith("/api/xaman/payload-result") && req.method === "GET") {
        const uuid = new URL(req.url, "http://localhost").searchParams.get("uuid");
        const response = await fetch(
          `https://xumm.app/api/v1/platform/payload/${encodeURIComponent(uuid || "")}`,
          { headers: xummHeaders(origin) }
        );
        const data = await response.json().catch(() => ({}));
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            response.ok
              ? data
              : { error: xamanErrorMessage(data, "Failed to read Xaman payload") }
          )
        );
        return;
      }
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
    next();
  };

  return {
    name: "xaman-dev",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function securityHeadersPlugin() {
  const attach = (server, development) => {
    server.middlewares.use((_req, res, next) => {
      applySecurityHeaders(res, { development });
      next();
    });
  };
  return {
    name: "dpmf-security-headers",
    configureServer(server) {
      attach(server, true);
    },
    configurePreviewServer(server) {
      attach(server, false);
    },
  };
}

function indexerDevProxy() {
  return {
    name: "indexer-dev-proxy",
    configureServer(server) {
      attachIndexerProxy(server);
    },
    configurePreviewServer(server) {
      attachIndexerProxy(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);
  indexerOrigin(env);
  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    plugins: [securityHeadersPlugin(), react(), xamanDevPlugin(env), indexerDevProxy()],
    server: {
      host: true,
      port: 5173,
    },
    preview: {
      host: true,
      port: 4173,
    },
  };
});
