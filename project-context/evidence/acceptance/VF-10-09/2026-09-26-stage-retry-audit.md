# V2-09 stage retry audit — 2026-09-26

Status: deployed source `80b4f105` / Cloudflare `37e48c02`; production migration 0211 applied.
Chrome downloaded 344,114,328 bytes through the stable authenticated stream; SHA-256 matches
the accepted final MP4 `a5230228…65984fe`. Creative approval remains pending.
Worker 0.1.39 is already published on both platforms and installed/Online on this Mac.
The same `china found` project finished its second local render; final receipt, technical
probe and advancing Chrome playback pass. Exact identities are in
`2026-09-26-china-found-render.json`.

| Stage | Recovery behavior and retained work |
|---|---|
| Prepare | Creation/readiness retries retain request identity; invalid input/account/readiness must be corrected before creation. |
| Transcribe | Retains voiceover and terminal attempts. Current-bundle ASR work budget remains three; overall ceiling twelve. Old-bundle invalid output does not exhaust a fixed bundle. Disk failures do not spend ASR work-failure budget. |
| Understand context | Unknown results reconcile the original task. Definite provider failure may use the existing bounded redispatch; accepted context is reused. Unknown charged submissions are never blindly replayed. |
| Plan scenes | Inline Retry repeats only deterministic planning from saved ASR/context. The original sub-frame phrase defect is repaired; failed browser handoff now reads Failed instead of Pending. |
| Write prompts | Durable batches and scene outputs survive continuation. Completed saved UNKNOWN runs finalize without provider calls; missing generation identity no longer offers a false action. Definite empty failures have bounded redispatch. Invalid or uncertain paid batches with partial results remain blocked where no authorized safe recovery exists. |
| Audio spanning | Existing bounded local replay retries failed spans; accepted/scheduled siblings are skipped. Retry delay, ceiling, deadline and disk reason remain enforced. |
| Generate images | Retrieves each SUBMITTED job by its persisted Kie task ID. Accepted jobs remain immutable. Blocked/failed siblings stop new POSTs but no longer strand known submitted results. |
| Generate avatar video | Same retrieval behavior using persisted Fal request IDs. A failed result download retries retrieval, preserving original request and accepted siblings. No resubmit for uncertain identities. |
| Assemble | Migration 0211 permits supported local failures in any sequence, up to five total render attempts. Invalid input/output requires a changed execution bundle. Duplicate clicks return the same retry attempt/key. Saved API outputs/receipts/manifest and released provider lease are reused; no API generation calls. |
| Technical check | Part of assembly acceptance; cannot accept invalid media. Recoverable render failures use the same bounded local path; existing accepted final output cannot be overwritten. |
| Review/approve/download | Human approval remains explicit. Stable authenticated preview/approved download stream checks tenant, current revision, successful attempt, issued MP4 identity, R2 bytes/checksum and approval for the download route. Range support permits seeking/resume. |

## Proven fixes

- Fal alignment tried only the 500ms frame. A valid alternative now passes unchanged
  geometry guards. All 99 saved clips pass; 12 require another frame.
- Local retry UI/server formerly depended on a hardcoded error sequence. 0211 generalizes
  supported local recovery without expanding the existing five-attempt ceiling, preserving
  legacy response replay and using a unique attempt-scoped outbox key.
- An uncertain API job formerly returned before retrieving submitted siblings. Retrieval now
  continues without compiling/rebinding blocked queued work or making new paid submissions.
- The player exposed a five-minute signed R2 preview URL; native downloads could expire and
  return an XML error. Approved download also compared MP4 authority metadata with the JSON
  result document. Stable authenticated media routes now bind each authority to its own bytes.

## Validation and limits

- 120 hosted coordinator/provider/context/prompt/span/continuation/dispatch/retry tests pass
  across ten suites (119 before the final blocked-queue retrieval regression, then 34/34 in
  the two changed API/dispatch suites).
- 23 focused UI retry/download tests; five MP4 stream/range/checksum tests pass.
- Twelve legacy/new local recovery migration tests pass, plus the final 0211 legacy-replay
  regression. Production migration preflight applies 0211 in a transaction and rolls back.
- Web TypeScript, touched ESLint, production build/bundle guard and diff checks pass.
- Full UI/product run: 219 pass, three existing failures (two timer labels and one source-string
  prompt binding assertion). No new failure on the changed retry/download surfaces.
- Expanded historical database fixture suites have eleven existing failures
  (missing digest/admitted-account helpers and a stale 0187 manifest-tail assertion);
  unchanged af53d01e baseline reproduces nine ASR/span and two prompt failures.
  Two prompt fixture failures also reproduce on unchanged af53d01e; five prompt checks pass. Do not claim full repository green.
- Production retains historical ledger entries omitted from the current manifest and lacks
  obsolete 0148. Every shared entry hash matches; migration execution freezes the exact
  193-entry live baseline and appends only 0211. Historical entries are not rewritten.
- No new paid request/replay, cap expansion, replacement project or GPU activation for these
  fixes. This is a bounded recovery contract, not a guarantee that unavailable providers,
  exhausted budgets, corrupt inputs or missing disk space can always complete.
