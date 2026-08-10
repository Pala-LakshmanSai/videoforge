import type { Hono } from "hono";

import { createApiApp } from "../src/server/app";
import {
  createCloudflareApiOptions,
  type CloudflareRuntimeEnvironment,
} from "../src/server/runtime/cloudflare";

let cachedApp: Hono | null = null;
let cachedConfigurationKey: string | null = null;
const localBuildCommit = import.meta.env.VITE_VIDEOFORGE_COMMIT;

function appFor(environment: CloudflareRuntimeEnvironment): Hono {
  const options = createCloudflareApiOptions({
    ASSETS: environment.ASSETS,
    VIDEOFORGE_COMMIT: localBuildCommit || environment.VIDEOFORGE_COMMIT,
    VIDEOFORGE_ENVIRONMENT: environment.VIDEOFORGE_ENVIRONMENT,
    VIDEOFORGE_PROVIDER_MODE: environment.VIDEOFORGE_PROVIDER_MODE,
    NODE_ENV: environment.NODE_ENV,
  });
  const key = JSON.stringify(options.configuration);
  if (!cachedApp || cachedConfigurationKey !== key) {
    cachedApp = createApiApp(options);
    cachedConfigurationKey = key;
  }
  return cachedApp;
}

export default {
  fetch(request, environment, executionContext) {
    return appFor(environment).fetch(request, environment, executionContext);
  },
} satisfies ExportedHandler<CloudflareRuntimeEnvironment>;
