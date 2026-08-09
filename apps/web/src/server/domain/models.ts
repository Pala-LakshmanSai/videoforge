import type { CreateProjectRequest } from "@videoforge/contracts";
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

export interface FixtureSessionState {
  readonly idempotencyLedger: import("../mutation").IdempotencyLedger;
  readonly runtimeProjects: RuntimeProjects;
  readonly registeredVoiceovers: Map<string, RegisteredVoiceover>;
  readonly createdAvatars: AvatarProfileResponse[];
  readonly createdStyles: ImageStyleResponse[];
  createdProjectRequest: CreateProjectRequest | null;
  avatarSequence: number;
  styleSequence: number;
}
