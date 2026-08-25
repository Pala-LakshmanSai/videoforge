import { currentScenario, withScenario } from "../../lib/scenario";
import { isHostedProviderMode } from "../../hosted/provider-mode";

export function fixtureLink(path: string) {
  if (isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
    throw new Error("Fixture navigation is disabled in hosted mode.");
  }
  return withScenario(path, currentScenario());
}
