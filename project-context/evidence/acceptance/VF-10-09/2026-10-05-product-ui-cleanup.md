# Product UI cleanup acceptance

Checkpoint V2-09 / VF-10-09, DEC_UX_008,2026-10-05. Branch `codex/product-ui-cleanup`,
base `afd2226a`; published baseline `3899d418` / Worker `2f122c78`, native276.

The user explicitly requests the screenshot changes for every account and production publication.
Routine API health badge and queue disconnect notice removed; real connection/computer errors remain.
Progress omits Estimated and manual Refresh now, retains automatic polling, persisted status/stages,
costs, wall elapsed, retry/cancel/delete and a warning for unverified completed outputs.
Saved remains the single collected-voices tab; star preferences/order, search, facets, imports and
preview/synthesis behavior are preserved. Usage rendering/navigation removed; old /usage redirects
safely to Queue. Server usage/billing/retention data and endpoints stay intact.

The excessive Progress whitespace came from placing Cloud cost rows in only the heading grid column.
Existing CSS grid now spans that section across the body and aligns three cost metrics in one row,
with responsive stacking and no new dependency. Desktop1440px summary is454.1875px high rather than
the screenshot's large sparse block; no overflow at977/320px. Projected cost quantities and uncertainty,
actual-rate compute cost, rental clocks, totals and breakdown remain truthful.

Provider-free307 focused checks across six suites plus one hosted-shell check pass. They include
live monotonic rental clocks, incomplete-charge labels, latest-output refusal, automatic progress
updates without a Refresh button, scoped stop confirmations/recovery, voice saving/filtering and
Centralized Library Delete. Twelve installed-Chrome journeys at1440/977/320px pass: designated
owner and ordinary-account UI removals, Usage redirect, active automatic updates, complete cost-card
geometry, Saved/search/facets, collection access negatives, full synthetic playback and exact native
synthetic download, delete confirmation/cancel and one synthetic deletion. Zero unintended mutations
or page errors in the UI-cleanup journeys. Types/owned ESLint, both production/staging builds and
quarantines, context/secrets/diff checks pass. Logs/screenshots are private under
`.videoforge/centralized-library-preview/cleanup-*` and `apps/web/test-results/`.

Production preflight confirms current3899d418/Worker2f122c78,55 bindings27 secrets3 Workflow
identities. Voice branch remains d33b0a0e, already incorporated; no source drift or overwrite.
Wrangler refreshed the expired OAuth access token through its existing session before read-only
preflight; no credential is printed or tracked. Native276 unchanged, no schema/RLS/server API change.

New provider inference/compute/retained resourcesUSD0; no generation, rental, Workflow instance or
healthy driver restart. Unrelated provider inventory unrefreshed. Inherited broad-CI/Local/long-form,
provider/editorial/invoice and native production download-policy gates remain separate. Synthetic
Chrome and live retained playback/read checks are separate evidence; no real video deleted for tests.

Published executable `d6d23797c1c1dc2f863cfb2083e329c4a934bc40` / Worker
`434f9b9e-4dca-4d98-ba9d-67f25cd9b200` at100%. All34 public asset byte lengths/SHA256
match rebuilt files. All55 bindings/27 secrets, routes/domain/crons, generation/runtime pins and
three Workflow identities preserved; matching registrations refreshed with no instance or driver
restart. Backend bundle is byte-identical to3899:8,045,531 bytes,
SHA256`a25ff3ba085819739357c0d523bddfc73b8bb435832c8544cd9066c58025e6c2`.
Native276 unchanged. Actual production Usage bookmark returns Queue, API badge/Usage navigation/
disconnect notice absent. Saved1 survives; the1,117-voice catalog and themed filters remain available.
Anonymous Centralized Library returns401. Private proof under
`.videoforge/product-ui-cleanup-20261005/release/` excludes all credentials from tracked evidence.

Live voice filtering selects Female362, resets and returns Saved1 without preference mutations.
All30 Centralized Library cards/Delete controls survive. The retained20.333008-second1920x1080
film plays fully in signed-in Chrome, ended=true/error=null; player closes and collection remains
without overflow. Browser media inspection is scoped to the dialog video, since card thumbnails are
separate paused videos. No real output deleted and no fresh synthesis or provider generation started.

Acceptance `db7d1bde` is pushed. GPT Space Project63/Root53/Index83/Coverage78 guarded
updates and exact readbacks preserve prior library/voice history and other projects.
