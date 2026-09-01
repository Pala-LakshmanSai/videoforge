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
export { SUPPORTED_SCHEDULER_CONFIG, SUPPORTED_SCHEDULER_VERSION } from "./config.js";
