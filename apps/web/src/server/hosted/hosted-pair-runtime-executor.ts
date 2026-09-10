import type { SqlPrimitive, TransactionalSqlExecutor } from "@videoforge/control-plane";
import {
  ServerlessTransportError,
  type ServerlessTransportPort,
  type Sha256,
} from "@videoforge/control-plane";
import {
  sha256CanonicalJson,
  type JsonValue,
  type ServerlessWorkerJobEnvelopeV3Document,
} from "@videoforge/contracts";

import { validateAndHashHostedContractDocument } from "./precompiled-contract-validation";
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
  /** Exact immutable-handler input, present only for ordinary V2-09 materialized lanes. */
  readonly requestBody?: Readonly<Record<string, unknown>>;
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
    readonly expectedRequestBodySha256?: Sha256;
  }): Promise<HostedPairSendClaim>;
  /** Atomically marks both fresh lanes SENT before either provider /run call begins. */
  beginPairSend?(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
    readonly expected: readonly [
      Pick<HostedPairSendClaim, "attemptId" | "expectedEnvelopeSha256">,
      Pick<HostedPairSendClaim, "attemptId" | "expectedEnvelopeSha256">,
    ];
  }): Promise<readonly [HostedPairSendClaim, HostedPairSendClaim]>;
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
  /** Parallel-pair outcomes use a state machine that permits either acknowledgement to arrive first. */
  finishPairSend?(input: {
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

/**
 * Optional provider-readiness hook used by the concrete RunPod pair wiring.  It is deliberately
 * outside ServerlessTransportPort: readiness is a read-only admission step and must complete before
 * the durable begin-send mutation, while the provider-neutral transport surface remains limited to
 * run/status/cancel.
 */
export type HostedPairRuntimeTransport = ServerlessTransportPort & {
  readonly preflight?: () => Promise<void> | void;
};

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

  async beginPairSend(input: Parameters<NonNullable<HostedPairRuntimeStore["beginPairSend"]>>[0]) {
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
        "SELECT * FROM public.videoforge_begin_hosted_pair_parallel_send($1,$2,$3,$4,$5,$6,$7)",
        [
          input.accountId,
          input.workspaceId,
          input.generationRequestId,
          input.expected[0].attemptId,
          input.expected[0].expectedEnvelopeSha256,
          input.expected[1].attemptId,
          input.expected[1].expectedEnvelopeSha256,
        ],
      );
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      ) {
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_SEND_CLAIM_INVALID");
      }
      return result.rows.map((row) =>
        Object.freeze({
          lane: row.lane,
          attemptId: row.attempt_id,
          dispatchToken: row.dispatch_token,
          dispatchTokenSha256: row.dispatch_token_sha256,
          endpointIdSha256: row.endpoint_id_sha256,
          requestBodySha256: row.request_body_sha256,
          deploymentId: row.deployment_id,
          phase: row.phase,
          expectedEnvelopeSha256: row.expected_envelope_sha256,
        }),
      ) as unknown as readonly [HostedPairSendClaim, HostedPairSendClaim];
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

  async finishPairSend(input: Parameters<NonNullable<HostedPairRuntimeStore["finishPairSend"]>>[0]) {
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
        "SELECT * FROM public.videoforge_finish_hosted_pair_parallel_send($1,$2,$3,$4,$5,$6,$7,$8)",
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
      // Before the first beginSend, the committed attempts/outboxes exist but the runtime-state
      // row does not. Preserve only that empty projection; malformed non-empty projections fail.
      if (result.rows.length === 0) return Object.freeze([] as HostedPairInspection[]);
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
 * thrown/malformed response is ACK_UNKNOWN. Fresh pairs are atomically marked SENT and both
 * provider requests are issued concurrently; acknowledgement order is handled durably by the
 * parallel-pair state machine. Legacy partially assigned pairs retain one-lane recovery.
 */
export class HostedPairRuntimeExecutor {
  constructor(
    private readonly store: HostedPairRuntimeStore,
    private readonly transports: Readonly<Record<HostedPairLane, HostedPairRuntimeTransport>>,
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
    console.info("hosted_pair_runtime", { event: "PREPARE_STARTED" });
    const prepared = await this.store.prepare(input);
    console.info("hosted_pair_runtime", { event: "PREPARE_COMPLETE" });
    if (!(await this.verifier.verifyPair(input.envelopes))) {
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_SIGNATURE_INVALID");
    }
    console.info("hosted_pair_runtime", { event: "SIGNATURES_VERIFIED" });
    for (let index = 0; index < input.envelopes.length; index += 1) {
      const envelope = input.envelopes[index]!;
      const expected = prepared[index]!;
      const document = (
        await validateAndHashHostedContractDocument(
          "serverlessWorkerJobEnvelopeV3",
          envelope.document,
        )
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
        (await sha256CanonicalJson(expected.requestBody ? document : unsigned)) !==
          expected.expectedEnvelopeSha256
      ) {
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_ENVELOPE_LINEAGE_INVALID");
      }
      if (expected.requestBody) {
        const requestEnvelope = expected.requestBody.envelope;
        if (
          (await sha256CanonicalJson(expected.requestBody as JsonValue)) !==
            expected.requestBodySha256 ||
          !requestEnvelope ||
          typeof requestEnvelope !== "object" ||
          Array.isArray(requestEnvelope) ||
          (await sha256CanonicalJson(requestEnvelope as JsonValue)) !==
            (await sha256CanonicalJson(document))
        )
          throw new HostedDispatchCoordinationError("HOSTED_PAIR_REQUEST_BODY_LINEAGE_INVALID");
      }
    }
    console.info("hosted_pair_runtime", { event: "ENVELOPES_VERIFIED" });
    const mage = this.#assigned(prepared[0]);
    const soulx = this.#assigned(prepared[1]);
    if (mage && soulx) return this.#bothAssigned(mage.providerJobId, soulx.providerJobId);

    // A fresh pair has no provider assignment on either lane. Run both read-only admission checks
    // first, atomically persist both SENT claims, and only then enter the parallel provider phase.
    // If either preflight fails, no paid mutation has occurred and the caller may retry safely.
    if (!mage && !soulx && this.store.beginPairSend && this.store.finishPairSend) {
      const preflights = await Promise.allSettled([
        this.transports.mage_image.preflight?.(),
        this.transports.soulx_avatar.preflight?.(),
      ]);
      if (preflights[0]?.status === "rejected") throw preflights[0].reason;
      if (preflights[1]?.status === "rejected") throw preflights[1].reason;
      const begun = await this.store.beginPairSend({
        ...input,
        expected: [
          {
            attemptId: prepared[0].attemptId,
            expectedEnvelopeSha256: prepared[0].expectedEnvelopeSha256,
          },
          {
            attemptId: prepared[1].attemptId,
            expectedEnvelopeSha256: prepared[1].expectedEnvelopeSha256,
          },
        ],
      });
      const sends = await Promise.allSettled([
        this.#sendClaim(input, input.envelopes[0], prepared[0], begun[0], true),
        this.#sendClaim(input, input.envelopes[1], prepared[1], begun[1], true),
      ]);
      if (sends[0]?.status === "rejected") throw sends[0].reason;
      if (sends[1]?.status === "rejected") throw sends[1].reason;
      const parallelMage = sends[0].value;
      const parallelSoulx = sends[1].value;
      if (parallelMage.kind !== "ASSIGNED") return parallelMage.result;
      if (parallelSoulx.kind !== "ASSIGNED") return parallelSoulx.result;
      return this.#bothAssigned(parallelMage.providerJobId, parallelSoulx.providerJobId);
    }

    // Crash recovery or an older materialization may have one lane assigned already. Preserve the
    // original one-shot single-lane path; it never resends a known or ambiguous lane.
    if (soulx && !mage)
      return this.#stop("mage_image", "DISPATCH_ACK_UNKNOWN").result;
    const recoveredMage = mage ?? (await this.#send(input, input.envelopes[0], prepared[0]));
    if (recoveredMage.kind !== "ASSIGNED") return recoveredMage.result;
    const recoveredSoulx = await this.#send(input, input.envelopes[1], prepared[1]);
    if (recoveredSoulx.kind !== "ASSIGNED") return recoveredSoulx.result;
    return this.#bothAssigned(recoveredMage.providerJobId, recoveredSoulx.providerJobId);
  }

  #assigned(prepared: HostedPairSendClaim) {
    return prepared.attemptState === "ASSIGNED" &&
      prepared.outboxState === "ASSIGNED" &&
      prepared.providerJobId
      ? { kind: "ASSIGNED" as const, providerJobId: prepared.providerJobId }
      : null;
  }

  #bothAssigned(mageProviderJobId: string, soulxProviderJobId: string) {
    return Object.freeze({
      state: "BOTH_ASSIGNED" as const,
      providerJobIds: Object.freeze([mageProviderJobId, soulxProviderJobId]) as readonly [
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
    // Read-only provider admission must happen before beginSend persists SENT and increments the
    // attempt's send counter. A health/queue read can fail transiently and cannot be converted into
    // a permanent REQUEST_REJECTED result after the database mutation has already happened.
    await this.transports[prepared.lane].preflight?.();
    console.info("hosted_pair_runtime", { event: "BEGIN_SEND", lane: envelope.lane });
    const claim = await this.store.beginSend({
      ...input,
      lane: envelope.lane,
      expectedAttemptId: prepared.attemptId,
      expectedEnvelopeSha256: prepared.expectedEnvelopeSha256,
      ...(prepared.requestBody ? { expectedRequestBodySha256: prepared.requestBodySha256 } : {}),
    });
    console.info("hosted_pair_runtime", { event: "SEND_CLAIMED", lane: envelope.lane });
    return this.#sendClaim(input, envelope, prepared, claim, false);
  }

  async #sendClaim(
    input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
    },
    envelope: HostedSignedPairEnvelope,
    prepared: HostedPairSendClaim,
    claim: HostedPairSendClaim,
    parallel: boolean,
  ): Promise<
    | { readonly kind: "ASSIGNED"; readonly providerJobId: string }
    | { readonly kind: "STOP"; readonly result: HostedPairExecutionResult }
  > {
    const document = (
      await validateAndHashHostedContractDocument(
        "serverlessWorkerJobEnvelopeV3",
        envelope.document,
      )
    ).value as ServerlessWorkerJobEnvelopeV3Document;
    const unsigned = unsignedEnvelope(document);
    if (
      document.dispatch_token !== claim.dispatchToken ||
      document.work.lane !== claim.lane ||
      document.runtime.deployment_id !== claim.deploymentId ||
      document.work.attempt_id !== claim.attemptId ||
      (await sha256CanonicalJson(prepared.requestBody ? document : unsigned)) !==
        claim.expectedEnvelopeSha256 ||
      claim.requestBodySha256 !== prepared.requestBodySha256
    ) {
      // SENT is already durable. Hash/signature/lineage drift is uncertain and must not resend.
      await this.#finish(input, claim, "DISPATCH_ACK_UNKNOWN", null, parallel);
      return this.#stop(claim.lane, "DISPATCH_ACK_UNKNOWN");
    }
    try {
      console.info("hosted_pair_runtime", { event: "PROVIDER_SEND_STARTED", lane: envelope.lane });
      const response = await this.transports[claim.lane].run({
        endpointIdSha256: claim.endpointIdSha256,
        dispatchToken: claim.dispatchToken,
        requestBodySha256: claim.requestBodySha256,
        envelope: document,
        ...(prepared.requestBody ? { body: prepared.requestBody } : {}),
      });
      console.info("hosted_pair_runtime", { event: "PROVIDER_SEND_ACKNOWLEDGED", lane: envelope.lane });
      if (!response || typeof response.id !== "string" || !PROVIDER_JOB_ID.test(response.id)) {
        await this.#finish(input, claim, "DISPATCH_ACK_UNKNOWN", null, parallel);
        return this.#stop(claim.lane, "DISPATCH_ACK_UNKNOWN");
      }
      await this.#finish(input, claim, "ASSIGNED", response.id, parallel);
      return Object.freeze({ kind: "ASSIGNED" as const, providerJobId: response.id });
    } catch (error) {
      const definite =
        error instanceof ServerlessTransportError && error.code === "REQUEST_REJECTED";
      const outcome = definite ? "REQUEST_REJECTED" : "DISPATCH_ACK_UNKNOWN";
      await this.#finish(input, claim, outcome, null, parallel);
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
    parallel = false,
  ) {
    const inputValue = {
      ...input,
      lane: claim.lane,
      outcome,
      providerJobId,
      deploymentId: claim.deploymentId,
      dispatchTokenSha256: claim.dispatchTokenSha256,
    } as const;
    if (parallel && this.store.finishPairSend) {
      await this.store.finishPairSend(inputValue);
    } else {
      await this.store.finishSend(inputValue);
    }
  }

  #stop(lane: HostedPairLane, reason: "DISPATCH_ACK_UNKNOWN" | "REQUEST_REJECTED") {
    return Object.freeze({
      kind: "STOP" as const,
      result: Object.freeze({ state: "CLEANUP_ONLY" as const, lane, reason }),
    });
  }
}
