#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_PHASE_CAPS,
  validateFullLiveUserApproval,
} from "./validate-full-live-approval.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const CONFIRMATION = "CONSUME_EXACT_V2_13_FULL_LIVE_AUTHORITY";
const PHASES = Object.freeze([
  ["publication", 0],
  ["mage_qualification", 4.5],
  ["soulx_qualification", 1],
  ["max_one_control_plane_and_guarded_activation", 0],
  ["v2_09_short_hosted_project", 2],
  ["v2_10_operator_free_ranga_pilot", 2],
  ["v2_11_two_concurrent_owned_projects", 4],
  ["v2_12_long_output", 2],
  ["v2_13_final_two_lane_smoke", 2],
  ["cleanup_and_reconciliation", 0],
]);
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V2_13_FULL_LIVE_ORCHESTRATION_${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes);
  } catch {
    fail(`${code}_JSON_INVALID`);
  }
};
const finiteUsd = (value, code) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(code);
  return Math.round(value * 1_000_000) / 1_000_000;
};
const phaseMap = () =>
  Object.fromEntries(
    PHASES.map(([name, cap]) => [
      name,
      { cap_usd: cap, state: "PENDING", reserved_usd: 0, settled_usd: 0, work: {} },
    ]),
  );

function validateOuterAuthority({ proposalBytes, approvalBytes, authorityBytes }) {
  const authority = parse(authorityBytes, "AUTHORITY");
  const combined = authority.combined_execution_authority;
  if (
    authority.schema_version !== "videoforge.v2-13-full-live-approved-authority/v1" ||
    !AUTHORITY_ID.test(authority.authority_id ?? "") ||
    authority.status !== "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS" ||
    authority.single_use !== true ||
    authority.consumed !== false ||
    combined?.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    combined.redispatch_authorized !== false ||
    [
      "execute_authorized",
      "credential_access_authorized",
      "database_mutation_authorized",
      "cloudflare_secret_mutation_authorized",
      "deployment_authorized",
      "provider_calls_authorized",
      "provider_mutations_authorized",
      "gpu_use_authorized",
      "external_runpod_spend_authorized",
    ].some((key) => combined[key] !== true) ||
    combined.new_volume_authorized !== false ||
    combined.new_paid_retained_resource_authorized !== false ||
    combined.recurring_plan_change_authorized !== false ||
    JSON.stringify(authority.phase_caps_usd) !== JSON.stringify(EXPECTED_PHASE_CAPS)
  )
    fail("AUTHORITY_CONTRACT");
  const validated = validateFullLiveUserApproval({
    proposalBytes,
    approvalBytes,
    expectedProposalSha256: authority.lineage?.proposal_sha256,
    expectedProposalRecordCommit: authority.lineage?.proposal_record_commit,
    expectedReleaseSourceCommit: authority.lineage?.release_source_commit,
  });
  if (
    authority.authority_id !== validated.authorityId ||
    authority.lineage?.user_approval_sha256 !== validated.approvalSha256 ||
    authority.approved_at !== validated.approvedAt ||
    authority.expires_at !== validated.expiresAt ||
    validated.proposalSchema !== "videoforge.v2-13-full-live-completion-proposal/v3" ||
    authority.github_release_ref?.status !== "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION" ||
    authority.github_release_ref?.ref_creation_authorized_by_approved_proposal !== true ||
    authority.github_release_ref?.exact_tag_name !== "videoforge-v2-13-release-20260826-v3" ||
    authority.github_release_ref?.exact_target_commit !== validated.releaseSourceCommit ||
    authority.github_release_ref?.external_action_taken !== false
  )
    fail("AUTHORITY_LINEAGE");
  for (const [pathKey, hashKey] of [
    ["approval_schema_validator_path", "approval_schema_validator_sha256"],
    ["orchestration_tool_path", "orchestration_tool_sha256"],
    ["guarded_activation_path", "guarded_activation_sha256"],
    ["full_live_executor_path", "full_live_executor_sha256"],
  ]) {
    const sourcePath = authority.outer_orchestration?.[pathKey];
    const expected = authority.outer_orchestration?.[hashKey];
    if (
      typeof sourcePath !== "string" ||
      sourcePath.startsWith("/") ||
      sourcePath.includes("..") ||
      !HASH.test(expected ?? "") ||
      sha256(readFileSync(resolve(ROOT, sourcePath))) !== expected
    )
      fail("ORCHESTRATION_SOURCE_DRIFT");
  }
  if (
    authority.outer_orchestration?.consumption_record_created !== false ||
    authority.outer_orchestration?.consumption_record_sha256 !== null ||
    authority.outer_orchestration?.consumption_required_before_credentials_or_external_calls !==
      true ||
    authority.outer_orchestration
      ?.state_updates_require_exact_prior_state_sha256_and_exclusive_lock !== true ||
    authority.outer_orchestration?.phase_order_caps_cumulative_cap_and_no_redispatch_enforced !==
      true
  )
    fail("ORCHESTRATION_SEAL");
  return { authority, validated };
}

