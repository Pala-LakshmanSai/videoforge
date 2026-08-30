import {
  ProviderFreeMvpOrchestrator,
  ProviderFreeOrchestrationError,
  type ProviderFreeAdvanceResult,
  type ProviderFreeLane,
  type ProviderFreeGpuRevalidationPair,
  type ProviderFreeMaterializedReceipts,
  type ProviderFreeOrchestrationState,
  type ProviderFreeProjectState,
} from "@videoforge/control-plane/provider-free-orchestration";

import { MemorySharedAppPersistence, type SharedAppPersistence } from "./shared-app-persistence";
import {
  MemoryProviderFreeArtifactRuntime,
  type ProviderFreeArtifactRuntime,
} from "./provider-free-artifact-runtime";
import { buildProviderFreeProjectBundle } from "./provider-free-foundations";

export type FixtureAuthMethod = "EMAIL_PASSWORD" | "GOOGLE";
export type SharedQueueState = "ACTIVE" | "WAITING";

export interface GpuOffer {
  readonly receiptId: string;
  readonly lane: "image_media" | "avatar_primary";
  readonly gpuSku: string;
  readonly vramGb: number;
  readonly rateUsdPerHour: number;
  readonly cloudType: "SECURE";
  readonly region: "EU-RO-1";
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface LockedGpuPair {
  readonly image: GpuOffer;
  readonly avatar: GpuOffer;
  readonly lockedAt: string;
}

export interface SharedQueueEntry {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: SharedQueueState;
  readonly admissionState: "ACTIVE" | "WAITING";
  readonly actor: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly position: number;
  readonly createdAt: string;
  readonly requestVersion: number;
}

export interface FairAdmissionSnapshotItem {
  readonly requestId: string;
  readonly state: "WAITING" | "ADMITTED" | "ACTIVE" | "CANCELLING";
  readonly queueOrder: bigint;
  readonly version: number;
}

export interface SharedQueueAudit {
  readonly id: string;
  readonly operation: "START" | "ADD" | "MOVE" | "REMOVE";
  readonly actor: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly oldOrder: readonly string[];
  readonly newOrder: readonly string[];
  readonly oldVersion: number;
  readonly newVersion: number;
  readonly occurredAt: string;
}

export interface SharedAppView {
  readonly rights: "EQUAL";
  readonly admission: {
    readonly admitted: boolean;
    readonly email: string | null;
    readonly authMethod: FixtureAuthMethod | null;
  };
  readonly inventory: readonly GpuOffer[];
  readonly session: null | {
    readonly id: string;
    readonly queueVersion: number;
    readonly gpuPair: LockedGpuPair;
  };
  readonly queue: readonly SharedQueueEntry[];
  readonly audits: readonly SharedQueueAudit[];
  readonly orchestration: ProviderFreeOrchestrationState;
  readonly canSelectGpuPair: boolean;
  readonly providerCallsAuthorized: false;
  readonly authorizedSpendUsd: 0;
}

export interface PrivateFairQueueView {
  readonly schemaVersion: "videoforge.private-fair-queue/v1";
  readonly queueVersion: number;
  readonly capacity: {
    readonly totalSlots: 2;
    readonly ownedActive: 0 | 1;
    readonly accountActiveLimit: 1;
    readonly otherAccountDetailsVisible: false;
  };
  readonly requests: readonly {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly kind: "VIDEO";
    readonly state: "ACTIVE" | "WAITING";
    readonly stage: string;
    readonly accountPosition: number;
    readonly version: number;
    readonly canReorder: boolean;
    readonly canCancel: boolean;
    readonly createdAt: string;
  }[];
  readonly fairness: {
    readonly policy: "DETERMINISTIC_ACCOUNT_ROTATION";
    readonly reorderScope: "ACCOUNT_ONLY";
    readonly previewsBelowEligibleVideos: true;
  };
  readonly providerCallsAuthorized: false;
  readonly authorizedSpendUsd: 0;
}

export class SharedFixtureError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SharedFixtureError";
  }
}

/** One admitted identity owns exactly one account and one default workspace (DEC_TENANCY_002). */
export interface FixtureTenantScope {
  readonly accountId: string;
  readonly workspaceId: string;
}

/** Deterministic per-identity scope. Distinct emails can never collide onto one tenant. */
function fixtureTenantScope(email: string): FixtureTenantScope {
  const slug = email.replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-+|-+$/gu, "");
  return Object.freeze({
    accountId: `account-${slug}`,
    workspaceId: `workspace-${slug}`,
  });
}

interface Admission {
  readonly email: string;
  readonly method: FixtureAuthMethod;
  readonly credentialHash: string;
  readonly tenant: FixtureTenantScope;
}

interface Invite {
  readonly email: string;
  readonly codeHash: string;
  readonly emailPasswordHash: string;
  readonly googleAssertionHash: string;
  consumed: boolean;
}

interface IssuedFixtureInvite {
  readonly codeHash: string;
  readonly credentials: {
    readonly code: string;
    readonly emailPassword: string;
    readonly googleAssertion: string;
  };
}

interface MutableState {
  admissions: Map<string, Admission>;
  sessionAdmissions: Map<string, Admission>;
  invites: Map<string, Invite>;
  sessionId: string | null;
  pair: LockedGpuPair | null;
  queueVersions: Map<string, number>;
  queue: SharedQueueEntry[];
  audits: SharedQueueAudit[];
  projectOwners: Map<string, FixtureTenantScope>;
  orchestration: ProviderFreeOrchestrationState;
}

