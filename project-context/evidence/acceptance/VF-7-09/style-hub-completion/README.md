# VF-7-09 provider-free Image Styles Hub evidence

Status: provider-free technical pass at `$0` on 2026-08-11.

- Browser intake accepts 3–8 owned JPEG/PNG/WebP references, honors orientation, bounds dimensions
  to 1600 px, emits sRGB WebP derivatives, strips metadata, and hashes exact original/normalized
  bytes. Server validation independently verifies base64, magic, dimensions, checksums, limits,
  pairing, disclosure, rights, retention, ordering, and metadata-free normalized WebP structure.
- Fixture lifecycle routes cover draft creation/reopen, reference registration, deterministic
  analysis, review/edit, exact publication, reference preview, archive, and project selection.
  Mutations preserve authentication, workspace isolation, optimistic concurrency, and exact
  idempotent replay.
- The accepted Image Styles UI completes upload -> analyze -> reload/reopen -> edit -> publish ->
  exact select -> Hub preview -> archive. Project draft state survives the round trip, and archived
  versions disappear from new selection.
- Full verification passed 786 tests/journeys: contracts 59/59, control-plane 209/209, web unit
  181/181, Workerd 1/1, installed Chrome 38/38, and zero skips. The two targeted Hub Chrome
  journeys passed at desktop and compact widths with zero external requests or browser errors.
- The first forced full run found AJV runtime code generation incompatible with Workerd. Commit
  `d9adee9` replaced that boundary with a strict Workerd-safe Zod mirror and the forced full gate
  then passed.

Implementation commits: `6fb3312` and `d9adee9`.

No provider call, credential, model/weight download, GPU/RunPod action, cloud/account mutation,
deployment, push, or spend occurred. Fixture reference bytes are session-scoped; production R2,
live Gemini/Mage orchestration, and provider gates remain separate unfinished work.
