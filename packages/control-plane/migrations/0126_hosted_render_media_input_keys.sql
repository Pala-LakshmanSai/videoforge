-- Render inputs include accepted GPU lanes and the pinned Avatar Hub source.
-- The scheduling boundary still resolves every input through its exact committed receipt.
ALTER TABLE public.media_worker_input_objects
  DROP CONSTRAINT media_worker_input_objects_object_key_check;
ALTER TABLE public.media_worker_input_objects
  ADD CONSTRAINT media_worker_input_objects_object_key_check CHECK (
    object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|mage-image|soulx-avatar|render)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
    OR object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/avatar-profile/[A-Za-z0-9._:-]+/version/[A-Za-z0-9._:-]+/(canonical/avatar\.(png|jpg)|original/source)$'
  );
