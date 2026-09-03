import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { SqlExecutor } from "@videoforge/control-plane";
import type {
  HostedNeonPool,
  HostedRuntimeConfiguration,
  HostedRuntimeEnvironment,
} from "./configuration";
import {
  HostedCanonicalTimingPersistence,
  HostedCanonicalTimingPersistenceError,
} from "./generation-persistence";
import { sha256, sha256Bytes } from "./crypto";
import {
  analyzeStyleWithRunwareGemini,
  runwareGeminiStyleActualCostMicroUsd,
  RUNWARE_GEMINI_STYLE_MAX_INPUT_BYTES,
  RunwareGeminiStyleAnalysisError,
  type RunwareGeminiStyleImage,
} from "./runware-gemini-style-analysis";
import {
  HostedAudioValidationError,
  hostedVoiceoverArtifactProbe,
  validateHostedVoiceover,
} from "./audio-validation";
import { hostedGpuReadinessForConfiguration, type HostedGpuReadiness } from "./gpu-readiness";
import { createNeonExecutor, createNeonPool } from "./neon";
import { HostedR2Signer } from "./r2";
import { canonicalJson } from "./submission";
import {
  hostedPromptAuthority,
  hostedPromptBatchPlan,
  hostedPromptBatchPlanDocument,
  runHostedPromptExecution,
  type HostedPromptIdentity,
} from "./hosted-prompt-run";
import {
  HOSTED_PROMPT_RESERVATION_MICRO_USD,
  HostedPromptExecutionError,
} from "./runware-prompt-execution";
import { RunwareTransportError } from "../providers/runware-http-transport";
import {
  extractHostedVoiceoverContext,
  HOSTED_CONTEXT_RESERVATION_MICRO_USD,
  HostedVoiceoverContextProviderError,
  prepareHostedVoiceoverContextRequest,
  reconcileHostedVoiceoverContext,
} from "./voiceover-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u;
const VOICEOVER_TYPES = new Set(["audio/mpeg", "audio/wav"]);
const GENERATION_MODES = new Set(["LOWEST_COST", "BALANCED", "FASTER"]);
const MAX_VOICEOVER_BYTES = 1_073_741_824;
const MAX_SPEND_CAP_USD = 2;
const MAX_EXTRA_PROMPT_KEYWORDS = 500;
const MAX_OPTIONAL_SCRIPT = 100_000;
const HOSTED_TARGETED_RETRY_QUALIFIED = false;
// Stages 3 and 5 reserve $0.01 and $0.04 respectively, so the persisted project ceiling must
// accept their exact combined bounded cap without authorizing later GPU work.
const PERSONAL_WORKER_MINIMUM_COST_MICRO_USD = 50_000;

function hostedProviderFreePresetCreationEnabled(config: HostedRuntimeConfiguration): boolean {
  return config.environment === "staging" && config.gpuTransport === "DISABLED_UNQUALIFIED";
}

function validFilename(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 160 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    [...value].every((character) => character.charCodeAt(0) >= 32)
  );
}

interface HostedScope extends Record<string, unknown> {
  readonly user_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
}

interface ProjectCreateInput {
  readonly title: string;
  readonly avatarVersionId: string;
  readonly styleVersionId: string;
  readonly optionalScript: string | null;
  readonly extraPromptKeywords: string | null;
  readonly applyExtraPromptKeywords: boolean;
  readonly generationMode: "LOWEST_COST" | "BALANCED" | "FASTER";
  readonly spendCapUsd: number;
  readonly userSeed: number | null;
  readonly voiceover: {
    readonly filename: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly checksumSha256: string;
    readonly durationMs: number;
  };
}

export function hostedRevisionConfigV2(input: {
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly title: string;
  readonly voiceoverAssetId: string;
  readonly voiceoverSha256: string;
  readonly avatarProfileId: string;
  readonly avatarProfileVersionId: string;
  readonly avatarDisplayName: string;
  readonly avatarProfileHash: string;
  readonly avatarRuntimeSourceAssetId: string;
  readonly avatarRuntimeSourceSha256: string;
  readonly avatarSourcePreparationVersion: string;
  readonly avatarSourceValidationProfileVersion: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: string;
  readonly schedulerSeed: number;
  readonly optionalScript?: string | null;
  readonly extraPromptKeywords?: string | null;
  readonly applyExtraPromptKeywords?: boolean;
  readonly generationMode?: "LOWEST_COST" | "BALANCED" | "FASTER";
  readonly spendCapUsd?: number;
}) {
  const extraPromptKeywords = input.extraPromptKeywords ?? null;
  const applyExtraPromptKeywords = input.applyExtraPromptKeywords ?? false;
  const generationMode = input.generationMode ?? "LOWEST_COST";
  const spendCapUsd = input.spendCapUsd ?? PERSONAL_WORKER_MINIMUM_COST_MICRO_USD / 1_000_000;
  return {
    schema_version: "project-revision-config/v2" as const,
    project_id: input.projectId,
    project_revision_id: input.projectRevisionId,
    title: input.title,
    voiceover_asset_id: input.voiceoverAssetId,
    voiceover_sha256: input.voiceoverSha256,
    avatar_binding: {
      avatar_profile_id: input.avatarProfileId,
      avatar_profile_version_id: input.avatarProfileVersionId,
      avatar_display_name_snapshot: input.avatarDisplayName,
      avatar_profile_hash: input.avatarProfileHash,
      runtime_source_asset_id: input.avatarRuntimeSourceAssetId,
      runtime_source_sha256: input.avatarRuntimeSourceSha256,
      source_preparation_version: input.avatarSourcePreparationVersion,
      source_validation_profile_version: input.avatarSourceValidationProfileVersion,
      compatibility_state_at_preflight: "UNTESTED" as const,
      compatibility_evidence: null,
    },
    optional_script: input.optionalScript ?? null,
    image_style_version_id: input.imageStyleVersionId,
    style_profile_hash: input.styleProfileHash,
    extra_prompt_keywords: extraPromptKeywords,
    apply_extra_prompt_keywords: applyExtraPromptKeywords,
    generation_mode: generationMode,
    execution_profiles: {
      image_media_profile_id: "serverless-mage-image-v1",
      avatar_primary_profile_id: "serverless-soulx-flashhead-pro-v1",
      avatar_repair_profile_id: null,
      avatar_quality_profile_id: null,
    },
    spend_cap_usd: spendCapUsd,
    scheduler_version: "scheduler-v2",
    scheduler_seed: input.schedulerSeed,
    prompt_writer_version: "scene-prompt-writer-v1",
    prompt_compiler_version: "mage-prompt-compiler-v1",
  };
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-06",
    },
  });
}

function rateLimitedResponse(): Response {
  return Response.json(
    { error: { code: "HOSTED_RATE_LIMITED", retryable: true } },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "retry-after": "60",
        "x-content-type-options": "nosniff",
        "x-videoforge-runtime": "hosted-v2-06",
      },
    },
  );
}

function unavailableHostedCapability(code: string): Response {
  return response(
    {
      error: {
        code,
        message:
          code === "PRESET_CREATION_NOT_QUALIFIED"
            ? "This release supports built-in and already-ready tenant presets only."
            : "Targeted GPU retry is not qualified in this release; no replacement was dispatched.",
      },
    },
    409,
  );
}

function sameOrigin(request: Request, config: HostedRuntimeConfiguration): boolean {
  return request.headers.get("origin") === new URL(config.publicOrigin).origin;
}

async function sessionScope(
  request: Request,
  config: HostedRuntimeConfiguration,
  pool: HostedNeonPool,
  executionContext: HostedExecutionContext,
): Promise<HostedScope | Response> {
  const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  const rateLimitOperation = hostedRateLimitOperation(request);
  const rateLimit = await pool.query<{ allowed: boolean }>(
    `SELECT videoforge_consume_hosted_rate_limit($1, $2) AS allowed`,
    [session.session.token, rateLimitOperation],
  );
  if (rateLimit.rows[0]?.allowed !== true) return rateLimitedResponse();
  const result = await pool.query<HostedScope>(
    `SELECT user_id, account_id, workspace_id
       FROM videoforge_hosted_session_scope($1)`,
    [session.session.token],
  );
  const scope = result.rows[0];
  if (!scope) return response({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
  return scope;
}

function hostedRateLimitOperation(
  request: Request,
): "hosted_read" | "project_create" | "project_commit" | "project_review" | "hosted_mutation" {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" || path === "/api/v2/hosted/projects/preflight") {
    return "hosted_read";
  }
  if (path === "/api/v2/hosted/projects") return "project_create";
  if (/^\/api\/v2\/hosted\/projects\/[0-9a-f-]+\/commit$/u.test(path)) {
    return "project_commit";
  }
  if (/^\/api\/v2\/hosted\/projects\/[0-9a-f-]+\/review$/u.test(path)) {
    return "project_review";
  }
  return "hosted_mutation";
}

function parseCreate(value: unknown): ProjectCreateInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = new Set(Object.keys(record));
  const legacyKeys = [
    "avatar_profile_version_id",
    "image_style_version_id",
    "schema_version",
    "title",
    "voiceover",
  ];
  const v2Keys = [
    ...legacyKeys,
    "apply_extra_prompt_keywords",
    "extra_prompt_keywords",
    "generation_mode",
    "optional_script",
    "spend_cap_usd",
    "user_seed",
  ];
  const schemaVersion = record.schema_version;
  if (
    schemaVersion !== "videoforge-hosted-project-create/v1" &&
    schemaVersion !== "videoforge-hosted-project-create/v2" &&
    schemaVersion !== "videoforge-hosted-project-preflight/v1"
  )
    return null;
  if (
    (schemaVersion === "videoforge-hosted-project-create/v1" &&
      (keys.size !== legacyKeys.length || legacyKeys.some((key) => !keys.has(key)))) ||
    (schemaVersion !== "videoforge-hosted-project-create/v1" &&
      (keys.size < legacyKeys.length ||
        keys.size > v2Keys.length ||
        [...keys].some((key) => !v2Keys.includes(key)))) ||
    typeof record.title !== "string" ||
    record.title !== record.title.trim() ||
    record.title.length < 1 ||
    record.title.length > 240 ||
    typeof record.avatar_profile_version_id !== "string" ||
    !UUID.test(record.avatar_profile_version_id) ||
    typeof record.image_style_version_id !== "string" ||
    !UUID.test(record.image_style_version_id) ||
    !record.voiceover ||
    typeof record.voiceover !== "object" ||
    Array.isArray(record.voiceover)
  ) {
    return null;
  }
  const voiceover = record.voiceover as Record<string, unknown>;
  if (
    Object.keys(voiceover).sort().join(",") !==
      "checksum_sha256,content_length,content_type,duration_ms,filename" ||
    typeof voiceover.filename !== "string" ||
    !validFilename(voiceover.filename) ||
    typeof voiceover.content_type !== "string" ||
    !VOICEOVER_TYPES.has(voiceover.content_type) ||
    !Number.isSafeInteger(voiceover.content_length) ||
    Number(voiceover.content_length) < 1 ||
    Number(voiceover.content_length) > MAX_VOICEOVER_BYTES ||
    typeof voiceover.checksum_sha256 !== "string" ||
    !SHA256.test(voiceover.checksum_sha256) ||
    !Number.isSafeInteger(voiceover.duration_ms) ||
    Number(voiceover.duration_ms) < 10_000 ||
    Number(voiceover.duration_ms) > 3_600_000
  ) {
    return null;
  }
  const optionalScript = record.optional_script;
  const extraPromptKeywords = record.extra_prompt_keywords;
  const applyExtraPromptKeywords = record.apply_extra_prompt_keywords;
  const generationMode = record.generation_mode;
  const spendCapUsd = record.spend_cap_usd;
  const userSeed = record.user_seed;
  if (
    (optionalScript !== undefined &&
      optionalScript !== null &&
      (typeof optionalScript !== "string" || optionalScript.length > MAX_OPTIONAL_SCRIPT)) ||
    (extraPromptKeywords !== undefined &&
      extraPromptKeywords !== null &&
      (typeof extraPromptKeywords !== "string" ||
        extraPromptKeywords.length > MAX_EXTRA_PROMPT_KEYWORDS)) ||
    (applyExtraPromptKeywords !== undefined && typeof applyExtraPromptKeywords !== "boolean") ||
    (generationMode !== undefined &&
      (typeof generationMode !== "string" || !GENERATION_MODES.has(generationMode))) ||
    (spendCapUsd !== undefined &&
      (typeof spendCapUsd !== "number" ||
        !Number.isFinite(spendCapUsd) ||
        spendCapUsd < PERSONAL_WORKER_MINIMUM_COST_MICRO_USD / 1_000_000 ||
        spendCapUsd > MAX_SPEND_CAP_USD)) ||
    (userSeed !== undefined &&
      userSeed !== null &&
      (typeof userSeed !== "number" ||
        !Number.isSafeInteger(userSeed) ||
        Number(userSeed) < 0 ||
        Number(userSeed) > 4_294_967_295)) ||
    (applyExtraPromptKeywords === true &&
      (typeof extraPromptKeywords !== "string" || !/\S/u.test(extraPromptKeywords)))
  ) {
    return null;
  }
  return {
    title: record.title,
    avatarVersionId: record.avatar_profile_version_id,
    styleVersionId: record.image_style_version_id,
    optionalScript: typeof optionalScript === "string" ? optionalScript : null,
    extraPromptKeywords: typeof extraPromptKeywords === "string" ? extraPromptKeywords : null,
    applyExtraPromptKeywords: applyExtraPromptKeywords === true,
    generationMode:
      generationMode === "BALANCED" || generationMode === "FASTER" ? generationMode : "LOWEST_COST",
    spendCapUsd: typeof spendCapUsd === "number" ? spendCapUsd : 0.1,
    userSeed: typeof userSeed === "number" ? userSeed : null,
    voiceover: {
      filename: voiceover.filename,
      contentType: voiceover.content_type,
      contentLength: Number(voiceover.content_length),
      checksumSha256: voiceover.checksum_sha256,
      durationMs: Number(voiceover.duration_ms),
    },
  };
}

function parseRenderHandoff(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.asr_attempt_id !== "string") return null;
  return UUID.test(record.asr_attempt_id) ? record.asr_attempt_id : null;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PRESET_SOURCE_BYTES = 20 * 1024 * 1024;

interface HostedAvatarCreateInput {
  readonly name: string;
  readonly parentId: string | null;
  readonly source: {
    readonly filename: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly checksumSha256: string;
    readonly width: number;
    readonly height: number;
  };
  readonly rightsAttested: boolean;
  readonly likenessAnimationConsent: boolean;
}

interface HostedStyleReferenceInput {
  readonly filename: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
  readonly normalizedContentLength: number;
  readonly normalizedChecksumSha256: string;
  readonly normalizedWidth: number;
  readonly normalizedHeight: number;
  readonly orderIndex: number;
}

interface HostedStyleCreateInput {
  readonly name: string;
  readonly parentId: string | null;
  readonly references: readonly HostedStyleReferenceInput[];
  readonly rightsAttested: boolean;
  readonly processingDisclosureAcknowledged: boolean;
  readonly originalRetentionPolicy: "RETAIN";
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && UUID.test(value)) return value;
  return undefined;
}

function parseAvatarCreate(value: unknown): HostedAvatarCreateInput | null {
  const record = plainRecord(value);
  if (
    !record ||
    !exactKeys(record, [
      "schema_version",
      "name",
      "parent_profile_id",
      "source",
      "rights_attested",
      "likeness_animation_consent",
    ]) ||
    record.schema_version !== "videoforge-hosted-avatar-create/v1" ||
    typeof record.name !== "string" ||
    record.name !== record.name.trim() ||
    record.name.length < 1 ||
    record.name.length > 160 ||
    typeof record.rights_attested !== "boolean" ||
    typeof record.likeness_animation_consent !== "boolean"
  ) {
    return null;
  }
  const parentId = optionalUuid(record.parent_profile_id);
  const source = plainRecord(record.source);
  const contentLength = source?.content_length;
  const width = source?.width;
  const height = source?.height;
  if (
    parentId === undefined ||
    !source ||
    !exactKeys(source, [
      "filename",
      "content_type",
      "content_length",
      "checksum_sha256",
      "width",
      "height",
    ]) ||
    typeof source.filename !== "string" ||
    !validFilename(source.filename) ||
    typeof source.content_type !== "string" ||
    !IMAGE_TYPES.has(source.content_type) ||
    typeof contentLength !== "number" ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_PRESET_SOURCE_BYTES ||
    typeof source.checksum_sha256 !== "string" ||
    !SHA256.test(source.checksum_sha256) ||
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width < 512 ||
    width > 16_384 ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height < 512 ||
    height > 16_384
  ) {
    return null;
  }
  return {
    name: record.name,
    parentId,
    source: {
      filename: source.filename,
      contentType: source.content_type,
      contentLength,
      checksumSha256: source.checksum_sha256,
      width,
      height,
    },
    rightsAttested: record.rights_attested,
    likenessAnimationConsent: record.likeness_animation_consent,
  };
}

function parseStyleCreate(value: unknown): HostedStyleCreateInput | null {
  const record = plainRecord(value);
  if (
    !record ||
    !exactKeys(record, [
      "schema_version",
      "name",
      "parent_style_id",
      "references",
      "rights_attested",
      "processing_disclosure_acknowledged",
      "original_retention_policy",
    ]) ||
    record.schema_version !== "videoforge-hosted-style-create/v1" ||
    typeof record.name !== "string" ||
    record.name !== record.name.trim() ||
    record.name.length < 1 ||
    record.name.length > 160 ||
    typeof record.rights_attested !== "boolean" ||
    typeof record.processing_disclosure_acknowledged !== "boolean" ||
    record.original_retention_policy !== "RETAIN" ||
    !Array.isArray(record.references) ||
    record.references.length < 3 ||
    record.references.length > 8
  ) {
    return null;
  }
  const parentId = optionalUuid(record.parent_style_id);
  if (parentId === undefined) return null;
  const references: HostedStyleReferenceInput[] = [];
  for (const rawReference of record.references) {
    const reference = plainRecord(rawReference);
    const contentLength = reference?.content_length;
    const orderIndex = reference?.order_index;
    if (
      !reference ||
      !exactKeys(reference, [
        "filename",
        "content_type",
        "content_length",
        "checksum_sha256",
        "normalized_content_length",
        "normalized_checksum_sha256",
        "normalized_width",
        "normalized_height",
        "order_index",
      ]) ||
      typeof reference.filename !== "string" ||
      !validFilename(reference.filename) ||
      typeof reference.content_type !== "string" ||
      !IMAGE_TYPES.has(reference.content_type) ||
      typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > MAX_PRESET_SOURCE_BYTES ||
      typeof reference.checksum_sha256 !== "string" ||
      !SHA256.test(reference.checksum_sha256) ||
      typeof reference.normalized_content_length !== "number" ||
      !Number.isSafeInteger(reference.normalized_content_length) ||
      reference.normalized_content_length < 1 ||
      reference.normalized_content_length > MAX_PRESET_SOURCE_BYTES ||
      typeof reference.normalized_checksum_sha256 !== "string" ||
      !SHA256.test(reference.normalized_checksum_sha256) ||
      typeof reference.normalized_width !== "number" ||
      !Number.isSafeInteger(reference.normalized_width) ||
      reference.normalized_width < 1 ||
      reference.normalized_width > 1_600 ||
      typeof reference.normalized_height !== "number" ||
      !Number.isSafeInteger(reference.normalized_height) ||
      reference.normalized_height < 1 ||
      reference.normalized_height > 1_600 ||
      typeof orderIndex !== "number" ||
      !Number.isSafeInteger(orderIndex) ||
      orderIndex < 0 ||
      orderIndex > 7
    ) {
      return null;
    }
    references.push({
      filename: reference.filename,
      contentType: reference.content_type,
      contentLength,
      checksumSha256: reference.checksum_sha256,
      normalizedContentLength: reference.normalized_content_length,
      normalizedChecksumSha256: reference.normalized_checksum_sha256,
      normalizedWidth: reference.normalized_width,
      normalizedHeight: reference.normalized_height,
      orderIndex,
    });
  }
  const order = references.map((reference) => reference.orderIndex).sort((a, b) => a - b);
  if (order.some((value, index) => value !== index)) return null;
  if (
    references.reduce((total, reference) => total + reference.normalizedContentLength, 0) >
    RUNWARE_GEMINI_STYLE_MAX_INPUT_BYTES
  )
    return null;
  return {
    name: record.name,
    parentId,
    references,
    rightsAttested: record.rights_attested,
    processingDisclosureAcknowledged: record.processing_disclosure_acknowledged,
    originalRetentionPolicy: record.original_retention_policy,
  };
}

interface HostedStyleReferenceReplacementInput {
  readonly references: readonly HostedStyleReferenceInput[];
}

function parseStyleReferenceReplacement(
  value: unknown,
): HostedStyleReferenceReplacementInput | null {
  const record = plainRecord(value);
  if (
    !record ||
    !exactKeys(record, ["schema_version", "references"]) ||
    record.schema_version !== "videoforge-hosted-style-reference-replace/v1" ||
    !Array.isArray(record.references) ||
    record.references.length < 3 ||
    record.references.length > 8
  )
    return null;
  const references: HostedStyleReferenceInput[] = [];
  for (const rawReference of record.references) {
    const reference = plainRecord(rawReference);
    const contentLength = reference?.content_length;
    const orderIndex = reference?.order_index;
    if (
      !reference ||
      !exactKeys(reference, [
        "filename",
        "content_type",
        "content_length",
        "checksum_sha256",
        "normalized_content_length",
        "normalized_checksum_sha256",
        "normalized_width",
        "normalized_height",
        "order_index",
      ]) ||
      typeof reference.filename !== "string" ||
      !validFilename(reference.filename) ||
      typeof reference.content_type !== "string" ||
      !IMAGE_TYPES.has(reference.content_type) ||
      typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > MAX_PRESET_SOURCE_BYTES ||
      typeof reference.checksum_sha256 !== "string" ||
      !SHA256.test(reference.checksum_sha256) ||
      typeof reference.normalized_content_length !== "number" ||
      !Number.isSafeInteger(reference.normalized_content_length) ||
      reference.normalized_content_length < 1 ||
      reference.normalized_content_length > MAX_PRESET_SOURCE_BYTES ||
      typeof reference.normalized_checksum_sha256 !== "string" ||
      !SHA256.test(reference.normalized_checksum_sha256) ||
      typeof reference.normalized_width !== "number" ||
      !Number.isSafeInteger(reference.normalized_width) ||
      reference.normalized_width < 1 ||
      reference.normalized_width > 1_600 ||
      typeof reference.normalized_height !== "number" ||
      !Number.isSafeInteger(reference.normalized_height) ||
      reference.normalized_height < 1 ||
      reference.normalized_height > 1_600 ||
      typeof orderIndex !== "number" ||
      !Number.isSafeInteger(orderIndex) ||
      orderIndex < 0 ||
      orderIndex > 7
    ) {
      return null;
    }
    references.push({
      filename: reference.filename,
      contentType: reference.content_type,
      contentLength,
      checksumSha256: reference.checksum_sha256,
      normalizedContentLength: reference.normalized_content_length,
      normalizedChecksumSha256: reference.normalized_checksum_sha256,
      normalizedWidth: reference.normalized_width,
      normalizedHeight: reference.normalized_height,
      orderIndex,
    });
  }
  const order = references.map((reference) => reference.orderIndex).sort((a, b) => a - b);
  if (order.some((value, index) => value !== index)) return null;
  if (
    references.reduce((total, reference) => total + reference.normalizedContentLength, 0) >
    RUNWARE_GEMINI_STYLE_MAX_INPUT_BYTES
  )
    return null;
  return { references };
}

function parseEmptyObject(value: unknown): boolean {
  const record = plainRecord(value);
  return record !== null && Object.keys(record).length === 0;
}

function parseAvatarApproval(value: unknown): { rights: boolean; likeness: boolean } | null {
  const record = plainRecord(value);
  if (
    !record ||
    !exactKeys(record, ["schema_version", "rights_attested", "likeness_animation_consent"]) ||
    record.schema_version !== "videoforge-hosted-avatar-approval/v1" ||
    record.rights_attested !== true ||
    record.likeness_animation_consent !== true
  ) {
    return null;
  }
  return { rights: true, likeness: true };
}

function parseStyleAnalysis(value: unknown): boolean {
  const record = plainRecord(value);
  return (
    record !== null &&
    exactKeys(record, ["schema_version"]) &&
    record.schema_version === "videoforge-hosted-style-analysis/v1"
  );
}

function parseStylePublish(
  value: unknown,
): { rights: boolean; disclosure: boolean; candidate: Record<string, unknown> | null } | null {
  const record = plainRecord(value);
  if (
    !record ||
    !exactKeys(record, [
      "schema_version",
      "rights_attested",
      "processing_disclosure_acknowledged",
      "candidate_profile",
    ]) ||
    record.schema_version !== "videoforge-hosted-style-publish/v1" ||
    record.rights_attested !== true ||
    record.processing_disclosure_acknowledged !== true ||
    (record.candidate_profile !== undefined &&
      record.candidate_profile !== null &&
      plainRecord(record.candidate_profile) === null)
  ) {
    return null;
  }
  return {
    rights: true,
    disclosure: true,
    candidate: plainRecord(record.candidate_profile),
  };
}

function parseRetry(value: unknown): { attemptId: string; assetId: string | null } | null {
  const record = plainRecord(value);
  if (
    !record ||
    !exactKeys(record, ["attempt_id", "asset_id"]) ||
    typeof record.attempt_id !== "string" ||
    !UUID.test(record.attempt_id) ||
    (record.asset_id !== null &&
      (typeof record.asset_id !== "string" || !UUID.test(record.asset_id)))
  ) {
    return null;
  }
  return { attemptId: record.attempt_id, assetId: record.asset_id };
}

function uuidFromDigest(digest: string): string {
  const bytes = digest.slice("sha256:".length).slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(bytes[16]!, 16) % 4]!;
  return `${bytes.slice(0, 8).join("")}-${bytes.slice(8, 12).join("")}-${bytes
    .slice(12, 16)
    .join("")}-${bytes.slice(16, 20).join("")}-${bytes.slice(20).join("")}`;
}

async function stableHostedUuid(namespace: string): Promise<string> {
  return uuidFromDigest(await sha256(namespace));
}

function avatarProfilePayload(input: {
  readonly assetId: string;
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly width: number;
  readonly height: number;
  readonly userId: string;
  readonly now: string;
}): Record<string, unknown> {
  return {
    schema_version: "avatar-profile-version/v1",
    source_asset_id: input.assetId,
    source_sha256: input.checksumSha256,
    source_media: {
      mime_type: input.contentType,
      width: input.width,
      height: input.height,
      bytes: input.contentLength,
    },
    runtime_source_asset_id: input.assetId,
    runtime_source_sha256: input.checksumSha256,
    thumbnail_asset_id: input.assetId,
    thumbnail_sha256: input.checksumSha256,
    source_preparation_version: "hosted-avatar-source-pass-through-v1",
    source_validation_profile_version: "hosted-avatar-source-validation-v1",
    framing_confirmation: {
      one_primary_presenter: true,
      horizontally_centered: true,
      direct_to_camera_suitable: true,
      confirmed_by_user_id: input.userId,
      confirmed_at: input.now,
    },
    rights_basis: "OTHER_DOCUMENTED_BASIS",
    rights_attested_by_user_id: input.userId,
    rights_attested_at: input.now,
    avatar_generation_consent: true,
    likeness_animation_rights_attested: true,
    likeness_attested_by_user_id: input.userId,
    likeness_attested_at: input.now,
  };
}

type HostedPresetRow = Record<string, unknown>;

function rowString(row: HostedPresetRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Missing preset field ${key}`);
  return value;
}

function sqlValue(value: unknown): string | number | boolean | Date | Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return null;
}

async function cloneSystemAsset(
  transaction: SqlExecutor,
  scope: HostedScope,
  source: HostedPresetRow,
  namespace: string,
): Promise<{ readonly id: string; readonly checksum: string }> {
  const sourceId = rowString(source, "id");
  const checksum = rowString(source, "binary_sha256");
  const existing = await transaction.query<HostedPresetRow>(
    `SELECT id, binary_sha256
       FROM assets
      WHERE account_id = $1 AND workspace_id = $2
        AND metadata ->> 'system_source_asset_id' = $3
        AND binary_sha256 = $4
      LIMIT 1`,
    [scope.account_id, scope.workspace_id, sourceId, checksum],
  );
  if (existing.rows[0]) {
    return { id: rowString(existing.rows[0], "id"), checksum };
  }
  const objectKey = typeof source.object_key === "string" ? source.object_key : null;
  if (objectKey) {
    const objectKeyMatch = await transaction.query<HostedPresetRow>(
      `SELECT id, binary_sha256
         FROM assets
        WHERE account_id = $1 AND workspace_id = $2 AND object_key = $3
          AND binary_sha256 = $4
        LIMIT 1`,
      [scope.account_id, scope.workspace_id, objectKey, checksum],
    );
    if (objectKeyMatch.rows[0]) {
      return { id: rowString(objectKeyMatch.rows[0], "id"), checksum };
    }
  }
  const id = await stableHostedUuid(namespace);
  await transaction.query(
    `INSERT INTO assets (
       id, account_id, workspace_id, kind, state, object_key, binary_sha256,
       content_type, byte_size, width_px, height_px, duration_ms, metadata, verified_at
     ) VALUES ($1,$2,$3,$4,'VERIFIED',$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [
      id,
      scope.account_id,
      scope.workspace_id,
      typeof source.kind === "string" ? source.kind : "OTHER",
      objectKey,
      checksum,
      sqlValue(source.content_type),
      sqlValue(source.byte_size),
      sqlValue(source.width_px),
      sqlValue(source.height_px),
      sqlValue(source.duration_ms),
      JSON.stringify({
        system_source_asset_id: sourceId,
        system_source_scope: "SYSTEM",
        materialization: "hosted-system-preset-snapshot-v1",
      }),
    ],
  );
  return { id, checksum };
}

