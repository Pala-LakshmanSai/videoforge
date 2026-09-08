import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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

test("bounded child input is written completely and stdin is closed", async () => {
  const input = "migration-sql\n".repeat(131_072);
  const result = await runCancellableChildProcess({
    command: process.execPath,
    args: [
      "-e",
      'let bytes = 0; process.stdin.on("data", (chunk) => { bytes += chunk.length; process.stdin.pause(); setTimeout(() => process.stdin.resume(), 1); }); process.stdin.on("end", () => process.stdout.write(String(bytes)));',
    ],
    options: { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] },
    timeoutMs: 2_000,
    timeoutCode: "TEST_TIMEOUT",
    cancellationCode: "TEST_CANCELLED",
    executionCode: "TEST_EXECUTION",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, String(Buffer.byteLength(input)));
});

const fakeChild = ({ stdin, closeDelayMs = 5 }) => {
  const child = new EventEmitter();
  child.stdin = stdin;
  child.stdout = null;
  child.stderr = null;
  child.kill = (signal) => {
    setTimeout(() => child.emit("close", null, signal), closeDelayMs);
    return true;
  };
  return child;
};

test("synchronous stdin failure is generic and waits for child close", async () => {
  const secret = "do-not-leak-sync-secret";
  const stdin = new EventEmitter();
  stdin.end = () => {
    throw new Error(secret);
  };
  let closed = false;
  const child = fakeChild({ stdin });
  child.once("close", () => {
    closed = true;
  });
  await assert.rejects(
    runCancellableChildProcess({
      command: "fake",
      args: [],
      options: { input: secret, stdio: ["pipe", "pipe", "pipe"] },
      timeoutMs: 2_000,
      timeoutCode: "TEST_TIMEOUT",
      cancellationCode: "TEST_CANCELLED",
      executionCode: "TEST_EXECUTION",
      spawn: () => child,
    }),
    (error) => {
      assert.equal(error.message, "V2_13_FULL_LIVE_ADAPTER_TEST_EXECUTION");
      assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      assert.equal(closed, true);
      return true;
    },
  );
});

test("child close before delayed stdin EPIPE fails closed without leaking input", async () => {
  const secret = "do-not-leak-epipe-secret";
  const stdin = new EventEmitter();
  stdin.destroy = () => {};
  const child = fakeChild({ stdin });
  stdin.end = () => {
    setImmediate(() => {
      child.emit("close", 0, null);
      setImmediate(() => stdin.emit("error", Object.assign(new Error(secret), { code: "EPIPE" })));
    });
  };
  await assert.rejects(
    runCancellableChildProcess({
      command: "fake",
      args: [],
      options: { input: secret, stdio: ["pipe", "pipe", "pipe"] },
      timeoutMs: 2_000,
      timeoutCode: "TEST_TIMEOUT",
      cancellationCode: "TEST_CANCELLED",
      executionCode: "TEST_EXECUTION",
      spawn: () => child,
    }),
    (error) => {
      assert.equal(error.message, "V2_13_FULL_LIVE_ADAPTER_TEST_EXECUTION");
      assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      return true;
    },
  );
});

test("input with missing stdin fails generically after child close", async () => {
  let closed = false;
  const child = fakeChild({ stdin: null });
  child.once("close", () => {
    closed = true;
  });
  await assert.rejects(
    runCancellableChildProcess({
      command: "fake",
      args: [],
      options: { input: "secret", stdio: ["ignore", "pipe", "pipe"] },
      timeoutMs: 2_000,
      timeoutCode: "TEST_TIMEOUT",
      cancellationCode: "TEST_CANCELLED",
      executionCode: "TEST_EXECUTION",
      spawn: () => child,
    }),
    (error) => {
      assert.equal(error.message, "V2_13_FULL_LIVE_ADAPTER_TEST_EXECUTION");
      assert.equal(closed, true);
      return true;
    },
  );
});

test("abort while child input is pending preserves cancellation and waits for close", async () => {
  const stdin = new EventEmitter();
  stdin.end = () => {};
  stdin.destroy = () => {};
  let closed = false;
  const child = fakeChild({ stdin, closeDelayMs: 20 });
  child.once("close", () => {
    closed = true;
  });
  const controller = new AbortController();
  const pending = runCancellableChildProcess({
    command: "fake",
    args: [],
    options: { input: Buffer.alloc(1024 * 1024), stdio: ["pipe", "pipe", "pipe"] },
    timeoutMs: 2_000,
    cancellationSignal: controller.signal,
    timeoutCode: "TEST_TIMEOUT",
    cancellationCode: "TEST_CANCELLED",
    executionCode: "TEST_EXECUTION",
    spawn: () => child,
  });
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.equal(error.message, "V2_13_FULL_LIVE_ADAPTER_TEST_CANCELLED");
    assert.equal(closed, true);
    return true;
  });
});
