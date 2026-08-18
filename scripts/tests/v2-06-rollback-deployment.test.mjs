import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertAfterRollback,
  assertBeforeRollback,
  readSnapshot,
} from "../../deploy/v2-06/verify-rollback-deployment.mjs";

const deployment = (id, created_on, version_id, is_active) => ({
  id,
  created_on,
  is_active,
  versions: [{ version_id, percentage: 100 }],
});

const readFixture = async (value) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "videoforge-v2-06-rollback-"));
  const file = join(temporaryDirectory, "deployments.json");
  writeFileSync(file, JSON.stringify(value));
  try {
    return await readSnapshot(file);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

test("V2-06 rollback before-list activates only the newest Wrangler parent", async () => {
  const versions = await readFixture({
    deployments: [
      deployment("deployment-current", "2026-08-18T12:00:00.000Z", "version-current", true),
      deployment("deployment-prior", "2026-08-18T11:00:00.000Z", "version-prior", false),
      deployment("deployment-old", "2026-08-18T10:00:00.000Z", "version-old", false),
    ],
  });

  assert.deepEqual(
    versions.map(({ id, active }) => ({ id, active })),
    [
      { id: "version-current", active: true },
      { id: "version-prior", active: false },
      { id: "version-old", active: false },
    ],
  );
  assert.deepEqual(assertBeforeRollback(versions, "version-current", "version-prior"), {
    active_version_id: "version-current",
    prior_version_id: "version-prior",
  });
});

test("V2-06 rollback after-list accepts the approved prior version as active", async () => {
  const versions = await readFixture({
    deployments: [
      deployment("deployment-after-rollback", "2026-08-18T13:00:00.000Z", "version-prior", true),
      deployment("deployment-current", "2026-08-18T12:00:00.000Z", "version-current", false),
      deployment("deployment-old", "2026-08-18T10:00:00.000Z", "version-old", false),
    ],
  });

  assert.deepEqual(
    versions.map(({ id, active }) => ({ id, active })),
    [
      { id: "version-prior", active: true },
      { id: "version-current", active: false },
      { id: "version-old", active: false },
    ],
  );
  assert.deepEqual(assertAfterRollback(versions, "version-prior"), {
    active_version_id: "version-prior",
  });
});

test("V2-06 rollback after CLI accepts the documented three-argument form", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "videoforge-v2-06-rollback-cli-"));
  const file = join(temporaryDirectory, "deployments.json");
  writeFileSync(
    file,
    JSON.stringify([deployment("deployment-after", "2026-08-18T13:00:00Z", "version-prior", true)]),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "deploy/v2-06/verify-rollback-deployment.mjs"),
        "after",
        file,
        "version-prior",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { active_version_id: "version-prior" });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
