-- Preserve personal-worker lineage while allowing an account owner to remove stale registrations
-- from the ordinary Settings list. Re-enrolling the same installation restores its existing row.

ALTER TABLE media_worker_devices
  ADD COLUMN removed_at timestamptz;

CREATE INDEX media_worker_devices_visible_idx
  ON media_worker_devices (account_id, workspace_id, created_at)
  WHERE removed_at IS NULL;
