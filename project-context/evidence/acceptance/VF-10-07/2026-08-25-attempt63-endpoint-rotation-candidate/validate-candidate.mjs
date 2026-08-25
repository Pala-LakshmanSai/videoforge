import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:83a54dbd5d4810a83fa100eaf5014af255097ae2eb7c6264deccf209d5a3e532",
  acceptance: "sha256:d882eb9ac8855ececd87d83fd8b6b97399a7361bcac1f394d6039cdbd709f66b",
  preflight: "sha256:fdbe49a4d9d422c24827535a17ff39c64ae1f9eea2d746bff15fe4d5c6d9e419",
  max1: "sha256:d692f9b8b59b82a68afce770970aa44ea798d4fd08c679ac47585aa1096650b8",
  max2: "sha256:29c7eabb03f62051475e5fa6513581b8d1976e760582a17e4ff4421b1b6191cb",
  harness: "sha256:a1184497be1fc046008ca01a30903ee4dff165da990c6218b22acdcf1e304853",
  harnessTest: "sha256:24257c1567bcbe1246741a8a600a18ff5f0aea67abc02e3260497d2e13e208ad",
  qualification: "sha256:10d6a3eed7db3b6f50688cf0fc82904f2f5023e37840922c63fbb53511227605",
  qualificationTest: "sha256:d3b04834164c54fcdaf558e30b1d36cc3d7292e4aca533b873c0e21b5c251ff7",
  orchestrator: "sha256:b53686061be569262f90744704cb312489da2b88a1b177c1378bf1d3baec1e2a",
  orchestratorTest: "sha256:83e51030b4f2be860ff39e1770fea710381f68f2f8f3abac940a64c23bebbde8",
  canonicalActivation: "sha256:3569bc480f2084a9d04a94b8b47507cc8f4e6183a67308aa9039c2b485108323",
  version: "sha256:fed54e9136fe3ac6f3788771b8bdc7d7a4507cef74a4e6f4a08e5c19d64af39f",
  record: "sha256:5e45b9b400d33cee1ea533e64bc8177ff6418ff4e810dd880944d18e8b014031",
  rotationCommit: "3f3bed48e69f149cf56ee6aa6c42cabb70528db4",
  anchorCommit: "9c9ca3476c976592ae73414e6a1e53cc0fcbb643",
  attempt62Authority: "sha256:932cd239e3352a14b042cf2b165a677406a62acfb157965ac42b7abba0924191",
  attempt62Closure: "sha256:3c3a4332dd1f0bbf2753b3ba9689f697bc38538fb99127bba47a803e94bf0aaf",
  attempt62Reconciliation: "sha256:ea0678ce17f3b6489fb06c6d49653838c56f20982f563060b2dc72f0e6dfdbc6",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const bytes = (name) => readFile(path.join(dir, name));
const json = async (name) => JSON.parse(await bytes(name));
const rootBytes = (name) => readFile(path.join(root, name));
const rootSha = async (name) => sha(await rootBytes(name));

const [proposal, acceptance, preflight, max1, max2, activation, harness, harnessTest, qualification, qualificationTest, orchestrator] =
  await Promise.all([
    json("combined-live-proposal.json"),
    json("acceptance.json"),
    json("read-only-preflight.json"),
    json("staged-config-max1.json"),
    json("staged-config-max2.json"),
    rootBytes("apps/web/src/server/providers/v207-activation-authority.ts").then(String),
    rootBytes("apps/web/src/server/providers/runpod-v207-qualification-harness.ts").then(String),
    rootBytes("apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts").then(String),
    rootBytes("apps/web/src/server/providers/v207-live-qualification.ts").then(String),
    rootBytes("apps/web/src/server/providers/v207-live-qualification.test.ts").then(String),
    rootBytes("apps/web/src/server/providers/v207-live-orchestrator.ts").then(String),
  ]);

