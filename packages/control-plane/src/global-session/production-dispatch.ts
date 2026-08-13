import { assertContract, type ContractDocument } from "@videoforge/contracts";

export type VNextPodDispatchEnvelope = ContractDocument<"podWorkerJobEnvelope">;

export interface VNextPodDispatchReceipt {
  readonly dispatchId: string;
  readonly acceptedAt: string;
}

export interface VNextPodDispatchPort {
  dispatch(envelope: VNextPodDispatchEnvelope): Promise<VNextPodDispatchReceipt>;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export class VNextPodDispatchFirewall {
  constructor(private readonly port: VNextPodDispatchPort) {}

  async dispatch(candidate: unknown): Promise<VNextPodDispatchReceipt> {
    const envelope = assertContract("podWorkerJobEnvelope", structuredClone(candidate));
    return this.port.dispatch(deepFreeze(envelope));
  }
}
