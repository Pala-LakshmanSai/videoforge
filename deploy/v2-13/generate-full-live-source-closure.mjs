import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = "deploy/v2-13/full-live-source-closure.json";
const DIRECTORY_ROOTS = Object.freeze([
  ".github/workflows",
  "apps/web/src",
  "apps/web/worker",
  "apps/web/public",
  "packages/config/src",
  "packages/contracts/generated",
  "packages/control-plane/src",
  "packages/contracts/src",
  "packages/pipeline/src",
  "packages/provider-sandbox/src",
  "packages/test-fixtures/src",
  "packages/control-plane/migrations",
  "workers/avatar-primary",
  "workers/image-media",
]);
const EXACT_FILES = Object.freeze([
  "apps/web/index.html",
  "apps/web/package.json",
  "apps/web/postcss.config.cjs",
  "apps/web/tailwind.config.ts",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.worker.json",
  "apps/web/vite.cloudflare.config.ts",
  "apps/web/vite.config.ts",
  "apps/web/wrangler.production.jsonc",
  "deploy/v2-06/backup.sh",
  "deploy/v2-06/neon-runtime-grants.sql",
  "deploy/v2-06/restore-drill.sh",
  "deploy/v2-06/validate-pg-service.mjs",
  "deploy/v2-13/full-live-adapters.mjs",
  "deploy/v2-13/build-materialization-seed.mjs",
  "deploy/v2-13/generate-mage-qualification-case.d.mts",
  "deploy/v2-13/generate-mage-qualification-case.mjs",
  "deploy/v2-13/generate-soulx-qualification-cases.d.mts",
  "deploy/v2-13/generate-soulx-qualification-cases.mjs",
  "deploy/v2-13/guarded-activation.mjs",
  "deploy/v2-13/launch-full-live.mjs",
  "deploy/v2-13/media-worker-release-readback.mjs",
  "deploy/v2-13/neon-full-live-operator-grants.sql",
  "deploy/v2-13/neon-pair-reconciler-grants.sql",
  "deploy/v2-13/promote-qualified-production.mjs",
  "deploy/v2-13/render-production-config.mjs",
  "deploy/v2-13/validate-materialization-seed-production-input.mts",
  "deploy/v2-13/validate-production-config.mjs",
  "package.json",
  "packages/config/package.json",
  "packages/control-plane/package.json",
  "packages/contracts/package.json",
  "packages/pipeline/package.json",
  "packages/provider-sandbox/package.json",
  "packages/test-fixtures/package.json",
  "project-context/evidence/serverless_worker_job_envelope_v3.schema.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/verify-v2-05-production-bundle.mjs",
  "tsconfig.base.json",
  "turbo.json",
]);
const INCLUDED =
  /\.(?:cjs|css|html|json|jsonc|mjs|mts|patch|py|sql|svg|toml|ts|tsx|txt|yaml|yml)$/u;
const EXCLUDED = /(?:^|\/)(?:__pycache__|__tests__|tests)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/u;

function collect(directory) {
  const result = [];
  for (const entry of readdirSync(resolve(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...collect(path));
    else if (
      entry.isFile() &&
      (INCLUDED.test(path) ||
        entry.name.startsWith("Dockerfile") ||
        entry.name === ".python-version") &&
      !EXCLUDED.test(path)
    )
      result.push(path);
  }
  return result;
}

const paths = [...new Set([...DIRECTORY_ROOTS.flatMap(collect), ...EXACT_FILES])].sort();
for (const path of paths) {
  const absolute = resolve(ROOT, path);
  if (!statSync(absolute).isFile() || relative(ROOT, absolute).startsWith(".."))
    throw new Error(`SOURCE_CLOSURE_PATH_INVALID:${path}`);
}
const entries = paths.map((path) => ({
  path,
  sha256: `sha256:${createHash("sha256")
    .update(readFileSync(resolve(ROOT, path)))
    .digest("hex")}`,
}));
writeFileSync(
  resolve(ROOT, OUTPUT),
  `${JSON.stringify(
    {
      schema_version: "videoforge.v2-13-full-live-source-closure/v1",
      entries,
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o644 },
);