async function materializeSystemAvatar(
  transaction: SqlExecutor,
  scope: HostedScope,
  source: HostedPresetRow,
): Promise<HostedPresetRow> {
  const sourceVersionId = rowString(source, "version_id");
  const sourceHash = rowString(source, "profile_hash");
  const existing = await transaction.query<HostedPresetRow>(
    `SELECT profile.id AS profile_id, profile.name AS profile_name,
            version.id AS version_id, version.profile_hash,
            version.runtime_source_asset_id, version.runtime_source_binary_sha256,
            version.source_preparation_profile, version.source_validation_profile
       FROM avatar_profiles AS profile
       JOIN avatar_profile_versions AS version
         ON version.account_id = profile.account_id
        AND version.workspace_id = profile.workspace_id
        AND version.profile_id = profile.id
      WHERE profile.account_id = $1 AND profile.workspace_id = $2
        AND profile.scope_kind = 'WORKSPACE' AND profile.status = 'ACTIVE'
        AND version.state = 'READY' AND version.profile_hash = $3
      ORDER BY version.version_number DESC LIMIT 1`,
    [scope.account_id, scope.workspace_id, sourceHash],
  );
  if (existing.rows[0]) return existing.rows[0];

  const snapshotResult = await transaction.query<HostedPresetRow>(
    `SELECT * FROM videoforge_read_system_avatar_version_assets($1)`,
    [sourceVersionId],
  );
  const snapshot = snapshotResult.rows[0];
  if (!snapshot) throw new Error("System avatar asset snapshot is unavailable");
  const originalSource: HostedPresetRow = {
    id: snapshot.original_asset_id,
    kind: "AVATAR_ORIGINAL",
    object_key: snapshot.original_object_key,
    binary_sha256: snapshot.original_binary_sha256,
    content_type: snapshot.original_content_type,
    byte_size: snapshot.original_byte_size,
    width_px: snapshot.original_width_px,
    height_px: snapshot.original_height_px,
    duration_ms: snapshot.original_duration_ms,
    metadata: snapshot.original_metadata,
  };
  const runtimeSource: HostedPresetRow = {
    id: snapshot.runtime_source_asset_id,
    kind: "AVATAR_RUNTIME",
    object_key: snapshot.runtime_object_key,
    binary_sha256: snapshot.runtime_binary_sha256,
    content_type: snapshot.runtime_content_type,
    byte_size: snapshot.runtime_byte_size,
    width_px: snapshot.runtime_width_px,
    height_px: snapshot.runtime_height_px,
    duration_ms: snapshot.runtime_duration_ms,
    metadata: snapshot.runtime_metadata,
  };
  const original = await cloneSystemAsset(
    transaction,
    scope,
    originalSource,
    `system-avatar:${scope.account_id}:${sourceVersionId}:original`,
  );
  const runtime = await cloneSystemAsset(
    transaction,
    scope,
    runtimeSource,
    `system-avatar:${scope.account_id}:${sourceVersionId}:runtime`,
  );
  const profileId = await stableHostedUuid(
    `system-avatar:${scope.account_id}:${sourceVersionId}:profile`,
  );
  const versionId = await stableHostedUuid(
    `system-avatar:${scope.account_id}:${sourceVersionId}:version`,
  );
  const sourceName = rowString(source, "profile_name");
  const profileName = `${sourceName.slice(0, 145)} (system copy)`;
  await transaction.query(
    `INSERT INTO avatar_profiles (
       id, account_id, workspace_id, name, normalized_name, status, created_by_user_id
     ) VALUES ($1,$2,$3,$4,lower($4),'ACTIVE',$5)
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [profileId, scope.account_id, scope.workspace_id, profileName, scope.user_id],
  );
  const payload = {
    ...(plainRecord(source.profile_payload) ?? {}),
    schema_version: "avatar-profile-version/v1",
    source_asset_id: original.id,
    source_sha256: original.checksum,
    runtime_source_asset_id: runtime.id,
    runtime_source_sha256: runtime.checksum,
  };
  await transaction.query(
    `INSERT INTO avatar_profile_versions (
       id, account_id, workspace_id, profile_id, version_number, state,
       scope_kind, profile_contract_name, profile_contract_version, profile_payload,
       profile_hash, original_asset_id, runtime_source_asset_id,
       runtime_source_binary_sha256, source_preparation_profile,
       source_validation_profile, rights_attested_by_user_id,
       likeness_attested_by_user_id, ready_at
     ) VALUES ($1,$2,$3,$4,1,'READY','WORKSPACE',$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$14,now())
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [
      versionId,
      scope.account_id,
      scope.workspace_id,
      profileId,
      typeof source.profile_contract_name === "string"
        ? source.profile_contract_name
        : "avatar-profile",
      typeof source.profile_contract_version === "string" ? source.profile_contract_version : "v1",
      JSON.stringify(payload),
      sourceHash,
      original.id,
      runtime.id,
      runtime.checksum,
      typeof source.source_preparation_profile === "string"
        ? source.source_preparation_profile
        : "hosted-system-preset-source-v1",
      typeof source.source_validation_profile === "string"
        ? source.source_validation_profile
        : "hosted-system-preset-validation-v1",
      scope.user_id,
    ],
  );
  await transaction.query(
    `INSERT INTO avatar_profile_assets (
       id, account_id, workspace_id, profile_id, version_id, asset_id, role, binary_sha256
     ) VALUES ($1,$2,$3,$4,$5,$6,'ORIGINAL',$7)
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [
      await stableHostedUuid(`system-avatar:${scope.account_id}:${sourceVersionId}:asset-original`),
      scope.account_id,
      scope.workspace_id,
      profileId,
      versionId,
      original.id,
      original.checksum,
    ],
  );
  await transaction.query(
    `INSERT INTO avatar_profile_assets (
       id, account_id, workspace_id, profile_id, version_id, asset_id, role, binary_sha256
     ) VALUES ($1,$2,$3,$4,$5,$6,'RUNTIME',$7)
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [
      await stableHostedUuid(`system-avatar:${scope.account_id}:${sourceVersionId}:asset-runtime`),
      scope.account_id,
      scope.workspace_id,
      profileId,
      versionId,
      runtime.id,
      runtime.checksum,
    ],
  );
  await transaction.query(
    `UPDATE avatar_profiles SET active_version_id = $3, updated_at = now()
      WHERE account_id = $1 AND workspace_id = $2 AND id = $4`,
    [scope.account_id, scope.workspace_id, versionId, profileId],
  );
  return {
    profile_id: profileId,
    profile_name: profileName,
    version_id: versionId,
    profile_hash: sourceHash,
    runtime_source_asset_id: runtime.id,
    runtime_source_binary_sha256: runtime.checksum,
    source_preparation_profile:
      typeof source.source_preparation_profile === "string"
        ? source.source_preparation_profile
        : "hosted-system-preset-source-v1",
    source_validation_profile:
      typeof source.source_validation_profile === "string"
        ? source.source_validation_profile
        : "hosted-system-preset-validation-v1",
  };
}

async function materializeSystemStyle(
  transaction: SqlExecutor,
  scope: HostedScope,
  source: HostedPresetRow,
): Promise<HostedPresetRow> {
  const sourceVersionId = rowString(source, "version_id");
  const sourceHash = rowString(source, "style_profile_hash");
  const existing = await transaction.query<HostedPresetRow>(
    `SELECT style.id AS style_id, version.id AS version_id, version.style_profile_hash
       FROM image_styles AS style
       JOIN image_style_versions AS version
         ON version.account_id = style.account_id
        AND version.workspace_id = style.workspace_id
        AND version.style_id = style.id
      WHERE style.account_id = $1 AND style.workspace_id = $2
        AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
        AND version.state = 'PUBLISHED' AND version.style_profile_hash = $3
      ORDER BY version.version_number DESC LIMIT 1`,
    [scope.account_id, scope.workspace_id, sourceHash],
  );
  if (existing.rows[0]) return existing.rows[0];
  const styleId = await stableHostedUuid(
    `system-style:${scope.account_id}:${sourceVersionId}:style`,
  );
  const versionId = await stableHostedUuid(
    `system-style:${scope.account_id}:${sourceVersionId}:version`,
  );
  const sourceName = rowString(source, "style_name");
  const styleName = `${sourceName.slice(0, 145)} (system copy)`;
  await transaction.query(
    `INSERT INTO image_styles (
       id, account_id, workspace_id, scope_kind, created_by_user_id,
       name, normalized_name, status
     ) VALUES ($1,$2,$3,'WORKSPACE',$4,$5,lower($5),'ACTIVE')
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [styleId, scope.account_id, scope.workspace_id, scope.user_id, styleName],
  );
  const payload = plainRecord(source.profile_payload);
  if (!payload) throw new Error("SYSTEM_STYLE_PROFILE_MISSING");
  await transaction.query(
    `INSERT INTO image_style_versions (
       id, account_id, workspace_id, style_id, version_number, state,
       scope_kind, profile_contract_name, profile_contract_version, profile_payload,
       style_profile_hash, analyzer_request_hash, analyzer_model_snapshot,
       disclosure_attested_by_user_id, published_at
     ) VALUES ($1,$2,$3,$4,1,'PUBLISHED','WORKSPACE',$5,$6,$7::jsonb,$8,$9,$10,$11,now())
     ON CONFLICT (account_id, workspace_id, id) DO NOTHING`,
    [
      versionId,
      scope.account_id,
      scope.workspace_id,
      styleId,
      typeof source.profile_contract_name === "string"
        ? source.profile_contract_name
        : "image-style-profile",
      typeof source.profile_contract_version === "string" ? source.profile_contract_version : "v1",
      JSON.stringify(payload),
      sourceHash,
      sqlValue(source.analyzer_request_hash),
      typeof source.analyzer_model_snapshot === "string"
        ? source.analyzer_model_snapshot
        : "hosted-system-preset-v1",
      scope.user_id,
    ],
  );
  await transaction.query(
    `UPDATE image_styles SET active_version_id = $3, updated_at = now()
      WHERE account_id = $1 AND workspace_id = $2 AND id = $4`,
    [scope.account_id, scope.workspace_id, versionId, styleId],
  );
  return { style_id: styleId, version_id: versionId, style_profile_hash: sourceHash };
}

async function resolveProjectPresets(
  transaction: SqlExecutor,
  scope: HostedScope,
  avatarVersionId: string,
  styleVersionId: string,
): Promise<{ readonly avatar: HostedPresetRow; readonly style: HostedPresetRow } | null> {
  const avatar = await transaction.query<HostedPresetRow>(
    `SELECT profile.id AS profile_id, profile.name AS profile_name,
            profile.scope_kind, version.id AS version_id, version.profile_hash,
            version.profile_payload, version.original_asset_id,
            version.runtime_source_asset_id, version.runtime_source_binary_sha256,
            version.source_preparation_profile, version.source_validation_profile
       FROM avatar_profiles AS profile
       JOIN avatar_profile_versions AS version
         ON version.account_id = profile.account_id
        AND version.workspace_id = profile.workspace_id
        AND version.profile_id = profile.id
        AND version.scope_kind = profile.scope_kind
      WHERE version.id = $3 AND profile.status = 'ACTIVE' AND version.state = 'READY'
        AND (
          (profile.account_id = $1 AND profile.workspace_id = $2 AND profile.scope_kind = 'WORKSPACE')
          OR (profile.scope_kind = 'SYSTEM')
        )
      ORDER BY CASE WHEN profile.account_id = $1 AND profile.workspace_id = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [scope.account_id, scope.workspace_id, avatarVersionId],
  );
  const style = await transaction.query<HostedPresetRow>(
    `SELECT style.id AS style_id, style.name AS style_name, style.scope_kind,
            version.id AS version_id, version.style_profile_hash,
            version.profile_contract_name, version.profile_contract_version,
            version.profile_payload, version.analyzer_request_hash,
            version.analyzer_model_snapshot
       FROM image_styles AS style
       JOIN image_style_versions AS version
         ON version.account_id = style.account_id
        AND version.workspace_id = style.workspace_id
        AND version.style_id = style.id
        AND version.scope_kind = style.scope_kind
      WHERE version.id = $3 AND style.status = 'ACTIVE' AND version.state = 'PUBLISHED'
        AND (
          (style.account_id = $1 AND style.workspace_id = $2 AND style.scope_kind = 'WORKSPACE')
          OR (style.scope_kind = 'SYSTEM')
        )
      ORDER BY CASE WHEN style.account_id = $1 AND style.workspace_id = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [scope.account_id, scope.workspace_id, styleVersionId],
  );
  const avatarSource = avatar.rows[0];
  const styleSource = style.rows[0];
  if (!avatarSource || !styleSource) return null;
  return {
    avatar:
      avatarSource.scope_kind === "SYSTEM"
        ? await materializeSystemAvatar(transaction, scope, avatarSource)
        : avatarSource,
    style:
      styleSource.scope_kind === "SYSTEM"
        ? await materializeSystemStyle(transaction, scope, styleSource)
        : styleSource,
  };
}

async function parseHostedJson(
  request: Request,
  code: string,
  maximumBytes = 524_288,
): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (
    contentType !== "application/json" ||
    (contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximumBytes))
  ) {
    return response({ error: { code } }, 400);
  }
  try {
    if (!request.body) return response({ error: { code } }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return response({ error: { code } }, 400);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch {
    return response({ error: { code } }, 400);
  }
}

function hostedUploadKey(
  scope: HostedScope,
  kind: "avatar" | "style",
  id: string,
  versionId: string,
  role: string,
): string {
  return `tenant/${scope.account_id}/workspace/${scope.workspace_id}/${kind}-profile/${id}/version/${versionId}/${role}`;
}

async function resolveParentAvatar(
  transaction: SqlExecutor,
  scope: HostedScope,
  parentId: string | null,
): Promise<{
  readonly profileId: string;
  readonly profileName: string;
  readonly system: boolean;
} | null> {
  if (!parentId) return null;
  const result = await transaction.query<HostedPresetRow>(
    `SELECT profile.id AS profile_id, profile.name AS profile_name, profile.scope_kind
       FROM avatar_profiles AS profile
       LEFT JOIN avatar_profile_versions AS version
         ON version.account_id = profile.account_id
        AND version.workspace_id = profile.workspace_id
        AND version.profile_id = profile.id
      WHERE (profile.id = $3 OR version.id = $3)
        AND profile.status = 'ACTIVE'
        AND (
          (profile.account_id = $1 AND profile.workspace_id = $2 AND profile.scope_kind = 'WORKSPACE')
          OR profile.scope_kind = 'SYSTEM'
        )
      ORDER BY CASE WHEN profile.account_id = $1 AND profile.workspace_id = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [scope.account_id, scope.workspace_id, parentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    profileId: rowString(row, "profile_id"),
    profileName: rowString(row, "profile_name"),
    system: row.scope_kind === "SYSTEM",
  };
}

async function resolveParentStyle(
  transaction: SqlExecutor,
  scope: HostedScope,
  parentId: string | null,
): Promise<{
  readonly styleId: string;
  readonly styleName: string;
  readonly system: boolean;
} | null> {
  if (!parentId) return null;
  const result = await transaction.query<HostedPresetRow>(
    `SELECT style.id AS style_id, style.name AS style_name, style.scope_kind
       FROM image_styles AS style
       LEFT JOIN image_style_versions AS version
         ON version.account_id = style.account_id
        AND version.workspace_id = style.workspace_id
        AND version.style_id = style.id
      WHERE (style.id = $3 OR version.id = $3)
        AND style.status = 'ACTIVE'
        AND (
          (style.account_id = $1 AND style.workspace_id = $2 AND style.scope_kind = 'WORKSPACE')
          OR style.scope_kind = 'SYSTEM'
        )
      ORDER BY CASE WHEN style.account_id = $1 AND style.workspace_id = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [scope.account_id, scope.workspace_id, parentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    styleId: rowString(row, "style_id"),
    styleName: rowString(row, "style_name"),
    system: row.scope_kind === "SYSTEM",
  };
}

async function lockActiveAvatarParent(
  transaction: SqlExecutor,
  scope: HostedScope,
  profileOrVersionId: string,
): Promise<boolean> {
  const result = await transaction.query<HostedPresetRow>(
    `SELECT profile.id AS profile_id
       FROM avatar_profiles AS profile
      WHERE profile.account_id = $1 AND profile.workspace_id = $2
        AND profile.scope_kind = 'WORKSPACE'
        AND profile.status = 'ACTIVE'
        AND (
          profile.id = $3
          OR EXISTS (
            SELECT 1
              FROM avatar_profile_versions AS version
             WHERE version.account_id = profile.account_id
               AND version.workspace_id = profile.workspace_id
               AND version.profile_id = profile.id
               AND version.scope_kind = 'WORKSPACE'
               AND version.id = $3
          )
        )
      FOR UPDATE`,
    [scope.account_id, scope.workspace_id, profileOrVersionId],
  );
  return result.rows.length > 0;
}

async function lockActiveStyleParent(
  transaction: SqlExecutor,
  scope: HostedScope,
  styleOrVersionId: string,
): Promise<boolean> {
  const result = await transaction.query<HostedPresetRow>(
    `SELECT style.id AS style_id
       FROM image_styles AS style
      WHERE style.account_id = $1 AND style.workspace_id = $2
        AND style.scope_kind = 'WORKSPACE'
        AND style.status = 'ACTIVE'
        AND (
          style.id = $3
          OR EXISTS (
            SELECT 1
              FROM image_style_versions AS version
             WHERE version.account_id = style.account_id
               AND version.workspace_id = style.workspace_id
               AND version.style_id = style.id
               AND version.scope_kind = 'WORKSPACE'
               AND version.id = $3
          )
        )
      FOR UPDATE`,
    [scope.account_id, scope.workspace_id, styleOrVersionId],
  );
  return result.rows.length > 0;
}

async function avatarCreate(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY.test(idempotencyKey))
    return response({ error: { code: "AVATAR_IDEMPOTENCY_REQUIRED" } }, 400);
  const raw = await parseHostedJson(request, "AVATAR_CREATE_REJECTED");
  if (raw instanceof Response) return raw;
  const input = parseAvatarCreate(raw);
  if (!input) return response({ error: { code: "AVATAR_CREATE_REJECTED" } }, 400);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const requestHash = await sha256(canonicalJson(raw));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const replay = await transaction.query<HostedPresetRow>(
        `SELECT profile.id AS profile_id, profile.name AS profile_name,
                version.id AS version_id, version.version_number, version.state,
                asset.object_key, asset.content_type, asset.byte_size AS content_length,
                asset.binary_sha256 AS checksum_sha256
           FROM avatar_profile_versions AS version
           JOIN avatar_profiles AS profile
             ON profile.account_id = version.account_id
            AND profile.workspace_id = version.workspace_id
            AND profile.id = version.profile_id
           JOIN avatar_profile_assets AS link
             ON link.account_id = version.account_id
            AND link.workspace_id = version.workspace_id
            AND link.version_id = version.id AND link.role = 'ORIGINAL'
           JOIN assets AS asset
             ON asset.account_id = link.account_id
            AND asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
          WHERE version.account_id = $1 AND version.workspace_id = $2
            AND asset.metadata ->> 'hosted_request_idempotency_key' = $3
          ORDER BY version.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, idempotencyKey],
      );
      if (replay.rows[0]) return replay.rows[0];
      const parent = await resolveParentAvatar(transaction, scope, input.parentId);
      if (input.parentId && !parent) throw new Error("AVATAR_PARENT_NOT_FOUND");
      const systemParent = parent?.system === true;
      const profileId =
        parent && !systemParent
          ? parent.profileId
          : await stableHostedUuid(
              `hosted-avatar:${scope.account_id}:${idempotencyKey}:${requestHash}:profile`,
            );
      const versionId = await stableHostedUuid(
        `hosted-avatar:${scope.account_id}:${idempotencyKey}:${requestHash}:version`,
      );
      const profileName = parent && !systemParent ? parent.profileName : input.name;
      const profileExists = await transaction.query<HostedPresetRow>(
        `SELECT id FROM avatar_profiles
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3`,
        [scope.account_id, scope.workspace_id, profileId],
      );
      if (!profileExists.rows[0]) {
        await transaction.query(
          `INSERT INTO avatar_profiles (
             id, account_id, workspace_id, scope_kind, name, normalized_name,
             status, created_by_user_id
           ) VALUES ($1,$2,$3,'WORKSPACE',$4,lower($4),'ACTIVE',$5)`,
          [profileId, scope.account_id, scope.workspace_id, profileName, scope.user_id],
        );
      }
      const number = await transaction.query<{ version_number: number | string }>(
        `SELECT COALESCE(max(version_number), 0) + 1 AS version_number
           FROM avatar_profile_versions
          WHERE account_id = $1 AND workspace_id = $2 AND profile_id = $3`,
        [scope.account_id, scope.workspace_id, profileId],
      );
      const versionNumber = Number(number.rows[0]?.version_number ?? 1);
      const assetId = await stableHostedUuid(
        `hosted-avatar:${scope.account_id}:${idempotencyKey}:${requestHash}:asset`,
      );
      const objectKey = hostedUploadKey(scope, "avatar", profileId, versionId, "original/source");
      await transaction.query(
        `INSERT INTO assets (
           id, account_id, workspace_id, kind, state, object_key, binary_sha256,
           content_type, byte_size, width_px, height_px, metadata
         ) VALUES ($1,$2,$3,'AVATAR_ORIGINAL','UPLOADING',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          assetId,
          scope.account_id,
          scope.workspace_id,
          objectKey,
          input.source.checksumSha256,
          input.source.contentType,
          input.source.contentLength,
          input.source.width,
          input.source.height,
          JSON.stringify({
            filename: input.source.filename,
            hosted_request_idempotency_key: idempotencyKey,
            request_sha256: requestHash,
          }),
        ],
      );
      await transaction.query(
        `INSERT INTO avatar_profile_versions (
           id, account_id, workspace_id, profile_id, version_number, state, scope_kind,
           original_asset_id
         ) VALUES ($1,$2,$3,$4,$5,'DRAFT','WORKSPACE',$6)`,
        [versionId, scope.account_id, scope.workspace_id, profileId, versionNumber, assetId],
      );
      await transaction.query(
        `INSERT INTO avatar_profile_assets (
           id, account_id, workspace_id, profile_id, version_id, asset_id, role, binary_sha256
         ) VALUES ($1,$2,$3,$4,$5,$6,'ORIGINAL',$7)`,
        [
          await stableHostedUuid(
            `hosted-avatar:${scope.account_id}:${idempotencyKey}:${requestHash}:link`,
          ),
          scope.account_id,
          scope.workspace_id,
          profileId,
          versionId,
          assetId,
          input.source.checksumSha256,
        ],
      );
      return {
        profile_id: profileId,
        profile_name: profileName,
        version_id: versionId,
        version_number: versionNumber,
        state: "DRAFT",
        object_key: objectKey,
        content_type: input.source.contentType,
        content_length: input.source.contentLength,
        checksum_sha256: input.source.checksumSha256,
      };
    });
    const upload = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey: rowString(prepared, "object_key"),
      contentType: rowString(prepared, "content_type"),
      contentLength: Number(prepared.content_length),
      checksumSha256: rowString(prepared, "checksum_sha256"),
      lifetimeSeconds: 900,
    });
    return response(
      {
        schema_version: "videoforge-hosted-avatar-create-response/v1",
        profile_id: rowString(prepared, "profile_id"),
        profile_name: rowString(prepared, "profile_name"),
        version_id: rowString(prepared, "version_id"),
        version_number: Number(prepared.version_number),
        state: prepared.state,
        uploads: [upload],
        provider_calls_authorized: false,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "AVATAR_PARENT_NOT_FOUND")
      return response({ error: { code: error.message } }, 404);
    if (postgresCode(error) === "23505")
      return response({ error: hostedAvatarConflictProblem(postgresConstraint(error)) }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}

async function avatarCommit(
  request: Request,
  profileOrVersionId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(profileOrVersionId)) return response({ error: { code: "AVATAR_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const raw = await parseHostedJson(request, "AVATAR_COMMIT_REJECTED");
  if (raw instanceof Response) return raw;
  if (!parseEmptyObject(raw)) return response({ error: { code: "AVATAR_COMMIT_REJECTED" } }, 400);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const pending = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveAvatarParent(transaction, scope, profileOrVersionId))) return null;
      const result = await transaction.query<HostedPresetRow>(
        `SELECT profile.id AS profile_id, version.id AS version_id, version.state,
                asset.object_key, asset.content_type, asset.byte_size AS content_length,
                asset.binary_sha256 AS checksum_sha256
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id AND version.profile_id = profile.id
           JOIN avatar_profile_assets AS link
             ON link.account_id = version.account_id
            AND link.workspace_id = version.workspace_id
            AND link.version_id = version.id AND link.role = 'ORIGINAL'
           JOIN assets AS asset
             ON asset.account_id = link.account_id
            AND asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
          WHERE profile.account_id = $1 AND profile.workspace_id = $2
            AND profile.scope_kind = 'WORKSPACE'
            AND profile.status = 'ACTIVE'
            AND (profile.id = $3 OR version.id = $3)
          ORDER BY version.version_number DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, profileOrVersionId],
      );
      return result.rows[0];
    });
    if (!pending) return response({ error: { code: "AVATAR_NOT_FOUND" } }, 404);
    if (pending.state === "READY" && !pending.object_key)
      return response({ error: { code: "AVATAR_NOT_FOUND" } }, 404);
    const object = await bucket.head(rowString(pending, "object_key"));
    if (
      !object ||
      object.size !== Number(pending.content_length) ||
      object.httpMetadata?.contentType !== pending.content_type ||
      checksumFromR2(object.checksums?.sha256) !== pending.checksum_sha256
    ) {
      return response(
        {
          error: {
            code: "AVATAR_SOURCE_NOT_VERIFIED",
            message:
              "The saved photo upload could not be verified. Remove this avatar draft and upload the photo again.",
          },
        },
        409,
      );
    }
    const committed = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveAvatarParent(transaction, scope, profileOrVersionId))) return null;
      const result = await transaction.query<HostedPresetRow>(
        `UPDATE assets AS asset
            SET state = 'VERIFIED', verified_at = COALESCE(asset.verified_at, now())
           FROM avatar_profile_assets AS link
           JOIN avatar_profiles AS profile
             ON profile.account_id = link.account_id
            AND profile.workspace_id = link.workspace_id
            AND profile.id = link.profile_id
            AND profile.scope_kind = 'WORKSPACE'
            AND profile.status = 'ACTIVE'
          WHERE link.account_id = $1 AND link.workspace_id = $2
            AND link.version_id = $3 AND link.role = 'ORIGINAL'
            AND asset.account_id = link.account_id AND asset.workspace_id = link.workspace_id
            AND asset.id = link.asset_id
          RETURNING link.profile_id, link.version_id, asset.binary_sha256`,
        [scope.account_id, scope.workspace_id, rowString(pending, "version_id")],
      );
      const version = await transaction.query<HostedPresetRow>(
        `UPDATE avatar_profile_versions AS version
            SET state = CASE WHEN state = 'READY' THEN state ELSE 'NEEDS_REVIEW' END,
                updated_at = now()
             FROM avatar_profiles AS profile
            WHERE version.account_id = $1 AND version.workspace_id = $2 AND version.id = $3
              AND version.state IN ('DRAFT','UPLOADING','NEEDS_REVIEW','READY')
              AND profile.account_id = version.account_id
              AND profile.workspace_id = version.workspace_id
              AND profile.id = version.profile_id
              AND profile.scope_kind = 'WORKSPACE'
              AND profile.status = 'ACTIVE'
          RETURNING version.profile_id, version.id AS version_id, version.state`,
        [scope.account_id, scope.workspace_id, rowString(pending, "version_id")],
      );
      return version.rows[0] ?? result.rows[0] ?? pending;
    });
    if (!committed) return response({ error: { code: "AVATAR_NOT_FOUND" } }, 404);
    return response({
      schema_version: "videoforge-hosted-avatar-commit-response/v1",
      profile_id: rowString(committed, "profile_id"),
      version_id: rowString(committed, "version_id"),
      state: committed.state === "READY" ? "READY" : "NEEDS_REVIEW",
      uploads: [],
      provider_calls_authorized: false,
    });
  } finally {
    await pool.end();
  }
}

