import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashRunPodV207EndpointIdentity,
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
} from "../../apps/web/src/server/providers/runpod-control";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const COMMIT = /^[0-9a-f]{40}$/u;
const PRIVATE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const WORKER_NAME = "videoforge-production-runtime";
const ACCOUNT_ID = "f9254d773a3426fcb469451b1f965d8c";
const PUBLIC_ORIGIN = "https://videoforge-production-runtime.lakshmansai121.workers.dev";
const R2_BUCKET_NAME = "videoforge-v2-06-staging-private";
const VIDEO_WORKFLOW_NAME = "videoforge-video-workflow";
const PAIR_WORKFLOW_NAME = "videoforge-pair-workflow";
const MAGE_ENDPOINT_ID = "r67o6t9pfe3cn8";
const MAGE_ENDPOINT_NAME = "vf_v213_5532f56d83346190c994915e_endpoint";
const MAGE_TEMPLATE_ID = "3b2z9mf30q";
const MAGE_TEMPLATE_NAME = "vf_v213_5532f56d83346190c994915e_template";
const SOULX_ENDPOINT_ID = "pmawsiezxds09g";
const SOULX_ENDPOINT_NAME = "vf_v213_d36f0f58e09e557806876e02_endpoint";
const SOULX_TEMPLATE_ID = "wzx1p2r25z";
const SOULX_TEMPLATE_NAME = "vf_v213_d36f0f58e09e557806876e02_template";
const MAGE_IMAGE_DIGEST = "sha256:26680786552e7a40f88a312e97720dffa6944173eb83080a100989beac2216b0";
const SOULX_IMAGE_DIGEST =
  "sha256:047881a3e85fcb98683c2851989ec064628fa803123588ac25929bd6ca6b243a";
const MAGE_IMAGE_NAME = `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${MAGE_IMAGE_DIGEST}`;
const SOULX_IMAGE_NAME = `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@${SOULX_IMAGE_DIGEST}`;
const MAGE_VOLUME_ID_SHA256 =
  "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const SOULX_VOLUME_ID_SHA256 =
  "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const MAGE_STALE_MANIFEST_SHA256 =
  "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b";
const MAGE_TARGET_MANIFEST_SHA256 =
  "sha256:ffaf47d13c92407a51d2aa78337612daf2733f5a5bb93e27336822a5389ba1c9";
const SOULX_MANIFEST_SHA256 =
  "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626";
const MAGE_QUALIFICATION_SHA256 =
  "sha256:12bc1b0fa85606ed1adad23b0b6df97d5c16e1e5d0f8e417fadad0403076be5f";
const SOULX_QUALIFICATION_SHA256 =
  "sha256:d6fff986aa950becbd345c72090c0d2d8fdabb4bc0b920d194b57e6a596f72b8";

type JsonRecord = Record<string, unknown>;
type PairLane = "mage" | "soulx";

const fail = (code: string): never => {
  throw new Error(`V2_09_EXISTING_PAIR_REPAIR_${code}`);
};

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as JsonRecord)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as JsonRecord)[key])}`)
    .join(",")}}`;
};

const sha256 = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const hashId = (value: string): string => hashRunPodV207EndpointIdentity(value);
const hashEnvironment = (value: JsonRecord): string => sha256(canonical(value));

function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_DIRECTORY_INVALID");
}

function privateFile(path: string): void {
  if (!isAbsolute(path)) fail("PRIVATE_PATH_INVALID");
  privateDirectory(resolve(path, ".."));
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== PRIVATE_MODE ||
    stat.nlink !== 1 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_FILE_INVALID");
}

function readPrivateText(path: string): string {
  privateFile(path);
  return readFileSync(path, "utf8");
}

function writePrivateFile(path: string, bytes: string | Uint8Array): void {
  writeFileSync(path, bytes, { flag: "wx", mode: PRIVATE_MODE });
  chmodSync(path, PRIVATE_MODE);
  privateFile(path);
}

