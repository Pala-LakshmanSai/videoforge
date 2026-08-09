import path from "node:path";

export interface FixtureServerHealth {
  readonly app: "videoforge";
  readonly status: "ok";
  readonly mode: "fixture";
  readonly commit: string;
  readonly fixture_id: string;
  readonly synthetic: true;
  readonly provider_calls_authorized: false;
  readonly authorized_spend_usd: 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertRepositoryOwnedListener(listenerCwd: string, repositoryRoot: string): void {
  const relative = path.relative(repositoryRoot, listenerCwd);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error("Playwright preflight found a port 4173 listener owned by another checkout.");
}

export function assertFixtureServerPreflight(
  health: unknown,
  expectedCommit: string,
  expectedFixture = "happy_generating",
): asserts health is FixtureServerHealth {
  if (!isRecord(health) || health.app !== "videoforge" || health.status !== "ok") {
    throw new Error("Playwright preflight reached the wrong server or an invalid health endpoint.");
  }
  if (health.mode !== "fixture") {
    throw new Error(
      "Playwright preflight requires fixture mode; provider and local modes are refused.",
    );
  }
  if (health.fixture_id !== expectedFixture || health.synthetic !== true) {
    throw new Error("Playwright preflight requires the expected synthetic fixture scenario.");
  }
  if (health.provider_calls_authorized !== false) {
    throw new Error("Playwright preflight refuses a server that authorizes provider calls.");
  }
  if (health.authorized_spend_usd !== 0) {
    throw new Error("Playwright preflight requires authorized external spend to equal $0.");
  }
  if (health.commit !== expectedCommit) {
    throw new Error("Playwright preflight found a stale server whose commit does not match HEAD.");
  }
}
