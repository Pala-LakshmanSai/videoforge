import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { ServerlessTransportError, type ServerlessTransportPort } from "@videoforge/control-plane";
import { canonicalizeJsonToUtf8, sha256CanonicalJson, type JsonValue } from "@videoforge/contracts";

import { createHostedEnvelopePairSigner } from "./hosted-envelope-signer";
import { HostedSqlAtomicPairPredispatch } from "./hosted-atomic-pair-predispatch";
import type { HostedWorkflowBinding } from "./configuration";
import {
  HostedPairProductionComposition,
  HostedPairProductionReconciler,
  HostedSqlPairActivationStore,
  HostedSqlPairReconstructionStore,
  HostedSqlPairSettlementStore,
  createHostedHmacProviderProofAuthority,
  hostedPairDocumentVerifier,
  hostedPairProductionBindingState,
  type HostedPairProductionBindingEnvironment,
  type HostedProviderObservationSource,
} from "./hosted-pair-production-composition";
import {
  HostedPairRuntimeExecutor,
  HostedSqlPairRuntimeStore,
  type HostedPairInspection,
  type HostedPairLane,
} from "./hosted-pair-runtime-executor";
import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";
import { RunPodDrainGuard, RunPodServerlessJobClient } from "../providers/runpod-control";
import { RunPodServerlessTransport } from "../providers/runpod-serverless-transport";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u;
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

export interface HostedPairLiveEnvironment extends HostedPairProductionBindingEnvironment {
  readonly VIDEOFORGE_PROVIDER_PROOF_KEY_ID?: string;
  readonly RUNPOD_API_KEY?: string;
  readonly VIDEOFORGE_MAGE_ENDPOINT_ID?: string;
  readonly VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256?: string;
  readonly VIDEOFORGE_SOULX_ENDPOINT_ID?: string;
  readonly VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256?: string;
}

export interface HostedPairWorkflowScope {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
}

export interface HostedPairWorkflowParameters extends HostedPairWorkflowScope {
  readonly cancelAt: string;
  readonly stopAt: string;
}

type HostedPairPredispatchInput = Omit<
  Parameters<HostedSqlAtomicPairPredispatch["commit"]>[0],
  "dispatchTokenKey"
>;

type LaneClients = Readonly<Record<HostedPairLane, RunPodServerlessJobClient>>;

export function createDrainPrimedTransport(
  client: Pick<RunPodServerlessJobClient, "confirmDrained">,
  transport: ServerlessTransportPort,
): ServerlessTransportPort {
  let primed = false;
  return Object.freeze({
    async run(request: Parameters<ServerlessTransportPort["run"]>[0]) {
      if (!primed) {
        await client.confirmDrained(30);
        await client.confirmDrained(30);
        primed = true;
      }
      return transport.run(request);
    },
    status: (providerJobId: string) => transport.status(providerJobId),
    cancel: (providerJobId: string) => transport.cancel(providerJobId),
  });
}

async function hashEndpointId(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function hashSecret(value: string): Promise<string> {
  return hashEndpointId(value);
}

function exact(value: string | undefined, code: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 3)
    throw new HostedDispatchCoordinationError(code);
  return value;
}

export async function assertHostedPairLiveBindings(environment: HostedPairLiveEnvironment) {
  if (hostedPairProductionBindingState(environment).state === "DISABLED_UNQUALIFIED")
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_GPU_TRANSPORT_DISABLED");
  if (environment.RUNPOD_API_BASE_URL !== "https://api.runpod.ai/v2")
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_RUNPOD_BASE_URL_INVALID");
  const keyIds = [
    exact(environment.VIDEOFORGE_DISPATCH_TOKEN_KEY_ID, "HOSTED_PAIR_KEY_BINDINGS_INVALID"),
    exact(environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID, "HOSTED_PAIR_KEY_BINDINGS_INVALID"),
    exact(environment.VIDEOFORGE_PROVIDER_PROOF_KEY_ID, "HOSTED_PAIR_KEY_BINDINGS_INVALID"),
  ];
  const materials = [
    exact(environment.VIDEOFORGE_DISPATCH_TOKEN_KEY, "HOSTED_PAIR_KEY_BINDINGS_INVALID"),
    exact(environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX, "HOSTED_PAIR_KEY_BINDINGS_INVALID"),
    exact(environment.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY, "HOSTED_PAIR_KEY_BINDINGS_INVALID"),
  ];
  const materialHashes = await Promise.all(materials.map(hashSecret));
  if (new Set(keyIds).size !== 3 || new Set(materialHashes).size !== 3)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_KEY_BINDINGS_NOT_SEPARATE");
  return Object.freeze({
    keyIds: Object.freeze(keyIds),
    materialHashes: Object.freeze(materialHashes),
  });
}

