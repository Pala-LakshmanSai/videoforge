import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateAnonymousGhcrPublicationProof } from "../../deploy/v2-13/full-live-adapters.mjs";

const TAG = "videoforge-v2-13-release-20260826-v3";
const SOURCE_COMMIT = "4".repeat(40);
const RUN_ID = "12345";
const digest = (character) => `sha256:${character.repeat(64)}`;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);

const state = Object.freeze({
  release_source_commit: SOURCE_COMMIT,
  approved_at: "2026-08-26T11:00:00Z",
  expires_at: "2026-08-26T13:00:00Z",
  release_ref: Object.freeze({ exact_tag_name: TAG }),
});

const expected = Object.freeze({
  workflowName: "mage-image",
  repository: "pala-lakshmansai/videoforge-mage-v2-07",
  digestKey: "manifest_digest",
  configDigestKey: "config_digest",
  layerDigestKey: "layer_digest",
});

function rehash(proof) {
  const unsigned = structuredClone(proof);
  delete unsigned.proof_sha256;
  proof.proof_sha256 = sha256(Buffer.from(canonicalJson(unsigned)));
  return proof;
}

function fixture() {
  const manifestDigest = digest("1");
  const configDigest = digest("2");
  const parentLayerDigest = digest("3");
  const overlayLayerDigest = digest("4");
  const evidence = {
    manifest_digest: manifestDigest,
    config_digest: configDigest,
    layer_digest: overlayLayerDigest,
  };
  const proof = rehash({
    schema_version: "videoforge-anonymous-ghcr-publication-proof/v1",
    registry: "ghcr.io",
    repository: expected.repository,
    authentication: "GHCR_ANONYMOUS_PULL_TOKEN",
    workflow_repository: "Pala-LakshmanSai/videoforge",
    workflow_name: expected.workflowName,
    workflow_ref: `refs/tags/${TAG}`,
    workflow_commit: SOURCE_COMMIT,
    workflow_run_id: RUN_ID,
    registry_observed_at: "Wed, 26 Aug 2026 12:00:00 GMT",
    manifest: {
      digest: manifestDigest,
      header_digest: manifestDigest,
      content_sha256: manifestDigest,
      media_type: "application/vnd.docker.distribution.manifest.v2+json",
      response_content_type: "application/vnd.docker.distribution.manifest.v2+json",
      size_bytes: 528,
      http_status: 200,
    },
    config: {
      kind: "config",
      index: 0,
      digest: configDigest,
      media_type: "application/vnd.docker.container.image.v1+json",
      declared_size_bytes: 512,
      observed_size_bytes: 512,
      content_sha256: configDigest,
      http_status: 200,
      registry_observed_at: "Wed, 26 Aug 2026 12:00:01 GMT",
    },
    layers: [
      {
        kind: "layer",
        index: 0,
        digest: parentLayerDigest,
        media_type: "application/vnd.docker.image.rootfs.diff.tar.gzip",
        declared_size_bytes: 1024,
        observed_size_bytes: 1024,
        content_sha256: parentLayerDigest,
        http_status: 200,
        registry_observed_at: "Wed, 26 Aug 2026 12:00:02 GMT",
      },
      {
        kind: "layer",
        index: 1,
        digest: overlayLayerDigest,
        media_type: "application/vnd.docker.image.rootfs.diff.tar.gzip",
        declared_size_bytes: 2048,
        observed_size_bytes: 2048,
        content_sha256: overlayLayerDigest,
        http_status: 200,
        registry_observed_at: "Wed, 26 Aug 2026 12:00:03 GMT",
      },
    ],
    all_blobs_verified: true,
  });
  return { evidence, proof };
}

function changed(mutator) {
  const value = fixture();
  mutator(value);
  rehash(value.proof);
  return value;
}

test("anonymous GHCR proof binds exact manifest, config, ordered layers, workflow ref, and commit", () => {
  const { evidence, proof } = fixture();
  const result = validateAnonymousGhcrPublicationProof(proof, {
    evidence,
    expected,
    state,
    runId: RUN_ID,
  });
  assert.equal(result.proof_sha256, proof.proof_sha256);
  assert.equal(result.layers.length, 2);
});

test("anonymous GHCR proof fails closed when the durable proof is missing", () => {
  assert.throws(
    () =>
      validateAnonymousGhcrPublicationProof(undefined, {
        evidence: fixture().evidence,
        expected,
        state,
        runId: RUN_ID,
      }),
    /ANONYMOUS_PUBLICATION_PROOF_CONTRACT/u,
  );
});

