import type { FixtureTenantScope } from "./shared-app-fixture";

/**
 * The application's view of one admitted video's durable runtime.
 *
 * Every field is a factual private observation of the V2-05 control plane. The application never
 * invents a stage, a worker, or a cost: an absent runtime simply has no state to show.
 */
export type ApplicationVideoStage =
  | "QUEUED"
  | "PREPARING"
  | "WAITING_FOR_WORKER"
  | "INITIALIZING"
  | "GENERATING_IMAGES"
  | "GENERATING_AVATAR"
  | "RENDERING"
  | "COMPLETE"
  | "FAILED"
  | "CANCELED";

export interface ApplicationVideoLaneState {
  readonly lane: "mage_image" | "soulx_avatar";
  readonly state: string;
  readonly plannedItemCount: number;
  readonly acceptedItemCount: number;
  readonly attemptOrdinal: number;
}

export interface ApplicationVideoState {
  readonly publicProjectId: string;
  readonly stage: ApplicationVideoStage;
  readonly terminalReason: string | null;
  readonly lanes: readonly ApplicationVideoLaneState[];
  readonly finalOutputSha256: string | null;
  readonly providerCallsAuthorized: false;
  readonly authorizedSpendUsd: 0;
  readonly settledCostUsd: 0;
}

/**
 * The Node-only V2-05 runtime is injected through this port so the shared application never imports
 * a Node database driver, and so a runtime-free deployment simply exposes no video stage truth.
 */
export interface ApplicationVideoRuntime {
  register(tenant: FixtureTenantScope, publicProjectId: string): Promise<void>;
  advance(tenant: FixtureTenantScope, publicProjectId: string): Promise<ApplicationVideoState>;
  cancel(tenant: FixtureTenantScope, publicProjectId: string): Promise<ApplicationVideoState>;
  /**
   * The durable state of each named owned video. A video with no durable runtime row is simply
   * absent from the result rather than reported with an invented stage.
   */
  listOwned(
    tenant: FixtureTenantScope,
    publicProjectIds: readonly string[],
  ): Promise<readonly ApplicationVideoState[]>;
  drainProof(): Promise<{
    readonly liveAttempts: number;
    readonly acceptedJobs: number;
    readonly settledCostUsd: 0;
  }>;
}
