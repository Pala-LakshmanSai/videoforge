import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const bundleDirectory = process.env.VIDEOFORGE_BUNDLE_DIR ?? "dist-cloudflare";
if (!/^dist-[a-z0-9-]+$/u.test(bundleDirectory)) throw new Error("Invalid bundle directory.");
const root = path.join(repositoryRoot, "apps/web", bundleDirectory);
const wranglerConfig = process.env.VIDEOFORGE_WRANGLER_CONFIG ?? "wrangler.production.jsonc";
if (!new Set(["wrangler.production.jsonc", "wrangler.staging.jsonc"]).has(wranglerConfig))
  throw new Error("Invalid Wrangler bundle-verification config.");
const productionConfigPath = path.join(repositoryRoot, "apps/web", wranglerConfig);
const productionEntryPath = path.join(repositoryRoot, "apps/web/worker/production-index.ts");
const hostedAppPath = path.join(repositoryRoot, "apps/web/src/server/hosted/app.ts");
// Accepted provider-free route-split builds after the exact attempt-bound cancellation contract.
// Production is a 187-byte virtual entry plus its 2,718,086-byte shared chunk; staging is the same
// entry plus its 2,747,272-byte shared chunk.
// These are deliberately exact per-target no-growth ceilings, not platform limits.
const staticWorkerEntryAcceptedBytes = Object.freeze({
  "wrangler.production.jsonc": 2_718_273,
  "wrangler.staging.jsonc": 2_747_459,
})[wranglerConfig];
const workerForbidden = [
  "@videoforge/test-fixtures",
  "packages/test-fixtures",
  "FakeServerlessEndpoint",
  "FakeServerlessTransport",
  "fixture-router",
  "fixture-routes",
  "fixture-route",
  "/api/v1/shared-app",
  "cp05-fixture-control-v1",
  "fixture-pod-",
  "canSelectGpuPair",
  "selectedGpuSku",
  "startPod",
  "createPod",
  "stopPod",
  "deletePod",
  "terminatePod",
  "updatePod",
  "RunPodPodClient",
  "purge-queue",
  "/workspace/models",
  "NVIDIA RTX A6000",
  "legacy_compatibility_fixture",
];
const clientForbidden = [
  "/api/dev/shared-app/invites",
  "/api/v2/auth/fixture",
  "x-videoforge-fixture-session",
  "?fixture=",
  "issueFixtureInvite",
  "authenticateFixture",
  "fixture_id",
  "fixture_voiceover",
  "@videoforge/test-fixtures",
  "packages/test-fixtures",
  "FakeServerlessEndpoint",
  "FakeServerlessTransport",
  "fixture-router",
  "fixture-routes",
  "fixture-route",
  "/fixtures/",
  "/api/v1/shared-app",
  "cp05-fixture-control-v1",
  "fixture-pod-",
  "canSelectGpuPair",
  "selectedGpuSku",
  "startPod",
  "createPod",
  "stopPod",
  "deletePod",
  "terminatePod",
  "updatePod",
  "RunPodPodClient",
  "gpuTypeIds",
  "NVIDIA RTX A6000",
  "NVIDIA GeForce RTX 4090",
  "avatar_repair_profile_id",
  "echo_avatar",
];

const productionConfigSource = await readFile(productionConfigPath, "utf8");
const productionConfig = JSON.parse(
  productionConfigSource.replace(/^\s*\/\/.*$/gmu, "").replace(/,\s*([}\]])/gu, "$1"),
);
if (!/^[a-z][a-z0-9-]{2,62}$/u.test(productionConfig.name)) {
  throw new Error("Production Worker name must be one exact Wrangler name.");
}
const emittedWorkerDirectory = productionConfig.name.replaceAll("-", "_");

// The deployable entry and route owner must remain a hosted-only graph. Canonical hosted schemas
// and exact server-side qualification or authority-bound endpoint-policy readback may appear in
// the Worker, so source reachability is a stronger boundary than banning provider field names from
// all emitted server code. The client bundle still forbids GPU vocabulary and the Worker still
// forbids Pod lifecycle, queue purge, and any user-facing GPU/pod route.
const productionEntrySource = await readFile(productionEntryPath, "utf8");
const productionImports = [
  ...productionEntrySource.matchAll(
    /^\s*(?:import|export)\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["'];?\s*$/gmu,
  ),
].map((match) => match[1]);
const expectedProductionImports = [
  "../src/server/hosted/app",
  "../src/server/hosted/configuration",
  "../src/server/hosted/retention",
  "./hosted-workflow",
  "./hosted-pair-workflow",
];
const hostedAppSource = await readFile(hostedAppPath, "utf8");
const hostedPromptRouteImport = 'import("./hosted-prompt-route")';
const hostedProductImport = 'import("./product")';
const hostedPromptRouteImportOffset = hostedAppSource.indexOf(hostedPromptRouteImport);
const hostedProductImportOffset = hostedAppSource.indexOf(hostedProductImport);
const forbiddenProductionSource = [
  "shared-app-fixture",
  "src/server/local",
  "/local/",
  "node-video-runtime",
  "@videoforge/test-fixtures",
  "/api/dev/",
  "/api/v1/shared-app",
  "/api/v2/pods",
  "/api/v2/gpu",
];

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)));
    else files.push(absolute);
  }
  return files;
}

