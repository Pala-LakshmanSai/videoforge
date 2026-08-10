import type { ContentAddressLookup } from "./artifacts.js";
import type {
  AcceptSuccessfulResultCommand,
  AtomicTaskAttemptReservation,
  RecordDispatchAcknowledgedCommand,
  RecordDispatchAckUnknownCommand,
  RecordSuccessfulAttemptCommand,
  RecordUnknownAttemptCommand,
  RequestAttemptCancellationCommand,
  RequestTaskOnlyCancellationCommand,
  ReserveTaskAttemptCommand,
  TaskLookup,
} from "./execution.js";
import type {
  AppendCostEventCommand,
  AppendWorkflowEventCommand,
  CostEventListQuery,
  WorkflowEventListQuery,
} from "./events.js";
import type { MembershipLookup } from "./identity.js";
import type {
  BeginAvatarCompatibilityTestCommand,
  BeginImageStyleAnalysisCommand,
  ExactAvatarVersionLookup,
  ExactImageStyleVersionLookup,
  PublishAvatarVersionCommand,
  PublishImageStyleVersionCommand,
  SaveAvatarDraftCommand,
  SaveImageStyleDraftCommand,
} from "./presets.js";
import type {
  ArchiveProjectCommand,
  CreateProjectRevisionDraftCommand,
  ExactProjectRevisionLookup,
  LockProjectRevisionCommand,
} from "./projects.js";
import type {
  EntityId,
  DurableOwner,
  IdempotentRepositoryResult,
  IdempotentWrite,
  WorkspaceActorScope,
} from "./types.js";
import type { ControlPlaneRepositories } from "./unit-of-work.js";

const REPOSITORY_CONTRACT_BEHAVIOR_DEFINITIONS = [
  {
    id: "explicit-workspace-isolation",
    description: "Cross-workspace reads and parent/child bindings never leak or attach records.",
  },
  {
    id: "membership-authorization",
    description: "Authentication lookup resolves only a membership in the explicit workspace.",
  },
  {
    id: "avatar-publication-immutability",
    description:
      "Only READY publication moves the active pointer and the published payload is immutable.",
  },
  {
    id: "style-publication-immutability",
    description:
      "Only PUBLISHED publication moves the active pointer and the published payload is immutable.",
  },
  {
    id: "revision-lock-immutability",
    description: "Lock validates every pinned hash and rejects later revision mutation.",
  },
  {
    id: "content-address-binding",
    description: "Binary and canonical-document hashes remain distinct and workspace scoped.",
  },
  {
    id: "atomic-task-attempt-reservation",
    description:
      "General and billed-preset task, attempt, reservation, and dispatch rows commit together.",
  },
  {
    id: "reservation-idempotency",
    description:
      "Stable retry keys replay identical writes and reject different input fingerprints.",
  },
  {
    id: "dispatch-ambiguity-is-not-completion",
    description:
      "Acknowledgement, ambiguity, UNKNOWN, and cancellation never become accepted completion.",
  },
  {
    id: "one-accepted-result",
    description:
      "Duplicate attempts remain visible while exactly one repository-issued result is accepted.",
  },
  {
    id: "append-only-monotonic-events",
    description: "Workflow and cost ledgers reject mutation and non-monotonic sequences.",
  },
  {
    id: "unit-of-work-rollback",
    description: "Typed failures and thrown faults leave no orphan durable rows or retry records.",
  },
  {
    id: "archive-preserves-lineage",
    description: "Soft archive blocks new revisions without destroying historical lineage.",
  },
] as const;

export const REPOSITORY_CONTRACT_BEHAVIORS = Object.freeze(
  REPOSITORY_CONTRACT_BEHAVIOR_DEFINITIONS.map((behavior) => Object.freeze(behavior)),
) as unknown as typeof REPOSITORY_CONTRACT_BEHAVIOR_DEFINITIONS;

export type RepositoryContractBehavior = (typeof REPOSITORY_CONTRACT_BEHAVIORS)[number];
export type RepositoryContractBehaviorId = RepositoryContractBehavior["id"];

interface RepositoryContractFixtureBase<BehaviorId extends RepositoryContractBehaviorId> {
  readonly behaviorId: BehaviorId;
  readonly primaryScope: WorkspaceActorScope;
  readonly secondaryScope: WorkspaceActorScope;
}

export interface WorkspaceIsolationContractFixture
  extends RepositoryContractFixtureBase<"explicit-workspace-isolation"> {
  readonly revisionLookup: ExactProjectRevisionLookup;
}

export interface MembershipAuthorizationContractFixture
  extends RepositoryContractFixtureBase<"membership-authorization"> {
  readonly memberLookup: MembershipLookup;
}

export interface AvatarPublicationContractFixture
  extends RepositoryContractFixtureBase<"avatar-publication-immutability"> {
  readonly publish: PublishAvatarVersionCommand;
  readonly lookup: ExactAvatarVersionLookup;
  readonly mutatePublished: SaveAvatarDraftCommand;
}

export interface StylePublicationContractFixture
  extends RepositoryContractFixtureBase<"style-publication-immutability"> {
  readonly publish: PublishImageStyleVersionCommand;
  readonly lookup: ExactImageStyleVersionLookup;
  readonly mutatePublished: SaveImageStyleDraftCommand;
}

export interface RevisionLockContractFixture
  extends RepositoryContractFixtureBase<"revision-lock-immutability"> {
  readonly lock: LockProjectRevisionCommand;
  readonly lookup: ExactProjectRevisionLookup;
  readonly relock: LockProjectRevisionCommand;
}

export interface ContentAddressContractFixture
  extends RepositoryContractFixtureBase<"content-address-binding"> {
  readonly assetId: EntityId;
  readonly binaryLookup: ContentAddressLookup & { readonly kind: "BINARY" };
  readonly canonicalLookup: ContentAddressLookup & { readonly kind: "CANONICAL_DOCUMENT" };
}

export interface AtomicReservationContractFixture
  extends RepositoryContractFixtureBase<"atomic-task-attempt-reservation"> {
  readonly reservation: ReserveTaskAttemptCommand;
  /** Same logical write/IDs as styleAnalysis, but with a deliberately mismatched owner version. */
  readonly invalidStyleAnalysis: BeginImageStyleAnalysisCommand;
  readonly styleAnalysis: BeginImageStyleAnalysisCommand;
  /** Same logical write/IDs as avatarCompatibilityTest, but with a mismatched owner version. */
  readonly invalidAvatarCompatibilityTest: BeginAvatarCompatibilityTestCommand;
  readonly avatarCompatibilityTest: BeginAvatarCompatibilityTestCommand;
}

export interface ReservationIdempotencyContractFixture
  extends RepositoryContractFixtureBase<"reservation-idempotency"> {
  readonly reservation: ReserveTaskAttemptCommand;
  /** Same command key, deliberately different fingerprint. */
  readonly changedReservation: ReserveTaskAttemptCommand;
}

export interface DispatchAmbiguityContractFixture
  extends RepositoryContractFixtureBase<"dispatch-ambiguity-is-not-completion"> {
  readonly acknowledged: RecordDispatchAcknowledgedCommand;
  readonly acknowledgementUnknown: RecordDispatchAckUnknownCommand;
  readonly unknownAttempt: RecordUnknownAttemptCommand;
  readonly taskOnlyCancellation: RequestTaskOnlyCancellationCommand;
  readonly attemptCancellation: RequestAttemptCancellationCommand;
}

