#!/usr/bin/env node

/**
 * Build the private, provider-free V2-08 request bundle.
 *
 * This command only reads repository evidence and protected local inputs.  It does not load
 * credentials, contact RunPod/R2, publish an image, or create a provider resource.  The launcher
 * is the separate process boundary that consumes the two files written here.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const REQUEST_SCHEMA = "videoforge.v2-08-soulx-live-request/v1";
export const INPUT_MANIFEST_SCHEMA = "videoforge.v2-08-soulx-protected-input-manifest/v1";
export const JOURNAL_DIRECTORY_SEGMENTS = Object.freeze([".videoforge", "v2-08"]);

const HASH = /^sha256:[0-9a-f]{64}$/u;
const PROPOSAL = /^sha256:[0-9a-f]{64}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const UID = typeof process.getuid === "function" ? process.getuid() : userInfo().uid;

const ENVELOPE_SCHEMA_PATH =
  "project-context/evidence/serverless_worker_job_envelope_v3.schema.json";
const CASE_SOURCE_PATH = "apps/web/src/server/providers/v213-dual-lane-live.ts";
const MAGE_GENERATOR_PATH = "deploy/v2-13/generate-mage-qualification-case.mjs";
const SOULX_GENERATOR_PATH = "deploy/v2-13/generate-soulx-qualification-cases.mjs";
const MAGE_VALIDATOR_PATH = "workers/image-media/src/videoforge_image_media/mage_production.py";
const SOULX_VALIDATOR_PATH = "workers/avatar-primary/soulx_serverless.py";

const MAGE_CLOSURE_PATH =
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/success-attempt-85.json";
const MAGE_RESULT_PATH =
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/attempt85-live-result.json";
const SOULX_AUTHORITY_PATH =
  "project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/approved-authority.json";
const QUALIFICATION_AUTHORITY_PATH = "apps/web/src/server/providers/v208-soulx-qualification.ts";

const MAGE_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb";
const MAGE_SOURCE_COMMIT = "aceef8e0d0d678468ea9560f1faa94aa562fc466";
const MAGE_CONFIG_SHA256 =
  "sha256:190ee21397eea46a6365763a5813cd9644dd66527a845ff78144c71158b6e364";
const MAGE_VOLUME_ID_SHA256 =
  "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const MAGE_VOLUME_MANIFEST_SHA256 =
  "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b";
const MAGE_CLOSURE_SHA256 =
  "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79";
const MAGE_RESULT_SHA256 =
  "sha256:aa1dc5c2c82d36b32992750fad77d4776c1d92e337f539124670b310201f28f8";

const SOULX_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:177755b6cc6029311beb8a8891434e68433d5706e0456137d50b03c4ca503ab3";
const SOULX_SOURCE_COMMIT = "4f2c5cb3c602ffb48db4a1dc7143477259202896";
const SOULX_CONFIG_SHA256 =
  "sha256:fccc1973fb5af08d954e91561e6b4c467c405d64e2f6bdd521cad8d9af7f415a";
const SOULX_ANONYMOUS_PROOF_SHA256 =
  "sha256:fca3fa204cfb0d2cfd171a3b330ab00b30c5c08caac40d7cb3120da1763b5e7b";
const SOULX_VOLUME_ID_SHA256 =
  "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const SOULX_VOLUME_MANIFEST_SHA256 =
  "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626";

const RUNPOD_ACCOUNT_ID_SHA256 =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";

const CASE_DESCRIPTORS = Object.freeze([
  Object.freeze({
    key: "mage",
    lane: "mage",
    id: "mage-cold-representative",
    seconds: 0,
    mode: "complete",
    cold: true,
  }),
  Object.freeze({
    key: "soulx2s",
    lane: "soulx",
    id: "soulx-cold-2s",
    seconds: 2,
    mode: "complete",
    cold: true,
  }),
  Object.freeze({
    key: "soulx4s",
    lane: "soulx",
    id: "soulx-warm-4s",
    seconds: 4,
    mode: "complete",
    cold: false,
  }),
  Object.freeze({
    key: "soulx6s",
    lane: "soulx",
    id: "soulx-warm-6s",
    seconds: 6,
    mode: "complete",
    cold: false,
  }),
  Object.freeze({
    key: "soulx10s",
    lane: "soulx",
    id: "soulx-warm-10s",
    seconds: 10,
    mode: "complete",
    cold: false,
  }),
  Object.freeze({
    key: "soulxCancel",
    lane: "soulx",
    id: "soulx-cancel",
    seconds: 2,
    mode: "cancel",
    cold: false,
  }),
  Object.freeze({
    key: "soulxInvalidOutput",
    lane: "soulx",
    id: "soulx-invalid-output",
    seconds: 2,
    mode: "invalid",
    cold: false,
  }),
  Object.freeze({
    key: "soulxTimeout",
    lane: "soulx",
    id: "soulx-timeout",
    seconds: 2,
    mode: "timeout",
    cold: false,
  }),
]);

const PROTECTED_INPUTS = Object.freeze([
  Object.freeze({
    name: "avatarSource",
    manifestName: "avatar_source",
    relativePath: ".videoforge/private/vf-9-24u/new-avatar-sample.png",
    contentType: "image/png",
    expectedSha256: "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
    expectedSizeBytes: 1_912_005,
  }),
  Object.freeze({
    name: "soulx2s",
    manifestName: "2",
    relativePath: ".videoforge/private/cp07-inputs/echo-span-2s-padded.wav",
    contentType: "audio/wav",
    expectedSha256: "sha256:b7ad261af40caf574e9edadf856f28ccddc306a109d15523c81a427ec38e72d3",
    expectedSizeBytes: 80_278,
  }),
  Object.freeze({
    name: "soulx4s",
    manifestName: "4",
    relativePath: ".videoforge/private/cp07-inputs/echo-span-4s-padded.wav",
    contentType: "audio/wav",
    expectedSha256: "sha256:076f477f512835a3e606b3312682cf1b4a3eb62e211300843023840969d09019",
    expectedSizeBytes: 160_278,
  }),
  Object.freeze({
    name: "soulx6s",
    manifestName: "6",
    relativePath: ".videoforge/private/cp07-inputs/echo-span-6s-padded.wav",
    contentType: "audio/wav",
    expectedSha256: "sha256:c7c67903aae4ca8a235792402c64ffa69be3bd423babd4e0447726db27539761",
    expectedSizeBytes: 212_118,
  }),
  Object.freeze({
    name: "soulx10s",
    manifestName: "10",
    relativePath: ".videoforge/private/vf-9-24u/new-avatar-third-10.00s.wav",
    contentType: "audio/wav",
    expectedSha256: "sha256:51765f504d1a241af1aa05040cd06bbf377768bc3b2806000191f23855e577cb",
    expectedSizeBytes: 320_278,
  }),
]);

const fail = (code) => {
  throw new Error(`V208_SOULX_REQUEST_BUILDER_${code}`);
};

/** RFC 8785-compatible canonical JSON for the plain values emitted by this builder. */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("NON_FINITE_JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("JSON_VALUE_INVALID");
}

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalJson(value), "utf8"));
const canonicalBytes = (value) => Buffer.from(`${canonicalJson(value)}\n`, "utf8");

