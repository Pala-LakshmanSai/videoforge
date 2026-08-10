# VF-1-04 private artifact storage adapter

Status: technically verified; VF-1-04 complete

Commit `5775c4714917e95745221ddac6e259f8cbf291a2` adds a local R2-compatible private
artifact adapter with separate metadata-only control-plane and byte-carrying direct-transfer
facets. Multipart initiate, part, complete, abort, download, expiry, retry, retention, checksum,
size, workspace prefix, owner scope, and structural media signatures fail closed.

Parts spool to private disk, and completion assembles and hashes them with a fixed 1 MiB buffer.
Accepted artifacts publish atomically with exact intent/fingerprint metadata. A durable
workspace/idempotency-key binding plus per-key filesystem lock produces exactly one winner across
concurrent store instances; conflicting intents fail, reopen remains healthy, and abort or invalid
media creates no false binding. Private acceptance never populates the legacy global CAS.

The isolated Hono router receives only `ArtifactControlPlanePort` and a body-free authorization
input. It rejects media before body access, bounds JSON metadata, rejects ambiguous framing,
requires exact workspace/result shapes, and never reaches `ArtifactDirectTransferPort`. The 8 MiB
test therefore proves a real Hono metadata boundary rather than only a TypeScript facet. The router
remains intentionally unmounted in fixture/local composition; VF-1-07 will mount it only with the
complete durable auth/repository composition.

The pipeline passed 37/37, the Hono boundary passed 4/4, the independent audit closed with no high
or medium finding, and the uncached repository gate passed Workerd 1/1 plus Chrome 34/34. No R2,
network, credential, provider, cloud mutation, or external spend was used.
