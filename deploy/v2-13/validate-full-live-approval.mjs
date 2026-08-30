import { createHash } from "node:crypto";

const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const PROPOSAL_SCHEMA_V2 = "videoforge.v2-13-full-live-completion-proposal/v2";
const PROPOSAL_SCHEMA_V3 = "videoforge.v2-13-full-live-completion-proposal/v3";
const PROPOSAL_SCHEMA_V4 = "videoforge.v2-13-full-live-completion-proposal/v4";
const PROPOSAL_SCHEMA_V5 = "videoforge.v2-13-full-live-completion-proposal/v5";
const APPROVAL_SCHEMA_V1 = "videoforge.v2-13-full-live-user-approval/v1";
const APPROVAL_SCHEMA_V2 = "videoforge.v2-13-full-live-user-approval/v2";
const APPROVAL_SCHEMA_V3 = "videoforge.v2-13-full-live-user-approval/v3";
const SUCCESSOR_RELEASE_TAG = "videoforge-v2-13-release-20260830-v5";
const SUCCESSOR_RELEASE_SOURCE_COMMIT = "417e84d4f021699337e9bd411753777d689728d7";
const SUCCESSOR_RELEASE_MODE = "SUCCESSOR_TAG_CREATION";
const EXACT_PREDECESSOR_RELEASE_ATTEMPT = Object.freeze({
  authority_id: "v2-13-full-live-20260829-052951z-6852970d",
  authority_record_commit: "13f9a96ff62d192a892d3e7bc778d5d8c368d72d",
  proposal_sha256: "sha256:6852970d91153a5c61fcee5b4f1f8bac717cd6c302538b71dda3ff8dde86b7ce",
  terminal_state_sha256: "sha256:f59fc1f3f989ff9b694053d911d9e38921e3f14b6e850afd2d5472318efdf2a9",
  terminal_state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
  terminal: "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED",
  failure_boundary: "OPERATION_EXECUTION",
  failure_code: "FULL_LIVE_OPERATION_FAILED",
  exact_tag_name: "videoforge-v2-13-release-20260826-v3",
  exact_tag_target_commit: "15af5e20ce3c80eb61d5d1e807a87e8840ed9685",
  tag_create_result_sha256:
    "sha256:9bd704cc89e5e5bfd511204a9fc716ac61f646d2b5cfe2708f40dc360ff05fc6",
  tag_push_result_sha256: "sha256:a1be0e2f54ed9bd7f1b7aa6b5fd343ceb86765685a7e732297f4890f273ef6c5",
  tag_readback_result_sha256:
    "sha256:b5d0d2580b92a42fef169b7605e702eeb693e67ca1d4f41681bff478ab806c35",
  mage_workflow_run_id: "33236590768",
  mage_workflow_dispatch_result_sha256:
    "sha256:5d00a6673c8f714c764898a52c5098bee07be3b8d88ef03f8bdec7028a68494f",
  mage_workflow_verification_result_sha256:
    "sha256:4f96db35939e769827bfc833bb7337809b453e6c91f42502479e5ea042623a20",
  mage_image_digest: "sha256:2fb91935d142ad44b9dad28d997c5a1c1861067b22ff4c8931d24faf97fd3b3a",
  mage_evidence_sha256: "sha256:9883ab7a174d2ca7de330220b568a1a2f8bf89688286d8e1dbb260bc74c52129",
  mage_public_manifest_sha256:
    "sha256:2fb91935d142ad44b9dad28d997c5a1c1861067b22ff4c8931d24faf97fd3b3a",
  mage_workflow_conclusion: "success",
  mage_public_all_blobs_verified: true,
});
// This is the prior successor attempt that reached a terminal SoulX image-build failure.  It is
// retained as a separate fact for the v5 successor lineage; it must never be substituted for the
// independently verified predecessor Mage readback above.
const EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT = Object.freeze({
  authority_id: "v2-13-full-live-20260830-021108z-d3bfbb40",
  authority_record_commit: "4e199ca114bfd9d5850c616fc4a237214f6c9ae5",
  proposal_sha256: "sha256:d3bfbb4039a894ed469abfa303d3fbc50a7ad7e358de19b730e4229602ab598d",
  proposal_record_commit: "c2b90f8a6f443978ef013ef6daed4750f4e2e2ec",
  approval_sha256: "sha256:9926d14ff50659bd421fa60bb882cc0249a37aa044acf7c3c4a1af2a3b806c46",
  authority_sha256: "sha256:4e45de5838c53064e68aed1700b39aa26e8545f7e723df5baa98e0d4e2c546bb",
  terminal_state_sha256: "sha256:76e52ec7a273cda26ec1c87ba473f060927d85218560ccef3ee8f0a045aa064e",
  terminal_state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
  terminal: "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED",
  failure_boundary: "OPERATION_EXECUTION",
  failure_code: "WORKFLOW_RUN_TERMINAL_FAILURE",
  failure_operation_id: "soulx-image-workflow-verification",
  release_source_commit: "15af5e20ce3c80eb61d5d1e807a87e8840ed9685",
  mage_workflow_run_id: "33236590768",
  mage_redispatch_performed: false,
  mage_predecessor_verified: true,
  soulx_workflow_dispatch_performed: true,
  soulx_workflow_run_id: "33287914248",
  soulx_workflow_attempt: 1,
  soulx_workflow_conclusion: "failure",
  database_bootstrap_performed: false,
  production_activation_performed: false,
  runpod_work_dispatched: false,
  gpu_use: false,
  attempt_reserved_usd: 0,
  attempt_settled_usd: 0,
  authority_reusable: false,
  production_state: "DISABLED_UNQUALIFIED",
});

function assertDistinctV4SuccessorAuthority(proposalSchema, authorityId, predecessor) {
  if (
    [PROPOSAL_SCHEMA_V4, PROPOSAL_SCHEMA_V5].includes(proposalSchema) &&
    authorityId === predecessor?.authority_id
  )
    fail("SUCCESSOR_AUTHORITY_REPLAY");
  return true;
}
const EXPECTED_SERVERLESS_FLEX_RATE_SOURCE = Object.freeze({
  provider: "RunPod",
  product: "SERVERLESS_FLEX",
  gpu: "NVIDIA GeForce RTX 4090",
  region: "EU-RO-1",
  billing_unit: "USD_PER_GPU_SECOND",
  rate_usd_per_second: 0.00031,
  rate_usd_per_gpu_hour: 1.116,
  source: "OFFICIAL_CURRENT_RUNPOD_SERVERLESS_FLEX_PRICING_SNAPSHOT",
});
const EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR =
  EXPECTED_SERVERLESS_FLEX_RATE_SOURCE.rate_usd_per_gpu_hour;
