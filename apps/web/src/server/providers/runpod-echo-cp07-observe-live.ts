import { createHash } from "node:crypto";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { RunPodControlClient } from "./runpod-control";

const apiKey = await loadSujalRunPodApiKeyFromKeychain();
const inventory = await new RunPodControlClient({ apiKey }).inventory();
const podResponse = await fetch(
  "https://rest.runpod.io/v1/pods?includeMachine=false&includeNetworkVolume=false&includeTemplate=false&includeWorkers=false",
  { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) },
);
const pods = podResponse.ok ? ((await podResponse.json()) as unknown[]) : [];
const volumeResponse = await fetch("https://rest.runpod.io/v1/networkvolumes", {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(30_000),
});
const volumes = volumeResponse.ok ? ((await volumeResponse.json()) as unknown[]) : [];
const health = await Promise.all(
  pods.flatMap((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { id?: unknown }).id !== "string"
    ) {
      return [];
    }
    const id = (candidate as { id: string }).id;
    return [
      fetch(`https://${id}-8000.proxy.runpod.net/health`, {
        signal: AbortSignal.timeout(10_000),
      })
        .then(async (response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ];
  }),
);
process.stdout.write(
  `${JSON.stringify({
    checked_at: inventory.checkedAt,
    pods: inventory.pods.length,
    running_pods: inventory.runningPodCount,
    pod_states: inventory.pods.map((pod) => ({
      desired_status: pod.desiredStatus,
      endpoint_worker: pod.endpointWorker,
      cost_per_hour_usd: pod.costPerHourUsd,
    })),
    private_templates: inventory.privateTemplateCount,
    network_volumes: inventory.networkVolumes.length,
    volume_identities: volumes.flatMap((candidate) => {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof (candidate as { id?: unknown }).id !== "string" ||
        typeof (candidate as { name?: unknown }).name !== "string" ||
        typeof (candidate as { size?: unknown }).size !== "number"
      ) {
        return [];
      }
      const volume = candidate as { id: string; name: string; size: number };
      return [
        {
          name: volume.name,
          id_sha256: `sha256:${createHash("sha256").update(volume.id).digest("hex")}`,
          size_gb: volume.size,
        },
      ];
    }),
    endpoints: inventory.endpoints.length,
    active_serverless_workers: inventory.activeServerlessWorkerCount,
    health: health.map((candidate) => {
      const value = candidate as {
        phase?: unknown;
        error_code?: unknown;
        uptime_ms?: unknown;
      } | null;
      return value === null
        ? null
        : {
            phase: value.phase,
            error_code: value.error_code,
            uptime_ms: value.uptime_ms,
          };
    }),
  })}\n`,
);
