import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const ROLE = /^[a-z][a-z0-9_]{2,62}$/u;
const SERVICE_NAME = /^[A-Za-z0-9_.-]{1,63}$/u;
const ENDPOINT_SECRET_NAMES = Object.freeze([
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
]);
const REUSED_SECRET_NAMES = Object.freeze([
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "RUNPOD_API_KEY",
]);
const GENERATED_SECRET_NAMES = Object.freeze([
  "BETTER_AUTH_SECRET",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
  "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
  "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
]);
export const V209_CLOUDFLARE_SECRET_NAMES = Object.freeze([
  "DATABASE_URL",
  ...REUSED_SECRET_NAMES,
  ...GENERATED_SECRET_NAMES,
  "VIDEOFORGE_RECONCILER_DATABASE_URL",
  "RUNPOD_API_BASE_URL",
  ...ENDPOINT_SECRET_NAMES,
]);

function fail(code) {
  throw new Error(`V2_09_PROTECTED_MATERIALIZATION_${code}`);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function privateDirectory(path) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("PATH_INVALID");
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_DIRECTORY_INVALID");
}

function readPrivate(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  privateDirectory(dirname(path));
  let fd;
  let before;
  let after;
  let bytes;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    before = fstatSync(fd);
    bytes = Buffer.from(readFileSync(fd));
    after = fstatSync(fd);
  } catch {
    fail(code);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (
    !before.isFile() ||
    before.nlink !== 1 ||
    (before.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && before.uid !== process.getuid()) ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.uid !== after.uid ||
    before.nlink !== after.nlink ||
    before.size !== after.size ||
    before.size !== bytes.length ||
    bytes.length === 0 ||
    bytes.includes(0)
  )
    fail(code);
  return bytes;
}

