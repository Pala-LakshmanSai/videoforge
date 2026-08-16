import type { FairAdmissionSnapshotItem, FixtureTenantScope } from "./shared-app-fixture";

export interface ApplicationFairAdmission {
  reset(): Promise<void>;
  enqueueVideo(input: {
    readonly tenant: FixtureTenantScope;
    readonly actorEmail: string;
    readonly publicProjectId: string;
    readonly title: string;
  }): Promise<{
    readonly requestId: string;
    readonly state: FairAdmissionSnapshotItem["state"];
    readonly version: number;
    readonly snapshot: readonly FairAdmissionSnapshotItem[];
  }>;
  listOwned(tenant: FixtureTenantScope): Promise<readonly FairAdmissionSnapshotItem[]>;
  reorderOwned(input: {
    readonly tenant: FixtureTenantScope;
    readonly actorEmail: string;
    readonly requestId: string;
    readonly expectedVersion: number;
    readonly toPosition: number;
  }): Promise<readonly FairAdmissionSnapshotItem[]>;
  cancelOwned(input: {
    readonly tenant: FixtureTenantScope;
    readonly actorEmail: string;
    readonly requestId: string;
    readonly expectedVersion: number;
  }): Promise<readonly FairAdmissionSnapshotItem[]>;
}
