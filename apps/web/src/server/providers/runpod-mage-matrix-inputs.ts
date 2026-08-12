import { createHash } from "node:crypto";

export const MAGE_MATRIX_NEGATIVE_PROMPT =
  "visible text, letters, words, signage, logo, brand name, watermark, repeated people, duplicate people, cloned people, malformed hands, malformed anatomy, fused objects, distorted vehicles, nonsensical groceries, artificial CGI, illustration, graphics, borders, overlays";

const styles = [
  [
    "documentary_stock_v1",
    "natural documentary photograph, available light, restrained color, honest material texture",
  ],
  [
    "warm_analog",
    "warm analog photograph, soft highlight rolloff, subtle film grain, muted earth palette",
  ],
  [
    "cool_editorial",
    "cool editorial photograph, clean daylight, crisp material detail, restrained blue-gray palette",
  ],
  [
    "humid_reportage",
    "humid reportage photograph, overcast soft light, tactile surfaces, subdued green-brown palette",
  ],
  [
    "highland_archive",
    "highland archival photograph, low contrast daylight, fine grain, weathered neutral palette",
  ],
] as const;

const subjects = [
  [
    "people_skin",
    "An elderly farmer and an adult daughter examine healthy seedlings together beside a field, natural skin texture, candid expressions, ordinary work clothes",
    "FULL_IMAGE",
  ],
  [
    "hands_demonstration",
    "Weathered hands demonstrate tying a simple drip-irrigation connector onto a black hose above bare soil, anatomically correct fingers and believable tool contact",
    "SPLIT_RIGHT_IMAGE",
  ],
  [
    "food_texture",
    "A freshly cut ripe watermelon rests on a worn wooden farm table, crisp red flesh, dark seeds, moist fibrous texture, unbranded kitchen knife nearby",
    "FULL_IMAGE",
  ],
  [
    "tools_rural_work",
    "A rural worker sharpens a worn garden hoe at an outdoor workbench, believable metal edge, wood grain, practical stance and tool geometry",
    "SPLIT_RIGHT_IMAGE",
  ],
  [
    "interior_public",
    "Inside a modest agricultural cooperative, distinct shoppers choose loose unbranded vegetables from plain wooden bins under practical daylight, no readable labels",
    "FULL_IMAGE",
  ],
  [
    "macro_evidence",
    "Macro evidence photograph of clear dew droplets and small insect feeding marks on the surface of one green crop leaf, precise veins and natural texture",
    "SPLIT_RIGHT_IMAGE",
  ],
  [
    "historical_period",
    "A 1930s farm family threshes grain with period-accurate hand tools beside a timber barn, restrained documentary moment, historically plausible clothing and materials",
    "FULL_IMAGE",
  ],
  [
    "wide_environment",
    "A wide hillside farming landscape shows contour trenches carrying light rainwater between terraced fields, clear practical geometry and small distinct workers for scale",
    "SPLIT_RIGHT_IMAGE",
  ],
] as const;

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export interface MageMatrixItem {
  readonly sceneId: string;
  readonly category: string;
  readonly styleId: string;
  readonly layout: "FULL_IMAGE" | "SPLIT_RIGHT_IMAGE";
  readonly prompt: string;
  readonly promptHash: string;
  readonly negativePromptHash: string;
  readonly seed: number;
}

export function buildMageMatrix(): readonly MageMatrixItem[] {
  return styles.flatMap(([styleId, style], styleIndex) =>
    subjects.map(([category, subject, layout], subjectIndex) => {
      const crop =
        layout === "FULL_IMAGE"
          ? "Compose 16:9 with the primary evidence inside the center-safe area for a continuous slow zoom."
          : "Compose for a clean 8:9 center crop used in the right half of a split frame; keep all primary evidence centered and away from edges.";
      const prompt = `${subject}. ${crop} ${style}. Authentic physically believable detail, distinct people, coherent anatomy and objects, no staged advertising polish.`;
      return {
        sceneId: `${styleId}_${category}`,
        category,
        styleId,
        layout,
        prompt,
        promptHash: sha256(prompt),
        negativePromptHash: sha256(MAGE_MATRIX_NEGATIVE_PROMPT),
        seed: 2_026_081_200 + styleIndex * subjects.length + subjectIndex,
      };
    }),
  );
}
