#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const fail = (message) => {
  throw new Error(`V2-06 rollback snapshot: ${message}`);
};

const deploymentRowsFrom = (value) => {
  const rows = Array.isArray(value) ? value : value?.deployments;
  if (!Array.isArray(rows)) fail("deployment JSON must be an array or contain deployments[]");
  return rows;
};

const deploymentsFrom = (value) =>
  deploymentRowsFrom(value).flatMap((row) =>
    Array.isArray(row?.versions) && row.versions.length > 0 ? row.versions : [row],
  );

const versionId = (row) => row?.version_id ?? row?.versionId ?? row?.id ?? null;
const isActive = (row) =>
  row?.is_active === true ||
  row?.active === true ||
  Number(row?.traffic_percent) === 100 ||
  Number(row?.percentage) === 100;

const uniqueVersions = (value) => {
  const deploymentRows = deploymentRowsFrom(value);
  const latestDeployment = deploymentRows.reduce((latest, row) => {
    if (!latest) return row;
    const latestCreated = Date.parse(latest?.created_on ?? latest?.createdAt ?? "");
    const rowCreated = Date.parse(row?.created_on ?? row?.createdAt ?? "");
    if (Number.isFinite(rowCreated) && (!Number.isFinite(latestCreated) || rowCreated > latestCreated))
      return row;
    return latest;
  }, null);
  const versions = new Map();
  for (const deployment of deploymentRows) {
    const rows =
      Array.isArray(deployment?.versions) && deployment.versions.length > 0
        ? deployment.versions
        : [deployment];
    for (const row of rows) {
      const id = versionId(row);
      if (typeof id !== "string" || id.length === 0) continue;
      const explicitlyActive = row?.is_active === true || row?.active === true;
      const latestTrafficActive =
        deployment === latestDeployment &&
        (Number(row?.traffic_percent) > 0 || Number(row?.percentage) > 0);
      versions.set(id, { row, active: explicitlyActive || latestTrafficActive });
    }
  }
  return [...versions.entries()].map(([id, value]) => ({ id, ...value }));
};

const readSnapshot = async (file) => uniqueVersions(JSON.parse(await readFile(file, "utf8")));

const assertBeforeRollback = (versions, expectedActiveVersionId, priorVersionId) => {
  if (!expectedActiveVersionId || !priorVersionId || expectedActiveVersionId === priorVersionId)
    fail("expected active and prior Worker versions must be distinct and non-empty");
  const active = versions.filter((version) => version.active);
  if (active.length !== 1 || active[0].id !== expectedActiveVersionId)
    fail("before-list does not show exactly the recorded current active Worker version");
  if (!versions.some((version) => version.id === priorVersionId))
    fail("the approved prior Worker version is not present in the before-list");
  return { active_version_id: active[0].id, prior_version_id: priorVersionId };
};

const assertAfterRollback = (versions, priorVersionId) => {
  if (!priorVersionId) fail("prior Worker version is required");
  const active = versions.filter((version) => version.active);
  if (active.length !== 1 || active[0].id !== priorVersionId)
    fail("after-list does not show exactly the approved prior Worker version as active");
  return { active_version_id: active[0].id };
};

const main = async () => {
  const [phase, file, expectedActiveVersionId, priorVersionId] = process.argv.slice(2);
  if (!phase || !file || !priorVersionId || (phase === "before" && !expectedActiveVersionId))
    fail("usage: verify-rollback-deployment.mjs <before|after> <json> [expected-active] <prior>");
  const versions = await readSnapshot(file);
  const result =
    phase === "before"
      ? assertBeforeRollback(versions, expectedActiveVersionId, priorVersionId)
      : phase === "after"
        ? assertAfterRollback(versions, priorVersionId)
        : fail("phase must be before or after");
  console.log(JSON.stringify(result));
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  assertAfterRollback,
  assertBeforeRollback,
  deploymentsFrom,
  isActive,
  readSnapshot,
  versionId,
};
