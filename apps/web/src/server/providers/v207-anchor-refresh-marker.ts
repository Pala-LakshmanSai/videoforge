import { constants as fsConstants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

/**
 * The only protected file that the anchor-refresh helper is allowed to edit
 * after an exact, separately approved mutation.  The helper still requires an
 * explicit path at its CLI boundary; this default is only a shared identity
 * constant for callers which have already crossed that boundary.
 */
export const V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH =
  "/Users/lakshmansai/.config/videoforge/v2-06/wrangler-current-3d8d467.json" as const;

export const V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY = "V207_ROLLBACK_ANCHOR_REFRESH" as const;
export const V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION = "two-phase-v1" as const;
export const V207_ANCHOR_REFRESH_BASELINE_SHA256 =
  "sha256:085c49cad14e5e3b339f34065075f311a795c311d474c2355b6477f75c860175" as const;
export const V207_ANCHOR_REFRESH_ENABLED_SHA256 =
  "sha256:a01a6ec7ffa45a187f8b4cc094ca1522c33a37a6f3e4aea06cb2a38b14120fd5" as const;
export const V207_ANCHOR_REFRESH_FILE_MODE = 0o600 as const;

type MarkerState = "disabled" | "enabled";

export class V207AnchorRefreshMarkerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "V207AnchorRefreshMarkerError";
    this.code = code;
  }
}

export interface V207AnchorRefreshMarkerResult {
  readonly operation: "apply" | "revert";
  readonly state: MarkerState;
  readonly sha256: string;
}

export interface V207AnchorRefreshMarkerOptions {
  /** Test-only interruption fence immediately before the atomic rename. */
  readonly beforeRename?: () => void | Promise<void>;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function fail(code: string): never {
  throw new V207AnchorRefreshMarkerError(code);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertAbsolutePath(configPath: string): void {
  if (!isAbsolute(configPath) || configPath.includes("\0")) {
    fail("V207_ANCHOR_REFRESH_CONFIG_PATH_INVALID");
  }
}

function assertRecord(value: unknown, code: string): asserts value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
}

function markerKeyCount(bytes: Uint8Array): number {
  // The marker is a fixed ASCII JSON key.  Counting key tokens before parsing
  // catches duplicate object members, which JSON.parse would otherwise erase.
  const text = Buffer.from(bytes).toString("utf8");
  return (text.match(/"V207_ROLLBACK_ANCHOR_REFRESH"\s*:/gu) ?? []).length;
}

function parseJson(bytes: Uint8Array): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    fail("V207_ANCHOR_REFRESH_CONFIG_JSON_INVALID");
  }
  assertRecord(parsed, "V207_ANCHOR_REFRESH_CONFIG_SHAPE_INVALID");
  return parsed;
}

function assertMarkerShape(bytes: Uint8Array, state: MarkerState): JsonRecord {
  const count = markerKeyCount(bytes);
  const config = parseJson(bytes);
  const rootHasMarker = hasOwn(config, V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY);
  const vars = config.vars;
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) {
    fail("V207_ANCHOR_REFRESH_CONFIG_VARS_INVALID");
  }
  const markerVars = vars as Record<string, unknown>;
  const varsHasMarker = hasOwn(markerVars, V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY);

  if (state === "disabled") {
    if (count !== 0 || rootHasMarker || varsHasMarker) {
      fail("V207_ANCHOR_REFRESH_MARKER_DUPLICATE_OR_DRIFTED");
    }
    return config;
  }

  if (count !== 1 || rootHasMarker || !varsHasMarker) {
    fail("V207_ANCHOR_REFRESH_MARKER_DUPLICATE_OR_DRIFTED");
  }
  if (
    markerVars[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY] !== V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION
  ) {
    fail("V207_ANCHOR_REFRESH_MARKER_VALUE_INVALID");
  }
  return config;
}

function assertHash(bytes: Uint8Array, expected: string, code: string): void {
  if (sha256(bytes) !== expected) fail(code);
}

function canonicalJson(config: JsonRecord): Uint8Array {
  return Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function enabledBytes(baselineBytes: Uint8Array): Uint8Array {
  const config = assertMarkerShape(baselineBytes, "disabled");
  const vars = config.vars as Record<string, unknown>;
  const next: JsonRecord = {
    ...config,
    vars: {
      ...vars,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    },
  };
  const bytes = canonicalJson(next);
  assertHash(
    bytes,
    V207_ANCHOR_REFRESH_ENABLED_SHA256,
    "V207_ANCHOR_REFRESH_ENABLED_HASH_UNEXPECTED",
  );
  return bytes;
}

function baselineBytes(enabled: Uint8Array): Uint8Array {
  const config = assertMarkerShape(enabled, "enabled");
  const vars = { ...(config.vars as Record<string, unknown>) };
  delete vars[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY];
  const next: JsonRecord = { ...config, vars };
  const bytes = canonicalJson(next);
  assertHash(
    bytes,
    V207_ANCHOR_REFRESH_BASELINE_SHA256,
    "V207_ANCHOR_REFRESH_BASELINE_HASH_UNEXPECTED",
  );
  return bytes;
}

async function readProtectedFile(
  configPath: string,
  expectedState: MarkerState,
  expectedHash: string,
): Promise<Uint8Array> {
  assertAbsolutePath(configPath);
  let metadata;
  try {
    metadata = await lstat(configPath);
  } catch {
    fail("V207_ANCHOR_REFRESH_CONFIG_UNREADABLE");
  }
  if (metadata.isSymbolicLink()) fail("V207_ANCHOR_REFRESH_CONFIG_SYMLINK");
  if (!metadata.isFile()) fail("V207_ANCHOR_REFRESH_CONFIG_NOT_REGULAR_FILE");
  if ((metadata.mode & 0o7777) !== V207_ANCHOR_REFRESH_FILE_MODE) {
    fail("V207_ANCHOR_REFRESH_CONFIG_MODE_INVALID");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(configPath);
  } catch {
    fail("V207_ANCHOR_REFRESH_CONFIG_UNREADABLE");
  }
  assertMarkerShape(bytes, expectedState);
  assertHash(
    bytes,
    expectedHash,
    expectedState === "disabled"
      ? "V207_ANCHOR_REFRESH_BASELINE_HASH_MISMATCH"
      : "V207_ANCHOR_REFRESH_ENABLED_HASH_MISMATCH",
  );
  return bytes;
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, fsConstants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not available on every supported filesystem.  The
    // file itself is always synced before rename; this is best-effort only.
  }
}

