import type { HostedScope } from "./hosted-product-route-common";
import type { HostedRuntimeConfiguration } from "./configuration";

/**
 * Server-side stage continuation.
 *
 * Every pipeline handoff used to be driven by the browser: the workspace fired /context, then /render,
 * then /prompts, then /gpu-dispatch from `useEffect` hooks. That makes the pipeline depend on a tab
 * being open on the right project -- a completed stage could sit pending indefinitely -- and it is why
 * stage 4 stayed pending after stage 3 finished while nothing was driving the page.
 *
 * A stage that finishes already holds a validated scope for the project, so it can hand off to the
 * next stage itself with `waitUntil`: no user session is re-derived, no cron is needed, and the next
 * stage starts within the same request that completed the previous one. Every handoff target keeps its
 * own durable claim, so a duplicate handoff from the browser is refused exactly as before.
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
