import {
  hashInviteCode,
  SharedAdmissionError,
  type HostedInviteRedemptionOutcome,
} from "@videoforge/control-plane";

export const HOSTED_INVITE_REDEMPTION_PATH = "/api/v2/invite/redemption";
export const HOSTED_INVITE_REDEMPTION_SCHEMA =
  "videoforge-hosted-invite-redemption/v1" as const;

export interface HostedInviteRedemptionDependencies {
  readonly publicOrigin: string;
  readonly sessionToken: (request: Request) => Promise<string | null>;
  /** Accepts only the safe hash. Implementations must never receive or retain the raw verifier. */
  readonly redeem: (
    sessionToken: string,
    verifierSha256: `sha256:${string}`,
  ) => Promise<HostedInviteRedemptionOutcome>;
}

function response(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-06",
    },
  });
}

function problem(code: HostedInviteRedemptionOutcome, status: number): Response {
  return response({ error: { code, retryable: false } }, status);
}

function parsedInviteCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "invite_code,schema_version" ||
    record.schema_version !== HOSTED_INVITE_REDEMPTION_SCHEMA ||
    typeof record.invite_code !== "string"
  ) {
    return null;
  }
  return record.invite_code;
}

export async function handleHostedInviteRedemption(
  request: Request,
  dependencies: HostedInviteRedemptionDependencies,
): Promise<Response> {
  if (request.method !== "POST") return problem("INVITE_INVALID", 405);
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin === null || requestOrigin !== new URL(dependencies.publicOrigin).origin) {
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED", retryable: false } }, 403);
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    contentType !== "application/json" ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > 4096
  ) {
    return problem("INVITE_INVALID", 400);
  }

  const sessionToken = await dependencies.sessionToken(request);
  if (sessionToken === null) return problem("AUTHENTICATION_REQUIRED", 401);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return problem("INVITE_INVALID", 400);
  }
  const inviteCode = parsedInviteCode(rawBody);
  if (inviteCode === null) return problem("INVITE_INVALID", 400);

  let verifierSha256: `sha256:${string}`;
  try {
    verifierSha256 = await hashInviteCode(inviteCode);
  } catch (error) {
    if (error instanceof SharedAdmissionError && error.code === "INVITE_INVALID") {
      return problem("INVITE_INVALID", 400);
    }
    throw error;
  }

  // The raw verifier is not passed past this point and is never included in response or evidence.
  const outcome = await dependencies.redeem(sessionToken, verifierSha256);
  switch (outcome) {
    case "ADMITTED":
    case "RETURNING":
      return response({ schema_version: HOSTED_INVITE_REDEMPTION_SCHEMA, outcome }, 200);
    case "AUTHENTICATION_REQUIRED":
      return problem(outcome, 401);
    case "EMAIL_VERIFICATION_REQUIRED":
    case "AUTH_METHOD_UNSUPPORTED":
    case "INVITE_EMAIL_MISMATCH":
      return problem(outcome, 403);
    case "INVITE_ALREADY_USED":
      return problem(outcome, 409);
    case "INVITE_EXPIRED":
    case "INVITE_REVOKED":
      return problem(outcome, 410);
    case "INVITE_INVALID":
      return problem(outcome, 400);
  }
}