function jsonFile(repositoryRoot, relativePath, code) {
  const path = resolve(repositoryRoot, relativePath);
  let bytes;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${code}_FILE`);
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V208_SOULX_REQUEST_BUILDER_"))
      throw error;
    fail(`${code}_READ`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${code}_JSON`);
  }
}

function sourceReference(repositoryRoot, relativePath, code) {
  const path = resolve(repositoryRoot, relativePath);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${code}_FILE`);
    return Object.freeze({ path: relativePath, sha256: sha256(readFileSync(path)) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V208_SOULX_REQUEST_BUILDER_"))
      throw error;
    fail(`${code}_READ`);
  }
}

/**
 * Read the fresh active proposal compiled by the V2-08 authority source.  The old proposal is
 * deliberately not retained here: after consumption, only a fresh source-bound materialization
 * can make this builder usable again.
 */
export function readCompiledProposalSha256({ repositoryRoot = ROOT } = {}) {
  const path = resolve(repositoryRoot, QUALIFICATION_AUTHORITY_PATH);
  let source;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("AUTHORITY_SOURCE_FILE");
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V208_SOULX_REQUEST_BUILDER_"))
      throw error;
    fail("AUTHORITY_SOURCE_READ");
  }
  if (
    !/export const V208_COMPILED_AUTHORITY_ACTIVE(?:\s*:\s*boolean)?\s*=\s*true(?:\s+as const)?\s*;/u.test(
      source,
    )
  )
    fail("FRESH_EXACT_AUTHORITY_REQUIRED");
  const match = source.match(
    /export const V208_PENDING_PROPOSAL_SHA256(?:\s*:\s*string\s*\|\s*null)?\s*=\s*("sha256:[0-9a-f]{64}"|null)(?:\s+as const)?\s*;/u,
  );
  if (match === null || match[1] === "null") fail("FRESH_EXACT_PROPOSAL_REQUIRED");
  const proposalSha256 = JSON.parse(match[1]);
  if (!PROPOSAL.test(proposalSha256)) fail("COMPILED_PROPOSAL_INVALID");
  return proposalSha256;
}

export function assertProposalBinding(proposalSha256, compiledProposalSha256) {
  if (
    !PROPOSAL.test(proposalSha256 ?? "") ||
    !PROPOSAL.test(compiledProposalSha256 ?? "") ||
    proposalSha256 !== compiledProposalSha256
  )
    fail("PROPOSAL_BINDING_INVALID");
  return `v208-${proposalSha256.slice(7)}`;
}

function assertEvidence(repositoryRoot, proposalSha256) {
  const mageClosurePath = resolve(repositoryRoot, MAGE_CLOSURE_PATH);
  const mageResultPath = resolve(repositoryRoot, MAGE_RESULT_PATH);
  const soulxAuthority = jsonFile(repositoryRoot, SOULX_AUTHORITY_PATH, "SOULX_EVIDENCE");
  let mageClosureBytes;
  let mageResultBytes;
  try {
    mageClosureBytes = readFileSync(mageClosurePath);
    mageResultBytes = readFileSync(mageResultPath);
  } catch {
    fail("MAGE_EVIDENCE_READ");
  }
  if (sha256(mageClosureBytes) !== MAGE_CLOSURE_SHA256) fail("MAGE_CLOSURE_DRIFT");
  if (sha256(mageResultBytes) !== MAGE_RESULT_SHA256) fail("MAGE_RESULT_DRIFT");
  let mageResult;
  try {
    mageResult = JSON.parse(mageResultBytes.toString("utf8"));
  } catch {
    fail("MAGE_RESULT_JSON");
  }
  if (
    mageResult?.image_digest !==
      "sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb" ||
    mageResult?.manifest_sha256 !== MAGE_VOLUME_MANIFEST_SHA256 ||
    mageResult?.volume_id_sha256 !== MAGE_VOLUME_ID_SHA256 ||
    mageResult?.runpod_account_id_sha256 !== RUNPOD_ACCOUNT_ID_SHA256 ||
    mageResult?.image_attestation?.source_commit !== MAGE_SOURCE_COMMIT ||
    mageResult?.image_attestation?.manifest_digest !==
      "sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb" ||
    mageResult?.harness?.initialConfigHash !== MAGE_CONFIG_SHA256
  )
    fail("MAGE_BINDING_INVALID");

  const lineage = soulxAuthority?.lineage;
  const publication = soulxAuthority?.image_publication;
  const runpodScope = soulxAuthority?.runpod_scope;
  const billing = soulxAuthority?.billing;
  const retainedVolume = soulxAuthority?.retained_volume;
  if (
    lineage?.proposal_sha256 !== proposalSha256 ||
    lineage?.precursor_source_commit !== SOULX_SOURCE_COMMIT ||
    publication?.immutable_image !== SOULX_IMAGE ||
    publication?.manifest_digest !== SOULX_IMAGE.slice(SOULX_IMAGE.indexOf("@") + 1) ||
    publication?.config_digest !== SOULX_CONFIG_SHA256 ||
    publication?.anonymous_proof_sha256 !== SOULX_ANONYMOUS_PROOF_SHA256 ||
    publication?.anonymous_manifest_http_status !== 200 ||
    publication?.all_descriptors_verified !== true ||
    publication?.runpod_mutation_performed !== false ||
    runpodScope?.account_id_sha256 !== RUNPOD_ACCOUNT_ID_SHA256 ||
    runpodScope?.gpu !== "NVIDIA GeForce RTX 4090" ||
    runpodScope?.region !== "EU-RO-1" ||
    runpodScope?.workers_min !== 0 ||
    runpodScope?.workers_max !== 1 ||
    !Number.isFinite(billing?.baseline_usd) ||
    billing.baseline_usd < 0 ||
    retainedVolume?.volume_id_sha256 !== SOULX_VOLUME_ID_SHA256 ||
    retainedVolume?.manifest_sha256 !== SOULX_VOLUME_MANIFEST_SHA256 ||
    retainedVolume?.size_gb !== 50 ||
    retainedVolume?.region !== "EU-RO-1" ||
    retainedVolume?.mount !== "/runpod-volume" ||
    retainedVolume?.mutation_authorized !== false
  )
    fail("SOULX_BINDING_INVALID");

  return Object.freeze({
    mage: Object.freeze({
      closurePath: MAGE_CLOSURE_PATH,
      closureSha256: MAGE_CLOSURE_SHA256,
      resultPath: MAGE_RESULT_PATH,
      resultSha256: MAGE_RESULT_SHA256,
      configSha256: MAGE_CONFIG_SHA256,
    }),
    soulx: Object.freeze({
      authorityPath: SOULX_AUTHORITY_PATH,
      proposalSha256: lineage.proposal_sha256,
      image: publication.immutable_image,
      configSha256: publication.config_digest,
      anonymousProofSha256: publication.anonymous_proof_sha256,
      billingBaselineUsd: billing.baseline_usd,
    }),
  });
}

function protectedInput(repositoryRoot, definition) {
  const path = resolve(repositoryRoot, definition.relativePath);
  let stat;
  let bytes;
  try {
    stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`PROTECTED_${definition.name}_FILE`);
    if ((stat.mode & 0o777) !== 0o600 || stat.uid !== UID)
      fail(`PROTECTED_${definition.name}_PERMISSIONS`);
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V208_SOULX_REQUEST_BUILDER_"))
      throw error;
    fail(`PROTECTED_${definition.name}_READ`);
  }
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== definition.expectedSha256) fail(`PROTECTED_${definition.name}_HASH`);
  if (bytes.length !== definition.expectedSizeBytes) fail(`PROTECTED_${definition.name}_SIZE`);
  return Object.freeze({
    absolutePath: path,
    relativePath: definition.relativePath,
    contentType: definition.contentType,
    sha256: actualSha256,
    sizeBytes: bytes.length,
  });
}

function assertR2(accountId, bucketName) {
  if (
    typeof accountId !== "string" ||
    typeof bucketName !== "string" ||
    accountId.trim() !== accountId ||
    bucketName.trim() !== bucketName ||
    !ACCOUNT_ID.test(accountId) ||
    !BUCKET_NAME.test(bucketName)
  )
    fail("R2_BINDING_INVALID");
}

function ensurePrivateDirectory(path, code) {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${code}_DIRECTORY`);
    if ((stat.mode & 0o777) !== 0o700 || stat.uid !== UID) fail(`${code}_PERMISSIONS`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (error instanceof Error && error.message.startsWith("V208_SOULX_REQUEST_BUILDER_"))
        throw error;
      fail(`${code}_READ`);
    }
    try {
      mkdirSync(path, { mode: 0o700 });
      chmodSync(path, 0o700);
    } catch {
      fail(`${code}_CREATE`);
    }
  }
  return path;
}

