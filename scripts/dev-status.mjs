import { networkInterfaces } from "node:os";

import { health, listeningProcess } from "./process.mjs";

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

if (!owner || !status) {
  console.error(`VideoForge is stopped or unhealthy at ${url}.`);
  process.exit(1);
}

const lanAddress = localNetworkAddress();

console.log(
  JSON.stringify(
    {
      url,
      lanUrl: lanAddress ? `http://${lanAddress}:4173` : null,
      pid: owner.pid,
      process: owner.command,
      mode: status.mode,
      commit: status.commit,
      health: status.status,
      fixture: status.fixture_id,
      synthetic: status.synthetic,
    },
    null,
    2,
  ),
);
