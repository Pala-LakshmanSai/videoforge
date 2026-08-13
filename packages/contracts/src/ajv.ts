import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchemaObject, ErrorObject, ValidateFunction } from "ajv";

import {
  canonicalSchemaDocuments,
  contractNames,
  contractSchemaIds,
  type ContractDocument,
  type ContractName,
} from "./schemas.js";

export interface ContractValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Readonly<Record<string, unknown>>;
}

export interface ContractValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ContractValidationFailure {
  success: false;
  issues: readonly ContractValidationIssue[];
}

export type ContractValidationResult<T> = ContractValidationSuccess<T> | ContractValidationFailure;

export class ContractValidationError extends Error {
  readonly contractName: ContractName;
  readonly issues: readonly ContractValidationIssue[];

  constructor(contractName: ContractName, issues: readonly ContractValidationIssue[]) {
    super(
      `Invalid ${contractName} contract (${issues.length} issue${issues.length === 1 ? "" : "s"}).`,
    );
    this.name = "ContractValidationError";
    this.contractName = contractName;
    this.issues = issues;
  }
}

export function createContractAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const contractName of contractNames) {
    ajv.addSchema(canonicalSchemaDocuments[contractName] as unknown as AnySchemaObject);
  }
  return ajv;
}

const ajv = createContractAjv();

export const contractValidators = Object.freeze(
  Object.fromEntries(
    contractNames.map((contractName) => {
      const validator = ajv.getSchema(contractSchemaIds[contractName]);
      if (!validator) throw new Error(`Ajv did not register ${contractSchemaIds[contractName]}.`);
      return [contractName, validator];
    }),
  ) as Record<ContractName, ValidateFunction>,
);

const normalizeIssues = (
  errors: ErrorObject[] | null | undefined,
): readonly ContractValidationIssue[] =>
  (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed.",
    params: error.params as Readonly<Record<string, unknown>>,
  }));

const semanticIssue = (instancePath: string, message: string): ContractValidationIssue => ({
  instancePath,
  schemaPath: "#/$semantic",
  keyword: "semantic",
  message,
  params: {},
});

const transcriptTimingIssues = (
  transcript: ContractDocument<"transcriptTiming">,
  prefix = "",
): readonly ContractValidationIssue[] => {
  const issues: ContractValidationIssue[] = [];
  let previousWordEnd = 0;
  for (const [index, word] of transcript.words.entries()) {
    const wordPath = `${prefix}/words/${index}`;
    if (word.index !== index) {
      issues.push(
        semanticIssue(`${wordPath}/index`, "Word indices must be contiguous and zero-based."),
      );
    }
    if (word.start_ms >= word.end_ms) {
      issues.push(semanticIssue(wordPath, "Word start_ms must be before end_ms."));
    }
    if (index > 0 && word.start_ms < previousWordEnd) {
      issues.push(
        semanticIssue(`${wordPath}/start_ms`, "Words must not overlap or move backward."),
      );
    }
    if (word.end_ms > transcript.source.duration_ms) {
      issues.push(semanticIssue(`${wordPath}/end_ms`, "Words must stay within source duration."));
    }
    previousWordEnd = word.end_ms;
  }

  let expectedWordStart = 0;
  for (const [index, phrase] of transcript.phrases.entries()) {
    const phrasePath = `${prefix}/phrases/${index}`;
    if (phrase.word_start !== expectedWordStart) {
      issues.push(
        semanticIssue(`${phrasePath}/word_start`, "Phrases must cover words contiguously."),
      );
    }
    if (
      phrase.word_end_exclusive <= phrase.word_start ||
      phrase.word_end_exclusive > transcript.words.length
    ) {
      issues.push(
        semanticIssue(phrasePath, "Phrase word bounds must identify a non-empty word span."),
      );
    } else {
      const firstWord = transcript.words[phrase.word_start]!;
      const lastWord = transcript.words[phrase.word_end_exclusive - 1]!;
      if (phrase.start_ms !== firstWord.start_ms || phrase.end_ms !== lastWord.end_ms) {
        issues.push(semanticIssue(phrasePath, "Phrase timing must bind exactly to its word span."));
      }
    }
    if (phrase.start_ms >= phrase.end_ms) {
      issues.push(semanticIssue(phrasePath, "Phrase start_ms must be before end_ms."));
    }
    expectedWordStart = phrase.word_end_exclusive;
  }
  if (expectedWordStart !== transcript.words.length) {
    issues.push(
      semanticIssue(`${prefix}/phrases`, "Phrases must cover every transcript word once."),
    );
  }
  return issues;
};

