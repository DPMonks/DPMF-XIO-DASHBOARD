import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {proxyCorsHeaders} from "../server/proxyIndexer.js";
import {contentSecurityPolicy, isAllowedDashboardOrigin, securityHeaders} from "../src/security/headers.js";
import {isTrackerHost, shouldStripInjectedNode, trustedScriptUrl} from "../src/security/platformGuard.js";

test("production CSP does not allow third-party scripts or eval", () => {
  const csp = contentSecurityPolicy();
  assert.match(csp, /script-src 'self'/);
  assert.equal(csp.includes("unsafe-eval"), false);
  assert.equal(csp.includes("ipwho.is"), false);
  assert.equal(csp.includes("ipapi.co"), false);
  assert.match(csp, /connect-src[^;]*https:\/\/xumm\.app/);
  assert.match(csp, /frame-src[^;]*https:\/\/dexscreener\.com/);
  assert.match(csp, /frame-src[^;]*https:\/\/\*\.dexscreener\.com/);
  assert.match(csp, /frame-ancestors 'self' https:\/\/dpmf\.technology/);
  assert.match(csp, /frame-ancestors[^;]*https:\/\/xumm\.app/);
});

test("only DPMF and local origins may call the dashboard API from a browser", () => {
  assert.equal(isAllowedDashboardOrigin("https://xio-exchange.dpmf.technology"), true);
  assert.equal(isAllowedDashboardOrigin("https://www.dpmf.technology"), true);
  assert.equal(isAllowedDashboardOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedDashboardOrigin("https://evil.example"), false);
  assert.equal(isAllowedDashboardOrigin("https://dpmf.technology.evil.com"), false);
  const blocked = proxyCorsHeaders({ headers: { origin: "https://evil.example" } });
  assert.equal(blocked["access-control-allow-origin"], "https://xio-exchange.dpmf.technology");
  const allowed = proxyCorsHeaders({
    headers: { origin: "https://xio-exchange.dpmf.technology" },
  });
  assert.equal(allowed["access-control-allow-origin"], "https://xio-exchange.dpmf.technology");
});

test("injected tracker scripts are stripped; Xaman and same-origin stay", () => {
  assert.equal(trustedScriptUrl("/assets/index.js", "https://xio-exchange.dpmf.technology"), true);
  assert.equal(
    trustedScriptUrl("https://evil.example/hook.js", "https://xio-exchange.dpmf.technology"),
    false
  );
  assert.equal(isTrackerHost("www.google-analytics.com"), true);
  assert.equal(isTrackerHost("xumm.app"), false);
  const tracker = {
    tagName: "SCRIPT",
    src: "https://www.google-analytics.com/analytics.js",
    getAttribute(name) {
      return name === "src" ? this.src : "";
    },
  };
  assert.equal(shouldStripInjectedNode(tracker, "https://xio-exchange.dpmf.technology"), true);
  const app = {
    tagName: "SCRIPT",
    src: "https://xio-exchange.dpmf.technology/assets/index.js",
    getAttribute(name) {
      return name === "src" ? this.src : "";
    },
  };
  assert.equal(shouldStripInjectedNode(app, "https://xio-exchange.dpmf.technology"), false);
});

test("Vercel ships the same production security headers", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url)));
  const expected = securityHeaders();
  const row = vercel.headers?.find((item) => item.source === "/(.*)");
  assert.ok(row, "missing /.* header rule");
  const got = Object.fromEntries(
    (row.headers || []).map((item) => [String(item.key).toLowerCase(), item.value])
  );
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(got[key], value, key);
  }
});
