-- V2-01 tenant-private identity and data cutover (DEC_TENANCY_002, DEC_AUTH_001, DEC_DB_001).
-- Additive PostgreSQL only. Migrations 0001-0017 keep their committed bytes.
--
-- Ownership model:
--   * every authenticated identity owns exactly one `accounts` row and one default workspace;
--   * every user-owned relational row carries `account_id`, joined to `workspaces (account_id, id)`
--     so an application bug cannot represent a cross-tenant row at all;
--   * pre-V2 rows are adopted by the reserved LEGACY account, which no identity can ever bind to;
--   * only explicit `scope_kind = 'SYSTEM'` preset records are globally readable, and they are
--     immutable once written.

-- This migration alters tables that earlier migrations in the same transaction have written to, so
-- any deferred constraint events must be flushed before the first ALTER TABLE.
SET CONSTRAINTS ALL IMMEDIATE;

-- ---------------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  scope_kind text NOT NULL CHECK (scope_kind IN ('USER', 'SYSTEM', 'LEGACY')),
  owner_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  normalized_email text,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED', 'NON_LOGIN')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id),
  UNIQUE (normalized_email),
  -- Only a USER account has an authenticable identity; SYSTEM and LEGACY never do.
  CHECK ((scope_kind = 'USER') = (owner_user_id IS NOT NULL)),
  CHECK ((scope_kind = 'USER') = (normalized_email IS NOT NULL)),
  CHECK ((scope_kind = 'USER') OR status = 'NON_LOGIN'),
  CHECK ((scope_kind <> 'USER') OR status IN ('ACTIVE', 'DISABLED')),
  CHECK (
    normalized_email IS NULL
    OR (
      normalized_email = lower(btrim(normalized_email))
      AND length(normalized_email) BETWEEN 3 AND 320
    )
  )
);

CREATE UNIQUE INDEX accounts_one_system_uq ON accounts (scope_kind) WHERE scope_kind = 'SYSTEM';
CREATE UNIQUE INDEX accounts_one_legacy_uq ON accounts (scope_kind) WHERE scope_kind = 'LEGACY';

INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
VALUES
  ('ffffffff-ffff-4fff-8fff-000000000001', 'SYSTEM', NULL, NULL, 'NON_LOGIN'),
  ('ffffffff-ffff-4fff-8fff-000000000002', 'LEGACY', NULL, NULL, 'NON_LOGIN');

-- ---------------------------------------------------------------------------
-- 2. Workspaces gain their owning account and the single-default-workspace rule
-- ---------------------------------------------------------------------------

ALTER TABLE workspaces ADD COLUMN account_id uuid;
ALTER TABLE workspaces ADD COLUMN is_default boolean NOT NULL DEFAULT false;

-- Every pre-V2 workspace is adopted by the inaccessible LEGACY account.
UPDATE workspaces SET account_id = 'ffffffff-ffff-4fff-8fff-000000000002' WHERE account_id IS NULL;

ALTER TABLE workspaces ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_account_fk
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_account_scope_uq UNIQUE (account_id, id);

CREATE UNIQUE INDEX workspaces_one_default_uq
  ON workspaces (account_id)
  WHERE is_default AND status = 'ACTIVE';

INSERT INTO workspaces (id, name, normalized_name, status, account_id, is_default)
VALUES
  (
    'ffffffff-ffff-4fff-8fff-000000000011',
    'VideoForge system scope',
    'videoforge system scope',
    'ACTIVE',
    'ffffffff-ffff-4fff-8fff-000000000001',
    true
  ),
  (
    'ffffffff-ffff-4fff-8fff-000000000012',
    'VideoForge legacy scope',
    'videoforge legacy scope',
    'ACTIVE',
    'ffffffff-ffff-4fff-8fff-000000000002',
    true
  );

-- Built-in presets need an author inside the system workspace. This reserved user owns no account,
-- so no login can ever resolve to it and it grants no access anywhere.
INSERT INTO users (id, email, normalized_email, display_name, status)
VALUES (
  'ffffffff-ffff-4fff-8fff-000000000021',
  'system@videoforge.invalid',
  'system@videoforge.invalid',
  'VideoForge built-in catalog',
  'DISABLED'
);

