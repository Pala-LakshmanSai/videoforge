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
  readonly actor: string;
  readonly position: number;
  readonly createdAt: string;
}

export interface SharedQueueAudit {
  readonly id: string;
  readonly operation: "START" | "ADD" | "MOVE" | "REMOVE";
  readonly actor: string;
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
  readonly canSelectGpuPair: boolean;
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

interface Admission {
  readonly email: string;
  readonly method: FixtureAuthMethod;
}

interface Invite {
  readonly email: string;
  readonly codeHash: string;
  consumed: boolean;
}

interface MutableState {
  admissions: Map<string, Admission>;
  sessionAdmissions: Map<string, Admission>;
  invites: Map<string, Invite>;
  sessionId: string | null;
  pair: LockedGpuPair | null;
  queueVersion: number;
  queue: SharedQueueEntry[];
  audits: SharedQueueAudit[];
}

const NOW = "2026-08-13T13:20:00.000Z";
const OFFERS: readonly GpuOffer[] = Object.freeze([
  Object.freeze({
    receiptId: "receipt_image_rtx4090_001",
    lane: "image_media",
    gpuSku: "NVIDIA RTX 4090",
    vramGb: 24,
    rateUsdPerHour: 0.34,
    cloudType: "SECURE",
    region: "EU-RO-1",
    observedAt: NOW,
    expiresAt: "2099-08-13T14:20:00.000Z",
  }),
  Object.freeze({
    receiptId: "receipt_image_a6000_001",
    lane: "image_media",
    gpuSku: "NVIDIA RTX A6000",
    vramGb: 48,
    rateUsdPerHour: 0.42,
    cloudType: "SECURE",
    region: "EU-RO-1",
    observedAt: NOW,
    expiresAt: "2099-08-13T14:20:00.000Z",
  }),
  Object.freeze({
    receiptId: "receipt_avatar_rtx4090_001",
    lane: "avatar_primary",
    gpuSku: "NVIDIA RTX 4090",
    vramGb: 24,
    rateUsdPerHour: 0.34,
    cloudType: "SECURE",
    region: "EU-RO-1",
    observedAt: NOW,
    expiresAt: "2099-08-13T14:20:00.000Z",
  }),
  Object.freeze({
    receiptId: "receipt_avatar_a6000_001",
    lane: "avatar_primary",
    gpuSku: "NVIDIA RTX A6000",
    vramGb: 48,
    rateUsdPerHour: 0.42,
    cloudType: "SECURE",
    region: "EU-RO-1",
    observedAt: NOW,
    expiresAt: "2099-08-13T14:20:00.000Z",
  }),
]);

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

function currentOrder(queue: readonly SharedQueueEntry[]): string[] {
  return queue.map((entry) => entry.id);
}

function positions(queue: readonly SharedQueueEntry[]): SharedQueueEntry[] {
  return queue.map((entry, index) => ({ ...entry, position: index + 1 }));
}

export class SharedAppFixtureStore {
  #state: MutableState;

  constructor(snapshot?: string) {
    this.#state = snapshot ? SharedAppFixtureStore.parse(snapshot) : SharedAppFixtureStore.empty();
  }

  reset(): void {
    this.#state = SharedAppFixtureStore.empty();
  }

  static empty(): MutableState {
    return {
      admissions: new Map(),
      sessionAdmissions: new Map(),
      invites: new Map(),
      sessionId: null,
      pair: null,
      queueVersion: 0,
      queue: [],
      audits: [],
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
      queue: SharedQueueEntry[];
      audits: SharedQueueAudit[];
    };
    return {
      ...value,
      admissions: new Map(value.admissions.map((item) => [item.email, item])),
      sessionAdmissions: new Map(value.sessionAdmissions),
      invites: new Map(value.invites.map((item) => [item.codeHash, item])),
    };
  }

