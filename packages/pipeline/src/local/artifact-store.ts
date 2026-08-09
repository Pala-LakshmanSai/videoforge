import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { Sha256Digest } from "@videoforge/contracts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_EXTENSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/u;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/u;
const SHA256 = /^sha256:([0-9a-f]{64})$/u;

export type LocalArtifactStoreErrorCode =
  | "CONTENT_HASH_MISMATCH"
  | "IMMUTABLE_COLLISION"
  | "INVALID_EXTENSION"
  | "INVALID_FILENAME"
  | "INVALID_ID"
  | "INVALID_ROOT"
  | "NOT_FOUND"
  | "PATH_ESCAPE"
  | "SYMLINK_ESCAPE"
  | "UNSAFE_ENTRY";

export class LocalArtifactStoreError extends Error {
  readonly code: LocalArtifactStoreErrorCode;
  readonly target?: string;

  constructor(code: LocalArtifactStoreErrorCode, message: string, target?: string) {
    super(message);
    this.name = "LocalArtifactStoreError";
    this.code = code;
    this.target = target;
  }
}

export interface StoredLocalArtifact {
  readonly sha256: Sha256Digest;
  readonly bytes: number;
  readonly extension: string;
  readonly absolutePath: string;
  readonly created: boolean;
}

export interface ReadLocalArtifact extends StoredLocalArtifact {
  readonly content: Uint8Array;
}

export interface LocalRunLocation {
  readonly revisionId: string;
  readonly attemptId: string;
  readonly absolutePath: string;
}

export interface RetainedLocalRun {
  readonly revisionId: string;
  readonly attemptId: string;
}

export interface LocalCleanupCandidate extends LocalRunLocation {
  readonly bytes: number;
  readonly modifiedAtEpochMs: number;
}

export interface LocalCleanupPlan {
  readonly dryRun: true;
  readonly root: string;
  readonly cutoffEpochMs: number;
  readonly candidates: readonly LocalCleanupCandidate[];
  readonly totalBytes: number;
}

export interface LocalCleanupPlanRequest {
  readonly cutoffEpochMs: number;
  readonly retain?: readonly RetainedLocalRun[];
}

const digestBytes = (bytes: Uint8Array): Sha256Digest =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) {
    return;
  }
  throw new LocalArtifactStoreError(
    "PATH_ESCAPE",
    "The requested artifact path escapes the configured local artifact root.",
    candidate,
  );
}

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) {
    throw new LocalArtifactStoreError(
      "INVALID_ID",
      `${label} must be a non-empty filesystem-safe VideoForge identifier.`,
      value,
    );
  }
  return value;
}

function safeExtension(value: string): string {
  const normalized = value.startsWith(".") ? value.slice(1) : value;
  if (!SAFE_EXTENSION.test(normalized)) {
    throw new LocalArtifactStoreError(
      "INVALID_EXTENSION",
      "Artifact extensions must contain only letters, numbers, dot, underscore, or hyphen.",
      value,
    );
  }
  return normalized.toLowerCase();
}

function safeFilename(value: string): string {
  if (!SAFE_FILENAME.test(value) || value === "." || value === "..") {
    throw new LocalArtifactStoreError(
      "INVALID_FILENAME",
      "Run filenames must be one filesystem-safe basename without traversal or separators.",
      value,
    );
  }
  return value;
}

function digestHex(value: Sha256Digest): string {
  const match = SHA256.exec(value);
  if (!match?.[1]) {
    throw new LocalArtifactStoreError(
      "CONTENT_HASH_MISMATCH",
      "Artifact digests must use the sha256:<64 lowercase hex characters> format.",
      value,
    );
  }
  return match[1];
}

/**
 * Safe local development artifact storage. It has no cleanup mutation API; callers may only
 * request a dry-run cleanup plan and perform any later deletion through a separately reviewed
 * integration boundary.
 */
