import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileAudio,
  ImagePlus,
  Images,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageStyleHubVersionResponse } from "@videoforge/contracts/image-style-hub";
import { PageHeader } from "../components/PageHeader";
import {
  ProjectMediaReview,
  type ProjectMediaReviewHasMore,
  type ProjectMediaReviewItem,
  type ProjectMediaReviewTotals,
} from "../components/ProjectMediaReview";
import {
  Badge,
  Button,
  DetailsSheet,
  Disclosure,
  EmptyState,
  Metric,
  Panel,
  ProgressBar,
  ProgressRing,
  StageTimeline,
} from "../components/ui";
import { PresetImage } from "../features/presets/PresetImage";
import { VisualPresetSelect } from "../features/project-create/VisualPresetSelect";
import {
  normalizeImageStyleReference,
  type NormalizedStyleReference,
} from "../lib/media-validation";
import { isHostedProviderMode } from "./provider-mode";
import type { ProjectStage } from "../lib/types";

const MAX_VOICEOVER_BYTES = 1_073_741_824;
const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
const MAX_STYLE_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_STYLE_ANALYSIS_BYTES = 30 * 1024 * 1024;
const MAX_STYLE_REFERENCES = 8;
const MIN_STYLE_REFERENCES = 3;
export const HOSTED_UPLOAD_TIMEOUT_MS = 300_000;
const HOSTED_CREATE_SCHEMA = "videoforge-hosted-project-create/v2";
const VOICEOVER_TYPES = new Set(["audio/mpeg", "audio/wav"]);
const MAX_HOSTED_VOICEOVER_FILENAME = 160;
export const HOSTED_SHA256_CHUNK_BYTES = 4 * 1024 * 1024;

export function hostedVoiceoverFilename(
  filename: string,
  contentType: string,
  checksumSha256: string,
): string {
  const serverSafe =
    filename.length >= 1 &&
    filename.length <= MAX_HOSTED_VOICEOVER_FILENAME &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    [...filename].every((character) => character.charCodeAt(0) >= 32);
  if (serverSafe) return filename;
  const extension = contentType === "audio/wav" ? "wav" : "mp3";
  return `voiceover-${checksumSha256.slice("sha256:".length, "sha256:".length + 16)}.${extension}`;
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length * 3) / 4 - padding;
}

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export interface CatalogResponse {
  readonly avatars: readonly {
    profile_id: string;
    version_id: string;
    name: string;
    version_number: number;
    state?: string;
    status?: string;
    thumbnail_url?: string | null;
    profile_hash?: string | null;
    compatibility?: string | null;
    rights_status?: string | null;
    scope_kind?: "WORKSPACE" | "SYSTEM";
    /** False when this version's runtime source cannot be read by the avatar-video lane. */
    avatar_video_source_ready?: boolean;
  }[];
  /** Workspace-owned versions that still need source upload, review, or approval. */
  readonly avatar_drafts?: readonly HostedAvatarDraft[];
  readonly styles: readonly {
    style_id: string;
    version_id: string;
    name: string;
    version_number: number;
    state?: string;
    status?: string;
    cover_url?: string | null;
    profile_hash?: string | null;
    reference_count?: number;
    reference_urls?: readonly string[];
    profile?: Record<string, unknown> | null;
    scope_kind?: "WORKSPACE" | "SYSTEM";
  }[];
  /** Workspace-owned style versions that are not published yet. */
  readonly style_drafts?: readonly HostedStyleDraft[];
  readonly media_worker_state: "ONLINE" | "WAITING_FOR_YOUR_COMPUTER";
  readonly generation_provider?: "KIE_FAL" | "RUNPOD";
  readonly gpu_transport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
  readonly gpu_readiness: {
    readonly schema_version: "videoforge-hosted-gpu-readiness/v1";
    readonly gpu_transport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
    readonly provider_calls_authorized: boolean;
    readonly dispatch_available: boolean;
    readonly lanes: readonly {
      readonly lane: "MAGE_IMAGE" | "SOULX_AVATAR";
      readonly checkpoint: "V2-07" | "V2-08";
      readonly qualification: "NOT_QUALIFIED" | "QUALIFIED_EXACT";
      readonly visual_approval: "NOT_APPLICABLE" | "APPROVED_EXACT_FULL_AND_SPLIT";
      readonly provider_free_groundwork_commits: readonly string[];
      readonly missing_gates: readonly string[];
    }[];
  };
  readonly project_defaults?: {
    readonly generation_mode?: string;
    readonly user_seed?: number | null;
  };
}

interface HostedAvatarDraft {
  readonly profile_id: string;
  readonly version_id: string;
  readonly name: string;
  readonly version_number: number;
  readonly state?: string;
  readonly status?: string;
  readonly thumbnail_url?: string | null;
  readonly profile_hash?: string | null;
  readonly compatibility?: string | null;
  readonly rights_status?: string | null;
  readonly scope_kind?: "WORKSPACE";
  readonly source_verified?: boolean;
  readonly rights_attested?: boolean;
  readonly likeness_animation_consent?: boolean;
}

interface HostedStyleDraft {
  readonly style_id: string;
  readonly version_id: string;
  readonly name: string;
  readonly version_number: number;
  readonly state?: string;
  readonly status?: string;
  /** Terminal provider outcome is separate from immutable version lifecycle state. */
  readonly analysis_state?: "RESERVED" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | null;
  readonly cover_url?: string | null;
  readonly profile_hash?: string | null;
  readonly reference_count?: number;
  readonly scope_kind?: "WORKSPACE";
  readonly references_verified?: boolean;
  readonly profile?: Record<string, unknown> | null;
  readonly summary?: string | null;
  readonly analysis_cost_usd?: number | null;
  readonly rights_attested?: boolean;
  readonly processing_disclosure_acknowledged?: boolean;
  readonly original_retention_policy?: string | null;
}

interface HostedStyleProfileView {
  readonly summary: string | null;
  readonly medium: string | null;
  readonly realism: string | null;
  readonly subjectTreatment: string | null;
  readonly camera: string | null;
  readonly framing: string | null;
  readonly lighting: string | null;
  readonly colorDescriptors: readonly string[];
  readonly colorHex: readonly string[];
  readonly contrast: string | null;
  readonly depthOfField: string | null;
  readonly texture: string | null;
  readonly materials: string | null;
  readonly mood: readonly string[];
  readonly mustInclude: readonly string[];
  readonly mustAvoid: readonly string[];
  readonly flexible: readonly string[];
  readonly positivePrompt: string | null;
  readonly negativePrompt: string | null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function profileText(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function profileList(record: Record<string, unknown> | null, key: string): readonly string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function hostedStyleProfileView(value: unknown): HostedStyleProfileView | null {
  const profile = recordValue(value);
  const visual = recordValue(profile?.visual_profile);
  const color = recordValue(visual?.color);
  const prompt = recordValue(profile?.prompt_profile);
  if (!profile || !visual) return null;
  return {
    summary: profileText(profile, "summary"),
    medium: profileText(visual, "medium_family"),
    realism: profileText(visual, "realism"),
    subjectTreatment: profileText(visual, "subject_treatment"),
    camera: profileText(visual, "camera_language"),
    framing: profileText(visual, "image_framing"),
    lighting: profileText(visual, "lighting"),
    colorDescriptors: profileList(color, "descriptors"),
    colorHex: profileList(color, "approximate_hex").filter((item) => /^#[0-9a-f]{6}$/iu.test(item)),
    contrast: profileText(visual, "contrast_and_exposure"),
    depthOfField: profileText(visual, "depth_of_field"),
    texture: profileText(visual, "texture_and_grain"),
    materials: profileText(visual, "environment_and_material_detail"),
    mood: profileList(visual, "mood"),
    mustInclude: profileList(visual, "must_include"),
    mustAvoid: profileList(visual, "must_avoid"),
    flexible: profileList(visual, "flexible_properties"),
    positivePrompt: profileText(prompt, "positive_suffix"),
    negativePrompt: profileText(prompt, "negative_suffix"),
  };
}

function StyleProfileFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="style-profile-fact">
      <small>{label}</small>
      <p>{value}</p>
    </div>
  );
}

function StyleTraitList({
  label,
  values,
  tone = "neutral",
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly tone?: "neutral" | "positive" | "negative";
}) {
  if (values.length === 0) return null;
  return (
    <section className="style-trait-group">
      <h4>{label}</h4>
      <ul className={`style-trait-list style-trait-list-${tone}`}>
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
  );
}

function StyleProfileDetails({
  name,
  imageUrl,
  referenceUrls,
  referenceCount,
  profile,
}: {
  readonly name: string;
  readonly imageUrl: string | null;
  readonly referenceUrls: readonly string[];
  readonly referenceCount: number;
  readonly profile: HostedStyleProfileView | null;
}) {
  const images = referenceUrls.length > 0 ? referenceUrls : imageUrl ? [imageUrl] : [];
  const [referenceIndex, setReferenceIndex] = useState(0);
  useEffect(() => setReferenceIndex(0), [referenceUrls]);
  const currentImage = images[referenceIndex] ?? images[0] ?? null;
  const showCarouselControls = images.length > 1;
  const previousReference = () =>
    setReferenceIndex((index) => (index - 1 + images.length) % images.length);
  const nextReference = () => setReferenceIndex((index) => (index + 1) % images.length);
  return (
    <div className="style-profile-details">
      {currentImage ? (
        <div className="style-reference-carousel" aria-label={`${name} reference images`}>
          <PresetImage
            key={currentImage}
            src={currentImage}
            alt={`${name} reference ${referenceIndex + 1} of ${images.length}`}
          />
          {showCarouselControls ? (
            <>
              <button
                className="style-reference-arrow style-reference-arrow-previous"
                type="button"
                aria-label="Previous reference image"
                onClick={previousReference}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                className="style-reference-arrow style-reference-arrow-next"
                type="button"
                aria-label="Next reference image"
                onClick={nextReference}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </>
          ) : null}
          <span className="style-reference-position">
            {referenceIndex + 1} of {images.length}
          </span>
        </div>
      ) : null}
      <div className="detail-facts">
        <span>
          <small>Status</small>
          <strong>Published</strong>
        </span>
        <span>
          <small>Reference images</small>
          <strong>{referenceCount}</strong>
        </span>
      </div>
      {profile ? (
        <>
          {profile.summary ? (
            <section className="detail-section style-profile-summary">
              <p className="eyebrow">Analysis</p>
              <h3>Style summary</h3>
              <p>{profile.summary}</p>
            </section>
          ) : null}
          <Disclosure summary="Visual character">
            <section className="detail-section">
              <div className="style-profile-facts">
                <StyleProfileFact label="Medium" value={profile.medium} />
                <StyleProfileFact label="Realism" value={profile.realism} />
                <StyleProfileFact label="Subject treatment" value={profile.subjectTreatment} />
                <StyleProfileFact label="Camera" value={profile.camera} />
                <StyleProfileFact label="Framing" value={profile.framing} />
                <StyleProfileFact label="Lighting" value={profile.lighting} />
                <StyleProfileFact label="Contrast & exposure" value={profile.contrast} />
                <StyleProfileFact label="Depth of field" value={profile.depthOfField} />
                <StyleProfileFact label="Texture & grain" value={profile.texture} />
                <StyleProfileFact label="Materials & environment" value={profile.materials} />
              </div>
              {profile.colorDescriptors.length > 0 || profile.colorHex.length > 0 ? (
                <div className="style-color-profile">
                  <small>Color palette</small>
                  <div className="style-color-swatches" aria-label="Extracted color palette">
                    {profile.colorHex.map((color) => (
                      <span key={color} title={color} style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  {profile.colorDescriptors.length > 0 ? (
                    <p>{profile.colorDescriptors.join(" · ")}</p>
                  ) : null}
                </div>
              ) : null}
              <StyleTraitList label="Mood" values={profile.mood} />
            </section>
          </Disclosure>
          <Disclosure summary="Generation rules">
            <section className="detail-section">
              <StyleTraitList label="Keep" values={profile.mustInclude} tone="positive" />
              <StyleTraitList label="Avoid" values={profile.mustAvoid} tone="negative" />
              <StyleTraitList label="Can vary" values={profile.flexible} />
            </section>
          </Disclosure>
          {profile.positivePrompt || profile.negativePrompt ? (
            <details className="detail-section style-prompt-details">
              <summary>Generation prompt</summary>
              {profile.positivePrompt ? (
                <StyleProfileFact label="Add to image prompts" value={profile.positivePrompt} />
              ) : null}
              {profile.negativePrompt ? (
                <StyleProfileFact label="Avoid in image prompts" value={profile.negativePrompt} />
              ) : null}
            </details>
          ) : null}
        </>
      ) : (
        <div className="validation validation-warning">
          Style is ready; analysis summary unavailable.
        </div>
      )}
    </div>
  );
}

const GPU_READINESS_KEYS = [
  "dispatch_available",
  "gpu_transport",
  "lanes",
  "provider_calls_authorized",
  "schema_version",
] as const;
const GPU_LANE_KEYS = [
  "checkpoint",
  "lane",
  "missing_gates",
  "provider_free_groundwork_commits",
  "qualification",
  "visual_approval",
] as const;
const MAGE_GROUNDWORK_COMMITS = ["1283a23248c9b79832b6fb331b00474e1df70f81"] as const;
const MAGE_MISSING_GATES = ["identity_output", "cancellation_timeout", "max2_concurrency"] as const;
const SOULX_GROUNDWORK_COMMITS = [
  "7039092707103ab35e8010c009e14409a6e52f63",
  "84e00881d98e3e77dd8aad121453ed6e7287bc74",
  "e49b93854d58c4faeb8bdd10b9b9df07321026db",
  "f3557059d7d5f0637ea223b3e758389fbd80a52b",
] as const;
const SOULX_MISSING_GATES = [
  "V2_07_MAGE_QUALIFICATION",
  "V2_08_IMAGE_PUBLICATION_AND_ENDPOINT_CONFIGURATION",
  "V2_08_MAX1_LIVE_QUALIFICATION",
] as const;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isExactStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

export function isFailClosedGpuReadiness(
  value: unknown,
): value is CatalogResponse["gpu_readiness"] {
  if (!value || typeof value !== "object") return false;
  const readiness = value as Partial<CatalogResponse["gpu_readiness"]>;
  if (
    !hasExactKeys(readiness, GPU_READINESS_KEYS) ||
    readiness.schema_version !== "videoforge-hosted-gpu-readiness/v1" ||
    !["DISABLED_UNQUALIFIED", "QUALIFIED_EXACT"].includes(readiness.gpu_transport ?? "") ||
    !Array.isArray(readiness.lanes) ||
    readiness.lanes.length !== 2
  ) {
    return false;
  }
  const [mage, soulx] = readiness.lanes;
  const lanesExact = Boolean(
    mage &&
      hasExactKeys(mage, GPU_LANE_KEYS) &&
      mage.lane === "MAGE_IMAGE" &&
      mage.checkpoint === "V2-07" &&
      mage.visual_approval === "NOT_APPLICABLE" &&
      isExactStringArray(mage.provider_free_groundwork_commits, MAGE_GROUNDWORK_COMMITS) &&
      soulx &&
      hasExactKeys(soulx, GPU_LANE_KEYS) &&
      soulx.lane === "SOULX_AVATAR" &&
      soulx.checkpoint === "V2-08" &&
      soulx.visual_approval === "APPROVED_EXACT_FULL_AND_SPLIT" &&
      isExactStringArray(soulx.provider_free_groundwork_commits, SOULX_GROUNDWORK_COMMITS),
  );
  if (!lanesExact || !mage || !soulx) return false;
  if (readiness.gpu_transport === "QUALIFIED_EXACT") {
    return (
      readiness.provider_calls_authorized === true &&
      readiness.dispatch_available === true &&
      mage.qualification === "QUALIFIED_EXACT" &&
      soulx.qualification === "QUALIFIED_EXACT" &&
      isExactStringArray(mage.missing_gates, []) &&
      isExactStringArray(soulx.missing_gates, [])
    );
  }
  return (
    readiness.provider_calls_authorized === false &&
    readiness.dispatch_available === false &&
    mage.qualification === "NOT_QUALIFIED" &&
    soulx.qualification === "NOT_QUALIFIED" &&
    isExactStringArray(mage.missing_gates, MAGE_MISSING_GATES) &&
    isExactStringArray(soulx.missing_gates, SOULX_MISSING_GATES)
  );
}

async function readHostedCatalog(): Promise<CatalogResponse> {
  const catalog = await readJson<CatalogResponse>("/api/v2/hosted/project-catalog");
  if (
    !isFailClosedGpuReadiness(catalog.gpu_readiness) ||
    catalog.gpu_transport !== catalog.gpu_readiness.gpu_transport
  ) {
    throw new Error("Hosted GPU readiness is unavailable.");
  }
  return catalog;
}

interface HostedAttempt {
  readonly id: string;
  readonly kind: "ASR" | "SPAN_AUDIO" | "RENDER" | "MAGE_IMAGE" | "SOULX_AVATAR";
  readonly state: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly terminal_at: string | null;
  readonly output_checksum_sha256: string | null;
  readonly approved_at: string | null;
  readonly preview_url: string | null;
  readonly error_code?: string | null;
  readonly error_message?: string | null;
  readonly retry_of_attempt_id?: string | null;
  readonly asset_id?: string | null;
  readonly progress_percent?: number | null;
  readonly queue_position?: number | null;
  readonly timing?: HostedTiming | null;
  readonly cost?: HostedCost | null;
}

function cancellableAttemptLabel(kind: HostedAttempt["kind"]): string {
  if (kind === "ASR") return "transcription";
  if (kind === "SPAN_AUDIO") return "audio preparation";
  return "assembly";
}

function hostedContinuationKey(
  revisionId: string | undefined,
  entityId: string | null | undefined,
): string | null {
  return revisionId && entityId ? `${revisionId}:${entityId}` : null;
}

export function transcriptionFailureMessage(code: string | null | undefined): string {
  if (code === "MEDIA_EXECUTION_SUBPROCESS_FAILED") {
    return "Your computer's local transcription process stopped unexpectedly after one bounded recovery attempt. Update the personal media worker before retrying.";
  }
  if (code === "MEDIA_EXECUTION_FAILED") {
    return "Your computer's local transcription process stopped unexpectedly. Update the personal media worker before retrying.";
  }
  if (code === "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT") {
    return "Your project and voiceover are safe. Free disk space on your connected computer before retrying transcription.";
  }
  if (code === "MEDIA_EXECUTION_IO_FAILED") {
    return "The local media worker could not read or save the transcription data. Free disk space and update the personal media worker before retrying.";
  }
  if (code === "MEDIA_EXECUTION_CONTRACT_INVALID" || code === "ASR_RESULT_INVALID") {
    return "The local media worker returned an invalid transcription result. Update the personal media worker before retrying.";
  }
  return "Your project and voiceover are safe. Update the personal media worker before retrying.";
}

interface HostedTiming {
  readonly queue_wait_ms?: number | null;
  readonly initialization_ms?: number | null;
  readonly model_ready_ms?: number | null;
  readonly inference_ms?: number | null;
  readonly upload_ms?: number | null;
  readonly render_ms?: number | null;
  readonly end_to_end_ms?: number | null;
}

interface HostedTimeEstimate {
  readonly remaining_min_ms: number;
  readonly remaining_max_ms: number;
  readonly basis: "RECENT_API_SHORT_RUN";
  readonly overrun: boolean;
}

interface HostedCost {
  readonly projected_usd?: number | null;
  readonly settled_usd?: number | null;
  readonly cap_usd?: number | null;
  readonly billed_seconds?: number | null;
  readonly provider?: string | null;
  readonly api_estimate?: {
    readonly kie_images: number;
    readonly kie_usd: number;
    readonly fal_avatar_seconds: number;
    readonly fal_usd: number;
    readonly pricing_checked_at: string;
  } | null;
}

interface HostedQueueSnapshot {
  readonly position?: number | null;
  readonly ahead?: number | null;
  readonly total?: number | null;
  readonly status?: string | null;
  readonly estimated_wait_ms?: number | null;
  readonly fair_rotation?: string | null;
}

interface HostedStage {
  readonly id?: string;
  readonly name: string;
  readonly status: string;
  readonly progress_percent?: number | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly detail?: string | null;
  readonly eta_ms?: number | null;
}

type HostedCount = number | string | null | undefined;

const HOSTED_ACTIVE_STAGE_STATUSES = new Set([
  "QUEUED",
  "IN_QUEUE",
  "WAITING_FOR_GPUS",
  "STARTING",
  "RUNNING",
  "RETRYING",
  "PREPARING",
  "ACTIVE",
  "ADMITTED",
  "ASSIGNED",
  "OUTBOXED",
  "SUBMITTED",
  "RECONCILING",
  "CANCEL_REQUESTED",
]);
const HOSTED_ACTIVE_ATTEMPT_STATES = new Set([
  "OUTBOXED",
  "IN_QUEUE",
  "WAITING_FOR_GPU",
  "WAITING_FOR_GPUS",
  "WAITING_FOR_WORKER",
  "ASSIGNED",
  "SUBMITTED",
  "RUNNING",
  "RECONCILING",
  "CANCEL_REQUESTED",
]);
const HOSTED_GENERATION_STAGE_IDS = new Set([
  "image-generation",
  "avatar-generation",
  "render",
]);
const CPU_CANCEL_CONFIRMATION_MS = 5_000;
const HOSTED_TERMINAL_STAGE_STATUSES = new Set([
  "FAILED",
  "ACTION_REQUIRED",
  "BLOCKED",
  "CANCELLED",
]);

const HOSTED_IMAGE_REGENERATION_POLL_MS = 500;
const HOSTED_IMAGE_REGENERATION_TIMEOUT_MS = 10 * 60_000;

type HostedTerminalStageStatus = "FAILED" | "ACTION_REQUIRED" | "BLOCKED" | "CANCELLED" | null;

function hostedHasActiveWork(
  stages: readonly { readonly status: string }[] | undefined,
  attempts: readonly { readonly state: string }[],
  lanes: readonly {
    readonly attempt_state?: string | null;
    readonly runtime_state?: string | null;
  }[] = [],
): boolean {
  return Boolean(
    stages?.some((stage) => HOSTED_ACTIVE_STAGE_STATUSES.has(stage.status.toUpperCase())) ||
      attempts.some((attempt) => HOSTED_ACTIVE_ATTEMPT_STATES.has(attempt.state.toUpperCase())) ||
      lanes.some((lane) =>
        HOSTED_ACTIVE_ATTEMPT_STATES.has(
          String(lane.attempt_state ?? lane.runtime_state ?? "").toUpperCase(),
        ),
      ),
  );
}

/** A failed dispatch response is stale once the server reports a generation-stage transition. */
function hostedGenerationHasStarted(
  stages: readonly { readonly id?: string; readonly status: string }[] | undefined,
): boolean {
  return Boolean(
    stages?.some((stage) => {
      if (!HOSTED_GENERATION_STAGE_IDS.has(String(stage.id ?? "").toLowerCase())) return false;
      const status = stage.status.toUpperCase();
      return (
        HOSTED_ACTIVE_STAGE_STATUSES.has(status) ||
        [
          "WAITING_FOR_WORKER",
          "RETRY_WAIT",
          "DISPATCHED",
          "IN_PROGRESS",
          "GENERATING",
          "UPLOADING",
          "COMPLETE",
          "SUCCEEDED",
          "READY_FOR_REVIEW",
          "APPROVED",
        ].includes(status)
      );
    }),
  );
}

function hostedTerminalStageStatus(
  stages: readonly { readonly status: string }[] | undefined,
  attempts: readonly { readonly state: string }[],
  lanes: readonly {
    readonly attempt_state?: string | null;
    readonly runtime_state?: string | null;
  }[] = [],
): HostedTerminalStageStatus {
  if (hostedHasActiveWork(stages, attempts, lanes)) return null;
  for (const stage of stages ?? []) {
    const status = stage.status.toUpperCase();
    if (HOSTED_TERMINAL_STAGE_STATUSES.has(status))
      return status as Exclude<HostedTerminalStageStatus, null>;
    // `WAITING_FOR_GPU_QUALIFICATION` is an ordinary pre-dispatch state: the pair simply has not been
    // dispatched yet. Treating any status that merely mentions qualification as a blocked run painted
    // stages 7/8 BLOCKED while nothing was wrong, so a WAITING_* stage is skipped here and the stages
    // read like every other not-yet-reached stage.
    if (status.startsWith("WAITING_")) continue;
    if (
      status.includes("QUALIFICATION") ||
      status.includes("BLOCKED") ||
      status.includes("UNAVAILABLE") ||
      status.includes("UNQUALIFIED")
    ) {
      return "BLOCKED";
    }
  }
  return null;
}

interface HostedScaleToZero {
  readonly state: string;
  readonly worker_count?: number | null;
  readonly observed_at?: string | null;
  readonly evidence_id?: string | null;
  readonly detail?: string | null;
}

interface HostedQualityFlag {
  readonly id?: string;
  readonly asset_id?: string | null;
  readonly category: string;
  readonly severity?: string | null;
  readonly status: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly replacement_allowed?: boolean;
}

interface HostedContactSheetItem {
  readonly prompt?: string | null;
  readonly id?: string;
  readonly asset_id?: string | null;
  readonly checksum_sha256?: string | null;
  readonly image_url: string;
  readonly label?: string | null;
  readonly start_ms?: number | null;
  readonly end_ms?: number | null;
  readonly shot_role?: string | null;
}

interface HostedImageRegenerationAccepted {
  readonly request_id: string;
  readonly attempt_id: string;
  readonly state: "QUEUED" | "DISPATCHING";
}

interface HostedImageRegenerationStatus {
  readonly state: "PENDING" | "SUCCEEDED" | "FAILED" | "ACTION_REQUIRED";
  readonly replacement_url?: string | null;
  readonly image_url?: string | null;
  readonly error?: { readonly code?: string; readonly message?: string } | null;
  readonly error_code?: string | null;
  readonly error_message?: string | null;
}

class HostedImageRegenerationError extends Error {
  readonly retryable: boolean;
  readonly actionRequired: boolean;

  constructor(message: string, retryable: boolean, actionRequired = false) {
    super(message);
    this.name = "HostedImageRegenerationError";
    this.retryable = retryable;
    this.actionRequired = actionRequired;
  }
}

interface HostedImageRegenerationRequest {
  readonly prompt: string;
  readonly revisionId: string;
  readonly idempotencyKey: string;
  requestId: string | null;
}

const HOSTED_IMAGE_REGENERATION_STORAGE_PREFIX = "videoforge.hosted-image-regeneration.v1";

function hostedImageRegenerationStorageKey(
  projectId: string,
  revisionId: string,
  imageTaskId: string,
): string {
  return `${HOSTED_IMAGE_REGENERATION_STORAGE_PREFIX}:${projectId}:${revisionId}:${imageTaskId}`;
}

function readHostedImageRegenerationRequest(
  projectId: string,
  revisionId: string,
  imageTaskId: string,
): HostedImageRegenerationRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(
      hostedImageRegenerationStorageKey(projectId, revisionId, imageTaskId),
    );
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value.prompt !== "string" ||
      !value.prompt.trim() ||
      typeof value.revisionId !== "string" ||
      value.revisionId !== revisionId ||
      typeof value.idempotencyKey !== "string" ||
      !value.idempotencyKey.trim() ||
      (value.requestId !== null &&
        value.requestId !== undefined &&
        (typeof value.requestId !== "string" || !value.requestId.trim()))
    ) {
      return null;
    }
    return {
      prompt: value.prompt,
      revisionId: value.revisionId,
      idempotencyKey: value.idempotencyKey,
      requestId: typeof value.requestId === "string" ? value.requestId : null,
    };
  } catch {
    return null;
  }
}

function writeHostedImageRegenerationRequest(
  projectId: string,
  imageTaskId: string,
  request: HostedImageRegenerationRequest,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      hostedImageRegenerationStorageKey(projectId, request.revisionId, imageTaskId),
      JSON.stringify({
        idempotencyKey: request.idempotencyKey,
        prompt: request.prompt,
        requestId: request.requestId,
        revisionId: request.revisionId,
      }),
    );
  } catch {
    // Private browsing or a full storage quota must not break regeneration.
  }
}

