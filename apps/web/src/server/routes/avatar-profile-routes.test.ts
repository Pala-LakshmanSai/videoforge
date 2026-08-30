// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../app";
import { MemorySharedAppPersistence, type SharedAppPersistence } from "../shared-app-persistence";
import { createNodeSharedAppPersistence } from "../runtime/node-shared-app-persistence";

const fixturePreview = { read: async () => "<svg>fixture preview</svg>" };
const ownedDirectories: string[] = [];

afterEach(() => {
  for (const directory of ownedDirectories.splice(0)) rmSync(directory, { recursive: true });
});

function png(width = 640, height = 640): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}

function checksum(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function metadata(bytes = png()) {
  return {
    name: "Owned presenter",
    thumbnail_url: "/fixtures/avatar/amish-farm-host.svg",
    source_dimensions: { width: 640, height: 640 },
    preparation_profile: "fixture-browser-decode-v1",
    validation_profile: "fixture-manual-framing-v1",
    compatibility: "UNTESTED",
    lifecycle: "ACTIVE",
    version_state: "READY",
    uploaded_bytes_persisted: true,
    source: {
      filename: "owned-presenter.png",
      media_type: "image/png",
      checksum: checksum(bytes),
      bytes_base64: Buffer.from(bytes).toString("base64"),
    },
    attestations: { image_use_rights: true, likeness_animation_consent: true },
  };
}

function headers(session: string, key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": key,
    "x-videoforge-fixture-session": session,
    "x-videoforge-fixture-control": "v2-provider-free-fixture-v1",
  };
}

function createFixtureApp(
  sessionPersistence: SharedAppPersistence = new MemorySharedAppPersistence(),
) {
  return createApiApp({
    configuration: { commit: "avatar-source-test", environment: "test", mode: "fixture" },
    bindings: {
      platform: "node",
      fixturePreview,
      fixtureSessionPersistence: sessionPersistence,
    },
  });
}

