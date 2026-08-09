import { commandOutput, health, listeningProcess, run } from "./process.mjs";

const url = "http://localhost:4173";
const apiPort = 4174;
const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
const requestedMode = modeArgument?.slice("--mode=".length) ?? "fixture";
if (!new Set(["fixture", "local"]).has(requestedMode)) {
  console.error("VideoForge development mode must be 'fixture' or 'local'.");
  process.exit(1);
}
const existing = await health();

if (existing?.app === "videoforge" && existing?.mode === requestedMode) {
  const detail = requestedMode === "fixture" ? `fixture ${existing.fixture_id}` : "local media";
  console.log(`VideoForge already healthy at ${url} (${detail}).`);
  process.exit(0);
}

if (existing?.app === "videoforge") {
  console.error(
    `VideoForge is already healthy at ${url} in ${existing.mode} mode. ` +
      `Stop that owned process explicitly before switching to ${requestedMode} mode.`,
  );
  process.exit(1);
}

for (const port of [4173, apiPort]) {
  const owner = await listeningProcess(port);
  if (owner) {
    console.error(
      `Cannot start VideoForge: port ${port} is owned by PID ${owner.pid} (${owner.command}). ` +
        "Stop that process explicitly or restore the owned VideoForge server; no alternate port will be chosen.",
    );
    process.exit(1);
  }
}

const commit = (await commandOutput("git", ["rev-parse", "--short", "HEAD"])) ?? "uncommitted";
const child = run("pnpm", ["--filter", "@videoforge/web", "dev:raw"], {
  env: {
    ...process.env,
    VIDEOFORGE_COMMIT: commit,
    VIDEOFORGE_PROVIDER_MODE: requestedMode,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
