import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCancellableChildProcess } from "../../deploy/v2-13/full-live-adapters.mjs";

const waitFor = async (predicate) => {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("child readiness timed out");
};

const runFixture = async ({ cooperative }) => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-child-cancel-"));
  const ready = join(directory, "ready");
  const settled = join(directory, "settled");
  const controller = new AbortController();
  try {
    const script = `
      const { writeFileSync } = require("node:fs");
      process.on("SIGTERM", () => {
        ${cooperative ? `writeFileSync(${JSON.stringify(settled)}, "cooperative"); process.exit(0);` : ""}
      });
      writeFileSync(${JSON.stringify(ready)}, "ready");
      setTimeout(() => writeFileSync(${JSON.stringify(settled)}, "non-cooperative-settled"), 80);
      setTimeout(() => process.exit(0), 100);
    `;
    const pending = runCancellableChildProcess({
      command: process.execPath,
      args: ["-e", script],
      options: { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      timeoutMs: 2_000,
      cancellationSignal: controller.signal,
      timeoutCode: "TEST_TIMEOUT",
      cancellationCode: "TEST_CANCELLED",
      executionCode: "TEST_EXECUTION",
    });
    await waitFor(() => existsSync(ready));
    controller.abort();
    await assert.rejects(pending, /TEST_CANCELLED/u);
    assert.equal(existsSync(settled), true, "runner returned before the child settled");
    return readFileSync(settled, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("cancellation waits for a delayed non-cooperative child to quiesce", async () => {
  assert.equal(await runFixture({ cooperative: false }), "non-cooperative-settled");
});

test("cooperative child termination also settles before cancellation returns", async () => {
  assert.equal(await runFixture({ cooperative: true }), "cooperative");
});
