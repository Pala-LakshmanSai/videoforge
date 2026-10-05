import { canViewCentralizedLibrary } from "./centralized-library";
import { createHostedAuth, type HostedExecutionContext } from "./auth";
import { createNeonExecutor, createNeonPool } from "./neon";
import { hostedRuntimeConfiguration, type HostedRuntimeConfiguration } from "./configuration";
import { hashInviteCode } from "@videoforge/control-plane";
import { parseHostedJson, plainRecord, response } from "./hosted-product-route-common";

export const TEAM_ACCESS_PATH = "/api/v2/team-access";
export const TEAM_MANAGERS = ["lakshman121@gmail.com", "demo9gss@gmail.com"] as const;
export function canManageTeam(email: string): boolean {
  return TEAM_MANAGERS.some((manager) => manager === email.trim().toLowerCase());
}

interface TeamDependencies {
  readonly publicOrigin: string;
  authenticate(request: Request): Promise<{ token: string; email: string } | Response>;
  execute(
    token: string,
    operation: string,
    target: string | null,
    verifier: string | null,
  ): Promise<Record<string, unknown>>;
}
export async function handleTeamAccess(
  request: Request,
  deps: TeamDependencies,
): Promise<Response> {
  if (!["GET", "POST"].includes(request.method))
    return response({ error: { code: "TEAM_METHOD_INVALID" } }, 405);
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== new URL(deps.publicOrigin).origin
  )
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const identity = await deps.authenticate(request);
  if (identity instanceof Response) return identity;
  if (!canManageTeam(identity.email))
    return response({ error: { code: "TEAM_ACCESS_FORBIDDEN" } }, 403);
  let operation = "LIST",
    target: string | null = null,
    code: string | undefined;
  let verifier: string | null = null;
  if (request.method === "POST") {
    const parsed = await parseHostedJson(request, "TEAM_OPERATION_INVALID", 4096);
    if (parsed instanceof Response) return parsed;
    const body = plainRecord(parsed);
    if (
      !body ||
      Object.keys(body).sort().join(",") !== "operation,target" ||
      typeof body.target !== "string" ||
      body.target.length > 320 ||
      !["INVITE", "REVOKE", "RESTORE", "REVOKE_INVITE"].includes(String(body.operation))
    )
      return response({ error: { code: "TEAM_OPERATION_INVALID" } }, 400);
    operation = String(body.operation);
    target = body.target.trim();
    if (operation === "INVITE") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(target))
        return response({ error: { code: "TEAM_INVITE_INVALID" } }, 400);
      code = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      verifier = await hashInviteCode(code);
    }
  }
  try {
    const result = await deps.execute(identity.token, operation, target, verifier);
    if (typeof result.error === "string") {
      const status =
        result.error === "TEAM_ACCESS_FORBIDDEN" || result.error === "TEAM_OWNER_PROTECTED"
          ? 403
          : result.error === "TEAM_MEMBER_NOT_FOUND"
            ? 404
            : result.error === "TEAM_ALREADY_ADMITTED" || result.error === "TEAM_INVITE_NOT_ACTIVE"
              ? 409
              : 400;
      return response({ error: { code: result.error } }, status);
    }
    return response({ ...result, ...(code ? { code } : {}) }, code ? 201 : 200);
  } catch {
    // Never echo database details or invitation material in errors.
    return response({ error: { code: "TEAM_ACCESS_UNAVAILABLE" } }, 503);
  }
}

export async function handleHostedTeamAccess(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    return await handleTeamAccess(request, {
      publicOrigin: config.publicOrigin,
      authenticate: async (candidate) => {
        const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
          headers: candidate.headers,
        });
        if (!session?.user?.id)
          return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
        const scoped = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
          session.session.token,
        ]);
        if (!scoped.rows[0] || session.user.emailVerified !== true)
          return response({ error: { code: "TEAM_ACCESS_FORBIDDEN" } }, 403);
        if (!canManageTeam(session.user.email))
          return response({ error: { code: "TEAM_ACCESS_FORBIDDEN" } }, 403);
        const rate = await pool.query<{ allowed: boolean }>(
          `SELECT videoforge_consume_hosted_rate_limit($1,$2) AS allowed`,
          [session.session.token, candidate.method === "GET" ? "hosted_read" : "hosted_mutation"],
        );
        if (!rate.rows[0]?.allowed)
          return response({ error: { code: "HOSTED_RATE_LIMITED" } }, 429);
        return { token: session.session.token, email: session.user.email };
      },
      execute: async (token, operation, target, verifier) => {
        const result = await pool.query(
          `SELECT videoforge_manage_team_access($1,$2,$3,$4) AS result`,
          [token, operation, target, verifier],
        );
        return result.rows[0]?.result as Record<string, unknown>;
      },
    });
  } finally {
    await pool.end();
  }
}

export async function handleTenantApi(
  request: Request,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
      headers: request.headers,
    });
    if (!session?.user?.id) return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const scope = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
      session.session.token,
    ]);
    const row = scope.rows[0];
    if (!row) return response({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    const workspaceName = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        row.account_id,
      ]);
      const workspace = await transaction.query(`SELECT name FROM workspaces WHERE id = $1`, [
        row.workspace_id,
      ]);
      return workspace.rows[0]?.name;
    });
    return response({
      schema_version: "videoforge-hosted-tenant/v1",
      account_id: row.account_id,
      workspace_id: row.workspace_id,
      workspace_name: workspaceName ?? "My workspace",
      user: { id: session.user.id, email: session.user.email, name: session.user.name },
      rights: "EQUAL",
      can_view_centralized_library:
        session.user.emailVerified === true && canViewCentralizedLibrary(session.user.email),
      can_manage_team: session.user.emailVerified === true && canManageTeam(session.user.email),
    });
  } finally {
    await pool.end();
  }
}