function writePrivateJson(path, value) {
  const bytes = canonicalBytes(value);
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    if (writeSync(descriptor, bytes) !== bytes.length) fail("OUTPUT_WRITE");
    fsyncSync(descriptor);
    chmodSync(path, 0o600);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V208_SOULX_REQUEST_BUILDER_"))
      throw error;
    if (error?.code !== "EEXIST") fail("OUTPUT_WRITE");
    let stat;
    let existing;
    try {
      stat = lstatSync(path);
      existing = readFileSync(path);
    } catch {
      fail("OUTPUT_EXISTING_READ");
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== UID ||
      !existing.equals(bytes)
    )
      fail("OUTPUT_EXISTING_MISMATCH");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return path;
}

function buildSourceRefs(repositoryRoot) {
  const sourceRefs = Object.freeze({
    caseSource: sourceReference(repositoryRoot, CASE_SOURCE_PATH, "CASE_SOURCE"),
    generators: Object.freeze({
      mage: sourceReference(repositoryRoot, MAGE_GENERATOR_PATH, "MAGE_GENERATOR"),
      soulx: sourceReference(repositoryRoot, SOULX_GENERATOR_PATH, "SOULX_GENERATOR"),
    }),
    validators: Object.freeze({
      mage: sourceReference(repositoryRoot, MAGE_VALIDATOR_PATH, "MAGE_VALIDATOR"),
      soulx: sourceReference(repositoryRoot, SOULX_VALIDATOR_PATH, "SOULX_VALIDATOR"),
    }),
  });
  return Object.freeze({ sourceRefs, generatorSha256: canonicalSha256(sourceRefs.generators) });
}

