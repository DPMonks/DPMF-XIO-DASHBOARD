import test from "node:test";
import assert from "node:assert/strict";
import {searchFromVercelReq, suffixFromVercelReq} from "../server/vercelHandler.js";

test("searchFromVercelReq rebuilds query when req.url has no ?", () => {
  const search = searchFromVercelReq({
    url: "/api/top-holders",
    query: { limit: "5", offset: "100", snapshot: "today", path: "top-holders" },
  });
  assert.equal(search.includes("limit=5"), true);
  assert.equal(search.includes("offset=100"), true);
  assert.equal(search.includes("snapshot=today"), true);
  assert.equal(search.includes("path="), false);
});

test("searchFromVercelReq prefers ? on req.url when present", () => {
  assert.equal(
    searchFromVercelReq({ url: "/api/top-holders?limit=3&offset=50", query: { limit: "99" } }),
    "?limit=3&offset=50"
  );
});

test("suffixFromVercelReq still reads forced path query segments", () => {
  assert.equal(suffixFromVercelReq({ url: "/api/top-holders", query: { path: "top-holders" } }), "top-holders");
});
