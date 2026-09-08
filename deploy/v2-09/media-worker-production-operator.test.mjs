import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createV209MediaWorkerProductionPorts as createProductionPorts,
  createV209MediaWorkerProductionPortsForTest,
  validateV209MediaWorkerLocalReadinessForTest,
  validateV209MediaWorkerMaterializationReceipt,
  resumeV209MediaWorkerUserConfirmation as resumeProductionConfirmation,
  resumeV209MediaWorkerUserConfirmationForTest,
  V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
  V209_MEDIA_WORKER_CONFIRMATION_SCHEMA,
  V209_MEDIA_WORKER_EXISTING_RELEASE_MODE,
  V209_MEDIA_WORKER_LOCAL_READINESS_SCHEMA,
  V209_MEDIA_WORKER_MATERIALIZATION_MODE,
  V209_MEDIA_WORKER_MATERIALIZATION_RECEIPT_SCHEMA,
  V209MediaWorkerUserConfirmationRequired,
} from "./media-worker-production-operator.mjs";

const sourceCommit = "a".repeat(40);
const executionBundleSha256 = `sha256:${"6".repeat(64)}`;
const whisperModelSha256 = `sha256:${"7".repeat(64)}`;
const macosSha256 = `sha256:${"8".repeat(64)}`;
const windowsSha256 = `sha256:${"9".repeat(64)}`;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function repeatedSha256(byte, size, chunkSize) {
  const digest = createHash("sha256");
  const chunk = Buffer.alloc(chunkSize, byte);
  for (let offset = 0; offset < size; offset += chunkSize)
    digest.update(chunk.subarray(0, Math.min(chunkSize, size - offset)));
  return `sha256:${digest.digest("hex")}`;
}

const TEST_DEPENDENCY_IDENTITY_SHA256 = sha256(
  "media-worker-production-operator.test.mjs/focused-dependencies/v1",
);

function createV209MediaWorkerProductionPorts(configuration, options = {}) {
  return createV209MediaWorkerProductionPortsForTest(configuration, {
    testDependencyIdentitySha256: TEST_DEPENDENCY_IDENTITY_SHA256,
    ...options,
  });
}

function resumeV209MediaWorkerUserConfirmation(
  checkpoint,
  exactAuthority,
  configuration,
  options = {},
) {
  return resumeV209MediaWorkerUserConfirmationForTest(checkpoint, exactAuthority, configuration, {
    testDependencyIdentitySha256: TEST_DEPENDENCY_IDENTITY_SHA256,
    ...options,
  });
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  return value;
}

