const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CLOSE_TIMEOUT_MS = 2_000;

export const V209_REAL_CHROME_SOURCE = "HOSTED_V209_ORDINARY" as const;
export const V209_REAL_CHROME_REQUEST_SCHEMA =
  "videoforge.v2-09-real-chrome-operator-request/v1" as const;
export const V209_REAL_CHROME_PAGE_SCHEMA =
  "videoforge.v2-09-real-chrome-page-observation/v1" as const;
export const V209_REAL_CHROME_CLAIM_SCHEMA = "videoforge.v2-09-generate-click-claim/v1" as const;
export const V209_REAL_CHROME_CLICK_SCHEMA =
  "videoforge.v2-09-generate-click-observation/v1" as const;
export const V209_REAL_CHROME_PROGRESS_SCHEMA =
  "videoforge.v2-09-stage-progress-observation/v1" as const;
export const V209_REAL_CHROME_VIDEO_SCHEMA =
  "videoforge.v2-09-private-video-observation/v1" as const;
export const V209_REAL_CHROME_DOWNLOAD_SCHEMA =
  "videoforge.v2-09-private-download-observation/v1" as const;
export const V209_REAL_CHROME_EVIDENCE_SCHEMA =
  "videoforge.v2-09-real-chrome-operator-evidence/v1" as const;

export type V209RealChromeStage =
  | "QUEUED"
  | "PREPARING"
  | "WAITING_FOR_WORKER"
  | "INITIALIZING"
  | "GENERATING_IMAGES"
  | "GENERATING_AVATAR"
  | "RENDERING"
  | "COMPLETE"
  | "FAILED"
  | "CANCELED";

const STAGES = new Set<V209RealChromeStage>([
  "QUEUED",
  "PREPARING",
  "WAITING_FOR_WORKER",
  "INITIALIZING",
  "GENERATING_IMAGES",
  "GENERATING_AVATAR",
  "RENDERING",
  "COMPLETE",
  "FAILED",
  "CANCELED",
]);

export class V209RealChromeOperatorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V209RealChromeOperatorError";
  }
}

function fail(code: string): never {
  throw new V209RealChromeOperatorError(code);
}

function record(
  value: unknown,
  code = "V209_REAL_CHROME_OBSERVATION_INVALID",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, code = "V209_REAL_CHROME_REQUEST_INVALID"): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(code);
  return value;
}

function sha256(value: unknown, code = "V209_REAL_CHROME_OUTPUT_INVALID"): string {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code);
  return value;
}

function integer(value: unknown, minimum: number, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) fail(code);
  return value;
}

