import { loadRunPodApiKeyFromKeychain } from "./keychain";
import { RunPodControlClient } from "./runpod-control";

const apiKey = await loadRunPodApiKeyFromKeychain();
const inventory = await new RunPodControlClient({ apiKey }).inventory();
process.stdout.write(
  `${JSON.stringify({ schemaVersion: "videoforge.runpod-live-inventory/v1", ...inventory })}\n`,
);
