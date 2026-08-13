import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveWhisperModelPath, whisperModel } from "./local-media-config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const python = path.join(repoRoot, ".venv/bin/python");
const model = resolveWhisperModelPath();
const ffmpeg = "/opt/homebrew/bin/ffmpeg";
const ffprobe = "/opt/homebrew/bin/ffprobe";
const whisper = "/opt/homebrew/bin/whisper-cli";
const ownedText =
  "Owned timing evidence starts with a careful source check. Clear words cross each chunk boundary, and the original voiceover remains render truth.";

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function run(command, args, label, maxBytes = 8 * 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) child.kill("SIGTERM");
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) child.kill("SIGTERM");
      else stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Math.round(performance.now() - started),
      };
      if (code === 0) resolve(result);
      else reject(new Error(`${label} failed (${code}): ${result.stderr.slice(-2000)}`));
    });
  });
}

async function durationMs(file) {
  const result = await run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
    "fixture probe",
  );
  return Math.round(Number(JSON.parse(result.stdout).format.duration) * 1000);
}

async function prepareObject(root, fixtureId, source, durationOverrideMs = null) {
  const bytes = await readFile(source);
  const checksum = sha256(bytes);
  const digest = checksum.slice(7);
  const destination = path.join(root, "objects", "sha256", digest.slice(0, 2), `${digest}.wav`);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  return {
    assetId: `asset_cp03_${fixtureId}`,
    checksum,
    bytes: bytes.length,
    uri: `vf-local://objects/sha256/${digest.slice(0, 2)}/${digest}.wav`,
    durationMs: durationOverrideMs ?? (await durationMs(source)),
  };
}

async function runFixture(root, fixtureId, source, expectedStatus, expectedError = null) {
  const object = await prepareObject(
    root,
    fixtureId,
    source,
    fixtureId === "malformed" ? 12_000 : null,
  );
  const revisionId = `revision_cp03_${fixtureId}`;
  const attemptId = `attempt_cp03_${fixtureId}`;
  const runRoot = path.join(root, "runs", revisionId, attemptId);
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  const input = {
    schema_version: "asr-job-input/v1",
    project_revision_id: revisionId,
    attempt_id: attemptId,
    voiceover: {
      asset_id: object.assetId,
      sha256: object.checksum,
      artifact_uri: object.uri,
      media_type: "audio/wav",
      duration_ms: object.durationMs,
    },
    model: {
      engine: "whisper.cpp",
      name: "base.en",
      sha256: `sha256:${whisperModel.sha256}`,
      language: "en",
    },
    options: {
      threads: 8,
      processors: 1,
      flash_attention: true,
      greedy: true,
      split_on_word: true,
    },
    output: {
      result_uri: `vf-local-run://${revisionId}/${attemptId}/asr-result.json`,
    },
    cancel_token: `cp03-${fixtureId}-${"0".repeat(48)}`,
  };
  const inputPath = path.join(runRoot, "asr-input.json");
  await writeFile(inputPath, `${canonical(input)}\n`, { encoding: "utf8", flag: "wx" });

  const invoke = () =>
    run(
      python,
      [
        "-m",
        "videoforge_media_local.cli",
        "transcribe",
        "--artifact-root",
        root,
        "--input",
        inputPath,
        "--whisper",
        whisper,
        "--model",
        model,
        "--whisper-version",
        "1.8.4",
        "--ffmpeg",
        ffmpeg,
        "--ffprobe",
        ffprobe,
      ],
      `CP-03 ${fixtureId}`,
    );
  const firstInvocation = await invoke();
  const first = JSON.parse(firstInvocation.stdout);
  if (first.status !== expectedStatus || (first.error?.code ?? null) !== expectedError)
    throw new Error(
      `${fixtureId} returned ${first.status}/${first.error?.code ?? "NONE"}; expected ${expectedStatus}/${expectedError ?? "NONE"}`,
    );

  const summary = {
    fixtureId,
    sourceSha256: object.checksum,
    sourceBytes: object.bytes,
    sourceDurationMs: object.durationMs,
    status: first.status,
    errorCode: first.error?.code ?? null,
    firstInvocationMs: firstInvocation.durationMs,
    words: first.transcript?.words.length ?? 0,
    phrases: first.transcript?.phrases.length ?? 0,
    firstWords:
      first.transcript?.words.slice(0, 20).map((word) => ({
        text: word.text,
        startMs: word.start_ms,
        endMs: word.end_ms,
      })) ?? [],
    monotonic:
      first.transcript?.words.every(
        (word, index, words) =>
          word.start_ms >= 0 &&
          word.end_ms <= object.durationMs &&
          word.end_ms > word.start_ms &&
          (index === 0 || words[index - 1].end_ms <= word.start_ms),
      ) ?? false,
    phraseWordCoverage:
      first.transcript?.phrases.reduce(
        (count, phrase) => count + phrase.word_end_exclusive - phrase.word_start,
        0,
      ) ?? 0,
  };
  if (first.status !== "SUCCEEDED") return summary;
  if (!summary.monotonic || summary.phraseWordCoverage !== summary.words)
    throw new Error(`${fixtureId} timing invariants failed.`);

  const resultPath = path.join(runRoot, "asr-result.json");
  const receiptPath = path.join(runRoot, "asr-work-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  summary.chunkCount = receipt.chunking.chunks.length;
  summary.transcriptSha256 = sha256(Buffer.from(canonical(first.transcript)));
  summary.receiptSha256 = sha256(Buffer.from(canonical(receipt)));
  const replayInvocation = await invoke();
  const replay = JSON.parse(replayInvocation.stdout);
  if (canonical(replay) !== canonical(first))
    throw new Error(`${fixtureId} replay changed result.`);
  summary.replayInvocationMs = replayInvocation.durationMs;

  if (fixtureId === "long") {
    await rm(resultPath);
    await rm(receiptPath);
    const restartInvocation = await invoke();
    const restarted = JSON.parse(restartInvocation.stdout);
    const restartedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (
      canonical(restarted.transcript) !== canonical(first.transcript) ||
      canonical(restartedReceipt) !== canonical(receipt)
    )
      throw new Error("Long restart changed transcript or durable receipt.");
    summary.restartInvocationMs = restartInvocation.durationMs;
    summary.restartRecoveredChunks = receipt.chunking.chunks.length;
  }
  return summary;
}

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] ?? "") : null;
if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");
const root = await mkdtemp(path.join(tmpdir(), "videoforge-cp03-real-"));
const fixtures = path.join(root, "owned-fixtures");
await mkdir(fixtures, { recursive: true });
const aiff = path.join(fixtures, "owned.aiff");
const short = path.join(fixtures, "short.wav");
const noisy = path.join(fixtures, "noisy.wav");
const silence = path.join(fixtures, "silence.wav");
const malformed = path.join(fixtures, "malformed.wav");
const long = path.join(fixtures, "long-30m.wav");