  exportSnapshot(): string {
    return JSON.stringify({
      ...this.#state,
      admissions: [...this.#state.admissions.values()],
      sessionAdmissions: [...this.#state.sessionAdmissions.entries()],
      invites: [...this.#state.invites.values()],
    });
  }

  async issueInvite(intendedEmail: string): Promise<string> {
    const email = normalizedEmail(intendedEmail);
    if ([...this.#state.invites.values()].some((invite) => invite.email === email)) {
      throw new SharedFixtureError(
        "INVITE_EMAIL_EXISTS",
        409,
        "One unique invite already exists for this email.",
      );
    }
    const raw = `vf_${crypto.randomUUID()}_${crypto.randomUUID()}`;
    const codeHash = await hash(raw);
    this.#state.invites.set(codeHash, { email, codeHash, consumed: false });
    return raw;
  }

  seedAdmittedSession(sessionId: string, emailValue: string): void {
    const email = normalizedEmail(emailValue);
    const admission =
      this.#state.admissions.get(email) ??
      Object.freeze({ email, method: "EMAIL_PASSWORD" as const });
    this.#state.admissions.set(email, admission);
    this.#state.sessionAdmissions.set(sessionId, admission);
  }

  async authenticate(input: {
    sessionId: string;
    method: FixtureAuthMethod;
    email: string;
    emailVerified: boolean;
    googleVerifiedEmail?: string;
    inviteCode?: string;
  }): Promise<{ outcome: "ADMITTED" | "RETURNING"; email: string; rights: "EQUAL" }> {
    if (!input.emailVerified) {
      throw new SharedFixtureError(
        "EMAIL_VERIFICATION_REQUIRED",
        403,
        "Verified email is required.",
      );
    }
    const email = normalizedEmail(input.email);
    if (input.method === "GOOGLE") {
      const google = normalizedEmail(input.googleVerifiedEmail ?? "");
      if (google !== email) {
        throw new SharedFixtureError(
          "GOOGLE_EMAIL_MISMATCH",
          403,
          "Google verified email must equal the login email.",
        );
      }
    }
    const existing = this.#state.admissions.get(email);
    if (existing) {
      if (existing.method !== input.method) {
        throw new SharedFixtureError(
          "AUTH_IDENTITY_CONFLICT",
          409,
          "Use the login method already bound to this email.",
        );
      }
      this.#state.sessionAdmissions.set(input.sessionId, existing);
      return { outcome: "RETURNING", email, rights: "EQUAL" };
    }
    if (!input.inviteCode) {
      throw new SharedFixtureError("INVITE_REQUIRED", 403, "A one-time invite code is required.");
    }
    const invite = this.#state.invites.get(await hash(input.inviteCode));
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
    const admission = Object.freeze({ email, method: input.method });
    invite.consumed = true;
    this.#state.admissions.set(email, admission);
    this.#state.sessionAdmissions.set(input.sessionId, admission);
    return { outcome: "ADMITTED", email, rights: "EQUAL" };
  }

  view(sessionId: string): SharedAppView {
    const admission = this.#state.sessionAdmissions.get(sessionId);
    return {
      rights: "EQUAL",
      admission: {
        admitted: admission !== undefined,
        email: admission?.email ?? null,
        authMethod: admission?.method ?? null,
      },
      inventory: OFFERS,
      session:
        this.#state.sessionId && this.#state.pair
          ? {
              id: this.#state.sessionId,
              queueVersion: this.#state.queueVersion,
              gpuPair: this.#state.pair,
            }
          : null,
      queue: this.#state.queue,
      audits: this.#state.audits,
      canSelectGpuPair: this.#state.sessionId === null && this.#state.queue.length === 0,
      providerCallsAuthorized: false,
      authorizedSpendUsd: 0,
    };
  }

  startOrEnqueue(input: {
    sessionId: string;
    projectId: string;
    title: string;
    imageReceiptId?: string;
    avatarReceiptId?: string;
  }): { outcome: "STARTED" | "QUEUED"; queueVersion: number } {
    const actor = this.requireAdmission(input.sessionId).email;
    const oldOrder = currentOrder(this.#state.queue);
    const oldVersion = this.#state.queueVersion;
    let operation: SharedQueueAudit["operation"];
    let outcome: "STARTED" | "QUEUED";
    if (this.#state.sessionId === null && this.#state.queue.length === 0) {
      const image = OFFERS.find(
        (offer) => offer.lane === "image_media" && offer.receiptId === input.imageReceiptId,
      );
      const avatar = OFFERS.find(
        (offer) => offer.lane === "avatar_primary" && offer.receiptId === input.avatarReceiptId,
      );
      if (
        !image ||
        !avatar ||
        Date.parse(image.expiresAt) <= Date.now() ||
        Date.parse(avatar.expiresAt) <= Date.now()
      ) {
        throw new SharedFixtureError(
          "GPU_RECEIPT_STALE",
          409,
          "Refresh and select both current GPU offers.",
        );
      }
      this.#state.sessionId = crypto.randomUUID();
      this.#state.pair = Object.freeze({ image, avatar, lockedAt: new Date().toISOString() });
      operation = "START";
      outcome = "STARTED";
    } else {
      operation = "ADD";
      outcome = "QUEUED";
    }
    this.#state.queueVersion += 1;
    this.#state.queue = positions([
      ...this.#state.queue,
      {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        title: input.title,
        state: outcome === "STARTED" ? "ACTIVE" : "WAITING",
        actor,
        position: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
    this.audit(operation, actor, oldOrder, oldVersion);
    return { outcome, queueVersion: this.#state.queueVersion };
  }

  reorder(input: {
    sessionId: string;
    entryId: string;
    toPosition: number;
    ifMatch: number;
  }): void {
    const actor = this.requireAdmission(input.sessionId).email;
    this.requireVersion(input.ifMatch);
    const oldOrder = currentOrder(this.#state.queue);
    const oldVersion = this.#state.queueVersion;
    const index = this.#state.queue.findIndex((entry) => entry.id === input.entryId);
    const entry = this.#state.queue[index];
    if (!entry)
      throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
    if (entry.state !== "WAITING")
      throw new SharedFixtureError(
        "ACTIVE_QUEUE_ENTRY_IMMUTABLE",
        409,
        "Active entries cannot move.",
      );
    const waiting = this.#state.queue.filter(
      (item) => item.state === "WAITING" && item.id !== entry.id,
    );
    const target = Math.max(0, Math.min(waiting.length, input.toPosition - 2));
    waiting.splice(target, 0, entry);
    this.#state.queue = positions([
      ...this.#state.queue.filter((item) => item.state === "ACTIVE"),
      ...waiting,
    ]);
    this.#state.queueVersion += 1;
    this.audit("MOVE", actor, oldOrder, oldVersion);
  }

  remove(input: { sessionId: string; entryId: string; ifMatch: number }): void {
    const actor = this.requireAdmission(input.sessionId).email;
    this.requireVersion(input.ifMatch);
    const oldOrder = currentOrder(this.#state.queue);
    const oldVersion = this.#state.queueVersion;
    const entry = this.#state.queue.find((item) => item.id === input.entryId);
    if (!entry)
      throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
    if (entry.state !== "WAITING")
      throw new SharedFixtureError(
        "ACTIVE_QUEUE_ENTRY_IMMUTABLE",
        409,
        "Active entries cannot be removed.",
      );
    this.#state.queue = positions(this.#state.queue.filter((item) => item.id !== input.entryId));
    this.#state.queueVersion += 1;
    this.audit("REMOVE", actor, oldOrder, oldVersion);
  }

  private requireAdmission(sessionId: string): Admission {
    const admission = this.#state.sessionAdmissions.get(sessionId);
    if (!admission)
      throw new SharedFixtureError("ADMISSION_REQUIRED", 403, "Complete invite admission first.");
    return admission;
  }

  private requireVersion(ifMatch: number): void {
    if (ifMatch !== this.#state.queueVersion) {
      throw new SharedFixtureError(
        "QUEUE_VERSION_CONFLICT",
        409,
        "Queue changed. Refresh before retrying.",
      );
    }
  }

  private audit(
    operation: SharedQueueAudit["operation"],
    actor: string,
    oldOrder: string[],
    oldVersion: number,
  ): void {
    this.#state.audits.push({
      id: crypto.randomUUID(),
      operation,
      actor,
      oldOrder,
      newOrder: currentOrder(this.#state.queue),
      oldVersion,
      newVersion: this.#state.queueVersion,
      occurredAt: new Date().toISOString(),
    });
  }
}
