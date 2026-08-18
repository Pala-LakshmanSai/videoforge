-- V2-06 source repair: make the hosted identity and personal-worker retry bounds
-- executable in the database, not only in the Better Auth and Worker callers.

ALTER TABLE hosted_auth_accounts
  ADD CONSTRAINT hosted_auth_accounts_google_only_check
  CHECK (provider_id = 'google');

CREATE OR REPLACE FUNCTION public.videoforge_admit_hosted_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  auth_user hosted_auth_users%ROWTYPE;
  invite invite_codes%ROWTYPE;
  auth_method text;
  vf_user_id uuid;
  vf_admission_id uuid;
  vf_account_id uuid;
  vf_workspace_id uuid;
  vf_membership_id uuid;
  vf_binding_id uuid;
  vf_redemption_id uuid;
BEGIN
  SELECT * INTO auth_user FROM hosted_auth_users WHERE id = NEW.user_id FOR UPDATE;
  IF auth_user.id IS NULL OR auth_user.email_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'hosted session requires a verified identity' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM hosted_auth_links WHERE hosted_auth_user_id = auth_user.id) THEN
    RETURN NEW;
  END IF;

  SELECT CASE WHEN bool_or(provider_id = 'google') THEN 'GOOGLE' ELSE NULL END
    INTO auth_method
    FROM hosted_auth_accounts
   WHERE user_id = auth_user.id;
  IF auth_method IS NULL THEN
    RAISE EXCEPTION 'hosted identity has no supported Google auth account' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO invite
    FROM invite_codes
   WHERE intended_normalized_email = auth_user.email
     AND state = 'ACTIVE'
     AND expires_at > now()
   FOR UPDATE;
  IF invite.id IS NULL THEN
    RAISE EXCEPTION 'hosted invite is unavailable' USING ERRCODE = '42501';
  END IF;

  vf_user_id := md5('hosted-user:' || auth_user.id)::uuid;
  vf_admission_id := md5('hosted-admission:' || auth_user.id)::uuid;
  vf_account_id := md5('hosted-account:' || auth_user.id)::uuid;
  vf_workspace_id := md5('hosted-workspace:' || auth_user.id)::uuid;
  vf_membership_id := md5('hosted-membership:' || auth_user.id)::uuid;
  vf_binding_id := md5('hosted-binding:' || auth_user.id)::uuid;
  vf_redemption_id := md5('hosted-redemption:' || auth_user.id)::uuid;

  INSERT INTO users (id, email, normalized_email, display_name, status)
  VALUES (vf_user_id, auth_user.email, auth_user.email, auth_user.name, 'ACTIVE');
  INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
  VALUES (vf_account_id, 'USER', vf_user_id, auth_user.email, 'ACTIVE');
  PERFORM set_config('videoforge.account_id', vf_account_id::text, true);

  UPDATE invite_codes
     SET state = 'CONSUMED', consumed_at = now(), version = version + 1
   WHERE id = invite.id AND state = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted invite was consumed concurrently' USING ERRCODE = '40001';
  END IF;

  INSERT INTO invite_redemptions (
    id, invite_code_id, user_id, normalized_email, auth_method, verifier_sha256, redeemed_at,
    account_id
  ) VALUES (
    vf_redemption_id, invite.id, vf_user_id, auth_user.email, auth_method,
    invite.verifier_sha256, now(), vf_account_id
  );
  INSERT INTO app_admissions (
    id, user_id, normalized_email, email_verified_at, invite_redemption_id, auth_methods,
    status, version, admitted_at, account_id
  ) VALUES (
    vf_admission_id, vf_user_id, auth_user.email, now(), vf_redemption_id, ARRAY[auth_method],
    'ADMITTED', 1, now(), vf_account_id
  );
  INSERT INTO auth_identity_bindings (
    id, user_id, normalized_email, auth_method, provider_subject_sha256, email_verified_at,
    bound_at, account_id
  ) VALUES (
    vf_binding_id, vf_user_id, auth_user.email, auth_method,
    'sha256:' || md5(auth_method || ':' || auth_user.id) || md5(auth_user.id || ':' || auth_method),
    now(), now(), vf_account_id
  );
  INSERT INTO workspaces (
    id, name, normalized_name, status, account_id, is_default
  ) VALUES (
    vf_workspace_id, 'My workspace', 'my workspace', 'ACTIVE', vf_account_id, true
  );
  INSERT INTO memberships (
    id, workspace_id, account_id, user_id, normalized_name, role, status, version
  ) VALUES (
    vf_membership_id, vf_workspace_id, vf_account_id, vf_user_id, 'owner', 'ADMIN', 'ACTIVE', 1
  );
  INSERT INTO hosted_auth_links (
    hosted_auth_user_id, user_id, admitted_account_id, workspace_id, admission_id, admitted_at
  ) VALUES (
    auth_user.id, vf_user_id, vf_account_id, vf_workspace_id, vf_admission_id, now()
  );
  RETURN NEW;
END;
$$;
