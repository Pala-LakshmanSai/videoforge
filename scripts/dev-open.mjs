import { developmentOpenRoute } from "./dev-policy.mjs";
import { health, run } from "./process.mjs";

const url = "http://localhost:4173";
const status = await health();
const arguments_ = process.argv.slice(2);
const routeArguments = arguments_.filter((argument) => argument.startsWith("--route="));
if (arguments_.length > 1 || routeArguments.length !== arguments_.length) {
  console.error("Usage: pnpm dev:open [--route=/same-origin-path]");
  process.exit(1);
}

if (!status || status.app !== "videoforge") {
  console.error(`VideoForge must be healthy at ${url} before opening Chrome.`);
  process.exit(1);
}

let route;
try {
  route = developmentOpenRoute(status, routeArguments[0]?.slice("--route=".length));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid development route.");
  process.exit(1);
}

const child = run("open", ["-a", "Google Chrome", new URL(route, url).toString()]);
child.on("exit", (code) => process.exit(code ?? 1));