function temporaryPath(configPath: string): string {
  return join(
    dirname(configPath),
    `.${basename(configPath)}.v207-anchor-refresh.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
}

async function atomicReplace(
  configPath: string,
  currentState: MarkerState,
  currentHash: string,
  nextBytes: Uint8Array,
  nextState: MarkerState,
  options: V207AnchorRefreshMarkerOptions,
): Promise<void> {
  // Re-read immediately before writing the temp file and immediately before
  // rename.  This rejects concurrent drift and avoids overwriting a symlink.
  await readProtectedFile(configPath, currentState, currentHash);
  const tempPath = temporaryPath(configPath);
  let renamed = false;
  try {
    const handle = await open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      V207_ANCHOR_REFRESH_FILE_MODE,
    );
    try {
      await handle.writeFile(nextBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tempPath, V207_ANCHOR_REFRESH_FILE_MODE);

    if (options.beforeRename !== undefined) {
      try {
        await options.beforeRename();
      } catch {
        fail("V207_ANCHOR_REFRESH_ATOMIC_WRITE_INTERRUPTED");
      }
    }

    await readProtectedFile(configPath, currentState, currentHash);
    await rename(tempPath, configPath);
    renamed = true;
    await syncDirectory(dirname(configPath));
    await readProtectedFile(
      configPath,
      nextState,
      nextState === "enabled"
        ? V207_ANCHOR_REFRESH_ENABLED_SHA256
        : V207_ANCHOR_REFRESH_BASELINE_SHA256,
    );
  } catch (error) {
    if (renamed) fail("V207_ANCHOR_REFRESH_POST_RENAME_UNCERTAIN");
    if (error instanceof V207AnchorRefreshMarkerError) throw error;
    fail("V207_ANCHOR_REFRESH_ATOMIC_WRITE_FAILED");
  } finally {
    if (!renamed) await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function applyV207RollbackAnchorRefreshMarker(
  configPath: string,
  options: V207AnchorRefreshMarkerOptions = {},
): Promise<V207AnchorRefreshMarkerResult> {
  const baseline = await readProtectedFile(
    configPath,
    "disabled",
    V207_ANCHOR_REFRESH_BASELINE_SHA256,
  );
  const enabled = enabledBytes(baseline);
  await atomicReplace(
    configPath,
    "disabled",
    V207_ANCHOR_REFRESH_BASELINE_SHA256,
    enabled,
    "enabled",
    options,
  );
  return { operation: "apply", state: "enabled", sha256: V207_ANCHOR_REFRESH_ENABLED_SHA256 };
}

export async function revertV207RollbackAnchorRefreshMarker(
  configPath: string,
  options: V207AnchorRefreshMarkerOptions = {},
): Promise<V207AnchorRefreshMarkerResult> {
  const enabled = await readProtectedFile(
    configPath,
    "enabled",
    V207_ANCHOR_REFRESH_ENABLED_SHA256,
  );
  const baseline = baselineBytes(enabled);
  await atomicReplace(
    configPath,
    "enabled",
    V207_ANCHOR_REFRESH_ENABLED_SHA256,
    baseline,
    "disabled",
    options,
  );
  return { operation: "revert", state: "disabled", sha256: V207_ANCHOR_REFRESH_BASELINE_SHA256 };
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  const configPath = process.argv[3];
  if (
    (operation !== "apply" && operation !== "revert") ||
    configPath === undefined ||
    process.argv.length !== 4
  ) {
    console.error("V207_ANCHOR_REFRESH_USAGE");
    process.exitCode = 2;
    return;
  }
  try {
    if (operation === "apply") await applyV207RollbackAnchorRefreshMarker(configPath);
    else await revertV207RollbackAnchorRefreshMarker(configPath);
    console.log(
      operation === "apply"
        ? "V207_ANCHOR_REFRESH_MARKER_APPLIED"
        : "V207_ANCHOR_REFRESH_MARKER_REVERTED",
    );
  } catch (error) {
    console.error(
      error instanceof V207AnchorRefreshMarkerError ? error.code : "V207_ANCHOR_REFRESH_FAILED",
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("/v207-anchor-refresh-marker.ts") ||
  process.argv[1]?.endsWith("/v207-anchor-refresh-marker.js")
) {
  void main();
}
