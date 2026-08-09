import type { JsonValue, Sha256Digest } from "./canonical-json.js";
import { sha256CanonicalJson } from "./canonical-json.js";
import { assertContract } from "./ajv.js";
import type { ContractDocument, ContractName } from "./schemas.js";

declare const validatedContractDocumentBrand: unique symbol;

/** A schema-validated document whose hash was assigned by the TypeScript JCS authority. */
export interface ValidatedContractDocument<Name extends ContractName> {
  readonly contractName: Name;
  readonly value: ContractDocument<Name> & JsonValue;
  readonly sha256: Sha256Digest;
  readonly [validatedContractDocumentBrand]: true;
}

export async function validateAndHashContractDocument<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): Promise<ValidatedContractDocument<Name>> {
  const validated = assertContract(contractName, value) as ContractDocument<Name> & JsonValue;
  const sha256 = await sha256CanonicalJson(validated);
  return Object.freeze({
    contractName,
    value: validated,
    sha256,
  }) as ValidatedContractDocument<Name>;
}
