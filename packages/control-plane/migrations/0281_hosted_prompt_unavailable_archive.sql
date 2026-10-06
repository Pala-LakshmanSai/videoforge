-- A verified completed/billed response with a redacted archive is not invalid generated output.
-- Reuse the exact terminal settlement authority; only its disposition and receipt namespace differ.
DO $$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)'::regprocedure);
  IF position('HOSTED_PROMPT_OUTPUT_INVALID' IN definition)=0
     OR position('hosted-prompt-invalid:' IN definition)=0
     OR position('hosted_prompt_invalid_batch' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted prompt terminal adjudication boundary drifted';
  END IF;
  definition:=replace(definition,'videoforge_adjudicate_invalid_hosted_prompt_batch','videoforge_adjudicate_unavailable_hosted_prompt_archive');
  definition:=replace(definition,'HOSTED_PROMPT_OUTPUT_INVALID','HOSTED_PROMPT_ARCHIVE_UNAVAILABLE');
  definition:=replace(definition,'hosted-prompt-invalid:','hosted-prompt-archive-unavailable:');
  definition:=replace(definition,'hosted_prompt_invalid_batch','hosted_prompt_archive_unavailable');
  definition:=replace(definition,'hosted prompt invalid output','hosted prompt unavailable archive');
  EXECUTE definition;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_adjudicate_unavailable_hosted_prompt_archive(uuid,text,text,bigint) FROM PUBLIC;

DO $$
DECLARE principal record;
BEGIN
  FOR principal IN
    SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
      FROM pg_proc proc
      CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
     WHERE proc.oid='public.videoforge_adjudicate_invalid_hosted_prompt_batch(uuid,text,text,bigint)'::regprocedure
       AND acl.privilege_type='EXECUTE' AND acl.grantee<>0 AND acl.grantee<>proc.proowner
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_adjudicate_unavailable_hosted_prompt_archive(uuid,text,text,bigint) TO %I',principal.role_name);
  END LOOP;
END;
$$;
