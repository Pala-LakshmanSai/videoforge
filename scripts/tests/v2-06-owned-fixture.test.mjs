import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  EXPECTED_SOURCE_SHA256,
  parseManifestRow,
  pngDimensions,
  stripPngMetadata,
} from "../../deploy/v2-06/provision-owned-fixture.mjs";

const SCRIPT = "deploy/v2-06/provision-owned-fixture.mjs";

test("owned fixture manifest is pinned to the repository-authored source", () => {
  const row = parseManifestRow(
    `path,sha256,origin,rights_status,purpose\n../apps/web/public/fixtures/avatar/amish-farm-host.svg,${EXPECTED_SOURCE_SHA256},repository_source_authored_svg,owned_synthetic_fixture,Reusable Avatar Hub thumbnail`,
  );
  assert.equal(row.sha256, EXPECTED_SOURCE_SHA256);
  assert.equal(row.rightsBasis, "owned_synthetic_fixture");
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
