import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  FORBIDDEN_RUNTIME_ROLE,
  INSERT_INVITE_SQL,
  advisoryLockKeys,
  buildPlan,
  generateVerifier,
  issueInvite,
  sha256,
  verifyInvite,
} from "../../deploy/v2-06/create-invite.mjs";
import { withMigratedDatabase } from "../../packages/control-plane/tests/support/pglite.mjs";

const NOW = "2026-08-25T12:00:00.000Z";
const EXPIRY = "2026-08-26T12:00:00.000Z";
const KEY = "invite-release-alpha-0001";

function safeCapability(role = "invite_operator", overrides = {}) {
  return {
    current_role: role,
    session_role: role,
    can_insert: true,
    can_select: true,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_references: false,
    can_trigger: false,
    can_grant_select: false,
    can_grant_insert: false,
    schema_can_usage: true,
    schema_can_create: false,
    schema_can_grant_usage: false,
    public_can_select: false,
    public_can_insert: false,
    public_can_update: false,
    public_can_delete: false,
    public_can_truncate: false,
    public_can_references: false,
    public_can_trigger: false,
    public_schema_can_create: false,
    is_forbidden_runtime: role === FORBIDDEN_RUNTIME_ROLE,
    is_table_owner: false,
    runtime_membership: false,
    any_role_membership: false,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolinherit: false,
    rolreplication: false,
    rolbypassrls: false,
    database_now: NOW,
    ...overrides,
  };
}

function fakeDatabase({
  role = "invite_operator",
  rows = [],
  insertError = null,
  capability = {},
  expectedOperatorRole = "invite_operator",
} = {}) {
  const queries = [];
  return {
    expectedOperatorRole,
    queries,
    async transaction(operation) {
      return operation({
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("SET LOCAL search_path")) return { rows: [] };
          if (text.includes("has_table_privilege")) {
            return {
              rows: [safeCapability(role, capability)],
            };
          }
          if (text.includes("pg_advisory_xact_lock")) return { rows: [{ acquired: null }] };
          if (text.includes("FROM public.invite_codes")) return { rows };
          if (text.includes("INSERT INTO public.invite_codes")) {
            if (insertError) throw insertError;
            return { rows: [] };
          }
          throw new Error("unexpected fake query");
        },
      });
    },
  };
}

function serialDatabase() {
  const rows = [];
  let tail = Promise.resolve();
  return {
    expectedOperatorRole: "invite_operator",
    rows,
    async transaction(operation) {
      const prior = tail;
      let release;
      tail = new Promise((resolvePromise) => {
        release = resolvePromise;
      });
      await prior;
      try {
        return await operation({
          async query(text, values) {
            if (text.includes("SET LOCAL search_path")) return { rows: [] };
            if (text.includes("has_table_privilege")) return { rows: [safeCapability()] };
            if (text.includes("pg_advisory_xact_lock")) return { rows: [{ acquired: null }] };
            if (text.includes("FROM public.invite_codes")) {
              return {
                rows: rows.filter(
                  (row) => row.id === values[0] || row.intended_normalized_email === values[1],
                ),
              };
            }
            if (text.includes("INSERT INTO public.invite_codes")) {
              rows.push({
                id: values[0],
                verifier_sha256: values[1],
                intended_normalized_email: values[2],
                state: "ACTIVE",
                expires_at: values[3],
                created_at: values[4],
              });
              return { rows: [] };
            }
            throw new Error("unexpected serial database query");
          },
        });
      } finally {
        release();
      }
    },
  };
}

test("plan normalizes email and rejects expired issuance", () => {
  const plan = buildPlan({
    email: "  Person@Example.COM ",
    expiresAt: EXPIRY,
    idempotencyKey: KEY,
    now: NOW,
  });
  assert.equal(plan.normalizedEmail, "person@example.com");
  assert.equal(
    plan.inviteId,
    buildPlan({ email: "person@example.com", expiresAt: EXPIRY, idempotencyKey: KEY, now: NOW })
      .inviteId,
  );
  assert.throws(
    () => buildPlan({ email: "person@example.com", expiresAt: NOW, idempotencyKey: KEY, now: NOW }),
    { code: "INVITE_EXPIRED" },
  );
});

