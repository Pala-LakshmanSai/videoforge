import { networkInterfaces } from "node:os";

import { isLanListenerAddress } from "./dev-policy.mjs";
import { commandOutput, health, listeningProcess } from "./process.mjs";

const url = "http://localhost:4173";
const owner = await listeningProcess(4173);
const status = await health();

function localNetworkAddress() {
  const interfaces = networkInterfaces();
  const names = [...["en0", "en1"], ...Object.keys(interfaces)];
  for (const name of names) {
    for (const address of interfaces[name] ?? []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        (/^10\./u.test(address.address) ||
          /^192\.168\./u.test(address.address) ||
          /^172\.(1[6-9]|2\d|3[01])\./u.test(address.address))
      ) {
        return address.address;
      }
    }
  }
  return null;
}

if (!owner || !status || status.app !== "videoforge") {
  console.error(`VideoForge is stopped or unhealthy at ${url}.`);
  process.exit(1);
}

const headCommit = await commandOutput("git", ["rev-parse", "--short", "HEAD"]);
const workingTree = await commandOutput("git", ["status", "--porcelain"]);
const workingTreeDirty = workingTree === null ? null : workingTree.length > 0;
const healthCommit = typeof status.commit === "string" ? status.commit : null;
const commitMatchesHead = Boolean(headCommit && healthCommit === headCommit);
const lanExposed = isLanListenerAddress(owner.address);
const lanAddress = lanExposed && status.mode === "fixture" ? localNetworkAddress() : null;
const warnings = [];

if (!commitMatchesHead) {
  warnings.push("Health commit does not match the current HEAD; restart the owned server.");
}
if (workingTreeDirty === true) {
  warnings.push(
    "The working tree is dirty; a matching HEAD cannot prove that the served source is current.",
  );
}
if (workingTreeDirty === null) {
  warnings.push("Git working-tree state could not be determined.");
}
if (status.provider_calls_authorized !== false || status.authorized_spend_usd !== 0) {
  warnings.push(
    "Health does not prove provider calls are disabled with an authorized spend of $0.",
  );
  process.exitCode = 1;
}
if (["local", "sandbox"].includes(status.mode) && lanExposed) {
  warnings.push(
    "Local/sandbox media mode is exposed on LAN; restart it on loopback before continuing.",
  );
  process.exitCode = 1;
}

console.log(
  JSON.stringify(
    {
      url,
      lanUrl: lanAddress ? `http://${lanAddress}:4173` : null,
      binding: lanExposed ? "lan" : "loopback",
      listener: owner.address,
      pid: owner.pid,
      process: owner.command,
      mode: status.mode,
      commit: healthCommit,
      healthCommit,
      headCommit,
      commitMatchesHead,
      workingTreeDirty,
      health: status.status,
      fixture: status.fixture_id,
      synthetic: status.synthetic,
      providerCallsAuthorized: status.provider_calls_authorized,
      authorizedSpendUsd: status.authorized_spend_usd,
      warnings,
    },
    null,
    2,
  ),
);
