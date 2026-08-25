import type {
  SqlExecutor,
  SqlPrimitive,
  TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import {
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
  type ServerlessWorkerJobEnvelopeV3Document,
} from "@videoforge/contracts";

import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";
import type { HostedEnvelopePairSigner } from "./hosted-envelope-signer";

const COMMIT_FUNCTION = "public.videoforge_commit_hosted_atomic_pair_predispatch";

export interface HostedAtomicPairCommit {
  readonly lane: "mage_image" | "soulx_avatar";
  readonly attemptId: string;
  readonly authorityId: string;
  readonly outboxId: string;
  /** Returned once by PostgreSQL; no table stores this raw token. */
  readonly dispatchToken: string;
  readonly dispatchTokenSha256: string;
  readonly unsignedEnvelope: JsonValue;
  readonly unsignedEnvelopeSha256: string;
  readonly requestBodySha256: string;
  readonly endpointIdSha256: string;
  readonly outputPrefix: string;
  readonly authoritySha256: string;
  readonly requestTtlSeconds: number;
  readonly deadlineAt: string;
  readonly reconciliationDeadlineAt: string;
}

type CommitRow = {
  lane: "mage_image" | "soulx_avatar";
  attempt_id: string;
  authority_id: string;
  outbox_id: string;
  dispatch_token: string;
  dispatch_token_sha256: string;
  unsigned_envelope: JsonValue;
  unsigned_envelope_sha256: string;
  request_body_sha256: string;
  endpoint_id_sha256: string;
  output_prefix: string;
  authority_sha256: string;
  request_ttl_seconds: number;
  deadline_at: string | Date;
  reconciliation_deadline_at: string | Date;
} & Record<string, unknown>;

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_INVALID");
  return date.toISOString();
}

/** One database call is the mutation boundary. The caller must sign and verify both returned
 * tokenized unsigned bodies before deterministic Mage-then-SoulX transport. */
export class HostedSqlAtomicPairPredispatch {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async commit(input: {
    readonly approvalId: string;
    readonly approvalSha256: string;
    readonly claimId: string;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly generationPlanSha256: string;
    readonly leaseId: string;
    readonly laneBindings: JsonValue;
    readonly totalCapUsd: number;
    readonly expiresAt: string;
    readonly pair: JsonValue;
    readonly dispatchTokenKey: string;
  }): Promise<readonly HostedAtomicPairCommit[]> {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await this.#query<CommitRow>(
        transaction,
        `SELECT * FROM ${COMMIT_FUNCTION}(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::numeric,$13::timestamptz,$14::jsonb)`,
        [
          input.approvalId,
          input.approvalSha256,
          input.claimId,
          input.accountId,
          input.workspaceId,
          input.projectId,
          input.projectRevisionId,
          input.generationRequestId,
          input.generationPlanSha256,
          input.leaseId,
          JSON.stringify(input.laneBindings),
          input.totalCapUsd,
          input.expiresAt,
          JSON.stringify(input.pair),
        ],
      );
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      ) {
        throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_INVALID");
      }
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            lane: row.lane,
            attemptId: row.attempt_id,
            authorityId: row.authority_id,
            outboxId: row.outbox_id,
            dispatchToken: row.dispatch_token,
            dispatchTokenSha256: row.dispatch_token_sha256,
            unsignedEnvelope: row.unsigned_envelope,
            unsignedEnvelopeSha256: row.unsigned_envelope_sha256,
            requestBodySha256: row.request_body_sha256,
            endpointIdSha256: row.endpoint_id_sha256,
            outputPrefix: row.output_prefix,
            authoritySha256: row.authority_sha256,
            requestTtlSeconds: row.request_ttl_seconds,
            deadlineAt: iso(row.deadline_at),
            reconciliationDeadlineAt: iso(row.reconciliation_deadline_at),
          }),
        ),
      );
    });
  }

  async recover(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
  }): Promise<
    readonly {
      lane: "mage_image" | "soulx_avatar";
      attemptId: string;
      dispatchToken: string;
      dispatchTokenSha256: string;
      outboxState: string;
    }[]
  > {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await transaction.query<
        {
          lane: "mage_image" | "soulx_avatar";
          attempt_id: string;
          dispatch_token: string;
          dispatch_token_sha256: string;
          outbox_state: string;
        } & Record<string, unknown>
      >(`SELECT * FROM public.videoforge_recover_hosted_atomic_pair_tokens($1,$2,$3)`, [
        input.accountId,
        input.workspaceId,
        input.generationRequestId,
      ]);
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      ) {
        throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_RECOVERY_INVALID");
      }
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            lane: row.lane,
            attemptId: row.attempt_id,
            dispatchToken: row.dispatch_token,
            dispatchTokenSha256: row.dispatch_token_sha256,
            outboxState: row.outbox_state,
          }),
        ),
      );
    });
  }

  #query<Row extends Record<string, unknown>>(
    executor: SqlExecutor,
    sql: string,
    values: readonly SqlPrimitive[],
  ) {
    return executor.query<Row>(sql, values);
  }
}

