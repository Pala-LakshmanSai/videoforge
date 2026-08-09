import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { commandOutput, health, listeningProcess } from "./process.mjs";

const expected = {
  node: "v22.23.2",
  pnpm: "11.5.2",
};
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

record("Node", process.version === expected.node, `${process.version}; expected ${expected.node}`);
record("pnpm", (await commandOutput("pnpm", ["--version"])) === expected.pnpm, expected.pnpm);
record(
  "Python",
  (await commandOutput("python3.12", ["--version"]))?.startsWith("Python 3.12") ?? false,
  "3.12 worker and contract baseline",
);
record(
  "FFmpeg",
  (await commandOutput("ffmpeg", ["-version"]))?.includes("ffmpeg version 8.1.1") ?? false,
  "8.1.1",
);

for (const file of [
  "project-context/evidence/create_project_request.schema.json",
  "project-context/evidence/fixtures/create_project_request.valid.json",
  ".env.example",
]) {
  try {
    await access(file, constants.R_OK);
    record(file, true, "present");
  } catch {
    record(file, false, "missing");
  }
}

const envExample = await readFile(".env.example", "utf8");
const providerMode = process.env.VIDEOFORGE_PROVIDER_MODE ?? "fixture";
record("Provider mode", ["fixture", "local"].includes(providerMode), providerMode);
record(
  "Environment names",
  /RUNPOD_API_KEY=/.test(envExample) && /RUNWARE_API_KEY=/.test(envExample),
  "placeholders present",
);

const owner = await listeningProcess(4173);
if (!owner) {
  record("Port 4173", true, "free");
} else {
  const status = await health();
  record(
    "Port 4173",
    status?.app === "videoforge" && ["fixture", "local"].includes(status?.mode),
    `PID ${owner.pid} (${owner.command})`,
  );
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
}

if (checks.some((check) => !check.ok)) process.exit(1);
