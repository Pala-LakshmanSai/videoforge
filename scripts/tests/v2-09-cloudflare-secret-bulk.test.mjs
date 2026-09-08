import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { executeV209SecretBulk } from "../../deploy/v2-09/cloudflare-secret-bulk.mjs";
import { SECRET_NAMES } from "../../deploy/v2-13/guarded-activation.mjs";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "v209-bulk-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "oauth.toml");
  const scopes = ["account:read", "workers_scripts:write"];
  const raw = `oauth_token = "test-token"\nexpiration_time = "2099-01-01T00:00:00Z"\nscopes = ${JSON.stringify(scopes)}\n`;
  writeFileSync(path, raw, { mode: 0o600 });
  const secretInputs = Object.fromEntries(
    SECRET_NAMES.map((name) => {
      const bytes = Buffer.from(`${name}-sealed\n`);
      return [
        name,
        { bytes, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` },
      ];
    }),
  );
  const calls = [];
  const args = {
    accountId: "a".repeat(32),
    expiresAt: "2099-01-01T00:00:00Z",
    workerName: "videoforge-production-runtime",
    oauthConfigPath: path,
    environment: {},
    expectedOauthScopes: scopes,
    secretInputs,
    beforeDispatch: () => calls.push("gate"),
  };
  const deps = {
    testOnly: true,
    refreshOAuth: () => calls.push("oauth"),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, json: async () => ({ success: true, errors: [] }) };
    },
  };
  return { args, deps, calls, path, raw };
}
test("one exact bulk PATCH preserves exact allowlisted sealed values and runs authority gate after OAuth", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await executeV209SecretBulk(f.args, f.deps), {
    secret_count: SECRET_NAMES.length,
  });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.slice(0, 2), ["oauth", "gate"]);
  const { url, options } = f.calls[2];
  assert.ok(url.endsWith("/workers/scripts/videoforge-production-runtime/secrets-bulk"));
  assert.equal(options.method, "PATCH");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers["Content-Type"], "application/merge-patch+json");
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body.secrets), SECRET_NAMES);
  for (const name of SECRET_NAMES)
    assert.deepEqual(body.secrets[name], { name, text: `${name}-sealed\n`, type: "secret_text" });
});
test("bad hash and missing key fail before OAuth or dispatch", async (t) => {
  for (const mode of ["hash", "missing"]) {
    const f = fixture(t);
    if (mode === "hash") f.args.secretInputs[SECRET_NAMES[0]].sha256 = "bad";
    else delete f.args.secretInputs[SECRET_NAMES[0]];
    await assert.rejects(executeV209SecretBulk(f.args, f.deps), /INPUT_INVALID/);
    assert.equal(f.calls.length, 0);
  }
});
test("duplicate credential field and unsafe mode fail before PATCH", async (t) => {
  for (const mode of ["duplicate", "mode"]) {
    const f = fixture(t);
    if (mode === "duplicate") writeFileSync(f.path, f.raw + 'oauth_token = "other"\n');
    else chmodSync(f.path, 0o644);
    await assert.rejects(executeV209SecretBulk(f.args, f.deps), /CREDENTIAL_INVALID/);
    assert.deepEqual(f.calls, ["oauth"]);
  }
});
test("unknown outcome never retries and never leaks raw error", async (t) => {
  const f = fixture(t);
  let count = 0;
  f.deps.fetch = async () => {
    count++;
    throw Error("secret-value-sensitive");
  };
  await assert.rejects(
    executeV209SecretBulk(f.args, f.deps),
    (e) => e.message === "V2_09_CLOUDFLARE_SECRET_BULK_OUTCOME_UNKNOWN",
  );
  assert.equal(count, 1);
});
test("caller cancellation and authority failure prohibit mutation", async (t) => {
  for (const mode of ["cancel", "gate"]) {
    const f = fixture(t);
    if (mode === "cancel") f.args.cancellationSignal = AbortSignal.abort();
    else
      f.args.beforeDispatch = () => {
        throw Error("sensitive");
      };
    await assert.rejects(
      executeV209SecretBulk(f.args, f.deps),
      /CANCELLED|AUTHORITY_RECHECK_FAILED/,
    );
    assert.ok(!f.calls.some((x) => typeof x === "object"));
  }
});
test("injection requires explicit testOnly", async (t) => {
  const f = fixture(t);
  delete f.deps.testOnly;
  await assert.rejects(executeV209SecretBulk(f.args, f.deps), /INJECTION_FORBIDDEN/);
  assert.equal(f.calls.length, 0);
});

test("authority expiry after refresh prevents PATCH", async (t) => {
  const f = fixture(t);
  f.args.expiresAt = new Date(1000).toISOString();
  f.deps.now = () => 1000;
  await assert.rejects(executeV209SecretBulk(f.args, f.deps), /AUTHORITY_EXPIRED/);
  assert.ok(!f.calls.some((x) => typeof x === "object"));
});
test("request signal expires at authority deadline", async (t) => {
  const f = fixture(t);
  f.args.expiresAt = new Date(Date.now() + 30).toISOString();
  f.deps.fetch = async (url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(options.signal.aborted, true);
    throw Error("aborted");
  };
  await assert.rejects(executeV209SecretBulk(f.args, f.deps), /OUTCOME_UNKNOWN/);
});
