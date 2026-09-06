import type { JsonValue } from "@videoforge/contracts";

import { sha256 } from "./crypto";
import {
  canonicalJson,
  exactHostedSpanAudioSubmission,
  type HostedSpanAudioSubmission,
} from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface HostedV209SpanIdentity {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId: string;
}

export interface HostedV209SpanAudioJob {
  readonly spanId: string;
  readonly taskId: string;
  readonly taskKey: string;
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly inputDocument: JsonValue;
  readonly submissionDocument: JsonValue;
  readonly submissionSha256: string;
  readonly objects: readonly JsonValue[];
  readonly state: "PLANNED";
}

export interface HostedV209SpanAudioJobs {
  readonly schemaVersion: "videoforge.hosted-v209-span-audio-jobs/v1";
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly jobs: readonly HostedV209SpanAudioJob[];
}

export interface HostedV209SpanAudioFinalization {
  readonly schemaVersion: "videoforge.hosted-v209-span-audio-finalization/v1";
  readonly replayed: boolean;
  readonly pairReady: boolean;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly attemptId: string;
  readonly spanId: string;
  readonly assetId: string;
  readonly artifactReceiptId: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
}

export interface HostedV209SpanAudioCoordinatorDependencies {
  readonly loadJobs: (identity: HostedV209SpanIdentity) => Promise<unknown>;
  readonly schedule: (
    identity: HostedV209SpanIdentity,
    submission: HostedSpanAudioSubmission,
    expectedAttemptId: string,
  ) => Promise<{ readonly state: string }>;
  readonly finalize: (input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly attemptId: string;
    readonly resultDocument: JsonValue;
  }) => Promise<unknown>;
  readonly resumePair: (identity: HostedV209SpanIdentity) => Promise<void>;
}

export class HostedV209SpanAudioError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HostedV209SpanAudioError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function exactJobs(value: unknown, identity: HostedV209SpanIdentity): HostedV209SpanAudioJobs {
  const root = record(value);
  if (!root || !exactKeys(root, ["schemaVersion", "accountId", "workspaceId", "projectId",
    "projectRevisionId", "jobs"]) ||
    root.schemaVersion !== "videoforge.hosted-v209-span-audio-jobs/v1" ||
    root.accountId !== identity.accountId || root.workspaceId !== identity.workspaceId ||
    root.projectId !== identity.projectId || typeof root.projectRevisionId !== "string" ||
    !DATABASE_UUID.test(root.projectRevisionId) || !Array.isArray(root.jobs) || root.jobs.length > 4096) {
    throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_JOBS_INVALID");
  }
  const attempts = new Set<string>();
  const spans = new Set<string>();
  const jobs: HostedV209SpanAudioJob[] = [];
  for (const item of root.jobs) {
    const job = record(item);
    if (!job || !exactKeys(job, ["spanId", "taskId", "taskKey", "attemptId", "idempotencyKey",
      "inputDocument", "submissionDocument", "submissionSha256", "objects", "state"]) ||
      ![job.spanId, job.taskId, job.attemptId].every((id) => typeof id === "string" && DATABASE_UUID.test(id)) ||
      typeof job.taskKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(job.taskKey) ||
      typeof job.idempotencyKey !== "string" || job.idempotencyKey.length < 16 ||
      typeof job.submissionSha256 !== "string" || !SHA256.test(job.submissionSha256) ||
      job.state !== "PLANNED" || !Array.isArray(job.objects) ||
      attempts.has(String(job.attemptId)) || spans.has(String(job.spanId))) {
      throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_JOBS_INVALID");
    }
    const submission = exactHostedSpanAudioSubmission(job.submissionDocument, String(job.attemptId));
    const input = record(job.inputDocument);
    if (!submission || !input || submission.projectId !== identity.projectId ||
      submission.projectRevisionId !== root.projectRevisionId ||
      submission.idempotencyKey !== job.idempotencyKey ||
      canonicalJson(submission.inputDocument) !== canonicalJson(job.inputDocument) ||
      input.span_id !== job.spanId || input.task_key !== job.taskKey ||
      canonicalJson((job.submissionDocument as Record<string, unknown>).objects) !== canonicalJson(job.objects)) {
      throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_JOBS_INVALID");
    }
    attempts.add(String(job.attemptId));
    spans.add(String(job.spanId));
    jobs.push(job as unknown as HostedV209SpanAudioJob);
  }
  return Object.freeze({ ...root, jobs: Object.freeze(jobs) }) as unknown as HostedV209SpanAudioJobs;
}