export type AcceptanceCommandWithoutReference = Omit<
  AcceptSuccessfulResultCommand,
  "candidateReference"
>;

export interface AcceptedResultContractFixture
  extends RepositoryContractFixtureBase<"one-accepted-result"> {
  readonly firstResult: RecordSuccessfulAttemptCommand;
  readonly secondResult: RecordSuccessfulAttemptCommand;
  readonly firstAcceptance: AcceptanceCommandWithoutReference;
  readonly secondAcceptance: AcceptanceCommandWithoutReference;
}

export interface AppendOnlyEventsContractFixture
  extends RepositoryContractFixtureBase<"append-only-monotonic-events"> {
  readonly workflowEvent: AppendWorkflowEventCommand;
  /** Same event ID with a new idempotency key and changed payload/fingerprint. */
  readonly changedWorkflowEvent: AppendWorkflowEventCommand;
  readonly nonMonotonicWorkflowEvent: AppendWorkflowEventCommand;
  readonly workflowList: WorkflowEventListQuery;
  readonly costEvent: AppendCostEventCommand;
  readonly nonMonotonicCostEvent: AppendCostEventCommand;
  readonly costList: CostEventListQuery;
}

export interface UnitOfWorkRollbackContractFixture
  extends RepositoryContractFixtureBase<"unit-of-work-rollback"> {
  readonly typedFailureReservation: ReserveTaskAttemptCommand;
  readonly thrownFailureReservation: ReserveTaskAttemptCommand;
}

export interface ArchiveLineageContractFixture
  extends RepositoryContractFixtureBase<"archive-preserves-lineage"> {
  readonly archive: ArchiveProjectCommand;
  readonly historicalRevision: ExactProjectRevisionLookup;
  readonly historicalTask: TaskLookup;
  readonly newRevision: CreateProjectRevisionDraftCommand;
}

/** Raw setup data only: adapters cannot provide callbacks, assertions, or replacement outcomes. */
export type RepositoryContractFixture =
  | WorkspaceIsolationContractFixture
  | MembershipAuthorizationContractFixture
  | AvatarPublicationContractFixture
  | StylePublicationContractFixture
  | RevisionLockContractFixture
  | ContentAddressContractFixture
  | AtomicReservationContractFixture
  | ReservationIdempotencyContractFixture
  | DispatchAmbiguityContractFixture
  | AcceptedResultContractFixture
  | AppendOnlyEventsContractFixture
  | UnitOfWorkRollbackContractFixture
  | ArchiveLineageContractFixture;

/** Each adapter factory returns fresh, pre-seeded, synthetic workspace state for one scenario. */
export interface RepositoryContractAdapter {
  readonly repositories: ControlPlaneRepositories;
  readonly fixture: RepositoryContractFixture;
  dispose(): Promise<void>;
}

export interface RepositoryContractAdapterFactory {
  create(behavior: RepositoryContractBehavior): Promise<RepositoryContractAdapter>;
}

export interface RepositoryContractScenarioContext {
  readonly behavior: RepositoryContractBehavior;
  readonly repositories: ControlPlaneRepositories;
  readonly fixture: RepositoryContractFixture;
}

export interface RepositoryContractScenario {
  readonly behaviorId: RepositoryContractBehaviorId;
  run(context: RepositoryContractScenarioContext): Promise<void>;
}

/** Compatible with node:test, Vitest, or any runner that can register an async test callback. */
export interface RepositoryContractRegistrar {
  test(name: string, run: () => Promise<void>): void;
}

export interface RepositoryContractSuiteOptions {
  readonly name?: string;
}

type ContractFailure = {
  readonly ok: false;
  readonly kind: string;
  readonly code?: string;
  readonly entity?: string;
};
type ContractResult<Value> = { readonly ok: true; readonly value: Value } | ContractFailure;

export class RepositoryContractAssertionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryContractAssertionError";
  }
}

