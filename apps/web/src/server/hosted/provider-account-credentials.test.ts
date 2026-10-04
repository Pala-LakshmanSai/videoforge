// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";
import {
  providerAccountCredentials,
  providerAccountIdentity,
} from "./provider-account-credentials";

const extra = {
  id: "fal-second",
  provider: "FAL" as const,
  credentialVersion: "v1",
  apiKey: "second-secret",
};
function configuration(overrides = {}) {
  return {
    apiGeneration: { kieApiKey: "legacy-kie", falApiKey: "legacy-fal", ...overrides },
  } as HostedRuntimeConfiguration;
}
describe("server provider account credentials", () => {
  it("admits arbitrary pool sizes independently per provider", () => {
    const pool = Array.from({ length: 9 }, (_, i) => ({
      ...extra,
      id: `fal-${i}`,
      apiKey: `secret-${i}`,
    }));
    const c = providerAccountCredentials(
      configuration({
        accountRoutingEnabled: true,
        apiAccountCredentialsJson: JSON.stringify(pool),
      }),
    );
    expect(c.availableAccountIds("FAL")).toHaveLength(10);
    expect(c.availableAccountIds("KIE")).toEqual(["kie-legacy"]);
    expect(c.apiKeyFor("FAL", pool[8])).toBe("secret-8");
  });
  it("disabled pool admission still observes historical tasks using their exact credentials", () => {
    const c = providerAccountCredentials(
      configuration({ apiAccountCredentialsJson: JSON.stringify([extra]) }),
    );
    expect(c.availableAccountIds("FAL")).toEqual(["fal-legacy"]);
    expect(c.apiKeyFor("FAL", extra)).toBe("second-secret");
  });
  it("legacy observation survives malformed extra account configuration", () => {
    const c = providerAccountCredentials(
      configuration({ accountRoutingEnabled: true, apiAccountCredentialsJson: "broken" }),
    );
    expect(c.apiKeyFor("KIE")).toBe("legacy-kie");
    expect(() => c.availableAccountIds("KIE")).toThrow("PROVIDER_ACCOUNT_CREDENTIALS_INVALID");
  });
  it("missing, wrong provider and stale version never fall back to another key", () => {
    const c = providerAccountCredentials(
      configuration({ apiAccountCredentialsJson: JSON.stringify([extra]) }),
    );
    expect(() => c.apiKeyFor("KIE", extra)).toThrow("PROVIDER_ACCOUNT_IDENTITY_INVALID");
    expect(() => c.apiKeyFor("FAL", { ...extra, credentialVersion: "v2" })).toThrow(
      "PROVIDER_ACCOUNT_CREDENTIAL_MISSING",
    );
    expect(() => c.apiKeyFor("FAL", { ...extra, id: "removed" })).toThrow(
      "PROVIDER_ACCOUNT_CREDENTIAL_MISSING",
    );
  });
  it.each(
    [
      [{ ...extra, id: "fal-legacy" }],
      [extra, extra],
      [{ ...extra, apiKey: "legacy-fal" }],
      [{ ...extra, id: "bad.id" }],
      [{ ...extra, provider: "RUNWARE" }],
      [{ ...extra, apiKey: "" }],
    ].map((pool) => ({ pool })),
  )("rejects unsafe credentials without revealing secret values", ({ pool }) => {
    const c = providerAccountCredentials(
      configuration({
        accountRoutingEnabled: true,
        apiAccountCredentialsJson: JSON.stringify(pool),
      }),
    );
    expect(() => c.availableAccountIds("FAL")).toThrow(/PROVIDER_ACCOUNT_/u);
    try {
      c.availableAccountIds("FAL");
    } catch (error) {
      expect(String(error)).not.toContain("second-secret");
    }
  });
  it("strictly validates durable nonsecret account identity", () => {
    expect(providerAccountIdentity(undefined)).toBeUndefined();
    expect(() =>
      providerAccountIdentity({ id: "a", provider: "FAL", credentialVersion: "" }),
    ).toThrow();
  });
});
