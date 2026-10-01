-- Fresh capacity observations share the device heartbeat and its existing tenant isolation.
ALTER TABLE media_worker_devices ADD COLUMN available_disk_bytes bigint
  CHECK (available_disk_bytes >= 0 AND available_disk_bytes <= 9007199254740991);