INSERT INTO memberships (id, workspace_id, user_id, normalized_name, role, status, version)
VALUES (
  'ffffffff-ffff-4fff-8fff-000000000031',
  'ffffffff-ffff-4fff-8fff-000000000011',
  'ffffffff-ffff-4fff-8fff-000000000021',
  'videoforge built-in catalog',
  'ADMIN',
  'ACTIVE',
  1
);

-- ---------------------------------------------------------------------------
-- 3. Every workspace-owned table gains its immutable account column
-- ---------------------------------------------------------------------------

DO $tenant$
DECLARE
  target text;
  has_id boolean;
  tenant_tables text[] := ARRAY[
    'assets',
    'attempts',
    'avatar_compatibility_assessments',
    'avatar_generation_acceptances',
    'avatar_profile_assets',
    'avatar_profile_test_attempts',
    'avatar_profile_versions',
    'avatar_profiles',
    'avatar_renderer_bindings',
    'callback_receipts',
    'cost_events',
    'execution_profiles',
    'generation_tasks',
    'image_generation_acceptances',
    'image_style_analysis_attempts',
    'image_style_previews',
    'image_style_profile_artifacts',
    'image_style_profile_edits',
    'image_style_references',
    'image_style_versions',
    'image_styles',
    'memberships',
    'outbox',
    'project_inputs',
    'project_revisions',
    'projects',
    'prompt_executions',
    'prompt_scene_results',
    'prompt_writer_attempts',
    'qa_results',
    'render_jobs',
    'repository_mutation_receipts',
    'revision_timing_heads',
    'selected_span_audio',
    'timeline_plans',
    'timeline_segments',
    'timing_invalidations',
    'transcript_phrases',
    'transcript_sentences',
    'transcript_words',
    'transcripts',
    'workflow_events',
    'workflow_instances'
  ];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN account_id uuid', target);

    -- Append-only and immutability triggers guard product writes, not this structural backfill.
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', target);
    EXECUTE format(
      'UPDATE public.%I AS owned
          SET account_id = scope.account_id
         FROM public.workspaces AS scope
        WHERE scope.id = owned.workspace_id',
      target
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', target);

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN account_id SET NOT NULL', target);
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD CONSTRAINT %I FOREIGN KEY (account_id, workspace_id)
         REFERENCES public.workspaces (account_id, id) ON DELETE RESTRICT',
      target,
      target || '_tenant_scope_fk'
    );

    SELECT EXISTS (
      SELECT 1
        FROM pg_attribute attribute
       WHERE attribute.attrelid = format('public.%I', target)::regclass
         AND attribute.attname = 'id'
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
    ) INTO has_id;

    IF has_id THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (account_id, workspace_id, id)',
        target,
        target || '_tenant_identity_uq'
      );
    END IF;
  END LOOP;
END
$tenant$;

-- ---------------------------------------------------------------------------
-- 4. Built-in versus user-created preset scope
-- ---------------------------------------------------------------------------

ALTER TABLE avatar_profiles
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'WORKSPACE'
  CHECK (scope_kind IN ('WORKSPACE', 'SYSTEM'));
ALTER TABLE image_styles
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'WORKSPACE'
  CHECK (scope_kind IN ('WORKSPACE', 'SYSTEM'));

-- A globally readable record may exist only inside the reserved SYSTEM account.
ALTER TABLE avatar_profiles
  ADD CONSTRAINT avatar_profiles_system_scope_ck
  CHECK (scope_kind = 'WORKSPACE' OR account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid);
ALTER TABLE image_styles
  ADD CONSTRAINT image_styles_system_scope_ck
  CHECK (scope_kind = 'WORKSPACE' OR account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid);

ALTER TABLE avatar_profiles
  ADD CONSTRAINT avatar_profiles_scope_uq UNIQUE (account_id, workspace_id, id, scope_kind);
ALTER TABLE image_styles
  ADD CONSTRAINT image_styles_scope_uq UNIQUE (account_id, workspace_id, id, scope_kind);

-- A version cannot disagree with its profile about global readability.
ALTER TABLE avatar_profile_versions
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'WORKSPACE'
  CHECK (scope_kind IN ('WORKSPACE', 'SYSTEM'));