function fixture({ macosBytes } = {}) {
  const effectiveMacosSha256 = macosBytes ? sha256(macosBytes) : macosSha256;
  const effectiveMacosSize = macosBytes ? macosBytes.byteLength : 285_000_000;
  const manifest = sortObject({
    schema_version: "videoforge-media-worker-release/v1",
    version: "0.1.16",
    minimum_protocol_version: 1,
    execution_bundle_sha256: executionBundleSha256,
    whisper_model_sha256: whisperModelSha256,
    windows: {
      url: "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.16/VideoForge-Worker-0.1.16-Setup.exe",
      sha256: windowsSha256,
      size_bytes: 225_000_000,
      trust: "UNSIGNED_BETA",
    },
    macos: {
      url: "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.16/VideoForge-Worker-0.1.16.dmg",
      sha256: effectiveMacosSha256,
      size_bytes: effectiveMacosSize,
      trust: "AD_HOC_BETA",
    },
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha256 = sha256(manifestBytes);
  const asset = (name, size, digest, contentType = "application/octet-stream") => ({
    name,
    size,
    digest,
    state: "uploaded",
    content_type: contentType,
    browser_download_url: `https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.16/${name}`,
  });
  const release = {
    tag_name: "media-worker-v0.1.16",
    target_commitish: sourceCommit,
    html_url: "https://github.com/Pala-LakshmanSai/videoforge/releases/tag/media-worker-v0.1.16",
    draft: false,
    prerelease: false,
    immutable: true,
    assets: [
      asset("VideoForge-Worker-0.1.16-Setup.exe", 225_000_000, windowsSha256),
      asset("VideoForge-Worker-0.1.16.dmg", effectiveMacosSize, effectiveMacosSha256),
      asset(
        "media-worker-release.json",
        manifestBytes.byteLength,
        manifestSha256,
        "application/json",
      ),
    ],
  };
  return {
    effectiveMacosSha256,
    manifest,
    manifestBytes,
    manifestSha256,
    release,
  };
}

function authority(manifestSha256, overrides = {}, installerAssetSha256 = macosSha256) {
  return {
    authority_id: "v2-09-media-worker-test-authority",
    source_commit: sourceCommit,
    issued_at: "2026-09-06T11:00:00Z",
    expires_at: "2026-09-06T13:00:00Z",
    media_worker: {
      release: "0.1.16",
      execution_bundle_sha256: executionBundleSha256,
      whisper_model_sha256: whisperModelSha256,
      release_manifest_sha256: manifestSha256,
      installer_asset_sha256: installerAssetSha256,
      signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
    },
    scope: {
      media_worker_release: "0.1.16",
      allow_model_download: false,
      allow_stage_6_or_7_qualification: false,
      cleanup_only_recovery: true,
    },
    ...overrides,
  };
}

function stagedAuthority(overrides = {}) {
  return {
    authority_id: "v2-09-media-worker-staged-test-authority",
    source_commit: sourceCommit,
    issued_at: "2026-09-06T11:00:00Z",
    expires_at: "2026-09-06T13:00:00Z",
    media_worker: {
      release: "0.1.16",
      materialization_mode: V209_MEDIA_WORKER_MATERIALIZATION_MODE,
      execution_bundle_sha256: executionBundleSha256,
      whisper_model_sha256: whisperModelSha256,
    },
    scope: {
      media_worker_release: "0.1.16",
      allow_media_worker_materialization_once: true,
      allow_model_download: false,
      allow_stage_6_or_7_qualification: false,
      cleanup_only_recovery: true,
    },
    ...overrides,
  };
}

function adoptionAuthority(releaseFixture, overrides = {}) {
  return {
    authority_id: "v2-09-media-worker-adoption-test-authority",
    source_commit: sourceCommit,
    issued_at: "2026-09-06T11:00:00Z",
    expires_at: "2026-09-06T13:00:00Z",
    media_worker: {
      release: "0.1.16",
      materialization_mode: V209_MEDIA_WORKER_EXISTING_RELEASE_MODE,
      release_source_commit: "b".repeat(40),
      execution_bundle_sha256: executionBundleSha256,
      whisper_model_sha256: whisperModelSha256,
      release_manifest_sha256: releaseFixture.manifestSha256,
      installer_asset_sha256: releaseFixture.macosDigest,
      windows_installer_asset_sha256: releaseFixture.windowsDigest,
      signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
    },
    scope: {
      media_worker_release: "0.1.16",
      allow_media_worker_existing_release_adoption_once: true,
      allow_model_download: false,
      allow_stage_6_or_7_qualification: false,
      cleanup_only_recovery: true,
    },
    ...overrides,
  };
}

function stagedFixture() {
  const windowsBytes = Buffer.from("exact-windows-installer");
  const macosBytes = Buffer.from("exact-macos-dmg");
  const windowsDigest = sha256(windowsBytes);
  const macosDigest = sha256(macosBytes);
  const base = fixture({ macosBytes });
  base.manifest.windows.sha256 = windowsDigest;
  base.manifest.windows.size_bytes = windowsBytes.byteLength;
  base.manifestBytes = Buffer.from(`${JSON.stringify(sortObject(base.manifest), null, 2)}\n`);
  base.manifestSha256 = sha256(base.manifestBytes);
  base.release.assets = [
    {
      ...base.release.assets[0],
      size: windowsBytes.byteLength,
      digest: windowsDigest,
    },
    { ...base.release.assets[1], size: macosBytes.byteLength, digest: macosDigest },
    {
      ...base.release.assets[2],
      size: base.manifestBytes.byteLength,
      digest: base.manifestSha256,
    },
  ];
  return {
    ...base,
    macosBytes,
    windowsBytes,
    macosDigest,
    windowsDigest,
  };
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "videoforge-v209-media-test-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const privateRoot = join(home, "Library", "Application Support", "VideoForge V2-09");
  const githubConfigRoot = join(home, ".config", "gh");
  for (const path of [
    home,
    repo,
    privateRoot,
    join(home, "Applications"),
    join(home, "Library", "LaunchAgents"),
    join(home, "Library", "Application Support", "VideoForge Worker"),
    githubConfigRoot,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const configuration = {
    repository: "Pala-LakshmanSai/videoforge",
    workflowPath: ".github/workflows/media-worker-release.yml",
    releaseTag: "media-worker-v0.1.16",
    version: "0.1.16",
    sourceCommit,
    branch: "codex/serverless-v2-roadmap-v4",
    root: repo,
    databaseCredentialPath: join(privateRoot, "operator-database-url"),
    controlPlaneOrigin: "https://videoforge.example.test",
    applicationPath: join(home, "Applications", "VideoForge Worker.app"),
    statePath: join(
      home,
      "Library",
      "Application Support",
      "VideoForge Worker",
      "installation.json",
    ),
    launchAgentPath: join(
      home,
      "Library",
      "LaunchAgents",
      "com.videoforge.personal-media-worker.plist",
    ),
    manifestPath: join(privateRoot, "media-worker-release.json"),
    workRoot: join(privateRoot, "work"),
    environment: {
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      GH_CONFIG_DIR: githubConfigRoot,
      PGDATABASE: "videoforge",
      PGHOST: "test.invalid",
      PGPASSWORD: "not-a-live-secret",
      PGPORT: "5432",
      PGCHANNELBINDING: "require",
      PGSSLMODE: "require",
      PGUSER: "videoforge_operator",
    },
  };
  configuration.heartbeatCredentialPath = join(privateRoot, "owner-database-url");
  configuration.heartbeatEnvironment = {
    ...configuration.environment,
    PGUSER: "videoforge_owner",
    PGPASSWORD: "owner-secret-for-heartbeat-only",
  };
  writeFileSync(configuration.heartbeatCredentialPath, "protected owner credential", {
    mode: 0o600,
  });
  writeFileSync(configuration.databaseCredentialPath, "protected credential", { mode: 0o600 });
  chmodSync(configuration.databaseCredentialPath, 0o600);
  writeFileSync(join(githubConfigRoot, "hosts.yml"), "github.com:\n  user: test\n", {
    mode: 0o600,
  });
  chmodSync(join(githubConfigRoot, "hosts.yml"), 0o600);
  return { configuration, home, remove: () => rmSync(root, { recursive: true, force: true }) };
}

function prepareLocalReadiness(box) {
  const installationId = "11111111-1111-4111-8111-111111111111";
  writeFileSync(box.configuration.statePath, JSON.stringify({ installation_id: installationId }), {
    mode: 0o600,
  });
  chmodSync(box.configuration.statePath, 0o600);
  writeFileSync(box.configuration.launchAgentPath, "plist", { mode: 0o600 });
  chmodSync(box.configuration.launchAgentPath, 0o600);
  mkdirSync(box.configuration.applicationPath, { recursive: true, mode: 0o755 });
  chmodSync(box.configuration.applicationPath, 0o755);
  mkdirSync(box.configuration.workRoot, { recursive: true, mode: 0o700 });
  chmodSync(box.configuration.workRoot, 0o700);
  return installationId;
}

function localReadinessOptions(box, { keychainStatus = 0, launchAgentValid = true } = {}) {
  const commands = [];
  const success = (stdout = "", stderr = "") => ({ status: 0, signal: null, stdout, stderr });
  const runChild = async (request) => {
    commands.push(request);
    if (request.command === "/usr/bin/security")
      return {
        status: keychainStatus,
        signal: null,
        stdout: "keychain metadata only",
        stderr: "",
      };
    if (request.command === "/usr/libexec/PlistBuddy") {
      const key = request.args[1];
      if (!launchAgentValid) return { status: 0, signal: null, stdout: "wrong", stderr: "" };
      if (key === "Print :Label") return success("com.videoforge.personal-media-worker\n");
      if (key === "Print :ProgramArguments:0")
        return success(
          `${join(box.configuration.applicationPath, "Contents", "MacOS", "VideoForge Worker")}\n`,
        );
      if (key === "Print :ProgramArguments:1") return success("--background\n");
      if (key === "Print :RunAtLoad") return success("true\n");
    }
    throw new Error(`unexpected local readiness command: ${request.command}`);
  };
  const options = {
    clock: () => 0,
    fetchImpl: async () => {
      throw new Error("network must not be used");
    },
    movePath: renameSync,
    runChild,
    sleep: async () => {},
    hostHome: box.home,
    hostPlatform: "darwin",
    hostUid: 501,
    testDependencyIdentitySha256: TEST_DEPENDENCY_IDENTITY_SHA256,
  };
  Object.defineProperty(options, "commands", { value: commands });
  return options;
}

function fetchFixture({ releaseStatus = 200, release, manifestBytes }) {
  const calls = [];
  const api =
    "https://api.github.com/repos/Pala-LakshmanSai/videoforge/releases/tags/media-worker-v0.1.16";
  const manifestUrl =
    "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.16/media-worker-release.json";
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === api) {
      if (releaseStatus === 404) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify(release), { status: 200 });
    }
    if (url === manifestUrl) return new Response(manifestBytes, { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  return { calls, fetchImpl };
}

const clock = () => new Date("2026-09-06T12:00:00Z");

function installFailureHarness(
  box,
  releaseFixture,
  { failStaging = false, failBootstrap = false } = {},
) {
  const installationId = "11111111-1111-4111-8111-111111111111";
  writeFileSync(box.configuration.statePath, JSON.stringify({ installation_id: installationId }), {
    mode: 0o600,
  });
  chmodSync(box.configuration.statePath, 0o600);
  writeFileSync(box.configuration.launchAgentPath, "plist", { mode: 0o600 });
  mkdirSync(box.configuration.applicationPath, { recursive: true });
  writeFileSync(join(box.configuration.applicationPath, "old-version"), "0.1.14");
  const commands = [];
  let serviceLoaded = true;
  let bootstrapAttempts = 0;
  const success = (stdout = "", stderr = "") => ({ status: 0, signal: null, stdout, stderr });
  const runChild = async (request) => {
    commands.push([request.command, ...request.args]);
    if (request.command === "/usr/bin/security") return success("keychain metadata only");
    if (request.command === "/usr/bin/hdiutil" && request.args[0] === "attach") {
      const mount = request.args[request.args.indexOf("-mountpoint") + 1];
      const contents = join(mount, "VideoForge Worker.app", "Contents");
      mkdirSync(join(contents, "MacOS"), { recursive: true });
      writeFileSync(join(contents, "Info.plist"), "plist");
      writeFileSync(join(contents, "MacOS", "VideoForge Worker"), "binary", { mode: 0o755 });
      return success();
    }
    if (request.command === "/usr/bin/codesign" && request.args[0] === "--verify") {
      if (failStaging && request.args.at(-1).endsWith(".staging"))
        return { status: 1, signal: null, stdout: "", stderr: "bad signature" };
      return success();
    }
    if (request.command === "/usr/bin/codesign" && request.args[0] === "-d")
      return success(
        "",
        "Identifier=com.videoforge.personal-media-worker\nSignature=adhoc\nTeamIdentifier=not set\n",
      );
    if (request.command === "/usr/libexec/PlistBuddy") {
      const key = request.args[1];
      if (key === "Print :Label") return success("com.videoforge.personal-media-worker\n");
      if (key === "Print :ProgramArguments:0")
        return success(
          `${join(box.configuration.applicationPath, "Contents", "MacOS", "VideoForge Worker")}\n`,
        );
      if (key === "Print :ProgramArguments:1") return success("--background\n");
      if (key === "Print :RunAtLoad") return success("true\n");
      return success("0.1.16\n");
    }
    if (request.command === "/usr/bin/file")
      return success(
        request.args[0].endsWith("VideoForge Worker")
          ? `${request.args[0]}: Mach-O universal binary`
          : `${request.args[0]}: ASCII text`,
      );
    if (request.command === "/usr/bin/ditto") {
      cpSync(request.args[0], request.args[1], { recursive: true });
      return success();
    }
    if (request.command === "/bin/launchctl") {
      if (request.args[0] === "print")
        return serviceLoaded
          ? success("loaded")
          : { status: 113, signal: null, stdout: "", stderr: "not loaded" };
      if (request.args[0] === "bootout") {
        serviceLoaded = false;
        return success();
      }
      if (request.args[0] === "bootstrap") {
        bootstrapAttempts += 1;
        if (failBootstrap && bootstrapAttempts === 1) {
          serviceLoaded = true;
          return { status: 1, signal: null, stdout: "", stderr: "partial failure" };
        }
        serviceLoaded = true;
        return success();
      }
    }
    if (request.command === "psql" && request.args.at(-1).includes("V209_HEARTBEAT_READ_ALLOWED"))
      return success("V209_HEARTBEAT_READ_ALLOWED");
    if (request.command === "psql")
      return success(
        JSON.stringify({
          installation_id: installationId,
          platform: "MACOS",
          architecture: "AARCH64",
          worker_version: "0.1.16",
          protocol_version: 1,
          execution_bundle_sha256: executionBundleSha256,
          status: "ONLINE",
          last_seen_at: "2026-09-06T12:00:00.000Z",
        }),
      );
    return success();
  };
  const apiUrl =
    "https://api.github.com/repos/Pala-LakshmanSai/videoforge/releases/tags/media-worker-v0.1.16";
  const manifestUrl =
    "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.16/media-worker-release.json";
  const fetchImpl = async (url) => {
    if (url === apiUrl)
      return new Response(JSON.stringify(releaseFixture.release), { status: 200 });
    if (url === manifestUrl) return new Response(releaseFixture.manifestBytes, { status: 200 });
    if (url === releaseFixture.manifest.macos.url)
      return new Response(Buffer.from("exact-test-dmg"), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  return { commands, fetchImpl, runChild };
}

test("provider-free local readiness returns only hash and boolean facts", async () => {
  const box = sandbox();
  try {
    prepareLocalReadiness(box);
    const options = localReadinessOptions(box);
    const result = await validateV209MediaWorkerLocalReadinessForTest(box.configuration, options);
    assert.deepEqual(Object.keys(result).sort(), [
      "application_path_valid",
      "configuration_sha256",
      "installation_state_sha256",
      "installation_state_valid",
      "keychain_entry_present",
      "launch_agent_valid",
      "platform_valid",
      "readiness_sha256",
      "schema_version",
      "uid_valid",
      "work_root_valid",
    ]);
    assert.equal(result.schema_version, V209_MEDIA_WORKER_LOCAL_READINESS_SCHEMA);
    for (const key of [
      "platform_valid",
      "uid_valid",
      "installation_state_valid",
      "keychain_entry_present",
      "launch_agent_valid",
      "application_path_valid",
      "work_root_valid",
    ])
      assert.equal(result[key], true);
    for (const key of ["configuration_sha256", "installation_state_sha256", "readiness_sha256"])
      assert.match(result[key], /^sha256:[0-9a-f]{64}$/u);
    assert.equal("installation_id" in result, false);
    assert.equal(
      options.commands.filter(({ command }) => command === "/usr/bin/security").length,
      1,
    );
    const security = options.commands.find(({ command }) => command === "/usr/bin/security");
    assert.deepEqual(security.args, [
      "find-generic-password",
      "-s",
      "com.videoforge.personal-media-worker",
      "-a",
      "11111111-1111-4111-8111-111111111111",
    ]);
    assert.equal(security.args.includes("-w"), false);
    assert.equal(security.options.env.PGPASSWORD, undefined);
    assert.equal(security.options.env.PGUSER, undefined);
  } finally {
    box.remove();
  }
});

test("local readiness rejects missing or unsafe prerequisites without confirmation or network", async (t) => {
  const scenarios = [
    {
      name: "non-darwin host",
      mutate: () => {},
      options: (box) => {
        const options = localReadinessOptions(box);
        options.hostPlatform = "linux";
        return options;
      },
      error: /V2_09_MEDIA_WORKER_READINESS_HOST_INVALID/u,
    },
    {
      name: "missing installation state",
      mutate: (box) => rmSync(box.configuration.statePath),
      options: (box) => localReadinessOptions(box),
      error: /V2_09_MEDIA_WORKER_READINESS_INSTALLATION_STATE_MISSING/u,
    },
    {
      name: "missing keychain item",
      mutate: () => {},
      options: (box) => localReadinessOptions(box, { keychainStatus: 44 }),
      error: /V2_09_MEDIA_WORKER_READINESS_KEYCHAIN_ENTRY_MISSING/u,
    },
    {
      name: "invalid launch agent",
      mutate: () => {},
      options: (box) => localReadinessOptions(box, { launchAgentValid: false }),
      error: /V2_09_MEDIA_WORKER_LAUNCH_AGENT_INVALID/u,
    },
    {
      name: "application symlink",
      mutate: (box) => {
        const target = join(box.home, "Applications", "worker-target");
        mkdirSync(target, { mode: 0o755 });
        rmSync(box.configuration.applicationPath, { recursive: true, force: true });
        symlinkSync(target, box.configuration.applicationPath);
      },
      options: (box) => localReadinessOptions(box),
      error: /V2_09_MEDIA_WORKER_READINESS_APPLICATION_INVALID/u,
    },
    {
      name: "work root is not exact private mode",
      mutate: (box) => chmodSync(box.configuration.workRoot, 0o750),
      options: (box) => localReadinessOptions(box),
      error: /V2_09_MEDIA_WORKER_READINESS_WORK_ROOT_INVALID/u,
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const box = sandbox();
      try {
        prepareLocalReadiness(box);
        scenario.mutate(box);
        const options = scenario.options(box);
        await assert.rejects(
          validateV209MediaWorkerLocalReadinessForTest(box.configuration, options),
          scenario.error,
        );
        assert.equal(
          options.commands.filter(({ command }) => command === "/usr/bin/security").length,
          scenario.name === "missing keychain item" ? 1 : 0,
        );
      } finally {
        box.remove();
      }
    });
  }
});

test("factory is zero-mutation and source-identifies all three exact concrete ports", () => {
  const box = sandbox();
  try {
    let calls = 0;
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not fetch");
      },
    });
    assert.deepEqual(Object.keys(ports).sort(), [
      "installMediaWorker",
      "publishMediaWorker",
      "readbackMediaWorker",
    ]);
    for (const descriptor of Object.values(ports)) {
      assert.match(descriptor.source_sha256, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(typeof descriptor.run, "function");
    }
    assert.equal(calls, 0);
  } finally {
    box.remove();
  }
});

test("readback verifies every immutable asset and atomically materializes the exact manifest", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  const net = fetchFixture(releaseFixture);
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: net.fetchImpl,
      clock,
    });
    const result = await ports.readbackMediaWorker.run({
      operationId: "readback-media-worker-0.1.16",
      authority: authority(releaseFixture.manifestSha256),
    });
    assert.deepEqual(result, {
      schema_version: "videoforge.v2-09-media-worker-readback-result/v1",
      operation_id: "readback-media-worker-0.1.16",
      release: "0.1.16",
      execution_bundle_sha256: executionBundleSha256,
      whisper_model_sha256: whisperModelSha256,
      release_manifest_sha256: releaseFixture.manifestSha256,
      installer_asset_sha256: macosSha256,
      immutable_readback: true,
      release_asset_count: 3,
    });
    assert.deepEqual(readFileSync(box.configuration.manifestPath), releaseFixture.manifestBytes);
    assert.equal(statSync(box.configuration.manifestPath).mode & 0o777, 0o600);
    assert.equal(net.calls.length, 2);
  } finally {
    box.remove();
  }
});

