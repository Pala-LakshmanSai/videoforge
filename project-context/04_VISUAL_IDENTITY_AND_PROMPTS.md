# Visual identity and image prompting

Status: durable prompt/style authority and fixture image acceptance complete
Read when: implementing Runware prompt batches, the prompt compiler, Mage settings, image review, or changing a visual style.

## Universal image-quality definition

VideoForge image quality is primarily:

1. Literal relevance to the exact voiceover phrase on screen.
2. Faithful adherence to the project's pinned published Image Style.
3. Useful shot-scale variation.
4. Continuity of people, era, location, clothing, tools, weather, and material details.
5. Absence of text, logos, watermarks, malformed objects, and unintended style artifacts.

The built-in default style is photorealistic documentary stock footage. Custom styles may intentionally use another still-image medium, but none may introduce output graphics, captions, transitions, or change the edit grammar.

The Image Styles Hub lifecycle, schema, UI, privacy, and versioning are owned by `18_IMAGE_STYLES_HUB.md`.

## Prompt-planning boundary

### Post-transcription story context

After transcription and before scene planning, Runware DeepSeek V4 Flash receives the complete
ordered voiceover exactly once and returns one compact structured story-context document. It may
contain only transcript-supported topic, people, places, era/time, recurring objects, processes,
cause/effect, chronology, continuity facts, and resolved pronoun/callback references. Persist and
hash this document. Do not infer visual style, camera direction, graphics, branding, or facts absent
from the transcript.

The prompt-writing request does not resend the complete transcript. Stage 5 consumes Stage 4's
complete ordered image-scene list and deterministically derives the minimum number of contiguous
batches that fit the exact canonical request and conservative response budgets. It sends the compact
bounded story context once per derived batch, where it is available while writing every scene. Each
scene item sends the exact Stage 4 timed phrase, the immediately preceding transcript fragment, the
immediately following transcript fragment, and the deterministic shot role/layout. Adjacent fragments
are derived from the ordered transcript and capped at 1,000 characters. Precedence is exact phrase,
adjacent phrase context, global story context, then soft style treatment. There is no fixed
scenes-per-batch rule and no project scene cap.

Token and cost bounds are part of acceptance. The live hosted profile uses one bounded context
extraction with a 350-token output ceiling and a 10,000 micro-USD reservation. Stage 5 plans against
a 48,000-token input ceiling and a 16,384-token application output-quality budget per request under
the 64,000-token technical output ceiling, with one 40,000 micro-USD project reservation. One
provider request is allowed per persisted planned batch. The hosted path performs no prompt-provider
retry: accepted batches persist before the next request, while definite or ambiguous failure stops
without redispatch. Do not duplicate the same global context inside every scene item. Prompt cores
stay concise and concrete; trusted code adds crop, style, optional keywords, and permanent guardrails
exactly once.

Runware DeepSeek V4 Flash 0731 writes scene-content prompts only. Code already knows:

- The sanitized project title as global topic context.
- The scene start/end and exact narration phrase.
- The timeline composition and required aspect ratio.
- Whether it is a full image or a split-right image.
- The deterministic `in_image_shot_role`.
- Adjacent narration context and continuity tags.
- The structured scene facts that must be grounded: literal subject, one visible action,
  environment, and lighting context.
- The selected `image_style_version_id` and immutable profile hash.
- Whether project extra keywords are enabled.
- Permanent output guardrails.

The LLM must not select timeline composition, in-image shot role, duration, avatar placement, style version, model, GPU, retry, or fallback.

