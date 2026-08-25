import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:12d9d7553f2a00f80b5c415676988d23a1bd874ed9e5d2a1b8bcc6fcad365909",
  acceptance: "sha256:fa26896adc01fbdabf0ec22efc8b5bb3d000711be79b33692e837bf983e238d2",
  preflight: "sha256:db78eac734c87bf2b114aff4431337306d142ff87af987599632786f8cbd7929",
  max1: "sha256:3c00c51f851aa7fe312042fb69c3b38e6ed47566ad4c9b2e05f6be632daa499e",
  max2: "sha256:1faf6ea1b644e93f1a3550d3c9853d95b061520d1388bb3d0d31e6ec8b05381a",
  orchestrator: "sha256:0125d58b4692df05e49528c929203812e16890e308655e36c7b5158919ba94ef",
  orchestratorTest: "sha256:571b9ba2b68fd8d536b5e14f078aa6a0dc30dff1d9da9f0dbb58b3fff47baaa8",
  admission: "sha256:305944852bcdef09415e1c481bb249ba3cbacbcd218308c38a7d7f5cce6ab0fa",
  qualification: "sha256:c8ce97719788f91bc546df8b6c251f99d8e3367db1c562b27e52c927cf0ec986",
  qualificationTest: "sha256:d3b04834164c54fcdaf558e30b1d36cc3d7292e4aca533b873c0e21b5c251ff7",
  harness: "sha256:a1184497be1fc046008ca01a30903ee4dff165da990c6218b22acdcf1e304853",
  harnessTest: "sha256:24257c1567bcbe1246741a8a600a18ff5f0aea67abc02e3260497d2e13e208ad",
  activation: "sha256:1a757cde3dbe959e880f427a871f23778382df567e19b6bb8f1b45073500ccc6",
  canonicalActivation: "sha256:3569bc480f2084a9d04a94b8b47507cc8f4e6183a67308aa9039c2b485108323",
  version: "sha256:f6aa5261478b4ce2a54a84a5ddad7ea4af32327f756dc15f73a399000b41c643",
  record: "sha256:54beafecb8d70bf99d0c3f84cee00d6bcb107e202786b1d8f7fe5bb14b33085d",
  commit: "aa0524f2d340cab1a4c4693584dc626e117f7d2c",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const bytes = (name) => readFile(path.join(dir, name));
const json = async (name) => JSON.parse(await bytes(name));
const rootBytes = (name) => readFile(path.join(root, name));
const rootSha = async (name) => sha(await rootBytes(name));

const [proposal, acceptance, preflight, max1, max2, activation, orchestrator, qualification] =
  await Promise.all([
    json("combined-live-proposal.json"),
    json("acceptance.json"),
    json("read-only-preflight.json"),
    json("staged-config-max1.json"),
    json("staged-config-max2.json"),
    rootBytes("apps/web/src/server/providers/v207-activation-authority.ts").then(String),
    rootBytes("apps/web/src/server/providers/v207-live-orchestrator.ts").then(String),
    rootBytes("apps/web/src/server/providers/v207-live-qualification.ts").then(String),
  ]);

for (const [name, expectedHash] of [
  ["combined-live-proposal.json", expected.proposal],
  ["acceptance.json", expected.acceptance],
  ["read-only-preflight.json", expected.preflight],
  ["staged-config-max1.json", expected.max1],
  ["staged-config-max2.json", expected.max2],
]) {
  yes(sha(await bytes(name)) === expectedHash, `HASH_${name}`);
}
for (const [name, expectedHash] of [
  ["apps/web/src/server/providers/v207-live-orchestrator.ts", expected.orchestrator],
  ["apps/web/src/server/providers/v207-live-orchestrator.test.ts", expected.orchestratorTest],
  ["apps/web/src/server/providers/v207-read-only-admission.ts", expected.admission],
  ["apps/web/src/server/providers/v207-live-qualification.ts", expected.qualification],
  ["apps/web/src/server/providers/v207-live-qualification.test.ts", expected.qualificationTest],
  ["apps/web/src/server/providers/runpod-v207-qualification-harness.ts", expected.harness],
  ["apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts", expected.harnessTest],
  ["apps/web/src/server/providers/v207-activation-authority.ts", expected.activation],
]) {
  yes((await rootSha(name)) === expectedHash, `SOURCE_${name}`);
}

