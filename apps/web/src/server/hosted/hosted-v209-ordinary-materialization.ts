import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import {
  sha256CanonicalJson,
  type JsonValue,
} from "@videoforge/contracts";

import type { HostedEnvelopePairSigner } from "./hosted-envelope-signer";
import type { HostedPairLane, HostedSignedPairEnvelope } from "./hosted-pair-runtime-executor";
import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";
import {
  materializeV209OrdinaryWorkerRequest,
  v209OrdinarySoulXBatch,
  type V209OrdinaryWorkerRequest,
} from "./hosted-v209-ordinary-worker-request";
import { validateAndHashHostedContractDocument } from "./precompiled-contract-validation";
import type { HostedR2Signer } from "./r2";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const LANES = ["mage_image", "soulx_avatar"] as const;

type Projection = {
  readonly schemaVersion: "videoforge.hosted-v209-ordinary-lane-materialization/v1";
  readonly lane: HostedPairLane;
  readonly attemptId: string;
  readonly dispatchToken: string;
  readonly dispatchTokenSha256: string;
  readonly envelopeTemplate: JsonValue;
  readonly baseEnvelopeTemplateSha256: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly work: readonly Record<string, unknown>[];
  readonly avatarSourceInputReservationId?: string;
};

export interface V209OrdinaryBoundLane {
  readonly lane: HostedPairLane;
  readonly attemptId: string;
  readonly envelope: HostedSignedPairEnvelope;
  readonly request: V209OrdinaryWorkerRequest;
  readonly replayed: boolean;
}

function projection(value: unknown, lane: HostedPairLane): Projection {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== "videoforge.hosted-v209-ordinary-lane-materialization/v1" ||
    row.lane !== lane ||
    typeof row.attemptId !== "string" ||
    typeof row.dispatchToken !== "string" ||
    typeof row.dispatchTokenSha256 !== "string" ||
    !SHA256.test(row.dispatchTokenSha256) ||
    !row.envelopeTemplate ||
    typeof row.envelopeTemplate !== "object" ||
    Array.isArray(row.envelopeTemplate) ||
    typeof row.baseEnvelopeTemplateSha256 !== "string" ||
    !SHA256.test(row.baseEnvelopeTemplateSha256) ||
    typeof row.issuedAt !== "string" ||
    typeof row.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(row.issuedAt)) ||
    !Number.isFinite(Date.parse(row.expiresAt)) ||
    !Array.isArray(row.work) ||
    row.work.length < 1
  )
    throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
  return row as unknown as Projection;
}

/** Binds both exact immutable-worker request bodies before a Workflow can exist. A crash after one
 * lane CAS is safe: replay reconstructs the same signed URLs/body and completes only the missing
 * lane; the database rejects every byte of drift. */