test("publish dispatches the exact workflow once and accepts only its exact successful source run", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  const childCalls = [];
  let listCalls = 0;
  const runChild = async (request) => {
    childCalls.push(request);
    if (request.command !== "gh") throw new Error("unexpected command");
    if (request.args.includes("--method"))
      return { status: 0, signal: null, stdout: "", stderr: "" };
    listCalls += 1;
    const workflow_runs =
      listCalls === 1
        ? []
        : [
            {
              head_sha: sourceCommit,
              head_branch: "wrong-branch",
              event: "workflow_dispatch",
              path: ".github/workflows/media-worker-release.yml",
              status: "completed",
              conclusion: "success",
              created_at: "2026-09-06T12:00:00Z",
              run_attempt: 1,
            },
            {
              head_sha: sourceCommit,
              head_branch: "codex/serverless-v2-roadmap-v4",
              event: "workflow_dispatch",
              path: ".github/workflows/media-worker-release.yml@refs/heads/codex/serverless-v2-roadmap-v4",
              status: "completed",
              conclusion: "success",
              created_at: "2026-09-06T12:00:00Z",
              run_attempt: 1,
            },
            {
              head_sha: sourceCommit,
              head_branch: "codex/serverless-v2-roadmap-v4",
              event: "workflow_dispatch",
              path: ".github/workflows/media-worker-release.yml",
              status: "completed",
              conclusion: "success",
              created_at: "2026-09-06T12:00:00Z",
              run_attempt: 1,
            },
          ];
    return { status: 0, signal: null, stdout: JSON.stringify({ workflow_runs }), stderr: "" };
  };
  // The absence check is one-shot; after dispatch the exact release must exist.
  let apiCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/releases/tags/")) {
      apiCalls += 1;
      if (apiCalls === 1) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify(releaseFixture.release), { status: 200 });
    }
    return new Response(releaseFixture.manifestBytes, { status: 200 });
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild,
      fetchImpl,
      clock,
      sleep: async () => {},
    });
    const capturedPortIdentity = ports.publishMediaWorker.source_sha256;
    const originalPath = box.configuration.environment.PATH;
    box.configuration.environment.PATH = "/tmp/untrusted-bin";
    box.configuration.environment.PGHOST = "mutated-after-construction.invalid";
    box.configuration.environment.NODE_OPTIONS = "--require=/tmp/untrusted.cjs";
    box.configuration.controlPlaneOrigin = "https://mutated-after-construction.invalid";
    box.configuration.sourceCommit = "f".repeat(40);
    const result = await ports.publishMediaWorker.run({
      operationId: "publish-media-worker-0.1.16",
      authority: authority(releaseFixture.manifestSha256),
    });
    assert.equal(result.mode, "PUBLISHED_ONCE");
    assert.equal(result.publish_count, 1);
    const dispatches = childCalls.filter((call) => call.args.includes("--method"));
    assert.equal(dispatches.length, 1);
    const body = JSON.parse(dispatches[0].options.input);
    assert.deepEqual(body, {
      inputs: {
        control_plane_origin: "https://videoforge.example.test",
        execution_bundle_sha256: executionBundleSha256,
        publish_release: "true",
        release_tag: "media-worker-v0.1.16",
        signed_release: "false",
        whisper_model_sha256: whisperModelSha256,
      },
      ref: "codex/serverless-v2-roadmap-v4",
    });
    assert.equal(listCalls, 2);
    assert.equal(ports.publishMediaWorker.source_sha256, capturedPortIdentity);
    for (const call of childCalls) {
      assert.equal(Object.isFrozen(call.options.env), true);
      assert.equal(call.options.env.PATH, originalPath);
      assert.equal(call.options.env.PGHOST, "test.invalid");
      assert.equal(call.options.env.PGCHANNELBINDING, "require");
      assert.equal(call.options.env.NODE_OPTIONS, undefined);
    }
  } finally {
    box.remove();
  }
});

