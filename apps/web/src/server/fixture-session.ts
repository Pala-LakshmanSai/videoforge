import type { Context } from "hono";

import type { FixtureAvatarSource, FixtureSessionState } from "./domain/models";
import { apiProblem, problemResponse } from "./problem";
import type { SharedAppPersistence } from "./shared-app-persistence";

export const FIXTURE_SESSION_HEADER = "x-videoforge-fixture-session";
export const MAX_REGISTERED_VOICEOVERS_PER_SESSION = 128;
export const MAX_CREATED_AVATARS_PER_SESSION = 64;
export const MAX_CREATED_STYLES_PER_SESSION = 64;

const DEFAULT_FIXTURE_SESSION_ID = "default";
const MAX_FIXTURE_SESSION_ID_LENGTH = 96;
const MAX_FIXTURE_SESSION_NAMESPACES = 256;
const FIXTURE_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,95})$/u;
const AVATAR_SOURCE_CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const AVATAR_SOURCE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PERSISTED_AVATAR_SOURCE_BYTES = 20_000_000;
const FIXTURE_SESSION_STORAGE_SCHEMA = "videoforge.fixture-avatar-sessions/v1" as const;

export type FixtureSessionResolution =
  | { ok: true; id: string; state: FixtureSessionState }
  | { ok: false; response: Response };

function createFixtureSessionState(): FixtureSessionState {
  return {
    idempotencyLedger: new Map(),
    runtimeProjects: new Map(),
    registeredVoiceovers: new Map(),
    createdAvatars: [],
    avatarSources: new Map(),
    createdStyles: [],
    styleDrafts: new Map(),
    createdProjectRequest: null,
    avatarSequence: 0,
    styleSequence: 0,
  };
}

interface PersistedAvatarSource {
  readonly profileId: string;
  readonly versionId: string;
  readonly filename: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly checksum: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly bytesBase64: string;
}

interface PersistedFixtureSession {
  readonly id: string;
  readonly avatarSequence: number;
  readonly createdAvatars: FixtureSessionState["createdAvatars"];
  readonly avatarSources: PersistedAvatarSource[];
}

interface PersistedFixtureSessionSnapshot {
  readonly schema: typeof FIXTURE_SESSION_STORAGE_SCHEMA;
  readonly sessions: PersistedFixtureSession[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error("Fixture avatar storage contains invalid base64.");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Fixture avatar storage contains invalid base64.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > MAX_PERSISTED_AVATAR_SOURCE_BYTES) {
    throw new Error("Fixture avatar storage contains an oversized source.");
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function parsePersistedSource(value: unknown): FixtureAvatarSource {
  if (!isRecord(value)) throw new Error("Fixture avatar storage contains an invalid source.");
  const mediaType = value.mediaType;
  const checksum = value.checksum;
  const width = value.width;
  const height = value.height;
  if (
    typeof value.profileId !== "string" ||
    typeof value.versionId !== "string" ||
    typeof value.filename !== "string" ||
    typeof mediaType !== "string" ||
    !AVATAR_SOURCE_MEDIA_TYPES.has(mediaType) ||
    typeof checksum !== "string" ||
    !AVATAR_SOURCE_CHECKSUM.test(checksum) ||
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width < 1 ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    typeof value.bytesBase64 !== "string"
  ) {
    throw new Error("Fixture avatar storage contains an invalid source.");
  }
  return {
    profileId: value.profileId,
    versionId: value.versionId,
    filename: value.filename,
    mediaType: mediaType as FixtureAvatarSource["mediaType"],
    checksum: checksum as FixtureAvatarSource["checksum"],
    width,
    height,
    bytes: decodeBase64(value.bytesBase64),
  };
}

function parsePersistedSnapshot(snapshot: string): PersistedFixtureSessionSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot) as unknown;
  } catch {
    throw new Error("Fixture avatar storage is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema !== FIXTURE_SESSION_STORAGE_SCHEMA) {
    throw new Error("Fixture avatar storage schema is unsupported.");
  }
  if (!Array.isArray(parsed.sessions) || parsed.sessions.length > MAX_FIXTURE_SESSION_NAMESPACES) {
    throw new Error("Fixture avatar storage has an invalid session list.");
  }
  const sessions: PersistedFixtureSession[] = [];
  const ids = new Set<string>();
  for (const value of parsed.sessions) {
    if (!isRecord(value)) throw new Error("Fixture avatar storage contains an invalid session.");
    const id = value.id;
    const avatarSequence = value.avatarSequence;
    const createdAvatars = value.createdAvatars;
    const avatarSources = value.avatarSources;
    if (
      typeof id !== "string" ||
      !FIXTURE_SESSION_ID.test(id) ||
      ids.has(id) ||
      typeof avatarSequence !== "number" ||
      !Number.isSafeInteger(avatarSequence) ||
      avatarSequence < 0 ||
      !Array.isArray(createdAvatars) ||
      !Array.isArray(avatarSources)
    ) {
      throw new Error("Fixture avatar storage contains an invalid session.");
    }
    ids.add(id);
    const sources = avatarSources.map(parsePersistedSource);
    const sourceVersions = new Set<string>();
    for (const source of sources) {
      if (sourceVersions.has(source.versionId)) {
        throw new Error("Fixture avatar storage contains duplicate source versions.");
      }
      sourceVersions.add(source.versionId);
    }
    sessions.push({
      id,
      avatarSequence,
      createdAvatars: structuredClone(createdAvatars) as FixtureSessionState["createdAvatars"],
      avatarSources: sources.map((source) => ({
        profileId: source.profileId,
        versionId: source.versionId,
        filename: source.filename,
        mediaType: source.mediaType,
        checksum: source.checksum,
        width: source.width,
        height: source.height,
        bytesBase64: encodeBase64(source.bytes),
      })),
    });
  }
  return { schema: FIXTURE_SESSION_STORAGE_SCHEMA, sessions };
}

