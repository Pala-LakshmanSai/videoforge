import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const generatedRouteTree = "apps/web/src/routeTree.gen.ts";

try {
  await readFile(generatedRouteTree);
} catch {
  console.error(
    `${generatedRouteTree} is missing. Run the web route generator and commit its output before verification.`,
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

console.log(
  `Generated route tree is present and matches Git after the production build: ${generatedRouteTree}`,
);
