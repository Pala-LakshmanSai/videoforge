const SECRET_ENVIRONMENT_NAMES = Object.freeze([
  "BETTER_AUTH_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "DATABASE_URL",
  "GOOGLE_CLIENT_SECRET",
  "NEON_DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "RUNPOD_API_KEY",
  "RUNWARE_API_KEY",
]);

const INTEGRATION_ENVIRONMENT_NAMES = Object.freeze([
  ...SECRET_ENVIRONMENT_NAMES,
  "GOOGLE_CLIENT_ID",
  "R2_ACCOUNT_ID",
]);

export function presentIntegrationSecretNames(environment = process.env) {
  return SECRET_ENVIRONMENT_NAMES.filter((name) => {
    const value = environment[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function assertProviderFreeEnvironment(environment = process.env) {
  const present = presentIntegrationSecretNames(environment);
  if (present.length === 0) return;
  throw new Error(
    `Provider-free development refuses credential-bearing environment variables: ${present.join(", ")}. Unset them before starting VideoForge; values were neither displayed nor forwarded.`,
  );
}

export function sanitizedDevelopmentEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  for (const name of INTEGRATION_ENVIRONMENT_NAMES) delete sanitized[name];
  return sanitized;
}

export function isLanListenerAddress(address) {
  if (typeof address !== "string") return false;
  return address.startsWith("*:") || address.startsWith("0.0.0.0:") || address.startsWith("[::]:");
}

export const integrationEnvironmentNames = INTEGRATION_ENVIRONMENT_NAMES;
