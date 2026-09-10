import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PSQL = "/opt/homebrew/opt/libpq/bin/psql";
const PRIVATE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const WORKER_NAME = "videoforge-production-runtime";
const PUBLIC_ORIGIN = "https://videoforge-production-runtime.lakshmansai121.workers.dev";

type JsonRecord = Record<string, unknown>;

const fail = (code: string): never => {
  throw new Error(`V2_09_EXISTING_ACTIVATION_${code}`);
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as JsonRecord)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as JsonRecord)[key])}`)
    .join(",")}}`;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(bytes[16]!, 16) % 4]!;
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_DIRECTORY_INVALID");
}

function privateFile(path: string): void {
  if (!isAbsolute(path)) fail("PRIVATE_PATH_INVALID");
  privateDirectory(resolve(path, ".."));
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== PRIVATE_MODE ||
    stat.nlink !== 1 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_FILE_INVALID");
}

function readPrivateText(path: string): string {
  privateFile(path);
  return readFileSync(path, "utf8");
}

function writePrivateFile(path: string, value: string): void {
  if (existsSync(path)) fail("PRIVATE_OUTPUT_ALREADY_EXISTS");
  writeFileSync(path, value, { flag: "wx", mode: PRIVATE_MODE });
  chmodSync(path, PRIVATE_MODE);
  privateFile(path);
}

function parseArgs(tokens: readonly string[]): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--") || tokens[index + 1]?.startsWith("--")) fail("ARGUMENTS_INVALID");
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || result[key] !== undefined) fail("ARGUMENTS_INVALID");
    result[key] = value;
    index += 1;
  }
  return Object.freeze(result);
}

function requiredPath(args: Readonly<Record<string, string>>, name: string): string {
  const value = args[name];
  if (!value || !isAbsolute(value)) fail(`ARGUMENT_${name.toUpperCase()}_INVALID`);
  return resolve(value);
}

function gitHead(): string {
  const value = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!COMMIT.test(value)) fail("SOURCE_COMMIT_INVALID");
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() !== ""
  )
    fail("TRACKED_WORKTREE_NOT_CLEAN");
  return value;
}

function cloudflareConfiguration({
  privateRoot,
  sourceCommit,
  secretRoot,
  runwareKeyPath,
  oauthConfigPath,
  secretNames,
  oauthScopes,
}: {
  privateRoot: string;
  sourceCommit: string;
  secretRoot: string;
  runwareKeyPath: string;
  oauthConfigPath: string;
  secretNames: readonly string[];
  oauthScopes: readonly string[];
}) {
  return {
    bootstrapConfigPath: join(privateRoot, "wrangler.production.bootstrap.json"),
    disabledConfigPath: join(privateRoot, "wrangler.production.disabled.json"),
    environment: {
      CI: "1",
      HOME: "/Users/lakshmansai",
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: "production",
      PATH: "/Users/lakshmansai/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: "/tmp",
      WRANGLER_SEND_METRICS: "false",
    },
    expectedOauthScopes: oauthScopes,
    journalPath: join(privateRoot, "cloudflare-replacement-journal.json"),
    oauthConfigPath,
    qualifiedConfigPath: join(privateRoot, "wrangler.production.qualified.json"),
    root: ROOT,
    secretFiles: Object.fromEntries(
      secretNames.map((name) => [
        name,
        name === "RUNWARE_API_KEY" ? runwareKeyPath : join(secretRoot, name),
      ]),
    ),
    sourceCommit,
    workerName: WORKER_NAME,
  } as const;
}

