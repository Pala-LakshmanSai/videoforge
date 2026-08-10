import type { CreateApiAppOptions, FixturePreviewBinding, RuntimeEnvironmentSource } from "./types";
import { runtimeConfigurationFromEnvironment } from "./configuration";

export interface CloudflareAssetFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CloudflareRuntimeEnvironment extends RuntimeEnvironmentSource {
  readonly ASSETS?: CloudflareAssetFetcher;
}

function createCloudflareFixturePreviewBinding(
  assets: CloudflareAssetFetcher | undefined,
): FixturePreviewBinding | undefined {
  if (!assets) return undefined;
  return {
    async read(request) {
      const assetUrl = new URL("/fixtures/media/watermelon-market.svg", request.url);
      const response = await assets.fetch(assetUrl);
      if (!response.ok) {
        throw new Error(`Fixture preview asset returned ${response.status}.`);
      }
      return response.text();
    },
  };
}

export function createCloudflareApiOptions(
  environment: CloudflareRuntimeEnvironment,
): CreateApiAppOptions {
  return {
    configuration: runtimeConfigurationFromEnvironment(environment),
    bindings: {
      platform: "cloudflare",
      fixturePreview: createCloudflareFixturePreviewBinding(environment.ASSETS),
    },
  };
}