/** Constructed only after the disabled-first binding gate. Raw endpoint IDs and the API key stay
 * inside the concrete clients; callers receive only provider-neutral transports and observers. */
export async function createHostedRunPodPair(environment: HostedPairLiveEnvironment): Promise<{
  readonly clients: LaneClients;
  readonly transports: Readonly<Record<HostedPairLane, ServerlessTransportPort>>;
}> {
  await assertHostedPairLiveBindings(environment);
  const apiKey = exact(environment.RUNPOD_API_KEY, "HOSTED_PAIR_RUNPOD_BINDINGS_INVALID");
  const endpoints = {
    mage_image: exact(
      environment.VIDEOFORGE_MAGE_ENDPOINT_ID,
      "HOSTED_PAIR_RUNPOD_BINDINGS_INVALID",
    ),
    soulx_avatar: exact(
      environment.VIDEOFORGE_SOULX_ENDPOINT_ID,
      "HOSTED_PAIR_RUNPOD_BINDINGS_INVALID",
    ),
  } as const;
  const hashes = {
    mage_image: exact(
      environment.VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256,
      "HOSTED_PAIR_RUNPOD_BINDINGS_INVALID",
    ),
    soulx_avatar: exact(
      environment.VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256,
      "HOSTED_PAIR_RUNPOD_BINDINGS_INVALID",
    ),
  } as const;
  for (const lane of ["mage_image", "soulx_avatar"] as const) {
    if (!ENDPOINT_ID.test(endpoints[lane]) || !SHA256.test(hashes[lane]))
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_RUNPOD_BINDINGS_INVALID");
    if ((await hashEndpointId(endpoints[lane])) !== hashes[lane])
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_RUNPOD_ENDPOINT_HASH_MISMATCH");
  }
  if (endpoints.mage_image === endpoints.soulx_avatar || hashes.mage_image === hashes.soulx_avatar)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_RUNPOD_ENDPOINTS_NOT_SEPARATE");
  const clients = Object.freeze({
    mage_image: new RunPodServerlessJobClient({
      apiKey,
      endpointId: endpoints.mage_image,
      guard: new RunPodDrainGuard(),
      baseUrl: environment.RUNPOD_API_BASE_URL,
    }),
    soulx_avatar: new RunPodServerlessJobClient({
      apiKey,
      endpointId: endpoints.soulx_avatar,
      guard: new RunPodDrainGuard(),
      baseUrl: environment.RUNPOD_API_BASE_URL,
    }),
  });
  return Object.freeze({
    clients,
    transports: Object.freeze({
      mage_image: createDrainPrimedTransport(
        clients.mage_image,
        new RunPodServerlessTransport(clients.mage_image, hashes.mage_image),
      ),
      soulx_avatar: createDrainPrimedTransport(
        clients.soulx_avatar,
        new RunPodServerlessTransport(clients.soulx_avatar, hashes.soulx_avatar),
      ),
    }),
  });
}

/** Concrete 0042 -> durable Workflow handoff. The provider binding preflight only constructs
 * clients; it performs no network request. PostgreSQL atomically rechecks paid approval and both
 * lane qualifications before creating the pair, then a deterministic Workflow ID owns 0043.
 * A retry after a lost Workflow create response verifies that exact ID rather than creating a new
 * coordinator. */
