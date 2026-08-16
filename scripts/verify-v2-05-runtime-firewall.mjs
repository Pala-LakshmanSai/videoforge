import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * V2-05 runtime firewall.
 *
 * The cutover runtime — per-video stage state, fair admission, and Serverless v3 lane dispatch —
 * must be reachable without touching any superseded contract. This scan proves the active runtime
 * graph names no global session, Pod lifecycle, user GPU selector, shared catalog, broad object
 * key, or compatibility-fixture escape hatch, and that the database fence covers every superseded
 * table the migration registers.
 */
const failures = [];

const ACTIVE_RUNTIME_FILES = [
  "packages/control-plane/src/runtime/video-runtime.ts",
  "packages/control-plane/src/runtime/index.ts",
  "apps/web/src/server/runtime/node-video-runtime.ts",
];

const SUPERSEDED_TABLES = [
  "generation_sessions",
  "session_gpu_bindings",
  "session_gpu_revalidations",
  "global_queue_entries",
  "compute_run_plans",
  "pod_lifecycle_attempts",
  "pod_dispatch_authorizations",
  "durable_generation_outputs",
];

/** Superseded runtime vocabulary. None of it may appear in the active V2-05 runtime graph. */
const FORBIDDEN_RUNTIME_TOKENS = [
  ...SUPERSEDED_TABLES,
  "gpuPair",
  "gpu_pair",
  "podId",
  "pod_id",
  "startPod",
  "deletePod",
  "Start Pod",
  "Stop Pod",
  "Delete Pod",
  "purge-queue",
  "purgeQueue",
  "/workspace/models",
  "selected_gpu_sku",
  "echo_avatar",
  "legacy_compatibility_fixture",
  "AvatarForcing",
  "MuseTalk",
  "SkyReels",
  "EchoMimic",
];

/** Only these files may replay superseded Pod-era evidence, and only inside tests. */
const COMPATIBILITY_ALLOWLIST = [
  "packages/control-plane/src/global-session/repository.ts",
  "packages/control-plane/src/global-session/production-dispatch.ts",
  "packages/control-plane/src/backup/metadata-snapshot.ts",
  "packages/control-plane/src/database/vocabulary.ts",
];

async function filesBelow(root, extensions = /\.(?:ts|tsx|mjs|js)$/u) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (["node_modules", "dist", ".turbo"].includes(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute, extensions)));
    else if (extensions.test(entry.name)) files.push(absolute);
  }
  return files;
}

for (const file of ACTIVE_RUNTIME_FILES) {
  const source = await readFile(file, "utf8");
  for (const token of FORBIDDEN_RUNTIME_TOKENS) {
    if (source.includes(token)) {
      failures.push(`${file} names superseded runtime vocabulary: ${token}`);
    }
  }
}

// Every tenant object key the runtime derives must stay inside the exact tenant lineage prefix.
const nodeRuntime = await readFile("apps/web/src/server/runtime/node-video-runtime.ts", "utf8");
if (!nodeRuntime.includes("`tenant/${scope.accountId}/workspace/${scope.workspaceId}")) {
  failures.push("the active runtime must derive object keys from trusted tenant lineage only");
}
if (/["'`]tenant\/\*|["'`]\*\//u.test(nodeRuntime)) {
  failures.push("the active runtime must never use a broad object key pattern");
}

// The migration must fence every superseded contract it registers.
const migration = await readFile(
  "packages/control-plane/migrations/0028_v2_05_runtime_cutover.sql",
  "utf8",
);
for (const table of SUPERSEDED_TABLES) {
  if (!migration.includes(`('${table}',`)) {
    failures.push(`migration 0028 does not register superseded contract ${table}`);
  }
}
if (!migration.includes("videoforge_fence_superseded_runtime_contract")) {
  failures.push("migration 0028 must install the superseded-contract write fence");
}

// No production source outside the explicit compatibility allowlist may write a superseded table.
const productionRoots = ["apps/web/src", "packages/control-plane/src", "packages/pipeline/src"];
for (const root of productionRoots) {
  for (const file of await filesBelow(root)) {
    if (/\.(?:test|spec)\.[^.]+$/u.test(file)) continue;
    const relative = path.relative(".", file);
    if (COMPATIBILITY_ALLOWLIST.includes(relative)) continue;
    const source = await readFile(file, "utf8");
    for (const table of SUPERSEDED_TABLES) {
      if (new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM)\\s+${table}\\b`, "iu").test(source)) {
        failures.push(`${relative} writes superseded contract ${table}`);
      }
    }
  }
}

// Every superseded global-session surface must be gated behind explicit fixture control, so no
// ordinary production route, flag, or UI action can reach one.
const sharedAppRoutes = await readFile("apps/web/src/server/routes/shared-app-routes.ts", "utf8");
const SUPERSEDED_ROUTES = [
  'app.get("/api/v1/shared-app"',
  'app.post("/api/v1/shared-app/cancel"',
  'app.post("/api/v1/shared-app/advance"',
  'app.get("/api/v1/shared-app/projects/:projectId"',
  'app.get("/api/v1/shared-app/projects/:projectId/download"',
  'app.patch("/api/v1/shared-app/queue/:entryId"',
  'app.delete("/api/v1/shared-app/queue/:entryId"',
];
for (const route of SUPERSEDED_ROUTES) {
  const start = sharedAppRoutes.indexOf(route);
  if (start < 0) continue;
  const body = sharedAppRoutes.slice(start, start + 400);
  if (!body.includes("supersededSurface(c)")) {
    failures.push(`superseded route is reachable without fixture control: ${route}`);
  }
}
if (!sharedAppRoutes.includes("function supersededSurface(")) {
  failures.push("the superseded-surface gate is missing from the shared application routes");
}

// The compatibility escape hatch may never be set by application code.
for (const root of productionRoots) {
  for (const file of await filesBelow(root)) {
    const source = await readFile(file, "utf8");
    if (path.relative(".", file) === "packages/control-plane/src/database/vocabulary.ts") continue;
    if (source.includes("videoforge.legacy_compatibility_fixture")) {
      failures.push(`${path.relative(".", file)} sets the compatibility-fixture escape hatch`);
    }
  }
}

if (failures.length > 0) {
  console.error(`V2-05 runtime firewall failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `V2-05 runtime firewall verified (${String(ACTIVE_RUNTIME_FILES.length)} active runtime files, ${String(SUPERSEDED_TABLES.length)} fenced superseded contracts, ${String(SUPERSEDED_ROUTES.length)} fixture-gated superseded routes): no global session, Pod lifecycle, GPU selector, broad key, or compatibility escape hatch is reachable from ordinary production paths.`,
);
