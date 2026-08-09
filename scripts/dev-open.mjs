import { health, run } from "./process.mjs";

const url = "http://localhost:4173";
const status = await health();

if (!status || status.app !== "videoforge") {
  console.error(`VideoForge must be healthy at ${url} before opening Chrome.`);
  process.exit(1);
}

const child = run("open", ["-a", "Google Chrome", url]);
child.on("exit", (code) => process.exit(code ?? 1));