test("staged materialization dispatches once and derives a deterministic closed-world receipt", async () => {
  const box = sandbox();
  const releaseFixture = stagedFixture();
  const childCalls = [];
  let listCalls = 0;
  const runChild = async (request) => {
    childCalls.push(request);
    if (request.args.includes("--method"))
      return { status: 0, signal: null, stdout: "", stderr: "" };
    listCalls += 1;
    const workflow_runs =
      listCalls === 1
        ? []
        : [
            {
              head_sha: sourceCommit,
              head_branch: "codex/serverless-v2-roadmap-v4",
              event: "workflow_dispatch",
              path: ".github/workflows/media-worker-release.yml",
              status: "completed",
              conclusion: "success",
              created_at: "2026-09-06T12:00:00Z",
              run_attempt: 1,
            },
          ];
    return { status: 0, signal: null, stdout: JSON.stringify({ workflow_runs }), stderr: "" };
  };
  let releaseReads = 0;
  const bytesByName = new Map([
    ["VideoForge-Worker-0.1.16-Setup.exe", releaseFixture.windowsBytes],
    ["VideoForge-Worker-0.1.16.dmg", releaseFixture.macosBytes],
    ["media-worker-release.json", releaseFixture.manifestBytes],
  ]);
  const fetchImpl = async (url) => {
    if (url.includes("api.github.com/")) {
      releaseReads += 1;
      if (releaseReads === 1) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify(releaseFixture.release), { status: 200 });
    }
    const name = url.split("/").at(-1);
    if (!bytesByName.has(name)) throw new Error(`unexpected asset ${name}`);
    return new Response(bytesByName.get(name), { status: 200 });
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild,
      fetchImpl,
      clock,
      sleep: async () => {},
    });
    const result = await ports.publishMediaWorker.run({
      operationId: "publish-media-worker-0.1.16",
      authority: stagedAuthority(),
    });
    assert.equal(result.mode, "MATERIALIZED_ONCE");
    assert.equal(result.publish_count, 1);
    assert.deepEqual(result.materialization_receipt, {
      schema_version: V209_MEDIA_WORKER_MATERIALIZATION_RECEIPT_SCHEMA,
      authority_id: "v2-09-media-worker-staged-test-authority",
      source_commit: sourceCommit,
      repository: "Pala-LakshmanSai/videoforge",
      workflow_path: ".github/workflows/media-worker-release.yml",
      release_tag: "media-worker-v0.1.16",
      release: "0.1.16",
      release_manifest_sha256: releaseFixture.manifestSha256,
      installer_asset_sha256: releaseFixture.macosDigest,
      windows_installer_asset_sha256: releaseFixture.windowsDigest,
      execution_bundle_sha256: executionBundleSha256,
      whisper_model_sha256: whisperModelSha256,
      signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
      immutable_release: true,
      release_asset_count: 3,
      materialization_receipt_sha256: result.materialization_receipt.materialization_receipt_sha256,
    });
    assert.match(
      result.materialization_receipt.materialization_receipt_sha256,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.deepEqual(
      validateV209MediaWorkerMaterializationReceipt(
        result.materialization_receipt,
        stagedAuthority(),
        sourceCommit,
        clock,
      ),
      {
        release: "0.1.16",
        execution_bundle_sha256: executionBundleSha256,
        whisper_model_sha256: whisperModelSha256,
        release_manifest_sha256: releaseFixture.manifestSha256,
        installer_asset_sha256: releaseFixture.macosDigest,
        signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
      },
    );
    assert.throws(
      () =>
        validateV209MediaWorkerMaterializationReceipt(
          { ...result.materialization_receipt, installer_asset_sha256: macosSha256 },
          stagedAuthority(),
          sourceCommit,
          clock,
        ),
      /V2_09_MEDIA_WORKER_MATERIALIZATION_RECEIPT_INVALID/u,
    );
    assert.equal(childCalls.filter((call) => call.args.includes("--method")).length, 1);
    assert.equal(releaseReads, 2);
  } finally {
    box.remove();
  }
});

test("exact-existing adoption fully verifies the source-split immutable release without dispatch", async () => {
  const box = sandbox();
  const releaseFixture = stagedFixture();
  releaseFixture.release.target_commitish = "b".repeat(40);
  const bytesByName = new Map([
    ["VideoForge-Worker-0.1.16-Setup.exe", releaseFixture.windowsBytes],
    ["VideoForge-Worker-0.1.16.dmg", releaseFixture.macosBytes],
    ["media-worker-release.json", releaseFixture.manifestBytes],
  ]);
  let childCalls = 0;
  let releaseReads = 0;
  const fetchImpl = async (url) => {
    if (url.includes("api.github.com/")) {
      releaseReads += 1;
      return new Response(JSON.stringify(releaseFixture.release), { status: 200 });
    }
    const name = url.split("/").at(-1);
    if (!bytesByName.has(name)) throw new Error(`unexpected asset ${name}`);
    return new Response(bytesByName.get(name), { status: 200 });
  };
  try {
    const exactAuthority = adoptionAuthority(releaseFixture);
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild: async () => {
        childCalls += 1;
        throw new Error("adoption must not inspect or dispatch a workflow");
      },
      fetchImpl,
      clock,
    });
    const result = await ports.publishMediaWorker.run({
      operationId: "publish-media-worker-0.1.16",
      authority: exactAuthority,
    });
    assert.equal(result.mode, "ADOPTED_EXACT_EXISTING");
    assert.equal(result.publish_count, 0);
    assert.equal(result.materialization_receipt.release_source_commit, "b".repeat(40));
    assert.equal(childCalls, 0);
    assert.equal(releaseReads, 2);
    assert.deepEqual(
      validateV209MediaWorkerMaterializationReceipt(
        result.materialization_receipt,
        exactAuthority,
        sourceCommit,
        clock,
      ),
      exactAuthority.media_worker,
    );
    const wrongAssetAuthority = adoptionAuthority(releaseFixture);
    wrongAssetAuthority.media_worker.windows_installer_asset_sha256 = windowsSha256;
    assert.throws(
      () =>
        validateV209MediaWorkerMaterializationReceipt(
          result.materialization_receipt,
          wrongAssetAuthority,
          sourceCommit,
          clock,
        ),
      /V2_09_MEDIA_WORKER_MATERIALIZATION_RECEIPT_INVALID/u,
    );
  } finally {
    box.remove();
  }
});

test("exact-existing adoption fails closed on absence, provenance, metadata, or bytes", async (t) => {
  for (const scenario of ["missing", "provenance", "metadata", "bytes"]) {
    await t.test(scenario, async () => {
      const box = sandbox();
      const releaseFixture = stagedFixture();
      releaseFixture.release.target_commitish =
        scenario === "provenance" ? "c".repeat(40) : "b".repeat(40);
      const exactAuthority = adoptionAuthority(releaseFixture);
      if (scenario === "metadata")
        exactAuthority.media_worker.windows_installer_asset_sha256 = windowsSha256;
      const bytesByName = new Map([
        [
          "VideoForge-Worker-0.1.16-Setup.exe",
          scenario === "bytes" ? Buffer.from("tampered") : releaseFixture.windowsBytes,
        ],
        ["VideoForge-Worker-0.1.16.dmg", releaseFixture.macosBytes],
        ["media-worker-release.json", releaseFixture.manifestBytes],
      ]);
      let childCalls = 0;
      const fetchImpl = async (url) => {
        if (url.includes("api.github.com/"))
          return scenario === "missing"
            ? new Response("missing", { status: 404 })
            : new Response(JSON.stringify(releaseFixture.release), { status: 200 });
        const name = url.split("/").at(-1);
        return new Response(bytesByName.get(name), { status: 200 });
      };
      try {
        const ports = createV209MediaWorkerProductionPorts(box.configuration, {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
          runChild: async () => {
            childCalls += 1;
            throw new Error("adoption must not inspect or dispatch a workflow");
          },
          fetchImpl,
          clock,
        });
        await assert.rejects(
          ports.publishMediaWorker.run({
            operationId: "publish-media-worker-0.1.16",
            authority: exactAuthority,
          }),
          scenario === "missing"
            ? /V2_09_MEDIA_WORKER_ADOPTION_RELEASE_MISSING/u
            : scenario === "provenance"
              ? /V2_09_MEDIA_WORKER_RELEASE_METADATA_INVALID/u
              : scenario === "metadata"
                ? /V2_09_MEDIA_WORKER_RELEASE_AUTHORITY_DRIFT/u
                : /V2_09_MEDIA_WORKER_ASSET_DOWNLOAD_IDENTITY_INVALID/u,
        );
        assert.equal(childCalls, 0);
      } finally {
        box.remove();
      }
    });
  }
});

