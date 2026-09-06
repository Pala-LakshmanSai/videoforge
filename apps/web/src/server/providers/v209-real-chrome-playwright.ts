import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { chromium } from "@playwright/test";

import {
  V209_REAL_CHROME_CLICK_SCHEMA,
  V209_REAL_CHROME_DOWNLOAD_SCHEMA,
  V209_REAL_CHROME_PAGE_SCHEMA,
  V209_REAL_CHROME_PROGRESS_SCHEMA,
  V209_REAL_CHROME_SOURCE,
  V209_REAL_CHROME_VIDEO_SCHEMA,
  runV209RealChromeOperator,
  type V209GenerateClickClaimPort,
  type V209PrivateAccessEvidence,
  type V209RealChromeOperatorEvidence,
  type V209RealChromeOperatorRequest,
  type V209RealChromeSessionPort,
  type V209RealChromeStage,
  type V209StageProgressMonitorPort,
} from "./v209-real-chrome-operator.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UI_POLL_MS = 250;

export class V209RealChromePlaywrightError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V209RealChromePlaywrightError";
  }
}

function fail(code: string): never {
  throw new V209RealChromePlaywrightError(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    fail("V209_REAL_CHROME_PRODUCTION_ORIGIN_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  )
    fail("V209_REAL_CHROME_PRODUCTION_ORIGIN_INVALID");
  return origin.origin;
}

function exactRegularFile(path: string, code: string): string {
  const absolute = resolve(path);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(absolute);
  } catch {
    fail(code);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return absolute;
}

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function protectedAuthState(path: string): string {
  const absolute = exactRegularFile(path, "V209_REAL_CHROME_AUTH_STATE_INVALID");
  if (
    (lstatSync(absolute).mode & 0o777) !== 0o600 ||
    (lstatSync(dirname(absolute)).mode & 0o777) !== 0o700
  )
    fail("V209_REAL_CHROME_AUTH_STATE_INVALID");
  let value: Record<string, unknown>;
  try {
    value = record(
      JSON.parse(readFileSync(absolute, "utf8")) as unknown,
      "V209_REAL_CHROME_AUTH_STATE_INVALID",
    );
  } catch {
    fail("V209_REAL_CHROME_AUTH_STATE_INVALID");
  }
  if (
    !Array.isArray(value.cookies) ||
    value.cookies.length < 1 ||
    !Array.isArray(value.origins) ||
    !Object.keys(value).every((key) => key === "cookies" || key === "origins") ||
    !value.cookies.every((cookie) => {
      const item = record(cookie, "V209_REAL_CHROME_AUTH_STATE_INVALID");
      return (
        typeof item.name === "string" &&
        item.name.length > 0 &&
        typeof item.value === "string" &&
        item.value.length > 0
      );
    })
  )
    fail("V209_REAL_CHROME_AUTH_STATE_INVALID");
  return absolute;
}

function protectedOutputTarget(path: string): string {
  const absolute = resolve(path);
  const parent = lstatSync(dirname(absolute));
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    (parent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid()) ||
    existsSync(absolute)
  )
    fail("V209_REAL_CHROME_OUTPUT_TARGET_INVALID");
  return absolute;
}

function persistVerifiedOutput(path: string, bytes: Uint8Array): void {
  let descriptor: number | undefined;
  let closed = false;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fstatSync(descriptor);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      closed = true;
    }
    // Never unlink by pathname after releasing the file capability: a same-UID process could
    // replace that name between identity check and unlink. A failed 0600 partial is retained for
    // explicit identity-aware operator cleanup.
    throw error;
  } finally {
    if (descriptor !== undefined && !closed) closeSync(descriptor);
  }
}

async function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

