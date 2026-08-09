import { spawnSync } from "node:child_process";

const commands = [
  [process.execPath, ["scripts/local-doctor.mjs"]],
  ["pnpm", ["--filter", "@videoforge/contracts", "test"]],
  ["pnpm", ["--filter", "@videoforge/pipeline", "test"]],
  ["pnpm", ["--filter", "@videoforge/test-fixtures", "test"]],
  ["pnpm", ["test:workers"]],
  ["pnpm", ["--filter", "@videoforge/web", "typecheck"]],
  ["pnpm", ["--filter", "@videoforge/web", "exec", "tsx", "src/server/local/run-local-slice.ts"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
