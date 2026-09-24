// @vitest-environment node
import { webcrypto } from "node:crypto";

import validEnvelope from "@videoforge/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json";
import {
  digestUtf8,
  type SqlPrimitive,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";
import {
  PERMANENT_POSITIVE_GUARDRAIL,
  PERMANENT_NEGATIVE_GUARDRAIL,
  verifyCompiledImagePrompt,
  type CompiledImagePrompt,
} from "@videoforge/pipeline/prompts";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import {
  createHostedImageRegenerationService,
  imageRegenerationWorkflowId,
  regenerationStatus,
} from "./hosted-image-regeneration-service";

const accountId = "account-a";
const workspaceId = "workspace-a";
const projectId = "project-a";
const revisionId = "revision-a";
const imageTaskId = "scene-a";
const requestId = "regeneration-a";
const attemptId = "attempt-fresh";
const outputReservationId = "output-fresh";
const sourceReservationId = "output-original";
const originalPrompt = "a village at dawn";
const originalNegativePrompt = "text, logo, watermark";
const editedPrompt = "a mountain village at dawn with warm window light";
const guardedPositive = `${editedPrompt}, ${PERMANENT_POSITIVE_GUARDRAIL}`;
const guardedNegative = `${originalNegativePrompt}, ${PERMANENT_NEGATIVE_GUARDRAIL}`;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("test record expected");
  return value as JsonRecord;
}

function sourceLineage(): JsonRecord {
  const envelope = structuredClone(validEnvelope) as JsonRecord;
  envelope.dispatch_token = "source-dispatch-token-0123456789abcdef0123456789";
  envelope.tenant = { account_id: accountId, workspace_id: workspaceId };
  envelope.work = {
    ...record(envelope.work),
    project_revision_id: revisionId,
    generation_request_id: "generation-a",
    task_id: imageTaskId,
    attempt_id: "attempt-original",
    items_manifest_sha256: digestUtf8("source-work"),
    item_count: 1,
  };
  envelope.artifacts = {
    ...record(envelope.artifacts),
    input_manifest_sha256: digestUtf8("source-input"),
    output_prefix: `tenant/${accountId}/workspace/${workspaceId}/project/${projectId}/revision/${revisionId}/lane/mage-image/job/attempt-original`,
    transfer_port_reservation_ids: [sourceReservationId],
  };
  envelope.limits = {
    ...record(envelope.limits),
    expires_at: "2026-09-14T01:10:00.000Z",
    max_items: 1,
  };

  return {
    binding: {
      accountId,
      workspaceId,
      projectId,
      projectRevisionId: revisionId,
      lane: "mage_image",
      attemptId: "attempt-original",
      providerJobId: "provider-original",
      endpointIdSha256: digestUtf8("mage-endpoint"),
    },
    requestBody: { envelope },
    candidateWork: [
      {
        taskId: imageTaskId,
        phrase: "a village at dawn",
        shotRole: "wide_setting",
        seed: 41,
        outputPrefix: record(envelope.artifacts).output_prefix,
        outputReservationId: sourceReservationId,
        positivePromptSha256: digestUtf8(originalPrompt),
        negativePromptSha256: digestUtf8(originalNegativePrompt),
        compiledPrompt: {
          positivePrompt: originalPrompt,
          positivePromptSha256: digestUtf8(originalPrompt),
          negativePrompt: originalNegativePrompt,
          negativePromptSha256: digestUtf8(originalNegativePrompt),
        },
      },
    ],
  };
}

function environment(workflow: {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}) {
  return {
    VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
    DATABASE_URL: "postgresql://runtime.example/videoforge",
    VIDEOFORGE_RECONCILER_DATABASE_URL: "postgresql://reconciler.example/videoforge",
    RUNPOD_API_BASE_URL: "https://api.runpod.ai/v2",
    VIDEOFORGE_DISPATCH_TOKEN_KEY: "dispatch-secret-for-test",
    VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: "dispatch-test-key",
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: "11".repeat(32),
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: "envelope-test-key",
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "22".repeat(32),
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: "receipt-test-key",
    VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "operator-token-for-test",
    HOSTED_PAIR_WORKFLOW: workflow,
  } as unknown as HostedRuntimeEnvironment;
}

function configuration() {
  return {
    r2: {
      accountId: "r2-account",
      bucketName: "private-artifacts",
      region: "auto",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    },
  } as unknown as HostedRuntimeConfiguration;
}

type HarnessOptions = {
  prepareError?: Error & { code?: string };
  raceRow?: JsonRecord;
};

