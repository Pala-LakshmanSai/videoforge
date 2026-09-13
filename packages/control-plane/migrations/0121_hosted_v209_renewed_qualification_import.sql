-- Reuse an immutable 0104 qualification after its trusted refresh ancestry reaches
-- the current frozen importer binding. The qualification row remains unchanged.

CREATE FUNCTION public.videoforge_hosted_v209_renewal_qualification_lineage_trusted(
  supplied_qualification_id uuid,
  supplied_lane text,
  supplied_deployment_id uuid,
  expected_frozen_hash text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  activation public.hosted_v209_qualified_activations%ROWTYPE;
  parent_activation public.hosted_v209_qualified_activations%ROWTYPE;
  refresh_row public.hosted_v209_qualification_activation_refreshes%ROWTYPE;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  qualification_id uuid;
  deployment_id uuid;
  refresh_count integer;
  candidate_count integer;
  depth integer:=0;
  seen uuid[]:=ARRAY[]::uuid[];
BEGIN
  IF supplied_qualification_id IS NULL OR supplied_deployment_id IS NULL
     OR supplied_lane NOT IN ('mage_image','soulx_avatar')
     OR expected_frozen_hash IS NULL
     OR expected_frozen_hash !~ '^sha256:[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO candidate_count
  FROM public.hosted_v209_qualified_activations a
  JOIN public.hosted_v209_qualification_activation_refreshes r ON r.activation_id=a.id
  WHERE CASE supplied_lane WHEN 'mage_image' THEN a.mage_qualification_id
                           ELSE a.soulx_qualification_id END=supplied_qualification_id;
  IF candidate_count<>1 THEN RETURN false; END IF;

  SELECT a.* INTO activation
  FROM public.hosted_v209_qualified_activations a
  JOIN public.hosted_v209_qualification_activation_refreshes r ON r.activation_id=a.id
  WHERE CASE supplied_lane WHEN 'mage_image' THEN a.mage_qualification_id
                           ELSE a.soulx_qualification_id END=supplied_qualification_id;
  IF activation.id IS NULL THEN RETURN false; END IF;

  LOOP
    depth:=depth+1;
    IF depth>64 OR activation.id=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,activation.id);
    qualification_id:=CASE supplied_lane WHEN 'mage_image' THEN activation.mage_qualification_id
                                         ELSE activation.soulx_qualification_id END;
    deployment_id:=CASE supplied_lane WHEN 'mage_image' THEN activation.mage_deployment_id
                                      ELSE activation.soulx_deployment_id END;
    IF qualification_id IS NULL OR deployment_id IS NULL
       OR deployment_id<>supplied_deployment_id THEN RETURN false; END IF;

    SELECT * INTO qualification
    FROM public.hosted_serverless_qualification_attestations WHERE id=qualification_id;
    SELECT * INTO deployment
    FROM public.serverless_endpoint_deployments WHERE id=deployment_id;
    IF qualification.id IS NULL OR deployment.id IS NULL
       OR qualification.lane<>supplied_lane
       OR qualification.deployment_id<>deployment.id
       OR qualification.deployment_snapshot_sha256 IS DISTINCT FROM
          public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RETURN false;
    END IF;

    SELECT count(*) INTO refresh_count
    FROM public.hosted_v209_qualification_activation_refreshes
    WHERE activation_id=activation.id;
    IF refresh_count=0 THEN
      RETURN activation.evidence_document->>'schemaVersion'=
        'videoforge.hosted-v209-qualified-activation-import/v1'
        AND qualification.qualification_record_sha256=expected_frozen_hash;
    END IF;
    IF refresh_count<>1 THEN RETURN false; END IF;

    SELECT * INTO refresh_row
    FROM public.hosted_v209_qualification_activation_refreshes
    WHERE activation_id=activation.id;
    SELECT * INTO parent_activation
    FROM public.hosted_v209_qualified_activations
    WHERE id=refresh_row.previous_activation_id;
    IF refresh_row.refresh_id IS NULL OR refresh_row.activation_id<>activation.id
       OR parent_activation.id IS NULL
       OR refresh_row.previous_activation_id=ANY(seen) THEN
      RETURN false;
    END IF;
    activation:=parent_activation;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_hosted_v209_renewal_qualification_lineage_trusted(
  uuid,text,uuid,text) FROM PUBLIC;

DO $migration$
DECLARE
  definition text;
  needle constant text := 'OR existing.qualification_record_sha256<>evidence_hash';
  replacement constant text :=
    'OR (existing.qualification_record_sha256<>evidence_hash AND NOT public.videoforge_hosted_v209_renewal_qualification_lineage_trusted(existing.id,lane_name,deployment.id,evidence_hash))';
BEGIN
  definition:=pg_get_functiondef(
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)'::regprocedure
  );
  IF position(needle IN definition)=0 OR position(replacement IN definition)>0 THEN
    RAISE EXCEPTION 'hosted V2-09 qualified activation importer preimage drifted'
      USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,needle,replacement);
END;
$migration$;

REVOKE ALL ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
  FROM PUBLIC;
