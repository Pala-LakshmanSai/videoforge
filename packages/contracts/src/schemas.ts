import { canonicalContractRegistry } from "../generated/contract-registry.js";
import { canonicalSchemaDocuments } from "../generated/schema-documents.js";
import type { ContractDocumentMap } from "../generated/contract-types.js";

export type ContractName = keyof ContractDocumentMap;
export type ContractDocument<Name extends ContractName> = ContractDocumentMap[Name];

export const contractNames = Object.freeze(
  canonicalContractRegistry.contracts.map(({ name }) => name),
) as readonly ContractName[];

export { canonicalContractRegistry, canonicalSchemaDocuments };
export type * from "../generated/contract-types.js";

export const contractSchemaIds = Object.freeze(
  Object.fromEntries(
    contractNames.map((contractName) => [contractName, canonicalSchemaDocuments[contractName].$id]),
  ),
) as Readonly<Record<ContractName, string>>;
