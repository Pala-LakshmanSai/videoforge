import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(candidateDir, "../../../../..");
const relative = (file) => join(root, file);
const failures = [];

const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const readText = async (file) => readFile(relative(file), "utf8");
const readJson = async (file) => JSON.parse(await readText(file));
const sha256 = async (file) =>
  `sha256:${createHash("sha256").update(await readFile(relative(file))).digest("hex")}`;
const same = (actual, expected, label) => check(actual === expected, `${label}: expected ${expected}, got ${actual}`);

const proposalPath = "project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/combined-live-proposal.json";
const acceptancePath = "project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/acceptance.json";
const approvalPath = "project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/approval-sentence.txt";

const [proposal, acceptance, preflight, predecessor, terms, crop, approvalRaw] = await Promise.all([
  readJson(proposalPath),
  readJson(acceptancePath),
  readJson("project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/read-only-preflight.json"),
  readJson("project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/success-attempt-85.json"),
  readJson("project-context/evidence/acceptance/VF-10-08/2026-09-05-terms-preflight/first-party-license-observation.json"),
  readJson("project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json"),
  readText(approvalPath),
]);

const proposalSha = await sha256(proposalPath);
const acceptanceSha = await sha256(acceptancePath);
const approvalSha = await sha256(approvalPath);
const preflightSha = await sha256("project-context/evidence/acceptance/VF-10-08/2026-09-05-live-qualification-candidate/read-only-preflight.json");
const predecessorSha = await sha256("project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/success-attempt-85.json");
const termsSha = await sha256("project-context/evidence/acceptance/VF-10-08/2026-09-05-terms-preflight/first-party-license-observation.json");
const cropSha = await sha256("project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json");