test("new issuance stores only the verifier hash and returns a redacted receipt", async () => {
  const database = fakeDatabase();
  const plan = buildPlan({
    email: "person@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: KEY,
    now: NOW,
  });
  const result = await issueInvite({
    database,
    plan,
    random: () => Buffer.alloc(32, 7),
    allowPlaintextDelivery: true,
  });
  assert.match(result.verifier, /^vfi_[A-Za-z0-9_-]{43}$/u);
  assert.equal(result.receipt.outcome, "ISSUED");
  assert.equal(result.receipt.verifier_sha256, sha256(result.verifier));
  assert.equal(JSON.stringify(result.receipt).includes(result.verifier), false);
  assert.equal(JSON.stringify(result.receipt).includes(plan.normalizedEmail), false);
  const insert = database.queries.find(({ text }) =>
    text.includes("INSERT INTO public.invite_codes"),
  );
  assert.equal(insert.values.includes(result.verifier), false);
  assert.equal(insert.values[1], sha256(result.verifier));
  assert.match(insert.text, /INSERT INTO public\.invite_codes/u);
  assert.doesNotMatch(insert.text, /scope_kind/u);
  assert.match(database.queries[0].text, /^SET LOCAL search_path = pg_catalog, public$/u);
  assert.match(
    database.queries.find(({ text }) => text.includes("FROM public.invite_codes")).text,
    /FROM public\.invite_codes/u,
  );
  const capability = database.queries.find(({ text }) => text.includes("has_table_privilege"));
  assert.match(capability.text, /pg_catalog\.has_table_privilege/u);
  assert.match(capability.text, /pg_catalog\.has_schema_privilege/u);
  assert.match(capability.text, /pg_catalog\.statement_timestamp/u);
  assert.doesNotMatch(capability.text, /(?<!pg_catalog\.)\bhas_(?:table|schema)_privilege\b/u);
  assert.doesNotMatch(
    database.queries.find(({ text }) => text.includes("FROM public.invite_codes")).text,
    /FOR UPDATE/u,
  );
  const locks = database.queries.filter(({ text }) => text.includes("pg_advisory_xact_lock"));
  assert.equal(locks.length, 2);
  assert.deepEqual(
    locks.map(({ values }) => values[0]),
    advisoryLockKeys(plan),
  );
});

test("exact insert SQL executes against the committed migrated schema", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const plan = buildPlan({
      email: "schema@example.test",
      expiresAt: EXPIRY,
      idempotencyKey: "invite-schema-backed-0001",
      now: NOW,
    });
    await executor.query(INSERT_INVITE_SQL, [
      plan.inviteId,
      `sha256:${"c".repeat(64)}`,
      plan.normalizedEmail,
      plan.expiresAt,
      plan.createdAt,
    ]);
    const stored = await executor.query(
      `SELECT intended_normalized_email, state, scope_kind
         FROM public.invite_codes WHERE id = $1::uuid`,
      [plan.inviteId],
    );
    assert.deepEqual(stored.rows, [
      {
        intended_normalized_email: "schema@example.test",
        state: "ACTIVE",
        scope_kind: "SYSTEM",
      },
    ]);
  });
});

test("exact idempotency replay returns the retained receipt without plaintext", async () => {
  const plan = buildPlan({
    email: "person@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: KEY,
    now: NOW,
  });
  const database = fakeDatabase({
    rows: [
      {
        id: plan.inviteId,
        verifier_sha256: `sha256:${"a".repeat(64)}`,
        intended_normalized_email: plan.normalizedEmail,
        state: "ACTIVE",
        expires_at: EXPIRY,
        created_at: NOW,
      },
    ],
  });
  const result = await issueInvite({ database, plan });
  assert.equal(result.receipt.outcome, "IDEMPOTENT_REPLAY");
  assert.equal(result.verifier, null);
  assert.equal(
    database.queries.some(({ text }) => text.includes("INSERT INTO public.invite_codes")),
    false,
  );
});

