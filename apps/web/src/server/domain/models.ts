import type { CreateProjectRequest } from "@videoforge/contracts/create-project";
import type { ImageStyleProfileDocument } from "@videoforge/contracts";
import type {
  AvatarProfileResponse,
  FixtureProjectDetailResponse,
  FixtureScenarioId,
  ImageStyleResponse,
  ProjectSummaryResponse,
} from "@videoforge/test-fixtures";

export interface ProjectPins {
  avatarProfileVersionId: string | null;
  imageStyleVersionId: string;
}

export type RuntimeProjectSummary = ProjectSummaryResponse & {
  revisionId: string;
  versionToken: string;
  pins: ProjectPins;
};

export type RuntimeProjectDetail = Omit<FixtureProjectDetailResponse, "project"> & {
  project: RuntimeProjectSummary;
};

export type RuntimeProjects = Map<FixtureScenarioId, Map<string, RuntimeProjectDetail>>;

export interface RegisteredVoiceover {
  assetId: string;
  checksum: string;
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  verificationState: "VERIFIED";
  persistedBytes: false;
  providerCallsAuthorized: false;
}

export interface FixtureStyleDraftReference {
  readonly referenceId: string;
  readonly filename: string;
  readonly orderIndex: number;
  readonly originalChecksum: string;
  readonly normalizedChecksum: string;
  readonly width: number;
  readonly height: number;
  readonly normalizedBytes: Uint8Array;
}

export interface FixtureStyleDraft {
  readonly styleId: string;
  readonly versionId: string;
  readonly name: string;
  state: "DRAFT" | "REFERENCES_READY" | "NEEDS_REVIEW" | "PUBLISHED" | "ARCHIVED";
  revision: number;
  authorityHash: `sha256:${string}`;
  references: FixtureStyleDraftReference[];
  profile: ImageStyleProfileDocument | null;
  profileHash: `sha256:${string}` | null;
}

/**
 * A fixture avatar source is intentionally retained only inside its owning fixture session.
 * The byte payload never crosses the catalog/bootstrap response boundary; callers receive a
 * tenant-checked preview URL instead.
 */
export interface FixtureAvatarSource {
  readonly profileId: string;
  readonly versionId: string;
  readonly filename: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly checksum: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface FixtureSessionState {
  readonly idempotencyLedger: import("../mutation").IdempotencyLedger;
  readonly runtimeProjects: RuntimeProjects;
  readonly registeredVoiceovers: Map<string, RegisteredVoiceover>;
  readonly createdAvatars: AvatarProfileResponse[];
  readonly avatarSources: Map<string, FixtureAvatarSource>;
  readonly createdStyles: ImageStyleResponse[];
  readonly styleDrafts: Map<string, FixtureStyleDraft>;
  createdProjectRequest: CreateProjectRequest | null;
  avatarSequence: number;
  styleSequence: number;
}
