-- DEC_AUTH_001 repair: a verified Google identity is necessary but no longer sufficient for
-- first admission. The browser must present the exact one-time verifier; only its SHA-256 reaches
-- PostgreSQL. Existing admitted identities keep ordinary returning-login behavior.

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

CREATE FUNCTION public.videoforge_redeem_hosted_invite(
  supplied_session_token text,
  supplied_verifier_sha256 text
) RETURNS TABLE (outcome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  auth_user hosted_auth_users%ROWTYPE;
  auth_account hosted_auth_accounts%ROWTYPE;
  invite invite_codes%ROWTYPE;
  vf_user_id uuid;
  vf_admission_id uuid;
  vf_account_id uuid;
  vf_workspace_id uuid;
  vf_membership_id uuid;
  vf_binding_id uuid;
  vf_redemption_id uuid;
BEGIN
  IF supplied_verifier_sha256 IS NULL
     OR supplied_verifier_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'INVITE_INVALID'::text;
    RETURN;
  END IF;

  SELECT candidate.* INTO auth_user
    FROM hosted_auth_sessions AS session
    JOIN hosted_auth_users AS candidate ON candidate.id = session.user_id
   WHERE session.token = supplied_session_token
     AND session.expires_at > now()
   FOR UPDATE OF candidate;
  IF auth_user.id IS NULL THEN
    RETURN QUERY SELECT 'AUTHENTICATION_REQUIRED'::text;
    RETURN;
  END IF;
  IF auth_user.email_verified IS NOT TRUE THEN
    RETURN QUERY SELECT 'EMAIL_VERIFICATION_REQUIRED'::text;
    RETURN;
  END IF;

  SELECT account.* INTO auth_account
    FROM hosted_auth_accounts AS account
   WHERE account.user_id = auth_user.id AND account.provider_id = 'google';
  IF auth_account.id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_METHOD_UNSUPPORTED'::text;
    RETURN;
  END IF;

  -- The user row lock serializes two sessions for the same Google identity. A contender that
  -- arrives after the winning transaction sees the durable link and performs no second consume.
  IF EXISTS (SELECT 1 FROM hosted_auth_links WHERE hosted_auth_user_id = auth_user.id) THEN
    RETURN QUERY SELECT 'RETURNING'::text;
    RETURN;
  END IF;

  SELECT * INTO invite
    FROM invite_codes
   WHERE verifier_sha256 = supplied_verifier_sha256
   FOR UPDATE;
  IF invite.id IS NULL THEN
    RETURN QUERY SELECT 'INVITE_INVALID'::text;
    RETURN;
  END IF;
  IF invite.state = 'CONSUMED' THEN
    RETURN QUERY SELECT 'INVITE_ALREADY_USED'::text;
    RETURN;
  END IF;
  IF invite.state = 'REVOKED' THEN
    RETURN QUERY SELECT 'INVITE_REVOKED'::text;
    RETURN;
  END IF;
  IF invite.expires_at <= now() THEN
    RETURN QUERY SELECT 'INVITE_EXPIRED'::text;
    RETURN;
  END IF;
  IF invite.intended_normalized_email <> auth_user.email THEN
    RETURN QUERY SELECT 'INVITE_EMAIL_MISMATCH'::text;
    RETURN;
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
    vf_redemption_id, invite.id, vf_user_id, auth_user.email, 'GOOGLE',
    supplied_verifier_sha256, now(), vf_account_id
  );
  INSERT INTO app_admissions (
    id, user_id, normalized_email, email_verified_at, invite_redemption_id, auth_methods,
    status, version, admitted_at, account_id
  ) VALUES (
    vf_admission_id, vf_user_id, auth_user.email, now(), vf_redemption_id, ARRAY['GOOGLE'],
    'ADMITTED', 1, now(), vf_account_id
  );
  INSERT INTO auth_identity_bindings (
    id, user_id, normalized_email, auth_method, provider_subject_sha256, email_verified_at,
    bound_at, account_id
  ) VALUES (
    vf_binding_id, vf_user_id, auth_user.email, 'GOOGLE',
    'sha256:' || encode(sha256(convert_to(
      'google:' || auth_account.provider_account_id, 'UTF8'
    )), 'hex'),
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

  RETURN QUERY SELECT 'ADMITTED'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_redeem_hosted_invite(text, text) FROM PUBLIC;