await run("/usr/bin/say", ["-v", "Samantha", "-r", "170", "-o", aiff, ownedText], "say");
await run(
  ffmpeg,
  [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    aiff,
    "-af",
    "apad=pad_dur=4",
    "-t",
    "16",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    short,
  ],
  "short fixture",
);
await run(
  ffmpeg,
  [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    short,
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=white:amplitude=0.02:duration=16",
    "-filter_complex",
    "[0:a][1:a]amix=inputs=2:duration=first:weights='1 0.35'",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    noisy,
  ],
  "noisy fixture",
);
await run(
  ffmpeg,
  [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=16000:cl=mono",
    "-t",
    "12",
    "-c:a",
    "pcm_s16le",
    silence,
  ],
  "silence fixture",
);
await writeFile(malformed, Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60, 7)]));
await run(
  ffmpeg,
  [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    short,
    "-t",
    "1800",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    long,
  ],
  "30-minute fixture",
);

const results = [];
results.push(await runFixture(root, "short", short, "SUCCEEDED"));
results.push(await runFixture(root, "noisy", noisy, "SUCCEEDED"));
results.push(await runFixture(root, "silence", silence, "FAILED", "ASR_OUTPUT_INVALID"));
results.push(await runFixture(root, "malformed", malformed, "FAILED", "ASR_SOURCE_DECODE_FAILED"));
results.push(await runFixture(root, "long", long, "SUCCEEDED"));

const report = {
  schemaVersion: "videoforge.cp03-real-transcript-acceptance/v1",
  artifactRoot: root,
  providerCalls: 0,
  externalSpendUsd: 0,
  model: {
    name: whisperModel.name,
    sha256: `sha256:${whisperModel.sha256}`,
    changedOrDownloaded: false,
  },
  tools: { whisperCpp: "1.8.4", ffmpeg: "8.1.1", ffprobe: "8.1.1" },
  results,
};
const serialized = JSON.stringify(report, null, 2);
if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serialized}\n`, { encoding: "utf8" });
} else {
  console.log(serialized);
}
