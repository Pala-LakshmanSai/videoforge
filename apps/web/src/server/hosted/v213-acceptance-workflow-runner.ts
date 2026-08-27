export const V213_ACCEPTANCE_OPERATIONS = Object.freeze([
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
] as const);

export type V213AcceptanceOperation = (typeof V213_ACCEPTANCE_OPERATIONS)[number];
export type V213AcceptanceCheckpoint = "V2-10" | "V2-11" | "V2-12" | "V2-13";

const OPERATION_CHECKPOINT = Object.freeze({
  "v2-10-operator-free-ranga-pilot": "V2-10",
  "v2-11-two-concurrent-owned-projects": "V2-11",
  "v2-12-long-output": "V2-12",
  "v2-13-final-two-lane-smoke": "V2-13",
} satisfies Readonly<Record<V213AcceptanceOperation, V213AcceptanceCheckpoint>>);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/u;
const MAX_OBSERVATIONS = 7_200;

export interface V213AcceptanceWorkflowParameters extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-acceptance-workflow-params/v1";
  readonly kind: "V213_DATABASE_ACCEPTANCE";
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213AcceptanceOperation;
  readonly checkpoint: V213AcceptanceCheckpoint;
  readonly workflowId: string;
  readonly requestSha256: `sha256:${string}`;
}

export interface V213AcceptanceWorkflowScope extends Record<string, unknown> {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly cancelAt: string;
  readonly stopAt: string;
}

export interface V213AcceptanceWorkflowOutput extends Record<string, unknown> {
  readonly rawEvidence: Readonly<Record<string, unknown>>;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly cleanup: Readonly<Record<string, unknown>>;
}

export interface V213AcceptanceFairnessProbe extends Record<string, unknown> {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
}

export interface V213AcceptanceWorkflowPlan extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-acceptance-workflow-plan/v1";
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213AcceptanceOperation;
  readonly checkpoint: V213AcceptanceCheckpoint;
  readonly workflowId: string;
  readonly requestSha256: `sha256:${string}`;
  readonly workloadDeadlineAt: string;
  readonly pollIntervalMs: number;
  readonly scopes: readonly V213AcceptanceWorkflowScope[];
  readonly sameAccountWaiter: V213AcceptanceFairnessProbe | null;
  readonly fairnessProbe: V213AcceptanceFairnessProbe | null;
  readonly output: V213AcceptanceWorkflowOutput | null;
}

export interface V213AcceptanceWorkflowState extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-acceptance-workflow-state/v1";
  readonly databaseNow: string;
  readonly phase:
    | "PAIR_EXECUTION"
    | "V211_WAITING_PROBES"
    | "V211_FAIR_PROMOTION"
    | "V211_CANCEL_RECONCILIATION"
    | "V211_MAX1_RESTORE"
    | "TECHNICAL_CAPTURE"
    | "PAUSED_AWAITING_OPERATOR_EVIDENCE"
    | "ZERO_WORKER_READS"
    | "BILLING_SETTLEMENT"
    | "COMPLETE"
    | "CLEANUP_ONLY";
  readonly cancelRequested: boolean;
  readonly terminal: boolean;
  readonly zeroWorkerReadCount: 0 | 1 | 2 | 3;
  readonly output: V213AcceptanceWorkflowOutput | null;
}

