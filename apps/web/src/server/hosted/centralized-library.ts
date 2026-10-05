import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonPool } from "./neon";
import { response } from "./hosted-product-route-common";
import { serveHostedVideo } from "./serve-video";

export const CENTRALIZED_LIBRARY_OWNER = "demo9gss@gmail.com";
export function canViewCentralizedLibrary(email: string): boolean {
  return email.trim().toLowerCase() === CENTRALIZED_LIBRARY_OWNER;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
interface LibraryRow {
  attempt_id: string;
  project_id: string;
  title: string;
  created_at: string;
  object_key: string;
  content_length: number;
  checksum_sha256: string;
  voiceover_filename: string | null;
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
  if (request.method !== "GET") return response({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  const identity = await deps.authenticate(request);
  if (identity instanceof Response) return identity;
  if (!identity.verified || !canViewCentralizedLibrary(identity.email))
    return response({ error: { code: "CENTRALIZED_LIBRARY_FORBIDDEN" } }, 403);
  const url = new URL(request.url);
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
      bucket: environment.PRIVATE_ARTIFACTS,
      authenticate: async (candidate) => {
        const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
          headers: candidate.headers,
        });
        if (!session?.user?.id)
          return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
        if (session.user.emailVerified !== true || !canViewCentralizedLibrary(session.user.email))
          return response({ error: { code: "CENTRALIZED_LIBRARY_FORBIDDEN" } }, 403);
        const rate = await pool.query<{ allowed: boolean }>(
          "SELECT videoforge_consume_hosted_rate_limit($1,'hosted_read') AS allowed",
          [session.session.token],
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
