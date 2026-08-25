import type { SqlPrimitive, TransactionalSqlExecutor } from "@videoforge/control-plane";
import {
  ServerlessTransportError,
  type ServerlessTransportPort,
  type Sha256,
} from "@videoforge/control-plane";
import {
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
  type ServerlessWorkerJobEnvelopeV3Document,
} from "@videoforge/contracts";

import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";

export type HostedPairLane = "mage_image" | "soulx_avatar";

export interface HostedPairSendClaim {
  readonly lane: HostedPairLane;
  readonly attemptId: string;
  readonly dispatchToken: string;
  readonly dispatchTokenSha256: Sha256;
  readonly endpointIdSha256: Sha256;
  readonly requestBodySha256: Sha256;
  readonly deploymentId: string;
  readonly phase: string;
  readonly expectedEnvelopeSha256: Sha256;
  readonly attemptState?: string;
  readonly outboxState?: string;
  readonly providerJobId?: string | null;
}

export interface HostedPairRuntimeStore {
  prepare(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
  }): Promise<readonly [HostedPairSendClaim, HostedPairSendClaim]>;
  beginSend(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly lane: HostedPairLane;
    readonly dispatchTokenKey: string;
    readonly expectedAttemptId: string;
    readonly expectedEnvelopeSha256: Sha256;
  }): Promise<HostedPairSendClaim>;
  finishSend(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly lane: HostedPairLane;
    readonly outcome: "ASSIGNED" | "DISPATCH_ACK_UNKNOWN" | "REQUEST_REJECTED";
    readonly providerJobId: string | null;
    readonly deploymentId: string;
    readonly dispatchTokenSha256: Sha256;
  }): Promise<void>;
  inspect(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
  }): Promise<readonly HostedPairInspection[]>;
}

export interface HostedPairInspection {
  readonly lane: HostedPairLane;
  readonly attemptId: string;
  readonly attemptState: string;
  readonly outboxState: string;
  readonly providerJobId: string | null;
  readonly deploymentId: string;
  readonly dispatchTokenSha256: Sha256;
  readonly pairPhase: string;
  readonly recoveryAction: string;
}

type BeginRow = {
  lane: HostedPairLane;
  attempt_id: string;
  dispatch_token: string;
  dispatch_token_sha256: Sha256;
  endpoint_id_sha256: Sha256;
  request_body_sha256: Sha256;
  deployment_id: string;
  phase: string;
  expected_envelope_sha256: Sha256;
  attempt_state?: string;
  outbox_state?: string;
  provider_job_id?: string | null;
} & Record<string, unknown>;

export class HostedSqlPairRuntimeStore implements HostedPairRuntimeStore {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async prepare(input: Parameters<HostedPairRuntimeStore["prepare"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await transaction.query<BeginRow>(
        "SELECT * FROM public.videoforge_prepare_hosted_pair_send($1,$2,$3)",
        [input.accountId, input.workspaceId, input.generationRequestId],
      );
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      )
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_PREPARE_INVALID");
      return result.rows.map((row) =>
        Object.freeze({
          lane: row.lane,
          attemptId: row.attempt_id,
          dispatchToken: row.dispatch_token,
          dispatchTokenSha256: row.dispatch_token_sha256,
          endpointIdSha256: row.endpoint_id_sha256,
          requestBodySha256: row.request_body_sha256,
          deploymentId: row.deployment_id,
          phase: "PREPARED",
          expectedEnvelopeSha256: row.expected_envelope_sha256,
          attemptState: row.attempt_state,
          outboxState: row.outbox_state,
          providerJobId: row.provider_job_id,
        }),
      ) as unknown as readonly [HostedPairSendClaim, HostedPairSendClaim];
    });
  }

  async beginSend(input: Parameters<HostedPairRuntimeStore["beginSend"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await transaction.query<BeginRow>(
        "SELECT * FROM public.videoforge_begin_hosted_pair_send($1,$2,$3,$4,$5,$6)",
        [
          input.accountId,
          input.workspaceId,
          input.generationRequestId,
          input.lane,
          input.expectedAttemptId,
          input.expectedEnvelopeSha256,
        ],
      );
      const row = result.rows[0];
      if (!row || result.rows.length !== 1 || row.lane !== input.lane) {
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_SEND_CLAIM_INVALID");
      }
      return Object.freeze({
        lane: row.lane,
        attemptId: row.attempt_id,
        dispatchToken: row.dispatch_token,
        dispatchTokenSha256: row.dispatch_token_sha256,
        endpointIdSha256: row.endpoint_id_sha256,
        requestBodySha256: row.request_body_sha256,
        deploymentId: row.deployment_id,
        phase: row.phase,
        expectedEnvelopeSha256: row.expected_envelope_sha256,
      });
    });
  }

  async finishSend(input: Parameters<HostedPairRuntimeStore["finishSend"]>[0]) {
    await this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const values: readonly SqlPrimitive[] = [
        input.accountId,
        input.workspaceId,
        input.generationRequestId,
        input.lane,
        input.outcome,
        input.providerJobId,
        input.deploymentId,
        input.dispatchTokenSha256,
      ];
      const result = await transaction.query(
        "SELECT * FROM public.videoforge_finish_hosted_pair_send($1,$2,$3,$4,$5,$6,$7,$8)",
        values,
      );
      if (result.rows.length !== 1) {
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_SEND_RESULT_INVALID");
      }
    });
  }

  async inspect(input: Parameters<HostedPairRuntimeStore["inspect"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const result = await transaction.query<
        {
          lane: HostedPairLane;
          attempt_id: string;
          attempt_state: string;
          outbox_state: string;
          provider_job_id: string | null;
          deployment_id: string;
          dispatch_token_sha256: Sha256;
          pair_phase: string;
          recovery_action: string;
        } & Record<string, unknown>
      >("SELECT * FROM public.videoforge_inspect_hosted_pair_runtime($1,$2,$3)", [
        input.accountId,
        input.workspaceId,
        input.generationRequestId,
      ]);
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      ) {
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_INSPECTION_INVALID");
      }
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            lane: row.lane,
            attemptId: row.attempt_id,
            attemptState: row.attempt_state,
            outboxState: row.outbox_state,
            providerJobId: row.provider_job_id,
            deploymentId: row.deployment_id,
            dispatchTokenSha256: row.dispatch_token_sha256,
            pairPhase: row.pair_phase,
            recoveryAction: row.recovery_action,
          }),
        ),
      );
    });
  }
}

