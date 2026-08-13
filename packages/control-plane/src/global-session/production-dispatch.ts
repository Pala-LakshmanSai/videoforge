import { assertContract, sha256CanonicalJson, type ContractDocument } from "@videoforge/contracts";

import type { SqlExecutor } from "../database/ports.js";

export type VNextPodDispatchEnvelope = ContractDocument<"podWorkerJobEnvelope">;

export interface VNextPodDispatchReceipt {
  readonly dispatchId: string;
  readonly acceptedAt: string;
}

export interface VNextPodDispatchPort {
  dispatch(envelope: VNextPodDispatchEnvelope): Promise<VNextPodDispatchReceipt>;
}

export interface VNextPodDispatchAuthority {
  assertAuthorized(envelope: VNextPodDispatchEnvelope): Promise<void>;
}

export class VNextPodDispatchAuthorityError extends Error {
  readonly code = "VNEXT_POD_DISPATCH_UNAUTHORIZED" as const;

  constructor() {
    super("The exact Pod dispatch envelope has no current durable authority.");
    this.name = "VNextPodDispatchAuthorityError";
  }
}

export class PersistentVNextPodDispatchAuthority implements VNextPodDispatchAuthority {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly now: () => string,
  ) {}

  async assertAuthorized(envelope: VNextPodDispatchEnvelope): Promise<void> {
    const envelopeSha256 = await sha256CanonicalJson(envelope);
    const result = await this.executor.query(
      `SELECT dispatch_auth.id
         FROM pod_dispatch_authorizations dispatch_auth
         JOIN generation_sessions gs
           ON gs.id = dispatch_auth.generation_session_id
         JOIN global_queue_entries queue_entry
           ON queue_entry.generation_session_id = dispatch_auth.generation_session_id
          AND queue_entry.id = dispatch_auth.queue_entry_id
         JOIN compute_run_plans run_plan
           ON run_plan.generation_session_id = dispatch_auth.generation_session_id
          AND run_plan.id = dispatch_auth.compute_run_plan_id
          AND run_plan.queue_entry_id = dispatch_auth.queue_entry_id
         JOIN pod_lifecycle_attempts pod_attempt
           ON pod_attempt.generation_session_id = dispatch_auth.generation_session_id
          AND pod_attempt.id = dispatch_auth.pod_attempt_id
          AND pod_attempt.origin_queue_entry_id = dispatch_auth.queue_entry_id
          AND pod_attempt.lane = dispatch_auth.lane
        WHERE dispatch_auth.envelope_sha256 = $1
          AND dispatch_auth.envelope_document = $2::jsonb
          AND dispatch_auth.deadline_at >= $3
          AND dispatch_auth.state = 'AUTHORIZED'
          AND gs.state = 'ACTIVE'
          AND queue_entry.state = 'ACTIVE'
          AND run_plan.state = 'ACTIVE'
          AND pod_attempt.create_state = 'ACKNOWLEDGED'
          AND pod_attempt.model_ready_at IS NOT NULL
          AND pod_attempt.delete_state = 'NOT_REQUESTED'`,
      [envelopeSha256, JSON.stringify(envelope), this.now()],
    );
    if (result.rows.length !== 1) throw new VNextPodDispatchAuthorityError();
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export class VNextPodDispatchFirewall {
  constructor(
    private readonly authority: VNextPodDispatchAuthority,
    private readonly port: VNextPodDispatchPort,
  ) {}

  async dispatch(candidate: unknown): Promise<VNextPodDispatchReceipt> {
    const envelope = assertContract("podWorkerJobEnvelope", structuredClone(candidate));
    await this.authority.assertAuthorized(envelope);
    return this.port.dispatch(deepFreeze(envelope));
  }
}