async function avatarApprove(
  request: Request,
  profileOrVersionId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(profileOrVersionId)) return response({ error: { code: "AVATAR_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const raw = await parseHostedJson(request, "AVATAR_APPROVAL_REJECTED");
  if (raw instanceof Response) return raw;
  if (!parseAvatarApproval(raw))
    return response({ error: { code: "AVATAR_APPROVAL_REJECTED" } }, 400);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const approved = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveAvatarParent(transaction, scope, profileOrVersionId))) return null;
      const result = await transaction.query<HostedPresetRow>(
        `SELECT profile.id AS profile_id, profile.name AS profile_name,
                version.id AS version_id, version.state, version.profile_hash,
                asset.id AS asset_id, asset.binary_sha256, asset.content_type,
                asset.byte_size, asset.width_px, asset.height_px
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id AND version.profile_id = profile.id
           JOIN avatar_profile_assets AS link
             ON link.account_id = version.account_id
            AND link.workspace_id = version.workspace_id AND link.version_id = version.id
            AND link.role = 'ORIGINAL'
           JOIN assets AS asset
             ON asset.account_id = link.account_id
            AND asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
          WHERE profile.account_id = $1 AND profile.workspace_id = $2
            AND profile.scope_kind = 'WORKSPACE'
            AND profile.status = 'ACTIVE'
            AND (profile.id = $3 OR version.id = $3)
          ORDER BY version.version_number DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, profileOrVersionId],
      );
      const target = result.rows[0];
      if (!target) return null;
      if (target.state === "READY") return target;
      if (target.state !== "NEEDS_REVIEW" || target.binary_sha256 === null)
        throw new Error("AVATAR_SOURCE_NOT_COMMITTED");
      const now = new Date().toISOString();
      const payload = avatarProfilePayload({
        assetId: rowString(target, "asset_id"),
        checksumSha256: rowString(target, "binary_sha256"),
        contentType: rowString(target, "content_type"),
        contentLength: Number(target.byte_size),
        width: Number(target.width_px),
        height: Number(target.height_px),
        userId: scope.user_id,
        now,
      });
      const profileHash = await sha256(canonicalJson(payload));
      await transaction.query(
        `UPDATE avatar_profile_versions AS version
            SET state = 'READY', profile_contract_name = 'avatar-profile',
                profile_contract_version = 'v1', profile_payload = $4::jsonb,
                profile_hash = $5, original_asset_id = $6, runtime_source_asset_id = $6,
                runtime_source_binary_sha256 = $7,
                source_preparation_profile = 'hosted-avatar-source-pass-through-v1',
                source_validation_profile = 'hosted-avatar-source-validation-v1',
                rights_attested_by_user_id = $8, likeness_attested_by_user_id = $8,
                ready_at = now(), updated_at = now()
             FROM avatar_profiles AS profile
            WHERE version.account_id = $1 AND version.workspace_id = $2 AND version.id = $3
              AND profile.account_id = version.account_id
              AND profile.workspace_id = version.workspace_id
              AND profile.id = version.profile_id
              AND profile.scope_kind = 'WORKSPACE'
              AND profile.status = 'ACTIVE'`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "version_id"),
          JSON.stringify(payload),
          profileHash,
          rowString(target, "asset_id"),
          rowString(target, "binary_sha256"),
          scope.user_id,
        ],
      );
      await transaction.query(
        `UPDATE avatar_profiles SET active_version_id = $3, updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2 AND id = $4
            AND scope_kind = 'WORKSPACE' AND status = 'ACTIVE'`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "version_id"),
          rowString(target, "profile_id"),
        ],
      );
      return { ...target, profile_hash: profileHash };
    });
    if (!approved) return response({ error: { code: "AVATAR_NOT_FOUND" } }, 404);
    return response({
      schema_version: "videoforge-hosted-avatar-approval-response/v1",
      profile_id: rowString(approved, "profile_id"),
      version_id: rowString(approved, "version_id"),
      state: "READY",
      profile_hash: rowString(approved, "profile_hash"),
      provider_calls_authorized: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "AVATAR_SOURCE_NOT_COMMITTED")
      return response({ error: { code: error.message } }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}

async function styleCreate(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY.test(idempotencyKey))
    return response(
      { error: { code: "STYLE_IDEMPOTENCY_REQUIRED", message: "Start the style again." } },
      400,
    );
  const raw = await parseHostedJson(request, "STYLE_CREATE_REJECTED");
  if (raw instanceof Response) return raw;
  const input = parseStyleCreate(raw);
  if (!input)
    return response(
      { error: { code: "STYLE_CREATE_REJECTED", message: "Check the style name and images." } },
      400,
    );
  if (!input.rightsAttested)
    return response(
      {
        error: {
          code: "STYLE_RIGHTS_REQUIRED",
          message: "Confirm your right to use these images.",
        },
      },
      400,
    );
  if (!input.processingDisclosureAcknowledged)
    return response(
      {
        error: {
          code: "STYLE_DISCLOSURE_REQUIRED",
          message: "Confirm the image-processing disclosure to continue.",
        },
      },
      400,
    );
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const requestHash = await sha256(canonicalJson(raw));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const replay = await transaction.query<HostedPresetRow>(
        `SELECT style.id AS style_id, style.name AS style_name,
                version.id AS version_id, version.version_number, version.state,
                min(original.metadata ->> 'request_sha256') AS request_sha256,
                jsonb_agg(jsonb_build_object(
                  'order_index', reference.reference_order - 1,
                  'object_key', original.object_key,
                  'content_type', original.content_type,
                  'content_length', original.byte_size,
                  'checksum_sha256', original.binary_sha256,
                  'normalized_object_key', normalized.object_key,
                  'normalized_content_type', normalized.content_type,
                  'normalized_content_length', normalized.byte_size,
                  'normalized_checksum_sha256', normalized.binary_sha256
                ) ORDER BY reference.reference_order) AS uploads
           FROM image_style_versions AS version
           JOIN image_styles AS style
             ON style.account_id = version.account_id
            AND style.workspace_id = version.workspace_id AND style.id = version.style_id
           JOIN image_style_references AS reference
             ON reference.account_id = version.account_id
            AND reference.workspace_id = version.workspace_id AND reference.version_id = version.id
           JOIN assets AS original
             ON original.account_id = reference.account_id
            AND original.workspace_id = reference.workspace_id AND original.id = reference.original_asset_id
           JOIN assets AS normalized
             ON normalized.account_id = reference.account_id
            AND normalized.workspace_id = reference.workspace_id AND normalized.id = reference.normalized_asset_id
          WHERE version.account_id = $1 AND version.workspace_id = $2
            AND original.metadata ->> 'hosted_request_idempotency_key' = $3
          GROUP BY style.id, style.name, version.id, version.version_number, version.state
          ORDER BY version.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_sha256 !== requestHash)
          throw new Error("STYLE_IDEMPOTENCY_CONFLICT");
        return replay.rows[0];
      }
      const parent = await resolveParentStyle(transaction, scope, input.parentId);
      if (input.parentId && !parent) throw new Error("STYLE_PARENT_NOT_FOUND");
      const systemParent = parent?.system === true;
      if (
        parent &&
        !systemParent &&
        !(await lockActiveStyleParent(transaction, scope, parent.styleId))
      )
        throw new Error("STYLE_PARENT_NOT_FOUND");
      const styleId =
        parent && !systemParent
          ? parent.styleId
          : await stableHostedUuid(
              `hosted-style:${scope.account_id}:${idempotencyKey}:${requestHash}:style`,
            );
      const versionId = await stableHostedUuid(
        `hosted-style:${scope.account_id}:${idempotencyKey}:${requestHash}:version`,
      );
      const styleName = parent && !systemParent ? parent.styleName : input.name;
      const styleExists = await transaction.query<HostedPresetRow>(
        `SELECT id FROM image_styles
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3
            AND scope_kind = 'WORKSPACE' AND status = 'ACTIVE'`,
        [scope.account_id, scope.workspace_id, styleId],
      );
      if (!styleExists.rows[0]) {
        await transaction.query(
          `INSERT INTO image_styles (
             id, account_id, workspace_id, scope_kind, created_by_user_id,
             name, normalized_name, status
           ) VALUES ($1,$2,$3,'WORKSPACE',$4,$5,lower($5),'ACTIVE')`,
          [styleId, scope.account_id, scope.workspace_id, scope.user_id, styleName],
        );
      }
      const number = await transaction.query<{ version_number: number | string }>(
        `SELECT COALESCE(max(version_number), 0) + 1 AS version_number
           FROM image_style_versions
          WHERE account_id = $1 AND workspace_id = $2 AND style_id = $3`,
        [scope.account_id, scope.workspace_id, styleId],
      );
      const versionNumber = Number(number.rows[0]?.version_number ?? 1);
      await transaction.query(
        `INSERT INTO image_style_versions (
           id, account_id, workspace_id, style_id, version_number, state, scope_kind,
           disclosure_attested_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,'DRAFT','WORKSPACE',$6)`,
        [versionId, scope.account_id, scope.workspace_id, styleId, versionNumber, scope.user_id],
      );
      const uploadRows: HostedPresetRow[] = [];
      for (const reference of input.references) {
        const suffix = String(reference.orderIndex + 1).padStart(2, "0");
        const originalAssetId = await stableHostedUuid(
          `hosted-style:${scope.account_id}:${idempotencyKey}:${requestHash}:original:${reference.orderIndex}`,
        );
        const normalizedAssetId = await stableHostedUuid(
          `hosted-style:${scope.account_id}:${idempotencyKey}:${requestHash}:normalized:${reference.orderIndex}`,
        );
        const originalKey = hostedUploadKey(
          scope,
          "style",
          styleId,
          versionId,
          `original/reference-${suffix}`,
        );
        const normalizedKey = hostedUploadKey(
          scope,
          "style",
          styleId,
          versionId,
          `normalized/reference-${suffix}`,
        );
        const metadata = JSON.stringify({
          filename: reference.filename,
          hosted_request_idempotency_key: idempotencyKey,
          request_sha256: requestHash,
          order_index: reference.orderIndex,
        });
        const normalizedMetadata = JSON.stringify({
          hosted_request_idempotency_key: idempotencyKey,
          request_sha256: requestHash,
          order_index: reference.orderIndex,
          width: reference.normalizedWidth,
          height: reference.normalizedHeight,
          source: "browser-normalized-webp-v1",
        });
        await transaction.query(
          `INSERT INTO assets (
             id, account_id, workspace_id, kind, state, object_key, binary_sha256,
             content_type, byte_size, metadata
           ) VALUES ($1,$2,$3,'STYLE_REFERENCE_ORIGINAL','UPLOADING',$4,$5,$6,$7,$8::jsonb)`,
          [
            originalAssetId,
            scope.account_id,
            scope.workspace_id,
            originalKey,
            reference.checksumSha256,
            reference.contentType,
            reference.contentLength,
            metadata,
          ],
        );
        await transaction.query(
          `INSERT INTO assets (
             id, account_id, workspace_id, kind, state, object_key, binary_sha256,
             content_type, byte_size, width_px, height_px, metadata
           ) VALUES ($1,$2,$3,'STYLE_REFERENCE_NORMALIZED','UPLOADING',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            normalizedAssetId,
            scope.account_id,
            scope.workspace_id,
            normalizedKey,
            reference.normalizedChecksumSha256,
            "image/webp",
            reference.normalizedContentLength,
            reference.normalizedWidth,
            reference.normalizedHeight,
            normalizedMetadata,
          ],
        );
        await transaction.query(
          `INSERT INTO image_style_references (
             id, account_id, workspace_id, style_id, version_id, normalized_asset_id,
             original_asset_id, reference_order, rights_attested_by_user_id,
             rights_basis, rights_basis_note, rights_attested_at, original_retention_policy
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OTHER_DOCUMENTED_BASIS',
                     'Hosted user rights attestation',now(),$10)`,
          [
            await stableHostedUuid(
              `hosted-style:${scope.account_id}:${idempotencyKey}:${requestHash}:reference:${reference.orderIndex}`,
            ),
            scope.account_id,
            scope.workspace_id,
            styleId,
            versionId,
            normalizedAssetId,
            originalAssetId,
            reference.orderIndex + 1,
            scope.user_id,
            input.originalRetentionPolicy,
          ],
        );
        uploadRows.push({
          object_key: originalKey,
          content_type: reference.contentType,
          content_length: reference.contentLength,
          checksum_sha256: reference.checksumSha256,
          normalized_object_key: normalizedKey,
          normalized_content_type: "image/webp",
          normalized_content_length: reference.normalizedContentLength,
          normalized_checksum_sha256: reference.normalizedChecksumSha256,
        });
      }
      return {
        style_id: styleId,
        style_name: styleName,
        version_id: versionId,
        version_number: versionNumber,
        state: "DRAFT",
        uploads: uploadRows,
      };
    });
    const uploads = Array.isArray(prepared.uploads)
      ? (prepared.uploads as Record<string, unknown>[]).map((item) => item)
      : [];
    const ports = [];
    const normalizedPorts = [];
    for (const item of uploads) {
      const objectKey = rowString(item, "object_key");
      ports.push(
        await new HostedR2Signer(config.r2).sign({
          method: "PUT",
          objectKey,
          contentType: rowString(item, "content_type"),
          contentLength: Number(item.content_length),
          checksumSha256: rowString(item, "checksum_sha256"),
          lifetimeSeconds: 900,
        }),
      );
      normalizedPorts.push(
        await new HostedR2Signer(config.r2).sign({
          method: "PUT",
          objectKey: rowString(item, "normalized_object_key"),
          contentType: rowString(item, "normalized_content_type"),
          contentLength: Number(item.normalized_content_length),
          checksumSha256: rowString(item, "normalized_checksum_sha256"),
          lifetimeSeconds: 900,
        }),
      );
    }
    return response(
      {
        schema_version: "videoforge-hosted-style-create-response/v1",
        style_id: rowString(prepared, "style_id"),
        style_name: rowString(prepared, "style_name"),
        version_id: rowString(prepared, "version_id"),
        version_number: Number(prepared.version_number),
        state: prepared.state,
        uploads: ports,
        normalized_uploads: normalizedPorts,
        provider_calls_authorized: false,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "STYLE_PARENT_NOT_FOUND")
      return response(
        {
          error: {
            code: error.message,
            message:
              "The selected style is no longer available. Return to Image Styles and try again.",
          },
        },
        404,
      );
    if (error instanceof Error && error.message === "STYLE_IDEMPOTENCY_CONFLICT")
      return response(
        {
          error: {
            code: error.message,
            message: "This saved request no longer matches the selected style. Start again.",
          },
        },
        409,
      );
    if (postgresCode(error) === "23505")
      return response({ error: hostedStyleConflictProblem(postgresConstraint(error)) }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}

async function styleReferenceReplace(
  request: Request,
  styleOrVersionId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(styleOrVersionId))
    return response(
      {
        error: {
          code: "STYLE_NOT_FOUND",
          message: "This style is no longer available. Return to Image Styles and try again.",
        },
      },
      404,
    );
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY.test(idempotencyKey))
    return response(
      {
        error: {
          code: "STYLE_REFERENCE_REPLACE_IDEMPOTENCY_REQUIRED",
          message: "Start the reference replacement again.",
        },
      },
      400,
    );
  const raw = await parseHostedJson(request, "STYLE_REFERENCE_REPLACE_REJECTED");
  if (raw instanceof Response) return raw;
  const input = parseStyleReferenceReplacement(raw);
  if (!input)
    return response(
      {
        error: {
          code: "STYLE_REFERENCE_REPLACE_REJECTED",
          message: "Choose 3–8 valid reference images and try again.",
        },
      },
      400,
    );
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const requestHash = await sha256(canonicalJson(raw));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveStyleParent(transaction, scope, styleOrVersionId))) return null;
      const targetResult = await transaction.query<HostedPresetRow>(
        `SELECT style.id AS style_id, style.name AS style_name,
                version.id AS version_id, version.version_number, version.state,
                version.disclosure_attested_by_user_id
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id AND version.style_id = style.id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
            AND (style.id = $3 OR version.id = $3)
            AND version.id = (
              SELECT candidate.id
                FROM image_style_versions AS candidate
               WHERE candidate.account_id = style.account_id
                 AND candidate.workspace_id = style.workspace_id
                 AND candidate.style_id = style.id
                 AND (style.id = $3 OR candidate.id = $3)
               ORDER BY candidate.version_number DESC
               LIMIT 1
            )
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, styleOrVersionId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new Error("STYLE_NOT_FOUND");

      const replay = await transaction.query<HostedPresetRow>(
        `SELECT style.id AS style_id, style.name AS style_name,
                version.id AS version_id, version.version_number, version.state,
                min(original.metadata ->> 'request_sha256') AS request_sha256,
                jsonb_agg(jsonb_build_object(
                  'order_index', reference.reference_order - 1,
                  'object_key', original.object_key,
                  'content_type', original.content_type,
                  'content_length', original.byte_size,
                  'checksum_sha256', original.binary_sha256,
                  'normalized_object_key', normalized.object_key,
                  'normalized_content_type', normalized.content_type,
                  'normalized_content_length', normalized.byte_size,
                  'normalized_checksum_sha256', normalized.binary_sha256
                ) ORDER BY reference.reference_order) AS uploads
           FROM image_style_versions AS version
           JOIN image_styles AS style
             ON style.account_id = version.account_id
            AND style.workspace_id = version.workspace_id AND style.id = version.style_id
           JOIN image_style_references AS reference
             ON reference.account_id = version.account_id
            AND reference.workspace_id = version.workspace_id AND reference.version_id = version.id
            AND reference.retention_state <> 'DELETED'
           JOIN assets AS original
             ON original.account_id = reference.account_id
            AND original.workspace_id = reference.workspace_id AND original.id = reference.original_asset_id
           JOIN assets AS normalized
             ON normalized.account_id = reference.account_id
            AND normalized.workspace_id = reference.workspace_id AND normalized.id = reference.normalized_asset_id
          WHERE version.account_id = $1 AND version.workspace_id = $2
            AND version.style_id = $3
            AND original.metadata ->> 'hosted_reference_replace_idempotency_key' = $4
          GROUP BY style.id, style.name, version.id, version.version_number, version.state
          ORDER BY version.version_number DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, rowString(target, "style_id"), idempotencyKey],
      );
      const replayed = replay.rows[0];
      if (replayed) {
        if (replayed.request_sha256 !== requestHash)
          throw new Error("STYLE_REFERENCE_REPLACE_IDEMPOTENCY_CONFLICT");
        return replayed;
      }
      if (target.state !== "DRAFT") throw new Error("STYLE_REFERENCE_REPLACE_NOT_ALLOWED");

      const previousReferences = await transaction.query<HostedPresetRow>(
        `SELECT reference.id, reference.reference_order,
                reference.rights_attested_by_user_id, reference.rights_basis,
                reference.rights_basis_note, reference.original_retention_policy
           FROM image_style_references AS reference
          WHERE reference.account_id = $1 AND reference.workspace_id = $2
            AND reference.style_id = $3 AND reference.version_id = $4
            AND reference.retention_state <> 'DELETED'
          ORDER BY reference.reference_order`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "style_id"),
          rowString(target, "version_id"),
        ],
      );
      const previous = previousReferences.rows[0];
      if (!previous) throw new Error("STYLE_REFERENCE_REPLACE_NOT_ALLOWED");

      const styleId = rowString(target, "style_id");
      const previousVersionId = rowString(target, "version_id");
      const replacementNamespace =
        `hosted-style-reference-replace:${scope.account_id}:${styleId}:${previousVersionId}:` +
        `${idempotencyKey}:${requestHash}`;
      const versionId = await stableHostedUuid(`${replacementNamespace}:version`);
      const number = await transaction.query<{ version_number: number | string }>(
        `SELECT COALESCE(max(version_number), 0) + 1 AS version_number
           FROM image_style_versions
          WHERE account_id = $1 AND workspace_id = $2 AND style_id = $3`,
        [scope.account_id, scope.workspace_id, styleId],
      );
      const versionNumber = Number(number.rows[0]?.version_number ?? 1);
      const abandoned = await transaction.query(
        `UPDATE image_style_versions
            SET state = 'ABANDONED', abandoned_at = now(), updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3
            AND style_id = $4 AND state = 'DRAFT'
          RETURNING id`,
        [scope.account_id, scope.workspace_id, previousVersionId, styleId],
      );
      if (abandoned.rows.length !== 1) throw new Error("STYLE_REFERENCE_REPLACE_NOT_ALLOWED");
      await transaction.query(
        `INSERT INTO image_style_versions (
           id, account_id, workspace_id, style_id, version_number, state, scope_kind,
           disclosure_attested_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,'DRAFT','WORKSPACE',$6)`,
        [
          versionId,
          scope.account_id,
          scope.workspace_id,
          styleId,
          versionNumber,
          sqlValue(target.disclosure_attested_by_user_id),
        ],
      );

      const uploadRows: HostedPresetRow[] = [];
      for (const reference of input.references) {
        const suffix = String(reference.orderIndex + 1).padStart(2, "0");
        const originalAssetId = await stableHostedUuid(
          `${replacementNamespace}:original:${reference.orderIndex}`,
        );
        const normalizedAssetId = await stableHostedUuid(
          `${replacementNamespace}:normalized:${reference.orderIndex}`,
        );
        const replacementPath = requestHash.slice("sha256:".length);
        const originalKey = hostedUploadKey(
          scope,
          "style",
          styleId,
          versionId,
          `original/replacement-${replacementPath}-${suffix}`,
        );
        const normalizedKey = hostedUploadKey(
          scope,
          "style",
          styleId,
          versionId,
          `normalized/replacement-${replacementPath}-${suffix}`,
        );
        const metadata = JSON.stringify({
          filename: reference.filename,
          hosted_reference_replace_idempotency_key: idempotencyKey,
          request_sha256: requestHash,
          style_id: styleId,
          style_version_id: versionId,
          order_index: reference.orderIndex,
        });
        const normalizedMetadata = JSON.stringify({
          hosted_reference_replace_idempotency_key: idempotencyKey,
          request_sha256: requestHash,
          style_id: styleId,
          style_version_id: versionId,
          order_index: reference.orderIndex,
          width: reference.normalizedWidth,
          height: reference.normalizedHeight,
          source: "browser-normalized-webp-v1",
        });
        await transaction.query(
          `INSERT INTO assets (
             id, account_id, workspace_id, kind, state, object_key, binary_sha256,
             content_type, byte_size, metadata
           ) VALUES ($1,$2,$3,'STYLE_REFERENCE_ORIGINAL','UPLOADING',$4,$5,$6,$7,$8::jsonb)`,
          [
            originalAssetId,
            scope.account_id,
            scope.workspace_id,
            originalKey,
            reference.checksumSha256,
            reference.contentType,
            reference.contentLength,
            metadata,
          ],
        );
        await transaction.query(
          `INSERT INTO assets (
             id, account_id, workspace_id, kind, state, object_key, binary_sha256,
             content_type, byte_size, width_px, height_px, metadata
           ) VALUES ($1,$2,$3,'STYLE_REFERENCE_NORMALIZED','UPLOADING',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            normalizedAssetId,
            scope.account_id,
            scope.workspace_id,
            normalizedKey,
            reference.normalizedChecksumSha256,
            "image/webp",
            reference.normalizedContentLength,
            reference.normalizedWidth,
            reference.normalizedHeight,
            normalizedMetadata,
          ],
        );
        await transaction.query(
          `INSERT INTO image_style_references (
             id, account_id, workspace_id, style_id, version_id, normalized_asset_id,
             original_asset_id, reference_order, rights_attested_by_user_id,
             rights_basis, rights_basis_note, rights_attested_at, original_retention_policy
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12)`,
          [
            await stableHostedUuid(`${replacementNamespace}:reference:${reference.orderIndex}`),
            scope.account_id,
            scope.workspace_id,
            styleId,
            versionId,
            normalizedAssetId,
            originalAssetId,
            reference.orderIndex + 1,
            rowString(previous, "rights_attested_by_user_id"),
            rowString(previous, "rights_basis"),
            sqlValue(previous.rights_basis_note),
            rowString(previous, "original_retention_policy"),
          ],
        );
        uploadRows.push({
          object_key: originalKey,
          content_type: reference.contentType,
          content_length: reference.contentLength,
          checksum_sha256: reference.checksumSha256,
          normalized_object_key: normalizedKey,
          normalized_content_type: "image/webp",
          normalized_content_length: reference.normalizedContentLength,
          normalized_checksum_sha256: reference.normalizedChecksumSha256,
        });
      }
      return {
        style_id: styleId,
        style_name: rowString(target, "style_name"),
        version_id: versionId,
        version_number: versionNumber,
        state: "DRAFT",
        uploads: uploadRows,
      };
    });
    if (!prepared)
      return response(
        {
          error: {
            code: "STYLE_NOT_FOUND",
            message: "This style is no longer available. Return to Image Styles and try again.",
          },
        },
        404,
      );
    const uploads = Array.isArray(prepared.uploads)
      ? (prepared.uploads as Record<string, unknown>[]).map((item) => item)
      : [];
    if (uploads.length < 3)
      return response(
        {
          error: {
            code: "STYLE_REFERENCE_REPLACE_REJECTED",
            message:
              "Reference replacement could not be prepared. Return to Image Styles and try again.",
          },
        },
        409,
      );
    const ports = [];
    const normalizedPorts = [];
    for (const item of uploads) {
      const objectKey = rowString(item, "object_key");
      ports.push(
        await new HostedR2Signer(config.r2).sign({
          method: "PUT",
          objectKey,
          contentType: rowString(item, "content_type"),
          contentLength: Number(item.content_length),
          checksumSha256: rowString(item, "checksum_sha256"),
          lifetimeSeconds: 900,
        }),
      );
      normalizedPorts.push(
        await new HostedR2Signer(config.r2).sign({
          method: "PUT",
          objectKey: rowString(item, "normalized_object_key"),
          contentType: rowString(item, "normalized_content_type"),
          contentLength: Number(item.normalized_content_length),
          checksumSha256: rowString(item, "normalized_checksum_sha256"),
          lifetimeSeconds: 900,
        }),
      );
    }
    return response(
      {
        schema_version: "videoforge-hosted-style-reference-replace-response/v1",
        style_id: rowString(prepared, "style_id"),
        style_name: rowString(prepared, "style_name"),
        version_id: rowString(prepared, "version_id"),
        version_number: Number(prepared.version_number),
        state: prepared.state,
        uploads: ports,
        normalized_uploads: normalizedPorts,
        provider_calls_authorized: false,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "STYLE_NOT_FOUND")
      return response(
        {
          error: {
            code: "STYLE_NOT_FOUND",
            message: "This style is no longer available. Return to Image Styles and try again.",
          },
        },
        404,
      );
    if (error instanceof Error && error.message === "STYLE_REFERENCE_REPLACE_NOT_ALLOWED")
      return response(
        {
          error: {
            code: error.message,
            message:
              "This style is no longer waiting for uploads. Return to Image Styles and try again.",
          },
        },
        409,
      );
    if (error instanceof Error && error.message === "STYLE_REFERENCE_REPLACE_IDEMPOTENCY_CONFLICT")
      return response(
        {
          error: {
            code: error.message,
            message:
              "This saved replacement no longer matches the selected images. Choose them again.",
          },
        },
        409,
      );
    if (postgresCode(error) === "23505")
      return response(
        {
          error: {
            code: "STYLE_REFERENCE_REPLACE_CONFLICT",
            message: "The style changed while it was open. Refresh Image Styles and try again.",
          },
        },
        409,
      );
    throw error;
  } finally {
    await pool.end();
  }
}

async function styleCommit(
  request: Request,
  styleOrVersionId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(styleOrVersionId))
    return response(
      {
        error: {
          code: "STYLE_NOT_FOUND",
          message: "This style is no longer available. Return to Image Styles and try again.",
        },
      },
      404,
    );
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const raw = await parseHostedJson(request, "STYLE_COMMIT_REJECTED");
  if (raw instanceof Response) return raw;
  if (!parseEmptyObject(raw))
    return response(
      { error: { code: "STYLE_COMMIT_REJECTED", message: "The uploads could not be saved." } },
      400,
    );
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const pending = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<HostedPresetRow>(
        `SELECT style.id AS style_id, version.id AS version_id, version.state,
                reference.reference_order, original.object_key AS original_object_key,
                original.content_type AS original_content_type,
                original.byte_size AS original_content_length,
                original.binary_sha256 AS original_checksum,
                normalized.object_key AS normalized_object_key,
                normalized.content_type AS normalized_content_type,
                normalized.byte_size AS normalized_content_length,
                normalized.binary_sha256 AS normalized_checksum,
                reference.original_asset_id, reference.normalized_asset_id
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id AND version.style_id = style.id
           JOIN image_style_references AS reference
             ON reference.account_id = version.account_id
            AND reference.workspace_id = version.workspace_id AND reference.version_id = version.id
           JOIN assets AS original
             ON original.account_id = reference.account_id
            AND original.workspace_id = reference.workspace_id AND original.id = reference.original_asset_id
           JOIN assets AS normalized
             ON normalized.account_id = reference.account_id
            AND normalized.workspace_id = reference.workspace_id AND normalized.id = reference.normalized_asset_id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
            AND (style.id = $3 OR version.id = $3)
            AND version.id = (
              SELECT candidate.id
                FROM image_style_versions AS candidate
               WHERE candidate.account_id = style.account_id
                 AND candidate.workspace_id = style.workspace_id
                 AND candidate.style_id = style.id
                 AND (style.id = $3 OR candidate.id = $3)
               ORDER BY candidate.version_number DESC
               LIMIT 1
            )
          ORDER BY reference.reference_order`,
        [scope.account_id, scope.workspace_id, styleOrVersionId],
      );
      return result.rows;
    });
    if (pending.length === 0)
      return response(
        {
          error: {
            code: "STYLE_NOT_FOUND",
            message: "This style is no longer available. Return to Image Styles and try again.",
          },
        },
        404,
      );
    const first = pending[0]!;
    if (first.state !== "PUBLISHED") {
      for (const reference of pending) {
        const object = await bucket.head(rowString(reference, "original_object_key"));
        if (
          !object ||
          object.size !== Number(reference.original_content_length) ||
          object.httpMetadata?.contentType !== reference.original_content_type ||
          checksumFromR2(object.checksums?.sha256) !== reference.original_checksum
        ) {
          return response(
            {
              error: {
                code: "STYLE_REFERENCE_NOT_VERIFIED",
                message:
                  "One or more original uploads could not be verified. Choose the images again.",
              },
            },
            409,
          );
        }
        const normalized = await bucket.head(rowString(reference, "normalized_object_key"));
        if (
          !normalized ||
          normalized.size !== Number(reference.normalized_content_length) ||
          normalized.httpMetadata?.contentType !== reference.normalized_content_type ||
          checksumFromR2(normalized.checksums?.sha256) !== reference.normalized_checksum
        ) {
          return response(
            {
              error: {
                code: "STYLE_NORMALIZED_NOT_VERIFIED",
                message:
                  "One or more prepared references could not be verified. Choose the images again.",
              },
            },
            409,
          );
        }
      }
      const committed = await createNeonExecutor(pool).transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1, $2, true)", [
          "videoforge.account_id",
          scope.account_id,
        ]);
        if (!(await lockActiveStyleParent(transaction, scope, styleOrVersionId))) return false;
        for (const reference of pending) {
          await transaction.query(
            `UPDATE assets
                SET state = 'VERIFIED', verified_at = COALESCE(verified_at, now())
              WHERE account_id = $1 AND workspace_id = $2 AND id IN ($3,$4)
                AND EXISTS (
                  SELECT 1
                    FROM image_style_references AS reference
                    JOIN image_styles AS style
                      ON style.account_id = reference.account_id
                     AND style.workspace_id = reference.workspace_id
                     AND style.id = reference.style_id
                     AND style.scope_kind = 'WORKSPACE'
                     AND style.status = 'ACTIVE'
                   WHERE reference.account_id = $1
                     AND reference.workspace_id = $2
                     AND reference.version_id = $5
                     AND (reference.original_asset_id = assets.id OR reference.normalized_asset_id = assets.id)
                )`,
            [
              scope.account_id,
              scope.workspace_id,
              rowString(reference, "original_asset_id"),
              rowString(reference, "normalized_asset_id"),
              rowString(reference, "version_id"),
            ],
          );
        }
        return true;
      });
      if (committed === false)
        return response(
          {
            error: {
              code: "STYLE_NOT_FOUND",
              message: "This style is no longer available. Return to Image Styles and try again.",
            },
          },
          404,
        );
    }
    return response({
      schema_version: "videoforge-hosted-style-commit-response/v1",
      style_id: rowString(first, "style_id"),
      version_id: rowString(first, "version_id"),
      state: first.state === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      uploads: [],
      provider_calls_authorized: false,
    });
  } finally {
    await pool.end();
  }
}

