import { describe, expect, it } from "vitest";

import {
  parseAvatarCreateMutationResponse,
  parseProjectCreateMutationResponse,
  parseProjectPreflightMutationResponse,
  parseVoiceoverRegistrationMutationResponse,
} from "./api-schemas.hosted";

describe("hosted production response-schema boundary", () => {
  it.each([
    parseAvatarCreateMutationResponse,
    parseProjectCreateMutationResponse,
    parseProjectPreflightMutationResponse,
    parseVoiceoverRegistrationMutationResponse,
  ])("fails closed when a fixture parser is reached", (parse) => {
    expect(() => parse({})).toThrow("Fixture response schemas are unavailable");
  });
});
