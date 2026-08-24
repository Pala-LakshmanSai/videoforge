#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:a8b03557f6e4aa2b38cd17b58d1d62704e126619f1a7378348b72c0fde74734a",
  authority: "sha256:29bef150a23b48d990d7ec76de8e701e4548a417404f09b1836267f55f60106d",
  noGo: "sha256:6eb7575c6cd96ddd04f27e5f672038c482cd32db2861d97c0b4d939960bd65ba",
};
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;
const eq = (actual, wanted, code) => {
  if (actual !== wanted) throw new Error(`V207_ATTEMPT49_PRE_ACTIVATION_NO_GO_${code}`);
};
const yes = (value, code) => {
  if (!value) throw new Error(`V207_ATTEMPT49_PRE_ACTIVATION_NO_GO_${code}`);
};

eq(sha(path.join(dir, "combined-live-proposal.json")), expected.proposal, "PROPOSAL_HASH");
eq(sha(path.join(dir, "approved-authority.json")), expected.authority, "AUTHORITY_HASH");
eq(sha(path.join(dir, "pre-activation-no-go.json")), expected.noGo, "NO_GO_HASH");

const closure = json(path.join(dir, "pre-activation-no-go.json"));
eq(closure.result, "BLOCKED_SUPERSEDED_BEFORE_ACTIVATION_NO_PROVIDER_CALL_NO_SPEND", "RESULT");
eq(closure.approved_lineage.reusable, false, "REUSABLE");
eq(closure.approved_lineage.consumed_by_execution, false, "EXECUTION_CONSUMPTION");
eq(closure.approved_lineage.invalidated_before_activation, true, "INVALIDATION");
eq(closure.pre_activation_no_go.provider_calls_after_approval, 0, "PROVIDER_CALLS");
eq(closure.pre_activation_no_go.provider_mutations_after_approval, 0, "PROVIDER_MUTATIONS");
eq(closure.pre_activation_no_go.gpu_jobs_submitted_after_approval, 0, "GPU_JOBS");
eq(closure.pre_activation_no_go.external_spend_usd_after_approval, 0, "SPEND");
eq(closure.pre_activation_no_go.protected_config_written, false, "CONFIG_WRITE");
eq(closure.pre_activation_no_go.retained_volume_written_or_mutated, false, "VOLUME_WRITE");
eq(closure.executable_activation_at_no_go.approved_authority_sha256, null, "ACTIVATION_AUTHORITY");
eq(closure.executable_activation_at_no_go.approved_finite_cap_usd, null, "ACTIVATION_CAP");
eq(closure.successor_boundary.attempt49_authority_or_cap_reuse_forbidden, true, "NO_REUSE");
eq(closure.successor_boundary.v2_08_authorized, false, "V208");

const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null =\n  null;"), "LIVE_AUTHORITY_NULL");
yes(activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;"), "LIVE_CAP_NULL");
yes(activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;"), "LIVE_REFRESH_NULL");

for (const file of ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/tasks/VF-10-07.md"]) {
  const value = text(path.join(root, file));
  yes(value.includes(expected.noGo), `${file}_NO_GO_POINTER`);
}
yes(text(path.join(root, "project-context/00_START_HERE.md")).includes("sha256:6eb7575c…65ba"), "START_NO_GO_POINTER");
const state = text(path.join(root, "project-context/CURRENT_STATE.yaml"));
yes(state.includes("provider_calls_authorized: false"), "STATE_PROVIDER_OFF");
yes(state.includes("gpu_use_authorized: false"), "STATE_GPU_OFF");
yes(state.includes("maximum_external_spend_usd: 0"), "STATE_SPEND_ZERO");

console.log("PASS validate-v207-attempt49-pre-activation-no-go", JSON.stringify(expected));
