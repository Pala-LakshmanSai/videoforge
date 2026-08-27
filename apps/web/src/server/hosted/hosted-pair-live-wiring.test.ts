import { ServerlessTransportError } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";
import canonicalPlan from "../../../../../project-context/evidence/fixtures/resolved_render_manifest.v209-short.valid.json";
import { freezeV209ShortLiveAdmission } from "../runtime/v209-short-live-cost";

import {
  HostedPairWorkflowReconciler,
  awaitV209TerminalAcceptance,
  commitAndScheduleHostedPair,
  createDrainPrimedTransport,
  createHostedPairLiveComposition,
  createHostedRunPodObservationSource,
  createHostedRunPodPair,
} from "./hosted-pair-live-wiring";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const ids = {
  accountId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  generationRequestId: "33333333-3333-4333-8333-333333333333",
} as const;

async function endpointHash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function enabledEnvironment() {
  const mage = "mage-endpoint-production-01";
  const soulx = "soulx-endpoint-production-01";
  return {
    VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
    DATABASE_URL: "postgres-runtime-binding",
    VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres-reconciler-binding",
    VIDEOFORGE_DISPATCH_TOKEN_KEY: "d".repeat(32),
    VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: "hosted-dispatch-v1",
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: "ab".repeat(32),
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: "hosted-envelope-v1",
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "cd".repeat(32),
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: "hosted-proof-v1",
    VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "w".repeat(32),
    RUNPOD_API_KEY: "r".repeat(32),
    RUNPOD_API_BASE_URL: "https://api.runpod.ai/v2",
    VIDEOFORGE_MAGE_ENDPOINT_ID: mage,
    VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256: await endpointHash(mage),
    VIDEOFORGE_SOULX_ENDPOINT_ID: soulx,
    VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: await endpointHash(soulx),
  } as const;
}

async function admission() {
  return freezeV209ShortLiveAdmission(structuredClone(canonicalPlan), {
    databaseNow: "2026-08-26T01:00:00.000Z",
    providerObservedAt: "2026-08-26T00:59:30.000Z",
    rate: {
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "HIGH",
      secureReferenceRateMicroUsdPerGpuHour: 740_000,
      flexRateMicroUsdPerGpuHour: 1_100_000,
      checkedAt: "2026-08-26T00:59:30.000Z",
    },
    billing: {
      cumulativeEndpointBillingMicroUsd: 2_000_000,
      checkedAt: "2026-08-26T00:59:30.000Z",
    },
    phaseCapMicroUsd: 2_000_000,
    combinedCompletionCapMicroUsd: 17_500_000,
    redispatchAuthorized: false,
  });
}

function rows(providerJobId: string | null = "job-1") {
  return (["mage_image", "soulx_avatar"] as const).map((lane) => ({
    lane,
    attemptId: `${lane}-attempt`,
    attemptState: providerJobId === null ? "OUTBOXED" : "ASSIGNED",
    outboxState: providerJobId === null ? "READY_TO_DISPATCH" : "ASSIGNED",
    providerJobId: providerJobId === null ? null : `${lane}-${providerJobId}`,
    deploymentId: `${lane}-deployment`,
    dispatchTokenSha256: digest(lane === "mage_image" ? "a" : "b"),
    pairPhase: providerJobId === null ? "CLEANUP_ONLY" : "BOTH_ASSIGNED",
    recoveryAction: providerJobId === null ? "CLEANUP_ONLY" : "RECONCILE_ASSIGNED",
  }));
}

