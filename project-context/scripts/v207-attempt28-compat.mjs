// Historical V2-07 validators still verify immutable Attempt17-27 artifacts.
// These exact predicates permit only the current Attempt28/29 boundaries
// without weakening historical hashes.

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

export const ATTEMPT29_PROPOSAL =
  "sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6";
export const ATTEMPT29_CONTROL = "7ba8e9181fe210858c23a3ba7c5c9aca768ac24b";
export const ATTEMPT29_PHASE =
  "serverless_v2_v2_07_attempt29_terminal_replay_queue_proof_candidate_ready";
export const ATTEMPT29_ACCEPTANCE =
  "sha256:1b2a52f34de0f5122522de50c0fbd213aea3bb77f11cf0d5e0c12506edd8906e";
export const ATTEMPT29_MAX1 =
  "sha256:115a413d11be895638d3742a512f1a1f2d21a6f613617559c5816aa70bd840aa";
export const ATTEMPT29_MAX2 =
  "sha256:f375c3d4d4f67b7021b92d46b01c1e24b44c269280b697430191539a51155a0d";
export const ATTEMPT29_AUTHORITY_PATH =
  "evidence/acceptance/VF-10-07/2026-08-21-attempt29-terminal-replay-queue-proof-candidate/approved-authority.json";
export const ATTEMPT29_AUTHORITY =
  "sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572";
export const ATTEMPT29_AUTHORIZED_PHASE =
  "serverless_v2_v2_07_attempt29_terminal_replay_queue_proof_authorized";
export const ATTEMPT29_CLOSED_PHASE =
  "serverless_v2_v2_07_attempt29_closed_finalize_replay_failure";
export const ATTEMPT29_CLOSURE =
  "sha256:ba6aab6bc71726c1690ae80161a7c22c9f3f50444efd14efc396bf556ae72678";
export const ATTEMPT29_CLEANUP =
  "sha256:96a7660bb19f0db5e88cec60269647b2101fd2ef5114f78efeecacec022c8a24";

export const ATTEMPT30_PROPOSAL =
  "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a";
export const ATTEMPT30_CONTROL = "bf26c3a86ec6a48f619c39613d425da816eeae4d";
export const ATTEMPT30_AUTHORITY =
  "sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131";
export const ATTEMPT30_CLOSURE =
  "sha256:9846e19ee4348e73ef880202ecff5463bd076c5b1a2bd209e2815cba0500043c";
export const ATTEMPT30_CLEANUP =
  "sha256:112f7038d162613ebdde2176a7c257de24f629fdb3914b876a6edc490f46dbb0";
export const ATTEMPT31_PROPOSAL =
  "sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea";
export const ATTEMPT31_CONTROL = "f513ac807c6d5e2298092a936495e3c4fc0e6a28";
export const ATTEMPT31_PHASE =
  "serverless_v2_v2_07_attempt31_terminal_snapshot_stabilization_provider_free";

const hasAll = (text, needles) => needles.every((needle) => text.includes(needle));
const hasIdentity = (text) => hasAll(text, [ATTEMPT28_PROPOSAL, ATTEMPT28_CONTROL]);
const hasAttempt29Identity = (text) => hasAll(text, [ATTEMPT29_PROPOSAL, ATTEMPT29_CONTROL]);
const hasAttempt31Identity = (text) => hasAll(text, [ATTEMPT31_PROPOSAL, ATTEMPT31_CONTROL]);

