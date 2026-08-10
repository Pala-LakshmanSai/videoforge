import type { ArtifactRepository } from "./artifacts.js";
import type { EventRepository } from "./events.js";
import type { ExecutionRepository } from "./execution.js";
import type { IdentityRepository } from "./identity.js";
import type { AvatarProfileRepository, ImageStyleRepository } from "./presets.js";
import type { ProjectRepository } from "./projects.js";
import type { TimingRepository } from "./timing.js";
import type { RepositoryResult, WorkspaceScope } from "./types.js";

/** Repositories bound to one connection/transaction context by the adapter. */
export interface RepositorySession {
  readonly identity: IdentityRepository;
  readonly avatarProfiles: AvatarProfileRepository;
  readonly imageStyles: ImageStyleRepository;
  readonly projects: ProjectRepository;
  readonly timing: TimingRepository;
  readonly artifacts: ArtifactRepository;
  readonly execution: ExecutionRepository;
  readonly events: EventRepository;
}

export type RepositoryTransactionWork<
  Value,
  ConflictCode extends string,
  MissingEntity extends string,
  InvariantCode extends string,
> = (
  repositories: RepositorySession,
) => Promise<RepositoryResult<Value, ConflictCode, MissingEntity, InvariantCode>>;

export interface RepositoryUnitOfWork {
  /**
   * Commits only an `ok: true` result. Any typed failure or thrown infrastructure error rolls the
   * transaction back, including attempt/cost/outbox inserts already performed by the callback.
   */
  execute<
    Value,
    ConflictCode extends string = string,
    MissingEntity extends string = string,
    InvariantCode extends string = string,
  >(
    scope: WorkspaceScope,
    work: RepositoryTransactionWork<Value, ConflictCode, MissingEntity, InvariantCode>,
  ): Promise<RepositoryResult<Value, ConflictCode, MissingEntity, InvariantCode>>;
}

export interface ControlPlaneRepositories extends RepositorySession {
  readonly unitOfWork: RepositoryUnitOfWork;
}
