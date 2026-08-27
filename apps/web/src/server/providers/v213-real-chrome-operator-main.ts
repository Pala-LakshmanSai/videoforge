import { closeSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  V213_V209_CHROME_AUTH_STATE_ENV,
  V213_V209_CHROME_EXCHANGE_DIRECTORY_ENV,
  V213_V209_CHROME_KEY_FD,
  V213_V209_CHROME_ORIGIN_ENV,
  V213_V209_CHROME_REQUEST_ENV,
  V213V209ChromeOperatorError,
  runV213ReleaseRealChromeJourney,
  runV213V209RealChromeOperator,
} from "./v213-real-chrome-operator.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const releaseRequestPath = argument("--release-request");
  const requestPath = argument("--request") ?? process.env[V213_V209_CHROME_REQUEST_ENV];
  const exchangeDirectory =
    argument("--exchange") ?? process.env[V213_V209_CHROME_EXCHANGE_DIRECTORY_ENV];
  const productionOrigin = argument("--origin") ?? process.env[V213_V209_CHROME_ORIGIN_ENV];
  const authStatePath = argument("--auth-state") ?? process.env[V213_V209_CHROME_AUTH_STATE_ENV];
  if (releaseRequestPath && productionOrigin && authStatePath) {
    const receipt = await runV213ReleaseRealChromeJourney({
      requestPath: releaseRequestPath,
      productionOrigin,
      authStatePath,
      evidenceSigningKeyFd: V213_V209_CHROME_KEY_FD,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (!requestPath || !exchangeDirectory || !productionOrigin || !authStatePath)
    throw new V213V209ChromeOperatorError("V209_CHROME_OPERATOR_ARGUMENTS_INVALID");

  // The acceptance key is deliberately read from the inherited pipe only. It is never accepted
  // as a command-line argument or environment variable, and the child has no stdout/stderr path
  // that could accidentally print it.
  const result = await runV213V209RealChromeOperator({
    requestPath,
    exchangeDirectory,
    productionOrigin,
    authStatePath,
    evidenceSigningKeyFd: V213_V209_CHROME_KEY_FD,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    if (error instanceof V213V209ChromeOperatorError) {
      process.stderr.write(`${error.code}\n`);
    } else {
      process.stderr.write("V209_CHROME_OPERATOR_FAILED\n");
    }
    process.exitCode = 1;
  } finally {
    // The inherited key pipe is closed by the parent after writing. Reading it to EOF is the
    // helper's only secret operation; this close is defensive for nonstandard fd providers.
    try {
      closeSync(V213_V209_CHROME_KEY_FD);
    } catch {
      // The descriptor may already be closed by the runtime.
    }
  }
}

export { main as runV213V209RealChromeOperatorMain };