export type HostedAtomicPairRecoveryDecision =
  | "SEND_MAGE_ONLY"
  | "SEND_SOULX_ONLY"
  | "CLEANUP_ONLY"
  | "COMPLETE";

/** Restart rule deliberately has no resend state. SoulX is sendable only after Mage is durably
 * assigned and SoulX is still provably untouched. Any SENT/ambiguous/non-exact state reconciles or
 * cancels without new transport. */
export function decideHostedAtomicPairRecovery(input: {
  readonly mage: string;
  readonly soulx: string;
}): HostedAtomicPairRecoveryDecision {
  if (input.mage === "ASSIGNED" && input.soulx === "READY_TO_DISPATCH") return "SEND_SOULX_ONLY";
  if (input.mage === "READY_TO_DISPATCH" && input.soulx === "READY_TO_DISPATCH")
    return "SEND_MAGE_ONLY";
  if (input.mage === "ASSIGNED" && input.soulx === "ASSIGNED") return "COMPLETE";
  return "CLEANUP_ONLY";
}

/** Trusted pre-transport gate: both DB-tokenized bodies are signed and verified as one pair before
 * the caller may send Mage first. It returns nothing partially usable on signer/hash drift. */
export async function signAndVerifyHostedAtomicPair(
  commits: readonly HostedAtomicPairCommit[],
  signer: HostedEnvelopePairSigner,
) {
  if (
    commits.length !== 2 ||
    commits[0]?.lane !== "mage_image" ||
    commits[1]?.lane !== "soulx_avatar"
  ) {
    throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_INVALID");
  }
  const bodies = commits.map((commit) => ({ lane: commit.lane, body: commit.unsignedEnvelope }));
  const hashes = await Promise.all(bodies.map(({ body }) => sha256CanonicalJson(body)));
  if (hashes.some((hash, index) => hash !== commits[index]?.unsignedEnvelopeSha256)) {
    throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_HASH_DRIFT");
  }
  const signatures = await signer.signPair(bodies);
  if (!(await signer.verifyPair(bodies, signatures)) || signatures.length !== 2) {
    throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_SIGNATURE_INVALID");
  }
  for (let index = 0; index < signatures.length; index += 1) {
    if (
      signatures[index]?.lane !== commits[index]?.lane ||
      signatures[index]?.authoritySha256 !== hashes[index]
    ) {
      throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_SIGNATURE_INVALID");
    }
  }
  const envelopes: ServerlessWorkerJobEnvelopeV3Document[] = [];
  for (let index = 0; index < commits.length; index += 1) {
    const signature = signatures[index]!;
    try {
      envelopes.push(
        (
          await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", {
            ...(commits[index]!.unsignedEnvelope as Record<string, JsonValue>),
            authority_sha256: signature.authoritySha256,
            signature: signature.signature,
          })
        ).value,
      );
    } catch {
      throw new HostedDispatchCoordinationError("HOSTED_ATOMIC_PAIR_FINAL_ENVELOPE_INVALID");
    }
  }
  return Object.freeze(envelopes);
}