test("staged materialization rejects replay, ambiguous runs, and asset tamper", async (t) => {
  await t.test("replay", async () => {
    const box = sandbox();
    const releaseFixture = stagedFixture();
    let childCalls = 0;
    try {
      const ports = createV209MediaWorkerProductionPorts(box.configuration, {
        hostHome: box.home,
        hostPlatform: "darwin",
        hostUid: 501,
        runChild: async () => {
          childCalls += 1;
          throw new Error("must not dispatch");
        },
        fetchImpl: async () =>
          new Response(JSON.stringify(releaseFixture.release), { status: 200 }),
        clock,
      });
      await assert.rejects(
        ports.publishMediaWorker.run({
          operationId: "publish-media-worker-0.1.16",
          authority: stagedAuthority(),
        }),
        /V2_09_MEDIA_WORKER_MATERIALIZATION_REPLAY/u,
      );
      assert.equal(childCalls, 0);
    } finally {
      box.remove();
    }
  });

  for (const scenario of ["ambiguous", "tamper"]) {
    await t.test(scenario, async () => {
      const box = sandbox();
      const releaseFixture = stagedFixture();
      let listCalls = 0;
      let releaseReads = 0;
      const exactRun = {
        head_sha: sourceCommit,
        head_branch: "codex/serverless-v2-roadmap-v4",
        event: "workflow_dispatch",
        path: ".github/workflows/media-worker-release.yml",
        status: "completed",
        conclusion: "success",
        created_at: "2026-09-06T12:00:00Z",
        run_attempt: 1,
      };
      const runChild = async (request) => {
        if (request.args.includes("--method"))
          return { status: 0, signal: null, stdout: "", stderr: "" };
        listCalls += 1;
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            workflow_runs:
              listCalls === 1 ? [] : scenario === "ambiguous" ? [exactRun, exactRun] : [exactRun],
          }),
          stderr: "",
        };
      };
      const fetchImpl = async (url) => {
        if (url.includes("api.github.com/")) {
          releaseReads += 1;
          return releaseReads === 1
            ? new Response("missing", { status: 404 })
            : new Response(JSON.stringify(releaseFixture.release), { status: 200 });
        }
        const name = url.split("/").at(-1);
        const bytes =
          name === "VideoForge-Worker-0.1.16-Setup.exe"
            ? Buffer.from("tampered")
            : name === "VideoForge-Worker-0.1.16.dmg"
              ? releaseFixture.macosBytes
              : releaseFixture.manifestBytes;
        return new Response(bytes, { status: 200 });
      };
      try {
        const ports = createV209MediaWorkerProductionPorts(box.configuration, {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
          runChild,
          fetchImpl,
          clock,
          sleep: async () => {},
        });
        await assert.rejects(
          ports.publishMediaWorker.run({
            operationId: "publish-media-worker-0.1.16",
            authority: stagedAuthority(),
          }),
          scenario === "ambiguous"
            ? /V2_09_MEDIA_WORKER_WORKFLOW_DISPATCH_AMBIGUOUS/u
            : /V2_09_MEDIA_WORKER_ASSET_DOWNLOAD_IDENTITY_INVALID/u,
        );
      } finally {
        box.remove();
      }
    });
  }
});

test("staged materialization streams large assets sequentially without arrayBuffer retention", async () => {
  const box = sandbox();
  const releaseFixture = stagedFixture();
  const largeSize = 8 * 1024 * 1024;
  const chunkSize = 64 * 1024;
  const windowsDigest = repeatedSha256(0x61, largeSize, chunkSize);
  const macosDigest = repeatedSha256(0x62, largeSize, chunkSize);
  releaseFixture.manifest.windows.sha256 = windowsDigest;
  releaseFixture.manifest.windows.size_bytes = largeSize;
  releaseFixture.manifest.macos.sha256 = macosDigest;
  releaseFixture.manifest.macos.size_bytes = largeSize;
  releaseFixture.manifestBytes = Buffer.from(
    `${JSON.stringify(sortObject(releaseFixture.manifest), null, 2)}\n`,
  );
  releaseFixture.manifestSha256 = sha256(releaseFixture.manifestBytes);
  releaseFixture.release.assets[0].size = largeSize;
  releaseFixture.release.assets[0].digest = windowsDigest;
  releaseFixture.release.assets[1].size = largeSize;
  releaseFixture.release.assets[1].digest = macosDigest;
  releaseFixture.release.assets[2].size = releaseFixture.manifestBytes.byteLength;
  releaseFixture.release.assets[2].digest = releaseFixture.manifestSha256;
  let listCalls = 0;
  const exactRun = {
    head_sha: sourceCommit,
    head_branch: "codex/serverless-v2-roadmap-v4",
    event: "workflow_dispatch",
    path: ".github/workflows/media-worker-release.yml",
    status: "completed",
    conclusion: "success",
    created_at: "2026-09-06T12:00:00Z",
    run_attempt: 1,
  };
  const runChild = async (request) => {
    if (request.args.includes("--method"))
      return { status: 0, signal: null, stdout: "", stderr: "" };
    listCalls += 1;
    return {
      status: 0,
      signal: null,
      stdout: JSON.stringify({ workflow_runs: listCalls === 1 ? [] : [exactRun] }),
      stderr: "",
    };
  };
  let releaseReads = 0;
  let activeReaders = 0;
  let maximumActiveReaders = 0;
  let arrayBufferCalls = 0;
  const streamingResponse = (byte, size) => {
    let offset = 0;
    let started = false;
    return {
      status: 200,
      headers: new Headers({ "content-length": String(size) }),
      arrayBuffer: async () => {
        arrayBufferCalls += 1;
        throw new Error("large asset must not use arrayBuffer");
      },
      body: {
        getReader: () => ({
          read: async () => {
            if (!started) {
              started = true;
              activeReaders += 1;
              maximumActiveReaders = Math.max(maximumActiveReaders, activeReaders);
            }
            if (offset === size) {
              activeReaders -= 1;
              return { done: true };
            }
            const length = Math.min(chunkSize, size - offset);
            offset += length;
            return { done: false, value: new Uint8Array(length).fill(byte) };
          },
        }),
      },
    };
  };
  const fetchImpl = async (url) => {
    if (url.includes("api.github.com/")) {
      releaseReads += 1;
      return releaseReads === 1
        ? new Response("missing", { status: 404 })
        : new Response(JSON.stringify(releaseFixture.release), { status: 200 });
    }
    const name = url.split("/").at(-1);
    if (name === "VideoForge-Worker-0.1.16-Setup.exe") return streamingResponse(0x61, largeSize);
    if (name === "VideoForge-Worker-0.1.16.dmg") return streamingResponse(0x62, largeSize);
    return new Response(releaseFixture.manifestBytes, {
      status: 200,
      headers: { "content-length": String(releaseFixture.manifestBytes.byteLength) },
    });
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild,
      fetchImpl,
      clock,
      sleep: async () => {},
    });
    const result = await ports.publishMediaWorker.run({
      operationId: "publish-media-worker-0.1.16",
      authority: stagedAuthority(),
    });
    assert.equal(result.materialization_receipt.windows_installer_asset_sha256, windowsDigest);
    assert.equal(result.materialization_receipt.installer_asset_sha256, macosDigest);
    assert.equal(maximumActiveReaders, 1);
    assert.equal(activeReaders, 0);
    assert.equal(arrayBufferCalls, 0);
  } finally {
    box.remove();
  }
});

test("publish reuses only an already exact immutable release without dispatch", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  const net = fetchFixture(releaseFixture);
  let childCalls = 0;
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild: async () => {
        childCalls += 1;
        throw new Error("must not dispatch");
      },
      fetchImpl: net.fetchImpl,
      clock,
    });
    const result = await ports.publishMediaWorker.run({
      operationId: "publish-media-worker-0.1.16",
      authority: authority(releaseFixture.manifestSha256),
    });
    assert.equal(result.mode, "REUSED_EXACT_EXISTING");
    assert.equal(result.publish_count, 0);
    assert.equal(childCalls, 0);
  } finally {
    box.remove();
  }
});

