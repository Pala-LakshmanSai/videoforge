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

Seven focused database tests, 27 J1 route/client checks, 23 archive/library checks,
nine studio checks and three Chrome flows pass. Types, touched-file lint, both bundle
firewalls, context and secret checks pass. Full web suite:223 files,3270 passed,one existing skip; final manual status-check
addition passes the nine-test studio suite. Publication/live readback pending. No new paid generation or GPU action is needed for these
queue/database/UI checks; existing production audio will verify live playback/download headers.
