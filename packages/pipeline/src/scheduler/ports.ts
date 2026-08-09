import type { ProjectRevisionDocumentRef } from "../documents.js";
import type { DeterminismPorts } from "../determinism.js";
import type { PipelineResult } from "../errors.js";
import type { TimelinePlanDocumentRef } from "../documents.js";
import type { TranscriptDocumentRef } from "../transcript/types.js";

export interface SchedulerRequest {
  readonly revision: ProjectRevisionDocumentRef;
  readonly transcript: TranscriptDocumentRef;
  readonly determinism: DeterminismPorts;
}

/** Pure deterministic timeline compiler boundary. */
export interface SchedulerPort {
  schedule(request: SchedulerRequest): PipelineResult<TimelinePlanDocumentRef>;
}