function createPrivateRoot(path: string): void {
  if (!isAbsolute(path) || relative(ROOT, path) === "" || !relative(ROOT, path).startsWith(".."))
    fail("PRIVATE_ROOT_SCOPE");
  mkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(path, PRIVATE_DIRECTORY_MODE);
  privateDirectory(path);
}

function gitHead(): string {
  const value = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!COMMIT.test(value)) fail("SOURCE_COMMIT_INVALID");
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() !== ""
  )
    fail("TRACKED_WORKTREE_NOT_CLEAN");
  return value;
}

function parseArgs(tokens: readonly string[]): Readonly<Record<string, string | boolean>> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--execute") {
      result.execute = true;
      continue;
    }
    if (!token?.startsWith("--") || tokens[index + 1]?.startsWith("--")) fail("ARGUMENTS_INVALID");
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || result[key] !== undefined) fail("ARGUMENTS_INVALID");
    result[key] = value;
    index += 1;
  }
  return Object.freeze(result);
}

function requiredPath(args: Readonly<Record<string, string | boolean>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !isAbsolute(value))
    fail(`ARGUMENT_${name.toUpperCase()}_INVALID`);
  return resolve(value);
}

function assertTerminalEndpoint(
  endpoint: JsonRecord,
  expected: {
    endpointId: string;
    endpointName: string;
    templateId: string;
    volumeIdSha256: string;
  },
): void {
  const workerRecords = endpoint.workers;
  const networkVolumeIds = endpoint.networkVolumeIds;
  if (
    endpoint.id !== expected.endpointId ||
    endpoint.name !== expected.endpointName ||
    endpoint.templateId !== expected.templateId ||
    endpoint.workersMin !== 0 ||
    endpoint.workersMax !== 1 ||
    endpoint.gpuCount !== 1 ||
    JSON.stringify(endpoint.gpuTypeIds) !== JSON.stringify(["NVIDIA GeForce RTX 4090"]) ||
    typeof endpoint.networkVolumeId !== "string" ||
    hashId(endpoint.networkVolumeId) !== expected.volumeIdSha256 ||
    (networkVolumeIds !== undefined &&
      JSON.stringify(networkVolumeIds) !== JSON.stringify([endpoint.networkVolumeId])) ||
    (endpoint.dataCenterIds !== undefined &&
      JSON.stringify(endpoint.dataCenterIds) !== JSON.stringify(["EU-RO-1"])) ||
    !Array.isArray(workerRecords)
  )
    fail("RUNPOD_EXISTING_PAIR_CONTRACT_DRIFT");
  for (const worker of workerRecords) {
    const value = record(worker);
    const desiredStatus = value?.desiredStatus;
    const status = value?.status;
    if (
      !["EXITED", "TERMINATED"].includes(String(desiredStatus)) ||
      (status !== undefined && !["EXITED", "TERMINATED"].includes(String(status)))
    )
      fail("RUNPOD_EXISTING_PAIR_NOT_TERMINAL");
  }
}

function assertTemplate(
  template: JsonRecord,
  expected: { templateId: string; templateName: string; imageName: string },
): JsonRecord {
  const environment = record(template.env);
  if (
    template.id !== expected.templateId ||
    template.name !== expected.templateName ||
    template.imageName !== expected.imageName ||
    environment === null ||
    Object.values(environment).some((value) => typeof value !== "string")
  )
    fail("RUNPOD_EXISTING_PAIR_TEMPLATE_DRIFT");
  return environment;
}

