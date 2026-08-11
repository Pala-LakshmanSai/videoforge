import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import type { WorkspaceActorScope } from "../repositories/types.js";
import type {
  CommitImageStyleDerivedEdit,
  EditableImageStyleVersion,
  ImageStyleDerivedEditPersistence,
  ImageStyleDerivedEditRecord,
  ImageStyleDerivedEditRepository,
  ImageStyleProfileArtifact,
} from "./derived-artifact-edit.js";

type Row = Record<string, unknown>;

function text(value: unknown, column: string): string {
  if (typeof value !== "string") throw new TypeError(`${column} must be text`);
  return value;
}

function nullableText(value: unknown, column: string): string | null {
  return value === null ? null : text(value, column);
}

function integer(value: unknown, column: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && /^-?[0-9]+$/u.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${column} must be a safe integer`);
  return parsed;
}

function timestamp(value: unknown, column: string): string {
  if (value instanceof Date) return value.toISOString();
  const candidate = text(value, column);
  if (!Number.isFinite(Date.parse(candidate))) throw new TypeError(`${column} must be a timestamp`);
  return new Date(candidate).toISOString();
}

function object(value: unknown, column: string): Record<string, unknown> {
  const candidate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${column} must be an object`);
  }
  return candidate as Record<string, unknown>;
}

function stringArray(value: unknown, column: string): readonly string[] {
  const candidate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string")) {
    throw new TypeError(`${column} must be a string array`);
  }
  return Object.freeze([...candidate]);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function mapArtifact(row: Row): ImageStyleProfileArtifact {
  return Object.freeze({
    artifactId: text(row.id, "image_style_profile_artifacts.id"),
    workspaceId: text(row.workspace_id, "image_style_profile_artifacts.workspace_id"),
    styleId: text(row.style_id, "image_style_profile_artifacts.style_id"),
    versionId: text(row.version_id, "image_style_profile_artifacts.version_id"),
    origin: text(
      row.origin,
      "image_style_profile_artifacts.origin",
    ) as ImageStyleProfileArtifact["origin"],
    profileDocument: Object.freeze({
      contractName: text(row.profile_contract_name, "profile_contract_name"),
      contractVersion: text(row.profile_contract_version, "profile_contract_version"),
      payload: object(
        row.profile_payload,
        "profile_payload",
      ) as ImageStyleProfileArtifact["profileDocument"]["payload"],
      canonicalDocumentSha256: text(
        row.profile_hash,
        "profile_hash",
      ) as ImageStyleProfileArtifact["profileDocument"]["canonicalDocumentSha256"],
    }),
    rootSourceArtifactId: text(row.root_source_artifact_id, "root_source_artifact_id"),
    rootSourceArtifactHash: text(
      row.root_source_artifact_hash,
      "root_source_artifact_hash",
    ) as ImageStyleProfileArtifact["rootSourceArtifactHash"],
    parentArtifactId: nullableText(row.parent_artifact_id, "parent_artifact_id"),
    parentArtifactHash: nullableText(
      row.parent_artifact_hash,
      "parent_artifact_hash",
    ) as ImageStyleProfileArtifact["parentArtifactHash"],
    sourceAnalysisEvidence: nullableText(
      row.source_analysis_evidence,
      "source_analysis_evidence",
    ) as ImageStyleProfileArtifact["sourceAnalysisEvidence"],
    referenceAliases: stringArray(row.reference_aliases, "reference_aliases"),
    createdAt: timestamp(row.created_at, "image_style_profile_artifacts.created_at"),
  });
}

function mapEdit(row: Row): ImageStyleDerivedEditRecord {
  return Object.freeze({
    editId: text(row.id, "image_style_profile_edits.id"),
    workspaceId: text(row.workspace_id, "image_style_profile_edits.workspace_id"),
    styleId: text(row.style_id, "image_style_profile_edits.style_id"),
    versionId: text(row.version_id, "image_style_profile_edits.version_id"),
    editorUserId: text(row.editor_user_id, "image_style_profile_edits.editor_user_id"),
    editedAt: timestamp(row.edited_at, "image_style_profile_edits.edited_at"),
    idempotencyKey: text(row.idempotency_key, "image_style_profile_edits.idempotency_key"),
    requestFingerprintHash: text(
      row.request_fingerprint_hash,
      "request_fingerprint_hash",
    ) as ImageStyleDerivedEditRecord["requestFingerprintHash"],
    expectedRevision: integer(row.expected_revision, "expected_revision"),
    priorRevision: integer(row.prior_revision, "prior_revision"),
    resultRevision: integer(row.result_revision, "result_revision"),
    rootSourceArtifactId: text(row.root_source_artifact_id, "root_source_artifact_id"),
    rootSourceArtifactHash: text(
      row.root_source_artifact_hash,
      "root_source_artifact_hash",
    ) as ImageStyleDerivedEditRecord["rootSourceArtifactHash"],
    parentArtifactId: text(row.parent_artifact_id, "parent_artifact_id"),
    parentArtifactHash: text(
      row.parent_artifact_hash,
      "parent_artifact_hash",
    ) as ImageStyleDerivedEditRecord["parentArtifactHash"],
    derivedArtifactId: text(row.derived_artifact_id, "derived_artifact_id"),
    derivedArtifactHash: text(
      row.derived_artifact_hash,
      "derived_artifact_hash",
    ) as ImageStyleDerivedEditRecord["derivedArtifactHash"],
    changedPointers: stringArray(row.changed_pointers, "changed_pointers"),
    invalidatedReviewSnapshotId: nullableText(
      row.invalidated_review_snapshot_id,
      "invalidated_review_snapshot_id",
    ),
  });
}