test("release readback rejects a single binary asset digest drift", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  releaseFixture.release.assets[0].digest = `sha256:${"f".repeat(64)}`;
  const net = fetchFixture(releaseFixture);
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: net.fetchImpl,
      clock,
    });
    await assert.rejects(
      ports.readbackMediaWorker.run({
        operationId: "readback-media-worker-0.1.16",
        authority: authority(releaseFixture.manifestSha256),
      }),
      /V2_09_MEDIA_WORKER_MANIFEST_ASSET_DRIFT/u,
    );
  } finally {
    box.remove();
  }
});

test("expired authority stops before any read or mutation", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  let calls = 0;
  let phase = "checkpoint";
  const fetchImpl = async () => {
    calls += 1;
  };
  const runChild = async ({ command }) => {
    if (phase === "checkpoint") {
      calls += 1;
      throw new Error("must not run before confirmation");
    }
    return command === "/usr/bin/security"
      ? { status: 0, signal: null, stdout: "metadata only", stderr: "" }
      : {
          status: 0,
          signal: null,
          stderr: "",
          stdout: JSON.stringify({
            installation_id: "11111111-1111-4111-8111-111111111111",
            platform: "MACOS",
            architecture: "AARCH64",
            worker_version: "0.1.16",
            protocol_version: 1,
            execution_bundle_sha256: executionBundleSha256,
            status: "ONLINE",
            last_seen_at: "2026-09-06T12:00:00.000Z",
          }),
        };
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl,
      runChild,
      clock,
    });
    await assert.rejects(
      ports.publishMediaWorker.run({
        operationId: "publish-media-worker-0.1.16",
        authority: authority(releaseFixture.manifestSha256, {
          expires_at: "2026-09-06T11:59:59Z",
        }),
      }),
      /V2_09_MEDIA_WORKER_AUTHORITY_NOT_CURRENT/u,
    );
    assert.equal(calls, 0);
  } finally {
    box.remove();
  }
});

test("macOS install verifies the exact DMG and universal2 app, preserves pairing, and proves ONLINE", async () => {
  const box = sandbox();
  const dmgBytes = Buffer.from("exact-test-dmg");
  const releaseFixture = fixture({ macosBytes: dmgBytes });
  const installationId = "11111111-1111-4111-8111-111111111111";
  const stateBytes = Buffer.from(JSON.stringify({ installation_id: installationId }));
  writeFileSync(box.configuration.statePath, stateBytes, { mode: 0o600 });
  chmodSync(box.configuration.statePath, 0o600);
  writeFileSync(box.configuration.launchAgentPath, "plist", { mode: 0o600 });
  const oldApp = box.configuration.applicationPath;
  mkdirSync(oldApp, { recursive: true });
  writeFileSync(join(oldApp, "old-version"), "0.1.14");
  const commands = [];
  const success = (stdout = "", stderr = "") => ({ status: 0, signal: null, stdout, stderr });
  const runChild = async (request) => {
    commands.push([request.command, ...request.args]);
    if (request.command === "/usr/bin/security") return success("keychain metadata only");
    if (request.command === "/usr/bin/hdiutil" && request.args[0] === "attach") {
      const mount = request.args[request.args.indexOf("-mountpoint") + 1];
      const contents = join(mount, "VideoForge Worker.app", "Contents");
      mkdirSync(join(contents, "MacOS"), { recursive: true });
      writeFileSync(join(contents, "Info.plist"), "plist");
      writeFileSync(join(contents, "MacOS", "VideoForge Worker"), "binary", { mode: 0o755 });
      return success();
    }
    if (request.command === "/usr/bin/codesign" && request.args[0] === "-d")
      return success(
        "",
        "Identifier=com.videoforge.personal-media-worker\nSignature=adhoc\nTeamIdentifier=not set\n",
      );
    if (request.command === "/usr/libexec/PlistBuddy") {
      const key = request.args[1];
      if (key === "Print :Label") return success("com.videoforge.personal-media-worker\n");
      if (key === "Print :ProgramArguments:0")
        return success(`${join(oldApp, "Contents", "MacOS", "VideoForge Worker")}\n`);
      if (key === "Print :ProgramArguments:1") return success("--background\n");
      if (key === "Print :RunAtLoad") return success("true\n");
      return success("0.1.16\n");
    }
    if (request.command === "/usr/bin/file")
      return success(
        request.args[0].endsWith("VideoForge Worker")
          ? `${request.args[0]}: Mach-O universal binary`
          : `${request.args[0]}: ASCII text`,
      );
    if (request.command === "/usr/bin/ditto") {
      cpSync(request.args[0], request.args[1], { recursive: true });
      return success();
    }
    if (request.command === "psql" && request.args.at(-1).includes("V209_HEARTBEAT_READ_ALLOWED"))
      return success("V209_HEARTBEAT_READ_ALLOWED");
    if (request.command === "psql")
      return success(
        JSON.stringify({
          installation_id: installationId,
          platform: "MACOS",
          architecture: "AARCH64",
          worker_version: "0.1.16",
          protocol_version: 1,
          execution_bundle_sha256: executionBundleSha256,
          status: "ONLINE",
          last_seen_at: "2026-09-06T12:00:00.000Z",
        }),
      );
    return success();
  };
  const apiUrl =
    "https://api.github.com/repos/Pala-LakshmanSai/videoforge/releases/tags/media-worker-v0.1.16";
  const manifestUrl =
    "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.16/media-worker-release.json";
  const dmgUrl = releaseFixture.manifest.macos.url;
  const fetchImpl = async (url) => {
    if (url === apiUrl)
      return new Response(JSON.stringify(releaseFixture.release), { status: 200 });
    if (url === manifestUrl) return new Response(releaseFixture.manifestBytes, { status: 200 });
    if (url === dmgUrl) return new Response(dmgBytes, { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild,
      fetchImpl,
      clock,
      sleep: async () => {},
    });
    const result = await ports.installMediaWorker.run({
      operationId: "install-media-worker-0.1.16",
      authority: authority(releaseFixture.manifestSha256, {}, releaseFixture.effectiveMacosSha256),
    });
    assert.equal(result.release, "0.1.16");
    assert.equal(result.installer_asset_sha256, releaseFixture.effectiveMacosSha256);
    assert.equal(result.code_signature_verified, true);
    assert.equal(result.online, true);
    assert.match(result.installed_release_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(result.online_heartbeat_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(readFileSync(box.configuration.statePath), stateBytes);
    assert.equal(existsSync(join(oldApp, "old-version")), false);
    assert.equal(existsSync(join(oldApp, "Contents", "MacOS", "VideoForge Worker")), true);
    assert.ok(commands.some(([command]) => command === "/usr/bin/lipo"));
    assert.ok(
      commands.some(([command, verb]) => command === "/bin/launchctl" && verb === "bootstrap"),
    );
    assert.ok(commands.some(([command]) => command === "psql"));
    for (const command of commands.filter(([name]) => name === "/usr/bin/security"))
      assert.equal(command.includes("-w"), false);
  } finally {
    box.remove();
  }
});

test("staging verification failure occurs before the existing service is stopped", async () => {
  const box = sandbox();
  const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
  const harness = installFailureHarness(box, releaseFixture, { failStaging: true });
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: harness.fetchImpl,
      runChild: harness.runChild,
      clock,
    });
    await assert.rejects(
      ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(
          releaseFixture.manifestSha256,
          {},
          releaseFixture.effectiveMacosSha256,
        ),
      }),
      /V2_09_MEDIA_WORKER_APP_CODE_SIGNATURE_INVALID/u,
    );
    assert.equal(
      harness.commands.some(
        ([command, verb]) => command === "/bin/launchctl" && verb === "bootout",
      ),
      false,
    );
    assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
  } finally {
    box.remove();
  }
});

test("a failure immediately after stop reboots the untouched old service", async () => {
  const box = sandbox();
  const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
  const harness = installFailureHarness(box, releaseFixture);
  const movePath = () => {
    throw new Error("injected first move failure");
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: harness.fetchImpl,
      runChild: harness.runChild,
      movePath,
      clock,
    });
    await assert.rejects(
      ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(
          releaseFixture.manifestSha256,
          {},
          releaseFixture.effectiveMacosSha256,
        ),
      }),
      /injected first move failure/u,
    );
    assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
    assert.ok(
      harness.commands.some(
        ([command, verb]) => command === "/bin/launchctl" && verb === "bootstrap",
      ),
    );
  } finally {
    box.remove();
  }
});

