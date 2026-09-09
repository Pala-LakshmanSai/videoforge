import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hashV209DryOutputBundle } from "./dry-output-bundle.mjs";
import {
  ACTIVATED_ASSETS_PATH,
  ACTIVATED_MAIN_PATH,
  parseProductionConfig,
  validateProductionConfig,
} from "../v2-13/validate-production-config.mjs";
import {
  MAGE_IMAGE_DIGEST,
  MAGE_QUALIFICATION_SHA256,
  ROOT,
  sha256,
  SOULX_IMAGE_DIGEST,
  SOULX_QUALIFICATION_SHA256,
  TEMPLATE_PATH,
  validatePreparationBinding,
  validateQualifiedRenderedConfig,
  validateReleaseManifest,
} from "./validate-qualified-production-config.mjs";

const fail = (message) => {
  throw new Error(`V2-09 qualified production config renderer: ${message}`);
};

export async function bundleQualifiedWorker(mainPath = ACTIVATED_MAIN_PATH) {
  let phase = "V2_09_RENDER_WORKER_RESOLVE_FAILED";
  const temporaryPath = `${mainPath}.v209-single-file.tmp`;
  let temporaryOwned = false;
  try {
    const webRequire = createRequire(resolve(ROOT, "apps/web/package.json"));
    const viteRequire = createRequire(webRequire.resolve("vite"));
    const { buildSync } = viteRequire("esbuild");
    phase = "V2_09_RENDER_WORKER_BUILD_FAILED";
    const result = buildSync({
      entryPoints: [mainPath],
      bundle: true,
      write: false,
      metafile: true,
      platform: "neutral",
      format: "esm",
      target: "es2022",
      external: ["node:*", "cloudflare:*"],
      outfile: mainPath,
      logLevel: "silent",
      allowOverwrite: true,
    });
    phase = "V2_09_RENDER_WORKER_OUTPUT_COUNT_FAILED";
    const outputs = Object.values(result.metafile.outputs);
    if (result.outputFiles.length !== 1 || outputs.length !== 1) throw new Error(phase);
    phase = "V2_09_RENDER_WORKER_IMPORTS_FAILED";
    if (
      outputs[0].imports.some(
        ({ path, external }) => !external || !/^(node:|cloudflare:)/u.test(path),
      )
    )
      throw new Error(phase);
    phase = "V2_09_RENDER_WORKER_EXPORTS_FAILED";
    if (
      ["default", "HostedVideoWorkflow", "HostedPairWorkflow"].some(
        (name) => !outputs[0].exports.includes(name),
      )
    )
      throw new Error(phase);
    phase = "V2_09_RENDER_WORKER_WRITE_FAILED";
    await writeFile(temporaryPath, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
    temporaryOwned = true;
    phase = "V2_09_RENDER_WORKER_RENAME_FAILED";
    await rename(temporaryPath, mainPath);
  } catch {
    throw new Error(phase);
  } finally {
    if (temporaryOwned) await rm(temporaryPath, { force: true });
  }
}

export const V209_RENDER_FAILURE_CODES = Object.freeze([
  "V2_09_RENDER_CONFIG_FAILED",
  "V2_09_RENDER_DEPENDENCIES_FAILED",
  "V2_09_RENDER_BUILD_FAILED",
  "V2_09_RENDER_WORKER_MODULE_CLOSURE_FAILED",
  "V2_09_RENDER_WORKER_RESOLVE_FAILED",
  "V2_09_RENDER_WORKER_BUILD_FAILED",
  "V2_09_RENDER_WORKER_OUTPUT_COUNT_FAILED",
  "V2_09_RENDER_WORKER_IMPORTS_FAILED",
  "V2_09_RENDER_WORKER_EXPORTS_FAILED",
  "V2_09_RENDER_WORKER_WRITE_FAILED",
  "V2_09_RENDER_WORKER_RENAME_FAILED",

  "V2_09_RENDER_WRANGLER_DRY_RUN_FAILED",
  "V2_09_RENDER_BUNDLE_FAILED",
]);
export function safeV209RenderFailureCode(error) {
  return V209_RENDER_FAILURE_CODES.includes(error?.message)
    ? error.message
    : "V2_09_RENDER_CONFIG_FAILED";
}

function renderPhase(code, operation) {
  try {
    const result = operation();
    if (result && typeof result === "object" && (result.error || result.status !== 0))
      throw new Error(code);
    return result;
  } catch {
    // Never retain child stdout, stderr, paths, or an arbitrary error cause.
    throw new Error(code);
  }
}

const defaultRunner = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) throw new Error("V2_09_RENDER_CONFIG_FAILED");
  return result;
};