ALTER TABLE image_style_versions
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'WORKSPACE'
  CHECK (scope_kind IN ('WORKSPACE', 'SYSTEM'));

ALTER TABLE avatar_profile_versions
  ADD CONSTRAINT avatar_profile_versions_scope_fk
  FOREIGN KEY (account_id, workspace_id, profile_id, scope_kind)
  REFERENCES avatar_profiles (account_id, workspace_id, id, scope_kind) ON DELETE RESTRICT;
ALTER TABLE image_style_versions
  ADD CONSTRAINT image_style_versions_scope_fk
  FOREIGN KEY (account_id, workspace_id, style_id, scope_kind)
  REFERENCES image_styles (account_id, workspace_id, id, scope_kind) ON DELETE RESTRICT;

CREATE FUNCTION public.videoforge_system_scope_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.scope_kind = 'SYSTEM' THEN
      RAISE EXCEPTION 'built-in % records are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.scope_kind = 'SYSTEM' OR NEW.scope_kind = 'SYSTEM' THEN
    RAISE EXCEPTION 'built-in % records are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER avatar_profiles_system_immutable
  BEFORE UPDATE OR DELETE ON avatar_profiles
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_system_scope_immutable();
CREATE TRIGGER image_styles_system_immutable
  BEFORE UPDATE OR DELETE ON image_styles
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_system_scope_immutable();
CREATE TRIGGER avatar_profile_versions_system_immutable
  BEFORE UPDATE OR DELETE ON avatar_profile_versions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_system_scope_immutable();
CREATE TRIGGER image_style_versions_system_immutable
  BEFORE UPDATE OR DELETE ON image_style_versions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_system_scope_immutable();

-- ---------------------------------------------------------------------------
-- 5. Queue, dispatch, output, cost, and audit rows become tenant-owned
-- ---------------------------------------------------------------------------

ALTER TABLE global_queue_entries ADD COLUMN account_id uuid;
ALTER TABLE global_queue_entries ADD COLUMN workspace_id uuid;

UPDATE global_queue_entries AS entry
   SET account_id = revision.account_id,
       workspace_id = revision.workspace_id
  FROM project_revisions AS revision
 WHERE revision.id = entry.project_revision_id;

ALTER TABLE global_queue_entries ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE global_queue_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE global_queue_entries
  ADD CONSTRAINT global_queue_entries_tenant_scope_fk
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT;
ALTER TABLE global_queue_entries
  ADD CONSTRAINT global_queue_entries_revision_tenant_fk
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
  REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE global_queue_entries
  ADD CONSTRAINT global_queue_entries_tenant_identity_uq
  UNIQUE (account_id, workspace_id, generation_session_id, id);

DO $queue$
DECLARE
  target text;
  entry_column text;
  position integer;
  -- Every one of these roots at exactly one queue entry, so it inherits that entry's tenant.
  queue_children text[] := ARRAY[
    'compute_run_plans',
    'pod_lifecycle_attempts',
    'pod_dispatch_authorizations',
    'durable_generation_outputs',
    'global_queue_audits',
    'global_session_cost_events',
    'global_session_events'
  ];
  entry_columns text[] := ARRAY[
    'queue_entry_id',
    'origin_queue_entry_id',
    'queue_entry_id',
    'queue_entry_id',
    'queue_entry_id',
    'queue_entry_id',
    'queue_entry_id'
  ];
BEGIN
  FOR position IN 1 .. array_length(queue_children, 1) LOOP
    target := queue_children[position];
    entry_column := entry_columns[position];
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN account_id uuid', target);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN workspace_id uuid', target);

    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', target);
    EXECUTE format(
      'UPDATE public.%I AS owned
          SET account_id = entry.account_id,
              workspace_id = entry.workspace_id
         FROM public.global_queue_entries AS entry
        WHERE entry.generation_session_id = owned.generation_session_id
          AND entry.id = owned.%I',
      target,
      entry_column
    );
    -- Session-level cost and event rows carry no queue entry; they are shared capacity facts.
    EXECUTE format(
      'UPDATE public.%I
          SET account_id = ''ffffffff-ffff-4fff-8fff-000000000001''::uuid,
              workspace_id = ''ffffffff-ffff-4fff-8fff-000000000011''::uuid
        WHERE account_id IS NULL',
      target
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', target);

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN account_id SET NOT NULL', target);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL', target);
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD CONSTRAINT %I FOREIGN KEY (account_id, workspace_id)
         REFERENCES public.workspaces (account_id, id) ON DELETE RESTRICT',
      target,
      target || '_tenant_scope_fk'
    );
    -- MATCH SIMPLE: the join is enforced for every row that names a queue entry.
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD CONSTRAINT %I
         FOREIGN KEY (account_id, workspace_id, generation_session_id, %I)
         REFERENCES public.global_queue_entries
           (account_id, workspace_id, generation_session_id, id) ON DELETE RESTRICT',
      target,
      target || '_queue_tenant_fk',
      entry_column
    );
  END LOOP;