Use stable scene IDs and keep Stage 4 order unchanged. Derive contiguous adaptive batches from the
exact request bytes, conservative output shape, and natural phrase boundaries. Send the sanitized
project title, compact global story context, and a structured `style_treatment` derived from the
pinned immutable style profile once per batch—not repeated per scene. The treatment carries the
profile's medium, realism, subject treatment, camera language, framing, shot-scale preferences,
lighting, palette and color values, contrast/exposure, depth, texture, human rendering,
environment/material detail, imperfection, and mood. It excludes planner guidance, continuity rules,
must-include/must-avoid content, flexible properties, and concrete reference-image people, places,
objects, products, or brands. Each item receives the exact phrase, its code-assigned in-image shot
role, and only useful preceding/following context. The global and adjacent context may disambiguate a
phrase but may never override it. Atomically persist each fully validated batch and its receipt/cost
evidence before the next request. Stage 6 may dispatch only accepted durable prompts; Stage 5 never
dispatches Mage and never retries a rejected or ambiguous provider response.

Recommended Runware settings:

```json
{
  "taskType": "textInference",
  "model": "deepseek:v4@flash",
  "outputFormat": "JSON",
  "includeUsage": true,
  "includeCost": true,
  "settings": {
    "thinkingLevel": "off",
    "temperature": 0.2,
    "topP": 0.9
  }
}
```

Use strict `jsonSchema`. Application code owns style suffixes, optional extra keywords, and permanent guardrails so the model cannot omit or inconsistently repeat them.

DeepSeek scene-writing contract (`scene-prompt-writer-v2`, Runware request v17):

```text
You write concise image scene cores for VideoForge. For each stable scene ID,
turn the exact narration phrase into one self-contained, concrete, camera-
capturable subject/action/environment moment. Honor the supplied in-image shot
role exactly. Use only the supplied structured style_treatment as reusable
visual treatment and never import concrete reference-image content. Make the
scene physically plausible, relatable, specific, and naturally imperfect;
avoid generic placeholder people, actions, or locations. Prefer literal visible
evidence over metaphor, and for abstract narration show the closest transcript-
supported person, object, process, place, or consequence. Never request visible
text, lettering, signs, labels, markings, captions, logos, watermarks, screens,
UI, charts, graphics, branded products, or decorative transitions. Do not choose
duration, timeline composition, in-image shot role, avatar placement, model,
GPU, retry, or fallback. Return only the strict requested JSON and every scene ID
exactly once.
```

Request v17 keeps the structured fields explicit: `literal_subject`, `action`, `environment`, and
`lighting_context` are the source-bound scene facts, with `continuity_tags` and a compatibility-only
`prompt_core`. Subject, action, and environment must retain concrete anchors from the exact phrase,
containing sentence, bounded previous/next narration, or compact global story context. The system
prompt tells DeepSeek to begin with the exact phrase's visible action and not invent coordinated
actions. Hosted acceptance does not use lexical or action-equivalence heuristics as a terminal gate:
subject, action, context, and duplicate-prose checks are advisory because natural paraphrases cannot
be classified reliably by a bounded word matcher. Hosted v17 also repairs harmless provider
formatting defects before strict persistence: it bounds or fills blank, oversized, or control-
containing text; normalizes and deduplicates continuity tags; and replaces forbidden compiled fields
with neutral narration-derived fallbacks rather than wasting the whole batch. Forbidden continuity
tags are dropped. The compiler still derives final literal image content from the repaired structured
fields and independently rejects forbidden compiled content, so `prompt_core` cannot change the
subject, action, environment, lighting, or restrictions that reach the image model. Deterministic
schema, scene identity, completeness, provider-metadata, and spend-cap fences remain mandatory.

## Compact DeepSeek output

```json
{
  "scene_id": "scene_0042",
  "literal_subject": "weathered hands comparing two ripe watermelons",
  "action": "lifting and tapping each melon beside a farm stand",
  "environment": "busy outdoor produce market in late-summer daylight",
  "in_image_shot_role": "HANDS_ACTION",
  "lighting_context": "available daylight",
  "continuity_tags": ["late_summer", "farm_market", "same_vendor"],
  "prompt_core": "Weathered hands lift and tap two naturally imperfect ripe watermelons beside a crowded outdoor farm stand..."
}
```

