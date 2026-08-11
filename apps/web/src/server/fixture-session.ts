import type { Context } from "hono";

import type { FixtureSessionState } from "./domain/models";
import { apiProblem, problemResponse } from "./problem";

export const FIXTURE_SESSION_HEADER = "x-videoforge-fixture-session";
export const MAX_REGISTERED_VOICEOVERS_PER_SESSION = 128;
export const MAX_CREATED_AVATARS_PER_SESSION = 64;
export const MAX_CREATED_STYLES_PER_SESSION = 64;

const DEFAULT_FIXTURE_SESSION_ID = "default";
const MAX_FIXTURE_SESSION_ID_LENGTH = 96;
const MAX_FIXTURE_SESSION_NAMESPACES = 256;
const FIXTURE_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,95})$/u;

export type FixtureSessionResolution =
  | { ok: true; id: string; state: FixtureSessionState }
  | { ok: false; response: Response };

function createFixtureSessionState(): FixtureSessionState {
  return {
    idempotencyLedger: new Map(),
    runtimeProjects: new Map(),
    registeredVoiceovers: new Map(),
    createdAvatars: [],
    createdStyles: [],
    styleDrafts: new Map(),
    createdProjectRequest: null,
    avatarSequence: 0,
    styleSequence: 0,
  };
}

export class FixtureSessionStore {
  readonly #environment: string;
  readonly #sessions = new Map<string, FixtureSessionState>();
  readonly #requestSessions = new WeakMap<
    Request,
    Extract<FixtureSessionResolution, { ok: true }>
  >();

  constructor(environment: string) {
    this.#environment = environment;
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
  }
}
