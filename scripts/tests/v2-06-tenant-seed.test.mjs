import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  DEFAULT_AVATAR_PAYLOAD,
  DEFAULT_STYLE_PAYLOAD,
  buildPlan,
  mutationSql,
  sha256Canonical,
  validateAvatarEnvelope,
  validateStylePayload,
} from "../../deploy/v2-06/seed-tenant-presets.mjs";
import { readFile } from "node:fs/promises";

const SCRIPT = "deploy/v2-06/seed-tenant-presets.mjs";
const SCOPE = {
  user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const ASSET = {
  ORIGINAL: {
    role: "ORIGINAL",
    asset_id: "11111111-1111-4111-8111-111111111111",
    account_id: SCOPE.account_id,
    workspace_id: SCOPE.workspace_id,
    kind: "AVATAR_ORIGINAL",
    state: "VERIFIED",
    binary_sha256: `sha256:${"1".repeat(64)}`,
    content_type: "image/png",
    byte_size: 2_457_600,
    width_px: 1536,
    height_px: 1536,
  },
  RUNTIME: {
    role: "RUNTIME",
    asset_id: "22222222-2222-4222-8222-222222222222",
    account_id: SCOPE.account_id,
    workspace_id: SCOPE.workspace_id,
    kind: "AVATAR_RUNTIME",
    state: "VERIFIED",
    binary_sha256: `sha256:${"2".repeat(64)}`,
    content_type: "video/mp4",
    byte_size: 4_000_000,
    width_px: 1920,
    height_px: 1080,
  },
  THUMBNAIL: {
    role: "THUMBNAIL",
    asset_id: "33333333-3333-4333-8333-333333333333",
    account_id: SCOPE.account_id,
    workspace_id: SCOPE.workspace_id,
    kind: "AVATAR_THUMBNAIL",
    state: "VERIFIED",
    binary_sha256: `sha256:${"3".repeat(64)}`,
    content_type: "image/jpeg",
    byte_size: 512_000,
    width_px: 1024,
    height_px: 1024,
  },
};

async function fixture(name) {
  return JSON.parse(await readFile(name, "utf8"));
}

test("V2-06 seed payload fixtures remain strict and hashable", async () => {
  const avatar = validateAvatarEnvelope(await fixture(DEFAULT_AVATAR_PAYLOAD));
  const style = validateStylePayload(await fixture(DEFAULT_STYLE_PAYLOAD));
  assert.equal(avatar.schema_version, "avatar-profile-version/v1");
  assert.equal(style.schema_version, "image-style-profile/v1");
  assert.equal(
    sha256Canonical(style),
    `sha256:${"e344d37b9a04604891334cdd2b60601619885a4a16acad8eb15957340a90e430"}`,
  );
});

test("seed plan derives stable tenant-private IDs and binds all three verified assets", async () => {
  const plan = buildPlan({
    scope: SCOPE,
    assets: Object.values(ASSET),
    avatarEnvelope: await fixture(DEFAULT_AVATAR_PAYLOAD),
    stylePayload: await fixture(DEFAULT_STYLE_PAYLOAD),
    seedAt: "2026-08-17T12:00:00Z",
    rightsBasis: "OWNED",
    avatarName: "Activation Presenter",
    styleName: "Authentic Documentary Stock",
  });
  assert.match(plan.avatarProfileId, /^[0-9a-f-]{36}$/u);
  assert.match(plan.avatarVersionId, /^[0-9a-f-]{36}$/u);
  assert.match(plan.styleVersionId, /^[0-9a-f-]{36}$/u);
  assert.equal(plan.avatarPayload.source_asset_id, ASSET.ORIGINAL.asset_id);
  assert.equal(plan.avatarPayload.runtime_source_asset_id, ASSET.RUNTIME.asset_id);
  assert.equal(plan.avatarPayload.thumbnail_asset_id, ASSET.THUMBNAIL.asset_id);
  assert.equal(plan.avatarPayload.framing_confirmation.confirmed_by_user_id, SCOPE.user_id);
  assert.equal(plan.avatarPayload.rights_attested_by_user_id, SCOPE.user_id);
  assert.equal(plan.avatarProfileHash, sha256Canonical(plan.avatarPayload));
  assert.equal(
    plan.styleProfileHash,
    `sha256:${"e344d37b9a04604891334cdd2b60601619885a4a16acad8eb15957340a90e430"}`,
  );
});

test("mutation SQL is transactional, idempotent, tenant-bound, and has no delete/provider path", () => {
  const source = mutationSql({
    scope: SCOPE,
    assets: { original: ASSET.ORIGINAL, runtime: ASSET.RUNTIME, thumbnail: ASSET.THUMBNAIL },
    avatarPayload: {},
    stylePayload: {},
    avatarProfileHash: `sha256:${"a".repeat(64)}`,
    styleProfileHash: `sha256:${"b".repeat(64)}`,
    avatarProfileId: "44444444-4444-4444-8444-444444444444",
    avatarVersionId: "55555555-5555-4555-8555-555555555555",
    styleId: "66666666-6666-4666-8666-666666666666",
    styleVersionId: "77777777-7777-4777-8777-777777777777",
    avatarAssetLinkIds: {
      ORIGINAL: "88888888-8888-4888-8888-888888888888",
      RUNTIME: "99999999-9999-4999-8999-999999999999",
      THUMBNAIL: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    },
    seedAt: "2026-08-17T12:00:00Z",
    rightsBasis: "OWNED",
    avatarName: "Activation Presenter",
    styleName: "Authentic Documentary Stock",
  });
  assert.match(source, /BEGIN;/u);
  assert.match(source, /COMMIT;/u);
  assert.match(source, /migration head 35/u);
  assert.match(source, /SET LOCAL videoforge\.account_id/u);
  assert.match(source, /ON CONFLICT \(id\) DO NOTHING/u);
  assert.doesNotMatch(source, /\b(?:DROP|DELETE)\s+/iu);
  assert.doesNotMatch(source, /runpod|run\.googleapis|cloudrun|gpu/iu);
  assert.match(source, /all three avatar assets must already be tenant-owned VERIFIED bytes/u);
  assert.match(source, /existing deterministic avatar version is not an exact immutable match/u);
  assert.match(source, /existing deterministic style version is not an exact immutable match/u);
});

test("CLI dry-run validates without a database or mutation confirmation", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      V2_06_TENANT_EMAIL: "owner@example.test",
      V2_06_SEED_AT: "2026-08-17T12:00:00Z",
      V2_06_AVATAR_RIGHTS_BASIS: "OWNED",
      V2_06_AVATAR_ORIGINAL_ASSET_ID: ASSET.ORIGINAL.asset_id,
      V2_06_AVATAR_RUNTIME_ASSET_ID: ASSET.RUNTIME.asset_id,
      V2_06_AVATAR_THUMBNAIL_ASSET_ID: ASSET.THUMBNAIL.asset_id,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /database_mutation=SKIPPED_DRY_RUN/u);
  assert.doesNotMatch(result.stdout, /DATABASE_URL|password|secret|token/iu);
});

test("CLI refuses mutation before opening a database without both confirmations", () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      V2_06_TENANT_EMAIL: "owner@example.test",
      V2_06_SEED_AT: "2026-08-17T12:00:00Z",
      V2_06_AVATAR_RIGHTS_BASIS: "OWNED",
      V2_06_AVATAR_ORIGINAL_ASSET_ID: ASSET.ORIGINAL.asset_id,
      V2_06_AVATAR_RUNTIME_ASSET_ID: ASSET.RUNTIME.asset_id,
      V2_06_AVATAR_THUMBNAIL_ASSET_ID: ASSET.THUMBNAIL.asset_id,
      V2_06_MIGRATION_DATABASE_URL: "postgresql://migration-owner:example@127.0.0.1/neondb",
      V2_06_SEED_CONFIRM: "NO",
      V2_06_AVATAR_RIGHTS_CONFIRM: "NO",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing database mutation without V2_06_SEED_CONFIRM=YES/u);
});