export async function commitAndScheduleHostedPair(
  environment: HostedPairLiveEnvironment & {
    readonly HOSTED_PAIR_WORKFLOW?: HostedWorkflowBinding;
  },
  runtimeDatabase: TransactionalSqlExecutor,
  reconcilerDatabase: TransactionalSqlExecutor,
  input: HostedPairPredispatchInput,
): Promise<{ readonly id: string; readonly recovered: boolean }> {
  await assertHostedPairLiveBindings(environment);
  await assertHostedPairDatabasePrincipals(runtimeDatabase, reconcilerDatabase);
  await createHostedRunPodPair(environment);
  const workflow = environment.HOSTED_PAIR_WORKFLOW;
  if (!workflow) throw new HostedDispatchCoordinationError("HOSTED_PAIR_WORKFLOW_BINDING_MISSING");
  const loadSchedule = () => runtimeDatabase.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      input.accountId,
    ]);
    const result = await transaction.query<{
      existing_pair: boolean;
      cancel_at: string | Date;
      stop_at: string | Date;
    }>("SELECT * FROM public.videoforge_load_hosted_pair_workflow_schedule($1,$2,$3)", [
      input.accountId,
      input.workspaceId,
      input.generationRequestId,
    ]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row)
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_WORKFLOW_DEADLINE_INVALID");
    return Object.freeze({
      existingPair: row.existing_pair,
      cancelAt: new Date(row.cancel_at).toISOString(),
      stopAt: new Date(row.stop_at).toISOString(),
    });
  });
  const preflightSchedule = await loadSchedule();
  if (Date.parse(preflightSchedule.stopAt) - Date.parse(preflightSchedule.cancelAt) !== 10 * 60 * 1_000)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_WORKFLOW_DEADLINE_INVALID");
  const dispatchTokenKey = exact(
    environment.VIDEOFORGE_DISPATCH_TOKEN_KEY,
    "HOSTED_PAIR_PRODUCTION_BINDINGS_MISSING",
  );
  if (!preflightSchedule.existingPair) {
    const committed = await new HostedSqlAtomicPairPredispatch(runtimeDatabase).commit({
      ...input,
      dispatchTokenKey,
    });
    if (committed.length !== 2)
      throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_INVALID");
  }
  const schedule = await loadSchedule();
  if (!schedule.existingPair || Date.parse(schedule.stopAt) - Date.parse(schedule.cancelAt) !== 10 * 60 * 1_000)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_WORKFLOW_DEADLINE_INVALID");
  const id = `hosted-pair-${input.generationRequestId}`;
  const params: HostedPairWorkflowParameters = Object.freeze({
    accountId: input.accountId,
    workspaceId: input.workspaceId,
    generationRequestId: input.generationRequestId,
    cancelAt: schedule.cancelAt,
    stopAt: schedule.stopAt,
  });
  try {
    const created = await workflow.create({ id, params });
    if (created.id !== id)
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_WORKFLOW_ID_MISMATCH");
    return Object.freeze({ id, recovered: false });
  } catch (error) {
    if (error instanceof HostedDispatchCoordinationError) throw error;
    const existing = await workflow.get(id);
    await existing.status();
    return Object.freeze({ id, recovered: true });
  }
}

export function createHostedRunPodObservationSource(
  transports: Readonly<Record<HostedPairLane, Pick<ServerlessTransportPort, "status">>>,
  now: () => string = () => new Date().toISOString(),
): HostedProviderObservationSource {
  return Object.freeze({
    async observe(input: Parameters<HostedProviderObservationSource["observe"]>[0]) {
      if (input.provider_job_id === null)
        return Object.freeze({
          providerState: "ABSENT" as const,
          observedAt: now(),
          nonce: crypto.randomUUID().replaceAll("-", ""),
        });
      const observed = await transports[input.lane].status(input.provider_job_id);
      if (!TERMINAL.has(observed.status))
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_PROVIDER_NOT_TERMINAL");
      return Object.freeze({
        providerState: observed.status as "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT",
        observedAt: now(),
        nonce: crypto.randomUUID().replaceAll("-", ""),
      });
    },
  });
}

