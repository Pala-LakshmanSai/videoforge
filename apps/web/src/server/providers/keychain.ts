import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function loadRunwareApiKeyFromKeychain(): Promise<string> {
  try {
    const result = await execFileAsync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-w",
        "-s",
        "com.videoforge.runware.qualification",
        "-a",
        "videoforge",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 },
    );
    const key = result.stdout.trim();
    if (key.length < 20 || /\s/u.test(key)) throw new Error("invalid");
    return key;
  } catch {
    throw new Error("RUNWARE_KEYCHAIN_CREDENTIAL_UNAVAILABLE");
  }
}

export const SUJAL_RUNPOD_ACCOUNT_ID_SHA256 =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c" as const;

export async function loadSujalRunPodApiKeyFromKeychain(): Promise<string> {
  try {
    const result = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", "com.videoforge.runpod.lifecycle", "-a", "videoforge"],
      { encoding: "utf8", maxBuffer: 16 * 1024 },
    );
    const key = result.stdout.trim();
    if (key.length < 20 || /\s/u.test(key)) throw new Error("invalid");
    return key;
  } catch {
    throw new Error("SUJAL_RUNPOD_KEYCHAIN_CREDENTIAL_UNAVAILABLE");
  }
}
