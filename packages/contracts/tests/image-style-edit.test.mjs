import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IMAGE_STYLE_EDIT_REQUEST_VERSION,
  IMAGE_STYLE_EDIT_RESPONSE_VERSION,
  formatImageStyleEditVersionTag,
  imageStyleEditProblemSchema,
  imageStyleEditRequestSchema,
  imageStyleEditResponseSchema,
  parseImageStyleEditVersionTag,
} from "../dist/src/image-style-edit.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(
  await readFile(path.join(packageRoot, "generated/fixtures/default_image_style_v1.json"), "utf8"),
);
const digest = `sha256:${"a".repeat(64)}`;

test("Image Style edit request accepts only one complete versioned candidate", () => {
  assert.equal(
    imageStyleEditRequestSchema.safeParse({
      schema_version: IMAGE_STYLE_EDIT_REQUEST_VERSION,
      candidate_profile: profile,
    }).success,
    true,
  );
  assert.equal(
    imageStyleEditRequestSchema.safeParse({
      schema_version: IMAGE_STYLE_EDIT_REQUEST_VERSION,
      candidate_profile: { schema_version: "image-style-profile/v1", summary: "partial" },
    }).success,
    false,
  );
  assert.equal(
    imageStyleEditRequestSchema.safeParse({
      schema_version: IMAGE_STYLE_EDIT_REQUEST_VERSION,
      candidate_profile: profile,
      actor_user_id: "forged-user",
    }).success,
    false,
  );
});

test("Image Style edit response pins exact immutable lineage and one revision", () => {
  const result = imageStyleEditResponseSchema.parse({
    schema_version: IMAGE_STYLE_EDIT_RESPONSE_VERSION,
    edit: {
      style_id: "style_a",
      version_id: "version_a",
      edit_id: "edit_a",
      root_source_artifact_id: "root_a",
      root_source_artifact_hash: digest,
      parent_artifact_id: "parent_a",
      parent_artifact_hash: digest,
      current_artifact_id: "derived_a",
      current_artifact_hash: digest,
      changed_pointers: ["/summary"],
      prior_revision: 1,
      result_revision: 2,
      invalidated_review_snapshot_id: "review_a",
      edited_at: "2026-08-11T08:00:00.000Z",
      replayed: false,
    },
  });
  assert.equal(result.edit.result_revision, 2);
  assert.equal(
    imageStyleEditResponseSchema.safeParse({
      ...result,
      edit: { ...result.edit, result_revision: 3 },
    }).success,
    false,
  );
});

test("Image Style version tags round-trip exact revision and artifact hash", () => {
  const authority = { revision: 7, currentArtifactHash: digest };
  const tag = formatImageStyleEditVersionTag(authority);
  assert.equal(tag, `"vf-style-r7-sha256-${"a".repeat(64)}"`);
  assert.deepEqual(parseImageStyleEditVersionTag(tag), authority);
  assert.equal(parseImageStyleEditVersionTag("*"), null);
  assert.equal(parseImageStyleEditVersionTag(`${tag}, ${tag}`), null);
});

test("Image Style problem contract rejects unknown codes and extra fields", () => {
  const body = {
    error: {
      code: "STYLE_VERSION_CONFLICT",
      message: "Image Style version authority is stale",
      detail: "Revision does not match.",
      retryable: false,
    },
    type: "https://videoforge.local/problems/style-version-conflict",
    title: "Image Style version authority is stale",
    status: 412,
  };
  assert.equal(imageStyleEditProblemSchema.safeParse(body).success, true);
  assert.equal(
    imageStyleEditProblemSchema.safeParse({ ...body, workspace_id: "forged" }).success,
    false,
  );
});
