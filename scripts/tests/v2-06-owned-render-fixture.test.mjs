import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMITTED_MIGRATIONS,
  AUTHORITY_METADATA,
  MAX_R2_AGGREGATE_BYTES,
  MAX_R2_OBJECT_BYTES,
  MAX_R2_OBJECT_COUNT,
  assertProviderConfig,
  assertApprovedSourceLocation,
  assertMigrationLedgerRows,
  assertR2PlanCaps,
  buildR2FailureReceipt,
  buildR2UploadIntent,
  canonicalHash,
  ensureR2FailureReceipt,
  uploadR2RowsWithReconciliation,
  planFixture,
  ensureR2,
  r2Request,
  verifyLocalFixture,
} from "../../deploy/v2-06/provision-owned-render-fixture.mjs";

const script = "deploy/v2-06/provision-owned-render-fixture.mjs";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = resolve(repositoryRoot, "artifacts/local-media");
const requiredFixtureFiles = [
  "runs/revision_local_owned_001/attempt_render_local_004/render-input.json",
  "runs/revision_local_owned_001/attempt_render_local_004/acceptance-evidence.json",
];
const missingFixtureFiles = requiredFixtureFiles.filter(
  (relativePath) => !existsSync(resolve(fixtureRoot, relativePath)),
);
const fixtureSkipReason = missingFixtureFiles.length
  ? `private ignored artifacts/local-media render fixture is absent; missing ${missingFixtureFiles.join(", ")}`
  : false;
