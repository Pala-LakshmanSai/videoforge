import { closeSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  readV213V212RealChromeRequest,
  runV213V212RealChromeJourney,
  V213_V212_REAL_CHROME_CHILD_SIGNING_KEY_FD,
  V213V212RealChromeError,
} from "./v213-v212-real-chrome.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const requestPath = argument("--request");
  const productionOrigin = argument("--origin");
  const authStatePath = argument("--auth-state");
  if (!requestPath || !productionOrigin || !authStatePath)
    throw new V213V212RealChromeError("V213_V212_REAL_CHROME_ARGUMENTS_INVALID");
  // Validate the request before opening Chrome. The child receives no worker bearer, database URL,
  // provider key, or other credential; the signing key is read only from inherited fd 3.
  readV213V212RealChromeRequest(requestPath);
  const receipt = await runV213V212RealChromeJourney({
    requestPath,
    productionOrigin,
    authStatePath,
    evidenceSigningKeyFd: V213_V212_REAL_CHROME_CHILD_SIGNING_KEY_FD,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (error instanceof V213V212RealChromeError) process.stderr.write(`${error.code}\n`);
    else process.stderr.write("V213_V212_REAL_CHROME_JOURNEY_FAILED\n");
    process.exitCode = 1;
  } finally {
    try {
      closeSync(V213_V212_REAL_CHROME_CHILD_SIGNING_KEY_FD);
    } catch {
      // The descriptor may already be closed by Node after the inherited pipe reaches EOF.
    }
  }
}

export { main as runV213V212RealChromeMain };
