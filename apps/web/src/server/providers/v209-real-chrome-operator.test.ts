import { describe, expect, it, vi } from "vitest";

import {
  V209_REAL_CHROME_CLAIM_SCHEMA,
  V209_REAL_CHROME_CLICK_SCHEMA,
  V209_REAL_CHROME_DOWNLOAD_SCHEMA,
  V209_REAL_CHROME_EVIDENCE_SCHEMA,
  V209_REAL_CHROME_PAGE_SCHEMA,
  V209_REAL_CHROME_PROGRESS_SCHEMA,
  V209_REAL_CHROME_REQUEST_SCHEMA,
  V209_REAL_CHROME_SOURCE,
  V209_REAL_CHROME_VIDEO_SCHEMA,
  runV209RealChromeOperator,
  type V209RealChromeOperatorInput,
  type V209RealChromeStage,
} from "./v209-real-chrome-operator.js";

const ACCOUNT_ID = "account-1";
const WORKSPACE_ID = "workspace-1";
const PROJECT_ID = "project-1";
const PROJECT_REVISION_ID = "project-revision-1";
const CLAIM_ID = "claim-1";
const GENERATION_REQUEST_ID = "generation-request-1";
const IDEMPOTENCY_KEY = "browser-project-11111111-1111-4111-8111-111111111111";
const CREATE_REQUEST_SHA256 = `sha256:${"f".repeat(64)}`;
const RENDER_ATTEMPT_ID = "render-attempt-1";
const OUTPUT_ID =
  "tenant/account-1/workspace/workspace-1/project/project-1/revision/project-revision-1/lane/render/job/render-attempt-1/artifact/final-mp4";
const OUTPUT_SHA256 = `sha256:${"a".repeat(64)}`;
const OUTPUT_BYTES = 2_048;
const PRIVATE_ACCESS = {
  kind: "SIGNED_R2_GET",
  objectKey: OUTPUT_ID,
  signedUrlSha256: `sha256:${"d".repeat(64)}`,
  algorithm: "AWS4-HMAC-SHA256",
  expiresSeconds: 300,
  signedHeaders: "host",
} as const;
const DOWNLOAD_PRIVATE_ACCESS = {
  ...PRIVATE_ACCESS,
  signedUrlSha256: `sha256:${"e".repeat(64)}`,
} as const;
const STOP_AT = new Date(Date.now() + 300_000).toISOString();
const prepared = {
  title: "One short exact project",
  voiceoverFilename: "voiceover.wav",
  voiceoverContentType: "audio/wav",
  voiceoverContentLength: 64_044,
  voiceoverSha256: `sha256:${"c".repeat(64)}`,
  voiceoverDurationMs: 40_000,
  avatarProfileVersionId: "avatar-version-1",
  imageStyleVersionId: "style-version-1",
  spendCapUsd: 2,
} as const;

const request = {
  schemaVersion: V209_REAL_CHROME_REQUEST_SCHEMA,
  source: V209_REAL_CHROME_SOURCE,
  accountId: ACCOUNT_ID,
  workspaceId: WORKSPACE_ID,
  prepared,
  maxProgressReads: 8,
  pollIntervalMs: 25,
  stopAt: STOP_AT,
} as const;

const page = {
  schemaVersion: V209_REAL_CHROME_PAGE_SCHEMA,
  browser: "chrome",
  mode: "PRODUCTION",
  source: V209_REAL_CHROME_SOURCE,
  accountId: ACCOUNT_ID,
  workspaceId: WORKSPACE_ID,
  prepared,
  generateReady: true,
  generateClickCount: 0,
} as const;

const claim = {
  schemaVersion: V209_REAL_CHROME_CLAIM_SCHEMA,
  claimId: CLAIM_ID,
  source: V209_REAL_CHROME_SOURCE,
  accountId: ACCOUNT_ID,
  workspaceId: WORKSPACE_ID,
  prepared,
  state: "RESERVED",
  durable: true,
  replayed: false,
  priorClickCount: 0,
  clickOrdinal: 1,
} as const;

const click = {
  schemaVersion: V209_REAL_CHROME_CLICK_SCHEMA,
  claimId: CLAIM_ID,
  source: V209_REAL_CHROME_SOURCE,
  accountId: ACCOUNT_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  projectRevisionId: PROJECT_REVISION_ID,
  state: "ACKNOWLEDGED",
  clickOrdinal: 1,
  generateClickCount: 1,
  generationRequestId: GENERATION_REQUEST_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  createRequestSha256: CREATE_REQUEST_SHA256,
} as const;

