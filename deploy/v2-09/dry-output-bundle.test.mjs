import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashV209DryOutputBundle } from "./dry-output-bundle.mjs";
const workerName = "videoforge-production-runtime";
const readme = (time = "2026-09-08T09:00:53.144Z", worker = workerName) =>
  `This folder contains the built output assets for the worker "${worker}" generated at ${time}.`;
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "v209-payload-"));
  try {
    writeFileSync(join(dir, "README.md"), readme());
    writeFileSync(join(dir, "index.js"), "export default {};");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const hash = (dir) => hashV209DryOutputBundle(dir, { workerName });
test("only canonical generated README time is excluded; payload remains stable", () =>
  fixture((dir) => {
    const before = hash(dir);
    writeFileSync(join(dir, "README.md"), readme("2026-09-09T10:01:02.003Z"));
    assert.equal(hash(dir), before);
    writeFileSync(join(dir, "index.js"), "export default {changed:true};");
    assert.notEqual(hash(dir), before);
  }));
test("all other files and their exact paths participate including nested README", () =>
  fixture((dir) => {
    const before = hash(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "index.html"), "runtime");
    const withAsset = hash(dir);
    assert.notEqual(withAsset, before);
    renameSync(join(dir, "assets", "index.html"), join(dir, "assets", "other.html"));
    assert.notEqual(hash(dir), withAsset);
    const renamed = hash(dir);
    writeFileSync(join(dir, "assets", "README.md"), "payload");
    assert.notEqual(hash(dir), renamed);
  }));
test("reject unknown README, wrong worker, invalid date or extra bytes", () =>
  fixture((dir) => {
    for (const text of [
      "unknown",
      readme() + "\n",
      readme("2026-02-30T00:00:00.000Z"),
      readme(undefined, "foreign-worker"),
      readme() + "extra",
    ]) {
      writeFileSync(join(dir, "README.md"), text);
      assert.throws(() => hash(dir), /README_INVALID/u);
    }
  }));
test("requires generated README and exact index entrypoint", () =>
  fixture((dir) => {
    rmSync(join(dir, "README.md"));
    assert.throws(() => hash(dir), /README_MISSING/u);
    writeFileSync(join(dir, "README.md"), readme());
    renameSync(join(dir, "index.js"), join(dir, "worker.js"));
    assert.throws(() => hash(dir), /ENTRYPOINT_MISSING/u);
  }));
test("reject symlink entries and root symlink", () =>
  fixture((dir) => {
    symlinkSync(join(dir, "index.js"), join(dir, "linked.js"));
    assert.throws(() => hash(dir), /SYMLINK/u);
    rmSync(join(dir, "linked.js"));
    const alias = dir + "-alias";
    symlinkSync(dir, alias);
    try {
      assert.throws(() => hash(alias), /DIRECTORY_INVALID/u);
    } finally {
      rmSync(alias);
    }
  }));
