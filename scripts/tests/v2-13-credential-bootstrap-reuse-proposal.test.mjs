import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDirectory = path.join(
  root,
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate",
);
const proposalName = "combined-credential-bootstrap-reuse-proposal.json";
const validatorName = "validate-candidate.mjs";

async function runMutation(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "videoforge-v213-reuse-proposal-"));
  try {
    const proposal = JSON.parse(await readFile(path.join(sourceDirectory, proposalName), "utf8"));
    mutate(proposal);
    await writeFile(path.join(directory, proposalName), `${JSON.stringify(proposal, null, 2)}\n`);
    await cp(path.join(sourceDirectory, validatorName), path.join(directory, validatorName));
    return spawnSync(process.execPath, [path.join(directory, validatorName)], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertRejected(result, code) {
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(code, "u"));
}

test("reuse candidate is sealed and executable only after fresh exact approval", async () => {
  const result = await runMutation(() => {});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL");
  assert.equal(output.authority, "ABSENT_UNCONSUMED_NO_MUTATION");
  assert.equal(output.executable_graph, true);
  assert.equal(output.provider_calls, 0);
  // The one recorded mutation is the previously observed, independently contained API side effect.
  assert.equal(output.provider_mutations, 1);
  assert.equal(output.credential_access, 0);
  assert.equal(output.runpod_calls, 0);
  assert.equal(output.gpu_hours, 0);
  assert.equal(output.external_spend_usd, 0);
  assert.match(output.proposal_sha256, /^sha256:[0-9a-f]{64}$/u);
});

test("reuse candidate rejects authority, sealing, source, supersession, and approval drift", async () => {
  assertRejected(
    await runMutation((proposal) => {
      proposal.authority.provider_mutations_authorized = true;
    }),
    "AUTHORITY_ABSENT",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.sealing.sealed_for_exact_user_approval = false;
    }),
    "SEALING_GATE",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.source.release_source_commit = "3f7b588de4b96da7c1e56b6c1908df7381712711";
    }),
    "SOURCE_PENDING",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.source.source_contract_hashes["apps/web/src/server/hosted/auth.ts"] =
        `sha256:${"0".repeat(64)}`;
    }),
    "SOURCE_HASHES",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.supersession.prior_approval_reusable = true;
    }),
    "SUPERSESSION_GATE",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.approval_request.fresh_exact_approval_required = false;
    }),
    "APPROVAL_SCOPE",
  );
});

test("reuse candidate rejects graph, operation-order, approval, and zero-spend drift", async () => {
  assertRejected(
    await runMutation((proposal) => {
      [proposal.exact_execution_graph.operation_ids[0], proposal.exact_execution_graph.operation_ids[1]] =
        [proposal.exact_execution_graph.operation_ids[1], proposal.exact_execution_graph.operation_ids[0]];
    }),
    "GRAPH_OPERATIONS",
  );
  assertRejected(
    await runMutation((proposal) => {
      [proposal.ordered_operations[0].id, proposal.ordered_operations[1].id] =
        [proposal.ordered_operations[1].id, proposal.ordered_operations[0].id];
    }),
    "OPERATIONS_ORDER",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.ordered_operations[2].requires_user_approval = false;
    }),
    "OPERATIONS_SCOPE",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.ordered_operations[4].runpod_calls = 1;
    }),
    "OPERATIONS_SCOPE",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.exact_execution_graph.maximum_external_spend_usd = 1;
    }),
    "GRAPH_GATE",
  );
});