const OFFER_TEMPLATES = Object.freeze([
  Object.freeze({
    receiptId: "receipt_image_rtx4090_001",
    lane: "image_media",
    gpuSku: "NVIDIA RTX 4090",
    vramGb: 24,
    rateUsdPerHour: 0.34,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
  Object.freeze({
    receiptId: "receipt_image_a6000_001",
    lane: "image_media",
    gpuSku: "NVIDIA RTX A6000",
    vramGb: 48,
    rateUsdPerHour: 0.42,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
  Object.freeze({
    receiptId: "receipt_avatar_rtx4090_001",
    lane: "avatar_primary",
    gpuSku: "NVIDIA RTX 4090",
    vramGb: 24,
    rateUsdPerHour: 0.34,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
  Object.freeze({
    receiptId: "receipt_avatar_a6000_001",
    lane: "avatar_primary",
    gpuSku: "NVIDIA RTX A6000",
    vramGb: 48,
    rateUsdPerHour: 0.42,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
]);

function liveOffers(): readonly GpuOffer[] {
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 5 * 60_000).toISOString();
  return OFFER_TEMPLATES.map((offer) =>
    Object.freeze({ ...offer, observedAt: observedAt.toISOString(), expiresAt }),
  );
}

function normalizedEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) {
    throw new SharedFixtureError("EMAIL_INVALID", 400, "Enter one valid verified email.");
  }
  return normalized;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashBytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function currentOrder(queue: readonly SharedQueueEntry[]): string[] {
  return queue.map((entry) => entry.id);
}

function positions(queue: readonly SharedQueueEntry[]): SharedQueueEntry[] {
  return queue.map((entry, index) => ({ ...entry, position: index + 1 }));
}

function normalizeProviderFreeSnapshot(
  snapshot: ProviderFreeOrchestrationState,
): ProviderFreeOrchestrationState {
  const normalized = structuredClone(snapshot) as ProviderFreeOrchestrationState;
  for (const project of normalized.projects) {
    const barriers = project.barriers as ProviderFreeProjectState["barriers"] &
      Partial<ProviderFreeProjectState["barriers"]>;
    barriers.generationWorkManifestSha256 ??= null;
    barriers.renderWorkManifestSha256 ??= null;
    if (project.finalAsset !== null) {
      const finalAsset = project.finalAsset as ProviderFreeProjectState["finalAsset"] & {
        totalFrames?: number;
        renderer?: "DIRECT_FFMPEG" | "WORKERD_SAFE_FIXTURE";
      };
      finalAsset.totalFrames ??= Math.round((finalAsset.durationMs * 30) / 1_000);
      finalAsset.renderer ??= "WORKERD_SAFE_FIXTURE";
    }
  }
  for (const session of [normalized.session, normalized.lastClosedSession]) {
    if (session === null) continue;
    for (const lane of Object.values(session.lanes)) {
      for (const attempt of lane.attempts) {
        const legacy = attempt as typeof attempt & {
          gpuValidationId?: string;
          gpuValidatedAt?: string;
        };
        legacy.gpuValidationId ??= `legacy-fixture-validation-${attempt.podId}`;
        legacy.gpuValidatedAt ??= attempt.createdAt;
      }
    }
  }
  return normalized;
}

export class SharedAppFixtureStore {
  #state: MutableState;
  readonly #persistence: SharedAppPersistence;
  readonly #artifacts: ProviderFreeArtifactRuntime;
  /** Raw fixture values stay process-local; the durable snapshot stores hashes only. */
  readonly #issuedInviteCredentials = new Map<string, IssuedFixtureInvite>();
  #orchestrator: ProviderFreeMvpOrchestrator;
  #asyncMutationTail: Promise<void> = Promise.resolve();
  #pendingAsyncMutations = 0;

  constructor(
    persistence: SharedAppPersistence = new MemorySharedAppPersistence(),
    artifacts: ProviderFreeArtifactRuntime = new MemoryProviderFreeArtifactRuntime(),
  ) {
    this.#persistence = persistence;
    this.#artifacts = artifacts;
    const snapshot = persistence.read();
    this.#state = snapshot ? SharedAppFixtureStore.parse(snapshot) : SharedAppFixtureStore.empty();
    this.#orchestrator = new ProviderFreeMvpOrchestrator(this.#state.orchestration);
  }

  reset(): void {
    this.commit(() => {
      this.#state = SharedAppFixtureStore.empty();
      this.#orchestrator = new ProviderFreeMvpOrchestrator(this.#state.orchestration);
    });
    this.#issuedInviteCredentials.clear();
  }

  static empty(): MutableState {
    return {
      admissions: new Map(),
      sessionAdmissions: new Map(),
      invites: new Map(),
      sessionId: null,
      pair: null,
      queueVersions: new Map(),
      queue: [],
      audits: [],
      projectOwners: new Map(),
      orchestration: new ProviderFreeMvpOrchestrator().snapshot(),
    };
  }

  static parse(snapshot: string): MutableState {
    const value = JSON.parse(snapshot) as {
      admissions: Admission[];
      sessionAdmissions: [string, Admission][];
      invites: Invite[];
      sessionId: string | null;
      pair: LockedGpuPair | null;
      queueVersion: number;
      queueVersions?: [string, number][];
      queue: Array<
        SharedQueueEntry & { requestVersion?: number; admissionState?: "ACTIVE" | "WAITING" }
      >;
      audits: SharedQueueAudit[];
      projectOwners?: [string, FixtureTenantScope][];
      orchestration?: ProviderFreeOrchestrationState;
    };
    return {
      ...value,
      queue: value.queue.map((entry) => ({
        ...entry,
        requestVersion: entry.requestVersion ?? 1,
        admissionState: entry.admissionState ?? entry.state,
      })),
      admissions: new Map(value.admissions.map((item) => [item.email, item])),
      sessionAdmissions: new Map(value.sessionAdmissions),
      invites: new Map(value.invites.map((item) => [item.codeHash, item])),
      queueVersions: new Map(value.queueVersions ?? []),
      projectOwners: new Map(value.projectOwners ?? []),
      orchestration:
        value.orchestration === undefined
          ? new ProviderFreeMvpOrchestrator().snapshot()
          : normalizeProviderFreeSnapshot(value.orchestration),
    };
  }

  exportSnapshot(): string {
    return JSON.stringify({
      ...this.#state,
      admissions: [...this.#state.admissions.values()],
      sessionAdmissions: [...this.#state.sessionAdmissions.entries()],
      invites: [...this.#state.invites.values()],
      queueVersions: [...this.#state.queueVersions.entries()],
      projectOwners: [...this.#state.projectOwners.entries()],
      orchestration: this.#orchestrator.snapshot(),
    });
  }

  async issueInvite(intendedEmail: string): Promise<{
    code: string;
    emailPassword: string;
    googleAssertion: string;
  }> {
    return this.commitAsync(async () => {
      const email = normalizedEmail(intendedEmail);
      const existing = [...this.#state.invites.values()].filter((invite) => invite.email === email);
      const reusable = existing.find((invite) => {
        const cached = this.#issuedInviteCredentials.get(email);
        return !invite.consumed && cached?.codeHash === invite.codeHash;
      });
      if (reusable !== undefined) return this.#issuedInviteCredentials.get(email)!.credentials;

      const raw = `vf_${crypto.randomUUID()}_${crypto.randomUUID()}`;
      const emailPassword = `vf_pw_${crypto.randomUUID()}`;
      const googleAssertion = `vf_google_${crypto.randomUUID()}_${crypto.randomUUID()}`;
      const codeHash = await hash(raw);
      const invite: Invite = {
        email,
        codeHash,
        emailPasswordHash: await hash(emailPassword),
        googleAssertionHash: await hash(googleAssertion),
        consumed: false,
      };
      // Rotate the one fixture invite in place. This repairs a persisted invite left by a prior
      // one-click attempt while preserving the max-one row invariant; production invite records
      // are handled by the hosted repository and never reach this fixture store.
      for (const prior of existing) this.#state.invites.delete(prior.codeHash);
      this.#state.invites.set(codeHash, invite);
      this.#issuedInviteCredentials.set(email, {
        codeHash,
        credentials: { code: raw, emailPassword, googleAssertion },
      });
      return { code: raw, emailPassword, googleAssertion };
    });
  }

  seedAdmittedSession(sessionId: string, emailValue: string): void {
    const email = normalizedEmail(emailValue);
    if (this.#state.sessionAdmissions.get(sessionId)?.email === email) return;
    this.commit(() => {
      const admission =
        this.#state.admissions.get(email) ??
        Object.freeze({
          email,
          method: "EMAIL_PASSWORD" as const,
          credentialHash: "fixture-bootstrap-identity",
          tenant: fixtureTenantScope(email),
        });
      this.#state.admissions.set(email, admission);
      this.#state.sessionAdmissions.set(sessionId, admission);
    });
  }

  /** The tenant scope bound to one session, or null when the session is not admitted. */
  tenant(sessionId: string): FixtureTenantScope | null {
    return this.#state.sessionAdmissions.get(sessionId)?.tenant ?? null;
  }

  identity(sessionId: string): { readonly email: string; readonly tenant: FixtureTenantScope } {
    const admission = this.requireAdmission(sessionId);
    return Object.freeze({ email: admission.email, tenant: admission.tenant });
  }

  async authenticate(input: {
    sessionId: string;
    method: FixtureAuthMethod;
    email: string;
    emailPassword?: string;
    googleAccountEmail?: string;
    googleAssertion?: string;
    inviteCode?: string;
  }): Promise<{
    outcome: "ADMITTED" | "RETURNING";
    email: string;
    rights: "EQUAL";
    tenant: FixtureTenantScope;
  }> {
    return this.commitAsync(async () => {
      const email = normalizedEmail(input.email);
      const presentedCredential =
        input.method === "EMAIL_PASSWORD" ? input.emailPassword : input.googleAssertion;
      if (!presentedCredential || presentedCredential.length < 16) {
        throw new SharedFixtureError(
          "AUTH_CREDENTIAL_REQUIRED",
          403,
          input.method === "EMAIL_PASSWORD"
            ? "The issued email password fixture is required."
            : "The issued Google fixture assertion is required.",
        );
      }
      const presentedCredentialHash = await hash(presentedCredential);
      if (input.method === "GOOGLE") {
        const google = normalizedEmail(input.googleAccountEmail ?? "");
        if (google !== email) {
          throw new SharedFixtureError(
            "GOOGLE_EMAIL_MISMATCH",
            403,
            "Google verified email must equal the login email.",
          );
        }
      }
      const codeHash = input.inviteCode ? await hash(input.inviteCode) : null;
      const invite = codeHash === null ? undefined : this.#state.invites.get(codeHash);
      const existing = this.#state.admissions.get(email);
      if (existing) {
        const expectedCredentialHash =
          invite === undefined
            ? null
            : input.method === "EMAIL_PASSWORD"
              ? invite.emailPasswordHash
              : invite.googleAssertionHash;
        const validReentryInvite =
          invite !== undefined &&
          !invite.consumed &&
          invite.email === email &&
          presentedCredentialHash === expectedCredentialHash;
        if (!validReentryInvite && existing.method !== input.method) {
          throw new SharedFixtureError(
            "AUTH_IDENTITY_CONFLICT",
            409,
            "Use the login method already bound to this email.",
          );
        }
        if (!validReentryInvite && existing.credentialHash !== presentedCredentialHash) {
          throw new SharedFixtureError(
            "AUTH_CREDENTIAL_INVALID",
            403,
            "Fixture credential is invalid.",
          );
        }
        const admitted = validReentryInvite
          ? Object.freeze({
              ...existing,
              method: input.method,
              credentialHash: presentedCredentialHash,
            })
          : existing;
        if (validReentryInvite) {
          invite.consumed = true;
          this.#state.admissions.set(email, admitted);
        }
        this.#state.sessionAdmissions.set(input.sessionId, admitted);
        return { outcome: "RETURNING", email, rights: "EQUAL", tenant: admitted.tenant };
      }
      if (!input.inviteCode) {
        throw new SharedFixtureError("INVITE_REQUIRED", 403, "A one-time invite code is required.");
      }
      if (!invite) throw new SharedFixtureError("INVITE_INVALID", 403, "Invite code is invalid.");
      if (invite.consumed)
        throw new SharedFixtureError("INVITE_ALREADY_USED", 409, "Invite code was already used.");
      if (invite.email !== email) {
        throw new SharedFixtureError(
          "INVITE_EMAIL_MISMATCH",
          403,
          "Invite code belongs to another verified email.",
        );
      }
      const expectedCredentialHash =
        input.method === "EMAIL_PASSWORD" ? invite.emailPasswordHash : invite.googleAssertionHash;
      if (presentedCredentialHash !== expectedCredentialHash) {
        throw new SharedFixtureError(
          "AUTH_CREDENTIAL_INVALID",
          403,
          "Fixture credential is invalid.",
        );
      }
      const admission = Object.freeze({
        email,
        method: input.method,
        credentialHash: presentedCredentialHash,
        // DEC_TENANCY_002: admission creates exactly one private account and default workspace.
        tenant: fixtureTenantScope(email),
      });
      invite.consumed = true;
      this.#state.admissions.set(email, admission);
      this.#state.sessionAdmissions.set(input.sessionId, admission);
      return { outcome: "ADMITTED", email, rights: "EQUAL", tenant: admission.tenant };
    });
  }

  view(sessionId: string): SharedAppView {
    const admission = this.#state.sessionAdmissions.get(sessionId);
    const tenant = admission?.tenant;
    const owns = (owner: FixtureTenantScope | undefined) =>
      tenant !== undefined &&
      owner?.accountId === tenant.accountId &&
      owner.workspaceId === tenant.workspaceId;
    const queue = positions(this.#state.queue.filter((entry) => owns(entry)));
    const snapshot = this.#orchestrator.snapshot();
    const ownedProjectIds = new Set(
      snapshot.projects
        .filter((project) => owns(this.#state.projectOwners.get(project.projectId)))
        .map((project) => project.projectId),
    );
    const filterSession = (candidate: ProviderFreeOrchestrationState["session"]) => {
      if (candidate === null) return null;
      const attempts = Object.values(candidate.lanes).flatMap((lane) => lane.attempts);
      const ownsCandidateActive =
        candidate.activeProjectId !== null && ownedProjectIds.has(candidate.activeProjectId);
      if (
        !ownsCandidateActive &&
        !attempts.some((attempt) => ownedProjectIds.has(attempt.originProjectId))
      )
        return null;
      const filtered = structuredClone(candidate);
      for (const lane of Object.values(filtered.lanes)) {
        const ownedAttempts = lane.attempts.filter((attempt) =>
          ownedProjectIds.has(attempt.originProjectId),
        );
        lane.attempts.splice(0, lane.attempts.length, ...ownedAttempts);
      }
      if (filtered.activeProjectId !== null && !ownedProjectIds.has(filtered.activeProjectId)) {
        filtered.activeProjectId = null;
      }
      return filtered;
    };
    const orchestration: ProviderFreeOrchestrationState = {
      ...snapshot,
      session: filterSession(snapshot.session),
      lastClosedSession: filterSession(snapshot.lastClosedSession),
      projects: snapshot.projects.filter((project) => ownedProjectIds.has(project.projectId)),
      events: snapshot.events.filter(
        (event) => event.projectId !== null && ownedProjectIds.has(event.projectId),
      ),
    };
    return {
      rights: "EQUAL",
      admission: {
        admitted: admission !== undefined,
        email: admission?.email ?? null,
        authMethod: admission?.method ?? null,
      },
      inventory: liveOffers(),
      session:
        admission !== undefined && queue.length > 0 && this.#state.sessionId && this.#state.pair
          ? {
              id: `fixture-${admission.tenant.accountId}`,
              queueVersion: this.queueVersion(admission),
              gpuPair: { ...this.#state.pair, lockedAt: queue[0]!.createdAt },
            }
          : null,
      queue,
      audits: this.#state.audits.filter((audit) => owns(audit)),
      orchestration,
      canSelectGpuPair: this.#state.sessionId === null && this.#state.queue.length === 0,
      providerCallsAuthorized: false,
      authorizedSpendUsd: 0,
    };
  }

  privateFairQueueView(sessionId: string): PrivateFairQueueView {
    const admission = this.requireAdmission(sessionId);
    const owns = (entry: SharedQueueEntry) =>
      entry.accountId === admission.tenant.accountId &&
      entry.workspaceId === admission.tenant.workspaceId;
    const owned = positions(this.#state.queue.filter(owns));
    return Object.freeze({
      schemaVersion: "videoforge.private-fair-queue/v1" as const,
      queueVersion: this.queueVersion(admission),
      capacity: Object.freeze({
        totalSlots: 2 as const,
        ownedActive: (owned.some((entry) => entry.admissionState === "ACTIVE") ? 1 : 0) as 0 | 1,
        accountActiveLimit: 1 as const,
        otherAccountDetailsVisible: false as const,
      }),
      requests: Object.freeze(
        owned.map((entry) => {
          const stage = entry.admissionState;
          return Object.freeze({
            id: entry.id,
            projectId: entry.projectId,
            title: entry.title,
            kind: "VIDEO" as const,
            state: entry.admissionState,
            stage,
            accountPosition: entry.position,
            version: entry.requestVersion,
            canReorder: entry.admissionState === "WAITING",
            canCancel: entry.admissionState === "WAITING",
            createdAt: entry.createdAt,
          });
        }),
      ),
      fairness: Object.freeze({
        policy: "DETERMINISTIC_ACCOUNT_ROTATION" as const,
        reorderScope: "ACCOUNT_ONLY" as const,
        previewsBelowEligibleVideos: true as const,
      }),
      providerCallsAuthorized: false as const,
      authorizedSpendUsd: 0 as const,
    });
  }

  async waitForSettled(): Promise<void> {
    await this.#asyncMutationTail;
  }

  startOrEnqueue(input: {
    sessionId: string;
    projectId: string;
    title: string;
    imageReceiptId?: string;
    avatarReceiptId?: string;
    admission?: {
      readonly requestId: string;
      readonly state: "WAITING" | "ADMITTED" | "ACTIVE" | "CANCELLING";
      readonly version: number;
    };
  }): { outcome: "STARTED" | "QUEUED"; queueVersion: number } {
    return this.commit(() => {
      const admission = this.requireAdmission(input.sessionId);
      const replay = this.#state.queue.find(
        (entry) =>
          entry.accountId === admission.tenant.accountId &&
          entry.workspaceId === admission.tenant.workspaceId &&
          entry.projectId === input.projectId &&
          (input.admission === undefined || entry.id === input.admission.requestId),
      );
      if (replay !== undefined) {
        return {
          outcome: replay.state === "ACTIVE" ? "STARTED" : "QUEUED",
          queueVersion: this.queueVersion(admission),
        };
      }
      const actor = admission.email;
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.queueVersion(admission);
      let gpuPair: LockedGpuPair | null = null;
      const accountAlreadyActive = this.#state.queue.some(
        (entry) =>
          entry.admissionState === "ACTIVE" && entry.accountId === admission.tenant.accountId,
      );
      const activeAccounts = new Set(
        this.#state.queue
          .filter((entry) => entry.admissionState === "ACTIVE")
          .map((entry) => entry.accountId),
      );
      const fairlyAdmitted =
        input.admission === undefined
          ? !accountAlreadyActive && activeAccounts.size < 2
          : input.admission.state !== "WAITING";
      const startsDownstream =
        input.admission === undefined
          ? fairlyAdmitted
          : this.#orchestrator.snapshot().session === null;
      if (this.#state.sessionId === null) {
        const offers = liveOffers();
        // Endpoint/runtime choice is operator-owned. Ordinary Generate never accepts a GPU or Pod
        // lifecycle selection; the provider-free fixture resolves its immutable synthetic lanes.
        const image = offers.find(
          (offer) => offer.lane === "image_media" && offer.gpuSku === "NVIDIA RTX 4090",
        );
        const avatar = offers.find(
          (offer) => offer.lane === "avatar_primary" && offer.gpuSku === "NVIDIA RTX 4090",
        );
        if (!image || !avatar)
          throw new Error("provider-free fixture lane configuration is missing");
        this.#state.sessionId = crypto.randomUUID();
        gpuPair = Object.freeze({ image, avatar, lockedAt: new Date().toISOString() });
        this.#state.pair = gpuPair;
      }
      const operation: SharedQueueAudit["operation"] = startsDownstream ? "START" : "ADD";
      const outcome: "STARTED" | "QUEUED" = fairlyAdmitted ? "STARTED" : "QUEUED";
      const queueEntryId = input.admission?.requestId ?? crypto.randomUUID();
      this.incrementQueueVersion(admission.tenant);
      this.#state.queue = positions([
        ...this.#state.queue,
        {
          id: queueEntryId,
          projectId: input.projectId,
          title: input.title,
          state: startsDownstream ? "ACTIVE" : "WAITING",
          admissionState: fairlyAdmitted ? "ACTIVE" : "WAITING",
          actor,
          accountId: admission.tenant.accountId,
          workspaceId: admission.tenant.workspaceId,
          position: 0,
          createdAt: new Date().toISOString(),
          requestVersion: input.admission?.version ?? 1,
        },
      ]);
      this.#state.projectOwners.set(input.projectId, admission.tenant);
      if (this.#orchestrator.snapshot().session === null) {
        const pair = gpuPair ?? this.#state.pair;
        if (pair === null) throw new Error("Started fixture session is missing its GPU pair.");
        this.#orchestrator.startSession({
          queueEntryId,
          projectId: input.projectId,
          title: input.title,
          gpuPair: {
            mage: {
              receiptId: pair.image.receiptId,
              gpuSku: pair.image.gpuSku,
            },
            echo: {
              receiptId: pair.avatar.receiptId,
              gpuSku: pair.avatar.gpuSku,
            },
          },
        });
      } else {
        this.#orchestrator.addWaiting(queueEntryId, input.projectId, input.title);
      }
      this.audit(operation, admission, oldOrder, oldVersion);
      return { outcome, queueVersion: this.queueVersion(admission) };
    });
  }

  /**
   * Records only the private V2 admission projection. It deliberately cannot select a GPU, create
   * a global session, or start the superseded compatibility orchestrator.
   */
  trackV2Request(input: {
    readonly sessionId: string;
    readonly projectId: string;
    readonly title: string;
    readonly admission: {
      readonly requestId: string;
      readonly state: "WAITING" | "ADMITTED" | "ACTIVE" | "CANCELLING";
      readonly version: number;
    };
  }): { readonly outcome: "STARTED" | "QUEUED"; readonly queueVersion: number } {
    return this.commit(() => {
      const admission = this.requireAdmission(input.sessionId);
      const replay = this.#state.queue.find((entry) => entry.id === input.admission.requestId);
      if (replay !== undefined) {
        this.assertOwner(admission, replay);
        return {
          outcome: replay.admissionState === "WAITING" ? "QUEUED" : "STARTED",
          queueVersion: this.queueVersion(admission),
        };
      }
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.queueVersion(admission);
      const active = input.admission.state !== "WAITING";
      this.incrementQueueVersion(admission.tenant);
      this.#state.queue = positions([
        ...this.#state.queue,
        {
          id: input.admission.requestId,
          projectId: input.projectId,
          title: input.title,
          state: active ? "ACTIVE" : "WAITING",
          admissionState: active ? "ACTIVE" : "WAITING",
          actor: admission.email,
          accountId: admission.tenant.accountId,
          workspaceId: admission.tenant.workspaceId,
          position: 0,
          createdAt: new Date().toISOString(),
          requestVersion: input.admission.version,
        },
      ]);
      this.audit(active ? "START" : "ADD", admission, oldOrder, oldVersion);
      return {
        outcome: active ? "STARTED" : "QUEUED",
        queueVersion: this.queueVersion(admission),
      };
    });
  }

  reconcileFairAdmission(sessionId: string, snapshot: readonly FairAdmissionSnapshotItem[]): void {
    this.commit(() => {
      const admission = this.requireAdmission(sessionId);
      const truth = new Map(snapshot.map((item) => [item.requestId, item]));
      this.#state.queue = positions(
        this.#state.queue
          .filter(
            (entry) =>
              entry.accountId !== admission.tenant.accountId ||
              entry.workspaceId !== admission.tenant.workspaceId ||
              truth.has(entry.id),
          )
          .map((entry) => {
            const item = truth.get(entry.id);
            if (item === undefined) return entry;
            return {
              ...entry,
              admissionState: item.state === "WAITING" ? ("WAITING" as const) : ("ACTIVE" as const),
              position: Number(item.queueOrder),
              requestVersion: item.version,
            };
          })
          .sort((left, right) => left.position - right.position),
      );
    });
  }

  reorder(input: {
    sessionId: string;
    entryId: string;
    toPosition: number;
    ifMatch: number;
  }): void {
    this.commit(() => {
      const admission = this.requireAdmission(input.sessionId);
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.queueVersion(admission);
      const index = this.#state.queue.findIndex((entry) => entry.id === input.entryId);
      const entry = this.#state.queue[index];
      if (!entry)
        throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
      this.assertOwner(admission, entry);
      if (
        input.ifMatch !== entry.requestVersion &&
        input.ifMatch !== this.queueVersion(admission)
      ) {
        throw new SharedFixtureError(
          "QUEUE_VERSION_MISMATCH",
          409,
          "Queue changed. Refresh before changing your order.",
        );
      }
      if (entry.state !== "WAITING")
        throw new SharedFixtureError(
          "ACTIVE_QUEUE_ENTRY_IMMUTABLE",
          409,
          "Active entries cannot move.",
        );
      const waiting = this.#state.queue.filter(
        (item) =>
          item.state === "WAITING" &&
          item.id !== entry.id &&
          item.accountId === admission.tenant.accountId &&
          item.workspaceId === admission.tenant.workspaceId,
      );
      const ownedActiveCount = this.#state.queue.filter(
        (item) =>
          item.state === "ACTIVE" &&
          item.accountId === admission.tenant.accountId &&
          item.workspaceId === admission.tenant.workspaceId,
      ).length;
      const target = Math.max(0, Math.min(waiting.length, input.toPosition - ownedActiveCount - 1));
      waiting.splice(target, 0, { ...entry, requestVersion: entry.requestVersion + 1 });
      const ownedWaitingSlots = this.#state.queue
        .map((item, slot) => ({ item, slot }))
        .filter(({ item }) => waiting.some((ownedEntry) => ownedEntry.id === item.id))
        .map(({ slot }) => slot);
      const reorderedQueue = [...this.#state.queue];
      for (const [ownedIndex, slot] of ownedWaitingSlots.entries()) {
        reorderedQueue[slot] = waiting[ownedIndex]!;
      }
      this.#state.queue = positions(reorderedQueue);
      this.incrementQueueVersion(admission.tenant);
      this.audit("MOVE", admission, oldOrder, oldVersion);
    });
  }

  remove(input: { sessionId: string; entryId: string; ifMatch: number }): void {
    this.commit(() => {
      const admission = this.requireAdmission(input.sessionId);
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.queueVersion(admission);
      const entry = this.#state.queue.find((item) => item.id === input.entryId);
      if (!entry)
        throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
      this.assertOwner(admission, entry);
      if (
        input.ifMatch !== entry.requestVersion &&
        input.ifMatch !== this.queueVersion(admission)
      ) {
        throw new SharedFixtureError(
          "QUEUE_VERSION_MISMATCH",
          409,
          "Queue changed. Refresh before changing your order.",
        );
      }
      if (entry.state !== "WAITING")
        throw new SharedFixtureError(
          "ACTIVE_QUEUE_ENTRY_IMMUTABLE",
          409,
          "Active entries cannot be removed.",
        );
      this.#state.queue = positions(this.#state.queue.filter((item) => item.id !== input.entryId));
      this.#orchestrator.removeWaiting(entry.projectId);
      this.incrementQueueVersion(admission.tenant);
      this.audit("REMOVE", admission, oldOrder, oldVersion);
    });
  }

  async advance(sessionId: string): Promise<ProviderFreeAdvanceResult> {
    return this.commitAsync(async () => {
      this.assertActiveOwner(this.requireAdmission(sessionId));
      const waitingProjectIds = this.#state.queue
        .filter((entry) => entry.state === "WAITING")
        .map((entry) => entry.projectId);
      const activeProjectId = this.#orchestrator.snapshot().session?.activeProjectId;
      const activeProject =
        activeProjectId === null || activeProjectId === undefined
          ? undefined
          : this.#orchestrator.project(activeProjectId);
      const bundle =
        activeProjectId === null || activeProjectId === undefined
          ? undefined
          : await buildProviderFreeProjectBundle(activeProjectId);
      const foundations = bundle?.receipts;
      if (bundle !== undefined && activeProject !== undefined) {
        if (["BOOTING", "PREPARING"].includes(activeProject.stage))
          await this.#artifacts.persistFoundations(bundle);
      }
      let materialized: ProviderFreeMaterializedReceipts | undefined;
      if (bundle !== undefined && activeProject?.stage === "GENERATING") {
        materialized =
          activeProject.barriers.mageOutputSha256 === null
            ? { mageOutput: await this.#artifacts.laneReceipt(bundle, "mage_image") }
            : activeProject.barriers.echoOutputSha256 === null
              ? { echoOutput: await this.#artifacts.laneReceipt(bundle, "echo_avatar") }
              : undefined;
      } else if (bundle !== undefined && activeProject?.stage === "RENDERING") {
        materialized = { render: await this.#artifacts.render(bundle) };
      }
      const result = await this.#orchestrator.advance(
        waitingProjectIds,
        foundations,
        this.freshGpuRevalidation(),
        materialized,
      );
      this.synchronizeAfterAdvance(result);
      return result;
    });
  }

  cancelActive(sessionId: string): ProviderFreeAdvanceResult {
    return this.commit(() => {
      this.assertActiveOwner(this.requireAdmission(sessionId));
      const waitingProjectIds = this.#state.queue
        .filter((entry) => entry.state === "WAITING")
        .map((entry) => entry.projectId);
      const result = this.#orchestrator.cancelActive(
        waitingProjectIds,
        this.freshGpuRevalidation(),
      );
      this.synchronizeAfterAdvance(result);
      return result;
    });
  }

  recover(sessionId: string): void {
    this.commit(() => {
      this.assertActiveOwner(this.requireAdmission(sessionId));
      this.#orchestrator.recover();
    });
  }

  acceptLaneCallback(
    authSessionId: string,
    input: {
      sessionId: string;
      projectId: string;
      lane: ProviderFreeLane;
      podId: string;
      gpuSku: string;
      volumeId: string;
      sequence: number;
    },
  ): void {
    this.commit(() => {
      this.assertProjectOwner(this.requireAdmission(authSessionId), input.projectId);
      this.#orchestrator.acceptLaneCallback(input);
    });
  }

  projectOrchestration(sessionId: string, projectId: string): ProviderFreeProjectState {
    this.assertProjectOwner(this.requireAdmission(sessionId), projectId);
    return this.#orchestrator.project(projectId);
  }

  assertAdmitted(sessionId: string): void {
    this.requireAdmission(sessionId);
  }

  async finalMp4(sessionId: string, projectId: string): Promise<Uint8Array> {
    this.assertProjectOwner(this.requireAdmission(sessionId), projectId);
    const project = this.#orchestrator.project(projectId);
    if (project.stage !== "READY_FOR_REVIEW" || project.finalAsset === null)
      throw new SharedFixtureError(
        "PROJECT_DOWNLOAD_NOT_READY",
        409,
        "Every transcript, generation, and render barrier must complete before download.",
      );
    const bytes = await this.#artifacts.read(project.finalAsset.sha256);
    if (bytes === null || bytes.length !== project.finalAsset.byteSize)
      throw new SharedFixtureError(
        "FINAL_ASSET_UNAVAILABLE",
        409,
        "Content-addressed final MP4 bytes are unavailable or incomplete.",
      );
    const actual = `sha256:${await hashBytes(bytes)}`;
    if (actual !== project.finalAsset.sha256)
      throw new SharedFixtureError(
        "FINAL_ASSET_HASH_MISMATCH",
        409,
        "Content-addressed final MP4 bytes failed exact checksum verification.",
      );
    return bytes;
  }

  private synchronizeAfterAdvance(result: ProviderFreeAdvanceResult): void {
    if (result.completedProjectId !== null) {
      this.#state.queue = this.#state.queue.filter(
        (entry) => entry.projectId !== result.completedProjectId,
      );
    }
    if (result.promotedProjectId !== null) {
      this.#state.queue = this.#state.queue.map((entry) =>
        entry.projectId === result.promotedProjectId ? { ...entry, state: "ACTIVE" } : entry,
      );
    }
    this.#state.queue = positions(this.#state.queue);
    if (result.completedProjectId !== null || result.promotedProjectId !== null) {
      const changedTenants = new Map<string, FixtureTenantScope>();
      for (const projectId of [result.completedProjectId, result.promotedProjectId]) {
        if (projectId === null) continue;
        const tenant = this.#state.projectOwners.get(projectId);
        if (tenant !== undefined) changedTenants.set(this.tenantKey(tenant), tenant);
      }
      for (const tenant of changedTenants.values()) this.incrementQueueVersion(tenant);
    }
    if (result.sessionClosed) {
      if (this.#state.queue.length !== 0) {
        throw new ProviderFreeOrchestrationError(
          "SESSION_CLOSE_QUEUE_NOT_EMPTY",
          "Synthetic session closed while queue still contained work.",
        );
      }
      this.#state.sessionId = null;
      this.#state.pair = null;
    }
  }

  private freshGpuRevalidation(): ProviderFreeGpuRevalidationPair | undefined {
    const pair = this.#state.pair;
    if (pair === null) return undefined;
    const offers = liveOffers();
    const observedAt = new Date();
    const expiresAt = new Date(observedAt.getTime() + 60_000).toISOString();
    const receipt = (locked: GpuOffer, lane: GpuOffer["lane"]) => {
      const current = offers.find(
        (offer) =>
          offer.lane === lane &&
          offer.receiptId === locked.receiptId &&
          offer.gpuSku === locked.gpuSku,
      );
      if (current === undefined)
        throw new SharedFixtureError(
          "GPU_REVALIDATION_UNAVAILABLE",
          409,
          `Locked ${lane} GPU is absent from current fake inventory.`,
        );
      return Object.freeze({
        validationId: `fixture-gpu-validation-${crypto.randomUUID()}`,
        lockedReceiptId: locked.receiptId,
        gpuSku: locked.gpuSku,
        observedAt: observedAt.toISOString(),
        expiresAt,
        providerCallsAuthorized: false as const,
      });
    };
    return Object.freeze({
      mage: receipt(pair.image, "image_media"),
      echo: receipt(pair.avatar, "avatar_primary"),
    });
  }

  private commit<T>(operation: () => T): T {
    if (this.#pendingAsyncMutations > 0)
      throw new SharedFixtureError(
        "SHARED_MUTATION_IN_PROGRESS",
        409,
        "Another shared-app mutation is still committing. Retry from fresh state.",
      );
    const before = this.exportSnapshot();
    try {
      const result = operation();
      this.persist();
      return result;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  private async commitAsync<T>(operation: () => Promise<T>): Promise<T> {
    this.#pendingAsyncMutations += 1;
    const committed = this.#asyncMutationTail.then(async () => {
      const before = this.exportSnapshot();
      try {
        const result = await operation();
        this.persist();
        return result;
      } catch (error) {
        this.restore(before);
        throw error;
      }
    });
    this.#asyncMutationTail = committed.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await committed;
    } finally {
      this.#pendingAsyncMutations -= 1;
    }
  }

  private restore(snapshot: string): void {
    this.#state = SharedAppFixtureStore.parse(snapshot);
    this.#orchestrator = new ProviderFreeMvpOrchestrator(this.#state.orchestration);
  }

  private requireAdmission(sessionId: string): Admission {
    const admission = this.#state.sessionAdmissions.get(sessionId);
    if (!admission)
      throw new SharedFixtureError("ADMISSION_REQUIRED", 403, "Complete invite admission first.");
    return admission;
  }

  private tenantKey(tenant: FixtureTenantScope): string {
    return `${tenant.accountId}\u0000${tenant.workspaceId}`;
  }

  private queueVersion(admission: Admission): number {
    return this.#state.queueVersions.get(this.tenantKey(admission.tenant)) ?? 0;
  }

  private incrementQueueVersion(tenant: FixtureTenantScope): void {
    const key = this.tenantKey(tenant);
    this.#state.queueVersions.set(key, (this.#state.queueVersions.get(key) ?? 0) + 1);
  }

  private requireVersion(admission: Admission, ifMatch: number): void {
    if (ifMatch !== this.queueVersion(admission)) {
      throw new SharedFixtureError(
        "QUEUE_VERSION_CONFLICT",
        409,
        "Queue changed. Refresh before retrying.",
      );
    }
  }

  private assertOwner(admission: Admission, entry: SharedQueueEntry): void {
    if (
      entry.accountId !== admission.tenant.accountId ||
      entry.workspaceId !== admission.tenant.workspaceId
    ) {
      throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
    }
  }

  private assertProjectOwner(admission: Admission, projectId: string): void {
    const owner = this.#state.projectOwners.get(projectId);
    if (
      owner?.accountId !== admission.tenant.accountId ||
      owner.workspaceId !== admission.tenant.workspaceId
    ) {
      throw new SharedFixtureError("PROJECT_NOT_FOUND", 404, "Project not found.");
    }
  }

  private assertActiveOwner(admission: Admission): void {
    const session = this.#orchestrator.snapshot().session;
    if (session === null) {
      throw new SharedFixtureError("PROJECT_NOT_FOUND", 404, "Project not found.");
    }
    if (session.activeProjectId !== null) {
      this.assertProjectOwner(admission, session.activeProjectId);
      return;
    }
    const candidateProjectIds = [
      ...Object.values(session.lanes).flatMap((lane) =>
        lane.attempts.map((attempt) => attempt.originProjectId),
      ),
    ];
    if (
      !candidateProjectIds.some((projectId) => {
        const owner = this.#state.projectOwners.get(projectId);
        return (
          owner?.accountId === admission.tenant.accountId &&
          owner.workspaceId === admission.tenant.workspaceId
        );
      })
    ) {
      throw new SharedFixtureError("PROJECT_NOT_FOUND", 404, "Project not found.");
    }
  }

  private audit(
    operation: SharedQueueAudit["operation"],
    admission: Admission,
    oldOrder: string[],
    oldVersion: number,
  ): void {
    const ownedIds = new Set(
      this.#state.queue
        .filter(
          (entry) =>
            entry.accountId === admission.tenant.accountId &&
            entry.workspaceId === admission.tenant.workspaceId,
        )
        .map((entry) => entry.id),
    );
    this.#state.audits.push({
      id: crypto.randomUUID(),
      operation,
      actor: admission.email,
      accountId: admission.tenant.accountId,
      workspaceId: admission.tenant.workspaceId,
      oldOrder: oldOrder.filter((id) => ownedIds.has(id)),
      newOrder: currentOrder(this.#state.queue).filter((id) => ownedIds.has(id)),
      oldVersion,
      newVersion: this.queueVersion(admission),
      occurredAt: new Date().toISOString(),
    });
  }

  private persist(): void {
    this.#state.orchestration = this.#orchestrator.snapshot();
    this.#persistence.write(this.exportSnapshot());
  }
}