END
$queue$;

ALTER TABLE global_session_cost_events
  ADD CONSTRAINT global_session_cost_events_session_scope_ck
  CHECK (
    queue_entry_id IS NOT NULL
    OR account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
  );
ALTER TABLE global_session_events
  ADD CONSTRAINT global_session_events_session_scope_ck
  CHECK (
    queue_entry_id IS NOT NULL
    OR account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
  );

-- ---------------------------------------------------------------------------
-- 6. Identity binds to exactly one account and one default workspace
-- ---------------------------------------------------------------------------

-- Pre-V2 admissions receive a fresh empty account. Legacy rows stay in the LEGACY scope, so an
-- upgraded installation never hands historical data to an authenticated identity.
INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
SELECT md5(admission.id::text || ':videoforge-account')::uuid,
       'USER',
       admission.user_id,
       admission.normalized_email,
       'ACTIVE'
  FROM app_admissions AS admission
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts AS existing WHERE existing.owner_user_id = admission.user_id
 );

INSERT INTO workspaces (id, name, normalized_name, status, account_id, is_default)
SELECT md5(admission.id::text || ':videoforge-workspace')::uuid,
       'Workspace ' || left(replace(admission.id::text, '-', ''), 12),
       'workspace ' || left(replace(admission.id::text, '-', ''), 12),
       'ACTIVE',
       md5(admission.id::text || ':videoforge-account')::uuid,
       true
  FROM app_admissions AS admission
 WHERE NOT EXISTS (
   SELECT 1
     FROM workspaces AS existing
    WHERE existing.account_id = md5(admission.id::text || ':videoforge-account')::uuid
 );

INSERT INTO memberships (
  id, workspace_id, account_id, user_id, normalized_name, role, status, version
)
SELECT md5(admission.id::text || ':videoforge-membership')::uuid,
       md5(admission.id::text || ':videoforge-workspace')::uuid,
       md5(admission.id::text || ':videoforge-account')::uuid,
       admission.user_id,
       'owner ' || left(replace(admission.id::text, '-', ''), 12),
       'ADMIN',
       'ACTIVE',
       1
  FROM app_admissions AS admission
 WHERE NOT EXISTS (
   SELECT 1
     FROM memberships AS existing
    WHERE existing.workspace_id = md5(admission.id::text || ':videoforge-workspace')::uuid
 );

DO $identity$
DECLARE
  target text;
  identity_tables text[] := ARRAY[
    'app_admissions',
    'auth_identity_bindings',
    'invite_redemptions'
  ];
BEGIN
  FOREACH target IN ARRAY identity_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN account_id uuid', target);
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', target);
    EXECUTE format(
      'UPDATE public.%I AS bound
          SET account_id = account.id
         FROM public.accounts AS account
        WHERE account.owner_user_id = bound.user_id',
      target
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', target);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN account_id SET NOT NULL', target);
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD CONSTRAINT %I FOREIGN KEY (account_id)
         REFERENCES public.accounts (id) ON DELETE RESTRICT',
      target,
      target || '_account_fk'
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (account_id)',
      target,
      target || '_account_uq'
    );
  END LOOP;
END
$identity$;

-- ---------------------------------------------------------------------------
-- 7. Shared infrastructure records declare their system scope explicitly
-- ---------------------------------------------------------------------------

