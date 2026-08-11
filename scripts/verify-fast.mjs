import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function runPhase(commands) {
  const results = await Promise.all(
    commands.map(
      ({ label, script }) =>
        new Promise((resolve) => {
          const child = spawn(pnpm, [script], {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
          });
          child.on("error", (error) => resolve({ label, error }));
          child.on("exit", (code, signal) => resolve({ label, code, signal }));
        }),
    ),
  );

  const failures = results.filter(({ code, error, signal }) => error || signal || code !== 0);
  if (failures.length > 0) {
    for (const { label, code, error, signal } of failures) {
      console.error(
        `${label} failed (${error?.message ?? (signal ? `signal ${signal}` : `exit ${code}`)}).`,
      );
    }
    process.exit(1);
  }
}

console.log(
  "verify:fast is a non-release feedback gate: Workerd parity and installed-Chrome journeys are excluded. Run pnpm verify for canonical release evidence.",
);

await runPhase([
  { label: "format", script: "format:check" },
  { label: "root lint", script: "lint:root" },
  { label: "Python lint", script: "python:lint" },
  { label: "verification graph", script: "verify:graph" },
]);

await runPhase([{ label: "package graph", script: "verify:packages" }]);

await runPhase([
  { label: "script tests", script: "test:scripts" },
  { label: "worker tests", script: "test:workers" },
  { label: "context validation", script: "context:validate" },
  { label: "secret scan", script: "secret:scan" },
]);

await runPhase([{ label: "generated build check", script: "build:check-generated" }]);
