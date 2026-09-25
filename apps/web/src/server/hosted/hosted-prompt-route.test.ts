import { describe, expect, it, vi } from "vitest";
import { handoffAcceptedHostedPrompts, hostedPromptRedispatchable } from "./hosted-prompt-route";

it("hands accepted API prompts to the next stage without changing acceptance on dispatch failure", async () => {
  const scope = { account_id: "account", workspace_id: "workspace", user_id: "user" };
  const handoff = vi.fn(async () => {
    throw new Error("dispatch unavailable");
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await expect(handoffAcceptedHostedPrompts(true, handoff, scope, "project")).resolves.toBeUndefined();
    expect(handoff).toHaveBeenCalledExactlyOnceWith(scope, "project");
    expect(warning).toHaveBeenCalledWith(
      "hosted_prompt_next_stage_failed project=project message=dispatch unavailable",
    );
    await handoffAcceptedHostedPrompts(false, handoff, scope, "project");
    expect(handoff).toHaveBeenCalledTimes(1);
  } finally {
    warning.mockRestore();
  }
});

/**
 * The redispatch gate decides whether a revision that already owns a prompt run may spend another
 * attempt. It exists because a provider failure during prompt writing used to strand the revision
 * at stage 5 forever (every later POST /prompts answered 409), and it must never widen into
 * re-running work that was already accepted or paid for.
 */
describe("hostedPromptRedispatchable", () => {
  const failedProviderRun = {
    existing_run_state: "UNKNOWN",
    existing_run_problem_code: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
    existing_run_has_accepted_set: false,
    existing_run_provider_may_have_charged: false,
    existing_run_redispatch_count: 0,
  } as Record<string, unknown>;

  it("grants a redispatch when the provider failed and nothing was accepted", () => {
    expect(hostedPromptRedispatchable(failedProviderRun)).toBe(true);
  });

  it("grants a redispatch for a provider-class failure recorded as FAILED", () => {
    expect(
      hostedPromptRedispatchable({
        ...failedProviderRun,
        existing_run_state: "FAILED",
        existing_run_problem_code: "HOSTED_PROMPT_PROVIDER_UNAVAILABLE",
      }),
    ).toBe(true);
  });

  it("holds a stale in-flight run because the provider outcome is unknown", () => {
    const staleRun = {
      existing_run_state: "DISPATCHING",
      existing_run_problem_code: null,
      existing_run_has_accepted_set: false,
      existing_run_redispatch_count: 1,
    } as Record<string, unknown>;
    expect(hostedPromptRedispatchable(staleRun, true)).toBe(false);

    // Same row while the caller has not established that the run is stale: still refused.
    expect(hostedPromptRedispatchable(staleRun, false)).toBe(false);

    // A stale run that already accepted a prompt set may never be replaced, and a spent budget still
    // refuses even when stale.
    expect(
      hostedPromptRedispatchable({ ...staleRun, existing_run_has_accepted_set: true }, true),
    ).toBe(false);
    expect(
      hostedPromptRedispatchable({ ...staleRun, existing_run_redispatch_count: 30 }, true),
    ).toBe(false);
  });

  it("refuses an unknown run when the provider may have charged", () => {
    expect(
      hostedPromptRedispatchable({
        ...failedProviderRun,
        existing_run_provider_may_have_charged: true,
      }),
    ).toBe(false);
  });

  it("refuses once a durable accepted prompt set exists", () => {
    expect(
      hostedPromptRedispatchable({ ...failedProviderRun, existing_run_has_accepted_set: true }),
    ).toBe(false);
  });

  it("refuses a run that is still in flight", () => {
    for (const state of ["RUNNING", "DISPATCHING", "READY", "PENDING", "SUCCEEDED"])
      expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_state: state })).toBe(
        false,
      );
  });

  it("refuses a deterministic defect that retrying would reproduce", () => {
    for (const problemCode of [
      "HOSTED_PROMPT_OUTPUT_INVALID",
      "HOSTED_PROMPT_REQUEST_REJECTED",
      "HOSTED_PROMPT_PLAN_NOT_READY",
      "",
    ])
      expect(
        hostedPromptRedispatchable({
          ...failedProviderRun,
          existing_run_problem_code: problemCode,
        }),
      ).toBe(false);
  });

  it("refuses once the revision has spent its attempt budget", () => {
    // The budget mirrors the stage-3 context budget: a recovery path that gives up after a handful of
    // attempts strands the run again, while each attempt is still a bounded and recorded provider call.
    expect(
      hostedPromptRedispatchable({ ...failedProviderRun, existing_run_redispatch_count: 29 }),
    ).toBe(false);
    expect(
      hostedPromptRedispatchable({ ...failedProviderRun, existing_run_redispatch_count: 31 }),
    ).toBe(false);
    expect(
      hostedPromptRedispatchable({ ...failedProviderRun, existing_run_redispatch_count: 28 }),
    ).toBe(true);
  });

  it("refuses when the plan payload carries no usable attempt evidence", () => {
    expect(hostedPromptRedispatchable({})).toBe(false);
    expect(hostedPromptRedispatchable({ existing_run_state: "UNKNOWN" })).toBe(false);
    expect(
      hostedPromptRedispatchable({ ...failedProviderRun, existing_run_redispatch_count: -1 }),
    ).toBe(false);
    expect(
      hostedPromptRedispatchable({ ...failedProviderRun, existing_run_redispatch_count: "x" }),
    ).toBe(false);
  });
});
