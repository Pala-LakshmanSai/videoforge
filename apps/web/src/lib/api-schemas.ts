import { fixtureRuntimeProfileSet, parseExecutionProfileCatalog } from "@videoforge/config";
import { z } from "zod";

import {
  scenarioIds,
  type AvatarProfile,
  type ExecutionProfileCatalog,
  type FixtureBootstrap,
  type HealthResponse,
  type ImageStyle,
  type ProjectDetail,
  type ProjectSummary,
  type RegisteredVoiceover,
  type UsageSummary,
} from "./types";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_VERSION_TOKEN = /^"vf-[A-Za-z0-9._:-]+-v[1-9][0-9]*"$/u;
const AVATAR_FIXTURE_PATH = /^\/fixtures\/avatar\/[a-z0-9][a-z0-9._-]*\.svg$/u;
const STYLE_FIXTURE_PATH = /^\/fixtures\/styles\/[a-z0-9][a-z0-9._-]*\.svg$/u;
const MEDIA_FIXTURE_PATH = /^\/fixtures\/media\/[a-z0-9][a-z0-9._-]*\.(?:mp4|svg)$/u;
const MEDIA_PREVIEW_PATH = /^\/api\/v1\/projects\/[A-Za-z0-9._:-]+\/preview$/u;
const FIXTURE_DOWNLOAD_PATH =
  /^\/api\/v1\/projects\/[A-Za-z0-9._:-]+\/download\?fixture=[a-z0-9_]+$/u;
const LOCAL_DOWNLOAD_PATH = /^\/api\/v1\/projects\/[A-Za-z0-9._:-]+\/download$/u;
const FIXTURE_VOICEOVER_ASSET = /^fixture_voiceover_sha256_([a-f0-9]{64})$/u;
const VOICEOVER_FILENAME = /^[^/\\\0]+\.(?:aac|flac|m4a|mp3|wav)$/iu;
const ARTIFACT_FILENAME = /^[^/\\\0]+$/u;

const scenarioSchema = z.enum(scenarioIds);
const noticeSchema = z
  .object({
    tone: z.enum(["INFO", "SUCCESS", "WARNING", "ERROR"]),
    title: z.string(),
    detail: z.string(),
    action: z.string().nullable(),
    scope: z.enum(["ACCESS", "AVATAR", "CREATE", "PROJECT", "STYLE"]),
  })
  .strict();

const avatarSchema = z
  .object({
    id: z.string(),
    versionId: z.string(),
    name: z.string(),
    initials: z.string(),
    version: z.number().int().positive(),
    status: z.enum(["READY", "VALIDATING", "NEEDS_REVIEW", "FAILED", "ARCHIVED"]),
    compatibility: z.enum(["UNTESTED", "RUNNING", "PASSED", "FAILED", "STALE", "CANCELLED"]),
    dimensions: z.string(),
    lastUsed: z.string(),
    thumbnailUrl: z.string().regex(AVATAR_FIXTURE_PATH),
    profileHash: z.string().regex(SHA256),
    preparationProfile: z.string(),
    validationProfile: z.string(),
    rightsStatus: z.literal("ATTESTED"),
    activeVersion: z.number().int().nonnegative(),
    selectedVersion: z.number().int().positive(),
    warning: z.string().nullable(),
  })
  .strict();

const imageStyleSchema = z
  .object({
    id: z.string(),
    versionId: z.string(),
    name: z.string(),
    summary: z.string(),
    version: z.number().int().positive(),
    status: z.enum(["PUBLISHED", "ANALYZING", "NEEDS_REVIEW", "FAILED", "ARCHIVED"]),
    referenceCount: z.number().int().nonnegative(),
    isDefault: z.boolean().optional(),
    palette: z.tuple([z.string(), z.string()]),
    coverUrl: z.string().regex(STYLE_FIXTURE_PATH),
    referenceUrls: z.array(z.string().regex(STYLE_FIXTURE_PATH)),
    exampleUrls: z.array(z.string().regex(STYLE_FIXTURE_PATH)),
    profileHash: z.string().regex(SHA256),
    medium: z.string(),
    lighting: z.string(),
    color: z.string(),
    texture: z.string(),
    rightsStatus: z.enum(["ATTESTED", "SYSTEM_OWNED"]),
    retentionSummary: z.string(),
    activeVersion: z.number().int().nonnegative(),
    draftVersion: z.number().int().positive().nullable(),
    draftStatus: z.enum(["DRAFT", "ANALYZING", "NEEDS_REVIEW", "FAILED"]).nullable(),
    warning: z.string().nullable(),
  })
  .strict();

const projectStageSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    status: z.enum([
      "PENDING",
      "QUEUED",
      "STARTING",
      "RUNNING",
      "RETRYING",
      "BLOCKED",
      "FAILED",
      "CANCEL_REQUESTED",
      "CANCELLED",
      "COMPLETE",
    ]),
    completed: z.number().nonnegative(),
    total: z.number().nonnegative(),
    detail: z.string(),
  })
  .strict();

const projectSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    owner: z.string(),
    status: z.enum([
      "DRAFT",
      "QUEUED",
      "RUNNING",
      "NEEDS_ATTENTION",
      "RECONCILING",
      "CANCEL_REQUESTED",
      "FAILED",
      "CANCELLED",
      "READY_FOR_REVIEW",
      "APPROVED",
    ]),
    stage: z.string(),
    completed: z.number().nonnegative(),
    total: z.number().nonnegative(),
    eta: z.string(),
    mode: z.enum(["LOWEST_COST", "BALANCED", "FASTER"]),
    estimatedCost: z.number().nonnegative(),
    actualCost: z.number().nonnegative(),
    queuePosition: z.number().int().positive().nullable(),
    createdAt: z.string(),
    stages: z.array(projectStageSchema),
    revisionId: z.string(),
    versionToken: z.string().regex(PROJECT_VERSION_TOKEN),
    pins: z
      .object({
        avatarProfileVersionId: z.string().nullable(),
        imageStyleVersionId: z.string(),
      })
      .strict(),
    capUsd: z.number().nonnegative(),
    lanes: z
      .object({
        image: z
          .object({
            state: z.string(),
            completed: z.number().nonnegative(),
            total: z.number().nonnegative(),
            action: z.string(),
          })
          .strict(),
        avatar: z
          .object({
            state: z.string(),
            completed: z.number().nonnegative(),
            total: z.number().nonnegative(),
            action: z.string(),
          })
          .strict(),
      })
      .strict(),
    latestArtifact: z
      .object({
        kind: z.enum(["IMAGE", "AVATAR_CLIP", "VIDEO"]),
        url: z.union([z.string().regex(MEDIA_FIXTURE_PATH), z.string().regex(MEDIA_PREVIEW_PATH)]),
        label: z.string(),
        sha256: z.string().regex(SHA256).optional(),
        bytes: z.number().int().positive().optional(),
        filename: z.string().min(1).max(240).regex(ARTIFACT_FILENAME).optional(),
      })
      .strict()
      .nullable(),
    review: z
      .object({
        candidateId: z.string().nullable(),
        candidateSha256: z.string().regex(SHA256).nullable(),
        state: z.enum(["NOT_READY", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED"]),
        flaggedDefect: z.enum(["LIP_SYNC_ONLY", "WHOLE_FRAME", "IMAGE_QUALITY"]).nullable(),
        selectedAvatarClipId: z.string().nullable(),
        downloadUrl: z
          .union([z.string().regex(FIXTURE_DOWNLOAD_PATH), z.string().regex(LOCAL_DOWNLOAD_PATH)])
          .nullable(),
      })
      .strict(),
    allowedActions: z.array(
      z.enum(["APPROVE", "APPROVE_FALLBACK", "CANCEL", "DOWNLOAD", "RETRY_FAILED_ITEMS", "REVIEW"]),
    ),
  })
  .strict();

