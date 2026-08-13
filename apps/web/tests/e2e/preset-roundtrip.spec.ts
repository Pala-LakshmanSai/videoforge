import { createHash } from "node:crypto";

import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

interface RuntimeFailures {
  consoleErrors: string[];
  externalRequests: string[];
  failedResponses: string[];
  pageErrors: string[];
}

interface ProjectDraftSnapshot {
  applyExtraPromptKeywords: boolean;
  avatarProfileVersionId: string;
  executionProfileOverrides: {
    avatar_primary_profile_id?: string;
    image_media_profile_id?: string;
  } | null;
  extraPromptKeywords: string;
  generationMode: "LOWEST_COST" | "BALANCED" | "FASTER";
  imageStyleVersionId: string;
  spendCapUsd: number;
  title: string;
  userSeed: number;
  voiceoverAssetId: string | null;
  voiceoverChannels: number | null;
  voiceoverChecksum: string | null;
  voiceoverDurationSeconds: number | null;
  voiceoverName: string | null;
  voiceoverSampleRate: number | null;
}

interface CreatedAvatarResponse {
  avatarProfile: { name: string; versionId: string };
  immutableVersion: true;
  providerCallsAuthorized: false;
  uploadedBytesPersisted: false;
}

interface CreatedStyleResponse {
  name: string;
  version_id: string;
  state: "PUBLISHED";
  provider_calls_authorized: false;
  original_bytes_persisted: false;
  normalized_bytes_persisted: true;
}

const runtimeFailures = new WeakMap<Page, RuntimeFailures>();

function fixtureSessionId(testInfo: TestInfo): string {
  const project = testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-").slice(0, 32);
  const digest = createHash("sha256")
    .update(
      [
        testInfo.file,
        testInfo.title,
        testInfo.project.name,
        testInfo.repeatEachIndex,
        testInfo.retry,
      ]
        .map(String)
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 20);
  return `pw-${project}-${digest}`;
}

function isLocalRequest(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return (
    ["data:", "blob:"].includes(url.protocol) || ["localhost", "127.0.0.1"].includes(url.hostname)
  );
}

function createPcmWavBuffer(variant: number, durationSeconds = 10.25, sampleRate = 8_000): Buffer {
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const dataBytes = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  wav.writeInt16LE(Math.max(1, variant % 32_767), 44);
  return wav;
}