export const isAttempt31CandidateState = (state) =>
  hasAttempt31Identity(state) &&
  state.includes(`phase: ${ATTEMPT31_PHASE}`) &&
  hasAll(state, [
    ATTEMPT30_PROPOSAL,
    ATTEMPT30_AUTHORITY,
    ATTEMPT30_CLOSURE,
    ATTEMPT30_CLEANUP,
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

export const isAttempt29CandidateState = (state) =>
  hasAttempt29Identity(state) &&
  state.includes(`phase: ${ATTEMPT29_PHASE}`) &&
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

export const isAttempt29AuthorizedState = (state) =>
  hasAttempt29Identity(state) &&
  state.includes(`phase: ${ATTEMPT29_AUTHORIZED_PHASE}`) &&
  hasAll(state, [
    ATTEMPT29_AUTHORITY,
    `current_authority: ${ATTEMPT29_AUTHORITY_PATH}`,
    `current_authority_sha256: "${ATTEMPT29_AUTHORITY}"`,
    "task_stage: bounded_mutation",
    "provider_calls_authorized: true",
    "remote_or_cloud_mutations_authorized: true",
    "gpu_use_authorized: true",
    "maximum_external_spend_usd: 4",
    "mutation_authorized: true",
    "spend_authorized_usd: 4",
  ]);

export const isAttempt29ClosedState = (state) =>
  hasAttempt29Identity(state) &&
  state.includes(`phase: ${ATTEMPT29_CLOSED_PHASE}`) &&
  hasAll(state, [
    ATTEMPT29_CLOSURE,
    ATTEMPT29_CLEANUP,
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

const isAttempt28HistoricalClosedState = (state) =>
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

export const isAttempt28ClosedState = (state) =>
  isAttempt28HistoricalClosedState(state) ||
  isAttempt29CandidateState(state) ||
  isAttempt29ClosedState(state) ||
  isAttempt31CandidateState(state);

export const isAttempt28State = (state) =>
  isAttempt28UnapprovedState(state) ||
  isAttempt28AuthorizedState(state) ||
  isAttempt29AuthorizedState(state) ||
  isAttempt29ClosedState(state) ||
  isAttempt28ClosedState(state) ||
  isAttempt29CandidateState(state) ||
  isAttempt31CandidateState(state);

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

export const isAttempt29CandidateGate = (gates) =>
  hasAll(gates, [
    `pending_proposal_sha256: "${ATTEMPT29_PROPOSAL}"`,
    `pending_control_source_commit: "${ATTEMPT29_CONTROL}"`,
    "pending_authority: null",
    "pending_authority_sha256: null",
    "authority_mode: none_attempt29_unapproved",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt29_provider_free_candidate_ready"',
  ]);

export const isAttempt29AuthorizedGate = (gates) =>
  hasAll(gates, [
    `pending_proposal_sha256: "${ATTEMPT29_PROPOSAL}"`,
    `pending_control_source_commit: "${ATTEMPT29_CONTROL}"`,
    `pending_authority: "${ATTEMPT29_AUTHORITY_PATH}"`,
    `pending_authority_sha256: "${ATTEMPT29_AUTHORITY}"`,
    "authority_mode: attempt29_bounded_mutation_authorized",
    "pending_numeric_cap_usd: 4",
    "pending_flashboot: true",
    "pending_availability: LOW",
    'result: "NOT_QUALIFIED_attempt29_authorized_preexecution"',
  ]);

export const isAttempt29ClosedGate = (gates) =>
  hasAll(gates, [
    ATTEMPT29_CLOSURE,
    ATTEMPT29_CLEANUP,
    "authority_mode: none_attempt29_consumed",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt29_closed_output_finalization_replay_failure"',
  ]);

export const isAttempt31CandidateGate = (gates) =>
  hasAll(gates, [
    `pending_proposal_sha256: "${ATTEMPT31_PROPOSAL}"`,
    `pending_control_source_commit: "${ATTEMPT31_CONTROL}"`,
    ATTEMPT30_CLOSURE,
    ATTEMPT30_CLEANUP,
    "pending_authority: null",
    "pending_authority_sha256: null",
    "authority_mode: none_attempt31_pending_fresh_approval",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt30_closed_concurrent_reader_baseline_failure"',
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

const isAttempt28HistoricalClosedGate = (gates) =>
  hasAll(gates, [
    ATTEMPT28_CLOSURE,
    ATTEMPT28_CLEANUP,
    "authority_mode: none_attempt28_consumed",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt28_closed_quiescence_failure"',
  ]);

export const isAttempt28ClosedGate = (gates) =>
  isAttempt28HistoricalClosedGate(gates) ||
  isAttempt29CandidateGate(gates) ||
  isAttempt29ClosedGate(gates) ||
  isAttempt31CandidateGate(gates);

export const isAttempt28Gate = (gates) =>
  isAttempt28UnapprovedGate(gates) ||
  isAttempt28AuthorizedGate(gates) ||
  isAttempt29AuthorizedGate(gates) ||
  isAttempt29ClosedGate(gates) ||
  isAttempt28ClosedGate(gates) ||
  isAttempt29CandidateGate(gates) ||
  isAttempt31CandidateGate(gates);

export const isAttempt28AuthorizedActivation = (activation) =>
  hasIdentity(activation) &&
  hasAll(activation, [
    ATTEMPT28_AUTHORITY,
    "V207_APPROVED_FINITE_CAP_USD: number | null = 4",
  ]);

export const isAttempt28Activation = (activation) =>
  (hasIdentity(activation) &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")) ||
  isAttempt28AuthorizedActivation(activation) ||
  (hasAttempt29Identity(activation) &&
    activation.includes(ATTEMPT29_AUTHORITY) &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4")) ||
  (hasAttempt29Identity(activation) &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")) ||
  (hasAttempt31Identity(activation) &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
    activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null"));
