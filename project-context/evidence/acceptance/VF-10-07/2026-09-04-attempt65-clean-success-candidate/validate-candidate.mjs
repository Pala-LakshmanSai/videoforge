import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../../..");
const read = (name) => JSON.parse(readFileSync(resolve(directory, name), "utf8"));
const sha256 = (path) =>
  `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const control = "0de8949a8345e75c6f423a9338e314a737b2a95d";
const imageSource = "095e1642562e4370c89425292428eb474ba190f1";
const image =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a92e4345c111d60fc197cbc0fd3adf7d907a64d49547507fe68a089d5ed2247";
const proposalDigest =
  "sha256:db48b22e53edc3206538558a07b9603fcb66a2b00b33ec3b6093858540594a0c";
const authorityDigest =
  "sha256:588aec6a8fd2297dde2019dc565aeb50411167090b6b499aa01504e9044882ea";

const expectedFiles = {
  "image-publication.json": "sha256:2f1d258b48b9bbae614dbbc5d9a4f83de62383316a181945f2dabd3ba4779ba1",
  "read-only-preflight.json": "sha256:8b713d9d432f8e6cbef380172bd518e9374516fe6cf39c86f9461f8e6acf6eda",
  "staged-config-max1.json": "sha256:7eacc9aef1691f5cfaefe262b59718db454a1c735c1ee9face48aa8ee4c5b8ee",
  "staged-config-max2.json": "sha256:0012d6f8363ec19df035b7bc83925f22cdabf64439df6e4886c10c9014154a51",
  "combined-live-proposal.json": proposalDigest,
  "acceptance.json": "sha256:d799a66c08db629435df0f8823aed6b541f7d95675a3014f51aba32e32129d56",
  "approved-authority.json": authorityDigest,
};
for (const [name, expected] of Object.entries(expectedFiles)) {
  assert(sha256(resolve(directory, name)) === expected, `${name}: digest mismatch`);
}

const proposal = read("combined-live-proposal.json");
const authority = read("approved-authority.json");
const acceptance = read("acceptance.json");
assert(proposal.control_source_commit === control, "proposal control mismatch");
assert(proposal.image_source_commit === imageSource, "proposal image source mismatch");
assert(proposal.image === image, "proposal image mismatch");
assert(proposal.rate_and_cap.maximum_incremental_spend_usd === 4.5, "proposal cap mismatch");
assert(proposal.rate_and_cap.serverless_flex_usd_per_gpu_hour === 1.116, "proposal rate mismatch");
assert(proposal.configuration.workers_max_temporary === 2, "proposal max workers mismatch");
assert(proposal.configuration.automatic_gpu_fallback === false, "fallback must be disabled");
assert(proposal.v2_08_authorized === false, "V2-08 must be disabled");
assert(proposal.forbidden.includes("V2-08 execution"), "V2-08 missing from forbidden set");
assert(proposal.forbidden.includes("workers above two"), "worker ceiling missing");

assert(authority.control_source_commit === control, "authority control mismatch");
assert(authority.image_source_commit === imageSource, "authority image source mismatch");
assert(authority.proposal_sha256 === proposalDigest, "authority proposal mismatch");
assert(authority.maximum_incremental_spend_usd === 4.5, "authority cap mismatch");
assert(authority.serverless_flex_usd_per_gpu_hour === 1.116, "authority rate mismatch");
assert(authority.workers_max === 2, "authority max workers mismatch");
assert(authority.anchor_refresh_authorized === false, "anchor refresh must be disabled");
assert(authority.v2_08_authorized === false, "authority must forbid V2-08");
assert(authority.single_use === true, "authority must be single use");
assert(acceptance.control_source_commit === control, "acceptance control mismatch");
assert(acceptance.v2_08_started === false, "acceptance must not start V2-08");

const sources = {
  qualification: "apps/web/src/server/providers/v207-live-qualification.ts",
  harness: "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
  reconciliation: "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
  orchestrator: "apps/web/src/server/providers/v207-live-orchestrator.ts",
};
for (const [key, path] of Object.entries(sources)) {
  assert(sha256(resolve(repository, path)) === proposal.source_hashes[key], `${key}: source drift`);
}

const activation = readFileSync(
  resolve(repository, "apps/web/src/server/providers/v207-activation-authority.ts"),
  "utf8",
);
for (const value of [image, imageSource, proposalDigest, authorityDigest]) {
  assert(activation.includes(value), `activation binding missing: ${value}`);
}
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4.5"), "cap binding missing");
assert(
  activation.includes("V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = false"),
  "anchor-refresh binding mismatch",
);

const resolved = execFileSync("git", ["rev-parse", control], { cwd: repository, encoding: "utf8" }).trim();
assert(resolved === control, "approved control commit is unavailable");
execFileSync("git", ["merge-base", "--is-ancestor", control, "HEAD"], { cwd: repository });

console.log(JSON.stringify({ status: "PASS", attempt: 65, proposal: proposalDigest }));
