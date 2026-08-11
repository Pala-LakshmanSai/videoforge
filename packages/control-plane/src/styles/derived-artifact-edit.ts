import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  validateAndHashContractDocument,
  validateContract,
  type ImageStyleProfileDocument,
} from "@videoforge/contracts";
import { validateStoredStyleProfile } from "@videoforge/pipeline";

import type {
  CanonicalDocument,
  JsonObject,
  Sha256,
  WorkspaceActorScope,
} from "../repositories/types.js";

export type ImageStyleDerivedEditErrorCode =
  | "AUTHORIZATION_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "INPUT_INVALID"
  | "LINEAGE_INVALID"
  | "PROFILE_INVALID"
  | "REPOSITORY_FAILURE"
  | "STYLE_NOT_FOUND"
  | "STYLE_PROFILE_NO_CHANGES"
  | "STYLE_VERSION_CONFLICT"
  | "STYLE_VERSION_IMMUTABLE";

export class ImageStyleDerivedEditError extends Error {
  public constructor(
    public readonly code: ImageStyleDerivedEditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageStyleDerivedEditError";
  }
}

export interface EditImageStyleProfileCommand {
  readonly styleId: string;
  readonly versionId: string;
  readonly expectedRevision: number;
  readonly expectedCurrentArtifactHash: Sha256;
  readonly idempotencyKey: string;
  readonly candidateProfile: unknown;
  readonly editedAt: string;
}

export type EditableImageStyleVersionState =
  | "DRAFT"
  | "ANALYZING"
  | "NEEDS_REVIEW"
  | "FAILED"
  | "PUBLISHED"
  | "ABANDONED";

export interface EditableImageStyleVersion {
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly state: EditableImageStyleVersionState;
  readonly builtIn: boolean;
  readonly revision: number;
  readonly rootSourceArtifactId: string;
  readonly rootSourceArtifactHash: Sha256;
  readonly currentArtifactId: string;
  readonly currentArtifactHash: Sha256;
  readonly reviewSnapshotId: string | null;
}

export type ImageStyleProfileArtifactOrigin = "VISION_ANALYSIS" | "MANUAL_EDIT";

export interface ImageStyleProfileArtifact {
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly origin: ImageStyleProfileArtifactOrigin;
  readonly profileDocument: CanonicalDocument;
  readonly rootSourceArtifactId: string;
  readonly rootSourceArtifactHash: Sha256;
  readonly parentArtifactId: string | null;
  readonly parentArtifactHash: Sha256 | null;
  readonly sourceAnalysisEvidence: "HISTORICAL_SOURCE_TRUTH" | null;
  readonly referenceAliases: readonly string[];
  readonly createdAt: string;
}

export interface ImageStyleDerivedEditRecord {
  readonly editId: string;
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly editorUserId: string;
  readonly editedAt: string;
  readonly idempotencyKey: string;
  readonly requestFingerprintHash: Sha256;
  readonly expectedRevision: number;
  readonly priorRevision: number;
  readonly resultRevision: number;
  readonly rootSourceArtifactId: string;
  readonly rootSourceArtifactHash: Sha256;
  readonly parentArtifactId: string;
  readonly parentArtifactHash: Sha256;
  readonly derivedArtifactId: string;
  readonly derivedArtifactHash: Sha256;
  readonly changedPointers: readonly string[];
  readonly invalidatedReviewSnapshotId: string | null;
}

export interface CommitImageStyleDerivedEdit {
  readonly edit: ImageStyleDerivedEditRecord;
  readonly derivedArtifact: ImageStyleProfileArtifact;
  readonly canonicalProfileJson: string;
  readonly expectedState: "NEEDS_REVIEW";
  readonly expectedCurrentArtifactId: string;
  readonly expectedCurrentArtifactHash: Sha256;
  readonly expectedRevision: number;
}