export interface V213AcceptanceWorkflowRunnerPort {
  /** Atomically claims and reads the exact persisted JIT materialization. */
  claim(parameters: V213AcceptanceWorkflowParameters): Promise<unknown>;
  /** Resumes only DB-prepared pair outboxes. It must never prepare or redispatch caller data. */
  resumePreparedPairs(plan: V213AcceptanceWorkflowPlan): Promise<void>;
  /** Reconciles exact known provider jobs and returns a fresh DB-owned readback. */
  observePreparedPairs(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Applies the exact temporary max-two policy and records provider readbacks before pair resume. */
  prepareV211Scenario(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Advances exactly one DB-authorized wait/promotion/cancel-reconciliation action. */
  advanceV211Scenario(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Drains both lanes, restores exact max-one policy, records readback, and proves zero workers. */
  restoreV211MaxOne(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Captures exact current-run R2 result bytes and read-only provider terminal measurements. */
  captureTechnicalEvidence(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Creates the exact output-bound V2-10/V2-12 evidence request only after SQL exposes pause. */
  requestOperatorEvidence(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Captures one live aggregate zero-worker/job read and persists it append-only. */
  captureZeroWorkerRead(plan: V213AcceptanceWorkflowPlan, ordinal: 0 | 1 | 2): Promise<unknown>;
  /** Projects and persists terminal output only from exact durable current-run source facts. */
  finalizeAcceptanceOutput(plan: V213AcceptanceWorkflowPlan): Promise<unknown>;
  /** Pure durable readback; used after every mutation-capable phase. */
  read(parameters: V213AcceptanceWorkflowParameters): Promise<unknown>;
}

export interface V213AcceptanceDurableStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: number): Promise<void>;
}

function keys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function iso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

export function parseV213AcceptanceWorkflowParameters(
  value: unknown,
): V213AcceptanceWorkflowParameters {
  const parsed = object(value, "V213_ACCEPTANCE_WORKFLOW_PARAMS_INVALID");
  const operationId = parsed.operationId as V213AcceptanceOperation;
  if (
    !keys(parsed, [
      "checkpoint",
      "fullLiveAuthorityId",
      "kind",
      "operationId",
      "requestSha256",
      "schemaVersion",
      "workflowId",
    ]) ||
    parsed.schemaVersion !== "videoforge.v213-acceptance-workflow-params/v1" ||
    parsed.kind !== "V213_DATABASE_ACCEPTANCE" ||
    !V213_ACCEPTANCE_OPERATIONS.includes(operationId) ||
    parsed.checkpoint !== OPERATION_CHECKPOINT[operationId] ||
    typeof parsed.fullLiveAuthorityId !== "string" ||
    !UUID.test(parsed.fullLiveAuthorityId) ||
    typeof parsed.workflowId !== "string" ||
    !WORKFLOW_ID.test(parsed.workflowId) ||
    typeof parsed.requestSha256 !== "string" ||
    !SHA256.test(parsed.requestSha256)
  )
    throw new Error("V213_ACCEPTANCE_WORKFLOW_PARAMS_INVALID");
  return Object.freeze({ ...parsed }) as unknown as V213AcceptanceWorkflowParameters;
}

function parseOutput(value: unknown): V213AcceptanceWorkflowOutput | null {
  if (value === null) return null;
  const output = object(value, "V213_ACCEPTANCE_WORKFLOW_OUTPUT_INVALID");
  if (!keys(output, ["cleanup", "rawEvidence", "receipt"]))
    throw new Error("V213_ACCEPTANCE_WORKFLOW_OUTPUT_INVALID");
  for (const field of ["rawEvidence", "receipt", "cleanup"] as const)
    object(output[field], "V213_ACCEPTANCE_WORKFLOW_OUTPUT_INVALID");
  return Object.freeze({ ...output }) as unknown as V213AcceptanceWorkflowOutput;
}

function parseScope(value: unknown): V213AcceptanceWorkflowScope {
  const scope = object(value, "V213_ACCEPTANCE_WORKFLOW_SCOPE_INVALID");
  if (
    !keys(scope, [
      "accountId",
      "cancelAt",
      "generationRequestId",
      "projectId",
      "projectRevisionId",
      "stopAt",
      "workspaceId",
    ]) ||
    ![
      scope.accountId,
      scope.workspaceId,
      scope.projectId,
      scope.projectRevisionId,
      scope.generationRequestId,
    ].every((field) => typeof field === "string" && UUID.test(field)) ||
    !iso(scope.cancelAt) ||
    !iso(scope.stopAt) ||
    Date.parse(scope.cancelAt) >= Date.parse(scope.stopAt)
  )
    throw new Error("V213_ACCEPTANCE_WORKFLOW_SCOPE_INVALID");
  return Object.freeze({ ...scope }) as unknown as V213AcceptanceWorkflowScope;
}

function parseFairnessProbe(value: unknown): V213AcceptanceFairnessProbe | null {
  if (value === null) return null;
  const probe = object(value, "V213_ACCEPTANCE_FAIRNESS_PROBE_INVALID");
  if (
    !keys(probe, [
      "accountId",
      "generationRequestId",
      "projectId",
      "projectRevisionId",
      "workspaceId",
    ]) ||
    ![
      probe.accountId,
      probe.workspaceId,
      probe.projectId,
      probe.projectRevisionId,
      probe.generationRequestId,
    ].every((field) => typeof field === "string" && UUID.test(field))
  )
    throw new Error("V213_ACCEPTANCE_FAIRNESS_PROBE_INVALID");
  return Object.freeze({ ...probe }) as unknown as V213AcceptanceFairnessProbe;
}

export function parseV213AcceptanceWorkflowPlan(
  value: unknown,
  parameters: V213AcceptanceWorkflowParameters,
): V213AcceptanceWorkflowPlan {
  const plan = object(value, "V213_ACCEPTANCE_WORKFLOW_PLAN_INVALID");
  if (
    !keys(plan, [
      "checkpoint",
      "fairnessProbe",
      "fullLiveAuthorityId",
      "operationId",
      "output",
      "pollIntervalMs",
      "requestSha256",
      "sameAccountWaiter",
      "schemaVersion",
      "scopes",
      "workloadDeadlineAt",
      "workflowId",
    ]) ||
    plan.schemaVersion !== "videoforge.v213-acceptance-workflow-plan/v1" ||
    plan.fullLiveAuthorityId !== parameters.fullLiveAuthorityId ||
    plan.operationId !== parameters.operationId ||
    plan.checkpoint !== parameters.checkpoint ||
    plan.workflowId !== parameters.workflowId ||
    plan.requestSha256 !== parameters.requestSha256 ||
    !iso(plan.workloadDeadlineAt) ||
    !Number.isInteger(plan.pollIntervalMs) ||
    Number(plan.pollIntervalMs) < 250 ||
    Number(plan.pollIntervalMs) > 10_000 ||
    !Array.isArray(plan.scopes)
  )
    throw new Error("V213_ACCEPTANCE_WORKFLOW_PLAN_INVALID");
  const scopes = plan.scopes.map(parseScope);
  const sameAccountWaiter = parseFairnessProbe(plan.sameAccountWaiter);
  const fairnessProbe = parseFairnessProbe(plan.fairnessProbe);
  const expectedScopeCount = parameters.checkpoint === "V2-11" ? 2 : 1;
  const distinct = (field: keyof V213AcceptanceWorkflowScope) =>
    new Set(scopes.map((scope) => scope[field])).size === scopes.length;
  if (
    scopes.length !== expectedScopeCount ||
    (parameters.checkpoint === "V2-11") !== Boolean(fairnessProbe) ||
    (parameters.checkpoint === "V2-11") !== Boolean(sameAccountWaiter) ||
    (parameters.checkpoint === "V2-11" &&
      !["accountId", "workspaceId", "projectId", "projectRevisionId", "generationRequestId"].every(
        (field) => distinct(field as keyof V213AcceptanceWorkflowScope),
      )) ||
    scopes.some(
      (scope) => Date.parse(scope.stopAt) > Date.parse(String(plan.workloadDeadlineAt)),
    ) ||
    (sameAccountWaiter !== null &&
      (sameAccountWaiter.accountId !== scopes[0]?.accountId ||
        sameAccountWaiter.workspaceId !== scopes[0]?.workspaceId ||
        sameAccountWaiter.projectId !== scopes[0]?.projectId ||
        sameAccountWaiter.projectRevisionId !== scopes[0]?.projectRevisionId ||
        scopes.some(
          (scope) => scope.generationRequestId === sameAccountWaiter.generationRequestId,
        ))) ||
    (fairnessProbe !== null &&
      ["accountId", "workspaceId", "projectId", "projectRevisionId", "generationRequestId"].some(
        (field) =>
          scopes.some(
            (scope) =>
              scope[field as keyof V213AcceptanceWorkflowScope] ===
              fairnessProbe[field as keyof V213AcceptanceFairnessProbe],
          ),
      ))
  )
    throw new Error("V213_ACCEPTANCE_WORKFLOW_SCOPE_INVALID");
  return Object.freeze({
    ...plan,
    scopes: Object.freeze(scopes),
    sameAccountWaiter,
    fairnessProbe,
    output: parseOutput(plan.output),
  }) as unknown as V213AcceptanceWorkflowPlan;
}

export function parseV213AcceptanceWorkflowState(
  value: unknown,
  plan: V213AcceptanceWorkflowPlan,
): V213AcceptanceWorkflowState {
  const state = object(value, "V213_ACCEPTANCE_WORKFLOW_STATE_INVALID");
  const output = parseOutput(state.output);
  const phases = [
    "PAIR_EXECUTION",
    "V211_WAITING_PROBES",
    "V211_FAIR_PROMOTION",
    "V211_CANCEL_RECONCILIATION",
    "V211_MAX1_RESTORE",
    "TECHNICAL_CAPTURE",
    "PAUSED_AWAITING_OPERATOR_EVIDENCE",
    "ZERO_WORKER_READS",
    "BILLING_SETTLEMENT",
    "COMPLETE",
    "CLEANUP_ONLY",
  ];
  if (
    !keys(state, [
      "cancelRequested",
      "databaseNow",
      "output",
      "phase",
      "schemaVersion",
      "terminal",
      "zeroWorkerReadCount",
    ]) ||
    state.schemaVersion !== "videoforge.v213-acceptance-workflow-state/v1" ||
    !iso(state.databaseNow) ||
    !phases.includes(String(state.phase)) ||
    typeof state.cancelRequested !== "boolean" ||
    typeof state.terminal !== "boolean" ||
    !Number.isInteger(state.zeroWorkerReadCount) ||
    Number(state.zeroWorkerReadCount) < 0 ||
    Number(state.zeroWorkerReadCount) > 3 ||
    ([
      "PAIR_EXECUTION",
      "V211_WAITING_PROBES",
      "V211_FAIR_PROMOTION",
      "V211_CANCEL_RECONCILIATION",
      "V211_MAX1_RESTORE",
      "TECHNICAL_CAPTURE",
      "PAUSED_AWAITING_OPERATOR_EVIDENCE",
    ].includes(String(state.phase)) &&
      state.zeroWorkerReadCount !== 0) ||
    (state.phase === "ZERO_WORKER_READS" && Number(state.zeroWorkerReadCount) >= 3) ||
    (["BILLING_SETTLEMENT", "COMPLETE"].includes(String(state.phase)) &&
      state.zeroWorkerReadCount !== 3) ||
    state.terminal !== (state.phase === "COMPLETE" && Boolean(output)) ||
    (state.phase === "COMPLETE") !== Boolean(output) ||
    (Date.parse(state.databaseNow) >= Date.parse(plan.workloadDeadlineAt) && !state.cancelRequested)
  )
    throw new Error("V213_ACCEPTANCE_WORKFLOW_STATE_INVALID");
  return Object.freeze({ ...state, output }) as unknown as V213AcceptanceWorkflowState;
}

/**
 * Runs only a DB-owned acceptance plan. Every external phase is a serial durable `step.do`; the
 * runner never imports or calls the high-level V213 live transport and therefore cannot recurse.
 */
export async function runV213DatabaseAcceptanceWorkflow(
  rawParameters: unknown,
  step: V213AcceptanceDurableStep,
  port: V213AcceptanceWorkflowRunnerPort,
): Promise<V213AcceptanceWorkflowOutput> {
  const parameters = parseV213AcceptanceWorkflowParameters(rawParameters);
  const plan = parseV213AcceptanceWorkflowPlan(
    await step.do("v213 acceptance claim", () => port.claim(parameters)),
    parameters,
  );
  if (plan.output) return plan.output;
  let v211RestoreRequired = false;
  let v211Restored = false;
  try {
    let state: V213AcceptanceWorkflowState;
    if (parameters.checkpoint === "V2-11") {
      // Set the recovery fence before the first provider mutation. A partial max-two update must
      // still enter the idempotent max-one/zero-worker restoration boundary.
      v211RestoreRequired = true;
      state = parseV213AcceptanceWorkflowState(
        await step.do("v213 acceptance prepare v211 max-two scenario", () =>
          port.prepareV211Scenario(plan),
        ),
        plan,
      );
    }

    await step.do("v213 acceptance resume prepared pairs", async () => {
      await port.resumePreparedPairs(plan);
      return { resumed: true as const };
    });

    state = parseV213AcceptanceWorkflowState(
      await step.do("v213 acceptance post-resume readback", () => port.read(parameters)),
      plan,
    );
    if (state.output) return state.output;

    let operatorEvidenceRequested = false;
    let technicalCaptureRequested = false;
    let finalizationRequested = false;
    for (let observation = 0; observation < MAX_OBSERVATIONS; observation += 1) {
      if (
        parameters.checkpoint === "V2-11" &&
        ["V211_WAITING_PROBES", "V211_FAIR_PROMOTION", "V211_CANCEL_RECONCILIATION"].includes(
          state.phase,
        )
      ) {
        state = parseV213AcceptanceWorkflowState(
          await step.do(`v213 acceptance advance v211 scenario ${observation}`, () =>
            port.advanceV211Scenario(plan),
          ),
          plan,
        );
      } else if (parameters.checkpoint === "V2-11" && state.phase === "V211_MAX1_RESTORE") {
        state = parseV213AcceptanceWorkflowState(
          await step.do("v213 acceptance restore v211 max-one and zero", () =>
            port.restoreV211MaxOne(plan),
          ),
          plan,
        );
        v211Restored = true;
      } else if (state.phase === "TECHNICAL_CAPTURE" && !technicalCaptureRequested) {
        state = parseV213AcceptanceWorkflowState(
          await step.do("v213 acceptance capture exact technical evidence", () =>
            port.captureTechnicalEvidence(plan),
          ),
          plan,
        );
        technicalCaptureRequested = true;
      } else if (state.phase === "ZERO_WORKER_READS" && state.zeroWorkerReadCount < 3) {
        if (state.zeroWorkerReadCount > 0)
          await step.sleep(`wait for stable v213 zero read ${state.zeroWorkerReadCount}`, 1_000);
        const ordinal = state.zeroWorkerReadCount as 0 | 1 | 2;
        state = parseV213AcceptanceWorkflowState(
          await step.do(`v213 acceptance zero worker read ${ordinal}`, () =>
            port.captureZeroWorkerRead(plan, ordinal),
          ),
          plan,
        );
      } else if (state.phase === "PAIR_EXECUTION" || state.phase === "CLEANUP_ONLY") {
        state = parseV213AcceptanceWorkflowState(
          await step.do(`v213 acceptance observation ${observation}`, () =>
            port.observePreparedPairs(plan),
          ),
          plan,
        );
      } else if (
        state.phase === "PAUSED_AWAITING_OPERATOR_EVIDENCE" &&
        parameters.checkpoint !== "V2-11" &&
        !operatorEvidenceRequested
      ) {
        state = parseV213AcceptanceWorkflowState(
          await step.do("v213 acceptance request output-bound operator evidence", () =>
            port.requestOperatorEvidence(plan),
          ),
          plan,
        );
        operatorEvidenceRequested = true;
      } else if (state.phase === "BILLING_SETTLEMENT" && !finalizationRequested) {
        state = parseV213AcceptanceWorkflowState(
          await step.do("v213 acceptance finalize exact durable output", () =>
            port.finalizeAcceptanceOutput(plan),
          ),
          plan,
        );
        finalizationRequested = true;
      } else {
        state = parseV213AcceptanceWorkflowState(
          await step.do(`v213 acceptance paused readback ${observation}`, () =>
            port.read(parameters),
          ),
          plan,
        );
      }
      if (state.output) return state.output;
      if (Date.parse(state.databaseNow) >= Date.parse(plan.workloadDeadlineAt))
        throw new Error("V213_ACCEPTANCE_WORKFLOW_DEADLINE_EXHAUSTED");
      await step.sleep(`wait for v213 acceptance ${observation}`, plan.pollIntervalMs);
    }
    throw new Error("V213_ACCEPTANCE_WORKFLOW_OBSERVATION_LIMIT");
  } finally {
    if (v211RestoreRequired && !v211Restored) {
      await step.do("v213 acceptance restore v211 max-one and zero", () =>
        port.restoreV211MaxOne(plan),
      );
    }
  }
}