function assertTrustedTime(approvedAt, expiresAt, trustedIso) {
  const trusted = Date.parse(trustedIso ?? "");
  if (Number.isNaN(trusted) || trusted < Date.parse(approvedAt) || trusted > Date.parse(expiresAt))
    fail("TRUSTED_TIME");
}

function readAuthenticatedTrustedTime() {
  const output = execFileSync(
    "curl",
    [
      "--disable",
      "--silent",
      "--show-error",
      "--head",
      "--proto",
      "=https",
      "--tlsv1.2",
      "--connect-timeout",
      "5",
      "--max-time",
      "10",
      "https://api.github.com/rate_limit",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        NO_PROXY: "*",
        no_proxy: "*",
      },
      timeout: 12_000,
    },
  );
  const dates = output
    .split(/\r?\n/u)
    .filter((line) => /^date:/iu.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
  if (dates.length !== 1 || Number.isNaN(Date.parse(dates[0]))) fail("TRUSTED_TIME_READBACK");
  return new Date(Date.parse(dates[0])).toISOString();
}

function initialConsumptionRecord(authority, authorityBytes, validated) {
  return {
    schema_version: "videoforge.v2-13-full-live-orchestration-consumption/v1",
    authority_id: authority.authority_id,
    authority_sha256: sha256(authorityBytes),
    proposal_sha256: validated.proposalSha256,
    approval_sha256: validated.approvalSha256,
    proposal_record_commit: validated.proposalRecordCommit,
    authority_record_commit: validated.authorityRecordCommit,
    approval_record_path: validated.approvalRecordPath,
    authority_record_path: validated.authorityRecordPath,
    release_source_commit: validated.releaseSourceCommit,
    full_live_executor_path: authority.outer_orchestration.full_live_executor_path,
    full_live_executor_sha256: authority.outer_orchestration.full_live_executor_sha256,
    approved_at: validated.approvedAt,
    expires_at: validated.expiresAt,
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    maximum_cumulative_finite_runpod_spend_usd: 17.5,
    total_reserved_usd: 0,
    total_settled_usd: 0,
    no_redispatch: true,
    current_phase_index: 0,
    phases: phaseMap(),
    event_ids: [],
    work_ids: [],
    release_ref: {
      exact_tag_name: "videoforge-v2-13-release-20260826-v3",
      exact_target_commit: validated.releaseSourceCommit,
      state: "AUTHORIZED_PENDING_CREATION",
      verification_event_id: null,
    },
    cleanup_proof: null,
    terminal: null,
  };
}

