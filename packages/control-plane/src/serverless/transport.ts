import type { Sha256 } from "../repositories/types.js";
import { digestUtf8 } from "./authority.js";
import type { ProvenanceReceipt } from "./receipts.js";

/**
 * Provider-free Serverless transport.
 *
 * The surface deliberately models only `/run`, `/status`, and `/cancel`. There is no endpoint-wide
 * purge operation to call, so ordinary code cannot reach one even by mistake, and no method
 * promises client idempotency or exactly-once execution.
 */
export type FakeProviderStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export type FakeTransportFault =
  /** The request never reached the endpoint. No job exists. */
  | "RUN_RESPONSE_LOST_BEFORE_ACCEPT"
  /** The endpoint accepted the job and the response was lost in transit. */
  | "RUN_RESPONSE_LOST_AFTER_ACCEPT"
  /** The provider ran the same accepted job twice and billed for both. */
  | "DUPLICATE_EXECUTION"
  /** The worker died mid-run without a terminal upload. */
  | "WORKER_DEATH"
  /** The provider TTL removed a job that had already started. */
  | "TTL_EXPIRY"
  /** The handler exceeded the measured execution timeout. */
  | "EXECUTION_TIMEOUT";

export class FakeTransportError extends Error {
  constructor(readonly code: "TRANSPORT_RESPONSE_LOST" | "PROVIDER_JOB_UNKNOWN") {
    super(code);
    this.name = "FakeTransportError";
  }
}

export interface FakeRunRequest {
  readonly endpointIdSha256: Sha256;
  readonly dispatchToken: string;
  readonly requestBodySha256: Sha256;
  readonly envelope: Readonly<Record<string, unknown>>;
}

export interface FakeJobSnapshot {
  readonly id: string;
  readonly status: FakeProviderStatus;
  readonly executionCount: number;
  readonly workerId: string | null;
  readonly billedSeconds: number;
}

export interface FakeWebhookDelivery {
  readonly providerJobId: string;
  readonly callbackTokenSha256: Sha256;
  readonly status: FakeProviderStatus;
  readonly deliveredAt: string;
}

interface FakeJob {
  readonly id: string;
  readonly dispatchToken: string;
  readonly requestBodySha256: Sha256;
  status: FakeProviderStatus;
  executionCount: number;
  workerId: string | null;
  billedSeconds: number;
}

export interface FakeEndpointOptions {
  readonly endpointIdSha256: Sha256;
  readonly callbackTokenSha256: Sha256;
  /** Deterministic provider job identifiers keep every transport test reproducible. */
  readonly jobIdPrefix?: string;
}

/**
 * One lane endpoint. Job identifiers are minted by the endpoint, exactly as RunPod mints them, so
 * the control plane can never assume it controls the identity of a submitted job.
 */
export class FakeServerlessEndpoint {
  readonly #jobs = new Map<string, FakeJob>();
  readonly #options: FakeEndpointOptions;
  readonly #webhooks: FakeWebhookDelivery[] = [];
  readonly #receipts = new Map<string, ProvenanceReceipt[]>();
  #faults: FakeTransportFault[] = [];
  #sequence = 0;

  constructor(options: FakeEndpointOptions) {
    this.#options = options;
  }

  injectFault(fault: FakeTransportFault): void {
    this.#faults.push(fault);
  }

