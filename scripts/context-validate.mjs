import { run } from "./process.mjs";

const commands = [
  ["project-context/scripts/validate-context.sh", []],
  ["project-context/scripts/validate-schemas.sh", []],
];

for (const [command, args] of commands) {
  const child = run(command, args);
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) process.exit(code ?? 1);
}
