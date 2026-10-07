import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonPool } from "./neon";
import { response, sameOrigin } from "./hosted-product-route-common";
import { canViewCentralizedLibrary } from "./centralized-library";
import { serveHostedVideo } from "./serve-video";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_VOICEOVER_DOWNLOAD_STEM = 140;

function voiceoverDownloadFilename(title: unknown): string {
  const source = typeof title === "string" ? title.trim() : "";
  const safe = Array.from(source, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "/" ||
      character === "\\" ||
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? "_"
      : character;
  }).join("");
  const stem = Array.from(safe).slice(0, MAX_VOICEOVER_DOWNLOAD_STEM).join("").trim();
  return `${stem || "voiceover"}.mp3`;
}

export interface VoiceoverLibraryRow {
  id: string;
  title: string;
  voice_name: string;
  voice_id: string;
  state: string;
  filename: string;
  created_at: string;
  script: string;
  character_count: number;
  duration_ms: number | null;
  content_length: number | null;
  checksum_sha256: string | null;
  object_key: string | null;
  creator_id: string;
  creator_name: string;
  creator_email: string;
}
interface LibraryData {
  error?: string;
  voiceovers: VoiceoverLibraryRow[];
  creators: { id: string; name: string; email: string }[];
  total?: number;
}
interface Dependencies {
  publicOrigin: string;
  bucket?: HostedRuntimeEnvironment["PRIVATE_ARTIFACTS"];
  authenticate(
    request: Request,
  ): Promise<{ token: string; email: string; verified: boolean } | Response>;
  read(
    token: string,
    centralized: boolean,
    id: string | null,
    search: string,
    creator: string | null,
    offset: number,
  ): Promise<LibraryData>;
  remove(
    token: string,
    centralized: boolean,
    id: string,
    finalize: boolean,
  ): Promise<{ error?: string; deleted?: boolean; object_key?: string | null }>;
}
export async function handleVoiceoverLibrary(
  request: Request,
  deps: Dependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/v2\/voiceovers\/library\/([^/]+)\/(audio|delete)$/u.exec(url.pathname);
  const deleting = request.method === "POST" && match?.[2] === "delete";
  if (request.method !== "GET" && !deleting)
    return response({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  if (url.pathname !== "/api/v2/voiceovers/library" && !match)
    return response({ error: { code: "VOICEOVER_NOT_FOUND" } }, 404);
  if (match && (!UUID.test(match[1]!) || (match[2] === "delete" && !deleting)))
    return response({ error: { code: "VOICEOVER_NOT_FOUND" } }, 404);
  if (
    deleting &&
    !sameOrigin(request, { publicOrigin: deps.publicOrigin } as HostedRuntimeConfiguration)
  )
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const centralized = url.searchParams.get("centralized") === "1";
  const search = url.searchParams.get("search") ?? "";
  const creator = url.searchParams.get("creator");
  const page = url.searchParams.get("page") ?? "0";
  if (search.length > 200 || (creator !== null && !UUID.test(creator)) || !/^\d{1,6}$/u.test(page))
    return response({ error: { code: "VOICEOVER_QUERY_INVALID" } }, 400);
  const identity = await deps.authenticate(request);
  if (identity instanceof Response) return identity;
  if (centralized && (!identity.verified || !canViewCentralizedLibrary(identity.email)))
    return response({ error: { code: "CENTRALIZED_LIBRARY_FORBIDDEN" } }, 403);
  if (!deps.bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  try {
    if (deleting) {
      const plan = await deps.remove(identity.token, centralized, match![1]!, false);
      if (plan.error)
        return response(
          { error: { code: plan.error } },
          plan.error.includes("FORBIDDEN") ? 403 : 409,
        );
      if (plan.deleted) return new Response(null, { status: 204 });
      if (plan.object_key) {
        // The database returns only this exact authorized job's immutable artifact.
        if (
          !/^tenant\/[0-9a-f-]{36}\/workspace\/[0-9a-f-]{36}\/voiceover\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.mp3$/u.test(
            plan.object_key,
          )
        )
          throw new Error("VOICEOVER_ARTIFACT_INVALID");
        const prefix = plan.object_key.slice(0, plan.object_key.lastIndexOf("/") + 1);
        // Completed immutable archives cannot be claimed again. Include abandoned upload claims.
        const keys = new Set([plan.object_key]);
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
          const page = await deps.bucket.list({ prefix, cursor, limit: 1000 });
          for (const object of page.objects) {
            if (
              !object.key.startsWith(prefix) ||
              !/^[0-9a-f-]{36}\.mp3$/u.test(object.key.slice(prefix.length))
            )
              throw new Error("VOICEOVER_ARTIFACT_INVALID");
            keys.add(object.key);
          }
          if (!page.truncated) break;
          if (!page.cursor || cursors.has(page.cursor))
            throw new Error("VOICEOVER_DELETE_UNVERIFIED");
          cursors.add(page.cursor);
          cursor = page.cursor;
        } while (cursor);
        for (const key of keys) {
          await deps.bucket.delete(key);
          if (await deps.bucket.head(key)) throw new Error("VOICEOVER_DELETE_UNVERIFIED");
        }
        const remaining = await deps.bucket.list({ prefix, limit: 1 });
        if (remaining.objects.length || remaining.truncated)
          throw new Error("VOICEOVER_DELETE_UNVERIFIED");
      }
      const result = await deps.remove(identity.token, centralized, match![1]!, true);
      if (!result.deleted) throw new Error("VOICEOVER_DELETE_UNVERIFIED");
      return new Response(null, { status: 204 });
    }
    const data = await deps.read(
      identity.token,
      centralized,
      match?.[1] ?? null,
      search,
      creator,
      Number(page) * 48,
    );
    if (data.error)
      return response(
        { error: { code: data.error } },
        data.error.includes("FORBIDDEN") ? 403 : 404,
      );
    if (match) {
      const row = data.voiceovers[0];
      if (
        !row?.object_key ||
        !row.checksum_sha256 ||
        !row.content_length ||
        row.state !== "COMPLETED"
      )
        return response({ error: { code: "VOICEOVER_NOT_READY" } }, 404);
      return serveHostedVideo(
        request,
        deps.bucket,
        {
          ...row,
          object_key: row.object_key,
          checksum_sha256: row.checksum_sha256,
          content_length: row.content_length,
          voiceover_filename: row.filename,
        },
        url.searchParams.get("download") !== "1",
        voiceoverDownloadFilename(row.title),
      );
    }
    return response({
      ...data,
      voiceovers: data.voiceovers.map(({ object_key, checksum_sha256, ...row }) => {
        const ready =
          row.state === "COMPLETED" &&
          !!object_key &&
          /^sha256:[0-9a-f]{64}$/u.test(checksum_sha256 ?? "") &&
          Number(row.content_length) > 0 &&
          Number(row.duration_ms) > 0;
        const base = `/api/v2/voiceovers/library/${row.id}/audio${centralized ? "?centralized=1" : ""}`;
        return {
          ...row,
          audio_url: ready ? base : null,
          download_url: ready ? `${base}${centralized ? "&" : "?"}download=1` : null,
        };
      }),
      page: Number(page),
      page_size: 48,
    });
  } catch {
    return response(
      {
        error: {
          code: deleting ? "VOICEOVER_DELETE_FAILED" : "VOICEOVER_LIBRARY_UNAVAILABLE",
          message: deleting
            ? "Deletion could not be verified. Retry this voiceover."
            : "Unable to load voiceovers. Try again.",
        },
      },
      503,
    );
  }
}

export async function handleHostedVoiceoverLibrary(
  request: Request,
  env: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  context: HostedExecutionContext,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    return await handleVoiceoverLibrary(request, {
      publicOrigin: config.publicOrigin,
      bucket: env.PRIVATE_ARTIFACTS,
      authenticate: async (candidate) => {
        const session = await createHostedAuth({
          config,
          pool,
          executionContext: context,
        }).api.getSession({ headers: candidate.headers });
        if (!session?.user?.id)
          return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
        const rate = await pool.query<{ allowed: boolean }>(
          "SELECT videoforge_consume_hosted_rate_limit($1,$2) AS allowed",
          [session.session.token, candidate.method === "POST" ? "hosted_mutation" : "hosted_read"],
        );
        if (!rate.rows[0]?.allowed)
          return response({ error: { code: "HOSTED_RATE_LIMITED" } }, 429);
        return {
          token: session.session.token,
          email: session.user.email,
          verified: session.user.emailVerified === true,
        };
      },
      read: async (...args) =>
        (
          await pool.query<{ result: LibraryData }>(
            "SELECT public.videoforge_read_voiceover_library($1,$2,$3,$4,$5,$6) AS result",
            args,
          )
        ).rows[0]!.result,
      remove: async (...args) =>
        (
          await pool.query<{
            result: { error?: string; deleted?: boolean; object_key?: string | null };
          }>("SELECT public.videoforge_delete_voiceover_library($1,$2,$3,$4) AS result", args)
        ).rows[0]!.result,
    });
  } finally {
    await pool.end();
  }
}
