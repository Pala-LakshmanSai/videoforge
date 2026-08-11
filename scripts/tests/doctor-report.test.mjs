import assert from "node:assert/strict";
import test from "node:test";

import { createDoctorReport, doctorReportSchemaVersion } from "../doctor-report.mjs";

test("doctor JSON is deterministic, categorized, and contains names but no values", () => {
  const checks = [
    { id: "version.node", category: "version", name: "Node", ok: true, detail: "v22" },
    {
      id: "environment.provider_free",
      category: "provider_free",
      name: "Provider-free environment",
      ok: false,
      detail: "unset before development: RUNPOD_API_KEY",
    },
  ];
  const report = createDoctorReport(checks, ["RUNPOD_API_KEY"]);
  assert.equal(report.schemaVersion, doctorReportSchemaVersion);
  assert.equal(report.ok, false);
  assert.equal(report.providerCallsAuthorized, false);
  assert.deepEqual(report.environment, {
    expectedNames: ["RUNPOD_API_KEY"],
    valuesIncluded: false,
  });
  assert.equal(JSON.stringify(report).includes("private-value"), false);
  assert.deepEqual(report.checks, checks);
});
