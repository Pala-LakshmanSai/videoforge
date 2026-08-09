export const LOCAL_SHORT_SLICE_SOURCE_PATHS = {
  avatar: "/fixtures/avatar/amish-farm-host.svg",
  styleCover: "/fixtures/styles/documentary-stock.svg",
  styleExamples: [
    "/fixtures/styles/documentary-field.svg",
    "/fixtures/styles/documentary-market.svg",
    "/fixtures/styles/documentary-workshop.svg",
  ],
} as const;

export type LocalShortSliceComposition = "AVATAR_FULL" | "IMAGE_FULL" | "AVATAR_SPLIT_IMAGE";

export interface LocalShortSliceSourceAsset {
  readonly assetId: string;
  readonly kind: "AVATAR" | "STYLE_COVER" | "STYLE_EXAMPLE";
  readonly ownership: "SYSTEM_OWNED";
  readonly publicPath: string;
}

export interface LocalShortSliceImageZoom {
  readonly kind: "SLOW_SMOOTH_ZOOM";
  readonly anchor: "CENTER";
  readonly startScale: number;
  readonly endScale: number;
}

export interface LocalShortSliceSegment {
  readonly segmentId: string;
  readonly composition: LocalShortSliceComposition;
  readonly startMs: number;
  readonly endMs: number;
  readonly narrationCue: string;
  readonly avatarAssetId: string | null;
  readonly imageAssetId: string | null;
  readonly imageZoom: LocalShortSliceImageZoom | null;
}

export interface LocalShortSliceManifest {
  readonly schemaVersion: "videoforge.local-short-slice-source/v1";
  readonly fixtureId: string;
  readonly provenance: {
    readonly manifestId: string;
    readonly revision: 1;
    readonly immutability: "IMMUTABLE_SOURCE";
    readonly ownership: "VIDEOFORGE_SYSTEM_OWNED";
    readonly sourceOnly: true;
    readonly syntheticSvgSourcesOnly: true;
    readonly providerCallsRequired: false;
    readonly containsPrivateData: false;
    readonly containsGeneratedAudio: false;
    readonly containsGeneratedVideo: false;
  };
  readonly narration: {
    readonly language: "en";
    readonly text: string;
    readonly expectedDurationMs: number;
    readonly durationEnvelopeMs: {
      readonly min: number;
      readonly max: number;
    };
  };
  readonly pinnedProfiles: {
    readonly avatarProfileVersionId: "avatar_profile_version_fixture_001";
    readonly imageStyleVersionId: "style_version_documentary_stock_v1";
  };
  readonly sources: {
    readonly avatar: LocalShortSliceSourceAsset;
    readonly styleCover: LocalShortSliceSourceAsset;
    readonly styleExamples: readonly LocalShortSliceSourceAsset[];
  };
  readonly expectedOutput: {
    readonly compositionCoverage: readonly LocalShortSliceComposition[];
    readonly cutPolicy: "HARD_CUTS_ONLY";
    readonly imageMotionPolicy: "SLOW_SMOOTH_ZOOM_EVERY_IMAGE";
    readonly prohibited: {
      readonly motionGraphics: false;
      readonly textOverlays: false;
      readonly captions: false;
      readonly lowerThirds: false;
      readonly titleCards: false;
      readonly animatedTitles: false;
      readonly decorativeGraphics: false;
      readonly borders: false;
      readonly watermarks: false;
      readonly decorativeTransitions: false;
    };
  };
  readonly segments: readonly LocalShortSliceSegment[];
}

export interface LocalShortSliceValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value as DeepReadonly<T>;
}

const AVATAR_ASSET_ID = "avatar_amish_farm_host_svg_v1";
const STYLE_COVER_ASSET_ID = "style_documentary_stock_cover_svg_v1";
const STYLE_FIELD_ASSET_ID = "style_documentary_field_svg_v1";
const STYLE_MARKET_ASSET_ID = "style_documentary_market_svg_v1";
const STYLE_WORKSHOP_ASSET_ID = "style_documentary_workshop_svg_v1";

