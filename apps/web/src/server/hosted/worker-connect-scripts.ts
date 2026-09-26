import macos from "./worker-connect.sh?raw";
import windows from "./worker-connect.ps1?raw";
import type { HostedRuntimeConfiguration } from "./configuration";

export function workerConnectScript(
  config: HostedRuntimeConfiguration,
  token: string,
  platform: "WINDOWS" | "MACOS",
): string {
  const file =
    platform === "MACOS" ? config.mediaWorkerRelease.macos : config.mediaWorkerRelease.windows;
  const substitutions = {
    TOKEN: token,
    URL: file.url,
    HASH: file.sha256.slice(7),
    SIZE: String(file.sizeBytes),
    VERSION: config.mediaWorkerRelease.version,
  };
  // Values come from the validated immutable release. Reject shell metacharacters even
  // if a future configuration validator broadens its URL or version grammar.
  for (const value of Object.values(substitutions)) {
    if (!/^[A-Za-z0-9:/._+-]+$/u.test(value)) throw new Error("Worker installer value rejected");
  }
  return (platform === "MACOS" ? macos : windows).replace(
    /@@(TOKEN|URL|HASH|SIZE|VERSION)@@/gu,
    (_, key: keyof typeof substitutions) => substitutions[key],
  );
}