describe("fixture Avatar Profile source storage", () => {
  it("retains exact bytes, serves a private preview, survives restart, and stays session isolated", async () => {
    const persistence = new MemorySharedAppPersistence();
    const first = createFixtureApp(persistence);
    const sourceBytes = png();
    const created = await first.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headers("avatar-source-a", "create-a"),
      body: JSON.stringify(metadata(sourceBytes)),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      avatarProfile: {
        id: string;
        versionId: string;
        thumbnailUrl: string;
        warning: string | null;
      };
      uploadedBytesPersisted: boolean;
      providerCallsAuthorized: boolean;
    };
    expect(body).toMatchObject({
      uploadedBytesPersisted: true,
      providerCallsAuthorized: false,
      avatarProfile: {
        warning: null,
        thumbnailUrl: expect.stringMatching(
          /^\/api\/v1\/avatar-profiles\/avatar_profile_fixture_created_001\/versions\/avatar_profile_version_fixture_created_001\/preview$/u,
        ),
      },
    });
    expect(JSON.stringify(body)).not.toContain("bytes_base64");

    const path = `${body.avatarProfile.thumbnailUrl}?fixture=avatar_hub_empty`;
    const preview = await first.request(path, {
      headers: { "x-videoforge-fixture-session": "avatar-source-a" },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("etag")).toBe(`"${checksum(sourceBytes)}"`);
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(sourceBytes);

    const catalog = await first.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      headers: { "x-videoforge-fixture-session": "avatar-source-a" },
    });
    const catalogText = await catalog.text();
    expect(catalogText).not.toContain("bytes_base64");
    expect(catalogText).toContain(body.avatarProfile.thumbnailUrl);

    const isolated = await first.request(path, {
      headers: { "x-videoforge-fixture-session": "avatar-source-b" },
    });
    expect(isolated.status).toBe(404);

    const restored = createFixtureApp(persistence);
    const restoredCatalog = await restored.request(
      "/api/v1/avatar-profiles?fixture=avatar_hub_empty",
      { headers: { "x-videoforge-fixture-session": "avatar-source-a" } },
    );
    await expect(restoredCatalog.json()).resolves.toEqual([
      expect.objectContaining({ thumbnailUrl: body.avatarProfile.thumbnailUrl }),
    ]);
    const restoredPreview = await restored.request(path, {
      headers: { "x-videoforge-fixture-session": "avatar-source-a" },
    });
    expect(new Uint8Array(await restoredPreview.arrayBuffer())).toEqual(sourceBytes);
  });

  it("uses mode-0600 Node storage for restart-durable avatar bytes", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "videoforge-avatar-source-"));
    ownedDirectories.push(directory);
    const filePath = path.join(directory, "fixture-avatar-sessions.json");
    const persistence = createNodeSharedAppPersistence(filePath);
    const first = createFixtureApp(persistence);
    const sourceBytes = png();
    const created = await first.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headers("avatar-source-file", "create-file"),
      body: JSON.stringify(metadata(sourceBytes)),
    });
    expect(created.status).toBe(201);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    const persistedText = readFileSync(filePath, "utf8");
    expect(persistedText).toContain("avatar-source-file");
    expect(persistedText).toContain(Buffer.from(sourceBytes).toString("base64"));

    const body = (await created.json()) as { avatarProfile: { thumbnailUrl: string } };
    const restored = createFixtureApp(createNodeSharedAppPersistence(filePath));
    const preview = await restored.request(
      `${body.avatarProfile.thumbnailUrl}?fixture=avatar_hub_empty`,
      { headers: { "x-videoforge-fixture-session": "avatar-source-file" } },
    );
    expect(preview.status).toBe(200);
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(sourceBytes);
  });

  it("fails closed when persisted bytes no longer match their immutable checksum", async () => {
    const persistence = new MemorySharedAppPersistence();
    const first = createFixtureApp(persistence);
    const created = await first.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headers("avatar-source-corrupt", "create-corrupt"),
      body: JSON.stringify(metadata()),
    });
    const body = (await created.json()) as { avatarProfile: { thumbnailUrl: string } };
    const snapshot = JSON.parse(persistence.read()!) as {
      sessions: Array<{ avatarSources: Array<{ bytesBase64: string }> }>;
    };
    const corrupted = Buffer.from(snapshot.sessions[0]!.avatarSources[0]!.bytesBase64, "base64");
    const finalByte = corrupted.length - 1;
    corrupted[finalByte] = (corrupted[finalByte] ?? 0) ^ 1;
    snapshot.sessions[0]!.avatarSources[0]!.bytesBase64 = corrupted.toString("base64");
    persistence.write(JSON.stringify(snapshot));

    const restored = createFixtureApp(persistence);
    const preview = await restored.request(
      `${body.avatarProfile.thumbnailUrl}?fixture=avatar_hub_empty`,
      { headers: { "x-videoforge-fixture-session": "avatar-source-corrupt" } },
    );
    expect(preview.status).toBe(500);
    await expect(preview.json()).resolves.toMatchObject({
      error: { code: "AVATAR_PROFILE_SOURCE_CORRUPT" },
    });
  });

  it("clears one session and clears all sessions through the explicit global reset", async () => {
    const persistence = new MemorySharedAppPersistence();
    const server = createFixtureApp(persistence);
    const first = await server.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headers("avatar-source-reset-a", "create-a"),
      body: JSON.stringify(metadata()),
    });
    const firstBody = (await first.json()) as { avatarProfile: { thumbnailUrl: string } };
    const second = await server.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headers("avatar-source-reset-b", "create-b"),
      body: JSON.stringify({ ...metadata(), name: "Second presenter" }),
    });
    const secondBody = (await second.json()) as { avatarProfile: { thumbnailUrl: string } };

    const reset = await server.request("/api/dev/fixture-session/reset", {
      method: "POST",
      headers: { "x-videoforge-fixture-session": "avatar-source-reset-a" },
    });
    expect(reset.status).toBe(200);
    const resetPreview = await server.request(
      `${firstBody.avatarProfile.thumbnailUrl}?fixture=avatar_hub_empty`,
      { headers: { "x-videoforge-fixture-session": "avatar-source-reset-a" } },
    );
    expect(resetPreview.status).toBe(404);
    const remaining = await server.request(
      `${secondBody.avatarProfile.thumbnailUrl}?fixture=avatar_hub_empty`,
      { headers: { "x-videoforge-fixture-session": "avatar-source-reset-b" } },
    );
    expect(remaining.status).toBe(200);

    const globalReset = await server.request("/api/dev/shared-app/reset", {
      method: "POST",
      headers: { "x-videoforge-fixture-control": "v2-provider-free-fixture-v1" },
    });
    expect(globalReset.status).toBe(200);
    const afterGlobalReset = await server.request(
      `${secondBody.avatarProfile.thumbnailUrl}?fixture=avatar_hub_empty`,
      { headers: { "x-videoforge-fixture-session": "avatar-source-reset-b" } },
    );
    expect(afterGlobalReset.status).toBe(404);

    const restored = createFixtureApp(persistence);
    const restoredCatalog = await restored.request(
      "/api/v1/avatar-profiles?fixture=avatar_hub_empty",
      { headers: { "x-videoforge-fixture-session": "avatar-source-reset-b" } },
    );
    await expect(restoredCatalog.json()).resolves.toEqual([]);
  });

  it("rejects invalid source bytes before retaining a profile", async () => {
    const server = createFixtureApp();
    const sourceBytes = png();
    const invalid = metadata(sourceBytes);
    invalid.source.bytes_base64 = Buffer.from("not an image").toString("base64");
    const response = await server.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headers("avatar-source-invalid", "invalid"),
      body: JSON.stringify(invalid),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_AVATAR_PROFILE_SOURCE" },
    });
    const catalog = await server.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty");
    await expect(catalog.json()).resolves.toEqual([]);
  });
});
