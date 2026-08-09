import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  LOCAL_SHORT_SLICE_MANIFEST,
  LOCAL_SHORT_SLICE_SOURCE_PATHS,
  validateLocalShortSliceManifest,
  type LocalShortSliceManifest,
} from "./local-short-slice";

function cloneManifest(): LocalShortSliceManifest {
  return structuredClone(LOCAL_SHORT_SLICE_MANIFEST) as LocalShortSliceManifest;
}

function issueCodes(manifest: LocalShortSliceManifest): readonly string[] {
  return validateLocalShortSliceManifest(manifest).map((issue) => issue.code);
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertDeepFrozen(child);
  }
}

describe("owned local short-slice source", () => {
  it("is an immutable, valid, source-only 35–45 second manifest", () => {
    assert.deepEqual(validateLocalShortSliceManifest(LOCAL_SHORT_SLICE_MANIFEST), []);
    assertDeepFrozen(LOCAL_SHORT_SLICE_MANIFEST);

    const { expectedDurationMs, durationEnvelopeMs, text } = LOCAL_SHORT_SLICE_MANIFEST.narration;
    assert.equal(durationEnvelopeMs.min, 35_000);
    assert.equal(durationEnvelopeMs.max, 45_000);
    assert.ok(expectedDurationMs >= durationEnvelopeMs.min);
    assert.ok(expectedDurationMs <= durationEnvelopeMs.max);
    assert.ok(text.split(/\s+/u).length >= 75);
    assert.ok(text.split(/\s+/u).length <= 110);

    const serialized = JSON.stringify(LOCAL_SHORT_SLICE_MANIFEST);
    assert.doesNotMatch(serialized, /\.(?:aac|m4a|mov|mp3|mp4|wav)\b/iu);
    assert.equal(LOCAL_SHORT_SLICE_MANIFEST.provenance.sourceOnly, true);
    assert.equal(LOCAL_SHORT_SLICE_MANIFEST.provenance.providerCallsRequired, false);
    assert.equal(LOCAL_SHORT_SLICE_MANIFEST.provenance.containsGeneratedAudio, false);
    assert.equal(LOCAL_SHORT_SLICE_MANIFEST.provenance.containsGeneratedVideo, false);
  });

  it("pins exact existing system-owned avatar and style SVG paths", async () => {
    const assets = [
      LOCAL_SHORT_SLICE_MANIFEST.sources.avatar,
      LOCAL_SHORT_SLICE_MANIFEST.sources.styleCover,
      ...LOCAL_SHORT_SLICE_MANIFEST.sources.styleExamples,
    ];
    assert.deepEqual(
      assets.map((asset) => asset.publicPath),
      [
        LOCAL_SHORT_SLICE_SOURCE_PATHS.avatar,
        LOCAL_SHORT_SLICE_SOURCE_PATHS.styleCover,
        ...LOCAL_SHORT_SLICE_SOURCE_PATHS.styleExamples,
      ],
    );
    assert.equal(
      assets.every((asset) => asset.ownership === "SYSTEM_OWNED"),
      true,
    );

    const publicRoot = new URL("../../../apps/web/public/", import.meta.url);
    await Promise.all(
      assets.map(async (asset) => {
        assert.match(asset.publicPath, /^\/fixtures\/.+\.svg$/u);
        await access(fileURLToPath(new URL(asset.publicPath.slice(1), publicRoot)));
      }),
    );
  });

  it("covers all three compositions with unique IDs and legal output rules", () => {
    const segments = LOCAL_SHORT_SLICE_MANIFEST.segments;
    const compositions = new Set(segments.map((segment) => segment.composition));
    const segmentIds = segments.map((segment) => segment.segmentId);
    const sourceIds = [
      LOCAL_SHORT_SLICE_MANIFEST.sources.avatar.assetId,
      LOCAL_SHORT_SLICE_MANIFEST.sources.styleCover.assetId,
      ...LOCAL_SHORT_SLICE_MANIFEST.sources.styleExamples.map((asset) => asset.assetId),
    ];

    assert.deepEqual([...compositions].sort(), ["AVATAR_FULL", "AVATAR_SPLIT_IMAGE", "IMAGE_FULL"]);
    assert.equal(new Set(segmentIds).size, segmentIds.length);
    assert.equal(new Set(sourceIds).size, sourceIds.length);
    assert.equal(LOCAL_SHORT_SLICE_MANIFEST.expectedOutput.cutPolicy, "HARD_CUTS_ONLY");
    assert.equal(
      LOCAL_SHORT_SLICE_MANIFEST.expectedOutput.imageMotionPolicy,
      "SLOW_SMOOTH_ZOOM_EVERY_IMAGE",
    );
    assert.equal(
      Object.values(LOCAL_SHORT_SLICE_MANIFEST.expectedOutput.prohibited).every(
        (enabled) => enabled === false,
      ),
      true,
    );
    assert.equal(
      segments
        .filter((segment) => segment.imageAssetId !== null)
        .every((segment) => segment.imageZoom?.kind === "SLOW_SMOOTH_ZOOM"),
      true,
    );
  });

  it("reports duration, ID, source, composition, zoom, and prohibited-output regressions", () => {
    const badDuration = cloneManifest();
    (badDuration.narration as { expectedDurationMs: number }).expectedDurationMs = 34_000;
    assert.ok(issueCodes(badDuration).includes("EXPECTED_DURATION"));

    const duplicateId = cloneManifest();
    (duplicateId.segments[1] as { segmentId: string }).segmentId =
      duplicateId.segments[0]!.segmentId;
    assert.ok(issueCodes(duplicateId).includes("DUPLICATE_SEGMENT_ID"));

    const foreignSource = cloneManifest();
    (foreignSource.sources.styleExamples[0] as { publicPath: string }).publicPath =
      "/fixtures/styles/not-owned.svg";
    assert.ok(issueCodes(foreignSource).includes("SOURCE_PATH"));

    const missingComposition = cloneManifest();
    (missingComposition.expectedOutput.compositionCoverage as unknown as string[]).pop();
    assert.ok(issueCodes(missingComposition).includes("DECLARED_COMPOSITION_COVERAGE"));

    const missingZoom = cloneManifest();
    (missingZoom.segments[1] as { imageZoom: null }).imageZoom = null;
    assert.ok(issueCodes(missingZoom).includes("IMAGE_ZOOM"));

    const prohibitedText = cloneManifest();
    (
      prohibitedText.expectedOutput.prohibited as unknown as {
        textOverlays: boolean;
      }
    ).textOverlays = true;
    assert.ok(issueCodes(prohibitedText).includes("PROHIBITED_OUTPUT"));
  });
});