function harness(options: HarnessOptions = {}) {
  const queued = {
    id: requestId,
    attempt_id: attemptId,
    output_reservation_id: outputReservationId,
    state: "QUEUED",
    source_lineage: sourceLineage(),
  };
  let row: JsonRecord = queued;
  let prepared: { body: JsonRecord; envelope: JsonRecord; lineage: JsonRecord } | undefined;
  const calls: Array<{ sql: string; values: readonly SqlPrimitive[] }> = [];
  const workflow = {
    create: vi.fn(async ({ id }: { id: string }) => ({ id })),
    get: vi.fn(async (id: string) => ({ id })),
  };
  const query = vi.fn(async (sql: string, values: readonly SqlPrimitive[] = []) => {
    calls.push({ sql, values });
    if (sql.includes("SELECT generation_provider AS value FROM public.projects"))
      return { rows: [{ value: "RUNPOD" }] };
    if (sql.includes("videoforge_create_hosted_image_regeneration"))
      return { rows: [{ value: row }] };
    if (sql.includes("videoforge_prepare_hosted_image_regeneration")) {
      if (options.raceRow) row = options.raceRow;
      if (options.prepareError) throw options.prepareError;
      const body = JSON.parse(String(values[1])) as JsonRecord;
      const envelope = JSON.parse(String(values[2])) as JsonRecord;
      const lineage = JSON.parse(String(values[5])) as JsonRecord;
      prepared = { body, envelope, lineage };
      row = {
        ...row,
        state: "PREPARED",
        request_body: body,
        envelope,
        request_hash: values[3],
        envelope_hash: values[4],
        lineage,
      };
      return { rows: [{ value: row }] };
    }
    if (sql.includes("videoforge_load_hosted_image_regeneration"))
      return { rows: [{ value: row }] };
    if (sql.includes("set_config")) return { rows: [{ value: true }] };
    throw new Error(`unexpected SQL in service test: ${sql}`);
  });
  const database = {
    transaction: vi.fn(
      async <Value>(work: (transaction: { query: typeof query }) => Promise<Value>) =>
        work({ query }),
    ),
  } as unknown as TransactionalSqlExecutor;
  const service = createHostedImageRegenerationService({
    database,
    config: configuration(),
    environment: environment(workflow) as HostedRuntimeEnvironment,
  });
  return {
    service,
    workflow,
    query,
    calls,
    get row() {
      return row;
    },
    get prepared() {
      return prepared;
    },
  };
}

const args = {
  accountId,
  workspaceId,
  userId: "user-a",
  projectId,
  imageTaskId,
  revisionId,
  prompt: editedPrompt,
  idempotencyKey: "regen-key-a",
};

