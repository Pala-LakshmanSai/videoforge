import { describe, expect, it, vi } from "vitest";

import { startHostedStageContinuation } from "./stage-continuation";

describe("immediate stage handoff", () => {
  it("uses the same revision-scoped Workflow identity on duplicate completions", async () => {
    const create = vi.fn(async () => ({ id: "created" }));
    const environment = { HOSTED_CONTINUATION_WORKFLOW: { create } } as never;
    const target = {
      accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "11111111-1111-4111-8111-111111111111",
      revisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      step: "context" as const,
    };

    await startHostedStageContinuation(environment, target);
    await startHostedStageContinuation(environment, target);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, {
      id: `stage-context-${target.revisionId}`,
      params: { reason: "stage-handoff", target },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      id: `stage-context-${target.revisionId}`,
      params: { reason: "stage-handoff", target },
    });
  });
});
