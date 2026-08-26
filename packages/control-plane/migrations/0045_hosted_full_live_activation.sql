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
  workflow_start_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_workflow_start_authorities(id),
  checkpoint text NOT NULL CHECK(checkpoint IN ('V2-10','V2-11','V2-12','V2-13')),
  command_id text NOT NULL UNIQUE CHECK(command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
  request_sha256 text NOT NULL UNIQUE CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_document jsonb NOT NULL,
  execution_document jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
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
         'schemaVersion','singleUse','sourceCommit']::text[]
     OR supplied_authority->>'schemaVersion'<>'videoforge-v2-13-full-live-authority/v1'
     OR supplied_authority->>'proposalSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'approvalSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_authority->>'proposalCommit' !~ '^[0-9a-f]{40}$'
     OR supplied_authority->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied_authority->>'executorSha256' !~ '^sha256:[0-9a-f]{64}$'
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
       IS DISTINCT FROM ARRAY['deployedConfigSha256','observedAt','promotionId','schemaVersion','sourceCommit','versionIdSha256']::text[]
     OR supplied_readback->>'schemaVersion'<>'videoforge.v213-cloudflare-activation-readback/v1'
     OR supplied_readback->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied_readback->>'versionIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_readback->>'deployedConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied_readback->>'observedAt')::timestamptz>db_now
     OR (supplied_readback->>'observedAt')::timestamptz<db_now-interval '5 minutes' THEN
    RAISE EXCEPTION 'V213 Cloudflare activation readback invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_readback->>'promotionId',45));
  SELECT * INTO promotion FROM public.hosted_full_live_promotions WHERE id=(supplied_readback->>'promotionId')::uuid FOR SHARE;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=promotion.authority_id FOR SHARE;
  IF promotion.id IS NULL OR authority.expires_at<=db_now
     OR supplied_readback->>'sourceCommit'<>authority.source_commit
     OR supplied_readback->>'deployedConfigSha256'<>promotion.enabled_config_sha256 THEN
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
      'deployedConfigSha256',existing.deployed_config_sha256);
  END IF;
  INSERT INTO public.hosted_full_live_cloudflare_activations(id,promotion_id,source_commit,
    version_id_sha256,deployed_config_sha256,readback_document,readback_sha256,observed_at)
  VALUES(supplied_id,promotion.id,authority.source_commit,supplied_readback->>'versionIdSha256',
    promotion.enabled_config_sha256,supplied_readback,record_hash,(supplied_readback->>'observedAt')::timestamptz);
  RETURN jsonb_build_object('readbackSha256',record_hash,'versionIdSha256',supplied_readback->>'versionIdSha256',
    'deployedConfigSha256',promotion.enabled_config_sha256);
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
       OR production->>'endpointIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR production->>'templateIdSha256' !~ '^sha256:[0-9a-f]{64}$'
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
      'productionStageAuthorityId',production_stage.authority_id,'sourceCommit',authority.source_commit,
      'workerImageDigest',substring(production->>'image' from 'sha256:[0-9a-f]{64}$'),
      'modelManifestSha256',first_receipt#>>'{deployment,model_manifest_sha256}',
      'volumeIdSha256',production->>'volumeIdSha256','volumeManifestSha256',production->>'volumeManifestSha256',
      'endpointIdSha256',production->>'endpointIdSha256','templateIdSha256',production->>'templateIdSha256',
      'receiptSha256s',receipt_hashes));
    record_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(jsonb_build_object(
      'schemaVersion','serverless-endpoint-deployment/v3','deploymentId',new_deployment_id,'lane',lane_name,
      'endpointProfileId','v213-'||lane_name||'-production-v1','endpointIdSha256',production->>'endpointIdSha256',
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
      INSERT INTO public.serverless_endpoint_deployments(id,lane,endpoint_profile_id,endpoint_id_sha256,
        endpoint_config_sha256,worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
        volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,
        worker_count_min,worker_count_max,worker_ceiling_scope,retained_active_workers,scaler_type,
        scaler_value,handler_concurrency,idle_timeout_seconds,init_timeout_seconds,execution_timeout_seconds,
        request_ttl_seconds,request_ttl_scope,reconciliation_deadline_seconds,provider_result_window_seconds,
        polling_interval_seconds,max_replacement_attempts,blind_resubmit_permitted,timeout_evidence,
        deployment_version,is_active,record_sha256,created_at)
      VALUES(new_deployment_id,lane_name,'v213-'||lane_name||'-production-v1',production->>'endpointIdSha256',
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
  expected_signature:=encode(hmac(convert_to(supplied->>'kind'||E'\n'||supplied->>'artifactSha256'||E'\n'||document_hash,'UTF8'),
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
REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2_validated(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_complete_v209_terminal_acceptance(jsonb) FROM PUBLIC;