yes(
  proposal.attempt === 64 &&
    proposal.qualification_status === "NOT_QUALIFIED" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP" &&
    proposal.provider_calls_authorized === false &&
    proposal.provider_mutations_authorized === false &&
    proposal.gpu_use_authorized === false &&
    proposal.v2_08_authorized === false &&
    proposal.repair.deadline_mode_admission_commit === expected.commit &&
    proposal.repair.full_read_only_admission_before_remote_mutation === true &&
    proposal.repair.immediate_second_catalog_inventory_check_before_runpod_mutation === true &&
    proposal.repair.gpu_fallback_enabled === false,
  "PROPOSAL_SCOPE",
);
yes(
  proposal.cost.finite_action_estimate_usd_ceiling === 4.25 &&
    proposal.cost.requested_maximum_cumulative_finite_spend_usd === 4.5 &&
    proposal.cost.executable_finite_cap_usd === null &&
    proposal.cost.existing_two_volumes_usd_per_month === 7 &&
    proposal.approval_request.exact_proposal_approved === false &&
    proposal.approval_request.gpu_scope === "exact RTX 4090 only; no fallback",
  "COST_AUTHORITY_GPU",
);
yes(
  preflight.attempt === 64 &&
    preflight.runpod.pods === 0 &&
    preflight.runpod.endpoints === 0 &&
    preflight.runpod.private_templates === 0 &&
    preflight.runpod.active_workers === 0 &&
    preflight.runpod.running_pods === 0 &&
    preflight.runpod.retained_volumes.length === 2 &&
    preflight.runpod.selected_gpu.offering === "NVIDIA GeForce RTX 4090" &&
    preflight.runpod.selected_gpu.availability === "LOW" &&
    preflight.runpod.billing_baseline_usd === 2.095889555552276 &&
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.route_probe_count === 3 &&
    preflight.cloudflare.route_status === 404 &&
    preflight.cloudflare.route_code === "V207_ROUTE_DISABLED" &&
    preflight.cloudflare.signer_present === false &&
    preflight.local_disk.available_bytes === 2427957248 &&
    preflight.local_disk.headroom_gate_satisfied === true &&
    preflight.deadline_mode.automatic_gpu_fallback === false,
  "PREFLIGHT_TRUTH",
);
for (const [config, workers] of [
  [max1, 1],
  [max2, 2],
]) {
  yes(
    config.attempt === 64 &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.gpu === "NVIDIA GeForce RTX 4090" &&
      config.region === "EU-RO-1" &&
      config.source.deadline_mode_admission_commit === expected.commit &&
      config.source.orchestrator_sha256 === expected.orchestrator &&
      config.source.read_only_admission_sha256 === expected.admission &&
      config.expected_old_anchor.version_id_sha256 === expected.version &&
      config.expected_old_anchor.record_sha256 === expected.record &&
      config.admission.full_read_only_before_remote_mutation === true &&
      config.admission.repeat_catalog_and_inventory_before_first_runpod_mutation === true &&
      config.admission.automatic_gpu_fallback === false,
    `CONFIG_${workers}`,
  );
}
yes(
  acceptance.proposal_sha256 === expected.proposal &&
    acceptance.preflight_sha256 === expected.preflight &&
    acceptance.max1_sha256 === expected.max1 &&
    acceptance.max2_sha256 === expected.max2 &&
    acceptance.authority.exact_proposal_approved === false &&
    acceptance.authority.maximum_cumulative_finite_spend_usd === null &&
    acceptance.authority.anchor_refresh_authorized === null &&
    acceptance.deadline_mode_contract.gpu_fallback_enabled === false,
  "ACCEPTANCE",
);
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_POINTER");
yes(/V207_APPROVED_AUTHORITY_SHA256: string \| null =\s*null;/u.test(activation), "AUTHORITY_NULL");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = null;/u.test(activation), "CAP_NULL");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = null;/u.test(activation), "REFRESH_NULL");
const canonical = activation
  .replace(/^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/mu, `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`)
  .replace(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/mu, "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/mu, "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/mu, "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;");
yes(sha(canonical) === expected.canonicalActivation, "CANONICAL_ACTIVATION");
yes(
  orchestrator.indexOf("const preflight = await run") <
      orchestrator.indexOf("if (!rollbackAnchorRefresh.enabled && beforeSecrets.includes") &&
    orchestrator.indexOf("read_only_capacity_admission_completed") <
      orchestrator.indexOf("args: [\"--filter\", \"@videoforge/web\", \"build:staging\"]") &&
    qualification.indexOf("const [freshCatalog, immediatePreMutationInventory]") <
      qualification.indexOf("const harness = new RunPodV207QualificationHarness") &&
    qualification.indexOf("assertV207PreflightInventory(immediatePreMutationInventory)") <
      qualification.indexOf("const harness = new RunPodV207QualificationHarness"),
  "DEADLINE_MODE_SOURCE_ORDER",
);
let authorityExists = true;
try {
  await access(path.join(dir, "approved-authority.json"));
} catch {
  authorityExists = false;
}
yes(authorityExists === false, "UNAPPROVED_AUTHORITY_ABSENT");
process.stdout.write(`PASS validate-v207-attempt64-candidate ${JSON.stringify(expected)}\n`);
