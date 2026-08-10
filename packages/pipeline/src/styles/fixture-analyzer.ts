import type { ImageStyleAnalyzerOutputDocument } from "@videoforge/contracts";

import type { StyleAnalyzerPort, StyleAnalyzerRequest } from "./types.js";
import { STYLE_TRAITS } from "./types.js";

export class DeterministicFixtureStyleAnalyzer implements StyleAnalyzerPort {
  async analyze(request: StyleAnalyzerRequest): Promise<ImageStyleAnalyzerOutputDocument> {
    const aliases = request.references.map((reference) => reference.alias);
    return Object.freeze({
      summary:
        "Shared restrained editorial photography with soft practical light and tactile detail.",
      visual_profile: {
        medium_family: "editorial photography",
        realism: "naturalistic photographed realism",
        subject_treatment: "candid subjects engaged in ordinary visible actions",
        camera_language: "restrained eye-level observational camera",
        image_framing: "balanced evidence-first framing with useful negative space",
        shot_scale_preferences: ["environmental wide", "human medium", "material close-up"],
        lighting: "soft available practical light",
        color: { descriptors: ["muted earth colors", "neutral skin tones"], approximate_hex: [] },
        contrast_and_exposure: "soft contrast with protected highlights",
        depth_of_field: "moderate depth retaining environmental context",
        texture_and_grain: "fine natural grain and tactile material texture",
        human_rendering: "natural skin texture and unposed gesture",
        environment_and_material_detail: "ordinary locations and believable worn materials",
        imperfection_profile: ["minor asymmetry", "natural wear"],
        mood: ["quiet", "observational"],
        continuity_rules: ["keep palette and practical-light treatment stable"],
        must_include: ["visible physical evidence", "natural material texture"],
        must_avoid: ["glossy commercial polish", "visible text or branding"],
        flexible_properties: ["subject identity", "location", "weather"],
      },
      prompt_profile: {
        planner_guidance:
          "Use literal evidence with quiet editorial photography and natural texture.",
        positive_suffix:
          "restrained editorial photography, practical light, tactile natural detail",
        negative_suffix: "glossy advertising, synthetic texture, visible text, logo",
        full_image_guidance: "16:9 frame with key evidence inside the center-safe 80%",
        split_image_guidance: "8:9 right panel with the key subject centered away from edges",
      },
      analysis: {
        overall_confidence: 0.88,
        trait_evidence: STYLE_TRAITS.map((trait) => ({
          trait,
          support_status: "SUPPORTED" as const,
          confidence: 0.85,
          supporting_reference_aliases: aliases,
        })),
        uncertain_fields: [],
        outlier_reference_aliases: [],
        content_leakage_warnings: [],
      },
    });
  }
}
