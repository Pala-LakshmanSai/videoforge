import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  V209_REAL_CHROME_CLAIM_SCHEMA,
  V209_REAL_CHROME_REQUEST_SCHEMA,
  V209_REAL_CHROME_SOURCE,
  type V209RealChromeOperatorRequest,
} from "./v209-real-chrome-operator.js";
import {
  runV209RealChromePlaywright,
  type LaunchV209InstalledChrome,
} from "./v209-real-chrome-playwright.js";

const ACCOUNT_ID = "account-1";
const WORKSPACE_ID = "workspace-1";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const CREATE_IDEMPOTENCY_KEY = "browser-project-55555555-5555-4555-8555-555555555555";
const RENDER_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_ID = "claim-1";
const OUTPUT = Buffer.from("private exact v209 mp4 bytes");
const OUTPUT_SHA256 = `sha256:${createHash("sha256").update(OUTPUT).digest("hex")}`;
const OUTPUT_ID = `tenant/${ACCOUNT_ID}/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/revision/${REVISION_ID}/lane/render/job/${RENDER_ATTEMPT_ID}/artifact/final-mp4`;

function signedR2Url(download: boolean): string {
  const url = new URL(`https://fixture-account.r2.cloudflarestorage.com/private/${OUTPUT_ID}`);
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", "fixture-key/20260906/auto/s3/aws4_request");
  url.searchParams.set("X-Amz-Date", "20260906T000000Z");
  url.searchParams.set("X-Amz-Expires", "300");
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  url.searchParams.set("X-Amz-Signature", "a".repeat(64));
  if (download)
    url.searchParams.set(
      "response-content-disposition",
      'attachment; filename="videoforge-output.mp4"',
    );
  return url.toString();
}

const PREVIEW_URL = signedR2Url(false);
const DOWNLOAD_URL = signedR2Url(true);

