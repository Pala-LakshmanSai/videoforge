import path from "node:path";

export const whisperModel = Object.freeze({
  name: "base.en",
  repositoryCommit: "5359861c739e955e79d9a303bcbc70fb988958b1",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin",
  bytes: 147_964_211,
  sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
});

export const resolveWhisperModelPath = () =>
  path.resolve(process.env.VIDEOFORGE_WHISPER_MODEL ?? "weights/whisper.cpp/ggml-base.en.bin");
