import type { JsonValue, Sha256Digest } from "@videoforge/contracts";

import type { CanonicalDocumentValue } from "../documents.js";

/**
 * Field-opaque transcript data until the canonical transcript contract lands in Phase 0C.
 * The generic lets that contract replace the default without changing scheduler port semantics.
 */
export interface TranscriptDocumentRef<
  Transcript extends CanonicalDocumentValue = CanonicalDocumentValue,
> {
  readonly value: Transcript;
  readonly sha256: Sha256Digest;
}

/** A generic JSON transcript fragment for pure preprocessing boundaries. */
export type TranscriptFragment = JsonValue;
