import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const hash = async (name) =>
  `sha256:${createHash("sha256").update(await readFile(join(dir, name))).digest("hex")}`;
const json = async (name) => JSON.parse(await readFile(join(dir, name), "utf8"));

const expected = {
  proposal: "sha256:5a61facbadeb460ee8dff2072a9c5c54abccd0267c60f1cefbb5aad2194a0e4b",
  preflight: "sha256:94e84a0ee7abe1d880b723782e5129b341176ee7655d58a20391c5c2e88618f3",
  orchestrator: "sha256:5298ec25000e42affb7e36b518b778fa692e65b72d868087d58fbd81e6cfc42c",
};
const [proposal, preflight, acceptance] = await Promise.all([
  json("combined-live-proposal.json"),
  json("read-only-preflight.json"),
  json("acceptance.json"),
]);
const actual = {
  proposal: await hash("combined-live-proposal.json"),
  preflight: await hash("read-only-preflight.json"),
};
const failures = [];
for (const key of ["proposal", "preflight"]) {
  if (actual[key] !== expected[key]) failures.push(`${key.toUpperCase()}_HASH_MISMATCH`);
}
if (proposal.approval_request?.requested_maximum_cumulative_finite_spend_usd !== 4)
  failures.push("CAP_NOT_EXACT_4");
if (proposal.approval_request?.executable_cap_binding !== null)
  failures.push("CAP_PREMATURELY_EXECUTABLE");
if (proposal.approval_request?.anchor_refresh_mode !== "two-phase-v1")
  failures.push("ANCHOR_REFRESH_MODE_MISMATCH");
if (proposal.fresh_catalog_read_only_truth?.availability !== "LOW")
  failures.push("AVAILABILITY_MISMATCH");
if (proposal.fresh_catalog_read_only_truth?.flashboot !== true)
  failures.push("FLASHBOOT_NOT_TRUE");
if (proposal.cost?.existing_two_50gb_volumes_usd_per_month !== 7)
  failures.push("VOLUME_RETENTION_RATE_MISMATCH");
if (proposal.provider_free_lineage?.orchestrator_source_sha256 !== expected.orchestrator)
  failures.push("ORCHESTRATOR_HASH_MISMATCH");
if (preflight.cloudflare?.exact_route_probe?.matches_active_version !== true)
  failures.push("VERSION_BOUND_DISABLED_ROUTE_UNPROVEN");
if (preflight.runpod?.pods !== 0 || preflight.runpod?.endpoints !== 0 || preflight.runpod?.running_pods !== 0)
  failures.push("RUNPOD_ZERO_COMPUTE_UNPROVEN");
if (preflight.runpod?.retained_volume_count !== 2)
  failures.push("RETAINED_VOLUME_COUNT_MISMATCH");
if (acceptance.qualification_status !== "NOT_QUALIFIED" || acceptance.v2_08_started !== false)
  failures.push("CHECKPOINT_BOUNDARY_MISMATCH");
if (failures.length) {
  console.error(`FAIL validate-v207-attempt54-version-bound-rollback-candidate ${failures.join(",")}`);
  process.exitCode = 1;
} else {
  console.log("PASS validate-v207-attempt54-version-bound-rollback-candidate");
}