export interface HostedSignedPairEnvelope {
  readonly lane: HostedPairLane;
  readonly document: JsonValue;
}

export interface HostedSignedEnvelopeVerifier {
  /** Verifies both final v3 envelope signatures against the dedicated deployed key binding. */
  verifyPair(
    envelopes: readonly [HostedSignedPairEnvelope, HostedSignedPairEnvelope],
  ): Promise<boolean>;
}

export type HostedPairExecutionResult =
  | { readonly state: "MAGE_ASSIGNED"; readonly providerJobId: string }
  | { readonly state: "BOTH_ASSIGNED"; readonly providerJobIds: readonly [string, string] }
  | {
      readonly state: "CLEANUP_ONLY";
      readonly lane: HostedPairLane;
      readonly reason: "DISPATCH_ACK_UNKNOWN" | "REQUEST_REJECTED";
    };

const PROVIDER_JOB_ID = /^[A-Za-z0-9._:-]{1,200}$/u;

function unsignedEnvelope(document: ServerlessWorkerJobEnvelopeV3Document): JsonValue {
  const unsigned = { ...document } as Record<string, JsonValue>;
  delete unsigned.authority_sha256;
  delete unsigned.signature;
  return unsigned;
}

/**
 * Provider-free composition: transports are injected. The DB persists SENT before `/run`, and
 * only an explicit REQUEST_REJECTED is treated as proof that no provider job exists. Every other
 * thrown/malformed response is ACK_UNKNOWN. SoulX cannot begin until Mage is durably ASSIGNED.
 */
