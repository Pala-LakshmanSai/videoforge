import type { JsonValue } from "@videoforge/contracts";

export const PIPELINE_ERROR_CODES = [
  "CONTRACT_INVALID",
  "TRANSCRIPT_INVALID",
  "TIMELINE_INVALID",
  "REQUIRED_ASSET_MISSING",
  "DUPLICATE_ASSET_BINDING",
  "ASSET_KIND_MISMATCH",
  "ASSET_HASH_MISMATCH",
  "RENDER_PROFILE_MISMATCH",
  "RENDER_PLAN_INVALID",
] as const;

export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];
export type PipelineErrorPath = readonly (string | number)[];

export interface PipelineFailure {
  readonly code: PipelineErrorCode;
  readonly message: string;
  readonly path: PipelineErrorPath;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export type PipelineResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: PipelineFailure };

export function pipelineSuccess<Value>(value: Value): PipelineResult<Value> {
  return Object.freeze({ ok: true, value });
}

export function pipelineFailure(error: PipelineFailure): PipelineResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      ...error,
      path: Object.freeze([...error.path]),
      ...(error.details === undefined ? {} : { details: Object.freeze({ ...error.details }) }),
    }),
  });
}

/** A coded exception for adapter boundaries that cannot return `PipelineResult`. */
export class PipelineDomainError extends Error {
  readonly failure: PipelineFailure;

  constructor(failure: PipelineFailure) {
    super(failure.message);
    this.name = "PipelineDomainError";
    this.failure = Object.freeze({
      ...failure,
      path: Object.freeze([...failure.path]),
      ...(failure.details === undefined ? {} : { details: Object.freeze({ ...failure.details }) }),
    });
  }
}