function validateState(state) {
  if (
    state?.schema_version !== "videoforge.v2-13-full-live-orchestration-consumption/v1" ||
    !AUTHORITY_ID.test(state.authority_id ?? "") ||
    !HASH.test(state.authority_sha256 ?? "") ||
    !/^[0-9a-f]{40}$/u.test(state.authority_record_commit ?? "") ||
    ![state.approval_record_path, state.authority_record_path].every(
      (path) =>
        typeof path === "string" &&
        path !== "" &&
        !path.startsWith("/") &&
        !path.split("/").includes(".."),
    ) ||
    state.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    state.full_live_executor_path !== "deploy/v2-13/full-live-executor.mjs" ||
    state.full_live_executor_sha256 !==
      "sha256:0e0f3526330ea2bb151750ba70456b5d8d81ae47755db4df9fbae5cec4267c97" ||
    state.no_redispatch !== true ||
    ![
      "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
      "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
      "CONSUMED_SINGLE_EXECUTION_COMPLETE",
      "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
    ].includes(state.state) ||
    JSON.stringify(Object.keys(state.phases ?? {})) !== JSON.stringify(PHASES.map(([name]) => name))
  )
    fail("STATE_CONTRACT");
  for (const [name, cap] of PHASES) {
    const phase = state.phases[name];
    if (
      phase.cap_usd !== cap ||
      !["PENDING", "ACTIVE", "COMPLETE", "FAILED_CLEANUP_ONLY"].includes(phase.state) ||
      finiteUsd(phase.reserved_usd, "PHASE_RESERVED") > cap ||
      finiteUsd(phase.settled_usd, "PHASE_SETTLED") > phase.reserved_usd ||
      phase.work === null ||
      typeof phase.work !== "object" ||
      Array.isArray(phase.work)
    )
      fail("PHASE_CONTRACT");
    for (const [workId, work] of Object.entries(phase.work)) {
      if (
        !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(workId) ||
        !["AUTHORIZED_ONCE_NOT_REDISPATCHABLE", "SETTLED_TERMINAL"].includes(work?.state) ||
        finiteUsd(work.reservation_usd, "WORK_RESERVATION") > cap ||
        !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(work.authorization_event_id ?? "") ||
        !state.event_ids.includes(work.authorization_event_id) ||
        (work.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" && work.settled_usd !== null) ||
        (work.state === "SETTLED_TERMINAL" &&
          (finiteUsd(work.settled_usd, "WORK_SETTLEMENT") > work.reservation_usd ||
            !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(work.settlement_event_id ?? "") ||
            !state.event_ids.includes(work.settlement_event_id)))
      )
        fail("WORK_CONTRACT");
    }
  }
  const actualWorkIds = Object.values(state.phases).flatMap((phase) => Object.keys(phase.work));
  const reserved = finiteUsd(
    Object.values(state.phases).reduce((sum, phase) => sum + phase.reserved_usd, 0),
    "TOTAL_RESERVED",
  );
  const settled = finiteUsd(
    Object.values(state.phases).reduce((sum, phase) => sum + phase.settled_usd, 0),
    "TOTAL_SETTLED",
  );
  if (
    reserved !== state.total_reserved_usd ||
    settled !== state.total_settled_usd ||
    reserved > 17.5 ||
    settled > reserved ||
    new Set(state.event_ids).size !== state.event_ids.length ||
    new Set(state.work_ids).size !== state.work_ids.length ||
    JSON.stringify([...actualWorkIds].sort()) !== JSON.stringify([...state.work_ids].sort()) ||
    state.release_ref?.exact_tag_name !== "videoforge-v2-13-release-20260826-v3" ||
    state.release_ref?.exact_target_commit !== state.release_source_commit ||
    !["AUTHORIZED_PENDING_CREATION", "VERIFIED_EXACT_REMOTE"].includes(state.release_ref?.state)
  )
    fail("CUMULATIVE_CAP_OR_EVENT_REPLAY");
  if (
    state.release_ref.state === "VERIFIED_EXACT_REMOTE" &&
    !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(state.release_ref.verification_event_id ?? "")
  )
    fail("RELEASE_REF_EVENT");
  if (state.cleanup_proof !== null) {
    if (
      JSON.stringify(Object.keys(state.cleanup_proof)) !==
        JSON.stringify([
          "zero_worker_proof_sha256",
          "billing_proof_sha256",
          "resource_reconciliation_sha256",
          "max_one_restoration_sha256",
          "cleanup_work_ids",
          "event_id",
        ]) ||
      ![
        state.cleanup_proof.zero_worker_proof_sha256,
        state.cleanup_proof.billing_proof_sha256,
        state.cleanup_proof.resource_reconciliation_sha256,
        state.cleanup_proof.max_one_restoration_sha256,
      ].every((value) => HASH.test(value ?? "")) ||
      !Array.isArray(state.cleanup_proof.cleanup_work_ids) ||
      JSON.stringify(state.cleanup_proof.cleanup_work_ids) !==
        JSON.stringify(Object.keys(state.phases.cleanup_and_reconciliation.work).sort()) ||
      !state.event_ids.includes(state.cleanup_proof.event_id)
    )
      fail("CLEANUP_PROOF_CONTRACT");
  }
  const phaseStates = PHASES.map(([name]) => state.phases[name].state);
  if (state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") {
    if (
      !Number.isInteger(state.current_phase_index) ||
      state.current_phase_index < 0 ||
      state.current_phase_index >= PHASES.length ||
      state.terminal !== null ||
      phaseStates.slice(0, state.current_phase_index).some((value) => value !== "COMPLETE") ||
      !["PENDING", "ACTIVE"].includes(phaseStates[state.current_phase_index]) ||
      phaseStates.slice(state.current_phase_index + 1).some((value) => value !== "PENDING")
    )
      fail("IN_PROGRESS_STATE_INVARIANT");
  } else if (state.state === "CONSUMED_SINGLE_EXECUTION_COMPLETE") {
    if (
      state.current_phase_index !== PHASES.length ||
      phaseStates.some((value) => value !== "COMPLETE") ||
      state.cleanup_proof === null ||
      state.terminal !== "CLEANUP_ZERO_WORKER_BILLING_RECONCILED"
    )
      fail("COMPLETE_STATE_INVARIANT");
  } else if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY") {
    if (
      state.current_phase_index !== PHASES.length - 1 ||
      state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
      state.terminal !== null ||
      !/^[A-Z0-9][A-Z0-9_]{7,127}$/u.test(state.cleanup_failure_code ?? "")
    )
      fail("CLEANUP_ONLY_STATE_INVARIANT");
  } else if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY") {
    if (
      state.current_phase_index !== PHASES.length ||
      state.phases.cleanup_and_reconciliation.state !== "COMPLETE" ||
      state.cleanup_proof === null ||
      state.terminal !== "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_MAX_ONE" ||
      !/^[A-Z0-9][A-Z0-9_]{7,127}$/u.test(state.cleanup_failure_code ?? "")
    )
      fail("CLEANUP_COMPLETE_STATE_INVARIANT");
  }
  return state;
}

