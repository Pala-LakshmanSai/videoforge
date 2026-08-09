import { describe, expect, it } from "vitest";

import {
  parseProjectCreateMutationResponse,
  parseVoiceoverRegistrationMutationResponse,
} from "./api-schemas";

const projectCreateResponse = {
  ok: true,
  id: "project_fixture_001",
  revisionId: "revision_fixture_001",
  status: "QUEUED",
  fixture: "project_create_ready",
  nextFixture: "happy_generating",
  pins: {
    avatarProfileVersionId: "avatar_profile_version_fixture_001",
    imageStyleVersionId: "style_version_documentary_stock_v1",
  },
  providerCallsAuthorized: false,
  versionToken: '"vf-project_fixture_001-revision_fixture_001-v1"',
};

describe("mutation response validation", () => {
  it("accepts the exact project-create response contract", () => {
    expect(parseProjectCreateMutationResponse(projectCreateResponse)).toEqual(
      projectCreateResponse,
    );
  });

  it("rejects extra fields and malformed concurrency tokens", () => {
    expect(() =>
      parseProjectCreateMutationResponse({
        ...projectCreateResponse,
        providerKey: "must-not-leak",
      }),
    ).toThrow();
    expect(() =>
      parseProjectCreateMutationResponse({ ...projectCreateResponse, versionToken: "fixture-v1" }),
    ).toThrow();
  });

  it("binds registered voiceover handles to strict verified metadata", () => {
    const hex = "a".repeat(64);
    const response = {
      ok: true,
      synthetic: true,
      voiceover: {
        assetId: `fixture_voiceover_sha256_${hex}`,
        checksum: `sha256:${hex}`,
        filename: "voiceover.wav",
        durationSeconds: 10.25,
        sampleRate: 48_000,
        channels: 1,
        verificationState: "VERIFIED",
        persistedBytes: false,
        providerCallsAuthorized: false,
      },
    };
    expect(parseVoiceoverRegistrationMutationResponse(response)).toEqual(response);
    expect(() =>
      parseVoiceoverRegistrationMutationResponse({
        ...response,
        voiceover: { ...response.voiceover, providerCallsAuthorized: true },
      }),
    ).toThrow();
    expect(() =>
      parseVoiceoverRegistrationMutationResponse({
        ...response,
        voiceover: { ...response.voiceover, checksum: `sha256:${"b".repeat(64)}` },
      }),
    ).toThrow();
  });
});
