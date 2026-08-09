import type { WorkerJobEnvelopeDocument } from "../generated/contract-types.js";

const commonEnvelope = {
  schema_version: "worker-job-envelope/v1",
  job_type: "ASR",
  idempotency_key: "idempotency-key",
  workspace_id: "workspace_001",
  project_id: "project_001",
  revision_id: "revision_001",
  task_id: "task_001",
  attempt_id: "attempt_001",
  execution_profile_id: "profile_001",
  execution_claim_token: "claim-token-that-is-at-least-thirty-two-characters",
  revision_config: {
    asset_id: "revision_config_001",
    sha256: `sha256:${"a".repeat(64)}`,
  },
  output_prefix: "workspace/workspace_001/project_001/",
  cancel_token: "cancel-token-that-is-at-least-thirty-two-characters",
  deadline_at: "2026-08-09T12:00:00Z",
} as const;

const validLocal: WorkerJobEnvelopeDocument = {
  ...commonEnvelope,
  dispatch_target: "LOCAL",
  input_manifest: {
    asset_id: "input_001",
    sha256: `sha256:${"b".repeat(64)}`,
    artifact_uri: `vf-local://objects/sha256/bb/${"b".repeat(64)}.json`,
  },
  callback: null,
};

const validRunpod: WorkerJobEnvelopeDocument = {
  ...commonEnvelope,
  dispatch_target: "RUNPOD",
  input_manifest: {
    asset_id: "input_001",
    sha256: `sha256:${"b".repeat(64)}`,
    signed_url: "https://example.invalid/input.json",
    expires_at: "2026-08-09T11:59:00Z",
  },
  callback: {
    url: "https://example.invalid/callback",
    token: "callback-token-that-is-at-least-thirty-two-characters",
    expires_at: "2026-08-09T11:59:00Z",
  },
};

// @ts-expect-error LOCAL dispatch cannot carry signed HTTPS input or a callback.
const invalidLocal: WorkerJobEnvelopeDocument = {
  ...commonEnvelope,
  dispatch_target: "LOCAL",
  input_manifest: validRunpod.input_manifest,
  callback: validRunpod.callback,
};

void validLocal;
void validRunpod;
void invalidLocal;