function progress(
  sequence: number,
  stage: V209RealChromeStage,
  terminalState: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "AMBIGUOUS" = "PENDING",
) {
  return {
    schemaVersion: V209_REAL_CHROME_PROGRESS_SCHEMA,
    source: V209_REAL_CHROME_SOURCE,
    accountId: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    projectRevisionId: PROJECT_REVISION_ID,
    generationRequestId: GENERATION_REQUEST_ID,
    sequence,
    stage,
    terminalState,
    output:
      terminalState === "SUCCEEDED"
        ? {
            renderAttemptId: RENDER_ATTEMPT_ID,
            outputId: OUTPUT_ID,
            contentType: "video/mp4",
            contentLength: OUTPUT_BYTES,
            sha256: OUTPUT_SHA256,
            privateAccess: PRIVATE_ACCESS,
          }
        : null,
  };
}

function harness(
  overrides: {
    readonly request?: Record<string, unknown>;
    readonly page?: Record<string, unknown>;
    readonly claim?: Record<string, unknown>;
    readonly click?: Record<string, unknown>;
    readonly clickError?: Error;
    readonly clickIdentityError?: Error;
    readonly claimNever?: boolean;
    readonly browserNever?: boolean;
    readonly pageNever?: boolean;
    readonly clickNever?: boolean;
    readonly progress?: readonly unknown[];
    readonly progressError?: Error;
    readonly progressNever?: boolean;
    readonly sleepNever?: boolean;
    readonly video?: Record<string, unknown>;
    readonly videoNever?: boolean;
    readonly seek?: Record<string, unknown>;
    readonly seekNever?: boolean;
    readonly download?: Record<string, unknown>;
    readonly downloadNever?: boolean;
    readonly closeNever?: boolean;
  } = {},
) {
  type SignalInput = { readonly signal: AbortSignal };
  type SeekInput = SignalInput & { readonly targetTime: number };
  const observations = overrides.progress ?? [
    progress(1, "PREPARING"),
    progress(2, "GENERATING_IMAGES"),
    progress(3, "GENERATING_AVATAR"),
    progress(4, "RENDERING"),
    progress(5, "COMPLETE", "SUCCEEDED"),
  ];
  let progressIndex = 0;
  const never = () => new Promise<never>(() => undefined);
  const reserveOneShot = vi.fn(async (input: SignalInput) => {
    void input.signal;
    return overrides.claimNever === true ? never() : (overrides.claim ?? claim);
  });
  const recordAcknowledgedClick = vi.fn(async () => {
    if (overrides.clickIdentityError !== undefined) throw overrides.clickIdentityError;
  });
  const recordCreateRequest = vi.fn(async () => undefined);
  const recordProjectIdentity = vi.fn(async () => undefined);
  const readGeneratePage = vi.fn(async (input: SignalInput) => {
    void input.signal;
    return overrides.pageNever === true ? never() : (overrides.page ?? page);
  });
  const clickGenerate = vi.fn(async (input: SignalInput) => {
    void input.signal;
    if (overrides.clickNever === true) return never();
    if (overrides.clickError !== undefined) throw overrides.clickError;
    return overrides.click ?? click;
  });
  const read = vi.fn(async (input: SignalInput) => {
    void input.signal;
    if (overrides.progressNever === true) return never();
    if (overrides.progressError !== undefined) throw overrides.progressError;
    return observations[progressIndex++];
  });
  const validVideo = {
    schemaVersion: V209_REAL_CHROME_VIDEO_SCHEMA,
    mode: "PRODUCTION",
    source: V209_REAL_CHROME_SOURCE,
    accountId: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    projectRevisionId: PROJECT_REVISION_ID,
    generationRequestId: GENERATION_REQUEST_ID,
    renderAttemptId: RENDER_ATTEMPT_ID,
    outputId: OUTPUT_ID,
    outputSha256: OUTPUT_SHA256,
    privateAccess: PRIVATE_ACCESS,
    contentType: "video/mp4",
    private: true,
    playing: true,
    durationSeconds: 40,
    currentTime: 1,
    generateClickCount: 1,
  } as const;
  const playPrivateVideo = vi.fn(async (input: SignalInput) => {
    void input.signal;
    return overrides.videoNever === true ? never() : { ...validVideo, ...overrides.video };
  });
  const validSeek = (targetTime: number) => ({
    schemaVersion: V209_REAL_CHROME_VIDEO_SCHEMA,
    mode: "PRODUCTION",
    source: V209_REAL_CHROME_SOURCE,
    accountId: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    projectRevisionId: PROJECT_REVISION_ID,
    generationRequestId: GENERATION_REQUEST_ID,
    renderAttemptId: RENDER_ATTEMPT_ID,
    outputId: OUTPUT_ID,
    outputSha256: OUTPUT_SHA256,
    privateAccess: PRIVATE_ACCESS,
    contentType: "video/mp4",
    private: true,
    durationSeconds: 40,
    requestedTime: targetTime,
    currentTime: targetTime,
    generateClickCount: 1,
  });
  const seekPrivateVideo = vi.fn(async (input: SeekInput) =>
    overrides.seekNever === true ? never() : { ...validSeek(input.targetTime), ...overrides.seek },
  );
  const validDownload = {
    schemaVersion: V209_REAL_CHROME_DOWNLOAD_SCHEMA,
    mode: "PRODUCTION",
    source: V209_REAL_CHROME_SOURCE,
    accountId: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    projectRevisionId: PROJECT_REVISION_ID,
    generationRequestId: GENERATION_REQUEST_ID,
    renderAttemptId: RENDER_ATTEMPT_ID,
    outputId: OUTPUT_ID,
    outputSha256: OUTPUT_SHA256,
    privateAccess: DOWNLOAD_PRIVATE_ACCESS,
    contentType: "video/mp4",
    contentLength: OUTPUT_BYTES,
    private: true,
    downloaded: true,
    generateClickCount: 1,
  } as const;
  const downloadPrivateVideo = vi.fn(async (input: SignalInput) => {
    void input.signal;
    return overrides.downloadNever === true ? never() : { ...validDownload, ...overrides.download };
  });
  const close = vi.fn(async (input: SignalInput) => {
    void input.signal;
    return overrides.closeNever === true ? never() : undefined;
  });
  const openSession = vi.fn(async (input: SignalInput) => {
    void input.signal;
    return overrides.browserNever === true
      ? never()
      : {
          readGeneratePage,
          clickGenerate,
          playPrivateVideo,
          seekPrivateVideo,
          downloadPrivateVideo,
          close,
        };
  });
  const sleep = vi.fn(async (milliseconds: number, signal: AbortSignal) => {
    void milliseconds;
    void signal;
    return overrides.sleepNever === true ? never() : undefined;
  });
  const input = {
    request: { ...request, ...overrides.request },
    claims: {
      reserveOneShot,
      recordCreateRequest,
      recordProjectIdentity,
      recordAcknowledgedClick,
    },
    browser: { openSession },
    progress: { read },
    sleep,
  } as unknown as V209RealChromeOperatorInput;
  return {
    input,
    reserveOneShot,
    recordAcknowledgedClick,
    openSession,
    readGeneratePage,
    clickGenerate,
    read,
    playPrivateVideo,
    seekPrivateVideo,
    downloadPrivateVideo,
    close,
    sleep,
  };
}

