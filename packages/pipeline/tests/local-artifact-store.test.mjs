import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalArtifactStore, LocalArtifactStoreError } from "../dist/src/index.js";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function withTemporaryRoots(run) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-artifact-store-"));
  const root = path.join(sandbox, "artifacts");
  const outside = path.join(sandbox, "outside");
  await mkdir(outside);
  try {
    await run({ root, outside });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test("stores and verifies immutable binary objects at the locked content-addressed path", async () => {
  await withTemporaryRoots(async ({ root }) => {
    const store = await LocalArtifactStore.create(root);
    const bytes = Buffer.from("owned synthetic fixture bytes", "utf8");
    const digest = sha256(bytes);
    const hex = digest.slice("sha256:".length);

    const first = await store.putObject(bytes, ".MP4");
    assert.equal(first.sha256, digest);
    assert.equal(first.created, true);
    assert.equal(
      first.absolutePath,
      path.join(await storeRoot(root), "objects", "sha256", hex.slice(0, 2), `${hex}.mp4`),
    );
    assert.deepEqual(await readFile(first.absolutePath), bytes);

    const duplicate = await store.putObject(bytes, "mp4");
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.absolutePath, first.absolutePath);
    assert.equal((await store.verifyObject(digest, "mp4")).bytes, bytes.byteLength);
    const read = await store.readObject(digest, "mp4");
    assert.deepEqual(Buffer.from(read.content), bytes);

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => store.putObject(bytes, "mp4")),
    );
    assert.equal(
      concurrent.every((artifact) => artifact.created === false),
      true,
    );
    assert.deepEqual(
      new Set(concurrent.map((artifact) => artifact.absolutePath)),
      new Set([first.absolutePath]),
    );
  });
});

test("detects corrupted immutable objects instead of overwriting them", async () => {
  await withTemporaryRoots(async ({ root }) => {
    const store = await LocalArtifactStore.create(root);
    const bytes = Buffer.from("expected bytes", "utf8");
    const stored = await store.putObject(bytes, "bin");
    await writeFile(stored.absolutePath, "corrupted bytes");

    await assert.rejects(
      store.verifyObject(stored.sha256, "bin"),
      (error) => error instanceof LocalArtifactStoreError && error.code === "CONTENT_HASH_MISMATCH",
    );
    await assert.rejects(
      store.putObject(bytes, "bin"),
      (error) => error instanceof LocalArtifactStoreError && error.code === "CONTENT_HASH_MISMATCH",
    );
  });
});

test("creates run directories and rejects traversal-shaped IDs and filenames", async () => {
  await withTemporaryRoots(async ({ root }) => {
    const store = await LocalArtifactStore.create(root);
    const run = await store.ensureRunDirectory("revision_001", "attempt_001");
    assert.equal(
      run.absolutePath,
      path.join(await storeRoot(root), "runs", "revision_001", "attempt_001"),
    );
    assert.equal((await lstat(run.absolutePath)).isDirectory(), true);
    assert.equal(
      await store.resolveRunFile("revision_001", "attempt_001", "result.json"),
      path.join(run.absolutePath, "result.json"),
    );

    await assert.rejects(store.ensureRunDirectory("../escape", "attempt_001"), invalidPath);
    await assert.rejects(store.ensureRunDirectory("revision_001", "../escape"), invalidPath);
    await assert.rejects(
      store.resolveRunFile("revision_001", "attempt_001", "../result.json"),
      invalidPath,
    );
    await assert.rejects(store.putObject(Buffer.from("x"), "../mp4"), invalidPath);
  });
});