for (const status of [401, 404]) {
  test(`anonymous GHCR proof rejects manifest HTTP ${status}`, () => {
    const { evidence, proof } = changed((value) => {
      value.proof.manifest.http_status = status;
    });
    assert.throws(
      () =>
        validateAnonymousGhcrPublicationProof(proof, { evidence, expected, state, runId: RUN_ID }),
      /ANONYMOUS_PUBLICATION_MANIFEST_PROOF/u,
    );
  });

  test(`anonymous GHCR proof rejects blob HTTP ${status}`, () => {
    const { evidence, proof } = changed((value) => {
      value.proof.layers[0].http_status = status;
    });
    assert.throws(
      () =>
        validateAnonymousGhcrPublicationProof(proof, { evidence, expected, state, runId: RUN_ID }),
      /ANONYMOUS_PUBLICATION_BLOB_PROOF/u,
    );
  });
}

test("anonymous GHCR proof rejects manifest, config, and layer digest drift", () => {
  for (const mutate of [
    (value) => {
      value.proof.manifest.content_sha256 = digest("9");
    },
    (value) => {
      value.proof.config.content_sha256 = digest("9");
    },
    (value) => {
      value.proof.layers[1].content_sha256 = digest("9");
    },
    (value) => {
      value.evidence.layer_digest = digest("9");
    },
  ]) {
    const { evidence, proof } = changed(mutate);
    assert.throws(
      () =>
        validateAnonymousGhcrPublicationProof(proof, { evidence, expected, state, runId: RUN_ID }),
      /ANONYMOUS_PUBLICATION_(MANIFEST_PROOF|BLOB_PROOF|LAYER_BINDING)/u,
    );
  }
});

test("anonymous GHCR proof rejects workflow ref, commit, run, timestamp, and proof-hash drift", () => {
  for (const mutate of [
    (value) => {
      value.proof.workflow_ref = "refs/heads/main";
    },
    (value) => {
      value.proof.workflow_commit = "5".repeat(40);
    },
    (value) => {
      value.proof.workflow_run_id = "54321";
    },
    (value) => {
      value.proof.registry_observed_at = "Wed, 26 Aug 2026 14:00:00 GMT";
    },
    (value) => {
      value.proof.layers[0].registry_observed_at = "Wed, 26 Aug 2026 14:00:00 GMT";
    },
  ]) {
    const { evidence, proof } = changed(mutate);
    assert.throws(() =>
      validateAnonymousGhcrPublicationProof(proof, { evidence, expected, state, runId: RUN_ID }),
    );
  }
  const { evidence, proof } = fixture();
  proof.proof_sha256 = digest("f");
  assert.throws(
    () =>
      validateAnonymousGhcrPublicationProof(proof, { evidence, expected, state, runId: RUN_ID }),
    /ANONYMOUS_PUBLICATION_PROOF_HASH/u,
  );
});

for (const [path, workflowName] of [
  [".github/workflows/mage-image.yml", "mage-image"],
  [".github/workflows/avatar-primary-serverless-image.yml", "avatar-primary-serverless-image"],
]) {
  test(`${workflowName} durably embeds full anonymous manifest/config/layer GET proof`, () => {
    const source = readFileSync(path, "utf8");
    const proofStep = source.slice(
      source.indexOf("- name: Prove anonymous public pull visibility"),
      source.indexOf(
        "- name: Write",
        source.indexOf("- name: Prove anonymous public pull visibility"),
      ),
    );
    assert.match(proofStep, /--output "\$blob_file" --write-out '%\{http_code\}'/u);
    assert.doesNotMatch(proofStep, /-I\s/u);
    assert.match(proofStep, /observed_digest="sha256:\$\(sha256sum/u);
    assert.match(proofStep, /test "\$observed_size" = "\$declared_size"/u);
    assert.match(proofStep, /"workflow_ref": os\.environ\["GITHUB_REF"\]/u);
    assert.match(proofStep, /"workflow_commit": os\.environ\["GITHUB_SHA"\]/u);
    assert.match(proofStep, /"registry_observed_at"/u);
    assert.match(source, /"schema_version": "videoforge-image-deployability\/v2"/u);
    assert.match(source, /"anonymous_publication_proof": anonymous_proof/u);
  });
}
