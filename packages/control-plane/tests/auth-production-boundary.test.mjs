import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createBetterAuthGoogleConfiguration,
  ProductionAuthBindingError,
} from "../dist/src/auth/index.js";

const CLIENT_ID = "fixture-google-client.apps.googleusercontent.test";
const CLIENT_SECRET = "fixture-google-client-secret-never-real";
const AUTH_SECRET = "fixture-better-auth-secret-never-real-0123456789";
const BASE_URL = "https://videoforge.example.test";

function validInput() {
  return {
    baseURL: BASE_URL,
    bindings: {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      BETTER_AUTH_SECRET: AUTH_SECRET,
    },
  };
}

test("production Google authentication fails closed with exact missing binding names and no values", () => {
  assert.throws(
    () => createBetterAuthGoogleConfiguration({ baseURL: BASE_URL, bindings: {} }),
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
      createBetterAuthGoogleConfiguration({
        baseURL: BASE_URL,
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

test("production configuration rejects weak, whitespace-padded, or non-HTTPS bindings", () => {
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
  ]) {
    assert.throws(
      () => createBetterAuthGoogleConfiguration(input),
      (error) =>
        error instanceof ProductionAuthBindingError &&
        error.code === "PRODUCTION_AUTH_BINDING_INVALID",
    );
  }
});

test("the Better Auth boundary materializes server options but serializes only a redacted policy descriptor", () => {
  const configuration = createBetterAuthGoogleConfiguration(validInput());
  assert.deepEqual(configuration, {
    implementation: "better-auth",
    provider: "google",
    baseURL: BASE_URL,
    publicSignup: false,
    invitationRequired: true,
    signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL",
    reviewerIdentitySource: "SERVER_SESSION",
    materializeServerOptions: configuration.materializeServerOptions,
    toJSON: configuration.toJSON,
  });
  assert.equal(Object.isFrozen(configuration), true);

  const serialized = JSON.stringify(configuration);
  assert.deepEqual(JSON.parse(serialized), {
    implementation: "better-auth",
    provider: "google",
    baseURL: BASE_URL,
    publicSignup: false,
    invitationRequired: true,
    signInPolicy: "INVITED_VERIFIED_GOOGLE_EMAIL",
    reviewerIdentitySource: "SERVER_SESSION",
    credentials: "REDACTED",
  });
  for (const secret of [CLIENT_ID, CLIENT_SECRET, AUTH_SECRET]) {
    assert.equal(serialized.includes(secret), false);
  }

  const serverOptions = configuration.materializeServerOptions();
  assert.deepEqual(serverOptions, {
    baseURL: BASE_URL,
    secret: AUTH_SECRET,
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      },
    },
  });
  assert.equal(Object.isFrozen(serverOptions), true);
  assert.equal(Object.isFrozen(serverOptions.socialProviders), true);
  assert.equal(Object.isFrozen(serverOptions.socialProviders.google), true);
});

test("auth source has no ambient environment read, network transport, or live OAuth SDK import", async () => {
  const authSourceDirectory = new URL("../src/auth/", import.meta.url);
  const names = ["better-auth-google.ts", "index.ts", "local.ts", "policy.ts", "types.ts"];

  const source = (
    await Promise.all(names.map((name) => readFile(new URL(name, authSourceDirectory), "utf8")))
  ).join("\n");
  assert.doesNotMatch(source, /\bprocess\.env\b/u);
  assert.doesNotMatch(source, /\bglobalThis\.fetch\b/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /from\s+["']better-auth(?:\/[^"']*)?["']/u);
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls)["']/u);
});
