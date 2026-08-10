import { assertProviderFreeEnvironment, sanitizedDevelopmentEnvironment } from "./dev-policy.mjs";
import { commandOutput, listeningProcess, run } from "./process.mjs";

const port = 4173;
const owner = await listeningProcess(port);
if (owner) {
  console.error(
    `Cannot start the Cloudflare-local VideoForge runtime: port ${port} is owned by PID ${owner.pid} (${owner.command}).`,
  );
  process.exit(1);
}

try {
  assertProviderFreeEnvironment(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Provider-free environment check failed.");
  process.exit(1);
}

const commit = await commandOutput("git", ["rev-parse", "--short", "HEAD"]);
if (!commit) {
  console.error("Cannot start the Cloudflare-local runtime without resolving the current commit.");
  process.exit(1);
}

const child = run("pnpm", ["--filter", "@videoforge/web", "dev:cloudflare:raw"], {
  env: {
    ...sanitizedDevelopmentEnvironment(process.env),
    VITE_VIDEOFORGE_COMMIT: commit,
  },
  stdio: ["ignore", "inherit", "inherit"],
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
