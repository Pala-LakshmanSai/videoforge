// Historical V2-07 validators still verify immutable Attempt17-27 artifacts.
// This small compatibility predicate lets them observe the current provider-free
// Attempt28 candidate without weakening any historical hash or artifact checks.

export const ATTEMPT28_PROPOSAL =
  "sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf";
export const ATTEMPT28_CONTROL = "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14";
export const ATTEMPT28_PHASE =
  "serverless_v2_v2_07_attempt28_post_job_terminal_scale_zero_repair_candidate_ready";
export const ATTEMPT28_PROPOSAL_READY_PHASE =
  "serverless_v2_v2_07_attempt28_post_job_terminal_scale_zero_proposal_ready";

export const isAttempt28State = (state) =>
  state.includes(ATTEMPT28_PROPOSAL) &&
  state.includes(ATTEMPT28_CONTROL) &&
  (state.includes(`phase: ${ATTEMPT28_PHASE}`) ||
    state.includes(`phase: ${ATTEMPT28_PROPOSAL_READY_PHASE}`)) &&
  state.includes("task_stage: provider_free") &&
  state.includes("provider_calls_authorized: false") &&
  state.includes("remote_or_cloud_mutations_authorized: false") &&
  state.includes("gpu_use_authorized: false") &&
  state.includes("maximum_external_spend_usd: 0") &&
  state.includes("current_authority: null") &&
  state.includes("current_authority_sha256: null") &&
  state.includes("mutation_authorized: false") &&
  state.includes("spend_authorized_usd: 0");

export const isAttempt28Gate = (gates) =>
  gates.includes(
    `pending_proposal_sha256: "${ATTEMPT28_PROPOSAL}"`,
  ) &&
  gates.includes(`pending_control_source_commit: "${ATTEMPT28_CONTROL}"`) &&
  gates.includes("pending_authority: null") &&
  gates.includes("pending_authority_sha256: null") &&
  gates.includes("authority_mode: none_attempt28_unapproved") &&
  gates.includes("pending_numeric_cap_usd: null") &&
  gates.includes(
    'result: "NOT_QUALIFIED_attempt28_proposal_ready_fresh_authority_required"',
  );

export const isAttempt28Activation = (activation) =>
  activation.includes(ATTEMPT28_PROPOSAL) &&
  activation.includes(ATTEMPT28_CONTROL) &&
  activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null");