async function hasMembership(executor: SqlExecutor, scope: WorkspaceActorScope): Promise<boolean> {
  const result = await executor.query<Row>(
    `SELECT 1 AS present FROM public.memberships
      WHERE workspace_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [scope.workspaceId, scope.actorUserId],
  );
  return result.rows.length === 1;
}

function createRepository(executor: SqlExecutor): ImageStyleDerivedEditRepository {
  return {
    async lockVersionForEdit(scope, lookup) {
      const result = await executor.query<Row>(
        `SELECT version.workspace_id, version.style_id, version.id AS version_id,
                version.state, version.profile_revision, version.root_profile_artifact_id,
                root.profile_hash AS root_profile_hash,
                version.current_profile_artifact_id,
                current.profile_hash AS current_profile_hash,
                version.review_snapshot_id
           FROM public.memberships membership
           JOIN public.image_style_versions version
             ON version.workspace_id = membership.workspace_id
           JOIN public.image_styles style
             ON style.workspace_id = version.workspace_id AND style.id = version.style_id
           JOIN public.image_style_profile_artifacts root
             ON root.workspace_id = version.workspace_id
            AND root.version_id = version.id AND root.id = version.root_profile_artifact_id
           JOIN public.image_style_profile_artifacts current
             ON current.workspace_id = version.workspace_id
            AND current.version_id = version.id AND current.id = version.current_profile_artifact_id
          WHERE membership.workspace_id = $1 AND membership.user_id = $2
            AND membership.status = 'ACTIVE' AND style.status = 'ACTIVE'
            AND version.style_id = $3 AND version.id = $4
          FOR UPDATE`,
        [scope.workspaceId, scope.actorUserId, lookup.styleId, lookup.versionId],
      );
      if (result.rows.length !== 1) return null;
      const row = result.rows[0]!;
      return Object.freeze({
        workspaceId: text(row.workspace_id, "workspace_id"),
        styleId: text(row.style_id, "style_id"),
        versionId: text(row.version_id, "version_id"),
        state: text(row.state, "state") as EditableImageStyleVersion["state"],
        builtIn: false,
        revision: integer(row.profile_revision, "profile_revision"),
        rootSourceArtifactId: text(row.root_profile_artifact_id, "root_profile_artifact_id"),
        rootSourceArtifactHash: text(
          row.root_profile_hash,
          "root_profile_hash",
        ) as EditableImageStyleVersion["rootSourceArtifactHash"],
        currentArtifactId: text(row.current_profile_artifact_id, "current_profile_artifact_id"),
        currentArtifactHash: text(
          row.current_profile_hash,
          "current_profile_hash",
        ) as EditableImageStyleVersion["currentArtifactHash"],
        reviewSnapshotId: nullableText(row.review_snapshot_id, "review_snapshot_id"),
      });
    },

    async resolveEditByIdempotencyKey(scope, idempotencyKey) {
      if (!(await hasMembership(executor, scope))) return null;
      const result = await executor.query<Row>(
        `SELECT * FROM public.image_style_profile_edits
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [scope.workspaceId, idempotencyKey],
      );
      return result.rows.length === 1 ? mapEdit(result.rows[0]!) : null;
    },

    async resolveArtifact(scope, artifactId) {
      if (!(await hasMembership(executor, scope))) return null;
      const result = await executor.query<Row>(
        `SELECT * FROM public.image_style_profile_artifacts
          WHERE workspace_id = $1 AND id = $2`,
        [scope.workspaceId, artifactId],
      );
      return result.rows.length === 1 ? mapArtifact(result.rows[0]!) : null;
    },

    async commitDerivedEdit(scope, command: CommitImageStyleDerivedEdit) {
      const artifact = command.derivedArtifact;
      const edit = command.edit;
      await executor.query(
        `INSERT INTO public.image_style_profile_artifacts (
           id, workspace_id, style_id, version_id, origin,
           profile_contract_name, profile_contract_version, profile_payload, profile_hash,
           canonical_profile_json, root_source_artifact_id, root_source_artifact_hash,
           parent_artifact_id, parent_artifact_hash, source_analysis_evidence,
           source_analysis_attempt_id, source_analysis_output_asset_id, reference_aliases,
           created_by_user_id, created_at
         )
         SELECT $1, $2, $3, $4, 'MANUAL_EDIT', $5, $6, $7::jsonb, $8, $9,
                $10, $11, $12, $13, NULL, root.source_analysis_attempt_id,
                root.source_analysis_output_asset_id, '[]'::jsonb, $14, $15
           FROM public.image_style_profile_artifacts root
          WHERE root.workspace_id = $2 AND root.style_id = $3 AND root.version_id = $4
            AND root.id = $10 AND root.profile_hash = $11`,
        [
          artifact.artifactId,
          scope.workspaceId,
          artifact.styleId,
          artifact.versionId,
          artifact.profileDocument.contractName,
          artifact.profileDocument.contractVersion,
          json(artifact.profileDocument.payload),
          artifact.profileDocument.canonicalDocumentSha256,
          command.canonicalProfileJson,
          artifact.rootSourceArtifactId,
          artifact.rootSourceArtifactHash,
          artifact.parentArtifactId,
          artifact.parentArtifactHash,
          scope.actorUserId,
          artifact.createdAt,
        ],
      );
      await executor.query(
        `INSERT INTO public.image_style_profile_edits (
           id, workspace_id, style_id, version_id, editor_user_id, edited_at,
           idempotency_key, request_fingerprint_hash, expected_revision, prior_revision,
           result_revision, root_source_artifact_id, root_source_artifact_hash,
           parent_artifact_id, parent_artifact_hash, derived_artifact_id,
           derived_artifact_hash, changed_pointers, invalidated_review_snapshot_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13, $14, $15, $16, $17, $18::jsonb, $19)`,
        [
          edit.editId,
          scope.workspaceId,
          edit.styleId,
          edit.versionId,
          edit.editorUserId,
          edit.editedAt,
          edit.idempotencyKey,
          edit.requestFingerprintHash,
          edit.expectedRevision,
          edit.priorRevision,
          edit.resultRevision,
          edit.rootSourceArtifactId,
          edit.rootSourceArtifactHash,
          edit.parentArtifactId,
          edit.parentArtifactHash,
          edit.derivedArtifactId,
          edit.derivedArtifactHash,
          json(edit.changedPointers),
          edit.invalidatedReviewSnapshotId,
        ],
      );
      const moved = await executor.query<Row>(
        `UPDATE public.image_style_versions
            SET profile_contract_name = $9, profile_contract_version = $10,
                profile_payload = $11::jsonb, style_profile_hash = $12,
                current_profile_artifact_id = $8, profile_revision = $13,
                review_snapshot_id = NULL, review_invalidated_at = $14, updated_at = $14
          WHERE workspace_id = $1 AND style_id = $2 AND id = $3 AND state = $4
            AND profile_revision = $5 AND current_profile_artifact_id = $6
            AND style_profile_hash = $7
          RETURNING id`,
        [
          scope.workspaceId,
          edit.styleId,
          edit.versionId,
          command.expectedState,
          command.expectedRevision,
          command.expectedCurrentArtifactId,
          command.expectedCurrentArtifactHash,
          edit.derivedArtifactId,
          artifact.profileDocument.contractName,
          artifact.profileDocument.contractVersion,
          json(artifact.profileDocument.payload),
          artifact.profileDocument.canonicalDocumentSha256,
          edit.resultRevision,
          edit.editedAt,
        ],
      );
      if (moved.rows.length !== 1) throw new Error("style profile pointer movement conflicted");
      return edit;
    },
  };
}

