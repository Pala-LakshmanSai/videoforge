import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  parseProductionConfig,
  validateProductionConfig,
} from "../../deploy/v2-13/validate-production-config.mjs";
import {
  MAGE_IMAGE_DIGEST,
  MAGE_QUALIFICATION_SHA256,
  sha256,
  SOULX_IMAGE_DIGEST,
  SOULX_QUALIFICATION_SHA256,
  validatePreparationBinding,
  validateQualifiedRenderedConfig,
  validateReleaseManifest,
} from "../../deploy/v2-09/validate-qualified-production-config.mjs";
import {
  bundleQualifiedWorker,
  prepareQualifiedProductionConfig,
  renderQualifiedConfig,
  safeV209RenderFailureCode,
} from "../../deploy/v2-09/render-qualified-production-config.mjs";

const root = resolve(new URL("../..", import.meta.url).pathname);
const renderer = resolve(root, "deploy/v2-09/render-qualified-production-config.mjs");
const templatePath = resolve(root, "apps/web/wrangler.production.jsonc");

const releaseManifest = () => ({
  schema_version: "videoforge-media-worker-release/v1",
  version: "0.1.17",
  minimum_protocol_version: 1,
  execution_bundle_sha256: `sha256:${"1".repeat(64)}`,
  whisper_model_sha256: `sha256:${"2".repeat(64)}`,
  windows: {
    url: "https://downloads.videoforge.example/media-worker-v0.1.17/videoforge-worker.exe",
    sha256: `sha256:${"3".repeat(64)}`,
    size_bytes: 1024,
    trust: "AUTHENTICODE_SIGNED",
  },
  macos: {
    url: "https://downloads.videoforge.example/media-worker-v0.1.17/videoforge-worker.dmg",
    sha256: `sha256:${"4".repeat(64)}`,
    size_bytes: 2048,
    trust: "DEVELOPER_ID_NOTARIZED",
  },
});