const mode0600 = async (path, label) => {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    fail(`${label} must be a regular mode-0600 file`);
};

const outsideRepository = (path, label) => {
  const rel = relative(ROOT, path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
    fail(`${label} must be outside the repository`);
};

function activatedDisabledConfig(template, binding, releaseManifest) {
  const config = structuredClone(template);
  const production = binding.production;
  config.main = ACTIVATED_MAIN_PATH;
  config.assets.directory = ACTIVATED_ASSETS_PATH;
  config.name = production.worker_name;
  config.account_id = production.account_id;
  config.r2_buckets[0].bucket_name = production.r2_bucket_name;
  config.workflows[0].name = production.video_workflow_name;
  config.workflows[1].name = production.pair_workflow_name;
  Object.assign(config.vars, {
    VIDEOFORGE_COMMIT: binding.release.source_commit,
    VIDEOFORGE_PUBLIC_ORIGIN: production.public_origin,
    R2_ACCOUNT_ID: production.account_id,
    VIDEOFORGE_R2_BUCKET_NAME: production.r2_bucket_name,
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify(releaseManifest),
  });
  config.no_bundle = false;
  const sharedValidationConfig = structuredClone(config);
  sharedValidationConfig.no_bundle = true;
  validateProductionConfig(sharedValidationConfig, { mode: "activated" });
  return config;
}

function changedLeaves(before, after, prefix = "") {
  if (before === after) return [];
  if (Array.isArray(before) && Array.isArray(after))
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => changedLeaves(before[key], after[key], `${prefix}/${key}`));
  }
  return [prefix];
}

export function renderQualifiedConfig(template, binding, releaseManifest) {
  const disabled = activatedDisabledConfig(template, binding, releaseManifest);
  const qualified = structuredClone(disabled);
  qualified.vars.VIDEOFORGE_GPU_TRANSPORT = "QUALIFIED_EXACT";
  const changed = changedLeaves(disabled, qualified);
  if (changed.length !== 1 || changed[0] !== "/vars/VIDEOFORGE_GPU_TRANSPORT")
    fail("qualified enablement changed more than the exact GPU transport variable");
  validateQualifiedRenderedConfig(qualified, binding, releaseManifest);
  return qualified;
}

