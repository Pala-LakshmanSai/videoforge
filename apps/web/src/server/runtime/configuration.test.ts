import { describe, expect, it } from "vitest";

import { createApiApp } from "../app";
import { RuntimeBindingError, runtimeConfigurationFromEnvironment } from "./configuration";
import type { CreateApiAppOptions } from "./types";

const fixturePreview = { read: async () => "<svg>fixture preview</svg>" };

function optionsFor(
  mode: CreateApiAppOptions["configuration"]["mode"],
  bindings: CreateApiAppOptions["bindings"] = { platform: "node" },
): CreateApiAppOptions {
  return {
    configuration: { commit: "abcdef1234567890", environment: "test", mode },
    bindings,
  };
}

describe("runtime configuration", () => {
  it("parses every explicit mode and rejects unknown environment values", () => {
    for (const mode of ["fixture", "local", "sandbox", "staging", "production"] as const) {
      expect(
        runtimeConfigurationFromEnvironment({
          VIDEOFORGE_COMMIT: "abcdef1234567890",
          VIDEOFORGE_ENVIRONMENT: "test",
          VIDEOFORGE_PROVIDER_MODE: mode,
        }),
      ).toEqual({ commit: "abcdef1234567890", environment: "test", mode });
    }

    expect(() =>
      runtimeConfigurationFromEnvironment({ VIDEOFORGE_PROVIDER_MODE: "provider-typo" }),
    ).toThrow(RuntimeBindingError);
    expect(() =>
      runtimeConfigurationFromEnvironment({ VIDEOFORGE_ENVIRONMENT: "preview" }),
    ).toThrow(RuntimeBindingError);
  });

  it("requires fixture assets and keeps local execution on injected Node bindings", () => {
    expect(() => createApiApp(optionsFor("fixture"))).toThrow(
      "Fixture mode requires an explicit fixture preview binding.",
    );
    expect(() =>
      createApiApp(
        optionsFor("local", {
          platform: "cloudflare",
        }),
      ),
    ).toThrow("Local mode is Node-only and cannot run on Cloudflare.");
    expect(() => createApiApp(optionsFor("local"))).toThrow(
      "Local mode requires an explicit Node media runner.",
    );

    expect(
      createApiApp(optionsFor("fixture", { platform: "cloudflare", fixturePreview })),
    ).toBeDefined();
  });

  it("fails every production-like mode closed before serving", () => {
    for (const mode of ["sandbox", "staging", "production"] as const) {
      expect(() => createApiApp(optionsFor(mode))).toThrow(
        `${mode} mode requires durable bindings: auth, repositories, artifactStore, workflow.`,
      );
      expect(() =>
        createApiApp(
          optionsFor(mode, {
            platform: "cloudflare",
            durable: { auth: {}, repositories: {}, artifactStore: {}, workflow: {} },
          }),
        ),
      ).toThrow(`${mode} mode is configured but remains unavailable`);
    }
  });
});
