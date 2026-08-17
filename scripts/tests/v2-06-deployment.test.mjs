import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { requireNonEmptyClientAsset } from "../../deploy/v2-06/render-staging-config.mjs";

const verifier = "deploy/v2-06/verify-r2-cors.mjs";
const renderer = "deploy/v2-06/render-staging-config.mjs";
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

const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const renderArgs = (commit) => [
  renderer,
  "--account-id",
  "f9254d773a3426fcb469451b1f965d8c",
  "--origin",
  origin,
  "--commit",
  commit,
  "--release-manifest-file",
  "/tmp/videoforge-v2-06-test-release-manifest.json",
  "--output",
  "/tmp/videoforge-v2-06-test-rendered-config.json",
];

test("V2-06 renderer rejects a nonexistent full-length commit SHA", () => {
  const result = spawnSync(process.execPath, [renderArgs("0".repeat(40))].flat(), {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /existing Git commit/u);
});

test("V2-06 renderer rejects an abbreviated commit SHA", () => {
  const result = spawnSync(process.execPath, [renderArgs("deadbee")].flat(), {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /full 40-hex Git commit SHA/u);
});

test("V2-06 renderer rejects an existing commit that is not current HEAD", () => {
  const previousHead = execFileSync("git", ["rev-parse", `${currentHead}^`], {
    encoding: "utf8",
  }).trim();
  const result = spawnSync(process.execPath, [renderArgs(previousHead)].flat(), {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /exactly equal the current HEAD/u);
});

test("V2-06 renderer rejects a dirty alternate index without touching the repository", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "videoforge-v2-06-index-"));
  const alternateIndex = join(temporaryDirectory, "index");
  const environment = { ...process.env, GIT_INDEX_FILE: alternateIndex };
  try {
    const readTree = spawnSync("git", ["read-tree", "HEAD"], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    });
    assert.equal(readTree.status, 0, readTree.stderr);
    const alternateBlob = execFileSync("git", ["rev-parse", "HEAD:AGENTS.md"], {
      encoding: "utf8",
    }).trim();
    const updateIndex = spawnSync(
      "git",
      ["update-index", "--add", "--cacheinfo", `100644,${alternateBlob},README.md`],
      { cwd: process.cwd(), env: environment, encoding: "utf8" },
    );
    assert.equal(updateIndex.status, 0, updateIndex.stderr);
    const result = spawnSync(process.execPath, [renderArgs(currentHead)].flat(), {
      env: environment,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /working tree has unstaged changes/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("V2-06 renderer rejects empty client assets, including marker-only output", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "videoforge-v2-06-assets-"));
  try {
    writeFileSync(join(temporaryDirectory, ".assetsignore"), "assets/*\n");
    await assert.rejects(
      () => requireNonEmptyClientAsset(temporaryDirectory),
      /no non-empty regular client asset/u,
    );
    writeFileSync(join(temporaryDirectory, "empty.js"), "");
    await assert.rejects(
      () => requireNonEmptyClientAsset(temporaryDirectory),
      /no non-empty regular client asset/u,
    );
    writeFileSync(join(temporaryDirectory, "index.html"), "<!doctype html>\n");
    await requireNonEmptyClientAsset(temporaryDirectory);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
