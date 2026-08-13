import type { VNextPodDispatchReceipt } from "./production-dispatch.js";
import { VNextPodDispatchFirewall } from "./production-dispatch.js";

export interface VNextProductionDispatch {
  dispatch(candidate: unknown): Promise<VNextPodDispatchReceipt>;
}

export class VNextProductionDispatchDisabledError extends Error {
  readonly code = "VNEXT_PRODUCTION_DISPATCH_DISABLED" as const;

  constructor() {
    super("vNext paid Pod dispatch has no authorized production provider port.");
    this.name = "VNextProductionDispatchDisabledError";
  }
}

class DisabledVNextPodDispatchPort {
  async dispatch(): Promise<VNextPodDispatchReceipt> {
    throw new VNextProductionDispatchDisabledError();
  }
}

export function createVNextProductionDispatch(): VNextProductionDispatch {
  const firewall = new VNextPodDispatchFirewall(new DisabledVNextPodDispatchPort());
  return Object.freeze({
    dispatch(candidate: unknown) {
      return firewall.dispatch(candidate);
    },
  });
}
