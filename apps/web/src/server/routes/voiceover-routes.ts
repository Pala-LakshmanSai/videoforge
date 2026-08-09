import type { Hono } from "hono";

import { registeredVoiceoverFrom, voiceoverRegistrationSchema } from "../domain/voiceover-service";
import { fixtureFromRequest } from "../fixture";
import type { FixtureRuntime } from "../fixture-runtime";
import { MAX_REGISTERED_VOICEOVERS_PER_SESSION } from "../fixture-session";
import { canonicalJson, readStrictMetadata } from "../mutation";
import { apiProblem, problemResponse } from "../problem";

export function registerVoiceoverRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.post("/api/v1/voiceovers/register", (c) =>
    runtime.mutation(c, false, (rawBody, state) => {
      const resolved = fixtureFromRequest(c.req.raw);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        voiceoverRegistrationSchema,
        "INVALID_VOICEOVER_REGISTRATION",
        "Voiceover registration is invalid",
        "Send exact browser-validated metadata; no audio bytes belong in this request.",
      );
      if (!metadata.ok) return metadata.response;
      const handleHex = metadata.data.asset_id.slice("fixture_voiceover_sha256_".length);
      if (metadata.data.checksum !== `sha256:${handleHex}`) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_CHECKSUM_MISMATCH",
            422,
            "Voiceover handle does not match its checksum",
            "The fixture asset_id SHA-256 suffix must exactly equal the checksum hex digest.",
            false,
          ),
        );
      }
      const voiceover = registeredVoiceoverFrom(metadata.data);
      const existing = state.registeredVoiceovers.get(voiceover.assetId);
      if (existing && canonicalJson(existing) !== canonicalJson(voiceover)) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_REGISTRATION_CONFLICT",
            409,
            "Voiceover handle is already registered differently",
            "A checksum-bound fixture handle is immutable; use a new handle for different metadata.",
            false,
          ),
        );
      }
      if (!existing && state.registeredVoiceovers.size >= MAX_REGISTERED_VOICEOVERS_PER_SESSION) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_REGISTRATION_CAPACITY_EXCEEDED",
            429,
            "Fixture voiceover capacity is full",
            "Reset this local fixture session before registering another synthetic voiceover.",
            false,
          ),
        );
      }
      state.registeredVoiceovers.set(voiceover.assetId, voiceover);
      return c.json(
        { ok: true as const, voiceover, synthetic: true as const },
        existing ? 200 : 201,
      );
    }),
  );

  app.get("/api/v1/voiceovers/:assetId", (c) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    const voiceover = session.state.registeredVoiceovers.get(c.req.param("assetId"));
    if (!voiceover) {
      return problemResponse(
        apiProblem(
          "VOICEOVER_ASSET_NOT_FOUND",
          404,
          "Registered voiceover was not found",
          "Register the browser-validated voiceover metadata before requesting its status.",
          false,
        ),
      );
    }
    return c.json(voiceover);
  });
}
