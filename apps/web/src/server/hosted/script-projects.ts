import type { SqlExecutor } from "@videoforge/control-plane";
import type { HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonPool, createNeonExecutor } from "./neon";
import {
  parseHostedJson,
  plainRecord,
  response,
  sameOrigin,
  sessionScope,
  type HostedScope,
} from "./hosted-product-route-common";
import { canonicalJson } from "./submission";
import { sha256 } from "./crypto";
import {
  parseProjectOptions,
  validateScriptProjectPresets,
  createProject,
  commitProject,
} from "./product";
import { voices, j1Fetch, J1Error, observeJ1Voiceover, type Job } from "./j1tts";
import { generatedVoiceoverAudio, fixedLengthAudioStream } from "./generated-voiceover-audio";
import { continuationRequest } from "./stage-continuation";
import { scheduleHostedAsrSubmission } from "./app";
import { ensureHostedContinuationDriver } from "./pair-observer-guard";
import { resolveContinuationConfiguration } from "./stage-continuation-sweep";

export interface ScriptProjectTarget {
  accountId: string;
  workspaceId: string;
  projectId: string;
}
interface Intake extends Record<string, unknown> {
  project_id: string;
  account_id: string;
  workspace_id: string;
  user_id: string;
  state: string;
  voiceover_job_id: string;
  script: string;
  voice_id: string;
  voice_name: string;
  options: Record<string, unknown>;
  failure_code: string | null;
  title: string;
  created_at: string;
  audio: null | {
    object_key: string;
    metadata: {
      filename: string;
      content_type: string;
      content_length: number;
      checksum_sha256: string;
      duration_ms: number;
    };
  };
}
async function bound<T>(
  databaseUrl: string,
  accountId: string,
  work: (sql: SqlExecutor) => Promise<T>,
): Promise<T> {
  const pool = createNeonPool(databaseUrl);
  try {
    return await createNeonExecutor(pool).transaction(async (sql) => {
      await sql.query("SELECT set_config('videoforge.account_id',$1,true)", [accountId]);
      return work(sql);
    });
  } finally {
    await pool.end();
  }
}
export function scriptProjectStatus(row: Intake) {
  return {
    state: row.state,
    voice_name: row.voice_name,
    failure_code: row.failure_code,
    created_at: row.created_at,
    script: row.script,
    audio_url: row.audio ? `/api/v2/voiceovers/jobs/${row.voiceover_job_id}/audio` : null,
  };
}
export async function readScriptProject(
  sql: SqlExecutor,
  scope: { account_id: string; workspace_id: string },
  projectId: string,
) {
  return (
    await sql.query<Intake>(
      `SELECT s.*,p.owner_user_id AS user_id,p.name AS title FROM hosted_script_projects s
    JOIN projects p ON p.id=s.project_id AND p.account_id=s.account_id AND p.workspace_id=s.workspace_id
    WHERE s.account_id=$1 AND s.workspace_id=$2 AND s.project_id=$3 AND p.status='ACTIVE'`,
      [scope.account_id, scope.workspace_id, projectId],
    )
  ).rows[0];
}
export async function ensureScriptProject(
  env: HostedRuntimeEnvironment,
  target: ScriptProjectTarget,
) {
  await ensureHostedContinuationDriver(env);
  try {
    await env.HOSTED_CONTINUATION_WORKFLOW?.create({
      id: `script-project-${target.projectId}`,
      params: { reason: "script-project", scriptProject: target },
    });
  } catch {
    /* Durable intake remains eligible for the shared driver. */
  }
}
export async function createScriptProject(
  request: Request,
  env: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  context: HostedExecutionContext,
) {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!env.J1TTS_API_KEY || !env.HOSTED_CONTINUATION_WORKFLOW)
    return response(
      {
        error: {
          code: "J1TTS_NOT_CONFIGURED",
          message: "Voice generation is unavailable. Upload a voiceover or try later.",
        },
      },
      503,
    );
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(key))
    return response({ error: { code: "PROJECT_IDEMPOTENCY_REQUIRED" } }, 400);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, context);
    if (scope instanceof Response) return scope;
    const raw = await parseHostedJson(request, "SCRIPT_PROJECT_INVALID", 524288);
    if (raw instanceof Response) return raw;
    const body = plainRecord(raw);
    const allowed = [
      "schema_version",
      "title",
      "avatar_profile_version_id",
      "image_style_version_id",
      "extra_prompt_keywords",
      "apply_extra_prompt_keywords",
      "generation_mode",
      "user_seed",
      "execution_backend",
      "video_coverage_percent",
      "script",
      "voice_id",
    ];
    if (
      !body ||
      body.schema_version !== "videoforge-hosted-script-project/v1" ||
      Object.keys(body).some((k) => !allowed.includes(k)) ||
      typeof body.script !== "string" ||
      !body.script.trim() ||
      body.script.length > 100000 ||
      body.script.includes("\0") ||
      typeof body.voice_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,160}$/u.test(body.voice_id) ||
      !Number.isSafeInteger(body.video_coverage_percent)
    )
      return response(
        {
          error: { code: "SCRIPT_PROJECT_INVALID", message: "Enter a script and choose a voice." },
        },
        400,
      );
    const options = parseProjectOptions(body);
    if (!options) return response({ error: { code: "SCRIPT_PROJECT_INVALID" } }, 400);
    const hash = await sha256(canonicalJson(body));
    const result = await createNeonExecutor(pool).transaction(async (sql) => {
      await sql.query("SELECT set_config('videoforge.account_id',$1,true)", [scope.account_id]);
      // Serialize duplicate browser retries before checking the request identity.
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        scope.account_id + key,
      ]);
      const existing = (
        await sql.query<Intake>(
          `SELECT * FROM hosted_script_projects WHERE account_id=$1 AND workspace_id=$2 AND idempotency_key=$3`,
          [scope.account_id, scope.workspace_id, key],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_sha256 !== hash) throw new Error("PROJECT_IDEMPOTENCY_CONFLICT");
        return existing;
      }
      const saved =
        (
          await sql.query<{ value: { voice_id: string; imported: boolean }[] }>(
            "SELECT public.videoforge_saved_voices($1,$2) AS value",
            [scope.account_id, scope.workspace_id],
          )
        ).rows[0]?.value ?? [];
      const voice = (await voices(env.J1TTS_API_KEY!)).find(
        (v) =>
          v.voice_id === body.voice_id &&
          (!v.imported ||
            scope.account_id === env.J1TTS_LIBRARY_OWNER_ACCOUNT_ID ||
            saved.some((s) => s.voice_id === v.voice_id && s.imported)),
      );
      if (!voice) throw new Error("VOICE_NOT_FOUND");
      const pins = await validateScriptProjectPresets(sql, scope, config, options);
      const projectId = crypto.randomUUID();
      await sql.query(
        `INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,project_kind,generation_provider) VALUES($1,$2,$3,$4,lower($4),'USER',$5)`,
        [
          projectId,
          scope.workspace_id,
          scope.user_id,
          options.title,
          config.apiGeneration ? "KIE_FAL" : "RUNPOD",
        ],
      );
      const { script: _script, voice_id: _voice, schema_version: _schema, ...selected } = body;
      void _script;
      void _voice;
      void _schema;
      const stored = {
        ...selected,
        ...pins,
        user_seed: options.userSeed ?? Math.floor(Math.random() * 4294967296),
      };
      return (
        await sql.query<Intake>(
          `INSERT INTO hosted_script_projects(project_id,account_id,workspace_id,idempotency_key,request_sha256,options,script,voice_id,voice_name,voiceover_job_id)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *`,
          [
            projectId,
            scope.account_id,
            scope.workspace_id,
            key,
            hash,
            JSON.stringify(stored),
            String(body.script),
            String(body.voice_id),
            voice.name,
            crypto.randomUUID(),
          ],
        )
      ).rows[0]!;
    });
    context.waitUntil(
      ensureScriptProject(env, {
        accountId: scope.account_id,
        workspaceId: scope.workspace_id,
        projectId: result.project_id,
      }),
    );
    return response({ project_id: result.project_id, state: result.state }, 202);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SCRIPT_PROJECT_UNAVAILABLE";
    if (
      [
        "PROJECT_IDEMPOTENCY_CONFLICT",
        "VOICE_NOT_FOUND",
        "PROJECT_PRESET_NOT_READY",
        "AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED",
        "CLOUD_MEDIA_UNAVAILABLE",
        "CLOUD_MEDIA_NOT_READY",
        "SCENE_VIDEO_UNAVAILABLE",
      ].includes(code)
    )
      return response(
        {
          error: {
            code,
            message:
              code === "VOICE_NOT_FOUND"
                ? "This voice is no longer available. Choose another voice."
                : "Project settings are unavailable. Refresh and try again.",
          },
        },
        code === "VOICE_NOT_FOUND" ? 400 : 409,
      );
    if ((error as { code?: string }).code === "23505")
      return response(
        {
          error: {
            code: "PROJECT_TITLE_EXISTS",
            message: "A project already uses this title. Choose another title.",
          },
        },
        409,
      );
    throw error;
  } finally {
    await pool.end();
  }
}

