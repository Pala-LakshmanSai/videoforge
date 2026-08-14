import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { RunPodControlClient } from "./runpod-control";

const apiKey = await loadSujalRunPodApiKeyFromKeychain();
const account = await assertSujalRunPodAccount(apiKey);
const inventory = await new RunPodControlClient({ apiKey }).inventory();
process.stdout.write(
  `${JSON.stringify({ schemaVersion: "videoforge.runpod-live-inventory/v2", ...account, ...inventory })}\n`,
);