const failures = [];
if (
  hostedPromptRouteImportOffset < 0 ||
  hostedProductImportOffset < 0 ||
  hostedPromptRouteImportOffset > hostedProductImportOffset
) {
  failures.push(
    "production hosted route owner must dynamically route hosted-prompt-route before product",
  );
}
if (
  JSON.stringify([...productionImports].sort()) !==
  JSON.stringify([...expectedProductionImports].sort())
) {
  failures.push("production Worker entry imports are not the exact hosted-only graph");
}
for (const token of forbiddenProductionSource) {
  if (productionEntrySource.includes(token) || hostedAppSource.includes(token)) {
    failures.push(`production Worker source or route owner exposes ${token}`);
  }
}
for (const route of [
  'url.pathname === "/api/v2/hosted/status"',
  'url.pathname === "/api/v2/tenant"',
  'url.pathname === "/api/v2/library"',
  'url.pathname === "/api/v2/hosted/queue"',
  'url.pathname === "/api/v2/cpu-attempts"',
]) {
  if (!hostedAppSource.includes(route))
    failures.push(`production hosted route owner lacks ${route}`);
}
let workerCodeFiles = 0;
let clientCodeFiles = 0;
const emittedFiles = await filesBelow(root);
for (const file of emittedFiles) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative.startsWith("client/fixtures/")) {
    failures.push(`${file} is an emitted production fixture asset`);
  }
  if (!/\.(?:js|mjs|map)$/u.test(file)) continue;
  const workerFile = relative.startsWith(`${emittedWorkerDirectory}/`);
  const clientFile = relative.startsWith("client/");
  if (!workerFile && !clientFile) continue;
  if (/\.(?:js|mjs)$/u.test(file)) {
    if (workerFile) workerCodeFiles += 1;
    if (clientFile) clientCodeFiles += 1;
  }
  const emittedName = path.basename(file);
  if (/fixture-(?:link|route)|fixture(?:route|router)/iu.test(emittedName)) {
    failures.push(`${file} is a fixture route/support module`);
  }
  const source = await readFile(file, "utf8");
  const tokens = workerFile ? workerForbidden : clientForbidden;
  for (const token of tokens) {
    if (source.includes(token)) failures.push(`${file} contains ${token}`);
  }
}

