import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const SIGNATURE = /^[a-f0-9]{64,512}$/u;
const MAX_SMOKE_AGE_MS = 15 * 60 * 1_000;

export const V213_RELEASE_CHROME_REQUEST_SCHEMA =
  "videoforge.v2-13-release-real-chrome-request/v1" as const;
export const V213_RELEASE_CHROME_OBSERVATION_SCHEMA =
  "videoforge.v2-13-release-real-chrome-observation/v1" as const;
export const V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA =
  "videoforge.v2-13-release-real-chrome-child-receipt/v1" as const;
export const V213_RELEASE_CHROME_ACCEPTANCE_SCHEMA =
  "videoforge.v2-13-release-real-chrome-acceptance/v1" as const;

const REQUEST_KEYS = Object.freeze([
  "accountId",
  "attemptId",
  "deadlineAt",
  "finalOutputReceiptSha256",
  "fullLiveAuthorityId",
  "outputSha256",
  "productionUrlSha256",
  "projectId",
  "projectRevisionId",
  "releaseIdentitySha256",
  "requestSha256",
  "schemaVersion",
  "smokeEvidenceSha256",
  "smokeTerminalAt",
  "workspaceId",
]);

const UNSIGNED_REQUEST_KEYS = Object.freeze(REQUEST_KEYS.filter((key) => key !== "requestSha256"));

const OBSERVATION_KEYS = Object.freeze([
  "accountId",
  "attemptId",
  "browser",
  "downloadPassed",
  "downloadedOutputSha256",
  "finalOutputReceiptSha256",
  "fixtureOrFakeTransportUsed",
  "fullLiveAuthorityId",
  "observedAt",
  "outputSha256",
  "playbackPassed",
  "privateProjectReadbackPassed",
  "privateRevisionReadbackPassed",
  "productionUrlSha256",
  "projectId",
  "projectRevisionId",
  "releaseIdentitySha256",
  "requestSha256",
  "schemaVersion",
  "smokeEvidenceSha256",
  "workspaceId",
]);

const CHILD_RECEIPT_KEYS = Object.freeze([
  "document",
  "keyId",
  "observationSha256",
  "requestSha256",
  "schemaVersion",
  "signatureHex",
]);

const VERIFIED_CHILD_KEYS = Object.freeze([
  "accepted",
  "canonicalReceiptSha256",
  "signatureSha256",
  "signatureVerified",
  "verifierId",
]);

const VERIFIED_SMOKE_KEYS = Object.freeze([
  "accepted",
  "canonicalEvidenceSha256",
  "fullLiveAuthorityId",
  "signatureVerified",
  "smokeEvidenceSha256",
  "smokeTerminalAt",
  "verifierId",
]);

const DOCUMENT_KEYS = Object.freeze([
  "accepted",
  "accountId",
  "browser",
  "canonicalEvidenceSha256",
  "fixtureOrFakeTransportUsed",
  "observedAt",
  "outputSha256",
  "playbackPassed",
  "privateReadbackPassed",
  "productionUrlSha256",
  "projectId",
  "projectRevisionId",
  "releaseIdentitySha256",
  "schemaVersion",
  "signatureVerified",
  "verifierId",
  "verifierSignatureSha256",
  "workspaceId",
]);

export class V213ReleaseChromeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V213ReleaseChromeError";
  }
}

