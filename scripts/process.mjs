import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function commandOutput(command, args = []) {
  try {
    const { stdout } = await execFileAsync(command, args, { encoding: "utf8" });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function listeningProcess(port) {
  const output = await commandOutput("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpcn"]);
  return parseListeningProcess(output);
}

export function parseListeningProcess(output) {
  if (!output) return null;
  const pid = output.match(/^p(\d+)$/m)?.[1] ?? null;
  const command = output.match(/^c(.+)$/m)?.[1] ?? "unknown";
  const address = output.match(/^n(.+)$/m)?.[1] ?? null;
  return pid ? { pid: Number(pid), command, address } : null;
}

export async function health(url = "http://localhost:4173/api/health") {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function run(command, args, options = {}) {
  return spawn(command, args, { stdio: "inherit", ...options });
}