function assertLaneEnvironment(
  lane: PairLane,
  environment: JsonRecord,
  endpointId: string,
  mageManifest: string,
): void {
  if (
    environment.VIDEOFORGE_V213_LANE !== (lane === "mage" ? "mage" : "soulx") ||
    environment.VIDEOFORGE_V213_PURPOSE !== "production" ||
    environment[
      lane === "mage" ? "VIDEOFORGE_MAGE_ENDPOINT_ID_HASH" : "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256"
    ] !== hashId(endpointId)
  )
    fail("RUNPOD_EXISTING_PAIR_LANE_BINDING_DRIFT");
  if (lane === "mage") {
    if (
      environment.VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST !== MAGE_IMAGE_NAME ||
      environment.VIDEOFORGE_MAGE_VOLUME_ID_HASH !== MAGE_VOLUME_ID_SHA256 ||
      environment.VIDEOFORGE_MAGE_MANIFEST_SHA256 !== mageManifest
    )
      fail("RUNPOD_MAGE_TEMPLATE_BINDING_DRIFT");
  } else if (
    environment.VIDEOFORGE_SOULX_CONTAINER_DIGEST !== SOULX_IMAGE_DIGEST ||
    environment.VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256 !== SOULX_MANIFEST_SHA256 ||
    environment.VIDEOFORGE_SOULX_VOLUME_ID_SHA256 !== SOULX_VOLUME_ID_SHA256
  )
    fail("RUNPOD_SOULX_TEMPLATE_BINDING_DRIFT");
}

function readExistingPair(
  inventory: Awaited<ReturnType<RunPodControlClient["inventoryDisposableResources"]>>,
  mageManifest: string,
) {
  if (inventory.endpoints.length !== 2 || inventory.templates.length !== 2)
    fail("RUNPOD_EXISTING_PAIR_COUNT_DRIFT");
  const endpoints = new Map(inventory.endpoints.map((value) => [value.id, value.raw]));
  const templates = new Map(inventory.templates.map((value) => [value.id, value.raw]));
  const mageEndpoint = endpoints.get(MAGE_ENDPOINT_ID);
  const mageTemplate = templates.get(MAGE_TEMPLATE_ID);
  const soulxEndpoint = endpoints.get(SOULX_ENDPOINT_ID);
  const soulxTemplate = templates.get(SOULX_TEMPLATE_ID);
  if (!mageEndpoint || !mageTemplate || !soulxEndpoint || !soulxTemplate)
    fail("RUNPOD_EXISTING_PAIR_IDENTITY_DRIFT");
  assertTerminalEndpoint(mageEndpoint, {
    endpointId: MAGE_ENDPOINT_ID,
    endpointName: MAGE_ENDPOINT_NAME,
    templateId: MAGE_TEMPLATE_ID,
    volumeIdSha256: MAGE_VOLUME_ID_SHA256,
  });
  assertTerminalEndpoint(soulxEndpoint, {
    endpointId: SOULX_ENDPOINT_ID,
    endpointName: SOULX_ENDPOINT_NAME,
    templateId: SOULX_TEMPLATE_ID,
    volumeIdSha256: SOULX_VOLUME_ID_SHA256,
  });
  const mageEnvironment = assertTemplate(mageTemplate, {
    templateId: MAGE_TEMPLATE_ID,
    templateName: MAGE_TEMPLATE_NAME,
    imageName: MAGE_IMAGE_NAME,
  });
  const soulxEnvironment = assertTemplate(soulxTemplate, {
    templateId: SOULX_TEMPLATE_ID,
    templateName: SOULX_TEMPLATE_NAME,
    imageName: SOULX_IMAGE_NAME,
  });
  assertLaneEnvironment("mage", mageEnvironment, MAGE_ENDPOINT_ID, mageManifest);
  assertLaneEnvironment("soulx", soulxEnvironment, SOULX_ENDPOINT_ID, SOULX_MANIFEST_SHA256);
  return Object.freeze({
    mage: Object.freeze({
      endpoint: mageEndpoint,
      template: mageTemplate,
      environment: mageEnvironment,
    }),
    soulx: Object.freeze({
      endpoint: soulxEndpoint,
      template: soulxTemplate,
      environment: soulxEnvironment,
    }),
  });
}