function fail(code: string): never {
  throw new V213ReleaseChromeError(code);
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validSha(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function exactIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function frozenClone<T>(value: T): Readonly<T> {
  return Object.freeze(structuredClone(value));
}

export interface V213ReleaseChromeRequest {
  readonly schemaVersion: typeof V213_RELEASE_CHROME_REQUEST_SCHEMA;
  readonly fullLiveAuthorityId: string;
  readonly smokeEvidenceSha256: Sha256;
  readonly releaseIdentitySha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly outputSha256: Sha256;
  readonly finalOutputReceiptSha256: Sha256 | null;
  readonly attemptId: string | null;
  readonly smokeTerminalAt: string;
  readonly deadlineAt: string;
  readonly requestSha256: Sha256;
}

export type V213ReleaseChromeRequestInput = Omit<
  V213ReleaseChromeRequest,
  "schemaVersion" | "requestSha256"
>;

function requestUnsigned(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(UNSIGNED_REQUEST_KEYS.map((key) => [key, value[key]]));
}

function validateRequestFields(
  value: Readonly<Record<string, unknown>>,
  now: Date,
  verifyHash: boolean,
): void {
  const current = now.getTime();
  const smokeTerminal = Date.parse(String(value.smokeTerminalAt));
  const deadline = Date.parse(String(value.deadlineAt));
  if (!Number.isFinite(current)) fail("V213_RELEASE_CHROME_NOW_INVALID");
  if (!exactKeys(value, REQUEST_KEYS)) fail("V213_RELEASE_CHROME_REQUEST_FIELDS_INVALID");
  if (value.schemaVersion !== V213_RELEASE_CHROME_REQUEST_SCHEMA)
    fail("V213_RELEASE_CHROME_REQUEST_SCHEMA_INVALID");
  if (typeof value.fullLiveAuthorityId !== "string" || !UUID.test(value.fullLiveAuthorityId))
    fail("V213_RELEASE_CHROME_AUTHORITY_INVALID");
  if (
    !validSha(value.smokeEvidenceSha256) ||
    !validSha(value.releaseIdentitySha256) ||
    !validSha(value.productionUrlSha256) ||
    !validSha(value.outputSha256) ||
    (value.finalOutputReceiptSha256 !== null && !validSha(value.finalOutputReceiptSha256))
  )
    fail("V213_RELEASE_CHROME_HASH_INVALID");
  if (
    !validId(value.accountId) ||
    !validId(value.workspaceId) ||
    !validId(value.projectId) ||
    !validId(value.projectRevisionId) ||
    (value.attemptId !== null && !validId(value.attemptId))
  )
    fail("V213_RELEASE_CHROME_SCOPE_INVALID");
  if (!exactIso(value.smokeTerminalAt) || !exactIso(value.deadlineAt))
    fail("V213_RELEASE_CHROME_TIME_INVALID");
  if (smokeTerminal > current) fail("V213_RELEASE_CHROME_SMOKE_FROM_FUTURE");
  if (current - smokeTerminal > MAX_SMOKE_AGE_MS) fail("V213_RELEASE_CHROME_SMOKE_STALE");
  if (deadline <= current) fail("V213_RELEASE_CHROME_DEADLINE_EXPIRED");
  if (deadline > smokeTerminal + MAX_SMOKE_AGE_MS) fail("V213_RELEASE_CHROME_DEADLINE_UNBOUNDED");
  if (
    verifyHash &&
    (!validSha(value.requestSha256) ||
      canonicalSha256(requestUnsigned(value)) !== value.requestSha256)
  )
    fail("V213_RELEASE_CHROME_REQUEST_HASH_INVALID");
}

export function buildV213ReleaseChromeRequest(
  input: V213ReleaseChromeRequestInput,
  now: Date = new Date(),
): V213ReleaseChromeRequest {
  const unsigned = {
    schemaVersion: V213_RELEASE_CHROME_REQUEST_SCHEMA,
    ...structuredClone(input),
  } as Readonly<Record<string, unknown>>;
  const candidate = {
    ...unsigned,
    requestSha256: canonicalSha256(unsigned),
  } as Readonly<Record<string, unknown>>;
  validateRequestFields(candidate, now, true);
  return frozenClone(candidate as unknown as V213ReleaseChromeRequest) as V213ReleaseChromeRequest;
}

export function validateV213ReleaseChromeRequest(
  value: Readonly<object>,
  now: Date = new Date(),
): V213ReleaseChromeRequest {
  const record = value as Readonly<Record<string, unknown>>;
  validateRequestFields(record, now, true);
  return frozenClone(value as unknown as V213ReleaseChromeRequest) as V213ReleaseChromeRequest;
}

export interface V213ReleaseChromeObservation {
  readonly schemaVersion: typeof V213_RELEASE_CHROME_OBSERVATION_SCHEMA;
  readonly requestSha256: Sha256;
  readonly fullLiveAuthorityId: string;
  readonly smokeEvidenceSha256: Sha256;
  readonly releaseIdentitySha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly outputSha256: Sha256;
  readonly finalOutputReceiptSha256: Sha256 | null;
  readonly attemptId: string | null;
  readonly browser: "GOOGLE_CHROME";
  readonly fixtureOrFakeTransportUsed: false;
  readonly playbackPassed: true;
  readonly privateProjectReadbackPassed: true;
  readonly privateRevisionReadbackPassed: true;
  readonly downloadPassed: true;
  readonly downloadedOutputSha256: Sha256;
  readonly observedAt: string;
}

export interface V213ReleaseChromeChildReceipt {
  readonly schemaVersion: typeof V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA;
  readonly requestSha256: Sha256;
  readonly observationSha256: Sha256;
  readonly keyId: string;
  readonly signatureHex: string;
  readonly document: V213ReleaseChromeObservation;
}

export interface V213VerifiedReleaseChromeChildReceipt {
  readonly verifierId: "videoforge-v213-release-chrome-child-receipt-verifier-v1";
  readonly accepted: true;
  readonly canonicalReceiptSha256: Sha256;
  readonly signatureSha256: Sha256;
  readonly signatureVerified: true;
}

export interface V213ReleaseChromeJourneyProcess {
  readonly receipt: Promise<V213ReleaseChromeChildReceipt>;
  kill(signal: "SIGKILL"): void;
}

export type SpawnV213ReleaseChromeJourney = (input: {
  readonly request: V213ReleaseChromeRequest;
  /** The installed-Chrome child receives its private HMAC key only through this inherited FD. */
  readonly childSigningKeyFd: number;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}) => V213ReleaseChromeJourneyProcess;

export type VerifyV213ReleaseChromeChildReceipt = (
  receipt: V213ReleaseChromeChildReceipt,
  request: V213ReleaseChromeRequest,
) => Promise<V213VerifiedReleaseChromeChildReceipt>;

export interface V213VerifiedPersistedSmokeTerminal {
  readonly verifierId: "videoforge-v213-persisted-smoke-terminal-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly signatureVerified: true;
  readonly fullLiveAuthorityId: string;
  readonly smokeEvidenceSha256: Sha256;
  readonly smokeTerminalAt: string;
}

export type VerifyV213PersistedSmokeTerminal = (
  request: V213ReleaseChromeRequest,
  signal: AbortSignal,
) => Promise<V213VerifiedPersistedSmokeTerminal>;

export interface V213ReleaseChromeAcceptanceDocument {
  readonly schemaVersion: typeof V213_RELEASE_CHROME_ACCEPTANCE_SCHEMA;
  readonly verifierId: "videoforge-v213-real-chrome-acceptance-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly signatureVerified: true;
  readonly releaseIdentitySha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly outputSha256: Sha256;
  readonly browser: "GOOGLE_CHROME";
  readonly fixtureOrFakeTransportUsed: false;
  readonly playbackPassed: true;
  readonly privateReadbackPassed: true;
  readonly observedAt: string;
}

export interface V213ReleaseChromeAcceptanceResult {
  /** Opaque stable identity used as the CHROME store reference. */
  readonly artifact: Readonly<{ readonly artifactSha256: Sha256 }>;
  /** Pass to `signAndStore("CHROME", document, artifact.artifactSha256)`. */
  readonly document: V213ReleaseChromeAcceptanceDocument;
}

function validateObservation(
  observation: Readonly<Record<string, unknown>>,
  request: V213ReleaseChromeRequest,
  now: Date,
): void {
  const observedAt = Date.parse(String(observation.observedAt));
  const smokeTerminalAt = Date.parse(request.smokeTerminalAt);
  const deadlineAt = Date.parse(request.deadlineAt);
  if (!exactKeys(observation, OBSERVATION_KEYS))
    fail("V213_RELEASE_CHROME_OBSERVATION_FIELDS_INVALID");
  if (observation.schemaVersion !== V213_RELEASE_CHROME_OBSERVATION_SCHEMA)
    fail("V213_RELEASE_CHROME_OBSERVATION_SCHEMA_INVALID");
  const exactBindings = [
    "requestSha256",
    "fullLiveAuthorityId",
    "smokeEvidenceSha256",
    "releaseIdentitySha256",
    "productionUrlSha256",
    "accountId",
    "workspaceId",
    "projectId",
    "projectRevisionId",
    "outputSha256",
    "finalOutputReceiptSha256",
    "attemptId",
  ] as const;
  if (exactBindings.some((key) => observation[key] !== request[key]))
    fail("V213_RELEASE_CHROME_OBSERVATION_IDENTITY_DRIFT");
  if (observation.browser !== "GOOGLE_CHROME" || observation.fixtureOrFakeTransportUsed !== false)
    fail("V213_RELEASE_CHROME_BROWSER_INVALID");
  if (
    observation.playbackPassed !== true ||
    observation.privateProjectReadbackPassed !== true ||
    observation.privateRevisionReadbackPassed !== true
  )
    fail("V213_RELEASE_CHROME_PRIVATE_PLAYBACK_INVALID");
  if (
    observation.downloadPassed !== true ||
    observation.downloadedOutputSha256 !== request.outputSha256
  )
    fail("V213_RELEASE_CHROME_DOWNLOAD_INVALID");
  if (
    !exactIso(observation.observedAt) ||
    observedAt < smokeTerminalAt ||
    observedAt > now.getTime() ||
    observedAt >= deadlineAt
  )
    fail("V213_RELEASE_CHROME_OBSERVED_TIME_INVALID");
}

function validateChildReceipt(
  receipt: Readonly<Record<string, unknown>>,
  request: V213ReleaseChromeRequest,
  now: Date,
): void {
  if (!exactKeys(receipt, CHILD_RECEIPT_KEYS))
    fail("V213_RELEASE_CHROME_CHILD_RECEIPT_FIELDS_INVALID");
  if (receipt.schemaVersion !== V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA)
    fail("V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA_INVALID");
  if (
    receipt.requestSha256 !== request.requestSha256 ||
    !validId(receipt.keyId) ||
    typeof receipt.signatureHex !== "string" ||
    !SIGNATURE.test(receipt.signatureHex) ||
    !receipt.document ||
    typeof receipt.document !== "object" ||
    Array.isArray(receipt.document)
  )
    fail("V213_RELEASE_CHROME_CHILD_RECEIPT_INVALID");
  validateObservation(receipt.document as unknown as Record<string, unknown>, request, now);
  if (
    !validSha(receipt.observationSha256) ||
    receipt.observationSha256 !== canonicalSha256(receipt.document)
  )
    fail("V213_RELEASE_CHROME_CHILD_RECEIPT_HASH_INVALID");
}

function artifactIdentity(request: V213ReleaseChromeRequest): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: "videoforge.v2-13-release-real-chrome-artifact-identity/v1",
    fullLiveAuthorityId: request.fullLiveAuthorityId,
    smokeEvidenceSha256: request.smokeEvidenceSha256,
    releaseIdentitySha256: request.releaseIdentitySha256,
    productionUrlSha256: request.productionUrlSha256,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    projectRevisionId: request.projectRevisionId,
    outputSha256: request.outputSha256,
    finalOutputReceiptSha256: request.finalOutputReceiptSha256,
    attemptId: request.attemptId,
  });
}

