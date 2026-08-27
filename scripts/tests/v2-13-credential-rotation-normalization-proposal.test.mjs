import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDirectory = path.join(
  root,
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-rotation-normalization-candidate",
);
const fileNames = [
  "combined-credential-rotation-normalization-proposal.json",
  "validate-candidate.mjs",
];
const proposalHash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function runMutation(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "videoforge-v213-rotation-normalization-"));
  try {
    const values = {};
    const rawFiles = {};
    const originalProposal = JSON.parse(
      await readFile(path.join(sourceDirectory, fileNames[0]), "utf8"),
    );
    for (const fileName of fileNames) {
      rawFiles[fileName] = await readFile(path.join(sourceDirectory, fileName));
      values[fileName] = fileName.endsWith(".json")
        ? JSON.parse(rawFiles[fileName])
        : rawFiles[fileName].toString("utf8");
    }
    mutate(values);
    const proposalChanged =
      JSON.stringify(values[fileNames[0]]) !== JSON.stringify(originalProposal);
    let validatorText = values[fileNames[1]];
    const proposalBytes = proposalChanged
      ? Buffer.from(`${JSON.stringify(values[fileNames[0]], null, 2)}\n`)
      : rawFiles[fileNames[0]];
    if (proposalChanged) {
      validatorText = validatorText.replace(
        /const proposalSha256 = "sha256:[0-9a-f]{64}";/u,
        `const proposalSha256 = "${proposalHash(proposalBytes)}";`,
      );
    }
    await writeFile(path.join(directory, fileNames[0]), proposalBytes);
    await writeFile(path.join(directory, fileNames[1]), validatorText);
    return spawnSync(process.execPath, [path.join(directory, fileNames[1])], {
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

test("rotation/normalization proposal is sealed, narrow, and provider-free", async () => {
  const result = await runMutation(() => {});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL");
  assert.equal(
    output.proposal_sha256,
    "sha256:76f14ae25cff7840d0028be1ca0af87bbf325178d99a5ca2b80806aa3ddb2c73",
  );
  assert.equal(
    output.prior_authority_id,
    "v2-13-credential-bootstrap-reuse-20260827-082652z-90d6b19d",
  );
  assert.equal(output.prior_authority_reusable, false);
  assert.equal(output.provider_calls_made_during_drafting, 0);
  assert.equal(output.provider_mutations_made_during_drafting, 0);
  assert.equal(output.credential_values_accessed_during_drafting, false);
  assert.equal(output.runpod_calls_during_drafting, 0);
  assert.equal(output.gpu_hours_during_drafting, 0);
  assert.equal(output.external_spend_usd_during_drafting, 0);
});

test("rotation/normalization proposal rejects scope, ordering, and approval drift", async () => {
  assertRejected(
    await runMutation((values) => {
      values[
        "combined-credential-rotation-normalization-proposal.json"
      ].authority.google_secret_rotation_authorized = true;
    }),
    "AUTHORITY_google_secret_rotation_authorized",
  );
  assertRejected(
    await runMutation((values) => {
      values[
        "combined-credential-rotation-normalization-proposal.json"
      ].exact_execution_graph.operations.reverse();
    }),
    "GRAPH_ORDER",
  );
  assertRejected(
    await runMutation((values) => {
      values[
        "combined-credential-rotation-normalization-proposal.json"
      ].requested_scope.google.raw_new_secret_stdout_authorized = true;
    }),
    "GOOGLE_raw_new_secret_stdout_authorized",
  );
  assertRejected(
    await runMutation((values) => {
      values[
        "combined-credential-rotation-normalization-proposal.json"
      ].requested_scope.local_protected_storage.r2_provider_mutation_authorized = true;
    }),
    "STORAGE_R2_PROVIDER",
  );
  assertRejected(
    await runMutation((values) => {
      values[
        "combined-credential-rotation-normalization-proposal.json"
      ].approval_request.requested_exact_action = "Approve one single-use execution.";
    }),
    "APPROVAL_TEXT_exact existing Google project",
  );
});

test("rotation/normalization proposal rejects receipt and source drift", async () => {
  assertRejected(
    await runMutation((values) => {
      values["combined-credential-rotation-normalization-proposal.json"].receipt.exact_fields.pop();
    }),
    "RECEIPT_FIELDS",
  );
  assertRejected(
    await runMutation((values) => {
      values[
        "combined-credential-rotation-normalization-proposal.json"
      ].source.source_contract_hashes["apps/web/src/server/hosted/auth.ts"] =
        `sha256:${"0".repeat(64)}`;
    }),
    "SOURCE_BINDING_apps/web/src/server/hosted/auth.ts",
  );
  assertRejected(
    await runMutation((values) => {
      values["combined-credential-rotation-normalization-proposal.json"].stop_conditions.no_retry =
        false;
    }),
    "STOP_no_retry",
  );
});
