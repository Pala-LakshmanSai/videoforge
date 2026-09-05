import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../..");

async function expectSha256(relativePath, expected) {
  const bytes = await readFile(resolve(root, relativePath));
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== expected) throw new Error(`${relativePath}: ${actual}`);
  return JSON.parse(bytes);
}

const live = await expectSha256(
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/attempt85-live-result.json",
  "sha256:aa1dc5c2c82d36b32992750fad77d4776c1d92e337f539124670b310201f28f8",
);
await expectSha256(
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/attempt85-disposable-orchestrator.json",
  "sha256:cf2a185c566014a263f52169ac52ccfeb67c1f8fa5ac7363a44652022b2873fa",
);
const closure = await expectSha256(
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/success-attempt-85.json",
  "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79",
);

if (live.success !== true || closure.result !== "QUALIFIED_PASS_CLEAN") throw new Error("qualification");
if (closure.qualification.durable_images_verified !== 128 || closure.qualification.max_two_workers !== "PASS") throw new Error("coverage");
if (closure.cleanup.final_zero_compute_reads !== 3 || closure.cleanup.active_serverless_workers !== 0) throw new Error("cleanup");
if (closure.authority_status !== "CONSUMED_NON_REUSABLE" || closure.v2_08_actions !== 0) throw new Error("boundary");

const activation = await readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8");
for (const binding of [
  "V207_APPROVED_AUTHORITY_SHA256: string | null = null",
  "V207_APPROVED_FINITE_CAP_USD: number | null = null",
  "V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null",
]) {
  if (!activation.includes(binding)) throw new Error(`active authority: ${binding}`);
}

console.log("PASS Attempt85 qualified clean, authority consumed, V2-08 untouched");