// The validator is part of the proposal/authority verifier, so embedding the hash of this
// source file inside itself would require an impossible fixed point.  Bind it to the exact
// release commit's tree instead; the outer authority verifier reads that commit/path and hashes
// the tree entry before consuming authority.
const EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING = Object.freeze({
  mode: "EXTERNAL_GIT_COMMIT_TREE_ENTRY",
  commit_field: "source.release_source_commit",
  tree_entry_path: "deploy/v2-13/validate-full-live-approval.mjs",
  verification: "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256",
  embedded_current_file_sha256: false,
  self_hash_forbidden: true,
});
const EXACT_APPROVAL_VALIDATOR_EXECUTION_CONTROL_BINDING = Object.freeze({
  mode: "EXTERNAL_GIT_COMMIT_TREE_ENTRY",
  commit_field: "source.execution_control.commit",
  tree_entry_path: "deploy/v2-13/validate-full-live-approval.mjs",
  verification: "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256",
  embedded_current_file_sha256: false,
  self_hash_forbidden: true,
});
const EXACT_V3_RELEASE_COMPONENTS = Object.freeze({
  full_live_executor: Object.freeze({
    path: "deploy/v2-13/full-live-executor.mjs",
    sha256: "sha256:78b590e3b4ca8fe5ca64f8e187e00128141341f2d80361be5cf700507bfad910",
    sole_canonical_live_mutation_path: true,
  }),
  full_live_adapters: Object.freeze({
    path: "deploy/v2-13/full-live-adapters.mjs",
    sha256: "sha256:19256a5a9872203ed29062360a0f962374c5f37a254b9591bd48fa7af701ea20",
  }),
  promotion: Object.freeze({
    path: "deploy/v2-13/promote-qualified-production.mjs",
    sha256: "sha256:2cf4cf6b13c387542a2f3c380d38c519470655aebac237edeca1b2e77f9697d2",
  }),
  guarded_activation: Object.freeze({
    path: "deploy/v2-13/guarded-activation.mjs",
    sha256: "sha256:b5be2bb99a151e82129f685b083ae78db2395f46e0dbf3ff62822fb20f1cc5e8",
  }),
  orchestration_authority: Object.freeze({
    path: "deploy/v2-13/full-live-orchestration-authority.mjs",
    sha256: "sha256:ce4a92127d098392504bd1641d61865d3c94cfb7624de6939fe31157f1199e03",
  }),
  typescript_cli_bridge: Object.freeze({
    path: "apps/web/src/server/providers/v213-full-live-cli.ts",
    sha256: "sha256:7fb8b3647dc44d26b0e49c5a0fa206c4e98e4653fbbfe88f990ec0eb6f4890c0",
  }),
  runpod_dual_lane_transport: Object.freeze({
    path: "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
    sha256: "sha256:1982c450b215978528e9688cba62df07f94e014e55e007ec32f0f38500a965c2",
  }),
  direct_qualification_materializer: Object.freeze({
    path: "apps/web/src/server/providers/v213-direct-qualification-materializer.ts",
    sha256: "sha256:faf895d2c5e72b133090a7d9913d72e86fc5f1c5d2c26f2d583593c2cc3d9baa",
  }),
  hosted_qualification_materializer: Object.freeze({
    path: "apps/web/src/server/hosted/v213-qualification-materializer.ts",
    sha256: "sha256:663b084d70789e935fb5f26b8807bab45597129773de9e5395f660414e97d0e3",
  }),
  materialization_seed_builder: Object.freeze({
    path: "deploy/v2-13/build-materialization-seed.mjs",
    sha256: "sha256:61d16bf3e3d8c1e6ae51420930c39e7eb59a5bfe0253e2e04a3b2d36dce984d1",
  }),
  materialization_seed_envelope_schema: Object.freeze({
    path: "project-context/evidence/serverless_worker_job_envelope_v3.schema.json",
    sha256: "sha256:cce6fab312222b1068ce1764ed6af2387b8f7f0904fd28270c0148cfdde37a28",
  }),
  materialization_seed_qualification_case_source: Object.freeze({
    path: "apps/web/src/server/providers/v213-dual-lane-live.ts",
    sha256: "sha256:3716aeb1601390b4800f094ecf29823c2f42e25fa64e1b16e3481c5bab2ee8a2",
  }),
  materialization_seed_mage_case_validator: Object.freeze({
    path: "workers/image-media/src/videoforge_image_media/mage_production.py",
    sha256: "sha256:6fb66457b5d43168e0a41a5b2040a7d89fc9143b261b221c0c97f424d603c291",
  }),
  materialization_seed_soulx_case_validator: Object.freeze({
    path: "workers/avatar-primary/soulx_serverless.py",
    sha256: "sha256:752b600d5428bb253d83d0c6044296bbcb4bb29f17d4df37c40fcf63c19b30e4",
  }),
  materialization_seed_mage_case_generator: Object.freeze({
    path: "deploy/v2-13/generate-mage-qualification-case.mjs",
    sha256: "sha256:f94f5665b2d7b453f630b5649b0a5c89e5f77f16c497d13718960f3e9ac8346c",
  }),
  materialization_seed_soulx_case_generator: Object.freeze({
    path: "deploy/v2-13/generate-soulx-qualification-cases.mjs",
    sha256: "sha256:f78bf77c409c8a8b4d43ba91cd3d3d35f239e90a91911f031b67ca160ef64453",
  }),
  media_worker_release_readback: Object.freeze({
    path: "deploy/v2-13/media-worker-release-readback.mjs",
    sha256: "sha256:933e78b9c9bddeb7681af0f4a397d2352c1253199d6b4d8a3af874aad3c959d7",
  }),
  migration_0045: Object.freeze({
    path: "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
    sha256: "sha256:1365c546595f57aaca61950c39f0f52c44986dab2543d21eb60b5773af12929b",
  }),
  operator_grants: Object.freeze({
    path: "deploy/v2-13/neon-full-live-operator-grants.sql",
    sha256: "sha256:38c80de06ef6eff67a03be35326150cf742393efc07fd43ea0b30780c28afab6",
  }),
  reconciler_grants: Object.freeze({
    path: "deploy/v2-13/neon-pair-reconciler-grants.sql",
    sha256: "sha256:7d6fc701c5f71c1a3dc09ee08268e4f8caa58e69a85594258ce864aa673b49a7",
  }),
  runtime_grants: Object.freeze({
    path: "deploy/v2-06/neon-runtime-grants.sql",
    sha256: "sha256:df43df13634319fa97e8f19f4459af5e01c42b8f144f00c8527f5f873ec7085f",
  }),
  materialization_seed_production_input_validator: Object.freeze({
    path: "deploy/v2-13/validate-materialization-seed-production-input.mts",
    sha256: "sha256:d2d8dc879bb29fbf7df207885b2d604d90f0b3047710fbec9e794afd745f4682",
  }),
  production_config_validator: Object.freeze({
    path: "deploy/v2-13/validate-production-config.mjs",
    sha256: "sha256:9860d815d101dd25b8a98ef5231df6054a42c9820edabaf6bb871dcaf5fc83f6",
  }),
  pg_service_validator: Object.freeze({
    path: "deploy/v2-06/validate-pg-service.mjs",
    sha256: "sha256:08fce81dcb856d365b9aaa728e16f827fcb07ac4ce027d20feeab3972d246e7e",
  }),
  migration_manifest: Object.freeze({
    path: "packages/control-plane/migrations/manifest.json",
    sha256: "sha256:43f10592907b027afb870d2beb906e91998319da50f07fca7f64ed310fa1db47",
  }),
  source_closure_manifest: Object.freeze({
    path: "deploy/v2-13/full-live-source-closure.json",
    sha256: "sha256:0f8fc9367cc0aa2aec2e4f55a5236de3e828d14dc8e9fb85a8389408141734eb",
  }),
  approval_validator: Object.freeze({
    path: "deploy/v2-13/validate-full-live-approval.mjs",
    source_commit_tree_binding: EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  }),
});
const EXACT_V4_EXECUTION_CONTROL_COMPONENTS = Object.freeze({
  approval_validator: Object.freeze({
    path: "deploy/v2-13/validate-full-live-approval.mjs",
    source_commit_tree_binding: EXACT_APPROVAL_VALIDATOR_EXECUTION_CONTROL_BINDING,
  }),
  avatar_primary_workflow: Object.freeze({
    path: ".github/workflows/avatar-primary-serverless-image.yml",
    sha256: "sha256:9d6f37d1369b4b50de8053efb252b39c8728a51e578593ddafcfc9f02aa28ac2",
  }),
  backup_metadata_snapshot: Object.freeze({
    path: "packages/control-plane/src/backup/metadata-snapshot.ts",
    sha256: "sha256:29f344ff71c5f402746d60b7e9cd61d540a6c4b3b4ac9676c93e2d74e214571c",
  }),
  database_vocabulary: Object.freeze({
    path: "packages/control-plane/src/database/vocabulary.ts",
    sha256: "sha256:1a4689fe2951a3b665a5d4d9617020fb1a50488136298d03a453d507849016fd",
  }),
  full_live_adapters: Object.freeze({
    path: "deploy/v2-13/full-live-adapters.mjs",
    sha256: "sha256:f05a3d90f88bcce1d3ab9aca07013497f73fd0cc61b3af298034dce1f7d618d0",
  }),
  full_live_executor: Object.freeze({
    path: "deploy/v2-13/full-live-executor.mjs",
    sha256: "sha256:31235a0359e8c25ff196a7c718988a0facb7da1eca2ffa8646adc575621ea22d",
  }),
  guarded_activation: Object.freeze({
    path: "deploy/v2-13/guarded-activation.mjs",
    sha256: "sha256:e0be9e39607c8aed3646fc8acb1f8c34413565fe5d50915790a69f9165d6eb36",
  }),
  hosted_live_production_adapters: Object.freeze({
    path: "apps/web/src/server/hosted/v213-live-production-adapters.ts",
    sha256: "sha256:99d47a21ff0c32eeb0bad59652c9530355f9c9124e9db96799c216dc88b953d9",
  }),
  mage_workflow: Object.freeze({
    path: ".github/workflows/mage-image.yml",
    sha256: "sha256:b6b0f99099a16fb46f181bd1b07314267c9ae7ad6b62d5b5f7436fdb4f5c5697",
  }),
  materialization_seed_builder: Object.freeze({
    path: "deploy/v2-13/build-materialization-seed.mjs",
    sha256: "sha256:ae61156b811a3f93d26b3d10db35f4d180f2040f8c82fa91b570d3f35603e286",
  }),
  migration_0046: Object.freeze({
    path: "packages/control-plane/migrations/0046_hosted_full_live_cleanup_recovery.sql",
    sha256: "sha256:d98e020a52a1820db811f5c9a679651c1169000ebe28c1d00b35e04c003ba33b",
  }),
  migration_0047: Object.freeze({
    path: "packages/control-plane/migrations/0047_hosted_invite_code_redemption.sql",
    sha256: "sha256:d9840c7033b823a7f9a03e13d7213c50b81d40c7f89423f6c6f4ecc7e8e8649a",
  }),
  migration_0048: Object.freeze({
    path: "packages/control-plane/migrations/0048_hosted_system_avatar_asset_snapshot_reader.sql",
    sha256: "sha256:8181d1c050690a8e15ce5cef7473a5caa872d5f868b18f059574dbd4fcbdc82d",
  }),
  migration_0049: Object.freeze({
    path: "packages/control-plane/migrations/0049_hosted_full_live_promotion_lineage.sql",
    sha256: "sha256:e29c4beeff16c40acb2d598e22d1393d1193abd80cd990805900234c15986e31",
  }),
  migration_manifest: Object.freeze({
    path: "packages/control-plane/migrations/manifest.json",
    sha256: "sha256:0b394a979958ed9fb6d389f37152681297b85c3e86339f373ada15b266bae0dd",
  }),
  operator_grants: Object.freeze({
    path: "deploy/v2-13/neon-full-live-operator-grants.sql",
    sha256: "sha256:584bd3878400a51ed3d5f9ad2da38b49adb983e342c810adfa543463c2a276b5",
  }),
  orchestration_authority: Object.freeze({
    path: "deploy/v2-13/full-live-orchestration-authority.mjs",
    sha256: "sha256:1a92a2d6bc6ac1e9a571531cbfd2da0e677e27d8842e64d5c75a76c042ffca7c",
  }),
  promotion: Object.freeze({
    path: "deploy/v2-13/promote-qualified-production.mjs",
    sha256: "sha256:21fbfa46a01a30ca7d769fb08a20ef46cba523d618c1ba8a898c4a0f2f4defba",
  }),
  reconciler_grants: Object.freeze({
    path: "deploy/v2-13/neon-pair-reconciler-grants.sql",
    sha256: "sha256:5409fe4fa78d92950ec6fb4225c28534b75d029d766c7bdf4ac63c1f9738bac2",
  }),
  runtime_grants: Object.freeze({
    path: "deploy/v2-06/neon-runtime-grants.sql",
    sha256: "sha256:6696c0e4879d97061db9ce11b546045fcdddc878bcd9817737fce5070c108536",
  }),
  runpod_dual_lane_transport: Object.freeze({
    path: "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
    sha256: "sha256:6dc4f248e4bad0d7a5f81c471998f2d13c686f51d93c08b3b3afb53824865ee2",
  }),
  source_closure_manifest: Object.freeze({
    path: "deploy/v2-13/full-live-source-closure.json",
    sha256: "sha256:b941da144d1ac1a5938e02866e01ea55738df81f4623c85ea553cf18ea001dda",
  }),
  typescript_cli_bridge: Object.freeze({
    path: "apps/web/src/server/providers/v213-full-live-cli.ts",
    sha256: "sha256:9298c774d939dcd9a53f565b08f673c27fff7576360a3c69eea00dcf1473b3c0",
  }),
});
// The v5 release source is the immutable 417e84d tree.  Keep the established component map
// shape, but bind every changed entry to the bytes that actually exist in that tree.  Later
// control-plane reseal changes belong in the distinct execution-control map above, never by
// relabeling the release-source bytes.
const EXACT_V5_RELEASE_COMPONENTS = Object.freeze({
  ...EXACT_V3_RELEASE_COMPONENTS,
  full_live_executor: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.full_live_executor,
    sha256: "sha256:6736331f2bc26c5d69359080c242821ebfc593883f2c5239d22d23724e347c93",
  }),
  full_live_adapters: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.full_live_adapters,
    sha256: "sha256:79e0954ff710aacd5c16cecc2e649146e8022df71db812d4eaca95bb81ad6ce8",
  }),
  promotion: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.promotion,
    sha256: "sha256:21fbfa46a01a30ca7d769fb08a20ef46cba523d618c1ba8a898c4a0f2f4defba",
  }),
  guarded_activation: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.guarded_activation,
    sha256: "sha256:b6c40dce89b03f64d3aa0088254c3bfb840b61ae70b59d433ab6f2081745c261",
  }),
  orchestration_authority: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.orchestration_authority,
    sha256: "sha256:83b9c68cd45c182e154e5e7604f84f6db660036c3ba64e630bd0a3f54cb92405",
  }),
  typescript_cli_bridge: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.typescript_cli_bridge,
    sha256: "sha256:63a93988fc68346d6da7167f24c8f7adf3238ea47e98114396625e5d7a6742af",
  }),
  runpod_dual_lane_transport: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.runpod_dual_lane_transport,
    sha256: "sha256:6dc4f248e4bad0d7a5f81c471998f2d13c686f51d93c08b3b3afb53824865ee2",
  }),
  direct_qualification_materializer: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.direct_qualification_materializer,
    sha256: "sha256:a12d9d063b6d85b67ca715ac8b5eb2c27c15dfa389ee1d3c963bb3317f242d37",
  }),
  materialization_seed_builder: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.materialization_seed_builder,
    sha256: "sha256:ee0bd4d9a4afa6d0bc1851a043763b23c0e8788446377cf087dda7dfab8572ea",
  }),
  operator_grants: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.operator_grants,
    sha256: "sha256:584bd3878400a51ed3d5f9ad2da38b49adb983e342c810adfa543463c2a276b5",
  }),
  reconciler_grants: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.reconciler_grants,
    sha256: "sha256:5409fe4fa78d92950ec6fb4225c28534b75d029d766c7bdf4ac63c1f9738bac2",
  }),
  runtime_grants: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.runtime_grants,
    sha256: "sha256:6696c0e4879d97061db9ce11b546045fcdddc878bcd9817737fce5070c108536",
  }),
  migration_manifest: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.migration_manifest,
    sha256: "sha256:0b394a979958ed9fb6d389f37152681297b85c3e86339f373ada15b266bae0dd",
  }),
  source_closure_manifest: Object.freeze({
    ...EXACT_V3_RELEASE_COMPONENTS.source_closure_manifest,
    sha256: "sha256:74c51f94705f890cd5e347320e5ebc1da583147a0328995063e0a72334c0af78",
  }),
});
const EXPECTED_PHASE_CAPS = Object.freeze({
  mage_qualification: 4.5,
  soulx_qualification: 1,
  v2_09_short_hosted_project: 2,
  v2_10_operator_free_ranga_pilot: 2,
  v2_11_two_concurrent_owned_projects: 4,
  v2_12_long_output: 2,
  v2_13_final_two_lane_smoke: 2,
});
const CHECKPOINT_RANGE = Object.freeze([
  "V2-07",
  "V2-08",
  "V2-09",
  "V2-10",
  "V2-11",
  "V2-12",
  "V2-13",
]);
const EXACT_CLOUDFLARE_SECRET_NAMES = Object.freeze([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_RECONCILER_DATABASE_URL",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
  "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
  "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  "RUNPOD_API_KEY",
  "RUNPOD_API_BASE_URL",
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
]);
const EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY = Object.freeze({
  bind_only_previously_captured_run_id: true,
  maximum_reads: 180,
  poll_interval_ms: 10_000,
  wall_timeout_ms: 1_800_000,
  deadline_clock: "MONOTONIC",
  deadline_starts_before_first_cancellation_or_trusted_time_check: true,
  deadline_covers_trusted_time_subprocess_poll_subprocess_wait_download_and_evidence_validation: true,
  every_subprocess_timeout_is_positive_remaining_deadline_ms: true,
  trusted_time_subprocess_timeout_ms: 12_000,
  gh_subprocess_timeout_ms_or_remaining_if_less: 60_000,
  remaining_time_checked_before_and_after_every_await_or_spawn: true,
  every_wait_is_capped_to_positive_remaining_deadline_ms: true,
  no_positive_remaining_time_is_immediate_timeout: true,
  pollable_statuses: Object.freeze(["queued", "in_progress"]),
  accepted_terminal_status: "completed",
  accepted_conclusion: "success",
  immediate_stop_on_completed_non_success: true,
  immediate_stop_on_identity_drift: true,
  immediate_stop_on_authority_expiry: true,
  immediate_stop_on_injected_cancellation: true,
  verifier_dispatch_authorized: false,
  redispatch_authorized: false,
  timeout_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
});
const EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY = Object.freeze({
  operation_id_preserved: "mage-image-workflow-dispatch",
  operation_semantics: "PREDECESSOR_BOUND_READBACK_RECONCILIATION_ONLY",
  exact_predecessor_run_id_field: "supersession.predecessor_release_attempt.mage_workflow_run_id",
  exact_predecessor_digest_field: "supersession.predecessor_release_attempt.mage_image_digest",
  exact_predecessor_evidence_field: "supersession.predecessor_release_attempt.mage_evidence_sha256",
  exact_predecessor_dispatch_result_field:
    "supersession.predecessor_release_attempt.mage_workflow_dispatch_result_sha256",
  exact_predecessor_verification_result_field:
    "supersession.predecessor_release_attempt.mage_workflow_verification_result_sha256",
  fresh_default_branch_dual_workflow_readback_required: true,
  exact_run_completed_success_readback_required: true,
  workflow_dispatch_authorized: false,
  mutation_authorized: false,
  redispatch_authorized: false,
  verification_operation_id_preserved: "mage-image-workflow-verification",
  verification_must_redownload_and_rehash_exact_predecessor_evidence: true,
  verification_must_reverify_exact_predecessor_public_manifest: true,
  drift_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
});
const EXACT_INTERNAL_MATERIALIZATION_POLICY = Object.freeze({
  writer: "FULL_LIVE_EXECUTOR_PLUS_AUTHORITY_BOUND_POST_CONSUMPTION_OPERATOR",
  external_mid_run_writer_authorized: true,
  external_mid_run_writer_exact_operation: "record-workflow-start-authority",
  external_mid_run_writer_requires_consumed_outer_authority: true,
  external_mid_run_writer_schema: "videoforge.v213-post-consumption-materialization/v1",
  external_mid_run_writer_file_env: "VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE",
  external_mid_run_writer_exact_bindings: Object.freeze([
    "fullLiveAuthorityId",
    "outerStateSha256",
    "sourceCommit",
    "proposalSha256",
    "approvalSha256",
    "workerOperatorBearerSha256",
    "appOwnedIdentities",
    "workflowStartAuthority",
    "commandPayloads",
    "acceptanceAuthorities",
    "materializationSha256",
  ]),
  future_result_files_required_at_initial_preflight: false,
  protected_seed_schema: "videoforge.v213-full-live-materialization-seed/v1",
  protected_seed_contains_only: Object.freeze([
    "outer-production-descriptor-base",
    "deterministic-envelope-key-id-only-no-key-material",
    "guarded-authority-base",
    "config-activation-base",
    "null-media-manifest-sentinel",
    "promotion-base",
  ]),
  preconsumption_production_secret_files_or_values_allowed: false,
  postconsumption_production_secret_materialization_operation:
    "bootstrap-prequalification-database",
  materialization_seed_sha256_field: "materialization_seed_sha256",
  materialization_seed_sha256_must_be_bound_in_outer_authority: true,
  materialization_seed_sha256_must_be_bound_in_consumption_record: true,
  materialization_seed_sha256_verified_at_outer_consumption: true,
  materialization_seed_sha256_verified_before_every_seed_read: true,
  materialization_seed_sha256_verified_after_restart_or_recovery: true,
  protected_seed_future_output_hashes_authorized: false,
  initial_production_secrets_schema: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
  initial_seed_endpoint_identity_fields_present: false,
  initial_seed_forbidden_endpoint_identity_fields: Object.freeze([
    "mageEndpointId",
    "mageEndpointIdSha256",
    "soulxEndpointId",
    "soulxEndpointIdSha256",
  ]),
  guarded_endpoint_secret_file_names: Object.freeze([
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  ]),
  seed_recursively_rejects_endpoint_identity_key_case_variants: true,
  production_input_base_lane_fields_must_be_absent_or_null_before_receipt_derivation: Object.freeze(
    ["publicImage", "deploymentSha256", "sourceCommit"],
  ),
  command_payloads_recursively_forbid_endpoint_or_deployment_snapshot_selectors: true,
  future_output_hash_or_identity_anywhere_in_seed_is_hard_stop: true,
  final_production_secrets_schema: "videoforge.v213-full-live-production-secrets/v1",
  cleanup_pre_endpoint_runtime: Object.freeze({
    schema: "videoforge.v213-full-live-cleanup-input/v1",
    exact_fields: Object.freeze([
      "schemaVersion",
      "fullLiveAuthorityId",
      "billingBaselineMode",
      "billingBaselineUsd",
      "totalCapUsd",
      "retainedLanes",
    ]),
    retained_lane_exact_fields: Object.freeze(["lane", "volumeIdSha256", "volumeManifestSha256"]),
    billing_baseline_modes: Object.freeze([
      "PRIOR_FRESH_PREFLIGHT",
      "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION",
    ]),
    null_billing_baseline_allowed_only_for_establish_current_mode_with_no_prior_fresh_preflight_or_runpod_mutation_receipt: true,
    establish_current_mode_first_authenticated_current_read_is_baseline_then_bounded_final_read_with_no_intervening_provider_mutation: true,
    exact_child_fd_environment: Object.freeze([
      "REQUEST_FD",
      "RUNPOD_API_KEY_FD",
      "OPERATOR_DATABASE_URL_FD",
    ]),
    forbidden_inputs: Object.freeze([
      "exactProductionInput",
      "runtime-database-url",
      "reconciler-database-url",
      "worker-origin",
      "worker-token",
      "production-secrets-fd",
      "endpoint-ids-or-hashes",
      "receipt-or-signing-keys",
      "key-registration",
    ]),
    accepted_for_normal_guarded_or_acceptance_work: false,
  }),
  cleanup_receipt_finalizer: Object.freeze({
    schema: "videoforge.v213-local-cleanup-receipt-finalization-request/v2",
    result_schema: "videoforge.v213-cleanup-receipt-finalization-result/v1",
    inside_existing_cleanup_operation: true,
    adds_graph_operation: false,
    runs_only_after_exact_provider_cleanup_journal_result: true,
    provider_cleanup_runtime_fd_policy_unchanged: true,
    exact_child_fd_environment: Object.freeze([
      "REQUEST_FD",
      "OPERATOR_DATABASE_URL_FD",
      "EVIDENCE_SIGNING_KEY_FD",
    ]),
    provider_clients_constructed: false,
    runpod_calls: 0,
    cloudflare_calls: 0,
    gpu_use: false,
    provider_dispatch: false,
    initial_idempotent_persist_then_exact_readback: true,
    recovery_readback_only: true,
    missing_recovery_receipt_is_hard_stop: true,
    failure_cleanup_skips_success_only_release_fact_materialization: true,
    final_certification_still_requires_success_path_release_facts: true,
  }),
  storage_parent: "OUTER_STATE_MODE_0700_DIRECTORY",
  record_file_mode: "0600",
  exclusive_create_or_exact_hash_cas_required: true,
  canonical_json_required: true,
  hash_chain_required: true,
  chain_binds_previous_outer_state_sha256_and_ordered_prior_result_sha256s: true,
  materialization_chain_committed_before_consumer_operation: true,
  chain_record_exact_fields: Object.freeze([
    "kind",
    "authority_id",
    "prior_chain_sha256",
    "outer_state_sha256",
    "ordered_prior_operation_evidence_sha256s",
    "ordered_output_sha256s",
    "entry_sha256",
  ]),
  entry_sha256_is_hash_of_preceding_six_fields: true,
  chain_verifier_required_in_production_entrypoint: true,
  chain_verifier_function: "verifyMaterializationChainFile",
  chain_verifier_boundaries: Object.freeze(["hydrated", "settled"]),
  missing_chain_verifier_is_hard_stop_before_external_action: true,
  chain_stage_order: Object.freeze([
    "production-input",
    "max-one-endpoint-bindings",
    "activation-record",
    "promotion-record",
    "post-consumption-command-payloads",
    "cleanup-pre-endpoint-descriptor",
  ]),
  early_cleanup_missing_chain_file_allowed_only_before_operator_verification: true,
  validate_each_output_immediately_at_first_use: true,
  records: Object.freeze([
    Object.freeze({
      kind: "production-input",
      materialize_after_operations: Object.freeze([
        "mage-image-workflow-verification",
        "soulx-image-workflow-verification",
      ]),
      consume_before_operation: "fresh-live-preflight",
      writes: Object.freeze(["production-input"]),
    }),
    Object.freeze({
      kind: "max-one-endpoint-bindings",
      materialize_after_operations: Object.freeze(["create-exact-max-one-endpoints"]),
      derives_only_from: "receipt.materialization.production",
      consume_before_materialization: "activation-record",
      writes: Object.freeze([
        "production-secrets",
        "VIDEOFORGE_MAGE_ENDPOINT_ID",
        "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
        "VIDEOFORGE_SOULX_ENDPOINT_ID",
        "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
        "mage-deployment-snapshot",
        "soulx-deployment-snapshot",
      ]),
      rebinds_all_guarded_secret_sha256_entries: 22,
      ordered_output_names: Object.freeze([
        "production_secrets_sha256",
        "mage_deployment_snapshot_sha256",
        "soulx_deployment_snapshot_sha256",
        "mage_endpoint_secret_sha256",
        "mage_endpoint_hash_secret_sha256",
        "soulx_endpoint_secret_sha256",
        "soulx_endpoint_hash_secret_sha256",
      ]),
    }),
    Object.freeze({
      kind: "activation-record",
      materialize_after_operations: Object.freeze([
        "mage-live-qualification",
        "soulx-live-qualification",
        "create-exact-max-one-endpoints",
      ]),
      consume_before_operation: "guarded-activation-once",
      requires_prior_materialization_kinds: Object.freeze(["max-one-endpoint-bindings"]),
      writes: Object.freeze([
        "media-manifest",
        "config-activation-record",
        "disabled-config",
        "activation-record",
      ]),
    }),
    Object.freeze({
      kind: "promotion-record",
      materialize_after_operations: Object.freeze([
        "mage-live-qualification",
        "soulx-live-qualification",
        "create-exact-max-one-endpoints",
        "guarded-activation-once",
      ]),
      consume_before_operation: "promote-qualified-production",
      writes: Object.freeze(["promotion-record"]),
    }),
    Object.freeze({
      kind: "post-consumption-command-payloads",
      materialize_after_operations: Object.freeze(["promote-qualified-production"]),
      consume_before_operation: "v2-09-short-hosted-project",
      source_schema: "videoforge.v213-post-consumption-materialization/v1",
      command_payload_seed_must_be_empty: true,
      app_and_database_owned_identities_required: true,
      worker_bearer_sha256_binding_required: true,
      v2_11_two_distinct_account_scopes_required: true,
      writes: Object.freeze(["production-input.commandPayloads", "four-acceptance-authorities"]),
    }),
    Object.freeze({
      kind: "cleanup-pre-endpoint-descriptor",
      cleanup_only: true,
      materialize_after_operations: Object.freeze([]),
      consume_before_operations: Object.freeze([
        "restore-endpoints-max-one",
        "prove-zero-workers",
        "read-settled-billing",
        "reconcile-exact-resources",
      ]),
      ordered_output_names: Object.freeze(["cleanup_input_sha256", "pre_endpoint_secrets_sha256"]),
      accepted_for_normal_or_acceptance_work: false,
    }),
  ]),
  missing_prior_result_receipt_path_mode_hash_chain_or_replay_is_hard_stop: true,
});
const EXACT_TRUSTED_TIME_POLICY = Object.freeze({
  credential_free_command:
    "curl --disable --silent --show-error --head --proto =https --tlsv1.2 --connect-timeout 5 --max-time 10 https://api.github.com/",
  curl_disable_is_first_argument: true,
  exact_url: "https://api.github.com/",
  request_method: "HEAD",
  transport_authentication: "SYSTEM_CA_VERIFIED_HTTPS_TLS_MINIMUM_1_2",
  credential_environment_or_authorization_header_allowed: false,
  ambient_gh_configuration_used: false,
  subprocess_environment_exact: Object.freeze({
    PATH: "INHERITED_ONLY_PATH",
    NO_PROXY: "*",
    no_proxy: "*",
  }),
  proxy_environment_allowed: false,
  curl_default_config_allowed: false,
  subprocess_timeout_ms: 12_000,
  maximum_credential_free_attempts_per_boundary: 3,
  every_attempt_must_complete_before_phase_or_work_mutation: true,
  required_date_header_count: 1,
  date_header_match: "CASE_INSENSITIVE_^date:",
  date_parse_valid_required: true,
  caller_supplied_trusted_time_forbidden: true,
  reread_before_every_non_cleanup_operation: true,
  check_before_local_reservation_or_phase_mutation: true,
  valid_interval: "approved_at<=trusted_time<=expires_at",
  invalid_or_expired_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  cleanup_after_expiry_authorized_only_for: Object.freeze([
    "drain",
    "restore_max_one",
    "prove_zero_workers",
    "read_settled_billing",
    "reconcile_exact_resources",
  ]),
  normal_or_paid_operation_resume_after_expiry: false,
});
const EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY = Object.freeze({
  operation_id: "bootstrap-prequalification-database",
  phase: "bootstrap_prequalification_database",
  phase_cap_usd: 0,
  result_schema: "videoforge.v213-prequalification-database-bootstrap-result/v4",
  ordered_before_operation: "fresh-live-preflight",
  requires_consumed_outer_authority: true,
  exact_operator_role: "videoforge_hosted_operator",
  runtime_and_reconciler_roles_must_remain_absent: true,
  exact_initial_ledger_prefix_count: 36,
  exact_recoverable_prefix_counts: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]),
  reject_ledger_drift_or_count_above_49: true,
  pgcrypto_then_exact_migrations: Object.freeze([
    37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  ]),
  each_migration_requires_advisory_lock_and_single_transaction: true,
  owner_connection_uses_only_protected_pg_service_and_pgpass: true,
  exact_owner_database_identity: Object.freeze({
    database: "neondb",
    host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
    owner_role: "neondb_owner",
  }),
  exact_owner_database_identity_sha256:
    "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7",
  state_bound_materialization_seed_loaded_before_database_command_randomness_or_write: true,
  owner_service_identity_must_equal_seed_before_database_command_randomness_or_write: true,
  operator_role_created_or_recovered_from_protected_operator_dsn_only_after_migrations: true,
  database_role_credential_bundle_schema: "videoforge.v213-database-role-credential-bundle/v1",
  database_role_credential_bundle_path: "database-role-credentials.json",
  database_role_credentials_absent_before_consumed_bootstrap: true,
  database_role_credentials_materialized_after_migration_prefix_commit_count: 49,
  database_role_credentials_exact_roles: Object.freeze([
    "videoforge_hosted_operator",
    "videoforge_hosted_runtime",
    "videoforge_hosted_reconciler",
  ]),
  exact_one_time_database_role_credential_count: 3,
  exact_one_time_database_role_credential_scope:
    "OPERATOR_RUNTIME_RECONCILER_ONLY_INSIDE_CONSUMED_BOOTSTRAP",
  other_credential_creation_or_rotation_forbidden: true,
  exact_one_time_internal_production_credential_count: 10,
  exact_one_time_internal_production_credential_scope: Object.freeze([
    "acceptance-evidence-signing-key",
    "better-auth-secret",
    "media-worker-token-secret",
    "pair-dispatch-token-key",
    "pair-envelope-signing-key",
    "pair-provider-proof-key",
    "provenance-receipt-hmac-key",
    "stage-authority-signing-key",
    "worker-operator-bearer",
    "workflow-callback-secret",
  ]),
  completed_external_credential_bootstrap_receipt: Object.freeze({
    schema: "videoforge.v2-13-credential-bootstrap-result/v1",
    sha256: "sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab",
    protected_value_count: 4,
    exact_value_kinds: Object.freeze([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ]),
    secret_free_receipt_rehashed_before_value_reads: true,
    every_value_rehashed_against_receipt_and_source_binding: true,
    creation_or_rotation_authorized: false,
  }),
  production_secret_materialization: Object.freeze({
    operation_id: "bootstrap-prequalification-database",
    requires_consumed_outer_authority: true,
    canonical_bundle_schema: "videoforge.v213-production-secret-bootstrap/v1",
    pre_endpoint_schema: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
    exact_generated_credential_count: 10,
    deterministic_key_ids_bound_to_full_live_authority: true,
    seed_envelope_signing_key_id_must_equal_generated_pair_envelope_key_id: true,
    google_and_r2_values_are_byte_equal_copies_of_receipt_bound_protected_files: true,
    worker_bearer_is_byte_equal_in_bundle_secret_file_and_bridge_file: true,
    runpod_api_key_is_byte_equal_in_protected_source_and_cloudflare_secret_file: true,
    worker_origin_is_seed_derived: true,
    deterministic_authority_bound_staging_and_exact_cas: true,
    reconciliation_is_readback_only: true,
    raw_values_forbidden_in_receipt_result_logs_and_argv: true,
  }),
  deterministic_authority_bound_staging_paths_required: true,
  staging_path_binding: "FULL_LIVE_AUTHORITY_ID_AND_RESOLVED_FINAL_PATH_SHA256",
  random_secret_bearing_staging_paths_forbidden: true,
  every_staging_path_in_reserved_collision_preflight_readback_and_partial_cleanup: true,
  credential_and_reserved_paths_require_canonical_realpath_and_no_symlink_ancestry: true,
  settled_bundle_and_database_url_files_require_link_count_one: true,
  crash_pair_link_count_two_allowed_only_for_exact_final_and_current_authority_stage_inode: true,
  other_hard_links_forbidden: true,
  successful_materialization_and_reconciliation_require_all_staging_paths_absent: true,
  runtime_and_reconciler_credentials_staged_but_roles_remain_absent_until_guarded_activation: true,
  operator_role_contract: "LOGIN_NOINHERIT_HARDENED_NO_MEMBERSHIPS_OWNERSHIP_OR_TABLE_ACL",
  grants: "EXACT_OPERATOR_FUNCTION_ONLY",
  exact_readback: Object.freeze([
    "49-row-ledger",
    "pgcrypto",
    "operator-role-flags",
    "no-role-memberships",
    "no-object-ownership",
    "no-table-acl",
    "exact-operator-function-acl",
  ]),
  exact_operator_function_signature_count: 45,
  exact_operator_function_signature_namespace: "public",
  exact_operator_function_signature_canonicalization:
    "FUNCTION_NAME_PLUS_FORMAT_TYPE_IDENTITY_ARGUMENTS_WITH_TIMESTAMPTZ_NORMALIZATION",
  exact_operator_function_acl_comparison: "OID_SET_SORTED_EXACT_ALLOWLIST",
  exact_operator_function_acl_must_have_no_duplicates: true,
  public_function_execute_readback_count: 0,
  public_default_function_execute_readback_count: 0,
  ownership_catalogs: Object.freeze([
    "pg_database.datdba",
    "pg_extension.extowner",
    "pg_class.relowner",
    "pg_namespace.nspowner",
    "pg_proc.proowner",
    "pg_type.typowner",
    "pg_foreign_data_wrapper.fdwowner",
    "pg_foreign_server.srvowner",
    "pg_event_trigger.evtowner",
    "pg_tablespace.spcowner",
    "pg_publication.pubowner",
    "pg_subscription.subowner",
    "pg_largeobject_metadata.lomowner",
    "pg_collation.collowner",
    "pg_ts_dict.dictowner",
    "pg_ts_config.cfgowner",
  ]),
  ownership_readback_is_cluster_wide: true,
  receipt_exact_fields: Object.freeze([
    "schema_version",
    "full_live_authority_id",
    "outer_state_sha256",
    "materialization_seed_sha256",
    "database_identity_sha256",
    "ledger_before_count",
    "ledger_before_sha256",
    "ledger_after_sha256",
    "operator_acl_sha256",
    "operator_database_url_sha256",
    "runtime_database_url_sha256",
    "reconciler_database_url_sha256",
    "database_role_credential_bundle_sha256",
    "credential_bootstrap_receipt_sha256",
    "production_secret_bootstrap_sha256",
    "production_secrets_sha256",
    "production_secret_file_sha256s",
    "internal_credential_key_ids",
    "pgcrypto_sha256",
    "recovery_mode",
    "runpod_calls",
    "cloudflare_calls",
    "application_secret_reads",
  ]),
  receipt_full_exact_fields: Object.freeze([
    "schema_version",
    "full_live_authority_id",
    "outer_state_sha256",
    "materialization_seed_sha256",
    "database_identity_sha256",
    "ledger_before_count",
    "ledger_before_sha256",
    "ledger_after_sha256",
    "operator_acl_sha256",
    "operator_database_url_sha256",
    "runtime_database_url_sha256",
    "reconciler_database_url_sha256",
    "database_role_credential_bundle_sha256",
    "credential_bootstrap_receipt_sha256",
    "production_secret_bootstrap_sha256",
    "production_secrets_sha256",
    "production_secret_file_sha256s",
    "internal_credential_key_ids",
    "pgcrypto_sha256",
    "recovery_mode",
    "runpod_calls",
    "cloudflare_calls",
    "application_secret_reads",
    "prequalification_database_bootstrap_sha256",
  ]),
  receipt_path: "prequalification-database-bootstrap.json",
  receipt_hash_field: "prequalification_database_bootstrap_sha256",
  receipt_hash_is_sha256_of_canonical_body: true,
  receipt_file_mode: "0600",
  receipt_parent_directory_mode: "0700",
  receipt_secret_free: true,
  receipt_replay_requires_exact_all_fields: true,
  receipt_final_ledger_count: 49,
  receipt_recovery_mode_count_binding: Object.freeze({
    FRESH_36_TO_49: 36,
    RESUME_EXACT_PREFIX: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]),
    VERIFIED_EXISTING_49: 49,
  }),
  receipt_replay_cas_required: true,
  operator_grants_sql_path: "deploy/v2-13/neon-full-live-operator-grants.sql",
  absent_operator_role_creation_and_exact_grants_share_one_database_transaction: true,
  fresh_operator_password_available_only_inside_that_transaction: true,
  lost_transaction_commit_ack_reconciles_by_exact_acl_and_authenticated_operator_dsn: true,
  operator_grants_sql_revoke_all_functions_before_allowlist: true,
  operator_grants_sql_revoke_public_execute: true,
  public_execute_readback_must_be_empty: true,
  exact_operator_acl_order: "LEXICAL_CANONICAL_SIGNATURE",
  operator_role_flags: Object.freeze({
    rolcanlogin: true,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolinherit: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconfig: null,
  }),
  operator_acl_scope: Object.freeze({
    schema_usage_only: true,
    schema_create: false,
    database_acl: 0,
    table_acl: 0,
    sequence_acl: 0,
    default_acl: 0,
    ownership: 0,
    memberships: 0,
    public_function_acl: 0,
    public_default_function_acl: 0,
  }),
  owner_dsn_policy: Object.freeze({
    protected_input_directory_env: "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
    service_file: "owner.pg_service.conf",
    pass_file: "owner.pgpass",
    service_name: "videoforge_v2_13_owner",
    owner_only_for_migrations_and_readback: true,
    credentials_never_in_argv_or_logs: true,
  }),
  operator_dsn_policy: Object.freeze({
    file: "operator.database-url",
    exact_role: "videoforge_hosted_operator",
    accepted_protocols: Object.freeze(["postgres:", "postgresql:"]),
    sslmode: "require",
    channel_binding: "require",
    host_and_database_match_owner_service: true,
    only_after_migrations: true,
    presence_only_absence_check_before_migrations: true,
    credential_value_read_before_migrations_allowed: false,
    generated_inside_consumed_bootstrap: true,
    exact_hash_persisted_in_bootstrap_receipt: true,
    exact_hash_in_static_seed: null,
    value_read_after_migration_prefix_commit_count: 49,
    value_read_forbidden_before_migration_prefix_commit: true,
    used_for_role_creation_or_recovery_only_after_migrations: true,
    password_never_in_argv_or_logs: true,
  }),
  authorized_unsettled_reconciliation: Object.freeze({
    executor_reentry_allowed: true,
    exact_authorized_outer_state_sha256_required: true,
    provider_dispatch_forbidden: true,
    exact_existing_bundle_and_files_reused: true,
    existing_role_without_exact_bundle_fails_closed: true,
    missing_bundle_file_or_role_fails_closed: true,
    migrations_credential_creation_role_creation_and_grants_forbidden: true,
    operator_credential_login_readback_required: true,
    only_exact_receipt_reconstruction_or_readback_may_write: true,
  }),
  operator_verification_transition: Object.freeze({
    state_field: "operator_role_verified",
    initial_value: false,
    set_true_only_after:
      "SETTLED_TERMINAL_BOOTSTRAP_RESULT_AND_EXACT_RECEIPT_LEDGER49_OPERATOR_ACL_READBACK",
    restart_source: "SETTLED_TERMINAL_BOOTSTRAP_RESULT_ONLY",
    role_presence_or_preflight_is_not_sufficient: true,
    monotonic: true,
    required_before_normal_operator_dsn_cleanup: true,
  }),
  exact_operator_function_signatures: Object.freeze([
    "videoforge_claim_v213_bridge_command(jsonb)",
    "videoforge_claim_v213_cleanup_bridge_command(jsonb)",
    "videoforge_claim_v213_cleanup_receipt_intent(jsonb)",
    "videoforge_claim_v213_operation(jsonb)",
    "videoforge_claim_v213_qualification_materialization(jsonb)",
    "videoforge_claim_v213_stage_authority(jsonb)",
    "videoforge_complete_v213_stage_authority(text,text,jsonb)",
    "videoforge_load_v213_bridge_acceptance_call(jsonb)",
    "videoforge_load_v213_cleanup_scope(uuid)",
    "videoforge_load_v213_signed_evidence(jsonb)",
    "videoforge_load_v213_stage_handoff(uuid,text,text)",
    "videoforge_materialize_v213_release_facts(jsonb)",
    "videoforge_persist_v213_jit_materialization(jsonb)",
    "videoforge_persist_v213_qualification_materialization(jsonb)",
    "videoforge_persist_v213_release_certification(jsonb)",
    "videoforge_persist_v213_release_chrome(jsonb)",
    "videoforge_prepare_v213_jit_operation(jsonb)",
    "videoforge_project_v213_jit_operation(jsonb)",
    "videoforge_project_v213_release_certification(jsonb)",
    "videoforge_project_v213_release_chrome(jsonb)",
    "videoforge_promote_hosted_full_live(uuid,uuid,jsonb)",
    "videoforge_publish_v213_qualified_deployments(jsonb)",
    "videoforge_read_v213_jit_materialization(jsonb)",
    "videoforge_read_v213_operation_receipt(jsonb)",
    "videoforge_read_v213_operator_evidence(jsonb)",
    "videoforge_read_v213_qualification_materialization(jsonb)",
    "videoforge_read_v213_release_certification(jsonb)",
    "videoforge_read_v213_release_chrome(jsonb)",
    "videoforge_read_v213_release_fact_materialization(jsonb)",
    "videoforge_record_hosted_full_live_authority(uuid,jsonb)",
    "videoforge_record_v213_acceptance_authority(jsonb)",
    "videoforge_record_v213_cloudflare_activation(uuid,jsonb)",
    "videoforge_record_v213_cloudflare_rollback(uuid,jsonb)",
    "videoforge_record_v213_disabled_promotion_closure(uuid,jsonb)",
    "videoforge_record_v213_operation_receipt(jsonb)",
    "videoforge_record_v213_receipt_verification_key(text,text)",
    "videoforge_record_v213_signed_evidence(jsonb)",
    "videoforge_record_v213_stage_authority(uuid,jsonb)",
    "videoforge_record_v213_static_release_descriptor(jsonb)",
    "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
    "videoforge_transition_v213_bridge_command(jsonb)",
    "videoforge_transition_v213_operation(jsonb)",
    "videoforge_v213_production_length_repository(jsonb)",
    "videoforge_v213_short_pilot_repository(jsonb)",
    "videoforge_verify_v213_jit_artifact(jsonb)",
  ]),
  recovery_modes: Object.freeze(["FRESH_36_TO_49", "RESUME_EXACT_PREFIX", "VERIFIED_EXISTING_49"]),
  recovery_mode_ledger_before_count: Object.freeze({
    FRESH_36_TO_49: 36,
    RESUME_EXACT_PREFIX: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]),
    VERIFIED_EXISTING_49: 49,
  }),
  recovery_mode_final_ledger_count: 49,
  output_name: "prequalification_database_bootstrap_sha256",
  runpod_calls: 0,
  cloudflare_calls: 0,
  application_secret_reads: 5,
  gpu_use: false,
  external_spend_usd: 0,
  failure_recovery:
    "AUTHORIZED_UNSETTLED_READBACK_ONLY_AFTER_ATOMIC_ROLE_AND_GRANTS_COMMIT_OR_BOOTSTRAP_PARTIAL_CLEANUP_AFTER_ROLE_ABSENCE_PROOF",
  guarded_activation_consumes_verified_receipt: true,
  guarded_activation_receipt_verified_before_non_database_application_secret_reads: true,
  guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads: true,
  guarded_activation_creates_only_runtime_and_reconciler_roles_and_grants: true,
  guarded_activation_reapplies_migrations_or_operator_role: false,
  guarded_activation_requires_prefix_36: false,
  post_bootstrap_receipt_verifier: Object.freeze({
    function: "verifyPrequalificationDatabaseReceipt",
    adapter_wrapper: "createConcreteFullLiveAdapters",
    default_verifier_binding:
      "options.prequalificationVerifier.verify ?? verifyPrequalificationDatabaseReceipt",
    owner_only: true,
    protected_input_directory_env: "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
    owner_service_file: "owner.pg_service.conf",
    owner_pass_file: "owner.pgpass",
    owner_service_name: "videoforge_v2_13_owner",
    receipt_path_resolver: "prequalificationPath",
    prior_result_operation_id: "bootstrap-prequalification-database",
    prior_result_hash_field: "prequalification_database_bootstrap_sha256",
    receipt_hash_field: "prequalification_database_bootstrap_sha256",
    exact_prior_result_and_file_cas_required: true,
    verifier_disable_override_authorized: false,
    cas_before_owner_service_and_pass_read: true,
    cas_before_owner_database_read: true,
    cas_before_production_operator_runpod_application_secret_reads: true,
    readback_order: Object.freeze([
      "receipt_file",
      "prior_result_cas",
      "state_bound_materialization_seed",
      "database_identity_hash",
      "owner_pg_service",
      "owner_pgpass",
      "database_role_credential_bundle",
      "operator_database_url_hash",
      "runtime_database_url_hash",
      "reconciler_database_url_hash",
      "ledger49",
      "pgcrypto",
      "exact_operator_acl",
    ]),
    verifies_final_ledger_count: 49,
    verifies_pgcrypto: true,
    verifies_exact_operator_acl: true,
    verify_before_every_post_bootstrap_non_early_cleanup_operation: true,
    bootstrap_operation_exempt: true,
    early_cleanup_operations_exempt: true,
    early_cleanup_condition: "context.earlyFailure === true",
    database_role_credential_values_retained_or_dispatched: false,
    database_role_credential_values_read_only_for_local_exact_file_and_login_verification: true,
    database_credential_hash_reads: 3,
    runpod_calls: 0,
    cloudflare_calls: 0,
    non_database_application_secret_reads: 0,
  }),
});
const EXACT_WORKFLOW_START_AUTHORITY_POLICY = Object.freeze({
  operation_id: "record-workflow-start-authority",
  phase: "max_one_control_plane_and_guarded_activation",
  phase_cap_usd: 0,
  ordered_after_operation: "promote-qualified-production",
  ordered_before_operation: "v2-09-short-hosted-project",
  database_function: "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
  acceptance_authority_database_function: "videoforge_record_v213_acceptance_authority(jsonb)",
  exact_acceptance_authority_count: 4,
  acceptance_checkpoints: Object.freeze(["V2-10", "V2-11", "V2-12", "V2-13"]),
  protected_materialization_schema: "videoforge.v213-post-consumption-materialization/v1",
  protected_materialization_file_env: "VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE",
  protected_materialization_parent_mode: "0700",
  protected_materialization_file_mode: "0600",
  protected_materialization_canonical_json_and_self_hash_required: true,
  protected_materialization_must_postdate_outer_consumption: true,
  worker_operator_bearer_hash_must_match_protected_file: true,
  command_payloads_cas_injected_before_v2_09: true,
  v2_11_two_distinct_account_and_workspace_scopes_required: true,
  result_exact_fields: Object.freeze(["authorityId", "tokenSha256", "expiresAt"]),
  result_authority_id_is_uuid: true,
  result_token_sha256_is_canonical_hash: true,
  result_expires_at_is_rfc3339_timestamp: true,
  provider_calls: 0,
  application_secret_reads: 0,
  gpu_use: false,
  external_spend_usd: 0,
  exact_once_or_reconcile: true,
  ambiguous_result_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
});
const EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY = Object.freeze({
  schema: "videoforge.v213-full-live-early-cleanup-input/v1",
  trigger: "BEFORE_OPERATOR_ROLE_VERIFIED",
  runpod_only: true,
  runpod_key_required: true,
  exact_allowed_environment_names: Object.freeze([
    "VIDEOFORGE_V213_BRIDGE_COMMAND",
    "VIDEOFORGE_V213_BRIDGE_REQUEST_FD",
    "VIDEOFORGE_V213_BRIDGE_RUNPOD_API_KEY_FD",
  ]),
  exact_child_fd_environment: Object.freeze(["REQUEST_FD", "RUNPOD_API_KEY_FD"]),
  allowed_operation_ids: Object.freeze([
    "restore-endpoints-max-one",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
  ]),
  forbidden_inputs: Object.freeze([
    "OPERATOR_DATABASE_URL_FD",
    "RUNTIME_DATABASE_URL_FD",
    "RECONCILER_DATABASE_URL_FD",
    "exactProductionInput",
    "production-secrets-fd",
    "endpoint-ids-or-hashes",
    "receipt-or-signing-keys",
    "key-registration",
  ]),
  database_calls: 0,
  cloudflare_mutations: 0,
  cloudflare_calls: 0,
  provider_dispatch_forbidden: true,
  provider_mutations: 0,
  runpod_calls: 0,
  runpod_mutations: 0,
  application_secret_reads: 0,
  gpu_use: false,
  external_spend_usd: 0,
  accepted_only_before_operator_verification: true,
  accepted_only_before_persisted_runpod_mutation_capable_operation: true,
  eligibility_function: "canUseEarlyCleanupWithoutProviderReads",
  database_cleanup_claimed: false,
  never_claims_database_cleanup: true,
  after_operator_verified_cleanup: "NORMAL_OPERATOR_DSN_CLEANUP_RUNTIME",
});
const EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY = Object.freeze({
  mode: "BOOTSTRAP_PARTIAL_CLEANUP",
  trigger:
    "AUTHORIZED_UNSETTLED_BOOTSTRAP_BEFORE_OPERATOR_ROLE_VERIFIED_AND_BEFORE_RUNPOD_MUTATION_BOUNDARY",
  inside_existing_cleanup_operation: "reconcile-exact-resources",
  adds_graph_operation: false,
  endpoint_free: true,
  provider_dispatch_forbidden: true,
  runpod_calls: 0,
  cloudflare_calls: 0,
  gpu_use: false,
  external_spend_usd: 0,
  owner_database_role_absence_readback_required: true,
  operator_runtime_and_reconciler_roles_must_all_be_absent: true,
  owner_database_mutation_forbidden: true,
  exact_ledger49_required_when_final_or_staged_credential_bundle_exists: true,
  canonical_bundle_must_bind_current_authority_and_owner_database_identity: true,
  final_database_url_copies_must_byte_match_canonical_final_or_staged_bundle: true,
  incomplete_current_authority_database_url_stages_may_be_deleted_after_role_absence_proof: true,
  incomplete_bundle_stage_may_be_deleted_only_when_no_database_url_copy_or_stage_exists: true,
  deterministic_stage_paths_enumerated_and_foreign_authority_stages_rejected: true,
  database_url_final_and_stage_copies_deleted_before_bundle_final_and_stage: true,
  maximum_removed_artifact_count: 56,
  all_absent_is_idempotent_terminal_readback: true,
  role_present_forbids_local_deletion_and_uses_bootstrap_reconciliation: true,
  missing_final_and_staged_bundle_with_any_database_url_final_or_stage_is_hard_stop: true,
  exact_result_schema: "videoforge.v213-database-role-credential-cleanup/v1",
  exact_result_hash_bound_into_resource_reconciliation_proof: true,
});
const EXACT_CRASH_SAFE_CLEANUP_POLICY = Object.freeze({
  state_storage: "OUTER_STATE_MODE_0700_DIRECTORY_FILE_MODE_0600",
  durable_before_cleanup_dispatch: true,
  resumes_only_unsettled_cleanup_work: true,
  settled_cleanup_result_replay_cas_required: true,
  ambiguous_work_is_not_redispatched: true,
  cleanup_operations: Object.freeze([
    "restore-endpoints-max-one",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
  ]),
  failure_state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
  committed_role_or_grant_failure: "MANUAL_RECONCILIATION_STOP",
  cleanup_proof_required: Object.freeze([
    "zero_worker_proof_sha256",
    "billing_proof_sha256",
    "resource_reconciliation_sha256",
    "max_one_restoration_sha256",
  ]),
  partial_pair_terminal_states: Object.freeze([
    "EXACT_MAX_ONE_PAIR_RETAINED",
    "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
  ]),
  partial_pair_requires_final_deterministic_name_absence_proof: true,
});
const EXACT_DURABLE_BILLING_POLICY = Object.freeze({
  baseline_source: "AUTHENTICATED_RUNPOD_ACCOUNT_BILLING_READBACK",
  baseline_is_durable: true,
  reserve_open_liability_before_paid_dispatch: true,
  reservation_includes_billing_lag: true,
  settle_only_after_terminal_jobs_and_zero_workers: true,
  final_billing_readback_required: true,
  final_billing_stable_read_count: 3,
  stable_read_contract: Object.freeze({
    consecutive_authenticated_reads: true,
    exact_read_count: 3,
    equal_cumulative_values_required: true,
    no_provider_mutation_between_reads: true,
    inter_read_spacing_ms: 2_000,
    establish_current_mode_baseline_read_count: 1,
    establish_current_mode_total_provider_reads: 4,
    all_three_final_reads_are_included_in_proof: true,
    malformed_or_transport_read_is_hard_stop: true,
  }),
  observed_billing_is_not_settlement: true,
  ambiguous_or_late_billing_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  cumulative_cap_usd: 17.5,
  phase_cap_overflow_hard_stop: true,
});
const EXACT_PREQUALIFICATION_BRIDGE_POLICY = Object.freeze({
  fresh_live_preflight_command: "fresh-live-preflight",
  prequalification_input_reader: "readV213PrequalificationProtectedInputs",
  prequalification_runtime_factory: "createV213PrequalificationRuntime",
  prequalification_protected_input_fields: Object.freeze([
    "request",
    "runpodApiKey",
    "operatorDatabaseUrl",
  ]),
  prequalification_allowed_environment_names: Object.freeze([
    "VIDEOFORGE_V213_BRIDGE_COMMAND",
    "VIDEOFORGE_V213_BRIDGE_REQUEST_FD",
    "VIDEOFORGE_V213_BRIDGE_RUNPOD_API_KEY_FD",
    "VIDEOFORGE_V213_BRIDGE_OPERATOR_DATABASE_URL_FD",
  ]),
  prequalification_forbidden_environment_names: Object.freeze([
    "VIDEOFORGE_V213_BRIDGE_RUNTIME_DATABASE_URL_FD",
    "VIDEOFORGE_V213_BRIDGE_RECONCILER_DATABASE_URL_FD",
    "VIDEOFORGE_V213_BRIDGE_WORKER_ORIGIN_FD",
    "VIDEOFORGE_V213_BRIDGE_WORKER_OPERATOR_BEARER_FD",
    "VIDEOFORGE_V213_BRIDGE_PRODUCTION_SECRETS_FD",
  ]),
  prequalification_rejects_other_prefixed_environment_names: true,
  prequalification_runtime_has_no_runtime_reconciler_or_production_secret_inputs: true,
  normal_input_reader: "readV213ProtectedInputs",
  normal_runtime_factory: "createV213ProductionRuntime",
  full_runtime_rejected_for_fresh_live_preflight: true,
  operator_only_preflight: Object.freeze({
    function: "preflightConcreteFullLiveInputs",
    operator_only: true,
    before_command: "fresh-live-preflight",
    protected_environment_inputs: Object.freeze([
      "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE",
      "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
    ]),
    fresh_child_reader: "readV213PrequalificationProtectedInputs",
    fresh_child_runtime_factory: "createV213PrequalificationRuntime",
    fresh_child_operator_role: "videoforge_hosted_operator",
    fresh_child_allowed_database_input: "operatorDatabaseUrl",
    fresh_child_forbidden_database_inputs: Object.freeze([
      "ownerDatabaseUrl",
      "runtimeDatabaseUrl",
      "reconcilerDatabaseUrl",
    ]),
    fresh_child_forbidden_database_fd_names: Object.freeze([
      "OWNER_DATABASE_URL_FD",
      "RUNTIME_DATABASE_URL_FD",
      "RECONCILER_DATABASE_URL_FD",
    ]),
    fresh_child_receives_no_owner_runtime_or_reconciler_dsn: true,
  }),
  initial_executor_preflight: Object.freeze({
    function: "preflightConcreteFullLiveInputs",
    bootstrap_only: true,
    operator_database_url_required: false,
    database_role_credential_bundle_required: false,
    unsettled_database_credentials_must_be_absent: true,
    authorized_unsettled_bootstrap_reconciliation_allows_exact_existing_credentials: true,
    allow_unmaterialized_production_input: true,
    require_endpoint_secrets: false,
    before_operation: "release-tag-create",
  }),
  staged_full_preflight: Object.freeze({
    function: "preflightConcreteFullLiveInputs",
    after_operation: "fresh-live-preflight",
    before_command: "mage-live-qualification",
    bootstrap_receipt_cas_must_have_passed: true,
    require_endpoint_secrets: false,
  }),
  executor_receipt_gate: Object.freeze({
    verifier_function: "verifyPrequalificationDatabaseReceipt",
    settled_result_hydration_function: "hydrateSettledResults",
    prior_results_argument: "priorResults",
    initial_bootstrap_only_preflight_skips_full_receipt_verifier: true,
    staged_preflight: Object.freeze({
      mode_flag: "staged",
      verify_before_full_protected_preflight: true,
      full_protected_preflight_function: "preflightConcreteFullLiveInputs",
    }),
    restart_preflight: Object.freeze({
      hydrate_settled_results_before_preflight: true,
      use_hydrated_prior_results: true,
      repeat_receipt_verifier: true,
      verify_before_full_protected_preflight: true,
    }),
    no_role_presence_or_initial_preflight_substitution: true,
  }),
  child_process_timeout_policy: Object.freeze({
    production_child_max_timeout_ms: 1_800_000,
    cleanup_child_max_timeout_ms: 60_000,
    timeout_must_be_positive: true,
    timeout_must_be_bounded_by_authority_deadline: true,
    cleanup_timeout_remains_bounded_after_authority_expiry: true,
    spawn_timeout_is_required: true,
    kill_signal: "SIGTERM",
    timeout_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  }),
  promotion_database_dsn_policy: Object.freeze({
    protected_file: "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
    exact_path: "operator.database-url",
    exact_role: "videoforge_hosted_operator",
    accepted_protocols: Object.freeze(["postgres:", "postgresql:"]),
    exact_query_parameters: Object.freeze({
      sslmode: "require",
      channel_binding: "require",
    }),
    host_and_database_source: "owner.pg_service.conf",
    fingerprint_field: "database.operator_database_url_sha256",
    fingerprint_algorithm: "SHA256_EXACT_PROTECTED_FILE_BYTES",
    fingerprint_must_match_guarded_authority_before_pool_creation: true,
    runtime_reconciler_and_owner_dsns_forbidden: true,
    password_never_in_argv_or_logs: true,
  }),
  post_bootstrap_full_bridge_commands: Object.freeze([
    "mage-live-qualification",
    "soulx-live-qualification",
    "create-exact-max-one-endpoints",
    "v2-09-short-hosted-project",
    "v2-10-operator-free-ranga-pilot",
    "v2-11-two-concurrent-owned-projects",
    "v2-12-long-output",
    "v2-13-final-two-lane-smoke",
  ]),
  v2_09_post_terminal_chrome_policy: Object.freeze({
    schedule_exactly_once_before_chrome_request: true,
    default_terminal_resolver: "createV213V209ProductionTerminalOutputResolver",
    terminal_resolver_is_read_only_and_never_dispatches: true,
    required_terminal_state: "COMPLETE_SUCCEEDED",
    final_output_durable_receipt_required: true,
    settled_pair_two_output_barriers_and_zero_active_leases_required: true,
    exchange_directory_env: "VIDEOFORGE_V209_CHROME_EVIDENCE_DIR",
    exchange_directory_mode: "0700",
    request_and_receipt_file_mode: "0600",
    receipt_schema: "videoforge.v2-09-real-chrome-receipt/v1",
    evidence_schema: "videoforge.v2-09-real-chrome-acceptance/v1",
    real_chrome_playback_and_download_required: true,
    observed_at_must_be_at_or_after_terminal_at: true,
    final_output_and_receipt_hashes_must_match_terminal_proof: true,
    signed_evidence_key_must_match_production_acceptance_key: true,
    bounded_wait_by_v2_09_deadline: true,
    missing_stale_malformed_or_mismatched_receipt_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  }),
  receipt_gate: Object.freeze({
    adapter_option: "requirePrequalificationReceipt",
    verifier_function: "verifyPrequalificationDatabaseReceipt",
    verifier_owner_only_protected_readback: true,
    verifier_owner_service_file: "owner.pg_service.conf",
    verifier_owner_pass_file: "owner.pgpass",
    verifier_owner_service_name: "videoforge_v2_13_owner",
    verifier_protected_input_directory_env: "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
    receipt_file: "prequalification-database-bootstrap.json",
    prior_result_operation: "bootstrap-prequalification-database",
    receipt_hash_field: "prequalification_database_bootstrap_sha256",
    require_prior_result_and_file_hash_match: true,
    verifier_disable_override_authorized: false,
    cas_before_owner_service_and_pass_read: true,
    verify_ledger49_pgcrypto_and_exact_operator_acl: true,
    cas_precedes_all_production_operator_runpod_and_application_secret_reads: true,
    before_every_post_bootstrap_non_early_cleanup_operation: true,
    bootstrap_operation_exempt: true,
    early_cleanup_exempt: true,
    guarded_activation_receipt_verified_before_application_secret_reads: true,
    guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads: true,
    fresh_live_failure_code: "BRIDGE_PREQUALIFICATION_RECEIPT",
    guarded_activation_failure_code: "GUARDED_PREQUALIFICATION_RECEIPT",
  }),
});
const EXACT_OPERATION_IDS = Object.freeze([
  "release-tag-create",
  "release-tag-push",
  "release-tag-readback",
  "approval-commit-push",
  "mage-image-workflow-dispatch",
  "mage-image-workflow-verification",
  "soulx-image-workflow-dispatch",
  "soulx-image-workflow-verification",
  "bootstrap-prequalification-database",
  "fresh-live-preflight",
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "guarded-activation-once",
  "promote-qualified-production",
  "record-workflow-start-authority",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
  "certify-v2-13-release",
]);
const EXECUTION_FENCE_KEYS = Object.freeze([
  "proposal_bytes_must_rehash_exactly",
  "proposal_and_release_commits_must_remain_distinct_and_exact",
  "trusted_time_and_unexpired_authority_required_before_every_mutation_boundary",
  "durable_single_use_consumption_fence_required_before_credential_access",
  "fresh_exact_readbacks_and_complete_inventory_required_before_mutation",
  "returned_post_run_image_digests_only",
  "mage_must_pass_before_soulx",
  "both_lanes_must_pass_before_production_endpoints",
  "no_redispatch",
  "no_gpu_region_rate_image_model_volume_or_resource_fallback",
  "billing_lag_liability_reserved_before_paid_work",
  "phase_and_cumulative_caps_are_hard_stops",
  "cleanup_zero_worker_billing_and_max_one_restoration_required",
  "user_cancellation_is_immediate_stop",
]);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const exactStaticReleaseDescriptor = (value) =>
  exactKeys(value, ["path", "sha256"]) &&
  typeof value.path === "string" &&
  value.path.length > 0 &&
  !value.path.startsWith("/") &&
  !value.path.split("/").includes("..") &&
  value.path.endsWith(".json") &&
  HASH.test(value.sha256 ?? "");
