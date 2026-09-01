import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_URL = "https://api.runware.ai/v1";
const MODEL_ALIAS = "deepseek-v4-flash";
const MODEL = "deepseek:v4@flash";
const PUBLIC_PROVIDER_NAME = "DeepSeek-V4-Flash-0731";
const TASK_CAP_USD = 1;
const RUN_CAP_USD = 0.02;
const PROJECT_TITLE = "Harvest Water Without Pumps";

const sceneSeeds = [
  [
    "farmer checks cracked soil beside a dry irrigation channel",
    ["farmer", "cracked soil", "irrigation channel"],
  ],
  ["hands fit a clay pot beneath a roof downpipe", ["hands", "clay pot", "downpipe"]],
  ["rainwater flows from a tin roof into a covered barrel", ["rainwater", "tin roof", "barrel"]],
  [
    "shopkeeper compares two transparent water samples in daylight",
    ["shopkeeper", "water samples", "daylight"],
  ],
  ["family washes leafy vegetables at an outdoor basin", ["family", "leafy vegetables", "basin"]],
  ["worker clears silt from a stone drainage trench", ["worker", "silt", "drainage trench"]],
  ["close hands test a simple valve on a black hose", ["hands", "valve", "black hose"]],
  [
    "wide hillside shows contour trenches after light rain",
    ["hillside", "contour trenches", "rain"],
  ],
];

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
];

export function buildScenes() {
  return styles.flatMap(([, style], batchIndex) =>
    sceneSeeds.map(([phrase, requiredTerms], sceneIndex) => ({
      scene_id: `scene_${String(batchIndex * 8 + sceneIndex + 1).padStart(2, "0")}`,
      phrase,
      required_terms: requiredTerms,
      in_image_shot_role: sceneIndex % 3 === 0 ? "FULL_IMAGE" : "SPLIT_RIGHT_IMAGE",
      style_probe: style,
    })),
  );
}

export function buildRequest(batchIndex, previousContinuity = "none") {
  const batchScenes = buildScenes().slice(batchIndex * 8, batchIndex * 8 + 8);
  const [styleId, styleGuidance] = styles[batchIndex];
  const titleLabel = "Project title:";
  const userContent = [
    `${titleLabel} ${PROJECT_TITLE}`,
    `Batch: batch_${batchIndex + 1}`,
    `Previous continuity: ${previousContinuity}`,
    `Style ${styleId}: ${styleGuidance}`,
    "Required anchor rule: copy every required_terms string verbatim into its scene's image_prompt.",
    `Scenes: ${JSON.stringify(batchScenes.map(({ style_probe: _styleProbe, ...scene }) => scene))}`,
  ].join("\n");
  if (userContent.split(titleLabel).length !== 2) throw new Error("Project title must occur once");

  const ids = batchScenes.map((scene) => scene.scene_id);
  return {
    taskType: "textInference",
    taskUUID: randomUUID(),
    model: MODEL,
    outputFormat: "json",
    deliveryMethod: "sync",
    includeCost: true,
    includeUsage: true,
    jsonSchema: {
      name: "videoforge_image_prompt_batch",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["batch_id", "style_id", "continuity", "items"],
        properties: {
          batch_id: { const: `batch_${batchIndex + 1}` },
          style_id: { const: styleId },
          continuity: { type: "string", minLength: 1, maxLength: 240 },
          items: {
            type: "array",
            minItems: 8,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["scene_id", "in_image_shot_role", "image_prompt", "style_treatment"],
              properties: {
                scene_id: { type: "string", enum: ids },
                in_image_shot_role: { type: "string", enum: ["FULL_IMAGE", "SPLIT_RIGHT_IMAGE"] },
                image_prompt: { type: "string", minLength: 30, maxLength: 500 },
                style_treatment: { type: "string", minLength: 3, maxLength: 160 },
              },
            },
          },
        },
      },
    },
    settings: {
      systemPrompt: [
        "Write concise literal still-image prompts for VideoForge.",
        "Return every scene ID exactly once and echo in_image_shot_role unchanged.",
        "Never select composition or timeline roles.",
        "Depict the supplied phrase without new factual claims.",
        "Every image_prompt MUST include every required_terms string verbatim; do not paraphrase, singularize, pluralize, or reorder words inside a required term.",
        "Use style guidance as treatment, not subject matter.",
        "Never request visible text, captions, titles, logos, watermarks, borders, graphics, diagrams, or motion graphics.",
        "Keep people and materials realistic. Output only strict schema JSON.",
      ].join(" "),
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 2500,
      thinkingLevel: "off",
    },
    messages: [{ role: "user", content: userContent }],
  };
}