async function styleAnalyze(
  request: Request,
  styleOrVersionId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(styleOrVersionId))
    return response(
      {
        error: {
          code: "STYLE_NOT_FOUND",
          message: "This style is no longer available. Return to Image Styles and try again.",
        },
      },
      404,
    );
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const raw = await parseHostedJson(request, "STYLE_ANALYSIS_REJECTED");
  if (raw instanceof Response) return raw;
  if (!parseStyleAnalysis(raw))
    return response(
      { error: { code: "STYLE_ANALYSIS_REJECTED", message: "Confirm the analysis disclosure." } },
      400,
    );
  if (!config.styleAnalysis)
    return response(
      {
        error: {
          code: "STYLE_ANALYSIS_UNAVAILABLE",
          message: "Image analysis is temporarily unavailable. Try again shortly.",
        },
      },
      503,
    );
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  let preparedVersionId: string | null = null;
  let preparedRunId: string | null = null;
  let providerMayHaveCharged = false;
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveStyleParent(transaction, scope, styleOrVersionId))) return null;
      const result = await transaction.query<HostedPresetRow>(
        `SELECT style.id AS style_id, style.name AS style_name, version.id AS version_id,
                version.version_number, version.state, version.profile_payload, version.style_profile_hash,
                version.analyzer_model_snapshot,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'order_index', reference.reference_order,
                  'checksum_sha256', normalized.binary_sha256,
                  'object_key', normalized.object_key,
                  'content_type', normalized.content_type,
                  'byte_size', normalized.byte_size,
                  'width', normalized.width_px,
                  'height', normalized.height_px,
                  'asset_state', normalized.state
                ) ORDER BY reference.reference_order) FILTER (WHERE reference.id IS NOT NULL), '[]'::jsonb) AS references
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id AND version.style_id = style.id
           LEFT JOIN image_style_references AS reference
             ON reference.account_id = version.account_id
            AND reference.workspace_id = version.workspace_id AND reference.version_id = version.id
           LEFT JOIN assets AS normalized
             ON normalized.account_id = reference.account_id
            AND normalized.workspace_id = reference.workspace_id AND normalized.id = reference.normalized_asset_id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
            AND (style.id = $3 OR version.id = $3)
          GROUP BY style.id, style.name, version.id, version.state, version.profile_payload, version.style_profile_hash,
                   version.analyzer_model_snapshot,
                   version.version_number
          ORDER BY version.version_number DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, styleOrVersionId],
      );
      let target = result.rows[0];
      if (!target) return null;
      if (target.state === "NEEDS_REVIEW" || target.state === "PUBLISHED")
        return { ...target, already_analyzed: true };
      if (target.state === "ANALYZING") throw new Error("STYLE_ANALYSIS_IN_PROGRESS");
      if (target.state === "FAILED") {
        const failedVersionId = rowString(target, "version_id");
        const retryVersionId = await stableHostedUuid(
          `hosted-style-analysis-retry:${scope.account_id}:${failedVersionId}`,
        );
        const retryVersionNumber = Number(target.version_number) + 1;
        const abandoned = await transaction.query(
          `UPDATE image_style_versions AS version
              SET state = 'ABANDONED', abandoned_at = now(), updated_at = now()
             FROM image_styles AS style
            WHERE version.account_id = $1 AND version.workspace_id = $2 AND version.id = $3
              AND version.state = 'FAILED'
              AND style.account_id = version.account_id
              AND style.workspace_id = version.workspace_id AND style.id = version.style_id
              AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
          RETURNING version.id`,
          [scope.account_id, scope.workspace_id, failedVersionId],
        );
        if (!abandoned.rows[0]) throw new Error("STYLE_ANALYSIS_IN_PROGRESS");
        await transaction.query(
          `INSERT INTO image_style_versions (
             id, account_id, workspace_id, style_id, version_number, state, scope_kind,
             disclosure_attested_by_user_id
           ) VALUES ($1,$2,$3,$4,$5,'DRAFT','WORKSPACE',$6)`,
          [
            retryVersionId,
            scope.account_id,
            scope.workspace_id,
            rowString(target, "style_id"),
            retryVersionNumber,
            scope.user_id,
          ],
        );
        const sourceReferences = await transaction.query<HostedPresetRow>(
          `SELECT reference_order, normalized_asset_id, original_asset_id,
                  rights_attested_by_user_id, rights_basis, rights_basis_note,
                  rights_attested_at, original_retention_policy, confidence,
                  is_outlier, retention_state
             FROM image_style_references
            WHERE account_id = $1 AND workspace_id = $2 AND version_id = $3
              AND deleted_at IS NULL
            ORDER BY reference_order`,
          [scope.account_id, scope.workspace_id, failedVersionId],
        );
        for (const source of sourceReferences.rows) {
          const order = Number(source.reference_order);
          await transaction.query(
            `INSERT INTO image_style_references (
               id, account_id, workspace_id, style_id, version_id,
               normalized_asset_id, original_asset_id, reference_order,
               rights_attested_by_user_id, rights_basis, rights_basis_note,
               rights_attested_at, original_retention_policy, confidence,
               is_outlier, retention_state
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              await stableHostedUuid(
                `hosted-style-analysis-retry-reference:${scope.account_id}:${retryVersionId}:${order}`,
              ),
              scope.account_id,
              scope.workspace_id,
              rowString(target, "style_id"),
              retryVersionId,
              rowString(source, "normalized_asset_id"),
              rowString(source, "original_asset_id"),
              order,
              rowString(source, "rights_attested_by_user_id"),
              rowString(source, "rights_basis"),
              sqlValue(source.rights_basis_note),
              sqlValue(source.rights_attested_at),
              rowString(source, "original_retention_policy"),
              sqlValue(source.confidence),
              source.is_outlier === true,
              rowString(source, "retention_state"),
            ],
          );
        }
        target = {
          ...target,
          version_id: retryVersionId,
          version_number: retryVersionNumber,
          state: "DRAFT",
          profile_payload: null,
          style_profile_hash: null,
          analyzer_model_snapshot: null,
        };
      }
      if (target.state !== "DRAFT") throw new Error("STYLE_NOT_ANALYZABLE");
      const references = Array.isArray(target.references) ? target.references : [];
      if (
        references.length < 3 ||
        references.some((reference) => plainRecord(reference)?.asset_state !== "VERIFIED")
      )
        throw new Error("STYLE_REFERENCES_NOT_COMMITTED");
      const requestHash = await sha256(
        canonicalJson({ version_id: target.version_id, references }),
      );
      const runId = await stableHostedUuid(
        `hosted-style-analysis:${scope.account_id}:${String(target.version_id)}:${requestHash}`,
      );
      const reservation = await transaction.query<HostedPresetRow>(
        `SELECT * FROM public.videoforge_reserve_hosted_style_analysis($1,$2,$3)`,
        [rowString(target, "version_id"), requestHash, runId],
      );
      if (reservation.rows[0]?.dispatch_allowed !== true)
        throw new Error("STYLE_ANALYSIS_IN_PROGRESS");
      await transaction.query(
        `UPDATE image_style_versions AS version
            SET state = 'ANALYZING', analyzer_request_hash = $4,
                analyzer_model_snapshot = $5,
                disclosure_attested_by_user_id = $6, updated_at = now()
             FROM image_styles AS style
            WHERE version.account_id = $1 AND version.workspace_id = $2 AND version.id = $3
              AND style.account_id = version.account_id
              AND style.workspace_id = version.workspace_id
              AND style.id = version.style_id
              AND style.scope_kind = 'WORKSPACE'
              AND style.status = 'ACTIVE'`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "version_id"),
          requestHash,
          "google:gemini@3.1-flash-lite",
          scope.user_id,
        ],
      );
      return {
        ...target,
        state: "ANALYZING",
        references,
        request_hash: requestHash,
        analysis_run_id: runId,
      };
    });
    if (!prepared)
      return response(
        {
          error: {
            code: "STYLE_NOT_FOUND",
            message: "This style is no longer available. Return to Image Styles and try again.",
          },
        },
        404,
      );
    const preparedRow = prepared as HostedPresetRow;
    preparedVersionId = rowString(preparedRow, "version_id");
    if (preparedRow.already_analyzed === true) {
      const profile = plainRecord(preparedRow.profile_payload);
      return response({
        schema_version: "videoforge-hosted-style-analysis-response/v1",
        style_id: rowString(preparedRow, "style_id"),
        version_id: rowString(preparedRow, "version_id"),
        state: preparedRow.state,
        profile,
        profile_hash: preparedRow.style_profile_hash ?? null,
        summary: profile?.summary ?? null,
        provider_calls_authorized: true,
      });
    }
    preparedRunId = rowString(preparedRow, "analysis_run_id");

    const images: RunwareGeminiStyleImage[] = [];
    const referenceRows = preparedRow.references as unknown[];
    const aggregateBytes = referenceRows.reduce<number>((total, rawReference) => {
      const reference = plainRecord(rawReference);
      return total + (reference ? Number(reference.byte_size) : Number.NaN);
    }, 0);
    if (
      !Number.isSafeInteger(aggregateBytes) ||
      aggregateBytes > RUNWARE_GEMINI_STYLE_MAX_INPUT_BYTES
    )
      throw new RunwareGeminiStyleAnalysisError("INPUT_REJECTED");
    for (const [index, rawReference] of referenceRows.entries()) {
      const reference = plainRecord(rawReference);
      if (!reference) throw new Error("STYLE_REFERENCES_NOT_COMMITTED");
      const object = await bucket.get(rowString(reference, "object_key"));
      if (!object) throw new Error("STYLE_REFERENCES_NOT_COMMITTED");
      const bytes = new Uint8Array(await object.arrayBuffer());
      const expected = rowString(reference, "checksum_sha256");
      const width = Number(reference.width);
      const height = Number(reference.height);
      if (
        rowString(reference, "content_type") !== "image/webp" ||
        bytes.byteLength !== Number(reference.byte_size) ||
        (await sha256Bytes(bytes)) !== expected
      )
        throw new Error("STYLE_REFERENCES_NOT_COMMITTED");
      if (
        !Number.isSafeInteger(width) ||
        width <= 0 ||
        !Number.isSafeInteger(height) ||
        height <= 0
      )
        throw new Error("STYLE_REFERENCES_NOT_COMMITTED");
      images.push({
        alias: `ref_${String(index + 1).padStart(2, "0")}`,
        mimeType: "image/webp",
        sha256: expected as RunwareGeminiStyleImage["sha256"],
        width,
        height,
        bytes,
      });
    }
    providerMayHaveCharged = true;
    const providerResult = await analyzeStyleWithRunwareGemini({
      apiKey: config.styleAnalysis.apiKey,
      baseUrl: config.styleAnalysis.baseUrl,
      images,
    });
    const reportedCostMicroUsd = runwareGeminiStyleActualCostMicroUsd(providerResult.costUsd);
    const analyzed = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveStyleParent(transaction, scope, styleOrVersionId))) return null;
      const updated = await transaction.query<HostedPresetRow>(
        `UPDATE image_style_versions AS version
            SET state = 'NEEDS_REVIEW', profile_contract_name = 'image-style-profile',
                profile_contract_version = 'v1', profile_payload = $4::jsonb,
                style_profile_hash = $5, updated_at = now()
             FROM image_styles AS style
            WHERE version.account_id = $1 AND version.workspace_id = $2 AND version.id = $3
              AND version.state = 'ANALYZING'
              AND style.account_id = version.account_id
              AND style.workspace_id = version.workspace_id
              AND style.id = version.style_id
              AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
          RETURNING style.id AS style_id, version.id AS version_id, version.state`,
        [
          scope.account_id,
          scope.workspace_id,
          preparedVersionId,
          JSON.stringify(providerResult.trusted.profile),
          providerResult.trusted.styleProfileHash,
        ],
      );
      const saved = updated.rows[0];
      if (!saved) throw new Error("STYLE_ANALYSIS_COMPLETION_REJECTED");
      const receipt = await transaction.query<{ finished: boolean }>(
        `SELECT public.videoforge_finish_hosted_style_analysis($1,'SUCCEEDED',$2,$3,$4,$5,$6) AS finished`,
        [
          preparedRunId,
          providerResult.responseSha256,
          providerResult.providerRequestId,
          providerResult.usage.promptTokens,
          providerResult.usage.completionTokens,
          reportedCostMicroUsd,
        ],
      );
      if (receipt.rows[0]?.finished !== true) throw new Error("STYLE_ANALYSIS_RECEIPT_REJECTED");
      return saved;
    });
    // The provider has already run. Route every post-dispatch persistence failure through the
    // reconciliation path so the durable reservation becomes UNKNOWN and can never redispatch.
    if (!analyzed) throw new RunwareGeminiStyleAnalysisError("AMBIGUOUS");
    const profile = providerResult.trusted.profile as unknown as Record<string, unknown>;
    return response({
      schema_version: "videoforge-hosted-style-analysis-response/v1",
      style_id: rowString(analyzed, "style_id"),
      version_id: rowString(analyzed, "version_id"),
      state: analyzed.state,
      profile,
      profile_hash: providerResult.trusted.styleProfileHash,
      summary: profile?.summary ?? null,
      analysis_cost_usd: reportedCostMicroUsd / 1_000_000,
      analysis_usage: {
        prompt_tokens: providerResult.usage.promptTokens,
        completion_tokens: providerResult.usage.completionTokens,
      },
      provider_calls_authorized: true,
    });
  } catch (error) {
    const definitiveProviderRejection =
      error instanceof RunwareGeminiStyleAnalysisError &&
      (error.code === "INPUT_REJECTED" ||
        error.code === "PROVIDER_REJECTED" ||
        error.code === "UNAVAILABLE");
    const ambiguous = providerMayHaveCharged && !definitiveProviderRejection;
    if (preparedRunId) {
      try {
        const scope = await sessionScope(request, config, pool, executionContext);
        if (!(scope instanceof Response)) {
          await createNeonExecutor(pool).transaction(async (transaction) => {
            await transaction.query("SELECT set_config($1, $2, true)", [
              "videoforge.account_id",
              scope.account_id,
            ]);
            await transaction.query(
              `SELECT public.videoforge_finish_hosted_style_analysis($1,$2,NULL,NULL,0,0,0)`,
              [preparedRunId, ambiguous ? "UNKNOWN" : "FAILED"],
            );
          });
        }
      } catch {
        // The reservation remains charged against the global cap and prevents redispatch.
      }
    }
    if (preparedVersionId && !ambiguous) {
      try {
        const scope = await sessionScope(request, config, pool, executionContext);
        if (!(scope instanceof Response)) {
          await createNeonExecutor(pool).transaction(async (transaction) => {
            await transaction.query("SELECT set_config($1, $2, true)", [
              "videoforge.account_id",
              scope.account_id,
            ]);
            await transaction.query(
              `UPDATE image_style_versions AS version SET state = 'FAILED', updated_at = now()
                FROM image_styles AS style
               WHERE version.account_id = $1 AND version.workspace_id = $2
                 AND version.id = $3 AND version.state = 'ANALYZING'
                 AND style.account_id = version.account_id
                 AND style.workspace_id = version.workspace_id
                 AND style.id = version.style_id AND style.scope_kind = 'WORKSPACE'`,
              [scope.account_id, scope.workspace_id, preparedVersionId ?? styleOrVersionId],
            );
          });
        }
      } catch {
        // Preserve the original failure as the user-facing error; recovery remains retryable.
      }
    }
    if (error instanceof RunwareGeminiStyleAnalysisError) {
      if (error.code === "AMBIGUOUS" || error.code === "INVALID_RESPONSE")
        return response(
          {
            error: {
              code: "STYLE_ANALYSIS_RECONCILING",
              message: "The analysis result is being reconciled. Do not retry yet.",
            },
          },
          503,
        );
      const message =
        error.code === "INPUT_REJECTED"
          ? "The prepared images did not pass analysis validation. Your draft is saved; choose the references again."
          : error.code === "PROVIDER_REJECTED"
            ? "Gemini could not accept this analysis request. Your draft is saved and can be retried after the service is corrected."
            : "Gemini image analysis is temporarily unavailable. Try again.";
      return response({ error: { code: `STYLE_ANALYSIS_${error.code}`, message } }, 502);
    }
    if (error instanceof Error && error.message === "STYLE_ANALYSIS_IN_PROGRESS")
      return response(
        {
          error: {
            code: error.message,
            message: "This style is already being analyzed. Wait a moment, then try again.",
          },
        },
        409,
      );
    if (error instanceof Error && error.message === "STYLE_NOT_ANALYZABLE")
      return response(
        {
          error: {
            code: error.message,
            message:
              "This draft cannot be analyzed in its current state. Return to Image Styles and try again.",
          },
        },
        409,
      );
    if (error instanceof Error && error.message === "STYLE_REFERENCES_NOT_COMMITTED")
      return response(
        {
          error: {
            code: error.message,
            message:
              "One or more reference uploads could not be verified. Choose the images again.",
          },
        },
        409,
      );
    if (postgresCode(error) === "54000")
      return response(
        {
          error: {
            code: "STYLE_ANALYSIS_BETA_CAP_REACHED",
            message:
              "The private beta analysis limit has been reached. No provider request was sent.",
          },
        },
        409,
      );
    throw error;
  } finally {
    await pool.end();
  }
}

