import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../..");
const here = import.meta.dirname;
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const read = (path) => readFile(path);
const parse = async (path) => JSON.parse(await read(path));
const expectEqual = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: ${actual} != ${expected}`);
};

const proposalPath = resolve(here, "combined-live-proposal.json");
const proposal = await parse(proposalPath);
expectEqual(
  hash(await read(proposalPath)),
  "sha256:7b3cbf20e34e16bead28e9b176b5fefc328d181021cdefc8bf05335886bbce06",
  "proposal",
);
expectEqual(proposal.control_source_commit, "aceef8e0d0d678468ea9560f1faa94aa562fc466", "control");
expectEqual(
  proposal.image,
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb",
  "image",
);
const sourcePaths = {
  disposable_orchestrator: "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
  disposable_orchestrator_test: "apps/web/src/server/providers/v207-disposable-live-orchestrator.test.ts",
  qualification_harness: "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
  qualification_harness_test: "apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts",
  qualification: "apps/web/src/server/providers/v207-live-qualification.ts",
  reconciliation: "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
  disposable_output_ports: "apps/web/src/server/hosted/v207-disposable-output-ports.ts",
  disposable_output_ports_test: "apps/web/src/server/hosted/v207-disposable-output-ports.test.ts",
  disposable_wrangler_config: "deploy/v2-07/v207-disposable-output.wrangler.jsonc",
  mage_handler: "workers/image-media/mage_serverless.py",
  mage_repair_dockerfile: "workers/image-media/Dockerfile.mage.repair",
  mage_image_workflow: ".github/workflows/mage-image.yml",
};
for (const [name, path] of Object.entries(sourcePaths)) {
  expectEqual(hash(await read(resolve(root, path))), proposal.source_hashes[name], name);
}
const identity = await parse(resolve(here, "local-image-identity.json"));
const verification = await parse(resolve(here, "local-image-verification.json"));
expectEqual(identity.manifest_digest, proposal.image.split("@")[1], "identity manifest");
expectEqual(verification.manifest_digest, identity.manifest_digest, "verification manifest");
expectEqual(identity.source_commit, proposal.image_source_commit, "identity source");
const activation = await read(
  resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  "utf8",
);
if (!activation.includes(proposal.control_source_commit)) throw new Error("control source is not pinned");
if (!activation.includes("sha256:7b3cbf20e34e16bead28e9b176b5fefc328d181021cdefc8bf05335886bbce06")) {
  throw new Error("proposal is not pinned");
}
if (!activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null")) {
  throw new Error("live authority is not null");
}
if (!activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")) {
  throw new Error("live cap is not null");
}
if (!activation.includes("V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null")) {
  throw new Error("anchor authority is not null");
}
console.log("PASS Attempt82 sealed; executable authority absent");
