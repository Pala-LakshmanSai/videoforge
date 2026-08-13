import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("packages/control-plane/src/global-session/production-dispatch.ts");
const source = await readFile(root, "utf8");
const failures = [];
const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
const imports = [...source.matchAll(importPattern)].map((match) => match[1]);
const allowedImports = new Set(["@videoforge/contracts"]);

for (const specifier of imports) {
  if (!allowedImports.has(specifier)) {
    failures.push(`production dispatch imports forbidden dependency: ${specifier}`);
  }
}

if (!imports.includes("@videoforge/contracts")) {
  failures.push("production dispatch must validate the canonical vNext contract");
}

const forbiddenSourceTokens = [
  "/run",
  "endpoint_id",
  "workersMin",
  "workersMax",
  "RUNPOD_SERVERLESS",
  "runpod-serverless",
  'selected_gpu_sku: "Auto"',
  "AvatarForcing",
  "MuseTalk",
  "SkyReels",
  "repair",
  "fallback",
  "worker_registry",
];

for (const token of forbiddenSourceTokens) {
  if (source.includes(token))
    failures.push(`production dispatch contains forbidden token: ${token}`);
}

if (failures.length > 0) {
  console.error(`vNext dispatch firewall failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  "vNext production dispatch imports only canonical contracts; legacy paid-dispatch tokens are unreachable.",
);