function assertContract(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new RepositoryContractAssertionError(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  assertContract(Object.is(actual, expected), `${message}: expected ${String(expected)}`);
}

function expectSuccess<Value>(result: ContractResult<Value>, operation: string): Value {
  if (!result.ok) {
    throw new RepositoryContractAssertionError(
      `${operation} failed with ${result.kind}${result.code === undefined ? "" : `/${result.code}`}`,
    );
  }
  return result.value;
}

function expectWrite<Value>(
  result: IdempotentRepositoryResult<Value, string, string, string>,
  operation: string,
): IdempotentWrite<Value> {
  return expectSuccess(result, operation);
}

function expectFailure(
  result: ContractResult<unknown>,
  operation: string,
  expectedKind?: string,
  expectedCode?: string,
): ContractFailure {
  if (result.ok) {
    throw new RepositoryContractAssertionError(`${operation} unexpectedly succeeded`);
  }
  if (expectedKind !== undefined) {
    assertEqual(result.kind, expectedKind, `${operation} failure kind`);
  }
  if (expectedCode !== undefined) {
    assertEqual(result.code, expectedCode, `${operation} failure code`);
  }
  return result;
}

function expectFailureOneOf(
  result: ContractResult<unknown>,
  operation: string,
  allowed: readonly { readonly kind: string; readonly code: string }[],
): ContractFailure {
  const failure = expectFailure(result, operation);
  assertContract(
    allowed.some(
      (candidate) => candidate.kind === failure.kind && candidate.code === failure.code,
    ),
    `${operation} failed with unexpected ${failure.kind}/${String(failure.code)}`,
  );
  return failure;
}

function fixtureFor<BehaviorId extends RepositoryContractBehaviorId>(
  context: RepositoryContractScenarioContext,
  behaviorId: BehaviorId,
): Extract<RepositoryContractFixture, { readonly behaviorId: BehaviorId }> {
  assertEqual(context.behavior.id, behaviorId, "registered behavior ID");
  assertEqual(context.fixture.behaviorId, behaviorId, "fixture behavior ID");
  assertContract(
    context.fixture.primaryScope.workspaceId !== context.fixture.secondaryScope.workspaceId,
    "repository contract fixture workspaces must be distinct",
  );
  return context.fixture as Extract<
    RepositoryContractFixture,
    { readonly behaviorId: BehaviorId }
  >;
}

function assertAtomicReservation(
  reservation: AtomicTaskAttemptReservation,
  command: ReserveTaskAttemptCommand,
  label: string,
): void {
  assertEqual(reservation.task.taskId, command.task.taskId, `${label} task ID`);
  assertEqual(
    command.idempotencyKey,
    command.attempt.idempotencyKey,
    `${label} outer/attempt retry key`,
  );
  assertEqual(reservation.task.taskKey, command.task.taskKey, `${label} task key`);
  assertEqual(reservation.task.lane, command.task.lane, `${label} task lane`);
  assertEqual(reservation.task.state, command.task.initialState, `${label} initial task state`);
  assertEqual(reservation.attempt.taskId, command.task.taskId, `${label} attempt task ID`);
  assertEqual(reservation.attempt.attemptId, command.attempt.attemptId, `${label} attempt ID`);
  assertEqual(reservation.attempt.ordinal, command.attempt.ordinal, `${label} attempt ordinal`);
  assertEqual(
    reservation.attempt.idempotencyKey,
    command.attempt.idempotencyKey,
    `${label} attempt retry key`,
  );
  assertEqual(
    reservation.attempt.executionProfileId,
    command.attempt.executionProfileId,
    `${label} execution profile ID`,
  );
  assertEqual(
    reservation.attempt.executionClaimTokenHash,
    command.attempt.executionClaimTokenHash,
    `${label} execution claim token hash`,
  );
  assertEqual(reservation.attempt.inputHash, command.attempt.inputHash, `${label} input hash`);
  assertEqual(
    reservation.attempt.parentAttemptId,
    command.attempt.parentAttemptId,
    `${label} parent attempt ID`,
  );
  assertEqual(
    reservation.attempt.fallbackReason,
    command.attempt.fallbackReason,
    `${label} fallback reason`,
  );
  assertEqual(reservation.attempt.state, "CREATED", `${label} attempt state`);
  assertOwnerBinding(reservation.task.owner, command.task.owner, `${label} task owner`);
  assertEqual(reservation.costReservation.taskId, command.task.taskId, `${label} cost task ID`);
  assertEqual(
    reservation.costReservation.costEventId,
    command.costReservation.costEventId,
    `${label} cost event ID`,
  );
  assertEqual(
    reservation.costReservation.attemptId,
    command.attempt.attemptId,
    `${label} cost attempt ID`,
  );
  assertEqual(reservation.costReservation.eventType, "RESERVED", `${label} cost event type`);
  assertEqual(
    reservation.costReservation.sequence,
    command.costReservation.sequence,
    `${label} cost sequence`,
  );
  assertEqual(
    reservation.costReservation.amountMicroUsd,
    command.costReservation.amountMicroUsd,
    `${label} reserved amount`,
  );
  assertEqual(
    reservation.costReservation.idempotencyKey,
    command.costReservation.idempotencyKey,
    `${label} cost retry key`,
  );
  assertOwnerBinding(
    reservation.costReservation.owner,
    command.task.owner,
    `${label} cost owner`,
  );
  assertEqual(
    reservation.dispatchOutbox.taskId,
    command.task.taskId,
    `${label} outbox task ID`,
  );
  assertEqual(
    reservation.dispatchOutbox.outboxId,
    command.dispatchOutbox.outboxId,
    `${label} outbox ID`,
  );
  assertEqual(
    reservation.dispatchOutbox.attemptId,
    command.attempt.attemptId,
    `${label} outbox attempt ID`,
  );
  assertEqual(reservation.dispatchOutbox.kind, "DISPATCH", `${label} outbox kind`);
  assertEqual(reservation.dispatchOutbox.state, "PENDING", `${label} outbox state`);
  assertEqual(
    reservation.dispatchOutbox.dedupeKey,
    command.dispatchOutbox.dedupeKey,
    `${label} outbox dedupe key`,
  );
  assertEqual(
    reservation.dispatchOutbox.payloadHash,
    command.dispatchOutbox.payloadHash,
    `${label} outbox payload hash`,
  );
  assertEqual(
    reservation.dispatchOutbox.payloadContractName,
    command.dispatchOutbox.payloadContractName,
    `${label} outbox contract name`,
  );
  assertEqual(
    reservation.dispatchOutbox.payloadContractVersion,
    command.dispatchOutbox.payloadContractVersion,
    `${label} outbox contract version`,
  );
}

function assertOwnerBinding(actual: DurableOwner, expected: DurableOwner, label: string): void {
  assertEqual(actual.ownerType, expected.ownerType, `${label} type`);
  assertEqual(actual.ownerId, expected.ownerId, `${label} ID`);
  switch (expected.ownerType) {
    case "PROJECT_REVISION":
      assertEqual(
        actual.ownerType === "PROJECT_REVISION" ? actual.projectRevisionId : null,
        expected.projectRevisionId,
        `${label} project revision ID`,
      );
      break;
    case "IMAGE_STYLE_VERSION":
      assertEqual(
        actual.ownerType === "IMAGE_STYLE_VERSION" ? actual.imageStyleVersionId : null,
        expected.imageStyleVersionId,
        `${label} image style version ID`,
      );
      break;
    case "AVATAR_PROFILE_VERSION":
      assertEqual(
        actual.ownerType === "AVATAR_PROFILE_VERSION" ? actual.avatarProfileVersionId : null,
        expected.avatarProfileVersionId,
        `${label} avatar profile version ID`,
      );
      break;
  }
}

function atomicReservationValue(
  result: Awaited<ReturnType<ControlPlaneRepositories["execution"]["reserveTaskAttempt"]>>,
) {
  const write = expectWrite(result, "reserve task attempt");
  assertEqual(write.replayed, false, "initial task reservation replay state");
  return write.value;
}

async function runWorkspaceIsolation(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "explicit-workspace-isolation");
  const primary = expectSuccess(
    await context.repositories.projects.resolveExactRevision(
      fixture.primaryScope,
      fixture.revisionLookup,
    ),
    "primary revision lookup",
  );
  assertEqual(primary.projectId, fixture.revisionLookup.projectId, "primary project ID");
  assertEqual(primary.revisionId, fixture.revisionLookup.revisionId, "primary revision ID");
  assertEqual(primary.workspaceId, fixture.primaryScope.workspaceId, "primary workspace ID");

  expectFailure(
    await context.repositories.projects.resolveExactRevision(
      fixture.secondaryScope,
      fixture.revisionLookup,
    ),
    "cross-workspace revision lookup",
    "NOT_FOUND",
  );
}

async function runMembershipAuthorization(
  context: RepositoryContractScenarioContext,
): Promise<void> {
  const fixture = fixtureFor(context, "membership-authorization");
  const primary = expectSuccess(
    await context.repositories.identity.authorizeMembership(
      fixture.primaryScope,
      fixture.memberLookup,
    ),
    "primary membership authorization",
  );
  assertEqual(primary.authorized, true, "primary authorization");
  assertEqual(primary.reason, "ACTIVE_MEMBER", "primary authorization reason");
  assertEqual(primary.identity.userId, fixture.memberLookup.userId, "authorized identity user ID");
  assertEqual(
    primary.membership.userId,
    fixture.memberLookup.userId,
    "authorized membership user ID",
  );
  assertEqual(primary.membership.workspaceId, fixture.primaryScope.workspaceId, "membership scope");

  expectFailure(
    await context.repositories.identity.authorizeMembership(
      fixture.secondaryScope,
      fixture.memberLookup,
    ),
    "cross-workspace membership authorization",
    "NOT_FOUND",
  );
}

