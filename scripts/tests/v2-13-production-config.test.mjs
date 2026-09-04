import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseProductionConfig,
  validateMediaWorkerReleaseManifest,
  validateProductionConfig,
} from "../../deploy/v2-13/validate-production-config.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const renderer = path.resolve(root, "deploy/v2-13/render-production-config.mjs");
const validator = path.resolve(root, "deploy/v2-13/validate-production-config.mjs");
const bundleVerifier = path.resolve(root, "scripts/verify-v2-05-production-bundle.mjs");
const deploymentWrapper = path.resolve(root, "deploy/v2-13/deploy-production.mjs");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const validReleaseManifest = () => ({
  schema_version: "videoforge-media-worker-release/v1",
  version: "1.0.0",
  minimum_protocol_version: 1,
  execution_bundle_sha256: `sha256:${"1".repeat(64)}`,
  whisper_model_sha256: `sha256:${"2".repeat(64)}`,
  windows: {
    url: "https://downloads.videoforge.com/releases/1.0.0/videoforge-worker.exe",
    sha256: `sha256:${"3".repeat(64)}`,
    size_bytes: 1024,
    trust: "AUTHENTICODE_SIGNED",
  },
  macos: {
    url: "https://downloads.videoforge.com/releases/1.0.0/videoforge-worker.dmg",
    sha256: `sha256:${"4".repeat(64)}`,
    size_bytes: 2048,
    trust: "DEVELOPER_ID_NOTARIZED",
  },
});

async function writeActivationInputs(directory) {
  const release = Buffer.from(`${JSON.stringify(validReleaseManifest(), null, 2)}\n`);
  const releasePath = path.join(directory, "release.json");
  const activationPath = path.join(directory, "activation.json");
  await writeFile(releasePath, release);
  await writeFile(
    activationPath,
    JSON.stringify({
      schema_version: "videoforge-v2-13-production-config-activation/v1",
      checkpoint: "V2-13",
      authority: {
        mode: "APPROVED_CONFIG_RENDER_ONLY",
        config_render_only: true,
        deployment_authorized: false,
        provider_calls_authorized: false,
        credential_access_authorized: false,
        external_spend_usd: 0,
        approved_at: "2026-08-25T12:00:00.000Z",
      },
      release: {
        commit: "a".repeat(40),
        media_worker_release_manifest_sha256: sha256(release),
      },
      cloudflare: {
        account_id: "b".repeat(32),
        worker_name: "videoforge-production-runtime",
        workflow_name: "videoforge-production-video",
        r2_bucket_name: "videoforge-production-private",
        public_origin: "https://app.videoforge.example",
      },
      runtime: {
        environment: "production",
        provider_mode: "production",
        gpu_transport: "DISABLED_UNQUALIFIED",
        assets_binding: "ASSETS",
        r2_binding: "PRIVATE_ARTIFACTS",
        workflow_binding: "VIDEO_WORKFLOW",
        version_metadata_binding: "CF_VERSION_METADATA",
        observability_enabled: true,
      },
    }),
  );
  return { activationPath, release, releasePath };
}

test("production template is an exact fail-closed closed-world config", () => {
  const result = spawnSync(process.execPath, [validator], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: "template",
    gpu_transport: "DISABLED_UNQUALIFIED",
    valid: true,
  });
});

test("renderer is provider-free dry-run by default", () => {
  const result = spawnSync(process.execPath, [renderer], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: "videoforge-v2-13-production-config-dry-run/v1",
    state: "DISABLED_UNQUALIFIED",
    placeholders_resolved: false,
    config_written: false,
    deployment_authorized: false,
    provider_calls: 0,
    credential_reads: 0,
    external_spend_usd: 0,
  });
});

test("deployment wrapper is no-op dry-run by default and is the only canonical deploy command", async () => {
  const result = spawnSync(process.execPath, [deploymentWrapper], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: "videoforge-v2-13-production-deployment-dry-run/v1",
    state: "DISABLED_UNQUALIFIED",
    config_rendered: false,
    config_validated: false,
    wrangler_invoked: false,
    deployment_attempted: false,
    provider_calls: 0,
    credential_reads: 0,
    external_spend_usd: 0,
  });
  const rootPackage = JSON.parse(await readFile(path.resolve(root, "package.json"), "utf8"));
  const webPackage = JSON.parse(
    await readFile(path.resolve(root, "apps/web/package.json"), "utf8"),
  );
  assert.equal(
    rootPackage.scripts["deploy:v2-13-production"],
    "node deploy/v2-13/deploy-production.mjs",
  );
  for (const scripts of [rootPackage.scripts, webPackage.scripts]) {
    for (const [name, command] of Object.entries(scripts)) {
      if (name === "deploy:v2-13-production") continue;
      assert.doesNotMatch(command, /wrangler\s+deploy.*wrangler\.production\.jsonc/u);
    }
  }
  const wrapperSource = await readFile(deploymentWrapper, "utf8");
  assert.match(wrapperSource, /mkdtemp/u);
  assert.match(wrapperSource, /mode: "activated"/u);
  assert.doesNotMatch(wrapperSource, /"--config",\s*TEMPLATE_PATH/u);
  const refused = spawnSync(
    process.execPath,
    [
      deploymentWrapper,
      "--execute",
      "--activation-record",
      "unused.json",
      "--release-manifest-file",
      "unused.json",
      "--confirm",
      "NOT_APPROVED",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /DEPLOY_EXACT_RENDERED_V2_13_PRODUCTION_CONFIG/u);
});