function buildInputs(repositoryRoot) {
  const values = Object.fromEntries(
    PROTECTED_INPUTS.map((definition) => [
      definition.name,
      protectedInput(repositoryRoot, definition),
    ]),
  );
  const descriptors = Object.freeze(
    Object.fromEntries(
      PROTECTED_INPUTS.map((definition) => {
        const value = values[definition.name];
        return [
          definition.name,
          Object.freeze({
            path: definition.relativePath,
            sha256: value.sha256,
            sizeBytes: value.sizeBytes,
            contentType: value.contentType,
          }),
        ];
      }),
    ),
  );
  const manifest = Object.freeze({
    schema_version: INPUT_MANIFEST_SCHEMA,
    avatar_source: Object.freeze({
      content_type: values.avatarSource.contentType,
      path: values.avatarSource.absolutePath,
      sha256: values.avatarSource.sha256,
      size_bytes: values.avatarSource.sizeBytes,
    }),
    audio_sources: Object.freeze(
      Object.fromEntries(
        PROTECTED_INPUTS.filter((definition) => definition.name !== "avatarSource").map(
          (definition) => {
            const value = values[definition.name];
            return [
              definition.manifestName,
              Object.freeze({
                content_type: value.contentType,
                path: value.absolutePath,
                sha256: value.sha256,
                size_bytes: value.sizeBytes,
              }),
            ];
          },
        ),
      ),
    ),
  });
  return Object.freeze({ descriptors, manifest });
}

