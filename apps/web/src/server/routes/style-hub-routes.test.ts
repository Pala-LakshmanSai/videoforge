import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createApiApp } from "../app";

const fixturePreview = { read: async () => "<svg>fixture preview</svg>" };

function app() {
  return createApiApp({
    configuration: { commit: "style-hub-test", environment: "test", mode: "fixture" },
    bindings: { platform: "node", fixturePreview },
  });
}

function sha(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function png(width = 640, height = 480): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}

function webp(width = 640, height = 480): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([...Buffer.from("RIFF")], 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set([...Buffer.from("WEBPVP8X")], 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 255, (w >>> 8) & 255, (w >>> 16) & 255], 24);
  bytes.set([h & 255, (h >>> 8) & 255, (h >>> 16) & 255], 27);
  return bytes;
}

function reference(index: number, corruptChecksum = false) {
  const original = png();
  const normalized = webp();
  return {
    client_reference_id: `client_ref_${index}`,
    filename: `owned-${index}.png`,
    order_index: index,
    original: {
      media_type: "image/png",
      checksum: corruptChecksum ? `sha256:${"f".repeat(64)}` : sha(original),
      width: 640,
      height: 480,
      bytes_base64: Buffer.from(original).toString("base64"),
    },
    normalized: {
      media_type: "image/webp",
      checksum: sha(normalized),
      width: 640,
      height: 480,
      bytes_base64: Buffer.from(normalized).toString("base64"),
      color_space: "srgb",
      metadata_stripped: true,
      orientation_applied: true,
    },
  };
}

function headers(key: string, ifMatch?: string, session = "style-hub-a") {
  return {
    "content-type": "application/json",
    "idempotency-key": key,
    "x-videoforge-fixture-session": session,
    ...(ifMatch ? { "if-match": ifMatch } : {}),
  };
}

describe("fixture Image Styles Hub lifecycle", () => {
  it("normalizes authority through draft, reference, analysis, edit, publication, selection, and preview", async () => {
    const server = app();
    const created = await server.request(
      "/api/v1/image-style-drafts?fixture=project_create_ready",
      {
        method: "POST",
        headers: headers("create"),
        body: JSON.stringify({
          schema_version: "image-style-draft-create/v1",
          name: "Owned field style",
        }),
      },
    );
    expect(created.status).toBe(201);
    const draft = (await created.json()) as Record<string, any>;
    expect(draft).toMatchObject({ state: "DRAFT", revision: 1, provider_calls_authorized: false });

    const route = `/api/v1/image-styles/${draft.style_id}/versions/${draft.version_id}`;
    const attached = await server.request(`${route}/references?fixture=project_create_ready`, {
      method: "POST",
      headers: headers("references", draft.version_tag),
      body: JSON.stringify({
        schema_version: "image-style-reference-batch/v1",
        rights: {
          reference_rights_attested: true,
          processing_disclosure_acknowledged: true,
          retention_choice: "NORMALIZED_SESSION_ONLY",
        },
        references: [reference(0), reference(1), reference(2)],
      }),
    });
    expect(attached.status).toBe(200);
    const referenced = (await attached.json()) as Record<string, any>;
    expect(referenced).toMatchObject({
      state: "REFERENCES_READY",
      revision: 2,
      original_bytes_persisted: false,
      normalized_bytes_persisted: true,
    });

    const stale = await server.request(`${route}/analyze?fixture=project_create_ready`, {
      method: "POST",
      headers: headers("stale", draft.version_tag),
      body: JSON.stringify({ schema_version: "image-style-analysis-request/v1" }),
    });
    expect(stale.status).toBe(412);

    const analyzed = await server.request(`${route}/analyze?fixture=project_create_ready`, {
      method: "POST",
      headers: headers("analyze", referenced.version_tag),
      body: JSON.stringify({ schema_version: "image-style-analysis-request/v1" }),
    });
    expect(analyzed.status).toBe(200);
    const review = (await analyzed.json()) as Record<string, any>;
    expect(review).toMatchObject({
      state: "NEEDS_REVIEW",
      revision: 3,
      profile: { schema_version: "image-style-profile/v1" },
    });

    const candidate = structuredClone(review.profile);
    candidate.visual_profile.lighting = "Edited natural window light";
    const edited = await server.request(`${route}?fixture=project_create_ready`, {
      method: "PATCH",
      headers: headers("edit", review.version_tag),
      body: JSON.stringify({
        schema_version: "image-style-edit-request/v1",
        candidate_profile: candidate,
      }),
    });
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as Record<string, any>;
    expect(editedBody).toMatchObject({
      revision: 4,
      profile: { visual_profile: { lighting: "Edited natural window light" } },
    });

    const published = await server.request(`${route}/publish?fixture=project_create_ready`, {
      method: "POST",
      headers: headers("publish", editedBody.version_tag),
      body: JSON.stringify({ schema_version: "image-style-publish-request/v1" }),
    });
    expect(published.status).toBe(201);
    const publication = (await published.json()) as Record<string, any>;
    expect(publication).toMatchObject({
      state: "PUBLISHED",
      version_id: draft.version_id,
      provider_calls_authorized: false,
    });

    const replay = await server.request(`${route}/publish?fixture=project_create_ready`, {
      method: "POST",
      headers: headers("publish", editedBody.version_tag),
      body: JSON.stringify({ schema_version: "image-style-publish-request/v1" }),
    });
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");

    const [catalog, preview, isolated] = await Promise.all([
      server.request("/api/v1/image-styles?fixture=project_create_ready", {
        headers: headers("unused"),
      }),
      server.request(`${publication.references[0].preview_url}?fixture=project_create_ready`, {
        headers: { "x-videoforge-fixture-session": "style-hub-a" },
      }),
      server.request(`${route}?fixture=project_create_ready`, {
        headers: { "x-videoforge-fixture-session": "style-hub-b" },
      }),
    ]);
    expect(await catalog.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionId: draft.version_id, status: "PUBLISHED" }),
      ]),
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/webp");
    expect(isolated.status).toBe(404);
  });

  it("rejects checksum drift before retaining any normalized reference", async () => {
    const server = app();
    const created = await server.request(
      "/api/v1/image-style-drafts?fixture=project_create_ready",
      {
        method: "POST",
        headers: headers("bad-create"),
        body: JSON.stringify({
          schema_version: "image-style-draft-create/v1",
          name: "Rejected refs",
        }),
      },
    );
    const draft = (await created.json()) as Record<string, any>;
    const response = await server.request(
      `/api/v1/image-styles/${draft.style_id}/versions/${draft.version_id}/references?fixture=project_create_ready`,
      {
        method: "POST",
        headers: headers("bad-refs", draft.version_tag),
        body: JSON.stringify({
          schema_version: "image-style-reference-batch/v1",
          rights: {
            reference_rights_attested: true,
            processing_disclosure_acknowledged: true,
            retention_choice: "NORMALIZED_SESSION_ONLY",
          },
          references: [reference(0, true), reference(1), reference(2)],
        }),
      },
    );
    expect(response.status).toBe(422);
    const current = await server.request(
      `/api/v1/image-styles/${draft.style_id}/versions/${draft.version_id}?fixture=project_create_ready`,
      { headers: { "x-videoforge-fixture-session": "style-hub-a" } },
    );
    await expect(current.json()).resolves.toMatchObject({ state: "DRAFT", references: [] });
  });
});