interface PlaywrightLocator {
  count(): Promise<number>;
  nth(index: number): PlaywrightLocator;
  locator(selector: string): PlaywrightLocator;
  click(options?: Readonly<Record<string, unknown>>): Promise<void>;
  fill(value: string): Promise<void>;
  setInputFiles(path: string): Promise<void>;
  isEnabled(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  evaluate<T>(
    callback: (element: unknown, argument?: unknown) => T | Promise<T>,
    argument?: unknown,
  ): Promise<T>;
}

interface PlaywrightDownload {
  path(): Promise<string | null>;
  failure(): Promise<string | null>;
  delete(): Promise<void>;
}

interface PlaywrightRequest {
  method(): string;
  url(): string;
  postDataJSON(): unknown;
}

interface PlaywrightPage {
  goto(url: string, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
  url(): string;
  waitForURL(url: RegExp, options?: Readonly<Record<string, unknown>>): Promise<void>;
  waitForRequest(
    predicate: (request: PlaywrightRequest) => boolean,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<PlaywrightRequest>;
  waitForEvent(
    name: "download",
    options?: Readonly<Record<string, unknown>>,
  ): Promise<PlaywrightDownload>;
  evaluate<T>(callback: (argument: unknown) => T | Promise<T>, argument: unknown): Promise<T>;
  locator(selector: string): PlaywrightLocator;
  getByLabel(name: string, options?: Readonly<Record<string, unknown>>): PlaywrightLocator;
  getByRole(role: string, options?: Readonly<Record<string, unknown>>): PlaywrightLocator;
  close(): Promise<void>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options: {
    readonly storageState: string;
    readonly acceptDownloads: true;
    readonly baseURL: string;
  }): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

export type LaunchV209InstalledChrome = (options: {
  readonly channel: "chrome";
  readonly headless: false;
}) => Promise<PlaywrightBrowser>;

const launchInstalledChrome: LaunchV209InstalledChrome = async (options) =>
  (await chromium.launch(options)) as unknown as PlaywrightBrowser;

async function pageJson(page: PlaywrightPage, path: string, signal: AbortSignal): Promise<unknown> {
  return abortable(signal, () =>
    page.evaluate(async (argument) => {
      const relativePath = String(argument);
      const response = await fetch(relativePath, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    }, path),
  );
}

function assertTenant(value: unknown, request: V209RealChromeOperatorRequest): void {
  const tenant = record(value, "V209_REAL_CHROME_TENANT_INVALID");
  if (
    tenant.schema_version !== "videoforge-hosted-tenant/v1" ||
    tenant.account_id !== request.accountId ||
    tenant.workspace_id !== request.workspaceId
  )
    fail("V209_REAL_CHROME_TENANT_INVALID");
}

function assertPreparedSubmission(
  value: unknown,
  request: V209RealChromeOperatorRequest,
  schemaVersion: "videoforge-hosted-project-preflight/v1" | "videoforge-hosted-project-create/v2",
): void {
  const submission = record(value, "V209_REAL_CHROME_PREPARED_INPUT_INVALID");
  const voiceover = record(submission.voiceover, "V209_REAL_CHROME_PREPARED_INPUT_INVALID");
  if (
    Object.keys(submission).length !== 9 ||
    ![
      "schema_version",
      "title",
      "avatar_profile_version_id",
      "image_style_version_id",
      "extra_prompt_keywords",
      "apply_extra_prompt_keywords",
      "user_seed",
      "spend_cap_usd",
      "voiceover",
    ].every((key) => Object.hasOwn(submission, key)) ||
    Object.keys(voiceover).length !== 5 ||
    !["filename", "content_type", "content_length", "checksum_sha256", "duration_ms"].every((key) =>
      Object.hasOwn(voiceover, key),
    ) ||
    submission.schema_version !== schemaVersion ||
    submission.title !== request.prepared.title ||
    submission.avatar_profile_version_id !== request.prepared.avatarProfileVersionId ||
    submission.image_style_version_id !== request.prepared.imageStyleVersionId ||
    submission.extra_prompt_keywords !== "" ||
    submission.apply_extra_prompt_keywords !== false ||
    submission.user_seed !== null ||
    submission.spend_cap_usd !== request.prepared.spendCapUsd ||
    voiceover.filename !== request.prepared.voiceoverFilename ||
    voiceover.content_type !== request.prepared.voiceoverContentType ||
    voiceover.content_length !== request.prepared.voiceoverContentLength ||
    voiceover.checksum_sha256 !== request.prepared.voiceoverSha256 ||
    voiceover.duration_ms !== request.prepared.voiceoverDurationMs
  )
    fail("V209_REAL_CHROME_PREPARED_INPUT_INVALID");
}

function exactPost(origin: string, pathname: string): (request: PlaywrightRequest) => boolean {
  return (request) => {
    try {
      const url = new URL(request.url());
      return request.method() === "POST" && url.origin === origin && url.pathname === pathname;
    } catch {
      return false;
    }
  };
}

function catalogIndex(value: unknown, key: "avatars" | "styles", expectedId: string): number {
  const catalog = record(value, "V209_REAL_CHROME_CATALOG_INVALID");
  const items = catalog[key];
  if (!Array.isArray(items)) fail("V209_REAL_CHROME_CATALOG_INVALID");
  const index = items.findIndex(
    (item) => record(item, "V209_REAL_CHROME_CATALOG_INVALID").version_id === expectedId,
  );
  if (index < 0) fail("V209_REAL_CHROME_CATALOG_INVALID");
  return index;
}

async function choosePreset(
  page: PlaywrightPage,
  selector: string,
  optionIndex: number,
  signal: AbortSignal,
): Promise<void> {
  const root = page.locator(selector);
  const options = root.locator('[role="radio"]');
  const count = await abortable(signal, () => options.count());
  if (count === 0) {
    if (optionIndex !== 0) fail("V209_REAL_CHROME_PREPARED_INPUT_INVALID");
    return;
  }
  if (optionIndex >= count) fail("V209_REAL_CHROME_PREPARED_INPUT_INVALID");
  await abortable(signal, () => root.locator("summary").click());
  const option = options.nth(optionIndex);
  await abortable(signal, () => option.click());
  if ((await abortable(signal, () => option.getAttribute("aria-checked"))) !== "true")
    fail("V209_REAL_CHROME_PREPARED_INPUT_INVALID");
}

async function waitForEnabled(locator: PlaywrightLocator, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    if (
      (await abortable(signal, () => locator.count())) === 1 &&
      (await abortable(signal, () => locator.isEnabled()))
    )
      return;
    await abortable(
      signal,
      () => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, UI_POLL_MS)),
    );
  }
  throw signal.reason;
}

function assertProjectDetail(
  value: unknown,
  request: V209RealChromeOperatorRequest,
  expected?: {
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
  },
) {
  const detail = record(value, "V209_REAL_CHROME_PROJECT_INVALID");
  const project = record(detail.project, "V209_REAL_CHROME_PROJECT_INVALID");
  const generation = record(detail.generation, "V209_REAL_CHROME_PROJECT_INVALID");
  if (
    detail.schema_version !== "videoforge-hosted-project-detail/v1" ||
    !UUID.test(String(project.id)) ||
    !UUID.test(String(project.revision_id)) ||
    !UUID.test(String(generation.id)) ||
    project.title !== request.prepared.title ||
    project.revision_state !== "LOCKED" ||
    (expected !== undefined &&
      (project.id !== expected.projectId ||
        project.revision_id !== expected.projectRevisionId ||
        generation.id !== expected.generationRequestId))
  )
    fail("V209_REAL_CHROME_PROJECT_INVALID");
  return { detail, project, generation };
}

function signedR2GetEvidence(
  value: unknown,
  objectKey: string,
  download: boolean,
): { readonly url: string; readonly evidence: V209PrivateAccessEvidence } {
  let url: URL;
  let decodedPath: string;
  try {
    url = new URL(String(value));
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    fail("V209_REAL_CHROME_OUTPUT_PRIVATE_ACCESS_INVALID");
  }
  const expectedKeys = [
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-Signature",
    "X-Amz-SignedHeaders",
    ...(download ? ["response-content-disposition"] : []),
  ].sort();
  const actualKeys = [...url.searchParams.keys()].sort();
  const pathSegments = decodedPath.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !/^[a-z0-9][a-z0-9-]*\.r2\.cloudflarestorage\.com$/u.test(url.hostname) ||
    pathSegments.length < 2 ||
    pathSegments.slice(1).join("/") !== objectKey ||
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
    url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
    !/^\d{8}T\d{6}Z$/u.test(url.searchParams.get("X-Amz-Date") ?? "") ||
    !/\/\d{8}\/auto\/s3\/aws4_request$/u.test(url.searchParams.get("X-Amz-Credential") ?? "") ||
    url.searchParams.get("X-Amz-Expires") !== "300" ||
    url.searchParams.get("X-Amz-SignedHeaders") !== "host" ||
    !/^[0-9a-f]{64}$/u.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
    (download &&
      url.searchParams.get("response-content-disposition") !==
        'attachment; filename="videoforge-output.mp4"')
  )
    fail("V209_REAL_CHROME_OUTPUT_PRIVATE_ACCESS_INVALID");
  return {
    url: url.toString(),
    evidence: Object.freeze({
      kind: "SIGNED_R2_GET",
      objectKey,
      signedUrlSha256: sha256Bytes(Buffer.from(url.toString(), "utf8")),
      algorithm: "AWS4-HMAC-SHA256",
      expiresSeconds: 300,
      signedHeaders: "host",
    }),
  };
}

