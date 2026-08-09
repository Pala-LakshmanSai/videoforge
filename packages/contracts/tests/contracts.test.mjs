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
  validateContract,
} from "../dist/src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(packageRoot, "generated/fixtures");

const fixtureCases = [
  ["avatarProfileVersion", "avatar_profile_version.valid.json", true],
  ["createProjectRequest", "create_project_request.valid.json", true],
  ["createProjectRequest", "create_project_request.invalid.inline_avatar.json", false],
  ["createProjectRequest", "create_project_request.invalid.over_budget.json", false],
  ["projectRevisionConfig", "project_revision_config.valid.json", true],
  ["projectRevisionConfig", "project_revision_config.invalid.compatibility_mismatch.json", false],
  ["timelinePlan", "timeline_plan.valid.json", true],
  ["resolvedRenderManifest", "resolved_render_manifest.valid.json", true],
  ["resolvedRenderManifest", "resolved_render_manifest.invalid.avatar_profile_crop.json", false],
  ["productionManifest", "production_manifest.valid.json", true],
  ["imageStyleProfile", "default_image_style_v1.json", true],
];

const loadFixture = async (filename) =>
  JSON.parse(await readFile(path.join(fixtureRoot, filename), "utf8"));

test("all canonical schemas compile and expose stable IDs", () => {
  assert.equal(contractNames.length, 8);
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
    assert.equal(result.success, expected);

    if (expected) {
      assert.equal(assertContract(contractName, fixture), fixture);
      assert.equal(canonicalContractZodSchemas[contractName].safeParse(fixture).success, true);
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
