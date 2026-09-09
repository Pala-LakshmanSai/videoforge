import { createHostedV209SpanAudioCoordinator } from "./hosted-v209-span-audio";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonExecutor, createNeonPool } from "./neon";
import { canonicalJson, type HostedSpanAudioSubmission } from "./submission";

export function createHostedV209SpanAudioLiveCoordinator(
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  scheduleSubmission: (
    environment: HostedRuntimeEnvironment,
    config: HostedRuntimeConfiguration,
    input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly submission: HostedSpanAudioSubmission;
      readonly expectedAttemptId: string;
    },
  ) => Promise<{ readonly state: string }>,
) {
  const databaseCall = async (sql: string, parameters: readonly string[]) => {
    const pool = createNeonPool(config.neon.databaseUrl);
    try {
      const result = await createNeonExecutor(pool).transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          parameters[0]!,
        ]);
        return transaction.query<{ value: unknown }>(sql, parameters);
      });
      if (result.rows.length !== 1) throw new Error("HOSTED_V209_SPAN_DATABASE_RESULT_INVALID");
      return result.rows[0]!.value;
    } finally {
      await pool.end();
    }
  };
  return createHostedV209SpanAudioCoordinator({
    loadJobs: (identity) =>
      databaseCall(
        `SELECT public.videoforge_materialize_hosted_v209_span_audio_jobs(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid) AS value`,
        [identity.accountId, identity.workspaceId, identity.userId, identity.projectId],
      ),
    schedule: async (identity, submission, expectedAttemptId) =>
      scheduleSubmission(environment, config, {
        accountId: identity.accountId,
        workspaceId: identity.workspaceId,
        submission,
        expectedAttemptId,
      }),
    finalize: (input) =>
      databaseCall(
        `SELECT public.videoforge_finalize_hosted_v209_span_audio(
           $1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS value`,
        [input.accountId, input.workspaceId, input.attemptId, canonicalJson(input.resultDocument)],
      ),
    resumePair: async (identity) => {
      const { resumeHostedV209ProjectDispatch } = await import("./hosted-v209-project-dispatch");
      const result = await resumeHostedV209ProjectDispatch(
        environment,
        config,
        identity,
        undefined,
        undefined,
        undefined,
        true,
      );
      if (!result.ok) throw new Error("HOSTED_V209_SPAN_PAIR_RESUME_REJECTED");
    },
  });
}