function requireInProgress(state) {
  if (state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") fail("NOT_IN_PROGRESS");
}

function beginPhase(state, phaseName) {
  validateState(state);
  requireInProgress(state);
  const index = PHASES.findIndex(([name]) => name === phaseName);
  if (index < 0 || index !== state.current_phase_index) fail("PHASE_ORDER");
  if (index > 0 && state.phases[PHASES[index - 1][0]].state !== "COMPLETE")
    fail("PREVIOUS_PHASE_INCOMPLETE");
  if (state.phases[phaseName].state !== "PENDING") fail("PHASE_ALREADY_STARTED");
  state.phases[phaseName].state = "ACTIVE";
  return validateState(state);
}

function authorizeWork(state, { phaseName, workId, reservationUsd, eventId }) {
  validateState(state);
  requireInProgress(state);
  const phase = state.phases[phaseName];
  const reserve = finiteUsd(reservationUsd, "RESERVATION_INVALID");
  if (phase?.state !== "ACTIVE") fail("PHASE_NOT_ACTIVE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(workId ?? "")) fail("WORK_ID");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (state.event_ids.includes(eventId) || state.work_ids.includes(workId) || phase.work[workId])
    fail("REDISPATCH_OR_EVENT_REPLAY");
  if (phase.reserved_usd + reserve > phase.cap_usd || state.total_reserved_usd + reserve > 17.5)
    fail("CAP_EXCEEDED");
  phase.work[workId] = {
    state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    reservation_usd: reserve,
    settled_usd: null,
    authorization_event_id: eventId,
  };
  phase.reserved_usd = finiteUsd(phase.reserved_usd + reserve, "PHASE_RESERVE_SUM");
  state.total_reserved_usd = finiteUsd(state.total_reserved_usd + reserve, "TOTAL_RESERVE_SUM");
  state.event_ids.push(eventId);
  state.work_ids.push(workId);
  return validateState(state);
}

function recordVerifiedReleaseRef(state, { tagName, targetCommit, eventId }) {
  validateState(state);
  requireInProgress(state);
  if (state.phases.publication.state !== "ACTIVE") fail("PUBLICATION_NOT_ACTIVE");
  if (
    state.release_ref.state !== "AUTHORIZED_PENDING_CREATION" ||
    tagName !== state.release_ref.exact_tag_name ||
    targetCommit !== state.release_ref.exact_target_commit ||
    !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "") ||
    state.event_ids.includes(eventId)
  )
    fail("RELEASE_REF_VERIFICATION");
  state.release_ref.state = "VERIFIED_EXACT_REMOTE";
  state.release_ref.verification_event_id = eventId;
  state.event_ids.push(eventId);
  return validateState(state);
}

function settleWork(state, { phaseName, workId, actualUsd, eventId }) {
  validateState(state);
  requireInProgress(state);
  const phase = state.phases[phaseName];
  const work = phase?.work?.[workId];
  const actual = finiteUsd(actualUsd, "ACTUAL_INVALID");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (phase?.state !== "ACTIVE" || work?.state !== "AUTHORIZED_ONCE_NOT_REDISPATCHABLE")
    fail("WORK_NOT_SETTLEABLE");
  if (actual > work.reservation_usd || state.event_ids.includes(eventId))
    fail("SETTLEMENT_OR_EVENT");
  work.state = "SETTLED_TERMINAL";
  work.settled_usd = actual;
  work.settlement_event_id = eventId;
  phase.settled_usd = finiteUsd(phase.settled_usd + actual, "PHASE_SETTLE_SUM");
  state.total_settled_usd = finiteUsd(state.total_settled_usd + actual, "TOTAL_SETTLE_SUM");
  state.event_ids.push(eventId);
  return validateState(state);
}

function completePhase(state, phaseName) {
  validateState(state);
  requireInProgress(state);
  const phase = state.phases[phaseName];
  if (phase?.state !== "ACTIVE") fail("PHASE_NOT_ACTIVE");
  if (Object.values(phase.work).some((work) => work.state !== "SETTLED_TERMINAL"))
    fail("WORK_UNSETTLED");
  if (phaseName === "publication" && state.release_ref.state !== "VERIFIED_EXACT_REMOTE")
    fail("RELEASE_REF_NOT_VERIFIED");
  if (phaseName === "cleanup_and_reconciliation" && state.cleanup_proof === null)
    fail("CLEANUP_PROOF_REQUIRED");
  phase.state = "COMPLETE";
  state.current_phase_index += 1;
  if (state.current_phase_index === PHASES.length) {
    state.state = "CONSUMED_SINGLE_EXECUTION_COMPLETE";
    state.terminal = "CLEANUP_ZERO_WORKER_BILLING_RECONCILED";
  }
  return validateState(state);
}

function enterCleanupOnly(state, { failureCode, eventId }) {
  validateState(state);
  if (state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") fail("NOT_IN_PROGRESS");
  if (!/^[A-Z0-9][A-Z0-9_]{7,127}$/u.test(failureCode ?? "")) fail("FAILURE_CODE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "") || state.event_ids.includes(eventId))
    fail("EVENT_ID");
  state.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
  const current = PHASES[state.current_phase_index]?.[0];
  if (current && state.phases[current].state !== "COMPLETE")
    state.phases[current].state = "FAILED_CLEANUP_ONLY";
  state.current_phase_index = PHASES.length - 1;
  state.phases.cleanup_and_reconciliation.state = "ACTIVE";
  state.cleanup_failure_code = failureCode;
  state.event_ids.push(eventId);
  return validateState(state);
}

function authorizeCleanupWork(state, { workId, eventId }) {
  validateState(state);
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    state.cleanup_proof !== null
  )
    fail("CLEANUP_NOT_ACTIVE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(workId ?? "")) fail("WORK_ID");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (state.work_ids.includes(workId) || state.event_ids.includes(eventId))
    fail("REDISPATCH_OR_EVENT_REPLAY");
  state.phases.cleanup_and_reconciliation.work[workId] = {
    state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    reservation_usd: 0,
    settled_usd: null,
    authorization_event_id: eventId,
  };
  state.work_ids.push(workId);
  state.event_ids.push(eventId);
  return validateState(state);
}

function settleCleanupWork(state, { workId, eventId }) {
  validateState(state);
  const work = state.phases.cleanup_and_reconciliation.work[workId];
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    work?.state !== "AUTHORIZED_ONCE_NOT_REDISPATCHABLE"
  )
    fail("CLEANUP_WORK_NOT_SETTLEABLE");
  if (!/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "")) fail("EVENT_ID");
  if (state.event_ids.includes(eventId)) fail("SETTLEMENT_OR_EVENT");
  work.state = "SETTLED_TERMINAL";
  work.settled_usd = 0;
  work.settlement_event_id = eventId;
  state.event_ids.push(eventId);
  return validateState(state);
}

function recordCleanupProof(
  state,
  { zeroWorkerProofSha256, billingProofSha256, resourceProofSha256, maxOneProofSha256, eventId },
) {
  validateState(state);
  if (
    !["CONSUMED_SINGLE_EXECUTION_IN_PROGRESS", "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY"].includes(
      state.state,
    ) ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE"
  )
    fail("CLEANUP_NOT_ACTIVE");
  if (state.cleanup_proof !== null) fail("CLEANUP_PROOF_REPLAY");
  if (
    Object.values(state.phases.cleanup_and_reconciliation.work).some(
      (work) => work.state !== "SETTLED_TERMINAL",
    )
  )
    fail("CLEANUP_WORK_UNSETTLED");
  if (
    ![zeroWorkerProofSha256, billingProofSha256, resourceProofSha256, maxOneProofSha256].every(
      (value) => HASH.test(value ?? ""),
    ) ||
    !/^[a-z0-9][a-z0-9._:-]{7,191}$/u.test(eventId ?? "") ||
    state.event_ids.includes(eventId)
  )
    fail("CLEANUP_PROOF");
  state.cleanup_proof = {
    zero_worker_proof_sha256: zeroWorkerProofSha256,
    billing_proof_sha256: billingProofSha256,
    resource_reconciliation_sha256: resourceProofSha256,
    max_one_restoration_sha256: maxOneProofSha256,
    cleanup_work_ids: Object.keys(state.phases.cleanup_and_reconciliation.work).sort(),
    event_id: eventId,
  };
  state.event_ids.push(eventId);
  return validateState(state);
}

function completeCleanupOnly(state) {
  validateState(state);
  if (
    state.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.phases.cleanup_and_reconciliation.state !== "ACTIVE" ||
    state.cleanup_proof === null
  )
    fail("CLEANUP_INCOMPLETE");
  state.phases.cleanup_and_reconciliation.state = "COMPLETE";
  state.current_phase_index = PHASES.length;
  state.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY";
  state.terminal = "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_MAX_ONE";
  return validateState(state);
}

function parseArgs(argv) {
  const args = new Map();
  let command = "dry-run";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      [
        "--consume",
        "--begin-phase",
        "--record-release-ref",
        "--authorize-work",
        "--settle-work",
        "--complete-phase",
        "--enter-cleanup-only",
        "--authorize-cleanup-work",
        "--settle-cleanup-work",
        "--record-cleanup-proof",
        "--complete-cleanup-only",
      ].includes(token)
    ) {
      if (command !== "dry-run") fail("ONE_COMMAND_ONLY");
      command = token.slice(2);
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= argv.length) fail("ARGUMENTS");
    args.set(token.slice(2), argv[index + 1]);
    index += 1;
  }
  return { command, args };
}

