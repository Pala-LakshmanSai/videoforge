-- Preserve request facts/settings; allow only one trusted no-graphics corrective suffix.
-- Existing bounded replacement/operator-resume and charge/tenant guards stay authoritative.
CREATE FUNCTION public.videoforge_hosted_prompt_content_repair_matches(original jsonb, replacement jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
  SELECT (original-'taskUUID'=replacement-'taskUUID') OR (
    jsonb_typeof(original->'settings')='object' AND jsonb_typeof(replacement->'settings')='object'
    AND jsonb_typeof(original#>'{settings,systemPrompt}')='string'
    AND replacement#>>'{settings,systemPrompt}'=(original#>>'{settings,systemPrompt}')||$repair$
MANDATORY NO GRAPHICS: Do not depict maps, sea charts, compass roses, graphs, diagrams, schematics, blueprints, drawn routes or marked paper in any required scene fact. These are forbidden even as physical props or historical navigation tools, even without readable words. For navigation or dead reckoning, show locally supported sailors, unmarked instruments, stars, ocean or shore instead. For abstract information, show its locally supported physical subject, process or consequence. Never invent writing, graphics or a substitute story event. Recheck literal_subject, action and environment before returning every scene; a forbidden prop rejects the entire batch.$repair$
    AND original-'taskUUID'=jsonb_set(replacement-'taskUUID','{settings,systemPrompt}',original#>'{settings,systemPrompt}')
  );
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_prompt_content_repair_matches(jsonb,jsonb) FROM PUBLIC;

DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure);
  old_text:=$old$(original->0)-'taskUUID'-'messages' IS DISTINCT FROM (replacement->0)-'taskUUID'-'messages'$old$;
  new_text:=$new$NOT coalesce(public.videoforge_hosted_prompt_content_repair_matches((original->0)-'messages',(replacement->0)-'messages'),false)$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt replacement comparison drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
  definition:=pg_get_functiondef('public.videoforge_resume_failed_hosted_prompt_batch(uuid,text,text,bigint,text,text)'::regprocedure);
  old_text:=$old$(next_request->0)-'taskUUID' IS DISTINCT FROM (prior.request_bytes::jsonb->0)-'taskUUID'$old$;
  new_text:=$new$NOT coalesce(public.videoforge_hosted_prompt_content_repair_matches(prior.request_bytes::jsonb->0,next_request->0),false)$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt operator comparison drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;
