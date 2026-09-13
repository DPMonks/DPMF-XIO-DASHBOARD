import test from "node:test";
import assert from "node:assert/strict";
import {orderbookPairFromSearch} from "../server/liveCatalog.js";

test("orderbookPairFromSearch honors pair, quote, and market query params", () => {
  assert.equal(orderbookPairFromSearch("?pair=XIO/XDX"), "XIO/XDX");
  assert.equal(orderbookPairFromSearch("pair=XIO%2FXSQUAD"), "XIO/XSQUAD");
  assert.equal(orderbookPairFromSearch("?quote=RLUSD"), "XIO/RLUSD");
  assert.equal(orderbookPairFromSearch("?market=xio"), "XIO/XDX");
  assert.equal(orderbookPairFromSearch(""), "XIO/XRP");
});
