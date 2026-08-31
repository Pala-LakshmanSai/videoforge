import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { isHostedBetaMode } from "./provider-mode";
import type { ProjectStage } from "../lib/types";

const MAX_VOICEOVER_BYTES = 1_073_741_824;
const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
const MAX_STYLE_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_STYLE_ANALYSIS_BYTES = 30 * 1024 * 1024;
const MAX_STYLE_REFERENCES = 8;
const MIN_STYLE_REFERENCES = 3;
const DEFAULT_SPEND_CAP_USD = "1.00";
const HOSTED_CREATE_SCHEMA = "videoforge-hosted-project-create/v2";
const VOICEOVER_TYPES = new Set(["audio/mpeg", "audio/wav"]);
export const HOSTED_SHA256_CHUNK_BYTES = 4 * 1024 * 1024;

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
    readonly spend_cap_usd?: number;
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
              <p className="eyebrow">Gemini analysis</p>
              <h3>Style summary</h3>
              <p>{profile.summary}</p>
            </section>
          ) : null}
          <section className="detail-section">
            <div className="detail-section-heading">
              <h3>Visual character</h3>
              <span>Reusable traits extracted from your references</span>
            </div>
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
          <section className="detail-section">
            <div className="detail-section-heading">
              <h3>Generation rules</h3>
              <span>How VideoForge will preserve this look</span>
            </div>
            <StyleTraitList label="Keep" values={profile.mustInclude} tone="positive" />
            <StyleTraitList label="Avoid" values={profile.mustAvoid} tone="negative" />
            <StyleTraitList label="Can vary" values={profile.flexible} />
          </section>
          {profile.positivePrompt || profile.negativePrompt ? (
            <details className="detail-section style-prompt-details">
              <summary>Prompt instructions used during generation</summary>
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
          The published style is ready to use, but its analysis summary is unavailable.
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
  readonly kind: "ASR" | "RENDER" | "MAGE_IMAGE" | "SOULX_AVATAR";
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

interface HostedTiming {
  readonly queue_wait_ms?: number | null;
  readonly initialization_ms?: number | null;
  readonly model_ready_ms?: number | null;
  readonly inference_ms?: number | null;
  readonly upload_ms?: number | null;
  readonly render_ms?: number | null;
  readonly end_to_end_ms?: number | null;
}

interface HostedCost {
  readonly projected_usd?: number | null;
  readonly settled_usd?: number | null;
  readonly cap_usd?: number | null;
  readonly billed_seconds?: number | null;
  readonly provider?: string | null;
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
  readonly id?: string;
  readonly asset_id?: string | null;
  readonly image_url: string;
  readonly label?: string | null;
  readonly start_ms?: number | null;
  readonly end_ms?: number | null;
  readonly shot_role?: string | null;
}

interface HostedReviewSnapshot {
  readonly contact_sheet?: readonly HostedContactSheetItem[];
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
  readonly gpu_transport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
  readonly gpu_readiness: CatalogResponse["gpu_readiness"];
  readonly generation: null | {
    readonly id: string;
    readonly timeline_plan_sha256: string;
    readonly planned_tasks: number | string;
    readonly completed_tasks: number | string;
    readonly failed_tasks: number | string;
    readonly stage:
      | "WAITING_FOR_GPU_QUALIFICATION"
      | "READY_FOR_GPU_DISPATCH"
      | "READY_FOR_RENDER"
      | "FAILED";
  };
  readonly queue?: HostedQueueSnapshot | null;
  readonly stages?: readonly HostedStage[];
  readonly timing?: HostedTiming | null;
  readonly cost?: HostedCost | null;
  readonly scale_to_zero?: HostedScaleToZero | null;
  readonly review?: HostedReviewSnapshot | null;
  readonly contact_sheet?: readonly HostedContactSheetItem[];
  readonly quality_flags?: readonly HostedQualityFlag[];
  readonly manifest_url?: string | null;
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

interface HostedUploadDescriptor {
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
    throw new Error(error?.message ?? error?.code ?? "VideoForge hosted request failed.");
  }
  return payload as T;
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
  fallbackCapUsd: number,
): string {
  const cap = estimate?.cap_usd ?? fallbackCapUsd;
  if (!dispatchAvailable) {
    return `No paid video generation in this beta · maximum ${formatUsd(cap)}`;
  }
  if (typeof estimate?.projected_usd === "number" && Number.isFinite(estimate.projected_usd)) {
    return `Estimated variable cost ${formatUsd(estimate.projected_usd)} · maximum ${formatUsd(cap)}`;
  }
  return `Estimate pending · maximum ${formatUsd(cap)}`;
}

function formatMilliseconds(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Not reported";
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
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

function attemptLabel(kind: HostedAttempt["kind"]): string {
  if (kind === "ASR") return "Transcribe voiceover";
  if (kind === "MAGE_IMAGE") return "Generate scene image";
  if (kind === "SOULX_AVATAR") return "Generate avatar segment";
  return "Render final video";
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

async function putHostedUpload(upload: HostedUploadDescriptor, file: File): Promise<void> {
  const headers = Object.fromEntries(
    Object.entries(upload.requiredHeaders ?? {}).filter(
      ([key]) => key.toLowerCase() !== "content-length",
    ),
  );
  const result = await bounded(
    fetch(upload.url, { method: "PUT", headers, body: file }),
    "Private upload timed out. Retry this step.",
  );
  if (!result.ok) throw new Error(`Private upload failed (HTTP ${result.status}).`);
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

function presetState(item: { readonly state?: string; readonly status?: string }) {
  return item.state ?? item.status ?? "READY";
}

function unfinishedPresetLabel(value: string): string {
  switch (value) {
    case "NEEDS_REVIEW":
      return "Ready to review";
    case "ANALYZING":
      return "Analysis in progress";
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
    if (state === "ANALYZING")
      return "Approval is being reconciled. We will update this avatar when it finishes.";
    if (state === "FAILED")
      return "This avatar could not be completed. Remove it and start again with a new photo.";
    if (state === "DRAFT")
      return "Your avatar draft is saved. Continue to verify the photo upload, then approve it.";
    return state === "NEEDS_REVIEW"
      ? "Your photo is saved. Continue to review and approve this avatar."
      : "Your photo is saved. Continue setup to review and approve this avatar.";
  }
  if (state === "NEEDS_REVIEW") {
    return "Your style profile is ready. Continue to review and publish it.";
  }
  if (state === "ANALYZING") {
    return "Analysis is in progress. We will update this style when it finishes.";
  }
  if (state === "FAILED") {
    return "The analysis request failed, but your verified references are saved. Continue setup to retry safely.";
  }
  if (state === "DRAFT" && !referencesVerified)
    return "Some saved references could not be verified. Reselect 3–8 images to repair this saved draft.";
  if (state === "DRAFT")
    return referenceCount > 0
      ? `${referenceCount} references are saved. Continue to verify the uploads, then analyze and publish this style.`
      : "Your style draft is saved. Continue to verify the uploads, then analyze and publish it.";
  return referenceCount > 0
    ? `${referenceCount} references saved. Continue setup to analyze and publish this style.`
    : "Your style is saved. Continue setup to add references and publish it.";
}

const HUMAN_PIPELINE_STAGES = [
  "Prepare",
  "Transcribe",
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
  if (["RUNNING", "ACTIVE", "ADMITTED", "SUBMITTED", "OUTBOXED"].includes(normalized))
    return "RUNNING";
  if (["STARTING", "PREPARING", "RECONCILING"].includes(normalized)) return "STARTING";
  if (["RETRYING", "RETRY_WAIT"].includes(normalized)) return "RETRYING";
  if (["FAILED", "PERMANENT_FAILED", "RETRYABLE_FAILED"].includes(normalized)) return "FAILED";
  if (["CANCEL_REQUESTED"].includes(normalized)) return "CANCEL_REQUESTED";
  if (["CANCELLED"].includes(normalized)) return "CANCELLED";
  if (
    normalized.includes("QUALIFICATION") ||
    normalized.includes("BLOCKED") ||
    normalized.includes("UNAVAILABLE")
  )
    return "BLOCKED";
  if (["QUEUED", "WAITING", "NOT_STARTED", "NOT_REPORTED"].includes(normalized)) return "PENDING";
  return "PENDING";
}

function hostedProgressValue(stage: HostedStage): number {
  if (typeof stage.progress_percent === "number")
    return Math.max(0, Math.min(100, stage.progress_percent));
  return hostedStageStatus(stage.status) === "COMPLETE" ? 100 : 0;
}

function hostedProjectStages(stages: readonly HostedStage[]): ProjectStage[] {
  return stages.map((stage, index) => ({
    id: stage.id ?? `stage-${index + 1}`,
    label: stage.name,
    status: hostedStageStatus(stage.status),
    completed: Math.round(hostedProgressValue(stage)),
    total: 100,
    detail: stage.detail ?? "Waiting for an authoritative update.",
  }));
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
  const [spendCapUsd, setSpendCapUsd] = useState(DEFAULT_SPEND_CAP_USD);
  const [voiceoverMeta, setVoiceoverMeta] = useState<{
    readonly contentType: string;
    readonly checksumSha256: string;
    readonly durationMs: number;
  } | null>(null);
  const [preflightResult, setPreflightResult] = useState<HostedPreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentTypeForVoiceover = (file: File): string => {
    if (/\.wav$/iu.test(file.name)) return "audio/wav";
    if (/\.mp3$/iu.test(file.name)) return "audio/mpeg";
    return VOICEOVER_TYPES.has(file.type) ? file.type : "";
  };
  const cap = Number(spendCapUsd);
  const capValid = Number.isFinite(cap) && cap >= 0.1 && cap <= 2;
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
    title.trim() && avatarVersionId && styleVersionId && voiceover && capValid && keywordsValid,
  );
  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (!voiceover) throw new Error("Choose a voiceover first.");
      const contentType = contentTypeForVoiceover(voiceover);
      if (!VOICEOVER_TYPES.has(contentType))
        throw new Error("Use a WAV or MP3 voiceover for hosted generation.");
      if (voiceover.size > MAX_VOICEOVER_BYTES) throw new Error("Voiceover must be at most 1 GB.");
      const checksumSha256 = await hostedFileSha256(voiceover);
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
            spend_cap_usd: cap,
            voiceover: {
              filename: voiceover.name,
              content_type: contentType,
              content_length: voiceover.size,
              checksum_sha256: checksumSha256,
              duration_ms: durationMs,
            },
          }),
        }),
        "Hosted preflight timed out. Retry the readiness check.",
      );
      return { result, contentType, checksumSha256, durationMs };
    },
    onSuccess: ({ result, contentType, checksumSha256, durationMs }) => {
      setVoiceoverMeta({ contentType, checksumSha256, durationMs });
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
      if (!preflightReady(preflightResult))
        throw new Error("Run a successful readiness check before generating.");
      setError(null);
      const metadata =
        voiceoverMeta ??
        (() => {
          throw new Error("Run the readiness check again before generating.");
        })();
      const idempotencyKey = `browser-project-${crypto.randomUUID()}`;
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
          headers: { "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            schema_version: HOSTED_CREATE_SCHEMA,
            title: title.trim(),
            avatar_profile_version_id: avatarVersionId,
            image_style_version_id: styleVersionId,
            extra_prompt_keywords: applyExtraPromptKeywords ? extraPromptKeywords.trim() : "",
            apply_extra_prompt_keywords: applyExtraPromptKeywords,
            user_seed: userSeed.trim() ? Number(userSeed) : null,
            spend_cap_usd: cap,
            voiceover: {
              filename: voiceover.name,
              content_type: metadata.contentType,
              content_length: voiceover.size,
              checksum_sha256: metadata.checksumSha256,
              duration_ms: metadata.durationMs,
            },
          }),
        }),
        "Hosted project creation timed out. Retry from Create Project.",
      );
      if (created.upload) {
        const headers = Object.fromEntries(
          Object.entries(created.upload.requiredHeaders).filter(
            ([key]) => key !== "content-length",
          ),
        );
        const uploadController = new AbortController();
        const uploaded = await bounded(
          fetch(created.upload.url, {
            signal: uploadController.signal,
            method: "PUT",
            headers,
            body: voiceover,
          }),
          "Private voiceover upload timed out. Retry from Create Project.",
        ).catch((error) => {
          uploadController.abort();
          throw error;
        });
        if (!uploaded.ok)
          throw new Error(`Private voiceover upload failed (HTTP ${uploaded.status}).`);
      }
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
      <PageHeader
        title="New project"
        description="Add your finished voiceover, choose the look, and review the cost before starting."
      />
      <div className="layout-main hosted-project-layout">
        <Panel className="create-config-panel hosted-project-form">
          <section className="create-section" aria-labelledby="hosted-project-video">
            <header className="create-section-header">
              <span className="create-section-index">01</span>
              <div>
                <h3 id="hosted-project-video">Video</h3>
                <p>Name the project and add the finished narration.</p>
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
                  placeholder="Give your video a clear title"
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
                <p>Choose the presenter and visual style for this video.</p>
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
                    meta: `Version ${avatar.version_number}`,
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
                      <small>Use a few extra words to guide generated scene images.</small>
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
                    <label htmlFor="hosted-user-seed">Variation number (optional)</label>
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
                      placeholder="Leave blank for automatic"
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
                  ? "Connected; ready when the project inputs are complete."
                  : "Open Settings and connect the personal media worker before starting."}
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

          <div className="field">
            <label htmlFor="hosted-spend-cap">Maximum spend</label>
            <div className="hosted-money-input">
              <span>$</span>
              <input
                id="hosted-spend-cap"
                className="input"
                inputMode="decimal"
                type="number"
                min="0.1"
                max="2"
                step="0.01"
                value={spendCapUsd}
                onChange={(event) => {
                  setSpendCapUsd(event.target.value);
                  setPreflightResult(null);
                }}
              />
            </div>
            <small>This is a hard limit, not an expected charge.</small>
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
                {hostedPreflightEstimateText(
                  preflightResult.estimate,
                  catalog.data.gpu_readiness.dispatch_available,
                  cap,
                )}
              </span>
            </div>
          ) : null}
          {preflightBlockers(preflightResult).length > 0 ? (
            <div className="validation validation-danger">
              <strong>Resolve these blockers:</strong>
              <ul>
                {preflightBlockers(preflightResult).map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!capValid ? (
            <p className="validation validation-danger">
              Enter a finite spend cap of at least $0.10.
            </p>
          ) : null}
          {!keywordsValid ? (
            <p className="validation validation-danger">
              Extra prompt keywords must be at most 500 characters.
            </p>
          ) : null}
          {voiceoverMeta ? (
            <p className="helper">
              Voiceover checked: {formatMilliseconds(voiceoverMeta.durationMs)}
            </p>
          ) : null}
          {!catalog.data.gpu_readiness.dispatch_available ? (
            <p className="helper hosted-beta-note" role="note">
              This beta can create and transcribe your project. Final video generation is not yet
              available, and no paid GPU work will start.
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
            onClick={() => {
              if (preflightReady(preflightResult)) submit.mutate();
              else preflightMutation.mutate();
            }}
          >
            {preflightReady(preflightResult) ? <FileAudio size={16} /> : <Check size={16} />}
            {preflightReady(preflightResult)
              ? "Create project & transcribe"
              : "Check cost & readiness"}
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
  const betaCreation = isHostedBetaMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE);
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
          <Badge tone={draft ? statusTone(state) : statusTone(state)}>
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
            description={
              isAvatar
                ? "Ready to use"
                : referenceCount > 0
                  ? `Published · ${referenceCount} references`
                  : "Published"
            }
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
          <p>Loading your {itemLabel}s…</p>
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
          betaCreation ? (
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
            body={`Create your first ${itemLabel} before starting a project.`}
            action={
              betaCreation ? (
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
                    <p className="eyebrow">Finish setup</p>
                    <h2 id={`${kind}-drafts-heading`}>Unfinished {itemLabel}s</h2>
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
        eyebrow="Private hosted staging"
        title={`${title} creation unavailable`}
        description="Hosted V2-06 accepts only exact activation-owned presets."
      />
      <EmptyState
        icon={isAvatar ? <UsersRound /> : <Images />}
        title="Read-only hosted catalog"
        body={`The ${itemLabel} creation workflow is intentionally disabled in staging. Open the hub to inspect tenant-owned versions, or return to Settings for worker status.`}
        action={
          <div className="cluster">
            <Link className="button button-secondary" to={isAvatar ? "/avatars" : "/styles"}>
              Open {title}
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
      ? "Replacement references are ready to verify."
      : `Reselect ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} images to repair this saved draft.`
    : matchingDraftName
      ? matchingDraftResumable
        ? `This unfinished ${itemLabel} is already in the Hub. Continue setup from there.`
        : `This unfinished ${itemLabel} is already in the Hub. View it there or remove it before starting another.`
      : duplicateReadyName
        ? `Choose a different ${itemLabel} name.`
        : !name.trim() && !hasRequiredSource
          ? `Add a name and ${isAvatar ? "photo" : "reference images"} to continue.`
          : !name.trim()
            ? `Add a ${itemLabel} name to continue.`
            : !hasRequiredSource
              ? isAvatar
                ? "Choose a photo to continue."
                : `Choose ${MIN_STYLE_REFERENCES}–${MAX_STYLE_REFERENCES} reference images to continue.`
              : "Ready to review.";

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
    for (const source of styleSources) URL.revokeObjectURL(source.objectUrl);
    setStyleSources([]);
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
      setStyleSources(
        files.map((file, index) => ({
          file,
          checksum: normalized[index]!.original.checksum,
          objectUrl: normalized[index]!.objectUrl,
          normalized: normalized[index]!,
        })),
      );
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
    "No analysis summary was returned; publication remains blocked until review data is available.";

  return (
    <>
      <PageHeader
        eyebrow={`${title} · step ${isAvatar ? Math.min(step, 2) : step === 4 ? 3 : step} of ${isAvatar ? 2 : 3}`}
        title={title}
        description={
          parentId
            ? `Create an immutable new version from ${parentId}. Existing project pins remain unchanged.`
            : `Upload, review, and approve a private reusable ${itemLabel}.`
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
              ? "Add your avatar"
              : "Build your image style"
            : step === 2
              ? "Technical review"
              : isAvatar
                ? "Review and add"
                : step === 3
                  ? "Analyze references"
                  : "Review and publish"
        }
      >
        {resumeVersionId && created ? (
          <div className="preset-resume-banner" role="status">
            <strong>Continuing “{name}”</strong>
            <span>
              {repairingReferences
                ? "Some saved references could not be verified. Reselect 3–8 images to repair this saved draft."
                : "Your saved work is loaded. Continue from the last completed step."}
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
              <small>
                {isAvatar
                  ? "This is how it will appear in your Avatar Hub."
                  : "This is how it will appear in Image Styles."}
              </small>
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
                  <strong>{avatarSource?.file.name ?? "Choose a clear front-facing photo"}</strong>
                  {avatarSource
                    ? `${avatarSource.width}×${avatarSource.height} · ready to review`
                    : "JPG, PNG or WebP · at least 512×512 · max 20 MB"}
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
                    ? "Ready to review — choose again to replace them"
                    : "Use images with a consistent look · max 20 MB each"}
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
              {isAvatar
                ? "Photo decoded successfully and passed the size check."
                : "Reference files selected and checksums verified."}
            </div>
            <div className="notice notice-warning">
              <strong>Check before continuing.</strong>{" "}
              {isAvatar
                ? "Make sure the presenter is clear, front-facing, and free of text, logos, or watermarks."
                : "Make sure the references share a consistent visual look and contain no text, logos, or watermarks."}
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              Back
            </Button>
            <div className="preset-action-disclosure">
              {isAvatar
                ? "By adding this avatar, you confirm you have the right to use and animate this likeness."
                : "By preparing this style, you confirm you can use these images. Private originals are kept until you remove the style and are never sent to Runware or Gemini. Normalized copies are sent only when you explicitly analyze."}
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
                ? "Verify replacement references"
                : isAvatar
                  ? "Add to Avatar Hub"
                  : "Prepare analysis"}{" "}
              <ArrowRight size={16} />
            </Button>
          </div>
        ) : null}
        {step === 3 && !isAvatar ? (
          <div className="stack">
            <div className={!fixtureBackend ? "notice notice-warning" : "notice"}>
              <strong>
                {!fixtureBackend ? "Gemini image analysis" : "Local fixture analysis"}
              </strong>{" "}
              {!fixtureBackend
                ? "Your normalized references will be sent through Runware to Gemini 3.1 Flash Lite once to extract reusable visual traits. They are not sent again during video generation. This bounded analysis may incur a small provider charge within the private beta’s $3 total ceiling."
                : "This walkthrough uses a simulated profile and makes no external AI request."}
            </div>
            <div className="preset-action-disclosure">
              {fixtureBackend
                ? "By analyzing, you confirm you can use these images. Normalized copies are processed locally for this walkthrough."
                : "By analyzing, you confirm you can use these images. Normalized copies are sent once through Runware to Gemini; provider retention follows their terms. Private originals stay in your workspace until you remove the style."}
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
                Upload and prepare analysis <ArrowRight size={16} />
              </Button>
            ) : (
              <Button busy={busy} onClick={() => void analyzeStyle()}>
                {presetState(created) === "FAILED"
                  ? "Retry saved analysis"
                  : "Analyze this draft once"}{" "}
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
                ? "Local fixture profile returned for workflow review."
                : "Gemini analyzed this exact reference set. Review the extracted style before publishing."}
            </div>
            <p>{profileSummary}</p>
            {!fixtureBackend && typeof created?.analysis_cost_usd === "number" ? (
              <p className="helper">
                Gemini analysis charge: ${created.analysis_cost_usd.toFixed(6)} · protected by the
                private beta spend ceiling.
              </p>
            ) : null}
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
            <div className="preset-action-disclosure">
              Publishing confirms that this profile matches the look you want. Published versions
              remain unchanged so existing projects stay reproducible.
            </div>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(3)}>
              Back
            </Button>
            <Button busy={busy} disabled={!created?.profile} onClick={() => void publishStyle()}>
              <ShieldCheck size={16} /> Publish immutable style version
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
  const query = useQuery({
    queryKey: ["hosted-project", projectId],
    queryFn: () => readJson<ProjectDetailResponse>(`/api/v2/hosted/projects/${projectId}`),
    refetchInterval: 2_000,
    placeholderData: (previousData) => previousData,
    retry: false,
  });
  const asr = [...(query.data?.attempts ?? [])].reverse().find((attempt) => attempt.kind === "ASR");
  const render = [...(query.data?.attempts ?? [])]
    .reverse()
    .find((attempt) => attempt.kind === "RENDER");
  const renderHandoffAttempt = useRef<string | null>(null);
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
  useEffect(() => {
    if (asr?.state !== "SUCCEEDED" || render || renderHandoffAttempt.current === asr.id) {
      return;
    }
    renderHandoffAttempt.current = asr.id;
    renderHandoff.mutate(asr.id);
  }, [asr?.id, asr?.state, render?.id, renderHandoff]);
  const cancel = useMutation({
    mutationFn: (attemptId: string) =>
      readJson(`/api/v2/cpu-attempts/${attemptId}`, { method: "POST", body: "{}" }),
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
  if (query.isError || !query.data)
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
    : fallbackHostedStages(asr, render, query.data.generation);
  const uiStages = hostedProjectStages(stages);
  const timing = query.data.timing;
  const cost = query.data.cost;
  const queue = query.data.queue;
  const activeStageIndex = Math.max(
    0,
    uiStages.findIndex((stage) => stage.status !== "COMPLETE"),
  );
  const activeStage = uiStages[activeStageIndex];
  const overallProgress = Math.round(
    stages.reduce((total, stage) => total + hostedProgressValue(stage), 0) /
      Math.max(1, stages.length),
  );
  const hasFailed = uiStages.some((stage) => stage.status === "FAILED");
  const hasRunning = uiStages.some((stage) =>
    ["STARTING", "RUNNING", "RETRYING", "CANCEL_REQUESTED"].includes(stage.status),
  );
  const allComplete = uiStages.every((stage) => stage.status === "COMPLETE");
  const overallStatus = hasFailed
    ? "Needs attention"
    : allComplete
      ? "Ready for review"
      : hasRunning
        ? "Running"
        : "Waiting";
  const statusToneValue = hasFailed
    ? "danger"
    : allComplete
      ? "success"
      : hasRunning
        ? "info"
        : "warning";
  const latestArtifact =
    render?.preview_url ??
    query.data.review?.contact_sheet?.at(-1)?.image_url ??
    query.data.contact_sheet?.at(-1)?.image_url ??
    null;
  const cancellableAttempts = query.data.attempts.filter((attempt) =>
    ["OUTBOXED", "SUBMITTED", "RUNNING", "RECONCILING", "CANCEL_REQUESTED"].includes(attempt.state),
  );
  return (
    <>
      <PageHeader
        eyebrow="Live project"
        title={query.data.project.title}
        description="Updates automatically from your personal media worker."
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
        <ProgressRing
          value={overallProgress}
          label="Overall video progress"
          detail={overallStatus}
        />
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
              detail={activeStage?.label ?? "Preparing"}
              tone="info"
            />
            <Metric
              label="Status"
              value={overallStatus}
              detail={activeStage?.detail ?? "Waiting for the next worker update"}
              tone={statusToneValue}
            />
            <Metric
              label="Estimated"
              value={formatMilliseconds(
                stages[activeStageIndex]?.eta_ms ?? queue?.estimated_wait_ms,
              )}
              detail="remaining when measurable"
            />
            <Metric
              label="Cost"
              value={
                (cost?.projected_usd ?? 0) > 0
                  ? formatUsd(cost?.projected_usd)
                  : "No provider charge"
              }
              detail={
                cost?.cap_usd == null ? "personal worker" : `${formatUsd(cost.cap_usd)} maximum`
              }
              tone="success"
            />
          </div>
          <ProgressBar value={overallProgress} label="Overall video progress" />
          <p className="helper live-progress-update" aria-live="polite">
            <span className="live-progress-pulse" aria-hidden="true" />
            Live updates every 2 seconds
          </p>
        </div>
      </section>

      <div className="progress-workspace">
        <Panel className="pipeline-panel" eyebrow="Pipeline" heading="Video production stages">
          <StageTimeline stages={uiStages} />
        </Panel>
        <div className="progress-side">
          <Panel className="latest-artifact-panel" eyebrow="Latest" heading="Live preview">
            <div className="latest-artifact-frame">
              {render?.preview_url ? (
                <video
                  className="media-artifact-video"
                  controls
                  preload="metadata"
                  src={render.preview_url}
                />
              ) : latestArtifact ? (
                <img src={latestArtifact} alt="Latest accepted project artifact" />
              ) : (
                <div className="live-preview-waiting">
                  <Images size={30} aria-hidden="true" />
                  <strong>Waiting for the first accepted visual</strong>
                  <span>It will appear here automatically.</span>
                </div>
              )}
            </div>
            <div className="artifact-caption">
              <span>
                {latestArtifact ? "Latest accepted artifact" : "Worker is preparing assets"}
              </span>
              <Badge tone={latestArtifact ? "success" : "neutral"}>
                {latestArtifact ? "Ready" : "Waiting"}
              </Badge>
            </div>
          </Panel>
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
            {cancellableAttempts.map((attempt) => (
              <Button
                key={attempt.id}
                variant="danger"
                busy={cancel.isPending && cancel.variables === attempt.id}
                onClick={() => cancel.mutate(attempt.id)}
              >
                <X size={15} />
                {attempt.state === "CANCEL_REQUESTED"
                  ? "Settle cancellation"
                  : `Cancel ${attemptLabel(attempt.kind).toLowerCase()}`}
              </Button>
            ))}
          </Panel>
        </div>
      </div>
      {!asr ? (
        <div className="notice" role="status">
          <strong>Your project is ready to start transcription.</strong>
          {asrHandoff.isError ? <span> {asrHandoff.error.message}</span> : null}
          <Button variant="primary" busy={asrHandoff.isPending} onClick={() => asrHandoff.mutate()}>
            Start transcription
          </Button>
        </div>
      ) : null}
      {asr?.kind === "ASR" && asr.state === "FAILED" ? (
        <div className="notice notice-danger" role="alert">
          <strong>Transcription stopped before the transcript could be saved.</strong>
          <span>
            Your project and voiceover are safe. Retry after updating and reconnecting your personal
            media worker.
          </span>
          {asrHandoff.isError ? <span>{asrHandoff.error.message}</span> : null}
          <Button variant="primary" busy={asrHandoff.isPending} onClick={() => asrHandoff.mutate()}>
            <RefreshCw size={15} /> Retry transcription
          </Button>
        </div>
      ) : null}
      {asr?.state === "SUCCEEDED" && !render ? (
        <div className="notice" role="status">
          <strong>
            {renderHandoff.isError
              ? "Transcription complete; generation planning could not be verified."
              : renderHandoff.isPending
                ? "Transcription complete; persisting the deterministic generation plan."
                : query.data.generation
                  ? "Planning complete; generation is waiting for GPU qualification."
                  : "Transcription complete; generation planning is starting."}
          </strong>
          {renderHandoff.isError ? <span> {renderHandoff.error.message}</span> : null}
        </div>
      ) : null}
      <Button variant="secondary" onClick={() => void query.refetch()}>
        <RefreshCw size={15} /> Refresh now
      </Button>
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
        <p>Checking exact output receipt…</p>
      </Panel>
    );
  if (query.isError || !candidate?.preview_url)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Output is not ready for review"
        body="A successful checksum-bound render is required. No synthetic preview is shown."
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
      <Panel className="review-player" eyebrow="Private R2 candidate" heading="Final output">
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
      <Panel eyebrow="Chronological review" heading="Contact sheet">
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
          <p className="helper">
            No chronological contact-sheet evidence was returned for this candidate.
          </p>
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
                  <small>Replacement requires an authorized source upload.</small>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="helper">
            No quality flags were returned. This does not substitute for subjective human review.
          </p>
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
          <p className="helper">
            The manifest becomes available as a private download after explicit approval.
          </p>
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
      <Panel eyebrow="Workspace" heading="Loading Usage">
        <p>Reading exact tenant totals…</p>
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
      <div className="grid grid-4 usage-grid">
        <Metric label="Provider charges" value="$0.00" detail="this month" tone="success" />
        <Metric label="Video generation" value="Not enabled" detail="private beta" />
        <Metric
          label="Computer work"
          value={formatMilliseconds(query.data.personal_worker_seconds * 1_000)}
          detail="measured time"
        />
        <Metric
          label="Stored media"
          value={`${(query.data.retained_bytes / 1024 / 1024 / 1024).toFixed(3)} GB`}
          detail="until Delete"
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
            Fixed retained-volume cost: {formatUsd(query.data.fixed_recurring_usd)} separately from
            per-video spend.
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
          <p className="helper">Detailed timing will appear after a completed run.</p>
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
