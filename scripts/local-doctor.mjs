import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { resolveWhisperModelPath, whisperModel } from "./local-media-config.mjs";
import { commandOutput } from "./process.mjs";
import { expectedUvVersion, resolveUv } from "./uv-tool.mjs";

const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let uv;
try {
  uv = resolveUv();
  record("uv", true, `${expectedUvVersion}; ${uv}`);
} catch (error) {
  record("uv", false, error instanceof Error ? error.message : String(error));
}

const python = await commandOutput("python3.12", ["--version"]);
record("Python", python?.startsWith("Python 3.12.") ?? false, python ?? "missing; expected 3.12");

const ffmpeg = await commandOutput("ffmpeg", ["-version"]);
record("FFmpeg", ffmpeg?.startsWith("ffmpeg version 8.1.1") ?? false, "expected 8.1.1");
const ffprobe = await commandOutput("ffprobe", ["-version"]);
record("FFprobe", ffprobe?.startsWith("ffprobe version 8.1.1") ?? false, "expected 8.1.1");

const whisperExecutable = await commandOutput("which", ["whisper-cli"]);
let whisperDetail = "missing; expected whisper.cpp 1.8.4";
let whisperOk = false;
if (whisperExecutable) {
  const resolved = await realpath(whisperExecutable);
  whisperDetail = resolved;
  whisperOk =
    resolved.includes("/whisper-cpp/1.8.4/") ||
    process.env.VIDEOFORGE_WHISPER_CPP_VERSION === "1.8.4";
}
record("whisper.cpp", whisperOk, whisperDetail);

const modelPath = resolveWhisperModelPath();
try {
  const metadata = await stat(modelPath);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(modelPath)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  record(
    "Whisper model",
    metadata.size === whisperModel.bytes && sha256 === whisperModel.sha256,
    `${modelPath}; ${metadata.size} bytes; sha256:${sha256}`,
  );
} catch {
  record("Whisper model", false, `${modelPath}; run pnpm local:model:fetch`);
}

const fixtureNarrator = await commandOutput("which", ["say"]);
const voices = fixtureNarrator ? await commandOutput(fixtureNarrator, ["-v", "?"]) : null;
record(
  "Owned narration generator",
  Boolean(fixtureNarrator && voices?.includes("Samantha")),
  fixtureNarrator && voices?.includes("Samantha")
    ? `${fixtureNarrator}; Samantha available`
    : "missing /usr/bin/say or Samantha voice",
);

const rasterizer = await commandOutput("which", ["sips"]);
record("Owned SVG rasterizer", Boolean(rasterizer), rasterizer ?? "missing: /usr/bin/sips");

const bridgePython = path.join(repositoryRoot, ".venv/bin/python");
const bridge = await commandOutput(bridgePython, [
  "-c",
  "import videoforge_image_media.local_cli; print('ready')",
]);
record(
  "Local Python bridge",
  bridge === "ready",
  bridge === "ready" ? bridgePython : "missing; run pnpm python:sync",
);
record("Provider authorization", true, "$0; external provider calls disabled");

for (const check of checks)
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
if (checks.some((check) => !check.ok)) process.exit(1);
