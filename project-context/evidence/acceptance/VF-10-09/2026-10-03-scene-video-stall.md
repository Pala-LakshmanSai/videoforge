# Scene-video stall repair — 2026-10-03

Checkpoint V2-09, codex/seedance-video. Publication and existing-project recovery pending at this source commit.

## Proven cause

The affected run has233 accepted images,71 accepted avatars and17/18 accepted scene clips. The remaining exact Runware task returned HTTP400 with status:error, taskType:videoInference, code:providerError and upstream detail “Failed to download video from provider”. The adapter only treated HTTP2xx failures as terminal, swallowed this as POLL_UNAVAILABLE, and kept reporting WAITING. The durable Workflow finished all5000 observations at13:04:45Z, output RECONCILIATION_REQUIRED, success:true. No saved-footage continuation arm matched it after all image/avatar jobs completed. This explains the multi-hour running label and pending assembly; it is not normal clip-generation time. The provider's underlying download failure has no more specific exposed cause.

## Repair and proof

Exact UUID/no mixed-result HTTP400 videoInference providerError is now terminal, allowing the existing verified-original still fallback. HTTP401/429/500, generic lookup/getResponse, missing records, mixed results and mismatched task IDs remain fenced. Retrieval never posts inference. The continuation sweep ensures the same durable Workflow when one ACTIVE admitted API request has all image/avatar jobs SUCCEEDED and saved video jobs SUBMITTED/SUBMITTING/UNKNOWN_NO_RETRY. The existing scheduler only restarts terminal Workflows and retains exact UUID/claim/receipt identity. Settled, archived, foreign and failed-API work is excluded.

69 focused provider, API-execution, scheduler and native PGlite sweep tests pass, including production error shape and stopped saved-video recovery. Web and Worker TypeScript and changed-file lint pass. Production/staging builds pass; the production due-query adds751 bytes to the static closure, measured2,807,489; staging limit remains2,803,663. Quarantine and all other guards remain. No renderer/contract change or new dependency.

The first reruns hit local ENOSPC; reproducible old builds/dry-run duplicates were removed and old bundles losslessly compressed, preserving source, accepted media, current rollback bundles and private receipts. The final suite passes.

No fresh inference or canary is requested. Existing final render uses the already authorized ongoing Cloud lifecycle. Production recovery, final output, Chrome and compute cleanup must be verified separately; provider invoices and fresh30-minute performance remain unverified. Private exact task/provider/Workflow records are retained outside Git; no credentials or customer identities appear here.
