-- Migration 0102: permit one append-only second same-attempt deadline recovery for the
-- exact already-admitted V2-09 pair.  This extends ordinal 5 to ordinal 6 after the first
-- 20/30-minute workflow window expires.  It never creates a generation, attempt, provider
-- action, or new reservation.

ALTER TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals
  DROP CONSTRAINT hosted_v209_renewal_ordinal_check,
  DROP CONSTRAINT hosted_v209_renewal_predecessor_check,
  ADD CONSTRAINT hosted_v209_renewal_ordinal_check CHECK(renewal_ordinal IN (1,2,3,4,5,6)),
  ADD CONSTRAINT hosted_v209_renewal_predecessor_check
    CHECK((renewal_ordinal=1 AND previous_candidate_sha256 IS NULL AND previous_approval_id IS NULL)
    OR (renewal_ordinal IN (2,3,4,5,6) AND previous_candidate_sha256 IS NOT NULL
      AND previous_candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'
      AND previous_approval_id IS NOT NULL));

-- The effective reader was deliberately bounded at ordinal 5 by migration 0100.  Extend only
-- that bound; all immutable hash, predecessor, approval, and tenant checks remain unchanged.
DO $patch_effective_candidate_ordinal6$
DECLARE
  signature constant text:='videoforge_effective_hosted_v209_candidate(uuid,uuid,uuid)';
  definition text; patched text; target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR position('IF expected_ordinal>6 THEN' IN definition)=0
     OR (length(definition)-length(replace(definition,'IF expected_ordinal>6 THEN','')))
          /length('IF expected_ordinal>6 THEN')<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 effective candidate ordinal-6 preimage drifted'
      USING ERRCODE='55000';
  END IF;
  patched:=replace(definition,'IF expected_ordinal>6 THEN','IF expected_ordinal>7 THEN');
  IF patched=definition OR position('IF expected_ordinal>6 THEN' IN patched)>0
     OR position('IF expected_ordinal>7 THEN' IN patched)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 effective candidate ordinal-6 patch failed'
      USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_effective_candidate_ordinal6$;

-- Migration 0100 made the recovery ledger one-row-per-generation.  Keep every row immutable,
-- but make the key the generation plus recovery ordinal so ordinal 5 and ordinal 6 can coexist.
DO $widen_recovery_history$
DECLARE
  unique_constraint text;
  ordinal_constraint text;
BEGIN
  SELECT c.conname INTO unique_constraint
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid='public.hosted_v209_same_attempt_deadline_recoveries'::regclass
     AND c.contype='u'
     AND pg_get_constraintdef(c.oid)='UNIQUE (account_id, workspace_id, generation_request_id)';
  IF unique_constraint IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 recovery generation uniqueness preimage drifted'
      USING ERRCODE='55000';
  END IF;
  EXECUTE format('ALTER TABLE public.hosted_v209_same_attempt_deadline_recoveries DROP CONSTRAINT %I',
    unique_constraint);

  SELECT c.conname INTO ordinal_constraint
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid='public.hosted_v209_same_attempt_deadline_recoveries'::regclass
     AND c.contype='c'
     AND pg_get_constraintdef(c.oid)='CHECK ((renewal_ordinal = 5))';
  IF ordinal_constraint IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 recovery ordinal preimage drifted' USING ERRCODE='55000';
  END IF;
  EXECUTE format('ALTER TABLE public.hosted_v209_same_attempt_deadline_recoveries DROP CONSTRAINT %I',
    ordinal_constraint);
  ALTER TABLE public.hosted_v209_same_attempt_deadline_recoveries
    ADD CONSTRAINT hosted_v209_same_attempt_deadline_recoveries_generation_ordinal_key
      UNIQUE(account_id,workspace_id,generation_request_id,renewal_ordinal),
    ADD CONSTRAINT hosted_v209_same_attempt_deadline_recoveries_ordinal_check
      CHECK(renewal_ordinal IN (5,6));
END
$widen_recovery_history$;

