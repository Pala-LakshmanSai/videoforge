import type { ProjectRevisionDocumentRef } from "../documents.js";
import type { ContractDocumentValidationAuthority } from "@videoforge/contracts";
import type { DeterminismPorts } from "../determinism.js";
import type { PipelineResult } from "../errors.js";
import type { TimelinePlanDocumentRef } from "../documents.js";
import type { TranscriptDocumentRef } from "../transcript/types.js";

export interface SchedulerRequest {
  readonly revision: ProjectRevisionDocumentRef;
  readonly transcript: TranscriptDocumentRef;
  readonly determinism: DeterminismPorts;
  readonly contractDocumentAuthority?: ContractDocumentValidationAuthority;
}

/** Pure deterministic timeline compiler boundary. */
export interface SchedulerPort {
  schedule(request: SchedulerRequest): Promise<PipelineResult<TimelinePlanDocumentRef>>;
}

export {
  compileCompleteWorkPlan,
  type CompleteWorkPlan,
  type CompleteWorkPlanRequest,
  type MaterializedSelectedSpan,
} from "./work-plan.js";

export { deterministicTimelineScheduler, scheduleTimeline } from "./scheduler.js";
export {
  SUPPORTED_SCHEDULER_CONFIG,
  SUPPORTED_SCHEDULER_VERSION,
  SHORT_FORM_SCHEDULER_CONFIG,
  SHORT_FORM_SCHEDULER_VERSION,
  SCRIPT_SHORT_FORM_SCHEDULER_CONFIG,
  SCRIPT_SHORT_FORM_SCHEDULER_VERSION,
  WORD_BOUNDARY_SCHEDULER_VERSION,
  WORD_BOUNDARY_SCHEDULER_CONFIG,
  NARRATION_SHOT_SCHEDULER_VERSION,
  NARRATION_SHOT_SHORT_SCHEDULER_VERSION,
  NARRATION_SHOT_SCHEDULER_CONFIG,
  NARRATION_SHOT_SHORT_SCHEDULER_CONFIG,
  AI_VIDEO_OPENING_SECONDS,
  schedulerHasAiVideoOpening,
  schedulerHasCompositionControls,
  COMPOSITION_SCHEDULER_VERSION,
  COMPOSITION_SHORT_SCHEDULER_VERSION,
  schedulerHasConfigurableAiVideoOpening,
  schedulerAiVideoOpeningSeconds,
  isValidAiVideoOpeningSeconds,
  CONFIGURABLE_AI_VIDEO_OPENING_SCHEDULER_VERSION,
  CONFIGURABLE_AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION,
  AI_VIDEO_OPENING_SCHEDULER_VERSION,
  AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION,
  AI_VIDEO_OPENING_SCHEDULER_CONFIG,
  AI_VIDEO_OPENING_SHORT_SCHEDULER_CONFIG,
  schedulerConfigForVersion,
} from "./config.js";
export { spanPaddedWindowMs, SPAN_PADDED_MAX_MS, SPAN_PADDED_MIN_MS } from "./span-padding.js";
