import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ENVIRONMENT_NAMES,
  buildClosedEnvironment,
  planProtectedLaunch,
  validateLaunchInputMetadata,
} from "../../deploy/v2-13/launch-full-live.mjs";

const sourceNames = [
  "credentialBootstrapReceipt",
  "googleClientId",
  "googleClientSecret",
  "r2AccessKeyId",
  "r2SecretAccessKey",
  "runpodApiKey",
  "ownerPgService",
  "ownerPgpass",
];

const makeFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-launch-test-"));
  chmodSync(directory, 0o700);
  const files = {};
  for (const name of [
    "proposal",
    "approval",
    "authority",
    "materializationSeed",
    "staticReleaseDescriptor",
    "wranglerOAuthConfig",
    ...sourceNames,
  ]) {
    const path = join(directory, `${name}.input`);
    writeFileSync(path, `fixture-${name}-secret`, { mode: 0o600, flag: "wx" });
    files[name] = path;
  }
  files.attemptRoot = join(directory, "v2-13-test0001");
  files.authorityId = "v2-13-test0001";
  files.sourceFiles = Object.fromEntries(sourceNames.map((name) => [name, files[name]]));
  return { directory, files };
};

const controlArgs = (files) => ({
  proposalFile: files.proposal,
  approvalFile: files.approval,
  authorityFile: files.authority,
  materializationSeedFile: files.materializationSeed,
  staticReleaseDescriptorFile: files.staticReleaseDescriptor,
  wranglerOAuthConfigFile: files.wranglerOAuthConfig,
  sourceFiles: files.sourceFiles,
});

test("path-only launch planning is side-effect free and strips ambient V2-13 variables", () => {
  const fixture = makeFixture();
  try {
    validateLaunchInputMetadata(controlArgs(fixture.files));
    const plan = planProtectedLaunch({
      ...controlArgs(fixture.files),
      attemptRoot: fixture.files.attemptRoot,
      authorityId: fixture.files.authorityId,
      baseEnvironment: {
        PATH: "/usr/bin",
        HOME: "/tmp",
        RUNPOD_API_KEY: "must-not-inherit",
        VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: "/ambient/secret",
      },
    });
    assert.equal(existsSync(fixture.files.attemptRoot), false);
    assert.deepEqual(
      Object.keys(plan.environment).filter((name) => name.startsWith("VIDEOFORGE_V2_13_")),
      [...ENVIRONMENT_NAMES],
    );
    assert.equal("RUNPOD_API_KEY" in plan.environment, false);
    assert.equal(plan.environment.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE, plan.staged.runpodApiKey);
    for (const path of plan.outputTargets) assert.equal(existsSync(path), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("missing RunPod input fails metadata preflight before any attempt directory is created", () => {
  const fixture = makeFixture();
  try {
    rmSync(fixture.files.runpodApiKey);
    assert.throws(
      () => validateLaunchInputMetadata(controlArgs(fixture.files)),
      /V2_13_FULL_LIVE_LAUNCH_SOURCE_RUNPODAPIKEY/u,
    );
    assert.equal(existsSync(fixture.files.attemptRoot), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("archived RunPod sources are rejected before metadata acceptance", () => {
  const fixture = makeFixture();
  try {
    const archive = join(fixture.directory, "history");
    mkdirSync(archive, { mode: 0o700 });
    const archivedRunpod = join(archive, "RUNPOD_API_KEY");
    writeFileSync(archivedRunpod, "archived-secret", { mode: 0o600, flag: "wx" });
    const sourceFiles = { ...fixture.files.sourceFiles, runpodApiKey: archivedRunpod };
    assert.throws(
      () => validateLaunchInputMetadata({ ...controlArgs(fixture.files), sourceFiles }),
      /V2_13_FULL_LIVE_LAUNCH_INPUT_ARCHIVE_PATH/u,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("archived control inputs are rejected before metadata acceptance", () => {
  const fixture = makeFixture();
  try {
    const archive = join(fixture.directory, "archive");
    mkdirSync(archive, { mode: 0o700 });
    const archivedProposal = join(archive, "proposal.json");
    writeFileSync(archivedProposal, "archived-proposal", { mode: 0o600, flag: "wx" });
    assert.throws(
      () =>
        validateLaunchInputMetadata({
          ...controlArgs(fixture.files),
          proposalFile: archivedProposal,
        }),
      /V2_13_FULL_LIVE_LAUNCH_INPUT_ARCHIVE_PATH/u,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("pre-existing attempt/output state is rejected as stale and cannot be reused", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(fixture.files.attemptRoot, { mode: 0o700 });
    chmodSync(fixture.files.attemptRoot, 0o700);
    writeFileSync(join(fixture.files.attemptRoot, "stale-output.json"), "old", {
      mode: 0o600,
      flag: "wx",
    });
    assert.throws(
      () =>
        planProtectedLaunch({
          ...controlArgs(fixture.files),
          attemptRoot: fixture.files.attemptRoot,
          authorityId: fixture.files.authorityId,
        }),
      /V2_13_FULL_LIVE_LAUNCH_ATTEMPT_ROOT_NOT_FRESH/u,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("closed environment helper has one frozen map for both child stages", () => {
  const fixture = makeFixture();
  try {
    const plan = planProtectedLaunch({
      ...controlArgs(fixture.files),
      attemptRoot: fixture.files.attemptRoot,
      authorityId: fixture.files.authorityId,
      baseEnvironment: { PATH: "/usr/bin", HOME: "/tmp" },
    });
    const environment = buildClosedEnvironment({
      sourceDirectory: plan.sourceDirectory,
      postgresDirectory: plan.postgresDirectory,
      secretDirectory: plan.secretDirectory,
      artifactsDirectory: plan.artifactsDirectory,
      staged: plan.staged,
      baseEnvironment: { PATH: "/usr/bin", HOME: "/tmp" },
    });
    assert.equal(Object.isFrozen(environment), true);
    assert.deepEqual(environment, plan.environment);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