const binding = (releaseBytes, sourceCommit = "a".repeat(40)) => ({
  schema_version: "videoforge-v2-09-qualified-production-config-preparation/v1",
  authority: {
    mode: "PROVIDER_FREE_CONFIG_PREPARATION",
    credential_access_authorized: false,
    deployment_authorized: false,
    provider_calls_authorized: false,
    external_spend_usd: 0,
  },
  release: {
    source_commit: sourceCommit,
    media_worker_release_manifest_sha256: sha256(releaseBytes),
  },
  production: {
    account_id: "b".repeat(32),
    worker_name: "videoforge-production-runtime",
    public_origin: "https://app.videoforge.example",
    assets_binding: "ASSETS",
    r2_binding: "PRIVATE_ARTIFACTS",
    r2_bucket_name: "videoforge-production-private",
    video_workflow_binding: "VIDEO_WORKFLOW",
    video_workflow_name: "videoforge-production-video",
    pair_workflow_binding: "HOSTED_PAIR_WORKFLOW",
    pair_workflow_name: "videoforge-production-pair",
    provenance_receipt_secret_binding: "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
    provenance_receipt_key_id_binding: "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  },
  lanes: {
    mage_image: {
      qualification_record_sha256: MAGE_QUALIFICATION_SHA256,
      worker_image_digest: MAGE_IMAGE_DIGEST,
      endpoint_id_sha256: `sha256:${"5".repeat(64)}`,
    },
    soulx_avatar: {
      qualification_record_sha256: SOULX_QUALIFICATION_SHA256,
      worker_image_digest: SOULX_IMAGE_DIGEST,
      endpoint_id_sha256: `sha256:${"6".repeat(64)}`,
    },
  },
});

const bytesForRelease = () => Buffer.from(`${JSON.stringify(releaseManifest(), null, 2)}\n`);

test("qualified renderer preserves the closed-world production identities and changes only transport", async () => {
  const releaseBytes = bytesForRelease();
  const exactBinding = validatePreparationBinding(binding(releaseBytes));
  const release = validateReleaseManifest(
    releaseBytes,
    exactBinding.release.media_worker_release_manifest_sha256,
  );
  const template = parseProductionConfig(await readFile(templatePath, "utf8"));
  const rendered = renderQualifiedConfig(template, exactBinding, release);
  assert.deepEqual(validateQualifiedRenderedConfig(rendered, exactBinding, release), {
    valid: true,
    gpu_transport: "QUALIFIED_EXACT",
  });
  assert.equal(rendered.vars.VIDEOFORGE_GPU_TRANSPORT, "QUALIFIED_EXACT");
  assert.equal(rendered.no_bundle, false);
  const disabledTwin = structuredClone(rendered);
  disabledTwin.vars.VIDEOFORGE_GPU_TRANSPORT = "DISABLED_UNQUALIFIED";
  const sharedValidationTwin = structuredClone(disabledTwin);
  sharedValidationTwin.no_bundle = true;
  assert.deepEqual(validateProductionConfig(sharedValidationTwin, { mode: "activated" }), {
    mode: "activated",
    gpu_transport: "DISABLED_UNQUALIFIED",
    valid: true,
  });
  const qualifiedText = JSON.stringify(rendered);
  assert.equal(qualifiedText.includes("VIDEOFORGE_MAGE_ENDPOINT_ID"), false);
  assert.equal(qualifiedText.includes("VIDEOFORGE_SOULX_ENDPOINT_ID"), false);
  assert.equal(qualifiedText.includes("VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY"), false);
  assert.equal(qualifiedText.includes("VIDEOFORGE_PROVIDER_PROOF_KEY_ID"), false);
  const noBundleDrift = structuredClone(rendered);
  noBundleDrift.no_bundle = true;
  assert.throws(
    () => validateQualifiedRenderedConfig(noBundleDrift, exactBinding, release),
    /bundle mode drifted/u,
  );
});

test("binding validator rejects extras, placeholders, raw endpoint ids, secret values, and frozen drift", () => {
  const releaseBytes = bytesForRelease();
  const mutations = [
    (value) => {
      value.extra = true;
    },
    (value) => {
      value.production.r2_bucket_name = "placeholder";
    },
    (value) => {
      value.lanes.mage_image.endpoint_id = "raw-provider-id";
    },
    (value) => {
      value.production.runpod_api_key = "secret-value";
    },
    (value) => {
      value.lanes.soulx_avatar.qualification_record_sha256 = `sha256:${"7".repeat(64)}`;
    },
    (value) => {
      value.lanes.mage_image.worker_image_digest = `sha256:${"8".repeat(64)}`;
    },
    (value) => {
      value.production.provenance_receipt_secret_binding = "WRONG_BINDING";
    },
  ];
  for (const mutate of mutations) {
    const candidate = binding(releaseBytes);
    mutate(candidate);
    assert.throws(
      () => validatePreparationBinding(candidate),
      /V2-09 qualified production config validator/u,
    );
  }
});

test("release validator binds exact bytes and immutable media worker 0.1.17", () => {
  const releaseBytes = bytesForRelease();
  assert.equal(validateReleaseManifest(releaseBytes, sha256(releaseBytes)).version, "0.1.17");
  assert.throws(
    () => validateReleaseManifest(releaseBytes, `sha256:${"9".repeat(64)}`),
    /manifest hash drifted/u,
  );
  const wrongVersion = releaseManifest();
  wrongVersion.version = "0.1.15";
  const wrongBytes = Buffer.from(JSON.stringify(wrongVersion));
  assert.throws(
    () => validateReleaseManifest(wrongBytes, sha256(wrongBytes)),
    /not exact immutable 0.1.17/u,
  );
  const placeholder = releaseManifest();
  placeholder.windows.url =
    "https://downloads.videoforge.example/media-worker-v0.1.17/placeholder.exe";
  const placeholderBytes = Buffer.from(JSON.stringify(placeholder));
  assert.throws(
    () => validateReleaseManifest(placeholderBytes, sha256(placeholderBytes)),
    /contains a placeholder/u,
  );
});

test("preparation writes mode-0600 artifacts after build and isolated Wrangler dry-run only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "videoforge-v209-qualified-test-"));
  try {
    const releaseBytes = bytesForRelease();
    const exactBinding = binding(releaseBytes);
    const bindingPath = join(directory, "binding.json");
    const releasePath = join(directory, "release.json");
    const outputPath = join(directory, "wrangler.qualified.json");
    const receiptPath = join(directory, "receipt.json");
    await writeFile(bindingPath, `${JSON.stringify(exactBinding)}\n`, { mode: 0o600 });
    await writeFile(releasePath, releaseBytes, { mode: 0o600 });
    const calls = [];
    const runner = (command, args, options = {}) => {
      calls.push({ command, args, options });
      if (command === "git" && args[0] === "rev-parse")
        return { status: 0, stdout: `${exactBinding.release.source_commit}\n`, stderr: "" };
      if (command === "git") return { status: 0, stdout: "", stderr: "" };
      const outdirIndex = args.indexOf("--outdir");
      if (outdirIndex !== -1) {
        const outdir = args[outdirIndex + 1];
        mkdirSync(outdir, { recursive: true });
        writeFileSync(join(outdir, "index.js"), "export default {};\n");
        writeFileSync(
          join(outdir, "README.md"),
          'This folder contains the built output assets for the worker "videoforge-production-runtime" generated at 2026-09-08T09:00:53.144Z.',
        );
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const receipt = await prepareQualifiedProductionConfig(
      { bindingPath, releaseManifestPath: releasePath, outputPath, receiptOutputPath: receiptPath },
      { runner, bundleWorker: async () => {} },
    );
    assert.equal(receipt.gpu_transport, "QUALIFIED_EXACT");
    assert.match(receipt.worker_bundle_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(receipt.deployment_attempted, false);
    assert.equal(receipt.provider_calls, 0);
    assert.equal(receipt.credential_reads, 0);
    assert.deepEqual(receipt.required_secret_bindings, {
      provenance_receipt_secret: "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
      provenance_receipt_key_id: "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
    });
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
    const rendered = parseProductionConfig(await readFile(outputPath, "utf8"));
    assert.equal(rendered.vars.VIDEOFORGE_GPU_TRANSPORT, "QUALIFIED_EXACT");
    assert.equal(calls.length, 5);
    assert.deepEqual(calls[2].args, [
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
    ]);
    assert.deepEqual(calls[2].options.env, calls[3].options.env);
    const build = calls[3];
    const dryRun = calls[4];
    assert.deepEqual(build.args, ["--filter", "@videoforge/web", "build:cloudflare"]);
    assert.deepEqual(dryRun.args.slice(0, 5), [
      "--filter",
      "@videoforge/web",
      "exec",
      "wrangler",
      "deploy",
    ]);
    assert.ok(dryRun.args.includes("--dry-run"));
    assert.ok(dryRun.args.includes("--outdir"));
    assert.ok(dryRun.args.includes("--config"));
    assert.equal(dryRun.args.includes("--no-bundle"), false);
    assert.equal(dryRun.args.includes("--no-upload-source-maps"), true);
    for (const call of [build, dryRun]) {
      assert.equal(call.options.env.RUNPOD_API_KEY, undefined);
      assert.equal(call.options.env.CLOUDFLARE_API_TOKEN, undefined);
      assert.equal(call.options.env.DATABASE_URL, undefined);
      assert.match(call.options.env.WRANGLER_HOME, /videoforge-v2-09-config-/u);
      assert.equal(call.options.env.WRANGLER_SEND_METRICS, "false");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preparation rejects non-0600 inputs and repository outputs before any command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "videoforge-v209-refusal-test-"));
  try {
    const releaseBytes = bytesForRelease();
    const bindingPath = join(directory, "binding.json");
    const releasePath = join(directory, "release.json");
    await writeFile(bindingPath, `${JSON.stringify(binding(releaseBytes))}\n`, { mode: 0o644 });
    await writeFile(releasePath, releaseBytes, { mode: 0o600 });
    let called = false;
    await assert.rejects(
      prepareQualifiedProductionConfig(
        {
          bindingPath,
          releaseManifestPath: releasePath,
          outputPath: join(directory, "out.json"),
          receiptOutputPath: join(directory, "receipt.json"),
        },
        { runner: () => (called = true) },
      ),
      /binding must be a regular mode-0600 file/u,
    );
    assert.equal(called, false);
    await assert.rejects(
      prepareQualifiedProductionConfig(
        {
          bindingPath: releasePath,
          releaseManifestPath: releasePath,
          outputPath: resolve(root, "qualified.json"),
          receiptOutputPath: join(directory, "receipt.json"),
        },
        { runner: () => (called = true) },
      ),
      /config output must be outside the repository/u,
    );
    assert.equal(called, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renderer default is a provider-free no-op and source exposes no live deployment switch", async () => {
  const result = spawnSync(process.execPath, [renderer], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: "videoforge-v2-09-qualified-production-config-dry-run/v1",
    state: "AWAITING_EXACT_MODE_0600_BINDINGS",
    config_written: false,
    build_invoked: false,
    wrangler_invoked: false,
    deployment_attempted: false,
    provider_calls: 0,
    credential_reads: 0,
    external_spend_usd: 0,
  });
  const source = await readFile(renderer, "utf8");
  assert.match(source, /"--dry-run"/u);
  assert.doesNotMatch(source, /--no-bundle|--execute|--deploy-live|CLOUDFLARE_API_TOKEN/u);
});

test("render child failures emit fixed phase codes without raw child output", async () => {
  for (const phase of ["DEPENDENCIES", "BUILD", "WRANGLER_DRY_RUN", "BUNDLE"]) {
    const directory = await mkdtemp(join(tmpdir(), "v209-safe-render-"));
    try {
      const releaseBytes = bytesForRelease();
      const exactBinding = binding(releaseBytes);
      const bindingPath = join(directory, "binding.json");
      const releaseManifestPath = join(directory, "release.json");
      await writeFile(bindingPath, JSON.stringify(exactBinding), { mode: 0o600 });
      await writeFile(releaseManifestPath, releaseBytes, { mode: 0o600 });
      const runner = (command, args) => {
        if (command === "git")
          return {
            status: 0,
            stdout: args[0] === "rev-parse" ? exactBinding.release.source_commit : "",
          };
        if (
          (phase === "DEPENDENCIES" && args.includes("--recursive")) ||
          (phase === "BUILD" && args.includes("build:cloudflare")) ||
          (phase === "WRANGLER_DRY_RUN" && args.includes("--dry-run"))
        )
          return {
            status: 1,
            stdout: "password=do-not-output",
            stderr: "secret=/private/credential",
          };
        return { status: 0, stdout: "" };
      };
      await assert.rejects(
        prepareQualifiedProductionConfig(
          {
            bindingPath,
            releaseManifestPath,
            outputPath: join(directory, "out.json"),
            receiptOutputPath: join(directory, "receipt.json"),
          },
          { runner, bundleWorker: async () => {} },
        ),
        (error) => error.message === `V2_09_RENDER_${phase}_FAILED` && error.cause === undefined,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  assert.equal(
    safeV209RenderFailureCode(new Error("password=do-not-output")),
    "V2_09_RENDER_CONFIG_FAILED",
  );
  assert.equal(
    safeV209RenderFailureCode(new Error("V2_09_RENDER_BUILD_FAILED password=x")),
    "V2_09_RENDER_CONFIG_FAILED",
  );
  const child = spawnSync(process.execPath, [renderer, "--private-secret-path"], {
    encoding: "utf8",
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "V2_09_RENDER_CONFIG_FAILED\n");
});

test("single-file worker closes relative chunks and rejects unresolved dependencies atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v209-module-closure-"));
  try {
    const main = join(directory, "index.js");
    await writeFile(
      join(directory, "chunk.js"),
      'export class HostedVideoWorkflow {} export class HostedPairWorkflow {} export default { fetch(){return new Response("ok")} };',
    );
    await writeFile(
      main,
      'export {default, HostedVideoWorkflow, HostedPairWorkflow} from "./chunk.js";',
    );
    const collision = `${main}.v209-single-file.tmp`;
    await writeFile(collision, "owned-by-other");
    await assert.rejects(bundleQualifiedWorker(main), /V2_09_RENDER_WORKER_WRITE_FAILED/u);
    assert.equal(await readFile(collision, "utf8"), "owned-by-other");
    await rm(collision);
    await bundleQualifiedWorker(main);
    const bundled = await readFile(main, "utf8");
    assert.ok(bundled.includes("HostedVideoWorkflow"));
    assert.ok(!bundled.includes('./chunk.js"'));
    await rm(join(directory, "chunk.js"));
    await bundleQualifiedWorker(main);
    const broken = 'export {default, HostedVideoWorkflow, HostedPairWorkflow} from "./missing.js";';
    await writeFile(main, broken);
    await assert.rejects(bundleQualifiedWorker(main), /V2_09_RENDER_WORKER_BUILD_FAILED/u);
    assert.equal(await readFile(main, "utf8"), broken);
    await writeFile(main, "export default {};");
    await assert.rejects(bundleQualifiedWorker(main), /V2_09_RENDER_WORKER_EXPORTS_FAILED/u);
    assert.equal(await readFile(main, "utf8"), "export default {};");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