async function runAvatarPublication(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "avatar-publication-immutability");
  assertEqual(fixture.publish.profileId, fixture.lookup.profileId, "avatar publish profile ID");
  assertEqual(fixture.publish.versionId, fixture.lookup.versionId, "avatar publish version ID");
  assertEqual(
    fixture.mutatePublished.profileId,
    fixture.lookup.profileId,
    "avatar mutation profile ID",
  );
  assertEqual(
    fixture.mutatePublished.versionId,
    fixture.lookup.versionId,
    "avatar mutation version ID",
  );
  const published = expectWrite(
    await context.repositories.avatarProfiles.publishVersion(fixture.primaryScope, fixture.publish),
    "publish avatar version",
  ).value;
  assertEqual(published.state, "READY", "published avatar state");
  assertEqual(published.versionId, fixture.lookup.versionId, "published avatar version ID");

  const resolved = expectSuccess(
    await context.repositories.avatarProfiles.resolveExactReadyVersion(
      fixture.primaryScope,
      fixture.lookup,
    ),
    "resolve exact avatar version",
  );
  assertEqual(
    resolved.profileDocument.canonicalDocumentSha256,
    published.profileDocument.canonicalDocumentSha256,
    "immutable avatar profile hash",
  );
  expectFailureOneOf(
    await context.repositories.avatarProfiles.saveDraftVersion(
      fixture.primaryScope,
      fixture.mutatePublished,
    ),
    "mutate published avatar version",
    [
      { kind: "CONFLICT", code: "STATE_CONFLICT" },
      { kind: "INVARIANT_VIOLATION", code: "IMMUTABLE_RECORD" },
      { kind: "INVARIANT_VIOLATION", code: "INVALID_STATE_TRANSITION" },
    ],
  );
}

async function runStylePublication(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "style-publication-immutability");
  assertEqual(fixture.publish.styleId, fixture.lookup.styleId, "style publish parent ID");
  assertEqual(fixture.publish.versionId, fixture.lookup.versionId, "style publish version ID");
  assertEqual(
    fixture.mutatePublished.styleId,
    fixture.lookup.styleId,
    "style mutation parent ID",
  );
  assertEqual(
    fixture.mutatePublished.versionId,
    fixture.lookup.versionId,
    "style mutation version ID",
  );
  const published = expectWrite(
    await context.repositories.imageStyles.publishVersion(fixture.primaryScope, fixture.publish),
    "publish image style version",
  ).value;
  assertEqual(published.state, "PUBLISHED", "published style state");
  assertEqual(published.versionId, fixture.lookup.versionId, "published style version ID");

  const resolved = expectSuccess(
    await context.repositories.imageStyles.resolveExactPublishedVersion(
      fixture.primaryScope,
      fixture.lookup,
    ),
    "resolve exact image style version",
  );
  assertEqual(
    resolved.profileDocument.canonicalDocumentSha256,
    published.profileDocument.canonicalDocumentSha256,
    "immutable style profile hash",
  );
  expectFailureOneOf(
    await context.repositories.imageStyles.saveDraftVersion(
      fixture.primaryScope,
      fixture.mutatePublished,
    ),
    "mutate published image style version",
    [
      { kind: "CONFLICT", code: "STATE_CONFLICT" },
      { kind: "INVARIANT_VIOLATION", code: "IMMUTABLE_RECORD" },
      { kind: "INVARIANT_VIOLATION", code: "INVALID_STATE_TRANSITION" },
    ],
  );
}

async function runRevisionLock(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "revision-lock-immutability");
  assertEqual(fixture.lock.projectId, fixture.lookup.projectId, "revision lock project ID");
  assertEqual(fixture.lock.revisionId, fixture.lookup.revisionId, "revision lock revision ID");
  assertEqual(fixture.relock.projectId, fixture.lookup.projectId, "revision relock project ID");
  assertEqual(fixture.relock.revisionId, fixture.lookup.revisionId, "revision relock revision ID");
  const locked = expectWrite(
    await context.repositories.projects.lockRevision(fixture.primaryScope, fixture.lock),
    "lock project revision",
  ).value;
  assertEqual(locked.status, "LOCKED", "locked revision status");
  assertEqual(
    locked.revisionConfig.canonicalDocumentSha256,
    fixture.lock.expectedRevisionConfigHash,
    "locked revision config hash",
  );
  const resolved = expectSuccess(
    await context.repositories.projects.resolveExactRevision(
      fixture.primaryScope,
      fixture.lookup,
    ),
    "resolve locked project revision",
  );
  assertEqual(resolved.status, "LOCKED", "resolved revision status");
  assertEqual(
    resolved.revisionConfig.canonicalDocumentSha256,
    locked.revisionConfig.canonicalDocumentSha256,
    "resolved locked revision hash",
  );
  expectFailureOneOf(
    await context.repositories.projects.lockRevision(fixture.primaryScope, fixture.relock),
    "relock project revision",
    [
      { kind: "CONFLICT", code: "PROJECT_REVISION_LOCKED" },
      { kind: "CONFLICT", code: "STATE_CONFLICT" },
      { kind: "INVARIANT_VIOLATION", code: "IMMUTABLE_RECORD" },
    ],
  );
}

async function runContentAddressBinding(
  context: RepositoryContractScenarioContext,
): Promise<void> {
  const fixture = fixtureFor(context, "content-address-binding");
  const artifact = expectSuccess(
    await context.repositories.artifacts.resolveExact(fixture.primaryScope, fixture.assetId),
    "resolve content-addressed artifact",
  );
  assertEqual(artifact.workspaceId, fixture.primaryScope.workspaceId, "artifact workspace ID");
  assertEqual(artifact.binarySha256, fixture.binaryLookup.sha256, "artifact binary hash");
  assertEqual(
    artifact.canonicalDocumentSha256,
    fixture.canonicalLookup.sha256,
    "artifact canonical hash",
  );
  assertContract(
    fixture.binaryLookup.sha256 !== fixture.canonicalLookup.sha256,
    "binary and canonical fixtures must use distinct addresses",
  );

  const binaries = expectSuccess(
    await context.repositories.artifacts.findByContentAddress(
      fixture.primaryScope,
      fixture.binaryLookup,
    ),
    "find artifact by binary address",
  );
  const canonicals = expectSuccess(
    await context.repositories.artifacts.findByContentAddress(
      fixture.primaryScope,
      fixture.canonicalLookup,
    ),
    "find artifact by canonical address",
  );
  assertContract(
    binaries.some((candidate) => candidate.assetId === fixture.assetId),
    "binary address did not resolve the seeded artifact",
  );
  assertContract(
    canonicals.some((candidate) => candidate.assetId === fixture.assetId),
    "canonical address did not resolve the seeded artifact",
  );

  const crossWorkspace = await context.repositories.artifacts.findByContentAddress(
    fixture.secondaryScope,
    fixture.binaryLookup,
  );
  if (crossWorkspace.ok) {
    assertContract(
      crossWorkspace.value.every((candidate) => candidate.assetId !== fixture.assetId),
      "cross-workspace content lookup leaked the seeded artifact",
    );
  } else {
    expectFailure(crossWorkspace, "cross-workspace content lookup", "NOT_FOUND");
  }
}

