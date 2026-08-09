import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertContract,
  canonicalContractZodSchemas,
  ContractValidationError,
  contractNames,
  contractSchemaIds,
  contractValidators,
  createProjectRequestSchema,
  validateOutputRuleKeywords,
  validateContract,
} from "../dist/src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(packageRoot, "generated/fixtures");

const fixtureCases = [
  ["avatarProfileVersion", "avatar_profile_version.valid.json", true],
  ["createProjectRequest", "create_project_request.valid.json", true],
  ["createProjectRequest", "create_project_request.invalid.inline_avatar.json", false],
  ["createProjectRequest", "create_project_request.invalid.over_budget.json", false],
  ["orchestrationState", "orchestration_state.valid.json", true],
  ["orchestrationState", "orchestration_state.invalid.unhashed_outbox.json", false],
  ["projectRevisionConfig", "project_revision_config.valid.json", true],
  ["projectRevisionConfig", "project_revision_config.invalid.compatibility_mismatch.json", false],
  ["timelinePlan", "timeline_plan.valid.json", true],
  ["resolvedRenderManifest", "resolved_render_manifest.valid.json", true],
  ["resolvedRenderManifest", "resolved_render_manifest.invalid.avatar_profile_crop.json", false],
  ["productionManifest", "production_manifest.valid.json", true],
  ["imageStyleProfile", "default_image_style_v1.json", true],
  ["workerJobEnvelope", "worker_job_envelope.valid.json", true],
  ["workerJobEnvelope", "worker_job_envelope.invalid.shell_args.json", false],
];

const loadFixture = async (filename) =>
  JSON.parse(await readFile(path.join(fixtureRoot, filename), "utf8"));

test("all canonical schemas compile and expose stable IDs", () => {
  assert.equal(contractNames.length, 10);
  for (const contractName of contractNames) {
    assert.match(contractSchemaIds[contractName], /^https:\/\/videoforge\.local\/schemas\//);
    assert.equal(typeof contractValidators[contractName], "function");
  }
});

test("the fixture matrix covers every synchronized JSON fixture", async () => {
  const actual = (await readdir(fixtureRoot)).filter((name) => name.endsWith(".json")).sort();
  const expected = fixtureCases.map(([, filename]) => filename).sort();
  assert.deepEqual(actual, expected);
});

for (const [contractName, filename, expected] of fixtureCases) {
  test(`${filename} expected=${expected}`, async () => {
    const fixture = await loadFixture(filename);
    const result = validateContract(contractName, fixture);
    const canonicalZodResult = canonicalContractZodSchemas[contractName].safeParse(fixture);
    assert.equal(result.success, expected);
    assert.equal(
      canonicalZodResult.success,
      expected,
      `${filename} must have identical Ajv and canonical Zod results`,
    );

    if (expected) {
      assert.equal(assertContract(contractName, fixture), fixture);
    } else {
      assert.ok(!result.success && result.issues.length > 0);
      assert.throws(() => assertContract(contractName, fixture), ContractValidationError);
      if (contractName === "createProjectRequest") {
        assert.equal(createProjectRequestSchema.safeParse(fixture).success, false);
      }
    }
  });
}

test("typed Create Project validation enforces conditional keywords", async () => {
  const fixture = await loadFixture("create_project_request.valid.json");
  const invalid = {
    ...fixture,
    apply_extra_prompt_keywords: true,
    extra_prompt_keywords: "   ",
  };
  assert.equal(validateContract("createProjectRequest", invalid).success, false);
  assert.equal(createProjectRequestSchema.safeParse(invalid).success, false);
});

test("output-rule keywords accept explicit negative constraints", () => {
  const accepted = [
    "ultra realistic, no AI look",
    "no logo, no text, hard documentary light",
    "do not include a logo",
    "never show visible text",
    "show a farmer reading, without visible text",
    "watermark-free observational photograph",
    "avoid decorative borders and lower thirds",
    "free of title cards",
    "no subtitles",
    "without infographics",
    "do not include an infographic with title text",
    "exclude motion graphics",
    "avoid stylized transitions",
  ];

  for (const keywords of accepted) {
    const result = validateOutputRuleKeywords(keywords);
    assert.equal(result.valid, true, `${keywords}: ${JSON.stringify(result.conflicts)}`);
    assert.deepEqual(result.conflicts, []);
  }
});

test("output-rule keywords block positive requests for every forbidden family", () => {
  const blocked = [
    ["add a logo", "LOGO"],
    ["place a watermark in the corner", "WATERMARK"],
    ["add an infographic", "INFOGRAPHIC"],
    ["with decorative borders", "BORDER"],
    ["prominent title text", "TEXT"],
    ["add subtitles", "TEXT"],
    ["use a lower third", "LOWER_THIRD"],
    ["open on a title card", "TITLE_CARD"],
    ["include motion graphics", "MOTION_GRAPHICS"],
    ["include decorative graphics", "DECORATIVE_GRAPHICS"],
    ["use smooth transitions", "TRANSITION"],
    ["no logo but add title text", "TEXT"],
    ["avoid decorative borders; add a logo", "LOGO"],
  ];

  for (const [keywords, expectedRule] of blocked) {
    const result = validateOutputRuleKeywords(keywords);
    assert.equal(result.valid, false, keywords);
    assert.ok(
      result.conflicts.some(({ rule }) => rule === expectedRule),
      keywords,
    );
  }
});

test("output-rule keywords reject hidden control characters", () => {
  const result = validateOutputRuleKeywords("documentary\u0000photo");
  assert.equal(result.valid, false);
  assert.equal(result.conflicts[0]?.label, "control characters");
});
