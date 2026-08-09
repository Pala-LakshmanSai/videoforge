#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;

const evidenceDir = path.resolve(__dirname, "../evidence");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(evidenceDir, relativePath), "utf8"));

const contractIndex = readJson("contract-index.v1.json");
const schemaDocuments = contractIndex.contracts.map(({schema}) => readJson(schema));
const schemasByName = new Map(
  contractIndex.contracts.map((contract, index) => [contract.name, schemaDocuments[index]]),
);
const ajv = new Ajv2020({allErrors: true, strict: true});
for (const schema of schemaDocuments) ajv.addSchema(schema);

const cases = contractIndex.contracts.flatMap(({name, fixtures}) =>
  fixtures.map(({path: fixturePath, expected}) => [name, fixturePath, expected]),
);

let failed = false;
for (const [contractName, fixturePath, expected] of cases) {
  const schema = schemasByName.get(contractName);
  if (!schema) throw new Error(`No loaded schema for ${contractName}`);
  const validate = ajv.getSchema(schema.$id);
  const actual = validate(readJson(fixturePath));
  const passed = actual === expected;
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${fixturePath} expected=${expected} actual=${actual}\n`);
  if (!passed) {
    failed = true;
    process.stderr.write(`${JSON.stringify(validate.errors, null, 2)}\n`);
  }
}

const analyzerSchema = schemasByName.get("imageStyleAnalyzerOutput");
const analyzerCompiled = Boolean(ajv.getSchema(analyzerSchema.$id));
process.stdout.write(`${analyzerCompiled ? "PASS" : "FAIL"} image_style_analyzer_output.schema.json compile\n`);
if (!analyzerCompiled) failed = true;

process.exit(failed ? 1 : 0);