async function runAtomicReservation(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "atomic-task-attempt-reservation");
  const reservation = atomicReservationValue(
    await context.repositories.execution.reserveTaskAttempt(
      fixture.primaryScope,
      fixture.reservation,
    ),
  );
  assertAtomicReservation(reservation, fixture.reservation, "general reservation");

  assertEqual(
    fixture.invalidStyleAnalysis.idempotencyKey,
    fixture.styleAnalysis.idempotencyKey,
    "style rollback retry key",
  );
  assertEqual(
    fixture.invalidStyleAnalysis.analysisAttemptId,
    fixture.styleAnalysis.analysisAttemptId,
    "style rollback analysis attempt ID",
  );
  assertEqual(
    fixture.invalidStyleAnalysis.reservation.task.taskId,
    fixture.styleAnalysis.reservation.task.taskId,
    "style rollback task ID",
  );
  assertEqual(
    fixture.invalidStyleAnalysis.reservation.attempt.attemptId,
    fixture.styleAnalysis.reservation.attempt.attemptId,
    "style rollback execution attempt ID",
  );
  assertEqual(
    fixture.invalidStyleAnalysis.reservation.costReservation.costEventId,
    fixture.styleAnalysis.reservation.costReservation.costEventId,
    "style rollback cost event ID",
  );
  assertEqual(
    fixture.invalidStyleAnalysis.reservation.dispatchOutbox.outboxId,
    fixture.styleAnalysis.reservation.dispatchOutbox.outboxId,
    "style rollback outbox ID",
  );
  assertContract(
    fixture.invalidStyleAnalysis.reservation.task.owner.imageStyleVersionId !==
      fixture.invalidStyleAnalysis.versionId,
    "invalid style analysis owner must mismatch its version",
  );
  assertEqual(
    fixture.styleAnalysis.reservation.task.owner.imageStyleVersionId,
    fixture.styleAnalysis.versionId,
    "corrected style analysis owner version",
  );
  expectFailure(
    await context.repositories.imageStyles.beginAnalysis(
      fixture.primaryScope,
      fixture.invalidStyleAnalysis,
    ),
    "begin style analysis with mismatched billing owner",
    "INVARIANT_VIOLATION",
    "IMAGE_STYLE_ANALYSIS_BILLING_BOUNDARY_MISMATCH",
  );

  const styleWrite = expectWrite(
    await context.repositories.imageStyles.beginAnalysis(
      fixture.primaryScope,
      fixture.styleAnalysis,
    ),
    "begin style analysis",
  );
  assertEqual(styleWrite.replayed, false, "initial style analysis replay state");
  const style = styleWrite.value;
  const styleCommand = {
    ...fixture.styleAnalysis.reservation,
    idempotencyKey: fixture.styleAnalysis.idempotencyKey,
  };
  assertAtomicReservation(style.reservation, styleCommand, "style analysis reservation");
  assertEqual(
    style.reservation.task.owner.ownerType,
    "IMAGE_STYLE_VERSION",
    "style analysis owner type",
  );
  assertEqual(
    style.reservation.task.owner.imageStyleVersionId,
    fixture.styleAnalysis.versionId,
    "style analysis owner version",
  );
  assertEqual(
    style.analysisAttempt.executionAttemptId,
    style.reservation.attempt.attemptId,
    "style execution attempt link",
  );
  assertEqual(
    style.analysisAttempt.analysisAttemptId,
    fixture.styleAnalysis.analysisAttemptId,
    "style analysis attempt ID",
  );
  assertEqual(
    style.analysisAttempt.styleVersionId,
    fixture.styleAnalysis.versionId,
    "style analysis version ID",
  );
  assertEqual(
    style.analysisAttempt.taskId,
    style.reservation.task.taskId,
    "style analysis task link",
  );
  assertEqual(
    style.analysisAttempt.ordinal,
    style.reservation.attempt.ordinal,
    "style analysis ordinal",
  );
  assertEqual(
    style.analysisAttempt.idempotencyKey,
    style.reservation.attempt.idempotencyKey,
    "style analysis attempt retry key",
  );
  assertEqual(
    style.analysisAttempt.reservationCostEventId,
    style.reservation.costReservation.costEventId,
    "style cost reservation link",
  );
  assertEqual(
    style.analysisAttempt.dispatchOutboxId,
    style.reservation.dispatchOutbox.outboxId,
    "style dispatch outbox link",
  );

  assertEqual(
    fixture.invalidAvatarCompatibilityTest.idempotencyKey,
    fixture.avatarCompatibilityTest.idempotencyKey,
    "avatar rollback retry key",
  );
  assertEqual(
    fixture.invalidAvatarCompatibilityTest.testAttemptId,
    fixture.avatarCompatibilityTest.testAttemptId,
    "avatar rollback test attempt ID",
  );
  assertEqual(
    fixture.invalidAvatarCompatibilityTest.reservation.task.taskId,
    fixture.avatarCompatibilityTest.reservation.task.taskId,
    "avatar rollback task ID",
  );
  assertEqual(
    fixture.invalidAvatarCompatibilityTest.reservation.attempt.attemptId,
    fixture.avatarCompatibilityTest.reservation.attempt.attemptId,
    "avatar rollback execution attempt ID",
  );
  assertEqual(
    fixture.invalidAvatarCompatibilityTest.reservation.costReservation.costEventId,
    fixture.avatarCompatibilityTest.reservation.costReservation.costEventId,
    "avatar rollback cost event ID",
  );
  assertEqual(
    fixture.invalidAvatarCompatibilityTest.reservation.dispatchOutbox.outboxId,
    fixture.avatarCompatibilityTest.reservation.dispatchOutbox.outboxId,
    "avatar rollback outbox ID",
  );
  assertContract(
    fixture.invalidAvatarCompatibilityTest.reservation.task.owner.avatarProfileVersionId !==
      fixture.invalidAvatarCompatibilityTest.versionId,
    "invalid avatar test owner must mismatch its version",
  );
  assertEqual(
    fixture.avatarCompatibilityTest.reservation.task.owner.avatarProfileVersionId,
    fixture.avatarCompatibilityTest.versionId,
    "corrected avatar test owner version",
  );
  expectFailure(
    await context.repositories.avatarProfiles.beginCompatibilityTest(
      fixture.primaryScope,
      fixture.invalidAvatarCompatibilityTest,
    ),
    "begin avatar test with mismatched billing owner",
    "INVARIANT_VIOLATION",
    "AVATAR_COMPATIBILITY_BILLING_BOUNDARY_MISMATCH",
  );

  const avatarWrite = expectWrite(
    await context.repositories.avatarProfiles.beginCompatibilityTest(
      fixture.primaryScope,
      fixture.avatarCompatibilityTest,
    ),
    "begin avatar compatibility test",
  );
  assertEqual(avatarWrite.replayed, false, "initial avatar test replay state");
  const avatar = avatarWrite.value;
  const avatarCommand = {
    ...fixture.avatarCompatibilityTest.reservation,
    idempotencyKey: fixture.avatarCompatibilityTest.idempotencyKey,
  };
  assertAtomicReservation(avatar.reservation, avatarCommand, "avatar test reservation");
  assertEqual(
    avatar.reservation.task.owner.ownerType,
    "AVATAR_PROFILE_VERSION",
    "avatar test owner type",
  );
  assertEqual(
    avatar.reservation.task.owner.avatarProfileVersionId,
    fixture.avatarCompatibilityTest.versionId,
    "avatar test owner version",
  );
  assertEqual(
    avatar.testAttempt.executionAttemptId,
    avatar.reservation.attempt.attemptId,
    "avatar execution attempt link",
  );
  assertEqual(
    avatar.testAttempt.testAttemptId,
    fixture.avatarCompatibilityTest.testAttemptId,
    "avatar test attempt ID",
  );
  assertEqual(
    avatar.testAttempt.assessmentId,
    fixture.avatarCompatibilityTest.assessmentId,
    "avatar test assessment ID",
  );
  assertEqual(
    avatar.testAttempt.avatarProfileVersionId,
    fixture.avatarCompatibilityTest.versionId,
    "avatar test version ID",
  );
  assertEqual(
    avatar.testAttempt.taskId,
    avatar.reservation.task.taskId,
    "avatar test task link",
  );
  assertEqual(
    avatar.testAttempt.ordinal,
    avatar.reservation.attempt.ordinal,
    "avatar test ordinal",
  );
  assertEqual(
    avatar.testAttempt.idempotencyKey,
    avatar.reservation.attempt.idempotencyKey,
    "avatar test attempt retry key",
  );
  assertEqual(
    avatar.testAttempt.reservationCostEventId,
    avatar.reservation.costReservation.costEventId,
    "avatar cost reservation link",
  );
  assertEqual(
    avatar.testAttempt.dispatchOutboxId,
    avatar.reservation.dispatchOutbox.outboxId,
    "avatar dispatch outbox link",
  );
  assertEqual(
    avatar.assessment.executionProfileId,
    avatar.reservation.attempt.executionProfileId,
    "avatar assessment execution profile link",
  );
}

