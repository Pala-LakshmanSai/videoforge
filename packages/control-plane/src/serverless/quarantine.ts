/**
 * Superseded Pod-era contracts stay replayable evidence, but they can never authorize a Serverless
 * v3 dispatch. The V2 firewall names them explicitly so a legacy envelope cannot reach the
 * transport by looking structurally similar to a v3 one.
 */
export const QUARANTINED_DISPATCH_SCHEMAS = Object.freeze([
  "pod-worker-job-envelope/v2",
  "global-generation-session/v2",
  "worker-job-envelope/v2",
] as const);

export const SERVERLESS_V3_ENVELOPE_SCHEMA = "serverless-worker-job-envelope/v3" as const;

export type EnvelopeQuarantineErrorCode =
  | "ENVELOPE_SCHEMA_MISSING"
  | "ENVELOPE_SCHEMA_QUARANTINED"
  | "ENVELOPE_SCHEMA_UNKNOWN";

export class EnvelopeQuarantineError extends Error {
  constructor(
    readonly code: EnvelopeQuarantineErrorCode,
    readonly observedSchema: string | null,
  ) {
    super(
      code === "ENVELOPE_SCHEMA_QUARANTINED"
        ? `${observedSchema ?? "unknown"} is a superseded Pod-era contract and cannot authorize a Serverless v3 dispatch.`
        : "A Serverless v3 dispatch requires the exact serverless-worker-job-envelope/v3 contract.",
    );
    this.name = "EnvelopeQuarantineError";
  }
}

/**
 * Accepts only the exact v3 envelope. Every superseded Pod or global-session envelope fails closed
 * here rather than being coerced into the active dispatch path.
 */
export function assertDispatchableEnvelope(document: unknown): Record<string, unknown> {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new EnvelopeQuarantineError("ENVELOPE_SCHEMA_MISSING", null);
  }
  const record = document as Record<string, unknown>;
  const declared = record.schema ?? record.schema_version;
  if (typeof declared !== "string") {
    throw new EnvelopeQuarantineError("ENVELOPE_SCHEMA_MISSING", null);
  }
  if ((QUARANTINED_DISPATCH_SCHEMAS as readonly string[]).includes(declared)) {
    throw new EnvelopeQuarantineError("ENVELOPE_SCHEMA_QUARANTINED", declared);
  }
  if (declared !== SERVERLESS_V3_ENVELOPE_SCHEMA) {
    throw new EnvelopeQuarantineError("ENVELOPE_SCHEMA_UNKNOWN", declared);
  }
  return record;
}
