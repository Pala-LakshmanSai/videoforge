import { canonicalSha256, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import { canonicalizeJsonToUtf8, validateAndHashContractDocument } from "@videoforge/contracts";

import type { HostedPairLiveEnvironment } from "./hosted-pair-live-wiring.js";
import {
  createHostedPairLiveComposition,
  createHostedRunPodPair,
} from "./hosted-pair-live-wiring.js";
import type { HostedRuntimeEnvironment } from "./configuration.js";
import {
  RunPodControlClient,
  RunPodDrainGuard,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
  hashRunPodV207EndpointIdentity,
  type RunPodV207EndpointPolicyReceipt,
} from "../providers/runpod-control.js";
import type {
  V213AcceptanceWorkflowParameters,
  V213AcceptanceWorkflowPlan,
  V213AcceptanceWorkflowRunnerPort,
} from "./v213-acceptance-workflow-runner.js";

interface JsonRow extends Record<string, unknown> {
  readonly value: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER_JOB_ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const RUNPOD_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;

type TechnicalLane = "mage_image" | "soulx_avatar";

interface V213TechnicalCaptureJob extends Record<string, unknown> {
  readonly lane: TechnicalLane;
  readonly providerJobId: string;
  readonly provenanceReceiptSha256: string;
}

interface V213TechnicalCaptureScope extends Record<string, unknown> {
  readonly scopeIndex: number;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly render: Readonly<{
    attemptId: string;
    resultObjectKey: string;
    resultContentType: "application/json";
    resultContentLength: number;
    resultChecksumSha256: string;
    outputObjectKey: string;
    outputContentType: "video/mp4";
    outputContentLength: number;
    outputChecksumSha256: string;
    resultReceiptSha256: string;
  }>;
  readonly jobs: readonly [V213TechnicalCaptureJob, V213TechnicalCaptureJob];
}

interface V213TechnicalCapturePlan extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-acceptance-technical-capture-plan/v1";
  readonly workflowParams: V213AcceptanceWorkflowParameters;
  readonly checkpoint: V213AcceptanceWorkflowPlan["checkpoint"];
  readonly outputBindingSha256: string;
  readonly scopes: readonly V213TechnicalCaptureScope[];
}

type V213V211PolicyAction = "APPLY_MAX2" | "RESTORE_MAX1";

interface V213V211PolicyLane extends Record<string, unknown> {
  readonly lane: TechnicalLane;
  readonly endpointId: string;
  readonly endpointIdSha256: string;
  readonly templateId: string;
  readonly templateIdSha256: string;
  readonly volumeIdSha256: string;
  readonly volumeManifestSha256: string;
}

interface V213V211PolicyPlan extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-v211-policy-action-plan/v1";
  readonly workflowParams: V213AcceptanceWorkflowParameters;
  readonly action: V213V211PolicyAction;
  readonly lanes: readonly [V213V211PolicyLane, V213V211PolicyLane];
}

type V213V211ScenarioAction =
  | "OBSERVE_PROBE_WAITS"
  | "OBSERVE_FAIR_PROMOTION"
  | "CANCEL_PROMOTED_PROBE"
  | "VERIFY_TENANT_ISOLATION";

interface V213V211ScenarioStep extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-v211-scenario-step/v1";
  readonly workflowParams: V213AcceptanceWorkflowParameters;
  readonly action: V213V211ScenarioAction;
  readonly promotedProbe: V213AcceptanceWorkflowPlan["fairnessProbe"];
}

interface V213V211PromotedProbeCancellation extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-v211-promoted-probe-cancel/v1";
  readonly workflowParams: V213AcceptanceWorkflowParameters;
  readonly generationRequestId: string;
  readonly providerDispatchFenced: boolean;
  readonly providerJob: null | Readonly<{
    lane: TechnicalLane;
    providerJobId: string;
    providerJobIdSha256: string;
  }>;
  readonly cancellationSha256: string;
}

interface V213V211PromotedProbeReconciliation extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-v211-promoted-probe-reconciliation/v1";
  readonly workflowParams: V213AcceptanceWorkflowParameters;
  readonly generationRequestId: string;
  readonly cancellationSha256: string;
  readonly providerDispatchFenced: boolean;
  readonly providerRaceReconciled: boolean;
  readonly providerRaceActualUsd: number;
  readonly providerRaceJobId: string | null;
  readonly providerRaceReceiptSha256: string | null;
  readonly terminalState: "CANCELLED";
  readonly activeLeaseAbsent: true;
  readonly reconciliationSha256: string;
}

type V213V211PolicyControl = Pick<
  RunPodControlClient,
  "enforceV207EndpointPolicy" | "resolveV207EndpointPlacement"
