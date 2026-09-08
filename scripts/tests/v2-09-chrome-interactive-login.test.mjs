import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { materializeV209InteractiveLogin } from "../../deploy/v2-09/chrome-interactive-login.mjs";
const canonical = (x) =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
const hash = (x) => "sha256:" + createHash("sha256").update(x).digest("hex");
function fixture(t, forever = false) {
  const root = mkdtempSync(join(tmpdir(), "v209-login-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = "https://test.example";
  const c = {
    productionOrigin: origin,
    authStatePath: root + "/chrome-auth-state.json",
    chromeRequestPath: root + "/chrome-request.json",
    loginTimeoutMs: 600000,
    voiceoverSha256: "sha256:" + "a".repeat(64),
  };
  const a = {
    authority_id: "test",
    source_commit: "b".repeat(40),
    proposal_sha256: "sha256:" + "c".repeat(64),
    single_use: true,
    expires_at: new Date(700000).toISOString(),
  };
  const p = { chrome_bootstrap: c };
  const save = (n, x) => writeFileSync(join(root, n), canonical(x) + "\n", { mode: 384 });
  save("authority.json", a);
  save("materialization-plan.json", p);
  save("combined-outer-state.json", {
    status: "AWAITING_INTERACTIVE_CHROME_LOGIN",
    outer_authority_id: a.authority_id,
    source_commit: a.source_commit,
    proposal_sha256: a.proposal_sha256,
    operations: Array.from({ length: 26 }, (_, i) => ({
      id: i === 22 ? "materialize-v209-postdeploy-chrome-auth" : "op" + i,
      status: i < 22 ? "COMPLETED" : i === 22 ? "STARTED" : "PENDING",
    })),
  });
  const binding = {
    mode: "FULL_POST_DEPLOY_BOOTSTRAP",
    origin,
    configuration_sha256: hash(canonical(c)),
    voiceover_sha256: c.voiceoverSha256,
  };
  const stage = c.authStatePath + ".v209-" + hash(canonical(binding)).slice(7, 31) + ".next";
  save("chrome-auth-state.json.v209-claim.json", {
    schema_version: "videoforge.v2-09-chrome-auth-adoption-claim/v1",
    auth_state_path_sha256: hash(c.authStatePath),
    binding_sha256: hash(canonical(binding)),
    stage_path_sha256: hash(stage),
  });
  let now = 0,
    reads = 0;
  const page = {
    goto: async () => {},
    url: () => origin + "/projects/new",
    evaluate: async () => {
      reads++;
      return forever || reads === 1
        ? { pending: true }
        : {
            schema: "videoforge-hosted-tenant/v1",
            account: "11111111-1111-1111-1111-111111111111",
            workspace: "22222222-2222-2222-2222-222222222222",
          };
    },
    close: async () => {},
  };
  const context = {
    newPage: async () => page,
    storageState: async () => ({ cookies: [{ name: "session", value: "private" }], origins: [] }),
    close: async () => {},
  };
  const deps = {
    testOnly: true,
    now: () => now,
    wait: async (ms) => {
      now += forever ? 600000 : ms;
    },
    launch: async () => ({ newContext: async () => context, close: async () => {} }),
  };
  return {
    root,
    stage,
    page,
    deps,
    args: {
      root,
      authoritySha256: hash(readFileSync(root + "/authority.json")),
      planSha256: hash(readFileSync(root + "/materialization-plan.json")),
    },
    reads: () => reads,
    context,
    setNow: (value) => {
      now = value;
    },
  };
}
test("same initial URL401 waits then writes only exactclaim stage", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await materializeV209InteractiveLogin(f.args, f.deps), {
    status: "CLAIM_BOUND_AUTH_READY",
    generate_clicks: 0,
  });
  assert.equal(f.reads(), 2);
  assert.ok(existsSync(f.stage));
  assert.ok(!existsSync(f.root + "/chrome-auth-state.json"));
  assert.equal(JSON.parse(readFileSync(f.stage)).cookies.length, 1);
});
test("perpetual401 times out without authstate or leftover reservation", async (t) => {
  const f = fixture(t, true);
  assert.equal(
    (await materializeV209InteractiveLogin(f.args, f.deps)).status,
    "AWAITING_INTERACTIVE_CHROME_LOGIN",
  );
  assert.ok(!existsSync(f.stage));
});
test("existingstage neverclobbered and wronghash neverlaunches", async (t) => {
  const f = fixture(t);
  writeFileSync(f.stage, "owned", { mode: 384 });
  await assert.rejects(materializeV209InteractiveLogin(f.args, f.deps), /STAGE_EXISTS/);
  assert.equal(readFileSync(f.stage, "utf8"), "owned");
  await assert.rejects(
    materializeV209InteractiveLogin({ ...f.args, planSha256: "bad" }, f.deps),
    /HASH/,
  );
});
test("invalid tenant fails and removes empty reservation", async (t) => {
  const f = fixture(t);
  f.page.evaluate = async () => ({ schema: "wrong" });
  await assert.rejects(materializeV209InteractiveLogin(f.args, f.deps), /TENANT/);
  assert.ok(!existsSync(f.stage));
});

test("stage mode drift prevents credential write", async (t) => {
  const f = fixture(t);
  const original = f.context.storageState;
  f.context.storageState = async () => {
    chmodSync(f.stage, 0o644);
    return original();
  };
  await assert.rejects(materializeV209InteractiveLogin(f.args, f.deps), /STAGE_DRIFT/);
  assert.ok(!existsSync(f.stage));
});
test("deadline elapsed during storage capture prevents credential write", async (t) => {
  const f = fixture(t);
  const original = f.context.storageState;
  f.context.storageState = async () => {
    f.setNow(600001);
    return original();
  };
  await assert.rejects(materializeV209InteractiveLogin(f.args, f.deps), /LOGIN_DEADLINE/);
  assert.ok(!existsSync(f.stage));
});

test("Google callback execution-context race remains pending", async (t) => {
  const f = fixture(t);
  const original = f.page.evaluate;
  let first = true;
  f.page.evaluate = async () => {
    if (first) {
      first = false;
      throw Error("Execution context was destroyed, most likely because of a navigation.");
    }
    return original();
  };
  assert.equal(
    (await materializeV209InteractiveLogin(f.args, f.deps)).status,
    "CLAIM_BOUND_AUTH_READY",
  );
});
