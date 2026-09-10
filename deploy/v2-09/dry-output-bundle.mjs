import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const fail = (code) => {
  throw new Error(`V2_09_DRY_OUTPUT_${code}`);
};
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);

// Wrangler embeds the input module's filesystem-relative path in the generated entrypoint
// comment. The qualified config preparation hashes the checkout path, while the replacement
// operator hashes an immutable temporary upload snapshot. That comment is not executable payload;
// normalize only this exact entrypoint metadata so both source-bound proofs hash the same runtime.
const normalizedRuntimeBytes = (entryPath, bytes) => {
  if (entryPath !== "index.js") return bytes;
  const text = bytes.toString("utf8");
  const normalized = text.replace(
    /^\/\/ [^\r\n]*\/index\.js\n(?=import )/mu,
    "// videoforge-entrypoint/index.js\n",
  );
  return normalized === text ? bytes : Buffer.from(normalized, "utf8");
};

/** Hash runtime payload only. Wrangler 4.120's exact generated README is non-runtime metadata. */
export function hashV209DryOutputBundle(directory, { workerName } = {}) {
  if (typeof workerName !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(workerName))
    fail("WORKER_INVALID");
  const root = resolve(directory);
  const files = [];
  let readmeSeen = false;
  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("DIRECTORY_INVALID");
    const walk = (current) => {
      const names = readdirSync(current).sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
      );
      for (const name of names) {
        const path = resolve(current, name);
        if (!path.startsWith(`${root}/`)) fail("PATH_INVALID");
        const before = lstatSync(path);
        if (before.isSymbolicLink()) fail("SYMLINK");
        if (before.isDirectory()) {
          walk(path);
          continue;
        }
        if (!before.isFile()) fail("ENTRY_INVALID");
        const bytes = readFileSync(path);
        const after = lstatSync(path);
        if (
          after.isSymbolicLink() ||
          before.ino !== after.ino ||
          before.dev !== after.dev ||
          before.size !== bytes.length ||
          after.size !== bytes.length ||
          before.mtimeMs !== after.mtimeMs
        )
          fail("RACE");
        const entryPath = relative(root, path).replaceAll("\\", "/");
        if (entryPath === "README.md") {
          const prefix = `This folder contains the built output assets for the worker "${workerName}" generated at `;
          const text = bytes.toString("utf8");
          const timestamp = text.slice(prefix.length, -1);
          if (
            !text.startsWith(prefix) ||
            !text.endsWith(".") ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp) ||
            !Number.isFinite(Date.parse(timestamp)) ||
            new Date(timestamp).toISOString() !== timestamp ||
            !bytes.equals(Buffer.from(`${prefix}${timestamp}.`))
          )
            fail("README_INVALID");
          readmeSeen = true;
          continue;
        }
        const runtimeBytes = normalizedRuntimeBytes(entryPath, bytes);
        files.push({ path: entryPath, bytes: runtimeBytes.length, sha256: sha256(runtimeBytes) });
      }
    };
    walk(root);
  } catch (error) {
    if (error?.message?.startsWith("V2_09_DRY_OUTPUT_")) throw error;
    fail("READ_FAILED");
  }
  if (!readmeSeen) fail("README_MISSING");
  if (!files.some(({ path }) => path === "index.js")) fail("ENTRYPOINT_MISSING");
  return sha256(
    canonical({ schemaVersion: "videoforge.v2-09-wrangler-runtime-payload-manifest/v1", files }),
  );
}
