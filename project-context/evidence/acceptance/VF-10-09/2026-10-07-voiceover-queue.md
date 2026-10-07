# Voiceover queue and studio — 7 October 2026

V2-09 / VF-10-09, profile `v2_09_standalone_voiceovers`.

The previous composer locked to one result and the database rejected a second pending job.
Additive0291 allows WAITING backlog, preserves one active submission per account, existing
provider caps/cooldowns and FIFO fairness, and all immutable provider identity/no-replay guards.
Native PostgreSQL rollback-only migration + two-job proof passed; no provider request occurred.
Rollback is the immediate predecessor application (3ce1bbd6), retaining0291 and all queued rows;
historical retired direct-start APIs are not a supported rollback target.

Standalone POST acknowledges only a saved job with an exact confirmed background observer;
provider submission happens through existing Workflow claims. Lost responses reconcile the same
request ID. Library-backed queue persists beyond the page, shows active/recent completed jobs,
and keeps the composer ready for another script. Queue display shows the newest48 entries;
full paginated history remains in Library. Downloads use saved title via safe UTF-8 disposition,
including older outputs; internal provider/storage names remain immutable.

Parent audited Luna backend/filename changes and owns final studio implementation and browser
acceptance. Fixture Chrome checks cover two successive submissions, leaving/returning, lost POST
acknowledgement without replay, desktop/mobile layout and existing Library deletion.

Final combined release: `6140c6576dca2e68db9b5e8749234740cfb41902`, Worker
`4a3303d6-db32-4730-844b-7f1aaaefb9eb` at100%, native291. Image QA production
commit3ce1bbd6 was merged intact when exact-baseline guards detected concurrent publication.
The first290 migration attempt raised BASELINE_CHANGED before any change; a fresh291 proof and
intent applied after ledger290 reconciliation. Production bindings and existing Workflow identities
were preserved. No Workflow registration, restart or paid activation occurred.

Eight focused database tests,27 J1 checks,23 archive/library checks,nine studio checks and
three installed-Chrome flows pass. Combined full web suite:226 files,3296 passed,one existing skip.
Both TypeScript projects, touched-file lint, production/staging builds and bundle firewalls,
context and secret checks pass. Existing broad CI formatting and stale legacy rollback-document
range remain outside this change. All37 public deployed assets match local SHA256; private anonymous
access remains401. Initial asset propagation lag passed a GET-only recheck without redeployment.

Live Chrome shows the saved dssd result beside a cleared composer, plays its39.427483-second MP3
with readyState4 and advancing currentTime, and retains the result after navigation. Authenticated
HTTP206 returns audio/mpeg and attachment filename="dssd.mp3" with the exact16-byte requested range.
The browser automation download action hit ERR_BLOCKED_BY_CLIENT, so native file-save location is
not claimed. No fresh paid multi-job canary was run; queue/FIFO/observer and reload behavior are
covered by provider-free database, route and Chrome tests. Existing projects remain untouched;
no new provider generation, GPU rental or other compute was started.

Private receipts: `.videoforge/voiceover-queue-20261007/` native-proof-291.json,
migration-291-verified-private.json, title-proof.json and release-final/verified-private.json.

## Bounded queue follow-up

The desktop list had a580px ceiling (390px on shorter screens), but the mobile rule removed
its ceiling entirely. Use one240–360px viewport-responsive limit at every breakpoint, native
vertical scrolling, stable scrollbar gutter, non-shrinking rows and keyboard focus. Heading,
counts and Library access remain outside the list. No job/media/database/provider behavior changes.

Published source9fef8e0c / Worker77d47f2e-5c4b-45c6-ba79-e0a0f2f69c0a at100%.
Parent audited the Luna browser test and fixed its keyboard-animation wait. Installed Chrome
passes24 rows (20 completed with audio/download controls) at1280x900 and390x844: bounded height,
keyboard End reaches last row, no horizontal overflow and Library stays outside the scroller.
Nine studio tests, types/lint, both builds/firewalls, context/secrets and37 deployed asset hashes pass.
Live Chrome confirms max-height360px, overflow auto, keyboard focus and both existing results.
Server bundle SHA256 is byte-identical to6140c657; native291, bindings and Workflows unchanged.
USD0 new generation/compute. Private publication receipts:release-overflow/verified-private.json.