function clearHostedImageRegenerationRequest(
  projectId: string,
  revisionId: string,
  imageTaskId: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(
      hostedImageRegenerationStorageKey(projectId, revisionId, imageTaskId),
    );
  } catch {
    // Storage cleanup is best effort after the server has reached a terminal state.
  }
}

interface HostedAvatarFootageItem {
  readonly id: string;
  readonly checksum_sha256?: string | null;
  readonly video_url: string;
  readonly label?: string | null;
}

interface HostedMediaPagination {
  readonly page: number;
  readonly page_size: number;
  readonly total_accepted: number;
  readonly has_more: boolean;
}

interface HostedMediaPaginationResponse {
  readonly images: HostedMediaPagination;
  readonly avatar: HostedMediaPagination;
}

interface HostedReviewSnapshot {
  readonly contact_sheet?: readonly HostedContactSheetItem[];
  readonly avatar_footage?: readonly HostedAvatarFootageItem[];
  readonly media_pagination?: HostedMediaPaginationResponse;
  readonly quality_flags?: readonly HostedQualityFlag[];
  readonly manifest_url?: string | null;
  readonly download_url?: string | null;
}

interface ProjectDetailResponse {
  readonly project: {
    id: string;
    title: string;
    created_at: string;
    revision_id: string;
    revision_state: string;
  };
  readonly attempts: readonly HostedAttempt[];
  readonly generation_provider?: "KIE_FAL" | "RUNPOD";
  readonly gpu_transport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
  readonly gpu_readiness: CatalogResponse["gpu_readiness"];
  readonly generation: null | {
    readonly id: string;
    readonly timeline_plan_sha256: string;
    readonly planned_tasks: number | string;
    readonly completed_tasks: number | string;
    readonly failed_tasks: number | string;
    readonly total_segments?: HostedCount;
    readonly image_scene_count?: HostedCount;
    readonly avatar_segment_count?: HostedCount;
    readonly stage:
      | "WAITING_FOR_GPU_QUALIFICATION"
      | "READY_FOR_GPU_DISPATCH"
      | "READY_FOR_RENDER"
      | "FAILED";
  };
  readonly prompts?: readonly {
    readonly scene_ordinal: number | string;
    readonly scene_id: string;
    readonly narration: string;
    readonly in_image_shot_role: string;
    readonly timeline_composition: string;
    readonly positive_prompt: string;
    readonly negative_prompt: string;
    readonly image_style_version_id: string;
    readonly style_profile_hash: string;
    readonly style_name: string;
    /** True after final acceptance; false rows are already batch-accepted progress. */
    readonly durable?: boolean;
  }[];
  readonly prompt_progress?: null | {
    readonly state?: "DISPATCHING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
    readonly total_scenes?: HostedCount;
    readonly accepted_scenes?: HostedCount;
    readonly total_batches?: HostedCount;
    readonly accepted_batches?: HostedCount;
    readonly active_batch_ordinal?: HostedCount;
  };
  readonly voiceover_context?: null | {
    readonly id: string;
    readonly state: "DISPATCHING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
    readonly transcript_hash: string;
    readonly context_hash?: string | null;
    readonly context_document?: Readonly<Record<string, unknown>> | null;
    readonly reserved_cost_micro_usd: number | string;
    readonly reported_cost_micro_usd?: number | string | null;
    readonly problem_code?: string | null;
  };
  readonly gpu_lanes?: readonly HostedGpuLaneActivity[];
  readonly span_audio?: HostedSpanAudioProgress | null;
  readonly queue?: HostedQueueSnapshot | null;
  readonly stages?: readonly HostedStage[];
  readonly timing?: HostedTiming | null;
  readonly time_estimate?: HostedTimeEstimate | null;
  readonly cost?: HostedCost | null;
  readonly scale_to_zero?: HostedScaleToZero | null;
  readonly review?: HostedReviewSnapshot | null;
  readonly contact_sheet?: readonly HostedContactSheetItem[];
  readonly avatar_footage?: readonly HostedAvatarFootageItem[];
  readonly media_pagination?: HostedMediaPaginationResponse;
  readonly quality_flags?: readonly HostedQualityFlag[];
  readonly manifest_url?: string | null;
}

type HostedMediaSection = "images" | "avatar";
const HOSTED_MEDIA_PAGE_SIZE = 96;
const HOSTED_MEDIA_URL_REFRESH_SKEW_MS = 30_000;

export interface HostedMediaUrlCacheEntry {
  readonly identity: string;
  readonly url: string;
  readonly expiresAtMs: number | null;
}

export type HostedMediaUrlCache = Map<string, HostedMediaUrlCacheEntry>;

type HostedMediaUrlSource = {
  readonly id?: string;
  readonly asset_id?: string | null;
  readonly checksum_sha256?: string | null;
  readonly image_url?: string;
  readonly video_url?: string;
};

function hostedMediaObjectPath(url: string): string {
  try {
    return new URL(url, "https://videoforge.invalid").pathname;
  } catch {
    return url.split("?", 1)[0] ?? url;
  }
}

export function hostedSignedUrlExpiresAtMs(url: string): number | null {
  try {
    const parsed = new URL(url, "https://videoforge.invalid");
    const rawDate = parsed.searchParams.get("X-Amz-Date");
    const lifetimeSeconds = Number(parsed.searchParams.get("X-Amz-Expires"));
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(rawDate ?? "");
    if (!match || !Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds <= 0) return null;
    const startedAtMs = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    return Number.isFinite(startedAtMs) ? startedAtMs + lifetimeSeconds * 1_000 : null;
  } catch {
    return null;
  }
}

function hostedMediaUrlIdentity(item: HostedMediaUrlSource, sourceUrl: string): string {
  return [
    item.id ?? item.asset_id ?? "unknown-media-item",
    item.checksum_sha256 ?? "",
    hostedMediaObjectPath(sourceUrl),
  ].join(":");
}

export function stableHostedMediaUrl(
  cache: HostedMediaUrlCache,
  context: string,
  section: string,
  item: HostedMediaUrlSource,
  nowMs = Date.now(),
): string {
  const sourceUrl = item.image_url ?? item.video_url ?? "";
  if (!sourceUrl) return sourceUrl;
  const identity = hostedMediaUrlIdentity(item, sourceUrl);
  const key = `${context}:${section}:${identity}`;
  const existing = cache.get(key);
  if (
    existing &&
    (existing.expiresAtMs === null ||
      existing.expiresAtMs - nowMs > HOSTED_MEDIA_URL_REFRESH_SKEW_MS)
  ) {
    return existing.url;
  }
  cache.set(key, {
    identity,
    url: sourceUrl,
    expiresAtMs: hostedSignedUrlExpiresAtMs(sourceUrl),
  });
  return sourceUrl;
}

function hostedMediaItemKey(item: {
  readonly id?: string;
  readonly image_url?: string;
  readonly video_url?: string;
}): string {
  return item.id ?? item.image_url ?? item.video_url ?? "unknown-media-item";
}

function mergeHostedMedia<
  T extends {
    readonly id?: string;
    readonly image_url?: string;
    readonly video_url?: string;
  },
>(current: readonly T[], next: readonly T[]): readonly T[] {
  const merged = [...current];
  const indexes = new Map(merged.map((item, index) => [hostedMediaItemKey(item), index]));
  for (const item of next) {
    const key = hostedMediaItemKey(item);
    const existing = indexes.get(key);
    if (existing === undefined) {
      indexes.set(key, merged.length);
      merged.push(item);
    } else {
      merged[existing] = item;
    }
  }
  return merged;
}

interface HostedSpanAudioProgress {
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly total: number;
  readonly materialized: number;
  readonly planned: number;
  readonly running: number;
  readonly queued: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Failed clips that still have automatic retries left on the owner's computer. */
  readonly retrying?: number;
  readonly failure_code?: string | null;
}

interface HostedGpuLaneActivity {
  readonly lane: "mage_image" | "soulx_avatar";
  readonly attempt_state: string | null;
  /** Latest persisted provider status. Database attempt state remains authoritative for terminal outcomes. */
  readonly provider_status?: string | null;
  readonly runtime_state: string | null;
  readonly planned_item_count: number | null;
  readonly accepted_item_count: number;
  readonly attempt_ordinal: number | null;
  readonly submitted_at: string | null;
  readonly created_at: string | null;
  readonly terminal_at: string | null;
}

const HOSTED_GPU_LANE_LABELS: Readonly<Record<string, string>> = {
  mage_image: "Scene images",
  soulx_avatar: "Avatar performance",
};

const HOSTED_GPU_TERMINAL_DATABASE_STATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "RETRYABLE_FAILED",
  "PERMANENT_FAILED",
  "DEAD_LETTER",
  "BLOCKED",
  "CANCEL_REQUESTED",
  "CANCELLING",
  "CANCELLED",
]);
const HOSTED_GPU_LIVE_PROVIDER_STATES = new Set(["IN_QUEUE", "IN_PROGRESS"]);

function hostedGpuLaneDisplayState(lane: HostedGpuLaneActivity): string {
  const databaseState = String(lane.attempt_state ?? lane.runtime_state ?? "").toUpperCase();
  if (HOSTED_GPU_TERMINAL_DATABASE_STATES.has(databaseState)) return databaseState;
  const providerState = String(lane.provider_status ?? "").toUpperCase();
  if (providerState === "COMPLETED") {
    const accepted = hostedGpuLaneAcceptedCount(lane);
    const planned = lane.planned_item_count;
    return planned !== null && planned > 0 && accepted >= planned ? "SUCCEEDED" : databaseState;
  }
  return HOSTED_GPU_LIVE_PROVIDER_STATES.has(providerState) ? providerState : databaseState;
}

/** Provider phase text for a dispatched lane. The provider queue and the container cold start are
 * both normal multi-minute waits, so name them instead of leaving the stage looking idle. */
function hostedGpuLanePhase(
  lane: HostedGpuLaneActivity,
  apiGeneration = false,
): {
  readonly label: string;
  readonly detail: string;
  readonly active: boolean;
} {
  const state = hostedGpuLaneDisplayState(lane);
  const accepted = hostedGpuLaneAcceptedCount(lane);
  if (apiGeneration && state === "UNKNOWN_NO_RETRY")
    return {
      label: "Needs attention",
      detail: "The API response is uncertain; this request will not be sent again automatically.",
      active: false,
    };
  if (apiGeneration && state === "BLOCKED")
    return {
      label: "Stopped",
      detail: "This request stopped before these items were sent to the API provider.",
      active: false,
    };
  if (apiGeneration && state === "SUBMITTING")
    return {
      label: "Submitting",
      detail: "Sending a claimed request to the API provider.",
      active: true,
    };
  if (apiGeneration && state === "OUTBOXED")
    return { label: "Queuing", detail: "Preparing the API request.", active: true };
  if (apiGeneration && state === "IN_PROGRESS")
    return {
      label: "Generating",
      detail: "The API provider is producing and verifying items.",
      active: true,
    };
  if (state === "SUCCEEDED")
    return { label: "Complete", detail: "All items accepted.", active: false };
  if (["FAILED", "PERMANENT_FAILED", "DEAD_LETTER", "RETRYABLE_FAILED"].includes(state))
    return {
      label: "Failed",
      detail:
        accepted > 0
          ? `${accepted} item${accepted === 1 ? "" : "s"} accepted before the provider run stopped.`
          : "The provider run ended without an accepted result.",
      active: false,
    };
  if (["CANCELLED", "CANCEL_REQUESTED", "CANCELLING"].includes(state))
    return { label: "Cancelled", detail: "This lane was stopped.", active: false };
  if (state === "OUTBOXED")
    return {
      label: "Queuing",
      detail: apiGeneration
        ? "Preparing the API request."
        : "Handing the batch to the GPU provider.",
      active: true,
    };
  if (["IN_QUEUE", "WAITING_FOR_GPU", "WAITING_FOR_GPUS", "WAITING_FOR_WORKER"].includes(state)) {
    if (apiGeneration)
      return {
        label: "Waiting",
        detail: "Waiting for API generation to start.",
        active: true,
      };
    return {
      label: "Waiting for GPUs",
      detail:
        "No GPU worker is available yet. Your generation will start automatically when capacity opens.",
      active: true,
    };
  }
  if (state === "ASSIGNED" && accepted === 0) {
    if (apiGeneration)
      return {
        label: "Starting",
        detail: "The API provider is starting generation.",
        active: true,
      };
    return {
      label: "Starting GPU worker",
      detail: "GPU worker assigned; waiting for the first provider progress update.",
      active: true,
    };
  }
  if (
    ["ASSIGNED", "SUBMITTED", "IN_PROGRESS", "UPLOADING", "RUNNING", "RECONCILING"].includes(state)
  )
    return {
      label: "Generating",
      detail: apiGeneration
        ? "The API provider is producing and verifying items."
        : state === "IN_PROGRESS" && accepted === 0
          ? "The provider has not reported any completed items yet."
          : "The GPU worker is producing and verifying items.",
      active: true,
    };
  return { label: "Waiting", detail: "This lane has not been dispatched yet.", active: false };
}

/**
 * Remembers when this browser first saw a stage running.
 *
 * The server only sends `started_at` once a stage owns a timed attempt row, so a stage running on
 * derived state -- prompt writing before its run row exists, a dispatched but unassigned GPU lane --
 * rendered a dash instead of a clock. Counting from the first observation makes the timer start the
 * moment the previous stage completes and the next one begins, which is what the stage list promises.
 */
const observedStageStarts = new Map<string, number>();

function hostedStageStart(
  since: string | null | undefined,
  running: boolean,
  key: string,
): string | null {
  if (since) return since;
  if (!running) {
    observedStageStarts.delete(key);
    return null;
  }
  const observed = observedStageStarts.get(key) ?? Date.now();
  observedStageStarts.set(key, observed);
  return new Date(observed).toISOString();
}

function hostedGpuLaneAcceptedCount(lane: HostedGpuLaneActivity): number {
  const accepted = Math.max(0, lane.accepted_item_count);
  const planned = lane.planned_item_count;
  // A successful provider attempt means its canonical output was accepted. Older runtime rows
  // can still report zero after a paired lane failure, so use the durable plan as the display
  // count in that case.
  return String(lane.attempt_state ?? lane.runtime_state ?? "").toUpperCase() === "SUCCEEDED" &&
    planned !== null &&
    accepted < planned
    ? planned
    : accepted;
}

export function HostedElapsed({
  since,
  until,
  running = true,
  label = "Elapsed time",
  intervals,
}: {
  readonly since: string | null;
  readonly until: string | null;
  readonly running?: boolean;
  readonly label?: string;
  readonly intervals?: readonly {
    readonly since: string | null;
    readonly until: string | null;
    readonly running: boolean;
  }[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (
      intervals
        ? !intervals.some((interval) => interval.since && !interval.until && interval.running)
        : !since || until || !running
    )
      return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since, until, running, intervals]);
  const elapsedSeconds = (
    start: string | null,
    end: string | null,
    active: boolean,
  ): number | null => {
    const started = start ? Date.parse(start) : Number.NaN;
    const ended = end ? Date.parse(end) : now;
    if (!Number.isFinite(started) || !Number.isFinite(ended) || (!end && !active)) return null;
    return Math.max(0, Math.floor((ended - started) / 1_000));
  };
  const seconds = intervals
    ? intervals.reduce(
        (sum, interval) =>
          sum + (elapsedSeconds(interval.since, interval.until, interval.running) ?? 0),
        0,
      )
    : elapsedSeconds(since, until, running);
  if (seconds === null)
    return (
      <span className="gpu-lane-elapsed" aria-label={label}>
        —
      </span>
    );
  const minutes = Math.floor(seconds / 60);
  return (
    <span className="gpu-lane-elapsed" aria-label={label}>
      {minutes}m {String(seconds % 60).padStart(2, "0")}s
    </span>
  );
}

