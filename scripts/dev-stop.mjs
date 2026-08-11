import { setTimeout as delay } from "node:timers/promises";

import {
  developmentOwnershipFailures,
  developmentOwnershipPath,
  isDescendantProcess,
  processCommand,
  processExists,
  readDevelopmentOwnership,
  removeDevelopmentOwnership,
} from "./dev-ownership.mjs";
import { health, listeningProcess } from "./process.mjs";

const state = await readDevelopmentOwnership();
const initialWebOwner = await listeningProcess(4173);
const initialApiOwner = await listeningProcess(4174);

if (!state) {
  if (!initialWebOwner && !initialApiOwner) {
    console.log("VideoForge development server is already stopped.");
    process.exit(0);
  }
  console.error(
    "Refusing to stop listeners without a VideoForge ownership record. Inspect pnpm dev:status and stop the foreign process explicitly.",
  );
  process.exit(1);
}

if (!processExists(state.supervisorPid) && !initialWebOwner && !initialApiOwner) {
  console.error(
    `Refusing stale VideoForge ownership record at ${developmentOwnershipPath}. Inspect it, then remove it explicitly if recovery is safe.`,
  );
  process.exit(1);
}

const snapshot = {
  state,
  supervisorAlive: processExists(state.supervisorPid),
  supervisorCommand: await processCommand(state.supervisorPid),
  webOwner: initialWebOwner,
  apiOwner: initialApiOwner,
  webOwned: initialWebOwner
    ? await isDescendantProcess(initialWebOwner.pid, state.supervisorPid)
    : false,
  apiOwned: initialApiOwner
    ? await isDescendantProcess(initialApiOwner.pid, state.supervisorPid)
    : false,
  webHealth: await health(),
  apiHealth: await health("http://127.0.0.1:4174/api/health"),
};
const failures = developmentOwnershipFailures(snapshot);
if (failures.length > 0) {
  console.error(`Refusing to stop unverified development ownership:\n- ${failures.join("\n- ")}`);
  console.error(`Ownership record left at ${developmentOwnershipPath} for inspection.`);
  process.exit(1);
}

process.kill(state.supervisorPid, "SIGTERM");

for (let attempt = 0; attempt < 50; attempt += 1) {
  const [webOwner, apiOwner] = await Promise.all([listeningProcess(4173), listeningProcess(4174)]);
  if (!processExists(state.supervisorPid) && !webOwner && !apiOwner) {
    await removeDevelopmentOwnership(state.supervisorPid);
    console.log(`Stopped owned VideoForge development server PID ${state.supervisorPid}.`);
    process.exit(0);
  }
  await delay(100);
}

console.error(
  "Owned VideoForge supervisor did not release both strict ports within 5 seconds; no force-kill was attempted.",
);
process.exit(1);