export interface ImageStyleDerivedEditRepository {
  /** Must lock the version row until the surrounding unit of work ends. */
  lockVersionForEdit(
    scope: WorkspaceActorScope,
    lookup: Readonly<{ styleId: string; versionId: string }>,
  ): Promise<EditableImageStyleVersion | null>;
  /** Workspace-wide lookup detects actor/target reuse instead of hiding conflicting retries. */
  resolveEditByIdempotencyKey(
    scope: WorkspaceActorScope,
    idempotencyKey: string,
  ): Promise<ImageStyleDerivedEditRecord | null>;
  resolveArtifact(
    scope: WorkspaceActorScope,
    artifactId: string,
  ): Promise<ImageStyleProfileArtifact | null>;
  /** Must insert artifact/edit, clear review, and move pointer/revision as one mutation. */
  commitDerivedEdit(
    scope: WorkspaceActorScope,
    command: CommitImageStyleDerivedEdit,
  ): Promise<ImageStyleDerivedEditRecord>;
}

export interface ImageStyleDerivedEditUnitOfWork {
  /** Thrown errors must roll back every write made by work. */
  execute<Value>(
    scope: WorkspaceActorScope,
    work: (repository: ImageStyleDerivedEditRepository) => Promise<Value>,
  ): Promise<Value>;
}

export interface ImageStyleDerivedEditPersistence {
  readonly unitOfWork: ImageStyleDerivedEditUnitOfWork;
}

export interface EditedImageStyleProfile {
  readonly kind: "IMAGE_STYLE_DERIVED_PROFILE_EDITED";
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly editorUserId: string;
  readonly editedAt: string;
  readonly editId: string;
  readonly rootSourceArtifactId: string;
  readonly rootSourceArtifactHash: Sha256;
  readonly parentArtifactId: string;
  readonly parentArtifactHash: Sha256;
  readonly derivedArtifactId: string;
  readonly derivedArtifactHash: Sha256;
  readonly changedPointers: readonly string[];
  readonly priorRevision: number;
  readonly resultRevision: number;
  readonly invalidatedReviewSnapshotId: string | null;
  readonly replayed: boolean;
}

const COMMAND_KEYS = [
  "candidateProfile",
  "editedAt",
  "expectedCurrentArtifactHash",
  "expectedRevision",
  "idempotencyKey",
  "styleId",
  "versionId",
] as const;
const SCOPE_KEYS = ["actorUserId", "workspaceId"] as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const DETACHED_ANALYSIS = Object.freeze({
  analysis_kind: "MANUAL_EDIT" as const,
  overall_confidence: null,
  trait_evidence: Object.freeze([]),
  uncertain_fields: Object.freeze([]),
  outlier_reference_aliases: Object.freeze([]),
  content_leakage_warnings: Object.freeze([]),
});

function fail(code: ImageStyleDerivedEditErrorCode, message: string): never {
  throw new ImageStyleDerivedEditError(code, message);
}

function exactPlainRecord(
  value: unknown,
  keys: readonly string[],
  code: "AUTHORIZATION_REQUIRED" | "INPUT_INVALID",
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(code, `${label} must be a plain exact-shape object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== keys.length ||
    keys.some((key) => !actualKeys.includes(key))
  ) {
    return fail(code, `${label} must be a plain exact-shape object.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail(code, `${label} cannot contain accessors.`);
    }
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

function assertPlainJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail("PROFILE_INVALID", "Profile numbers must be finite.");
    return;
  }
  if (typeof value !== "object") return fail("PROFILE_INVALID", "Profile must contain JSON only.");
  if (seen.has(value)) return fail("PROFILE_INVALID", "Profile cannot contain cyclic data.");
  seen.add(value);
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return fail("PROFILE_INVALID", "Profile must contain plain JSON objects only.");
  }
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key === "symbol") ||
      Object.keys(value).length !== value.length
    ) {
      return fail("PROFILE_INVALID", "Profile arrays must be dense plain JSON arrays.");
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return fail("PROFILE_INVALID", "Profile arrays cannot contain accessors.");
      }
      assertPlainJson(descriptor.value, seen);
    }
    seen.delete(value);
    return;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return fail("PROFILE_INVALID", "Profile cannot contain symbols.");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return fail("PROFILE_INVALID", "Profile cannot contain accessors or hidden fields.");
    }
    assertPlainJson(descriptor.value, seen);
  }
  seen.delete(value);
}