function kill(process: V213ReleaseChromeJourneyProcess, controller: AbortController): void {
  controller.abort();
  try {
    process.kill("SIGKILL");
  } catch {
    // The process may already have exited. The request still fails closed.
  }
}

export async function produceV213ReleaseChromeAcceptance(input: {
  readonly request: V213ReleaseChromeRequest;
  readonly childSigningKeyFd: number;
  readonly spawnJourney: SpawnV213ReleaseChromeJourney;
  readonly verifyPersistedSmokeTerminal: VerifyV213PersistedSmokeTerminal;
  readonly verifyChildReceipt: VerifyV213ReleaseChromeChildReceipt;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
}): Promise<V213ReleaseChromeAcceptanceResult> {
  const now = input.now ?? (() => new Date());
  const request = validateV213ReleaseChromeRequest(
    input.request as unknown as Readonly<Record<string, unknown>>,
    now(),
  );
  if (!Number.isSafeInteger(input.childSigningKeyFd) || input.childSigningKeyFd < 3)
    fail("V213_RELEASE_CHROME_SIGNING_KEY_FD_INVALID");
  if (input.signal?.aborted) fail("V213_RELEASE_CHROME_CANCELLED");
  const deadlineAt = Date.parse(request.deadlineAt);
  const remaining = deadlineAt - now().getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) fail("V213_RELEASE_CHROME_DEADLINE_EXPIRED");
  const controller = new AbortController();
  let process: V213ReleaseChromeJourneyProcess | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let rejectStop: ((reason: V213ReleaseChromeError) => void) | undefined;
  const onAbort = () => {
    cancelled = true;
    controller.abort();
    if (process) kill(process, controller);
    rejectStop?.(new V213ReleaseChromeError("V213_RELEASE_CHROME_CANCELLED"));
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const stop = new Promise<never>((_, reject) => {
    rejectStop = reject;
    timeout = setTimeout(() => {
      controller.abort();
      if (process) kill(process, controller);
      reject(new V213ReleaseChromeError("V213_RELEASE_CHROME_DEADLINE_EXCEEDED"));
    }, remaining);
  });
  try {
    const smoke = await Promise.race([
      input.verifyPersistedSmokeTerminal(request, controller.signal),
      stop,
    ]);
    if (
      !exactKeys(smoke as unknown as Readonly<Record<string, unknown>>, VERIFIED_SMOKE_KEYS) ||
      smoke.verifierId !== "videoforge-v213-persisted-smoke-terminal-verifier-v1" ||
      smoke.accepted !== true ||
      smoke.signatureVerified !== true ||
      smoke.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
      smoke.smokeEvidenceSha256 !== request.smokeEvidenceSha256 ||
      smoke.smokeTerminalAt !== request.smokeTerminalAt ||
      smoke.canonicalEvidenceSha256 !==
        canonicalSha256({ artifactSha256: request.smokeEvidenceSha256 })
    )
      fail("V213_RELEASE_CHROME_SMOKE_TERMINAL_INVALID");
    if (cancelled || controller.signal.aborted) fail("V213_RELEASE_CHROME_CANCELLED");
    if (now().getTime() >= deadlineAt) fail("V213_RELEASE_CHROME_DEADLINE_EXCEEDED");
    try {
      process = input.spawnJourney({
        request,
        childSigningKeyFd: input.childSigningKeyFd,
        deadlineAt: request.deadlineAt,
        signal: controller.signal,
      });
    } catch {
      fail("V213_RELEASE_CHROME_JOURNEY_START_FAILED");
    }
    const receipt = await Promise.race([process.receipt, stop]);
    if (cancelled) fail("V213_RELEASE_CHROME_CANCELLED");
    const current = now();
    if (current.getTime() >= deadlineAt) {
      kill(process, controller);
      fail("V213_RELEASE_CHROME_DEADLINE_EXCEEDED");
    }
    validateChildReceipt(receipt as unknown as Readonly<Record<string, unknown>>, request, current);
    const verified = await Promise.race([input.verifyChildReceipt(receipt, request), stop]);
    if (cancelled || controller.signal.aborted) fail("V213_RELEASE_CHROME_CANCELLED");
    if (
      !exactKeys(verified as unknown as Readonly<Record<string, unknown>>, VERIFIED_CHILD_KEYS) ||
      verified.verifierId !== "videoforge-v213-release-chrome-child-receipt-verifier-v1" ||
      verified.accepted !== true ||
      verified.signatureVerified !== true ||
      !validSha(verified.canonicalReceiptSha256) ||
      verified.canonicalReceiptSha256 !== canonicalSha256(receipt) ||
      !validSha(verified.signatureSha256)
    )
      fail("V213_RELEASE_CHROME_CHILD_SIGNATURE_INVALID");
    if (now().getTime() >= deadlineAt) {
      kill(process, controller);
      fail("V213_RELEASE_CHROME_DEADLINE_EXCEEDED");
    }
    const artifactSha256 = canonicalSha256(artifactIdentity(request));
    const document: V213ReleaseChromeAcceptanceDocument = Object.freeze({
      schemaVersion: V213_RELEASE_CHROME_ACCEPTANCE_SCHEMA,
      verifierId: "videoforge-v213-real-chrome-acceptance-verifier-v1",
      accepted: true,
      canonicalEvidenceSha256: canonicalSha256({ artifactSha256 }),
      verifierSignatureSha256: verified.signatureSha256,
      signatureVerified: true,
      releaseIdentitySha256: request.releaseIdentitySha256,
      productionUrlSha256: request.productionUrlSha256,
      accountId: request.accountId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      projectRevisionId: request.projectRevisionId,
      outputSha256: request.outputSha256,
      browser: "GOOGLE_CHROME",
      fixtureOrFakeTransportUsed: false,
      playbackPassed: true,
      privateReadbackPassed: true,
      observedAt: receipt.document.observedAt,
    });
    if (!exactKeys(document as unknown as Readonly<Record<string, unknown>>, DOCUMENT_KEYS))
      fail("V213_RELEASE_CHROME_ACCEPTANCE_FIELDS_INVALID");
    return Object.freeze({
      artifact: Object.freeze({ artifactSha256 }),
      document,
    });
  } catch (error) {
    if (process && !controller.signal.aborted) kill(process, controller);
    if (error instanceof V213ReleaseChromeError) throw error;
    return fail("V213_RELEASE_CHROME_JOURNEY_FAILED");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