function HostedGpuLaneActivityPanel({
  lanes,
  apiGeneration = false,
}: {
  readonly lanes: readonly HostedGpuLaneActivity[];
  readonly apiGeneration?: boolean;
}) {
  const visible = lanes.filter(
    (lane) =>
      lane.attempt_state !== null || lane.provider_status != null || lane.runtime_state !== null,
  );
  if (visible.length === 0) return null;
  return (
    <Panel
      className="gpu-lane-panel"
      eyebrow={apiGeneration ? "Via APIs" : "On the GPU"}
      heading="Image and avatar generation"
    >
      <ul className="gpu-lane-list">
        {visible.map((lane) => {
          const phase = hostedGpuLanePhase(lane, apiGeneration);
          const planned = lane.planned_item_count ?? 0;
          const accepted = hostedGpuLaneAcceptedCount(lane);
          const percent = planned > 0 ? Math.min(100, Math.round((accepted / planned) * 100)) : 0;
          return (
            <li key={lane.lane} className="gpu-lane-item">
              <div className="gpu-lane-head">
                <span className="gpu-lane-name">
                  {HOSTED_GPU_LANE_LABELS[lane.lane] ?? lane.lane}
                </span>
                <span
                  className={`gpu-lane-phase gpu-lane-phase-${phase.active ? "active" : "idle"}`}
                >
                  {phase.active ? (
                    <span className="live-progress-pulse" aria-hidden="true" />
                  ) : null}
                  {phase.label}
                </span>
                <HostedElapsed
                  since={
                    apiGeneration
                      ? (lane.created_at ?? lane.submitted_at)
                      : (lane.submitted_at ?? lane.created_at)
                  }
                  until={lane.terminal_at}
                  running={phase.active}
                />
              </div>
              <div
                className={`gpu-lane-track${phase.active && accepted === 0 ? " gpu-lane-track-indeterminate" : ""}`}
                role="progressbar"
                aria-label={`${HOSTED_GPU_LANE_LABELS[lane.lane] ?? lane.lane} progress`}
                {...(accepted > 0
                  ? { "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 }
                  : {})}
              >
                <span
                  className="gpu-lane-fill"
                  style={accepted > 0 ? { width: `${percent}%` } : undefined}
                />
              </div>
              <p className="helper gpu-lane-detail">
                {planned > 0 ? `${accepted} of ${planned} accepted · ` : ""}
                {phase.detail}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Span audio is cut on the account-owned worker, and Stage 6 and Stage 7 cannot
 * dispatch until every span is materialized, so show that preparation rather than a silent wait. */
function HostedSpanAudioPanel({ progress }: { readonly progress: HostedSpanAudioProgress | null }) {
  if (!progress || progress.total === 0) return null;
  const done = progress.materialized;
  const percent = Math.min(100, Math.round((done / progress.total) * 100));
  const retrying = progress.retrying ?? 0;
  const active = progress.running > 0 || progress.queued > 0 || retrying > 0;
  const complete = done === progress.total;
  const stopped = progress.failed > 0 && retrying === 0;
  return (
    <Panel
      className="gpu-lane-panel"
      eyebrow="Your computer"
      heading={
        complete
          ? "Avatar audio ready"
          : stopped
            ? "Avatar audio stopped"
            : "Preparing avatar audio"
      }
    >
      <ul className="gpu-lane-list">
        <li className="gpu-lane-item">
          <div className="gpu-lane-head">
            <span className="gpu-lane-name">Span audio</span>
            <span
              className={`gpu-lane-phase gpu-lane-phase-${complete || active ? "active" : "idle"}`}
            >
              {active ? <span className="live-progress-pulse" aria-hidden="true" /> : null}
              {complete
                ? "Ready"
                : stopped
                  ? "Failed"
                  : progress.running > 0 || progress.queued > 0
                    ? "Cutting"
                    : retrying > 0
                      ? "Retrying"
                      : "Waiting"}
            </span>
            <HostedElapsed
              since={progress.started_at ?? null}
              until={progress.completed_at ?? null}
              running={active && !complete && !stopped}
              label="Span audio elapsed time"
            />
          </div>
          <div
            className="gpu-lane-track"
            role="progressbar"
            aria-label="Span audio progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="gpu-lane-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="helper gpu-lane-detail">
            {done} of {progress.total} clips ready
            {progress.running > 0 ? " · 1 cutting now" : ""}
            {progress.queued > 0 ? ` · ${progress.queued} queued` : ""}
            {progress.failed > 0
              ? ` · ${progress.failed} failed${retrying > 0 ? ` (${retrying} retrying automatically)` : ""}`
              : ""}
          </p>
          {progress.failed > 0 ? (
            <p className="helper gpu-lane-detail">
              {spanAudioFailureMessage(progress.failure_code ?? null, retrying > 0)}
            </p>
          ) : null}
        </li>
      </ul>
    </Panel>
  );
}

/** Stage 6 stops inside the owner's own computer, so name that local cause and the retry state. */
export function spanAudioFailureMessage(failureCode: string | null, retrying: boolean): string {
  if (failureCode === "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT") {
    return retrying
      ? "Your computer ran out of free disk space. Free space there and the remaining clips finish automatically."
      : "Your computer ran out of free disk space. Free space there, then open this project again to finish the remaining clips.";
  }
  if (failureCode === "MEDIA_EXECUTION_IO_FAILED") {
    return retrying
      ? "Your computer could not read or save the clip audio. Free disk space there and the remaining clips finish automatically."
      : "Your computer could not read or save the clip audio. Free disk space there, then open this project again to finish the remaining clips.";
  }
  if (failureCode === "MEDIA_EXECUTION_TIMEOUT") {
    return retrying
      ? "A clip on your computer took too long and is being cut again."
      : "A clip on your computer took too long. Open this project again to retry it.";
  }
  if (failureCode === "MEDIA_EXECUTION_SUBPROCESS_FAILED") {
    return retrying
      ? "Your computer's local audio process stopped unexpectedly and the clip is being cut again."
      : "Your computer's local audio process stopped unexpectedly. Update the personal media worker, then open this project again.";
  }
  return retrying
    ? "Your computer could not cut some clips and is retrying them."
    : "Your computer could not cut some clips. Open this project again to retry them.";
}

interface HostedV209DispatchResponse {
  readonly schema_version: "videoforge-hosted-v209-project-dispatch/v1";
  readonly state: "SCHEDULED" | "PREPARING_INPUTS" | "WAITING" | "WAITING_FOR_GPUS";
  readonly retry_after_seconds?: number;
  readonly correlation_id: string;
}

const HOSTED_V209_DISPATCH_READY_QUEUE_STATES = new Set(["ADMITTED", "ACTIVE"]);
const HOSTED_PREDISPATCH_CANCELLABLE_QUEUE_STATES = new Set([
  "WAITING",
  "RETRY_WAIT",
  "ADMITTED",
  "ACTIVE",
  "CANCELLING",
]);
const HOSTED_V209_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const HOSTED_V209_PRE_SEND_INTEGRITY_CODE = "V209_ORDINARY_CANDIDATE_HASH_INVALID";

function exactHostedV209DispatchResponse(value: HostedV209DispatchResponse) {
  if (
    value.schema_version !== "videoforge-hosted-v209-project-dispatch/v1" ||
    !["SCHEDULED", "PREPARING_INPUTS", "WAITING", "WAITING_FOR_GPUS"].includes(value.state) ||
    !HOSTED_V209_CORRELATION_ID.test(value.correlation_id)
  ) {
    throw new Error("Generation start could not be verified.");
  }
  return value;
}

function isHostedV209PreSendIntegrityError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === HOSTED_V209_PRE_SEND_INTEGRITY_CODE
  );
}

export function hostedProjectPollInterval(data: ProjectDetailResponse | undefined) {
  if (!data) return 2_000;
  const activeWork = hostedHasActiveWork(data.stages, data.attempts, data.gpu_lanes);
  const terminalStage =
    hostedTerminalStageStatus(data.stages, data.attempts, data.gpu_lanes) !== null;
  const terminalAttempt =
    !activeWork &&
    data.attempts.some((attempt) => ["FAILED", "CANCELLED"].includes(attempt.state.toUpperCase()));
  const terminalContext = !activeWork && data.voiceover_context?.state === "FAILED";
  const complete =
    Boolean(data.stages?.length) &&
    data.stages!.every((stage) =>
      ["COMPLETE", "SUCCEEDED", "APPROVED", "READY_FOR_REVIEW"].includes(stage.status),
    );
  return terminalStage || terminalAttempt || terminalContext || complete ? false : 2_000;
}

interface HostedUsageResponse {
  readonly current_month_provider_cpu_usd: 0;
  readonly current_month_gpu_usd: 0;
  readonly attempts: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly personal_worker_seconds: number;
  readonly retained_bytes: number;
  readonly storage_policy: string;
  readonly as_of?: string | null;
  readonly fixed_recurring_usd?: number | null;
  readonly projects?: readonly {
    readonly project_id: string;
    readonly title: string;
    readonly attempts?: number;
    readonly projected_usd?: number | null;
    readonly settled_usd?: number | null;
    readonly worker_seconds?: number | null;
    readonly queue_wait_ms?: number | null;
    readonly end_to_end_ms?: number | null;
  }[];
  readonly lanes?: readonly {
    readonly lane: string;
    readonly projected_usd?: number | null;
    readonly settled_usd?: number | null;
    readonly billed_seconds?: number | null;
  }[];
}

interface HostedPreflightResponse {
  readonly ok?: boolean;
  readonly ready?: boolean;
  readonly blockers?: readonly {
    readonly code?: string;
    readonly message: string;
    readonly severity?: string;
  }[];
  readonly estimate?: {
    readonly projected_usd?: number | null;
    readonly minimum_usd?: number | null;
    readonly maximum_usd?: number | null;
    readonly cap_usd?: number | null;
    readonly detail?: string | null;
  } | null;
  readonly revision_id?: string | null;
}

export interface HostedUploadDescriptor {
  readonly url: string;
  readonly requiredHeaders?: Readonly<Record<string, string>>;
  readonly asset_id?: string;
}

interface HostedPresetMutationResponse {
  readonly id?: string;
  readonly profile_id?: string;
  readonly style_id?: string;
  readonly project_id?: string;
  readonly version_id?: string;
  readonly state?: string;
  readonly upload?: HostedUploadDescriptor | null;
  readonly uploads?: readonly HostedUploadDescriptor[];
  readonly normalized_uploads?: readonly HostedUploadDescriptor[];
  readonly version?: number;
  readonly profile?: Record<string, unknown> | null;
  readonly profile_hash?: string | null;
  readonly thumbnail_url?: string | null;
  readonly cover_url?: string | null;
  readonly summary?: string | null;
  readonly analysis_cost_usd?: number | null;
}

function hostedDraftResponse(
  draft: HostedAvatarDraft | HostedStyleDraft,
): HostedPresetMutationResponse {
  const isAvatar = "profile_id" in draft;
  return {
    // Resume with the exact version, so a later published version can never be selected by
    // an id-only style endpoint.
    id: draft.version_id,
    profile_id: isAvatar ? draft.profile_id : undefined,
    style_id: !isAvatar ? draft.style_id : undefined,
    version_id: draft.version_id,
    version: draft.version_number,
    state: draft.state,
    profile_hash: draft.profile_hash ?? null,
    profile: !isAvatar ? (draft.profile ?? null) : null,
    summary: !isAvatar ? (draft.summary ?? null) : null,
    analysis_cost_usd: !isAvatar ? (draft.analysis_cost_usd ?? null) : null,
  };
}

function hostedPresetResumeHref(kind: HostedPresetHubKind, versionId: string): string {
  const query = new URLSearchParams({
    resumeVersionId: versionId,
    returnTo: kind === "avatars" ? "/avatars" : "/styles",
  });
  return `${kind === "avatars" ? "/avatars/new" : "/styles/new"}?${query.toString()}`;
}

function hostedDraftIsResumable(
  _kind: HostedPresetHubKind,
  draft: {
    readonly state?: string;
    readonly status?: string;
    readonly references_verified?: boolean;
  },
): boolean {
  const state = presetState(draft);
  return state === "NEEDS_REVIEW" || state === "DRAFT" || state === "FAILED";
}

export interface FixtureStyleCreationAdapter {
  readonly returnTo: string;
  listStyles(): Promise<CatalogResponse["styles"]>;
  load(styleId: string, versionId: string): Promise<ImageStyleHubVersionResponse>;
  normalize(file: File): Promise<NormalizedStyleReference>;
  createAndRegister(
    name: string,
    sources: readonly NormalizedStyleReference[],
  ): Promise<ImageStyleHubVersionResponse>;
  analyze(value: ImageStyleHubVersionResponse): Promise<ImageStyleHubVersionResponse>;
  publish(value: ImageStyleHubVersionResponse): Promise<ImageStyleHubVersionResponse>;
}

function fixtureStyleResponse(value: ImageStyleHubVersionResponse): HostedPresetMutationResponse {
  const visual = value.profile?.visual_profile;
  return {
    id: value.style_id,
    style_id: value.style_id,
    version_id: value.version_id,
    state: value.state,
    profile: value.profile as unknown as Record<string, unknown> | null,
    profile_hash: value.profile_hash,
    summary: visual
      ? [
          visual.medium_family,
          visual.lighting,
          visual.color.descriptors.join(", "),
          visual.texture_and_grain,
        ].join(" · ")
      : null,
  };
}

function persistFixtureStyleResumeIdentity(value: ImageStyleHubVersionResponse): void {
  const url = new URL(window.location.href);
  url.searchParams.set("resumeStyleId", value.style_id);
  url.searchParams.set("resumeVersionId", value.version_id);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const FILE_ACCESS_HINT =
  'Chrome could not read the selected file. Open chrome://extensions, choose Details for the ChatGPT browser extension, enable "Allow access to file URLs," then choose the file again.';

export async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await fetch(path, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...init?.headers },
  });
  const payload = (await result.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | T
    | null;
  if (!result.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    const fallback =
      error?.code === "PROJECT_TITLE_CONFLICT"
        ? "Another active project already uses this title. Open Progress to continue that project or delete it, or choose a different title."
        : error?.code;
    const requestError = new Error(
      error?.message ?? fallback ?? "VideoForge hosted request failed.",
    ) as Error & { readonly status?: number; readonly code?: string };
    Object.defineProperties(requestError, {
      status: { configurable: true, value: result.status },
      code: { configurable: true, value: error?.code },
    });
    throw requestError;
  }
  return payload as T;
}

function hostedImageRegenerationPath(
  projectId: string,
  imageTaskId: string,
  requestId?: string,
): string {
  const base = `/api/v2/hosted/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageTaskId)}/regenerate`;
  return requestId ? `${base}/${encodeURIComponent(requestId)}` : base;
}

function hostedImageRegenerationFailure(status: HostedImageRegenerationStatus): string {
  const message = status.error?.message?.trim();
  if (message) return message;
  if (status.error_message?.trim()) return status.error_message.trim();
  if (status.error_code?.trim()) return status.error_code.trim();
  return "The replacement did not complete.";
}

function waitForHostedImageRegenerationPoll(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, HOSTED_IMAGE_REGENERATION_POLL_MS);
  });
}

function hostedImageRegenerationHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { readonly status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function hostedImageRegenerationRequestWasRejected(error: unknown): boolean {
  const status = hostedImageRegenerationHttpStatus(error);
  if (status === null) return false;
  // These responses can race request creation or represent a temporary limit;
  // preserve the same idempotency key so retrying can resume the request.
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

async function bounded<T>(promise: Promise<T>, message: string, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (typeof timer !== "undefined") clearTimeout(timer);
  }
}

/** Blob.arrayBuffer() can remain pending for extension-backed file inputs in Chrome. */
async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      reader.abort();
      fail();
    }, 10_000);
    const fail = () => {
      if (typeof timeout !== "undefined") clearTimeout(timeout);
      reject(new Error(FILE_ACCESS_HINT));
    };
    reader.onload = () => {
      if (typeof timeout !== "undefined") clearTimeout(timeout);
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else fail();
    };
    reader.onerror = fail;
    reader.onabort = fail;
    reader.readAsArrayBuffer(blob);
  });
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

class IncrementalSha256 {
  readonly #state = new Uint32Array(SHA256_INITIAL_STATE);
  readonly #block = new Uint8Array(64);
  readonly #schedule = new Uint32Array(64);
  #blockLength = 0;
  #bytesHashed = 0;
  #finished = false;

  update(bytes: Uint8Array): void {
    if (this.#finished) throw new Error("SHA-256 digest is already finalized.");
    this.#bytesHashed += bytes.byteLength;
    let offset = 0;

    if (this.#blockLength > 0) {
      const needed = 64 - this.#blockLength;
      const copied = Math.min(needed, bytes.byteLength);
      this.#block.set(bytes.subarray(0, copied), this.#blockLength);
      this.#blockLength += copied;
      offset += copied;
      if (this.#blockLength === 64) {
        this.#compress(this.#block, 0);
        this.#blockLength = 0;
      }
    }

    while (offset + 64 <= bytes.byteLength) {
      this.#compress(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.byteLength) {
      this.#block.set(bytes.subarray(offset), 0);
      this.#blockLength = bytes.byteLength - offset;
    }
  }

  digestHex(): string {
    if (this.#finished) throw new Error("SHA-256 digest is already finalized.");
    this.#finished = true;
    const bitLength = this.#bytesHashed * 8;

    this.#block[this.#blockLength++] = 0x80;
    if (this.#blockLength > 56) {
      this.#block.fill(0, this.#blockLength);
      this.#compress(this.#block, 0);
      this.#blockLength = 0;
    }
    this.#block.fill(0, this.#blockLength, 56);
    const view = new DataView(this.#block.buffer);
    view.setUint32(56, Math.floor(bitLength / 0x1_0000_0000), false);
    view.setUint32(60, bitLength >>> 0, false);
    this.#compress(this.#block, 0);

    return Array.from(this.#state, (word) => word.toString(16).padStart(8, "0")).join("");
  }

  #compress(bytes: Uint8Array, offset: number): void {
    const words = this.#schedule;
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((bytes[start]! << 24) |
          (bytes[start + 1]! << 16) |
          (bytes[start + 2]! << 8) |
          bytes[start + 3]!) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = words[index - 15]!;
      const prior2 = words[index - 2]!;
      const sigma0 = rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
      const sigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = this.#state[0]!;
    let b = this.#state[1]!;
    let c = this.#state[2]!;
    let d = this.#state[3]!;
    let e = this.#state[4]!;
    let f = this.#state[5]!;
    let g = this.#state[6]!;
    let h = this.#state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    this.#state[0] = (this.#state[0]! + a) >>> 0;
    this.#state[1] = (this.#state[1]! + b) >>> 0;
    this.#state[2] = (this.#state[2]! + c) >>> 0;
    this.#state[3] = (this.#state[3]! + d) >>> 0;
    this.#state[4] = (this.#state[4]! + e) >>> 0;
    this.#state[5] = (this.#state[5]! + f) >>> 0;
    this.#state[6] = (this.#state[6]! + g) >>> 0;
    this.#state[7] = (this.#state[7]! + h) >>> 0;
  }
}

function abortError(): DOMException {
  return new DOMException("File hashing was cancelled.", "AbortError");
}

interface HostedFileHashOptions {
  readonly signal?: AbortSignal;
  readonly readChunk?: (chunk: Blob) => Promise<ArrayBuffer>;
}

/** Incremental SHA-256 keeps peak file memory bounded to one fixed-size slice. */
export async function hostedFileSha256(
  file: Blob,
  options: HostedFileHashOptions = {},
): Promise<`sha256:${string}`> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_VOICEOVER_BYTES) {
    throw new Error("The selected file is outside the bounded hashing contract.");
  }
  const hash = new IncrementalSha256();
  const readChunk = options.readChunk ?? readBlobBytes;
  for (let offset = 0; offset < file.size; offset += HOSTED_SHA256_CHUNK_BYTES) {
    if (options.signal?.aborted) throw abortError();
    const end = Math.min(file.size, offset + HOSTED_SHA256_CHUNK_BYTES);
    const buffer = await readChunk(file.slice(offset, end));
    if (options.signal?.aborted) throw abortError();
    if (buffer.byteLength !== end - offset) throw new Error(FILE_ACCESS_HINT);
    hash.update(new Uint8Array(buffer));
    if (end < file.size && end % (HOSTED_SHA256_CHUNK_BYTES * 4) === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return `sha256:${hash.digestHex()}`;
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );
}

/** Read duration from the RIFF/WAVE container without relying on media-element events. */
export function parseWavDurationMs(
  buffer: ArrayBuffer,
  totalByteLength = buffer.byteLength,
): number | null {
  const view = new DataView(buffer);
  if (
    !Number.isSafeInteger(totalByteLength) ||
    totalByteLength < buffer.byteLength ||
    view.byteLength < 12 ||
    readAscii(view, 0, 4) !== "RIFF" ||
    readAscii(view, 8, 4) !== "WAVE"
  ) {
    return null;
  }
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkId = readAscii(view, offset, 4);
    if (chunkId === "fmt " && chunkSize >= 12 && chunkStart + 12 <= view.byteLength)
      byteRate = view.getUint32(chunkStart + 8, true);
    if (chunkId === "data") {
      if (chunkStart + chunkSize > totalByteLength) return null;
      dataBytes = chunkSize;
      break;
    }
    if (chunkStart + chunkSize > view.byteLength) return null;
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!Number.isSafeInteger(byteRate) || byteRate <= 0 || !Number.isSafeInteger(dataBytes))
    return null;
  return Math.round((dataBytes / byteRate) * 1_000);
}

function validateAudioDurationMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10_000 || value > 3_600_000)
    throw new Error("Voiceover must be between 10 seconds and 60 minutes.");
  return value;
}

export async function audioDurationMs(file: File): Promise<number> {
  if (file.type === "audio/wav" || /\.wav$/iu.test(file.name)) {
    const parsed = parseWavDurationMs(
      await readBlobBytes(file.slice(0, Math.min(file.size, 1024 * 1024))),
      file.size,
    );
    if (parsed !== null) return validateAudioDurationMs(parsed);
  }
  const url = URL.createObjectURL(file);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Voiceover duration could not be read."));
      timeout = setTimeout(() => reject(new Error("Voiceover duration could not be read.")), 5_000);
    });
    const value = Math.round(audio.duration * 1_000);
    return validateAudioDurationMs(value);
  } finally {
    if (typeof timeout !== "undefined") clearTimeout(timeout);
    URL.revokeObjectURL(url);
  }
}

function formatUsd(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "Not reported";
}

export function hostedPreflightEstimateText(
  estimate: HostedPreflightResponse["estimate"],
  dispatchAvailable: boolean,
): string {
  if (!dispatchAvailable) {
    return "No paid video generation in this beta";
  }
  if (typeof estimate?.projected_usd === "number" && Number.isFinite(estimate.projected_usd)) {
    return `Estimated variable cost ${formatUsd(estimate.projected_usd)}`;
  }
  return "Estimate pending";
}

function formatMilliseconds(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Not reported";
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatApproximateMinutes(minMs: number, maxMs: number): string | null {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs < 0 || maxMs < minMs)
    return null;
  const low = Math.max(1, Math.floor(minMs / 60_000));
  const high = Math.max(low, Math.ceil(maxMs / 60_000));
  return low === high ? `~${high} min` : `~${low}–${high} min`;
}

function hostedCount(value: HostedCount): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hostedCountLabel(value: HostedCount): string {
  const parsed = hostedCount(value);
  return parsed === null ? "Not reported" : parsed.toLocaleString();
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
}

function normalizedStatus(value: string | null | undefined): string {
  return (value ?? "NOT_REPORTED").replaceAll("_", " ");
}

function statusTone(
  value: string | null | undefined,
): "neutral" | "success" | "warning" | "danger" | "info" {
  const status = (value ?? "").toUpperCase();
  if (
    ["SUCCEEDED", "COMPLETE", "COMPLETED", "READY", "PUBLISHED", "APPROVED", "PASSED"].includes(
      status,
    )
  )
    return "success";
  if (["FAILED", "BLOCKED", "REJECTED", "ERROR"].includes(status)) return "danger";
  if (["WAITING", "QUEUED", "RUNNING", "IN_PROGRESS", "REVIEW_REQUIRED"].includes(status))
    return "warning";
  return "info";
}

function preflightReady(value: HostedPreflightResponse | null): boolean {
  return value?.ready === true && value?.ok === true;
}

export function preflightBlockers(value: HostedPreflightResponse | null): readonly string[] {
  return (value?.blockers ?? [])
    .filter((blocker) => blocker.severity !== "ADVISORY")
    .map((blocker) => blocker.message);
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image dimensions could not be read."));
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("Image dimensions could not be read.");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function putHostedUpload(upload: HostedUploadDescriptor, file: File): Promise<void> {
  const headers = Object.fromEntries(
    Object.entries(upload.requiredHeaders ?? {}).filter(
      ([key]) => key.toLowerCase() !== "content-length",
    ),
  );
  const controller = new AbortController();
  try {
    const result = await bounded(
      fetch(upload.url, { method: "PUT", headers, body: file, signal: controller.signal }),
      "Private upload timed out. Retry this step.",
      HOSTED_UPLOAD_TIMEOUT_MS,
    );
    if (!result.ok) throw new Error(`Private upload failed (HTTP ${result.status}).`);
  } finally {
    controller.abort();
  }
}

const ENCODED_UNSAFE_RETURN_TO_CHARACTERS = /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/iu;

function hasUnsafeReturnToCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || code <= 0x1f || code === 0x7f;
  });
}

