import { currentScenario, withScenario } from "../../lib/scenario";

export function fixtureLink(path: string) {
  return withScenario(path, currentScenario());
}
