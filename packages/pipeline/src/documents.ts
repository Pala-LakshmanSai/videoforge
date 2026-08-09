import type { ValidatedContractDocument } from "@videoforge/contracts";

/**
 * An already validated, content-addressed canonical document crossing a pure pipeline boundary.
 *
 * Construct these only through `validateAndHashContractDocument`; the brand prevents callers from
 * assembling lookalike values that bypass canonical schema validation or TypeScript-owned JCS.
 */
export type ProjectRevisionDocumentRef = ValidatedContractDocument<"projectRevisionConfig">;
export type TimelinePlanDocumentRef = ValidatedContractDocument<"timelinePlan">;
export type ResolvedRenderManifestDocumentRef = ValidatedContractDocument<"resolvedRenderManifest">;
