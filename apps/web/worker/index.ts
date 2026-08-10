import type { Hono } from "hono";

import { createApiApp } from "../src/server/app";
import {
  createCloudflareApiOptions,
  type CloudflareRuntimeEnvironment,
} from "../src/server/runtime/cloudflare";

let cachedApp: Hono | null = null;
let cachedConfigurationKey: string | null = null;

function appFor(environment: CloudflareRuntimeEnvironment): Hono {
  const options = createCloudflareApiOptions(environment);
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