function sourceFiles() {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-playwright-"));
  chmodSync(directory, 0o700);
  const authStatePath = join(directory, "auth.json");
  writeFileSync(
    authStatePath,
    JSON.stringify({
      cookies: [{ name: "better-auth.session_token", value: "protected-session" }],
      origins: [],
    }),
    { mode: 0o600 },
  );
  const voiceoverPath = join(directory, "voiceover.wav");
  const voiceover = Buffer.from("exact owned 40 second voiceover fixture");
  writeFileSync(voiceoverPath, voiceover, { mode: 0o600 });
  const downloadPath = join(directory, "output.mp4");
  writeFileSync(downloadPath, OUTPUT, { mode: 0o600 });
  const verifiedOutputPath = join(directory, "verified-output.mp4");
  const request: V209RealChromeOperatorRequest = {
    schemaVersion: V209_REAL_CHROME_REQUEST_SCHEMA,
    source: V209_REAL_CHROME_SOURCE,
    accountId: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    prepared: {
      title: "Exact short project",
      voiceoverFilename: "voiceover.wav",
      voiceoverContentType: "audio/wav",
      voiceoverContentLength: voiceover.length,
      voiceoverSha256: `sha256:${createHash("sha256").update(voiceover).digest("hex")}`,
      voiceoverDurationMs: 40_000,
      avatarProfileVersionId: "avatar-version-1",
      imageStyleVersionId: "style-version-1",
      spendCapUsd: 2,
    },
    maxProgressReads: 3,
    pollIntervalMs: 0,
    stopAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return {
    directory,
    authStatePath,
    voiceoverPath,
    downloadPath,
    verifiedOutputPath,
    request,
  };
}

function fakeChrome(input: {
  readonly request: V209RealChromeOperatorRequest;
  readonly downloadPath: string;
  readonly redirectOrigin?: string;
  readonly createResponseUrl?: string;
  readonly createResponseStatus?: number;
}) {
  const calls = {
    currentUrl: "https://videoforge.example.test/projects/new",
    readinessClicks: 0,
    startClicks: 0,
    approvalClicks: 0,
    downloadClicks: 0,
    projectReads: 0,
    networkCreateRequests: 0,
    postCreateMutations: 0,
    routeAborts: 0,
    routeFetchMaxRedirects: [] as number[],
  };
  let createRouteHandler:
    | ((route: Record<string, any>, request: Record<string, any>) => Promise<void>)
    | undefined;

  const noElement = {
    count: vi.fn(async () => 0),
    nth: vi.fn(),
    locator: vi.fn(),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined),
    isEnabled: vi.fn(async () => false),
    getAttribute: vi.fn(async () => null),
    evaluate: vi.fn(),
  };
  noElement.nth.mockReturnValue(noElement);
  noElement.locator.mockReturnValue(noElement);

  const field = () => ({
    ...noElement,
    fill: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined),
  });
  const readiness = {
    ...noElement,
    count: vi.fn(async () => 1),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => {
      calls.readinessClicks += 1;
    }),
  };
  const start = {
    ...noElement,
    count: vi.fn(async () => (calls.readinessClicks === 1 ? 1 : 0)),
    isEnabled: vi.fn(async () => calls.readinessClicks === 1),
    click: vi.fn(async () => {
      calls.startClicks += 1;
      if (!createRouteHandler) throw new Error("create route unavailable");
      const response = {
        status: () => input.createResponseStatus ?? 201,
        url: () =>
          input.createResponseUrl ?? "https://videoforge.example.test/api/v2/hosted/projects",
        request: () => createRequest,
        json: async () => ({
          schema_version: "videoforge-hosted-project-create-response/v1",
          project_id: PROJECT_ID,
          project_revision_id: REVISION_ID,
          state: "UPLOAD_PENDING",
          upload: {},
        }),
      };
      const route = {
        request: () => createRequest,
        fetch: vi.fn(async (options: { maxRedirects: number }) => {
          calls.networkCreateRequests += 1;
          calls.routeFetchMaxRedirects.push(options.maxRedirects);
          return response;
        }),
        fulfill: vi.fn(async () => {
          calls.postCreateMutations += 1;
          calls.currentUrl = `https://videoforge.example.test/projects/${PROJECT_ID}`;
        }),
        abort: vi.fn(async () => {
          calls.routeAborts += 1;
        }),
      };
      void createRouteHandler(route, createRequest);
    }),
  };
  const approve = {
    ...noElement,
    count: vi.fn(async () => (calls.approvalClicks === 0 ? 1 : 0)),
    isEnabled: vi.fn(async () => true),
    click: vi.fn(async () => {
      calls.approvalClicks += 1;
    }),
  };
  const downloadLink = {
    ...noElement,
    count: vi.fn(async () => (calls.approvalClicks === 1 ? 1 : 0)),
    isEnabled: vi.fn(async () => calls.approvalClicks === 1),
    getAttribute: vi.fn(async (name: string) => (name === "href" ? DOWNLOAD_URL : null)),
    click: vi.fn(async () => {
      calls.downloadClicks += 1;
    }),
  };
  const video = {
    ...noElement,
    count: vi.fn(async () => 1),
    getAttribute: vi.fn(async () => PREVIEW_URL),
    evaluate: vi.fn(async (_callback: unknown, argument?: unknown) => ({
      durationSeconds: 40,
      currentTime: typeof argument === "number" ? argument : 1,
    })),
  };
  const preset = {
    ...noElement,
    locator: vi.fn(() => noElement),
  };
  const detail = (complete: boolean) => ({
    schema_version: "videoforge-hosted-project-detail/v1",
    project: {
      id: PROJECT_ID,
      title: input.request.prepared.title,
      revision_id: REVISION_ID,
      revision_state: "LOCKED",
    },
    generation: { id: GENERATION_ID },
    queue: complete ? null : { status: "ACTIVE" },
    stages: complete
      ? [{ id: "render", status: "COMPLETE" }]
      : [{ id: "image-generation", status: "RUNNING" }],
    attempts: complete
      ? [
          {
            id: RENDER_ATTEMPT_ID,
            kind: "RENDER",
            state: "SUCCEEDED",
            content_type: "video/mp4",
            content_length: OUTPUT.length,
            output_checksum_sha256: OUTPUT_SHA256,
            object_key: OUTPUT_ID,
            result_content_length: OUTPUT.length,
            result_checksum_sha256: OUTPUT_SHA256,
            result_content_type: "video/mp4",
            result_object_key: OUTPUT_ID,
            preview_url: PREVIEW_URL,
          },
        ]
      : [],
  });
  const createBody = {
    title: input.request.prepared.title,
    avatar_profile_version_id: input.request.prepared.avatarProfileVersionId,
    image_style_version_id: input.request.prepared.imageStyleVersionId,
    extra_prompt_keywords: "",
    apply_extra_prompt_keywords: false,
    user_seed: null,
    spend_cap_usd: input.request.prepared.spendCapUsd,
    voiceover: {
      filename: input.request.prepared.voiceoverFilename,
      content_type: input.request.prepared.voiceoverContentType,
      content_length: input.request.prepared.voiceoverContentLength,
      checksum_sha256: input.request.prepared.voiceoverSha256,
      duration_ms: input.request.prepared.voiceoverDurationMs,
    },
  };
  const createRequest = {
    method: () => "POST",
    url: () => "https://videoforge.example.test/api/v2/hosted/projects",
    postDataJSON: () => ({
      ...createBody,
      schema_version: "videoforge-hosted-project-create/v2",
    }),
    postData: () =>
      JSON.stringify({ ...createBody, schema_version: "videoforge-hosted-project-create/v2" }),
    headerValue: async (name: string) =>
      name.toLowerCase() === "idempotency-key" ? CREATE_IDEMPOTENCY_KEY : null,
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      const target = new URL(url);
      calls.currentUrl = input.redirectOrigin
        ? `${input.redirectOrigin}${target.pathname}${target.search}${target.hash}`
        : url;
    }),
    url: vi.fn(() => calls.currentUrl),
    waitForURL: vi.fn(async () => undefined),
    route: vi.fn(
      async (
        _url: string,
        handler: (route: Record<string, any>, request: Record<string, any>) => Promise<void>,
      ) => {
        createRouteHandler = handler;
      },
    ),
    waitForRequest: vi.fn(
      async (
        predicate: (request: {
          method(): string;
          url(): string;
          postDataJSON(): unknown;
        }) => boolean,
      ) => {
        const candidates = [
          {
            method: () => "POST",
            url: () => "https://videoforge.example.test/api/v2/hosted/projects/preflight",
            postDataJSON: () => ({
              ...createBody,
              schema_version: "videoforge-hosted-project-preflight/v1",
            }),
            postData: () => null,
            headerValue: async () => null,
          },
          createRequest,
        ];
        const request = candidates.find(predicate);
        if (!request) throw new Error("unexpected request predicate");
        return request;
      },
    ),
    waitForEvent: vi.fn(async () => ({
      path: async () => input.downloadPath,
      failure: async () => null,
      delete: async () => undefined,
    })),
    evaluate: vi.fn(async (_callback: unknown, argument: unknown) => {
      const path = String(argument);
      if (path === "/api/v2/tenant")
        return {
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: ACCOUNT_ID,
          workspace_id: WORKSPACE_ID,
        };
      if (path === "/api/v2/hosted/project-catalog")
        return {
          avatars: [{ version_id: input.request.prepared.avatarProfileVersionId }],
          styles: [{ version_id: input.request.prepared.imageStyleVersionId }],
        };
      if (path === `/api/v2/hosted/projects/${PROJECT_ID}`) {
        calls.projectReads += 1;
        return detail(calls.projectReads >= 3);
      }
      throw new Error(`unexpected API path ${path}`);
    }),
    locator: vi.fn((selector: string) => {
      if (selector === "video") return video;
      if (selector === "#hosted-avatar-select" || selector === "#hosted-style-select")
        return preset;
      return noElement;
    }),
    getByLabel: vi.fn(() => field()),
    getByRole: vi.fn((role: string, options: { name?: string }) => {
      if (role === "button" && options.name === "Check cost & readiness") return readiness;
      if (role === "button" && options.name === "Create project & start") return start;
      if (role === "button" && options.name === "Approve final") return approve;
      if (role === "link" && options.name === "Download MP4") return downloadLink;
      return noElement;
    }),
    close: vi.fn(async () => undefined),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  const launch = vi.fn(async () => browser) as unknown as LaunchV209InstalledChrome;
  return { launch, browser, context, page, calls };
}

