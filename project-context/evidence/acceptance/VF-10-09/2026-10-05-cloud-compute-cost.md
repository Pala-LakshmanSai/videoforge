# GPU uptime and total production cost

Checkpoint V2-09 / VF-10-09. Executable source `78c48dcc8ca9855ad81dfc7088921f669ba2e29f`, branch `codex/cloud-compute-cost`, Worker `3184f912-8683-41c1-85c1-eb9c3caedbd7` at 100%. Native migration remains 274. User explicitly authorized live GPU cost, all-API-plus-RunPod totals, parallel agents and production publication. No new paid work.

## Behavior and accounting boundary

Progress shows confirmed GPU uptime, accrued compute cost and total cost so far. Expand Cost breakdown to inspect each API category and each rental's machine, recorded hourly rate, duration and charge. The projected image/avatar/video-generation estimate explicitly excludes Cloud compute and stays separate from costs incurred so far.

Each reservation counts once across project revisions, including failed/retried work. Shared SPAN rentals serving multiple jobs are not counted per job. Confirmed placement starts the clock; startup, processing, uploads and shutdown are included until verified cleanup or the earlier exact tenant-owned absence event. Capacity waiting with no accepted/uncertain launch and no Pod costs zero. Unknown launch, missing start or missing actual price remains unconfirmed. Rate includes the temporary-disk amount already recorded by the rental lifecycle. Provider creation timestamps and invoices are not available; this is an estimate from confirmed lifecycle records, not an exact invoice.

The API rollup includes context analysis, scene prompts, generated images, avatar footage, scene footage, replacement images and historical endpoint charges across project attempts. Recorded settled/reported amounts take precedence over existing quotes; reservations are not mistaken for charges. Unsubmitted/refused work is excluded. Missing narration dollar charges and uncertain submissions produce visibly partial totals. Fixed infrastructure subscriptions, unlinked Voiceover Hub work and provider invoice adjustments are outside project-attributed charges.

The live display uses the server observation time plus a monotonic browser clock, advances every second and retains polling while a rental is active/unconfirmed even when production stages are terminal. Stopped totals remain fixed.

## Verification

- 465 focused web/UI/route/SQL regressions passed. Pricing, monotonic timer, shutdown, capacity/no-start, partial costs, combined totals, shared-rental counting, tenant scoping and exact absence proof covered.
- Three Chrome journeys passed: desktop/mobile Progress (1440/390/320 pixels without overflow), live-to-stopped combined totals and existing configurable opening controls. Dedicated test servers did not replace the stable owned development URL.
- Web and Worker TypeScript, changed-file ESLint/Prettier, contracts, context, tracked-file secret scan, both builds, bundle quarantine and Workerd fixture parity passed. Native read-only transactions through the actual runtime credential qualified eight projects and 23 distinct rentals; foreign account scope returned no costs/rentals. No database writes or schema changes.
- Production payloads: all 30 public assets exact hash/length; private anonymous catalogue returns 401. Source status, 55 bindings, 27 secrets, three Workflow identities, query redaction, 100% traffic, routes, custom domain and both cron schedules preserved. Matching Workflow registrations published; the healthy existing continuation driver remained running, without restart or new generation Workflows.
- Real Chrome production totals match native records. A retained project shows GPU 1m33s / $0.0191 and total $0.2036. The user's latest completed project shows five rentals, GPU 8m52s / $0.1086 and API-plus-GPU total $1.4903; displayed amounts round independently from raw sums. Both counters are stopped. API healthy; rate/cost breakdown works. Existing 180s 1080p video playback advances without errors; retained 20.333008s 1080p video plays fully, ended=true/error=null.
- Complete RunPod inventory: zero Pods at 2026-10-05T09:26:55Z. Native active generations, leases and waiters all zero during trigger publication. New provider submissions/rentals and test spend: zero. Historical UNKNOWN/STOPPING record preserved.

## Remaining gates and rollback

No scoped publication gate remains. This is not a fresh paid film-generation or provider-invoice qualification. Unpriced narration, historical uncertainty, inherited canonical full-CI/Local/long-form/concurrency/editorial/provider-funding gates remain separate, as recorded by the prior reliability audit. The additive display and read-only projection change no provider, renderer, admission, avatar, opening/coverage or stored generation contracts. Rollback is the prior source `332b7092` / Worker `37d37bb8`; no schema reversal is required. Preserve accepted work and never replay generation during rollback.

Detailed private receipts are under the primary workspace's ignored `.videoforge/cloud-compute-cost-20261005/`; credential values and signed media URLs are excluded from repository evidence.
