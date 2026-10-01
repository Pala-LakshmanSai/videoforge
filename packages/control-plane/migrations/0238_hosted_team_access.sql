-- Team managers administer admission only; private tenant content remains fenced.
-- Retain every old code row; only one unused invitation may be active for an email.
ALTER TABLE invite_codes DROP CONSTRAINT invite_codes_intended_normalized_email_key;
CREATE UNIQUE INDEX invite_codes_active_email_key ON invite_codes(intended_normalized_email) WHERE state='ACTIVE';

CREATE TABLE hosted_access_revocations (
  hosted_auth_user_id text PRIMARY KEY REFERENCES hosted_auth_users(id) ON DELETE RESTRICT,
  revoked_by text NOT NULL REFERENCES hosted_auth_users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON hosted_access_revocations FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_hosted_session_scope(session_token text)
RETURNS TABLE (hosted_auth_user_id text, user_id uuid, account_id uuid, workspace_id uuid,
               normalized_email text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT link.hosted_auth_user_id, link.user_id, link.admitted_account_id, link.workspace_id,
         auth_user.email, session.expires_at
    FROM hosted_auth_sessions AS session
    JOIN hosted_auth_users AS auth_user ON auth_user.id = session.user_id
    JOIN hosted_auth_links AS link ON link.hosted_auth_user_id = auth_user.id
   WHERE session.token = session_token AND session.expires_at > now()
     AND auth_user.email_verified
     AND NOT EXISTS (SELECT 1 FROM hosted_access_revocations r WHERE r.hosted_auth_user_id = auth_user.id);
$$;

CREATE OR REPLACE FUNCTION public.videoforge_admit_hosted_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  auth_user hosted_auth_users%ROWTYPE;
BEGIN
  SELECT * INTO auth_user FROM hosted_auth_users WHERE id = NEW.user_id FOR UPDATE;
  IF auth_user.id IS NULL OR auth_user.email_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'hosted session requires a verified identity' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM hosted_access_revocations WHERE hosted_auth_user_id=auth_user.id) THEN
    RAISE EXCEPTION 'hosted access revoked' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM hosted_auth_links WHERE hosted_auth_user_id = auth_user.id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hosted_auth_accounts
     WHERE user_id = auth_user.id AND provider_id = 'google'
  ) THEN
    RAISE EXCEPTION 'hosted identity has no supported Google auth account'
      USING ERRCODE = '42501';
  END IF;

  -- First-login sessions are intentionally authentication-only. Tenant admission is performed by
  -- videoforge_redeem_hosted_invite after the authenticated browser presents the exact verifier.
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_session() FROM PUBLIC;


CREATE FUNCTION public.videoforge_manage_team_access(
  supplied_token text, operation text, target text DEFAULT NULL, verifier text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  actor text;
  target_email text;
  target_user text;
  invite_id uuid;
BEGIN
  SELECT s.hosted_auth_user_id INTO actor FROM videoforge_hosted_session_scope(supplied_token) s
   WHERE lower(btrim(s.normalized_email)) IN ('lakshman121@gmail.com','demo9gss@gmail.com');
  IF actor IS NULL THEN RETURN jsonb_build_object('error','TEAM_ACCESS_FORBIDDEN'); END IF;
  -- Serialize management with sign-in for the target identity. Owners cannot revoke each other.
  IF operation IN ('REVOKE','RESTORE') THEN
    SELECT u.id, lower(btrim(u.email)) INTO target_user, target_email
      FROM hosted_auth_users u JOIN hosted_auth_links l ON l.hosted_auth_user_id=u.id
     WHERE u.id=target FOR UPDATE OF u;
    IF target_user IS NULL THEN RETURN jsonb_build_object('error','TEAM_MEMBER_NOT_FOUND'); END IF;
    IF target_email IN ('lakshman121@gmail.com','demo9gss@gmail.com') THEN
      RETURN jsonb_build_object('error','TEAM_OWNER_PROTECTED');
    END IF;
    IF operation='REVOKE' THEN
      INSERT INTO hosted_access_revocations(hosted_auth_user_id,revoked_by) VALUES(target_user,actor)
        ON CONFLICT(hosted_auth_user_id) DO NOTHING;
      DELETE FROM hosted_auth_sessions WHERE user_id=target_user;
    ELSE
      DELETE FROM hosted_access_revocations WHERE hosted_auth_user_id=target_user;
    END IF;
    RETURN jsonb_build_object('updated',true);
  ELSIF operation='INVITE' THEN
    target_email := lower(btrim(target));
    IF target_email IS NULL OR length(target_email)>320 OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       OR verifier IS NULL OR verifier !~ '^sha256:[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('error','TEAM_INVITE_INVALID');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('team-invite:'||target_email,0));
    -- Redemption locks this same row; old codes keep their retained audit identity.
    PERFORM id FROM invite_codes WHERE intended_normalized_email=target_email AND state='ACTIVE' FOR UPDATE;
    IF EXISTS (SELECT 1 FROM hosted_auth_users u JOIN hosted_auth_links l ON l.hosted_auth_user_id=u.id
               WHERE lower(btrim(u.email))=target_email)
       OR EXISTS (SELECT 1 FROM invite_codes WHERE intended_normalized_email=target_email AND state='CONSUMED') THEN
      RETURN jsonb_build_object('error','TEAM_ALREADY_ADMITTED');
    END IF;
    UPDATE invite_codes SET state='REVOKED',revoked_at=now(),version=version+1
      WHERE intended_normalized_email=target_email AND state='ACTIVE';
    INSERT INTO invite_codes(id,verifier_sha256,intended_normalized_email,state,expires_at,created_at)
      VALUES(gen_random_uuid(),verifier,target_email,'ACTIVE',now()+interval '72 hours',now())
      RETURNING id INTO invite_id;
    RETURN jsonb_build_object('invite_id',invite_id,'expires_at',now()+interval '72 hours');
  ELSIF operation='REVOKE_INVITE' THEN
    UPDATE invite_codes SET state='REVOKED',revoked_at=now(),version=version+1
      WHERE id::text=target AND state='ACTIVE';
    IF NOT FOUND THEN RETURN jsonb_build_object('error','TEAM_INVITE_NOT_ACTIVE'); END IF;
    RETURN jsonb_build_object('updated',true);
  ELSIF operation='LIST' THEN
    RETURN jsonb_build_object(
      'members',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',u.id,'email',u.email,'owner',lower(btrim(u.email)) IN ('lakshman121@gmail.com','demo9gss@gmail.com'),
        'disabled',EXISTS(SELECT 1 FROM hosted_access_revocations r WHERE r.hosted_auth_user_id=u.id)) ORDER BY l.admitted_at,u.id)
        FROM hosted_auth_users u JOIN hosted_auth_links l ON l.hosted_auth_user_id=u.id),'[]'::jsonb),
      'invites',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'email',intended_normalized_email,
        'state',CASE WHEN state='ACTIVE' AND expires_at<=now() THEN 'EXPIRED' ELSE state END,
        'expires_at',expires_at) ORDER BY created_at DESC,id) FROM invite_codes WHERE state!='CONSUMED'),'[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('error','TEAM_OPERATION_INVALID');
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_manage_team_access(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_manage_team_access(text,text,text,text)
  TO videoforge_v209_runtime_dc9612d6;