const sourceCommit = proposal.control.source_commit;
const branchRef = proposal.control.remote_source_publication.branch_ref;
const branchName = branchRef.replace(/^refs\/heads\//, "");
const wholeSpan = JSON.stringify(proposal.qualification_contract.complete_span_seconds);
const jobs = proposal.qualification_jobs;

check(proposal.schema_version === "videoforge.v2-08-soulx-live-qualification-proposal/v1", "proposal schema");
check(proposal.checkpoint === "V2-08" && proposal.task_id === "VF-10-08" && proposal.stage === 7, "proposal identity");
check(proposal.candidate_status === "PENDING_FRESH_EXACT_USER_APPROVAL", "proposal candidate status");
check(proposal.qualification_status === "NOT_QUALIFIED", "proposal must remain unqualified");
check(proposal.authority_mode === "NO_EXECUTABLE_AUTHORITY_UNTIL_EXACT_APPROVAL", "proposal authority boundary");
check(/^[0-9a-f]{40}$/.test(sourceCommit), "precursor source commit must be a full commit hash");
check(proposal.control.source_commit_role === "precursor_selector_preflight_and_image_source_only", "source role must remain precursor-only");
check(proposal.control.source_hash_binding_state.startsWith("BOUND_TO_"), "source hash binding must be bound");
check(proposal.control.source_hash_binding_note.includes("precursor") && proposal.control.source_hash_binding_note.includes("post-approval"), "source/execution split note");
check(proposal.control.execution_control_commit === null, "execution control successor must not be materialized before approval");
check(proposal.control.execution_control_commit_role === "post_approval_authority_materialization_only", "execution control role");
check(proposal.control.execution_control_commit_required === true, "execution control successor requirement");

const materialization = proposal.control.post_approval_authority_materialization;
check(materialization.authorized === true, "post-approval materialization authorization");
check(materialization.exactly_one_deterministic_commit === true, "exactly one deterministic authority commit");
check(materialization.independent_diff_audit_required === true && materialization.must_complete_before_runpod_mutation === true, "independent pre-mutation diff audit");
check(materialization.allowed_only_after.some((item) => item.includes("exact proposal hash")), "materialization proposal gate");
check(materialization.allowed_only_after.some((item) => item.includes("exact user approval")), "materialization approval gate");
check(materialization.allowed_only_after.some((item) => item.includes("immutable image digest")), "materialization digest gate");
check(materialization.allowed_paths.includes("apps/web/src/server/providers/v208-soulx-qualification.ts"), "materialization qualification path");
check(materialization.forbidden_delta.includes("worker source or runtime logic"), "materialization worker delta guard");
check(materialization.forbidden_delta.includes("qualification CLI/orchestrator/contract logic"), "materialization control-logic delta guard");
check(Array.isArray(materialization.exact_transition_proof) && materialization.exact_transition_proof.length === 13, "materialization transition proof");
check(materialization.exact_transition_proof.some((item) => item.includes("git HEAD") && item.includes("remote branch/ref") && item.includes("GITHUB_SHA")), "materialization HEAD and workflow proof");
check(materialization.exact_transition_proof.some((item) => item.includes("durable R2 key journal") && item.includes("v208-phase-materialization-{descriptorId}")), "durable R2 key journal proof");
check(materialization.exact_transition_proof.some((item) => item.includes("Before any provider dispatch") && item.includes("cleanup-plan") && item.includes("DONE")), "sealed pre-dispatch cleanup-plan proof");
check(materialization.exact_transition_proof.some((item) => item.includes("lane deletion") && item.includes("r2-cleanup-") && item.includes("chained crash resume")), "independent chained cleanup phases proof");
check(materialization.exact_transition_proof.some((item) => item.includes("cleanup-only RESUME") && item.includes("without redispatch")), "deterministic cleanup reconstruction proof");
check(materialization.exact_transition_proof.some((item) => item.includes("create or readback ACK") && item.includes("DONE readback") && item.includes("never recreate")), "create/readback ACK recovery proof");
check(materialization.exact_transition_proof.some((item) => item.includes("raw create response") && item.includes("deterministic exact-name resource-key lookup") && item.includes("30-read") && item.includes("2-second") && item.includes("final stable absence") && item.includes("{absent:true}")), "raw ambiguous-create bounded lookup/journal proof");
check(materialization.exact_transition_proof.some((item) => item.includes("delete ACK") && item.includes("already-absent") && item.includes("absence proof")), "delete absence reconciliation proof");
check(materialization.exact_transition_proof.some((item) => item.includes("partial or template-only") && item.includes("attributable cleanup") && item.includes("30-read") && item.includes("2-second")), "partial/template-only bounded cleanup proof");
check(materialization.exact_transition_proof.some((item) => item.includes("Late-visible") && item.includes("journaled") && item.includes("terminal {absent:true}") && item.includes("re-prove absence")), "late visibility and terminal-absent replay proof");
check(materialization.exact_transition_proof.some((item) => item.includes("one-sided qualification resource") && item.includes("exact deterministic endpoint/template names") && item.includes("prove both exact names absent")), "one-sided exact-name cleanup proof");
check(materialization.exact_transition_proof.some((item) => item.includes("stage claim of EXECUTE") && item.includes("cleanup-only") && item.includes("never create or dispatch")), "RESUME EXECUTE cleanup-only proof");
check(Array.isArray(materialization.future_post_approval_outputs) && materialization.future_post_approval_outputs.length === 2, "future authority outputs remain post-approval only");

same(proposal.control.publication_workflow.source_commit_must_equal, sourceCommit, "workflow source commit");
same(proposal.control.remote_source_publication.remote, "origin", "publication remote");
same(proposal.control.remote_source_publication.exact_push_refspec, `${sourceCommit}:${branchRef}`, "exact source push refspec");
same(proposal.control.remote_source_publication.remote_head_must_equal_after_push, sourceCommit, "remote head after push");
same(proposal.control.remote_source_publication.workflow_dispatch_ref, branchName, "workflow dispatch ref");
check(proposal.control.remote_source_publication.workflow_dispatch_requires_publish_true === true, "workflow publish=true requirement");

const sourceFiles = [
  ["qualification_cli", proposal.control.qualification_cli, proposal.control.qualification_cli_sha256],
  ["qualification_orchestrator", proposal.control.qualification_orchestrator, proposal.control.qualification_orchestrator_sha256],
  ["qualification_contract", proposal.control.qualification_contract, proposal.control.qualification_contract_sha256],
  ["qualification materializer", proposal.control.qualification_materializer, proposal.control.qualification_materializer_sha256],
  ["qualification transport", proposal.control.qualification_transport, proposal.control.qualification_transport_sha256],
  ["handler", proposal.control.handler.path, proposal.control.handler.sha256],
  ["dockerfile", proposal.control.dockerfile.path, proposal.control.dockerfile.sha256],
  ["requirements", proposal.control.requirements.path, proposal.control.requirements.sha256],
  ["publication workflow", proposal.control.publication_workflow.path, proposal.control.publication_workflow.sha256],
];
for (const [label, file, expected] of sourceFiles) same(await sha256(file), expected, `${label} source hash`);

check(proposal.image.source_commit === sourceCommit, "image source commit must equal precursor");
check(proposal.image.source_commit_role === "precursor_image_build_source_not_execution_control_commit", "image source role");
check(proposal.image.tag === sourceCommit, "image tag must equal precursor source commit");
check(proposal.image.publication_authorized === true && proposal.image.publication_authorized_under_exact_approval === true, "image publication authorization");
check(proposal.image.republish === false && proposal.image.republication_authorized === false, "image republication prohibition");
check(proposal.image.digest === null && proposal.image.immutable_image === null && proposal.image.prepublication_digest_available === false, "pre-publication image digest state");
check(proposal.image.exact_same_commit_digest_reuse_only === true, "same-commit reuse rule");

same(await sha256(proposal.read_only_preflight.path), proposal.read_only_preflight.sha256, "proposal preflight hash");
same(await sha256(proposal.predecessor.closure_path), proposal.predecessor.closure_sha256, "proposal predecessor hash");
same(await sha256(proposal.terms_and_rights.observation_path), proposal.terms_and_rights.observation_sha256, "proposal terms hash");
same(await sha256(proposal.visual_profile_binding.approval_path), proposal.visual_profile_binding.approval_sha256, "proposal crop approval hash");
same(preflightSha, proposal.read_only_preflight.sha256, "preflight evidence hash");
same(predecessorSha, proposal.predecessor.closure_sha256, "predecessor evidence hash");
same(termsSha, proposal.terms_and_rights.observation_sha256, "terms evidence hash");
same(cropSha, proposal.visual_profile_binding.approval_sha256, "crop evidence hash");

check(preflight.schema_version === "videoforge.v2-08-read-only-preflight/v1" && preflight.checkpoint === "V2-08", "preflight identity");
check(preflight.provider_mutations === 0 && preflight.external_spend_usd === 0, "preflight must be provider-free");
check(preflight.stable_read_count === 3 && preflight.stable_reads.length === 3, "preflight three stable reads");
for (const key of ["pods", "running_pods", "endpoints", "private_templates", "active_serverless_workers"]) check(preflight.inventory[key] === 0, `preflight inventory zero: ${key}`);
same(preflight.account_id_sha256, proposal.read_only_preflight.account_id_sha256, "preflight account hash");
same(preflight.selected_gpu.offering_id, proposal.placement_and_cost.gpu_offering_id, "preflight GPU offering");
same(preflight.selected_gpu.region, proposal.placement_and_cost.region, "preflight GPU region");
same(preflight.selected_gpu.availability, proposal.placement_and_cost.availability_at_preflight, "preflight GPU availability");
same(preflight.serverless_flex_rate.usd_per_gpu_hour, proposal.placement_and_cost.serverless_flex_usd_per_gpu_hour, "preflight Serverless rate");
same(preflight.cumulative_endpoint_billing_usd, proposal.placement_and_cost.billing_baseline_usd, "fresh billing baseline");
check(preflight.selected_gpu.secure_cloud === true && preflight.fresh_inventory_catalog_billing_read_required_before_mutation === true, "preflight safety requirements");
check(preflight.inventory.retained_volumes.some((volume) => volume.id_sha256 === proposal.sealed_volume.volume_id_sha256 && volume.size_gb === proposal.sealed_volume.size_gb && volume.region === proposal.sealed_volume.region), "sealed volume must be present in preflight");

check(predecessor.schema_version === "videoforge.v2-07-attempt85-success-closure/v1" && predecessor.checkpoint === "V2-07" && predecessor.task_id === "VF-10-07", "predecessor identity");
check(predecessor.result === "QUALIFIED_PASS_CLEAN" && predecessor.v2_08_actions === 0 && proposal.predecessor.reuse_is_evidence_only === true && proposal.predecessor.stage_6_rerun_authorized === false, "predecessor closure boundary");

check(terms.schema_version === "videoforge.v2-08-first-party-license-observation/v1", "terms observation schema");
check(terms.code_source.declared_license === "Apache-2.0" && terms.weight_source.declared_license === "apache-2.0", "declared Apache-2.0 terms");
check(terms.explicit_user_risk_decision === null && terms.gate_status === "OPEN_AWAITING_EXPLICIT_USER_DECISION", "terms decision must remain open until exact approval");
check(terms.provider_calls === 0 && terms.remote_mutations === 0 && terms.gpu_use === 0 && terms.spend_usd === 0, "terms preflight provider-free");
same(proposal.terms_and_rights.code_declared_license, terms.code_source.declared_license, "proposal code license");
same(proposal.terms_and_rights.weights_declared_license, terms.weight_source.declared_license, "proposal weights license");
check(proposal.terms_and_rights.hosted_commercial_use_is_unresolved === true && proposal.terms_and_rights.legal_advice === false, "proposal terms risk disclosure");

const candidatePath = crop.candidate.path;
same(await sha256(candidatePath), crop.candidate.sha256, "crop candidate hash");
check(crop.schema_version === "videoforge.v2-08-soulx-crop-profile-approval/v1" && crop.checkpoint === "V2-08", "crop approval identity");
check(crop.activation.visual_approval_status === "APPROVED_EXACT_FULL_AND_SPLIT", "crop approval status");
check(crop.activation.serverless_image_published === false && crop.activation.live_dispatch_authorized === false && crop.activation.provider_mutation_authorized === false, "crop approval is historical/provider-free");
same(proposal.visual_profile_binding.candidate_sha256, crop.candidate.sha256, "proposal crop candidate hash");
same(proposal.visual_profile_binding.native_sample_sha256, crop.approved_profile.native_sample_sha256, "proposal native sample hash");
same(proposal.visual_profile_binding.full_sample_sha256, crop.approved_profile.full.sample_sha256, "proposal full sample hash");
same(proposal.visual_profile_binding.split_sample_sha256, crop.approved_profile.split.sample_sha256, "proposal split sample hash");
check(proposal.visual_profile_binding.live_crop_readback_claim === false && proposal.visual_profile_binding.evidence_role === "historical_provider_free_crop_approval_only", "no live crop readback claim");

const cost = proposal.placement_and_cost;
const expectedGpuSeconds = 5 * 800 + 2 * 800 + 2 * 60 + 5 + 60;
same(cost.worst_case_formula, "5*800 + 2*800 + 2*60 + 5 + 60", "worst-case formula");
same(cost.worst_case_gpu_seconds, expectedGpuSeconds, "worst-case GPU seconds");
same(cost.worst_case_incremental_liability_usd, Number((expectedGpuSeconds * cost.serverless_flex_usd_per_gpu_second).toFixed(5)), "worst-case liability");
same(cost.cumulative_billing_stop_threshold_usd, cost.billing_baseline_usd + cost.finite_incremental_spend_cap_usd, "cumulative billing threshold");
check(cost.finite_incremental_spend_cap_usd >= cost.worst_case_incremental_liability_usd && cost.cap_headroom_usd === Number((cost.finite_incremental_spend_cap_usd - cost.worst_case_incremental_liability_usd).toFixed(5)), "finite cap headroom");
check(cost.gpu_fallback === false && cost.retained_volume_charge_outside_finite_cap === true, "cost boundary");

const expectedKinds = ["cold", "warm", "cancel", "invalid", "timeout"];
const expectedDescriptors = ["soulx-cold-whole-span-2-4-6-10s", "soulx-warm-whole-span-2-4-6-10s", "soulx-cancel", "soulx-invalid-output", "soulx-timeout"];
check(jobs.length === 5 && jobs.map((job) => job.kind).join(",") === expectedKinds.join(","), "exact five ordered jobs");
check(jobs.map((job) => job.descriptor).join(",") === expectedDescriptors.join(","), "exact five ordered descriptor IDs");
check(JSON.stringify(jobs[0]?.whole_span_seconds) === wholeSpan && JSON.stringify(jobs[1]?.whole_span_seconds) === wholeSpan, "cold/warm whole-span framing");
check(jobs[0]?.execution_timeout_seconds === 800 && jobs[1]?.execution_timeout_seconds === 800, "cold/warm timeout");
check(jobs[2]?.required_terminal_status === "CANCELLED" && jobs[3]?.required_terminal_status === "FAILED" && jobs[3]?.required_failure_code === "SOULX_OUTPUT_CONTRACT_INVALID" && jobs[4]?.required_terminal_status === "TIMED_OUT", "terminal job contract");
check(proposal.qualification_contract.exactly_five_provider_jobs === true && proposal.qualification_contract.whole_span_batch_is_one_request_per_cold_or_warm_job === true, "qualification job contract");
check(proposal.qualification_contract.materialization_journal_count === 5 && proposal.qualification_contract.materialization_journal_operation_prefix === "v208-phase-materialization-{descriptorId}" && proposal.qualification_contract.deterministic_key_reconstruction_on_cleanup_resume === true, "materialization journal contract");
check(proposal.qualification_contract.native_r2_get_and_ffprobe === true && proposal.qualification_contract.signed_native_reuse_for_approved_full_split_profile === true && proposal.qualification_contract.crop_readback_claim === false, "native evidence contract");
check(proposal.qualification_contract.stage_6_rerun_authorized === false && proposal.qualification_contract.v2_09_authorized === false && proposal.qualification_contract.redispatch_authorized === false, "qualification scope boundary");
same(acceptance.qualification_materializer_sha256, proposal.control.qualification_materializer_sha256, "acceptance qualification materializer hash");

const cleanup = proposal.cleanup_and_final_proof;
check(cleanup.drain_active_workers_to_zero_before_endpoint_template_delete === true && cleanup.active_workers_must_be_zero_before_endpoint_template_delete === true, "drain workers before deletion");
check(cleanup.delete_disposable_endpoint_after_active_workers_zero === true && cleanup.delete_disposable_private_template_after_active_workers_zero === true, "endpoint/template delete order");
check(cleanup.worker_deletion_operation.includes("drain") && cleanup.worker_deletion_operation.includes("zero"), "worker drain wording");
check(cleanup.cloudflare_worker_or_route_mutation_authorized === false && cleanup.cloudflare_worker_or_route_cleanup_required === false, "no Cloudflare Worker/route mutation");
check(cleanup.final_zero_compute_billing_volume_reads === 3 && cleanup.continued_volume_retention_usd_per_month === 7, "final reads and volume retention");
check(proposal.durability_and_resume.signal_safe_interruption_checkpoints === true && proposal.durability_and_resume.uncertain_dispatch_stops_and_reconciles === true && proposal.durability_and_resume.blind_redispatch === false, "signal-safe resume/unknown dispatch guards");
check(proposal.durability_and_resume.cleanup_plan_persisted_before_any_provider_dispatch === true && proposal.durability_and_resume.cleanup_plan_phase === "cleanup-plan" && proposal.durability_and_resume.cleanup_plan_contains_lane_and_all_five_descriptor_key_sets === true && proposal.durability_and_resume.cleanup_plan_hash_canonical_and_durable === true, "sealed pre-dispatch cleanup plan");
check(proposal.durability_and_resume.resume_requires_sealed_cleanup_plan === true && proposal.durability_and_resume.lane_delete_phase_durable === true && proposal.durability_and_resume.per_descriptor_r2_cleanup_phases_durable === true && proposal.durability_and_resume.chained_crash_resume_across_cleanup_phases === true && proposal.durability_and_resume.r2_cleanup_exact_key_match_and_absence_proof === true, "chained durable cleanup phases");
check(proposal.durability_and_resume.create_and_readback_ack_recovery_required === true && proposal.durability_and_resume.delete_absence_reconciliation_required === true && proposal.durability_and_resume.lane_delete_completion_requires_absence_proof === true && proposal.durability_and_resume.cleanup_plan_recoverable_after_create_ack_crash === true, "create/readback and delete ACK recovery");
check(proposal.durability_and_resume.raw_ambiguous_create_exact_lookup_required === true && proposal.durability_and_resume.raw_ambiguous_create_absence_journaled_terminal === true && proposal.durability_and_resume.raw_ambiguous_create_existing_lane_acked_and_readback === true && proposal.durability_and_resume.raw_ambiguous_create_absence_skips_cleanup_plan_and_r2_keys === true && proposal.durability_and_resume.delete_ack_absence_reconciled_by_exact_lookup === true, "raw ambiguous-create and delete absence paths");
check(proposal.durability_and_resume.partial_or_template_only_attributable_cleanup_required === true && proposal.durability_and_resume.absence_propagation_read_count === 30 && proposal.durability_and_resume.absence_propagation_interval_seconds === 2 && proposal.durability_and_resume.lookup_errors_do_not_count_as_absence === true && proposal.durability_and_resume.late_visible_lane_cleanup_required === true && proposal.durability_and_resume.terminal_absent_create_replay_must_reprove_absence === true, "bounded absence propagation and replay cleanup");
check(proposal.durability_and_resume.one_sided_exact_name_discovery_validation_delete_required === true && proposal.durability_and_resume.one_sided_absence_proof_required === true && proposal.durability_and_resume.resume_execute_is_cleanup_only === true && proposal.durability_and_resume.resume_execute_never_creates_or_dispatches === true && proposal.durability_and_resume.one_sided_template_endpoint_identity_binding_required === true, "one-sided and RESUME EXECUTE cleanup guards");

const deriveApprovalSentence = () =>
  `I approve exact V2-08 proposal ${proposalSha} bound to precursor source ${sourceCommit} (selector/preflight and image source only, not execution control), exact git push ${sourceCommit}:${branchRef} to origin and workflow_dispatch at ${branchName}, with clean local git HEAD and pushed remote/GITHUB_SHA proof equal to that precursor before any provider mutation, and one exact manual image publication with publication_authorized=true and republish=false, its post-publication immutable digest captured and anonymously verified before any RunPod mutation, followed by exactly one deterministic post-approval authority-materialization successor commit derived from this proposal, the exact approval, and that verified digest and independently diff-audited before RunPod mutation, and one single-use V2-08 max1 qualification on ${cost.gpu_offering_id} in ${cost.region} at or below USD ${cost.serverless_flex_usd_per_gpu_hour}/GPU-hour with fresh billing baseline USD ${cost.billing_baseline_usd}, worst-case ${cost.worst_case_gpu_seconds} GPU-seconds and USD ${cost.worst_case_incremental_liability_usd} liability, hard USD ${cost.finite_incremental_spend_cap_usd} incremental cap and USD ${cost.cumulative_billing_stop_threshold_usd} cumulative stop threshold, exactly five jobs cold/warm/cancel/invalid/timeout covering native R2 GET plus exact ffprobe and signed native reuse for the historical approved full/split profile over whole-span ${wholeSpan}, cleanup-plan durably sealed before any provider dispatch, five durable per-materialization R2 key journals, independently durable lane-delete and per-descriptor r2-cleanup phases supporting chained cleanup-only RESUME with deterministic exact-key reconstruction and no redispatch, raw ambiguous-create bounded exact-name resource-key lookup through the full 30-read 2-second propagation window, with lookup errors never counting as absence, and journaled absent-terminal only after final stable absence/no-cleanup-plan-or-R2 path or present-ACKED/exact-readback path, durable create/readback-ACK recovery requiring exact DONE readback without recreation, delete-ACK absence reconciliation before completing lane-delete, partial/template-only attributable cleanup with bounded 30-read 2-second absence propagation where lookup errors do not count as absence, late-visible lane cleanup, terminal-absent replay with absence re-proof, one-sided exact-name discovery/validation/delete with absence proof, and RESUME EXECUTE cleanup-only with no create or dispatch, active-worker drain to zero before disposable RunPod endpoint/template deletion, generated R2 input/output cleanup, signal-safe phase resume, three final zero-compute/billing/volume reads, and continued retention of only the existing volumes at USD ${cleanup.continued_volume_retention_usd_per_month}/month; I explicitly accept the unresolved Apache-2.0 hosted/commercial-use terms risk for this qualification only without claiming legal clearance, and authorize no fallback, download, volume mutation, Stage 6 rerun, max2 proof, Cloudflare Worker or route mutation, production route, or V2-09 execution.`;

check(approvalRaw.endsWith("\n"), "approval sentence must end with one newline");
check(approvalRaw === `${deriveApprovalSentence()}\n`, "approval sentence must be exactly derived from proposal bytes/hash");
same(approvalSha, acceptance.approval_sentence_sha256, "approval sentence hash");

check(acceptance.schema_version === "videoforge.v2-08-soulx-live-qualification-candidate-acceptance/v1", "acceptance schema");
check(acceptance.checkpoint === proposal.checkpoint && acceptance.task_id === proposal.task_id && acceptance.stage === proposal.stage, "acceptance identity");
same(acceptance.proposal_sha256, proposalSha, "acceptance proposal hash");
same(acceptance.control_source_commit, sourceCommit, "acceptance precursor source");
same(acceptance.qualification_cli_sha256, proposal.control.qualification_cli_sha256, "acceptance CLI hash");
same(acceptance.qualification_orchestrator_sha256, proposal.control.qualification_orchestrator_sha256, "acceptance orchestrator hash");
same(acceptance.qualification_contract_sha256, proposal.control.qualification_contract_sha256, "acceptance contract hash");
same(acceptance.qualification_transport_sha256, proposal.control.qualification_transport_sha256, "acceptance transport hash");
same(acceptance.handler_sha256, proposal.control.handler.sha256, "acceptance handler hash");
same(acceptance.dockerfile_sha256, proposal.control.dockerfile.sha256, "acceptance Dockerfile hash");
same(acceptance.image_source_commit, proposal.image.source_commit, "acceptance image source");
same(acceptance.remote_source_push_refspec, proposal.control.remote_source_publication.exact_push_refspec, "acceptance push refspec");
same(acceptance.preflight_sha256, preflightSha, "acceptance preflight hash");
same(acceptance.predecessor_closure_sha256, predecessorSha, "acceptance predecessor hash");
same(acceptance.terms_observation_sha256, termsSha, "acceptance terms hash");
same(acceptance.crop_approval_sha256, cropSha, "acceptance crop hash");
check(acceptance.approval_sentence_state === "DERIVED_FROM_FINAL_PROPOSAL_PENDING_EXACT_APPROVAL", "acceptance approval state");
check(acceptance.executable_authority === false && acceptance.provider_mutations === 0 && acceptance.gpu_jobs_submitted === 0 && acceptance.external_spend_usd === 0, "acceptance authority/spend boundary");
same(acceptance.billing_baseline_usd, cost.billing_baseline_usd, "acceptance billing baseline");
same(acceptance.worst_case_gpu_seconds, cost.worst_case_gpu_seconds, "acceptance worst-case seconds");
same(acceptance.finite_incremental_spend_cap_usd, cost.finite_incremental_spend_cap_usd, "acceptance finite cap");
same(acceptance.cumulative_billing_stop_threshold_usd, cost.cumulative_billing_stop_threshold_usd, "acceptance cumulative stop");

if (failures.length) {
  console.error(`FAIL ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS V2-08 candidate proposal=${proposalSha} acceptance=${acceptanceSha} approval=${approvalSha}`);
}
