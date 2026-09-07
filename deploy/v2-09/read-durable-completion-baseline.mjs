import { createHash } from "node:crypto";

export const COMPLETION_BASELINE_SCHEMA = "videoforge.v2-09-completion-baseline/v1";
export const MAXIMUM_COMPLETION_BASELINE_MICRO_USD = 15_500_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;

function fail(code) {
  throw new Error(code);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function checkedScope(accountId, workspaceId, maximumMicroUsd) {
  if (
    !UUID.test(accountId ?? "") ||
    !UUID.test(workspaceId ?? "") ||
    !Number.isSafeInteger(maximumMicroUsd) ||
    maximumMicroUsd < 0 ||
    maximumMicroUsd > MAXIMUM_COMPLETION_BASELINE_MICRO_USD
  )
    fail("V2_09_COMPLETION_BASELINE_INPUT_INVALID");
  return { accountId, workspaceId, maximumMicroUsd };
}

// Used exactly once with the already-protected owner database URL before any live mutation. The
// caller supplies the URL to its psql environment; this module neither opens nor returns it.
export function renderPreMutationCompletionBaselineSql(input) {
  const { accountId, workspaceId, maximumMicroUsd } = checkedScope(
    input?.accountId,
    input?.workspaceId,
    input?.maximumMicroUsd,
  );
  return `BEGIN TRANSACTION READ ONLY;
SET LOCAL videoforge.account_id='${accountId}';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.workspaces row WHERE row.account_id='${accountId}'::uuid
    AND row.id='${workspaceId}'::uuid AND row.status='ACTIVE') THEN
    RAISE EXCEPTION 'V2-09 completion baseline scope invalid' USING ERRCODE='42501';
  END IF;
END $$;
WITH per_attempt AS (
  SELECT event.attempt_id,
    coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='RESERVED'),0)::bigint reserved,
    coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='REPORTED'),0)::bigint reported,
    coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='SETTLED'),0)::bigint settled,
    coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='RELEASED'),0)::bigint released,
    coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='REFUNDED'),0)::bigint refunded
  FROM public.cost_events event WHERE event.account_id='${accountId}'::uuid
    AND event.workspace_id='${workspaceId}'::uuid AND event.owner_type='PROJECT_REVISION'
  GROUP BY event.attempt_id
), exposure AS (
  SELECT *,settled-refunded settled_net,greatest(reserved-settled-released,0) open_reservation,
    greatest(reported-settled,0) reported_unsettled FROM per_attempt
), totals AS (
  SELECT coalesce(sum(settled_net),0)::bigint settled_net,
    coalesce(sum(open_reservation),0)::bigint open_reservation,
    coalesce(sum(reported_unsettled),0)::bigint reported_unsettled,
    coalesce(sum(settled_net+greatest(open_reservation,reported_unsettled)),0)::bigint baseline,
    count(*)::bigint attempt_count,bool_and(settled_net>=0) ledger_valid FROM exposure
), document AS (
  SELECT jsonb_build_object('schemaVersion','${COMPLETION_BASELINE_SCHEMA}',
    'accountId','${accountId}'::uuid,'workspaceId','${workspaceId}'::uuid,
    'attemptCount',attempt_count,'settledNetMicroUsd',settled_net,
    'openReservationMicroUsd',open_reservation,'reportedUnsettledMicroUsd',reported_unsettled,
    'completionBaselineMicroUsd',baseline,'maximumCompletionBaselineMicroUsd',${maximumMicroUsd},
    'derivation','GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE',
    'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) value
  FROM totals WHERE coalesce(ledger_valid,true) AND baseline<=${maximumMicroUsd}
)
SELECT value||jsonb_build_object('receiptSha256','sha256:'||encode(sha256(convert_to(
  public.videoforge_canonical_jsonb(value),'UTF8')),'hex')) FROM document;
COMMIT;`;
}

export function renderPostMigrationCompletionBaselineSql(input) {
  const { accountId, workspaceId, maximumMicroUsd } = checkedScope(
    input?.accountId,
    input?.workspaceId,
    input?.maximumMicroUsd,
  );
  return `BEGIN TRANSACTION READ ONLY;
SET LOCAL videoforge.account_id='${accountId}';
SELECT public.videoforge_read_hosted_v209_completion_baseline(
  '${accountId}'::uuid,'${workspaceId}'::uuid,${maximumMicroUsd}::bigint);
COMMIT;`;
}

export function validateCompletionBaselineReceipt(value, expected) {
  const scope = checkedScope(expected?.accountId, expected?.workspaceId, expected?.maximumMicroUsd);
  const keys = [
    "accountId",
    "attemptCount",
    "completionBaselineMicroUsd",
    "derivation",
    "maximumCompletionBaselineMicroUsd",
    "observedAt",
    "openReservationMicroUsd",
    "receiptSha256",
    "reportedUnsettledMicroUsd",
    "schemaVersion",
    "settledNetMicroUsd",
    "workspaceId",
  ];
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys.sort().join(",") ||
    value.schemaVersion !== COMPLETION_BASELINE_SCHEMA ||
    value.accountId !== scope.accountId ||
    value.workspaceId !== scope.workspaceId ||
    value.maximumCompletionBaselineMicroUsd !== scope.maximumMicroUsd ||
    value.derivation !==
      "GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE" ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(value.observedAt ?? "") ||
    !HASH.test(value.receiptSha256 ?? "") ||
    [
      "attemptCount",
      "settledNetMicroUsd",
      "openReservationMicroUsd",
      "reportedUnsettledMicroUsd",
      "completionBaselineMicroUsd",
    ].some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0) ||
    value.completionBaselineMicroUsd > scope.maximumMicroUsd
  )
    fail("V2_09_COMPLETION_BASELINE_RECEIPT_INVALID");
  const unsigned = { ...value };
  delete unsigned.receiptSha256;
  if (sha256(canonical(unsigned)) !== value.receiptSha256)
    fail("V2_09_COMPLETION_BASELINE_RECEIPT_HASH_INVALID");
  return Object.freeze({ ...value });
}
