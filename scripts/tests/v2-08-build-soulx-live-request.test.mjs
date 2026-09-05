import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  INPUT_MANIFEST_SCHEMA,
  REQUEST_SCHEMA,
  assertProposalBinding,
  buildSoulXInputManifest,
  buildSoulXLiveRequest,
  canonicalJson,
  parseArgs,
  writeSoulXLiveRequestBundle,
} from "../../deploy/v2-08/build-soulx-live-request.mjs";

const R2_ACCOUNT_ID = "f9254d773a3426fcb469451b1f965d8c";
const R2_BUCKET_NAME = "videoforge-v2-06-staging-private";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const TEST_PROPOSAL = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/approved-authority.json",
    ),
    "utf8",
  ),
).lineage.proposal_sha256;

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

test("V2-08 builder emits the exact proposal-derived, provider-free request shape", () => {
  const built = buildSoulXLiveRequest({
    proposalSha256: TEST_PROPOSAL,
    r2AccountId: R2_ACCOUNT_ID,
    r2BucketName: R2_BUCKET_NAME,
    repositoryRoot: ROOT,
    compiledProposalSha256: TEST_PROPOSAL,
  });
  assert.equal(built.requestId, `v208-${TEST_PROPOSAL.slice(7)}`);
  assert.equal(built.request.schema_version, REQUEST_SCHEMA);
  assert.equal(built.request.command, "soulx-live-qualification");
  assert.equal(built.request.request_id, built.requestId);
  assert.deepEqual(built.request.r2, {
    account_id: R2_ACCOUNT_ID,
    bucket_name: R2_BUCKET_NAME,
  });
  assert.equal(built.request.input.dualLaneInput.qualificationR2.accountId, R2_ACCOUNT_ID);
  assert.equal(built.request.input.dualLaneInput.qualificationR2.bucketName, R2_BUCKET_NAME);
  assert.deepEqual(built.request.input.dualLaneInput.qualificationCaseDescriptors, [
    {
      key: "mage",
      lane: "mage",
      id: "mage-cold-representative",
      seconds: 0,
      mode: "complete",
      cold: true,
    },
    {
      key: "soulx2s",
      lane: "soulx",
      id: "soulx-cold-2s",
      seconds: 2,
      mode: "complete",
      cold: true,
    },
    {
      key: "soulx4s",
      lane: "soulx",
      id: "soulx-warm-4s",
      seconds: 4,
      mode: "complete",
      cold: false,
    },
    {
      key: "soulx6s",
      lane: "soulx",
      id: "soulx-warm-6s",
      seconds: 6,
      mode: "complete",
      cold: false,
    },
    {
      key: "soulx10s",
      lane: "soulx",
      id: "soulx-warm-10s",
      seconds: 10,
      mode: "complete",
      cold: false,
    },
    {
      key: "soulxCancel",
      lane: "soulx",
      id: "soulx-cancel",
      seconds: 2,
      mode: "cancel",
      cold: false,
    },
    {
      key: "soulxInvalidOutput",
      lane: "soulx",
      id: "soulx-invalid-output",
      seconds: 2,
      mode: "invalid",
      cold: false,
    },
    {
      key: "soulxTimeout",
      lane: "soulx",
      id: "soulx-timeout",
      seconds: 2,
      mode: "timeout",
      cold: false,
    },
  ]);
  assert.equal(
    built.request.input.dualLaneInput.soulx.publicImage,
    "ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:cca75a1593748b43fa0f6cda96108c0fd6d7ba81f26ba1ae211e66cd1b4ab714",
  );
  assert.equal(
    built.request.input.dualLaneInput.soulx.deploymentSha256,
    "sha256:5d5ef1aff182f764146e81f33c8af6fe8e9d48f7bc357aadc355aa5aae78bb6c",
  );
  assert.equal(built.inputManifest.schema_version, INPUT_MANIFEST_SCHEMA);
  assert.deepEqual(Object.keys(built.inputManifest.audio_sources).sort(), ["10", "2", "4", "6"]);
  for (const entry of [
    built.inputManifest.avatar_source,
    ...Object.values(built.inputManifest.audio_sources),
  ]) {
    assert.equal(entry.path.startsWith("/"), true);
    assert.equal(entry.sha256, digest(readFileSync(entry.path)));
    assert.equal(entry.size_bytes, readFileSync(entry.path).length);
  }
});