async function stylePublish(
  request: Request,
  styleOrVersionId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(styleOrVersionId))
    return response(
      {
        error: {
          code: "STYLE_NOT_FOUND",
          message: "This style is no longer available. Return to Image Styles and try again.",
        },
      },
      404,
    );
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!hostedProviderFreePresetCreationEnabled(config))
    return unavailableHostedCapability("PRESET_CREATION_NOT_QUALIFIED");
  const raw = await parseHostedJson(request, "STYLE_PUBLISH_REJECTED");
  if (raw instanceof Response) return raw;
  const input = parseStylePublish(raw);
  if (!input)
    return response(
      { error: { code: "STYLE_PUBLISH_REJECTED", message: "Review the style before publishing." } },
      400,
    );
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const published = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (!(await lockActiveStyleParent(transaction, scope, styleOrVersionId))) return null;
      const result = await transaction.query<HostedPresetRow>(
        `SELECT style.id AS style_id, version.id AS version_id, version.state,
                version.profile_payload, version.style_profile_hash
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id AND version.style_id = style.id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
            AND (style.id = $3 OR version.id = $3)
          ORDER BY version.version_number DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, styleOrVersionId],
      );
      const target = result.rows[0];
      if (!target) return null;
      if (target.state === "PUBLISHED") return target;
      if (target.state !== "NEEDS_REVIEW") throw new Error("STYLE_NOT_PUBLISHABLE");
      const stored = plainRecord(target.profile_payload);
      if (!stored || !target.style_profile_hash) throw new Error("STYLE_PROFILE_MISSING");
      if (input.candidate) {
        const candidate = { ...input.candidate };
        delete candidate.review_notes;
        if (canonicalJson(candidate) !== canonicalJson(stored))
          throw new Error("STYLE_PROFILE_MISMATCH");
      }
      await transaction.query(
        `UPDATE image_style_versions AS version
            SET state = 'PUBLISHED', disclosure_attested_by_user_id = $4,
                published_at = now(), updated_at = now()
             FROM image_styles AS style
            WHERE version.account_id = $1 AND version.workspace_id = $2 AND version.id = $3
              AND style.account_id = version.account_id
              AND style.workspace_id = version.workspace_id
              AND style.id = version.style_id
              AND style.scope_kind = 'WORKSPACE'
              AND style.status = 'ACTIVE'`,
        [scope.account_id, scope.workspace_id, rowString(target, "version_id"), scope.user_id],
      );
      await transaction.query(
        `UPDATE image_styles SET active_version_id = $3, updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2 AND id = $4
            AND scope_kind = 'WORKSPACE' AND status = 'ACTIVE'`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "version_id"),
          rowString(target, "style_id"),
        ],
      );
      return target;
    });
    if (!published)
      return response(
        {
          error: {
            code: "STYLE_NOT_FOUND",
            message: "This style is no longer available. Return to Image Styles and try again.",
          },
        },
        404,
      );
    return response({
      schema_version: "videoforge-hosted-style-publish-response/v1",
      style_id: rowString(published, "style_id"),
      version_id: rowString(published, "version_id"),
      state: "PUBLISHED",
      profile_hash: rowString(published, "style_profile_hash"),
      provider_calls_authorized: false,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["STYLE_NOT_PUBLISHABLE", "STYLE_PROFILE_MISSING", "STYLE_PROFILE_MISMATCH"].includes(
        error.message,
      )
    )
      return response(
        {
          error: {
            code: error.message,
            message:
              error.message === "STYLE_NOT_PUBLISHABLE"
                ? "Analyze and review this style before publishing."
                : error.message === "STYLE_PROFILE_MISMATCH"
                  ? "The reviewed style changed. Analyze it again before publishing."
                  : "The analyzed style profile is unavailable. Analyze it again before publishing.",
          },
        },
        409,
      );
    throw error;
  } finally {
    await pool.end();
  }
}

async function retryProjectAttempt(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!HOSTED_TARGETED_RETRY_QUALIFIED)
    return unavailableHostedCapability("TARGETED_RETRY_NOT_QUALIFIED");
  const raw = await parseHostedJson(request, "RETRY_REJECTED");
  if (raw instanceof Response) return raw;
  const input = parseRetry(raw);
  if (!input) return response({ error: { code: "RETRY_REJECTED" } }, 400);
  if (input.assetId !== null)
    return response({ error: { code: "RETRY_ASSET_REPLACEMENT_REQUIRED" } }, 409);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const retried = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<HostedPresetRow>(
        `SELECT attempt.id AS attempt_id, attempt.lane, attempt.attempt_ordinal,
                attempt.state AS attempt_state, attempt.version AS attempt_version,
                attempt.task_id,
                task.state AS task_state, task.version AS task_version,
                request.id AS generation_request_id, request.state AS request_state,
                request.attempt_ordinal AS request_attempt_ordinal,
                request.version AS request_version
           FROM serverless_attempts AS attempt
           JOIN generation_tasks AS task
             ON task.account_id = attempt.account_id
            AND task.workspace_id = attempt.workspace_id AND task.id = attempt.task_id
           JOIN generation_requests AS request
             ON request.account_id = attempt.account_id
            AND request.workspace_id = attempt.workspace_id
            AND request.id = attempt.generation_request_id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.project_id = $3 AND attempt.id = $4
            AND attempt.state = 'RETRYABLE_FAILED'
            AND attempt.attempt_ordinal < 3
            AND request.state = 'FAILED'
            AND task.state = 'FAILED'
          FOR UPDATE OF attempt, task, request`,
        [scope.account_id, scope.workspace_id, projectId, input.attemptId],
      );
      const target = result.rows[0];
      if (!target) return null;
      const consumed = await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'PERMANENT_FAILED', terminal_at = COALESCE(terminal_at, now()),
                version = version + 1, updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3
            AND state = 'RETRYABLE_FAILED' AND version = $4
          RETURNING id`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "attempt_id"),
          Number(target.attempt_version),
        ],
      );
      if (consumed.rows.length !== 1) throw new Error("RETRY_NOT_ALLOWED");
      const requestUpdated = await transaction.query(
        `UPDATE generation_requests
            SET state = 'RETRY_WAIT', attempt_ordinal = attempt_ordinal + 1,
                terminal_at = NULL, admitted_at = NULL, version = version + 1,
                updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3
            AND state = 'FAILED' AND version = $4
          RETURNING id`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "generation_request_id"),
          Number(target.request_version),
        ],
      );
      const taskUpdated = await transaction.query(
        `UPDATE generation_tasks
            SET state = 'RETRY_WAIT', finished_at = NULL, version = version + 1,
                updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3
            AND state = 'FAILED' AND version = $4
          RETURNING id`,
        [
          scope.account_id,
          scope.workspace_id,
          rowString(target, "task_id"),
          Number(target.task_version),
        ],
      );
      if (requestUpdated.rows.length !== 1 || taskUpdated.rows.length !== 1)
        throw new Error("RETRY_NOT_ALLOWED");
      return target;
    });
    if (!retried) return response({ error: { code: "RETRY_NOT_ALLOWED" } }, 409);
    return response({
      schema_version: "videoforge-hosted-retry/v1",
      project_id: projectId,
      attempt_id: rowString(retried, "attempt_id"),
      lane: retried.lane,
      state: "RETRY_WAIT",
      replacement_allowed: true,
      redispatch: false,
      provider_calls_authorized: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RETRY_NOT_ALLOWED")
      return response({ error: { code: error.message } }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}

async function projectManifest(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const data = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const project = await transaction.query<HostedPresetRow>(
        `SELECT project.id, project.name AS title, revision.id AS revision_id,
                revision.status AS revision_state, revision.revision_config_hash AS config_hash,
                revision.revision_config_payload AS config_payload,
                revision.avatar_profile_id, revision.avatar_profile_version_id,
                revision.avatar_profile_hash, revision.image_style_id,
                revision.image_style_version_id, revision.style_profile_hash,
                revision.voiceover_asset_id, revision.voiceover_binary_sha256,
                review.render_attempt_id, review.output_checksum_sha256,
                review.approved_by_user_id, review.approved_at,
                attempt.request_sha256, attempt.state AS attempt_state,
                attempt.replay_count, attempt.submitted_at, attempt.terminal_at,
                authority.object_key, authority.content_type,
                authority.issued_content_length AS content_length,
                authority.issued_checksum_sha256 AS checksum_sha256
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id AND revision.project_id = project.id
           LEFT JOIN hosted_project_reviews AS review
             ON review.account_id = project.account_id
            AND review.workspace_id = project.workspace_id AND review.project_id = project.id
           LEFT JOIN hosted_cpu_job_attempts AS attempt
             ON attempt.account_id = review.account_id
            AND attempt.workspace_id = review.workspace_id AND attempt.id = review.render_attempt_id
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id AND authority.attempt_id = attempt.id
            AND authority.source = 'PRIMARY_RESULT_OUTPUT' AND authority.issued_at IS NOT NULL
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
            AND project.status = 'ACTIVE'
            AND project.project_kind = 'USER'
          ORDER BY revision.revision_number DESC, review.approved_at DESC NULLS LAST
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return project.rows[0] ?? null;
    });
    if (!data) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    if (!data.render_attempt_id || !data.object_key || data.attempt_state !== "SUCCEEDED")
      return response({ error: { code: "PROJECT_APPROVAL_REQUIRED" } }, 409);
    const manifest = {
      schema_version: "videoforge-hosted-provenance-manifest/v1",
      project: {
        id: data.id,
        title: data.title,
        revision_id: data.revision_id,
        revision_state: data.revision_state,
      },
      revision: {
        config_hash: data.config_hash,
        config_payload: data.config_payload,
        avatar_profile_id: data.avatar_profile_id,
        avatar_profile_version_id: data.avatar_profile_version_id,
        avatar_profile_hash: data.avatar_profile_hash,
        image_style_id: data.image_style_id,
        image_style_version_id: data.image_style_version_id,
        style_profile_hash: data.style_profile_hash,
        voiceover_asset_id: data.voiceover_asset_id,
        voiceover_sha256: data.voiceover_binary_sha256,
      },
      creative_approval: {
        state: "APPROVED",
        render_attempt_id: data.render_attempt_id,
        approved_by_user_id: data.approved_by_user_id,
        approved_at: timestampOrNull(data.approved_at),
        output_checksum_sha256: data.output_checksum_sha256,
      },
      final_output: {
        attempt_id: data.render_attempt_id,
        object_key: data.object_key,
        content_type: data.content_type,
        content_length: Number(data.content_length),
        checksum_sha256: data.checksum_sha256,
      },
      execution: {
        kind: "RENDER",
        state: data.attempt_state,
        request_sha256: data.request_sha256,
        replay_count: Number(data.replay_count ?? 0),
        submitted_at: timestampOrNull(data.submitted_at),
        terminal_at: timestampOrNull(data.terminal_at),
      },
      cost: { provider: "personal-worker", projected_usd: 0, settled_usd: 0 },
      guarantees: {
        approval_required: true,
        provider_exactly_once_execution_claimed: false,
        provider_exactly_once_billing_claimed: false,
      },
    };
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="videoforge-provenance.json"',
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-videoforge-runtime": "hosted-v2-06",
      },
    });
  } finally {
    await pool.end();
  }
}

function checksumFromR2(value?: ArrayBuffer): string | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function voiceoverExtension(contentType: string): string {
  return contentType === "audio/wav"
    ? "wav"
    : contentType === "audio/flac"
      ? "flac"
      : contentType === "audio/mpeg"
        ? "mp3"
        : "m4a";
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function postgresConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("constraint" in error)) return null;
  return typeof error.constraint === "string" ? error.constraint : null;
}

export function hostedStyleConflictProblem(constraint: string | null): {
  readonly code: string;
  readonly message: string;
} {
  if (constraint === "image_styles_active_name_uq")
    return {
      code: "STYLE_NAME_CONFLICT",
      message: "That style name is already in use. Open Image Styles to continue or remove it.",
    };
  if (
    constraint === "image_style_versions_open_draft_uq" ||
    constraint === "image_style_versions_workspace_id_style_id_version_number_key"
  )
    return {
      code: "STYLE_VERSION_CONFLICT",
      message:
        "This style changed while it was open. Refresh Image Styles and continue from the latest version.",
    };
  return {
    code: "STYLE_SAVE_CONFLICT",
    message: "Style could not be saved. Refresh Image Styles and try again.",
  };
}

export function hostedProjectConflictProblem(
  constraint: string | null,
  title: string,
): { readonly code: string; readonly message: string } | null {
  if (constraint !== "projects_active_name_uq") return null;
  return {
    code: "PROJECT_TITLE_CONFLICT",
    message: `Another active project is still named “${title}”. Open Progress to continue that project or delete it, or choose a different title.`,
  };
}

export function hostedAvatarConflictProblem(constraint: string | null): {
  readonly code: string;
  readonly message: string;
} {
  if (constraint === "avatar_profiles_active_name_uq")
    return {
      code: "AVATAR_NAME_CONFLICT",
      message: "That avatar name is already in use. Open Avatar Hub to continue or remove it.",
    };
  if (
    constraint === "avatar_profile_versions_open_draft_uq" ||
    constraint === "avatar_profile_versions_workspace_id_profile_id_version_number_key"
  )
    return {
      code: "AVATAR_VERSION_CONFLICT",
      message:
        "This avatar changed while it was open. Refresh Avatar Hub and continue from the latest version.",
    };
  return {
    code: "AVATAR_SAVE_CONFLICT",
    message: "Avatar could not be saved. Refresh Avatar Hub and try again.",
  };
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function elapsedMs(start: unknown, end: unknown): number | null {
  const startAt = start === null || start === undefined ? null : new Date(String(start)).getTime();
  const endAt = end === null || end === undefined ? null : new Date(String(end)).getTime();
  if (startAt === null || endAt === null || !Number.isFinite(startAt) || !Number.isFinite(endAt))
    return null;
  return Math.max(0, endAt - startAt);
}

function hostedProgressPercent(completed: unknown, total: unknown): number | null {
  const done = numberOrNull(completed);
  const count = numberOrNull(total);
  if (done === null || count === null || count <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((done / count) * 100)));
}

function hostedTiming(input: {
  readonly createdAt?: unknown;
  readonly submittedAt?: unknown;
  readonly terminalAt?: unknown;
  readonly preparedAt?: unknown;
  readonly renderStartedAt?: unknown;
}): Record<string, number | null> {
  return {
    queue_wait_ms: elapsedMs(input.createdAt, input.submittedAt),
    initialization_ms: elapsedMs(input.submittedAt, input.preparedAt),
    model_ready_ms: null,
    inference_ms: elapsedMs(input.renderStartedAt ?? input.submittedAt, input.terminalAt),
    upload_ms: null,
    render_ms: elapsedMs(input.renderStartedAt ?? input.submittedAt, input.terminalAt),
    end_to_end_ms: elapsedMs(input.createdAt, input.terminalAt),
  };
}

async function catalog(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const data = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const avatars = await transaction.query(
        `SELECT profile.id AS profile_id, version.id AS version_id, profile.name,
                version.version_number, version.state, profile.status,
                version.profile_hash, profile.scope_kind
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id
            AND version.profile_id = profile.id
          WHERE ((profile.account_id = $1 AND profile.workspace_id = $2)
                  OR profile.scope_kind = 'SYSTEM')
            AND profile.status = 'ACTIVE' AND version.state = 'READY'
          ORDER BY profile.name, version.version_number DESC`,
        [scope.account_id, scope.workspace_id],
      );
      const styles = await transaction.query(
        `SELECT style.id AS style_id, version.id AS version_id, style.name,
                version.version_number, version.state, style.status,
                version.style_profile_hash, version.profile_payload, style.scope_kind,
                (SELECT count(*)::int
                   FROM image_style_references AS reference
                  WHERE reference.account_id = version.account_id
                    AND reference.workspace_id = version.workspace_id
                    AND reference.version_id = version.id
                    AND reference.deleted_at IS NULL) AS reference_count,
                (SELECT COALESCE(jsonb_agg(reference.reference_order ORDER BY reference.reference_order), '[]'::jsonb)
                   FROM image_style_references AS reference
                  WHERE reference.account_id = version.account_id
                    AND reference.workspace_id = version.workspace_id
                    AND reference.version_id = version.id
                    AND reference.deleted_at IS NULL) AS reference_orders
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id
            AND version.style_id = style.id
          WHERE ((style.account_id = $1 AND style.workspace_id = $2)
                  OR style.scope_kind = 'SYSTEM')
            AND style.status = 'ACTIVE' AND version.state = 'PUBLISHED'
          ORDER BY style.name, version.version_number DESC`,
        [scope.account_id, scope.workspace_id],
      );
      const avatarDrafts = await transaction.query(
        `SELECT profile.id AS profile_id, version.id AS version_id, profile.name,
                version.version_number, version.state, version.created_at, version.updated_at,
                (version.rights_attested_by_user_id IS NOT NULL) AS rights_attested,
                (version.likeness_attested_by_user_id IS NOT NULL) AS likeness_animation_consent,
                (source.state = 'VERIFIED') AS source_verified
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id
            AND version.profile_id = profile.id
            AND version.scope_kind = profile.scope_kind
           LEFT JOIN assets AS source
             ON source.account_id = version.account_id
            AND source.workspace_id = version.workspace_id
            AND source.id = version.original_asset_id
          WHERE profile.account_id = $1 AND profile.workspace_id = $2
            AND profile.scope_kind = 'WORKSPACE' AND profile.status = 'ACTIVE'
            AND version.scope_kind = 'WORKSPACE'
            AND version.state NOT IN ('READY','ABANDONED')
            AND version.id = (
              SELECT candidate.id
                FROM avatar_profile_versions AS candidate
               WHERE candidate.account_id = profile.account_id
                 AND candidate.workspace_id = profile.workspace_id
                 AND candidate.profile_id = profile.id
                 AND candidate.scope_kind = 'WORKSPACE'
                 AND candidate.state NOT IN ('READY','ABANDONED')
               ORDER BY candidate.version_number DESC, candidate.updated_at DESC
               LIMIT 1
            )
          ORDER BY version.updated_at DESC, profile.name`,
        [scope.account_id, scope.workspace_id],
      );
      const styleDrafts = await transaction.query(
        `SELECT style.id AS style_id, version.id AS version_id, style.name,
                version.version_number, version.state, version.created_at, version.updated_at,
                count(reference.id)::int AS reference_count,
                (version.disclosure_attested_by_user_id IS NOT NULL) AS processing_disclosure_acknowledged,
                COALESCE(bool_and(reference.rights_attested_by_user_id IS NOT NULL), false) AS rights_attested,
                CASE
                  WHEN count(reference.id) >= 3
                   AND bool_and(original.state = 'VERIFIED' AND normalized.state = 'VERIFIED')
                  THEN true ELSE false
                END AS references_verified,
                CASE
                  WHEN count(reference.id) = 0 THEN NULL
                  WHEN bool_and(reference.original_retention_policy = 'RETAIN') THEN 'RETAIN'
                  WHEN bool_and(reference.original_retention_policy = 'DELETE_AFTER_ANALYSIS') THEN 'DELETE_AFTER_ANALYSIS'
                  ELSE NULL
                END AS original_retention_policy,
                CASE WHEN version.state = 'NEEDS_REVIEW' THEN version.profile_payload ELSE NULL END AS profile_payload
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id
            AND version.style_id = style.id
            AND version.scope_kind = style.scope_kind
           LEFT JOIN image_style_references AS reference
            ON reference.account_id = version.account_id
            AND reference.workspace_id = version.workspace_id
            AND reference.version_id = version.id
            AND reference.deleted_at IS NULL
           LEFT JOIN assets AS original
             ON original.account_id = reference.account_id
            AND original.workspace_id = reference.workspace_id
            AND original.id = reference.original_asset_id
           LEFT JOIN assets AS normalized
             ON normalized.account_id = reference.account_id
            AND normalized.workspace_id = reference.workspace_id
            AND normalized.id = reference.normalized_asset_id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
            AND version.scope_kind = 'WORKSPACE'
            AND version.state NOT IN ('PUBLISHED','ABANDONED')
            AND version.id = (
              SELECT candidate.id
                FROM image_style_versions AS candidate
               WHERE candidate.account_id = style.account_id
                 AND candidate.workspace_id = style.workspace_id
                 AND candidate.style_id = style.id
                 AND candidate.scope_kind = 'WORKSPACE'
                 AND candidate.state NOT IN ('PUBLISHED','ABANDONED')
               ORDER BY candidate.version_number DESC, candidate.updated_at DESC
               LIMIT 1
            )
          GROUP BY style.id, version.id, style.name, version.version_number,
                   version.state, version.created_at, version.updated_at, version.profile_payload
          ORDER BY version.updated_at DESC, style.name`,
        [scope.account_id, scope.workspace_id],
      );
      const workers = await transaction.query<{ count: string | number }>(
        `SELECT count(*) AS count FROM media_worker_devices
          WHERE account_id = $1 AND workspace_id = $2
            AND status IN ('ONLINE', 'BUSY')`,
        [scope.account_id, scope.workspace_id],
      );
      return {
        avatars: avatars.rows,
        styles: styles.rows,
        avatar_drafts: avatarDrafts.rows,
        style_drafts: styleDrafts.rows,
        workers: Number(workers.rows[0]?.count ?? 0),
      };
    });
    const avatarRows = (data.avatars as Record<string, unknown>[]).map((row) => ({
      ...row,
      thumbnail_url: `/api/v2/hosted/avatars/${rowString(row, "version_id")}/preview`,
      profile_hash: row.profile_hash ?? null,
      rights_status: row.scope_kind === "SYSTEM" ? "SYSTEM_OWNED" : "ATTESTED",
    }));
    const styleRows = (data.styles as Record<string, unknown>[]).map((row) => {
      const referenceCount = Number(row.reference_count ?? 0);
      const referenceOrders = Array.isArray(row.reference_orders)
        ? row.reference_orders.filter(
            (order): order is number =>
              typeof order === "number" && Number.isSafeInteger(order) && order > 0 && order <= 8,
          )
        : [];
      const versionId = rowString(row, "version_id");
      return {
        style_id: rowString(row, "style_id"),
        version_id: versionId,
        name: rowString(row, "name"),
        version_number: Number(row.version_number),
        state: rowString(row, "state"),
        status: rowString(row, "status"),
        scope_kind: rowString(row, "scope_kind"),
        cover_url: referenceCount > 0 ? `/api/v2/hosted/styles/${versionId}/preview` : null,
        reference_urls: referenceOrders.map(
          (order) => `/api/v2/hosted/styles/${versionId}/preview?reference=${order}`,
        ),
        profile_hash: row.style_profile_hash ?? null,
        reference_count: referenceCount,
        profile: plainRecord(row.profile_payload),
      };
    });
    const avatarDraftRows = (data.avatar_drafts as Record<string, unknown>[]).map((row) => ({
      profile_id: rowString(row, "profile_id"),
      version_id: rowString(row, "version_id"),
      name: rowString(row, "name"),
      version_number: Number(row.version_number),
      state: rowString(row, "state"),
      created_at: timestampOrNull(row.created_at),
      updated_at: timestampOrNull(row.updated_at),
      rights_attested: row.rights_attested === true,
      likeness_animation_consent: row.likeness_animation_consent === true,
      source_verified: row.source_verified === true,
    }));
    const styleDraftRows = (data.style_drafts as Record<string, unknown>[]).map((row) => {
      const profile = plainRecord(row.profile_payload);
      return {
        style_id: rowString(row, "style_id"),
        version_id: rowString(row, "version_id"),
        name: rowString(row, "name"),
        version_number: Number(row.version_number),
        state: rowString(row, "state"),
        reference_count: Number(row.reference_count ?? 0),
        created_at: timestampOrNull(row.created_at),
        updated_at: timestampOrNull(row.updated_at),
        rights_attested: row.rights_attested === true,
        processing_disclosure_acknowledged: row.processing_disclosure_acknowledged === true,
        references_verified: row.references_verified === true,
        original_retention_policy:
          typeof row.original_retention_policy === "string" ? row.original_retention_policy : null,
        profile: row.state === "NEEDS_REVIEW" ? profile : null,
        summary:
          row.state === "NEEDS_REVIEW" && typeof profile?.summary === "string"
            ? profile.summary
            : null,
      };
    });
    const gpuReadiness = hostedGpuReadinessForConfiguration(config);
    return response({
      schema_version: "videoforge-hosted-project-catalog/v1",
      avatars: avatarRows,
      styles: styleRows,
      avatar_drafts: avatarDraftRows,
      style_drafts: styleDraftRows,
      media_worker_state: data.workers > 0 ? "ONLINE" : "WAITING_FOR_YOUR_COMPUTER",
      gpu_transport: gpuReadiness.gpu_transport,
      gpu_readiness: gpuReadiness,
    });
  } finally {
    await pool.end();
  }
}

async function hostedPresetPreview(
  request: Request,
  kind: "avatar" | "style",
  versionId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(versionId)) return response({ error: { code: "PRESET_NOT_FOUND" } }, 404);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const target = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const requestedReference = new URL(request.url).searchParams.get("reference");
      const referenceOrder =
        kind === "style" && requestedReference !== null && /^[1-8]$/u.test(requestedReference)
          ? Number(requestedReference)
          : null;
      if (kind === "style" && requestedReference !== null && referenceOrder === null) return null;
      const sql =
        kind === "avatar"
          ? `SELECT asset.object_key, asset.content_type
               FROM avatar_profile_versions AS version
               JOIN avatar_profiles AS profile
                 ON profile.account_id = version.account_id
                AND profile.workspace_id = version.workspace_id
                AND profile.id = version.profile_id
               JOIN assets AS asset
                 ON asset.account_id = version.account_id
                AND asset.workspace_id = version.workspace_id
                AND asset.id = COALESCE(profile.thumbnail_asset_id, version.original_asset_id)
              WHERE version.id = $3 AND version.state = 'READY'
                AND ((version.account_id = $1 AND version.workspace_id = $2)
                     OR version.scope_kind = 'SYSTEM')
              LIMIT 1`
          : `SELECT asset.object_key, asset.content_type
               FROM image_style_versions AS version
               JOIN image_styles AS style
                 ON style.account_id = version.account_id
                AND style.workspace_id = version.workspace_id
                AND style.id = version.style_id
               JOIN image_style_references AS reference
                ON reference.account_id = version.account_id
                AND reference.workspace_id = version.workspace_id
                AND reference.version_id = version.id
                AND reference.deleted_at IS NULL
               JOIN assets AS asset
                 ON asset.account_id = reference.account_id
                AND asset.workspace_id = reference.workspace_id
                AND asset.id = reference.normalized_asset_id
              WHERE version.id = $3 AND version.state = 'PUBLISHED'
                AND ((version.account_id = $1 AND version.workspace_id = $2)
                     OR version.scope_kind = 'SYSTEM')
                AND ($4::int IS NULL OR reference.reference_order = $4)
              ORDER BY reference.reference_order
              LIMIT 1`;
      const result = await transaction.query<HostedPresetRow>(sql, [
        scope.account_id,
        scope.workspace_id,
        versionId,
        ...(kind === "style" ? [referenceOrder] : []),
      ]);
      return result.rows[0] ?? null;
    });
    if (!target) return response({ error: { code: "PRESET_NOT_FOUND" } }, 404);
    const object = await bucket.get(rowString(target, "object_key"));
    if (!object) return response({ error: { code: "PRESET_IMAGE_NOT_FOUND" } }, 404);
    return new Response(await object.arrayBuffer(), {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-type": rowString(target, "content_type"),
        "x-content-type-options": "nosniff",
      },
    });
  } finally {
    await pool.end();
  }
}

async function archiveHostedPreset(
  request: Request,
  kind: "AVATAR" | "IMAGE_STYLE",
  presetId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const notFoundCode = kind === "AVATAR" ? "AVATAR_NOT_FOUND" : "STYLE_NOT_FOUND";
  if (!UUID.test(presetId)) return response({ error: { code: notFoundCode } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);

  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const archived = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<HostedPresetRow>(
        `SELECT preset_kind, preset_id, version_id, state, referenced_revision_count
           FROM public.videoforge_archive_hosted_preset($1, $2, $3, $4)`,
        [scope.account_id, scope.workspace_id, kind, presetId],
      );
      return result.rows[0] ?? null;
    });

    if (!archived) return response({ error: { code: notFoundCode } }, 404);
    const references = Number(archived.referenced_revision_count ?? 0);
    return response({
      schema_version: "videoforge-hosted-preset-archive-response/v1",
      preset_kind: kind === "AVATAR" ? "avatar" : "image_style",
      preset_id: rowString(archived, "preset_id"),
      version_id: archived.version_id ?? null,
      state: rowString(archived, "state"),
      in_use: Number.isFinite(references) && references > 0,
      referenced_revision_count: Number.isFinite(references) ? references : 0,
      media_retention: "PRESERVED",
      provider_calls_authorized: false,
    });
  } catch (error) {
    if (postgresCode(error) === "55000")
      return response(
        {
          error: {
            code: "PRESET_IMMUTABLE",
            message: "Built-in presets cannot be removed.",
          },
        },
        409,
      );
    if (postgresCode(error) === "42501") return response({ error: { code: notFoundCode } }, 404);
    if (postgresCode(error) === "22023")
      return response({ error: { code: "PRESET_ARCHIVE_REJECTED" } }, 400);
    throw error;
  } finally {
    await pool.end();
  }
}

async function archiveHostedProject(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);

  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const archived = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<HostedPresetRow>(
        `SELECT project_id, state, retained_attempt_count
           FROM public.videoforge_archive_hosted_project($1, $2, $3)`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return result.rows[0] ?? null;
    });

    if (!archived) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    const retainedAttempts = Number(archived.retained_attempt_count ?? 0);
    return response({
      schema_version: "videoforge-hosted-project-archive-response/v1",
      project_id: rowString(archived, "project_id"),
      state: rowString(archived, "state"),
      retained_attempt_count: Number.isFinite(retainedAttempts) ? retainedAttempts : 0,
      lineage_retention: "PRESERVED",
      provider_calls_authorized: false,
    });
  } catch (error) {
    if (postgresCode(error) === "55000")
      return response(
        {
          error: {
            code: "PROJECT_HAS_ACTIVE_WORK",
            message: "Cancel the active project work before deleting this project.",
          },
        },
        409,
      );
    if (postgresCode(error) === "42501")
      return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    throw error;
  } finally {
    await pool.end();
  }
}

type HostedPreflightBlocker = {
  readonly code: string;
  readonly message: string;
  readonly severity: "BLOCKING" | "ADVISORY";
};

export function hostedGpuProductState(readiness: Pick<HostedGpuReadiness, "dispatch_available">): {
  readonly projectedUsd: 0 | null;
  readonly pendingState: "READY_FOR_GPU_DISPATCH" | "WAITING_FOR_GPU_QUALIFICATION";
  readonly estimateDetail: string;
} {
  return readiness.dispatch_available
    ? {
        projectedUsd: null,
        pendingState: "READY_FOR_GPU_DISPATCH",
        estimateDetail:
          "GPU projection is unavailable until exact lane work is materialized. The selected cap is the hard maximum.",
      }
    : {
        projectedUsd: 0,
        pendingState: "WAITING_FOR_GPU_QUALIFICATION",
        estimateDetail:
          "Provider-free personal-worker estimate. GPU provider cost is not projected while transport is DISABLED_UNQUALIFIED.",
      };
}

export function hostedPromptWritingState(
  promptTaskState: unknown,
  planExists: boolean,
  progress?: { readonly acceptedScenes: number; readonly totalScenes: number },
): {
  readonly status: "COMPLETE" | "FAILED" | "BLOCKED" | "RETRY_WAIT" | "RUNNING" | "WAITING";
  readonly progressPercent: number;
  readonly detail: string;
} {
  const taskState = typeof promptTaskState === "string" ? promptTaskState : "";
  const status =
    taskState === "COMPLETE"
      ? "COMPLETE"
      : ((["FAILED", "BLOCKED", "RETRY_WAIT", "RUNNING"] as const).find(
          (candidate) => candidate === taskState,
        ) ?? "WAITING");
  return {
    status,
    progressPercent:
      status === "COMPLETE"
        ? 100
        : progress && progress.totalScenes > 0
          ? Math.min(99, Math.floor((progress.acceptedScenes / progress.totalScenes) * 100))
          : 0,
    detail:
      status === "COMPLETE"
        ? "Durable accepted scene prompts are ready for image generation."
        : status === "FAILED"
          ? "Image prompt writing failed before a durable accepted prompt set was saved."
          : status === "RUNNING" || status === "RETRY_WAIT"
            ? "Image prompts are being written and verified against the approved style."
            : planExists
              ? "The scene plan is ready, but no durable accepted image prompts have been written yet."
              : "Image prompt writing starts after the scene plan is saved.",
  };
}

async function projectPreflight(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const raw = await parseHostedJson(request, "PROJECT_PREFLIGHT_REJECTED");
    if (raw instanceof Response) return raw;
    const input = parseCreate(raw);
    if (!input) return response({ error: { code: "PROJECT_PREFLIGHT_REJECTED" } }, 400);
    const facts = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const [avatar, style, workers] = await Promise.all([
        transaction.query(
          `SELECT 1
             FROM avatar_profiles AS profile
             JOIN avatar_profile_versions AS version
               ON version.account_id = profile.account_id
              AND version.workspace_id = profile.workspace_id
              AND version.profile_id = profile.id
            WHERE ((profile.account_id = $1 AND profile.workspace_id = $2)
                    OR profile.scope_kind = 'SYSTEM')
              AND profile.status = 'ACTIVE' AND version.id = $3 AND version.state = 'READY'
            LIMIT 1`,
          [scope.account_id, scope.workspace_id, input.avatarVersionId],
        ),
        transaction.query(
          `SELECT 1
             FROM image_styles AS style
             JOIN image_style_versions AS version
               ON version.account_id = style.account_id
              AND version.workspace_id = style.workspace_id
              AND version.style_id = style.id
            WHERE ((style.account_id = $1 AND style.workspace_id = $2)
                    OR style.scope_kind = 'SYSTEM')
              AND style.status = 'ACTIVE' AND version.id = $3 AND version.state = 'PUBLISHED'
            LIMIT 1`,
          [scope.account_id, scope.workspace_id, input.styleVersionId],
        ),
        transaction.query<{ count: string | number }>(
          `SELECT count(*) AS count FROM media_worker_devices
            WHERE account_id = $1 AND workspace_id = $2
              AND status IN ('ONLINE', 'BUSY')`,
          [scope.account_id, scope.workspace_id],
        ),
      ]);
      return {
        avatarReady: avatar.rows.length > 0,
        styleReady: style.rows.length > 0,
        workers: Number(workers.rows[0]?.count ?? 0),
      };
    });
    const blockers: HostedPreflightBlocker[] = [];
    if (!facts.avatarReady) {
      blockers.push({
        code: "AVATAR_PROFILE_NOT_READY",
        message: "Choose an active Avatar Profile version in READY state.",
        severity: "BLOCKING",
      });
    }
    if (!facts.styleReady) {
      blockers.push({
        code: "IMAGE_STYLE_NOT_PUBLISHED",
        message: "Choose an active Image Style version in PUBLISHED state.",
        severity: "BLOCKING",
      });
    }
    if (facts.workers < 1) {
      blockers.push({
        code: "MEDIA_WORKER_OFFLINE",
        message: "Connect your personal media worker before generating.",
        severity: "BLOCKING",
      });
    }
    const gpuReadiness = hostedGpuReadinessForConfiguration(config);
    if (!gpuReadiness.dispatch_available) {
      blockers.push({
        code: "GPU_TRANSPORT_DISABLED_UNQUALIFIED",
        message: "GPU lanes are not qualified; the estimate excludes provider GPU spend.",
        severity: "ADVISORY",
      });
    }
    const cap = input.spendCapUsd;
    const ok = blockers.every((blocker) => blocker.severity !== "BLOCKING");
    const gpuProductState = hostedGpuProductState(gpuReadiness);
    return response({
      schema_version: "videoforge-hosted-project-preflight/v1",
      ok,
      ready: ok,
      estimate: {
        projected_usd: gpuProductState.projectedUsd,
        minimum_usd: 0,
        maximum_usd: cap,
        cap_usd: cap,
        detail: gpuProductState.estimateDetail,
        voiceover_bytes: input.voiceover.contentLength,
        duration_ms: input.voiceover.durationMs,
        generation_mode: input.generationMode,
      },
      blockers,
      gpu_transport: gpuReadiness.gpu_transport,
      provider_calls_authorized: gpuReadiness.provider_calls_authorized,
    });
  } finally {
    await pool.end();
  }
}

async function createProject(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY.test(idempotencyKey))
    return response({ error: { code: "PROJECT_IDEMPOTENCY_REQUIRED" } }, 400);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  let requestedTitle = "this title";
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const raw = await parseHostedJson(request, "PROJECT_CREATE_REJECTED");
    if (raw instanceof Response) return raw;
    const input = parseCreate(raw);
    if (!input) return response({ error: { code: "PROJECT_CREATE_REJECTED" } }, 400);
    requestedTitle = input.title;
    const requestSha256 = await sha256(canonicalJson(raw));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const existing = await transaction.query<Record<string, unknown>>(
        `SELECT request.request_sha256, request.state, request.project_id,
                request.project_revision_id, request.upload_reservation_id,
                reservation.object_key, reservation.content_type,
                reservation.content_length, reservation.checksum_sha256,
                reservation.expires_at
           FROM hosted_project_create_requests AS request
           JOIN projects AS project
             ON project.account_id = request.account_id
            AND project.workspace_id = request.workspace_id
            AND project.id = request.project_id
            AND project.status = 'ACTIVE'
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = request.account_id
            AND reservation.workspace_id = request.workspace_id
            AND reservation.id = request.upload_reservation_id
          WHERE request.account_id = $1 AND request.workspace_id = $2
            AND request.idempotency_key = $3`,
        [scope.account_id, scope.workspace_id, idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay) {
        if (replay.request_sha256 !== requestSha256)
          throw new Error("PROJECT_IDEMPOTENCY_CONFLICT");
        return replay;
      }
      const resolved = await resolveProjectPresets(
        transaction,
        scope,
        input.avatarVersionId,
        input.styleVersionId,
      );
      if (!resolved) throw new Error("PROJECT_PRESET_NOT_READY");
      // Keep the existing revision writer shape while allowing SYSTEM catalog versions to be
      // materialized into tenant-owned snapshots by resolveProjectPresets.
      const avatar = resolved.avatar;
      const style = resolved.style;
      const projectId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const reservationId = crypto.randomUUID();
      const receiptId = crypto.randomUUID();
      const objectKey =
        `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${projectId}` +
        `/revision/${revisionId}/lane/input/job/browser-upload/artifact/voiceover`;
      const schedulerSeed = input.userSeed ?? Math.floor(Math.random() * 4_294_967_296);
      const revisionPayload = hostedRevisionConfigV2({
        projectId,
        projectRevisionId: revisionId,
        title: input.title,
        voiceoverAssetId: assetId,
        voiceoverSha256: input.voiceover.checksumSha256,
        avatarProfileId: rowString(avatar, "profile_id"),
        avatarProfileVersionId: rowString(avatar, "version_id"),
        avatarDisplayName: rowString(avatar, "profile_name"),
        avatarProfileHash: rowString(avatar, "profile_hash"),
        avatarRuntimeSourceAssetId: rowString(avatar, "runtime_source_asset_id"),
        avatarRuntimeSourceSha256: rowString(avatar, "runtime_source_binary_sha256"),
        avatarSourcePreparationVersion: rowString(avatar, "source_preparation_profile"),
        avatarSourceValidationProfileVersion: rowString(avatar, "source_validation_profile"),
        imageStyleVersionId: rowString(style, "version_id"),
        styleProfileHash: rowString(style, "style_profile_hash"),
        schedulerSeed,
        optionalScript: input.optionalScript,
        extraPromptKeywords: input.extraPromptKeywords,
        applyExtraPromptKeywords: input.applyExtraPromptKeywords,
        generationMode: input.generationMode,
        spendCapUsd: input.spendCapUsd,
      });
      const revisionHash = await sha256(canonicalJson(revisionPayload));
      await transaction.query(
        `INSERT INTO projects (
           id, workspace_id, owner_user_id, name, normalized_name, project_kind
         ) VALUES ($1,$2,$3,$4,lower($4),'USER')`,
        [projectId, scope.workspace_id, scope.user_id, input.title],
      );
      await transaction.query(
        `INSERT INTO assets (
           id, workspace_id, project_id, project_revision_id, kind, state, object_key,
           binary_sha256, content_type, byte_size, duration_ms, metadata
         ) VALUES ($1,$2,$3,NULL,'VOICEOVER','UPLOADING',$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          assetId,
          scope.workspace_id,
          projectId,
          objectKey,
          input.voiceover.checksumSha256,
          input.voiceover.contentType,
          input.voiceover.contentLength,
          input.voiceover.durationMs,
          JSON.stringify({ filename: input.voiceover.filename }),
        ],
      );
      await transaction.query(
        `INSERT INTO project_revisions (
           id, workspace_id, project_id, revision_number, status, title,
           voiceover_asset_id, voiceover_binary_sha256,
           avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
           avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
           avatar_source_preparation_profile, avatar_source_validation_profile,
           avatar_compatibility_state, avatar_compatibility_assessment_id,
           avatar_compatibility_evidence_hash,
           image_style_id, image_style_version_id, style_profile_hash,
           extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
           maximum_cost_micro_usd, seed, revision_config_contract_name,
           revision_config_contract_version, revision_config_payload, revision_config_hash,
           created_by_user_id
         ) VALUES (
           $1,$2,$3,1,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
           'UNTESTED',NULL,NULL,$14,$15,$16,$17,$18,$19,$20,$21,
           'project-revision-config','v2',$22::jsonb,$23,$24
         )`,
        [
          revisionId,
          scope.workspace_id,
          projectId,
          input.title,
          assetId,
          input.voiceover.checksumSha256,
          rowString(avatar, "profile_id"),
          rowString(avatar, "version_id"),
          rowString(avatar, "profile_hash"),
          rowString(avatar, "runtime_source_asset_id"),
          rowString(avatar, "runtime_source_binary_sha256"),
          rowString(avatar, "source_preparation_profile"),
          rowString(avatar, "source_validation_profile"),
          rowString(style, "style_id"),
          rowString(style, "version_id"),
          rowString(style, "style_profile_hash"),
          input.extraPromptKeywords,
          input.applyExtraPromptKeywords,
          input.generationMode,
          Math.round(input.spendCapUsd * 1_000_000),
          schedulerSeed,
          JSON.stringify(revisionPayload),
          revisionHash,
          scope.user_id,
        ],
      );
      await transaction.query(`UPDATE assets SET project_revision_id = $1 WHERE id = $2`, [
        revisionId,
        assetId,
      ]);
      if (input.optionalScript !== null) {
        await transaction.query(
          `INSERT INTO project_inputs (
             id, workspace_id, project_id, kind, state, asset_id, idempotency_key, optional_script
           ) VALUES ($1,$2,$3,'OPTIONAL_SCRIPT','UPLOADED',NULL,$4,$5)`,
          [
            crypto.randomUUID(),
            scope.workspace_id,
            projectId,
            `project-${projectId}-optional-script-v1`,
            input.optionalScript,
          ],
        );
      }
      await transaction.query(
        `INSERT INTO artifact_reservations (
           id, account_id, workspace_id, project_id, project_revision_id, asset_id,
           lane, job_id, artifact_id, object_key, method, content_type, content_length,
           checksum_sha256, expires_at, max_uses, retention_class, deletion_owner_account_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'INPUT','browser-upload','voiceover',$7,'PUT',$8,$9,$10,
                   now() + interval '15 minutes',1,'PROJECT',$2)`,
        [
          reservationId,
          scope.account_id,
          scope.workspace_id,
          projectId,
          revisionId,
          assetId,
          objectKey,
          input.voiceover.contentType,
          input.voiceover.contentLength,
          input.voiceover.checksumSha256,
        ],
      );
      await transaction.query(
        `INSERT INTO hosted_project_create_requests (
           id, account_id, workspace_id, idempotency_key, request_sha256, project_id,
           project_revision_id, voiceover_asset_id, upload_reservation_id,
           upload_receipt_id, state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UPLOAD_PENDING')`,
        [
          crypto.randomUUID(),
          scope.account_id,
          scope.workspace_id,
          idempotencyKey,
          requestSha256,
          projectId,
          revisionId,
          assetId,
          reservationId,
          receiptId,
        ],
      );
      return {
        request_sha256: requestSha256,
        state: "UPLOAD_PENDING",
        project_id: projectId,
        project_revision_id: revisionId,
        upload_reservation_id: reservationId,
        object_key: objectKey,
        content_type: input.voiceover.contentType,
        content_length: input.voiceover.contentLength,
        checksum_sha256: input.voiceover.checksumSha256,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
    });
    if (prepared.state === "READY") {
      return response({
        schema_version: "videoforge-hosted-project-create-response/v1",
        project_id: prepared.project_id,
        project_revision_id: prepared.project_revision_id,
        state: "READY",
        upload: null,
      });
    }
    const port = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey: String(prepared.object_key),
      contentType: String(prepared.content_type),
      contentLength: Number(prepared.content_length),
      checksumSha256: String(prepared.checksum_sha256),
      lifetimeSeconds: 900,
    });
    return response(
      {
        schema_version: "videoforge-hosted-project-create-response/v1",
        project_id: prepared.project_id,
        project_revision_id: prepared.project_revision_id,
        state: "UPLOAD_PENDING",
        upload: port,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_IDEMPOTENCY_CONFLICT")
      return response({ error: { code: error.message } }, 409);
    if (error instanceof Error && error.message === "PROJECT_PRESET_NOT_READY")
      return response({ error: { code: error.message } }, 409);
    const conflict =
      postgresCode(error) === "23505"
        ? hostedProjectConflictProblem(postgresConstraint(error), requestedTitle)
        : null;
    if (conflict) return response({ error: conflict }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}

async function commitProject(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const pending = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<Record<string, unknown>>(
        `SELECT request.state, request.project_revision_id, request.voiceover_asset_id,
                request.upload_reservation_id, request.upload_receipt_id,
                reservation.object_key, reservation.content_type, reservation.content_length,
                reservation.checksum_sha256, reservation.expires_at,
                asset.duration_ms, asset.metadata
           FROM hosted_project_create_requests AS request
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = request.account_id
            AND reservation.workspace_id = request.workspace_id
            AND reservation.id = request.upload_reservation_id
           JOIN assets AS asset
             ON asset.account_id = request.account_id
            AND asset.workspace_id = request.workspace_id
            AND asset.id = request.voiceover_asset_id
          WHERE request.account_id = $1 AND request.workspace_id = $2 AND request.project_id = $3`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return result.rows[0];
    });
    if (!pending) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    const replay = pending.state === "READY";
    if (!replay && new Date(String(pending.expires_at)).getTime() <= Date.now())
      return response({ error: { code: "VOICEOVER_UPLOAD_EXPIRED" } }, 409);
    let validationProbe: unknown = {
      source: "PERSISTED_AUTHORITATIVE_VALIDATION",
    };
    if (!replay) {
      const object = await bucket.head(String(pending.object_key));
      if (
        !object ||
        object.size !== Number(pending.content_length) ||
        object.httpMetadata?.contentType !== pending.content_type ||
        checksumFromR2(object.checksums?.sha256) !== pending.checksum_sha256
      ) {
        return response({ error: { code: "VOICEOVER_UPLOAD_NOT_VERIFIED" } }, 409);
      }
      try {
        const validation = await validateHostedVoiceover({
          declaredContentLength: Number(pending.content_length),
          declaredContentType: String(pending.content_type),
          declaredDurationMs: Number(pending.duration_ms),
          reader: {
            size: object.size,
            read: async (offset, length) => {
              const ranged = await bucket.get(String(pending.object_key), {
                range: { offset, length },
              });
              if (!ranged)
                throw new Error("Voiceover object disappeared during authoritative validation.");
              return ranged.arrayBuffer();
            },
          },
        });
        validationProbe = hostedVoiceoverArtifactProbe(validation);
      } catch (error) {
        if (error instanceof HostedAudioValidationError)
          return response({ error: { code: error.code, message: error.message } }, 409);
        throw error;
      }
    }
    const committedAt = new Date().toISOString();
    const receiptFacts = {
      schema_version: "artifact-commit-receipt/v3",
      receipt_id: pending.upload_receipt_id,
      reservation_id: pending.upload_reservation_id,
      account_id: scope.account_id,
      workspace_id: scope.workspace_id,
      object_key: pending.object_key,
      callback_id: `browser-upload-${projectId}`,
      content_type: pending.content_type,
      content_length: Number(pending.content_length),
      checksum_sha256: pending.checksum_sha256,
      probe: validationProbe,
      retention_class: "PROJECT",
      retain_until: null,
      committed_at: committedAt,
    };
    const receiptSha256 = await sha256(canonicalJson(receiptFacts));
    await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (pending.state === "READY") return;
      await transaction.query(
        `UPDATE assets SET state = 'VERIFIED', verified_at = $2
          WHERE id = $1 AND state = 'UPLOADING'`,
        [String(pending.voiceover_asset_id), committedAt],
      );
      await transaction.query(
        `UPDATE artifact_reservations
            SET state = 'COMMITTED', used_count = 1, updated_at = $2
          WHERE id = $1 AND state = 'ISSUED'`,
        [String(pending.upload_reservation_id), committedAt],
      );
      await transaction.query(
        `INSERT INTO artifact_receipts (
           id, account_id, workspace_id, reservation_id, callback_id, object_key,
           content_type, content_length, checksum_sha256, probe, receipt_sha256, committed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
         ON CONFLICT (account_id, workspace_id, reservation_id) DO NOTHING`,
        [
          String(pending.upload_receipt_id),
          scope.account_id,
          scope.workspace_id,
          String(pending.upload_reservation_id),
          receiptFacts.callback_id,
          String(pending.object_key),
          String(pending.content_type),
          Number(pending.content_length),
          String(pending.checksum_sha256),
          JSON.stringify(receiptFacts.probe),
          receiptSha256,
          committedAt,
        ],
      );
      await transaction.query(
        `UPDATE project_revisions SET status = 'LOCKED', locked_at = $2
          WHERE id = $1 AND status = 'DRAFT'`,
        [String(pending.project_revision_id), committedAt],
      );
      await transaction.query(
        `UPDATE hosted_project_create_requests SET state = 'READY', ready_at = $2
          WHERE project_id = $1 AND state = 'UPLOAD_PENDING'`,
        [projectId, committedAt],
      );
    });
    const extension = voiceoverExtension(String(pending.content_type));
    const checksum = String(pending.checksum_sha256);
    const uri = `vf-local://objects/sha256/${checksum.slice(7, 9)}/${checksum.slice(7)}.${extension}`;
    return response({
      schema_version: "videoforge-hosted-project-ready/v1",
      project_id: projectId,
      project_revision_id: pending.project_revision_id,
      cpu_submission: {
        schema_version: "videoforge-hosted-cpu-submission/v1",
        idempotency_key: `project-${projectId}-asr-v1`,
        project_id: projectId,
        project_revision_id: pending.project_revision_id,
        kind: "ASR",
        input_document: {
          schema_version: "asr-job-input/v1",
          project_revision_id: pending.project_revision_id,
          attempt_id: projectId,
          voiceover: {
            asset_id: pending.voiceover_asset_id,
            sha256: checksum,
            artifact_uri: uri,
            media_type: pending.content_type,
            duration_ms: Number(pending.duration_ms),
          },
          model: {
            engine: "whisper.cpp",
            name: "base.en",
            sha256: config.mediaWorkerRelease.whisperModelSha256,
            language: "en",
          },
          options: {
            threads: 4,
            processors: 1,
            flash_attention: true,
            greedy: true,
            split_on_word: true,
          },
          output: {
            result_uri: `vf-local-run://${pending.project_revision_id}/${projectId}/asr-result.json`,
          },
          cancel_token: projectId,
        },
        objects: [{ artifact_receipt_id: pending.upload_receipt_id, uri }],
      },
    });
  } finally {
    await pool.end();
  }
}

