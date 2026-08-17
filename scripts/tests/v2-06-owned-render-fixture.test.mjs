import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  canonicalHash,
  planFixture,
  verifyLocalFixture,
} from "../../deploy/v2-06/provision-owned-render-fixture.mjs";

const script = "deploy/v2-06/provision-owned-render-fixture.mjs";
const scope = {
  user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

test("V2-06 owned fixture uses canonical local owned slice and full bytes", async () => {
  const fixture = await verifyLocalFixture();
  assert.equal(fixture.evidence.provider_calls_authorized, false);
  assert.equal(fixture.evidence.external_spend_usd, 0);
  assert.equal(fixture.assets.length, 5);
  assert.ok(fixture.assets.every((asset) => asset.bytes.length > 0));
  assert.ok(fixture.output.bytes.length > 0);
});

test("V2-06 hosted plan rewrites IDs, hashes, and tenant object lineage", async () => {
  const fixture = await verifyLocalFixture();
  const plan = planFixture(fixture, scope, "2026-08-17T12:00:00Z");
  assert.match(plan.projectId, /^[0-9a-f-]{36}$/u);
  assert.match(plan.revisionId, /^[0-9a-f-]{36}$/u);
  assert.equal(plan.renderInput.project_revision_id, plan.revisionId);
  assert.equal(plan.rewrittenManifest.project_revision_id, plan.revisionId);
  assert.equal(plan.rewrittenManifest.revision_config_hash, plan.revisionConfigHash);
  assert.equal(plan.revisionConfigHash, canonicalHash(plan.revisionConfigBase));
  assert.equal(plan.submission.kind, "RENDER");
  assert.equal(plan.submission.input_document.schema_version, "render-job-input/v1");
  const prefix = "/project/" + plan.projectId + "/revision/" + plan.revisionId + "/lane/input/job/";
  assert.ok(plan.rows.every((row) => row.objectKey.includes(prefix)));
  assert.ok(
    plan.submission.objects.every((object) =>
      plan.rows.some(
        (row) => row.receiptId === object.artifact_receipt_id && row.uri === object.uri,
      ),
    ),
  );
  assert.ok(
    plan.rewrittenManifest.segments.every((segment) => {
      const values = Object.values(segment.accepted_assets ?? {}).flatMap((asset) => [
        asset.asset_id,
      ]);
      return values.every((value) => /^[0-9a-f-]{36}$/u.test(value));
    }),
  );
});

test("CLI defaults to dry-run and never prints credentials", () => {
  const result = spawnSync(process.execPath, [script, "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      V2_06_TENANT_EMAIL: "lakshmansai121@gmail.com",
      V2_06_SEED_AT: "2026-08-17T12:00:00Z",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /database_mutation=SKIPPED_DRY_RUN/u);
  assert.match(result.stdout, /r2_mutation=SKIPPED_DRY_RUN/u);
  assert.doesNotMatch(result.stdout, /DATABASE_URL|access.key|secret|token/iu);
});

test("live path remains fail-closed without all three confirmations", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /V2_06_RENDER_FIXTURE_CONFIRM/u);
  assert.match(source, /V2_06_RENDER_FIXTURE_R2_CONFIRM/u);
  assert.match(source, /V2_06_RENDER_FIXTURE_DB_CONFIRM/u);
  assert.doesNotMatch(source, /client\.delete\s*\(/u);
  assert.doesNotMatch(source, /DROP\s+TABLE|DELETE\s+FROM/iu);
  assert.doesNotMatch(source, /RUNPOD_API_KEY\s*[:=]|run\.googleapis\.com|CloudRunJobsClient/u);
});