const NARRATION_CUES = [
  "A ripe watermelon gives several small clues before it is opened.",
  "Begin by looking for a creamy yellow field spot where the fruit rested on the ground. Next, compare the weight with another melon of similar size; the heavier one usually holds more water.",
  "Run your fingers across the rind and choose a surface that feels firm rather than soft.",
  "Finally, inspect the stem and listen for a deep, steady sound when you tap the center.",
  "These simple checks work best when considered together, not as isolated promises.",
] as const;

const SLOW_SMOOTH_ZOOM: LocalShortSliceImageZoom = {
  kind: "SLOW_SMOOTH_ZOOM",
  anchor: "CENTER",
  startScale: 1,
  endScale: 1.06,
};

const localShortSliceManifest: LocalShortSliceManifest = {
  schemaVersion: "videoforge.local-short-slice-source/v1",
  fixtureId: "local_short_slice_owned_001",
  provenance: {
    manifestId: "local_short_slice_owned_manifest_001",
    revision: 1,
    immutability: "IMMUTABLE_SOURCE",
    ownership: "VIDEOFORGE_SYSTEM_OWNED",
    sourceOnly: true,
    syntheticSvgSourcesOnly: true,
    providerCallsRequired: false,
    containsPrivateData: false,
    containsGeneratedAudio: false,
    containsGeneratedVideo: false,
  },
  narration: {
    language: "en",
    text: NARRATION_CUES.join(" "),
    expectedDurationMs: 40_000,
    durationEnvelopeMs: {
      min: 35_000,
      max: 45_000,
    },
  },
  pinnedProfiles: {
    avatarProfileVersionId: "avatar_profile_version_fixture_001",
    imageStyleVersionId: "style_version_documentary_stock_v1",
  },
  sources: {
    avatar: {
      assetId: AVATAR_ASSET_ID,
      kind: "AVATAR",
      ownership: "SYSTEM_OWNED",
      publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.avatar,
    },
    styleCover: {
      assetId: STYLE_COVER_ASSET_ID,
      kind: "STYLE_COVER",
      ownership: "SYSTEM_OWNED",
      publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.styleCover,
    },
    styleExamples: [
      {
        assetId: STYLE_FIELD_ASSET_ID,
        kind: "STYLE_EXAMPLE",
        ownership: "SYSTEM_OWNED",
        publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.styleExamples[0],
      },
      {
        assetId: STYLE_MARKET_ASSET_ID,
        kind: "STYLE_EXAMPLE",
        ownership: "SYSTEM_OWNED",
        publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.styleExamples[1],
      },
      {
        assetId: STYLE_WORKSHOP_ASSET_ID,
        kind: "STYLE_EXAMPLE",
        ownership: "SYSTEM_OWNED",
        publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.styleExamples[2],
      },
    ],
  },
  expectedOutput: {
    compositionCoverage: ["AVATAR_FULL", "IMAGE_FULL", "AVATAR_SPLIT_IMAGE"],
    cutPolicy: "HARD_CUTS_ONLY",
    imageMotionPolicy: "SLOW_SMOOTH_ZOOM_EVERY_IMAGE",
    prohibited: {
      motionGraphics: false,
      textOverlays: false,
      captions: false,
      lowerThirds: false,
      titleCards: false,
      animatedTitles: false,
      decorativeGraphics: false,
      borders: false,
      watermarks: false,
      decorativeTransitions: false,
    },
  },
  segments: [
    {
      segmentId: "local_segment_001",
      composition: "AVATAR_FULL",
      startMs: 0,
      endMs: 4_500,
      narrationCue: NARRATION_CUES[0],
      avatarAssetId: AVATAR_ASSET_ID,
      imageAssetId: null,
      imageZoom: null,
    },
    {
      segmentId: "local_segment_002",
      composition: "IMAGE_FULL",
      startMs: 4_500,
      endMs: 16_000,
      narrationCue: NARRATION_CUES[1],
      avatarAssetId: null,
      imageAssetId: STYLE_FIELD_ASSET_ID,
      imageZoom: SLOW_SMOOTH_ZOOM,
    },
    {
      segmentId: "local_segment_003",
      composition: "AVATAR_SPLIT_IMAGE",
      startMs: 16_000,
      endMs: 22_000,
      narrationCue: NARRATION_CUES[2],
      avatarAssetId: AVATAR_ASSET_ID,
      imageAssetId: STYLE_MARKET_ASSET_ID,
      imageZoom: SLOW_SMOOTH_ZOOM,
    },
    {
      segmentId: "local_segment_004",
      composition: "IMAGE_FULL",
      startMs: 22_000,
      endMs: 35_000,
      narrationCue: NARRATION_CUES[3],
      avatarAssetId: null,
      imageAssetId: STYLE_WORKSHOP_ASSET_ID,
      imageZoom: SLOW_SMOOTH_ZOOM,
    },
    {
      segmentId: "local_segment_005",
      composition: "AVATAR_FULL",
      startMs: 35_000,
      endMs: 40_000,
      narrationCue: NARRATION_CUES[4],
      avatarAssetId: AVATAR_ASSET_ID,
      imageAssetId: null,
      imageZoom: null,
    },
  ],
};