const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function fetchModelIdentity(apiKey) {
  const taskUUID = randomUUID();
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        taskType: "modelSearch",
        taskUUID,
        search: MODEL_ALIAS,
        visibility: "public",
        limit: 20,
      },
    ]),
    signal: AbortSignal.timeout(30_000),
  });
  const bodyText = await response.text();
  const body = JSON.parse(bodyText);
  if (!response.ok || body.errors)
    throw new Error(`Runware model identity lookup failed: HTTP ${response.status}`);
  const data = body.data?.find((item) => item.taskUUID === taskUUID);
  const matches = (data?.results ?? []).filter(
    (item) => item.air === MODEL && item.name === PUBLIC_PROVIDER_NAME,
  );
  if (matches.length !== 1) {
    throw new Error("Runware model identity lookup did not return one exact canonical match");
  }
  const match = matches[0];
  return {
    task_uuid: taskUUID,
    response_sha256: sha256(bodyText),
    air: match.air,
    name: match.name,
    version: match.version ?? null,
    category: match.category ?? null,
    architecture: match.architecture ?? null,
    source: match.source ?? null,
    capabilities: Array.isArray(match.capabilities) ? match.capabilities : [],
    private: match.private ?? null,
    exact_canonical_match: true,
  };
}

function validateBatch(request, data) {
  const parsed = typeof data.text === "string" ? JSON.parse(data.text) : data.text;
  const expected = JSON.parse(request.messages[0].content.split("Scenes: ")[1]);
  const expectedById = new Map(expected.map((scene) => [scene.scene_id, scene]));
  const ids = parsed.items.map((item) => item.scene_id);
  const forbidden =
    /\b(?:caption|title|logo|watermark|border|infographic|diagram|motion graphic|visible text)\b/iu;
  const checks = parsed.items.map((item) => {
    const scene = expectedById.get(item.scene_id);
    return {
      scene_id: item.scene_id,
      role_unchanged: scene?.in_image_shot_role === item.in_image_shot_role,
      literal_terms_present:
        scene?.required_terms.every((term) => item.image_prompt.toLowerCase().includes(term)) ??
        false,
      forbidden_request_absent: !forbidden.test(item.image_prompt),
      prompt_sha256: sha256(item.image_prompt),
      style_treatment_sha256: sha256(item.style_treatment),
    };
  });
  return {
    output: parsed,
    exact_ids:
      ids.length === expected.length &&
      new Set(ids).size === expected.length &&
      ids.every((id) => expectedById.has(id)),
    checks,
  };
}