function runPsql(databaseUrl: string, args: readonly string[]): string {
  return execFileSync(PSQL, [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PSQL_HISTORY: "/dev/null" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readPriorEvidence(databaseUrl: string): JsonRecord {
  const output = runPsql(databaseUrl, [
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT evidence_document::text FROM public.hosted_v209_qualified_activations ORDER BY imported_at DESC,id DESC LIMIT 1",
  ]).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail("PRIOR_EVIDENCE_JSON_INVALID");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !==
      "activationId,cloudflareVersionIdSha256,deployedConfigSha256,lanes,observedAt,readbackSha256,schemaVersion,sourceCommit"
  )
    fail("PRIOR_EVIDENCE_SHAPE_INVALID");
  return parsed as JsonRecord;
}

function validateImportReadback(
  value: unknown,
  payload: JsonRecord,
  version: JsonRecord,
): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("IMPORT_JSON_INVALID");
  const result = value as JsonRecord;
  const imported = result.imported as JsonRecord | undefined;
  const loaded = result.loaded as JsonRecord | undefined;
  const verification = loaded?.verification as JsonRecord | undefined;
  const evidence = loaded?.evidence as JsonRecord | undefined;
  if (
    imported?.schemaVersion !== "videoforge.hosted-v209-qualified-activation-result/v1" ||
    imported.activationId !== payload.activationId ||
    imported.replayed !== false ||
    !HASH.test(String(imported.evidenceSha256 ?? "")) ||
    verification?.accepted !== true ||
    verification.signatureVerified !== true ||
    verification.sourceCommit !== payload.sourceCommit ||
    evidence?.deployedConfigSha256 !== payload.deployedConfigSha256 ||
    evidence?.cloudflareVersionIdSha256 !== version.versionIdSha256
  )
    fail("IMPORT_READBACK_INVALID");
  return Object.freeze({
    activationIdSha256: sha256(String(payload.activationId)),
    evidenceSha256: imported.evidenceSha256,
    sourceCommit: payload.sourceCommit,
    deployedConfigSha256: payload.deployedConfigSha256,
    cloudflareVersionIdSha256: version.versionIdSha256,
  });
}

async function execute(args: Readonly<Record<string, string>>): Promise<JsonRecord> {
  const { APPROVED_WRANGLER_OAUTH_SCOPES, SECRET_NAMES } = await import(
    "../v2-13/guarded-activation.mjs"
  );
  const { createV209CloudflareReplacementCapabilities } = await import(
    "./cloudflare-production-operator.mjs"
  );
  const privateRoot = requiredPath(args, "private-root");
  const databaseOwnerUrlPath = requiredPath(args, "database-owner-url");
  const secretRoot = requiredPath(args, "secret-root");
  const runwareKeyPath = requiredPath(args, "runware-key");
  const oauthConfigPath = requiredPath(args, "oauth-config");
  privateDirectory(privateRoot);
  privateFile(databaseOwnerUrlPath);
  privateDirectory(secretRoot);
  privateFile(runwareKeyPath);
  privateFile(oauthConfigPath);
  const authority = JSON.parse(readPrivateText(join(privateRoot, "authority.json"))) as JsonRecord;
  const sourceCommit = gitHead();
  if (authority.source_commit !== sourceCommit) fail("SOURCE_AUTHORITY_MISMATCH");
  const databaseUrl = readPrivateText(databaseOwnerUrlPath).trim();
  if (databaseUrl.length === 0) fail("DATABASE_URL_INVALID");
  const configuration = cloudflareConfiguration({
    privateRoot,
    sourceCommit,
    secretRoot,
    runwareKeyPath,
    oauthConfigPath,
    secretNames: SECRET_NAMES,
    oauthScopes: APPROVED_WRANGLER_OAUTH_SCOPES,
  });
  const capabilities = createV209CloudflareReplacementCapabilities(configuration);
  const version = (await capabilities.readback(authority, "DISABLED_UNQUALIFIED")) as JsonRecord;
  if (
    !UUID.test(String(version.versionId ?? "")) ||
    !HASH.test(String(version.versionIdSha256 ?? ""))
  )
    fail("LIVE_VERSION_INVALID");
  const prior = readPriorEvidence(databaseUrl);
  const payload: JsonRecord = {
    ...prior,
    activationId: deterministicUuid(`${String(authority.authority_id)}:activation`),
    cloudflareVersionIdSha256: version.versionIdSha256,
    deployedConfigSha256: (authority.production as JsonRecord).config_sha256,
    observedAt: new Date().toISOString(),
    readbackSha256: version.versionReadbackSha256,
    sourceCommit,
  };
  if (
    !UUID.test(String(payload.activationId)) ||
    !HASH.test(String(payload.cloudflareVersionIdSha256)) ||
    !HASH.test(String(payload.deployedConfigSha256)) ||
    !HASH.test(String(payload.readbackSha256))
  )
    fail("ACTIVATION_PAYLOAD_INVALID");
  writePrivateFile(join(privateRoot, "activation-intent.json"), `${canonical(payload)}\n`);
  const payloadBase64 = Buffer.from(canonical(payload), "utf8").toString("base64");
  const importOutput = runPsql(databaseUrl, [
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--variable",
    `payload_base64=${payloadBase64}`,
    "--file",
    resolve(ROOT, "deploy/v2-09/neon-import-qualified-activation.sql"),
  ]).trim();
  let importValue: unknown;
  try {
    importValue = JSON.parse(importOutput);
  } catch {
    fail("IMPORT_OUTPUT_INVALID");
  }
  const importResult = validateImportReadback(importValue, payload, version);
  writePrivateFile(join(privateRoot, "activation-result.json"), `${canonical(importResult)}\n`);
  const response = await fetch(`${PUBLIC_ORIGIN}/api/v2/hosted/status`, {
    redirect: "error",
    headers: { accept: "application/json" },
  });
  const body = (await response.json()) as JsonRecord;
  if (
    response.status !== 200 ||
    response.headers.get("x-videoforge-worker-version") !== version.versionId ||
    body.schema_version !== "videoforge-hosted-status/v1" ||
    body.commit !== sourceCommit ||
    body.environment !== "production" ||
    body.gpu_transport !== "QUALIFIED_EXACT"
  )
    fail("EFFECTIVE_ROUTE_INVALID");
  const report = {
    schema_version: "videoforge-v2-09-existing-qualified-activation-report/v1",
    state: "COMPLETED",
    source_commit: sourceCommit,
    worker_version: version.versionId,
    worker_version_id_sha256: version.versionIdSha256,
    activation_id_sha256: importResult.activationIdSha256,
    effective_gpu_transport: "QUALIFIED_EXACT",
    runpod_mutation: false,
    compute_started: false,
  };
  writePrivateFile(
    join(privateRoot, "activation-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

async function main(): Promise<void> {
  try {
    process.stdout.write(`${JSON.stringify(await execute(parseArgs(process.argv.slice(2))))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    process.stderr.write(
      `${/^[A-Z0-9_.:-]+$/u.test(message) ? message : "V2_09_EXISTING_ACTIVATION_FAILED"}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
