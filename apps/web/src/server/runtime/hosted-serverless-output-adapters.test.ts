// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  MIGRATION_MANIFEST,
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  applyMigrations,
  canonicalSha256,
  type Sha256,
  type SqlPrimitive,
  type SqlQueryResult,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import type { HostedR2BucketBinding } from "../hosted/configuration.js";
import {
  HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS,
  HostedR2OutputArtifactBarrier,
  HostedSqlOutputBarrierRepository,
} from "./hosted-serverless-output-adapters.js";
import type {
  HostedLaneCompletionRecord,
  HostedServerlessAttemptBinding,
} from "./hosted-serverless-output-barrier.js";
import { hostedOutputBindingSha256 } from "./hosted-serverless-output-barrier.js";

const sha = (label: string): Sha256 => canonicalSha256({ label });
const receiptSigner = new ProvenanceReceiptSigner("adapter-test", Buffer.alloc(32, 8));
const artifactBytes = new Uint8Array(31);
const artifactSha256 =
  `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}` as Sha256;

type Handler = (
  sql: string,
  parameters: readonly SqlPrimitive[],
) => Promise<SqlQueryResult<Record<string, unknown>>>;

function database(handler: Handler, queries: string[] = []): TransactionalSqlExecutor {
  const executor: TransactionalSqlExecutor = {
    async execute() {},
    async query<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly SqlPrimitive[] = [],
    ): Promise<SqlQueryResult<Row>> {
      queries.push(sql);
      return (await handler(sql, parameters)) as SqlQueryResult<Row>;
    },
    async transaction<Value>(work: (transaction: TransactionalSqlExecutor) => Promise<Value>) {
      return work(executor);
    },
  };
  return executor;
}

const scope = Object.freeze({ accountId: "account-a", workspaceId: "workspace-a" });

function completion(
  overrides: Partial<HostedLaneCompletionRecord> = {},
): HostedLaneCompletionRecord {
  return Object.freeze({
    attemptId: "attempt-a",
    bindingSha256: sha("binding"),
    callbackSha256: sha("callback"),
    provenanceReceiptSha256: sha("provenance"),
    artifactCommitReceiptSha256s: Object.freeze([sha("commit")]),
    completedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  });
}

