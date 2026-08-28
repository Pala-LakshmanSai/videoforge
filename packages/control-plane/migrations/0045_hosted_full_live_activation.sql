-- Durable, single-use authority and atomic promotion gate for the V2-13 full-live activation.
-- These owner-operated records never expose a provider-send capability to application roles.

ALTER TABLE public.serverless_endpoint_deployments
  DROP CONSTRAINT serverless_endpoint_deployments_worker_count_max_check;
ALTER TABLE public.serverless_endpoint_deployments
  ADD CONSTRAINT serverless_endpoint_deployments_worker_count_max_check
  CHECK (worker_count_max BETWEEN 1 AND 2);

CREATE TABLE public.hosted_full_live_authorities (
  id uuid PRIMARY KEY,
  authority_id text NOT NULL UNIQUE CHECK (length(authority_id) BETWEEN 1 AND 200),
  proposal_sha256 text NOT NULL UNIQUE CHECK (proposal_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  approval_sha256 text NOT NULL UNIQUE CHECK (approval_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  proposal_commit text NOT NULL CHECK (proposal_commit ~ '^[0-9a-f]{40}$'),
  source_commit text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  executor_sha256 text NOT NULL CHECK (executor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  phase_caps_usd jsonb NOT NULL,
  maximum_cumulative_spend_usd numeric(8,2) NOT NULL CHECK (maximum_cumulative_spend_usd=17.50),
  retention_region text NOT NULL CHECK (retention_region='EU-RO-1'),
  retention_volume_count smallint NOT NULL CHECK (retention_volume_count=2),
  retention_volume_size_gb smallint NOT NULL CHECK (retention_volume_size_gb=50),
  retention_monthly_usd numeric(8,2) NOT NULL CHECK (retention_monthly_usd=7.00),
  retention_separately_approved boolean NOT NULL CHECK (retention_separately_approved),
  single_use boolean NOT NULL CHECK (single_use),
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  authority_document jsonb NOT NULL,
  authority_document_sha256 text NOT NULL UNIQUE CHECK (authority_document_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_by_operator text NOT NULL CHECK (length(created_by_operator) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at>approved_at AND expires_at<=approved_at+interval '24 hours')
);

CREATE TABLE public.hosted_full_live_promotions (
  id uuid PRIMARY KEY,
  authority_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_authorities(id),
  migration_ledger_sha256 text NOT NULL CHECK (migration_ledger_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  mage_qualification_id uuid NOT NULL REFERENCES public.hosted_serverless_qualification_attestations(id),
  mage_qualification_sha256 text NOT NULL CHECK (mage_qualification_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  mage_deployment_id uuid NOT NULL REFERENCES public.serverless_endpoint_deployments(id),
  mage_deployment_snapshot_sha256 text NOT NULL CHECK (mage_deployment_snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  soulx_qualification_id uuid NOT NULL REFERENCES public.hosted_serverless_qualification_attestations(id),
  soulx_qualification_sha256 text NOT NULL CHECK (soulx_qualification_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  soulx_deployment_id uuid NOT NULL REFERENCES public.serverless_endpoint_deployments(id),
  soulx_deployment_snapshot_sha256 text NOT NULL CHECK (soulx_deployment_snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  disabled_config_sha256 text NOT NULL CHECK (disabled_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  enabled_config_sha256 text NOT NULL CHECK (enabled_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  decision_document jsonb NOT NULL,
  decision_sha256 text NOT NULL UNIQUE CHECK (decision_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  promoted_by_operator text NOT NULL CHECK (length(promoted_by_operator) BETWEEN 1 AND 200),
  promoted_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_cloudflare_activations (
  id uuid PRIMARY KEY,
  promotion_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_promotions(id),
  source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),
  version_id_sha256 text NOT NULL UNIQUE CHECK(version_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  deployed_config_sha256 text NOT NULL CHECK(deployed_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  readback_document jsonb NOT NULL,
  readback_sha256 text NOT NULL UNIQUE CHECK(readback_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_cloudflare_rollbacks (
  id uuid PRIMARY KEY,
  activation_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_cloudflare_activations(id),
  promotion_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_promotions(id),
  disabled_version_id_sha256 text NOT NULL UNIQUE CHECK(disabled_version_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  disabled_config_sha256 text NOT NULL CHECK(disabled_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  route_status integer NOT NULL CHECK(route_status BETWEEN 100 AND 599),
  route_version_sha256 text NOT NULL CHECK(route_version_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  rollback_document jsonb NOT NULL,
  rollback_sha256 text NOT NULL UNIQUE CHECK(rollback_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE public.hosted_full_live_stage_authorities (
  authority_id text PRIMARY KEY CHECK(length(authority_id) BETWEEN 1 AND 191),
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  stage text NOT NULL CHECK(stage IN ('mage','soulx','production')),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  predecessor_handoff_sha256 text NOT NULL CHECK(predecessor_handoff_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  nonce_sha256 text NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signed_authority jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(full_live_authority_id,stage),
  CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '15 minutes')
);
CREATE TABLE public.hosted_full_live_stage_consumptions (
  authority_id text PRIMARY KEY REFERENCES public.hosted_full_live_stage_authorities(authority_id),
  nonce_sha256 text NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  consumed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_stage_completions (
  authority_id text PRIMARY KEY REFERENCES public.hosted_full_live_stage_authorities(authority_id),
  handoff_sha256 text NOT NULL UNIQUE CHECK(handoff_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
-- Secret-bearing qualification handoffs contain one-use worker dispatch tokens. They are never
-- portable backup metadata and are only decrypted inside operator SECURITY DEFINER functions
-- after the exact current authority/stage/predecessor chain has been rechecked.
CREATE TABLE public.hosted_full_live_stage_handoff_escrow (
  authority_id text PRIMARY KEY REFERENCES public.hosted_full_live_stage_authorities(authority_id),
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  stage text NOT NULL CHECK(stage IN ('mage','soulx','production')),
  handoff_sha256 text NOT NULL UNIQUE CHECK(handoff_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  handoff_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(full_live_authority_id,stage)
);
CREATE TABLE public.hosted_full_live_operation_events (
  operation_id text NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 191),
  sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 16),
  stage_authority_id text NOT NULL REFERENCES public.hosted_full_live_stage_authorities(authority_id),
  kind text NOT NULL CHECK(kind IN ('create','readback','dispatch','status','cancel','delete')),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  resource_key text NOT NULL CHECK(length(resource_key) BETWEEN 1 AND 191),
  state text NOT NULL CHECK(state IN ('IN_FLIGHT','ACK_UNKNOWN','ACKED','TERMINAL')),
  provider_id text CHECK(provider_id IS NULL OR length(provider_id) BETWEEN 1 AND 191),
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(operation_id,sequence)
);
CREATE TABLE public.hosted_full_live_bridge_command_events (
  operation_id text NOT NULL CHECK(operation_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'),
  sequence integer NOT NULL CHECK(sequence>0),
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  kind text NOT NULL CHECK(kind IN ('create','readback','dispatch','status','cancel','delete')),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  resource_key text NOT NULL CHECK(length(resource_key) BETWEEN 1 AND 240),
  state text NOT NULL CHECK(state IN ('IN_FLIGHT','ACK_UNKNOWN','ACKED','TERMINAL')),
  result_document jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(operation_id,sequence)
);

CREATE TABLE public.hosted_full_live_workflow_start_authorities (
  id uuid PRIMARY KEY,
  full_live_authority_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_authorities(id),
  token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '15 minutes')
);
CREATE TABLE public.hosted_full_live_workflow_start_claims (
  id uuid PRIMARY KEY,
  workflow_start_authority_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_workflow_start_authorities(id),
  workflow_id text NOT NULL UNIQUE CHECK(workflow_id ~ '^hosted-pair-[0-9a-f-]{36}$'),
  generation_request_id uuid NOT NULL UNIQUE,
  request_sha256 text NOT NULL UNIQUE CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  params_sha256 text NOT NULL CHECK(params_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_workflow_start_results (
  claim_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_workflow_start_claims(id),
  result_document jsonb NOT NULL,
  result_sha256 text NOT NULL UNIQUE CHECK(result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE public.hosted_full_live_acceptance_authorities (
  id uuid PRIMARY KEY,
  -- Acceptance is a child of the durable 24-hour full-live authority.  The workflow-start
  -- authority is retained only as the operation-16 lineage/token parent; child expiry is never
  -- inherited from its fifteen-minute window.
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  workflow_start_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_workflow_start_authorities(id),
  checkpoint text NOT NULL CHECK(checkpoint IN ('V2-10','V2-11','V2-12','V2-13')),
  command_id text NOT NULL UNIQUE CHECK(command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
  request_sha256 text NOT NULL UNIQUE CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_document jsonb NOT NULL,
  execution_document jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(full_live_authority_id,checkpoint),
  UNIQUE(workflow_start_authority_id,checkpoint),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE public.hosted_full_live_acceptance_claims (
  id uuid PRIMARY KEY,
  acceptance_authority_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_acceptance_authorities(id),
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_acceptance_results (
  claim_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_acceptance_claims(id),
  state text NOT NULL CHECK(state IN ('COMPLETED','FAILED_CLEAN')),
  evidence_sha256 text NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_sha256 text NOT NULL CHECK(result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_acceptance_operator_results (
  claim_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_acceptance_claims(id),
  result_sha256 text NOT NULL UNIQUE CHECK(result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_signed_evidence (
  artifact_sha256 text PRIMARY KEY CHECK(artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  kind text NOT NULL CHECK(kind IN ('RECEIPT','CLEANUP','CHROME','RELEASE','V210_OUTPUT','V211_EVIDENCE','V212_OUTPUT')),
  document jsonb NOT NULL,
  key_id text NOT NULL REFERENCES public.hosted_provider_proof_keys(key_id),
  signature_hex text NOT NULL CHECK(signature_hex ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(kind,artifact_sha256)
);
CREATE TABLE public.hosted_full_live_acceptance_repository_records (
  repository text NOT NULL CHECK(repository IN ('SHORT_PILOT','PRODUCTION_LENGTH')),
  key_sha256 text NOT NULL CHECK(key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sequence smallint NOT NULL CHECK(sequence BETWEEN 1 AND 3),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('READY','SUBMITTED','ACCEPTED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(repository,key_sha256,sequence)
);

CREATE TRIGGER hosted_full_live_authorities_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_full_live_authorities FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_promotions_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_full_live_promotions FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_cloudflare_activations_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_full_live_cloudflare_activations FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_cloudflare_rollbacks_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_full_live_cloudflare_rollbacks FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_stage_authorities_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_stage_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_stage_consumptions_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_stage_consumptions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_stage_completions_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_stage_completions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_stage_handoff_escrow_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_stage_handoff_escrow
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_operation_events_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_operation_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_bridge_command_events_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_bridge_command_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_workflow_start_authorities_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_workflow_start_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_workflow_start_claims_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_workflow_start_claims
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_workflow_start_results_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_workflow_start_results
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_authorities_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_claims_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_claims
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_results_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_results
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_operator_results_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_operator_results
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_signed_evidence_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_signed_evidence
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_repository_records_append_only BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_repository_records
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_promotions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cloudflare_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cloudflare_activations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cloudflare_rollbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cloudflare_rollbacks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_consumptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_completions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_handoff_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_stage_handoff_escrow FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_operation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_bridge_command_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_bridge_command_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_workflow_start_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_workflow_start_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_workflow_start_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_workflow_start_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_workflow_start_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_workflow_start_results FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_results FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_operator_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_operator_results FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_signed_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_signed_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_repository_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_repository_records FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_authorities_owner_only ON public.hosted_full_live_authorities
  USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_promotions_owner_only ON public.hosted_full_live_promotions
  USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_cloudflare_activations_owner_only ON public.hosted_full_live_cloudflare_activations USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_cloudflare_rollbacks_owner_only ON public.hosted_full_live_cloudflare_rollbacks USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_stage_authorities_owner_only ON public.hosted_full_live_stage_authorities USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_stage_consumptions_owner_only ON public.hosted_full_live_stage_consumptions USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_stage_completions_owner_only ON public.hosted_full_live_stage_completions USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_stage_handoff_escrow_owner_only ON public.hosted_full_live_stage_handoff_escrow USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_operation_events_owner_only ON public.hosted_full_live_operation_events USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_bridge_command_events_owner_only ON public.hosted_full_live_bridge_command_events USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_workflow_start_authorities_owner_only ON public.hosted_full_live_workflow_start_authorities USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_workflow_start_claims_owner_only ON public.hosted_full_live_workflow_start_claims USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_workflow_start_results_owner_only ON public.hosted_full_live_workflow_start_results USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_authorities_owner_only ON public.hosted_full_live_acceptance_authorities USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_claims_owner_only ON public.hosted_full_live_acceptance_claims USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_results_owner_only ON public.hosted_full_live_acceptance_results USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_operator_results_owner_only ON public.hosted_full_live_acceptance_operator_results USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_signed_evidence_owner_only ON public.hosted_full_live_signed_evidence USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_repository_records_owner_only ON public.hosted_full_live_acceptance_repository_records USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_authorities FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_promotions FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_cloudflare_activations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_cloudflare_rollbacks FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_stage_authorities FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_stage_consumptions FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_stage_completions FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_stage_handoff_escrow FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_operation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_bridge_command_events FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_workflow_start_authorities FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_workflow_start_claims FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_workflow_start_results FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_authorities FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_claims FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_results FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_operator_results FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_signed_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_repository_records FROM PUBLIC;

CREATE FUNCTION public.videoforge_record_hosted_full_live_authority(
  supplied_id uuid, supplied_authority jsonb
) RETURNS TABLE(authority_id uuid, authority_document_sha256 text, database_now timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  document_hash text;
  existing public.hosted_full_live_authorities%ROWTYPE;
  exact_caps jsonb:='{"mage_qualification":4.5,"soulx_qualification":1,"v2_09_short_hosted_project":2,"v2_10_operator_free_ranga_pilot":2,"v2_11_two_concurrent_owned_projects":4,"v2_12_long_output":2,"v2_13_final_two_lane_smoke":2}'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_id::text,45));
  IF jsonb_typeof(supplied_authority)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_authority) key)
       IS DISTINCT FROM ARRAY['approvalSha256','approvedAt','authorityId','executorSha256','expiresAt',
         'maximumCumulativeSpendUsd','phaseCapsUsd','proposalCommit','proposalSha256','retention',
         'schemaVersion','singleUse','sourceCommit','staticReleaseDescriptorSha256']::text[]
     OR supplied_authority->>'schemaVersion'<>'videoforge-v2-13-full-live-authority/v1'
     OR supplied_authority->>'proposalSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'approvalSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'proposalCommit' !~ '^[0-9a-f]{40}$'
     OR supplied_authority->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied_authority->>'executorSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'staticReleaseDescriptorSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->'phaseCapsUsd' IS DISTINCT FROM exact_caps
     OR (supplied_authority->>'maximumCumulativeSpendUsd')::numeric<>17.50
     OR (supplied_authority->>'singleUse')::boolean IS DISTINCT FROM true
     OR supplied_authority->'retention' IS DISTINCT FROM
       '{"region":"EU-RO-1","volumeCount":2,"volumeSizeGb":50,"monthlyUsd":7,"separatelyApproved":true}'::jsonb
     OR (supplied_authority->>'approvedAt')::timestamptz>db_now
     OR (supplied_authority->>'expiresAt')::timestamptz<db_now
     OR (supplied_authority->>'expiresAt')::timestamptz>
       (supplied_authority->>'approvedAt')::timestamptz+interval '24 hours' THEN
    RAISE EXCEPTION 'hosted full-live authority invalid' USING ERRCODE='23514';
  END IF;
  document_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_authority),'UTF8')),'hex');
  SELECT * INTO existing FROM public.hosted_full_live_authorities WHERE id=supplied_id;
  IF existing.id IS NOT NULL THEN
    IF existing.authority_document IS DISTINCT FROM supplied_authority
       OR existing.authority_document_sha256<>document_hash
       OR EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p WHERE p.authority_id=existing.id) THEN
      RAISE EXCEPTION 'hosted full-live authority replay drift or superseded' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT existing.id,existing.authority_document_sha256,db_now;
    RETURN;
  END IF;
  INSERT INTO public.hosted_full_live_authorities(id,authority_id,proposal_sha256,approval_sha256,
    proposal_commit,source_commit,executor_sha256,phase_caps_usd,maximum_cumulative_spend_usd,
    retention_region,retention_volume_count,retention_volume_size_gb,retention_monthly_usd,
    retention_separately_approved,single_use,approved_at,expires_at,authority_document,
    authority_document_sha256,created_by_operator,created_at)
  VALUES(supplied_id,supplied_authority->>'authorityId',supplied_authority->>'proposalSha256',
    supplied_authority->>'approvalSha256',supplied_authority->>'proposalCommit',
    supplied_authority->>'sourceCommit',supplied_authority->>'executorSha256',exact_caps,17.50,
    'EU-RO-1',2,50,7,true,true,(supplied_authority->>'approvedAt')::timestamptz,
    (supplied_authority->>'expiresAt')::timestamptz,supplied_authority,document_hash,session_user,db_now);
  RETURN QUERY SELECT supplied_id,document_hash,db_now;
END;
$$;

CREATE FUNCTION public.videoforge_promote_hosted_full_live(
  supplied_promotion_id uuid, supplied_authority_id uuid, supplied_promotion jsonb
) RETURNS TABLE(decision_sha256 text, migration_ledger_sha256 text, database_now timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); authority public.hosted_full_live_authorities%ROWTYPE;
  mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE;
  existing public.hosted_full_live_promotions%ROWTYPE;
  ledger jsonb; ledger_hash text; decision jsonb; decision_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_authority_id::text,45));
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=supplied_authority_id FOR UPDATE;
  IF authority.id IS NULL OR authority.expires_at<db_now OR authority.approved_at>db_now
     OR supplied_promotion->>'authorityDocumentSha256'<>authority.authority_document_sha256
     OR supplied_promotion->>'sourceCommit'<>authority.source_commit
     OR supplied_promotion->>'executorSha256'<>authority.executor_sha256 THEN
    RAISE EXCEPTION 'hosted full-live authority unavailable or consumed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_promotions
    WHERE authority_id=supplied_authority_id;
  IF existing.id IS NOT NULL THEN
    IF existing.id<>supplied_promotion_id
       OR existing.migration_ledger_sha256<>supplied_promotion->>'migrationLedgerSha256'
       OR existing.disabled_config_sha256<>supplied_promotion->>'disabledConfigSha256'
       OR existing.enabled_config_sha256<>supplied_promotion->>'enabledConfigSha256'
       OR existing.decision_document->>'authorityDocumentSha256'<>supplied_promotion->>'authorityDocumentSha256'
       OR existing.decision_document->>'sourceCommit'<>supplied_promotion->>'sourceCommit'
       OR existing.decision_document->>'executorSha256'<>supplied_promotion->>'executorSha256'
       OR existing.decision_document->'lanes' IS DISTINCT FROM supplied_promotion->'lanes' THEN
      RAISE EXCEPTION 'hosted full-live promotion replay drift' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT existing.decision_sha256,existing.migration_ledger_sha256,existing.promoted_at;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=40 AND sha256='sha256:9e7cbbecd515c8781f66a6888d1283abeb2e91baee4f61d6ad1857775a67c1a3')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=41 AND sha256='sha256:24f161e5c441f7cfa6b7837d185e64b3eae182d729c8ef21ef6850aeec9bcf84')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=42 AND sha256='sha256:d7168a4143a813df7b9114f76f1efe71aa287bec4b1f137ab414a98e65e6b967')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=44 AND sha256='sha256:8ab2a30c7df970531e521fac0662f666ef2689a908057fa4525a623c11622a6f')
     OR (SELECT count(*) FROM public.videoforge_schema_migrations)<>45
     OR (SELECT max(version) FROM public.videoforge_schema_migrations)<>45 THEN
    RAISE EXCEPTION 'hosted full-live migration lineage invalid' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'filename',filename,'sha256',sha256) ORDER BY version)
    INTO ledger FROM public.videoforge_schema_migrations;
  ledger_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(ledger),'UTF8')),'hex');
  IF supplied_promotion->>'migrationLedgerSha256'<>ledger_hash THEN
    RAISE EXCEPTION 'hosted full-live migration ledger hash invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations
    WHERE id=(supplied_promotion#>>'{lanes,mage_image,qualificationId}')::uuid FOR SHARE;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations
    WHERE id=(supplied_promotion#>>'{lanes,soulx_avatar,qualificationId}')::uuid FOR SHARE;
  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments
    WHERE id=(supplied_promotion#>>'{lanes,mage_image,deploymentId}')::uuid FOR SHARE;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments
    WHERE id=(supplied_promotion#>>'{lanes,soulx_avatar,deploymentId}')::uuid FOR SHARE;
  IF mage_q.lane<>'mage_image' OR soulx_q.lane<>'soulx_avatar'
     OR mage_q.deployment_id<>mage_d.id OR soulx_q.deployment_id<>soulx_d.id
     OR NOT mage_q.independent_audit_accepted OR NOT soulx_q.independent_audit_accepted
     OR mage_q.verified_at>db_now OR soulx_q.verified_at>db_now
     OR mage_q.expires_at<db_now OR soulx_q.expires_at<db_now
     OR mage_q.qualification_record_sha256<>supplied_promotion#>>'{lanes,mage_image,qualificationSha256}'
     OR soulx_q.qualification_record_sha256<>supplied_promotion#>>'{lanes,soulx_avatar,qualificationSha256}'
     OR NOT mage_d.is_active OR NOT soulx_d.is_active
     OR mage_d.worker_count_min<>0 OR soulx_d.worker_count_min<>0
     OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_d.region<>'EU-RO-1' OR soulx_d.region<>'EU-RO-1'
     OR mage_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR soulx_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR mage_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id)
     OR mage_q.deployment_snapshot_sha256<>supplied_promotion#>>'{lanes,mage_image,deploymentSnapshotSha256}'
     OR soulx_q.deployment_snapshot_sha256<>supplied_promotion#>>'{lanes,soulx_avatar,deploymentSnapshotSha256}'
     OR supplied_promotion->>'disabledConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_promotion->>'enabledConfigSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hosted full-live qualification or deployment invalid' USING ERRCODE='23514';
  END IF;
  decision:=jsonb_build_object('schemaVersion','videoforge-v2-13-full-live-promotion/v1',
    'authorityId',supplied_authority_id,'authorityDocumentSha256',authority.authority_document_sha256,
    'sourceCommit',authority.source_commit,'executorSha256',authority.executor_sha256,
    'migrationLedgerSha256',ledger_hash,'lanes',supplied_promotion->'lanes',
    'disabledConfigSha256',supplied_promotion->>'disabledConfigSha256',
    'enabledConfigSha256',supplied_promotion->>'enabledConfigSha256','databaseNow',db_now);
  decision_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(decision),'UTF8')),'hex');
  INSERT INTO public.hosted_full_live_promotions(id,authority_id,migration_ledger_sha256,
    mage_qualification_id,mage_qualification_sha256,mage_deployment_id,mage_deployment_snapshot_sha256,
    soulx_qualification_id,soulx_qualification_sha256,soulx_deployment_id,soulx_deployment_snapshot_sha256,
    disabled_config_sha256,enabled_config_sha256,decision_document,decision_sha256,promoted_by_operator,promoted_at)
  VALUES(supplied_promotion_id,supplied_authority_id,ledger_hash,mage_q.id,mage_q.qualification_record_sha256,
    mage_d.id,mage_q.deployment_snapshot_sha256,soulx_q.id,soulx_q.qualification_record_sha256,
    soulx_d.id,soulx_q.deployment_snapshot_sha256,supplied_promotion->>'disabledConfigSha256',
    supplied_promotion->>'enabledConfigSha256',decision,decision_hash,session_user,db_now);
  RETURN QUERY SELECT decision_hash,ledger_hash,db_now;
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_cloudflare_activation(
  supplied_id uuid, supplied_readback jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); promotion public.hosted_full_live_promotions%ROWTYPE;
  authority public.hosted_full_live_authorities%ROWTYPE; record_hash text;
  existing public.hosted_full_live_cloudflare_activations%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied_readback)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_readback) key)
       IS DISTINCT FROM ARRAY['deployedConfigSha256','deployedExecutableSha256','observedAt',
         'productionUrlSha256','promotionId','routeBodySha256','routeReadbackSha256',
         'routeStatus','routeVersionSha256','schemaVersion','sourceCommit','versionIdSha256']::text[]
     OR supplied_readback->>'schemaVersion' IS DISTINCT FROM
        'videoforge.v213-cloudflare-activation-readback/v1'
     OR coalesce(supplied_readback->>'sourceCommit','') !~ '^[0-9a-f]{40}$'
     OR coalesce(supplied_readback->>'versionIdSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(supplied_readback->>'deployedExecutableSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(supplied_readback->>'deployedConfigSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(supplied_readback->>'productionUrlSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(supplied_readback->>'routeBodySha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(supplied_readback->>'routeReadbackSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_readback->>'routeVersionSha256' IS DISTINCT FROM
        supplied_readback->>'versionIdSha256'
     OR supplied_readback->'routeStatus' IS DISTINCT FROM '200'::jsonb
     OR supplied_readback->>'routeReadbackSha256' IS DISTINCT FROM
        'sha256:'||encode(sha256(convert_to(
          '{"productionUrlSha256":"'||(supplied_readback->>'productionUrlSha256')||
          '","routeStatus":200,"routeBodySha256":"'||(supplied_readback->>'routeBodySha256')||
          '","routeVersionSha256":"'||(supplied_readback->>'routeVersionSha256')||
          '","gpuTransport":"QUALIFIED_EXACT"}','UTF8')),'hex')
     OR (supplied_readback->>'observedAt')::timestamptz>db_now
     OR (supplied_readback->>'observedAt')::timestamptz<db_now-interval '5 minutes' THEN
    RAISE EXCEPTION 'V213 Cloudflare activation readback invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_readback->>'promotionId',45));
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE id=(supplied_readback->>'promotionId')::uuid FOR SHARE;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=promotion.authority_id FOR SHARE;
  IF promotion.id IS NULL OR authority.expires_at<=db_now
     OR supplied_readback->>'sourceCommit' IS DISTINCT FROM authority.source_commit
     OR supplied_readback->>'deployedConfigSha256' IS DISTINCT FROM
        promotion.enabled_config_sha256 THEN
    RAISE EXCEPTION 'V213 Cloudflare activation lineage invalid' USING ERRCODE='23514';
  END IF;
  record_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_readback),'UTF8')),'hex');
  SELECT * INTO existing FROM public.hosted_full_live_cloudflare_activations
    WHERE promotion_id=promotion.id;
  IF existing.id IS NOT NULL THEN
    IF existing.id<>supplied_id OR existing.readback_document IS DISTINCT FROM supplied_readback
       OR existing.readback_sha256<>record_hash THEN
      RAISE EXCEPTION 'V213 Cloudflare activation replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('readbackSha256',existing.readback_sha256,
      'versionIdSha256',existing.version_id_sha256,
      'deployedExecutableSha256',existing.readback_document->>'deployedExecutableSha256',
      'deployedConfigSha256',existing.deployed_config_sha256,
      'productionUrlSha256',existing.readback_document->>'productionUrlSha256',
      'routeStatus',(existing.readback_document->>'routeStatus')::integer,
      'routeBodySha256',existing.readback_document->>'routeBodySha256',
      'routeVersionSha256',existing.readback_document->>'routeVersionSha256',
      'routeReadbackSha256',existing.readback_document->>'routeReadbackSha256');
  END IF;
  INSERT INTO public.hosted_full_live_cloudflare_activations(id,promotion_id,source_commit,
    version_id_sha256,deployed_config_sha256,readback_document,readback_sha256,observed_at)
  VALUES(supplied_id,promotion.id,authority.source_commit,supplied_readback->>'versionIdSha256',
    promotion.enabled_config_sha256,supplied_readback,record_hash,(supplied_readback->>'observedAt')::timestamptz);
  RETURN jsonb_build_object('readbackSha256',record_hash,'versionIdSha256',supplied_readback->>'versionIdSha256',
    'deployedExecutableSha256',supplied_readback->>'deployedExecutableSha256',
    'deployedConfigSha256',promotion.enabled_config_sha256,
    'productionUrlSha256',supplied_readback->>'productionUrlSha256',
    'routeStatus',(supplied_readback->>'routeStatus')::integer,
    'routeBodySha256',supplied_readback->>'routeBodySha256',
    'routeVersionSha256',supplied_readback->>'routeVersionSha256',
    'routeReadbackSha256',supplied_readback->>'routeReadbackSha256');
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_cloudflare_rollback(
  supplied_id uuid, supplied_rollback jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); activation public.hosted_full_live_cloudflare_activations%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE; existing public.hosted_full_live_cloudflare_rollbacks%ROWTYPE;
  record_hash text;
BEGIN
  IF jsonb_typeof(supplied_rollback)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_rollback) key)
       IS DISTINCT FROM ARRAY['activationId','disabledConfigSha256','disabledVersionIdSha256','observedAt','promotionId','routeStatus','routeVersionSha256','schemaVersion']::text[]
     OR supplied_rollback->>'schemaVersion'<>'videoforge.v213-cloudflare-rollback-readback/v1'
     OR supplied_rollback->>'disabledVersionIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_rollback->>'disabledConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_rollback->>'routeVersionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied_rollback->>'routeStatus')::integer<>503
     OR supplied_rollback->>'routeVersionSha256'<>supplied_rollback->>'disabledVersionIdSha256'
     OR (supplied_rollback->>'observedAt')::timestamptz>db_now
     OR (supplied_rollback->>'observedAt')::timestamptz<db_now-interval '5 minutes' THEN
    RAISE EXCEPTION 'V213 Cloudflare rollback readback invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_rollback->>'activationId',451));
  SELECT * INTO activation FROM public.hosted_full_live_cloudflare_activations
    WHERE id=(supplied_rollback->>'activationId')::uuid FOR SHARE;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions
    WHERE id=(supplied_rollback->>'promotionId')::uuid FOR SHARE;
  IF activation.id IS NULL OR promotion.id IS NULL OR activation.promotion_id<>promotion.id
     OR supplied_rollback->>'disabledConfigSha256'<>promotion.disabled_config_sha256 THEN
    RAISE EXCEPTION 'V213 Cloudflare rollback lineage invalid' USING ERRCODE='23514';
  END IF;
  record_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_rollback),'UTF8')),'hex');
  SELECT * INTO existing FROM public.hosted_full_live_cloudflare_rollbacks WHERE activation_id=activation.id;
  IF existing.id IS NOT NULL THEN
    IF existing.id<>supplied_id OR existing.rollback_document IS DISTINCT FROM supplied_rollback
       OR existing.rollback_sha256<>record_hash THEN
      RAISE EXCEPTION 'V213 Cloudflare rollback replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('rollbackSha256',existing.rollback_sha256,
      'disabledVersionIdSha256',existing.disabled_version_id_sha256,
      'disabledConfigSha256',existing.disabled_config_sha256);
  END IF;
  INSERT INTO public.hosted_full_live_cloudflare_rollbacks(id,activation_id,promotion_id,
    disabled_version_id_sha256,disabled_config_sha256,route_status,route_version_sha256,
    rollback_document,rollback_sha256,observed_at)
  VALUES(supplied_id,activation.id,promotion.id,supplied_rollback->>'disabledVersionIdSha256',
    promotion.disabled_config_sha256,(supplied_rollback->>'routeStatus')::integer,
    supplied_rollback->>'routeVersionSha256',supplied_rollback,record_hash,
    (supplied_rollback->>'observedAt')::timestamptz);
  RETURN jsonb_build_object('rollbackSha256',record_hash,
    'disabledVersionIdSha256',supplied_rollback->>'disabledVersionIdSha256',
    'disabledConfigSha256',promotion.disabled_config_sha256);
END;
$$;

-- The policy reconciler needs the exact already-qualified endpoint and template identifiers to
-- apply the temporary V2-11 max-two boundary. These are non-secret provider resource identities
-- and are bound to the hashes already stored on the deployment. Raw retained-volume identifiers
-- remain outside Postgres; the Worker discovers them from authenticated endpoint inventory and
-- validates their hash against volume_id_sha256 immediately before the provider mutation.
ALTER TABLE public.serverless_endpoint_deployments
  ADD COLUMN provider_endpoint_id text
    CHECK(provider_endpoint_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'),
  ADD COLUMN provider_template_id text
    CHECK(provider_template_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$');

CREATE FUNCTION public.videoforge_record_v213_stage_authority(
  supplied_full_live_authority_id uuid, supplied_authority jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); nonce_hash text;
BEGIN
  IF supplied_authority->>'schemaVersion'<>'videoforge.v213-stage-authority/v1'
     OR supplied_authority->>'stage' NOT IN ('mage','soulx','production')
     OR supplied_authority->>'inputSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'predecessorHandoffSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'authorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'
     OR supplied_authority->>'nonce' !~ '^[A-Za-z0-9_.:-]{16,190}$'
     OR supplied_authority->>'signatureBase64' !~ '^[A-Za-z0-9+/]{80,120}={0,2}$'
     OR (supplied_authority->>'singleUse')::boolean IS DISTINCT FROM true
     OR (supplied_authority->>'issuedAt')::timestamptz>db_now
     OR (supplied_authority->>'issuedAt')::timestamptz<db_now-interval '1 minute'
     OR (supplied_authority->>'expiresAt')::timestamptz<=db_now
     OR (supplied_authority->>'expiresAt')::timestamptz>(supplied_authority->>'issuedAt')::timestamptz+interval '15 minutes'
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities a
       WHERE a.id=supplied_full_live_authority_id AND a.expires_at>db_now
         AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p WHERE p.authority_id=a.id))
     OR (supplied_authority->>'stage'='mage' AND EXISTS(SELECT 1 FROM public.hosted_full_live_stage_authorities
       WHERE full_live_authority_id=supplied_full_live_authority_id))
     OR (supplied_authority->>'stage'='soulx' AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_stage_authorities prior
       JOIN public.hosted_full_live_stage_completions done ON done.authority_id=prior.authority_id
       WHERE prior.full_live_authority_id=supplied_full_live_authority_id AND prior.stage='mage'
         AND done.handoff_sha256=supplied_authority->>'predecessorHandoffSha256'))
     OR (supplied_authority->>'stage'='production' AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_stage_authorities prior
       JOIN public.hosted_full_live_stage_completions done ON done.authority_id=prior.authority_id
       WHERE prior.full_live_authority_id=supplied_full_live_authority_id AND prior.stage='soulx'
         AND done.handoff_sha256=supplied_authority->>'predecessorHandoffSha256')) THEN
    RAISE EXCEPTION 'V213 stage authority invalid' USING ERRCODE='23514';
  END IF;
  nonce_hash:='sha256:'||encode(sha256(convert_to(supplied_authority->>'nonce','UTF8')),'hex');
  INSERT INTO public.hosted_full_live_stage_authorities(authority_id,full_live_authority_id,stage,input_sha256,
    predecessor_handoff_sha256,nonce_sha256,signed_authority,issued_at,expires_at)
  VALUES(supplied_authority->>'authorityId',supplied_full_live_authority_id,supplied_authority->>'stage',
    supplied_authority->>'inputSha256',supplied_authority->>'predecessorHandoffSha256',nonce_hash,
    supplied_authority,(supplied_authority->>'issuedAt')::timestamptz,(supplied_authority->>'expiresAt')::timestamptz);
  RETURN supplied_authority;
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_stage_authority(supplied_authority jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); stored public.hosted_full_live_stage_authorities%ROWTYPE; nonce_hash text;
BEGIN
  SELECT * INTO stored FROM public.hosted_full_live_stage_authorities
    WHERE authority_id=supplied_authority->>'authorityId' FOR SHARE;
  nonce_hash:='sha256:'||encode(sha256(convert_to(supplied_authority->>'nonce','UTF8')),'hex');
  IF stored.authority_id IS NULL OR stored.signed_authority IS DISTINCT FROM supplied_authority
     OR stored.nonce_sha256<>nonce_hash OR stored.expires_at<=db_now THEN
    RETURN NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM public.hosted_full_live_stage_consumptions WHERE authority_id=stored.authority_id) THEN
    RETURN (SELECT jsonb_build_object('decision','REPLAY_REJECTED','authorityId',authority_id,
      'nonceSha256',nonce_sha256,'consumedAt',to_char(consumed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      FROM public.hosted_full_live_stage_consumptions WHERE authority_id=stored.authority_id);
  END IF;
  INSERT INTO public.hosted_full_live_stage_consumptions(authority_id,nonce_sha256,consumed_at)
    VALUES(stored.authority_id,nonce_hash,db_now);
  RETURN jsonb_build_object('decision','EXECUTE','authorityId',stored.authority_id,
    'nonceSha256',nonce_hash,'consumedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

CREATE FUNCTION public.videoforge_complete_v213_stage_authority(
  supplied_authority_id text,
  supplied_handoff_sha256 text,
  supplied_handoff jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE existing text; stored public.hosted_full_live_stage_authorities%ROWTYPE;
  escrow public.hosted_full_live_stage_handoff_escrow%ROWTYPE;
  handoff_key text:=current_setting('videoforge.v213_handoff_key',true); computed text; schema_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_authority_id,45));
  SELECT * INTO stored FROM public.hosted_full_live_stage_authorities WHERE authority_id=supplied_authority_id;
  schema_name:=supplied_handoff->>'schemaVersion';
  computed:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    CASE WHEN supplied_handoff ? 'handoffSha256' THEN supplied_handoff-'handoffSha256' ELSE supplied_handoff END
  ),'UTF8')),'hex');
  IF supplied_handoff_sha256 !~ '^sha256:[0-9a-f]{64}$' OR jsonb_typeof(supplied_handoff)<>'object'
     OR handoff_key IS NULL OR length(handoff_key)<32 OR stored.authority_id IS NULL
     OR computed<>supplied_handoff_sha256
     OR (supplied_handoff ? 'handoffSha256' AND supplied_handoff->>'handoffSha256'<>supplied_handoff_sha256)
     OR (stored.stage='mage' AND schema_name<>'videoforge.v213-mage-qualification-handoff/v1')
     OR (stored.stage='soulx' AND schema_name<>'videoforge.v213-soulx-qualification-handoff/v1')
     OR (stored.stage='production' AND schema_name<>'videoforge.v213-dual-lane-live/v1')
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_stage_consumptions WHERE authority_id=supplied_authority_id) THEN
    RAISE EXCEPTION 'V213 stage completion invalid' USING ERRCODE='23514';
  END IF;
  SELECT handoff_sha256 INTO existing FROM public.hosted_full_live_stage_completions WHERE authority_id=supplied_authority_id;
  IF existing IS NOT NULL THEN
    IF existing<>supplied_handoff_sha256 THEN RAISE EXCEPTION 'V213 stage completion drift' USING ERRCODE='23505'; END IF;
    SELECT * INTO escrow FROM public.hosted_full_live_stage_handoff_escrow WHERE authority_id=supplied_authority_id;
    IF escrow.authority_id IS NULL OR escrow.handoff_sha256<>supplied_handoff_sha256
       OR pgp_sym_decrypt(escrow.handoff_ciphertext,handoff_key)::jsonb<>supplied_handoff THEN
      RAISE EXCEPTION 'V213 stage handoff escrow drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('authorityId',supplied_authority_id,'handoffSha256',existing,'replayed',true);
  END IF;
  INSERT INTO public.hosted_full_live_stage_completions(authority_id,handoff_sha256)
    VALUES(supplied_authority_id,supplied_handoff_sha256);
  INSERT INTO public.hosted_full_live_stage_handoff_escrow(authority_id,full_live_authority_id,stage,
    handoff_sha256,handoff_ciphertext)
  VALUES(stored.authority_id,stored.full_live_authority_id,stored.stage,supplied_handoff_sha256,
    pgp_sym_encrypt(public.videoforge_canonical_jsonb(supplied_handoff),handoff_key,
      'cipher-algo=aes256,compress-algo=0'));
  RETURN jsonb_build_object('authorityId',supplied_authority_id,'handoffSha256',supplied_handoff_sha256,'replayed',false);
END;
$$;

CREATE FUNCTION public.videoforge_load_v213_stage_handoff(
  supplied_full_live_authority_id uuid,
  supplied_stage text,
  supplied_handoff_sha256 text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE handoff_key text:=current_setting('videoforge.v213_handoff_key',true);
  escrow public.hosted_full_live_stage_handoff_escrow%ROWTYPE; result jsonb;
BEGIN
  IF supplied_stage NOT IN ('mage','soulx','production')
     OR supplied_handoff_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR handoff_key IS NULL OR length(handoff_key)<32 THEN
    RAISE EXCEPTION 'V213 stage handoff load invalid' USING ERRCODE='42501';
  END IF;
  SELECT e.* INTO escrow FROM public.hosted_full_live_stage_handoff_escrow e
  JOIN public.hosted_full_live_stage_authorities s ON s.authority_id=e.authority_id
  JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
  JOIN public.hosted_full_live_stage_completions d ON d.authority_id=s.authority_id
  JOIN public.hosted_full_live_authorities a ON a.id=s.full_live_authority_id
  WHERE e.full_live_authority_id=supplied_full_live_authority_id AND e.stage=supplied_stage
    AND e.handoff_sha256=supplied_handoff_sha256 AND d.handoff_sha256=e.handoff_sha256
    AND a.expires_at>transaction_timestamp();
  IF escrow.authority_id IS NULL THEN
    RAISE EXCEPTION 'V213 stage handoff unavailable' USING ERRCODE='42501';
  END IF;
  result:=pgp_sym_decrypt(escrow.handoff_ciphertext,handoff_key)::jsonb;
  IF result IS NULL THEN RAISE EXCEPTION 'V213 stage handoff unavailable' USING ERRCODE='42501'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.videoforge_load_v213_cleanup_scope(
  supplied_full_live_authority_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities a
    WHERE a.id=supplied_full_live_authority_id) THEN
    RAISE EXCEPTION 'V213 cleanup scope unavailable' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'schemaVersion','videoforge.v213-cleanup-scope/v1',
    'fullLiveAuthorityId',supplied_full_live_authority_id,
    'stages',COALESCE(jsonb_agg(jsonb_build_object(
      'stage',stage_rows.stage,
      'stageAuthorityId',stage_rows.authority_id,
      'operations',stage_rows.operations
    ) ORDER BY CASE stage_rows.stage WHEN 'mage' THEN 1 WHEN 'soulx' THEN 2 ELSE 3 END),'[]'::jsonb)
  ) INTO result
  FROM (
    SELECT s.stage,s.authority_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind',latest.kind,'resourceKey',latest.resource_key,'state',latest.state,
        'providerId',latest.provider_id,'evidence',latest.evidence
      ) ORDER BY latest.operation_id)
      FROM (SELECT DISTINCT ON (e.operation_id) e.*
        FROM public.hosted_full_live_operation_events e
        WHERE e.stage_authority_id=s.authority_id
        ORDER BY e.operation_id,e.sequence DESC) latest),'[]'::jsonb) operations
    FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    WHERE s.full_live_authority_id=supplied_full_live_authority_id
  ) stage_rows;
  RETURN result;
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_receipt_verification_key(
  supplied_key_id text, supplied_secret_base64 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE secret_bytes bytea; existing public.hosted_provider_proof_keys%ROWTYPE;
BEGIN
  IF supplied_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
     OR supplied_secret_base64 !~ '^[A-Za-z0-9+/]+={0,2}$' THEN
    RAISE EXCEPTION 'V213 receipt verification key invalid' USING ERRCODE='23514';
  END IF;
  BEGIN secret_bytes:=decode(supplied_secret_base64,'base64');
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'V213 receipt verification key invalid' USING ERRCODE='23514';
  END;
  IF octet_length(secret_bytes)<32 OR encode(secret_bytes,'base64')<>supplied_secret_base64 THEN
    RAISE EXCEPTION 'V213 receipt verification key invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_key_id,45));
  SELECT * INTO existing FROM public.hosted_provider_proof_keys WHERE key_id=supplied_key_id;
  IF existing.key_id IS NOT NULL THEN
    IF existing.secret_hex<>encode(secret_bytes,'hex') OR NOT existing.active THEN
      RAISE EXCEPTION 'V213 receipt verification key drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.key_id;
  END IF;
  INSERT INTO public.hosted_provider_proof_keys(key_id,secret_hex,active)
    VALUES(supplied_key_id,encode(secret_bytes,'hex'),true);
  RETURN supplied_key_id;
END;
$$;

CREATE FUNCTION public.videoforge_verify_v213_qualification_receipt(
  supplied_receipt jsonb, supplied_key_id text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE secret text; receipt_hash text; signature_preimage jsonb;
BEGIN
  SELECT secret_hex INTO secret FROM public.hosted_provider_proof_keys
    WHERE key_id=supplied_key_id AND active;
  IF secret IS NULL OR jsonb_typeof(supplied_receipt)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_receipt) key)
       IS DISTINCT FROM ARRAY['attempt_id','attestation_scope','deployment','dispatch_token','envelope_sha256',
         'issued_at','items','lane','model_ready_evidence','provider_job_id','receipt_id','receipt_nonce',
         'receipt_sha256','request_sha256','runtime_probe','schema_version','scratch_cleanup','signature',
         'tenant','timings','volume_verification','worker_id']::text[]
     OR supplied_receipt->>'schema_version'<>'serverless-provenance-receipt/v1'
     OR supplied_receipt->>'attestation_scope'<>'VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION'
     OR supplied_receipt->>'lane' NOT IN ('mage_image','soulx_avatar')
     OR supplied_receipt->>'receipt_sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{signature,algorithm}'<>'HMAC-SHA256'
     OR supplied_receipt#>>'{signature,key_id}'<>supplied_key_id
     OR supplied_receipt#>>'{signature,value}' !~ '^[0-9a-f]{64}$'
     OR supplied_receipt#>>'{deployment,endpoint_id_sha256}' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{deployment,container_digest}' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{deployment,intended_region}'<>'EU-RO-1'
     OR supplied_receipt#>>'{deployment,intended_volume_id_sha256}' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{deployment,model_manifest_sha256}' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{runtime_probe,gpu_name}'<>'NVIDIA GeForce RTX 4090'
     OR (supplied_receipt#>>'{runtime_probe,gpu_count}')::integer<>1
     OR supplied_receipt#>>'{runtime_probe,probe_source}'<>'WORKER_RUNTIME_SELF_REPORT'
     OR supplied_receipt#>>'{volume_verification,manifest_sha256_before}' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_receipt#>>'{volume_verification,manifest_sha256_after}'<>
        supplied_receipt#>>'{volume_verification,manifest_sha256_before}'
     OR (supplied_receipt#>>'{volume_verification,mutation_detected}')::boolean IS DISTINCT FROM false
     OR (supplied_receipt#>>'{volume_verification,cross_mount_detected}')::boolean IS DISTINCT FROM false
     OR supplied_receipt#>>'{model_ready_evidence,state}'<>'MODEL_READY'
     OR (supplied_receipt#>>'{model_ready_evidence,warmup_completed}')::boolean IS DISTINCT FROM true
     OR supplied_receipt#>>'{model_ready_evidence,warmup_output_sha256}' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied_receipt#>>'{scratch_cleanup,removed}')::boolean IS DISTINCT FROM true
     OR (supplied_receipt#>>'{scratch_cleanup,scratch_on_model_volume}')::boolean IS DISTINCT FROM false
     OR jsonb_typeof(supplied_receipt->'items')<>'array'
     OR jsonb_array_length(supplied_receipt->'items')<1
     OR (supplied_receipt->>'issued_at')::timestamptz>transaction_timestamp() THEN
    RETURN false;
  END IF;
  receipt_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    supplied_receipt-'receipt_sha256'-'signature'),'UTF8')),'hex');
  signature_preimage:=jsonb_build_object('key_id',supplied_key_id,'receipt_sha256',receipt_hash);
  RETURN receipt_hash=supplied_receipt->>'receipt_sha256'
    AND supplied_receipt#>>'{signature,value}'=encode(hmac(
      convert_to(public.videoforge_canonical_jsonb(signature_preimage),'UTF8'),decode(secret,'hex'),'sha256'),'hex');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RETURN false;
END;
$$;

-- Operator-only, atomic publication of the two immutable max-one production deployments and the
-- fresh qualifications proven by the consumed, completed, encrypted staged handoffs.
CREATE FUNCTION public.videoforge_publish_v213_qualified_deployments(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); handoff_key text:=current_setting('videoforge.v213_handoff_key',true);
  authority public.hosted_full_live_authorities%ROWTYPE;
  mage_stage public.hosted_full_live_stage_authorities%ROWTYPE;
  soulx_stage public.hosted_full_live_stage_authorities%ROWTYPE;
  production_stage public.hosted_full_live_stage_authorities%ROWTYPE;
  mage_hash text; soulx_hash text; production_hash text;
  mage_handoff jsonb; soulx_handoff jsonb; result jsonb; receipts jsonb; receipt jsonb;
  production jsonb; first_receipt jsonb; receipt_hashes jsonb; timeout_evidence jsonb;
  lane_name text; lane_short text; stage_id text; new_deployment_id uuid; new_qualification_id uuid;
  handoff jsonb; snapshot text; record_hash text; expiry timestamptz;
  existing_deployment public.serverless_endpoint_deployments%ROWTYPE;
  existing_qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  lane_results jsonb:='{}'::jsonb; any_replay boolean:=false; all_replay boolean:=true;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['fullLiveAuthorityId','mageDeploymentId','mageQualificationId',
         'mageStageAuthorityId','productionStageAuthorityId','receiptKeyId','schemaVersion',
         'soulxDeploymentId','soulxQualificationId','soulxStageAuthorityId']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v213-qualified-deployment-publication/v1'
     OR supplied->>'receiptKeyId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
     OR handoff_key IS NULL OR length(handoff_key)<32 THEN
    RAISE EXCEPTION 'V213 qualified deployment publication invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'fullLiveAuthorityId',45));
  SELECT * INTO authority FROM public.hosted_full_live_authorities
    WHERE id=(supplied->>'fullLiveAuthorityId')::uuid FOR SHARE;
  SELECT s.* INTO mage_stage FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    WHERE s.authority_id=supplied->>'mageStageAuthorityId' AND s.stage='mage'
      AND s.full_live_authority_id=authority.id;
  SELECT s.* INTO soulx_stage FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    WHERE s.authority_id=supplied->>'soulxStageAuthorityId' AND s.stage='soulx'
      AND s.full_live_authority_id=authority.id;
  SELECT s.* INTO production_stage FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    WHERE s.authority_id=supplied->>'productionStageAuthorityId' AND s.stage='production'
      AND s.full_live_authority_id=authority.id;
  SELECT handoff_sha256 INTO mage_hash FROM public.hosted_full_live_stage_completions
    WHERE authority_id=mage_stage.authority_id;
  SELECT handoff_sha256 INTO soulx_hash FROM public.hosted_full_live_stage_completions
    WHERE authority_id=soulx_stage.authority_id;
  SELECT handoff_sha256 INTO production_hash FROM public.hosted_full_live_stage_completions
    WHERE authority_id=production_stage.authority_id;
  SELECT pgp_sym_decrypt(handoff_ciphertext,handoff_key)::jsonb INTO mage_handoff
    FROM public.hosted_full_live_stage_handoff_escrow WHERE authority_id=mage_stage.authority_id;
  SELECT pgp_sym_decrypt(handoff_ciphertext,handoff_key)::jsonb INTO soulx_handoff
    FROM public.hosted_full_live_stage_handoff_escrow WHERE authority_id=soulx_stage.authority_id;
  SELECT pgp_sym_decrypt(handoff_ciphertext,handoff_key)::jsonb INTO result
    FROM public.hosted_full_live_stage_handoff_escrow WHERE authority_id=production_stage.authority_id;
  IF authority.id IS NULL OR authority.expires_at<=db_now OR mage_stage.authority_id IS NULL
     OR soulx_stage.authority_id IS NULL OR production_stage.authority_id IS NULL
     OR mage_hash IS NULL OR soulx_hash IS NULL OR production_hash IS NULL
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(mage_handoff) key)
       IS DISTINCT FROM ARRAY['authorityConsumption','billingAfterUsd','handoffSha256','inputSha256',
         'priorHandoffSha256','receipt','schemaVersion','threeStableZeroWorkerReads','zeroWorkersAfter']::text[]
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(soulx_handoff) key)
       IS DISTINCT FROM ARRAY['authorityConsumption','billingAfterUsd','handoffSha256','inputSha256',
         'priorHandoffSha256','receipts','schemaVersion','threeStableZeroWorkerReads','zeroWorkersAfter']::text[]
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(result) key)
       IS DISTINCT FROM ARRAY['production','productionAuthorityConsumption','qualificationReceipts','qualified',
         'schemaVersion','settled']::text[]
     OR mage_handoff->>'schemaVersion'<>'videoforge.v213-mage-qualification-handoff/v1'
     OR soulx_handoff->>'schemaVersion'<>'videoforge.v213-soulx-qualification-handoff/v1'
     OR result->>'schemaVersion'<>'videoforge.v213-dual-lane-live/v1'
     OR (result->>'qualified')::boolean IS DISTINCT FROM true
     OR mage_hash<>mage_handoff->>'handoffSha256' OR soulx_hash<>soulx_handoff->>'handoffSha256'
     OR production_hash<>'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(result),'UTF8')),'hex')
     OR mage_hash<>'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
       mage_handoff-'handoffSha256'),'UTF8')),'hex')
     OR soulx_hash<>'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
       soulx_handoff-'handoffSha256'),'UTF8')),'hex')
     OR mage_handoff->>'inputSha256'<>soulx_handoff->>'inputSha256'
     OR soulx_handoff->>'priorHandoffSha256'<>mage_hash
     OR mage_stage.input_sha256<>mage_handoff->>'inputSha256'
     OR soulx_stage.input_sha256<>mage_handoff->>'inputSha256'
     OR production_stage.input_sha256<>mage_handoff->>'inputSha256'
     OR soulx_stage.predecessor_handoff_sha256<>mage_hash
     OR production_stage.predecessor_handoff_sha256<>soulx_hash
     OR mage_handoff#>>'{authorityConsumption,authorityId}'<>mage_stage.authority_id
     OR soulx_handoff#>>'{authorityConsumption,authorityId}'<>soulx_stage.authority_id
     OR result#>>'{productionAuthorityConsumption,authorityId}'<>production_stage.authority_id
     OR (mage_handoff->>'zeroWorkersAfter')::boolean IS DISTINCT FROM true
     OR (soulx_handoff->>'zeroWorkersAfter')::boolean IS DISTINCT FROM true
     OR (mage_handoff->>'threeStableZeroWorkerReads')::boolean IS DISTINCT FROM true
     OR (soulx_handoff->>'threeStableZeroWorkerReads')::boolean IS DISTINCT FROM true
     OR (result#>>'{settled,threeStableZeroWorkerReads}')::boolean IS DISTINCT FROM true
     OR result->'qualificationReceipts' IS DISTINCT FROM
        jsonb_build_array(mage_handoff->'receipt')||(soulx_handoff->'receipts')
     OR result#>>'{production,mage,volumeIdSha256}'=result#>>'{production,soulx,volumeIdSha256}' THEN
    RAISE EXCEPTION 'V213 qualified deployment stage lineage invalid' USING ERRCODE='23514';
  END IF;
  expiry:=least(db_now+interval '24 hours',authority.expires_at);

  FOREACH lane_name IN ARRAY ARRAY['mage_image','soulx_avatar'] LOOP
    lane_short:=CASE lane_name WHEN 'mage_image' THEN 'mage' ELSE 'soulx' END;
    new_deployment_id:=CASE lane_name WHEN 'mage_image' THEN (supplied->>'mageDeploymentId')::uuid
      ELSE (supplied->>'soulxDeploymentId')::uuid END;
    new_qualification_id:=CASE lane_name WHEN 'mage_image' THEN (supplied->>'mageQualificationId')::uuid
      ELSE (supplied->>'soulxQualificationId')::uuid END;
    handoff:=CASE lane_name WHEN 'mage_image' THEN mage_handoff ELSE soulx_handoff END;
    stage_id:=CASE lane_name WHEN 'mage_image' THEN mage_stage.authority_id ELSE soulx_stage.authority_id END;
    receipts:=CASE lane_name WHEN 'mage_image' THEN jsonb_build_array(mage_handoff->'receipt') ELSE soulx_handoff->'receipts' END;
    production:=result#>(ARRAY['production',lane_short]);
    IF jsonb_typeof(receipts)<>'array'
       OR jsonb_array_length(receipts)<>(CASE lane_name WHEN 'mage_image' THEN 1 ELSE 4 END)
       OR jsonb_typeof(production)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(production) key)
         IS DISTINCT FROM ARRAY['deploymentSha256','endpointId','endpointIdSha256','gpu','gpuCount','handlerConcurrency',
           'image','initTimeoutSeconds','lane','purpose','region','scalerType','scalerValue','sourceCommit','templateId',
           'templateIdSha256','volumeIdSha256','volumeManifestSha256','volumeMount','volumeSizeGb','workersMax','workersMin']::text[]
       OR production->>'lane'<>lane_short OR production->>'purpose'<>'production'
       OR production->>'sourceCommit'<>authority.source_commit
       OR production->>'image' !~ '^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$'
       OR coalesce(production->>'endpointId','') !~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
       OR coalesce(production->>'templateId','') !~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
       OR production->>'endpointIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR production->>'templateIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR production->>'endpointIdSha256' IS DISTINCT FROM 'sha256:'||encode(sha256(
          convert_to(production->>'endpointId','UTF8')),'hex')
       OR production->>'templateIdSha256' IS DISTINCT FROM 'sha256:'||encode(sha256(
          convert_to(production->>'templateId','UTF8')),'hex')
       OR production->>'deploymentSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR production->>'volumeIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR production->>'volumeManifestSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR (production->>'volumeSizeGb')::integer<>50 OR production->>'volumeMount'<>'/runpod-volume'
       OR production->>'region'<>'EU-RO-1' OR production->>'gpu'<>'NVIDIA GeForce RTX 4090'
       OR (production->>'gpuCount')::integer<>1 OR (production->>'workersMin')::integer<>0
       OR (production->>'workersMax')::integer<>1 OR (production->>'handlerConcurrency')::integer<>1
       OR production->>'scalerType'<>'REQUEST_COUNT' OR (production->>'scalerValue')::integer<>1
       OR (production->>'initTimeoutSeconds')::integer<>800 THEN
      RAISE EXCEPTION 'V213 production deployment readback invalid for %',lane_name USING ERRCODE='23514';
    END IF;
    receipt_hashes:='[]'::jsonb; first_receipt:=receipts->0;
    FOR receipt IN SELECT value FROM jsonb_array_elements(receipts) item(value) LOOP
      IF NOT public.videoforge_verify_v213_qualification_receipt(receipt,supplied->>'receiptKeyId')
         OR receipt->>'lane'<>lane_name
         OR receipt#>>'{deployment,container_digest}'<>substring(production->>'image' from 'sha256:[0-9a-f]{64}$')
         OR receipt#>>'{deployment,intended_volume_id_sha256}'<>production->>'volumeIdSha256'
         OR receipt#>>'{volume_verification,manifest_sha256_before}'<>production->>'volumeManifestSha256'
         OR receipt#>>'{deployment,model_manifest_sha256}'<>first_receipt#>>'{deployment,model_manifest_sha256}' THEN
        RAISE EXCEPTION 'V213 qualification receipt binding invalid for %',lane_name USING ERRCODE='23514';
      END IF;
      receipt_hashes:=receipt_hashes||jsonb_build_array(receipt->>'receipt_sha256');
    END LOOP;
    timeout_evidence:=jsonb_build_object('provider_defaults_accepted','false','sealed_lineage',jsonb_build_object(
      'schemaVersion','videoforge.v213-qualified-deployment-lineage/v1','fullLiveAuthorityId',authority.id,
      'stageAuthorityId',stage_id,'qualificationHandoffSha256',handoff->>'handoffSha256',
      'qualificationSourceSha256',handoff->>'handoffSha256',
      'acceptanceContractSha256',handoff->>'handoffSha256',
      'productionStageAuthorityId',production_stage.authority_id,
      'imageSourceCommit',authority.source_commit,
      'workerImageDigest',substring(production->>'image' from 'sha256:[0-9a-f]{64}$'),
      'modelManifestSha256',first_receipt#>>'{deployment,model_manifest_sha256}',
      'volumeIdSha256',production->>'volumeIdSha256','volumeManifestSha256',production->>'volumeManifestSha256',
      'endpointIdSha256',production->>'endpointIdSha256',
      'endpointTemplateIdSha256',production->>'templateIdSha256',
      'endpointConfigSha256',production->>'deploymentSha256',
      'region','EU-RO-1','gpu','NVIDIA GeForce RTX 4090',
      'receiptSha256s',receipt_hashes));
    record_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(jsonb_build_object(
      'schemaVersion','serverless-endpoint-deployment/v3','deploymentId',new_deployment_id,'lane',lane_name,
      'endpointProfileId','template:'||(production->>'templateIdSha256'),
      'endpointIdSha256',production->>'endpointIdSha256',
      'endpointConfigSha256',production->>'deploymentSha256','workerImageDigest',substring(production->>'image' from 'sha256:[0-9a-f]{64}$'),
      'modelManifestSha256',first_receipt#>>'{deployment,model_manifest_sha256}',
      'volumeIdSha256',production->>'volumeIdSha256','volumeManifestSha256',production->>'volumeManifestSha256',
      'timeoutEvidence',timeout_evidence,'deploymentVersion',1)),'UTF8')),'hex');
    SELECT * INTO existing_deployment FROM public.serverless_endpoint_deployments WHERE id=new_deployment_id;
    SELECT * INTO existing_qualification FROM public.hosted_serverless_qualification_attestations WHERE id=new_qualification_id;
    IF existing_deployment.id IS NOT NULL OR existing_qualification.id IS NOT NULL THEN
      any_replay:=true;
      IF existing_deployment.id IS NULL OR existing_qualification.id IS NULL
         OR existing_qualification.deployment_id<>existing_deployment.id OR existing_deployment.lane<>lane_name
         OR existing_deployment.provider_endpoint_id IS DISTINCT FROM production->>'endpointId'
         OR existing_deployment.provider_template_id IS DISTINCT FROM production->>'templateId'
         OR existing_deployment.endpoint_profile_id IS DISTINCT FROM
            'template:'||(production->>'templateIdSha256')
         OR existing_deployment.endpoint_id_sha256<>production->>'endpointIdSha256'
         OR existing_deployment.endpoint_config_sha256<>production->>'deploymentSha256'
         OR existing_deployment.worker_image_digest<>substring(production->>'image' from 'sha256:[0-9a-f]{64}$')
         OR existing_deployment.model_manifest_sha256<>first_receipt#>>'{deployment,model_manifest_sha256}'
         OR existing_deployment.volume_id_sha256<>production->>'volumeIdSha256'
         OR existing_deployment.volume_manifest_sha256<>production->>'volumeManifestSha256'
         OR existing_deployment.record_sha256<>record_hash OR NOT existing_deployment.is_active
         OR existing_qualification.qualification_record_sha256<>handoff->>'handoffSha256'
         OR existing_qualification.deployment_snapshot_sha256<>
            public.videoforge_hosted_deployment_snapshot_sha256(existing_deployment.id) THEN
        RAISE EXCEPTION 'V213 qualified deployment publication drift' USING ERRCODE='23505';
      END IF;
      snapshot:=existing_qualification.deployment_snapshot_sha256;
    ELSE
      all_replay:=false;
      IF EXISTS(SELECT 1 FROM public.serverless_endpoint_deployments d WHERE d.lane=lane_name AND d.is_active) THEN
        RAISE EXCEPTION 'V213 active production deployment drift' USING ERRCODE='23505';
      END IF;
      INSERT INTO public.serverless_endpoint_deployments(id,lane,endpoint_profile_id,
        provider_endpoint_id,provider_template_id,endpoint_id_sha256,
        endpoint_config_sha256,worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
        volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,
        worker_count_min,worker_count_max,worker_ceiling_scope,retained_active_workers,scaler_type,
        scaler_value,handler_concurrency,idle_timeout_seconds,init_timeout_seconds,execution_timeout_seconds,
        request_ttl_seconds,request_ttl_scope,reconciliation_deadline_seconds,provider_result_window_seconds,
        polling_interval_seconds,max_replacement_attempts,blind_resubmit_permitted,timeout_evidence,
        deployment_version,is_active,record_sha256,created_at)
      VALUES(new_deployment_id,lane_name,'template:'||(production->>'templateIdSha256'),
        production->>'endpointId',production->>'templateId',production->>'endpointIdSha256',
        production->>'deploymentSha256',substring(production->>'image' from 'sha256:[0-9a-f]{64}$'),
        first_receipt#>>'{deployment,model_manifest_sha256}','EU-RO-1',production->>'volumeIdSha256',
        production->>'volumeManifestSha256','/runpod-volume',50,ARRAY['NVIDIA GeForce RTX 4090']::text[],
        1,0,1,'ACTIVE_PLUS_FLEX',0,'REQUEST_COUNT',1,1,5,800,2400,3600,
        'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1200,1800,5,0,false,timeout_evidence,1,true,record_hash,db_now);
      snapshot:=public.videoforge_hosted_deployment_snapshot_sha256(new_deployment_id);
      INSERT INTO public.hosted_serverless_qualification_attestations(id,lane,deployment_id,
        deployment_snapshot_sha256,qualification_record_sha256,independent_audit_accepted,
        verified_at,expires_at,created_by_operator,created_at)
      VALUES(new_qualification_id,lane_name,new_deployment_id,snapshot,handoff->>'handoffSha256',true,
        db_now,expiry,session_user,db_now);
    END IF;
    lane_results:=lane_results||jsonb_build_object(lane_name,jsonb_build_object('deploymentId',new_deployment_id,
      'qualificationId',new_qualification_id,'deploymentSnapshotSha256',snapshot,
      'qualificationRecordSha256',handoff->>'handoffSha256'));
  END LOOP;
  IF any_replay AND NOT all_replay THEN
    RAISE EXCEPTION 'V213 partial qualified deployment replay' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('schemaVersion','videoforge.v213-qualified-deployment-publication-result/v1',
    'fullLiveAuthorityId',authority.id,'replayed',all_replay,'lanes',lane_results);
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_operation(supplied_operation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE latest public.hosted_full_live_operation_events%ROWTYPE; action text; cleanup_scope boolean;
BEGIN
  IF supplied_operation->>'operationId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'
     OR supplied_operation->>'stageAuthorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'
     OR supplied_operation->>'kind' NOT IN ('create','readback','dispatch','status','cancel','delete')
     OR supplied_operation->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR length(supplied_operation->>'resourceKey') NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'V213 operation invalid' USING ERRCODE='23514';
  END IF;
  cleanup_scope:=(supplied_operation->>'resourceKey')=('v213:'||CASE supplied_operation->>'kind'
      WHEN 'cancel' THEN 'restore-endpoints-max-one'
      WHEN 'readback' THEN 'read-settled-billing'
      WHEN 'status' THEN CASE
        WHEN (supplied_operation->>'resourceKey')=('v213:prove-zero-workers:'||(supplied_operation->>'operationId'))
          THEN 'prove-zero-workers'
        ELSE 'reconcile-exact-resources'
      END
      ELSE '__not_cleanup__'
    END||':'||(supplied_operation->>'operationId'));
  IF NOT EXISTS(
    SELECT 1 FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    JOIN public.hosted_full_live_authorities a ON a.id=s.full_live_authority_id
    WHERE s.authority_id=supplied_operation->>'stageAuthorityId'
      AND (cleanup_scope OR
        (s.expires_at>transaction_timestamp() AND a.expires_at>transaction_timestamp()))
  ) THEN
    RAISE EXCEPTION 'V213 operation stage authority not consumed or current' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_operation->>'operationId',45));
  SELECT * INTO latest FROM public.hosted_full_live_operation_events
    WHERE operation_id=supplied_operation->>'operationId' ORDER BY sequence DESC LIMIT 1;
  IF latest.operation_id IS NULL THEN
    INSERT INTO public.hosted_full_live_operation_events(operation_id,sequence,stage_authority_id,kind,
      request_sha256,resource_key,state,evidence)
    VALUES(supplied_operation->>'operationId',1,supplied_operation->>'stageAuthorityId',
      supplied_operation->>'kind',supplied_operation->>'requestSha256',supplied_operation->>'resourceKey',
      'IN_FLIGHT',supplied_operation->'evidence') RETURNING * INTO latest;
    action:='EXECUTE';
  ELSE
    IF latest.stage_authority_id<>supplied_operation->>'stageAuthorityId' OR latest.kind<>supplied_operation->>'kind'
       OR latest.request_sha256<>supplied_operation->>'requestSha256' OR latest.resource_key<>supplied_operation->>'resourceKey' THEN
      RAISE EXCEPTION 'V213 operation replay drift' USING ERRCODE='23505';
    END IF;
    action:=CASE WHEN latest.state='TERMINAL' THEN 'DONE' ELSE 'RECONCILE' END;
  END IF;
  RETURN jsonb_build_object('action',action,'record',jsonb_build_object('operationId',latest.operation_id,
    'stageAuthorityId',latest.stage_authority_id,'kind',latest.kind,'requestSha256',latest.request_sha256,
    'resourceKey',latest.resource_key,'state',latest.state,'providerId',latest.provider_id,'evidence',latest.evidence));
END;
$$;

CREATE FUNCTION public.videoforge_transition_v213_operation(supplied_transition jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE latest public.hosted_full_live_operation_events%ROWTYPE; next_row public.hosted_full_live_operation_events%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_transition->>'operationId',45));
  SELECT * INTO latest FROM public.hosted_full_live_operation_events WHERE operation_id=supplied_transition->>'operationId'
    ORDER BY sequence DESC LIMIT 1;
  IF latest.operation_id IS NULL OR latest.state<>supplied_transition->>'from'
     OR supplied_transition->>'to' NOT IN ('ACK_UNKNOWN','ACKED','TERMINAL')
     OR (latest.state='IN_FLIGHT' AND supplied_transition->>'to' NOT IN ('ACK_UNKNOWN','ACKED','TERMINAL'))
     OR (latest.state='ACK_UNKNOWN' AND supplied_transition->>'to' NOT IN ('ACKED','TERMINAL'))
     OR (latest.state='ACKED' AND supplied_transition->>'to'<>'TERMINAL') THEN
    RAISE EXCEPTION 'V213 operation transition invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_full_live_operation_events(operation_id,sequence,stage_authority_id,kind,
    request_sha256,resource_key,state,provider_id,evidence)
  VALUES(latest.operation_id,latest.sequence+1,latest.stage_authority_id,latest.kind,latest.request_sha256,
    latest.resource_key,supplied_transition->>'to',supplied_transition->>'providerId',supplied_transition->'evidence')
  RETURNING * INTO next_row;
  RETURN jsonb_build_object('operationId',next_row.operation_id,'stageAuthorityId',next_row.stage_authority_id,
    'kind',next_row.kind,'requestSha256',next_row.request_sha256,'resourceKey',next_row.resource_key,
    'state',next_row.state,'providerId',next_row.provider_id,'evidence',next_row.evidence);
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_bridge_command(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE latest public.hosted_full_live_bridge_command_events%ROWTYPE; claimed_authority_id uuid; cleanup_scope boolean;
BEGIN
  BEGIN claimed_authority_id:=(supplied->>'stageAuthorityId')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'V213 bridge command authority invalid' USING ERRCODE='23514'; END;
  cleanup_scope:=(supplied->>'resourceKey')=('v213:'||CASE supplied->>'kind'
      WHEN 'cancel' THEN 'restore-endpoints-max-one'
      WHEN 'readback' THEN 'read-settled-billing'
      WHEN 'status' THEN CASE
        WHEN (supplied->>'resourceKey')=('v213:prove-zero-workers:'||(supplied->>'operationId'))
          THEN 'prove-zero-workers'
        ELSE 'reconcile-exact-resources'
      END
      ELSE '__not_cleanup__'
    END||':'||(supplied->>'operationId'));
  IF supplied->>'operationId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'
     OR supplied->>'kind' NOT IN ('create','readback','dispatch','status','cancel','delete')
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR length(supplied->>'resourceKey') NOT BETWEEN 1 AND 240
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities a
       WHERE a.id=claimed_authority_id AND (cleanup_scope OR a.expires_at>transaction_timestamp())) THEN
    RAISE EXCEPTION 'V213 bridge command invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'operationId',49));
  SELECT * INTO latest FROM public.hosted_full_live_bridge_command_events
    WHERE operation_id=supplied->>'operationId' ORDER BY sequence DESC LIMIT 1;
  IF latest.operation_id IS NULL THEN
    INSERT INTO public.hosted_full_live_bridge_command_events(operation_id,sequence,full_live_authority_id,
      kind,request_sha256,resource_key,state)
    VALUES(supplied->>'operationId',1,claimed_authority_id,supplied->>'kind',supplied->>'requestSha256',
      supplied->>'resourceKey','IN_FLIGHT') RETURNING * INTO latest;
    RETURN jsonb_build_object('action','EXECUTE');
  END IF;
  IF latest.full_live_authority_id<>claimed_authority_id OR latest.kind<>supplied->>'kind'
     OR latest.request_sha256<>supplied->>'requestSha256' OR latest.resource_key<>supplied->>'resourceKey' THEN
    RAISE EXCEPTION 'V213 bridge command replay drift' USING ERRCODE='23505';
  END IF;
  IF latest.state='TERMINAL' THEN
    RETURN jsonb_build_object('action','DONE','result',latest.result_document);
  END IF;
  RETURN jsonb_build_object('action','RECONCILE');
END;
$$;

CREATE FUNCTION public.videoforge_transition_v213_bridge_command(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE latest public.hosted_full_live_bridge_command_events%ROWTYPE; target text:=supplied->>'to';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'operationId',49));
  SELECT * INTO latest FROM public.hosted_full_live_bridge_command_events
    WHERE operation_id=supplied->>'operationId' ORDER BY sequence DESC LIMIT 1;
  IF latest.operation_id IS NULL OR target NOT IN ('ACK_UNKNOWN','TERMINAL')
     OR (target='TERMINAL' AND jsonb_typeof(supplied->'result')<>'object') THEN
    RAISE EXCEPTION 'V213 bridge command transition invalid' USING ERRCODE='23514';
  END IF;
  IF latest.state='TERMINAL' THEN
    IF target='TERMINAL' AND latest.result_document=supplied->'result' THEN RETURN latest.result_document; END IF;
    RAISE EXCEPTION 'V213 bridge command completion drift' USING ERRCODE='23505';
  END IF;
  IF latest.state='ACK_UNKNOWN' AND target='ACK_UNKNOWN' THEN RETURN NULL; END IF;
  INSERT INTO public.hosted_full_live_bridge_command_events(operation_id,sequence,full_live_authority_id,
    kind,request_sha256,resource_key,state,result_document)
  VALUES(latest.operation_id,latest.sequence+1,latest.full_live_authority_id,latest.kind,
    latest.request_sha256,latest.resource_key,target,supplied->'result');
  RETURN supplied->'result';
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_workflow_start_authority(
  supplied_id uuid, supplied_full_live_authority_id uuid, supplied_token_sha256 text,
  supplied_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); live_authority public.hosted_full_live_authorities%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_full_live_authority_id::text,45));
  SELECT a.* INTO live_authority FROM public.hosted_full_live_authorities a
    JOIN public.hosted_full_live_promotions p ON p.authority_id=a.id
    WHERE a.id=supplied_full_live_authority_id FOR UPDATE OF a;
  IF live_authority.id IS NULL OR live_authority.expires_at<=db_now
     OR supplied_token_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_expires_at<=db_now OR supplied_expires_at>least(live_authority.expires_at,db_now+interval '15 minutes') THEN
    RAISE EXCEPTION 'V213 workflow start authority invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_full_live_workflow_start_authorities(
    id,full_live_authority_id,token_sha256,issued_at,expires_at)
  VALUES(supplied_id,supplied_full_live_authority_id,supplied_token_sha256,db_now,supplied_expires_at);
  RETURN jsonb_build_object('authorityId',supplied_id,'tokenSha256',supplied_token_sha256,
    'expiresAt',to_char(supplied_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_workflow_start(supplied_claim jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); start_authority public.hosted_full_live_workflow_start_authorities%ROWTYPE;
  existing_claim public.hosted_full_live_workflow_start_claims%ROWTYPE;
  existing_result public.hosted_full_live_workflow_start_results%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied_claim)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_claim) key)
       IS DISTINCT FROM ARRAY['generationRequestId','outerStateSha256','paramsSha256','requestSha256','tokenSha256','workflowId']::text[]
     OR supplied_claim->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_claim->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_claim->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_claim->>'paramsSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_claim->>'workflowId'<>('hosted-pair-'||(supplied_claim->>'generationRequestId')) THEN
    RAISE EXCEPTION 'V213 workflow start claim invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_claim->>'workflowId',45));
  SELECT w.* INTO start_authority FROM public.hosted_full_live_workflow_start_authorities w
    JOIN public.hosted_full_live_authorities a ON a.id=w.full_live_authority_id
    JOIN public.hosted_full_live_promotions p ON p.authority_id=a.id
    WHERE w.token_sha256=supplied_claim->>'tokenSha256' AND w.expires_at>db_now AND a.expires_at>db_now;
  IF start_authority.id IS NULL THEN
    RAISE EXCEPTION 'V213 workflow start authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing_claim FROM public.hosted_full_live_workflow_start_claims
    WHERE workflow_id=supplied_claim->>'workflowId';
  IF existing_claim.id IS NOT NULL THEN
    IF existing_claim.workflow_start_authority_id<>start_authority.id
       OR existing_claim.generation_request_id<>(supplied_claim->>'generationRequestId')::uuid
       OR existing_claim.request_sha256<>supplied_claim->>'requestSha256'
       OR existing_claim.outer_state_sha256<>supplied_claim->>'outerStateSha256'
       OR existing_claim.params_sha256<>supplied_claim->>'paramsSha256' THEN
      RAISE EXCEPTION 'V213 workflow start replay drift' USING ERRCODE='23505';
    END IF;
    SELECT * INTO existing_result FROM public.hosted_full_live_workflow_start_results WHERE claim_id=existing_claim.id;
    RETURN jsonb_build_object('action',CASE WHEN existing_result.claim_id IS NULL THEN 'RECONCILE' ELSE 'EXISTING' END,
      'claimId',existing_claim.id,'result',existing_result.result_document);
  END IF;
  existing_claim.id:=gen_random_uuid();
  INSERT INTO public.hosted_full_live_workflow_start_claims(id,workflow_start_authority_id,workflow_id,
    generation_request_id,request_sha256,outer_state_sha256,params_sha256)
  VALUES(existing_claim.id,start_authority.id,supplied_claim->>'workflowId',(supplied_claim->>'generationRequestId')::uuid,
    supplied_claim->>'requestSha256',supplied_claim->>'outerStateSha256',supplied_claim->>'paramsSha256');
  RETURN jsonb_build_object('action','CREATE','claimId',existing_claim.id,'result',NULL);
END;
$$;

CREATE FUNCTION public.videoforge_complete_v213_workflow_start(supplied_completion jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim public.hosted_full_live_workflow_start_claims%ROWTYPE; existing public.hosted_full_live_workflow_start_results%ROWTYPE;
  computed_hash text;
BEGIN
  IF jsonb_typeof(supplied_completion)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_completion) key)
       IS DISTINCT FROM ARRAY['outerStateSha256','requestSha256','result','tokenSha256','workflowId']::text[]
     OR supplied_completion->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_completion->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_completion->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_completion->'result'->>'schemaVersion'<>'videoforge.v213-pair-workflow-start-result/v1'
     OR supplied_completion->'result'->>'workflowId'<>supplied_completion->>'workflowId'
     OR supplied_completion->'result'->>'requestSha256'<>supplied_completion->>'requestSha256'
     OR supplied_completion->'result'->>'outerStateSha256'<>supplied_completion->>'outerStateSha256'
     OR supplied_completion->'result'->>'state' NOT IN ('STARTED','EXISTING') THEN
    RAISE EXCEPTION 'V213 workflow start completion invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_completion->>'workflowId',45));
  SELECT c.* INTO claim FROM public.hosted_full_live_workflow_start_claims c
    JOIN public.hosted_full_live_workflow_start_authorities w ON w.id=c.workflow_start_authority_id
    WHERE c.workflow_id=supplied_completion->>'workflowId' AND c.request_sha256=supplied_completion->>'requestSha256'
      AND c.outer_state_sha256=supplied_completion->>'outerStateSha256' AND w.token_sha256=supplied_completion->>'tokenSha256';
  IF claim.id IS NULL THEN RAISE EXCEPTION 'V213 workflow start claim unavailable' USING ERRCODE='42501'; END IF;
  computed_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied_completion->'result'),'UTF8')),'hex');
  SELECT * INTO existing FROM public.hosted_full_live_workflow_start_results WHERE claim_id=claim.id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.result_sha256<>computed_hash THEN RAISE EXCEPTION 'V213 workflow start result drift' USING ERRCODE='23505'; END IF;
    RETURN existing.result_document;
  END IF;
  INSERT INTO public.hosted_full_live_workflow_start_results(claim_id,result_document,result_sha256)
    VALUES(claim.id,supplied_completion->'result',computed_hash);
  RETURN supplied_completion->'result';
END;
$$;

CREATE FUNCTION public.videoforge_load_v213_workflow_start(supplied_lookup jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim public.hosted_full_live_workflow_start_claims%ROWTYPE; existing public.hosted_full_live_workflow_start_results%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied_lookup)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_lookup) key)
       IS DISTINCT FROM ARRAY['outerStateSha256','requestSha256','tokenSha256','workflowId']::text[] THEN
    RAISE EXCEPTION 'V213 workflow start lookup invalid' USING ERRCODE='23514';
  END IF;
  SELECT c.* INTO claim FROM public.hosted_full_live_workflow_start_claims c
    JOIN public.hosted_full_live_workflow_start_authorities w ON w.id=c.workflow_start_authority_id
    WHERE c.workflow_id=supplied_lookup->>'workflowId' AND c.request_sha256=supplied_lookup->>'requestSha256'
      AND c.outer_state_sha256=supplied_lookup->>'outerStateSha256' AND w.token_sha256=supplied_lookup->>'tokenSha256';
  IF claim.id IS NULL THEN RAISE EXCEPTION 'V213 workflow start claim unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO existing FROM public.hosted_full_live_workflow_start_results WHERE claim_id=claim.id;
  RETURN jsonb_build_object('action',CASE WHEN existing.claim_id IS NULL THEN 'RECONCILE' ELSE 'EXISTING' END,
    'claimId',claim.id,'result',existing.result_document);
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_acceptance_authority(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); start_authority public.hosted_full_live_workflow_start_authorities%ROWTYPE;
  doc jsonb:=supplied->'document'; execution jsonb:=supplied->'execution'; checkpoint text:=doc->>'checkpoint';
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['document','execution','expiresAt','tokenSha256']::text[]
     OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR checkpoint NOT IN ('V2-10','V2-11','V2-12','V2-13')
     OR doc->>'schemaVersion'<>'videoforge.v213-hosted-acceptance-command/v1'
     OR doc->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR doc->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR execution->'request'->>'checkpoint'<>checkpoint
     OR execution->'request'->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR (supplied->>'expiresAt')::timestamptz<=db_now THEN
    RAISE EXCEPTION 'V213 acceptance authority invalid' USING ERRCODE='23514';
  END IF;
  SELECT w.* INTO start_authority FROM public.hosted_full_live_workflow_start_authorities w
    JOIN public.hosted_full_live_authorities a ON a.id=w.full_live_authority_id
    JOIN public.hosted_full_live_promotions p ON p.authority_id=a.id
    WHERE w.token_sha256=supplied->>'tokenSha256' AND w.expires_at>db_now AND a.expires_at>db_now;
  IF start_authority.id IS NULL OR (supplied->>'expiresAt')::timestamptz>least(start_authority.expires_at,db_now+interval '15 minutes') THEN
    RAISE EXCEPTION 'V213 acceptance authority unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_authorities(id,workflow_start_authority_id,checkpoint,
    command_id,request_sha256,outer_state_sha256,request_document,execution_document,expires_at)
  VALUES(gen_random_uuid(),start_authority.id,checkpoint,doc->>'commandId',doc->>'requestSha256',
    doc->>'outerStateSha256',doc,execution,(supplied->>'expiresAt')::timestamptz);
  RETURN jsonb_build_object('requestSha256',doc->>'requestSha256','checkpoint',checkpoint,
    'expiresAt',supplied->>'expiresAt');
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_operator_acceptance(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); authority public.hosted_full_live_acceptance_authorities%ROWTYPE;
  claim public.hosted_full_live_acceptance_claims%ROWTYPE; result public.hosted_full_live_acceptance_operator_results%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object' OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->'document'->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->'document'->>'requestSha256',45));
  SELECT a.* INTO authority FROM public.hosted_full_live_acceptance_authorities a
    JOIN public.hosted_full_live_workflow_start_authorities w ON w.id=a.workflow_start_authority_id
    WHERE a.request_sha256=supplied->'document'->>'requestSha256'
      AND a.request_document=supplied->'document' AND w.token_sha256=supplied->>'tokenSha256'
      AND a.expires_at>db_now AND w.expires_at>db_now;
  IF authority.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO claim FROM public.hosted_full_live_acceptance_claims WHERE acceptance_authority_id=authority.id;
  IF claim.id IS NULL THEN
    claim.id:=gen_random_uuid();
    INSERT INTO public.hosted_full_live_acceptance_claims(id,acceptance_authority_id,claimed_at)
    VALUES(claim.id,authority.id,db_now);
    RETURN jsonb_build_object('action','EXECUTE','execution',authority.execution_document);
  END IF;
  SELECT * INTO result FROM public.hosted_full_live_acceptance_operator_results WHERE claim_id=claim.id;
  IF result.claim_id IS NULL THEN
    RETURN jsonb_build_object('action','RECONCILE','execution',authority.execution_document);
  END IF;
  RETURN jsonb_build_object('action','EXISTING','result',result.result_document);
END;
$$;

CREATE FUNCTION public.videoforge_complete_v213_operator_acceptance(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE authority public.hosted_full_live_acceptance_authorities%ROWTYPE; claim public.hosted_full_live_acceptance_claims%ROWTYPE;
  existing public.hosted_full_live_acceptance_operator_results%ROWTYPE; result jsonb:=supplied->'result'; result_hash text;
BEGIN
  SELECT a.* INTO authority FROM public.hosted_full_live_acceptance_authorities a
    JOIN public.hosted_full_live_workflow_start_authorities w ON w.id=a.workflow_start_authority_id
    WHERE a.request_document=supplied->'document' AND w.token_sha256=supplied->>'tokenSha256';
  SELECT * INTO claim FROM public.hosted_full_live_acceptance_claims WHERE acceptance_authority_id=authority.id;
  IF claim.id IS NULL OR result->>'evidenceSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 acceptance completion invalid' USING ERRCODE='23514';
  END IF;
  result_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(result),'UTF8')),'hex');
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_operator_results WHERE claim_id=claim.id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.result_sha256<>result_hash OR existing.result_document<>result THEN
      RAISE EXCEPTION 'V213 acceptance completion drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.result_document;
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_operator_results(claim_id,result_sha256,result_document)
  VALUES(claim.id,result_hash,result);
  RETURN result;
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_live_acceptance(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); acceptance public.hosted_full_live_acceptance_authorities%ROWTYPE;
  claim public.hosted_full_live_acceptance_claims%ROWTYPE; start_authority public.hosted_full_live_workflow_start_authorities%ROWTYPE;
  live_authority public.hosted_full_live_authorities%ROWTYPE; promotion public.hosted_full_live_promotions%ROWTYPE;
  request jsonb:=supplied->'request'; request_hash text:=supplied->>'requestSha256';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(request_hash,46));
  SELECT a.* INTO acceptance FROM public.hosted_full_live_acceptance_authorities a
    WHERE a.request_sha256=request_hash AND a.execution_document->'request'=request AND a.expires_at>db_now;
  SELECT * INTO claim FROM public.hosted_full_live_acceptance_claims WHERE acceptance_authority_id=acceptance.id;
  SELECT * INTO start_authority FROM public.hosted_full_live_workflow_start_authorities WHERE id=acceptance.workflow_start_authority_id;
  SELECT * INTO live_authority FROM public.hosted_full_live_authorities WHERE id=start_authority.full_live_authority_id;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=live_authority.id;
  IF acceptance.id IS NULL OR claim.id IS NULL OR live_authority.expires_at<=db_now
     OR request->>'proposalSha256'<>live_authority.proposal_sha256
     OR request->>'authoritySha256'<>live_authority.authority_document_sha256
     OR request->>'approvalRecordSha256'<>live_authority.approval_sha256
     OR request->>'cumulativeLedgerSha256'<>promotion.migration_ledger_sha256
     OR request->>'executorSha256'<>live_authority.executor_sha256
     OR request->>'promotionDecisionSha256'<>promotion.decision_sha256
     OR request->>'sourceCommit'<>live_authority.source_commit THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('requestSha256',request_hash,'proposalSha256',live_authority.proposal_sha256,
    'authoritySha256',live_authority.authority_document_sha256,'approvalRecordSha256',live_authority.approval_sha256,
    'approvalConsumed',true,'cumulativeLedgerSha256',promotion.migration_ledger_sha256,
    'executorSha256',live_authority.executor_sha256,'promotionDecisionSha256',promotion.decision_sha256,
    'promotionVersion','V3','promotionState','CONSUMED_CURRENT','sourceCommit',live_authority.source_commit,
    'cumulativeLedgerSpentBeforeMicroUsd',request->'cumulativeLedgerSpentBeforeMicroUsd',
    'billingBaselineMicroUsd',request->'billingBaselineMicroUsd',
    'claimedAt',to_char(claim.claimed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(acceptance.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

CREATE FUNCTION public.videoforge_complete_v213_live_acceptance(supplied jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim_id uuid; acceptance public.hosted_full_live_acceptance_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_results%ROWTYPE;
  evidence public.hosted_full_live_signed_evidence%ROWTYPE;
  result_hash text; receipt_hash text:=supplied->>'receiptEvidenceSha256'; result jsonb:=supplied->'result';
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['completionSha256','receiptEvidenceSha256','requestSha256','result']::text[]
     OR supplied->>'completionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR receipt_hash !~ '^sha256:[0-9a-f]{64}$' OR jsonb_typeof(result)<>'object' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',47));
  SELECT c.id INTO claim_id FROM public.hosted_full_live_acceptance_claims c
    JOIN public.hosted_full_live_acceptance_authorities a ON a.id=c.acceptance_authority_id
    WHERE a.request_sha256=supplied->>'requestSha256';
  SELECT * INTO acceptance FROM public.hosted_full_live_acceptance_authorities
    WHERE request_sha256=supplied->>'requestSha256';
  SELECT * INTO evidence FROM public.hosted_full_live_signed_evidence
    WHERE artifact_sha256=receipt_hash AND kind='RECEIPT';
  result_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(result),'UTF8')),'hex');
  IF claim_id IS NULL OR evidence.artifact_sha256 IS NULL OR result_hash<>supplied->>'completionSha256'
     OR evidence.document->>'canonicalArtifactSha256'<>receipt_hash
     OR evidence.document->>'checkpoint'<>acceptance.checkpoint
     OR evidence.document->>'executionId'<>acceptance.execution_document->'request'->>'executionId'
     OR evidence.document->>'proposalSha256'<>acceptance.execution_document->'request'->>'proposalSha256'
     OR evidence.document->>'authoritySha256'<>acceptance.execution_document->'request'->>'authoritySha256'
     OR evidence.document->>'sourceCommit'<>acceptance.execution_document->'request'->>'sourceCommit'
     OR result->'receipt'<>evidence.document THEN RETURN false; END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_results WHERE hosted_full_live_acceptance_results.claim_id=claim_id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.state<>'COMPLETED' OR existing.evidence_sha256<>receipt_hash
       OR existing.result_sha256<>result_hash OR existing.result_document<>result THEN
      RAISE EXCEPTION 'V213 live acceptance completion drift' USING ERRCODE='23505';
    END IF;
    RETURN true;
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_results(claim_id,state,evidence_sha256,result_sha256,result_document)
  VALUES(claim_id,'COMPLETED',receipt_hash,result_hash,result);
  RETURN true;
END;
$$;

CREATE FUNCTION public.videoforge_fail_v213_live_acceptance(supplied jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim_id uuid; acceptance public.hosted_full_live_acceptance_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_results%ROWTYPE;
  evidence public.hosted_full_live_signed_evidence%ROWTYPE; cleanup_hash text:=supplied->>'cleanupSha256';
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['cleanupSha256','requestSha256']::text[]
     OR cleanup_hash !~ '^sha256:[0-9a-f]{64}$' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',48));
  SELECT c.id INTO claim_id FROM public.hosted_full_live_acceptance_claims c
    JOIN public.hosted_full_live_acceptance_authorities a ON a.id=c.acceptance_authority_id
    WHERE a.request_sha256=supplied->>'requestSha256';
  SELECT * INTO acceptance FROM public.hosted_full_live_acceptance_authorities
    WHERE request_sha256=supplied->>'requestSha256';
  SELECT * INTO evidence FROM public.hosted_full_live_signed_evidence
    WHERE artifact_sha256=cleanup_hash AND kind='CLEANUP';
  IF claim_id IS NULL OR evidence.artifact_sha256 IS NULL
     OR evidence.document->>'canonicalArtifactSha256'<>cleanup_hash
     OR evidence.document->>'checkpoint'<>acceptance.checkpoint
     OR evidence.document->>'executionId'<>acceptance.execution_document->'request'->>'executionId'
     OR evidence.document->>'authoritySha256'<>acceptance.execution_document->'request'->>'authoritySha256'
     OR evidence.document->>'sourceCommit'<>acceptance.execution_document->'request'->>'sourceCommit' THEN RETURN false; END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_results WHERE hosted_full_live_acceptance_results.claim_id=claim_id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.state<>'FAILED_CLEAN' OR existing.evidence_sha256<>cleanup_hash
       OR existing.result_sha256<>cleanup_hash OR existing.result_document<>evidence.document THEN
      RAISE EXCEPTION 'V213 live acceptance failure drift' USING ERRCODE='23505';
    END IF;
    RETURN true;
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_results(claim_id,state,evidence_sha256,result_sha256,result_document)
  VALUES(claim_id,'FAILED_CLEAN',cleanup_hash,cleanup_hash,evidence.document);
  RETURN true;
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_signed_evidence(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE secret text; document_hash text; expected_signature text;
BEGIN
  IF supplied->>'kind' NOT IN ('RECEIPT','CLEANUP','CHROME','RELEASE','V210_OUTPUT','V211_EVIDENCE','V212_OUTPUT')
     OR supplied->>'artifactSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'keyId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
     OR supplied->>'signatureHex' !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 signed evidence invalid' USING ERRCODE='23514';
  END IF;
  SELECT secret_hex INTO secret FROM public.hosted_provider_proof_keys
    WHERE key_id=supplied->>'keyId' AND active;
  document_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied->'document'),'UTF8')),'hex');
  expected_signature:=encode(hmac(convert_to((supplied->>'kind')||E'\n'||
    (supplied->>'artifactSha256')||E'\n'||document_hash,'UTF8'),
    decode(secret,'hex'),'sha256'),'hex');
  IF secret IS NULL OR expected_signature<>supplied->>'signatureHex' THEN
    RAISE EXCEPTION 'V213 signed evidence signature invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_full_live_signed_evidence(artifact_sha256,kind,document,key_id,signature_hex)
  VALUES(supplied->>'artifactSha256',supplied->>'kind',supplied->'document',supplied->>'keyId',supplied->>'signatureHex')
  ON CONFLICT(artifact_sha256) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_signed_evidence
    WHERE artifact_sha256=supplied->>'artifactSha256' AND kind=supplied->>'kind' AND document=supplied->'document'
      AND key_id=supplied->>'keyId' AND signature_hex=supplied->>'signatureHex') THEN
    RAISE EXCEPTION 'V213 signed evidence drift' USING ERRCODE='23505';
  END IF;
  RETURN supplied->>'artifactSha256';
END;
$$;

CREATE FUNCTION public.videoforge_load_v213_signed_evidence(supplied jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('kind',kind,'artifactSha256',artifact_sha256,'document',document,
    'keyId',key_id,'signatureHex',signature_hex)
  FROM public.hosted_full_live_signed_evidence
  WHERE artifact_sha256=supplied->>'artifactSha256' AND kind=supplied->>'kind'
$$;

CREATE FUNCTION public.videoforge_v213_acceptance_repository(supplied jsonb, supplied_repository text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE operation text:=supplied->>'operation'; key_doc jsonb; key_hash text; latest public.hosted_full_live_acceptance_repository_records%ROWTYPE;
  record jsonb; token text; token_hash text; request_hash text; next_sequence smallint;
BEGIN
  key_doc:=CASE WHEN operation='CREATE' THEN COALESCE(supplied->'key',supplied#>'{document,key}') ELSE supplied->'key' END;
  key_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(key_doc),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_repository||key_hash,45));
  SELECT * INTO latest FROM public.hosted_full_live_acceptance_repository_records
    WHERE repository=supplied_repository AND key_sha256=key_hash ORDER BY sequence DESC LIMIT 1;
  IF operation='CREATE' THEN
    IF latest.repository IS NOT NULL THEN RETURN jsonb_build_object('record',latest.record_document,'replayed',true); END IF;
    request_hash:=COALESCE(supplied#>>'{admissionDocument,requestSha256}',supplied#>>'{document,requestSha256}');
    token:=lower(supplied_repository)||':'||substr(request_hash,8,48);
    token_hash:='sha256:'||encode(sha256(convert_to(token,'UTF8')),'hex');
    IF supplied_repository='SHORT_PILOT' THEN
      record:=key_doc||jsonb_build_object('requestSha256',request_hash,'admissionDocument',supplied->'admissionDocument',
        'admissionDocumentSha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied->'admissionDocument'),'UTF8')),'hex'),
        'submissionToken',token,'submissionTokenSha256',token_hash,'automaticAttemptId','v210-'||substr(request_hash,8,32),
        'state','READY','submissionCount',0,'acceptanceSha256',NULL);
    ELSE
      record:=jsonb_build_object('document',supplied->'document','documentSha256',
        'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(supplied->'document'),'UTF8')),'hex'),
        'submissionToken',token,'submissionTokenSha256',token_hash,'attemptId','v212-'||substr(request_hash,8,32),
        'state','READY','submissionCount',0,'acceptanceSha256',NULL);
    END IF;
    INSERT INTO public.hosted_full_live_acceptance_repository_records(repository,key_sha256,sequence,request_sha256,record_document,state)
    VALUES(supplied_repository,key_hash,1,request_hash,record,'READY');
    RETURN jsonb_build_object('record',record,'replayed',false);
  END IF;
  IF latest.repository IS NULL THEN RETURN NULL; END IF;
  IF operation='READ' THEN RETURN latest.record_document; END IF;
  IF latest.request_sha256<>supplied->>'requestSha256' THEN RETURN NULL; END IF;
  next_sequence:=latest.sequence+1;
  IF operation='CLAIM' AND latest.state='READY' THEN
    record:=jsonb_set(jsonb_set(latest.record_document,'{state}','"SUBMITTED"'),'{submissionCount}','1');
    INSERT INTO public.hosted_full_live_acceptance_repository_records(repository,key_sha256,sequence,request_sha256,record_document,state)
    VALUES(supplied_repository,key_hash,next_sequence,latest.request_sha256,record,'SUBMITTED'); RETURN record;
  END IF;
  IF operation='ACCEPT' AND latest.state='SUBMITTED' AND supplied->>'acceptanceSha256' ~ '^sha256:[0-9a-f]{64}$' THEN
    record:=jsonb_set(jsonb_set(latest.record_document,'{state}','"ACCEPTED"'),'{acceptanceSha256}',to_jsonb(supplied->>'acceptanceSha256'));
    INSERT INTO public.hosted_full_live_acceptance_repository_records(repository,key_sha256,sequence,request_sha256,record_document,state)
    VALUES(supplied_repository,key_hash,next_sequence,latest.request_sha256,record,'ACCEPTED'); RETURN record;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.videoforge_v213_short_pilot_repository(supplied jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT public.videoforge_v213_acceptance_repository(supplied,'SHORT_PILOT')
$$;
CREATE FUNCTION public.videoforge_v213_production_length_repository(supplied jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT public.videoforge_v213_acceptance_repository(supplied,'PRODUCTION_LENGTH')
$$;

CREATE FUNCTION public.videoforge_load_v213_bridge_acceptance_call(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); execution jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['command','commandId','outerStateSha256','requestSha256','stageAuthorityId']::text[]
     OR supplied->>'stageAuthorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'
     OR supplied->>'commandId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'command' NOT IN ('v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
       'v2-12-long-output','v2-13-final-two-lane-smoke') THEN
    RETURN NULL;
  END IF;
  SELECT aa.execution_document INTO execution
  FROM public.hosted_full_live_acceptance_authorities aa
  JOIN public.hosted_full_live_workflow_start_authorities wa ON wa.id=aa.workflow_start_authority_id
  JOIN public.hosted_full_live_stage_authorities sa ON sa.full_live_authority_id=wa.full_live_authority_id
  JOIN public.hosted_full_live_stage_consumptions sc ON sc.authority_id=sa.authority_id
  JOIN public.hosted_full_live_authorities fa ON fa.id=wa.full_live_authority_id
  JOIN public.hosted_full_live_promotions p ON p.authority_id=fa.id
  WHERE sa.authority_id=supplied->>'stageAuthorityId' AND sa.stage='production'
    AND sa.expires_at>db_now AND wa.expires_at>db_now AND aa.expires_at>db_now AND fa.expires_at>db_now
    AND aa.command_id=supplied->>'commandId' AND aa.request_sha256=supplied->>'requestSha256'
    AND aa.outer_state_sha256=supplied->>'outerStateSha256'
    AND aa.request_document->>'command'=supplied->>'command'
    AND aa.execution_document->'request'->>'proposalSha256'=fa.proposal_sha256
    AND aa.execution_document->'request'->>'promotionDecisionSha256'=p.decision_sha256
    AND aa.execution_document->'request'->>'sourceCommit'=fa.source_commit;
  RETURN execution;
END;
$$;

CREATE FUNCTION public.videoforge_load_hosted_gpu_activation_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); promotion public.hosted_full_live_promotions%ROWTYPE;
  authority public.hosted_full_live_authorities%ROWTYPE; mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE; mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE; ledger jsonb; gate jsonb; evidence jsonb;
  cloudflare public.hosted_full_live_cloudflare_activations%ROWTYPE;
  evidence_hash text; gate_hash text; verification jsonb; verification_expiry timestamptz;
BEGIN
  SELECT p.* INTO promotion FROM public.hosted_full_live_promotions p
    JOIN public.hosted_full_live_authorities a ON a.id=p.authority_id
    WHERE a.expires_at>db_now ORDER BY p.promoted_at DESC LIMIT 1;
  IF promotion.id IS NULL THEN
    RAISE EXCEPTION 'hosted GPU activation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=promotion.authority_id;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations WHERE id=promotion.mage_qualification_id;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations WHERE id=promotion.soulx_qualification_id;
  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments WHERE id=promotion.mage_deployment_id;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments WHERE id=promotion.soulx_deployment_id;
  SELECT * INTO cloudflare FROM public.hosted_full_live_cloudflare_activations WHERE promotion_id=promotion.id;
  IF mage_q.expires_at<=db_now OR soulx_q.expires_at<=db_now OR NOT mage_d.is_active OR NOT soulx_d.is_active
     OR cloudflare.id IS NULL OR cloudflare.source_commit<>authority.source_commit
     OR EXISTS(SELECT 1 FROM public.hosted_full_live_cloudflare_rollbacks rollback
       WHERE rollback.activation_id=cloudflare.id)
     OR cloudflare.deployed_config_sha256<>promotion.enabled_config_sha256
     OR cloudflare.observed_at>db_now OR cloudflare.observed_at<db_now-interval '5 minutes'
     OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id) THEN
    RAISE EXCEPTION 'hosted GPU activation drifted' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('version',version,'sha256',sha256) ORDER BY version)
    INTO ledger FROM public.videoforge_schema_migrations WHERE version BETWEEN 37 AND 45;
  gate:=jsonb_build_object('gpuTransport','QUALIFIED_EXACT','migrationLedger',ledger,
    'now',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cloudflare',jsonb_build_object('sourceCommit',cloudflare.source_commit,
      'versionIdSha256',cloudflare.version_id_sha256,'deployedConfigSha256',cloudflare.deployed_config_sha256,
      'readbackSha256',cloudflare.readback_sha256,
      'observedAt',to_char(cloudflare.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'qualifications',jsonb_build_object(
      'mage_image',jsonb_build_object('accepted',true,'verifiedAt',to_char(mage_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(mage_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',mage_q.qualification_record_sha256,'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256),
      'soulx_avatar',jsonb_build_object('accepted',true,'verifiedAt',to_char(soulx_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(soulx_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',soulx_q.qualification_record_sha256,'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256)),
    'deployments',jsonb_build_object(
      'mage_image',jsonb_build_object('deploymentId',mage_d.id,'endpointIdSha256',mage_d.endpoint_id_sha256,
        'endpointConfigSha256',mage_d.endpoint_config_sha256,'workerImageDigest',mage_d.worker_image_digest,
        'modelManifestSha256',mage_d.model_manifest_sha256,'volumeIdSha256',mage_d.volume_id_sha256,
        'volumeManifestSha256',mage_d.volume_manifest_sha256,'region',mage_d.region,'gpuAllowlist',mage_d.gpu_allowlist,
        'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256,'authority',jsonb_build_object(
          'endpointConfigSha256',mage_d.endpoint_config_sha256,'endpointIdSha256',mage_d.endpoint_id_sha256,
          'gpuAllowlist',mage_d.gpu_allowlist,'modelManifestSha256',mage_d.model_manifest_sha256,'region',mage_d.region,
          'volumeIdSha256',mage_d.volume_id_sha256,'volumeManifestSha256',mage_d.volume_manifest_sha256,
          'workerImageDigest',mage_d.worker_image_digest)),
      'soulx_avatar',jsonb_build_object('deploymentId',soulx_d.id,'endpointIdSha256',soulx_d.endpoint_id_sha256,
        'endpointConfigSha256',soulx_d.endpoint_config_sha256,'workerImageDigest',soulx_d.worker_image_digest,
        'modelManifestSha256',soulx_d.model_manifest_sha256,'volumeIdSha256',soulx_d.volume_id_sha256,
        'volumeManifestSha256',soulx_d.volume_manifest_sha256,'region',soulx_d.region,'gpuAllowlist',soulx_d.gpu_allowlist,
        'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256,'authority',jsonb_build_object(
          'endpointConfigSha256',soulx_d.endpoint_config_sha256,'endpointIdSha256',soulx_d.endpoint_id_sha256,
          'gpuAllowlist',soulx_d.gpu_allowlist,'modelManifestSha256',soulx_d.model_manifest_sha256,'region',soulx_d.region,
          'volumeIdSha256',soulx_d.volume_id_sha256,'volumeManifestSha256',soulx_d.volume_manifest_sha256,
          'workerImageDigest',soulx_d.worker_image_digest))),
    'paidApproval',jsonb_build_object('approved',true,'exact',true,
      'expiresAt',to_char(authority.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'bindings',jsonb_build_object('runtimeDatabase','VIDEOFORGE_RUNTIME_DATABASE',
      'reconcilerDatabase','VIDEOFORGE_RECONCILER_DATABASE','dispatchTokenKey','VIDEOFORGE_DISPATCH_TOKEN_KEY',
      'envelopeSignerKey','VIDEOFORGE_ENVELOPE_SIGNING_KEY','providerProofVerifierKey','VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY',
      'workflowOperatorToken','VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN'));
  evidence:=promotion.decision_document;
  evidence_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(evidence),'UTF8')),'hex');
  gate_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(gate),'UTF8')),'hex');
  verification_expiry:=least(authority.expires_at,db_now+interval '5 minutes');
  verification:=jsonb_build_object('verifierId','videoforge-hosted-qualified-gpu-activation-verifier-v1',
    'accepted',true,'signatureVerified',true,'canonicalEvidenceSha256',evidence_hash,
    'verifierSignatureSha256',promotion.decision_sha256,'sourceCommit',authority.source_commit,
    'databaseObservedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(verification_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activationSnapshotSha256',gate_hash,'paidApprovalLedgerSha256',authority.approval_sha256,'gate',gate);
  RETURN jsonb_build_object('evidence',evidence,'verification',verification);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_record_hosted_full_live_authority(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_promote_hosted_full_live(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_cloudflare_activation(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_cloudflare_rollback(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_stage_authority(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_stage_authority(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v213_stage_authority(text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_stage_handoff(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_cleanup_scope(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_receipt_verification_key(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_verify_v213_qualification_receipt(jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_publish_v213_qualified_deployments(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_operation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_transition_v213_operation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_bridge_command(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_transition_v213_bridge_command(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_workflow_start(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v213_workflow_start(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_workflow_start(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_acceptance_authority(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_operator_acceptance(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v213_operator_acceptance(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_live_acceptance(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v213_live_acceptance(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_fail_v213_live_acceptance(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_signed_evidence(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_signed_evidence(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_acceptance_repository(jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_short_pilot_repository(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_production_length_repository(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_bridge_acceptance_call(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v1() FROM PUBLIC;

-- V2-09 terminal acceptance is derived exclusively from durable settlement/output truth plus a
-- separately recorded HMAC-signed real-Chrome artifact. The command may supply identities and an
-- artifact reference, but never terminal, cost, output, readback, or browser facts.
CREATE TABLE public.hosted_v209_settlement_cost_evidence (
  generation_request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  admission_sha256 text NOT NULL CHECK(admission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  final_cumulative_endpoint_billing_micro_usd bigint NOT NULL CHECK(final_cumulative_endpoint_billing_micro_usd>=0),
  provider_observed_at timestamptz NOT NULL,
  guard_sha256 text NOT NULL CHECK(guard_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id), UNIQUE(guard_sha256),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id)
);
CREATE TABLE public.hosted_v209_terminal_acceptances (
  generation_request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  workflow_id text NOT NULL UNIQUE CHECK(workflow_id ~ '^hosted-pair-[0-9a-f-]{36}$'),
  chrome_evidence_sha256 text NOT NULL UNIQUE REFERENCES public.hosted_full_live_signed_evidence(artifact_sha256),
  render_manifest_sha256 text NOT NULL CHECK(render_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  final_output_sha256 text NOT NULL CHECK(final_output_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  final_output_receipt_sha256 text NOT NULL CHECK(final_output_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  settlement_guard_sha256 text NOT NULL REFERENCES public.hosted_v209_settlement_cost_evidence(guard_sha256),
  result_sha256 text NOT NULL UNIQUE CHECK(result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb NOT NULL CHECK(jsonb_typeof(result_document)='object'),
  accepted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id)
);
CREATE TRIGGER hosted_v209_settlement_cost_evidence_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_v209_settlement_cost_evidence FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_terminal_acceptances_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_v209_terminal_acceptances FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_v209_settlement_cost_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_settlement_cost_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_terminal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_terminal_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_settlement_cost_evidence_owner_only ON public.hosted_v209_settlement_cost_evidence
  USING(false) WITH CHECK(false);
CREATE POLICY hosted_v209_terminal_acceptances_owner_only ON public.hosted_v209_terminal_acceptances
  USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_v209_settlement_cost_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_v209_terminal_acceptances FROM PUBLIC;

ALTER FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)
  RENAME TO videoforge_settle_hosted_pair_cleanup_v2_validated;
CREATE FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)
RETURNS TABLE(pair_phase text,released boolean) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE settled record; guard_hash text;
BEGIN
  SELECT * INTO settled FROM public.videoforge_settle_hosted_pair_cleanup_v2_validated($1,$2,$3,$4,$5,$6);
  guard_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb($6),'UTF8')),'hex');
  INSERT INTO public.hosted_v209_settlement_cost_evidence(generation_request_id,account_id,workspace_id,
    admission_sha256,final_cumulative_endpoint_billing_micro_usd,provider_observed_at,guard_sha256)
  VALUES($3,$1,$2,$6->>'admissionSha256',($6->>'finalCumulativeEndpointBillingMicroUsd')::bigint,
    ($6->>'providerObservedAt')::timestamptz,guard_hash) ON CONFLICT(generation_request_id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.hosted_v209_settlement_cost_evidence e
    WHERE e.account_id=$1 AND e.workspace_id=$2 AND e.generation_request_id=$3
      AND e.admission_sha256=$6->>'admissionSha256'
      AND e.final_cumulative_endpoint_billing_micro_usd=($6->>'finalCumulativeEndpointBillingMicroUsd')::bigint
      AND e.provider_observed_at=($6->>'providerObservedAt')::timestamptz AND e.guard_sha256=guard_hash) THEN
    RAISE EXCEPTION 'V2-09 settlement evidence drift' USING ERRCODE='23505';
  END IF;
  pair_phase:=settled.pair_phase; released:=settled.released; RETURN NEXT;
END;
$$;

CREATE FUNCTION public.videoforge_complete_v209_terminal_acceptance(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE account_id uuid:=(supplied->>'accountId')::uuid; workspace_id uuid:=(supplied->>'workspaceId')::uuid;
  generation_id uuid:=(supplied->>'generationRequestId')::uuid; workflow_id text:=supplied->>'workflowId';
  chrome_hash text:=supplied->>'chromeEvidenceSha256'; runtime public.video_runtime_states%ROWTYPE;
  admission public.hosted_v209_short_admissions%ROWTYPE;
  chrome public.hosted_full_live_signed_evidence%ROWTYPE; cost public.hosted_v209_settlement_cost_evidence%ROWTYPE;
  existing public.hosted_v209_terminal_acceptances%ROWTYPE; receipt_hash text; result jsonb; result_hash text;
  ledger_spend_micro_usd bigint; phase_spend_micro_usd bigint; duration_seconds numeric;
  db_now timestamptz:=transaction_timestamp();
BEGIN
  IF jsonb_typeof(supplied)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) AS keys(key))
      IS DISTINCT FROM ARRAY['accountId','chromeEvidenceSha256','generationRequestId','workflowId','workspaceId']::text[]
     OR public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR workflow_id IS DISTINCT FROM 'hosted-pair-'||generation_id::text
     OR chrome_hash !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V2-09 terminal acceptance input invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(generation_id::text,209));
  SELECT * INTO existing FROM public.hosted_v209_terminal_acceptances WHERE generation_request_id=generation_id;
  IF existing.generation_request_id IS NOT NULL THEN RETURN existing.result_document; END IF;
  SELECT * INTO runtime FROM public.video_runtime_states r WHERE r.account_id=account_id
    AND r.workspace_id=workspace_id AND r.generation_request_id=generation_id;
  SELECT * INTO admission FROM public.hosted_v209_short_admissions a WHERE a.account_id=account_id
    AND a.workspace_id=workspace_id AND a.generation_request_id=generation_id;
  SELECT * INTO chrome FROM public.hosted_full_live_signed_evidence e WHERE e.artifact_sha256=chrome_hash AND e.kind='CHROME';
  SELECT * INTO cost FROM public.hosted_v209_settlement_cost_evidence e WHERE e.account_id=account_id
    AND e.workspace_id=workspace_id AND e.generation_request_id=generation_id;
  SELECT event.detail->>'final_output_receipt_sha256' INTO receipt_hash FROM public.video_runtime_events event
    WHERE event.account_id=account_id AND event.workspace_id=workspace_id AND event.runtime_id=runtime.id
      AND event.reason='FINAL_OUTPUT_DURABLE' AND event.to_state='COMPLETE' ORDER BY event.occurred_at DESC LIMIT 1;
  SELECT round(coalesce(sum(l.settled_usd+l.possible_duplicate_usd),0)*1000000)::bigint
    INTO ledger_spend_micro_usd
    FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a ON a.id=l.attempt_id
    WHERE a.account_id=account_id AND a.workspace_id=workspace_id AND a.generation_request_id=generation_id;
  IF jsonb_typeof(chrome.document->'durationSeconds')='number' THEN
    duration_seconds:=(chrome.document->>'durationSeconds')::numeric;
  END IF;
  phase_spend_micro_usd:=greatest(
    cost.final_cumulative_endpoint_billing_micro_usd-admission.billing_baseline_micro_usd,
    ledger_spend_micro_usd);
  IF runtime.id IS NULL OR runtime.stage<>'COMPLETE' OR runtime.terminal_reason<>'SUCCEEDED'
     OR runtime.render_manifest_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR runtime.final_output_sha256 !~ '^sha256:[0-9a-f]{64}$' OR receipt_hash !~ '^sha256:[0-9a-f]{64}$'
     OR NOT EXISTS(SELECT 1 FROM public.hosted_pair_runtime_states p WHERE p.account_id=account_id
       AND p.workspace_id=workspace_id AND p.generation_request_id=generation_id AND p.phase='SETTLED')
     OR (SELECT count(*) FROM public.serverless_attempts a WHERE a.account_id=account_id AND a.workspace_id=workspace_id
       AND a.generation_request_id=generation_id AND a.state='SUCCEEDED')<>2
     OR (SELECT count(*) FROM public.hosted_serverless_output_barrier_completions b JOIN public.serverless_attempts a
       ON a.id=b.attempt_id WHERE a.account_id=account_id AND a.workspace_id=workspace_id
       AND a.generation_request_id=generation_id)<>2
     OR (SELECT count(*) FROM public.hosted_pair_zero_worker_observations z WHERE z.account_id=account_id
       AND z.workspace_id=workspace_id AND z.generation_request_id=generation_id)<>2
     OR EXISTS(SELECT 1 FROM public.provider_workload_leases l WHERE l.account_id=account_id
       AND l.workspace_id=workspace_id AND l.generation_request_id=generation_id AND l.state='ACTIVE')
     OR admission.generation_request_id IS NULL OR admission.phase_cap_micro_usd<>2000000
     OR cost.generation_request_id IS NULL OR cost.admission_sha256<>admission.admission_sha256
     OR cost.final_cumulative_endpoint_billing_micro_usd<admission.billing_baseline_micro_usd
     OR phase_spend_micro_usd<0 OR phase_spend_micro_usd>admission.phase_cap_micro_usd
     OR chrome.artifact_sha256 IS NULL OR chrome.document->>'schemaVersion'<>'videoforge.v2-09-real-chrome-acceptance/v1'
     OR chrome.document->>'accountId'<>account_id::text OR chrome.document->>'workspaceId'<>workspace_id::text
     OR chrome.document->>'generationRequestId'<>generation_id::text OR chrome.document->>'workflowId'<>workflow_id
     OR chrome.document->>'finalOutputSha256'<>runtime.final_output_sha256
     OR chrome.document->>'browser'<>'REAL_CHROME' OR (chrome.document->>'playbackAccepted')::boolean IS DISTINCT FROM true
     OR duration_seconds IS NULL OR duration_seconds<30 OR duration_seconds>60
     OR (chrome.document->>'observedAt')::timestamptz>db_now
     OR (chrome.document->>'observedAt')::timestamptz<runtime.terminal_at THEN
    RAISE EXCEPTION 'V2-09 terminal acceptance evidence incomplete' USING ERRCODE='23514';
  END IF;
  result:=jsonb_build_object('schemaVersion','videoforge.v2-09-terminal-acceptance/v1',
    'accountId',account_id,'workspaceId',workspace_id,'generationRequestId',generation_id,'workflowId',workflow_id,
    'accepted',true,'terminal',true,'zeroWorkersAfter',true,'durationSeconds',duration_seconds,
    'settledCostUsd',phase_spend_micro_usd::numeric/1000000,'evidenceSha256',chrome_hash,
    'renderManifestSha256',runtime.render_manifest_sha256,'finalOutputSha256',runtime.final_output_sha256,
    'finalOutputReceiptSha256',receipt_hash,'chromeEvidenceSha256',chrome_hash,
    'settlementGuardSha256',cost.guard_sha256,'finalCumulativeEndpointBillingMicroUsd',cost.final_cumulative_endpoint_billing_micro_usd,
    'terminalJobs',2,'zeroWorkerLanes',2,'acceptedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  result_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(result),'UTF8')),'hex');
  result:=result||jsonb_build_object('resultSha256',result_hash);
  INSERT INTO public.hosted_v209_terminal_acceptances(generation_request_id,account_id,workspace_id,workflow_id,
    chrome_evidence_sha256,render_manifest_sha256,final_output_sha256,final_output_receipt_sha256,
    settlement_guard_sha256,result_sha256,result_document)
  VALUES(generation_id,account_id,workspace_id,workflow_id,chrome_hash,runtime.render_manifest_sha256,
    runtime.final_output_sha256,receipt_hash,cost.guard_sha256,result_hash,result);
  RETURN result;
END;
$$;
-- Read-only terminal/output projection for the post-schedule V2-09 Chrome handshake. The
-- reconciler receives only this exact projection; it never receives table privileges or any
-- dispatch-capable object. NULL means durable terminal truth is not complete yet.
CREATE FUNCTION public.videoforge_load_v209_terminal_output_projection(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_generation_request_id uuid,
  supplied_workflow_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  projection jsonb;
BEGIN
  IF supplied_account_id IS NULL
     OR supplied_workspace_id IS NULL
     OR supplied_generation_request_id IS NULL
     OR supplied_workflow_id IS DISTINCT FROM 'hosted-pair-'||supplied_generation_request_id::text
     OR public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'V2-09 terminal output projection input invalid' USING ERRCODE='42501';
  END IF;

  SELECT CASE WHEN runtime.stage='COMPLETE'
      AND runtime.terminal_reason='SUCCEEDED'
      AND runtime.final_output_sha256 ~ '^sha256:[0-9a-f]{64}$'
      AND runtime.render_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'
      AND runtime.terminal_at IS NOT NULL
      AND pair.phase='SETTLED'
      AND NOT EXISTS (
        SELECT 1 FROM public.provider_workload_leases lease
        WHERE lease.account_id=runtime.account_id
          AND lease.workspace_id=runtime.workspace_id
          AND lease.generation_request_id=runtime.generation_request_id
          AND lease.state='ACTIVE'
      )
      AND (
        SELECT count(*) FROM public.serverless_attempts attempt
        WHERE attempt.account_id=runtime.account_id
          AND attempt.workspace_id=runtime.workspace_id
          AND attempt.generation_request_id=runtime.generation_request_id
          AND attempt.state='SUCCEEDED'
      )=2
      AND (
        SELECT count(*)
        FROM public.hosted_serverless_output_barrier_completions barrier
        JOIN public.serverless_attempts attempt ON attempt.id=barrier.attempt_id
        WHERE attempt.account_id=runtime.account_id
          AND attempt.workspace_id=runtime.workspace_id
          AND attempt.generation_request_id=runtime.generation_request_id
      )=2
      AND (
        SELECT count(*) FROM public.video_runtime_events durable
        WHERE durable.account_id=runtime.account_id
          AND durable.workspace_id=runtime.workspace_id
          AND durable.runtime_id=runtime.id
          AND durable.reason='FINAL_OUTPUT_DURABLE'
          AND durable.to_state='COMPLETE'
          AND durable.detail->>'final_output_sha256'=runtime.final_output_sha256
          AND durable.detail->>'final_output_receipt_sha256' ~ '^sha256:[0-9a-f]{64}$'
      )=1
    THEN jsonb_build_object(
      'schemaVersion','videoforge.v2-09-terminal-output-proof/v1',
      'workflowId',supplied_workflow_id,
      'accountId',runtime.account_id,
      'workspaceId',runtime.workspace_id,
      'generationRequestId',runtime.generation_request_id,
      'terminal',true,
      'readbackVerified',true,
      'finalOutputSha256',runtime.final_output_sha256,
      'finalOutputReceiptSha256',(
        SELECT durable.detail->>'final_output_receipt_sha256'
        FROM public.video_runtime_events durable
        WHERE durable.account_id=runtime.account_id
          AND durable.workspace_id=runtime.workspace_id
          AND durable.runtime_id=runtime.id
          AND durable.reason='FINAL_OUTPUT_DURABLE'
          AND durable.to_state='COMPLETE'
          AND durable.detail->>'final_output_sha256'=runtime.final_output_sha256
          AND durable.detail->>'final_output_receipt_sha256' ~ '^sha256:[0-9a-f]{64}$'
        ORDER BY durable.occurred_at DESC,durable.id DESC LIMIT 1
      ),
      'terminalAt',to_char(runtime.terminal_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    ELSE NULL END
  INTO projection
  FROM public.video_runtime_states runtime
  JOIN public.hosted_pair_runtime_states pair
    ON pair.account_id=runtime.account_id
   AND pair.workspace_id=runtime.workspace_id
   AND pair.generation_request_id=runtime.generation_request_id
  WHERE runtime.account_id=supplied_account_id
    AND runtime.workspace_id=supplied_workspace_id
    AND runtime.generation_request_id=supplied_generation_request_id;

  RETURN projection;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2_validated(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v209_terminal_acceptance(jsonb) FROM PUBLIC;

-- Operation 16 post-consumption materialization.  The operator issues one short-lived challenge
-- only after the durable authority/promotion rows exist.  The hosted application may submit only
-- authenticated project selections; all acceptance facts are read back from owner-controlled rows
-- below.  The result and readback tables are append-only so a retry can return the exact prior
-- result, but can never replace a selection, facts document, or materialization hash.
CREATE TABLE public.hosted_full_live_materialization_challenges (
  id uuid PRIMARY KEY,
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  -- The account/workspace that opened the challenge is a routing scope, not an authority to
  -- choose either project.  The two project identities remain owner-validated below.
  opened_by_account_id uuid,
  opened_by_workspace_id uuid,
  challenge_sha256 text NOT NULL UNIQUE CHECK (challenge_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  challenge_document jsonb NOT NULL CHECK (jsonb_typeof(challenge_document)='object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (id,full_live_authority_id),
  CHECK (expires_at>issued_at AND expires_at<=issued_at+interval '15 minutes')
);
CREATE TABLE public.hosted_full_live_materialization_challenge_assignments (
  challenge_id uuid NOT NULL REFERENCES public.hosted_full_live_materialization_challenges(id),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('primary','sameAccountWaiter','secondary','fairnessProbe')),
  assigned_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (challenge_id,role),
  FOREIGN KEY (account_id,workspace_id) REFERENCES public.workspaces(account_id,id)
);
CREATE TABLE public.hosted_full_live_materialization_selections (
  challenge_id uuid NOT NULL REFERENCES public.hosted_full_live_materialization_challenges(id),
  role text NOT NULL CHECK (role IN ('primary','sameAccountWaiter','secondary','fairnessProbe')),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  identity_document jsonb NOT NULL CHECK (jsonb_typeof(identity_document)='object'),
  selected_by_user_id text NOT NULL CHECK (length(selected_by_user_id) BETWEEN 1 AND 200),
  selected_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (challenge_id,role),
  FOREIGN KEY (account_id,workspace_id) REFERENCES public.workspaces(account_id,id),
  FOREIGN KEY (account_id,workspace_id,project_id) REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id)
);
CREATE TABLE public.hosted_full_live_materialization_facts (
  challenge_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_materialization_challenges(id),
  selection_sha256 text NOT NULL CHECK (selection_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  facts_sha256 text NOT NULL UNIQUE CHECK (facts_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  facts_document jsonb NOT NULL CHECK (jsonb_typeof(facts_document)='object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_materialization_readbacks (
  challenge_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_materialization_challenges(id),
  selection_sha256 text NOT NULL CHECK (selection_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  facts_sha256 text NOT NULL CHECK (facts_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  materialization_sha256 text NOT NULL UNIQUE CHECK (materialization_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
-- JIT materialization is deliberately split into an intent, the TypeScript-built document/call,
-- and a DB readback.  None of these tables contains a caller-authoritative admission constructor.
CREATE TABLE public.hosted_full_live_jit_materialization_intents (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK (operation_id IN (
    'v2-09-short-hosted-project',
    'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
    'v2-12-long-output','v2-13-final-two-lane-smoke','certify-v2-13-release')),
  checkpoint text NOT NULL CHECK (checkpoint IN ('V2-09','V2-10','V2-11','V2-12','V2-13','V2-13-RELEASE')),
  command_id text NOT NULL CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
  stage_authority_id text NOT NULL CHECK (stage_authority_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'),
  outer_state_sha256 text NOT NULL CHECK (outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  predecessor_evidence_sha256s jsonb NOT NULL CHECK (jsonb_typeof(predecessor_evidence_sha256s)='object'),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  candidate_document jsonb NOT NULL CHECK (jsonb_typeof(candidate_document)='object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (full_live_authority_id,operation_id),
  UNIQUE (full_live_authority_id,checkpoint)
);
CREATE TABLE public.hosted_full_live_jit_materializations (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK (operation_id IN (
    'v2-09-short-hosted-project',
    'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
    'v2-12-long-output','v2-13-final-two-lane-smoke','certify-v2-13-release')),
  checkpoint text NOT NULL CHECK (checkpoint IN ('V2-09','V2-10','V2-11','V2-12','V2-13','V2-13-RELEASE')),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  call_sha256 text NOT NULL CHECK (call_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  execution_sha256 text NOT NULL CHECK (execution_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_document jsonb NOT NULL CHECK (jsonb_typeof(request_document)='object'),
  execution_document jsonb NOT NULL CHECK (jsonb_typeof(execution_document)='object'),
  call_document jsonb NOT NULL CHECK (jsonb_typeof(call_document)='object'),
  expires_at timestamptz NOT NULL,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (full_live_authority_id,operation_id),
  UNIQUE (full_live_authority_id,checkpoint),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE public.hosted_full_live_jit_materialization_readbacks (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL,
  checkpoint text NOT NULL,
  materialization_sha256 text NOT NULL CHECK (materialization_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  predecessor_evidence_sha256s jsonb NOT NULL CHECK (jsonb_typeof(predecessor_evidence_sha256s)='object'),
  observed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (full_live_authority_id,operation_id),
  UNIQUE (full_live_authority_id,checkpoint),
  FOREIGN KEY (full_live_authority_id,operation_id)
    REFERENCES public.hosted_full_live_jit_materializations(full_live_authority_id,operation_id)
);
CREATE TABLE public.hosted_full_live_operation_receipts (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK (operation_id IN (
    'v2-13-final-two-lane-smoke','restore-endpoints-max-one','prove-zero-workers',
    'read-settled-billing','reconcile-exact-resources')),
  artifact_sha256 text NOT NULL UNIQUE REFERENCES public.hosted_full_live_signed_evidence(artifact_sha256),
  receipt_document jsonb NOT NULL CHECK (jsonb_typeof(receipt_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id)
);
CREATE TABLE public.hosted_full_live_static_release_descriptors (
  full_live_authority_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_authorities(id),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  descriptor_sha256 text NOT NULL UNIQUE CHECK(descriptor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  descriptor_document jsonb NOT NULL CHECK(jsonb_typeof(descriptor_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_release_identity_facts (
  full_live_authority_id uuid PRIMARY KEY REFERENCES public.hosted_full_live_authorities(id),
  facts_document jsonb NOT NULL CHECK(jsonb_typeof(facts_document)='object'),
  release_identity_sha256 text NOT NULL UNIQUE
    CHECK(release_identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_refs jsonb NOT NULL CHECK(jsonb_typeof(source_refs)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE public.hosted_full_live_release_gate_facts (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  gate text NOT NULL CHECK(gate IN ('mage_certified_ledger','soulx_certified_ledger',
    'v209_short_e2e','v210_automatic_pilot','v211_two_account_queue',
    'v212_production_length_economics','release_identity_current',
    'fresh_bounded_two_lane_smoke','independent_zero_drain','settled_billing',
    'rollback_ready','operations_runbooks_ready','backup_restore_ready','security_clear',
    'production_transport_real')),
  source_operation_id text NOT NULL CHECK(length(source_operation_id) BETWEEN 1 AND 191),
  source_refs jsonb NOT NULL CHECK(jsonb_typeof(source_refs)='object'),
  fact_document jsonb NOT NULL CHECK(jsonb_typeof(fact_document)='object'),
  fact_sha256 text NOT NULL UNIQUE CHECK(fact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,gate)
);
CREATE TABLE public.hosted_full_live_release_fact_materializations (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  completed_operation_id text NOT NULL CHECK(completed_operation_id IN (
    'v2-09-short-hosted-project','v2-10-operator-free-ranga-pilot',
    'v2-11-two-concurrent-owned-projects','v2-12-long-output',
    'v2-13-final-two-lane-smoke','restore-endpoints-max-one','prove-zero-workers',
    'read-settled-billing','reconcile-exact-resources')),
  completed_evidence_sha256 text NOT NULL UNIQUE
    CHECK(completed_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  materialization_sha256 text NOT NULL UNIQUE
    CHECK(materialization_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  materialization_document jsonb NOT NULL CHECK(jsonb_typeof(materialization_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,completed_operation_id)
);
CREATE TABLE public.hosted_full_live_release_chrome_associations (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  smoke_evidence_sha256 text NOT NULL REFERENCES public.hosted_full_live_signed_evidence(artifact_sha256),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_sha256 text NOT NULL UNIQUE CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  projection_sha256 text NOT NULL UNIQUE CHECK(projection_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  chrome_artifact_sha256 text NOT NULL UNIQUE REFERENCES public.hosted_full_live_signed_evidence(artifact_sha256),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,smoke_evidence_sha256)
);
CREATE TABLE public.hosted_full_live_release_certifications (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  work_id text NOT NULL CHECK(length(work_id) BETWEEN 1 AND 240),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  certification_identity_sha256 text NOT NULL UNIQUE
    CHECK(certification_identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  predecessor_evidence_sha256s jsonb NOT NULL CHECK(jsonb_typeof(predecessor_evidence_sha256s)='object'),
  projection_sha256 text NOT NULL UNIQUE CHECK(projection_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_sha256 text NOT NULL UNIQUE CHECK(result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb NOT NULL CHECK(jsonb_typeof(result_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,work_id)
);
CREATE TRIGGER hosted_full_live_materialization_challenges_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_materialization_challenges
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_materialization_challenge_assignments_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_materialization_challenge_assignments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_materialization_selections_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_materialization_selections
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_materialization_facts_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_materialization_facts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_materialization_readbacks_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_materialization_readbacks
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_jit_materialization_intents_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_jit_materialization_intents
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_jit_materializations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_jit_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_jit_materialization_readbacks_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_jit_materialization_readbacks
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_operation_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_static_release_descriptors_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_static_release_descriptors
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_release_identity_facts_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_release_identity_facts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_release_gate_facts_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_release_gate_facts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_release_fact_materializations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_release_fact_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_release_chrome_associations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_release_chrome_associations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_release_certifications_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_release_certifications
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_materialization_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_selections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_readbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_readbacks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_challenge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_materialization_challenge_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_materialization_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_materialization_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_materializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_materializations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_materialization_readbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_materialization_readbacks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_operation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_static_release_descriptors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_static_release_descriptors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_identity_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_identity_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_gate_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_gate_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_fact_materializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_fact_materializations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_chrome_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_chrome_associations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_release_certifications FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_materialization_challenges_owner_only
  ON public.hosted_full_live_materialization_challenges USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_materialization_selections_owner_only
  ON public.hosted_full_live_materialization_selections USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_materialization_facts_owner_only
  ON public.hosted_full_live_materialization_facts USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_materialization_readbacks_owner_only
  ON public.hosted_full_live_materialization_readbacks USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_materialization_challenge_assignments_owner_only
  ON public.hosted_full_live_materialization_challenge_assignments USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_jit_materialization_intents_owner_only
  ON public.hosted_full_live_jit_materialization_intents USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_jit_materializations_owner_only
  ON public.hosted_full_live_jit_materializations USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_jit_materialization_readbacks_owner_only
  ON public.hosted_full_live_jit_materialization_readbacks USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_operation_receipts_owner_only
  ON public.hosted_full_live_operation_receipts USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_static_release_descriptors_owner_only
  ON public.hosted_full_live_static_release_descriptors USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_release_identity_facts_owner_only
  ON public.hosted_full_live_release_identity_facts USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_release_gate_facts_owner_only
  ON public.hosted_full_live_release_gate_facts USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_release_fact_materializations_owner_only
  ON public.hosted_full_live_release_fact_materializations USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_release_chrome_associations_owner_only
  ON public.hosted_full_live_release_chrome_associations USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_release_certifications_owner_only
  ON public.hosted_full_live_release_certifications USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_materialization_challenges FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_materialization_selections FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_materialization_facts FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_materialization_readbacks FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_materialization_challenge_assignments FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_jit_materialization_intents FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_jit_materializations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_jit_materialization_readbacks FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_operation_receipts FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_static_release_descriptors FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_release_identity_facts FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_release_gate_facts FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_release_fact_materializations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_release_chrome_associations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_release_certifications FROM PUBLIC;

CREATE FUNCTION public.videoforge_v213_static_release_fact_valid(
  expected_gate text,
  fact jsonb
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_catalog AS $$
DECLARE metrics jsonb:=fact->'metrics'; claims text[];
BEGIN
  IF jsonb_typeof(fact)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(fact) key)
       IS DISTINCT FROM ARRAY['claims','evidenceClass','evidencePath',
         'fixtureOrFakeTransportUsed','gate','metrics','observedAt','observerId',
         'sourceEvidenceSha256']::text[]
     OR expected_gate NOT IN ('operations_runbooks_ready','backup_restore_ready',
       'security_clear','production_transport_real')
     OR fact->>'gate'<>expected_gate
     OR fact->>'evidenceClass'<>'INDEPENDENT_RELEASE_AUDIT'
     OR fact->'fixtureOrFakeTransportUsed'<>'false'::jsonb
     OR fact->>'sourceEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR fact->>'observerId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR fact->>'evidencePath' !~ '^project-context/evidence/[A-Za-z0-9._/-]+\.json$'
     OR fact->>'evidencePath' LIKE '%..%'
     OR fact->>'observedAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     OR jsonb_typeof(fact->'claims')<>'array'
     OR jsonb_typeof(metrics)<>'object' THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM (fact->>'observedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  SELECT array_agg(value ORDER BY value) INTO claims
    FROM jsonb_array_elements_text(fact->'claims') value;
  IF expected_gate='operations_runbooks_ready' THEN
    RETURN claims=ARRAY['billing_runbook','provider_outage_runbook','rollback_runbook',
      'stuck_job_runbook']::text[]
      AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(metrics) key)=
        ARRAY['billingRunbookSha256','providerOutageRunbookSha256',
          'rollbackRunbookSha256','stuckJobRunbookSha256']::text[]
      AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(metrics) item
        WHERE item.value !~ '^sha256:[0-9a-f]{64}$');
  ELSIF expected_gate='backup_restore_ready' THEN
    RETURN claims=ARRAY['backup_readback_passed','restore_evidence_accepted',
      'schema_migration_disposition_recorded']::text[]
      AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(metrics) key)=
        ARRAY['backupReadbackPassed','restoreEvidenceAccepted',
          'schemaMigrationDisposition']::text[]
      AND metrics->'backupReadbackPassed'='true'::jsonb
      AND metrics->'restoreEvidenceAccepted'='true'::jsonb
      AND metrics->>'schemaMigrationDisposition'='DISPOSABLE_RESTORE_COMPLETED';
  ELSIF expected_gate='security_clear' THEN
    RETURN claims=ARRAY['auth_tenant_boundary_passed','cost_amplification_guards_passed',
      'legacy_runtime_bundle_scan_passed','p0_zero','p1_zero','secret_log_scan_passed',
      'ssrf_path_upload_boundary_passed']::text[]
      AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(metrics) key)=
        ARRAY['authTenantPassed','costAmplificationGuardsPassed',
          'legacyRuntimeBundleScanPassed','p0Count','p1Count','secretLogScanPassed',
          'ssrfPathUploadPassed']::text[]
      AND metrics->'p0Count'='0'::jsonb AND metrics->'p1Count'='0'::jsonb
      AND metrics->'authTenantPassed'='true'::jsonb
      AND metrics->'ssrfPathUploadPassed'='true'::jsonb
      AND metrics->'secretLogScanPassed'='true'::jsonb
      AND metrics->'costAmplificationGuardsPassed'='true'::jsonb
      AND metrics->'legacyRuntimeBundleScanPassed'='true'::jsonb;
  END IF;
  RETURN claims=ARRAY['fake_gpu_absent','fake_transport_absent','fixture_controls_absent',
    'hosted_client_api_truth','legacy_dispatch_exports_absent','manual_pod_controls_absent']::text[]
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(metrics) key)=
      ARRAY['fakeGpuProfileInBundle','fakeTransportInBundle','fixtureControlsInBundle',
        'hostedClientApiTruth','legacyDispatchExportsInBundle','manualPodControlsInBundle']::text[]
    AND metrics->'hostedClientApiTruth'='true'::jsonb
    AND metrics->'fixtureControlsInBundle'='false'::jsonb
    AND metrics->'fakeGpuProfileInBundle'='false'::jsonb
    AND metrics->'fakeTransportInBundle'='false'::jsonb
    AND metrics->'manualPodControlsInBundle'='false'::jsonb
    AND metrics->'legacyDispatchExportsInBundle'='false'::jsonb;
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_static_release_descriptor(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); full_authority uuid;
  descriptor jsonb:=supplied->'descriptor'; unsigned jsonb; authority public.hosted_full_live_authorities%ROWTYPE;
  existing public.hosted_full_live_static_release_descriptors%ROWTYPE; gate_name text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['descriptor','descriptorSha256','fullLiveAuthorityId',
         'outerStateSha256']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'descriptorSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(descriptor)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(descriptor) key)
       IS DISTINCT FROM ARRAY['auditFacts','contractBundleSha256','descriptorSha256',
         'productionUrlSha256','schemaVersion','sourceCommit']::text[]
     OR descriptor->>'schemaVersion' IS DISTINCT FROM
        'videoforge.v213-static-release-descriptor/v1'
     OR descriptor->>'descriptorSha256' IS DISTINCT FROM supplied->>'descriptorSha256'
     OR coalesce(descriptor->>'sourceCommit','') !~ '^[0-9a-f]{40}$'
     OR coalesce(descriptor->>'productionUrlSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(descriptor->>'contractBundleSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(descriptor->'auditFacts') IS DISTINCT FROM 'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(descriptor->'auditFacts') key)
       IS DISTINCT FROM ARRAY['backup_restore_ready','operations_runbooks_ready',
         'production_transport_real','security_clear']::text[] THEN
    RAISE EXCEPTION 'V213 static release descriptor invalid' USING ERRCODE='23514';
  END IF;
  unsigned:=descriptor-'descriptorSha256';
  IF public.videoforge_v213_jit_sha256(unsigned) IS DISTINCT FROM
     supplied->>'descriptorSha256' THEN
    RAISE EXCEPTION 'V213 static release descriptor hash invalid' USING ERRCODE='23514';
  END IF;
  FOREACH gate_name IN ARRAY ARRAY['operations_runbooks_ready','backup_restore_ready',
    'security_clear','production_transport_real']::text[] LOOP
    IF NOT public.videoforge_v213_static_release_fact_valid(
      gate_name,descriptor->'auditFacts'->gate_name) THEN
      RAISE EXCEPTION 'V213 static release descriptor fact invalid: %',gate_name
        USING ERRCODE='23514';
    END IF;
  END LOOP;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO authority FROM public.hosted_full_live_authorities
   WHERE id=full_authority FOR SHARE;
  IF authority.id IS NULL OR authority.expires_at<=db_now
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p
       WHERE p.authority_id=full_authority)
     OR authority.source_commit IS DISTINCT FROM descriptor->>'sourceCommit'
     OR authority.authority_document->>'staticReleaseDescriptorSha256' IS DISTINCT FROM
        supplied->>'descriptorSha256'
     OR EXISTS(SELECT 1 FROM public.hosted_full_live_materialization_challenges challenge
       WHERE challenge.full_live_authority_id=full_authority
         AND challenge.challenge_document->>'outerStateSha256' IS DISTINCT FROM
             supplied->>'outerStateSha256') THEN
    RAISE EXCEPTION 'V213 static release descriptor authority drift' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_static_release_descriptors row
   WHERE row.full_live_authority_id=full_authority;
  IF existing.full_live_authority_id IS NOT NULL THEN
    IF existing.outer_state_sha256<>supplied->>'outerStateSha256'
       OR existing.descriptor_sha256<>supplied->>'descriptorSha256'
       OR existing.descriptor_document IS DISTINCT FROM descriptor THEN
      RAISE EXCEPTION 'V213 static release descriptor replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('descriptorSha256',existing.descriptor_sha256);
  END IF;
  INSERT INTO public.hosted_full_live_static_release_descriptors(full_live_authority_id,
    outer_state_sha256,descriptor_sha256,descriptor_document)
  VALUES(full_authority,supplied->>'outerStateSha256',supplied->>'descriptorSha256',descriptor);
  RETURN jsonb_build_object('descriptorSha256',supplied->>'descriptorSha256');
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_v213_static_release_fact_valid(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_static_release_descriptor(jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_issue_v213_materialization_challenge(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  full_authority uuid; authority public.hosted_full_live_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE; existing public.hosted_full_live_materialization_challenges%ROWTYPE;
  challenge_hash text; challenge_id uuid; unsigned jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['approvalRecordSha256','authorityId','authoritySha256','cumulativeLedgerSha256',
         'expiresAt','fullLiveAuthorityId','operationId','outerStateSha256','proposalSha256',
         'promotionDecisionSha256','promotionEvidenceSha256','requestSha256','schemaVersion','sourceCommit',
         'tokenSha256','workflowAuthorityId','workerOperatorBearerSha256']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v213-post-consumption-materialization-challenge/v1'
     OR supplied->>'operationId'<>'record-workflow-start-authority'
     OR supplied->>'fullLiveAuthorityId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'workflowAuthorityId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'authoritySha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'approvalRecordSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'cumulativeLedgerSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'promotionDecisionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'promotionEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'proposalSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'workerOperatorBearerSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'expiresAt')::timestamptz<=db_now THEN
    RAISE EXCEPTION 'V213 materialization challenge invalid' USING ERRCODE='42501';
  END IF;
  unsigned:=supplied-'requestSha256';
  challenge_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(unsigned),'UTF8')),'hex');
  IF challenge_hash<>supplied->>'requestSha256' THEN
    RAISE EXCEPTION 'V213 materialization challenge hash invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=full_authority FOR SHARE;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=full_authority FOR SHARE;
  IF authority.id IS NULL OR promotion.id IS NULL
     OR authority.expires_at<=db_now OR authority.authority_id<>supplied->>'authorityId'
     OR authority.authority_document_sha256<>supplied->>'authoritySha256'
     OR authority.proposal_sha256<>supplied->>'proposalSha256'
     OR authority.approval_sha256<>supplied->>'approvalRecordSha256'
     OR authority.source_commit<>supplied->>'sourceCommit'
     OR authority.executor_sha256 IS NULL
     OR promotion.decision_sha256<>supplied->>'promotionDecisionSha256'
     OR promotion.migration_ledger_sha256<>supplied->>'cumulativeLedgerSha256'
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_static_release_descriptors descriptor
       WHERE descriptor.full_live_authority_id=full_authority
         AND descriptor.outer_state_sha256=supplied->>'outerStateSha256'
         AND descriptor.descriptor_sha256=
             authority.authority_document->>'staticReleaseDescriptorSha256')
     OR (supplied->>'expiresAt')::timestamptz>least(authority.expires_at,db_now+interval '15 minutes') THEN
    RAISE EXCEPTION 'V213 materialization challenge authority or promotion drift' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_materialization_challenges
    WHERE full_live_authority_id=full_authority AND challenge_sha256=supplied->>'requestSha256';
  IF existing.id IS NOT NULL THEN
    IF existing.challenge_document IS DISTINCT FROM supplied
       OR existing.expires_at<>(supplied->>'expiresAt')::timestamptz THEN
      RAISE EXCEPTION 'V213 materialization challenge replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('authoritySha256',supplied->>'authoritySha256','challengeId',existing.id,
      'challengeSha256',existing.challenge_sha256);
  END IF;
  IF EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_challenges c
    WHERE c.full_live_authority_id=full_authority AND c.expires_at>db_now
      AND NOT EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_facts f WHERE f.challenge_id=c.id)) THEN
    RAISE EXCEPTION 'V213 materialization challenge ambiguous' USING ERRCODE='21000';
  END IF;
  challenge_id:=gen_random_uuid();
  INSERT INTO public.hosted_full_live_materialization_challenges(id,full_live_authority_id,challenge_sha256,
    challenge_document,issued_at,expires_at)
  VALUES(challenge_id,full_authority,supplied->>'requestSha256',supplied,db_now,(supplied->>'expiresAt')::timestamptz);
  RETURN jsonb_build_object('authoritySha256',supplied->>'authoritySha256','challengeId',challenge_id,
    'challengeSha256',supplied->>'requestSha256');
END;
$$;

CREATE FUNCTION public.videoforge_load_v213_materialization_challenge(
  supplied_account_id uuid, supplied_workspace_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); pending integer; challenge record; selected_role text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.account_id=supplied_account_id AND w.id=supplied_workspace_id) THEN
    RAISE EXCEPTION 'V213 materialization challenge tenant invalid' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO pending
    FROM public.hosted_full_live_materialization_challenges c
   WHERE c.expires_at>db_now
     AND NOT EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_facts f WHERE f.challenge_id=c.id);
  IF pending>1 THEN RAISE EXCEPTION 'V213 materialization challenge ambiguous' USING ERRCODE='21000'; END IF;
  IF pending=0 THEN RETURN NULL; END IF;
  SELECT c.* INTO challenge
    FROM public.hosted_full_live_materialization_challenges c
   WHERE c.expires_at>db_now
     AND NOT EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_facts f WHERE f.challenge_id=c.id);
  IF NOT EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_selections s
    WHERE s.challenge_id=challenge.id AND s.role='primary') THEN
    selected_role:='primary';
  ELSIF NOT EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_selections s
    WHERE s.challenge_id=challenge.id AND s.role='sameAccountWaiter') THEN
    selected_role:='sameAccountWaiter';
  ELSIF NOT EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_selections s
    WHERE s.challenge_id=challenge.id AND s.role='secondary') THEN
    selected_role:='secondary';
  ELSE
    selected_role:='fairnessProbe';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hosted_full_live_materialization_selections s
    WHERE s.challenge_id=challenge.id AND s.role=selected_role) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('challengeId',challenge.id,'challengeSha256',challenge.challenge_sha256,'role',selected_role);
END;
$$;

CREATE FUNCTION public.videoforge_submit_v213_materialization_selection(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); challenge public.hosted_full_live_materialization_challenges%ROWTYPE;
  existing public.hosted_full_live_materialization_selections%ROWTYPE; primary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  waiter_row public.hosted_full_live_materialization_selections%ROWTYPE;
  secondary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  fairness_row public.hosted_full_live_materialization_selections%ROWTYPE;
  selection jsonb; selection_hash text;
  account_id uuid; workspace_id uuid; project_id uuid; revision_id uuid; challenge_id uuid;
  role text; identity jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['accountId','challengeId','challengeSha256','identity','role','selectedByUserId','workspaceId']::text[]
     OR supplied->>'accountId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'workspaceId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'challengeId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'challengeSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'role' NOT IN ('primary','sameAccountWaiter','secondary','fairnessProbe')
     OR length(supplied->>'selectedByUserId')<1
     OR jsonb_typeof(supplied->'identity')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'identity') key)
       IS DISTINCT FROM ARRAY['accountId','projectId','projectRevisionId','workspaceId']::text[] THEN
    RAISE EXCEPTION 'V213 materialization selection invalid' USING ERRCODE='42501';
  END IF;
  account_id:=(supplied->>'accountId')::uuid; workspace_id:=(supplied->>'workspaceId')::uuid;
  challenge_id:=(supplied->>'challengeId')::uuid; role:=supplied->>'role'; identity:=supplied->'identity';
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR identity->>'accountId'<>account_id::text OR identity->>'workspaceId'<>workspace_id::text
     OR identity->>'projectId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR identity->>'projectRevisionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'V213 materialization selection tenant or identity mismatch' USING ERRCODE='42501';
  END IF;
  project_id:=(identity->>'projectId')::uuid; revision_id:=(identity->>'projectRevisionId')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.projects p JOIN public.project_revisions r
    ON r.account_id=p.account_id AND r.workspace_id=p.workspace_id AND r.project_id=p.id
   WHERE p.account_id=account_id AND p.workspace_id=workspace_id AND p.id=project_id AND p.status='ACTIVE'
     AND r.id=revision_id AND r.status='LOCKED') THEN
    RAISE EXCEPTION 'V213 materialization selection project is not an owned locked revision' USING ERRCODE='42501';
  END IF;
  SELECT * INTO challenge FROM public.hosted_full_live_materialization_challenges
   WHERE id=challenge_id AND challenge_sha256=supplied->>'challengeSha256' FOR UPDATE;
  IF challenge.id IS NULL OR challenge.expires_at<=db_now THEN
    RAISE EXCEPTION 'V213 materialization challenge unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_materialization_selections
   WHERE challenge_id=challenge_id AND role=role;
  IF existing.challenge_id IS NOT NULL THEN
    IF existing.account_id<>account_id OR existing.workspace_id<>workspace_id OR existing.project_id<>project_id
       OR existing.project_revision_id<>revision_id THEN
      RAISE EXCEPTION 'V213 materialization selection replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_materialization_selections(challenge_id,role,account_id,workspace_id,
      project_id,project_revision_id,identity_document,selected_by_user_id)
    VALUES(challenge_id,role,account_id,workspace_id,project_id,revision_id,identity,supplied->>'selectedByUserId');
  END IF;
  SELECT * INTO primary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge_id AND role='primary';
  SELECT * INTO waiter_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge_id AND role='sameAccountWaiter';
  SELECT * INTO secondary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge_id AND role='secondary';
  SELECT * INTO fairness_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge_id AND role='fairnessProbe';
  IF primary_row.challenge_id IS NULL OR waiter_row.challenge_id IS NULL
     OR secondary_row.challenge_id IS NULL
     OR fairness_row.challenge_id IS NULL THEN
    RETURN jsonb_build_object('state','PENDING','selectionSha256',NULL);
  END IF;
  IF waiter_row.account_id<>primary_row.account_id
     OR waiter_row.workspace_id<>primary_row.workspace_id
     OR waiter_row.project_id<>primary_row.project_id
     OR waiter_row.project_revision_id<>primary_row.project_revision_id
     OR waiter_row.project_id IN (secondary_row.project_id,fairness_row.project_id)
     OR primary_row.account_id IN (secondary_row.account_id,fairness_row.account_id)
     OR secondary_row.account_id=fairness_row.account_id
     OR primary_row.workspace_id IN (secondary_row.workspace_id,fairness_row.workspace_id)
     OR secondary_row.workspace_id=fairness_row.workspace_id
     OR primary_row.project_id IN (secondary_row.project_id,fairness_row.project_id)
     OR secondary_row.project_id=fairness_row.project_id THEN
    RAISE EXCEPTION 'V213 materialization selections must be distinct accounts, workspaces, and projects'
      USING ERRCODE='23514';
  END IF;
  selection:=jsonb_build_object('primary',primary_row.identity_document,
    'sameAccountWaiter',waiter_row.identity_document,
    'secondary',secondary_row.identity_document,'fairnessProbe',fairness_row.identity_document);
  selection_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(selection),'UTF8')),'hex');
  RETURN jsonb_build_object('state','READY','selectionSha256',selection_hash);
END;
$$;

CREATE FUNCTION public.videoforge_load_v213_materialization_selection(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE challenge public.hosted_full_live_materialization_challenges%ROWTYPE;
  primary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  waiter_row public.hosted_full_live_materialization_selections%ROWTYPE;
  secondary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  fairness_row public.hosted_full_live_materialization_selections%ROWTYPE;
  selection jsonb; selection_hash text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['challengeId','challengeSha256']::text[]
     OR supplied->>'challengeId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'challengeSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 materialization selection lookup invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO challenge FROM public.hosted_full_live_materialization_challenges
   WHERE id=(supplied->>'challengeId')::uuid AND challenge_sha256=supplied->>'challengeSha256';
  IF challenge.id IS NULL OR challenge.expires_at<=transaction_timestamp() THEN
    RAISE EXCEPTION 'V213 materialization selection challenge unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO primary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge.id AND role='primary';
  SELECT * INTO waiter_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge.id AND role='sameAccountWaiter';
  SELECT * INTO secondary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge.id AND role='secondary';
  SELECT * INTO fairness_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge.id AND role='fairnessProbe';
  IF primary_row.challenge_id IS NULL OR waiter_row.challenge_id IS NULL
     OR secondary_row.challenge_id IS NULL
     OR fairness_row.challenge_id IS NULL THEN RETURN NULL; END IF;
  IF waiter_row.account_id<>primary_row.account_id
     OR waiter_row.workspace_id<>primary_row.workspace_id
     OR waiter_row.project_id<>primary_row.project_id
     OR waiter_row.project_revision_id<>primary_row.project_revision_id
     OR waiter_row.project_id IN (secondary_row.project_id,fairness_row.project_id)
     OR primary_row.account_id IN (secondary_row.account_id,fairness_row.account_id)
     OR secondary_row.account_id=fairness_row.account_id
     OR primary_row.workspace_id IN (secondary_row.workspace_id,fairness_row.workspace_id)
     OR secondary_row.workspace_id=fairness_row.workspace_id
     OR primary_row.project_id IN (secondary_row.project_id,fairness_row.project_id)
     OR secondary_row.project_id=fairness_row.project_id THEN
    RAISE EXCEPTION 'V213 materialization selection ambiguity' USING ERRCODE='21000';
  END IF;
  selection:=jsonb_build_object('primary',primary_row.identity_document,
    'sameAccountWaiter',waiter_row.identity_document,
    'secondary',secondary_row.identity_document,'fairnessProbe',fairness_row.identity_document);
  selection_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(selection),'UTF8')),'hex');
  RETURN jsonb_build_object('selection',selection,'selectionSha256',selection_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_complete_v213_materialization_challenge(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  challenge public.hosted_full_live_materialization_challenges%ROWTYPE;
  facts_row public.hosted_full_live_materialization_facts%ROWTYPE;
  primary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  waiter_row public.hosted_full_live_materialization_selections%ROWTYPE;
  secondary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  authority public.hosted_full_live_authorities%ROWTYPE; promotion public.hosted_full_live_promotions%ROWTYPE;
  primary_request public.generation_requests%ROWTYPE;
  admission public.hosted_v209_short_admissions%ROWTYPE; facts jsonb; facts_hash text; selection jsonb;
  primary_identity jsonb; commands jsonb; lane_item_ids jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['challengeId','challengeSha256','selection','selectionSha256']::text[]
     OR supplied->>'challengeId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'challengeSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'selectionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'selection')<>'object' THEN
    RAISE EXCEPTION 'V213 materialization facts request invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO challenge FROM public.hosted_full_live_materialization_challenges
    WHERE id=(supplied->>'challengeId')::uuid AND challenge_sha256=supplied->>'challengeSha256' FOR UPDATE;
  IF challenge.id IS NULL OR challenge.expires_at<=transaction_timestamp() THEN
    RAISE EXCEPTION 'V213 materialization facts challenge unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO facts_row FROM public.hosted_full_live_materialization_facts WHERE challenge_id=challenge.id;
  IF facts_row.challenge_id IS NOT NULL THEN
    IF facts_row.selection_sha256<>supplied->>'selectionSha256' OR facts_row.facts_document IS NULL THEN
      RAISE EXCEPTION 'V213 materialization facts replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('facts',facts_row.facts_document,'factsSha256',facts_row.facts_sha256);
  END IF;
  SELECT * INTO primary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge.id AND role='primary';
  SELECT * INTO secondary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=challenge.id AND role='secondary';
  selection:=jsonb_build_object('primary',primary_row.identity_document,'secondary',secondary_row.identity_document);
  IF primary_row.challenge_id IS NULL OR secondary_row.challenge_id IS NULL
     OR primary_row.account_id=secondary_row.account_id OR primary_row.workspace_id=secondary_row.workspace_id
     OR primary_row.project_id=secondary_row.project_id
     OR ('sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(selection),'UTF8')),'hex'))<>supplied->>'selectionSha256'
     OR supplied->'selection' IS DISTINCT FROM selection THEN
    RAISE EXCEPTION 'V213 materialization facts selection mismatch' USING ERRCODE='23514';
  END IF;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=challenge.full_live_authority_id FOR SHARE;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=authority.id FOR SHARE;
  SELECT * INTO primary_request FROM public.generation_requests r WHERE r.account_id=primary_row.account_id
    AND r.workspace_id=primary_row.workspace_id AND r.project_id=primary_row.project_id
    AND r.project_revision_id=primary_row.project_revision_id ORDER BY r.created_at DESC LIMIT 1;
  SELECT * INTO admission FROM public.hosted_v209_short_admissions WHERE generation_request_id=primary_request.id;
  IF authority.id IS NULL OR promotion.id IS NULL OR primary_request.id IS NULL
     OR admission.generation_request_id IS NULL
     OR admission.account_id<>primary_row.account_id
     OR admission.workspace_id<>primary_row.workspace_id
     OR admission.admission_document IS NULL
     OR jsonb_typeof(admission.admission_document)<>'object' THEN
    RAISE EXCEPTION 'V213 materialization facts require the already-available V2-09 plan/admission'
      USING ERRCODE='42501';
  END IF;
  primary_identity:=jsonb_build_object('accountId',primary_row.account_id,'workspaceId',primary_row.workspace_id,
    'projectId',primary_row.project_id,'projectRevisionId',primary_row.project_revision_id,
    'generationRequestId',primary_request.id);
  SELECT jsonb_build_object(
    'mage_image',coalesce((SELECT jsonb_agg(i.item_id ORDER BY i.item_ordinal) FROM public.hosted_lane_batches b
      JOIN public.hosted_lane_batch_items i ON i.batch_id=b.id WHERE b.generation_request_id=primary_request.id AND b.lane='mage_image'),'[]'::jsonb),
    'soulx_avatar',coalesce((SELECT jsonb_agg(i.item_id ORDER BY i.item_ordinal) FROM public.hosted_lane_batches b
      JOIN public.hosted_lane_batch_items i ON i.batch_id=b.id WHERE b.generation_request_id=primary_request.id AND b.lane='soulx_avatar'),'[]'::jsonb))
    INTO lane_item_ids;
  IF jsonb_array_length(lane_item_ids->'mage_image')<1 OR jsonb_array_length(lane_item_ids->'soulx_avatar')<1 THEN
    RAISE EXCEPTION 'V213 materialization facts require both durable lane batches' USING ERRCODE='42501';
  END IF;
  -- Acceptance inputs are intentionally absent here. Each acceptance operation invokes the
  -- JIT materializer after its predecessor's durable result exists; persisting four children at
  -- this boundary would either replay future evidence or manufacture admissions/artifacts.
  commands:=jsonb_build_object(
    'v2-09-short-hosted-project',jsonb_build_object('admission',admission.admission_document,'laneItemIds',lane_item_ids,'pairInput',primary_identity),
    'v2-10-operator-free-ranga-pilot',primary_identity-'generationRequestId',
    'v2-11-two-concurrent-owned-projects',primary_identity-'generationRequestId',
    'v2-12-long-output',primary_identity-'generationRequestId',
    'v2-13-final-two-lane-smoke',primary_identity-'generationRequestId');
  facts:=jsonb_build_object('acceptanceExecutions','{}'::jsonb,'appOwnedIdentities',primary_identity,
    'commandPayloads',commands,'fullLiveAuthorityId',authority.id);
  facts_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(facts),'UTF8')),'hex');
  INSERT INTO public.hosted_full_live_materialization_facts(challenge_id,selection_sha256,facts_sha256,facts_document)
    VALUES(challenge.id,supplied->>'selectionSha256',facts_hash,facts);
  RETURN jsonb_build_object('facts',facts,'factsSha256',facts_hash);
END;
$$;

-- Materialize one acceptance authority only at the operation that consumes it. The function reads
-- the already-recorded operation-16 facts plus the durable acceptance repository/evidence rows;
-- it never accepts caller-supplied admissions, release identities, or future output booleans.
/* Retained as audit history only; superseded by the direct-parent JIT implementation below.
CREATE FUNCTION public.videoforge_materialize_v213_acceptance_authority(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  checkpoint text:=supplied->>'checkpoint'; command text:=supplied->>'command';
  full_authority uuid; stage_authority text:=supplied->>'stageAuthorityId';
  authority public.hosted_full_live_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE;
  start_authority public.hosted_full_live_workflow_start_authorities%ROWTYPE;
  facts_row public.hosted_full_live_materialization_facts%ROWTYPE;
  primary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  secondary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  primary_request public.generation_requests%ROWTYPE;
  waiter_request public.generation_requests%ROWTYPE;
  secondary_request public.generation_requests%ROWTYPE;
  short_record jsonb; length_record jsonb; admission jsonb; request jsonb; document jsonb;
  execution jsonb; call jsonb; retained jsonb; primary_identity jsonb; second_identity jsonb;
  scopes jsonb; evidence_artifacts jsonb; chrome_document jsonb; release_identity jsonb;
  prior jsonb:=supplied->'predecessorEvidenceSha256s'; command_payload jsonb:=supplied->'commandPayload';
  request_hash text; execution_id text; workflow_id text; attempt_id text; child_expires_at timestamptz;
  existing public.hosted_full_live_acceptance_authorities%ROWTYPE; result jsonb; cutoff timestamptz;
  candidate_count integer; scope_request_hash text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['checkpoint','command','commandId','commandPayload','fullLiveAuthorityId',
         'outerStateSha256','predecessorEvidenceSha256s','stageAuthorityId']::text[]
     OR checkpoint NOT IN ('V2-10','V2-11','V2-12','V2-13')
     OR command<>(CASE checkpoint WHEN 'V2-10' THEN 'v2-10-operator-free-ranga-pilot'
       WHEN 'V2-11' THEN 'v2-11-two-concurrent-owned-projects'
       WHEN 'V2-12' THEN 'v2-12-long-output' ELSE 'v2-13-final-two-lane-smoke' END)
     OR supplied->>'fullLiveAuthorityId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR stage_authority IS DISTINCT FROM supplied->>'fullLiveAuthorityId'
     OR (supplied->>'commandId') IS DISTINCT FROM
        ('v213:'||(supplied->>'fullLiveAuthorityId')||':'||command)
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(command_payload)<>'object'
     OR jsonb_typeof(prior)<>'object' THEN
    RAISE EXCEPTION 'V213 JIT acceptance authority input invalid' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each_text(prior) p WHERE p.value !~ '^sha256:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'V213 JIT predecessor evidence invalid' USING ERRCODE='42501';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=full_authority FOR SHARE;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=full_authority FOR SHARE;
  SELECT * INTO start_authority FROM public.hosted_full_live_workflow_start_authorities
    WHERE full_live_authority_id=full_authority FOR SHARE;
  SELECT f.* INTO facts_row FROM public.hosted_full_live_materialization_facts f
    JOIN public.hosted_full_live_materialization_challenges c ON c.id=f.challenge_id
    WHERE c.full_live_authority_id=full_authority
      AND c.challenge_document->>'outerStateSha256'=supplied->>'outerStateSha256' FOR SHARE;
  IF authority.id IS NULL OR promotion.id IS NULL OR start_authority.id IS NULL
     OR authority.expires_at<=db_now OR start_authority.expires_at<=db_now
     OR facts_row.challenge_id IS NULL
     OR facts_row.facts_document->>'fullLiveAuthorityId'<>full_authority::text
     OR command_payload IS DISTINCT FROM facts_row.facts_document->'commandPayloads'->command THEN
    RAISE EXCEPTION 'V213 JIT acceptance authority outer/facts binding invalid' USING ERRCODE='42501';
  END IF;
  IF checkpoint='V2-10' AND NOT EXISTS (
       SELECT 1 FROM public.hosted_v209_terminal_acceptances t
        WHERE t.generation_request_id=(facts_row.facts_document->'appOwnedIdentities'->>'generationRequestId')::uuid
          AND t.result_sha256=prior->>'v2-09-short-hosted-project') THEN
    RAISE EXCEPTION 'V213 JIT V2-10 predecessor is not durably complete' USING ERRCODE='42501';
  ELSIF checkpoint='V2-11' AND (
      NOT EXISTS (SELECT 1 FROM public.hosted_v209_terminal_acceptances t
        WHERE t.generation_request_id=(facts_row.facts_document->'appOwnedIdentities'->>'generationRequestId')::uuid
          AND t.result_sha256=prior->>'v2-09-short-hosted-project') OR
      NOT EXISTS (SELECT 1 FROM public.hosted_full_live_acceptance_results r
        JOIN public.hosted_full_live_acceptance_claims c ON c.id=r.claim_id
        JOIN public.hosted_full_live_acceptance_authorities aa ON aa.id=c.acceptance_authority_id
        JOIN public.hosted_full_live_workflow_start_authorities wa ON wa.id=aa.workflow_start_authority_id
        WHERE wa.full_live_authority_id=full_authority AND aa.checkpoint='V2-10'
          AND r.evidence_sha256=prior->>'v2-10-operator-free-ranga-pilot')) THEN
    RAISE EXCEPTION 'V213 JIT V2-11 predecessor is not durably complete' USING ERRCODE='42501';
  ELSIF checkpoint='V2-12' AND (
      NOT EXISTS (SELECT 1 FROM public.hosted_full_live_acceptance_results r
        JOIN public.hosted_full_live_acceptance_claims c ON c.id=r.claim_id
        JOIN public.hosted_full_live_acceptance_authorities aa ON aa.id=c.acceptance_authority_id
        JOIN public.hosted_full_live_workflow_start_authorities wa ON wa.id=aa.workflow_start_authority_id
        WHERE wa.full_live_authority_id=full_authority AND aa.checkpoint='V2-11'
          AND r.evidence_sha256=prior->>'v2-11-two-concurrent-owned-projects') OR
      NOT EXISTS (SELECT 1 FROM public.hosted_full_live_acceptance_results r
        JOIN public.hosted_full_live_acceptance_claims c ON c.id=r.claim_id
        JOIN public.hosted_full_live_acceptance_authorities aa ON aa.id=c.acceptance_authority_id
        JOIN public.hosted_full_live_workflow_start_authorities wa ON wa.id=aa.workflow_start_authority_id
        WHERE wa.full_live_authority_id=full_authority AND aa.checkpoint='V2-10'
          AND r.evidence_sha256=prior->>'v2-10-operator-free-ranga-pilot')) THEN
    RAISE EXCEPTION 'V213 JIT V2-12 predecessors are not durably complete' USING ERRCODE='42501';
  END IF;
  primary_identity:=facts_row.facts_document->'appOwnedIdentities';
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(primary_identity) key)
       IS DISTINCT FROM ARRAY['accountId','generationRequestId','projectId','projectRevisionId','workspaceId']::text[]
     OR command_payload->>'accountId'<>primary_identity->>'accountId'
     OR command_payload->>'workspaceId'<>primary_identity->>'workspaceId'
     OR command_payload->>'projectId'<>primary_identity->>'projectId'
     OR command_payload->>'projectRevisionId'<>primary_identity->>'projectRevisionId' THEN
    RAISE EXCEPTION 'V213 JIT command identity drift' USING ERRCODE='23514';
  END IF;
  SELECT * INTO primary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=facts_row.challenge_id AND role='primary';
  SELECT * INTO secondary_row FROM public.hosted_full_live_materialization_selections
    WHERE challenge_id=facts_row.challenge_id AND role='secondary';
  SELECT * INTO primary_request FROM public.generation_requests
    WHERE id=(primary_identity->>'generationRequestId')::uuid
      AND account_id=primary_row.account_id AND workspace_id=primary_row.workspace_id
      AND project_id=primary_row.project_id AND project_revision_id=primary_row.project_revision_id;
  SELECT * INTO secondary_request FROM public.generation_requests
    WHERE account_id=secondary_row.account_id AND workspace_id=secondary_row.workspace_id
      AND project_id=secondary_row.project_id AND project_revision_id=secondary_row.project_revision_id
    ORDER BY created_at DESC LIMIT 1;
  IF primary_row.challenge_id IS NULL OR primary_request.id IS NULL
     OR (checkpoint='V2-11' AND (secondary_row.challenge_id IS NULL OR secondary_request.id IS NULL
       OR primary_row.account_id=secondary_row.account_id OR primary_row.workspace_id=secondary_row.workspace_id
       OR primary_row.project_id=secondary_row.project_id)) THEN
    RAISE EXCEPTION 'V213 JIT owned identity unavailable' USING ERRCODE='42501';
  END IF;
  IF checkpoint='V2-10' THEN
    SELECT count(DISTINCT key_sha256) INTO candidate_count
      FROM public.hosted_full_live_acceptance_repository_records
     WHERE repository='SHORT_PILOT' AND state='READY'
       AND record_document->>'accountId'=primary_identity->>'accountId'
       AND record_document->>'workspaceId'=primary_identity->>'workspaceId'
       AND record_document->>'projectId'=primary_identity->>'projectId'
       AND record_document->>'projectRevisionId'=primary_identity->>'projectRevisionId';
    IF candidate_count<>1 THEN
      RAISE EXCEPTION 'V213 JIT V2-10 admission must be one durable READY record' USING ERRCODE='42501';
    END IF;
    SELECT record_document INTO short_record
      FROM public.hosted_full_live_acceptance_repository_records
     WHERE repository='SHORT_PILOT' AND state='READY'
       AND record_document->>'accountId'=primary_identity->>'accountId'
       AND record_document->>'workspaceId'=primary_identity->>'workspaceId'
       AND record_document->>'projectId'=primary_identity->>'projectId'
       AND record_document->>'projectRevisionId'=primary_identity->>'projectRevisionId'
     ORDER BY sequence DESC LIMIT 1;
    IF short_record IS NULL OR short_record->'admissionDocument' IS NULL
       OR short_record->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR short_record->>'automaticAttemptId' IS NULL
       OR short_record->>'submissionToken' IS NULL THEN
      RAISE EXCEPTION 'V213 JIT V2-10 durable admission incomplete' USING ERRCODE='42501';
    END IF;
    admission:=jsonb_build_object('schemaVersion','videoforge-hosted-short-pilot-admission/v2',
      'groundworkOnly',true,'key',short_record-'admissionDocument'-'admissionDocumentSha256'-'submissionToken'
        -'submissionTokenSha256'-'automaticAttemptId'-'state'-'submissionCount'-'acceptanceSha256'-'requestSha256',
      'revisionConfigSha256',short_record->'admissionDocument'->'revisionConfigSha256',
      'qualificationSha256s',short_record->'admissionDocument'->'qualificationSha256s',
      'barrierAcceptanceSha256s',short_record->'admissionDocument'->'barrierAcceptanceSha256s',
      'totalFrames',short_record->'admissionDocument'->'totalFrames',
      'expectedCutCount',short_record->'admissionDocument'->'expectedCutCount',
      'maximumVariableCostMicroUsd',short_record->'admissionDocument'->'maximumVariableCostMicroUsd',
      'maximumWallTimeMs',short_record->'admissionDocument'->'maximumWallTimeMs',
      'requestSha256',short_record->>'requestSha256','submissionToken',short_record->>'submissionToken',
      'submissionTokenSha256',short_record->>'submissionTokenSha256','automaticAttemptId',short_record->>'automaticAttemptId',
      'submissionState',short_record->>'state','submissionCount',short_record->'submissionCount','replayed',true);
    request_hash:=short_record->>'requestSha256'; attempt_id:=short_record->>'automaticAttemptId';
  ELSIF checkpoint='V2-12' THEN
    SELECT count(DISTINCT key_sha256) INTO candidate_count
      FROM public.hosted_full_live_acceptance_repository_records
     WHERE repository='PRODUCTION_LENGTH' AND state='READY'
       AND record_document->'document'->'key'->>'accountId'=primary_identity->>'accountId'
       AND record_document->'document'->'key'->>'workspaceId'=primary_identity->>'workspaceId'
       AND record_document->'document'->'key'->>'projectId'=primary_identity->>'projectId'
       AND record_document->'document'->'key'->>'projectRevisionId'=primary_identity->>'projectRevisionId';
    IF candidate_count<>1 THEN
      RAISE EXCEPTION 'V213 JIT V2-12 admission must be one durable READY record' USING ERRCODE='42501';
    END IF;
    SELECT record_document INTO length_record
      FROM public.hosted_full_live_acceptance_repository_records
     WHERE repository='PRODUCTION_LENGTH' AND state='READY'
       AND record_document->'document'->'key'->>'accountId'=primary_identity->>'accountId'
       AND record_document->'document'->'key'->>'workspaceId'=primary_identity->>'workspaceId'
       AND record_document->'document'->'key'->>'projectId'=primary_identity->>'projectId'
       AND record_document->'document'->'key'->>'projectRevisionId'=primary_identity->>'projectRevisionId'
     ORDER BY sequence DESC LIMIT 1;
    IF length_record IS NULL OR length_record->'document' IS NULL
       OR length_record->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR length_record->>'attemptId' IS NULL OR length_record->>'submissionToken' IS NULL THEN
      RAISE EXCEPTION 'V213 JIT V2-12 durable admission incomplete' USING ERRCODE='42501';
    END IF;
    admission:=jsonb_build_object('groundworkOnly',true,'liveAcceptanceClaimed',false,
      'document',length_record->'document','documentSha256',length_record->>'documentSha256',
      'submissionToken',length_record->>'submissionToken','submissionTokenSha256',length_record->>'submissionTokenSha256',
      'attemptId',length_record->>'attemptId','state',length_record->>'state','submissionCount',length_record->'submissionCount',
      'acceptanceSha256',length_record->'acceptanceSha256','replayed',true);
    request_hash:=length_record->>'requestSha256'; attempt_id:=length_record->>'attemptId';
  END IF;
  IF checkpoint IN ('V2-10','V2-12') AND admission IS NULL THEN
    -- V2-11 has no admission object; it consumes only two distinct owned scopes.
    NULL;
  END IF;
  retained:=jsonb_build_object('mage',NULL,'soulx',NULL);
  SELECT jsonb_build_object('mage',mage.volume_id_sha256,'soulx',soulx.volume_id_sha256)
    INTO retained FROM public.serverless_endpoint_deployments mage
    JOIN public.serverless_endpoint_deployments soulx ON soulx.id=promotion.soulx_deployment_id
   WHERE mage.id=promotion.mage_deployment_id AND mage.volume_id_sha256 IS NOT NULL
     AND soulx.volume_id_sha256 IS NOT NULL;
  IF retained->>'mage' IS NULL OR retained->>'soulx' IS NULL THEN
    RAISE EXCEPTION 'V213 JIT retained volume binding unavailable' USING ERRCODE='42501';
  END IF;
  primary_identity:=jsonb_build_object('accountId',primary_row.account_id,'workspaceId',primary_row.workspace_id,
    'projectId',primary_row.project_id,'projectRevisionId',primary_row.project_revision_id);
  scope_request_hash:=coalesce(request_hash,
    'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(jsonb_build_object(
      'checkpoint',checkpoint,'accountId',primary_row.account_id,'workspaceId',primary_row.workspace_id,
      'projectId',primary_row.project_id,'projectRevisionId',primary_row.project_revision_id)),'UTF8')),'hex'));
  scopes:=jsonb_build_array(primary_identity||jsonb_build_object('attemptId',coalesce(attempt_id,'v211-'||primary_request.id::text),
    'requestSha256',scope_request_hash));
  IF checkpoint='V2-11' THEN
    second_identity:=jsonb_build_object('accountId',secondary_row.account_id,'workspaceId',secondary_row.workspace_id,
      'projectId',secondary_row.project_id,'projectRevisionId',secondary_row.project_revision_id);
    scopes:=scopes||jsonb_build_array(second_identity||jsonb_build_object('attemptId','v211-'||secondary_request.id::text,
      'requestSha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(second_identity),'UTF8')),'hex')));
  END IF;
  execution_id:='v213-'||lower(replace(checkpoint,'-',''))||'-'||primary_request.id::text;
  workflow_id:='v213-'||lower(checkpoint)||'-'||execution_id;
  request:=jsonb_build_object('approvalRecordSha256',authority.approval_sha256,'authoritySha256',authority.authority_document_sha256,
    'billingBaselineMicroUsd',coalesce((SELECT billing_baseline_micro_usd FROM public.hosted_v209_short_admissions WHERE generation_request_id=primary_request.id),0),
    'checkpoint',checkpoint,'cumulativeLedgerSha256',promotion.migration_ledger_sha256,
    'cumulativeLedgerSpentBeforeMicroUsd',0,'executorSha256',authority.executor_sha256,'executionId',execution_id,
    'maximumCumulativeVariableCostMicroUsd',17500000,'maximumVariableCostMicroUsd',CASE WHEN checkpoint='V2-11' THEN 4000000 ELSE 2000000 END,
    'noRedispatch',true,'promotionDecisionSha256',promotion.decision_sha256,'retainedVolumeIdSha256s',retained,
    'scopes',scopes,'sourceCommit',authority.source_commit,'proposalSha256',authority.proposal_sha256);
  IF checkpoint='V2-10' OR checkpoint='V2-12' THEN
    call:=jsonb_build_object('admission',admission,'request',request);
  ELSIF checkpoint='V2-13' THEN
    SELECT max(completed_at) INTO cutoff FROM public.hosted_full_live_acceptance_results r
      JOIN public.hosted_full_live_acceptance_claims c ON c.id=r.claim_id
      JOIN public.hosted_full_live_acceptance_authorities aa ON aa.id=c.acceptance_authority_id
      JOIN public.hosted_full_live_workflow_start_authorities wa ON wa.id=aa.workflow_start_authority_id
     WHERE wa.full_live_authority_id=full_authority AND aa.checkpoint IN ('V2-10','V2-11','V2-12');
    IF cutoff IS NULL THEN RAISE EXCEPTION 'V213 JIT V2-13 predecessors are not durably complete' USING ERRCODE='42501'; END IF;
    IF (prior->>'v2-09-short-hosted-project') IS NULL OR (prior->>'v2-10-operator-free-ranga-pilot') IS NULL
       OR (prior->>'v2-11-two-concurrent-owned-projects') IS NULL OR (prior->>'v2-12-long-output') IS NULL THEN
      RAISE EXCEPTION 'V213 JIT V2-13 predecessor evidence is incomplete' USING ERRCODE='42501';
    END IF;
    SELECT jsonb_object_agg(e.document->>'gate',e.document) INTO evidence_artifacts
      FROM public.hosted_full_live_signed_evidence e
     WHERE e.kind='RELEASE' AND e.recorded_at>=cutoff AND e.document->>'gate' IS NOT NULL;
    SELECT e.document INTO chrome_document FROM public.hosted_full_live_signed_evidence e
     WHERE e.kind='CHROME' AND e.recorded_at>=cutoff ORDER BY e.recorded_at DESC LIMIT 1;
    SELECT coalesce(e.document->'releaseIdentity',e.document->'evidence'->'releaseIdentity') INTO release_identity
      FROM public.hosted_full_live_signed_evidence e
     WHERE e.kind='RELEASE' AND e.recorded_at>=cutoff
       AND (e.document->'releaseIdentity' IS NOT NULL OR e.document->'evidence'->'releaseIdentity' IS NOT NULL)
     ORDER BY e.recorded_at DESC LIMIT 1;
    IF evidence_artifacts IS NULL OR jsonb_object_length(evidence_artifacts)<15
       OR chrome_document IS NULL OR jsonb_typeof(chrome_document)<>'object'
       OR jsonb_object_length(chrome_document)=0 OR release_identity IS NULL
       OR jsonb_typeof(release_identity)<>'object'
       OR release_identity->>'sourceCommit'<>authority.source_commit
       OR release_identity->>'deployedSourceCommit' IS NULL
       OR release_identity->>'contractBundleSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'V213 JIT V2-13 signed current-run evidence is incomplete' USING ERRCODE='42501';
    END IF;
    call:=jsonb_build_object('chromeArtifact',jsonb_build_object('rawEvidence',chrome_document),
      'evidenceArtifacts',evidence_artifacts,'releaseIdentity',release_identity,'request',request);
  ELSE
    call:=jsonb_build_object('request',request);
  END IF;
  child_expires_at:=least(start_authority.expires_at,db_now+interval '15 minutes');
  IF child_expires_at<=db_now THEN RAISE EXCEPTION 'V213 JIT child authority expired' USING ERRCODE='42501'; END IF;
  document:=jsonb_build_object('schemaVersion','videoforge.v213-hosted-acceptance-command/v1',
    'commandId',supplied->>'commandId','stageAuthorityId',full_authority,'command',command,'checkpoint',checkpoint,
    'workflowId',workflow_id,'attemptId',workflow_id||'-attempt') || primary_identity || jsonb_build_object(
    'requestSha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(jsonb_build_object(
      'command',command,'checkpoint',checkpoint,'workflowId',workflow_id,'attemptId',workflow_id||'-attempt',
      'accountId',primary_row.account_id,'workspaceId',primary_row.workspace_id,'projectId',primary_row.project_id,
      'projectRevisionId',primary_row.project_revision_id,'outerStateSha256',supplied->>'outerStateSha256')),'UTF8')),'hex'),
    'outerStateSha256',supplied->>'outerStateSha256'));
  execution:=jsonb_build_object('schemaVersion','videoforge.v213-database-acceptance-execution/v1','checkpoint',checkpoint,
    'workflowId',workflow_id,'workflowParams','{}'::jsonb,'call',call,'pollIntervalMs',500,
    'deadlineAt',to_char(child_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_authorities
   WHERE workflow_start_authority_id=start_authority.id AND checkpoint=checkpoint;
  IF existing.id IS NOT NULL THEN
    IF existing.command_id<>document->>'commandId' OR existing.request_sha256<>document->>'requestSha256'
       OR existing.request_document IS DISTINCT FROM document OR existing.execution_document IS DISTINCT FROM execution
       OR existing.expires_at<>child_expires_at THEN
      RAISE EXCEPTION 'V213 JIT acceptance authority replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('document',existing.request_document,'execution',existing.execution_document,
      'expiresAt',to_char(existing.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'tokenSha256',start_authority.token_sha256);
  END IF;
  PERFORM public.videoforge_record_v213_acceptance_authority(jsonb_build_object('document',document,
    'execution',execution,'expiresAt',to_char(child_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'tokenSha256',start_authority.token_sha256));
  RETURN jsonb_build_object('document',document,'execution',execution,
    'expiresAt',to_char(child_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'tokenSha256',start_authority.token_sha256);
END;
$$;
*/

CREATE FUNCTION public.videoforge_read_v213_materialization_readback(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE challenge public.hosted_full_live_materialization_challenges%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; existing public.hosted_full_live_materialization_readbacks%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['challengeId','challengeSha256','factsSha256','materializationSha256','selectionSha256']::text[]
     OR supplied->>'challengeId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'challengeSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'factsSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'selectionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'materializationSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 materialization readback invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO challenge FROM public.hosted_full_live_materialization_challenges
   WHERE id=(supplied->>'challengeId')::uuid AND challenge_sha256=supplied->>'challengeSha256';
  SELECT * INTO facts FROM public.hosted_full_live_materialization_facts WHERE challenge_id=challenge.id;
  IF challenge.id IS NULL OR facts.challenge_id IS NULL OR facts.facts_sha256<>supplied->>'factsSha256'
     OR facts.selection_sha256<>supplied->>'selectionSha256' THEN
    RAISE EXCEPTION 'V213 materialization readback facts drift' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_materialization_readbacks WHERE challenge_id=challenge.id;
  IF existing.challenge_id IS NOT NULL THEN
    IF existing.selection_sha256<>supplied->>'selectionSha256' OR existing.facts_sha256<>supplied->>'factsSha256'
       OR existing.materialization_sha256<>supplied->>'materializationSha256' THEN
      RAISE EXCEPTION 'V213 materialization readback replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_materialization_readbacks(challenge_id,selection_sha256,facts_sha256,materialization_sha256)
      VALUES(challenge.id,supplied->>'selectionSha256',supplied->>'factsSha256',supplied->>'materializationSha256');
  END IF;
  RETURN jsonb_build_object('readbackVerified',true,'challengeId',challenge.id,
    'materializationSha256',supplied->>'materializationSha256','factsSha256',facts.facts_sha256);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_issue_v213_materialization_challenge(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_materialization_challenge(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_submit_v213_materialization_selection(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v213_materialization_selection(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v213_materialization_challenge(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_materialization_readback(jsonb) FROM PUBLIC;

-- Supersede the earlier hand-built acceptance draft. Operation 16 records only the four exact
-- role-scoped, owner-selected identities and their single current generation request IDs. It does
-- not require or synthesize V2-09 admissions, lane batches, later gate evidence, or Chrome facts.
CREATE OR REPLACE FUNCTION public.videoforge_complete_v213_materialization_challenge(supplied jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  challenge public.hosted_full_live_materialization_challenges%ROWTYPE;
  facts_row public.hosted_full_live_materialization_facts%ROWTYPE;
  primary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  waiter_row public.hosted_full_live_materialization_selections%ROWTYPE;
  secondary_row public.hosted_full_live_materialization_selections%ROWTYPE;
  fairness_row public.hosted_full_live_materialization_selections%ROWTYPE;
  primary_request public.generation_requests%ROWTYPE;
  waiter_request public.generation_requests%ROWTYPE;
  secondary_request public.generation_requests%ROWTYPE;
  fairness_request public.generation_requests%ROWTYPE;
  selection jsonb; facts jsonb; facts_hash text;
  primary_count integer; secondary_count integer; fairness_count integer;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['challengeId','challengeSha256','selection','selectionSha256']::text[]
     OR supplied->>'challengeId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'challengeSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'selectionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'selection')<>'object' THEN
    RAISE EXCEPTION 'V213 materialization facts request invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO challenge FROM public.hosted_full_live_materialization_challenges
   WHERE id=(supplied->>'challengeId')::uuid
     AND challenge_sha256=supplied->>'challengeSha256' FOR UPDATE;
  IF challenge.id IS NULL OR challenge.expires_at<=transaction_timestamp() THEN
    RAISE EXCEPTION 'V213 materialization facts challenge unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO facts_row FROM public.hosted_full_live_materialization_facts
   WHERE challenge_id=challenge.id;
  IF facts_row.challenge_id IS NOT NULL THEN
    IF facts_row.selection_sha256<>supplied->>'selectionSha256' THEN
      RAISE EXCEPTION 'V213 materialization facts replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('facts',facts_row.facts_document,'factsSha256',facts_row.facts_sha256);
  END IF;
  SELECT * INTO primary_row FROM public.hosted_full_live_materialization_selections
   WHERE challenge_id=challenge.id AND role='primary';
  SELECT * INTO waiter_row FROM public.hosted_full_live_materialization_selections
   WHERE challenge_id=challenge.id AND role='sameAccountWaiter';
  SELECT * INTO secondary_row FROM public.hosted_full_live_materialization_selections
   WHERE challenge_id=challenge.id AND role='secondary';
  SELECT * INTO fairness_row FROM public.hosted_full_live_materialization_selections
   WHERE challenge_id=challenge.id AND role='fairnessProbe';
  selection:=jsonb_build_object('primary',primary_row.identity_document,
    'sameAccountWaiter',waiter_row.identity_document,
    'secondary',secondary_row.identity_document,'fairnessProbe',fairness_row.identity_document);
  IF primary_row.challenge_id IS NULL OR waiter_row.challenge_id IS NULL
     OR secondary_row.challenge_id IS NULL
     OR fairness_row.challenge_id IS NULL
     OR waiter_row.account_id<>primary_row.account_id
     OR waiter_row.workspace_id<>primary_row.workspace_id
     OR waiter_row.project_id<>primary_row.project_id
     OR waiter_row.project_revision_id<>primary_row.project_revision_id
     OR waiter_row.project_id IN (secondary_row.project_id,fairness_row.project_id)
     OR primary_row.account_id IN (secondary_row.account_id,fairness_row.account_id)
     OR secondary_row.account_id=fairness_row.account_id
     OR primary_row.workspace_id IN (secondary_row.workspace_id,fairness_row.workspace_id)
     OR secondary_row.workspace_id=fairness_row.workspace_id
     OR primary_row.project_id IN (secondary_row.project_id,fairness_row.project_id)
     OR secondary_row.project_id=fairness_row.project_id
     OR supplied->'selection' IS DISTINCT FROM selection
     OR ('sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(selection),'UTF8')),'hex'))<>supplied->>'selectionSha256' THEN
    RAISE EXCEPTION 'V213 materialization facts selection mismatch' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO primary_count FROM public.generation_requests r
   WHERE r.account_id=primary_row.account_id AND r.workspace_id=primary_row.workspace_id
     AND r.project_id=primary_row.project_id AND r.project_revision_id=primary_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
  SELECT count(*) INTO secondary_count FROM public.generation_requests r
   WHERE r.account_id=secondary_row.account_id AND r.workspace_id=secondary_row.workspace_id
     AND r.project_id=secondary_row.project_id AND r.project_revision_id=secondary_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
  SELECT count(*) INTO fairness_count FROM public.generation_requests r
   WHERE r.account_id=fairness_row.account_id AND r.workspace_id=fairness_row.workspace_id
     AND r.project_id=fairness_row.project_id AND r.project_revision_id=fairness_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
  IF primary_count<>2 OR secondary_count<>1 OR fairness_count<>1 THEN
    RAISE EXCEPTION 'V213 materialization current request identity ambiguous' USING ERRCODE='21000';
  END IF;
  SELECT * INTO primary_request FROM public.generation_requests r
   WHERE r.account_id=primary_row.account_id AND r.workspace_id=primary_row.workspace_id
     AND r.project_id=primary_row.project_id AND r.project_revision_id=primary_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT')
   ORDER BY r.created_at,r.id LIMIT 1;
  SELECT * INTO waiter_request FROM public.generation_requests r
   WHERE r.account_id=waiter_row.account_id AND r.workspace_id=waiter_row.workspace_id
     AND r.project_id=waiter_row.project_id AND r.project_revision_id=waiter_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT')
   ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
  SELECT * INTO secondary_request FROM public.generation_requests r
   WHERE r.account_id=secondary_row.account_id AND r.workspace_id=secondary_row.workspace_id
     AND r.project_id=secondary_row.project_id AND r.project_revision_id=secondary_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
  SELECT * INTO fairness_request FROM public.generation_requests r
   WHERE r.account_id=fairness_row.account_id AND r.workspace_id=fairness_row.workspace_id
     AND r.project_id=fairness_row.project_id AND r.project_revision_id=fairness_row.project_revision_id
     AND r.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
  IF primary_request.id=waiter_request.id
     OR waiter_request.id IN (secondary_request.id,fairness_request.id) THEN
    RAISE EXCEPTION 'V213 materialization waiter request identity ambiguous' USING ERRCODE='21000';
  END IF;
  facts:=jsonb_build_object('fullLiveAuthorityId',challenge.full_live_authority_id,
    'roleScopedIdentities',jsonb_build_object(
      'primary',primary_row.identity_document||jsonb_build_object(
        'generationRequestId',primary_request.id),
      'sameAccountWaiter',waiter_row.identity_document||jsonb_build_object(
        'generationRequestId',waiter_request.id),
      'secondary',secondary_row.identity_document||jsonb_build_object(
        'generationRequestId',secondary_request.id),
      'fairnessProbe',fairness_row.identity_document||jsonb_build_object(
        'generationRequestId',fairness_request.id)));
  facts_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(facts),'UTF8')),'hex');
  INSERT INTO public.hosted_full_live_materialization_facts(
    challenge_id,selection_sha256,facts_sha256,facts_document)
  VALUES(challenge.id,supplied->>'selectionSha256',facts_hash,facts);
  RETURN jsonb_build_object('facts',facts,'factsSha256',facts_hash);
END;
$$;

-- The Worker may resolve a render manifest only through one fresh, single-use request that is
-- already bound to the exact current-run JIT intent. It receives no table or R2 credential access.
CREATE TABLE public.hosted_full_live_manifest_read_claims (
  request_sha256 text PRIMARY KEY CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  nonce_sha256 text NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN (
    'v2-09-short-hosted-project','v2-10-operator-free-ranga-pilot','v2-12-long-output')),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  materialization_request_sha256 text NOT NULL
    CHECK(materialization_request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  token_sha256 text NOT NULL CHECK(token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  artifact_uri text NOT NULL CHECK(
    artifact_uri ~ '^vf-local://objects/sha256/[0-9a-f]{2}/[0-9a-f]{64}\\.json$'),
  artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY(account_id,workspace_id) REFERENCES public.workspaces(account_id,id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id)
);
CREATE TRIGGER hosted_full_live_manifest_read_claims_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_manifest_read_claims
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_manifest_read_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_manifest_read_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_manifest_read_claims_owner_only
  ON public.hosted_full_live_manifest_read_claims USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_manifest_read_claims FROM PUBLIC;

CREATE FUNCTION public.videoforge_claim_v213_resolved_render_manifest_read(supplied jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  full_authority uuid; issued timestamptz; intent public.hosted_full_live_jit_materialization_intents%ROWTYPE;
  start_authority public.hosted_full_live_workflow_start_authorities%ROWTYPE;
  stage_authority public.hosted_full_live_stage_authorities%ROWTYPE;
  reference jsonb; unsigned jsonb; expected_materialization_request_sha256 text;
  expected_request_sha256 text; expected_nonce_sha256 text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['accountId','artifactUri','fullLiveAuthorityId','issuedAt',
         'materializationRequestSha256','nonceSha256','operationId','outerStateSha256','projectId',
         'projectRevisionId','requestSha256','sha256','tokenSha256','workspaceId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'accountId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'workspaceId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'projectId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'projectRevisionId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'operationId' NOT IN (
       'v2-09-short-hosted-project','v2-10-operator-free-ranga-pilot','v2-12-long-output')
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'materializationRequestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'nonceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'artifactUri' !~
       '^vf-local://objects/sha256/[0-9a-f]{2}/[0-9a-f]{64}\\.json$' THEN
    RAISE EXCEPTION 'V213 resolved render manifest claim invalid' USING ERRCODE='42501';
  END IF;
  BEGIN issued:=(supplied->>'issuedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'V213 resolved render manifest claim time invalid' USING ERRCODE='42501';
  END;
  IF issued>db_now+interval '30 seconds' OR issued<db_now-interval '5 minutes'
     OR to_char(issued AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>supplied->>'issuedAt'
     OR substring(supplied->>'artifactUri' from 27 for 2)<>
       substring(supplied->>'sha256' from 8 for 2)
     OR substring(supplied->>'artifactUri' from 30 for 64)<>
       substring(supplied->>'sha256' from 8 for 64) THEN
    RAISE EXCEPTION 'V213 resolved render manifest claim binding invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',213));
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'nonceSha256',214));
  SELECT i.* INTO intent
    FROM public.hosted_full_live_jit_materialization_intents i
    JOIN public.hosted_full_live_authorities a ON a.id=i.full_live_authority_id
    JOIN public.hosted_full_live_promotions p ON p.authority_id=a.id
   WHERE i.full_live_authority_id=full_authority
     AND i.operation_id=supplied->>'operationId'
     AND i.outer_state_sha256=supplied->>'outerStateSha256'
     AND a.expires_at>db_now
     AND a.source_commit=(a.authority_document->>'sourceCommit')
     AND a.proposal_sha256=(a.authority_document->>'proposalSha256')
     AND a.executor_sha256=(a.authority_document->>'executorSha256')
   FOR SHARE OF i,a,p;
  SELECT w.* INTO start_authority
    FROM public.hosted_full_live_workflow_start_authorities w
   WHERE w.full_live_authority_id=full_authority
     AND w.token_sha256=supplied->>'tokenSha256' AND w.expires_at>db_now
   FOR SHARE;
  SELECT s.* INTO stage_authority
    FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    JOIN public.hosted_full_live_stage_completions completed ON completed.authority_id=s.authority_id
   WHERE s.full_live_authority_id=full_authority AND s.stage='production'
     AND s.authority_id=intent.stage_authority_id AND s.expires_at>db_now
   FOR SHARE OF s,c,completed;
  IF intent.full_live_authority_id IS NULL OR start_authority.id IS NULL
     OR stage_authority.authority_id IS NULL THEN
    RAISE EXCEPTION 'V213 resolved render manifest authority unavailable' USING ERRCODE='42501';
  END IF;
  expected_materialization_request_sha256:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(jsonb_build_object(
      'fullLiveAuthorityId',full_authority::text,'operationId',intent.operation_id,
      'commandId',intent.command_id,'stageAuthorityId',intent.stage_authority_id,
      'outerStateSha256',intent.outer_state_sha256)),'UTF8')),'hex');
  reference:=intent.candidate_document->'renderPlanReference';
  IF jsonb_typeof(reference)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(reference) key)
       IS DISTINCT FROM ARRAY['accountId','artifactUri','fullLiveAuthorityId','issuedAt',
         'materializationRequestSha256','nonce','operationId','outerStateSha256','projectId',
         'projectRevisionId','sha256','workspaceId']::text[]
     OR reference->>'fullLiveAuthorityId'<>full_authority::text
     OR reference->>'operationId'<>intent.operation_id
     OR reference->>'outerStateSha256'<>intent.outer_state_sha256
     OR reference->>'materializationRequestSha256'<>expected_materialization_request_sha256
     OR reference->>'materializationRequestSha256'<>supplied->>'materializationRequestSha256'
     OR reference->>'accountId'<>supplied->>'accountId'
     OR reference->>'workspaceId'<>supplied->>'workspaceId'
     OR reference->>'projectId'<>supplied->>'projectId'
     OR reference->>'projectRevisionId'<>supplied->>'projectRevisionId'
     OR reference->>'artifactUri'<>supplied->>'artifactUri'
     OR reference->>'sha256'<>supplied->>'sha256'
     OR reference->>'issuedAt'<>supplied->>'issuedAt'
     OR reference->>'nonce' IS NULL THEN
    RAISE EXCEPTION 'V213 resolved render manifest projection drift' USING ERRCODE='23514';
  END IF;
  expected_nonce_sha256:='sha256:'||encode(sha256(convert_to(reference->>'nonce','UTF8')),'hex');
  unsigned:=jsonb_build_object('schemaVersion','videoforge.v213-resolved-render-manifest-read/v1',
    'fullLiveAuthorityId',full_authority::text,'operationId',intent.operation_id,
    'outerStateSha256',intent.outer_state_sha256,
    'materializationRequestSha256',expected_materialization_request_sha256,
    'accountId',supplied->>'accountId','workspaceId',supplied->>'workspaceId',
    'projectId',supplied->>'projectId','projectRevisionId',supplied->>'projectRevisionId',
    'artifactUri',supplied->>'artifactUri','sha256',supplied->>'sha256',
    'issuedAt',supplied->>'issuedAt','nonce',reference->>'nonce');
  expected_request_sha256:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(unsigned),'UTF8')),'hex');
  IF expected_nonce_sha256<>supplied->>'nonceSha256'
     OR expected_request_sha256<>supplied->>'requestSha256'
     OR EXISTS(SELECT 1 FROM public.hosted_full_live_manifest_read_claims
       WHERE request_sha256=supplied->>'requestSha256' OR nonce_sha256=supplied->>'nonceSha256') THEN
    RAISE EXCEPTION 'V213 resolved render manifest replay or hash drift' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.hosted_full_live_manifest_read_claims(request_sha256,nonce_sha256,
    full_live_authority_id,operation_id,outer_state_sha256,materialization_request_sha256,
    token_sha256,account_id,workspace_id,project_id,project_revision_id,artifact_uri,
    artifact_sha256,issued_at)
  VALUES(supplied->>'requestSha256',supplied->>'nonceSha256',full_authority,intent.operation_id,
    intent.outer_state_sha256,expected_materialization_request_sha256,supplied->>'tokenSha256',
    (supplied->>'accountId')::uuid,(supplied->>'workspaceId')::uuid,
    (supplied->>'projectId')::uuid,(supplied->>'projectRevisionId')::uuid,
    supplied->>'artifactUri',supplied->>'sha256',issued);
  RETURN jsonb_build_object('claimed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_resolved_render_manifest_read(jsonb) FROM PUBLIC;

-- Final JIT authority model. The old materializer depended on later evidence and an expiring
-- production-stage child, so it is intentionally removed. Each operation below gets a new
-- database-minted, at-most-fifteen-minute token whose direct parent is the durable full-live
-- authority. The already-consumed production stage remains immutable lineage only.
DROP FUNCTION IF EXISTS public.videoforge_materialize_v213_acceptance_authority(jsonb);

CREATE TABLE public.hosted_full_live_jit_operation_authorities (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN (
    'v2-09-short-hosted-project','v2-10-operator-free-ranga-pilot',
    'v2-11-two-concurrent-owned-projects','v2-12-long-output',
    'v2-13-final-two-lane-smoke')),
  checkpoint text NOT NULL CHECK(checkpoint IN ('V2-09','V2-10','V2-11','V2-12','V2-13')),
  command_id text NOT NULL CHECK(command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
  production_stage_authority_id text NOT NULL
    REFERENCES public.hosted_full_live_stage_authorities(authority_id),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  command_payload jsonb NOT NULL CHECK(jsonb_typeof(command_payload)='object'),
  predecessor_evidence_sha256s jsonb NOT NULL
    CHECK(jsonb_typeof(predecessor_evidence_sha256s)='object'),
  materialization_request_sha256 text NOT NULL
    CHECK(materialization_request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  intent_sha256 text NOT NULL UNIQUE CHECK(intent_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  candidate_sha256 text NOT NULL CHECK(candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  candidate_document jsonb NOT NULL CHECK(jsonb_typeof(candidate_document)='object'),
  token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  workload_deadline_at timestamptz NOT NULL,
  poll_interval_ms integer NOT NULL CHECK(poll_interval_ms BETWEEN 250 AND 10000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id),
  UNIQUE(full_live_authority_id,checkpoint),
  UNIQUE(full_live_authority_id,command_id),
  CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '15 minutes'),
  CHECK(workload_deadline_at>issued_at AND workload_deadline_at<=issued_at+interval '60 minutes')
);
CREATE TRIGGER hosted_full_live_jit_operation_authorities_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_jit_operation_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_jit_operation_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_jit_operation_authorities FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_jit_operation_authorities_owner_only
  ON public.hosted_full_live_jit_operation_authorities USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_jit_operation_authorities FROM PUBLIC;

CREATE FUNCTION public.videoforge_v213_jit_sha256(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(value),'UTF8')),'hex')
$$;

CREATE FUNCTION public.videoforge_v213_jit_iso(value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
  SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE FUNCTION public.videoforge_v213_jit_operation_evidence_exists(
  supplied_full_live_authority_id uuid, supplied_operation_id text, supplied_sha256 text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT CASE supplied_operation_id
    WHEN 'v2-09-short-hosted-project' THEN EXISTS(
      SELECT 1
      FROM public.hosted_v209_terminal_acceptances terminal
      JOIN public.hosted_full_live_materialization_facts facts
        ON facts.facts_document#>>'{roleScopedIdentities,primary,generationRequestId}'=
           terminal.generation_request_id::text
      JOIN public.hosted_full_live_materialization_challenges challenge
        ON challenge.id=facts.challenge_id
      WHERE challenge.full_live_authority_id=supplied_full_live_authority_id
        AND terminal.result_sha256=supplied_sha256)
    ELSE EXISTS(
      SELECT 1
      FROM public.hosted_full_live_acceptance_results result
      JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
      JOIN public.hosted_full_live_acceptance_authorities authority
        ON authority.id=claim.acceptance_authority_id
      WHERE authority.full_live_authority_id=supplied_full_live_authority_id
        AND authority.checkpoint=CASE supplied_operation_id
          WHEN 'v2-10-operator-free-ranga-pilot' THEN 'V2-10'
          WHEN 'v2-11-two-concurrent-owned-projects' THEN 'V2-11'
          WHEN 'v2-12-long-output' THEN 'V2-12'
          WHEN 'v2-13-final-two-lane-smoke' THEN 'V2-13'
          ELSE '__invalid__' END
        AND result.state='COMPLETED' AND result.evidence_sha256=supplied_sha256)
  END
$$;

CREATE FUNCTION public.videoforge_v213_jit_deployment(value uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object(
    'deploymentId',deployment.id,'lane',deployment.lane,
    'endpointProfileId',deployment.endpoint_profile_id,
    'endpointIdSha256',deployment.endpoint_id_sha256,
    'endpointConfigSha256',deployment.endpoint_config_sha256,
    'workerImageDigest',deployment.worker_image_digest,
    'modelManifestSha256',deployment.model_manifest_sha256,
    'volumeIdSha256',deployment.volume_id_sha256,
    'volumeManifestSha256',deployment.volume_manifest_sha256,
    'idleTimeoutSeconds',deployment.idle_timeout_seconds,
    'initTimeoutSeconds',deployment.init_timeout_seconds,
    'executionTimeoutSeconds',deployment.execution_timeout_seconds,
    'requestTtlSeconds',deployment.request_ttl_seconds,
    'reconciliationDeadlineSeconds',deployment.reconciliation_deadline_seconds,
    'pollingIntervalSeconds',deployment.polling_interval_seconds,
    'maxReplacementAttempts',deployment.max_replacement_attempts,
    'timeoutEvidence',deployment.timeout_evidence,
    'deploymentVersion',deployment.deployment_version,
    'createdAt',public.videoforge_v213_jit_iso(deployment.created_at))
  FROM public.serverless_endpoint_deployments deployment WHERE deployment.id=value
$$;

CREATE FUNCTION public.videoforge_prepare_v213_jit_operation(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); full_authority uuid;
  authority public.hosted_full_live_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE;
  stage public.hosted_full_live_stage_authorities%ROWTYPE;
  existing public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE;
  operation text:=supplied->>'command'; checkpoint text:=supplied->>'checkpoint';
  expected_checkpoint text; expected_predecessors text[]; actual_predecessors text[];
  primary_identity jsonb; secondary_identity jsonb; role_identities jsonb;
  render_plan public.hosted_render_plans%ROWTYPE; manifest jsonb; reference jsonb;
  materialization_request jsonb; materialization_request_sha text;
  request jsonb; scopes jsonb; candidate jsonb; candidate_sha text;
  retained jsonb; record jsonb; short_document jsonb; production_document jsonb;
  token_sha text; issued timestamptz:=db_now; child_expiry timestamptz; workload_deadline timestamptz;
  intent_unsigned jsonb; intent_sha text; nonce text;
  primary_request_id uuid; secondary_request_id uuid;
BEGIN
  expected_checkpoint:=CASE operation
    WHEN 'v2-09-short-hosted-project' THEN 'V2-09'
    WHEN 'v2-10-operator-free-ranga-pilot' THEN 'V2-10'
    WHEN 'v2-11-two-concurrent-owned-projects' THEN 'V2-11'
    WHEN 'v2-12-long-output' THEN 'V2-12'
    WHEN 'v2-13-final-two-lane-smoke' THEN 'V2-13' END;
  expected_predecessors:=CASE operation
    WHEN 'v2-09-short-hosted-project' THEN ARRAY[]::text[]
    WHEN 'v2-10-operator-free-ranga-pilot' THEN ARRAY['v2-09-short-hosted-project']
    WHEN 'v2-11-two-concurrent-owned-projects' THEN
      ARRAY['v2-09-short-hosted-project','v2-10-operator-free-ranga-pilot']
    WHEN 'v2-12-long-output' THEN ARRAY['v2-09-short-hosted-project',
      'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects']
    WHEN 'v2-13-final-two-lane-smoke' THEN ARRAY['v2-09-short-hosted-project',
      'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
      'v2-12-long-output'] END;
  SELECT COALESCE(array_agg(key ORDER BY key),'{}'::text[]) INTO actual_predecessors
    FROM jsonb_object_keys(supplied->'predecessorEvidenceSha256s') key;
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['checkpoint','command','commandId','commandPayload',
         'fullLiveAuthorityId','outerStateSha256','predecessorEvidenceSha256s']::text[]
     OR expected_checkpoint IS NULL OR checkpoint<>expected_checkpoint
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (supplied->>'commandId')<>
        ('v213:'||(supplied->>'fullLiveAuthorityId')||':'||operation)
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'commandPayload')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'commandPayload') key)
       IS DISTINCT FROM ARRAY['accountId','projectId','projectRevisionId','workspaceId']::text[]
     OR actual_predecessors IS DISTINCT FROM
        (SELECT COALESCE(array_agg(value ORDER BY value),'{}'::text[]) FROM unnest(expected_predecessors) value)
     OR EXISTS(SELECT 1 FROM jsonb_each_text(supplied->'predecessorEvidenceSha256s') value
       WHERE value.value !~ '^sha256:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'V213 JIT prepare input invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(full_authority::text||':'||operation,213));
  SELECT * INTO existing FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=full_authority AND operation_id=operation;
  IF existing.operation_id IS NOT NULL THEN
    IF existing.checkpoint<>checkpoint OR existing.command_id<>supplied->>'commandId'
       OR existing.outer_state_sha256<>supplied->>'outerStateSha256'
       OR existing.command_payload IS DISTINCT FROM supplied->'commandPayload'
       OR existing.predecessor_evidence_sha256s IS DISTINCT FROM
          supplied->'predecessorEvidenceSha256s' THEN
      RAISE EXCEPTION 'V213 JIT prepare replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('checkpoint',existing.checkpoint,
      'intentSha256',existing.intent_sha256,'operationId',existing.operation_id,
      'productionStageAuthorityId',existing.production_stage_authority_id);
  END IF;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=full_authority FOR SHARE;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions
   WHERE authority_id=full_authority FOR SHARE;
  SELECT stage_row.* INTO stage FROM public.hosted_full_live_stage_authorities stage_row
   JOIN public.hosted_full_live_stage_consumptions consumed
     ON consumed.authority_id=stage_row.authority_id
   JOIN public.hosted_full_live_stage_completions completed
     ON completed.authority_id=stage_row.authority_id
   WHERE stage_row.full_live_authority_id=full_authority AND stage_row.stage='production' FOR SHARE;
  SELECT facts_row.* INTO facts FROM public.hosted_full_live_materialization_facts facts_row
   JOIN public.hosted_full_live_materialization_challenges challenge
     ON challenge.id=facts_row.challenge_id
   WHERE challenge.full_live_authority_id=full_authority
     AND challenge.challenge_document->>'outerStateSha256'=supplied->>'outerStateSha256' FOR SHARE;
  IF authority.id IS NULL OR authority.expires_at<=db_now OR promotion.id IS NULL
     OR stage.authority_id IS NULL OR facts.challenge_id IS NULL
     OR facts.facts_document->>'fullLiveAuthorityId'<>full_authority::text
     OR jsonb_typeof(facts.facts_document->'roleScopedIdentities')<>'object' THEN
    RAISE EXCEPTION 'V213 JIT durable authority or materialization unavailable' USING ERRCODE='42501';
  END IF;
  role_identities:=facts.facts_document->'roleScopedIdentities';
  primary_identity:=role_identities->'primary'; secondary_identity:=role_identities->'secondary';
  IF supplied->'commandPayload' IS DISTINCT FROM (primary_identity-'generationRequestId') THEN
    RAISE EXCEPTION 'V213 JIT command identity drift' USING ERRCODE='23514';
  END IF;
  primary_request_id:=(primary_identity->>'generationRequestId')::uuid;
  secondary_request_id:=(secondary_identity->>'generationRequestId')::uuid;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(supplied->'predecessorEvidenceSha256s') prior
    WHERE NOT public.videoforge_v213_jit_operation_evidence_exists(
      full_authority,prior.key,prior.value)) THEN
    RAISE EXCEPTION 'V213 JIT predecessor evidence unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO render_plan FROM public.hosted_render_plans plan
   WHERE plan.account_id=(primary_identity->>'accountId')::uuid
     AND plan.workspace_id=(primary_identity->>'workspaceId')::uuid
     AND plan.project_id=(primary_identity->>'projectId')::uuid
     AND plan.project_revision_id=(primary_identity->>'projectRevisionId')::uuid;
  IF operation IN ('v2-09-short-hosted-project','v2-10-operator-free-ranga-pilot',
       'v2-12-long-output') AND render_plan.project_revision_id IS NULL THEN
    RAISE EXCEPTION 'V213 JIT render plan unavailable' USING ERRCODE='42501';
  END IF;
  nonce:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  materialization_request:=jsonb_build_object('fullLiveAuthorityId',full_authority::text,
    'operationId',operation,'commandId',supplied->>'commandId',
    'stageAuthorityId',stage.authority_id,'outerStateSha256',supplied->>'outerStateSha256');
  materialization_request_sha:=public.videoforge_v213_jit_sha256(materialization_request);
  IF render_plan.project_revision_id IS NOT NULL THEN
    manifest:=render_plan.payload#>'{input_document,resolved_render_manifest}';
    reference:=jsonb_build_object('fullLiveAuthorityId',full_authority::text,
      'operationId',operation,'outerStateSha256',supplied->>'outerStateSha256',
      'materializationRequestSha256',materialization_request_sha,
      'accountId',primary_identity->>'accountId','workspaceId',primary_identity->>'workspaceId',
      'projectId',primary_identity->>'projectId','projectRevisionId',primary_identity->>'projectRevisionId',
      'artifactUri',manifest->>'artifact_uri','sha256',manifest->>'sha256',
      'issuedAt',public.videoforge_v213_jit_iso(issued),'nonce',nonce);
    IF manifest->>'artifact_uri' !~
         '^vf-local://objects/sha256/[0-9a-f]{2}/[0-9a-f]{64}\\.json$'
       OR manifest->>'sha256' !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'V213 JIT render plan reference invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT jsonb_build_object('mage',mage.volume_id_sha256,'soulx',soulx.volume_id_sha256)
    INTO retained FROM public.serverless_endpoint_deployments mage
    JOIN public.serverless_endpoint_deployments soulx ON soulx.id=promotion.soulx_deployment_id
   WHERE mage.id=promotion.mage_deployment_id;
  scopes:=jsonb_build_array((primary_identity-'generationRequestId')||jsonb_build_object(
    'requestSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
      'operationId',operation,'generationRequestId',primary_request_id)),
    'attemptId','v213-'||checkpoint||'-'||primary_request_id::text));
  IF operation='v2-11-two-concurrent-owned-projects' THEN
    scopes:=scopes||jsonb_build_array((secondary_identity-'generationRequestId')||jsonb_build_object(
      'requestSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
        'operationId',operation,'generationRequestId',secondary_request_id)),
      'attemptId','v213-'||checkpoint||'-'||secondary_request_id::text));
  END IF;
  request:=jsonb_build_object('checkpoint',checkpoint,
    'executionId','v213-'||checkpoint||'-'||primary_request_id::text,
    'proposalSha256',authority.proposal_sha256,'authoritySha256',authority.authority_document_sha256,
    'approvalRecordSha256',authority.approval_sha256,
    'cumulativeLedgerSha256',promotion.migration_ledger_sha256,
    'executorSha256',authority.executor_sha256,'promotionDecisionSha256',promotion.decision_sha256,
    'sourceCommit',authority.source_commit,'scopes',scopes,
    'maximumVariableCostMicroUsd',CASE WHEN checkpoint='V2-11' THEN 4000000 ELSE 2000000 END,
    'maximumCumulativeVariableCostMicroUsd',17500000,
    'billingBaselineMicroUsd',COALESCE((SELECT admission.billing_baseline_micro_usd
      FROM public.hosted_v209_short_admissions admission
      WHERE admission.generation_request_id=primary_request_id),0),
    'cumulativeLedgerSpentBeforeMicroUsd',0,'retainedVolumeIdSha256s',retained,
    'noRedispatch',true);
  IF operation='v2-09-short-hosted-project' THEN
    SELECT jsonb_build_object('approvalId',approval.id,'approvalSha256',approval.approval_sha256,
      'claimId',claim.id,'accountId',approval.account_id,'workspaceId',approval.workspace_id,
      'projectId',approval.project_id,'projectRevisionId',approval.project_revision_id,
      'generationRequestId',approval.generation_request_id,
      'generationPlanSha256',approval.generation_plan_sha256,'leaseId',approval.lease_id,
      'laneBindings',approval.lane_bindings,'totalCapUsd',approval.maximum_cumulative_finite_cap_usd,
      'expiresAt',public.videoforge_v213_jit_iso(approval.expires_at),
      'pair',(SELECT jsonb_agg(batch.payload ORDER BY batch.batch_ordinal)
        FROM public.hosted_lane_batches batch
        WHERE batch.generation_request_id=approval.generation_request_id))
      INTO record FROM public.hosted_paid_dispatch_approvals approval
      LEFT JOIN public.hosted_paid_dispatch_claims claim ON claim.approval_id=approval.id
      WHERE approval.generation_request_id=primary_request_id;
    IF record IS NULL OR record->'claimId'='null'::jsonb OR jsonb_array_length(record->'pair')<>2 THEN
      RAISE EXCEPTION 'V213 JIT V2-09 pair authority unavailable' USING ERRCODE='42501';
    END IF;
    candidate:=jsonb_build_object('laneItemIds',jsonb_build_object(
      'mage_image',COALESCE((SELECT jsonb_agg(item.artifact_input->>'asset_id' ORDER BY item.item_ordinal)
        FROM public.hosted_lane_batches batch JOIN public.hosted_lane_batch_items item ON item.batch_id=batch.id
        WHERE batch.generation_request_id=primary_request_id AND batch.lane='mage_image'),'[]'::jsonb),
      'soulx_avatar',COALESCE((SELECT jsonb_agg(item.artifact_input->>'asset_id' ORDER BY item.item_ordinal)
        FROM public.hosted_lane_batches batch JOIN public.hosted_lane_batch_items item ON item.batch_id=batch.id
        WHERE batch.generation_request_id=primary_request_id AND batch.lane='soulx_avatar'),'[]'::jsonb)),
      'pairInput',record,'renderPlanReference',reference);
  ELSIF operation='v2-10-operator-free-ranga-pilot' THEN
    SELECT repository.record_document INTO record
      FROM public.hosted_full_live_acceptance_repository_records repository
     WHERE repository.repository='SHORT_PILOT'
       AND repository.record_document->>'accountId'=primary_identity->>'accountId'
       AND repository.record_document->>'workspaceId'=primary_identity->>'workspaceId'
       AND repository.record_document->>'projectId'=primary_identity->>'projectId'
       AND repository.record_document->>'projectRevisionId'=primary_identity->>'projectRevisionId'
     ORDER BY repository.sequence DESC LIMIT 1;
    short_document:=record->'admissionDocument';
    IF record IS NULL OR short_document IS NULL THEN
      RAISE EXCEPTION 'V213 JIT V2-10 raw groundwork unavailable' USING ERRCODE='42501';
    END IF;
    scopes:=jsonb_build_array((primary_identity-'generationRequestId')||jsonb_build_object(
      'requestSha256',record->>'requestSha256','attemptId',record->>'automaticAttemptId'));
    request:=jsonb_set(jsonb_set(request,'{scopes}',scopes),'{executionId}',
      to_jsonb('v213-V2-10-'||(record->>'automaticAttemptId')));
    candidate:=jsonb_build_object('admissionInput',jsonb_build_object(
      'accountId',primary_identity->>'accountId','workspaceId',primary_identity->>'workspaceId',
      'projectId',primary_identity->>'projectId','projectRevisionId',primary_identity->>'projectRevisionId',
      'revisionConfigSha256',short_document->>'revisionConfigSha256',
      'qualifications',jsonb_build_object(
        'mage_image',jsonb_build_object('deployment',public.videoforge_v213_jit_deployment(promotion.mage_deployment_id),
          'transportEndpointIdSha256',(SELECT endpoint_id_sha256 FROM public.serverless_endpoint_deployments WHERE id=promotion.mage_deployment_id),
          'qualificationArtifact',jsonb_build_object('fullLiveAuthorityId',full_authority,
            'qualificationId',promotion.mage_qualification_id,'lane','mage_image')),
        'soulx_avatar',jsonb_build_object('deployment',public.videoforge_v213_jit_deployment(promotion.soulx_deployment_id),
          'transportEndpointIdSha256',(SELECT endpoint_id_sha256 FROM public.serverless_endpoint_deployments WHERE id=promotion.soulx_deployment_id),
          'qualificationArtifact',jsonb_build_object('fullLiveAuthorityId',full_authority,
            'qualificationId',promotion.soulx_qualification_id,'lane','soulx_avatar'))),
      'ceiling',jsonb_build_object('maximumVariableCostMicroUsd',short_document->'maximumVariableCostMicroUsd',
        'maximumWallTimeMs',short_document->'maximumWallTimeMs'),
      'forecast',jsonb_build_object('variableCostMicroUsd',short_document->'forecastVariableCostMicroUsd',
        'wallTimeMs',short_document->'forecastWallTimeMs')),
      'renderPlanReference',reference,'request',request);
  ELSIF operation='v2-12-long-output' THEN
    SELECT repository.record_document INTO record
      FROM public.hosted_full_live_acceptance_repository_records repository
     WHERE repository.repository='PRODUCTION_LENGTH'
       AND repository.record_document#>>'{document,key,accountId}'=primary_identity->>'accountId'
       AND repository.record_document#>>'{document,key,workspaceId}'=primary_identity->>'workspaceId'
       AND repository.record_document#>>'{document,key,projectId}'=primary_identity->>'projectId'
       AND repository.record_document#>>'{document,key,projectRevisionId}'=primary_identity->>'projectRevisionId'
     ORDER BY repository.sequence DESC LIMIT 1;
    production_document:=record->'document';
    IF record IS NULL OR production_document IS NULL THEN
      RAISE EXCEPTION 'V213 JIT V2-12 raw groundwork unavailable' USING ERRCODE='42501';
    END IF;
    scopes:=jsonb_build_array((primary_identity-'generationRequestId')||jsonb_build_object(
      'requestSha256',production_document->>'requestSha256','attemptId',record->>'attemptId'));
    request:=jsonb_set(jsonb_set(request,'{scopes}',scopes),'{executionId}',
      to_jsonb('v213-V2-12-'||(record->>'attemptId')));
    candidate:=jsonb_build_object('admissionInput',jsonb_build_object(
      'accountId',primary_identity->>'accountId','workspaceId',primary_identity->>'workspaceId',
      'projectId',primary_identity->>'projectId','projectRevisionId',primary_identity->>'projectRevisionId',
      'revisionConfigSha256',production_document->>'revisionConfigSha256',
      'qualificationEvidence',jsonb_build_object('fullLiveAuthorityId',full_authority,
        'accountId',primary_identity->>'accountId','workspaceId',primary_identity->>'workspaceId',
        'projectId',primary_identity->>'projectId','projectRevisionId',primary_identity->>'projectRevisionId',
        'renderPlanSha256',render_plan.payload#>>'{input_document,resolved_render_manifest,sha256}'),
      'maximumWallTimeMs',production_document->'maximumWallTimeMs'),
      'renderPlanReference',reference,'request',request);
  ELSE
    candidate:=jsonb_build_object('request',request);
  END IF;
  candidate_sha:=public.videoforge_v213_jit_sha256(candidate);
  child_expiry:=least(authority.expires_at,db_now+interval '15 minutes');
  workload_deadline:=least(authority.expires_at,db_now+CASE operation
    WHEN 'v2-12-long-output' THEN interval '31 minutes'
    WHEN 'v2-11-two-concurrent-owned-projects' THEN interval '45 minutes'
    ELSE interval '30 minutes' END);
  IF child_expiry<=db_now THEN
    RAISE EXCEPTION 'V213 JIT child expiry unavailable' USING ERRCODE='42501';
  END IF;
  token_sha:=public.videoforge_v213_jit_sha256(jsonb_build_object(
    'authority',full_authority,'operation',operation,'nonce',gen_random_uuid()));
  intent_unsigned:=jsonb_build_object('checkpoint',checkpoint,'operationId',operation,
    'commandId',supplied->>'commandId','fullLiveAuthorityId',full_authority,
    'productionStageAuthorityId',stage.authority_id,
    'outerStateSha256',supplied->>'outerStateSha256','commandPayload',supplied->'commandPayload',
    'predecessorEvidenceSha256s',supplied->'predecessorEvidenceSha256s',
    'materializationRequestSha256',materialization_request_sha,'candidateSha256',candidate_sha,
    'tokenSha256',token_sha,'issuedAt',public.videoforge_v213_jit_iso(issued),
    'expiresAt',public.videoforge_v213_jit_iso(child_expiry));
  intent_sha:=public.videoforge_v213_jit_sha256(intent_unsigned);
  INSERT INTO public.hosted_full_live_jit_operation_authorities(
    full_live_authority_id,operation_id,checkpoint,command_id,production_stage_authority_id,
    outer_state_sha256,command_payload,predecessor_evidence_sha256s,
    materialization_request_sha256,intent_sha256,candidate_sha256,candidate_document,
    token_sha256,issued_at,expires_at,workload_deadline_at,poll_interval_ms)
  VALUES(full_authority,operation,checkpoint,supplied->>'commandId',stage.authority_id,
    supplied->>'outerStateSha256',supplied->'commandPayload',
    supplied->'predecessorEvidenceSha256s',materialization_request_sha,intent_sha,candidate_sha,
    candidate,token_sha,issued,child_expiry,workload_deadline,250);
  RETURN jsonb_build_object('checkpoint',checkpoint,'intentSha256',intent_sha,
    'operationId',operation,'productionStageAuthorityId',stage.authority_id);
END;
$$;

CREATE FUNCTION public.videoforge_project_v213_jit_operation(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE intent public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  authority public.hosted_full_live_authorities%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['commandId','fullLiveAuthorityId','operationId',
         'outerStateSha256','stageAuthorityId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'V213 JIT projection input invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO intent FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId';
  SELECT * INTO authority FROM public.hosted_full_live_authorities
   WHERE id=intent.full_live_authority_id;
  IF intent.operation_id IS NULL OR authority.expires_at<=transaction_timestamp()
     OR intent.expires_at<=transaction_timestamp()
     OR intent.command_id<>supplied->>'commandId'
     OR intent.production_stage_authority_id<>supplied->>'stageAuthorityId'
     OR intent.outer_state_sha256<>supplied->>'outerStateSha256'
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_promotions
       WHERE authority_id=authority.id) THEN
    RAISE EXCEPTION 'V213 JIT projection unavailable or drifted' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('schemaVersion','videoforge.v213-jit-operation-projection/v2',
    'operationId',intent.operation_id,'checkpoint',intent.checkpoint,
    'fullLiveAuthorityId',intent.full_live_authority_id,'commandId',intent.command_id,
    'stageAuthorityId',intent.production_stage_authority_id,
    'outerStateSha256',intent.outer_state_sha256,
    'workloadDeadlineAt',public.videoforge_v213_jit_iso(intent.workload_deadline_at),
    'predecessorEvidenceSha256s',intent.predecessor_evidence_sha256s,
    'candidateSha256',intent.candidate_sha256,'candidate',intent.candidate_document,
    'authorityBinding',jsonb_build_object('directParentAuthorityId',intent.full_live_authority_id,
      'productionStageAuthorityId',intent.production_stage_authority_id,
      'tokenSha256',intent.token_sha256,'issuedAt',public.videoforge_v213_jit_iso(intent.issued_at),
      'expiresAt',public.videoforge_v213_jit_iso(intent.expires_at)));
END;
$$;

CREATE FUNCTION public.videoforge_persist_v213_jit_materialization(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE intent public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  existing public.hosted_full_live_jit_materializations%ROWTYPE;
  readback public.hosted_full_live_jit_materialization_readbacks%ROWTYPE;
  base jsonb; request jsonb; execution jsonb; call jsonb; full_authority uuid;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['authorityBinding','callDocument','candidateSha256','checkpoint',
         'executionDocument','fullLiveAuthorityId','materializationSha256','operationId',
         'predecessorEvidenceSha256s','requestDocument','schemaVersion']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v213-jit-materialization/v1'
     OR supplied->>'materializationSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'V213 JIT materialization invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    full_authority::text||':'||(supplied->>'operationId'),215));
  SELECT * INTO intent FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=full_authority AND operation_id=supplied->>'operationId' FOR SHARE;
  request:=supplied->'requestDocument'; execution:=supplied->'executionDocument';
  call:=supplied->'callDocument'; base:=supplied-'materializationSha256';
  IF intent.operation_id IS NULL OR intent.expires_at<=transaction_timestamp()
     OR supplied->>'checkpoint'<>intent.checkpoint
     OR supplied->>'candidateSha256'<>intent.candidate_sha256
     OR supplied->'predecessorEvidenceSha256s' IS DISTINCT FROM intent.predecessor_evidence_sha256s
     OR supplied#>>'{authorityBinding,directParentAuthorityId}'<>full_authority::text
     OR supplied#>>'{authorityBinding,productionStageAuthorityId}'<>intent.production_stage_authority_id
     OR supplied#>>'{authorityBinding,tokenSha256}'<>intent.token_sha256
     OR supplied#>>'{authorityBinding,issuedAt}'<>public.videoforge_v213_jit_iso(intent.issued_at)
     OR supplied#>>'{authorityBinding,expiresAt}'<>public.videoforge_v213_jit_iso(intent.expires_at)
     OR (intent.checkpoint='V2-09' AND (
       request->>'schemaVersion'<>'videoforge.v213-hosted-v209-jit-command/v1'
       OR request->>'commandId'<>intent.command_id
       OR request->>'stageAuthorityId'<>intent.production_stage_authority_id
       OR request->>'operationId'<>intent.operation_id
       OR request->>'outerStateSha256'<>intent.outer_state_sha256
       OR (request->>'workflowId')<>('hosted-pair-'||(request->>'generationRequestId'))
       OR execution->>'schemaVersion'<>'videoforge.v213-v209-jit-execution/v1'
       OR execution->>'operationId'<>intent.operation_id
       OR execution->>'workflowId'<>request->>'workflowId'
       OR execution->'call' IS DISTINCT FROM call
       OR call->'pairInput' IS NULL OR jsonb_typeof(call->'pairInput')<>'object'))
     OR (intent.checkpoint<>'V2-09' AND (
       request->>'schemaVersion'<>'videoforge.v213-hosted-acceptance-command/v1'
       OR request->>'commandId'<>intent.command_id
       OR request->>'stageAuthorityId'<>intent.production_stage_authority_id
       OR request->>'command'<>intent.operation_id OR request->>'checkpoint'<>intent.checkpoint
       OR request->>'outerStateSha256'<>intent.outer_state_sha256
       OR execution->>'schemaVersion'<>'videoforge.v213-database-acceptance-execution/v2'
       OR execution->>'operationId'<>intent.operation_id OR execution->>'checkpoint'<>intent.checkpoint
       OR execution->>'workflowId'<>request->>'workflowId' OR execution->'call' IS DISTINCT FROM call
       OR (execution->>'workflowId')<>(
          'v213-'||lower(intent.checkpoint)||'-'||(call->'request'->>'executionId'))
       OR execution->>'workloadDeadlineAt'<>public.videoforge_v213_jit_iso(intent.workload_deadline_at)
       OR (execution->>'pollIntervalMs')::integer<>intent.poll_interval_ms
       OR execution#>>'{workflowParams,schemaVersion}'<>'videoforge.v213-acceptance-workflow-params/v1'
       OR execution#>>'{workflowParams,kind}'<>'V213_DATABASE_ACCEPTANCE'
       OR execution#>>'{workflowParams,fullLiveAuthorityId}'<>full_authority::text
       OR execution#>>'{workflowParams,operationId}'<>intent.operation_id
       OR execution#>>'{workflowParams,checkpoint}'<>intent.checkpoint
       OR execution#>>'{workflowParams,workflowId}'<>execution->>'workflowId'
       OR execution#>>'{workflowParams,requestSha256}'<>request->>'requestSha256'
       OR call->'request' IS NULL OR jsonb_typeof(call->'request')<>'object'
       OR call->'request'->>'proposalSha256'<>
          (SELECT proposal_sha256 FROM public.hosted_full_live_authorities WHERE id=full_authority)
       OR call->'request'->>'sourceCommit'<>
          (SELECT source_commit FROM public.hosted_full_live_authorities WHERE id=full_authority)))
     OR public.videoforge_v213_jit_sha256(base)<>supplied->>'materializationSha256'
     OR public.videoforge_v213_jit_sha256(request-'requestSha256')<>request->>'requestSha256'
     THEN
    RAISE EXCEPTION 'V213 JIT materialization binding invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_jit_materializations
   WHERE full_live_authority_id=full_authority AND operation_id=intent.operation_id;
  SELECT * INTO readback FROM public.hosted_full_live_jit_materialization_readbacks
   WHERE full_live_authority_id=full_authority AND operation_id=intent.operation_id;
  IF existing.operation_id IS NOT NULL THEN
    IF existing.candidate_sha256<>intent.candidate_sha256
       OR existing.request_document IS DISTINCT FROM request
       OR existing.execution_document IS DISTINCT FROM execution
       OR existing.call_document IS DISTINCT FROM call
       OR readback.materialization_sha256<>supplied->>'materializationSha256' THEN
      RAISE EXCEPTION 'V213 JIT materialization replay drift' USING ERRCODE='23505';
    END IF;
    RETURN readback.materialization_sha256;
  END IF;
  INSERT INTO public.hosted_full_live_jit_materializations(full_live_authority_id,operation_id,
    checkpoint,candidate_sha256,call_sha256,request_sha256,execution_sha256,request_document,
    execution_document,call_document,expires_at,token_sha256)
  VALUES(full_authority,intent.operation_id,intent.checkpoint,intent.candidate_sha256,
    public.videoforge_v213_jit_sha256(call),request->>'requestSha256',
    public.videoforge_v213_jit_sha256(execution),request,execution,call,intent.expires_at,
    intent.token_sha256);
  INSERT INTO public.hosted_full_live_jit_materialization_readbacks(full_live_authority_id,
    operation_id,checkpoint,materialization_sha256,predecessor_evidence_sha256s)
  VALUES(full_authority,intent.operation_id,intent.checkpoint,supplied->>'materializationSha256',
    intent.predecessor_evidence_sha256s);
  IF intent.checkpoint<>'V2-09' THEN
    INSERT INTO public.hosted_full_live_acceptance_authorities(id,full_live_authority_id,
      workflow_start_authority_id,checkpoint,command_id,request_sha256,outer_state_sha256,
      request_document,execution_document,expires_at)
    SELECT gen_random_uuid(),full_authority,start.id,intent.checkpoint,intent.command_id,
      request->>'requestSha256',intent.outer_state_sha256,request,execution,intent.expires_at
    FROM public.hosted_full_live_workflow_start_authorities start
    WHERE start.full_live_authority_id=full_authority;
  END IF;
  RETURN supplied->>'materializationSha256';
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_jit_materialization(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE materialized public.hosted_full_live_jit_materializations%ROWTYPE;
  readback public.hosted_full_live_jit_materialization_readbacks%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['fullLiveAuthorityId','materializationSha256','operationId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'materializationSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 JIT readback invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO materialized FROM public.hosted_full_live_jit_materializations
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId';
  SELECT * INTO readback FROM public.hosted_full_live_jit_materialization_readbacks
   WHERE full_live_authority_id=materialized.full_live_authority_id
     AND operation_id=materialized.operation_id;
  IF materialized.operation_id IS NULL OR
     readback.materialization_sha256<>supplied->>'materializationSha256' THEN
    RAISE EXCEPTION 'V213 JIT readback unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('operationId',materialized.operation_id,
    'checkpoint',materialized.checkpoint,'materializationSha256',readback.materialization_sha256,
    'requestDocument',materialized.request_document,
    'executionDocument',materialized.execution_document,'callDocument',materialized.call_document);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_v213_jit_sha256(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_jit_iso(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_jit_operation_evidence_exists(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_jit_deployment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_prepare_v213_jit_operation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_project_v213_jit_operation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_persist_v213_jit_materialization(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_jit_materialization(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_claim_v213_resolved_render_manifest_read(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); intent public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  reference jsonb; unsigned jsonb; expected_request text; expected_nonce text; issued timestamptz;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['accountId','artifactUri','fullLiveAuthorityId','issuedAt',
         'materializationRequestSha256','nonceSha256','operationId','outerStateSha256','projectId',
         'projectRevisionId','requestSha256','sha256','tokenSha256','workspaceId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'operationId' NOT IN ('v2-09-short-hosted-project',
       'v2-10-operator-free-ranga-pilot','v2-12-long-output')
     OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'nonceSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 resolved render manifest claim invalid' USING ERRCODE='42501';
  END IF;
  BEGIN issued:=(supplied->>'issuedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'V213 resolved render manifest claim time invalid' USING ERRCODE='42501';
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',216));
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'nonceSha256',217));
  SELECT child.* INTO intent FROM public.hosted_full_live_jit_operation_authorities child
   JOIN public.hosted_full_live_authorities authority
     ON authority.id=child.full_live_authority_id
   JOIN public.hosted_full_live_promotions promotion
     ON promotion.authority_id=authority.id
   WHERE child.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND child.operation_id=supplied->>'operationId'
     AND child.outer_state_sha256=supplied->>'outerStateSha256'
     AND child.token_sha256=supplied->>'tokenSha256'
     AND child.expires_at>db_now AND authority.expires_at>db_now FOR SHARE OF child,authority,promotion;
  reference:=intent.candidate_document->'renderPlanReference';
  IF intent.operation_id IS NULL OR jsonb_typeof(reference)<>'object'
     OR reference->>'materializationRequestSha256'<>intent.materialization_request_sha256
     OR reference->>'materializationRequestSha256'<>supplied->>'materializationRequestSha256'
     OR reference->>'fullLiveAuthorityId'<>intent.full_live_authority_id::text
     OR reference->>'operationId'<>intent.operation_id
     OR reference->>'outerStateSha256'<>intent.outer_state_sha256
     OR reference->>'accountId'<>supplied->>'accountId'
     OR reference->>'workspaceId'<>supplied->>'workspaceId'
     OR reference->>'projectId'<>supplied->>'projectId'
     OR reference->>'projectRevisionId'<>supplied->>'projectRevisionId'
     OR reference->>'artifactUri'<>supplied->>'artifactUri'
     OR reference->>'sha256'<>supplied->>'sha256'
     OR reference->>'issuedAt'<>supplied->>'issuedAt'
     OR issued>db_now+interval '30 seconds' OR issued<db_now-interval '5 minutes'
     OR supplied->>'artifactUri'<>'vf-local://objects/sha256/'||
       substring(supplied->>'sha256' from 8 for 2)||'/'||
       substring(supplied->>'sha256' from 8)||'.json' THEN
    RAISE EXCEPTION 'V213 resolved render manifest projection drift' USING ERRCODE='23514';
  END IF;
  expected_nonce:='sha256:'||encode(sha256(convert_to(reference->>'nonce','UTF8')),'hex');
  unsigned:=jsonb_build_object('schemaVersion','videoforge.v213-resolved-render-manifest-read/v1',
    'fullLiveAuthorityId',intent.full_live_authority_id,'operationId',intent.operation_id,
    'outerStateSha256',intent.outer_state_sha256,
    'materializationRequestSha256',intent.materialization_request_sha256,
    'accountId',supplied->>'accountId','workspaceId',supplied->>'workspaceId',
    'projectId',supplied->>'projectId','projectRevisionId',supplied->>'projectRevisionId',
    'artifactUri',supplied->>'artifactUri','sha256',supplied->>'sha256',
    'issuedAt',supplied->>'issuedAt','nonce',reference->>'nonce');
  expected_request:=public.videoforge_v213_jit_sha256(unsigned);
  IF expected_nonce<>supplied->>'nonceSha256' OR expected_request<>supplied->>'requestSha256'
     OR EXISTS(SELECT 1 FROM public.hosted_full_live_manifest_read_claims claim
       WHERE claim.request_sha256=supplied->>'requestSha256'
          OR claim.nonce_sha256=supplied->>'nonceSha256') THEN
    RAISE EXCEPTION 'V213 resolved render manifest replay or hash drift' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.hosted_full_live_manifest_read_claims(request_sha256,nonce_sha256,
    full_live_authority_id,operation_id,outer_state_sha256,materialization_request_sha256,
    token_sha256,account_id,workspace_id,project_id,project_revision_id,artifact_uri,
    artifact_sha256,issued_at)
  VALUES(supplied->>'requestSha256',supplied->>'nonceSha256',intent.full_live_authority_id,
    intent.operation_id,intent.outer_state_sha256,intent.materialization_request_sha256,
    intent.token_sha256,(supplied->>'accountId')::uuid,(supplied->>'workspaceId')::uuid,
    (supplied->>'projectId')::uuid,(supplied->>'projectRevisionId')::uuid,
    supplied->>'artifactUri',supplied->>'sha256',issued);
  RETURN jsonb_build_object('claimed',true);
END;
$$;

CREATE FUNCTION public.videoforge_verify_v213_jit_artifact(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE kind text:=supplied->>'kind'; artifact jsonb:=supplied->'artifact';
  authority_id uuid; qualification_id uuid; qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE; promotion public.hosted_full_live_promotions%ROWTYPE;
  plan public.hosted_render_plans%ROWTYPE; barrier public.hosted_serverless_output_barrier_completions%ROWTYPE;
  mage public.hosted_serverless_output_barrier_completions%ROWTYPE;
  soulx public.hosted_serverless_output_barrier_completions%ROWTYPE;
  artifacts jsonb; profile jsonb; candidate_sha text; inventory_sha text; count_rows integer;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['artifact','kind']::text[]
     OR jsonb_typeof(artifact)<>'object'
     OR kind NOT IN ('QUALIFICATION','SHORT_PILOT_BARRIER','PRODUCTION_LENGTH_QUALIFICATION') THEN
    RAISE EXCEPTION 'V213 JIT artifact input invalid' USING ERRCODE='23514';
  END IF;
  candidate_sha:=public.videoforge_v213_jit_sha256(artifact);
  IF kind='QUALIFICATION' THEN
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(artifact) key)
         IS DISTINCT FROM ARRAY['fullLiveAuthorityId','lane','qualificationId']::text[]
       OR artifact->>'fullLiveAuthorityId' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR artifact->>'qualificationId' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR artifact->>'lane' NOT IN ('mage_image','soulx_avatar') THEN
      RAISE EXCEPTION 'V213 JIT qualification reference invalid' USING ERRCODE='23514';
    END IF;
    authority_id:=(artifact->>'fullLiveAuthorityId')::uuid;
    qualification_id:=(artifact->>'qualificationId')::uuid;
    SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=authority_id;
    SELECT * INTO qualification FROM public.hosted_serverless_qualification_attestations
     WHERE id=qualification_id AND lane=artifact->>'lane';
    SELECT * INTO deployment FROM public.serverless_endpoint_deployments
     WHERE id=qualification.deployment_id AND lane=qualification.lane;
    IF promotion.id IS NULL OR qualification.id IS NULL OR qualification.expires_at<=transaction_timestamp()
       OR deployment.id IS NULL OR NOT deployment.is_active OR deployment.worker_count_min<>0
       OR deployment.worker_count_max<>1 OR deployment.retained_active_workers<>0
       OR qualification_id<>(CASE qualification.lane WHEN 'mage_image' THEN promotion.mage_qualification_id
            ELSE promotion.soulx_qualification_id END)
       OR deployment.id<>(CASE qualification.lane WHEN 'mage_image' THEN promotion.mage_deployment_id
            ELSE promotion.soulx_deployment_id END)
       OR jsonb_typeof(deployment.timeout_evidence->'sealed_lineage')<>'object' THEN
      RAISE EXCEPTION 'V213 JIT qualification unavailable' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('verifierId','videoforge-independent-qualification-v1',
      'accepted',true,'lane',qualification.lane,
      'checkpointId',CASE qualification.lane WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
      'canonicalArtifactSha256',candidate_sha,
      'verifiedAt',public.videoforge_v213_jit_iso(qualification.verified_at),
      'expiresAt',public.videoforge_v213_jit_iso(qualification.expires_at),
      'lineage',deployment.timeout_evidence->'sealed_lineage');
  END IF;
  IF artifact->>'accountId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR artifact->>'workspaceId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR artifact->>'projectId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR artifact->>'projectRevisionId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR artifact->>'renderPlanSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 JIT barrier scope invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO plan FROM public.hosted_render_plans
   WHERE account_id=(artifact->>'accountId')::uuid AND workspace_id=(artifact->>'workspaceId')::uuid
     AND project_id=(artifact->>'projectId')::uuid
     AND project_revision_id=(artifact->>'projectRevisionId')::uuid
     AND payload#>>'{input_document,resolved_render_manifest,sha256}'=artifact->>'renderPlanSha256';
  IF plan.project_revision_id IS NULL THEN
    RAISE EXCEPTION 'V213 JIT barrier render plan unavailable' USING ERRCODE='42501';
  END IF;
  IF kind='SHORT_PILOT_BARRIER' THEN
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(artifact) key)
         IS DISTINCT FROM ARRAY['accountId','lane','projectId','projectRevisionId',
           'renderPlanSha256','workspaceId']::text[]
       OR artifact->>'lane' NOT IN ('mage_image','soulx_avatar') THEN
      RAISE EXCEPTION 'V213 JIT barrier reference invalid' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO count_rows
      FROM public.hosted_serverless_output_barrier_completions completion
     WHERE completion.account_id=(artifact->>'accountId')::uuid
       AND completion.workspace_id=(artifact->>'workspaceId')::uuid
       AND completion.project_id=(artifact->>'projectId')::uuid
       AND completion.project_revision_id=(artifact->>'projectRevisionId')::uuid
       AND completion.lane=artifact->>'lane';
    IF count_rows<>1 THEN
      RAISE EXCEPTION 'V213 JIT barrier completion ambiguous' USING ERRCODE='21000';
    END IF;
    SELECT * INTO barrier FROM public.hosted_serverless_output_barrier_completions completion
     WHERE completion.account_id=(artifact->>'accountId')::uuid
       AND completion.workspace_id=(artifact->>'workspaceId')::uuid
       AND completion.project_id=(artifact->>'projectId')::uuid
       AND completion.project_revision_id=(artifact->>'projectRevisionId')::uuid
       AND completion.lane=artifact->>'lane';
    SELECT jsonb_agg(jsonb_build_object('assetId',object->>'item_id',
      'objectKey',object->>'object_key','sha256',object->>'checksum_sha256',
      'contentType',object->>'content_type') ORDER BY object->>'item_id') INTO artifacts
      FROM jsonb_array_elements(barrier.expected_objects) object;
    profile:=CASE WHEN barrier.lane='mage_image' THEN 'null'::jsonb ELSE jsonb_build_object(
      'sourceProfile','soulx-pro-vf924u-approved-v1','fullCrop',NULL,
      'splitCrop','448:504:32:4',
      'acceptanceContractSha256',barrier.model_manifest_sha256,
      'cropProfileEvidenceSha256',plan.payload#>>'{input_document,resolved_render_manifest,sha256}',
      'cropProfileApprovalSha256',plan.payload#>>'{input_document,resolved_render_manifest,sha256}') END;
    inventory_sha:=public.videoforge_v213_jit_sha256(barrier.expected_objects);
    RETURN jsonb_build_object('verifierId','videoforge-hosted-output-barrier-verifier-v1',
      'accepted',true,'lane',barrier.lane,
      'checkpointId',CASE barrier.lane WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
      'attemptId',barrier.attempt_id,'canonicalBarrierAcceptanceSha256',barrier.binding_sha256,
      'durableInventorySha256',inventory_sha,'artifacts',artifacts,'soulxProfile',profile);
  END IF;
  SELECT * INTO mage FROM public.hosted_serverless_output_barrier_completions completion
   WHERE completion.account_id=(artifact->>'accountId')::uuid
     AND completion.workspace_id=(artifact->>'workspaceId')::uuid
     AND completion.project_id=(artifact->>'projectId')::uuid
     AND completion.project_revision_id=(artifact->>'projectRevisionId')::uuid
     AND completion.lane='mage_image';
  SELECT * INTO soulx FROM public.hosted_serverless_output_barrier_completions completion
   WHERE completion.account_id=(artifact->>'accountId')::uuid
     AND completion.workspace_id=(artifact->>'workspaceId')::uuid
     AND completion.project_id=(artifact->>'projectId')::uuid
     AND completion.project_revision_id=(artifact->>'projectRevisionId')::uuid
     AND completion.lane='soulx_avatar';
  IF mage.attempt_id IS NULL OR soulx.attempt_id IS NULL THEN
    RAISE EXCEPTION 'V213 production qualification unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('verifierId','videoforge-production-length-qualification-verifier-v1',
    'accepted',true,'canonicalEvidenceSha256',candidate_sha,
    'verifierSignatureSha256',public.videoforge_v213_jit_sha256(
      jsonb_build_object('mage',mage.binding_sha256,'soulx',soulx.binding_sha256)),
    'verifiedAt',public.videoforge_v213_jit_iso(greatest(mage.completed_at,soulx.completed_at)),
    'expiresAt',public.videoforge_v213_jit_iso(least(mage.completed_at,soulx.completed_at)+interval '24 hours'),
    'accountId',artifact->>'accountId','workspaceId',artifact->>'workspaceId',
    'projectId',artifact->>'projectId','projectRevisionId',artifact->>'projectRevisionId',
    'renderPlanSha256',artifact->>'renderPlanSha256',
    'mage',jsonb_build_object('state','QUALIFIED','canonicalBarrierSha256',mage.binding_sha256,
      'attemptId',mage.attempt_id,'artifacts',(SELECT jsonb_agg(jsonb_build_object(
        'assetId',object->>'item_id','objectKey',object->>'object_key',
        'sha256',object->>'checksum_sha256','contentType',object->>'content_type')
        ORDER BY object->>'item_id') FROM jsonb_array_elements(mage.expected_objects) object)),
    'soulx',jsonb_build_object('state','QUALIFIED','canonicalBarrierSha256',soulx.binding_sha256,
      'attemptId',soulx.attempt_id,'acceptanceContractSha256',soulx.model_manifest_sha256,
      'cropProfileEvidenceSha256',artifact->>'renderPlanSha256',
      'sourceProfile','soulx-pro-vf924u-approved-v1','fullCrop',NULL,'splitCrop','448:504:32:4',
      'artifacts',(SELECT jsonb_agg(jsonb_build_object('assetId',object->>'item_id',
        'objectKey',object->>'object_key','sha256',object->>'checksum_sha256',
        'contentType',object->>'content_type') ORDER BY object->>'item_id')
        FROM jsonb_array_elements(soulx.expected_objects) object)));
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_verify_v213_jit_artifact(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_record_v213_acceptance_authority(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE doc jsonb:=supplied->'document'; execution jsonb:=supplied->'execution';
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  start_authority public.hosted_full_live_workflow_start_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_authorities%ROWTYPE;
BEGIN
  SELECT operation.* INTO child FROM public.hosted_full_live_jit_operation_authorities operation
   WHERE operation.command_id=doc->>'commandId' AND operation.checkpoint=doc->>'checkpoint'
     AND operation.production_stage_authority_id=doc->>'stageAuthorityId'
     AND operation.outer_state_sha256=doc->>'outerStateSha256';
  SELECT * INTO start_authority FROM public.hosted_full_live_workflow_start_authorities
   WHERE full_live_authority_id=child.full_live_authority_id;
  IF child.operation_id IS NULL OR child.expires_at<=transaction_timestamp()
     OR supplied->>'tokenSha256'<>child.token_sha256
     OR (supplied->>'expiresAt')::timestamptz<>child.expires_at
     OR doc->>'schemaVersion'<>'videoforge.v213-hosted-acceptance-command/v1'
     OR doc->>'command'<>child.operation_id OR doc->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR execution->>'schemaVersion'<>'videoforge.v213-database-acceptance-execution/v2'
     OR execution->>'operationId'<>child.operation_id OR execution->'call'->'request' IS NULL
     OR execution->'call'->'request'->>'checkpoint'<>child.checkpoint
     OR execution->'call'->'request'->>'sourceCommit'<>
        (SELECT source_commit FROM public.hosted_full_live_authorities WHERE id=child.full_live_authority_id)
     OR start_authority.id IS NULL THEN
    RAISE EXCEPTION 'V213 acceptance authority invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_authorities
   WHERE full_live_authority_id=child.full_live_authority_id AND checkpoint=child.checkpoint;
  IF existing.id IS NOT NULL THEN
    IF existing.request_document IS DISTINCT FROM doc OR existing.execution_document IS DISTINCT FROM execution
       OR existing.expires_at<>child.expires_at THEN
      RAISE EXCEPTION 'V213 acceptance authority replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_acceptance_authorities(id,full_live_authority_id,
      workflow_start_authority_id,checkpoint,command_id,request_sha256,outer_state_sha256,
      request_document,execution_document,expires_at)
    VALUES(gen_random_uuid(),child.full_live_authority_id,start_authority.id,child.checkpoint,
      child.command_id,doc->>'requestSha256',child.outer_state_sha256,doc,execution,child.expires_at)
    RETURNING * INTO existing;
  END IF;
  RETURN jsonb_build_object('requestSha256',existing.request_sha256,'checkpoint',existing.checkpoint,
    'expiresAt',public.videoforge_v213_jit_iso(existing.expires_at));
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_claim_v213_operator_acceptance(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE authority public.hosted_full_live_acceptance_authorities%ROWTYPE;
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  claim public.hosted_full_live_acceptance_claims%ROWTYPE;
  result public.hosted_full_live_acceptance_operator_results%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object' OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->'document'->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->'document'->>'requestSha256',218));
  SELECT * INTO authority FROM public.hosted_full_live_acceptance_authorities
   WHERE request_sha256=supplied->'document'->>'requestSha256'
     AND request_document=supplied->'document';
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=authority.full_live_authority_id
     AND checkpoint=authority.checkpoint AND token_sha256=supplied->>'tokenSha256';
  IF authority.id IS NULL OR child.operation_id IS NULL OR authority.expires_at<=transaction_timestamp()
     OR child.expires_at<>authority.expires_at
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities full_authority
       JOIN public.hosted_full_live_promotions promotion ON promotion.authority_id=full_authority.id
       WHERE full_authority.id=authority.full_live_authority_id
         AND full_authority.expires_at>transaction_timestamp()) THEN RETURN NULL; END IF;
  SELECT * INTO claim FROM public.hosted_full_live_acceptance_claims
   WHERE acceptance_authority_id=authority.id;
  IF claim.id IS NULL THEN
    INSERT INTO public.hosted_full_live_acceptance_claims(id,acceptance_authority_id)
    VALUES(gen_random_uuid(),authority.id) RETURNING * INTO claim;
    RETURN jsonb_build_object('action','EXECUTE','execution',authority.execution_document);
  END IF;
  SELECT * INTO result FROM public.hosted_full_live_acceptance_operator_results WHERE claim_id=claim.id;
  IF result.claim_id IS NULL THEN
    RETURN jsonb_build_object('action','RECONCILE','execution',authority.execution_document);
  END IF;
  RETURN jsonb_build_object('action','EXISTING','result',result.result_document);
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_load_v213_bridge_acceptance_call(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE authority public.hosted_full_live_acceptance_authorities%ROWTYPE;
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  request jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['command','commandId','outerStateSha256','requestSha256',
         'stageAuthorityId']::text[] THEN RETURN NULL; END IF;
  SELECT * INTO authority FROM public.hosted_full_live_acceptance_authorities
   WHERE command_id=supplied->>'commandId' AND request_sha256=supplied->>'requestSha256'
     AND outer_state_sha256=supplied->>'outerStateSha256'
     AND request_document->>'command'=supplied->>'command'
     AND request_document->>'stageAuthorityId'=supplied->>'stageAuthorityId';
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=authority.full_live_authority_id
     AND operation_id=supplied->>'command'
     AND production_stage_authority_id=supplied->>'stageAuthorityId';
  request:=authority.execution_document->'call'->'request';
  IF authority.id IS NULL OR child.operation_id IS NULL OR child.expires_at<=transaction_timestamp()
     OR authority.expires_at<>child.expires_at OR request IS NULL
     OR request->>'checkpoint'<>authority.checkpoint
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities full_authority
       JOIN public.hosted_full_live_promotions promotion ON promotion.authority_id=full_authority.id
       WHERE full_authority.id=authority.full_live_authority_id
         AND full_authority.expires_at>transaction_timestamp()
         AND request->>'proposalSha256'=full_authority.proposal_sha256
         AND request->>'sourceCommit'=full_authority.source_commit
         AND request->>'promotionDecisionSha256'=promotion.decision_sha256) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('checkpoint',authority.checkpoint,
    'fullLiveAuthorityId',authority.full_live_authority_id,
    'call',authority.execution_document->'call');
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_claim_v213_live_acceptance(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE acceptance public.hosted_full_live_acceptance_authorities%ROWTYPE;
  claim public.hosted_full_live_acceptance_claims%ROWTYPE;
  live_authority public.hosted_full_live_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE; request jsonb:=supplied->'request';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',219));
  SELECT * INTO acceptance FROM public.hosted_full_live_acceptance_authorities
   WHERE request_sha256=supplied->>'requestSha256'
     AND execution_document->'call'->'request'=request
     AND expires_at>transaction_timestamp();
  SELECT * INTO claim FROM public.hosted_full_live_acceptance_claims
   WHERE acceptance_authority_id=acceptance.id;
  SELECT * INTO live_authority FROM public.hosted_full_live_authorities
   WHERE id=acceptance.full_live_authority_id;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions
   WHERE authority_id=live_authority.id;
  IF acceptance.id IS NULL OR claim.id IS NULL OR live_authority.expires_at<=transaction_timestamp()
     OR request->>'proposalSha256'<>live_authority.proposal_sha256
     OR request->>'authoritySha256'<>live_authority.authority_document_sha256
     OR request->>'approvalRecordSha256'<>live_authority.approval_sha256
     OR request->>'cumulativeLedgerSha256'<>promotion.migration_ledger_sha256
     OR request->>'executorSha256'<>live_authority.executor_sha256
     OR request->>'promotionDecisionSha256'<>promotion.decision_sha256
     OR request->>'sourceCommit'<>live_authority.source_commit THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('requestSha256',acceptance.request_sha256,
    'proposalSha256',live_authority.proposal_sha256,
    'authoritySha256',live_authority.authority_document_sha256,
    'approvalRecordSha256',live_authority.approval_sha256,'approvalConsumed',true,
    'cumulativeLedgerSha256',promotion.migration_ledger_sha256,
    'executorSha256',live_authority.executor_sha256,
    'promotionDecisionSha256',promotion.decision_sha256,'promotionVersion','V3',
    'promotionState','CONSUMED_CURRENT','sourceCommit',live_authority.source_commit,
    'cumulativeLedgerSpentBeforeMicroUsd',request->'cumulativeLedgerSpentBeforeMicroUsd',
    'billingBaselineMicroUsd',request->'billingBaselineMicroUsd',
    'claimedAt',public.videoforge_v213_jit_iso(claim.claimed_at),
    'expiresAt',public.videoforge_v213_jit_iso(acceptance.expires_at));
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_complete_v213_live_acceptance(supplied jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim_id uuid; acceptance public.hosted_full_live_acceptance_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_results%ROWTYPE;
  evidence public.hosted_full_live_signed_evidence%ROWTYPE;
  result_hash text; receipt_hash text:=supplied->>'receiptEvidenceSha256'; result jsonb:=supplied->'result';
  request jsonb;
BEGIN
  IF supplied->>'completionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR receipt_hash !~ '^sha256:[0-9a-f]{64}$' OR jsonb_typeof(result)<>'object' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',220));
  SELECT * INTO acceptance FROM public.hosted_full_live_acceptance_authorities
   WHERE request_sha256=supplied->>'requestSha256';
  SELECT id INTO claim_id FROM public.hosted_full_live_acceptance_claims
   WHERE acceptance_authority_id=acceptance.id;
  request:=acceptance.execution_document->'call'->'request';
  SELECT * INTO evidence FROM public.hosted_full_live_signed_evidence
   WHERE artifact_sha256=receipt_hash AND kind='RECEIPT';
  result_hash:=public.videoforge_v213_jit_sha256(result);
  IF claim_id IS NULL OR evidence.artifact_sha256 IS NULL
     OR result_hash<>supplied->>'completionSha256'
     OR evidence.document->>'canonicalArtifactSha256'<>receipt_hash
     OR evidence.document->>'checkpoint'<>acceptance.checkpoint
     OR evidence.document->>'executionId'<>request->>'executionId'
     OR evidence.document->>'proposalSha256'<>request->>'proposalSha256'
     OR evidence.document->>'authoritySha256'<>request->>'authoritySha256'
     OR evidence.document->>'sourceCommit'<>request->>'sourceCommit'
     OR result->'receipt'<>evidence.document THEN RETURN false; END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_results WHERE hosted_full_live_acceptance_results.claim_id=claim_id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.state<>'COMPLETED' OR existing.evidence_sha256<>receipt_hash
       OR existing.result_sha256<>result_hash OR existing.result_document<>result THEN
      RAISE EXCEPTION 'V213 live acceptance completion drift' USING ERRCODE='23505';
    END IF;
    RETURN true;
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_results(claim_id,state,evidence_sha256,result_sha256,result_document)
  VALUES(claim_id,'COMPLETED',receipt_hash,result_hash,result);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_fail_v213_live_acceptance(supplied jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim_id uuid; acceptance public.hosted_full_live_acceptance_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_results%ROWTYPE;
  evidence public.hosted_full_live_signed_evidence%ROWTYPE;
  cleanup_hash text:=supplied->>'cleanupSha256'; request jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',221));
  SELECT * INTO acceptance FROM public.hosted_full_live_acceptance_authorities
   WHERE request_sha256=supplied->>'requestSha256';
  SELECT id INTO claim_id FROM public.hosted_full_live_acceptance_claims
   WHERE acceptance_authority_id=acceptance.id;
  request:=acceptance.execution_document->'call'->'request';
  SELECT * INTO evidence FROM public.hosted_full_live_signed_evidence
   WHERE artifact_sha256=cleanup_hash AND kind='CLEANUP';
  IF claim_id IS NULL OR evidence.artifact_sha256 IS NULL
     OR evidence.document->>'canonicalArtifactSha256'<>cleanup_hash
     OR evidence.document->>'checkpoint'<>acceptance.checkpoint
     OR evidence.document->>'executionId'<>request->>'executionId'
     OR evidence.document->>'authoritySha256'<>request->>'authoritySha256'
     OR evidence.document->>'sourceCommit'<>request->>'sourceCommit' THEN RETURN false; END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_results WHERE hosted_full_live_acceptance_results.claim_id=claim_id;
  IF existing.claim_id IS NOT NULL THEN
    IF existing.state<>'FAILED_CLEAN' OR existing.evidence_sha256<>cleanup_hash
       OR existing.result_sha256<>cleanup_hash OR existing.result_document<>evidence.document THEN
      RAISE EXCEPTION 'V213 live acceptance failure drift' USING ERRCODE='23505';
    END IF;
    RETURN true;
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_results(claim_id,state,evidence_sha256,result_sha256,result_document)
  VALUES(claim_id,'FAILED_CLEAN',cleanup_hash,cleanup_hash,evidence.document);
  RETURN true;
END;
$$;

CREATE TABLE public.hosted_full_live_acceptance_workflow_events (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL,
  sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 2),
  kind text NOT NULL CHECK(kind IN ('CLAIMED','CANCEL_REQUESTED')),
  workflow_id text NOT NULL CHECK(length(workflow_id) BETWEEN 1 AND 240),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,sequence),
  UNIQUE(full_live_authority_id,operation_id,kind)
);
CREATE TRIGGER hosted_full_live_acceptance_workflow_events_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_workflow_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_acceptance_workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_workflow_events FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_acceptance_workflow_events_owner_only
  ON public.hosted_full_live_acceptance_workflow_events USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_workflow_events FROM PUBLIC;

-- A pair terminal is not enough to prove the checkpoint-specific release assertions. These
-- append-only rows bind independently captured operator evidence and three live zero-worker reads
-- to one exact authority, operation, and DB-derived output identity. Missing evidence pauses the
-- Workflow; it is never inferred from an outer acceptance result or authored by the caller.
CREATE TABLE public.hosted_full_live_acceptance_operator_evidence_requests (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN (
    'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
    'v2-12-long-output','v2-13-final-two-lane-smoke')),
  output_binding_sha256 text NOT NULL CHECK(output_binding_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  requirements jsonb NOT NULL CHECK(jsonb_typeof(requirements)='array'),
  requested_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id),
  UNIQUE(full_live_authority_id,output_binding_sha256)
);
CREATE TABLE public.hosted_full_live_acceptance_operator_evidence (
  full_live_authority_id uuid NOT NULL,
  operation_id text NOT NULL,
  execution_request_sha256 text NOT NULL CHECK(execution_request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  kind text NOT NULL CHECK(kind IN (
    'V210_VISUAL_DECISION','V210_REAL_CHROME','V212_VISUAL_DECISION','V212_REAL_CHROME')),
  request_sha256 text NOT NULL UNIQUE CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  nonce_sha256 text NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  binding_document jsonb NOT NULL CHECK(jsonb_typeof(binding_document)='object'),
  evidence_document jsonb NOT NULL CHECK(jsonb_typeof(evidence_document)='object'),
  evidence_sha256 text NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,execution_request_sha256,kind),
  FOREIGN KEY(full_live_authority_id,operation_id)
    REFERENCES public.hosted_full_live_acceptance_operator_evidence_requests(full_live_authority_id,operation_id)
);
CREATE TABLE public.hosted_full_live_acceptance_zero_worker_reads (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 2),
  observations jsonb NOT NULL CHECK(jsonb_typeof(observations)='object'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,ordinal),
  UNIQUE(full_live_authority_id,operation_id,observed_at)
);
CREATE TABLE public.hosted_full_live_acceptance_technical_captures (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN (
    'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
    'v2-12-long-output','v2-13-final-two-lane-smoke')),
  output_binding_sha256 text NOT NULL CHECK(output_binding_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  plan_sha256 text NOT NULL UNIQUE CHECK(plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  capture_sha256 text NOT NULL UNIQUE CHECK(capture_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  capture_document jsonb NOT NULL CHECK(jsonb_typeof(capture_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id),
  UNIQUE(full_live_authority_id,output_binding_sha256)
);
-- Historical provenance rows predate V2-13's release verifier.  New V2-13 rows must populate
-- these three values from the already HMAC-verified worker receipt; finalization rejects NULL.
-- Keeping them nullable avoids rewriting or falsely upgrading older provenance history.
ALTER TABLE public.serverless_provenance_receipts
  ADD COLUMN peak_vram_bytes bigint CHECK(peak_vram_bytes IS NULL OR peak_vram_bytes>0),
  ADD COLUMN scratch_removed boolean CHECK(scratch_removed IS NULL OR scratch_removed),
  ADD COLUMN scratch_on_model_volume boolean
    CHECK(scratch_on_model_volume IS NULL OR NOT scratch_on_model_volume);

CREATE TABLE public.hosted_full_live_acceptance_workflow_outputs (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN (
    'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
    'v2-12-long-output','v2-13-final-two-lane-smoke')),
  output_binding_sha256 text NOT NULL CHECK(output_binding_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  output_document jsonb NOT NULL CHECK(
    jsonb_typeof(output_document)='object'
    AND output_document?'cleanup' AND output_document?'rawEvidence' AND output_document?'receipt'),
  output_sha256 text NOT NULL UNIQUE CHECK(output_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  finalized_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id),
  UNIQUE(full_live_authority_id,output_binding_sha256)
);
CREATE TABLE public.hosted_full_live_v211_policy_actions (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id='v2-11-two-concurrent-owned-projects'),
  action text NOT NULL CHECK(action IN ('APPLY_MAX2','RESTORE_MAX1')),
  receipts_document jsonb NOT NULL CHECK(jsonb_typeof(receipts_document)='array'),
  receipts_sha256 text NOT NULL UNIQUE CHECK(receipts_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,action)
);
CREATE TABLE public.hosted_full_live_v211_scenario_events (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id='v2-11-two-concurrent-owned-projects'),
  sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 3),
  action text NOT NULL CHECK(action IN ('OBSERVE_PROBE_WAITS','OBSERVE_FAIR_PROMOTION',
    'CANCEL_PROMOTED_PROBE')),
  promoted_probe jsonb NOT NULL CHECK(jsonb_typeof(promoted_probe)='object'),
  source_facts jsonb NOT NULL CHECK(jsonb_typeof(source_facts)='object'),
  source_facts_sha256 text NOT NULL UNIQUE CHECK(source_facts_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,sequence),
  UNIQUE(full_live_authority_id,operation_id,action)
);
CREATE TABLE public.hosted_full_live_v211_restore_authorizations (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id='v2-11-two-concurrent-owned-projects'),
  authorization_sha256 text NOT NULL UNIQUE CHECK(authorization_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  authorization_document jsonb NOT NULL CHECK(jsonb_typeof(authorization_document)='object'),
  authorized_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id)
);
CREATE TABLE public.hosted_full_live_v211_probe_cancellations (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id='v2-11-two-concurrent-owned-projects'),
  generation_request_id uuid NOT NULL UNIQUE,
  cancellation_sha256 text NOT NULL UNIQUE CHECK(cancellation_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  cancellation_document jsonb NOT NULL CHECK(jsonb_typeof(cancellation_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id)
);
CREATE TABLE public.hosted_full_live_v211_probe_reconciliations (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id='v2-11-two-concurrent-owned-projects'),
  generation_request_id uuid NOT NULL UNIQUE,
  reconciliation_sha256 text NOT NULL UNIQUE CHECK(reconciliation_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  reconciliation_document jsonb NOT NULL CHECK(jsonb_typeof(reconciliation_document)='object'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id),
  FOREIGN KEY(full_live_authority_id,operation_id)
    REFERENCES public.hosted_full_live_v211_probe_cancellations(full_live_authority_id,operation_id)
);
CREATE TRIGGER hosted_full_live_acceptance_operator_evidence_requests_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_operator_evidence_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_operator_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_operator_evidence
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_zero_worker_reads_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_zero_worker_reads
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_technical_captures_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_technical_captures
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_acceptance_workflow_outputs_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_acceptance_workflow_outputs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_v211_policy_actions_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_v211_policy_actions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_v211_scenario_events_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_v211_scenario_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_v211_restore_authorizations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_v211_restore_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_v211_probe_cancellations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_v211_probe_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_v211_probe_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_v211_probe_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_acceptance_operator_evidence_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_operator_evidence_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_operator_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_operator_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_zero_worker_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_zero_worker_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_technical_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_technical_captures FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_workflow_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_acceptance_workflow_outputs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_policy_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_policy_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_scenario_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_scenario_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_restore_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_restore_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_probe_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_probe_cancellations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_probe_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_v211_probe_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_acceptance_operator_evidence_requests_owner_only
  ON public.hosted_full_live_acceptance_operator_evidence_requests USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_operator_evidence_owner_only
  ON public.hosted_full_live_acceptance_operator_evidence USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_zero_worker_reads_owner_only
  ON public.hosted_full_live_acceptance_zero_worker_reads USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_technical_captures_owner_only
  ON public.hosted_full_live_acceptance_technical_captures USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_acceptance_workflow_outputs_owner_only
  ON public.hosted_full_live_acceptance_workflow_outputs USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_v211_policy_actions_owner_only
  ON public.hosted_full_live_v211_policy_actions USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_v211_scenario_events_owner_only
  ON public.hosted_full_live_v211_scenario_events USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_v211_restore_authorizations_owner_only
  ON public.hosted_full_live_v211_restore_authorizations USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_v211_probe_cancellations_owner_only
  ON public.hosted_full_live_v211_probe_cancellations USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_v211_probe_reconciliations_owner_only
  ON public.hosted_full_live_v211_probe_reconciliations USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_operator_evidence_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_operator_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_zero_worker_reads FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_technical_captures FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_acceptance_workflow_outputs FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_v211_policy_actions FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_v211_scenario_events FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_v211_restore_authorizations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_v211_probe_cancellations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_v211_probe_reconciliations FROM PUBLIC;

CREATE FUNCTION public.videoforge_v213_acceptance_output_binding(
  supplied_full_live_authority_id uuid, supplied_operation_id text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE;
  roles text[]; role text; identity jsonb; scope_facts jsonb:='[]'::jsonb; request_id uuid;
  attempt_count integer; terminal_count integer; barrier_count integer; zero_count integer;
  receipt_count integer; final_output_receipt_sha256 text;
  runtime public.video_runtime_states%ROWTYPE;
BEGIN
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=supplied_full_live_authority_id
     AND operation_id=supplied_operation_id;
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges c ON c.id=f.challenge_id
   WHERE c.full_live_authority_id=supplied_full_live_authority_id
     AND c.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  IF child.operation_id IS NULL OR facts.challenge_id IS NULL THEN RETURN NULL; END IF;
  roles:=CASE WHEN child.checkpoint='V2-11' THEN ARRAY['primary','secondary']::text[]
    ELSE ARRAY['primary']::text[] END;
  FOREACH role IN ARRAY roles LOOP
    identity:=facts.facts_document->'roleScopedIdentities'->role;
    request_id:=(identity->>'generationRequestId')::uuid;
    SELECT count(*),count(*) FILTER(WHERE state='SUCCEEDED')
      INTO attempt_count,terminal_count FROM public.serverless_attempts a
     WHERE a.account_id=(identity->>'accountId')::uuid
       AND a.workspace_id=(identity->>'workspaceId')::uuid
       AND a.generation_request_id=request_id AND a.lane IN ('mage_image','soulx_avatar');
    SELECT count(*) INTO barrier_count FROM public.hosted_serverless_output_barrier_completions b
      JOIN public.serverless_attempts a ON a.id=b.attempt_id
     WHERE a.account_id=(identity->>'accountId')::uuid
       AND a.workspace_id=(identity->>'workspaceId')::uuid
       AND a.generation_request_id=request_id;
    SELECT count(*) INTO zero_count FROM public.hosted_pair_zero_worker_observations z
     WHERE z.account_id=(identity->>'accountId')::uuid
       AND z.workspace_id=(identity->>'workspaceId')::uuid
       AND z.generation_request_id=request_id;
    SELECT * INTO runtime FROM public.video_runtime_states r
     WHERE r.account_id=(identity->>'accountId')::uuid
       AND r.workspace_id=(identity->>'workspaceId')::uuid
       AND r.generation_request_id=request_id;
    SELECT count(*),min(event.detail->>'final_output_receipt_sha256')
      INTO receipt_count,final_output_receipt_sha256
      FROM public.video_runtime_events event
     WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
       AND event.to_state='COMPLETE'
       AND event.detail->>'final_output_sha256'=runtime.final_output_sha256;
    IF attempt_count<>2 OR terminal_count<>2 OR zero_count<>2
       OR NOT EXISTS(SELECT 1 FROM public.hosted_pair_runtime_states p
         WHERE p.generation_request_id=request_id AND p.phase='SETTLED')
       OR EXISTS(SELECT 1 FROM public.provider_workload_leases l
         WHERE l.generation_request_id=request_id AND l.state='ACTIVE')
       OR barrier_count<>2 OR runtime.id IS NULL OR runtime.stage<>'COMPLETE'
       OR runtime.terminal_reason<>'SUCCEEDED'
       OR runtime.final_output_sha256 !~ '^sha256:[0-9a-f]{64}$'
       OR receipt_count<>1 OR final_output_receipt_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
      RETURN NULL;
    END IF;
    scope_facts:=scope_facts||jsonb_build_array(jsonb_build_object(
      'identity',identity,'runtimeId',runtime.id,'runtimeStage',runtime.stage,
      'terminalReason',runtime.terminal_reason,'finalOutputSha256',runtime.final_output_sha256,
      'finalOutputReceiptSha256',final_output_receipt_sha256,
      'attempts',(SELECT jsonb_agg(jsonb_build_object('attemptId',a.id,'lane',a.lane,
        'state',a.state,'providerJobId',assignment.provider_job_id,
        'outputReceiptSha256',barrier.provenance_receipt_sha256) ORDER BY a.lane)
        FROM public.serverless_attempts a
        LEFT JOIN public.serverless_provider_assignments assignment
          ON assignment.attempt_id=a.id AND assignment.is_current
        LEFT JOIN public.hosted_serverless_output_barrier_completions barrier
          ON barrier.attempt_id=a.id
        WHERE a.generation_request_id=request_id),
      'settledCost',(SELECT jsonb_build_object(
        'settledUsd',coalesce(sum(l.settled_usd),0),
        'possibleDuplicateUsd',coalesce(sum(l.possible_duplicate_usd),0),
        'reservedUsd',coalesce(sum(l.reserved_usd),0))
        FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a ON a.id=l.attempt_id
        WHERE a.generation_request_id=request_id)));
  END LOOP;
  RETURN public.videoforge_v213_jit_sha256(jsonb_build_object(
    'fullLiveAuthorityId',supplied_full_live_authority_id,'operationId',supplied_operation_id,
    'outerStateSha256',child.outer_state_sha256,'scopes',scope_facts));
END;
$$;

-- Read-only terminal/output projection for the local V2-12 Chrome producer.  The reconciler
-- receives only this owner-bound projection; it cannot read the underlying tables or dispatch a
-- provider job.  NULL means the already-created Workflow has not reached the exact durable
-- terminal/output boundary yet, so the caller may poll without replaying or redispatching.
CREATE FUNCTION public.videoforge_load_v212_terminal_output_projection(
  supplied_full_live_authority_id uuid,
  supplied_operation_id text,
  supplied_workflow_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  authority public.hosted_full_live_authorities%ROWTYPE;
  materialized public.hosted_full_live_jit_materializations%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE;
  request jsonb; scope jsonb; identity jsonb;
  runtime public.video_runtime_states%ROWTYPE;
  output_binding text; output_receipt text; output_sha text;
  output_bytes bigint; terminal_event_count integer; render_count integer;
  terminal_at timestamptz;
BEGIN
  IF supplied_full_live_authority_id IS NULL
     OR supplied_operation_id<>'v2-12-long-output'
     OR supplied_workflow_id IS NULL
     OR supplied_workflow_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$' THEN
    RAISE EXCEPTION 'V2-12 terminal output projection input invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=supplied_full_live_authority_id
     AND row.operation_id=supplied_operation_id AND row.checkpoint='V2-12';
  SELECT * INTO authority FROM public.hosted_full_live_authorities row
   WHERE row.id=supplied_full_live_authority_id;
  SELECT * INTO materialized FROM public.hosted_full_live_jit_materializations row
   WHERE row.full_live_authority_id=supplied_full_live_authority_id
     AND row.operation_id=supplied_operation_id;
  IF child.operation_id IS NULL OR authority.id IS NULL OR materialized.operation_id IS NULL
     OR authority.expires_at<=transaction_timestamp()
     OR child.workload_deadline_at<=transaction_timestamp()
     OR materialized.execution_document->>'workflowId'<>supplied_workflow_id
     OR materialized.execution_document#>>'{workflowParams,checkpoint}'<>'V2-12'
     OR materialized.execution_document#>>'{workflowParams,operationId}'<>supplied_operation_id THEN
    RETURN NULL;
  END IF;
  request:=materialized.execution_document#>'{call,request}';
  scope:=request#>'{scopes,0}';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges challenge
     ON challenge.id=f.challenge_id
   WHERE challenge.full_live_authority_id=supplied_full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  identity:=facts.facts_document#>'{roleScopedIdentities,primary}';
  IF request IS NULL OR scope IS NULL OR facts.challenge_id IS NULL
     OR identity IS NULL
     OR scope->>'accountId'<>identity->>'accountId'
     OR scope->>'workspaceId'<>identity->>'workspaceId'
     OR scope->>'projectId'<>identity->>'projectId'
     OR scope->>'projectRevisionId'<>identity->>'projectRevisionId'
     OR scope->>'requestSha256' IS NULL OR scope->>'attemptId' IS NULL
     OR request->>'executionId' IS NULL OR request->>'authoritySha256' IS NULL THEN
    RAISE EXCEPTION 'V2-12 terminal output projection identity invalid' USING ERRCODE='42501';
  END IF;
  output_binding:=public.videoforge_v213_acceptance_output_binding(
    supplied_full_live_authority_id,supplied_operation_id);
  IF output_binding IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO runtime FROM public.video_runtime_states row
   WHERE row.account_id=(identity->>'accountId')::uuid
     AND row.workspace_id=(identity->>'workspaceId')::uuid
     AND row.project_id=(identity->>'projectId')::uuid
     AND row.project_revision_id=(identity->>'projectRevisionId')::uuid
     AND row.generation_request_id=(identity->>'generationRequestId')::uuid
     AND row.stage='COMPLETE' AND row.terminal_reason='SUCCEEDED';
  SELECT count(*),min(event.detail->>'final_output_receipt_sha256'),min(event.occurred_at)
    INTO terminal_event_count,output_receipt,terminal_at
    FROM public.video_runtime_events event
   WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
     AND event.to_state='COMPLETE'
     AND event.detail->>'final_output_sha256'=runtime.final_output_sha256;
  SELECT count(*),min(receipt.content_length),min(receipt.checksum_sha256)
    INTO render_count,output_bytes,output_sha
    FROM public.hosted_cpu_job_attempts cpu
    JOIN public.artifact_reservations reservation
      ON reservation.account_id=cpu.account_id AND reservation.workspace_id=cpu.workspace_id
     AND reservation.project_id=cpu.project_id
     AND reservation.project_revision_id=cpu.project_revision_id
     AND reservation.lane='RENDER' AND reservation.job_id=cpu.id::text
     AND reservation.state='COMMITTED'
    JOIN public.artifact_receipts receipt
      ON receipt.account_id=reservation.account_id
     AND receipt.workspace_id=reservation.workspace_id
     AND receipt.reservation_id=reservation.id
   WHERE cpu.account_id=runtime.account_id AND cpu.workspace_id=runtime.workspace_id
     AND cpu.project_id=runtime.project_id
     AND cpu.project_revision_id=runtime.project_revision_id
     AND cpu.kind='RENDER' AND cpu.state='SUCCEEDED'
     AND cpu.result_content_type='application/json'
     AND receipt.content_type='video/mp4'
     AND receipt.checksum_sha256=runtime.final_output_sha256
     AND receipt.object_key=reservation.object_key AND receipt.deleted_at IS NULL;
  IF runtime.id IS NULL OR terminal_event_count<>1
     OR output_receipt !~ '^sha256:[0-9a-f]{64}$'
     OR terminal_at IS NULL OR runtime.final_output_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR render_count<>1 OR output_sha<>runtime.final_output_sha256
     OR output_bytes IS NULL OR output_bytes<1 THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion','videoforge.v213-v212-terminal-output-projection/v1',
    'fullLiveAuthorityId',child.full_live_authority_id::text,
    'stageAuthorityId',child.production_stage_authority_id,
    'outerStateSha256',child.outer_state_sha256,
    'operationId',child.operation_id,
    'checkpoint',child.checkpoint,
    'workflowId',supplied_workflow_id,
    'executionId',request->>'executionId',
    'executionRequestSha256',public.videoforge_v213_jit_sha256(request),
    'authoritySha256',request->>'authoritySha256',
    'accountId',scope->>'accountId',
    'workspaceId',scope->>'workspaceId',
    'projectId',scope->>'projectId',
    'projectRevisionId',scope->>'projectRevisionId',
    'attemptId',scope->>'attemptId',
    'scopeRequestSha256',scope->>'requestSha256',
    'outputSha256',runtime.final_output_sha256,
    'outputReceiptSha256',output_receipt,
    'outputBytes',output_bytes,
    'terminalAt',public.videoforge_v213_jit_iso(runtime.terminal_at),
    'workloadDeadlineAt',public.videoforge_v213_jit_iso(child.workload_deadline_at),
    'fullAuthorityExpiresAt',public.videoforge_v213_jit_iso(authority.expires_at),
    'outputBindingSha256',output_binding
  );
END;
$$;

CREATE FUNCTION public.videoforge_ingest_v213_operator_evidence(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); binding jsonb:=supplied->'binding';
  evidence jsonb:=supplied->'evidence'; kind text:=supplied#>>'{evidence,kind}';
  full_authority uuid; child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  materialized public.hosted_full_live_jit_materializations%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE;
  existing public.hosted_full_live_acceptance_operator_evidence%ROWTYPE;
  request_document jsonb; expected_scope jsonb; runtime public.video_runtime_states%ROWTYPE;
  output_receipt text; output_committed_at timestamptz; evidence_sha text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['binding','evidence','issuedAt','nonce','nonceSha256','requestSha256',
         'schemaVersion','tokenSha256']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v213-operator-evidence-ingestion-request/v1'
     OR jsonb_typeof(binding)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(binding) key)
       IS DISTINCT FROM ARRAY['authoritySha256','checkpoint','executionId','executionRequestSha256',
         'fullLiveAuthorityId','operationId','outerStateSha256','stageAuthorityId','workflowId']::text[]
     OR jsonb_typeof(evidence)<>'object'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'nonceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'tokenSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR binding->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR binding->>'executionRequestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR binding->>'authoritySha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'issuedAt')::timestamptz<db_now-interval '5 minutes'
     OR (supplied->>'issuedAt')::timestamptz>db_now+interval '30 seconds'
     OR 'sha256:'||encode(sha256(convert_to(supplied->>'nonce','UTF8')),'hex')<>
       supplied->>'nonceSha256'
     OR public.videoforge_v213_jit_sha256(
       supplied-'tokenSha256'-'nonceSha256'-'requestSha256')<>supplied->>'requestSha256' THEN
    RAISE EXCEPTION 'V213 operator evidence ingestion request invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(binding->>'fullLiveAuthorityId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    full_authority::text||':'||(binding->>'operationId')||':'||kind,229));
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=full_authority AND operation_id=binding->>'operationId';
  SELECT * INTO materialized FROM public.hosted_full_live_jit_materializations
   WHERE full_live_authority_id=full_authority AND operation_id=child.operation_id;
  request_document:=materialized.execution_document->'call'->'request';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges c ON c.id=f.challenge_id
   WHERE c.full_live_authority_id=full_authority
     AND c.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  IF child.operation_id IS NULL OR materialized.operation_id IS NULL OR facts.challenge_id IS NULL
     OR facts.facts_document IS NULL OR child.workload_deadline_at<=db_now
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_materialization_challenges challenge
       WHERE challenge.id=facts.challenge_id
         AND challenge.challenge_document->>'workerOperatorBearerSha256'=supplied->>'tokenSha256')
     OR child.checkpoint<>binding->>'checkpoint'
     OR child.production_stage_authority_id<>binding->>'stageAuthorityId'
     OR child.outer_state_sha256<>binding->>'outerStateSha256'
     OR materialized.execution_document->>'workflowId'<>binding->>'workflowId'
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
       WHERE event.full_live_authority_id=child.full_live_authority_id
         AND event.operation_id=child.operation_id AND event.kind='CLAIMED'
         AND event.workflow_id=binding->>'workflowId'
         AND event.request_sha256=materialized.request_sha256)
     OR request_document->>'executionId'<>binding->>'executionId'
     OR public.videoforge_v213_jit_sha256(request_document)<>
       binding->>'executionRequestSha256'
     OR request_document->>'authoritySha256'<>binding->>'authoritySha256'
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       JOIN public.hosted_full_live_promotions promotion ON promotion.authority_id=authority.id
       WHERE authority.id=full_authority AND authority.expires_at>db_now)
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_operator_evidence_requests r
       WHERE r.full_live_authority_id=full_authority AND r.operation_id=child.operation_id
         AND r.output_binding_sha256=public.videoforge_v213_acceptance_output_binding(
           full_authority,child.operation_id)) THEN
    RAISE EXCEPTION 'V213 operator evidence authority or output unavailable' USING ERRCODE='42501';
  END IF;
  evidence_sha:=public.videoforge_v213_jit_sha256(evidence);
  IF kind IN ('V210_VISUAL_DECISION','V212_VISUAL_DECISION','V210_REAL_CHROME','V212_REAL_CHROME') THEN
    expected_scope:=jsonb_build_object('accountId',request_document#>>'{scopes,0,accountId}',
      'workspaceId',request_document#>>'{scopes,0,workspaceId}',
      'projectId',request_document#>>'{scopes,0,projectId}',
      'projectRevisionId',request_document#>>'{scopes,0,projectRevisionId}');
    expected_scope:=expected_scope||jsonb_build_object(
      'requestSha256',request_document#>>'{scopes,0,requestSha256}',
      'attemptId',request_document#>>'{scopes,0,attemptId}');
    SELECT * INTO runtime FROM public.video_runtime_states r
     WHERE r.account_id=(expected_scope->>'accountId')::uuid
       AND r.workspace_id=(expected_scope->>'workspaceId')::uuid
       AND r.project_revision_id=(expected_scope->>'projectRevisionId')::uuid
       AND r.stage='COMPLETE' AND r.terminal_reason='SUCCEEDED';
    SELECT event.detail->>'final_output_receipt_sha256',event.occurred_at
      INTO output_receipt,output_committed_at FROM public.video_runtime_events event
     WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
       AND event.to_state='COMPLETE' ORDER BY event.occurred_at DESC LIMIT 1;
    IF runtime.id IS NULL OR evidence->'scope' IS DISTINCT FROM expected_scope
       OR evidence->>'outputSha256'<>runtime.final_output_sha256
       OR evidence->>'outputReceiptSha256'<>output_receipt
       OR (evidence->>'observedAt')::timestamptz<=output_committed_at THEN
      RAISE EXCEPTION 'V213 operator evidence output binding invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  IF kind IN ('V210_VISUAL_DECISION','V212_VISUAL_DECISION') THEN
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(evidence) key)
         IS DISTINCT FROM ARRAY['decision','kind','observedAt','outputReceiptSha256','outputSha256',
           'review','schemaVersion','scope']::text[]
       OR kind<>(CASE child.checkpoint WHEN 'V2-10' THEN 'V210_VISUAL_DECISION'
         WHEN 'V2-12' THEN 'V212_VISUAL_DECISION' ELSE '__invalid__' END)
       OR evidence->>'decision'<>'ACCEPTED' THEN
      RAISE EXCEPTION 'V213 visual decision evidence invalid' USING ERRCODE='23514';
    END IF;
    IF kind='V210_VISUAL_DECISION' AND (
       evidence->>'schemaVersion'<>'videoforge.v213-v210-visual-decision-evidence/v1'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(evidence->'review') key)
         IS DISTINCT FROM ARRAY['audioVideoQuality','avatarIdentityAndCrop','everyCutReviewed',
           'hardCutsOnly','imageRealism','lipSync','literalRelevance',
           'noManualMediaEditOrSubstitution','prohibitedGraphicsAbsent','requiredImageZoom',
           'reviewedCutCount']::text[]
       OR coalesce(CASE WHEN jsonb_typeof(evidence#>'{review,reviewedCutCount}')='number'
            THEN (evidence#>>'{review,reviewedCutCount}')::integer END,0)<=0
       OR evidence#>'{review,everyCutReviewed}'<>'true'::jsonb
       OR evidence#>'{review,noManualMediaEditOrSubstitution}'<>'true'::jsonb
       OR evidence#>>'{review,literalRelevance}'<>'PASSED'
       OR evidence#>>'{review,imageRealism}'<>'PASSED'
       OR evidence#>>'{review,avatarIdentityAndCrop}'<>'PASSED'
       OR evidence#>>'{review,lipSync}'<>'PASSED'
       OR evidence#>>'{review,audioVideoQuality}'<>'PASSED'
       OR evidence#>>'{review,prohibitedGraphicsAbsent}'<>'PASSED'
       OR evidence#>>'{review,hardCutsOnly}'<>'PASSED'
       OR evidence#>>'{review,requiredImageZoom}'<>'PASSED') THEN
      RAISE EXCEPTION 'V210 visual review evidence invalid' USING ERRCODE='23514';
    END IF;
    IF kind='V212_VISUAL_DECISION' AND (
       evidence->>'schemaVersion'<>'videoforge.v213-v212-visual-decision-evidence/v1'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(evidence->'review') key)
         IS DISTINCT FROM ARRAY['audioVideoQualityPassed','everyCutReviewed','hardCutsOnly',
           'noManualMediaEditOrSubstitution','overlaysAbsent','requiredSlowImageZoom',
           'reviewedCutCount','visualQualityPassed']::text[]
       OR coalesce(CASE WHEN jsonb_typeof(evidence#>'{review,reviewedCutCount}')='number'
            THEN (evidence#>>'{review,reviewedCutCount}')::integer END,0)<=0
       OR EXISTS(SELECT 1 FROM jsonb_each(evidence->'review') item
          WHERE item.key<>'reviewedCutCount' AND item.value<>'true'::jsonb)) THEN
      RAISE EXCEPTION 'V212 visual review evidence invalid' USING ERRCODE='23514';
    END IF;
  ELSIF kind='V210_REAL_CHROME' THEN
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(evidence) key)
         IS DISTINCT FROM ARRAY['chromeReceiptSha256','kind','observedAt','outputReceiptSha256',
           'outputSha256','playbackPassed','privateReadbackPassed','schemaVersion','scope']::text[]
       OR child.checkpoint<>'V2-10'
       OR evidence->>'schemaVersion'<>'videoforge.v213-v210-real-chrome-evidence/v1'
       OR evidence->'playbackPassed'<>'true'::jsonb
       OR evidence->'privateReadbackPassed'<>'true'::jsonb
       OR evidence->>'chromeReceiptSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'V213 real Chrome evidence invalid' USING ERRCODE='23514';
    END IF;
  ELSIF kind='V212_REAL_CHROME' THEN
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(evidence) key)
         IS DISTINCT FROM ARRAY['authenticatedSession','chromeReceiptSha256','downloadBytes',
           'downloadSha256','kind','observedAt','outputReceiptSha256','outputSha256',
           'playbackPassed','privateReadbackPassed','productionUrlSha256','schemaVersion','scope']::text[]
       OR child.checkpoint<>'V2-12'
       OR evidence->>'schemaVersion'<>'videoforge.v213-v212-real-chrome-evidence/v1'
       OR evidence->'authenticatedSession'<>'true'::jsonb
       OR evidence->'privateReadbackPassed'<>'true'::jsonb
       OR evidence->'playbackPassed'<>'true'::jsonb
       OR evidence->>'downloadSha256'<>evidence->>'outputSha256'
       OR evidence->>'productionUrlSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR evidence->>'chromeReceiptSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR coalesce(CASE WHEN jsonb_typeof(evidence->'downloadBytes')='number'
            THEN (evidence->>'downloadBytes')::numeric END,0)<=0
       OR coalesce(CASE WHEN jsonb_typeof(evidence->'downloadBytes')='number'
            THEN (evidence->>'downloadBytes')::numeric END,0)<>
          trunc(coalesce(CASE WHEN jsonb_typeof(evidence->'downloadBytes')='number'
            THEN (evidence->>'downloadBytes')::numeric END,0))
       OR coalesce(CASE WHEN jsonb_typeof(evidence->'downloadBytes')='number'
            THEN (evidence->>'downloadBytes')::numeric END,0)>9007199254740991
       OR (SELECT count(*) FROM public.hosted_full_live_signed_evidence activation
         WHERE activation.kind='RELEASE'
           AND activation.document->>'fullLiveAuthorityId'=full_authority::text
           AND activation.document->>'operationId'='guarded-activation'
           AND activation.document->>'productionUrlSha256'=evidence->>'productionUrlSha256')<>1 THEN
      RAISE EXCEPTION 'V212 real Chrome evidence invalid or activation URL unavailable'
        USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'V213 operator evidence kind invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_operator_evidence
   WHERE full_live_authority_id=full_authority AND operation_id=child.operation_id
     AND execution_request_sha256=binding->>'executionRequestSha256' AND hosted_full_live_acceptance_operator_evidence.kind=kind;
  IF existing.kind IS NOT NULL THEN
    IF existing.request_sha256<>supplied->>'requestSha256'
       OR existing.nonce_sha256<>supplied->>'nonceSha256'
       OR existing.binding_document IS DISTINCT FROM binding
       OR existing.evidence_document IS DISTINCT FROM evidence THEN
      RAISE EXCEPTION 'V213 operator evidence replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.evidence_sha256;
  END IF;
  INSERT INTO public.hosted_full_live_acceptance_operator_evidence(
    full_live_authority_id,operation_id,execution_request_sha256,kind,request_sha256,
    nonce_sha256,binding_document,evidence_document,evidence_sha256,issued_at)
  VALUES(full_authority,child.operation_id,binding->>'executionRequestSha256',kind,
    supplied->>'requestSha256',supplied->>'nonceSha256',binding,evidence,evidence_sha,
    (supplied->>'issuedAt')::timestamptz);
  RETURN evidence_sha;
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_operator_evidence(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE binding jsonb:=supplied->'binding'; found public.hosted_full_live_acceptance_operator_evidence%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['binding','kind']::text[] OR jsonb_typeof(binding)<>'object'
     OR supplied->>'kind' NOT IN ('V210_VISUAL_DECISION','V210_REAL_CHROME',
       'V212_VISUAL_DECISION','V212_REAL_CHROME') THEN
    RAISE EXCEPTION 'V213 operator evidence read invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO found FROM public.hosted_full_live_acceptance_operator_evidence row
   WHERE row.full_live_authority_id=(binding->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=binding->>'operationId'
     AND row.execution_request_sha256=binding->>'executionRequestSha256'
     AND row.kind=supplied->>'kind' AND row.binding_document=binding;
  IF found.kind IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('evidence',found.evidence_document,
    'evidenceSha256',found.evidence_sha256);
END;
$$;

CREATE FUNCTION public.videoforge_ingest_v213_acceptance_operator_evidence(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request jsonb:=supplied->'request'; evidence_sha text;
  persisted public.hosted_full_live_acceptance_operator_evidence%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['nonceSha256','request','tokenSha256']::text[]
     OR jsonb_typeof(request)<>'object' THEN
    RAISE EXCEPTION 'V213 operator evidence transport invalid' USING ERRCODE='23514';
  END IF;
  evidence_sha:=public.videoforge_ingest_v213_operator_evidence(
    request||jsonb_build_object('tokenSha256',supplied->>'tokenSha256',
      'nonceSha256',supplied->>'nonceSha256'));
  SELECT * INTO persisted FROM public.hosted_full_live_acceptance_operator_evidence row
   WHERE row.full_live_authority_id=(request#>>'{binding,fullLiveAuthorityId}')::uuid
     AND row.operation_id=request#>>'{binding,operationId}'
     AND row.execution_request_sha256=request#>>'{binding,executionRequestSha256}'
     AND row.kind=request#>>'{evidence,kind}' AND row.evidence_sha256=evidence_sha;
  IF persisted.kind IS NULL THEN
    RAISE EXCEPTION 'V213 operator evidence persistence unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion','videoforge.v213-operator-evidence-ingestion-result/v1',
    'fullLiveAuthorityId',persisted.full_live_authority_id,
    'operationId',persisted.operation_id,'checkpoint',request#>>'{binding,checkpoint}',
    'workflowId',request#>>'{binding,workflowId}',
    'executionRequestSha256',persisted.execution_request_sha256,'kind',persisted.kind,
    'evidenceSha256',persisted.evidence_sha256,'state','RECORDED',
    'recordedAt',public.videoforge_v213_jit_iso(persisted.recorded_at));
END;
$$;

CREATE FUNCTION public.videoforge_v213_acceptance_workflow_params_valid(supplied jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
  SELECT jsonb_typeof(supplied)='object'
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
      =ARRAY['checkpoint','fullLiveAuthorityId','kind','operationId','requestSha256',
        'schemaVersion','workflowId']::text[]
    AND supplied->>'schemaVersion'='videoforge.v213-acceptance-workflow-params/v1'
    AND supplied->>'kind'='V213_DATABASE_ACCEPTANCE'
    AND supplied->>'fullLiveAuthorityId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND supplied->>'requestSha256' ~ '^sha256:[0-9a-f]{64}$'
$$;

CREATE FUNCTION public.videoforge_prepare_v213_acceptance_technical_capture(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; roles text[]; selected_role text;
  identity jsonb; result jsonb:='[]'::jsonb; output_binding text; scope_index integer:=0;
  runtime public.video_runtime_states%ROWTYPE; render_attempt public.hosted_cpu_job_attempts%ROWTYPE;
  output_receipt public.artifact_receipts%ROWTYPE; render_count integer; job_count integer; jobs jsonb;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied) THEN
    RAISE EXCEPTION 'V213 technical capture parameters invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId' AND checkpoint=supplied->>'checkpoint';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges c ON c.id=f.challenge_id
   WHERE c.full_live_authority_id=child.full_live_authority_id
     AND c.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  output_binding:=public.videoforge_v213_acceptance_output_binding(
    child.full_live_authority_id,child.operation_id);
  IF child.operation_id IS NULL OR facts.challenge_id IS NULL OR output_binding IS NULL
     OR child.workload_deadline_at<=transaction_timestamp()
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id
         AND authority.expires_at>transaction_timestamp())
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
       WHERE event.full_live_authority_id=child.full_live_authority_id
         AND event.operation_id=child.operation_id AND event.kind='CLAIMED'
         AND event.workflow_id=supplied->>'workflowId'
         AND event.request_sha256=supplied->>'requestSha256') THEN
    RAISE EXCEPTION 'V213 technical capture source state unavailable' USING ERRCODE='42501';
  END IF;
  roles:=CASE WHEN child.checkpoint='V2-11' THEN ARRAY['primary','secondary']::text[]
    ELSE ARRAY['primary']::text[] END;
  FOREACH selected_role IN ARRAY roles LOOP
    identity:=facts.facts_document->'roleScopedIdentities'->selected_role;
    SELECT * INTO runtime FROM public.video_runtime_states state
     WHERE state.account_id=(identity->>'accountId')::uuid
       AND state.workspace_id=(identity->>'workspaceId')::uuid
       AND state.project_id=(identity->>'projectId')::uuid
       AND state.project_revision_id=(identity->>'projectRevisionId')::uuid
       AND state.generation_request_id=(identity->>'generationRequestId')::uuid
       AND state.stage='COMPLETE' AND state.terminal_reason='SUCCEEDED';
    SELECT count(*) INTO render_count
      FROM public.hosted_cpu_job_attempts cpu
      JOIN public.artifact_reservations reservation
        ON reservation.account_id=cpu.account_id AND reservation.workspace_id=cpu.workspace_id
       AND reservation.project_id=cpu.project_id
       AND reservation.project_revision_id=cpu.project_revision_id
       AND reservation.lane='RENDER' AND reservation.job_id=cpu.id::text
       AND reservation.state='COMMITTED'
      JOIN public.artifact_receipts receipt
        ON receipt.account_id=reservation.account_id
       AND receipt.workspace_id=reservation.workspace_id
       AND receipt.reservation_id=reservation.id
     WHERE cpu.account_id=runtime.account_id AND cpu.workspace_id=runtime.workspace_id
       AND cpu.project_id=runtime.project_id AND cpu.project_revision_id=runtime.project_revision_id
       AND cpu.kind='RENDER' AND cpu.state='SUCCEEDED'
       AND cpu.result_content_type='application/json' AND cpu.result_content_length IS NOT NULL
       AND cpu.result_checksum_sha256 IS NOT NULL AND cpu.result_receipt_sha256 IS NOT NULL
       AND receipt.content_type='video/mp4' AND receipt.checksum_sha256=runtime.final_output_sha256
       AND receipt.object_key=reservation.object_key AND receipt.deleted_at IS NULL;
    IF runtime.id IS NULL OR render_count<>1 THEN
      RAISE EXCEPTION 'V213 technical capture render association unavailable' USING ERRCODE='42501';
    END IF;
    SELECT cpu.* INTO render_attempt
      FROM public.hosted_cpu_job_attempts cpu
      JOIN public.artifact_reservations reservation
        ON reservation.account_id=cpu.account_id AND reservation.workspace_id=cpu.workspace_id
       AND reservation.project_id=cpu.project_id
       AND reservation.project_revision_id=cpu.project_revision_id
       AND reservation.lane='RENDER' AND reservation.job_id=cpu.id::text
       AND reservation.state='COMMITTED'
      JOIN public.artifact_receipts receipt
        ON receipt.account_id=reservation.account_id
       AND receipt.workspace_id=reservation.workspace_id
       AND receipt.reservation_id=reservation.id
     WHERE cpu.account_id=runtime.account_id AND cpu.workspace_id=runtime.workspace_id
       AND cpu.project_id=runtime.project_id AND cpu.project_revision_id=runtime.project_revision_id
       AND cpu.kind='RENDER' AND cpu.state='SUCCEEDED'
       AND cpu.result_content_type='application/json'
       AND receipt.content_type='video/mp4' AND receipt.checksum_sha256=runtime.final_output_sha256
       AND receipt.object_key=reservation.object_key AND receipt.deleted_at IS NULL;
    SELECT receipt.* INTO output_receipt
      FROM public.artifact_receipts receipt
      JOIN public.artifact_reservations reservation
        ON reservation.account_id=receipt.account_id
       AND reservation.workspace_id=receipt.workspace_id
       AND reservation.id=receipt.reservation_id
     WHERE reservation.account_id=render_attempt.account_id
       AND reservation.workspace_id=render_attempt.workspace_id
       AND reservation.project_id=render_attempt.project_id
       AND reservation.project_revision_id=render_attempt.project_revision_id
       AND reservation.lane='RENDER' AND reservation.job_id=render_attempt.id::text
       AND reservation.state='COMMITTED'
       AND receipt.content_type='video/mp4' AND receipt.checksum_sha256=runtime.final_output_sha256
       AND receipt.object_key=reservation.object_key AND receipt.deleted_at IS NULL;
    SELECT count(*),jsonb_agg(jsonb_build_object('lane',attempt.lane,
      'providerJobId',assignment.provider_job_id,
      'provenanceReceiptSha256',barrier.provenance_receipt_sha256) ORDER BY attempt.lane)
      INTO job_count,jobs
      FROM public.serverless_attempts attempt
      JOIN public.serverless_provider_assignments assignment
        ON assignment.attempt_id=attempt.id AND assignment.is_current
      JOIN public.hosted_serverless_output_barrier_completions barrier
        ON barrier.attempt_id=attempt.id AND barrier.assignment_id=assignment.id
     WHERE attempt.account_id=runtime.account_id AND attempt.workspace_id=runtime.workspace_id
       AND attempt.project_id=runtime.project_id
       AND attempt.project_revision_id=runtime.project_revision_id
       AND attempt.generation_request_id=runtime.generation_request_id
       AND attempt.state='SUCCEEDED';
    IF job_count<>2 OR (SELECT count(DISTINCT value->>'lane') FROM jsonb_array_elements(jobs) value)<>2 THEN
      RAISE EXCEPTION 'V213 technical capture provider association unavailable' USING ERRCODE='42501';
    END IF;
    result:=result||jsonb_build_array(jsonb_build_object('scopeIndex',scope_index,
      'accountId',runtime.account_id,'workspaceId',runtime.workspace_id,
      'projectId',runtime.project_id,'projectRevisionId',runtime.project_revision_id,
      'generationRequestId',runtime.generation_request_id,
      'render',jsonb_build_object('attemptId',render_attempt.id,
        'resultObjectKey',render_attempt.result_object_key,
        'resultContentType',render_attempt.result_content_type,
        'resultContentLength',render_attempt.result_content_length,
        'resultChecksumSha256',render_attempt.result_checksum_sha256,
        'outputObjectKey',output_receipt.object_key,
        'outputContentType',output_receipt.content_type,
        'outputContentLength',output_receipt.content_length,
        'outputChecksumSha256',output_receipt.checksum_sha256,
        'resultReceiptSha256',render_attempt.result_receipt_sha256),
      'jobs',jobs));
    scope_index:=scope_index+1;
  END LOOP;
  RETURN jsonb_build_object(
    'schemaVersion','videoforge.v213-acceptance-technical-capture-plan/v1',
    'workflowParams',supplied,'checkpoint',child.checkpoint,
    'outputBindingSha256',output_binding,'scopes',result);
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_acceptance_technical_capture(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; captures jsonb:=supplied->'captures';
  plan jsonb; plan_sha text; capture_sha text; scope jsonb; capture jsonb; provider jsonb;
  job jsonb; result_document jsonb; scope_index integer; existing
    public.hosted_full_live_acceptance_technical_captures%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['captures','outputBindingSha256','workflowParams']::text[]
     OR NOT public.videoforge_v213_acceptance_workflow_params_valid(params)
     OR jsonb_typeof(captures)<>'array' THEN
    RAISE EXCEPTION 'V213 technical capture invalid' USING ERRCODE='23514';
  END IF;
  plan:=public.videoforge_prepare_v213_acceptance_technical_capture(params);
  plan_sha:=public.videoforge_v213_jit_sha256(plan);
  IF supplied->>'outputBindingSha256'<>plan->>'outputBindingSha256'
     OR jsonb_array_length(captures)<>jsonb_array_length(plan->'scopes')
     OR (SELECT count(DISTINCT (value->>'scopeIndex')::integer)
           FROM jsonb_array_elements(captures) value)<>jsonb_array_length(captures) THEN
    RAISE EXCEPTION 'V213 technical capture plan drift' USING ERRCODE='23514';
  END IF;
  FOR scope IN SELECT value FROM jsonb_array_elements(plan->'scopes') value LOOP
    scope_index:=(scope->>'scopeIndex')::integer;
    SELECT value INTO capture FROM jsonb_array_elements(captures) value
     WHERE (value->>'scopeIndex')::integer=scope_index;
    result_document:=capture->'resultDocument';
    IF jsonb_typeof(capture)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(capture) key)
         IS DISTINCT FROM ARRAY['provider','resultBytesSha256','resultDocument','scopeIndex']::text[]
       OR capture->>'resultBytesSha256'<>scope#>>'{render,resultChecksumSha256}'
       OR jsonb_typeof(result_document)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(result_document) key)
         IS DISTINCT FROM ARRAY['attempt_id','error','output','probe','schema_version','status']::text[]
       OR result_document->>'schema_version'<>'render-job-result/v1'
       OR result_document->>'attempt_id'<>scope#>>'{render,attemptId}'
       OR result_document->>'status'<>'SUCCEEDED' OR result_document->'error'<>'null'::jsonb
       OR result_document#>>'{output,sha256}'<>scope#>>'{render,outputChecksumSha256}'
       OR (result_document#>>'{output,bytes}')::bigint<>(scope#>>'{render,outputContentLength}')::bigint
       OR result_document#>>'{probe,sha256}'<>scope#>>'{render,outputChecksumSha256}'
       OR (result_document#>>'{probe,bytes}')::bigint<>(scope#>>'{render,outputContentLength}')::bigint
       OR result_document#>>'{output,artifact_uri}'<>'vf-local://objects/sha256/'||
          substring(scope#>>'{render,outputChecksumSha256}' from 8 for 2)||'/'||
          substring(scope#>>'{render,outputChecksumSha256}' from 8)||'.mp4'
       OR jsonb_typeof(capture->'provider')<>'array'
       OR jsonb_array_length(capture->'provider')<>2 THEN
      RAISE EXCEPTION 'V213 technical capture result drift' USING ERRCODE='23514';
    END IF;
    FOR provider IN SELECT value FROM jsonb_array_elements(capture->'provider') value LOOP
      SELECT value INTO job FROM jsonb_array_elements(scope->'jobs') value
       WHERE value->>'lane'=provider->>'lane';
      IF jsonb_typeof(provider)<>'object'
         OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(provider) key)
           IS DISTINCT FROM ARRAY['delayTimeMs','executionTimeMs','lane','provenanceReceiptSha256',
             'providerJobId','providerJobIdSha256','status']::text[]
         OR provider->>'status'<>'COMPLETED' OR job IS NULL
         OR provider->>'providerJobId'<>job->>'providerJobId'
         OR provider->>'provenanceReceiptSha256'<>job->>'provenanceReceiptSha256'
         OR provider->>'providerJobIdSha256'<>'sha256:'||encode(sha256(
              convert_to(provider->>'providerJobId','UTF8')),'hex')
         OR jsonb_typeof(provider->'delayTimeMs')<>'number'
         OR jsonb_typeof(provider->'executionTimeMs')<>'number'
         OR (provider->>'delayTimeMs')::numeric<0
         OR (provider->>'delayTimeMs')::numeric<>
            trunc((provider->>'delayTimeMs')::numeric)
         OR (provider->>'delayTimeMs')::numeric>9007199254740991
         OR (provider->>'executionTimeMs')::numeric<1
         OR (provider->>'executionTimeMs')::numeric<>
            trunc((provider->>'executionTimeMs')::numeric)
         OR (provider->>'executionTimeMs')::numeric>9007199254740991 THEN
        RAISE EXCEPTION 'V213 technical capture provider drift' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END LOOP;
  capture_sha:=public.videoforge_v213_jit_sha256(supplied);
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_technical_captures row
   WHERE row.full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=params->>'operationId';
  IF existing.operation_id IS NOT NULL THEN
    IF existing.output_binding_sha256<>supplied->>'outputBindingSha256'
       OR existing.plan_sha256<>plan_sha OR existing.capture_sha256<>capture_sha
       OR existing.capture_document IS DISTINCT FROM supplied THEN
      RAISE EXCEPTION 'V213 technical capture replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_acceptance_technical_captures(full_live_authority_id,
      operation_id,output_binding_sha256,plan_sha256,capture_sha256,capture_document)
    VALUES((params->>'fullLiveAuthorityId')::uuid,params->>'operationId',
      supplied->>'outputBindingSha256',plan_sha,capture_sha,supplied);
  END IF;
  RETURN public.videoforge_read_v213_acceptance_workflow(params);
END;
$$;

CREATE FUNCTION public.videoforge_prepare_v213_v211_policy_action(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; action_name text:=supplied->>'action';
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE;
  mage public.serverless_endpoint_deployments%ROWTYPE;
  soulx public.serverless_endpoint_deployments%ROWTYPE; lanes jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['action','workflowParams']::text[]
     OR NOT public.videoforge_v213_acceptance_workflow_params_valid(params)
     OR params->>'checkpoint' IS DISTINCT FROM 'V2-11'
     OR action_name NOT IN ('APPLY_MAX2','RESTORE_MAX1') THEN
    RAISE EXCEPTION 'V213 V211 policy action request invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=params->>'operationId' AND row.checkpoint='V2-11';
  SELECT * INTO promotion FROM public.hosted_full_live_promotions row
   WHERE row.authority_id=child.full_live_authority_id;
  SELECT * INTO mage FROM public.serverless_endpoint_deployments row
   WHERE row.id=promotion.mage_deployment_id;
  SELECT * INTO soulx FROM public.serverless_endpoint_deployments row
   WHERE row.id=promotion.soulx_deployment_id;
  IF child.operation_id IS NULL OR promotion.id IS NULL
     OR child.workload_deadline_at<=transaction_timestamp()
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id
         AND authority.expires_at>transaction_timestamp())
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
       WHERE event.full_live_authority_id=child.full_live_authority_id
         AND event.operation_id=child.operation_id AND event.kind='CLAIMED'
         AND event.workflow_id=params->>'workflowId'
         AND event.request_sha256=params->>'requestSha256')
     OR mage.id IS NULL OR soulx.id IS NULL OR mage.lane<>'mage_image'
     OR soulx.lane<>'soulx_avatar' OR NOT mage.is_active OR NOT soulx.is_active
     OR mage.provider_endpoint_id IS NULL OR soulx.provider_endpoint_id IS NULL
     OR mage.provider_template_id IS NULL OR soulx.provider_template_id IS NULL
     OR mage.endpoint_id_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(
          convert_to(mage.provider_endpoint_id,'UTF8')),'hex')
     OR soulx.endpoint_id_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(
          convert_to(soulx.provider_endpoint_id,'UTF8')),'hex')
     OR mage.timeout_evidence#>>'{sealed_lineage,endpointTemplateIdSha256}' IS DISTINCT FROM
        'sha256:'||encode(sha256(convert_to(mage.provider_template_id,'UTF8')),'hex')
     OR soulx.timeout_evidence#>>'{sealed_lineage,endpointTemplateIdSha256}' IS DISTINCT FROM
        'sha256:'||encode(sha256(convert_to(soulx.provider_template_id,'UTF8')),'hex')
     OR mage.volume_id_sha256 IS NULL OR soulx.volume_id_sha256 IS NULL
     OR mage.volume_manifest_sha256 IS NULL OR soulx.volume_manifest_sha256 IS NULL
     OR mage.worker_count_min<>0 OR soulx.worker_count_min<>0
     OR mage.worker_count_max<>1 OR soulx.worker_count_max<>1
     OR mage.retained_active_workers<>0 OR soulx.retained_active_workers<>0
     OR (action_name='APPLY_MAX2' AND EXISTS(SELECT 1
       FROM public.hosted_full_live_v211_policy_actions action
       WHERE action.full_live_authority_id=child.full_live_authority_id
         AND action.operation_id=child.operation_id AND action.action='RESTORE_MAX1'))
     OR (action_name='RESTORE_MAX1' AND NOT EXISTS(SELECT 1
       FROM public.hosted_full_live_v211_restore_authorizations restore_auth
       WHERE restore_auth.full_live_authority_id=child.full_live_authority_id
         AND restore_auth.operation_id=child.operation_id)) THEN
    RAISE EXCEPTION 'V213 V211 policy action authority unavailable' USING ERRCODE='42501';
  END IF;
  lanes:=jsonb_build_array(
    jsonb_build_object('lane','mage_image','endpointId',mage.provider_endpoint_id,
      'endpointIdSha256',mage.endpoint_id_sha256,'templateId',mage.provider_template_id,
      'templateIdSha256',mage.timeout_evidence#>>'{sealed_lineage,endpointTemplateIdSha256}',
      'volumeIdSha256',mage.volume_id_sha256,
      'volumeManifestSha256',mage.volume_manifest_sha256),
    jsonb_build_object('lane','soulx_avatar','endpointId',soulx.provider_endpoint_id,
      'endpointIdSha256',soulx.endpoint_id_sha256,'templateId',soulx.provider_template_id,
      'templateIdSha256',soulx.timeout_evidence#>>'{sealed_lineage,endpointTemplateIdSha256}',
      'volumeIdSha256',soulx.volume_id_sha256,
      'volumeManifestSha256',soulx.volume_manifest_sha256));
  RETURN jsonb_build_object('schemaVersion','videoforge.v213-v211-policy-action-plan/v1',
    'workflowParams',params,'action',action_name,'lanes',lanes);
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_v211_policy_action(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; action_name text:=supplied->>'action';
  receipts jsonb:=supplied->'receipts'; plan jsonb; receipt jsonb; lane jsonb;
  signature jsonb; readback jsonb; before_zero jsonb; after_zero jsonb;
  secret text; expected_hash text; bundle_hash text; db_now timestamptz:=transaction_timestamp();
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  existing public.hosted_full_live_v211_policy_actions%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['action','receipts','workflowParams']::text[]
     OR jsonb_typeof(receipts)<>'array' OR jsonb_array_length(receipts)<>2 THEN
    RAISE EXCEPTION 'V213 V211 policy receipts invalid' USING ERRCODE='23514';
  END IF;
  plan:=public.videoforge_prepare_v213_v211_policy_action(
    jsonb_build_object('workflowParams',params,'action',action_name));
  FOR receipt IN SELECT value FROM jsonb_array_elements(receipts) value LOOP
    SELECT value INTO lane FROM jsonb_array_elements(plan->'lanes') value
     WHERE value->>'lane'=receipt->>'lane';
    signature:=receipt->'signature'; readback:=receipt->'providerReadback';
    before_zero:=receipt->'zeroWorkersBefore'; after_zero:=receipt->'zeroWorkersAfter';
    IF jsonb_typeof(receipt)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(receipt) key)
         IS DISTINCT FROM ARRAY['action','lane','providerReadback','providerReadbackSha256',
           'receiptSha256','schemaVersion','signature','volumeManifestSha256','workflowParams',
           'zeroWorkersAfter','zeroWorkersBefore']::text[]
       OR receipt->>'schemaVersion' IS DISTINCT FROM
          'videoforge.v213-v211-endpoint-policy-receipt/v1'
       OR receipt->'workflowParams' IS DISTINCT FROM params
       OR receipt->>'action' IS DISTINCT FROM action_name OR lane IS NULL
       OR receipt->>'volumeManifestSha256' IS DISTINCT FROM lane->>'volumeManifestSha256'
       OR jsonb_typeof(readback) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(readback) key)
         IS DISTINCT FROM ARRAY['endpointIdSha256','executionTimeoutMs','gpu','gpuCount',
           'idleTimeout','region','scalerType','scalerValue','schemaVersion','templateIdSha256',
           'volumeIdSha256','workersMax','workersMin']::text[]
       OR readback->>'schemaVersion' IS DISTINCT FROM
          'videoforge.runpod-v207-endpoint-policy-readback/v1'
       OR readback->>'endpointIdSha256' IS DISTINCT FROM lane->>'endpointIdSha256'
       OR readback->>'templateIdSha256' IS DISTINCT FROM lane->>'templateIdSha256'
       OR readback->>'volumeIdSha256' IS DISTINCT FROM lane->>'volumeIdSha256'
       OR readback->>'region' IS DISTINCT FROM 'EU-RO-1'
       OR readback->>'gpu' IS DISTINCT FROM 'NVIDIA GeForce RTX 4090'
       OR readback->'workersMin' IS DISTINCT FROM '0'::jsonb
       OR readback->'workersMax' IS DISTINCT FROM
          to_jsonb(CASE action_name WHEN 'APPLY_MAX2' THEN 2 ELSE 1 END)
       OR readback->'gpuCount' IS DISTINCT FROM '1'::jsonb
       OR readback->'idleTimeout' IS DISTINCT FROM '5'::jsonb
       OR readback->'executionTimeoutMs' IS DISTINCT FROM '2400000'::jsonb
       OR readback->>'scalerType' IS DISTINCT FROM 'REQUEST_COUNT'
       OR readback->'scalerValue' IS DISTINCT FROM '1'::jsonb
       OR receipt->>'providerReadbackSha256' IS DISTINCT FROM
          public.videoforge_v213_jit_sha256(readback)
       OR EXISTS(SELECT 1 FROM (VALUES(before_zero),(after_zero)) zero_read(value)
         WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
            OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
               IS DISTINCT FROM ARRAY['observedAt','queuedJobs','workersTotal']::text[]
            OR value->'queuedJobs' IS DISTINCT FROM '0'::jsonb
            OR value->'workersTotal' IS DISTINCT FROM '0'::jsonb
            OR (value->>'observedAt')::timestamptz>db_now+interval '30 seconds'
            OR (value->>'observedAt')::timestamptz<db_now-interval '10 minutes')
       OR receipt->>'receiptSha256' IS DISTINCT FROM
          public.videoforge_v213_jit_sha256(receipt-'receiptSha256'-'signature')
       OR jsonb_typeof(signature) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(signature) key)
         IS DISTINCT FROM ARRAY['algorithm','keyId','sha256','value']::text[]
       OR signature->>'algorithm' IS DISTINCT FROM 'HMAC-SHA256'
       OR coalesce(signature->>'value','') !~ '^[0-9a-f]{64}$'
       OR signature->>'sha256' IS DISTINCT FROM public.videoforge_v213_jit_sha256(
          jsonb_build_object('signatureValue',signature->>'value')) THEN
      RAISE EXCEPTION 'V213 V211 policy receipt drift' USING ERRCODE='23514';
    END IF;
    SELECT secret_hex INTO secret FROM public.hosted_provider_proof_keys proof
     WHERE proof.key_id=signature->>'keyId' AND proof.active;
    expected_hash:=encode(hmac(convert_to(public.videoforge_canonical_jsonb(
      receipt-'signature'),'UTF8'),decode(secret,'hex'),'sha256'),'hex');
    IF secret IS NULL OR signature->>'value' IS DISTINCT FROM expected_hash THEN
      RAISE EXCEPTION 'V213 V211 policy signature invalid' USING ERRCODE='42501';
    END IF;
  END LOOP;
  IF (SELECT array_agg(value->>'lane' ORDER BY ordinality)
      FROM jsonb_array_elements(receipts) WITH ORDINALITY item(value,ordinality))
      IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'V213 V211 policy lane order invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=params->>'operationId';
  bundle_hash:=public.videoforge_v213_jit_sha256(receipts);
  SELECT * INTO existing FROM public.hosted_full_live_v211_policy_actions row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id AND row.action=action_name;
  IF existing.action IS NOT NULL THEN
    IF existing.receipts_document IS DISTINCT FROM receipts
       OR existing.receipts_sha256<>bundle_hash THEN
      RAISE EXCEPTION 'V213 V211 policy replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_v211_policy_actions(full_live_authority_id,
      operation_id,action,receipts_document,receipts_sha256)
    VALUES(child.full_live_authority_id,child.operation_id,action_name,receipts,bundle_hash);
  END IF;
  RETURN public.videoforge_read_v213_acceptance_workflow(params);
END;
$$;

CREATE FUNCTION public.videoforge_v213_acceptance_workflow_scopes(
  supplied_full_live_authority_id uuid, supplied_operation_id text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; identity jsonb;
  result jsonb:='[]'::jsonb; role text; approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  batch_count integer; cancel_at timestamptz; stop_at timestamptz;
BEGIN
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=supplied_full_live_authority_id
     AND operation_id=supplied_operation_id;
  SELECT facts_row.* INTO facts FROM public.hosted_full_live_materialization_facts facts_row
   JOIN public.hosted_full_live_materialization_challenges challenge ON challenge.id=facts_row.challenge_id
   WHERE challenge.full_live_authority_id=supplied_full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  IF child.operation_id IS NULL OR facts.challenge_id IS NULL THEN RETURN NULL; END IF;
  FOREACH role IN ARRAY (CASE WHEN child.checkpoint='V2-11'
    THEN ARRAY['primary','secondary']::text[] ELSE ARRAY['primary']::text[] END) LOOP
    identity:=facts.facts_document->'roleScopedIdentities'->role;
    SELECT * INTO approval FROM public.hosted_paid_dispatch_approvals paid
     WHERE paid.account_id=(identity->>'accountId')::uuid
       AND paid.workspace_id=(identity->>'workspaceId')::uuid
       AND paid.project_id=(identity->>'projectId')::uuid
       AND paid.project_revision_id=(identity->>'projectRevisionId')::uuid
       AND paid.generation_request_id=(identity->>'generationRequestId')::uuid;
    SELECT count(*) INTO batch_count FROM public.hosted_lane_batches batch
     WHERE batch.account_id=approval.account_id AND batch.workspace_id=approval.workspace_id
       AND batch.generation_request_id=approval.generation_request_id;
    IF approval.id IS NULL OR batch_count<>2 THEN RETURN NULL; END IF;
    stop_at:=least(child.workload_deadline_at,approval.expires_at);
    cancel_at:=stop_at-interval '10 minutes';
    IF stop_at<=transaction_timestamp() OR cancel_at<=child.issued_at THEN RETURN NULL; END IF;
    result:=result||jsonb_build_array(jsonb_build_object(
      'accountId',identity->>'accountId','workspaceId',identity->>'workspaceId',
      'projectId',identity->>'projectId','projectRevisionId',identity->>'projectRevisionId',
      'generationRequestId',identity->>'generationRequestId',
      'cancelAt',public.videoforge_v213_jit_iso(cancel_at),
      'stopAt',public.videoforge_v213_jit_iso(stop_at)));
  END LOOP;
  RETURN result;
END;
$$;

CREATE FUNCTION public.videoforge_v213_acceptance_workflow_output(
  supplied_full_live_authority_id uuid, supplied_operation_id text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE persisted public.hosted_full_live_acceptance_workflow_outputs%ROWTYPE;
BEGIN
  SELECT * INTO persisted FROM public.hosted_full_live_acceptance_workflow_outputs output
   WHERE output.full_live_authority_id=supplied_full_live_authority_id
     AND output.operation_id=supplied_operation_id;
  IF persisted.operation_id IS NULL
     OR persisted.output_sha256<>public.videoforge_v213_jit_sha256(persisted.output_document)
     OR persisted.output_binding_sha256 IS DISTINCT FROM
        public.videoforge_v213_acceptance_output_binding(
          supplied_full_live_authority_id,supplied_operation_id) THEN
    RETURN NULL;
  END IF;
  RETURN persisted.output_document;
END;
$$;

CREATE FUNCTION public.videoforge_claim_v213_acceptance_workflow(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  materialized public.hosted_full_live_jit_materializations%ROWTYPE;
  scopes jsonb; output jsonb; output_binding text; requirements jsonb;
  existing public.hosted_full_live_acceptance_workflow_events%ROWTYPE;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied) THEN
    RAISE EXCEPTION 'V213 acceptance workflow parameters invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',222));
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId' AND checkpoint=supplied->>'checkpoint';
  SELECT * INTO materialized FROM public.hosted_full_live_jit_materializations
   WHERE full_live_authority_id=child.full_live_authority_id AND operation_id=child.operation_id;
  IF child.operation_id IS NULL OR child.expires_at<=transaction_timestamp()
     OR materialized.request_sha256<>supplied->>'requestSha256'
     OR materialized.execution_document->>'workflowId'<>supplied->>'workflowId'
     OR materialized.execution_document->'workflowParams' IS DISTINCT FROM supplied
     OR materialized.execution_document->>'workloadDeadlineAt'<>
        public.videoforge_v213_jit_iso(child.workload_deadline_at)
     OR (materialized.execution_document->>'pollIntervalMs')::integer<>child.poll_interval_ms
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       JOIN public.hosted_full_live_promotions promotion ON promotion.authority_id=authority.id
       WHERE authority.id=child.full_live_authority_id
         AND authority.expires_at>transaction_timestamp()) THEN
    RAISE EXCEPTION 'V213 acceptance workflow authority unavailable' USING ERRCODE='42501';
  END IF;
  scopes:=public.videoforge_v213_acceptance_workflow_scopes(child.full_live_authority_id,child.operation_id);
  IF scopes IS NULL OR jsonb_array_length(scopes)<>
       (CASE WHEN child.checkpoint='V2-11' THEN 2 ELSE 1 END) THEN
    RAISE EXCEPTION 'V213 acceptance workflow pair state unavailable' USING ERRCODE='42501';
  END IF;
  output_binding:=public.videoforge_v213_acceptance_output_binding(
    child.full_live_authority_id,child.operation_id);
  requirements:=CASE child.checkpoint
    WHEN 'V2-10' THEN jsonb_build_array('V210_REAL_CHROME','V210_VISUAL_DECISION')
    WHEN 'V2-11' THEN '[]'::jsonb
    WHEN 'V2-12' THEN jsonb_build_array('V212_REAL_CHROME','V212_VISUAL_DECISION')
    ELSE '[]'::jsonb END;
  IF output_binding IS NOT NULL THEN
    INSERT INTO public.hosted_full_live_acceptance_operator_evidence_requests(
      full_live_authority_id,operation_id,output_binding_sha256,requirements)
    VALUES(child.full_live_authority_id,child.operation_id,output_binding,requirements)
    ON CONFLICT(full_live_authority_id,operation_id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_operator_evidence_requests request
      WHERE request.full_live_authority_id=child.full_live_authority_id
        AND request.operation_id=child.operation_id
        AND request.output_binding_sha256=output_binding
        AND request.requirements=requirements) THEN
      RAISE EXCEPTION 'V213 acceptance evidence request drift' USING ERRCODE='23505';
    END IF;
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_workflow_events
   WHERE full_live_authority_id=child.full_live_authority_id AND operation_id=child.operation_id
     AND kind='CLAIMED';
  IF existing.operation_id IS NULL THEN
    INSERT INTO public.hosted_full_live_acceptance_workflow_events(full_live_authority_id,
      operation_id,sequence,kind,workflow_id,request_sha256)
    VALUES(child.full_live_authority_id,child.operation_id,1,'CLAIMED',
      supplied->>'workflowId',supplied->>'requestSha256');
  ELSIF existing.workflow_id<>supplied->>'workflowId'
     OR existing.request_sha256<>supplied->>'requestSha256' THEN
    RAISE EXCEPTION 'V213 acceptance workflow replay drift' USING ERRCODE='23505';
  END IF;
  output:=public.videoforge_v213_acceptance_workflow_output(child.full_live_authority_id,child.operation_id);
  RETURN jsonb_build_object('schemaVersion','videoforge.v213-acceptance-workflow-plan/v1',
    'fullLiveAuthorityId',child.full_live_authority_id,'operationId',child.operation_id,
    'checkpoint',child.checkpoint,'workflowId',supplied->>'workflowId',
    'requestSha256',materialized.request_sha256,
    'workloadDeadlineAt',public.videoforge_v213_jit_iso(child.workload_deadline_at),
    'pollIntervalMs',child.poll_interval_ms,'scopes',scopes,
    'sameAccountWaiter',CASE WHEN child.checkpoint='V2-11' THEN
      (SELECT facts.facts_document->'roleScopedIdentities'->'sameAccountWaiter'
       FROM public.hosted_full_live_materialization_facts facts
       JOIN public.hosted_full_live_materialization_challenges challenge
         ON challenge.id=facts.challenge_id
       WHERE challenge.full_live_authority_id=child.full_live_authority_id
         AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256)
      ELSE NULL END,
    'fairnessProbe',CASE WHEN child.checkpoint='V2-11' THEN
      (SELECT facts.facts_document->'roleScopedIdentities'->'fairnessProbe'
       FROM public.hosted_full_live_materialization_facts facts
       JOIN public.hosted_full_live_materialization_challenges challenge
         ON challenge.id=facts.challenge_id
       WHERE challenge.full_live_authority_id=child.full_live_authority_id
         AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256)
      ELSE NULL END,
    'output',output);
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_acceptance_workflow(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  output jsonb; cancel_requested boolean; terminal boolean; phase text;
  output_binding text; requirements jsonb; evidence_count integer; zero_count integer;
  technical_captured boolean; v211_event_count integer:=0;
  v211_max2_applied boolean:=false; v211_max1_restored boolean:=false;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied) THEN
    RAISE EXCEPTION 'V213 acceptance workflow parameters invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId' AND checkpoint=supplied->>'checkpoint';
  IF child.operation_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id AND event.kind='CLAIMED'
       AND event.workflow_id=supplied->>'workflowId'
       AND event.request_sha256=supplied->>'requestSha256') THEN
    RAISE EXCEPTION 'V213 acceptance workflow unavailable' USING ERRCODE='42501';
  END IF;
  output_binding:=public.videoforge_v213_acceptance_output_binding(
    child.full_live_authority_id,child.operation_id);
  requirements:=CASE child.checkpoint
    WHEN 'V2-10' THEN jsonb_build_array('V210_REAL_CHROME','V210_VISUAL_DECISION')
    WHEN 'V2-11' THEN '[]'::jsonb
    WHEN 'V2-12' THEN jsonb_build_array('V212_REAL_CHROME','V212_VISUAL_DECISION')
    ELSE '[]'::jsonb END;
  IF output_binding IS NOT NULL THEN
    INSERT INTO public.hosted_full_live_acceptance_operator_evidence_requests(
      full_live_authority_id,operation_id,output_binding_sha256,requirements)
    VALUES(child.full_live_authority_id,child.operation_id,output_binding,requirements)
    ON CONFLICT(full_live_authority_id,operation_id) DO NOTHING;
  END IF;
  SELECT count(*) INTO evidence_count
    FROM public.hosted_full_live_acceptance_operator_evidence evidence
   WHERE evidence.full_live_authority_id=child.full_live_authority_id
     AND evidence.operation_id=child.operation_id
     AND evidence.kind IN (SELECT jsonb_array_elements_text(requirements));
  SELECT count(*) INTO zero_count FROM public.hosted_full_live_acceptance_zero_worker_reads zero
   WHERE zero.full_live_authority_id=child.full_live_authority_id
     AND zero.operation_id=child.operation_id;
  technical_captured:=EXISTS(SELECT 1
    FROM public.hosted_full_live_acceptance_technical_captures capture
   WHERE capture.full_live_authority_id=child.full_live_authority_id
     AND capture.operation_id=child.operation_id
     AND capture.output_binding_sha256=output_binding);
  IF child.checkpoint='V2-11' THEN
    SELECT count(*) INTO v211_event_count
      FROM public.hosted_full_live_v211_scenario_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id;
    v211_max2_applied:=EXISTS(SELECT 1
      FROM public.hosted_full_live_v211_policy_actions policy
     WHERE policy.full_live_authority_id=child.full_live_authority_id
       AND policy.operation_id=child.operation_id AND policy.action='APPLY_MAX2');
    v211_max1_restored:=EXISTS(SELECT 1
      FROM public.hosted_full_live_v211_policy_actions policy
     WHERE policy.full_live_authority_id=child.full_live_authority_id
       AND policy.operation_id=child.operation_id AND policy.action='RESTORE_MAX1');
  END IF;
  output:=public.videoforge_v213_acceptance_workflow_output(child.full_live_authority_id,child.operation_id);
  cancel_requested:=transaction_timestamp()>=child.workload_deadline_at OR EXISTS(
    SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id AND event.kind='CANCEL_REQUESTED');
  terminal:=output IS NOT NULL;
  phase:=CASE
    WHEN cancel_requested THEN 'CLEANUP_ONLY'
    WHEN terminal THEN 'COMPLETE'
    WHEN child.checkpoint='V2-11' AND NOT v211_max2_applied THEN 'PAIR_EXECUTION'
    WHEN child.checkpoint='V2-11' AND v211_event_count=0 THEN 'V211_WAITING_PROBES'
    WHEN child.checkpoint='V2-11' AND v211_event_count=1 THEN 'V211_FAIR_PROMOTION'
    WHEN child.checkpoint='V2-11' AND v211_event_count=2 THEN 'V211_CANCEL_RECONCILIATION'
    WHEN child.checkpoint='V2-11' AND v211_event_count=3 AND NOT v211_max1_restored
      THEN 'V211_MAX1_RESTORE'
    WHEN output_binding IS NULL THEN 'PAIR_EXECUTION'
    WHEN NOT technical_captured THEN 'TECHNICAL_CAPTURE'
    WHEN evidence_count<jsonb_array_length(requirements) THEN 'PAUSED_AWAITING_OPERATOR_EVIDENCE'
    WHEN zero_count<3 THEN 'ZERO_WORKER_READS'
    ELSE 'BILLING_SETTLEMENT' END;
  RETURN jsonb_build_object('schemaVersion','videoforge.v213-acceptance-workflow-state/v1',
    'databaseNow',public.videoforge_v213_jit_iso(transaction_timestamp()),
    'phase',phase,'cancelRequested',cancel_requested,'terminal',terminal,
    'zeroWorkerReadCount',zero_count,'output',output);
END;
$$;

CREATE FUNCTION public.videoforge_request_v213_acceptance_workflow_cleanup(supplied jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_workflow_events%ROWTYPE;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied) THEN
    RAISE EXCEPTION 'V213 acceptance workflow parameters invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',223));
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId' AND checkpoint=supplied->>'checkpoint';
  IF child.operation_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id AND event.kind='CLAIMED'
       AND event.workflow_id=supplied->>'workflowId'
       AND event.request_sha256=supplied->>'requestSha256') THEN
    RAISE EXCEPTION 'V213 acceptance workflow unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_workflow_events
   WHERE full_live_authority_id=child.full_live_authority_id AND operation_id=child.operation_id
     AND kind='CANCEL_REQUESTED';
  IF existing.operation_id IS NULL THEN
    INSERT INTO public.hosted_full_live_acceptance_workflow_events(full_live_authority_id,
      operation_id,sequence,kind,workflow_id,request_sha256)
    VALUES(child.full_live_authority_id,child.operation_id,2,'CANCEL_REQUESTED',
      supplied->>'workflowId',supplied->>'requestSha256');
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.videoforge_request_v213_acceptance_operator_evidence(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE state jsonb;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied)
     OR supplied->>'checkpoint' NOT IN ('V2-10','V2-12') THEN
    RAISE EXCEPTION 'V213 operator evidence request invalid' USING ERRCODE='23514';
  END IF;
  state:=public.videoforge_read_v213_acceptance_workflow(supplied);
  IF state->>'phase'<>'PAUSED_AWAITING_OPERATOR_EVIDENCE' THEN
    RAISE EXCEPTION 'V213 operator evidence is not requested by current output state'
      USING ERRCODE='55000';
  END IF;
  RETURN state;
END;
$$;

CREATE FUNCTION public.videoforge_exercise_v213_acceptance_checkpoint_scenario(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE state jsonb; child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; probe jsonb;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied)
     OR supplied->>'checkpoint'<>'V2-11' THEN
    RAISE EXCEPTION 'V213 checkpoint scenario request invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges c ON c.id=f.challenge_id
   WHERE c.full_live_authority_id=child.full_live_authority_id
     AND c.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  probe:=facts.facts_document->'roleScopedIdentities'->'fairnessProbe';
  IF child.operation_id IS NULL OR child.workload_deadline_at<=transaction_timestamp()
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id
         AND authority.expires_at>transaction_timestamp())
     OR probe IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.generation_requests request
     WHERE request.id=(probe->>'generationRequestId')::uuid
       AND request.account_id=(probe->>'accountId')::uuid
       AND request.workspace_id=(probe->>'workspaceId')::uuid
       AND request.project_id=(probe->>'projectId')::uuid
       AND request.project_revision_id=(probe->>'projectRevisionId')::uuid
       AND request.state='WAITING') THEN
    RAISE EXCEPTION 'V213 checkpoint scenario durable fairness probe unavailable'
      USING ERRCODE='42501';
  END IF;
  -- This function observes the DB-owned waiter only. It does not dispatch the probe or manufacture
  -- fairness/failure/ownership receipts; exact evidence ingestion remains required.
  state:=public.videoforge_read_v213_acceptance_workflow(supplied);
  RETURN state;
END;
$$;

CREATE FUNCTION public.videoforge_prepare_v213_v211_scenario_step(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; event_count integer;
  action_name text; probe jsonb;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied)
     OR supplied->>'checkpoint' IS DISTINCT FROM 'V2-11' THEN
    RAISE EXCEPTION 'V213 V211 scenario step request invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=supplied->>'operationId' AND row.checkpoint='V2-11';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges challenge ON challenge.id=f.challenge_id
   WHERE challenge.full_live_authority_id=child.full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  SELECT count(*) INTO event_count FROM public.hosted_full_live_v211_scenario_events event
   WHERE event.full_live_authority_id=child.full_live_authority_id
     AND event.operation_id=child.operation_id;
  probe:=facts.facts_document->'roleScopedIdentities'->'fairnessProbe';
  IF child.operation_id IS NULL OR facts.challenge_id IS NULL OR probe IS NULL
     OR child.workload_deadline_at<=transaction_timestamp()
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id
         AND authority.expires_at>transaction_timestamp())
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_v211_policy_actions action
       WHERE action.full_live_authority_id=child.full_live_authority_id
         AND action.operation_id=child.operation_id AND action.action='APPLY_MAX2') THEN
    RAISE EXCEPTION 'V213 V211 scenario step authority unavailable' USING ERRCODE='42501';
  END IF;
  IF event_count>=3 THEN
    RAISE EXCEPTION 'V213 V211 scenario already complete' USING ERRCODE='55000';
  END IF;
  action_name:=CASE event_count WHEN 0 THEN 'OBSERVE_PROBE_WAITS'
    WHEN 1 THEN 'OBSERVE_FAIR_PROMOTION' ELSE 'CANCEL_PROMOTED_PROBE' END;
  RETURN jsonb_build_object('schemaVersion','videoforge.v213-v211-scenario-step/v1',
    'workflowParams',supplied,'action',action_name,'promotedProbe',probe);
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_v211_scenario_step(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; action_name text:=supplied->>'action';
  plan jsonb; child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; primary_identity jsonb;
  waiter jsonb; probe jsonb; waiter_request public.generation_requests%ROWTYPE;
  probe_request public.generation_requests%ROWTYPE; probe_lease public.provider_workload_leases%ROWTYPE;
  waiter_audit public.generation_queue_audits%ROWTYPE; probe_audit public.generation_queue_audits%ROWTYPE;
  source_facts jsonb; source_hash text; expected_sequence integer;
  existing public.hosted_full_live_v211_scenario_events%ROWTYPE; prior_count integer;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['action','cancellationSha256','promotedProbe',
         'reconciliationSha256','workflowParams']::text[]
     OR NOT public.videoforge_v213_acceptance_workflow_params_valid(params)
     OR params->>'checkpoint' IS DISTINCT FROM 'V2-11'
     OR (action_name='CANCEL_PROMOTED_PROBE' AND (
       coalesce(supplied->>'cancellationSha256','') !~ '^sha256:[0-9a-f]{64}$'
       OR coalesce(supplied->>'reconciliationSha256','') !~ '^sha256:[0-9a-f]{64}$'))
     OR (action_name<>'CANCEL_PROMOTED_PROBE' AND (
       supplied->'cancellationSha256' IS DISTINCT FROM 'null'::jsonb
       OR supplied->'reconciliationSha256' IS DISTINCT FROM 'null'::jsonb)) THEN
    RAISE EXCEPTION 'V213 V211 scenario record invalid' USING ERRCODE='23514';
  END IF;
  plan:=public.videoforge_prepare_v213_v211_scenario_step(params);
  IF supplied->>'action' IS DISTINCT FROM plan->>'action'
     OR supplied->'promotedProbe' IS DISTINCT FROM plan->'promotedProbe' THEN
    RAISE EXCEPTION 'V213 V211 scenario action drift' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=params->>'operationId';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges challenge ON challenge.id=f.challenge_id
   WHERE challenge.full_live_authority_id=child.full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  primary_identity:=facts.facts_document->'roleScopedIdentities'->'primary';
  waiter:=facts.facts_document->'roleScopedIdentities'->'sameAccountWaiter';
  probe:=facts.facts_document->'roleScopedIdentities'->'fairnessProbe';
  SELECT * INTO waiter_request FROM public.generation_requests request
   WHERE request.id=(waiter->>'generationRequestId')::uuid
     AND request.account_id=(waiter->>'accountId')::uuid
     AND request.workspace_id=(waiter->>'workspaceId')::uuid;
  SELECT * INTO probe_request FROM public.generation_requests request
   WHERE request.id=(probe->>'generationRequestId')::uuid
     AND request.account_id=(probe->>'accountId')::uuid
     AND request.workspace_id=(probe->>'workspaceId')::uuid;
  SELECT * INTO probe_lease FROM public.provider_workload_leases lease
   WHERE lease.generation_request_id=probe_request.id ORDER BY lease.acquired_at DESC LIMIT 1;
  SELECT * INTO waiter_audit FROM public.generation_queue_audits audit
   WHERE audit.request_id=waiter_request.id AND audit.operation='ENQUEUE'
   ORDER BY audit.occurred_at ASC,audit.id ASC LIMIT 1;
  SELECT * INTO probe_audit FROM public.generation_queue_audits audit
   WHERE audit.request_id=probe_request.id
     AND audit.operation=CASE action_name WHEN 'OBSERVE_PROBE_WAITS' THEN 'ENQUEUE'
       WHEN 'OBSERVE_FAIR_PROMOTION' THEN 'PROMOTE' ELSE 'CANCEL_ACTIVE' END
   ORDER BY audit.occurred_at DESC,audit.id DESC LIMIT 1;
  SELECT count(*) INTO prior_count FROM public.hosted_full_live_v211_scenario_events event
   WHERE event.full_live_authority_id=child.full_live_authority_id
     AND event.operation_id=child.operation_id;
  expected_sequence:=prior_count+1;
  IF action_name='OBSERVE_PROBE_WAITS' THEN
    IF waiter_request.state<>'WAITING' OR probe_request.state<>'WAITING'
       OR waiter_audit.id IS NULL OR probe_audit.id IS NULL
       OR EXISTS(SELECT 1 FROM public.provider_workload_leases lease
         WHERE lease.generation_request_id IN (waiter_request.id,probe_request.id)
           AND lease.state='ACTIVE') THEN
      RETURN public.videoforge_read_v213_acceptance_workflow(params);
    END IF;
    source_facts:=jsonb_build_object('sameAccountWaiterGenerationRequestId',waiter_request.id,
      'sameAccountWaiterQueueAuditReceiptSha256',public.videoforge_v213_jit_sha256(to_jsonb(waiter_audit)),
      'fairnessProbeGenerationRequestId',probe_request.id,
      'fairnessProbeQueueAuditReceiptSha256',public.videoforge_v213_jit_sha256(to_jsonb(probe_audit)),
      'bothWaiting',true);
  ELSIF action_name='OBSERVE_FAIR_PROMOTION' THEN
    IF waiter_request.state<>'WAITING' OR probe_request.state NOT IN ('ADMITTED','ACTIVE','CANCELLING')
       OR probe_lease.id IS NULL OR probe_lease.state<>'ACTIVE' OR probe_audit.id IS NULL
       OR probe_audit.lease_id IS DISTINCT FROM probe_lease.id THEN
      RETURN public.videoforge_read_v213_acceptance_workflow(params);
    END IF;
    source_facts:=jsonb_build_object('generationRequestId',probe_request.id,
      'promotionReceiptSha256',public.videoforge_v213_jit_sha256(to_jsonb(probe_audit)),
      'leaseId',probe_lease.id,'slot',probe_lease.slot,
      'sameAccountWaiterRemainedWaiting',true);
  ELSE
    SELECT jsonb_build_object('cancellation',cancellation.cancellation_document,
      'reconciliation',reconciliation.reconciliation_document) INTO source_facts
      FROM public.hosted_full_live_v211_probe_cancellations cancellation
      JOIN public.hosted_full_live_v211_probe_reconciliations reconciliation
        ON reconciliation.full_live_authority_id=cancellation.full_live_authority_id
       AND reconciliation.operation_id=cancellation.operation_id
     WHERE cancellation.full_live_authority_id=child.full_live_authority_id
       AND cancellation.operation_id=child.operation_id
       AND cancellation.cancellation_sha256=supplied->>'cancellationSha256'
       AND reconciliation.reconciliation_sha256=supplied->>'reconciliationSha256'
       AND cancellation.generation_request_id=(probe->>'generationRequestId')::uuid
       AND reconciliation.generation_request_id=cancellation.generation_request_id;
    IF source_facts IS NULL THEN RETURN public.videoforge_read_v213_acceptance_workflow(params); END IF;
  END IF;
  source_hash:=public.videoforge_v213_jit_sha256(source_facts);
  SELECT * INTO existing FROM public.hosted_full_live_v211_scenario_events event
   WHERE event.full_live_authority_id=child.full_live_authority_id
     AND event.operation_id=child.operation_id AND event.action=action_name;
  IF existing.action IS NOT NULL THEN
    IF existing.promoted_probe IS DISTINCT FROM probe OR existing.source_facts IS DISTINCT FROM source_facts
       OR existing.source_facts_sha256<>source_hash THEN
      RAISE EXCEPTION 'V213 V211 scenario replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_v211_scenario_events(full_live_authority_id,
      operation_id,sequence,action,promoted_probe,source_facts,source_facts_sha256)
    VALUES(child.full_live_authority_id,child.operation_id,expected_sequence,action_name,
      probe,source_facts,source_hash);
  END IF;
  RETURN public.videoforge_read_v213_acceptance_workflow(params);
END;
$$;

CREATE FUNCTION public.videoforge_cancel_v213_v211_promoted_probe(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; probe jsonb;
  request public.generation_requests%ROWTYPE; lease public.provider_workload_leases%ROWTYPE;
  assignment record; assignment_count integer; capacity public.global_generation_capacity%ROWTYPE;
  previous_account text; base jsonb; cancellation_hash text;
  existing public.hosted_full_live_v211_probe_cancellations%ROWTYPE; db_now timestamptz:=transaction_timestamp();
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['generationRequestId','workflowParams']::text[]
     OR NOT public.videoforge_v213_acceptance_workflow_params_valid(params)
     OR params->>'checkpoint' IS DISTINCT FROM 'V2-11'
     OR coalesce(supplied->>'generationRequestId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'V213 V211 promoted probe cancellation invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=params->>'operationId' AND row.checkpoint='V2-11';
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges challenge ON challenge.id=f.challenge_id
   WHERE challenge.full_live_authority_id=child.full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  probe:=facts.facts_document->'roleScopedIdentities'->'fairnessProbe';
  SELECT * INTO existing FROM public.hosted_full_live_v211_probe_cancellations row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id;
  IF existing.operation_id IS NOT NULL THEN RETURN existing.cancellation_document; END IF;
  IF child.operation_id IS NULL OR probe IS NULL
     OR supplied->>'generationRequestId' IS DISTINCT FROM probe->>'generationRequestId'
     OR child.workload_deadline_at<=db_now
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id AND authority.expires_at>db_now)
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events workflow_event
       WHERE workflow_event.full_live_authority_id=child.full_live_authority_id
         AND workflow_event.operation_id=child.operation_id AND workflow_event.kind='CLAIMED'
         AND workflow_event.workflow_id=params->>'workflowId'
         AND workflow_event.request_sha256=params->>'requestSha256')
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_v211_scenario_events event
       WHERE event.full_live_authority_id=child.full_live_authority_id
         AND event.operation_id=child.operation_id AND event.action='OBSERVE_FAIR_PROMOTION') THEN
    RAISE EXCEPTION 'V213 V211 promoted probe cancellation unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(probe->>'generationRequestId',211));
  SELECT * INTO request FROM public.generation_requests row
   WHERE row.id=(probe->>'generationRequestId')::uuid
     AND row.account_id=(probe->>'accountId')::uuid
     AND row.workspace_id=(probe->>'workspaceId')::uuid FOR UPDATE;
  SELECT * INTO lease FROM public.provider_workload_leases row
   WHERE row.generation_request_id=request.id AND row.state='ACTIVE' FOR UPDATE;
  SELECT count(*) INTO assignment_count FROM public.serverless_provider_assignments provider
   JOIN public.serverless_attempts attempt ON attempt.id=provider.attempt_id
   WHERE attempt.generation_request_id=request.id AND provider.is_current;
  IF assignment_count>1 OR request.state NOT IN ('ADMITTED','ACTIVE','CANCELLING')
     OR lease.id IS NULL THEN
    RAISE EXCEPTION 'V213 V211 promoted probe cancellation state unavailable'
      USING ERRCODE='42501';
  END IF;
  IF assignment_count=1 THEN
    SELECT attempt.lane,provider.provider_job_id,provider.provider_job_id_sha256
      INTO assignment FROM public.serverless_provider_assignments provider
      JOIN public.serverless_attempts attempt ON attempt.id=provider.attempt_id
     WHERE attempt.generation_request_id=request.id AND provider.is_current;
  ELSIF EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox outbox
    JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
    WHERE attempt.generation_request_id=request.id
      AND (outbox.send_attempt_count<>0 OR outbox.state IN
        ('SENT','DISPATCH_ACK_UNKNOWN','ASSIGNED'))) THEN
    RAISE EXCEPTION 'V213 V211 promoted probe provider identity uncertain' USING ERRCODE='42501';
  END IF;
  previous_account:=current_setting('videoforge.account_id',true);
  PERFORM set_config('videoforge.account_id',request.account_id::text,true);
  IF assignment_count=0 THEN
    UPDATE public.serverless_dispatch_outbox outbox SET state='DEAD_LETTER',version=version+1,
      lease_id=NULL,lease_holder_sha256=NULL,leased_at=NULL,lease_expires_at=NULL,updated_at=db_now
     FROM public.serverless_attempts attempt WHERE attempt.id=outbox.attempt_id
       AND attempt.generation_request_id=request.id AND outbox.send_attempt_count=0
       AND outbox.state IN ('READY_TO_DISPATCH','LEASED');
    UPDATE public.serverless_attempts attempt SET state='PERMANENT_FAILED',terminal_at=db_now,
      version=version+1,updated_at=db_now WHERE attempt.generation_request_id=request.id
      AND attempt.state IN ('PLANNED','OUTBOXED');
  END IF;
  UPDATE public.generation_requests SET state='CANCELLING',version=version+1,updated_at=db_now
   WHERE id=request.id AND state IN ('ADMITTED','ACTIVE');
  SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton;
  INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,
    operation,request_kind,request_id,lease_id,request_version_before,request_version_after,
    video_cursor_before,video_cursor_after,preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(gen_random_uuid(),request.account_id,request.workspace_id,request.created_by_user_id,
    'CANCEL_ACTIVE','VIDEO',request.id,lease.id,request.version,request.version+1,
    capacity.video_fair_cursor,capacity.video_fair_cursor,capacity.preview_fair_cursor,
    capacity.preview_fair_cursor,jsonb_build_object('fullLiveAuthorityId',child.full_live_authority_id,
      'operationId',child.operation_id,'providerDispatchFenced',assignment_count=0),db_now);
  PERFORM set_config('videoforge.account_id',coalesce(previous_account,''),true);
  base:=jsonb_build_object('schemaVersion','videoforge.v213-v211-promoted-probe-cancel/v1',
    'workflowParams',params,'generationRequestId',request.id,
    'providerDispatchFenced',assignment_count=0,'providerJob',CASE WHEN assignment_count=0 THEN NULL
      ELSE jsonb_build_object('lane',assignment.lane,'providerJobId',assignment.provider_job_id,
        'providerJobIdSha256',assignment.provider_job_id_sha256) END);
  cancellation_hash:=public.videoforge_v213_jit_sha256(base);
  base:=base||jsonb_build_object('cancellationSha256',cancellation_hash);
  INSERT INTO public.hosted_full_live_v211_probe_cancellations(full_live_authority_id,
    operation_id,generation_request_id,cancellation_sha256,cancellation_document)
  VALUES(child.full_live_authority_id,child.operation_id,request.id,cancellation_hash,base);
  RETURN base;
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_v211_promoted_probe_reconciliation(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; readback jsonb:=supplied->'providerReadback';
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  cancellation public.hosted_full_live_v211_probe_cancellations%ROWTYPE;
  existing public.hosted_full_live_v211_probe_reconciliations%ROWTYPE;
  request public.generation_requests%ROWTYPE; lease public.provider_workload_leases%ROWTYPE;
  assignment record; capacity public.global_generation_capacity%ROWTYPE; secret text;
  previous_account text; expected_hash text; race_cost numeric:=0; base jsonb; result_hash text;
  db_now timestamptz:=transaction_timestamp();
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['cancellationSha256','providerReadback','workflowParams']::text[]
     OR NOT public.videoforge_v213_acceptance_workflow_params_valid(params)
     OR params->>'checkpoint' IS DISTINCT FROM 'V2-11'
     OR coalesce(supplied->>'cancellationSha256','') !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 V211 promoted probe reconciliation invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=params->>'operationId' AND row.checkpoint='V2-11';
  SELECT * INTO cancellation FROM public.hosted_full_live_v211_probe_cancellations row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id
     AND row.cancellation_sha256=supplied->>'cancellationSha256';
  SELECT * INTO existing FROM public.hosted_full_live_v211_probe_reconciliations row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id;
  IF existing.operation_id IS NOT NULL THEN RETURN existing.reconciliation_document; END IF;
  IF cancellation.operation_id IS NULL OR child.workload_deadline_at<=db_now
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id AND authority.expires_at>db_now)
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events workflow_event
       WHERE workflow_event.full_live_authority_id=child.full_live_authority_id
         AND workflow_event.operation_id=child.operation_id AND workflow_event.kind='CLAIMED'
         AND workflow_event.workflow_id=params->>'workflowId'
         AND workflow_event.request_sha256=params->>'requestSha256') THEN
    RAISE EXCEPTION 'V213 V211 promoted probe reconciliation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO request FROM public.generation_requests row
   WHERE row.id=cancellation.generation_request_id FOR UPDATE;
  SELECT * INTO lease FROM public.provider_workload_leases row
   WHERE row.generation_request_id=request.id AND row.state='ACTIVE' FOR UPDATE;
  IF cancellation.cancellation_document->'providerDispatchFenced'='true'::jsonb THEN
    IF readback IS NOT NULL AND readback<>'null'::jsonb THEN
      RAISE EXCEPTION 'V213 V211 fenced probe cannot carry provider readback' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.serverless_provider_assignments provider
      JOIN public.serverless_attempts attempt ON attempt.id=provider.attempt_id
      WHERE attempt.generation_request_id=request.id AND provider.is_current) THEN
      RAISE EXCEPTION 'V213 V211 fenced probe assignment appeared' USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT attempt.id attempt_id,attempt.lane,provider.provider_job_id,
      provider.provider_job_id_sha256 INTO assignment
      FROM public.serverless_provider_assignments provider
      JOIN public.serverless_attempts attempt ON attempt.id=provider.attempt_id
     WHERE attempt.generation_request_id=request.id AND provider.is_current;
    IF assignment.attempt_id IS NULL OR jsonb_typeof(readback) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(readback) key)
         IS DISTINCT FROM ARRAY['delayTimeMs','executionTimeMs','generationRequestId','lane',
           'providerJobId','providerJobIdSha256','receiptSha256','schemaVersion','signature',
           'status','workflowParams']::text[]
       OR readback->>'schemaVersion' IS DISTINCT FROM
          'videoforge.v213-v211-provider-race-cancel-receipt/v1'
       OR readback->'workflowParams' IS DISTINCT FROM params
       OR readback->>'generationRequestId' IS DISTINCT FROM request.id::text
       OR readback->>'lane' IS DISTINCT FROM assignment.lane
       OR readback->>'providerJobId' IS DISTINCT FROM assignment.provider_job_id
       OR readback->>'providerJobIdSha256' IS DISTINCT FROM assignment.provider_job_id_sha256
       OR readback->>'status' IS DISTINCT FROM 'CANCELLED'
       OR NOT (readback->'delayTimeMs'='null'::jsonb OR (
         jsonb_typeof(readback->'delayTimeMs')='number'
         AND (readback->>'delayTimeMs')::numeric=trunc((readback->>'delayTimeMs')::numeric)
         AND (readback->>'delayTimeMs')::numeric BETWEEN 0 AND 9007199254740991))
       OR NOT (readback->'executionTimeMs'='null'::jsonb OR (
         jsonb_typeof(readback->'executionTimeMs')='number'
         AND (readback->>'executionTimeMs')::numeric=trunc((readback->>'executionTimeMs')::numeric)
         AND (readback->>'executionTimeMs')::numeric BETWEEN 0 AND 9007199254740991))
       OR readback->>'receiptSha256' IS DISTINCT FROM
          public.videoforge_v213_jit_sha256(readback-'receiptSha256'-'signature')
       OR jsonb_typeof(readback->'signature') IS DISTINCT FROM 'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(readback->'signature') key)
         IS DISTINCT FROM ARRAY['algorithm','keyId','sha256','value']::text[]
       OR readback#>>'{signature,algorithm}' IS DISTINCT FROM 'HMAC-SHA256'
       OR readback#>>'{signature,sha256}' IS DISTINCT FROM public.videoforge_v213_jit_sha256(
          jsonb_build_object('signatureValue',readback#>>'{signature,value}')) THEN
      RAISE EXCEPTION 'V213 V211 provider race readback drift' USING ERRCODE='23514';
    END IF;
    SELECT secret_hex INTO secret FROM public.hosted_provider_proof_keys proof
     WHERE proof.key_id=readback#>>'{signature,keyId}' AND proof.active;
    expected_hash:=encode(hmac(convert_to(public.videoforge_canonical_jsonb(
      readback-'signature'),'UTF8'),decode(secret,'hex'),'sha256'),'hex');
    IF secret IS NULL OR readback#>>'{signature,value}' IS DISTINCT FROM expected_hash
       OR NOT EXISTS(SELECT 1 FROM public.serverless_cost_events event
         WHERE event.attempt_id=assignment.attempt_id AND event.kind='SETTLED') THEN
      RAISE EXCEPTION 'V213 V211 provider race settlement unavailable' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(sum(ledger.settled_usd+ledger.possible_duplicate_usd),0)
      INTO race_cost FROM public.serverless_cost_ledgers ledger
     WHERE ledger.attempt_id=assignment.attempt_id;
    IF race_cost<0 OR race_cost>4 THEN
      RAISE EXCEPTION 'V213 V211 provider race cost exceeded' USING ERRCODE='22003';
    END IF;
  END IF;
  previous_account:=current_setting('videoforge.account_id',true);
  PERFORM set_config('videoforge.account_id',request.account_id::text,true);
  IF cancellation.cancellation_document->'providerDispatchFenced'<>'true'::jsonb THEN
    UPDATE public.serverless_attempts SET state='CANCELLED',terminal_at=db_now,
      version=version+1,updated_at=db_now WHERE id=assignment.attempt_id
      AND state NOT IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED');
    UPDATE public.serverless_dispatch_outbox SET state='TERMINAL',version=version+1,
      updated_at=db_now WHERE attempt_id=assignment.attempt_id
      AND state NOT IN ('TERMINAL','DEAD_LETTER');
  END IF;
  UPDATE public.provider_workload_leases SET state='RELEASED',released_at=db_now,
    release_reason='V213_V211_PROBE_CANCELLED',version=version+1,heartbeat_at=db_now,
    expires_at=greatest(expires_at,db_now+interval '1 second')
   WHERE id=lease.id AND state='ACTIVE';
  UPDATE public.generation_requests SET state='CANCELLED',terminal_at=db_now,
    version=version+1,updated_at=db_now WHERE id=request.id AND state='CANCELLING';
  SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton;
  INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,
    operation,request_kind,request_id,lease_id,request_version_before,request_version_after,
    video_cursor_before,video_cursor_after,preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(gen_random_uuid(),request.account_id,request.workspace_id,request.created_by_user_id,
    'TERMINAL_RELEASE','VIDEO',request.id,lease.id,request.version,request.version+1,
    capacity.video_fair_cursor,capacity.video_fair_cursor,capacity.preview_fair_cursor,
    capacity.preview_fair_cursor,jsonb_build_object('fullLiveAuthorityId',child.full_live_authority_id,
      'operationId',child.operation_id,'terminalState','CANCELLED'),db_now);
  PERFORM set_config('videoforge.account_id',coalesce(previous_account,''),true);
  IF EXISTS(SELECT 1 FROM public.provider_workload_leases row
    WHERE row.generation_request_id=request.id AND row.state='ACTIVE')
     OR NOT EXISTS(SELECT 1 FROM public.generation_requests row
       WHERE row.id=request.id AND row.state='CANCELLED') THEN
    RAISE EXCEPTION 'V213 V211 promoted probe reconciliation incomplete' USING ERRCODE='55000';
  END IF;
  base:=jsonb_build_object('schemaVersion',
      'videoforge.v213-v211-promoted-probe-reconciliation/v1',
    'workflowParams',params,'generationRequestId',request.id,
    'cancellationSha256',cancellation.cancellation_sha256,
    'providerDispatchFenced',cancellation.cancellation_document->'providerDispatchFenced',
    'providerRaceReconciled',cancellation.cancellation_document->'providerDispatchFenced'='false'::jsonb,
    'providerRaceActualUsd',race_cost,
    'providerRaceJobId',CASE WHEN cancellation.cancellation_document->'providerDispatchFenced'='true'::jsonb
      THEN NULL ELSE to_jsonb(assignment.provider_job_id) END,
    'providerRaceReceiptSha256',CASE
      WHEN cancellation.cancellation_document->'providerDispatchFenced'='true'::jsonb THEN NULL
      ELSE readback->'receiptSha256' END,'terminalState','CANCELLED','activeLeaseAbsent',true);
  result_hash:=public.videoforge_v213_jit_sha256(base);
  base:=base||jsonb_build_object('reconciliationSha256',result_hash);
  INSERT INTO public.hosted_full_live_v211_probe_reconciliations(full_live_authority_id,
    operation_id,generation_request_id,reconciliation_sha256,reconciliation_document)
  VALUES(child.full_live_authority_id,child.operation_id,request.id,result_hash,base);
  RETURN base;
END;
$$;

CREATE FUNCTION public.videoforge_authorize_v213_v211_restore(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE; primary_identity jsonb;
  waiter jsonb; probe jsonb; request public.generation_requests%ROWTYPE;
  capacity public.global_generation_capacity%ROWTYPE; previous_account text; document jsonb;
  document_hash text; existing public.hosted_full_live_v211_restore_authorizations%ROWTYPE;
  db_now timestamptz:=transaction_timestamp();
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied)
     OR supplied->>'checkpoint' IS DISTINCT FROM 'V2-11' THEN
    RAISE EXCEPTION 'V213 V211 restore authorization invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=supplied->>'operationId' AND row.checkpoint='V2-11';
  SELECT * INTO existing FROM public.hosted_full_live_v211_restore_authorizations row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id;
  IF existing.operation_id IS NOT NULL THEN RETURN jsonb_build_object('authorized',true); END IF;
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges challenge ON challenge.id=f.challenge_id
   WHERE challenge.full_live_authority_id=child.full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  primary_identity:=facts.facts_document->'roleScopedIdentities'->'primary';
  waiter:=facts.facts_document->'roleScopedIdentities'->'sameAccountWaiter';
  probe:=facts.facts_document->'roleScopedIdentities'->'fairnessProbe';
  SELECT * INTO request FROM public.generation_requests row
   WHERE row.id=(waiter->>'generationRequestId')::uuid FOR UPDATE;
  IF child.operation_id IS NULL OR request.state<>'WAITING'
     OR child.workload_deadline_at<=db_now
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id AND authority.expires_at>db_now)
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events workflow_event
       WHERE workflow_event.full_live_authority_id=child.full_live_authority_id
         AND workflow_event.operation_id=child.operation_id AND workflow_event.kind='CLAIMED'
         AND workflow_event.workflow_id=supplied->>'workflowId'
         AND workflow_event.request_sha256=supplied->>'requestSha256')
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_v211_scenario_events event
       WHERE event.full_live_authority_id=child.full_live_authority_id
         AND event.operation_id=child.operation_id AND event.sequence=3)
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_v211_probe_reconciliations reconciliation
       WHERE reconciliation.full_live_authority_id=child.full_live_authority_id
         AND reconciliation.operation_id=child.operation_id)
     OR EXISTS(SELECT 1 FROM public.provider_workload_leases lease
       WHERE lease.generation_request_id=(probe->>'generationRequestId')::uuid
         AND lease.state='ACTIVE') THEN
    RAISE EXCEPTION 'V213 V211 restore authorization unavailable' USING ERRCODE='42501';
  END IF;
  previous_account:=current_setting('videoforge.account_id',true);
  PERFORM set_config('videoforge.account_id',request.account_id::text,true);
  UPDATE public.generation_requests SET state='CANCELLED',terminal_at=db_now,
    version=version+1,updated_at=db_now WHERE id=request.id AND state='WAITING';
  SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton;
  INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,
    operation,request_kind,request_id,lease_id,request_version_before,request_version_after,
    video_cursor_before,video_cursor_after,preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(gen_random_uuid(),request.account_id,request.workspace_id,request.created_by_user_id,
    'CANCEL_WAITING','VIDEO',request.id,NULL,request.version,request.version+1,
    capacity.video_fair_cursor,capacity.video_fair_cursor,capacity.preview_fair_cursor,
    capacity.preview_fair_cursor,jsonb_build_object('fullLiveAuthorityId',child.full_live_authority_id,
      'operationId',child.operation_id),db_now);
  PERFORM set_config('videoforge.account_id',probe->>'accountId',true);
  IF EXISTS(SELECT 1 FROM public.videoforge_tenant_generation_requests tenant
    WHERE tenant.id=(primary_identity->>'generationRequestId')::uuid) THEN
    PERFORM set_config('videoforge.account_id',coalesce(previous_account,''),true);
    RAISE EXCEPTION 'V213 V211 tenant isolation failed' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('videoforge.account_id',coalesce(previous_account,''),true);
  document:=jsonb_build_object('fullLiveAuthorityId',child.full_live_authority_id,
    'operationId',child.operation_id,'sameAccountWaiterGenerationRequestId',request.id,
    'sameAccountWaiterCancelled',true,'fairnessProbeGenerationRequestId',probe->>'generationRequestId',
    'fairnessProbeActiveLeaseAbsent',true,'tenantIsolationDenied',true,
    'tenantIsolationDenialReceiptSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
      'viewerAccountId',probe->>'accountId',
      'hiddenGenerationRequestId',primary_identity->>'generationRequestId','denied',true)));
  document_hash:=public.videoforge_v213_jit_sha256(document);
  INSERT INTO public.hosted_full_live_v211_restore_authorizations(full_live_authority_id,
    operation_id,authorization_sha256,authorization_document)
  VALUES(child.full_live_authority_id,child.operation_id,document_hash,document);
  RETURN jsonb_build_object('authorized',true);
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_acceptance_zero_worker_read(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE params jsonb:=supplied->'workflowParams'; observations jsonb:=supplied->'observations';
  ordinal_value integer; observed timestamptz; db_now timestamptz:=transaction_timestamp();
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  existing public.hosted_full_live_acceptance_zero_worker_reads%ROWTYPE;
  previous public.hosted_full_live_acceptance_zero_worker_reads%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['observations','ordinal','workflowParams']::text[]
     OR NOT public.videoforge_v213_acceptance_workflow_params_valid(params)
     OR jsonb_typeof(observations)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(observations) key)
       IS DISTINCT FROM ARRAY['mage','soulx']::text[]
     OR EXISTS(SELECT 1 FROM jsonb_each(observations) lane
       WHERE jsonb_typeof(lane.value)<>'object'
          OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(lane.value) key)
             IS DISTINCT FROM ARRAY['observedAt','queuedJobs','workersTotal']::text[]
          OR lane.value->'workersTotal'<>'0'::jsonb OR lane.value->'queuedJobs'<>'0'::jsonb) THEN
    RAISE EXCEPTION 'V213 zero-worker read invalid' USING ERRCODE='23514';
  END IF;
  ordinal_value:=(supplied->>'ordinal')::integer;
  observed:=greatest((observations#>>'{mage,observedAt}')::timestamptz,
    (observations#>>'{soulx,observedAt}')::timestamptz);
  IF ordinal_value NOT BETWEEN 0 AND 2 OR observed>db_now+interval '30 seconds'
     OR observed<db_now-interval '10 minutes' THEN
    RAISE EXCEPTION 'V213 zero-worker read freshness invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(params->>'fullLiveAuthorityId')::uuid
     AND operation_id=params->>'operationId' AND checkpoint=params->>'checkpoint';
  IF child.operation_id IS NULL OR child.workload_deadline_at<=db_now
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=child.full_live_authority_id AND authority.expires_at>db_now)
     OR public.videoforge_v213_acceptance_output_binding(
       child.full_live_authority_id,child.operation_id) IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_workflow_events event
       WHERE event.full_live_authority_id=child.full_live_authority_id
         AND event.operation_id=child.operation_id AND event.kind='CLAIMED'
         AND event.workflow_id=params->>'workflowId'
         AND event.request_sha256=params->>'requestSha256') THEN
    RAISE EXCEPTION 'V213 zero-worker read authority unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO previous FROM public.hosted_full_live_acceptance_zero_worker_reads row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id AND row.ordinal=ordinal_value-1;
  IF ordinal_value>0 AND (previous.ordinal IS NULL OR observed<previous.observed_at+interval '1 second') THEN
    RAISE EXCEPTION 'V213 zero-worker read sequence invalid' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM public.hosted_full_live_acceptance_zero_worker_reads row
    WHERE row.full_live_authority_id=child.full_live_authority_id
      AND row.operation_id=child.operation_id AND row.ordinal<ordinal_value)<>ordinal_value THEN
    RAISE EXCEPTION 'V213 zero-worker read ordinal invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_zero_worker_reads row
   WHERE row.full_live_authority_id=child.full_live_authority_id
     AND row.operation_id=child.operation_id AND row.ordinal=ordinal_value;
  IF existing.ordinal IS NOT NULL THEN
    IF existing.observations IS DISTINCT FROM observations OR existing.observed_at<>observed THEN
      RAISE EXCEPTION 'V213 zero-worker read replay drift' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.hosted_full_live_acceptance_zero_worker_reads(
      full_live_authority_id,operation_id,ordinal,observations,observed_at)
    VALUES(child.full_live_authority_id,child.operation_id,ordinal_value,observations,observed);
  END IF;
  RETURN public.videoforge_read_v213_acceptance_workflow(params);
END;
$$;

CREATE FUNCTION public.videoforge_finalize_v213_acceptance_workflow(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE state jsonb; child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE; requirements jsonb; evidence_count integer;
  authority public.hosted_full_live_authorities%ROWTYPE;
  materialized public.hosted_full_live_jit_materializations%ROWTYPE;
  facts public.hosted_full_live_materialization_facts%ROWTYPE;
  mage public.serverless_endpoint_deployments%ROWTYPE;
  soulx public.serverless_endpoint_deployments%ROWTYPE;
  capture public.hosted_full_live_acceptance_technical_captures%ROWTYPE;
  existing public.hosted_full_live_acceptance_workflow_outputs%ROWTYPE;
  request jsonb; primary_identity jsonb; secondary_identity jsonb;
  same_account_waiter jsonb; fairness_probe jsonb;
  raw_evidence jsonb; receipt jsonb; cleanup jsonb;
  result jsonb; output_binding text; zero_reads jsonb; terminal_jobs jsonb;
  runtime public.video_runtime_states%ROWTYPE; final_receipt text; output_committed_at timestamptz;
  observed_at timestamptz; attempt_count integer; assignment_count integer;
  ledger_count integer; settled_count integer; possible_duplicate_usd numeric;
  settled_event_count integer; variable_usd numeric; variable_micro_usd bigint;
  mage_micro_usd bigint; soulx_micro_usd bigint; output_hash text;
  admission jsonb; capture_scope jsonb; result_document jsonb;
  visual public.hosted_full_live_acceptance_operator_evidence%ROWTYPE;
  chrome public.hosted_full_live_acceptance_operator_evidence%ROWTYPE;
  render_attempt public.hosted_cpu_job_attempts%ROWTYPE;
  output_receipt public.artifact_receipts%ROWTYPE;
  mage_attempt public.serverless_attempts%ROWTYPE;
  soulx_attempt public.serverless_attempts%ROWTYPE;
  mage_provenance public.serverless_provenance_receipts%ROWTYPE;
  soulx_provenance public.serverless_provenance_receipts%ROWTYPE;
  mage_provider jsonb; soulx_provider jsonb; durable_inventory text;
  elapsed_ms numeric; render_ms numeric; mage_init_ms bigint; soulx_init_ms bigint;
  mage_execution_ms bigint; soulx_execution_ms bigint; mage_total_ms bigint;
  soulx_total_ms bigint; settlement_sha text; verification_expires timestamptz;
  secondary_runtime public.video_runtime_states%ROWTYPE;
  main_leases public.provider_workload_leases%ROWTYPE;
  primary_lease public.provider_workload_leases%ROWTYPE;
  secondary_lease public.provider_workload_leases%ROWTYPE;
  apply_policy public.hosted_full_live_v211_policy_actions%ROWTYPE;
  restore_policy public.hosted_full_live_v211_policy_actions%ROWTYPE;
  wait_event public.hosted_full_live_v211_scenario_events%ROWTYPE;
  promotion_event public.hosted_full_live_v211_scenario_events%ROWTYPE;
  cancel_event public.hosted_full_live_v211_scenario_events%ROWTYPE;
  restore_authorization public.hosted_full_live_v211_restore_authorizations%ROWTYPE;
  probe_reconciliation public.hosted_full_live_v211_probe_reconciliations%ROWTYPE;
  mage_qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  v211_attempts jsonb; v211_accounts jsonb; v211_promotions jsonb;
  v211_main_terminal_at timestamptz; primary_video_before integer;
  secondary_video_before integer; race_micro_usd bigint:=0;
BEGIN
  IF NOT public.videoforge_v213_acceptance_workflow_params_valid(supplied) THEN
    RAISE EXCEPTION 'V213 acceptance finalizer request invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    (supplied->>'fullLiveAuthorityId')||':'||(supplied->>'operationId')||':finalize',213));
  SELECT * INTO existing FROM public.hosted_full_live_acceptance_workflow_outputs output
   WHERE output.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND output.operation_id=supplied->>'operationId';
  IF existing.operation_id IS NOT NULL THEN
    RETURN public.videoforge_read_v213_acceptance_workflow(supplied);
  END IF;
  state:=public.videoforge_read_v213_acceptance_workflow(supplied);
  IF state->>'phase'<>'BILLING_SETTLEMENT' OR (state->>'zeroWorkerReadCount')::integer<>3 THEN
    RAISE EXCEPTION 'V213 acceptance finalizer prerequisites unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities
   WHERE full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND operation_id=supplied->>'operationId' AND checkpoint=supplied->>'checkpoint';
  SELECT * INTO promotion FROM public.hosted_full_live_promotions
   WHERE authority_id=child.full_live_authority_id;
  SELECT * INTO authority FROM public.hosted_full_live_authorities
   WHERE id=child.full_live_authority_id;
  SELECT * INTO materialized FROM public.hosted_full_live_jit_materializations
   WHERE full_live_authority_id=child.full_live_authority_id
     AND operation_id=child.operation_id;
  SELECT f.* INTO facts FROM public.hosted_full_live_materialization_facts f
   JOIN public.hosted_full_live_materialization_challenges challenge ON challenge.id=f.challenge_id
   WHERE challenge.full_live_authority_id=child.full_live_authority_id
     AND challenge.challenge_document->>'outerStateSha256'=child.outer_state_sha256;
  SELECT * INTO mage FROM public.serverless_endpoint_deployments
   WHERE id=promotion.mage_deployment_id;
  SELECT * INTO soulx FROM public.serverless_endpoint_deployments
   WHERE id=promotion.soulx_deployment_id;
  SELECT * INTO capture FROM public.hosted_full_live_acceptance_technical_captures
   WHERE full_live_authority_id=child.full_live_authority_id
     AND operation_id=child.operation_id;
  request:=materialized.execution_document#>'{call,request}';
  admission:=materialized.execution_document#>'{call,admission}';
  primary_identity:=facts.facts_document#>'{roleScopedIdentities,primary}';
  secondary_identity:=facts.facts_document#>'{roleScopedIdentities,secondary}';
  same_account_waiter:=facts.facts_document#>'{roleScopedIdentities,sameAccountWaiter}';
  fairness_probe:=facts.facts_document#>'{roleScopedIdentities,fairnessProbe}';
  output_binding:=public.videoforge_v213_acceptance_output_binding(
    child.full_live_authority_id,child.operation_id);
  requirements:=CASE child.checkpoint
    WHEN 'V2-10' THEN jsonb_build_array('V210_REAL_CHROME','V210_VISUAL_DECISION')
    WHEN 'V2-11' THEN '[]'::jsonb
    WHEN 'V2-12' THEN jsonb_build_array('V212_REAL_CHROME','V212_VISUAL_DECISION')
    ELSE '[]'::jsonb END;
  SELECT count(*) INTO evidence_count FROM public.hosted_full_live_acceptance_operator_evidence e
   WHERE e.full_live_authority_id=child.full_live_authority_id
     AND e.operation_id=child.operation_id
     AND e.kind IN (SELECT jsonb_array_elements_text(requirements));
  IF child.operation_id IS NULL OR promotion.id IS NULL OR authority.id IS NULL
     OR authority.expires_at<=transaction_timestamp()
     OR materialized.operation_id IS NULL OR facts.challenge_id IS NULL
     OR capture.operation_id IS NULL OR capture.output_binding_sha256<>output_binding
     OR request IS NULL OR primary_identity IS NULL
     OR evidence_count<>jsonb_array_length(requirements)
     OR NOT EXISTS(SELECT 1 FROM public.serverless_endpoint_deployments d
       WHERE d.id=promotion.mage_deployment_id AND d.is_active
         AND d.worker_count_min=0 AND d.worker_count_max=1 AND d.retained_active_workers=0
         AND d.volume_id_sha256 IS NOT NULL AND d.volume_manifest_sha256 IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.serverless_endpoint_deployments d
       WHERE d.id=promotion.soulx_deployment_id AND d.is_active
         AND d.worker_count_min=0 AND d.worker_count_max=1 AND d.retained_active_workers=0
         AND d.volume_id_sha256 IS NOT NULL AND d.volume_manifest_sha256 IS NOT NULL)
     OR output_binding IS NULL THEN
    RAISE EXCEPTION 'V213 acceptance finalizer durable facts unavailable' USING ERRCODE='42501';
  END IF;

  SELECT * INTO runtime FROM public.video_runtime_states runtime_state
   WHERE runtime_state.account_id=(primary_identity->>'accountId')::uuid
     AND runtime_state.workspace_id=(primary_identity->>'workspaceId')::uuid
     AND runtime_state.project_id=(primary_identity->>'projectId')::uuid
     AND runtime_state.project_revision_id=(primary_identity->>'projectRevisionId')::uuid
     AND runtime_state.generation_request_id=(primary_identity->>'generationRequestId')::uuid
     AND runtime_state.stage='COMPLETE' AND runtime_state.terminal_reason='SUCCEEDED';
  SELECT count(*),min(event.detail->>'final_output_receipt_sha256'),min(event.occurred_at)
    INTO attempt_count,final_receipt,output_committed_at
    FROM public.video_runtime_events event
   WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
     AND event.to_state='COMPLETE'
     AND event.detail->>'final_output_sha256'=runtime.final_output_sha256;
  IF attempt_count<>1 OR final_receipt !~ '^sha256:[0-9a-f]{64}$'
     OR output_committed_at IS NULL THEN
    RAISE EXCEPTION 'V213 final output receipt unavailable' USING ERRCODE='42501';
  END IF;
  IF child.checkpoint='V2-11' THEN
    SELECT * INTO secondary_runtime FROM public.video_runtime_states runtime_state
     WHERE runtime_state.account_id=(secondary_identity->>'accountId')::uuid
       AND runtime_state.workspace_id=(secondary_identity->>'workspaceId')::uuid
       AND runtime_state.project_id=(secondary_identity->>'projectId')::uuid
       AND runtime_state.project_revision_id=(secondary_identity->>'projectRevisionId')::uuid
       AND runtime_state.generation_request_id=(secondary_identity->>'generationRequestId')::uuid
       AND runtime_state.stage='COMPLETE' AND runtime_state.terminal_reason='SUCCEEDED';
    SELECT max(event.occurred_at) INTO v211_main_terminal_at
      FROM public.video_runtime_events event
     WHERE event.runtime_id=secondary_runtime.id AND event.reason='FINAL_OUTPUT_DURABLE'
       AND event.to_state='COMPLETE'
       AND event.detail->>'final_output_sha256'=secondary_runtime.final_output_sha256;
    IF secondary_runtime.id IS NULL OR v211_main_terminal_at IS NULL THEN
      RAISE EXCEPTION 'V211 secondary final output unavailable' USING ERRCODE='42501';
    END IF;
    output_committed_at:=greatest(output_committed_at,v211_main_terminal_at);
    SELECT * INTO probe_reconciliation
      FROM public.hosted_full_live_v211_probe_reconciliations row
     WHERE row.full_live_authority_id=child.full_live_authority_id
       AND row.operation_id=child.operation_id;
    IF probe_reconciliation.operation_id IS NULL
       OR probe_reconciliation.reconciliation_document->>'providerRaceActualUsd' IS NULL
       OR (probe_reconciliation.reconciliation_document->>'providerRaceActualUsd')::numeric<0
       OR (probe_reconciliation.reconciliation_document->>'providerRaceActualUsd')::numeric*1000000<>
          trunc((probe_reconciliation.reconciliation_document->>'providerRaceActualUsd')::numeric*1000000) THEN
      RAISE EXCEPTION 'V211 provider race settlement unavailable' USING ERRCODE='42501';
    END IF;
    race_micro_usd:=
      ((probe_reconciliation.reconciliation_document->>'providerRaceActualUsd')::numeric*1000000)::bigint;
  END IF;

  SELECT count(*),count(assignment.id),
    jsonb_agg(assignment.provider_job_id ORDER BY
      CASE WHEN attempt.generation_request_id=
        (primary_identity->>'generationRequestId')::uuid THEN 0 ELSE 1 END,
      attempt.lane,attempt.id),
    count(ledger.id),count(*) FILTER(WHERE EXISTS(
      SELECT 1 FROM public.serverless_cost_events event
       WHERE event.attempt_id=attempt.id AND event.kind='SETTLED')),
    coalesce(sum(ledger.settled_usd),0),coalesce(sum(ledger.possible_duplicate_usd),0),
    coalesce(sum(ledger.settled_usd) FILTER(WHERE attempt.lane='mage_image'),0)*1000000,
    coalesce(sum(ledger.settled_usd) FILTER(WHERE attempt.lane='soulx_avatar'),0)*1000000
    INTO attempt_count,assignment_count,terminal_jobs,ledger_count,settled_count,
      variable_usd,possible_duplicate_usd,mage_micro_usd,soulx_micro_usd
    FROM public.serverless_attempts attempt
    LEFT JOIN public.serverless_provider_assignments assignment
      ON assignment.attempt_id=attempt.id AND assignment.is_current
    LEFT JOIN public.serverless_cost_ledgers ledger ON ledger.attempt_id=attempt.id
   WHERE ((attempt.account_id=(primary_identity->>'accountId')::uuid
       AND attempt.workspace_id=(primary_identity->>'workspaceId')::uuid
       AND attempt.project_id=(primary_identity->>'projectId')::uuid
       AND attempt.project_revision_id=(primary_identity->>'projectRevisionId')::uuid
       AND attempt.generation_request_id=(primary_identity->>'generationRequestId')::uuid)
     OR (child.checkpoint='V2-11'
       AND attempt.account_id=(secondary_identity->>'accountId')::uuid
       AND attempt.workspace_id=(secondary_identity->>'workspaceId')::uuid
       AND attempt.project_id=(secondary_identity->>'projectId')::uuid
       AND attempt.project_revision_id=(secondary_identity->>'projectRevisionId')::uuid
       AND attempt.generation_request_id=(secondary_identity->>'generationRequestId')::uuid))
     AND attempt.lane IN ('mage_image','soulx_avatar') AND attempt.state='SUCCEEDED';
  SELECT count(*) INTO settled_event_count
    FROM public.serverless_cost_events event
    JOIN public.serverless_attempts attempt ON attempt.id=event.attempt_id
   WHERE ((attempt.account_id=(primary_identity->>'accountId')::uuid
       AND attempt.workspace_id=(primary_identity->>'workspaceId')::uuid
       AND attempt.project_id=(primary_identity->>'projectId')::uuid
       AND attempt.project_revision_id=(primary_identity->>'projectRevisionId')::uuid
       AND attempt.generation_request_id=(primary_identity->>'generationRequestId')::uuid)
     OR (child.checkpoint='V2-11'
       AND attempt.account_id=(secondary_identity->>'accountId')::uuid
       AND attempt.workspace_id=(secondary_identity->>'workspaceId')::uuid
       AND attempt.project_id=(secondary_identity->>'projectId')::uuid
       AND attempt.project_revision_id=(secondary_identity->>'projectRevisionId')::uuid
       AND attempt.generation_request_id=(secondary_identity->>'generationRequestId')::uuid))
     AND attempt.lane IN ('mage_image','soulx_avatar') AND event.kind='SETTLED';
  variable_micro_usd:=(variable_usd*1000000)::bigint+race_micro_usd;
  IF attempt_count<>(CASE WHEN child.checkpoint='V2-11' THEN 4 ELSE 2 END)
     OR assignment_count<>(CASE WHEN child.checkpoint='V2-11' THEN 4 ELSE 2 END)
     OR ledger_count<>(CASE WHEN child.checkpoint='V2-11' THEN 4 ELSE 2 END)
     OR settled_count<>(CASE WHEN child.checkpoint='V2-11' THEN 4 ELSE 2 END)
     OR settled_event_count<>(CASE WHEN child.checkpoint='V2-11' THEN 4 ELSE 2 END)
     OR coalesce(jsonb_array_length(terminal_jobs),0)<>
        (CASE WHEN child.checkpoint='V2-11' THEN 4 ELSE 2 END)
     OR possible_duplicate_usd<>0
     OR variable_usd*1000000<>variable_micro_usd-race_micro_usd
     OR mage_micro_usd+soulx_micro_usd<>variable_micro_usd-race_micro_usd
     OR variable_micro_usd<0
     OR variable_micro_usd>(request->>'maximumVariableCostMicroUsd')::bigint
     OR (request->>'cumulativeLedgerSpentBeforeMicroUsd')::bigint+variable_micro_usd>
        (request->>'maximumCumulativeVariableCostMicroUsd')::bigint THEN
    RAISE EXCEPTION 'V213 exact settled billing unavailable' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'evidenceSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
        'ordinal',zero.ordinal,'observations',zero.observations,'observedAt',
        public.videoforge_v213_jit_iso(zero.observed_at))),
      'observedAt',public.videoforge_v213_jit_iso(zero.observed_at),
      'endpointJobs',0,'mageWorkers',0,'soulxWorkers',0) ORDER BY zero.ordinal),
    max(zero.observed_at)
    INTO zero_reads,observed_at
    FROM public.hosted_full_live_acceptance_zero_worker_reads zero
   WHERE zero.full_live_authority_id=child.full_live_authority_id
     AND zero.operation_id=child.operation_id;
  IF coalesce(jsonb_array_length(zero_reads),0)<>3 OR observed_at IS NULL
     OR output_committed_at>observed_at THEN
    RAISE EXCEPTION 'V213 stable zero-worker evidence unavailable' USING ERRCODE='42501';
  END IF;

  IF child.checkpoint IN ('V2-10','V2-12') THEN
    capture_scope:=capture.capture_document#>'{captures,0}';
    result_document:=capture_scope->'resultDocument';
    SELECT * INTO render_attempt FROM public.hosted_cpu_job_attempts cpu
     WHERE cpu.id=(result_document->>'attempt_id')::uuid
       AND cpu.account_id=(primary_identity->>'accountId')::uuid
       AND cpu.workspace_id=(primary_identity->>'workspaceId')::uuid
       AND cpu.project_id=(primary_identity->>'projectId')::uuid
       AND cpu.project_revision_id=(primary_identity->>'projectRevisionId')::uuid
       AND cpu.kind='RENDER' AND cpu.state='SUCCEEDED' AND cpu.terminal_at IS NOT NULL
       AND cpu.result_checksum_sha256=capture.capture_document#>>'{captures,0,resultBytesSha256}';
    SELECT receipt.* INTO output_receipt
      FROM public.artifact_receipts receipt
      JOIN public.artifact_reservations reservation
        ON reservation.account_id=receipt.account_id
       AND reservation.workspace_id=receipt.workspace_id
       AND reservation.id=receipt.reservation_id
     WHERE reservation.account_id=render_attempt.account_id
       AND reservation.workspace_id=render_attempt.workspace_id
       AND reservation.project_id=render_attempt.project_id
       AND reservation.project_revision_id=render_attempt.project_revision_id
       AND reservation.lane='RENDER' AND reservation.job_id=render_attempt.id::text
       AND reservation.state='COMMITTED' AND receipt.deleted_at IS NULL
       AND receipt.object_key=reservation.object_key
       AND receipt.checksum_sha256=runtime.final_output_sha256;
    SELECT * INTO visual FROM public.hosted_full_live_acceptance_operator_evidence e
     WHERE e.full_live_authority_id=child.full_live_authority_id
       AND e.operation_id=child.operation_id
       AND e.kind=CASE child.checkpoint WHEN 'V2-10' THEN 'V210_VISUAL_DECISION'
         ELSE 'V212_VISUAL_DECISION' END;
    SELECT * INTO chrome FROM public.hosted_full_live_acceptance_operator_evidence e
     WHERE e.full_live_authority_id=child.full_live_authority_id
       AND e.operation_id=child.operation_id
       AND e.kind=CASE child.checkpoint WHEN 'V2-10' THEN 'V210_REAL_CHROME'
         ELSE 'V212_REAL_CHROME' END;
    SELECT * INTO mage_attempt FROM public.serverless_attempts attempt
     WHERE attempt.account_id=runtime.account_id AND attempt.workspace_id=runtime.workspace_id
       AND attempt.project_id=runtime.project_id
       AND attempt.project_revision_id=runtime.project_revision_id
       AND attempt.generation_request_id=runtime.generation_request_id
       AND attempt.lane='mage_image' AND attempt.state='SUCCEEDED';
    SELECT * INTO soulx_attempt FROM public.serverless_attempts attempt
     WHERE attempt.account_id=runtime.account_id AND attempt.workspace_id=runtime.workspace_id
       AND attempt.project_id=runtime.project_id
       AND attempt.project_revision_id=runtime.project_revision_id
       AND attempt.generation_request_id=runtime.generation_request_id
       AND attempt.lane='soulx_avatar' AND attempt.state='SUCCEEDED';
    SELECT * INTO mage_provenance FROM public.serverless_provenance_receipts provenance
     WHERE provenance.attempt_id=mage_attempt.id;
    SELECT * INTO soulx_provenance FROM public.serverless_provenance_receipts provenance
     WHERE provenance.attempt_id=soulx_attempt.id;
    SELECT value INTO mage_provider FROM jsonb_array_elements(capture_scope->'provider') value
     WHERE value->>'lane'='mage_image';
    SELECT value INTO soulx_provider FROM jsonb_array_elements(capture_scope->'provider') value
     WHERE value->>'lane'='soulx_avatar';
    IF render_attempt.id IS NULL OR output_receipt.id IS NULL
       OR visual.kind IS NULL OR chrome.kind IS NULL
       OR result_document->>'status'<>'SUCCEEDED'
       OR result_document->>'attempt_id'<>render_attempt.id::text
       OR result_document->'probe' IS NULL OR result_document->'output' IS NULL
       OR result_document#>>'{output,sha256}'<>output_receipt.checksum_sha256
       OR (result_document#>>'{output,bytes}')::bigint<>output_receipt.content_length
       OR result_document#>>'{output,asset_id}' IS NULL
       OR output_receipt.object_key<>
          'tenant/'||runtime.account_id||'/workspace/'||runtime.workspace_id||'/project/'||
          runtime.project_id||'/revision/'||runtime.project_revision_id||'/lane/render/job/'||
          render_attempt.id||'/artifact/'||result_document#>>'{output,asset_id}'||'.mp4'
       OR chrome.evidence_document->>'outputSha256'<>runtime.final_output_sha256
       OR visual.evidence_document->>'outputSha256'<>runtime.final_output_sha256
       OR chrome.evidence_document->>'outputReceiptSha256'<>final_receipt
       OR visual.evidence_document->>'outputReceiptSha256'<>final_receipt
       OR chrome.recorded_at>observed_at OR visual.recorded_at>observed_at
       OR mage_provenance.receipt_sha256 IS NULL
       OR soulx_provenance.receipt_sha256 IS NULL THEN
      RAISE EXCEPTION 'V213 output verifier durable facts unavailable' USING ERRCODE='42501';
    END IF;
    durable_inventory:=public.videoforge_v213_jit_sha256(jsonb_build_object(
      'renderAttemptId',render_attempt.id,'outputReceiptSha256',output_receipt.receipt_sha256,
      'resultReceiptSha256',render_attempt.result_receipt_sha256,
      'captureSha256',capture.capture_sha256,'terminalProviderJobIds',terminal_jobs,
      'zeroWorkerReads',zero_reads));
  END IF;

  IF child.checkpoint='V2-10' THEN
    elapsed_ms:=extract(epoch FROM (render_attempt.terminal_at-
      least(mage_attempt.submitted_at,soulx_attempt.submitted_at)))*1000;
    IF admission IS NULL OR admission->>'submissionTokenSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR elapsed_ms IS NULL OR elapsed_ms<=0 OR elapsed_ms<>trunc(elapsed_ms)
       OR elapsed_ms>(admission->>'maximumWallTimeMs')::numeric
       OR (visual.evidence_document#>>'{review,reviewedCutCount}')::integer<>
          (admission->>'expectedCutCount')::integer
       OR (visual.evidence_document->>'observedAt')::timestamptz<
          (chrome.evidence_document->>'observedAt')::timestamptz THEN
      RAISE EXCEPTION 'V210 exact output verification unavailable' USING ERRCODE='42501';
    END IF;
    raw_evidence:=jsonb_build_object(
      'verifierId','videoforge-hosted-short-pilot-output-verifier-v1','accepted',true,
      'durableInventorySha256',durable_inventory,
      'output',jsonb_build_object('state','COMMITTED',
        'assetId',result_document#>>'{output,asset_id}',
        'renderAttemptId',render_attempt.id,'objectKey',output_receipt.object_key,
        'sha256',output_receipt.checksum_sha256,'bytes',output_receipt.content_length,
        'contentType','video/mp4','artifactCommitReceiptSha256',output_receipt.receipt_sha256),
      'privateReadback',jsonb_build_object('state','GET_REHASH_SUCCEEDED',
        'sha256',output_receipt.checksum_sha256,'bytes',output_receipt.content_length,
        'contentType','video/mp4',
        'readbackReceiptSha256',chrome.evidence_document->>'chromeReceiptSha256'),
      'technicalProbe',result_document->'probe',
      'qualityReview',jsonb_build_object('state','ACCEPTED',
        'reviewArtifactSha256',visual.evidence_sha256,
        'reviewedCutCount',visual.evidence_document#>'{review,reviewedCutCount}',
        'everyCutReviewed',visual.evidence_document#>'{review,everyCutReviewed}',
        'noManualMediaEditOrSubstitution',
          visual.evidence_document#>'{review,noManualMediaEditOrSubstitution}',
        'literalRelevance',visual.evidence_document#>>'{review,literalRelevance}',
        'imageRealism',visual.evidence_document#>>'{review,imageRealism}',
        'avatarIdentityAndCrop',visual.evidence_document#>>'{review,avatarIdentityAndCrop}',
        'lipSync',visual.evidence_document#>>'{review,lipSync}',
        'audioVideoQuality',visual.evidence_document#>>'{review,audioVideoQuality}',
        'prohibitedGraphicsAbsent',visual.evidence_document#>>'{review,prohibitedGraphicsAbsent}',
        'hardCutsOnly',visual.evidence_document#>>'{review,hardCutsOnly}',
        'requiredImageZoom',visual.evidence_document#>>'{review,requiredImageZoom}'),
      'settlement',jsonb_build_object('state','SETTLED',
        'variableCostMicroUsd',variable_micro_usd,'possibleDuplicateCostMicroUsd',0,
        'elapsedWallTimeMs',elapsed_ms::bigint),
      'terminal',jsonb_build_object(
        'verifierId','videoforge-hosted-terminal-inventory-verifier-v1','accepted',true,
        'accountId',runtime.account_id,'workspaceId',runtime.workspace_id,
        'projectId',runtime.project_id,'projectRevisionId',runtime.project_revision_id,
        'attemptId',render_attempt.id,
        'submissionTokenSha256',admission->>'submissionTokenSha256','state','SUCCEEDED',
        'terminalAt',public.videoforge_v213_jit_iso(render_attempt.terminal_at),
        'activeWorkers',0,'observedAt',public.videoforge_v213_jit_iso(observed_at)));
  ELSIF child.checkpoint='V2-12' THEN
    IF admission IS NULL OR admission#>>'{document,targetVariableCostMicroUsd}'<>'1000000'
       OR admission#>>'{document,hardVariableCostCeilingMicroUsd}'<>'2000000'
       OR admission#>>'{document,fixedRetainedVolumesMonthlyMicroUsd}'<>'7000000'
       OR admission#>'{document,fixedRetainedVolumesExcluded}'<>'true'::jsonb
       OR admission->>'submissionTokenSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR variable_micro_usd>(admission#>>'{document,targetVariableCostMicroUsd}')::bigint
       OR (visual.evidence_document#>>'{review,reviewedCutCount}')::integer<>
          (admission#>>'{document,expectedCutCount}')::integer
       OR chrome.evidence_document->>'downloadSha256'<>output_receipt.checksum_sha256
       OR (chrome.evidence_document->>'downloadBytes')::bigint<>output_receipt.content_length THEN
      RAISE EXCEPTION 'V212 exact output verification unavailable' USING ERRCODE='42501';
    END IF;
    IF (SELECT array_agg(key ORDER BY key)
          FROM jsonb_object_keys(mage_provenance.timings-'timing_provenance') key)
         IS DISTINCT FROM ARRAY['allocation_ms','container_ready_ms','first_inference_ms',
           'model_load_ms','total_ms','upload_ms','volume_verified_ms','warmup_ms']::text[]
       OR (SELECT array_agg(key ORDER BY key)
          FROM jsonb_object_keys(soulx_provenance.timings-'timing_provenance') key)
         IS DISTINCT FROM ARRAY['allocation_ms','container_ready_ms','first_inference_ms',
           'model_load_ms','total_ms','upload_ms','volume_verified_ms','warmup_ms']::text[]
       OR EXISTS(SELECT 1 FROM jsonb_each(mage_provenance.timings-'timing_provenance') item
          WHERE jsonb_typeof(item.value)<>'number' OR (item.value#>>'{}')::numeric<0
             OR (item.value#>>'{}')::numeric<>trunc((item.value#>>'{}')::numeric))
       OR EXISTS(SELECT 1 FROM jsonb_each(soulx_provenance.timings-'timing_provenance') item
          WHERE jsonb_typeof(item.value)<>'number' OR (item.value#>>'{}')::numeric<0
             OR (item.value#>>'{}')::numeric<>trunc((item.value#>>'{}')::numeric))
       OR mage_provenance.peak_vram_bytes IS NULL OR NOT mage_provenance.scratch_removed
       OR mage_provenance.scratch_on_model_volume
       OR soulx_provenance.peak_vram_bytes IS NULL OR NOT soulx_provenance.scratch_removed
       OR soulx_provenance.scratch_on_model_volume THEN
      RAISE EXCEPTION 'V212 signed lane measurements unavailable' USING ERRCODE='42501';
    END IF;
    mage_init_ms:=(mage_provenance.timings->>'allocation_ms')::bigint+
      (mage_provenance.timings->>'container_ready_ms')::bigint+
      (mage_provenance.timings->>'volume_verified_ms')::bigint+
      (mage_provenance.timings->>'model_load_ms')::bigint+
      (mage_provenance.timings->>'warmup_ms')::bigint;
    soulx_init_ms:=(soulx_provenance.timings->>'allocation_ms')::bigint+
      (soulx_provenance.timings->>'container_ready_ms')::bigint+
      (soulx_provenance.timings->>'volume_verified_ms')::bigint+
      (soulx_provenance.timings->>'model_load_ms')::bigint+
      (soulx_provenance.timings->>'warmup_ms')::bigint;
    mage_execution_ms:=(mage_provenance.timings->>'first_inference_ms')::bigint+
      (mage_provenance.timings->>'upload_ms')::bigint;
    soulx_execution_ms:=(soulx_provenance.timings->>'first_inference_ms')::bigint+
      (soulx_provenance.timings->>'upload_ms')::bigint;
    mage_total_ms:=(mage_provider->>'delayTimeMs')::bigint+mage_init_ms+mage_execution_ms;
    soulx_total_ms:=(soulx_provider->>'delayTimeMs')::bigint+soulx_init_ms+soulx_execution_ms;
    render_ms:=extract(epoch FROM (render_attempt.terminal_at-render_attempt.submitted_at))*1000;
    IF mage_init_ms+mage_execution_ms<>(mage_provenance.timings->>'total_ms')::bigint
       OR soulx_init_ms+soulx_execution_ms<>(soulx_provenance.timings->>'total_ms')::bigint
       OR render_ms IS NULL OR render_ms<=0 OR render_ms<>trunc(render_ms)
       OR mage_total_ms+soulx_total_ms+render_ms>
          (admission#>>'{document,maximumWallTimeMs}')::numeric THEN
      RAISE EXCEPTION 'V212 measurement arithmetic invalid' USING ERRCODE='23514';
    END IF;
    settlement_sha:=public.videoforge_v213_jit_sha256(jsonb_build_object(
      'mageAttemptId',mage_attempt.id,'soulxAttemptId',soulx_attempt.id,
      'mageMicroUsd',mage_micro_usd,'soulxMicroUsd',soulx_micro_usd,
      'settledEventCount',settled_event_count,'possibleDuplicateMicroUsd',0));
    verification_expires:=least(transaction_timestamp()+interval '5 minutes',authority.expires_at);
    IF verification_expires<=transaction_timestamp() THEN
      RAISE EXCEPTION 'V212 verification freshness unavailable' USING ERRCODE='42501';
    END IF;
    raw_evidence:=jsonb_build_object(
      'verifierId','videoforge-production-length-output-verifier-v1','accepted',true,
      'verifiedAt',public.videoforge_v213_jit_iso(transaction_timestamp()),
      'expiresAt',public.videoforge_v213_jit_iso(verification_expires),
      'durableInventorySha256',durable_inventory,
      'output',jsonb_build_object('state','COMMITTED',
        'renderAttemptId',render_attempt.id,'assetId',result_document#>>'{output,asset_id}',
        'objectKey',output_receipt.object_key,'sha256',output_receipt.checksum_sha256,
        'bytes',output_receipt.content_length,'contentType','video/mp4',
        'commitReceiptSha256',output_receipt.receipt_sha256),
      'readback',jsonb_build_object('state','GET_REHASH_SUCCEEDED',
        'sha256',output_receipt.checksum_sha256,'bytes',output_receipt.content_length,
        'contentType','video/mp4','receiptSha256',chrome.evidence_document->>'chromeReceiptSha256'),
      'technicalProbe',result_document->'probe',
      'measurements',jsonb_build_object('receiptSha256',public.videoforge_v213_jit_sha256(
          jsonb_build_object('captureSha256',capture.capture_sha256,
            'mageProvenance',mage_provenance.receipt_sha256,
            'soulxProvenance',soulx_provenance.receipt_sha256)),
        'mage',jsonb_build_object('observedGpu',mage_provenance.gpu_name,
          'queueMs',(mage_provider->>'delayTimeMs')::bigint,'initMs',mage_init_ms,
          'executionMs',mage_execution_ms,'totalMs',mage_total_ms,
          'peakVramBytes',mage_provenance.peak_vram_bytes,
          'measurementSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
            'captureProvider',mage_provider,'provenanceReceiptSha256',mage_provenance.receipt_sha256))),
        'soulx',jsonb_build_object('observedGpu',soulx_provenance.gpu_name,
          'queueMs',(soulx_provider->>'delayTimeMs')::bigint,'initMs',soulx_init_ms,
          'executionMs',soulx_execution_ms,'totalMs',soulx_total_ms,
          'peakVramBytes',soulx_provenance.peak_vram_bytes,
          'measurementSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
            'captureProvider',soulx_provider,'provenanceReceiptSha256',soulx_provenance.receipt_sha256))),
        'render',jsonb_build_object('executionMs',render_ms::bigint,'totalMs',render_ms::bigint,
          'measurementSha256',public.videoforge_v213_jit_sha256(jsonb_build_object(
            'renderAttemptId',render_attempt.id,'submittedAt',render_attempt.submitted_at,
            'terminalAt',render_attempt.terminal_at,'resultReceiptSha256',
            render_attempt.result_receipt_sha256)))),
      'settlement',jsonb_build_object('state','SETTLED','mageMicroUsd',mage_micro_usd,
        'soulxMicroUsd',soulx_micro_usd,'renderMicroUsd',0,'otherVariableMicroUsd',0,
        'totalVariableMicroUsd',variable_micro_usd,'possibleDuplicateMicroUsd',0,
        'fixedRetainedVolumesMonthlyMicroUsd',7000000,'fixedRetainedVolumesExcluded',true,
        'settlementReceiptSha256',settlement_sha),
      'review',jsonb_build_object('state','ACCEPTED','reviewReceiptSha256',visual.evidence_sha256,
        'reviewedCutCount',visual.evidence_document#>'{review,reviewedCutCount}',
        'everyCutReviewed',true,'noManualMediaEditOrSubstitution',true,
        'hardCutsOnly',true,'overlaysAbsent',true,'requiredSlowImageZoom',true,
        'visualQualityPassed',true,'audioVideoQualityPassed',true),
      'terminal',jsonb_build_object('attemptId',render_attempt.id,
        'submissionTokenSha256',admission->>'submissionTokenSha256','jobsTerminal',true,
        'activeWorkers',0,'durableInventorySha256',durable_inventory,
        'observedAt',public.videoforge_v213_jit_iso(observed_at)));
  ELSIF child.checkpoint='V2-11' THEN
    SELECT * INTO primary_lease FROM public.provider_workload_leases lease
     WHERE lease.generation_request_id=(primary_identity->>'generationRequestId')::uuid
       AND lease.request_kind='VIDEO' ORDER BY lease.acquired_at DESC LIMIT 1;
    SELECT * INTO secondary_lease FROM public.provider_workload_leases lease
     WHERE lease.generation_request_id=(secondary_identity->>'generationRequestId')::uuid
       AND lease.request_kind='VIDEO' ORDER BY lease.acquired_at DESC LIMIT 1;
    SELECT * INTO apply_policy FROM public.hosted_full_live_v211_policy_actions action
     WHERE action.full_live_authority_id=child.full_live_authority_id
       AND action.operation_id=child.operation_id AND action.action='APPLY_MAX2';
    SELECT * INTO restore_policy FROM public.hosted_full_live_v211_policy_actions action
     WHERE action.full_live_authority_id=child.full_live_authority_id
       AND action.operation_id=child.operation_id AND action.action='RESTORE_MAX1';
    SELECT * INTO wait_event FROM public.hosted_full_live_v211_scenario_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id AND event.sequence=1
       AND event.action='OBSERVE_PROBE_WAITS';
    SELECT * INTO promotion_event FROM public.hosted_full_live_v211_scenario_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id AND event.sequence=2
       AND event.action='OBSERVE_FAIR_PROMOTION';
    SELECT * INTO cancel_event FROM public.hosted_full_live_v211_scenario_events event
     WHERE event.full_live_authority_id=child.full_live_authority_id
       AND event.operation_id=child.operation_id AND event.sequence=3
       AND event.action='CANCEL_PROMOTED_PROBE';
    SELECT * INTO restore_authorization
      FROM public.hosted_full_live_v211_restore_authorizations restore
     WHERE restore.full_live_authority_id=child.full_live_authority_id
       AND restore.operation_id=child.operation_id;
    SELECT * INTO mage_qualification FROM public.hosted_serverless_qualification_attestations q
     WHERE q.id=promotion.mage_qualification_id;
    SELECT * INTO soulx_qualification FROM public.hosted_serverless_qualification_attestations q
     WHERE q.id=promotion.soulx_qualification_id;
    SELECT count(*) INTO primary_video_before FROM public.generation_queue_audits audit
     WHERE audit.account_id=(primary_identity->>'accountId')::uuid
       AND audit.workspace_id=(primary_identity->>'workspaceId')::uuid
       AND audit.request_kind='VIDEO' AND audit.operation='ENQUEUE'
       AND audit.request_id=(primary_identity->>'generationRequestId')::uuid
       AND audit.occurred_at<=primary_lease.acquired_at;
    SELECT count(*) INTO secondary_video_before FROM public.generation_queue_audits audit
     WHERE audit.account_id=(secondary_identity->>'accountId')::uuid
       AND audit.workspace_id=(secondary_identity->>'workspaceId')::uuid
       AND audit.request_kind='VIDEO' AND audit.operation='ENQUEUE'
       AND audit.request_id=(secondary_identity->>'generationRequestId')::uuid
       AND audit.occurred_at<=secondary_lease.acquired_at;
    IF secondary_identity IS NULL OR same_account_waiter IS NULL OR fairness_probe IS NULL
       OR primary_lease.id IS NULL OR secondary_lease.id IS NULL
       OR primary_lease.slot<>1 OR secondary_lease.slot<>2
       OR greatest(primary_lease.acquired_at,secondary_lease.acquired_at)>=least(
          coalesce(primary_lease.released_at,primary_lease.expires_at),
          coalesce(secondary_lease.released_at,secondary_lease.expires_at))
       OR primary_video_before<1 OR secondary_video_before<1
       OR apply_policy.action IS NULL OR restore_policy.action IS NULL
       OR wait_event.action IS NULL OR promotion_event.action IS NULL OR cancel_event.action IS NULL
       OR restore_authorization.operation_id IS NULL OR mage_qualification.id IS NULL
       OR soulx_qualification.id IS NULL
       OR EXISTS(SELECT 1 FROM public.provider_workload_leases lease WHERE lease.state='ACTIVE')
       OR wait_event.source_facts#>>'{sameAccountWaiterGenerationRequestId}'<>
          same_account_waiter->>'generationRequestId'
       OR wait_event.source_facts#>>'{fairnessProbeGenerationRequestId}'<>
          fairness_probe->>'generationRequestId'
       OR promotion_event.source_facts->>'generationRequestId'<>
          fairness_probe->>'generationRequestId'
       OR promotion_event.source_facts#>'{sameAccountWaiterRemainedWaiting}'<>'true'::jsonb
       OR restore_authorization.authorization_document#>'{tenantIsolationDenied}'<>'true'::jsonb THEN
      RAISE EXCEPTION 'V211 exact admission scenario unavailable' USING ERRCODE='42501';
    END IF;
    SELECT jsonb_agg(jsonb_build_object(
      'accountId',attempt.account_id,'workspaceId',attempt.workspace_id,
      'generationRequestId',attempt.generation_request_id,'lane',attempt.lane,
      'attemptId',attempt.id,'providerJobId',assignment.provider_job_id,
      'deploymentId',deployment.id,'endpointIdSha256',deployment.endpoint_id_sha256,
      'endpointConfigSha256',deployment.endpoint_config_sha256,
      'workerImageDigest',deployment.worker_image_digest,
      'modelManifestSha256',deployment.model_manifest_sha256,
      'volumeIdSha256',deployment.volume_id_sha256,
      'volumeManifestSha256',deployment.volume_manifest_sha256,
      'bindingSha256',barrier.binding_sha256,
      'expectedObjectSetSha256',public.videoforge_v213_jit_sha256(barrier.expected_objects),
      'barrierOutcome','LANE_COMPLETED','barrierAcceptanceSha256',barrier.callback_sha256,
      'durableOutputReceiptSha256',
        public.videoforge_v213_jit_sha256(barrier.artifact_commit_receipt_sha256s),
      'workerId',provenance.worker_id,
      'provenanceReceiptSha256',provenance.receipt_sha256,
      'provenanceReceiptHmacVerified',true,
      'volumeManifestSha256Before',provenance.manifest_sha256_before,
      'volumeManifestSha256After',provenance.manifest_sha256_after,
      'volumeMutationDetected',provenance.mutation_detected,
      'crossMountDetected',provenance.cross_mount_detected,
      'scratchRemoved',provenance.scratch_removed,
      'scratchOnModelVolume',provenance.scratch_on_model_volume,
      'providerProgressState','IN_PROGRESS',
      'providerProgressObservedAt',public.videoforge_v213_jit_iso(progress.observed_at),
      'attemptTerminalAt',public.videoforge_v213_jit_iso(attempt.terminal_at))
      ORDER BY CASE WHEN attempt.generation_request_id=
        (primary_identity->>'generationRequestId')::uuid THEN 0 ELSE 1 END,attempt.lane)
      INTO v211_attempts
      FROM public.serverless_attempts attempt
      JOIN public.serverless_provider_assignments assignment
        ON assignment.attempt_id=attempt.id AND assignment.is_current
      JOIN public.serverless_endpoint_deployments deployment ON deployment.id=attempt.deployment_id
      JOIN public.hosted_serverless_output_barrier_completions barrier
        ON barrier.attempt_id=attempt.id AND barrier.assignment_id=assignment.id
      JOIN public.serverless_provenance_receipts provenance
        ON provenance.attempt_id=attempt.id AND provenance.assignment_id=assignment.id
       AND provenance.receipt_sha256=barrier.provenance_receipt_sha256
      JOIN LATERAL (SELECT event.observed_at FROM public.serverless_progress_events event
        WHERE event.attempt_id=attempt.id AND event.assignment_id=assignment.id
          AND event.authoritative AND event.provider_status='IN_PROGRESS'
        ORDER BY event.observed_at,event.sequence LIMIT 1) progress ON true
     WHERE attempt.generation_request_id IN (
       (primary_identity->>'generationRequestId')::uuid,
       (secondary_identity->>'generationRequestId')::uuid)
       AND attempt.state='SUCCEEDED' AND attempt.terminal_at IS NOT NULL
       AND provenance.worker_id IS NOT NULL AND provenance.scratch_removed
       AND NOT provenance.scratch_on_model_volume
       AND NOT provenance.mutation_detected AND NOT provenance.cross_mount_detected
       AND provenance.manifest_sha256_before=deployment.volume_manifest_sha256
       AND provenance.manifest_sha256_after=deployment.volume_manifest_sha256;
    IF coalesce(jsonb_array_length(v211_attempts),0)<>4
       OR (SELECT count(DISTINCT value->>'attemptId') FROM jsonb_array_elements(v211_attempts) value)<>4
       OR (SELECT count(DISTINCT value->>'providerJobId') FROM jsonb_array_elements(v211_attempts) value)<>4
       OR (SELECT count(DISTINCT value->>'durableOutputReceiptSha256')
             FROM jsonb_array_elements(v211_attempts) value)<>4 THEN
      RAISE EXCEPTION 'V211 exact four-attempt evidence unavailable' USING ERRCODE='42501';
    END IF;
    v211_accounts:=jsonb_build_array(
      jsonb_build_object('accountId',primary_identity->>'accountId',
        'workspaceId',primary_identity->>'workspaceId',
        'waitingVideoCountBefore',primary_video_before,'activeVideoCountAfter',1),
      jsonb_build_object('accountId',secondary_identity->>'accountId',
        'workspaceId',secondary_identity->>'workspaceId',
        'waitingVideoCountBefore',secondary_video_before,'activeVideoCountAfter',1));
    v211_promotions:=jsonb_build_array(
      jsonb_build_object('accountId',primary_identity->>'accountId',
        'workspaceId',primary_identity->>'workspaceId','requestKind','VIDEO','slot',1),
      jsonb_build_object('accountId',secondary_identity->>'accountId',
        'workspaceId',secondary_identity->>'workspaceId','requestKind','VIDEO','slot',2));
    verification_expires:=least(transaction_timestamp()+interval '5 minutes',authority.expires_at);
    IF verification_expires<=transaction_timestamp() THEN
      RAISE EXCEPTION 'V211 verification freshness unavailable' USING ERRCODE='42501';
    END IF;
    raw_evidence:=jsonb_build_object(
      'verifierId','videoforge-hosted-v211-evidence-verifier-v1','accepted',true,
      'verifiedAt',public.videoforge_v213_jit_iso(transaction_timestamp()),
      'expiresAt',public.videoforge_v213_jit_iso(verification_expires),
      'transport','RUNPOD_SERVERLESS_HOSTED',
      'admission',jsonb_build_object('accounts',v211_accounts,'promotions',v211_promotions,
        'activeLeaseCount',2,'activeAccountIds',jsonb_build_array(
          primary_identity->>'accountId',secondary_identity->>'accountId'),
        'settlementPromotedRequestIds','[]'::jsonb,'finalActiveLeaseCount',0,
        'scenario',jsonb_build_object(
          'primaryGenerationRequestId',primary_identity->>'generationRequestId',
          'primaryProjectId',primary_identity->>'projectId',
          'primaryProjectRevisionId',primary_identity->>'projectRevisionId',
          'secondaryGenerationRequestId',secondary_identity->>'generationRequestId',
          'secondaryProjectId',secondary_identity->>'projectId',
          'secondaryProjectRevisionId',secondary_identity->>'projectRevisionId',
          'sameAccountWaiter',same_account_waiter||jsonb_build_object('waitingObserved',true,
            'queueAuditReceiptSha256',
              wait_event.source_facts->>'sameAccountWaiterQueueAuditReceiptSha256'),
          'fairnessProbe',fairness_probe||jsonb_build_object('waitingObserved',true,
            'queueAuditReceiptSha256',
              wait_event.source_facts->>'fairnessProbeQueueAuditReceiptSha256'),
          'fairPromotion',jsonb_build_object('generationRequestId',fairness_probe->>'generationRequestId',
            'promotionReceiptSha256',promotion_event.source_facts->>'promotionReceiptSha256',
            'sameAccountWaiterRemainedWaiting',true),
          'cancellationRecovery',jsonb_build_object(
            'cancelAuthorizationReceiptSha256',
              cancel_event.source_facts#>>'{cancellation,cancellationSha256}',
            'cancelReconciliationReceiptSha256',
              probe_reconciliation.reconciliation_sha256,
            'providerDispatchFenced',
              probe_reconciliation.reconciliation_document->'providerDispatchFenced',
            'providerRaceReconciled',
              probe_reconciliation.reconciliation_document->'providerRaceReconciled',
            'providerRaceActualUsd',
              probe_reconciliation.reconciliation_document->'providerRaceActualUsd',
            'providerRaceJobId',probe_reconciliation.reconciliation_document->'providerRaceJobId',
            'providerRaceReceiptSha256',
              probe_reconciliation.reconciliation_document->'providerRaceReceiptSha256',
            'terminalState','CANCELLED','activeLeaseAbsent',true),
          'tenantIsolation',jsonb_build_object('denied',true,
            'denialReceiptSha256',restore_authorization.authorization_document->>
              'tenantIsolationDenialReceiptSha256'))),
      'lanes',jsonb_build_object(
        'mage_image',jsonb_build_object('deploymentId',mage.id,
          'qualificationArtifactSha256',mage_qualification.qualification_record_sha256,
          'lineage',mage.timeout_evidence->'sealed_lineage',
          'baseline',jsonb_build_object('configuredMaxWorkers',1,'activeWorkers',0,
            'qualification','MAX1_VERIFIED'),
          'active',jsonb_build_object('configuredMaxWorkers',2,'activeWorkers',2,
            'qualification','MAX2_VERIFIED','policyReceiptSha256',
            (SELECT value->>'receiptSha256' FROM jsonb_array_elements(
              apply_policy.receipts_document) value WHERE value->>'lane'='mage_image')),
          'restored',jsonb_build_object('configuredMaxWorkers',1,'activeWorkers',0,
            'qualification','MAX1_VERIFIED','policyReceiptSha256',
            (SELECT value->>'receiptSha256' FROM jsonb_array_elements(
              restore_policy.receipts_document) value WHERE value->>'lane'='mage_image')),
          'volumeReadback',jsonb_build_object('crossMountDetected',false,
            'mutationDetected',false,'manifestSha256Before',mage.volume_manifest_sha256,
            'manifestSha256After',mage.volume_manifest_sha256)),
        'soulx_avatar',jsonb_build_object('deploymentId',soulx.id,
          'qualificationArtifactSha256',soulx_qualification.qualification_record_sha256,
          'lineage',soulx.timeout_evidence->'sealed_lineage',
          'baseline',jsonb_build_object('configuredMaxWorkers',1,'activeWorkers',0,
            'qualification','MAX1_VERIFIED'),
          'active',jsonb_build_object('configuredMaxWorkers',2,'activeWorkers',2,
            'qualification','MAX2_VERIFIED','policyReceiptSha256',
            (SELECT value->>'receiptSha256' FROM jsonb_array_elements(
              apply_policy.receipts_document) value WHERE value->>'lane'='soulx_avatar')),
          'restored',jsonb_build_object('configuredMaxWorkers',1,'activeWorkers',0,
            'qualification','MAX1_VERIFIED','policyReceiptSha256',
            (SELECT value->>'receiptSha256' FROM jsonb_array_elements(
              restore_policy.receipts_document) value WHERE value->>'lane'='soulx_avatar')),
          'volumeReadback',jsonb_build_object('crossMountDetected',false,
            'mutationDetected',false,'manifestSha256Before',soulx.volume_manifest_sha256,
            'manifestSha256After',soulx.volume_manifest_sha256))),
      'attempts',v211_attempts,'terminalProviderJobIds',terminal_jobs);
  ELSIF child.checkpoint='V2-13' THEN
    raw_evidence:=jsonb_build_object(
      'schemaVersion','videoforge.v213-fresh-two-lane-smoke-evidence/v1',
      'fullLiveAuthorityId',child.full_live_authority_id,
      'operationId',child.operation_id,'checkpoint',child.checkpoint,
      'outputBindingSha256',output_binding,'technicalCaptureSha256',capture.capture_sha256,
      'finalOutputSha256',runtime.final_output_sha256,
      'finalOutputReceiptSha256',final_receipt);
  ELSE
    RAISE EXCEPTION 'V213 checkpoint final verifier projection unavailable'
      USING ERRCODE='42501';
  END IF;
  receipt:=jsonb_build_object(
    'verifierId','videoforge-v213-live-execution-receipt-verifier-v1','accepted',true,
    'transport','CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS','checkpoint',child.checkpoint,
    'executionId',request->>'executionId','proposalSha256',request->>'proposalSha256',
    'authoritySha256',request->>'authoritySha256',
    'approvalRecordSha256',request->>'approvalRecordSha256','approvalConsumed',true,
    'cumulativeLedgerSha256',request->>'cumulativeLedgerSha256',
    'executorSha256',request->>'executorSha256',
    'promotionDecisionSha256',request->>'promotionDecisionSha256',
    'sourceCommit',request->>'sourceCommit','scopes',request->'scopes',
    'projectDispatchCount',CASE WHEN child.checkpoint='V2-11' THEN 2 ELSE 1 END,
    'mageDispatchCount',CASE WHEN child.checkpoint='V2-11' THEN 2 ELSE 1 END,
    'soulxDispatchCount',CASE WHEN child.checkpoint='V2-11' THEN 2 ELSE 1 END,
    'noRedispatch',true,'phaseCapMicroUsd',request->'maximumVariableCostMicroUsd',
    'cumulativeCapMicroUsd',request->'maximumCumulativeVariableCostMicroUsd',
    'billingBaselineMicroUsd',request->'billingBaselineMicroUsd',
    'billingFinalMicroUsd',(request->>'billingBaselineMicroUsd')::bigint+variable_micro_usd,
    'cumulativeLedgerSpentMicroUsd',
      (request->>'cumulativeLedgerSpentBeforeMicroUsd')::bigint+variable_micro_usd,
    'variableCostMicroUsd',variable_micro_usd,'possibleDuplicateCostMicroUsd',0,
    'billingSettled',true,'terminalProviderJobIds',terminal_jobs,
    'endpointJobs',0,'mageWorkers',0,'soulxWorkers',0,'maxWorkersRestored',1,
    'unknownLiabilities',0,'retainedVolumes',jsonb_build_object(
      'mage',jsonb_build_object('volumeIdSha256',mage.volume_id_sha256,
        'manifestBeforeSha256',mage.volume_manifest_sha256,
        'manifestAfterSha256',mage.volume_manifest_sha256),
      'soulx',jsonb_build_object('volumeIdSha256',soulx.volume_id_sha256,
        'manifestBeforeSha256',soulx.volume_manifest_sha256,
        'manifestAfterSha256',soulx.volume_manifest_sha256)))||jsonb_build_object(
    'zeroWorkerReads',zero_reads,'operatorIntervention',false,
    'finalOutputSha256',runtime.final_output_sha256,
    'finalOutputReceiptSha256',final_receipt,
    'outputCommittedAt',public.videoforge_v213_jit_iso(output_committed_at),
    'realChromePlaybackPassed',child.checkpoint IN ('V2-10','V2-12'),
    'chromePlaybackReceiptSha256',CASE WHEN child.checkpoint IN ('V2-10','V2-12')
      THEN chrome.evidence_document->>'chromeReceiptSha256' ELSE NULL END,
    'chromePlaybackObservedAt',CASE WHEN child.checkpoint IN ('V2-10','V2-12')
      THEN chrome.evidence_document->>'observedAt' ELSE NULL END,
    'userVisualDecision',CASE WHEN child.checkpoint IN ('V2-10','V2-12')
      THEN 'ACCEPTED' ELSE 'NOT_APPLICABLE' END,
    'userVisualDecisionReceiptSha256',CASE WHEN child.checkpoint IN ('V2-10','V2-12')
      THEN visual.evidence_sha256 ELSE NULL END,
    'userVisualDecisionObservedAt',CASE WHEN child.checkpoint IN ('V2-10','V2-12')
      THEN visual.evidence_document->>'observedAt' ELSE NULL END,
    'sameAccountSecondJobWaited',child.checkpoint='V2-11',
    'sameAccountWaitingRequestSha256',CASE WHEN child.checkpoint='V2-11'
      THEN wait_event.source_facts->>'sameAccountWaiterQueueAuditReceiptSha256' ELSE NULL END,
    'thirdAccountWaited',child.checkpoint='V2-11',
    'thirdAccountId',CASE WHEN child.checkpoint='V2-11'
      THEN fairness_probe->>'accountId' ELSE NULL END,
    'thirdAccountWaitingRequestSha256',CASE WHEN child.checkpoint='V2-11'
      THEN wait_event.source_facts->>'fairnessProbeQueueAuditReceiptSha256' ELSE NULL END,
    'fairPromotionPassed',child.checkpoint='V2-11',
    'failureRecoveryExercised',child.checkpoint='V2-11',
    'failureRecoveryReceiptSha256',CASE WHEN child.checkpoint='V2-11'
      THEN probe_reconciliation.reconciliation_sha256 ELSE NULL END,
    'ownershipIsolated',child.checkpoint='V2-11',
    'ownershipIsolationReceiptSha256',CASE WHEN child.checkpoint='V2-11'
      THEN restore_authorization.authorization_document->>'tenantIsolationDenialReceiptSha256'
      ELSE NULL END,
    'observedAt',public.videoforge_v213_jit_iso(observed_at));
  cleanup:=jsonb_build_object(
    'verifierId','videoforge-v213-live-cleanup-verifier-v1','accepted',true,
    'checkpoint',child.checkpoint,'executionId',request->>'executionId',
    'authoritySha256',request->>'authoritySha256','sourceCommit',request->>'sourceCommit',
    'cancelOnly',true,'redispatchCount',0,'endpointJobs',0,'mageWorkers',0,
    'soulxWorkers',0,'maxWorkersRestored',1,'unknownLiabilities',0,
    'retainedVolumes',receipt->'retainedVolumes','zeroWorkerReads',zero_reads,
    'observedAt',public.videoforge_v213_jit_iso(observed_at));
  result:=jsonb_build_object('rawEvidence',raw_evidence,'receipt',receipt,'cleanup',cleanup);
  output_hash:=public.videoforge_v213_jit_sha256(result);
  INSERT INTO public.hosted_full_live_acceptance_workflow_outputs(
    full_live_authority_id,operation_id,output_binding_sha256,output_document,output_sha256)
  VALUES(child.full_live_authority_id,child.operation_id,output_binding,result,output_hash);
  RETURN public.videoforge_read_v213_acceptance_workflow(supplied);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_v213_acceptance_workflow_params_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_prepare_v213_acceptance_technical_capture(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_acceptance_technical_capture(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_prepare_v213_v211_policy_action(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_v211_policy_action(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_acceptance_workflow_scopes(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_acceptance_workflow_output(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_acceptance_workflow(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_acceptance_workflow(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_request_v213_acceptance_workflow_cleanup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_request_v213_acceptance_operator_evidence(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_exercise_v213_acceptance_checkpoint_scenario(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_prepare_v213_v211_scenario_step(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_v211_scenario_step(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_cancel_v213_v211_promoted_probe(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_v211_promoted_probe_reconciliation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_authorize_v213_v211_restore(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_acceptance_zero_worker_read(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_finalize_v213_acceptance_workflow(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_ingest_v213_operator_evidence(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_operator_evidence(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_ingest_v213_acceptance_operator_evidence(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_acceptance_output_binding(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_v212_terminal_output_projection(uuid,text,text) FROM PUBLIC;

CREATE FUNCTION public.videoforge_record_v213_operation_receipt(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; evidence public.hosted_full_live_signed_evidence%ROWTYPE;
  existing public.hosted_full_live_operation_receipts%ROWTYPE; document jsonb:=supplied->'document';
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['artifactSha256','document','fullLiveAuthorityId','operationId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'operationId' NOT IN ('restore-endpoints-max-one','prove-zero-workers',
       'read-settled-billing','reconcile-exact-resources')
     OR supplied->>'artifactSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(document)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(document) key)
       IS DISTINCT FROM ARRAY['fullLiveAuthorityId','operationId','outerStateSha256',
         'providerCleanupEvidenceSha256','schemaVersion','summary']::text[]
     OR document->>'schemaVersion'<>'videoforge.v213-current-run-cleanup-receipt/v1'
     OR document->>'fullLiveAuthorityId'<>supplied->>'fullLiveAuthorityId'
     OR document->>'operationId'<>supplied->>'operationId'
     OR document->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR document->>'providerCleanupEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(document->'summary')<>'object'
     OR document->>'providerCleanupEvidenceSha256'<>
        public.videoforge_v213_jit_sha256(document->'summary')
     OR supplied->>'artifactSha256'<>public.videoforge_v213_jit_sha256(document) THEN
    RAISE EXCEPTION 'V213 operation receipt invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO evidence FROM public.hosted_full_live_signed_evidence row
   WHERE row.artifact_sha256=supplied->>'artifactSha256' AND row.kind='RELEASE';
  IF evidence.artifact_sha256 IS NULL OR evidence.document IS DISTINCT FROM document
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_materialization_challenges challenge
       WHERE challenge.full_live_authority_id=full_authority
         AND challenge.challenge_document->>'outerStateSha256'=document->>'outerStateSha256') THEN
    RAISE EXCEPTION 'V213 operation receipt source unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_operation_receipts receipt
   WHERE receipt.full_live_authority_id=full_authority
     AND receipt.operation_id=supplied->>'operationId';
  IF existing.operation_id IS NOT NULL THEN
    IF existing.artifact_sha256<>supplied->>'artifactSha256'
       OR existing.receipt_document IS DISTINCT FROM document THEN
      RAISE EXCEPTION 'V213 operation receipt replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.artifact_sha256;
  END IF;
  INSERT INTO public.hosted_full_live_operation_receipts(
    full_live_authority_id,operation_id,artifact_sha256,receipt_document)
  VALUES(full_authority,supplied->>'operationId',supplied->>'artifactSha256',document);
  RETURN supplied->>'artifactSha256';
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_operation_receipt(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE receipt public.hosted_full_live_operation_receipts%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['artifactSha256','fullLiveAuthorityId','operationId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'artifactSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 operation receipt read invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO receipt FROM public.hosted_full_live_operation_receipts row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.operation_id=supplied->>'operationId'
     AND row.artifact_sha256=supplied->>'artifactSha256';
  IF receipt.operation_id IS NULL THEN
    RAISE EXCEPTION 'V213 operation receipt unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('artifactSha256',receipt.artifact_sha256,
    'operationId',receipt.operation_id,'document',receipt.receipt_document);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_operation_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_operation_receipt(jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_record_v213_release_identity_facts(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; facts jsonb:=supplied->'facts'; refs jsonb:=supplied->'sourceRefs';
  authority public.hosted_full_live_authorities%ROWTYPE;
  activation public.hosted_full_live_cloudflare_activations%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE;
  mage public.serverless_endpoint_deployments%ROWTYPE;
  soulx public.serverless_endpoint_deployments%ROWTYPE;
  descriptor public.hosted_full_live_static_release_descriptors%ROWTYPE;
  identity jsonb; identity_sha text; existing public.hosted_full_live_release_identity_facts%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['facts','fullLiveAuthorityId','sourceRefs']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(facts)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(facts) key)
       IS DISTINCT FROM ARRAY['contractBundleSha256','deployedExecutableSha256',
         'deployedSourceCommit','deploymentConfigSha256','mageCertificationLedgerSha256',
         'mageEndpointConfigSha256','mageImageDigest','productionUrlSha256',
         'soulxCertificationLedgerSha256','soulxEndpointConfigSha256','soulxImageDigest',
         'v209AcceptanceSha256','v210AcceptanceSha256','v211AcceptanceSha256',
         'v212AcceptanceSha256']::text[]
     OR jsonb_typeof(refs)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(refs) key)
       IS DISTINCT FROM ARRAY['cloudflareActivationReadbackSha256',
         'staticReleaseDescriptorSha256']::text[]
     OR EXISTS(SELECT 1 FROM jsonb_each_text(facts) item
       WHERE item.key<>'deployedSourceCommit' AND item.value !~ '^sha256:[0-9a-f]{64}$')
     OR facts->>'deployedSourceCommit' !~ '^[0-9a-f]{40}$'
     OR EXISTS(SELECT 1 FROM jsonb_each_text(refs) item
       WHERE item.value !~ '^sha256:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'V213 release identity facts invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=full_authority;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=full_authority;
  SELECT * INTO activation FROM public.hosted_full_live_cloudflare_activations
   WHERE promotion_id=promotion.id;
  SELECT * INTO mage FROM public.serverless_endpoint_deployments WHERE id=promotion.mage_deployment_id;
  SELECT * INTO soulx FROM public.serverless_endpoint_deployments WHERE id=promotion.soulx_deployment_id;
  SELECT * INTO descriptor FROM public.hosted_full_live_static_release_descriptors row
   WHERE row.full_live_authority_id=full_authority;
  IF authority.id IS NULL OR promotion.id IS NULL OR activation.id IS NULL
     OR authority.expires_at<=transaction_timestamp()
     OR mage.id IS NULL OR soulx.id IS NULL OR descriptor.full_live_authority_id IS NULL
     OR refs->>'cloudflareActivationReadbackSha256' IS DISTINCT FROM activation.readback_sha256
     OR refs->>'staticReleaseDescriptorSha256' IS DISTINCT FROM descriptor.descriptor_sha256
     OR facts->>'deployedSourceCommit' IS DISTINCT FROM authority.source_commit
     OR activation.source_commit IS DISTINCT FROM authority.source_commit
     OR activation.readback_document->>'sourceCommit' IS DISTINCT FROM authority.source_commit
     OR facts->>'deploymentConfigSha256' IS DISTINCT FROM activation.deployed_config_sha256
     OR facts->>'mageImageDigest' IS DISTINCT FROM mage.worker_image_digest
     OR facts->>'soulxImageDigest' IS DISTINCT FROM soulx.worker_image_digest
     OR facts->>'mageEndpointConfigSha256' IS DISTINCT FROM mage.endpoint_config_sha256
     OR facts->>'soulxEndpointConfigSha256' IS DISTINCT FROM soulx.endpoint_config_sha256
     OR facts->>'mageCertificationLedgerSha256' IS DISTINCT FROM promotion.mage_qualification_sha256
     OR facts->>'soulxCertificationLedgerSha256' IS DISTINCT FROM promotion.soulx_qualification_sha256
     OR facts->>'v209AcceptanceSha256' IS DISTINCT FROM (SELECT terminal.result_sha256
       FROM public.hosted_v209_terminal_acceptances terminal
       JOIN public.hosted_full_live_materialization_facts materialized
         ON materialized.facts_document#>>'{roleScopedIdentities,primary,generationRequestId}'=
            terminal.generation_request_id::text
       JOIN public.hosted_full_live_materialization_challenges challenge
         ON challenge.id=materialized.challenge_id
       WHERE challenge.full_live_authority_id=full_authority)
     OR facts->>'v210AcceptanceSha256' IS DISTINCT FROM (SELECT result.evidence_sha256
       FROM public.hosted_full_live_acceptance_results result
       JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
       JOIN public.hosted_full_live_acceptance_authorities acceptance
         ON acceptance.id=claim.acceptance_authority_id
       WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-10')
     OR facts->>'v211AcceptanceSha256' IS DISTINCT FROM (SELECT result.evidence_sha256
       FROM public.hosted_full_live_acceptance_results result
       JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
       JOIN public.hosted_full_live_acceptance_authorities acceptance
         ON acceptance.id=claim.acceptance_authority_id
       WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-11')
     OR facts->>'v212AcceptanceSha256' IS DISTINCT FROM (SELECT result.evidence_sha256
       FROM public.hosted_full_live_acceptance_results result
       JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
       JOIN public.hosted_full_live_acceptance_authorities acceptance
         ON acceptance.id=claim.acceptance_authority_id
       WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-12')
     OR facts->>'deployedExecutableSha256' IS DISTINCT FROM
        activation.readback_document->>'deployedExecutableSha256'
     OR facts->>'productionUrlSha256' IS DISTINCT FROM activation.readback_document->>'productionUrlSha256'
     OR activation.readback_document->>'productionUrlSha256' IS DISTINCT FROM
        descriptor.descriptor_document->>'productionUrlSha256'
     OR activation.readback_document->>'routeStatus' IS DISTINCT FROM '200'
     OR activation.readback_document->>'routeVersionSha256' IS DISTINCT FROM
        activation.readback_document->>'versionIdSha256'
     OR facts->>'contractBundleSha256' IS DISTINCT FROM
        descriptor.descriptor_document->>'contractBundleSha256' THEN
    RAISE EXCEPTION 'V213 release identity source facts unavailable' USING ERRCODE='42501';
  END IF;
  identity:=jsonb_build_object('schemaVersion','videoforge-v213-release-identity/v1',
    'sourceCommit',authority.source_commit)||facts;
  identity_sha:=public.videoforge_v213_jit_sha256(identity);
  SELECT * INTO existing FROM public.hosted_full_live_release_identity_facts row
   WHERE row.full_live_authority_id=full_authority;
  IF existing.full_live_authority_id IS NOT NULL THEN
    IF existing.facts_document IS DISTINCT FROM facts OR existing.source_refs IS DISTINCT FROM refs
       OR existing.release_identity_sha256<>identity_sha THEN
      RAISE EXCEPTION 'V213 release identity replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.release_identity_sha256;
  END IF;
  INSERT INTO public.hosted_full_live_release_identity_facts(full_live_authority_id,
    facts_document,release_identity_sha256,source_refs)
  VALUES(full_authority,facts,identity_sha,refs);
  RETURN identity_sha;
END;
$$;

CREATE FUNCTION public.videoforge_record_v213_release_gate_fact(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; fact jsonb:=supplied->'fact'; refs jsonb:=supplied->'sourceRefs';
  gate_name text:=supplied->>'gate'; expected_operation text; fact_sha text;
  existing public.hosted_full_live_release_gate_facts%ROWTYPE; source_sha text;
  source_valid boolean;
BEGIN
  expected_operation:=CASE gate_name
    WHEN 'mage_certified_ledger' THEN 'mage-live-qualification'
    WHEN 'soulx_certified_ledger' THEN 'soulx-live-qualification'
    WHEN 'v209_short_e2e' THEN 'v2-09-short-hosted-project'
    WHEN 'v210_automatic_pilot' THEN 'v2-10-operator-free-ranga-pilot'
    WHEN 'v211_two_account_queue' THEN 'v2-11-two-concurrent-owned-projects'
    WHEN 'v212_production_length_economics' THEN 'v2-12-long-output'
    WHEN 'release_identity_current' THEN 'guarded-activation'
    WHEN 'fresh_bounded_two_lane_smoke' THEN 'v2-13-final-two-lane-smoke'
    WHEN 'independent_zero_drain' THEN 'prove-zero-workers'
    WHEN 'settled_billing' THEN 'read-settled-billing'
    WHEN 'rollback_ready' THEN 'restore-endpoints-max-one'
    WHEN 'operations_runbooks_ready' THEN 'record-workflow-start-authority'
    WHEN 'backup_restore_ready' THEN 'record-workflow-start-authority'
    WHEN 'security_clear' THEN 'record-workflow-start-authority'
    WHEN 'production_transport_real' THEN 'record-workflow-start-authority' ELSE NULL END;
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['fact','fullLiveAuthorityId','gate','sourceOperationId','sourceRefs']::text[]
     OR expected_operation IS NULL
     OR supplied->>'sourceOperationId' IS DISTINCT FROM expected_operation
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(fact)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(fact) key)
       IS DISTINCT FROM ARRAY['claims','evidenceClass','evidencePath','fixtureOrFakeTransportUsed',
         'gate','metrics','observedAt','observerId','sourceEvidenceSha256']::text[]
     OR fact->>'gate' IS DISTINCT FROM gate_name
     OR coalesce(fact->>'sourceEvidenceSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(fact->>'evidenceClass','') NOT IN
        ('LIVE_PROVIDER','LIVE_HOSTED','INDEPENDENT_RELEASE_AUDIT')
     OR fact->'fixtureOrFakeTransportUsed' IS DISTINCT FROM 'false'::jsonb
     OR jsonb_typeof(fact->'claims') IS DISTINCT FROM 'array'
     OR jsonb_typeof(fact->'metrics') IS DISTINCT FROM 'object'
     OR jsonb_typeof(refs)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(refs) key)
       IS DISTINCT FROM ARRAY['sourceEvidenceSha256']::text[]
     OR refs->>'sourceEvidenceSha256' IS DISTINCT FROM fact->>'sourceEvidenceSha256' THEN
    RAISE EXCEPTION 'V213 release gate fact invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  source_sha:=fact->>'sourceEvidenceSha256';
  source_valid:=CASE gate_name
    WHEN 'mage_certified_ledger' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p
      WHERE p.authority_id=full_authority AND p.mage_qualification_sha256=source_sha)
    WHEN 'soulx_certified_ledger' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p
      WHERE p.authority_id=full_authority AND p.soulx_qualification_sha256=source_sha)
    WHEN 'v209_short_e2e' THEN EXISTS(SELECT 1 FROM public.hosted_v209_terminal_acceptances terminal
      JOIN public.hosted_full_live_materialization_facts materialized
        ON materialized.facts_document#>>'{roleScopedIdentities,primary,generationRequestId}'=
           terminal.generation_request_id::text
      JOIN public.hosted_full_live_materialization_challenges challenge
        ON challenge.id=materialized.challenge_id
      WHERE challenge.full_live_authority_id=full_authority AND terminal.result_sha256=source_sha)
    WHEN 'v210_automatic_pilot' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_results result
      JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
      JOIN public.hosted_full_live_acceptance_authorities acceptance
        ON acceptance.id=claim.acceptance_authority_id
      WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-10'
        AND result.evidence_sha256=source_sha)
    WHEN 'v211_two_account_queue' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_results result
      JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
      JOIN public.hosted_full_live_acceptance_authorities acceptance
        ON acceptance.id=claim.acceptance_authority_id
      WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-11'
        AND result.evidence_sha256=source_sha)
    WHEN 'v212_production_length_economics' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_acceptance_results result
      JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
      JOIN public.hosted_full_live_acceptance_authorities acceptance
        ON acceptance.id=claim.acceptance_authority_id
      WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-12'
        AND result.evidence_sha256=source_sha)
    WHEN 'release_identity_current' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_release_identity_facts identity
      WHERE identity.full_live_authority_id=full_authority AND identity.release_identity_sha256=source_sha)
    WHEN 'fresh_bounded_two_lane_smoke' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_signed_evidence e
      WHERE e.artifact_sha256=source_sha AND e.kind='RELEASE'
        AND e.document->>'schemaVersion'='videoforge.v213-fresh-two-lane-smoke-result/v1'
        AND e.document->>'fullLiveAuthorityId'=full_authority::text)
    WHEN 'independent_zero_drain' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts r
      WHERE r.full_live_authority_id=full_authority AND r.operation_id='prove-zero-workers'
        AND r.artifact_sha256=source_sha)
    WHEN 'settled_billing' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts r
      WHERE r.full_live_authority_id=full_authority AND r.operation_id='read-settled-billing'
        AND r.artifact_sha256=source_sha)
    WHEN 'rollback_ready' THEN EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts r
      WHERE r.full_live_authority_id=full_authority AND r.operation_id='restore-endpoints-max-one'
        AND r.artifact_sha256=source_sha
        AND r.receipt_document#>>'{summary,rollbackIdentityPinned}'='true'
        AND r.receipt_document#>>'{summary,rollbackReadbackPassed}'='true'
        AND r.receipt_document#>>'{summary,releaseCurrentRestored}'='true')
    ELSE EXISTS(SELECT 1 FROM public.hosted_full_live_static_release_descriptors descriptor
      WHERE descriptor.full_live_authority_id=full_authority
        AND descriptor.descriptor_document->'auditFacts'->gate_name IS NOT DISTINCT FROM fact
        AND descriptor.descriptor_document#>>ARRAY['auditFacts',gate_name,
          'sourceEvidenceSha256']=source_sha)
    END;
  IF NOT source_valid THEN
    RAISE EXCEPTION 'V213 release gate source unavailable' USING ERRCODE='42501';
  END IF;
  fact_sha:=public.videoforge_v213_jit_sha256(fact);
  SELECT * INTO existing FROM public.hosted_full_live_release_gate_facts row
   WHERE row.full_live_authority_id=full_authority AND row.gate=gate_name;
  IF existing.gate IS NOT NULL THEN
    IF existing.source_operation_id<>expected_operation OR existing.source_refs IS DISTINCT FROM refs
       OR existing.fact_document IS DISTINCT FROM fact OR existing.fact_sha256<>fact_sha THEN
      RAISE EXCEPTION 'V213 release gate fact replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.fact_sha256;
  END IF;
  INSERT INTO public.hosted_full_live_release_gate_facts(full_live_authority_id,gate,
    source_operation_id,source_refs,fact_document,fact_sha256)
  VALUES(full_authority,gate_name,expected_operation,refs,fact,fact_sha);
  RETURN fact_sha;
END;
$$;

CREATE FUNCTION public.videoforge_v213_release_gate_fact_document(
  gate_name text, source_sha256 text, observed_at timestamptz, metrics_document jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claims jsonb; evidence_class text; observer_id text;
BEGIN
  claims:=CASE gate_name
    WHEN 'mage_certified_ledger' THEN jsonb_build_array('certified_ledger_qualified',
      'lineage_current','billing_settled','terminal_jobs','zero_workers')
    WHEN 'soulx_certified_ledger' THEN jsonb_build_array('certified_ledger_qualified',
      'lineage_current','billing_settled','terminal_jobs','zero_workers')
    WHEN 'v209_short_e2e' THEN jsonb_build_array('real_hosted_chrome',
      'private_output_readback','no_manual_media_edit','terminal_jobs','zero_workers')
    WHEN 'v210_automatic_pilot' THEN jsonb_build_array('automatic_3_to_5_minute_output',
      'every_cut_reviewed','user_visual_decision_accepted','settled_itemized_cost','zero_workers')
    WHEN 'v211_two_account_queue' THEN jsonb_build_array('two_distinct_accounts',
      'one_active_per_account','two_active_globally','fair_wait_and_promotion','tenant_private',
      'two_readers_per_lane','config_restored','zero_jobs_zero_workers')
    WHEN 'v212_production_length_economics' THEN jsonb_build_array(
      'automatic_29_to_31_minute_output','quality_accepted','user_decision_accepted',
      'settled_cost_under_hard_ceiling','terminal_jobs','zero_workers')
    WHEN 'release_identity_current' THEN jsonb_build_array('source_current',
      'deployment_current','contracts_current','lane_identities_current','production_url_verified')
    WHEN 'fresh_bounded_two_lane_smoke' THEN jsonb_build_array('one_mage_dispatch',
      'one_soulx_dispatch','bounded_spend','durable_readback','exact_release_identity')
    WHEN 'independent_zero_drain' THEN jsonb_build_array('independent_observation',
      'zero_endpoint_jobs','zero_mage_workers','zero_soulx_workers','no_unknown_liability')
    WHEN 'settled_billing' THEN jsonb_build_array('all_variable_billing_settled',
      'duplicate_cost_visible','recurring_charges_disclosed')
    WHEN 'rollback_ready' THEN jsonb_build_array('rollback_identity_pinned',
      'rollback_readback_passed','release_current_restored') ELSE NULL END;
  IF claims IS NULL OR source_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR observed_at IS NULL OR jsonb_typeof(metrics_document)<>'object' THEN
    RAISE EXCEPTION 'V213 release gate fact projection invalid' USING ERRCODE='23514';
  END IF;
  evidence_class:=CASE WHEN gate_name IN ('mage_certified_ledger','soulx_certified_ledger',
    'fresh_bounded_two_lane_smoke','independent_zero_drain','settled_billing')
    THEN 'LIVE_PROVIDER' WHEN gate_name IN ('release_identity_current','rollback_ready')
    THEN 'INDEPENDENT_RELEASE_AUDIT' ELSE 'LIVE_HOSTED' END;
  observer_id:=CASE gate_name
    WHEN 'fresh_bounded_two_lane_smoke' THEN 'videoforge-live-smoke-verifier'
    WHEN 'independent_zero_drain' THEN 'videoforge-independent-zero-drain'
    WHEN 'settled_billing' THEN 'videoforge-independent-billing-readback'
    WHEN 'rollback_ready' THEN 'videoforge-independent-rollback-readback'
    ELSE 'videoforge-db-current-run-verifier' END;
  RETURN jsonb_build_object('gate',gate_name,'sourceEvidenceSha256',source_sha256,
    'observerId',observer_id,'evidencePath',
      'project-context/evidence/acceptance/VF-10-13/'||gate_name||'.json',
    'evidenceClass',evidence_class,'observedAt',public.videoforge_v213_jit_iso(observed_at),
    'fixtureOrFakeTransportUsed',false,'claims',claims,'metrics',metrics_document);
END;
$$;

CREATE FUNCTION public.videoforge_materialize_v213_release_facts(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; completed_operation text:=supplied->>'completedOperationId';
  completed_sha text:=supplied->>'completedEvidenceSha256';
  authority public.hosted_full_live_authorities%ROWTYPE;
  promotion public.hosted_full_live_promotions%ROWTYPE;
  activation public.hosted_full_live_cloudflare_activations%ROWTYPE;
  descriptor public.hosted_full_live_static_release_descriptors%ROWTYPE;
  mage public.serverless_endpoint_deployments%ROWTYPE;
  soulx public.serverless_endpoint_deployments%ROWTYPE;
  mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  v209 public.hosted_v209_terminal_acceptances%ROWTYPE;
  operation_receipt public.hosted_full_live_operation_receipts%ROWTYPE;
  smoke public.hosted_full_live_signed_evidence%ROWTYPE;
  acceptance_result record; v210_result record; v211_result record; v212_result record;
  v213_result record; chrome public.hosted_full_live_signed_evidence%ROWTYPE;
  visual jsonb; capture jsonb; fact jsonb; metrics jsonb; gate_name text; fact_hash text;
  identity_sha text; gate_hashes jsonb; base jsonb; materialization_hash text;
  existing public.hosted_full_live_release_fact_materializations%ROWTYPE;
  unsettled_count integer; total_variable_micro_usd bigint; possible_duplicate_micro_usd bigint;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['completedEvidenceSha256','completedOperationId',
         'fullLiveAuthorityId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR completed_sha !~ '^sha256:[0-9a-f]{64}$'
     OR completed_operation NOT IN ('v2-09-short-hosted-project',
       'v2-10-operator-free-ranga-pilot','v2-11-two-concurrent-owned-projects',
       'v2-12-long-output','v2-13-final-two-lane-smoke','restore-endpoints-max-one',
       'prove-zero-workers','read-settled-billing','reconcile-exact-resources') THEN
    RAISE EXCEPTION 'V213 release fact materialization request invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(full_authority::text||completed_operation,213));
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=full_authority;
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE authority_id=full_authority;
  SELECT * INTO activation FROM public.hosted_full_live_cloudflare_activations
   WHERE promotion_id=promotion.id;
  SELECT * INTO descriptor FROM public.hosted_full_live_static_release_descriptors row
   WHERE row.full_live_authority_id=full_authority;
  SELECT * INTO mage FROM public.serverless_endpoint_deployments WHERE id=promotion.mage_deployment_id;
  SELECT * INTO soulx FROM public.serverless_endpoint_deployments WHERE id=promotion.soulx_deployment_id;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations
   WHERE id=promotion.mage_qualification_id;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations
   WHERE id=promotion.soulx_qualification_id;
  SELECT terminal.* INTO v209 FROM public.hosted_v209_terminal_acceptances terminal
   JOIN public.hosted_full_live_materialization_facts materialized
     ON materialized.facts_document#>>'{roleScopedIdentities,primary,generationRequestId}'=
        terminal.generation_request_id::text
   JOIN public.hosted_full_live_materialization_challenges challenge
     ON challenge.id=materialized.challenge_id
   WHERE challenge.full_live_authority_id=full_authority;
  SELECT result.*,acceptance.checkpoint INTO acceptance_result
    FROM public.hosted_full_live_acceptance_results result
    JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
    JOIN public.hosted_full_live_acceptance_authorities acceptance
      ON acceptance.id=claim.acceptance_authority_id
   WHERE acceptance.full_live_authority_id=full_authority
     AND acceptance.checkpoint=CASE completed_operation
       WHEN 'v2-10-operator-free-ranga-pilot' THEN 'V2-10'
       WHEN 'v2-11-two-concurrent-owned-projects' THEN 'V2-11'
       WHEN 'v2-12-long-output' THEN 'V2-12'
       WHEN 'v2-13-final-two-lane-smoke' THEN 'V2-13' ELSE NULL END;
  IF completed_operation IN ('restore-endpoints-max-one','prove-zero-workers',
      'read-settled-billing','reconcile-exact-resources') THEN
    SELECT * INTO operation_receipt FROM public.hosted_full_live_operation_receipts row
     WHERE row.full_live_authority_id=full_authority
       AND row.operation_id=completed_operation AND row.artifact_sha256=completed_sha;
  END IF;
  IF completed_operation='v2-13-final-two-lane-smoke' THEN
    SELECT * INTO smoke FROM public.hosted_full_live_signed_evidence row
     WHERE row.artifact_sha256=completed_sha AND row.kind='RELEASE'
       AND row.document->>'schemaVersion'='videoforge.v213-fresh-two-lane-smoke-result/v1'
       AND row.document->>'fullLiveAuthorityId'=full_authority::text;
  END IF;
  IF authority.id IS NULL OR authority.expires_at<=transaction_timestamp()
     OR promotion.id IS NULL OR activation.id IS NULL OR descriptor.full_live_authority_id IS NULL
     OR (CASE completed_operation
       WHEN 'v2-09-short-hosted-project' THEN v209.result_sha256 IS DISTINCT FROM completed_sha
       WHEN 'v2-10-operator-free-ranga-pilot' THEN acceptance_result.evidence_sha256 IS DISTINCT FROM completed_sha
       WHEN 'v2-11-two-concurrent-owned-projects' THEN acceptance_result.evidence_sha256 IS DISTINCT FROM completed_sha
       WHEN 'v2-12-long-output' THEN acceptance_result.evidence_sha256 IS DISTINCT FROM completed_sha
       WHEN 'v2-13-final-two-lane-smoke' THEN smoke.artifact_sha256 IS NULL
       ELSE operation_receipt.operation_id IS NULL END) THEN
    RAISE EXCEPTION 'V213 release fact completed source unavailable' USING ERRCODE='42501';
  END IF;

  IF completed_operation='v2-09-short-hosted-project' THEN
    IF mage_q.id IS NULL OR soulx_q.id IS NULL OR NOT mage_q.independent_audit_accepted
       OR NOT soulx_q.independent_audit_accepted OR mage.retained_active_workers<>0
       OR soulx.retained_active_workers<>0 OR mage.worker_count_min<>0 OR soulx.worker_count_min<>0
       OR mage.worker_count_max<>1 OR soulx.worker_count_max<>1
       OR EXISTS(SELECT 1 FROM public.serverless_attempts attempt
         WHERE attempt.deployment_id IN (mage.id,soulx.id)
           AND attempt.state NOT IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED')) THEN
      RAISE EXCEPTION 'V213 qualification release facts unavailable' USING ERRCODE='42501';
    END IF;
    FOREACH gate_name IN ARRAY ARRAY['mage_certified_ledger','soulx_certified_ledger'] LOOP
      IF gate_name='mage_certified_ledger' THEN
        fact:=public.videoforge_v213_release_gate_fact_document(gate_name,
          promotion.mage_qualification_sha256,mage_q.verified_at,
          jsonb_build_object('qualified',true,'billingSettled',true,'terminalJobs',0,
            'activeWorkers',0));
      ELSE
        fact:=public.videoforge_v213_release_gate_fact_document(gate_name,
          promotion.soulx_qualification_sha256,soulx_q.verified_at,
          jsonb_build_object('qualified',true,'billingSettled',true,'terminalJobs',0,
            'activeWorkers',0));
      END IF;
      PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
        'fullLiveAuthorityId',full_authority,'gate',gate_name,
        'sourceOperationId',CASE gate_name WHEN 'mage_certified_ledger'
          THEN 'mage-live-qualification' ELSE 'soulx-live-qualification' END,
        'sourceRefs',jsonb_build_object('sourceEvidenceSha256',fact->>'sourceEvidenceSha256'),
        'fact',fact));
    END LOOP;
    SELECT * INTO chrome FROM public.hosted_full_live_signed_evidence row
     WHERE row.artifact_sha256=v209.chrome_evidence_sha256 AND row.kind='CHROME';
    IF chrome.document->'playbackAccepted' IS DISTINCT FROM 'true'::jsonb
       OR chrome.document->'downloadAccepted' IS DISTINCT FROM 'true'::jsonb
       OR EXISTS(SELECT 1 FROM public.provider_workload_leases lease
         WHERE lease.generation_request_id=v209.generation_request_id AND lease.state='ACTIVE') THEN
      RAISE EXCEPTION 'V213 V209 release facts unavailable' USING ERRCODE='42501';
    END IF;
    fact:=public.videoforge_v213_release_gate_fact_document('v209_short_e2e',v209.result_sha256,
      v209.accepted_at,jsonb_build_object('durationSeconds',v209.result_document->'durationSeconds',
        'chromeAccepted',true,'privateReadbackPassed',true,'terminalJobs',0,
        'totalActiveWorkers',0));
    PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
      'fullLiveAuthorityId',full_authority,'gate','v209_short_e2e',
      'sourceOperationId','v2-09-short-hosted-project',
      'sourceRefs',jsonb_build_object('sourceEvidenceSha256',v209.result_sha256),'fact',fact));
    FOREACH gate_name IN ARRAY ARRAY['operations_runbooks_ready','backup_restore_ready',
      'security_clear','production_transport_real'] LOOP
      fact:=descriptor.descriptor_document->'auditFacts'->gate_name;
      PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
        'fullLiveAuthorityId',full_authority,'gate',gate_name,
        'sourceOperationId','record-workflow-start-authority',
        'sourceRefs',jsonb_build_object('sourceEvidenceSha256',fact->>'sourceEvidenceSha256'),
        'fact',fact));
    END LOOP;
  ELSIF completed_operation IN ('v2-10-operator-free-ranga-pilot',
      'v2-11-two-concurrent-owned-projects','v2-12-long-output') THEN
    IF acceptance_result.state IS DISTINCT FROM 'COMPLETED'
       OR acceptance_result.result_document->'receipt' IS NULL
       OR acceptance_result.result_document#>>'{receipt,canonicalArtifactSha256}' IS DISTINCT FROM
          acceptance_result.evidence_sha256
       OR acceptance_result.result_document#>>'{receipt,billingSettled}' IS DISTINCT FROM 'true'
       OR acceptance_result.result_document#>>'{receipt,endpointJobs}' IS DISTINCT FROM '0'
       OR acceptance_result.result_document#>>'{receipt,mageWorkers}' IS DISTINCT FROM '0'
       OR acceptance_result.result_document#>>'{receipt,soulxWorkers}' IS DISTINCT FROM '0'
       OR acceptance_result.result_document#>>'{receipt,maxWorkersRestored}' IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'V213 acceptance release facts unavailable' USING ERRCODE='42501';
    END IF;
    IF completed_operation='v2-10-operator-free-ranga-pilot' THEN
      SELECT evidence_document INTO visual FROM public.hosted_full_live_acceptance_operator_evidence
       WHERE full_live_authority_id=full_authority AND kind='V210_VISUAL_DECISION';
      SELECT capture_document INTO capture FROM public.hosted_full_live_acceptance_technical_captures
       WHERE full_live_authority_id=full_authority
         AND operation_id='v2-10-operator-free-ranga-pilot';
      IF visual#>>'{decision}' IS DISTINCT FROM 'ACCEPTED'
         OR visual#>>'{review,everyCutReviewed}' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'V213 V210 release review unavailable' USING ERRCODE='42501';
      END IF;
      metrics:=jsonb_build_object('durationSeconds',
        (capture#>>'{captures,0,resultDocument,probe,duration_ms}')::numeric/1000,
        'everyCutReviewed',true,'userVisualDecisionAccepted',true,
        'variableCostSettled',true,'terminalJobs',0,'totalActiveWorkers',0);
      gate_name:='v210_automatic_pilot';
    ELSIF completed_operation='v2-11-two-concurrent-owned-projects' THEN
      IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_v211_policy_actions policy
        WHERE policy.full_live_authority_id=full_authority
          AND policy.operation_id=completed_operation AND policy.action='APPLY_MAX2')
         OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_v211_policy_actions policy
        WHERE policy.full_live_authority_id=full_authority
          AND policy.operation_id=completed_operation AND policy.action='RESTORE_MAX1')
         OR (SELECT count(*) FROM public.hosted_full_live_v211_scenario_events event
          WHERE event.full_live_authority_id=full_authority
            AND event.operation_id=completed_operation)<>3 THEN
        RAISE EXCEPTION 'V213 V211 release scenario unavailable' USING ERRCODE='42501';
      END IF;
      metrics:=jsonb_build_object('distinctAccounts',2,'maxActivePerAccount',1,
        'maxActiveGlobal',2,'maxGpuWorkers',4,'fairPromotionPassed',true,
        'foreignAccessCount',0,'twoReadersPerLanePassed',true,'volumesUnchanged',true,
        'configRestored',true,'terminalJobs',0,'endpointJobs',0,'totalActiveWorkers',0);
      gate_name:='v211_two_account_queue';
    ELSE
      SELECT evidence_document INTO visual FROM public.hosted_full_live_acceptance_operator_evidence
       WHERE full_live_authority_id=full_authority AND kind='V212_VISUAL_DECISION';
      SELECT capture_document INTO capture FROM public.hosted_full_live_acceptance_technical_captures
       WHERE full_live_authority_id=full_authority AND operation_id='v2-12-long-output';
      IF visual#>>'{decision}' IS DISTINCT FROM 'ACCEPTED'
         OR visual#>>'{review,visualQualityPassed}' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'V213 V212 release review unavailable' USING ERRCODE='42501';
      END IF;
      metrics:=jsonb_build_object('durationSeconds',
        (capture#>>'{captures,0,resultDocument,probe,duration_ms}')::numeric/1000,
        'qualityAccepted',true,'userDecisionAccepted',true,'billingSettled',true,
        'variableCostMicroUsd',acceptance_result.result_document#>'{receipt,variableCostMicroUsd}',
        'terminalJobs',0,'totalActiveWorkers',0);
      gate_name:='v212_production_length_economics';
    END IF;
    fact:=public.videoforge_v213_release_gate_fact_document(gate_name,
      acceptance_result.evidence_sha256,acceptance_result.completed_at,metrics);
    PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
      'fullLiveAuthorityId',full_authority,'gate',gate_name,
      'sourceOperationId',completed_operation,
      'sourceRefs',jsonb_build_object('sourceEvidenceSha256',acceptance_result.evidence_sha256),
      'fact',fact));
    IF completed_operation='v2-12-long-output' THEN
      SELECT result.evidence_sha256,result.result_document,result.completed_at INTO v210_result
        FROM public.hosted_full_live_acceptance_results result
        JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
        JOIN public.hosted_full_live_acceptance_authorities acceptance
          ON acceptance.id=claim.acceptance_authority_id
       WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-10';
      SELECT result.evidence_sha256,result.result_document,result.completed_at INTO v211_result
        FROM public.hosted_full_live_acceptance_results result
        JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
        JOIN public.hosted_full_live_acceptance_authorities acceptance
          ON acceptance.id=claim.acceptance_authority_id
       WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-11';
      SELECT result.evidence_sha256,result.result_document,result.completed_at INTO v212_result
        FROM public.hosted_full_live_acceptance_results result
        JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
        JOIN public.hosted_full_live_acceptance_authorities acceptance
          ON acceptance.id=claim.acceptance_authority_id
       WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-12';
      identity_sha:=public.videoforge_record_v213_release_identity_facts(jsonb_build_object(
        'fullLiveAuthorityId',full_authority,'sourceRefs',jsonb_build_object(
          'cloudflareActivationReadbackSha256',activation.readback_sha256,
          'staticReleaseDescriptorSha256',descriptor.descriptor_sha256),
        'facts',jsonb_build_object('deployedSourceCommit',authority.source_commit,
          'deployedExecutableSha256',activation.readback_document->>'deployedExecutableSha256',
          'deploymentConfigSha256',activation.deployed_config_sha256,
          'mageImageDigest',mage.worker_image_digest,'soulxImageDigest',soulx.worker_image_digest,
          'mageEndpointConfigSha256',mage.endpoint_config_sha256,
          'soulxEndpointConfigSha256',soulx.endpoint_config_sha256,
          'mageCertificationLedgerSha256',promotion.mage_qualification_sha256,
          'soulxCertificationLedgerSha256',promotion.soulx_qualification_sha256,
          'v209AcceptanceSha256',v209.result_sha256,
          'v210AcceptanceSha256',v210_result.evidence_sha256,
          'v211AcceptanceSha256',v211_result.evidence_sha256,
          'v212AcceptanceSha256',v212_result.evidence_sha256,
          'productionUrlSha256',activation.readback_document->>'productionUrlSha256',
          'contractBundleSha256',descriptor.descriptor_document->>'contractBundleSha256')));
      fact:=public.videoforge_v213_release_gate_fact_document('release_identity_current',
        identity_sha,activation.observed_at,jsonb_build_object('sourceCurrent',true,
          'deploymentCurrent',true,'contractsCurrent',true,'laneIdentitiesCurrent',true,
          'productionUrlVerified',true));
      PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
        'fullLiveAuthorityId',full_authority,'gate','release_identity_current',
        'sourceOperationId','guarded-activation',
        'sourceRefs',jsonb_build_object('sourceEvidenceSha256',identity_sha),'fact',fact));
    END IF;
  ELSIF completed_operation='v2-13-final-two-lane-smoke' THEN
    SELECT result.*,acceptance.checkpoint INTO v213_result
      FROM public.hosted_full_live_acceptance_results result
      JOIN public.hosted_full_live_acceptance_claims claim ON claim.id=result.claim_id
      JOIN public.hosted_full_live_acceptance_authorities acceptance
        ON acceptance.id=claim.acceptance_authority_id
     WHERE acceptance.full_live_authority_id=full_authority AND acceptance.checkpoint='V2-13';
    IF v213_result.state IS DISTINCT FROM 'COMPLETED'
       OR v213_result.result_document#>>'{receipt,mageDispatchCount}' IS DISTINCT FROM '1'
       OR v213_result.result_document#>>'{receipt,soulxDispatchCount}' IS DISTINCT FROM '1'
       OR v213_result.result_document#>>'{receipt,billingSettled}' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'V213 smoke release facts unavailable' USING ERRCODE='42501';
    END IF;
    fact:=public.videoforge_v213_release_gate_fact_document('fresh_bounded_two_lane_smoke',
      completed_sha,(smoke.document->>'smokeTerminalAt')::timestamptz,
      jsonb_build_object('mageDispatchCount',1,'soulxDispatchCount',1,
        'maximumSpendMicroUsd',v213_result.result_document#>'{receipt,phaseCapMicroUsd}',
        'mageReadbackPassed',true,'soulxReadbackPassed',true));
    PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
      'fullLiveAuthorityId',full_authority,'gate','fresh_bounded_two_lane_smoke',
      'sourceOperationId',completed_operation,
      'sourceRefs',jsonb_build_object('sourceEvidenceSha256',completed_sha),'fact',fact));
  ELSIF completed_operation='restore-endpoints-max-one' THEN
    IF operation_receipt.receipt_document#>>'{summary,rollbackIdentityPinned}' IS DISTINCT FROM 'true'
       OR operation_receipt.receipt_document#>>'{summary,rollbackReadbackPassed}' IS DISTINCT FROM 'true'
       OR operation_receipt.receipt_document#>>'{summary,releaseCurrentRestored}' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'V213 rollback release facts unavailable' USING ERRCODE='42501';
    END IF;
    fact:=public.videoforge_v213_release_gate_fact_document('rollback_ready',completed_sha,
      operation_receipt.recorded_at,jsonb_build_object('rollbackIdentityPinned',true,
        'rollbackReadbackPassed',true,'releaseCurrentRestored',true));
    PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
      'fullLiveAuthorityId',full_authority,'gate','rollback_ready',
      'sourceOperationId',completed_operation,
      'sourceRefs',jsonb_build_object('sourceEvidenceSha256',completed_sha),'fact',fact));
  ELSIF completed_operation='prove-zero-workers' THEN
    IF operation_receipt.receipt_document#>>'{summary,zeroWorkers}' IS DISTINCT FROM 'true'
       OR jsonb_array_length(operation_receipt.receipt_document#>'{summary,reads}')<>3
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(
         operation_receipt.receipt_document#>'{summary,reads}') readback
         WHERE readback->>'runningPods' IS DISTINCT FROM '0'
            OR readback->>'activeWorkers' IS DISTINCT FROM '0'
            OR readback->>'queuedJobs' IS DISTINCT FROM '0') THEN
      RAISE EXCEPTION 'V213 zero-drain release facts unavailable' USING ERRCODE='42501';
    END IF;
    fact:=public.videoforge_v213_release_gate_fact_document('independent_zero_drain',completed_sha,
      operation_receipt.recorded_at,jsonb_build_object('endpointJobs',0,'mageWorkers',0,
        'soulxWorkers',0,'unknownLiabilities',0));
    PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
      'fullLiveAuthorityId',full_authority,'gate','independent_zero_drain',
      'sourceOperationId',completed_operation,
      'sourceRefs',jsonb_build_object('sourceEvidenceSha256',completed_sha),'fact',fact));
  ELSIF completed_operation='read-settled-billing' THEN
    SELECT count(*) INTO unsettled_count FROM public.serverless_cost_events event
     JOIN public.serverless_attempts attempt ON attempt.id=event.attempt_id
     JOIN public.hosted_full_live_materialization_facts materialized
       ON materialized.facts_document#>>'{roleScopedIdentities,primary,accountId}'=attempt.account_id::text
     JOIN public.hosted_full_live_materialization_challenges challenge
       ON challenge.id=materialized.challenge_id
     WHERE challenge.full_live_authority_id=full_authority AND event.kind<>'SETTLED';
    SELECT coalesce(round(sum((ledger.settled_usd+ledger.possible_duplicate_usd)*1000000)),0),
      coalesce(round(sum(ledger.possible_duplicate_usd*1000000)),0)
      INTO total_variable_micro_usd,possible_duplicate_micro_usd
      FROM public.serverless_cost_ledgers ledger
      JOIN public.serverless_attempts attempt ON attempt.id=ledger.attempt_id
      JOIN public.hosted_full_live_materialization_facts materialized
        ON materialized.facts_document#>>'{roleScopedIdentities,primary,accountId}'=attempt.account_id::text
      JOIN public.hosted_full_live_materialization_challenges challenge
        ON challenge.id=materialized.challenge_id
     WHERE challenge.full_live_authority_id=full_authority;
    IF operation_receipt.receipt_document#>>'{summary,billingStable}' IS DISTINCT FROM 'true'
       OR operation_receipt.receipt_document#>>'{summary,withinCumulativeCap}' IS DISTINCT FROM 'true'
       OR unsettled_count<>0 OR NOT authority.retention_separately_approved THEN
      RAISE EXCEPTION 'V213 billing release facts unavailable' USING ERRCODE='42501';
    END IF;
    fact:=public.videoforge_v213_release_gate_fact_document('settled_billing',completed_sha,
      operation_receipt.recorded_at,jsonb_build_object('billingSettled',true,'unsettledItems',0,
        'totalVariableCostMicroUsd',total_variable_micro_usd,
        'possibleDuplicateCostMicroUsd',possible_duplicate_micro_usd,
        'recurringChargesDisclosed',true));
    PERFORM public.videoforge_record_v213_release_gate_fact(jsonb_build_object(
      'fullLiveAuthorityId',full_authority,'gate','settled_billing',
      'sourceOperationId',completed_operation,
      'sourceRefs',jsonb_build_object('sourceEvidenceSha256',completed_sha),'fact',fact));
  END IF;
  SELECT release_identity_sha256 INTO identity_sha
    FROM public.hosted_full_live_release_identity_facts WHERE full_live_authority_id=full_authority;
  SELECT coalesce(jsonb_object_agg(gate,fact_sha256 ORDER BY gate),'{}'::jsonb)
    INTO gate_hashes FROM public.hosted_full_live_release_gate_facts
   WHERE full_live_authority_id=full_authority;
  base:=jsonb_build_object('schemaVersion','videoforge.v213-release-fact-materialization/v1',
    'fullLiveAuthorityId',full_authority,'completedOperationId',completed_operation,
    'completedEvidenceSha256',completed_sha,'releaseIdentitySha256',identity_sha,
    'gateFactSha256s',gate_hashes);
  materialization_hash:=public.videoforge_v213_jit_sha256(base);
  base:=base||jsonb_build_object('materializationSha256',materialization_hash);
  SELECT * INTO existing FROM public.hosted_full_live_release_fact_materializations row
   WHERE row.full_live_authority_id=full_authority
     AND row.completed_operation_id=completed_operation;
  IF existing.completed_operation_id IS NOT NULL THEN
    IF existing.completed_evidence_sha256 IS DISTINCT FROM completed_sha
       OR existing.materialization_sha256 IS DISTINCT FROM materialization_hash
       OR existing.materialization_document IS DISTINCT FROM base THEN
      RAISE EXCEPTION 'V213 release fact materialization replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.materialization_document;
  END IF;
  INSERT INTO public.hosted_full_live_release_fact_materializations(full_live_authority_id,
    completed_operation_id,completed_evidence_sha256,materialization_sha256,materialization_document)
  VALUES(full_authority,completed_operation,completed_sha,materialization_hash,base);
  RETURN base;
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_release_fact_materialization(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE existing public.hosted_full_live_release_fact_materializations%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['completedEvidenceSha256','completedOperationId',
         'fullLiveAuthorityId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'completedEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 release fact materialization read invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_release_fact_materializations row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.completed_operation_id=supplied->>'completedOperationId'
     AND row.completed_evidence_sha256=supplied->>'completedEvidenceSha256';
  IF existing.completed_operation_id IS NULL THEN
    RAISE EXCEPTION 'V213 release fact materialization unavailable' USING ERRCODE='42501';
  END IF;
  RETURN existing.materialization_document;
END;
$$;

CREATE FUNCTION public.videoforge_project_v213_release_chrome(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; smoke public.hosted_full_live_signed_evidence%ROWTYPE;
  identity public.hosted_full_live_release_identity_facts%ROWTYPE;
  child public.hosted_full_live_jit_operation_authorities%ROWTYPE;
  input jsonb; base jsonb; smoke_terminal timestamptz;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['fullLiveAuthorityId','outerStateSha256','smokeEvidenceSha256']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'smokeEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 release Chrome projection invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO smoke FROM public.hosted_full_live_signed_evidence e
   WHERE e.artifact_sha256=supplied->>'smokeEvidenceSha256' AND e.kind='RELEASE';
  SELECT * INTO identity FROM public.hosted_full_live_release_identity_facts row
   WHERE row.full_live_authority_id=full_authority;
  SELECT * INTO child FROM public.hosted_full_live_jit_operation_authorities row
   WHERE row.full_live_authority_id=full_authority
     AND row.operation_id='v2-13-final-two-lane-smoke'
     AND row.outer_state_sha256=supplied->>'outerStateSha256';
  BEGIN smoke_terminal:=(smoke.document->>'smokeTerminalAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'V213 release Chrome smoke time invalid' USING ERRCODE='42501';
  END;
  IF smoke.artifact_sha256 IS NULL OR identity.full_live_authority_id IS NULL
     OR child.operation_id IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=full_authority AND authority.expires_at>transaction_timestamp())
     OR smoke.document->>'schemaVersion' IS DISTINCT FROM
        'videoforge.v213-fresh-two-lane-smoke-result/v1'
     OR smoke.document->'smokeOnly' IS DISTINCT FROM 'true'::jsonb
     OR smoke.document->'releaseCertified' IS DISTINCT FROM 'false'::jsonb
     OR smoke.document->'twoLaneSmoke' IS DISTINCT FROM 'true'::jsonb
     OR smoke.document->>'fullLiveAuthorityId' IS DISTINCT FROM full_authority::text
     OR coalesce(smoke.document->>'outputSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR coalesce(smoke.document->>'finalOutputReceiptSha256','') !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(smoke.document->'scope') IS DISTINCT FROM 'object'
     OR smoke_terminal IS NULL
     OR smoke_terminal>transaction_timestamp()
     OR smoke_terminal<transaction_timestamp()-interval '15 minutes' THEN
    RAISE EXCEPTION 'V213 release Chrome smoke or identity unavailable' USING ERRCODE='42501';
  END IF;
  input:=jsonb_build_object('fullLiveAuthorityId',full_authority,
    'smokeEvidenceSha256',smoke.artifact_sha256,
    'releaseIdentitySha256',identity.release_identity_sha256,
    'productionUrlSha256',identity.facts_document->>'productionUrlSha256',
    'accountId',smoke.document#>>'{scope,accountId}',
    'workspaceId',smoke.document#>>'{scope,workspaceId}',
    'projectId',smoke.document#>>'{scope,projectId}',
    'projectRevisionId',smoke.document#>>'{scope,projectRevisionId}',
    'outputSha256',smoke.document->>'outputSha256',
    'finalOutputReceiptSha256',smoke.document->'finalOutputReceiptSha256',
    'attemptId',smoke.document->'scope'->'attemptId',
    'smokeTerminalAt',public.videoforge_v213_jit_iso(smoke_terminal),
    'deadlineAt',public.videoforge_v213_jit_iso(smoke_terminal+interval '15 minutes'));
  IF EXISTS(SELECT 1 FROM jsonb_each_text(input-'finalOutputReceiptSha256'-'attemptId') item
       WHERE item.value IS NULL OR item.value='') THEN
    RAISE EXCEPTION 'V213 release Chrome projected scope incomplete' USING ERRCODE='42501';
  END IF;
  base:=jsonb_build_object('schemaVersion','videoforge.v213-release-chrome-projection/v1',
    'fullLiveAuthorityId',full_authority,'smokeEvidenceSha256',smoke.artifact_sha256,
    'outerStateSha256',child.outer_state_sha256,'requestInput',input);
  RETURN base||jsonb_build_object('projectionSha256',public.videoforge_v213_jit_sha256(base));
END;
$$;

CREATE FUNCTION public.videoforge_persist_v213_release_chrome(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE projection jsonb; request_input jsonb; unsigned_request jsonb; expected_request text;
  expected_artifact text; chrome public.hosted_full_live_signed_evidence%ROWTYPE;
  existing public.hosted_full_live_release_chrome_associations%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['chromeArtifactSha256','fullLiveAuthorityId','outerStateSha256',
         'projectionSha256','requestSha256','smokeEvidenceSha256']::text[] THEN
    RAISE EXCEPTION 'V213 release Chrome association invalid' USING ERRCODE='23514';
  END IF;
  projection:=public.videoforge_project_v213_release_chrome(
    supplied-'chromeArtifactSha256'-'projectionSha256'-'requestSha256');
  request_input:=projection->'requestInput';
  unsigned_request:=jsonb_build_object('schemaVersion',
    'videoforge.v2-13-release-real-chrome-request/v1')||request_input;
  expected_request:=public.videoforge_v213_jit_sha256(unsigned_request);
  expected_artifact:=public.videoforge_v213_jit_sha256(jsonb_build_object(
    'schemaVersion','videoforge.v2-13-release-real-chrome-artifact-identity/v1',
    'fullLiveAuthorityId',request_input->'fullLiveAuthorityId',
    'smokeEvidenceSha256',request_input->'smokeEvidenceSha256',
    'releaseIdentitySha256',request_input->'releaseIdentitySha256',
    'productionUrlSha256',request_input->'productionUrlSha256',
    'accountId',request_input->'accountId','workspaceId',request_input->'workspaceId',
    'projectId',request_input->'projectId','projectRevisionId',request_input->'projectRevisionId',
    'outputSha256',request_input->'outputSha256',
    'finalOutputReceiptSha256',request_input->'finalOutputReceiptSha256',
    'attemptId',request_input->'attemptId'));
  SELECT * INTO chrome FROM public.hosted_full_live_signed_evidence e
   WHERE e.artifact_sha256=supplied->>'chromeArtifactSha256' AND e.kind='CHROME';
  IF supplied->>'projectionSha256'<>projection->>'projectionSha256'
     OR supplied->>'requestSha256'<>expected_request
     OR supplied->>'chromeArtifactSha256'<>expected_artifact
     OR chrome.artifact_sha256 IS NULL
     OR chrome.document->>'schemaVersion' IS DISTINCT FROM
        'videoforge.v2-13-release-real-chrome-acceptance/v1'
     OR chrome.document->'accepted' IS DISTINCT FROM 'true'::jsonb
     OR chrome.document->'signatureVerified' IS DISTINCT FROM 'true'::jsonb
     OR chrome.document->>'releaseIdentitySha256' IS DISTINCT FROM
        request_input->>'releaseIdentitySha256'
     OR chrome.document->>'productionUrlSha256' IS DISTINCT FROM
        request_input->>'productionUrlSha256'
     OR chrome.document->>'accountId' IS DISTINCT FROM request_input->>'accountId'
     OR chrome.document->>'workspaceId' IS DISTINCT FROM request_input->>'workspaceId'
     OR chrome.document->>'projectId' IS DISTINCT FROM request_input->>'projectId'
     OR chrome.document->>'projectRevisionId' IS DISTINCT FROM
        request_input->>'projectRevisionId'
     OR chrome.document->>'outputSha256' IS DISTINCT FROM request_input->>'outputSha256'
     OR chrome.document->>'browser' IS DISTINCT FROM 'GOOGLE_CHROME'
     OR chrome.document->'fixtureOrFakeTransportUsed' IS DISTINCT FROM 'false'::jsonb
     OR chrome.document->'playbackPassed' IS DISTINCT FROM 'true'::jsonb
     OR chrome.document->'privateReadbackPassed' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'V213 release Chrome artifact drift' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_release_chrome_associations row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.smoke_evidence_sha256=supplied->>'smokeEvidenceSha256';
  IF existing.full_live_authority_id IS NOT NULL THEN
    IF existing.outer_state_sha256<>supplied->>'outerStateSha256'
       OR existing.request_sha256<>expected_request
       OR existing.projection_sha256<>supplied->>'projectionSha256'
       OR existing.chrome_artifact_sha256<>supplied->>'chromeArtifactSha256' THEN
      RAISE EXCEPTION 'V213 release Chrome replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.chrome_artifact_sha256;
  END IF;
  INSERT INTO public.hosted_full_live_release_chrome_associations(full_live_authority_id,
    smoke_evidence_sha256,outer_state_sha256,request_sha256,projection_sha256,
    chrome_artifact_sha256)
  VALUES((supplied->>'fullLiveAuthorityId')::uuid,supplied->>'smokeEvidenceSha256',
    supplied->>'outerStateSha256',expected_request,supplied->>'projectionSha256',
    supplied->>'chromeArtifactSha256');
  RETURN supplied->>'chromeArtifactSha256';
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_release_chrome(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE existing public.hosted_full_live_release_chrome_associations%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['chromeArtifactSha256','fullLiveAuthorityId','outerStateSha256',
         'projectionSha256','requestSha256','smokeEvidenceSha256']::text[] THEN
    RAISE EXCEPTION 'V213 release Chrome read invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_release_chrome_associations row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.smoke_evidence_sha256=supplied->>'smokeEvidenceSha256'
     AND row.outer_state_sha256=supplied->>'outerStateSha256'
     AND row.request_sha256=supplied->>'requestSha256'
     AND row.projection_sha256=supplied->>'projectionSha256'
     AND row.chrome_artifact_sha256=supplied->>'chromeArtifactSha256';
  IF existing.full_live_authority_id IS NULL THEN
    RAISE EXCEPTION 'V213 release Chrome read unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('chromeArtifactSha256',existing.chrome_artifact_sha256,
    'requestSha256',existing.request_sha256,
    'smokeEvidenceSha256',existing.smoke_evidence_sha256);
END;
$$;

CREATE FUNCTION public.videoforge_project_v213_release_certification(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; predecessors jsonb:=supplied->'predecessorEvidenceSha256s';
  authority public.hosted_full_live_authorities%ROWTYPE;
  identity public.hosted_full_live_release_identity_facts%ROWTYPE;
  smoke public.hosted_full_live_signed_evidence%ROWTYPE;
  chrome public.hosted_full_live_release_chrome_associations%ROWTYPE;
  gate_count integer; gate_facts jsonb; base jsonb; scope jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['certificationIdentitySha256','fullLiveAuthorityId','outerStateSha256',
         'predecessorEvidenceSha256s','workId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'certificationIdentitySha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'workId'<>
        (supplied->>'fullLiveAuthorityId')||':certify-v2-13-release'
     OR jsonb_typeof(predecessors)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(predecessors) key)
       IS DISTINCT FROM ARRAY['prove-zero-workers','read-settled-billing',
         'reconcile-exact-resources','restore-endpoints-max-one',
         'v2-13-final-two-lane-smoke']::text[]
     OR EXISTS(SELECT 1 FROM jsonb_each_text(predecessors) item
       WHERE item.value !~ '^sha256:[0-9a-f]{64}$')
     OR public.videoforge_v213_jit_sha256(supplied-'certificationIdentitySha256')<>
        supplied->>'certificationIdentitySha256' THEN
    RAISE EXCEPTION 'V213 release certification projection invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=full_authority;
  IF authority.id IS NULL OR authority.expires_at<=transaction_timestamp()
     OR NOT EXISTS(SELECT 1
       FROM public.hosted_full_live_materialization_facts facts
       JOIN public.hosted_full_live_materialization_challenges challenge
         ON challenge.id=facts.challenge_id
       WHERE challenge.full_live_authority_id=full_authority
         AND challenge.challenge_document->>'outerStateSha256'=
             supplied->>'outerStateSha256') THEN
    RAISE EXCEPTION 'V213 release certification outer authority unavailable'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO identity FROM public.hosted_full_live_release_identity_facts row
   WHERE row.full_live_authority_id=full_authority;
  SELECT * INTO smoke FROM public.hosted_full_live_signed_evidence e
   WHERE e.artifact_sha256=predecessors->>'v2-13-final-two-lane-smoke'
     AND e.kind='RELEASE';
  SELECT * INTO chrome FROM public.hosted_full_live_release_chrome_associations row
   WHERE row.full_live_authority_id=full_authority
     AND row.smoke_evidence_sha256=smoke.artifact_sha256;
  SELECT count(*),jsonb_object_agg(row.gate,row.fact_document ORDER BY row.gate)
    INTO gate_count,gate_facts FROM public.hosted_full_live_release_gate_facts row
   WHERE row.full_live_authority_id=full_authority;
  IF identity.full_live_authority_id IS NULL
     OR smoke.artifact_sha256 IS NULL OR chrome.full_live_authority_id IS NULL
     OR smoke.document->>'schemaVersion' IS DISTINCT FROM
        'videoforge.v213-fresh-two-lane-smoke-result/v1'
     OR smoke.document->>'fullLiveAuthorityId' IS DISTINCT FROM full_authority::text
     OR gate_count<>15
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts receipt
       WHERE receipt.full_live_authority_id=full_authority
         AND receipt.operation_id='restore-endpoints-max-one'
         AND receipt.artifact_sha256=predecessors->>'restore-endpoints-max-one')
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts receipt
       WHERE receipt.full_live_authority_id=full_authority
         AND receipt.operation_id='prove-zero-workers'
         AND receipt.artifact_sha256=predecessors->>'prove-zero-workers')
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts receipt
       WHERE receipt.full_live_authority_id=full_authority
         AND receipt.operation_id='read-settled-billing'
         AND receipt.artifact_sha256=predecessors->>'read-settled-billing')
     OR NOT EXISTS(SELECT 1 FROM public.hosted_full_live_operation_receipts receipt
       WHERE receipt.full_live_authority_id=full_authority
         AND receipt.operation_id='reconcile-exact-resources'
         AND receipt.artifact_sha256=predecessors->>'reconcile-exact-resources')
     OR EXISTS(SELECT 1 FROM jsonb_each(gate_facts) item
       WHERE item.value->>'gate' IS DISTINCT FROM item.key
          OR coalesce(item.value->>'sourceEvidenceSha256','') !~
             '^sha256:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'V213 release certification current-run facts unavailable' USING ERRCODE='42501';
  END IF;
  scope:=jsonb_build_object('accountId',smoke.document#>>'{scope,accountId}',
    'workspaceId',smoke.document#>>'{scope,workspaceId}',
    'projectId',smoke.document#>>'{scope,projectId}',
    'projectRevisionId',smoke.document#>>'{scope,projectRevisionId}',
    'requestSha256',chrome.request_sha256,
    'attemptId',smoke.document#>>'{scope,attemptId}');
  IF EXISTS(SELECT 1 FROM jsonb_each_text(scope) item WHERE item.value IS NULL OR item.value='') THEN
    RAISE EXCEPTION 'V213 release certification scope unavailable' USING ERRCODE='42501';
  END IF;
  base:=jsonb_build_object(
    'schemaVersion','videoforge.v213-final-release-certification-projection/v2',
    'fullLiveAuthorityId',full_authority,'workId',supplied->>'workId',
    'outerStateSha256',supplied->>'outerStateSha256',
    'certificationIdentitySha256',supplied->>'certificationIdentitySha256',
    'sourceCommit',authority.source_commit,'predecessorEvidenceSha256s',predecessors,
    'releaseIdentityFacts',identity.facts_document,
    'releaseIdentitySha256',identity.release_identity_sha256,'scope',scope,
    'gateFacts',gate_facts,
    'chromeArtifact',jsonb_build_object('rawEvidence',jsonb_build_object(
      'artifactSha256',chrome.chrome_artifact_sha256)));
  RETURN base||jsonb_build_object('projectionSha256',public.videoforge_v213_jit_sha256(base));
END;
$$;

CREATE FUNCTION public.videoforge_persist_v213_release_certification(supplied jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE projection jsonb; result jsonb:=supplied->'result'; base_input jsonb;
  existing public.hosted_full_live_release_certifications%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['certificationIdentitySha256','fullLiveAuthorityId','outerStateSha256',
         'predecessorEvidenceSha256s','projectionSha256','result','resultSha256','workId']::text[]
     OR jsonb_typeof(result)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(result) key)
       IS DISTINCT FROM ARRAY['actualUsd','certified','currentRunEvidence','evidenceSha256',
         'externalSpendUsd','gateCount','gpuUse','invalidGateCount','ledgerSha256',
         'liveReleaseAuthorized','missingGateCount','predecessorEvidenceSha256s',
         'providerMutationPerformed','releaseIdentitySha256','releaseStatus',
         'requiresExplicitReleaseAuthority','schemaVersion']::text[] THEN
    RAISE EXCEPTION 'V213 release certification persistence invalid' USING ERRCODE='23514';
  END IF;
  base_input:=supplied-'projectionSha256'-'resultSha256'-'result';
  projection:=public.videoforge_project_v213_release_certification(base_input);
  IF supplied->>'projectionSha256'<>projection->>'projectionSha256'
     OR supplied->>'resultSha256'<>public.videoforge_v213_jit_sha256(result)
     OR result->>'schemaVersion'<>'videoforge.v213-final-release-certification-result/v1'
     OR result->'actualUsd'<>'0'::jsonb OR result->'externalSpendUsd'<>'0'::jsonb
     OR result->'gpuUse'<>'false'::jsonb OR result->'providerMutationPerformed'<>'false'::jsonb
     OR result->'currentRunEvidence'<>'true'::jsonb OR result->'certified'<>'true'::jsonb
     OR result->>'releaseStatus'<>'release_certified' OR result->'gateCount'<>'15'::jsonb
     OR result->'missingGateCount'<>'0'::jsonb OR result->'invalidGateCount'<>'0'::jsonb
     OR result->'liveReleaseAuthorized'<>'false'::jsonb
     OR result->'requiresExplicitReleaseAuthority'<>'true'::jsonb
     OR result->>'releaseIdentitySha256'<>projection->>'releaseIdentitySha256'
     OR result->>'ledgerSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR result->>'evidenceSha256'<>result->>'ledgerSha256'
     OR result->'predecessorEvidenceSha256s' IS DISTINCT FROM
        projection->'predecessorEvidenceSha256s' THEN
    RAISE EXCEPTION 'V213 release certification result drift' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_release_certifications row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.work_id=supplied->>'workId';
  IF existing.full_live_authority_id IS NOT NULL THEN
    IF existing.outer_state_sha256<>supplied->>'outerStateSha256'
       OR existing.certification_identity_sha256<>supplied->>'certificationIdentitySha256'
       OR existing.predecessor_evidence_sha256s IS DISTINCT FROM supplied->'predecessorEvidenceSha256s'
       OR existing.projection_sha256<>supplied->>'projectionSha256'
       OR existing.result_sha256<>supplied->>'resultSha256'
       OR existing.result_document IS DISTINCT FROM result THEN
      RAISE EXCEPTION 'V213 release certification replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.result_document->>'ledgerSha256';
  END IF;
  INSERT INTO public.hosted_full_live_release_certifications(full_live_authority_id,work_id,
    outer_state_sha256,certification_identity_sha256,predecessor_evidence_sha256s,
    projection_sha256,result_sha256,result_document)
  VALUES((supplied->>'fullLiveAuthorityId')::uuid,supplied->>'workId',
    supplied->>'outerStateSha256',supplied->>'certificationIdentitySha256',
    supplied->'predecessorEvidenceSha256s',supplied->>'projectionSha256',
    supplied->>'resultSha256',result);
  RETURN result->>'ledgerSha256';
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_release_certification(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE existing public.hosted_full_live_release_certifications%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['certificationIdentitySha256','fullLiveAuthorityId','outerStateSha256',
         'predecessorEvidenceSha256s','workId']::text[] THEN
    RAISE EXCEPTION 'V213 release certification read invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_release_certifications row
   WHERE row.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
     AND row.work_id=supplied->>'workId'
     AND row.outer_state_sha256=supplied->>'outerStateSha256'
     AND row.certification_identity_sha256=supplied->>'certificationIdentitySha256'
     AND row.predecessor_evidence_sha256s IS NOT DISTINCT FROM
        supplied->'predecessorEvidenceSha256s';
  IF existing.full_live_authority_id IS NULL THEN
    RAISE EXCEPTION 'V213 release certification read unavailable' USING ERRCODE='42501';
  END IF;
  RETURN existing.result_document;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_record_v213_release_identity_facts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_release_gate_fact(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_v213_release_gate_fact_document(text,text,timestamptz,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_v213_release_facts(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_release_fact_materialization(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_project_v213_release_chrome(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_persist_v213_release_chrome(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_release_chrome(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_project_v213_release_certification(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_persist_v213_release_certification(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_release_certification(jsonb) FROM PUBLIC;

-- Mage/SoulX case bodies are materialized only after the exact stage authority is consumed.
-- Long-lived R2/signing credentials never enter these tables. The short-lived worker request is
-- encrypted for lost-response reconciliation and is immutable once persisted.
CREATE TABLE public.hosted_full_live_qualification_materialization_intents (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN ('mage-live-qualification','soulx-live-qualification')),
  case_id text NOT NULL CHECK(case_id IN ('mage-cold-representative','soulx-cold-2s','soulx-warm-4s',
    'soulx-warm-6s','soulx-warm-10s','soulx-cancel','soulx-invalid-output','soulx-timeout')),
  stage_authority_id text NOT NULL REFERENCES public.hosted_full_live_stage_authorities(authority_id),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_refs_sha256 text NOT NULL CHECK(source_refs_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,case_id),
  UNIQUE(stage_authority_id,case_id),
  UNIQUE(request_sha256)
);
CREATE TABLE public.hosted_full_live_qualification_materializations (
  full_live_authority_id uuid NOT NULL,
  operation_id text NOT NULL,
  case_id text NOT NULL,
  request_sha256 text NOT NULL UNIQUE CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  materialization_evidence_sha256 text NOT NULL UNIQUE CHECK(materialization_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_sha256 text NOT NULL UNIQUE CHECK(result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id,case_id),
  FOREIGN KEY(full_live_authority_id,operation_id,case_id)
    REFERENCES public.hosted_full_live_qualification_materialization_intents(
      full_live_authority_id,operation_id,case_id)
);
CREATE TRIGGER hosted_full_live_qualification_materialization_intents_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_qualification_materialization_intents
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_qualification_materializations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_qualification_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_full_live_qualification_materialization_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_qualification_materialization_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_qualification_materializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_qualification_materializations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_full_live_qualification_materialization_intents_owner_only
  ON public.hosted_full_live_qualification_materialization_intents USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_qualification_materializations_owner_only
  ON public.hosted_full_live_qualification_materializations USING(false) WITH CHECK(false);
REVOKE ALL ON TABLE public.hosted_full_live_qualification_materialization_intents FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_qualification_materializations FROM PUBLIC;

CREATE FUNCTION public.videoforge_claim_v213_qualification_materialization(supplied jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); full_authority uuid;
  stage public.hosted_full_live_stage_authorities%ROWTYPE;
  intent public.hosted_full_live_qualification_materialization_intents%ROWTYPE;
  existing public.hosted_full_live_qualification_materializations%ROWTYPE;
  expected_hash text; refs_hash text; op text:=supplied->>'operationId';
  case_name text:=supplied->'descriptor'->>'id'; lane_name text:=supplied->'descriptor'->>'lane';
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['caseSourceRef','deployment','descriptor','fullLiveAuthorityId',
         'generatorRef','inputSha256','inputs','operationId','outerStateSha256','requestSha256',
         'schemaVersion','sourceCommit','stageAuthorityId','validatorRef']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v213-qualification-materialization-request/v1'
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR op NOT IN ('mage-live-qualification','soulx-live-qualification')
     OR supplied->>'stageAuthorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'inputSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR jsonb_typeof(supplied->'descriptor')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'descriptor') key)
       IS DISTINCT FROM ARRAY['cold','id','key','lane','mode','seconds']::text[]
     OR supplied->'descriptor'->>'key' NOT IN
       ('mage','soulx2s','soulx4s','soulx6s','soulx10s','soulxCancel','soulxInvalidOutput','soulxTimeout')
     OR supplied->'descriptor'->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR supplied->'descriptor'->>'lane' NOT IN ('mage','soulx')
     OR supplied->'descriptor'->>'mode' NOT IN ('complete','cancel','invalid','timeout')
     OR supplied->'descriptor'->'seconds' NOT IN ('0'::jsonb,'2'::jsonb,'4'::jsonb,'6'::jsonb,'10'::jsonb)
     OR jsonb_typeof(supplied->'descriptor'->'cold')<>'boolean'
     OR jsonb_typeof(supplied->'deployment')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'deployment') key)
       IS DISTINCT FROM ARRAY['deploymentSha256','endpointId','endpointIdSha256','gpu','gpuCount',
         'handlerConcurrency','image','initTimeoutSeconds','lane','purpose','region','scalerType',
         'scalerValue','sourceCommit','templateId','templateIdSha256','volumeIdSha256',
         'volumeManifestSha256','volumeMount','volumeSizeGb','workersMax','workersMin']::text[]
     OR supplied->'deployment'->>'purpose'<>'qualification'
     OR supplied->'deployment'->>'lane'<>lane_name
     OR supplied->'deployment'->>'sourceCommit'<>supplied->>'sourceCommit'
     OR supplied->'deployment'->>'region'<>'EU-RO-1'
     OR supplied->'deployment'->>'gpu'<>'NVIDIA GeForce RTX 4090'
     OR supplied->'deployment'->'gpuCount'<>'1'::jsonb
     OR supplied->'deployment'->'handlerConcurrency'<>'1'::jsonb
     OR supplied->'deployment'->>'scalerType'<>'REQUEST_COUNT'
     OR supplied->'deployment'->'scalerValue'<>'1'::jsonb
     OR supplied->'deployment'->'workersMin'<>'0'::jsonb
     OR supplied->'deployment'->'workersMax'<>'1'::jsonb
     OR supplied->'deployment'->>'volumeMount'<>'/runpod-volume'
     OR supplied->'deployment'->'volumeSizeGb'<>'50'::jsonb
     OR supplied->'deployment'->>'endpointId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR supplied->'deployment'->>'templateId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR supplied->'deployment'->>'endpointIdSha256'<>
       'sha256:'||encode(sha256(convert_to(supplied->'deployment'->>'endpointId','UTF8')),'hex')
     OR supplied->'deployment'->>'templateIdSha256'<>
       'sha256:'||encode(sha256(convert_to(supplied->'deployment'->>'templateId','UTF8')),'hex')
     OR supplied->'deployment'->>'deploymentSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->'deployment'->>'volumeIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->'deployment'->>'volumeManifestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->'deployment'->>'image' !~ '^.+@sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'inputs')<>'array'
     OR (op='mage-live-qualification' AND jsonb_array_length(supplied->'inputs')<>0)
     OR (op='soulx-live-qualification' AND jsonb_array_length(supplied->'inputs')<>2)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(supplied->'inputs') input
       WHERE jsonb_typeof(input)<>'object'
          OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(input) key)
             IS DISTINCT FROM ARRAY['assetId','bodyBase64','contentType','reservationId','role','sha256']::text[]
          OR input->>'role' NOT IN ('avatar_source','audio')
          OR input->>'assetId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
          OR input->>'reservationId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
          OR input->>'contentType' NOT IN ('image/png','audio/wav')
          OR input->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
          OR input->>'bodyBase64' !~ '^[A-Za-z0-9+/]+={0,2}$'
          OR (input->>'role'='avatar_source' AND input->>'contentType'<>'image/png')
          OR (input->>'role'='audio' AND input->>'contentType'<>'audio/wav'))
     OR (op='soulx-live-qualification' AND
       ((supplied->'inputs'->0->>'role')<>'avatar_source' OR
        (supplied->'inputs'->1->>'role')<>'audio'))
     OR jsonb_typeof(supplied->'caseSourceRef')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'caseSourceRef') key)
       IS DISTINCT FROM ARRAY['path','sha256']::text[]
     OR supplied->'caseSourceRef'->>'path'<>'apps/web/src/server/providers/v213-dual-lane-live.ts'
     OR supplied->'caseSourceRef'->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'generatorRef')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'generatorRef') key)
       IS DISTINCT FROM ARRAY['path','sha256']::text[]
     OR supplied->'generatorRef'->>'path'<>(CASE WHEN lane_name='mage'
       THEN 'deploy/v2-13/generate-mage-qualification-case.mjs'
       ELSE 'deploy/v2-13/generate-soulx-qualification-cases.mjs' END)
     OR supplied->'generatorRef'->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'validatorRef')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'validatorRef') key)
       IS DISTINCT FROM ARRAY['path','sha256']::text[]
     OR supplied->'validatorRef'->>'path'<>(CASE WHEN lane_name='mage'
       THEN 'workers/image-media/src/videoforge_image_media/mage_production.py'
       ELSE 'workers/avatar-primary/soulx_serverless.py' END)
     OR supplied->'validatorRef'->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (op='mage-live-qualification' AND (lane_name<>'mage' OR case_name<>'mage-cold-representative'))
     OR (op='soulx-live-qualification' AND (lane_name<>'soulx' OR case_name NOT IN
       ('soulx-cold-2s','soulx-warm-4s','soulx-warm-6s','soulx-warm-10s',
        'soulx-cancel','soulx-invalid-output','soulx-timeout')))
     OR NOT (
       supplied->'descriptor'=jsonb_build_object('key','mage','lane','mage','id','mage-cold-representative',
         'seconds',0,'mode','complete','cold',true)
       OR supplied->'descriptor'=jsonb_build_object('key','soulx2s','lane','soulx','id','soulx-cold-2s',
         'seconds',2,'mode','complete','cold',true)
       OR supplied->'descriptor'=jsonb_build_object('key','soulx4s','lane','soulx','id','soulx-warm-4s',
         'seconds',4,'mode','complete','cold',false)
       OR supplied->'descriptor'=jsonb_build_object('key','soulx6s','lane','soulx','id','soulx-warm-6s',
         'seconds',6,'mode','complete','cold',false)
       OR supplied->'descriptor'=jsonb_build_object('key','soulx10s','lane','soulx','id','soulx-warm-10s',
         'seconds',10,'mode','complete','cold',false)
       OR supplied->'descriptor'=jsonb_build_object('key','soulxCancel','lane','soulx','id','soulx-cancel',
         'seconds',2,'mode','cancel','cold',false)
       OR supplied->'descriptor'=jsonb_build_object('key','soulxInvalidOutput','lane','soulx',
         'id','soulx-invalid-output','seconds',2,'mode','invalid','cold',false)
       OR supplied->'descriptor'=jsonb_build_object('key','soulxTimeout','lane','soulx','id','soulx-timeout',
         'seconds',2,'mode','timeout','cold',false)
     ) THEN
    RAISE EXCEPTION 'V213 qualification materialization claim invalid' USING ERRCODE='23514';
  END IF;
  expected_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    supplied-'requestSha256'),'UTF8')),'hex');
  refs_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(jsonb_build_object(
    'caseSourceRef',supplied->'caseSourceRef','generatorRef',supplied->'generatorRef',
    'validatorRef',supplied->'validatorRef')),'UTF8')),'hex');
  IF expected_hash<>supplied->>'requestSha256' THEN
    RAISE EXCEPTION 'V213 qualification materialization request hash drift' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  -- Serialize the exact authority/operation/case tuple as well as the request hash.  A hostile
  -- retry must not race a different request body into the unique tuple after the stage was
  -- consumed.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    full_authority::text||':'||op||':'||case_name,213));
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'requestSha256',213));
  SELECT * INTO intent FROM public.hosted_full_live_qualification_materialization_intents i
    WHERE i.full_live_authority_id=full_authority AND i.operation_id=op AND i.case_id=case_name
    FOR UPDATE;
  IF intent.full_live_authority_id IS NOT NULL THEN
    IF intent.stage_authority_id<>supplied->>'stageAuthorityId'
       OR intent.outer_state_sha256<>supplied->>'outerStateSha256'
       OR intent.input_sha256<>supplied->>'inputSha256'
       OR intent.request_sha256<>supplied->>'requestSha256'
       OR intent.source_refs_sha256<>refs_hash THEN
      RAISE EXCEPTION 'V213 qualification materialization replay drift' USING ERRCODE='23505';
    END IF;
    SELECT * INTO existing FROM public.hosted_full_live_qualification_materializations m
      WHERE m.full_live_authority_id=full_authority AND m.operation_id=op AND m.case_id=case_name;
    IF existing.full_live_authority_id IS NOT NULL THEN
      RETURN 'EXISTING';
    END IF;
  END IF;
  SELECT s.* INTO stage FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    JOIN public.hosted_full_live_authorities a ON a.id=s.full_live_authority_id
    WHERE s.authority_id=supplied->>'stageAuthorityId'
      AND s.full_live_authority_id=full_authority
      AND s.stage=lane_name AND s.input_sha256=supplied->>'inputSha256'
      AND s.expires_at>db_now AND a.expires_at>db_now
      AND a.source_commit=supplied->>'sourceCommit'
      AND a.authority_document->>'sourceCommit'=a.source_commit
      AND a.authority_document->>'proposalSha256'=a.proposal_sha256
      AND a.authority_document->>'executorSha256'=a.executor_sha256
      AND a.single_use
      AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p WHERE p.authority_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_stage_completions d
        WHERE d.authority_id=s.authority_id)
    FOR UPDATE OF s,c,a;
  IF stage.authority_id IS NULL THEN
    RAISE EXCEPTION 'V213 qualification materialization authority unavailable' USING ERRCODE='42501';
  END IF;
  IF intent.full_live_authority_id IS NOT NULL THEN
    RETURN 'RECONCILE';
  END IF;
  INSERT INTO public.hosted_full_live_qualification_materialization_intents(
    full_live_authority_id,operation_id,case_id,stage_authority_id,outer_state_sha256,
    input_sha256,request_sha256,source_refs_sha256)
  VALUES(full_authority,op,case_name,supplied->>'stageAuthorityId',supplied->>'outerStateSha256',
    supplied->>'inputSha256',supplied->>'requestSha256',refs_hash);
  RETURN 'EXECUTE';
END;
$$;

CREATE FUNCTION public.videoforge_persist_v213_qualification_materialization(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  request jsonb:=supplied->'request'; materialization jsonb:=supplied->'materialization';
  full_authority uuid; op text; case_name text; handoff_key text:=current_setting('videoforge.v213_handoff_key',true);
  intent public.hosted_full_live_qualification_materialization_intents%ROWTYPE;
  stage public.hosted_full_live_stage_authorities%ROWTYPE;
  existing public.hosted_full_live_qualification_materializations%ROWTYPE;
  expected_result_hash text; expected_refs_hash text; expected_request_hash text;
  expected_evidence_hash text; worker_request jsonb; descriptor_sha text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['materialization','request']::text[]
     OR jsonb_typeof(request)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(request) key)
       IS DISTINCT FROM ARRAY['caseSourceRef','deployment','descriptor','fullLiveAuthorityId',
         'generatorRef','inputSha256','inputs','operationId','outerStateSha256','requestSha256',
         'schemaVersion','sourceCommit','stageAuthorityId','validatorRef']::text[]
     OR request->>'schemaVersion'<>'videoforge.v213-qualification-materialization-request/v1'
     OR request->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR request->>'operationId' NOT IN ('mage-live-qualification','soulx-live-qualification')
     OR request->>'stageAuthorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
     OR request->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR request->>'inputSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR request->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR request->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR jsonb_typeof(request->'descriptor')<>'object'
     OR request->'descriptor'->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR request->'descriptor'->>'lane' NOT IN ('mage','soulx')
     OR request->'descriptor'->>'id' NOT IN ('mage-cold-representative','soulx-cold-2s',
       'soulx-warm-4s','soulx-warm-6s','soulx-warm-10s','soulx-cancel','soulx-invalid-output',
       'soulx-timeout')
     OR jsonb_typeof(materialization)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(materialization) key)
       IS DISTINCT FROM ARRAY['fullLiveAuthorityId','materialization','operationId','outerStateSha256',
         'requestSha256','resultSha256','schemaVersion','sourceRefsSha256','stageAuthorityId']::text[]
     OR handoff_key IS NULL OR handoff_key !~ '^(?:[0-9a-f]{2}){32,}$'
     OR materialization->>'schemaVersion'<>'videoforge.v213-qualification-materialization-result/v1'
     OR materialization->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR materialization->>'operationId' NOT IN ('mage-live-qualification','soulx-live-qualification')
     OR materialization->>'stageAuthorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
     OR materialization->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR materialization->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR materialization->>'sourceRefsSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR materialization->>'resultSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(materialization->'materialization')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(materialization->'materialization') key)
       IS DISTINCT FROM ARRAY['caseDescriptorSha256','materializationEvidenceSha256','request',
         'schemaVersion']::text[]
     OR materialization->'materialization'->>'schemaVersion'<>
       'videoforge.v213-qualification-case-materialization/v1'
     OR materialization->'materialization'->>'caseDescriptorSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR materialization->'materialization'->>'materializationEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(materialization->'materialization'->'request')<>'object' THEN
    RAISE EXCEPTION 'V213 qualification materialization persistence invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(request->>'fullLiveAuthorityId')::uuid; op:=request->>'operationId';
  case_name:=request->'descriptor'->>'id';
  expected_request_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    request-'requestSha256'),'UTF8')),'hex');
  IF expected_request_hash<>request->>'requestSha256' THEN
    RAISE EXCEPTION 'V213 qualification materialization request hash drift' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    full_authority::text||':'||op||':'||case_name,213));
  PERFORM pg_advisory_xact_lock(hashtextextended(request->>'requestSha256',213));
  SELECT * INTO intent FROM public.hosted_full_live_qualification_materialization_intents i
    WHERE i.full_live_authority_id=full_authority AND i.operation_id=op AND i.case_id=case_name
    FOR UPDATE;
  SELECT s.* INTO stage FROM public.hosted_full_live_stage_authorities s
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    JOIN public.hosted_full_live_authorities a ON a.id=s.full_live_authority_id
    WHERE s.authority_id=request->>'stageAuthorityId'
      AND s.full_live_authority_id=full_authority
      AND s.stage=request->'descriptor'->>'lane'
      AND s.input_sha256=request->>'inputSha256'
      AND s.expires_at>db_now AND a.expires_at>db_now
      AND a.source_commit=request->>'sourceCommit'
      AND a.authority_document->>'sourceCommit'=a.source_commit
      AND a.authority_document->>'proposalSha256'=a.proposal_sha256
      AND a.authority_document->>'executorSha256'=a.executor_sha256
      AND a.single_use
      AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p WHERE p.authority_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_stage_completions d
        WHERE d.authority_id=s.authority_id)
    FOR UPDATE OF s,c,a;
  expected_refs_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(jsonb_build_object(
    'caseSourceRef',request->'caseSourceRef','generatorRef',request->'generatorRef',
    'validatorRef',request->'validatorRef')),'UTF8')),'hex');
  worker_request:=materialization->'materialization'->'request';
  descriptor_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    request->'descriptor'),'UTF8')),'hex');
  expected_evidence_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    jsonb_build_object('caseDescriptorSha256',descriptor_sha,
      'deploymentSha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
        request->'deployment'),'UTF8')),'hex'),
      'requestSha256','sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
        worker_request),'UTF8')),'hex'),
      'stageAuthorityId',request->>'stageAuthorityId')),'UTF8')),'hex');
  expected_result_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    materialization-'resultSha256'),'UTF8')),'hex');
  IF intent.full_live_authority_id IS NULL
     OR stage.authority_id IS NULL
     OR intent.stage_authority_id<>request->>'stageAuthorityId'
     OR intent.outer_state_sha256<>request->>'outerStateSha256'
     OR intent.request_sha256<>request->>'requestSha256'
     OR intent.source_refs_sha256<>expected_refs_hash
     OR materialization->>'requestSha256'<>expected_request_hash
     OR materialization->>'fullLiveAuthorityId'<>full_authority::text
     OR materialization->>'operationId'<>op
     OR materialization->>'stageAuthorityId'<>intent.stage_authority_id
     OR materialization->>'outerStateSha256'<>intent.outer_state_sha256
     OR materialization->>'requestSha256'<>intent.request_sha256
     OR materialization->>'sourceRefsSha256'<>intent.source_refs_sha256
     OR materialization->'materialization'->>'caseDescriptorSha256'<>descriptor_sha
     OR materialization->'materialization'->>'materializationEvidenceSha256'<>expected_evidence_hash
     OR expected_result_hash<>materialization->>'resultSha256' THEN
    RAISE EXCEPTION 'V213 qualification materialization persistence drift' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_qualification_materializations m
    WHERE m.full_live_authority_id=full_authority AND m.operation_id=op AND m.case_id=case_name;
  IF existing.full_live_authority_id IS NOT NULL THEN
    IF existing.request_sha256<>intent.request_sha256
       OR existing.materialization_evidence_sha256<>
         materialization->'materialization'->>'materializationEvidenceSha256'
       OR existing.result_sha256<>materialization->>'resultSha256'
       OR pgp_sym_decrypt(existing.result_ciphertext,handoff_key)::jsonb<>materialization THEN
      RAISE EXCEPTION 'V213 qualification materialization result replay drift' USING ERRCODE='23505';
    END IF;
    RETURN materialization;
  END IF;
  INSERT INTO public.hosted_full_live_qualification_materializations(full_live_authority_id,
    operation_id,case_id,request_sha256,materialization_evidence_sha256,result_sha256,result_ciphertext)
  VALUES(full_authority,op,case_name,intent.request_sha256,
    materialization->'materialization'->>'materializationEvidenceSha256',
    materialization->>'resultSha256',pgp_sym_encrypt(public.videoforge_canonical_jsonb(materialization),
      handoff_key,'cipher-algo=aes256,compress-algo=0'));
  RETURN materialization;
END;
$$;

CREATE FUNCTION public.videoforge_read_v213_qualification_materialization(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  handoff_key text:=current_setting('videoforge.v213_handoff_key',true);
  intent public.hosted_full_live_qualification_materialization_intents%ROWTYPE;
  existing public.hosted_full_live_qualification_materializations%ROWTYPE;
  result jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['caseId','fullLiveAuthorityId','operationId','outerStateSha256',
         'requestSha256','stageAuthorityId']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'operationId' NOT IN ('mage-live-qualification','soulx-live-qualification')
     OR supplied->>'caseId' NOT IN ('mage-cold-representative','soulx-cold-2s','soulx-warm-4s',
       'soulx-warm-6s','soulx-warm-10s','soulx-cancel','soulx-invalid-output','soulx-timeout')
     OR supplied->>'stageAuthorityId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR handoff_key IS NULL OR handoff_key !~ '^(?:[0-9a-f]{2}){32,}$' THEN
    RAISE EXCEPTION 'V213 qualification materialization read invalid' USING ERRCODE='42501';
  END IF;
  SELECT i.* INTO intent FROM public.hosted_full_live_qualification_materialization_intents i
    JOIN public.hosted_full_live_stage_authorities s ON s.authority_id=i.stage_authority_id
    JOIN public.hosted_full_live_stage_consumptions c ON c.authority_id=s.authority_id
    JOIN public.hosted_full_live_authorities a ON a.id=i.full_live_authority_id
    WHERE i.full_live_authority_id=(supplied->>'fullLiveAuthorityId')::uuid
      AND i.operation_id=supplied->>'operationId' AND i.case_id=supplied->>'caseId'
      AND i.stage_authority_id=supplied->>'stageAuthorityId'
      AND i.outer_state_sha256=supplied->>'outerStateSha256'
      AND i.request_sha256=supplied->>'requestSha256'
      AND s.stage=(CASE WHEN supplied->>'operationId'='mage-live-qualification'
        THEN 'mage' ELSE 'soulx' END)
      AND s.expires_at>db_now AND a.expires_at>db_now
      AND a.source_commit=a.authority_document->>'sourceCommit'
      AND a.proposal_sha256=a.authority_document->>'proposalSha256'
      AND a.executor_sha256=a.authority_document->>'executorSha256'
      AND a.single_use
      AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_promotions p WHERE p.authority_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM public.hosted_full_live_stage_completions d
        WHERE d.authority_id=s.authority_id);
  IF intent.full_live_authority_id IS NULL THEN
    RAISE EXCEPTION 'V213 qualification materialization read unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_qualification_materializations m
    WHERE m.full_live_authority_id=intent.full_live_authority_id
      AND m.operation_id=intent.operation_id AND m.case_id=intent.case_id;
  IF existing.full_live_authority_id IS NULL THEN RETURN NULL; END IF;
  result:=pgp_sym_decrypt(existing.result_ciphertext,handoff_key)::jsonb;
  IF result->>'schemaVersion'<>'videoforge.v213-qualification-materialization-result/v1'
     OR result->>'fullLiveAuthorityId'<>intent.full_live_authority_id::text
     OR result->>'operationId'<>intent.operation_id
     OR result->>'stageAuthorityId'<>intent.stage_authority_id
     OR result->>'outerStateSha256'<>intent.outer_state_sha256
     OR result->>'requestSha256'<>intent.request_sha256
     OR result->>'resultSha256'<>existing.result_sha256 THEN
    RAISE EXCEPTION 'V213 qualification materialization read drift' USING ERRCODE='23505';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_claim_v213_qualification_materialization(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_persist_v213_qualification_materialization(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_read_v213_qualification_materialization(jsonb) FROM PUBLIC;