export async function advanceScriptProject(
  env: HostedRuntimeEnvironment,
  target: ScriptProjectTarget,
  context: HostedExecutionContext,
): Promise<string> {
  const scopeArgs = [target.accountId, target.workspaceId, target.projectId];
  const sqlRun = <T>(work: (sql: SqlExecutor) => Promise<T>) =>
    bound(env.DATABASE_URL!, target.accountId, work);
  let intake = await sqlRun((sql) =>
    readScriptProject(
      sql,
      { account_id: target.accountId, workspace_id: target.workspaceId },
      target.projectId,
    ),
  );
  if (!intake || ["COMPLETE", "FAILED", "CANCELLED"].includes(intake.state))
    return intake?.state ?? "MISSING";
  const jobArgs = [target.accountId, target.workspaceId, intake.voiceover_job_id];
  const record = async (state: string, providerId: string | null, code: string | null) =>
    sqlRun((sql) =>
      sql.query("SELECT public.videoforge_record_voiceover_job($1,$2,$3,$4,$5,$6)", [
        ...jobArgs,
        state,
        providerId,
        code,
      ]),
    );
  if (intake.state === "WAITING") {
    let started: { claimed: boolean; job: Job } | undefined;
    const hash = await sha256(JSON.stringify([intake.script, intake.voice_id, "voiceover.mp3"]));
    try {
      started = await sqlRun(async (sql) => {
        // Archive and intake claim take the same project lock. A cancelled queued project cannot submit TTS.
        await sql.query(
          `SELECT id FROM projects WHERE id=$3 AND account_id=$1 AND workspace_id=$2 AND status='ACTIVE' FOR UPDATE`,
          scopeArgs,
        );
        const current = await readScriptProject(
          sql,
          { account_id: target.accountId, workspace_id: target.workspaceId },
          target.projectId,
        );
        if (!current || current.state !== "WAITING") return undefined;
        const result = (
          await sql.query<{ value: { claimed: boolean; job: Job } }>(
            "SELECT public.videoforge_start_voiceover_job($1,$2,$3,$4,$5,$6,$7) AS value",
            [...jobArgs, hash, current.script, current.voice_id, "voiceover.mp3"],
          )
        ).rows[0]!.value;
        await sql.query(
          `UPDATE hosted_script_projects SET state='GENERATING',updated_at=now() WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3`,
          scopeArgs,
        );
        return result;
      });
    } catch (error) {
      if (String(error).includes("VOICEOVER_CAPACITY_BUSY")) return "WAITING";
      throw error;
    }
    if (started?.claimed) {
      // No retry of this POST. A crash or uncertain response is reconciled through the saved job.
      try {
        const result = plainRecord(
          await (
            await j1Fetch(env.J1TTS_API_KEY!, "/v1/tts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                text: intake.script,
                voice_id: intake.voice_id,
                file_name: "voiceover.mp3",
              }),
            })
          ).json(),
        );
        if (!result || typeof result.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(result.id))
          throw new J1Error("J1TTS_INVALID_RESPONSE", true);
        await record("PROCESSING", result.id, null);
      } catch (error) {
        await record(
          error instanceof J1Error && !error.ambiguous ? "FAILED" : "UNKNOWN_NO_RETRY",
          null,
          error instanceof J1Error ? error.code : "J1TTS_NETWORK_UNCERTAIN",
        );
      }
    }
  }
  const state = await observeJ1Voiceover(env, {
    accountId: target.accountId,
    workspaceId: target.workspaceId,
    jobId: intake.voiceover_job_id,
  });
  if (["FAILED", "UNKNOWN_NO_RETRY"].includes(state)) {
    await sqlRun((sql) =>
      sql.query(
        `UPDATE hosted_script_projects SET state=$4,failure_code=$5,updated_at=now() WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND state IN('WAITING','GENERATING')`,
        [
          ...scopeArgs,
          state,
          state === "FAILED" ? "J1TTS_GENERATION_FAILED" : "J1TTS_NETWORK_UNCERTAIN",
        ],
      ),
    );
    return state;
  }
  if (state !== "COMPLETED") return "GENERATING";
  await sqlRun((sql) =>
    sql.query(
      `UPDATE hosted_script_projects SET state='PREPARING',failure_code=NULL,updated_at=now() WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND state IN('GENERATING','UNKNOWN_NO_RETRY')`,
      scopeArgs,
    ),
  );
  intake = (await sqlRun((sql) =>
    readScriptProject(
      sql,
      { account_id: target.accountId, workspace_id: target.workspaceId },
      target.projectId,
    ),
  ))!;
  const bucket = env.PRIVATE_ARTIFACTS!;
  if (!intake.audio) {
    const job = (
      await sqlRun((sql) =>
        sql.query<{ job: Job }>(
          "SELECT public.videoforge_read_voiceover_job($1,$2,$3) AS job",
          jobArgs,
        ),
      )
    ).rows[0]?.job;
    if (!job?.provider_job_id) throw new Error("GENERATED_VOICEOVER_ID_MISSING");
    const downloadPath = `/v1/tts/${encodeURIComponent(job.provider_job_id)}/download`;
    let audio = await j1Fetch(env.J1TTS_API_KEY!, downloadPath);
    let length = Number(audio.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length <= 0) {
      if (!audio.body) throw new Error("GENERATED_VOICEOVER_DOWNLOAD_PENDING");
      const probe = generatedVoiceoverAudio();
      await audio.body.pipeThrough(probe.stream).pipeTo(new WritableStream({ write() {} }));
      length = probe.receipt().content_length;
      audio = await j1Fetch(env.J1TTS_API_KEY!, downloadPath);
    }
    if (length > 1_073_741_824) throw new Error("VOICEOVER_CONTENT_LENGTH_INVALID");
    if (!audio.body) throw new Error("GENERATED_VOICEOVER_DOWNLOAD_PENDING");
    const key = `tenant/${target.accountId}/workspace/${target.workspaceId}/project/${target.projectId}/narration/${crypto.randomUUID()}.mp3`;
    const measured = generatedVoiceoverAudio();
    try {
      await bucket.put(
        key,
        audio.body.pipeThrough(measured.stream).pipeThrough(fixedLengthAudioStream(length)),
        { httpMetadata: { contentType: "audio/mpeg" } },
      );
      const saved = { object_key: key, metadata: measured.receipt() };
      const updated = await sqlRun((sql) =>
        sql.query(
          `UPDATE hosted_script_projects SET audio=$4::jsonb,updated_at=now() WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND state='PREPARING' AND audio IS NULL RETURNING project_id`,
          [...scopeArgs, JSON.stringify(saved)],
        ),
      );
      if (!updated.rows.length) await bucket.delete(key);
    } catch (error) {
      await bucket.delete(key);
      if (
        /GENERATED_VOICEOVER_INVALID_MP3|VOICEOVER_DURATION_INVALID|VOICEOVER_CONTENT_LENGTH_INVALID/u.test(
          String(error),
        )
      ) {
        await sqlRun((sql) =>
          sql.query(
            `UPDATE hosted_script_projects SET state='FAILED',failure_code='GENERATED_VOICEOVER_INVALID',updated_at=now() WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND state='PREPARING' AND audio IS NULL`,
            scopeArgs,
          ),
        );
        return "FAILED";
      }
      throw error;
    }
    intake = (await sqlRun((sql) =>
      readScriptProject(
        sql,
        { account_id: target.accountId, workspace_id: target.workspaceId },
        target.projectId,
      ),
    ))!;
  }
  if (!intake.audio || intake.state !== "PREPARING") return intake.state;
  const config = await resolveContinuationConfiguration(env);
  const scope: HostedScope = {
    account_id: target.accountId,
    workspace_id: target.workspaceId,
    user_id: intake.user_id,
  };
  const body = {
    ...intake.options,
    schema_version: "videoforge-hosted-project-create/v3",
    optional_script: intake.script,
    voiceover: intake.audio.metadata,
  };
  const request = continuationRequest(config, "/api/v2/hosted/projects", body);
  request.headers.set("idempotency-key", `script-project-${target.projectId}`);
  const created = await createProject(request, env, config, context, {
    scope,
    projectId: target.projectId,
  });
  if (!created.ok) throw new Error("SCRIPT_PROJECT_PREPARATION_PENDING");
  const prepared = (await created.json()) as { state: string; object_key: string };
  if (prepared.state !== "READY") {
    const stored = await bucket.get(intake.audio.object_key);
    if (!stored?.body) throw new Error("GENERATED_VOICEOVER_STORAGE_PENDING");
    await bucket.put(prepared.object_key, stored.body, {
      httpMetadata: { contentType: "audio/mpeg" },
      sha256: intake.audio.metadata.checksum_sha256.slice(7),
    });
  }
  const committed = await commitProject(
    continuationRequest(config, `/api/v2/hosted/projects/${target.projectId}/commit`, {}),
    target.projectId,
    env,
    config,
    context,
    scope,
  );
  if (!committed.ok) throw new Error("SCRIPT_PROJECT_COMMIT_PENDING");
  const ready = (await committed.json()) as { cpu_submission: unknown };
  await scheduleHostedAsrSubmission(env, config, scope, ready.cpu_submission, context);
  await sqlRun((sql) =>
    sql.query(
      `UPDATE hosted_script_projects SET state='COMPLETE',failure_code=NULL,updated_at=now() WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND state='PREPARING'`,
      scopeArgs,
    ),
  );
  await bucket.delete(intake.audio.object_key);
  return "COMPLETE";
}
export async function recordScriptProjectRetry(
  env: HostedRuntimeEnvironment,
  target: ScriptProjectTarget,
) {
  try {
    await bound(env.DATABASE_URL!, target.accountId, (sql) =>
      sql.query(
        `UPDATE hosted_script_projects SET failure_code='VOICEOVER_STAGE_RETRYING',updated_at=now()
       WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND state IN('WAITING','GENERATING','PREPARING')`,
        [target.accountId, target.workspaceId, target.projectId],
      ),
    );
  } catch {
    /* Database outages cannot change the saved provider identity. */
  }
}

export async function reconcileScriptProjects(
  env: HostedRuntimeEnvironment,
  context: HostedExecutionContext,
) {
  if (!env.J1TTS_API_KEY || !env.DATABASE_URL) return;
  const pool = createNeonPool(env.DATABASE_URL);
  let targets: ScriptProjectTarget[];
  try {
    targets =
      (
        await pool.query<{ targets: ScriptProjectTarget[] }>(
          "SELECT public.videoforge_pending_script_projects() AS targets",
        )
      ).rows[0]?.targets ?? [];
  } finally {
    await pool.end();
  }
  for (const target of targets) {
    try {
      await advanceScriptProject(env, target, context);
    } catch {
      await recordScriptProjectRetry(env, target);
    }
  }
}
