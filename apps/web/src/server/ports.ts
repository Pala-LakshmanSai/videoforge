/**
 * Storage and execution seams used by the server domain layer.
 *
 * Wave 1 deliberately defines capabilities without choosing production
 * persistence, artifact, or worker wire formats. Later modes bind their
 * versioned contract payloads through these generic ports.
 */
export interface ProjectStatePort<Scope, Project> {
  list(scope: Scope): Promise<readonly Project[]>;
  get(scope: Scope, projectId: string): Promise<Project | null>;
  put(scope: Scope, project: Project): Promise<void>;
  compareAndPut(
    scope: Scope,
    projectId: string,
    expectedVersion: string,
    project: Project,
  ): Promise<boolean>;
}

export interface ArtifactMetadataPort<Metadata> {
  get(artifactId: string): Promise<Metadata | null>;
  put(artifactId: string, metadata: Metadata): Promise<void>;
}

export interface WorkerTransportPort<Job, Receipt> {
  dispatch(job: Job): Promise<Receipt>;
  cancel(executionId: string): Promise<void>;
}

export interface ClockPort {
  nowIso(): string;
}

export interface IdGeneratorPort {
  nextId(namespace: string): string;
}
