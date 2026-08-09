import { z } from "zod";

import { validateContract } from "./ajv.js";
import { createProjectRequestSchema } from "./create-project.js";
import type { ContractName } from "./schemas.js";

export function canonicalContractZodSchema<T = unknown>(contractName: ContractName): z.ZodType<T> {
  return z.custom<T>((value) => validateContract(contractName, value).success, {
    message: `Value must satisfy the canonical ${contractName} JSON Schema.`,
  });
}

export const canonicalContractZodSchemas = {
  avatarProfileVersion: canonicalContractZodSchema("avatarProfileVersion"),
  createProjectRequest: createProjectRequestSchema,
  imageStyleProfile: canonicalContractZodSchema("imageStyleProfile"),
  imageStyleAnalyzerOutput: canonicalContractZodSchema("imageStyleAnalyzerOutput"),
  orchestrationState: canonicalContractZodSchema("orchestrationState"),
  projectRevisionConfig: canonicalContractZodSchema("projectRevisionConfig"),
  timelinePlan: canonicalContractZodSchema("timelinePlan"),
  resolvedRenderManifest: canonicalContractZodSchema("resolvedRenderManifest"),
  productionManifest: canonicalContractZodSchema("productionManifest"),
  workerJobEnvelope: canonicalContractZodSchema("workerJobEnvelope"),
} as const;