function exactFinalization(
  value: unknown,
  expected: { readonly accountId: string; readonly workspaceId: string; readonly attemptId: string },
): HostedV209SpanAudioFinalization {
  const row = record(value);
  if (!row || !exactKeys(row, ["schemaVersion", "replayed", "pairReady", "accountId",
    "workspaceId", "userId", "projectId", "projectRevisionId", "generationRequestId",
    "attemptId", "spanId", "assetId", "artifactReceiptId", "objectKey", "checksumSha256"]) ||
    row.schemaVersion !== "videoforge.hosted-v209-span-audio-finalization/v1" ||
    typeof row.replayed !== "boolean" || typeof row.pairReady !== "boolean" ||
    row.accountId !== expected.accountId || row.workspaceId !== expected.workspaceId ||
    row.attemptId !== expected.attemptId ||
    ![row.userId, row.projectId, row.projectRevisionId, row.generationRequestId, row.attemptId,
      row.spanId, row.assetId, row.artifactReceiptId].every((id) =>
      typeof id === "string" && DATABASE_UUID.test(id)) ||
    typeof row.objectKey !== "string" || !row.objectKey.startsWith(`tenant/${expected.accountId}/workspace/${expected.workspaceId}/`) ||
    typeof row.checksumSha256 !== "string" || !SHA256.test(row.checksumSha256)) {
    throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_FINALIZATION_INVALID");
  }
  return row as unknown as HostedV209SpanAudioFinalization;
}

export function createHostedV209SpanAudioCoordinator(
  dependencies: HostedV209SpanAudioCoordinatorDependencies,
) {
  return Object.freeze({
    async prepare(identity: HostedV209SpanIdentity) {
      if (![identity.accountId, identity.workspaceId, identity.userId].every((id) => DATABASE_UUID.test(id)) ||
        !UUID.test(identity.projectId)) {
        throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_SCOPE_INVALID");
      }
      const projection = exactJobs(await dependencies.loadJobs(identity), identity);
      if (projection.jobs.length === 0) {
        await dependencies.resumePair(identity);
        return Object.freeze({
          state: "PAIR_RESUMED" as const,
          projectRevisionId: projection.projectRevisionId,
          attemptIds: Object.freeze([] as string[]),
        });
      }
      for (const job of projection.jobs) {
        if ((await sha256(canonicalJson(job.submissionDocument))) !== job.submissionSha256) {
          throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_SUBMISSION_HASH_MISMATCH");
        }
        const submission = exactHostedSpanAudioSubmission(job.submissionDocument, job.attemptId)!;
        const scheduled = await dependencies.schedule(identity, submission, job.attemptId);
        if (!["OUTBOXED", "RUNNING", "SUCCEEDED"].includes(scheduled.state)) {
          throw new HostedV209SpanAudioError("HOSTED_V209_SPAN_SCHEDULE_REJECTED");
        }
      }
      return Object.freeze({
        state: "PREPARING_INPUTS" as const,
        projectRevisionId: projection.projectRevisionId,
        attemptIds: Object.freeze(projection.jobs.map((job) => job.attemptId)),
      });
    },
    async acceptCompleted(input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly attemptId: string;
      readonly resultDocument: JsonValue;
    }) {
      const finalized = exactFinalization(await dependencies.finalize(input), input);
      if (finalized.pairReady) {
        await dependencies.resumePair({
          accountId: finalized.accountId,
          workspaceId: finalized.workspaceId,
          userId: finalized.userId,
          projectId: finalized.projectId,
        });
      }
      return finalized;
    },
  });
}
