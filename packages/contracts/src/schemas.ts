import { canonicalSchemaDocuments } from "../generated/schema-documents.js";

export const contractNames = [
  "avatarProfileVersion",
  "createProjectRequest",
  "imageStyleProfile",
  "imageStyleAnalyzerOutput",
  "projectRevisionConfig",
  "timelinePlan",
  "resolvedRenderManifest",
  "productionManifest",
] as const;

export type ContractName = (typeof contractNames)[number];

export { canonicalSchemaDocuments };

export const contractSchemaIds = {
  avatarProfileVersion: canonicalSchemaDocuments.avatarProfileVersion.$id,
  createProjectRequest: canonicalSchemaDocuments.createProjectRequest.$id,
  imageStyleProfile: canonicalSchemaDocuments.imageStyleProfile.$id,
  imageStyleAnalyzerOutput: canonicalSchemaDocuments.imageStyleAnalyzerOutput.$id,
  projectRevisionConfig: canonicalSchemaDocuments.projectRevisionConfig.$id,
  timelinePlan: canonicalSchemaDocuments.timelinePlan.$id,
  resolvedRenderManifest: canonicalSchemaDocuments.resolvedRenderManifest.$id,
  productionManifest: canonicalSchemaDocuments.productionManifest.$id,
} as const satisfies Record<ContractName, string>;