function sqlRepositoryFixture(
  columns: readonly string[] = HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS,
  provenanceReadbackOverrides: Readonly<Record<string, unknown>> = {},
) {
  let stored: Record<string, unknown> | null = null;
  let persistedProvenance: Record<string, unknown> | null = null;
  const nonces = [1, "2"];
  const queries: string[] = [];
  const provenanceInsertParameters: SqlPrimitive[][] = [];
  const db = database(async (sql, parameters) => {
    if (sql.includes("set_config")) return { rows: [], affectedRows: 1 };
    if (sql.includes("WITH target AS")) {
      return {
        rows: [{ ready: columns.length === HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS.length }],
        affectedRows: 1,
      };
    }
    if (sql.includes("serverless_provenance_receipts")) {
      if (sql.includes("INSERT INTO")) {
        provenanceInsertParameters.push([...parameters]);
        persistedProvenance ??= {
          receipt_sha256: parameters[0],
          receipt_nonce: parameters[6],
          peak_vram_bytes: parameters[14],
          scratch_removed: parameters[22],
          scratch_on_model_volume: parameters[23],
        };
        return { rows: [], affectedRows: 1 };
      }
      if (sql.includes("receipt_nonce =")) {
        return {
          rows: persistedProvenance
            ? [{ ...persistedProvenance, ...provenanceReadbackOverrides }]
            : [],
          affectedRows: 1,
        };
      }
      return {
        rows: nonces.map((receipt_nonce) => ({ receipt_nonce })),
        affectedRows: nonces.length,
      };
    }
    if (sql.includes("FROM serverless_provider_assignments")) {
      return { rows: [{ id: "assignment-a" }], affectedRows: 1 };
    }
    if (sql.includes("INSERT INTO hosted_serverless_output_barrier_completions")) {
      const inserted = stored === null;
      stored ??= {
        attempt_id: parameters[2],
        binding_sha256: parameters[3],
        callback_sha256: parameters[4],
        provenance_receipt_sha256: parameters[6],
        artifact_commit_receipt_sha256s: JSON.parse(String(parameters[7])) as unknown,
        completed_at: parameters[8],
      };
      return {
        rows: inserted ? [{ attempt_id: parameters[2] }] : [],
        affectedRows: inserted ? 1 : 0,
      };
    }
    if (sql.includes("FROM hosted_serverless_output_barrier_completions")) {
      return { rows: stored ? [stored] : [], affectedRows: stored ? 1 : 0 };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }, queries);
  return {
    repository: new HostedSqlOutputBarrierRepository(db, scope),
    queries,
    provenanceInsertParameters,
  };
}

function binding(): HostedServerlessAttemptBinding {
  return Object.freeze({
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    projectId: "project-a",
    projectRevisionId: "revision-a",
    lane: "mage_image",
    attemptId: "attempt-a",
    providerJobId: "provider-job-a",
    dispatchTokenSha256: sha("dispatch"),
    envelopeSha256: sha("envelope"),
    requestSha256: sha("request"),
    deploymentId: "deployment-a",
    endpointIdSha256: sha("endpoint"),
    endpointConfigSha256: sha("config"),
    workerImageDigest: sha("image"),
    modelManifestSha256: sha("model"),
    volumeIdSha256: sha("volume"),
    volumeManifestSha256: sha("volume-manifest"),
    expectedObjects: Object.freeze([
      Object.freeze({
        itemId: "scene-a",
        objectKey:
          "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/" +
          "lane/mage-image/job/attempt-a/artifact/scene-a.png",
        contentType: "image/png",
        contentLength: 31,
        checksumSha256: artifactSha256,
      }),
    ]),
  });
}

function receiptFor(bound: HostedServerlessAttemptBinding) {
  return receiptSigner.sign({
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: "adapter-receipt",
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: "adapter-token",
    envelope_sha256: bound.envelopeSha256,
    request_sha256: bound.requestSha256,
    attempt_id: bound.attemptId,
    provider_job_id: bound.providerJobId,
    worker_id: "worker-a",
    tenant: { account_id: bound.accountId, workspace_id: bound.workspaceId },
    lane: bound.lane,
    deployment: {
      deployment_id: bound.deploymentId,
      endpoint_id_sha256: bound.endpointIdSha256,
      container_digest: bound.workerImageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: bound.volumeIdSha256,
      model_manifest_sha256: bound.modelManifestSha256,
    },
    runtime_probe: {
      gpu_name: "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      total_vram_bytes: 24 * 1024 ** 3,
      peak_vram_bytes: 12 * 1024 ** 3,
      gpu_uuid_sha256: sha("gpu"),
      driver_version: "550.90.07",
      cuda_version: "12.4",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: bound.volumeManifestSha256,
      manifest_sha256_after: bound.volumeManifestSha256,
      mutation_detected: false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: sha("warmup"),
    },
    timings: { total_ms: 1 },
    items: bound.expectedObjects.map((item) => ({
      item_id: item.itemId,
      state: "SUCCEEDED",
      output_object_key: item.objectKey,
      output_sha256: item.checksumSha256,
      output_bytes: item.contentLength,
      probe: {},
    })),
    scratch_cleanup: { terminal_reason: "SUCCESS", removed: true, scratch_on_model_volume: false },
    receipt_nonce: 1,
    issued_at: "2026-08-25T10:00:00.000Z",
  });
}

function checksumBytes(value: Sha256): ArrayBuffer {
  const hex = value.slice("sha256:".length);
  return Uint8Array.from(hex.match(/.{2}/gu)!.map((byte) => Number.parseInt(byte, 16))).buffer;
}

function bucketFor(
  bound: HostedServerlessAttemptBinding,
  drift: "NONE" | "SIZE" | "MISSING" | "BYTES" = "NONE",
) {
  const heads: string[] = [];
  const gets: string[] = [];
  const bucket: HostedR2BucketBinding = {
    async head(key) {
      heads.push(key);
      if (drift === "MISSING") return null;
      const expected = bound.expectedObjects[0]!;
      return {
        size: drift === "SIZE" ? expected.contentLength + 1 : expected.contentLength,
        httpMetadata: { contentType: expected.contentType },
        checksums: { sha256: checksumBytes(expected.checksumSha256) },
      };
    },
    async get(key) {
      gets.push(key);
      const expected = bound.expectedObjects[0]!;
      const bytes = drift === "BYTES" ? new Uint8Array(31).fill(1) : artifactBytes;
      return {
        size: expected.contentLength,
        httpMetadata: { contentType: expected.contentType },
        async arrayBuffer() {
          return bytes.buffer;
        },
      };
    },
    async put() {},
    async list() {
      return { objects: [], truncated: false };
    },
    async delete() {},
  };
  return { bucket, heads, gets };
}

function artifactDatabase(
  bound: HostedServerlessAttemptBinding,
  rows: "EXACT" | "MISSING" | "AMBIGUOUS" = "EXACT",
  parametersSeen: readonly SqlPrimitive[][] = [],
) {
  const expected = bound.expectedObjects[0]!;
  const row = {
    receipt_sha256: sha("artifact-commit"),
    object_key: expected.objectKey,
    content_type: expected.contentType,
    content_length: String(expected.contentLength),
    checksum_sha256: expected.checksumSha256,
    artifact_id: expected.itemId,
  };
  return database(async (sql, parameters) => {
    (parametersSeen as SqlPrimitive[][]).push([...parameters]);
    if (sql.includes("set_config")) return { rows: [], affectedRows: 1 };
    if (sql.includes("FROM artifact_receipts")) {
      const resultRows = rows === "MISSING" ? [] : rows === "AMBIGUOUS" ? [row, row] : [row];
      return { rows: resultRows, affectedRows: resultRows.length };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

describe("hosted ordinary-output SQL adapter", () => {
  it("attests the exact migrated catalog contract", async () => {
    const pglite = new PGlite();
    const executor: TransactionalSqlExecutor = {
      async execute(sql) {
        await pglite.exec(sql);
      },
      async query<Row extends Record<string, unknown>>(sql: string, parameters = []) {
        const result = await pglite.query<Row>(sql, [...parameters]);
        return { rows: result.rows, affectedRows: result.affectedRows ?? 0 };
      },
      async transaction<Value>(work: (transaction: TransactionalSqlExecutor) => Promise<Value>) {
        return pglite.transaction(async (transaction) =>
          work({
            async execute(sql) {
              await transaction.exec(sql);
            },
            async query<Row extends Record<string, unknown>>(sql: string, parameters = []) {
              const result = await transaction.query<Row>(sql, [...parameters]);
              return { rows: result.rows, affectedRows: result.affectedRows ?? 0 };
            },
            async transaction() {
              throw new Error("nested transaction is not used");
            },
          }),
        );
      },
    };
    try {
      const sources = await Promise.all(
        MIGRATION_MANIFEST.map(async (entry) => ({
          ...entry,
          sql: await readFile(
            new URL(
              `../../../../../packages/control-plane/migrations/${entry.filename}`,
              import.meta.url,
            ),
            "utf8",
          ),
        })),
      );
      await applyMigrations(executor, sources);
      await expect(
        new HostedSqlOutputBarrierRepository(executor, scope).schemaReady(),
      ).resolves.toBe(true);
    } finally {
      await pglite.close();
    }
  });

  it("reports the current supplemental schema requirement fail closed", async () => {
    const ready = sqlRepositoryFixture();
    const missing = sqlRepositoryFixture(HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS.slice(0, -1));
    await expect(ready.repository.schemaReady()).resolves.toBe(true);
    await expect(missing.repository.schemaReady()).resolves.toBe(false);
  });

  it("atomically inserts once and returns the winner for exact replay or conflict comparison", async () => {
    const fixture = sqlRepositoryFixture();
    await fixture.repository.schemaReady();
    const bound = binding();
    const receipt = receiptFor(bound);
    const first = completion({
      bindingSha256: hostedOutputBindingSha256(bound),
      provenanceReceiptSha256: receipt.receipt_sha256,
    });
    await expect(
      fixture.repository.completeVerified({ record: first, binding: bound, receipt }),
    ).resolves.toEqual({ record: first, inserted: true });
    await expect(
      fixture.repository.completeVerified({ record: first, binding: bound, receipt }),
    ).resolves.toEqual({ record: first, inserted: false });
    await expect(fixture.repository.accepted(first.attemptId)).resolves.toEqual(first);

    const conflict = { ...first, callbackSha256: sha("different-callback") };
    await expect(
      fixture.repository.completeVerified({ record: conflict, binding: bound, receipt }),
    ).rejects.toMatchObject({ code: "HOSTED_OUTPUT_BARRIER_ROW_INVALID" });
    expect(
      fixture.queries.filter((sql) =>
        sql.includes("INSERT INTO hosted_serverless_output_barrier_completions"),
      ),
    ).toHaveLength(1);
    expect(
      fixture.queries.filter((sql) => sql.includes("INSERT INTO serverless_provenance_receipts")),
    ).toHaveLength(1);
    expect(fixture.provenanceInsertParameters).toHaveLength(1);
    expect(fixture.provenanceInsertParameters[0]!.slice(14, 15)).toEqual([
      receipt.runtime_probe.peak_vram_bytes,
    ]);
    expect(fixture.provenanceInsertParameters[0]!.slice(22, 24)).toEqual([
      receipt.scratch_cleanup.removed,
      receipt.scratch_cleanup.scratch_on_model_volume,
    ]);
    const provenanceInsert = fixture.queries.find((sql) =>
      sql.includes("INSERT INTO serverless_provenance_receipts"),
    );
    expect(provenanceInsert).toContain(
      "driver_version, cuda_version, peak_vram_bytes, intended_region",
    );
    expect(provenanceInsert).toContain(
      "model_ready, scratch_removed, scratch_on_model_volume, timings",
    );
    expect(
      fixture.queries.some((sql) =>
        sql.includes(
          "SELECT receipt_sha256, peak_vram_bytes, scratch_removed, scratch_on_model_volume",
        ),
      ),
    ).toBe(true);
    expect(fixture.queries.some((sql) => sql.includes("ON CONFLICT (attempt_id) DO NOTHING"))).toBe(
      true,
    );
    expect(fixture.queries.some((sql) => sql.includes("FOR UPDATE"))).toBe(true);
  });

  it("rejects an arbitrary binding hash before provenance persistence", async () => {
    const fixture = sqlRepositoryFixture();
    await fixture.repository.schemaReady();
    const bound = binding();
    const receipt = receiptFor(bound);
    await expect(
      fixture.repository.completeVerified({
        record: completion({ provenanceReceiptSha256: receipt.receipt_sha256 }),
        binding: bound,
        receipt,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_OUTPUT_BARRIER_ROW_INVALID" });
    expect(
      fixture.queries.some((sql) => sql.includes("INSERT INTO serverless_provenance_receipts")),
    ).toBe(false);
  });

  it.each([
    ["peak VRAM", { peak_vram_bytes: String(1) }],
    ["scratch removal", { scratch_removed: false }],
    ["scratch placement", { scratch_on_model_volume: true }],
  ])("rejects mutated %s provenance readback", async (_label, readbackMutation) => {
    const fixture = sqlRepositoryFixture(HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS, readbackMutation);
    await fixture.repository.schemaReady();
    const bound = binding();
    const receipt = receiptFor(bound);
    const record = completion({
      bindingSha256: hostedOutputBindingSha256(bound),
      provenanceReceiptSha256: receipt.receipt_sha256,
    });

    await expect(
      fixture.repository.completeVerified({ record, binding: bound, receipt }),
    ).rejects.toMatchObject({ code: "HOSTED_OUTPUT_BARRIER_ROW_INVALID" });
    expect(
      fixture.queries.some((sql) =>
        sql.includes("INSERT INTO hosted_serverless_output_barrier_completions"),
      ),
    ).toBe(false);
  });

  it("reads ordinary provenance nonces inside the exact tenant scope", async () => {
    const fixture = sqlRepositoryFixture();
    await fixture.repository.schemaReady();
    await expect(fixture.repository.seenReceiptNonces("attempt-a")).resolves.toEqual(
      new Set([1, 2]),
    );
    expect(fixture.queries.filter((sql) => sql.includes("set_config"))).toHaveLength(1);
  });

  it("cannot read or write until the full schema capability check passes", async () => {
    const fixture = sqlRepositoryFixture(HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS.slice(0, -1));
    await expect(fixture.repository.schemaReady()).resolves.toBe(false);
    await expect(fixture.repository.accepted("attempt-a")).rejects.toMatchObject({
      code: "HOSTED_OUTPUT_BARRIER_SCHEMA_MISSING",
    });
    const bound = binding();
    const receipt = receiptFor(bound);
    await expect(
      fixture.repository.completeVerified({ record: completion(), binding: bound, receipt }),
    ).rejects.toMatchObject({ code: "HOSTED_OUTPUT_BARRIER_SCHEMA_MISSING" });
  });
});

describe("hosted private R2 artifact barrier adapter", () => {
  it("maps one exact committed reservation/receipt and private HEAD readback", async () => {
    const bound = binding();
    const parameters: SqlPrimitive[][] = [];
    const r2 = bucketFor(bound);
    const adapter = new HostedR2OutputArtifactBarrier(
      artifactDatabase(bound, "EXACT", parameters),
      r2.bucket,
    );

    await expect(adapter.readCommitted(bound, bound.expectedObjects[0]!)).resolves.toEqual({
      ...bound.expectedObjects[0]!,
      reservationState: "COMMITTED",
      artifactCommitReceiptSha256: sha("artifact-commit"),
      readbackChecksumSha256: bound.expectedObjects[0]!.checksumSha256,
      readbackContentLength: bound.expectedObjects[0]!.contentLength,
      readbackContentType: bound.expectedObjects[0]!.contentType,
    });
    expect(r2.heads).toEqual([bound.expectedObjects[0]!.objectKey]);
    expect(r2.gets).toEqual([bound.expectedObjects[0]!.objectKey]);
    expect(parameters.at(-1)).toEqual([
      bound.accountId,
      bound.workspaceId,
      bound.projectId,
      bound.projectRevisionId,
      "MAGE_IMAGE",
      bound.attemptId,
      bound.expectedObjects[0]!.itemId,
      bound.expectedObjects[0]!.objectKey,
      bound.expectedObjects[0]!.contentType,
      bound.expectedObjects[0]!.contentLength,
      bound.expectedObjects[0]!.checksumSha256,
    ]);
  });

  it("returns no authority for missing or ambiguous SQL commits without touching R2", async () => {
    const bound = binding();
    for (const rows of ["MISSING", "AMBIGUOUS"] as const) {
      const r2 = bucketFor(bound);
      const adapter = new HostedR2OutputArtifactBarrier(artifactDatabase(bound, rows), r2.bucket);
      await expect(adapter.readCommitted(bound, bound.expectedObjects[0]!)).resolves.toBeNull();
      expect(r2.heads).toHaveLength(0);
    }
  });

  it("returns no authority when private R2 HEAD is missing or drifts", async () => {
    const bound = binding();
    for (const drift of ["MISSING", "SIZE", "BYTES"] as const) {
      const r2 = bucketFor(bound, drift);
      const adapter = new HostedR2OutputArtifactBarrier(artifactDatabase(bound), r2.bucket);
      await expect(adapter.readCommitted(bound, bound.expectedObjects[0]!)).resolves.toBeNull();
    }
  });
});