function claimPort(
  request: V209RealChromeOperatorRequest,
  failures: { readonly create?: Error; readonly project?: Error } = {},
) {
  const reserveOneShot = vi.fn(async () => ({
    schemaVersion: V209_REAL_CHROME_CLAIM_SCHEMA,
    claimId: CLAIM_ID,
    source: V209_REAL_CHROME_SOURCE,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    prepared: request.prepared,
    state: "RESERVED",
    durable: true,
    replayed: false,
    priorClickCount: 0,
    clickOrdinal: 1,
  }));
  const recordCreateRequest = vi.fn(async () => {
    if (failures.create) throw failures.create;
  });
  const recordProjectIdentity = vi.fn(async () => {
    if (failures.project) throw failures.project;
  });
  const recordAcknowledgedClick = vi.fn(async () => undefined);
  return {
    reserveOneShot,
    recordCreateRequest,
    recordProjectIdentity,
    recordAcknowledgedClick,
  };
}

describe("V2-09 real Chrome Playwright binding", () => {
  it("uses authenticated installed Chrome and the current UI for one start, play, seek, and exact download", async () => {
    const files = sourceFiles();
    try {
      const chrome = fakeChrome(files);
      const claims = claimPort(files.request);
      const evidence = await runV209RealChromePlaywright({
        request: files.request,
        claims,
        productionOrigin: "https://videoforge.example.test",
        authStatePath: files.authStatePath,
        voiceoverPath: files.voiceoverPath,
        verifiedOutputPath: files.verifiedOutputPath,
        launch: chrome.launch,
      });

      expect(evidence).toMatchObject({
        accountId: ACCOUNT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        projectRevisionId: REVISION_ID,
        generationRequestId: GENERATION_ID,
        renderAttemptId: RENDER_ATTEMPT_ID,
        outputId: OUTPUT_ID,
        outputSha256: OUTPUT_SHA256,
        playbackPrivateAccess: {
          kind: "SIGNED_R2_GET",
          objectKey: OUTPUT_ID,
          algorithm: "AWS4-HMAC-SHA256",
          expiresSeconds: 300,
          signedHeaders: "host",
        },
        downloadPrivateAccess: {
          kind: "SIGNED_R2_GET",
          objectKey: OUTPUT_ID,
          algorithm: "AWS4-HMAC-SHA256",
          expiresSeconds: 300,
          signedHeaders: "host",
        },
        outputContentLength: OUTPUT.length,
        durationSeconds: 40,
        seekTargetTime: 5,
        postSeekCurrentTime: 5,
        downloadContentLength: OUTPUT.length,
        generateClickCount: 1,
      });
      expect(claims.reserveOneShot).toHaveBeenCalledOnce();
      expect(claims.recordCreateRequest).toHaveBeenCalledOnce();
      expect(claims.recordProjectIdentity).toHaveBeenCalledOnce();
      expect(claims.recordCreateRequest.mock.invocationCallOrder[0]).toBeLessThan(
        claims.recordProjectIdentity.mock.invocationCallOrder[0]!,
      );
      expect(claims.recordProjectIdentity.mock.invocationCallOrder[0]).toBeLessThan(
        claims.recordAcknowledgedClick.mock.invocationCallOrder[0]!,
      );
      expect(claims.recordAcknowledgedClick).toHaveBeenCalledOnce();
      expect(claims.recordAcknowledgedClick).toHaveBeenCalledWith(
        expect.objectContaining({
          schemaVersion: "videoforge.v2-09-generate-click-identity/v1",
          projectId: PROJECT_ID,
          projectRevisionId: REVISION_ID,
          generationRequestId: GENERATION_ID,
          claimId: CLAIM_ID,
          clickOrdinal: 1,
          generateClickCount: 1,
          voiceoverSha256: files.request.prepared.voiceoverSha256,
        }),
        { signal: expect.any(AbortSignal) },
      );
      expect(chrome.launch).toHaveBeenCalledWith({ channel: "chrome", headless: false });
      expect(chrome.browser.newContext).toHaveBeenCalledWith({
        storageState: files.authStatePath,
        acceptDownloads: true,
        baseURL: "https://videoforge.example.test",
        serviceWorkers: "block",
      });
      expect(chrome.page.goto).toHaveBeenNthCalledWith(
        1,
        "https://videoforge.example.test/projects/new",
        { waitUntil: "domcontentloaded" },
      );
      expect(chrome.calls.readinessClicks).toBe(1);
      expect(chrome.calls.startClicks).toBe(1);
      expect(chrome.calls.approvalClicks).toBe(1);
      expect(chrome.calls.downloadClicks).toBe(1);
      expect(chrome.page.close).toHaveBeenCalledOnce();
      expect(chrome.context.close).toHaveBeenCalledOnce();
      expect(chrome.browser.close).toHaveBeenCalledOnce();
      expect(readFileSync(files.verifiedOutputPath)).toEqual(OUTPUT);
      expect(lstatSync(files.verifiedOutputPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(files.directory, { recursive: true, force: true });
    }
  });

  it("rejects source-byte drift and invalid auth state before Chrome launch", async () => {
    const files = sourceFiles();
    try {
      const chrome = fakeChrome(files);
      const claims = claimPort(files.request);
      writeFileSync(files.voiceoverPath, "drift", { mode: 0o600 });
      await expect(
        runV209RealChromePlaywright({
          request: files.request,
          claims,
          productionOrigin: "https://videoforge.example.test",
          authStatePath: files.authStatePath,
          voiceoverPath: files.voiceoverPath,
          verifiedOutputPath: files.verifiedOutputPath,
          launch: chrome.launch,
        }),
      ).rejects.toMatchObject({ code: "V209_REAL_CHROME_PREPARED_INPUT_INVALID" });
      expect(chrome.launch).not.toHaveBeenCalled();

      writeFileSync(files.authStatePath, JSON.stringify({ cookies: [], origins: [] }), {
        mode: 0o600,
      });
      await expect(
        runV209RealChromePlaywright({
          request: files.request,
          claims,
          productionOrigin: "https://videoforge.example.test",
          authStatePath: files.authStatePath,
          voiceoverPath: files.voiceoverPath,
          verifiedOutputPath: files.verifiedOutputPath,
          launch: chrome.launch,
        }),
      ).rejects.toMatchObject({ code: "V209_REAL_CHROME_AUTH_STATE_INVALID" });
      expect(chrome.launch).not.toHaveBeenCalled();
    } finally {
      rmSync(files.directory, { recursive: true, force: true });
    }
  });

  it("holds the create POST before network until request identity persistence succeeds", async () => {
    const files = sourceFiles();
    try {
      const chrome = fakeChrome(files);
      const claims = claimPort(files.request, { create: new Error("request fsync failed") });
      await expect(
        runV209RealChromePlaywright({
          request: files.request,
          claims,
          productionOrigin: "https://videoforge.example.test",
          authStatePath: files.authStatePath,
          voiceoverPath: files.voiceoverPath,
          verifiedOutputPath: files.verifiedOutputPath,
          launch: chrome.launch,
        }),
      ).rejects.toMatchObject({ code: "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS" });
      expect(claims.reserveOneShot).toHaveBeenCalledOnce();
      expect(claims.recordCreateRequest).toHaveBeenCalledOnce();
      expect(chrome.calls.startClicks).toBe(1);
      expect(chrome.calls.networkCreateRequests).toBe(0);
      expect(chrome.calls.postCreateMutations).toBe(0);
      expect(chrome.calls.routeAborts).toBe(1);
    } finally {
      rmSync(files.directory, { recursive: true, force: true });
    }
  });

  it("holds page continuation before upload, commit, or CPU until project identity is durable", async () => {
    const files = sourceFiles();
    try {
      const chrome = fakeChrome(files);
      const claims = claimPort(files.request, { project: new Error("project fsync failed") });
      await expect(
        runV209RealChromePlaywright({
          request: files.request,
          claims,
          productionOrigin: "https://videoforge.example.test",
          authStatePath: files.authStatePath,
          voiceoverPath: files.voiceoverPath,
          verifiedOutputPath: files.verifiedOutputPath,
          launch: chrome.launch,
        }),
      ).rejects.toMatchObject({ code: "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS" });
      expect(claims.recordCreateRequest).toHaveBeenCalledOnce();
      expect(claims.recordProjectIdentity).toHaveBeenCalledOnce();
      expect(chrome.calls.networkCreateRequests).toBe(1);
      expect(chrome.calls.postCreateMutations).toBe(0);
      expect(chrome.calls.routeAborts).toBe(1);
    } finally {
      rmSync(files.directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "redirect",
      {
        createResponseStatus: 302,
        createResponseUrl: "https://videoforge.example.test/api/v2/hosted/projects",
      },
    ],
    [
      "foreign response",
      {
        createResponseStatus: 201,
        createResponseUrl: "https://attacker.example/api/v2/hosted/projects",
      },
    ],
  ])("rejects a %s without releasing post-create continuation", async (_label, drift) => {
    const files = sourceFiles();
    try {
      const chrome = fakeChrome({ ...files, ...drift });
      const claims = claimPort(files.request);
      await expect(
        runV209RealChromePlaywright({
          request: files.request,
          claims,
          productionOrigin: "https://videoforge.example.test",
          authStatePath: files.authStatePath,
          voiceoverPath: files.voiceoverPath,
          verifiedOutputPath: files.verifiedOutputPath,
          launch: chrome.launch,
        }),
      ).rejects.toMatchObject({ code: "V209_REAL_CHROME_GENERATE_CLICK_AMBIGUOUS" });
      expect(chrome.calls.networkCreateRequests).toBe(1);
      expect(chrome.calls.routeFetchMaxRedirects).toEqual([0]);
      expect(claims.recordProjectIdentity).not.toHaveBeenCalled();
      expect(chrome.calls.postCreateMutations).toBe(0);
      expect(chrome.calls.routeAborts).toBe(1);
    } finally {
      rmSync(files.directory, { recursive: true, force: true });
    }
  });

  it("rejects a redirected HTTPS origin before any production UI action", async () => {
    const files = sourceFiles();
    try {
      const chrome = fakeChrome({
        ...files,
        redirectOrigin: "https://fixture.videoforge.example.test",
      });
      await expect(
        runV209RealChromePlaywright({
          request: files.request,
          claims: claimPort(files.request),
          productionOrigin: "https://videoforge.example.test",
          authStatePath: files.authStatePath,
          voiceoverPath: files.voiceoverPath,
          verifiedOutputPath: files.verifiedOutputPath,
          launch: chrome.launch,
        }),
      ).rejects.toMatchObject({ code: "V209_REAL_CHROME_BROWSER_UNAVAILABLE" });
      expect(chrome.calls.readinessClicks).toBe(0);
      expect(chrome.calls.startClicks).toBe(0);
    } finally {
      rmSync(files.directory, { recursive: true, force: true });
    }
  });
});
