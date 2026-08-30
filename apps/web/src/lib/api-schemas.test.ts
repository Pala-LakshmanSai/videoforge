import {
  getFixtureScenario,
  toAvatarProfileResponse,
  toProjectDetailResponse,
} from "@videoforge/test-fixtures";
import { describe, expect, it } from "vitest";

import {
  parseHealthResponse,
  parseAvatarsResponse,
  parseProjectCreateMutationResponse,
  parseProjectResponse,
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

function readyProjectDetail() {
  const scenario = getFixtureScenario("project_ready_for_review");
  const detail = scenario ? toProjectDetailResponse(scenario) : null;
  if (!detail) throw new Error("Required project fixture is unavailable.");
  return {
    ...detail,
    project: {
      ...detail.project,
      revisionId: "revision_fixture_001",
      versionToken: '"vf-project_fixture_001-revision_fixture_001-v1"',
      pins: {
        avatarProfileVersionId: "avatar_profile_version_fixture_001",
        imageStyleVersionId: "style_version_documentary_stock_v1",
      },
    },
  };
}

describe("mutation response validation", () => {
  it("accepts the exact project-create response contract", () => {
    expect(parseProjectCreateMutationResponse(projectCreateResponse)).toEqual(
      projectCreateResponse,
    );
  });

  it("accepts only fixture or tenant-checked avatar preview paths", () => {
    const scenario = getFixtureScenario("avatar_profile_ready");
    const source = scenario?.snapshot.avatarHub.profiles[0];
    if (!source) throw new Error("Required avatar fixture is unavailable.");
    const fixtureProfile = toAvatarProfileResponse(source);
    const previewProfile = {
      ...fixtureProfile,
      thumbnailUrl:
        "/api/v1/avatar-profiles/avatar_profile_fixture_created_001/versions/avatar_profile_version_fixture_created_001/preview",
    };

    expect(parseAvatarsResponse([fixtureProfile, previewProfile])).toHaveLength(2);
    expect(() =>
      parseAvatarsResponse([
        { ...fixtureProfile, thumbnailUrl: "https://untrusted.example/avatar.png" },
      ]),
    ).toThrow();
    expect(() =>
      parseAvatarsResponse([
        { ...fixtureProfile, thumbnailUrl: "/api/v1/avatar-profiles/profile/preview?fixture=x" },
      ]),
    ).toThrow();
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
    expect(
      parseVoiceoverRegistrationMutationResponse({
        ...response,
        voiceover: { ...response.voiceover, persistedBytes: true },
      }).voiceover.persistedBytes,
    ).toBe(true);
  });
});

describe("local response validation", () => {
  it("accepts cross-bound fixture and local health modes", () => {
    const common = {
      app: "videoforge",
      status: "ok",
      commit: "abcdef1",
      synthetic: true,
      provider_calls_authorized: false,
      authorized_spend_usd: 0,
    } as const;

    expect(
      parseHealthResponse({
        ...common,
        mode: "fixture",
        fixture_id: "project_ready_for_review",
      }),
    ).toMatchObject({ mode: "fixture", fixture_id: "project_ready_for_review" });
    expect(parseHealthResponse({ ...common, mode: "local", fixture_id: null })).toMatchObject({
      mode: "local",
      fixture_id: null,
    });
    expect(() =>
      parseHealthResponse({ ...common, mode: "local", fixture_id: "happy_generating" }),
    ).toThrow();
  });

  it("accepts immutable local MP4 facts without widening fixture media URLs", () => {
    const fixtureDetail = readyProjectDetail();
    expect(parseProjectResponse(fixtureDetail)).toEqual(fixtureDetail);

    const localDetail = {
      ...fixtureDetail,
      project: {
        ...fixtureDetail.project,
        id: "project_local_owned_001",
        revisionId: "revision_local_owned_001",
        versionToken: '"vf-project_local_owned_001-revision_local_owned_001-v1"',
        latestArtifact: {
          kind: "VIDEO" as const,
          url: "/api/v1/projects/project_local_owned_001/preview",
          label: "Local synthetic 1080p30 MP4",
          sha256: `sha256:${"a".repeat(64)}`,
          bytes: 42,
          filename: "videoforge-local-owned-slice.mp4",
        },
        review: {
          ...fixtureDetail.project.review,
          downloadUrl: "/api/v1/projects/project_local_owned_001/download",
        },
      },
    };

    expect(parseProjectResponse(localDetail)).toEqual(localDetail);
    expect(() =>
      parseProjectResponse({
        ...localDetail,
        project: {
          ...localDetail.project,
          latestArtifact: {
            ...localDetail.project.latestArtifact,
            url: "https://media.example.invalid/preview.mp4",
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseProjectResponse({
        ...localDetail,
        project: {
          ...localDetail.project,
          latestArtifact: {
            ...localDetail.project.latestArtifact,
            filename: "../escaped.mp4",
          },
        },
      }),
    ).toThrow();
  });
});
