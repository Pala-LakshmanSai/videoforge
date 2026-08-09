import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const generatedRouteTree = "apps/web/src/routeTree.gen.ts";

let before;
try {
  before = await readFile(generatedRouteTree);
} catch {
  console.error(
    `${generatedRouteTree} is missing. Run the web route generator and commit its output before verification.`,
  );
  process.exit(1);
}

const build = spawnSync("pnpm", ["build"], { cwd: process.cwd(), stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const after = await readFile(generatedRouteTree);
if (!before.equals(after)) {
  console.error(
    `${generatedRouteTree} changed during the production build. Commit the generated route tree, then rerun verification.`,
  );
  process.exit(1);
}

const committed = spawnSync("git", ["diff", "--exit-code", "--", generatedRouteTree], {
  cwd: process.cwd(),
  stdio: "inherit",
});
if (committed.status !== 0) {
  console.error(
    `${generatedRouteTree} differs from the committed version. Regenerate and commit it before verification.`,
  );
  process.exit(committed.status ?? 1);
}

console.log(`Generated route tree remained stable: ${generatedRouteTree}`);
