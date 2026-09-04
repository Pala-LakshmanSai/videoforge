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
  "sha256:ed0062759c2c12f050a542a80a21b57f26c0f7ae8c1f31a9e1635f8ec2daf087",
  "proposal",
);
expectEqual(proposal.control_source_commit, "9caea53785484be42a7bea210a0294addef1a3e0", "control");
expectEqual(
  proposal.image,
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:91ef608fbb15bc69213c73a598a8915fa4dfa938d02c619454e42319a6475f62",
  "image",
);
expectEqual(
  hash(await read(resolve(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts"))),
  proposal.source_hashes.qualification_harness,
  "harness",
);
expectEqual(
  hash(await read(resolve(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts"))),
  proposal.source_hashes.qualification_harness_test,
  "harness test",
);
const activation = await read(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8");
if (!activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null")) {
  throw new Error("live authority is not null");
}
if (!activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")) {
  throw new Error("live cap is not null");
}
if (!activation.includes("V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null")) {
  throw new Error("anchor authority is not null");
}
console.log("PASS Attempt81 sealed candidate; executable authority remains absent");