  #takeFault(candidates: readonly FakeTransportFault[]): FakeTransportFault | null {
    const index = this.#faults.findIndex((fault) => candidates.includes(fault));
    if (index < 0) return null;
    const [fault] = this.#faults.splice(index, 1);
    return fault ?? null;
  }

  /** POST /run. Returns the provider's job identifier, or loses the response. */
  run(request: FakeRunRequest): { readonly id: string } {
    if (request.endpointIdSha256 !== this.#options.endpointIdSha256) {
      throw new FakeTransportError("PROVIDER_JOB_UNKNOWN");
    }
    const fault = this.#takeFault([
      "RUN_RESPONSE_LOST_BEFORE_ACCEPT",
      "RUN_RESPONSE_LOST_AFTER_ACCEPT",
    ]);
    if (fault === "RUN_RESPONSE_LOST_BEFORE_ACCEPT") {
      throw new FakeTransportError("TRANSPORT_RESPONSE_LOST");
    }

    this.#sequence += 1;
    const id = `${this.#options.jobIdPrefix ?? "job"}-${String(this.#sequence).padStart(4, "0")}`;
    this.#jobs.set(id, {
      id,
      dispatchToken: request.dispatchToken,
      requestBodySha256: request.requestBodySha256,
      status: "IN_QUEUE",
      executionCount: 0,
      workerId: null,
      billedSeconds: 0,
    });

    if (fault === "RUN_RESPONSE_LOST_AFTER_ACCEPT") {
      throw new FakeTransportError("TRANSPORT_RESPONSE_LOST");
    }
    return { id };
  }

  /** GET /status/{id}. */
  status(providerJobId: string): FakeJobSnapshot {
    const job = this.#jobs.get(providerJobId);
    if (job === undefined) throw new FakeTransportError("PROVIDER_JOB_UNKNOWN");
    return Object.freeze({
      id: job.id,
      status: job.status,
      executionCount: job.executionCount,
      workerId: job.workerId,
      billedSeconds: job.billedSeconds,
    });
  }

  /** POST /cancel/{id}. Cancellation targets one exact job and never the endpoint queue. */
  cancel(providerJobId: string): FakeJobSnapshot {
    const job = this.#jobs.get(providerJobId);
    if (job === undefined) throw new FakeTransportError("PROVIDER_JOB_UNKNOWN");
    if (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS") {
      job.status = "CANCELLED";
      this.#emitWebhook(job);
    }
    return this.status(providerJobId);
  }

  /**
   * Drives one job to a terminal state, applying any injected execution fault. The supplied worker
   * produces the signed provenance receipt exactly as a real handler would.
   */
  execute(
    providerJobId: string,
    worker: (attemptExecutionOrdinal: number, workerId: string) => ProvenanceReceipt,
  ): FakeJobSnapshot {
    const job = this.#jobs.get(providerJobId);
    if (job === undefined) throw new FakeTransportError("PROVIDER_JOB_UNKNOWN");
    if (job.status !== "IN_QUEUE" && job.status !== "IN_PROGRESS")
      return this.status(providerJobId);

    const fault = this.#takeFault([
      "DUPLICATE_EXECUTION",
      "WORKER_DEATH",
      "TTL_EXPIRY",
      "EXECUTION_TIMEOUT",
    ]);

    if (fault === "TTL_EXPIRY") {
      // TTL covers queue time as well as execution, so it can remove a running job.
      job.status = "TIMED_OUT";
      job.billedSeconds += 12;
      this.#emitWebhook(job);
      return this.status(providerJobId);
    }

    job.status = "IN_PROGRESS";
    job.workerId = `worker-${job.id}`;

    if (fault === "WORKER_DEATH") {
      job.status = "FAILED";
      job.billedSeconds += 30;
      this.#emitWebhook(job);
      return this.status(providerJobId);
    }
    if (fault === "EXECUTION_TIMEOUT") {
      job.status = "TIMED_OUT";
      job.billedSeconds += 90;
      this.#emitWebhook(job);
      return this.status(providerJobId);
    }

    const executions = fault === "DUPLICATE_EXECUTION" ? 2 : 1;
    for (let ordinal = 1; ordinal <= executions; ordinal += 1) {
      job.executionCount += 1;
      job.billedSeconds += 60;
      const receipt = worker(job.executionCount, `${job.workerId ?? "worker"}-${String(ordinal)}`);
      const stored = this.#receipts.get(receipt.dispatch_token) ?? [];
      stored.push(receipt);
      this.#receipts.set(receipt.dispatch_token, stored);
    }
    job.status = "COMPLETED";
    this.#emitWebhook(job);
    return this.status(providerJobId);
  }

  #emitWebhook(job: FakeJob): void {
    this.#webhooks.push({
      providerJobId: job.id,
      callbackTokenSha256: this.#options.callbackTokenSha256,
      status: job.status,
      deliveredAt: new Date(0).toISOString(),
    });
  }

  /** Advisory deliveries only. Losing, replaying, or reordering them cannot change durable truth. */
  drainWebhooks(): readonly FakeWebhookDelivery[] {
    return this.#webhooks.splice(0, this.#webhooks.length);
  }

  /**
   * Durable signed receipts, keyed by dispatch token. This models the private-R2 provenance prefix,
   * which is the only channel that can resolve a lost `/run` response into a unique assignment.
   */
  provenanceReceiptsFor(dispatchToken: string): readonly ProvenanceReceipt[] {
    return this.#receipts.get(dispatchToken) ?? [];
  }

  provenanceReceiptsForTokenHash(dispatchTokenSha256: Sha256): readonly ProvenanceReceipt[] {
    for (const [token, receipts] of this.#receipts) {
      if (digestUtf8(token) === dispatchTokenSha256) return receipts;
    }
    return [];
  }

  /** Test-only introspection. Production code never enumerates provider jobs. */
  acceptedJobCount(): number {
    return this.#jobs.size;
  }

  totalBilledSeconds(): number {
    return [...this.#jobs.values()].reduce((total, job) => total + job.billedSeconds, 0);
  }
}