DO $system$
DECLARE
  target text;
  system_tables text[] := ARRAY[
    'invite_codes',
    'model_volumes',
    'model_volume_manifests',
    'gpu_inventory_receipts',
    'generation_sessions',
    'session_gpu_bindings',
    'session_gpu_revalidations',
    'lane_demands'
  ];
BEGIN
  FOREACH target IN ARRAY system_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN scope_kind text NOT NULL DEFAULT ''SYSTEM''
         CHECK (scope_kind = ''SYSTEM'')',
      target
    );
  END LOOP;
END
$system$;

-- ---------------------------------------------------------------------------
-- 8. RLS-equivalent guards
-- ---------------------------------------------------------------------------
--
-- `videoforge.account_id` is set from the trusted server principal at the start of every
-- application transaction. The write trigger rejects any statement whose row disagrees with that
-- principal, and the tenant views hide every row outside it. Both mechanisms are enforced for the
-- table owner, so they hold in the PGlite contract tests. The RLS policies below are the production
-- boundary for the non-superuser application role on Neon; a superuser connection bypasses them.

CREATE FUNCTION public.videoforge_current_account_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('videoforge.account_id', true), '')::uuid;
$$;

-- Ownership is derived from the already-authorized parent row, never accepted from the caller, so
-- a supplied `account_id` cannot grant access even if it reaches the database.
CREATE FUNCTION public.videoforge_derive_workspace_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  derived uuid;
BEGIN
  SELECT scope.account_id INTO derived
    FROM public.workspaces AS scope
   WHERE scope.id = NEW.workspace_id;

  IF derived IS NULL THEN
    RAISE EXCEPTION 'workspace % has no owning account', NEW.workspace_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM derived THEN
    RAISE EXCEPTION 'account ownership of % is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;

  NEW.account_id := derived;
  RETURN NEW;
END;
$$;

-- Queue entries inherit the tenant of the immutable project revision they froze.
CREATE FUNCTION public.videoforge_derive_revision_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  derived_account uuid;
  derived_workspace uuid;
BEGIN
  SELECT revision.account_id, revision.workspace_id
    INTO derived_account, derived_workspace
    FROM public.project_revisions AS revision
   WHERE revision.id = NEW.project_revision_id;

  IF derived_account IS NULL THEN
    RAISE EXCEPTION 'project revision % has no owning account', NEW.project_revision_id
      USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM derived_account THEN
    RAISE EXCEPTION 'account ownership of % is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;

  NEW.account_id := derived_account;
  NEW.workspace_id := derived_workspace;
  RETURN NEW;
END;
$$;

-- Dispatch, output, cost, event, and audit rows inherit the tenant of their queue entry. A row that
-- names no queue entry is a shared session fact and stays in the SYSTEM scope.
CREATE FUNCTION public.videoforge_derive_queue_entry_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_id uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  derived_account uuid;
  derived_workspace uuid;
BEGIN
  IF entry_id IS NULL THEN
    NEW.account_id := 'ffffffff-ffff-4fff-8fff-000000000001'::uuid;
    NEW.workspace_id := 'ffffffff-ffff-4fff-8fff-000000000011'::uuid;
    RETURN NEW;
  END IF;

  SELECT entry.account_id, entry.workspace_id
    INTO derived_account, derived_workspace
    FROM public.global_queue_entries AS entry
   WHERE entry.generation_session_id = NEW.generation_session_id
     AND entry.id = entry_id;

  IF derived_account IS NULL THEN
    RAISE EXCEPTION 'queue entry % has no owning account', entry_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM derived_account THEN
    RAISE EXCEPTION 'account ownership of % is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;

  NEW.account_id := derived_account;
  NEW.workspace_id := derived_workspace;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.videoforge_assert_tenant_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  principal uuid := public.videoforge_current_account_id();
  owner uuid := (to_jsonb(NEW) ->> 'account_id')::uuid;
BEGIN
  IF principal IS NOT NULL AND owner IS DISTINCT FROM principal THEN
    RAISE EXCEPTION 'cross-tenant write to % rejected', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger names are ordered so derivation always runs before the principal check.
DO $guard$
DECLARE
  target text;
  entry_column text;
