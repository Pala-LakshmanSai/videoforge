-- A Google login proves identity only. It must not require an already-known email invite before
-- Better Auth can create the authentication-only session that the invite-code screen needs.
-- Tenant scope remains unavailable until videoforge_redeem_hosted_invite creates the durable link.

DROP TRIGGER IF EXISTS hosted_auth_users_invite_gate ON public.hosted_auth_users;
DROP FUNCTION IF EXISTS public.videoforge_require_hosted_invite();
