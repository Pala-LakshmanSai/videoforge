export type HostedProviderMode = "staging" | "production";

export function isHostedProviderMode(value: unknown): value is HostedProviderMode {
  return value === "staging" || value === "production";
}

export function isHostedBetaMode(value: unknown): value is "staging" {
  return value === "staging";
}
