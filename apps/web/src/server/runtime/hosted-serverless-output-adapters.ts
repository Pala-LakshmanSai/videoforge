import {
  canonicalSha256,
  type ProvenanceReceipt,
  type Sha256,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";

import type { HostedR2BucketBinding } from "../hosted/configuration.js";
import type {
  HostedLaneCompletionRecord,
  HostedLaneCompletionRepository,
  HostedPrivateArtifactBarrierPort,
  HostedPrivateArtifactReadback,
  HostedServerlessAttemptBinding,
} from "./hosted-serverless-output-barrier.js";
import { hostedOutputBindingComponents } from "./hosted-serverless-output-barrier.js";

const TENANT_PRINCIPAL_SETTING = "videoforge.account_id";
const COMPLETION_TABLE = "hosted_serverless_output_barrier_completions";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export const HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS = Object.freeze([
  "attempt_id",
  "account_id",
  "workspace_id",
  "project_id",
  "project_revision_id",
  "lane",
  "assignment_id",
  "provider_job_id",
  "dispatch_token_sha256",
  "deployment_id",
  "endpoint_id_sha256",
  "endpoint_config_sha256",
  "worker_image_digest",
  "model_manifest_sha256",
  "volume_id_sha256",
  "volume_manifest_sha256",
  "region",
  "gpu_allowlist",
  "expected_objects",
  "binding_components",
  "binding_sha256",
  "callback_sha256",
  "provenance_receipt_sha256",
  "artifact_commit_receipt_sha256s",
  "completed_at",
  "created_at",
] as const);

export class HostedOutputAdapterError extends Error {
  constructor(
    readonly code: "HOSTED_OUTPUT_BARRIER_SCHEMA_MISSING" | "HOSTED_OUTPUT_BARRIER_ROW_INVALID",
  ) {
    super(code);
    this.name = "HostedOutputAdapterError";
  }
}

interface CompletionRow extends Record<string, unknown> {
  readonly attempt_id: string;
  readonly binding_sha256: Sha256;
  readonly callback_sha256: Sha256;
  readonly provenance_receipt_sha256: Sha256;
  readonly artifact_commit_receipt_sha256s: unknown;
  readonly completed_at: string | Date;
}

function exactSha256Array(value: unknown): readonly Sha256[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4096) return null;
  if (value.some((item) => typeof item !== "string" || !SHA256.test(item))) return null;
  const hashes = value as Sha256[];
  if (new Set(hashes).size !== hashes.length) return null;
  return Object.freeze([...hashes].sort());
}

function completionRecord(row: CompletionRow): HostedLaneCompletionRecord {
  const commitHashes = exactSha256Array(row.artifact_commit_receipt_sha256s);
  const completedAt =
    row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at;
  if (
    !row.attempt_id ||
    !SHA256.test(row.binding_sha256) ||
    !SHA256.test(row.callback_sha256) ||
    !SHA256.test(row.provenance_receipt_sha256) ||
    !commitHashes ||
    typeof completedAt !== "string" ||
    Number.isNaN(Date.parse(completedAt))
  ) {
    throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
  }
  return Object.freeze({
    attemptId: row.attempt_id,
    bindingSha256: row.binding_sha256,
    callbackSha256: row.callback_sha256,
    provenanceReceiptSha256: row.provenance_receipt_sha256,
    artifactCommitReceiptSha256s: commitHashes,
    completedAt: new Date(completedAt).toISOString(),
  });
}

function sameCompletion(
  left: HostedLaneCompletionRecord,
  right: HostedLaneCompletionRecord,
): boolean {
  return (
    left.attemptId === right.attemptId &&
    left.bindingSha256 === right.bindingSha256 &&
    left.callbackSha256 === right.callbackSha256 &&
    left.provenanceReceiptSha256 === right.provenanceReceiptSha256 &&
    left.completedAt === right.completedAt &&
    left.artifactCommitReceiptSha256s.length === right.artifactCommitReceiptSha256s.length &&
    left.artifactCommitReceiptSha256s.every(
      (hash, index) => hash === right.artifactCommitReceiptSha256s[index],
    )
  );
}

async function bindTenant(database: SqlExecutor, accountId: string): Promise<void> {
  await database.query(`SELECT set_config($1, $2, true)`, [TENANT_PRINCIPAL_SETTING, accountId]);
}

/**
 * Durable completion adapter for the ordinary callback barrier. It capability-checks the complete
 * supplemental schema before use rather than overloading canonical output columns.
 */
export class HostedSqlOutputBarrierRepository implements HostedLaneCompletionRepository {
  #schemaVerified = false;

  constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly scope: { readonly accountId: string; readonly workspaceId: string },
  ) {
    if (!scope.accountId || !scope.workspaceId) {
      throw new TypeError("Hosted output SQL repository requires an exact tenant scope.");
    }
  }

  async schemaReady(): Promise<boolean> {
    const result = await this.database.query<{ ready: boolean } & Record<string, unknown>>(
      `WITH target AS (
         SELECT oid, relrowsecurity, relforcerowsecurity
           FROM pg_catalog.pg_class
          WHERE oid = to_regclass('public.${COMPLETION_TABLE}')
       ), fk_expected(conname, refrel, local_cols, remote_cols) AS (VALUES
         ('hosted_serverless_output_barrier_workspace_fk', 'public.workspaces'::regclass,
          ARRAY['account_id','workspace_id'], ARRAY['account_id','id']),
         ('hosted_serverless_output_barrier_project_fk', 'public.projects'::regclass,
          ARRAY['account_id','workspace_id','project_id'], ARRAY['account_id','workspace_id','id']),
         ('hosted_serverless_output_barrier_revision_fk', 'public.project_revisions'::regclass,
          ARRAY['account_id','workspace_id','project_revision_id'], ARRAY['account_id','workspace_id','id']),
         ('hosted_serverless_output_barrier_attempt_fk', 'public.serverless_attempts'::regclass,
          ARRAY['account_id','workspace_id','attempt_id'], ARRAY['account_id','workspace_id','id']),
         ('hosted_serverless_output_barrier_assignment_fk', 'public.serverless_provider_assignments'::regclass,
          ARRAY['account_id','workspace_id','assignment_id'], ARRAY['account_id','workspace_id','id']),
         ('hosted_serverless_output_barrier_deployment_fk', 'public.serverless_endpoint_deployments'::regclass,
          ARRAY['deployment_id','lane'], ARRAY['id','lane']),
         ('hosted_serverless_output_barrier_provenance_fk', 'public.serverless_provenance_receipts'::regclass,
          ARRAY['provenance_receipt_sha256'], ARRAY['receipt_sha256'])
       ), index_expected(indexname, is_unique, is_primary, key_cols) AS (VALUES
         ('${COMPLETION_TABLE}_pkey', true, true, ARRAY['attempt_id']),
         ('hosted_output_barrier_tenant_attempt_uq', true, false,
          ARRAY['account_id','workspace_id','attempt_id']),
         ('hosted_output_barrier_callback_uq', true, false, ARRAY['callback_sha256']),
         ('hosted_output_barrier_provenance_uq', true, false,
          ARRAY['provenance_receipt_sha256']),
         ('hosted_serverless_output_barrier_tenant_completed_idx', false, false,
          ARRAY['account_id','workspace_id','completed_at','attempt_id'])
       ), trigger_expected(tgname, proname, tgtype) AS (VALUES
         ('${COMPLETION_TABLE}_derive', 'videoforge_derive_hosted_output_barrier_completion', 7),
         ('${COMPLETION_TABLE}_append_only', 'videoforge_vnext_append_only', 27),
         ('${COMPLETION_TABLE}_tenant_write_guard', 'videoforge_assert_tenant_write', 7)
       )
       SELECT COALESCE((
         SELECT relrowsecurity AND relforcerowsecurity
           AND (SELECT count(*) FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = $1
                   AND column_name IN (SELECT jsonb_array_elements_text($2::jsonb))) = $3
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                 WHERE polrelid = target.oid AND polname = '${COMPLETION_TABLE}_tenant_rls'
                   AND polcmd = '*' AND polpermissive AND polroles = ARRAY[0]::oid[]
                   AND polqual IS NOT NULL AND polwithcheck IS NOT NULL
                   AND pg_get_expr(polqual, polrelid) = pg_get_expr(polwithcheck, polrelid)
                   AND pg_get_expr(polqual, polrelid) LIKE '%account_id%videoforge_current_account_id%')
           AND NOT EXISTS (SELECT 1 FROM trigger_expected expected WHERE NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_trigger trig
                 JOIN pg_catalog.pg_proc procedure ON procedure.oid = trig.tgfoid
                  WHERE trig.tgrelid = target.oid AND NOT trig.tgisinternal
                    AND trig.tgname = expected.tgname AND trig.tgenabled = 'O'
                    AND trig.tgtype = expected.tgtype AND procedure.proname = expected.proname))
           AND NOT EXISTS (SELECT 1 FROM fk_expected expected WHERE NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_constraint con
                  WHERE con.conrelid = target.oid AND con.conname = expected.conname
                    AND con.contype = 'f' AND con.convalidated
                    AND con.confrelid = expected.refrel
                    AND con.confdeltype = 'r' AND con.confupdtype = 'a'
                    AND con.conkey = (SELECT array_agg(attribute.attnum::smallint ORDER BY key_part.ord)
                      FROM unnest(expected.local_cols) WITH ORDINALITY AS key_part(name, ord)
                      JOIN pg_catalog.pg_attribute attribute
                        ON attribute.attrelid = target.oid AND attribute.attname = key_part.name)
                    AND con.confkey = (SELECT array_agg(attribute.attnum::smallint ORDER BY key_part.ord)
                      FROM unnest(expected.remote_cols) WITH ORDINALITY AS key_part(name, ord)
                      JOIN pg_catalog.pg_attribute attribute
                        ON attribute.attrelid = expected.refrel AND attribute.attname = key_part.name)))
           AND NOT EXISTS (SELECT 1 FROM index_expected expected WHERE NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_index idx
                 JOIN pg_catalog.pg_class index_class ON index_class.oid = idx.indexrelid
                  WHERE idx.indrelid = target.oid AND index_class.relname = expected.indexname
                    AND idx.indisunique = expected.is_unique
                    AND idx.indisprimary = expected.is_primary
                    AND idx.indisvalid AND idx.indisready AND idx.indpred IS NULL
                    AND idx.indexprs IS NULL AND idx.indnkeyatts = cardinality(expected.key_cols)
                    AND array_to_string(idx.indkey::smallint[], ',') = (SELECT array_to_string(
                      array_agg(attribute.attnum::smallint ORDER BY key_part.ord), ',')
                      FROM unnest(expected.key_cols) WITH ORDINALITY AS key_part(name, ord)
                      JOIN pg_catalog.pg_attribute attribute
                        ON attribute.attrelid = target.oid AND attribute.attname = key_part.name)))
         FROM target
       ), false) AS ready`,
      [
        COMPLETION_TABLE,
        JSON.stringify(HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS),
        HOSTED_OUTPUT_BARRIER_REQUIRED_COLUMNS.length,
      ],
    );
    this.#schemaVerified = result.rows[0]?.ready === true;
    return this.#schemaVerified;
  }

  #assertSchema(): void {
    if (!this.#schemaVerified) {
      throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_SCHEMA_MISSING");
    }
  }

  async accepted(attemptId: string): Promise<HostedLaneCompletionRecord | null> {
    this.#assertSchema();
    return this.database.transaction(async (transaction) => {
      await bindTenant(transaction, this.scope.accountId);
      const result = await transaction.query<CompletionRow>(
        `SELECT attempt_id, binding_sha256, callback_sha256, provenance_receipt_sha256,
                artifact_commit_receipt_sha256s, completed_at
           FROM ${COMPLETION_TABLE}
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3`,
        [this.scope.accountId, this.scope.workspaceId, attemptId],
      );
      if (result.rows.length > 1) {
        throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
      }
      return result.rows[0] ? completionRecord(result.rows[0]) : null;
    });
  }

  async seenReceiptNonces(attemptId: string): Promise<ReadonlySet<number>> {
    this.#assertSchema();
    return this.database.transaction(async (transaction) => {
      await bindTenant(transaction, this.scope.accountId);
      const result = await transaction.query<
        { receipt_nonce: string | number } & Record<string, unknown>
      >(
        `SELECT receipt_nonce
           FROM serverless_provenance_receipts
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3`,
        [this.scope.accountId, this.scope.workspaceId, attemptId],
      );
      const nonces = result.rows.map((row) => Number(row.receipt_nonce));
      if (nonces.some((nonce) => !Number.isSafeInteger(nonce) || nonce < 1)) {
        throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
      }
      return new Set(nonces);
    });
  }

  async completeVerified(input: {
    readonly record: HostedLaneCompletionRecord;
    readonly binding: HostedServerlessAttemptBinding;
    readonly receipt: ProvenanceReceipt;
  }): Promise<{ readonly record: HostedLaneCompletionRecord; readonly inserted: boolean }> {
    this.#assertSchema();
    const { record, binding, receipt } = input;
    const normalized = completionRecord({
      attempt_id: record.attemptId,
      binding_sha256: record.bindingSha256,
      callback_sha256: record.callbackSha256,
      provenance_receipt_sha256: record.provenanceReceiptSha256,
      artifact_commit_receipt_sha256s: record.artifactCommitReceiptSha256s,
      completed_at: record.completedAt,
    });
    const bindingComponents = hostedOutputBindingComponents(binding);
    if (
      binding.accountId !== this.scope.accountId ||
      binding.workspaceId !== this.scope.workspaceId ||
      canonicalSha256(bindingComponents) !== normalized.bindingSha256 ||
      receipt.receipt_sha256 !== normalized.provenanceReceiptSha256
    ) {
      throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
    }
    return this.database.transaction(async (transaction) => {
      await bindTenant(transaction, this.scope.accountId);
      const assignment = await transaction.query<{ id: string } & Record<string, unknown>>(
        `SELECT id FROM serverless_provider_assignments
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3 AND is_current
          FOR UPDATE`,
        [this.scope.accountId, this.scope.workspaceId, normalized.attemptId],
      );
      if (assignment.rows.length !== 1) {
        throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
      }
      const prior = await transaction.query<CompletionRow>(
        `SELECT attempt_id, binding_sha256, callback_sha256, provenance_receipt_sha256,
                artifact_commit_receipt_sha256s, completed_at
           FROM ${COMPLETION_TABLE}
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3
          FOR UPDATE`,
        [this.scope.accountId, this.scope.workspaceId, normalized.attemptId],
      );
      if (prior.rows.length > 0) {
        if (
          prior.rows.length !== 1 ||
          !sameCompletion(completionRecord(prior.rows[0]!), normalized)
        ) {
          throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
        }
        return { record: normalized, inserted: false };
      }
      await transaction.query(
        `INSERT INTO serverless_provenance_receipts (
           id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id,
           receipt_nonce, attestation_scope, worker_id, provider_job_id, gpu_name, gpu_uuid_sha256,
           driver_version, cuda_version, intended_region, intended_volume_id_sha256,
           manifest_sha256_before, manifest_sha256_after, mutation_detected, cross_mount_detected,
           model_ready, timings, items, receipt_sha256, signature_key_id, signature_value,
           issued_at, accepted_at
         ) VALUES (md5('hosted-output-provenance:' || $1)::uuid, $2, $3, $4, $5, $6, $7, $8,
                   $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                   $22::jsonb, $23::jsonb, $1, $24, $25, $26, $27)
         ON CONFLICT (attempt_id, receipt_nonce) DO NOTHING`,
        [
          receipt.receipt_sha256,
          this.scope.accountId,
          this.scope.workspaceId,
          binding.projectRevisionId,
          normalized.attemptId,
          assignment.rows[0]!.id,
          receipt.receipt_nonce,
          receipt.attestation_scope,
          receipt.worker_id,
          receipt.provider_job_id,
          receipt.runtime_probe.gpu_name,
          receipt.runtime_probe.gpu_uuid_sha256,
          receipt.runtime_probe.driver_version,
          receipt.runtime_probe.cuda_version,
          receipt.deployment.intended_region,
          receipt.deployment.intended_volume_id_sha256,
          receipt.volume_verification.manifest_sha256_before,
          receipt.volume_verification.manifest_sha256_after,
          receipt.volume_verification.mutation_detected,
          receipt.volume_verification.cross_mount_detected,
          receipt.model_ready_evidence.state === "MODEL_READY",
          JSON.stringify(receipt.timings),
          JSON.stringify(receipt.items),
          receipt.signature.key_id,
          receipt.signature.value,
          receipt.issued_at,
          normalized.completedAt,
        ],
      );
      const persistedProvenance = await transaction.query<
        { receipt_sha256: Sha256 } & Record<string, unknown>
      >(
        `SELECT receipt_sha256 FROM serverless_provenance_receipts
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3 AND receipt_nonce = $4
          FOR UPDATE`,
        [this.scope.accountId, this.scope.workspaceId, normalized.attemptId, receipt.receipt_nonce],
      );
      if (
        persistedProvenance.rows.length !== 1 ||
        persistedProvenance.rows[0]!.receipt_sha256 !== receipt.receipt_sha256
      ) {
        throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
      }
      const insertion = await transaction.query(
        `INSERT INTO ${COMPLETION_TABLE} (
           account_id, workspace_id, attempt_id, binding_sha256, callback_sha256,
           binding_components, provenance_receipt_sha256,
           artifact_commit_receipt_sha256s, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
         ON CONFLICT (attempt_id) DO NOTHING RETURNING attempt_id`,
        [
          this.scope.accountId,
          this.scope.workspaceId,
          normalized.attemptId,
          normalized.bindingSha256,
          normalized.callbackSha256,
          JSON.stringify(bindingComponents),
          normalized.provenanceReceiptSha256,
          JSON.stringify(normalized.artifactCommitReceiptSha256s),
          normalized.completedAt,
        ],
      );
      const result = await transaction.query<CompletionRow>(
        `SELECT attempt_id, binding_sha256, callback_sha256, provenance_receipt_sha256,
                artifact_commit_receipt_sha256s, completed_at
           FROM ${COMPLETION_TABLE}
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3
          FOR UPDATE`,
        [this.scope.accountId, this.scope.workspaceId, normalized.attemptId],
      );
      if (result.rows.length !== 1) {
        throw new HostedOutputAdapterError("HOSTED_OUTPUT_BARRIER_ROW_INVALID");
      }
      return { record: completionRecord(result.rows[0]!), inserted: insertion.rows.length === 1 };
    });
  }
}

