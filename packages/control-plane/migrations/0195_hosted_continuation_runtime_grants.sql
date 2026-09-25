-- Restore the tenant-scoped continuation driver's exact runtime grants. Some production
-- ledgers skipped 0162/0163 while keeping their objects, leaving the running Workflow
-- unable to discover accounts or persist heartbeats after prompt acceptance.
GRANT EXECUTE ON FUNCTION public.videoforge_admitted_hosted_account_ids()
  TO videoforge_v209_runtime_dc9612d6;
GRANT SELECT ON TABLE public.memberships, public.hosted_pair_runtime_states
  TO videoforge_v209_runtime_dc9612d6;
GRANT SELECT, INSERT ON TABLE public.hosted_continuation_heartbeats
  TO videoforge_v209_runtime_dc9612d6;
GRANT USAGE ON SEQUENCE public.hosted_continuation_heartbeats_id_seq
  TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_trim_hosted_continuation_heartbeats()
  TO videoforge_v209_runtime_dc9612d6;
