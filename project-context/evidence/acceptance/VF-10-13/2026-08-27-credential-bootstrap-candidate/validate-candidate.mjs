import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../../..");
const proposalPath = resolve(directory, "combined-credential-bootstrap-proposal.json");
const bytes = await readFile(proposalPath);
const proposal = JSON.parse(bytes);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V2_13_CREDENTIAL_BOOTSTRAP_${code}`);
};
const exactKeys = (value, keys, code) => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  )
    fail(code);
};
const same = (actual, expected, code) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
};
const gitBytes = (commit, path) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd: repository, encoding: null });

if (
  proposal.schema_version !== "videoforge.v2-13-credential-bootstrap-proposal/v1" ||
  proposal.proposal_status !== "BLOCKED_UNSEALED" ||
  proposal.sealing?.sealed_for_exact_user_approval !== false ||
  proposal.sealing?.current_bytes_are_approval_ineligible !== true
)
  fail("SEALING");

exactKeys(
  proposal.authority,
  [
    "single_use",
    "exact_proposal_approved",
    "authority_id",
    "approval_sha256",
    "approved_at",
    "expires_at",
    "consumed",
    "credential_access_authorized",
    "google_project_creation_authorized",
    "google_oauth_client_creation_authorized",
    "cloudflare_r2_credential_creation_authorized",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "runpod_calls_authorized",
    "gpu_use_authorized",
    "external_spend_authorized",
    "redispatch_authorized",
  ],
  "AUTHORITY_KEYS",
);
if (
  proposal.authority.single_use !== true ||
  Object.entries(proposal.authority).some(
    ([key, value]) => key !== "single_use" && value !== false && value !== null,
  )
)
  fail("AUTHORITY");

const sourceCommit = "3f7b588de4b96da7c1e56b6c1908df7381712710";
if (proposal.source?.release_source_commit !== sourceCommit) fail("SOURCE_COMMIT");
const sourcePins = {
  "apps/web/src/server/hosted/auth.ts":
    "sha256:ec4a23723f24139ea8d96a05a3932fd528188abab214e327a159b1297e848308",
  "apps/web/src/server/hosted/r2.ts":
    "sha256:473026cd897b6bd45df0a10d3ecff5b3705cafd6dd421924ea2114ad532baa71",
};
for (const [path, expected] of Object.entries(sourcePins)) {
  if (!proposal.source.source_contract_paths.includes(path) || sha256(gitBytes(sourceCommit, path)) !== expected)
    fail("SOURCE_PIN");
}

const scope = proposal.requested_scope;
if (
  scope.execution_mode !== "CREDENTIAL_BOOTSTRAP_ONLY" ||
  scope.single_use !== true ||
  scope.maximum_cumulative_runpod_spend_usd !== 0 ||
  scope.maximum_gpu_hours !== 0 ||
  scope.maximum_external_spend_usd !== 0 ||
  scope.phase_cap_usd?.credential_bootstrap !== 0 ||
  scope.runpod_calls_authorized !== false ||
  scope.gpu_use_authorized !== false ||
  scope.runpod_fallback_authorized !== false ||
  scope.new_paid_retained_resources_authorized !== false
)
  fail("ZERO_SCOPE");

const google = scope.google_cloud;
if (
  google.requested_project_id !== "videoforge-v2-13-prod-0827" ||
  google.authenticated_account_sha256 !==
    "sha256:a7bca06b10386403d2757a5c78b397fb5722e0383bcd72cf9f29259e073bfcc7" ||
  google.preflight_accessible_project_count_observed !== 6 ||
  google.client_count !== 1 ||
  google.client_type !== "WEB" ||
  google.authorized_redirect_uri_count !== 1 ||
  google.authorized_redirect_uris?.[0] !==
    "https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google" ||
  google.authorized_javascript_origins?.length !== 0 ||
  google.consent_screen?.audience !== "EXTERNAL_TESTING" ||
  google.consent_screen?.publishing_status !== "TESTING" ||
  google.consent_screen?.application_name !== "VideoForge" ||
  google.consent_screen?.test_user_count !== 2
)
  fail("GOOGLE_SCOPE");
same(
  google.consent_screen.test_users,
  ["lakshmansai121@gmail.com", "demo9gss@gmail.com"],
  "GOOGLE_TEST_USERS",
);

const r2 = scope.cloudflare_r2;
if (
  r2.account_id !== "f9254d773a3426fcb469451b1f965d8c" ||
  r2.bucket_name !== "videoforge-v2-06-staging-private" ||
  r2.existing_bucket_only !== true ||
  r2.console_permission_label !== "Object Read & Write" ||
  r2.cloudflare_permission_group !== "Workers R2 Storage Bucket Item Write" ||
  r2.credential_scope_model !== "BUCKET_ONLY" ||
  r2.credential_level_prefix_scope !== null ||
  r2.granular_s3_action_subset_configurable !== false ||
  r2.account_wide_permissions_authorized !== false ||
  r2.wildcard_permissions_authorized !== false ||
  r2.other_bucket_permissions_authorized !== false ||
  r2.new_bucket_authorized !== false ||
  r2.credential_rotation_authorized !== false ||
  r2.second_credential_authorized !== false
)
  fail("R2_SCOPE");
const keyPolicy = r2.application_object_key_policy;
if (
  keyPolicy.enforcement_layer !== "APPLICATION_ONLY" ||
  keyPolicy.required_root_prefix !== "tenant/" ||
  keyPolicy.production_key_pattern_sha256 !==
    "sha256:e8c67a127627c643da87d73dd6a322b299a9ae460e012009291a089281656ff2" ||
  keyPolicy.source_sha256 !== sourcePins["apps/web/src/server/hosted/r2.ts"] ||
  keyPolicy.credential_level_prefix_restriction_claim_forbidden !== true
)
  fail("R2_KEY_POLICY");

if (
  scope.protected_storage?.directory_environment_name !== "VIDEOFORGE_V2_13_SECRET_INPUT_DIR" ||
  scope.protected_storage?.directory_mode !== "0700" ||
  scope.protected_storage?.file_mode !== "0600" ||
  scope.protected_storage?.raw_values_in_proposal_logs_or_receipt_authorized !== false
)
  fail("PROTECTED_STORAGE");
same(
  scope.protected_storage.files.map(({ name }) => name),
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
  "PROTECTED_FILES",
);

same(
  proposal.ordered_operations.map(({ order, id }) => [order, id]),
  [
    [1, "credential-bootstrap-google-access-preflight"],
    [2, "credential-bootstrap-r2-bucket-preflight"],
    [3, "credential-bootstrap-google-project-create-one"],
    [4, "credential-bootstrap-google-oauth-web-client-create-one"],
    [5, "credential-bootstrap-r2-s3-token-create-one"],
    [6, "credential-bootstrap-protected-storage-write"],
    [7, "credential-bootstrap-exact-readback-and-receipt"],
  ],
  "OPERATION_ORDER",
);
if (
  proposal.ordered_operations.some(
    (operation) => operation.runpod_calls !== 0 || operation.gpu_hours !== 0 || operation.spend_usd !== 0,
  )
)
  fail("OPERATION_CAP");

process.stdout.write(
  `${JSON.stringify({
    status: "PASS_BLOCKED_UNSEALED",
    proposal_sha256: sha256(bytes),
    authority: "ABSENT",
    provider_calls: 0,
    provider_mutations: 0,
    runpod_calls: 0,
    gpu_hours: 0,
    external_spend_usd: 0,
  })}\n`,
);
