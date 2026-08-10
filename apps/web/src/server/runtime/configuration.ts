import { isProviderMode } from "@videoforge/config";

import type {
  CreateApiAppOptions,
  DurableRuntimeBindings,
  RuntimeConfiguration,
  RuntimeEnvironment,
  RuntimeEnvironmentSource,
} from "./types";

const RUNTIME_ENVIRONMENTS = new Set<RuntimeEnvironment>(["development", "test", "production"]);
const DURABLE_BINDING_NAMES = ["auth", "repositories", "artifactStore", "workflow"] as const;

export class RuntimeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeBindingError";
  }
}

function runtimeEnvironment(value: string | undefined): RuntimeEnvironment {
  const candidate = value ?? "development";
  if (!RUNTIME_ENVIRONMENTS.has(candidate as RuntimeEnvironment)) {
    throw new RuntimeBindingError(
      `Unsupported runtime environment '${candidate}'. Expected development, test, or production.`,
    );
  }
  return candidate as RuntimeEnvironment;
}

export function runtimeConfigurationFromEnvironment(
  source: RuntimeEnvironmentSource,
): RuntimeConfiguration {
  const mode = source.VIDEOFORGE_PROVIDER_MODE ?? "fixture";
  if (!isProviderMode(mode)) {
    throw new RuntimeBindingError(
      `Unsupported provider mode '${mode}'. Expected fixture, local, sandbox, staging, or production.`,
    );
  }

  return {
    commit: source.VIDEOFORGE_COMMIT ?? "uncommitted",
    environment: runtimeEnvironment(source.VIDEOFORGE_ENVIRONMENT ?? source.NODE_ENV),
    mode,
  };
}

function missingDurableBindings(bindings: Partial<DurableRuntimeBindings> | undefined): string[] {
  return DURABLE_BINDING_NAMES.filter((name) => !bindings?.[name]);
}

export function assertRunnableRuntime(options: CreateApiAppOptions): void {
  const { bindings, configuration } = options;

  if (configuration.mode === "fixture") {
    if (!bindings.fixturePreview) {
      throw new RuntimeBindingError("Fixture mode requires an explicit fixture preview binding.");
    }
    return;
  }

  if (configuration.mode === "local") {
    if (bindings.platform !== "node") {
      throw new RuntimeBindingError("Local mode is Node-only and cannot run on Cloudflare.");
    }
    if (!bindings.localRunner) {
      throw new RuntimeBindingError("Local mode requires an explicit Node media runner.");
    }
    if (!bindings.localAppFactory) {
      throw new RuntimeBindingError("Local mode requires an explicit Node application factory.");
    }
    return;
  }

  const missing = missingDurableBindings(bindings.durable);
  if (missing.length > 0) {
    throw new RuntimeBindingError(
      `${configuration.mode} mode requires durable bindings: ${missing.join(", ")}.`,
    );
  }

  throw new RuntimeBindingError(
    `${configuration.mode} mode is configured but remains unavailable until its durable adapters are implemented.`,
  );
}
