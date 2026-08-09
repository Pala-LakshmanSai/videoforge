import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProviderFreeEnvironment,
  developmentOpenRoute,
  isLanListenerAddress,
  presentIntegrationSecretNames,
  sanitizedDevelopmentEnvironment,
} from "../dev-policy.mjs";

test("provider-free policy reports names without returning secret values", () => {
  const environment = {
    PATH: "/safe/bin",
    RUNPOD_API_KEY: "runpod-private-value",
    RUNWARE_API_KEY: "",
  };
  assert.deepEqual(presentIntegrationSecretNames(environment), ["RUNPOD_API_KEY"]);
  assert.throws(
    () => assertProviderFreeEnvironment(environment),
    (error) =>
      error instanceof Error &&
      error.message.includes("RUNPOD_API_KEY") &&
      !error.message.includes("runpod-private-value"),
  );
});

test("development child environments strip integration credentials and retain safe values", () => {
  const sanitized = sanitizedDevelopmentEnvironment({
    PATH: "/safe/bin",
    DATABASE_URL: "postgres://private",
    GOOGLE_CLIENT_ID: "public-client-id",
  });
  assert.deepEqual(sanitized, { PATH: "/safe/bin" });
});

test("listener exposure classification distinguishes wildcard and loopback bindings", () => {
  assert.equal(isLanListenerAddress("*:4173"), true);
  assert.equal(isLanListenerAddress("0.0.0.0:4173"), true);
  assert.equal(isLanListenerAddress("[::]:4173"), true);
  assert.equal(isLanListenerAddress("127.0.0.1:4173"), false);
  assert.equal(isLanListenerAddress("[::1]:4173"), false);
  assert.equal(isLanListenerAddress(undefined), false);
});

test("development open routes select truthful defaults and reject another origin", () => {
  assert.equal(developmentOpenRoute({ mode: "local" }), "/projects/new");
  assert.equal(
    developmentOpenRoute({ mode: "fixture", fixture_id: "budget_blocked" }),
    "/?fixture=budget_blocked",
  );
  assert.equal(
    developmentOpenRoute({ mode: "fixture" }, "/usage?fixture=happy_generating"),
    "/usage?fixture=happy_generating",
  );
  assert.throws(() => developmentOpenRoute({ mode: "fixture" }, "//example.invalid/path"));
});
