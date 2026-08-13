import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${String(result.status)}): ${(result.stderr ?? "").slice(-2000)}`,
    );
  return result.stdout.trim();
}

const runtimeImage = "videoforge/cp03-contract-runtime:local";
const deploymentImage = "videoforge/cp03-media-local:contract-smoke";
run("docker", [
  "build",
  "--file",
  "workers/media-local/Dockerfile.contract",
  "--tag",
  runtimeImage,
  ".",
]);
run("docker", [
  "build",
  "--file",
  "workers/media-local/Dockerfile",
  "--build-arg",
  `MEDIA_RUNTIME_IMAGE=${runtimeImage}`,
  "--tag",
  deploymentImage,
  ".",
]);
const mac = run(".venv/bin/python", ["-m", "videoforge_media_local.contract_probe"]);
const container = run("docker", [
  "run",
  "--rm",
  "--network",
  "none",
  "--entrypoint",
  "python3",
  deploymentImage,
  "-m",
  "videoforge_media_local.contract_probe",
]);
if (mac !== container) throw new Error("Mac and container CP-03 contract bytes differ.");
const imageId = run("docker", ["image", "inspect", "--format", "{{.Id}}", deploymentImage]);
const report = {
  schemaVersion: "videoforge.cp03-container-contract-parity/v1",
  result: "PASS",
  byteIdentical: true,
  networkAtRuntime: "none",
  imageId,
  contract: JSON.parse(mac),
  claimBoundary:
    "Contract-only parity; no Linux whisper.cpp/FFmpeg execution and no Cloud Run deployment.",
};
const serialized = JSON.stringify(report, null, 2);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  const outputPath = path.resolve(process.argv[outputIndex + 1] ?? "");
  if (!outputPath) throw new Error("--output requires a path.");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${serialized}\n`, { encoding: "utf8" });
} else {
  console.log(serialized);
}
