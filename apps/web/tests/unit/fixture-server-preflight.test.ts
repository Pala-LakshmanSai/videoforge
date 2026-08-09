import { describe, expect, it } from "vitest";

import {
  assertFixtureServerPreflight,
  assertRepositoryOwnedListener,
} from "../e2e/fixture-server-preflight";

const expectedCommit = "abcdef0";
const validHealth = {
  app: "videoforge",
  status: "ok",
  mode: "fixture",
  commit: expectedCommit,
  fixture_id: "happy_generating",
  synthetic: true,
  provider_calls_authorized: false,
  authorized_spend_usd: 0,
} as const;

describe("fixture server preflight", () => {
  it("accepts the exact synthetic, provider-free, $0 HEAD server", () => {
    expect(() => assertFixtureServerPreflight(validHealth, expectedCommit)).not.toThrow();
  });

  it("rejects a wrong server before browser launch", () => {
    expect(() =>
      assertFixtureServerPreflight({ ...validHealth, app: "other" }, expectedCommit),
    ).toThrow(/wrong server/u);
  });

  it("rejects local or provider-backed modes", () => {
    expect(() =>
      assertFixtureServerPreflight({ ...validHealth, mode: "local" }, expectedCommit),
    ).toThrow(/fixture mode/u);
    expect(() =>
      assertFixtureServerPreflight(
        { ...validHealth, provider_calls_authorized: true },
        expectedCommit,
      ),
    ).toThrow(/provider calls/u);
  });

  it("rejects non-zero authorized spend", () => {
    expect(() =>
      assertFixtureServerPreflight({ ...validHealth, authorized_spend_usd: 0.01 }, expectedCommit),
    ).toThrow(/\$0/u);
  });

  it("rejects a stale server commit", () => {
    expect(() => assertFixtureServerPreflight(validHealth, "different")).toThrow(/stale server/u);
  });

  it("accepts only listeners whose cwd belongs to this checkout", () => {
    expect(() =>
      assertRepositoryOwnedListener("/repo/videoforge", "/repo/videoforge"),
    ).not.toThrow();
    expect(() =>
      assertRepositoryOwnedListener("/repo/videoforge/apps/web", "/repo/videoforge"),
    ).not.toThrow();
    expect(() =>
      assertRepositoryOwnedListener("/repo/videoforge-other/apps/web", "/repo/videoforge"),
    ).toThrow(/another checkout/u);
  });
});