test("duplicate email, mismatched replay, consumed replay, and runtime role fail closed", async () => {
  const plan = buildPlan({
    email: "person@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: KEY,
    now: NOW,
  });
  const row = {
    id: "11111111-1111-5111-a111-111111111111",
    verifier_sha256: `sha256:${"b".repeat(64)}`,
    intended_normalized_email: plan.normalizedEmail,
    state: "ACTIVE",
    expires_at: EXPIRY,
    created_at: NOW,
  };
  await assert.rejects(issueInvite({ database: fakeDatabase({ rows: [row] }), plan }), {
    code: "INVITE_EMAIL_DUPLICATE",
  });
  await assert.rejects(
    issueInvite({
      database: fakeDatabase({
        rows: [{ ...row, id: plan.inviteId, intended_normalized_email: "other@example.com" }],
      }),
      plan,
    }),
    { code: "INVITE_EMAIL_MISMATCH" },
  );
  await assert.rejects(
    issueInvite({
      database: fakeDatabase({ rows: [{ ...row, id: plan.inviteId, state: "CONSUMED" }] }),
      plan,
    }),
    { code: "INVITE_ALREADY_USED" },
  );
  const runtime = fakeDatabase({
    role: FORBIDDEN_RUNTIME_ROLE,
    expectedOperatorRole: FORBIDDEN_RUNTIME_ROLE,
    capability: {
      is_table_owner: true,
      can_update: true,
      can_delete: true,
      can_truncate: true,
      can_references: true,
      can_trigger: true,
    },
  });
  await assert.rejects(issueInvite({ database: runtime, plan }), {
    code: "INVITE_OPERATOR_ROLE_REQUIRED",
  });
  assert.equal(runtime.queries.length, 2);
});

test("table owner is rejected even when configured as the expected operator", async () => {
  const plan = buildPlan({
    email: "owner@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: "invite-migration-owner-0001",
    now: NOW,
  });
  const database = fakeDatabase({
    role: "neondb_owner",
    expectedOperatorRole: "neondb_owner",
    capability: {
      is_table_owner: true,
      can_update: true,
      can_delete: true,
      can_truncate: true,
      can_references: true,
      can_trigger: true,
      can_grant_select: true,
      can_grant_insert: true,
      schema_can_create: true,
      schema_can_grant_usage: true,
    },
  });
  await assert.rejects(
    issueInvite({
      database,
      plan,
      random: () => Buffer.alloc(32, 3),
      allowPlaintextDelivery: true,
    }),
    { code: "INVITE_OPERATOR_ROLE_REQUIRED" },
  );
});

test("concurrent same-key replay and same-email conflict are serialized", async () => {
  const sameKeyDatabase = serialDatabase();
  const samePlan = buildPlan({
    email: "concurrent@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: "invite-concurrent-same-0001",
    now: NOW,
  });
  const sameResults = await Promise.all([
    issueInvite({ database: sameKeyDatabase, plan: samePlan, allowPlaintextDelivery: true }),
    issueInvite({ database: sameKeyDatabase, plan: samePlan, allowPlaintextDelivery: true }),
  ]);
  assert.deepEqual(sameResults.map(({ receipt }) => receipt.outcome).sort(), [
    "IDEMPOTENT_REPLAY",
    "ISSUED",
  ]);
  assert.equal(sameResults.filter(({ verifier }) => verifier !== null).length, 1);
  assert.equal(sameKeyDatabase.rows.length, 1);

  const sameEmailDatabase = serialDatabase();
  const first = buildPlan({
    email: "duplicate@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: "invite-concurrent-email-a",
    now: NOW,
  });
  const second = buildPlan({
    email: "duplicate@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: "invite-concurrent-email-b",
    now: NOW,
  });
  const settled = await Promise.allSettled([
    issueInvite({ database: sameEmailDatabase, plan: first, allowPlaintextDelivery: true }),
    issueInvite({ database: sameEmailDatabase, plan: second, allowPlaintextDelivery: true }),
  ]);
  assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 1);
  const rejection = settled.find(({ status }) => status === "rejected");
  assert.equal(rejection.reason.code, "INVITE_EMAIL_DUPLICATE");
  assert.equal(sameEmailDatabase.rows.length, 1);
});