export class FixtureSessionStore {
  readonly #environment: string;
  readonly #persistence: SharedAppPersistence | undefined;
  readonly #sessions = new Map<string, FixtureSessionState>();
  readonly #requestSessions = new WeakMap<
    Request,
    Extract<FixtureSessionResolution, { ok: true }>
  >();

  constructor(environment: string, persistence?: SharedAppPersistence) {
    this.#environment = environment;
    this.#persistence = persistence;
    this.restore(persistence?.read() ?? null);
  }

  private restore(snapshot: string | null): void {
    if (snapshot === null) return;
    const persisted = parsePersistedSnapshot(snapshot);
    for (const stored of persisted.sessions) {
      const state = createFixtureSessionState();
      state.createdAvatars.push(...stored.createdAvatars);
      state.avatarSequence = stored.avatarSequence;
      for (const source of stored.avatarSources) {
        const restored = parsePersistedSource(source);
        const profile = state.createdAvatars.find(
          (candidate) =>
            candidate.id === restored.profileId && candidate.versionId === restored.versionId,
        );
        if (!profile) throw new Error("Fixture avatar storage source has no owning profile.");
        state.avatarSources.set(restored.versionId, restored);
      }
      this.#sessions.set(stored.id, state);
    }
  }

  /** Persist only private fixture avatar records; no catalog response includes source bytes. */
  persist(): void {
    if (!this.#persistence) return;
    const snapshot: PersistedFixtureSessionSnapshot = {
      schema: FIXTURE_SESSION_STORAGE_SCHEMA,
      sessions: [...this.#sessions.entries()].map(([id, state]) => ({
        id,
        avatarSequence: state.avatarSequence,
        createdAvatars: structuredClone(state.createdAvatars),
        avatarSources: [...state.avatarSources.values()].map((source) => ({
          profileId: source.profileId,
          versionId: source.versionId,
          filename: source.filename,
          mediaType: source.mediaType,
          checksum: source.checksum,
          width: source.width,
          height: source.height,
          bytesBase64: encodeBase64(source.bytes),
        })),
      })),
    };
    this.#persistence.write(JSON.stringify(snapshot));
  }

  resolve(c: Context): FixtureSessionResolution {
    const cached = this.#requestSessions.get(c.req.raw);
    if (cached) return cached;

    const requestedId = c.req.header(FIXTURE_SESSION_HEADER);
    if (this.#environment === "production" && requestedId !== undefined) {
      return {
        ok: false,
        response: problemResponse(
          apiProblem(
            "FIXTURE_SESSION_NOT_AVAILABLE",
            400,
            "Fixture sessions are unavailable",
            "The fixture-session header is accepted only by development and test servers.",
            false,
          ),
        ),
      };
    }

    const sessionId = requestedId ?? DEFAULT_FIXTURE_SESSION_ID;
    if (
      sessionId.length === 0 ||
      sessionId.length > MAX_FIXTURE_SESSION_ID_LENGTH ||
      !FIXTURE_SESSION_ID.test(sessionId)
    ) {
      return {
        ok: false,
        response: problemResponse(
          apiProblem(
            "INVALID_FIXTURE_SESSION",
            400,
            "Fixture session is invalid",
            `Use 1-${MAX_FIXTURE_SESSION_ID_LENGTH} ASCII letters, numbers, dots, underscores, colons, or hyphens; the first character must be alphanumeric.`,
            false,
          ),
        ),
      };
    }

    let state = this.#sessions.get(sessionId);
    if (!state) {
      if (this.#sessions.size >= MAX_FIXTURE_SESSION_NAMESPACES) {
        return {
          ok: false,
          response: problemResponse(
            apiProblem(
              "FIXTURE_SESSION_CAPACITY_EXCEEDED",
              429,
              "Fixture session capacity is full",
              "Restart the local fixture server to clear completed isolated test sessions.",
              true,
            ),
          ),
        };
      }
      state = createFixtureSessionState();
      this.#sessions.set(sessionId, state);
    }
    const resolution = { ok: true as const, id: sessionId, state };
    this.#requestSessions.set(c.req.raw, resolution);
    return resolution;
  }

  reset(sessionId: string): void {
    this.#sessions.set(sessionId, createFixtureSessionState());
    this.persist();
  }

  resetAll(): void {
    this.#sessions.clear();
    this.persist();
  }
}
