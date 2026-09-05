import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CHILD_ENVIRONMENT_NAMES,
  INPUT_MANIFEST_SCHEMA,
  LAUNCH_CONFIRMATION,
  PRODUCTION_SECRETS_SCHEMA,
  REQUEST_SCHEMA,
  closePlan,
  ephemeralProductionSecrets,
  parseArgs,
  parseProductionSecrets,
  prepareLaunch,
  runPreparedLaunch,
} from "../../deploy/v2-08/launch-soulx-live.mjs";

function secureFile(path, bytes) {
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeFixture(root) {
  const values = {
    avatarSource: Buffer.from("PNG-owned-avatar"),
    audio2s: Buffer.concat([Buffer.from("RIFF-owned-audio-2s"), Buffer.alloc(44)]),
    audio4s: Buffer.concat([Buffer.from("RIFF-owned-audio-4s"), Buffer.alloc(44)]),
    audio6s: Buffer.concat([Buffer.from("RIFF-owned-audio-6s"), Buffer.alloc(44)]),
    audio10s: Buffer.concat([Buffer.from("RIFF-owned-audio-10s"), Buffer.alloc(44)]),
  };
  const source = (name, contentType) => {
    const bytes = values[name];
    const path = secureFile(join(root, `${name}.bin`), bytes);
    return { content_type: contentType, path, sha256: digest(bytes), size_bytes: bytes.length };
  };
  const manifest = {
    schema_version: INPUT_MANIFEST_SCHEMA,
    avatar_source: source("avatarSource", "image/png"),
    audio_sources: {
      2: source("audio2s", "audio/wav"),
      4: source("audio4s", "audio/wav"),
      6: source("audio6s", "audio/wav"),
      10: source("audio10s", "audio/wav"),
    },
  };
  const descriptor = (entry, path) => ({
    contentType: entry.content_type,
    path: `.videoforge/private/${path}`,
    sha256: entry.sha256,
    sizeBytes: entry.size_bytes,
  });
  const request = {
    schema_version: REQUEST_SCHEMA,
    command: "soulx-live-qualification",
    request_id: "v208-test-request-001",
    input: {
      dualLaneInput: {
        qualificationProtectedInputDescriptors: {
          avatarSource: descriptor(manifest.avatar_source, "avatar.png"),
          soulx2s: descriptor(manifest.audio_sources[2], "soulx-2s.wav"),
          soulx4s: descriptor(manifest.audio_sources[4], "soulx-4s.wav"),
          soulx6s: descriptor(manifest.audio_sources[6], "soulx-6s.wav"),
          soulx10s: descriptor(manifest.audio_sources[10], "soulx-10s.wav"),
        },
        qualificationR2: {
          accountId: "a".repeat(32),
          bucketName: "videoforge-test-private",
        },
      },
    },
    r2: { account_id: "a".repeat(32), bucket_name: "videoforge-test-private" },
  };
  const requestPath = secureFile(join(root, "request.json"), `${JSON.stringify(request)}\n`);
  const manifestPath = secureFile(join(root, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  const r2Directory = join(root, "r2-secrets");
  mkdirSync(r2Directory, { mode: 0o700 });
  chmodSync(r2Directory, 0o700);
  secureFile(join(r2Directory, "R2_ACCESS_KEY_ID"), "test-access-key-012345");
  secureFile(join(r2Directory, "R2_SECRET_ACCESS_KEY"), "test-secret-key-012345678901234567");
  return { requestPath, manifestPath, r2Directory };
}

test("V2-08 launcher rejects missing confirmation and unknown bindings", () => {
  assert.throws(
    () => parseArgs(["--request-file", "/tmp/request", "--input-manifest-file", "/tmp/manifest"]),
    /V2_08_SOULX_LAUNCH_ARGUMENT_REQUIRED/u,
  );
  assert.throws(
    () =>
      parseArgs([
        "--request-file",
        "/tmp/request",
        "--input-manifest-file",
        "/tmp/manifest",
        "--confirm",
        LAUNCH_CONFIRMATION,
        "--provider-key",
        "secret",
      ]),
    /V2_08_SOULX_LAUNCH_ARGUMENT_UNKNOWN/u,
  );
});

test("ephemeral qualification secrets are valid and contain no endpoint authority", () => {
  const secrets = ephemeralProductionSecrets();
  assert.equal(secrets.schemaVersion, PRODUCTION_SECRETS_SCHEMA);
  assert.equal(parseProductionSecrets(secrets).schemaVersion, PRODUCTION_SECRETS_SCHEMA);
  assert.equal("mageEndpointId" in secrets, false);
  assert.equal("soulxEndpointId" in secrets, false);
});

test("launcher prepares exact private FDs, excludes ambient secrets, and forwards one signal", async () => {
  const root = mkdtempSync(join(tmpdir(), "v208-launch-test-"));
  try {
    const fixture = writeFixture(root);
    const parsed = parseArgs([
      "--request-file",
      fixture.requestPath,
      "--input-manifest-file",
      fixture.manifestPath,
      "--journal-dir",
      join(root, "journal"),
      "--confirm",
      LAUNCH_CONFIRMATION,
    ]);
    const plan = prepareLaunch({
      values: parsed.values,
      r2SecretsDirectory: fixture.r2Directory,
      baseEnvironment: {
        PATH: "/usr/bin",
        HOME: "/private/test-home",
        V208_SECRET: "must-not-inherit",
        VIDEOFORGE_V213_SECRET: "must-not-inherit",
      },
    });
    assert.equal(plan.freshJournal, true);
    assert.equal(plan.r2.account_id, "a".repeat(32));
    assert.deepEqual(
      Object.keys(plan.childEnvironment)
        .filter((name) => name.startsWith("V208_"))
        .sort(),
      CHILD_ENVIRONMENT_NAMES.filter((name) => name.startsWith("V208_")).sort(),
    );
    assert.equal(plan.childEnvironment.V208_SECRET, undefined);
    assert.equal(plan.childEnvironment.VIDEOFORGE_V213_SECRET, undefined);
    assert.equal(plan.childArgs.at(-1), "EXECUTE_EXACT_V2_08_SOULX_QUALIFICATION");
    assert.equal(
      readFileSync(join(plan.journalDirectory, "production-secrets.json")).length > 0,
      true,
    );
    assert.equal(plan.opened.request.bytes.toString("utf8").includes("fullLiveAuthorityId"), false);

    const signalSource = new EventEmitter();
    const child = new EventEmitter();
    child.pid = 43210;
    const kill = [];
    child.kill = (signal) => kill.push(signal);
    let spawnCall;
    const run = runPreparedLaunch(plan, {
      signalSource,
      spawn: (command, args, options) => {
        spawnCall = { command, args, options };
        return child;
      },
    });
    signalSource.emit("SIGTERM");
    signalSource.emit("SIGINT");
    child.emit("exit", 0, null);
    await assert.doesNotReject(run);
    assert.deepEqual(kill, ["SIGTERM"]);
    assert.equal(spawnCall.options.shell, false);
    assert.equal(spawnCall.options.cwd.endsWith("/videoforge"), true);
    assert.equal(spawnCall.options.stdio.length, 14);
    assert.equal(plan.childEnvironment.V208_REQUEST_FD, "3");
    assert.equal(plan.childEnvironment.V208_QUALIFICATION_AUDIO_10S_FD, "13");
    assert.equal(spawnCall.options.stdio[3], plan.opened.request.descriptor);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("launcher resumes a journal only with matching private bindings and generated secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "v208-launch-resume-test-"));
  try {
    const fixture = writeFixture(root);
    const journal = join(root, "journal");
    const argv = [
      "--request-file",
      fixture.requestPath,
      "--input-manifest-file",
      fixture.manifestPath,
      "--journal-dir",
      journal,
      "--confirm",
      LAUNCH_CONFIRMATION,
    ];
    const parsed = parseArgs(argv);
    const first = prepareLaunch({ values: parsed.values, r2SecretsDirectory: fixture.r2Directory });
    const generatedSecrets = readFileSync(join(journal, "production-secrets.json"), "utf8");
    closePlan(first);

    const resumed = prepareLaunch({
      values: parsed.values,
      r2SecretsDirectory: fixture.r2Directory,
    });
    try {
      assert.equal(resumed.freshJournal, false);
      assert.equal(
        readFileSync(join(journal, "production-secrets.json"), "utf8"),
        generatedSecrets,
      );
      assert.equal(readFileSync(join(journal, "r2-account-id"), "utf8"), "a".repeat(32));
      assert.equal(
        readFileSync(join(journal, "r2-bucket-name"), "utf8"),
        "videoforge-test-private",
      );
    } finally {
      closePlan(resumed);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