async function runReservationIdempotency(
  context: RepositoryContractScenarioContext,
): Promise<void> {
  const fixture = fixtureFor(context, "reservation-idempotency");
  assertEqual(
    fixture.changedReservation.idempotencyKey,
    fixture.reservation.idempotencyKey,
    "changed reservation retry key",
  );
  assertEqual(
    fixture.changedReservation.task.taskId,
    fixture.reservation.task.taskId,
    "changed reservation task ID",
  );
  assertEqual(
    fixture.changedReservation.attempt.attemptId,
    fixture.reservation.attempt.attemptId,
    "changed reservation attempt ID",
  );
  assertContract(
    fixture.changedReservation.attempt.inputHash !== fixture.reservation.attempt.inputHash,
    "changed reservation must change the input fingerprint",
  );
  const initial = expectWrite(
    await context.repositories.execution.reserveTaskAttempt(
      fixture.primaryScope,
      fixture.reservation,
    ),
    "initial reservation",
  );
  assertEqual(initial.replayed, false, "initial reservation replay state");
  const replay = expectWrite(
    await context.repositories.execution.reserveTaskAttempt(
      fixture.primaryScope,
      fixture.reservation,
    ),
    "replayed reservation",
  );
  assertEqual(replay.replayed, true, "replayed reservation state");
  assertEqual(replay.value.task.taskId, initial.value.task.taskId, "replayed task ID");
  expectFailure(
    await context.repositories.execution.reserveTaskAttempt(
      fixture.primaryScope,
      fixture.changedReservation,
    ),
    "changed reservation fingerprint",
    "CONFLICT",
    "IDEMPOTENCY_KEY_REUSED",
  );
}

async function runDispatchAmbiguity(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "dispatch-ambiguity-is-not-completion");
  const acknowledged = expectWrite(
    await context.repositories.execution.recordDispatchAcknowledged(
      fixture.primaryScope,
      fixture.acknowledged,
    ),
    "record dispatch acknowledgement",
  ).value;
  assertEqual(acknowledged.completion, "NOT_ACCEPTED", "acknowledgement completion");

  const acknowledgementUnknown = expectWrite(
    await context.repositories.execution.recordDispatchAckUnknown(
      fixture.primaryScope,
      fixture.acknowledgementUnknown,
    ),
    "record unknown dispatch acknowledgement",
  ).value;
  assertEqual(
    acknowledgementUnknown.completion,
    "NOT_ACCEPTED",
    "unknown acknowledgement completion",
  );
  assertEqual(acknowledgementUnknown.dispatchState, "AMBIGUOUS", "unknown dispatch state");

  const unknownAttempt = expectWrite(
    await context.repositories.execution.recordUnknownAttempt(
      fixture.primaryScope,
      fixture.unknownAttempt,
    ),
    "record unknown attempt",
  ).value;
  assertEqual(unknownAttempt.completion, "NOT_ACCEPTED", "unknown attempt completion");
  assertEqual(unknownAttempt.reconciliationRequired, true, "unknown reconciliation requirement");
  assertEqual(unknownAttempt.attempt.state, "UNKNOWN", "unknown attempt state");
  assertEqual(unknownAttempt.attempt.finishedAt, null, "unknown attempt finished time");

  const taskOnly = expectWrite(
    await context.repositories.execution.requestCancellation(
      fixture.primaryScope,
      fixture.taskOnlyCancellation,
    ),
    "request task-only cancellation",
  ).value;
  assertEqual(taskOnly.target, "TASK_ONLY", "task-only cancellation target");
  assertEqual(taskOnly.task.state, "CANCELLED", "task-only cancellation state");
  assertEqual(taskOnly.outbox, null, "task-only cancellation outbox");
  assertEqual(taskOnly.task.acceptedAttemptId, null, "task-only accepted attempt");
  assertContract(taskOnly.task.finishedAt !== null, "task-only cancellation is missing finishedAt");

  const attempted = expectWrite(
    await context.repositories.execution.requestCancellation(
      fixture.primaryScope,
      fixture.attemptCancellation,
    ),
    "request attempt cancellation",
  ).value;
  assertEqual(attempted.target, "ATTEMPT", "attempt cancellation target");
  assertEqual(attempted.task.state, "CANCEL_REQUESTED", "attempt cancellation task state");
  assertEqual(attempted.attemptId, fixture.attemptCancellation.attemptId, "cancel attempt ID");
  assertEqual(attempted.outbox.kind, "CANCEL", "cancel outbox kind");
  assertEqual(attempted.outbox.state, "PENDING", "cancel outbox state");
  assertEqual(attempted.outbox.taskId, attempted.task.taskId, "cancel outbox task ID");
  assertEqual(
    attempted.outbox.attemptId,
    fixture.attemptCancellation.attemptId,
    "cancel outbox attempt ID",
  );
}