describe("hosted image regeneration service", () => {
  it("keeps unknown paid submissions distinct from retryable failures", () => {
    expect(regenerationStatus({ id: requestId, attempt_id: attemptId,
      state: "UNKNOWN_NO_RETRY" })).toEqual({
      request_id: requestId,
      attempt_id: attemptId,
      state: "ACTION_REQUIRED",
      error_code: "UNKNOWN_NO_RETRY",
    });
  });
  it("creates an API regeneration from the pinned style without GPU bindings", async () => {
    const queries: Array<{ sql: string; values: readonly SqlPrimitive[] }> = [];
    const query = vi.fn(async (sql: string, values: readonly SqlPrimitive[] = []) => {
      queries.push({ sql, values });
      if (sql.includes("set_config")) return { rows: [{ value: true }] };
      if (sql.includes("SELECT generation_provider")) return { rows: [{ value: "KIE_FAL" }] };
      if (sql.includes("videoforge_read_hosted_api_image_regeneration_source"))
        return { rows: [{ value: { sourceInputManifest: { compiledPrompt: {
          components: { literalContent: originalPrompt, continuityAndShotRole: "original role",
            cropGuidance: "original crop", stylePositiveSuffix: "original style",
            styleNegativeSuffix: "CGI, fake lettering", extraPromptKeywords: null },
        } } } }] };
      if (sql.includes("videoforge_create_hosted_api_image_regeneration"))
        return { rows: [{ value: { id: requestId, state: "PREPARED" } }] };
      throw new Error(`unexpected API regeneration SQL: ${sql}`);
    });
    const database = { transaction: async <T>(run: (tx: { query: typeof query }) => Promise<T>) =>
      run({ query }) } as unknown as TransactionalSqlExecutor;
    const workflow = { create: vi.fn(async ({ id }: { id: string }) => ({ id })),
      get: vi.fn() };
    const service = createHostedImageRegenerationService({ database,
      config: { ...configuration(), apiGeneration: { kieApiKey: "test-key", falApiKey: "test-key" } },
      environment: { HOSTED_PAIR_WORKFLOW: workflow, PRIVATE_ARTIFACTS: {} } as never });
    await expect(service.create(args)).resolves.toMatchObject({ request_id: requestId,
      state: "QUEUED" });
    const creation = queries.find(({ sql }) => sql.includes("videoforge_create_hosted_api_image_regeneration"));
    expect(creation?.values[5]).toContain(editedPrompt);
    expect(creation?.values[5]).toContain("No visible text");
    expect(creation?.values[5]).toContain("CGI, fake lettering");
    expect(creation?.values[5]).not.toContain("original role");
    expect(workflow.create).toHaveBeenCalledOnce();
  });
  it("prepares one exact source scene with the edited prompt, fresh seed, and fresh output authority", async () => {
    const randomValues = vi
      .spyOn(webcrypto, "getRandomValues")
      .mockReturnValue(new Uint32Array([987654321]) as never);
    const randomUuid = vi
      .spyOn(webcrypto, "randomUUID")
      .mockReturnValue("99999999-9999-4999-8999-999999999999");
    const value = harness();

    await expect(value.service.create(args)).resolves.toEqual({
      request_id: requestId,
      attempt_id: attemptId,
      state: "DISPATCHING",
    });

    const prepared = value.prepared!;
    const body = prepared.body;
    const batch = record(body.batch);
    const item = record((batch.items as unknown[])[0]);
    const authority = record((body.generated_output_authorities as unknown[])[0]);
    const limits = record(record(body.envelope).limits);
    const lineage = prepared.lineage;
    const candidate = record((lineage.candidateWork as unknown[])[0]);

    expect(batch.items).toHaveLength(1);
    expect(item).toMatchObject({
      scene_id: imageTaskId,
      positive_prompt: guardedPositive,
      negative_prompt: guardedNegative,
      seed: 987654321,
      width: 1280,
      height: 720,
    });
    expect(item.seed).not.toBe(41);
    expect(item.positive_prompt_sha256).toBe(digestUtf8(guardedPositive));
    expect(item.negative_prompt_sha256).toBe(digestUtf8(guardedNegative));
    expect(typeof limits.issued_at).toBe("string");
    expect(limits.issued_at).toBe(new Date(String(limits.issued_at)).toISOString());
    expect(Date.parse(String(limits.expires_at)) - Date.parse(String(limits.issued_at))).toBe(
      3_600_000,
    );
    expect(Date.parse(String(lineage.deadlineAt)) - Date.parse(String(limits.issued_at))).toBe(
      600_000,
    );
    expect(authority).toMatchObject({
      reservation_id: outputReservationId,
      account_id: accountId,
      workspace_id: workspaceId,
      method: "PUT",
      content_type: "image/png",
      max_uses: 1,
    });
    expect(String(authority.path)).toContain(`/attempt-fresh/artifact/${imageTaskId}`);
    expect(body.output_put_urls).toHaveLength(1);
    expect(String((body.output_put_urls as unknown[])[0])).toContain(
      "r2-account.r2.cloudflarestorage.com",
    );
    expect(candidate).toMatchObject({
      taskId: imageTaskId,
      phrase: "a village at dawn",
      shotRole: "wide_setting",
      positivePromptSha256: digestUtf8(guardedPositive),
      outputReservationId: outputReservationId,
      compiledPrompt: {
        positivePrompt: guardedPositive,
        negativePrompt: guardedNegative,
        positivePromptUtf8Bytes: Buffer.byteLength(guardedPositive, "utf8"),
        negativePromptUtf8Bytes: Buffer.byteLength(guardedNegative, "utf8"),
      },
    });
    verifyCompiledImagePrompt(candidate.compiledPrompt as CompiledImagePrompt);
    expect(candidate).not.toMatchObject({ outputReservationId: sourceReservationId });
    expect(value.workflow.create).toHaveBeenCalledWith({
      id: imageRegenerationWorkflowId(requestId),
      params: {
        schema_version: "videoforge-image-regeneration-workflow/v1",
        accountId,
        workspaceId,
        requestId,
      },
    });
    expect(randomValues).toHaveBeenCalledOnce();
    expect(randomUuid).toHaveBeenCalledOnce();
    randomValues.mockRestore();
    randomUuid.mockRestore();
  });

  it("guards an existing image edit while retaining the raw prompt identity and intended camera subject", async () => {
    const value = harness();
    const prompt = `subject: a photographer holding a camera; camera: Wide-angle lens, deep focus, stable tripod-mounted or aerial perspective; lighting: daylight, ${PERMANENT_POSITIVE_GUARDRAIL}`;
    await value.service.create({ ...args, prompt });
    const candidate = record((value.prepared!.lineage.candidateWork as unknown[])[0]);
    const compiled = record(candidate.compiledPrompt);
    expect(compiled.positivePrompt).toContain("subject: a photographer holding a camera");
    expect(compiled.positivePrompt).toContain(
      "viewpoint: wide field of view, deep focus, steady unobstructed or aerial perspective",
    );
    expect(compiled.positivePrompt).not.toMatch(/camera:|tripod-mounted/u);
    expect(String(compiled.positivePrompt).split(PERMANENT_POSITIVE_GUARDRAIL)).toHaveLength(2);
    expect(compiled.negativePrompt).toContain("unreadable text");
    expect(compiled.negativePrompt).toContain("extraneous cameras");
    expect(
      value.query.mock.calls.find(([sql]) =>
        sql.includes("videoforge_create_hosted_image_regeneration"),
      )?.[1],
    ).toContain(prompt);
    verifyCompiledImagePrompt(candidate.compiledPrompt as CompiledImagePrompt);
  });

  it("keeps a busy request queued while still scheduling its workflow", async () => {
    const capacityError = Object.assign(new Error("provider capacity occupied"), { code: "55P03" });
    const value = harness({ prepareError: capacityError });

    await expect(value.service.create(args)).resolves.toEqual({
      request_id: requestId,
      attempt_id: attemptId,
      state: "QUEUED",
    });

    expect(value.row).toMatchObject({ state: "QUEUED" });
    expect(value.prepared).toBeUndefined();
    expect(
      value.query.mock.calls.filter(([sql]) =>
        sql.includes("videoforge_prepare_hosted_image_regeneration"),
      ),
    ).toHaveLength(1);
    expect(value.workflow.create).toHaveBeenCalledOnce();
    expect(value.workflow.get).not.toHaveBeenCalled();
  });

  it("reuses a raced prepared request without overwriting its saved bytes", async () => {
    const savedBody = { marker: "saved-request-body" };
    const savedEnvelope = { marker: "saved-envelope" };
    const savedLineage = { marker: "saved-lineage" };
    const racedRow: JsonRecord = {
      id: requestId,
      attempt_id: attemptId,
      output_reservation_id: outputReservationId,
      state: "PREPARED",
      request_body: savedBody,
      envelope: savedEnvelope,
      lineage: savedLineage,
    };
    const preparationRace = Object.assign(new Error("request already prepared"), { code: "23505" });
    const value = harness({ prepareError: preparationRace, raceRow: racedRow });

    await expect(value.service.create(args)).resolves.toEqual({
      request_id: requestId,
      attempt_id: attemptId,
      state: "DISPATCHING",
    });

    expect(value.row).toMatchObject({
      state: "PREPARED",
      request_body: savedBody,
      envelope: savedEnvelope,
      lineage: savedLineage,
    });
    expect(value.prepared).toBeUndefined();
    expect(
      value.query.mock.calls.filter(([sql]) =>
        sql.includes("videoforge_prepare_hosted_image_regeneration"),
      ),
    ).toHaveLength(1);
    expect(value.workflow.create).toHaveBeenCalledOnce();
  });

  it("reuses the idempotent prepared request and recovers an already-created Workflow", async () => {
    const value = harness();
    await value.service.create(args);
    value.workflow.create.mockRejectedValueOnce(new Error("workflow already exists"));

    await expect(value.service.create(args)).resolves.toEqual({
      request_id: requestId,
      attempt_id: attemptId,
      state: "DISPATCHING",
    });

    expect(
      value.query.mock.calls.filter(([sql]) =>
        sql.includes("videoforge_prepare_hosted_image_regeneration"),
      ),
    ).toHaveLength(1);
    expect(value.workflow.create).toHaveBeenCalledTimes(2);
    expect(value.workflow.create.mock.calls[0]?.[0]).toEqual(
      value.workflow.create.mock.calls[1]?.[0],
    );
    expect(value.workflow.get).toHaveBeenCalledWith(imageRegenerationWorkflowId(requestId));
  });
});