const workerManifestPath = path.join(root, emittedWorkerDirectory, ".vite/manifest.json");
try {
  const workerManifest = JSON.parse(await readFile(workerManifestPath, "utf8"));
  const staticEntryKeys = Object.entries(workerManifest)
    .filter(([, value]) => value.isEntry === true)
    .map(([key]) => key);
  const staticallyReachable = new Set();
  const pending = [...staticEntryKeys];
  while (pending.length > 0) {
    const key = pending.pop();
    if (typeof key !== "string" || staticallyReachable.has(key)) continue;
    staticallyReachable.add(key);
    for (const importedKey of workerManifest[key]?.imports ?? []) pending.push(importedKey);
  }
  const eagerValidatorKeys = [...staticallyReachable].filter((key) =>
    /contract-validators/iu.test(`${key} ${workerManifest[key]?.file ?? ""}`),
  );
  if (eagerValidatorKeys.length > 0) {
    failures.push("precompiled contract validators are statically reachable from the Worker entry");
  }
  const manifestFileBytes = async (key) => {
    const file = workerManifest[key]?.file;
    if (typeof file !== "string") return Number.POSITIVE_INFINITY;
    return (await readFile(path.join(root, emittedWorkerDirectory, file))).byteLength;
  };
  const staticWorkerBytes = (
    await Promise.all([...staticallyReachable].map((key) => manifestFileBytes(key)))
  ).reduce((total, bytes) => total + bytes, 0);
  if (
    !Number.isSafeInteger(staticWorkerBytes) ||
    staticWorkerBytes > staticWorkerEntryAcceptedBytes
  ) {
    failures.push(
      `static Worker-entry closure exceeds the accepted no-growth baseline of ${staticWorkerEntryAcceptedBytes} bytes`,
    );
  }

  const hostedPromptRouteKey = Object.keys(workerManifest).find((key) =>
    /(?:^|\/)hosted-prompt-route\.ts$/u.test(key),
  );
  if (!hostedPromptRouteKey || workerManifest[hostedPromptRouteKey]?.isDynamicEntry !== true) {
    failures.push("Stage 5 lacks its dedicated hosted-prompt-route dynamic entry");
  } else {
    // A dynamic route may statically share the Worker entry. Only modules newly loaded for the
    // prompt request count toward its incremental closure; do not follow unrelated dynamic edges
    // back out of a shared entry chunk.
    const promptReachable = new Set();
    const incrementalPromptClosure = new Set();
    const promptPending = [hostedPromptRouteKey];
    while (promptPending.length > 0) {
      const key = promptPending.pop();
      if (typeof key !== "string" || promptReachable.has(key)) continue;
      promptReachable.add(key);
      const isStatic = staticallyReachable.has(key);
      if (!isStatic) incrementalPromptClosure.add(key);
      // Shared static chunks can advertise unrelated route-level dynamic imports. Inspect the
      // shared chunk and all of its eager imports for forbidden dependencies, but do not mistake
      // its unrelated dynamic routes for dependencies of the prompt request.
      const reachableImports = [
        ...(workerManifest[key]?.imports ?? []),
        ...(isStatic ? [] : (workerManifest[key]?.dynamicImports ?? [])),
      ];
      for (const importedKey of reachableImports) {
        promptPending.push(importedKey);
      }
    }
    const forbiddenPromptClosure = [...promptReachable].filter((key) => {
      const identities = [key, workerManifest[key]?.file ?? ""];
      return identities.some((identity) => {
        const basename = path.posix.basename(identity);
        const broadProduct =
          basename === "product.ts" || /^_?product(?:-[A-Za-z0-9_-]+)?\.js$/iu.test(basename);
        return (
          broadProduct ||
          /contract-validators|generation-coordinator/iu.test(identity) ||
          /(?:^|[/_-])(?:style|audio|context)(?:[/_-]|\.)/iu.test(identity)
        );
      });
    });
    if (forbiddenPromptClosure.length > 0) {
      failures.push(
        `Stage 5 prompt closure reaches forbidden broad modules: ${forbiddenPromptClosure.join(", ")}`,
      );
    }
    const incrementalPromptBytes = (
      await Promise.all([...incrementalPromptClosure].map((key) => manifestFileBytes(key)))
    ).reduce((total, bytes) => total + bytes, 0);
    if (!Number.isSafeInteger(incrementalPromptBytes) || incrementalPromptBytes > 256 * 1024) {
      failures.push("Stage 5 incremental prompt closure exceeds the 256 KiB CPU-safety bound");
    }
  }
  const hostedGenerationValidatorKey = Object.keys(workerManifest).find((key) =>
    /hosted-generation-contract-validators/iu.test(`${key} ${workerManifest[key]?.file ?? ""}`),
  );
  const coordinatorEntry = Object.values(workerManifest).find((value) =>
    /generation-coordinator/iu.test(value.file ?? ""),
  );
  if (
    !hostedGenerationValidatorKey ||
    !coordinatorEntry?.dynamicImports?.includes(hostedGenerationValidatorKey)
  ) {
    failures.push("planning does not dynamically import its bounded contract-validator shard");
  } else {
    const validatorAsset = workerManifest[hostedGenerationValidatorKey]?.file;
    if (
      typeof validatorAsset !== "string" ||
      (await readFile(path.join(root, emittedWorkerDirectory, validatorAsset))).byteLength >
        512 * 1024
    ) {
      failures.push("planning contract-validator shard exceeds the 512 KiB CPU-safety bound");
    }
  }
} catch {
  failures.push(`${workerManifestPath} is not a readable Worker manifest`);
}

if (workerCodeFiles === 0) {
  failures.push(`${root} contained no production Worker emitted code`);
}
if (clientCodeFiles === 0) {
  failures.push(`${root} contained no production client emitted code`);
}
for (const required of [
  `${emittedWorkerDirectory}/index.js`,
  `${emittedWorkerDirectory}/.vite/manifest.json`,
  "client/index.html",
  "client/.vite/manifest.json",
]) {
  try {
    await access(path.join(root, required));
  } catch {
    failures.push(`${root} is missing required production entry ${required}`);
  }
}

if (failures.length > 0) {
  console.error(`V2-05 production bundle quarantine failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("V2-05 production worker and client bundles contain no superseded routing vocabulary.");