export class HostedSqlV209OrdinaryLaneMaterializer {
  constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly signer: HostedEnvelopePairSigner,
    private readonly r2: Pick<HostedR2Signer, "sign" | "signGenerated">,
  ) {}

  async bindPair(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
  }): Promise<readonly [V209OrdinaryBoundLane, V209OrdinaryBoundLane]> {
    const loaded = await Promise.all(LANES.map((lane) => this.#load(input, lane)));
    const bodies = await Promise.all(
      loaded.map(async (item) => {
        if ((await sha256CanonicalJson(item.envelopeTemplate)) !== item.baseEnvelopeTemplateSha256)
          throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_ENVELOPE_TEMPLATE_DRIFT");
        const template = item.envelopeTemplate as Record<string, JsonValue>;
        const limits = template.limits;
        if (!limits || typeof limits !== "object" || Array.isArray(limits))
          throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
        const laneManifestSha256 =
          item.lane === "soulx_avatar"
            ? await sha256CanonicalJson(
                v209OrdinarySoulXBatch(
                  item.attemptId,
                  item.avatarSourceInputReservationId,
                  item.work,
                ) as JsonValue,
              )
            : null;
        const envelopeWork = template.work;
        const artifacts = template.artifacts;
        if (
          !envelopeWork ||
          typeof envelopeWork !== "object" ||
          Array.isArray(envelopeWork) ||
          !artifacts ||
          typeof artifacts !== "object" ||
          Array.isArray(artifacts)
        )
          throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
        return Object.freeze({
          lane: item.lane,
          body: Object.freeze({
            ...template,
            work: Object.freeze({
              ...(envelopeWork as Record<string, JsonValue>),
              ...(laneManifestSha256 ? { items_manifest_sha256: laneManifestSha256 } : {}),
            }),
            artifacts: Object.freeze({
              ...(artifacts as Record<string, JsonValue>),
              ...(laneManifestSha256 ? { plan_manifest_sha256: laneManifestSha256 } : {}),
            }),
            limits: Object.freeze({
              ...(limits as Record<string, JsonValue>),
              issued_at: item.issuedAt,
              expires_at: item.expiresAt,
            }),
          }),
        });
      }),
    );
    const signatures = await this.signer.signPair(bodies);
    if (!(await this.signer.verifyPair(bodies, signatures)) || signatures.length !== 2)
      throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_ENVELOPE_SIGNATURE_INVALID");

    const bound = await Promise.all(
      loaded.map(async (item, index) => {
        const signature = signatures[index];
        if (
          !signature ||
          signature.lane !== item.lane ||
          signature.authoritySha256 !== (await sha256CanonicalJson(bodies[index]!.body))
        )
          throw new HostedDispatchCoordinationError(
            "HOSTED_V209_ORDINARY_ENVELOPE_SIGNATURE_INVALID",
          );
        const document = (
          await validateAndHashHostedContractDocument("serverlessWorkerJobEnvelopeV3", {
            ...(bodies[index]!.body as Record<string, JsonValue>),
            authority_sha256: signature.authoritySha256,
            signature: signature.signature,
          })
        ).value;
        const request = await materializeV209OrdinaryWorkerRequest(
          {
            lane: item.lane,
            accountId: input.accountId,
            workspaceId: input.workspaceId,
            attemptId: item.attemptId,
            issuedAt: item.issuedAt,
            expiresAt: item.expiresAt,
            envelope: document as Readonly<Record<string, unknown>>,
            work: item.work,
            avatarSourceInputReservationId: item.avatarSourceInputReservationId,
          },
          this.r2,
        );
        const envelopeSha256 = await sha256CanonicalJson(document);
        const replayed = await this.#commit(input, item, document, envelopeSha256, request);
        return Object.freeze({
          lane: item.lane,
          attemptId: item.attemptId,
          envelope: Object.freeze({ lane: item.lane, document }),
          request,
          replayed,
        });
      }),
    );
    if (bound[0]?.lane !== "mage_image" || bound[1]?.lane !== "soulx_avatar")
      throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
    return bound as unknown as readonly [V209OrdinaryBoundLane, V209OrdinaryBoundLane];
  }

  async #load(
    input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
      readonly dispatchTokenKey: string;
    },
    lane: HostedPairLane,
  ): Promise<Projection> {
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
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
      return projection(result.rows[0]?.value, lane);
    });
  }

  async #commit(
    input: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
    },
    item: Projection,
    _document: JsonValue,
    envelopeSha256: string,
    request: V209OrdinaryWorkerRequest,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const result = await transaction.query<{ value: unknown }>(
        `SELECT public.videoforge_commit_hosted_v209_ordinary_lane_materialization(
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS value`,
        [
          input.accountId,
          input.workspaceId,
          input.generationRequestId,
          item.lane,
          item.attemptId,
          envelopeSha256,
          JSON.stringify(request.body),
          request.requestBodySha256,
        ],
      );
      const value = result.rows[0]?.value;
      if (result.rows.length !== 1 || !value || typeof value !== "object" || Array.isArray(value))
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
      const row = value as Record<string, unknown>;
      if (
        row.requestBodySha256 !== request.requestBodySha256 ||
        row.envelopeSha256 !== envelopeSha256 ||
        typeof row.replayed !== "boolean"
      )
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_MATERIALIZATION_INVALID");
      return row.replayed;
    });
  }
}