const usageSchema = z
  .object({
    currentMonth: z.number().nonnegative(),
    projectSpend: z.number().nonnegative(),
    styleSpend: z.number().nonnegative(),
    avatarTestSpend: z.number().nonnegative(),
    storageGb: z.number().nonnegative(),
    gpuSeconds: z.number().nonnegative(),
    retries: z.number().int().nonnegative(),
  })
  .strict();

const fixtureDraftSchema = z
  .object({
    title: z.string(),
    voiceover: z
      .object({
        assetId: z.string().nullable(),
        filename: z.string().nullable(),
        durationSeconds: z.number().nonnegative().nullable(),
        uploadState: z.enum(["EMPTY", "UPLOADING", "VERIFIED", "FAILED"]),
      })
      .strict(),
    avatarProfileVersionId: z.string().nullable(),
    imageStyleVersionId: z.string(),
    optionalScript: z.string().nullable(),
    extraPromptKeywords: z.string().nullable(),
    applyExtraPromptKeywords: z.boolean(),
    effectiveExtraPromptKeywords: z.string().nullable(),
    generationMode: z.enum(["LOWEST_COST", "BALANCED", "FASTER"]),
    spendCapUsd: z.number().nonnegative(),
    preservedAcrossPresetRoundtrip: z.boolean(),
    returnRoute: z.string().nullable(),
    preflight: z
      .object({
        status: z.enum(["PENDING", "READY", "BLOCKED"]),
        checks: z.array(
          z
            .object({
              id: z.string(),
              label: z.string(),
              state: z.enum(["PENDING", "PASS", "WARN", "BLOCK"]),
              message: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

const bootstrapSchema = z
  .object({
    scenario: scenarioSchema,
    access: z
      .object({
        state: z.enum(["AUTHORIZED", "SIGN_IN_REQUIRED", "DENIED"]),
        selectedAccount: z
          .object({ displayName: z.string(), email: z.string() })
          .strict()
          .nullable(),
        workspaceName: z.string(),
        adminContact: z.string(),
        reason: z.string().nullable(),
      })
      .strict(),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.enum(["ADMIN", "MEMBER"]),
        invited: z.boolean(),
      })
      .strict(),
    projects: z.array(projectSummarySchema),
    avatars: z.array(avatarSchema),
    styles: z.array(imageStyleSchema),
    usage: usageSchema,
    draft: fixtureDraftSchema,
    notice: noticeSchema.nullable(),
    activeOperations: z
      .object({ avatar: z.string().nullable(), style: z.string().nullable() })
      .strict(),
  })
  .strict();

const projectDetailSchema = z
  .object({
    project: projectSummarySchema,
    events: z.array(z.object({ id: z.string(), detail: z.string(), at: z.string() }).strict()),
    notice: noticeSchema.nullable(),
  })
  .strict();

const healthFields = {
  app: z.literal("videoforge"),
  status: z.literal("ok"),
  commit: z.string(),
  synthetic: z.literal(true),
  provider_calls_authorized: z.literal(false),
  authorized_spend_usd: z.literal(0),
};

const healthSchema = z.discriminatedUnion("mode", [
  z.object({ ...healthFields, mode: z.literal("fixture"), fixture_id: scenarioSchema }).strict(),
  z.object({ ...healthFields, mode: z.literal("local"), fixture_id: z.null() }).strict(),
]);

const registeredVoiceoverSchema = z
  .object({
    assetId: z.string().regex(FIXTURE_VOICEOVER_ASSET),
    checksum: z.string().regex(SHA256),
    filename: z.string().min(1).max(240).regex(VOICEOVER_FILENAME),
    durationSeconds: z.number().min(10).max(3_600),
    sampleRate: z.number().int().min(8_000).max(192_000),
    channels: z.union([z.literal(1), z.literal(2)]),
    verificationState: z.literal("VERIFIED"),
    persistedBytes: z.boolean(),
    providerCallsAuthorized: z.literal(false),
  })
  .strict()
  .superRefine((voiceover, context) => {
    const digest = FIXTURE_VOICEOVER_ASSET.exec(voiceover.assetId)?.[1];
    if (!digest || voiceover.checksum !== `sha256:${digest}`) {
      context.addIssue({
        code: "custom",
        path: ["checksum"],
        message: "Voiceover asset handle and checksum do not match",
      });
    }
  });

const projectPreflightMutationSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("READY"),
    fixture: scenarioSchema,
    avatarProfileVersionId: z.string(),
    imageStyleVersionId: z.string(),
    estimatedCostUsd: z.number().nonnegative(),
    spendCapUsd: z.number().nonnegative(),
    providerCallsAuthorized: z.literal(false),
  })
  .strict();

const projectCreateMutationSchema = z
  .object({
    ok: z.literal(true),
    id: z.string(),
    revisionId: z.string(),
    status: z.literal("QUEUED"),
    fixture: scenarioSchema,
    nextFixture: scenarioSchema,
    pins: z
      .object({
        avatarProfileVersionId: z.string(),
        imageStyleVersionId: z.string(),
      })
      .strict(),
    providerCallsAuthorized: z.literal(false),
    versionToken: z.string().regex(PROJECT_VERSION_TOKEN),
  })
  .strict();

const avatarCreateMutationSchema = z
  .object({
    ok: z.literal(true),
    avatarProfile: avatarSchema,
    lifecycle: z.object({ profile: z.literal("ACTIVE"), version: z.literal("READY") }).strict(),
    immutableVersion: z.literal(true),
    uploadedBytesPersisted: z.literal(false),
    providerCallsAuthorized: z.literal(false),
  })
  .strict();

const imageStyleCreateMutationSchema = z
  .object({
    ok: z.literal(true),
    imageStyle: imageStyleSchema,
    lifecycle: z.object({ style: z.literal("ACTIVE"), version: z.literal("PUBLISHED") }).strict(),
    immutableVersion: z.literal(true),
    uploadedBytesPersisted: z.literal(false),
    providerCallsAuthorized: z.literal(false),
  })
  .strict();

const voiceoverRegistrationMutationSchema = z
  .object({ ok: z.literal(true), voiceover: registeredVoiceoverSchema, synthetic: z.literal(true) })
  .strict();

export const parseHealthResponse = (value: unknown): HealthResponse => healthSchema.parse(value);
export const parseBootstrapResponse = (value: unknown): FixtureBootstrap =>
  bootstrapSchema.parse(value) as FixtureBootstrap;
export const parseProjectsResponse = (value: unknown): ProjectSummary[] =>
  z.array(projectSummarySchema).parse(value) as ProjectSummary[];
export const parseProjectResponse = (value: unknown): ProjectDetail =>
  projectDetailSchema.parse(value) as ProjectDetail;
export const parseAvatarsResponse = (value: unknown): AvatarProfile[] =>
  z.array(avatarSchema).parse(value) as AvatarProfile[];
export const parseStylesResponse = (value: unknown): ImageStyle[] =>
  z.array(imageStyleSchema).parse(value) as ImageStyle[];
export const parseUsageResponse = (value: unknown): UsageSummary => usageSchema.parse(value);
export const parseExecutionProfilesResponse = (value: unknown): ExecutionProfileCatalog =>
  parseExecutionProfileCatalog(value, fixtureRuntimeProfileSet);
export const parseRegisteredVoiceoverResponse = (value: unknown): RegisteredVoiceover =>
  registeredVoiceoverSchema.parse(value) as RegisteredVoiceover;
export const parseProjectPreflightMutationResponse = (value: unknown) =>
  projectPreflightMutationSchema.parse(value);
export const parseProjectCreateMutationResponse = (value: unknown) =>
  projectCreateMutationSchema.parse(value);
export const parseAvatarCreateMutationResponse = (value: unknown) =>
  avatarCreateMutationSchema.parse(value);
export const parseImageStyleCreateMutationResponse = (value: unknown) =>
  imageStyleCreateMutationSchema.parse(value);
export const parseVoiceoverRegistrationMutationResponse = (value: unknown) =>
  voiceoverRegistrationMutationSchema.parse(value);
export const parseMutationResponse = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
