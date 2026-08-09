import type { CanonicalDocumentValue, ProjectRevisionDocumentRef } from "../documents.js";
import type { DeterminismPorts } from "../determinism.js";
import type { PipelineResult } from "../errors.js";
import type { TimelinePlanDocumentRef } from "../documents.js";
import type { TranscriptDocumentRef } from "../transcript/types.js";

export interface SchedulerRequest<
  Transcript extends CanonicalDocumentValue = CanonicalDocumentValue,
> {
  readonly revision: ProjectRevisionDocumentRef;
  readonly transcript: TranscriptDocumentRef<Transcript>;
  readonly determinism: DeterminismPorts;
}

/** Pure deterministic timeline compiler boundary. */
export interface SchedulerPort<Transcript extends CanonicalDocumentValue = CanonicalDocumentValue> {
  schedule(request: SchedulerRequest<Transcript>): PipelineResult<TimelinePlanDocumentRef>;
}