export type HostedPairWorkflowObservation =
  | { readonly state: "SETTLED" }
  | { readonly state: "WAITING"; readonly active: number; readonly unknown: number }
  | { readonly state: "CANCEL_REQUESTED"; readonly active: number; readonly unknown: number };

/** One durable Workflow observation. It never sends. Unknown assignment identity is held for
 * operator reconciliation; known active jobs are polled and, only after the bounded deadline,
 * cancelled by exact provider job ID. Settlement performs the callback/output-barrier check. */
export class HostedPairWorkflowReconciler {
  constructor(
    private readonly inspection: Pick<HostedSqlPairRuntimeStore, "inspect">,
    private readonly transports: Readonly<
      Record<HostedPairLane, Pick<ServerlessTransportPort, "status" | "cancel">>
    >,
    private readonly settle: HostedPairProductionReconciler,
    private readonly confirmDrained: Readonly<
      Record<
        HostedPairLane,
        () => Promise<{
          readonly workersTotal: 0;
          readonly queuedJobs: 0;
          readonly observedAt: string;
        }>
      >
    >,
    private readonly signZeroProof: (
      lane: HostedPairLane,
      scope: HostedPairWorkflowScope,
      observation: {
        readonly workersTotal: 0;
        readonly queuedJobs: 0;
        readonly observedAt: string;
      },
    ) => Promise<JsonValue> = async () => ({}),
  ) {}

  async observe(scope: HostedPairWorkflowScope, cancelKnownActive: boolean) {
    const rows = await this.inspection.inspect(scope);
    let active = 0;
    let unknown = 0;
    let allTerminal = true;
    for (const row of rows) {
      if (row.providerJobId === null) {
        if (!this.#provablyAbsent(row)) unknown += 1;
        continue;
      }
      try {
        const status = await this.transports[row.lane].status(row.providerJobId);
        if (!TERMINAL.has(status.status)) {
          allTerminal = false;
          active += 1;
          if (cancelKnownActive) await this.transports[row.lane].cancel(row.providerJobId);
        }
      } catch (error) {
        allTerminal = false;
        unknown += 1;
        if (!(error instanceof ServerlessTransportError) || error.code !== "STATUS_UNKNOWN")
          throw error;
      }
    }
    if (unknown > 0 || !allTerminal) {
      return Object.freeze({
        state: cancelKnownActive ? ("CANCEL_REQUESTED" as const) : ("WAITING" as const),
        active,
        unknown,
      });
    }
    const drained = await Promise.all([
      this.confirmDrained.mage_image(),
      this.confirmDrained.soulx_avatar(),
    ]);
    const zeroWorkerProofs = await Promise.all([
      this.signZeroProof("mage_image", scope, drained[0]),
      this.signZeroProof("soulx_avatar", scope, drained[1]),
    ]);
    await this.settle.reconcile({ ...scope, zeroWorkerProofs });
    return Object.freeze({ state: "SETTLED" as const });
  }

  #provablyAbsent(row: HostedPairInspection): boolean {
    return (
      row.recoveryAction === "CLEANUP_ONLY" &&
      ((row.attemptState === "OUTBOXED" && row.outboxState === "READY_TO_DISPATCH") ||
        (row.attemptState === "PERMANENT_FAILED" && row.outboxState === "DEAD_LETTER"))
    );
  }
}

async function assertHostedPairDatabasePrincipals(
  runtimeDatabase: TransactionalSqlExecutor,
  reconcilerDatabase: TransactionalSqlExecutor,
) {
  const [runtimePrincipal, reconcilerPrincipal] = await Promise.all(
    [runtimeDatabase, reconcilerDatabase].map((database) =>
      database.transaction(async (transaction) => {
        const result = await transaction.query<{ principal: string }>(
          "SELECT current_user AS principal",
        );
        const principal = result.rows[0]?.principal;
        if (result.rows.length !== 1 || typeof principal !== "string" || principal.length < 3)
          throw new HostedDispatchCoordinationError("HOSTED_PAIR_DATABASE_PRINCIPAL_INVALID");
        return principal;
      }),
    ),
  );
  if (runtimePrincipal === reconcilerPrincipal)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_DATABASE_ROLES_NOT_SEPARATE");
  return Object.freeze({ runtimePrincipal, reconcilerPrincipal });
}

