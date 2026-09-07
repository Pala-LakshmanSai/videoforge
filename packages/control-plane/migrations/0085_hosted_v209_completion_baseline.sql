-- V2-09 read-only completion baseline for the exact ordinary hosted account/workspace.
--
-- The projection counts each generic PROJECT_REVISION attempt once.  Definite settled cost is
-- net of refunds; unresolved exposure is the greater of its still-open reservation and its
-- reported-but-unsettled cost.  It creates no project, reservation, ledger row, or provider work.

CREATE FUNCTION public.videoforge_read_hosted_v209_completion_baseline(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_maximum_micro_usd bigint
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  settled_net_micro_usd bigint;
  open_reservation_micro_usd bigint;
  reported_unsettled_micro_usd bigint;
  completion_baseline_micro_usd bigint;
  attempt_count bigint;
  document jsonb;
BEGIN
  IF supplied_account_id IS NULL OR supplied_workspace_id IS NULL
     OR supplied_maximum_micro_usd IS NULL
     OR supplied_maximum_micro_usd<0 OR supplied_maximum_micro_usd>15500000 THEN
    RAISE EXCEPTION 'hosted V2-09 completion baseline input invalid' USING ERRCODE='23514';
  END IF;
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.workspaces row
       WHERE row.account_id=supplied_account_id AND row.id=supplied_workspace_id
         AND row.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 completion baseline scope invalid' USING ERRCODE='42501';
  END IF;

  WITH per_attempt AS (
    SELECT event.attempt_id,
      coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='RESERVED'),0)::bigint
        AS reserved_micro_usd,
      coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='REPORTED'),0)::bigint
        AS reported_micro_usd,
      coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='SETTLED'),0)::bigint
        AS settled_micro_usd,
      coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='RELEASED'),0)::bigint
        AS released_micro_usd,
      coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='REFUNDED'),0)::bigint
        AS refunded_micro_usd
    FROM public.cost_events event
    WHERE event.account_id=supplied_account_id
      AND event.workspace_id=supplied_workspace_id
      AND event.owner_type='PROJECT_REVISION'
    GROUP BY event.attempt_id
  ), exposure AS (
    SELECT *,
      settled_micro_usd-refunded_micro_usd AS settled_net,
      greatest(reserved_micro_usd-settled_micro_usd-released_micro_usd,0) AS open_reservation,
      greatest(reported_micro_usd-settled_micro_usd,0) AS reported_unsettled
    FROM per_attempt
  )
  SELECT coalesce(sum(settled_net),0)::bigint,
    coalesce(sum(open_reservation),0)::bigint,
    coalesce(sum(reported_unsettled),0)::bigint,
    coalesce(sum(settled_net+greatest(open_reservation,reported_unsettled)),0)::bigint,
    count(*)::bigint
  INTO settled_net_micro_usd,open_reservation_micro_usd,reported_unsettled_micro_usd,
    completion_baseline_micro_usd,attempt_count
  FROM exposure
  WHERE settled_net>=0;

  IF EXISTS(
    SELECT 1 FROM (
      SELECT event.attempt_id,
        coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='SETTLED'),0) settled,
        coalesce(sum(event.amount_micro_usd) FILTER(WHERE event.event_type='REFUNDED'),0) refunded
      FROM public.cost_events event
      WHERE event.account_id=supplied_account_id
        AND event.workspace_id=supplied_workspace_id
        AND event.owner_type='PROJECT_REVISION'
      GROUP BY event.attempt_id
    ) invalid WHERE refunded>settled
  ) THEN
    RAISE EXCEPTION 'hosted V2-09 completion baseline ledger invalid' USING ERRCODE='23514';
  END IF;
  IF completion_baseline_micro_usd>supplied_maximum_micro_usd THEN
    RAISE EXCEPTION 'hosted V2-09 completion baseline exceeds approved gate' USING ERRCODE='22003';
  END IF;

  document:=jsonb_build_object(
    'schemaVersion','videoforge.v2-09-completion-baseline/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,
    'attemptCount',attempt_count,
    'settledNetMicroUsd',settled_net_micro_usd,
    'openReservationMicroUsd',open_reservation_micro_usd,
    'reportedUnsettledMicroUsd',reported_unsettled_micro_usd,
    'completionBaselineMicroUsd',completion_baseline_micro_usd,
    'maximumCompletionBaselineMicroUsd',supplied_maximum_micro_usd,
    'derivation','GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE',
    'observedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  RETURN document||jsonb_build_object('receiptSha256','sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(document),'UTF8')),'hex'));
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_completion_baseline(
  uuid,uuid,bigint) FROM PUBLIC;
