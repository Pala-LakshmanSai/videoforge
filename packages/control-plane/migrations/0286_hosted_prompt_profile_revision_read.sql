-- Prompt readers need only the immutable profile identity and revision. Row-level security on
-- execution_profiles continues to bind both columns to the current account.
GRANT SELECT (id, revision) ON TABLE public.execution_profiles
  TO videoforge_v209_runtime_dc9612d6, videoforge_v209_reconciler_dc9612d6;

DO $$
BEGIN
  IF has_table_privilege('videoforge_v209_runtime_dc9612d6', 'public.execution_profiles', 'SELECT')
     OR has_table_privilege('videoforge_v209_reconciler_dc9612d6', 'public.execution_profiles', 'SELECT')
     OR NOT has_column_privilege('videoforge_v209_runtime_dc9612d6', 'public.execution_profiles', 'id', 'SELECT')
     OR NOT has_column_privilege('videoforge_v209_runtime_dc9612d6', 'public.execution_profiles', 'revision', 'SELECT')
     OR NOT has_column_privilege('videoforge_v209_reconciler_dc9612d6', 'public.execution_profiles', 'id', 'SELECT')
     OR NOT has_column_privilege('videoforge_v209_reconciler_dc9612d6', 'public.execution_profiles', 'revision', 'SELECT')
     OR has_column_privilege('videoforge_v209_runtime_dc9612d6', 'public.execution_profiles', 'configuration', 'SELECT')
     OR has_column_privilege('videoforge_v209_runtime_dc9612d6', 'public.execution_profiles', 'account_id', 'SELECT')
     OR has_column_privilege('videoforge_v209_reconciler_dc9612d6', 'public.execution_profiles', 'configuration', 'SELECT')
     OR has_column_privilege('videoforge_v209_reconciler_dc9612d6', 'public.execution_profiles', 'account_id', 'SELECT') THEN
    RAISE EXCEPTION 'hosted prompt profile read grant is broader than identity and revision';
  END IF;
END;
$$;