function normalizedInternalPath(value: string, origin: string): string | null {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafeReturnToCharacter(value) ||
    ENCODED_UNSAFE_RETURN_TO_CHARACTERS.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function normalizeHostedReturnTo(
  value: string | null,
  fallback: string,
  origin = window.location.origin,
): string {
  return (
    (value === null ? null : normalizedInternalPath(value, origin)) ??
    normalizedInternalPath(fallback, origin) ??
    "/"
  );
}

function presetState(item: {
  readonly state?: string;
  readonly status?: string;
  readonly analysis_state?: string | null;
}) {
  if (item.analysis_state === "UNKNOWN") return "UNKNOWN";
  return item.state ?? item.status ?? "READY";
}

function unfinishedPresetLabel(value: string): string {
  switch (value) {
    case "NEEDS_REVIEW":
      return "Ready to review";
    case "ANALYZING":
      return "Analysis in progress";
    case "UNKNOWN":
      return "Analysis result unconfirmed";
    case "FAILED":
      return "Needs attention";
    case "DRAFT":
      return "Ready to continue";
    default:
      return "Setup incomplete";
  }
}

function unfinishedPresetDescription(
  kind: HostedPresetHubKind,
  state: string,
  referenceCount: number,
  referencesVerified = true,
): string {
  if (kind === "avatars") {
    if (state === "ANALYZING") return "Approval in progress.";
    if (state === "FAILED") return "Could not finish. Remove and try again.";
    if (state === "DRAFT") return "Photo saved. Continue setup.";
    return state === "NEEDS_REVIEW" ? "Ready to review." : "Continue setup.";
  }
  if (state === "NEEDS_REVIEW") {
    return "Ready to review.";
  }
  if (state === "ANALYZING") {
    return "Analysis in progress.";
  }
  if (state === "UNKNOWN") {
    return "Analysis stopped. No automatic retry.";
  }
  if (state === "FAILED") {
    return "Analysis failed. References saved; retry from this draft.";
  }
  if (state === "DRAFT" && !referencesVerified) return "Select 3–8 replacement images.";
  if (state === "DRAFT")
    return referenceCount > 0
      ? `${referenceCount} references saved.`
      : "Draft saved. Continue setup.";
  return referenceCount > 0
    ? `${referenceCount} references saved.`
    : "Continue setup to add references.";
}

const HUMAN_PIPELINE_STAGES = [
  "Prepare",
  "Transcribe",
  "Understand context",
  "Plan",
  "Write image prompts",
  "Generate images",
  "Generate avatar",
  "Assemble",
  "Technical check",
  "Review",
] as const;

function fallbackHostedStages(
  asr: HostedAttempt | undefined,
  render: HostedAttempt | undefined,
  generation: ProjectDetailResponse["generation"],
  voiceoverContext: ProjectDetailResponse["voiceover_context"],
): readonly HostedStage[] {
  const asrStatus = asr?.state === "SUCCEEDED" ? "COMPLETE" : asr ? asr.state : "NOT_STARTED";
  const planStatus = generation
    ? "COMPLETE"
    : asr?.state === "SUCCEEDED"
      ? "PERSISTENCE_UNAVAILABLE"
      : "WAITING";
  const renderStatus =
    render?.state ?? (generation ? normalizedStatus(generation.stage) : "WAITING");
  return HUMAN_PIPELINE_STAGES.map((name) => ({
    name,
    status:
      name === "Prepare"
        ? "COMPLETE"
        : name === "Transcribe"
          ? asrStatus
          : name === "Understand context"
            ? voiceoverContext?.state === "SUCCEEDED"
              ? "COMPLETE"
              : (voiceoverContext?.state ??
                (asr?.state === "SUCCEEDED" ? "ACTION_REQUIRED" : "WAITING"))
            : name === "Plan"
              ? planStatus
              : name === "Review"
                ? render?.state === "SUCCEEDED"
                  ? "REVIEW_REQUIRED"
                  : "WAITING"
                : name === "Technical check" || name === "Assemble"
                  ? renderStatus
                  : "NOT_REPORTED",
    detail: "Durable stage detail was not returned by the hosted service.",
  }));
}

function hostedStageStatus(status: string): ProjectStage["status"] {
  const normalized = status.toUpperCase();
  if (["COMPLETE", "SUCCEEDED", "APPROVED", "READY_FOR_REVIEW"].includes(normalized))
    return "COMPLETE";
  if (
    [
      "RUNNING",
      "ACTIVE",
      "ADMITTED",
      "SUBMITTED",
      "OUTBOXED",
      "ASSIGNED",
      "IN_PROGRESS",
      "UPLOADING",
      "RECONCILING",
    ].includes(normalized)
  )
    return "RUNNING";
  if (["STARTING", "PREPARING", "RECONCILING"].includes(normalized)) return "STARTING";
  if (["RETRYING", "RETRY_WAIT"].includes(normalized)) return "RETRYING";
  if (["ACTION_REQUIRED"].includes(normalized)) return "ACTION_REQUIRED";
  if (["FAILED", "PERMANENT_FAILED", "RETRYABLE_FAILED"].includes(normalized)) return "FAILED";
  if (["CANCEL_REQUESTED"].includes(normalized)) return "CANCEL_REQUESTED";
  if (["CANCELLED"].includes(normalized)) return "CANCELLED";
  // A GPU lane reads exactly like every other stage: PENDING until it is dispatched, RUNNING from the
  // moment the pair is assigned. Waiting on GPU qualification is a pre-dispatch state, not a blockage,
  // so it must not borrow the blocked badge -- the terminal banner still reports genuine
  // UNQUALIFIED/UNAVAILABLE/BLOCKED conditions.
  if (["ASSIGNED", "SUBMITTED", "DISPATCHED", "OUTBOXED", "GENERATING"].includes(normalized))
    return "RUNNING";
  if (
    [
      "QUEUED",
      "IN_QUEUE",
      "WAITING_FOR_GPU",
      "WAITING_FOR_GPUS",
      "WAITING_FOR_GPU_QUALIFICATION",
      "WAITING_FOR_WORKER",
      "READY_FOR_GPU_DISPATCH",
      "MANIFEST_DURABLE",
      "WAITING",
      "NOT_STARTED",
      "NOT_REPORTED",
    ].includes(normalized)
  )
    return "PENDING";
  if (normalized.includes("BLOCKED") || normalized.includes("UNAVAILABLE")) return "BLOCKED";
  return "PENDING";
}

function hostedProgressValue(stage: HostedStage): number {
  if (typeof stage.progress_percent === "number")
    return Math.max(0, Math.min(100, stage.progress_percent));
  return hostedStageStatus(stage.status) === "COMPLETE" ? 100 : 0;
}

function hostedGpuLaneStageStatus(lane: HostedGpuLaneActivity): ProjectStage["status"] | null {
  const state = hostedGpuLaneDisplayState(lane);
  if (state === "UNKNOWN_NO_RETRY") return "ACTION_REQUIRED";
  if (state === "BLOCKED") return "BLOCKED";
  if (state === "SUCCEEDED") return "COMPLETE";
  if (["FAILED", "PERMANENT_FAILED", "DEAD_LETTER"].includes(state)) return "FAILED";
  if (state === "RETRYABLE_FAILED") return "FAILED";
  if (["CANCELLED", "CANCELLING"].includes(state)) return "CANCELLED";
  if (state === "CANCEL_REQUESTED") return "CANCEL_REQUESTED";
  if (["IN_QUEUE", "WAITING_FOR_GPU", "WAITING_FOR_GPUS", "WAITING_FOR_WORKER"].includes(state))
    return "QUEUED";
  if (
    [
      "OUTBOXED",
      "ASSIGNED",
      "SUBMITTING",
      "SUBMITTED",
      "IN_PROGRESS",
      "RUNNING",
      "UPLOADING",
      "RECONCILING",
    ].includes(state)
  )
    return "RUNNING";
  return null;
}

function hostedProjectStages(
  stages: readonly HostedStage[],
  gpuLanes: readonly HostedGpuLaneActivity[] = [],
  apiGeneration = false,
): ProjectStage[] {
  const laneByStageId = new Map<string, HostedGpuLaneActivity>([
    ["image-generation", gpuLanes.find((lane) => lane.lane === "mage_image")!],
    ["avatar-generation", gpuLanes.find((lane) => lane.lane === "soulx_avatar")!],
  ]);
  return stages.map((stage, index) => {
    const id = stage.id ?? `stage-${index + 1}`;
    const lane = laneByStageId.get(id);
    const laneStatus = lane ? hostedGpuLaneStageStatus(lane) : null;
    const lanePhase = lane ? hostedGpuLanePhase(lane, apiGeneration) : null;
    const planned = lane?.planned_item_count ?? null;
    const completed = lane
      ? hostedGpuLaneAcceptedCount(lane)
      : Math.round(hostedProgressValue(stage));
    const hasItemCounts = lane !== undefined && planned !== null && planned > 0;
    return {
      id,
      label: stage.name,
      status: laneStatus ?? hostedStageStatus(stage.status),
      completed: hasItemCounts ? Math.min(completed, planned!) : completed,
      total: hasItemCounts ? planned! : 100,
      detail:
        lane && hasItemCounts
          ? `${completed} of ${planned} accepted · ${
              lanePhase?.detail ?? stage.detail ?? "Waiting for an authoritative update."
            }`
          : (lanePhase?.detail ?? stage.detail ?? "Waiting for an authoritative update."),
    };
  });
}

export function HostedCreateProjectScreen() {
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: readHostedCatalog,
  });
  const [title, setTitle] = useState("");
  const [avatarVersionId, setAvatarVersionId] = useState("");
  const [styleVersionId, setStyleVersionId] = useState("");
  const [voiceover, setVoiceover] = useState<File | null>(null);
  const [extraPromptKeywords, setExtraPromptKeywords] = useState("");
  const [applyExtraPromptKeywords, setApplyExtraPromptKeywords] = useState(false);
  const [userSeed, setUserSeed] = useState("");
  const [voiceoverMeta, setVoiceoverMeta] = useState<{
    readonly filename: string;
    readonly contentType: string;
    readonly checksumSha256: string;
    readonly durationMs: number;
  } | null>(null);
  const [preflightResult, setPreflightResult] = useState<HostedPreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createRequest = useRef<{ readonly body: string; readonly key: string } | null>(null);
  const contentTypeForVoiceover = (file: File): string => {
    if (/\.wav$/iu.test(file.name)) return "audio/wav";
    if (/\.mp3$/iu.test(file.name)) return "audio/mpeg";
    return VOICEOVER_TYPES.has(file.type) ? file.type : "";
  };
  const keywordsValid = extraPromptKeywords.length <= 500;
  const workerOnline = catalog.data?.media_worker_state === "ONLINE";
  const inputChecklist = [
    { label: "Video title", complete: Boolean(title.trim()) },
    { label: "Voiceover", complete: Boolean(voiceover) },
    { label: "Avatar", complete: Boolean(avatarVersionId) },
    { label: "Image style", complete: Boolean(styleVersionId) },
  ];
  useEffect(() => {
    if (!catalog.data) return;
    if (!avatarVersionId && catalog.data.avatars.length === 1) {
      setAvatarVersionId(catalog.data.avatars[0]!.version_id);
    }
    if (!styleVersionId && catalog.data.styles.length === 1) {
      setStyleVersionId(catalog.data.styles[0]!.version_id);
    }
  }, [avatarVersionId, catalog.data, styleVersionId]);
  const canPreflight = Boolean(
    title.trim() && avatarVersionId && styleVersionId && voiceover && keywordsValid,
  );
  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (!voiceover) throw new Error("Choose a voiceover first.");
      const contentType = contentTypeForVoiceover(voiceover);
      if (!VOICEOVER_TYPES.has(contentType))
        throw new Error("Use a WAV or MP3 voiceover for hosted generation.");
      if (voiceover.size > MAX_VOICEOVER_BYTES) throw new Error("Voiceover must be at most 1 GB.");
      const checksumSha256 = await hostedFileSha256(voiceover);
      const filename = hostedVoiceoverFilename(voiceover.name, contentType, checksumSha256);
      const durationMs = await bounded(
        audioDurationMs(voiceover),
        "Voiceover duration timed out. Choose a valid WAV or MP3 file and retry.",
        15_000,
      );
      const result = await bounded(
        readJson<HostedPreflightResponse>("/api/v2/hosted/projects/preflight", {
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-project-preflight/v1",
            title: title.trim(),
            avatar_profile_version_id: avatarVersionId,
            image_style_version_id: styleVersionId,
            extra_prompt_keywords: applyExtraPromptKeywords ? extraPromptKeywords.trim() : "",
            apply_extra_prompt_keywords: applyExtraPromptKeywords,
            user_seed: userSeed.trim() ? Number(userSeed) : null,
            voiceover: {
              filename,
              content_type: contentType,
              content_length: voiceover.size,
              checksum_sha256: checksumSha256,
              duration_ms: durationMs,
            },
          }),
        }),
        "Hosted preflight timed out. Retry the readiness check.",
      );
      return { result, filename, contentType, checksumSha256, durationMs };
    },
    onSuccess: ({ result, filename, contentType, checksumSha256, durationMs }) => {
      setVoiceoverMeta({ filename, contentType, checksumSha256, durationMs });
      setPreflightResult(result);
      setError(null);
    },
    onError: (value) => {
      setPreflightResult(null);
      setError(value instanceof Error ? value.message : "Hosted preflight failed.");
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!voiceover) throw new Error("Choose a voiceover first.");
      const checked = preflightReady(preflightResult)
        ? null
        : await preflightMutation.mutateAsync();
      if (!preflightReady(checked?.result ?? preflightResult))
        throw new Error("Project inputs are not ready. Fix the blockers below.");
      setError(null);
      const metadata =
        checked ??
        voiceoverMeta ??
        (() => {
          throw new Error("Run the readiness check again before generating.");
        })();
      const body = {
        schema_version: HOSTED_CREATE_SCHEMA,
        title: title.trim(),
        avatar_profile_version_id: avatarVersionId,
        image_style_version_id: styleVersionId,
        extra_prompt_keywords: applyExtraPromptKeywords ? extraPromptKeywords.trim() : "",
        apply_extra_prompt_keywords: applyExtraPromptKeywords,
        user_seed: userSeed.trim() ? Number(userSeed) : null,
        voiceover: {
          filename: metadata.filename,
          content_type: metadata.contentType,
          content_length: voiceover.size,
          checksum_sha256: metadata.checksumSha256,
          duration_ms: metadata.durationMs,
        },
      };
      const serializedBody = JSON.stringify(body);
      if (createRequest.current?.body !== serializedBody) {
        createRequest.current = {
          body: serializedBody,
          key: `browser-project-${crypto.randomUUID()}`,
        };
      }
      const created = await bounded(
        readJson<{
          project_id: string;
          state: "UPLOAD_PENDING" | "READY";
          upload: null | {
            url: string;
            requiredHeaders: Readonly<Record<string, string>>;
          };
        }>("/api/v2/hosted/projects", {
          method: "POST",
          headers: { "idempotency-key": createRequest.current.key },
          body: serializedBody,
        }),
        "Hosted project creation timed out. Retry from Create Project.",
      );
      if (created.upload) await putHostedUpload(created.upload, voiceover);
      const ready = await bounded(
        readJson<{ project_id: string; cpu_submission: unknown }>(
          `/api/v2/hosted/projects/${created.project_id}/commit`,
          { method: "POST", body: "{}" },
        ),
        "Hosted project commit timed out. Retry from Create Project.",
      );
      await bounded(
        readJson("/api/v2/cpu-attempts", {
          method: "POST",
          body: JSON.stringify(ready.cpu_submission),
        }),
        "Hosted ASR submission timed out. Retry from Create Project.",
      );
      return ready.project_id;
    },
    onSuccess: (projectId) => window.location.assign(`/projects/${projectId}`),
    onError: (value) =>
      setError(value instanceof Error ? value.message : "Project could not be created."),
  });

  if (catalog.isPending)
    return (
      <Panel eyebrow="Hosted project" heading="Loading private catalog">
        <p>Checking presets and your computer…</p>
      </Panel>
    );
  if (catalog.isError || !catalog.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Create Project unavailable"
        body="Hosted tenant catalog could not be loaded."
        action={
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader title="New project" />
      <div className="layout-main hosted-project-layout">
        <Panel className="create-config-panel hosted-project-form">
          <section className="create-section" aria-labelledby="hosted-project-video">
            <header className="create-section-header">
              <span className="create-section-index">01</span>
              <div>
                <h3 id="hosted-project-video">Video</h3>
              </div>
            </header>
            <div className="create-section-grid">
              <div className="field field-wide">
                <label htmlFor="hosted-project-title">Video title</label>
                <input
                  id="hosted-project-title"
                  className="input"
                  value={title}
                  maxLength={240}
                  placeholder="Clear project title"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setPreflightResult(null);
                  }}
                />
              </div>
              <div className="field field-wide">
                <span className="field-label">Final voiceover</span>
                <label className="dropzone hosted-voiceover-dropzone">
                  <input
                    aria-label="Final voiceover"
                    type="file"
                    accept="audio/wav,audio/mpeg,.wav,.mp3"
                    disabled={preflightMutation.isPending || submit.isPending}
                    onChange={(event) => {
                      const selected = event.target.files?.[0] ?? null;
                      setPreflightResult(null);
                      setVoiceoverMeta(null);
                      if (!selected) {
                        setVoiceover(null);
                        setError(FILE_ACCESS_HINT);
                        return;
                      }
                      if (selected.size > MAX_VOICEOVER_BYTES) {
                        setVoiceover(null);
                        setError("Voiceover must be at most 1 GB.");
                        return;
                      }
                      setVoiceover(selected);
                      setError(null);
                    }}
                  />
                  <FileAudio size={28} />
                  <span>
                    <strong>{voiceover?.name ?? "Choose your final voiceover"}</strong>
                    {voiceover
                      ? `${(voiceover.size / 1_000_000).toFixed(1)} MB · ready to check`
                      : "WAV or MP3 · 10 seconds to 60 minutes · max 1 GB"}
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section className="create-section" aria-labelledby="hosted-project-look">
            <header className="create-section-header">
              <span className="create-section-index">02</span>
              <div>
                <h3 id="hosted-project-look">Look</h3>
              </div>
            </header>
            <div className="create-section-grid">
              <div className="field preset-field">
                <VisualPresetSelect
                  id="hosted-avatar-select"
                  label="Avatar"
                  options={catalog.data.avatars.map((avatar) => ({
                    id: avatar.version_id,
                    imageUrl: avatar.thumbnail_url ?? "",
                    meta: `Version ${avatar.version_number}${
                      avatar.avatar_video_source_ready === false ? " · no avatar video yet" : ""
                    }`,
                    name: avatar.name,
                  }))}
                  selectedId={avatarVersionId}
                  onChange={(value) => {
                    setAvatarVersionId(value);
                    setPreflightResult(null);
                  }}
                />
                <div className="preset-select-actions">
                  <Link
                    className="button button-secondary"
                    to="/avatars/new"
                    search={{ returnTo: "/projects/new" } as never}
                  >
                    <UserPlus size={15} /> New avatar
                  </Link>
                </div>
              </div>
              <div className="field preset-field">
                <VisualPresetSelect
                  id="hosted-style-select"
                  label="Image style"
                  options={catalog.data.styles.map((style) => ({
                    id: style.version_id,
                    imageUrl: style.cover_url ?? "",
                    meta: `Version ${style.version_number}`,
                    name: style.name,
                  }))}
                  selectedId={styleVersionId}
                  onChange={(value) => {
                    setStyleVersionId(value);
                    setPreflightResult(null);
                  }}
                />
                <div className="preset-select-actions">
                  <Link
                    className="button button-secondary"
                    to="/styles/new"
                    search={{ returnTo: "/projects/new" } as never}
                  >
                    <ImagePlus size={15} /> New style
                  </Link>
                </div>
              </div>
              <Disclosure className="field field-wide create-options" summary="Optional settings">
                <div className="stack">
                  <label className="toggle-row">
                    <span>
                      <strong>Add image keywords</strong>
                      <small>Guide scene images with extra words.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={applyExtraPromptKeywords}
                      onChange={(event) => {
                        setApplyExtraPromptKeywords(event.target.checked);
                        setPreflightResult(null);
                      }}
                    />
                  </label>
                  {applyExtraPromptKeywords ? (
                    <div className="field">
                      <label htmlFor="hosted-image-keywords">Image keywords</label>
                      <textarea
                        id="hosted-image-keywords"
                        className="textarea"
                        value={extraPromptKeywords}
                        maxLength={500}
                        rows={3}
                        onChange={(event) => {
                          setExtraPromptKeywords(event.target.value);
                          setPreflightResult(null);
                        }}
                        placeholder="natural light, tactile materials"
                      />
                      <small>{extraPromptKeywords.length}/500 characters</small>
                    </div>
                  ) : null}
                  <div className="field">
                    <label htmlFor="hosted-user-seed">Variation (optional)</label>
                    <input
                      id="hosted-user-seed"
                      className="input"
                      inputMode="numeric"
                      type="number"
                      value={userSeed}
                      onChange={(event) => {
                        setUserSeed(event.target.value);
                        setPreflightResult(null);
                      }}
                      placeholder="Automatic"
                    />
                  </div>
                </div>
              </Disclosure>
            </div>
          </section>
        </Panel>

        <Panel className="create-run-panel hosted-project-summary" heading="Cost & readiness">
          <div className={`run-readiness ${workerOnline ? "ready" : "blocked"}`} role="status">
            {workerOnline ? <Check size={18} /> : <AlertTriangle size={18} />}
            <span>
              <strong>
                {workerOnline ? "Your computer is connected" : "Connect your computer"}
              </strong>
              <small>
                {workerOnline
                  ? "Ready when inputs are complete."
                  : "Connect your media worker in Settings."}
              </small>
            </span>
          </div>
          {!workerOnline ? (
            <Link className="button button-secondary" to="/settings">
              Open Settings
            </Link>
          ) : null}

          <div className="hosted-project-checklist" aria-label="Project requirements">
            {inputChecklist.map((item) => (
              <span className={item.complete ? "complete" : ""} key={item.label}>
                {item.complete ? <Check size={16} /> : <span aria-hidden="true">○</span>}
                {item.label}
              </span>
            ))}
          </div>

          {preflightResult ? (
            <div
              className={
                preflightReady(preflightResult)
                  ? "validation validation-success"
                  : "validation validation-danger"
              }
            >
              <strong>
                {preflightReady(preflightResult) ? "Ready to create" : "Not ready yet"}
              </strong>
              <span>
                {" "}
                {catalog.data.generation_provider === "KIE_FAL"
                  ? "API usage is billed after generation."
                  : hostedPreflightEstimateText(
                      preflightResult.estimate,
                      catalog.data.gpu_readiness.dispatch_available,
                    )}
              </span>
            </div>
          ) : null}
          {preflightBlockers(preflightResult).length > 0 ? (
            <div className="validation validation-danger">
              <strong>Fix these blockers:</strong>
              <ul>
                {preflightBlockers(preflightResult).map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!keywordsValid ? (
            <p className="validation validation-danger">
              Extra prompt keywords must be at most 500 characters.
            </p>
          ) : null}
          {voiceoverMeta ? (
            <p className="helper">Voiceover · {formatMilliseconds(voiceoverMeta.durationMs)}</p>
          ) : null}
          {catalog.data.generation_provider !== "KIE_FAL" &&
          !catalog.data.gpu_readiness.dispatch_available ? (
            <p className="helper hosted-beta-note" role="note">
              Creation runs through prompt writing. Final video generation is unavailable; no paid
              GPU work will start.
            </p>
          ) : null}
          <Button
            busy={preflightMutation.isPending || submit.isPending}
            disabled={
              (!canPreflight && !preflightReady(preflightResult)) ||
              preflightMutation.isPending ||
              submit.isPending ||
              (preflightReady(preflightResult) && catalog.data.media_worker_state !== "ONLINE")
            }
            onClick={() => submit.mutate()}
          >
            <FileAudio size={16} />
            Create project & start
          </Button>
        </Panel>
      </div>
      {error ? (
        <div className="validation validation-danger" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

type HostedPresetHubKind = "avatars" | "styles";

interface HostedPresetDeleteInput {
  readonly kind: HostedPresetHubKind;
  readonly id: string;
}

type HostedPresetCatalogItem =
  | CatalogResponse["avatars"][number]
  | CatalogResponse["styles"][number]
  | HostedAvatarDraft
  | HostedStyleDraft;

interface HostedPresetHubItem {
  readonly item: HostedPresetCatalogItem;
  readonly draft: boolean;
}

/** Show ready presets and saved workspace drafts without mixing drafts into project selectors. */
function HostedPresetHubScreen({ kind }: { kind: HostedPresetHubKind }) {
  const [search, setSearch] = useState("");
  const catalog = useQuery({
    queryKey: ["hosted-project-catalog"],
    queryFn: readHostedCatalog,
  });
  const isAvatar = kind === "avatars";
  const publishedItems: readonly HostedPresetCatalogItem[] = catalog.data
    ? isAvatar
      ? catalog.data.avatars
      : catalog.data.styles
    : [];
  const draftItems: readonly HostedPresetCatalogItem[] = catalog.data
    ? isAvatar
      ? (catalog.data.avatar_drafts ?? [])
      : (catalog.data.style_drafts ?? [])
    : [];
  const allItems: readonly HostedPresetHubItem[] = [
    ...publishedItems.map((item) => ({ item, draft: false as const })),
    ...draftItems.map((item) => ({ item, draft: true as const })),
  ];
  const title = isAvatar ? "Avatar Hub" : "Image Styles";
  const itemLabel = isAvatar ? "avatar" : "style";
  const Icon = isAvatar ? UsersRound : Images;
  const creationAvailable = isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE);
  const deletePreset = useMutation({
    mutationFn: async ({ kind: deleteKind, id }: HostedPresetDeleteInput) => {
      const resource = deleteKind === "avatars" ? "avatars" : "styles";
      await readJson<unknown>(`/api/v2/hosted/${resource}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: "{}",
      });
    },
    onSuccess: async () => {
      await catalog.refetch();
    },
  });
  const visibleItems = allItems.filter(({ item }) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const visibleDraftItems = visibleItems.filter(({ draft }) => draft);
  const visiblePublishedItems = visibleItems.filter(({ draft }) => !draft);

  function renderCard({ item, draft }: HostedPresetHubItem) {
    const state = presetState(item);
    const healthy = !draft && (isAvatar ? state === "READY" : state === "PUBLISHED");
    const resumable =
      draft && ("profile_id" in item || "style_id" in item)
        ? hostedDraftIsResumable(kind, item as HostedAvatarDraft | HostedStyleDraft)
        : false;
    const resourceId = draft
      ? item.version_id
      : isAvatar && "profile_id" in item
        ? item.profile_id
        : !isAvatar && "style_id" in item
          ? item.style_id
          : item.version_id;
    const systemOwned =
      item.scope_kind === "SYSTEM" ||
      ("rights_status" in item && item.rights_status === "SYSTEM_OWNED");
    const imageUrl =
      isAvatar && "thumbnail_url" in item
        ? item.thumbnail_url
        : !isAvatar && "cover_url" in item
          ? item.cover_url
          : null;
    const referenceCount = !isAvatar && "reference_count" in item ? (item.reference_count ?? 0) : 0;
    const referenceUrls =
      !isAvatar && "reference_urls" in item && Array.isArray(item.reference_urls)
        ? item.reference_urls
        : [];
    const styleProfile =
      !isAvatar && "profile" in item ? hostedStyleProfileView(item.profile) : null;
    const referencesVerified =
      isAvatar || !("references_verified" in item) ? true : item.references_verified === true;
    const requestRemoval = () => {
      if (
        !window.confirm(
          `Remove this ${itemLabel} from your ${isAvatar ? "Avatar Hub" : "Image Styles"}? Existing projects will keep their pinned version.`,
        )
      )
        return;
      deletePreset.mutate({ kind, id: resourceId });
    };
    const media = (
      <div className={isAvatar ? "avatar-card-media" : "style-card-media"}>
        {imageUrl ? (
          <PresetImage src={imageUrl} alt={`${item.name} ${isAvatar ? "presenter" : "cover"}`} />
        ) : (
          <span
            className={`preset-image-fallback ${isAvatar ? "hosted-avatar-placeholder" : "hosted-style-placeholder"}`}
            role="img"
            aria-label={`${item.name} ${isAvatar ? "presenter" : "cover"} unavailable`}
          >
            <Icon aria-hidden="true" />
          </span>
        )}
        {!healthy ? (
          <Badge tone={statusTone(state)}>
            {draft ? unfinishedPresetLabel(state) : normalizedStatus(state)}
          </Badge>
        ) : null}
      </div>
    );

    if (draft) {
      return (
        <article
          className={`entity-card ${isAvatar ? "avatar-card" : "style-card"} preset-draft-card`}
          key={item.version_id}
        >
          {media}
          <div className="entity-card-body">
            <div className="entity-title-row">
              <h3>{item.name}</h3>
            </div>
            <p className="preset-draft-description">
              {unfinishedPresetDescription(kind, state, referenceCount, referencesVerified)}
            </p>
            <div className="preset-draft-actions">
              {resumable ? (
                <a
                  className="button button-primary"
                  href={hostedPresetResumeHref(kind, item.version_id)}
                >
                  Continue setup <ArrowRight size={16} aria-hidden="true" />
                </a>
              ) : null}
              {!systemOwned ? (
                <Button
                  className="preset-remove-button"
                  variant="danger"
                  busy={deletePreset.isPending && deletePreset.variables?.id === resourceId}
                  disabled={deletePreset.isPending}
                  onClick={requestRemoval}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {deletePreset.isPending && deletePreset.variables?.id === resourceId
                    ? `Removing ${itemLabel}…`
                    : `Remove ${itemLabel}`}
                </Button>
              ) : null}
            </div>
            {deletePreset.isError && deletePreset.variables?.id === resourceId ? (
              <div className="validation validation-danger" role="alert">
                {deletePreset.error instanceof Error
                  ? deletePreset.error.message
                  : `This ${itemLabel} could not be removed right now.`}
              </div>
            ) : null}
          </div>
        </article>
      );
    }

    return (
      <article
        className={`entity-card ${isAvatar ? "avatar-card" : "style-card"}`}
        key={item.version_id}
      >
        {media}
        <div className="entity-card-body">
          <div className="entity-title-row">
            <h3>{item.name}</h3>
          </div>
        </div>
        <div className="preset-card-actions">
          <DetailsSheet
            title={item.name}
            description={`Version ${item.version_number}`}
            trigger={
              <button className="entity-details-trigger" type="button">
                <strong>Details</strong>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            }
          >
            {isAvatar ? (
              <>
                {imageUrl ? (
                  <div className="avatar-crop-grid">
                    <figure>
                      <PresetImage src={imageUrl} alt={`${item.name} full avatar crop`} />
                      <figcaption>Full frame</figcaption>
                    </figure>
                    <figure className="split-crop">
                      <PresetImage src={imageUrl} alt={`${item.name} split avatar crop`} />
                      <figcaption>Split crop</figcaption>
                    </figure>
                  </div>
                ) : null}
                <div className="detail-facts">
                  <span>
                    <small>Ready to use</small>
                    <strong>Ready</strong>
                  </span>
                  <span>
                    <small>Rights &amp; consent</small>
                    <strong>
                      {"rights_status" in item && item.rights_status === "ATTESTED"
                        ? "Attested"
                        : "Included"}
                    </strong>
                  </span>
                </div>
              </>
            ) : (
              <StyleProfileDetails
                name={item.name}
                imageUrl={imageUrl ?? null}
                referenceUrls={referenceUrls}
                referenceCount={referenceCount}
                profile={styleProfile}
              />
            )}
          </DetailsSheet>
          {!systemOwned ? (
            <Button
              className="preset-remove-button"
              variant="danger"
              busy={deletePreset.isPending && deletePreset.variables?.id === resourceId}
              disabled={deletePreset.isPending}
              onClick={requestRemoval}
            >
              <Trash2 size={16} aria-hidden="true" />
              {deletePreset.isPending && deletePreset.variables?.id === resourceId
                ? `Removing ${itemLabel}…`
                : `Remove ${itemLabel}`}
            </Button>
          ) : null}
        </div>
        {deletePreset.isError && deletePreset.variables?.id === resourceId ? (
          <div className="validation validation-danger preset-card-delete-error" role="alert">
            {deletePreset.error instanceof Error
              ? deletePreset.error.message
              : `This ${itemLabel} could not be removed right now.`}
          </div>
        ) : null}
      </article>
    );
  }

  if (catalog.isPending) {
    return (
      <Panel heading={`Loading ${title}`}>
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading…</p>
        </div>
      </Panel>
    );
  }
  if (catalog.isError || !catalog.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={`${title} unavailable`}
        body={`Your ${itemLabel} library could not be loaded.`}
        action={
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        actions={
          creationAvailable ? (
            <Link className="button button-primary" to={isAvatar ? "/avatars/new" : "/styles/new"}>
              {isAvatar ? <UsersRound size={16} /> : <Images size={16} />}
              New {itemLabel}
            </Link>
          ) : undefined
        }
      />
      <div className="hub-toolbar">
        <label className="search-field">
          <span className="sr-only">Search {isAvatar ? "avatars" : "image styles"}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isAvatar ? "Search avatars" : "Search styles"}
          />
        </label>
      </div>
      <Panel className="hub-panel">
        {allItems.length === 0 ? (
          <EmptyState
            icon={<Icon />}
            title={`No ready ${itemLabel}s yet`}
            body={`Add a reusable ${itemLabel} to use in a project.`}
            action={
              creationAvailable ? (
                <Link
                  className="button button-primary"
                  to={isAvatar ? "/avatars/new" : "/styles/new"}
                >
                  Create your first {itemLabel}
                </Link>
              ) : undefined
            }
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={<Icon />}
            title={`No matching ${itemLabel}s`}
            body="Clear or change the search to see your library."
          />
        ) : (
          <>
            {visibleDraftItems.length > 0 ? (
              <section className="hub-drafts-section" aria-labelledby={`${kind}-drafts-heading`}>
                <header className="hub-section-heading">
                  <div>
                    <h2 id={`${kind}-drafts-heading`}>Continue setup</h2>
                  </div>
                  <Badge tone="warning">{visibleDraftItems.length}</Badge>
                </header>
                <div className={`card-grid ${isAvatar ? "avatar-card-grid" : "style-card-grid"}`}>
                  {visibleDraftItems.map(renderCard)}
                </div>
              </section>
            ) : null}
            {visiblePublishedItems.length > 0 ? (
              <div className={`card-grid ${isAvatar ? "avatar-card-grid" : "style-card-grid"}`}>
                {visiblePublishedItems.map(renderCard)}
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </>
  );
}

export function HostedAvatarHubScreen() {
  return <HostedPresetHubScreen kind="avatars" />;
}

export function HostedStylesHubScreen() {
  return <HostedPresetHubScreen kind="styles" />;
}

export function HostedPresetCreationUnavailableScreen({ kind }: { kind: HostedPresetHubKind }) {
  const isAvatar = kind === "avatars";
  const title = isAvatar ? "Avatar Hub" : "Image Styles";
  const itemLabel = isAvatar ? "avatar" : "style";
  return (
    <>
      <PageHeader
        title={`${title} creation unavailable`}
        description="Preset creation is unavailable in this mode."
      />
      <EmptyState
        icon={isAvatar ? <UsersRound /> : <Images />}
        title="Read-only catalog"
        body={`Use an existing ${itemLabel}, or open Settings to check workspace status.`}
        action={
          <div className="cluster">
            <Link className="button button-secondary" to={isAvatar ? "/avatars" : "/styles"}>
              View {title}
            </Link>
            <Link className="button button-secondary" to="/settings">
              Settings
            </Link>
          </div>
        }
      />
    </>
  );
}

export function HostedPresetCreationScreen({
  kind,
  fixtureStyleAdapter,
}: {
  kind: HostedPresetHubKind;
  fixtureStyleAdapter?: FixtureStyleCreationAdapter;
}) {
  const isAvatar = kind === "avatars";
  const fixtureBackend = Boolean(fixtureStyleAdapter);
  const title = isAvatar ? "New avatar" : "New image style";
  const itemLabel = isAvatar ? "avatar" : "style";
  const params = new URLSearchParams(window.location.search);
  const defaultReturnTo = fixtureStyleAdapter?.returnTo ?? (isAvatar ? "/avatars" : "/styles");
  const returnTo = normalizeHostedReturnTo(params.get("returnTo"), defaultReturnTo);
  const parentId = params.get("parentId");
  const resumeStyleId = params.get("resumeStyleId");
  const resumeVersionId = params.get("resumeVersionId");
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [avatarSource, setAvatarSource] = useState<{
    readonly file: File;
    readonly objectUrl: string;
    readonly width: number;
    readonly height: number;
    readonly checksum: string;
  } | null>(null);
  const [styleSources, setStyleSources] = useState<
    readonly {
      readonly file: File;
      readonly objectUrl: string;
      readonly checksum: string;
      readonly normalized?: NormalizedStyleReference;
    }[]
  >([]);
  const [profileNotes, setProfileNotes] = useState("");
  const [created, setCreated] = useState<HostedPresetMutationResponse | null>(null);
  const [fixtureStyleVersion, setFixtureStyleVersion] =
    useState<ImageStyleHubVersionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createRequest = useRef<{ readonly body: string; readonly key: string } | null>(null);
  const fixtureResumeStarted = useRef<string | null>(null);
  const referenceRetryRequest = useRef<{ readonly body: string; readonly key: string } | null>(
    null,
  );
  const [resumeInitialized, setResumeInitialized] = useState(false);
  const [repairingReferences, setRepairingReferences] = useState(false);
  const catalog = useQuery({
    queryKey: fixtureBackend ? ["fixture-preset-catalog", kind] : ["hosted-project-catalog"],
    queryFn: async () => {
      if (!fixtureBackend) return readHostedCatalog();
      return { avatars: [], styles: await fixtureStyleAdapter!.listStyles() };
    },
  });
  const fixtureResume = useQuery({
    queryKey: ["fixture-style-draft", resumeStyleId, resumeVersionId],
    queryFn: () => fixtureStyleAdapter!.load(resumeStyleId!, resumeVersionId!),
    enabled: fixtureBackend && Boolean(resumeStyleId && resumeVersionId),
    retry: false,
  });
  const catalogValue = catalog.data as Partial<CatalogResponse> | undefined;
  const items = catalog.data ? (isAvatar ? catalog.data.avatars : catalog.data.styles) : [];
  const unfinishedItems = catalogValue
    ? isAvatar
      ? (catalogValue.avatar_drafts ?? [])
      : (catalogValue.style_drafts ?? [])
    : [];
  const resumedDraft = resumeVersionId
    ? unfinishedItems.find((item) => item.version_id === resumeVersionId)
    : undefined;
  const resumedDraftActive = Boolean(resumeVersionId && created);
  const matchingDraft = unfinishedItems.find(
    (item) =>
      item.version_id !== resumeVersionId &&
      item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const matchingDraftName = Boolean(matchingDraft);
  const matchingDraftResumable = Boolean(
    matchingDraft && hostedDraftIsResumable(kind, matchingDraft),
  );
  const duplicateReadyName = items.some(
    (item) => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const duplicateName = matchingDraftName || duplicateReadyName;
  const hasRequiredSource = isAvatar
    ? Boolean(avatarSource)
    : styleSources.length >= MIN_STYLE_REFERENCES;
  const stepOneReady = Boolean(name.trim()) && !duplicateName && hasRequiredSource && !busy;
  const stepOneHint = repairingReferences
    ? hasRequiredSource
      ? "Replacement references ready."
      : `Select ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} images.`
    : matchingDraftName
      ? matchingDraftResumable
        ? `Draft already exists. Continue from the Hub.`
        : `Draft already exists. Open the Hub to remove it.`
      : duplicateReadyName
        ? "Name already in use."
        : !name.trim() && !hasRequiredSource
          ? `Add a name and ${isAvatar ? "photo" : "images"}.`
          : !name.trim()
            ? "Add a name."
            : !hasRequiredSource
              ? isAvatar
                ? "Choose a photo."
                : `Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} images.`
              : "Ready.";

  useEffect(
    () => () => {
      if (avatarSource) URL.revokeObjectURL(avatarSource.objectUrl);
      for (const source of styleSources) URL.revokeObjectURL(source.objectUrl);
    },
    [avatarSource, styleSources],
  );

  useEffect(() => {
    if (fixtureBackend || !resumeVersionId || !catalog.data || resumeInitialized) return;
    setResumeInitialized(true);
    if (!resumedDraft) {
      setError(
        `This saved ${itemLabel} is no longer available. Return to ${isAvatar ? "Avatar Hub" : "Image Styles"}.`,
      );
      return;
    }
    const draftState = presetState(resumedDraft);
    setName(resumedDraft.name);
    setCreated(hostedDraftResponse(resumedDraft));
    if (isAvatar && "profile_id" in resumedDraft) {
      setRepairingReferences(false);
      setStep(2);
    } else if (!isAvatar && "style_id" in resumedDraft) {
      if (draftState === "DRAFT" && resumedDraft.references_verified !== true) {
        setRepairingReferences(true);
        setStep(1);
        return;
      }
      setRepairingReferences(false);
      setStep(draftState === "NEEDS_REVIEW" ? 4 : 3);
    }
  }, [
    catalog.data,
    fixtureBackend,
    isAvatar,
    itemLabel,
    resumeInitialized,
    resumeVersionId,
    resumedDraft,
  ]);

  useEffect(() => {
    if (!fixtureBackend || !resumeStyleId || !resumeVersionId) return;
    const resumeKey = `${resumeStyleId}:${resumeVersionId}`;
    if (fixtureResumeStarted.current === resumeKey) return;
    if (fixtureResume.isError) {
      fixtureResumeStarted.current = resumeKey;
      setError(
        fixtureResume.error instanceof Error
          ? fixtureResume.error.message
          : "The saved style could not be loaded.",
      );
      return;
    }
    const fixture = fixtureResume.data;
    if (!fixture) return;
    fixtureResumeStarted.current = resumeKey;
    if (fixture.style_id !== resumeStyleId || fixture.version_id !== resumeVersionId) {
      setError("The saved style response did not match the requested draft.");
      return;
    }
    if (fixture.state !== "REFERENCES_READY" && fixture.state !== "NEEDS_REVIEW") {
      setError("This saved style is no longer available for setup.");
      return;
    }
    setError(null);
    setName(fixture.name);
    setFixtureStyleVersion(fixture);
    setCreated(fixtureStyleResponse(fixture));
    setStep(fixture.state === "NEEDS_REVIEW" ? 4 : 3);
  }, [
    fixtureBackend,
    fixtureResume.data,
    fixtureResume.error,
    fixtureResume.isError,
    resumeStyleId,
    resumeVersionId,
  ]);

  function cancel() {
    window.location.assign(returnTo);
  }

  async function chooseAvatar(file?: File) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Avatar source must be at most 20 MB.");
      return;
    }
    setBusy(true);
    try {
      const dimensions = await imageDimensions(file);
      if (dimensions.width < 512 || dimensions.height < 512)
        throw new Error("Avatar source must be at least 512×512 pixels.");
      const checksum = await bounded(
        hostedFileSha256(file),
        "Avatar checksum timed out. Try again.",
        15_000,
      );
      if (avatarSource) URL.revokeObjectURL(avatarSource.objectUrl);
      setAvatarSource({
        file,
        objectUrl: URL.createObjectURL(file),
        ...dimensions,
        checksum,
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Avatar source validation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseStyleSources(selected: FileList | null) {
    setError(null);
    const files = Array.from(selected ?? []);
    if (files.length < MIN_STYLE_REFERENCES || files.length > MAX_STYLE_REFERENCES) {
      if (files.length > 0)
        setError(`Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} reference images.`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_STYLE_REFERENCE_BYTES);
    if (oversized) {
      setError("Each style reference must be at most 20 MB.");
      return;
    }
    setBusy(true);
    try {
      const normalized = await Promise.all(
        files.map((file) =>
          fixtureBackend
            ? fixtureStyleAdapter!.normalize(file)
            : bounded(
                normalizeImageStyleReference(file),
                `${file.name} normalization timed out. Try again.`,
                30_000,
              ),
        ),
      );
      if (
        normalized.reduce(
          (sum, source) => sum + base64ByteLength(source.normalized.bytesBase64),
          0,
        ) > MAX_STYLE_ANALYSIS_BYTES
      )
        throw new Error("Use a smaller reference set (30 MB total after normalization).");
      const nextSources = files.map((file, index) => ({
        file,
        checksum: normalized[index]!.original.checksum,
        objectUrl: normalized[index]!.objectUrl,
        normalized: normalized[index]!,
      }));
      for (const source of styleSources) URL.revokeObjectURL(source.objectUrl);
      setStyleSources(nextSources);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Style reference validation failed.");
    } finally {
      setBusy(false);
    }
  }

  function resourceId(value: HostedPresetMutationResponse): string {
    const id = value.id ?? value.profile_id ?? value.style_id ?? value.version_id;
    if (!id) throw new Error(`Hosted ${itemLabel} response did not include an id.`);
    return id;
  }

  function styleReferenceRequestBody() {
    if (styleSources.some((source) => !source.normalized))
      throw new Error("Reference normalization is incomplete. Choose the images again.");
    return {
      schema_version: "videoforge-hosted-style-reference-replace/v1",
      references: styleSources.map((source, index) => ({
        filename: source.file.name,
        content_type: source.file.type || "image/png",
        content_length: source.file.size,
        checksum_sha256: source.checksum,
        normalized_content_length: base64ByteLength(source.normalized!.normalized.bytesBase64),
        normalized_checksum_sha256: source.normalized!.normalized.checksum,
        normalized_width: source.normalized!.normalized.width,
        normalized_height: source.normalized!.normalized.height,
        order_index: index,
      })),
    };
  }

  async function uploadHostedStyleReferences(draft: HostedPresetMutationResponse): Promise<void> {
    const uploads = draft.uploads ?? (draft.upload ? [draft.upload] : []);
    const normalizedUploads = draft.normalized_uploads ?? [];
    if (uploads.length > 0 && uploads.length !== styleSources.length)
      throw new Error("Hosted style upload instructions did not match the selected references.");
    for (const [index, upload] of uploads.entries()) {
      const source = styleSources[index];
      if (source) await putHostedUpload(upload, source.file);
    }
    if (normalizedUploads.length !== styleSources.length)
      throw new Error(
        "Hosted style normalization upload instructions did not match the selected references.",
      );
    for (const [index, upload] of normalizedUploads.entries()) {
      const source = styleSources[index]?.normalized;
      if (!source) throw new Error("Reference normalization is incomplete.");
      const binary = atob(source.normalized.bytesBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      await putHostedUpload(
        upload,
        new File([bytes], `reference-${index + 1}.webp`, { type: "image/webp" }),
      );
    }
  }

  async function retryStyleReferences() {
    if (!created || isAvatar || !resumeVersionId || !repairingReferences || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (styleSources.length < MIN_STYLE_REFERENCES)
        throw new Error(
          `Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} private references.`,
        );
      const body = {
        schema_version: "videoforge-hosted-style-reference-replace/v1",
        references: styleReferenceRequestBody().references,
      };
      const serializedBody = JSON.stringify(body);
      if (referenceRetryRequest.current?.body !== serializedBody) {
        referenceRetryRequest.current = {
          body: serializedBody,
          key: `hosted-style-reference-retry-${crypto.randomUUID()}`,
        };
      }
      const targetVersionId = created.version_id ?? resumeVersionId;
      const replacement = await readJson<HostedPresetMutationResponse>(
        `/api/v2/hosted/styles/${encodeURIComponent(targetVersionId)}/references/retry`,
        {
          method: "POST",
          headers: { "idempotency-key": referenceRetryRequest.current.key },
          body: serializedBody,
        },
      );
      setCreated({ ...created, ...replacement });
      await uploadHostedStyleReferences(replacement);
      const replacementVersionId = replacement.version_id ?? replacement.id;
      if (!replacementVersionId)
        throw new Error("The repaired style draft did not include a version to continue.");
      const committed = await readJson<HostedPresetMutationResponse>(
        `/api/v2/hosted/styles/${encodeURIComponent(replacementVersionId)}/commit`,
        { method: "POST", body: "{}" },
      );
      setCreated({
        ...replacement,
        ...committed,
        id: committed.id ?? replacementVersionId,
        version_id: committed.version_id ?? replacementVersionId,
      });
      setRepairingReferences(false);
      setStep(3);
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "The replacement references could not be saved. Choose the images again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createDraft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error(`Enter a ${itemLabel} name.`);
      if (duplicateName) throw new Error(`Use a unique ${itemLabel} name.`);
      if (isAvatar && !avatarSource) throw new Error("Choose one private avatar source.");
      if (!isAvatar && styleSources.length < MIN_STYLE_REFERENCES)
        throw new Error(
          `Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} private references.`,
        );
      if (fixtureBackend) {
        if (isAvatar) throw new Error("Fixture avatar creation is not available in this adapter.");
        if (styleSources.some((source) => !source.normalized))
          throw new Error("Reference normalization is incomplete. Choose the files again.");
        const fixture = await fixtureStyleAdapter!.createAndRegister(
          name.trim(),
          styleSources.map((source) => source.normalized!),
        );
        const resumeKey = `${fixture.style_id}:${fixture.version_id}`;
        fixtureResumeStarted.current = resumeKey;
        persistFixtureStyleResumeIdentity(fixture);
        setFixtureStyleVersion(fixture);
        setCreated(fixtureStyleResponse(fixture));
        setStep(3);
        return;
      }
      const body = isAvatar
        ? {
            schema_version: "videoforge-hosted-avatar-create/v1",
            name: name.trim(),
            parent_profile_id: parentId,
            source: {
              filename: avatarSource!.file.name,
              content_type: avatarSource!.file.type || "image/png",
              content_length: avatarSource!.file.size,
              checksum_sha256: avatarSource!.checksum,
              width: avatarSource!.width,
              height: avatarSource!.height,
            },
            rights_attested: true,
            likeness_animation_consent: true,
          }
        : {
            schema_version: "videoforge-hosted-style-create/v1",
            name: name.trim(),
            parent_style_id: parentId,
            references: styleSources.map((source, index) => ({
              filename: source.file.name,
              content_type: source.file.type || "image/png",
              content_length: source.file.size,
              checksum_sha256: source.checksum,
              normalized_content_length: base64ByteLength(
                source.normalized!.normalized.bytesBase64,
              ),
              normalized_checksum_sha256: source.normalized!.normalized.checksum,
              normalized_width: source.normalized!.normalized.width,
              normalized_height: source.normalized!.normalized.height,
              order_index: index,
            })),
            rights_attested: true,
            processing_disclosure_acknowledged: true,
            original_retention_policy: "RETAIN",
          };
      const endpoint = isAvatar ? "/api/v2/hosted/avatars" : "/api/v2/hosted/styles";
      const serializedBody = JSON.stringify(body);
      if (createRequest.current?.body !== serializedBody) {
        createRequest.current = {
          body: serializedBody,
          key: `hosted-${kind}-create-${crypto.randomUUID()}`,
        };
      }
      const draft = await readJson<HostedPresetMutationResponse>(endpoint, {
        method: "POST",
        headers: { "idempotency-key": createRequest.current.key },
        body: serializedBody,
      });
      const uploads = draft.uploads ?? (draft.upload ? [draft.upload] : []);
      if (isAvatar && uploads[0] && avatarSource)
        await putHostedUpload(uploads[0], avatarSource.file);
      if (!isAvatar) {
        const normalizedUploads = draft.normalized_uploads ?? [];
        if (uploads.length > 0 && uploads.length !== styleSources.length)
          throw new Error(
            "Hosted style upload instructions did not match the selected references.",
          );
        for (const [index, upload] of uploads.entries()) {
          const source = styleSources[index];
          if (source) await putHostedUpload(upload, source.file);
        }
        if (normalizedUploads.length !== styleSources.length)
          throw new Error(
            "Hosted style normalization upload instructions did not match the selected references.",
          );
        for (const [index, upload] of normalizedUploads.entries()) {
          const source = styleSources[index]?.normalized;
          if (!source) throw new Error("Reference normalization is incomplete.");
          const binary = atob(source.normalized.bytesBase64);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          await putHostedUpload(
            upload,
            new File([bytes], `reference-${index + 1}.webp`, { type: "image/webp" }),
          );
        }
      }
      const id = resourceId(draft);
      const committed = await readJson<HostedPresetMutationResponse>(
        `${endpoint}/${encodeURIComponent(id)}/commit`,
        { method: "POST", body: "{}" },
      );
      const saved = { ...draft, ...committed };
      setCreated(saved);
      if (isAvatar) {
        const avatarId = resourceId(saved);
        await readJson(`/api/v2/hosted/avatars/${encodeURIComponent(avatarId)}/approve`, {
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-avatar-approval/v1",
            rights_attested: true,
            likeness_animation_consent: true,
          }),
        });
        await catalog.refetch();
        window.location.assign(returnTo);
      } else {
        setStep(3);
      }
    } catch (value) {
      const message =
        value instanceof Error ? value.message : `Hosted ${itemLabel} could not be saved.`;
      setError(message);
      if (
        !isAvatar &&
        message === "That style name is already in use. Open Image Styles to continue or remove it."
      ) {
        setStep(1);
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>("#preset-name-styles")?.focus(),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function approveAvatar() {
    if (!created || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = resourceId(created);
      if (resumedDraftActive && resumedDraft && presetState(resumedDraft) === "DRAFT") {
        const committed = await readJson<HostedPresetMutationResponse>(
          `/api/v2/hosted/avatars/${encodeURIComponent(id)}/commit`,
          { method: "POST", body: "{}" },
        );
        setCreated({ ...created, ...committed });
      }
      await readJson(`/api/v2/hosted/avatars/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-avatar-approval/v1",
          rights_attested: true,
          likeness_animation_consent: true,
        }),
      });
      await catalog.refetch();
      window.location.assign(returnTo);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Avatar approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeStyle() {
    if (!created || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (fixtureBackend) {
        if (!fixtureStyleVersion)
          throw new Error("The prepared style draft is unavailable. Start this style again.");
        const analyzed = await fixtureStyleAdapter!.analyze(fixtureStyleVersion);
        setFixtureStyleVersion(analyzed);
        setCreated(fixtureStyleResponse(analyzed));
        setStep(4);
        return;
      }
      const id = resourceId(created);
      const analyzed = await readJson<HostedPresetMutationResponse>(
        `/api/v2/hosted/styles/${encodeURIComponent(id)}/analyze`,
        {
          method: "POST",
          body: JSON.stringify({ schema_version: "videoforge-hosted-style-analysis/v1" }),
        },
      );
      setCreated({ ...created, ...analyzed });
      setStep(4);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Style analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publishStyle() {
    if (!created || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (fixtureBackend) {
        if (!fixtureStyleVersion?.profile)
          throw new Error("Analyze and review this exact draft before publication.");
        const published = await fixtureStyleAdapter!.publish(fixtureStyleVersion);
        setFixtureStyleVersion(published);
        setCreated(fixtureStyleResponse(published));
        await catalog.refetch();
        window.location.assign(returnTo);
        return;
      }
      const id = resourceId(created);
      const candidateProfile = created.profile
        ? { ...created.profile, review_notes: profileNotes.trim() }
        : undefined;
      await readJson(`/api/v2/hosted/styles/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-style-publish/v1",
          rights_attested: true,
          processing_disclosure_acknowledged: true,
          candidate_profile: candidateProfile,
        }),
      });
      await catalog.refetch();
      window.location.assign(returnTo);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Style publication failed.");
    } finally {
      setBusy(false);
    }
  }

  const profileSummary =
    (typeof created?.summary === "string" && created.summary) ||
    (typeof created?.profile?.summary === "string" && created.profile.summary) ||
    "No analysis summary returned; review required before publishing.";
  const analysisState = created ? presetState(created) : null;
  const analysisUnavailable = analysisState === "UNKNOWN" || analysisState === "ANALYZING";

  return (
    <>
      <PageHeader
        eyebrow={`${title} · step ${isAvatar ? Math.min(step, 2) : step === 4 ? 3 : step} of ${isAvatar ? 2 : 3}`}
        title={title}
        description={
          parentId
            ? "New version · existing project pins stay unchanged."
            : `Create a reusable ${itemLabel}.`
        }
        actions={
          <Button variant="ghost" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        }
      />
      <Panel
        className="preset-create-panel"
        heading={
          step === 1
            ? isAvatar
              ? "Upload photo"
              : "Upload references"
            : step === 2
              ? "Review"
              : isAvatar
                ? "Add avatar"
                : step === 3
                  ? "Analyze"
                  : "Publish"
        }
      >
        {resumeVersionId && created ? (
          <div className="preset-resume-banner" role="status">
            <strong>Continuing “{name}”</strong>
            <span>
              {repairingReferences
                ? `Select ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} replacement images.`
                : "Draft restored."}
            </span>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="stack preset-create-form">
            <div className="field">
              <label className="field-label" htmlFor={`preset-name-${kind}`}>
                {isAvatar ? "Avatar name" : "Style name"}
              </label>
              <input
                id={`preset-name-${kind}`}
                className="input preset-name-input"
                value={name}
                maxLength={120}
                autoComplete="off"
                disabled={repairingReferences || busy}
                onChange={(event) => setName(event.target.value)}
                placeholder={isAvatar ? "Maya — studio presenter" : "Grounded documentary"}
              />
            </div>
            {isAvatar ? (
              <label className="dropzone preset-source-dropzone">
                <input
                  aria-label="Upload avatar source"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(event) => void chooseAvatar(event.target.files?.[0])}
                />
                {avatarSource ? (
                  <img src={avatarSource.objectUrl} alt="Selected avatar source" />
                ) : (
                  <Upload size={27} />
                )}
                <span>
                  <strong>{avatarSource?.file.name ?? "Choose a front-facing photo"}</strong>
                  {avatarSource
                    ? `${avatarSource.width}×${avatarSource.height} · ready`
                    : "JPG, PNG or WebP · 512×512 min · 20 MB max"}
                </span>
              </label>
            ) : (
              <label className="dropzone preset-source-dropzone">
                <input
                  aria-label="Upload style references"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={busy}
                  onChange={(event) => void chooseStyleSources(event.target.files)}
                />
                <Images size={27} />
                <span>
                  <strong>
                    {styleSources.length > 0
                      ? `${styleSources.length} references selected`
                      : "Choose 3–8 reference images"}
                  </strong>
                  {styleSources.length > 0
                    ? "Ready · select again to replace"
                    : "Consistent look · 20 MB max each"}
                </span>
              </label>
            )}
            <div
              className={`preset-step-hint ${
                duplicateName
                  ? "preset-step-hint-danger"
                  : stepOneReady
                    ? "preset-step-hint-ready"
                    : ""
              }`}
              aria-live="polite"
            >
              {stepOneReady ? <Check size={16} /> : null}
              {stepOneHint}
            </div>
            {matchingDraft && matchingDraftResumable ? (
              <a
                className="button button-secondary preset-duplicate-action"
                href={hostedPresetResumeHref(kind, matchingDraft.version_id)}
              >
                Continue setup <ArrowRight size={16} aria-hidden="true" />
              </a>
            ) : null}
            {matchingDraft && !matchingDraftResumable ? (
              <a
                className="button button-secondary preset-duplicate-action"
                href={isAvatar ? "/avatars" : "/styles"}
              >
                View in Hub <ArrowRight size={16} aria-hidden="true" />
              </a>
            ) : null}
            <Button disabled={!stepOneReady} onClick={() => setStep(2)}>
              {repairingReferences ? "Review replacement references" : "Continue"}{" "}
              <ArrowRight size={16} />
            </Button>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="stack">
            {isAvatar && avatarSource ? (
              <img
                className="avatar-source-preview"
                src={avatarSource.objectUrl}
                alt="Avatar source preview"
              />
            ) : null}
            {!isAvatar ? (
              <div className="card-grid style-card-grid">
                {styleSources.map((source) => (
                  <img
                    className="style-source-preview"
                    key={source.checksum}
                    src={source.objectUrl}
                    alt={source.file.name}
                  />
                ))}
              </div>
            ) : null}
            <div className="validation validation-success">
              <Check size={16} />
              {isAvatar ? "Photo ready." : "References ready."}
            </div>
            <div className="notice notice-warning">
              {isAvatar
                ? "Use a clear, front-facing photo without text, logos, or watermarks."
                : "Use references with a consistent look and no text, logos, or watermarks."}
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              Back
            </Button>
            <div className="preset-action-disclosure">
              {isAvatar
                ? "I have the right to use and animate this likeness."
                : "I have the right to use these images. References stay private until analysis."}
            </div>
            <Button
              busy={busy}
              disabled={busy}
              onClick={() =>
                repairingReferences
                  ? void retryStyleReferences()
                  : isAvatar
                    ? created
                      ? void approveAvatar()
                      : void createDraft()
                    : void createDraft()
              }
            >
              {repairingReferences
                ? "Save replacement references"
                : isAvatar
                  ? "Add avatar"
                  : "Continue to analysis"}{" "}
              <ArrowRight size={16} />
            </Button>
          </div>
        ) : null}
        {step === 3 && !isAvatar ? (
          <div className="stack">
            <div className={!fixtureBackend ? "notice notice-warning" : "notice"}>
              <strong>{!fixtureBackend ? "One-time analysis" : "Local analysis"}</strong>{" "}
              {!fixtureBackend
                ? "Normalized references go through Runware to Gemini once. Provider retention follows their terms; a small charge may apply."
                : "Uses sample data; no external AI request."}
            </div>
            <div className="preset-action-disclosure">
              {fixtureBackend
                ? "I have the right to use these images."
                : "I have the right to use these images."}
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => (resumedDraftActive ? cancel() : setStep(2))}
            >
              {resumedDraftActive ? "Back to Image Styles" : "Back"}
            </Button>
            {!created ? (
              <Button busy={busy} onClick={() => void createDraft()}>
                Save and continue <ArrowRight size={16} />
              </Button>
            ) : analysisUnavailable ? (
              <div className="validation validation-warning" role="status">
                {analysisState === "UNKNOWN"
                  ? "Analysis stopped; it will not retry automatically."
                  : "Analysis is in progress."}
              </div>
            ) : (
              <Button busy={busy} onClick={() => void analyzeStyle()}>
                {analysisState === "FAILED" ? "Retry analysis" : "Analyze once"}{" "}
                <ArrowRight size={16} />
              </Button>
            )}
          </div>
        ) : null}
        {step === 4 && !isAvatar ? (
          <div className="stack">
            <div className="validation validation-success">
              <Check size={16} />
              {fixtureBackend
                ? "Profile ready for review."
                : "Analysis ready. Review before publishing."}
            </div>
            <p>{profileSummary}</p>
            {!fixtureBackend && typeof created?.analysis_cost_usd === "number" ? (
              <p className="helper">Analysis cost: ${created.analysis_cost_usd.toFixed(6)}</p>
            ) : null}
            {!fixtureBackend ? (
              <div className="field">
                <label className="field-label" htmlFor="style-review-notes">
                  Review notes (optional)
                </label>
                <textarea
                  id="style-review-notes"
                  className="textarea"
                  rows={3}
                  value={profileNotes}
                  onChange={(event) => setProfileNotes(event.target.value)}
                  placeholder="Keep natural practical light and tactile material detail."
                />
              </div>
            ) : null}
            <div className="preset-action-disclosure">
              Publishing locks this version; existing projects keep their current style.
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(3)}>
              Back
            </Button>
            <Button busy={busy} disabled={!created?.profile} onClick={() => void publishStyle()}>
              <ShieldCheck size={16} /> Publish style
            </Button>
          </div>
        ) : null}
      </Panel>
      {error ? (
        <div className="validation validation-danger" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

export function HostedProjectScreen({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
    refetchInterval: (currentQuery) =>
      hostedProjectPollInterval(currentQuery.state.data as ProjectDetailResponse | undefined),
    refetchIntervalInBackground: true,
    placeholderData: (previousData) =>
      previousData?.project.id === projectId ? previousData : undefined,
    retry: false,
  });
  const [additionalMedia, setAdditionalMedia] = useState<{
    readonly images: readonly HostedContactSheetItem[];
    readonly avatar: readonly HostedAvatarFootageItem[];
  }>({ images: [], avatar: [] });
  const [mediaPage, setMediaPage] = useState<Record<HostedMediaSection, number>>({
    images: 1,
    avatar: 1,
  });
  const [mediaLoadingSection, setMediaLoadingSection] = useState<HostedMediaSection | null>(null);
  const [mediaLoadError, setMediaLoadError] = useState<string | null>(null);
  const mediaContext = `${projectId}:${query.data?.project.revision_id ?? ""}`;
  const mediaContextRef = useRef(mediaContext);
  const mediaUrlCacheRef = useRef<HostedMediaUrlCache>(new Map());
  const resetMediaContext = useRef<string | null>(null);
  if (mediaContextRef.current !== mediaContext) mediaContextRef.current = mediaContext;
  useEffect(() => {
    if (mediaContext === resetMediaContext.current) return;
    resetMediaContext.current = mediaContext;
    mediaUrlCacheRef.current.clear();
    setAdditionalMedia({ images: [], avatar: [] });
    setMediaPage({ images: 1, avatar: 1 });
    setMediaLoadingSection(null);
    setMediaLoadError(null);
  }, [mediaContext]);

  async function loadMoreMedia(section: HostedMediaSection): Promise<void> {
    if (mediaLoadingSection !== null) return;
    const nextPage = mediaPage[section] + 1;
    const requestContext = mediaContext;
    const isCurrentRequest = () => mediaContextRef.current === requestContext;
    setMediaLoadingSection(section);
    setMediaLoadError(null);
    try {
      const page = await readJson<ProjectDetailResponse>(
        `/api/v2/hosted/projects/${projectId}?media_kind=${section}&media_page=${nextPage}`,
      );
      if (!isCurrentRequest()) return;
      const nextImages = page.review?.contact_sheet ?? page.contact_sheet ?? [];
      const nextAvatar = page.review?.avatar_footage ?? page.avatar_footage ?? [];
      setAdditionalMedia((current) => ({
        images:
          section === "images" ? mergeHostedMedia(current.images, nextImages) : current.images,
        avatar:
          section === "avatar" ? mergeHostedMedia(current.avatar, nextAvatar) : current.avatar,
      }));
      setMediaPage((current) => ({ ...current, [section]: nextPage }));
    } catch (error) {
      if (isCurrentRequest()) {
        setMediaLoadError(error instanceof Error ? error.message : "Try again.");
      }
    } finally {
      if (isCurrentRequest()) setMediaLoadingSection(null);
    }
  }
  const imageRegenerationRequests = useRef(new Map<string, HostedImageRegenerationRequest>());
  async function regenerateImage(item: ProjectMediaReviewItem, prompt: string): Promise<void> {
    const revisionId = query.data?.project.revision_id;
    if (!revisionId)
      throw new HostedImageRegenerationError(
        "The project revision is unavailable. Refresh and try again.",
        false,
      );
    const path = hostedImageRegenerationPath(projectId, item.id);
    const requests = imageRegenerationRequests.current;
    const current =
      requests.get(item.id) ?? readHostedImageRegenerationRequest(projectId, revisionId, item.id);
    if (current) requests.set(item.id, current);
    if (current && (current.prompt !== prompt || current.revisionId !== revisionId)) {
      throw new HostedImageRegenerationError(
        "This image regeneration is still processing. Wait for it to finish before changing the prompt.",
        false,
      );
    }
    const request =
      current ??
      (() => {
        const created: HostedImageRegenerationRequest = {
          prompt,
          revisionId,
          idempotencyKey: `browser-image-regeneration-${crypto.randomUUID()}`,
          requestId: null,
        };
        requests.set(item.id, created);
        writeHostedImageRegenerationRequest(projectId, item.id, created);
        return created;
      })();
    if (!request.requestId) {
      const body = JSON.stringify({
        schema_version: "videoforge-hosted-image-regeneration/v1",
        prompt: request.prompt,
        idempotency_key: request.idempotencyKey,
        revision_id: request.revisionId,
      });
      let accepted: HostedImageRegenerationAccepted;
      try {
        accepted = await readJson<HostedImageRegenerationAccepted>(path, {
          method: "POST",
          body,
        });
      } catch (firstError) {
        if (hostedImageRegenerationRequestWasRejected(firstError)) {
          requests.delete(item.id);
          clearHostedImageRegenerationRequest(projectId, request.revisionId, item.id);
          throw new HostedImageRegenerationError(
            "The regeneration request was rejected. Update the prompt and try again.",
            true,
          );
        }
        try {
          accepted = await readJson<HostedImageRegenerationAccepted>(path, {
            method: "POST",
            body,
          });
        } catch (secondError) {
          if (hostedImageRegenerationRequestWasRejected(secondError)) {
            requests.delete(item.id);
            clearHostedImageRegenerationRequest(projectId, request.revisionId, item.id);
            throw new HostedImageRegenerationError(
              "The regeneration request was rejected. Update the prompt and try again.",
              true,
            );
          }
          throw new HostedImageRegenerationError(
            "The regeneration request could not be confirmed. Try again to resume it; the same request key will be reused.",
            true,
          );
        }
      }
      if (!accepted.request_id) {
        throw new HostedImageRegenerationError(
          "The regeneration response was incomplete. Try again to resume it; the same request key will be reused.",
          true,
        );
      }
      request.requestId = accepted.request_id;
      writeHostedImageRegenerationRequest(projectId, item.id, request);
    }
    const deadline = Date.now() + HOSTED_IMAGE_REGENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      let status: HostedImageRegenerationStatus;
      try {
        status = await readJson<HostedImageRegenerationStatus>(
          hostedImageRegenerationPath(projectId, item.id, request.requestId!),
        );
      } catch {
        await waitForHostedImageRegenerationPoll();
        continue;
      }
      if (
        status.state === "ACTION_REQUIRED" ||
        status.error_code === "UNKNOWN_NO_RETRY" ||
        status.error?.code === "UNKNOWN_NO_RETRY"
      ) {
        throw new HostedImageRegenerationError(
          "The provider result is unconfirmed. This request will not be submitted again automatically. Refresh the project to check its status.",
          false,
          true,
        );
      }
      if (status.state === "FAILED") {
        requests.delete(item.id);
        clearHostedImageRegenerationRequest(projectId, request.revisionId, item.id);
        throw new HostedImageRegenerationError(hostedImageRegenerationFailure(status), true);
      }
      if (status.state === "SUCCEEDED") {
        try {
          await queryClient.refetchQueries({ queryKey: ["hosted-project", projectId] });
        } catch {
          throw new HostedImageRegenerationError(
            "The replacement was accepted, but the project could not be refreshed. Try again to resume this request; no new image will be submitted.",
            true,
          );
        }
        requests.delete(item.id);
        clearHostedImageRegenerationRequest(projectId, request.revisionId, item.id);
        return;
      }
      await waitForHostedImageRegenerationPoll();
    }
    throw new HostedImageRegenerationError(
      "The replacement is still processing. Try again to resume it; the same request key will be reused.",
      true,
    );
  }
  const asr = [...(query.data?.attempts ?? [])].reverse().find((attempt) => attempt.kind === "ASR");
  const renderAttempts = (query.data?.attempts ?? []).filter(
    (attempt) => attempt.kind === "RENDER",
  );
  const render = renderAttempts.at(-1);
  const automaticContextAttempt = useRef<string | null>(null);
  const automaticContextReconciliationAttempt = useRef<string | null>(null);
  const automaticPromptAttempt = useRef<string | null>(null);
  const renderHandoffAttempt = useRef<string | null>(null);
  const automaticGpuDispatchAttempt = useRef<string | null>(null);
  const [armedCancellation, setArmedCancellation] = useState<{
    readonly attemptId: string;
    readonly attemptState: string;
  } | null>(null);
  const asrHandoff = useMutation({
    mutationFn: async () => {
      const handoff = await readJson<{ cpu_submission: unknown }>(
        `/api/v2/hosted/projects/${projectId}/asr`,
        { method: "POST", body: "{}" },
      );
      return readJson(`/api/v2/cpu-attempts`, {
        method: "POST",
        body: JSON.stringify(handoff.cpu_submission),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const renderHandoff = useMutation({
    mutationFn: async (asrAttemptId: string) =>
      readJson<{
        state: "WAITING_FOR_GPU_QUALIFICATION";
        missing_lane_gates: readonly { lane: string; gates: readonly string[] }[];
      }>(`/api/v2/hosted/projects/${projectId}/render`, {
        method: "POST",
        body: JSON.stringify({ asr_attempt_id: asrAttemptId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const contextExtraction = useMutation({
    mutationFn: (asrAttemptId: string) =>
      readJson<{ state: "COMPLETE"; context_cost_usd?: number }>(
        `/api/v2/hosted/projects/${projectId}/context`,
        {
          method: "POST",
          body: JSON.stringify({
            asr_attempt_id: asrAttemptId,
            maximum_context_spend_micro_usd: 10_000,
          }),
        },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const contextReconciliation = useMutation({
    mutationFn: () =>
      readJson<{ state: "COMPLETE" | "UNKNOWN" }>(
        `/api/v2/hosted/projects/${projectId}/reconcile-context`,
        { method: "POST", body: "{}" },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const promptWriting = useMutation({
    mutationFn: () =>
      readJson<{ state: "COMPLETE"; prompt_cost_usd?: number }>(
        `/api/v2/hosted/projects/${projectId}/prompts`,
        {
          method: "POST",
          body: JSON.stringify({ maximum_prompt_spend_micro_usd: 2_000_000 }),
        },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const gpuDispatch = useMutation({
    retry: false,
    mutationFn: async () =>
      exactHostedV209DispatchResponse(
        await readJson<HostedV209DispatchResponse>(
          `/api/v2/hosted/projects/${projectId}/gpu-dispatch`,
          { method: "POST", body: "{}" },
        ),
      ),
    onSuccess: (result) => {
      if (
        result.state === "WAITING" ||
        result.state === "PREPARING_INPUTS" ||
        result.state === "WAITING_FOR_GPUS"
      ) {
        const retryAfterMs =
          result.state === "WAITING_FOR_GPUS"
            ? Math.max(1_000, Math.min(60_000, (result.retry_after_seconds ?? 30) * 1_000))
            : 2_000;
        window.setTimeout(() => {
          automaticGpuDispatchAttempt.current = null;
          void queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] });
        }, retryAfterMs);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] });
    },
  });
  const renderDiskRetry = useMutation({
    retry: false,
    mutationFn: (failedAttemptId: string) =>
      readJson(`/api/v2/hosted/projects/${projectId}/render-retry`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-render-disk-retry/v1",
          failed_attempt_id: failedAttemptId,
        }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const gpuDispatchPreSendIntegrityError = isHostedV209PreSendIntegrityError(gpuDispatch.error);
  const revisionId = query.data?.project.revision_id;
  const renderHandoffKey = hostedContinuationKey(revisionId, asr?.id);
  useEffect(() => {
    if (
      asr?.state !== "SUCCEEDED" ||
      (query.data?.voiceover_context !== null && query.data?.voiceover_context !== undefined) ||
      automaticContextAttempt.current === asr.id
    ) {
      return;
    }
    automaticContextAttempt.current = asr.id;
    contextExtraction.mutate(asr.id);
  }, [asr?.id, asr?.state, contextExtraction, query.data?.voiceover_context]);
  useEffect(() => {
    const context = query.data?.voiceover_context;
    if (
      context?.state !== "UNKNOWN" ||
      automaticContextReconciliationAttempt.current === context.id
    ) {
      return;
    }
    automaticContextReconciliationAttempt.current = context.id;
    contextReconciliation.mutate();
  }, [contextReconciliation, query.data?.voiceover_context]);
  useEffect(() => {
    if (
      asr?.state !== "SUCCEEDED" ||
      query.data?.voiceover_context?.state !== "SUCCEEDED" ||
      render ||
      !renderHandoffKey ||
      renderHandoffAttempt.current === renderHandoffKey
    ) {
      return;
    }
    renderHandoffAttempt.current = renderHandoffKey;
    renderHandoff.mutate(asr.id);
  }, [
    asr?.id,
    asr?.state,
    renderHandoffKey,
    query.data?.voiceover_context?.state,
    render?.id,
    renderHandoff,
  ]);
  useEffect(() => {
    const generationId = query.data?.generation?.id;
    const promptStageState = query.data?.stages?.find(
      (stage) => stage.id === "prompt-writing",
    )?.status;
    if (
      !generationId ||
      query.data?.voiceover_context?.state !== "SUCCEEDED" ||
      promptStageState !== "WAITING" ||
      automaticPromptAttempt.current === generationId
    ) {
      return;
    }
    automaticPromptAttempt.current = generationId;
    promptWriting.mutate();
  }, [
    promptWriting,
    query.data?.generation?.id,
    query.data?.stages,
    query.data?.voiceover_context?.state,
  ]);
  const promptStageState = query.data?.stages?.find(
    (stage) => stage.id === "prompt-writing",
  )?.status;
  const spanAudio = query.data?.span_audio;
  const durableGenerationStarted = hostedGenerationHasStarted(query.data?.stages);
  // A clip that failed on the owner's own computer still has automatic retries, so keep the
  // preparation phase open instead of dead-ending Stage 6 the moment one clip fails.
  const spanFailuresAreRetryable = Boolean(
    spanAudio && (spanAudio.failed === 0 || (spanAudio.retrying ?? 0) > 0),
  );
  const spanPreparationActive = Boolean(
    query.data?.generation?.id &&
      query.data.generation.stage !== "FAILED" &&
      Number(query.data.generation.failed_tasks) === 0 &&
      hostedTerminalStageStatus(query.data.stages, query.data.attempts, query.data.gpu_lanes) ===
        null &&
      !query.data.stages?.some((stage) =>
        HOSTED_TERMINAL_STAGE_STATUSES.has(stage.status.toUpperCase()),
      ) &&
      spanAudio &&
      spanFailuresAreRetryable &&
      spanAudio.materialized < spanAudio.total &&
      (spanAudio.running > 0 || spanAudio.materialized > 0),
  );
  const gpuDispatchReady = Boolean(
    query.data?.generation?.id &&
      !spanPreparationActive &&
      !durableGenerationStarted &&
      query.data.generation.stage === "READY_FOR_GPU_DISPATCH" &&
      promptStageState === "COMPLETE" &&
      (query.data.generation_provider === "KIE_FAL" ||
        (query.data.gpu_transport === "QUALIFIED_EXACT" &&
          query.data.gpu_readiness.dispatch_available === true)) &&
      (query.data.queue === null ||
        String(query.data.queue?.status ?? "").toUpperCase() === "WAITING" ||
        HOSTED_V209_DISPATCH_READY_QUEUE_STATES.has(
          String(query.data.queue?.status ?? "").toUpperCase(),
        )),
  );
  const gpuDispatchResumeReady = Boolean(
    query.data?.generation?.id &&
      !spanPreparationActive &&
      promptStageState === "COMPLETE" &&
      (query.data.generation_provider === "KIE_FAL" ||
        (query.data.gpu_transport === "QUALIFIED_EXACT" &&
          query.data.gpu_readiness.dispatch_available === true)) &&
      !durableGenerationStarted &&
      !query.data.attempts.some((attempt) =>
        ["IMAGE", "AVATAR", "MAGE_IMAGE", "SOULX_AVATAR"].includes(
          String(attempt.kind).toUpperCase(),
        ),
      ) &&
      (query.data.queue === null ||
        String(query.data.queue?.status ?? "").toUpperCase() === "WAITING" ||
        HOSTED_V209_DISPATCH_READY_QUEUE_STATES.has(
          String(query.data.queue?.status ?? "").toUpperCase(),
        )),
  );
  useEffect(() => {
    const generationId = query.data?.generation?.id;
    if (
      !generationId ||
      !gpuDispatchReady ||
      automaticGpuDispatchAttempt.current === generationId
    ) {
      return;
    }
    automaticGpuDispatchAttempt.current = generationId;
    gpuDispatch.mutate();
  }, [gpuDispatch, gpuDispatchReady, query.data?.generation?.id]);
  const cancel = useMutation({
    mutationFn: (attemptId: string) =>
      readJson(`/api/v2/cpu-attempts/${attemptId}`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-cpu-cancellation/v1",
          attempt_id: attemptId,
          confirmation: "STOP",
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const armedAttemptCurrentState = armedCancellation
    ? query.data?.attempts.find((attempt) => attempt.id === armedCancellation.attemptId)?.state
    : null;
  useEffect(() => {
    if (!armedCancellation) return;
    if (armedAttemptCurrentState !== armedCancellation.attemptState) {
      setArmedCancellation(null);
      return;
    }
    const timeout = window.setTimeout(() => setArmedCancellation(null), CPU_CANCEL_CONFIRMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [armedAttemptCurrentState, armedCancellation]);
  const deleteProject = useMutation({
    mutationFn: () =>
      readJson<{
        state: "ARCHIVED";
        lineage_retention: "PRESERVED";
      }>(`/api/v2/hosted/projects/${projectId}`, { method: "DELETE", body: "{}" }),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["hosted-project", projectId] });
      queryClient.removeQueries({ queryKey: ["hosted-project", projectId] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hosted-projects"] }),
        queryClient.invalidateQueries({ queryKey: ["hosted-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["hosted-progress-navigation"] }),
      ]);
      await navigate({ to: "/" });
    },
  });
  const cancelProjectWork = useMutation({
    mutationFn: () =>
      readJson<{
        state: "CANCELLED" | "RECONCILING";
        provider_actions_created: false;
        redispatch: false;
        reconciliation_scheduled?: boolean;
      }>(`/api/v2/hosted/projects/${projectId}/cancel`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "videoforge-hosted-project-cancellation/v1",
          project_id: projectId,
          confirmation: "STOP",
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  if (query.isPending)
    return (
      <Panel className="loading-panel" eyebrow="Hosted project" heading="Opening live progress">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Connecting to your project and personal media worker…</p>
        </div>
      </Panel>
    );
  if (!query.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Live progress is temporarily unavailable"
        body="Your project is saved. VideoForge could not read its latest progress update yet."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw size={15} /> Retry progress
          </Button>
        }
      />
    );
  const stages = query.data.stages?.length
    ? query.data.stages
    : fallbackHostedStages(asr, render, query.data.generation, query.data.voiceover_context);
  const uiStages = hostedProjectStages(
    stages,
    query.data.gpu_lanes ?? [],
    query.data.generation_provider === "KIE_FAL",
  ).map((stage) => ({
    ...stage,
    detail:
      stage.status === "COMPLETE"
        ? "Complete"
        : stage.status === "PENDING" && stage.detail === "Waiting for an authoritative update."
          ? "Waiting"
          : stage.detail,
  }));
  const promptStage = uiStages.find((stage) => stage.id === "prompt-writing");
  const contextStage = uiStages.find(
    (stage) =>
      stage.id === "voiceover-context" ||
      stage.label === "Understand context" ||
      stage.label === "Understand voiceover context",
  );
  const contextComplete = query.data.voiceover_context?.state === "SUCCEEDED";
  const contextDocument = query.data.voiceover_context?.context_document;
  const contextText = (() => {
    if (typeof contextDocument?.subject !== "string")
      return typeof contextDocument?.summary === "string" ? contextDocument.summary : null;
    const compactParts = [`Subject: ${contextDocument.subject}`];
    for (const [label, candidate] of [
      ["Visual facts", contextDocument.visual_facts],
      ["Continuity", contextDocument.continuity],
      ["Resolve", contextDocument.resolved_references],
    ] as const) {
      if (!Array.isArray(candidate)) continue;
      const values = candidate.filter((item): item is string => typeof item === "string");
      if (values.length > 0) compactParts.push(`${label}: ${values.join("; ")}`);
    }
    return compactParts.join(" | ");
  })();
  const contextUnknown = query.data.voiceover_context?.state === "UNKNOWN";
  const contextProviderFailed =
    (contextReconciliation.error as (Error & { readonly code?: string }) | null)?.code ===
    "HOSTED_CONTEXT_RECONCILIATION_RUNWARE_TASK_PROVIDER_FAILED";
  // A rejected attempt is retryable under the server's bound now that the rejection was traced to the
  // product's own request shape: the row offers the same fresh-request Retry as a confirmed failure.
  const contextRejected =
    query.data.voiceover_context?.problem_code === "VOICEOVER_CONTEXT_PROVIDER_REJECTED";
  const contextValidationFailed = [
    "VOICEOVER_CONTEXT_INVALID",
    "VOICEOVER_CONTEXT_JSON_INVALID",
    "VOICEOVER_CONTEXT_JSON_DUPLICATE_PROPERTY",
    "VOICEOVER_CONTEXT_TOO_LARGE",
  ].includes(query.data.voiceover_context?.problem_code ?? "");
  const contextAutoStartError = contextExtraction.isError && query.data.voiceover_context == null;
  // The auto-start failure is not a needs-review context: no context row exists yet, so stage 03 reads
  // FAILED from the client-side projection that also shows the reason. Letting `contextStage` (the
  // server projection, which still says RUNNING) or a FAILED row reach this branch would rewrite the
  // notice into "Context extraction needs review." / "Stopped safely; no automatic retry." and drop the
  // retry control -- a sentence that contradicts the row and a failure with no way forward. Needs
  // review means a context row exists and needs a human.
  const contextNeedsReview =
    !contextAutoStartError &&
    (contextStage?.status === "FAILED" ||
      query.data.voiceover_context?.state === "UNKNOWN" ||
      query.data.voiceover_context?.state === "FAILED");
  const contextReconciliationCouldNotFinish =
    contextUnknown &&
    !contextProviderFailed &&
    automaticContextReconciliationAttempt.current === query.data.voiceover_context?.id &&
    !contextReconciliation.isPending &&
    (contextReconciliation.isError || contextReconciliation.data?.state === "UNKNOWN");
  const promptAutoStartError = promptWriting.isError && promptStage?.status === "PENDING";
  const timing = query.data.timing;
  const cost = query.data.cost;
  const queue = query.data.queue;
  const firstIncompleteStageIndex = uiStages.findIndex((stage) => stage.status !== "COMPLETE");
  const activeStageIndex =
    firstIncompleteStageIndex < 0 ? Math.max(0, uiStages.length - 1) : firstIncompleteStageIndex;
  const activeStage = uiStages[activeStageIndex];
  const overallProgress = Math.round(
    uiStages.reduce(
      (total, stage) =>
        total + Math.min(100, Math.round((stage.completed / Math.max(1, stage.total)) * 100)),
      0,
    ) / Math.max(1, uiStages.length),
  );
  const generationStages = uiStages.filter(
    (stage) => stage.id === "image-generation" || stage.id === "avatar-generation",
  );
  const generationStopped =
    query.data.generation?.stage === "FAILED" ||
    generationStages.some((stage) => ["FAILED", "CANCELLED"].includes(stage.status));
  const generationWaitingForGpu =
    gpuDispatch.data?.state === "WAITING_FOR_GPUS" ||
    generationStages.some((stage) => stage.status === "QUEUED") ||
    query.data.attempts.some(
      (attempt) =>
        ["MAGE_IMAGE", "SOULX_AVATAR"].includes(attempt.kind) &&
        ["IN_QUEUE", "WAITING_FOR_GPUS"].includes(attempt.state.toUpperCase()),
    );
  const hasFailed = generationStopped || uiStages.some((stage) => stage.status === "FAILED");
  const hasActionRequired = uiStages.some((stage) => stage.status === "ACTION_REQUIRED");
  const hasRunning =
    uiStages.some((stage) =>
      ["STARTING", "RUNNING", "RETRYING", "CANCEL_REQUESTED"].includes(stage.status),
    ) ||
    query.data.attempts.some((attempt) =>
      HOSTED_ACTIVE_ATTEMPT_STATES.has(attempt.state.toUpperCase()),
    );
  const terminalStageStatus = hostedTerminalStageStatus(
    stages,
    query.data.attempts,
    query.data.gpu_lanes,
  );
  const terminalBlocked = terminalStageStatus === "BLOCKED";
  const terminalCancelled = terminalStageStatus === "CANCELLED";
  const allComplete = uiStages.every((stage) => stage.status === "COMPLETE");
  const overallStatus = hasFailed
    ? "Needs attention"
    : hasActionRequired
      ? "Action required"
      : terminalBlocked
        ? "Blocked"
        : terminalCancelled
          ? "Cancelled"
          : generationWaitingForGpu
            ? query.data.generation_provider === "KIE_FAL"
              ? "Waiting for generation"
              : "Waiting for GPUs"
            : allComplete
              ? render?.approved_at
                ? "Approved"
                : "Ready for review"
              : hasRunning
                ? "Running"
                : "Waiting";
  const apiTimeEstimate = query.data.generation_provider === "KIE_FAL"
    ? query.data.time_estimate
    : null;
  const apiEstimateRange = apiTimeEstimate
    ? formatApproximateMinutes(
        apiTimeEstimate.remaining_min_ms,
        apiTimeEstimate.remaining_max_ms,
      )
    : null;
  const estimateStopped = hasFailed || hasActionRequired || terminalBlocked || terminalCancelled;
  const estimatedTimeValue =
    query.data.generation_provider !== "KIE_FAL"
      ? formatMilliseconds(stages[activeStageIndex]?.eta_ms ?? queue?.estimated_wait_ms)
      : estimateStopped
        ? "Unavailable"
        : render?.state === "SUCCEEDED"
          ? "Ready"
          : apiTimeEstimate?.overrun
            ? "Taking longer"
            : apiEstimateRange ?? (query.data.generation ? "No reliable estimate" : "After scene plan");
  const estimatedTimeDetail =
    query.data.generation_provider !== "KIE_FAL"
      ? "remaining"
      : estimateStopped
        ? "project stopped"
        : render?.state === "SUCCEEDED"
          ? "ready for review"
          : apiTimeEstimate?.overrun
        ? "than recent short runs; API and render times vary"
            : apiEstimateRange
          ? "remaining · based on recent short runs; times vary"
              : query.data.generation
                ? "provider timing varies"
                : "timing available after planning";
  const statusToneValue = hasFailed
    ? "danger"
    : hasActionRequired
      ? "warning"
      : terminalBlocked || terminalCancelled
        ? "warning"
        : generationWaitingForGpu
          ? "info"
          : allComplete
            ? "success"
            : hasRunning
              ? "info"
              : "warning";
  const stableRenderPreviewUrl = render?.preview_url
    ? stableHostedMediaUrl(mediaUrlCacheRef.current, mediaContext, "render", {
        id: render.id,
        video_url: render.preview_url,
      })
    : null;
  const firstContactSheet = query.data.review?.contact_sheet ?? query.data.contact_sheet ?? [];
  const firstAvatarFootage = query.data.review?.avatar_footage ?? query.data.avatar_footage ?? [];
  const latestContactSheetItem = firstContactSheet.at(-1);
  const latestArtifact =
    stableRenderPreviewUrl ??
    (latestContactSheetItem
      ? stableHostedMediaUrl(mediaUrlCacheRef.current, mediaContext, "images", latestContactSheetItem)
      : null);
  const contactSheet = mergeHostedMedia(firstContactSheet, additionalMedia.images);
  const avatarFootage = mergeHostedMedia(firstAvatarFootage, additionalMedia.avatar);
  const mediaPagination = query.data.media_pagination ?? query.data.review?.media_pagination;
  const mediaTotals: ProjectMediaReviewTotals = {
    images: Math.max(
      contactSheet.length,
      Number.isSafeInteger(Number(mediaPagination?.images.total_accepted))
        ? Number(mediaPagination?.images.total_accepted)
        : contactSheet.length,
    ),
    avatar: Math.max(
      avatarFootage.length,
      Number.isSafeInteger(Number(mediaPagination?.avatar.total_accepted))
        ? Number(mediaPagination?.avatar.total_accepted)
        : avatarFootage.length,
    ),
  };
  const mediaHasMore: ProjectMediaReviewHasMore = {
    images: mediaPage.images * HOSTED_MEDIA_PAGE_SIZE < mediaTotals.images,
    avatar: mediaPage.avatar * HOSTED_MEDIA_PAGE_SIZE < mediaTotals.avatar,
  };
  const projectRevisionId = query.data?.project.revision_id ?? null;
  const generatedImages: ProjectMediaReviewItem[] = contactSheet.map((item, index) => {
    const id = item.id ?? item.asset_id ?? `generated-image-${index + 1}`;
    const pending = projectRevisionId
      ? readHostedImageRegenerationRequest(projectId, projectRevisionId, id)
      : null;
    return {
      id,
      url: stableHostedMediaUrl(mediaUrlCacheRef.current, mediaContext, "images", item),
      label: `Generated image ${index + 1}`,
      prompt: pending?.prompt ?? item.prompt ?? null,
      detail:
        item.start_ms !== null && item.start_ms !== undefined
          ? `${formatMilliseconds(item.start_ms)}–${formatMilliseconds(item.end_ms)}`
          : item.shot_role
            ? query.data.generation_provider === "KIE_FAL" &&
              item.shot_role.toUpperCase() === "MAGE_IMAGE"
              ? "Kie image"
              : item.shot_role.replaceAll("_", " ")
            : "Accepted Stage 6 image",
    };
  });
  const avatarVideos: ProjectMediaReviewItem[] = avatarFootage.map((item, index) => ({
    id: item.id,
    url: stableHostedMediaUrl(mediaUrlCacheRef.current, mediaContext, "avatar", item),
    label: item.label ?? `Avatar clip ${index + 1}`,
    detail: "Accepted Stage 7 avatar footage",
  }));
  const imageStage = uiStages.find(
    (stage) => stage.id === "image-generation" || stage.label === "Generate images",
  );
  const avatarStage = uiStages.find(
    (stage) =>
      stage.id === "avatar-generation" ||
      stage.label === "Generate avatar video" ||
      stage.label === "Generate avatar",
  );
  const stageMediaActions = {
    ...(imageStage?.status === "COMPLETE" && generatedImages.length > 0
      ? {
          [imageStage.id]: (
            <ProjectMediaReview
              launcher="images"
              images={generatedImages}
              avatarVideos={avatarVideos}
              mediaTotals={mediaTotals}
              mediaHasMore={mediaHasMore}
              onLoadMore={(section) => void loadMoreMedia(section)}
              loadingMore={mediaLoadingSection}
              loadMoreError={mediaLoadError}
              loading={query.isFetching && !query.data}
              error={query.isError ? query.error.message : null}
              onRetry={() => void query.refetch()}
              onRegenerate={regenerateImage}
              regenerationCostDescription={
                query.data.generation_provider === "KIE_FAL"
                  ? "Regeneration may incur an API charge."
                  : undefined
              }
            />
          ),
        }
      : {}),
    ...(avatarStage?.status === "COMPLETE" && avatarVideos.length > 0
      ? {
          [avatarStage.id]: (
            <ProjectMediaReview
              launcher="avatar"
              images={generatedImages}
              avatarVideos={avatarVideos}
              mediaTotals={mediaTotals}
              mediaHasMore={mediaHasMore}
              onLoadMore={(section) => void loadMoreMedia(section)}
              loadingMore={mediaLoadingSection}
              loadMoreError={mediaLoadError}
              loading={query.isFetching && !query.data}
              error={query.isError ? query.error.message : null}
              onRetry={() => void query.refetch()}
              onRegenerate={regenerateImage}
              regenerationCostDescription={
                query.data.generation_provider === "KIE_FAL"
                  ? "Regeneration may incur an API charge."
                  : undefined
              }
            />
          ),
        }
      : {}),
  };
  const cancellableAttempts = query.data.attempts.filter((attempt) =>
    ["OUTBOXED", "SUBMITTED", "RUNNING", "RECONCILING", "CANCEL_REQUESTED"].includes(attempt.state),
  );
  const queueState = String(query.data.queue?.status ?? "").toUpperCase();
  const generationProviderAttempts = query.data.attempts.filter(
    (attempt) => attempt.kind === "MAGE_IMAGE" || attempt.kind === "SOULX_AVATAR",
  );
  const predispatchGenerationAttempts = query.data.attempts.filter(
    (attempt) =>
      (attempt.kind === "MAGE_IMAGE" || attempt.kind === "SOULX_AVATAR") &&
      attempt.state === "PLANNED",
  );
  const canCancelPredispatchGeneration = Boolean(
    query.data.generation &&
      HOSTED_PREDISPATCH_CANCELLABLE_QUEUE_STATES.has(queueState) &&
      (generationProviderAttempts.length === 0 ||
        (generationProviderAttempts.length === 2 &&
          predispatchGenerationAttempts.length === 2 &&
          generationProviderAttempts.every((attempt) => attempt.state === "PLANNED"))),
  );
  const providerBoundGenerationAttempts = generationProviderAttempts.filter(
    (attempt) =>
      !["PLANNED", "OUTBOXED", "COMPLETED", "SUCCEEDED", "CANCELLED"].includes(
        attempt.state.toUpperCase(),
      ),
  );
  const canRequestProjectReconciliation = Boolean(
    query.data.generation &&
      HOSTED_PREDISPATCH_CANCELLABLE_QUEUE_STATES.has(queueState) &&
      (canCancelPredispatchGeneration || providerBoundGenerationAttempts.length > 0),
  );
  const projectWorkActionLabel =
    providerBoundGenerationAttempts.length > 0
      ? "Stop and reconcile provider work"
      : "Cancel project work";
  const prompts = query.data.prompts ?? [];
  // The API exposes no raw/in-flight model output. Both final rows and
  // `durable: false` progress rows have already passed local validation and an
  // atomic batch-progress commit, so both belong in the live viewer.
  const acceptedPrompts = prompts;
  const promptProgress = query.data.prompt_progress;
  const promptWritingActive =
    promptWriting.isPending ||
    ["STARTING", "RUNNING", "RETRYING"].includes(promptStage?.status ?? "");
  const promptWritingStopped = ["FAILED", "ACTION_REQUIRED", "BLOCKED", "CANCELLED"].includes(
    promptStage?.status ?? "",
  );
  // The numbered pipeline renders the polled stage status, which can lag the work it describes: a
  // backgrounded tab throttles the poll, and a writer task switches states before the next response
  // lands. The live panel beside it already knows prompt writing is running, so the numbered stage
  // must agree instead of reporting the previous "not started" status.
  const displayedStages = uiStages.map((stage) =>
    stage.id === "voiceover-context" && contextAutoStartError
      ? // The automatic request never reached a provider task, so nothing about it is running: the
        // server projection only knows that asr succeeded and no context row exists, which reads
        // RUNNING forever. The row must carry the same truth as the notice below it -- the reason the
        // request failed -- and the control that can send it again.
        { ...stage, status: "FAILED" as const, detail: contextExtraction.error.message }
      : stage.id === "prompt-writing" &&
          promptWritingActive &&
          !["COMPLETE", "FAILED", "CANCELLED"].includes(stage.status)
        ? { ...stage, status: "RUNNING" as const }
        : stage,
  );
  const stageTimings = stages.map((stage, index) => {
    const id = stage.id ?? `stage-${index + 1}`;
    const running = !["COMPLETE", "FAILED", "CANCELLED", "PENDING"].includes(
      displayedStages[index]?.status ?? "PENDING",
    );
    const apiLane =
      query.data.generation_provider === "KIE_FAL" &&
      (id === "image-generation" || id === "avatar-generation");
    const lane = apiLane
      ? query.data.gpu_lanes?.find(
          (item) => item.lane === (id === "image-generation" ? "mage_image" : "soulx_avatar"),
        )
      : undefined;
    return {
      id,
      name: stage.name,
      since: apiLane
        ? (lane?.created_at ?? lane?.submitted_at ?? null)
        : hostedStageStart(stage.started_at, running, `${projectId}:${id}`),
      until: apiLane ? (lane?.terminal_at ?? null) : (stage.completed_at ?? null),
      running,
    };
  });
  // Every failed row owns a Retry control. Only a server-bounded recovery is enabled; a failed
  // provider lane cannot be sent again from the browser because its charge may already exist.
  const stageRetryButton = (busy: boolean, run: () => void) => (
    <Button variant="secondary" className="stage-retry-button" busy={busy} onClick={run}>
      <RefreshCw size={13} aria-hidden="true" /> Retry
    </Button>
  );
  const stageRetryDisabled = (reason: string) => (
    <Button variant="secondary" className="stage-retry-button" disabled title={reason}>
      <RefreshCw size={13} aria-hidden="true" /> Retry
    </Button>
  );
  const unavailableRetryReason = (stageId: string): string => {
    if (stageId === "audio-spanning")
      return "The connected computer has exhausted this span's automatic retries. Check the local worker, then refresh progress; no manual replay is available.";
    if (stageId === "image-generation" || stageId === "avatar-generation")
      return "This provider attempt is terminal or its result is uncertain. Accepted media is saved, but another paid request cannot be sent from this project.";
    if (stageId === "prompt-writing" && promptProgress?.state === "UNKNOWN")
      return "The prompt request's result is uncertain. A fresh paid request is blocked until the existing attempt is resolved.";
    if (stageId === "voiceover-context" && contextValidationFailed)
      return "The context response failed validation. A fresh provider request is not authorized for this run.";
    if (stageId === "render")
      return "This render failure is outside the verified local retry paths. The accepted images and avatar clips remain saved.";
    return "No safe retry is available for this failed stage. Check the failure details before starting another project.";
  };
  const unavailableRetryNotice = (stageId: string) =>
    stageId === "image-generation" || stageId === "avatar-generation" ? (
      <>
        {unavailableRetryReason(stageId)} <Link to="/projects/new">Create a new video</Link> when
        ready.
      </>
    ) : (
      unavailableRetryReason(stageId)
    );
  const failedStageIds = new Set(
    displayedStages.filter((stage) => stage.status === "FAILED").map((stage) => stage.id),
  );
  const stageRetries: Record<string, ReturnType<typeof stageRetryButton>> = {
    ...(failedStageIds.has("transcription") && asr?.state === "FAILED"
      ? {
          transcription: stageRetryButton(asrHandoff.isPending, () => asrHandoff.mutate()),
        }
      : {}),
    ...(failedStageIds.has("voiceover-context") && asr
      ? contextProviderFailed || contextRejected
        ? {
            // The provider confirmed the original task produced nothing usable, so checking it again
            // can never resume it; the only recovery is a new request, and the server's bounded
            // redispatch is what submits it. Until this control existed the row offered no action at
            // all and the run simply sat at stage 3.
            "voiceover-context": stageRetryButton(contextExtraction.isPending, () =>
              contextExtraction.mutate(asr.id),
            ),
          }
        : contextUnknown && !contextValidationFailed
          ? {
              // An UNKNOWN context is the one stage-3 state a press can still resolve by asking the
              // provider for the original task's outcome.
              "voiceover-context": stageRetryButton(contextReconciliation.isPending, () =>
                contextReconciliation.mutate(),
              ),
            }
          : contextAutoStartError
            ? {
                // The automatic request failed before any provider task existed, so there is nothing
                // to reconcile and no result to inspect: the same bounded request the notice below
                // fires is the only recovery, and the FAILED row now carries it.
                "voiceover-context": stageRetryButton(contextExtraction.isPending, () =>
                  contextExtraction.mutate(asr.id),
                ),
              }
            : {}
      : {}),
    ...(failedStageIds.has("prompt-writing") && query.data.generation?.id &&
    promptProgress?.state !== "UNKNOWN"
      ? {
          "prompt-writing": stageRetryButton(promptWriting.isPending, () => promptWriting.mutate()),
        }
      : {}),
    ...(query.data.generation_provider === "KIE_FAL" &&
    failedStageIds.has("render") &&
    render?.state === "FAILED" &&
    (render.error_code === "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT" ||
      (render.error_code === "MEDIA_EXECUTION_IO_FAILED" &&
        renderAttempts.length === 2 &&
        renderAttempts[0]?.error_code === "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT") ||
      (render.error_code === "RENDER_INPUT_INVALID" &&
        renderAttempts.length === 3 &&
        renderAttempts[0]?.error_code === "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT" &&
        renderAttempts[1]?.error_code === "MEDIA_EXECUTION_IO_FAILED"))
      ? {
          render: stageRetryButton(renderDiskRetry.isPending, () =>
            renderDiskRetry.mutate(render.id),
          ),
        }
      : {}),
  };
  const visibleStageRetries = Object.fromEntries(
    [...failedStageIds].map((id) => [
      id,
      stageRetries[id] ?? stageRetryDisabled(unavailableRetryReason(id)),
    ]),
  );
  // A refused press has to say why inside the stage that was pressed. The server's sentence used to
  // land only in the notice below the pipeline, so a spent retry budget read as "nothing happened".
  const stageRetryNotices = {
    ...Object.fromEntries(
      [...failedStageIds]
        .filter((id) => !stageRetries[id])
        .map((id) => [id, unavailableRetryNotice(id)]),
    ),
    ...(failedStageIds.has("transcription") && asrHandoff.isError
      ? { transcription: asrHandoff.error.message }
      : {}),
    ...(failedStageIds.has("voiceover-context") && contextReconciliation.isError
      ? { "voiceover-context": contextReconciliation.error.message }
      : {}),
    // The auto-start request itself failed, so there is no refused press to explain: the row's alert
    // carries the same sentence the row's detail and the notice below show, naming why the control
    // beside it has to send a new request.
    ...(failedStageIds.has("voiceover-context") && contextExtraction.isError
      ? { "voiceover-context": contextExtraction.error.message }
      : {}),
    ...(failedStageIds.has("prompt-writing") && promptWriting.isError
      ? { "prompt-writing": promptWriting.error.message }
      : {}),
    ...((failedStageIds.has("image-generation") || failedStageIds.has("avatar-generation")) &&
    gpuDispatch.isError
      ? {
          ...(failedStageIds.has("image-generation")
            ? { "image-generation": gpuDispatch.error.message }
            : {}),
          ...(failedStageIds.has("avatar-generation")
            ? { "avatar-generation": gpuDispatch.error.message }
            : {}),
        }
      : {}),
    ...(failedStageIds.has("render") && renderDiskRetry.isError
      ? { render: renderDiskRetry.error.message }
      : {}),
  };
  const acceptedPromptCount =
    hostedCount(promptProgress?.accepted_scenes) ?? acceptedPrompts.length;
  const totalPromptCount = hostedCount(promptProgress?.total_scenes);
  const acceptedBatchCount = hostedCount(promptProgress?.accepted_batches);
  const totalBatchCount = hostedCount(promptProgress?.total_batches);
  const activeBatchOrdinal = hostedCount(promptProgress?.active_batch_ordinal);
  const hasBatchProgress =
    totalBatchCount !== null || acceptedBatchCount !== null || activeBatchOrdinal !== null;
  const visibleBatchOrdinal =
    activeBatchOrdinal ??
    (promptWritingActive && totalBatchCount !== null && totalBatchCount > 0
      ? Math.min(totalBatchCount, (acceptedBatchCount ?? 0) + 1)
      : acceptedBatchCount !== null && acceptedBatchCount > 0
        ? acceptedBatchCount
        : null);
  const acceptedPromptStatus =
    totalPromptCount === null
      ? `${acceptedPromptCount.toLocaleString()} accepted prompts`
      : `${acceptedPromptCount.toLocaleString()} / ${totalPromptCount.toLocaleString()} prompts accepted`;
  const promptBatchStatus =
    promptWritingStopped && acceptedPromptCount === 0 && totalBatchCount !== null
      ? `Stopped · 0 / ${totalBatchCount.toLocaleString()} batches accepted`
      : visibleBatchOrdinal === null
        ? totalBatchCount === null
          ? "Batch progress pending"
          : `Preparing batch of ${totalBatchCount.toLocaleString()}`
        : totalBatchCount === null
          ? `Batch ${visibleBatchOrdinal.toLocaleString()}`
          : `Batch ${visibleBatchOrdinal.toLocaleString()} of ${totalBatchCount.toLocaleString()}`;
  const showPromptFeed = Boolean(
    query.data.generation || promptWritingActive || acceptedPrompts.length > 0,
  );
  return (
    <>
      <PageHeader
        eyebrow="Live project"
        title={query.data.project.title}
        actions={
          render?.state === "SUCCEEDED" ? (
            <Link
              className="button button-primary"
              to="/projects/$projectId/review"
              params={{ projectId }}
            >
              Review video
            </Link>
          ) : undefined
        }
      />
      <section className="progress-hero" aria-label="Live video progress">
        <ProgressRing value={overallProgress} label="Overall video progress" detail="complete" />
        <div className="progress-hero-body">
          <div className="progress-hero-heading">
            <div>
              <p className="eyebrow">Happening now</p>
              <h2>{activeStage?.label ?? "Preparing project"}</h2>
            </div>
            <Badge tone={statusToneValue}>{overallStatus}</Badge>
          </div>
          <div className="progress-metrics">
            <Metric
              label="Stage"
              value={`${String(activeStageIndex + 1).padStart(2, "0")}/${String(uiStages.length).padStart(2, "0")}`}
              tone="info"
            />
            <Metric
              label="Estimated"
              value={estimatedTimeValue}
              detail={estimatedTimeDetail}
            />
            <Metric
              label="Projected cost"
              value={
                query.data.generation_provider === "KIE_FAL"
                  ? cost?.projected_usd == null
                    ? "After scene plan"
                    : formatUsd(cost.projected_usd)
                  : (cost?.projected_usd ?? 0) > 0
                    ? formatUsd(cost?.projected_usd)
                    : "No provider charge"
              }
              detail={
                query.data.generation_provider === "KIE_FAL"
                  ? cost?.api_estimate
                    ? `${cost.api_estimate.kie_images} Kie images + ${cost.api_estimate.fal_avatar_seconds.toFixed(1)}s Fal avatar · published-rate estimate`
                    : "Calculated when planning finishes"
                  : cost?.cap_usd == null
                    ? undefined
                    : `${formatUsd(cost.cap_usd)} maximum`
              }
              tone="success"
            />
            <Metric
              label="Wall elapsed"
              value={
                <HostedElapsed
                  since={query.data.project.created_at}
                  until={render?.state === "SUCCEEDED" ? render.terminal_at : null}
                  label="Wall elapsed time"
                />
              }
              detail="includes waits"
            />
          </div>
          <ProgressBar value={overallProgress} label="Overall video progress" />
        </div>
      </section>

      {render?.state === "SUCCEEDED" ? null : spanPreparationActive ? (
        <div className="validation validation-info" role="status" aria-live="polite">
          Preparing exact avatar audio. Generation continues when ready.
        </div>
      ) : gpuDispatch.isPending ? (
        <div className="validation validation-info" role="status" aria-live="polite">
          Generation is starting…
        </div>
      ) : gpuDispatch.isError && !durableGenerationStarted ? (
        <div className="validation validation-danger" role="alert">
          {gpuDispatchPreSendIntegrityError ? (
            <p>Generation has not started. Prepared generation data failed validation.</p>
          ) : (
            <>
              <p>
                Generation start could not be confirmed. VideoForge will not retry automatically.
              </p>
              <Button variant="secondary" onClick={() => gpuDispatch.mutate()}>
                <RefreshCw size={15} /> Retry generation
              </Button>
            </>
          )}
        </div>
      ) : gpuDispatch.data?.state === "WAITING_FOR_GPUS" || generationWaitingForGpu ? (
        <div className="validation validation-info" role="status" aria-live="polite">
          {query.data.generation_provider === "KIE_FAL"
            ? "Waiting for API generation to start."
            : "Waiting for GPUs. Generation will start automatically when capacity opens."}
        </div>
      ) : gpuDispatch.data?.state === "PREPARING_INPUTS" ? (
        <div className="validation validation-info" role="status" aria-live="polite">
          Preparing exact avatar audio. Generation continues when ready.
        </div>
      ) : gpuDispatch.data && !hasFailed && !terminalBlocked && !terminalCancelled ? (
        <div className="validation validation-success" role="status" aria-live="polite">
          Generation is running. Correlation ID: <code>{gpuDispatch.data.correlation_id}</code>
        </div>
      ) : gpuDispatchResumeReady ? (
        <div className="validation validation-info" role="status" aria-live="polite">
          <p>Generation is ready to resume.</p>
          <Button variant="secondary" onClick={() => gpuDispatch.mutate()}>
            <RefreshCw size={15} /> Resume generation
          </Button>
        </div>
      ) : null}

      <div className="progress-workspace">
        <Panel className="pipeline-panel" eyebrow="Pipeline" heading="Video production stages">
          <StageTimeline
            stages={displayedStages}
            actions={stageMediaActions}
            retries={visibleStageRetries}
            retryNotices={stageRetryNotices}
            timings={Object.fromEntries(
              stageTimings.map((stage, index) => [
                stage.id,
                stage.id === "technical-check" ? (
                  <span key={stage.id} className="gpu-lane-elapsed">
                    Included in assembly time
                  </span>
                ) : (
                  <HostedElapsed
                    key={stage.id ?? index}
                    since={stage.since}
                    until={stage.until}
                    running={stage.running}
                    label={`${stage.name} elapsed time`}
                  />
                ),
              ]),
            )}
          />
          {query.data.generation ? (
            <section
              className="generation-plan-summary"
              aria-labelledby="generation-plan-summary-heading"
            >
              <div className="generation-plan-summary-heading">
                <div>
                  <p className="eyebrow">Stage 4 · deterministic timeline</p>
                  <h3 id="generation-plan-summary-heading">Plan scenes detail</h3>
                </div>
                <Badge tone="success">Saved</Badge>
              </div>
              <div className="detail-facts generation-plan-facts">
                <span>
                  <small>Total segments</small>
                  <strong>{hostedCountLabel(query.data.generation.total_segments)}</strong>
                </span>
                <span>
                  <small>Image scenes</small>
                  <strong>{hostedCountLabel(query.data.generation.image_scene_count)}</strong>
                </span>
                <span>
                  <small>Avatar segments</small>
                  <strong>{hostedCountLabel(query.data.generation.avatar_segment_count)}</strong>
                </span>
              </div>
            </section>
          ) : null}
        </Panel>
        <div className="progress-side">
          {showPromptFeed ? (
            <Panel className="live-prompt-panel" eyebrow="Stage 5 · Live" heading="Image prompts">
              <div className="live-prompt-status" aria-live="polite">
                <span
                  className={`live-prompt-status-dot${
                    promptWritingStopped
                      ? " is-stopped"
                      : promptWritingActive
                        ? " is-active"
                        : acceptedPromptCount > 0
                          ? " is-success"
                          : ""
                  }`}
                  aria-hidden="true"
                />
                <strong>
                  {promptWritingStopped
                    ? acceptedPromptCount > 0
                      ? `${acceptedPromptStatus} before writing stopped`
                      : "Prompt writing stopped"
                    : promptWritingActive
                      ? hasBatchProgress
                        ? `${promptBatchStatus} · ${acceptedPromptStatus}`
                        : acceptedPromptCount > 0
                          ? `${acceptedPromptStatus} · writing current batch`
                          : "Writing prompt batches"
                      : acceptedPromptCount > 0
                        ? acceptedPromptStatus
                        : "Waiting to start"}
                </strong>
              </div>
              {hasBatchProgress ? (
                <div className="live-prompt-progress" aria-label="Prompt batch progress">
                  <span>
                    <small>Batch progress</small>
                    <strong>{promptBatchStatus}</strong>
                  </span>
                  <span>
                    <small>Accepted prompts</small>
                    <strong>{acceptedPromptStatus}</strong>
                  </span>
                </div>
              ) : null}
              <p
                className={`live-prompt-activity${promptWritingActive ? " is-active" : ""}`}
                aria-live="polite"
              >
                {promptWritingActive ? (
                  <span className="live-prompt-activity-pulse" aria-hidden="true" />
                ) : null}
                {promptWritingActive
                  ? hasBatchProgress
                    ? `Writing ${promptBatchStatus.toLowerCase()}.`
                    : "Writing prompt batches."
                  : promptWritingStopped
                    ? "No new prompt batch will be sent automatically."
                    : acceptedPrompts.length > 0
                      ? "Accepted prompts saved."
                      : "Waiting for prompt writing."}
              </p>
              {acceptedPrompts.length > 0 ? (
                <div
                  className="live-prompt-scroll"
                  role="region"
                  aria-label="Accepted image prompts"
                  tabIndex={0}
                >
                  <ol className="live-prompt-list">
                    {acceptedPrompts.map((prompt) => (
                      <li className="live-prompt-item" key={prompt.scene_id}>
                        <div className="live-prompt-item-heading">
                          <strong>Scene {Number(prompt.scene_ordinal) + 1}</strong>
                          <span>{prompt.in_image_shot_role.replaceAll("_", " ")}</span>
                        </div>
                        <p className="live-prompt-narration">“{prompt.narration}”</p>
                        <p>
                          <strong>Prompt:</strong> {prompt.positive_prompt}
                        </p>
                        <p className="live-prompt-negative">
                          <strong>Avoid:</strong> {prompt.negative_prompt}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="live-prompt-empty" aria-busy={promptWritingActive}>
                  {promptWritingActive ? <span className="spinner" aria-hidden="true" /> : null}
                  <p>
                    {promptWritingActive
                      ? "Writing prompts…"
                      : promptWritingStopped
                        ? "No accepted prompts were saved. VideoForge stopped without redispatching the request."
                        : "Waiting for prompt writing."}
                  </p>
                </div>
              )}
            </Panel>
          ) : null}
          <HostedSpanAudioPanel progress={query.data.span_audio ?? null} />
          <HostedGpuLaneActivityPanel
            lanes={query.data.gpu_lanes ?? []}
            apiGeneration={query.data.generation_provider === "KIE_FAL"}
          />
          <Panel className="latest-artifact-panel" eyebrow="Latest" heading="Live preview">
            <div className="latest-artifact-frame">
              {stableRenderPreviewUrl ? (
                <video
                  className="media-artifact-video"
                  controls
                  preload="metadata"
                  src={stableRenderPreviewUrl}
                />
              ) : latestArtifact ? (
                <img src={latestArtifact} alt="Latest accepted project artifact" />
              ) : (
                <div className="live-preview-waiting">
                  <Images size={30} aria-hidden="true" />
                  <strong>Waiting for first visual</strong>
                </div>
              )}
            </div>
            <div className="artifact-caption">
              <span>{latestArtifact ? "Latest accepted" : "Preparing assets"}</span>
              <Badge tone={latestArtifact ? "success" : "neutral"}>
                {latestArtifact ? "Ready" : "Waiting"}
              </Badge>
            </div>
          </Panel>
          {contextComplete && contextDocument ? (
            <Panel
              className="extracted-context-panel"
              eyebrow="Stage 3 result"
              heading="Extracted context"
            >
              {contextText ? <p className="extracted-context-summary">{contextText}</p> : null}
            </Panel>
          ) : null}
          <Panel eyebrow="Activity" heading="Current run">
            <div className="detail-facts">
              <span>
                <small>Queue</small>
                <strong>
                  {queue?.position ? `Position ${queue.position}` : "Direct personal worker"}
                </strong>
              </span>
              <span>
                <small>Elapsed</small>
                <strong>{formatMilliseconds(timing?.end_to_end_ms)}</strong>
              </span>
              <span>
                <small>Worker jobs</small>
                <strong>{query.data.attempts.length || "Preparing"}</strong>
              </span>
              <span>
                <small>Last update</small>
                <strong>
                  {formatTimestamp(
                    query.data.attempts.at(-1)?.updated_at ?? query.data.project.created_at,
                  )}
                </strong>
              </span>
            </div>
            {cancellableAttempts.length > 0 ? (
              <div className="current-run-actions">
                {cancellableAttempts.map((attempt) => (
                  <Button
                    key={attempt.id}
                    variant="danger"
                    busy={cancel.isPending && cancel.variables === attempt.id}
                    onClick={() => {
                      if (
                        attempt.state === "CANCEL_REQUESTED" ||
                        (armedCancellation?.attemptId === attempt.id &&
                          armedCancellation.attemptState === attempt.state)
                      ) {
                        setArmedCancellation(null);
                        cancel.mutate(attempt.id);
                        return;
                      }
                      setArmedCancellation({
                        attemptId: attempt.id,
                        attemptState: attempt.state,
                      });
                    }}
                  >
                    <X size={15} />
                    {attempt.state === "CANCEL_REQUESTED"
                      ? `Finish stopping ${cancellableAttemptLabel(attempt.kind)}`
                      : armedCancellation?.attemptId === attempt.id &&
                          armedCancellation.attemptState === attempt.state
                        ? `Confirm stop ${cancellableAttemptLabel(attempt.kind)}`
                        : `Stop ${cancellableAttemptLabel(attempt.kind)}`}
                  </Button>
                ))}
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
      {!asr ? (
        <div className="notice" role="status">
          <strong>Ready to transcribe.</strong>
          {asrHandoff.isError ? <span> {asrHandoff.error.message}</span> : null}
          <Button variant="primary" busy={asrHandoff.isPending} onClick={() => asrHandoff.mutate()}>
            Start transcription
          </Button>
        </div>
      ) : null}
      {asr?.kind === "ASR" && asr.state === "FAILED" ? (
        <div className="notice notice-danger" role="alert">
          <strong>Transcription stopped before the transcript could be saved.</strong>
          <span>{transcriptionFailureMessage(asr.error_code)}</span>
          {/* A refused retry is shown inside the stage row next to the button that was pressed; this
              notice only carries it when the stage row itself has nothing to show. */}
          {asrHandoff.isError && !failedStageIds.has("transcription") ? (
            <span>{asrHandoff.error.message}</span>
          ) : null}
          <span>Retry it from stage 02 above.</span>
        </div>
      ) : null}
      {asr?.state === "SUCCEEDED" && !contextComplete ? (
        <div className={`notice${contextNeedsReview ? " notice-danger" : ""}`} role="status">
          <strong>
            {contextProviderFailed
              ? "Provider task failed."
              : contextValidationFailed
                ? "Context result failed validation."
                : contextUnknown
                  ? contextReconciliation.isPending
                    ? "Checking provider result…"
                    : "Provider result needs confirmation."
                  : contextNeedsReview
                    ? "Context extraction needs review."
                    : contextAutoStartError
                      ? "Automatic context extraction could not start."
                      : "Continuing after transcription."}
          </strong>
          <span>
            {contextValidationFailed
              ? "The provider returned a result, but it could not be accepted. This run is stopped; no new inference request was sent."
              : contextUnknown
                ? "No new request sent."
                : contextNeedsReview
                  ? "Stopped safely; no automatic retry."
                  : "Story facts are saved before scene planning continues."}
          </span>
          {contextAutoStartError ? <span>{contextExtraction.error.message}</span> : null}
          {contextReconciliation.isError &&
          contextUnknown &&
          !failedStageIds.has("voiceover-context") ? (
            <span>{contextReconciliation.error.message}</span>
          ) : null}
          {contextReconciliationCouldNotFinish ? (
            <span>Retry it from stage 03 above.</span>
          ) : contextNeedsReview && !contextUnknown ? (
            <span>The provider returned a definite failure. No context result was accepted.</span>
          ) : contextAutoStartError ? (
            // Nothing started, so no provider work can be resumed; stage 03 above now reports the same
            // FAILED reason inline, and the notice keeps this control as the pipeline-level recovery
            // for the run it stopped.
            <Button
              variant="primary"
              busy={contextExtraction.isPending}
              onClick={() => contextExtraction.mutate(asr.id)}
            >
              <RefreshCw size={15} /> Retry automatic continuation
            </Button>
          ) : null}
        </div>
      ) : null}
      {asr?.state === "SUCCEEDED" && contextComplete && !render ? (
        <div className="notice" role="status">
          <strong>
            {renderHandoff.isError && !query.data.generation
              ? "Transcription complete; generation planning could not be verified."
              : renderHandoff.isPending
                ? "Saving scene plan…"
                : query.data.generation
                  ? generationStopped
                    ? "Generation stopped."
                    : generationWaitingForGpu
                      ? query.data.generation_provider === "KIE_FAL"
                        ? "Waiting for API generation."
                        : "Waiting for GPUs."
                      : promptStage?.status === "COMPLETE"
                        ? query.data.generation_provider === "KIE_FAL" ||
                          (query.data.gpu_transport === "QUALIFIED_EXACT" &&
                            query.data.gpu_readiness.dispatch_available === true)
                          ? "Ready to generate."
                          : "Waiting for GPU qualification."
                        : promptAutoStartError
                          ? "Automatic image prompt writing could not start."
                          : "Writing image prompts…"
                  : "Transcription complete; generation planning is starting."}
          </strong>
          {renderHandoff.isError && !query.data.generation ? (
            <span> {renderHandoff.error.message}</span>
          ) : null}
          {generationStopped ? (
            <span>
              Generation ended in a terminal state. No automatic
              {query.data.generation_provider === "KIE_FAL" ? " API" : " GPU"} retry was sent.
            </span>
          ) : null}
          {renderHandoff.isError && !query.data.generation ? (
            <>
              <span>Your transcript is saved. This will retry planning only.</span>
              <Button
                variant="primary"
                busy={renderHandoff.isPending}
                onClick={() => renderHandoff.mutate(asr.id)}
              >
                <RefreshCw size={15} /> Retry planning
              </Button>
            </>
          ) : null}
          {(!renderHandoff.isError || query.data.generation) &&
          !generationStopped &&
          query.data.generation &&
          promptStage?.status !== "COMPLETE" ? (
            <>
              <span>Scene prompts are generated automatically.</span>
              {promptAutoStartError ? <span>{promptWriting.error.message}</span> : null}
              {promptAutoStartError ? (
                <Button
                  variant="primary"
                  busy={promptWriting.isPending}
                  onClick={() => promptWriting.mutate()}
                >
                  <RefreshCw size={15} /> Retry automatic prompt writing
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      <Button variant="secondary" onClick={() => void query.refetch()}>
        <RefreshCw size={15} /> Refresh now
      </Button>
      <Panel eyebrow="Project" heading="Delete project">
        <p className="helper">Stops new work and removes this project. Billing history stays.</p>
        {canRequestProjectReconciliation ? (
          <Button
            variant="danger"
            busy={cancelProjectWork.isPending}
            disabled={cancelProjectWork.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `${
                    providerBoundGenerationAttempts.length > 0
                      ? "Stop and reconcile provider work"
                      : "Cancel active work"
                  } for “${query.data.project.title}”? No provider request will be retried, and no new provider request will be created. You can delete the project after reconciliation finishes.`,
                )
              )
                cancelProjectWork.mutate();
            }}
          >
            <X size={16} aria-hidden="true" /> {projectWorkActionLabel}
          </Button>
        ) : null}
        <Button
          variant="danger"
          busy={deleteProject.isPending}
          disabled={deleteProject.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Delete “${query.data.project.title}”? This removes it from your workspace. Billing and security history will be retained.`,
              )
            )
              deleteProject.mutate();
          }}
        >
          <Trash2 size={16} aria-hidden="true" /> Delete project
        </Button>
        {deleteProject.isError ? (
          <div className="validation validation-danger" role="alert">
            {deleteProject.error.message}
          </div>
        ) : null}
        {cancelProjectWork.isError ? (
          <div className="validation validation-danger" role="alert">
            {cancelProjectWork.error.message}
          </div>
        ) : null}
      </Panel>
    </>
  );
}