yes(sha(await bytes("combined-live-proposal.json")) === expected.proposal, "PROPOSAL_HASH");
yes(sha(await bytes("acceptance.json")) === expected.acceptance, "ACCEPTANCE_HASH");
yes(sha(await bytes("read-only-preflight.json")) === expected.preflight, "PREFLIGHT_HASH");
yes(sha(await bytes("staged-config-max1.json")) === expected.max1, "MAX1_HASH");
yes(sha(await bytes("staged-config-max2.json")) === expected.max2, "MAX2_HASH");
yes(
  (await rootSha("apps/web/src/server/providers/runpod-v207-qualification-harness.ts")) === expected.harness &&
    (await rootSha("apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts")) === expected.harnessTest &&
    (await rootSha("apps/web/src/server/providers/v207-live-qualification.ts")) === expected.qualification &&
    (await rootSha("apps/web/src/server/providers/v207-live-qualification.test.ts")) === expected.qualificationTest &&
    (await rootSha("apps/web/src/server/providers/v207-live-orchestrator.ts")) === expected.orchestrator &&
    (await rootSha("apps/web/src/server/providers/v207-live-orchestrator.test.ts")) === expected.orchestratorTest,
  "SOURCE_HASH",
);
yes(
  proposal.attempt === 63 &&
    proposal.qualification_status === "NOT_QUALIFIED" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP" &&
    proposal.provider_calls_authorized === false &&
    proposal.provider_mutations_authorized === false &&
    proposal.gpu_use_authorized === false &&
    proposal.v2_08_authorized === false &&
    proposal.repair.endpoint_rotation_commit === expected.rotationCommit &&
    proposal.repair.anchor_rebind_commit === expected.anchorCommit &&
    proposal.repair.replacement_dispatch_count === 1 &&
    proposal.repair.redispatch === false &&
    proposal.repair.distinct_signed_pod_requirement_preserved === true &&
    proposal.repair.acceptance_relaxed === false,
  "PROPOSAL_SCOPE",
);
yes(
  proposal.cost.additional_endpoint_initialization_liability_usd === 0.24444444444444446 &&
    proposal.cost.finite_action_estimate_usd_ceiling === 4.25 &&
    proposal.cost.requested_maximum_cumulative_finite_spend_usd === 4.5 &&
    proposal.cost.executable_finite_cap_usd === null &&
    proposal.cost.existing_two_volumes_usd_per_month === 7 &&
    proposal.approval_request.exact_proposal_approved === false &&
    proposal.approval_request.anchor_refresh_authorized === null &&
    proposal.approval_request.endpoint_rotation_authorized === null,
  "COST_AND_AUTHORITY",
);
yes(
  preflight.attempt === 63 &&
    preflight.fresh_provider_read === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.runpod.pods === 0 &&
    preflight.runpod.endpoints === 0 &&
    preflight.runpod.private_templates === 0 &&
    preflight.runpod.active_workers === 0 &&
    preflight.runpod.running_pods === 0 &&
    preflight.runpod.retained_volumes.length === 2 &&
    preflight.runpod.selected_gpu.availability === "LOW" &&
    preflight.runpod.selected_gpu.flashboot === true &&
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.route_status === 404 &&
    preflight.cloudflare.route_code === "V207_ROUTE_DISABLED" &&
    preflight.cloudflare.all_route_version_hashes_match_active === true &&
    preflight.cloudflare.signer_present === false &&
    preflight.local_disk.headroom_gate_satisfied === true &&
    preflight.attempt62.consumed_authority_sha256 === expected.attempt62Authority &&
    preflight.attempt62.closure_sha256 === expected.attempt62Closure &&
    preflight.attempt62.reconciliation_sha256 === expected.attempt62Reconciliation &&
    preflight.attempt62.reused === false,
  "PREFLIGHT_TRUTH",
);
for (const [config, workers] of [
  [max1, 1],
  [max2, 2],
]) {
  yes(
    config.attempt === 63 &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.gpu === "NVIDIA GeForce RTX 4090" &&
      config.region === "EU-RO-1" &&
      config.volume.mount === "/runpod-volume" &&
      config.volume.application_read_only === true &&
      config.source.endpoint_rotation_commit === expected.rotationCommit &&
      config.source.anchor_rebind_commit === expected.anchorCommit &&
      config.source.orchestrator_sha256 === expected.orchestrator &&
      config.source.qualification_sha256 === expected.qualification &&
      config.source.harness_sha256 === expected.harness &&
      config.expected_old_anchor.version_id_sha256 === expected.version &&
      config.expected_old_anchor.record_sha256 === expected.record,
    `CONFIG_${workers}`,
  );
}
yes(
  max1.endpoint_rotation.required === true &&
    max1.endpoint_rotation.maximum_sequential_endpoints === 2 &&
    max1.endpoint_rotation.maximum_concurrent_endpoints === 1 &&
    max1.endpoint_rotation.replacement_dispatch_count === 1 &&
    max1.endpoint_rotation.redispatch === false &&
    max2.restore_after_proof === "staged-config-max1.json",
  "ROTATION_CONFIG",
);
yes(
  acceptance.attempt === 63 &&
    acceptance.proposal_sha256 === expected.proposal &&
    acceptance.preflight_sha256 === expected.preflight &&
    acceptance.max1_sha256 === expected.max1 &&
    acceptance.max2_sha256 === expected.max2 &&
    acceptance.authority.exact_proposal_approved === false &&
    acceptance.authority.maximum_cumulative_finite_spend_usd === null &&
    acceptance.authority.requested_maximum_cumulative_finite_spend_usd === 4.5 &&
    acceptance.authority.v2_08_authorized === false,
  "ACCEPTANCE",
);
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_PROPOSAL_POINTER");
yes(/V207_APPROVED_AUTHORITY_SHA256: string \| null =\s*null;/u.test(activation), "AUTHORITY_NULL");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = null;/u.test(activation), "CAP_NULL");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = null;/u.test(activation), "REFRESH_NULL");
const canonical = activation
  .replace(/^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/mu, `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`)
  .replace(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/mu, "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/mu, "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/mu, "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;");
