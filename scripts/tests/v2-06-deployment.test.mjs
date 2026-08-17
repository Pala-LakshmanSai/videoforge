import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = "deploy/v2-06/verify-r2-cors.mjs";
const origin = "https://videoforge-v2-06-staging.example.workers.dev";
const output = [
  "Listing CORS rules for bucket 'videoforge-v2-06-staging-private'...",
  `allowed_origins: ${origin}`,
  "allowed_methods: GET, PUT, HEAD",
  "allowed_headers: Content-Type, x-amz-checksum-sha256",
  "exposed_headers: Content-Length, Content-Type, ETag, x-amz-checksum-sha256",
  "max_age_seconds: 3600",
].join("\n");

test("V2-06 CORS verifier accepts Wrangler's exact policy output", () => {
  const result = spawnSync(process.execPath, [verifier, "--origin", origin], {
    input: output,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exact origin, methods, headers/u);
});

test("V2-06 CORS verifier rejects wildcard origins", () => {
  const result = spawnSync(process.execPath, [verifier, "--origin", origin], {
    input: output.replace(origin, "*"),
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /allowed origin is not exact|wildcard/u);
});
