import type { HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import type { ContinuationScope } from "./stage-continuation";
import { continuationRequest } from "./stage-continuation";

/** Starts the existing admitted generation path once the prompt set is durably accepted. */
export async function dispatchAcceptedHostedPrompts(
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  scope: ContinuationScope,
  projectId: string,
): Promise<void> {
  const dispatched = await dispatchHostedProject(
    projectId, scope, environment, config, executionContext,
  );
  if (!dispatched?.ok)
    throw new Error(`stage6_dispatch_status=${dispatched?.status ?? "no-response"}`);
}

export async function dispatchHostedProject(
  projectId: string,
  scope: ContinuationScope,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response | null> {
  const [{ createHostedV209SpanAudioLiveCoordinator }, dispatchModule] = await Promise.all([
    import("./app"),
    import("./hosted-v209-project-dispatch"),
  ]);
  const spanAudio = await createHostedV209SpanAudioLiveCoordinator(environment, config);
  return dispatchModule.handleHostedV209ProjectDispatch(
    continuationRequest(config, `/api/v2/hosted/projects/${projectId}/gpu-dispatch`, {}),
    environment,
    config,
    executionContext,
    { ...dispatchModule.defaults, scope: async () => scope },
    spanAudio,
  );
}
