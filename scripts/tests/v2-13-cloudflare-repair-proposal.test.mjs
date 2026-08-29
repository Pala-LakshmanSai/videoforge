import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const historicalRecordCommit = "1ba62090c763cb4993cd5f9806e63c6629be1997";
const factsPath = "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json";
const candidatePath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate";

function historicalBytes(relativePath) {
  const result = spawnSync("git", ["show", `${historicalRecordCommit}:${relativePath}`], {
    cwd: root,
    encoding: "buffer",
  });
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result.stdout;
}

async function runMutation(mutateProposal, mutatePreflight = () => {}) {
  const directory = await mkdtemp(
    path.join(path.dirname(sourceDirectory), ".tmp-cloudflare-proposal-"),
  );
  try {
    const proposal = JSON.parse(
      historicalBytes(`${candidatePath}/combined-live-proposal.json`).toString("utf8"),
    );
    const preflight = JSON.parse(
      historicalBytes(`${candidatePath}/read-only-preflight.json`).toString("utf8"),
    );
    mutateProposal(proposal);
    mutatePreflight(preflight);
    await writeFile(
      path.join(directory, "combined-live-proposal.json"),
      `${JSON.stringify(proposal, null, 2)}\n`,
    );
    const validator = (await readFile(path.join(sourceDirectory, validatorName), "utf8")).replace(
      'const FACTS_PATH = path.join(ROOT, "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json");',
      'const FACTS_PATH = path.join(DIRECTORY, "materialization-seed-facts.json");',
    );
    await writeFile(path.join(directory, validatorName), validator);
    await writeFile(
      path.join(directory, "source-readiness-audit.json"),
      historicalBytes(`${candidatePath}/source-readiness-audit.json`),
    );
    await writeFile(
      path.join(directory, "materialization-seed-facts.json"),
      historicalBytes(factsPath),
    );
    await writeFile(
      path.join(directory, "read-only-preflight.json"),
      `${JSON.stringify(preflight, null, 2)}\n`,
    );
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

  const readerResult = await runMutation((proposal) => {
    proposal.exact_execution_graph.cloudflare_credential_origin_policy.oauth_authentication.protected_config_reader =
      "readWranglerOAuthToken";
  });
  assert.notEqual(readerResult.status, 0);
  assert.match(readerResult.stderr, /CLOUDFLARE_GRAPH/u);
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
  assert.match(result.stderr, /SUPERSESSION_/u);
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
  assert.match(r2Result.stderr, /APPROVAL_SCOPE_BOUND/u);
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

test("blocked successor cross-binds both exact retained volume hashes to read-only evidence", async () => {
  const soulxProposalResult = await runMutation((proposal) => {
    proposal.requested_scope.retention.soulx_volume_id_sha256 =
      "sha256:2a8633e14bbec54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
  });
  assert.notEqual(soulxProposalResult.status, 0);
  assert.match(soulxProposalResult.stderr, /RETENTION_SCOPE/u);

  const mageProposalResult = await runMutation((proposal) => {
    proposal.requested_scope.retention.mage_volume_id_sha256 =
      "sha256:0ae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
  });
  assert.notEqual(mageProposalResult.status, 0);
  assert.match(mageProposalResult.stderr, /RETENTION_SCOPE/u);

  const soulxPreflightResult = await runMutation(
    () => {},
    (preflight) => {
      preflight.runpod.retained_volumes[0].id_sha256 =
        "sha256:2a8633e14bbec54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
    },
  );
  assert.notEqual(soulxPreflightResult.status, 0);
  assert.match(soulxPreflightResult.stderr, /READ_ONLY_PREFLIGHT_RUNPOD/u);

  const magePreflightResult = await runMutation(
    () => {},
    (preflight) => {
      preflight.runpod.retained_volumes[1].id_sha256 =
        "sha256:0ae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
    },
  );
  assert.notEqual(magePreflightResult.status, 0);
  assert.match(magePreflightResult.stderr, /READ_ONLY_PREFLIGHT_RUNPOD/u);

  const swappedPreflightResult = await runMutation(
    () => {},
    (preflight) => {
      preflight.runpod.retained_volumes.reverse();
    },
  );
  assert.notEqual(swappedPreflightResult.status, 0);
  assert.match(swappedPreflightResult.stderr, /READ_ONLY_PREFLIGHT_RUNPOD/u);
});