test("heartbeat uses only the bound owner child and rejects forced-RLS denial before install mutation", async (t) => {
  for (const allowed of [true, false]) {
    await t.test(
      allowed
        ? "owner read succeeds without leaking to installer children"
        : "incapable owner stops before mutation",
      async () => {
        const box = sandbox();
        const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
        const harness = installFailureHarness(box, releaseFixture);
        const requests = [];
        const runChild = async (request) => {
          requests.push(request);
          if (request.command === "psql") {
            assert.equal(request.options.env.PGUSER, "videoforge_owner");
            assert.equal(request.options.env.PGPASSWORD, "owner-secret-for-heartbeat-only");
            assert.equal(request.options.env.PGCHANNELBINDING, "require");
            assert.equal(request.timeoutMs, 15_000);
            assert.match(request.args.at(-1), /^BEGIN READ ONLY;/u);
            if (request.args.at(-1).includes("V209_HEARTBEAT_READ_ALLOWED"))
              return {
                status: 0,
                signal: null,
                stdout: allowed ? "V209_HEARTBEAT_READ_ALLOWED" : "V209_HEARTBEAT_READ_DENIED",
                stderr: "",
              };
            assert.match(request.args.at(-1), /SET LOCAL row_security = off/u);
            assert.match(request.args.at(-1), /status = 'ONLINE'/u);
          } else {
            assert.notEqual(request.options.env.PGUSER, "videoforge_owner");
            assert.notEqual(request.options.env.PGPASSWORD, "owner-secret-for-heartbeat-only");
          }
          return harness.runChild(request);
        };
        try {
          const ports = createV209MediaWorkerProductionPorts(box.configuration, {
            hostHome: box.home,
            hostPlatform: "darwin",
            hostUid: 501,
            fetchImpl: harness.fetchImpl,
            runChild,
            clock,
          });
          const install = ports.installMediaWorker.run({
            operationId: "install-media-worker-0.1.16",
            authority: authority(
              releaseFixture.manifestSha256,
              {},
              releaseFixture.effectiveMacosSha256,
            ),
          });
          if (allowed) assert.equal((await install).online, true);
          else {
            await assert.rejects(install, /V2_09_MEDIA_WORKER_HEARTBEAT_READ_ACCESS_DENIED/u);
            assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
            assert.equal(
              requests.some(({ command }) =>
                ["/usr/bin/hdiutil", "/usr/bin/ditto", "/bin/launchctl"].includes(command),
              ),
              false,
            );
          }
        } finally {
          box.remove();
        }
      },
    );
  }
});

test("owner heartbeat credential drift stops before psql or installer mutation", async () => {
  const box = sandbox();
  const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
  const harness = installFailureHarness(box, releaseFixture);
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: harness.fetchImpl,
      runChild: harness.runChild,
      clock,
    });
    writeFileSync(box.configuration.heartbeatCredentialPath, "drifted-owner-credential", {
      mode: 0o600,
    });
    await assert.rejects(
      ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(
          releaseFixture.manifestSha256,
          {},
          releaseFixture.effectiveMacosSha256,
        ),
      }),
      /V2_09_MEDIA_WORKER_HEARTBEAT_CREDENTIAL_PATH_DRIFT/u,
    );
    assert.equal(
      harness.commands.some(([command]) =>
        ["psql", "/usr/bin/hdiutil", "/usr/bin/ditto", "/bin/launchctl"].includes(command),
      ),
      false,
    );
    assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
  } finally {
    box.remove();
  }
});

test("a failure after the backup rename restores the old app and service", async () => {
  const box = sandbox();
  const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
  const harness = installFailureHarness(box, releaseFixture);
  let moves = 0;
  const movePath = (from, to) => {
    moves += 1;
    if (moves === 2) throw new Error("injected new-app rename failure");
    return renameSync(from, to);
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: harness.fetchImpl,
      runChild: harness.runChild,
      movePath,
      clock,
    });
    await assert.rejects(
      ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(
          releaseFixture.manifestSha256,
          {},
          releaseFixture.effectiveMacosSha256,
        ),
      }),
      /injected new-app rename failure/u,
    );
    assert.equal(moves, 3);
    assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
    assert.ok(
      harness.commands.some(
        ([command, verb]) => command === "/bin/launchctl" && verb === "bootstrap",
      ),
    );
  } finally {
    box.remove();
  }
});

test("a partially failed new-service bootstrap removes the new app and restores the old pair", async () => {
  const box = sandbox();
  const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
  const harness = installFailureHarness(box, releaseFixture, { failBootstrap: true });
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: harness.fetchImpl,
      runChild: harness.runChild,
      clock,
    });
    await assert.rejects(
      ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(
          releaseFixture.manifestSha256,
          {},
          releaseFixture.effectiveMacosSha256,
        ),
      }),
      /V2_09_MEDIA_WORKER_APP_LAUNCH_FAILED/u,
    );
    assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
    const verbs = harness.commands
      .filter(([command]) => command === "/bin/launchctl")
      .map(([, verb]) => verb);
    assert.deepEqual(verbs.slice(-4), ["bootstrap", "bootout", "print", "bootstrap"]);
  } finally {
    box.remove();
  }
});

test("fresh install rechecks authority after ONLINE heartbeat before accepting success", async () => {
  const box = sandbox();
  const releaseFixture = fixture({ macosBytes: Buffer.from("exact-test-dmg") });
  const harness = installFailureHarness(box, releaseFixture);
  let expired = false;
  const expiringClock = () => new Date(expired ? "2026-09-06T13:00:00Z" : "2026-09-06T12:00:00Z");
  const runChild = async (request) => {
    const result = await harness.runChild(request);
    if (request.command !== "psql" || request.args.at(-1).includes("V209_HEARTBEAT_READ_ALLOWED"))
      return result;
    expired = true;
    const heartbeat = JSON.parse(result.stdout);
    return {
      ...result,
      stdout: JSON.stringify({ ...heartbeat, last_seen_at: "2026-09-06T13:00:00.000Z" }),
    };
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl: harness.fetchImpl,
      runChild,
      clock: expiringClock,
    });
    await assert.rejects(
      ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(
          releaseFixture.manifestSha256,
          {},
          releaseFixture.effectiveMacosSha256,
        ),
      }),
      /V2_09_MEDIA_WORKER_AUTHORITY_NOT_CURRENT/u,
    );
    assert.equal(existsSync(join(box.configuration.applicationPath, "old-version")), true);
  } finally {
    box.remove();
  }
});

test("missing enrollment produces a deterministic zero-mutation user checkpoint", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  let calls = 0;
  let phase = "checkpoint";
  const fetchImpl = async () => {
    calls += 1;
  };
  const runChild = async ({ command }) => {
    if (phase === "checkpoint") {
      calls += 1;
      throw new Error("must not run before confirmation");
    }
    return command === "/usr/bin/security"
      ? { status: 0, signal: null, stdout: "metadata only", stderr: "" }
      : {
          status: 0,
          signal: null,
          stderr: "",
          stdout: JSON.stringify({
            installation_id: "11111111-1111-4111-8111-111111111111",
            platform: "MACOS",
            architecture: "AARCH64",
            worker_version: "0.1.16",
            protocol_version: 1,
            execution_bundle_sha256: executionBundleSha256,
            status: "ONLINE",
            last_seen_at: "2026-09-06T12:00:00.000Z",
          }),
        };
  };
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl,
      runChild,
      clock,
    });
    let error;
    try {
      await ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(releaseFixture.manifestSha256),
      });
    } catch (candidate) {
      error = candidate;
    }
    assert.ok(error instanceof V209MediaWorkerUserConfirmationRequired);
    assert.equal(error.checkpoint.schema_version, V209_MEDIA_WORKER_CONFIRMATION_SCHEMA);
    assert.equal(error.checkpoint.state, "USER_CONFIRMATION_REQUIRED");
    assert.equal(error.checkpoint.reason, "INSTALLATION_STATE_MISSING");
    assert.equal(error.checkpoint.remote_mutations, 0);
    assert.equal(error.checkpoint.local_install_mutations, 0);
    assert.equal(error.checkpoint.credential_values_read, 0);
    assert.equal(calls, 0);
    await assert.rejects(
      resumeV209MediaWorkerUserConfirmation(
        error.checkpoint,
        authority(releaseFixture.manifestSha256),
        { ...box.configuration, controlPlaneOrigin: "https://other.example.test" },
        {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
          fetchImpl,
          clock,
          runChild,
        },
      ),
      /V2_09_MEDIA_WORKER_CONFIRMATION_CHECKPOINT_INVALID/u,
    );
    await assert.rejects(
      resumeV209MediaWorkerUserConfirmation(
        error.checkpoint,
        authority(releaseFixture.manifestSha256),
        box.configuration,
        {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
          fetchImpl,
          clock,
          runChild,
        },
      ),
      /V2_09_MEDIA_WORKER_CONFIRMATION_NOT_COMPLETED/u,
    );
    const installationId = "11111111-1111-4111-8111-111111111111";
    writeFileSync(
      box.configuration.statePath,
      JSON.stringify({ installation_id: installationId }),
      { mode: 0o600 },
    );
    chmodSync(box.configuration.statePath, 0o600);
    phase = "resume";
    const resumed = await resumeV209MediaWorkerUserConfirmation(
      error.checkpoint,
      authority(releaseFixture.manifestSha256),
      box.configuration,
      {
        hostHome: box.home,
        hostPlatform: "darwin",
        hostUid: 501,
        fetchImpl,
        clock,
        runChild,
      },
    );
    assert.equal(resumed.state, "USER_CONFIRMATION_VERIFIED");
    assert.equal(resumed.credential_values_read, 0);
    assert.match(resumed.online_heartbeat_sha256, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    box.remove();
  }
});

