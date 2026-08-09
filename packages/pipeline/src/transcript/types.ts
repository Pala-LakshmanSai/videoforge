import type { JsonValue, ValidatedContractDocument } from "@videoforge/contracts";

/**
 * Canonical transcript timing validated and hashed by the TypeScript control plane.
 */
export type TranscriptDocumentRef = ValidatedContractDocument<"transcriptTiming">;

/** A generic JSON transcript fragment for pure preprocessing boundaries. */
export type TranscriptFragment = JsonValue;