test("V2-08 builder writes canonical 0600 files under the deterministic private journal", () => {
  const home = mkdtempSync(join(tmpdir(), "v208-request-builder-"));
  try {
    const first = writeSoulXLiveRequestBundle({
      proposalSha256: TEST_PROPOSAL,
      r2AccountId: R2_ACCOUNT_ID,
      r2BucketName: R2_BUCKET_NAME,
      repositoryRoot: ROOT,
      homeDirectory: home,
      compiledProposalSha256: TEST_PROPOSAL,
    });
    assert.equal(first.journalDirectory, join(home, ".videoforge", "v2-08", first.requestId));
    assert.equal(statSync(join(home, ".videoforge")).mode & 0o777, 0o700);
    assert.equal(statSync(join(home, ".videoforge", "v2-08")).mode & 0o777, 0o700);
    assert.equal(statSync(first.journalDirectory).mode & 0o777, 0o700);
    for (const path of [first.requestPath, first.inputManifestPath]) {
      assert.equal(lstatSync(path).mode & 0o777, 0o600);
    }
    assert.equal(readFileSync(first.requestPath, "utf8"), `${canonicalJson(first.request)}\n`);
    assert.equal(
      readFileSync(first.inputManifestPath, "utf8"),
      `${canonicalJson(first.inputManifest)}\n`,
    );
    const second = writeSoulXLiveRequestBundle({
      proposalSha256: TEST_PROPOSAL,
      r2AccountId: R2_ACCOUNT_ID,
      r2BucketName: R2_BUCKET_NAME,
      repositoryRoot: ROOT,
      homeDirectory: home,
      compiledProposalSha256: TEST_PROPOSAL,
    });
    assert.equal(second.requestSha256, first.requestSha256);
    assert.equal(second.inputManifestSha256, first.inputManifestSha256);
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("V2-08 builder rejects arbitrary request IDs/proposals and invalid caller R2 bindings", () => {
  assert.throws(
    () => parseArgs(["--request-id", "v208-anything"]),
    /V208_SOULX_REQUEST_BUILDER_ARGUMENT_UNKNOWN/u,
  );
  assert.throws(
    () =>
      buildSoulXLiveRequest({
        proposalSha256: TEST_PROPOSAL,
        r2AccountId: R2_ACCOUNT_ID,
        r2BucketName: R2_BUCKET_NAME,
        compiledProposalSha256: `sha256:${"b".repeat(64)}`,
      }),
    /V208_SOULX_REQUEST_BUILDER_PROPOSAL_BINDING_INVALID/u,
  );
  assert.throws(
    () =>
      buildSoulXLiveRequest({
        proposalSha256: TEST_PROPOSAL,
        r2AccountId: "not-an-account",
        r2BucketName: R2_BUCKET_NAME,
        compiledProposalSha256: TEST_PROPOSAL,
      }),
    /V208_SOULX_REQUEST_BUILDER_R2_BINDING_INVALID/u,
  );
});

test("proposal binding accepts only the active compiled value and derives its journal ID", () => {
  assert.equal(
    assertProposalBinding(TEST_PROPOSAL, TEST_PROPOSAL),
    `v208-${TEST_PROPOSAL.slice(7)}`,
  );
  assert.throws(
    () => assertProposalBinding(TEST_PROPOSAL, `sha256:${"b".repeat(64)}`),
    /V208_SOULX_REQUEST_BUILDER_PROPOSAL_BINDING_INVALID/u,
  );
});

test("V2-08 input manifest is fail-closed when protected repository inputs are unavailable", () => {
  const missingRoot = mkdtempSync(join(tmpdir(), "v208-request-builder-missing-"));
  try {
    assert.throws(
      () => buildSoulXInputManifest({ repositoryRoot: missingRoot }),
      /V208_SOULX_REQUEST_BUILDER_PROTECTED_avatarSource_READ/u,
    );
  } finally {
    rmSync(missingRoot, { force: true, recursive: true });
  }
});

test("V2-08 builder binds the protected input hashes", () => {
  const manifest = buildSoulXInputManifest({ repositoryRoot: ROOT });
  assert.equal(
    manifest.avatar_source.sha256,
    "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(manifest.audio_sources).map(([seconds, entry]) => [seconds, entry.sha256]),
    ),
    {
      2: "sha256:b7ad261af40caf574e9edadf856f28ccddc306a109d15523c81a427ec38e72d3",
      4: "sha256:076f477f512835a3e606b3312682cf1b4a3eb62e211300843023840969d09019",
      6: "sha256:c7c67903aae4ca8a235792402c64ffa69be3bd423babd4e0447726db27539761",
      10: "sha256:51765f504d1a241af1aa05040cd06bbf377768bc3b2806000191f23855e577cb",
    },
  );
});
