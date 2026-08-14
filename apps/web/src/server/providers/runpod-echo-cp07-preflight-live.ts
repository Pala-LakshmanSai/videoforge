import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { RunPodControlClient } from "./runpod-control";
import {
  fetchCp07Catalog,
  runCp07ReadOnlyPreflight,
  type Cp07Inventory,
} from "./runpod-echo-cp07-preflight";

const apiKey = await loadSujalRunPodApiKeyFromKeychain();
const client = new RunPodControlClient({ apiKey });
const result = await runCp07ReadOnlyPreflight({
  apiKey,
  assertAccount: (key) => assertSujalRunPodAccount(key),
  inventory: async () => (await client.inventory()) as Cp07Inventory,
  fetchCatalog: () => fetchCp07Catalog(apiKey),
  checkedAt: new Date().toISOString(),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
