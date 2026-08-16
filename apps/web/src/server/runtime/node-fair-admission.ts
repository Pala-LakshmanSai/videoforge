import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import {
  applyMigrations,
  FairAdmissionError,
  FairAdmissionRepository,
  MIGRATION_MANIFEST,
  trustedTenantActorScope,
  trustedTenantScope,
  type OwnedQueueItem,
  type SqlExecutor,
  type SqlPrimitive,
  type SqlQueryResult,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";

import type { ApplicationFairAdmission } from "../fair-admission-runtime";
import { SharedFixtureError, type FixtureTenantScope } from "../shared-app-fixture";

class PGliteExecutor implements TransactionalSqlExecutor {
  constructor(private readonly database: PGlite) {}

  async execute(sql: string): Promise<void> {
    await this.database.exec(sql);
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly SqlPrimitive[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.database.query<Row>(sql, [...parameters]);
    return { rows: result.rows, affectedRows: result.affectedRows ?? 0 };
  }

  transaction<Value>(work: (transaction: SqlExecutor) => Promise<Value>): Promise<Value> {
    return this.database.transaction((transaction) =>
      work(new PGliteExecutor(transaction as unknown as PGlite)),
    );
  }
}

function uuid(label: string): string {
  const hex = createHash("sha256").update(`videoforge-fixture:${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function sha256(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function ids(tenant: FixtureTenantScope, publicProjectId?: string) {
  const root = tenant.accountId;
  const project = publicProjectId ?? "catalog";
  return {
    accountId: uuid(`${root}:account`),
    workspaceId: uuid(`${root}:workspace`),
    userId: uuid(`${root}:user`),
    membershipId: uuid(`${root}:membership`),
    avatarOriginalId: uuid(`${root}:avatar-original`),
    avatarRuntimeId: uuid(`${root}:avatar-runtime`),
    voiceoverId: uuid(`${root}:${project}:voiceover`),
    avatarProfileId: uuid(`${root}:avatar-profile`),
    avatarVersionId: uuid(`${root}:avatar-version`),
    styleId: uuid(`${root}:style`),
    styleVersionId: uuid(`${root}:style-version`),
    projectId: uuid(`${root}:${project}:project`),
    revisionId: uuid(`${root}:${project}:revision`),
    requestId: uuid(`${root}:${project}:request`),
  };
}

function snapshot(items: readonly OwnedQueueItem[]) {
  return Object.freeze(
    items.flatMap((item) =>
      item.requestKind !== "VIDEO" ||
      !["WAITING", "ADMITTED", "ACTIVE", "CANCELLING"].includes(item.state)
        ? []
        : [
            Object.freeze({
              requestId: item.requestId,
              state: item.state as "WAITING" | "ADMITTED" | "ACTIVE" | "CANCELLING",
              queueOrder: item.queueOrder,
              version: item.version,
            }),
          ],
    ),
  );
}

export class NodeFairAdmission implements ApplicationFairAdmission {
  readonly #ready: Promise<{ executor: PGliteExecutor; repository: FairAdmissionRepository }>;

  constructor(dataDir: string, migrationsDir: string) {
    this.#ready = this.initialize(dataDir, migrationsDir);
  }

  private async initialize(dataDir: string, migrationsDir: string) {
    const database = new PGlite(dataDir);
    const executor = new PGliteExecutor(database);
    const sources = await Promise.all(
      MIGRATION_MANIFEST.map(async (entry) => ({
        ...entry,
        sql: await readFile(path.join(migrationsDir, entry.filename), "utf8"),
      })),
    );
    await applyMigrations(executor, sources);
    const repository = new FairAdmissionRepository(executor);
    await repository.reconstruct({ now: new Date().toISOString(), auditId: crypto.randomUUID() });
    return { executor, repository };
  }

  async reset(): Promise<void> {
    const { executor } = await this.#ready;
    await executor.transaction(async (transaction) => {
      await transaction.execute(
        `TRUNCATE generation_queue_audits, provider_workload_leases,
                  preset_preview_requests, generation_requests, account_queue_heads;
         UPDATE global_generation_capacity
            SET active_lease_count = 0, schedule_sequence = 0, video_fair_cursor = 0,
                preview_fair_cursor = 0, version = version + 1, updated_at = now()
          WHERE singleton;`,
      );
    });
  }

  private async ensureFixtureProject(
    executor: PGliteExecutor,
    tenant: FixtureTenantScope,
    actorEmail: string,
    publicProjectId: string,
    title: string,
  ) {
    const value = ids(tenant, publicProjectId);
    const now = new Date().toISOString();
    await executor.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO users (id, email, normalized_email, display_name)
         VALUES ($1, $2, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [value.userId, actorEmail, `Fixture ${actorEmail}`],
      );
      await transaction.query(
        `INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
         VALUES ($1, 'USER', $2, $3, 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
        [value.accountId, value.userId, actorEmail],
      );
      await transaction.query(
        `INSERT INTO workspaces (id, name, normalized_name, account_id, is_default)
         VALUES ($1, $2, $3, $4, true) ON CONFLICT (id) DO NOTHING`,
        [value.workspaceId, `Fixture ${actorEmail}`, `fixture ${actorEmail}`, value.accountId],
      );
      await transaction.query(
        `INSERT INTO memberships (id, workspace_id, account_id, user_id, normalized_name, role, status)
         VALUES ($1, $2, $3, $4, $5, 'ADMIN', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
        [
          value.membershipId,
          value.workspaceId,
          value.accountId,
          value.userId,
          `owner ${actorEmail}`,
        ],
      );
      for (const [assetId, kind, objectKey] of [
        [value.avatarOriginalId, "AVATAR_ORIGINAL", "avatar-original"],
        [value.avatarRuntimeId, "AVATAR_RUNTIME", "avatar-runtime"],
        [value.voiceoverId, "VOICEOVER", `voiceover-${publicProjectId}`],
      ] as const) {
        await transaction.query(
          `INSERT INTO assets (
             id, account_id, workspace_id, kind, state, object_key, binary_sha256,
             content_type, byte_size, verified_at
           ) VALUES ($1, $2, $3, $4, 'VERIFIED', $5, $6, 'application/octet-stream', 128, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            assetId,
            value.accountId,
            value.workspaceId,
            kind,
            `fixture/${value.accountId}/${objectKey}.bin`,
            sha256(`${value.accountId}:${objectKey}`),
            now,
          ],
        );
      }
      await transaction.query(
        `INSERT INTO avatar_profiles (
           id, account_id, workspace_id, name, normalized_name, created_by_user_id
         ) VALUES ($1, $2, $3, 'Fixture presenter', 'fixture presenter', $4)
         ON CONFLICT (id) DO NOTHING`,
        [value.avatarProfileId, value.accountId, value.workspaceId, value.userId],
      );
      await transaction.query(
        `INSERT INTO avatar_profile_versions (
           id, account_id, workspace_id, profile_id, version_number, state,
           profile_contract_name, profile_contract_version, profile_payload, profile_hash,
           original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
           source_preparation_profile, source_validation_profile,
           rights_attested_by_user_id, likeness_attested_by_user_id, ready_at
         ) VALUES ($1, $2, $3, $4, 1, 'READY', 'fixture-avatar', 'v1', '{}'::jsonb, $5,
                   $6, $7, $8, 'fixture-preparation', 'fixture-validation', $9, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          value.avatarVersionId,
          value.accountId,
          value.workspaceId,
          value.avatarProfileId,
          sha256(`${value.accountId}:avatar-profile`),
          value.avatarOriginalId,
          value.avatarRuntimeId,
          sha256(`${value.accountId}:avatar-runtime`),
          value.userId,
          now,
        ],
      );
      await transaction.query(
        `UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2 AND active_version_id IS NULL`,
        [value.avatarVersionId, value.avatarProfileId],
      );
      await transaction.query(
        `INSERT INTO image_styles (
           id, account_id, workspace_id, name, normalized_name, created_by_user_id
         ) VALUES ($1, $2, $3, 'Fixture documentary', 'fixture documentary', $4)
         ON CONFLICT (id) DO NOTHING`,
        [value.styleId, value.accountId, value.workspaceId, value.userId],
      );
      await transaction.query(
        `INSERT INTO image_style_versions (
           id, account_id, workspace_id, style_id, version_number, state,
           profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
           disclosure_attested_by_user_id, published_at
         ) VALUES ($1, $2, $3, $4, 1, 'PUBLISHED', 'fixture-style', 'v1', '{}'::jsonb, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          value.styleVersionId,
          value.accountId,
          value.workspaceId,
          value.styleId,
          sha256(`${value.accountId}:style`),
          value.userId,
          now,
        ],
      );
      await transaction.query(
        `UPDATE image_styles SET active_version_id = $1 WHERE id = $2 AND active_version_id IS NULL`,
        [value.styleVersionId, value.styleId],
      );
      await transaction.query(
        `INSERT INTO projects (
           id, account_id, workspace_id, owner_user_id, name, normalized_name
         ) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [
          value.projectId,
          value.accountId,
          value.workspaceId,
          value.userId,
          title,
          title.trim().toLowerCase(),
        ],
      );
      await transaction.query(
        `INSERT INTO project_revisions (
           id, account_id, workspace_id, project_id, revision_number, status, title,
           voiceover_asset_id, voiceover_binary_sha256,
           avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
           avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
           avatar_source_preparation_profile, avatar_source_validation_profile,
           avatar_compatibility_state, image_style_id, image_style_version_id, style_profile_hash,
           generation_mode, maximum_cost_micro_usd, seed,
           revision_config_contract_name, revision_config_contract_version,
           revision_config_payload, revision_config_hash, created_by_user_id, locked_at
         ) VALUES ($1, $2, $3, $4, 1, 'LOCKED', $5, $6, $7, $8, $9, $10, $11, $12,
                   'fixture-preparation', 'fixture-validation', 'UNTESTED', $13, $14, $15,
                   'LOWEST_COST', 1500000, 1, 'fixture-revision', 'v1', '{}'::jsonb, $16, $17, $18)
         ON CONFLICT (id) DO NOTHING`,
        [
          value.revisionId,
          value.accountId,
          value.workspaceId,
          value.projectId,
          title,
          value.voiceoverId,
          sha256(`${value.accountId}:voiceover-${publicProjectId}`),
          value.avatarProfileId,
          value.avatarVersionId,
          sha256(`${value.accountId}:avatar-profile`),
          value.avatarRuntimeId,
          sha256(`${value.accountId}:avatar-runtime`),
          value.styleId,
          value.styleVersionId,
          sha256(`${value.accountId}:style`),
          sha256(`${value.accountId}:${publicProjectId}:revision`),
          value.userId,
          now,
        ],
      );
    });
    return value;
  }

  private scope(tenant: FixtureTenantScope) {
    const value = ids(tenant);
    return trustedTenantScope(value.accountId, value.workspaceId);
  }

  private actorScope(tenant: FixtureTenantScope) {
    const value = ids(tenant);
    return trustedTenantActorScope(this.scope(tenant), value.userId);
  }

  private translate(error: unknown): never {
    if (error instanceof FairAdmissionError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      throw new SharedFixtureError(error.code, status, error.message);
    }
    throw error;
  }

  async enqueueVideo(input: Parameters<ApplicationFairAdmission["enqueueVideo"]>[0]) {
    try {
      const { executor, repository } = await this.#ready;
      const value = await this.ensureFixtureProject(
        executor,
        input.tenant,
        input.actorEmail,
        input.publicProjectId,
        input.title,
      );
      const now = new Date().toISOString();
      const queued = await repository.enqueueVideo(this.actorScope(input.tenant), {
        requestId: value.requestId,
        projectId: value.projectId,
        projectRevisionId: value.revisionId,
        idempotencyKey: `generate:${input.publicProjectId}`,
        now,
        auditId: crypto.randomUUID(),
      });
      await repository.promoteNext({
        leaseId: crypto.randomUUID(),
        auditId: crypto.randomUUID(),
        ownerTokenSha256: sha256(crypto.randomUUID()) as `sha256:${string}`,
        now,
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
      const owned = await repository.listOwned(this.scope(input.tenant));
      const item = owned.find((candidate) => candidate.requestId === queued.requestId);
      if (item === undefined) throw new Error("durable fair admission lost the enqueued request");
      return {
        requestId: item.requestId,
        state: item.state as "WAITING" | "ADMITTED" | "ACTIVE" | "CANCELLING",
        version: item.version,
        snapshot: snapshot(owned),
      };
    } catch (error) {
      this.translate(error);
    }
  }

  async listOwned(tenant: FixtureTenantScope) {
    try {
      const { repository } = await this.#ready;
      return snapshot(await repository.listOwned(this.scope(tenant)));
    } catch (error) {
      this.translate(error);
    }
  }

  async reorderOwned(input: Parameters<ApplicationFairAdmission["reorderOwned"]>[0]) {
    try {
      const { repository } = await this.#ready;
      await repository.reorderOwnedWaiting(this.actorScope(input.tenant), {
        requestKind: "VIDEO",
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        toPosition: input.toPosition,
        auditId: crypto.randomUUID(),
        now: new Date().toISOString(),
      });
      return snapshot(await repository.listOwned(this.scope(input.tenant)));
    } catch (error) {
      this.translate(error);
    }
  }

  async cancelOwned(input: Parameters<ApplicationFairAdmission["cancelOwned"]>[0]) {
    try {
      const { repository } = await this.#ready;
      await repository.cancelOwned(this.actorScope(input.tenant), {
        requestKind: "VIDEO",
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        auditId: crypto.randomUUID(),
        now: new Date().toISOString(),
      });
      return snapshot(await repository.listOwned(this.scope(input.tenant)));
    } catch (error) {
      this.translate(error);
    }
  }
}