/**
 * Advance the ordinary product journey after ASR.  The browser supplies only
 * the successful ASR attempt identity; the render submission itself must come
 * from the locked revision's tenant-owned, immutable render plan.  The route
 * deliberately does not synthesize a plan or create an attempt when that plan
 * is absent.  The returned submission is then sent through the generic CPU
 * submission endpoint, which applies the same plan equality check before it
 * owns/outboxes the render attempt.
 */
async function asrHandoff(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const state = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{
        revision_id: string;
        voiceover_asset_id: string;
        checksum_sha256: string;
        content_type: string;
        duration_ms: number | string;
        receipt_id: string;
        asr_attempt_count: number | string;
        latest_asr_state: string | null;
      }>(
        `SELECT revision.id::text AS revision_id,
                revision.voiceover_asset_id::text AS voiceover_asset_id,
                receipt.checksum_sha256, receipt.content_type,
                asset.duration_ms, receipt.id::text AS receipt_id,
                (SELECT count(*) FROM hosted_cpu_job_attempts AS attempt
                  WHERE attempt.account_id = project.account_id
                    AND attempt.workspace_id = project.workspace_id
                    AND attempt.project_id = project.id
                    AND attempt.project_revision_id = revision.id
                    AND attempt.kind = 'ASR') AS asr_attempt_count,
                (SELECT attempt.state FROM hosted_cpu_job_attempts AS attempt
                  WHERE attempt.account_id = project.account_id
                    AND attempt.workspace_id = project.workspace_id
                    AND attempt.project_id = project.id
                    AND attempt.project_revision_id = revision.id
                    AND attempt.kind = 'ASR'
                  ORDER BY attempt.created_at DESC, attempt.id DESC LIMIT 1) AS latest_asr_state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
            AND revision.status = 'LOCKED'
           JOIN assets AS asset
             ON asset.account_id = revision.account_id
            AND asset.workspace_id = revision.workspace_id
            AND asset.id = revision.voiceover_asset_id
            AND asset.state = 'VERIFIED'
            AND asset.binary_sha256 = revision.voiceover_binary_sha256
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = revision.account_id
            AND reservation.workspace_id = revision.workspace_id
            AND reservation.project_id = revision.project_id
            AND reservation.project_revision_id = revision.id
            AND reservation.asset_id = asset.id
            AND reservation.state = 'COMMITTED'
           JOIN artifact_receipts AS receipt
             ON receipt.account_id = reservation.account_id
            AND receipt.workspace_id = reservation.workspace_id
            AND receipt.reservation_id = reservation.id
            AND receipt.deleted_at IS NULL
            AND receipt.checksum_sha256 = asset.binary_sha256
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
            AND project.status = 'ACTIVE'
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return result.rows[0] ?? null;
    });
    if (!state) return response({ error: { code: "HOSTED_ASR_HANDOFF_NOT_READY" } }, 409);
    const asrAttemptCount = Number(state.asr_attempt_count);
    if (!Number.isSafeInteger(asrAttemptCount) || asrAttemptCount < 0)
      return response({ error: { code: "HOSTED_ASR_HANDOFF_NOT_READY" } }, 409);
    if (asrAttemptCount > 0 && state.latest_asr_state !== "FAILED")
      return response(
        {
          error: {
            code: "HOSTED_ASR_ALREADY_STARTED",
            message: "Transcription has already started. Open Progress for its latest status.",
          },
        },
        409,
      );
    if (asrAttemptCount >= 3)
      return response(
        {
          error: {
            code: "HOSTED_ASR_RETRY_LIMIT_REACHED",
            message:
              "Transcription still needs attention. Keep the project saved and contact support.",
          },
        },
        409,
      );
    const asrAttemptOrdinal = asrAttemptCount + 1;
    const extension = voiceoverExtension(state.content_type);
    const uri = `vf-local://objects/sha256/${state.checksum_sha256.slice(7, 9)}/${state.checksum_sha256.slice(7)}.${extension}`;
    return response(
      {
        schema_version: "videoforge-hosted-asr-handoff/v1",
        project_id: projectId,
        project_revision_id: state.revision_id,
        cpu_submission: {
          schema_version: "videoforge-hosted-cpu-submission/v1",
          idempotency_key: `project-${projectId}-asr-v${asrAttemptOrdinal}`,
          project_id: projectId,
          project_revision_id: state.revision_id,
          kind: "ASR",
          input_document: {
            schema_version: "asr-job-input/v1",
            project_revision_id: state.revision_id,
            attempt_id: projectId,
            voiceover: {
              asset_id: state.voiceover_asset_id,
              sha256: state.checksum_sha256,
              artifact_uri: uri,
              media_type: state.content_type,
              duration_ms: Number(state.duration_ms),
            },
            model: {
              engine: "whisper.cpp",
              name: "base.en",
              sha256: config.mediaWorkerRelease.whisperModelSha256,
              language: "en",
            },
            options: {
              threads: 4,
              processors: 1,
              flash_attention: true,
              greedy: true,
              split_on_word: true,
            },
            output: {
              result_uri: `vf-local-run://${state.revision_id}/${projectId}/asr-result.json`,
            },
            cancel_token: projectId,
          },
          objects: [{ artifact_receipt_id: state.receipt_id, uri }],
        },
      },
      202,
    );
  } finally {
    await pool.end();
  }
}

function hostedTranscriptText(document: unknown, expectedAttemptId: string): string | null {
  const root = plainRecord(document);
  const transcript = plainRecord(root?.transcript);
  const text = transcript?.text;
  return root?.status === "SUCCEEDED" &&
    root?.attempt_id === expectedAttemptId &&
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.length <= MAX_OPTIONAL_SCRIPT
    ? text
    : null;
}

async function createVoiceoverContext(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!config.styleAnalysis)
    return response({ error: { code: "HOSTED_CONTEXT_PROVIDER_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  let contextId: string | null = null;
  let accountId: string | null = null;
  let providerTaskUuid: string | null = null;
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    accountId = scope.account_id;
    const body = await parseHostedJson(request, "HOSTED_CONTEXT_REQUEST_REJECTED", 4_096);
    if (body instanceof Response) return body;
    const requested = plainRecord(body);
    if (requested?.maximum_context_spend_micro_usd !== HOSTED_CONTEXT_RESERVATION_MICRO_USD)
      return response({ error: { code: "HOSTED_CONTEXT_SPEND_CONFIRMATION_REQUIRED" } }, 400);
    const asrAttemptId = requested.asr_attempt_id;
    if (typeof asrAttemptId !== "string" || !UUID.test(asrAttemptId))
      return response({ error: { code: "HOSTED_CONTEXT_REQUEST_REJECTED" } }, 400);

    const state = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{
        revision_id: string;
        asr_attempt_id: string;
        output_object_key: string;
        output_content_type: string;
        output_content_length: number | string;
        output_sha256: string;
        existing_state: string | null;
      }>(
        `SELECT revision.id::text AS revision_id, attempt.id::text AS asr_attempt_id,
                attempt.result_object_key AS output_object_key,
                attempt.result_content_type AS output_content_type,
                attempt.result_content_length AS output_content_length,
                attempt.result_checksum_sha256 AS output_sha256,
                context.state AS existing_state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
            AND revision.project_id=project.id AND revision.status='LOCKED'
           JOIN hosted_cpu_job_attempts AS attempt
             ON attempt.account_id=revision.account_id AND attempt.workspace_id=revision.workspace_id
            AND attempt.project_id=revision.project_id AND attempt.project_revision_id=revision.id
            AND attempt.id=$4 AND attempt.kind='ASR' AND attempt.state='SUCCEEDED'
           LEFT JOIN hosted_voiceover_contexts AS context
             ON context.account_id=revision.account_id AND context.workspace_id=revision.workspace_id
            AND context.project_revision_id=revision.id
          WHERE project.account_id=$1 AND project.workspace_id=$2 AND project.id=$3
            AND project.status='ACTIVE' LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId, asrAttemptId],
      );
      return result.rows[0] ?? null;
    });
    if (!state) return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_READY" } }, 409);
    if (state.existing_state === "SUCCEEDED")
      return response({
        schema_version: "videoforge-hosted-context-response/v1",
        state: "COMPLETE",
        replayed: true,
      });
    if (state.existing_state !== null)
      return response(
        {
          error: {
            code: "HOSTED_CONTEXT_ALREADY_CLAIMED",
            message: "The context request has already been claimed and cannot be redispatched.",
          },
        },
        409,
      );
    const bucket = environment.PRIVATE_ARTIFACTS;
    if (
      !bucket ||
      state.output_content_type !== "application/json" ||
      !SHA256.test(state.output_sha256)
    )
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_READY" } }, 409);
    const object = await bucket.get(state.output_object_key);
    if (
      !object ||
      object.size !== Number(state.output_content_length) ||
      object.httpMetadata?.contentType !== "application/json"
    )
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    const bytes = await object.arrayBuffer();
    if ((await sha256Bytes(bytes)) !== state.output_sha256)
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    let document: unknown;
    try {
      document = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    }
    const validators = (await import(
      "@videoforge/contracts/precompiled-contract-validators"
    )) as unknown as Record<string, ((value: unknown) => boolean) | undefined>;
    if (!validators.asrJobResult?.(document))
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    const transcript = hostedTranscriptText(document, asrAttemptId);
    if (!transcript) return response({ error: { code: "HOSTED_CONTEXT_TRANSCRIPT_INVALID" } }, 409);
    const transcriptHash = await sha256(transcript);
    const preparedRequest = await prepareHostedVoiceoverContextRequest({
      transcript,
      transcriptHash,
    });
    providerTaskUuid = preparedRequest.request.taskUUID;
    const identity = {
      contextId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      executionProfileId: crypto.randomUUID(),
      reservationCostEventId: crypto.randomUUID(),
      claimTokenHash: await sha256(`hosted-context-claim:${crypto.randomUUID()}:${projectId}`),
    };
    const claimed = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{ prepared: unknown }>(
        "SELECT public.videoforge_prepare_hosted_voiceover_context($1::jsonb) AS prepared",
        [
          JSON.stringify({
            account_id: scope.account_id,
            workspace_id: scope.workspace_id,
            user_id: scope.user_id,
            project_id: projectId,
            revision_id: state.revision_id,
            asr_attempt_id: asrAttemptId,
            context_id: identity.contextId,
            task_id: identity.taskId,
            attempt_id: identity.attemptId,
            outbox_id: identity.outboxId,
            execution_profile_id: identity.executionProfileId,
            reservation_cost_event_id: identity.reservationCostEventId,
            claim_token_hash: identity.claimTokenHash,
            transcript_hash: transcriptHash,
            request_hash: preparedRequest.requestHash,
            reserved_cost_micro_usd: HOSTED_CONTEXT_RESERVATION_MICRO_USD,
          }),
        ],
      );
      return plainRecord(result.rows[0]?.prepared);
    });
    if (!claimed || claimed.created !== true)
      return response({ error: { code: "HOSTED_CONTEXT_ALREADY_CLAIMED" } }, 409);
    contextId = identity.contextId;
    const result = await extractHostedVoiceoverContext({
      prepared: preparedRequest,
      apiKey: config.styleAnalysis.apiKey,
    });
    const completed = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const accepted = await transaction.query<{ completed: boolean }>(
        "SELECT public.videoforge_complete_hosted_voiceover_context($1::jsonb) AS completed",
        [
          JSON.stringify({
            context_id: identity.contextId,
            output_asset_id: crypto.randomUUID(),
            context_bytes: result.contextBytes,
            context_hash: result.contextHash,
            response_bytes: result.responseBytes,
            response_hash: result.responseHash,
            reported_cost_micro_usd: result.reportedCostMicroUsd,
          }),
        ],
      );
      return accepted.rows[0]?.completed === true;
    });
    if (!completed) throw new Error("HOSTED_CONTEXT_ACCEPTANCE_REJECTED");
    return response({
      schema_version: "videoforge-hosted-context-response/v1",
      state: "COMPLETE",
      replayed: false,
      context_cost_usd: result.reportedCostMicroUsd / 1_000_000,
    });
  } catch (error) {
    if (contextId && accountId) {
      const problemCode =
        error instanceof Error && /^[A-Z0-9_]{3,80}$/u.test(error.message)
          ? error.message
          : "HOSTED_CONTEXT_EXECUTION_UNKNOWN";
      const definiteProviderRejection = problemCode === "VOICEOVER_CONTEXT_PROVIDER_REJECTED";
      if (error instanceof HostedVoiceoverContextProviderError) {
        console.error("HOSTED_CONTEXT_PROVIDER_FAILURE", {
          problem_code: error.code,
          provider_task_uuid: providerTaskUuid,
          stage: error.diagnostic?.stage ?? null,
          http_status: error.diagnostic?.httpStatus ?? null,
          provider_code: error.diagnostic?.providerCode ?? null,
          provider_parameter: error.diagnostic?.providerParameter ?? null,
        });
      }
      await createNeonExecutor(pool)
        .transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1, $2, true)", [
            "videoforge.account_id",
            accountId,
          ]);
          await transaction.query(
            "SELECT public.videoforge_fail_hosted_voiceover_context($1,$2,$3,$4)",
            [
              contextId,
              definiteProviderRejection ? "FAILED" : "UNKNOWN",
              problemCode,
              !definiteProviderRejection,
            ],
          );
        })
        .catch(() => undefined);
      return response(
        {
          error: {
            code: problemCode,
            message: definiteProviderRejection
              ? "Runware rejected the context request before VideoForge accepted a result."
              : "Context extraction did not return a durable accepted result and will not retry automatically.",
          },
        },
        definiteProviderRejection ? 422 : 502,
      );
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function reconcileVoiceoverContext(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!config.styleAnalysis)
    return response({ error: { code: "HOSTED_CONTEXT_PROVIDER_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const state = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{
        revision_id: string;
        context_id: string;
        context_state: string;
        transcript_hash: string;
        request_hash: string;
        provider_may_have_charged: boolean;
        asr_attempt_id: string;
        output_object_key: string;
        output_content_type: string;
        output_content_length: number | string;
        output_sha256: string;
      }>(
        `SELECT revision.id::text AS revision_id, context.id::text AS context_id,
                context.state AS context_state, context.transcript_hash, context.request_hash,
                context.provider_may_have_charged,
                asr.id::text AS asr_attempt_id, asr.result_object_key AS output_object_key,
                asr.result_content_type AS output_content_type,
                asr.result_content_length AS output_content_length,
                asr.result_checksum_sha256 AS output_sha256
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
            AND revision.project_id=project.id AND revision.status='LOCKED'
           JOIN hosted_voiceover_contexts AS context
             ON context.account_id=revision.account_id AND context.workspace_id=revision.workspace_id
            AND context.project_revision_id=revision.id
           JOIN hosted_cpu_job_attempts AS asr
             ON asr.account_id=context.account_id AND asr.workspace_id=context.workspace_id
            AND asr.id=context.asr_attempt_id AND asr.kind='ASR' AND asr.state='SUCCEEDED'
          WHERE project.account_id=$1 AND project.workspace_id=$2 AND project.id=$3
            AND project.status='ACTIVE' LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return result.rows[0] ?? null;
    });
    if (!state) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    if (state.context_state === "SUCCEEDED")
      return response({
        schema_version: "videoforge-hosted-context-reconciliation-response/v1",
        state: "COMPLETE",
        replayed: true,
      });
    if (state.context_state !== "UNKNOWN" || !state.provider_may_have_charged)
      return response(
        {
          error: {
            code: "HOSTED_CONTEXT_NOT_RECONCILABLE",
            message: "This context request does not have an uncertain provider result to check.",
          },
        },
        409,
      );
    const bucket = environment.PRIVATE_ARTIFACTS;
    if (
      !bucket ||
      state.output_content_type !== "application/json" ||
      !SHA256.test(state.output_sha256)
    )
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_READY" } }, 409);
    const object = await bucket.get(state.output_object_key);
    if (
      !object ||
      object.size !== Number(state.output_content_length) ||
      object.httpMetadata?.contentType !== "application/json"
    )
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    const bytes = await object.arrayBuffer();
    if ((await sha256Bytes(bytes)) !== state.output_sha256)
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    let document: unknown;
    try {
      document = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    }
    const validators = (await import(
      "@videoforge/contracts/precompiled-contract-validators"
    )) as unknown as Record<string, ((value: unknown) => boolean) | undefined>;
    if (!validators.asrJobResult?.(document))
      return response({ error: { code: "HOSTED_CONTEXT_ASR_NOT_VERIFIED" } }, 409);
    const transcript = hostedTranscriptText(document, state.asr_attempt_id);
    if (!transcript || (await sha256(transcript)) !== state.transcript_hash)
      return response({ error: { code: "HOSTED_CONTEXT_TRANSCRIPT_INVALID" } }, 409);
    const preparedRequest = await prepareHostedVoiceoverContextRequest({
      transcript,
      transcriptHash: state.transcript_hash as `sha256:${string}`,
    });
    if (preparedRequest.requestHash !== state.request_hash)
      return response({ error: { code: "HOSTED_CONTEXT_REQUEST_IDENTITY_INVALID" } }, 409);

    let recovered: Awaited<ReturnType<typeof reconcileHostedVoiceoverContext>>;
    try {
      recovered = await reconcileHostedVoiceoverContext({
        prepared: preparedRequest,
        apiKey: config.styleAnalysis.apiKey,
      });
    } catch (error) {
      const contextCode =
        error instanceof Error &&
        [
          "VOICEOVER_CONTEXT_JSON_INVALID",
          "VOICEOVER_CONTEXT_JSON_DUPLICATE_PROPERTY",
          "VOICEOVER_CONTEXT_INVALID",
          "VOICEOVER_CONTEXT_TOO_LARGE",
          "VOICEOVER_CONTEXT_COST_EXCEEDED",
        ].includes(error.message)
          ? error.message
          : null;
      const providerCode =
        error instanceof RunwareTransportError
          ? error.code
          : (contextCode ?? "RUNWARE_RESPONSE_INVALID");
      const message =
        providerCode === "RUNWARE_TASK_NOT_FOUND"
          ? "Runware could not find the original task in this workspace. No new inference request was submitted."
          : providerCode === "RUNWARE_TASK_DETAILS_UNAVAILABLE"
            ? "Runware task details are temporarily unavailable. No new inference request was submitted."
            : providerCode === "RUNWARE_IDEMPOTENCY_CONFLICT"
              ? "Runware returned an original request that did not match the saved task identity. No new inference request was submitted."
              : providerCode === "RUNWARE_AUTH_INVALID"
                ? "Runware rejected the configured recovery credential. No new inference request was submitted."
                : providerCode === "VOICEOVER_CONTEXT_JSON_INVALID"
                  ? "The original provider result did not contain exactly one valid context JSON object. No new inference request was submitted."
                  : providerCode === "VOICEOVER_CONTEXT_JSON_DUPLICATE_PROPERTY"
                    ? "The original provider result repeated a context property and was rejected safely. No new inference request was submitted."
                    : providerCode === "VOICEOVER_CONTEXT_INVALID"
                      ? "The original provider result did not match the required context fields. No new inference request was submitted."
                      : "Runware returned original task details that could not be accepted safely. No new inference request was submitted.";
      return response(
        {
          error: {
            code: `HOSTED_CONTEXT_RECONCILIATION_${providerCode}`,
            message,
          },
        },
        409,
      );
    }
    const outputAssetId = crypto.randomUUID();
    const reconciled = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{ reconciled: unknown }>(
        "SELECT public.videoforge_reconcile_unknown_hosted_voiceover_context($1::jsonb) AS reconciled",
        [
          JSON.stringify({
            account_id: scope.account_id,
            workspace_id: scope.workspace_id,
            user_id: scope.user_id,
            project_id: projectId,
            revision_id: state.revision_id,
            context_id: state.context_id,
            output_asset_id: outputAssetId,
            transcript_hash: state.transcript_hash,
            request_hash: state.request_hash,
            response_bytes: recovered.responseBytes,
            response_hash: recovered.responseHash,
            context_bytes: recovered.contextBytes,
            context_hash: recovered.contextHash,
            reported_cost_micro_usd: recovered.reportedCostMicroUsd,
          }),
        ],
      );
      return plainRecord(result.rows[0]?.reconciled);
    });
    if (!reconciled) throw new Error("HOSTED_CONTEXT_RECONCILIATION_REJECTED");
    return response({
      schema_version: "videoforge-hosted-context-reconciliation-response/v1",
      state: "COMPLETE",
      replayed: reconciled.replayed === true,
      context_cost_usd: recovered.reportedCostMicroUsd / 1_000_000,
    });
  } finally {
    await pool.end();
  }
}

