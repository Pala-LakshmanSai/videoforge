import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
} from "../../../../../deploy/v2-13/validate-full-live-approval.mjs";
import { validateStaticReleaseDescriptorFile } from "../../../../../deploy/v2-13/full-live-orchestration-authority.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const proposalPath = path.join(directory, "combined-live-proposal.json");
const readOnlyPreflightPath = path.join(directory, "read-only-preflight.json");
const sourceReadinessAuditPath = path.join(directory, "source-readiness-audit.json");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const exactKeys = (value, keys, code) => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${code}_OBJECT`);
  assert(JSON.stringify(Object.keys(value)) === JSON.stringify(keys), `${code}_KEYS`);
};
const includes = (values, text, code) =>
  assert(Array.isArray(values) && values.some((value) => value.includes(text)), code);

const bytes = await readFile(proposalPath);
assert(bytes.at(-1) === 0x0a, "PROPOSAL_FINAL_NEWLINE");
const proposal = JSON.parse(bytes);
const readOnlyPreflightBytes = await readFile(readOnlyPreflightPath);
assert(readOnlyPreflightBytes.at(-1) === 0x0a, "READ_ONLY_PREFLIGHT_FINAL_NEWLINE");
const readOnlyPreflight = JSON.parse(readOnlyPreflightBytes);
const sourceReadinessAuditBytes = await readFile(sourceReadinessAuditPath);
assert(sourceReadinessAuditBytes.at(-1) === 0x0a, "SOURCE_READINESS_AUDIT_FINAL_NEWLINE");
assert(
  sha256(sourceReadinessAuditBytes) ===
    "sha256:77680856d795d996cd62a505b59445e42f4ddfdd256ceebcdc22fba231572dea",
  "SOURCE_READINESS_AUDIT_SHA256",
);
const sourceReadinessAudit = JSON.parse(sourceReadinessAuditBytes);
assert(
  sourceReadinessAudit.schema_version ===
    "videoforge.v2-13-full-live-source-readiness-audit/v1" &&
    sourceReadinessAudit.audited_code_commit ===
      "e794b18231b1af6c6fbbd7cd8ba111b4a67f09a8" &&
    sourceReadinessAudit.audit_result === "PASS_READY_TO_RESEAL" &&
    sourceReadinessAudit.source_closure?.entry_count === 643 &&
    sourceReadinessAudit.source_closure?.sha256 ===
      "sha256:289cb00a9cfee45e697ecdf06719cfc79b1b04c41b12c01ca6c5bdf7b4760b85" &&
    sourceReadinessAudit.external_calls === 0 &&
    sourceReadinessAudit.provider_mutations === 0 &&
    sourceReadinessAudit.gpu_use === 0 &&
    sourceReadinessAudit.spend_usd === 0,
  "SOURCE_READINESS_AUDIT_CONTRACT",
);
const expectedProposalPath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json";
const previousProposalSha256 =
  "sha256:776a66de473e48986285639bcbc5e2d87dc331ff9088041e71542e0405e0b5e6";
const previousProposalRecordCommit = "e794b18231b1af6c6fbbd7cd8ba111b4a67f09a8";
const previousReleaseSourceCommit = "9c27eaa56f9b10225fcc239d36c0c552e1c2b26b";
const priorProposalRecordCommit = "618eb031942829467c6c58541293b8515102965f";
const priorReleaseSourceCommit = "7374f0abade0706241cfc1288d0151fc83ee5d9a";
const historicalProposalSha256 =
  "sha256:b579fb054114e82e4b26e3b3bad62d7c5e42b851df64a6fe7576591acd149ff9";
const historicalProposalRecordCommit = "618eb031942829467c6c58541293b8515102965f";
const APPROVED_WRANGLER_OAUTH_SCOPES = Object.freeze([
  "account:read",
  "agent-memory:write",
  "ai-search:run",
  "ai-search:write",
  "ai:write",
  "artifacts:write",
  "browser:write",
  "challenge-widgets.write",
  "cloudchamber:write",
  "connectivity:admin",
  "containers:write",
  "d1:write",
  "email_routing:write",
  "email_sending:write",
  "flagship:write",
  "offline_access",
  "pages:write",
  "pipelines:write",
  "queues:write",
  "secrets_store:write",
  "ssl_certs:write",
  "user:read",
  "websearch.run",
  "workers:write",
  "workers_kv:write",
  "workers_routes:write",
  "workers_scripts:write",
  "workers_tail:read",
  "zone:read",
]);
const EXPECTED_ABSENT_ROUTE_CONTENT_TYPE = "text/html; charset=UTF-8";
const EXPECTED_ABSENT_ROUTE_BODY_LENGTH = 19984;
const EXPECTED_ABSENT_ROUTE_BODY_SHA256 =
  "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976";
const EXPECTED_ABSENT_ROUTE_BODY_SHA256_PREFIX = "2000e6b2";
const EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_SECOND = 0.00031;
const EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR = 1.116;
const EXPECTED_CLOUDFLARE_ACCOUNT_ID = "f9254d773a3426fcb469451b1f965d8c";
const EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 =
  "sha256:dc7e469ff433fab0fab50ce06a41a24e27de8ab78155299f706d82c63fdccbe8";
const EXPECTED_WORKERS_DEV_SUBDOMAIN = "lakshmansai121";
const EXPECTED_WORKERS_DEV_SUBDOMAIN_SHA256 =
  "sha256:960a7fe93a2494d513281414103000bcfa43d3c0945536054d5e5c6524d2c194";
const EXPECTED_PUBLIC_ORIGIN =
  "https://videoforge-production-runtime.lakshmansai121.workers.dev";
const EXPECTED_WRANGLER_CONFIG_PATH =
  "/Users/lakshmansai/Library/Preferences/.wrangler/config/default.toml";
const EXPECTED_WRANGLER_CONFIG_PATH_SHA256 =
  "sha256:1f4cc7dea1b7ea98aaf91bae95b329dfd607a26967ba15f6813e26340f96961c";
const EXPECTED_CREDENTIAL_RECEIPT_SHA256 =
  "sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab";
const EXPECTED_CREDENTIAL_ROTATION_RESULT_SHA256 =
  "sha256:815258fce0b32ecd8afa6ad1dae0399615c26533c7fd1b1d60ecf4657d567ac6";
const EXPECTED_GOOGLE_PROJECT_ID = "adroit-archive-329710";
const EXPECTED_GOOGLE_PROJECT_ID_SHA256 =
  "sha256:0a57c6c9fc4b102fa4eef3ecb490a786cc632bd45440765eed188970c6b097ae";
const EXPECTED_GOOGLE_PROJECT_NUMBER_SHA256 =
  "sha256:41ed11c7873b8727019969683f8063652a949a9a899a3b6b7d126135ea2c6347";
const EXPECTED_GOOGLE_ACCOUNT_SHA256 =
  "sha256:a7bca06b10386403d2757a5c78b397fb5722e0383bcd72cf9f29259e073bfcc7";
const EXPECTED_GOOGLE_CLIENT_ID_SHA256 =
  "sha256:0150569d559bc69055805f48be9d54e9748a1fa34e6dffa6c293701b9814d932";
const EXPECTED_GOOGLE_CLIENT_SECRET_SHA256 =
  "sha256:c4d12264294b3275aebe6b8a51eb5a9f4a5a599c7694f48bcf8ba4422c8c6cfb";
const EXPECTED_GOOGLE_JS_ORIGINS_SHA256 =
  "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const EXPECTED_GOOGLE_REDIRECTS_SHA256 =
  "sha256:fb41ba23e86209bece0299efc81fec50febf2bd8774c1712fd77aa8d8b447c0d";
const EXPECTED_R2_BUCKET_NAME = "videoforge-v2-06-staging-private";
const EXPECTED_R2_BUCKET_NAME_SHA256 =
  "sha256:410831a0659f71ee4959e9ad0778a565b97485442fdc7c4bd8bdd702089bfe1d";
const EXPECTED_R2_ACCESS_KEY_ID_SHA256 =
  "sha256:a322bcb37f84d28ddd0fd841f0eb3ad2feaf368f71c21deece4f9d1f8433e335";
const EXPECTED_R2_SECRET_ACCESS_KEY_SHA256 =
  "sha256:227e83b53468d6053b983a844473e04cbde8eff81c27b499127f106c394a900e";
const EXPECTED_MAGE_VOLUME_ID_SHA256 =
  "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const EXPECTED_SOULX_VOLUME_ID_SHA256 =
  "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const EXPECTED_RELEASE_SOURCE_COMMIT = "3c77fc97b6acb6907b9e9c7a4f4bd26495d02842";
const EXPECTED_APPROVAL_VALIDATOR_SHA256 =
  "sha256:093a9ca77c329e7d6d6205e1927b9c6954f15999e595914c904abe3f94214d56";
const EXPECTED_STATIC_RELEASE_DESCRIPTOR = Object.freeze({
  path: "protected-inputs/v2-13/static-release-descriptor.json",
  sha256: "sha256:1cce7b79722098ce95de2cf79e0705858e948b2ce5c22837e3f37f18cda6a933",
});
const EXPECTED_MATERIALIZATION_SEED_FACTS = Object.freeze({
  commit_field: "source.release_source_commit",
  full_live_authority_id: "5df27ef4-b60b-4a4c-956d-01bd1624e5aa",
  path: "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json",
  sha256: "sha256:82e8167bbd976edaed966e5074dbbbf5b36bbefd99b87e75a03bb0544cd183c5",
});
const EXPECTED_RELEASE_COMPONENT_HASHES = Object.freeze(
  Object.fromEntries(
    Object.entries(EXACT_V3_RELEASE_COMPONENTS)
      .filter(([, component]) => typeof component.sha256 === "string")
      .map(([name, component]) => [name, component.sha256]),
  ),
);
assert(
  readOnlyPreflight.schema_version === "videoforge.v2-13-full-live-read-only-preflight/v1" &&
    readOnlyPreflight.checkpoint === "V2-13" &&
    readOnlyPreflight.task_id === "VF-10-13" &&
    readOnlyPreflight.repository_head_before_reseal ===
      "c7bfeecd5aa1b682c2ff7f8b6cb5a75367abb895" &&
    readOnlyPreflight.previous_independently_audited_release_source_commit ===
      "3f7b588de4b96da7c1e56b6c1908df7381712710" &&
    readOnlyPreflight.authority?.mode ===
      "BOUNDED_READ_ONLY_PREFLIGHT_FROM_CURRENT_USER_REQUEST" &&
    readOnlyPreflight.authority.remote_mutation_authorized === false &&
    readOnlyPreflight.authority.deployment_authorized === false &&
    readOnlyPreflight.authority.gpu_use_authorized === false &&
    readOnlyPreflight.authority.external_spend_authorized_usd === 0,
  "READ_ONLY_PREFLIGHT_AUTHORITY",
);
const readOnlyRunpod = readOnlyPreflight.runpod;
assert(
  HASH.test(readOnlyRunpod.account_id_sha256 ?? "") &&
    readOnlyRunpod.pods === 0 &&
    readOnlyRunpod.endpoints === 0 &&
    readOnlyRunpod.private_templates === 0 &&
    readOnlyRunpod.active_serverless_workers === 0 &&
    readOnlyRunpod.running_compute === 0 &&
    JSON.stringify(readOnlyRunpod.retained_volumes) ===
      JSON.stringify([
        { id_sha256: EXPECTED_SOULX_VOLUME_ID_SHA256, size_gb: 50, region: "EU-RO-1" },
        { id_sha256: EXPECTED_MAGE_VOLUME_ID_SHA256, size_gb: 50, region: "EU-RO-1" },
      ]) &&
    readOnlyRunpod.exact_gpu === "NVIDIA GeForce RTX 4090" &&
    readOnlyRunpod.region === "EU-RO-1" &&
    readOnlyRunpod.availability === "LOW" &&
    readOnlyRunpod.secure_pod_catalog_rate_usd_per_gpu_hour === 0.74 &&
    readOnlyRunpod.secure_pod_rate_is_serverless_flex_rate === false &&
    readOnlyRunpod.serverless_flex_rate_usd_per_second ===
      EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_SECOND &&
    readOnlyRunpod.serverless_flex_rate_usd_per_gpu_hour ===
      EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR &&
    readOnlyRunpod.serverless_rate_source === "https://docs.runpod.io/serverless/pricing" &&
    readOnlyRunpod.serverless_rate_source_kind === "OFFICIAL_PUBLIC_DOCUMENTATION" &&
    readOnlyRunpod.prior_1_10_usd_per_gpu_hour_fence_passes_current_rate === false &&
    readOnlyRunpod.fallback_authorized === false,
  "READ_ONLY_PREFLIGHT_RUNPOD",
);
const readOnlyCloudflare = readOnlyPreflight.cloudflare;
assert(
  readOnlyCloudflare.authentication_mode === "EXISTING_PROTECTED_WRANGLER_OAUTH_ONLY" &&
    readOnlyCloudflare.protected_config_path === EXPECTED_WRANGLER_CONFIG_PATH &&
    readOnlyCloudflare.protected_config_path_sha256 === EXPECTED_WRANGLER_CONFIG_PATH_SHA256 &&
    readOnlyCloudflare.protected_config_mode === "0600" &&
    readOnlyCloudflare.volatile_oauth_token_or_config_bytes_used_as_execution_authority === false &&
    readOnlyCloudflare.account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    readOnlyCloudflare.account_id_sha256 === EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    readOnlyCloudflare.workers_dev_subdomain === EXPECTED_WORKERS_DEV_SUBDOMAIN &&
    readOnlyCloudflare.workers_dev_subdomain_readback_sha256 ===
      EXPECTED_WORKERS_DEV_SUBDOMAIN_SHA256 &&
    readOnlyCloudflare.public_origin === EXPECTED_PUBLIC_ORIGIN &&
    readOnlyCloudflare.worker_inventory_status === 404 &&
    readOnlyCloudflare.production_worker_or_workflow_collision_observed === false &&
    readOnlyCloudflare.existing_bucket === EXPECTED_R2_BUCKET_NAME &&
    readOnlyCloudflare.existing_bucket_readback_status === 200 &&
    readOnlyCloudflare.absent_route_readback?.reads === 3 &&
    readOnlyCloudflare.absent_route_readback.stable === true &&
    readOnlyCloudflare.absent_route_readback.status === 404 &&
    readOnlyCloudflare.absent_route_readback.content_type === EXPECTED_ABSENT_ROUTE_CONTENT_TYPE &&
    readOnlyCloudflare.absent_route_readback.body_length === EXPECTED_ABSENT_ROUTE_BODY_LENGTH &&
    readOnlyCloudflare.absent_route_readback.body_sha256 === EXPECTED_ABSENT_ROUTE_BODY_SHA256 &&
    readOnlyCloudflare.absent_route_readback.prior_17_byte_text_plain_contract_matches === false,
  "READ_ONLY_PREFLIGHT_CLOUDFLARE",
);
assert(
  readOnlyPreflight.credential_receipt?.sha256 === EXPECTED_CREDENTIAL_RECEIPT_SHA256 &&
    readOnlyPreflight.credential_receipt.rotation_result_sha256 ===
      EXPECTED_CREDENTIAL_ROTATION_RESULT_SHA256 &&
    readOnlyPreflight.credential_receipt.secret_free === true &&
    readOnlyPreflight.credential_receipt.authority_consumed_and_non_reusable === true &&
    readOnlyPreflight.credential_receipt.google_project_id === EXPECTED_GOOGLE_PROJECT_ID &&
    readOnlyPreflight.credential_receipt.google_project_id_sha256 === EXPECTED_GOOGLE_PROJECT_ID_SHA256 &&
    readOnlyPreflight.credential_receipt.google_project_number_sha256 ===
      EXPECTED_GOOGLE_PROJECT_NUMBER_SHA256 &&
    readOnlyPreflight.credential_receipt.google_oauth_client_id_sha256 ===
      EXPECTED_GOOGLE_CLIENT_ID_SHA256 &&
    readOnlyPreflight.credential_receipt.google_oauth_client_secret_sha256 ===
      EXPECTED_GOOGLE_CLIENT_SECRET_SHA256 &&
    readOnlyPreflight.credential_receipt.r2_bucket_name_sha256 === EXPECTED_R2_BUCKET_NAME_SHA256 &&
    readOnlyPreflight.credential_receipt.r2_access_key_id_sha256 ===
      EXPECTED_R2_ACCESS_KEY_ID_SHA256 &&
    readOnlyPreflight.credential_receipt.r2_secret_access_key_sha256 ===
      EXPECTED_R2_SECRET_ACCESS_KEY_SHA256 &&
    readOnlyPreflight.credential_receipt.raw_values_in_evidence === false,
  "READ_ONLY_PREFLIGHT_CREDENTIAL_RECEIPT",
);
assert(
  readOnlyPreflight.result?.status ===
      "BLOCKED_REQUIRES_PROVIDER_FREE_SOURCE_REPAIR_AND_RESEAL" &&
    JSON.stringify(readOnlyPreflight.result.blocking_drift) ===
      JSON.stringify([
        "SERVERLESS_FLEX_RATE_1_116_EXCEEDS_PRIOR_1_10_FENCE",
        "ABSENT_PRODUCTION_ROUTE_EXACT_READBACK_DRIFT",
        "ACTIVE_PROPOSAL_PATH_NOT_TRUSTED_BY_CURRENT_ORCHESTRATION_SOURCE",
      ]) &&
    readOnlyPreflight.result.provider_mutations === 0 &&
    readOnlyPreflight.result.temporary_compute_started === false &&
    readOnlyPreflight.result.gpu_hours === 0 &&
    readOnlyPreflight.result.external_spend_usd === 0 &&
    readOnlyPreflight.result.zero_compute_confirmed === true,
  "READ_ONLY_PREFLIGHT_RESULT",
);
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();
const readCommittedBytes = (commit, treePath, code) => {
  try {
    return execFileSync("git", ["show", `${commit}:${treePath}`], {
      cwd: repositoryRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error(code);
  }
};
const readGitText = (args, code) => {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(code);
  }
};
assert(
  readGitText(["rev-parse", `${EXPECTED_RELEASE_SOURCE_COMMIT}^`], "SOURCE_PARENT") ===
    previousProposalRecordCommit &&
    readGitText(["rev-parse", `${previousProposalRecordCommit}^`], "PREVIOUS_RECORD_PARENT") ===
      previousReleaseSourceCommit &&
    readGitText(["rev-parse", `${previousReleaseSourceCommit}^`], "PREVIOUS_SOURCE_PARENT") ===
      priorProposalRecordCommit &&
    readGitText(["rev-parse", `${priorProposalRecordCommit}^`], "PRIOR_RECORD_PARENT") ===
      priorReleaseSourceCommit &&
    readGitText(["rev-parse", `${priorReleaseSourceCommit}^`], "PRIOR_SOURCE_PARENT") ===
      "c1e51ac5155d72383e3475e35c1e4868f0770473" &&
    readGitText(["rev-parse", "c1e51ac5155d72383e3475e35c1e4868f0770473^"], "READINESS_PARENT") ===
      "e44aae0667be7a64fa03b27a3c1b5ed2468c6ad1" &&
    readGitText(["rev-list", "--parents", "-n", "1", EXPECTED_RELEASE_SOURCE_COMMIT], "SOURCE_PARENT_RECORD") ===
      `${EXPECTED_RELEASE_SOURCE_COMMIT} ${previousProposalRecordCommit}` &&
    readGitText(["rev-list", "--parents", "-n", "1", previousProposalRecordCommit], "PREVIOUS_RECORD_PARENT_RECORD") ===
      `${previousProposalRecordCommit} ${previousReleaseSourceCommit}` &&
    readGitText(["rev-list", "--parents", "-n", "1", previousReleaseSourceCommit], "PREVIOUS_SOURCE_PARENT_RECORD") ===
      `${previousReleaseSourceCommit} ${priorProposalRecordCommit}` &&
    readGitText(["rev-list", "--parents", "-n", "1", priorProposalRecordCommit], "PRIOR_RECORD_PARENT_RECORD") ===
      `${priorProposalRecordCommit} ${priorReleaseSourceCommit}` &&
    readGitText(["rev-list", "--parents", "-n", "1", priorReleaseSourceCommit], "PRIOR_SOURCE_PARENT_RECORD") ===
      `${priorReleaseSourceCommit} c1e51ac5155d72383e3475e35c1e4868f0770473` &&
    readGitText(["rev-list", "--parents", "-n", "1", "c1e51ac5155d72383e3475e35c1e4868f0770473"], "READINESS_PARENT_RECORD") ===
      "c1e51ac5155d72383e3475e35c1e4868f0770473 e44aae0667be7a64fa03b27a3c1b5ed2468c6ad1",
  "EXACT_FIRST_PARENT_SUCCESSOR_CHAIN",
);
assert(
  sha256(
    readCommittedBytes(
      EXPECTED_RELEASE_SOURCE_COMMIT,
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/source-readiness-audit.json",
      "SOURCE_READINESS_AUDIT_SOURCE_MISSING",
    ),
  ) === "sha256:77680856d795d996cd62a505b59445e42f4ddfdd256ceebcdc22fba231572dea",
  "SOURCE_READINESS_AUDIT_SOURCE_SHA256",
);
const materializationSeedFactsBytes = readCommittedBytes(
  EXPECTED_RELEASE_SOURCE_COMMIT,
  EXPECTED_MATERIALIZATION_SEED_FACTS.path,
  "MATERIALIZATION_SEED_FACTS_SOURCE_MISSING",
);
assert(
  sha256(materializationSeedFactsBytes) === EXPECTED_MATERIALIZATION_SEED_FACTS.sha256,
  "MATERIALIZATION_SEED_FACTS_SOURCE_SHA256",
);
const materializationSeedFacts = JSON.parse(materializationSeedFactsBytes);
assert(
  materializationSeedFacts.schema_version ===
      "videoforge.v213-materialization-seed-facts/v1" &&
    materializationSeedFacts.full_live_authority_id ===
      EXPECTED_MATERIALIZATION_SEED_FACTS.full_live_authority_id &&
    materializationSeedFacts.source_evidence?.source_readiness?.path ===
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/source-readiness-audit.json" &&
    materializationSeedFacts.source_evidence.source_readiness.sha256 ===
      "sha256:77680856d795d996cd62a505b59445e42f4ddfdd256ceebcdc22fba231572dea" &&
    materializationSeedFacts.protected_input?.path ===
      "protected-inputs/v2-13/materialization-seed-input.json" &&
    materializationSeedFacts.protected_input.schema_version ===
      "videoforge.v213-materialization-seed-protected-input/v1" &&
    materializationSeedFacts.protected_input.sha256 ===
      "sha256:1eb45cb3080e70b6c1d9626a6e0870a2cefc8b62e63bd9236502d7ddd54793da",
  "MATERIALIZATION_SEED_FACTS_CONTRACT",
);
validateStaticReleaseDescriptorFile({
  path: path.join(repositoryRoot, EXPECTED_STATIC_RELEASE_DESCRIPTOR.path),
  expectedSha256: EXPECTED_STATIC_RELEASE_DESCRIPTOR.sha256,
  expectedSourceCommit: EXPECTED_RELEASE_SOURCE_COMMIT,
});
const operations = [...EXACT_OPERATION_IDS];
const componentPaths = Object.fromEntries(
  Object.entries(EXACT_V3_RELEASE_COMPONENTS).map(([name, component]) => [name, component.path]),
);

exactKeys(
  proposal,
  [
    "schema_version",
    "checkpoint_range",
    "task_id",
    "candidate_date",
    "proposal_status",
    "sealing",
    "supersession",
    "source",
    "authority_record_commit_binding",
    "authority",
    "exact_execution_graph",
    "immutable_github_release_ref_request",
    "requested_scope",
    "ordered_operations",
    "stop_conditions",
    "approval_request",
  ],
  "ROOT",
);
exactKeys(
  proposal.sealing,
  [
    "sealed_for_exact_user_approval",
    "current_bytes_are_approval_ineligible",
    "required_next_action",
    "static_release_descriptor",
    "materialization_seed_facts",
  ],
  "SEALING",
);
exactKeys(
  proposal.source,
  [
    "release_source_commit",
    "repaired_release_source_commit",
    "proposal_record_commit",
    "future_approval_record_commit",
    "future_authority_record_commit",
    "branch",
    "branch_push_target",
    "proposal_path",
    "future_approval_record_basename",
    "future_authority_record_basename",
    "exact_release_components",
    "pending_source_contract",
  ],
  "SOURCE",
);
exactKeys(
  proposal.authority_record_commit_binding,
  [
    "strategy",
    "proposal_record_commit_is_distinct",
    "authority_record_commit_must_contain_exact_approval_and_authority_bytes",
    "remote_readback_required",
    "embedded_self_commit_hash_forbidden",
    "materialization_seed_sha256_required_in_authority_and_consumption_state",
    "materialization_seed_sha256_must_be_verified_before_execution",
  ],
  "AUTHORITY_RECORD_COMMIT_BINDING",
);
exactKeys(
  proposal.authority,
  [
    "exact_proposal_approved",
    "authority_id",
    "approval_sha256",
    "approved_at",
    "expires_at",
    "single_use",
    "consumed",
    "execute_authorized",
    "credential_access_authorized",
    "database_mutation_authorized",
    "cloudflare_secret_mutation_authorized",
    "deployment_authorized",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "gpu_use_authorized",
    "external_spend_authorized",
    "executable_finite_cap_usd",
    "immutable_release_ref_creation_authorized",
    "materialization_seed_sha256",
    "redispatch_authorized",
  ],
  "AUTHORITY",
);
exactKeys(
  proposal.exact_execution_graph,
  [
    "preflight_before_first_external_action",
    "image_workflow_verification_policy",
    "internal_materialization_policy",
    "prequalification_database_bootstrap_policy",
    "workflow_start_authority_policy",
    "early_no_database_cleanup_policy",
    "crash_safe_cleanup_policy",
    "durable_billing_policy",
    "prequalification_bridge_policy",
    "cloudflare_credential_origin_policy",
    "credential_scope_policy",
    "trusted_time_policy",
    "ordered_operation_ids",
    "operation_order_is_closed_and_non_reorderable",
    "missing_extra_or_repeated_operation_is_a_hard_stop",
    "bootstrap_partial_cleanup_policy",
  ],
  "EXACT_EXECUTION_GRAPH",
);
exactKeys(
  proposal.immutable_github_release_ref_request,
  [
    "creation_requested",
    "exact_ref",
    "exact_tag_name",
    "exact_target_commit",
    "tag_kind",
    "maximum_new_refs",
    "force_update_authorized",
    "delete_or_retarget_authorized",
    "other_ref_creation_authorized",
    "remote",
    "required_preconditions",
    "exact_mutation",
    "required_readback",
    "stop_on_presence_collision_or_drift",
  ],
  "IMMUTABLE_GITHUB_RELEASE_REF_REQUEST",
);
exactKeys(
  proposal.requested_scope,
  [
    "maximum_cumulative_finite_runpod_spend_usd",
    "phase_caps_usd",
    "phase_caps_sum_to_cumulative_cap",
    "gpu",
    "retention",
    "read_only_preflight_binding",
    "credential_receipt_binding",
    "cloudflare_credential_scope",
    "google_oauth_web_client_scope",
    "r2_s3_credential_scope",
    "database",
    "cloudflare_creation_allowlist",
    "cloudflare_secret_allowlist_count",
    "cloudflare_secret_allowlist",
    "runpod_creation_allowlist_after_both_fresh_qualifications",
    "new_r2_buckets",
    "new_volumes",
    "new_paid_retained_resources",
    "other_new_git_refs",
    "other_resource_creation_authorized",
    "plan_change_authorized",
    "static_release_descriptor",
    "materialization_seed_facts",
  ],
  "REQUESTED_SCOPE",
);
exactKeys(
  proposal.approval_request,
  [
    "requested_exact_action",
    "requested_maximum_cumulative_finite_runpod_spend_usd",
    "requested_exact_phase_caps_usd",
    "requested_gpu",
    "requested_separate_retention_consent",
    "requested_exact_git_ref_mutation",
    "requested_exact_database_roles",
    "requested_cloudflare_authentication",
    "requested_google_oauth_scope",
    "requested_r2_s3_scope",
    "requested_google_project_id",
    "requested_google_client_id_sha256",
    "requested_r2_account_id",
    "requested_r2_bucket_name",
    "requested_credential_identities_and_hashes_must_be_finalized_before_reseal",
    "authority_becomes_executable_only_after_exact_hash_and_commit_approval_is_recorded",
    "requested_internal_production_credentials",
  ],
  "APPROVAL_REQUEST",
);
for (const phase of proposal.ordered_operations)
  exactKeys(phase, ["order", "phase", "operations"], "ORDERED_OPERATION_PHASE");
assert(proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v3", "SCHEMA");
assert(
  JSON.stringify(proposal.checkpoint_range) ===
    JSON.stringify(["V2-07", "V2-08", "V2-09", "V2-10", "V2-11", "V2-12", "V2-13"]),
  "CHECKPOINT_RANGE",
);
assert(proposal.task_id === "VF-10-13" && proposal.candidate_date === "2026-08-28", "IDENTITY");
assert(
  proposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL",
  "STATUS_PENDING_FRESH_EXACT_USER_APPROVAL",
);
assert(
  proposal.sealing.sealed_for_exact_user_approval === true &&
    proposal.sealing.current_bytes_are_approval_ineligible === false &&
    proposal.sealing.required_next_action.includes("obtain fresh exact user approval") &&
    proposal.sealing.required_next_action.includes("fresh exact user approval"),
  "SEALING_GATE",
);

exactKeys(
  proposal.supersession,
  [
    "supersedes_proposal_sha256",
    "supersedes_proposal_record_commit",
    "superseded_exact_user_approval_received_in_current_task",
    "superseded_approval_record_materialized",
    "superseded_approval_record_path",
    "superseded_approval_record_sha256",
    "superseded_authority_materialized",
    "superseded_authority_id",
    "superseded_authority_record_path",
    "superseded_authority_record_sha256",
    "supersession_reason",
    "superseded_authority_state",
    "prior_approval_reusable",
    "fresh_exact_approval_required",
  ],
  "SUPERSESSION",
);
assert(
  proposal.supersession.supersedes_proposal_sha256 === previousProposalSha256 &&
    proposal.supersession.supersedes_proposal_record_commit === previousProposalRecordCommit &&
    proposal.supersession.superseded_exact_user_approval_received_in_current_task === true &&
    proposal.supersession.superseded_approval_record_materialized === false &&
    proposal.supersession.superseded_approval_record_path === null &&
    proposal.supersession.superseded_approval_record_sha256 === null &&
    proposal.supersession.superseded_authority_materialized === false &&
    proposal.supersession.superseded_authority_id === null &&
    proposal.supersession.superseded_authority_record_path === null &&
    proposal.supersession.superseded_authority_record_sha256 === null &&
    proposal.supersession.supersession_reason ===
      "MATERIALIZATION_SEED_ENVELOPE_KEY_ID_AUTHORITY_BINDING" &&
    proposal.supersession.superseded_authority_state ===
      "ABSENT_NOT_MATERIALIZED_NO_MUTATION" &&
    proposal.supersession.prior_approval_reusable === false &&
    proposal.supersession.fresh_exact_approval_required === true,
  "SUPERSESSION_PRIOR_PROPOSAL_BINDING",
);

const supersededProposalBytes = readCommittedBytes(
  previousProposalRecordCommit,
  expectedProposalPath,
  "SUPERSESSION_PROPOSAL_RECORD_MISSING",
);
assert(sha256(supersededProposalBytes) === previousProposalSha256, "SUPERSESSION_PROPOSAL_HASH");
let supersededProposal;
try {
  supersededProposal = JSON.parse(supersededProposalBytes);
} catch {
  throw new Error("SUPERSESSION_PROPOSAL_JSON");
}
assert(
  supersededProposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL" &&
    supersededProposal.source?.release_source_commit === previousReleaseSourceCommit &&
    supersededProposal.source?.repaired_release_source_commit === previousReleaseSourceCommit &&
    supersededProposal.supersession?.supersedes_proposal_sha256 === historicalProposalSha256 &&
    supersededProposal.supersession?.supersedes_proposal_record_commit ===
      historicalProposalRecordCommit,
  "SUPERSESSION_PROPOSAL_BINDING",
);

assert(
  proposal.source.release_source_commit === EXPECTED_RELEASE_SOURCE_COMMIT &&
    proposal.source.repaired_release_source_commit === EXPECTED_RELEASE_SOURCE_COMMIT &&
    proposal.source.proposal_record_commit === null &&
    proposal.source.future_approval_record_commit === null &&
    proposal.source.future_authority_record_commit === null &&
    proposal.source.branch === "codex/serverless-v2-roadmap-v4" &&
    proposal.source.branch_push_target === "origin/codex/serverless-v2-roadmap-v4" &&
    proposal.source.proposal_path === expectedProposalPath,
  "SOURCE_BINDING_PENDING",
);
assert(
  JSON.stringify(proposal.source.exact_release_components.approval_validator) ===
    JSON.stringify({
      path: "deploy/v2-13/validate-full-live-approval.mjs",
      source_commit_tree_binding: {
        mode: "EXTERNAL_GIT_COMMIT_TREE_ENTRY",
        commit_field: "source.release_source_commit",
        tree_entry_path: "deploy/v2-13/validate-full-live-approval.mjs",
        verification: "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256",
        embedded_current_file_sha256: false,
        self_hash_forbidden: true,
      },
    }),
  "VALIDATOR_TREE_BINDING",
);
assert(
  JSON.stringify(proposal.source.exact_release_components) ===
    JSON.stringify(EXACT_V3_RELEASE_COMPONENTS),
  "EXACT_RELEASE_COMPONENTS",
);
assert(
  sha256(
    readCommittedBytes(
      EXPECTED_RELEASE_SOURCE_COMMIT,
      EXACT_V3_RELEASE_COMPONENTS.approval_validator.path,
      "APPROVAL_VALIDATOR_SOURCE_MISSING",
    ),
  ) === EXPECTED_APPROVAL_VALIDATOR_SHA256,
  "APPROVAL_VALIDATOR_TREE_SHA256",
);
for (const [name, expectedPath] of Object.entries(componentPaths)) {
  assert(proposal.source.exact_release_components[name]?.path === expectedPath, `COMPONENT_PATH:${name}`);
  if (name === "approval_validator") continue;
  assert(
    proposal.source.exact_release_components[name]?.sha256 === EXPECTED_RELEASE_COMPONENT_HASHES[name],
    `COMPONENT_HASH:${name}`,
  );
  const sourceBytes = readCommittedBytes(
    EXPECTED_RELEASE_SOURCE_COMMIT,
    expectedPath,
    `COMPONENT_SOURCE_MISSING:${name}`,
  );
  assert(
    sha256(sourceBytes) === EXPECTED_RELEASE_COMPONENT_HASHES[name],
    `COMPONENT_SOURCE_HASH:${name}`,
  );
}

assert(
  proposal.authority_record_commit_binding.strategy ===
    "EXTERNAL_GIT_COMMIT_INPUT_VERIFIED_BEFORE_CONSUMPTION_NO_SELF_HASH" &&
    proposal.authority_record_commit_binding.proposal_record_commit_is_distinct === true &&
    proposal.authority_record_commit_binding
      .authority_record_commit_must_contain_exact_approval_and_authority_bytes === true &&
    proposal.authority_record_commit_binding.remote_readback_required === true &&
    proposal.authority_record_commit_binding.embedded_self_commit_hash_forbidden === true &&
    proposal.authority_record_commit_binding
      .materialization_seed_sha256_required_in_authority_and_consumption_state === true &&
    proposal.authority_record_commit_binding.materialization_seed_sha256_must_be_verified_before_execution ===
      true,
  "AUTHORITY_COMMIT_BINDING",
);
assert(
  proposal.authority.single_use === true &&
    proposal.authority.materialization_seed_sha256 === null &&
    Object.entries(proposal.authority).every(([key, value]) =>
      key === "single_use" ? value === true : value === false || value === null,
    ),
  "AUTHORITY_ABSENT",
);
const materialization = proposal.exact_execution_graph.internal_materialization_policy;
const exactGraphPolicies = {
  image_workflow_verification_policy: EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  internal_materialization_policy: EXACT_INTERNAL_MATERIALIZATION_POLICY,
  trusted_time_policy: EXACT_TRUSTED_TIME_POLICY,
  prequalification_database_bootstrap_policy: EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  workflow_start_authority_policy: EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  early_no_database_cleanup_policy: EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  bootstrap_partial_cleanup_policy: EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  crash_safe_cleanup_policy: EXACT_CRASH_SAFE_CLEANUP_POLICY,
  durable_billing_policy: EXACT_DURABLE_BILLING_POLICY,
  prequalification_bridge_policy: EXACT_PREQUALIFICATION_BRIDGE_POLICY,
};
assert(
  materialization.materialization_seed_sha256_field === "materialization_seed_sha256" &&
    materialization.materialization_seed_sha256_must_be_bound_in_outer_authority === true &&
    materialization.materialization_seed_sha256_must_be_bound_in_consumption_record === true &&
    materialization.materialization_seed_sha256_verified_at_outer_consumption === true &&
    materialization.materialization_seed_sha256_verified_before_every_seed_read === true &&
    materialization.materialization_seed_sha256_verified_after_restart_or_recovery === true &&
    materialization.protected_seed_future_output_hashes_authorized === false,
  "MATERIALIZATION_SEED_OUTER_BINDING",
);

const bootstrapPolicy = proposal.exact_execution_graph.prequalification_database_bootstrap_policy;
assert(
  bootstrapPolicy.exact_one_time_database_role_credential_count === 3 &&
    bootstrapPolicy.exact_one_time_internal_production_credential_count === 10 &&
    bootstrapPolicy.exact_operator_function_signature_count === 42,
  "PREQUALIFICATION_RECEIPT_POLICY",
);
const receiptVerifier = bootstrapPolicy.post_bootstrap_receipt_verifier;
assert(
  JSON.stringify(receiptVerifier) ===
    JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.post_bootstrap_receipt_verifier),
  "PREQUALIFICATION_RECEIPT_VERIFIER",
);

const exactCaps = {
  mage_qualification: 4.5,
  soulx_qualification: 1,
  v2_09_short_hosted_project: 2,
  v2_10_operator_free_ranga_pilot: 2,
  v2_11_two_concurrent_owned_projects: 4,
  v2_12_long_output: 2,
  v2_13_final_two_lane_smoke: 2,
};
const scope = proposal.requested_scope;
assert(
  JSON.stringify(scope.static_release_descriptor) ===
      JSON.stringify(EXPECTED_STATIC_RELEASE_DESCRIPTOR) &&
    JSON.stringify(proposal.sealing.static_release_descriptor) ===
      JSON.stringify(EXPECTED_STATIC_RELEASE_DESCRIPTOR) &&
    JSON.stringify(scope.materialization_seed_facts) ===
      JSON.stringify(EXPECTED_MATERIALIZATION_SEED_FACTS) &&
    JSON.stringify(proposal.sealing.materialization_seed_facts) ===
      JSON.stringify(EXPECTED_MATERIALIZATION_SEED_FACTS),
  "STATIC_RELEASE_DESCRIPTOR_BINDING",
);
assert(
  scope.database.prequalification_database_bootstrap_operator_function_signature_count === 42 &&
    scope.database.prequalification_database_bootstrap_operator_function_signature_count ===
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_count &&
    JSON.stringify(scope.database.exact_operator_function_signatures) ===
      JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures) &&
    scope.database.prequalification_database_bootstrap_exact_one_time_database_role_credential_count ===
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_count &&
    scope.database.prequalification_database_bootstrap_exact_one_time_database_role_credential_scope ===
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_scope &&
    scope.database.prequalification_database_bootstrap_exact_one_time_internal_production_credential_count ===
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count &&
    JSON.stringify(
      scope.database.prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope,
    ) ===
      JSON.stringify(
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
      ),
  "EXACT_OPERATOR_FUNCTIONS_42",
);
assert(
  scope.cloudflare_secret_allowlist_count === EXACT_CLOUDFLARE_SECRET_NAMES.length &&
    JSON.stringify(scope.cloudflare_secret_allowlist) ===
      JSON.stringify(EXACT_CLOUDFLARE_SECRET_NAMES),
  "EXACT_CLOUDFLARE_SECRET_ALLOWLIST",
);
assert(scope.maximum_cumulative_finite_runpod_spend_usd === 17.5, "TOTAL_CAP");
assert(JSON.stringify(scope.phase_caps_usd) === JSON.stringify(exactCaps), "PHASE_CAPS");
assert(
  Object.values(scope.phase_caps_usd).reduce((sum, value) => sum + value, 0) === 17.5 &&
    scope.phase_caps_sum_to_cumulative_cap === true,
  "PHASE_CAP_SUM",
);
assert(
    scope.gpu.exact_offering === "NVIDIA GeForce RTX 4090" &&
    scope.gpu.region === "EU-RO-1" &&
    scope.gpu.minimum_availability_at_each_mutation_boundary === "LOW-or-better" &&
    scope.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour === 1.116 &&
    scope.gpu.serverless_flex_rate_usd_per_second === 0.00031 &&
    scope.gpu.serverless_flex_rate_source === "https://docs.runpod.io/serverless/pricing" &&
    scope.gpu.serverless_flex_rate_source_kind === "OFFICIAL_PUBLIC_DOCUMENTATION" &&
    scope.gpu.serverless_flex_rate_reject_above_usd_per_gpu_hour === 1.116 &&
    scope.gpu.secure_pod_catalog_rate_usd_per_gpu_hour === 0.74 &&
    scope.gpu.secure_pod_rate_is_serverless_flex_rate === false &&
    scope.gpu.fallback_allowed === false,
  "GPU_SCOPE",
);
assert(
  scope.retention.retain_only_the_same_two_exact_volumes === true &&
    scope.retention.volume_count === 2 &&
    scope.retention.size_gb_each === 50 &&
    scope.retention.region === "EU-RO-1" &&
    scope.retention.mage_volume_id_sha256 === EXPECTED_MAGE_VOLUME_ID_SHA256 &&
    scope.retention.soulx_volume_id_sha256 === EXPECTED_SOULX_VOLUME_ID_SHA256 &&
    scope.retention.combined_recurring_usd_per_month === 7 &&
    scope.retention.recurring_charge_separate_from_finite_cap === true &&
    scope.retention.new_volume_or_paid_retained_resource_authorized === false &&
    scope.retention.resize_move_replace_or_add_authorized === false &&
    scope.retention.recurring_plan_change_authorized === false,
  "RETENTION_SCOPE",
);
const proposalPreflight = scope.read_only_preflight_binding;
assert(
  proposalPreflight.authority_mode === "BOUNDED_READ_ONLY_PREFLIGHT" &&
    proposalPreflight.remote_mutation_authorized === false &&
    proposalPreflight.deployment_authorized === false &&
    proposalPreflight.gpu_use_authorized === false &&
    proposalPreflight.external_spend_authorized_usd === 0 &&
    proposalPreflight.runpod_account_id_sha256 === readOnlyRunpod.account_id_sha256 &&
    proposalPreflight.pods === 0 &&
    proposalPreflight.endpoints === 0 &&
    proposalPreflight.private_templates === 0 &&
    proposalPreflight.active_serverless_workers === 0 &&
    proposalPreflight.running_compute === 0 &&
    JSON.stringify(proposalPreflight.retained_volumes) ===
      JSON.stringify(readOnlyRunpod.retained_volumes) &&
    proposalPreflight.exact_gpu === readOnlyRunpod.exact_gpu &&
    proposalPreflight.region === readOnlyRunpod.region &&
    proposalPreflight.availability === readOnlyRunpod.availability &&
    proposalPreflight.secure_pod_catalog_rate_usd_per_gpu_hour ===
      readOnlyRunpod.secure_pod_catalog_rate_usd_per_gpu_hour &&
    proposalPreflight.secure_pod_rate_is_serverless_flex_rate === false &&
    proposalPreflight.serverless_flex_rate_usd_per_second ===
      EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_SECOND &&
    proposalPreflight.serverless_flex_rate_usd_per_gpu_hour ===
      EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR &&
    proposalPreflight.serverless_rate_source === readOnlyRunpod.serverless_rate_source &&
    proposalPreflight.fallback_authorized === false &&
    proposalPreflight.zero_compute_confirmed === true,
  "READ_ONLY_PREFLIGHT_PROPOSAL_BINDING",
);

const cloudflareCredentials = scope.cloudflare_credential_scope;
assert(
  cloudflareCredentials.authentication_mode === "EXISTING_WRANGLER_OAUTH_CONFIG_ONLY" &&
    cloudflareCredentials.protected_binding_environment_name ===
      "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE" &&
    cloudflareCredentials.protected_config_mode === "0600" &&
    JSON.stringify(cloudflareCredentials.oauth_scopes) ===
      JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES) &&
    cloudflareCredentials.protected_config_path === EXPECTED_WRANGLER_CONFIG_PATH &&
    cloudflareCredentials.protected_config_path_sha256 ===
      EXPECTED_WRANGLER_CONFIG_PATH_SHA256 &&
    cloudflareCredentials.protected_config_sha256 === null &&
    cloudflareCredentials.authenticated_account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    cloudflareCredentials.authenticated_account_id_sha256 ===
      EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    cloudflareCredentials.volatile_oauth_token_or_config_bytes_used_as_execution_authority ===
      false &&
    cloudflareCredentials.raw_api_token_file_authorized === false &&
    cloudflareCredentials.cloudflare_api_token_environment_export_authorized === false &&
    cloudflareCredentials.new_cloudflare_api_token_authorized === false &&
    cloudflareCredentials.new_oauth_credential_authorized === false &&
    cloudflareCredentials.credential_rotation_authorized === false &&
    cloudflareCredentials.oauth_account_readback_required === true &&
    cloudflareCredentials.oauth_config_readback_required_before_any_cloudflare_mutation === true &&
    cloudflareCredentials.wrangler_oauth_scope_must_be_exact_and_source_bound === true &&
    cloudflareCredentials.no_token_values_or_hashes_in_proposal_or_seed === true,
  "CLOUDFLARE_OAUTH_SCOPE",
);

const google = scope.google_oauth_web_client_scope;
assert(
  google.authorized_client_count === 1 &&
    google.operation === "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_GOOGLE_OAUTH_WEB_CLIENT" &&
    google.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    google.separate_future_credential_bootstrap_approval_required === false &&
    google.creation_or_rotation_authorized === false &&
    google.client_type === "WEB" &&
    google.project_access_mode === "USER_ACCESSIBLE_EXISTING_PROJECT_ONLY" &&
    google.accessible_project_count_observed === 1 &&
    google.project_id === EXPECTED_GOOGLE_PROJECT_ID &&
    google.project_id_sha256 === EXPECTED_GOOGLE_PROJECT_ID_SHA256 &&
    google.project_number_sha256 === EXPECTED_GOOGLE_PROJECT_NUMBER_SHA256 &&
    google.authenticated_account_sha256 === EXPECTED_GOOGLE_ACCOUNT_SHA256 &&
    google.project_access_readback_required === true &&
    google.required_project_permission === "resourcemanager.projects.get" &&
    google.known_inaccessible_project_id === "videoforge-v2-06-staging-0817" &&
    google.inaccessible_project_reuse_authorized === false &&
    google.new_google_project_creation_authorized === false &&
    google.new_google_project_authority_required_if_count_is_zero === false &&
    google.google_project_access_grant_authorized === false &&
    google.if_no_user_accessible_project ===
      "HARD_STOP_AND_RESEAL_WITH_EXPLICIT_NEW_PROJECT_AUTHORITY" &&
    google.client_id_sha256 === EXPECTED_GOOGLE_CLIENT_ID_SHA256 &&
    google.client_secret_sha256 === EXPECTED_GOOGLE_CLIENT_SECRET_SHA256 &&
    google.javascript_origins_canonical_sha256 === EXPECTED_GOOGLE_JS_ORIGINS_SHA256 &&
    google.redirect_uris_canonical_sha256 === EXPECTED_GOOGLE_REDIRECTS_SHA256 &&
    google.authorized_redirect_uri_count === 1 &&
    google.authorized_redirect_uri_template === "{final_production_origin}/api/auth/callback/google" &&
    google.callback_must_bind_only_final_production_origin === true &&
    google.staging_local_preview_or_other_callback_uris_authorized === false &&
    JSON.stringify(google.authorized_javascript_origins) === "[]" &&
    google.other_google_oauth_client_creation_or_rotation_authorized === false &&
    google.old_client_disable_or_delete_authorized_before_new_readback === false &&
    google.identity_and_hashes_pending_credential_scope_audit === false &&
    google.protected_value_must_exist_before_reseal === true,
  "GOOGLE_OAUTH_SCOPE",
);

const r2 = scope.r2_s3_credential_scope;
assert(
  r2.authorized_credential_count === 1 &&
    r2.operation === "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_LEAST_PRIVILEGE_R2_S3_CREDENTIAL" &&
    r2.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    r2.separate_future_credential_bootstrap_approval_required === false &&
    r2.creation_or_rotation_authorized === false &&
    r2.account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    r2.account_id_sha256 === EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    r2.authenticated_account_readback_required === true &&
    r2.existing_bucket_only === true &&
    r2.bucket_name === EXPECTED_R2_BUCKET_NAME &&
    r2.bucket_name_sha256 === EXPECTED_R2_BUCKET_NAME_SHA256 &&
    r2.access_key_id_sha256 === EXPECTED_R2_ACCESS_KEY_ID_SHA256 &&
    r2.secret_access_key_sha256 === EXPECTED_R2_SECRET_ACCESS_KEY_SHA256 &&
    r2.bucket_existence_readback_required === true &&
    JSON.stringify(r2.allowed_actions_upper_bound) ===
      JSON.stringify(["ListBucket", "GetObject", "PutObject", "DeleteObject"]) &&
    r2.allowed_scope === "EXACT_AUTHENTICATED_ACCOUNT_AND_EXISTING_BUCKET_ONLY" &&
    r2.object_prefix === null &&
    r2.account_wide_or_wildcard_permissions_authorized === false &&
    r2.bucket_create_delete_or_replace_authorized === false &&
    r2.new_r2_bucket_authorized === false &&
    r2.other_r2_credential_creation_or_rotation_authorized === false &&
    r2.secret_values_or_hashes_in_proposal_or_seed === false &&
    r2.action_set_and_prefix_pending_credential_scope_audit === false &&
    r2.protected_value_must_exist_before_reseal === true,
  "R2_S3_SCOPE",
);

const pending = proposal.source.pending_source_contract;
assert(pending.status === "SOURCE_BOUND_AUDITED", "SOURCE_BOUND_CONTRACT_STATUS");
assert(
  pending.release_source_commit === EXPECTED_RELEASE_SOURCE_COMMIT &&
    JSON.stringify(pending.release_component_sha256s) ===
      JSON.stringify(EXPECTED_RELEASE_COMPONENT_HASHES) &&
    pending.source_hashes_must_be_bound_before_reseal === false,
  "SOURCE_BOUND_HASHES",
);
const credentialReceipt = pending.credential_receipt_binding;
assert(
  credentialReceipt.source_commit === "3f7b588de4b96da7c1e56b6c1908df7381712710" &&
    credentialReceipt.receipt_path ===
      "~/.videoforge/v2-13/bootstrap/receipt/credential-bootstrap.json" &&
    credentialReceipt.receipt_sha256 === EXPECTED_CREDENTIAL_RECEIPT_SHA256 &&
    credentialReceipt.rotation_result_sha256 === EXPECTED_CREDENTIAL_ROTATION_RESULT_SHA256 &&
    credentialReceipt.schema_version === "videoforge.v2-13-credential-bootstrap-result/v1" &&
    credentialReceipt.secret_free === true &&
    credentialReceipt.authority_consumed_and_non_reusable === true &&
    credentialReceipt.raw_values_in_evidence === false &&
    credentialReceipt.google_project_id === EXPECTED_GOOGLE_PROJECT_ID &&
    credentialReceipt.google_project_id_sha256 === EXPECTED_GOOGLE_PROJECT_ID_SHA256 &&
    credentialReceipt.google_project_number_sha256 === EXPECTED_GOOGLE_PROJECT_NUMBER_SHA256 &&
    credentialReceipt.google_authenticated_account_sha256 === EXPECTED_GOOGLE_ACCOUNT_SHA256 &&
    credentialReceipt.google_oauth_client_id_sha256 === EXPECTED_GOOGLE_CLIENT_ID_SHA256 &&
    credentialReceipt.google_oauth_client_secret_sha256 === EXPECTED_GOOGLE_CLIENT_SECRET_SHA256 &&
    credentialReceipt.google_javascript_origins_canonical_sha256 ===
      EXPECTED_GOOGLE_JS_ORIGINS_SHA256 &&
    credentialReceipt.google_redirect_uris_canonical_sha256 === EXPECTED_GOOGLE_REDIRECTS_SHA256 &&
    credentialReceipt.r2_account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    credentialReceipt.r2_account_id_sha256 === EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    credentialReceipt.r2_bucket_name === EXPECTED_R2_BUCKET_NAME &&
    credentialReceipt.r2_bucket_name_sha256 === EXPECTED_R2_BUCKET_NAME_SHA256 &&
    credentialReceipt.r2_access_key_id_sha256 === EXPECTED_R2_ACCESS_KEY_ID_SHA256 &&
    credentialReceipt.r2_secret_access_key_sha256 === EXPECTED_R2_SECRET_ACCESS_KEY_SHA256,
  "CREDENTIAL_RECEIPT_BINDING",
);
assert(
  pending.cloudflare_authentication.mode === "EXISTING_WRANGLER_OAUTH_CONFIG_ONLY" &&
    pending.cloudflare_authentication.protected_binding_environment_name ===
      "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE" &&
    pending.cloudflare_authentication.protected_file_mode === "0600" &&
    JSON.stringify(pending.cloudflare_authentication.oauth_scopes) ===
      JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES) &&
    pending.cloudflare_authentication.protected_config_path === EXPECTED_WRANGLER_CONFIG_PATH &&
    pending.cloudflare_authentication.protected_config_path_sha256 ===
      EXPECTED_WRANGLER_CONFIG_PATH_SHA256 &&
    pending.cloudflare_authentication.volatile_oauth_token_or_config_bytes_used_as_execution_authority ===
      false &&
    pending.cloudflare_authentication.config_path_identity?.path === EXPECTED_WRANGLER_CONFIG_PATH &&
    pending.cloudflare_authentication.config_path_identity?.path_sha256 ===
      EXPECTED_WRANGLER_CONFIG_PATH_SHA256 &&
    pending.cloudflare_authentication.config_path_identity?.mode === "0600" &&
    pending.cloudflare_authentication.config_path_identity
      ?.volatile_oauth_token_or_config_bytes_used_as_execution_authority === false &&
    pending.cloudflare_authentication.config_sha256 === null &&
    pending.cloudflare_authentication.raw_api_token_file_authorized === false &&
    pending.cloudflare_authentication.cloudflare_api_token_environment_export_authorized === false &&
    pending.cloudflare_authentication.new_cloudflare_credential_creation_authorized === false &&
    pending.cloudflare_authentication.new_cloudflare_credential_rotation_authorized === false,
  "PENDING_CLOUDFLARE_OAUTH",
);
const origin = pending.account_and_workers_dev_origin;
assert(
  origin.account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    origin.account_id_sha256 === EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    origin.authenticated_account_readback_required === true &&
    origin.workers_dev_subdomain_endpoint === "/workers/subdomain" &&
    origin.workers_dev_subdomain === EXPECTED_WORKERS_DEV_SUBDOMAIN &&
    origin.workers_dev_subdomain_sha256 === EXPECTED_WORKERS_DEV_SUBDOMAIN_SHA256 &&
    origin.subdomain_readback_required === true &&
    origin.worker_name === "videoforge-production-runtime" &&
    origin.derived_origin_template === "https://{worker_name}.{workers_dev_subdomain}.workers.dev" &&
    origin.public_origin === EXPECTED_PUBLIC_ORIGIN &&
    origin.public_origin_must_equal_derived_origin === true,
  "PENDING_ORIGIN_BINDING",
);
const routes = pending.route_readbacks;
assert(
  routes.path === "/api/v2/hosted/status" &&
    routes.method === "GET" &&
    routes.pre_mutation.worker_must_be_absent === true &&
    routes.pre_mutation.status === 404 &&
    routes.pre_mutation.content_type === EXPECTED_ABSENT_ROUTE_CONTENT_TYPE &&
    routes.pre_mutation.body_length === EXPECTED_ABSENT_ROUTE_BODY_LENGTH &&
    routes.pre_mutation.body_sha256 === EXPECTED_ABSENT_ROUTE_BODY_SHA256 &&
    routes.pre_mutation.observed_body_sha256_prefix === EXPECTED_ABSENT_ROUTE_BODY_SHA256_PREFIX &&
    routes.pre_mutation.json_body_authorized === false &&
    routes.pre_mutation.status_503_authorized === false &&
    routes.pre_mutation.exact_body_and_content_type_required === true &&
    routes.post_secret_free_quarantine.status === 200 &&
    routes.post_secret_free_quarantine.content_type === "application/json" &&
    routes.post_secret_free_quarantine.schema_version === "videoforge-hosted-status/v1" &&
    routes.post_secret_free_quarantine.gpu_transport === "DISABLED_UNQUALIFIED" &&
    routes.post_secret_free_quarantine.body_sha256 === null &&
    routes.post_qualification.status === 200 &&
    routes.post_qualification.content_type === "application/json" &&
    routes.post_qualification.schema_version === "videoforge-hosted-status/v1" &&
    routes.post_qualification.gpu_transport === "QUALIFIED_EXACT" &&
    routes.post_qualification.body_sha256 === null,
  "ROUTE_READBACK_CONTRACT",
);
const seed = pending.strict_nested_seed_hash_binding;
assert(
  seed.seed_schema === "videoforge.v213-full-live-materialization-seed/v1" &&
    seed.seed_file_environment_name === "VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE" &&
    seed.materialization_seed_sha256_field === "materialization_seed_sha256" &&
    seed.seed_file_sha256 === null &&
    seed.outer_authority_must_bind_seed_hash === true &&
    seed.consumption_record_must_bind_seed_hash === true &&
    seed.verified_at_outer_consumption === true &&
    seed.verified_before_every_seed_read === true &&
    seed.verified_after_restart_or_recovery === true &&
    seed.hash_algorithm === "SHA256_CANONICAL_JSON_BYTES" &&
    seed.hash_binding_mode === "EXACT_NESTED_PATH_AND_HASH_CAS" &&
    seed.nested_hashes_must_bind_exact_values === true &&
    seed.missing_or_extra_nested_hashes_rejected === true &&
    seed.future_endpoint_or_deployment_identity_values_forbidden === true &&
    seed.credential_values_forbidden === true &&
    seed.exact_nested_hash_paths_pending_source_contract === false,
  "STRICT_NESTED_SEED_HASH_BINDING",
);

const prequalificationBridge = proposal.exact_execution_graph.prequalification_bridge_policy;
const bridgeReceiptGate = prequalificationBridge.receipt_gate;
assert(
  bridgeReceiptGate.adapter_option === "requirePrequalificationReceipt" &&
    bridgeReceiptGate.verifier_function === "verifyPrequalificationDatabaseReceipt" &&
    bridgeReceiptGate.verifier_owner_only_protected_readback === true &&
    bridgeReceiptGate.verifier_owner_service_file === "owner.pg_service.conf" &&
    bridgeReceiptGate.verifier_owner_pass_file === "owner.pgpass" &&
    bridgeReceiptGate.verifier_owner_service_name === "videoforge_v2_13_owner" &&
    bridgeReceiptGate.verifier_protected_input_directory_env ===
      "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR" &&
    bridgeReceiptGate.receipt_file === "prequalification-database-bootstrap.json" &&
    bridgeReceiptGate.prior_result_operation === "bootstrap-prequalification-database" &&
    bridgeReceiptGate.receipt_hash_field === "prequalification_database_bootstrap_sha256" &&
    bridgeReceiptGate.require_prior_result_and_file_hash_match === true &&
    bridgeReceiptGate.verifier_disable_override_authorized === false &&
    bridgeReceiptGate.cas_before_owner_service_and_pass_read === true &&
    bridgeReceiptGate.verify_ledger45_pgcrypto_and_exact_operator_acl === true &&
    bridgeReceiptGate.cas_precedes_all_production_operator_runpod_and_application_secret_reads ===
      true &&
    bridgeReceiptGate.before_every_post_bootstrap_non_early_cleanup_operation === true &&
    bridgeReceiptGate.bootstrap_operation_exempt === true &&
    bridgeReceiptGate.early_cleanup_exempt === true &&
    bridgeReceiptGate.guarded_activation_receipt_verified_before_application_secret_reads ===
      true &&
    bridgeReceiptGate.guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads ===
      true,
  "PREQUALIFICATION_RECEIPT_GATE",
);
const operatorOnlyPreflight = prequalificationBridge.operator_only_preflight;
assert(
  operatorOnlyPreflight.function === "preflightConcreteFullLiveInputs" &&
    operatorOnlyPreflight.operator_only === true &&
    operatorOnlyPreflight.before_command === "fresh-live-preflight" &&
    JSON.stringify(operatorOnlyPreflight.protected_environment_inputs) ===
      JSON.stringify([
        "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE",
        "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
      ]) &&
    operatorOnlyPreflight.fresh_child_reader === "readV213PrequalificationProtectedInputs" &&
    operatorOnlyPreflight.fresh_child_runtime_factory === "createV213PrequalificationRuntime" &&
    operatorOnlyPreflight.fresh_child_operator_role === "videoforge_hosted_operator" &&
    operatorOnlyPreflight.fresh_child_allowed_database_input === "operatorDatabaseUrl" &&
    JSON.stringify(operatorOnlyPreflight.fresh_child_forbidden_database_inputs) ===
      JSON.stringify(["ownerDatabaseUrl", "runtimeDatabaseUrl", "reconcilerDatabaseUrl"]) &&
    JSON.stringify(operatorOnlyPreflight.fresh_child_forbidden_database_fd_names) ===
      JSON.stringify(["OWNER_DATABASE_URL_FD", "RUNTIME_DATABASE_URL_FD", "RECONCILER_DATABASE_URL_FD"]) &&
    operatorOnlyPreflight.fresh_child_receives_no_owner_runtime_or_reconciler_dsn === true,
  "PREQUALIFICATION_FRESH_CHILD_SEAM",
);
const executorReceiptGate = prequalificationBridge.executor_receipt_gate;
assert(
  executorReceiptGate.verifier_function === "verifyPrequalificationDatabaseReceipt" &&
    executorReceiptGate.settled_result_hydration_function === "hydrateSettledResults" &&
    executorReceiptGate.prior_results_argument === "priorResults" &&
    executorReceiptGate.initial_bootstrap_only_preflight_skips_full_receipt_verifier === true &&
    executorReceiptGate.staged_preflight?.mode_flag === "staged" &&
    executorReceiptGate.staged_preflight.verify_before_full_protected_preflight === true &&
    executorReceiptGate.staged_preflight.full_protected_preflight_function ===
      "preflightConcreteFullLiveInputs" &&
    executorReceiptGate.restart_preflight?.hydrate_settled_results_before_preflight === true &&
    executorReceiptGate.restart_preflight.use_hydrated_prior_results === true &&
    executorReceiptGate.restart_preflight.repeat_receipt_verifier === true &&
    executorReceiptGate.restart_preflight.verify_before_full_protected_preflight === true &&
    executorReceiptGate.no_role_presence_or_initial_preflight_substitution === true,
  "PREQUALIFICATION_EXECUTOR_RECEIPT_GATE",
);
for (const [name, expected] of Object.entries(exactGraphPolicies))
  assert(
    JSON.stringify(proposal.exact_execution_graph[name]) === JSON.stringify(expected),
    `EXACT_GRAPH_POLICY:${name}`,
  );

const cloudflareGraph = proposal.exact_execution_graph.cloudflare_credential_origin_policy;
assert(
  cloudflareGraph.status === "SOURCE_BOUND_AUDITED" &&
    cloudflareGraph.oauth_authentication.config_path_resolver === "wranglerOAuthConfigPath" &&
    cloudflareGraph.oauth_authentication.protected_config_reader ===
      "readWranglerOAuthCredential" &&
    cloudflareGraph.oauth_authentication.oauth_api_reader === "cloudflareOAuthApiResponse" &&
    cloudflareGraph.oauth_authentication.account_subdomain_reader ===
      "readCloudflareWorkersDevOrigin" &&
    cloudflareGraph.oauth_authentication.read_only_preflight === "cloudflareOAuthReadOnlyPreflight" &&
    cloudflareGraph.oauth_authentication.protected_binding_environment_name ===
      "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE" &&
    cloudflareGraph.oauth_authentication.protected_file_mode === "0600" &&
    JSON.stringify(cloudflareGraph.oauth_authentication.oauth_scopes) ===
      JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES) &&
    cloudflareGraph.oauth_authentication.raw_api_token_file_authorized === false &&
    cloudflareGraph.oauth_authentication.cloudflare_api_token_environment_export_authorized === false &&
    cloudflareGraph.oauth_authentication.new_cloudflare_credential_authorized === false &&
    cloudflareGraph.oauth_authentication.token_values_and_token_hashes_in_proposal_authorized ===
      false &&
    cloudflareGraph.oauth_authentication.oauth_scope_readback_required === true &&
    cloudflareGraph.oauth_authentication.account_identity_readback_required === true,
  "CLOUDFLARE_GRAPH_OAUTH",
);
assert(
  cloudflareGraph.account_and_origin.account_readback_must_be_authenticated === true &&
    cloudflareGraph.account_and_origin.account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    cloudflareGraph.account_and_origin.account_id_sha256 === EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain_endpoint === "/workers/subdomain" &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain_field === "result.subdomain" &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain_sha256_field ===
      "subdomainReadbackSha256" &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain === EXPECTED_WORKERS_DEV_SUBDOMAIN &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain_sha256 ===
      EXPECTED_WORKERS_DEV_SUBDOMAIN_SHA256 &&
    cloudflareGraph.account_and_origin.worker_name === "videoforge-production-runtime" &&
    cloudflareGraph.account_and_origin.origin_derivation ===
      "https://{worker_name}.{workers_dev_subdomain}.workers.dev" &&
    cloudflareGraph.account_and_origin.public_origin === EXPECTED_PUBLIC_ORIGIN &&
    cloudflareGraph.account_and_origin.origin_must_equal_derived_account_bound_origin === true &&
    cloudflareGraph.account_and_origin.account_id_and_subdomain_identities_pending_source_binding ===
      false,
  "CLOUDFLARE_GRAPH_ORIGIN",
);
assert(
  cloudflareGraph.route_readback_contract.before_creation.status === 404 &&
    cloudflareGraph.route_readback_contract.before_creation.content_type ===
      EXPECTED_ABSENT_ROUTE_CONTENT_TYPE &&
    cloudflareGraph.route_readback_contract.before_creation.body_length ===
      EXPECTED_ABSENT_ROUTE_BODY_LENGTH &&
    cloudflareGraph.route_readback_contract.before_creation.body_sha256 ===
      EXPECTED_ABSENT_ROUTE_BODY_SHA256 &&
    cloudflareGraph.route_readback_contract.before_creation.observed_body_sha256_prefix ===
      EXPECTED_ABSENT_ROUTE_BODY_SHA256_PREFIX &&
    cloudflareGraph.route_readback_contract.before_creation.json_body_forbidden === true &&
    cloudflareGraph.route_readback_contract.before_creation.status_503_forbidden === true &&
    cloudflareGraph.route_readback_contract.after_secret_free_quarantine.status === 200 &&
    cloudflareGraph.route_readback_contract.after_secret_free_quarantine.gpu_transport ===
      "DISABLED_UNQUALIFIED" &&
    cloudflareGraph.route_readback_contract.after_qualification.status === 200 &&
    cloudflareGraph.route_readback_contract.after_qualification.gpu_transport === "QUALIFIED_EXACT",
  "CLOUDFLARE_GRAPH_ROUTES",
);
assert(cloudflareGraph.source_contract_must_reject_old_503_json_prestate === true, "NO_503_JSON_PRESTATE");
const credentialGraph = proposal.exact_execution_graph.credential_scope_policy;
assert(
  credentialGraph.status === "BOUND_COMPLETED_CREDENTIAL_ROTATION_RECEIPT" &&
    credentialGraph.credential_creation_or_rotation_removed_from_full_live_graph === true &&
    credentialGraph.separate_future_credential_bootstrap_approval_required === false &&
    credentialGraph.no_credential_identity_or_hash_finalized === false &&
    JSON.stringify(credentialGraph.credential_receipt_binding) === JSON.stringify(credentialReceipt),
  "CREDENTIAL_GRAPH_BOUND",
);
assert(
  credentialGraph.google_oauth.authorized_operation ===
      "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_GOOGLE_OAUTH_WEB_CLIENT" &&
    credentialGraph.google_oauth.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    credentialGraph.google_oauth.separate_future_credential_bootstrap_approval_required === false &&
    credentialGraph.google_oauth.creation_or_rotation_authorized === false &&
    credentialGraph.google_oauth.project_access === "USER_ACCESSIBLE_EXISTING_PROJECT_ONLY" &&
    credentialGraph.google_oauth.accessible_project_count_observed === 1 &&
    credentialGraph.google_oauth.project_id === EXPECTED_GOOGLE_PROJECT_ID &&
    credentialGraph.google_oauth.project_id_sha256 === EXPECTED_GOOGLE_PROJECT_ID_SHA256 &&
    credentialGraph.google_oauth.project_number_sha256 === EXPECTED_GOOGLE_PROJECT_NUMBER_SHA256 &&
    credentialGraph.google_oauth.authenticated_account_sha256 === EXPECTED_GOOGLE_ACCOUNT_SHA256 &&
    credentialGraph.google_oauth.client_id_sha256 === EXPECTED_GOOGLE_CLIENT_ID_SHA256 &&
    credentialGraph.google_oauth.client_secret_sha256 === EXPECTED_GOOGLE_CLIENT_SECRET_SHA256 &&
    credentialGraph.google_oauth.javascript_origins_canonical_sha256 ===
      EXPECTED_GOOGLE_JS_ORIGINS_SHA256 &&
    credentialGraph.google_oauth.redirect_uris_canonical_sha256 === EXPECTED_GOOGLE_REDIRECTS_SHA256 &&
    credentialGraph.google_oauth.callback_uri ===
      "{final_production_origin}/api/auth/callback/google" &&
    credentialGraph.google_oauth.callback_uri_count === 1 &&
    credentialGraph.google_oauth.final_production_origin_only === true &&
    credentialGraph.google_oauth.staging_local_preview_and_other_callbacks_forbidden === true &&
    credentialGraph.google_oauth.new_project_authorized === false &&
    credentialGraph.google_oauth.new_project_or_access_grant_requires_fresh_explicit_authority ===
      false &&
    credentialGraph.google_oauth.historical_inaccessible_project ===
      "videoforge-v2-06-staging-0817" &&
    credentialGraph.google_oauth.old_client_disable_before_new_readback === false &&
    credentialGraph.google_oauth.protected_value_must_exist_before_reseal === true,
  "CREDENTIAL_GRAPH_GOOGLE",
);
assert(
  credentialGraph.r2_s3.authorized_operation ===
      "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_LEAST_PRIVILEGE_R2_S3_CREDENTIAL" &&
    credentialGraph.r2_s3.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    credentialGraph.r2_s3.separate_future_credential_bootstrap_approval_required === false &&
    credentialGraph.r2_s3.creation_or_rotation_authorized === false &&
    credentialGraph.r2_s3.account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    credentialGraph.r2_s3.account_id_sha256 === EXPECTED_CLOUDFLARE_ACCOUNT_ID_SHA256 &&
    credentialGraph.r2_s3.bucket_name === EXPECTED_R2_BUCKET_NAME &&
    credentialGraph.r2_s3.bucket_name_sha256 === EXPECTED_R2_BUCKET_NAME_SHA256 &&
    credentialGraph.r2_s3.access_key_id_sha256 === EXPECTED_R2_ACCESS_KEY_ID_SHA256 &&
    credentialGraph.r2_s3.secret_access_key_sha256 === EXPECTED_R2_SECRET_ACCESS_KEY_SHA256 &&
    credentialGraph.r2_s3.account_and_existing_bucket_binding_required === true &&
    JSON.stringify(credentialGraph.r2_s3.allowed_actions_upper_bound) ===
      JSON.stringify(["ListBucket", "GetObject", "PutObject", "DeleteObject"]) &&
    credentialGraph.r2_s3.object_prefix === null &&
    credentialGraph.r2_s3.account_wide_or_wildcard_access_forbidden === true &&
    credentialGraph.r2_s3.new_bucket_authorized === false &&
    credentialGraph.r2_s3.other_credential_creation_or_rotation_authorized === false &&
    credentialGraph.r2_s3.action_set_and_prefix_pending_credential_scope_audit === false &&
    credentialGraph.r2_s3.protected_value_must_exist_before_reseal === true,
  "CREDENTIAL_GRAPH_R2",
);

assert(
  operations.length === 26 &&
    operations.at(-1) === "certify-v2-13-release" &&
    JSON.stringify(proposal.exact_execution_graph.ordered_operation_ids) ===
      JSON.stringify(operations),
  "EXACT_26_OPS",
);
assert(proposal.exact_execution_graph.operation_order_is_closed_and_non_reorderable === true, "CLOSED_OPS");
assert(proposal.exact_execution_graph.missing_extra_or_repeated_operation_is_a_hard_stop === true, "OP_REPLAY_STOP");
assert(
  proposal.immutable_github_release_ref_request.exact_target_commit ===
      EXPECTED_RELEASE_SOURCE_COMMIT &&
    proposal.immutable_github_release_ref_request.creation_requested === true &&
    proposal.immutable_github_release_ref_request.exact_ref ===
      "refs/tags/videoforge-v2-13-release-20260826-v3" &&
    proposal.immutable_github_release_ref_request.exact_tag_name ===
      "videoforge-v2-13-release-20260826-v3" &&
    proposal.immutable_github_release_ref_request.tag_kind === "LIGHTWEIGHT" &&
    proposal.immutable_github_release_ref_request.maximum_new_refs === 1 &&
    proposal.immutable_github_release_ref_request.force_update_authorized === false &&
    proposal.immutable_github_release_ref_request.delete_or_retarget_authorized === false &&
    proposal.immutable_github_release_ref_request.other_ref_creation_authorized === false &&
    proposal.immutable_github_release_ref_request.remote === "origin" &&
    proposal.immutable_github_release_ref_request.stop_on_presence_collision_or_drift === true,
  "TARGET_SOURCE_BOUND",
);
assert(
  JSON.stringify(scope.cloudflare_creation_allowlist) ===
      JSON.stringify([
        "disabled Worker videoforge-production-runtime",
        "disabled Workflow videoforge-production-runtime",
        "disabled Workflow videoforge-production-runtime-pair",
      ]) &&
    JSON.stringify(scope.runpod_creation_allowlist_after_both_fresh_qualifications) ===
      JSON.stringify([
        "one exact Mage immutable production template",
        "one exact Mage production endpoint with workersMin=0 and workersMax=1",
        "one exact SoulX immutable production template",
        "one exact SoulX production endpoint with workersMin=0 and workersMax=1",
      ]) &&
    scope.new_r2_buckets === 0 &&
    scope.new_volumes === 0 &&
    scope.new_paid_retained_resources === 0 &&
    scope.other_new_git_refs === 0 &&
    scope.other_resource_creation_authorized === false &&
    scope.plan_change_authorized === false,
  "EXACT_CREATION_SCOPE",
);
const requestedInternalCredentials =
  proposal.approval_request.requested_internal_production_credentials;
assert(
  proposal.approval_request.requested_maximum_cumulative_finite_runpod_spend_usd === 17.5 &&
    JSON.stringify(proposal.approval_request.requested_exact_phase_caps_usd) ===
      JSON.stringify([4.5, 1, 2, 2, 4, 2, 2]) &&
    proposal.approval_request.requested_gpu.includes("LOW-or-better") &&
    proposal.approval_request.requested_gpu.includes("USD 0.00031/second") &&
    proposal.approval_request.requested_gpu.includes("USD 1.116/GPU-hour") &&
    proposal.approval_request.requested_gpu.includes("no fallback") &&
    proposal.approval_request.requested_separate_retention_consent.includes("USD 7/month") &&
    proposal.approval_request.requested_google_project_id === EXPECTED_GOOGLE_PROJECT_ID &&
    proposal.approval_request.requested_google_client_id_sha256 ===
      EXPECTED_GOOGLE_CLIENT_ID_SHA256 &&
    proposal.approval_request.requested_r2_account_id === EXPECTED_CLOUDFLARE_ACCOUNT_ID &&
    proposal.approval_request.requested_r2_bucket_name === EXPECTED_R2_BUCKET_NAME &&
    proposal.approval_request.requested_credential_identities_and_hashes_must_be_finalized_before_reseal ===
      false &&
    proposal.approval_request.requested_exact_action.includes("completed receipt-bound") &&
    proposal.approval_request.requested_google_oauth_scope.includes("completed-receipt-bound protected") &&
    proposal.approval_request.requested_google_oauth_scope.includes("no creation or rotation") &&
    proposal.approval_request.requested_google_oauth_scope.includes(EXPECTED_GOOGLE_PROJECT_ID) &&
    proposal.approval_request.requested_r2_s3_scope.includes("completed-receipt-bound protected") &&
    proposal.approval_request.requested_r2_s3_scope.includes("no creation or rotation") &&
    proposal.approval_request.requested_r2_s3_scope.includes(EXPECTED_R2_BUCKET_NAME) &&
    requestedInternalCredentials?.exact_one_time_count ===
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count &&
    JSON.stringify(requestedInternalCredentials.exact_scope) ===
      JSON.stringify(
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
      ) &&
    requestedInternalCredentials.generated_only_after_consumption === true &&
    requestedInternalCredentials.other_credential_creation_or_rotation_forbidden === true &&
    proposal.approval_request.requested_exact_action.includes(
      "exactly three database role credential values",
    ) &&
    proposal.approval_request.requested_exact_action.includes(
      "exactly ten internal production secret values",
    ),
  "APPROVAL_SCOPE_BOUND",
);
const allOperations = proposal.ordered_operations.flatMap((phase) => phase.operations);
assert(
  !allOperations.some((operation) =>
    /(?:no credential creation or rotation is authorized|this graph authorizes no credential creation or rotation)/iu.test(
      operation,
    ),
  ),
  "NO_CONTRADICTORY_BLANKET_CREDENTIAL_PROHIBITION",
);
includes(
  allOperations,
  "post-consumption creation of exactly three database role credential values and exactly ten internal production secret values",
  "EXACT_3_PLUS_10_CREDENTIAL_OPERATION",
);
includes(
  allOperations,
  "Google OAuth and R2 creation or rotation",
  "GOOGLE_R2_CREATE_ROTATE_FORBIDDEN_OPERATION",
);
includes(
  allOperations,
  "every other credential creation or rotation are forbidden",
  "OTHER_CREDENTIAL_CREATE_ROTATE_FORBIDDEN_OPERATION",
);
includes(
  allOperations,
  "proposal-only candidate on codex/serverless-v2-roadmap-v4",
  "EXACT_PROPOSAL_BRANCH_OPERATION",
);
includes(
  allOperations,
  "authority-record commit containing both exact approval and authority records to origin/codex/serverless-v2-roadmap-v4 without force",
  "EXACT_AUTHORITY_BRANCH_OPERATION",
);
assert(
  !allOperations.some((operation) =>
    /(?:^|\s)(?:origin\/)?codex\/serverless-v2-roadmap(?:\s|,|$)/u.test(operation),
  ),
  "STALE_PROPOSAL_BRANCH_OPERATION",
);
includes(allOperations, "sealed source-bound/audited candidate", "SEALED_OPERATION");
includes(allOperations, "404 text/html", "ABSENT_404_HTML_OPERATION");
includes(allOperations, "not 503 JSON", "NO_503_OPERATION");
includes(allOperations, "protected Wrangler OAuth config", "OAUTH_OPERATION");
includes(allOperations, "Google OAuth WEB client", "GOOGLE_OPERATION");
includes(allOperations, "least-privilege R2 S3 credential", "R2_OPERATION");
includes(allOperations, "strict nested seed-hash", "SEED_OPERATION");
includes(allOperations, "paid two-lane smoke", "V213_SMOKE_ONLY_OPERATION");
includes(allOperations, "four-operation cleanup proof", "EXACT_CLEANUP_PROOF_OPERATION");
includes(allOperations, "DB-only zero-spend", "DB_ONLY_CERTIFICATION_OPERATION");
includes(proposal.stop_conditions, "raw Cloudflare API token", "NO_RAW_TOKEN_STOP");
includes(proposal.stop_conditions, "inaccessible Google project", "NO_INACCESSIBLE_PROJECT_STOP");
includes(proposal.stop_conditions, "exact HTTP 404 text/html", "EXACT_404_STOP");
includes(proposal.stop_conditions, "CLOUDFLARE_API_TOKEN", "NO_TOKEN_EXPORT_STOP");

for (const name of ["user-approval.json", "approved-authority.json"]) {
  try {
    await access(path.join(directory, name));
    throw new Error(`DRAFT_MUST_NOT_CONTAIN_${name}`);
  } catch (error) {
    if (error?.message === `DRAFT_MUST_NOT_CONTAIN_${name}`) throw error;
  }
}
const files = await readdir(directory);
assert(
  JSON.stringify([...files].sort()) ===
    JSON.stringify([
      "combined-live-proposal.json",
      "read-only-preflight.json",
      "source-readiness-audit.json",
      "validate-candidate.mjs",
    ]),
  "DRAFT_FILE_SET",
);

console.log(
  JSON.stringify({
    status: "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL",
    proposal_sha256: sha256(bytes),
    proposal_record_commit: null,
    release_source_commit: EXPECTED_RELEASE_SOURCE_COMMIT,
    superseded_proposal_sha256: previousProposalSha256,
    superseded_proposal_record_commit: previousProposalRecordCommit,
    superseded_approval_record_materialized: false,
    superseded_authority_id: null,
    superseded_authority_materialized: false,
    authority: "ABSENT",
    source_hashes: "BOUND_EXACT_RELEASE_COMPONENTS",
    external_calls: 0,
    mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
  }),
);