async function assertProviderZero(
  client: RunPodControlClient,
  endpointIds: readonly string[],
): Promise<Readonly<{ runningPodCount: number; activeServerlessWorkerCount: number }>> {
  const inventory = await client.inventory();
  if (inventory.runningPodCount !== 0 || inventory.activeServerlessWorkerCount !== 0)
    fail("RUNPOD_BILLABLE_COMPUTE_NOT_ZERO");
  await Promise.all(
    endpointIds.map(async (endpointId) => {
      const guard = new RunPodDrainGuard();
      await new RunPodServerlessJobClient({
        apiKey: requiredRuntimeRunPodKey,
        endpointId,
        guard,
      }).confirmStartupQueueEmpty();
    }),
  );
  return Object.freeze({
    runningPodCount: inventory.runningPodCount,
    activeServerlessWorkerCount: inventory.activeServerlessWorkerCount,
  });
}

let requiredRuntimeRunPodKey = "";

function buildBinding(
  sourceCommit: string,
  endpointHashes: { mage: string; soulx: string },
  releaseHash: string,
) {
  return {
    schema_version: "videoforge-v2-09-qualified-production-config-preparation/v1",
    authority: {
      credential_access_authorized: false,
      deployment_authorized: false,
      external_spend_usd: 0,
      mode: "PROVIDER_FREE_CONFIG_PREPARATION",
      provider_calls_authorized: false,
    },
    lanes: {
      mage_image: {
        endpoint_id_sha256: endpointHashes.mage,
        qualification_record_sha256: MAGE_QUALIFICATION_SHA256,
        worker_image_digest: MAGE_IMAGE_DIGEST,
      },
      soulx_avatar: {
        endpoint_id_sha256: endpointHashes.soulx,
        qualification_record_sha256: SOULX_QUALIFICATION_SHA256,
        worker_image_digest: SOULX_IMAGE_DIGEST,
      },
    },
    production: {
      account_id: ACCOUNT_ID,
      assets_binding: "ASSETS",
      pair_workflow_binding: "HOSTED_PAIR_WORKFLOW",
      pair_workflow_name: PAIR_WORKFLOW_NAME,
      provenance_receipt_key_id_binding: "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
      provenance_receipt_secret_binding: "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
      public_origin: PUBLIC_ORIGIN,
      r2_binding: "PRIVATE_ARTIFACTS",
      r2_bucket_name: R2_BUCKET_NAME,
      video_workflow_binding: "VIDEO_WORKFLOW",
      video_workflow_name: VIDEO_WORKFLOW_NAME,
      worker_name: WORKER_NAME,
    },
    release: {
      media_worker_release_manifest_sha256: releaseHash,
      source_commit: sourceCommit,
    },
  } as const;
}

function cloudflareConfiguration(args: {
  privateRoot: string;
  sourceCommit: string;
  secretRoot: string;
  runwareKeyPath: string;
  oauthConfigPath: string;
  secretNames: readonly string[];
  oauthScopes: readonly string[];
}) {
  const secretFiles = Object.fromEntries(
    args.secretNames.map((name) => [
      name,
      name === "RUNWARE_API_KEY" ? args.runwareKeyPath : join(args.secretRoot, name),
    ]),
  );
  return {
    bootstrapConfigPath: join(args.privateRoot, "wrangler.production.bootstrap.json"),
    disabledConfigPath: join(args.privateRoot, "wrangler.production.disabled.json"),
    environment: {
      CI: "1",
      HOME: "/Users/lakshmansai",
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: "production",
      PATH: "/Users/lakshmansai/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: "/tmp",
      WRANGLER_SEND_METRICS: "false",
    },
    expectedOauthScopes: args.oauthScopes,
    journalPath: join(args.privateRoot, "cloudflare-replacement-journal.json"),
    oauthConfigPath: args.oauthConfigPath,
    qualifiedConfigPath: join(args.privateRoot, "wrangler.production.qualified.json"),
    root: ROOT,
    secretFiles,
    sourceCommit: args.sourceCommit,
    workerName: WORKER_NAME,
  } as const;
}