function writePrivateOnce(path, bytes, code) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.includes(0)) fail(code);
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  privateDirectory(dirname(path));
  if (existsSync(path)) {
    const observed = readPrivate(path, code);
    if (!observed.equals(bytes)) fail(`${code}_DRIFT`);
    return;
  }
  const temporary = `${path}.next`;
  if (existsSync(temporary)) fail(`${code}_PARTIAL`);
  let fd;
  try {
    fd = openSync(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    const parentFd = openSync(dirname(path), fsConstants.O_RDONLY);
    try {
      fsyncSync(parentFd);
    } finally {
      closeSync(parentFd);
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  readPrivate(path, code);
}

function parseIni(bytes, sectionName, code) {
  const sections = new Map();
  let section = "";
  for (const raw of bytes.toString("utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[([^\]]+)\]$/u.exec(line);
    if (header) {
      section = header[1];
      if (sections.has(section)) fail(code);
      sections.set(section, {});
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/u.exec(line);
    if (!match || !sections.has(section) || Object.hasOwn(sections.get(section), match[1]))
      fail(code);
    sections.get(section)[match[1]] = match[2].trim();
  }
  const selected = sections.get(sectionName);
  if (!selected) fail(code);
  return selected;
}

function parsePgPass(bytes, identity) {
  const matches = [];
  for (const raw of bytes.toString("utf8").split(/\r?\n/u)) {
    if (!raw || raw.startsWith("#")) continue;
    const fields = raw.split(":");
    if (fields.length !== 5) fail("PGPASS_INVALID");
    const [host, port, database, user, password] = fields;
    if (
      [host, port, database, user].every(
        (value, index) =>
          value === "*" ||
          value === [identity.host, identity.port, identity.database, identity.user][index],
      )
    )
      matches.push(password);
  }
  if (matches.length !== 1 || !matches[0] || matches[0].includes("\\")) fail("PGPASS_INVALID");
  return matches[0];
}

export function deriveOwnerDatabaseUrl(spec) {
  if (spec?.mode === "EXACT_URL_FILE") {
    const bytes = readPrivate(spec.urlFile, "OWNER_URL_INVALID");
    const text = bytes.toString("utf8");
    if (text.trim() !== text) fail("OWNER_URL_INVALID");
    const parsed = new URL(text);
    if (
      !new Set(["postgres:", "postgresql:"]).has(parsed.protocol) ||
      !parsed.username ||
      !parsed.password
    )
      fail("OWNER_URL_INVALID");
    return text;
  }
  if (spec?.mode !== "PG_SERVICE_PGPASS" || !SERVICE_NAME.test(spec.serviceName ?? ""))
    fail("OWNER_SOURCE_INVALID");
  const service = parseIni(
    readPrivate(spec.serviceFile, "PG_SERVICE_INVALID"),
    spec.serviceName,
    "PG_SERVICE_INVALID",
  );
  const allowed = new Set(["host", "port", "dbname", "user", "sslmode"]);
  if (Object.keys(service).some((key) => !allowed.has(key))) fail("PG_SERVICE_INVALID");
  const identity = {
    host: service.host,
    port: service.port || "5432",
    database: service.dbname,
    user: service.user,
  };
  if (Object.values(identity).some((value) => !value || /[\0\r\n]/u.test(value)))
    fail("PG_SERVICE_INVALID");
  const password = parsePgPass(readPrivate(spec.passFile, "PGPASS_INVALID"), identity);
  const url = new URL("postgresql://placeholder/");
  url.hostname = identity.host;
  url.port = identity.port;
  url.pathname = `/${identity.database}`;
  url.username = identity.user;
  url.password = password;
  url.searchParams.set("sslmode", service.sslmode || "require");
  return url.toString();
}

function roleUrl(ownerUrl, role, password) {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

function postgresEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return {
    ...(typeof process.env.PATH === "string" ? { PATH: process.env.PATH } : {}),
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.slice(1),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
  };
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function roleSql(roles) {
  return `BEGIN;\n${roles
    .map(
      ({ role, password }) =>
        `DO $vf$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(role)}) THEN RAISE EXCEPTION 'v2-09 role already exists'; END IF; EXECUTE 'CREATE ROLE ' || quote_ident(${sqlLiteral(role)}) || ' LOGIN PASSWORD ' || quote_literal(${sqlLiteral(password)}); END $vf$;`,
    )
    .join("\n")}\nCOMMIT;\n`;
}

function keyId(authorityId, purpose) {
  return `v209-${purpose}-${sha256(Buffer.from(`${authorityId}\0${purpose}`)).slice(7, 31)}`;
}

export async function materializeV209ProtectedInputs({
  authorityId,
  configuration,
  materialization,
  derivedOwnerUrl,
  runPsql,
  randomBytesImpl = randomBytes,
}) {
  if (!/^v2-09-[a-z0-9][a-z0-9._-]{7,95}$/u.test(authorityId ?? "")) fail("AUTHORITY_INVALID");
  if (typeof runPsql !== "function") fail("PSQL_PORT_INVALID");
  const roleNames = [
    configuration.operatorRole,
    configuration.runtimeRole,
    configuration.reconcilerRole,
  ];
  const roleSuffix = sha256(authorityId).slice(7, 15);
  const expectedRoles = ["operator", "runtime", "reconciler"].map(
    (purpose) => `videoforge_v209_${purpose}_${roleSuffix}`,
  );
  if (
    roleNames.some((role) => !ROLE.test(role ?? "")) ||
    new Set(roleNames).size !== 3 ||
    canonical(roleNames) !== canonical(expectedRoles)
  )
    fail("ROLE_INVALID");
  const ownerUrl =
    derivedOwnerUrl === undefined
      ? deriveOwnerDatabaseUrl(materialization.databaseOwner)
      : String(derivedOwnerUrl);
  try {
    const parsedOwner = new URL(ownerUrl);
    if (
      !new Set(["postgres:", "postgresql:"]).has(parsedOwner.protocol) ||
      !parsedOwner.username ||
      !parsedOwner.password
    )
      fail("OWNER_URL_INVALID");
  } catch {
    fail("OWNER_URL_INVALID");
  }
  const next = () => {
    const bytes = randomBytesImpl(32);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 32) fail("RANDOM_INVALID");
    return bytes;
  };
  const raw = Array.from({ length: 11 }, next);
  if (new Set(raw.map(sha256)).size !== raw.length) fail("RANDOM_REUSE");
  const passwords = raw.slice(0, 3).map((bytes) => bytes.toString("base64url"));
  const roleRecords = roleNames.map((role, index) => ({ role, password: passwords[index] }));
  const journalPath = materialization.roleJournalPath;
  const claim = {
    schema_version: "videoforge.v2-09-role-materialization-journal/v1",
    authority_id: authorityId,
    status: "STARTED",
    role_name_sha256s: roleNames.map((role) => sha256(role)),
  };
  if (existsSync(journalPath)) fail("ROLE_MUTATION_AMBIGUOUS_NO_REPLAY");
  writePrivateOnce(journalPath, Buffer.from(`${canonical(claim)}\n`), "ROLE_JOURNAL_INVALID");
  const paths = configuration.cloudflare.secretFiles;
  writePrivateOnce(
    configuration.databaseOwnerUrlFile,
    Buffer.from(ownerUrl),
    "OWNER_URL_OUTPUT_INVALID",
  );
  writePrivateOnce(
    configuration.databaseOperatorUrlFile,
    Buffer.from(roleUrl(ownerUrl, configuration.operatorRole, passwords[0])),
    "OPERATOR_URL_OUTPUT_INVALID",
  );
  writePrivateOnce(
    paths.DATABASE_URL,
    Buffer.from(roleUrl(ownerUrl, configuration.runtimeRole, passwords[1])),
    "RUNTIME_URL_OUTPUT_INVALID",
  );
  writePrivateOnce(
    configuration.databaseReconcilerUrlFile,
    Buffer.from(roleUrl(ownerUrl, configuration.reconcilerRole, passwords[2])),
    "RECONCILER_URL_OUTPUT_INVALID",
  );

  for (const name of REUSED_SECRET_NAMES) {
    const value = readPrivate(
      materialization.reusableSecretFiles?.[name],
      `REUSED_${name}_INVALID`,
    );
    writePrivateOnce(paths[name], value, `REUSED_${name}_OUTPUT_INVALID`);
    if (name === "RUNPOD_API_KEY")
      writePrivateOnce(configuration.runpodApiKeyFile, value, "RUNPOD_KEY_OUTPUT_INVALID");
  }
  const generated = {
    BETTER_AUTH_SECRET: raw[3].toString("base64"),
    WORKFLOW_CALLBACK_SECRET: raw[4].toString("base64"),
    MEDIA_WORKER_TOKEN_SECRET: raw[5].toString("base64"),
    VIDEOFORGE_DISPATCH_TOKEN_KEY: raw[6].toString("base64"),
    VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: keyId(authorityId, "dispatch"),
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: raw[7].toString("hex"),
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: keyId(authorityId, "envelope"),
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: raw[8].toString("hex"),
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: keyId(authorityId, "provider-proof"),
    VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: raw[9].toString("base64"),
  };
  for (const name of GENERATED_SECRET_NAMES)
    writePrivateOnce(paths[name], Buffer.from(generated[name]), `GENERATED_${name}_INVALID`);
  writePrivateOnce(
    paths.RUNPOD_API_BASE_URL,
    Buffer.from("https://api.runpod.ai/v2"),
    "RUNPOD_BASE_INVALID",
  );
  const workerEnvironment = {
    envelopeSigningKeyId: generated.VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID,
    envelopeSigningKeyHex: generated.VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX,
    receiptKeyId: generated.VIDEOFORGE_PROVIDER_PROOF_KEY_ID,
    receiptSigningKeyHex: generated.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY,
    mageWorkerTokenHex: raw[10].toString("hex"),
  };
  writePrivateOnce(
    configuration.runpodWorkerEnvironmentFile,
    Buffer.from(`${canonical(workerEnvironment)}\n`),
    "WORKER_ENVIRONMENT_INVALID",
  );
  // Every credential needed to recover or clean the fresh versioned roles is durable before the
  // single transactional role mutation. Existing roles are never rotated or reused.
  await runPsql({ env: postgresEnvironment(ownerUrl), sql: roleSql(roleRecords) });
  const completed = { ...claim, status: "COMPLETED" };
  const nextJournal = `${journalPath}.complete`;
  writePrivateOnce(nextJournal, Buffer.from(`${canonical(completed)}\n`), "ROLE_JOURNAL_INVALID");
  renameSync(nextJournal, journalPath);
  const journalParentFd = openSync(dirname(journalPath), fsConstants.O_RDONLY);
  try {
    fsyncSync(journalParentFd);
  } finally {
    closeSync(journalParentFd);
  }
  const outputPaths = [
    configuration.databaseOwnerUrlFile,
    configuration.databaseOperatorUrlFile,
    configuration.databaseReconcilerUrlFile,
    configuration.runpodWorkerEnvironmentFile,
    configuration.runpodApiKeyFile,
    ...Object.entries(paths)
      .filter(([name]) => !ENDPOINT_SECRET_NAMES.includes(name))
      .map(([, path]) => path),
  ];
  return Object.freeze({
    schema_version: "videoforge.v2-09-protected-input-materialization-result/v1",
    operation_id: "materialize-v209-protected-inputs",
    role_mutation_count: 1,
    role_count: 3,
    generated_secret_count: GENERATED_SECRET_NAMES.length,
    reused_secret_count: REUSED_SECRET_NAMES.length,
    deferred_endpoint_secret_count: ENDPOINT_SECRET_NAMES.length,
    protected_file_sha256s: Object.freeze(
      outputPaths.map((path) => sha256(readPrivate(path, "OUTPUT_INVALID"))),
    ),
  });
}

export function materializeV209EndpointSecrets({ configuration, deployments }) {
  const mage = deployments?.mage;
  const soulx = deployments?.soulx;
  if (
    typeof mage?.endpointId !== "string" ||
    sha256(mage.endpointId) !== mage.endpointIdSha256 ||
    typeof soulx?.endpointId !== "string" ||
    sha256(soulx.endpointId) !== soulx.endpointIdSha256 ||
    !HASH.test(mage.endpointIdSha256 ?? "") ||
    !HASH.test(soulx.endpointIdSha256 ?? "")
  )
    fail("ENDPOINT_BINDING_INVALID");
  const values = {
    VIDEOFORGE_MAGE_ENDPOINT_ID: mage.endpointId,
    VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256: mage.endpointIdSha256,
    VIDEOFORGE_SOULX_ENDPOINT_ID: soulx.endpointId,
    VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: soulx.endpointIdSha256,
  };
  for (const name of ENDPOINT_SECRET_NAMES)
    writePrivateOnce(
      configuration.cloudflare.secretFiles[name],
      Buffer.from(values[name]),
      `ENDPOINT_${name}_INVALID`,
    );
  const sealed = sealV209CloudflareSecretSet(configuration);
  return Object.freeze({
    schema_version: "videoforge.v2-09-endpoint-secret-materialization-result/v1",
    endpoint_secret_count: 4,
    secret_count: sealed.secret_count,
    secret_allowlist_sha256: sealed.secret_allowlist_sha256,
    secret_set_sha256: sealed.secret_set_sha256,
    endpoint_secret_sha256s: Object.freeze(
      Object.fromEntries(ENDPOINT_SECRET_NAMES.map((name) => [name, sha256(values[name])])),
    ),
  });
}

export function sealV209CloudflareSecretSet(configuration) {
  const files = configuration?.cloudflare?.secretFiles;
  if (
    files === null ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    canonical(Object.keys(files).sort()) !== canonical([...V209_CLOUDFLARE_SECRET_NAMES].sort()) ||
    new Set(Object.values(files).map((path) => resolve(path))).size !==
      V209_CLOUDFLARE_SECRET_NAMES.length
  )
    fail("SECRET_SET_INVALID");
  const hashes = Object.fromEntries(
    V209_CLOUDFLARE_SECRET_NAMES.map((name) => [
      name,
      sha256(readPrivate(files[name], `SECRET_${name}_INVALID`)),
    ]),
  );
  return Object.freeze({
    schema_version: "videoforge.v2-09-cloudflare-secret-set/v1",
    secret_count: V209_CLOUDFLARE_SECRET_NAMES.length,
    secret_allowlist_sha256: sha256(canonical([...V209_CLOUDFLARE_SECRET_NAMES].sort())),
    secret_set_sha256: sha256(canonical(hashes)),
  });
}
