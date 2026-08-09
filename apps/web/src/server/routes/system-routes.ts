import { executionProfileCatalog } from "@videoforge/config";
import {
  DEFAULT_FIXTURE_SCENARIO_ID,
  FIXTURE_SCENARIO_IDS,
  listFixtureScenarios,
} from "@videoforge/test-fixtures";
import type { Hono } from "hono";

import { fixtureFromRequest, resolveFixture } from "../fixture";
import type { FixtureRuntime } from "../fixture-runtime";

export function registerSystemRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.get("/api/health", (c) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    return c.json({
      app: "videoforge" as const,
      status: "ok" as const,
      mode: "fixture" as const,
      commit: runtime.commit,
      fixture_id: resolved.id,
      synthetic: true as const,
      provider_calls_authorized: false as const,
      authorized_spend_usd: 0 as const,
    });
  });

  if (runtime.environment !== "production") {
    app.get("/api/dev/fixtures", (c) =>
      c.json({
        defaultFixtureId: DEFAULT_FIXTURE_SCENARIO_ID,
        count: FIXTURE_SCENARIO_IDS.length,
        fixtures: listFixtureScenarios(),
      }),
    );

    app.get("/api/dev/fixtures/:fixtureId", (c) => {
      const resolved = resolveFixture(c.req.param("fixtureId"));
      if (!resolved.ok) return resolved.response;
      return c.json(resolved.scenario);
    });

    app.post("/api/dev/fixture-session/reset", (c) => {
      const session = runtime.resolveSession(c);
      if (!session.ok) return session.response;
      runtime.sessions.reset(session.id);
      return c.json({ ok: true as const, sessionId: session.id, providerCallsAuthorized: false });
    });
  }

  app.get("/api/v1/bootstrap", (c) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    return c.json(runtime.bootstrapResponse(resolved.scenario, session.state));
  });

  app.get("/api/v1/execution-profiles", (c) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    return c.json(executionProfileCatalog);
  });
}
