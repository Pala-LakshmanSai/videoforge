import type { Sha256 } from "@videoforge/control-plane";

import type { HostedServerlessAttemptBinding } from "../runtime/hosted-serverless-output-barrier";
import { sha256 } from "./crypto";
import {
  HostedServerlessCallbackError,
  hostedServerlessCallbackErrorResponse,
  parseHostedServerlessCallbackRequest,
  type HostedServerlessCallbackResult,
} from "./hosted-serverless-callback";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BEARER = /^Bearer ([A-Za-z0-9_-]{43,256})$/u;

/**
 * An implementation must perform one opaque hash lookup and return only a currently bound,
 * durable attempt plus its current assignment. It must not accept an account/workspace selector
 * from the request, and it must not return superseded assignments or dispatch-token hashes.
 */
export interface HostedServerlessCallbackAuthorityRepository {
  loadCurrentOutputAuthorityByTokenSha256(
    callbackTokenSha256: Sha256,
  ): Promise<HostedServerlessCallbackAuthority | null>;
}

export interface HostedServerlessCallbackAuthority {
  readonly purpose: "SERVERLESS_OUTPUT_CALLBACK";
  readonly callbackTokenSha256: Sha256;
  readonly assignmentId: string;
  readonly binding: HostedServerlessAttemptBinding;
}

export interface HostedBoundServerlessCallback {
  acceptBound(
    binding: HostedServerlessAttemptBinding,
    callbackValue: unknown,
  ): Promise<HostedServerlessCallbackResult>;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function rejectAuthentication(): never {
  throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_UNAUTHENTICATED");
}

function validateAuthority(
  authority: HostedServerlessCallbackAuthority | null,
  suppliedTokenSha256: Sha256,
  routeAttemptId: string,
): HostedServerlessAttemptBinding {
  if (
    authority === null ||
    authority.purpose !== "SERVERLESS_OUTPUT_CALLBACK" ||
    !SHA256.test(authority.callbackTokenSha256) ||
    !UUID.test(authority.assignmentId) ||
    !constantTimeEqual(authority.callbackTokenSha256, suppliedTokenSha256) ||
    authority.binding.attemptId !== routeAttemptId ||
    !UUID.test(authority.binding.accountId) ||
    !UUID.test(authority.binding.workspaceId) ||
    !UUID.test(authority.binding.attemptId) ||
    authority.binding.providerJobId.length < 1
  ) {
    rejectAuthentication();
  }
  return authority.binding;
}

function success(value: HostedServerlessCallbackResult): Response {
  return Response.json(
    {
      schema_version: "videoforge-hosted-serverless-output-callback-response/v1",
      outcome: value.barrier,
      render_plan: value.renderPlan === null ? "PENDING" : "MATERIALIZED",
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "x-videoforge-runtime": "hosted-v2-09",
      },
    },
  );
}

/**
 * Worker-only callback route. Authentication precedes body parsing so missing, wrong, foreign,
 * stale, and malformed authority all share one response and cannot reveal tenant existence.
 */
export function createHostedAuthenticatedServerlessCallbackRoute(input: {
  readonly authorities: HostedServerlessCallbackAuthorityRepository;
  readonly callback: HostedBoundServerlessCallback;
}) {
  return Object.freeze({
    async handle(request: Request, routeAttemptId: string): Promise<Response> {
      try {
        if (!UUID.test(routeAttemptId)) rejectAuthentication();
        const authorization = request.headers.get("authorization") ?? "";
        const match = BEARER.exec(authorization);
        if (!match) rejectAuthentication();
        const suppliedTokenSha256 = await sha256(match[1]!);
        const authority =
          await input.authorities.loadCurrentOutputAuthorityByTokenSha256(suppliedTokenSha256);
        const binding = validateAuthority(authority, suppliedTokenSha256, routeAttemptId);
        const callbackValue = await parseHostedServerlessCallbackRequest(request);
        return success(await input.callback.acceptBound(binding, callbackValue));
      } catch (error) {
        return hostedServerlessCallbackErrorResponse(error);
      }
    },
  });
}

export type HostedAuthenticatedServerlessCallbackRoute = ReturnType<
  typeof createHostedAuthenticatedServerlessCallbackRoute
>;