test("role identity rejects privilege drift, PUBLIC grants, and runtime membership", async () => {
  const plan = buildPlan({
    email: "person@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: KEY,
    now: NOW,
  });
  for (const database of [
    fakeDatabase({ capability: { public_can_insert: true } }),
    fakeDatabase({ capability: { runtime_membership: true } }),
    fakeDatabase({ capability: { any_role_membership: true } }),
    fakeDatabase({ capability: { can_update: true } }),
    fakeDatabase({ capability: { can_truncate: true } }),
    fakeDatabase({ capability: { can_references: true } }),
    fakeDatabase({ capability: { can_trigger: true } }),
    fakeDatabase({ capability: { can_grant_select: true } }),
    fakeDatabase({ capability: { can_grant_insert: true } }),
    fakeDatabase({ capability: { schema_can_usage: false } }),
    fakeDatabase({ capability: { schema_can_create: true } }),
    fakeDatabase({ capability: { schema_can_grant_usage: true } }),
    fakeDatabase({ capability: { public_schema_can_create: true } }),
    fakeDatabase({ capability: { rolcanlogin: false } }),
    fakeDatabase({ capability: { rolinherit: true } }),
    fakeDatabase({ capability: { rolsuper: true } }),
  ]) {
    await assert.rejects(issueInvite({ database, plan }), {
      code: "INVITE_OPERATOR_ROLE_REQUIRED",
    });
    assert.equal(database.queries.length, 2);
  }
});

test("new execute-style issuance requires explicit one-time verifier delivery", async () => {
  const plan = buildPlan({
    email: "delivery@example.com",
    expiresAt: EXPIRY,
    idempotencyKey: "invite-delivery-required-0001",
    now: NOW,
  });
  let randomCalled = false;
  const database = fakeDatabase();
  await assert.rejects(
    issueInvite({
      database,
      plan,
      random: () => {
        randomCalled = true;
        return Buffer.alloc(32, 1);
      },
    }),
    { code: "INVITE_DELIVERY_REQUIRED" },
  );
  assert.equal(randomCalled, false);
  assert.equal(
    database.queries.some(({ text }) => text.includes("INSERT INTO public.invite_codes")),
    false,
  );
});

test("verifier validation rejects mismatched email, verifier, and expired rows", () => {
  const verifier = generateVerifier(() => Buffer.alloc(32, 9));
  const row = {
    verifier_sha256: sha256(verifier),
    intended_normalized_email: "person@example.com",
    state: "ACTIVE",
    expires_at: EXPIRY,
  };
  assert.equal(verifyInvite({ row, email: "Person@Example.com", verifier, now: NOW }), true);
  assert.throws(() => verifyInvite({ row, email: "other@example.com", verifier, now: NOW }), {
    code: "INVITE_EMAIL_MISMATCH",
  });
  assert.throws(
    () => verifyInvite({ row, email: "person@example.com", verifier: "wrong", now: NOW }),
    { code: "INVITE_VERIFIER_MISMATCH" },
  );
  assert.throws(() => verifyInvite({ row, email: "person@example.com", verifier, now: EXPIRY }), {
    code: "INVITE_EXPIRED",
  });
});

test("CLI is dry-run by default and never prints email or verifier", () => {
  const cliExpiry = new Date(Date.now() + 86_400_000).toISOString();
  const result = spawnSync(
    process.execPath,
    [
      "deploy/v2-06/create-invite.mjs",
      "--email",
      "Person@Example.com",
      "--expires-at",
      cliExpiry,
      "--idempotency-key",
      KEY,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: {} },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.outcome, "DRY_RUN");
  assert.equal(result.stderr.includes("person@example.com"), false);
  assert.equal(receipt.verifier_sha256, null);
});

test("CLI requires explicit mutation confirmation before loading database credentials", () => {
  const cliExpiry = new Date(Date.now() + 86_400_000).toISOString();
  const result = spawnSync(
    process.execPath,
    [
      "deploy/v2-06/create-invite.mjs",
      "--execute",
      "--print-verifier",
      "--email",
      "person@example.com",
      "--expires-at",
      cliExpiry,
      "--idempotency-key",
      KEY,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: {} },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /INVITE_CONFIRMATION_REQUIRED/u);
  assert.doesNotMatch(result.stderr, /person@example\.com|vfi_/u);
});
