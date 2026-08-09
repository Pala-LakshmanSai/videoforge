import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { resolveWhisperModelPath, whisperModel } from "./local-media-config.mjs";

const destination = resolveWhisperModelPath();

const inspectModel = async (filename) => {
  const metadata = await stat(filename);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return { bytes: metadata.size, sha256: hash.digest("hex") };
};

try {
  await access(destination);
  const existing = await inspectModel(destination);
  if (existing.bytes !== whisperModel.bytes || existing.sha256 !== whisperModel.sha256) {
    throw new Error(
      `Existing model failed verification at ${destination}; move it aside before retrying.`,
    );
  }
  console.log(`PASS whisper.cpp ${whisperModel.name}: already verified at ${destination}`);
  process.exit(0);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    // Expected first-run state.
  } else if (error instanceof Error && error.message.startsWith("Existing model")) {
    console.error(error.message);
    process.exit(1);
  }
}

await mkdir(path.dirname(destination), { recursive: true });
const partial = `${destination}.${process.pid}.partial`;
const response = await fetch(whisperModel.url, { redirect: "follow" });
if (!response.ok || !response.body) {
  throw new Error(`Model download failed with HTTP ${response.status}.`);
}

let bytes = 0;
const hash = createHash("sha256");
const verifier = new Transform({
  transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    hash.update(chunk);
    callback(null, chunk);
  },
});

try {
  await pipeline(
    Readable.fromWeb(response.body),
    verifier,
    createWriteStream(partial, { flags: "wx", mode: 0o600 }),
  );
  const sha256 = hash.digest("hex");
  if (bytes !== whisperModel.bytes || sha256 !== whisperModel.sha256) {
    throw new Error(
      `Downloaded model failed verification (bytes=${bytes}, sha256=${sha256}); expected bytes=${whisperModel.bytes}, sha256=${whisperModel.sha256}.`,
    );
  }
  await rename(partial, destination);
  console.log(`PASS whisper.cpp ${whisperModel.name}: ${bytes} bytes, sha256:${sha256}`);
} catch (error) {
  await unlink(partial).catch(() => {});
  throw error;
}