function finite(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

export interface V209RealChromeOperatorRequest {
  readonly schemaVersion: typeof V209_REAL_CHROME_REQUEST_SCHEMA;
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly prepared: V209RealChromePreparedInput;
  readonly maxProgressReads: number;
  readonly pollIntervalMs: number;
  readonly stopAt: string;
}

export interface V209RealChromePreparedInput {
  readonly title: string;
  readonly voiceoverFilename: string;
  readonly voiceoverContentType: "audio/wav" | "audio/mpeg";
  readonly voiceoverContentLength: number;
  readonly voiceoverSha256: string;
  readonly voiceoverDurationMs: number;
  readonly avatarProfileVersionId: string;
  readonly imageStyleVersionId: string;
  readonly spendCapUsd: number;
}

export interface V209RealChromePageObservation {
  readonly schemaVersion: typeof V209_REAL_CHROME_PAGE_SCHEMA;
  readonly browser: "chrome";
  readonly mode: "PRODUCTION" | "FIXTURE";
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly prepared: V209RealChromePreparedInput;
  readonly generateReady: boolean;
  readonly generateClickCount: number;
}

export interface V209GenerateClickClaim {
  readonly schemaVersion: typeof V209_REAL_CHROME_CLAIM_SCHEMA;
  readonly claimId: string;
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly prepared: V209RealChromePreparedInput;
  readonly state: "RESERVED";
  readonly durable: true;
  readonly replayed: false;
  readonly priorClickCount: 0;
  readonly clickOrdinal: 1;
}

export interface V209GenerateClickClaimPort {
  /**
   * Atomically records the only permitted click attempt. A replay must return a nonconforming
   * receipt (or throw), so this operator can never turn an ambiguous click into a second click.
   */
  reserveOneShot(input: {
    readonly source: typeof V209_REAL_CHROME_SOURCE;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly prepared: V209RealChromePreparedInput;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface V209GenerateClickObservation {
  readonly schemaVersion: typeof V209_REAL_CHROME_CLICK_SCHEMA;
  readonly claimId: string;
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly state: "ACKNOWLEDGED";
  readonly clickOrdinal: 1;
  readonly generateClickCount: 1;
  readonly generationRequestId: string;
}

export interface V209StageProgressObservation {
  readonly schemaVersion: typeof V209_REAL_CHROME_PROGRESS_SCHEMA;
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly sequence: number;
  readonly stage: V209RealChromeStage;
  readonly terminalState: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "AMBIGUOUS";
  readonly output: null | {
    readonly renderAttemptId: string;
    readonly outputId: string;
    readonly contentType: "video/mp4";
    readonly contentLength: number;
    readonly sha256: string;
    readonly privateAccess: V209PrivateAccessEvidence;
  };
}

export interface V209PrivateAccessEvidence {
  readonly kind: "SIGNED_R2_GET";
  readonly objectKey: string;
  readonly signedUrlSha256: string;
  readonly algorithm: "AWS4-HMAC-SHA256";
  readonly expiresSeconds: 300;
  readonly signedHeaders: "host";
}

export interface V209StageProgressMonitorPort {
  read(input: {
    readonly source: typeof V209_REAL_CHROME_SOURCE;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly afterSequence: number;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface V209PrivateVideoObservation {
  readonly schemaVersion: typeof V209_REAL_CHROME_VIDEO_SCHEMA;
  readonly mode: "PRODUCTION" | "FIXTURE";
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly renderAttemptId: string;
  readonly outputId: string;
  readonly outputSha256: string;
  readonly privateAccess: V209PrivateAccessEvidence;
  readonly contentType: "video/mp4";
  readonly private: true;
  readonly playing: true;
  readonly durationSeconds: number;
  readonly currentTime: number;
  readonly generateClickCount: 1;
}

export interface V209PrivateVideoSeekObservation
  extends Omit<V209PrivateVideoObservation, "playing"> {
  readonly requestedTime: number;
}

export interface V209PrivateDownloadObservation {
  readonly schemaVersion: typeof V209_REAL_CHROME_DOWNLOAD_SCHEMA;
  readonly mode: "PRODUCTION" | "FIXTURE";
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly renderAttemptId: string;
  readonly outputId: string;
  readonly outputSha256: string;
  readonly privateAccess: V209PrivateAccessEvidence;
  readonly contentType: "video/mp4";
  readonly contentLength: number;
  readonly private: true;
  readonly downloaded: true;
  readonly generateClickCount: 1;
}

export interface V209RealChromeSessionPort {
  readGeneratePage(input: { readonly signal: AbortSignal }): Promise<unknown>;
  clickGenerate(input: {
    readonly claimId: string;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  playPrivateVideo(input: {
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly renderAttemptId: string;
    readonly outputId: string;
    readonly outputSha256: string;
    readonly privateAccess: V209PrivateAccessEvidence;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  seekPrivateVideo(input: {
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly renderAttemptId: string;
    readonly outputId: string;
    readonly outputSha256: string;
    readonly privateAccess: V209PrivateAccessEvidence;
    readonly targetTime: number;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  downloadPrivateVideo(input: {
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly renderAttemptId: string;
    readonly outputId: string;
    readonly outputSha256: string;
    readonly privateAccess: V209PrivateAccessEvidence;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  close(input: { readonly signal: AbortSignal }): Promise<void>;
}

export interface V209RealChromeBrowserPort {
  openSession(input: {
    readonly browser: "chrome";
    readonly headless: false;
    readonly sessionOrdinal: 1;
    readonly signal: AbortSignal;
  }): Promise<V209RealChromeSessionPort>;
}

export interface V209RealChromeOperatorInput {
  readonly request: V209RealChromeOperatorRequest;
  readonly claims: V209GenerateClickClaimPort;
  readonly browser: V209RealChromeBrowserPort;
  readonly progress: V209StageProgressMonitorPort;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface V209RealChromeOperatorEvidence {
  readonly schemaVersion: typeof V209_REAL_CHROME_EVIDENCE_SCHEMA;
  readonly browser: "chrome";
  readonly source: typeof V209_REAL_CHROME_SOURCE;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly prepared: V209RealChromePreparedInput;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly stopAt: string;
  readonly claimId: string;
  readonly generationRequestId: string;
  readonly renderAttemptId: string;
  readonly outputId: string;
  readonly observedStages: readonly V209RealChromeStage[];
  readonly outputSha256: string;
  readonly playbackPrivateAccess: V209PrivateAccessEvidence;
  readonly downloadPrivateAccess: V209PrivateAccessEvidence;
  readonly outputContentLength: number;
  readonly playbackCurrentTime: number;
  readonly seekTargetTime: number;
  readonly postSeekCurrentTime: number;
  readonly durationSeconds: number;
  readonly downloadContentLength: number;
  readonly generateClickCount: 1;
}

function assertRequest(request: V209RealChromeOperatorRequest, nowMs: number): number {
  if (
    request.schemaVersion !== V209_REAL_CHROME_REQUEST_SCHEMA ||
    request.source !== V209_REAL_CHROME_SOURCE
  )
    fail("V209_REAL_CHROME_REQUEST_INVALID");
  identifier(request.accountId);
  identifier(request.workspaceId);
  assertPreparedInput(request.prepared);
  integer(request.maxProgressReads, 1, "V209_REAL_CHROME_REQUEST_INVALID");
  integer(request.pollIntervalMs, 0, "V209_REAL_CHROME_REQUEST_INVALID");
  if (request.maxProgressReads > 1_000 || request.pollIntervalMs > 60_000)
    fail("V209_REAL_CHROME_REQUEST_INVALID");
  if (
    !Number.isFinite(nowMs) ||
    typeof request.stopAt !== "string" ||
    !CANONICAL_UTC_TIMESTAMP.test(request.stopAt)
  )
    fail("V209_REAL_CHROME_REQUEST_INVALID");
  const stopAtMs = Date.parse(request.stopAt);
  if (!Number.isFinite(stopAtMs) || new Date(stopAtMs).toISOString() !== request.stopAt)
    fail("V209_REAL_CHROME_REQUEST_INVALID");
  if (stopAtMs <= nowMs) fail("V209_REAL_CHROME_REQUEST_DEADLINE_EXPIRED");
  return stopAtMs;
}

function assertPreparedInput(value: V209RealChromePreparedInput): void {
  const prepared = record(value, "V209_REAL_CHROME_REQUEST_INVALID");
  const keys = [
    "title",
    "voiceoverFilename",
    "voiceoverContentType",
    "voiceoverContentLength",
    "voiceoverSha256",
    "voiceoverDurationMs",
    "avatarProfileVersionId",
    "imageStyleVersionId",
    "spendCapUsd",
  ] as const;
  if (
    Object.keys(prepared).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(prepared, key)) ||
    typeof prepared.title !== "string" ||
    prepared.title.trim() !== prepared.title ||
    prepared.title.length < 1 ||
    prepared.title.length > 240 ||
    typeof prepared.voiceoverFilename !== "string" ||
    prepared.voiceoverFilename.length < 1 ||
    prepared.voiceoverFilename.length > 160 ||
    prepared.voiceoverFilename.includes("/") ||
    prepared.voiceoverFilename.includes("\\") ||
    !["audio/wav", "audio/mpeg"].includes(String(prepared.voiceoverContentType))
  )
    fail("V209_REAL_CHROME_REQUEST_INVALID");
  const contentLength = integer(
    prepared.voiceoverContentLength,
    1,
    "V209_REAL_CHROME_REQUEST_INVALID",
  );
  if (contentLength > 1_073_741_824) fail("V209_REAL_CHROME_REQUEST_INVALID");
  sha256(prepared.voiceoverSha256, "V209_REAL_CHROME_REQUEST_INVALID");
  const durationMs = integer(
    prepared.voiceoverDurationMs,
    30_000,
    "V209_REAL_CHROME_REQUEST_INVALID",
  );
  if (durationMs > 60_000) fail("V209_REAL_CHROME_REQUEST_INVALID");
  identifier(prepared.avatarProfileVersionId, "V209_REAL_CHROME_REQUEST_INVALID");
  identifier(prepared.imageStyleVersionId, "V209_REAL_CHROME_REQUEST_INVALID");
  const spendCapUsd = finite(prepared.spendCapUsd, "V209_REAL_CHROME_REQUEST_INVALID");
  if (spendCapUsd < 0.05 || spendCapUsd > 2) fail("V209_REAL_CHROME_REQUEST_INVALID");
}

function assertPreparedParity(
  value: unknown,
  expected: V209RealChromePreparedInput,
  code: string,
): void {
  const prepared = record(value, code);
  for (const key of [
    "title",
    "voiceoverFilename",
    "voiceoverContentType",
    "voiceoverContentLength",
    "voiceoverSha256",
    "voiceoverDurationMs",
    "avatarProfileVersionId",
    "imageStyleVersionId",
    "spendCapUsd",
  ] as const) {
    if (prepared[key] !== expected[key]) fail(code);
  }
}

interface DeadlineContext {
  readonly controller: AbortController;
  readonly stopAtMs: number;
}

async function withDeadline<T>(
  deadline: DeadlineContext,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T>;
  try {
    operationPromise = Promise.resolve(operation(deadline.controller.signal));
  } catch {
    throw new V209RealChromeOperatorError(code);
  }

  const remainingMs = deadline.stopAtMs - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    if (!deadline.controller.signal.aborted)
      deadline.controller.abort(new V209RealChromeOperatorError(code));
    void operationPromise.catch(() => undefined);
    fail(code);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new V209RealChromeOperatorError(code);
      if (!deadline.controller.signal.aborted) deadline.controller.abort(error);
      reject(error);
    }, remainingMs);
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch {
    throw new V209RealChromeOperatorError(code);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertScope(
  value: Record<string, unknown>,
  request: V209RealChromeOperatorRequest,
  code: string,
): void {
  if (
    value.source !== request.source ||
    value.accountId !== request.accountId ||
    value.workspaceId !== request.workspaceId
  )
    fail(code);
}

function assertProduction(value: Record<string, unknown>): void {
  if (value.mode === "FIXTURE") fail("V209_REAL_CHROME_FIXTURE_MODE_REJECTED");
  if (value.mode !== "PRODUCTION") fail("V209_REAL_CHROME_PAGE_IDENTITY_INVALID");
}

function assertPage(
  value: unknown,
  request: V209RealChromeOperatorRequest,
): V209RealChromePageObservation {
  const page = record(value, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID");
  if (page.schemaVersion !== V209_REAL_CHROME_PAGE_SCHEMA)
    fail("V209_REAL_CHROME_PAGE_IDENTITY_INVALID");
  if (page.browser !== "chrome") fail("V209_REAL_CHROME_PAGE_IDENTITY_INVALID");
  assertProduction(page);
  assertScope(page, request, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID");
  assertPreparedParity(page.prepared, request.prepared, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID");
  if (page.generateReady !== true) fail("V209_REAL_CHROME_GENERATE_UNAVAILABLE");
  if (page.generateClickCount !== 0) fail("V209_REAL_CHROME_SECOND_CLICK_FORBIDDEN");
  return page as unknown as V209RealChromePageObservation;
}

function assertClaim(
  value: unknown,
  request: V209RealChromeOperatorRequest,
): V209GenerateClickClaim {
  const claim = record(value, "V209_REAL_CHROME_CLICK_CLAIM_INVALID");
  assertScope(claim, request, "V209_REAL_CHROME_CLICK_CLAIM_INVALID");
  assertPreparedParity(claim.prepared, request.prepared, "V209_REAL_CHROME_CLICK_CLAIM_INVALID");
  identifier(claim.claimId, "V209_REAL_CHROME_CLICK_CLAIM_INVALID");
  if (
    claim.schemaVersion !== V209_REAL_CHROME_CLAIM_SCHEMA ||
    claim.state !== "RESERVED" ||
    claim.durable !== true ||
    claim.replayed !== false ||
    claim.priorClickCount !== 0 ||
    claim.clickOrdinal !== 1
  )
    fail("V209_REAL_CHROME_CLICK_CLAIM_INVALID");
  return claim as unknown as V209GenerateClickClaim;
}

function assertClick(
  value: unknown,
  request: V209RealChromeOperatorRequest,
  claimId: string,
): V209GenerateClickObservation {
  const click = record(value, "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS");
  assertScope(click, request, "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS");
  identifier(click.projectId, "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS");
  identifier(click.projectRevisionId, "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS");
  identifier(click.generationRequestId, "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS");
  if (
    click.schemaVersion !== V209_REAL_CHROME_CLICK_SCHEMA ||
    click.claimId !== claimId ||
    click.state !== "ACKNOWLEDGED" ||
    click.clickOrdinal !== 1 ||
    click.generateClickCount !== 1
  )
    fail("V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS");
  return click as unknown as V209GenerateClickObservation;
}

function assertProgressScope(
  progress: Record<string, unknown>,
  request: V209RealChromeOperatorRequest,
  identity: Pick<
    V209GenerateClickObservation,
    "projectId" | "projectRevisionId" | "generationRequestId"
  >,
): void {
  assertScope(progress, request, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
  if (
    progress.schemaVersion !== V209_REAL_CHROME_PROGRESS_SCHEMA ||
    progress.projectId !== identity.projectId ||
    progress.projectRevisionId !== identity.projectRevisionId ||
    progress.generationRequestId !== identity.generationRequestId
  )
    fail("V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
}

function assertPrivateAccess(value: unknown, code: string): V209PrivateAccessEvidence {
  const access = record(value, code);
  if (
    Object.keys(access).length !== 6 ||
    access.kind !== "SIGNED_R2_GET" ||
    typeof access.objectKey !== "string" ||
    access.objectKey.length < 1 ||
    access.objectKey.length > 1_024 ||
    !SHA256.test(String(access.signedUrlSha256)) ||
    access.algorithm !== "AWS4-HMAC-SHA256" ||
    access.expiresSeconds !== 300 ||
    access.signedHeaders !== "host"
  )
    fail(code);
  return access as unknown as V209PrivateAccessEvidence;
}

function samePrivateAccess(left: unknown, right: V209PrivateAccessEvidence, code: string): void {
  const access = assertPrivateAccess(left, code);
  if (
    access.kind !== right.kind ||
    access.objectKey !== right.objectKey ||
    access.signedUrlSha256 !== right.signedUrlSha256 ||
    access.algorithm !== right.algorithm ||
    access.expiresSeconds !== right.expiresSeconds ||
    access.signedHeaders !== right.signedHeaders
  )
    fail(code);
}

interface TerminalOutput {
  readonly renderAttemptId: string;
  readonly outputId: string;
  readonly outputSha256: string;
  readonly outputContentLength: number;
  readonly privateAccess: V209PrivateAccessEvidence;
  readonly observedStages: readonly V209RealChromeStage[];
}

async function waitForOutput(
  input: V209RealChromeOperatorInput,
  identity: Pick<
    V209GenerateClickObservation,
    "projectId" | "projectRevisionId" | "generationRequestId"
  >,
  deadline: DeadlineContext,
): Promise<TerminalOutput> {
  const observedStages: V209RealChromeStage[] = [];
  let sequence = 0;
  for (let read = 0; read < input.request.maxProgressReads; read += 1) {
    const value = await withDeadline(deadline, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS", (signal) =>
      input.progress.read({
        source: input.request.source,
        accountId: input.request.accountId,
        workspaceId: input.request.workspaceId,
        projectId: identity.projectId,
        projectRevisionId: identity.projectRevisionId,
        generationRequestId: identity.generationRequestId,
        afterSequence: sequence,
        signal,
      }),
    );
    const progress = record(value, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
    assertProgressScope(progress, input.request, identity);
    const nextSequence = integer(progress.sequence, 1, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
    if (nextSequence <= sequence || !STAGES.has(progress.stage as V209RealChromeStage))
      fail("V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
    sequence = nextSequence;
    observedStages.push(progress.stage as V209RealChromeStage);

    if (
      progress.stage === "FAILED" ||
      progress.stage === "CANCELED" ||
      progress.terminalState === "FAILED" ||
      progress.terminalState === "CANCELED"
    )
      fail("V209_REAL_CHROME_GENERATION_FAILED");
    if (progress.terminalState === "AMBIGUOUS") fail("V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
    if (progress.stage === "COMPLETE") {
      if (progress.terminalState !== "SUCCEEDED") fail("V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
      const output = record(progress.output, "V209_REAL_CHROME_OUTPUT_INVALID");
      if (output.contentType !== "video/mp4") fail("V209_REAL_CHROME_OUTPUT_INVALID");
      const privateAccess = assertPrivateAccess(
        output.privateAccess,
        "V209_REAL_CHROME_OUTPUT_INVALID",
      );
      if (output.outputId !== privateAccess.objectKey) fail("V209_REAL_CHROME_OUTPUT_INVALID");
      return Object.freeze({
        renderAttemptId: identifier(output.renderAttemptId, "V209_REAL_CHROME_OUTPUT_INVALID"),
        outputId: privateAccess.objectKey,
        outputSha256: sha256(output.sha256),
        outputContentLength: integer(output.contentLength, 1, "V209_REAL_CHROME_OUTPUT_INVALID"),
        privateAccess,
        observedStages: Object.freeze(observedStages),
      });
    }
    if (progress.terminalState !== "PENDING" || progress.output !== null)
      fail("V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
    await withDeadline(deadline, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS", (signal) =>
      (input.sleep ?? defaultSleep)(input.request.pollIntervalMs, signal),
    );
  }
  fail("V209_REAL_CHROME_TERMINAL_AMBIGUOUS");
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function assertVideo(
  value: unknown,
  request: V209RealChromeOperatorRequest,
  identity: Pick<
    V209GenerateClickObservation,
    "projectId" | "projectRevisionId" | "generationRequestId"
  >,
  terminal: TerminalOutput,
): V209PrivateVideoObservation {
  const video = record(value, "V209_REAL_CHROME_PLAYBACK_INVALID");
  if (video.schemaVersion !== V209_REAL_CHROME_VIDEO_SCHEMA)
    fail("V209_REAL_CHROME_PLAYBACK_INVALID");
  assertProduction(video);
  assertScope(video, request, "V209_REAL_CHROME_PLAYBACK_INVALID");
  if (
    video.projectId !== identity.projectId ||
    video.projectRevisionId !== identity.projectRevisionId ||
    video.generationRequestId !== identity.generationRequestId ||
    video.renderAttemptId !== terminal.renderAttemptId ||
    video.outputId !== terminal.outputId ||
    video.outputSha256 !== terminal.outputSha256 ||
    video.contentType !== "video/mp4" ||
    video.private !== true ||
    video.playing !== true ||
    video.generateClickCount !== 1
  )
    fail("V209_REAL_CHROME_PLAYBACK_INVALID");
  samePrivateAccess(
    video.privateAccess,
    terminal.privateAccess,
    "V209_REAL_CHROME_PLAYBACK_INVALID",
  );
  const duration = finite(video.durationSeconds, "V209_REAL_CHROME_PLAYBACK_INVALID");
  const currentTime = finite(video.currentTime, "V209_REAL_CHROME_PLAYBACK_INVALID");
  if (duration < 30 || duration > 60 || currentTime <= 0 || currentTime >= duration)
    fail("V209_REAL_CHROME_PLAYBACK_INVALID");
  return video as unknown as V209PrivateVideoObservation;
}

function assertSeek(
  value: unknown,
  request: V209RealChromeOperatorRequest,
  identity: Pick<
    V209GenerateClickObservation,
    "projectId" | "projectRevisionId" | "generationRequestId"
  >,
  terminal: TerminalOutput,
  durationSeconds: number,
  targetTime: number,
): V209PrivateVideoSeekObservation {
  const seek = record(value, "V209_REAL_CHROME_SEEK_INVALID");
  if (seek.schemaVersion !== V209_REAL_CHROME_VIDEO_SCHEMA) fail("V209_REAL_CHROME_SEEK_INVALID");
  assertProduction(seek);
  assertScope(seek, request, "V209_REAL_CHROME_SEEK_INVALID");
  const currentTime = finite(seek.currentTime, "V209_REAL_CHROME_SEEK_INVALID");
  if (
    seek.projectId !== identity.projectId ||
    seek.projectRevisionId !== identity.projectRevisionId ||
    seek.generationRequestId !== identity.generationRequestId ||
    seek.renderAttemptId !== terminal.renderAttemptId ||
    seek.outputId !== terminal.outputId ||
    seek.outputSha256 !== terminal.outputSha256 ||
    seek.contentType !== "video/mp4" ||
    seek.private !== true ||
    seek.generateClickCount !== 1 ||
    seek.durationSeconds !== durationSeconds ||
    seek.requestedTime !== targetTime ||
    currentTime <= 0 ||
    currentTime >= durationSeconds ||
    Math.abs(currentTime - targetTime) > 0.25
  )
    fail("V209_REAL_CHROME_SEEK_INVALID");
  samePrivateAccess(seek.privateAccess, terminal.privateAccess, "V209_REAL_CHROME_SEEK_INVALID");
  return seek as unknown as V209PrivateVideoSeekObservation;
}

function assertDownload(
  value: unknown,
  request: V209RealChromeOperatorRequest,
  identity: Pick<
    V209GenerateClickObservation,
    "projectId" | "projectRevisionId" | "generationRequestId"
  >,
  terminal: TerminalOutput,
): V209PrivateDownloadObservation {
  const download = record(value, "V209_REAL_CHROME_DOWNLOAD_INVALID");
  if (download.schemaVersion !== V209_REAL_CHROME_DOWNLOAD_SCHEMA)
    fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
  assertProduction(download);
  assertScope(download, request, "V209_REAL_CHROME_DOWNLOAD_INVALID");
  if (
    download.projectId !== identity.projectId ||
    download.projectRevisionId !== identity.projectRevisionId ||
    download.generationRequestId !== identity.generationRequestId ||
    download.renderAttemptId !== terminal.renderAttemptId ||
    download.outputId !== terminal.outputId ||
    download.outputSha256 !== terminal.outputSha256 ||
    download.contentType !== "video/mp4" ||
    download.contentLength !== terminal.outputContentLength ||
    download.private !== true ||
    download.downloaded !== true ||
    download.generateClickCount !== 1
  )
    fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
  const access = assertPrivateAccess(download.privateAccess, "V209_REAL_CHROME_DOWNLOAD_INVALID");
  if (
    access.objectKey !== terminal.privateAccess.objectKey ||
    access.algorithm !== terminal.privateAccess.algorithm ||
    access.expiresSeconds !== terminal.privateAccess.expiresSeconds ||
    access.signedHeaders !== terminal.privateAccess.signedHeaders
  )
    fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
  return download as unknown as V209PrivateDownloadObservation;
}

export async function runV209RealChromeOperator(
  input: V209RealChromeOperatorInput,
): Promise<V209RealChromeOperatorEvidence> {
  const deadline: DeadlineContext = {
    controller: new AbortController(),
    stopAtMs: assertRequest(input.request, Date.now()),
  };
  const claimValue = await withDeadline(
    deadline,
    "V209_REAL_CHROME_CLICK_CLAIM_INVALID",
    (signal) =>
      input.claims.reserveOneShot({
        source: input.request.source,
        accountId: input.request.accountId,
        workspaceId: input.request.workspaceId,
        prepared: input.request.prepared,
        signal,
      }),
  );
  const claim = assertClaim(claimValue, input.request);
  const session = await withDeadline(deadline, "V209_REAL_CHROME_BROWSER_UNAVAILABLE", (signal) =>
    input.browser.openSession({
      browser: "chrome",
      headless: false,
      sessionOrdinal: 1,
      signal,
    }),
  );

  try {
    assertPage(
      await withDeadline(deadline, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID", (signal) =>
        session.readGeneratePage({ signal }),
      ),
      input.request,
    );
    const clickValue = await withDeadline(
      deadline,
      "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS",
      (signal) => {
        // There is intentionally no retry or second browser-session path after this line.
        return session.clickGenerate({ claimId: claim.claimId, signal });
      },
    );
    const click = assertClick(clickValue, input.request, claim.claimId);
    const terminal = await waitForOutput(input, click, deadline);
    const video = assertVideo(
      await withDeadline(deadline, "V209_REAL_CHROME_PLAYBACK_INVALID", (signal) =>
        session.playPrivateVideo({
          projectId: click.projectId,
          projectRevisionId: click.projectRevisionId,
          generationRequestId: click.generationRequestId,
          renderAttemptId: terminal.renderAttemptId,
          outputId: terminal.outputId,
          outputSha256: terminal.outputSha256,
          privateAccess: terminal.privateAccess,
          signal,
        }),
      ),
      input.request,
      click,
      terminal,
    );
    const seekTargetTime = Math.min(5, video.durationSeconds / 2);
    if (
      !Number.isFinite(seekTargetTime) ||
      seekTargetTime <= 0 ||
      seekTargetTime >= video.durationSeconds
    )
      fail("V209_REAL_CHROME_SEEK_INVALID");
    const seek = assertSeek(
      await withDeadline(deadline, "V209_REAL_CHROME_SEEK_INVALID", (signal) =>
        session.seekPrivateVideo({
          projectId: click.projectId,
          projectRevisionId: click.projectRevisionId,
          generationRequestId: click.generationRequestId,
          renderAttemptId: terminal.renderAttemptId,
          outputId: terminal.outputId,
          outputSha256: terminal.outputSha256,
          privateAccess: terminal.privateAccess,
          targetTime: seekTargetTime,
          signal,
        }),
      ),
      input.request,
      click,
      terminal,
      video.durationSeconds,
      seekTargetTime,
    );
    const download = assertDownload(
      await withDeadline(deadline, "V209_REAL_CHROME_DOWNLOAD_INVALID", (signal) =>
        session.downloadPrivateVideo({
          projectId: click.projectId,
          projectRevisionId: click.projectRevisionId,
          generationRequestId: click.generationRequestId,
          renderAttemptId: terminal.renderAttemptId,
          outputId: terminal.outputId,
          outputSha256: terminal.outputSha256,
          privateAccess: terminal.privateAccess,
          signal,
        }),
      ),
      input.request,
      click,
      terminal,
    );

    return Object.freeze({
      schemaVersion: V209_REAL_CHROME_EVIDENCE_SCHEMA,
      browser: "chrome",
      source: input.request.source,
      accountId: input.request.accountId,
      workspaceId: input.request.workspaceId,
      prepared: input.request.prepared,
      projectId: click.projectId,
      projectRevisionId: click.projectRevisionId,
      stopAt: input.request.stopAt,
      claimId: claim.claimId,
      generationRequestId: click.generationRequestId,
      renderAttemptId: terminal.renderAttemptId,
      outputId: terminal.outputId,
      observedStages: terminal.observedStages,
      outputSha256: terminal.outputSha256,
      playbackPrivateAccess: terminal.privateAccess,
      downloadPrivateAccess: download.privateAccess,
      outputContentLength: terminal.outputContentLength,
      playbackCurrentTime: video.currentTime,
      seekTargetTime,
      postSeekCurrentTime: seek.currentTime,
      durationSeconds: video.durationSeconds,
      downloadContentLength: download.contentLength,
      generateClickCount: 1,
    });
  } finally {
    const closeDeadline: DeadlineContext = {
      controller: new AbortController(),
      stopAtMs: Date.now() + CLOSE_TIMEOUT_MS,
    };
    await withDeadline(closeDeadline, "V209_REAL_CHROME_BROWSER_CLOSE_FAILED", (signal) =>
      session.close({ signal }),
    ).catch(() => undefined);
  }
}
