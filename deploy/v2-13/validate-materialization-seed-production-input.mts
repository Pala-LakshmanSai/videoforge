import { readFileSync } from "node:fs";

import { V213_QUALIFICATION_CASE_DESCRIPTORS } from "../../apps/web/src/server/providers/v213-dual-lane-live.ts";
import { validateV213ProductionInputShape } from "../../apps/web/src/server/providers/v213-full-live-cli.ts";

const path = process.argv[2];
if (!path) throw new Error("V2_13_MATERIALIZATION_SEED_PATH_REQUIRED");
const seed = JSON.parse(readFileSync(path, "utf8"));
const dualLaneInput = structuredClone(seed.production_input_base?.dualLaneInput);
const descriptor = structuredClone(dualLaneInput?.qualificationCaseDescriptor);
if (
  descriptor?.schemaVersion !==
    "videoforge.v213-qualification-case-materialization-descriptor/v1" ||
  descriptor?.cases === null ||
  typeof descriptor?.cases !== "object" ||
  Array.isArray(descriptor.cases)
)
  throw new Error("V2_13_MATERIALIZATION_SEED_QUALIFICATION_DESCRIPTOR_INVALID");
dualLaneInput.qualificationCaseDescriptors = V213_QUALIFICATION_CASE_DESCRIPTORS.map(({ key }) => ({
  key,
  ...(descriptor.cases[key] as Record<string, unknown>),
}));
dualLaneInput.qualificationSourceRefs = {
  caseSource: descriptor.caseSource,
  generators: descriptor.generators,
  validators: descriptor.validators,
};
dualLaneInput.qualificationProtectedInputDescriptors = descriptor.protectedInputs;
dualLaneInput.qualificationGeneratorSha256 = `sha256:${"4".repeat(64)}`;
dualLaneInput.billingBaselineUsd = 0;
delete dualLaneInput.qualificationCaseDescriptor;
for (const [lane, character] of [
  ["mage", "1"],
  ["soulx", "2"],
] as const) {
  Object.assign(dualLaneInput[lane], {
    publicImage: `ghcr.io/pala-lakshmansai/videoforge-${lane}@sha256:${character.repeat(64)}`,
    sourceCommit: character.repeat(40),
    deploymentSha256: `sha256:${character.repeat(64)}`,
  });
}
validateV213ProductionInputShape({
  schemaVersion: "videoforge.v213-full-live-production-input/v1",
  outerStateSha256: `sha256:${"3".repeat(64)}`,
  fullLiveAuthorityId: seed.production_input_base?.fullLiveAuthorityId,
  dualLaneInput,
  commandPayload: {},
});
