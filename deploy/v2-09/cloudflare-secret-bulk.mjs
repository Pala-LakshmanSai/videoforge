import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { refreshWranglerOAuthReadback, SECRET_NAMES } from "../v2-13/guarded-activation.mjs";

const fail = (code) => {
  throw new Error(`V2_09_CLOUDFLARE_SECRET_BULK_${code}`);
};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function credential(path, scopes, now) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 65536
    )
      fail("CREDENTIAL_INVALID");
    const raw = readFileSync(fd, "utf8");
    const values = {};
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const match = line.match(
        /^\s*(oauth_token|refresh_token|expiration_time|scopes)\s*=\s*(.+)\s*$/u,
      );
      if (!match || Object.hasOwn(values, match[1])) fail("CREDENTIAL_INVALID");
      values[match[1]] = JSON.parse(match[2]);
    }
    if (
      typeof values.oauth_token !== "string" ||
      !values.oauth_token ||
      values.oauth_token !== values.oauth_token.trim() ||
      /[\r\n\0]/u.test(values.oauth_token) ||
      typeof values.expiration_time !== "string" ||
      Date.parse(values.expiration_time) - now < 60000 ||
      !Number.isFinite(Date.parse(values.expiration_time)) ||
      !Array.isArray(values.scopes) ||
      values.scopes.some((x) => typeof x !== "string" || !x) ||
      new Set(values.scopes).size !== values.scopes.length ||
      !same(values.scopes, scopes)
    )
      fail("CREDENTIAL_INVALID");
    return values.oauth_token;
  } catch {
    fail("CREDENTIAL_INVALID");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export async function executeV209SecretBulk(
  {
    accountId,
    workerName,
    oauthConfigPath,
    environment,
    expectedOauthScopes,
    secretInputs,
    cancellationSignal,
    beforeDispatch,
    expiresAt,
  },
  dependencies = {},
) {
  const keys = Object.keys(dependencies);
  if (
    keys.some((k) => !["testOnly", "refreshOAuth", "fetch", "now"].includes(k)) ||
    (keys.some((k) => k !== "testOnly") && dependencies.testOnly !== true)
  )
    fail("INJECTION_FORBIDDEN");
  if (
    !/^[a-f0-9]{32}$/u.test(accountId ?? "") ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(workerName ?? "") ||
    typeof oauthConfigPath !== "string" ||
    !oauthConfigPath.startsWith("/") ||
    !Array.isArray(expectedOauthScopes) ||
    expectedOauthScopes.some((x) => typeof x !== "string" || !x) ||
    new Set(expectedOauthScopes).size !== expectedOauthScopes.length ||
    !expectedOauthScopes.includes("account:read") ||
    !expectedOauthScopes.includes("workers_scripts:write") ||
    !secretInputs ||
    !same(Object.keys(secretInputs), SECRET_NAMES) ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    typeof beforeDispatch !== "function"
  )
    fail("INPUT_INVALID");
  const scopes = [...expectedOauthScopes];
  const secrets = {};
  for (const name of SECRET_NAMES) {
    const input = secretInputs[name];
    if (
      !input ||
      !same(Object.keys(input), ["bytes", "sha256"]) ||
      !Buffer.isBuffer(input.bytes) ||
      input.bytes.length === 0 ||
      `sha256:${createHash("sha256").update(input.bytes).digest("hex")}` !== input.sha256
    )
      fail("INPUT_INVALID");
    const text = input.bytes.toString("utf8");
    if (!Buffer.from(text).equals(input.bytes) || text.includes("\0")) fail("INPUT_INVALID");
    secrets[name] = { name, text, type: "secret_text" };
  }
  const body = JSON.stringify({ secrets });
  if (cancellationSignal?.aborted) fail("CANCELLED");
  try {
    await (dependencies.refreshOAuth ?? refreshWranglerOAuthReadback)({
      configPath: oauthConfigPath,
      environment,
      accountId,
      expectedScopes: scopes,
    });
  } catch {
    fail("OAUTH_READBACK_FAILED");
  }
  const token = credential(oauthConfigPath, scopes, (dependencies.now ?? Date.now)());
  try {
    await beforeDispatch();
  } catch {
    fail("AUTHORITY_RECHECK_FAILED");
  }
  const remaining = Date.parse(expiresAt) - (dependencies.now ?? Date.now)();
  if (!Number.isFinite(remaining) || remaining <= 0) fail("AUTHORITY_EXPIRED");
  const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(30000, remaining))));
  const signal = cancellationSignal
    ? AbortSignal.any([cancellationSignal, timeoutSignal])
    : timeoutSignal;
  if (signal.aborted) fail("CANCELLED");
  let response;
  try {
    response = await (dependencies.fetch ?? fetch)(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/secrets-bulk`,
      {
        method: "PATCH",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/merge-patch+json",
        },
        body,
      },
    );
    const value = await response.json();
    if (
      response.status !== 200 ||
      value?.success !== true ||
      !Array.isArray(value.errors) ||
      value.errors.length !== 0
    )
      fail("OUTCOME_UNKNOWN");
  } catch {
    fail("OUTCOME_UNKNOWN");
  }
  return Object.freeze({ secret_count: SECRET_NAMES.length });
}