const semanticContractIssues = <Name extends ContractName>(
  contractName: Name,
  value: ContractDocument<Name>,
): readonly ContractValidationIssue[] => {
  if (contractName === "admittedIdentity") {
    const identity = value as ContractDocument<"admittedIdentity">;
    return identity.normalized_email === identity.normalized_email.trim().toLowerCase()
      ? []
      : [semanticIssue("/normalized_email", "Admitted email must be normalized lowercase text.")];
  }
  if (contractName === "globalGenerationSession") {
    const snapshot = value as ContractDocument<"globalGenerationSession">;
    const issues: ContractValidationIssue[] = [];
    const session = snapshot.session;
    const selections = session.gpu_pair;
    for (const lane of ["mage_image", "echo_avatar"] as const) {
      const selection = selections[lane];
      const receipt = selection.receipt;
      const path = `/session/gpu_pair/${lane}`;
      if (selection.lane !== lane) {
        issues.push(semanticIssue(`${path}/lane`, "GPU selection lane must match its pair slot."));
      }
      if (Date.parse(receipt.observed_at) >= Date.parse(receipt.expires_at)) {
        issues.push(
          semanticIssue(
            `${path}/receipt/expires_at`,
            "Inventory receipt must expire after observation.",
          ),
        );
      }
      const revalidatedAt = Date.parse(selection.revalidated_at);
      if (
        revalidatedAt < Date.parse(receipt.observed_at) ||
        revalidatedAt > Date.parse(receipt.expires_at)
      ) {
        issues.push(
          semanticIssue(
            `${path}/revalidated_at`,
            "GPU revalidation must fall inside the live inventory receipt window.",
          ),
        );
      }
      if (receipt.observed_rate_micro_usd_per_hour > selection.rate_ceiling_micro_usd_per_hour) {
        issues.push(
          semanticIssue(
            `${path}/rate_ceiling_micro_usd_per_hour`,
            "Observed GPU rate must not exceed the locked ceiling.",
          ),
        );
      }
    }

    const liveEntries = [
      ...snapshot.queue.entries.filter(({ state }) => state === "ACTIVE" || state === "WAITING"),
    ].sort((left, right) => left.position - right.position);
    const activeEntries = liveEntries.filter(({ state }) => state === "ACTIVE");
    if (activeEntries.length > 1) {
      issues.push(
        semanticIssue("/queue/entries", "Global queue may contain at most one active entry."),
      );
    }
    for (const [index, entry] of liveEntries.entries()) {
      if (entry.position !== index) {
        issues.push(
          semanticIssue(
            `/queue/entries/${index}/position`,
            "Live queue positions must be contiguous.",
          ),
        );
      }
      if (entry.inherited_gpu_pair_hash !== session.gpu_pair_hash) {
        issues.push(
          semanticIssue(
            `/queue/entries/${index}/inherited_gpu_pair_hash`,
            "Every queue entry must inherit the immutable session GPU pair.",
          ),
        );
      }
      if (
        entry.state === "WAITING" &&
        (entry.compute_run_plan_id !== null || entry.executable_fact_count !== 0)
      ) {
        issues.push(
          semanticIssue(
            `/queue/entries/${index}`,
            "Waiting queue entries must remain orchestration-inert.",
          ),
        );
      }
    }
    if (activeEntries.length === 1 && activeEntries[0]?.position !== 0) {
      issues.push(semanticIssue("/queue/entries", "Active queue entry must occupy position zero."));
    }
    if (
      new Set(snapshot.queue.entries.map(({ project_revision_id }) => project_revision_id)).size !==
      snapshot.queue.entries.length
    ) {
      issues.push(
        semanticIssue("/queue/entries", "A project revision may appear in the queue only once."),
      );
    }

    const mageVolume = snapshot.lane_volumes.mage_image;
    const echoVolume = snapshot.lane_volumes.echo_avatar;
    if (
      mageVolume.model_volume_id === echoVolume.model_volume_id ||
      mageVolume.provider_volume_id === echoVolume.provider_volume_id ||
      mageVolume.manifest_id === echoVolume.manifest_id
    ) {
      issues.push(
        semanticIssue("/lane_volumes", "Mage and Echo volumes and manifests must remain isolated."),
      );
    }

    for (const lane of ["mage_image", "echo_avatar"] as const) {
      const laneState = snapshot.lane_states[lane];
      const selection = selections[lane];
      const volume = snapshot.lane_volumes[lane];
      const path = `/lane_states/${lane}`;
      if (laneState.lane !== lane) {
        issues.push(semanticIssue(`${path}/lane`, "Lane state must match its lane slot."));
      }
      if (
        laneState.active_queue_entry_id !== null &&
        !activeEntries.some(
          ({ queue_entry_id }) => queue_entry_id === laneState.active_queue_entry_id,
        )
      ) {
        issues.push(
          semanticIssue(
            `${path}/active_queue_entry_id`,
            "Lane demand may reference only the active global queue entry.",
          ),
        );
      }
      if (laneState.demand === "ACTIVE" && laneState.active_queue_entry_id === null) {
        issues.push(
          semanticIssue(
            `${path}/active_queue_entry_id`,
            "Active lane demand requires an active entry.",
          ),
        );
      }
      if (
        laneState.demand === "WAITING_WARM" &&
        liveEntries.every(({ state }) => state !== "WAITING")
      ) {
        issues.push(
          semanticIssue(
            `${path}/demand`,
            "Warm retention requires at least one waiting queue entry.",
          ),
        );
      }
      for (const [index, attempt] of laneState.pod_attempts.entries()) {
        const attemptPath = `${path}/pod_attempts/${index}`;
        if (
          attempt.model_volume_id !== volume.model_volume_id ||
          attempt.manifest_sha256 !== volume.manifest_sha256
        ) {
          issues.push(
            semanticIssue(
              `${attemptPath}/model_volume_id`,
              "Pod attempt must bind the exact isolated lane volume manifest.",
            ),
          );
        }
        if (
          attempt.actual_gpu_sku !== null &&
          attempt.actual_gpu_sku !== attempt.selected_gpu_sku
        ) {
          issues.push(
            semanticIssue(
              `${attemptPath}/actual_gpu_sku`,
              "Actual Pod GPU must equal the session-selected GPU.",
            ),
          );
        }
        if (attempt.selected_gpu_sku !== selection.receipt.gpu_sku) {
          issues.push(
            semanticIssue(
              `${attemptPath}/selected_gpu_sku`,
              "Pod attempt must use the immutable session GPU selection.",
            ),
          );
        }
        if (
          attempt.model_ready &&
          (attempt.create_status !== "ACKNOWLEDGED" ||
            attempt.provider_pod_id === null ||
            !attempt.container_ready ||
            !attempt.volume_verified ||
            !attempt.warmup_passed ||
            attempt.actual_gpu_sku !== selection.receipt.gpu_sku)
        ) {
          issues.push(
            semanticIssue(
              `${attemptPath}/model_ready`,
              "Model ready requires acknowledged identity, exact GPU/volume, container, and warm-up.",
            ),
          );
        }
        if (
          ["ACK_UNKNOWN", "AMBIGUOUS"].includes(attempt.create_status) &&
          (attempt.model_ready || attempt.delete_status === "ABSENCE_VERIFIED")
        ) {
          issues.push(
            semanticIssue(
              `${attemptPath}/create_status`,
              "Ambiguous create cannot imply model readiness or authoritative absence.",
            ),
          );
        }
        if ((attempt.delete_status === "ABSENCE_VERIFIED") !== (attempt.absence_receipt !== null)) {
          issues.push(
            semanticIssue(
              `${attemptPath}/absence_receipt`,
              "Only an authoritative absence receipt proves Pod deletion.",
            ),
          );
        }
      }
      if (laneState.demand === "WAITING_WARM") {
        const latest = laneState.pod_attempts.at(-1);
        if (!latest?.model_ready || latest.delete_status !== "NOT_REQUESTED") {
          issues.push(
            semanticIssue(
              `${path}/demand`,
              "Waiting demand may retain only an already model-ready Pod.",
            ),
          );
        }
      }
    }

    if (session.state === "ACTIVE" && (session.closing_at !== null || session.closed_at !== null)) {
      issues.push(
        semanticIssue("/session/state", "Active session cannot carry closing timestamps."),
      );
    }
    if (session.state === "DRAINING" && session.closing_at === null) {
      issues.push(semanticIssue("/session/closing_at", "Draining session requires closing time."));
    }
    if (session.state === "CLOSED") {
      if (session.closing_at === null || session.closed_at === null || liveEntries.length !== 0) {
        issues.push(
          semanticIssue(
            "/session/state",
            "Closed session requires timestamps and an empty active/waiting queue.",
          ),
        );
      }
      for (const lane of ["mage_image", "echo_avatar"] as const) {
        const laneState = snapshot.lane_states[lane];
        const latest = laneState.pod_attempts.at(-1);
        if (laneState.demand !== "ZERO" || latest?.delete_status !== "ABSENCE_VERIFIED") {
          issues.push(
            semanticIssue(
              `/lane_states/${lane}`,
              "Closed session requires zero demand and proven Pod absence in both lanes.",
            ),
          );
        }
      }
    }

    for (const [index, event] of snapshot.events.entries()) {
      if (event.sequence !== index + 1) {
        issues.push(
          semanticIssue(`/events/${index}/sequence`, "Event sequence must be contiguous."),
        );
      }
    }
    const amounts = { RESERVED: 0, REPORTED: 0, SETTLED: 0 };
    for (const event of snapshot.cost_summary.events)
      amounts[event.stage] += event.amount_micro_usd;
    if (
      amounts.RESERVED !== snapshot.cost_summary.reserved_micro_usd ||
      amounts.REPORTED !== snapshot.cost_summary.reported_micro_usd ||
      amounts.SETTLED !== snapshot.cost_summary.settled_micro_usd
    ) {
      issues.push(
        semanticIssue("/cost_summary", "Cost summary must equal its append-only events."),
      );
    }
    if (
      Math.max(
        snapshot.cost_summary.reserved_micro_usd,
        snapshot.cost_summary.reported_micro_usd,
        snapshot.cost_summary.settled_micro_usd,
      ) > snapshot.cost_summary.hard_ceiling_micro_usd
    ) {
      issues.push(semanticIssue("/cost_summary", "Cost totals must not exceed the hard ceiling."));
    }
    return issues;
  }
  if (contractName === "podWorkerJobEnvelope") {
    const envelope = value as ContractDocument<"podWorkerJobEnvelope">;
    const binding = envelope.pod_resource_binding;
    const input = envelope.input_manifest;
    const issues: ContractValidationIssue[] = [];
    if (envelope.lane !== binding.lane) {
      issues.push(
        semanticIssue("/pod_resource_binding/lane", "Pod binding lane must match envelope lane."),
      );
    }
    const expected =
      envelope.lane === "mage_image"
        ? {
            worker: "videoforge-mage-pod/v1",
            model: "Comfy-Org/Mage-Flow",
            revision: "d8c99241f6fa80fbd453014234af2bf337ea21e6",
            precision: "int8-convrot",
            mount: "/models/mage",
          }
        : {
            worker: "videoforge-echo-pod/v1",
            model: "EchoMimicV3-Flash",
            precision: "fp8",
            mount: "/models/echo",
          };
    if (
      binding.worker_contract !== expected.worker ||
      binding.model_id !== expected.model ||
      ("revision" in expected && binding.model_revision !== expected.revision) ||
      binding.precision !== expected.precision ||
      binding.mount_path !== expected.mount
    ) {
      issues.push(
        semanticIssue(
          "/pod_resource_binding",
          "Pod binding must match the exact isolated vNext lane profile.",
        ),
      );
    }
    const expectedArtifactId = [
      "dispatch-input",
      envelope.generation_session_id,
      envelope.queue_entry_id,
      envelope.compute_run_plan_id,
      envelope.lane,
      binding.pod_attempt_id,
    ].join(":");
    if (
      input.artifact_id !== expectedArtifactId ||
      input.generation_session_id !== envelope.generation_session_id ||
      input.queue_entry_id !== envelope.queue_entry_id ||
      input.compute_run_plan_id !== envelope.compute_run_plan_id ||
      input.lane !== envelope.lane ||
      input.pod_attempt_id !== binding.pod_attempt_id
    ) {
      issues.push(
        semanticIssue(
          "/input_manifest",
          "Dispatch input must bind to the exact session, queue entry, run plan, lane, and Pod attempt.",
        ),
      );
    }
    const expectedOutputPrefix =
      `sessions/${envelope.generation_session_id}/queue/${envelope.queue_entry_id}` +
      `/runs/${envelope.compute_run_plan_id}/${envelope.lane}/pods/${binding.pod_attempt_id}/`;
    if (envelope.output_prefix !== expectedOutputPrefix) {
      issues.push(
        semanticIssue(
          "/output_prefix",
          "Dispatch output prefix must bind to the exact session, queue entry, run plan, lane, and Pod attempt.",
        ),
      );
    }
    return issues;
  }
  if (contractName === "transcriptTiming") {
    return transcriptTimingIssues(value as ContractDocument<"transcriptTiming">);
  }
  if (contractName === "asrJobResult") {
    const result = value as ContractDocument<"asrJobResult">;
    if (result.status !== "SUCCEEDED") return [];
    return [
      ...transcriptTimingIssues(result.transcript, "/transcript"),
      ...(result.source_voiceover_sha256 === result.transcript.source.sha256
        ? []
        : [
            semanticIssue(
              "/source_voiceover_sha256",
              "Result source hash must match the transcript source hash.",
            ),
          ]),
      ...(result.model_sha256 === result.transcript.engine.model_sha256
        ? []
        : [
            semanticIssue(
              "/model_sha256",
              "Result model hash must match the transcript model hash.",
            ),
          ]),
      ...(result.diagnostics.source_duration_ms === result.transcript.source.duration_ms
        ? []
        : [
            semanticIssue(
              "/diagnostics/source_duration_ms",
              "Diagnostic duration must match the transcript source duration.",
            ),
          ]),
    ];
  }
  if (contractName === "renderJobResult") {
    const result = value as ContractDocument<"renderJobResult">;
    if (result.status !== "SUCCEEDED") return [];
    const issues: ContractValidationIssue[] = [];
    for (const field of ["asset_id", "sha256", "bytes"] as const) {
      if (result.output[field] !== result.probe[field]) {
        issues.push(
          semanticIssue(
            `/output/${field}`,
            `Render output ${field} must match its technical probe.`,
          ),
        );
      }
    }
    return issues;
  }
  if (contractName === "resolvedRenderManifest") {
    const manifest = value as ContractDocument<"resolvedRenderManifest">;
    const expectedSuffix = manifest.render_profile_version.slice(
      manifest.render_profile_version.lastIndexOf("-") + 1,
    );
    const issues: ContractValidationIssue[] = [];
    for (const [index, segment] of manifest.segments.entries()) {
      if (
        segment.timeline_composition === "IMAGE_FULL" &&
        segment.render.zoom_profile !== `image-full-zoom-${expectedSuffix}`
      ) {
        issues.push(
          semanticIssue(
            `/segments/${index}/render/zoom_profile`,
            "Full-image zoom profile must match the render profile version.",
          ),
        );
      }
      if (
        segment.timeline_composition === "AVATAR_SPLIT_IMAGE" &&
        segment.render.right_image_zoom_profile !== `split-right-zoom-${expectedSuffix}`
      ) {
        issues.push(
          semanticIssue(
            `/segments/${index}/render/right_image_zoom_profile`,
            "Split-image zoom profile must match the render profile version.",
          ),
        );
      }
    }
    return issues;
  }
  if (contractName === "generationWorkManifest") {
    const manifest = value as ContractDocument<"generationWorkManifest">;
    const issues: ContractValidationIssue[] = [];
    const batchIds = new Set<string>();
    const batchedTaskKeys = new Set<string>();
    for (const [index, batch] of manifest.prompt_batches.entries()) {
      if (batch.ordinal !== index || batchIds.has(batch.batch_id)) {
        issues.push(
          semanticIssue(
            `/prompt_batches/${index}`,
            "Prompt batches must have unique IDs and contiguous zero-based ordinals.",
          ),
        );
      }
      batchIds.add(batch.batch_id);
      for (const taskKey of batch.scene_task_keys) {
        if (batchedTaskKeys.has(taskKey)) {
          issues.push(
            semanticIssue(
              `/prompt_batches/${index}/scene_task_keys`,
              "Each image task must appear in exactly one prompt batch.",
            ),
          );
        }
        batchedTaskKeys.add(taskKey);
      }
    }
    const imageTaskKeys = new Set<string>();
    const imageIds = new Set<string>();
    for (const [index, slot] of manifest.image_slots.entries()) {
      if (
        imageTaskKeys.has(slot.task_key) ||
        imageIds.has(slot.slot_id) ||
        !batchIds.has(slot.prompt_batch_id) ||
        !batchedTaskKeys.has(slot.task_key)
      ) {
        issues.push(
          semanticIssue(
            `/image_slots/${index}`,
            "Image slots must be unique and bound to exactly one declared prompt batch.",
          ),
        );
      }
      imageTaskKeys.add(slot.task_key);
      imageIds.add(slot.slot_id);
    }
    if (
      imageTaskKeys.size !== batchedTaskKeys.size ||
      [...batchedTaskKeys].some((taskKey) => !imageTaskKeys.has(taskKey))
    ) {
      issues.push(
        semanticIssue(
          "/prompt_batches",
          "Prompt batches and image slots must cover the same task-key set exactly once.",
        ),
      );
    }
    const avatarTaskKeys = new Set<string>();
    const avatarSegments = new Set<string>();
    for (const [index, span] of manifest.avatar_spans.entries()) {
      if (
        avatarTaskKeys.has(span.task_key) ||
        avatarSegments.has(span.timeline_segment_id) ||
        span.padded_start_ms > span.selected_start_ms ||
        span.selected_start_ms >= span.selected_end_ms_exclusive ||
        span.selected_end_ms_exclusive > span.padded_end_ms_exclusive ||
        span.trim_start_ms !== span.selected_start_ms - span.padded_start_ms ||
        span.trim_end_ms_exclusive !==
          span.trim_start_ms + span.selected_end_ms_exclusive - span.selected_start_ms
      ) {
        issues.push(
          semanticIssue(
            `/avatar_spans/${index}`,
            "Avatar span work must be unique and preserve exact selected, padded, and trim timing.",
          ),
        );
      }
      avatarTaskKeys.add(span.task_key);
      avatarSegments.add(span.timeline_segment_id);
    }
    const counts = manifest.cost_counts;
    const selectedAudioMs = manifest.avatar_spans.reduce(
      (sum, span) => sum + span.padded_end_ms_exclusive - span.padded_start_ms,
      0,
    );
    if (
      counts.prompt_batch_count !== manifest.prompt_batches.length ||
      counts.image_prompt_count !== manifest.image_slots.length ||
      counts.image_generation_count !== manifest.image_slots.length ||
      counts.avatar_generation_count !== manifest.avatar_spans.length ||
      counts.selected_span_audio_count !== manifest.avatar_spans.length ||
      counts.selected_span_audio_ms !== selectedAudioMs
    ) {
      issues.push(
        semanticIssue("/cost_counts", "Cost counts must equal the exact immutable work units."),
      );
    }
    return issues;
  }
  if (contractName === "renderWorkManifest") {
    const manifest = value as ContractDocument<"renderWorkManifest">;
    const issues: ContractValidationIssue[] = [];
    const segmentIds = new Set<string>();
    let nextFrame = 0;
    for (const [index, segment] of manifest.segments.entries()) {
      const assetKeys = Object.keys(segment.planned_asset_ids).sort();
      const expectedAssetKeys =
        segment.timeline_composition === "AVATAR_FULL"
          ? ["avatar"]
          : segment.timeline_composition === "IMAGE_FULL"
            ? ["image"]
            : ["avatar", "image"];
      const needsImage = segment.timeline_composition !== "AVATAR_FULL";
      const needsAvatar = segment.timeline_composition !== "IMAGE_FULL";
      if (
        segmentIds.has(segment.timeline_segment_id) ||
        segment.start_frame !== nextFrame ||
        segment.end_frame_exclusive <= segment.start_frame ||
        assetKeys.join("\u0000") !== expectedAssetKeys.join("\u0000") ||
        segment.image_zoom_profile !== (needsImage ? "SLOW_SMOOTH_CENTERED_ZOOM" : "NONE") ||
        segment.avatar_crop_authority !==
          (needsAvatar ? "ACCEPTED_ECHO_PROFILE_REQUIRED" : "NOT_APPLICABLE")
      ) {
        issues.push(
          semanticIssue(
            `/segments/${index}`,
            "Render work must be contiguous and composition-specific with hard-cut image zoom and Echo crop authority.",
          ),
        );
      }
      segmentIds.add(segment.timeline_segment_id);
      nextFrame = segment.end_frame_exclusive;
    }
    if (nextFrame !== manifest.output.total_frames) {
      issues.push(
        semanticIssue("/segments", "Render work must cover every output frame exactly once."),
      );
    }
    return issues;
  }
  return [];
};

export function validateContract<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): ContractValidationResult<ContractDocument<Name>>;
export function validateContract(
  contractName: ContractName,
  value: unknown,
): ContractValidationResult<ContractDocument<ContractName>> {
  const validator = contractValidators[contractName];
  if (validator(value)) {
    const data = value as ContractDocument<ContractName>;
    const issues = semanticContractIssues(contractName, data);
    if (issues.length > 0) return { success: false, issues };
    return { success: true, data };
  }
  return { success: false, issues: normalizeIssues(validator.errors) };
}

export function assertContract<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): ContractDocument<Name> {
  const result = validateContract(contractName, value);
  if (!result.success) throw new ContractValidationError(contractName, result.issues);
  return result.data;
}
