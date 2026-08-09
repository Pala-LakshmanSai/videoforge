#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;

const evidenceDir = path.resolve(__dirname, "../evidence");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(evidenceDir, relativePath), "utf8"));

const schemaFiles = [
  "avatar_profile_version.schema.json",
  "create_project_request.schema.json",
  "image_style_profile.schema.json",
  "image_style_analyzer_output.schema.json",
  "orchestration_state.schema.json",
  "project_revision_config.schema.json",
  "timeline_plan.schema.json",
  "resolved_render_manifest.schema.json",
  "production_manifest.schema.json",
  "worker_job_envelope.schema.json",
];

const schemaDocuments = schemaFiles.map(readJson);
const ajv = new Ajv2020({allErrors: true, strict: true});
for (const schema of schemaDocuments) ajv.addSchema(schema);

const cases = [
  ["avatar-profile-version-v1.json", "fixtures/avatar_profile_version.valid.json", true],
  ["create-project-request-v2.json", "fixtures/create_project_request.valid.json", true],
  ["create-project-request-v2.json", "fixtures/create_project_request.invalid.inline_avatar.json", false],
  ["create-project-request-v2.json", "fixtures/create_project_request.invalid.over_budget.json", false],
  ["orchestration-state-v1.json", "fixtures/orchestration_state.valid.json", true],
  ["orchestration-state-v1.json", "fixtures/orchestration_state.invalid.unhashed_outbox.json", false],
  ["project-revision-config-v2.json", "fixtures/project_revision_config.valid.json", true],
  ["project-revision-config-v2.json", "fixtures/project_revision_config.invalid.compatibility_mismatch.json", false],
  ["timeline-plan-v1.json", "fixtures/timeline_plan.valid.json", true],
  ["resolved-render-manifest-v1.json", "fixtures/resolved_render_manifest.valid.json", true],
  ["resolved-render-manifest-v1.json", "fixtures/resolved_render_manifest.invalid.avatar_profile_crop.json", false],
  ["production-manifest-v2.json", "fixtures/production_manifest.valid.json", true],
  ["image-style-profile-v1.json", "default_image_style_v1.json", true],
  ["worker-job-envelope-v1.json", "fixtures/worker_job_envelope.valid.json", true],
  ["worker-job-envelope-v1.json", "fixtures/worker_job_envelope.invalid.shell_args.json", false],
];

let failed = false;
for (const [schemaTail, fixturePath, expected] of cases) {
  const schema = schemaDocuments.find(({ $id }) => $id.endsWith(schemaTail));
  if (!schema) throw new Error(`No loaded schema ends with ${schemaTail}`);
  const validate = ajv.getSchema(schema.$id);
  const actual = validate(readJson(fixturePath));
  const passed = actual === expected;
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${fixturePath} expected=${expected} actual=${actual}\n`);
  if (!passed) {
    failed = true;
    process.stderr.write(`${JSON.stringify(validate.errors, null, 2)}\n`);
  }
}

const analyzerSchema = readJson("image_style_analyzer_output.schema.json");
const analyzerCompiled = Boolean(ajv.getSchema(analyzerSchema.$id));
process.stdout.write(`${analyzerCompiled ? "PASS" : "FAIL"} image_style_analyzer_output.schema.json compile\n`);
if (!analyzerCompiled) failed = true;

process.exit(failed ? 1 : 0);