export function buildSoulXInputManifest({ repositoryRoot = ROOT } = {}) {
  return buildInputs(resolve(repositoryRoot)).manifest;
}

export function buildSoulXLiveRequest({
  proposalSha256,
  r2AccountId,
  r2BucketName,
  repositoryRoot = ROOT,
  homeDirectory = userInfo().homedir,
  // Test-only injection avoids editing authority source in provider-free unit tests. Production
  // callers omit it, so the exact active compiled proposal is always read from source.
  compiledProposalSha256,
} = {}) {
  const root = resolve(repositoryRoot);
  const id = assertProposalBinding(
    proposalSha256,
    compiledProposalSha256 ?? readCompiledProposalSha256({ repositoryRoot: root }),
  );
  assertR2(r2AccountId, r2BucketName);
  const evidence = assertEvidence(root, proposalSha256);
  const { sourceRefs, generatorSha256 } = buildSourceRefs(root);
  const { descriptors, manifest } = buildInputs(root);
  const dualLaneInput = Object.freeze({
    accountIdSha256: RUNPOD_ACCOUNT_ID_SHA256,
    mage: Object.freeze({
      lane: "mage",
      publicImage: MAGE_IMAGE,
      sourceCommit: MAGE_SOURCE_COMMIT,
      deploymentSha256: MAGE_CONFIG_SHA256,
      volumeIdSha256: MAGE_VOLUME_ID_SHA256,
      volumeManifestSha256: MAGE_VOLUME_MANIFEST_SHA256,
    }),
    soulx: Object.freeze({
      lane: "soulx",
      publicImage: SOULX_IMAGE,
      sourceCommit: SOULX_SOURCE_COMMIT,
      // V2-08 has no endpoint deployment yet. This is the immutable anonymous publication proof
      // bound by the approved image evidence and is intentionally not an invented provider ID.
      deploymentSha256: SOULX_ANONYMOUS_PROOF_SHA256,
      volumeIdSha256: SOULX_VOLUME_ID_SHA256,
      volumeManifestSha256: SOULX_VOLUME_MANIFEST_SHA256,
    }),
    billingBaselineUsd: evidence.soulx.billingBaselineUsd,
    totalCapUsd: 17.5,
    mageQualificationCapUsd: 4.5,
    soulxQualificationCapUsd: 1,
    minimumStableReadSpacingMs: 2_000,
    maxStatusReads: 180,
    pollIntervalMs: 2_000,
    qualificationEnvelopeSchemaSha256: sourceReference(
      root,
      ENVELOPE_SCHEMA_PATH,
      "ENVELOPE_SCHEMA",
    ).sha256,
    envelopeSigningKeyId: "v208-qualification-envelope",
    qualificationGeneratorSha256: generatorSha256,
    qualificationCaseDescriptors: CASE_DESCRIPTORS,
    qualificationSourceRefs: sourceRefs,
    qualificationProtectedInputDescriptors: descriptors,
    qualificationR2: Object.freeze({ accountId: r2AccountId, bucketName: r2BucketName }),
  });
  const request = Object.freeze({
    schema_version: REQUEST_SCHEMA,
    command: "soulx-live-qualification",
    request_id: id,
    input: Object.freeze({ dualLaneInput }),
    r2: Object.freeze({ account_id: r2AccountId, bucket_name: r2BucketName }),
  });
  return Object.freeze({
    request,
    inputManifest: manifest,
    requestId: id,
    journalDirectory: join(resolve(homeDirectory), ...JOURNAL_DIRECTORY_SEGMENTS, id),
    evidence,
  });
}

