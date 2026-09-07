import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  renderGlobalCompletionBaselineSql,
  renderPostMigrationCompletionBaselineSql,
  renderPreMutationCompletionBaselineSql,
  validateCompletionBaselineReceipt,
  validateGlobalCompletionBaselineReceipt,
} from "./read-durable-completion-baseline.mjs";

const accountId = "00000000-0000-4000-8000-000000000901";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

test("pre-mutation baseline is one transactionally read-only tenant query with no mutation", () => {
  const sql = renderPreMutationCompletionBaselineSql({
    accountId,
    workspaceId,
    maximumMicroUsd: 15_500_000,
  });
  assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/u);
  assert.match(sql, /owner_type='PROJECT_REVISION'/u);
  assert.match(sql, /greatest\(open_reservation,reported_unsettled\)/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|CALL)\b/iu);
  assert.match(sql, /COMMIT;$/u);
});

test("post-migration baseline invokes only the exact SECURITY DEFINER read", () => {
  const sql = renderPostMigrationCompletionBaselineSql({
    accountId,
    workspaceId,
    maximumMicroUsd: 15_500_000,
  });
  assert.match(sql, /videoforge_read_hosted_v209_completion_baseline/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|CALL)\b/iu);
});

test("global baseline is a conservative owner-only read with no tenant or mutation dependency", () => {
  const sql = renderGlobalCompletionBaselineSql(15_500_000);
  assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/u);
  assert.match(sql, /event\.owner_type='PROJECT_REVISION'/u);
  assert.match(sql, /count\(DISTINCT account_id\)/u);
  assert.match(sql, /greatest\(open_reservation,reported_unsettled\)/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|CALL)\b/iu);
  assert.match(sql, /COMMIT;$/u);
});

test("global baseline receipt binds the all-tenant conservative cap and self hash", () => {
  const unsigned = {
    schemaVersion: "videoforge.v2-09-global-completion-baseline/v1",
    accountCount: 1,
    workspaceCount: 1,
    attemptCount: 2,
    settledNetMicroUsd: 400000,
    openReservationMicroUsd: 300000,
    reportedUnsettledMicroUsd: 0,
    completionBaselineMicroUsd: 700000,
    maximumCompletionBaselineMicroUsd: 15500000,
    derivation: "ALL_PROJECT_ATTEMPTS_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE",
    observedAt: "2026-09-07T00:00:00.000Z",
  };
  const receipt = {
    ...unsigned,
    receiptSha256: `sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`,
  };
  assert.equal(
    validateGlobalCompletionBaselineReceipt(receipt, 15_500_000).completionBaselineMicroUsd,
    700000,
  );
  assert.throws(
    () => validateGlobalCompletionBaselineReceipt({ ...receipt, accountCount: 2 }, 15_500_000),
    /HASH_INVALID/u,
  );
});

test("baseline receipt validation binds exact tenant, integer micros, cap, and self hash", () => {
  const unsigned = {
    schemaVersion: "videoforge.v2-09-completion-baseline/v1",
    accountId,
    workspaceId,
    attemptCount: 1,
    settledNetMicroUsd: 400000,
    openReservationMicroUsd: 300000,
    reportedUnsettledMicroUsd: 0,
    completionBaselineMicroUsd: 700000,
    maximumCompletionBaselineMicroUsd: 15500000,
    derivation: "GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE",
    observedAt: "2026-09-07T00:00:00.000Z",
  };
  const receipt = {
    ...unsigned,
    receiptSha256: `sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`,
  };
  assert.equal(
    validateCompletionBaselineReceipt(receipt, {
      accountId,
      workspaceId,
      maximumMicroUsd: 15_500_000,
    }).completionBaselineMicroUsd,
    700000,
  );
  assert.throws(
    () =>
      validateCompletionBaselineReceipt(
        { ...receipt, completionBaselineMicroUsd: 700001 },
        { accountId, workspaceId, maximumMicroUsd: 15_500_000 },
      ),
    /HASH_INVALID/u,
  );
});
