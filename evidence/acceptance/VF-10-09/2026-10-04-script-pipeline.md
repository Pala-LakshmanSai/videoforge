# Script-first project pipeline acceptance

Checkpoint V2-09 / VF-10-09, profile `v2_09_j1tts_voiceover`; base `4289a047`.

One Create video action accepts either uploaded audio or a script and exact selected voice. The script path creates a private durable project immediately, waits for narration capacity, submits J1TTS once, records uncertain outcomes without replay, measures/stores completed MP3, then uses the existing revision/commit/ASR admission path. Script and voice remain pinned. Progress and Queue show narration first; temporary downstream failures retry the saved handoff. Uploaded-audio behavior, sample previews, saved/starred voices, and immutable presets remain intact.

Migration253 is additive: forced tenant RLS, immutable intake identity/audio receipt, queued cancellation, active narration archive guard, bounded due-project query, and retrieval-only observation of known provider jobs. Native PostgreSQL rollback rehearsal restored migration252 and the original observer; runtime grants and RLS verified. Application has not yet been published at this source checkpoint.

Validation: 473 focused web/server/Workflow tests; final250 affected tests after retry-copy changes; 3 native database privacy/cancellation/capacity/inventory tests; Web and Worker types, lint, production/staging quarantine, and context checks. Exact startup closures are2813301/2806268 bytes; provider and generated validators remain lazy, existing quarantine and CPU bounds unchanged. Real workerd streamed the existing J1TTS file to R2 with306408 bytes, duration19087ms matching FFprobe19.086803s, SHA256398d4b5332e337e74c77d4b4e6d6f98baca039d45621a0696be41c9654a49811. Synthetic16-second MP3 measured16000ms, including gapless metadata handling.

Real Chrome fixture: desktop script + favorite enables Create, no separate Generate voiceover button, accepted Create reaches durable-intake route and narration progress;390px mobile script controls inspected. Fixture proof is distinct from production provider proof. Current production Chrome account has no ready avatar; do not alter its account or unrelated project to manufacture acceptance.

Private receipts: `.videoforge/script-pipeline-20261004/` under the primary checkout. No credentials retained in repository evidence. Before publication no new paid work or compute was started. Remaining gates: native migration apply, exact configuration-preserving release, one short automatic script project and one direct-audio regression within USD2 finite acceptance cap, final artifact verification and owned-compute cleanup. J1TTS invoice pricing is not asserted.

## Production acceptance in progress

Application `c288e291095412233e06faacedeca0e0d3c53bb1` / Worker `b1d1a96c-9c9e-4964-800a-b4fa4dfce8be` published at100%. Migration253 applied with native RLS/grant proof.29 public asset hashes match;53 bindings,26 secrets,three Workflow registrations and native pins preserved. Chrome verifies script-first copy, no Generate voiceover action,41 B-name results and11.238458s sample playback ending cleanly.

Live script intake929b4802-ac01-4428-a317-82037230fc2d generated exactly one J1TTS job and saved289271-byte MP3, measured18019ms. Automatic materialization exposed a pre-existing missing runtime INSERT grant on project_inputs. Native rollback diagnosis reproduced SQLSTATE42501. Additive254 grants only INSERT; forced tenant RLS and existing write guards remain. Own-account insertion succeeds and foreign workspace insertion fails in regression coverage. Native grant rollback verified;254 applied without UPDATE/DELETE grants. Existing intake retries its saved MP3 without another provider POST. Full video and final cleanup remain pending.

## Short word-boundary correction

The same intake resumed automatically after254 and reached ASR SUCCEEDED and context COMPLETE without another TTS POST. Full MP3 decode and FFprobe18.018685s match the server18019ms; foreign project/audio requests return404. Planning then exposed an independent infeasible word-boundary case in immutable V4: no complete valid schedule fits20–24% with boundaries3.470s/4.440s. The test project is archived and its clean ASR/accepted narration retained as evidence; no historical revision was rewritten.

New scheduler-v5 is selected only for fresh10–30s revisions. It tries the original20–24% band first and only after failure allows at most26%, preserving whole-word cuts, scene duration envelopes and exact continuous source/frame coverage. V2/V3/V4 configs and old plan replay remain unchanged; longer-than30s still selects V2.16 scheduler tests include both real timing fixtures, deterministic replay, unchanged old-version plans and use of the original band when feasible.173 affected product/intake tests, Web/Worker types and both quarantine builds pass. Existing native Cloud/Desktop pins remain valid; the scheduler is the Worker-side planning code.

Acceptance is bounded to two new TTS jobs and three short project attempts including the archived V4 probe, within the same total USD2 finite cap. This correction requires one fresh script run because the old revision's scheduler identity is immutable; direct upload is the other regression run. No uncertain paid POST is replayed.

## Cloud queue render deadlock correction

V5 application b9ab22233ce9ac4853e4534c9353359bd76ef009 / Worker dd986e66-5063-43ce-a646-6773b4eda5e3 is live. Fresh script63aed0ae-faa6-4140-9f11-68777e439fa6 automatically completed narration, ASR, context, planning, prompts, span audio and all four Kie/Fal jobs. Direct-upload1059deb2-418d-4908-9596-5248f22537f7 queued its original ASR without TTS. All ASR/span rentals are CLEAN.

Final render exposed legacy0033 treating the waiting Cloud ASR as active personal CPU capacity: exact persisted render submission returned409 HOSTED_CPU_ACCOUNT_PROJECT_ACTIVE.255 excludes queued Cloud PLANNED/OUTBOXED attempts from this legacy personal guard. Actual Cloud execution still requires the independent reservation, VIDEO admission and provider capacity fences; running Cloud and Local project limits remain. Focused guard regression and19 full-schema privacy/admission/inventory tests pass; native PostgreSQL trigger and rollback verified against the actual queued lineage. Migration apply and resume of the same errored API Workflow remain pending at this source checkpoint. Accepted media will not be regenerated.
