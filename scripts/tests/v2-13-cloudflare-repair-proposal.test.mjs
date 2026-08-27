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
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate",
);
const validatorName = "validate-candidate.mjs";

async function runMutation(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "videoforge-v213-cloudflare-proposal-"));
  try {
    const proposal = JSON.parse(
      await readFile(path.join(sourceDirectory, "combined-live-proposal.json"), "utf8"),
    );
    mutate(proposal);
    await writeFile(
      path.join(directory, "combined-live-proposal.json"),
      `${JSON.stringify(proposal, null, 2)}\n`,
    );
    await cp(path.join(sourceDirectory, validatorName), path.join(directory, validatorName));
    const result = spawnSync(process.execPath, [path.join(directory, validatorName)], {
      cwd: root,
      encoding: "utf8",
    });
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("blocked successor rejects the historical 503 JSON pre-state", async () => {
  const result = await runMutation((proposal) => {
    proposal.source.pending_source_contract.route_readbacks.pre_mutation.status = 503;
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ROUTE_READBACK_CONTRACT/u);
});

test("blocked successor rejects raw Cloudflare token export or authorization", async () => {
  const result = await runMutation((proposal) => {
    proposal.requested_scope.cloudflare_credential_scope.cloudflare_api_token_environment_export_authorized = true;
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CLOUDFLARE_OAUTH_SCOPE/u);
});

test("blocked successor rejects expanded Google OAuth and R2 credential scope", async () => {
  const googleResult = await runMutation((proposal) => {
    proposal.requested_scope.google_oauth_web_client_scope.authorized_redirect_uri_count = 2;
  });
  assert.notEqual(googleResult.status, 0);
  assert.match(googleResult.stderr, /GOOGLE_OAUTH_SCOPE/u);

  const r2Result = await runMutation((proposal) => {
    proposal.requested_scope.r2_s3_credential_scope.new_r2_bucket_authorized = true;
  });
  assert.notEqual(r2Result.status, 0);
  assert.match(r2Result.stderr, /R2_S3_SCOPE/u);
});

test("blocked successor requires outer and restart-bound nested seed hashes", async () => {
  const result = await runMutation((proposal) => {
    proposal.exact_execution_graph.internal_materialization_policy.materialization_seed_sha256_verified_after_restart_or_recovery = false;
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MATERIALIZATION_SEED_OUTER_BINDING/u);
});

test("blocked successor binds the exact ordered Wrangler OAuth scope set", async () => {
  const result = await runMutation((proposal) => {
    proposal.requested_scope.cloudflare_credential_scope.oauth_scopes[0] = "account:write";
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CLOUDFLARE_OAUTH_SCOPE/u);
});

test("blocked successor binds the exact absent-route content type, length, and body hash", async () => {
  const contentTypeResult = await runMutation((proposal) => {
    proposal.source.pending_source_contract.route_readbacks.pre_mutation.content_type =
      "text/plain";
  });
  assert.notEqual(contentTypeResult.status, 0);
  assert.match(contentTypeResult.stderr, /ROUTE_READBACK_CONTRACT/u);

  const bodyLengthResult = await runMutation((proposal) => {
    proposal.source.pending_source_contract.route_readbacks.pre_mutation.body_length = 16;
  });
  assert.notEqual(bodyLengthResult.status, 0);
  assert.match(bodyLengthResult.stderr, /ROUTE_READBACK_CONTRACT/u);

  const bodyHashResult = await runMutation((proposal) => {
    proposal.source.pending_source_contract.route_readbacks.pre_mutation.body_sha256 =
      "sha256:a4daf148dd64d1a3e8e8101040915e50d12df29153c5936d377cf2260ccc8ba1";
  });
  assert.notEqual(bodyHashResult.status, 0);
  assert.match(bodyHashResult.stderr, /ROUTE_READBACK_CONTRACT/u);
});

test("blocked successor verifies the superseded authority and approval commit bytes", async () => {
  const result = await runMutation((proposal) => {
    proposal.supersession.superseded_authority_record_sha256 =
      "sha256:42b122150ce2556afcbbf72d347bb0863d30ede0a126e384ae6e6c18ac0b3053";
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPERSESSION_45894_59DFE8A/u);
});

test("blocked successor removes Google and R2 credential creation from the approved graph", async () => {
  const googleResult = await runMutation((proposal) => {
    proposal.exact_execution_graph.credential_scope_policy.google_oauth.authorized_operation =
      "CREATE_OR_ROTATE_EXACTLY_ONE_GOOGLE_OAUTH_WEB_CLIENT";
  });
  assert.notEqual(googleResult.status, 0);
  assert.match(googleResult.stderr, /CREDENTIAL_GRAPH_GOOGLE/u);

  const r2Result = await runMutation((proposal) => {
    proposal.approval_request.requested_r2_s3_scope =
      "Create or rotate exactly one least-privilege R2 S3 credential";
  });
  assert.notEqual(r2Result.status, 0);
  assert.match(r2Result.stderr, /APPROVAL_SCOPE_PENDING/u);
});

test("blocked successor binds the owner-only receipt verifier across staged and resumed paths", async () => {
  const mutations = [
    [
      (proposal) => {
        proposal.exact_execution_graph.prequalification_database_bootstrap_policy.post_bootstrap_receipt_verifier.verifies_exact_operator_acl = false;
      },
      /PREQUALIFICATION_RECEIPT_VERIFIER/u,
    ],
    [
      (proposal) => {
        proposal.exact_execution_graph.prequalification_bridge_policy.receipt_gate.verifier_function =
          "readReceiptOnly";
      },
      /PREQUALIFICATION_RECEIPT_GATE/u,
    ],
    [
      (proposal) => {
        proposal.exact_execution_graph.prequalification_bridge_policy.executor_receipt_gate.restart_preflight.repeat_receipt_verifier = false;
      },
      /PREQUALIFICATION_EXECUTOR_RECEIPT_GATE/u,
    ],
    [
      (proposal) => {
        proposal.exact_execution_graph.prequalification_bridge_policy.operator_only_preflight.fresh_child_forbidden_database_inputs.pop();
      },
      /PREQUALIFICATION_FRESH_CHILD_SEAM/u,
    ],
  ];
  for (const [mutate, expected] of mutations) {
    const result = await runMutation(mutate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});
