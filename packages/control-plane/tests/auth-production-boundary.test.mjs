import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPendingBetterAuthGoogleConfiguration,
  ProductionAuthBindingError,
} from "../dist/src/auth/index.js";

const CLIENT_ID = "fixture-google-client.apps.googleusercontent.test";
const CLIENT_SECRET = "fixture-google-client-secret-never-real";
const AUTH_SECRET = "fixture-better-auth-secret-never-real-0123456789";
const BASE_URL = "https://videoforge.example.test";

const WORKSPACE_DENIED = Object.freeze({
  ok: false,
  problem: Object.freeze({
    code: "WORKSPACE_ACCESS_REQUIRED",
    status: 403,
    title: "Workspace access is required",
    detail: "This account is not authorized for the requested workspace.",
    retryable: false,
  }),
});

const ACTIVE_AUTHORIZATION = Object.freeze({
  ok: true,
  value: Object.freeze({
    allowed: true,
    reason: "INVITED_VERIFIED_GOOGLE_EMAIL",
    workspaceId: "workspace_auth_a",
    normalizedEmail: "active@example.test",
    materialization: Object.freeze({
      mode: "ALREADY_ACTIVE",
      expectedInvitationStatus: "ACCEPTED",
      expectedMembershipStatus: "ACTIVE",
      resultingInvitationStatus: "ACCEPTED",
      resultingMembershipStatus: "ACTIVE",
      transactionRequired: true,
    }),
  }),
});

const admissionHook = async (request) =>
  request.workspaceId === "workspace_auth_a" &&
  request.email === "active@example.test" &&
  request.emailVerified === true
    ? ACTIVE_AUTHORIZATION
    : WORKSPACE_DENIED;

function validInput() {
  return {
    baseURL: BASE_URL,
    bindings: {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      BETTER_AUTH_SECRET: AUTH_SECRET,
    },
    admissionHook,
  };
}

test("pending production Google composition fails closed with exact missing binding names", () => {
  assert.throws(
    () =>
      createPendingBetterAuthGoogleConfiguration({
        baseURL: BASE_URL,
        bindings: {},
        admissionHook,
      }),
    (error) => {
      assert.equal(error instanceof ProductionAuthBindingError, true);
      assert.equal(error.code, "PRODUCTION_AUTH_BINDINGS_MISSING");
      assert.deepEqual(error.bindingNames, [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "BETTER_AUTH_SECRET",
      ]);
      assert.equal(error.message.includes(CLIENT_ID), false);
      assert.equal(error.message.includes(CLIENT_SECRET), false);
      assert.equal(error.message.includes(AUTH_SECRET), false);
      return true;
    },
  );

  assert.throws(
    () =>
      createPendingBetterAuthGoogleConfiguration({
        ...validInput(),
        bindings: {
          GOOGLE_CLIENT_ID: CLIENT_ID,
          GOOGLE_CLIENT_SECRET: " ",
          BETTER_AUTH_SECRET: AUTH_SECRET,
        },
      }),
    (error) => {
      assert.equal(error instanceof ProductionAuthBindingError, true);
      assert.equal(error.code, "PRODUCTION_AUTH_BINDINGS_MISSING");
      assert.deepEqual(error.bindingNames, ["GOOGLE_CLIENT_SECRET"]);
      return true;
    },
  );
});

test("pending production composition rejects weak, exotic, or non-HTTPS configuration", () => {
  for (const input of [
    {
      ...validInput(),
      bindings: { ...validInput().bindings, BETTER_AUTH_SECRET: "too-short" },
    },
    {
      ...validInput(),
      bindings: { ...validInput().bindings, GOOGLE_CLIENT_SECRET: ` ${CLIENT_SECRET}` },
    },
    { ...validInput(), baseURL: "http://videoforge.example.test" },
    { ...validInput(), baseURL: "https://user:pass@videoforge.example.test" },
    { ...validInput(), baseURL: "https://videoforge.example.test/api/auth" },
    { ...validInput(), baseURL: "https://videoforge.example.test?mode=unsafe" },
    { ...validInput(), bindings: { ...validInput().bindings, unexpected: "value" } },
  ]) {
    assert.throws(
      () => createPendingBetterAuthGoogleConfiguration(input),
      (error) =>
        error instanceof ProductionAuthBindingError &&
        error.code === "PRODUCTION_AUTH_BINDING_INVALID",
    );
  }

  let getterCalls = 0;
  const accessorInput = {
    ...validInput(),
    get bindings() {
      getterCalls += 1;
      return validInput().bindings;
    },
  };
  assert.throws(
    () => createPendingBetterAuthGoogleConfiguration(accessorInput),
    (error) =>
      error instanceof ProductionAuthBindingError &&
      error.code === "PRODUCTION_AUTH_COMPOSITION_INVALID",
  );
  assert.equal(getterCalls, 0, "configuration validation must not evaluate accessors");
});

