import { z } from "zod";

import { validateContract } from "./ajv.js";
import { createProjectRequestSchema } from "./create-project.js";
import { contractNames, type ContractDocument, type ContractName } from "./schemas.js";

export function canonicalContractZodSchema<T = unknown>(contractName: ContractName): z.ZodType<T> {
  return z.custom<T>((value) => validateContract(contractName, value).success, {
    message: `Value must satisfy the canonical ${contractName} JSON Schema.`,
  });
}

export const canonicalContractZodSchemas = Object.freeze({
  ...Object.fromEntries(
    contractNames.map((contractName) => [contractName, canonicalContractZodSchema(contractName)]),
  ),
  createProjectRequest: createProjectRequestSchema,
}) as unknown as { readonly [Name in ContractName]: z.ZodType<ContractDocument<Name>> };