function makeAuthority(
  sourceCommit: string,
  receipt: JsonRecord,
  repair: { beforeEnvironmentSha256: string; afterEnvironmentSha256: string },
  secretNames: readonly string[],
) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000);
  const proposal = {
    schema_version: "videoforge-v2-09-existing-pair-repair-proposal/v1",
    source_commit: sourceCommit,
    operation: "repair-mage-template-manifest-then-replace-cloudflare-worker",
    runpod: {
      mage_endpoint_id_sha256: hashId(MAGE_ENDPOINT_ID),
      mage_template_id_sha256: hashId(MAGE_TEMPLATE_ID),
      stale_manifest_sha256: MAGE_STALE_MANIFEST_SHA256,
      target_manifest_sha256: MAGE_TARGET_MANIFEST_SHA256,
      before_environment_sha256: repair.beforeEnvironmentSha256,
      after_environment_sha256: repair.afterEnvironmentSha256,
      soulx_endpoint_id_sha256: hashId(SOULX_ENDPOINT_ID),
    },
    cloudflare: {
      worker_name: WORKER_NAME,
      config_sha256: receipt.config_sha256,
      worker_bundle_sha256: receipt.worker_bundle_sha256,
    },
  };
  const proposalSha256 = sha256(canonical(proposal));
  return {
    authority_id: `v2-09-existing-pair-repair-${sourceCommit.slice(0, 12)}`,
    execution: "V2_09_EXISTING_QUALIFIED_PAIR_REPAIR_ONCE",
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    proposal_sha256: proposalSha256,
    source_commit: sourceCommit,
    single_use: true,
    production: {
      worker_name: WORKER_NAME,
      config_sha256: receipt.config_sha256,
      worker_bundle_sha256: receipt.worker_bundle_sha256,
      secret_allowlist_sha256: sha256(canonical([...secretNames].sort())),
      secret_count: secretNames.length,
    },
  } as const;
}

