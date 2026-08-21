// Historical V2-07 validators still verify immutable Attempt17-27 artifacts.
// These exact predicates permit only the current Attempt28 unapproved or
// separately authorized successor boundary without weakening historical hashes.

export const ATTEMPT28_PROPOSAL =
  "sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf";
export const ATTEMPT28_CONTROL = "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14";
export const ATTEMPT28_AUTHORITY_PATH =
  "evidence/acceptance/VF-10-07/2026-08-21-attempt28-post-job-terminal-scale-zero-candidate/approved-authority.json";
export const ATTEMPT28_AUTHORITY =
  "sha256:455d5102618a14595aabb9f38236a7fd4d8ddb59ba063c48b03b4c6dd0a85326";
export const ATTEMPT28_PHASE =
  "serverless_v2_v2_07_attempt28_post_job_terminal_scale_zero_repair_candidate_ready";
export const ATTEMPT28_PROPOSAL_READY_PHASE =
  "serverless_v2_v2_07_attempt28_post_job_terminal_scale_zero_proposal_ready";
export const ATTEMPT28_AUTHORIZED_PHASE =
  "serverless_v2_v2_07_attempt28_post_job_terminal_scale_zero_authorized";
export const ATTEMPT28_CLOSED_PHASE =
  "serverless_v2_v2_07_attempt28_closed_quiescence_failure";
export const ATTEMPT28_CLOSURE =
  "sha256:9d95a32f66a563db2c74dedd608067dbcc4b3ed989125ca4d2696b22943ef1bb";
export const ATTEMPT28_CLEANUP =
  "sha256:a8c7b12731fd8b6b72a4bdce38c2b03de51e50cdc255d9f0fb96639507174049";

const hasAll = (text, needles) => needles.every((needle) => text.includes(needle));
const hasIdentity = (text) => hasAll(text, [ATTEMPT28_PROPOSAL, ATTEMPT28_CONTROL]);

const isAttempt28UnapprovedState = (state) =>
  hasIdentity(state) &&
  (state.includes(`phase: ${ATTEMPT28_PHASE}`) ||
    state.includes(`phase: ${ATTEMPT28_PROPOSAL_READY_PHASE}`)) &&
  hasAll(state, [
    "task_stage: provider_free",
    "provider_calls_authorized: false",
    "remote_or_cloud_mutations_authorized: false",
    "gpu_use_authorized: false",
    "maximum_external_spend_usd: 0",
    "current_authority: null",
    "current_authority_sha256: null",
    "mutation_authorized: false",
    "spend_authorized_usd: 0",
  ]);

export const isAttempt28AuthorizedState = (state) =>
  hasIdentity(state) &&
  state.includes(`phase: ${ATTEMPT28_AUTHORIZED_PHASE}`) &&
  hasAll(state, [
    ATTEMPT28_AUTHORITY,
    `current_authority: ${ATTEMPT28_AUTHORITY_PATH}`,
    `current_authority_sha256: "${ATTEMPT28_AUTHORITY}"`,
    "task_stage: bounded_mutation",
    "provider_calls_authorized: true",
    "remote_or_cloud_mutations_authorized: true",
    "gpu_use_authorized: true",
    "maximum_external_spend_usd: 4",
    "mutation_authorized: true",
    "spend_authorized_usd: 4",
  ]);

export const isAttempt28ClosedState = (state) =>
  hasIdentity(state) &&
  state.includes(`phase: ${ATTEMPT28_CLOSED_PHASE}`) &&
  hasAll(state, [
    ATTEMPT28_CLOSURE,
    ATTEMPT28_CLEANUP,
    "task_stage: provider_free",
    "provider_calls_authorized: false",
    "remote_or_cloud_mutations_authorized: false",
    "gpu_use_authorized: false",
    "maximum_external_spend_usd: 0",
    "current_authority: null",
    "current_authority_sha256: null",
    "mutation_authorized: false",
    "spend_authorized_usd: 0",
  ]);

export const isAttempt28State = (state) =>
  isAttempt28UnapprovedState(state) || isAttempt28AuthorizedState(state) || isAttempt28ClosedState(state);

const isAttempt28UnapprovedGate = (gates) =>
  hasAll(gates, [
    `pending_proposal_sha256: "${ATTEMPT28_PROPOSAL}"`,
    `pending_control_source_commit: "${ATTEMPT28_CONTROL}"`,
    "pending_authority: null",
    "pending_authority_sha256: null",
    "authority_mode: none_attempt28_unapproved",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt28_proposal_ready_fresh_authority_required"',
  ]);

export const isAttempt28AuthorizedGate = (gates) =>
  hasAll(gates, [
    `pending_proposal_sha256: "${ATTEMPT28_PROPOSAL}"`,
    `pending_control_source_commit: "${ATTEMPT28_CONTROL}"`,
    `pending_authority: "${ATTEMPT28_AUTHORITY_PATH}"`,
    `pending_authority_sha256: "${ATTEMPT28_AUTHORITY}"`,
    "authority_mode: attempt28_bounded_mutation_authorized",
    "pending_numeric_cap_usd: 4",
    "pending_flashboot: true",
    "pending_availability: MEDIUM",
    'result: "NOT_QUALIFIED_attempt28_authorized_preexecution"',
  ]);

export const isAttempt28ClosedGate = (gates) =>
  hasAll(gates, [
    ATTEMPT28_CLOSURE,
    ATTEMPT28_CLEANUP,
    "authority_mode: none_attempt28_consumed",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt28_closed_quiescence_failure"',
  ]);

export const isAttempt28Gate = (gates) =>
  isAttempt28UnapprovedGate(gates) || isAttempt28AuthorizedGate(gates) || isAttempt28ClosedGate(gates);

export const isAttempt28AuthorizedActivation = (activation) =>
  hasIdentity(activation) &&
  hasAll(activation, [
    ATTEMPT28_AUTHORITY,
    "V207_APPROVED_FINITE_CAP_USD: number | null = 4",
  ]);

export const isAttempt28Activation = (activation) =>
  (hasIdentity(activation) &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")) ||
  isAttempt28AuthorizedActivation(activation);
