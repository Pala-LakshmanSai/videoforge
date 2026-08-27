import { createHash } from "node:crypto";

const hash = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const proof = (letter) => `sha256:${letter.repeat(64)}`;

const FULL_LIVE_AUTHORITY_ID = "11111111-1111-4111-8111-111111111111";
const CLOUDFLARE_ACCOUNT_ID = "b".repeat(32);
const WORKER_NAME = "videoforge-production-runtime";
const WORKFLOW_NAME = "videoforge-production-runtime-workflow";
const R2_BUCKET_NAME = "videoforge-v2-06-staging-private";
const PUBLIC_ORIGIN = `https://${WORKER_NAME}.example.workers.dev`;
const RETAINED_LANES = {
  mage: {
    lane: "mage",
    volumeId: "c7kg89brtj",
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
    receiptKeyId: "v2-13-fixture-receipt-key",
  },
  soulx: {
    lane: "soulx",
    volumeId: "8byeafac9f",
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    receiptKeyId: "v2-13-fixture-receipt-key",
  },
};
const STAGE_AUTHORITY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAd1CnjP/Qb9yK1oBKEOwE4YZJvsRtfbUdCmtSmwH8xpU=
-----END PUBLIC KEY-----
`;
const QUALIFICATION_ENVELOPES = Object.fromEntries(
  [
    "mage",
    "soulx2s",
    "soulx4s",
    "soulx6s",
    "soulx10s",
    "soulxCancel",
    "soulxInvalidOutput",
    "soulxTimeout",
  ].map((name) => [name, { fixture_case: name }]),
);
const OAUTH_SCOPES = [
  "account:read",
  "agent-memory:write",
  "ai-search:run",
  "ai-search:write",
  "ai:write",
  "artifacts:write",
  "browser:write",
  "challenge-widgets.write",
  "cloudchamber:write",
  "connectivity:admin",
  "containers:write",
  "d1:write",
  "email_routing:write",
  "email_sending:write",
  "flagship:write",
  "offline_access",
  "pages:write",
  "pipelines:write",
  "queues:write",
  "secrets_store:write",
  "ssl_certs:write",
  "user:read",
  "websearch.run",
  "workers:write",
  "workers_kv:write",
  "workers_routes:write",
  "workers_scripts:write",
  "workers_tail:read",
  "zone:read",
];

function deterministicUuid(value) {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

const soulxCropApproval = {
  approval_path:
    "project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json",
  approval_sha256: "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45",
  candidate_path: "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json",
  candidate_sha256: "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442",
  profile_group_id: "soulx-pro-vf924u-full-split-v1",
  avatar_source_sha256: "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
  avatar_source_geometry: { width: 1672, height: 941 },
  native_sample_sha256: "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1",
  native_sample_geometry: { width: 512, height: 512, fps: 25 },
  full_profile_id: "soulx-pro-ranga-full-source-composite-v1",
  full_sample_sha256: "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
  full_output_geometry: { width: 1920, height: 1080, fps: 30 },
  split_profile_id: "soulx-pro-ranga-split-composite-v1",
  split_sample_sha256: "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
  split_output_geometry: { width: 1920, height: 1080, fps: 30 },
};

const activationRecordBase = {
  schema_version: "videoforge-v2-13-guarded-activation/v1",
  checkpoint: "V2-13",
  authority: {
    single_use: true,
    gpu_use_authorized: false,
    maximum_cumulative_finite_external_spend_usd: 0,
    exact_quarantine_creation_authorized: true,
    new_paid_retained_resources_authorized: false,
    other_resource_creation_authorized: false,
    plan_change_authorized: false,
    proposal_path:
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    confirmation_sha256: hash("EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION"),
  },
  release: {},
  database: {
    host: "ep-test.us-east-2.aws.neon.tech",
    database: "videoforge",
    owner_role: "videoforge_owner",
    operator_role: "videoforge_hosted_operator",
    operator_database_url_sha256: proof("1"),
    runtime_role: "videoforge_hosted_runtime",
    reconciler_role: "videoforge_hosted_reconciler",
    pgcrypto_required: true,
    first_migration: 37,
    last_migration: 45,
    exact_manifest_ledger_required: true,
  },
  cloudflare: {
    account_id: CLOUDFLARE_ACCOUNT_ID,
    worker_name: WORKER_NAME,
    preexisting_worker_required: false,
    exact_quarantine_creation_authorized: true,
    failure_policy: "KEEP_EXACT_DISABLED_QUARANTINE_ELSE_DELETE_ATTRIBUTABLE",
    preexisting_secret_set_must_be_empty: true,
    r2_bucket_name: R2_BUCKET_NAME,
    workflow_name: WORKFLOW_NAME,
    public_origin: PUBLIC_ORIGIN,
    wrangler_oauth_config_path_sha256: proof("2"),
    oauth_scopes: OAUTH_SCOPES,
    workers_dev_subdomain: "example",
    workers_dev_subdomain_readback_sha256: proof("3"),
    pre_mutation_account_readback_sha256: proof("4"),
    pre_mutation_worker_absence_sha256: proof("5"),
    pre_mutation_workflow_inventory_sha256: proof("6"),
    pre_mutation_r2_inventory_sha256: proof("7"),
    pre_mutation_route_readback_sha256:
      "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976",
    pre_mutation_route_content_type: "text/html; charset=UTF-8",
    pre_mutation_route_body_length: 19984,
  },
  gates: {},
  soulx_crop_approval: soulxCropApproval,
  secret_sha256: null,
};

const configActivationBase = {
  schema_version: "videoforge-v2-13-production-config-activation/v1",
  checkpoint: "V2-13",
  authority: {
    mode: "APPROVED_CONFIG_RENDER_ONLY",
    config_render_only: true,
    deployment_authorized: false,
    provider_calls_authorized: false,
    credential_access_authorized: false,
    external_spend_usd: 0,
  },
  release: {},
  cloudflare: {
    account_id: CLOUDFLARE_ACCOUNT_ID,
    worker_name: WORKER_NAME,
    workflow_name: WORKFLOW_NAME,
    r2_bucket_name: R2_BUCKET_NAME,
    public_origin: PUBLIC_ORIGIN,
  },
  runtime: {
    environment: "production",
    provider_mode: "production",
    gpu_transport: "DISABLED_UNQUALIFIED",
    assets_binding: "ASSETS",
    r2_binding: "PRIVATE_ARTIFACTS",
    workflow_binding: "VIDEO_WORKFLOW",
    version_metadata_binding: "CF_VERSION_METADATA",
    observability_enabled: true,
  },
};

const promotionRecordBase = {
  schema_version: "videoforge.v2-13-qualified-promotion/v1",
  approval: {},
  release: {},
  database: {
    activation_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:database:activation`),
    promotion_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:database:promotion`),
    rollback_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:database:rollback`),
    migration_ledger_sha256: proof("8"),
  },
  lanes: {
    mage_image: {
      deployment_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:mage:deployment`),
      qualification_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:mage:qualification`),
    },
    soulx_avatar: {
      deployment_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:soulx:deployment`),
      qualification_id: deterministicUuid(`${FULL_LIVE_AUTHORITY_ID}:soulx:qualification`),
    },
  },
  cloudflare: {
    account_id_sha256: hash(CLOUDFLARE_ACCOUNT_ID),
    public_origin: PUBLIC_ORIGIN,
    worker_name: WORKER_NAME,
    workflow_name: WORKFLOW_NAME,
  },
};

const releaseManifest = {
  schema_version: "videoforge-media-worker-release/v1",
  version: "1.0.0",
  minimum_protocol_version: 1,
  execution_bundle_sha256: proof("9"),
  whisper_model_sha256: proof("a"),
  windows: {
    url: "https://downloads.videoforge.example/worker.exe",
    sha256: proof("b"),
    size_bytes: 1,
    trust: "UNSIGNED_BETA",
  },
  macos: {
    url: "https://downloads.videoforge.example/worker.dmg",
    sha256: proof("c"),
    size_bytes: 1,
    trust: "AD_HOC_BETA",
  },
};

export function materializationSeedFixture() {
  return structuredClone({
    schema_version: "videoforge.v213-full-live-materialization-seed/v1",
    static_only: true,
    future_output_hashes_present: false,
    production_input_base: {
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: FULL_LIVE_AUTHORITY_ID,
      authorityDocument: {},
      dualLaneInput: {
        accountIdSha256: "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c",
        mage: structuredClone(RETAINED_LANES.mage),
        soulx: structuredClone(RETAINED_LANES.soulx),
        billingBaselineUsd: 0,
        totalCapUsd: 17.5,
        mageQualificationCapUsd: 4.5,
        soulxQualificationCapUsd: 1,
        stageAuthorityPublicKeyPem: STAGE_AUTHORITY_PUBLIC_KEY_PEM,
        envelopes: structuredClone(QUALIFICATION_ENVELOPES),
      },
      commandPayloads: {},
    },
    activation_record_base: activationRecordBase,
    config_activation_base: configActivationBase,
    release_manifest: releaseManifest,
    promotion_record_base: promotionRecordBase,
  });
}
