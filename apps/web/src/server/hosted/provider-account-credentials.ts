import type { HostedRuntimeConfiguration } from "./configuration";

export interface ProviderAccountIdentity {
  readonly id: string;
  readonly provider: "KIE" | "FAL";
  readonly credentialVersion: string;
}

type Credential = ProviderAccountIdentity & { readonly apiKey: string };
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const VERSION = /^[a-zA-Z0-9_-]{1,64}$/u;

export function providerAccountIdentity(value: unknown): ProviderAccountIdentity | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !ID.test(row.id) ||
    !["KIE", "FAL"].includes(String(row.provider)) ||
    typeof row.credentialVersion !== "string" ||
    !VERSION.test(row.credentialVersion)
  ) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
  }
  return {
    id: row.id,
    provider: row.provider as "KIE" | "FAL",
    credentialVersion: row.credentialVersion,
  };
}

/** Secrets stay in the server binding. SQL stores only immutable account identity.
 * Parse extra credentials lazily so legacy paid tasks survive a malformed pool update. */
export function providerAccountCredentials(configuration: HostedRuntimeConfiguration) {
  const api = configuration.apiGeneration;
  if (!api) throw new Error("HOSTED_API_GENERATION_BINDING_MISSING");
  const legacy: Credential[] = [
    { id: "kie-legacy", provider: "KIE", credentialVersion: "v1", apiKey: api.kieApiKey },
    { id: "fal-legacy", provider: "FAL", credentialVersion: "v1", apiKey: api.falApiKey },
  ];
  let extra: Credential[] | undefined;
  const credentials = (): Credential[] => {
    if (extra !== undefined) return extra;
    let value: unknown;
    try {
      value = JSON.parse(api.apiAccountCredentialsJson ?? "[]");
    } catch {
      throw new Error("PROVIDER_ACCOUNT_CREDENTIALS_INVALID");
    }
    if (!Array.isArray(value)) throw new Error("PROVIDER_ACCOUNT_CREDENTIALS_INVALID");
    const ids = new Set(legacy.map((row) => row.id));
    const parsed: Credential[] = [];
    const keys = new Set(legacy.map((row) => row.provider + ":" + row.apiKey));
    for (const item of value) {
      const identity = providerAccountIdentity(item);
      const key = (item as Record<string, unknown> | null)?.apiKey;
      if (
        !identity ||
        ids.has(identity.id) ||
        typeof key !== "string" ||
        !key.trim() ||
        keys.has(identity.provider + ":" + key.trim())
      ) {
        throw new Error("PROVIDER_ACCOUNT_CREDENTIALS_INVALID");
      }
      ids.add(identity.id);
      keys.add(identity.provider + ":" + key.trim());
      parsed.push({ ...identity, apiKey: key.trim() });
    }
    extra = parsed;
    return extra;
  };
  return {
    availableAccountIds(provider: "KIE" | "FAL"): string[] {
      const enabled = api.accountRoutingEnabled ? [...legacy, ...credentials()] : legacy;
      return enabled.filter((row) => row.provider === provider).map((row) => row.id);
    },
    apiKeyFor(provider: "KIE" | "FAL", identity?: ProviderAccountIdentity): string {
      const target = identity ?? legacy.find((row) => row.provider === provider)!;
      if (target.provider !== provider) throw new Error("PROVIDER_ACCOUNT_IDENTITY_INVALID");
      const historical = legacy.find((row) => row.id === target.id);
      const credential = historical ?? credentials().find((row) => row.id === target.id);
      if (
        !credential ||
        credential.provider !== provider ||
        credential.credentialVersion !== target.credentialVersion
      ) {
        throw new Error("PROVIDER_ACCOUNT_CREDENTIAL_MISSING");
      }
      return credential.apiKey;
    },
  };
}