The scheduler assigns `in_image_shot_role` from a versioned seeded rotation with simple lexical overrides. DeepSeek returns the exact enum unchanged. The selected style guidance may shape visual treatment, but the output still describes the narration's visible content rather than repeating boilerplate. Structured subject/action/environment/lighting fields are the source-bound compiler inputs; `prompt_core` is compatibility-only.

## Deterministic prompt compiler

Positive construction order:

1. Contract-valid literal subject, visible action, environment, and lighting facts from DeepSeek.
2. Exact source anchors retained by those structured facts.
3. Deterministic continuity and required in-image shot role/viewpoint.
4. Full-image or split-image crop-safe guidance from the pinned style.
5. Selected style positive suffix.
6. `extra_prompt_keywords` exactly once, only when `apply_extra_prompt_keywords=true`.
7. Permanent VideoForge guardrail.

The provider-authored `prompt_core` is never used as final image content. It remains in the durable
writer shape for provider compatibility and advisory quality diagnostics, while the compiler constructs
`literalContent` from the independently normalized and conflict-checked structured fields.

Negative channel:

1. Selected style negative suffix.
2. Permanent VideoForge output negatives.

Semantic conflict precedence:

1. Permanent output/security rules.
2. Literal scene facts and continuity.
3. Required timeline-layout/crop geometry.
4. Enabled project extra keywords as soft refinements.
5. The selected style's other soft traits.

Extra keywords never become a system instruction and never go to DeepSeek. Normalize Unicode, strip control characters, and cap at 500 characters. While the toggle is off, preserve the text but do not semantically validate it, block production because of it, or send it anywhere. Turning the toggle on validates the text; enabled blank/whitespace-only text is rejected and the user may turn the toggle off instead. Block enabling requests such as `add a caption`, `show a logo`, `infographic`, borders, motion graphics, decorative transitions, or a different layout; do not mistake negative refinements such as `no logo`, `no text`, or `no AI look` for requests to add them. Warn only on soft creative tension. Apply the same deterministic hard-rule validator to analyzer-produced and user-edited style clauses before publication. When enabled, trusted compiler code inserts it exactly once in the final Mage prompt. Do not add an LLM call to interpret or rewrite it.

Store `scene_prompt_writer_version`, `prompt_compiler_version`, every component, the exact final positive/negative UTF-8 strings submitted to Mage, and SHA-256 of those exact bytes. The compiler owns a versioned normalization/joining rule so the effective prompt is reproducible.

## Permanent output guardrail

These apply to every style and cannot be disabled by the style profile or project keywords:

```text
no visible text, captions, title, logo, watermark, UI, webpage, chart,
diagram, arrow, infographic, border, lower-third, or graphic overlay;
no malformed anatomy, duplicate limbs, nonsensical objects, accidental
mixed media, or unrelated subject; clean original still image only
```

Because Mage Turbo uses CFG 1, verify whether its implementation applies a separate negative prompt meaningfully. If not, express essential absence constraints in the positive prompt and use deterministic/human rejection. Never silently increase CFG away from the approved Turbo mode.

The positive description must not contradict this guardrail. Deterministic validation must reject a
scene core that positively depends on visible writing, printed labels, markings, signage, UI, charts,
logos, or branded packaging even when a later suffix says `no visible text`. Rephrase the visible
evidence around an unlabeled object or another literal physical action; if readable text or branding
is the core meaning, exclude AI imagery for that scene and fail closed to the approved real-source
media path.

## Built-in style: Authentic Documentary Stock

Style key: `documentary_stock_v1`  
Machine profile: `evidence/default_image_style_v1.json`

Positive suffix:

```text
authentic observational documentary photography, candid and unposed,
filmed on location, available practical light, true-to-life colors,
soft contrast, realistic skin and material textures, naturally imperfect
clothing, tools and environment, ordinary consumer-camera framing,
photojournalistic, genuine frame from real stock or documentary footage,
believable everyday life, no glossy commercial polish, absolutely
photorealistic, no AI look
```