function boundedText(value: unknown, label: string, maximum = 240): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    return fail("INPUT_INVALID", `${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = boundedText(value, label, 40);
  if (!UTC_TIMESTAMP.test(result) || !Number.isFinite(Date.parse(result))) {
    return fail("INPUT_INVALID", `${label} must be a valid UTC timestamp.`);
  }
  return result;
}

function sha256(value: unknown, label: string): Sha256 {
  const result = boundedText(value, label, 71);
  if (!SHA256.test(result))
    return fail("INPUT_INVALID", `${label} must be an exact SHA-256 digest.`);
  return result as Sha256;
}

function scopeSnapshot(value: WorkspaceActorScope): WorkspaceActorScope {
  const snapshot = exactPlainRecord(value, SCOPE_KEYS, "AUTHORIZATION_REQUIRED", "Actor scope");
  return Object.freeze({
    workspaceId: boundedText(snapshot.workspaceId, "workspaceId", 160),
    actorUserId: boundedText(snapshot.actorUserId, "actorUserId", 160),
  });
}

interface ValidCommand extends Omit<EditImageStyleProfileCommand, "candidateProfile"> {
  readonly candidateProfile: ImageStyleProfileDocument;
  readonly canonicalCandidateJson: string;
}

function commandSnapshot(value: EditImageStyleProfileCommand): ValidCommand {
  const snapshot = exactPlainRecord(value, COMMAND_KEYS, "INPUT_INVALID", "Edit command");
  if (!Number.isSafeInteger(snapshot.expectedRevision) || Number(snapshot.expectedRevision) < 1) {
    return fail("INPUT_INVALID", "expectedRevision must be a positive safe integer.");
  }
  assertPlainJson(snapshot.candidateProfile);
  let plainCandidate: unknown;
  let canonicalCandidateJson: string;
  try {
    canonicalCandidateJson = canonicalizeJson(snapshot.candidateProfile);
    plainCandidate = JSON.parse(canonicalCandidateJson);
  } catch {
    return fail("PROFILE_INVALID", "Candidate profile is not canonical JSON.");
  }
  const schema = validateContract("imageStyleProfile", plainCandidate);
  if (!schema.success) {
    return fail("PROFILE_INVALID", "Candidate is not a complete image-style-profile/v1 document.");
  }
  return Object.freeze({
    styleId: boundedText(snapshot.styleId, "styleId", 160),
    versionId: boundedText(snapshot.versionId, "versionId", 160),
    expectedRevision: Number(snapshot.expectedRevision),
    expectedCurrentArtifactHash: sha256(
      snapshot.expectedCurrentArtifactHash,
      "expectedCurrentArtifactHash",
    ),
    idempotencyKey: boundedText(snapshot.idempotencyKey, "idempotencyKey", 240),
    candidateProfile: schema.data,
    canonicalCandidateJson,
    editedAt: timestamp(snapshot.editedAt, "editedAt"),
  });
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stableUuid(namespace: string, ...parts: readonly string[]): string {
  const bytes = createHash("sha256")
    .update([namespace, ...parts].join("\u0000"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function escapePointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function changedLeafPointers(left: unknown, right: unknown, pointer: string): readonly string[] {
  if (sameJson(left, right)) return [];
  if (Array.isArray(left) || Array.isArray(right)) return [pointer];
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return [pointer];
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  return [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])]
    .sort()
    .flatMap((key) =>
      changedLeafPointers(
        leftRecord[key],
        rightRecord[key],
        `${pointer}/${escapePointerToken(key)}`,
      ),
    );
}

export function deriveImageStyleChangedPointers(
  previous: Pick<ImageStyleProfileDocument, "summary" | "visual_profile" | "prompt_profile">,
  candidate: Pick<ImageStyleProfileDocument, "summary" | "visual_profile" | "prompt_profile">,
): readonly string[] {
  return Object.freeze(
    [
      ...changedLeafPointers(previous.summary, candidate.summary, "/summary"),
      ...changedLeafPointers(previous.visual_profile, candidate.visual_profile, "/visual_profile"),
      ...changedLeafPointers(previous.prompt_profile, candidate.prompt_profile, "/prompt_profile"),
    ].sort(),
  );
}

async function verifiedDocument(
  artifact: ImageStyleProfileArtifact,
): Promise<ImageStyleProfileDocument> {
  const document = artifact.profileDocument;
  if (document.contractName !== "image-style-profile" || document.contractVersion !== "v1") {
    return fail("LINEAGE_INVALID", "Profile artifact contract identity is incompatible.");
  }
  const validated = await validateAndHashContractDocument("imageStyleProfile", document.payload);
  if (validated.sha256 !== document.canonicalDocumentSha256) {
    return fail("LINEAGE_INVALID", "Profile artifact canonical hash does not match its bytes.");
  }
  return validated.value;
}

async function validateLineage(
  version: EditableImageStyleVersion,
  root: ImageStyleProfileArtifact,
  current: ImageStyleProfileArtifact,
): Promise<
  Readonly<{ rootProfile: ImageStyleProfileDocument; currentProfile: ImageStyleProfileDocument }>
> {
  const matchingIdentity = (artifact: ImageStyleProfileArtifact): boolean =>
    artifact.workspaceId === version.workspaceId &&
    artifact.styleId === version.styleId &&
    artifact.versionId === version.versionId;
  if (
    !matchingIdentity(root) ||
    !matchingIdentity(current) ||
    root.artifactId !== version.rootSourceArtifactId ||
    root.profileDocument.canonicalDocumentSha256 !== version.rootSourceArtifactHash ||
    current.artifactId !== version.currentArtifactId ||
    current.profileDocument.canonicalDocumentSha256 !== version.currentArtifactHash ||
    root.origin !== "VISION_ANALYSIS" ||
    root.rootSourceArtifactId !== root.artifactId ||
    root.rootSourceArtifactHash !== root.profileDocument.canonicalDocumentSha256 ||
    root.parentArtifactId !== null ||
    root.parentArtifactHash !== null ||
    root.sourceAnalysisEvidence !== "HISTORICAL_SOURCE_TRUTH" ||
    current.rootSourceArtifactId !== root.artifactId ||
    current.rootSourceArtifactHash !== root.profileDocument.canonicalDocumentSha256 ||
    (current.origin === "VISION_ANALYSIS" && current.artifactId !== root.artifactId) ||
    (current.origin === "MANUAL_EDIT" &&
      (current.parentArtifactId === null ||
        current.parentArtifactHash === null ||
        current.sourceAnalysisEvidence !== null))
  ) {
    return fail("LINEAGE_INVALID", "Source/current artifact lineage is inconsistent.");
  }
  const rootProfile = await verifiedDocument(root);
  const currentProfile = await verifiedDocument(current);
  try {
    const validatedRoot = await validateStoredStyleProfile(rootProfile, root.referenceAliases);
    if (validatedRoot.styleProfileHash !== root.profileDocument.canonicalDocumentSha256) {
      return fail("LINEAGE_INVALID", "Source-analysis profile is not exact canonical truth.");
    }
    const currentWithSourceAnalysis = {
      ...currentProfile,
      analysis: rootProfile.analysis,
    };
    await validateStoredStyleProfile(currentWithSourceAnalysis, root.referenceAliases);
  } catch {
    return fail("LINEAGE_INVALID", "Stored source/current profile semantics are invalid.");
  }
  if (current.origin === "MANUAL_EDIT" && !sameJson(currentProfile.analysis, DETACHED_ANALYSIS)) {
    return fail("LINEAGE_INVALID", "Derived current profile has attached analyzer evidence.");
  }
  return deepFreeze({ rootProfile, currentProfile });
}

async function normalizedDerivedProfile(
  candidate: ImageStyleProfileDocument,
  rootProfile: ImageStyleProfileDocument,
  referenceAliases: readonly string[],
): Promise<Readonly<{ profileDocument: CanonicalDocument; canonicalProfileJson: string }>> {
  try {
    const semantics = await validateStoredStyleProfile(
      {
        schema_version: candidate.schema_version,
        summary: candidate.summary,
        visual_profile: candidate.visual_profile,
        prompt_profile: candidate.prompt_profile,
        analysis: rootProfile.analysis,
      },
      referenceAliases,
    );
    const derived = {
      ...semantics.profile,
      analysis: DETACHED_ANALYSIS,
    };
    const validated = await validateAndHashContractDocument("imageStyleProfile", derived);
    return deepFreeze({
      profileDocument: {
        contractName: "image-style-profile",
        contractVersion: "v1",
        payload: validated.value as JsonObject,
        canonicalDocumentSha256: validated.sha256 as Sha256,
      },
      canonicalProfileJson: canonicalizeJson(validated.value),
    });
  } catch (error) {
    if (error instanceof ImageStyleDerivedEditError) throw error;
    return fail("PROFILE_INVALID", "Candidate creative profile failed publication validation.");
  }
}

async function requestFingerprint(
  scope: WorkspaceActorScope,
  command: ValidCommand,
): Promise<Sha256> {
  const validated = await validateAndHashContractDocument(
    "imageStyleProfile",
    command.candidateProfile,
  );
  const value = canonicalizeJson({
    schema_version: "videoforge.image-style-derived-edit-request/v1",
    workspace_id: scope.workspaceId,
    style_id: command.styleId,
    version_id: command.versionId,
    actor_user_id: scope.actorUserId,
    expected_revision: command.expectedRevision,
    expected_current_artifact_hash: command.expectedCurrentArtifactHash,
    candidate_profile_hash: validated.sha256,
    candidate_profile: JSON.parse(command.canonicalCandidateJson),
  });
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}` as Sha256;
}