>;

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function workflowParameters(plan: V213AcceptanceWorkflowPlan): V213AcceptanceWorkflowParameters {
  return Object.freeze({
    schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
    kind: "V213_DATABASE_ACCEPTANCE",
    fullLiveAuthorityId: plan.fullLiveAuthorityId,
    operationId: plan.operationId,
    checkpoint: plan.checkpoint,
    workflowId: plan.workflowId,
    requestSha256: plan.requestSha256,
  });
}

export function parseV213V211PolicyPlan(
  value: unknown,
  plan: V213AcceptanceWorkflowPlan,
  action: V213V211PolicyAction,
  environment: Pick<
    HostedPairLiveEnvironment,
    "VIDEOFORGE_MAGE_ENDPOINT_ID" | "VIDEOFORGE_SOULX_ENDPOINT_ID"
  >,
): V213V211PolicyPlan {
  const parsed = record(value, "V213_ACCEPTANCE_V211_POLICY_PLAN_INVALID");
  const expectedParams = workflowParameters(plan);
  const suppliedParams = record(parsed.workflowParams, "V213_ACCEPTANCE_V211_POLICY_PLAN_INVALID");
  if (
    plan.checkpoint !== "V2-11" ||
    !plan.sameAccountWaiter ||
    !plan.fairnessProbe ||
    !exactKeys(parsed, ["action", "lanes", "schemaVersion", "workflowParams"]) ||
    parsed.schemaVersion !== "videoforge.v213-v211-policy-action-plan/v1" ||
    parsed.action !== action ||
    canonicalSha256(suppliedParams) !== canonicalSha256(expectedParams) ||
    !Array.isArray(parsed.lanes) ||
    parsed.lanes.length !== 2
  )
    throw new Error("V213_ACCEPTANCE_V211_POLICY_PLAN_INVALID");
  const expectedEndpointIds = Object.freeze({
    mage_image: environment.VIDEOFORGE_MAGE_ENDPOINT_ID,
    soulx_avatar: environment.VIDEOFORGE_SOULX_ENDPOINT_ID,
  });
  const lanes = parsed.lanes.map((rawLane, index) => {
    const lane = record(rawLane, "V213_ACCEPTANCE_V211_POLICY_PLAN_INVALID");
    const expectedLane = index === 0 ? "mage_image" : "soulx_avatar";
    if (
      !exactKeys(lane, [
        "endpointId",
        "endpointIdSha256",
        "lane",
        "templateId",
        "templateIdSha256",
        "volumeIdSha256",
        "volumeManifestSha256",
      ]) ||
      lane.lane !== expectedLane ||
      ![lane.endpointId, lane.templateId].every(
        (item) => typeof item === "string" && RUNPOD_RESOURCE_ID.test(item),
      ) ||
      lane.endpointId !== expectedEndpointIds[expectedLane] ||
      lane.endpointIdSha256 !== hashRunPodV207EndpointIdentity(String(lane.endpointId)) ||
      lane.templateIdSha256 !== hashRunPodV207EndpointIdentity(String(lane.templateId)) ||
      typeof lane.volumeIdSha256 !== "string" ||
      !SHA256.test(lane.volumeIdSha256) ||
      typeof lane.volumeManifestSha256 !== "string" ||
      !SHA256.test(lane.volumeManifestSha256)
    )
      throw new Error("V213_ACCEPTANCE_V211_POLICY_PLAN_INVALID");
    return Object.freeze({ ...lane }) as unknown as V213V211PolicyLane;
  });
  return Object.freeze({
    ...parsed,
    workflowParams: expectedParams,
    lanes: Object.freeze(lanes),
  }) as unknown as V213V211PolicyPlan;
}

function parseV213V211ScenarioStep(
  value: unknown,
  plan: V213AcceptanceWorkflowPlan,
): V213V211ScenarioStep {
  const parsed = record(value, "V213_ACCEPTANCE_V211_SCENARIO_STEP_INVALID");
  const suppliedParams = record(
    parsed.workflowParams,
    "V213_ACCEPTANCE_V211_SCENARIO_STEP_INVALID",
  );
  const promotedProbe = record(parsed.promotedProbe, "V213_ACCEPTANCE_V211_SCENARIO_STEP_INVALID");
  const actions = [
    "OBSERVE_PROBE_WAITS",
    "OBSERVE_FAIR_PROMOTION",
    "CANCEL_PROMOTED_PROBE",
    "VERIFY_TENANT_ISOLATION",
  ];
  if (
    plan.checkpoint !== "V2-11" ||
    !plan.fairnessProbe ||
    !exactKeys(parsed, ["action", "promotedProbe", "schemaVersion", "workflowParams"]) ||
    parsed.schemaVersion !== "videoforge.v213-v211-scenario-step/v1" ||
    !actions.includes(String(parsed.action)) ||
    canonicalSha256(suppliedParams) !== canonicalSha256(workflowParameters(plan)) ||
    canonicalSha256(promotedProbe) !== canonicalSha256(plan.fairnessProbe)
  )
    throw new Error("V213_ACCEPTANCE_V211_SCENARIO_STEP_INVALID");
  return Object.freeze({
    ...parsed,
    workflowParams: workflowParameters(plan),
    promotedProbe: plan.fairnessProbe,
  }) as unknown as V213V211ScenarioStep;
}

