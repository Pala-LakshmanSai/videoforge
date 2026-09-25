import type { HostedScope } from "./hosted-product-route-common";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";

/**
 * Server-side stage continuation.
 *
 * Every pipeline handoff used to be driven by the browser: the workspace fired /context, then /render,
 * then /prompts, then /gpu-dispatch from `useEffect` hooks. That makes the pipeline depend on a tab
 * being open on the right project -- a completed stage could sit pending indefinitely -- and it is why
 * stage 4 stayed pending after stage 3 finished while nothing was driving the page.
 *
 * Completed short stages can pass their validated scope to the next handler. Long stages use a
 * revision-scoped Workflow so provider work outlives the response. Every target still owns its
 * durable claim, so duplicate handoffs cannot replay accepted work.
 */
/**
 * The trusted scope a completed stage passes to the next stage's handler. It is exactly the scope
 * `sessionScope` returns, so the handlers accept either path without conversions.
 */
export type ContinuationScope = HostedScope;

/** Build the internal request one completed stage uses to invoke the next stage's handler. */
export function continuationRequest(
  config: HostedRuntimeConfiguration,
  pathname: string,
  body: unknown,
): Request {
  const origin = new URL(config.publicOrigin).origin;
  const payload = JSON.stringify(body);
  return new Request(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(payload).byteLength),
    },
    body: payload,
  });
}

/** Narrow a `sessionScope` result to the trusted shape the continuation passes back in. */
export function continuationScope(scope: HostedScope): ContinuationScope {
  return {
    account_id: scope.account_id,
    workspace_id: scope.workspace_id,
    user_id: scope.user_id,
  };
}

/** Queue one durable, revision-scoped handoff. The periodic driver remains the fallback. */
export async function startHostedStageContinuation(
  environment: HostedRuntimeEnvironment,
  input: { accountId: string; projectId: string; revisionId: string; step: "context" | "prompts" },
): Promise<void> {
  const workflow = environment.HOSTED_CONTINUATION_WORKFLOW;
  if (!workflow) return;
  try {
    await workflow.create({
      id: `stage-${input.step}-${input.revisionId}`,
      params: { reason: "stage-handoff", target: input },
    });
  } catch {
    // Duplicate completion races use the first instance; other failures fall back to the driver.
  }
}