export const LOCAL_SHORT_SLICE_MANIFEST = deepFreeze(localShortSliceManifest);

const REQUIRED_COMPOSITIONS: readonly LocalShortSliceComposition[] = [
  "AVATAR_FULL",
  "IMAGE_FULL",
  "AVATAR_SPLIT_IMAGE",
];

const EXPECTED_SOURCE_ASSETS: readonly LocalShortSliceSourceAsset[] = [
  {
    assetId: AVATAR_ASSET_ID,
    kind: "AVATAR",
    ownership: "SYSTEM_OWNED",
    publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.avatar,
  },
  {
    assetId: STYLE_COVER_ASSET_ID,
    kind: "STYLE_COVER",
    ownership: "SYSTEM_OWNED",
    publicPath: LOCAL_SHORT_SLICE_SOURCE_PATHS.styleCover,
  },
  ...LOCAL_SHORT_SLICE_SOURCE_PATHS.styleExamples.map((publicPath, index) => ({
    assetId: [STYLE_FIELD_ASSET_ID, STYLE_MARKET_ASSET_ID, STYLE_WORKSHOP_ASSET_ID][index]!,
    kind: "STYLE_EXAMPLE" as const,
    ownership: "SYSTEM_OWNED" as const,
    publicPath,
  })),
];