async function runOneAcceptedResult(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "one-accepted-result");
  assertEqual(fixture.firstResult.taskId, fixture.secondResult.taskId, "candidate task IDs");
  assertContract(
    fixture.firstResult.attemptId !== fixture.secondResult.attemptId,
    "accepted-result fixtures must use distinct attempts",
  );
  const first = expectWrite(
    await context.repositories.execution.recordSuccessfulResult(
      fixture.primaryScope,
      fixture.firstResult,
    ),
    "record first successful result",
  ).value;
  const second = expectWrite(
    await context.repositories.execution.recordSuccessfulResult(
      fixture.primaryScope,
      fixture.secondResult,
    ),
    "record second successful result",
  ).value;
  assertEqual(first.completion, "NOT_ACCEPTED", "first candidate completion");
  assertEqual(second.completion, "NOT_ACCEPTED", "second candidate completion");
  assertEqual(first.attempt.taskId, fixture.firstResult.taskId, "first candidate task ID");
  assertEqual(first.attempt.attemptId, fixture.firstResult.attemptId, "first candidate attempt ID");
  assertEqual(
    first.reference.attemptId,
    first.attempt.attemptId,
    "first candidate reference attempt ID",
  );
  assertEqual(first.reference.taskId, first.attempt.taskId, "first candidate reference task ID");
  assertContract(first.reference.expectedTaskVersion > 0, "first candidate task version is invalid");
  assertEqual(
    first.attempt.outputAssetId,
    fixture.firstResult.outputAssetId,
    "first candidate output asset ID",
  );
  assertEqual(second.attempt.taskId, fixture.secondResult.taskId, "second candidate task ID");
  assertEqual(
    second.attempt.attemptId,
    fixture.secondResult.attemptId,
    "second candidate attempt ID",
  );
  assertEqual(
    second.reference.attemptId,
    second.attempt.attemptId,
    "second candidate reference attempt ID",
  );
  assertEqual(second.reference.taskId, second.attempt.taskId, "second candidate reference task ID");

  const accepted = expectWrite(
    await context.repositories.execution.acceptSuccessfulResult(fixture.primaryScope, {
      ...fixture.firstAcceptance,
      candidateReference: first.reference,
    }),
    "accept first successful result",
  ).value;
  assertEqual(accepted.completion, "ACCEPTED", "accepted result completion");
  assertEqual(accepted.task.state, "COMPLETE", "accepted task state");
  assertEqual(
    accepted.task.acceptedAttemptId,
    first.attempt.attemptId,
    "accepted task attempt provenance",
  );
  assertEqual(accepted.attempt.attemptId, first.attempt.attemptId, "accepted attempt ID");
  assertEqual(accepted.attempt.resultDisposition, "ACCEPTED", "accepted attempt disposition");
  assertEqual(
    accepted.attempt.outputAssetId,
    first.attempt.outputAssetId,
    "accepted output asset ID",
  );
  assertEqual(
    accepted.outputBinarySha256,
    first.outputBinarySha256,
    "accepted output binary hash",
  );
  const visibleAttempts = expectSuccess(
    await context.repositories.execution.listAttempts(fixture.primaryScope, {
      taskId: fixture.firstResult.taskId,
    }),
    "list duplicate attempts after acceptance",
  );
  assertContract(
    visibleAttempts.some((attempt) => attempt.attemptId === fixture.firstResult.attemptId),
    "accepted attempt disappeared from lineage",
  );
  assertContract(
    visibleAttempts.some((attempt) => attempt.attemptId === fixture.secondResult.attemptId),
    "unaccepted duplicate attempt disappeared from lineage",
  );

  expectFailure(
    await context.repositories.execution.acceptSuccessfulResult(fixture.primaryScope, {
      ...fixture.secondAcceptance,
      candidateReference: second.reference,
    }),
    "accept second successful result",
    "CONFLICT",
    "ACCEPTED_RESULT_EXISTS",
  );
}

async function runAppendOnlyEvents(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "append-only-monotonic-events");
  assertEqual(
    fixture.changedWorkflowEvent.workflowInstanceId,
    fixture.workflowEvent.workflowInstanceId,
    "changed workflow instance ID",
  );
  assertEqual(
    fixture.nonMonotonicWorkflowEvent.workflowInstanceId,
    fixture.workflowEvent.workflowInstanceId,
    "non-monotonic workflow instance ID",
  );
  assertEqual(
    fixture.workflowList.workflowInstanceId,
    fixture.workflowEvent.workflowInstanceId,
    "workflow list instance ID",
  );
  assertEqual(
    fixture.changedWorkflowEvent.aggregate.aggregateType,
    fixture.workflowEvent.aggregate.aggregateType,
    "changed workflow aggregate type",
  );
  assertEqual(
    fixture.changedWorkflowEvent.aggregate.aggregateId,
    fixture.workflowEvent.aggregate.aggregateId,
    "changed workflow aggregate ID",
  );
  assertEqual(
    fixture.nonMonotonicWorkflowEvent.aggregate.aggregateType,
    fixture.workflowEvent.aggregate.aggregateType,
    "non-monotonic workflow aggregate type",
  );
  assertEqual(
    fixture.nonMonotonicWorkflowEvent.aggregate.aggregateId,
    fixture.workflowEvent.aggregate.aggregateId,
    "non-monotonic workflow aggregate ID",
  );
  assertOwnerBinding(
    fixture.nonMonotonicCostEvent.owner,
    fixture.costEvent.owner,
    "non-monotonic cost owner",
  );
  assertOwnerBinding(fixture.costList.owner, fixture.costEvent.owner, "cost list owner");
  const workflow = expectWrite(
    await context.repositories.events.appendWorkflowEvent(
      fixture.primaryScope,
      fixture.workflowEvent,
    ),
    "append workflow event",
  );
  assertEqual(workflow.replayed, false, "initial workflow event replay state");
  const workflowReplay = expectWrite(
    await context.repositories.events.appendWorkflowEvent(
      fixture.primaryScope,
      fixture.workflowEvent,
    ),
    "replay workflow event",
  );
  assertEqual(workflowReplay.replayed, true, "workflow event replay state");
  assertEqual(
    fixture.changedWorkflowEvent.eventId,
    fixture.workflowEvent.eventId,
    "changed workflow event ID",
  );
  assertContract(
    fixture.changedWorkflowEvent.idempotencyKey !== fixture.workflowEvent.idempotencyKey,
    "changed workflow event must use a new retry key",
  );
  assertContract(
    fixture.changedWorkflowEvent.payloadHash !== fixture.workflowEvent.payloadHash,
    "changed workflow event must change its fingerprint",
  );
  assertContract(
    fixture.nonMonotonicWorkflowEvent.sequence <= fixture.workflowEvent.sequence,
    "non-monotonic workflow event fixture has a later sequence",
  );
  expectFailure(
    await context.repositories.events.appendWorkflowEvent(
      fixture.primaryScope,
      fixture.changedWorkflowEvent,
    ),
    "mutate workflow event",
    "CONFLICT",
    "EVENT_ID_REUSED",
  );
  expectFailureOneOf(
    await context.repositories.events.appendWorkflowEvent(
      fixture.primaryScope,
      fixture.nonMonotonicWorkflowEvent,
    ),
    "append non-monotonic workflow event",
    [
      { kind: "CONFLICT", code: "SEQUENCE_CONFLICT" },
      { kind: "INVARIANT_VIOLATION", code: "EVENT_SEQUENCE_NOT_MONOTONIC" },
    ],
  );
  const workflowList = expectSuccess(
    await context.repositories.events.listWorkflowEvents(
      fixture.primaryScope,
      fixture.workflowList,
    ),
    "list workflow events",
  );
  assertContract(
    workflowList.some((event) => event.eventId === fixture.workflowEvent.eventId),
    "workflow event list omitted the appended event",
  );
  assertContract(
    workflowList.every(
      (event, index) => index === 0 || workflowList[index - 1]!.sequence < event.sequence,
    ),
    "workflow events are not strictly monotonic",
  );

  const cost = expectWrite(
    await context.repositories.events.appendCostEvent(fixture.primaryScope, fixture.costEvent),
    "append cost event",
  );
  assertEqual(cost.replayed, false, "initial cost event replay state");
  assertContract(
    fixture.nonMonotonicCostEvent.sequence <= fixture.costEvent.sequence,
    "non-monotonic cost event fixture has a later sequence",
  );
  expectFailureOneOf(
    await context.repositories.events.appendCostEvent(
      fixture.primaryScope,
      fixture.nonMonotonicCostEvent,
    ),
    "append non-monotonic cost event",
    [
      { kind: "CONFLICT", code: "SEQUENCE_CONFLICT" },
      { kind: "INVARIANT_VIOLATION", code: "EVENT_SEQUENCE_NOT_MONOTONIC" },
    ],
  );
  const costList = expectSuccess(
    await context.repositories.events.listCostEvents(fixture.primaryScope, fixture.costList),
    "list cost events",
  );
  assertContract(
    costList.some((event) => event.costEventId === fixture.costEvent.costEventId),
    "cost event list omitted the appended event",
  );
  assertContract(
    costList.every((event, index) => index === 0 || costList[index - 1]!.sequence < event.sequence),
    "cost events are not strictly monotonic",
  );
}