describe("hosted pair live provider wiring", () => {
  it("proves exact endpoint zero before the first dispatch and primes only once", async () => {
    const order: string[] = [];
    const confirmDrained = vi.fn(async () => {
      order.push("zero");
    });
    const run = vi.fn(async () => {
      order.push("run");
      return { id: "job-1" };
    });
    const transport = createDrainPrimedTransport({ confirmDrained } as never, {
      run,
      status: vi.fn(),
      cancel: vi.fn(),
    });
    const request = {
      endpointIdSha256: digest("a"),
      dispatchToken: "dt-0123456789abcdef0123456789abcdef",
      requestBodySha256: digest("b"),
      envelope: {},
    } as const;
    await transport.run(request);
    await transport.run(request);
    expect(order).toEqual(["zero", "zero", "run", "run"]);
    expect(confirmDrained).toHaveBeenCalledTimes(2);
    expect(confirmDrained).toHaveBeenCalledWith(30);
  });

  it("fails disabled before reading endpoint or provider credentials", async () => {
    await expect(
      createHostedRunPodPair({ VIDEOFORGE_GPU_TRANSPORT: "DISABLED_UNQUALIFIED" }),
    ).rejects.toMatchObject({ code: "HOSTED_PAIR_GPU_TRANSPORT_DISABLED" });
  });

  it("rejects reused key material and actual identical database principals before provider calls", async () => {
    const reused = {
      ...(await enabledEnvironment()),
      VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "d".repeat(32),
    };
    await expect(createHostedRunPodPair(reused)).rejects.toMatchObject({
      code: "HOSTED_PAIR_KEY_BINDINGS_NOT_SEPARATE",
    });
    const database = {
      transaction: vi.fn(async (callback: (executor: { query: () => unknown }) => unknown) =>
        callback({ query: async () => ({ rows: [{ principal: "same_login_role" }] }) }),
      ),
    };
    await expect(
      createHostedPairLiveComposition(
        await enabledEnvironment(),
        database as never,
        database as never,
      ),
    ).rejects.toMatchObject({ code: "HOSTED_PAIR_DATABASE_ROLES_NOT_SEPARATE" });
  });

  it("commits 0042 then schedules one deterministic Workflow without provider calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let scheduleReads = 0;
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("current_user")
        ? [{ principal: "runtime_login" }]
        : sql.includes("videoforge_load_hosted_pair_workflow_schedule")
          ? [
              {
                existing_pair: ++scheduleReads > 1,
                cancel_at: "2026-08-26T01:20:00.000Z",
                stop_at: "2026-08-26T01:30:00.000Z",
              },
            ]
          : sql.includes("videoforge_commit_hosted_atomic_pair_predispatch")
            ? (["mage_image", "soulx_avatar"] as const).map((lane, index) => ({
                lane,
                attempt_id: `${index + 1}1111111-1111-4111-8111-111111111111`,
                authority_id: `${index + 3}3333333-3333-4333-8333-333333333333`,
                outbox_id: `${index + 5}5555555-5555-4555-8555-555555555555`,
                dispatch_token: `dt-${lane}-${"x".repeat(40)}`,
                dispatch_token_sha256: digest("a"),
                unsigned_envelope: {},
                unsigned_envelope_sha256: digest("b"),
                request_body_sha256: digest("c"),
                endpoint_id_sha256: digest("d"),
                output_prefix: `private/${lane}`,
                authority_sha256: digest("e"),
                request_ttl_seconds: 300,
                deadline_at: "2026-08-26T01:20:00.000Z",
                reconciliation_deadline_at: "2026-08-26T01:30:00.000Z",
              }))
            : [],
    }));
    const runtimeDatabase = {
      transaction: vi.fn(async (callback: (executor: { query: typeof query }) => unknown) =>
        callback({ query }),
      ),
    };
    const workflow = {
      create: vi.fn(async ({ id }: { id?: string; params?: unknown }) => {
        if (workflow.create.mock.calls.length > 1) throw new Error("duplicate workflow");
        return { id: id! };
      }),
      get: vi.fn(async () => ({
        status: vi.fn(async () => ({ status: "running" })),
        sendEvent: vi.fn(async () => undefined),
      })),
    };
    const environment = { ...(await enabledEnvironment()), HOSTED_PAIR_WORKFLOW: workflow };
    const input = {
      approvalId: ids.accountId,
      approvalSha256: digest("1"),
      claimId: ids.workspaceId,
      accountId: ids.accountId,
      workspaceId: ids.workspaceId,
      projectId: "44444444-4444-4444-8444-444444444444",
      projectRevisionId: "55555555-5555-4555-8555-555555555555",
      generationRequestId: ids.generationRequestId,
      generationPlanSha256: digest("2"),
      leaseId: "66666666-6666-4666-8666-666666666666",
      laneBindings: {},
      totalCapUsd: 1,
      expiresAt: "2026-08-26T02:00:00.000Z",
      pair: {},
    };
    const reconcilerDatabase = {
      transaction: vi.fn(async (callback) =>
        callback({ query: async () => ({ rows: [{ principal: "reconciler_login" }] }) }),
      ),
    } as never;
    await expect(
      commitAndScheduleHostedPair(
        environment,
        runtimeDatabase as never,
        reconcilerDatabase,
        input,
        await admission(),
      ),
    ).resolves.toEqual({
      id: `hosted-pair-${ids.generationRequestId}`,
      recovered: false,
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("videoforge_commit_hosted_atomic_pair_predispatch"),
      ),
    ).toBe(true);
    expect(workflow.create).toHaveBeenCalledTimes(1);
    expect(workflow.create.mock.calls[0]?.[0].params).toMatchObject({
      cancelAt: "2026-08-26T01:20:00.000Z",
      stopAt: "2026-08-26T01:30:00.000Z",
    });
    await expect(
      commitAndScheduleHostedPair(
        environment,
        runtimeDatabase as never,
        reconcilerDatabase,
        input,
        await admission(),
      ),
    ).resolves.toEqual({ id: `hosted-pair-${ids.generationRequestId}`, recovered: true });
    expect(workflow.create).toHaveBeenCalledTimes(2);
    expect(workflow.get).toHaveBeenCalledWith(`hosted-pair-${ids.generationRequestId}`);
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes("videoforge_commit_hosted_atomic_pair_predispatch"),
      ),
    ).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("observes exact known jobs and never invents terminal state", async () => {
    const status = vi.fn(async () => ({ id: "job", status: "IN_PROGRESS" as const }));
    const source = createHostedRunPodObservationSource({
      mage_image: { status },
      soulx_avatar: { status },
    });
    await expect(
      source.observe({
        account_id: ids.accountId,
        workspace_id: ids.workspaceId,
        generation_request_id: ids.generationRequestId,
        lane: "mage_image",
        attempt_id: "attempt",
        deployment_id: "deployment",
        dispatch_token_sha256: digest("a"),
        provider_job_id: "job",
      }),
    ).rejects.toMatchObject({ code: "HOSTED_PAIR_PROVIDER_NOT_TERMINAL" });
    expect(status).toHaveBeenCalledWith("job");
  });

  it("polls both lanes, then cancels only exact known jobs after the bound", async () => {
    const status = vi.fn(async (id: string) => ({ id, status: "IN_PROGRESS" as const }));
    const cancel = vi.fn(async (id: string) => ({ id, status: "CANCELLED" as const }));
    const settle = { reconcile: vi.fn() };
    const reconciler = new HostedPairWorkflowReconciler(
      { inspect: vi.fn(async () => rows()) } as never,
      {
        mage_image: { status, cancel },
        soulx_avatar: { status, cancel },
      },
      settle as never,
      { mage_image: vi.fn(), soulx_avatar: vi.fn() },
    );
    await expect(reconciler.observe(ids, false)).resolves.toEqual({
      state: "WAITING",
      active: 2,
      unknown: 0,
    });
    expect(cancel).not.toHaveBeenCalled();
    await expect(reconciler.observe(ids, true)).resolves.toEqual({
      state: "CANCEL_REQUESTED",
      active: 2,
      unknown: 0,
    });
    expect(cancel.mock.calls.map(([id]) => id)).toEqual(["mage_image-job-1", "soulx_avatar-job-1"]);
    expect(settle.reconcile).not.toHaveBeenCalled();
  });

  it("preserves unknown status without cancel, resend, or settlement", async () => {
    const status = vi.fn(async () => {
      throw new ServerlessTransportError("STATUS_UNKNOWN");
    });
    const cancel = vi.fn();
    const settle = { reconcile: vi.fn() };
    const reconciler = new HostedPairWorkflowReconciler(
      { inspect: vi.fn(async () => rows()) } as never,
      {
        mage_image: { status, cancel },
        soulx_avatar: { status, cancel },
      },
      settle as never,
      { mage_image: vi.fn(), soulx_avatar: vi.fn() },
    );
    await expect(reconciler.observe(ids, true)).resolves.toEqual({
      state: "CANCEL_REQUESTED",
      active: 0,
      unknown: 2,
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(settle.reconcile).not.toHaveBeenCalled();
  });

  it("requires both exact endpoint drains before callback-barrier settlement", async () => {
    const status = vi.fn(async (id: string) => ({ id, status: "COMPLETED" as const }));
    const cancel = vi.fn();
    const settle = { reconcile: vi.fn(async () => ({ state: "SETTLED" })) };
    const mageDrain = vi.fn();
    const soulxDrain = vi.fn();
    const settlementGuard = vi.fn(async () => ({ guard: "exact" }));
    const reconciler = new HostedPairWorkflowReconciler(
      { inspect: vi.fn(async () => rows()) } as never,
      {
        mage_image: { status, cancel },
        soulx_avatar: { status, cancel },
      },
      settle as never,
      { mage_image: mageDrain, soulx_avatar: soulxDrain },
      settlementGuard,
    );
    await expect(reconciler.observe(ids, false)).resolves.toEqual({ state: "SETTLED" });
    expect(mageDrain).toHaveBeenCalledTimes(1);
    expect(soulxDrain).toHaveBeenCalledTimes(1);
    expect(settlementGuard).toHaveBeenCalledWith(ids);
    expect(settle.reconcile).toHaveBeenCalledWith({
      ...ids,
      zeroWorkerProofs: [{}, {}],
      settlementCostGuard: { guard: "exact" },
    });
  });

  it("fails closed before settlement when the V2-09 cost guard is absent", async () => {
    const status = vi.fn(async (id: string) => ({ id, status: "COMPLETED" as const }));
    const settle = { reconcile: vi.fn() };
    const reconciler = new HostedPairWorkflowReconciler(
      { inspect: vi.fn(async () => rows()) } as never,
      { mage_image: { status, cancel: vi.fn() }, soulx_avatar: { status, cancel: vi.fn() } },
      settle as never,
      {
        mage_image: vi.fn(async () => ({
          workersTotal: 0 as const,
          queuedJobs: 0 as const,
          observedAt: "2026-08-26T06:00:00.000Z",
        })),
        soulx_avatar: vi.fn(async () => ({
          workersTotal: 0 as const,
          queuedJobs: 0 as const,
          observedAt: "2026-08-26T06:00:00.000Z",
        })),
      },
    );
    await expect(reconciler.observe(ids, false)).rejects.toMatchObject({
      code: "HOSTED_V209_SETTLEMENT_GUARD_MISSING",
    });
    expect(settle.reconcile).not.toHaveBeenCalled();
  });

  it("resumes one deterministic Workflow and accepts only the DB-derived V2-09 terminal record", async () => {
    const status = vi.fn(async () => ({ state: "EXISTING" }));
    const get = vi.fn(async () => ({ status, sendEvent: vi.fn() }));
    const create = vi.fn();
    let attempt = 0;
    const terminal = {
      schemaVersion: "videoforge.v2-09-terminal-acceptance/v1",
      workflowId: `hosted-pair-${ids.generationRequestId}`,
      generationRequestId: ids.generationRequestId,
      accepted: true,
      terminal: true,
      zeroWorkersAfter: true,
      durationSeconds: 40,
      settledCostUsd: 0.75,
      evidenceSha256: digest("7"),
      resultSha256: digest("9"),
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("set_config")) return { rows: [{ set_config: ids.accountId }] };
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("not terminal"), { code: "23514" });
      return { rows: [{ value: terminal }] };
    });
    let clock = Date.parse("2026-08-26T06:00:00.000Z");
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });
    await expect(
      awaitV209TerminalAcceptance({
        workflow: { create, get },
        database: {
          transaction: (work: never) => (work as (value: unknown) => unknown)({ query }),
        } as never,
        scope: ids,
        workflowId: terminal.workflowId,
        chromeEvidenceSha256: digest("8"),
        deadlineAt: "2026-08-26T06:01:00.000Z",
        now: () => clock,
        sleep,
        pollIntervalMs: 1_000,
      }),
    ).resolves.toEqual(terminal);
    expect(create).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("complete_v209"))).toHaveLength(
      2,
    );
  });

  it("rejects a DB terminal row that omits the trusted V2-09 result contract", async () => {
    const value = {
      schemaVersion: "videoforge.v2-09-terminal-acceptance/v1",
      workflowId: `hosted-pair-${ids.generationRequestId}`,
      generationRequestId: ids.generationRequestId,
      resultSha256: digest("9"),
    };
    const query = vi.fn(async (sql: string) =>
      sql.includes("set_config") ? { rows: [{}] } : { rows: [{ value }] },
    );
    await expect(
      awaitV209TerminalAcceptance({
        workflow: {
          create: vi.fn(),
          get: vi.fn(async () => ({ status: vi.fn(), sendEvent: vi.fn() })),
        },
        database: {
          transaction: (work: never) => (work as (value: unknown) => unknown)({ query }),
        } as never,
        scope: ids,
        workflowId: value.workflowId,
        chromeEvidenceSha256: digest("8"),
        deadlineAt: "2026-08-26T06:01:00.000Z",
        now: () => Date.parse("2026-08-26T06:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "HOSTED_V209_TERMINAL_RESULT_INVALID" });
  });

  it("does not turn Workflow acknowledgement into V2-09 success", async () => {
    const status = vi.fn(async () => ({ state: "STARTED" }));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("set_config")) return { rows: [{}] };
      throw Object.assign(new Error("not terminal"), { code: "23514" });
    });
    let clock = Date.parse("2026-08-26T06:00:00.000Z");
    await expect(
      awaitV209TerminalAcceptance({
        workflow: { create: vi.fn(), get: vi.fn(async () => ({ status, sendEvent: vi.fn() })) },
        database: {
          transaction: (work: never) => (work as (value: unknown) => unknown)({ query }),
        } as never,
        scope: ids,
        workflowId: `hosted-pair-${ids.generationRequestId}`,
        chromeEvidenceSha256: digest("8"),
        deadlineAt: "2026-08-26T06:00:01.000Z",
        now: () => clock,
        sleep: vi.fn(async (milliseconds: number) => {
          clock += milliseconds;
        }),
        pollIntervalMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_V209_TERMINAL_DEADLINE_EXCEEDED" });
  });

  it("aborts a hung Workflow lookup at the absolute terminal deadline", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let lookupSignal: AbortSignal | undefined;
    const get = vi.fn((_workflowId: string, options?: { readonly signal?: AbortSignal }) => {
      lookupSignal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    await expect(
      awaitV209TerminalAcceptance({
        workflow: { create: vi.fn(), get },
        database: { transaction: vi.fn() } as never,
        scope: ids,
        workflowId: `hosted-pair-${ids.generationRequestId}`,
        chromeEvidenceSha256: digest("8"),
        deadlineAt,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_V209_TERMINAL_DEADLINE_EXCEEDED" });
    expect(get).toHaveBeenCalledOnce();
    expect(lookupSignal?.aborted).toBe(true);
  });

  it("aborts a hung DB transaction before any later poll", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let transactionSignal: AbortSignal | undefined;
    const transaction = vi.fn(
      (
        _work: (connection: never) => Promise<unknown>,
        options?: { readonly signal?: AbortSignal },
      ) => {
        transactionSignal = options?.signal;
        return new Promise<never>(() => undefined);
      },
    );
    const status = vi.fn(async () => ({ state: "EXISTING" }));
    await expect(
      awaitV209TerminalAcceptance({
        workflow: {
          create: vi.fn(),
          get: vi.fn(async () => ({ status, sendEvent: vi.fn() })),
        },
        database: { transaction } as never,
        scope: ids,
        workflowId: `hosted-pair-${ids.generationRequestId}`,
        chromeEvidenceSha256: digest("8"),
        deadlineAt,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_V209_TERMINAL_DEADLINE_EXCEEDED" });
    expect(status).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
    expect(transactionSignal?.aborted).toBe(true);
  });

  it("rejects a terminal row that resolves exactly at the deadline", async () => {
    const startMs = Date.now();
    const deadlineMs = startMs + 20;
    let currentMs = startMs;
    const status = vi.fn(async () => {
      currentMs = deadlineMs;
    });
    const transaction = vi.fn();
    await expect(
      awaitV209TerminalAcceptance({
        workflow: {
          create: vi.fn(),
          get: vi.fn(async () => ({ status, sendEvent: vi.fn() })),
        },
        database: { transaction } as never,
        scope: ids,
        workflowId: `hosted-pair-${ids.generationRequestId}`,
        chromeEvidenceSha256: digest("8"),
        deadlineAt: new Date(deadlineMs).toISOString(),
        now: () => currentMs,
      }),
    ).rejects.toMatchObject({ code: "HOSTED_V209_TERMINAL_DEADLINE_EXCEEDED" });
    expect(status).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });
});
