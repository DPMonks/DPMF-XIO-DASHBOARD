import test from "node:test";
import assert from "node:assert/strict";
import {postgresPoolOptions, sanitizeDatabaseUrl} from "../server/readIndexerDb.js";

const REQUIRE =
  "postgres://postgres:s3cret@acela.proxy.rlwy.net:48994/railway?sslmode=require";

test("strips sslmode=require from the Railway TCP URL", () => {
  const clean = sanitizeDatabaseUrl(REQUIRE);
  assert.equal(/sslmode=require/i.test(clean), false);
  assert.match(clean, /acela\.proxy\.rlwy\.net:48994/);
  assert.match(clean, /railway/);
});

test("keeps sslmode=no-verify only when another query param remains", () => {
  const extra = sanitizeDatabaseUrl(
    "postgres://postgres@acela.proxy.rlwy.net:48994/railway?application_name=dpmf&sslmode=require"
  );
  assert.equal(/sslmode=require/i.test(extra), false);
  assert.match(extra, /sslmode=no-verify/i);
  assert.match(extra, /application_name=dpmf/);
});

test("pool options force rejectUnauthorized false and drop the URL override", () => {
  const opts = postgresPoolOptions(REQUIRE);
  assert.deepEqual(opts.ssl, { rejectUnauthorized: false });
  assert.equal(opts.host, "acela.proxy.rlwy.net");
  assert.equal(opts.port, 48994);
  assert.equal(opts.user, "postgres");
  assert.equal(opts.database, "railway");
  assert.equal(opts.password, "s3cret");
  assert.equal(opts.connectionString, undefined);
  assert.equal(opts.connectionTimeoutMillis, 2500);
  assert.equal(opts.max, 2);
});
