-- CP-02 provider-free shared admission and readable global queue audit (DEC_AUTH_001,
-- DEC_TENANCY_001, DEC_QUEUE_002). Raw invite codes are never persisted.

CREATE TABLE invite_codes (
  id uuid PRIMARY KEY,
  verifier_sha256 text NOT NULL UNIQUE CHECK (verifier_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  intended_normalized_email text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('ACTIVE', 'CONSUMED', 'REVOKED')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  CHECK (
    intended_normalized_email = lower(btrim(intended_normalized_email))
    AND length(intended_normalized_email) BETWEEN 3 AND 320
  ),
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'ACTIVE' AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (state = 'CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (state = 'REVOKED' AND consumed_at IS NULL AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE auth_identity_bindings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  normalized_email text NOT NULL,
  auth_method text NOT NULL CHECK (auth_method IN ('EMAIL_PASSWORD', 'GOOGLE')),
  provider_subject_sha256 text NOT NULL UNIQUE CHECK (
    provider_subject_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  email_verified_at timestamptz NOT NULL,
  bound_at timestamptz NOT NULL,
  UNIQUE (user_id),
  UNIQUE (normalized_email),
  CHECK (
    normalized_email = lower(btrim(normalized_email))
    AND length(normalized_email) BETWEEN 3 AND 320
  )
);

CREATE TABLE invite_redemptions (
  id uuid PRIMARY KEY,
  invite_code_id uuid NOT NULL UNIQUE REFERENCES invite_codes (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  normalized_email text NOT NULL UNIQUE,
  auth_method text NOT NULL CHECK (auth_method IN ('EMAIL_PASSWORD', 'GOOGLE')),
  verifier_sha256 text NOT NULL CHECK (verifier_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  redeemed_at timestamptz NOT NULL,
  CHECK (
    normalized_email = lower(btrim(normalized_email))
    AND length(normalized_email) BETWEEN 3 AND 320
  )
);

CREATE TABLE global_queue_audits (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL REFERENCES generation_sessions (id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('ADD', 'MOVE', 'REMOVE')),
  actor_admission_id uuid NOT NULL REFERENCES app_admissions (id) ON DELETE RESTRICT,
  queue_entry_id uuid NOT NULL,
  old_queue_version integer NOT NULL CHECK (old_queue_version >= 0),
  new_queue_version integer NOT NULL CHECK (new_queue_version = old_queue_version + 1),
  old_order uuid[] NOT NULL,
  new_order uuid[] NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (generation_session_id, new_queue_version),
  FOREIGN KEY (generation_session_id, queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT,
  CHECK (cardinality(old_order) <= 1000 AND cardinality(new_order) <= 1000),
  CHECK (array_position(old_order, NULL) IS NULL AND array_position(new_order, NULL) IS NULL)
);

CREATE INDEX global_queue_audits_actor_idx
  ON global_queue_audits (actor_admission_id, occurred_at);

CREATE FUNCTION videoforge_validate_invite_code_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invite_codes is retained audit state' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'ACTIVE'
     OR NEW.id <> OLD.id
     OR NEW.verifier_sha256 <> OLD.verifier_sha256
     OR NEW.intended_normalized_email <> OLD.intended_normalized_email
     OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at
     OR NEW.version <> OLD.version + 1
     OR NEW.state NOT IN ('CONSUMED', 'REVOKED') THEN
    RAISE EXCEPTION 'invite code transition is not an atomic consume or revoke'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invite_codes_transition_guard
  BEFORE UPDATE OR DELETE ON invite_codes
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_invite_code_transition();

CREATE TRIGGER auth_identity_bindings_append_only
  BEFORE UPDATE OR DELETE ON auth_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER invite_redemptions_append_only
  BEFORE UPDATE OR DELETE ON invite_redemptions
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER global_queue_audits_append_only
  BEFORE UPDATE OR DELETE ON global_queue_audits
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