export class LocalArtifactStore {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(root: string): Promise<LocalArtifactStore> {
    if (!root || !path.isAbsolute(root)) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The local artifact root must be an explicit absolute path.",
        root,
      );
    }

    const lexicalRoot = path.resolve(root);
    if (lexicalRoot === path.parse(lexicalRoot).root) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The filesystem root cannot be used as the local artifact root.",
        lexicalRoot,
      );
    }

    await mkdir(lexicalRoot, { recursive: true, mode: 0o700 });
    const rootInformation = await lstat(lexicalRoot);
    if (rootInformation.isSymbolicLink()) {
      throw new LocalArtifactStoreError(
        "SYMLINK_ESCAPE",
        "The local artifact root itself may not be a symbolic link.",
        lexicalRoot,
      );
    }
    if (!rootInformation.isDirectory()) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The local artifact root must resolve to a directory.",
        lexicalRoot,
      );
    }

    const canonicalRoot = await realpath(lexicalRoot);
    if (canonicalRoot === path.parse(canonicalRoot).root) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The canonical filesystem root cannot be used as the local artifact root.",
        canonicalRoot,
      );
    }
    const store = new LocalArtifactStore(canonicalRoot);
    await store.ensureDirectory(["objects", "sha256"]);
    await store.ensureDirectory(["runs"]);
    return store;
  }

  async putObject(bytes: Uint8Array, extension: string): Promise<StoredLocalArtifact> {
    const stableBytes = Buffer.from(bytes);
    const sha256 = digestBytes(stableBytes);
    const hex = digestHex(sha256);
    const normalizedExtension = safeExtension(extension);
    const directory = await this.ensureDirectory(["objects", "sha256", hex.slice(0, 2)]);
    const destination = path.join(directory, `${hex}.${normalizedExtension}`);
    assertContained(this.root, destination);

    const existing = await this.verifyIfPresent(destination, sha256, normalizedExtension);
    if (existing) return existing;

    const temporary = path.join(directory, `.${hex}.${randomBytes(12).toString("hex")}.tmp`);
    assertContained(this.root, temporary);
    const handle = await open(temporary, "wx", 0o600);
    let handleOpen = true;
    try {
      await handle.writeFile(stableBytes);
      await handle.sync();
      await handle.close();
      handleOpen = false;

      try {
        await link(temporary, destination);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const concurrent = await this.verifyIfPresent(destination, sha256, normalizedExtension);
        if (!concurrent) {
          throw new LocalArtifactStoreError(
            "IMMUTABLE_COLLISION",
            "The immutable artifact destination appeared without valid content.",
            destination,
          );
        }
        return concurrent;
      }
    } finally {
      if (handleOpen) await handle.close().catch(() => undefined);
      await unlink(temporary).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }

    const canonicalDestination = await realpath(destination);
    assertContained(this.root, canonicalDestination);
    return Object.freeze({
      sha256,
      bytes: stableBytes.byteLength,
      extension: normalizedExtension,
      absolutePath: canonicalDestination,
      created: true,
    });
  }

  async verifyObject(sha256: Sha256Digest, extension: string): Promise<StoredLocalArtifact> {
    const verified = await this.readObject(sha256, extension);
    return Object.freeze({
      sha256: verified.sha256,
      bytes: verified.bytes,
      extension: verified.extension,
      absolutePath: verified.absolutePath,
      created: verified.created,
    });
  }

  async readObject(sha256: Sha256Digest, extension: string): Promise<ReadLocalArtifact> {
    const hex = digestHex(sha256);
    const normalizedExtension = safeExtension(extension);
    const directory = await this.ensureDirectory(["objects", "sha256", hex.slice(0, 2)]);
    const destination = path.join(directory, `${hex}.${normalizedExtension}`);
    const verified = await this.readIfPresent(destination, sha256, normalizedExtension);
    if (!verified) {
      throw new LocalArtifactStoreError(
        "NOT_FOUND",
        "The requested content-addressed artifact does not exist.",
        destination,
      );
    }
    return verified;
  }

  async ensureRunDirectory(revisionId: string, attemptId: string): Promise<LocalRunLocation> {
    const safeRevisionId = safeId(revisionId, "revisionId");
    const safeAttemptId = safeId(attemptId, "attemptId");
    const absolutePath = await this.ensureDirectory(["runs", safeRevisionId, safeAttemptId]);
    return Object.freeze({ revisionId: safeRevisionId, attemptId: safeAttemptId, absolutePath });
  }

  async resolveRunFile(revisionId: string, attemptId: string, filename: string): Promise<string> {
    const run = await this.ensureRunDirectory(revisionId, attemptId);
    const candidate = path.join(run.absolutePath, safeFilename(filename));
    assertContained(run.absolutePath, candidate);

    try {
      const information = await lstat(candidate);
      if (information.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Run output paths may not be symbolic links.",
          candidate,
        );
      }
      if (!information.isFile()) {
        throw new LocalArtifactStoreError(
          "UNSAFE_ENTRY",
          "Run output paths may resolve only to regular files.",
          candidate,
        );
      }
      const canonicalCandidate = await realpath(candidate);
      assertContained(run.absolutePath, canonicalCandidate);
      return canonicalCandidate;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return candidate;
      throw error;
    }
  }

  async planRunCleanup(request: LocalCleanupPlanRequest): Promise<LocalCleanupPlan> {
    if (!Number.isFinite(request.cutoffEpochMs) || request.cutoffEpochMs < 0) {
      throw new LocalArtifactStoreError(
        "UNSAFE_ENTRY",
        "Cleanup cutoffEpochMs must be an explicit non-negative finite timestamp.",
      );
    }

    const retained = new Set(
      (request.retain ?? []).map(
        ({ revisionId, attemptId }) =>
          `${safeId(revisionId, "revisionId")}\u0000${safeId(attemptId, "attemptId")}`,
      ),
    );
    const runsRoot = await this.ensureDirectory(["runs"]);
    const candidates: LocalCleanupCandidate[] = [];

    for (const revisionEntry of await readdir(runsRoot, { withFileTypes: true })) {
      const revisionId = safeId(revisionEntry.name, "revisionId");
      const revisionPath = path.join(runsRoot, revisionId);
      await this.assertSafeDirectoryEntry(revisionEntry, revisionPath);

      for (const attemptEntry of await readdir(revisionPath, { withFileTypes: true })) {
        const attemptId = safeId(attemptEntry.name, "attemptId");
        const attemptPath = path.join(revisionPath, attemptId);
        await this.assertSafeDirectoryEntry(attemptEntry, attemptPath);
        if (retained.has(`${revisionId}\u0000${attemptId}`)) continue;

        const information = await stat(attemptPath);
        if (information.mtimeMs >= request.cutoffEpochMs) continue;
        candidates.push(
          Object.freeze({
            revisionId,
            attemptId,
            absolutePath: attemptPath,
            modifiedAtEpochMs: information.mtimeMs,
            bytes: await this.directoryBytes(attemptPath),
          }),
        );
      }
    }

    candidates.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath, "en"));
    return Object.freeze({
      dryRun: true,
      root: this.root,
      cutoffEpochMs: request.cutoffEpochMs,
      candidates: Object.freeze(candidates),
      totalBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
    });
  }

  private async ensureDirectory(segments: readonly string[]): Promise<string> {
    let current = this.root;
    for (const segment of segments) {
      const candidate = path.join(current, segment);
      assertContained(this.root, candidate);
      try {
        const information = await lstat(candidate);
        if (information.isSymbolicLink()) {
          throw new LocalArtifactStoreError(
            "SYMLINK_ESCAPE",
            "Local artifact directories may not be symbolic links.",
            candidate,
          );
        }
        if (!information.isDirectory()) {
          throw new LocalArtifactStoreError(
            "UNSAFE_ENTRY",
            "A local artifact directory path is occupied by a non-directory entry.",
            candidate,
          );
        }
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        await mkdir(candidate, { mode: 0o700 }).catch((mkdirError: unknown) => {
          if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
        });

        const created = await lstat(candidate);
        if (created.isSymbolicLink()) {
          throw new LocalArtifactStoreError(
            "SYMLINK_ESCAPE",
            "Local artifact directories may not be symbolic links.",
            candidate,
          );
        }
        if (!created.isDirectory()) {
          throw new LocalArtifactStoreError(
            "UNSAFE_ENTRY",
            "A local artifact directory path is occupied by a non-directory entry.",
            candidate,
          );
        }
      }

      const canonicalCandidate = await realpath(candidate);
      assertContained(this.root, canonicalCandidate);
      current = canonicalCandidate;
    }
    return current;
  }

  private async verifyIfPresent(
    destination: string,
    expected: Sha256Digest,
    extension: string,
  ): Promise<StoredLocalArtifact | null> {
    const verified = await this.readIfPresent(destination, expected, extension);
    if (!verified) return null;
    return Object.freeze({
      sha256: verified.sha256,
      bytes: verified.bytes,
      extension: verified.extension,
      absolutePath: verified.absolutePath,
      created: verified.created,
    });
  }

  private async readIfPresent(
    destination: string,
    expected: Sha256Digest,
    extension: string,
  ): Promise<ReadLocalArtifact | null> {
    try {
      const information = await lstat(destination);
      if (information.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Content-addressed artifacts may not be symbolic links.",
          destination,
        );
      }
      if (!information.isFile()) {
        throw new LocalArtifactStoreError(
          "IMMUTABLE_COLLISION",
          "The immutable artifact destination is occupied by a non-file entry.",
          destination,
        );
      }

      const canonicalDestination = await realpath(destination);
      assertContained(this.root, canonicalDestination);
      let handle;
      try {
        handle = await open(canonicalDestination, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (errorCode(error) === "ELOOP") {
          throw new LocalArtifactStoreError(
            "SYMLINK_ESCAPE",
            "Content-addressed artifacts may not be symbolic links.",
            canonicalDestination,
          );
        }
        throw error;
      }
      try {
        const openedInformation = await handle.stat();
        if (!openedInformation.isFile()) {
          throw new LocalArtifactStoreError(
            "IMMUTABLE_COLLISION",
            "The immutable artifact destination is occupied by a non-file entry.",
            canonicalDestination,
          );
        }
        const content = await handle.readFile();
        const actual = digestBytes(content);
        if (actual !== expected) {
          throw new LocalArtifactStoreError(
            "CONTENT_HASH_MISMATCH",
            `Stored artifact bytes hash to ${actual}, not ${expected}.`,
            canonicalDestination,
          );
        }
        return {
          sha256: expected,
          bytes: content.byteLength,
          extension,
          absolutePath: canonicalDestination,
          created: false,
          content,
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  private async assertSafeDirectoryEntry(
    entry: { isDirectory(): boolean; isSymbolicLink(): boolean },
    candidate: string,
  ): Promise<void> {
    if (entry.isSymbolicLink()) {
      throw new LocalArtifactStoreError(
        "SYMLINK_ESCAPE",
        "Cleanup planning refuses symbolic-link entries.",
        candidate,
      );
    }
    if (!entry.isDirectory()) {
      throw new LocalArtifactStoreError(
        "UNSAFE_ENTRY",
        "Cleanup planning accepts only revision and attempt directories.",
        candidate,
      );
    }
    const canonicalCandidate = await realpath(candidate);
    assertContained(this.root, canonicalCandidate);
  }

  private async directoryBytes(directory: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Cleanup planning refuses symbolic links anywhere in a run.",
          candidate,
        );
      }
      const canonicalCandidate = await realpath(candidate);
      assertContained(this.root, canonicalCandidate);
      if (entry.isDirectory()) total += await this.directoryBytes(canonicalCandidate);
      else if (entry.isFile()) total += (await stat(canonicalCandidate)).size;
      else {
        throw new LocalArtifactStoreError(
          "UNSAFE_ENTRY",
          "Cleanup planning refuses non-file, non-directory run entries.",
          candidate,
        );
      }
    }
    return total;
  }
}
