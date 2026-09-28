import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCoordinator: vi.fn((dependencies: unknown) => dependencies),
  resumeDispatch: vi.fn(async () => new Response(null, { status: 202 })),
}));

vi.mock("./hosted-v209-span-audio", () => ({
  createHostedV209SpanAudioCoordinator: mocks.createCoordinator,
}));
vi.mock("./hosted-v209-project-dispatch", () => ({
  resumeHostedV209ProjectDispatch: mocks.resumeDispatch,
}));

import { createHostedV209SpanAudioLiveCoordinator } from "./hosted-v209-span-live";

const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  projectId: "44444444-4444-4444-8444-444444444444",
};

describe("hosted V2-09 live span audio wiring", () => {
  beforeEach(() => vi.clearAllMocks());
  it("never resumes a provider pair from an empty or completed qualification span", async () => {
    createHostedV209SpanAudioLiveCoordinator({
      VIDEOFORGE_ENVIRONMENT: "staging", VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY: "true",
      VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID: identity.projectId,
    } as never, { neon: { databaseUrl: "postgres://unused" } } as never, vi.fn());
    const dependencies = mocks.createCoordinator.mock.calls[0]?.[0] as { resumePair: (value: typeof identity) => Promise<void> };
    await dependencies.resumePair(identity);
    expect(mocks.resumeDispatch).not.toHaveBeenCalled();
  });
  it("resumes an admitted pair without repeating admission", async () => {
    const environment = {
      VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres://reconciler.invalid/db",
    } as never;
    const config = {
      neon: { databaseUrl: "postgres://runtime.invalid/db" },
    } as never;

    createHostedV209SpanAudioLiveCoordinator(environment, config, vi.fn());
    const dependencies = mocks.createCoordinator.mock.calls[0]?.[0];
    if (!dependencies || typeof dependencies !== "object" || !("resumePair" in dependencies)) {
      throw new Error("live span coordinator dependencies were not captured");
    }
    const resumePair = (
      dependencies as {
        resumePair: (value: typeof identity) => Promise<void>;
      }
    ).resumePair;

    await resumePair(identity);

    expect(mocks.resumeDispatch).toHaveBeenCalledOnce();
    expect(mocks.resumeDispatch).toHaveBeenCalledWith(
      environment,
      config,
      identity,
      undefined,
      undefined,
      undefined,
      true,
    );
  });
});