const exactMaterializationSeedFacts = (value, commitField) =>
  exactKeys(value, ["commit_field", "full_live_authority_id", "path", "sha256"]) &&
  value.commit_field === commitField &&
  UUID.test(value.full_live_authority_id ?? "") &&
  typeof value.path === "string" &&
  value.path.length > 0 &&
  !value.path.startsWith("/") &&
  !value.path.split("/").includes("..") &&
  value.path.endsWith(".json") &&
  HASH.test(value.sha256 ?? "");
const fail = (code) => {
  throw new Error(`V2_13_FULL_LIVE_APPROVAL_${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes);
  } catch {
    fail(`${code}_JSON_INVALID`);
  }
};

function validateFullLiveUserApproval({
  proposalBytes,
  approvalBytes,
  expectedProposalSha256,
  expectedProposalRecordCommit,
  expectedReleaseSourceCommit,
}) {
  if (!Buffer.isBuffer(proposalBytes) || !Buffer.isBuffer(approvalBytes)) fail("BYTES_REQUIRED");
  if (!HASH.test(expectedProposalSha256 ?? "") || sha256(proposalBytes) !== expectedProposalSha256)
    fail("PROPOSAL_SHA256");
  if (!COMMIT.test(expectedProposalRecordCommit ?? "")) fail("PROPOSAL_COMMIT");
  if (!COMMIT.test(expectedReleaseSourceCommit ?? "")) fail("RELEASE_SOURCE_COMMIT");
  const proposal = parse(proposalBytes, "PROPOSAL");
  const approval = parse(approvalBytes, "APPROVAL");
  const isV4 = proposal.schema_version === PROPOSAL_SCHEMA_V4;
  const isV5 = proposal.schema_version === PROPOSAL_SCHEMA_V5;
  const isSuccessor = isV4 || isV5;
  const isModern = proposal.schema_version === PROPOSAL_SCHEMA_V3 || isSuccessor;
  const expectedReleaseComponents = isV5
    ? EXACT_V5_RELEASE_COMPONENTS
    : EXACT_V3_RELEASE_COMPONENTS;
  const requestedStaticReleaseDescriptor = proposal.requested_scope?.static_release_descriptor;
  const sealedStaticReleaseDescriptor = proposal.sealing?.static_release_descriptor;
  const requestedMaterializationSeedFacts = proposal.requested_scope?.materialization_seed_facts;
  const sealedMaterializationSeedFacts = proposal.sealing?.materialization_seed_facts;
  if (
    ![PROPOSAL_SCHEMA_V2, PROPOSAL_SCHEMA_V3, PROPOSAL_SCHEMA_V4, PROPOSAL_SCHEMA_V5].includes(
      proposal.schema_version,
    ) ||
    proposal.task_id !== "VF-10-13" ||
    proposal.proposal_status !== "PENDING_FRESH_EXACT_USER_APPROVAL" ||
    proposal.source?.release_source_commit !== expectedReleaseSourceCommit ||
    (isV5 && expectedReleaseSourceCommit !== SUCCESSOR_RELEASE_SOURCE_COMMIT) ||
    proposal.source?.proposal_record_commit !== null ||
    proposal.requested_scope?.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    JSON.stringify(proposal.requested_scope?.phase_caps_usd) !== JSON.stringify(EXPECTED_PHASE_CAPS)
  )
    fail("PROPOSAL_CONTRACT");
  if (
    isSuccessor &&
    (!COMMIT.test(proposal.source?.execution_control?.commit ?? "") ||
      proposal.source.execution_control.commit === expectedReleaseSourceCommit ||
      !exactKeys(proposal.source.execution_control, ["commit", "exact_components"]) ||
      JSON.stringify(proposal.source.execution_control.exact_components) !==
        JSON.stringify(EXACT_V4_EXECUTION_CONTROL_COMPONENTS) ||
      JSON.stringify(proposal.source.execution_control.exact_components?.approval_validator) !==
        JSON.stringify({
          path: "deploy/v2-13/validate-full-live-approval.mjs",
          source_commit_tree_binding: EXACT_APPROVAL_VALIDATOR_EXECUTION_CONTROL_BINDING,
        }) ||
      JSON.stringify(proposal.supersession?.predecessor_release_attempt) !==
        JSON.stringify(EXACT_PREDECESSOR_RELEASE_ATTEMPT) ||
      (isV5 &&
        JSON.stringify(proposal.supersession?.terminal_failed_successor_attempt) !==
          JSON.stringify(EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT)))
  )
    fail("EXECUTION_CONTROL_OR_PREDECESSOR_BINDING");
  if (
    isModern &&
    (proposal.sealing?.sealed_for_exact_user_approval !== true ||
      proposal.sealing?.current_bytes_are_approval_ineligible !== false ||
      proposal.supersession?.prior_approval_reusable !== false ||
      proposal.supersession?.fresh_exact_approval_required !== true ||
      proposal.authority_record_commit_binding?.strategy !==
        "EXTERNAL_GIT_COMMIT_INPUT_VERIFIED_BEFORE_CONSUMPTION_NO_SELF_HASH" ||
      proposal.authority_record_commit_binding?.proposal_record_commit_is_distinct !== true ||
      proposal.authority_record_commit_binding
        ?.authority_record_commit_must_contain_exact_approval_and_authority_bytes !== true ||
      proposal.authority_record_commit_binding?.remote_readback_required !== true ||
      proposal.authority_record_commit_binding?.embedded_self_commit_hash_forbidden !== true ||
      proposal.authority_record_commit_binding
        ?.materialization_seed_sha256_required_in_authority_and_consumption_state !== true ||
      proposal.authority_record_commit_binding
        ?.materialization_seed_sha256_must_be_verified_before_execution !== true ||
      proposal.authority?.exact_proposal_approved !== false ||
      proposal.authority?.execute_authorized !== false ||
      proposal.authority?.immutable_release_ref_creation_authorized !== false ||
      !exactStaticReleaseDescriptor(requestedStaticReleaseDescriptor) ||
      !exactStaticReleaseDescriptor(sealedStaticReleaseDescriptor) ||
      JSON.stringify(requestedStaticReleaseDescriptor) !==
        JSON.stringify(sealedStaticReleaseDescriptor) ||
      !exactMaterializationSeedFacts(
        requestedMaterializationSeedFacts,
        isSuccessor ? "source.execution_control.commit" : "source.release_source_commit",
      ) ||
      !exactMaterializationSeedFacts(
        sealedMaterializationSeedFacts,
        isSuccessor ? "source.execution_control.commit" : "source.release_source_commit",
      ) ||
      JSON.stringify(requestedMaterializationSeedFacts) !==
        JSON.stringify(sealedMaterializationSeedFacts) ||
      JSON.stringify(proposal.exact_execution_graph?.ordered_operation_ids) !==
        JSON.stringify(EXACT_OPERATION_IDS) ||
      proposal.exact_execution_graph?.operation_order_is_closed_and_non_reorderable !== true ||
      proposal.exact_execution_graph?.missing_extra_or_repeated_operation_is_a_hard_stop !== true ||
      JSON.stringify(proposal.exact_execution_graph?.image_workflow_verification_policy) !==
        JSON.stringify(EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY) ||
      (isSuccessor
        ? JSON.stringify(proposal.exact_execution_graph?.predecessor_mage_reconciliation_policy) !==
          JSON.stringify(EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY)
        : proposal.exact_execution_graph?.predecessor_mage_reconciliation_policy !== undefined) ||
      JSON.stringify(proposal.exact_execution_graph?.internal_materialization_policy) !==
        JSON.stringify(EXACT_INTERNAL_MATERIALIZATION_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.trusted_time_policy) !==
        JSON.stringify(EXACT_TRUSTED_TIME_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.prequalification_database_bootstrap_policy) !==
        JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.workflow_start_authority_policy) !==
        JSON.stringify(EXACT_WORKFLOW_START_AUTHORITY_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.early_no_database_cleanup_policy) !==
        JSON.stringify(EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.bootstrap_partial_cleanup_policy) !==
        JSON.stringify(EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.crash_safe_cleanup_policy) !==
        JSON.stringify(EXACT_CRASH_SAFE_CLEANUP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.durable_billing_policy) !==
        JSON.stringify(EXACT_DURABLE_BILLING_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.prequalification_bridge_policy) !==
        JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY) ||
      proposal.requested_scope?.cloudflare_secret_allowlist_count !==
        EXACT_CLOUDFLARE_SECRET_NAMES.length ||
      JSON.stringify(proposal.requested_scope?.cloudflare_secret_allowlist) !==
        JSON.stringify(EXACT_CLOUDFLARE_SECRET_NAMES) ||
      JSON.stringify(proposal.source?.exact_release_components) !==
        JSON.stringify(expectedReleaseComponents))
  )
    fail("V3_SUPERSESSION_OR_AUTHORITY");
  if (
    !exactKeys(approval, [
      "schema_version",
      "checkpoint_range",
      "task_id",
      "authority_id",
      ...(isModern ? ["full_live_authority_id"] : []),
      "approval_source",
      "approved_at",
      "expires_at",
      "proposal",
      "approval",
      "execution_fences",
      ...(isModern ? ["static_release_descriptor"] : []),
      "statement",
    ]) ||
    approval.schema_version !==
      (isSuccessor ? APPROVAL_SCHEMA_V3 : isModern ? APPROVAL_SCHEMA_V2 : APPROVAL_SCHEMA_V1) ||
    approval.task_id !== "VF-10-13" ||
    JSON.stringify(approval.checkpoint_range) !== JSON.stringify(CHECKPOINT_RANGE) ||
    approval.approval_source !== "explicit_user_approval_in_current_codex_task" ||
    !AUTHORITY_ID.test(approval.authority_id) ||
    (isModern &&
      approval.full_live_authority_id !== requestedMaterializationSeedFacts.full_live_authority_id)
  )
    fail("SCHEMA");
  if (
    !exactKeys(approval.proposal, [
      "path",
      "sha256",
      "proposal_record_commit",
      "release_source_commit",
      ...(isSuccessor ? ["execution_control_commit"] : []),
    ]) ||
    (isModern && !exactStaticReleaseDescriptor(approval.static_release_descriptor)) ||
    !exactKeys(approval.approval, [
      "exact_proposal_approved",
      "all_and_only_ordered_operations_approved",
      "single_use",
      "redispatch_authorized",
      "maximum_cumulative_finite_runpod_spend_usd",
      "phase_caps_usd",
      "gpu",
      "retention",
      "provider_free_control_plane",
      ...(isModern
        ? ["immutable_github_release_ref", "database_roles", "internal_production_credentials"]
        : []),
    ]) ||
    !exactKeys(approval.approval.phase_caps_usd, Object.keys(EXPECTED_PHASE_CAPS)) ||
    !exactKeys(approval.approval.gpu, [
      "exact_offering",
      "region",
      "minimum_availability_at_each_mutation_boundary",
      "maximum_serverless_flex_rate_usd_per_gpu_hour",
      "fallback_allowed",
    ]) ||
    !exactKeys(approval.approval.retention, [
      "retain_only_the_same_two_exact_volumes",
      "volume_count",
      "size_gb_each",
      "region",
      "combined_recurring_usd_per_month",
      "recurring_charge_separate_from_finite_cap",
      "new_volume_or_paid_retained_resource_authorized",
      "volume_resize_move_or_replacement_authorized",
      "recurring_plan_change_authorized",
    ]) ||
    !exactKeys(approval.approval.provider_free_control_plane, [
      "github_publication_expected_runpod_spend_usd",
      "database_activation_expected_runpod_spend_usd",
      "cloudflare_activation_expected_runpod_spend_usd",
      "guarded_child_gpu_use_authorized",
      "guarded_child_maximum_cumulative_finite_external_spend_usd",
      "exact_disabled_quarantine_creation_authorized",
      "new_r2_bucket_authorized",
      "new_paid_retained_resource_authorized",
      "other_resource_creation_authorized",
      "plan_change_authorized",
      "stop_on_metered_plan_or_new_paid_resource",
    ]) ||
    (isModern &&
      (!exactKeys(approval.approval.internal_production_credentials, [
        "exact_one_time_count",
        "exact_scope",
        "generated_only_after_consumption",
        "other_credential_creation_or_rotation_forbidden",
      ]) ||
        approval.approval.internal_production_credentials.exact_one_time_count !==
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count ||
        JSON.stringify(approval.approval.internal_production_credentials.exact_scope) !==
          JSON.stringify(
            EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
          ) ||
        approval.approval.internal_production_credentials.generated_only_after_consumption !==
          true ||
        approval.approval.internal_production_credentials
          .other_credential_creation_or_rotation_forbidden !== true)) ||
    !exactKeys(approval.execution_fences, EXECUTION_FENCE_KEYS)
  )
    fail("NESTED_SCHEMA");
  const approvedAt = Date.parse(approval.approved_at ?? "");
  const expiresAt = Date.parse(approval.expires_at ?? "");
  if (
    Number.isNaN(approvedAt) ||
    Number.isNaN(expiresAt) ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > 86_400_000
  )
    fail("EXPIRY");
  if (
    approval.proposal?.sha256 !== expectedProposalSha256 ||
    approval.proposal?.proposal_record_commit !== expectedProposalRecordCommit ||
    approval.proposal?.release_source_commit !== expectedReleaseSourceCommit ||
    (isSuccessor &&
      approval.proposal?.execution_control_commit !== proposal.source.execution_control.commit) ||
    approval.proposal?.path !== proposal.source.proposal_path
  )
    fail("LINEAGE");
  if (
    isModern &&
    (JSON.stringify(approval.static_release_descriptor) !==
      JSON.stringify(requestedStaticReleaseDescriptor) ||
      JSON.stringify(approval.static_release_descriptor) !==
        JSON.stringify(sealedStaticReleaseDescriptor))
  )
    fail("STATIC_RELEASE_DESCRIPTOR_BINDING");
  const approved = approval.approval;
  if (
    approved?.exact_proposal_approved !== true ||
    approved.all_and_only_ordered_operations_approved !== true ||
    approved.single_use !== true ||
    approved.redispatch_authorized !== false ||
    approved.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    JSON.stringify(approved.phase_caps_usd) !== JSON.stringify(EXPECTED_PHASE_CAPS) ||
    Object.values(approved.phase_caps_usd).reduce((sum, value) => sum + value, 0) !== 17.5
  )
    fail("CAPS_OR_SINGLE_USE");
  const gpu = approved.gpu;
  if (
    gpu?.exact_offering !== "NVIDIA GeForce RTX 4090" ||
    gpu.region !== "EU-RO-1" ||
    gpu.minimum_availability_at_each_mutation_boundary !== "LOW-or-better" ||
    gpu.maximum_serverless_flex_rate_usd_per_gpu_hour !==
      EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR ||
    gpu.fallback_allowed !== false
  )
    fail("GPU_RATE_REGION");
  const retention = approved.retention;
  if (
    retention?.retain_only_the_same_two_exact_volumes !== true ||
    retention.volume_count !== 2 ||
    retention.size_gb_each !== 50 ||
    retention.region !== "EU-RO-1" ||
    retention.combined_recurring_usd_per_month !== 7 ||
    retention.recurring_charge_separate_from_finite_cap !== true ||
    retention.new_volume_or_paid_retained_resource_authorized !== false ||
    retention.volume_resize_move_or_replacement_authorized !== false ||
    retention.recurring_plan_change_authorized !== false
  )
    fail("RETENTION");
  if (
    approved.provider_free_control_plane?.github_publication_expected_runpod_spend_usd !== 0 ||
    approved.provider_free_control_plane?.database_activation_expected_runpod_spend_usd !== 0 ||
    approved.provider_free_control_plane?.cloudflare_activation_expected_runpod_spend_usd !== 0 ||
    approved.provider_free_control_plane?.guarded_child_gpu_use_authorized !== false ||
    approved.provider_free_control_plane
      ?.guarded_child_maximum_cumulative_finite_external_spend_usd !== 0 ||
    approved.provider_free_control_plane?.new_r2_bucket_authorized !== false ||
    approved.provider_free_control_plane?.new_paid_retained_resource_authorized !== false ||
    approved.provider_free_control_plane?.other_resource_creation_authorized !== false ||
    approved.provider_free_control_plane?.plan_change_authorized !== false ||
    approved.provider_free_control_plane?.exact_disabled_quarantine_creation_authorized !== true ||
    approved.provider_free_control_plane?.stop_on_metered_plan_or_new_paid_resource !== true
  )
    fail("GUARDED_CHILD_SCOPE");
  if (isModern) {
    const requestedRef = proposal.immutable_github_release_ref_request;
    const approvedRef = approved.immutable_github_release_ref;
    const requestedDatabase = proposal.requested_scope?.database;
    const approvedDatabase = approved.database_roles;
    const approvedRefKeys = [
      "creation_authorized",
      "exact_tag_name",
      "exact_target_commit",
      "tag_kind",
      "maximum_new_refs",
      "force_update_authorized",
      "delete_or_retarget_authorized",
      "other_ref_creation_authorized",
      ...(isSuccessor
        ? ["predecessor_bound_reconciliation_only", "successor_tag_mutation_authorized"]
        : []),
    ];
    if (
      !exactKeys(approvedRef, approvedRefKeys) ||
      !exactKeys(approvedDatabase, [
        "exact_operator_role",
        "exact_runtime_role",
        "exact_reconciler_role",
        "roles_must_be_fresh_absent_distinct_login_noinherit_hardened",
        "exact_one_time_credential_count",
        "exact_credential_scope",
        "generated_only_after_consumption",
        "other_database_credential_creation_or_rotation_forbidden",
      ])
    )
      fail("V3_NESTED_SCHEMA");
    const expectedTag = isV5 ? SUCCESSOR_RELEASE_TAG : "videoforge-v2-13-release-20260826-v3";
    const expectedMaximumNewRefs = isV4 ? 0 : 1;
    if (
      requestedRef?.exact_tag_name !== expectedTag ||
      requestedRef.exact_target_commit !== expectedReleaseSourceCommit ||
      requestedRef.tag_kind !== "LIGHTWEIGHT" ||
      requestedRef.maximum_new_refs !== expectedMaximumNewRefs ||
      requestedRef.force_update_authorized !== false ||
      requestedRef.delete_or_retarget_authorized !== false ||
      requestedRef.other_ref_creation_authorized !== false ||
      (isV4 &&
        (requestedRef.creation_requested !== false ||
          requestedRef.predecessor_bound_reconciliation_only !== true ||
          requestedRef.successor_tag_mutation_authorized !== false)) ||
      (isV5 &&
        (requestedRef.creation_requested !== true ||
          requestedRef.predecessor_bound_reconciliation_only !== false ||
          requestedRef.successor_tag_mutation_authorized !== true)) ||
      approvedRef?.creation_authorized !== !isV4 ||
      approvedRef.exact_tag_name !== requestedRef.exact_tag_name ||
      approvedRef.exact_target_commit !== requestedRef.exact_target_commit ||
      approvedRef.tag_kind !== "LIGHTWEIGHT" ||
      approvedRef.maximum_new_refs !== expectedMaximumNewRefs ||
      approvedRef.force_update_authorized !== false ||
      approvedRef.delete_or_retarget_authorized !== false ||
      approvedRef.other_ref_creation_authorized !== false ||
      (isV4 &&
        (approvedRef.predecessor_bound_reconciliation_only !== true ||
          approvedRef.successor_tag_mutation_authorized !== false)) ||
      (isV5 &&
        (approvedRef.predecessor_bound_reconciliation_only !== false ||
          approvedRef.successor_tag_mutation_authorized !== true))
    )
      fail("IMMUTABLE_RELEASE_REF");
    if (
      !exactKeys(requestedDatabase, [
        "exact_operator_role",
        "exact_runtime_role",
        "exact_reconciler_role",
        "roles_must_be_fresh_absent_distinct_login_noinherit_hardened",
        "pgcrypto_required",
        "prequalification_database_bootstrap_operator_function_signature_count",
        "prequalification_database_bootstrap_operator_function_signature_namespace",
        "prequalification_database_bootstrap_operator_function_signature_canonicalization",
        "prequalification_database_bootstrap_operator_acl_comparison",
        "prequalification_database_bootstrap_public_execute_readback_count",
        "prequalification_database_bootstrap_public_default_execute_readback_count",
        "prequalification_database_bootstrap_ownership_catalogs",
        "prequalification_database_bootstrap_ownership_readback_is_cluster_wide",
        "prequalification_database_bootstrap_requires_consumed_outer_authority",
        "prequalification_database_bootstrap_credential_bundle_schema",
        "prequalification_database_bootstrap_credential_bundle_path",
        "prequalification_database_bootstrap_credentials_absent_before_consumed_bootstrap",
        "prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count",
        "prequalification_database_bootstrap_credential_roles",
        "prequalification_database_bootstrap_runtime_reconciler_credentials_staged_roles_absent_until_guarded_activation",
        "prequalification_database_bootstrap_exact_one_time_database_role_credential_count",
        "prequalification_database_bootstrap_exact_one_time_database_role_credential_scope",
        "prequalification_database_bootstrap_exact_one_time_internal_production_credential_count",
        "prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope",
        "prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count",
        "prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit",
        "prequalification_database_bootstrap_phase",
        "prequalification_database_bootstrap_phase_cap_usd",
        "prequalification_database_bootstrap_receipt_path",
        "prequalification_database_bootstrap_receipt_hash_field",
        "prequalification_database_bootstrap_receipt_replay_cas_required",
        "prequalification_database_bootstrap_recovery_mode_ledger_before_count",
        "prequalification_database_bootstrap_recovery_mode_final_ledger_count",
        "exact_operator_function_signatures",
        "exact_initial_ledger_prefix_count",
        "exact_recoverable_prefix_counts",
        "exact_migrations_to_apply",
      ]) ||
      requestedDatabase?.exact_operator_role !== "videoforge_hosted_operator" ||
      requestedDatabase?.exact_runtime_role !== "videoforge_hosted_runtime" ||
      requestedDatabase.exact_reconciler_role !== "videoforge_hosted_reconciler" ||
      requestedDatabase.roles_must_be_fresh_absent_distinct_login_noinherit_hardened !== true ||
      requestedDatabase.pgcrypto_required !== true ||
      requestedDatabase.prequalification_database_bootstrap_operator_function_signature_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_count ||
      requestedDatabase.prequalification_database_bootstrap_operator_function_signature_namespace !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_namespace ||
      requestedDatabase.prequalification_database_bootstrap_operator_function_signature_canonicalization !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_canonicalization ||
      requestedDatabase.prequalification_database_bootstrap_operator_acl_comparison !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_acl_comparison ||
      requestedDatabase.prequalification_database_bootstrap_public_execute_readback_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.public_function_execute_readback_count ||
      requestedDatabase.prequalification_database_bootstrap_public_default_execute_readback_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.public_default_function_execute_readback_count ||
      JSON.stringify(requestedDatabase.prequalification_database_bootstrap_ownership_catalogs) !==
        JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.ownership_catalogs) ||
      requestedDatabase.prequalification_database_bootstrap_ownership_readback_is_cluster_wide !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.ownership_readback_is_cluster_wide ||
      requestedDatabase.prequalification_database_bootstrap_requires_consumed_outer_authority !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.requires_consumed_outer_authority ||
      requestedDatabase.prequalification_database_bootstrap_credential_bundle_schema !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.database_role_credential_bundle_schema ||
      requestedDatabase.prequalification_database_bootstrap_credential_bundle_path !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.database_role_credential_bundle_path ||
      requestedDatabase.prequalification_database_bootstrap_credentials_absent_before_consumed_bootstrap !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.database_role_credentials_absent_before_consumed_bootstrap ||
      requestedDatabase.prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.database_role_credentials_materialized_after_migration_prefix_commit_count ||
      JSON.stringify(requestedDatabase.prequalification_database_bootstrap_credential_roles) !==
        JSON.stringify(
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.database_role_credentials_exact_roles,
        ) ||
      requestedDatabase.prequalification_database_bootstrap_runtime_reconciler_credentials_staged_roles_absent_until_guarded_activation !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.runtime_and_reconciler_credentials_staged_but_roles_remain_absent_until_guarded_activation ||
      requestedDatabase.prequalification_database_bootstrap_exact_one_time_database_role_credential_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_count ||
      requestedDatabase.prequalification_database_bootstrap_exact_one_time_database_role_credential_scope !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_scope ||
      requestedDatabase.prequalification_database_bootstrap_exact_one_time_internal_production_credential_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count ||
      JSON.stringify(
        requestedDatabase.prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope,
      ) !==
        JSON.stringify(
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
        ) ||
      requestedDatabase.prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.operator_dsn_policy
          .value_read_after_migration_prefix_commit_count ||
      requestedDatabase.prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.operator_dsn_policy
          .value_read_forbidden_before_migration_prefix_commit ||
      requestedDatabase.prequalification_database_bootstrap_phase !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.phase ||
      requestedDatabase.prequalification_database_bootstrap_phase_cap_usd !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.phase_cap_usd ||
      requestedDatabase.prequalification_database_bootstrap_receipt_path !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.receipt_path ||
      requestedDatabase.prequalification_database_bootstrap_receipt_hash_field !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.receipt_hash_field ||
      requestedDatabase.prequalification_database_bootstrap_receipt_replay_cas_required !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.receipt_replay_cas_required ||
      JSON.stringify(
        requestedDatabase.prequalification_database_bootstrap_recovery_mode_ledger_before_count,
      ) !==
        JSON.stringify(
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.recovery_mode_ledger_before_count,
        ) ||
      requestedDatabase.prequalification_database_bootstrap_recovery_mode_final_ledger_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.recovery_mode_final_ledger_count ||
      JSON.stringify(requestedDatabase.exact_operator_function_signatures) !==
        JSON.stringify(
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures,
        ) ||
      requestedDatabase.exact_initial_ledger_prefix_count !== 36 ||
      JSON.stringify(requestedDatabase.exact_recoverable_prefix_counts) !==
        JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]) ||
      JSON.stringify(requestedDatabase.exact_migrations_to_apply) !==
        JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]) ||
      approvedDatabase?.exact_operator_role !== requestedDatabase.exact_operator_role ||
      approvedDatabase?.exact_runtime_role !== requestedDatabase.exact_runtime_role ||
      approvedDatabase.exact_reconciler_role !== requestedDatabase.exact_reconciler_role ||
      approvedDatabase.roles_must_be_fresh_absent_distinct_login_noinherit_hardened !== true ||
      approvedDatabase.exact_one_time_credential_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_count ||
      approvedDatabase.exact_credential_scope !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_scope ||
      approvedDatabase.generated_only_after_consumption !== true ||
      approvedDatabase.other_database_credential_creation_or_rotation_forbidden !== true
    )
      fail("DATABASE_ROLES");
  }
  if (Object.values(approval.execution_fences).some((value) => value !== true))
    fail("EXECUTION_FENCES");
  if (
    typeof approval.statement !== "string" ||
    !approval.statement.includes(expectedProposalSha256) ||
    !approval.statement.includes(expectedProposalRecordCommit) ||
    !approval.statement.includes("USD 17.50") ||
    !approval.statement.includes("USD 7 per month") ||
    !approval.statement.includes("no fallback") ||
    (isModern &&
      (!(isV5
        ? approval.statement.includes(SUCCESSOR_RELEASE_TAG)
        : approval.statement.includes("videoforge-v2-13-release-20260826-v3")) ||
        !approval.statement.includes("videoforge_hosted_operator") ||
        !approval.statement.includes("videoforge_hosted_runtime") ||
        !approval.statement.includes("videoforge_hosted_reconciler")))
  )
    fail("STATEMENT");
  if (
    isSuccessor &&
    (!approval.statement.includes(proposal.source.execution_control.commit) ||
      !approval.statement.includes(EXACT_PREDECESSOR_RELEASE_ATTEMPT.terminal_state_sha256) ||
      (isV5 &&
        !approval.statement.includes(
          EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT.terminal_state_sha256,
        )))
  )
    fail("STATEMENT_EXECUTION_CONTROL_OR_PREDECESSOR");
  assertDistinctV4SuccessorAuthority(
    proposal.schema_version,
    approval.authority_id,
    EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  );
  return Object.freeze({
    authorityId: approval.authority_id,
    fullLiveAuthorityId: isModern ? approval.full_live_authority_id : null,
    approvedAt: approval.approved_at,
    expiresAt: approval.expires_at,
    proposalSha256: expectedProposalSha256,
    approvalSha256: sha256(approvalBytes),
    staticReleaseDescriptorPath: isModern ? requestedStaticReleaseDescriptor.path : null,
    staticReleaseDescriptorSha256: isModern ? requestedStaticReleaseDescriptor.sha256 : null,
    proposalRecordCommit: expectedProposalRecordCommit,
    releaseSourceCommit: expectedReleaseSourceCommit,
    executionControlCommit: isSuccessor
      ? proposal.source.execution_control.commit
      : expectedReleaseSourceCommit,
    executionControlComponents: isSuccessor
      ? proposal.source.execution_control.exact_components
      : null,
    predecessorReleaseAttempt: isSuccessor ? EXACT_PREDECESSOR_RELEASE_ATTEMPT : null,
    terminalFailedSuccessorAttempt: isV5 ? EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT : null,
    approvalValidatorSourceBinding: isSuccessor
      ? EXACT_APPROVAL_VALIDATOR_EXECUTION_CONTROL_BINDING
      : EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
    maximumCumulativeFiniteRunpodSpendUsd: 17.5,
    phaseCapsUsd: EXPECTED_PHASE_CAPS,
    proposalSchema: proposal.schema_version,
    exactOperatorRole: isModern ? approved.database_roles.exact_operator_role : null,
    exactRuntimeRole: isModern ? approved.database_roles.exact_runtime_role : null,
    exactReconcilerRole: isModern ? approved.database_roles.exact_reconciler_role : null,
  });
}

export {
  EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  EXACT_APPROVAL_VALIDATOR_EXECUTION_CONTROL_BINDING,
  EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT,
  EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_V5_RELEASE_COMPONENTS,
  EXACT_TRUSTED_TIME_POLICY,
  EXPECTED_SERVERLESS_FLEX_RATE_SOURCE,
  EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
  EXPECTED_PHASE_CAPS,
  PROPOSAL_SCHEMA_V4,
  PROPOSAL_SCHEMA_V5,
  SUCCESSOR_RELEASE_MODE,
  SUCCESSOR_RELEASE_SOURCE_COMMIT,
  SUCCESSOR_RELEASE_TAG,
  assertDistinctV4SuccessorAuthority,
  validateFullLiveUserApproval,
};
