import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(".");
const entry = path.resolve("packages/control-plane/src/global-session/production-composition.ts");
const publicIndex = path.resolve("packages/control-plane/src/global-session/index.ts");
const allowedExternalImports = new Set(["@videoforge/contracts"]);
const failures = [];
const graph = new Set();
const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
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

function display(file) {
  return path.relative(repositoryRoot, file);
}

async function resolveRelativeImport(importer, specifier) {
  const unresolved = path.resolve(path.dirname(importer), specifier);
  const candidates = specifier.endsWith(".js")
    ? [unresolved.slice(0, -3) + ".ts", unresolved.slice(0, -3) + ".tsx"]
    : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, path.join(unresolved, "index.ts")];
  for (const candidate of candidates) {
    try {
      const source = await readFile(candidate, "utf8");
      return { file: candidate, source };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  failures.push(`unresolved production import from ${display(importer)}: ${specifier}`);
  return null;
}

async function visit(file, suppliedSource) {
  if (graph.has(file)) return;
  graph.add(file);
  const source = suppliedSource ?? (await readFile(file, "utf8"));
  if (/\b(?:require\s*\(|import\s*\()/u.test(source)) {
    failures.push(`dynamic module loading forbidden in production graph: ${display(file)}`);
  }
  for (const token of forbiddenSourceTokens) {
    if (source.includes(token)) {
      failures.push(`production graph contains forbidden token in ${display(file)}: ${token}`);
    }
  }
  const imports = [...source.matchAll(importPattern)].map((match) => match[1]);
  for (const specifier of imports) {
    if (!specifier.startsWith(".")) {
      if (!allowedExternalImports.has(specifier)) {
        failures.push(
          `production graph imports forbidden dependency in ${display(file)}: ${specifier}`,
        );
      }
      continue;
    }
    const resolved = await resolveRelativeImport(file, specifier);
    if (resolved !== null) await visit(resolved.file, resolved.source);
  }
}

async function sourceFiles(root) {
  const files = [];
  for (const entryName of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entryName.name);
    if (entryName.isDirectory()) {
      if (!["dist", "node_modules"].includes(entryName.name))
        files.push(...(await sourceFiles(absolute)));
    } else if (/\.(?:ts|tsx|js|mjs)$/u.test(entryName.name)) {
      files.push(absolute);
    }
  }
  return files;
}

await visit(entry);

const indexSource = await readFile(publicIndex, "utf8");
if (indexSource.includes('"./production-dispatch.js"')) {
  failures.push(
    "public global-session index must not export the injectable firewall implementation",
  );
}
if (!indexSource.includes('"./production-composition.js"')) {
  failures.push("public global-session index must export the canonical production composition");
}

for (const root of ["apps", "workers", "packages"].map((directory) => path.resolve(directory))) {
  for (const file of await sourceFiles(root)) {
    if (graph.has(file) || file.includes(`${path.sep}tests${path.sep}`)) continue;
    const source = await readFile(file, "utf8");
    if (
      source.includes("VNextPodDispatchFirewall") ||
      source.includes("global-session/production-dispatch")
    ) {
      failures.push(
        `injectable firewall referenced outside canonical production graph: ${display(file)}`,
      );
    }
  }
}

if (graph.size < 2)
  failures.push("production graph must include composition and validated dispatch boundary");

if (failures.length > 0) {
  console.error(`vNext dispatch firewall failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `vNext production graph verified (${graph.size} files): canonical composition only; paid provider port disabled; legacy tokens unreachable.`,
);
