import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import type { HostedExecutionContext } from "./auth";
import { createNeonPool } from "./neon";
import {
  parseHostedJson,
  plainRecord,
  response,
  sameOrigin,
  sessionScope,
} from "./hosted-product-route-common";
import { sha256 } from "./crypto";

const BASE = "https://api.j1tts.com";
const ID = /^[A-Za-z0-9_-]{1,160}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export interface J1Voice {
  imported?: boolean;
  voice_id: string;
  name: string;
  tags: string;
  languages: string;
  preview_url: string | null;
}
export class J1Error extends Error {
  constructor(
    readonly code: string,
    readonly ambiguous = false,
  ) {
    super(code);
  }
}
export async function j1Fetch(
  key: string,
  path: string,
  init: RequestInit = {},
  fetcher = fetch,
): Promise<Response> {
  try {
    const result = await fetcher(BASE + path, {
      ...init,
      redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "VideoForge/1.0", ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (!result.ok)
      throw new J1Error(
        result.status === 429
          ? "J1TTS_RATE_LIMITED"
          : result.status === 401 || result.status === 403
            ? "J1TTS_ACCESS_REJECTED"
            : "J1TTS_UNAVAILABLE",
        init.method === "POST" && result.status >= 500,
      );
    return result;
  } catch (error) {
    if (error instanceof J1Error) throw error;
    throw new J1Error("J1TTS_NETWORK_UNCERTAIN", init.method === "POST");
  }
}
export function parseJ1Voices(value: unknown): J1Voice[] {
  const list = Array.isArray(value) ? value : plainRecord(value)?.voices;
  if (!Array.isArray(list)) throw new J1Error("J1TTS_INVALID_RESPONSE");
  return list.flatMap((value) => {
    const v = plainRecord(value);
    return v && typeof v.voice_id === "string" && ID.test(v.voice_id) && typeof v.name === "string"
      ? [
          {
            voice_id: v.voice_id,
            name: v.name.slice(0, 240),
            tags: typeof v.tags === "string" ? v.tags.slice(0, 500) : "",
            languages: typeof v.languages === "string" ? v.languages.slice(0, 500) : "",
            preview_url: typeof v.preview_url === "string" ? v.preview_url : null,
          },
        ]
      : [];
  });
}
let cached: { key: string; until: number; voices: J1Voice[] } | undefined;
async function voices(key: string) {
  if (cached?.key === key && cached.until > Date.now()) return cached.voices;
  const [global, imported] = await Promise.all([
    j1Fetch(key, "/v1/voices").then((r) => r.json()),
    j1Fetch(key, "/v1/my-voices").then((r) => r.json()),
  ]);
  const all = [
    ...new Map(
      [
        ...parseJ1Voices(global),
        ...parseJ1Voices(imported).map((v) => ({ ...v, imported: true })),
      ].map((v) => [v.voice_id, v]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  cached = { key, until: Date.now() + 300_000, voices: all };
  return all;
}
interface Job {
  id: string;
  state: string;
  filename: string;
  voice_id: string;
  provider_job_id: string | null;
  failure_code: string | null;
  created_at: string;
}
export function publicVoiceoverJob(job: Job | null) {
  if (!job) return null;
  return {
    id: job.id,
    state: job.state,
    filename: job.filename,
    voice_id: job.voice_id,
    failure_code: job.failure_code,
    created_at: job.created_at,
    audio_url: job.state === "COMPLETED" ? `/api/v2/voiceovers/jobs/${job.id}/audio` : null,
  };
}
export async function observeJ1Voiceover(
  env: HostedRuntimeEnvironment,
  target: { accountId: string; workspaceId: string; jobId: string },
): Promise<string> {
  const pool = createNeonPool(env.DATABASE_URL!);
  try {
    const args = [target.accountId, target.workspaceId, target.jobId];
    const job = (
      await pool.query<{ job: Job }>(
        "WITH bound AS (SELECT set_config('videoforge.account_id',($1::uuid)::text,true)) SELECT public.videoforge_read_voiceover_job($1,$2,$3) AS job FROM bound",
        args,
      )
    ).rows[0]?.job;
    if (!job) return "MISSING";
    if (job.provider_job_id && ["PROCESSING", "UNKNOWN_NO_RETRY"].includes(job.state)) {
      const result = plainRecord(
        await (
          await j1Fetch(env.J1TTS_API_KEY!, `/v1/tts/${encodeURIComponent(job.provider_job_id)}`)
        ).json(),
      );
      if (result?.id !== job.provider_job_id) throw new J1Error("J1TTS_INVALID_RESPONSE");
      if (result.status === "completed" || result.status === "failed") {
        const state = result.status === "completed" ? "COMPLETED" : "FAILED";
        await pool.query(
          "WITH bound AS (SELECT set_config('videoforge.account_id',($1::uuid)::text,true)) SELECT public.videoforge_record_voiceover_job($1,$2,$3,$4,$5,$6) FROM bound",
          [
            ...args,
            state,
            job.provider_job_id,
            state === "FAILED" ? "J1TTS_GENERATION_FAILED" : null,
          ],
        );
        return state;
      }
    }
    if (job.state === "SUBMITTING" && Date.now() - Date.parse(job.created_at) > 120_000) {
      await pool.query(
        "WITH bound AS (SELECT set_config('videoforge.account_id',($1::uuid)::text,true)) SELECT public.videoforge_record_voiceover_job($1,$2,$3,'UNKNOWN_NO_RETRY',NULL,'J1TTS_NETWORK_UNCERTAIN') FROM bound",
        args,
      );
      return "UNKNOWN_NO_RETRY";
    }
    return job.state;
  } finally {
    await pool.end();
  }
}
async function ensureVoiceoverObserver(
  env: HostedRuntimeEnvironment,
  accountId: string,
  workspaceId: string,
  jobId: string,
) {
  try {
    await env.HOSTED_CONTINUATION_WORKFLOW?.create({
      id: `voiceover-${jobId}`,
      params: { reason: "voiceover-observer", voiceover: { accountId, workspaceId, jobId } },
    });
  } catch {
    /* The exact job remains saved; reads and the periodic driver also reconcile it. */
  }
}
export async function handleJ1Voiceover(
  request: Request,
  env: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  context: HostedExecutionContext,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!["GET", "POST"].includes(request.method))
    return response({ error: { code: "VOICEOVER_METHOD_INVALID" } }, 405);
  if (request.method === "POST" && !sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, context);
    if (scope instanceof Response) return scope;
    const key = env.J1TTS_API_KEY?.trim();
    if (!key)
      return response(
        {
          error: {
            code: "J1TTS_NOT_CONFIGURED",
            message: "Voice generation is currently unavailable. Upload a voiceover or try later.",
          },
        },
        503,
      );
    const sql = async <T>(query: string, args: unknown[] = []) =>
      (
        await pool.query<{ value: T }>(
          query
            .replace(
              "SELECT public.",
              "WITH bound AS (SELECT set_config('videoforge.account_id',($1::uuid)::text,true)) SELECT public.",
            )
            .replace(" AS value", " AS value FROM bound"),
          args,
        )
      ).rows[0]?.value;
    const owner = [scope.account_id, scope.workspace_id];
    const saved =
      (await sql<{ voice_id: string; starred: boolean; saved: boolean; imported: boolean }[]>(
        "SELECT public.videoforge_saved_voices($1,$2) AS value",
        owner,
      )) ?? [];
    const savedMap = new Map(saved.map((v) => [v.voice_id, v]));
    const permitted = (voice: J1Voice) =>
      !voice.imported ||
      scope.account_id === env.J1TTS_LIBRARY_OWNER_ACCOUNT_ID ||
      savedMap.get(voice.voice_id)?.imported === true;
    if (path === "/api/v2/voiceovers/import" && request.method === "POST") {
      const parsed = await parseHostedJson(request, "VOICE_IMPORT_INVALID", 1024);
      if (parsed instanceof Response) return parsed;
      const body = plainRecord(parsed);
      if (
        !body ||
        Object.keys(body).join() !== "voice_id" ||
        typeof body.voice_id !== "string" ||
        !ID.test(body.voice_id)
      )
        return response(
          {
            error: { code: "VOICE_IMPORT_INVALID", message: "Enter a valid ElevenLabs voice ID." },
          },
          400,
        );
      await j1Fetch(key, "/v1/voices/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice_ids: body.voice_id }),
      });
      cached = undefined;
      const voice = (await voices(key)).find((v) => v.voice_id === body.voice_id);
      if (!voice)
        return response(
          {
            error: {
              code: "VOICE_IMPORT_UNAVAILABLE",
              message: "The provider has not made this voice available yet.",
            },
          },
          502,
        );
      await sql("SELECT public.videoforge_import_voice($1,$2,$3) AS value", [
        ...owner,
        voice.voice_id,
      ]);
      return response({ voice_id: voice.voice_id });
    }
    if (path === "/api/v2/voiceovers/voices" && request.method === "GET") {
      const all = (await voices(key)).filter(permitted);
      return response({
        voices: all.map((v) => ({
          ...v,
          preview_url: v.preview_url ? `/api/v2/voiceovers/voices/${v.voice_id}/preview` : null,
          saved: savedMap.get(v.voice_id)?.saved ?? false,
          starred: savedMap.get(v.voice_id)?.starred ?? false,
        })),
      });
    }
    const voicePath = /^\/api\/v2\/voiceovers\/voices\/([A-Za-z0-9_-]{1,160})(\/preview)?$/u.exec(
      path,
    );
    if (voicePath) {
      const voice = (await voices(key)).find((v) => v.voice_id === voicePath[1] && permitted(v));
      if (!voice) return response({ error: { code: "VOICE_NOT_FOUND" } }, 404);
      if (voicePath[2] && request.method === "GET") {
        if (!voice.preview_url)
          return response({ error: { code: "VOICE_PREVIEW_UNAVAILABLE" } }, 404);
        const url = new URL(voice.preview_url, BASE);
        if (
          url.protocol !== "https:" ||
          !["api.j1tts.com", "api.us.elevenlabs.io", "storage.googleapis.com"].includes(
            url.hostname,
          ) ||
          url.username ||
          url.password
        )
          return response({ error: { code: "VOICE_PREVIEW_UNAVAILABLE" } }, 502);
        const preview =
          url.origin === BASE
            ? await j1Fetch(key, url.pathname + url.search)
            : await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!preview.ok) return response({ error: { code: "VOICE_PREVIEW_UNAVAILABLE" } }, 502);
        return new Response(preview.body, {
          headers: {
            "content-type": "audio/mpeg",
            "cache-control": "private, max-age=300",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (!voicePath[2] && request.method === "POST") {
        const parsed = await parseHostedJson(request, "VOICE_SAVE_INVALID", 1024);
        if (parsed instanceof Response) return parsed;
        const b = plainRecord(parsed);
        if (
          !b ||
          Object.keys(b).sort().join() !== "saved,starred" ||
          typeof b.saved !== "boolean" ||
          typeof b.starred !== "boolean" ||
          (b.starred && !b.saved)
        )
          return response({ error: { code: "VOICE_SAVE_INVALID" } }, 400);
        await sql("SELECT public.videoforge_save_voice($1,$2,$3,$4,$5) AS value", [
          ...owner,
          voice.voice_id,
          b.saved,
          b.starred,
        ]);
        return response({ saved: b.saved, starred: b.starred });
      }
    }
    const match = /^\/api\/v2\/voiceovers\/jobs\/([0-9a-f-]{36})(\/audio)?$/u.exec(path);
    const read = async (id: string | null) =>
      (await sql<Job | null>("SELECT public.videoforge_read_voiceover_job($1,$2,$3) AS value", [
        ...owner,
        id,
      ])) ?? null;
    const record = async (
      id: string,
      state: string,
      providerId: string | null,
      code: string | null,
    ) =>
      await sql<Job>("SELECT public.videoforge_record_voiceover_job($1,$2,$3,$4,$5,$6) AS value", [
        ...owner,
        id,
        state,
        providerId,
        code,
      ]);
    if (path === "/api/v2/voiceovers/jobs" && request.method === "POST") {
      const parsed = await parseHostedJson(request, "SCRIPT_INVALID", 450_000);
      if (parsed instanceof Response) return parsed;
      const b = plainRecord(parsed);
      if (
        !b ||
        Object.keys(b).sort().join() !== "filename,id,script,voice_id" ||
        typeof b.id !== "string" ||
        !UUID.test(b.id) ||
        typeof b.script !== "string" ||
        !b.script.trim() ||
        b.script.length > 100_000 ||
        typeof b.voice_id !== "string" ||
        !ID.test(b.voice_id) ||
        typeof b.filename !== "string" ||
        !/^[A-Za-z0-9._-]{1,150}\.mp3$/u.test(b.filename)
      )
        return response(
          {
            error: {
              code: "SCRIPT_INVALID",
              message: "Choose a voice and enter a script of up to 100,000 characters.",
            },
          },
          400,
        );
      const hash = await sha256(JSON.stringify([b.script, b.voice_id, b.filename]));
      const existing = await read(b.id);
      // The DB also checks request hash on an idempotent lookup; no provider call precedes it.
      if (!existing && !(await voices(key)).some((v) => v.voice_id === b.voice_id && permitted(v)))
        return response({ error: { code: "VOICE_NOT_FOUND" } }, 400);
      let started: { claimed: boolean; job: Job } | undefined;
      try {
        started = await sql(
          "SELECT public.videoforge_start_voiceover_job($1,$2,$3,$4,$5,$6,$7) AS value",
          [...owner, b.id, hash, b.script, b.voice_id, b.filename],
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        return response(
          {
            error: {
              code: message.includes("VOICEOVER_CAPACITY_BUSY")
                ? "VOICEOVER_CAPACITY_BUSY"
                : "VOICEOVER_REQUEST_CONFLICT",
              message: message.includes("VOICEOVER_CAPACITY_BUSY")
                ? "Another generation is running. Try again when it finishes."
                : "This request is already saved with different inputs.",
            },
          },
          409,
        );
      }
      await ensureVoiceoverObserver(env, scope.account_id, scope.workspace_id, b.id);
      if (!started?.claimed)
        return response({ job: publicVoiceoverJob(started?.job ?? null) }, 200);
      try {
        const result = plainRecord(
          await (
            await j1Fetch(key, "/v1/tts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: b.script, voice_id: b.voice_id, file_name: b.filename }),
            })
          ).json(),
        );
        if (!result || typeof result.id !== "string" || !ID.test(result.id))
          throw new J1Error("J1TTS_INVALID_RESPONSE", true);
        const job = await record(b.id, "PROCESSING", result.id, null);
        return response({ job: publicVoiceoverJob(job ?? started.job) }, 202);
      } catch (error) {
        const uncertain = !(error instanceof J1Error) || error.ambiguous;
        const code = error instanceof J1Error ? error.code : "J1TTS_NETWORK_UNCERTAIN";
        const job = await record(b.id, uncertain ? "UNKNOWN_NO_RETRY" : "FAILED", null, code);
        return response({ job: publicVoiceoverJob(job ?? started.job) }, 202);
      }
    }
    if (request.method === "GET" && (path === "/api/v2/voiceovers/jobs" || match)) {
      let job = await read(match?.[1] ?? null);
      if (!job)
        return match
          ? response({ error: { code: "VOICEOVER_NOT_FOUND" } }, 404)
          : response({ job: null });
      if (match?.[2]) {
        if (job.state !== "COMPLETED" || !job.provider_job_id)
          return response({ error: { code: "VOICEOVER_NOT_READY" } }, 409);
        const audio = await j1Fetch(
          key,
          `/v1/tts/${encodeURIComponent(job.provider_job_id)}/download`,
        );
        const type = audio.headers.get("content-type") ?? "";
        const length = Number(audio.headers.get("content-length") ?? 0);
        if (type.includes("text/") || type.includes("json") || length > 1_073_741_824)
          return response({ error: { code: "J1TTS_INVALID_AUDIO" } }, 502);
        return new Response(audio.body, {
          headers: {
            "content-type": "audio/mpeg",
            "cache-control": "no-store",
            "content-disposition": `attachment; filename="${job.filename}"`,
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (job.provider_job_id && !["COMPLETED", "FAILED"].includes(job.state)) {
        const status = plainRecord(
          await (await j1Fetch(key, `/v1/tts/${encodeURIComponent(job.provider_job_id)}`)).json(),
        );
        if (status?.id !== job.provider_job_id) throw new J1Error("J1TTS_INVALID_RESPONSE");
        if (status.status === "completed" || status.status === "failed")
          job =
            (await record(
              job.id,
              status.status === "completed" ? "COMPLETED" : "FAILED",
              job.provider_job_id,
              status.status === "failed" ? "J1TTS_GENERATION_FAILED" : null,
            )) ?? job;
      } else if (job.state === "SUBMITTING" && Date.now() - Date.parse(job.created_at) > 120_000) {
        job = (await record(job.id, "UNKNOWN_NO_RETRY", null, "J1TTS_NETWORK_UNCERTAIN")) ?? job;
      }
      return response({ job: publicVoiceoverJob(job) });
    }
    return response({ error: { code: "VOICEOVER_NOT_FOUND" } }, 404);
  } catch (error) {
    return response(
      {
        error: {
          code: error instanceof J1Error ? error.code : "VOICEOVER_UNAVAILABLE",
          message:
            "Unable to reach voice generation. Your saved request will not be submitted again.",
        },
      },
      503,
    );
  } finally {
    await pool.end();
  }
}

export async function reconcilePendingVoiceovers(env: HostedRuntimeEnvironment): Promise<number> {
  if (!env.J1TTS_API_KEY || !env.DATABASE_URL) return 0;
  const pool = createNeonPool(env.DATABASE_URL);
  let jobs: { accountId: string; workspaceId: string; jobId: string }[];
  try {
    jobs =
      (
        await pool.query<{ jobs: typeof jobs }>(
          "SELECT public.videoforge_pending_voiceover_jobs() AS jobs",
        )
      ).rows[0]?.jobs ?? [];
  } finally {
    await pool.end();
  }
  for (const job of jobs.slice(0, 2)) {
    try {
      await observeJ1Voiceover(env, job);
    } catch {
      /* A retrieval failure cannot authorize a replacement submission. */
    }
  }
  return jobs.length;
}
