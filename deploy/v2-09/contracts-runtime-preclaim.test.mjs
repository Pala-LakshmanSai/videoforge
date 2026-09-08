import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateV209ContractsRuntimePreclaim } from "./execute-combined-qualified-production.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("contracts runtime preclaim builds before its provider-free bridge smoke", async () => {
  const calls = [];
  const receipt = await validateV209ContractsRuntimePreclaim({
    root: ROOT,
    testOnly: true,
    spawnSyncForTest(command, args, options) {
      calls.push({ command, args, options });
      return calls.length === 1
        ? { status: 0, error: undefined, signal: null }
        : {
            status: 1,
            error: undefined,
            signal: null,
            stderr: "V2_09_RUNPOD_BRIDGE_REQUEST_INVALID\n",
          };
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["--filter", "@videoforge/contracts", "build"]);
  assert.deepEqual(calls[1].args.slice(0, 4), [
    "--filter",
    "@videoforge/web",
    "exec",
    "tsx",
  ]);
  assert.equal(calls[1].options.input, "{}\n");
  assert.equal(calls[0].options.timeout, 120_000);
  assert.equal(calls[1].options.timeout, 30_000);
  assert.deepEqual(Object.keys(calls[0].options.env).sort(), ["CI", "PATH"]);
  assert.deepEqual(receipt, {
    schema_version: "videoforge.v2-09-contracts-runtime-preclaim/v1",
    provider_calls: 0,
  });
});

test("archive-style checkout builds contracts before the exact bridge launch", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "vf-v209-contracts-clean-")));
  try {
    const checkout = spawnSync("git", ["checkout-index", "--all", `--prefix=${directory}/`], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(checkout.status, 0, checkout.stderr);
    assert.equal(existsSync(join(directory, "packages/contracts/dist")), false);

    const install = spawnSync(
      "pnpm",
      ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      { cwd: directory, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(install.status, 0, install.stderr);
    const build = spawnSync("pnpm", ["--filter", "@videoforge/contracts", "build"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(build.status, 0, build.stderr);

    const bridgePath = join(directory, "deploy/v2-09/v209-runpod-production-bridge.ts");
    const bridge = spawnSync(
      "pnpm",
      ["--filter", "@videoforge/web", "exec", "tsx", bridgePath],
      { cwd: directory, encoding: "utf8", input: "{}\n", timeout: 30_000 },
    );
    assert.equal(bridge.status, 1);
    assert.equal(bridge.stderr, "V2_09_RUNPOD_BRIDGE_REQUEST_INVALID\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