interface ArtifactCommitRow extends Record<string, unknown> {
  readonly receipt_sha256: Sha256;
  readonly object_key: string;
  readonly content_type: string;
  readonly content_length: string | number;
  readonly checksum_sha256: Sha256;
  readonly artifact_id: string;
}

function r2Checksum(value: ArrayBuffer | undefined): Sha256 | null {
  if (!value || value.byteLength !== 32) return null;
  const hex = [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

async function digestReadback(bytes: ArrayBuffer): Promise<Sha256> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Exact SQL commit plus bounded private-R2 byte readback; it never signs or fetches public data. */
export class HostedR2OutputArtifactBarrier implements HostedPrivateArtifactBarrierPort {
  constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly bucket: HostedR2BucketBinding,
  ) {}

  async readCommitted(
    binding: HostedServerlessAttemptBinding,
    expected: HostedServerlessAttemptBinding["expectedObjects"][number],
  ): Promise<HostedPrivateArtifactReadback | null> {
    const rows = await this.database.transaction(async (transaction) => {
      await bindTenant(transaction, binding.accountId);
      return transaction.query<ArtifactCommitRow>(
        `SELECT receipt.receipt_sha256, receipt.object_key, receipt.content_type,
                receipt.content_length, receipt.checksum_sha256, reservation.artifact_id
           FROM artifact_receipts AS receipt
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = receipt.account_id
            AND reservation.workspace_id = receipt.workspace_id
            AND reservation.id = receipt.reservation_id
          WHERE receipt.account_id = $1 AND receipt.workspace_id = $2
            AND receipt.deleted_at IS NULL
            AND reservation.project_id = $3 AND reservation.project_revision_id = $4
            AND reservation.lane = $5 AND reservation.job_id = $6
            AND reservation.artifact_id = $7 AND reservation.object_key = $8
            AND reservation.state = 'COMMITTED'
            AND receipt.object_key = $8 AND receipt.content_type = $9
            AND receipt.content_length = $10 AND receipt.checksum_sha256 = $11`,
        [
          binding.accountId,
          binding.workspaceId,
          binding.projectId,
          binding.projectRevisionId,
          binding.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR",
          binding.attemptId,
          expected.itemId,
          expected.objectKey,
          expected.contentType,
          expected.contentLength,
          expected.checksumSha256,
        ],
      );
    });
    if (rows.rows.length !== 1) return null;
    const row = rows.rows[0]!;
    const length = Number(row.content_length);
    if (
      row.artifact_id !== expected.itemId ||
      row.object_key !== expected.objectKey ||
      row.content_type !== expected.contentType ||
      length !== expected.contentLength ||
      row.checksum_sha256 !== expected.checksumSha256 ||
      !SHA256.test(row.receipt_sha256)
    ) {
      return null;
    }

    const head = await this.bucket.head(expected.objectKey);
    const checksum = r2Checksum(head?.checksums?.sha256);
    if (
      !head ||
      expected.contentLength > 2 * 1024 ** 3 ||
      head.size !== expected.contentLength ||
      head.httpMetadata?.contentType !== expected.contentType ||
      checksum !== expected.checksumSha256
    ) {
      return null;
    }
    const object = await this.bucket.get(expected.objectKey);
    if (
      !object ||
      object.size !== expected.contentLength ||
      object.httpMetadata?.contentType !== expected.contentType
    ) {
      return null;
    }
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength !== expected.contentLength) return null;
    const byteChecksum = await digestReadback(bytes);
    if (byteChecksum !== expected.checksumSha256) return null;
    return Object.freeze({
      ...expected,
      reservationState: "COMMITTED",
      artifactCommitReceiptSha256: row.receipt_sha256,
      readbackChecksumSha256: byteChecksum,
      readbackContentLength: bytes.byteLength,
      readbackContentType: object.httpMetadata.contentType,
    });
  }
}
