import { runtimeConfigurationFromEnvironment } from "./configuration";
import type { RuntimeConfiguration } from "./types";

export function createNodeRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeConfiguration {
  return runtimeConfigurationFromEnvironment({
    VIDEOFORGE_COMMIT: environment.VIDEOFORGE_COMMIT,
    VIDEOFORGE_ENVIRONMENT: environment.VIDEOFORGE_ENVIRONMENT,
    VIDEOFORGE_PROVIDER_MODE: environment.VIDEOFORGE_PROVIDER_MODE,
    NODE_ENV: environment.NODE_ENV,
  });
}
