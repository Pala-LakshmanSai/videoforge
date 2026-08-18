import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  APPROVED_CLOUDFLARE_ACCOUNT_ID,
  APPROVED_NEON_HOST,
  APPROVED_R2_BUCKET,
  APPROVED_R2_REGION,
  EXPECTED_SOURCE_SHA256,
  assertMigrationUrl,
  assertR2Config,
  buildAssets,
  buildOrphanInventory,
  parseManifestRow,
  pngDimensions,
  requireUuid,
  r2ObjectUrl,
  r2Request,
  stripPngMetadata,
} from "../../deploy/v2-06/provision-owned-fixture.mjs";

const SCRIPT = "deploy/v2-06/provision-owned-fixture.mjs";

test("owned fixture manifest is pinned to the repository-authored source", () => {
  const row = parseManifestRow(
    `path,sha256,origin,rights_status,purpose\n../apps/web/public/fixtures/avatar/amish-farm-host.svg,${EXPECTED_SOURCE_SHA256},repository_source_authored_svg,owned_synthetic_fixture,Reusable Avatar Hub thumbnail`,
  );
  assert.equal(row.sha256, EXPECTED_SOURCE_SHA256);
  assert.equal(row.rightsBasis, "owned_synthetic_fixture");
  assert.equal(row.purpose, "Reusable Avatar Hub thumbnail");
});

test("owned fixture accepts canonical PostgreSQL UUIDs without RFC-4122 variant bits", () => {
  assert.doesNotThrow(() => requireUuid("deadbeef-dead-0eef-0eef-deadbeefdead", "database id"));
  assert.throws(() => requireUuid("not-a-uuid", "database id"), /canonical UUID/u);
});

test("owned assets use canonical tenant-private Avatar Hub keys and stable orphan inventory", () => {
  const scope = {
    account_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
  };
  const files = {
    ORIGINAL: {
      kind: "AVATAR_ORIGINAL",
      contentType: "image/png",
      bytes: Buffer.from("original"),
      width: 1536,
      height: 1536,
      durationMs: null,
      extension: "png",
    },
    RUNTIME: {
      kind: "AVATAR_RUNTIME",
      contentType: "video/mp4",
      bytes: Buffer.from("runtime"),
      width: 832,
      height: 480,
      durationMs: 1000,
      extension: "mp4",
      runtimeFrameSha256: "sha256:" + "a".repeat(64),
      toolchain: {
        ffmpeg_version: "8.1.1",
        ffmpeg_sha256: "sha256:" + "b".repeat(64),
        ffprobe_version: "8.1.1",
        ffprobe_sha256: "sha256:" + "c".repeat(64),
      },
    },
    THUMBNAIL: {
      kind: "AVATAR_THUMBNAIL",
      contentType: "image/png",
      bytes: Buffer.from("thumbnail"),
      width: 512,
      height: 512,
      durationMs: null,
      extension: "png",
    },
  };
  const assets = buildAssets({
    scope,
    files,
    sourceManifest: {
      sha256: EXPECTED_SOURCE_SHA256,
      sourceKind: "repository_source_authored_svg",
      rightsBasis: "owned_synthetic_fixture",
      purpose: "Reusable Avatar Hub thumbnail",
    },
  });
  for (const role of ["ORIGINAL", "RUNTIME", "THUMBNAIL"]) {
    assert.match(
      assets[role].objectKey,
      /^tenant\/[^/]+\/workspace\/[^/]+\/avatar-profile\/[^/]+\/version\/[^/]+\/(?:original|canonical|thumbnail)\/[^/]+$/u,
    );
    assert.doesNotMatch(assets[role].objectKey, /project|fixture/u);
  }
  assert.equal(assets.RUNTIME.storageRole, "canonical");
  const first = buildOrphanInventory(scope, assets);
  const second = buildOrphanInventory(scope, assets);
  assert.deepEqual(first, second);
  assert.equal(first.automatic_delete, false);
});

test("PNG metadata stripping keeps only canonical image chunks", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, payload) => {
    const body = Buffer.from(payload);
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    body.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(512, 0);
  ihdr.writeUInt32BE(512, 4);
  const png = stripPngMetadata(
    Buffer.concat([signature, chunk("IHDR", ihdr), chunk("tEXt", "fixture"), chunk("IEND", "")]),
  );
  assert.deepEqual(pngDimensions(png), { width: 512, height: 512 });
  assert.equal(png.includes(Buffer.from("tEXt")), false);
});

test("CLI dry-run rasterizes without database, R2, or mutation confirmation", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, V2_06_OWNED_FIXTURE_EMAIL: "lakshmansai121@gmail.com" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIPPED_DRY_RUN/u);
  assert.match(result.stdout, /owned_synthetic_fixture|source_manifest_sha256/u);
  assert.doesNotMatch(result.stdout, /DATABASE_URL|secret_access|password|token/iu);
});

test("CLI refuses partial live confirmations before provider/database access", () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      V2_06_OWNED_FIXTURE_EMAIL: "lakshmansai121@gmail.com",
      V2_06_OWNED_FIXTURE_CONFIRM: "YES",
      V2_06_OWNED_FIXTURE_R2_CONFIRM: "NO",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing R2 mutation/u);
});

test("R2 forwards the complete signed Request for PUT/GET/HEAD", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (request) => {
    seen.push(request);
    return new Response(null, { status: 200 });
  };
  try {
    for (const method of ["PUT", "GET", "HEAD"]) {
      const signed = new Request("https://example.invalid/object", {
        method,
        headers: {
          Authorization: "AWS4-HMAC-SHA256 Credential=test",
          "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
        },
        body: method === "PUT" ? "fixture" : undefined,
      });
      const client = {
        sign: async (_url, init) => {
          assert.equal(init.method, method);
          return signed;
        },
      };
      await r2Request(
        client,
        signed.url,
        method,
        {},
        method === "PUT" ? Buffer.from("fixture") : undefined,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(seen.length, 3);
  for (const request of seen) {
    assert.match(request.headers.get("authorization"), /^AWS4-HMAC-SHA256/u);
    assert.equal(request.headers.get("x-amz-content-sha256"), "UNSIGNED-PAYLOAD");
  }
});

test("wrong R2 and Neon resources fail closed before any request", () => {
  assert.doesNotThrow(() =>
    assertR2Config({
      accountId: APPROVED_CLOUDFLARE_ACCOUNT_ID,
      bucket: APPROVED_R2_BUCKET,
      region: APPROVED_R2_REGION,
      accessKeyId: "redacted",
      secretAccessKey: "redacted",
    }),
  );
  assert.throws(
    () =>
      assertR2Config({
        accountId: "00000000000000000000000000000000",
        bucket: APPROVED_R2_BUCKET,
        region: APPROVED_R2_REGION,
      }),
    /approved V2-06/u,
  );
  assert.throws(
    () => r2ObjectUrl("00000000000000000000000000000000", APPROVED_R2_BUCKET, "object"),
    /approved V2-06/u,
  );
  assert.doesNotThrow(() =>
    assertMigrationUrl(
      `postgresql://neondb_owner:example@${APPROVED_NEON_HOST}/neondb?sslmode=require&channel_binding=require`,
    ),
  );
  assert.throws(
    () =>
      assertMigrationUrl(
        "postgresql://neondb_owner:example@ep-unrelated1234-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      ),
    /approved .*Neon endpoint/u,
  );
});