yes(sha(canonical) === expected.canonicalActivation, "CANONICAL_ACTIVATION_HASH");
const rotationBlock = harness.slice(
  harness.indexOf("async rotateEndpointForProcessReplacement("),
  harness.indexOf("/** Require the replacement's signed runtime identity"),
);
yes(
  rotationBlock.includes("async rotateEndpointForProcessReplacement(") &&
    rotationBlock.includes("RUNPOD_PROCESS_REPLACEMENT_ROTATION_GAP_UNCONFIRMED") &&
    rotationBlock.includes("RUNPOD_PROCESS_REPLACEMENT_ENDPOINT_ID_NOT_DISTINCT") &&
    rotationBlock.indexOf("deleteEndpoint(seedEndpoint.id") < rotationBlock.indexOf("createScaleZeroEndpoint(") &&
    qualification.indexOf("rotateEndpointForProcessReplacement(") < qualification.indexOf("const resumeBatch = await createBatch(") &&
    qualification.includes("replacementEndpointIdHash") &&
    qualification.includes("harness.assertProcessReplacementIdentity(") &&
    harnessTest.includes("rotates the drained seed endpoint before exactly one replacement dispatch") &&
    qualificationTest.includes("rotates the drained seed endpoint before one replacement and binds all later proof to it"),
  "ROTATION_SOURCE_CONTRACT",
);
yes(
  orchestrator.includes(`"${expected.version}" as const`) && orchestrator.includes(`"${expected.record}" as const`),
  "ANCHOR_CONSTANTS",
);
let authorityExists = true;
try {
  await access(path.join(dir, "approved-authority.json"));
} catch {
  authorityExists = false;
}
yes(authorityExists === false, "NO_AUTHORITY_FILE");
process.stdout.write(`PASS validate-v207-attempt63-candidate ${JSON.stringify(expected)}\n`);