-- Select the latest append-only recovery row.  The row's ordinal is also the candidate renewal
-- ordinal, so all existing lineage checks remain valid for both the first and second recovery.
DO $patch_latest_recovery_schedule$
DECLARE
  signature constant text:='videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid)';
  definition text; patched text; target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR position('SELECT * INTO recovery FROM public.hosted_v209_same_attempt_deadline_recoveries r' IN definition)=0
     OR position('AND row.renewal_ordinal=5;' IN definition)=0
     OR position('fifth_renewal.renewal_ordinal<>5' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 latest-recovery schedule preimage drifted' USING ERRCODE='55000';
  END IF;
  patched:=replace(definition,
    'SELECT * INTO recovery FROM public.hosted_v209_same_attempt_deadline_recoveries r' || chr(10) ||
    '   WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.generation_request_id=$3;',
    'SELECT * INTO recovery FROM public.hosted_v209_same_attempt_deadline_recoveries r' || chr(10) ||
    '   WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.generation_request_id=$3' || chr(10) ||
    '   ORDER BY r.renewal_ordinal DESC,r.created_at DESC LIMIT 1;');
  patched:=replace(patched,
    'AND row.renewal_ordinal=5;',
    'AND row.renewal_ordinal=recovery.renewal_ordinal;');
  patched:=replace(patched,'fifth_renewal.renewal_ordinal<>5',
    'fifth_renewal.renewal_ordinal<>recovery.renewal_ordinal');
  IF patched=definition
     OR position('ORDER BY r.renewal_ordinal DESC,r.created_at DESC LIMIT 1' IN patched)=0
     OR position('AND row.renewal_ordinal=5;' IN patched)>0
     OR position('fifth_renewal.renewal_ordinal<>5' IN patched)>0 THEN
    RAISE EXCEPTION 'hosted V2-09 latest-recovery schedule patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_latest_recovery_schedule$;

-- Clone the migration-0100 operation with only the exact second-recovery deltas.  Keeping the
-- original function intact preserves its consumed ordinal-5 contract and makes replay of either
-- operation fail closed.  The clone requires the old ordinal-5 row, the current v6 lease and v2
-- attempts, then performs CAS to v7/v3 and appends ordinal 6 with zero provider actions.
DO $create_second_deadline_recovery$
DECLARE
  signature constant text:='videoforge_recover_hosted_v209_same_attempt_deadline(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid,uuid,uuid)';
  definition text; patched text; target_count integer;
  previous_recovery_declaration constant text:=
    '  recovery public.hosted_v209_same_attempt_deadline_recoveries%ROWTYPE;';
  previous_recovery_select constant text:=
    '  SELECT * INTO previous_recovery FROM public.hosted_v209_same_attempt_deadline_recoveries row' || chr(10) ||
    '   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id' || chr(10) ||
    '     AND row.generation_request_id=supplied_generation_request_id' || chr(10) ||
    '     AND row.renewal_ordinal=5 FOR SHARE;';
  recovery_guard constant text:=
    '     OR EXISTS(SELECT 1 FROM public.hosted_v209_same_attempt_deadline_recoveries row' || chr(10) ||
    '       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id' || chr(10) ||
    '         AND row.generation_request_id=request.id)';
  second_recovery_guard constant text:=
    '     OR (SELECT count(*) FROM public.hosted_v209_same_attempt_deadline_recoveries row' || chr(10) ||
    '       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id' || chr(10) ||
    '         AND row.generation_request_id=request.id AND row.renewal_ordinal=5)<>1' || chr(10) ||
    '     OR EXISTS(SELECT 1 FROM public.hosted_v209_same_attempt_deadline_recoveries row' || chr(10) ||
    '       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id' || chr(10) ||
    '         AND row.generation_request_id=request.id AND row.renewal_ordinal=6)';
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR position('(SELECT count(*) FROM public.videoforge_schema_migrations)<>100' IN definition)=0
     OR position('(SELECT max(version) FROM public.videoforge_schema_migrations)<>100' IN definition)=0
     OR position('WHERE migration.version=100' IN definition)=0
     OR position('renewal_count<>4 OR previous_renewal.renewal_ordinal<>4' IN definition)=0
     OR position('claim.approval_id<>effective_candidate.approval_id' IN definition)=0
     OR position('OR EXISTS(SELECT 1 FROM public.hosted_v209_same_attempt_deadline_recoveries row' IN definition)=0
     OR position('mage.attempt_ordinal<>1 OR mage.version<>1' IN definition)=0
     OR position('soulx.attempt_ordinal<>1 OR soulx.version<>1' IN definition)=0
     OR position('AND row.generation_request_id=request.id)=5' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 second deadline recovery preimage drifted' USING ERRCODE='55000';
  END IF;

  patched:=replace(definition,
    'videoforge_recover_hosted_v209_same_attempt_deadline(',
    'videoforge_recover_hosted_v209_same_attempt_deadline_second(');
  patched:=replace(patched,'(SELECT count(*) FROM public.videoforge_schema_migrations)<>100',
    '(SELECT count(*) FROM public.videoforge_schema_migrations)<>102');
  patched:=replace(patched,'(SELECT max(version) FROM public.videoforge_schema_migrations)<>100',
    '(SELECT max(version) FROM public.videoforge_schema_migrations)<>102');
  patched:=replace(patched,'migration.version=100','migration.version=102');
  patched:=replace(patched,
    'migration.name=''hosted_v209_same_attempt_deadline_recovery''',
    'migration.name=''hosted_v209_second_same_attempt_deadline_recovery''');
  patched:=replace(patched,
    'migration.filename=''0100_hosted_v209_same_attempt_deadline_recovery.sql''',
    'migration.filename=''0102_hosted_v209_second_same_attempt_deadline_recovery.sql''');
  patched:=replace(patched,previous_recovery_declaration,
    previous_recovery_declaration || chr(10) ||
    '  previous_recovery public.hosted_v209_same_attempt_deadline_recoveries%ROWTYPE;');
  patched:=replace(patched,
    '     AND row.generation_request_id=supplied_generation_request_id' || chr(10) ||
    '     AND row.renewal_ordinal=4 FOR SHARE;',
    '     AND row.generation_request_id=supplied_generation_request_id' || chr(10) ||
    '     AND row.renewal_ordinal=5 FOR SHARE;' || chr(10) || previous_recovery_select);
  patched:=replace(patched,'claim.approval_id<>effective_candidate.approval_id',
    'claim.approval_id<>previous_renewal.previous_approval_id');
  patched:=replace(patched,'renewal_count<>4 OR previous_renewal.renewal_ordinal<>4',
    'renewal_count<>5 OR previous_renewal.renewal_ordinal<>5' || chr(10) ||
    '     OR previous_recovery.operation_id IS NULL' || chr(10) ||
    '     OR previous_recovery.renewal_ordinal<>5' || chr(10) ||
    '     OR previous_recovery.generation_request_id<>request.id' || chr(10) ||
    '     OR previous_recovery.lease_id<>lease.id' || chr(10) ||
    '     OR previous_recovery.candidate_sha256<>effective_candidate.candidate_sha256' || chr(10) ||
    '     OR previous_recovery.approval_id<>effective_candidate.approval_id' || chr(10) ||
    '     OR previous_recovery.lease_version<>lease.version' || chr(10) ||
    '     OR previous_recovery.mage_attempt_id<>mage.id' || chr(10) ||
    '     OR previous_recovery.soulx_attempt_id<>soulx.id' || chr(10) ||
    '     OR previous_recovery.refreshed_stop_at>=db_now');
  patched:=replace(patched,recovery_guard,second_recovery_guard);
  patched:=replace(patched,'mage.attempt_ordinal<>1 OR mage.version<>1',
    'mage.attempt_ordinal<>1 OR mage.version<>2');
  patched:=replace(patched,'soulx.attempt_ordinal<>1 OR soulx.version<>1',
    'soulx.attempt_ordinal<>1 OR soulx.version<>2');
  patched:=replace(patched,
    'renewed_candidate_document,renewed_expires_at,supplied_operation_id,db_now,' || chr(10) ||
    '    5,effective_candidate.candidate_sha256,effective_candidate.approval_id);',
    'renewed_candidate_document,renewed_expires_at,supplied_operation_id,db_now,' || chr(10) ||
    '    6,effective_candidate.candidate_sha256,effective_candidate.approval_id);');
  patched:=replace(patched,
    'renewed_approval_sha,5,mage.id,soulx.id,mage.version,soulx.version,' || chr(10) ||
    '    admission.database_observed_at,admission.cancel_at,admission.stop_at,',
    'renewed_approval_sha,6,mage.id,soulx.id,mage.version,soulx.version,' || chr(10) ||
    '    previous_recovery.refreshed_database_observed_at,previous_recovery.refreshed_cancel_at,' || chr(10) ||
    '    previous_recovery.refreshed_stop_at,');
  patched:=replace(patched,
    'AND row.generation_request_id=request.id)=5' || chr(10) ||
    '       IS NOT TRUE',
    'AND row.generation_request_id=request.id)=6' || chr(10) ||
    '       IS NOT TRUE');
  patched:=replace(patched,'''renewalOrdinal'',5','''renewalOrdinal'',6');
  patched:=replace(patched,'''renewalOrdinal'',5','''renewalOrdinal'',6');
  patched:=replace(patched,
    '''approvalSha256'',renewed_approval_sha,''renewalOrdinal'',5,',
    '''approvalSha256'',renewed_approval_sha,''renewalOrdinal'',6,');
  patched:=replace(patched,
    '''schemaVersion'',''videoforge.v2-09-same-attempt-deadline-recovery/v2''',
    '''schemaVersion'',''videoforge.v2-09-same-attempt-deadline-recovery/v3''');
  IF patched=definition
     OR position('videoforge_recover_hosted_v209_same_attempt_deadline_second(' IN patched)=0
     OR position('(SELECT count(*) FROM public.videoforge_schema_migrations)<>100' IN patched)>0
     OR position('(SELECT max(version) FROM public.videoforge_schema_migrations)<>100' IN patched)>0
     OR position('renewal_count<>4 OR previous_renewal.renewal_ordinal<>4' IN patched)>0
     OR position('claim.approval_id<>effective_candidate.approval_id' IN patched)>0
     OR position('mage.attempt_ordinal<>1 OR mage.version<>1' IN patched)>0
     OR position('soulx.attempt_ordinal<>1 OR soulx.version<>1' IN patched)>0
     OR position('renewal_count<>5 OR previous_renewal.renewal_ordinal<>5' IN patched)=0
     OR position('previous_recovery.refreshed_database_observed_at' IN patched)=0
     OR position('renewed_approval_sha,6,mage.id' IN patched)=0
     OR position('videoforge.v2-09-same-attempt-deadline-recovery/v3' IN patched)=0
     OR position('AND row.generation_request_id=request.id)=5' IN patched)>0
     OR position('AND row.generation_request_id=request.id)=6' IN patched)=0
     OR position('renewalOrdinal'',5' IN patched)>0 THEN
    RAISE EXCEPTION 'hosted V2-09 second deadline recovery patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$create_second_deadline_recovery$;

REVOKE ALL ON FUNCTION public.videoforge_recover_hosted_v209_same_attempt_deadline_second(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid,uuid,uuid) FROM PUBLIC;