async function execute(args: Readonly<Record<string, string | boolean>>) {
  const { APPROVED_WRANGLER_OAUTH_SCOPES, SECRET_NAMES } = await import(
    "../v2-13/guarded-activation.mjs"
  );
  const { prepareQualifiedProductionConfig } = await import(
    "./render-qualified-production-config.mjs"
  );
  const { createV209CloudflareReplacementCapabilities } = await import(
    "./cloudflare-production-operator.mjs"
  );
  const sourceCommit = gitHead();
  const privateRoot = requiredPath(args, "private-root");
  const runpodKeyPath = requiredPath(args, "runpod-key");
  const releaseConfigPath = requiredPath(args, "release-config");
  const secretRoot = requiredPath(args, "secret-root");
  const runwareKeyPath = requiredPath(args, "runware-key");
  const oauthConfigPath = requiredPath(args, "oauth-config");
  if (existsSync(privateRoot)) fail("PRIVATE_ROOT_ALREADY_EXISTS");
  createPrivateRoot(privateRoot);
  privateDirectory(secretRoot);
  privateFile(runwareKeyPath);
  privateFile(oauthConfigPath);
  requiredRuntimeRunPodKey = readPrivateText(runpodKeyPath).trim();
  if (requiredRuntimeRunPodKey.length < 20) fail("RUNPOD_KEY_INVALID");
  const releaseConfig = JSON.parse(readPrivateText(releaseConfigPath)) as JsonRecord;
  const releaseText = record(releaseConfig.vars)?.MEDIA_WORKER_RELEASE_MANIFEST_JSON;
  if (typeof releaseText !== "string" || releaseText.length === 0) fail("RELEASE_MANIFEST_MISSING");
  JSON.parse(releaseText);
  const releaseManifestPath = join(privateRoot, "media-worker-release.json");
  writePrivateFile(releaseManifestPath, releaseText);

  const runpod = new RunPodControlClient({ apiKey: requiredRuntimeRunPodKey });
  const initialInventory = await runpod.inventoryDisposableResources();
  const mageTemplateEntry = initialInventory.templates.find(({ id }) => id === MAGE_TEMPLATE_ID);
  const mageTemplateEnvironment = record(mageTemplateEntry?.raw.env);
  const currentMageManifest = mageTemplateEnvironment?.VIDEOFORGE_MAGE_MANIFEST_SHA256;
  let repairAlreadyApplied = false;
  let initialPair;
  let repairReceipt: {
    beforeEnvironmentSha256: string;
    afterEnvironmentSha256: string;
  };
  if (currentMageManifest === MAGE_STALE_MANIFEST_SHA256) {
    initialPair = readExistingPair(initialInventory, MAGE_STALE_MANIFEST_SHA256);
  } else if (currentMageManifest === MAGE_TARGET_MANIFEST_SHA256) {
    // The previous single-field RunPod mutation may have committed before a later local
    // configuration guard failed. Reconcile that exact target read-only; never PATCH again.
    initialPair = readExistingPair(initialInventory, MAGE_TARGET_MANIFEST_SHA256);
    const priorEnvironment = {
      ...initialPair.mage.environment,
      VIDEOFORGE_MAGE_MANIFEST_SHA256: MAGE_STALE_MANIFEST_SHA256,
    };
    repairReceipt = {
      beforeEnvironmentSha256: hashEnvironment(priorEnvironment),
      afterEnvironmentSha256: hashEnvironment(initialPair.mage.environment),
    };
    repairAlreadyApplied = true;
  } else {
    fail("RUNPOD_MAGE_MANIFEST_STATE_INVALID");
  }
  const providerInventory = await runpod.inventory();
  if (
    providerInventory.runningPodCount !== 0 ||
    providerInventory.activeServerlessWorkerCount !== 0
  )
    fail("RUNPOD_BILLABLE_COMPUTE_NOT_ZERO");

  const bindingPath = join(privateRoot, "qualified-binding.json");
  const endpointHashes = {
    mage: hashId(MAGE_ENDPOINT_ID),
    soulx: hashId(SOULX_ENDPOINT_ID),
  };
  const binding = buildBinding(sourceCommit, endpointHashes, sha256(releaseText));
  writePrivateFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  const configPath = join(privateRoot, "wrangler.production.qualified.json");
  const receiptPath = join(privateRoot, "preparation-receipt.json");
  const preparationReceipt = (await prepareQualifiedProductionConfig({
    bindingPath,
    releaseManifestPath,
    outputPath: configPath,
    receiptOutputPath: receiptPath,
  })) as JsonRecord;
  const configuration = cloudflareConfiguration({
    privateRoot,
    sourceCommit,
    secretRoot,
    runwareKeyPath,
    oauthConfigPath,
    secretNames: SECRET_NAMES,
    oauthScopes: APPROVED_WRANGLER_OAUTH_SCOPES,
  });
  const zeroBeforeRepair = await assertProviderZero(runpod, [MAGE_ENDPOINT_ID, SOULX_ENDPOINT_ID]);
  if (!repairAlreadyApplied) {
    const repairGuard = new RunPodDrainGuard();
    repairGuard.confirmZero(0, 0);
    const repairInput = {
      endpointId: MAGE_ENDPOINT_ID,
      endpointIdSha256: endpointHashes.mage,
      endpointName: MAGE_ENDPOINT_NAME,
      templateId: MAGE_TEMPLATE_ID,
      templateIdSha256: hashId(MAGE_TEMPLATE_ID),
      templateName: MAGE_TEMPLATE_NAME,
      imageName: MAGE_IMAGE_NAME,
      volumeIdSha256: MAGE_VOLUME_ID_SHA256,
      currentEnvironmentSha256: hashEnvironment(initialPair.mage.environment),
      currentManifestSha256: MAGE_STALE_MANIFEST_SHA256,
      targetManifestSha256: MAGE_TARGET_MANIFEST_SHA256,
    } as const;
    repairReceipt = await runpod.repairV213TemplateManifest(repairInput, repairGuard);
  }
  const repairedInventory = await runpod.inventoryDisposableResources();
  const repairedPair = readExistingPair(repairedInventory, MAGE_TARGET_MANIFEST_SHA256);
  const zeroAfterRepair = await assertProviderZero(runpod, [MAGE_ENDPOINT_ID, SOULX_ENDPOINT_ID]);
  if (repairedPair.mage.environment.VIDEOFORGE_MAGE_MANIFEST_SHA256 !== MAGE_TARGET_MANIFEST_SHA256)
    fail("RUNPOD_REPAIR_READBACK_DRIFT");

  const authority = makeAuthority(sourceCommit, preparationReceipt, repairReceipt, SECRET_NAMES);
  writePrivateFile(join(privateRoot, "authority.json"), `${JSON.stringify(authority, null, 2)}\n`);
  const capabilities = createV209CloudflareReplacementCapabilities(configuration);
  capabilities.assertAuthority(authority);
  let artifact: { cleanup: () => void } | undefined;
  let cloudflareVersion: JsonRecord | undefined;
  try {
    artifact = (await capabilities.prepare(authority)) as { cleanup: () => void };
    await capabilities.deploy(authority, artifact);
    cloudflareVersion = (await capabilities.readback(authority, "QUALIFIED_EXACT")) as JsonRecord;
  } catch (error) {
    // A deployment acknowledgement can be ambiguous. One readback is reconciliation only; the
    // operator never retries the deployment mutation.
    try {
      cloudflareVersion = (await capabilities.readback(authority, "QUALIFIED_EXACT")) as JsonRecord;
    } catch {
      throw error;
    }
  } finally {
    artifact?.cleanup();
  }
  const zeroAfterDeploy = await assertProviderZero(runpod, [MAGE_ENDPOINT_ID, SOULX_ENDPOINT_ID]);
  const report = {
    schema_version: "videoforge-v2-09-existing-pair-repair-report/v1",
    state: "COMPLETED",
    source_commit: sourceCommit,
    runpod: {
      mage_endpoint_id_sha256: endpointHashes.mage,
      mage_template_id_sha256: hashId(MAGE_TEMPLATE_ID),
      stale_manifest_sha256: MAGE_STALE_MANIFEST_SHA256,
      target_manifest_sha256: MAGE_TARGET_MANIFEST_SHA256,
      before_environment_sha256: repairReceipt.beforeEnvironmentSha256,
      after_environment_sha256: repairReceipt.afterEnvironmentSha256,
      zero_before_repair: zeroBeforeRepair,
      zero_after_repair: zeroAfterRepair,
      zero_after_deploy: zeroAfterDeploy,
      endpoints_recreated: false,
      volumes_deleted: false,
      repair_already_applied: repairAlreadyApplied,
    },
    cloudflare: {
      worker_name: WORKER_NAME,
      version_id: cloudflareVersion?.versionId ?? null,
      source_commit: cloudflareVersion?.sourceCommit ?? sourceCommit,
      transport: "QUALIFIED_EXACT",
    },
  };
  writePrivateFile(
    join(privateRoot, "completion-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_.:-]+$/u.test(message) ? message : "V2_09_EXISTING_PAIR_REPAIR_FAILED";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute !== true) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "videoforge-v2-09-existing-pair-repair/v1",
        state: "AWAITING_EXPLICIT_EXECUTE",
        provider_mutation: false,
        compute_started: false,
      })}\n`,
    );
    return;
  }
  try {
    process.stdout.write(`${JSON.stringify(await execute(args))}\n`);
  } catch (error) {
    process.stderr.write(`${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
