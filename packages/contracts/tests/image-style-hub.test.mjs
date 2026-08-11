import assert from "node:assert/strict";
import test from "node:test";

import {
  imageStyleDraftCreateRequestSchema,
  imageStyleHubVersionResponseSchema,
  imageStyleReferenceBatchRequestSchema,
} from "../dist/src/image-style-hub.js";

const digest = `sha256:${"a".repeat(64)}`;

function reference(index) {
  return {
    client_reference_id: `reference_${index}`,
    filename: `owned-${index}.png`,
    order_index: index,
    original: {
      media_type: "image/png",
      checksum: digest,
      width: 640,
      height: 480,
      bytes_base64: "AAAA",
    },
    normalized: {
      media_type: "image/webp",
      checksum: digest,
      width: 640,
      height: 480,
      bytes_base64: "AAAA",
      color_space: "srgb",
      metadata_stripped: true,
      orientation_applied: true,
    },
  };
}

test("Image Style Hub accepts only versioned strict draft and reference inputs", () => {
  assert.equal(
    imageStyleDraftCreateRequestSchema.safeParse({
      schema_version: "image-style-draft-create/v1",
      name: "Owned field style",
    }).success,
    true,
  );
  const batch = {
    schema_version: "image-style-reference-batch/v1",
    rights: {
      reference_rights_attested: true,
      processing_disclosure_acknowledged: true,
      retention_choice: "NORMALIZED_SESSION_ONLY",
    },
    references: [reference(0), reference(1), reference(2)],
  };
  assert.equal(imageStyleReferenceBatchRequestSchema.safeParse(batch).success, true);
  assert.equal(
    imageStyleReferenceBatchRequestSchema.safeParse({
      ...batch,
      references: [reference(0), reference(0), reference(2)],
    }).success,
    false,
  );
  assert.equal(
    imageStyleReferenceBatchRequestSchema.safeParse({ ...batch, provider_token: "forged" }).success,
    false,
  );
});

test("Image Style Hub response pins state, ETag authority, retention, and zero-provider truth", () => {
  const response = {
    schema_version: "image-style-hub-version/v1",
    style_id: "style_a",
    version_id: "version_a",
    name: "Owned field style",
    state: "REFERENCES_READY",
    revision: 2,
    version_tag: `"vf-style-r2-sha256-${"a".repeat(64)}"`,
    references: [
      {
        reference_id: "reference_001",
        filename: "owned.png",
        order_index: 0,
        original_checksum: digest,
        normalized_checksum: digest,
        width: 640,
        height: 480,
        preview_url:
          "/api/v1/image-styles/style_a/versions/version_a/references/reference_001/preview",
      },
    ],
    profile: null,
    profile_hash: null,
    original_bytes_persisted: false,
    normalized_bytes_persisted: true,
    provider_calls_authorized: false,
  };
  assert.equal(imageStyleHubVersionResponseSchema.safeParse(response).success, true);
  assert.equal(
    imageStyleHubVersionResponseSchema.safeParse({ ...response, provider_calls_authorized: true })
      .success,
    false,
  );
});