test("confirmation resume rechecks authority after final ONLINE readback", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  const installationId = "11111111-1111-4111-8111-111111111111";
  let expired = false;
  const expiringClock = () => new Date(expired ? "2026-09-06T13:00:00Z" : "2026-09-06T12:00:00Z");
  const fetchImpl = async () => {
    throw new Error("network must not be used");
  };
  const runChild = async ({ command }) => {
    if (command === "/usr/bin/security")
      return { status: 0, signal: null, stdout: "metadata", stderr: "" };
    expired = true;
    return {
      status: 0,
      signal: null,
      stderr: "",
      stdout: JSON.stringify({
        installation_id: installationId,
        platform: "MACOS",
        architecture: "AARCH64",
        worker_version: "0.1.16",
        protocol_version: 1,
        execution_bundle_sha256: executionBundleSha256,
        status: "ONLINE",
        last_seen_at: "2026-09-06T13:00:00.000Z",
      }),
    };
  };
  try {
    const options = {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      fetchImpl,
      runChild,
      clock: expiringClock,
    };
    const ports = createV209MediaWorkerProductionPorts(box.configuration, options);
    let checkpoint;
    try {
      await ports.installMediaWorker.run({
        operationId: "install-media-worker-0.1.16",
        authority: authority(releaseFixture.manifestSha256),
      });
    } catch (error) {
      assert.ok(error instanceof V209MediaWorkerUserConfirmationRequired);
      checkpoint = error.checkpoint;
    }
    writeFileSync(
      box.configuration.statePath,
      JSON.stringify({ installation_id: installationId }),
      {
        mode: 0o600,
      },
    );
    chmodSync(box.configuration.statePath, 0o600);
    await assert.rejects(
      resumeV209MediaWorkerUserConfirmation(
        checkpoint,
        authority(releaseFixture.manifestSha256),
        box.configuration,
        options,
      ),
      /V2_09_MEDIA_WORKER_AUTHORITY_NOT_CURRENT/u,
    );
  } finally {
    box.remove();
  }
});

test("different live configuration produces different source-bound port identities", () => {
  const left = sandbox();
  const right = sandbox();
  try {
    const first = createV209MediaWorkerProductionPorts(left.configuration, {
      hostHome: left.home,
      hostPlatform: "darwin",
      hostUid: 501,
    });
    const second = createV209MediaWorkerProductionPorts(right.configuration, {
      hostHome: right.home,
      hostPlatform: "darwin",
      hostUid: 501,
    });
    assert.notEqual(
      first.publishMediaWorker.source_sha256,
      second.publishMediaWorker.source_sha256,
    );
  } finally {
    left.remove();
    right.remove();
  }
});

test("owner heartbeat bytes and credential descriptor bind standalone media port identities", () => {
  const box = sandbox();
  try {
    const create = () =>
      createV209MediaWorkerProductionPorts(box.configuration, {
        hostHome: box.home,
        hostPlatform: "darwin",
        hostUid: 501,
      }).installMediaWorker.source_sha256;
    const original = create();
    box.configuration.heartbeatEnvironment.PGPASSWORD = "different-owner-snapshot";
    const changedBytes = create();
    assert.notEqual(changedBytes, original);
    const alternate = `${box.configuration.heartbeatCredentialPath}.alternate`;
    writeFileSync(alternate, "separate-owner-descriptor", { mode: 0o600 });
    box.configuration.heartbeatCredentialPath = alternate;
    assert.notEqual(create(), changedBytes);
  } finally {
    box.remove();
  }
});

test("same-source captured dependencies require and bind distinct independent test seals", () => {
  const box = sandbox();
  try {
    const runnerWithCapture = (captured) => async () => ({
      status: 0,
      signal: null,
      stdout: captured,
      stderr: "",
    });
    const firstRunner = runnerWithCapture("one");
    const secondRunner = runnerWithCapture("two");
    assert.equal(firstRunner.name, secondRunner.name);
    const first = createV209MediaWorkerProductionPortsForTest(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild: firstRunner,
      testDependencyIdentitySha256: sha256("focused-captured-dependency-one"),
    });
    const second = createV209MediaWorkerProductionPortsForTest(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild: secondRunner,
      testDependencyIdentitySha256: sha256("focused-captured-dependency-two"),
    });
    assert.notEqual(
      first.installMediaWorker.source_sha256,
      second.installMediaWorker.source_sha256,
    );
    assert.throws(
      () =>
        createV209MediaWorkerProductionPortsForTest(box.configuration, {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
          runChild: firstRunner,
        }),
      /V2_09_MEDIA_WORKER_TEST_DEPENDENCY_INVALID/u,
    );
  } finally {
    box.remove();
  }
});

test("production composition rejects every executable and confirmation dependency injection", async () => {
  const box = sandbox();
  try {
    assert.throws(
      () => createProductionPorts(box.configuration, { runChild: async () => {} }),
      /V2_09_MEDIA_WORKER_PRODUCTION_DEPENDENCY_INJECTION_FORBIDDEN/u,
    );
    await assert.rejects(
      resumeProductionConfirmation({}, {}, box.configuration, { clock }),
      /V2_09_MEDIA_WORKER_PRODUCTION_DEPENDENCY_INJECTION_FORBIDDEN/u,
    );
  } finally {
    box.remove();
  }
});

test("factory rejects unprotected database and GitHub credential files", () => {
  const box = sandbox();
  try {
    chmodSync(box.configuration.databaseCredentialPath, 0o644);
    assert.throws(
      () =>
        createV209MediaWorkerProductionPorts(box.configuration, {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
        }),
      /V2_09_MEDIA_WORKER_DATABASE_CREDENTIAL_PATH_INVALID/u,
    );
    chmodSync(box.configuration.databaseCredentialPath, 0o600);
    chmodSync(join(box.configuration.environment.GH_CONFIG_DIR, "hosts.yml"), 0o644);
    assert.throws(
      () =>
        createV209MediaWorkerProductionPorts(box.configuration, {
          hostHome: box.home,
          hostPlatform: "darwin",
          hostUid: 501,
        }),
      /V2_09_MEDIA_WORKER_GITHUB_CREDENTIAL_PATH_INVALID/u,
    );
  } finally {
    box.remove();
  }
});

test("factory requires exact PostgreSQL TLS and channel binding environment", () => {
  for (const mutate of [
    (environment) => delete environment.PGCHANNELBINDING,
    (environment) => {
      environment.PGCHANNELBINDING = "prefer";
    },
    (environment) => {
      environment.PGSSLMODE = "prefer";
    },
  ]) {
    const box = sandbox();
    try {
      mutate(box.configuration.environment);
      assert.throws(
        () =>
          createV209MediaWorkerProductionPorts(box.configuration, {
            hostHome: box.home,
            hostPlatform: "darwin",
            hostUid: 501,
          }),
        /V2_09_MEDIA_WORKER_POSTGRES_ENVIRONMENT_INVALID/u,
      );
    } finally {
      box.remove();
    }
  }
});

test("post-construction GitHub credential metadata drift stops before child execution", async () => {
  const box = sandbox();
  const releaseFixture = fixture();
  let childCalls = 0;
  let releaseReads = 0;
  try {
    const ports = createV209MediaWorkerProductionPorts(box.configuration, {
      hostHome: box.home,
      hostPlatform: "darwin",
      hostUid: 501,
      runChild: async () => {
        childCalls += 1;
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
      fetchImpl: async () => {
        releaseReads += 1;
        return new Response("missing", { status: 404 });
      },
      clock,
    });
    chmodSync(join(box.configuration.environment.GH_CONFIG_DIR, "hosts.yml"), 0o644);
    await assert.rejects(
      ports.publishMediaWorker.run({
        operationId: "publish-media-worker-0.1.16",
        authority: authority(releaseFixture.manifestSha256),
      }),
      /V2_09_MEDIA_WORKER_GITHUB_CREDENTIAL_PATH_DRIFT/u,
    );
    assert.equal(releaseReads, 1);
    assert.equal(childCalls, 0);
  } finally {
    box.remove();
  }
});

test("configuration rejects a non-exact application path", () => {
  const box = sandbox();
  try {
    assert.throws(
      () =>
        createV209MediaWorkerProductionPorts(
          { ...box.configuration, applicationPath: resolve(box.home, "Applications", "Other.app") },
          { hostHome: box.home, hostPlatform: "darwin", hostUid: 501 },
        ),
      /V2_09_MEDIA_WORKER_PATH_CONFIGURATION_INVALID/u,
    );
  } finally {
    box.remove();
  }
});
