-- Additive V2-13 recovery contracts. Migration 0045 is immutable and may already be present on a
-- retained production database, so every new table/function in this file upgrades that exact
-- installed prefix without rewriting its ledger bytes.

CREATE TABLE public.hosted_full_live_disabled_promotion_closures (
  id uuid PRIMARY KEY,
  promotion_id uuid NOT NULL UNIQUE REFERENCES public.hosted_full_live_promotions(id),
  disabled_version_id_sha256 text NOT NULL UNIQUE
    CHECK(disabled_version_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  disabled_config_sha256 text NOT NULL CHECK(disabled_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  route_status integer NOT NULL CHECK(route_status=503),
  route_version_sha256 text NOT NULL CHECK(route_version_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  closure_document jsonb NOT NULL CHECK(jsonb_typeof(closure_document)='object'),
  closure_sha256 text NOT NULL UNIQUE CHECK(closure_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE public.hosted_full_live_cleanup_receipt_intents (
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  operation_id text NOT NULL CHECK(operation_id IN (
    'restore-endpoints-max-one','prove-zero-workers','read-settled-billing',
    'reconcile-exact-resources')),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider_cleanup_evidence_sha256 text NOT NULL
    CHECK(provider_cleanup_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  receipt_artifact_sha256 text NOT NULL UNIQUE
    CHECK(receipt_artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  intent_document jsonb NOT NULL CHECK(jsonb_typeof(intent_document)='object'),
  intent_sha256 text NOT NULL UNIQUE CHECK(intent_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(full_live_authority_id,operation_id)
);

-- Cleanup bridge claims are authorized once, before a provider call is allowed to begin.  The
-- immutable 0045 bridge row intentionally stores only the command request identity; this additive
-- row also binds that identity to the outer authorization state.  Recovery controls are never
-- stored here, so a cleanup-only restart cannot turn its flags/current state hash into a new claim.
CREATE TABLE public.hosted_full_live_cleanup_command_identities (
  operation_id text PRIMARY KEY CHECK(operation_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'),
  full_live_authority_id uuid NOT NULL REFERENCES public.hosted_full_live_authorities(id),
  stage_authority_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('create','readback','dispatch','status','cancel','delete')),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  resource_key text NOT NULL CHECK(length(resource_key) BETWEEN 1 AND 240),
  outer_state_sha256 text NOT NULL CHECK(outer_state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  identity_document jsonb NOT NULL CHECK(jsonb_typeof(identity_document)='object'),
  identity_sha256 text NOT NULL UNIQUE CHECK(identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(full_live_authority_id,operation_id)
);

CREATE TRIGGER hosted_full_live_disabled_promotion_closures_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_disabled_promotion_closures
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_cleanup_receipt_intents_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_cleanup_receipt_intents
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_full_live_cleanup_command_identities_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_full_live_cleanup_command_identities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

ALTER TABLE public.hosted_full_live_disabled_promotion_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_disabled_promotion_closures FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cleanup_receipt_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cleanup_receipt_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cleanup_command_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_full_live_cleanup_command_identities FORCE ROW LEVEL SECURITY;

CREATE POLICY hosted_full_live_disabled_promotion_closures_owner_only
  ON public.hosted_full_live_disabled_promotion_closures USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_cleanup_receipt_intents_owner_only
  ON public.hosted_full_live_cleanup_receipt_intents USING(false) WITH CHECK(false);
CREATE POLICY hosted_full_live_cleanup_command_identities_owner_only
  ON public.hosted_full_live_cleanup_command_identities USING(false) WITH CHECK(false);

REVOKE ALL ON TABLE public.hosted_full_live_disabled_promotion_closures FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_cleanup_receipt_intents FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_full_live_cleanup_command_identities FROM PUBLIC;

-- Promotion and activation take this same advisory lock. Once the append-only disabled closure is
-- present, a later activation insert is permanently forbidden rather than racing the closure.
CREATE FUNCTION public.videoforge_v213_reject_activation_after_disabled_closure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.hosted_full_live_disabled_promotion_closures closure
      WHERE closure.promotion_id=NEW.promotion_id) THEN
    RAISE EXCEPTION 'V213 Cloudflare activation follows disabled closure' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hosted_full_live_cloudflare_activations_disabled_closure_guard
  BEFORE INSERT ON public.hosted_full_live_cloudflare_activations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_v213_reject_activation_after_disabled_closure();
REVOKE ALL ON FUNCTION public.videoforge_v213_reject_activation_after_disabled_closure()
  FROM PUBLIC;

-- Records DISABLED_UNQUALIFIED when promotion exists but activation never committed. An exact
-- replay is evaluated under the promotion lock before the five-minute insertion freshness gate,
-- so cleanup can reconcile the same durable observation at any later time without inventing bytes.
CREATE FUNCTION public.videoforge_record_v213_disabled_promotion_closure(
  supplied_id uuid, supplied_closure jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp();
  promotion public.hosted_full_live_promotions%ROWTYPE;
  existing public.hosted_full_live_disabled_promotion_closures%ROWTYPE;
  record_hash text; observed_at_value timestamptz;
BEGIN
  IF jsonb_typeof(supplied_closure)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_closure) key)
       IS DISTINCT FROM ARRAY['disabledConfigSha256','disabledVersionIdSha256','observedAt',
         'promotionId','routeStatus','routeVersionSha256','schemaVersion']::text[]
     OR supplied_closure->>'schemaVersion'<>
        'videoforge.v213-disabled-promotion-closure/v1'
     OR supplied_closure->>'promotionId' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied_closure->>'disabledVersionIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_closure->>'disabledConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_closure->>'routeVersionSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_closure->'routeStatus' IS DISTINCT FROM '503'::jsonb
     OR supplied_closure->>'routeVersionSha256'<>
        supplied_closure->>'disabledVersionIdSha256'
     OR supplied_closure->>'observedAt' IS NULL THEN
    RAISE EXCEPTION 'V213 disabled promotion closure invalid' USING ERRCODE='23514';
  END IF;
  BEGIN
    observed_at_value:=(supplied_closure->>'observedAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'V213 disabled promotion closure invalid' USING ERRCODE='23514';
  END;
  record_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied_closure),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_closure->>'promotionId',45));
  SELECT * INTO promotion FROM public.hosted_full_live_promotions
    WHERE id=(supplied_closure->>'promotionId')::uuid FOR SHARE;
  IF promotion.id IS NULL
     OR supplied_closure->>'disabledConfigSha256'<>promotion.disabled_config_sha256
     OR EXISTS(SELECT 1 FROM public.hosted_full_live_cloudflare_activations activation
       WHERE activation.promotion_id=promotion.id) THEN
    RAISE EXCEPTION 'V213 disabled promotion closure lineage invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_disabled_promotion_closures
    WHERE promotion_id=promotion.id;
  IF existing.id IS NOT NULL THEN
    IF existing.id<>supplied_id
       OR existing.disabled_version_id_sha256<>supplied_closure->>'disabledVersionIdSha256'
       OR existing.disabled_config_sha256<>supplied_closure->>'disabledConfigSha256'
       OR existing.route_status<>503
       OR existing.route_version_sha256<>supplied_closure->>'routeVersionSha256'
       OR existing.observed_at<>observed_at_value
       OR existing.closure_document IS DISTINCT FROM supplied_closure
       OR existing.closure_sha256<>record_hash THEN
      RAISE EXCEPTION 'V213 disabled promotion closure replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('rollbackSha256',existing.closure_sha256,
      'disabledVersionIdSha256',existing.disabled_version_id_sha256,
      'disabledConfigSha256',existing.disabled_config_sha256);
  END IF;
  IF observed_at_value>db_now OR observed_at_value<db_now-interval '5 minutes' THEN
    RAISE EXCEPTION 'V213 disabled promotion closure stale' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_full_live_disabled_promotion_closures(id,promotion_id,
    disabled_version_id_sha256,disabled_config_sha256,route_status,route_version_sha256,
    closure_document,closure_sha256,observed_at)
  VALUES(supplied_id,promotion.id,supplied_closure->>'disabledVersionIdSha256',
    promotion.disabled_config_sha256,503,supplied_closure->>'routeVersionSha256',
    supplied_closure,record_hash,observed_at_value);
  RETURN jsonb_build_object('rollbackSha256',record_hash,
    'disabledVersionIdSha256',supplied_closure->>'disabledVersionIdSha256',
    'disabledConfigSha256',promotion.disabled_config_sha256);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_record_v213_disabled_promotion_closure(uuid,jsonb)
  FROM PUBLIC;

-- This wrapper is deliberately additive: it calls the immutable 0045 claim only for an initial
-- authorization or when a durable bridge row is already present.  A readback-only recovery with
-- no bridge row returns RECONCILE without inserting/transitioning anything, which is the strict
-- no-redispatch behavior required after an uncertain child boundary.
CREATE FUNCTION public.videoforge_claim_v213_cleanup_bridge_command(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  claimed_authority_id uuid; latest public.hosted_full_live_bridge_command_events%ROWTYPE;
  existing public.hosted_full_live_cleanup_command_identities%ROWTYPE;
  claim jsonb; identity_document jsonb; identity_hash text; command_id text;
  readback_only boolean; bridge_present boolean;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['kind','operationId','outerStateSha256','readbackOnly',
         'requestSha256','resourceKey','stageAuthorityId']::text[]
     OR supplied->>'operationId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$'
     OR supplied->>'stageAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'kind' NOT IN ('create','readback','dispatch','status','cancel','delete')
     OR supplied->>'requestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'resourceKey' IS NULL OR length(supplied->>'resourceKey') NOT BETWEEN 1 AND 240
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'readbackOnly')<>'boolean' THEN
    RAISE EXCEPTION 'V213 cleanup bridge command invalid' USING ERRCODE='23514';
  END IF;
  claimed_authority_id:=(supplied->>'stageAuthorityId')::uuid;
  readback_only:=(supplied->>'readbackOnly')::boolean;
  command_id:=supplied->>'operationId';
  -- Keep this relation identical to the immutable 0045 cleanup scope check.  The command ID is
  -- intentionally not trusted as the operation selector; resourceKey/kind are checked together.
  IF supplied->>'resourceKey' IS DISTINCT FROM
       ('v213:'||CASE supplied->>'kind'
          WHEN 'cancel' THEN 'restore-endpoints-max-one'
          WHEN 'readback' THEN 'read-settled-billing'
          WHEN 'status' THEN CASE
            WHEN supplied->>'resourceKey'= 'v213:prove-zero-workers:'||command_id
              THEN 'prove-zero-workers'
            ELSE 'reconcile-exact-resources'
          END
          ELSE '__not_cleanup__'
        END||':'||command_id) THEN
    RAISE EXCEPTION 'V213 cleanup bridge command scope invalid' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
      WHERE authority.id=claimed_authority_id) THEN
    RAISE EXCEPTION 'V213 cleanup bridge command authority unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(command_id,49));
  SELECT * INTO existing FROM public.hosted_full_live_cleanup_command_identities identity
    WHERE identity.operation_id=command_id;
  IF existing.operation_id IS NOT NULL THEN
    IF existing.full_live_authority_id<>claimed_authority_id
       OR existing.stage_authority_id<>claimed_authority_id
       OR existing.kind<>supplied->>'kind'
       OR existing.request_sha256<>supplied->>'requestSha256'
       OR existing.resource_key<>supplied->>'resourceKey'
       OR (NOT readback_only AND existing.outer_state_sha256<>supplied->>'outerStateSha256') THEN
      RAISE EXCEPTION 'V213 cleanup bridge command replay drift' USING ERRCODE='23505';
    END IF;
    SELECT * INTO latest FROM public.hosted_full_live_bridge_command_events event
      WHERE event.operation_id=command_id ORDER BY sequence DESC LIMIT 1;
    IF latest.operation_id IS NULL THEN
      RETURN jsonb_build_object('action','RECONCILE','bridgeRowPresent',false,
        'identityRecorded',true,'identitySha256',existing.identity_sha256,
        'originalOuterStateSha256',existing.outer_state_sha256,
        'requestSha256',existing.request_sha256);
    END IF;
    claim:=public.videoforge_claim_v213_bridge_command(jsonb_build_object(
      'operationId',command_id,'stageAuthorityId',existing.stage_authority_id::text,
      'kind',existing.kind,'requestSha256',existing.request_sha256,
      'resourceKey',existing.resource_key));
    RETURN claim||jsonb_build_object('bridgeRowPresent',true,'identityRecorded',true,
      'identitySha256',existing.identity_sha256,
      'originalOuterStateSha256',existing.outer_state_sha256,
      'requestSha256',existing.request_sha256);
  END IF;
  -- Recovery cannot manufacture an authorization identity.  Even if an old bridge row happens to
  -- exist, leave it untouched and make the caller perform only its provider readback.
  IF readback_only THEN
    SELECT * INTO latest FROM public.hosted_full_live_bridge_command_events event
      WHERE event.operation_id=command_id ORDER BY sequence DESC LIMIT 1;
    RETURN jsonb_build_object('action','RECONCILE','bridgeRowPresent',latest.operation_id IS NOT NULL,
      'identityRecorded',false);
  END IF;
  identity_document:=jsonb_build_object(
    'schemaVersion','videoforge.v213-cleanup-command-identity/v1',
    'operationId',command_id,
    'fullLiveAuthorityId',claimed_authority_id::text,
    'stageAuthorityId',claimed_authority_id::text,
    'kind',supplied->>'kind',
    'requestSha256',supplied->>'requestSha256',
    'resourceKey',supplied->>'resourceKey',
    'outerStateSha256',supplied->>'outerStateSha256');
  identity_hash:=public.videoforge_v213_jit_sha256(identity_document);
  INSERT INTO public.hosted_full_live_cleanup_command_identities(
    operation_id,full_live_authority_id,stage_authority_id,kind,request_sha256,resource_key,
    outer_state_sha256,identity_document,identity_sha256)
  VALUES(command_id,claimed_authority_id,claimed_authority_id,supplied->>'kind',
    supplied->>'requestSha256',supplied->>'resourceKey',supplied->>'outerStateSha256',
    identity_document,identity_hash);
  claim:=public.videoforge_claim_v213_bridge_command(jsonb_build_object(
    'operationId',command_id,'stageAuthorityId',claimed_authority_id::text,
    'kind',supplied->>'kind','requestSha256',supplied->>'requestSha256',
    'resourceKey',supplied->>'resourceKey'));
  RETURN claim||jsonb_build_object('bridgeRowPresent',true,'identityRecorded',true,
    'identitySha256',identity_hash,'originalOuterStateSha256',supplied->>'outerStateSha256',
    'requestSha256',supplied->>'requestSha256');
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_cleanup_bridge_command(jsonb) FROM PUBLIC;

-- The authority row is the failure-safe root. It remains valid for cleanup receipt persistence
-- after expiry and before promotion, activation, or success-only materialization facts exist.
CREATE FUNCTION public.videoforge_claim_v213_cleanup_receipt_intent(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; document jsonb:=supplied->'document'; intent_document jsonb;
  effective_document jsonb; effective_artifact text; current_artifact text; cleanup_identity
    public.hosted_full_live_cleanup_command_identities%ROWTYPE;
  intent_hash text; existing public.hosted_full_live_cleanup_receipt_intents%ROWTYPE;
  existing_receipt public.hosted_full_live_operation_receipts%ROWTYPE;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['document','fullLiveAuthorityId','operationId','outerStateSha256',
         'providerCleanupEvidenceSha256','receiptArtifactSha256']::text[]
     OR supplied->>'fullLiveAuthorityId' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR supplied->>'operationId' NOT IN ('restore-endpoints-max-one','prove-zero-workers',
       'read-settled-billing','reconcile-exact-resources')
     OR supplied->>'outerStateSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'providerCleanupEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'receiptArtifactSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'V213 cleanup receipt intent invalid' USING ERRCODE='23514';
  END IF;
  full_authority:=(supplied->>'fullLiveAuthorityId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    full_authority::text||':'||(supplied->>'operationId'),451));
  IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=full_authority) THEN
    RAISE EXCEPTION 'V213 cleanup receipt intent authority unavailable' USING ERRCODE='42501';
  END IF;
  -- A receipt intent is keyed by the original authority and cleanup operation. Once that
  -- append-only row exists, a restarted readback may contain a new provider timestamp, evidence
  -- hash, artifact hash, or outer-state snapshot; none of those current observations can replace
  -- the durable intent. Return it before inspecting the fresh document at all.
  SELECT * INTO existing FROM public.hosted_full_live_cleanup_receipt_intents row
   WHERE row.full_live_authority_id=full_authority
     AND row.operation_id=supplied->>'operationId';
  IF existing.operation_id IS NOT NULL THEN
    RETURN jsonb_build_object('intentSha256',existing.intent_sha256,
      'intentState','ACK_UNKNOWN','receiptArtifactSha256',existing.receipt_artifact_sha256,
      'outerStateSha256',existing.outer_state_sha256,
      'providerCleanupEvidenceSha256',existing.provider_cleanup_evidence_sha256,
      'receiptDocument',existing.intent_document->'receiptDocument');
  END IF;
  -- The remaining validation applies only to a first claim. It binds the newly persisted intent
  -- to the evidence/document observed before any uncertain boundary.
  IF jsonb_typeof(document)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(document) key)
       IS DISTINCT FROM ARRAY['fullLiveAuthorityId','operationId','outerStateSha256',
         'providerCleanupEvidenceSha256','schemaVersion','summary']::text[]
     OR document->>'schemaVersion'<>'videoforge.v213-current-run-cleanup-receipt/v1'
     OR document->>'fullLiveAuthorityId'<>supplied->>'fullLiveAuthorityId'
     OR document->>'operationId'<>supplied->>'operationId'
     OR document->>'outerStateSha256'<>supplied->>'outerStateSha256'
     OR document->>'providerCleanupEvidenceSha256'<>
        supplied->>'providerCleanupEvidenceSha256'
     OR jsonb_typeof(document->'summary')<>'object'
     OR supplied->>'providerCleanupEvidenceSha256'<>
        public.videoforge_v213_jit_sha256(document->'summary') THEN
    RAISE EXCEPTION 'V213 cleanup receipt intent invalid' USING ERRCODE='23514';
  END IF;
  -- A restarted cleanup command may observe a different outer state after the executor has
  -- entered CLEANUP_ONLY.  Bind the receipt to the original command authorization when its
  -- additive identity row is present; recovery flags/current outer state are not receipt identity.
  SELECT * INTO cleanup_identity FROM public.hosted_full_live_cleanup_command_identities identity
    WHERE identity.operation_id='v213:'||full_authority::text||':'||(supplied->>'operationId');
  current_artifact:=public.videoforge_v213_jit_sha256(document);
  IF cleanup_identity.operation_id IS NOT NULL THEN
    effective_document:=document||jsonb_build_object(
      'outerStateSha256',cleanup_identity.outer_state_sha256);
  ELSE
    effective_document:=document;
    IF supplied->>'receiptArtifactSha256'<>current_artifact THEN
      RAISE EXCEPTION 'V213 cleanup receipt intent invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  effective_artifact:=public.videoforge_v213_jit_sha256(effective_document);
  intent_document:=jsonb_build_object(
    'schemaVersion','videoforge.v213-cleanup-receipt-intent/v1',
    'fullLiveAuthorityId',supplied->>'fullLiveAuthorityId',
    'operationId',supplied->>'operationId',
    'outerStateSha256',effective_document->>'outerStateSha256',
    'providerCleanupEvidenceSha256',supplied->>'providerCleanupEvidenceSha256',
    'receiptArtifactSha256',effective_artifact,
    'receiptDocument',effective_document);
  intent_hash:=public.videoforge_v213_jit_sha256(intent_document);
  SELECT * INTO existing_receipt FROM public.hosted_full_live_operation_receipts receipt
   WHERE receipt.full_live_authority_id=full_authority
     AND receipt.operation_id=supplied->>'operationId';
  IF existing_receipt.operation_id IS NOT NULL AND (
       existing_receipt.artifact_sha256<>effective_artifact
       OR existing_receipt.receipt_document IS DISTINCT FROM effective_document) THEN
    RAISE EXCEPTION 'V213 cleanup receipt intent existing receipt drift' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.hosted_full_live_cleanup_receipt_intents(
    full_live_authority_id,operation_id,outer_state_sha256,
    provider_cleanup_evidence_sha256,receipt_artifact_sha256,intent_document,intent_sha256)
  VALUES(full_authority,supplied->>'operationId',effective_document->>'outerStateSha256',
    supplied->>'providerCleanupEvidenceSha256',effective_artifact,
    intent_document,intent_hash);
  RETURN jsonb_build_object('intentSha256',intent_hash,'intentState','NO_ATTEMPT',
    'receiptArtifactSha256',effective_artifact,
    'outerStateSha256',effective_document->>'outerStateSha256',
    'providerCleanupEvidenceSha256',supplied->>'providerCleanupEvidenceSha256',
    'receiptDocument',effective_document);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_claim_v213_cleanup_receipt_intent(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_record_v213_operation_receipt(supplied jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE full_authority uuid; evidence public.hosted_full_live_signed_evidence%ROWTYPE;
  intent public.hosted_full_live_cleanup_receipt_intents%ROWTYPE;
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
  PERFORM pg_advisory_xact_lock(hashtextextended(
    full_authority::text||':'||(supplied->>'operationId'),451));
  SELECT * INTO intent FROM public.hosted_full_live_cleanup_receipt_intents row
   WHERE row.full_live_authority_id=full_authority
     AND row.operation_id=supplied->>'operationId';
  SELECT * INTO evidence FROM public.hosted_full_live_signed_evidence row
   WHERE row.artifact_sha256=supplied->>'artifactSha256' AND row.kind='RELEASE';
  IF NOT EXISTS(SELECT 1 FROM public.hosted_full_live_authorities authority
       WHERE authority.id=full_authority)
     OR intent.operation_id IS NULL
     OR intent.outer_state_sha256<>document->>'outerStateSha256'
     OR intent.provider_cleanup_evidence_sha256<>
        document->>'providerCleanupEvidenceSha256'
     OR intent.receipt_artifact_sha256<>supplied->>'artifactSha256'
     OR intent.intent_document->'receiptDocument' IS DISTINCT FROM document
     OR evidence.artifact_sha256 IS NULL
     OR evidence.document IS DISTINCT FROM document THEN
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
REVOKE ALL ON FUNCTION public.videoforge_record_v213_operation_receipt(jsonb) FROM PUBLIC;

-- Migration 0045 installed the promotion gate against its then-terminal 45-row manifest. Replace
-- only the function body so a retained 45-row database can apply 0046 and then promote against the
-- exact 46-row ledger.
CREATE OR REPLACE FUNCTION public.videoforge_promote_hosted_full_live(
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
     OR (SELECT count(*) FROM public.videoforge_schema_migrations)<>46
     OR (SELECT max(version) FROM public.videoforge_schema_migrations)<>46 THEN
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