interface TerminalOutput {
  readonly renderAttemptId: string;
  readonly outputId: string;
  readonly contentLength: number;
  readonly sha256: string;
  readonly previewUrl: string;
  readonly privateAccess: V209PrivateAccessEvidence;
}

function terminalOutput(
  detail: Record<string, unknown>,
  request: V209RealChromeOperatorRequest,
  identity: {
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
  },
): TerminalOutput | null {
  const attempts = detail.attempts;
  if (!Array.isArray(attempts)) fail("V209_REAL_CHROME_PROJECT_INVALID");
  const render = [...attempts]
    .reverse()
    .map((value) => record(value, "V209_REAL_CHROME_PROJECT_INVALID"))
    .find((value) => value.kind === "RENDER" && value.state === "SUCCEEDED");
  if (!render) return null;
  const renderAttemptId = String(render.id ?? "");
  const contentLength = Number(render.content_length);
  const checksum = String(render.output_checksum_sha256 ?? "");
  const objectKey = String(render.object_key ?? "");
  const expectedPrefix = `tenant/${request.accountId}/workspace/${request.workspaceId}/project/${identity.projectId}/revision/${identity.projectRevisionId}/lane/render/job/${renderAttemptId}/artifact/`;
  if (
    !UUID.test(renderAttemptId) ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    !SHA256.test(checksum) ||
    Number(render.result_content_length) !== contentLength ||
    render.result_checksum_sha256 !== render.output_checksum_sha256 ||
    render.content_type !== "video/mp4" ||
    render.result_content_type !== "video/mp4" ||
    render.result_object_key !== objectKey ||
    !objectKey.startsWith(expectedPrefix) ||
    !/^[A-Za-z0-9._:-]+$/u.test(objectKey.slice(expectedPrefix.length))
  )
    fail("V209_REAL_CHROME_OUTPUT_INVALID");
  const preview = signedR2GetEvidence(render.preview_url, objectKey, false);
  return {
    renderAttemptId,
    outputId: objectKey,
    contentLength,
    sha256: checksum,
    previewUrl: preview.url,
    privateAccess: preview.evidence,
  };
}