describe("V2-09 real Chrome operator", () => {
  it("reserves one durable click, uses one session, observes progress, seeks, and downloads", async () => {
    const value = harness();
    const evidence = await runV209RealChromeOperator(value.input);

    expect(evidence).toEqual({
      schemaVersion: V209_REAL_CHROME_EVIDENCE_SCHEMA,
      browser: "chrome",
      source: V209_REAL_CHROME_SOURCE,
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      prepared,
      projectId: PROJECT_ID,
      projectRevisionId: PROJECT_REVISION_ID,
      stopAt: STOP_AT,
      claimId: CLAIM_ID,
      generationRequestId: GENERATION_REQUEST_ID,
      renderAttemptId: RENDER_ATTEMPT_ID,
      outputId: OUTPUT_ID,
      observedStages: [
        "PREPARING",
        "GENERATING_IMAGES",
        "GENERATING_AVATAR",
        "RENDERING",
        "COMPLETE",
      ],
      outputSha256: OUTPUT_SHA256,
      playbackPrivateAccess: PRIVATE_ACCESS,
      downloadPrivateAccess: DOWNLOAD_PRIVATE_ACCESS,
      outputContentLength: OUTPUT_BYTES,
      playbackCurrentTime: 1,
      seekTargetTime: 5,
      postSeekCurrentTime: 5,
      durationSeconds: 40,
      downloadContentLength: OUTPUT_BYTES,
      generateClickCount: 1,
    });
    expect(value.reserveOneShot).toHaveBeenCalledOnce();
    expect(value.openSession).toHaveBeenCalledOnce();
    expect(value.openSession).toHaveBeenCalledWith({
      browser: "chrome",
      headless: false,
      sessionOrdinal: 1,
      signal: expect.any(AbortSignal),
    });
    expect(value.readGeneratePage).toHaveBeenCalledOnce();
    expect(value.clickGenerate).toHaveBeenCalledOnce();
    expect(value.recordAcknowledgedClick).toHaveBeenCalledOnce();
    expect(value.recordAcknowledgedClick).toHaveBeenCalledWith(
      {
        schemaVersion: "videoforge.v2-09-generate-click-identity/v1",
        source: V209_REAL_CHROME_SOURCE,
        accountId: ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        projectRevisionId: PROJECT_REVISION_ID,
        generationRequestId: GENERATION_REQUEST_ID,
        claimId: CLAIM_ID,
        clickOrdinal: 1,
        generateClickCount: 1,
        voiceoverSha256: prepared.voiceoverSha256,
        idempotencyKey: IDEMPOTENCY_KEY,
        createRequestSha256: CREATE_REQUEST_SHA256,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(value.clickGenerate).toHaveBeenCalledWith({
      claimId: CLAIM_ID,
      signal: expect.any(AbortSignal),
    });
    expect(value.read).toHaveBeenCalledTimes(5);
    expect(value.sleep).toHaveBeenCalledTimes(4);
    expect(value.playPrivateVideo).toHaveBeenCalledOnce();
    expect(value.seekPrivateVideo).toHaveBeenCalledWith(expect.objectContaining({ targetTime: 5 }));
    expect(value.downloadPrivateVideo).toHaveBeenCalledOnce();
    expect(value.close).toHaveBeenCalledOnce();

    const sharedSignal = value.reserveOneShot.mock.calls[0]?.[0].signal as AbortSignal;
    expect(sharedSignal.aborted).toBe(false);
    expect(value.openSession.mock.calls[0]?.[0].signal).toBe(sharedSignal);
    expect(value.readGeneratePage.mock.calls[0]?.[0].signal).toBe(sharedSignal);
    expect(value.clickGenerate.mock.calls[0]?.[0].signal).toBe(sharedSignal);
    for (const call of value.read.mock.calls) expect(call[0].signal).toBe(sharedSignal);
    for (const call of value.sleep.mock.calls) expect(call[1]).toBe(sharedSignal);
    expect(value.playPrivateVideo.mock.calls[0]?.[0].signal).toBe(sharedSignal);
    expect(value.seekPrivateVideo.mock.calls[0]?.[0].signal).toBe(sharedSignal);
    expect(value.downloadPrivateVideo.mock.calls[0]?.[0].signal).toBe(sharedSignal);
    const closeSignal = value.close.mock.calls[0]?.[0].signal as AbortSignal;
    expect(closeSignal).not.toBe(sharedSignal);
    expect(closeSignal.aborted).toBe(false);
  });

  it("rejects fixture mode and wrong page source, prepared input, or account before clicking", async () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>, string]> = [
      ["fixture", { mode: "FIXTURE" }, "V209_REAL_CHROME_FIXTURE_MODE_REJECTED"],
      ["browser", { browser: "chromium" }, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID"],
      ["source", { source: "OTHER" }, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID"],
      [
        "avatar",
        { prepared: { ...prepared, avatarProfileVersionId: "avatar-version-2" } },
        "V209_REAL_CHROME_PAGE_IDENTITY_INVALID",
      ],
      ["account", { accountId: "account-2" }, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID"],
    ];
    for (const [, pageDrift, code] of cases) {
      const value = harness({ page: { ...page, ...pageDrift } });
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({ code });
      expect(value.reserveOneShot).toHaveBeenCalledOnce();
      expect(value.openSession).toHaveBeenCalledOnce();
      expect(value.clickGenerate).not.toHaveBeenCalled();
      expect(value.read).not.toHaveBeenCalled();
      expect(value.close).toHaveBeenCalledOnce();
    }
  });

  it("rejects a reused or non-durable claim before opening Chrome", async () => {
    for (const claimDrift of [
      { replayed: true },
      { durable: false },
      { priorClickCount: 1 },
      { clickOrdinal: 2 },
      { accountId: "account-2" },
      { prepared: { ...prepared, imageStyleVersionId: "style-version-2" } },
    ]) {
      const value = harness({ claim: { ...claim, ...claimDrift } });
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
        code: "V209_REAL_CHROME_CLICK_CLAIM_INVALID",
      });
      expect(value.openSession).not.toHaveBeenCalled();
      expect(value.clickGenerate).not.toHaveBeenCalled();
    }
  });

  it("rejects a prepared source outside 30 to 60 seconds before reserving the click", async () => {
    for (const voiceoverDurationMs of [29_999, 60_001]) {
      const value = harness({
        request: { prepared: { ...prepared, voiceoverDurationMs } },
      });
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
        code: "V209_REAL_CHROME_REQUEST_INVALID",
      });
      expect(value.reserveOneShot).not.toHaveBeenCalled();
      expect(value.openSession).not.toHaveBeenCalled();
      expect(value.clickGenerate).not.toHaveBeenCalled();
    }
  });

  it("never relaunches or clicks again after an ambiguous Generate click", async () => {
    let claims = 0;
    const value = harness({ clickError: new Error("lost acknowledgement") });
    value.input.claims.reserveOneShot = vi.fn(async () => {
      claims += 1;
      return claims === 1 ? claim : { ...claim, replayed: true };
    });

    await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS",
    });
    await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_CLICK_CLAIM_INVALID",
    });
    expect(value.openSession).toHaveBeenCalledOnce();
    expect(value.clickGenerate).toHaveBeenCalledOnce();
    expect(value.read).not.toHaveBeenCalled();
    expect(value.close).toHaveBeenCalledOnce();
  });

  it("hands off the acknowledged identity exactly once before a later output failure", async () => {
    const value = harness({ progressError: new Error("later output failure") });
    await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_TERMINAL_AMBIGUOUS",
    });
    expect(value.clickGenerate).toHaveBeenCalledOnce();
    expect(value.recordAcknowledgedClick).toHaveBeenCalledOnce();
    expect(value.read).toHaveBeenCalledOnce();
    expect(value.recordAcknowledgedClick.mock.invocationCallOrder[0]).toBeLessThan(
      value.read.mock.invocationCallOrder[0]!,
    );
  });

  it("propagates identity persistence failure without retrying or clicking again", async () => {
    const value = harness({ clickIdentityError: new Error("fsync failed") });
    await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_CLICK_IDENTITY_PERSIST_FAILED",
    });
    expect(value.clickGenerate).toHaveBeenCalledOnce();
    expect(value.recordAcknowledgedClick).toHaveBeenCalledOnce();
    expect(value.read).not.toHaveBeenCalled();
    expect(value.openSession).toHaveBeenCalledOnce();
  });

  it("treats monitor failure, ambiguous terminal state, and sequence drift as terminal ambiguity", async () => {
    const cases = [
      harness({ progressError: new Error("lost progress response") }),
      harness({ progress: [progress(1, "RENDERING", "AMBIGUOUS")] }),
      harness({ progress: [progress(1, "PREPARING"), progress(1, "RENDERING")] }),
    ];
    for (const value of cases) {
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
        code: "V209_REAL_CHROME_TERMINAL_AMBIGUOUS",
      });
      expect(value.openSession).toHaveBeenCalledOnce();
      expect(value.clickGenerate).toHaveBeenCalledOnce();
      expect(value.playPrivateVideo).not.toHaveBeenCalled();
      expect(value.downloadPrivateVideo).not.toHaveBeenCalled();
      expect(value.close).toHaveBeenCalledOnce();
    }
  });

  it("rejects failed generation without playback or download", async () => {
    const value = harness({ progress: [progress(1, "FAILED", "FAILED")] });
    await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_GENERATION_FAILED",
    });
    expect(value.clickGenerate).toHaveBeenCalledOnce();
    expect(value.playPrivateVideo).not.toHaveBeenCalled();
    expect(value.downloadPrivateVideo).not.toHaveBeenCalled();
  });

  it("requires real playback and an explicit bounded post-seek currentTime proof", async () => {
    const noPlayback = harness({
      video: {
        schemaVersion: V209_REAL_CHROME_VIDEO_SCHEMA,
        mode: "PRODUCTION",
        source: V209_REAL_CHROME_SOURCE,
        accountId: ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        generationRequestId: GENERATION_REQUEST_ID,
        outputSha256: OUTPUT_SHA256,
        contentType: "video/mp4",
        private: true,
        playing: true,
        durationSeconds: 40,
        currentTime: 0,
        generateClickCount: 1,
      },
    });
    await expect(runV209RealChromeOperator(noPlayback.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_PLAYBACK_INVALID",
    });
    expect(noPlayback.seekPrivateVideo).not.toHaveBeenCalled();

    const noSeekProof = harness({
      seek: {
        schemaVersion: V209_REAL_CHROME_VIDEO_SCHEMA,
        mode: "PRODUCTION",
        source: V209_REAL_CHROME_SOURCE,
        accountId: ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        generationRequestId: GENERATION_REQUEST_ID,
        outputSha256: OUTPUT_SHA256,
        contentType: "video/mp4",
        private: true,
        durationSeconds: 40,
        requestedTime: 5,
        currentTime: 0,
        generateClickCount: 1,
      },
    });
    await expect(runV209RealChromeOperator(noSeekProof.input)).rejects.toMatchObject({
      code: "V209_REAL_CHROME_SEEK_INVALID",
    });
    expect(noSeekProof.seekPrivateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ targetTime: 5 }),
    );
    expect(noSeekProof.downloadPrivateVideo).not.toHaveBeenCalled();
  });

  it("rejects output durations outside the exact 30 to 60 second V2-09 window", async () => {
    for (const durationSeconds of [29.999, 60.001]) {
      const value = harness({ video: { durationSeconds } });
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
        code: "V209_REAL_CHROME_PLAYBACK_INVALID",
      });
      expect(value.clickGenerate).toHaveBeenCalledOnce();
      expect(value.playPrivateVideo).toHaveBeenCalledOnce();
      expect(value.seekPrivateVideo).not.toHaveBeenCalled();
      expect(value.downloadPrivateVideo).not.toHaveBeenCalled();
      expect(value.close).toHaveBeenCalledOnce();
    }
  });

  it("uses the absolute deadline to abort every potentially hanging external seam", async () => {
    const cases: ReadonlyArray<[string, Parameters<typeof harness>[0], string]> = [
      ["claim", { claimNever: true }, "V209_REAL_CHROME_CLICK_CLAIM_INVALID"],
      ["browser", { browserNever: true }, "V209_REAL_CHROME_BROWSER_UNAVAILABLE"],
      ["page", { pageNever: true }, "V209_REAL_CHROME_PAGE_IDENTITY_INVALID"],
      ["click", { clickNever: true }, "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS"],
      ["progress", { progressNever: true }, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS"],
      ["sleep", { sleepNever: true }, "V209_REAL_CHROME_TERMINAL_AMBIGUOUS"],
      ["play", { videoNever: true }, "V209_REAL_CHROME_PLAYBACK_INVALID"],
      ["seek", { seekNever: true }, "V209_REAL_CHROME_SEEK_INVALID"],
      ["download", { downloadNever: true }, "V209_REAL_CHROME_DOWNLOAD_INVALID"],
    ];

    for (const [, override, code] of cases) {
      const value = harness({
        ...override,
        request: { stopAt: new Date(Date.now() + 100).toISOString() },
      });
      const startedAt = Date.now();
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({ code });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      const signal = value.reserveOneShot.mock.calls[0]?.[0].signal as AbortSignal;
      expect(signal.aborted).toBe(true);
      expect(value.clickGenerate).toHaveBeenCalledTimes(
        ["claim", "browser", "page"].includes(cases.find((item) => item[1] === override)?.[0] ?? "")
          ? 0
          : 1,
      );
    }
  });

  it("deadline-bounds a hanging browser close without blocking final settlement", async () => {
    const value = harness({
      closeNever: true,
      request: { stopAt: new Date(Date.now() + 100).toISOString() },
    });
    const startedAt = Date.now();
    await expect(runV209RealChromeOperator(value.input)).resolves.toMatchObject({
      generateClickCount: 1,
      durationSeconds: 40,
    });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(value.close).toHaveBeenCalledOnce();
    const signal = value.close.mock.calls[0]?.[0].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it("rejects non-private or hash-drifted downloads", async () => {
    for (const drift of [{ private: false }, { outputSha256: `sha256:${"b".repeat(64)}` }]) {
      const value = harness({ download: { ...drift } });
      await expect(runV209RealChromeOperator(value.input)).rejects.toMatchObject({
        code: "V209_REAL_CHROME_DOWNLOAD_INVALID",
      });
      expect(value.clickGenerate).toHaveBeenCalledOnce();
      expect(value.downloadPrivateVideo).toHaveBeenCalledOnce();
      expect(value.close).toHaveBeenCalledOnce();
    }
  });
});
