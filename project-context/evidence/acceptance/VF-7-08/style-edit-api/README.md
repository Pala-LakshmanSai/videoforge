# VF-7-08 versioned Image Style edit API evidence

Status: provider-free technical pass at `$0` on 2026-08-11.

- Shared versioned request, response, problem, and exact version-tag contracts are exported from
  `@videoforge/contracts` and used by both server and client.
- Authenticated `PATCH /api/v1/image-styles/{style_id}/versions/{version_id}` requires one complete
  candidate, exact `If-Match`, and `Idempotency-Key`; client actor/workspace truth is rejected.
- Production composition invokes only the existing VF-7-07 PGlite service and returns exact root,
  parent, current artifact/hash, changed-pointer, revision, invalidated-review, and replay facts.
- Focused contracts passed 4/4, route/auth/error tests passed 14/14, and style edit/PGlite suites
  passed 16/16. Forced full verification passed 780 tests/journeys: control-plane 209/209,
  Workerd 1/1, installed Chrome 38/38, zero skips.
- Full-candidate validation, authentication/isolation, optimistic concurrency, exact/conflicting
  replay, immutable states, lineage, rollback, reopen, restore, and zero outbound calls are covered.

No provider call, credential, model download, cloud mutation, GPU action, push, or spend occurred.