const fixtureTestOptions = { skip: fixtureSkipReason };
const scope = {
  user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

function fixture(name, fn) {
  return test(name, fixtureTestOptions, fn);
}

fixture("V2-06 owned fixture uses canonical local owned slice and full bytes", async () => {
  const fixture = await verifyLocalFixture();
  assert.equal(fixture.evidence.provider_calls_authorized, false);
  assert.equal(fixture.evidence.external_spend_usd, 0);
  assert.equal(fixture.assets.length, 5);
  assert.ok(fixture.assets.every((asset) => asset.bytes.length > 0));
  assert.ok(fixture.output.bytes.length > 0);
});

fixture("V2-06 hosted plan rewrites IDs, hashes, and tenant object lineage", async () => {
  const fixture = await verifyLocalFixture();
  const plan = planFixture(fixture, scope, "2026-08-17T12:00:00Z");
  assert.match(plan.projectId, /^[0-9a-f-]{36}$/u);
  assert.match(plan.revisionId, /^[0-9a-f-]{36}$/u);
  assert.equal(plan.renderInput.project_revision_id, plan.revisionId);
  assert.equal(plan.rewrittenManifest.project_revision_id, plan.revisionId);
  assert.equal(plan.rewrittenManifest.revision_config_hash, plan.revisionConfigHash);
  assert.equal(plan.revisionConfigHash, canonicalHash(plan.revisionConfigBase));
  assert.equal(plan.revisionConfigPayload.maximum_cost_micro_usd, 100_000);
  assert.equal(plan.submission.kind, "RENDER");
  assert.match(plan.submission.idempotency_key, /^v2-06-owned-render-fixture-v5-/u);
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

fixture("CLI defaults to dry-run and never prints credentials", () => {
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

test("R2 requests forward the complete aws4fetch-signed Request", async () => {
  let observed;
  const client = {
    async sign(url, options) {
      return {
        url,
        method: options.method,
        headers: new Headers({
          ...options.headers,
          authorization: "AWS4-HMAC-SHA256 signed-test",
          "x-amz-date": "20260817T120000Z",
        }),
      };
    },
  };
  await r2Request(
    client,
    "https://example.invalid/object",
    "PUT",
    { "x-amz-checksum-sha256": "checksum", "content-type": "application/json" },
    Buffer.from("fixture"),
    async (signedRequest) => {
      observed = signedRequest;
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(observed.method, "PUT");
  assert.equal(observed.headers.get("authorization"), "AWS4-HMAC-SHA256 signed-test");
  assert.equal(observed.headers.get("x-amz-date"), "20260817T120000Z");
  assert.equal(observed.headers.get("x-amz-checksum-sha256"), "checksum");
  assert.equal(observed.headers.get("content-type"), "application/json");
});

test("live provider config is pinned to the approved staging resources", () => {
  assertProviderConfig(
    "postgresql://neondb_owner:placeholder@ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    {
      accountId: "f9254d773a3426fcb469451b1f965d8c",
      bucket: "videoforge-v2-06-staging-private",
      region: "auto",
      accessKeyId: "placeholder",
      secretAccessKey: "placeholder",
    },
  );
  assert.throws(
    () =>
      assertProviderConfig(
        "postgresql://neondb_owner:placeholder@other.neon.tech/neondb?sslmode=require&channel_binding=require",
        {
          accountId: "f9254d773a3426fcb469451b1f965d8c",
          bucket: "videoforge-v2-06-staging-private",
          region: "auto",
        },
      ),
    /approved V2-06 Neon project/u,
  );
});

fixture("source path, current migration chain, and activation caps are hard-pinned", async () => {
  assert.doesNotThrow(() => assertApprovedSourceLocation(fixtureRoot, "attempt_render_local_004"));
  assert.throws(
    () =>
      assertApprovedSourceLocation(
        resolve(fixtureRoot, "..", "attacker-owned-media"),
        "attempt_render_local_004",
      ),
    /exact approved pinned V2-06 owned local-slice path/u,
  );
  assert.equal(COMMITTED_MIGRATIONS.length, 61);
  assert.equal(COMMITTED_MIGRATIONS.at(-1)?.version, 61);
  assert.equal(
    COMMITTED_MIGRATIONS.at(-1)?.filename,
    "0061_hosted_voiceover_context_reconciliation.sql",
  );
  assertMigrationLedgerRows(COMMITTED_MIGRATIONS);
  const fixture = await verifyLocalFixture();
  const plan = planFixture(fixture, scope, "2026-08-17T12:00:00Z");
  assert.equal(plan.r2Budget.object_count, MAX_R2_OBJECT_COUNT);
  assert.ok(plan.r2Budget.aggregate_bytes <= MAX_R2_AGGREGATE_BYTES);
  assert.ok(plan.rows.every((row) => row.bytes.length <= MAX_R2_OBJECT_BYTES));
  assert.equal(plan.authority.finite_action_spend_cap_usd, 1);
  assert.equal(plan.authority.expected_external_spend_usd, 0);
  assert.equal(plan.authority.gpu_transport, AUTHORITY_METADATA.gpu_transport);
  assert.throws(() => assertR2PlanCaps(plan.rows.slice(0, -1)), /object count exceeds/u);
  assert.throws(
    () =>
      assertR2PlanCaps([
        ...plan.rows.slice(0, -1),
        { ...plan.rows.at(-1), bytes: Buffer.alloc(MAX_R2_OBJECT_BYTES + 1) },
      ]),
    /per-object byte cap/u,
  );
});

test("owned render activation uses only the narrow render-plan append function", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /public\.videoforge_append_hosted_render_plan\(/u);
  assert.doesNotMatch(source, /INSERT INTO hosted_render_plans\b/iu);
});

test("R2 conditional create is race-safe and exact after a concurrent winner", async () => {
  let calls = 0;
  const client = {
    async sign(url, options) {
      calls += 1;
      return new Request(url, {
        method: options.method,
        headers: options.headers,
        body: options.method === "PUT" ? options.body : undefined,
      });
    },
  };
  const row = {
    name: "race",
    objectKey: "tenant/b/workspace/c/project/p/revision/r/lane/input/job/j/artifact/race",
    bytes: Buffer.from("fixture"),
    contentType: "application/octet-stream",
    digest: "sha256:bef57ec7f53a6d40beb640a7803b8a8f5a9a3d8f9e8f1f2b2f0f5e3f4d7e3d4f",
  };
  row.digest =
    "sha256:" + (await import("node:crypto")).createHash("sha256").update(row.bytes).digest("hex");
  let first = true;
  let putHeaders;
  const response = async (request) => {
    if (request.method === "HEAD")
      return new Response(null, {
        status: first ? 404 : 200,
        headers: first ? {} : { "content-length": "7", "content-type": row.contentType },
      });
    if (request.method === "PUT" && first) {
      putHeaders = request.headers;
      first = false;
      return new Response(null, { status: 412 });
    }
    return new Response(row.bytes, {
      status: 200,
      headers: { "content-length": "7", "content-type": row.contentType },
    });
  };
  const state = await ensureR2(
    client,
    { accountId: "a", bucket: "b", region: "auto" },
    row,
    response,
  );
  assert.equal(state, "REUSED_EXACT_RACE");
  assert.equal(putHeaders?.get("if-none-match"), "*");
  assert.equal(calls, 4);
});

fixture(
  "R2 partial failure records an immutable reconcile receipt without automatic deletion",
  async () => {
    const fixture = await verifyLocalFixture();
    const plan = planFixture(fixture, scope, "2026-08-17T12:00:00Z");
    plan.sourceRenderInputSha256 = fixture.inputHash;
    plan.sourceEvidenceSha256 = fixture.evidenceHash;
    const intent = buildR2UploadIntent(plan);
    const expected = buildR2FailureReceipt(plan, intent);
    const queries = [];
    const client = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.startsWith("SELECT workspace_id::text AS workspace_id")) {
          return {
            rows: [
              {
                workspace_id: plan.scope.workspace_id,
                idempotency_key: expected.idempotencyKey,
                operation: expected.operation,
                input_hash: expected.inputHash,
                result_codec: "repository-result/v1",
                result_payload: expected.resultPayload,
                result_hash: expected.resultHash,
                created_at: plan.seedAt,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const recorded = await ensureR2FailureReceipt(client, plan, intent);
    assert.equal(recorded.idempotencyKey, expected.idempotencyKey);
    assert.equal(recorded.resultPayload.status, "R2_UPLOAD_FAILED");
    assert.equal(recorded.resultPayload.cleanup.automatic_delete, false);
    assert.equal(recorded.resultPayload.cleanup.required, true);
    assert.equal(recorded.resultPayload.r2_objects.length, MAX_R2_OBJECT_COUNT);
    assert.ok(recorded.resultPayload.r2_objects.every((row) => row.state === "RECONCILE_REQUIRED"));
    assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO repository_mutation_receipts")));
    assert.ok(queries.some(({ sql }) => sql === "COMMIT"));
  },
);

fixture(
  "R2 upload orchestration fences a partial failure through the real catch path",
  async () => {
    const fixture = await verifyLocalFixture();
    const plan = planFixture(fixture, scope, "2026-08-17T12:00:00Z");
    plan.sourceRenderInputSha256 = fixture.inputHash;
    plan.sourceEvidenceSha256 = fixture.evidenceHash;
    const intent = buildR2UploadIntent(plan);
    const expected = buildR2FailureReceipt(plan, intent);
    const queries = [];
    const client = {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.startsWith("SELECT workspace_id::text AS workspace_id")) {
          return {
            rows: [
              {
                workspace_id: plan.scope.workspace_id,
                idempotency_key: expected.idempotencyKey,
                operation: expected.operation,
                input_hash: expected.inputHash,
                result_codec: "repository-result/v1",
                result_payload: expected.resultPayload,
                result_hash: expected.resultHash,
                created_at: plan.seedAt,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    let uploads = 0;
    await assert.rejects(
      () =>
        uploadR2RowsWithReconciliation({
          client,
          plan,
          intent,
          upload: async () => {
            uploads += 1;
            if (uploads === 2) throw new Error("injected R2 failure");
            return { state: "CREATED" };
          },
        }),
      /immutable failure receipt/u,
    );
    assert.equal(uploads, 2);
    assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO repository_mutation_receipts")));
    assert.ok(queries.some(({ sql }) => sql === "COMMIT"));
  },
);

test("live fixture supports protected libpq and Wrangler without new credential material", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /V2_06_RENDER_FIXTURE_USE_PG_SERVICE/u);
  assert.match(source, /V2_06_RENDER_FIXTURE_USE_WRANGLER/u);
  assert.match(source, /requireControlPlane\("pg"\)/u);
  assert.match(source, /"wrangler", \.\.\.args/u);
  assert.match(source, /'LOWEST_COST',\$20,'USD',\$21/u);
  assert.doesNotMatch(
    source.match(/async function ensureWranglerR2[\s\S]*?\n\}\n/u)?.[0] ?? "",
    /object", "delete/u,
  );
});

fixture("live fixture accepts canonical PostgreSQL UUIDs without RFC variant bits", async () => {
  const fixture = await verifyLocalFixture();
  assert.doesNotThrow(() =>
    planFixture(
      fixture,
      {
        user_id: "14a1d166-e15e-e923-6032-1c0910dc0c9d",
        account_id: "38ae8aaf-09d8-bdab-7436-385eb2fcb7ac",
        workspace_id: "78c40d01-f7af-bae1-1922-6b458da10625",
      },
      "2026-08-19T03:42:00Z",
    ),
  );
});
