import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { commandOutput } from "./process.mjs";

export const developmentOwnershipSchema = "videoforge.dev-ownership/v1";
export const developmentOwnershipPath = path.resolve(".videoforge/dev-server.json");

export async function writeDevelopmentOwnership(state, statePath = developmentOwnershipPath) {
  const document = { schemaVersion: developmentOwnershipSchema, ...state };
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, statePath);
  return document;
}

export async function readDevelopmentOwnership(statePath = developmentOwnershipPath) {
  try {
    const document = JSON.parse(await readFile(statePath, "utf8"));
    return document && typeof document === "object" ? document : null;
  } catch {
    return null;
  }
}

export async function removeDevelopmentOwnership(
  expectedSupervisorPid,
  statePath = developmentOwnershipPath,
) {
  const current = await readDevelopmentOwnership(statePath);
  if (current && current.supervisorPid !== expectedSupervisorPid) return false;
  try {
    await unlink(statePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return true;
}

export function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function processCommand(pid) {
  return commandOutput("ps", ["-o", "command=", "-p", String(pid)]);
}

export async function isDescendantProcess(pid, ancestorPid) {
  let current = pid;
  for (let depth = 0; depth < 32 && Number.isSafeInteger(current) && current > 1; depth += 1) {
    if (current === ancestorPid) return true;
    const parent = await commandOutput("ps", ["-o", "ppid=", "-p", String(current)]);
    current = Number.parseInt(parent ?? "", 10);
  }
  return false;
}

export function developmentOwnershipFailures(snapshot) {
  const {
    state,
    supervisorAlive,
    supervisorCommand,
    webOwner,
    apiOwner,
    webOwned,
    apiOwned,
    webHealth,
    apiHealth,
  } = snapshot;
  const failures = [];

  if (state?.schemaVersion !== developmentOwnershipSchema)
    failures.push("ownership schema mismatch");
  if (state?.repositoryRoot !== process.cwd()) failures.push("repository root mismatch");
  if (!Number.isSafeInteger(state?.supervisorPid) || state.supervisorPid <= 1) {
    failures.push("invalid supervisor PID");
  }
  if (!supervisorAlive) failures.push("recorded supervisor is not running");
  if (!supervisorCommand?.includes("scripts/dev.mjs")) {
    failures.push("recorded supervisor command is not VideoForge dev");
  }
  if (!webOwner || !apiOwner) failures.push("strict port pair is incomplete");
  if (webOwner && !webOwned)
    failures.push("port 4173 listener is outside the recorded process tree");
  if (apiOwner && !apiOwned)
    failures.push("port 4174 listener is outside the recorded process tree");

  for (const [label, health] of [
    ["web", webHealth],
    ["api", apiHealth],
  ]) {
    if (
      health?.app !== "videoforge" ||
      health?.status !== "ok" ||
      health?.commit !== state?.commit ||
      health?.mode !== state?.mode ||
      health?.provider_calls_authorized !== false ||
      health?.authorized_spend_usd !== 0
    ) {
      failures.push(`${label} health does not match recorded provider-free identity`);
    }
  }

  return failures;
}
