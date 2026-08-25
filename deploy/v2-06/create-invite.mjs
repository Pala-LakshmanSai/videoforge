#!/usr/bin/env node

/**
 * Issue one email-bound, one-use hosted invite without exposing its verifier in durable output.
 *
 * The default path is a provider-free dry run. The mutation path requires a dedicated NOINHERIT
 * operator role with direct SELECT+INSERT only on public.invite_codes; both the migration owner and
 * hosted runtime are rejected by the capability preflight.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FORBIDDEN_RUNTIME_ROLE = "videoforge_v2_06_runtime";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const UUID_HEX = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/u;
const INSERT_INVITE_SQL = `INSERT INTO public.invite_codes (
           id, verifier_sha256, intended_normalized_email, state, expires_at,
           consumed_at, revoked_at, version, created_at
         ) VALUES ($1::pg_catalog.uuid, $2, $3, 'ACTIVE', $4::pg_catalog.timestamptz,
                   NULL, NULL, 1, $5::pg_catalog.timestamptz)`;

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function normalizeEmail(value) {
  if (typeof value !== "string" || /[\r\n]/u.test(value))
    fail("INVITE_EMAIL_INVALID", "invite email must be one valid single-line address");
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !EMAIL.test(normalized))
    fail("INVITE_EMAIL_INVALID", "invite email must be one valid single-line address");
  return normalized;
}

function requireTimestamp(value, label) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  )
    fail("INVITE_TIMESTAMP_INVALID", `${label} must be an RFC3339 UTC timestamp`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    fail("INVITE_TIMESTAMP_INVALID", `${label} must be an RFC3339 UTC timestamp`);
  return new Date(timestamp).toISOString();
}

function inviteIdFor(idempotencyKey) {
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey))
    fail(
      "INVITE_IDEMPOTENCY_KEY_INVALID",
      "idempotency key must be 16-128 characters from the documented safe alphabet",
    );
  const hex = createHash("sha256")
    .update(`videoforge:v2-06:invite:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}a${hex.slice(17)}`;
  return versioned.replace(UUID_HEX, "$1-$2-$3-$4-$5");
}

function buildPlan({ email, expiresAt, idempotencyKey, now = new Date().toISOString() }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedNow = requireTimestamp(now, "now");
  const normalizedExpiry = requireTimestamp(expiresAt, "expires-at");
  if (Date.parse(normalizedExpiry) <= Date.parse(normalizedNow))
    fail("INVITE_EXPIRED", "invite expiry must be in the future");
  return Object.freeze({
    inviteId: inviteIdFor(idempotencyKey),
    normalizedEmail,
    expiresAt: normalizedExpiry,
    idempotencyKeySha256: sha256(idempotencyKey),
    createdAt: normalizedNow,
  });
}

function advisoryKey(value) {
  const unsigned = BigInt(`0x${createHash("sha256").update(value).digest("hex").slice(0, 16)}`);
  return BigInt.asIntN(64, unsigned).toString();
}

function advisoryLockKeys(plan) {
  return [
    advisoryKey(`videoforge:v2-06:invite-id:${plan.inviteId}`),
    advisoryKey(`videoforge:v2-06:invite-email:${plan.normalizedEmail}`),
  ].sort((left, right) =>
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
  );
}

function generateVerifier(random = randomBytes) {
  const entropy = random(32);
  if (!Buffer.isBuffer(entropy) || entropy.byteLength !== 32)
    fail("INVITE_RANDOM_SOURCE_INVALID", "invite random source must return exactly 32 bytes");
  return `vfi_${entropy.toString("base64url")}`;
}

function verifyInvite({ row, email, verifier, now = new Date().toISOString() }) {
  if (!row || row.state !== "ACTIVE") fail("INVITE_UNAVAILABLE", "invite is not active");
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail !== row.intended_normalized_email)
    fail("INVITE_EMAIL_MISMATCH", "invite does not belong to this email");
  if (
    Date.parse(requireTimestamp(row.expires_at, "stored expiry")) <=
    Date.parse(requireTimestamp(now, "now"))
  )
    fail("INVITE_EXPIRED", "invite has expired");
  const expected = Buffer.from(row.verifier_sha256, "utf8");
  const actual = Buffer.from(sha256(verifier), "utf8");
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual))
    fail("INVITE_VERIFIER_MISMATCH", "invite verifier is invalid");
  return true;
}

function auditReceipt(plan, outcome, verifierSha256 = null) {
  return Object.freeze({
    schema_version: "videoforge-invite-issuance-receipt/v1",
    outcome,
    invite_id: plan.inviteId,
    intended_email_sha256: sha256(plan.normalizedEmail),
    expires_at: plan.expiresAt,
    idempotency_key_sha256: plan.idempotencyKeySha256,
    verifier_sha256: verifierSha256,
    plaintext_verifier_retained: false,
  });
}

async function issueInvite({
  database,
  plan,
  random = randomBytes,
  allowPlaintextDelivery = false,
}) {
  return database.transaction(async (executor) => {
    await executor.query("SET LOCAL search_path = pg_catalog, public", []);
    const capability = await executor.query(
      `SELECT current_user AS current_role,
              session_user AS session_role,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'SELECT') AS can_select,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'INSERT') AS can_insert,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'UPDATE') AS can_update,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'DELETE') AS can_delete,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'TRUNCATE') AS can_truncate,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'REFERENCES') AS can_references,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'TRIGGER') AS can_trigger,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'SELECT WITH GRANT OPTION') AS can_grant_select,
              pg_catalog.has_table_privilege(current_user, 'public.invite_codes', 'INSERT WITH GRANT OPTION') AS can_grant_insert,
              pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS schema_can_usage,
              pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS schema_can_create,
              pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION') AS schema_can_grant_usage,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'SELECT') AS public_can_select,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'INSERT') AS public_can_insert,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'UPDATE') AS public_can_update,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'DELETE') AS public_can_delete,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'TRUNCATE') AS public_can_truncate,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'REFERENCES') AS public_can_references,
              pg_catalog.has_table_privilege(0::pg_catalog.oid, 'public.invite_codes', 'TRIGGER') AS public_can_trigger,
              pg_catalog.has_schema_privilege(0::pg_catalog.oid, 'public', 'CREATE') AS public_schema_can_create,
              current_user = '${FORBIDDEN_RUNTIME_ROLE}' AS is_forbidden_runtime,
              current_user = (
                SELECT tableowner FROM pg_catalog.pg_tables
                 WHERE schemaname = 'public' AND tablename = 'invite_codes'
              ) AS is_table_owner,
              CASE WHEN pg_catalog.to_regrole('${FORBIDDEN_RUNTIME_ROLE}') IS NULL THEN false
                   ELSE pg_catalog.pg_has_role(
                          current_user,
                          pg_catalog.to_regrole('${FORBIDDEN_RUNTIME_ROLE}'),
                          'MEMBER'
                        )
                     OR pg_catalog.pg_has_role(
                          pg_catalog.to_regrole('${FORBIDDEN_RUNTIME_ROLE}'),
                          current_user,
                          'MEMBER'
                        )
               END AS runtime_membership,
              EXISTS (
                SELECT 1 FROM pg_catalog.pg_auth_members membership
                 WHERE membership.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
                    OR membership.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
              ) AS any_role_membership,
              role.rolsuper, role.rolcreaterole, role.rolcreatedb, role.rolcanlogin, role.rolinherit,
              role.rolreplication, role.rolbypassrls,
              pg_catalog.statement_timestamp() AS database_now
         FROM pg_catalog.pg_roles role
        WHERE role.rolname = current_user`,
      [],
    );
    const role = capability.rows[0];
    const publicPrivilegesAbsent =
      role &&
      role.public_can_select === false &&
      role.public_can_insert === false &&
      role.public_can_update === false &&
      role.public_can_delete === false &&
      role.public_can_truncate === false &&
      role.public_can_references === false &&
      role.public_can_trigger === false &&
      role.public_schema_can_create === false;
    const dedicatedOperatorContract =
      role &&
      role.is_table_owner === false &&
      role.can_select === true &&
      role.can_insert === true &&
      role.can_update === false &&
      role.can_delete === false &&
      role.can_truncate === false &&
      role.can_references === false &&
      role.can_trigger === false &&
      role.can_grant_select === false &&
      role.can_grant_insert === false &&
      role.schema_can_usage === true &&
      role.schema_can_create === false &&
      role.schema_can_grant_usage === false &&
      role.rolsuper === false &&
      role.rolcreaterole === false &&
      role.rolcreatedb === false &&
      role.rolcanlogin === true &&
      role.rolinherit === false &&
      role.rolreplication === false &&
      role.rolbypassrls === false &&
      role.any_role_membership === false;
    if (
      !role ||
      role.current_role !== role.session_role ||
      role.current_role !== database.expectedOperatorRole ||
      role.is_forbidden_runtime === true ||
      role.runtime_membership !== false ||
      !publicPrivilegesAbsent ||
      !dedicatedOperatorContract
    ) {
      fail(
        "INVITE_OPERATOR_ROLE_REQUIRED",
        "connected role is not the exact insert-capable invite operator",
      );
    }
    if (
      Date.parse(plan.expiresAt) <=
      Date.parse(requireTimestamp(role.database_now, "database clock"))
    )
      fail("INVITE_EXPIRED", "invite expiry is not in the future at the operator database");

    for (const lockKey of advisoryLockKeys(plan)) {
      await executor.query(
        "SELECT pg_catalog.pg_advisory_xact_lock($1::pg_catalog.int8) AS acquired",
        [lockKey],
      );
    }

    const existing = await executor.query(
      `SELECT id::pg_catalog.text, verifier_sha256, intended_normalized_email,
              state, expires_at, created_at
         FROM public.invite_codes
        WHERE id = $1::pg_catalog.uuid OR intended_normalized_email = $2
        ORDER BY id`,
      [plan.inviteId, plan.normalizedEmail],
    );
    const idMatch = existing.rows.find((row) => row.id === plan.inviteId);
    const emailConflict = existing.rows.find(
      (row) => row.intended_normalized_email === plan.normalizedEmail && row.id !== plan.inviteId,
    );
    if (emailConflict)
      fail("INVITE_EMAIL_DUPLICATE", "email already has a different retained invite record");
    if (idMatch) {
      if (idMatch.intended_normalized_email !== plan.normalizedEmail)
        fail("INVITE_EMAIL_MISMATCH", "idempotency key is already bound to another email");
      if (requireTimestamp(idMatch.expires_at, "stored expiry") !== plan.expiresAt)
        fail("INVITE_REPLAY_MISMATCH", "idempotency replay changed the explicit expiry");
      if (idMatch.state !== "ACTIVE")
        fail("INVITE_ALREADY_USED", "idempotent invite is no longer active");
      if (Date.parse(idMatch.expires_at) <= Date.parse(plan.createdAt))
        fail("INVITE_EXPIRED", "idempotent invite has expired");
      return Object.freeze({
        receipt: auditReceipt(plan, "IDEMPOTENT_REPLAY", idMatch.verifier_sha256),
        verifier: null,
      });
    }

    if (!allowPlaintextDelivery)
      fail(
        "INVITE_DELIVERY_REQUIRED",
        "new invite issuance requires explicit one-time verifier delivery",
      );
    const verifier = generateVerifier(random);
    const verifierSha256 = sha256(verifier);
    try {
      await executor.query(INSERT_INVITE_SQL, [
        plan.inviteId,
        verifierSha256,
        plan.normalizedEmail,
        plan.expiresAt,
        plan.createdAt,
      ]);
    } catch (error) {
      if (error?.code === "23505")
        fail("INVITE_DUPLICATE", "invite conflicts with a retained idempotency or email record");
      throw error;
    }
    return Object.freeze({
      receipt: auditReceipt(plan, "ISSUED", verifierSha256),
      verifier,
    });
  });
}

function parseArgs(argv) {
  const options = { execute: false, printVerifier: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") options.execute = true;
    else if (argument === "--print-verifier") options.printVerifier = true;
    else if (argument === "--help") options.help = true;
    else if (["--email", "--expires-at", "--idempotency-key"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        fail("INVITE_ARGUMENT_MISSING", `${argument} requires a value`);
      options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else fail("INVITE_ARGUMENT_UNKNOWN", `unknown argument: ${argument}`);
  }
  if (options.printVerifier && !options.execute)
    fail("INVITE_PRINT_REQUIRES_EXECUTE", "--print-verifier is only valid with --execute");
  return options;
}

function printHelp() {
  console.log(`V2-06 production invite issuer (default: dry run)

Required:
  --email <address>             invited Google identity; normalized and bound exactly
  --expires-at <RFC3339 UTC>    explicit future expiry
  --idempotency-key <key>       16-128 safe characters; reuse only for exact replay

Mutation (optional):
  --execute                     issue through the operator database seam
  --print-verifier              required for new issuance; print once; never on replay

Live environment:
  V2_06_INVITE_CONFIRM=YES
  V2_06_INVITE_DATABASE_URL     dedicated invite-operator URL; never argv
  V2_06_INVITE_OPERATOR_ROLE    exact expected connected role

Without --execute, no database module is loaded and no connection is opened.`);
}

async function postgresDatabase(databaseUrl, expectedOperatorRole) {
  const require = createRequire(resolve(ROOT, "packages/control-plane/package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return {
    expectedOperatorRole,
    async transaction(operation) {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const result = await operation({ query: (text, values) => client.query(text, values) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    close: () => client.end(),
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const plan = buildPlan({
    email: options.email,
    expiresAt: options.expiresAt,
    idempotencyKey: options.idempotencyKey,
  });
  if (!options.execute) {
    console.error(JSON.stringify(auditReceipt(plan, "DRY_RUN")));
    return;
  }
  if (process.env.V2_06_INVITE_CONFIRM !== "YES")
    fail("INVITE_CONFIRMATION_REQUIRED", "refusing mutation without V2_06_INVITE_CONFIRM=YES");
  const databaseUrl = process.env.V2_06_INVITE_DATABASE_URL;
  const operatorRole = process.env.V2_06_INVITE_OPERATOR_ROLE;
  if (!databaseUrl || !operatorRole)
    fail(
      "INVITE_DATABASE_CONFIG_REQUIRED",
      "invite database URL and exact operator role are required",
    );
  const database = await postgresDatabase(databaseUrl, operatorRole);
  try {
    const result = await issueInvite({
      database,
      plan,
      allowPlaintextDelivery: options.printVerifier,
    });
    console.error(JSON.stringify(result.receipt));
    if (options.printVerifier && result.verifier !== null)
      process.stdout.write(`${result.verifier}\n`);
  } finally {
    await database.close();
  }
}

export {
  FORBIDDEN_RUNTIME_ROLE,
  INSERT_INVITE_SQL,
  advisoryLockKeys,
  auditReceipt,
  buildPlan,
  generateVerifier,
  inviteIdFor,
  issueInvite,
  normalizeEmail,
  parseArgs,
  sha256,
  verifyInvite,
};

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`V2-06 invite issuance failed: ${error?.code ?? "INVITE_UNKNOWN"}`);
    process.exitCode = 1;
  });
}