function progressStage(detail: Record<string, unknown>): V209RealChromeStage {
  const stages = detail.stages;
  if (!Array.isArray(stages)) return "PREPARING";
  const active = stages
    .map((value) => record(value, "V209_REAL_CHROME_PROJECT_INVALID"))
    .find((value) =>
      ["QUEUED", "STARTING", "RUNNING", "PREPARING", "ACTIVE", "ADMITTED", "SUBMITTED"].includes(
        String(value.status).toUpperCase(),
      ),
    );
  const id = String(active?.id ?? "");
  if (id === "image-generation") return "GENERATING_IMAGES";
  if (id === "avatar-generation") return "GENERATING_AVATAR";
  if (id === "render" || id === "technical-check") return "RENDERING";
  if (
    id === "prepare" ||
    id === "transcription" ||
    id === "voiceover-context" ||
    id === "planning" ||
    id === "prompt-writing"
  )
    return "PREPARING";
  return detail.queue ? "QUEUED" : "PREPARING";
}

class V209PlaywrightSession implements V209RealChromeSessionPort, V209StageProgressMonitorPort {
  #clickCount = 0;
  #sequence = 0;
  #identity: {
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
  } | null = null;
  #durationSeconds: number | null = null;
  #terminalOutput: TerminalOutput | null = null;

  constructor(
    private readonly request: V209RealChromeOperatorRequest,
    private readonly page: PlaywrightPage,
    private readonly context: PlaywrightContext,
    private readonly browser: PlaywrightBrowser,
    private readonly voiceoverPath: string,
    private readonly expectedOrigin: string,
    private readonly verifiedOutputPath: string,
  ) {}

  async readGeneratePage(input: { readonly signal: AbortSignal }): Promise<unknown> {
    this.assertProductionOrigin();
    const tenant = await pageJson(this.page, "/api/v2/tenant", input.signal);
    assertTenant(tenant, this.request);
    const catalog = await pageJson(this.page, "/api/v2/hosted/project-catalog", input.signal);
    const avatarIndex = catalogIndex(
      catalog,
      "avatars",
      this.request.prepared.avatarProfileVersionId,
    );
    const styleIndex = catalogIndex(catalog, "styles", this.request.prepared.imageStyleVersionId);
    await abortable(input.signal, () =>
      this.page.getByLabel("Video title", { exact: true }).fill(this.request.prepared.title),
    );
    await abortable(input.signal, () =>
      this.page.getByLabel("Final voiceover", { exact: true }).setInputFiles(this.voiceoverPath),
    );
    await choosePreset(this.page, "#hosted-avatar-select", avatarIndex, input.signal);
    await choosePreset(this.page, "#hosted-style-select", styleIndex, input.signal);
    await abortable(input.signal, () =>
      this.page
        .getByLabel("Maximum spend", { exact: true })
        .fill(String(this.request.prepared.spendCapUsd)),
    );
    const preflight = this.page.getByRole("button", {
      name: "Check cost & readiness",
      exact: true,
    });
    await waitForEnabled(preflight, input.signal);
    this.assertProductionOrigin();
    const preflightRequest = this.page.waitForRequest(
      exactPost(this.expectedOrigin, "/api/v2/hosted/projects/preflight"),
    );
    await abortable(input.signal, () => preflight.click());
    assertPreparedSubmission(
      (await abortable(input.signal, () => preflightRequest)).postDataJSON(),
      this.request,
      "videoforge-hosted-project-preflight/v1",
    );
    const start = this.page.getByRole("button", {
      name: "Create project & start",
      exact: true,
    });
    await waitForEnabled(start, input.signal);
    return Object.freeze({
      schemaVersion: V209_REAL_CHROME_PAGE_SCHEMA,
      browser: "chrome",
      mode: "PRODUCTION",
      source: V209_REAL_CHROME_SOURCE,
      accountId: this.request.accountId,
      workspaceId: this.request.workspaceId,
      prepared: this.request.prepared,
      generateReady: true,
      generateClickCount: this.#clickCount,
    });
  }

  async clickGenerate(input: {
    readonly claimId: string;
    readonly signal: AbortSignal;
  }): Promise<unknown> {
    if (this.#clickCount !== 0) fail("V209_REAL_CHROME_SECOND_CLICK_FORBIDDEN");
    this.assertProductionOrigin();
    this.#clickCount = 1;
    const start = this.page.getByRole("button", {
      name: "Create project & start",
      exact: true,
    });
    const createRequest = this.page.waitForRequest(
      exactPost(this.expectedOrigin, "/api/v2/hosted/projects"),
    );
    await abortable(input.signal, () => start.click());
    assertPreparedSubmission(
      (await abortable(input.signal, () => createRequest)).postDataJSON(),
      this.request,
      "videoforge-hosted-project-create/v2",
    );
    await abortable(input.signal, () =>
      this.page.waitForURL(/\/projects\/[0-9a-f-]+$/u, { waitUntil: "domcontentloaded" }),
    );
    this.assertProductionOrigin();
    const match = /\/projects\/([0-9a-f-]+)$/u.exec(new URL(this.page.url()).pathname);
    if (!match || !UUID.test(match[1]!)) fail("V209_REAL_CHROME_PROJECT_INVALID");
    const value = await pageJson(this.page, `/api/v2/hosted/projects/${match[1]!}`, input.signal);
    const { project, generation } = assertProjectDetail(value, this.request);
    this.#identity = {
      projectId: String(project.id),
      projectRevisionId: String(project.revision_id),
      generationRequestId: String(generation.id),
    };
    return Object.freeze({
      schemaVersion: V209_REAL_CHROME_CLICK_SCHEMA,
      claimId: input.claimId,
      source: V209_REAL_CHROME_SOURCE,
      accountId: this.request.accountId,
      workspaceId: this.request.workspaceId,
      ...this.#identity,
      state: "ACKNOWLEDGED",
      clickOrdinal: 1,
      generateClickCount: 1,
    });
  }

  async read(input: Parameters<V209StageProgressMonitorPort["read"]>[0]): Promise<unknown> {
    if (!this.#identity || input.afterSequence !== this.#sequence)
      fail("V209_REAL_CHROME_PROJECT_INVALID");
    this.assertProductionOrigin();
    const value = await pageJson(
      this.page,
      `/api/v2/hosted/projects/${this.#identity.projectId}`,
      input.signal,
    );
    const { detail } = assertProjectDetail(value, this.request, this.#identity);
    this.#sequence += 1;
    const attempts = detail.attempts as unknown[];
    const failed = attempts
      .map((attempt) => record(attempt, "V209_REAL_CHROME_PROJECT_INVALID"))
      .some((attempt) => ["FAILED", "CANCELLED", "CANCELED"].includes(String(attempt.state)));
    const output = terminalOutput(detail, this.request, this.#identity);
    if (output) this.#terminalOutput = output;
    return Object.freeze({
      schemaVersion: V209_REAL_CHROME_PROGRESS_SCHEMA,
      source: V209_REAL_CHROME_SOURCE,
      accountId: this.request.accountId,
      workspaceId: this.request.workspaceId,
      ...this.#identity,
      sequence: this.#sequence,
      stage: failed ? "FAILED" : output ? "COMPLETE" : progressStage(detail),
      terminalState: failed ? "FAILED" : output ? "SUCCEEDED" : "PENDING",
      output: output
        ? {
            renderAttemptId: output.renderAttemptId,
            outputId: output.outputId,
            contentType: "video/mp4",
            contentLength: output.contentLength,
            sha256: output.sha256,
            privateAccess: output.privateAccess,
          }
        : null,
    });
  }

  async playPrivateVideo(
    input: Parameters<V209RealChromeSessionPort["playPrivateVideo"]>[0],
  ): Promise<unknown> {
    await abortable(input.signal, () =>
      this.page.goto(`${this.expectedOrigin}/projects/${input.projectId}/review`, {
        waitUntil: "domcontentloaded",
      }),
    );
    this.assertProductionOrigin();
    const video = this.page.locator("video");
    if ((await abortable(input.signal, () => video.count())) !== 1)
      fail("V209_REAL_CHROME_PLAYBACK_INVALID");
    const source = await abortable(input.signal, () => video.getAttribute("src"));
    if (
      !this.#terminalOutput ||
      input.renderAttemptId !== this.#terminalOutput.renderAttemptId ||
      input.outputId !== this.#terminalOutput.outputId ||
      input.outputSha256 !== this.#terminalOutput.sha256 ||
      input.privateAccess.signedUrlSha256 !== this.#terminalOutput.privateAccess.signedUrlSha256 ||
      source !== this.#terminalOutput.previewUrl
    )
      fail("V209_REAL_CHROME_PLAYBACK_INVALID");
    const facts = await abortable(input.signal, () =>
      video.evaluate(async (element) => {
        const media = element as {
          muted: boolean;
          duration: number;
          currentTime: number;
          play(): Promise<void>;
        };
        media.muted = true;
        await media.play();
        while (media.currentTime <= 0)
          await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
        return { durationSeconds: media.duration, currentTime: media.currentTime };
      }),
    );
    this.#durationSeconds = facts.durationSeconds;
    return this.videoObservation(input, facts.durationSeconds, facts.currentTime, true);
  }

  async seekPrivateVideo(
    input: Parameters<V209RealChromeSessionPort["seekPrivateVideo"]>[0],
  ): Promise<unknown> {
    this.assertProductionOrigin();
    const video = this.page.locator("video");
    const facts = await abortable(input.signal, () =>
      video.evaluate(async (element, argument) => {
        const media = element as { duration: number; currentTime: number };
        const targetTime = Number(argument);
        media.currentTime = targetTime;
        while (Math.abs(media.currentTime - targetTime) > 0.25)
          await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
        return { durationSeconds: media.duration, currentTime: media.currentTime };
      }, input.targetTime),
    );
    return {
      ...this.videoObservation(input, facts.durationSeconds, facts.currentTime, false),
      requestedTime: input.targetTime,
    };
  }

  async downloadPrivateVideo(
    input: Parameters<V209RealChromeSessionPort["downloadPrivateVideo"]>[0],
  ): Promise<unknown> {
    this.assertProductionOrigin();
    const approve = this.page.getByRole("button", { name: "Approve final", exact: true });
    if (
      (await abortable(input.signal, () => approve.count())) === 1 &&
      (await abortable(input.signal, () => approve.isEnabled()))
    )
      await abortable(input.signal, () => approve.click());
    const link = this.page.getByRole("link", { name: "Download MP4", exact: true });
    await waitForEnabled(link, input.signal);
    if (!this.#terminalOutput) fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
    const downloadAccess = signedR2GetEvidence(
      await abortable(input.signal, () => link.getAttribute("href")),
      this.#terminalOutput.outputId,
      true,
    );
    const downloadPromise = this.page.waitForEvent("download");
    await abortable(input.signal, () => link.click());
    const download = await abortable(input.signal, () => downloadPromise);
    try {
      if ((await abortable(input.signal, () => download.failure())) !== null)
        fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
      const path = await abortable(input.signal, () => download.path());
      if (!path) fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
      const bytes = await abortable(input.signal, () => readFile(path, { signal: input.signal }));
      if (sha256Bytes(bytes) !== input.outputSha256) fail("V209_REAL_CHROME_DOWNLOAD_INVALID");
      if (input.signal.aborted) throw input.signal.reason;
      // Synchronous exclusive write+fsync keeps the outer deadline from returning while a
      // verified private artifact is still being materialized in the background.
      persistVerifiedOutput(this.verifiedOutputPath, bytes);
      return Object.freeze({
        schemaVersion: V209_REAL_CHROME_DOWNLOAD_SCHEMA,
        mode: "PRODUCTION",
        source: V209_REAL_CHROME_SOURCE,
        accountId: this.request.accountId,
        workspaceId: this.request.workspaceId,
        projectId: input.projectId,
        projectRevisionId: input.projectRevisionId,
        generationRequestId: input.generationRequestId,
        renderAttemptId: input.renderAttemptId,
        outputId: input.outputId,
        outputSha256: input.outputSha256,
        privateAccess: downloadAccess.evidence,
        contentType: "video/mp4",
        contentLength: bytes.length,
        private: true,
        downloaded: true,
        generateClickCount: 1,
      });
    } finally {
      await abortable(input.signal, () => download.delete()).catch(() => undefined);
    }
  }

  async close(input: { readonly signal: AbortSignal }): Promise<void> {
    await Promise.allSettled([
      abortable(input.signal, () => this.page.close()),
      abortable(input.signal, () => this.context.close()),
      abortable(input.signal, () => this.browser.close()),
    ]);
  }

  private assertProductionOrigin(): void {
    let currentOrigin: string;
    try {
      currentOrigin = new URL(this.page.url()).origin;
    } catch {
      fail("V209_REAL_CHROME_PRODUCTION_ORIGIN_INVALID");
    }
    if (currentOrigin !== this.expectedOrigin) fail("V209_REAL_CHROME_PRODUCTION_ORIGIN_INVALID");
  }

  private videoObservation(
    input: {
      readonly projectId: string;
      readonly projectRevisionId: string;
      readonly generationRequestId: string;
      readonly renderAttemptId: string;
      readonly outputId: string;
      readonly outputSha256: string;
      readonly privateAccess: V209PrivateAccessEvidence;
    },
    durationSeconds: number,
    currentTime: number,
    playing: boolean,
  ): Record<string, unknown> {
    return {
      schemaVersion: V209_REAL_CHROME_VIDEO_SCHEMA,
      mode: "PRODUCTION",
      source: V209_REAL_CHROME_SOURCE,
      accountId: this.request.accountId,
      workspaceId: this.request.workspaceId,
      projectId: input.projectId,
      projectRevisionId: input.projectRevisionId,
      generationRequestId: input.generationRequestId,
      renderAttemptId: input.renderAttemptId,
      outputId: input.outputId,
      outputSha256: input.outputSha256,
      privateAccess: input.privateAccess,
      contentType: "video/mp4",
      private: true,
      ...(playing ? { playing: true } : {}),
      durationSeconds: durationSeconds || this.#durationSeconds,
      currentTime,
      generateClickCount: 1,
    };
  }
}

export interface RunV209RealChromePlaywrightInput {
  readonly request: V209RealChromeOperatorRequest;
  readonly claims: V209GenerateClickClaimPort;
  readonly productionOrigin: string;
  readonly authStatePath: string;
  readonly voiceoverPath: string;
  readonly verifiedOutputPath: string;
  readonly launch?: LaunchV209InstalledChrome;
}

export async function runV209RealChromePlaywright(
  input: RunV209RealChromePlaywrightInput,
): Promise<V209RealChromeOperatorEvidence> {
  const origin = exactOrigin(input.productionOrigin);
  const authStatePath = protectedAuthState(input.authStatePath);
  const verifiedOutputPath = protectedOutputTarget(input.verifiedOutputPath);
  const voiceoverPath = exactRegularFile(
    input.voiceoverPath,
    "V209_REAL_CHROME_PREPARED_INPUT_INVALID",
  );
  const voiceoverBytes = readFileSync(voiceoverPath);
  if (
    basename(voiceoverPath) !== input.request.prepared.voiceoverFilename ||
    voiceoverBytes.length !== input.request.prepared.voiceoverContentLength ||
    sha256Bytes(voiceoverBytes) !== input.request.prepared.voiceoverSha256
  )
    fail("V209_REAL_CHROME_PREPARED_INPUT_INVALID");

  const launch = input.launch ?? launchInstalledChrome;
  let browser: PlaywrightBrowser | undefined;
  let context: PlaywrightContext | undefined;
  let page: PlaywrightPage | undefined;
  let session: V209PlaywrightSession | undefined;
  const browserPort = {
    openSession: async ({ signal }: { readonly signal: AbortSignal }) => {
      try {
        browser = await abortable(signal, () => launch({ channel: "chrome", headless: false }));
        context = await abortable(signal, () =>
          browser!.newContext({
            storageState: authStatePath,
            acceptDownloads: true,
            baseURL: origin,
          }),
        );
        page = await abortable(signal, () => context!.newPage());
        await abortable(signal, () =>
          page!.goto(`${origin}/projects/new`, { waitUntil: "domcontentloaded" }),
        );
        if (new URL(page.url()).origin !== origin)
          fail("V209_REAL_CHROME_PRODUCTION_ORIGIN_INVALID");
        session = new V209PlaywrightSession(
          input.request,
          page,
          context,
          browser,
          voiceoverPath,
          origin,
          verifiedOutputPath,
        );
        return session;
      } catch (error) {
        void Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
        throw error;
      }
    },
  };
  const progressPort: V209StageProgressMonitorPort = {
    read: (value) => {
      if (!session) fail("V209_REAL_CHROME_BROWSER_UNAVAILABLE");
      return session.read(value);
    },
  };
  return runV209RealChromeOperator({
    request: input.request,
    claims: input.claims,
    browser: browserPort,
    progress: progressPort,
  });
}
