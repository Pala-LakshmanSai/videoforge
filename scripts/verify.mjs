import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(pnpm, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => resolve({ script, error }));
    child.on("exit", (code, signal) => resolve({ script, code, signal }));
  });
}

function assertPassed(results) {
  const failures = results.filter(({ code, error, signal }) => error || signal || code !== 0);
  if (failures.length === 0) return;

  for (const { script, code, error, signal } of failures) {
    console.error(
      `${script} failed (${error?.message ?? (signal ? `signal ${signal}` : `exit ${code}`)}).`,
    );
  }
  process.exit(1);
}

assertPassed(await Promise.all([run("verify:fast"), run("test:cloudflare-runtime")]));
assertPassed([await run("test:chrome")]);
