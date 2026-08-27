import assert from "node:assert/strict";
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
  "user-approval.json",
  "approved-authority.json",
  "credential-rotation-normalization-execution-result.json",
  "validate-approved-authority.mjs",
];

async function runMutation(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "videoforge-v213-rotation-authority-"));
  try {
    const values = {};
    const originals = {};
    const rawFiles = {};
    for (const fileName of fileNames) {
      rawFiles[fileName] = await readFile(path.join(sourceDirectory, fileName));
      if (fileName.endsWith(".json")) {
        values[fileName] = JSON.parse(rawFiles[fileName]);
        originals[fileName] = JSON.parse(rawFiles[fileName]);
      } else values[fileName] = rawFiles[fileName].toString("utf8");
    }
    mutate(values);
    for (const fileName of fileNames) {
      const value = values[fileName];
      const unchanged =
        fileName.endsWith(".json") &&
        JSON.stringify(value) === JSON.stringify(originals[fileName]);
      await writeFile(
        path.join(directory, fileName),
        unchanged
          ? rawFiles[fileName]
          : typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2) + "\n",
      );
    }
    return spawnSync(process.execPath, [path.join(directory, "validate-approved-authority.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertRejected(result, code) {
  assert.notEqual(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout + "\n" + result.stderr, new RegExp(code, "u"));
}

test("rotation/normalization authority records exact completed single-use execution", async () => {
  const result = await runMutation(() => {});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "CONSUMED_COMPLETED_EXACT_GOOGLE_SECRET_ROTATION_AND_LOCAL_R2_NORMALIZATION");
  assert.equal(output.authority_id, "v2-13-credential-rotation-normalization-20260827-095717z-76f14ae2");
  assert.equal(output.proposal_sha256, "sha256:76f14ae25cff7840d0028be1ca0af87bbf325178d99a5ca2b80806aa3ddb2c73");
  assert.equal(output.approval_sha256, "sha256:94c1f9fb1c6f3fb42f4b957a2e1de7c91c2404cc299cd73c59e5a4ac8d1d80e6");
  assert.equal(output.consumed, true);
  assert.equal(output.provider_calls_made, null);
  assert.equal(output.provider_mutations_made, 2);
  assert.equal(output.credentials_accessed, true);
  assert.equal(output.runpod_calls, 0);
  assert.equal(output.gpu_hours, 0);
  assert.equal(output.external_spend_usd, 0);
});

test("rotation/normalization authority rejects approval, proposal, and consumption drift", async () => {
  assertRejected(
    await runMutation((values) => {
      values["user-approval.json"].approval.cloudflare_r2_mutation_authorized = true;
    }),
    "RAW_HASH",
  );
  assertRejected(
    await runMutation((values) => {
      values["combined-credential-rotation-normalization-proposal.json"].receipt.exact_field_count = 22;
    }),
    "RAW_HASH",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].status = "CONSUMED";
    }),
    "AUTHORITY_SCOPE",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].consumed = false;
    }),
    "AUTHORITY_SCOPE",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].lineage.user_approval_sha256 = "sha256:" + "0".repeat(64);
    }),
    "AUTHORITY_SCOPE",
  );
});

test("rotation/normalization authority rejects order, scope, raw-output, and provider drift", async () => {
  assertRejected(
    await runMutation((values) => {
      [
        values["approved-authority.json"].operation_allowlist.ordered_operation_ids[0],
        values["approved-authority.json"].operation_allowlist.ordered_operation_ids[1],
      ] = [
        values["approved-authority.json"].operation_allowlist.ordered_operation_ids[1],
        values["approved-authority.json"].operation_allowlist.ordered_operation_ids[0],
      ];
    }),
    "AUTHORITY_SCOPE",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].google_scope.raw_new_secret_stdout_authorized = true;
    }),
    "AUTHORITY_SCOPE",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].combined_execution_authority.runpod_calls_authorized = true;
    }),
    "AUTHORITY_SCOPE",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].provider_free_recording.credentials_accessed = false;
    }),
    "AUTHORITY_RECORDING",
  );
  assertRejected(
    await runMutation((values) => {
      delete values["approved-authority.json"].stop_and_cleanup.no_retry;
    }),
    "AUTHORITY_STOP",
  );
});
