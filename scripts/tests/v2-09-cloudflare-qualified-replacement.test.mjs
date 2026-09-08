import { SECRET_NAMES } from "../../deploy/v2-13/guarded-activation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createV209CloudflareQualifiedReplacement } from "../../deploy/v2-09/cloudflare-qualified-replacement.mjs";
const canonical = (v) =>
  v && typeof v === "object"
    ? "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    : JSON.stringify(v);
const hash = (x) => "sha256:" + createHash("sha256").update(x).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "v209-replacement-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = join(root, "old.json");
  writeFileSync(old, "old", { mode: 0o600 });
  const predecessor = {
    versionId: "00000000-0000-4000-8000-000000000001",
    sourceCommit: "1".repeat(40),
    qualifiedConfigPath: old,
    qualifiedConfigSha256: hash("old"),
    workerBundleSha256: "sha256:" + "2".repeat(64),
  };
  const authority = {
    source_commit: "3".repeat(40),
    single_use: true,
    production: { secret_count: SECRET_NAMES.length },
    caps: { max_incremental_usd: 2, max_completion_usd: 17.5 },
    replacement_predecessor_sha256: hash(canonical(predecessor)),
  };
  const calls = [];
  const version = {
    versionId: "00000000-0000-4000-8000-000000000002",
    versionIdSha256: "sha256:" + "4".repeat(64),
  };
  const capabilities = {
    assertAuthority: () => {},
    assertCleanupAuthority: () => {},
    predecessor: async () => {
      calls.push("old-read");
      return { versionIdSha256: hash(predecessor.versionId) };
    },
    prepare: async () => ({ cleanup: () => calls.push("artifact-clean") }),
    deploy: async () => calls.push("deploy"),
    readback: async (_a, mode) => {
      calls.push(mode);
      return version;
    },
    disable: async () => {
      calls.push("disable");
      return version;
    },
  };
  const args = {
    configuration: { journalPath: join(root, "journal.json") },
    authority,
    predecessor,
  };
  return {
    api: createV209CloudflareQualifiedReplacement(args, { testOnly: true, capabilities }),
    capabilities,
    calls,
    args,
  };
}
test("one replacement preserves inherited secret history and requires effective readback", async (t) => {
  const f = fixture(t);
  await f.api.verifyPredecessor();
  await f.api.deployOnce();
  await f.api.readbackEffective();
  assert.equal(f.calls.filter((x) => x === "deploy").length, 1);
  assert.deepEqual(f.api.read().introduced_secret_names, []);
  assert.equal(f.api.read().inherited_secret_count, SECRET_NAMES.length);
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/);
});
test("unknown deploy never retries and allows only one preserving disable", async (t) => {
  const f = fixture(t);
  f.capabilities.deploy = async () => {
    throw Error("unknown");
  };
  await f.api.verifyPredecessor();
  await assert.rejects(f.api.deployOnce(), /unknown/);
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/);
  await f.api.containFailure();
  assert.equal(f.api.read().state, "SAFE_DISABLED_INHERITED_SECRETS_RETAINED");
  assert.equal(f.calls.filter((x) => x === "disable").length, 1);
  await assert.rejects(f.api.containFailure(), /CLEANUP_REPLAY_OR_STATE/);
});
test("predecessor mismatch stops before deploy and cannot overwrite claim", async (t) => {
  const f = fixture(t);
  f.capabilities.predecessor = async () => {
    throw Error("drift");
  };
  await assert.rejects(f.api.verifyPredecessor(), /drift/);
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/);
  await assert.rejects(f.api.verifyPredecessor());
  assert.ok(!f.calls.includes("deploy"));
});
test("effective readback different version rejected", async (t) => {
  const f = fixture(t);
  await f.api.verifyPredecessor();
  await f.api.deployOnce();
  f.capabilities.readback = async () => ({ versionId: "other" });
  await assert.rejects(f.api.readbackEffective(), /VERSION_DRIFT/);
});
test("unbound predecessor and production injection rejected", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createV209CloudflareQualifiedReplacement(
        { ...f.args, predecessor: { ...f.args.predecessor, sourceCommit: "9".repeat(40) } },
        { testOnly: true, capabilities: f.capabilities },
      ),
    /BINDING/,
  );
  assert.throws(
    () => createV209CloudflareQualifiedReplacement(f.args, { capabilities: f.capabilities }),
    /INJECTION/,
  );
});

test("production secret contract includes Runware and has no duplicate names", () => {
  assert.equal(SECRET_NAMES.length, 23);
  assert.ok(SECRET_NAMES.includes("RUNWARE_API_KEY"));
  assert.equal(new Set(SECRET_NAMES).size, SECRET_NAMES.length);
});
