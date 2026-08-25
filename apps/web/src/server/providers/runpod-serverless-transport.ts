import type {
  ServerlessJobSnapshot,
  ServerlessProviderStatus,
  ServerlessRunRequest,
  ServerlessTransportPort,
} from "@videoforge/control-plane";
import { ServerlessTransportError } from "@videoforge/control-plane";
import type { JsonValue } from "@videoforge/contracts";

import type { RunPodJobResult, RunPodServerlessJobClient } from "./runpod-control";
import { RunPodControlError } from "./runpod-control";

const PROVIDER_STATUSES = new Set<ServerlessProviderStatus>([
  "IN_QUEUE",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

export type RunPodServerlessJobPort = Pick<
  RunPodServerlessJobClient,
  "dispatch" | "status" | "cancel"
>;

function snapshot(result: RunPodJobResult): ServerlessJobSnapshot {
  if (!PROVIDER_STATUSES.has(result.status as ServerlessProviderStatus)) {
    throw new ServerlessTransportError("REQUEST_REJECTED");
  }
  return Object.freeze({
    id: result.id,
    status: result.status as ServerlessProviderStatus,
  });
}

function mapRunPodError(
  error: unknown,
  operation: "run" | "status" | "cancel",
): ServerlessTransportError {
  if (!(error instanceof RunPodControlError)) {
    return new ServerlessTransportError("REQUEST_REJECTED");
  }
  if (
    operation === "run" &&
    ["RUNPOD_MUTATION_AMBIGUOUS", "RUNPOD_MUTATION_FAILED", "RUNPOD_RESPONSE_INVALID"].includes(
      error.code,
    )
  ) {
    return new ServerlessTransportError("DISPATCH_ACK_UNKNOWN");
  }
  if (
    operation === "status" &&
    ["RUNPOD_READ_AMBIGUOUS", "RUNPOD_READ_FAILED", "RUNPOD_READ_ABORTED"].includes(error.code)
  ) {
    return new ServerlessTransportError("STATUS_UNKNOWN");
  }
  if (
    operation === "cancel" &&
    [
      "RUNPOD_MUTATION_AMBIGUOUS",
      "RUNPOD_READ_AMBIGUOUS",
      "RUNPOD_READ_FAILED",
      "RUNPOD_READ_ABORTED",
      "RUNPOD_CANCEL_UNCONFIRMED",
    ].includes(error.code)
  ) {
    return new ServerlessTransportError("CANCEL_UNKNOWN");
  }
  if (error.code === "RUNPOD_JOB_ID_INVALID" || error.code === "RUNPOD_JOB_ID_MISMATCH") {
    return new ServerlessTransportError("PROVIDER_JOB_UNKNOWN");
  }
  return new ServerlessTransportError("REQUEST_REJECTED");
}

/**
 * Ordinary Serverless transport adapter. It receives an already configured client, so this module
 * never reads credentials or creates provider authority. Endpoint identity is checked before the
 * client can make a request.
 */
export class RunPodServerlessTransport implements ServerlessTransportPort {
  constructor(
    private readonly client: RunPodServerlessJobPort,
    private readonly endpointIdSha256: string,
  ) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(endpointIdSha256)) {
      throw new TypeError("RunPod transport requires an exact endpoint identity hash.");
    }
  }

  async run(request: ServerlessRunRequest): Promise<Readonly<{ id: string }>> {
    if (request.endpointIdSha256 !== this.endpointIdSha256) {
      throw new ServerlessTransportError("REQUEST_REJECTED");
    }
    try {
      const result = await this.client.dispatch(
        request.dispatchToken,
        request.envelope as JsonValue,
      );
      return Object.freeze({ id: snapshot(result).id });
    } catch (error) {
      if (error instanceof ServerlessTransportError) throw error;
      throw mapRunPodError(error, "run");
    }
  }

  async status(providerJobId: string): Promise<ServerlessJobSnapshot> {
    try {
      const result = await this.client.status(providerJobId);
      const observed = snapshot(result);
      if (observed.id !== providerJobId) {
        throw new ServerlessTransportError("PROVIDER_JOB_UNKNOWN");
      }
      return observed;
    } catch (error) {
      if (error instanceof ServerlessTransportError) throw error;
      throw mapRunPodError(error, "status");
    }
  }

  async cancel(providerJobId: string): Promise<ServerlessJobSnapshot> {
    try {
      const result = await this.client.cancel(providerJobId);
      const observed = snapshot(result);
      if (observed.id !== providerJobId) {
        throw new ServerlessTransportError("PROVIDER_JOB_UNKNOWN");
      }
      return observed;
    } catch (error) {
      if (error instanceof ServerlessTransportError) throw error;
      throw mapRunPodError(error, "cancel");
    }
  }
}
