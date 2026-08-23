import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt44-version-metadata-probe-candidate",
);
const paths = {
  proposal: resolve(dir, "combined-live-proposal.json"),
  acceptance: resolve(dir, "acceptance.json"),
  preflight: resolve(dir, "read-only-preflight.json"),
  anchor: resolve(dir, "cloudflare-anchor-observation.json"),
  reconciliation: resolve(dir, "runpod-reconciliation-observation.json"),
  max1: resolve(dir, "staged-config-max1.json"),
  max2: resolve(dir, "staged-config-max2.json"),
  authority: resolve(dir, "approved-authority.json"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  attempt: 44,
  proposal: "sha256:a5c57dab66673cce1878c38aceff50b9f5341a4c3b069b250aeeac099dfeaa0e",
  acceptance: "sha256:f8abbd1acaf111d8c0986d0de2569ee5598bfb9b62c5f27c87da082d00fb94b1",
  authority: "sha256:a376fb6782c1512e50c8586b060bf57d030685dba3df4b5a69650e195595ab5f",
  max1: "sha256:fcd591f6ad384ad5ab20ae6ab24bbec6d1e3940f07ffbc3cb33bc3be6664973c",
  max2: "sha256:8c1d60cc939c3e01f95533733259ce8de5a2a8345429327af2fd869b2dd32a2c",
  preflight: "sha256:fa2c02e3117229d2b656255092c914514c9a4364fb38fc0b921d37cc025c683c",
  anchor: "sha256:3dc1465fc34db19174c307cd1454c24847cf7e7f8294e20af10f80fd6f67b768",
  reconciliation: "sha256:abde59d6ea9046295fe1373eed4bbba5a1e96228f824a4e2724b972b22893c56",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  imageSource: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  activationCanonicalizer: "1089c4729424ee066408e1de8fe927e17cf3915f",
  handler: "sha256:3a2559dd363bdf5032b019dab3cb8fe45cba6ed4308464f860a1965cfd18f1da",
  subset: "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71",
  canonicalActivation:
    "sha256:82e3e571a304e96ace9cbd861c8cd2e691e36964223c40702d0115a17931f7d7",
  rawActivation:
    "sha256:6e36bce937a10317988d47bb0f67931c0af1d7c7c60d55db66b3a88e5a898d6e",
  proposalRawActivation:
    "sha256:1034d31fd39565acddf6f3a433e1ff42d505e3eea24bd767c530c18c19b4091f",
  pendingAttempt43:
    "sha256:05e8aa382b135101990edbe155e75ac89b51f75779d81de500bb75b693207458",
  attempt43Authority:
    "sha256:e5c268b63583d28c18a3999ef9880f425d54e9bf50f759e376dbcd0f2b40a07b",
  configBaseline:
    "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774",
  anchorVersion:
    "sha256:ee4c0d1dd0e4c05cb4067f312ea7a4e656d27f1e96e678c815565c2ca2ff4ea0",
  anchorRecord:
    "sha256:5b2768ef36f1ad131b1838e2fb3ca7eb1329827b607a6bcd1fca6a9c443c3878",
};
const fail = (code) => {
  throw new Error(`V207_ATTEMPT44_CANDIDATE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const shaPattern = /^sha256:[a-f0-9]{64}$/u;
const pathFor = (name) => paths[name];

for (const [name, path] of Object.entries(paths)) {
  assert(existsSync(path), `MISSING_${name}`);
}
const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const authority = json(paths.authority);
const preflight = json(paths.preflight);
const anchor = json(paths.anchor);
const reconciliation = json(paths.reconciliation);
const max1 = json(paths.max1);
const max2 = json(paths.max2);
for (const [name, expectedHash] of Object.entries({
  proposal: expected.proposal,
  acceptance: expected.acceptance,
  preflight: expected.preflight,
  anchor: expected.anchor,
  reconciliation: expected.reconciliation,
  max1: expected.max1,
  max2: expected.max2,
  authority: expected.authority,
})) {
  assert(sha(pathFor(name)) === expectedHash, `${name.toUpperCase()}_HASH`);
  assert(shaPattern.test(expectedHash), `${name.toUpperCase()}_HASH_FORMAT`);
}

assert(
  proposal.schema_version ===
    "videoforge.v2-07-attempt44-version-metadata-probe-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === expected.attempt,
  "PROPOSAL_SCOPE",
);
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false &&
    proposal.publication === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "PROPOSAL_BOUNDARY",
);
assert(
  proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.fresh_positive_numeric_cap_required === true &&
    proposal.user_approval?.prior_authority_or_cap_reuse_forbidden === true,
  "PROPOSAL_APPROVAL_BOUNDARY",
);
const lineage = proposal.lineage;
assert(
  lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.image === expected.image &&
    lineage?.image_source_commit === expected.imageSource &&
    lineage?.image_config_sha256 ===
      "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6" &&
    lineage?.image_layer_sha256 ===
      "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a" &&
    lineage?.image_layer_diff_id ===
      "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1" &&
    lineage?.image_parent_config_sha256 ===
      "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2" &&
    lineage?.handler_source_sha256 === expected.handler &&
    lineage?.execution_subset_schema_sha256 === expected.subset &&
    lineage?.volume_id_sha256 === expected.mageVolume &&
    lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    lineage?.flashboot === true,
  "LINEAGE",
);
assert(
  lineage?.control_source_commits?.handler_repair ===
    "129fd40a81b98de8dcfcab7a00607bc41cb384f1" &&
    lineage?.control_source_commits?.config_binding ===
      "2e216bade5f8457749f435cca1dd160767c20039" &&
    lineage?.control_source_commits?.activation_reset ===
      "035306038daa23f1a9579c5d0c1852c5155fb52e" &&
    lineage?.control_source_commits?.activation_canonicalizer ===
      expected.activationCanonicalizer &&
    lineage?.control_source_hashes?.orchestrator_source_sha256 ===
      "sha256:cfb288a20c169c3649495a54bee1aa7534ff5442e0627051a0b1d4f8750a3441" &&
    lineage?.control_source_hashes?.live_qualification_source_sha256 ===
      "sha256:f842296ca11786fb97cf6c7a1286a38b867b42344bb91c33b6ce9f64ac377e4d" &&
    lineage?.control_source_hashes?.typed_authority_source_sha256 ===
      expected.canonicalActivation &&
    lineage?.control_source_hashes?.typed_authority_source_hash_mode ===
      "CANONICAL_ZEROED_APPROVAL_BINDINGS_V2" &&
    lineage?.control_source_hashes?.typed_authority_raw_source_sha256 === expected.proposalRawActivation,
  "CONTROL_LINEAGE",
);
const compiled = lineage?.compiled_activation_boundary;
assert(
  compiled?.pending_proposal_sha256 === expected.pendingAttempt43 &&
    compiled?.pending_proposal_state === "ATTEMPT43_CONSUMED_NOT_REUSABLE" &&
    compiled?.approved_authority_sha256 === null &&
    compiled?.approved_finite_cap_usd === null &&
    compiled?.anchor_refresh_authorized === null &&
    compiled?.exact_consumed_attempt43_environment_rejected === true,
  "COMPILED_DISABLED_BOUNDARY",
);
assert(
  proposal.protected_config?.baseline_sha256 === expected.configBaseline &&
    proposal.protected_config?.mode === "0600" &&
    proposal.protected_config?.version_metadata_binding === "CF_VERSION_METADATA" &&
    proposal.protected_config?.marker_state === "DISABLED" &&
    proposal.protected_config?.marker_mutation_authorized === false &&
    proposal.protected_config?.config_mutation_authorized === false,
  "PROTECTED_CONFIG",
);
const versionProbe = proposal.cloudflare_version_metadata_probe;
assert(
  versionProbe?.evidence === "cloudflare-anchor-observation.json" &&
    versionProbe?.evidence_sha256 === expected.anchor &&
    versionProbe?.version_metadata_binding === "CF_VERSION_METADATA" &&
    versionProbe?.current_anchor_version_id_sha256 === expected.anchorVersion &&
    versionProbe?.current_anchor_record_sha256 === expected.anchorRecord &&
    versionProbe?.current_anchor_index_oldest_to_newest === 7 &&
    versionProbe?.required_consecutive_version_metadata_matches === 16 &&
    versionProbe?.expected_method === "POST" &&
    versionProbe?.expected_status === 403 &&
    versionProbe?.expected_code === "V207_AUTHORITY_REJECTED" &&
    versionProbe?.mixed_edge_status_or_version_drift === "FAIL_CLOSED" &&
    versionProbe?.missing_or_malformed_version_metadata === "FAIL_CLOSED" &&
    versionProbe?.anchor_refresh_required === false &&
    versionProbe?.anchor_refresh_authorized === false &&
    versionProbe?.marker_mutation === false,
  "VERSION_METADATA_PROBE",
);
assert(
  proposal.read_only_preflight?.evidence === "read-only-preflight.json" &&
    proposal.read_only_preflight?.evidence_sha256 === expected.preflight &&
    proposal.read_only_preflight?.inventory_catalog_sha256 ===
      "sha256:929722f3b7c947ddd88beddcb9e1e64931f3bd4d18904fea1a03384192dfa398" &&
    proposal.read_only_preflight?.reconciliation_sha256 ===
      "sha256:ee4cae58d284d6bbf5c4cbe9c1ebcec94e65b63309945031c771a0a64b93320f" &&
    proposal.read_only_preflight?.inventory_zero_disposable_resources === true &&
    proposal.read_only_preflight?.both_exact_retained_volumes === true &&
    proposal.read_only_preflight?.incremental_spend_usd === 0 &&
    proposal.read_only_preflight?.cap_input_non_authorizing === true &&
    proposal.read_only_preflight?.cap_authority === null,
  "PREFLIGHT_BINDING",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2 &&
    proposal.staged_endpoint_configs?.[0]?.workers_min === 0 &&
    proposal.staged_endpoint_configs?.[0]?.workers_max === 1 &&
    proposal.staged_endpoint_configs?.[1]?.workers_min === 0 &&
    proposal.staged_endpoint_configs?.[1]?.workers_max === 2 &&
    proposal.official_rate_sources?.serverless_pricing ===
      "https://docs.runpod.io/serverless/pricing" &&
    proposal.official_rate_sources?.current_flex_rate_is_measurement_input_not_authority === true,
  "STAGED_CONFIG_BINDING",
);
assert(
  proposal.cost_estimate?.finite_action_estimate_usd === 3.95 &&
    proposal.cost_estimate?.proposed_finite_cap_usd === null &&
    proposal.cost_estimate?.current_provider_rate_usd_per_gpu_hour === 1.1 &&
    proposal.cost_estimate?.secure_reference_rate_usd_per_hour === 0.74 &&
    proposal.cost_estimate?.ongoing_retained_volume_charge_usd_per_month === 7,
  "COST_BOUNDARY",
);
assert(
  proposal.provider_boundary?.provider_calls_authorized === false &&
    proposal.provider_boundary?.read_only_provider_calls_authorized === false &&
    proposal.provider_boundary?.provider_mutations_authorized === false &&
    proposal.provider_boundary?.gpu_use_authorized === false &&
    proposal.provider_boundary?.authority_file_present === false &&
    proposal.provider_boundary?.authority_path === null &&
    proposal.provider_boundary?.authority_sha256 === null &&
    proposal.provider_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.provider_boundary?.anchor_refresh_authorized === false &&
    proposal.provider_boundary?.marker_mutation_authorized === false &&
    proposal.provider_boundary?.v2_08_authorized === false,
  "PROVIDER_BOUNDARY",
);
assert(
  Array.isArray(proposal.negative_tests_and_stop_conditions) &&
    proposal.negative_tests_and_stop_conditions.length === 8 &&
    proposal.negative_tests_and_stop_conditions.some((item) => item.includes("CF_VERSION_METADATA")) &&
    proposal.negative_tests_and_stop_conditions.some((item) => item.includes("consumed Attempt43")),
  "NEGATIVE_TESTS",
);

for (const [config, max, expectedHash] of [
  [max1, 1, expected.max1],
  [max2, 2, expected.max2],
]) {
  assert(
    sha(max === 1 ? paths.max1 : paths.max2) === expectedHash &&
      config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v10" &&
      config.image === expected.image &&
      config.image_source_commit === expected.imageSource &&
      config.model_manifest_sha256 === expected.manifest &&
      config.network_volume_id_sha256 === expected.mageVolume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.control_source_commits?.includes(expected.activationCanonicalizer) &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.workers_min === 0 &&
      config.workers_max === max &&
      config.flashboot === true &&
      config.cloudflare_version_metadata_contract?.binding === "CF_VERSION_METADATA" &&
      config.cloudflare_version_metadata_contract?.current_anchor_version_id_sha256 ===
        expected.anchorVersion &&
      config.cloudflare_version_metadata_contract?.current_anchor_record_sha256 ===
        expected.anchorRecord &&
      config.cloudflare_version_metadata_contract?.current_anchor_index_oldest_to_newest === 7 &&
      config.cloudflare_version_metadata_contract?.required_consecutive_version_metadata_matches ===
        16 &&
      config.cloudflare_version_metadata_contract?.protected_config_baseline_sha256 ===
        expected.configBaseline &&
      config.cloudflare_version_metadata_contract?.protected_config_projected_marker_sha256 ===
        "sha256:c643af2fe7d6325396b2527bcbe92d9422c6126aa3328530b8dfaa36b7bc08e5" &&
      config.cloudflare_version_metadata_contract?.protected_config_final_sha256 ===
        expected.configBaseline &&
      config.cloudflare_version_metadata_contract?.marker_state === "DISABLED" &&
      config.cloudflare_version_metadata_contract?.marker_mutation_required === false &&
      config.cloudflare_version_metadata_contract?.config_mutation_required === false &&
      config.cloudflare_version_metadata_contract?.anchor_refresh_required === false,
    `CONFIG_${max}`,
  );
}

assert(
  preflight.schema_version === "videoforge.v2-07-attempt44-read-only-preflight/v1" &&
    preflight.attempt === 44 &&
    preflight.read_only === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.external_spend_usd === 0 &&
    preflight.inventory?.pods === 0 &&
    preflight.inventory?.endpoints === 0 &&
    preflight.inventory?.private_templates === 0 &&
    preflight.inventory?.active_serverless_workers === 0 &&
    preflight.inventory?.retained_volumes?.length === 2 &&
    preflight.selected_gpu?.offering === "NVIDIA GeForce RTX 4090" &&
    preflight.selected_gpu?.region === "EU-RO-1" &&
    preflight.selected_gpu?.availability === "HIGH" &&
    preflight.billing?.baseline_endpoint_spend_usd === 1.5709891965379938 &&
    preflight.billing?.incremental_spend_usd === 0 &&
    preflight.billing?.cap_input_non_authorizing === true &&
    preflight.billing?.cap_authority === null &&
    preflight.protected_config?.baseline_sha256 === expected.configBaseline &&
    preflight.protected_config?.mode === "0600" &&
    preflight.protected_config?.marker_state === "DISABLED" &&
    preflight.protected_config?.mutation_planned === false &&
    preflight.authority?.authority_recorded === false &&
    preflight.authority?.maximum_cumulative_finite_spend_usd === null,
  "PREFLIGHT",
);
const volumeMap = new Map(preflight.inventory.retained_volumes.map((volume) => [volume.purpose, volume]));
assert(
  volumeMap.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumeMap.get("Mage")?.size_gb === 50 &&
    volumeMap.get("Mage")?.region === "EU-RO-1" &&
    volumeMap.get("Mage")?.mount === "/runpod-volume" &&
    volumeMap.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumeMap.get("SoulX")?.size_gb === 50 &&
    volumeMap.get("SoulX")?.region === "EU-RO-1",
  "VOLUMES",
);
assert(
  anchor.schema_version === "videoforge.v2-07-attempt44-cloudflare-anchor-observation/v1" &&
    anchor.current_anchor?.version_id_sha256 === expected.anchorVersion &&
    anchor.current_anchor?.record_sha256 === expected.anchorRecord &&
    anchor.current_anchor?.index_oldest_to_newest === 7 &&
    anchor.current_anchor?.window_length === 10 &&
    anchor.current_anchor?.newest_seven_retained === true &&
    anchor.activation_probe_contract?.required_consecutive_version_metadata_matches === 16 &&
    anchor.activation_probe_contract?.expected_status === 403 &&
    anchor.activation_probe_contract?.expected_code === "V207_AUTHORITY_REJECTED" &&
    anchor.activation_probe_contract?.mixed_edge_status_or_version_drift === "FAIL_CLOSED" &&
    anchor.anchor_refresh?.required === false &&
    anchor.anchor_refresh?.authorized === false &&
    anchor.anchor_refresh?.marker_mutation === false,
  "ANCHOR_EVIDENCE",
);
assert(
  reconciliation.schema_version === "videoforge.v2-07-attempt44-runpod-reconciliation/v1" &&
    reconciliation.stable_read_count === 3 &&
    reconciliation.inventory?.pods === 0 &&
    reconciliation.inventory?.endpoints === 0 &&
    reconciliation.inventory?.private_templates === 0 &&
    reconciliation.inventory?.active_serverless_workers === 0 &&
    reconciliation.inventory?.running_pods === 0 &&
    reconciliation.inventory?.retained_volume_count === 2 &&
    reconciliation.billing?.baseline_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.final_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.incremental_spend_usd === 0 &&
    reconciliation.billing?.cap_input_non_authorizing === true &&
    reconciliation.billing?.cap_authority === null,
  "RECONCILIATION_EVIDENCE",
);
assert(
  acceptance.schema_version ===
    "videoforge.v2-07-attempt44-version-metadata-probe-candidate-acceptance/v1" &&
    acceptance.attempt === 44 &&
    acceptance.qualification_status === "NOT_QUALIFIED" &&
    acceptance.result === "PROVIDER_FREE_CANDIDATE_PENDING_FRESH_APPROVAL" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.authority_path === null &&
    acceptance.candidate?.authority_sha256 === null &&
    acceptance.candidate?.authority_recorded === false &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
    acceptance.candidate?.fresh_numeric_cap_required === true &&
    acceptance.candidate?.provider_calls_authorized === false &&
    acceptance.candidate?.provider_mutations_authorized === false &&
    acceptance.candidate?.gpu_use_authorized === false,
  "ACCEPTANCE",
);
assert(
  acceptance.provider_boundary?.provider_calls === false &&
    acceptance.provider_boundary?.provider_mutations === false &&
    acceptance.provider_boundary?.gpu_use === false &&
    acceptance.provider_boundary?.authority_active === false &&
    acceptance.provider_boundary?.authority_file_present === false &&
    acceptance.provider_boundary?.cap_usd === null &&
    acceptance.version_metadata_probe?.required_consecutive_matches === 16 &&
    acceptance.version_metadata_probe?.anchor_refresh_required === false,
  "ACCEPTANCE_BOUNDARY",
);

const authorityPath =
  "evidence/acceptance/VF-10-07/2026-08-23-attempt44-version-metadata-probe-candidate/approved-authority.json";
const expectedRuntimeContract = {
  offline_sealed_manifest_verification: true,
  real_initialization_warmup: true,
  application_read_only_model_files: true,
  job_local_scratch: "/tmp/videoforge-v2-07/${job_id}",
  scoped_r2_output_ports: true,
  durable_per_unit_resume: true,
  seed_then_distinct_replacement_process_required: true,
  replacement_only_unresolved_units: true,
  accepted_units_never_regenerated: true,
  no_extra_probe_dispatch: true,
  runtime_download_or_quantization: false,
  cache_escape_forbidden: true,
  completed_reader_results_require_full_output_readback_and_v3_receipt_verification: true,
  provider_response_body_url_ids_or_secrets_retained: false,
  fresh_cap_is_incremental_over_baseline: true,
  downward_or_invalid_billing_read_fails_closed: true,
  rollback_anchor_must_be_in_newest_seven_of_bounded_ten: true,
  exact_active_version_record_hash_and_route_fingerprint_restore_required: true,
};
assert(
  authority.schema_version ===
    "videoforge.v2-07-attempt44-version-metadata-probe-authority/v1" &&
    authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === expected.attempt &&
    authority.authority_mode === "bounded_mutation" &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal?.path === "combined-live-proposal.json" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.acceptance?.path === "acceptance.json" &&
    authority.acceptance?.sha256 === expected.acceptance &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW-or-better" &&
    authority.approval?.observed_availability_at_proposal === "HIGH" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.approval?.historical_cap_reused === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.approval?.single_use === true &&
    authority.approval?.consumed === false &&
    authority.approval?.anchor_refresh_authorized === false &&
    authority.approval?.recurring_retained_volume_charge_usd_per_month === 7 &&
    authority.approval?.recurring_charge_is_outside_finite_cap === true,
  "AUTHORITY_SCOPE_AND_APPROVAL",
);
assert(
  authority.lineage?.image === expected.image &&
    authority.lineage?.image_source_commit === expected.imageSource &&
    authority.lineage?.model === expected.model &&
    authority.lineage?.model_manifest_sha256 === expected.manifest &&
    authority.lineage?.volume_id_sha256 === expected.mageVolume &&
    authority.lineage?.volume_size_gb === 50 &&
    authority.lineage?.volume_region === "EU-RO-1" &&
    authority.lineage?.volume_mount === "/runpod-volume" &&
    authority.lineage?.model_root === "/runpod-volume/mage-model" &&
    authority.lineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
    authority.lineage?.initial_config_sha256 === expected.max1 &&
    authority.lineage?.concurrent_reader_config_sha256 === expected.max2 &&
    authority.lineage?.handler_source_sha256 === expected.handler &&
    authority.lineage?.execution_subset_schema_sha256 === expected.subset &&
    authority.lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    authority.lineage?.flashboot === true &&
    authority.lineage?.protected_config?.baseline_sha256 === expected.configBaseline &&
    authority.lineage?.protected_config?.mode === "0600" &&
    authority.lineage?.protected_config?.version_metadata_binding === "CF_VERSION_METADATA" &&
    authority.lineage?.protected_config?.marker_state === "DISABLED" &&
    authority.lineage?.protected_config?.config_mutation_authorized === false &&
    authority.lineage?.protected_config?.marker_mutation_authorized === false,
  "AUTHORITY_IDENTITY_AND_CONFIG",
);
assert(
  JSON.stringify(authority.approved_operations?.operations) ===
      JSON.stringify(proposal.approved_operations_to_be_proposed_once_after_fresh_approval) &&
    authority.approved_operations?.proposal_sha256 === expected.proposal &&
    authority.approved_operations?.all_and_only_listed_operations_authorized === true &&
    authority.approved_operations?.runpod_mutation_authorized_pending_execution === true &&
    authority.approved_operations?.gpu_use_authorized_pending_execution === true &&
    authority.approved_operations?.cloudflare_mutation_authorized === true &&
    authority.approved_operations?.scoped_signer_worker_route_activation_authorized_pending_execution ===
      true &&
    authority.approved_operations?.anchor_refresh_authorized === false &&
    authority.approved_operations?.image_republication_authorized === false &&
    authority.approved_operations?.retained_volume_mutation_authorized === false &&
    authority.approved_operations?.model_download_preparation_or_quantization_authorized === false &&
    authority.approved_operations?.gpu_or_region_fallback_authorized === false &&
    authority.approved_operations?.v2_08_authorized === false,
  "AUTHORITY_OPERATIONS_BOUNDARY",
);
assert(
  JSON.stringify(authority.runtime_contract) === JSON.stringify(expectedRuntimeContract) &&
    authority.cleanup_and_rollback?.restore_max1_after_max2_reader_proof === true &&
    authority.cleanup_and_rollback?.terminal_workers_zero_required === true &&
    authority.cleanup_and_rollback?.exact_disposable_cleanup_on_failure === true &&
    authority.cleanup_and_rollback?.ephemeral_signer_delete_required === true &&
    authority.cleanup_and_rollback?.temporary_worker_route_rollback_required === true &&
    authority.cleanup_and_rollback?.pre_mutation_route_fingerprint_required ===
      "404 V207_ROUTE_DISABLED" &&
    authority.cleanup_and_rollback?.stop_on_uncertain_cleanup === true &&
    authority.cleanup_and_rollback?.stop_on_cap_risk_or_downward_billing === true &&
    authority.cleanup_and_rollback?.protected_config_baseline_sha256 === expected.configBaseline &&
    authority.cleanup_and_rollback?.protected_config_mode === "0600" &&
    authority.cleanup_and_rollback?.marker_state === "DISABLED" &&
    authority.cleanup_and_rollback?.anchor_refresh_required === false &&
    authority.cleanup_and_rollback?.retained_volumes_untouched === true &&
    authority.cleanup_and_rollback?.settled_incremental_spend_required_within_cap === true &&
    authority.retention?.durable_outputs_before_provider_expiry === true &&
    authority.retention?.v3_authority_provenance_receipts_required === true &&
    authority.retention?.accepted_units_never_regenerated === true &&
    authority.retention?.replacement_only_unresolved_units === true &&
    authority.retention?.provider_response_body_urls_ids_and_secrets_not_retained === true &&
    authority.retention?.endpoint_template_retention_on_success === true &&
    authority.retention?.retained_volume_billing_separate_from_finite_cap === true &&
    authority.retention?.ongoing_retained_volume_charge_usd_per_month === 7 &&
    JSON.stringify(authority.stop_conditions) ===
      JSON.stringify(proposal.negative_tests_and_stop_conditions),
  "AUTHORITY_CLEANUP_RETENTION_STOPS",
);
assert(
  authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.gpu_use_authorized_pending_execution === true &&
    authority.execution_boundary?.anchor_refresh_authorized === false &&
    authority.execution_boundary?.provider_calls_completed === false &&
    authority.execution_boundary?.external_spend_usd === 0 &&
    authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.execution_boundary?.retained_volume_mutation_authorized === false &&
    authority.execution_boundary?.v2_08_authorized === false &&
    authority.lineage?.prior_attempt?.attempt === 43 &&
    authority.lineage?.prior_attempt?.authority_consumed === true &&
    authority.lineage?.prior_attempt?.settled_incremental_spend_usd === 0,
  "AUTHORITY_EXECUTION_BOUNDARY",
);

const activation = text(paths.activation);
const activationTest = text(paths.activationTest);
assert(sha(paths.activation) === expected.rawActivation, "ACTIVATION_RAW_HASH");
const pointerMatches = [
  ...activation.matchAll(
    /(\bexport const V207_PENDING_PROPOSAL_SHA256\s*=\s*(?:\r?\n\s*)?")sha256:([a-f0-9]{64})("\s+as const;)/gu,
  ),
];
assert(pointerMatches.length === 1, "ACTIVATION_POINTER_COUNT");
assert(`sha256:${pointerMatches[0][2]}` === expected.proposal, "ACTIVATION_ATTEMPT44_POINTER");
assert(
  /export const V207_APPROVED_AUTHORITY_SHA256: string \| null = "sha256:a376fb6782c1512e50c8586b060bf57d030685dba3df4b5a69650e195595ab5f";/u.test(
    activation,
  ) &&
    /export const V207_APPROVED_FINITE_CAP_USD: number \| null = 4;/u.test(activation) &&
    /export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = false;/u.test(activation) &&
    activation.includes("V207_PENDING_CONTROL_SOURCE_COMMIT") &&
    activation.includes("78062a729fd2e321fbe3b71dc9e7e57b5c8b3fe6"),
  "ACTIVATION_APPROVED_BINDINGS",
);
let canonicalActivation = activation;
for (const [pattern, replacement, label] of [
  [
    /(\bexport const V207_PENDING_PROPOSAL_SHA256\s*=\s*")sha256:[a-f0-9]{64}("\s+as const;)/gu,
    `$1sha256:${"0".repeat(64)}$2`,
    "PROPOSAL",
  ],
  [
    /(\bexport const V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*)(?:"sha256:[a-f0-9]{64}"|null)(\s*;)/gu,
    "$1null$2",
    "AUTHORITY",
  ],
  [
    /(\bexport const V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*)(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)(\s*;)/gu,
    "$1null$2",
    "CAP",
  ],
  [
    /(\bexport const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*)(?:true|false|null)(\s*;)/gu,
    "$1null$2",
    "ANCHOR",
  ],
]) {
  assert((canonicalActivation.match(pattern)?.length ?? 0) === 1, `ACTIVATION_CANONICAL_${label}_COUNT`);
  canonicalActivation = canonicalActivation.replace(pattern, replacement);
}
assert(
  `sha256:${createHash("sha256").update(canonicalActivation).digest("hex")}` ===
    expected.canonicalActivation,
  "ACTIVATION_CANONICAL_HASH",
);
assert(
  activationTest.includes("Attempt44") &&
    activationTest.includes("V207_FINITE_CAP_REQUIRED") &&
    activationTest.includes("V207_FINITE_CAP_MISMATCH") &&
    activationTest.includes(expected.proposal.slice(7)) &&
    activationTest.includes("V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED).toBe(false)"),
  "ACTIVATION_APPROVAL_TESTS_PRESENT",
);
try {
  execFileSync(
    "pnpm",
    ["--filter", "@videoforge/web", "exec", "vitest", "run", "src/server/providers/v207-activation-authority.test.ts", "--reporter=dot"],
    { cwd: root, stdio: "pipe", encoding: "utf8" },
  );
} catch {
  fail("ACTIVATION_RUNTIME_NEGATIVE_PROBE");
}

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
const candidatePath =
  "evidence/acceptance/VF-10-07/2026-08-23-attempt44-version-metadata-probe-candidate/combined-live-proposal.json";
const acceptancePath =
  "evidence/acceptance/VF-10-07/2026-08-23-attempt44-version-metadata-probe-candidate/acceptance.json";
const preflightPath =
  "evidence/acceptance/VF-10-07/2026-08-23-attempt44-version-metadata-probe-candidate/read-only-preflight.json";
for (const [name, surface] of Object.entries({ state, gates, start, task })) {
  assert(surface.includes(candidatePath), `${name.toUpperCase()}_CANDIDATE_POINTER`);
  assert(surface.includes(expected.proposal), `${name.toUpperCase()}_PROPOSAL_POINTER`);
  assert(surface.includes(acceptancePath), `${name.toUpperCase()}_ACCEPTANCE_POINTER`);
  assert(surface.includes(expected.acceptance), `${name.toUpperCase()}_ACCEPTANCE_HASH_POINTER`);
  assert(surface.includes(authorityPath), `${name.toUpperCase()}_AUTHORITY_POINTER`);
  assert(surface.includes(expected.authority), `${name.toUpperCase()}_AUTHORITY_HASH_POINTER`);
  assert(surface.includes(preflightPath), `${name.toUpperCase()}_PREFLIGHT_POINTER`);
  assert(surface.includes(expected.max1) && surface.includes(expected.max2), `${name.toUpperCase()}_CONFIG_POINTER`);
  assert(surface.includes("V2-08"), `${name.toUpperCase()}_V2_08_FENCE`);
}
const stateHeader = state.slice(0, state.indexOf("current_goal_boundary:"));
assert(
  stateHeader.includes("phase: serverless_v2_v2_07_attempt44_version_metadata_probe_bounded_mutation") &&
    stateHeader.includes("task_stage: bounded_mutation_pending_execution") &&
    stateHeader.includes("provider_calls_authorized: true") &&
    stateHeader.includes("read_only_provider_calls_authorized: false") &&
    stateHeader.includes("remote_or_cloud_mutations_authorized: true") &&
    stateHeader.includes("gpu_use_authorized: true") &&
    stateHeader.includes("maximum_external_spend_usd: 4"),
  "STATE_ACTIVE_BOUNDARY",
);
assert(
  gates.includes("authority_mode: bounded_mutation_attempt44_pending_execution") &&
    gates.includes("pending_numeric_cap_usd: 4") &&
    gates.includes("provider_calls_authorized: true") &&
    gates.includes("provider_mutations_authorized: true") &&
    gates.includes("gpu_use_authorized: true") &&
    gates.includes("v2_08_authorized: false"),
  "GATES_ACTIVE_BOUNDARY",
);
assert(
  state.includes("provider_authority_attempt44") &&
    state.includes("authority_state: APPROVED_SINGLE_USE_PENDING_EXECUTION") &&
    state.includes("authority_mode: bounded_mutation") &&
    state.includes(`authority_path: ${authorityPath}`) &&
    state.includes(`authority_sha256: "${expected.authority}"`) &&
    state.includes("cap_usd: 4") &&
    state.includes("anchor_refresh_authorized: false") &&
    state.includes("authority_recorded: true") &&
    state.includes("provider_calls_authorized: true") &&
    state.includes("provider_mutations_authorized: true") &&
    state.includes("gpu_use_authorized: true") &&
    state.includes("maximum_cumulative_finite_spend_usd: 4") &&
    state.includes("v2_08_authorized: false"),
  "STATE_AUTHORITY_RECORD",
);

console.log(
  `V2-07 Attempt44 approved bounded-mutation validation PASS (${expected.proposal}; ${expected.authority}; cap=$4; anchor-refresh disabled; Attempt43 env rejected)`,
);