export async function runQualification({ apiKey, outputPath, priorSpendUsd = 0 }) {
  if (!apiKey || apiKey.length < 20) throw new Error("RUNWARE_API_KEY missing or invalid");
  if (!Number.isFinite(priorSpendUsd) || priorSpendUsd < 0)
    throw new Error("Prior task spend must be a non-negative number");
  if (priorSpendUsd + RUN_CAP_USD > TASK_CAP_USD)
    throw new Error("Remaining task cap cannot reserve this qualification run");
  const modelIdentity = await fetchModelIdentity(apiKey);
  let totalCostUsd = 0;
  let previousContinuity = "none";
  const batches = [];

  for (let batchIndex = 0; batchIndex < styles.length; batchIndex += 1) {
    if (totalCostUsd >= RUN_CAP_USD)
      throw new Error("Qualification run cap exhausted before dispatch");
    const request = buildRequest(batchIndex, previousContinuity);
    const started = performance.now();
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify([request]),
      signal: AbortSignal.timeout(120_000),
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);
    if (!response.ok || body.errors) {
      const safeErrors = Array.isArray(body.errors)
        ? body.errors.map(({ code, message, parameter, taskUUID }) => ({
            code,
            message,
            parameter,
            taskUUID,
          }))
        : [];
      throw new Error(
        `Runware request failed: HTTP ${response.status} ${JSON.stringify(safeErrors)}`,
      );
    }
    const data = body.data?.find((item) => item.taskUUID === request.taskUUID);
    if (!data) throw new Error("Runware response missing matching taskUUID");
    const validated = validateBatch(request, data);
    const cost = Number(data.cost);
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Runware response missing valid cost");
    totalCostUsd += cost;
    if (totalCostUsd > RUN_CAP_USD || priorSpendUsd + totalCostUsd > TASK_CAP_USD)
      throw new Error("Runware cost exceeded cap");
    previousContinuity = validated.output.continuity;
    batches.push({
      batch_id: `batch_${batchIndex + 1}`,
      style_id: styles[batchIndex][0],
      task_uuid: request.taskUUID,
      request_sha256: sha256(JSON.stringify(request)),
      response_sha256: sha256(bodyText),
      response_fields: Object.keys(data).sort(),
      returned_model: data.model ?? null,
      returned_model_version: data.modelVersion ?? data.model_version ?? null,
      returned_fingerprint:
        data.systemFingerprint ?? data.system_fingerprint ?? data.fingerprint ?? null,
      finish_reason: data.finishReason,
      usage: data.usage,
      cost_usd: cost,
      latency_ms: Math.round(performance.now() - started),
      exact_ids: validated.exact_ids,
      checks: validated.checks,
      continuity_sha256: sha256(validated.output.continuity),
    });
  }

  const allChecks = batches.flatMap((batch) => batch.checks);
  const immutableIdentityReturned = modelIdentity.exact_canonical_match;
  const evidence = {
    schema_version: "videoforge.deepseek-qualification/v1",
    task_id: "VF-3-01",
    gate_id: "GATE_LLM_001",
    checked_at: new Date().toISOString(),
    provider: "Runware",
    requested_model_alias: MODEL_ALIAS,
    requested_model: MODEL,
    public_provider_name: PUBLIC_PROVIDER_NAME,
    model_identity: modelIdentity,
    task_cap_usd: TASK_CAP_USD,
    run_cap_usd: RUN_CAP_USD,
    prior_attempt_spend_usd: priorSpendUsd,
    external_spend_usd: totalCostUsd,
    cumulative_task_spend_usd: priorSpendUsd + totalCostUsd,
    scene_count: allChecks.length,
    style_count: styles.length,
    batches,
    criteria: {
      strict_schema_and_exact_ids: batches.every((batch) => batch.exact_ids),
      roles_unchanged: allChecks.every((check) => check.role_unchanged),
      literal_terms_present: allChecks.every((check) => check.literal_terms_present),
      forbidden_requests_absent: allChecks.every((check) => check.forbidden_request_absent),
      cost_below_30_min_equivalent_target: totalCostUsd < RUN_CAP_USD,
      immutable_live_identity_returned: immutableIdentityReturned,
    },
    gate_result:
      immutableIdentityReturned &&
      batches.every((batch) => batch.exact_ids) &&
      allChecks.every(
        (check) =>
          check.role_unchanged && check.literal_terms_present && check.forbidden_request_absent,
      )
        ? "PASS"
        : "OPEN",
    identity_note: immutableIdentityReturned
      ? "Live Runware modelSearch resolved the canonical AIR deepseek:v4@flash to the public model DeepSeek-V4-Flash-0731; generation requests pinned that AIR. Native generation responses did not echo model/version fields."
      : "Live provider evidence did not establish an exact canonical model identity.",
    secrets_recorded: false,
  };
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return evidence;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputArg = process.argv.indexOf("--output");
  const rawOutputPath = outputArg >= 0 ? process.argv[outputArg + 1] : null;
  const priorSpendArg = process.argv.indexOf("--prior-spend-usd");
  const priorSpendUsd = priorSpendArg >= 0 ? Number(process.argv[priorSpendArg + 1]) : 0;
  const outputPath = rawOutputPath
    ? isAbsolute(rawOutputPath)
      ? rawOutputPath
      : resolve(process.env.INIT_CWD ?? process.cwd(), rawOutputPath)
    : null;
  if (!outputPath) throw new Error("Usage: qualify:deepseek -- --output <path>");
  const evidence = await runQualification({
    apiKey: process.env.RUNWARE_API_KEY,
    outputPath,
    priorSpendUsd,
  });
  process.stdout.write(
    JSON.stringify({
      gate_result: evidence.gate_result,
      scene_count: evidence.scene_count,
      style_count: evidence.style_count,
      external_spend_usd: evidence.external_spend_usd,
    }),
  );
}
