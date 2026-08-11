import { spawnSync } from "node:child_process";

import { removeDevelopmentOwnership, writeDevelopmentOwnership } from "./dev-ownership.mjs";
import {
  assertProviderFreeEnvironment,
  isLanListenerAddress,
  sanitizedDevelopmentEnvironment,
} from "./dev-policy.mjs";
import { commandOutput, health, listeningProcess, run } from "./process.mjs";

const url = "http://localhost:4173";
const apiPort = 4174;
const arguments_ = process.argv.slice(2);
const modeArguments = arguments_.filter((argument) => argument.startsWith("--mode="));
const unknownArguments = arguments_.filter(
  (argument) => argument !== "--lan" && !argument.startsWith("--mode="),
);
if (modeArguments.length > 1 || unknownArguments.length > 0) {
  console.error("Usage: pnpm dev [--lan] [--mode=fixture|local]");
  process.exit(1);
}

const modeArgument = modeArguments[0];
const requestedMode = modeArgument?.slice("--mode=".length) ?? "fixture";
if (!new Set(["fixture", "local"]).has(requestedMode)) {
  console.error("VideoForge development mode must be 'fixture' or 'local'.");
  process.exit(1);
}
const requestedLan = arguments_.includes("--lan");
if (requestedLan && requestedMode !== "fixture") {
  console.error("LAN exposure is fixture-only. Local-media mode must remain on loopback.");
  process.exit(1);
}

try {
  assertProviderFreeEnvironment(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Provider-free environment check failed.");
  process.exit(1);
}

const existing = await health();
const webOwner = await listeningProcess(4173);

if (existing?.app === "videoforge") {
  if (!webOwner) {
    console.error(
      `VideoForge health responded at ${url}, but the listener owner could not be verified. ` +
        "Refusing to reuse an unowned server.",
    );
    process.exit(1);
  }
  if (existing.mode !== requestedMode) {
    console.error(
      `VideoForge is already healthy at ${url} in ${existing.mode} mode. ` +
        `Stop that owned process explicitly before switching to ${requestedMode} mode.`,
    );
    process.exit(1);
  }

  const existingLan = isLanListenerAddress(webOwner.address);
  if (existingLan !== requestedLan) {
    const existingBinding = existingLan ? "LAN" : "loopback";
    const requestedBinding = requestedLan ? "LAN" : "loopback";
    console.error(
      `VideoForge is already healthy at ${url} on ${existingBinding}. ` +
        `Stop that owned process explicitly before switching to ${requestedBinding}.`,
    );
    process.exit(1);
  }

  const apiOwner = await listeningProcess(apiPort);
  if (!apiOwner) {
    console.error(
      `VideoForge health responded at ${url}, but no owned API listener was found on port ${apiPort}. ` +
        "Refusing to reuse an incomplete server pair.",
    );
    process.exit(1);
  }

  const detail = requestedMode === "fixture" ? `fixture ${existing.fixture_id}` : "local media";
  console.log(
    `VideoForge already healthy at ${url} (${detail}; ${requestedLan ? "LAN" : "loopback"}).`,
  );
  process.exit(0);
}

for (const port of [4173, apiPort]) {
  const owner = port === 4173 ? webOwner : await listeningProcess(port);
  if (owner) {
    console.error(
      `Cannot start VideoForge: port ${port} is owned by PID ${owner.pid} (${owner.command}). ` +
        "Stop that process explicitly or restore the owned VideoForge server; no alternate port will be chosen.",
    );
    process.exit(1);
  }
}

if (requestedMode === "local") {
  const setupCommands = [
    [process.execPath, ["scripts/local-doctor.mjs"]],
    ["pnpm", ["--filter", "@videoforge/contracts", "build"]],
    ["pnpm", ["--filter", "@videoforge/pipeline", "build"]],
  ];
  for (const [command, arguments_] of setupCommands) {
    const result = spawnSync(command, arguments_, { cwd: process.cwd(), stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const commit = (await commandOutput("git", ["rev-parse", "--short", "HEAD"])) ?? "uncommitted";
const webScript = requestedLan ? "dev:raw:lan" : "dev:raw";
const child = run("pnpm", ["--filter", "@videoforge/web", webScript], {
  env: {
    ...sanitizedDevelopmentEnvironment(process.env),
    VIDEOFORGE_COMMIT: commit,
    VIDEOFORGE_PROVIDER_MODE: requestedMode,
  },
});

try {
  await writeDevelopmentOwnership({
    repositoryRoot: process.cwd(),
    supervisorPid: process.pid,
    childPid: child.pid,
    commit,
    mode: requestedMode,
    binding: requestedLan ? "lan" : "loopback",
    ports: [4173, apiPort],
    startedAt: new Date().toISOString(),
  });
} catch (error) {
  child.kill("SIGTERM");
  console.error(
    `Could not record VideoForge development ownership: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

let stopRequested = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopRequested = true;
    child.kill(signal);
  });
}

child.on("exit", async (code, signal) => {
  await removeDevelopmentOwnership(process.pid);
  if (stopRequested) process.exit(0);
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
