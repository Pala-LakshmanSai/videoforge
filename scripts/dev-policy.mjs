import { integrationEnvironmentNames, secretEnvironmentNames } from "./environment-metadata.mjs";

export function presentIntegrationSecretNames(environment = process.env) {
  return secretEnvironmentNames.filter((name) => {
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
  for (const name of integrationEnvironmentNames) delete sanitized[name];
  return sanitized;
}

export function isLanListenerAddress(address) {
  if (typeof address !== "string") return false;
  return address.startsWith("*:") || address.startsWith("0.0.0.0:") || address.startsWith("[::]:");
}

export function developmentOpenRoute(status, requestedRoute) {
  const fallback =
    status?.mode === "local"
      ? "/projects/new"
      : `/?fixture=${encodeURIComponent(status?.fixture_id ?? "happy_generating")}`;
  if (requestedRoute === undefined) return fallback;
  if (typeof requestedRoute !== "string" || !requestedRoute.startsWith("/")) {
    throw new Error("Development routes must be same-origin paths beginning with '/'.");
  }
  const base = new URL("http://localhost:4173");
  const resolved = new URL(requestedRoute, base);
  if (resolved.origin !== base.origin) {
    throw new Error("Development routes may not navigate to another origin.");
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export { integrationEnvironmentNames };
