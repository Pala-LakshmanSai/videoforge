import { spawnSync } from "node:child_process";

const expectedPackages = [
  "@videoforge/config",
  "@videoforge/contracts",
  "@videoforge/control-plane",
  "@videoforge/pipeline",
  "@videoforge/provider-sandbox",
  "@videoforge/test-fixtures",
  "@videoforge/web",
];

const dryRun = spawnSync(
  "pnpm",
  ["exec", "turbo", "run", "build", "lint", "typecheck", "test", "--dry=json"],
  { cwd: process.cwd(), encoding: "utf8" },
);

if (dryRun.status !== 0) {
  process.stderr.write(dryRun.stderr);
  process.exit(dryRun.status ?? 1);
}

const graph = JSON.parse(dryRun.stdout);
const taskIds = graph.tasks.map(({ taskId }) => taskId);
const failures = [];

if (new Set(taskIds).size !== taskIds.length) {
  failures.push("the Turbo dry run contains duplicate task IDs");
}

for (const packageName of expectedPackages) {
  const buildId = `${packageName}#build`;
  if (taskIds.filter((taskId) => taskId === buildId).length !== 1) {
    failures.push(`${buildId} must appear exactly once`);
  }
}

if (taskIds.filter((taskId) => taskId === "@videoforge/control-plane#test").length !== 1) {
  failures.push("@videoforge/control-plane#test must appear exactly once");
}

for (const task of graph.tasks.filter(({ task }) => task === "test")) {
  if (/\b(?:pnpm|turbo)\b[^\n]*(?:\bbuild\b|build:)/u.test(task.command)) {
    failures.push(`${task.taskId} recursively invokes a build: ${task.command}`);
  }
  if (!task.dependencies.includes(`${task.package}#build`)) {
    failures.push(`${task.taskId} does not depend on its package build task`);
  }
}

const fixtureBuild = graph.tasks.find(({ taskId }) => taskId === "@videoforge/test-fixtures#build");
if (fixtureBuild?.outputs != null) {
  failures.push("the no-emit test-fixtures build must not declare outputs");
}

const webBuild = graph.tasks.find(({ taskId }) => taskId === "@videoforge/web#build");
for (const output of ["dist/**", "dist-cloudflare/**"]) {
  if (!webBuild?.outputs?.includes(output)) {
    failures.push(`@videoforge/web#build must declare ${output}`);
  }
}

if (failures.length > 0) {
  console.error(`Verification graph is invalid:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Verification graph is non-duplicating: ${graph.tasks.length} unique tasks, one control-plane test task, and one build task for each of ${expectedPackages.length} packages.`,
);