test("reuse candidate rejects Google project evidence and forbidden project/OAuth scope drift", async () => {
  const evidenceMutations = [
    [(proposal) => (proposal.read_only_binding.google_project.lifecycle_state = "DELETE_REQUESTED"), "GOOGLE_EVIDENCE_BOUND_FACTS"],
    [(proposal) => (proposal.read_only_binding.google_project.project_id = "another-project"), "GOOGLE_EVIDENCE_BOUND_FACTS"],
    [(proposal) => (proposal.read_only_binding.google_project.iam_principal_count = 2), "GOOGLE_EVIDENCE_BOUND_FACTS"],
    [(proposal) => (proposal.read_only_binding.google_project.oauth_client_count = 1), "GOOGLE_EVIDENCE_BOUND_FACTS"],
    [(proposal) => (proposal.read_only_binding.google_project.enabled_api_inventory_count_after = 14), "GOOGLE_EVIDENCE_BOUND_FACTS"],
  ];
  for (const [mutate, code] of evidenceMutations) assertRejected(await runMutation(mutate), code);

  const scopeMutations = [
    [(proposal) => (proposal.requested_scope.google.project_create_authorized = true), "GOOGLE_SCOPE"],
    [(proposal) => (proposal.requested_scope.google.project_delete_authorized = true), "GOOGLE_SCOPE"],
    [(proposal) => (proposal.requested_scope.google.api_enablement_authorized = true), "GOOGLE_SCOPE"],
    [(proposal) => (proposal.requested_scope.google.authorized_redirect_uris = null), "GOOGLE_SCOPE"],
    [(proposal) => (proposal.requested_scope.google.authorized_javascript_origins = ""), "GOOGLE_SCOPE"],
    [(proposal) => proposal.requested_scope.google.authorized_redirect_uris.push("https://extra.invalid/callback"), "GOOGLE_SCOPE"],
    [(proposal) => proposal.requested_scope.google.authorized_javascript_origins.push("https://extra.invalid"), "GOOGLE_SCOPE"],
    [(proposal) => proposal.requested_scope.google.oauth_test_users.push("extra@example.com"), "GOOGLE_TEST_USERS"],
    [(proposal) => proposal.requested_scope.google.additional_oauth_scopes_authorized.push("openid"), "GOOGLE_SCOPES"],
    [(proposal) => (proposal.requested_scope.google.other_clients_or_test_users_authorized = true), "GOOGLE_SCOPE"],
  ];
  for (const [mutate, code] of scopeMutations) assertRejected(await runMutation(mutate), code);

  assertRejected(
    await runMutation((proposal) => {
      proposal.ordered_operations[3].authorized_redirect_uris =
        "https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google";
    }),
    "OAUTH_OPERATION_SCOPE",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.read_only_binding.google_project.oauth_capability_evidence.configuration_form_steps =
        "App Information";
    }),
    "GOOGLE_CAPABILITY_EVIDENCE",
  );
});

test("reuse candidate rejects R2 evidence and least-privilege scope drift", async () => {
  const evidenceMutations = [
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.target_credential_count = 0), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.bucket_name = "another-bucket"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.credential_scope_readback.status = "REVOKED"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.target_production_credential_count = 1), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.authenticated_account_sha256 = `sha256:${"0".repeat(64)}`), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.target_production_credential_type = "R2_S3_LONG_LIVED_ACCESS_KEY"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.target_production_credential_lifetime = "LONG_LIVED"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.target_production_credential_expiration_policy = "NO_EXPIRATION"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.target_production_credential_expiration_at = "2026-08-28T00:00:00.000Z"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.credential_scope_readback.credential_type = "R2_S3_LONG_LIVED_ACCESS_KEY"), "R2_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.cloudflare_r2.credential_scope_readback.issued_date = "2027-01-01"), "R2_EVIDENCE_UNBOUND"],
  ];
  for (const [mutate, code] of evidenceMutations) assertRejected(await runMutation(mutate), code);

  const scopeMutations = [
    [(proposal) => (proposal.requested_scope.cloudflare_r2.account_wide_permissions_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.wildcard_permissions_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.other_bucket_permissions_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.new_bucket_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_rotation_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.second_credential_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.prefix_scope_claim_authorized = true), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.new_production_credential_name = "another-token"), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_type = "ACCOUNT_API_TOKEN"), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_lifetime = "SHORT_LIVED"), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_expiration_policy = "EXPIRING"), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_expiration_at = "2026-08-28T00:00:00.000Z"), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_type_readback_required = false), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_lifetime_readback_required = false), "R2_SCOPE"],
    [(proposal) => (proposal.requested_scope.cloudflare_r2.credential_expiration_readback_required = false), "R2_SCOPE"],
  ];
  for (const [mutate, code] of scopeMutations) assertRejected(await runMutation(mutate), code);

  const operationMutations = [
    [(proposal) => (proposal.ordered_operations[4].credential_type = "ACCOUNT_API_TOKEN"), "R2_OPERATION_SCOPE"],
    [(proposal) => (proposal.ordered_operations[4].credential_lifetime = "SHORT_LIVED"), "R2_OPERATION_SCOPE"],
    [(proposal) => (proposal.ordered_operations[4].credential_expiration_policy = "EXPIRING"), "R2_OPERATION_SCOPE"],
    [(proposal) => (proposal.ordered_operations[4].credential_expiration_at = "2026-08-28T00:00:00.000Z"), "R2_OPERATION_SCOPE"],
    [(proposal) => (proposal.ordered_operations[4].credential_type_readback_required = false), "R2_OPERATION_SCOPE"],
    [(proposal) => (proposal.ordered_operations[4].credential_lifetime_readback_required = false), "R2_OPERATION_SCOPE"],
    [(proposal) => (proposal.ordered_operations[4].credential_expiration_readback_required = false), "R2_OPERATION_SCOPE"],
  ];
  for (const [mutate, code] of operationMutations) assertRejected(await runMutation(mutate), code);
});

