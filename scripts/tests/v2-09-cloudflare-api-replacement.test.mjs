import { SECRET_NAMES } from "../../deploy/v2-13/guarded-activation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createV209CloudflareApiReplacement } from "../../deploy/v2-09/cloudflare-api-replacement.mjs";
const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const hash = (x) => "sha256:" + createHash("sha256").update(x).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "v209-api-replacement-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = join(root, "old.json");
  writeFileSync(old, "old", { mode: 0o600 });
  const predecessor = {
    versionId: "00000000-0000-4000-8000-000000000001",
    sourceCommit: "1".repeat(40),
    artifactRootPath: root,
    qualifiedConfigPath: old,
    qualifiedConfigSha256: hash("old"),
    workerBundleSha256: "sha256:" + "2".repeat(64),
  };
  const authority = {
    execution: "V2_09_KIE_FAL_API_REPLACEMENT_ONCE",
    source_commit: "3".repeat(40),
    single_use: true,
    production: {
      worker_name: "videoforge-production",
      secret_count: 25,
      secret_allowlist_sha256: hash(canonical([...SECRET_NAMES].sort())),
      config_sha256: "sha256:" + "4".repeat(64),
      worker_bundle_sha256: "sha256:" + "5".repeat(64),
    },
    caps: { max_incremental_usd: 5, max_completion_usd: 5 },
    replacement_predecessor_sha256: hash(canonical(predecessor)),
  };
  const calls = [];
  const version = {
    versionId: "00000000-0000-4000-8000-000000000002",
    versionIdSha256: "sha256:" + "6".repeat(64),
  };
  const capabilities = {
    assertAuthority: () => calls.push("authority"),
    assertCleanupAuthority: (approved) => {
      assert.equal(approved.scope.cleanup_only_recovery, true);
      calls.push("cleanup-authority");
    },
    predecessor: async () => {
      calls.push("predecessor");
      return { versionIdSha256: hash(predecessor.versionId) };
    },
    prepare: async () => {
      calls.push("prepare");
      return { cleanup: () => calls.push("artifact-clean") };
    },
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
  const cleanupAuthority = {
    ...authority,
    authority_id: "separate-cleanup-authority",
    scope: { cleanup_only_recovery: true, allow_redispatch: false },
  };
  return {
    api: createV209CloudflareApiReplacement(args, { testOnly: true, capabilities }),
    capabilities,
    calls,
    args,
    cleanupAuthority,
  };
}
test("API replacement claims predecessor then deploys once with disabled-route readback", async (t) => {
  const f = fixture(t);
  await f.api.verifyPredecessor();
  const version = await f.api.deployOnce();
  assert.equal(version.versionId, "00000000-0000-4000-8000-000000000002");
  assert.deepEqual(
    f.calls.filter((x) => ["deploy", "DISABLED_UNQUALIFIED"].includes(x)),
    ["deploy", "DISABLED_UNQUALIFIED"],
  );
  assert.equal(f.api.read().state, "API_EFFECTIVE_VERIFIED");
  assert.equal(f.api.read().required_successor_secret_count, 25);
  assert.equal(f.api.read().retained_r2_deleted, false);
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/u);
});
test("uncertain deploy consumes attempt; containment disables once", async (t) => {
  const f = fixture(t);
  f.capabilities.deploy = async () => {
    f.calls.push("deploy");
    throw Error("unknown");
  };
  await f.api.verifyPredecessor();
  await assert.rejects(f.api.deployOnce(), /unknown/u);
  assert.equal(f.api.read().state, "DEPLOY_UNKNOWN");
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/u);
  await assert.rejects(f.api.containFailure(), /CLEANUP_BINDING/u);
  await assert.rejects(
    f.api.containFailure({
      ...f.cleanupAuthority,
      production: { ...f.cleanupAuthority.production, config_sha256: "sha256:" + "0".repeat(64) },
    }),
    /CLEANUP_BINDING/u,
  );
  await f.api.containFailure(f.cleanupAuthority);
  assert.equal(f.api.read().state, "SAFE_DISABLED_INHERITED_SECRETS_RETAINED");
  assert.equal(f.calls.filter((x) => x === "deploy").length, 1);
  assert.equal(f.calls.filter((x) => x === "disable").length, 1);
  await assert.rejects(f.api.containFailure(f.cleanupAuthority), /CLEANUP_REPLAY_OR_STATE/u);
});
test("readback failure cannot redeploy and permits containment", async (t) => {
  const f = fixture(t);
  f.capabilities.readback = async () => {
    throw Error("route drift");
  };
  await f.api.verifyPredecessor();
  await assert.rejects(f.api.deployOnce(), /route drift/u);
  assert.equal(f.api.read().state, "DEPLOY_COMMITTED");
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/u);
  await f.api.containFailure(f.cleanupAuthority);
  assert.equal(f.calls.filter((x) => x === "disable").length, 1);
});
test("predecessor drift fails after durable claim without deploy", async (t) => {
  const f = fixture(t);
  f.capabilities.predecessor = async () => {
    throw Error("drift");
  };
  await assert.rejects(f.api.verifyPredecessor(), /drift/u);
  assert.equal(f.api.read().state, "CLAIMED");
  await assert.rejects(f.api.verifyPredecessor(), /LOCKED|EEXIST/u);
  await assert.rejects(f.api.deployOnce(), /DEPLOY_REPLAY/u);
  assert.ok(!f.calls.includes("deploy"));
});
test("API authority marker, predecessor hash, and test-only injection are required", (t) => {
  const f = fixture(t);
  for (const authority of [
    { ...f.args.authority, execution: "V2_09_QUALIFIED_REPLACEMENT_ONCE" },
    { ...f.args.authority, caps: { max_incremental_usd: 2, max_completion_usd: 17.5 } },
    { ...f.args.authority, replacement_predecessor_sha256: "sha256:" + "0".repeat(64) },
  ]) {
    assert.throws(
      () =>
        createV209CloudflareApiReplacement(
          { ...f.args, authority },
          { testOnly: true, capabilities: f.capabilities },
        ),
      /BINDING/u,
    );
  }
  assert.throws(
    () => createV209CloudflareApiReplacement(f.args, { capabilities: f.capabilities }),
    /INJECTION/u,
  );
});
