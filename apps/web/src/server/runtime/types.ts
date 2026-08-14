import type { ProviderMode } from "@videoforge/config";
import type { Hono } from "hono";

import type { LocalSliceRunner } from "../local/types";
import type { SharedAppPersistence } from "../shared-app-persistence";
import type { ProviderFreeArtifactRuntime } from "../provider-free-artifact-runtime";

export type RuntimeEnvironment = "development" | "test" | "production";
export type RuntimePlatform = "node" | "cloudflare";

export interface RuntimeConfiguration {
  readonly commit: string;
  readonly environment: RuntimeEnvironment;
  readonly mode: ProviderMode;
}

export interface FixturePreviewBinding {
  read(request: Request): Promise<string>;
}

export interface DurableRuntimeBindings {
  readonly auth: object;
  readonly repositories: object;
  readonly artifactStore: object;
  readonly workflow: object;
}

export interface LocalApiAppFactoryOptions {
  readonly commit: string;
  readonly environment: RuntimeEnvironment;
  readonly mode: "local" | "sandbox";
  readonly runner: LocalSliceRunner;
}

export type LocalApiAppFactory = (options: LocalApiAppFactoryOptions) => Hono;

export interface ApiRuntimeBindings {
  readonly platform: RuntimePlatform;
  readonly fixturePreview?: FixturePreviewBinding;
  readonly fixtureSharedAppPersistence?: SharedAppPersistence;
  readonly fixtureProviderFreeArtifacts?: ProviderFreeArtifactRuntime;
  readonly localRunner?: LocalSliceRunner;
  readonly localAppFactory?: LocalApiAppFactory;
  readonly sandboxAppFactory?: LocalApiAppFactory;
  readonly durable?: Partial<DurableRuntimeBindings>;
}

export interface CreateApiAppOptions {
  readonly configuration: RuntimeConfiguration;
  readonly bindings: ApiRuntimeBindings;
}

export interface RuntimeEnvironmentSource {
  readonly VIDEOFORGE_COMMIT?: string;
  readonly VIDEOFORGE_ENVIRONMENT?: string;
  readonly VIDEOFORGE_PROVIDER_MODE?: string;
  readonly NODE_ENV?: string;
}
