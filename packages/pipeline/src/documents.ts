import type { ContractName, JsonValue, Sha256Digest } from "@videoforge/contracts";

/** A JSON object whose field shape remains owned by its canonical contract. */
export type CanonicalDocumentValue = Readonly<Record<string, JsonValue>>;

/**
 * An already validated, content-addressed canonical document crossing a pure pipeline boundary.
 *
 * This reference is intentionally field-opaque. Construct it only after validation through
 * `@videoforge/contracts`; this package neither redefines nor independently validates schemas.
 */
export interface ValidatedDocumentRef<Name extends ContractName> {
  readonly contractName: Name;
  readonly value: CanonicalDocumentValue;
  readonly sha256: Sha256Digest;
}

export type ProjectRevisionDocumentRef = ValidatedDocumentRef<"projectRevisionConfig">;
export type TimelinePlanDocumentRef = ValidatedDocumentRef<"timelinePlan">;
export type ResolvedRenderManifestDocumentRef = ValidatedDocumentRef<"resolvedRenderManifest">;