async function createDecodablePng(page: Page, variant: number): Promise<Buffer> {
  const encoded = await page.evaluate((seed) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");

    const hue = (seed * 61) % 360;
    const gradient = context.createLinearGradient(0, 0, 640, 640);
    gradient.addColorStop(0, `hsl(${hue} 48% 28%)`);
    gradient.addColorStop(1, `hsl(${(hue + 78) % 360} 58% 62%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 640, 640);
    context.fillStyle = "rgba(255, 255, 255, .72)";
    context.beginPath();
    context.arc(320, 250 + seed * 7, 118, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(8, 11, 24, .72)";
    context.fillRect(146, 410, 348, 94);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  }, variant);

  const png = Buffer.from(encoded, "base64");
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return png;
}

async function readDraft(page: Page): Promise<ProjectDraftSnapshot> {
  return page.evaluate(() => {
    const scope = new URL(window.location.href).searchParams.get("fixture") ?? "default";
    const stored = localStorage.getItem(
      `videoforge:project-draft:v3:fixture:${encodeURIComponent(scope)}`,
    );
    if (!stored) throw new Error("Project draft was not persisted");
    return JSON.parse(stored) as ProjectDraftSnapshot;
  });
}

async function expectDecodedImage(page: Page, accessibleName: string | RegExp, minimum = 1) {
  const image = page.getByRole("img", { name: accessibleName });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const candidate = element as HTMLImageElement;
        return candidate.complete ? candidate.naturalWidth : 0;
      }),
    )
    .toBeGreaterThanOrEqual(minimum);
}

function uniqueName(prefix: string, testInfo: TestInfo): string {
  const project = testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-");
  return `${prefix} ${project} ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function installMutationGate(page: Page, path: string) {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let resolveResponse: ((value: { body: unknown; status: number }) => void) | undefined;
  const response = new Promise<{ body: unknown; status: number }>((resolve) => {
    resolveResponse = resolve;
  });
  let postCount = 0;

  await page.route(`**${path}?fixture=project_create_ready`, async (route: Route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      await gate;
      const upstream = await route.fetch();
      const body = (await upstream.json()) as unknown;
      resolveResponse?.({ body, status: upstream.status() });
      await route.fulfill({ response: upstream });
      return;
    }
    await route.continue();
  });

  return {
    postCount: () => postCount,
    release: () => release?.(),
    response,
  };
}

async function expectProjectDraftVisible(page: Page, expected: ProjectDraftSnapshot) {
  await expect(page).toHaveURL(/\/projects\/new\?fixture=project_create_ready$/u);
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();
  await expect(page.getByLabel("Video title")).toHaveValue(expected.title);
  await expect(page.locator(".dropzone")).toContainText(expected.voiceoverName ?? "");
  await expect(page.getByLabel("Hard spend cap")).toHaveValue(String(expected.spendCapUsd));
  await expect(page.getByRole("button", { name: /FASTER/u })).toHaveClass(/selected/u);
}

test.beforeEach(async ({ page }, testInfo) => {
  const sessionId = fixtureSessionId(testInfo);
  await page.setExtraHTTPHeaders({
    "X-VideoForge-Fixture-Session": sessionId,
  });
  const reset = await page.request.post("/api/dev/fixture-session/reset", {
    headers: { "X-VideoForge-Fixture-Session": sessionId },
  });
  expect(reset.ok()).toBe(true);
  const failures: RuntimeFailures = {
    consoleErrors: [],
    externalRequests: [],
    failedResponses: [],
    pageErrors: [],
  };
  runtimeFailures.set(page, failures);

  page.on("request", (request) => {
    if (!isLocalRequest(request.url())) failures.externalRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => failures.pageErrors.push(error.message));

  await page.goto("/projects/new?fixture=project_create_ready");
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const failures = runtimeFailures.get(page);
  expect(failures?.consoleErrors ?? []).toEqual([]);
  expect(failures?.externalRequests ?? []).toEqual([]);
  expect(failures?.failedResponses ?? []).toEqual([]);
  expect(failures?.pageErrors ?? []).toEqual([]);
});

test("new Avatar and Image Style round trips preserve and update the exact project draft", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  const avatarName = uniqueName("Roundtrip Avatar", testInfo);
  const styleName = uniqueName("Roundtrip Style", testInfo);
  const title = uniqueName("Roundtrip Project", testInfo);
  const audioVariant = [...testInfo.project.name].reduce(
    (total, character) => total + character.codePointAt(0)!,
    0,
  );
  const [avatarPng, stylePngOne, stylePngTwo, stylePngThree] = await Promise.all([
    createDecodablePng(page, 1),
    createDecodablePng(page, 2),
    createDecodablePng(page, 3),
    createDecodablePng(page, 4),
  ]);

  const presetSummaries = page.locator("summary.visual-preset-summary");
  const avatarSummary = presetSummaries.nth(0);
  const styleSummary = presetSummaries.nth(1);
  await expect(presetSummaries).toHaveCount(2);
  await expect(avatarSummary).toContainText("Amish Farm Host");
  await expect(styleSummary).toContainText("Authentic Documentary Stock");
  await expect(page.locator(".visual-preset-menu:visible")).toHaveCount(0);
  await expect(page.getByLabel("Exact script (optional)")).toHaveCount(0);
  await expect(page.getByText(/Keywords (?:will be applied|not applied)/iu)).toHaveCount(0);

  await avatarSummary.click();
  await expect(page.getByRole("radiogroup", { name: "Avatar Profile options" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Amish Farm Host/u })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("radiogroup", { name: "Avatar Profile options" })).not.toBeVisible();
  await expect(avatarSummary).toBeFocused();

  for (const name of ["Image and media GPU offer", "Avatar GPU offer"] as const) {
    const trigger = page.getByLabel(name, { exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("NVIDIA RTX 4090");
    await expect(trigger).toContainText("$0.34/hr");
    await trigger.click();
    const listbox = page.getByRole("listbox", { name: `${name} options` });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option", { name: /RTX 4090/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(listbox.getByRole("option", { name: /RTX A6000/u })).toBeEnabled();
    await expect(listbox.getByText(/Secure Cloud · EU-RO-1 · receipt/u).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await expect(page.locator("select")).toHaveCount(0);

  await page.getByLabel("Video title").fill(title);
  await page.getByLabel("Upload final voiceover").setInputFiles({
    name: "roundtrip-voiceover.wav",
    mimeType: "audio/wav",
    buffer: createPcmWavBuffer(audioVariant),
  });
  await expect(page.locator(".dropzone")).toContainText("Verified and ready");

  await styleSummary.click();
  await page.getByRole("radio", { name: /Warm Rural Documentary/u }).click();
  await expect(styleSummary).toContainText("Warm Rural Documentary");
  await page.locator("summary.disclosure-summary").filter({ hasText: "Image keywords" }).click();
  await page.getByLabel("Apply extra image prompt keywords").click();
  await page.getByLabel("Image keywords").fill("natural light, no logo, no AI look");
  await page.getByRole("button", { name: /FASTER/u }).click();
  await page.getByLabel("Hard spend cap").fill("1.75");

  const originalDraft = await readDraft(page);
  expect(originalDraft).toMatchObject({
    applyExtraPromptKeywords: true,
    extraPromptKeywords: "natural light, no logo, no AI look",
    generationMode: "FASTER",
    imageStyleVersionId: "style_version_warm_rural_v1",
    spendCapUsd: 1.75,
    title,
    voiceoverAssetId: expect.stringMatching(/^fixture_voiceover_sha256_[a-f0-9]{64}$/u),
  });

  let avatarMutationCount = 0;
  page.on("request", (request) => {
    if (
      ["PATCH", "POST"].includes(request.method()) &&
      new URL(request.url()).pathname === "/api/v1/avatar-profiles"
    ) {
      avatarMutationCount += 1;
    }
  });
  await page.getByRole("link", { name: "New avatar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New avatar" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectProjectDraftVisible(page, originalDraft);
  expect(await readDraft(page)).toEqual(originalDraft);
  expect(avatarMutationCount).toBe(0);

  await page.getByRole("link", { name: "New avatar", exact: true }).click();
  await page.getByLabel("Profile name").fill(avatarName);
  await page.getByLabel("Upload avatar source").setInputFiles({
    name: "roundtrip-avatar.png",
    mimeType: "image/png",
    buffer: avatarPng,
  });
  const reviewSource = page.getByRole("button", { name: /Review source/u });
  await expect(reviewSource).toBeEnabled();
  await reviewSource.click();
  await expectDecodedImage(page, "Selected avatar source preview", 640);
  await page.getByRole("button", { name: /Confirm framing/u }).click();
  await page.getByRole("checkbox", { name: /Image-use rights/u }).check();
  await page.getByRole("checkbox", { name: /Likeness animation consent/u }).check();

  const avatarGate = await installMutationGate(page, "/api/v1/avatar-profiles");
  const saveAvatar = page.getByRole("button", { name: "Approve and add to Avatar Hub" });
  await saveAvatar.click();
  await expect(saveAvatar).toBeDisabled();
  await expect(saveAvatar).toHaveAttribute("aria-busy", "true");
  await expect.poll(avatarGate.postCount).toBe(1);
  await saveAvatar.evaluate((button: HTMLButtonElement) => button.click());
  expect(avatarGate.postCount()).toBe(1);
  avatarGate.release();

  const avatarResponse = await avatarGate.response;
  expect(avatarResponse.status).toBe(201);
  const createdAvatar = avatarResponse.body as CreatedAvatarResponse;
  expect(createdAvatar).toMatchObject({
    avatarProfile: {
      name: avatarName,
      versionId: expect.stringMatching(/^avatar_profile_version_/u),
    },
    immutableVersion: true,
    providerCallsAuthorized: false,
    uploadedBytesPersisted: false,
  });
  await expect(page).toHaveURL(/\/projects\/new\?fixture=project_create_ready$/u);
  const afterAvatar = await readDraft(page);
  expect(afterAvatar.avatarProfileVersionId).toBe(createdAvatar.avatarProfile.versionId);
  expect({ ...afterAvatar, avatarProfileVersionId: originalDraft.avatarProfileVersionId }).toEqual(
    originalDraft,
  );
  await expect(page.locator("summary.visual-preset-summary").nth(0)).toContainText(avatarName);
  const avatarCatalog = await page.evaluate(async () => {
    const response = await fetch("/api/v1/avatar-profiles?fixture=project_create_ready");
    if (!response.ok) throw new Error(`Avatar catalog returned ${response.status}`);
    return (await response.json()) as Array<{ name: string; versionId: string }>;
  });
  expect(avatarCatalog).toContainEqual(
    expect.objectContaining({ name: avatarName, versionId: createdAvatar.avatarProfile.versionId }),
  );
  expect(avatarMutationCount).toBe(1);

  let styleMutationCount = 0;
  page.on("request", (request) => {
    if (
      ["PATCH", "POST"].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith("/api/v1/image-style")
    ) {
      styleMutationCount += 1;
    }
  });
  await page.getByRole("link", { name: "New style", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New style" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectProjectDraftVisible(page, afterAvatar);
  expect(await readDraft(page)).toEqual(afterAvatar);
  expect(styleMutationCount).toBe(0);

  await page.getByRole("link", { name: "New style", exact: true }).click();
  await page.getByLabel("Style name").fill(styleName);
  await page.getByLabel("Upload style references").setInputFiles([
    { name: "reference-one.png", mimeType: "image/png", buffer: stylePngOne },
    { name: "reference-two.png", mimeType: "image/png", buffer: stylePngTwo },
    { name: "reference-three.png", mimeType: "image/png", buffer: stylePngThree },
  ]);
  const references = page.locator(".fixture-upload-preview img");
  await expect(references).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect
      .poll(() =>
        references
          .nth(index)
          .evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0)),
      )
      .toBeGreaterThanOrEqual(640);
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: /Reference rights attestation/u }).check();
  await page.getByRole("checkbox", { name: /Runware processing disclosure/u }).check();
  await page.getByRole("button", { name: "Analyze fixture references" }).click();
  await expect(page.getByLabel("Reviewed lighting")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Reviewed lighting")).toHaveValue(/Natural available light/u);
  await page.getByLabel("Reviewed lighting").fill("Edited natural window light");
  await page.getByRole("button", { name: "Accept reviewed profile" }).click();

  const styleGate = await installMutationGate(page, "/api/v1/image-styles/*/versions/*/publish");
  const publishStyle = page.getByRole("button", { name: "Publish style v1" });
  await publishStyle.click();
  await expect(publishStyle).toBeDisabled();
  await expect(publishStyle).toHaveAttribute("aria-busy", "true");
  await expect.poll(styleGate.postCount).toBe(1);
  await publishStyle.evaluate((button: HTMLButtonElement) => button.click());
  expect(styleGate.postCount()).toBe(1);
  styleGate.release();

  const styleResponse = await styleGate.response;
  expect(styleResponse.status).toBe(201);
  const createdStyle = styleResponse.body as CreatedStyleResponse;
  expect(createdStyle).toMatchObject({
    name: styleName,
    version_id: expect.stringMatching(/^image_style_version_/u),
    state: "PUBLISHED",
    provider_calls_authorized: false,
    original_bytes_persisted: false,
    normalized_bytes_persisted: true,
  });
  await expect(page).toHaveURL(/\/projects\/new\?fixture=project_create_ready$/u);
  const afterStyle = await readDraft(page);
  expect(afterStyle.imageStyleVersionId).toBe(createdStyle.version_id);
  expect({ ...afterStyle, imageStyleVersionId: afterAvatar.imageStyleVersionId }).toEqual(
    afterAvatar,
  );
  await expect(page.locator("summary.visual-preset-summary").nth(1)).toContainText(styleName);
  const styleCatalog = await page.evaluate(async () => {
    const response = await fetch("/api/v1/image-styles?fixture=project_create_ready");
    if (!response.ok) throw new Error(`Image Style catalog returned ${response.status}`);
    return (await response.json()) as Array<{ name: string; versionId: string }>;
  });
  expect(styleCatalog).toContainEqual(
    expect.objectContaining({ name: styleName, versionId: createdStyle.version_id }),
  );
  expect(styleMutationCount).toBe(5);

  await page.goto("/styles?fixture=project_create_ready");
  await page.getByPlaceholder("Search styles").fill(styleName);
  const createdCard = page.locator("article.style-card").filter({ hasText: styleName });
  await expect(createdCard).toHaveCount(1);
  await createdCard.getByRole("button", { name: /References \(3\)/u }).click();
  await expect(page.getByRole("dialog")).toContainText("Edited natural window light");
  const retainedReferences = page.getByRole("dialog").getByRole("img");
  await expect(retainedReferences).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect
      .poll(() =>
        retainedReferences
          .nth(index)
          .evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0)),
      )
      .toBe(640);
  }
  await page.getByRole("button", { name: "Archive style" }).click();
  await expect(createdCard.getByText("ARCHIVED")).toBeVisible();

  await page.goto("/projects/new?fixture=project_create_ready");
  await page.locator("summary.visual-preset-summary").nth(1).click();
  await expect(page.getByRole("radio", { name: new RegExp(styleName, "u") })).toHaveCount(0);
});