Style-specific negative suffix:

```text
illustration, cartoon, anime, CGI, 3D render, digital painting, fantasy,
surrealism, plastic skin, waxy face, perfect symmetry, excessive HDR,
glamour lighting, studio advertising, staged pose, impossible anatomy,
duplicate people, duplicate limbs, malformed hands, unrealistic perfection
```

The Ranga frames are private manual provenance for this built-in profile. They are never passed to the analyzer, Mage, or the production UI.

## Required shot variation

Assign one enum with deterministic rotation and context-aware lexical overrides, interpreted through the selected style:

- `ENVIRONMENTAL_WIDE`.
- `HUMAN_MEDIUM`.
- `HANDS_ACTION`.
- `OBJECT_EVIDENCE`.
- `MACRO_DETAIL`.
- `REACTION_RESULT`.

Do not generate a sequence of generic landscapes when the narration discusses a tool, action, person, food, body detail, or result. Prefer literal evidence over metaphor. For abstract narration, show the concrete person, object, process, place, or consequence being discussed.

## Composition-safe prompting

Full image:

- Target 16:9.
- Place key evidence within the center-safe 80% so the slow zoom cannot crop it.
- Allow useful environmental context.

Split-right image:

- Target 8:9 where practical.
- Place the key subject centrally in the right panel.
- Avoid important objects at extreme edges.
- Prefer a close or medium evidence view because only half the final frame is available.

The published style can refine these instructions but cannot reverse them.

## Documentary examples

Historical establishing image:

```text
A misty Appalachian ridge farm at warm late-summer dusk in 1937,
terraced vegetable rows below a weathered farmhouse and barn, ordinary
working land rather than a fantasy landscape, wide observational establishing
view, available golden-hour light, realistic fog, weathered timber and rocky
soil, true-to-life earth colors, authentic documentary photography, filmed
on location, believable period detail, natural imperfections, no visible
text or modern objects, absolutely photorealistic, no AI look.
```

Close demonstration:

```text
Close observational view of weathered hands holding a garden hoe in one hand
and a battered coffee can of turnip seed in the other, heavy tomato vines
behind them in an Appalachian mountain garden, worn work clothes and naturally
imperfect tools, late-afternoon available light, realistic red-clay soil and
skin texture, candid stock-footage frame, practical documentary camera,
true-to-life color and soft contrast, no glossy polish, no visible text,
absolutely photorealistic, no AI look.
```

## Reference-derived custom styles

The normal MVP does not pass reference images to Mage-Flow-Turbo and does not train a LoRA. Runware Gemini analyzes references once into a text profile; DeepSeek and the code-side compiler then use that profile. This is the simplest fast, low-cost implementation, but it is not a promise of pixel-identical style cloning.

`GATE_STYLE_002` must test at least five substantially different style packs using identical neutral content fixtures. If prompt-only profiles cannot reproduce a distinctive style reliably, pause and present the results before adding Style LoRA training, a reference-conditioned model, or another generator.

## Prompt and image rejection

Reject or revise a prompt that:

- Invents a different subject than the narration.
- Uses a symbolic metaphor when literal evidence exists.
- Contradicts the pinned style or mixes incompatible media accidentally.
- Requests text, labels, UI, logos, branded products, watermarks, or graphics.
- Ignores historically or geographically important context.
- Copies a reference person, exact place, logo, watermark, character, or other content merely because it recurred in the style references.

An image passes when a viewer can hear the phrase and immediately understand why the image is on screen, and the image clearly belongs to the selected style. For the documentary default, it must also look plausibly photographed; mild grain, uneven exposure, ordinary composition, and contextual clutter can help. Any malformed anatomy, pseudo-text, copied logo, unrelated scenery, or accidental style mismatch fails.
