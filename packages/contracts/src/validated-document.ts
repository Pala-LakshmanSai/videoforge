import type { JsonValue, Sha256Digest } from "./canonical-json.js";
import { canonicalizeJson, sha256CanonicalJson } from "./canonical-json.js";
import { assertContract } from "./ajv.js";
import type { ContractDocument, ContractName } from "./schemas.js";

declare const validatedContractDocumentBrand: unique symbol;

const deepFreezeJson = (value: JsonValue): JsonValue => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
};

/** A schema-validated document whose hash was assigned by the TypeScript JCS authority. */
export interface ValidatedContractDocument<Name extends ContractName> {
  readonly contractName: Name;
  readonly value: ContractDocument<Name> & JsonValue;
  readonly sha256: Sha256Digest;
  readonly [validatedContractDocumentBrand]: true;
}

/** Canonicalize, freeze, hash, and brand a document already validated by an equivalent authority. */
export async function hashPrevalidatedContractDocument<Name extends ContractName>(
  contractName: Name,
  value: ContractDocument<Name>,
): Promise<ValidatedContractDocument<Name>> {
  const immutableSnapshot = deepFreezeJson(
    JSON.parse(canonicalizeJson(value)) as JsonValue,
  ) as ContractDocument<Name> & JsonValue;
  const sha256 = await sha256CanonicalJson(immutableSnapshot);
  return Object.freeze({
    contractName,
    value: immutableSnapshot,
    sha256,
  }) as ValidatedContractDocument<Name>;
}

export async function validateAndHashContractDocument<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): Promise<ValidatedContractDocument<Name>> {
  const validated = assertContract(contractName, value) as ContractDocument<Name> & JsonValue;
  return hashPrevalidatedContractDocument(contractName, validated);
}