export async function createHostedPairLiveComposition(
  environment: HostedPairLiveEnvironment,
  runtimeDatabase: TransactionalSqlExecutor,
  reconcilerDatabase: TransactionalSqlExecutor,
) {
  await assertHostedPairDatabasePrincipals(runtimeDatabase, reconcilerDatabase);
  const provider = await createHostedRunPodPair(environment);
  const signer = createHostedEnvelopePairSigner({
    secretHex: exact(
      environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX,
      "HOSTED_PAIR_PRODUCTION_BINDINGS_MISSING",
    ),
    keyId: exact(
      environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID,
      "HOSTED_PAIR_PRODUCTION_BINDINGS_MISSING",
    ),
  });
  const runtimeStore = new HostedSqlPairRuntimeStore(runtimeDatabase);
  const composition = new HostedPairProductionComposition(
    new HostedSqlPairActivationStore(runtimeDatabase),
    new HostedSqlPairReconstructionStore(runtimeDatabase),
    new HostedPairRuntimeExecutor(
      runtimeStore,
      provider.transports,
      hostedPairDocumentVerifier(signer),
    ),
    signer,
    runtimeStore,
  );
  const proofAuthority = createHostedHmacProviderProofAuthority(
    createHostedRunPodObservationSource(provider.transports),
    {
      secretHex: exact(
        environment.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY,
        "HOSTED_PAIR_PRODUCTION_BINDINGS_MISSING",
      ),
      keyId: exact(
        environment.VIDEOFORGE_PROVIDER_PROOF_KEY_ID,
        "HOSTED_PAIR_PRODUCTION_BINDINGS_MISSING",
      ),
    },
  );
  const reconcilerStore = new HostedSqlPairRuntimeStore(reconcilerDatabase);
  const settlement = new HostedPairProductionReconciler(
    reconcilerStore,
    proofAuthority,
    proofAuthority,
    new HostedSqlPairSettlementStore(reconcilerDatabase),
  );
  const signZeroProof = async (
    lane: HostedPairLane,
    scope: HostedPairWorkflowScope,
    observation: { readonly workersTotal: 0; readonly queuedJobs: 0; readonly observedAt: string },
  ) => {
    const unsigned = {
      schema_version: "videoforge-hosted-zero-worker-proof/v1" as const,
      account_id: scope.accountId,
      workspace_id: scope.workspaceId,
      generation_request_id: scope.generationRequestId,
      lane,
      endpoint_id_sha256:
        lane === "mage_image"
          ? environment.VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256!
          : environment.VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256!,
      workers_total: observation.workersTotal,
      queued_jobs: observation.queuedJobs,
      observed_at: observation.observedAt,
    };
    const secretHex = environment.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY!;
    const secret = Uint8Array.from({ length: secretHex.length / 2 }, (_, index) =>
      Number.parseInt(secretHex.slice(index * 2, index * 2 + 2), 16),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureValue = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, canonicalizeJsonToUtf8(unsigned))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    return Object.freeze({
      ...unsigned,
      proof_sha256: await sha256CanonicalJson(unsigned),
      signature_key_id: environment.VIDEOFORGE_PROVIDER_PROOF_KEY_ID!,
      signature_value: signatureValue,
      signature_sha256: await hashSecret(signatureValue),
    });
  };
  return Object.freeze({
    composition,
    reconciler: new HostedPairWorkflowReconciler(
      reconcilerStore,
      provider.transports,
      settlement,
      Object.freeze({
        mage_image: async () => {
          await provider.clients.mage_image.confirmDrained(30);
          return provider.clients.mage_image.confirmDrained(30);
        },
        soulx_avatar: async () => {
          await provider.clients.soulx_avatar.confirmDrained(30);
          return provider.clients.soulx_avatar.confirmDrained(30);
        },
      }),
      signZeroProof,
    ),
  });
}