test("rejects symlink escape attempts in object and run directory components", async () => {
  await withTemporaryRoots(async ({ root, outside }) => {
    const store = await LocalArtifactStore.create(root);
    await rm(path.join(root, "objects"), { recursive: true });
    await symlink(outside, path.join(root, "objects"), "dir");

    await assert.rejects(
      store.putObject(Buffer.from("x"), "bin"),
      (error) => error instanceof LocalArtifactStoreError && error.code === "SYMLINK_ESCAPE",
    );
  });

  await withTemporaryRoots(async ({ root, outside }) => {
    const store = await LocalArtifactStore.create(root);
    await symlink(outside, path.join(root, "runs", "revision_001"), "dir");
    await assert.rejects(
      store.ensureRunDirectory("revision_001", "attempt_001"),
      (error) => error instanceof LocalArtifactStoreError && error.code === "SYMLINK_ESCAPE",
    );
  });

  await withTemporaryRoots(async ({ root, outside }) => {
    const store = await LocalArtifactStore.create(root);
    const stored = await store.putObject(Buffer.from("expected object"), "bin");
    const replacement = path.join(outside, "replacement.bin");
    await writeFile(replacement, "expected object");
    await rm(stored.absolutePath);
    await symlink(replacement, stored.absolutePath);
    await assert.rejects(
      store.readObject(stored.sha256, "bin"),
      (error) => error instanceof LocalArtifactStoreError && error.code === "SYMLINK_ESCAPE",
    );
  });

  await withTemporaryRoots(async ({ root, outside }) => {
    const store = await LocalArtifactStore.create(root);
    const run = await store.ensureRunDirectory("revision_001", "attempt_001");
    await writeFile(path.join(outside, "result.json"), "outside");
    await symlink(path.join(outside, "result.json"), path.join(run.absolutePath, "result.json"));
    await assert.rejects(
      store.resolveRunFile("revision_001", "attempt_001", "result.json"),
      (error) => error instanceof LocalArtifactStoreError && error.code === "SYMLINK_ESCAPE",
    );
  });
});

test("returns a deterministic dry-run cleanup plan without deleting run data", async () => {
  await withTemporaryRoots(async ({ root }) => {
    const store = await LocalArtifactStore.create(root);
    const oldRun = await store.ensureRunDirectory("revision_001", "attempt_old");
    const keptRun = await store.ensureRunDirectory("revision_001", "attempt_kept");
    const freshRun = await store.ensureRunDirectory("revision_002", "attempt_fresh");
    await writeFile(path.join(oldRun.absolutePath, "result.bin"), Buffer.alloc(7));
    await writeFile(path.join(keptRun.absolutePath, "result.bin"), Buffer.alloc(11));
    await writeFile(path.join(freshRun.absolutePath, "result.bin"), Buffer.alloc(13));

    const oldTime = new Date("2026-01-01T00:00:00.000Z");
    const freshTime = new Date("2026-08-09T00:00:00.000Z");
    await utimes(oldRun.absolutePath, oldTime, oldTime);
    await utimes(keptRun.absolutePath, oldTime, oldTime);
    await utimes(freshRun.absolutePath, freshTime, freshTime);

    const plan = await store.planRunCleanup({
      cutoffEpochMs: new Date("2026-06-01T00:00:00.000Z").getTime(),
      retain: [{ revisionId: "revision_001", attemptId: "attempt_kept" }],
    });

    assert.equal(plan.dryRun, true);
    assert.equal(plan.totalBytes, 7);
    assert.deepEqual(
      plan.candidates.map(({ revisionId, attemptId, bytes }) => ({
        revisionId,
        attemptId,
        bytes,
      })),
      [{ revisionId: "revision_001", attemptId: "attempt_old", bytes: 7 }],
    );
    assert.equal((await lstat(oldRun.absolutePath)).isDirectory(), true);
    assert.equal((await lstat(path.join(oldRun.absolutePath, "result.bin"))).isFile(), true);
  });
});

test("requires an explicit absolute root and explicit cleanup cutoff", async () => {
  await assert.rejects(
    LocalArtifactStore.create("artifacts/local"),
    (error) => error instanceof LocalArtifactStoreError && error.code === "INVALID_ROOT",
  );
  await assert.rejects(
    LocalArtifactStore.create(path.parse(process.cwd()).root),
    (error) => error instanceof LocalArtifactStoreError && error.code === "INVALID_ROOT",
  );

  await withTemporaryRoots(async ({ root }) => {
    const store = await LocalArtifactStore.create(root);
    await assert.rejects(
      store.planRunCleanup({ cutoffEpochMs: Number.NaN }),
      (error) => error instanceof LocalArtifactStoreError && error.code === "UNSAFE_ENTRY",
    );
  });

  await withTemporaryRoots(async ({ root, outside }) => {
    await symlink(outside, root, "dir");
    await assert.rejects(
      LocalArtifactStore.create(root),
      (error) => error instanceof LocalArtifactStoreError && error.code === "SYMLINK_ESCAPE",
    );
  });
});

const invalidPath = (error) =>
  error instanceof LocalArtifactStoreError &&
  ["INVALID_EXTENSION", "INVALID_FILENAME", "INVALID_ID", "PATH_ESCAPE"].includes(error.code);

const storeRoot = async (root) => (await LocalArtifactStore.create(root)).root;