export interface ImageStylePublicationProfileLineage {
  readonly root: ImageStyleProfileArtifact;
  readonly current: ImageStyleProfileArtifact;
  readonly revision: number;
}

export class PGliteImageStyleDerivedEditPersistence implements ImageStyleDerivedEditPersistence {
  public readonly unitOfWork: ImageStyleDerivedEditPersistence["unitOfWork"];

  public constructor(private readonly database: TransactionalSqlExecutor) {
    this.unitOfWork = Object.freeze({
      execute: <Value>(
        _scope: WorkspaceActorScope,
        work: (repository: ImageStyleDerivedEditRepository) => Promise<Value>,
      ): Promise<Value> =>
        this.database.transaction((transaction) => work(createRepository(transaction))),
    });
  }

  public async resolvePublicationProfileLineage(
    scope: WorkspaceActorScope,
    lookup: Readonly<{ styleId: string; versionId: string }>,
  ): Promise<ImageStylePublicationProfileLineage | null> {
    if (!(await hasMembership(this.database, scope))) return null;
    const version = await this.database.query<Row>(
      `SELECT profile_revision, root_profile_artifact_id, current_profile_artifact_id
         FROM public.image_style_versions
        WHERE workspace_id = $1 AND style_id = $2 AND id = $3`,
      [scope.workspaceId, lookup.styleId, lookup.versionId],
    );
    if (version.rows.length !== 1) return null;
    const row = version.rows[0]!;
    const [root, current] = await Promise.all([
      createRepository(this.database).resolveArtifact(
        scope,
        text(row.root_profile_artifact_id, "root_profile_artifact_id"),
      ),
      createRepository(this.database).resolveArtifact(
        scope,
        text(row.current_profile_artifact_id, "current_profile_artifact_id"),
      ),
    ]);
    if (root === null || current === null) return null;
    return Object.freeze({
      root,
      current,
      revision: integer(row.profile_revision, "profile_revision"),
    });
  }
}
