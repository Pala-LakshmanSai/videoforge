import {
  canonicalizeJson,
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
  type Sha256Digest,
} from "@videoforge/contracts";
import {
  compileCompleteWorkPlan,
  SUPPORTED_SCHEDULER_CONFIG,
  type MaterializedSelectedSpan,
} from "@videoforge/pipeline";
import { z } from "zod";

import { fixtureTimelineDocuments } from "./timeline-inspection";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const taskSlotSchema = z.object({ task_key: z.string().min(1) }).strict();
const avatarSlotSchema = z
  .object({ task_key: z.string().min(1), span_audio_task_key: z.string().min(1) })
  .strict();
const segmentBase = {
  segment_id: z.string().min(1),
  start_frame: z.number().int().nonnegative(),
  end_frame_exclusive: z.number().int().positive(),
  source_audio_start_ms: z.number().int().nonnegative(),
  source_audio_end_ms: z.number().int().positive(),
  phrase: z.string().min(1),
  word_start: z.number().int().nonnegative(),
  word_end_exclusive: z.number().int().positive(),
};
const timelineSegmentSchema = z.discriminatedUnion("timeline_composition", [
  z
    .object({
      ...segmentBase,
      timeline_composition: z.literal("AVATAR_FULL"),
      required_slots: z.object({ avatar: avatarSlotSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      timeline_composition: z.literal("IMAGE_FULL"),
      in_image_shot_role: z.literal("OBJECT_EVIDENCE"),
      required_slots: z.object({ image: taskSlotSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      timeline_composition: z.literal("AVATAR_SPLIT_IMAGE"),
      in_image_shot_role: z.literal("REACTION_RESULT"),
      required_slots: z.object({ avatar: avatarSlotSchema, right_image: taskSlotSchema }).strict(),
    })
    .strict(),
]);
const transcriptFoundationSchema = z
  .object({
    schema_version: z.literal("transcript-timing/v1"),
    project_revision_id: z.string().min(1),
    source: z
      .object({
        asset_id: z.string().min(1),
        sha256: sha256Schema,
        duration_ms: z.number().int().positive(),
      })
      .strict(),
    engine: z
      .object({
        name: z.literal("whisper.cpp"),
        version: z.string().min(1),
        model_name: z.string().min(1),
        model_sha256: sha256Schema,
        language: z.string().min(1),
      })
      .strict(),
    text: z.string().min(1),
    words: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            text: z.string().min(1),
            start_ms: z.number().int().nonnegative(),
            end_ms: z.number().int().positive(),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1),
    phrases: z
      .array(
        z
          .object({
            phrase_id: z.string().min(1),
            sentence_id: z.string().min(1),
            word_start: z.number().int().nonnegative(),
            word_end_exclusive: z.number().int().positive(),
            start_ms: z.number().int().nonnegative(),
            end_ms: z.number().int().positive(),
            pause_before_ms: z.number().int().nonnegative(),
            pause_after_ms: z.number().int().nonnegative(),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const timelineFoundationSchema = z
  .object({
    schema_version: z.literal("timeline-plan/v1"),
    project_revision_id: z.string().min(1),
    revision_config_hash: sha256Schema,
    scheduler_version: z.literal("scheduler-v2"),
    seed: z.number().int(),
    output_fps_num: z.literal(30),
    output_fps_den: z.literal(1),
    total_frames: z.number().int().positive(),
    segments: z.array(timelineSegmentSchema).min(1),
  })
  .strict();

export interface ProviderFreeArtifactBlob {
  readonly artifactId: string;
  readonly kind:
    | "TRANSCRIPT"
    | "TIMELINE"
    | "GENERATION_WORK"
    | "RENDER_WORK"
    | "PROMPT_MANIFEST"
    | "SELECTED_SPAN_AUDIO"
    | "IMAGE"
    | "AVATAR_FRAME"
    | "MAGE_MANIFEST"
    | "ECHO_MANIFEST"
    | "RESOLVED_RENDER_MANIFEST";
  readonly extension: "json" | "wav" | "ppm";
  readonly contentType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface ProviderFreeFoundationReceipts {
  readonly transcriptSha256: string;
  readonly timelineSha256: string;
  readonly generationWorkManifestSha256: string;
  readonly renderWorkManifestSha256: string;
  readonly promptManifestSha256: string;
}

export interface ProviderFreeRenderSegment {
  readonly segmentId: string;
  readonly composition: "AVATAR_FULL" | "IMAGE_FULL" | "AVATAR_SPLIT_IMAGE";
  readonly durationMs: number;
  readonly imageSha256: string | null;
  readonly avatarSha256: string | null;
}

export interface ProviderFreeProjectBundle {
  readonly projectId: string;
  readonly revisionId: string;
  readonly receipts: ProviderFreeFoundationReceipts;
  readonly foundationArtifacts: readonly ProviderFreeArtifactBlob[];
  readonly mage: {
    readonly manifest: ProviderFreeArtifactBlob;
    readonly artifacts: readonly ProviderFreeArtifactBlob[];
  };
  readonly echo: {
    readonly manifest: ProviderFreeArtifactBlob;
    readonly artifacts: readonly ProviderFreeArtifactBlob[];
  };
  readonly renderManifest: ProviderFreeArtifactBlob;
  readonly renderSegments: readonly ProviderFreeRenderSegment[];
  readonly totalFrames: number;
}

const encoder = new TextEncoder();

async function sha256Bytes(bytes: Uint8Array): Promise<Sha256Digest> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Sha256Digest;
}

async function jsonArtifact(
  artifactId: string,
  kind: ProviderFreeArtifactBlob["kind"],
  value: JsonValue,
): Promise<ProviderFreeArtifactBlob> {
  const bytes = encoder.encode(canonicalizeJson(value));
  return Object.freeze({
    artifactId,
    kind,
    extension: "json" as const,
    contentType: "application/json",
    sha256: await sha256Bytes(bytes),
    bytes,
  });
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function pcmWav(durationMs: number, frequency: number): Uint8Array {
  const sampleRate = 16_000;
  const samples = Math.round((durationMs * sampleRate) / 1_000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("RIFF"), 0);
  writeUint32(view, 4, bytes.length - 8);
  bytes.set(encoder.encode("WAVEfmt "), 8);
  writeUint32(view, 16, 16);
  writeUint16(view, 20, 1);
  writeUint16(view, 22, 1);
  writeUint32(view, 24, sampleRate);
  writeUint32(view, 28, sampleRate * 2);
  writeUint16(view, 32, 2);
  writeUint16(view, 34, 16);
  bytes.set(encoder.encode("data"), 36);
  writeUint32(view, 40, samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 320, (samples - index) / 320);
    view.setInt16(
      44 + index * 2,
      Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 3_000 * envelope),
      true,
    );
  }
  return bytes;
}

async function wavArtifact(
  artifactId: string,
  durationMs: number,
  frequency: number,
): Promise<ProviderFreeArtifactBlob> {
  const bytes = pcmWav(durationMs, frequency);
  return Object.freeze({
    artifactId,
    kind: "SELECTED_SPAN_AUDIO" as const,
    extension: "wav" as const,
    contentType: "audio/wav",
    sha256: await sha256Bytes(bytes),
    bytes,
  });
}

function ppm(seed: number): Uint8Array {
  const width = 320;
  const height = 180;
  const header = encoder.encode(`P6\n${String(width)} ${String(height)}\n255\n`);
  const bytes = new Uint8Array(header.length + width * height * 3);
  bytes.set(header);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = header.length + (y * width + x) * 3;
      bytes[offset] = (seed + x + Math.floor(y / 2)) % 256;
      bytes[offset + 1] = (seed * 3 + y + Math.floor(x / 3)) % 256;
      bytes[offset + 2] = (seed * 7 + x + y) % 256;
    }
  }
  return bytes;
}

async function ppmArtifact(
  artifactId: string,
  kind: "IMAGE" | "AVATAR_FRAME",
  seed: number,
): Promise<ProviderFreeArtifactBlob> {
  const bytes = ppm(seed);
  return Object.freeze({
    artifactId,
    kind,
    extension: "ppm" as const,
    contentType: "image/x-portable-pixmap",
    sha256: await sha256Bytes(bytes),
    bytes,
  });
}

function safeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._:-]/gu, "-");
}

export async function buildProviderFreeProjectBundle(
  projectId: string,
): Promise<ProviderFreeProjectBundle> {
  const safeProjectId = safeId(projectId);
  const revisionId = `revision_cp05_${safeProjectId}`;
  const revisionConfigHash = await sha256CanonicalJson({
    schema_version: "videoforge.cp05-revision-authority/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    scheduler_version: "scheduler-v2",
    scheduler_seed: 982_341,
    provider_calls_authorized: false,
  });
  const documents = fixtureTimelineDocuments({
    id: projectId,
    revisionId,
    revisionConfigHash,
  });
  const transcriptValue = transcriptFoundationSchema.parse(documents.transcript);
  const timelineValue = timelineFoundationSchema.parse(documents.timeline);
  if (
    transcriptValue.project_revision_id !== revisionId ||
    timelineValue.project_revision_id !== revisionId
  )
    throw new Error("Provider-free foundations do not bind requested project revision.");
  const [transcript, timeline, schedulerConfigHash] = await Promise.all([
    validateAndHashContractDocument("transcriptTiming", transcriptValue),
    validateAndHashContractDocument("timelinePlan", timelineValue),
    sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG),
  ]);

  const avatarSegments = timeline.value.segments.filter(
    (segment) => segment.timeline_composition !== "IMAGE_FULL",
  );
  const spanArtifacts = await Promise.all(
    avatarSegments.map((segment, index) => {
      const paddedStart = Math.max(0, segment.source_audio_start_ms - 500);
      const paddedEnd = Math.min(
        transcript.value.source.duration_ms,
        segment.source_audio_end_ms + 500,
      );
      return wavArtifact(
        `fixture-span-${safeProjectId}-${String(index + 1)}`,
        paddedEnd - paddedStart,
        220 + index * 55,
      );
    }),
  );
  const selectedSpanAudio: MaterializedSelectedSpan[] = avatarSegments.map((segment, index) => {
    const artifact = spanArtifacts[index]!;
    const paddedStart = Math.max(0, segment.source_audio_start_ms - 500);
    const paddedEnd = Math.min(
      transcript.value.source.duration_ms,
      segment.source_audio_end_ms + 500,
    );
    return {
      spanId: `fixture-span-${safeProjectId}-${String(index + 1)}`,
      timelineSegmentId: segment.segment_id,
      taskKey: segment.required_slots.avatar.span_audio_task_key,
      artifactId: artifact.artifactId,
      sha256: artifact.sha256 as Sha256Digest,
      selectedStartMs: segment.source_audio_start_ms,
      selectedEndMsExclusive: segment.source_audio_end_ms,
      paddedStartMs: paddedStart,
      paddedEndMsExclusive: paddedEnd,
      trimStartMs: segment.source_audio_start_ms - paddedStart,
      trimEndMsExclusive:
        segment.source_audio_start_ms -
        paddedStart +
        segment.source_audio_end_ms -
        segment.source_audio_start_ms,
    };
  });
  const workPlan = await compileCompleteWorkPlan({
    revision: {
      sha256: revisionConfigHash,
      value: {
        project_revision_id: revisionId,
        scheduler_version: "scheduler-v2",
        scheduler_seed: 982_341,
        voiceover_asset_id: transcript.value.source.asset_id,
        voiceover_sha256: transcript.value.source.sha256,
      },
    } as Parameters<typeof compileCompleteWorkPlan>[0]["revision"],
    transcript,
    timeline,
    schedulerConfigHash,
    selectedSpanAudio,
  });
  if (!workPlan.ok) throw new Error(`CP-04 work-plan compile failed: ${workPlan.error.message}`);

  const promptManifest = {
    schema_version: "videoforge.provider-free-prompt-fixture/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    transcript_sha256: transcript.sha256,
    timeline_sha256: timeline.sha256,
    generation_work_manifest_sha256: workPlan.value.generationWorkManifest.sha256,
    writer: "runware-deepseek-v4-flash-0731-fixture",
    provider_calls_authorized: false,
    prompts: timeline.value.segments.flatMap((segment) => {
      if (segment.timeline_composition === "AVATAR_FULL") return [];
      const slot =
        segment.timeline_composition === "IMAGE_FULL"
          ? segment.required_slots.image
          : segment.required_slots.right_image;
      return [
        {
          task_key: slot.task_key,
          shot_role: segment.in_image_shot_role,
          phrase: segment.phrase,
          hard_rules: ["no text", "no logo", "no border", "slow centered image zoom"],
        },
      ];
    }),
  } as unknown as JsonValue;

  const foundationArtifacts = await Promise.all([
    jsonArtifact(`fixture-transcript-${safeProjectId}`, "TRANSCRIPT", transcript.value),
    jsonArtifact(`fixture-timeline-${safeProjectId}`, "TIMELINE", timeline.value),
    jsonArtifact(
      `fixture-generation-work-${safeProjectId}`,
      "GENERATION_WORK",
      workPlan.value.generationWorkManifest.value,
    ),
    jsonArtifact(
      `fixture-render-work-${safeProjectId}`,
      "RENDER_WORK",
      workPlan.value.renderWorkManifest.value,
    ),
    jsonArtifact(`fixture-prompt-manifest-${safeProjectId}`, "PROMPT_MANIFEST", promptManifest),
  ]);
  const [
    transcriptArtifact,
    timelineArtifact,
    generationWorkArtifact,
    renderWorkArtifact,
    promptArtifact,
  ] = foundationArtifacts;
  if (
    transcriptArtifact!.sha256 !== transcript.sha256 ||
    timelineArtifact!.sha256 !== timeline.sha256 ||
    generationWorkArtifact!.sha256 !== workPlan.value.generationWorkManifest.sha256 ||
    renderWorkArtifact!.sha256 !== workPlan.value.renderWorkManifest.sha256
  )
    throw new Error("Foundation artifact bytes do not match canonical contract hashes.");

  const imageSegments = timeline.value.segments.filter(
    (segment) => segment.timeline_composition !== "AVATAR_FULL",
  );
  const projectSeed = [...projectId].reduce(
    (total, character) => (total + (character.codePointAt(0) ?? 0)) % 256,
    0,
  );
  const imageArtifacts = await Promise.all(
    imageSegments.map((segment, index) =>
      ppmArtifact(
        `fixture-image-${safeProjectId}-${String(index + 1)}`,
        "IMAGE",
        projectSeed + 37 + index * 29,
      ),
    ),
  );
  const avatarArtifacts = await Promise.all(
    avatarSegments.map((segment, index) =>
      ppmArtifact(
        `fixture-avatar-${safeProjectId}-${String(index + 1)}`,
        "AVATAR_FRAME",
        projectSeed + 149 + index * 31,
      ),
    ),
  );
  const mageManifestValue = {
    schema_version: "videoforge.synthetic-mage-output/v1",
    project_id: projectId,
    prompt_manifest_sha256: promptArtifact!.sha256,
    assets: imageSegments.map((segment, index) => ({
      task_key:
        segment.timeline_composition === "IMAGE_FULL"
          ? segment.required_slots.image.task_key
          : segment.required_slots.right_image.task_key,
      artifact_id: imageArtifacts[index]!.artifactId,
      sha256: imageArtifacts[index]!.sha256,
      content_type: imageArtifacts[index]!.contentType,
    })),
    provider_calls_authorized: false,
  } as unknown as JsonValue;
  const echoManifestValue = {
    schema_version: "videoforge.synthetic-echo-output/v1",
    project_id: projectId,
    generation_work_manifest_sha256: generationWorkArtifact!.sha256,
    assets: avatarSegments.map((segment, index) => ({
      task_key: segment.required_slots.avatar.task_key,
      artifact_id: avatarArtifacts[index]!.artifactId,
      sha256: avatarArtifacts[index]!.sha256,
      selected_span_audio_sha256: spanArtifacts[index]!.sha256,
      content_type: avatarArtifacts[index]!.contentType,
    })),
    full_voiceover_dispatched: false,
    provider_calls_authorized: false,
  } as unknown as JsonValue;
  const [mageManifest, echoManifest] = await Promise.all([
    jsonArtifact(`fixture-mage-manifest-${safeProjectId}`, "MAGE_MANIFEST", mageManifestValue),
    jsonArtifact(`fixture-echo-manifest-${safeProjectId}`, "ECHO_MANIFEST", echoManifestValue),
  ]);
  const imageBySegment = new Map(
    imageSegments.map((segment, index) => [segment.segment_id, imageArtifacts[index]!] as const),
  );
  const avatarBySegment = new Map(
    avatarSegments.map((segment, index) => [segment.segment_id, avatarArtifacts[index]!] as const),
  );
  const renderSegments: ProviderFreeRenderSegment[] = timeline.value.segments.map((segment) => ({
    segmentId: segment.segment_id,
    composition: segment.timeline_composition,
    durationMs: segment.source_audio_end_ms - segment.source_audio_start_ms,
    imageSha256: imageBySegment.get(segment.segment_id)?.sha256 ?? null,
    avatarSha256: avatarBySegment.get(segment.segment_id)?.sha256 ?? null,
  }));
  const renderManifestValue = {
    schema_version: "videoforge.provider-free-resolved-render-manifest/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    timeline_sha256: timelineArtifact!.sha256,
    render_work_manifest_sha256: renderWorkArtifact!.sha256,
    mage_output_sha256: mageManifest.sha256,
    echo_output_sha256: echoManifest.sha256,
    output: {
      width: 1920,
      height: 1080,
      fps_num: 30,
      fps_den: 1,
      total_frames: timeline.value.total_frames,
      video_codec: "h264",
      audio_codec: "aac",
    },
    transition_policy: "HARD_CUTS_ONLY",
    segments: renderSegments.map((segment) => ({
      segment_id: segment.segmentId,
      composition: segment.composition,
      duration_ms: segment.durationMs,
      image_sha256: segment.imageSha256,
      avatar_sha256: segment.avatarSha256,
      image_motion: segment.imageSha256 === null ? "NONE" : "SLOW_SMOOTH_CENTERED_ZOOM",
    })),
  } as unknown as JsonValue;
  const renderManifest = await jsonArtifact(
    `fixture-resolved-render-${safeProjectId}`,
    "RESOLVED_RENDER_MANIFEST",
    renderManifestValue,
  );

  return Object.freeze({
    projectId,
    revisionId,
    receipts: Object.freeze({
      transcriptSha256: transcriptArtifact!.sha256,
      timelineSha256: timelineArtifact!.sha256,
      generationWorkManifestSha256: generationWorkArtifact!.sha256,
      renderWorkManifestSha256: renderWorkArtifact!.sha256,
      promptManifestSha256: promptArtifact!.sha256,
    }),
    foundationArtifacts: Object.freeze([...foundationArtifacts, ...spanArtifacts]),
    mage: Object.freeze({
      manifest: mageManifest,
      artifacts: Object.freeze([...imageArtifacts, mageManifest]),
    }),
    echo: Object.freeze({
      manifest: echoManifest,
      artifacts: Object.freeze([...avatarArtifacts, echoManifest]),
    }),
    renderManifest,
    renderSegments: Object.freeze(renderSegments),
    totalFrames: timeline.value.total_frames,
  });
}

export async function buildProviderFreeFoundationReceipts(
  projectId: string,
): Promise<ProviderFreeFoundationReceipts> {
  return (await buildProviderFreeProjectBundle(projectId)).receipts;
}
