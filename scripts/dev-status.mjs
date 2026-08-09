import { health, listeningProcess } from "./process.mjs";

const url = "http://localhost:4173";
const owner = await listeningProcess(4173);
const status = await health();

if (!owner || !status) {
  console.error(`VideoForge is stopped or unhealthy at ${url}.`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      url,
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