export class HostedPairRuntimeExecutor {
  constructor(
    private readonly store: HostedPairRuntimeStore,
    private readonly transports: Readonly<Record<HostedPairLane, ServerlessTransportPort>>,
    private readonly verifier: HostedSignedEnvelopeVerifier,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
    readonly envelopes: readonly [HostedSignedPairEnvelope, HostedSignedPairEnvelope];
  }): Promise<HostedPairExecutionResult> {
    if (input.envelopes[0].lane !== "mage_image" || input.envelopes[1].lane !== "soulx_avatar") {
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_ENVELOPE_ORDER_INVALID");
    }
    const prepared = await this.store.prepare(input);
    if (!(await this.verifier.verifyPair(input.envelopes))) {
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_SIGNATURE_INVALID");
    }
    for (let index = 0; index < input.envelopes.length; index += 1) {
      const envelope = input.envelopes[index]!;
      const expected = prepared[index]!;
      const document = (
        await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", envelope.document)
      ).value as ServerlessWorkerJobEnvelopeV3Document;
      const unsigned = unsignedEnvelope(document);
      if (
        document.tenant.account_id !== input.accountId ||
        document.tenant.workspace_id !== input.workspaceId ||
        document.work.generation_request_id !== input.generationRequestId ||
        document.work.lane !== envelope.lane ||
        document.work.attempt_id !== expected.attemptId ||
        document.dispatch_token !== expected.dispatchToken ||
        document.runtime.deployment_id !== expected.deploymentId ||
        (await sha256CanonicalJson(unsigned)) !== expected.expectedEnvelopeSha256
      ) {
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_ENVELOPE_LINEAGE_INVALID");
      }
    }
    const mage =
      prepared[0].attemptState === "ASSIGNED" &&
      prepared[0].outboxState === "ASSIGNED" &&
      prepared[0].providerJobId
        ? { kind: "ASSIGNED" as const, providerJobId: prepared[0].providerJobId }
        : await this.#send(input, input.envelopes[0], prepared[0]);
    if (mage.kind !== "ASSIGNED") return mage.result;
    const soulx = await this.#send(input, input.envelopes[1], prepared[1]);
    if (soulx.kind !== "ASSIGNED") return soulx.result;
    return Object.freeze({
      state: "BOTH_ASSIGNED" as const,
      providerJobIds: Object.freeze([mage.providerJobId, soulx.providerJobId]) as readonly [
        string,
        string,
      ],
    });
  }

  async #send(
    input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
      readonly dispatchTokenKey: string;
    },
    envelope: HostedSignedPairEnvelope,
    prepared: HostedPairSendClaim,
  ): Promise<
    | { readonly kind: "ASSIGNED"; readonly providerJobId: string }
    | { readonly kind: "STOP"; readonly result: HostedPairExecutionResult }
  > {
    const claim = await this.store.beginSend({
      ...input,
      lane: envelope.lane,
      expectedAttemptId: prepared.attemptId,
      expectedEnvelopeSha256: prepared.expectedEnvelopeSha256,
    });
    const document = (
      await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", envelope.document)
    ).value as ServerlessWorkerJobEnvelopeV3Document;
    const unsigned = unsignedEnvelope(document);
    const unsignedSha256 = await sha256CanonicalJson(unsigned);
    if (
      document.dispatch_token !== claim.dispatchToken ||
      document.work.lane !== claim.lane ||
      document.runtime.deployment_id !== claim.deploymentId ||
      document.work.attempt_id !== claim.attemptId ||
      unsignedSha256 !== claim.expectedEnvelopeSha256
    ) {
      // SENT is already durable. Hash/signature/lineage drift is uncertain and must not resend.
      await this.#finish(input, claim, "DISPATCH_ACK_UNKNOWN", null);
      return this.#stop(claim.lane, "DISPATCH_ACK_UNKNOWN");
    }
    try {
      const response = await this.transports[claim.lane].run({
        endpointIdSha256: claim.endpointIdSha256,
        dispatchToken: claim.dispatchToken,
        requestBodySha256: claim.requestBodySha256,
        envelope: document,
      });
      if (!response || typeof response.id !== "string" || !PROVIDER_JOB_ID.test(response.id)) {
        await this.#finish(input, claim, "DISPATCH_ACK_UNKNOWN", null);
        return this.#stop(claim.lane, "DISPATCH_ACK_UNKNOWN");
      }
      await this.#finish(input, claim, "ASSIGNED", response.id);
      return Object.freeze({ kind: "ASSIGNED" as const, providerJobId: response.id });
    } catch (error) {
      const definite =
        error instanceof ServerlessTransportError && error.code === "REQUEST_REJECTED";
      const outcome = definite ? "REQUEST_REJECTED" : "DISPATCH_ACK_UNKNOWN";
      await this.#finish(input, claim, outcome, null);
      return this.#stop(claim.lane, outcome);
    }
  }

  async #finish(
    input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
    },
    claim: HostedPairSendClaim,
    outcome: "ASSIGNED" | "DISPATCH_ACK_UNKNOWN" | "REQUEST_REJECTED",
    providerJobId: string | null,
  ) {
    await this.store.finishSend({
      ...input,
      lane: claim.lane,
      outcome,
      providerJobId,
      deploymentId: claim.deploymentId,
      dispatchTokenSha256: claim.dispatchTokenSha256,
    });
  }

  #stop(lane: HostedPairLane, reason: "DISPATCH_ACK_UNKNOWN" | "REQUEST_REJECTED") {
    return Object.freeze({
      kind: "STOP" as const,
      result: Object.freeze({ state: "CLEANUP_ONLY" as const, lane, reason }),
    });
  }
}