export function HostedReviewScreen({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
  });
  const candidate = useMemo(
    () =>
      [...(query.data?.attempts ?? [])]
        .reverse()
        .find((attempt) => attempt.kind === "RENDER" && attempt.state === "SUCCEEDED"),
    [query.data],
  );
  const approve = useMutation({
    mutationFn: () =>
      readJson(`/api/v2/hosted/projects/${projectId}/review`, {
        method: "POST",
        body: JSON.stringify({ attempt_id: candidate?.id }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-project", projectId] }),
  });
  const review = query.data?.review;
  const contactSheet = review?.contact_sheet ?? query.data?.contact_sheet ?? [];
  const qualityFlags = review?.quality_flags ?? query.data?.quality_flags ?? [];
  const manifestUrl = review?.manifest_url ?? query.data?.manifest_url ?? null;
  const downloadUrl = review?.download_url ?? candidate?.preview_url ?? null;
  if (query.isPending)
    return (
      <Panel eyebrow="Review" heading="Loading candidate">
        <p>Checking output…</p>
      </Panel>
    );
  if (query.isError || !candidate?.preview_url)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Output is not ready for review"
        body="A verified render is required before review."
        action={
          <Link
            className="button button-secondary"
            to="/projects/$projectId"
            params={{ projectId }}
          >
            Progress
          </Link>
        }
      />
    );
  return (
    <>
      <PageHeader
        eyebrow={candidate.approved_at ? "Approved" : "Review required"}
        title="Review"
        description={query.data?.project.title}
        actions={
          <Button
            disabled={Boolean(candidate.approved_at)}
            busy={approve.isPending}
            onClick={() => approve.mutate()}
          >
            <ShieldCheck size={16} /> {candidate.approved_at ? "Approved" : "Approve final"}
          </Button>
        }
      />
      <Panel className="review-player" eyebrow="Private candidate" heading="Final output">
        <div className="review-player-frame">
          <video controls preload="metadata" src={candidate.preview_url} />
        </div>
        <div className="review-player-meta">
          <Badge tone={candidate.approved_at ? "success" : "warning"}>
            {candidate.approved_at ? "APPROVED" : "REVIEW NEEDED"}
          </Badge>
          {candidate.approved_at && downloadUrl ? (
            <a
              className="button button-secondary"
              href={downloadUrl}
              download="videoforge-output.mp4"
            >
              <Download size={16} /> Download MP4
            </a>
          ) : (
            <Button variant="secondary" disabled>
              <Download size={16} /> Download after approval
            </Button>
          )}
        </div>
      </Panel>
      <Panel eyebrow="Scenes" heading="Contact sheet">
        {contactSheet.length > 0 ? (
          <div className="card-grid style-card-grid">
            {contactSheet.map((item, index) => (
              <figure key={item.id ?? item.asset_id ?? `${item.image_url}-${index}`}>
                <img src={item.image_url} alt={item.label ?? `Generated asset ${index + 1}`} />
                <figcaption>
                  {item.label ?? item.shot_role ?? `Asset ${index + 1}`}
                  {item.start_ms !== undefined && item.start_ms !== null
                    ? ` · ${formatMilliseconds(item.start_ms)}–${formatMilliseconds(item.end_ms)}`
                    : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="helper">No scene images available.</p>
        )}
      </Panel>
      <Panel eyebrow="Quality gate" heading="Review flags">
        {qualityFlags.length > 0 ? (
          <div className="entity-list">
            {qualityFlags.map((flag, index) => (
              <article className="entity-row" key={flag.id ?? `${flag.category}-${index}`}>
                <div>
                  <strong>{flag.category}</strong>
                  <small>{flag.message}</small>
                  {flag.asset_id ? <small>Asset · {flag.asset_id}</small> : null}
                </div>
                <Badge tone={statusTone(flag.status)}>{normalizedStatus(flag.status)}</Badge>
                {flag.replacement_allowed ? (
                  <small>Replacement needs a source upload.</small>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="helper">No flags returned. Review the video before approving.</p>
        )}
      </Panel>
      <Panel eyebrow="Provenance" heading="Download evidence">
        {manifestUrl && candidate.approved_at ? (
          <a
            className="button button-secondary"
            href={manifestUrl}
            download="videoforge-provenance.json"
          >
            <Download size={16} /> Download provenance manifest
          </a>
        ) : (
          <p className="helper">Available after approval.</p>
        )}
      </Panel>
      {approve.isError ? (
        <div className="validation validation-danger">{approve.error.message}</div>
      ) : null}
    </>
  );
}

export function HostedUsageScreen() {
  const query = useQuery({
    queryKey: ["hosted-usage"],
    queryFn: () => readJson<HostedUsageResponse>("/api/v2/hosted/usage"),
  });
  if (query.isPending)
    return (
      <Panel eyebrow="Workspace" heading="Loading usage">
        <p>Reading workspace totals…</p>
      </Panel>
    );
  if (query.isError || !query.data)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Usage unavailable"
        body="Usage could not be loaded. Try again."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  return (
    <>
      <PageHeader title="Usage" />
      <div className="grid grid-3 usage-grid">
        <Metric label="Provider charges" value="Not tracked" detail="not reported" />
        <Metric
          label="Computer work"
          value={formatMilliseconds(query.data.personal_worker_seconds * 1_000)}
          detail="measured time"
        />
        <Metric
          label="Stored media"
          value={`${(query.data.retained_bytes / 1024 / 1024 / 1024).toFixed(3)} GB`}
          detail="until deleted"
        />
      </div>
      <div className="grid grid-3 usage-grid">
        <Metric label="Runs" value={String(query.data.attempts)} detail="this month" />
        <Metric label="Completed" value={String(query.data.succeeded)} />
        <Metric label="Needs attention" value={String(query.data.failed)} />
      </div>
      <Panel heading="Usage details">
        {query.data.as_of ? (
          <p className="helper">As of {formatTimestamp(query.data.as_of)}.</p>
        ) : null}
        {query.data.fixed_recurring_usd !== undefined && query.data.fixed_recurring_usd !== null ? (
          <div className="notice">
            Retained volume: {formatUsd(query.data.fixed_recurring_usd)}.
          </div>
        ) : null}
        {query.data.projects?.length ? (
          <div className="entity-list">
            {query.data.projects.map((project) => (
              <article className="entity-row" key={project.project_id}>
                <div>
                  <strong>{project.title}</strong>
                  <small>{project.attempts ?? 0} runs</small>
                </div>
                <span>
                  <small>Projected</small> {formatUsd(project.projected_usd)}
                </span>
                <span>
                  <small>Settled</small> {formatUsd(project.settled_usd)}
                </span>
                <span>
                  <small>Queue / end-to-end</small> {formatMilliseconds(project.queue_wait_ms)} /{" "}
                  {formatMilliseconds(project.end_to_end_ms)}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="helper">No detailed timing reported.</p>
        )}
        {query.data.lanes?.length ? (
          <Disclosure summary="Lane breakdown">
            <div className="entity-list">
              {query.data.lanes.map((lane) => (
                <article className="entity-row" key={lane.lane}>
                  <strong>{lane.lane}</strong>
                  <span>Projected {formatUsd(lane.projected_usd)}</span>
                  <span>Settled {formatUsd(lane.settled_usd)}</span>
                  <span>{lane.billed_seconds ?? "Not reported"} billed seconds</span>
                </article>
              ))}
            </div>
          </Disclosure>
        ) : null}
      </Panel>
    </>
  );
}
