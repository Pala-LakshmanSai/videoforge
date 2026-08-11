import { describe, expect, it } from "vitest";

import { createApiApp } from "../app";
import { createLocalApiApp } from "../local/app";
import { RuntimeBindingError, runtimeConfigurationFromEnvironment } from "./configuration";
import { createNodeRuntimeConfiguration } from "./node";
import { resolveNodeSandboxDataRoot } from "./node-sandbox";
import type { CreateApiAppOptions } from "./types";

const fixturePreview = { read: async () => "<svg>fixture preview</svg>" };
const mediaRunner = {
  prepareOwnedVoiceover: async () => {
    throw new Error("not used");
  },
  run: async () => {
    throw new Error("not used");
  },
};
const mediaAppFactory = () => {
  throw new Error("factory sentinel");
};

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

  it("gives the explicit Node environment precedence over NODE_ENV", () => {
    expect(
      createNodeRuntimeConfiguration({
        VIDEOFORGE_COMMIT: "abcdef1234567890",
        VIDEOFORGE_ENVIRONMENT: "production",
        VIDEOFORGE_PROVIDER_MODE: "fixture",
        NODE_ENV: "development",
      }),
    ).toEqual({
      commit: "abcdef1234567890",
      environment: "production",
      mode: "fixture",
    });
  });

  it("keeps sandbox persistence inside the workspace-owned data directory", () => {
    expect(
      resolveNodeSandboxDataRoot(
        { VIDEOFORGE_SANDBOX_DATA_ROOT: "/workspace/.videoforge/sandbox" },
        "/workspace",
      ),
    ).toBe("/workspace/.videoforge/sandbox");
    expect(() => resolveNodeSandboxDataRoot({}, "/workspace")).toThrow(
      "requires an absolute VIDEOFORGE_SANDBOX_DATA_ROOT",
    );
    expect(() =>
      resolveNodeSandboxDataRoot(
        { VIDEOFORGE_SANDBOX_DATA_ROOT: "/workspace/.videoforge" },
        "/workspace",
      ),
    ).toThrow("must be a child of the workspace .videoforge directory");
    expect(() =>
      resolveNodeSandboxDataRoot({ VIDEOFORGE_SANDBOX_DATA_ROOT: "/tmp/videoforge" }, "/workspace"),
    ).toThrow("must be a child of the workspace .videoforge directory");
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
    expect(() => createApiApp(optionsFor("sandbox"))).toThrow(
      "Sandbox mode requires an explicit Node media runner.",
    );
    expect(() =>
      createApiApp(
        optionsFor("sandbox", {
          platform: "cloudflare",
          localRunner: mediaRunner,
          sandboxAppFactory: mediaAppFactory,
        }),
      ),
    ).toThrow("Sandbox mode is Node-only and cannot run on Cloudflare.");
    expect(() =>
      createApiApp(
        optionsFor("sandbox", {
          platform: "node",
          localRunner: mediaRunner,
        }),
      ),
    ).toThrow("Sandbox mode requires an explicit Node application factory.");

    for (const mode of ["staging", "production"] as const) {
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

  it("serves sandbox only through explicit Node bindings with zero provider authority", async () => {
    const app = createApiApp(
      optionsFor("sandbox", {
        platform: "node",
        localRunner: mediaRunner,
        sandboxAppFactory: createLocalApiApp,
      }),
    );
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-videoforge-provider-mode")).toBe("sandbox");
    expect(await response.json()).toMatchObject({
      mode: "sandbox",
      synthetic: true,
      provider_calls_authorized: false,
      authorized_spend_usd: 0,
    });
  });
});