export function writeSoulXLiveRequestBundle({
  proposalSha256,
  r2AccountId,
  r2BucketName,
  repositoryRoot = ROOT,
  homeDirectory = userInfo().homedir,
  compiledProposalSha256,
} = {}) {
  const built = buildSoulXLiveRequest({
    proposalSha256,
    r2AccountId,
    r2BucketName,
    repositoryRoot,
    homeDirectory,
    compiledProposalSha256,
  });
  const home = resolve(homeDirectory);
  const journalDirectory = join(home, ...JOURNAL_DIRECTORY_SEGMENTS, built.requestId);
  ensurePrivateDirectory(join(home, ".videoforge"), "VIDEOFORGE");
  ensurePrivateDirectory(join(home, ".videoforge", "v2-08"), "V208");
  ensurePrivateDirectory(journalDirectory, "JOURNAL");
  const requestPath = writePrivateJson(join(journalDirectory, "request.json"), built.request);
  const inputManifestPath = writePrivateJson(
    join(journalDirectory, "input-manifest.json"),
    built.inputManifest,
  );
  const requestBytes = canonicalBytes(built.request);
  const inputManifestBytes = canonicalBytes(built.inputManifest);
  return Object.freeze({
    ...built,
    journalDirectory,
    requestPath,
    inputManifestPath,
    requestSha256: sha256(requestBytes),
    inputManifestSha256: sha256(inputManifestBytes),
  });
}

export function parseArgs(
  argv = process.argv.slice(2),
  { repositoryRoot = ROOT, compiledProposalSha256 } = {},
) {
  if (!Array.isArray(argv)) fail("ARGUMENTS");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== "string" || !token.startsWith("--") || index + 1 >= argv.length)
      fail("ARGUMENTS");
    const name = token.slice(2);
    if (values.has(name)) fail("ARGUMENT_DUPLICATE");
    values.set(name, argv[index + 1]);
    index += 1;
  }
  const allowed = new Set(["proposal-sha256", "r2-account-id", "r2-bucket-name"]);
  for (const name of values.keys()) if (!allowed.has(name)) fail("ARGUMENT_UNKNOWN");
  for (const name of ["proposal-sha256", "r2-account-id", "r2-bucket-name"])
    if (!values.has(name)) fail("ARGUMENT_REQUIRED");
  assertProposalBinding(
    values.get("proposal-sha256"),
    compiledProposalSha256 ?? readCompiledProposalSha256({ repositoryRoot }),
  );
  assertR2(values.get("r2-account-id"), values.get("r2-bucket-name"));
  return Object.freeze({
    proposalSha256: values.get("proposal-sha256"),
    r2AccountId: values.get("r2-account-id"),
    r2BucketName: values.get("r2-bucket-name"),
  });
}

function isMain() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  try {
    const args = parseArgs();
    const result = writeSoulXLiveRequestBundle(args);
    process.stdout.write(
      `${canonicalJson({
        requestId: result.requestId,
        journalDirectory: result.journalDirectory,
        requestPath: result.requestPath,
        inputManifestPath: result.inputManifestPath,
        requestSha256: result.requestSha256,
        inputManifestSha256: result.inputManifestSha256,
        sourceRefs: result.request.input.dualLaneInput.qualificationSourceRefs,
        protectedInputDescriptors:
          result.request.input.dualLaneInput.qualificationProtectedInputDescriptors,
        mage: result.request.input.dualLaneInput.mage,
        soulx: result.request.input.dualLaneInput.soulx,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