async function renderHandoff(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const pool = createNeonPool(config.neon.databaseUrl);
  let generationCoordinator: typeof import("./generation-coordinator") | null = null;
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const body = await parseHostedJson(request, "HOSTED_RENDER_HANDOFF_REJECTED", 4_096);
    if (body instanceof Response) return body;
    const asrAttemptId = parseRenderHandoff(body);
    if (!asrAttemptId) return response({ error: { code: "HOSTED_RENDER_HANDOFF_REJECTED" } }, 400);
    const state = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{
        revision_id: string;
        revision_state: string;
        revision_config_payload: string;
        revision_config_hash: string;
        asr_attempt_id: string | null;
        asr_terminal_at: string | null;
        asr_input_object_key: string | null;
        asr_input_content_length: number | string | null;
        asr_input_sha256: string | null;
        asr_output_object_key: string | null;
        asr_output_content_type: string | null;
        asr_output_content_length: number | string | null;
        asr_output_sha256: string | null;
        context_state: string | null;
      }>(
        `SELECT revision.id AS revision_id, revision.status AS revision_state,
                revision.revision_config_payload::text AS revision_config_payload,
                revision.revision_config_hash,
                asr.id AS asr_attempt_id, asr.terminal_at::text AS asr_terminal_at,
                asr.job_spec_object_key AS asr_input_object_key,
                asr.job_spec_content_length AS asr_input_content_length,
                asr.job_spec_checksum_sha256 AS asr_input_sha256,
                authority.object_key AS asr_output_object_key,
                authority.content_type AS asr_output_content_type,
                authority.issued_content_length AS asr_output_content_length,
                authority.issued_checksum_sha256 AS asr_output_sha256,
                context.state AS context_state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
           LEFT JOIN hosted_cpu_job_attempts AS asr
             ON asr.account_id = project.account_id
            AND asr.workspace_id = project.workspace_id
            AND asr.project_id = project.id
            AND asr.project_revision_id = revision.id
            AND asr.id = $4
            AND asr.kind = 'ASR'
            AND asr.state = 'SUCCEEDED'
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = asr.account_id
            AND authority.workspace_id = asr.workspace_id
            AND authority.attempt_id = asr.id
            AND authority.source = 'RESULT_DOCUMENT'
            AND authority.issued_at IS NOT NULL
           LEFT JOIN hosted_voiceover_contexts AS context
             ON context.account_id=revision.account_id AND context.workspace_id=revision.workspace_id
            AND context.project_revision_id=revision.id
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
            AND project.status = 'ACTIVE'
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId, asrAttemptId],
      );
      return result.rows[0] ?? null;
    });
    if (!state) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    if (state.revision_state !== "LOCKED")
      return response({ error: { code: "HOSTED_PROJECT_NOT_READY" } }, 409);
    if (!state.asr_attempt_id)
      return response({ error: { code: "HOSTED_ASR_NOT_SUCCEEDED" } }, 409);
    if (state.context_state !== "SUCCEEDED")
      return response({ error: { code: "HOSTED_VOICEOVER_CONTEXT_NOT_READY" } }, 409);
    const bucket = environment.PRIVATE_ARTIFACTS;
    if (
      !bucket ||
      !state.asr_terminal_at ||
      !state.asr_input_object_key ||
      !state.asr_input_content_length ||
      !state.asr_input_sha256 ||
      !state.asr_output_object_key ||
      state.asr_output_content_type !== "application/json" ||
      !state.asr_output_content_length ||
      !state.asr_output_sha256
    ) {
      return response({ error: { code: "HOSTED_ASR_OUTPUT_NOT_READY" } }, 409);
    }
    const [asrInputObject, asrObject] = await Promise.all([
      bucket.get(state.asr_input_object_key),
      bucket.get(state.asr_output_object_key),
    ]);
    if (
      !asrInputObject ||
      asrInputObject.size !== Number(state.asr_input_content_length) ||
      asrInputObject.httpMetadata?.contentType !== "application/json" ||
      !asrObject ||
      asrObject.size !== Number(state.asr_output_content_length) ||
      asrObject.httpMetadata?.contentType !== "application/json"
    ) {
      return response({ error: { code: "HOSTED_ASR_OUTPUT_NOT_VERIFIED" } }, 409);
    }
    const asrInputBytes = await asrInputObject.arrayBuffer();
    const asrOutputBytes = await asrObject.arrayBuffer();
    // The precompiled contract validators are intentionally large. Load them only for the explicit
    // planning request so progress, queue, catalog, and worker-heartbeat reads stay below the
    // Cloudflare request CPU limit.
    generationCoordinator = await import("./generation-coordinator");
    const result = await generationCoordinator.coordinateHostedGeneration({
      snapshot: {
        accountId: scope.account_id,
        workspaceId: scope.workspace_id,
        userId: scope.user_id,
        projectId,
        projectRevisionId: state.revision_id,
        asrAttemptId,
        asrState: "SUCCEEDED",
        asrFinishedAt: state.asr_terminal_at,
        asrInputObjectKey: state.asr_input_object_key,
        asrInputContentLength: Number(state.asr_input_content_length),
        asrInputSha256: state.asr_input_sha256,
        asrOutputObjectKey: state.asr_output_object_key,
        asrOutputContentType: "application/json",
        asrOutputContentLength: Number(state.asr_output_content_length),
        asrOutputSha256: state.asr_output_sha256,
        expectedWhisperModelSha256: config.mediaWorkerRelease.whisperModelSha256,
        revisionConfig: state.revision_config_payload,
        revisionConfigSha256: state.revision_config_hash,
      },
      asrInputBytes,
      asrOutputBytes,
      persistence: new HostedCanonicalTimingPersistence(pool, bucket),
    });
    return response(result, 202);
  } catch (error) {
    if (
      (generationCoordinator !== null &&
        error instanceof generationCoordinator.HostedGenerationCoordinationError) ||
      error instanceof HostedCanonicalTimingPersistenceError
    ) {
      console.error("hosted_generation_planning_failed", error.code);
      return response(
        {
          error: {
            code: "HOSTED_PROJECT_PLANNING_FAILED",
            message:
              "Video planning could not finish. Your transcript is saved; try planning again.",
          },
        },
        409,
      );
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function writeProjectPrompts(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!config.styleAnalysis)
    return response({ error: { code: "HOSTED_PROMPT_PROVIDER_UNAVAILABLE" } }, 503);
  const promptApiKey = config.styleAnalysis.apiKey;
  const pool = createNeonPool(config.neon.databaseUrl);
  let runId: string | null = null;
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const body = await parseHostedJson(request, "HOSTED_PROMPT_REQUEST_REJECTED", 4_096);
    if (body instanceof Response) return body;
    if (plainRecord(body)?.maximum_prompt_spend_micro_usd !== HOSTED_PROMPT_RESERVATION_MICRO_USD)
      return response({ error: { code: "HOSTED_PROMPT_SPEND_CONFIRMATION_REQUIRED" } }, 400);
    const plan = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const loaded = await transaction.query<{ plan: unknown }>(
        "SELECT public.videoforge_load_hosted_prompt_plan($1,$2,$3,$4) AS plan",
        [scope.account_id, scope.workspace_id, scope.user_id, projectId],
      );
      return loaded.rows[0]?.plan ?? null;
    });
    const planRecord = plainRecord(plan);
    if (!planRecord) return response({ error: { code: "HOSTED_PROMPT_PLAN_NOT_READY" } }, 409);
    const existingState = planRecord.existing_run_state;
    if (existingState === "SUCCEEDED")
      return response({
        schema_version: "videoforge-hosted-prompt-response/v1",
        state: "COMPLETE",
        replayed: true,
      });
    if (existingState !== null)
      return response(
        {
          error: {
            code: "HOSTED_PROMPT_EXECUTION_ALREADY_CLAIMED",
            message:
              "The prompt request already has a durable terminal or in-flight claim and cannot be redispatched.",
          },
        },
        409,
      );
    const identity: HostedPromptIdentity = {
      runId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      executionProfileId: crypto.randomUUID(),
      reservationCostEventId: crypto.randomUUID(),
      claimTokenHash: await sha256(`hosted-prompt-claim:${crypto.randomUUID()}:${projectId}`),
    };
    const authority = hostedPromptAuthority({
      plan,
      identity,
      reservedCostMicroUsd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
    });
    const batchPlan = hostedPromptBatchPlan(authority);
    const batchPlanHash = await sha256(canonicalJson(hostedPromptBatchPlanDocument(batchPlan)));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{ prepared: unknown }>(
        "SELECT public.videoforge_prepare_hosted_prompt_run($1::jsonb) AS prepared",
        [
          JSON.stringify({
            account_id: scope.account_id,
            workspace_id: scope.workspace_id,
            user_id: scope.user_id,
            project_id: projectId,
            revision_id: authority.revisionId,
            timeline_id: authority.timelineId,
            timeline_hash: authority.timelineHash,
            run_id: identity.runId,
            task_id: identity.taskId,
            attempt_id: identity.attemptId,
            outbox_id: identity.outboxId,
            execution_profile_id: identity.executionProfileId,
            reservation_cost_event_id: identity.reservationCostEventId,
            input_hash: authority.recordedInputHash,
            claim_token_hash: identity.claimTokenHash,
            reserved_cost_micro_usd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
            planned_batch_count: batchPlan.batchCount,
            planned_scene_count: batchPlan.totalScenes,
            batch_plan_hash: batchPlanHash,
          }),
        ],
      );
      return plainRecord(result.rows[0]?.prepared);
    });
    if (!prepared || prepared.created !== true)
      return response({ error: { code: "HOSTED_PROMPT_EXECUTION_ALREADY_CLAIMED" } }, 409);
    runId = identity.runId;
    const accepted = await runHostedPromptExecution({
      scope: { workspaceId: scope.workspace_id, actorUserId: scope.user_id },
      authority,
      batchPlan,
      command: {
        projectId,
        revisionId: authority.revisionId,
        timelineId: authority.timelineId,
        taskId: identity.taskId,
        attemptId: identity.attemptId,
        outboxId: identity.outboxId,
        presentedClaimTokenHash: identity.claimTokenHash,
      },
      apiKey: promptApiKey,
      persistBatch: async (batch) => {
        const recorded = await createNeonExecutor(pool).transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1, $2, true)", [
            "videoforge.account_id",
            scope.account_id,
          ]);
          const result = await transaction.query<{ recorded: boolean }>(
            "SELECT public.videoforge_record_hosted_prompt_batch($1,$2::jsonb) AS recorded",
            [
              identity.runId,
              JSON.stringify({
                batch_ordinal: batch.batchOrdinal,
                first_scene_ordinal: batch.firstSceneOrdinal,
                request_bytes: batch.requestBytes,
                request_hash: batch.requestHash,
                response_bytes: batch.responseBytes,
                response_hash: batch.responseHash,
                input_tokens: batch.inputTokens,
                output_tokens: batch.outputTokens,
                reported_cost_micro_usd: batch.reportedCostMicroUsd,
                scenes: batch.scenes.map((scene) => ({
                  scene_ordinal: scene.sceneOrdinal,
                  scene_id: scene.sceneId,
                  writer_output: scene.writerOutput,
                  compiled_prompt: scene.compiledPrompt,
                })),
              }),
            ],
          );
          return result.rows[0]?.recorded === true;
        });
        if (!recorded) throw new Error("HOSTED_PROMPT_BATCH_PROGRESS_REJECTED");
      },
      persist: async (acceptance) => {
        const completed = await createNeonExecutor(pool).transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1, $2, true)", [
            "videoforge.account_id",
            scope.account_id,
          ]);
          const result = await transaction.query<{ completed: boolean }>(
            "SELECT public.videoforge_complete_hosted_prompt_run($1::jsonb) AS completed",
            [
              JSON.stringify({
                run_id: identity.runId,
                output_asset_id: crypto.randomUUID(),
                prompt_execution_id: crypto.randomUUID(),
                acceptance,
              }),
            ],
          );
          return result.rows[0]?.completed === true;
        });
        if (!completed) throw new Error("HOSTED_PROMPT_ACCEPTANCE_REJECTED");
      },
    });
    return response(
      {
        schema_version: "videoforge-hosted-prompt-response/v1",
        state: "COMPLETE",
        replayed: false,
        scene_count: accepted.compiledPrompts.length,
        prompt_cost_usd: accepted.reportedCostMicroUsd / 1_000_000,
      },
      202,
    );
  } catch (error) {
    const promptFailure =
      error instanceof HostedPromptExecutionError
        ? error
        : new HostedPromptExecutionError("HOSTED_PROMPT_EXECUTION_UNKNOWN", "UNKNOWN", true, null);
    if (runId) {
      try {
        const scope = await sessionScope(request, config, pool, executionContext);
        if (!(scope instanceof Response)) {
          await createNeonExecutor(pool).transaction(async (transaction) => {
            await transaction.query("SELECT set_config($1, $2, true)", [
              "videoforge.account_id",
              scope.account_id,
            ]);
            await transaction.query(
              "SELECT public.videoforge_fail_hosted_prompt_run($1,$2,$3,$4,$5)",
              [
                runId,
                promptFailure.terminalState,
                promptFailure.problemCode,
                promptFailure.providerMayHaveCharged,
                promptFailure.additionalKnownCostMicroUsd,
              ],
            );
          });
        }
      } catch {
        // The durable DISPATCHING claim still prevents a blind provider redispatch.
      }
    }
    console.error("HOSTED_PROMPT_EXECUTION_FAILURE", {
      error_name: error instanceof Error ? error.name : "Error",
      problem_code: promptFailure.problemCode,
      terminal_state: promptFailure.terminalState,
      provider_may_have_charged: promptFailure.providerMayHaveCharged,
      additional_known_cost_micro_usd: promptFailure.additionalKnownCostMicroUsd,
      stage: promptFailure.diagnostic?.stage ?? null,
      http_status: promptFailure.diagnostic?.httpStatus ?? null,
      provider_code: promptFailure.diagnostic?.providerCode ?? null,
      provider_parameter: promptFailure.diagnostic?.providerParameter ?? null,
    });
    return response(
      {
        error: {
          code: promptFailure.problemCode,
          message:
            promptFailure.terminalState === "FAILED"
              ? "Image prompt writing was rejected before VideoForge accepted a result. The request will not be automatically repeated."
              : "Image prompt writing stopped without a durable accepted result. The request will not be automatically repeated.",
        },
      },
      409,
    );
  } finally {
    await pool.end();
  }
}

async function projects(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const rows = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query(
        `SELECT project.id, project.name AS title, project.created_at, revision.id AS revision_id,
                revision.status AS revision_state,
                COALESCE((SELECT attempt.state FROM hosted_cpu_job_attempts AS attempt
                           WHERE attempt.project_id = project.id
                           ORDER BY attempt.created_at DESC LIMIT 1), 'AWAITING_UPLOAD') AS state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
          WHERE project.account_id = $1 AND project.workspace_id = $2
            AND project.status = 'ACTIVE'
            AND project.project_kind = 'USER'
          ORDER BY project.created_at DESC`,
        [scope.account_id, scope.workspace_id],
      );
      return result.rows;
    });
    return response({ schema_version: "videoforge-hosted-project-list/v1", projects: rows });
  } finally {
    await pool.end();
  }
}

type HostedContactSheetItem = {
  readonly id: string;
  readonly asset_id: null;
  readonly image_url: string;
  readonly label: string;
  readonly start_ms: null;
  readonly end_ms: null;
  readonly shot_role: string;
};

async function contactSheet(
  outputs: readonly Record<string, unknown>[],
  bucket: HostedRuntimeEnvironment["PRIVATE_ARTIFACTS"],
  signer: HostedR2Signer,
): Promise<readonly HostedContactSheetItem[]> {
  if (!bucket) return [];
  const items: HostedContactSheetItem[] = [];
  for (const output of outputs) {
    if (!Array.isArray(output.artifacts)) continue;
    for (const rawArtifact of output.artifacts) {
      if (!rawArtifact || typeof rawArtifact !== "object" || items.length >= 96) continue;
      const artifact = rawArtifact as Record<string, unknown>;
      const objectKey = artifact.object_key;
      const checksum = artifact.checksum_sha256;
      const contentLength = numberOrNull(artifact.content_length);
      const itemId = artifact.item_id;
      if (
        typeof objectKey !== "string" ||
        typeof checksum !== "string" ||
        !SHA256.test(checksum) ||
        contentLength === null ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1 ||
        typeof itemId !== "string"
      ) {
        continue;
      }
      const object = await bucket.head(objectKey);
      const contentType = object?.httpMetadata?.contentType;
      if (
        !object ||
        object.size !== contentLength ||
        typeof contentType !== "string" ||
        !contentType.startsWith("image/") ||
        checksumFromR2(object.checksums?.sha256) !== checksum
      ) {
        continue;
      }
      const port = await signer.sign({
        method: "GET",
        objectKey,
        contentType,
        contentLength,
        checksumSha256: checksum,
        lifetimeSeconds: 300,
      });
      items.push({
        id: itemId,
        asset_id: null,
        image_url: port.url,
        label: itemId,
        start_ms: null,
        end_ms: null,
        shot_role: String(output.lane ?? "IMAGE"),
      });
    }
    if (items.length >= 96) break;
  }
  return items;
}

async function projectDetail(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const detail = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      await transaction.query(
        "SELECT public.videoforge_reconcile_stale_hosted_prompt_dispatches($1)",
        [projectId],
      );
      const project = await transaction.query(
        `SELECT project.id, project.name AS title, project.created_at, revision.id AS revision_id,
                revision.status AS revision_state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
            AND project.status = 'ACTIVE'
            AND project.project_kind = 'USER'
          ORDER BY revision.revision_number DESC
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const selectedRevisionId = (project.rows[0] as Record<string, unknown> | undefined)
        ?.revision_id;
      const currentRevisionId =
        typeof selectedRevisionId === "string" && UUID.test(selectedRevisionId)
          ? selectedRevisionId
          : null;
      const attempts = await transaction.query(
        `SELECT attempt.id, attempt.kind, attempt.state, attempt.version, attempt.created_at,
                attempt.updated_at, attempt.submitted_at, attempt.terminal_at,
                attempt.result_checksum_sha256, attempt.result_content_length,
                attempt.result_object_key, attempt.result_content_type,
                attempt.replay_count,
                lease.failure_code AS error_code,
                authority.object_key, authority.content_type,
                authority.issued_content_length AS content_length,
                authority.issued_checksum_sha256 AS output_checksum_sha256,
                review.approved_at
           FROM hosted_cpu_job_attempts AS attempt
           LEFT JOIN LATERAL (
             SELECT worker_lease.failure_code
               FROM media_worker_leases AS worker_lease
              WHERE worker_lease.account_id = attempt.account_id
                AND worker_lease.workspace_id = attempt.workspace_id
                AND worker_lease.attempt_id = attempt.id
              ORDER BY worker_lease.created_at DESC LIMIT 1
           ) AS lease ON true
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
            AND authority.source = 'PRIMARY_RESULT_OUTPUT' AND authority.issued_at IS NOT NULL
           LEFT JOIN hosted_project_reviews AS review
             ON review.account_id = attempt.account_id
            AND review.workspace_id = attempt.workspace_id
            AND review.render_attempt_id = attempt.id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2 AND attempt.project_id = $3
          ORDER BY attempt.created_at`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const voiceoverContext = await transaction.query(
        `SELECT context.id, context.state, context.transcript_hash, context.context_hash,
                context.context_document, context.reserved_cost_micro_usd,
                context.reported_cost_micro_usd, context.problem_code,
                context.provider_may_have_charged, context.started_at, context.finished_at
           FROM hosted_voiceover_contexts AS context
          WHERE context.account_id=$1 AND context.workspace_id=$2 AND context.project_id=$3
            AND context.project_revision_id=$4
          ORDER BY context.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId, currentRevisionId],
      );
      const generation = await transaction.query(
        `SELECT plan.id, plan.canonical_document_hash AS timeline_plan_sha256,
                (SELECT count(*)
                   FROM timeline_segments AS segment
                  WHERE segment.account_id = revision.account_id
                    AND segment.workspace_id = revision.workspace_id
                    AND segment.project_revision_id = revision.id
                    AND segment.timeline_plan_id = plan.id) AS total_segments,
                (SELECT count(*)
                   FROM timeline_segments AS segment
                  WHERE segment.account_id = revision.account_id
                    AND segment.workspace_id = revision.workspace_id
                    AND segment.project_revision_id = revision.id
                    AND segment.timeline_plan_id = plan.id
                    AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE'))
                  AS image_scene_count,
                (SELECT count(*)
                   FROM timeline_segments AS segment
                  WHERE segment.account_id = revision.account_id
                    AND segment.workspace_id = revision.workspace_id
                    AND segment.project_revision_id = revision.id
                    AND segment.timeline_plan_id = plan.id
                    AND segment.timeline_composition IN ('AVATAR_FULL','AVATAR_SPLIT_IMAGE'))
                  AS avatar_segment_count,
                count(task.id) FILTER (WHERE task.lane IN ('IMAGE', 'AVATAR')) AS planned_tasks,
                count(task.id) FILTER (
                  WHERE task.lane IN ('IMAGE', 'AVATAR') AND task.state = 'COMPLETE'
                ) AS completed_tasks,
                count(task.id) FILTER (
                  WHERE task.lane IN ('IMAGE', 'AVATAR') AND task.state = 'FAILED'
                ) AS failed_tasks,
                (array_agg(task.state ORDER BY task.created_at DESC, task.id DESC)
                  FILTER (WHERE task.lane = 'PROMPT'
                    AND task.task_key LIKE 'prompt:scene-batch:%'))[1] AS prompt_task_state
           FROM project_revisions AS revision
           JOIN revision_timing_heads AS head
             ON head.account_id = revision.account_id
            AND head.workspace_id = revision.workspace_id
            AND head.project_revision_id = revision.id
           JOIN timeline_plans AS plan
             ON plan.account_id = head.account_id
            AND plan.workspace_id = head.workspace_id
            AND plan.project_revision_id = head.project_revision_id
            AND plan.id = head.current_timeline_plan_id
           LEFT JOIN generation_tasks AS task
             ON task.workspace_id = revision.workspace_id
            AND task.project_revision_id = revision.id
          WHERE revision.account_id = $1 AND revision.workspace_id = $2
            AND revision.project_id = $3
            AND revision.id = $4
          GROUP BY plan.id, plan.canonical_document_hash, plan.plan_sequence
          ORDER BY plan.plan_sequence DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId, currentRevisionId],
      );
      const selectedTimelineId = (generation.rows[0] as Record<string, unknown> | undefined)?.id;
      const currentTimelineId =
        typeof selectedTimelineId === "string" && UUID.test(selectedTimelineId)
          ? selectedTimelineId
          : null;
      const prompts = await transaction.query(
        `WITH prompt_rows AS (
          SELECT result.scene_ordinal, result.scene_id, execution.project_revision_id,
                 execution.timeline_plan_id,
                 result.compiled_prompt->>'positivePrompt' AS positive_prompt,
                 result.compiled_prompt->>'negativePrompt' AS negative_prompt,
                 execution.image_style_version_id, execution.style_profile_hash,
                 execution.account_id, execution.workspace_id, true AS durable
            FROM prompt_executions AS execution
            JOIN prompt_scene_results AS result
              ON result.account_id=execution.account_id
             AND result.workspace_id=execution.workspace_id
             AND result.prompt_execution_id=execution.id
           WHERE execution.account_id=$1 AND execution.workspace_id=$2
             AND execution.project_id=$3
             AND execution.project_revision_id=$4
             AND execution.timeline_plan_id=$5
          UNION ALL
          SELECT progress.scene_ordinal,progress.scene_id,run.project_revision_id,
                 run.timeline_plan_id,
                 progress.compiled_prompt->>'positivePrompt' AS positive_prompt,
                 progress.compiled_prompt->>'negativePrompt' AS negative_prompt,
                 revision.image_style_version_id,revision.style_profile_hash,
                 progress.account_id,progress.workspace_id,false AS durable
            FROM hosted_prompt_scene_progress AS progress
            JOIN hosted_prompt_runs AS run
              ON run.account_id=progress.account_id AND run.workspace_id=progress.workspace_id
             AND run.id=progress.run_id
            JOIN project_revisions AS revision
              ON revision.account_id=run.account_id AND revision.workspace_id=run.workspace_id
             AND revision.id=run.project_revision_id
           WHERE run.account_id=$1 AND run.workspace_id=$2 AND run.project_id=$3
             AND run.project_revision_id=$4
             AND run.timeline_plan_id=$5
             AND NOT EXISTS (SELECT 1 FROM prompt_executions execution
               WHERE execution.account_id=run.account_id AND execution.workspace_id=run.workspace_id
                 AND execution.task_id=run.task_id)
        )
        SELECT result.scene_ordinal, result.scene_id, segment.narration,
                segment.in_image_shot_role, segment.timeline_composition,
                result.positive_prompt,result.negative_prompt,
                result.image_style_version_id,result.style_profile_hash,
                style.name AS style_name,result.durable
           FROM prompt_rows AS result
           JOIN timeline_segments AS segment
             ON segment.account_id = result.account_id
            AND segment.workspace_id = result.workspace_id
            AND segment.project_revision_id = result.project_revision_id
            AND segment.timeline_plan_id = result.timeline_plan_id
            AND segment.segment_key = result.scene_id
           JOIN image_style_versions AS style_version
             ON style_version.account_id=result.account_id
            AND style_version.workspace_id=result.workspace_id
            AND style_version.id=result.image_style_version_id
           JOIN image_styles AS style
             ON style.account_id = style_version.account_id
            AND style.workspace_id = style_version.workspace_id
            AND style.id = style_version.style_id
          ORDER BY result.scene_ordinal`,
        [scope.account_id, scope.workspace_id, projectId, currentRevisionId, currentTimelineId],
      );
      const promptProgress = await transaction.query(
        `SELECT run.state,
                COALESCE(run.planned_scene_count, expected.scene_count) AS total_scenes,
                count(DISTINCT scene.id) AS accepted_scenes,
                run.planned_batch_count AS total_batches,
                count(DISTINCT batch.id) AS accepted_batches,
                CASE
                  WHEN run.state = 'DISPATCHING' AND run.planned_batch_count IS NOT NULL
                    THEN least(run.planned_batch_count, count(DISTINCT batch.id)::integer + 1)
                  ELSE NULL
                END AS active_batch_ordinal
           FROM hosted_prompt_runs AS run
           LEFT JOIN hosted_prompt_scene_progress AS scene
             ON scene.account_id=run.account_id AND scene.workspace_id=run.workspace_id
            AND scene.run_id=run.id
           LEFT JOIN hosted_prompt_batch_progress AS batch
             ON batch.account_id=run.account_id AND batch.workspace_id=run.workspace_id
            AND batch.run_id=run.id
           LEFT JOIN LATERAL (
             SELECT count(*)::integer AS scene_count
               FROM timeline_segments AS segment
              WHERE segment.account_id=run.account_id
                AND segment.workspace_id=run.workspace_id
                AND segment.project_revision_id=run.project_revision_id
                AND segment.timeline_plan_id=run.timeline_plan_id
                AND segment.timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')
           ) AS expected ON true
          WHERE run.account_id=$1 AND run.workspace_id=$2 AND run.project_id=$3
            AND run.project_revision_id=$4
            AND run.timeline_plan_id=$5
          GROUP BY run.id, run.state, run.planned_scene_count, run.planned_batch_count,
                   expected.scene_count, run.created_at
          ORDER BY run.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId, currentRevisionId, currentTimelineId],
      );
      const queue = await transaction.query(
        `SELECT request.id, request.state, request.queue_order, request.available_at,
                request.admitted_at, request.terminal_at,
                (SELECT count(*) FROM generation_requests AS ahead
                  WHERE ahead.state IN ('WAITING','ADMITTED','ACTIVE','RETRY_WAIT')
                    AND ahead.queue_order < request.queue_order) AS ahead,
                (SELECT count(*) FROM generation_requests AS total
                  WHERE total.state IN ('WAITING','ADMITTED','ACTIVE','RETRY_WAIT')) AS total
           FROM generation_requests AS request
          WHERE request.account_id = $1 AND request.workspace_id = $2
            AND request.project_id = $3
          ORDER BY request.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const runtime = await transaction.query(
        `SELECT runtime.id, runtime.stage, runtime.admitted_at, runtime.prepared_at,
                runtime.terminal_at, runtime.terminal_reason, runtime.updated_at,
                COALESCE(
                  jsonb_agg(jsonb_build_object(
                    'id', lane.id, 'lane', lane.lane, 'state', lane.state,
                    'planned_item_count', lane.planned_item_count,
                    'accepted_item_count', lane.accepted_item_count,
                    'attempt_ordinal', lane.attempt_ordinal,
                    'max_attempt_ordinal', lane.max_attempt_ordinal,
                    'current_attempt_id', lane.current_attempt_id,
                    'items_manifest_sha256', lane.items_manifest_sha256,
                    'updated_at', lane.updated_at
                  ) ORDER BY lane.lane) FILTER (WHERE lane.id IS NOT NULL),
                  '[]'::jsonb
                ) AS lanes
           FROM video_runtime_states AS runtime
           LEFT JOIN video_runtime_lane_states AS lane
             ON lane.account_id = runtime.account_id
            AND lane.workspace_id = runtime.workspace_id
            AND lane.runtime_id = runtime.id
          WHERE runtime.account_id = $1 AND runtime.workspace_id = $2
            AND runtime.project_id = $3
          GROUP BY runtime.id, runtime.stage, runtime.admitted_at, runtime.prepared_at,
                   runtime.terminal_at, runtime.terminal_reason, runtime.updated_at,
                   runtime.created_at
          ORDER BY runtime.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const serverlessAttempts = await transaction.query(
        `SELECT attempt.id, attempt.lane, attempt.state, attempt.attempt_ordinal,
                attempt.item_count, attempt.created_at, attempt.submitted_at,
                attempt.terminal_at, attempt.updated_at,
                progress.provider_status, progress.attempt_state,
                progress.items_completed, progress.items_total,
                progress.observed_at AS progress_observed_at,
                ledger.estimated_usd, ledger.reserved_usd, ledger.reported_usd,
                ledger.settled_usd, ledger.possible_duplicate_usd
           FROM serverless_attempts AS attempt
           LEFT JOIN LATERAL (
             SELECT event.provider_status, event.attempt_state,
                    event.items_completed, event.items_total, event.observed_at
               FROM serverless_progress_events AS event
              WHERE event.account_id = attempt.account_id
                AND event.workspace_id = attempt.workspace_id
                AND event.attempt_id = attempt.id
              ORDER BY event.sequence DESC LIMIT 1
           ) AS progress ON true
           LEFT JOIN serverless_cost_ledgers AS ledger
             ON ledger.account_id = attempt.account_id
            AND ledger.workspace_id = attempt.workspace_id
            AND ledger.attempt_id = attempt.id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.project_id = $3
          ORDER BY attempt.created_at`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const serverlessOutputs = await transaction.query(
        `SELECT output.attempt_id, output.lane, output.artifacts, output.accepted_at
           FROM serverless_output_receipts AS output
          WHERE output.account_id = $1 AND output.workspace_id = $2
            AND output.project_revision_id = $3
            AND output.acceptance = 'ACCEPTED_CANONICAL'
          ORDER BY output.accepted_at, output.attempt_id`,
        [scope.account_id, scope.workspace_id, String(project.rows[0]?.revision_id ?? "")],
      );
      const cost = await transaction.query(
        `SELECT revision.maximum_cost_micro_usd,
                COALESCE(sum(ledger.estimated_usd), 0) AS estimated_usd,
                COALESCE(sum(ledger.reserved_usd), 0) AS reserved_usd,
                COALESCE(sum(ledger.reported_usd), 0) AS reported_usd,
                COALESCE(sum(ledger.settled_usd), 0) AS settled_usd,
                COALESCE(sum(ledger.possible_duplicate_usd), 0) AS possible_duplicate_usd,
                COALESCE((SELECT sum(event.amount_micro_usd)::numeric / 1000000
                  FROM cost_events event JOIN generation_tasks task
                    ON task.account_id=event.account_id AND task.workspace_id=event.workspace_id
                   AND task.id=event.task_id
                 WHERE event.account_id=revision.account_id
                   AND event.workspace_id=revision.workspace_id
                   AND event.owner_id=revision.id AND task.lane='PROMPT'
                   AND event.event_type='RESERVED'
                   AND NOT EXISTS (SELECT 1 FROM cost_events terminal
                     WHERE terminal.account_id=event.account_id
                       AND terminal.workspace_id=event.workspace_id
                       AND terminal.task_id=event.task_id
                       AND terminal.attempt_id=event.attempt_id
                       AND terminal.event_type IN ('SETTLED','RELEASED'))),0) AS prompt_reserved_usd,
                COALESCE((SELECT sum(event.amount_micro_usd)::numeric / 1000000
                  FROM cost_events event JOIN generation_tasks task
                    ON task.account_id=event.account_id AND task.workspace_id=event.workspace_id
                   AND task.id=event.task_id
                 WHERE event.account_id=revision.account_id
                   AND event.workspace_id=revision.workspace_id
                   AND event.owner_id=revision.id AND task.lane='PROMPT'
                   AND event.event_type='SETTLED'),0) AS prompt_settled_usd
           FROM project_revisions AS revision
           LEFT JOIN serverless_attempts AS attempt
             ON attempt.account_id = revision.account_id
            AND attempt.workspace_id = revision.workspace_id
            AND attempt.project_revision_id = revision.id
           LEFT JOIN serverless_cost_ledgers AS ledger
             ON ledger.account_id = attempt.account_id
            AND ledger.workspace_id = attempt.workspace_id
            AND ledger.attempt_id = attempt.id
          WHERE revision.account_id = $1 AND revision.workspace_id = $2
            AND revision.project_id = $3
          GROUP BY revision.id, revision.maximum_cost_micro_usd`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const zeroWorkers = await transaction.query(
        `SELECT count(*) AS evidence_count, max(zero.observed_at) AS observed_at,
                (array_agg(zero.generation_request_id ORDER BY zero.observed_at DESC))[1]
                  AS generation_request_id
           FROM hosted_pair_zero_worker_observations AS zero
           JOIN generation_requests AS request
             ON request.account_id = zero.account_id
            AND request.workspace_id = zero.workspace_id
            AND request.id = zero.generation_request_id
          WHERE zero.account_id = $1 AND zero.workspace_id = $2
            AND request.project_id = $3`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const failedTasks = await transaction.query(
        `SELECT task.id, task.task_key, task.lane, task.state, task.updated_at
           FROM generation_tasks AS task
          WHERE task.account_id = $1 AND task.workspace_id = $2
            AND task.project_revision_id = $3
            AND task.state IN ('FAILED','BLOCKED','RETRY_WAIT')
          ORDER BY task.updated_at DESC`,
        [scope.account_id, scope.workspace_id, String(project.rows[0]?.revision_id ?? "")],
      );
      const review = await transaction.query(
        `SELECT review.render_attempt_id, review.output_checksum_sha256,
                review.approved_by_user_id, review.approved_at
           FROM hosted_project_reviews AS review
          WHERE review.account_id = $1 AND review.workspace_id = $2
            AND review.project_id = $3
          ORDER BY review.approved_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return {
        project: project.rows[0],
        attempts: attempts.rows,
        voiceoverContext: voiceoverContext.rows[0] ?? null,
        generation: generation.rows[0] ?? null,
        prompts: prompts.rows,
        promptProgress: promptProgress.rows[0] ?? null,
        queue: queue.rows[0] ?? null,
        runtime: runtime.rows[0] ?? null,
        serverlessAttempts: serverlessAttempts.rows,
        serverlessOutputs: serverlessOutputs.rows,
        cost: cost.rows[0] ?? null,
        zeroWorkers: zeroWorkers.rows[0] ?? null,
        failedTasks: failedTasks.rows,
        review: review.rows[0] ?? null,
      };
    });
    if (!detail.project) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    const signer = new HostedR2Signer(config.r2);
    const attempts = [] as Record<string, unknown>[];
    for (const value of detail.attempts as Record<string, unknown>[]) {
      let previewUrl: string | null = null;
      if (
        value.kind === "RENDER" &&
        value.state === "SUCCEEDED" &&
        typeof value.object_key === "string" &&
        value.content_type === "video/mp4" &&
        Number.isSafeInteger(Number(value.content_length)) &&
        typeof value.output_checksum_sha256 === "string"
      ) {
        const object = await environment.PRIVATE_ARTIFACTS?.head(value.object_key);
        if (
          object &&
          object.size === Number(value.content_length) &&
          object.httpMetadata?.contentType === "video/mp4" &&
          checksumFromR2(object.checksums?.sha256) === value.output_checksum_sha256
        ) {
          previewUrl = (
            await signer.sign({
              method: "GET",
              objectKey: value.object_key,
              contentType: "video/mp4",
              contentLength: Number(value.content_length),
              checksumSha256: value.output_checksum_sha256,
              lifetimeSeconds: 300,
            })
          ).url;
        }
      }
      attempts.push({
        ...value,
        submitted_at: timestampOrNull(value.submitted_at),
        terminal_at: timestampOrNull(value.terminal_at),
        preview_url: previewUrl,
        progress_percent:
          value.kind === "ASR"
            ? value.state === "SUCCEEDED"
              ? 100
              : value.state === "RUNNING"
                ? 50
                : 0
            : null,
        queue_position: null,
        timing: hostedTiming({
          createdAt: value.created_at,
          submittedAt: value.submitted_at,
          terminalAt: value.terminal_at,
        }),
        cost: {
          projected_usd: 0,
          settled_usd: 0,
          cap_usd: null,
          billed_seconds: null,
          provider: "personal-worker",
        },
      });
    }
    const serverlessAttempts = detail.serverlessAttempts as Record<string, unknown>[];
    const serverlessByLane = new Map<string, Record<string, unknown>>();
    for (const attempt of serverlessAttempts) {
      serverlessByLane.set(String(attempt.lane), attempt);
      const progressPercent = hostedProgressPercent(
        attempt.items_completed,
        attempt.items_total ?? attempt.item_count,
      );
      attempts.push({
        ...attempt,
        kind: String(attempt.lane).toUpperCase(),
        progress_percent: progressPercent,
        queue_position: null,
        preview_url: null,
        timing: hostedTiming({
          createdAt: attempt.created_at,
          submittedAt: attempt.submitted_at,
          terminalAt: attempt.terminal_at,
        }),
        cost: {
          projected_usd: numberOrNull(attempt.estimated_usd),
          settled_usd: numberOrNull(attempt.settled_usd),
          cap_usd: null,
          billed_seconds: null,
          provider: "runpod",
        },
      });
    }
    const runtime = (detail.runtime ?? null) as Record<string, unknown> | null;
    const runtimeLanes = Array.isArray(runtime?.lanes)
      ? (runtime?.lanes as Record<string, unknown>[])
      : [];
    const laneState = (lane: string): Record<string, unknown> | null =>
      runtimeLanes.find((value) => value.lane === lane) ?? serverlessByLane.get(lane) ?? null;
    const laneProgress = (lane: string): number | null => {
      const value = laneState(lane);
      if (!value) return null;
      if (value.accepted_item_count !== undefined)
        return hostedProgressPercent(value.accepted_item_count, value.planned_item_count);
      return hostedProgressPercent(value.items_completed, value.items_total ?? value.item_count);
    };
    const asr = (detail.attempts as Record<string, unknown>[]).find(
      (value) => value.kind === "ASR",
    );
    const render = (detail.attempts as Record<string, unknown>[]).find(
      (value) => value.kind === "RENDER",
    );
    const gpuReadiness = hostedGpuReadinessForConfiguration(config);
    const gpuPendingState = hostedGpuProductState(gpuReadiness).pendingState;
    const promptProgress = detail.promptProgress as Record<string, unknown> | null;
    const acceptedPromptScenes = numberOrNull(promptProgress?.accepted_scenes) ?? 0;
    const totalPromptScenes = numberOrNull(promptProgress?.total_scenes) ?? 0;
    const promptStage = hostedPromptWritingState(
      (detail.generation as Record<string, unknown> | null)?.prompt_task_state,
      detail.generation !== null,
      { acceptedScenes: acceptedPromptScenes, totalScenes: totalPromptScenes },
    );
    const voiceoverContext = detail.voiceoverContext as Record<string, unknown> | null;
    const contextState = String(voiceoverContext?.state ?? "WAITING");
    const contextProblemCode = String(voiceoverContext?.problem_code ?? "");
    const contextStageStatus =
      contextState === "SUCCEEDED"
        ? "COMPLETE"
        : contextState === "UNKNOWN"
          ? "FAILED"
          : contextState === "DISPATCHING"
            ? "RUNNING"
            : !voiceoverContext && asr?.state === "SUCCEEDED"
              ? "RUNNING"
              : contextState;
    const stages = [
      {
        id: "prepare",
        name: "Prepare project",
        status: "COMPLETE",
        progress_percent: 100,
        started_at: timestampOrNull((detail.project as Record<string, unknown>)?.created_at),
        completed_at: timestampOrNull((detail.project as Record<string, unknown>)?.created_at),
        detail: "Project inputs, voiceover, avatar, and image style are locked for this run.",
        eta_ms: null,
      },
      {
        id: "transcription",
        name: "Transcribe voiceover",
        status: String(asr?.state ?? "WAITING"),
        progress_percent: asr?.state === "SUCCEEDED" ? 100 : asr ? 50 : 0,
        started_at: timestampOrNull(asr?.submitted_at),
        completed_at: timestampOrNull(asr?.terminal_at),
        detail: "Your connected computer is converting the voiceover into timed speech.",
        eta_ms: null,
      },
      {
        id: "voiceover-context",
        name: "Understand voiceover context",
        status: contextStageStatus,
        progress_percent: contextState === "SUCCEEDED" ? 100 : 0,
        started_at: timestampOrNull(voiceoverContext?.started_at),
        completed_at: timestampOrNull(voiceoverContext?.finished_at),
        detail:
          contextState === "SUCCEEDED"
            ? "Compact whole-script facts are saved for scene planning and prompt relevance."
            : contextState === "UNKNOWN"
              ? contextProblemCode === "HOSTED_CONTEXT_DISPATCH_TIMEOUT"
                ? "The request exceeded its safe deadline. Its result is uncertain and will not be dispatched again automatically."
                : contextProblemCode === "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN"
                  ? "Runware could not be reached before an accepted task was confirmed. No automatic redispatch occurred."
                  : contextProblemCode === "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE"
                    ? "Runware returned a temporary server failure before an accepted result was confirmed. No automatic redispatch occurred."
                    : contextProblemCode === "VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN"
                      ? "Runware responded, but no durable accepted result could be verified. No automatic redispatch occurred."
                      : "The provider result is uncertain and will not be dispatched again automatically."
              : contextState === "FAILED" &&
                  contextProblemCode === "VOICEOVER_CONTEXT_PROVIDER_REJECTED"
                ? "Runware rejected the request before VideoForge accepted a result."
                : !voiceoverContext && asr?.state === "SUCCEEDED"
                  ? "VideoForge is starting voiceover context automatically within the project limit."
                  : "The complete transcript is summarized once into bounded story context.",
        eta_ms: null,
      },
      {
        id: "planning",
        name: "Plan scenes",
        status: detail.generation ? "COMPLETE" : "WAITING",
        progress_percent: detail.generation ? 100 : 0,
        started_at: null,
        completed_at: null,
        detail: "VideoForge maps the transcript into an exact scene and timing plan.",
        eta_ms: null,
      },
      {
        id: "prompt-writing",
        name: "Write image prompts",
        status: promptStage.status,
        progress_percent: promptStage.progressPercent,
        started_at: null,
        completed_at: null,
        detail: promptStage.detail,
        eta_ms: null,
      },
      {
        id: "image-generation",
        name: "Generate images",
        status: String(laneState("mage_image")?.state ?? gpuPendingState),
        progress_percent: laneProgress("mage_image"),
        started_at: timestampOrNull(laneState("mage_image")?.created_at),
        completed_at: timestampOrNull(laneState("mage_image")?.terminal_at),
        detail: "Generate and verify the planned scene images.",
        eta_ms: null,
      },
      {
        id: "avatar-generation",
        name: "Generate avatar video",
        status: String(laneState("soulx_avatar")?.state ?? gpuPendingState),
        progress_percent: laneProgress("soulx_avatar"),
        started_at: timestampOrNull(laneState("soulx_avatar")?.created_at),
        completed_at: timestampOrNull(laneState("soulx_avatar")?.terminal_at),
        detail: "Generate and verify the selected presenter performance.",
        eta_ms: null,
      },
      {
        id: "render",
        name: "Assemble final video",
        status: String(render?.state ?? "WAITING"),
        progress_percent: render ? (render.state === "SUCCEEDED" ? 100 : 50) : 0,
        started_at: timestampOrNull(render?.submitted_at),
        completed_at: timestampOrNull(render?.terminal_at),
        detail: "Your computer assembles the accepted media and voiceover into the final video.",
        eta_ms: null,
      },
      {
        id: "technical-check",
        name: "Technical check",
        status: render?.state === "SUCCEEDED" ? "COMPLETE" : "WAITING",
        progress_percent: render?.state === "SUCCEEDED" ? 100 : 0,
        started_at: timestampOrNull(render?.terminal_at),
        completed_at: timestampOrNull(render?.terminal_at),
        detail: "VideoForge verifies the final file, duration, audio, and checksum.",
        eta_ms: null,
      },
      {
        id: "review",
        name: "Review and approve",
        status: detail.review ? "COMPLETE" : render?.state === "SUCCEEDED" ? "BLOCKED" : "WAITING",
        progress_percent: detail.review ? 100 : 0,
        started_at: timestampOrNull((detail.review as Record<string, unknown> | null)?.approved_at),
        completed_at: timestampOrNull(
          (detail.review as Record<string, unknown> | null)?.approved_at,
        ),
        detail:
          render?.state === "SUCCEEDED"
            ? "Your video is ready for final review."
            : "Final review opens after the technical check passes.",
        eta_ms: null,
      },
    ];
    const queueRow = detail.queue as Record<string, unknown> | null;
    const queue = queueRow
      ? {
          position: numberOrNull(queueRow.ahead) === null ? null : Number(queueRow.ahead) + 1,
          ahead: numberOrNull(queueRow.ahead),
          total: numberOrNull(queueRow.total),
          status: queueRow.state ?? null,
          estimated_wait_ms: null,
          fair_rotation: "DETERMINISTIC_ACCOUNT_ROTATION",
        }
      : null;
    const costRow = detail.cost as Record<string, unknown> | null;
    const projectedCost = costRow
      ? Math.max(
          numberOrNull(costRow.estimated_usd) ?? 0,
          numberOrNull(costRow.reserved_usd) ?? 0,
          numberOrNull(costRow.reported_usd) ?? 0,
        ) +
        (numberOrNull(costRow.possible_duplicate_usd) ?? 0) +
        (numberOrNull(costRow.prompt_reserved_usd) ?? 0) +
        (numberOrNull(costRow.prompt_settled_usd) ?? 0)
      : 0;
    const settledCost = costRow
      ? (numberOrNull(costRow.settled_usd) ?? 0) + (numberOrNull(costRow.prompt_settled_usd) ?? 0)
      : 0;
    const capCost = costRow
      ? (numberOrNull(costRow.maximum_cost_micro_usd) ?? 0) / 1_000_000
      : null;
    const timingRows = [...(detail.attempts as Record<string, unknown>[]), ...serverlessAttempts];
    const createdAt = timingRows
      .map((value) => new Date(String(value.created_at)).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    const terminalAt = timingRows
      .map((value) => (value.terminal_at ? new Date(String(value.terminal_at)).getTime() : NaN))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0];
    const timing = {
      queue_wait_ms: elapsedMs(createdAt, queueRow?.admitted_at ?? timingRows[0]?.submitted_at),
      initialization_ms: elapsedMs(runtime?.admitted_at, runtime?.prepared_at),
      model_ready_ms: null,
      inference_ms: elapsedMs(render?.submitted_at, render?.terminal_at),
      upload_ms: null,
      render_ms: elapsedMs(render?.submitted_at, render?.terminal_at),
      end_to_end_ms: elapsedMs(createdAt, terminalAt),
    };
    const zeroWorkerRow = detail.zeroWorkers as Record<string, unknown> | null;
    const zeroWorkerCount = numberOrNull(zeroWorkerRow?.evidence_count) ?? 0;
    const scaleToZero = {
      state: zeroWorkerCount >= 2 ? "PROVEN_ZERO_WORKERS" : "NOT_PROVEN",
      worker_count: zeroWorkerCount >= 2 ? 0 : null,
      observed_at: timestampOrNull(zeroWorkerRow?.observed_at),
      evidence_id: zeroWorkerCount >= 2 ? String(zeroWorkerRow?.generation_request_id ?? "") : null,
      detail:
        zeroWorkerCount >= 2
          ? "Both qualified lanes have exact zero-worker and zero-queued-job observations."
          : "No current two-lane zero-worker proof is persisted for this project.",
    };
    const qualityFlags = [
      ...(detail.failedTasks as Record<string, unknown>[]).map((task) => ({
        id: String(task.id),
        asset_id: null,
        category: String(task.lane ?? "GENERATION"),
        severity: "ERROR",
        status: String(task.state),
        message: `Generation task ${String(task.task_key)} is ${String(task.state)}.`,
        retryable: false,
        replacement_allowed: false,
      })),
      ...serverlessAttempts
        .filter((attempt) =>
          ["RETRYABLE_FAILED", "PERMANENT_FAILED"].includes(String(attempt.state)),
        )
        .map((attempt) => ({
          id: String(attempt.id),
          asset_id: null,
          category: String(attempt.lane),
          severity: "ERROR",
          status: String(attempt.state),
          message: `The ${String(attempt.lane)} lane attempt is ${String(attempt.state)}.`,
          retryable: false,
          replacement_allowed: false,
        })),
    ];
    const sheet = await contactSheet(
      detail.serverlessOutputs as Record<string, unknown>[],
      environment.PRIVATE_ARTIFACTS,
      signer,
    );
    let downloadUrl: string | null = null;
    const reviewRow = detail.review as Record<string, unknown> | null;
    const manifestUrl = reviewRow ? `/api/v2/hosted/projects/${projectId}/manifest` : null;
    if (reviewRow) {
      const approvedAttempt = attempts.find(
        (value) => value.id === reviewRow.render_attempt_id && value.preview_url,
      );
      const outputObjectKey = approvedAttempt?.object_key;
      const outputLength = numberOrNull(approvedAttempt?.content_length);
      const outputChecksum = approvedAttempt?.output_checksum_sha256;
      if (
        typeof outputObjectKey === "string" &&
        outputLength !== null &&
        typeof outputChecksum === "string" &&
        SHA256.test(outputChecksum)
      ) {
        downloadUrl = (
          await signer.sign({
            method: "GET",
            objectKey: outputObjectKey,
            contentType: "video/mp4",
            contentLength: outputLength,
            checksumSha256: outputChecksum,
            lifetimeSeconds: 300,
            downloadFilename: "videoforge-output.mp4",
          })
        ).url;
      }
    }
    return response({
      schema_version: "videoforge-hosted-project-detail/v1",
      project: detail.project,
      attempts,
      gpu_transport: gpuReadiness.gpu_transport,
      gpu_readiness: gpuReadiness,
      generation:
        detail.generation === null
          ? null
          : {
              ...detail.generation,
              stage:
                Number(detail.generation.failed_tasks) > 0
                  ? "FAILED"
                  : Number(detail.generation.planned_tasks) > 0 &&
                      Number(detail.generation.completed_tasks) ===
                        Number(detail.generation.planned_tasks)
                    ? "READY_FOR_RENDER"
                    : gpuPendingState,
            },
      prompts: detail.prompts,
      prompt_progress: promptProgress,
      voiceover_context: voiceoverContext,
      queue,
      stages,
      timing,
      cost: {
        projected_usd: projectedCost,
        settled_usd: settledCost,
        cap_usd: capCost,
        billed_seconds: null,
        provider:
          serverlessAttempts.length > 0
            ? "runpod"
            : voiceoverContext || detail.prompts.length > 0
              ? "runware"
              : "personal-worker",
      },
      scale_to_zero: scaleToZero,
      review: {
        contact_sheet: sheet,
        quality_flags: qualityFlags,
        manifest_url: manifestUrl,
        download_url: downloadUrl,
      },
      contact_sheet: sheet,
      quality_flags: qualityFlags,
      manifest_url: manifestUrl,
    });
  } finally {
    await pool.end();
  }
}

async function approveReview(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const body = await parseHostedJson(request, "REVIEW_REJECTED", 4_096);
    if (body instanceof Response) return body;
    const attemptId = (body as { attempt_id?: unknown } | null)?.attempt_id;
    if (typeof attemptId !== "string" || !UUID.test(attemptId))
      return response({ error: { code: "REVIEW_REJECTED" } }, 400);
    const approved = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{ checksum: string }>(
        `SELECT authority.issued_checksum_sha256 AS checksum
           FROM hosted_cpu_job_attempts AS attempt
           JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
            AND authority.source = 'PRIMARY_RESULT_OUTPUT'
            AND authority.issued_at IS NOT NULL
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.project_id = $3 AND attempt.id = $4
            AND attempt.kind = 'RENDER' AND attempt.state = 'SUCCEEDED'
            AND attempt.retention_deleted_at IS NULL`,
        [scope.account_id, scope.workspace_id, projectId, attemptId],
      );
      const target = result.rows[0];
      if (!target) return null;
      await transaction.query(
        `INSERT INTO hosted_project_reviews (
           id, account_id, workspace_id, project_id, render_attempt_id,
           output_checksum_sha256, approved_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (account_id, workspace_id, project_id, render_attempt_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          scope.account_id,
          scope.workspace_id,
          projectId,
          attemptId,
          target.checksum,
          scope.user_id,
        ],
      );
      return target;
    });
    if (!approved) return response({ error: { code: "REVIEW_CANDIDATE_NOT_FOUND" } }, 404);
    return response({
      schema_version: "videoforge-hosted-review/v1",
      state: "APPROVED",
      attempt_id: attemptId,
    });
  } finally {
    await pool.end();
  }
}

async function usage(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const data = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<Record<string, unknown>>(
        `SELECT count(*) AS attempts,
                count(*) FILTER (WHERE state = 'SUCCEEDED') AS succeeded,
                count(*) FILTER (WHERE state = 'FAILED') AS failed,
                COALESCE(sum(EXTRACT(EPOCH FROM (terminal_at - submitted_at)))
                  FILTER (WHERE terminal_at IS NOT NULL AND submitted_at IS NOT NULL), 0) AS worker_seconds,
                COALESCE(sum(authority.issued_content_length)
                  FILTER (WHERE attempt.state = 'SUCCEEDED' AND attempt.retention_deleted_at IS NULL
                          AND authority.source = 'PRIMARY_RESULT_OUTPUT'), 0) AS retained_bytes
           FROM hosted_cpu_job_attempts AS attempt
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.created_at >= date_trunc('month', now())`,
        [scope.account_id, scope.workspace_id],
      );
      return result.rows[0] ?? {};
    });
    return response({
      schema_version: "videoforge-hosted-usage/v1",
      current_month_provider_cpu_usd: 0,
      current_month_gpu_usd: 0,
      attempts: Number(data.attempts ?? 0),
      succeeded: Number(data.succeeded ?? 0),
      failed: Number(data.failed ?? 0),
      personal_worker_seconds: Math.round(Number(data.worker_seconds ?? 0)),
      retained_bytes: Number(data.retained_bytes ?? 0),
      storage_policy: "DURABLE_UNTIL_EXPLICIT_DELETE",
      excluded_costs: ["USER_ELECTRICITY", "R2_ACCOUNT_BILL", "FUTURE_RUNWARE", "FUTURE_RUNPOD"],
    });
  } finally {
    await pool.end();
  }
}

export async function handleHostedProductRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/project-catalog")
    return catalog(request, config, executionContext);
  const avatarPreviewPath = /^\/api\/v2\/hosted\/avatars\/([0-9a-f-]+)\/preview$/u.exec(
    url.pathname,
  );
  if (request.method === "GET" && avatarPreviewPath)
    return hostedPresetPreview(
      request,
      "avatar",
      avatarPreviewPath[1]!,
      environment,
      config,
      executionContext,
    );
  const stylePreviewPath = /^\/api\/v2\/hosted\/styles\/([0-9a-f-]+)\/preview$/u.exec(url.pathname);
  if (request.method === "GET" && stylePreviewPath)
    return hostedPresetPreview(
      request,
      "style",
      stylePreviewPath[1]!,
      environment,
      config,
      executionContext,
    );
  const avatarArchivePath = /^\/api\/v2\/hosted\/avatars\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (request.method === "DELETE" && avatarArchivePath)
    return archiveHostedPreset(request, "AVATAR", avatarArchivePath[1]!, config, executionContext);
  const styleArchivePath = /^\/api\/v2\/hosted\/styles\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (request.method === "DELETE" && styleArchivePath)
    return archiveHostedPreset(
      request,
      "IMAGE_STYLE",
      styleArchivePath[1]!,
      config,
      executionContext,
    );
  if (request.method === "POST" && url.pathname === "/api/v2/hosted/avatars")
    return avatarCreate(request, environment, config, executionContext);
  const avatarCommitPath = /^\/api\/v2\/hosted\/avatars\/([0-9a-f-]+)\/commit$/u.exec(url.pathname);
  if (request.method === "POST" && avatarCommitPath)
    return avatarCommit(request, avatarCommitPath[1]!, environment, config, executionContext);
  const avatarApprovePath = /^\/api\/v2\/hosted\/avatars\/([0-9a-f-]+)\/approve$/u.exec(
    url.pathname,
  );
  if (request.method === "POST" && avatarApprovePath)
    return avatarApprove(request, avatarApprovePath[1]!, config, executionContext);
  if (request.method === "POST" && url.pathname === "/api/v2/hosted/styles")
    return styleCreate(request, environment, config, executionContext);
  const styleReferenceReplacePath =
    /^\/api\/v2\/hosted\/styles\/([0-9a-f-]+)\/references\/retry$/u.exec(url.pathname);
  if (request.method === "POST" && styleReferenceReplacePath)
    return styleReferenceReplace(
      request,
      styleReferenceReplacePath[1]!,
      environment,
      config,
      executionContext,
    );
  const styleCommitPath = /^\/api\/v2\/hosted\/styles\/([0-9a-f-]+)\/commit$/u.exec(url.pathname);
  if (request.method === "POST" && styleCommitPath)
    return styleCommit(request, styleCommitPath[1]!, environment, config, executionContext);
  const styleAnalyzePath = /^\/api\/v2\/hosted\/styles\/([0-9a-f-]+)\/analyze$/u.exec(url.pathname);
  if (request.method === "POST" && styleAnalyzePath)
    return styleAnalyze(request, styleAnalyzePath[1]!, environment, config, executionContext);
  const stylePublishPath = /^\/api\/v2\/hosted\/styles\/([0-9a-f-]+)\/publish$/u.exec(url.pathname);
  if (request.method === "POST" && stylePublishPath)
    return stylePublish(request, stylePublishPath[1]!, config, executionContext);
  if (request.method === "POST" && url.pathname === "/api/v2/hosted/projects/preflight")
    return projectPreflight(request, config, executionContext);
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/projects")
    return projects(request, config, executionContext);
  if (request.method === "POST" && url.pathname === "/api/v2/hosted/projects")
    return createProject(request, environment, config, executionContext);
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/usage")
    return usage(request, config, executionContext);
  const commit = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/commit$/u.exec(url.pathname);
  if (request.method === "POST" && commit)
    return commitProject(request, commit[1]!, environment, config, executionContext);
  const render = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/render$/u.exec(url.pathname);
  if (request.method === "POST" && render)
    return renderHandoff(request, render[1]!, environment, config, executionContext);
  const context = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/context$/u.exec(url.pathname);
  if (request.method === "POST" && context)
    return createVoiceoverContext(request, context[1]!, environment, config, executionContext);
  const reconcileContext = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/reconcile-context$/u.exec(
    url.pathname,
  );
  if (request.method === "POST" && reconcileContext)
    return reconcileVoiceoverContext(
      request,
      reconcileContext[1]!,
      environment,
      config,
      executionContext,
    );
  const prompts = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/prompts$/u.exec(url.pathname);
  if (request.method === "POST" && prompts)
    return writeProjectPrompts(request, prompts[1]!, config, executionContext);
  const asr = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/asr$/u.exec(url.pathname);
  if (request.method === "POST" && asr)
    return asrHandoff(request, asr[1]!, config, executionContext);
  const retry = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/retry$/u.exec(url.pathname);
  if (request.method === "POST" && retry)
    return retryProjectAttempt(request, retry[1]!, config, executionContext);
  const review = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/review$/u.exec(url.pathname);
  if (request.method === "POST" && review)
    return approveReview(request, review[1]!, config, executionContext);
  const manifest = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/manifest$/u.exec(url.pathname);
  if (request.method === "GET" && manifest)
    return projectManifest(request, manifest[1]!, config, executionContext);
  const detail = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (request.method === "DELETE" && detail)
    return archiveHostedProject(request, detail[1]!, config, executionContext);
  if (request.method === "GET" && detail)
    return projectDetail(request, detail[1]!, environment, config, executionContext);
  return null;
}
