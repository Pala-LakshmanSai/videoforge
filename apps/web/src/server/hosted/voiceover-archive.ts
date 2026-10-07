import type { HostedRuntimeEnvironment } from "./configuration";
import { createNeonPool } from "./neon";
import { generatedVoiceoverAudio, fixedLengthAudioStream } from "./generated-voiceover-audio";
import { j1Fetch } from "./j1tts";
import { verifyHostedObjectChecksum } from "./r2-checksum";

export interface VoiceoverTarget {
  accountId: string;
  workspaceId: string;
  jobId: string;
}
export interface VoiceoverAsset {
  title: string;
  voice_name: string;
  object_key: string | null;
  object_prefix?: string;
  provider_job_id?: string;
  previous_claim_id?: string | null;
  filename: string;
  content_length: number | null;
  duration_ms: number | null;
  deleted_at: string | null;
  archive_failure_code?: string | null;
}
/** Archive only explicitly standalone jobs; video narration retains its existing intake path. */
export async function archiveStandaloneVoiceover(
  env: HostedRuntimeEnvironment,
  target: VoiceoverTarget,
): Promise<void> {
  if (!env.PRIVATE_ARTIFACTS || !env.J1TTS_API_KEY || !env.DATABASE_URL) return;
  const bucket = env.PRIVATE_ARTIFACTS;
  const pool = createNeonPool(env.DATABASE_URL);
  const args = [target.accountId, target.workspaceId, target.jobId];
  const sql = async <T>(functionCall: string, values: unknown[]) =>
    (
      await pool.query<{ value: T }>(
        `WITH bound AS (SELECT set_config('videoforge.account_id',($1::uuid)::text,true)) SELECT public.${functionCall} AS value FROM bound`,
        values,
      )
    ).rows[0]?.value;
  let objectKey: string | undefined;
  let committing = false;
  const claim = crypto.randomUUID();
  try {
    const asset = await sql<VoiceoverAsset | null>(
      "videoforge_claim_voiceover_library_archive($1,$2,$3,$4)",
      [...args, claim],
    );
    if (!asset || asset.object_key || asset.deleted_at || !asset.provider_job_id) return;
    const expectedPrefix = `tenant/${target.accountId}/workspace/${target.workspaceId}/voiceover/${target.jobId}/`;
    if (asset.object_prefix !== expectedPrefix) throw new Error("VOICEOVER_ARCHIVE_PREFIX_INVALID");
    if (asset.previous_claim_id) {
      // Expired claims may have lost a cleanup response. Sweep only this job's exact archive keys.
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: expectedPrefix, cursor });
        for (const object of page.objects) {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp3$/u.test(
              object.key.slice(expectedPrefix.length),
            )
          )
            throw new Error("VOICEOVER_ARCHIVE_PREFIX_INVALID");
          await bucket.delete(object.key);
          if (await bucket.head(object.key)) throw new Error("VOICEOVER_ARCHIVE_CLEANUP_PENDING");
        }
        const next = page.truncated ? page.cursor : undefined;
        if (next && next === cursor) throw new Error("VOICEOVER_ARCHIVE_CLEANUP_PENDING");
        cursor = next;
      } while (cursor);
    }
    objectKey = `${expectedPrefix}${claim}.mp3`;
    const download = () =>
      j1Fetch(
        env.J1TTS_API_KEY!,
        `/v1/tts/${encodeURIComponent(asset.provider_job_id!)}/download`,
        { signal: AbortSignal.timeout(120_000) },
      );
    let audio = await download();
    let length = Number(audio.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length <= 0) {
      if (!audio.body) throw new Error("GENERATED_VOICEOVER_DOWNLOAD_PENDING");
      const probe = generatedVoiceoverAudio(0.01);
      await audio.body
        .pipeThrough(probe.stream)
        .pipeTo(new WritableStream({ write() {} }), { signal: AbortSignal.timeout(120_000) });
      length = probe.receipt().content_length;
      audio = await download();
    }
    if (!audio.body || length > 1_073_741_824) throw new Error("VOICEOVER_CONTENT_LENGTH_INVALID");
    const measured = generatedVoiceoverAudio(0.01);
    await bucket.put(
      objectKey,
      audio.body
        .pipeThrough(measured.stream, { signal: AbortSignal.timeout(120_000) })
        .pipeThrough(fixedLengthAudioStream(length)),
      { httpMetadata: { contentType: "audio/mpeg" } },
    );
    const receipt = measured.receipt();
    const head = await bucket.head(objectKey);
    if (
      !head ||
      head.size !== receipt.content_length ||
      !(await verifyHostedObjectChecksum(bucket, objectKey, head, receipt.checksum_sha256))
    )
      throw new Error("VOICEOVER_ARCHIVE_READBACK_FAILED");
    committing = true;
    await sql("videoforge_finalize_voiceover_library_archive($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      ...args,
      claim,
      objectKey,
      receipt.content_type,
      receipt.content_length,
      receipt.checksum_sha256,
      receipt.duration_ms,
    ]);
  } catch (error) {
    // A lost commit response is not proof of rollback. Keep bytes until a scoped read confirms it.
    if (objectKey && committing) {
      try {
        const saved = await sql<VoiceoverAsset | null>(
          "videoforge_read_voiceover_library_asset($1,$2,$3)",
          args,
        );
        if (saved?.object_key === objectKey) return;
        if (saved) await bucket.delete(objectKey);
      } catch {
        /* Preserve uncertain committed bytes for reconciliation. */
      }
    } else if (objectKey) {
      await bucket.delete(objectKey);
      if (await bucket.head(objectKey)) throw new Error("VOICEOVER_ARCHIVE_CLEANUP_PENDING");
    }
    if (
      !committing &&
      /GENERATED_VOICEOVER_INVALID_MP3|VOICEOVER_DURATION_INVALID|VOICEOVER_CONTENT_LENGTH_INVALID/u.test(
        String(error),
      )
    ) {
      await sql("videoforge_record_voiceover_library_archive_failure($1,$2,$3,$4,$5)", [
        ...args,
        claim,
        "VOICEOVER_LIBRARY_AUDIO_INVALID",
      ]);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

export async function reconcileVoiceoverArchives(env: HostedRuntimeEnvironment) {
  if (!env.DATABASE_URL || !env.PRIVATE_ARTIFACTS || !env.J1TTS_API_KEY) return;
  const pool = createNeonPool(env.DATABASE_URL);
  let targets: VoiceoverTarget[];
  try {
    targets =
      (
        await pool.query<{ targets: VoiceoverTarget[] }>(
          "SELECT public.videoforge_pending_voiceover_library_archives() AS targets",
        )
      ).rows[0]?.targets ?? [];
  } finally {
    await pool.end();
  }
  for (const target of targets) {
    try {
      await archiveStandaloneVoiceover(env, target);
    } catch {
      /* Retrieval retries reuse the saved provider identity, never generate again. */
    }
  }
}
