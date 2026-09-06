import type { TransactionalSqlExecutor } from "@videoforge/control-plane";

import {
  HostedSqlPairRuntimeStore,
  type HostedPairLane,
  type HostedPairRuntimeStore,
  type HostedPairSendClaim,
} from "./hosted-pair-runtime-executor";
import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";

const LANES = ["mage_image", "soulx_avatar"] as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

type MaterializedProjection = {
  readonly lane: HostedPairLane;
  readonly attemptId: string;
  readonly dispatchToken: string;
  readonly dispatchTokenSha256: `sha256:${string}`;
  readonly endpointIdSha256: `sha256:${string}`;
  readonly deploymentId: string;
  readonly existingMaterialization: {
    readonly requestBody: Readonly<Record<string, unknown>>;
    readonly requestBodySha256: `sha256:${string}`;
    readonly envelopeSha256: `sha256:${string}`;
  };
};

type BeginRow = {
  lane: HostedPairLane;
  attempt_id: string;
  dispatch_token: string;
  dispatch_token_sha256: `sha256:${string}`;
  endpoint_id_sha256: `sha256:${string}`;
  request_body_sha256: `sha256:${string}`;
  deployment_id: string;
  phase: string;
  expected_envelope_sha256: `sha256:${string}`;
};

function exactProjection(value: unknown, lane: HostedPairLane): MaterializedProjection {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_RUNTIME_INVALID");
  const row = value as Record<string, unknown>;
  const materialized = row.existingMaterialization;
  if (!materialized || typeof materialized !== "object" || Array.isArray(materialized))
    throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_REQUEST_NOT_BOUND");
  const bound = materialized as Record<string, unknown>;
  if (
    row.lane !== lane ||
    typeof row.attemptId !== "string" ||
    typeof row.dispatchToken !== "string" ||
    typeof row.dispatchTokenSha256 !== "string" ||
    typeof row.endpointIdSha256 !== "string" ||
    typeof row.deploymentId !== "string" ||
    !SHA256.test(row.dispatchTokenSha256) ||
    !SHA256.test(row.endpointIdSha256) ||
    !bound.requestBody ||
    typeof bound.requestBody !== "object" ||
    Array.isArray(bound.requestBody) ||
    typeof bound.requestBodySha256 !== "string" ||
    typeof bound.envelopeSha256 !== "string" ||
    !SHA256.test(bound.requestBodySha256) ||
    !SHA256.test(bound.envelopeSha256)
  )
    throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_RUNTIME_INVALID");
  return row as unknown as MaterializedProjection;
}

/** Runtime store for 0074 ordinary lanes. It never reconstructs or shortens signed ports: the
 * exact full request committed before Workflow creation is what the one `/run` call receives. */
export class HostedSqlV209OrdinaryRuntimeStore implements HostedPairRuntimeStore {
  readonly #base: HostedSqlPairRuntimeStore;

  constructor(private readonly database: TransactionalSqlExecutor) {
    this.#base = new HostedSqlPairRuntimeStore(database);
  }

  async prepare(input: Parameters<HostedPairRuntimeStore["prepare"]>[0]) {
    const rows = await Promise.all(LANES.map((lane) => this.#load(input, lane)));
    return rows.map((row) => this.#claim(row, "PREPARED")) as unknown as readonly [
      HostedPairSendClaim,
      HostedPairSendClaim,
    ];
  }

  async beginSend(input: Parameters<HostedPairRuntimeStore["beginSend"]>[0]) {
    if (!input.expectedRequestBodySha256)
      throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_REQUEST_NOT_BOUND");
    const expectedRequestBodySha256 = input.expectedRequestBodySha256;
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const begun = await transaction.query<BeginRow>(
        `SELECT * FROM public.videoforge_begin_hosted_v209_ordinary_send(
           $1,$2,$3,$4,$5,$6,$7)`,
        [
          input.accountId,
          input.workspaceId,
          input.generationRequestId,
          input.lane,
          input.expectedAttemptId,
          input.expectedEnvelopeSha256,
          expectedRequestBodySha256,
        ],
      );
      const row = begun.rows[0];
      if (!row || begun.rows.length !== 1 || row.lane !== input.lane)
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_BEGIN_INVALID");
      const loaded = await transaction.query<{ value: unknown }>(
        "SELECT public.videoforge_load_hosted_v209_ordinary_lane_materialization($1,$2,$3,$4) AS value",
        [input.accountId, input.workspaceId, input.generationRequestId, input.lane],
      );
      const projection = exactProjection(loaded.rows[0]?.value, input.lane);
      const claim = this.#claim(projection, row.phase);
      if (
        claim.attemptId !== row.attempt_id ||
        claim.dispatchToken !== row.dispatch_token ||
        claim.requestBodySha256 !== row.request_body_sha256 ||
        claim.expectedEnvelopeSha256 !== row.expected_envelope_sha256
      )
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_BEGIN_INVALID");
      return claim;
    });
  }

  finishSend(input: Parameters<HostedPairRuntimeStore["finishSend"]>[0]) {
    return this.#base.finishSend(input);
  }

  inspect(input: Parameters<HostedPairRuntimeStore["inspect"]>[0]) {
    return this.#base.inspect(input);
  }

  async #load(
    input: Parameters<HostedPairRuntimeStore["prepare"]>[0],
    lane: HostedPairLane,
  ): Promise<MaterializedProjection> {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await transaction.query<{ value: unknown }>(
        "SELECT public.videoforge_load_hosted_v209_ordinary_lane_materialization($1,$2,$3,$4) AS value",
        [input.accountId, input.workspaceId, input.generationRequestId, lane],
      );
      if (result.rows.length !== 1)
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_RUNTIME_INVALID");
      return exactProjection(result.rows[0]?.value, lane);
    });
  }

  #claim(row: MaterializedProjection, phase: string): HostedPairSendClaim {
    const bound = row.existingMaterialization;
    const envelope = bound.requestBody.envelope;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_RUNTIME_INVALID");
    return Object.freeze({
      lane: row.lane,
      attemptId: row.attemptId,
      dispatchToken: row.dispatchToken,
      dispatchTokenSha256: row.dispatchTokenSha256,
      endpointIdSha256: row.endpointIdSha256,
      requestBodySha256: bound.requestBodySha256,
      deploymentId: row.deploymentId,
      phase,
      expectedEnvelopeSha256: bound.envelopeSha256,
      requestBody: bound.requestBody,
    });
  }
}
