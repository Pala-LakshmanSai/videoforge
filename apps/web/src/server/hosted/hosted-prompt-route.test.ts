import { describe, expect, it } from "vitest";
import { hostedPromptRedispatchable } from "./hosted-prompt-route";

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
    existing_run_count: 1,
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

  it("refuses once a durable accepted prompt set exists", () => {
    expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_has_accepted_set: true })).toBe(
      false,
    );
  });

  it("refuses a run that is still in flight", () => {
    for (const state of ["RUNNING", "DISPATCHING", "READY", "PENDING", "SUCCEEDED"])
      expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_state: state })).toBe(false);
  });

  it("refuses a deterministic defect that retrying would reproduce", () => {
    for (const problemCode of [
      "HOSTED_PROMPT_OUTPUT_INVALID",
      "HOSTED_PROMPT_REQUEST_REJECTED",
      "HOSTED_PROMPT_PLAN_NOT_READY",
      "",
    ])
      expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_problem_code: problemCode })).toBe(
        false,
      );
  });

  it("refuses once the revision has spent its attempt budget", () => {
    expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_count: 6 })).toBe(false);
    expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_count: 7 })).toBe(false);
    expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_count: 5 })).toBe(true);
  });

  it("refuses when the plan payload carries no usable attempt evidence", () => {
    expect(hostedPromptRedispatchable({})).toBe(false);
    expect(hostedPromptRedispatchable({ existing_run_state: "UNKNOWN" })).toBe(false);
    expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_count: 0 })).toBe(false);
    expect(hostedPromptRedispatchable({ ...failedProviderRun, existing_run_count: "x" })).toBe(false);
  });
});