function addIssue(
  issues: LocalShortSliceValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function sourceAssets(manifest: LocalShortSliceManifest): readonly LocalShortSliceSourceAsset[] {
  return [manifest.sources.avatar, manifest.sources.styleCover, ...manifest.sources.styleExamples];
}

export function validateLocalShortSliceManifest(
  manifest: LocalShortSliceManifest,
): readonly LocalShortSliceValidationIssue[] {
  const issues: LocalShortSliceValidationIssue[] = [];

  if (manifest.schemaVersion !== "videoforge.local-short-slice-source/v1") {
    addIssue(
      issues,
      "SCHEMA_VERSION",
      "schemaVersion",
      "The source schema version is not supported.",
    );
  }

  if (
    manifest.provenance.immutability !== "IMMUTABLE_SOURCE" ||
    manifest.provenance.ownership !== "VIDEOFORGE_SYSTEM_OWNED" ||
    !manifest.provenance.sourceOnly ||
    !manifest.provenance.syntheticSvgSourcesOnly ||
    manifest.provenance.providerCallsRequired ||
    manifest.provenance.containsPrivateData ||
    manifest.provenance.containsGeneratedAudio ||
    manifest.provenance.containsGeneratedVideo
  ) {
    addIssue(
      issues,
      "PROVENANCE_POLICY",
      "provenance",
      "The fixture must remain immutable, owned, source-only, synthetic, and provider-free.",
    );
  }

  const { expectedDurationMs, durationEnvelopeMs } = manifest.narration;
  if (durationEnvelopeMs.min !== 35_000 || durationEnvelopeMs.max !== 45_000) {
    addIssue(
      issues,
      "DURATION_ENVELOPE",
      "narration.durationEnvelopeMs",
      "The local short slice must retain its 35–45 second duration envelope.",
    );
  }
  if (expectedDurationMs < durationEnvelopeMs.min || expectedDurationMs > durationEnvelopeMs.max) {
    addIssue(
      issues,
      "EXPECTED_DURATION",
      "narration.expectedDurationMs",
      "Expected duration must be inside the declared envelope.",
    );
  }
  if (manifest.narration.language !== "en" || manifest.narration.text.trim().length === 0) {
    addIssue(
      issues,
      "NARRATION",
      "narration",
      "Narration must contain non-empty English source text.",
    );
  }

  const assets = sourceAssets(manifest);
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    const expected = EXPECTED_SOURCE_ASSETS[index];
    if (
      expected === undefined ||
      asset.assetId !== expected.assetId ||
      asset.kind !== expected.kind ||
      asset.ownership !== expected.ownership ||
      asset.publicPath !== expected.publicPath
    ) {
      addIssue(
        issues,
        "SOURCE_PATH",
        `sources[${index}]`,
        "Only the pinned system-owned avatar and documentary style SVGs are allowed.",
      );
    }
    if (assetIds.has(asset.assetId)) {
      addIssue(
        issues,
        "DUPLICATE_ASSET_ID",
        `sources[${index}].assetId`,
        "Asset IDs must be unique.",
      );
    }
    if (assetPaths.has(asset.publicPath)) {
      addIssue(
        issues,
        "DUPLICATE_SOURCE_PATH",
        `sources[${index}].publicPath`,
        "Source paths must be unique.",
      );
    }
    assetIds.add(asset.assetId);
    assetPaths.add(asset.publicPath);
  }
  const imageAssetIds = new Set(manifest.sources.styleExamples.map((asset) => asset.assetId));
  if (assets.length !== EXPECTED_SOURCE_ASSETS.length) {
    addIssue(
      issues,
      "SOURCE_COUNT",
      "sources",
      "The fixture must pin one avatar, one style cover, and three style examples.",
    );
  }

  if (
    manifest.expectedOutput.cutPolicy !== "HARD_CUTS_ONLY" ||
    manifest.expectedOutput.imageMotionPolicy !== "SLOW_SMOOTH_ZOOM_EVERY_IMAGE"
  ) {
    addIssue(
      issues,
      "OUTPUT_POLICY",
      "expectedOutput",
      "Output must use hard cuts and a slow smooth zoom on every image.",
    );
  }
  for (const [flag, enabled] of Object.entries(manifest.expectedOutput.prohibited)) {
    if (enabled !== false) {
      addIssue(
        issues,
        "PROHIBITED_OUTPUT",
        `expectedOutput.prohibited.${flag}`,
        "Prohibited output flags must remain false.",
      );
    }
  }

  const declaredCoverage = new Set(manifest.expectedOutput.compositionCoverage);
  for (const composition of REQUIRED_COMPOSITIONS) {
    if (!declaredCoverage.has(composition)) {
      addIssue(
        issues,
        "DECLARED_COMPOSITION_COVERAGE",
        "expectedOutput.compositionCoverage",
        `Missing declared ${composition} coverage.`,
      );
    }
  }
  if (declaredCoverage.size !== REQUIRED_COMPOSITIONS.length) {
    addIssue(
      issues,
      "DECLARED_COMPOSITION_COVERAGE",
      "expectedOutput.compositionCoverage",
      "Composition coverage may contain only the three required modes.",
    );
  }

  const segmentIds = new Set<string>();
  const actualCoverage = new Set<LocalShortSliceComposition>();
  let expectedStartMs = 0;
  for (const [index, segment] of manifest.segments.entries()) {
    const path = `segments[${index}]`;
    if (segmentIds.has(segment.segmentId)) {
      addIssue(issues, "DUPLICATE_SEGMENT_ID", `${path}.segmentId`, "Segment IDs must be unique.");
    }
    segmentIds.add(segment.segmentId);
    actualCoverage.add(segment.composition);

    if (segment.startMs !== expectedStartMs || segment.endMs <= segment.startMs) {
      addIssue(
        issues,
        "SEGMENT_TIMING",
        path,
        "Segments must be positive-duration, ordered, and contiguous from zero.",
      );
    }
    expectedStartMs = segment.endMs;

    if (segment.narrationCue.trim().length === 0) {
      addIssue(
        issues,
        "NARRATION_CUE",
        `${path}.narrationCue`,
        "Each segment needs narration text.",
      );
    }
    if (segment.avatarAssetId !== null && segment.avatarAssetId !== AVATAR_ASSET_ID) {
      addIssue(issues, "SEGMENT_SOURCE", `${path}.avatarAssetId`, "Unknown avatar source.");
    }
    if (segment.imageAssetId !== null && !imageAssetIds.has(segment.imageAssetId)) {
      addIssue(issues, "SEGMENT_SOURCE", `${path}.imageAssetId`, "Unknown image source.");
    }

    if (
      segment.composition === "AVATAR_FULL" &&
      (segment.avatarAssetId !== AVATAR_ASSET_ID ||
        segment.imageAssetId !== null ||
        segment.imageZoom !== null)
    ) {
      addIssue(
        issues,
        "COMPOSITION_INPUTS",
        path,
        "AVATAR_FULL requires only the pinned avatar source.",
      );
    }
    if (
      segment.composition === "IMAGE_FULL" &&
      (segment.avatarAssetId !== null || segment.imageAssetId === null)
    ) {
      addIssue(issues, "COMPOSITION_INPUTS", path, "IMAGE_FULL requires exactly one image source.");
    }
    if (
      segment.composition === "AVATAR_SPLIT_IMAGE" &&
      (segment.avatarAssetId !== AVATAR_ASSET_ID || segment.imageAssetId === null)
    ) {
      addIssue(
        issues,
        "COMPOSITION_INPUTS",
        path,
        "AVATAR_SPLIT_IMAGE requires the pinned avatar and one image source.",
      );
    }

    if (segment.imageAssetId !== null) {
      const zoom = segment.imageZoom;
      if (
        zoom === null ||
        zoom.kind !== "SLOW_SMOOTH_ZOOM" ||
        zoom.anchor !== "CENTER" ||
        zoom.startScale !== 1 ||
        zoom.endScale <= zoom.startScale ||
        zoom.endScale > 1.1
      ) {
        addIssue(
          issues,
          "IMAGE_ZOOM",
          `${path}.imageZoom`,
          "Every image must use the restrained slow smooth zoom specification.",
        );
      }
    }
  }

  if (expectedStartMs !== expectedDurationMs) {
    addIssue(
      issues,
      "TIMELINE_DURATION",
      "segments",
      "The segment timeline must end at the expected narration duration.",
    );
  }
  for (const composition of REQUIRED_COMPOSITIONS) {
    if (!actualCoverage.has(composition)) {
      addIssue(
        issues,
        "ACTUAL_COMPOSITION_COVERAGE",
        "segments",
        `No segment exercises ${composition}.`,
      );
    }
  }
  if (
    manifest.segments.map((segment) => segment.narrationCue).join(" ") !== manifest.narration.text
  ) {
    addIssue(
      issues,
      "NARRATION_COVERAGE",
      "segments",
      "Segment narration cues must cover the narration text exactly once and in order.",
    );
  }

  return issues;
}
