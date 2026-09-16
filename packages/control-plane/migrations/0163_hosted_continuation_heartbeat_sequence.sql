-- 0163_hosted_continuation_heartbeat_sequence.sql
--
-- The sweep heartbeat insert failed with `permission denied for sequence
-- hosted_continuation_heartbeats_id_seq` even after 0162 granted the table privileges: a bigserial
-- column needs USAGE on its sequence as well. Because the insert is deliberately best-effort the
-- failure was invisible, which is exactly the observability the heartbeat exists to provide.
GRANT USAGE ON SEQUENCE public.hosted_continuation_heartbeats_id_seq
  TO videoforge_v209_runtime_dc9612d6;