function parseV213V211PromotedProbeCancellation(
  value: unknown,
  plan: V213AcceptanceWorkflowPlan,
): V213V211PromotedProbeCancellation {
  const parsed = record(value, "V213_ACCEPTANCE_V211_PROBE_CANCEL_INVALID");
  const params = record(parsed.workflowParams, "V213_ACCEPTANCE_V211_PROBE_CANCEL_INVALID");
  const providerJob =
    parsed.providerJob === null
      ? null
      : record(parsed.providerJob, "V213_ACCEPTANCE_V211_PROBE_CANCEL_INVALID");
  if (
    !plan.fairnessProbe ||
    !exactKeys(parsed, [
      "cancellationSha256",
      "generationRequestId",
      "providerDispatchFenced",
      "providerJob",
      "schemaVersion",
      "workflowParams",
    ]) ||
    parsed.schemaVersion !== "videoforge.v213-v211-promoted-probe-cancel/v1" ||
    canonicalSha256(params) !== canonicalSha256(workflowParameters(plan)) ||
    parsed.generationRequestId !== plan.fairnessProbe.generationRequestId ||
    typeof parsed.providerDispatchFenced !== "boolean" ||
    typeof parsed.cancellationSha256 !== "string" ||
    !SHA256.test(parsed.cancellationSha256) ||
    (parsed.providerDispatchFenced === true) !== (providerJob === null) ||
    (providerJob !== null &&
      (!exactKeys(providerJob, ["lane", "providerJobId", "providerJobIdSha256"]) ||
        !["mage_image", "soulx_avatar"].includes(String(providerJob.lane)) ||
        typeof providerJob.providerJobId !== "string" ||
        !PROVIDER_JOB_ID.test(providerJob.providerJobId) ||
        typeof providerJob.providerJobIdSha256 !== "string" ||
        !SHA256.test(providerJob.providerJobIdSha256)))
  )
    throw new Error("V213_ACCEPTANCE_V211_PROBE_CANCEL_INVALID");
  return Object.freeze({
    ...parsed,
    workflowParams: workflowParameters(plan),
    providerJob: providerJob === null ? null : Object.freeze({ ...providerJob }),
  }) as unknown as V213V211PromotedProbeCancellation;
}

function parseV213V211PromotedProbeReconciliation(
  value: unknown,
  plan: V213AcceptanceWorkflowPlan,
  cancellation: V213V211PromotedProbeCancellation,
): V213V211PromotedProbeReconciliation {
  const parsed = record(value, "V213_ACCEPTANCE_V211_PROBE_RECONCILIATION_INVALID");
  const params = record(parsed.workflowParams, "V213_ACCEPTANCE_V211_PROBE_RECONCILIATION_INVALID");
  const fenced = cancellation.providerDispatchFenced;
  if (
    !plan.fairnessProbe ||
    !exactKeys(parsed, [
      "activeLeaseAbsent",
      "cancellationSha256",
      "generationRequestId",
      "providerDispatchFenced",
      "providerRaceActualUsd",
      "providerRaceJobId",
      "providerRaceReceiptSha256",
      "providerRaceReconciled",
      "reconciliationSha256",
      "schemaVersion",
      "terminalState",
      "workflowParams",
    ]) ||
    parsed.schemaVersion !== "videoforge.v213-v211-promoted-probe-reconciliation/v1" ||
    canonicalSha256(params) !== canonicalSha256(workflowParameters(plan)) ||
    parsed.generationRequestId !== cancellation.generationRequestId ||
    parsed.cancellationSha256 !== cancellation.cancellationSha256 ||
    parsed.providerDispatchFenced !== fenced ||
    parsed.terminalState !== "CANCELLED" ||
    parsed.activeLeaseAbsent !== true ||
    typeof parsed.reconciliationSha256 !== "string" ||
    !SHA256.test(parsed.reconciliationSha256) ||
    typeof parsed.providerRaceActualUsd !== "number" ||
    !Number.isFinite(parsed.providerRaceActualUsd) ||
    parsed.providerRaceActualUsd < 0 ||
    parsed.providerRaceActualUsd > 4 ||
    (fenced &&
      (parsed.providerRaceReconciled !== false ||
        parsed.providerRaceActualUsd !== 0 ||
        parsed.providerRaceJobId !== null ||
        parsed.providerRaceReceiptSha256 !== null)) ||
    (!fenced &&
      (parsed.providerRaceReconciled !== true ||
        parsed.providerRaceJobId !== cancellation.providerJob?.providerJobId ||
        typeof parsed.providerRaceReceiptSha256 !== "string" ||
        !SHA256.test(parsed.providerRaceReceiptSha256)))
  )
    throw new Error("V213_ACCEPTANCE_V211_PROBE_RECONCILIATION_INVALID");
  return Object.freeze({
    ...parsed,
    workflowParams: workflowParameters(plan),
  }) as unknown as V213V211PromotedProbeReconciliation;
}

