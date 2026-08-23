import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyV207RollbackAnchorRefreshMarker,
  V207_ANCHOR_REFRESH_BASELINE_SHA256,
  V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH,
  V207_ANCHOR_REFRESH_ENABLED_SHA256,
  V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
  V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY,
  revertV207RollbackAnchorRefreshMarker,
} from "./v207-anchor-refresh-marker";

const roots: string[] = [];

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fixture(): Promise<{ readonly root: string; readonly configPath: string }> {
  const root = await mkdtemp("/tmp/vf-v207-anchor-refresh-");
  roots.push(root);
  const configPath = join(root, "wrangler-current.json");
  // Copy the protected baseline only into a private temporary test directory;
  // tests never print it and never write to the protected source.
  const baseline = await readFile(
    process.env.V207_ANCHOR_REFRESH_TEST_SOURCE ?? V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH,
  );
  await writeFile(configPath, baseline, { mode: 0o600 });
  await chmod(configPath, 0o600);
  return { root, configPath };
}

async function hashAt(configPath: string): Promise<string> {
  return digest(await readFile(configPath));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V2-07 protected rollback-anchor marker", () => {
  it("applies and reverts exact canonical bytes atomically", async () => {
    const { configPath } = await fixture();
    expect(await hashAt(configPath)).toBe(V207_ANCHOR_REFRESH_BASELINE_SHA256);

    await expect(applyV207RollbackAnchorRefreshMarker(configPath)).resolves.toMatchObject({
      operation: "apply",
      state: "enabled",
      sha256: V207_ANCHOR_REFRESH_ENABLED_SHA256,
    });
    expect(await hashAt(configPath)).toBe(V207_ANCHOR_REFRESH_ENABLED_SHA256);

    await expect(revertV207RollbackAnchorRefreshMarker(configPath)).resolves.toMatchObject({
      operation: "revert",
      state: "disabled",
      sha256: V207_ANCHOR_REFRESH_BASELINE_SHA256,
    });
    expect(await hashAt(configPath)).toBe(V207_ANCHOR_REFRESH_BASELINE_SHA256);
  });

  it("rejects a baseline hash mismatch before any replacement", async () => {
    const { configPath } = await fixture();
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const vars = config.vars as Record<string, unknown>;
    vars.VIDEOFORGE_PROVIDER_MODE = `${String(vars.VIDEOFORGE_PROVIDER_MODE)}-drift`;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);

    await expect(applyV207RollbackAnchorRefreshMarker(configPath)).rejects.toThrow(
      "V207_ANCHOR_REFRESH_BASELINE_HASH_MISMATCH",
    );
  });

  it("refuses a non-0600 file and a symlink", async () => {
    const { root, configPath } = await fixture();
    await chmod(configPath, 0o640);
    await expect(applyV207RollbackAnchorRefreshMarker(configPath)).rejects.toThrow(
      "V207_ANCHOR_REFRESH_CONFIG_MODE_INVALID",
    );

    const linkPath = join(root, "wrangler-link.json");
    await symlink(configPath, linkPath);
    await expect(applyV207RollbackAnchorRefreshMarker(linkPath)).rejects.toThrow(
      "V207_ANCHOR_REFRESH_CONFIG_SYMLINK",
    );
  });

  it("rejects a duplicate marker and an unexpected marker key", async () => {
    const { configPath } = await fixture();
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    config[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY] = V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    await expect(applyV207RollbackAnchorRefreshMarker(configPath)).rejects.toThrow(
      "V207_ANCHOR_REFRESH_MARKER_DUPLICATE_OR_DRIFTED",
    );

    // First create a canonical enabled file, then add a second JSON member.
    const second = await fixture();
    await applyV207RollbackAnchorRefreshMarker(second.configPath);
    const enabledText = await readFile(second.configPath, "utf8");
    const marker = `"${V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY}": "${V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION}"`;
    const duplicateText = enabledText.replace(marker, `${marker},\n    ${marker}`);
    await writeFile(second.configPath, duplicateText, { mode: 0o600 });
    await chmod(second.configPath, 0o600);
    await expect(revertV207RollbackAnchorRefreshMarker(second.configPath)).rejects.toThrow(
      "V207_ANCHOR_REFRESH_MARKER_DUPLICATE_OR_DRIFTED",
    );
  });

  it("cleans the same-directory temp file after an interrupted apply", async () => {
    const { root, configPath } = await fixture();
    await expect(
      applyV207RollbackAnchorRefreshMarker(configPath, {
        beforeRename: () => {
          throw new Error("test interruption");
        },
      }),
    ).rejects.toThrow("V207_ANCHOR_REFRESH_ATOMIC_WRITE_INTERRUPTED");
    expect(await hashAt(configPath)).toBe(V207_ANCHOR_REFRESH_BASELINE_SHA256);
    expect((await readdir(root)).some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });

  it("refuses revert when the file is not the enabled exact state", async () => {
    const { configPath } = await fixture();
    await expect(revertV207RollbackAnchorRefreshMarker(configPath)).rejects.toThrow(
      "V207_ANCHOR_REFRESH_MARKER_DUPLICATE_OR_DRIFTED",
    );
  });
});
