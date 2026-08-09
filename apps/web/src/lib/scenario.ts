import { scenarioIds, type ScenarioId } from "./types";

export function currentScenario(): ScenarioId {
  const value = new URLSearchParams(window.location.search).get("fixture");
  return scenarioIds.includes(value as ScenarioId) ? (value as ScenarioId) : "happy_generating";
}

export function setScenario(scenario: ScenarioId) {
  const url = new URL(window.location.href);
  url.searchParams.set("fixture", scenario);
  window.location.assign(url.toString());
}

export function withScenario(path: string, scenario = currentScenario()) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("fixture", scenario);
  return `${url.pathname}${url.search}`;
}