async function runUnitOfWorkRollback(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "unit-of-work-rollback");
  assertContract(
    fixture.typedFailureReservation.task.taskId !== fixture.thrownFailureReservation.task.taskId,
    "rollback fixtures must use distinct tasks",
  );
  const typedFailure = await context.repositories.unitOfWork.execute(
    fixture.primaryScope,
    async (repositories) => {
      const reserved = await repositories.execution.reserveTaskAttempt(
        fixture.primaryScope,
        fixture.typedFailureReservation,
      );
      expectWrite(reserved, "reserve inside typed rollback");
      return {
        ok: false as const,
        kind: "INVARIANT_VIOLATION" as const,
        code: "SNAPSHOT_MISMATCH" as const,
        message: "canonical repository contract typed rollback",
      };
    },
  );
  expectFailure(typedFailure, "typed unit-of-work rollback", "INVARIANT_VIOLATION");
  const afterTypedFailure = expectWrite(
    await context.repositories.execution.reserveTaskAttempt(
      fixture.primaryScope,
      fixture.typedFailureReservation,
    ),
    "retry after typed rollback",
  );
  assertEqual(afterTypedFailure.replayed, false, "typed rollback retained idempotency state");

  let thrown = false;
  try {
    await context.repositories.unitOfWork.execute(fixture.primaryScope, async (repositories) => {
      const reserved = await repositories.execution.reserveTaskAttempt(
        fixture.primaryScope,
        fixture.thrownFailureReservation,
      );
      expectWrite(reserved, "reserve inside thrown rollback");
      throw new Error("canonical repository contract thrown rollback");
    });
  } catch (error: unknown) {
    assertContract(error instanceof Error, "unit-of-work threw a non-Error value");
    thrown = true;
  }
  assertContract(thrown, "unit-of-work swallowed a thrown fault");
  const afterThrownFailure = expectWrite(
    await context.repositories.execution.reserveTaskAttempt(
      fixture.primaryScope,
      fixture.thrownFailureReservation,
    ),
    "retry after thrown rollback",
  );
  assertEqual(afterThrownFailure.replayed, false, "thrown rollback retained idempotency state");
}

async function runArchiveLineage(context: RepositoryContractScenarioContext): Promise<void> {
  const fixture = fixtureFor(context, "archive-preserves-lineage");
  assertEqual(
    fixture.historicalRevision.projectId,
    fixture.archive.projectId,
    "historical revision project ID",
  );
  assertEqual(
    fixture.newRevision.projectId,
    fixture.archive.projectId,
    "post-archive revision project ID",
  );
  const archived = expectWrite(
    await context.repositories.projects.archiveProject(fixture.primaryScope, fixture.archive),
    "archive project",
  ).value;
  assertEqual(archived.status, "ARCHIVED", "archived project state");
  expectSuccess(
    await context.repositories.projects.resolveExactRevision(
      fixture.primaryScope,
      fixture.historicalRevision,
    ),
    "resolve archived historical revision",
  );
  const historicalTask = expectSuccess(
    await context.repositories.execution.resolveTask(
      fixture.primaryScope,
      fixture.historicalTask,
    ),
    "resolve archived historical task",
  );
  assertEqual(historicalTask.taskId, fixture.historicalTask.taskId, "historical task ID");
  assertEqual(
    historicalTask.owner.ownerType,
    "PROJECT_REVISION",
    "historical task owner type",
  );
  if (historicalTask.owner.ownerType === "PROJECT_REVISION") {
    assertEqual(
      historicalTask.owner.projectRevisionId,
      fixture.historicalRevision.revisionId,
      "historical task revision ID",
    );
  }
  expectFailure(
    await context.repositories.projects.createRevisionDraft(
      fixture.primaryScope,
      fixture.newRevision,
    ),
    "create revision for archived project",
    "INVARIANT_VIOLATION",
    "PROJECT_ARCHIVED",
  );
}

const CANONICAL_RUNNERS = {
  "explicit-workspace-isolation": runWorkspaceIsolation,
  "membership-authorization": runMembershipAuthorization,
  "avatar-publication-immutability": runAvatarPublication,
  "style-publication-immutability": runStylePublication,
  "revision-lock-immutability": runRevisionLock,
  "content-address-binding": runContentAddressBinding,
  "atomic-task-attempt-reservation": runAtomicReservation,
  "reservation-idempotency": runReservationIdempotency,
  "dispatch-ambiguity-is-not-completion": runDispatchAmbiguity,
  "one-accepted-result": runOneAcceptedResult,
  "append-only-monotonic-events": runAppendOnlyEvents,
  "unit-of-work-rollback": runUnitOfWorkRollback,
  "archive-preserves-lineage": runArchiveLineage,
} satisfies Record<RepositoryContractBehaviorId, RepositoryContractScenario["run"]>;

/** Canonical assertions owned by VideoForge; adapters cannot replace or omit a behavior body. */
export const CANONICAL_REPOSITORY_CONTRACT_SCENARIOS: readonly RepositoryContractScenario[] =
  Object.freeze(
    REPOSITORY_CONTRACT_BEHAVIORS.map((behavior) =>
      Object.freeze({
        behaviorId: behavior.id,
        run: CANONICAL_RUNNERS[behavior.id],
      }),
    ),
  );

/**
 * Registers every canonical scenario against an adapter factory. A fresh adapter is created and
 * disposed for each behavior, so PGlite and Neon must run exactly the same assertion bodies.
 */
export function registerRepositoryContractSuite(
  registrar: RepositoryContractRegistrar,
  adapterFactory: RepositoryContractAdapterFactory,
  options: RepositoryContractSuiteOptions = {},
): void {
  const suiteName = options.name ?? "repository contract";
  for (const [index, behavior] of REPOSITORY_CONTRACT_BEHAVIORS.entries()) {
    const scenario = CANONICAL_REPOSITORY_CONTRACT_SCENARIOS[index];
    assertContract(scenario !== undefined, `missing canonical scenario for ${behavior.id}`);
    assertEqual(scenario.behaviorId, behavior.id, "canonical scenario registration order");
    registrar.test(`${suiteName}: ${behavior.id}`, async () => {
      const adapter = await adapterFactory.create(behavior);
      try {
        await scenario.run({
          behavior,
          repositories: adapter.repositories,
          fixture: adapter.fixture,
        });
      } finally {
        await adapter.dispose();
      }
    });
  }
}
