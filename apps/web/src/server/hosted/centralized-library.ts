import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonPool } from "./neon";
import { response } from "./hosted-product-route-common";
import { serveHostedVideo } from "./serve-video";
import {
  deleteHostedR2ObjectsAndVerify,
  hostedCompleteAttemptArtifactKeys,
  hostedJobArtifactPrefix,
} from "./r2";
import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";

export const CENTRALIZED_LIBRARY_OWNER = "demo9gss@gmail.com";
export function canViewCentralizedLibrary(email: string): boolean {
  return email.trim().toLowerCase() === CENTRALIZED_LIBRARY_OWNER;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
interface LibraryRow {
  attempt_id: string;
  project_id: string;
  title: string;
  created_at: string;
  object_key: string;
  content_length: number;
  checksum_sha256: string;
  voiceover_filename: string | null;
  video_details?: import("../../lib/library-video-details").VideoDetails;
  creator_id: string;
  creator_name: string;
  creator_email: string;
}
interface LibraryData {
  error?: string;
  outputs: LibraryRow[];
  total: number;
  total_videos: number;
  total_bytes: number;
  creators: { creator_id: string; creator_name: string; creator_email: string }[];
}
interface Dependencies {
  publicOrigin?: string;
  remove?(
    token: string,
    attempt: string,
    facts: string | null,
  ): Promise<{
    error?: string;
    deleted?: boolean;
    artifact_prefix?: string;
    job_spec_object_key?: string;
    object_keys?: string[];
  }>;
  authenticate(
    request: Request,
  ): Promise<{ token: string; email: string; verified: boolean } | Response>;
  read(
    token: string,
    attempt: string | null,
    search: string,
    creator: string | null,
    offset: number,
  ): Promise<LibraryData>;
  bucket?: HostedRuntimeEnvironment["PRIVATE_ARTIFACTS"];
}
export async function handleCentralizedLibrary(
  request: Request,
  deps: Dependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const deletion = /^\/api\/v2\/centralized-library\/([^/]+)$/u.exec(url.pathname);
  const deleting = request.method === "DELETE" && deletion;
  if (request.method !== "GET" && !deleting)
    return response({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  if (deleting && request.headers.get("origin") !== new URL(deps.publicOrigin ?? url.origin).origin)
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const identity = await deps.authenticate(request);
  if (identity instanceof Response) return identity;
  if (!identity.verified || !canViewCentralizedLibrary(identity.email))
    return response({ error: { code: "CENTRALIZED_LIBRARY_FORBIDDEN" } }, 403);
  if (deleting) {
    if (!UUID.test(deletion[1]!)) return response({ error: { code: "VIDEO_NOT_FOUND" } }, 404);
    if (!deps.bucket || !deps.remove)
      return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
    try {
      const plan = await deps.remove(identity.token, deletion[1]!, null);
      if (plan.error)
        return response(
          { error: { code: plan.error } },
          plan.error === "CENTRALIZED_LIBRARY_FORBIDDEN" ? 403 : 404,
        );
      if (plan.deleted) return new Response(null, { status: 204 });
      const keys = hostedCompleteAttemptArtifactKeys(
        plan.job_spec_object_key,
        plan.object_keys ?? [],
      );
      if (keys.length !== 3)
        return response({ error: { code: "CPU_ATTEMPT_OUTPUT_INCOMPLETE" } }, 409);
      if (hostedJobArtifactPrefix(keys[0]!) !== plan.artifact_prefix)
        return response({ error: { code: "CPU_ATTEMPT_OUTPUT_INCOMPLETE" } }, 409);
      const verification = await deleteHostedR2ObjectsAndVerify(
        deps.bucket,
        hostedJobArtifactPrefix(keys[0]!),
        keys,
      );
      const facts = await sha256(
        canonicalJson({
          attempt_id: deletion[1],
          actor: identity.email,
          deleted_keys: keys,
          post_delete_verification: verification,
          reason: "CENTRALIZED_OWNER_DELETE",
        }),
      );
      const finished = await deps.remove(identity.token, deletion[1]!, facts);
      if (!finished.deleted)
        return response(
          { error: { code: finished.error ?? "VIDEO_DELETE_FAILED" } },
          finished.error === "CENTRALIZED_LIBRARY_FORBIDDEN" ? 403 : 409,
        );
      return new Response(null, { status: 204 });
    } catch {
      return response(
        {
          error: {
            code: "VIDEO_DELETE_FAILED",
            message: "Deletion could not be verified. Retry this video.",
          },
        },
        503,
      );
    }
  }
  const media = /^\/api\/v2\/centralized-library\/([^/]+)\/(watch|download)$/u.exec(url.pathname);
  if (url.pathname !== "/api/v2/centralized-library" && !media)
    return response({ error: { code: "VIDEO_NOT_FOUND" } }, 404);
  const search = url.searchParams.get("search") ?? "";
  const creator = url.searchParams.get("creator");
  const page = url.searchParams.get("page") ?? "0";
  if (
    media
      ? !UUID.test(media[1]!)
      : search.length > 200 ||
        (creator !== null && !UUID.test(creator)) ||
        !/^\d{1,8}$/u.test(page) ||
        Number(page) > 44_739_242
  )
    return response({ error: { code: "CENTRALIZED_LIBRARY_QUERY_INVALID" } }, 400);
  if (!deps.bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  try {
    // Database rechecks the admitted, verified, non-revoked session and exact owner email.
    const data = await deps.read(
      identity.token,
      media?.[1] ?? null,
      media ? "" : search,
      media ? null : creator,
      media ? 0 : Number(page) * 48,
    );
    if (data.error)
      return response(
        { error: { code: data.error } },
        data.error === "CENTRALIZED_LIBRARY_FORBIDDEN" ? 403 : 400,
      );
    if (media)
      return await serveHostedVideo(request, deps.bucket, data.outputs[0], media[2] === "watch");
    const outputs = await Promise.all(
      data.outputs.map(async (output) => {
        const head = await deps.bucket!.head(output.object_key);
        const hash = head?.checksums?.sha256;
        const checksum = hash
          ? `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
          : null;
        const available =
          head?.size === Number(output.content_length) &&
          head?.httpMetadata?.contentType === "video/mp4" &&
          (checksum === null || checksum === output.checksum_sha256);
        const { object_key: _key, voiceover_filename: _filename, ...visible } = output;
        return {
          ...visible,
          available,
          watch_url: `/api/v2/centralized-library/${output.attempt_id}/watch`,
          download_url: `/api/v2/centralized-library/${output.attempt_id}/download`,
        };
      }),
    );
    return response({
      schema_version: "videoforge-centralized-library/v1",
      outputs,
      total: data.total,
      total_videos: data.total_videos,
      total_bytes: data.total_bytes,
      creators: data.creators,
      page: Number(page),
      page_size: 48,
    });
  } catch {
    return response({ error: { code: "CENTRALIZED_LIBRARY_UNAVAILABLE" } }, 503);
  }
}
export async function handleHostedCentralizedLibrary(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    return await handleCentralizedLibrary(request, {
      publicOrigin: config.publicOrigin,
      bucket: environment.PRIVATE_ARTIFACTS,
      remove: async (token, attempt, facts) => {
        const result = await pool.query(
          "SELECT videoforge_delete_centralized_video($1,$2,$3) AS result",
          [token, attempt, facts],
        );
        return result.rows[0]!.result;
      },
      authenticate: async (candidate) => {
        const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
          headers: candidate.headers,
        });
        if (!session?.user?.id)
          return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
        if (session.user.emailVerified !== true || !canViewCentralizedLibrary(session.user.email))
          return response({ error: { code: "CENTRALIZED_LIBRARY_FORBIDDEN" } }, 403);
        const rate = await pool.query<{ allowed: boolean }>(
          "SELECT videoforge_consume_hosted_rate_limit($1,$2) AS allowed",
          [
            session.session.token,
            candidate.method === "DELETE" ? "hosted_mutation" : "hosted_read",
          ],
        );
        if (!rate.rows[0]?.allowed)
          return response({ error: { code: "HOSTED_RATE_LIMITED" } }, 429);
        return { token: session.session.token, email: session.user.email, verified: true };
      },
      read: async (token, attempt, search, creator, offset) => {
        const result = await pool.query<{ result: LibraryData }>(
          "SELECT videoforge_read_centralized_library($1,$2,$3,$4,$5) AS result",
          [token, attempt, search, creator, offset],
        );
        return result.rows[0]!.result;
      },
    });
  } finally {
    await pool.end();
  }
}
