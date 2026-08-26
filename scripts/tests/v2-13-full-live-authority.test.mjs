import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  authorizeCleanupWork,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  enterCleanupOnly,
  initialConsumptionRecord,
  recordCleanupProof,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  updateState,
  validateOuterAuthority,
  validateState,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";
import { validateFullLiveUserApproval } from "../../deploy/v2-13/validate-full-live-approval.mjs";

const directory =
  "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-candidate";
const proposalBytes = readFileSync(`${directory}/combined-live-proposal.json`);
const approvalBytes = readFileSync(`${directory}/user-approval.json`);
const authorityBytes = readFileSync(`${directory}/approved-authority.json`);
const proposalSha256 = "sha256:f2d183e7668152c25b54b3844cc340058ecb5f59dec58689d6eb229328bcae32";
const proposalRecordCommit = "e3bdabc161c60e5334c4055b5636b7fd768a86df";
const releaseSourceCommit = "407dc070f4b83bd78b1d4aa1cb546ec63c91f32f";
const v3ReleaseSourceCommit = "7e561fd8fdb4e6281650c09a5a7859849f473a00";
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function v3Fixture() {
  const v3Directory =
    "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate";
  const v3Proposal = JSON.parse(readFileSync(`${v3Directory}/combined-live-proposal.json`));
  v3Proposal.proposal_status = "PENDING_FRESH_EXACT_USER_APPROVAL";
  v3Proposal.sealing.sealed_for_exact_user_approval = true;
  v3Proposal.sealing.current_bytes_are_approval_ineligible = false;
  v3Proposal.source.release_source_commit = v3ReleaseSourceCommit;
  delete v3Proposal.source.base_source_commit_before_semantic_tag_repair;
  v3Proposal.immutable_github_release_ref_request.exact_target_commit = v3ReleaseSourceCommit;
  const v3ProposalBytes = Buffer.from(`${JSON.stringify(v3Proposal, null, 2)}\n`);
  const v3ProposalSha256 = hash(v3ProposalBytes);
  const v3Commit = "f".repeat(40);
  const approval = structuredClone(JSON.parse(approvalBytes));
  approval.schema_version = "videoforge.v2-13-full-live-user-approval/v2";
  approval.authority_id = "v2-13-v3-test-authority-0001";
  approval.proposal = {
    path: `${v3Directory}/combined-live-proposal.json`,
    sha256: v3ProposalSha256,
    proposal_record_commit: v3Commit,
    release_source_commit: v3ReleaseSourceCommit,
  };
  approval.approval.immutable_github_release_ref = {
    creation_authorized: true,
    exact_tag_name: "videoforge-v2-13-release-20260826-v3",
    exact_target_commit: v3ReleaseSourceCommit,
    tag_kind: "LIGHTWEIGHT",
    maximum_new_refs: 1,
    force_update_authorized: false,
    delete_or_retarget_authorized: false,
    other_ref_creation_authorized: false,
  };
  approval.approval.database_roles = {
    exact_runtime_role: "videoforge_hosted_runtime",
    exact_reconciler_role: "videoforge_hosted_reconciler",
    roles_must_be_fresh_absent_distinct_login_noinherit_hardened: true,
  };
  approval.statement = `I approve ${v3ProposalSha256} at ${v3Commit} with USD 17.50, USD 7 per month, no fallback, tag videoforge-v2-13-release-20260826-v3, and roles videoforge_hosted_runtime and videoforge_hosted_reconciler.`;
  const v3ApprovalBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`);
  const authority = structuredClone(JSON.parse(authorityBytes));
  authority.authority_id = approval.authority_id;
  authority.status = "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS";
  authority.approved_at = approval.approved_at;
  authority.expires_at = approval.expires_at;
  authority.lineage = {
    proposal_path: approval.proposal.path,
    proposal_sha256: v3ProposalSha256,
    proposal_record_commit: v3Commit,
    release_source_commit: v3ReleaseSourceCommit,
    user_approval_path: `${v3Directory}/user-approval.json`,
    user_approval_sha256: hash(v3ApprovalBytes),
  };
  authority.combined_execution_authority.maximum_cumulative_finite_runpod_spend_usd = 17.5;
  for (const key of [
    "execute_authorized",
    "credential_access_authorized",
    "database_mutation_authorized",
    "cloudflare_secret_mutation_authorized",
    "deployment_authorized",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "gpu_use_authorized",
    "external_runpod_spend_authorized",
  ])
    authority.combined_execution_authority[key] = true;
  authority.github_release_ref = {
    required_for_workflow_dispatch: true,
    exact_target_commit: v3ReleaseSourceCommit,
    exact_tag_name: "videoforge-v2-13-release-20260826-v3",
    ref_creation_authorized_by_approved_proposal: true,
    status: "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION",
    external_action_taken: false,
  };
  authority.outer_orchestration.approval_schema_validator_sha256 = hash(
    readFileSync("deploy/v2-13/validate-full-live-approval.mjs"),
  );
  authority.outer_orchestration.orchestration_tool_sha256 = hash(
    readFileSync("deploy/v2-13/full-live-orchestration-authority.mjs"),
  );
  authority.outer_orchestration.guarded_activation_sha256 = hash(
    readFileSync("deploy/v2-13/guarded-activation.mjs"),
  );
  authority.outer_orchestration.full_live_executor_sha256 = hash(
    readFileSync("deploy/v2-13/full-live-executor.mjs"),
  );
  return {
    approvalBytes: v3ApprovalBytes,
    authority,
    authorityBytes: Buffer.from(`${JSON.stringify(authority, null, 2)}\n`),
    proposalBytes: v3ProposalBytes,
  };
}

function freshStateFixture() {
  const fixture = v3Fixture();
  const { validated } = validateOuterAuthority(fixture);
  return initialConsumptionRecord(fixture.authority, fixture.authorityBytes, validated);
}

test("exact full-live approval schema binds proposal, caps, GPU, retention, and expiry", () => {
  const result = validateFullLiveUserApproval({
    proposalBytes,
    approvalBytes,
    expectedProposalSha256: proposalSha256,
    expectedProposalRecordCommit: proposalRecordCommit,
    expectedReleaseSourceCommit: releaseSourceCommit,
  });
  assert.equal(result.authorityId, "v2-13-full-live-20260826-033320z-e3bdabc");
  assert.equal(result.maximumCumulativeFiniteRunpodSpendUsd, 17.5);
  assert.equal(
    Object.values(result.phaseCapsUsd).reduce((sum, value) => sum + value, 0),
    17.5,
  );
});

test("outer authority rejects the superseded unconsumed authority", () => {
  assert.throws(
    () => validateOuterAuthority({ proposalBytes, approvalBytes, authorityBytes }),
    /AUTHORITY_CONTRACT/u,
  );
});

test("outer authority accepts a future exact V3 ref-authorized record", () => {
  const fixture = v3Fixture();
  const result = validateOuterAuthority(fixture);
  assert.equal(
    result.validated.proposalSchema,
    "videoforge.v2-13-full-live-completion-proposal/v3",
  );
  assert.equal(result.validated.exactRuntimeRole, "videoforge_hosted_runtime");
  assert.equal(
    result.authority.github_release_ref.status,
    "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION",
  );
});

test("single-use ledger enforces phase order, phase caps, cumulative cap, and no redispatch", () => {
  const state = freshStateFixture();
  beginPhase(state, "publication");
  assert.throws(() => completePhase(state, "publication"), /RELEASE_REF_NOT_VERIFIED/u);
  recordVerifiedReleaseRef(state, {
    tagName: "videoforge-v2-13-release-20260826-v3",
    targetCommit: v3ReleaseSourceCommit,
    eventId: "release-ref-readback-event-0001",
  });
  completePhase(state, "publication");
  beginPhase(state, "mage_qualification");
  authorizeWork(state, {
    phaseName: "mage_qualification",
    workId: "mage-qualification-work-0001",
    reservationUsd: 4.5,
    eventId: "mage-reserve-event-0001",
  });
  assert.throws(
    () =>
      authorizeWork(state, {
        phaseName: "mage_qualification",
        workId: "mage-qualification-work-0001",
        reservationUsd: 0,
        eventId: "mage-reserve-event-0002",
      }),
    /REDISPATCH_OR_EVENT_REPLAY/u,
  );
  assert.throws(
    () =>
      authorizeWork(state, {
        phaseName: "mage_qualification",
        workId: "mage-qualification-work-0002",
        reservationUsd: 0.01,
        eventId: "mage-reserve-event-0003",
      }),
    /CAP_EXCEEDED/u,
  );
  settleWork(state, {
    phaseName: "mage_qualification",
    workId: "mage-qualification-work-0001",
    actualUsd: 1.25,
    eventId: "mage-settle-event-0001",
  });
  assert.throws(
    () =>
      settleWork(state, {
        phaseName: "mage_qualification",
        workId: "mage-qualification-work-0001",
        actualUsd: 1.25,
        eventId: "mage-settle-event-0002",
      }),
    /WORK_NOT_SETTLEABLE/u,
  );
  completePhase(state, "mage_qualification");
  beginPhase(state, "soulx_qualification");
  assert.throws(
    () =>
      authorizeWork(state, {
        phaseName: "soulx_qualification",
        workId: "mage-qualification-work-0001",
        reservationUsd: 1,
        eventId: "soulx-reserve-event-0001",
      }),
    /REDISPATCH_OR_EVENT_REPLAY/u,
  );
  assert.equal(validateState(state).total_reserved_usd, 4.5);
  assert.equal(validateState(state).total_settled_usd, 1.25);
  assert.throws(() => beginPhase(state, "v2_09_short_hosted_project"), /PHASE_ORDER/u);
});

test("failure is terminal cleanup-only and cannot reopen a paid phase", () => {
  const state = freshStateFixture();
  beginPhase(state, "publication");
  enterCleanupOnly(state, {
    failureCode: "RELEASE_REF_COLLISION",
    eventId: "cleanup-entry-event-0001",
  });
  assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
  assert.throws(() => beginPhase(state, "publication"), /NOT_IN_PROGRESS/u);
  assert.throws(() => completeCleanupOnly(state), /CLEANUP_INCOMPLETE/u);
  authorizeCleanupWork(state, {
    workId: "cleanup-zero-worker-readback-0001",
    eventId: "cleanup-authorize-event-0001",
  });
  assert.throws(
    () =>
      recordCleanupProof(state, {
        zeroWorkerProofSha256: `sha256:${"a".repeat(64)}`,
        billingProofSha256: `sha256:${"b".repeat(64)}`,
        resourceProofSha256: `sha256:${"c".repeat(64)}`,
        maxOneProofSha256: `sha256:${"d".repeat(64)}`,
        eventId: "cleanup-proof-too-early-0001",
      }),
    /CLEANUP_WORK_UNSETTLED/u,
  );
  settleCleanupWork(state, {
    workId: "cleanup-zero-worker-readback-0001",
    eventId: "cleanup-settle-event-0001",
  });
  assert.throws(
    () =>
      authorizeCleanupWork(state, {
        workId: "cleanup-zero-worker-readback-0001",
        eventId: "cleanup-authorize-replay-0001",
      }),
    /REDISPATCH_OR_EVENT_REPLAY/u,
  );
  recordCleanupProof(state, {
    zeroWorkerProofSha256: `sha256:${"a".repeat(64)}`,
    billingProofSha256: `sha256:${"b".repeat(64)}`,
    resourceProofSha256: `sha256:${"c".repeat(64)}`,
    maxOneProofSha256: `sha256:${"d".repeat(64)}`,
    eventId: "cleanup-proof-event-0001",
  });
  completeCleanupOnly(state);
  assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  assert.deepEqual(state.cleanup_proof.cleanup_work_ids, ["cleanup-zero-worker-readback-0001"]);
});

test("state storage requires mode-0700 real directory, mode-0600 file, and exact prior hash", () => {
  const state = freshStateFixture();
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-outer-state-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "state.json");
  try {
    writeExclusive(path, state);
    const before = hash(readFileSync(path));
    const updated = updateState(path, before, (value) => beginPhase(value, "publication"));
    assert.equal(updated.state.phases.publication.state, "ACTIVE");
    assert.throws(() => updateState(path, before, (value) => value), /STATE_SHA256/u);
    chmodSync(path, 0o644);
    assert.throws(
      () => updateState(path, updated.sha256, (value) => value),
      /STATE_FILE_MODE_OR_TYPE/u,
    );
    chmodSync(path, 0o600);
    const link = join(directory, "state-link.json");
    symlinkSync(path, link);
    assert.throws(
      () => updateState(link, updated.sha256, (value) => value),
      /STATE_FILE_MODE_OR_TYPE/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approval mutation fails exact schema validation", () => {
  const mutated = structuredClone(JSON.parse(approvalBytes));
  mutated.approval.phase_caps_usd.v2_13_final_two_lane_smoke = 2.01;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(mutated)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /CAPS_OR_SINGLE_USE/u,
  );
});

test("approval nested extras and missing execution fences fail closed", () => {
  const extra = structuredClone(JSON.parse(approvalBytes));
  extra.approval.gpu.unapproved = true;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(extra)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /NESTED_SCHEMA/u,
  );
  const missing = structuredClone(JSON.parse(approvalBytes));
  delete missing.execution_fences.no_redispatch;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(missing)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /NESTED_SCHEMA/u,
  );
});

test("forged terminal state is rejected and every normal mutation stays closed", () => {
  const fixture = v3Fixture();
  const validated = validateFullLiveUserApproval({
    proposalBytes: fixture.proposalBytes,
    approvalBytes: fixture.approvalBytes,
    expectedProposalSha256: hash(fixture.proposalBytes),
    expectedProposalRecordCommit: "f".repeat(40),
    expectedReleaseSourceCommit: v3ReleaseSourceCommit,
  });
  const forged = initialConsumptionRecord(fixture.authority, fixture.authorityBytes, validated);
  forged.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY";
  forged.terminal = "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_MAX_ONE";
  assert.throws(() => validateState(forged), /CLEANUP_COMPLETE_STATE_INVARIANT/u);
  assert.throws(() => beginPhase(forged, "publication"), /CLEANUP_COMPLETE_STATE_INVARIANT/u);

  const terminal = initialConsumptionRecord(fixture.authority, fixture.authorityBytes, validated);
  beginPhase(terminal, "publication");
  enterCleanupOnly(terminal, {
    failureCode: "RELEASE_REF_COLLISION",
    eventId: "cleanup-entry-event-terminal-0001",
  });
  recordCleanupProof(terminal, {
    zeroWorkerProofSha256: `sha256:${"a".repeat(64)}`,
    billingProofSha256: `sha256:${"b".repeat(64)}`,
    resourceProofSha256: `sha256:${"c".repeat(64)}`,
    maxOneProofSha256: `sha256:${"d".repeat(64)}`,
    eventId: "cleanup-proof-event-terminal-0001",
  });
  completeCleanupOnly(terminal);
  assert.throws(() => beginPhase(terminal, "publication"), /NOT_IN_PROGRESS/u);
  assert.throws(
    () =>
      authorizeWork(terminal, {
        phaseName: "cleanup_and_reconciliation",
        workId: "forged-terminal-work-0001",
        reservationUsd: 0,
        eventId: "forged-terminal-event-0001",
      }),
    /NOT_IN_PROGRESS/u,
  );
});