function childEnvironment(isolatedConfigRoot) {
  const env = {
    CI: "1",
    NODE_ENV: "production",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_HOME: isolatedConfigRoot,
    XDG_CONFIG_HOME: isolatedConfigRoot,
  };
  for (const name of ["PATH", "TMPDIR", "LANG", "LC_ALL"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

export async function prepareQualifiedProductionConfig(
  { bindingPath, outputPath, receiptOutputPath, releaseManifestPath },
  { runner = defaultRunner, bundleWorker = bundleQualifiedWorker } = {},
) {
  const resolvedBinding = resolve(bindingPath);
  const resolvedRelease = resolve(releaseManifestPath);
  const resolvedOutput = resolve(outputPath);
  const resolvedReceipt = resolve(receiptOutputPath);
  outsideRepository(resolvedOutput, "config output");
  outsideRepository(resolvedReceipt, "receipt output");
  if (resolvedOutput === resolvedReceipt) fail("config and receipt outputs must differ");
  await mode0600(resolvedBinding, "binding");
  await mode0600(resolvedRelease, "media worker release manifest");
  const bindingBytes = await readFile(resolvedBinding);
  const releaseBytes = await readFile(resolvedRelease);
  let binding;
  try {
    binding = validatePreparationBinding(JSON.parse(bindingBytes.toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-09")) throw error;
    fail("binding is not readable exact JSON");
  }
  const releaseManifest = validateReleaseManifest(
    releaseBytes,
    binding.release.media_worker_release_manifest_sha256,
  );
  const head = runner("git", ["rev-parse", "HEAD"]).stdout.trim();
  if (head !== binding.release.source_commit) fail("binding source commit is not current HEAD");
  if (runner("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim() !== "")
    fail("tracked worktree must be clean before exact source preparation");
  const template = parseProductionConfig(await readFile(TEMPLATE_PATH, "utf8"));
  validateProductionConfig(template, { mode: "template" });
  const config = renderQualifiedConfig(template, binding, releaseManifest);
  const configBytes = `${JSON.stringify(config, null, 2)}\n`;
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "videoforge-v2-09-config-"));
  const temporaryConfig = resolve(temporaryDirectory, "wrangler.production.qualified.json");
  const dryRunOutput = resolve(temporaryDirectory, "wrangler-dry-run");
  const isolatedConfigRoot = resolve(temporaryDirectory, "wrangler-home");
  const env = childEnvironment(isolatedConfigRoot);
  try {
    await writeFile(temporaryConfig, configBytes, { flag: "wx", mode: 0o600 });
    await mode0600(temporaryConfig, "temporary qualified config");
    renderPhase("V2_09_RENDER_DEPENDENCIES_FAILED", () =>
      runner(
        "pnpm",
        [
          "--recursive",
          "--filter",
          "@videoforge/config",
          "--filter",
          "@videoforge/contracts",
          "--filter",
          "@videoforge/pipeline",
          "--filter",
          "@videoforge/control-plane",
          "build",
        ],
        { env },
      ),
    );
    renderPhase("V2_09_RENDER_BUILD_FAILED", () =>
      runner("pnpm", ["--filter", "@videoforge/web", "build:cloudflare"], { env }),
    );
    await bundleWorker();
    renderPhase("V2_09_RENDER_WRANGLER_DRY_RUN_FAILED", () =>
      runner(
        "pnpm",
        [
          "--filter",
          "@videoforge/web",
          "exec",
          "wrangler",
          "deploy",
          ACTIVATED_MAIN_PATH,
          "--assets",
          ACTIVATED_ASSETS_PATH,
          "--strict",
          "--no-upload-source-maps",
          "--dry-run",
          "--outdir",
          dryRunOutput,
          "--config",
          temporaryConfig,
        ],
        { env },
      ),
    );
    const receipt = {
      schema_version: "videoforge-v2-09-qualified-production-config-preparation-receipt/v1",
      source_commit: binding.release.source_commit,
      binding_sha256: sha256(bindingBytes),
      config_sha256: sha256(configBytes),
      worker_bundle_sha256: renderPhase("V2_09_RENDER_BUNDLE_FAILED", () =>
        hashV209DryOutputBundle(dryRunOutput, { workerName: "videoforge-production-runtime" }),
      ),
      media_worker_release: {
        version: "0.1.16",
        manifest_sha256: binding.release.media_worker_release_manifest_sha256,
      },
      lanes: {
        mage_image: {
          qualification_record_sha256: MAGE_QUALIFICATION_SHA256,
          worker_image_digest: MAGE_IMAGE_DIGEST,
          endpoint_id_sha256: binding.lanes.mage_image.endpoint_id_sha256,
        },
        soulx_avatar: {
          qualification_record_sha256: SOULX_QUALIFICATION_SHA256,
          worker_image_digest: SOULX_IMAGE_DIGEST,
          endpoint_id_sha256: binding.lanes.soulx_avatar.endpoint_id_sha256,
        },
      },
      required_secret_bindings: {
        provenance_receipt_secret: binding.production.provenance_receipt_secret_binding,
        provenance_receipt_key_id: binding.production.provenance_receipt_key_id_binding,
      },
      gpu_transport: "QUALIFIED_EXACT",
      production_build_verified: true,
      wrangler_dry_run_succeeded: true,
      deployment_attempted: false,
      provider_calls: 0,
      credential_reads: 0,
      external_spend_usd: 0,
    };
    await writeFile(resolvedOutput, configBytes, { flag: "wx", mode: 0o600 });
    await writeFile(resolvedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await mode0600(resolvedOutput, "qualified config output");
    await mode0600(resolvedReceipt, "preparation receipt output");
    return receipt;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "videoforge-v2-09-qualified-production-config-dry-run/v1",
        state: "AWAITING_EXACT_MODE_0600_BINDINGS",
        config_written: false,
        build_invoked: false,
        wrangler_invoked: false,
        deployment_attempted: false,
        provider_calls: 0,
        credential_reads: 0,
        external_spend_usd: 0,
      })}\n`,
    );
    return;
  }
  if (tokens.length % 2 !== 0) fail("arguments must be --name value pairs");
  const args = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    if (!tokens[index].startsWith("--") || tokens[index + 1].startsWith("--"))
      fail("arguments must be --name value pairs");
    args.set(tokens[index].slice(2), tokens[index + 1]);
  }
  const expected = ["binding", "output", "receipt-output", "release-manifest"];
  if (args.size !== expected.length || expected.some((key) => !args.has(key)))
    fail("exactly --binding, --release-manifest, --output, and --receipt-output are required");
  const receipt = await prepareQualifiedProductionConfig({
    bindingPath: args.get("binding"),
    releaseManifestPath: args.get("release-manifest"),
    outputPath: args.get("output"),
    receiptOutputPath: args.get("receipt-output"),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${safeV209RenderFailureCode(error)}\n`);
    process.exitCode = 1;
  }
}
