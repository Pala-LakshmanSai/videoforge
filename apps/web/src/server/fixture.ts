import {
  DEFAULT_FIXTURE_SCENARIO_ID,
  FIXTURE_SCENARIO_IDS,
  getFixtureScenario,
  isFixtureScenarioId,
  type FixtureScenario,
  type FixtureScenarioId,
} from "@videoforge/test-fixtures";

import { apiProblem, problemResponse } from "./problem";

export interface ResolvedFixture {
  ok: true;
  id: FixtureScenarioId;
  scenario: FixtureScenario;
}

export interface FixtureResolutionError {
  ok: false;
  response: Response;
}

export type FixtureResolution = ResolvedFixture | FixtureResolutionError;

export function resolveFixture(rawFixture: string | undefined): FixtureResolution {
  const value = rawFixture ?? DEFAULT_FIXTURE_SCENARIO_ID;
  if (!isFixtureScenarioId(value)) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "FIXTURE_NOT_FOUND",
          404,
          "Unknown fixture scenario",
          `Fixture '${value}' does not exist. Valid fixture IDs: ${FIXTURE_SCENARIO_IDS.join(", ")}.`,
          false,
        ),
      ),
    };
  }
  return { ok: true, id: value, scenario: getFixtureScenario(value) };
}

export function fixtureFromRequest(request: Request): FixtureResolution {
  const url = new URL(request.url);
  const queryFixture = url.searchParams.get("fixture") ?? undefined;
  const headerFixture = request.headers.get("x-videoforge-fixture") ?? undefined;
  return resolveFixture(queryFixture ?? headerFixture);
}

export function safeCommit(value: string | undefined): string {
  if (value && /^[a-f0-9]{7,40}$/iu.test(value)) return value.toLowerCase();
  return "uncommitted";
}
