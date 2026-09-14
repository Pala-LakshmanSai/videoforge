import {
  ServerlessTransportError,
  type ServerlessJobSnapshot,
  type ServerlessTransportPort,
  type Sha256,
} from "@videoforge/control-plane";
import { sha256CanonicalJson } from "@videoforge/contracts";

export type ImageRegenerationState =
  | "PREPARED"
  | "SENT"
  | "ASSIGNED"
  | "DISPATCH_ACK_UNKNOWN"
  | "REQUEST_REJECTED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface HostedImageRegenerationRequest {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly sceneId: string;
  readonly editedPrompt: string;
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly requestBody: Readonly<Record<string, unknown>>;
  readonly endpointIdSha256: Sha256;
  readonly dispatchToken: string;
  readonly requestBodySha256?: Sha256;
  readonly envelopeSha256?: Sha256;
}

export interface HostedImageRegenerationClaim {
  readonly state: ImageRegenerationState;
  readonly requestId: string;
  readonly sceneId: string;
  readonly dispatchToken: string;
  readonly endpointIdSha256: Sha256;
  readonly requestBodySha256: Sha256;
  readonly envelopeSha256: Sha256;
  readonly providerJobId: string | null;
}

export interface HostedImageRegenerationStore {
  /** Load or durably create the byte-identical request. Must be idempotent. */
  prepare(input: HostedImageRegenerationRequest): Promise<HostedImageRegenerationClaim>;
  /** CAS PREPARED -> SENT. A loser receives the current persisted claim. */
  beginSend(input: {
    readonly requestId: string;
    readonly expectedRequestBodySha256: Sha256;
    readonly expectedEnvelopeSha256: Sha256;
  }): Promise<{ readonly claim: HostedImageRegenerationClaim; readonly acquired: boolean }>;
  finishSend(input: {
    readonly requestId: string;
    readonly state: "ASSIGNED" | "REQUEST_REJECTED" | "DISPATCH_ACK_UNKNOWN";
    readonly providerJobId: string | null;
  }): Promise<HostedImageRegenerationClaim>;
  finishTerminal(input: {
    readonly requestId: string;
    readonly state: "COMPLETED" | "FAILED" | "CANCELLED";
  }): Promise<HostedImageRegenerationClaim>;
  /** Atomic replacement. Implementations must leave the old scene on rejection. */
  replaceAcceptedScene(input: {
    readonly requestId: string;
    readonly sceneId: string;
    readonly accepted: unknown;
  }): Promise<HostedImageRegenerationClaim>;
}

export interface HostedImageRegenerationAcceptance {
  /** Verify receipt, artifact, lineage, and request binding before returning a scene. */
  accept(input: {
    readonly request: HostedImageRegenerationRequest;
    readonly output: unknown;
    readonly providerJobId: string;
  }): Promise<unknown>;
}

export interface HostedImageRegenerationResult {
  readonly state: ImageRegenerationState;
  readonly requestId: string;
  readonly providerJobId: string | null;
  readonly replaced: boolean;
}

function hashMatches(actual: Sha256, expected: Sha256): boolean {
  return actual === expected;
}

/** Durable one-scene runtime. It never re-submits SENT or DISPATCH_ACK_UNKNOWN work. */
export class HostedImageRegenerationRuntime {
  constructor(
    private readonly store: HostedImageRegenerationStore,
    private readonly transport: ServerlessTransportPort,
    private readonly acceptance: HostedImageRegenerationAcceptance,
  ) {}

  async run(request: HostedImageRegenerationRequest): Promise<HostedImageRegenerationResult> {
    const actualBody = await sha256CanonicalJson(request.requestBody);
    const actualEnvelope = await sha256CanonicalJson(request.envelope);
    if (
      (request.requestBodySha256 && request.requestBodySha256 !== actualBody) ||
      (request.envelopeSha256 && request.envelopeSha256 !== actualEnvelope)
    )
      throw new Error("HOSTED_IMAGE_REGENERATION_REQUEST_HASH_MISMATCH");
    const expectedBody = actualBody;
    const expectedEnvelope = actualEnvelope;
    const prepared = await this.store.prepare(request);
    if (
      prepared.requestId !== request.requestId ||
      prepared.sceneId !== request.sceneId ||
      prepared.dispatchToken !== request.dispatchToken ||
      prepared.endpointIdSha256 !== request.endpointIdSha256
    )
      throw new Error("HOSTED_IMAGE_REGENERATION_CLAIM_MISMATCH");
    if (
      !hashMatches(prepared.requestBodySha256, expectedBody) ||
      !hashMatches(prepared.envelopeSha256, expectedEnvelope)
    ) {
      throw new Error("HOSTED_IMAGE_REGENERATION_REQUEST_HASH_MISMATCH");
    }

    let claim = prepared;
    if (claim.state === "PREPARED") {
      const begun = await this.store.beginSend({
        requestId: request.requestId,
        expectedRequestBodySha256: expectedBody,
        expectedEnvelopeSha256: expectedEnvelope,
      });
      claim = begun.claim;
      if (begun.acquired && claim.state === "SENT") {
        try {
          const response = await this.transport.run({
            endpointIdSha256: claim.endpointIdSha256,
            dispatchToken: claim.dispatchToken,
            requestBodySha256: claim.requestBodySha256,
            envelope: request.envelope,
            body: request.requestBody,
          });
          if (!response.id) throw new Error("HOSTED_IMAGE_REGENERATION_PROVIDER_JOB_INVALID");
          claim = await this.store.finishSend({
            requestId: request.requestId,
            state: "ASSIGNED",
            providerJobId: response.id,
          });
        } catch (error) {
          const state =
            error instanceof ServerlessTransportError && error.code === "REQUEST_REJECTED"
              ? "REQUEST_REJECTED"
              : "DISPATCH_ACK_UNKNOWN";
          claim = await this.store.finishSend({
            requestId: request.requestId,
            state,
            providerJobId: null,
          });
        }
      }
    }

    if (claim.state === "ASSIGNED" && claim.providerJobId) {
      claim = await this.observe(request, claim);
    }
    return {
      state: claim.state,
      requestId: claim.requestId,
      providerJobId: claim.providerJobId,
      replaced: claim.state === "COMPLETED",
    };
  }

  private async observe(
    request: HostedImageRegenerationRequest,
    claim: HostedImageRegenerationClaim,
  ): Promise<HostedImageRegenerationClaim> {
    const snapshot = await this.transport.status(claim.providerJobId!);
    if (snapshot.status === "COMPLETED") {
      if (snapshot.id !== claim.providerJobId)
        throw new Error("HOSTED_IMAGE_REGENERATION_PROVIDER_JOB_MISMATCH");
      let accepted: unknown;
      try {
        accepted = await this.acceptance.accept({
          request,
          output: snapshot.output,
          providerJobId: claim.providerJobId!,
        });
      } catch {
        return this.store.finishTerminal({ requestId: request.requestId, state: "FAILED" });
      }
      return this.store.replaceAcceptedScene({
        requestId: request.requestId,
        sceneId: request.sceneId,
        accepted,
      });
    }
    if (
      snapshot.status === "FAILED" ||
      snapshot.status === "CANCELLED" ||
      snapshot.status === "TIMED_OUT"
    ) {
      return this.store.finishTerminal({
        requestId: request.requestId,
        state: snapshot.status === "CANCELLED" ? "CANCELLED" : "FAILED",
      });
    }
    return claim;
  }
}

export type HostedImageRegenerationJobSnapshot = ServerlessJobSnapshot;