function resultFromRecord(
  record: ImageStyleDerivedEditRecord,
  replayed: boolean,
): EditedImageStyleProfile {
  return deepFreeze({
    kind: "IMAGE_STYLE_DERIVED_PROFILE_EDITED" as const,
    workspaceId: record.workspaceId,
    styleId: record.styleId,
    versionId: record.versionId,
    editorUserId: record.editorUserId,
    editedAt: record.editedAt,
    editId: record.editId,
    rootSourceArtifactId: record.rootSourceArtifactId,
    rootSourceArtifactHash: record.rootSourceArtifactHash,
    parentArtifactId: record.parentArtifactId,
    parentArtifactHash: record.parentArtifactHash,
    derivedArtifactId: record.derivedArtifactId,
    derivedArtifactHash: record.derivedArtifactHash,
    changedPointers: record.changedPointers,
    priorRevision: record.priorRevision,
    resultRevision: record.resultRevision,
    invalidatedReviewSnapshotId: record.invalidatedReviewSnapshotId,
    replayed,
  });
}

/** Provider-free domain service. Repository adapter owns SQL and transaction implementation. */
export class ImageStyleDerivedArtifactEditService {
  public constructor(private readonly persistence: ImageStyleDerivedEditPersistence) {}

  public async edit(
    scopeInput: WorkspaceActorScope,
    commandInput: EditImageStyleProfileCommand,
  ): Promise<EditedImageStyleProfile> {
    const scope = scopeSnapshot(scopeInput);
    const command = commandSnapshot(commandInput);
    const fingerprint = await requestFingerprint(scope, command);

    try {
      return await this.persistence.unitOfWork.execute(scope, async (repository) => {
        const replay = await repository.resolveEditByIdempotencyKey(scope, command.idempotencyKey);
        if (replay !== null) {
          if (
            replay.workspaceId !== scope.workspaceId ||
            replay.styleId !== command.styleId ||
            replay.versionId !== command.versionId ||
            replay.editorUserId !== scope.actorUserId ||
            replay.idempotencyKey !== command.idempotencyKey ||
            replay.requestFingerprintHash !== fingerprint
          ) {
            return fail(
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key was reused with different inputs.",
            );
          }
          return resultFromRecord(replay, true);
        }

        const version = await repository.lockVersionForEdit(scope, {
          styleId: command.styleId,
          versionId: command.versionId,
        });
        if (version === null)
          return fail("STYLE_NOT_FOUND", "Image Style version is not accessible.");
        if (version.builtIn || version.state === "PUBLISHED" || version.state === "ABANDONED") {
          return fail("STYLE_VERSION_IMMUTABLE", "Image Style version cannot be edited.");
        }
        if (version.state !== "NEEDS_REVIEW") {
          return fail("STYLE_VERSION_CONFLICT", "Image Style version is not awaiting review.");
        }
        if (
          version.revision !== command.expectedRevision ||
          version.currentArtifactHash !== command.expectedCurrentArtifactHash
        ) {
          return fail("STYLE_VERSION_CONFLICT", "Image Style edit revision or artifact is stale.");
        }
        if (
          version.workspaceId !== scope.workspaceId ||
          version.styleId !== command.styleId ||
          version.versionId !== command.versionId
        ) {
          return fail("STYLE_NOT_FOUND", "Image Style version is outside this workspace.");
        }

        const [root, current] = await Promise.all([
          repository.resolveArtifact(scope, version.rootSourceArtifactId),
          repository.resolveArtifact(scope, version.currentArtifactId),
        ]);
        if (root === null || current === null) {
          return fail("LINEAGE_INVALID", "Source/current profile artifact is missing.");
        }
        const lineage = await validateLineage(version, root, current);
        const normalized = await normalizedDerivedProfile(
          command.candidateProfile,
          lineage.rootProfile,
          root.referenceAliases,
        );
        const candidateProfile = normalized.profileDocument.payload as ImageStyleProfileDocument;
        const changedPointers = deriveImageStyleChangedPointers(
          lineage.currentProfile,
          candidateProfile,
        );
        if (changedPointers.length === 0) {
          return fail("STYLE_PROFILE_NO_CHANGES", "Candidate has no creative profile changes.");
        }

        const derivedArtifactHash = normalized.profileDocument.canonicalDocumentSha256;
        const editId = stableUuid("image-style-profile-edit", fingerprint);
        const derivedArtifactId = stableUuid(
          "image-style-profile-artifact",
          scope.workspaceId,
          command.versionId,
          fingerprint,
        );
        const record: ImageStyleDerivedEditRecord = deepFreeze({
          editId,
          workspaceId: scope.workspaceId,
          styleId: command.styleId,
          versionId: command.versionId,
          editorUserId: scope.actorUserId,
          editedAt: command.editedAt,
          idempotencyKey: command.idempotencyKey,
          requestFingerprintHash: fingerprint,
          expectedRevision: command.expectedRevision,
          priorRevision: version.revision,
          resultRevision: version.revision + 1,
          rootSourceArtifactId: root.artifactId,
          rootSourceArtifactHash: root.profileDocument.canonicalDocumentSha256,
          parentArtifactId: current.artifactId,
          parentArtifactHash: current.profileDocument.canonicalDocumentSha256,
          derivedArtifactId,
          derivedArtifactHash,
          changedPointers,
          invalidatedReviewSnapshotId: version.reviewSnapshotId,
        });
        const derivedArtifact: ImageStyleProfileArtifact = deepFreeze({
          artifactId: derivedArtifactId,
          workspaceId: scope.workspaceId,
          styleId: command.styleId,
          versionId: command.versionId,
          origin: "MANUAL_EDIT" as const,
          profileDocument: normalized.profileDocument,
          rootSourceArtifactId: root.artifactId,
          rootSourceArtifactHash: root.profileDocument.canonicalDocumentSha256,
          parentArtifactId: current.artifactId,
          parentArtifactHash: current.profileDocument.canonicalDocumentSha256,
          sourceAnalysisEvidence: null,
          referenceAliases: Object.freeze([]),
          createdAt: command.editedAt,
        });
        const committed = await repository.commitDerivedEdit(scope, {
          edit: record,
          derivedArtifact,
          canonicalProfileJson: normalized.canonicalProfileJson,
          expectedState: "NEEDS_REVIEW",
          expectedCurrentArtifactId: current.artifactId,
          expectedCurrentArtifactHash: current.profileDocument.canonicalDocumentSha256,
          expectedRevision: version.revision,
        });
        if (!sameJson(committed, record)) {
          return fail(
            "REPOSITORY_FAILURE",
            "Committed edit result does not match request fingerprint.",
          );
        }
        return resultFromRecord(committed, false);
      });
    } catch (error) {
      if (error instanceof ImageStyleDerivedEditError) throw error;
      return fail("REPOSITORY_FAILURE", "Image Style edit transaction failed.");
    }
  }
}