function exactPath(path, type, permissions, label) {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    (type === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
    (metadata.mode & 0o777) !== permissions
  )
    fail(`${label}_MODE_OR_TYPE`);
}

function writeExclusive(path, value) {
  exactPath(dirname(path), "directory", 0o700, "STATE_DIRECTORY");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  exactPath(path, "file", 0o600, "STATE_FILE");
}

function updateState(path, expectedSha256, operation) {
  exactPath(dirname(path), "directory", 0o700, "STATE_DIRECTORY");
  exactPath(path, "file", 0o600, "STATE_FILE");
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    fail("STATE_LOCKED");
  }
  try {
    const bytes = readFileSync(path);
    if (sha256(bytes) !== expectedSha256) fail("STATE_SHA256");
    const next = operation(parse(bytes, "STATE"));
    const temporary = `${path}.next`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    exactPath(temporary, "file", 0o600, "NEXT_STATE_FILE");
    renameSync(temporary, path);
    exactPath(path, "file", 0o600, "STATE_FILE");
    return { state: next, sha256: sha256(readFileSync(path)) };
  } finally {
    if (lock !== undefined) closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}

function trustedCommitLineage(validated) {
  const parent = execFileSync("git", ["rev-parse", `${validated.proposalRecordCommit}^`], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (parent !== validated.releaseSourceCommit) fail("COMMIT_LINEAGE");
}

function validateAuthorityRecordCommit({
  authority,
  approvalBytes,
  authorityBytes,
  authorityRecordCommit,
}) {
  if (!/^[0-9a-f]{40}$/u.test(authorityRecordCommit ?? ""))
    fail("AUTHORITY_RECORD_COMMIT");
  const approvalPath = authority.lineage?.user_approval_path;
  const authorityPath = authority.lineage?.authority_record_path;
  for (const [path, code] of [
    [approvalPath, "APPROVAL_RECORD_PATH"],
    [authorityPath, "AUTHORITY_RECORD_PATH"],
  ])
    if (
      typeof path !== "string" ||
      path === "" ||
      path.startsWith("/") ||
      path.split("/").includes("..")
    )
      fail(code);
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim();
  if (
    git("rev-parse", `${authorityRecordCommit}^{commit}`) !== authorityRecordCommit ||
    git("rev-parse", `${authorityRecordCommit}^`) !== authority.lineage.proposal_record_commit
  )
    fail("AUTHORITY_RECORD_LINEAGE");
  const committedApproval = execFileSync(
    "git",
    ["show", `${authorityRecordCommit}:${approvalPath}`],
    { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 },
  );
  const committedAuthority = execFileSync(
    "git",
    ["show", `${authorityRecordCommit}:${authorityPath}`],
    { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 },
  );
  if (sha256(committedApproval) !== sha256(approvalBytes)) fail("APPROVAL_RECORD_TREE_BYTES");
  if (sha256(committedAuthority) !== sha256(authorityBytes)) fail("AUTHORITY_RECORD_TREE_BYTES");
  return Object.freeze({
    authorityRecordCommit,
    approvalRecordPath: approvalPath,
    authorityRecordPath: authorityPath,
  });
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "dry-run") {
    process.stdout.write(
      `${JSON.stringify({ state: "NO_AUTHORITY_CONSUMED", external_calls: 0, mutations: 0, gpu_use: 0, spend_usd: 0 })}\n`,
    );
    return;
  }
  if (command === "consume") {
    if (args.get("confirm") !== CONFIRMATION) fail("CONFIRMATION");
    const proposalBytes = readFileSync(resolve(args.get("proposal-file")));
    const approvalBytes = readFileSync(resolve(args.get("approval-file")));
    const authorityBytes = readFileSync(resolve(args.get("authority-file")));
    const { authority, validated } = validateOuterAuthority({
      proposalBytes,
      approvalBytes,
      authorityBytes,
    });
    const record = validateAuthorityRecordCommit({
      authority,
      approvalBytes,
      authorityBytes,
      authorityRecordCommit: args.get("authority-record-commit"),
    });
    if (args.has("trusted-iso")) fail("CALLER_TRUSTED_TIME_FORBIDDEN");
    assertTrustedTime(
      validated.approvedAt,
      validated.expiresAt,
      readAuthenticatedTrustedTime(),
    );
    trustedCommitLineage(validated);
    const state = validateState(
      initialConsumptionRecord(authority, authorityBytes, { ...validated, ...record }),
    );
    const statePath = resolve(args.get("state-file"));
    writeExclusive(statePath, state);
    process.stdout.write(
      `${JSON.stringify({ state_file: statePath, state_sha256: sha256(readFileSync(statePath)), authority_id: authority.authority_id })}\n`,
    );
    return;
  }
  const statePath = resolve(args.get("state-file"));
  const expected = args.get("expected-state-sha256");
  if (!HASH.test(expected ?? "")) fail("EXPECTED_STATE_SHA256");
  const phaseName = args.get("phase");
  let operation;
  if (command === "begin-phase") operation = (state) => beginPhase(state, phaseName);
  else if (command === "record-release-ref")
    operation = (state) =>
      recordVerifiedReleaseRef(state, {
        tagName: args.get("tag-name"),
        targetCommit: args.get("target-commit"),
        eventId: args.get("event-id"),
      });
  else if (command === "authorize-work")
    operation = (state) =>
      authorizeWork(state, {
        phaseName,
        workId: args.get("work-id"),
        reservationUsd: Number(args.get("reservation-usd")),
        eventId: args.get("event-id"),
      });
  else if (command === "settle-work")
    operation = (state) =>
      settleWork(state, {
        phaseName,
        workId: args.get("work-id"),
        actualUsd: Number(args.get("actual-usd")),
        eventId: args.get("event-id"),
      });
  else if (command === "complete-phase") operation = (state) => completePhase(state, phaseName);
  else if (command === "enter-cleanup-only")
    operation = (state) =>
      enterCleanupOnly(state, {
        failureCode: args.get("failure-code"),
        eventId: args.get("event-id"),
      });
  else if (command === "authorize-cleanup-work")
    operation = (state) =>
      authorizeCleanupWork(state, {
        workId: args.get("work-id"),
        eventId: args.get("event-id"),
      });
  else if (command === "settle-cleanup-work")
    operation = (state) =>
      settleCleanupWork(state, {
        workId: args.get("work-id"),
        eventId: args.get("event-id"),
      });
  else if (command === "record-cleanup-proof")
    operation = (state) =>
      recordCleanupProof(state, {
        zeroWorkerProofSha256: args.get("zero-worker-proof-sha256"),
        billingProofSha256: args.get("billing-proof-sha256"),
        resourceProofSha256: args.get("resource-proof-sha256"),
        maxOneProofSha256: args.get("max-one-proof-sha256"),
        eventId: args.get("event-id"),
      });
  else if (command === "complete-cleanup-only") operation = completeCleanupOnly;
  else fail("COMMAND");
  const result = updateState(statePath, expected, operation);
  process.stdout.write(
    `${JSON.stringify({ state_file: statePath, state_sha256: result.sha256, state: result.state.state })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  authorizeCleanupWork,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  CONFIRMATION,
  enterCleanupOnly,
  initialConsumptionRecord,
  PHASES,
  recordCleanupProof,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  updateState,
  validateOuterAuthority,
  validateAuthorityRecordCommit,
  validateState,
  readAuthenticatedTrustedTime,
  writeExclusive,
};
