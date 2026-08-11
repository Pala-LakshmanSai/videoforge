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

export interface FixtureSessionState {
  readonly idempotencyLedger: import("../mutation").IdempotencyLedger;
  readonly runtimeProjects: RuntimeProjects;
  readonly registeredVoiceovers: Map<string, RegisteredVoiceover>;
  readonly createdAvatars: AvatarProfileResponse[];
  readonly createdStyles: ImageStyleResponse[];
  readonly styleDrafts: Map<string, FixtureStyleDraft>;
  createdProjectRequest: CreateProjectRequest | null;
  avatarSequence: number;
  styleSequence: number;
}
