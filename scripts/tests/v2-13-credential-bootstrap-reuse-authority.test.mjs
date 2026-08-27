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
const fileNames = [
  "combined-credential-bootstrap-reuse-proposal.json",
  "user-approval.json",
  "approved-authority.json",
  "validate-approved-authority.mjs",
];

async function runMutation(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "videoforge-v213-reuse-authority-"));
  try {
    const values = {};
    const rawFiles = {};
    const originalValues = {};
    for (const fileName of fileNames) {
      rawFiles[fileName] = await readFile(path.join(sourceDirectory, fileName));
      if (fileName.endsWith(".json")) {
        values[fileName] = JSON.parse(rawFiles[fileName]);
        originalValues[fileName] = JSON.parse(rawFiles[fileName]);
      } else values[fileName] = rawFiles[fileName].toString("utf8");
    }
    mutate(values);
    for (const fileName of fileNames) {
      const value = values[fileName];
      const bytes =
        fileName.endsWith(".json") &&
        JSON.stringify(value) === JSON.stringify(originalValues[fileName])
          ? rawFiles[fileName]
          : typeof value === "string"
            ? value
            : `${JSON.stringify(value, null, 2)}\n`;
      await writeFile(
        path.join(directory, fileName),
        bytes,
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
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(code, "u"));
}

test("reuse authority post-execution stop record is exact and non-reusable", async () => {
  const result = await runMutation(() => {});
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "CONSUMED_STOPPED_AFTER_RESOURCE_CREATION_REQUIRES_FRESH_ROTATION_AUTHORITY");
  assert.equal(output.authority_id, "v2-13-credential-bootstrap-reuse-20260827-082652z-90d6b19d");
  assert.equal(output.proposal_sha256, "sha256:90d6b19d6935ded1bfebdb6df53c64ea33edeba4dce750fe3a81b93708228ed4");
  assert.equal(output.consumed, true);
  assert.equal(output.credentials_accessed, true);
  assert.equal(output.provider_calls_made, null);
  assert.equal(output.provider_mutations_made, 4);
  assert.equal(output.runpod_calls, 0);
  assert.equal(output.gpu_hours, 0);
  assert.equal(output.external_spend_usd, 0);
  assert.equal(output.observed_preapproval_provider_mutations, 1);
});

test("reuse authority preserves exact initial and rejects consumption drift", async () => {
  const result = await runMutation((values) => {
    const authority = values["approved-authority.json"];
    authority.status = "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS";
    authority.consumed = false;
    authority.consumed_at = null;
    delete authority.execution_recording;
    Object.assign(authority.provider_free_recording, {
      credentials_accessed: false,
      authorized_execution_provider_calls: 0,
      authorized_execution_provider_mutations: 0,
      authority_consumed: false,
      execution_started: false,
      consumption_record_created: false,
      consumption_record_sha256: null,
    });
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS");
  assert.equal(output.consumed, false);
  assert.equal(output.credentials_accessed, false);
  assert.equal(output.provider_calls_made, 0);
  assert.equal(output.provider_mutations_made, 0);

  assertRejected(
    await runMutation((values) => {
      values["user-approval.json"].approval.google.project_id = "another-project";
    }),
    "APPROVAL_GOOGLE_IDENTITY",
  );
  assertRejected(
    await runMutation((values) => {
      values["user-approval.json"].approval.maximum_external_spend_usd = 1;
    }),
    "APPROVAL_ZERO_maximum_external_spend_usd",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].consumed_at = null;
    }),
    "AUTHORITY_IDENTITY",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].lineage.user_approval_sha256 = `sha256:${"0".repeat(64)}`;
    }),
    "AUTHORITY_LINEAGE",
  );
});

test("reuse authority rejects post-execution recording drift", async () => {
  assertRejected(
    await runMutation((values) => {
      delete values["approved-authority.json"].execution_recording;
    }),
    "AUTHORITY_KEYS",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].execution_recording.sha256 = `sha256:${"0".repeat(64)}`;
    }),
    "AUTHORITY_EXECUTION_RECORDING",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].provider_free_recording.authorized_execution_provider_mutations = 0;
    }),
    "AUTHORITY_RECORDING_POST",
  );
});

test("reuse authority rejects scope, order, and provider-spend drift", async () => {
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].combined_execution_authority.runpod_calls_authorized = true;
    }),
    "AUTHORITY_EXECUTION_runpod_calls_authorized",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].combined_execution_authority.maximum_gpu_hours = 1;
    }),
    "AUTHORITY_ZERO_maximum_gpu_hours",
  );
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
    "AUTHORITY_OPERATION_ORDER",
  );
  assertRejected(
    await runMutation((values) => {
      values["approved-authority.json"].cloudflare_r2_scope.bucket_name = "other-bucket";
    }),
    "AUTHORITY_R2_PROJECTION",
  );
});
