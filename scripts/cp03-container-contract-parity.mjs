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

const deploymentImage = "videoforge/cp03-media-local:local";
run("docker", ["build", "--file", "workers/media-local/Dockerfile", "--tag", deploymentImage, "."]);
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
const imagePlatform = run("docker", [
  "image",
  "inspect",
  "--format",
  "{{.Os}}/{{.Architecture}}",
  deploymentImage,
]);
const executableHashes = run("docker", [
  "run",
  "--rm",
  "--network",
  "none",
  "--entrypoint",
  "/usr/bin/sha256sum",
  deploymentImage,
  "/usr/local/bin/whisper-cli",
  "/usr/local/bin/ffmpeg",
  "/usr/local/bin/ffprobe",
]);
const modelEmbeddingCheck = run("docker", [
  "run",
  "--rm",
  "--network",
  "none",
  "--entrypoint",
  "/bin/sh",
  deploymentImage,
  "-c",
  "test ! -e /models && printf absent",
]);
const report = {
  schemaVersion: "videoforge.cp03-container-contract-parity/v1",
  result: "PASS",
  byteIdentical: true,
  networkAtRuntime: "none",
  imageId,
  imagePlatform,
  executableHashes: Object.fromEntries(
    executableHashes.split("\n").map((line) => {
      const [digest, file] = line.trim().split(/\s+/u);
      return [file, `sha256:${digest}`];
    }),
  ),
  modelEmbedded: modelEmbeddingCheck !== "absent",
  contract: JSON.parse(mac),
  actualMediaEvidence:
    "project-context/evidence/acceptance/VF-9-24N/cp03-word-transcript/real-owned-fixtures.json",
  claimBoundary: "Local container proof only; no Cloud Run deployment or hosted-production claim.",
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
