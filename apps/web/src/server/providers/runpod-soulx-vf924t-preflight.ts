import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { RunPodControlClient } from "./runpod-control";
import { fetchCp07Catalog } from "./runpod-echo-cp07-preflight";

const ACCOUNT_HASH = "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const MAGE_VOLUME_HASH = "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const SOULX_VOLUME_HASH = "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";

const apiKey = await loadSujalRunPodApiKeyFromKeychain();
const account = await assertSujalRunPodAccount(apiKey);
if (account.accountIdHash !== ACCOUNT_HASH) throw new Error("VF924T_ACCOUNT_MISMATCH");
const [inventory, catalog] = await Promise.all([
  new RunPodControlClient({ apiKey }).inventory(),
  fetchCp07Catalog(apiKey),
]);
const rtx4090 = catalog.find((candidate) => candidate.offeringId === "NVIDIA GeForce RTX 4090");
if (
  inventory.pods.length !== 0 ||
  inventory.endpoints.length !== 0 ||
  inventory.privateTemplateCount !== 0 ||
  inventory.runningPodCount !== 0 ||
  inventory.activeServerlessWorkerCount !== 0 ||
  inventory.networkVolumes.length !== 2 ||
  !inventory.networkVolumes.some(
    (volume) => volume.idHash === MAGE_VOLUME_HASH && volume.sizeGb === 50,
  ) ||
  !inventory.networkVolumes.some(
    (volume) => volume.idHash === SOULX_VOLUME_HASH && volume.sizeGb === 50,
  ) ||
  rtx4090?.region !== "EU-RO-1" ||
  rtx4090.rateUsdPerHour !== 0.74 ||
  rtx4090.vramGb !== 24
) {
  throw new Error("VF924T_READ_ONLY_PREFLIGHT_MISMATCH");
}

process.stdout.write(
  `${JSON.stringify({
    schema_version: "videoforge.soulx-flashhead-pro-vf924t-read-only-preflight/v1",
    checked_at: inventory.checkedAt,
    external_spend_usd: 0,
    provider_mutations: 0,
    account: { owner: "sujal", account_id_sha256: account.accountIdHash },
    inventory: {
      pods: 0,
      endpoints: 0,
      private_templates: 0,
      active_serverless_workers: 0,
      network_volumes: inventory.networkVolumes,
    },
    selected_gpu: rtx4090,
    retained_volume: {
      id_sha256: SOULX_VOLUME_HASH,
      size_gb: 50,
      recurring_usd_per_month: 3.5,
    },
    immutable_image_digest:
      "ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s@sha256:0538d16199f04cac0a68ad4570b3fc260470b079200da025fe8f36640fb69a9b",
    reservation: {
      runtime_ready_timeout_seconds: 1800,
      generation_timeout_seconds: 1200,
      lifecycle_reserve_seconds: 120,
      conservative_maximum_pod_cost_usd: 0.641334,
    },
  })}\n`,
);