test("reuse candidate rejects protected-storage, side-effect, and safety-verdict drift", async () => {
  assertRejected(
    await runMutation((proposal) => {
      proposal.read_only_binding.protected_storage.target_file_names.push("EXTRA_SECRET");
    }),
    "STORAGE_EVIDENCE_FILES",
  );
  assertRejected(
    await runMutation((proposal) => {
      proposal.read_only_binding.protected_storage.file_mode = "0644";
    }),
    "STORAGE_EVIDENCE_UNBOUND",
  );
  for (const [mutate, code] of [
    [(proposal) => (proposal.read_only_binding.protected_storage.path_must_not_be_repository_or_evidence = false), "STORAGE_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.protected_storage.receipt_file_name = "other.json"), "STORAGE_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.protected_storage.receipt_mode = "0644"), "STORAGE_EVIDENCE_UNBOUND"],
    [(proposal) => (proposal.read_only_binding.protected_storage.receipt_secret_free = false), "STORAGE_EVIDENCE_UNBOUND"],
  ]) assertRejected(await runMutation(mutate), code);
  assertRejected(
    await runMutation((proposal) => {
      proposal.requested_scope.protected_storage.overwrite_or_rotation_authorized = true;
    }),
    "STORAGE_SCOPE",
  );
  for (const [mutate, code] of [
    [(proposal) => (proposal.requested_scope.protected_storage.path_must_not_be_repository_or_evidence = false), "STORAGE_SCOPE"],
    [(proposal) => (proposal.requested_scope.protected_storage.receipt_mode = "0644"), "STORAGE_SCOPE"],
    [(proposal) => proposal.requested_scope.protected_storage.receipt_exact_fields.pop(), "STORAGE_RECEIPT_FIELDS"],
    [(proposal) => (proposal.ordered_operations[5].path_must_not_be_repository_or_evidence = false), "PROTECTED_STORAGE_OPERATION"],
    [(proposal) => (proposal.ordered_operations[5].receipt_file_name = "other.json"), "PROTECTED_STORAGE_OPERATION"],
  ]) assertRejected(await runMutation(mutate), code);

  for (const [mutate, code] of [
    [(proposal) => (proposal.receipt.schema_version = "wrong/v1"), "RECEIPT_CONTRACT"],
    [(proposal) => (proposal.receipt.raw_secret_values_authorized = true), "RECEIPT_CONTRACT"],
    [(proposal) => (proposal.receipt.receipt_replay_requires_exact_all_fields = false), "RECEIPT_CONTRACT"],
    [(proposal) => proposal.receipt.exact_fields.pop(), "RECEIPT_FIELDS"],
    [(proposal) => (proposal.ordered_operations[6].receipt_file_mode = "0644"), "RECEIPT_OPERATION"],
    [(proposal) => proposal.ordered_operations[6].receipt_exact_fields.pop(), "RECEIPT_OPERATION_FIELDS"],
  ]) assertRejected(await runMutation(mutate), code);

  const sideEffectMutations = [
    [(proposal) => (proposal.unexpected_provider_side_effect.disable_or_rollback_authorized = true), "UNEXPECTED_PROVIDER_SIDE_EFFECT"],
    [(proposal) => (proposal.unexpected_provider_side_effect.further_provider_actions_authorized = true), "UNEXPECTED_PROVIDER_SIDE_EFFECT"],
    [(proposal) => (proposal.unexpected_provider_side_effect.full_final_api_inventory_bound = false), "UNEXPECTED_PROVIDER_SIDE_EFFECT"],
    [(proposal) => (proposal.unexpected_provider_side_effect.evidence_sha256 = "sha256:" + "0".repeat(64)), "UNEXPECTED_PROVIDER_SIDE_EFFECT"],
  ];
  for (const [mutate, code] of sideEffectMutations) assertRejected(await runMutation(mutate), code);

  assertRejected(
    await runMutation((proposal) => {
      proposal.independent_safety_verdict.incident_contained = false;
    }),
    "SAFETY_VERDICT",
  );
});