BEGIN
  FOR target IN
    SELECT relation.relname
      FROM pg_class AS relation
      JOIN pg_namespace AS space ON space.oid = relation.relnamespace
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attname = 'account_id'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     WHERE space.nspname = 'public'
       AND relation.relkind = 'r'
       AND relation.relname <> 'accounts'
     ORDER BY relation.relname
  LOOP
    IF target = 'global_queue_entries' THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account()',
        target || '_tenant_account_derived',
        target
      );
    ELSIF target IN (
      'compute_run_plans', 'pod_lifecycle_attempts', 'pod_dispatch_authorizations',
      'durable_generation_outputs', 'global_queue_audits', 'global_session_cost_events',
      'global_session_events'
    ) THEN
      entry_column := CASE
        WHEN target = 'pod_lifecycle_attempts' THEN 'origin_queue_entry_id'
        ELSE 'queue_entry_id'
      END;
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_queue_entry_account(%L)',
        target || '_tenant_account_derived',
        target,
        entry_column
      );
    ELSIF target IN (
      'workspaces', 'app_admissions', 'auth_identity_bindings', 'invite_redemptions'
    ) THEN
      -- A workspace and an identity row name their account directly. There is no prior authorized
      -- parent to derive it from, so the principal check below is the only ownership authority.
      NULL;
    ELSE
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account()',
        target || '_tenant_account_derived',
        target
      );
    END IF;

    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write()',
      target || '_tenant_write_guard',
      target
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING (account_id = public.videoforge_current_account_id())
         WITH CHECK (account_id = public.videoforge_current_account_id())',
      target || '_tenant_rls',
      target
    );
  END LOOP;
END
$guard$;

-- Built-in presets stay readable to every principal; user-created rows never are.
CREATE POLICY avatar_profiles_builtin_read_rls ON public.avatar_profiles
  FOR SELECT USING (scope_kind = 'SYSTEM');
CREATE POLICY image_styles_builtin_read_rls ON public.image_styles
  FOR SELECT USING (scope_kind = 'SYSTEM');
CREATE POLICY avatar_profile_versions_builtin_read_rls ON public.avatar_profile_versions
  FOR SELECT USING (scope_kind = 'SYSTEM');
CREATE POLICY image_style_versions_builtin_read_rls ON public.image_style_versions
  FOR SELECT USING (scope_kind = 'SYSTEM');

-- ---------------------------------------------------------------------------
-- 9. Tenant read views
-- ---------------------------------------------------------------------------

DO $views$
DECLARE
  target text;
  private_views text[] := ARRAY[
    'assets',
    'attempts',
    'cost_events',
    'durable_generation_outputs',
    'generation_tasks',
    'global_queue_audits',
    'global_queue_entries',
    'global_session_cost_events',
    'global_session_events',
    'project_inputs',
    'project_revisions',
    'projects',
    'qa_results',
    'render_jobs',
    'workflow_events',
    'workflow_instances'
  ];
BEGIN
  FOREACH target IN ARRAY private_views LOOP
    EXECUTE format(
      'CREATE VIEW public.%I WITH (security_barrier) AS
         SELECT * FROM public.%I
          WHERE account_id = public.videoforge_current_account_id()',
      'videoforge_tenant_' || target,
      target
    );
  END LOOP;
END
$views$;

-- Preset surfaces additionally expose the immutable global built-ins.
CREATE VIEW public.videoforge_tenant_avatar_profiles WITH (security_barrier) AS
  SELECT * FROM public.avatar_profiles
   WHERE account_id = public.videoforge_current_account_id()
      OR scope_kind = 'SYSTEM';
CREATE VIEW public.videoforge_tenant_avatar_profile_versions WITH (security_barrier) AS
  SELECT * FROM public.avatar_profile_versions
   WHERE account_id = public.videoforge_current_account_id()
      OR scope_kind = 'SYSTEM';
CREATE VIEW public.videoforge_tenant_image_styles WITH (security_barrier) AS
  SELECT * FROM public.image_styles
   WHERE account_id = public.videoforge_current_account_id()
      OR scope_kind = 'SYSTEM';
CREATE VIEW public.videoforge_tenant_image_style_versions WITH (security_barrier) AS
  SELECT * FROM public.image_style_versions
   WHERE account_id = public.videoforge_current_account_id()
      OR scope_kind = 'SYSTEM';
