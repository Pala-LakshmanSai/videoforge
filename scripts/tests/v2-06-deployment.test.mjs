import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { requireNonEmptyClientAsset } from "../../deploy/v2-06/render-staging-config.mjs";
import { parseOrigin } from "../../deploy/v2-06/render-r2-cors.mjs";

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

test("V2-06 CORS renderer only accepts an exact HTTPS origin", () => {
  assert.equal(parseOrigin(origin), origin);
  assert.throws(
    () => parseOrigin("https://*.example.workers.dev"),
    /credential-free HTTPS origin/u,
  );
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "videoforge-v2-06-cors-"));
  const corsOutput = join(temporaryDirectory, "cors.json");
  try {
    const result = spawnSync(
      process.execPath,
      ["deploy/v2-06/render-r2-cors.mjs", "--origin", origin, "--output", corsOutput],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const cors = JSON.parse(readFileSync(corsOutput, "utf8"));
    assert.deepEqual(cors.rules[0].allowed.origins, [origin]);
    assert.deepEqual(cors.rules[0].allowed.methods, ["GET", "PUT", "HEAD"]);
    assert.equal(cors.rules[0].maxAgeSeconds, 3600);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const fixtureDirectory = mkdtempSync(join(tmpdir(), "videoforge-v2-06-render-fixture-"));
const releaseManifestFile = join(fixtureDirectory, "release.json");
const releaseManifest = `${JSON.stringify(
  {
    schema_version: "videoforge-media-worker-release/v1",
    version: "0.1.0",
    minimum_protocol_version: 1,
    execution_bundle_sha256: `sha256:${"1".repeat(64)}`,
    whisper_model_sha256: `sha256:${"2".repeat(64)}`,
    windows: {
      url: "https://example.invalid/videoforge-worker.exe",
      sha256: `sha256:${"3".repeat(64)}`,
      size_bytes: 1,
      trust: "UNSIGNED_BETA",
    },
    macos: {
      url: "https://example.invalid/videoforge-worker.dmg",
      sha256: `sha256:${"4".repeat(64)}`,
      size_bytes: 1,
      trust: "AD_HOC_BETA",
    },
  },
  null,
  2,
)}\n`;
writeFileSync(releaseManifestFile, releaseManifest, { encoding: "utf8", mode: 0o600 });
const releaseManifestSha256 = `sha256:${createHash("sha256").update(releaseManifest).digest("hex")}`;
const activationRecordFile = join(fixtureDirectory, "activation.json");
writeFileSync(
  activationRecordFile,
  `${JSON.stringify(
    {
      schema_version: "videoforge-v2-06-activation/v1",
      checkpoint: "V2-06",
      authority: {
        mode: "APPROVED",
        maximum_cumulative_finite_external_spend_usd: 3,
        approved_at: "2026-08-17T00:00:00.000Z",
        non_transferable: true,
      },
      cloudflare: {
        account_id_sha256: `sha256:${createHash("sha256")
          .update("f9254d773a3426fcb469451b1f965d8c")
          .digest("hex")}`,
        worker: "videoforge-v2-06-staging",
        workflow: "videoforge-v2-06-staging-video",
        r2_bucket: "videoforge-v2-06-staging-private",
        r2_location: "auto",
        domain: new URL(origin).hostname,
      },
      personal_media_workers: { release_manifest_sha256: releaseManifestSha256 },
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);
const renderArgs = (commit) => [
  renderer,
  "--account-id",
  "f9254d773a3426fcb469451b1f965d8c",
  "--origin",
  origin,
  "--commit",
  commit,
  "--release-manifest-file",
  releaseManifestFile,
  "--activation-record",
  activationRecordFile,
  "--output",
  "/tmp/videoforge-v2-06-test-rendered-config.json",
];

test.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

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
