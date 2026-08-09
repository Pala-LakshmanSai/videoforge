import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const candidate = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      return entry.isDirectory() ? sourceFiles(candidate) : [candidate];
    }),
  );
  return nested.flat();
}

test("pipeline source contains no process, storage, network, media, provider, or random imports", async () => {
  const forbidden = [
    /from ["']node:(?:child_process|fs|http|https|net|tls|dgram|worker_threads)["']/u,
    /from ["'](?:ffmpeg|fluent-ffmpeg|runpod|runware|axios|undici)[^"']*["']/iu,
    /\b(?:Date\.now|Math\.random|randomUUID)\s*\(/u,
  ];

  for (const file of await sourceFiles(sourceRoot)) {
    if (path.extname(file.pathname) !== ".ts") continue;
    const source = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file.pathname} violates ${pattern}`);
    }
  }
});
