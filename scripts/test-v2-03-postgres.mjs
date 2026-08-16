import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const image = "postgres:16-alpine";
const container = `videoforge-v2-03-${randomUUID()}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}${detail ? `\n${detail}` : ""}`,
    );
  }
  return (result.stdout ?? "").trim();
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], {
      stdio: "ignore",
    });
    if (ready.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The disposable PostgreSQL server did not become ready within five seconds.");
}

let started = false;
try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]).trim();
  run("docker", ["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-p",
    "127.0.0.1::5432",
    image,
  ]);
  started = true;
  await waitForPostgres();
  const binding = run("docker", ["port", container, "5432/tcp"]);
  const port = binding.match(/:(\d+)$/u)?.[1];
  if (port === undefined) throw new Error(`Could not parse the PostgreSQL port from ${binding}.`);

  run("pnpm", ["--filter", "@videoforge/control-plane", "build"], { stdio: "inherit" });
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@videoforge/control-plane",
      "exec",
      "node",
      "--test",
      "--test-concurrency=4",
      "tests/fair-admission.test.mjs",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VIDEOFORGE_TEST_POSTGRES_URL: `postgresql://postgres@127.0.0.1:${port}/postgres`,
      },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (started) spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}