export function parseV213TechnicalCapturePlan(
  value: unknown,
  plan: V213AcceptanceWorkflowPlan,
  workflowParams: V213AcceptanceWorkflowParameters,
): V213TechnicalCapturePlan {
  const captured = record(value, "V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
  const capturedWorkflowParams = record(
    captured.workflowParams,
    "V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID",
  );
  if (
    !exactKeys(captured, [
      "checkpoint",
      "outputBindingSha256",
      "schemaVersion",
      "scopes",
      "workflowParams",
    ]) ||
    captured.schemaVersion !== "videoforge.v213-acceptance-technical-capture-plan/v1" ||
    captured.checkpoint !== plan.checkpoint ||
    !SHA256.test(String(captured.outputBindingSha256)) ||
    canonicalSha256(capturedWorkflowParams) !== canonicalSha256(workflowParams) ||
    !Array.isArray(captured.scopes) ||
    captured.scopes.length !== plan.scopes.length
  )
    throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");

  const scopes = captured.scopes.map((rawScope, scopeIndex) => {
    const scope = record(rawScope, "V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
    const expectedScope = plan.scopes[scopeIndex];
    const render = record(scope.render, "V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
    const expectedPrefix = expectedScope
      ? `tenant/${expectedScope.accountId}/workspace/${expectedScope.workspaceId}` +
        `/project/${expectedScope.projectId}/revision/${expectedScope.projectRevisionId}` +
        `/lane/render/job/${String(render.attemptId)}/artifact/`
      : "";
    if (
      !expectedScope ||
      !exactKeys(scope, [
        "accountId",
        "generationRequestId",
        "jobs",
        "projectId",
        "projectRevisionId",
        "render",
        "scopeIndex",
        "workspaceId",
      ]) ||
      scope.scopeIndex !== scopeIndex ||
      scope.accountId !== expectedScope.accountId ||
      scope.workspaceId !== expectedScope.workspaceId ||
      scope.projectId !== expectedScope.projectId ||
      scope.projectRevisionId !== expectedScope.projectRevisionId ||
      scope.generationRequestId !== expectedScope.generationRequestId ||
      !exactKeys(render, [
        "attemptId",
        "outputChecksumSha256",
        "outputContentLength",
        "outputContentType",
        "outputObjectKey",
        "resultChecksumSha256",
        "resultContentLength",
        "resultContentType",
        "resultObjectKey",
        "resultReceiptSha256",
      ]) ||
      !UUID.test(String(render.attemptId)) ||
      render.resultContentType !== "application/json" ||
      !Number.isSafeInteger(render.resultContentLength) ||
      Number(render.resultContentLength) < 1 ||
      Number(render.resultContentLength) > 1_048_576 ||
      render.outputContentType !== "video/mp4" ||
      !Number.isSafeInteger(render.outputContentLength) ||
      Number(render.outputContentLength) < 1 ||
      ![render.resultChecksumSha256, render.outputChecksumSha256, render.resultReceiptSha256].every(
        (hash) => typeof hash === "string" && SHA256.test(hash),
      ) ||
      typeof render.resultObjectKey !== "string" ||
      typeof render.outputObjectKey !== "string" ||
      !render.resultObjectKey.startsWith(expectedPrefix) ||
      !render.outputObjectKey.startsWith(expectedPrefix) ||
      render.resultObjectKey === render.outputObjectKey ||
      !Array.isArray(scope.jobs) ||
      scope.jobs.length !== 2
    )
      throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
    const jobs = scope.jobs.map((rawJob) => {
      const job = record(rawJob, "V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
      if (
        !exactKeys(job, ["lane", "provenanceReceiptSha256", "providerJobId"]) ||
        !["mage_image", "soulx_avatar"].includes(String(job.lane)) ||
        !PROVIDER_JOB_ID.test(String(job.providerJobId)) ||
        !SHA256.test(String(job.provenanceReceiptSha256))
      )
        throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
      return Object.freeze({ ...job }) as unknown as V213TechnicalCaptureJob;
    });
    if (jobs[0]?.lane !== "mage_image" || jobs[1]?.lane !== "soulx_avatar")
      throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PLAN_INVALID");
    return Object.freeze({
      ...scope,
      render: Object.freeze({ ...render }),
      jobs: Object.freeze(jobs),
    }) as unknown as V213TechnicalCaptureScope;
  });
  return Object.freeze({
    ...captured,
    workflowParams,
    scopes: Object.freeze(scopes),
  }) as unknown as V213TechnicalCapturePlan;
}

async function digestBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function providerReceiptSha256(output: unknown): string | null {
  const outer = output && typeof output === "object" && !Array.isArray(output) ? output : null;
  const receipt = outer ? (outer as Record<string, unknown>).provenance_receipt : null;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  const hash = (receipt as Record<string, unknown>).receipt_sha256;
  return typeof hash === "string" && SHA256.test(hash) ? hash : null;
}

async function signV211PolicyReceipt(
  environment: HostedPairLiveEnvironment,
  input: Readonly<Record<string, unknown>>,
) {
  const keyId = environment.VIDEOFORGE_PROVIDER_PROOF_KEY_ID;
  const keyHex = environment.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY;
  if (
    typeof keyId !== "string" ||
    keyId.length < 1 ||
    typeof keyHex !== "string" ||
    keyHex.length < 64 ||
    keyHex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/u.test(keyHex)
  )
    throw new Error("V213_ACCEPTANCE_V211_POLICY_SIGNER_INVALID");
  const receiptSha256 = canonicalSha256(input);
  const signed = Object.freeze({ ...input, receiptSha256 });
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from({ length: keyHex.length / 2 }, (_, index) =>
      Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16),
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureValue = Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, canonicalizeJsonToUtf8(signed as never))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return Object.freeze({
    ...signed,
    signature: Object.freeze({
      algorithm: "HMAC-SHA256" as const,
      keyId,
      value: signatureValue,
      sha256: canonicalSha256({ signatureValue }),
    }),
  });
}

async function call(
  database: TransactionalSqlExecutor,
  sql: string,
  value: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return database.transaction(async (transaction) => {
    const result = await transaction.query<JsonRow>(sql, [JSON.stringify(value)]);
    if (result.rows.length !== 1) throw new Error("V213_ACCEPTANCE_WORKFLOW_DATABASE_INVALID");
    return result.rows[0]?.value;
  });
}

/**
 * Low-level production port. PostgreSQL owns the plan and evidence projection; this class only
 * resumes already-prepared pair outboxes and reconciles their exact known provider jobs.
 */
export class V213SqlAcceptanceWorkflowPort implements V213AcceptanceWorkflowRunnerPort {
  constructor(
    private readonly environment: HostedPairLiveEnvironment &
      Pick<HostedRuntimeEnvironment, "PRIVATE_ARTIFACTS">,
    private readonly runtimeDatabase: TransactionalSqlExecutor,
    private readonly reconcilerDatabase: TransactionalSqlExecutor,
    private readonly runPodPair: typeof createHostedRunPodPair = createHostedRunPodPair,
    private readonly createPolicyControl: (apiKey: string) => V213V211PolicyControl = (apiKey) =>
      new RunPodControlClient({ apiKey }),
    private readonly createLiveComposition: typeof createHostedPairLiveComposition = createHostedPairLiveComposition,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  claim(parameters: V213AcceptanceWorkflowParameters) {
    return call(
      this.runtimeDatabase,
      "SELECT public.videoforge_claim_v213_acceptance_workflow($1::jsonb) AS value",
      parameters,
    );
  }

  read(parameters: V213AcceptanceWorkflowParameters) {
    return call(
      this.runtimeDatabase,
      "SELECT public.videoforge_read_v213_acceptance_workflow($1::jsonb) AS value",
      parameters,
    );
  }

  private parameters(plan: V213AcceptanceWorkflowPlan): V213AcceptanceWorkflowParameters {
    return workflowParameters(plan);
  }

  async resumePreparedPairs(plan: V213AcceptanceWorkflowPlan): Promise<void> {
    const live = await this.createLiveComposition(
      this.environment,
      this.runtimeDatabase,
      this.reconcilerDatabase,
    );
    const results = await Promise.all(
      plan.scopes.map((scope) =>
        live.composition.resume({
          environment: this.environment,
          accountId: scope.accountId,
          workspaceId: scope.workspaceId,
          generationRequestId: scope.generationRequestId,
          dispatchTokenKey: this.environment.VIDEOFORGE_DISPATCH_TOKEN_KEY!,
        }),
      ),
    );
    if (
      results.some(
        (result) => result.state === "DISABLED_UNQUALIFIED" || result.state === "CLEANUP_ONLY",
      )
    )
      throw new Error("V213_ACCEPTANCE_WORKFLOW_RESUME_REJECTED");
  }

  async observePreparedPairs(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    const before = (await this.read(this.parameters(plan))) as {
      readonly databaseNow?: unknown;
      readonly cancelRequested?: unknown;
      readonly terminal?: unknown;
    };
    if (before?.terminal === true) return before;
    if (typeof before?.databaseNow !== "string" || typeof before?.cancelRequested !== "boolean")
      throw new Error("V213_ACCEPTANCE_WORKFLOW_STATE_INVALID");
    const databaseNow = before.databaseNow;
    const cancelRequested = before.cancelRequested;
    const live = await this.createLiveComposition(
      this.environment,
      this.runtimeDatabase,
      this.reconcilerDatabase,
    );
    await Promise.all(
      plan.scopes.map((scope) =>
        live.reconciler.observe(
          scope,
          cancelRequested || Date.parse(databaseNow) >= Date.parse(scope.cancelAt),
        ),
      ),
    );
    return this.read(this.parameters(plan));
  }

  private async executeV211PolicyAction(
    plan: V213AcceptanceWorkflowPlan,
    action: V213V211PolicyAction,
  ): Promise<unknown> {
    const workflowParams = this.parameters(plan);
    const policyPlan = parseV213V211PolicyPlan(
      await call(
        this.runtimeDatabase,
        "SELECT public.videoforge_prepare_v213_v211_policy_action($1::jsonb) AS value",
        { workflowParams, action },
      ),
      plan,
      action,
      this.environment,
    );
    const apiKey = this.environment.RUNPOD_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length < 1)
      throw new Error("V213_ACCEPTANCE_V211_RUNPOD_AUTH_UNAVAILABLE");
    const provider = await this.runPodPair(this.environment);
    const before = await Promise.all(
      policyPlan.lanes.map((lane) => provider.clients[lane.lane].confirmDrained(30)),
    );
    const control = this.createPolicyControl(apiKey);
    const placements = await Promise.all(
      policyPlan.lanes.map((lane) =>
        control.resolveV207EndpointPlacement({
          endpointId: lane.endpointId,
          endpointIdSha256: lane.endpointIdSha256,
          templateId: lane.templateId,
          templateIdSha256: lane.templateIdSha256,
          volumeIdSha256: lane.volumeIdSha256,
          allowedWorkersMax: action === "APPLY_MAX2" ? [1] : [1, 2],
        }),
      ),
    );
    const readbacks: RunPodV207EndpointPolicyReceipt[] = [];
    for (let index = 0; index < policyPlan.lanes.length; index += 1) {
      const lane = policyPlan.lanes[index]!;
      const guard = new RunPodDrainGuard();
      guard.confirmZero(before[index]!.workersTotal, before[index]!.queuedJobs);
      readbacks.push(
        await control.enforceV207EndpointPolicy(
          lane.endpointId,
          lane.templateId,
          {
            workersMin: 0,
            workersMax: action === "APPLY_MAX2" ? 2 : 1,
            gpuCount: 1,
            idleTimeout: V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
            executionTimeoutMs: V207_RUNPOD_EXECUTION_TIMEOUT_MS,
          },
          placements[index]!,
          guard,
        ),
      );
    }
    const after = await Promise.all(
      policyPlan.lanes.map((lane) => provider.clients[lane.lane].confirmDrained(30)),
    );
    const receipts = await Promise.all(
      policyPlan.lanes.map((lane, index) =>
        signV211PolicyReceipt(this.environment, {
          schemaVersion: "videoforge.v213-v211-endpoint-policy-receipt/v1",
          workflowParams,
          action,
          lane: lane.lane,
          volumeManifestSha256: lane.volumeManifestSha256,
          providerReadback: readbacks[index]!,
          providerReadbackSha256: canonicalSha256(readbacks[index]!),
          zeroWorkersBefore: before[index]!,
          zeroWorkersAfter: after[index]!,
        }),
      ),
    );
    return call(
      this.reconcilerDatabase,
      "SELECT public.videoforge_record_v213_v211_policy_action($1::jsonb) AS value",
      { workflowParams, action, receipts: Object.freeze(receipts) },
    );
  }

  prepareV211Scenario(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    if (plan.checkpoint !== "V2-11" || !plan.sameAccountWaiter || !plan.fairnessProbe)
      throw new Error("V213_ACCEPTANCE_CHECKPOINT_SCENARIO_INVALID");
    return this.executeV211PolicyAction(plan, "APPLY_MAX2");
  }

  async advanceV211Scenario(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    if (plan.checkpoint !== "V2-11" || !plan.sameAccountWaiter || !plan.fairnessProbe)
      throw new Error("V213_ACCEPTANCE_CHECKPOINT_SCENARIO_INVALID");
    const workflowParams = this.parameters(plan);
    const step = parseV213V211ScenarioStep(
      await call(
        this.runtimeDatabase,
        "SELECT public.videoforge_prepare_v213_v211_scenario_step($1::jsonb) AS value",
        workflowParams,
      ),
      plan,
    );
    let cancellationSha256: string | null = null;
    let reconciliationSha256: string | null = null;
    if (step.action === "CANCEL_PROMOTED_PROBE") {
      const cancellation = parseV213V211PromotedProbeCancellation(
        await call(
          this.runtimeDatabase,
          "SELECT public.videoforge_cancel_v213_v211_promoted_probe($1::jsonb) AS value",
          {
            workflowParams,
            generationRequestId: step.promotedProbe!.generationRequestId,
          },
        ),
        plan,
      );
      let providerReadback: Readonly<Record<string, unknown>> | null = null;
      if (!cancellation.providerDispatchFenced) {
        const job = cancellation.providerJob!;
        const providerJobBytes = new TextEncoder().encode(job.providerJobId);
        if ((await digestBytes(providerJobBytes.buffer as ArrayBuffer)) !== job.providerJobIdSha256)
          throw new Error("V213_ACCEPTANCE_V211_PROBE_CANCEL_INVALID");
        const provider = await this.runPodPair(this.environment);
        const client = provider.clients[job.lane];
        let terminal = await client.status(job.providerJobId);
        if (terminal.status !== "CANCELLED") {
          if (!["IN_QUEUE", "IN_PROGRESS"].includes(terminal.status))
            throw new Error("V213_ACCEPTANCE_V211_PROBE_PROVIDER_RACE_INVALID");
          terminal = await client.cancel(job.providerJobId);
        }
        if (
          terminal.status !== "CANCELLED" ||
          terminal.id !== job.providerJobId ||
          terminal.idHash !== job.providerJobIdSha256 ||
          (terminal.delayTimeMs !== null &&
            (!Number.isSafeInteger(terminal.delayTimeMs) || terminal.delayTimeMs < 0)) ||
          (terminal.executionTimeMs !== null &&
            (!Number.isSafeInteger(terminal.executionTimeMs) || terminal.executionTimeMs < 0))
        )
          throw new Error("V213_ACCEPTANCE_V211_PROBE_PROVIDER_RACE_INVALID");
        providerReadback = await signV211PolicyReceipt(this.environment, {
          schemaVersion: "videoforge.v213-v211-provider-race-cancel-receipt/v1",
          workflowParams,
          generationRequestId: cancellation.generationRequestId,
          lane: job.lane,
          providerJobId: job.providerJobId,
          providerJobIdSha256: job.providerJobIdSha256,
          status: "CANCELLED",
          delayTimeMs: terminal.delayTimeMs,
          executionTimeMs: terminal.executionTimeMs,
        });
      }
      const reconciliation = parseV213V211PromotedProbeReconciliation(
        await call(
          this.reconcilerDatabase,
          "SELECT public.videoforge_record_v213_v211_promoted_probe_reconciliation($1::jsonb) AS value",
          {
            workflowParams,
            cancellationSha256: cancellation.cancellationSha256,
            providerReadback,
          },
        ),
        plan,
        cancellation,
      );
      cancellationSha256 = cancellation.cancellationSha256;
      reconciliationSha256 = reconciliation.reconciliationSha256;
    }
    return call(
      this.reconcilerDatabase,
      "SELECT public.videoforge_record_v213_v211_scenario_step($1::jsonb) AS value",
      {
        workflowParams,
        action: step.action,
        promotedProbe: step.promotedProbe!,
        cancellationSha256,
        reconciliationSha256,
      },
    );
  }

  async restoreV211MaxOne(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    if (plan.checkpoint !== "V2-11" || !plan.sameAccountWaiter || !plan.fairnessProbe)
      throw new Error("V213_ACCEPTANCE_CHECKPOINT_SCENARIO_INVALID");
    const workflowParams = this.parameters(plan);
    const authorization = await call(
      this.runtimeDatabase,
      "SELECT public.videoforge_authorize_v213_v211_restore($1::jsonb) AS value",
      workflowParams,
    );
    const authorized = record(authorization, "V213_ACCEPTANCE_V211_RESTORE_AUTH_INVALID");
    if (!exactKeys(authorized, ["authorized"]) || authorized.authorized !== true)
      throw new Error("V213_ACCEPTANCE_V211_RESTORE_AUTH_INVALID");
    const live = await this.createLiveComposition(
      this.environment,
      this.runtimeDatabase,
      this.reconcilerDatabase,
    );
    const cancellableScopes = [...plan.scopes];
    let settled = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const results = await Promise.all(
        cancellableScopes.map((scope) => live.reconciler.observe(scope, true)),
      );
      if (results.every((result) => result.state === "SETTLED")) {
        settled = true;
        break;
      }
      if (attempt + 1 < 30) await this.sleep(2_000);
    }
    if (!settled) throw new Error("V213_ACCEPTANCE_V211_RESTORE_DRAIN_UNCONFIRMED");
    return this.executeV211PolicyAction(plan, "RESTORE_MAX1");
  }

  async captureTechnicalEvidence(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    const workflowParams = this.parameters(plan);
    const capturePlan = parseV213TechnicalCapturePlan(
      await call(
        this.runtimeDatabase,
        "SELECT public.videoforge_prepare_v213_acceptance_technical_capture($1::jsonb) AS value",
        workflowParams,
      ),
      plan,
      workflowParams,
    );
    const bucket = this.environment.PRIVATE_ARTIFACTS;
    if (!bucket) throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_R2_UNAVAILABLE");
    const provider = await this.runPodPair(this.environment);
    const captures = await Promise.all(
      capturePlan.scopes.map(async (scope) => {
        const resultObject = await bucket.get(scope.render.resultObjectKey);
        if (
          !resultObject ||
          resultObject.size !== scope.render.resultContentLength ||
          resultObject.httpMetadata?.contentType !== scope.render.resultContentType
        )
          throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_RESULT_INVALID");
        const resultBytes = await resultObject.arrayBuffer();
        if (
          resultBytes.byteLength !== scope.render.resultContentLength ||
          (await digestBytes(resultBytes)) !== scope.render.resultChecksumSha256
        )
          throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_RESULT_INVALID");
        let rawResult: unknown;
        try {
          rawResult = JSON.parse(
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(resultBytes),
          );
        } catch {
          throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_RESULT_INVALID");
        }
        const resultDocument = await validateAndHashContractDocument("renderJobResult", rawResult);
        if (
          resultDocument.value.status !== "SUCCEEDED" ||
          resultDocument.value.attempt_id !== scope.render.attemptId ||
          resultDocument.value.output.sha256 !== scope.render.outputChecksumSha256 ||
          resultDocument.value.output.bytes !== scope.render.outputContentLength ||
          resultDocument.value.probe.sha256 !== scope.render.outputChecksumSha256 ||
          resultDocument.value.probe.bytes !== scope.render.outputContentLength
        )
          throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_RESULT_INVALID");

        const providerReads = await Promise.all(
          scope.jobs.map(async (job) => {
            const observed = await provider.clients[job.lane].status(job.providerJobId);
            if (
              observed.status !== "COMPLETED" ||
              observed.id !== job.providerJobId ||
              !SHA256.test(observed.idHash) ||
              !Number.isSafeInteger(observed.delayTimeMs) ||
              Number(observed.delayTimeMs) < 0 ||
              !Number.isSafeInteger(observed.executionTimeMs) ||
              Number(observed.executionTimeMs) < 1 ||
              providerReceiptSha256(observed.output) !== job.provenanceReceiptSha256
            )
              throw new Error("V213_ACCEPTANCE_TECHNICAL_CAPTURE_PROVIDER_INVALID");
            return Object.freeze({
              lane: job.lane,
              providerJobId: job.providerJobId,
              providerJobIdSha256: observed.idHash,
              status: "COMPLETED" as const,
              delayTimeMs: observed.delayTimeMs,
              executionTimeMs: observed.executionTimeMs,
              provenanceReceiptSha256: job.provenanceReceiptSha256,
            });
          }),
        );
        return Object.freeze({
          scopeIndex: scope.scopeIndex,
          resultBytesSha256: scope.render.resultChecksumSha256,
          resultDocument: resultDocument.value,
          provider: Object.freeze(providerReads),
        });
      }),
    );
    return call(
      this.reconcilerDatabase,
      "SELECT public.videoforge_record_v213_acceptance_technical_capture($1::jsonb) AS value",
      {
        workflowParams,
        outputBindingSha256: capturePlan.outputBindingSha256,
        captures: Object.freeze(captures),
      },
    );
  }

  requestOperatorEvidence(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    if (plan.checkpoint !== "V2-10" && plan.checkpoint !== "V2-12")
      throw new Error("V213_ACCEPTANCE_OPERATOR_EVIDENCE_REQUEST_INVALID");
    return call(
      this.runtimeDatabase,
      "SELECT public.videoforge_request_v213_acceptance_operator_evidence($1::jsonb) AS value",
      this.parameters(plan),
    );
  }

  async captureZeroWorkerRead(
    plan: V213AcceptanceWorkflowPlan,
    ordinal: 0 | 1 | 2,
  ): Promise<unknown> {
    const provider = await createHostedRunPodPair(this.environment);
    const [mage, soulx] = await Promise.all([
      provider.clients.mage_image.confirmDrained(1),
      provider.clients.soulx_avatar.confirmDrained(1),
    ]);
    return call(
      this.reconcilerDatabase,
      "SELECT public.videoforge_record_v213_acceptance_zero_worker_read($1::jsonb) AS value",
      {
        workflowParams: this.parameters(plan),
        ordinal,
        observations: Object.freeze({ mage, soulx }),
      },
    );
  }

  finalizeAcceptanceOutput(plan: V213AcceptanceWorkflowPlan): Promise<unknown> {
    return call(
      this.reconcilerDatabase,
      "SELECT public.videoforge_finalize_v213_acceptance_workflow($1::jsonb) AS value",
      this.parameters(plan),
    );
  }
}

export class V213SqlAcceptanceWorkflowControl {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async requestCleanup(parameters: V213AcceptanceWorkflowParameters): Promise<void> {
    const accepted = await call(
      this.database,
      "SELECT public.videoforge_request_v213_acceptance_workflow_cleanup($1::jsonb) AS value",
      parameters,
    );
    if (accepted !== true) throw new Error("V213_ACCEPTANCE_WORKFLOW_CLEANUP_REJECTED");
  }
}