test("SDK wiring stays truthfully pending and cannot be composed without invitation admission", () => {
  assert.throws(
    () =>
      createPendingBetterAuthGoogleConfiguration({
        baseURL: BASE_URL,
        bindings: validInput().bindings,
      }),
    (error) =>
      error instanceof ProductionAuthBindingError &&
      error.code === "PRODUCTION_AUTH_ADMISSION_REQUIRED",
  );

  const configuration = createPendingBetterAuthGoogleConfiguration(validInput());
  assert.deepEqual(configuration, {
    implementation: "better-auth-sdk-wiring-pending-staging",
    sdkWiringStatus: "PENDING_STAGING",
    provider: "google",
    baseURL: BASE_URL,
    publicSignup: false,
    invitationRequired: true,
    admissionHook: "REQUIRED_BEFORE_IDENTITY_MATERIALIZATION",
    signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL",
    reviewerIdentitySource: "SERVER_SESSION",
    installSdk: configuration.installSdk,
    toJSON: configuration.toJSON,
  });
  assert.equal(Object.isFrozen(configuration), true);

  const serialized = JSON.stringify(configuration);
  assert.deepEqual(JSON.parse(serialized), {
    implementation: "better-auth-sdk-wiring-pending-staging",
    sdkWiringStatus: "PENDING_STAGING",
    provider: "google",
    baseURL: BASE_URL,
    publicSignup: false,
    invitationRequired: true,
    admissionHook: "REQUIRED_BEFORE_IDENTITY_MATERIALIZATION",
    signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL",
    reviewerIdentitySource: "SERVER_SESSION",
    credentials: "REDACTED",
  });
  for (const secret of [CLIENT_ID, CLIENT_SECRET, AUTH_SECRET]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("the explicit SDK contract redacts secrets and gates every identity materialization", async () => {
  const configuration = createPendingBetterAuthGoogleConfiguration(validInput());
  let contractSerialized = "";
  const gate = configuration.installSdk((contract) => {
    assert.equal(contract.schemaVersion, "pending-better-auth-google-sdk-contract/v1");
    assert.equal(contract.baseURL, BASE_URL);
    assert.deepEqual(contract.emailAndPassword, { enabled: false });
    assert.equal(contract.publicSignup, false);
    assert.equal(contract.secrets.readGoogleClientId(), CLIENT_ID);
    assert.equal(contract.secrets.readGoogleClientSecret(), CLIENT_SECRET);
    assert.equal(contract.secrets.readBetterAuthSecret(), AUTH_SECRET);
    contractSerialized = JSON.stringify({ ...contract });
    return contract.identityMaterialization;
  });
  for (const secret of [CLIENT_ID, CLIENT_SECRET, AUTH_SECRET]) {
    assert.equal(contractSerialized.includes(secret), false);
  }

  let materializationCalls = 0;
  const denied = await gate.authorizeThenMaterialize(
    {
      workspaceId: "workspace_auth_a",
      email: "uninvited@example.test",
      emailVerified: true,
    },
    async () => {
      materializationCalls += 1;
      return "must-not-run";
    },
  );
  assert.deepEqual(denied, WORKSPACE_DENIED);
  assert.equal(materializationCalls, 0);

  const allowed = await gate.authorizeThenMaterialize(
    {
      workspaceId: "workspace_auth_a",
      email: "active@example.test",
      emailVerified: true,
    },
    async (authorization) => {
      materializationCalls += 1;
      assert.deepEqual(authorization, ACTIVE_AUTHORIZATION.value);
      return Object.freeze({ userId: "user_active" });
    },
  );
  assert.deepEqual(allowed, {
    ok: true,
    value: {
      authorization: ACTIVE_AUTHORIZATION.value,
      materialized: { userId: "user_active" },
    },
  });
  assert.equal(materializationCalls, 1);
});

test("malformed admission-hook output denies without evaluating accessors or materializing", async () => {
  let getterCalls = 0;
  let materializationCalls = 0;
  const configuration = createPendingBetterAuthGoogleConfiguration({
    ...validInput(),
    admissionHook: async () => ({
      ok: true,
      get value() {
        getterCalls += 1;
        return ACTIVE_AUTHORIZATION.value;
      },
    }),
  });
  const gate = configuration.installSdk((contract) => contract.identityMaterialization);
  assert.deepEqual(
    await gate.authorizeThenMaterialize(
      { workspaceId: "workspace_auth_a", email: "active@example.test", emailVerified: true },
      async () => {
        materializationCalls += 1;
        return "not-reached";
      },
    ),
    WORKSPACE_DENIED,
  );
  assert.equal(getterCalls, 0);
  assert.equal(materializationCalls, 0);

  const mismatchedGate = createPendingBetterAuthGoogleConfiguration({
    ...validInput(),
    admissionHook: async () => ACTIVE_AUTHORIZATION,
  }).installSdk((contract) => contract.identityMaterialization);
  assert.deepEqual(
    await mismatchedGate.authorizeThenMaterialize(
      { workspaceId: "workspace_auth_b", email: "active@example.test", emailVerified: true },
      async () => {
        materializationCalls += 1;
        return "not-reached";
      },
    ),
    WORKSPACE_DENIED,
  );
  assert.equal(materializationCalls, 0, "admission grants must match the exact request scope");
});

test("auth source has no ambient environment read, network transport, or live OAuth SDK import", async () => {
  const authSourceDirectory = new URL("../src/auth/", import.meta.url);
  const names = [
    "better-auth-google.ts",
    "index.ts",
    "local.ts",
    "plain-data.ts",
    "policy.ts",
    "types.ts",
    "validation.ts",
  ];

  const source = (
    await Promise.all(names.map((name) => readFile(new URL(name, authSourceDirectory), "utf8")))
  ).join("\n");
  assert.doesNotMatch(source, /\bprocess\.env\b/u);
  assert.doesNotMatch(source, /\bglobalThis\.fetch\b/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /from\s+["']better-auth(?:\/[^"']*)?["']/u);
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls)["']/u);
});