test("activation renders exact bindings without secrets or deployment authority", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vf-v213-config-"));
  const { activationPath, releasePath } = await writeActivationInputs(directory);
  const outputPath = path.join(directory, "wrangler.json");
  const result = spawnSync(
    process.execPath,
    [
      renderer,
      "--activate",
      "--activation-record",
      activationPath,
      "--release-manifest-file",
      releasePath,
      "--output",
      outputPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const rendered = parseProductionConfig(await readFile(outputPath, "utf8"));
  assert.deepEqual(validateProductionConfig(rendered, { mode: "activated" }), {
    mode: "activated",
    gpu_transport: "DISABLED_UNQUALIFIED",
    valid: true,
  });
  assert.equal(rendered.vars.VIDEOFORGE_PROVIDER_MODE, "production");
  assert.equal(rendered.vars.VIDEOFORGE_GPU_TRANSPORT, "DISABLED_UNQUALIFIED");
  assert.equal(
    rendered.main,
    path.resolve(root, "apps/web/dist-cloudflare/videoforge_production_runtime/index.js"),
  );
  assert.equal(rendered.assets.directory, path.resolve(root, "apps/web/dist-cloudflare/client"));
  assert.equal(JSON.stringify(rendered).includes("__V2_13_"), false);
  assert.equal(JSON.stringify(rendered).includes("DATABASE_URL"), false);
  assert.equal(JSON.parse(result.stdout).deployment_authorized, false);
  const invalidReleaseConfig = structuredClone(rendered);
  invalidReleaseConfig.vars.MEDIA_WORKER_RELEASE_MANIFEST_JSON = "{}";
  assert.throws(
    () => validateProductionConfig(invalidReleaseConfig, { mode: "activated" }),
    /media worker release manifest identity is malformed/u,
  );
});

test("deployment wrapper reaches a provider-free Wrangler dry-run with activated paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vf-v213-deploy-verify-"));
  try {
    const { activationPath, releasePath } = await writeActivationInputs(directory);
    const result = spawnSync(
      process.execPath,
      [
        deploymentWrapper,
        "--verify-only",
        "--activation-record",
        activationPath,
        "--release-manifest-file",
        releasePath,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      schema_version: "videoforge-v2-13-production-deployment-verification/v1",
      state: "DISABLED_UNQUALIFIED",
      production_build_verified: true,
      activated_config_validated: true,
      wrangler_dry_run_succeeded: true,
      deployment_attempted: false,
      provider_calls: 0,
      credential_reads: 0,
      external_spend_usd: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release manifest validator rejects empty, unresolved, bad hashes, and unsafe URLs", async () => {
  assert.deepEqual(
    validateMediaWorkerReleaseManifest(validReleaseManifest()),
    validReleaseManifest(),
  );
  for (const candidate of [
    {},
    JSON.parse(
      await readFile(path.resolve(root, "deploy/v2-06/media-worker-release.template.json"), "utf8"),
    ),
    { ...validReleaseManifest(), execution_bundle_sha256: "sha256:bad" },
    {
      ...validReleaseManifest(),
      windows: { ...validReleaseManifest().windows, url: "http://downloads.example/worker.exe" },
    },
    {
      ...validReleaseManifest(),
      macos: {
        ...validReleaseManifest().macos,
        url: "https://user:password@downloads.example/worker.dmg",
      },
    },
  ]) {
    assert.throws(
      () => validateMediaWorkerReleaseManifest(candidate),
      /V2-13 production config validator/u,
    );
  }
});

test("validator rejects extras, forbidden modes, secrets, and unresolved activation", async () => {
  const template = parseProductionConfig(
    await readFile(path.resolve(root, "apps/web/wrangler.production.jsonc"), "utf8"),
  );
  for (const mutate of [
    (value) => {
      value.extra = true;
    },
    (value) => {
      value.vars.VIDEOFORGE_PROVIDER_MODE = "fixture";
    },
    (value) => {
      value.vars.DATABASE_URL = "secret";
    },
  ]) {
    const candidate = structuredClone(template);
    mutate(candidate);
    assert.throws(
      () => validateProductionConfig(candidate, { mode: "template" }),
      /V2-13 production config validator/u,
    );
  }
  const unresolvedActivated = structuredClone(template);
  unresolvedActivated.main = path.resolve(
    root,
    "apps/web/dist-cloudflare/videoforge_production_runtime/index.js",
  );
  unresolvedActivated.assets.directory = path.resolve(root, "apps/web/dist-cloudflare/client");
  assert.throws(
    () => validateProductionConfig(unresolvedActivated, { mode: "activated" }),
    /retains a placeholder/u,
  );
});

async function productionBundle(workerSource, clientSource, options = {}) {
  const directory = path.resolve(
    root,
    `apps/web/dist-v213-firewall-${randomBytes(8).toString("hex")}`,
  );
  const workerDirectory = path.join(
    directory,
    options.wranglerConfig === "wrangler.staging.jsonc"
      ? "videoforge_v2_06_staging"
      : "videoforge_production_runtime",
  );
  const clientDirectory = path.join(directory, "client");
  await mkdir(path.join(workerDirectory, ".vite"), { recursive: true });
  await mkdir(path.join(clientDirectory, ".vite"), { recursive: true });
  await writeFile(path.join(workerDirectory, "index.js"), workerSource);
  const workerManifest = {
    "_worker-common.js": {
      file: "assets/worker-common.js",
      dynamicImports: ["src/server/hosted/hosted-prompt-route.ts", "_product.js"],
    },
    "_product.js": {
      file: "assets/product.js",
      isDynamicEntry: true,
      imports: ["_worker-common.js"],
      dynamicImports: ["src/server/hosted/generation-coordinator.ts"],
    },
    "src/server/hosted/generation-coordinator.ts": {
      file: "assets/generation-coordinator.js",
      isDynamicEntry: true,
      imports: ["_worker-common.js"],
      dynamicImports: [
        "../../packages/contracts/dist/generated/hosted-generation-contract-validators.js",
      ],
    },
    "../../packages/contracts/dist/generated/hosted-generation-contract-validators.js": {
      file: "assets/hosted-generation-contract-validators.js",
      isDynamicEntry: true,
      imports: ["_worker-common.js"],
    },
    "src/server/hosted/hosted-prompt-route.ts": {
      file: "assets/hosted-prompt-route.js",
      isDynamicEntry: true,
      imports: ["_worker-common.js"],
    },
    "virtual:cloudflare/worker-entry": {
      file: "index.js",
      isEntry: true,
      imports: ["_worker-common.js"],
    },
  };
  options.mutateManifest?.(workerManifest);
  const assets = {
    "worker-common.js": options.workerCommonSource ?? "const common = true;\n",
    "product.js": "const product = true;\n",
    "generation-coordinator.js": "const coordinator = true;\n",
    "hosted-generation-contract-validators.js": "const planningValidators = true;\n",
    "hosted-prompt-route.js": options.promptRouteSource ?? "const promptRoute = true;\n",
    ...(options.extraAssets ?? {}),
  };
  await mkdir(path.join(workerDirectory, "assets"), { recursive: true });
  await Promise.all(
    Object.entries(assets).map(([name, source]) =>
      writeFile(path.join(workerDirectory, "assets", name), source),
    ),
  );
  await writeFile(
    path.join(workerDirectory, ".vite/manifest.json"),
    `${JSON.stringify(workerManifest)}\n`,
  );
  await writeFile(path.join(clientDirectory, "index.js"), clientSource);
  await writeFile(path.join(clientDirectory, "index.html"), "<!doctype html>\n");
  await writeFile(path.join(clientDirectory, ".vite/manifest.json"), "{}\n");
  return directory;
}

test("bundle firewall allows hosted schema lineage only in Worker output", async () => {
  const directory = await productionBundle(
    'const schema = "avatar_repair_profile_id echo_avatar NVIDIA GeForce RTX 4090";\n',
    "const client = true;\n",
  );
  try {
    const result = spawnSync(process.execPath, [bundleVerifier], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VIDEOFORGE_BUNDLE_DIR: path.basename(directory) },
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle firewall keeps hosted schema lineage out of client output", async () => {
  for (const token of ["avatar_repair_profile_id", "echo_avatar", "NVIDIA GeForce RTX 4090"]) {
    const directory = await productionBundle(
      "const worker = true;\n",
      `const leak = ${JSON.stringify(token)};\n`,
    );
    try {
      const result = spawnSync(process.execPath, [bundleVerifier], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, VIDEOFORGE_BUNDLE_DIR: path.basename(directory) },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("bundle firewall still rejects Worker GPU lifecycle controls", async () => {
  const directory = await productionBundle(
    'const lifecycle = "startPod";\n',
    "const client = true;\n",
  );
  try {
    const result = spawnSync(process.execPath, [bundleVerifier], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VIDEOFORGE_BUNDLE_DIR: path.basename(directory) },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /contains startPod/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle firewall rejects broad modules from the Stage 5 prompt closure", async () => {
  for (const forbidden of [
    { key: "_product.js", file: null },
    {
      key: "../../packages/contracts/dist/generated/contract-validators.js",
      file: "contract-validators.js",
    },
    { key: "src/server/hosted/generation-coordinator.ts", file: null },
    { key: "src/server/hosted/image-style.ts", file: "image-style.js" },
    { key: "src/server/hosted/audio-runtime.ts", file: "audio-runtime.js" },
    { key: "src/server/hosted/context-runtime.ts", file: "context-runtime.js" },
  ]) {
    const directory = await productionBundle("const worker = true;\n", "const client = true;\n", {
      mutateManifest(manifest) {
        manifest["src/server/hosted/hosted-prompt-route.ts"].imports.push(forbidden.key);
        if (forbidden.file) manifest[forbidden.key] = { file: `assets/${forbidden.file}` };
      },
      extraAssets: forbidden.file ? { [forbidden.file]: "const forbidden = true;\n" } : {},
    });
    try {
      const result = spawnSync(process.execPath, [bundleVerifier], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, VIDEOFORGE_BUNDLE_DIR: path.basename(directory) },
      });
      assert.notEqual(result.status, 0, forbidden.key);
      assert.match(result.stderr, /Stage 5 prompt closure reaches forbidden broad modules/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("bundle firewall cannot hide a forbidden prompt dependency in the static closure", async () => {
  const directory = await productionBundle("const worker = true;\n", "const client = true;\n", {
    mutateManifest(manifest) {
      manifest["_worker-common.js"].imports = ["src/server/hosted/image-style.ts"];
      manifest["src/server/hosted/image-style.ts"] = { file: "assets/image-style.js" };
    },
    extraAssets: { "image-style.js": "const forbiddenStaticStyle = true;\n" },
  });
  try {
    const result = spawnSync(process.execPath, [bundleVerifier], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VIDEOFORGE_BUNDLE_DIR: path.basename(directory) },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stage 5 prompt closure reaches forbidden broad modules/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle firewall caps the Stage 5 incremental closure at 256 KiB", async () => {
  const directory = await productionBundle("const worker = true;\n", "const client = true;\n", {
    promptRouteSource: "x".repeat(256 * 1024 + 1),
  });
  try {
    const result = spawnSync(process.execPath, [bundleVerifier], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VIDEOFORGE_BUNDLE_DIR: path.basename(directory) },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incremental prompt closure exceeds the 256 KiB/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle firewall rejects one byte of static Worker-entry growth above each target baseline", async () => {
  const workerSource = "const worker = true;\n";
  for (const { wranglerConfig, acceptedStaticBytes } of [
    { wranglerConfig: "wrangler.production.jsonc", acceptedStaticBytes: 2_718_273 },
    { wranglerConfig: "wrangler.staging.jsonc", acceptedStaticBytes: 2_747_459 },
  ]) {
    const directory = await productionBundle(workerSource, "const client = true;\n", {
      wranglerConfig,
      workerCommonSource: "x".repeat(acceptedStaticBytes - Buffer.byteLength(workerSource) + 1),
    });
    try {
      const result = spawnSync(process.execPath, [bundleVerifier], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          VIDEOFORGE_BUNDLE_DIR: path.basename(directory),
          VIDEOFORGE_WRANGLER_CONFIG: wranglerConfig,
        },
      });
      assert.notEqual(result.status, 0, wranglerConfig);
      assert.match(
        result.stderr,
        new RegExp(`accepted no-growth baseline of ${acceptedStaticBytes} bytes`, "u"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("bundle firewall rejects an unknown config instead of selecting a looser baseline", async () => {
  const directory = await productionBundle("const worker = true;\n", "const client = true;\n");
  try {
    const result = spawnSync(process.execPath, [bundleVerifier], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        VIDEOFORGE_BUNDLE_DIR: path.basename(directory),
        VIDEOFORGE_WRANGLER_CONFIG: "wrangler.evasion.jsonc",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid Wrangler bundle-verification config/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
